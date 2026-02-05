#!/usr/bin/env npx tsx
/**
 * Check recent trade justifications with tool traces.
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
const { tradeJustifications } = await import("../src/db/schema/trade-reasoning.ts");
const { desc } = await import("drizzle-orm");

const recent = await db.select().from(tradeJustifications).orderBy(desc(tradeJustifications.timestamp)).limit(5);
console.log(`\n=== RECENT JUSTIFICATIONS (${recent.length}) ===`);
for (const j of recent) {
  console.log(`\n[${j.agentId}] ${j.action} ${j.symbol} @ ${j.timestamp}`);
  console.log(`  Confidence: ${j.confidence}`);
  console.log(`  Model: ${j.modelUsed || 'unknown'}`);
  const reasoning = j.reasoning || 'No reasoning';
  console.log(`  Reasoning: ${reasoning.slice(0, 300)}...`);
  if (j.toolTrace) {
    const trace = j.toolTrace as any[];
    console.log(`  Tool calls: ${trace.length}`);
    for (const t of trace.slice(0, 5)) {
      console.log(`    - ${t.tool}(${JSON.stringify(t.arguments).slice(0, 60)})`);
    }
    if (trace.length > 5) console.log(`    ... and ${trace.length - 5} more`);
  }
}

process.exit(0);
