#!/usr/bin/env npx tsx
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
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

const { db } = await import("../src/db/index.ts");
const { positions, trades, agents } = await import("../src/db/schema/index.ts");
const { eq } = await import("drizzle-orm");
const { getOnChainPortfolio } = await import("../src/services/onchain-portfolio.ts");
const { getAgentPortfolio } = await import("../src/agents/orchestrator.ts");
const { transactions } = await import("../src/db/schema/transactions.ts");
const { getLeaderboard } = await import("../src/services/leaderboard.ts");
const { sql } = await import("drizzle-orm");

const MOCK_PRICES: Record<string, number> = {
  AAPLx: 178, GOOGLx: 175, MSFTx: 415, NVDAx: 131, AMZNx: 178, METAx: 505, TSLAx: 245,
};

const agentId = "claude-value-investor";

console.log("=== Database Positions for Opus 4.5 ===");
const pos = await db.select().from(positions).where(eq(positions.agentId, agentId));
let dbPositionsValue = 0;
for (const p of pos) {
  const qty = parseFloat(p.quantity);
  const mockPrice = MOCK_PRICES[p.symbol] ?? 100;
  const value = qty * mockPrice;
  dbPositionsValue += value;
  console.log(`  ${p.symbol}: qty=${qty.toFixed(6)}, mockPrice=$${mockPrice}, value=$${value.toFixed(2)}`);
}
console.log(`  TOTAL DB POSITIONS VALUE: $${dbPositionsValue.toFixed(2)}`);

console.log("\n=== Database Trades (Cash Calculation) ===");
const agentTrades = await db.select().from(trades).where(eq(trades.agentId, agentId));
let cashBalance = 50; // Initial capital
let totalBuys = 0;
let totalSells = 0;
for (const t of agentTrades) {
  if (t.side === "buy") {
    totalBuys += parseFloat(t.usdcAmount);
    cashBalance -= parseFloat(t.usdcAmount);
  } else if (t.side === "sell") {
    totalSells += parseFloat(t.usdcAmount);
    cashBalance += parseFloat(t.usdcAmount);
  }
}
console.log(`  Initial Capital: $50`);
console.log(`  Total Buys: $${totalBuys.toFixed(2)}`);
console.log(`  Total Sells: $${totalSells.toFixed(2)}`);
console.log(`  Calculated Cash: $${cashBalance.toFixed(2)}`);

console.log("\n=== Expected Total ===");
console.log(`  Positions: $${dbPositionsValue.toFixed(2)}`);
console.log(`  Cash: $${cashBalance.toFixed(2)}`);
console.log(`  EXPECTED TOTAL: $${(dbPositionsValue + cashBalance).toFixed(2)}`);

console.log("\n=== On-Chain Portfolio Service ===");
try {
  const onChain = await getOnChainPortfolio(agentId);
  console.log(`  Cash Balance: $${onChain.cashBalance.toFixed(2)}`);
  console.log(`  Positions:`);
  for (const p of onChain.positions) {
    console.log(`    ${p.symbol}: qty=${p.quantity.toFixed(6)}, price=$${p.currentPrice.toFixed(2)}, value=$${p.value.toFixed(2)}`);
  }
  console.log(`  Total Value: $${onChain.totalValue.toFixed(2)}`);
  console.log(`  Total PnL: $${onChain.totalPnl.toFixed(2)} (${onChain.totalPnlPercent.toFixed(2)}%)`);
} catch (e) {
  console.log(`  ERROR: ${e}`);
}

console.log("\n=== getAgentPortfolio() (used by UI) ===");
try {
  const portfolio = await getAgentPortfolio(agentId);
  console.log(`  Cash Balance: $${portfolio.cashBalance.toFixed(2)}`);
  console.log(`  Positions:`);
  for (const p of portfolio.positions) {
    console.log(`    ${p.symbol}: qty=${p.quantity.toFixed(6)}, price=$${p.currentPrice.toFixed(2)}, value=$${(p.quantity * p.currentPrice).toFixed(2)}`);
  }
  console.log(`  Total Value: $${portfolio.totalValue.toFixed(2)}`);
  console.log(`  Total PnL: $${portfolio.totalPnl.toFixed(2)} (${portfolio.totalPnlPercent.toFixed(2)}%)`);
} catch (e) {
  console.log(`  ERROR: ${e}`);
}

console.log("\n=== Transactions Table (deposits/withdrawals) ===");
const txns = await db.select().from(transactions).where(eq(transactions.agentId, agentId));
console.log(`  Total transactions: ${txns.length}`);
for (const t of txns) {
  console.log(`    ${t.type}: ${t.tokenType} ${t.amount} (status: ${t.status})`);
}

console.log("\n=== Leaderboard Data ===");
try {
  const leaderboard = await getLeaderboard();
  const entry = leaderboard.entries.find((e: { agentId: string }) => e.agentId === agentId);
  if (entry) {
    console.log(`  Agent: ${entry.agentName}`);
    console.log(`  Portfolio Value: $${entry.totalPortfolioValue}`);
    console.log(`  Stocks Value: $${entry.stocksValue}`);
    console.log(`  PnL: ${entry.totalPnlPercent}% ($${entry.totalPnlAbsolute})`);
    console.log(`  Top Positions:`);
    for (const p of entry.topPositions || []) {
      console.log(`    ${p.symbol}: qty=${p.quantity.toFixed(6)}, price=$${p.currentPrice.toFixed(2)}, value=$${p.value.toFixed(2)}`);
    }
  } else {
    console.log(`  Agent not found in leaderboard`);
  }
} catch (e) {
  console.log(`  ERROR: ${e}`);
}

process.exit(0);
