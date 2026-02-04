/**
 * HuggingFace Benchmark Dataset Sync (v24)
 *
 * Exports MoltApp v24 benchmark data with 8-dimension scoring:
 * 1. Fetches all trades with justifications from the database
 * 2. Runs v24 reasoning depth + source quality analysis on each trade
 * 3. Joins with outcome resolutions for prediction accuracy data
 * 4. Formats as JSONL benchmark dataset with v24 fields
 * 5. Uploads to patruff/molt-benchmark on HuggingFace Hub
 * 6. Includes eval.yaml for benchmark recognition
 *
 * Usage:
 *   npx tsx scripts/sync-to-hf-v24.ts
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
import { desc } from "drizzle-orm";
import { readFileSync } from "fs";
import { join } from "path";
import {
  runV24Analysis,
} from "../src/services/reasoning-depth-quality-engine.ts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const HF_REPO = "patruff/molt-benchmark";
const HF_TOKEN = process.env.HF_TOKEN ?? "";
const BATCH_SIZE = 2000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BenchmarkRecordV24 {
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
  // v24 new fields
  reasoning_depth_score: number;
  step_count: number;
  connective_density: number;
  evidence_anchoring: number;
  counter_argument_score: number;
  conclusion_clarity: number;
  vocabulary_richness: number;
  reasoning_pattern: string;
  source_quality_score: number;
  source_diversity: number;
  source_specificity: number;
  source_cross_reference: number;
  source_integration: number;
  source_categories: string[];
}

// ---------------------------------------------------------------------------
// Data Fetching
// ---------------------------------------------------------------------------

async function fetchBenchmarkData(): Promise<BenchmarkRecordV24[]> {
  console.log("[HF Sync v24] Fetching trade justifications from database...");

  const justifications = await db
    .select()
    .from(tradeJustifications)
    .orderBy(desc(tradeJustifications.timestamp))
    .limit(BATCH_SIZE);

  console.log(`[HF Sync v24] Found ${justifications.length} justifications`);

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
    console.log(`[HF Sync v24] Found ${resolutions.length} outcome resolutions`);
  } catch (err) {
    console.warn(`[HF Sync v24] Could not fetch outcomes: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Build composite score lookup
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

  // Format records with v24 analysis
  const records: BenchmarkRecordV24[] = justifications.map((j) => {
    const outcome = outcomes.get(j.id);
    const hallucinationFlags = (j.hallucinationFlags as string[] | null) ?? [];
    const sources = (j.sources as string[] | null) ?? [];

    // Run v24 analysis on each trade
    const { depth, sourceQuality } = runV24Analysis(j.reasoning, sources);

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
      // v24 fields
      reasoning_depth_score: depth.depthScore,
      step_count: depth.stepCount,
      connective_density: depth.connectiveDensity,
      evidence_anchoring: depth.evidenceAnchoringScore,
      counter_argument_score: depth.counterArgumentScore,
      conclusion_clarity: depth.conclusionClarity,
      vocabulary_richness: depth.vocabularyRichness,
      reasoning_pattern: depth.reasoningPattern,
      source_quality_score: sourceQuality.qualityScore,
      source_diversity: sourceQuality.diversityScore,
      source_specificity: sourceQuality.specificityScore,
      source_cross_reference: sourceQuality.crossReferenceScore,
      source_integration: sourceQuality.integrationScore,
      source_categories: sourceQuality.sourceCategories,
    };
  });

  return records;
}

// ---------------------------------------------------------------------------
// JSONL Formatting
// ---------------------------------------------------------------------------

function formatAsJsonl(records: BenchmarkRecordV24[]): string {
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
    - name: reasoning_depth_score
      dtype: float64
    - name: step_count
      dtype: int32
    - name: connective_density
      dtype: float64
    - name: evidence_anchoring
      dtype: float64
    - name: counter_argument_score
      dtype: float64
    - name: reasoning_pattern
      dtype: string
    - name: source_quality_score
      dtype: float64
    - name: source_diversity
      dtype: float64
    - name: source_specificity
      dtype: float64
    - name: source_cross_reference
      dtype: float64
    - name: source_integration
      dtype: float64
    - name: source_categories
      sequence: string
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
  - reasoning-depth
  - source-quality
---

# MoltApp v24: Agentic Stock Trading Benchmark

**Live evaluation of AI agents trading tokenized real-world stocks on Solana.**

## What's New in v24

v24 adds two new benchmark dimensions:

1. **Reasoning Depth** — measures how structured and thorough agent reasoning is
   - Step count, logical connectives, evidence anchoring, counter-arguments, conclusion clarity
2. **Source Quality** — measures how well agents use their information
   - Source diversity, specificity, cross-referencing, integration

## Benchmark Dimensions (v24 — 8 Dimensions)

| Dimension | Weight | Description |
|-----------|--------|-------------|
| P&L Performance | 25% | Return on investment |
| Reasoning Coherence | 15% | Does logic match the trade action? |
| Hallucination-Free Rate | 12% | No fabricated market data |
| Confidence Calibration | 12% | ECE — confidence predicts outcomes |
| **Reasoning Depth (v24)** | **10%** | How structured and thorough is reasoning? |
| **Source Quality (v24)** | **10%** | How well are data sources used? |
| Prediction Accuracy | 8% | Directional prediction correctness |
| Instruction Discipline | 8% | Compliance with trading rules |

## Agents

| Agent | Model | Provider | Style |
|-------|-------|----------|-------|
| Claude ValueBot | claude-sonnet-4 | Anthropic | Conservative Value |
| GPT MomentumBot | gpt-4.1 | OpenAI | Aggressive Momentum |
| Grok ContrarianBot | grok-3 | xAI | Contrarian Swing |

## Statistics

- **Total Records**: ${recordCount}
- **Agents**: ${agentCount}
- **Benchmark Version**: v24 (8 dimensions)
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
- Benchmark Dashboard: [www.patgpt.us/benchmark-v24](https://www.patgpt.us/benchmark-v24)
- API Docs: [www.patgpt.us/api-docs](https://www.patgpt.us/api-docs)
`;
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

async function uploadToHuggingFace(
  records: BenchmarkRecordV24[],
): Promise<void> {
  if (!HF_TOKEN) {
    console.log("[HF Sync v24] No HF_TOKEN set — writing files locally instead");
    const { writeFileSync, mkdirSync } = await import("fs");
    const outDir = join(process.cwd(), "hf-export-v24");
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
      console.warn("[HF Sync v24] eval.yaml not found, skipping");
    }

    console.log(`[HF Sync v24] Exported ${records.length} records to ${outDir}/`);
    return;
  }

  console.log(`[HF Sync v24] Uploading ${records.length} records to ${HF_REPO}...`);

  const agents = new Set(records.map((r) => r.agent_id));

  // Upload data.jsonl
  const jsonlBlob = new Blob([formatAsJsonl(records)], { type: "text/plain" });
  await uploadFile({
    repo: HF_REPO,
    credentials: { accessToken: HF_TOKEN },
    file: { content: jsonlBlob, path: "data/benchmark-v24.jsonl" },
    commitTitle: `Update v24 benchmark data: ${records.length} records`,
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
    commitTitle: "Update dataset card to v24",
  });

  // Upload eval.yaml
  try {
    const evalYaml = readFileSync(join(process.cwd(), "eval.yaml"), "utf-8");
    const evalBlob = new Blob([evalYaml], { type: "text/yaml" });
    await uploadFile({
      repo: HF_REPO,
      credentials: { accessToken: HF_TOKEN },
      file: { content: evalBlob, path: "eval.yaml" },
      commitTitle: "Update eval.yaml to v24 benchmark spec",
    });
  } catch {
    console.warn("[HF Sync v24] eval.yaml not found, skipping");
  }

  console.log(`[HF Sync v24] Upload complete: ${records.length} records to ${HF_REPO}`);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function printSummary(records: BenchmarkRecordV24[]): void {
  const agents = new Map<string, {
    trades: number;
    avgCoherence: number;
    avgConfidence: number;
    avgDepth: number;
    avgSourceQuality: number;
    patterns: Map<string, number>;
  }>();

  for (const r of records) {
    const existing = agents.get(r.agent_id) ?? {
      trades: 0, avgCoherence: 0, avgConfidence: 0, avgDepth: 0, avgSourceQuality: 0,
      patterns: new Map(),
    };
    existing.trades++;
    existing.avgCoherence += r.coherence_score ?? 0;
    existing.avgConfidence += r.confidence;
    existing.avgDepth += r.reasoning_depth_score;
    existing.avgSourceQuality += r.source_quality_score;
    const pc = existing.patterns.get(r.reasoning_pattern) ?? 0;
    existing.patterns.set(r.reasoning_pattern, pc + 1);
    agents.set(r.agent_id, existing);
  }

  console.log("\n=== MoltApp v24 Benchmark Dataset Summary ===\n");
  console.log(`Total records: ${records.length}`);
  console.log(`Agents: ${agents.size}`);
  console.log(`Benchmark version: v24 (8 dimensions)\n`);

  for (const [agentId, stats] of agents) {
    const topPattern = [...stats.patterns.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "N/A";
    console.log(`  ${agentId}:`);
    console.log(`    Trades: ${stats.trades}`);
    console.log(`    Avg Coherence: ${(stats.avgCoherence / stats.trades).toFixed(3)}`);
    console.log(`    Avg Confidence: ${(stats.avgConfidence / stats.trades).toFixed(3)}`);
    console.log(`    Avg Reasoning Depth: ${(stats.avgDepth / stats.trades).toFixed(3)}`);
    console.log(`    Avg Source Quality: ${(stats.avgSourceQuality / stats.trades).toFixed(3)}`);
    console.log(`    Top Pattern: ${topPattern}`);
  }

  const withOutcomes = records.filter((r) => r.outcome !== null);
  console.log(`\nOutcome resolutions: ${withOutcomes.length} / ${records.length}`);

  if (withOutcomes.length > 0) {
    const profits = withOutcomes.filter((r) => r.outcome === "profit").length;
    const dirCorrect = withOutcomes.filter((r) => r.direction_correct).length;
    console.log(`  Profit rate: ${((profits / withOutcomes.length) * 100).toFixed(1)}%`);
    console.log(`  Direction accuracy: ${((dirCorrect / withOutcomes.length) * 100).toFixed(1)}%`);
  }

  // v24 depth & source quality summary
  const allDepths = records.map((r) => r.reasoning_depth_score);
  const allSrcQuality = records.map((r) => r.source_quality_score);
  console.log(`\nv24 Analysis Summary:`);
  console.log(`  Avg Reasoning Depth: ${(allDepths.reduce((a, b) => a + b, 0) / allDepths.length).toFixed(3)}`);
  console.log(`  Avg Source Quality: ${(allSrcQuality.reduce((a, b) => a + b, 0) / allSrcQuality.length).toFixed(3)}`);

  // Pattern distribution
  const patternCounts = new Map<string, number>();
  for (const r of records) {
    const pc = patternCounts.get(r.reasoning_pattern) ?? 0;
    patternCounts.set(r.reasoning_pattern, pc + 1);
  }
  console.log(`\nReasoning Pattern Distribution:`);
  for (const [pattern, count] of [...patternCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pattern}: ${count} (${((count / records.length) * 100).toFixed(1)}%)`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("[HF Sync v24] MoltApp v24 Benchmark Dataset Export\n");

  try {
    const records = await fetchBenchmarkData();

    if (records.length === 0) {
      console.log("[HF Sync v24] No benchmark records found. Run some trading rounds first.");
      return;
    }

    printSummary(records);
    await uploadToHuggingFace(records);

    console.log("\n[HF Sync v24] Done!");
  } catch (err) {
    console.error(`[HF Sync v24] Fatal error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

main();
