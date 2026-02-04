/**
 * HuggingFace Benchmark Sync — v26
 *
 * Fetches all trades with justifications from the MoltApp database,
 * runs v26 analysis (strategy genome + risk-reward discipline), and
 * uploads the complete 12-dimension dataset to HuggingFace:
 *   patruff/molt-benchmark
 *
 * Usage:
 *   HF_TOKEN=hf_xxx DATABASE_URL=postgres://... npx tsx scripts/sync-to-hf-v26.ts
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

const sqlClient = neon(DATABASE_URL);
const db = drizzle({ client: sqlClient });

// ---------------------------------------------------------------------------
// Inline analysis helpers (avoiding import of full services)
// ---------------------------------------------------------------------------

function analyzeDepthInline(reasoning: string): {
  depthScore: number;
  stepCount: number;
  wordCount: number;
  connectiveDensity: number;
} {
  const sentences = reasoning.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const words = reasoning.split(/\s+/);
  const connectives = (
    reasoning.match(
      /\b(therefore|because|however|furthermore|consequently|although|moreover|thus|hence|since|given|considering|additionally|nevertheless|nonetheless)\b/gi,
    ) ?? []
  ).length;
  const stepCount = sentences.length;
  const connectiveDensity =
    sentences.length > 0 ? connectives / sentences.length : 0;
  const depthScore = Math.min(
    1,
    (stepCount / 8) * 0.3 +
      Math.min(1, connectiveDensity) * 0.3 +
      Math.min(1, words.length / 100) * 0.4,
  );
  return {
    depthScore: Math.round(depthScore * 100) / 100,
    stepCount,
    wordCount: words.length,
    connectiveDensity: Math.round(connectiveDensity * 100) / 100,
  };
}

function analyzeSourceInline(sources: string[]): {
  qualityScore: number;
  sourceCount: number;
} {
  const count = sources.length;
  const diversityScore = Math.min(1, count / 5);
  return { qualityScore: Math.round(diversityScore * 100) / 100, sourceCount: count };
}

function parsePredictionInline(
  reasoning: string,
  predictedOutcome?: string | null,
): { direction: string; magnitude: number | null } {
  const text = predictedOutcome ? `${predictedOutcome} ${reasoning}` : reasoning;
  let direction = "unspecified";
  if (
    /expect.*(?:up|rise|gain|increase|bullish|higher|upside)|target.*\+\d/i.test(text)
  )
    direction = "up";
  else if (
    /expect.*(?:down|fall|decline|decrease|bearish|lower|downside)|target.*-\d/i.test(text)
  )
    direction = "down";
  else if (/consolidat|sideways|range.?bound|stable|flat/i.test(text))
    direction = "flat";

  let magnitude: number | null = null;
  const magMatch = text.match(/[+-]?\s*(\d+(?:\.\d+)?)\s*%/);
  if (magMatch) {
    magnitude = parseFloat(magMatch[1]);
    if (direction === "down") magnitude = -magnitude;
  }
  return { direction, magnitude };
}

function detectStrategyInline(reasoning: string): string {
  const lower = reasoning.toLowerCase();
  const scores: Record<string, number> = {
    value: 0,
    momentum: 0,
    contrarian: 0,
    hedge: 0,
    arbitrage: 0,
    mean_reversion: 0,
  };

  if (/undervalued|intrinsic|margin\s+of\s+safety|fair\s+price|cheap|p\/e/i.test(lower)) scores.value += 3;
  if (/fundamentals?|book\s+value|dividend|moat|long.term/i.test(lower)) scores.value += 2;
  if (/momentum|trend|breakout|rally|surge|continuation/i.test(lower)) scores.momentum += 3;
  if (/moving\s+average|rsi|macd|volume\s+spike|technical/i.test(lower)) scores.momentum += 2;
  if (/contrarian|against\s+the\s+crowd|overreaction|panic|fear/i.test(lower)) scores.contrarian += 3;
  if (/oversold|sentiment\s+extreme|capitulation/i.test(lower)) scores.contrarian += 2;
  if (/hedge|protect|downside\s+protection|defensive/i.test(lower)) scores.hedge += 3;
  if (/arbitrage|mispricing|spread|price\s+difference/i.test(lower)) scores.arbitrage += 3;
  if (/mean\s+reversion|revert|oversold|overbought|pullback|bounce/i.test(lower)) scores.mean_reversion += 3;

  let maxScore = 0;
  let detected = "value";
  for (const [strategy, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      detected = strategy;
    }
  }
  return detected;
}

function analyzeRiskRewardInline(reasoning: string, confidence: number): {
  riskAwareness: number;
  hasRiskBoundary: boolean;
  hasProfitTarget: boolean;
  disciplineScore: number;
} {
  const riskPatterns = [
    /stop.?loss/i,
    /risk.?reward/i,
    /downside\s+(?:risk|protection|limit)/i,
    /max(?:imum)?\s+loss/i,
    /position\s+siz/i,
    /portfolio\s+(?:risk|concentration|diversif)/i,
    /cash\s+(?:buffer|reserve|cushion)/i,
    /risk\s+management/i,
    /drawdown/i,
  ];

  let riskAwareness = 0;
  for (const p of riskPatterns) {
    if (p.test(reasoning)) riskAwareness += 0.15;
  }
  riskAwareness = Math.min(1, riskAwareness);

  const hasRiskBoundary = /stop.?loss|downside\s+limit|max(?:imum)?\s+loss|exit\s+(?:at|if|below)/i.test(reasoning);
  const hasProfitTarget = /target\s*(?:price|:)\s*\$?\d|profit\s+target|take\s+profit|upside\s+(?:target|potential)/i.test(reasoning);

  const disciplineScore = Math.round(
    (riskAwareness * 0.4 + (hasRiskBoundary ? 1 : 0) * 0.3 + (hasProfitTarget ? 1 : 0) * 0.2 + Math.min(1, confidence) * 0.1) * 100,
  ) / 100;

  return {
    riskAwareness: Math.round(riskAwareness * 100) / 100,
    hasRiskBoundary,
    hasProfitTarget,
    disciplineScore,
  };
}

// ---------------------------------------------------------------------------
// Main sync function
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

  // Build JSONL dataset with all 12 dimensions
  const lines = justifications.map((j) => {
    const depth = analyzeDepthInline(j.reasoning);
    const sources = (j.sources as string[]) ?? [];
    const sourceQ = analyzeSourceInline(sources);
    const pred = parsePredictionInline(j.reasoning, j.predictedOutcome);
    const strategy = detectStrategyInline(j.reasoning);
    const confidence01 = j.confidence > 1 ? j.confidence / 100 : j.confidence;
    const rr = analyzeRiskRewardInline(j.reasoning, confidence01);

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

      // Original benchmark scores (v1-v23)
      coherence_score: j.coherenceScore ?? null,
      hallucination_flags: (j.hallucinationFlags as string[]) ?? [],
      hallucination_count: ((j.hallucinationFlags as string[]) ?? []).length,
      discipline_pass: j.disciplinePass === "pass",

      // v24: depth + source quality
      reasoning_depth_score: depth.depthScore,
      step_count: depth.stepCount,
      word_count: depth.wordCount,
      connective_density: depth.connectiveDensity,
      source_quality_score: sourceQ.qualityScore,
      source_count: sourceQ.sourceCount,

      // v25: outcome prediction + consensus
      predicted_direction: pred.direction,
      predicted_magnitude: pred.magnitude,

      // v26 NEW: strategy genome
      detected_strategy: strategy,
      strategy_matches_intent: strategy === j.intent,

      // v26 NEW: risk-reward discipline
      risk_awareness_score: rr.riskAwareness,
      has_risk_boundary: rr.hasRiskBoundary,
      has_profit_target: rr.hasProfitTarget,
      risk_reward_discipline_score: rr.disciplineScore,

      // Metadata
      benchmark_version: "v26",
      dimensions: 12,
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
      path: "data/benchmark-v26.jsonl",
      content: jsonlBlob,
    },
    commitTitle: `Update benchmark data: ${lines.length} trades (v26 — 12 dimensions)`,
  });
  console.log("Uploaded benchmark-v26.jsonl");

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
  - strategy-genome
  - risk-management
size_categories:
  - 1K<n<10K
---

# MoltApp: Agentic Stock Trading Benchmark (v26 — 12 Dimensions)

Live evaluation of AI agents trading **real tokenized stocks** on Solana blockchain.

## What's New in v26

- **Strategy Genome** (Dim 11): Measures strategy DNA consistency — does the agent stick to its declared trading approach? Tracks style consistency and strategy drift using cosine similarity of strategy DNA vectors.
- **Risk-Reward Discipline** (Dim 12): Measures position sizing relative to confidence, risk boundary awareness (stop-losses), profit targets, cash buffer maintenance, and portfolio concentration.

## 12-Dimension Scoring

| # | Dimension | Weight | Description | Since |
|---|-----------|--------|-------------|-------|
| 1 | P&L | 14% | Return on investment from actual on-chain trades | v1 |
| 2 | Coherence | 10% | Does reasoning logically support the trade action? | v1 |
| 3 | Hallucination-Free | 10% | Rate of factually correct claims in reasoning | v1 |
| 4 | Discipline | 7% | Compliance with position limits and trading rules | v1 |
| 5 | Calibration | 8% | Confidence calibration (ECE) | v23 |
| 6 | Prediction | 7% | Directional prediction accuracy | v23 |
| 7 | Reasoning Depth | 9% | Structural quality of reasoning | v24 |
| 8 | Source Quality | 8% | Quality and diversity of cited data sources | v24 |
| 9 | Outcome Prediction | 8% | Predicted outcome vs actual price movement | v25 |
| 10 | Consensus IQ | 7% | Independent thinking and contrarian success | v25 |
| 11 | Strategy Genome | 6% | Strategy DNA consistency and drift | **v26** |
| 12 | Risk-Reward Discipline | 6% | Position sizing, risk boundaries, concentration | **v26** |

## Agents

- **Claude ValueBot** (claude-sonnet-4): Conservative value investor
- **GPT MomentumBot** (gpt-4.1): Aggressive momentum trader
- **Grok ContrarianBot** (grok-3): Contrarian swing trader

## Data Format

Each JSONL record includes:
- Full reasoning text
- Trade details (action, symbol, quantity, confidence)
- All 12 benchmark dimension scores
- Strategy genome: detected strategy, intent match
- Risk-reward: risk awareness, boundaries, targets, discipline score

## Citation

\`\`\`bibtex
@misc{moltapp2026,
  title={MoltApp: An Agentic Stock Trading Benchmark for LLMs},
  author={Patrick Ruff},
  year={2026},
  url={https://www.patgpt.us}
}
\`\`\`

Website: [patgpt.us](https://www.patgpt.us) | Hackathon: Colosseum Agent Hackathon 2026
`;

  const cardBlob = new Blob([datasetCard], { type: "text/markdown" });
  await uploadFile({
    repo: REPO_ID,
    credentials: { accessToken: HF_TOKEN },
    file: {
      path: "README.md",
      content: cardBlob,
    },
    commitTitle: "Update dataset card (v26 — 12 dimensions)",
  });
  console.log("Uploaded README.md");

  console.log(`\nDone! Dataset at: https://huggingface.co/datasets/${REPO_ID}`);
  console.log(`Records: ${lines.length} | Version: v26 | Dimensions: 12`);
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
