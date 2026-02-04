#!/usr/bin/env npx tsx
/**
 * Quick DB state check — agents, trades, positions.
 */
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
const { agents } = await import("../src/db/schema/agents.ts");
const { trades } = await import("../src/db/schema/trades.ts");
const { positions } = await import("../src/db/schema/positions.ts");

const allAgents = await db.select().from(agents);
console.log(`\n=== AGENTS (${allAgents.length}) ===`);
for (const a of allAgents) {
  console.log(`  ${a.id} | ${a.name} | isActive=${a.isActive}`);
}

const allTrades = await db.select().from(trades);
console.log(`\n=== TRADES (${allTrades.length}) ===`);
for (const t of allTrades) {
  console.log(`  #${t.id} | ${t.agentId} | ${t.side} ${t.stockSymbol} | $${t.usdcAmount} | ${t.status} | ${t.txSignature?.slice(0, 20)}...`);
}

const allPositions = await db.select().from(positions);
console.log(`\n=== POSITIONS (${allPositions.length}) ===`);
for (const p of allPositions) {
  console.log(`  ${p.agentId} | ${p.symbol} | qty=${p.quantity} | cost=${p.averageCostBasis}`);
}

process.exit(0);
