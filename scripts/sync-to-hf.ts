/**
 * HuggingFace Benchmark Sync
 *
 * Fetches all trade justifications from the database, formats them as a
 * structured benchmark dataset, and uploads to HuggingFace Hub.
 *
 * Dataset: patruff/molt-benchmark
 *
 * Usage:
 *   npx tsx scripts/sync-to-hf.ts
 *
 * Environment:
 *   HF_TOKEN — HuggingFace API token with write access
 *   DATABASE_URL — PostgreSQL connection string
 */

import { uploadFile } from "@huggingface/hub";
import { db } from "../src/db/index.ts";
import { tradeJustifications, benchmarkSnapshots } from "../src/db/schema/trade-reasoning.ts";
import { agentDecisions } from "../src/db/schema/agent-decisions.ts";
import { agents } from "../src/db/schema/agents.ts";
import { desc, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const HF_REPO = "patruff/molt-benchmark";
const HF_TOKEN = process.env.HF_TOKEN;

if (!HF_TOKEN) {
  console.error("Error: HF_TOKEN environment variable is required");
  console.error("Get a token from https://huggingface.co/settings/tokens");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BenchmarkRecord {
  /** Unique trade ID */
  id: string;
  /** Agent identifier */
  agent_id: string;
  /** Agent's LLM provider (anthropic, openai, xai) */
  agent_provider: string;
  /** Trade action */
  action: "buy" | "sell" | "hold";
  /** Stock symbol */
  symbol: string;
  /** Quantity traded */
  quantity: number;
  /** Full reasoning text */
  reasoning: string;
  /** Confidence 0-1 */
  confidence: number;
  /** Trading intent classification */
  intent: string;
  /** Data sources cited */
  sources: string[];
  /** Predicted outcome text */
  predicted_outcome: string | null;
  /** Actual outcome text */
  actual_outcome: string | null;
  /** Coherence score 0-1 */
  coherence_score: number | null;
  /** List of hallucination flags */
  hallucination_flags: string[];
  /** Whether agent followed rules */
  discipline_pass: boolean;
  /** Trading round ID */
  round_id: string | null;
  /** ISO timestamp */
  timestamp: string;
}

interface DatasetMetadata {
  benchmark: string;
  version: string;
  generated_at: string;
  total_records: number;
  agents: string[];
  metrics: {
    avg_coherence: number;
    avg_confidence: number;
    hallucination_rate: number;
    discipline_rate: number;
  };
}

// ---------------------------------------------------------------------------
// Data Fetching
// ---------------------------------------------------------------------------

async function fetchBenchmarkData(): Promise<BenchmarkRecord[]> {
  console.log("Fetching trade justifications from database...");

  const justifications = await db
    .select()
    .from(tradeJustifications)
    .orderBy(desc(tradeJustifications.timestamp));

  console.log(`Found ${justifications.length} justifications`);

  if (justifications.length === 0) {
    // Fall back to agent_decisions table for backward compatibility
    console.log("No justifications found, falling back to agent_decisions...");
    const decisions = await db
      .select()
      .from(agentDecisions)
      .orderBy(desc(agentDecisions.createdAt));

    console.log(`Found ${decisions.length} agent decisions`);

    return decisions.map((d) => ({
      id: `decision_${d.id}`,
      agent_id: d.agentId,
      agent_provider: inferProvider(d.agentId),
      action: d.action as "buy" | "sell" | "hold",
      symbol: d.symbol,
      quantity: parseFloat(d.quantity),
      reasoning: d.reasoning,
      confidence: d.confidence / 100, // normalize to 0-1
      intent: classifyIntentSimple(d.reasoning, d.action),
      sources: extractSourcesSimple(d.reasoning),
      predicted_outcome: null,
      actual_outcome: null,
      coherence_score: null,
      hallucination_flags: [],
      discipline_pass: true,
      round_id: d.roundId,
      timestamp: d.createdAt.toISOString(),
    }));
  }

  return justifications.map((j) => ({
    id: j.id,
    agent_id: j.agentId,
    agent_provider: inferProvider(j.agentId),
    action: j.action as "buy" | "sell" | "hold",
    symbol: j.symbol,
    quantity: j.quantity ?? 0,
    reasoning: j.reasoning,
    confidence: j.confidence,
    intent: j.intent,
    sources: (j.sources as string[]) ?? [],
    predicted_outcome: j.predictedOutcome,
    actual_outcome: j.actualOutcome,
    coherence_score: j.coherenceScore,
    hallucination_flags: (j.hallucinationFlags as string[]) ?? [],
    discipline_pass: j.disciplinePass === "pass",
    round_id: j.roundId,
    timestamp: j.timestamp?.toISOString() ?? new Date().toISOString(),
  }));
}

function inferProvider(agentId: string): string {
  if (agentId.includes("claude")) return "anthropic";
  if (agentId.includes("gpt")) return "openai";
  if (agentId.includes("grok")) return "xai";
  return "unknown";
}

function classifyIntentSimple(reasoning: string, action: string): string {
  const lower = reasoning.toLowerCase();
  if (/undervalued|value|margin|cheap/i.test(lower)) return "value";
  if (/momentum|trend|breakout|rally/i.test(lower)) return "momentum";
  if (/reversion|oversold|bounce|pullback/i.test(lower)) return "mean_reversion";
  if (/hedge|protect|defensive/i.test(lower)) return "hedge";
  if (/contrarian|against/i.test(lower)) return "contrarian";
  return action === "buy" ? "value" : "momentum";
}

function extractSourcesSimple(reasoning: string): string[] {
  const sources: string[] = [];
  if (/price/i.test(reasoning)) sources.push("market_price_feed");
  if (/24h|change/i.test(reasoning)) sources.push("24h_price_change");
  if (/volume/i.test(reasoning)) sources.push("trading_volume");
  if (/portfolio|position/i.test(reasoning)) sources.push("portfolio_state");
  if (/news/i.test(reasoning)) sources.push("news_feed");
  if (sources.length === 0) sources.push("market_data");
  return sources;
}

// ---------------------------------------------------------------------------
// Dataset Formatting
// ---------------------------------------------------------------------------

function computeMetadata(records: BenchmarkRecord[]): DatasetMetadata {
  const agentIds = [...new Set(records.map((r) => r.agent_id))];

  const withCoherence = records.filter((r) => r.coherence_score !== null);
  const avgCoherence = withCoherence.length > 0
    ? withCoherence.reduce((s, r) => s + (r.coherence_score ?? 0), 0) / withCoherence.length
    : 0;

  const avgConfidence = records.length > 0
    ? records.reduce((s, r) => s + r.confidence, 0) / records.length
    : 0;

  const withHallucinations = records.filter((r) => r.hallucination_flags.length > 0).length;
  const hallucinationRate = records.length > 0 ? withHallucinations / records.length : 0;

  const disciplinePasses = records.filter((r) => r.discipline_pass).length;
  const disciplineRate = records.length > 0 ? disciplinePasses / records.length : 0;

  return {
    benchmark: "moltapp-v20",
    version: `${new Date().toISOString().split("T")[0]}`,
    generated_at: new Date().toISOString(),
    total_records: records.length,
    agents: agentIds,
    metrics: {
      avg_coherence: Math.round(avgCoherence * 1000) / 1000,
      avg_confidence: Math.round(avgConfidence * 1000) / 1000,
      hallucination_rate: Math.round(hallucinationRate * 1000) / 1000,
      discipline_rate: Math.round(disciplineRate * 1000) / 1000,
    },
  };
}

function formatAsJsonl(records: BenchmarkRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join("\n");
}

// ---------------------------------------------------------------------------
// Upload to HuggingFace
// ---------------------------------------------------------------------------

async function uploadToHuggingFace(
  records: BenchmarkRecord[],
  metadata: DatasetMetadata,
): Promise<void> {
  const credentials = { accessToken: HF_TOKEN! };
  const repo = { type: "dataset" as const, name: HF_REPO };

  console.log(`\nUploading to HuggingFace: ${HF_REPO}`);

  // 1. Upload the main dataset as JSONL
  const jsonlContent = formatAsJsonl(records);
  const jsonlBlob = new Blob([jsonlContent], { type: "application/jsonl" });

  await uploadFile({
    repo,
    credentials,
    file: { path: "data/trades.jsonl", content: jsonlBlob },
    commitTitle: `Update benchmark data: ${metadata.total_records} records (${metadata.version})`,
  });
  console.log(`  Uploaded data/trades.jsonl (${records.length} records)`);

  // 2. Upload metadata
  const metadataJson = JSON.stringify(metadata, null, 2);
  const metadataBlob = new Blob([metadataJson], { type: "application/json" });

  await uploadFile({
    repo,
    credentials,
    file: { path: "metadata.json", content: metadataBlob },
    commitTitle: `Update metadata (${metadata.version})`,
  });
  console.log("  Uploaded metadata.json");

  // 3. Upload README with dataset card
  const readmeContent = generateDatasetCard(metadata);
  const readmeBlob = new Blob([readmeContent], { type: "text/markdown" });

  await uploadFile({
    repo,
    credentials,
    file: { path: "README.md", content: readmeBlob },
    commitTitle: `Update dataset card (${metadata.version})`,
  });
  console.log("  Uploaded README.md (dataset card)");

  console.log(`\nDone! Dataset available at: https://huggingface.co/datasets/${HF_REPO}`);
}

function generateDatasetCard(metadata: DatasetMetadata): string {
  return `---
language: en
license: apache-2.0
task_categories:
  - text-classification
  - text-generation
tags:
  - finance
  - trading
  - ai-agents
  - benchmark
  - reasoning
  - hallucination-detection
pretty_name: "MoltApp: AI Trading Benchmark v20"
size_categories:
  - 1K<n<10K
---

# MoltApp: Agentic Stock Trading Benchmark v20

**Live evaluation of AI agents trading tokenized real-world stocks on Solana.**

Website: [www.patgpt.us](https://www.patgpt.us) | Dashboard: [www.patgpt.us/benchmark-v20](https://www.patgpt.us/benchmark-v20)

## Overview

MoltApp pits AI agents (Claude, GPT, Grok) against each other in a real-money
stock trading competition on Solana. Every trade requires structured reasoning,
which we analyze across **24 scoring pillars**:

| Pillar | Weight | Description |
|--------|--------|-------------|
| **Financial** | 9% | P&L, Sharpe Ratio, Win Rate, Max Drawdown |
| **Reasoning** | 8% | Coherence, Depth, Consistency |
| **Safety** | 7% | Hallucination-Free Rate, Discipline Compliance |
| **Calibration** | 6% | ECE, Brier Score, Monotonic Quartiles |
| **Patterns** | 4% | Fallacy Detection, Vocabulary Sophistication |
| **Adaptability** | 4% | Cross-Regime Consistency |
| **Forensic Quality** | 6% | Structure, Originality, Clarity, Integrity |
| **Validation Quality** | 6% | Depth, Sources, Grounding, Risk Awareness |
| **Prediction Accuracy** | 5% | Direction accuracy, target precision, resolution quality |
| **Reasoning Stability** | 4% | Sentiment volatility, confidence volatility, intent drift |
| **Provenance Integrity** | 5% | Pre-commit seal validity, chain integrity, cross-agent witness |
| **Model Comparison** | 4% | Vocabulary uniqueness, reasoning independence, bias awareness |
| **Metacognition** | 5% | Epistemic humility, error recognition, adaptive strategy |
| **Reasoning Efficiency** | 3% | Information density, signal-to-noise ratio |
| **Forensic Ledger** | 3% | Immutable hash-chain audit, outcome resolution |
| **Strategy Genome** | 3% | 8-gene behavioral DNA, cross-agent similarity |
| **Adversarial Robustness** | 4% | Signal conflict, anchoring resistance, edge cases, framing bias |
| **Cross-Session Memory** | 4% | Mistake repetition, lesson retention, strategy evolution |
| **Arbitration Quality** | 5% | Evidence weight, logical consistency, calibration accuracy, risk disclosure, originality |
| **Debate Performance** | 5% | Thesis clarity, evidence quality, logical strength, rebuttal power, honesty |
| **Impact Forecasting** | 4% | Direction accuracy, magnitude calibration, learning velocity, conviction correlation |
| **Reasoning Transparency** | 5% | Claim extraction, evidence mapping, logic chain, assumptions, counterfactuals |
| **Decision Accountability** | 5% | Claim accuracy, overconfidence rate, learning trend, resolution rate |
| **Quality Certification** | 5% | Structural completeness, data grounding, logical soundness, epistemic honesty |

### v20 Features (NEW)
- **Reasoning Transparency Engine**: Decomposes reasoning into verifiable claims, maps evidence, validates logic chains, surfaces assumptions, generates counterfactuals.
- **Decision Accountability Tracker**: Registers verifiable claims at trade time, resolves against outcomes, tracks accuracy by type/symbol/confidence.
- **Reasoning Quality Certifier**: Issues Gold/Silver/Bronze quality certificates with SHA-256 verification across 5 dimensions.

### v19 Features
- **Benchmark Arbitration Engine**: Structured court cases for agent disagreements — pairwise evidence scoring, logical consistency analysis, outcome resolution.
- **Cross-Agent Debate Engine**: Formal debates with thesis extraction, evidence clash detection, logical chain analysis, rebuttal scoring.
- **Trade Impact Forecaster**: Prediction accountability — direction accuracy, magnitude calibration, conviction-outcome correlation, learning velocity.

### v18 Features
- **Adversarial Robustness Engine**: Stress-tests under adversarial conditions.
- **Cross-Session Memory Analyzer**: Measures genuine cross-session learning.
- **Benchmark Regression Detector**: Monitors benchmark quality over time.

### Prior Version Features
- v17: Benchmark Intelligence Gateway, Trade Forensic Ledger, Agent Strategy Genome
- v16: Metacognition Engine, Reasoning Efficiency Scorer, Reasoning Depth Scorer
- v15: Reasoning Provenance Engine, Cross-Model Comparator, Reproducibility Prover
- v14: Outcome Resolution, Calibration Curves, Volatility Tracker, Consensus Divergence, Battle Engine, Taxonomy

### Current Metrics
| Metric | Value |
|--------|-------|
| **Avg Coherence** | ${metadata.metrics.avg_coherence.toFixed(3)} |
| **Hallucination Rate** | ${metadata.metrics.hallucination_rate.toFixed(3)} |
| **Discipline Rate** | ${metadata.metrics.discipline_rate.toFixed(3)} |
| **Avg Confidence** | ${metadata.metrics.avg_confidence.toFixed(3)} |

## Dataset Structure

Each record contains:
- \`agent_id\`: Which AI agent made the trade
- \`action\`: buy / sell / hold
- \`symbol\`: Stock ticker (e.g., AAPLx, NVDAx)
- \`reasoning\`: Full step-by-step reasoning text
- \`confidence\`: Self-reported confidence (0-1)
- \`intent\`: Strategy classification (value, momentum, mean_reversion, etc.)
- \`sources\`: Data sources the agent cited
- \`coherence_score\`: Automated coherence analysis (0-1)
- \`hallucination_flags\`: Detected factual errors
- \`discipline_pass\`: Whether agent followed its rules

## Agents

${metadata.agents.map((a) => `- \`${a}\``).join("\n")}

## Stats

- **Total Records**: ${metadata.total_records}
- **Last Updated**: ${metadata.version}
- **Generated At**: ${metadata.generated_at}
- **Benchmark Version**: v20

## API Endpoints

- Dashboard: \`/benchmark-v20\`
- Data: \`/benchmark-v20/data\`
- Stream: \`/benchmark-v20/stream\`
- Export: \`/benchmark-v20/export\`
- Scores: \`/api/v1/benchmark-v20/scores\`
- Agent Score: \`/api/v1/benchmark-v20/score/:agentId\`
- Transparency: \`/api/v1/benchmark-v20/transparency\`
- Accountability: \`/api/v1/benchmark-v20/accountability\`
- Certification: \`/api/v1/benchmark-v20/certification\`
- Verify: \`/api/v1/benchmark-v20/verify/:hash\`
- Health: \`/api/v1/benchmark-v20/health\`
- Weights: \`/api/v1/benchmark-v20/weights\`
- Schema: \`/api/v1/benchmark-v20/schema\`
- JSONL Export: \`/api/v1/benchmark-v20/export/jsonl\`
- CSV Export: \`/api/v1/benchmark-v20/export/csv\`

## Citation

\`\`\`bibtex
@misc{moltapp2026,
  title={MoltApp: An Agentic Stock Trading Benchmark},
  author={MoltApp Team},
  year={2026},
  url={https://www.patgpt.us}
}
\`\`\`
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== MoltApp HuggingFace Benchmark Sync ===\n");

  try {
    const records = await fetchBenchmarkData();

    if (records.length === 0) {
      console.log("No benchmark data found. Run some trading rounds first.");
      process.exit(0);
    }

    const metadata = computeMetadata(records);

    console.log(`\nDataset summary:`);
    console.log(`  Records: ${metadata.total_records}`);
    console.log(`  Agents: ${metadata.agents.join(", ")}`);
    console.log(`  Avg Coherence: ${metadata.metrics.avg_coherence}`);
    console.log(`  Hallucination Rate: ${metadata.metrics.hallucination_rate}`);
    console.log(`  Discipline Rate: ${metadata.metrics.discipline_rate}`);

    await uploadToHuggingFace(records, metadata);
  } catch (error) {
    console.error("Sync failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
