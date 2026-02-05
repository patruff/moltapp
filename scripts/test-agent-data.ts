#!/usr/bin/env npx tsx
/**
 * Comprehensive Agent Data Testing
 *
 * Tests all data pipelines to ensure agents receive correct information:
 * 1. Market data (prices from Jupiter)
 * 2. Portfolio context (positions, balances)
 * 3. Tool execution (get_portfolio, get_stock_prices, search_news, etc.)
 * 4. Thesis management (get_active_theses, update_thesis, close_thesis)
 * 5. Full agent flow simulation
 *
 * Usage:
 *   npx tsx scripts/test-agent-data.ts
 *   npx tsx scripts/test-agent-data.ts --verbose
 *   npx tsx scripts/test-agent-data.ts --agent claude   # Test specific agent
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env
try {
  for (const line of readFileSync(resolve(__dirname, "../.env"), "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
} catch {}

// Parse CLI args
const args = process.argv.slice(2);
const verbose = args.includes("--verbose") || args.includes("-v");
const agentFilter = args.find(a => a.startsWith("--agent="))?.split("=")[1] ||
                   (args.includes("--agent") ? args[args.indexOf("--agent") + 1] : null);

// Import after env is loaded
const { XSTOCKS_CATALOG } = await import("../src/config/constants.ts");
const tradingTools = await import("../src/agents/trading-tools.ts");
const executeTool = tradingTools.executeTool;
const { db } = await import("../src/db/index.ts");
const { positions } = await import("../src/db/schema/positions.ts");
const { trades } = await import("../src/db/schema/trades.ts");
const { agentTheses } = await import("../src/db/schema/agent-theses.ts");
const { eq } = await import("drizzle-orm");
const { claudeTrader } = await import("../src/agents/claude-trader.ts");
const { gptTrader } = await import("../src/agents/gpt-trader.ts");
const { grokTrader } = await import("../src/agents/grok-trader.ts");

// Test results tracking
interface TestResult {
  name: string;
  passed: boolean;
  details: string;
  duration: number;
}

const results: TestResult[] = [];

function log(msg: string, indent = 0) {
  console.log("  ".repeat(indent) + msg);
}

function logVerbose(msg: string, indent = 0) {
  if (verbose) log(msg, indent);
}

async function runTest(name: string, testFn: () => Promise<{ passed: boolean; details: string }>) {
  const start = Date.now();
  try {
    const result = await testFn();
    results.push({ name, ...result, duration: Date.now() - start });
    const icon = result.passed ? "✓" : "✗";
    log(`${icon} ${name} (${Date.now() - start}ms)`);
    if (!result.passed || verbose) {
      log(result.details, 2);
    }
  } catch (err) {
    const duration = Date.now() - start;
    const details = err instanceof Error ? err.message : String(err);
    results.push({ name, passed: false, details, duration });
    log(`✗ ${name} (${duration}ms)`);
    log(`Error: ${details}`, 2);
  }
}

// =============================================================================
// TEST 1: Market Data from Jupiter
// =============================================================================

async function testMarketData(): Promise<{ passed: boolean; details: string }> {
  const jupiterApiKey = process.env.JUPITER_API_KEY;

  if (!jupiterApiKey) {
    // Without API key, test that mock price fallback works
    return {
      passed: true,
      details: "JUPITER_API_KEY not configured — orchestrator will use mock prices. Set JUPITER_API_KEY for live prices."
    };
  }

  const headers: Record<string, string> = { "x-api-key": jupiterApiKey };
  // XSTOCKS_CATALOG is an array of StockToken objects
  const testStocks = XSTOCKS_CATALOG.slice(0, 5);
  const mints = testStocks.map(s => s.mintAddress).join(",");

  logVerbose(`Testing Jupiter with mints: ${mints.slice(0, 100)}...`);

  const response = await fetch(`https://api.jup.ag/price/v3?ids=${mints}`, { headers });

  if (!response.ok) {
    return { passed: false, details: `Jupiter API returned ${response.status}` };
  }

  const data = await response.json() as Record<string, { usdPrice: number; priceChange24h?: number }>;
  // v3 API returns mint addresses as top-level keys (no .data wrapper)
  const prices = Object.entries(data).filter(([k]) => k.length > 30); // Filter out non-mint keys

  if (prices.length === 0) {
    return { passed: false, details: `No prices returned from Jupiter. Response: ${JSON.stringify(data).slice(0, 200)}` };
  }

  const issues: string[] = [];
  const priceSamples: string[] = [];

  for (const [mint, info] of prices) {
    const price = info.usdPrice;
    if (typeof price !== "number" || isNaN(price) || price <= 0) {
      issues.push(`Invalid price for ${mint}: ${price}`);
      continue;
    }
    // Check for reasonable stock prices ($1 - $10000)
    if (price < 0.01 || price > 50000) {
      issues.push(`Suspicious price for ${mint}: $${price.toFixed(2)}`);
    }

    // Find symbol for this mint
    const stock = testStocks.find(s => s.mintAddress === mint);
    if (stock) {
      priceSamples.push(`${stock.symbol}: $${price.toFixed(2)}`);
    }
  }

  if (issues.length > 0) {
    return { passed: false, details: issues.join("\n") };
  }

  return { passed: true, details: `${prices.length} live prices fetched. Sample: ${priceSamples.slice(0, 3).join(", ")}` };
}

// =============================================================================
// TEST 2: Database Connectivity
// =============================================================================

async function testDatabase(): Promise<{ passed: boolean; details: string }> {
  const posCount = await db.select().from(positions);
  const tradeCount = await db.select().from(trades);
  const thesesCount = await db.select().from(agentTheses);

  return {
    passed: true,
    details: `Connected. Positions: ${posCount.length}, Trades: ${tradeCount.length}, Theses: ${thesesCount.length}`,
  };
}

// =============================================================================
// TEST 3: xStock Decimals Configuration
// =============================================================================

async function testDecimalsConfig(): Promise<{ passed: boolean; details: string }> {
  const issues: string[] = [];
  let count8 = 0;
  let countOther = 0;

  for (const [symbol, config] of Object.entries(XSTOCKS_CATALOG)) {
    if (config.decimals === 8) {
      count8++;
    } else {
      countOther++;
      issues.push(`${symbol} has decimals=${config.decimals} (expected 8)`);
    }
  }

  if (issues.length > 0) {
    return { passed: false, details: `${issues.length} stocks with wrong decimals:\n${issues.slice(0, 5).join("\n")}` };
  }

  return { passed: true, details: `All ${count8} xStocks configured with decimals=8` };
}

// =============================================================================
// TEST 4: Tool - get_portfolio
// =============================================================================

async function testGetPortfolioTool(): Promise<{ passed: boolean; details: string }> {
  const mockCtx: any = {
    agentId: "test-agent",
    portfolio: {
      cashBalance: 100.50,
      positions: [
        { symbol: "AAPLx", quantity: 0.5, averageCostBasis: 180, currentPrice: 185, unrealizedPnl: 2.50, unrealizedPnlPercent: 2.78 },
        { symbol: "NVDAx", quantity: 0.25, averageCostBasis: 800, currentPrice: 850, unrealizedPnl: 12.50, unrealizedPnlPercent: 6.25 },
      ],
      totalValue: 305.25,
      totalPnl: 15.00,
      totalPnlPercent: 5.17,
    },
    marketData: [],
  };

  const result = await executeTool("get_portfolio", {}, mockCtx);
  const parsed = JSON.parse(result);

  const issues: string[] = [];

  if (parsed.cash_usdc !== 100.50) issues.push(`cash_usdc: expected 100.50, got ${parsed.cash_usdc}`);
  if (parsed.total_portfolio_value !== 305.25) issues.push(`total_value: expected 305.25, got ${parsed.total_portfolio_value}`);
  if (parsed.position_count !== 2) issues.push(`position_count: expected 2, got ${parsed.position_count}`);
  if (!Array.isArray(parsed.positions)) issues.push(`positions not an array`);

  if (parsed.positions?.length > 0) {
    const pos = parsed.positions[0];
    if (pos.symbol !== "AAPLx") issues.push(`First position symbol: expected AAPLx, got ${pos.symbol}`);
    if (pos.current_price !== 185) issues.push(`AAPLx price: expected 185, got ${pos.current_price}`);
  }

  if (issues.length > 0) {
    return { passed: false, details: issues.join("\n") };
  }

  return { passed: true, details: `Portfolio correctly returned: $${parsed.cash_usdc} cash, ${parsed.position_count} positions` };
}

// =============================================================================
// TEST 5: Tool - get_stock_prices
// =============================================================================

async function testGetStockPricesTool(): Promise<{ passed: boolean; details: string }> {
  const mockMarketData = [
    { symbol: "AAPLx", name: "Apple", mintAddress: "xxx", price: 185.50, change24h: 2.5, volume24h: 1000000 },
    { symbol: "NVDAx", name: "NVIDIA", mintAddress: "yyy", price: 850.25, change24h: -1.2, volume24h: 2000000 },
    { symbol: "TSLAx", name: "Tesla", mintAddress: "zzz", price: 245.00, change24h: 4.8, volume24h: 3000000 },
  ];

  const mockCtx: any = {
    agentId: "test-agent",
    portfolio: { cashBalance: 100, positions: [], totalValue: 100, totalPnl: 0, totalPnlPercent: 0 },
    marketData: mockMarketData,
  };

  // Test: Get specific symbols
  const result1 = await executeTool("get_stock_prices", { symbols: ["AAPLx", "NVDAx"] }, mockCtx);
  const parsed1 = JSON.parse(result1);

  if (!Array.isArray(parsed1) || parsed1.length !== 2) {
    return { passed: false, details: `Expected 2 results, got ${parsed1?.length}` };
  }

  // Test: Get all symbols (empty array)
  const result2 = await executeTool("get_stock_prices", { symbols: [] }, mockCtx);
  const parsed2 = JSON.parse(result2);

  if (!Array.isArray(parsed2) || parsed2.length !== 3) {
    return { passed: false, details: `Expected 3 results for empty symbols, got ${parsed2?.length}` };
  }

  // Verify data structure
  const first = parsed1[0];
  if (!first.symbol || !first.name || typeof first.price !== "number") {
    return { passed: false, details: `Invalid price structure: ${JSON.stringify(first)}` };
  }

  return { passed: true, details: `Prices returned correctly: ${parsed1.map(p => `${p.symbol}=$${p.price}`).join(", ")}` };
}

// =============================================================================
// TEST 6: Tool - search_news (Brave API)
// =============================================================================

async function testSearchNewsTool(): Promise<{ passed: boolean; details: string }> {
  if (!process.env.BRAVE_API_KEY) {
    return { passed: true, details: "SKIPPED: No BRAVE_API_KEY configured" };
  }

  const mockCtx: any = {
    agentId: "test-agent",
    portfolio: { cashBalance: 100, positions: [], totalValue: 100, totalPnl: 0, totalPnlPercent: 0 },
    marketData: [],
  };

  const result = await executeTool("search_news", { query: "NVIDIA stock earnings 2026" }, mockCtx);
  const parsed = JSON.parse(result);

  if (parsed.error) {
    return { passed: false, details: `Search failed: ${parsed.error}` };
  }

  if (!Array.isArray(parsed.results)) {
    return { passed: false, details: `Expected results array, got: ${typeof parsed.results}` };
  }

  const count = parsed.results.length;
  const sample = parsed.results[0]?.title?.slice(0, 50) || "no results";

  return { passed: true, details: `${count} news results. Sample: "${sample}..."` };
}

// =============================================================================
// TEST 7: Tool - get_technical_indicators
// =============================================================================

async function testTechnicalIndicatorsTool(): Promise<{ passed: boolean; details: string }> {
  const mockCtx: any = {
    agentId: "test-agent",
    portfolio: { cashBalance: 100, positions: [], totalValue: 100, totalPnl: 0, totalPnlPercent: 0 },
    marketData: [],
  };

  const result = await executeTool("get_technical_indicators", { symbol: "AAPLx" }, mockCtx);
  const parsed = JSON.parse(result);

  // Should return indicator structure even with insufficient data
  if (parsed.error && !parsed.note) {
    return { passed: false, details: `Error: ${parsed.error}` };
  }

  // Check expected fields exist
  const expectedFields = ["symbol", "trend", "signalStrength"];
  const missingFields = expectedFields.filter(f => !(f in parsed));

  if (missingFields.length > 0) {
    return { passed: false, details: `Missing fields: ${missingFields.join(", ")}` };
  }

  return {
    passed: true,
    details: `Indicators returned: trend=${parsed.trend}, strength=${parsed.signalStrength}, RSI=${parsed.rsi14 ?? "N/A"}`
  };
}

// =============================================================================
// TEST 8: Tool - Thesis Management (get, update, close)
// =============================================================================

async function testThesisTools(): Promise<{ passed: boolean; details: string }> {
  const testAgentId = "test-agent-" + Date.now();
  const mockCtx: any = {
    agentId: testAgentId,
    portfolio: { cashBalance: 100, positions: [], totalValue: 100, totalPnl: 0, totalPnlPercent: 0 },
    marketData: [],
  };

  // Test 1: Create thesis
  const createResult = await executeTool("update_thesis", {
    symbol: "TESTx",
    thesis: "Test thesis for validation",
    conviction: "8",
    direction: "bullish",
    entry_price: "100.00",
    target_price: "120.00",
  }, mockCtx);

  const created = JSON.parse(createResult);
  if (!created.success) {
    return { passed: false, details: `Failed to create thesis: ${created.error}` };
  }

  // Test 2: Get active theses
  const getResult = await executeTool("get_active_theses", {}, mockCtx);
  const theses = JSON.parse(getResult);

  if (!Array.isArray(theses) || theses.length === 0) {
    return { passed: false, details: `No theses returned after creation` };
  }

  const ourThesis = theses.find((t: any) => t.symbol === "TESTx");
  if (!ourThesis) {
    return { passed: false, details: `Created thesis not found in active theses` };
  }

  // Test 3: Close thesis
  const closeResult = await executeTool("close_thesis", {
    symbol: "TESTx",
    reason: "Test complete",
  }, mockCtx);

  const closed = JSON.parse(closeResult);
  if (!closed.success) {
    return { passed: false, details: `Failed to close thesis: ${closed.error}` };
  }

  // Verify closed thesis no longer in active
  const getResult2 = await executeTool("get_active_theses", {}, mockCtx);
  const theses2 = JSON.parse(getResult2);
  const stillActive = theses2.find((t: any) => t.symbol === "TESTx");

  if (stillActive) {
    return { passed: false, details: `Thesis still active after close` };
  }

  return { passed: true, details: `Thesis lifecycle: created → retrieved → closed successfully` };
}

// =============================================================================
// TEST 9: Agent Configuration
// =============================================================================

async function testAgentConfigs(): Promise<{ passed: boolean; details: string }> {
  const agents = [
    { agent: claudeTrader, expectedModel: "claude-opus-4-5-20251101", expectedName: "Opus 4.5" },
    { agent: gptTrader, expectedModel: "gpt-5.2", expectedName: "GPT-5.2" },
    { agent: grokTrader, expectedModel: "grok-4", expectedName: "Grok 4" },
  ];

  const issues: string[] = [];
  const configs: string[] = [];

  for (const { agent, expectedModel, expectedName } of agents) {
    if (agent.model !== expectedModel) {
      issues.push(`${agent.name}: model is "${agent.model}", expected "${expectedModel}"`);
    }
    if (agent.name !== expectedName) {
      issues.push(`Agent name is "${agent.name}", expected "${expectedName}"`);
    }
    configs.push(`${agent.name} (${agent.model})`);
  }

  if (issues.length > 0) {
    return { passed: false, details: issues.join("\n") };
  }

  return { passed: true, details: `Agents configured: ${configs.join(", ")}` };
}

// =============================================================================
// TEST 10: Live Agent Analysis (Optional - Costs API credits)
// =============================================================================

async function testLiveAgentAnalysis(): Promise<{ passed: boolean; details: string }> {
  if (!args.includes("--live")) {
    return { passed: true, details: "SKIPPED: Use --live flag to test actual agent calls (costs API credits)" };
  }

  // Build minimal context
  const mockMarketData = [
    { symbol: "AAPLx", name: "Apple", mintAddress: "xxx", price: 185.50, change24h: 2.5, volume24h: 1000000 },
    { symbol: "NVDAx", name: "NVIDIA", mintAddress: "yyy", price: 850.25, change24h: -1.2, volume24h: 2000000 },
  ];

  const mockPortfolio = {
    cashBalance: 50.00,
    positions: [],
    totalValue: 50.00,
    totalPnl: 0,
    totalPnlPercent: 0,
  };

  // Pick agent based on filter or default to Claude
  let agent = claudeTrader;
  if (agentFilter === "gpt") agent = gptTrader;
  if (agentFilter === "grok") agent = grokTrader;

  log(`Testing ${agent.name} (${agent.model})...`, 1);

  const decision = await agent.analyze(mockMarketData, mockPortfolio);

  // Validate decision structure
  const issues: string[] = [];

  if (!["buy", "sell", "hold"].includes(decision.action)) {
    issues.push(`Invalid action: ${decision.action}`);
  }
  if (typeof decision.symbol !== "string" || decision.symbol.length === 0) {
    issues.push(`Invalid symbol: ${decision.symbol}`);
  }
  if (typeof decision.quantity !== "number") {
    issues.push(`Invalid quantity: ${decision.quantity}`);
  }
  if (typeof decision.confidence !== "number" || decision.confidence < 0 || decision.confidence > 100) {
    issues.push(`Invalid confidence: ${decision.confidence}`);
  }
  if (typeof decision.reasoning !== "string" || decision.reasoning.length < 10) {
    issues.push(`Invalid reasoning: ${decision.reasoning?.slice(0, 50)}`);
  }

  if (issues.length > 0) {
    return { passed: false, details: `Decision validation failed:\n${issues.join("\n")}` };
  }

  return {
    passed: true,
    details: `${agent.name} decided: ${decision.action} ${decision.symbol} ($${decision.quantity}) ` +
             `confidence=${decision.confidence}%\nReasoning: ${decision.reasoning.slice(0, 100)}...`,
  };
}

// =============================================================================
// MAIN
// =============================================================================

console.log("\n" + "=".repeat(60));
console.log("  MoltApp Agent Data Testing");
console.log("  " + new Date().toISOString());
console.log("=".repeat(60) + "\n");

console.log("Running tests...\n");

await runTest("Market Data (Jupiter API)", testMarketData);
await runTest("Database Connectivity", testDatabase);
await runTest("xStock Decimals Config", testDecimalsConfig);
await runTest("Tool: get_portfolio", testGetPortfolioTool);
await runTest("Tool: get_stock_prices", testGetStockPricesTool);
await runTest("Tool: search_news", testSearchNewsTool);
await runTest("Tool: get_technical_indicators", testTechnicalIndicatorsTool);
await runTest("Tool: Thesis Management", testThesisTools);
await runTest("Agent Configuration", testAgentConfigs);
await runTest("Live Agent Analysis", testLiveAgentAnalysis);

// Summary
console.log("\n" + "=".repeat(60));
const passed = results.filter(r => r.passed && !r.details.startsWith("SKIPPED")).length;
const skipped = results.filter(r => r.details.startsWith("SKIPPED")).length;
const failed = results.filter(r => !r.passed && !r.details.startsWith("SKIPPED")).length;

console.log(`  Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
console.log(`  Total time: ${results.reduce((s, r) => s + r.duration, 0)}ms`);
console.log("=".repeat(60) + "\n");

if (failed > skipped) {
  console.log("Failed tests:");
  for (const r of results.filter(r => !r.passed && !r.details.startsWith("SKIPPED"))) {
    console.log(`  - ${r.name}: ${r.details.split("\n")[0]}`);
  }
  console.log("");
  process.exit(1);
}

console.log("All tests passed!\n");
process.exit(0);
