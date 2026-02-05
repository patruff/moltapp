#!/usr/bin/env npx tsx
/**
 * Dry Run — Test all 3 flagship agents without executing trades
 *
 * Shows:
 * - All tool calls and their results
 * - The data each agent receives
 * - What they would decide to trade
 *
 * Usage:
 *   npx tsx scripts/dry-run.ts
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

// Force paper mode (no real trades)
process.env.TRADING_MODE = "paper";

const { claudeTrader } = await import("../src/agents/claude-trader.ts");
const { gptTrader } = await import("../src/agents/gpt-trader.ts");
const { grokTrader } = await import("../src/agents/grok-trader.ts");
const { XSTOCKS_CATALOG } = await import("../src/config/constants.ts");
const { db } = await import("../src/db/index.ts");
const { positions } = await import("../src/db/schema/positions.ts");
const { eq } = await import("drizzle-orm");

// Fetch live prices from Jupiter
async function fetchLivePrices(): Promise<Map<string, number>> {
  const jupiterApiKey = process.env.JUPITER_API_KEY;
  const headers: Record<string, string> = {};
  if (jupiterApiKey) headers["x-api-key"] = jupiterApiKey;

  const priceMap = new Map<string, number>();
  const batchSize = 20;

  for (let i = 0; i < XSTOCKS_CATALOG.length; i += batchSize) {
    const batch = XSTOCKS_CATALOG.slice(i, i + batchSize);
    const mints = batch.map(s => s.mintAddress).join(",");

    try {
      const res = await fetch(`https://api.jup.ag/price/v3?ids=${mints}`, { headers });
      if (res.ok) {
        const data = await res.json() as Record<string, { usdPrice: number }>;
        for (const [mint, info] of Object.entries(data)) {
          if (info?.usdPrice) priceMap.set(mint, info.usdPrice);
        }
      }
    } catch (err) {
      console.warn(`  [Warning] Price fetch failed for batch ${i}: ${err}`);
    }
  }

  return priceMap;
}

// Build market data from prices
function buildMarketData(priceMap: Map<string, number>) {
  return XSTOCKS_CATALOG.map(stock => ({
    symbol: stock.symbol,
    name: stock.name,
    mintAddress: stock.mintAddress,
    price: priceMap.get(stock.mintAddress) ?? 100,
    change24h: null,
    volume24h: null,
  }));
}

// Build portfolio context for an agent
async function buildPortfolioContext(agentId: string, marketData: any[]) {
  const agentPositions = await db.select().from(positions).where(eq(positions.agentId, agentId));

  let stocksValue = 0;
  const positionData = agentPositions.map(p => {
    const md = marketData.find(m => m.symbol === p.symbol);
    const currentPrice = md?.price ?? 100;
    const qty = parseFloat(p.quantity);
    const costBasis = parseFloat(p.averageCostBasis);
    const value = qty * currentPrice;
    const unrealizedPnl = value - (qty * costBasis);
    const unrealizedPnlPercent = costBasis > 0 ? (unrealizedPnl / (qty * costBasis)) * 100 : 0;
    stocksValue += value;

    return {
      symbol: p.symbol,
      quantity: qty,
      averageCostBasis: costBasis,
      currentPrice,
      unrealizedPnl,
      unrealizedPnlPercent,
    };
  });

  // Assume $50 starting cash for new agents
  const cashBalance = 50 - stocksValue;

  return {
    cashBalance: Math.max(0, cashBalance),
    positions: positionData,
    totalValue: cashBalance + stocksValue,
    totalPnl: 0,
    totalPnlPercent: 0,
  };
}

// Run dry run for all agents
async function runDryRun() {
  console.log("\n" + "=".repeat(70));
  console.log("  MOLTAPP DRY RUN — Flagship Agent Test");
  console.log("  " + new Date().toISOString());
  console.log("  Mode: PAPER (no real trades)");
  console.log("=".repeat(70) + "\n");

  // Fetch live prices
  console.log("📊 Fetching live prices from Jupiter...\n");
  const priceMap = await fetchLivePrices();
  console.log(`  ✓ Fetched ${priceMap.size} prices\n`);

  // Show sample prices
  const samplePrices = XSTOCKS_CATALOG.slice(0, 10).map(s => {
    const price = priceMap.get(s.mintAddress);
    return `  ${s.symbol.padEnd(8)} $${price?.toFixed(2) ?? "N/A"}`;
  }).join("\n");
  console.log("  Sample prices:\n" + samplePrices + "\n");

  // Build market data
  const marketData = buildMarketData(priceMap);

  // Test each agent
  const agents = [
    { agent: claudeTrader, name: "Opus 4.5" },
    { agent: gptTrader, name: "GPT-5.2" },
    { agent: grokTrader, name: "Grok 4" },
  ];

  for (const { agent, name } of agents) {
    console.log("\n" + "─".repeat(70));
    console.log(`  🤖 ${name} (${agent.model})`);
    console.log("─".repeat(70) + "\n");

    // Build portfolio
    const portfolio = await buildPortfolioContext(agent.agentId, marketData);
    console.log("  Portfolio:");
    console.log(`    Cash: $${portfolio.cashBalance.toFixed(2)}`);
    console.log(`    Positions: ${portfolio.positions.length}`);
    if (portfolio.positions.length > 0) {
      for (const p of portfolio.positions) {
        console.log(`      ${p.symbol}: ${p.quantity.toFixed(6)} @ $${p.currentPrice.toFixed(2)} (${p.unrealizedPnlPercent >= 0 ? "+" : ""}${p.unrealizedPnlPercent.toFixed(1)}%)`);
      }
    }
    console.log(`    Total Value: $${portfolio.totalValue.toFixed(2)}\n`);

    // Run agent
    console.log("  Running agent analysis...\n");
    const startTime = Date.now();

    try {
      const decision = await agent.analyze(marketData, portfolio);
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);

      console.log("\n  📋 DECISION:");
      console.log(`    Action: ${decision.action.toUpperCase()}`);
      console.log(`    Symbol: ${decision.symbol}`);
      console.log(`    Quantity: ${decision.action === "buy" ? "$" : ""}${decision.quantity}`);
      console.log(`    Confidence: ${decision.confidence}%`);
      console.log(`    Intent: ${decision.intent ?? "N/A"}`);
      console.log(`    Thesis Status: ${decision.thesisStatus ?? "N/A"}`);
      console.log(`\n  📝 REASONING:`);
      console.log(`    ${decision.reasoning.slice(0, 500)}${decision.reasoning.length > 500 ? "..." : ""}`);
      console.log(`\n  ⏱️ Time: ${duration}s`);
      console.log(`  📡 Sources: ${decision.sources?.join(", ") ?? "N/A"}`);

    } catch (err) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\n  ❌ ERROR after ${duration}s:`);
      console.log(`    ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log("  DRY RUN COMPLETE");
  console.log("=".repeat(70) + "\n");
}

runDryRun().then(() => process.exit(0)).catch(err => {
  console.error("Dry run failed:", err);
  process.exit(1);
});
