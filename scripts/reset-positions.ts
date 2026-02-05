#!/usr/bin/env npx tsx
/**
 * Reset all positions and trades due to decimal calculation bug.
 *
 * The xStocks tokens have 8 decimals, but our code was using 9.
 * This caused prices to be recorded 10x too high.
 *
 * This script:
 * 1. Deletes all positions
 * 2. Deletes all trades
 * 3. Resets agent theses (optional - keeping history is valuable)
 *
 * Agents will start fresh with their deposited USDC.
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
const { positions } = await import("../src/db/schema/positions.ts");
const { trades } = await import("../src/db/schema/trades.ts");
const { agentTheses } = await import("../src/db/schema/agent-theses.ts");

console.log("\n=== RESETTING POSITIONS & TRADES ===\n");
console.log("This will clear all positions and trades due to the decimals bug.");
console.log("Agents will start fresh with their deposited USDC.\n");

// Count before deletion
const posCount = await db.select().from(positions);
const tradeCount = await db.select().from(trades);
const thesesCount = await db.select().from(agentTheses);

console.log(`Current state:`);
console.log(`  Positions: ${posCount.length}`);
console.log(`  Trades: ${tradeCount.length}`);
console.log(`  Theses: ${thesesCount.length}\n`);

// Delete positions
console.log("Deleting all positions...");
await db.delete(positions);
console.log("  ✓ Positions deleted");

// Delete trades
console.log("Deleting all trades...");
await db.delete(trades);
console.log("  ✓ Trades deleted");

// Delete theses (since they reference positions with wrong prices)
console.log("Deleting all theses (references to invalid positions)...");
await db.delete(agentTheses);
console.log("  ✓ Theses deleted");

console.log("\n=== RESET COMPLETE ===");
console.log("Agents will start fresh on the next trading round.");
console.log("Make sure to deploy the fixed code (decimals: 8) first!\n");

process.exit(0);
