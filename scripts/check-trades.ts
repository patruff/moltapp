#!/usr/bin/env npx tsx
/**
 * Check trade records for a specific stock
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
const { trades } = await import("../src/db/schema/trades.ts");
const { positions } = await import("../src/db/schema/positions.ts");
const { eq } = await import("drizzle-orm");

// Check MSFTx trades
const msftTrades = await db.select().from(trades).where(eq(trades.stockSymbol, "MSFTx"));
console.log("\n=== MSFTx TRADES ===");
for (const t of msftTrades) {
  console.log(`  #${t.id} | ${t.side} | qty=${t.stockQuantity} | usdc=${t.usdcAmount} | price=${t.pricePerToken}`);
}

// Check all positions
const allPos = await db.select().from(positions);
console.log("\n=== ALL POSITIONS (with calculated total cost) ===");
for (const p of allPos) {
  const qty = parseFloat(p.quantity);
  const cost = parseFloat(p.averageCostBasis);
  const totalCost = qty * cost;
  console.log(`  ${p.agentId} | ${p.symbol} | qty=${qty.toFixed(9)} | costBasis=${cost.toFixed(2)} | totalCost=$${totalCost.toFixed(2)}`);
}

process.exit(0);
