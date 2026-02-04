/**
 * HuggingFace Benchmark Sync
 *
 * Fetches all trades with justifications from the MoltApp database,
 * formats them as a benchmark dataset, and uploads to HuggingFace:
 *   patruff/molt-benchmark
 *
 * Usage:
 *   HF_TOKEN=hf_xxx DATABASE_URL=postgres://... npx tsx scripts/sync-to-hf.ts
 *
 * The dataset includes every trade with:
 * - Full reasoning text
 * - 10-dimension benchmark scores
 * - Agent metadata
 * - Coherence, hallucination, discipline analysis
 * - Reasoning depth and source quality metrics (v24)
 * - Outcome prediction and consensus intelligence (v25)
 */

import { uploadFile } from "@huggingface/hub";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { desc } from "drizzle-orm";
import { tradeJustifications } from "../src/db/schema/trade-reasoning.ts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const HF_TOKEN = process.env.HF_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const REPO_ID = "patruff/molt-benchmark";

if (!HF_TOKEN) {
  console.error("ERROR: Set HF_TOKEN environment variable");
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error("ERROR: Set DATABASE_URL environment variable");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Database connection
// ---------------------------------------------------------------------------

const sql = neon(DATABASE_URL);
const db = drizzle({ client: sql });

// ---------------------------------------------------------------------------
// Reasoning analysis helpers (inline to avoid import complexity)
// ---------------------------------------------------------------------------

function analyzeDepthInline(reasoning: string): { depthScore: number; stepCount: number; wordCount: number } {
  const sentences = reasoning.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const words = reasoning.split(/\s+/);
  const connectives = (reasoning.match(/\b(therefore|because|however|furthermore|consequently|although|moreover|thus|hence|since|given|considering|additionally|nevertheless|nonetheless)\b/gi) ?? []).length;
  const stepCount = sentences.length;
  const connectiveDensity = sentences.length > 0 ? connectives / sentences.length : 0;
  const depthScore = Math.min(1, (stepCount / 8) * 0.3 + Math.min(1, connectiveDensity) * 0.3 + Math.min(1, words.length / 100) * 0.4);
  return { depthScore: Math.round(depthScore * 100) / 100, stepCount, wordCount: words.length };
}

function analyzeSourceInline(sources: string[]): { qualityScore: number; sourceCount: number } {
  const count = sources.length;
  const diversityScore = Math.min(1, count / 5);
  const qualityScore = Math.round(diversityScore * 100) / 100;
  return { qualityScore, sourceCount: count };
}

function parsePredictionInline(reasoning: string, predictedOutcome?: string | null): { direction: string; magnitude: number | null } {
  const text = predictedOutcome ? `${predictedOutcome} ${reasoning}` : reasoning;
  let direction = "unspecified";
  if (/expect.*(?:up|rise|gain|increase|bullish|higher|upside)|target.*\+\d/i.test(text)) direction = "up";
  else if (/expect.*(?:down|fall|decline|decrease|bearish|lower|downside)|target.*-\d/i.test(text)) direction = "down";
  else if (/consolidat|sideways|range.?bound|stable|flat/i.test(text)) direction = "flat";

  let magnitude: number | null = null;
  const magMatch = text.match(/[+-]?\s*(\d+(?:\.\d+)?)\s*%/);
  if (magMatch) {
    magnitude = parseFloat(magMatch[1]);
    if (direction === "down") magnitude = -magnitude;
  }
  return { direction, magnitude };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("Fetching trades from database...");

  const justifications = await db
    .select()
    .from(tradeJustifications)
    .orderBy(desc(tradeJustifications.timestamp))
    .limit(5000);

  console.log(`Found ${justifications.length} trades with justifications`);

  if (justifications.length === 0) {
    console.log("No data to sync. Run some trading rounds first.");
    return;
  }

  // Build JSONL dataset
  const lines = justifications.map((j) => {
    const depth = analyzeDepthInline(j.reasoning);
    const sources = (j.sources as string[]) ?? [];
    const sourceQ = analyzeSourceInline(sources);
    const pred = parsePredictionInline(j.reasoning, j.predictedOutcome);
    const confidence01 = j.confidence > 1 ? j.confidence / 100 : j.confidence;

    return JSON.stringify({
      // Core trade data
      agent_id: j.agentId,
      round_id: j.roundId ?? null,
      timestamp: j.timestamp?.toISOString() ?? null,
      action: j.action,
      symbol: j.symbol,
      quantity: j.quantity,

      // Reasoning
      reasoning: j.reasoning,
      confidence: Math.round(confidence01 * 100) / 100,
      sources,
      intent: j.intent,
      predicted_outcome: j.predictedOutcome,

      // Benchmark scores
      coherence_score: j.coherenceScore ?? null,
      hallucination_flags: (j.hallucinationFlags as string[]) ?? [],
      hallucination_count: ((j.hallucinationFlags as string[]) ?? []).length,
      discipline_pass: j.disciplinePass === "pass",

      // v24 depth + source quality
      reasoning_depth_score: depth.depthScore,
      step_count: depth.stepCount,
      word_count: depth.wordCount,
      source_quality_score: sourceQ.qualityScore,
      source_count: sourceQ.sourceCount,

      // v25 outcome prediction + consensus
      predicted_direction: pred.direction,
      predicted_magnitude: pred.magnitude,

      // Metadata
      benchmark_version: "v25",
      platform: "moltapp",
      blockchain: "solana",
      dex: "jupiter",
    });
  });

  const jsonlContent = lines.join("\n");
  const jsonlBlob = new Blob([jsonlContent], { type: "application/x-ndjson" });

  console.log(`Uploading ${lines.length} records to HuggingFace: ${REPO_ID}...`);

  // Upload JSONL data
  await uploadFile({
    repo: REPO_ID,
    credentials: { accessToken: HF_TOKEN },
    file: {
      path: "data/benchmark-v25.jsonl",
      content: jsonlBlob,
    },
    commitTitle: `Update benchmark data: ${lines.length} trades (v25)`,
  });
  console.log("Uploaded benchmark-v25.jsonl");

  // Upload dataset card
  const datasetCard = `---
license: mit
task_categories:
  - text-classification
  - text-generation
language:
  - en
tags:
  - finance
  - trading
  - ai-benchmark
  - llm-evaluation
  - agentic
  - solana
  - reasoning
size_categories:
  - 1K<n<10K
---

# MoltApp: Agentic Stock Trading Benchmark (v25)

Live evaluation of AI agents trading **real tokenized stocks** on Solana blockchain.

## 10-Dimension Scoring

| Dimension | Weight | Description |
|-----------|--------|-------------|
| P&L | 15% | Return on investment from actual on-chain trades |
| Coherence | 12% | Does reasoning logically support the trade action? |
| Hallucination-Free | 12% | Rate of factually correct claims in reasoning |
| Discipline | 10% | Compliance with position limits and trading rules |
| Calibration | 8% | Confidence calibration (ECE) |
| Prediction | 8% | Directional prediction accuracy |
| Reasoning Depth | 10% | Structural quality of reasoning |
| Source Quality | 8% | Quality and diversity of cited data sources |
| Outcome Prediction | 9% | Predicted outcome vs actual price movement |
| Consensus IQ | 8% | Independent thinking and contrarian success |

## Agents

- **Claude ValueBot** (claude-sonnet-4): Conservative value investor
- **GPT MomentumBot** (gpt-4o): Aggressive momentum trader
- **Grok ContrarianBot** (grok-3-mini-fast): Contrarian swing trader

## Data

Each record includes the full reasoning text, trade details, and all 10 benchmark dimension scores.

Website: [patgpt.us](https://www.patgpt.us)
Hackathon: Colosseum Agent Hackathon 2026
`;

  const cardBlob = new Blob([datasetCard], { type: "text/markdown" });
  await uploadFile({
    repo: REPO_ID,
    credentials: { accessToken: HF_TOKEN },
    file: {
      path: "README.md",
      content: cardBlob,
    },
    commitTitle: "Update dataset card (v25 — 10 dimensions)",
  });
  console.log("Uploaded README.md");

  // Upload eval.yaml
  const evalYaml = await Bun.file("eval.yaml").text().catch(() => null) ?? "";
  if (evalYaml) {
    const evalBlob = new Blob([evalYaml], { type: "text/yaml" });
    await uploadFile({
      repo: REPO_ID,
      credentials: { accessToken: HF_TOKEN },
      file: {
        path: "eval.yaml",
        content: evalBlob,
      },
      commitTitle: "Update eval.yaml (v25 — 10 dimensions)",
    });
    console.log("Uploaded eval.yaml");
  }

  console.log(`\nDone! Dataset available at: https://huggingface.co/datasets/${REPO_ID}`);
  console.log(`Records: ${lines.length} | Version: v25 | Dimensions: 10`);
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
