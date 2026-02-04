#!/usr/bin/env npx tsx
/**
 * Sync MoltApp benchmark data to HuggingFace as a dataset.
 * Combines trade justifications + agent decisions into JSONL,
 * then uploads to patruff/molt-benchmark.
 *
 * Usage: npx tsx scripts/sync-to-hf.ts
 * Requires: HF_TOKEN environment variable
 */
import { writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";
import { uploadFile } from "@huggingface/hub";
import { desc } from "drizzle-orm";

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

const HF_TOKEN = process.env.HF_TOKEN;
if (!HF_TOKEN) {
  console.error("ERROR: HF_TOKEN environment variable is required.");
  console.error("Get a token at https://huggingface.co/settings/tokens");
  process.exit(1);
}

console.log("[sync-to-hf] Connecting to database...");
const { db } = await import("../src/db/index.ts");
const { tradeJustifications } = await import("../src/db/schema/trade-reasoning.ts");
const { agentDecisions } = await import("../src/db/schema/agent-decisions.ts");

console.log("[sync-to-hf] Fetching trade justifications...");
const justifications = await db.select().from(tradeJustifications).orderBy(desc(tradeJustifications.timestamp));

console.log("[sync-to-hf] Fetching agent decisions...");
const decisions = await db.select().from(agentDecisions).orderBy(desc(agentDecisions.createdAt));

// Build lookup from decisions keyed by agentId+roundId+symbol for enrichment
const decisionMap = new Map<string, (typeof decisions)[number]>();
for (const d of decisions) {
  decisionMap.set(`${d.agentId}|${d.roundId}|${d.symbol}`, d);
}

// Merge justifications with decision data into benchmark records (v32: 24-dimension)
const records = justifications.map((j) => {
  const d = decisionMap.get(`${j.agentId}|${j.roundId}|${j.symbol}`);
  return {
    agent_id: j.agentId,
    agent_action: j.action,
    symbol: j.symbol,
    quantity: j.quantity ?? d?.quantity ?? null,
    reasoning: j.reasoning,
    confidence: j.confidence,
    sources: j.sources ?? [],
    intent: j.intent,
    predicted_outcome: j.predictedOutcome ?? null,
    actual_outcome: j.actualOutcome ?? null,
    coherence_score: j.coherenceScore ?? null,
    hallucination_flags: j.hallucinationFlags ?? [],
    discipline_pass: j.disciplinePass ?? "pending",
    round_id: j.roundId ?? null,
    timestamp: j.timestamp?.toISOString() ?? null,
    benchmark_version: "32.0",
    dimension_count: 24,
  };
});

if (records.length === 0) {
  console.log("[sync-to-hf] No benchmark data found. Nothing to upload.");
  process.exit(0);
}

console.log(`[sync-to-hf] Formatted ${records.length} benchmark records.`);

// Write JSONL to temp file
const jsonlPath = join(tmpdir(), "molt-benchmark.jsonl");
const jsonl = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
writeFileSync(jsonlPath, jsonl);
console.log(`[sync-to-hf] Wrote JSONL to ${jsonlPath} (${(Buffer.byteLength(jsonl) / 1024).toFixed(1)} KB)`);

const repo = { type: "dataset" as const, name: "patruff/molt-benchmark" };
const credentials = { accessToken: HF_TOKEN };

// Upload JSONL data file (both canonical and auto-detect paths)
console.log("[sync-to-hf] Uploading benchmark data...");
const jsonlBlob = new Blob([readFileSync(jsonlPath)]);
await uploadFile({
  repo,
  credentials,
  file: { path: "data/molt-benchmark.jsonl", content: jsonlBlob },
  commitTitle: `Update benchmark data (${records.length} records)`,
});
console.log("[sync-to-hf] Uploaded data/molt-benchmark.jsonl");

// Also upload as train.jsonl for HF auto-detection
await uploadFile({
  repo,
  credentials,
  file: { path: "data/train.jsonl", content: new Blob([readFileSync(jsonlPath)]) },
  commitTitle: `Update train split (${records.length} records)`,
});
console.log("[sync-to-hf] Uploaded data/train.jsonl");

// Build and upload dataset card
const datasetCard = `---
license: mit
task_categories:
  - text-generation
language:
  - en
tags:
  - finance
  - benchmark
  - agentic-ai
  - stock-trading
size_categories:
  - 1K<n<10K
configs:
  - config_name: default
    data_files:
      - split: train
        path: data/train.jsonl
---

# MoltApp: Agentic Stock Trading Benchmark

A benchmark dataset capturing how AI agents reason about stock trades in a
simulated live-market environment. Each record pairs an agent's **reasoning,
confidence, and predicted outcome** with the **actual result** and automated
quality scores.

## Columns

| Column | Description |
|---|---|
| \`agent_id\` | Unique AI agent identifier (e.g. \`claude-value-investor\`) |
| \`agent_action\` | Action taken: buy, sell, or hold |
| \`symbol\` | Stock / token symbol |
| \`quantity\` | Trade size (USDC for buys, shares for sells) |
| \`reasoning\` | Free-text step-by-step reasoning the agent produced |
| \`confidence\` | Self-reported confidence (0-1) |
| \`sources\` | Data sources cited in the reasoning |
| \`intent\` | Classified trading intent |
| \`predicted_outcome\` | What the agent expected to happen |
| \`actual_outcome\` | What actually happened (filled post-trade) |
| \`coherence_score\` | Does reasoning match the action? (0-1) |
| \`hallucination_flags\` | Factual errors found in reasoning |
| \`discipline_pass\` | Whether trading rules were followed |
| \`round_id\` | Trading round identifier |
| \`timestamp\` | ISO-8601 decision timestamp |
| \`benchmark_version\` | Benchmark version (e.g. 32.0) |
| \`dimension_count\` | Number of scoring dimensions (24) |

## Citation

\`\`\`bibtex
@misc{moltapp2026,
  title={MoltApp: Agentic Stock Trading Benchmark},
  author={patruff},
  year={2026},
  url={https://huggingface.co/datasets/patruff/molt-benchmark}
}
\`\`\`
`;

console.log("[sync-to-hf] Uploading dataset card...");
await uploadFile({
  repo,
  credentials,
  file: { path: "README.md", content: new Blob([datasetCard]) },
  commitTitle: "Update dataset card",
});
console.log("[sync-to-hf] Uploaded README.md");

console.log(`[sync-to-hf] Done. ${records.length} records synced to huggingface.co/datasets/patruff/molt-benchmark`);
process.exit(0);
