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
const { sql } = await import("drizzle-orm");

const tables = [
  "agents", "trades", "positions", "transactions",
  "trade_justifications", "agent_decisions",
  "outcome_resolutions", "benchmark_leaderboard_v23",
];

for (const t of tables) {
  try {
    const r = await db.execute(sql.raw(`SELECT COUNT(*) as count FROM ${t}`));
    console.log(`${t}: ${(r.rows[0] as any).count} rows`);
  } catch {
    console.log(`${t}: table not found`);
  }
}
process.exit(0);
