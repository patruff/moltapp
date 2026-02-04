/**
 * HuggingFace Benchmark Dataset Sync (v23)
 *
 * Exports MoltApp benchmark data as a structured dataset for HuggingFace:
 * 1. Fetches all trades with justifications from the database
 * 2. Joins with outcome resolutions for prediction accuracy data
 * 3. Formats as JSONL benchmark dataset
 * 4. Uploads to patruff/molt-benchmark on HuggingFace Hub
 * 5. Includes eval.yaml for benchmark recognition
 *
 * Usage:
 *   npx tsx scripts/sync-to-hf.ts
 *
 * Environment:
 *   HF_TOKEN — HuggingFace write token
 *   DATABASE_URL — Neon PostgreSQL connection string
 */

import { uploadFile } from "@huggingface/hub";
import { db } from "../src/db/index.ts";
import { tradeJustifications } from "../src/db/schema/trade-reasoning.ts";
import {
  outcomeResolutions,
  benchmarkLeaderboardV23,
} from "../src/db/schema/benchmark-v23.ts";
import { desc, eq, sql } from "drizzle-orm";
import { readFileSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const HF_REPO = "patruff/molt-benchmark";
const HF_TOKEN = process.env.HF_TOKEN ?? "";
const BATCH_SIZE = 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BenchmarkRecord {
  agent_id: string;
  round_id: string | null;
  timestamp: string;
  action: string;
  symbol: string;
  quantity: number | null;
  reasoning: string;
  confidence: number;
  sources: string[];
  intent: string;
  predicted_outcome: string | null;
  coherence_score: number | null;
  hallucination_flags: string[];
  discipline_pass: boolean;
  pnl_percent: number | null;
  direction_correct: boolean | null;
  outcome: string | null;
  composite_score: number | null;
}

// ---------------------------------------------------------------------------
// Data Fetching
// ---------------------------------------------------------------------------

async function fetchBenchmarkData(): Promise<BenchmarkRecord[]> {
  console.log("[HF Sync] Fetching trade justifications from database...");

  const justifications = await db
    .select()
    .from(tradeJustifications)
    .orderBy(desc(tradeJustifications.timestamp))
    .limit(BATCH_SIZE);

  console.log(`[HF Sync] Found ${justifications.length} justifications`);

  // Build outcome lookup
  const outcomes = new Map<string, {
    pnlPercent: number | null;
    directionCorrect: boolean | null;
    outcome: string;
  }>();

  try {
    const resolutions = await db
      .select()
      .from(outcomeResolutions)
      .limit(BATCH_SIZE);

    for (const r of resolutions) {
      outcomes.set(r.justificationId, {
        pnlPercent: r.pnlPercent,
        directionCorrect: r.directionCorrect,
        outcome: r.outcome,
      });
    }
    console.log(`[HF Sync] Found ${resolutions.length} outcome resolutions`);
  } catch (err) {
    console.warn(`[HF Sync] Could not fetch outcomes: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Build leaderboard lookup for composite scores
  const composites = new Map<string, number>();
  try {
    const leaderboard = await db
      .select()
      .from(benchmarkLeaderboardV23)
      .limit(100);

    for (const entry of leaderboard) {
      composites.set(entry.agentId, entry.compositeScore ?? 0);
    }
  } catch {
    // Non-critical
  }

  // Format records
  const records: BenchmarkRecord[] = justifications.map((j) => {
    const outcome = outcomes.get(j.id);
    const hallucinationFlags = (j.hallucinationFlags as string[] | null) ?? [];
    const sources = (j.sources as string[] | null) ?? [];

    return {
      agent_id: j.agentId,
      round_id: j.roundId,
      timestamp: j.timestamp?.toISOString() ?? new Date().toISOString(),
      action: j.action,
      symbol: j.symbol,
      quantity: j.quantity,
      reasoning: j.reasoning,
      confidence: j.confidence,
      sources,
      intent: j.intent,
      predicted_outcome: j.predictedOutcome,
      coherence_score: j.coherenceScore,
      hallucination_flags: hallucinationFlags,
      discipline_pass: j.disciplinePass === "pass",
      pnl_percent: outcome?.pnlPercent ?? null,
      direction_correct: outcome?.directionCorrect ?? null,
      outcome: outcome?.outcome ?? null,
      composite_score: composites.get(j.agentId) ?? null,
    };
  });

  return records;
}

// ---------------------------------------------------------------------------
// JSONL Formatting
// ---------------------------------------------------------------------------

function formatAsJsonl(records: BenchmarkRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

function generateDatasetCard(recordCount: number, agentCount: number): string {
  return `---
dataset_info:
  features:
    - name: agent_id
      dtype: string
    - name: action
      dtype: string
    - name: symbol
      dtype: string
    - name: reasoning
      dtype: string
    - name: confidence
      dtype: float64
    - name: coherence_score
      dtype: float64
    - name: pnl_percent
      dtype: float64
    - name: direction_correct
      dtype: bool
    - name: composite_score
      dtype: float64
  splits:
    - name: train
      num_examples: ${recordCount}
license: mit
task_categories:
  - text-generation
  - text-classification
tags:
  - finance
  - trading
  - benchmark
  - ai-agents
  - reasoning
  - llm-evaluation
---

# MoltApp: Agentic Stock Trading Benchmark

**Live evaluation of AI agents trading tokenized real-world stocks on Solana.**

## Overview

MoltApp is an industry-standard benchmark for evaluating AI agent trading capabilities.
Unlike static benchmarks, MoltApp measures agent intelligence through real trading decisions
with real financial consequences on the Solana blockchain.

## Benchmark Dimensions (v23)

| Metric | Weight | Description |
|--------|--------|-------------|
| P&L Performance | 30% | Return on investment |
| Reasoning Coherence | 20% | Does logic match the trade action? |
| Hallucination-Free Rate | 15% | No fabricated market data |
| Instruction Discipline | 10% | Compliance with trading rules |
| Confidence Calibration | 15% | ECE — confidence predicts outcomes |
| Prediction Accuracy | 10% | Directional prediction correctness |

## Agents

| Agent | Model | Provider | Style |
|-------|-------|----------|-------|
| Claude ValueBot | claude-sonnet-4 | Anthropic | Conservative Value |
| GPT MomentumBot | gpt-4.1 | OpenAI | Aggressive Momentum |
| Grok ContrarianBot | grok-3 | xAI | Contrarian Swing |

## Statistics

- **Total Records**: ${recordCount}
- **Agents**: ${agentCount}
- **Last Updated**: ${new Date().toISOString().split("T")[0]}

## Citation

\`\`\`bibtex
@misc{moltapp2026,
  title={MoltApp: An Agentic Stock Trading Benchmark for LLMs},
  author={Patrick Ruff},
  year={2026},
  url={https://www.patgpt.us}
}
\`\`\`

## Links

- Website: [www.patgpt.us](https://www.patgpt.us)
- Benchmark Dashboard: [www.patgpt.us/benchmark-v23](https://www.patgpt.us/benchmark-v23)
`;
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

async function uploadToHuggingFace(
  records: BenchmarkRecord[],
): Promise<void> {
  if (!HF_TOKEN) {
    console.log("[HF Sync] No HF_TOKEN set — writing files locally instead");
    const { writeFileSync, mkdirSync } = await import("fs");
    const outDir = join(process.cwd(), "hf-export");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "data.jsonl"), formatAsJsonl(records));
    const agents = new Set(records.map((r) => r.agent_id));
    writeFileSync(
      join(outDir, "README.md"),
      generateDatasetCard(records.length, agents.size),
    );

    // Copy eval.yaml
    try {
      const evalYaml = readFileSync(join(process.cwd(), "eval.yaml"), "utf-8");
      writeFileSync(join(outDir, "eval.yaml"), evalYaml);
    } catch {
      console.warn("[HF Sync] eval.yaml not found, skipping");
    }

    console.log(`[HF Sync] Exported ${records.length} records to ${outDir}/`);
    return;
  }

  console.log(`[HF Sync] Uploading ${records.length} records to ${HF_REPO}...`);

  const agents = new Set(records.map((r) => r.agent_id));

  // Upload data.jsonl
  const jsonlBlob = new Blob([formatAsJsonl(records)], { type: "text/plain" });
  await uploadFile({
    repo: HF_REPO,
    credentials: { accessToken: HF_TOKEN },
    file: { content: jsonlBlob, path: "data/benchmark.jsonl" },
    commitTitle: `Update benchmark data: ${records.length} records`,
  });

  // Upload README.md
  const readmeBlob = new Blob(
    [generateDatasetCard(records.length, agents.size)],
    { type: "text/markdown" },
  );
  await uploadFile({
    repo: HF_REPO,
    credentials: { accessToken: HF_TOKEN },
    file: { content: readmeBlob, path: "README.md" },
    commitTitle: "Update dataset card",
  });

  // Upload eval.yaml
  try {
    const evalYaml = readFileSync(join(process.cwd(), "eval.yaml"), "utf-8");
    const evalBlob = new Blob([evalYaml], { type: "text/yaml" });
    await uploadFile({
      repo: HF_REPO,
      credentials: { accessToken: HF_TOKEN },
      file: { content: evalBlob, path: "eval.yaml" },
      commitTitle: "Update eval.yaml benchmark spec",
    });
  } catch {
    console.warn("[HF Sync] eval.yaml not found, skipping");
  }

  console.log(`[HF Sync] Upload complete: ${records.length} records to ${HF_REPO}`);
}

// ---------------------------------------------------------------------------
// Summary Report
// ---------------------------------------------------------------------------

function printSummary(records: BenchmarkRecord[]): void {
  const agents = new Map<string, { trades: number; avgCoherence: number; avgConfidence: number }>();

  for (const r of records) {
    const existing = agents.get(r.agent_id) ?? { trades: 0, avgCoherence: 0, avgConfidence: 0 };
    existing.trades++;
    existing.avgCoherence += r.coherence_score ?? 0;
    existing.avgConfidence += r.confidence;
    agents.set(r.agent_id, existing);
  }

  console.log("\n=== MoltApp Benchmark Dataset Summary ===\n");
  console.log(`Total records: ${records.length}`);
  console.log(`Agents: ${agents.size}\n`);

  for (const [agentId, stats] of agents) {
    console.log(`  ${agentId}:`);
    console.log(`    Trades: ${stats.trades}`);
    console.log(`    Avg Coherence: ${(stats.avgCoherence / stats.trades).toFixed(2)}`);
    console.log(`    Avg Confidence: ${(stats.avgConfidence / stats.trades).toFixed(2)}`);
  }

  const withOutcomes = records.filter((r) => r.outcome !== null);
  console.log(`\nOutcome resolutions: ${withOutcomes.length} / ${records.length}`);

  if (withOutcomes.length > 0) {
    const profits = withOutcomes.filter((r) => r.outcome === "profit").length;
    const dirCorrect = withOutcomes.filter((r) => r.direction_correct).length;
    console.log(`  Profit rate: ${((profits / withOutcomes.length) * 100).toFixed(1)}%`);
    console.log(`  Direction accuracy: ${((dirCorrect / withOutcomes.length) * 100).toFixed(1)}%`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("[HF Sync] MoltApp v23 Benchmark Dataset Export\n");

  try {
    const records = await fetchBenchmarkData();

    if (records.length === 0) {
      console.log("[HF Sync] No benchmark records found. Run some trading rounds first.");
      return;
    }

    printSummary(records);
    await uploadToHuggingFace(records);

    console.log("\n[HF Sync] Done!");
  } catch (err) {
    console.error(`[HF Sync] Fatal error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

main();
