#!/usr/bin/env npx tsx
/**
 * MoltApp Trading Heartbeat
 *
 * Runs trading rounds on a 30-minute interval, matching the EventBridge schedule.
 * Use this for local development / hackathon demos.
 *
 * Usage:
 *   npx tsx scripts/heartbeat.ts                  # Default: 30 min interval
 *   npx tsx scripts/heartbeat.ts --interval 10    # 10 min interval
 *   npx tsx scripts/heartbeat.ts --once            # Single round then exit
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env BEFORE dynamic imports
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
const { syncToHuggingFace } = await import("./hf-sync-lib.ts");

// Parse CLI args
const args = process.argv.slice(2);
const once = args.includes("--once");
const intervalIdx = args.indexOf("--interval");
const intervalMinutes = intervalIdx >= 0 ? parseInt(args[intervalIdx + 1]) : 120;
const intervalMs = intervalMinutes * 60 * 1000;

let roundCount = 0;
let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 5;

async function executeRound() {
  roundCount++;
  const mode = process.env.TRADING_MODE ?? "paper";
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Heartbeat Round #${roundCount} — ${new Date().toISOString()}`);
  console.log(`  Mode: ${mode} | Interval: ${intervalMinutes}min`);
  console.log(`${"=".repeat(60)}\n`);

  try {
    const result = await runTradingRound();

    const executed = result.results.filter((r) => r.executed).length;
    const failed = result.results.filter((r) => r.executionError).length;

    console.log(`\n  Round ${result.roundId}:`);
    for (const r of result.results) {
      const status = r.executed ? "OK" : r.executionError ? "FAIL" : "SKIP";
      const txUrl = r.executionDetails?.txSignature
        ? `https://solscan.io/tx/${r.executionDetails.txSignature}`
        : "";
      console.log(
        `    [${status}] ${r.agentName}: ${r.decision.action} ${r.decision.symbol} ` +
          `$${r.decision.quantity} (${r.decision.confidence}%)` +
          (txUrl ? `\n         ${txUrl}` : "") +
          (r.executionError ? `\n         Error: ${r.executionError.slice(0, 100)}` : ""),
      );
    }

    console.log(
      `\n  Summary: ${executed} executed, ${failed} failed, ` +
        `${result.circuitBreakerActivations.length} circuit breakers, ` +
        `${result.errors.length} errors`,
    );

    consecutiveFailures = 0;

    // Sync benchmark data to HuggingFace after each successful round
    try {
      const synced = await syncToHuggingFace();
      if (synced > 0) console.log(`  HuggingFace: synced ${synced} benchmark records`);
    } catch (hfErr) {
      console.warn(`  HuggingFace sync failed (non-critical): ${hfErr instanceof Error ? hfErr.message : String(hfErr)}`);
    }
  } catch (err) {
    consecutiveFailures++;
    console.error(
      `\n  Round FAILED (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}):`,
      err instanceof Error ? err.message : String(err),
    );

    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      console.error(`\n  Too many consecutive failures. Stopping heartbeat.`);
      process.exit(1);
    }
  }
}

// Run first round immediately
await executeRound();

if (once) {
  console.log("\n  --once flag set. Exiting.\n");
  process.exit(0);
}

// Schedule recurring rounds
console.log(`\n  Next round in ${intervalMinutes} minutes...`);
console.log(`  Press Ctrl+C to stop.\n`);

setInterval(async () => {
  await executeRound();
  console.log(`\n  Next round in ${intervalMinutes} minutes...`);
}, intervalMs);
