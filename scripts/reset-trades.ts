#!/usr/bin/env npx tsx
/**
 * Reset all trades and positions — fresh start for the dashboard.
 * Keeps agents table intact.
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
const { sql } = await import("drizzle-orm");

// Also clear trade_justifications and agent_decisions if they exist
try {
  await db.execute(sql`DELETE FROM trade_justifications`);
  console.log("Cleared trade_justifications");
} catch { console.log("No trade_justifications table (ok)"); }

try {
  await db.execute(sql`DELETE FROM agent_decisions`);
  console.log("Cleared agent_decisions");
} catch { console.log("No agent_decisions table (ok)"); }

const deletedTrades = await db.delete(trades);
console.log("Cleared trades table");

const deletedPositions = await db.delete(positions);
console.log("Cleared positions table");

// Clear any transaction records
try {
  await db.execute(sql`DELETE FROM transactions`);
  console.log("Cleared transactions");
} catch { console.log("No transactions table (ok)"); }

console.log("\nDone! Dashboard will start fresh from next trading round.");
process.exit(0);
