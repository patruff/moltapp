#!/usr/bin/env npx tsx
/**
 * Run a single trading round via the orchestrator.
 *
 * This exercises the full production path: pre-round gate, all 3 agents,
 * circuit breakers, trade execution, benchmark recording.
 *
 * Usage:
 *   npx tsx scripts/run-round.ts
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

const { runTradingRound } = await import("../src/agents/orchestrator.ts");

console.log("\n============================================================");
console.log("  MoltApp Orchestrator — Manual Round");
console.log(`  Mode: ${process.env.TRADING_MODE ?? "paper"}`);
console.log(`  Time: ${new Date().toISOString()}`);
console.log("============================================================\n");

try {
  const result = await runTradingRound();

  console.log("\n============================================================");
  console.log("  ROUND RESULTS");
  console.log("============================================================");
  console.log(`  Round ID: ${result.roundId}`);
  console.log(`  Lock skipped: ${result.lockSkipped}`);
  console.log(`  Errors: ${result.errors.length}`);
  console.log(`  Circuit breaker activations: ${result.circuitBreakerActivations.length}`);
  console.log("");

  for (const r of result.results) {
    const exec = r.executed ? "EXECUTED" : "SKIPPED";
    const err = r.executionError ? ` (${r.executionError.slice(0, 80)})` : "";
    const tx = r.executionDetails?.txSignature
      ? `\n    TX: https://solscan.io/tx/${r.executionDetails.txSignature}`
      : "";
    console.log(
      `  ${r.agentName}: ${r.decision.action.toUpperCase()} ${r.decision.symbol} ` +
        `$${r.decision.quantity} (${r.decision.confidence}%) — ${exec}${err}${tx}`,
    );
  }

  if (result.errors.length > 0) {
    console.log("\n  Errors:");
    for (const e of result.errors) {
      console.log(`    - ${e}`);
    }
  }
  console.log("");
} catch (err) {
  console.error("Round failed:", err);
  process.exit(1);
}
