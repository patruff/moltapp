/**
 * Benchmark Dataset Exporter for HuggingFace
 *
 * Exports MoltApp benchmark data in industry-standard formats for
 * the HuggingFace datasets hub. This is what makes MoltApp a REAL
 * benchmark that researchers can use — not just a pretty dashboard.
 *
 * Export formats:
 * 1. JSONL: One JSON object per line, standard for ML datasets
 * 2. CSV: For spreadsheet analysis and quick inspection
 * 3. Parquet-compatible JSON: Structured for conversion to Parquet
 * 4. Dataset Card: Markdown README for HuggingFace dataset page
 *
 * Every export includes:
 * - Full trade reasoning text
 * - Coherence scores
 * - Hallucination flags
 * - Market data snapshots
 * - Agent metadata
 * - Benchmark methodology version
 * - Integrity proof hashes
 */

import { getEvaluations, getCurrentMethodology } from "./benchmark-gateway.ts";
import { getLeaderboard } from "./leaderboard-engine.ts";
import { countWords, countByCondition } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single row in the benchmark dataset */
export interface DatasetRow {
  /** Row ID */
  id: string;
  /** Benchmark version */
  benchmarkVersion: string;
  /** Agent identifier */
  agentId: string;
  /** Agent's LLM model */
  model: string;
  /** Provider */
  provider: string;
  /** Whether agent is external submission */
  isExternal: boolean;
  /** Trading round ID */
  roundId: string;

  /** Trade details */
  action: string;
  symbol: string;
  quantity: number;
  reasoning: string;
  reasoningWordCount: number;
  confidence: number;
  intent: string;
  sources: string[];
  predictedOutcome: string;

  /** Scoring */
  coherenceScore: number;
  coherenceExplanation: string;
  hallucinationCount: number;
  hallucinationFlags: string[];
  hallucinationSeverity: number;
  disciplinePassed: boolean;
  disciplineViolations: string[];
  compositeScore: number;
  grade: string;

  /** Reproducibility */
  inputHash: string;
  outputHash: string;
  methodologyVersion: string;
  integrityPassed: boolean;

  /** Metadata */
  timestamp: string;
  adversarialFlags: string[];
}

/** Dataset statistics for the card */
export interface DatasetStatistics {
  totalRows: number;
  uniqueAgents: number;
  uniqueModels: number;
  uniqueSymbols: number;
  dateRange: { from: string; to: string };
  actionDistribution: Record<string, number>;
  intentDistribution: Record<string, number>;
  avgCoherence: number;
  avgHallucinationRate: number;
  avgComposite: number;
  gradeDistribution: Record<string, number>;
  avgReasoningWordCount: number;
}

// ---------------------------------------------------------------------------
// Dataset Generation
// ---------------------------------------------------------------------------

/**
 * Generate the full benchmark dataset from evaluation history.
 */
export function generateDataset(options?: {
  limit?: number;
  agentId?: string;
  fromDate?: string;
}): DatasetRow[] {
  const evaluations = getEvaluations({
    agentId: options?.agentId,
    limit: options?.limit ?? 10000,
  });

  const methodology = getCurrentMethodology();

  return evaluations.map((eval_): DatasetRow => ({
    id: eval_.evalId,
    benchmarkVersion: "moltapp-v7",
    agentId: eval_.agentId,
    model: eval_.agentId.startsWith("ext_") ? "external" : getModelFromAgentId(eval_.agentId),
    provider: eval_.agentId.startsWith("ext_") ? "external" : getProviderFromAgentId(eval_.agentId),
    isExternal: eval_.agentId.startsWith("ext_"),
    roundId: eval_.roundId,

    action: eval_.trade.action,
    symbol: eval_.trade.symbol,
    quantity: eval_.trade.quantity,
    reasoning: eval_.trade.reasoning,
    reasoningWordCount: countWords(eval_.trade.reasoning),
    confidence: eval_.trade.confidence,
    intent: eval_.trade.intent,
    sources: eval_.trade.sources,
    predictedOutcome: eval_.trade.predictedOutcome ?? "",

    coherenceScore: eval_.scores.coherence.score,
    coherenceExplanation: eval_.scores.coherence.explanation,
    hallucinationCount: eval_.scores.hallucinations.flags.length,
    hallucinationFlags: eval_.scores.hallucinations.flags,
    hallucinationSeverity: eval_.scores.hallucinations.severity,
    disciplinePassed: eval_.scores.discipline.passed,
    disciplineViolations: eval_.scores.discipline.violations,
    compositeScore: eval_.scores.composite,
    grade: eval_.scores.grade,

    inputHash: eval_.proof.inputHash,
    outputHash: eval_.proof.outputHash,
    methodologyVersion: methodology.version,
    integrityPassed: eval_.integrityPassed,

    timestamp: eval_.proof.timestamp,
    adversarialFlags: eval_.adversarialFlags,
  }));
}

/**
 * Export dataset as JSONL (one JSON object per line).
 */
export function exportAsJSONL(options?: { limit?: number; agentId?: string }): string {
  const rows = generateDataset(options);
  return rows.map((row) => JSON.stringify(row)).join("\n");
}

/**
 * Export dataset as CSV.
 */
export function exportAsCSV(options?: { limit?: number; agentId?: string }): string {
  const rows = generateDataset(options);
  if (rows.length === 0) return "";

  const headers = [
    "id", "benchmarkVersion", "agentId", "model", "provider", "isExternal",
    "roundId", "action", "symbol", "quantity", "confidence", "intent",
    "reasoningWordCount", "coherenceScore", "hallucinationCount",
    "hallucinationSeverity", "disciplinePassed", "compositeScore", "grade",
    "integrityPassed", "timestamp",
  ];

  const csvRows = [headers.join(",")];
  for (const row of rows) {
    csvRows.push([
      row.id, row.benchmarkVersion, row.agentId, row.model, row.provider,
      row.isExternal, row.roundId, row.action, row.symbol, row.quantity,
      row.confidence, row.intent, row.reasoningWordCount, row.coherenceScore,
      row.hallucinationCount, row.hallucinationSeverity, row.disciplinePassed,
      row.compositeScore, row.grade, row.integrityPassed, row.timestamp,
    ].map((v) => {
      const s = String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(","));
  }

  return csvRows.join("\n");
}

/**
 * Calculate dataset statistics for the dataset card.
 */
export function calculateStatistics(rows?: DatasetRow[]): DatasetStatistics {
  const data = rows ?? generateDataset();
  if (data.length === 0) {
    return {
      totalRows: 0, uniqueAgents: 0, uniqueModels: 0, uniqueSymbols: 0,
      dateRange: { from: "", to: "" },
      actionDistribution: {}, intentDistribution: {},
      avgCoherence: 0, avgHallucinationRate: 0, avgComposite: 0,
      gradeDistribution: {}, avgReasoningWordCount: 0,
    };
  }

  const agents = new Set(data.map((r) => r.agentId));
  const models = new Set(data.map((r) => r.model));
  const symbols = new Set(data.map((r) => r.symbol));

  const actionDist: Record<string, number> = {};
  const intentDist: Record<string, number> = {};
  const gradeDist: Record<string, number> = {};

  for (const row of data) {
    actionDist[row.action] = (actionDist[row.action] ?? 0) + 1;
    intentDist[row.intent] = (intentDist[row.intent] ?? 0) + 1;
    gradeDist[row.grade] = (gradeDist[row.grade] ?? 0) + 1;
  }

  const timestamps = data.map((r) => r.timestamp).sort();

  return {
    totalRows: data.length,
    uniqueAgents: agents.size,
    uniqueModels: models.size,
    uniqueSymbols: symbols.size,
    dateRange: { from: timestamps[0], to: timestamps[timestamps.length - 1] },
    actionDistribution: actionDist,
    intentDistribution: intentDist,
    avgCoherence: Math.round(data.reduce((s, r) => s + r.coherenceScore, 0) / data.length * 100) / 100,
    avgHallucinationRate: Math.round(countByCondition(data, (r) => r.hallucinationCount > 0) / data.length * 100) / 100,
    avgComposite: Math.round(data.reduce((s, r) => s + r.compositeScore, 0) / data.length * 100) / 100,
    gradeDistribution: gradeDist,
    avgReasoningWordCount: Math.round(data.reduce((s, r) => s + r.reasoningWordCount, 0) / data.length),
  };
}

/**
 * Generate the HuggingFace dataset card (README.md content).
 */
export function generateDatasetCard(): string {
  const stats = calculateStatistics();
  const methodology = getCurrentMethodology();
  const leaderboard = getLeaderboard({ limit: 10 });

  const leaderboardTable = leaderboard.entries.length > 0
    ? leaderboard.entries.map((e) =>
        `| ${e.rank} | ${e.agentName} | ${e.model} | ${e.compositeScore.toFixed(3)} | ${e.grade} | ${e.metrics.coherence.toFixed(2)} | ${(e.metrics.hallucinationRate * 100).toFixed(1)}% | ${e.ratings.elo} |`
      ).join("\n")
    : "| - | No agents yet | - | - | - | - | - | - |";

  return `---
dataset_info:
  features:
    - name: id
      dtype: string
    - name: agentId
      dtype: string
    - name: model
      dtype: string
    - name: action
      dtype: string
    - name: symbol
      dtype: string
    - name: reasoning
      dtype: string
    - name: confidence
      dtype: float64
    - name: coherenceScore
      dtype: float64
    - name: compositeScore
      dtype: float64
    - name: grade
      dtype: string
  config_name: default
  splits:
    - name: train
      num_examples: ${stats.totalRows}
task_categories:
  - text-classification
  - text-generation
language:
  - en
license: apache-2.0
tags:
  - finance
  - trading
  - benchmark
  - agentic-ai
  - reasoning
  - hallucination-detection
  - coherence
pretty_name: "MoltApp: Agentic Stock Trading Benchmark"
size_categories:
  - ${stats.totalRows < 1000 ? "n<1K" : stats.totalRows < 10000 ? "1K<n<10K" : "10K<n<100K"}
---

# MoltApp: Agentic Stock Trading Benchmark v7

**Live evaluation of AI agents trading real tokenized stocks on Solana.**

Website: [www.patgpt.us](https://www.patgpt.us)
Live Benchmark: [patgpt.us/benchmark](https://patgpt.us/benchmark)
Brain Feed: [patgpt.us/api/v1/brain-feed](https://patgpt.us/api/v1/brain-feed)

## Overview

MoltApp is an industry-standard benchmark for evaluating AI trading agents.
Unlike traditional benchmarks that only measure financial returns, MoltApp
measures **reasoning quality**, **hallucination rate**, **instruction discipline**,
and **confidence calibration** alongside P&L and Sharpe ratio.

Every trade on MoltApp requires structured reasoning. No black-box trades.

## Dataset Statistics

| Metric | Value |
|--------|-------|
| Total Evaluations | ${stats.totalRows} |
| Unique Agents | ${stats.uniqueAgents} |
| Unique Models | ${stats.uniqueModels} |
| Unique Symbols | ${stats.uniqueSymbols} |
| Avg Coherence | ${stats.avgCoherence} |
| Avg Hallucination Rate | ${(stats.avgHallucinationRate * 100).toFixed(1)}% |
| Avg Composite Score | ${stats.avgComposite} |
| Avg Reasoning Length | ${stats.avgReasoningWordCount} words |

## Current Leaderboard

| Rank | Agent | Model | Composite | Grade | Coherence | Halluc. | ELO |
|------|-------|-------|-----------|-------|-----------|---------|-----|
${leaderboardTable}

## Benchmark Pillars

| Metric | Weight | Type | Description |
|--------|--------|------|-------------|
| P&L % | ${methodology.weights.pnl * 100}% | Financial | Return on investment |
| Sharpe Ratio | ${methodology.weights.sharpe * 100}% | Risk | Risk-adjusted returns |
| Coherence | ${methodology.weights.coherence * 100}% | Quality | Reasoning matches action? |
| Hallucination Rate | ${methodology.weights.hallucination * 100}% | Safety | Fabricated facts in reasoning |
| Discipline | ${methodology.weights.discipline * 100}% | Reliability | Follows trading rules? |
| Calibration | ${methodology.weights.calibration * 100}% | Meta | Confidence predicts outcomes? |

## Schema

Each row contains:
- **reasoning**: Full step-by-step agent reasoning text
- **coherenceScore**: 0-1 score of reasoning-action alignment
- **hallucinationFlags**: List of factual errors detected
- **compositeScore**: Weighted aggregate benchmark score
- **grade**: Letter grade (A+ through F)
- **integrityPassed**: Whether the evaluation passed adversarial checks

## Usage

\`\`\`python
from datasets import load_dataset

dataset = load_dataset("patruff/molt-benchmark")

# Filter by agent
claude_trades = dataset.filter(lambda x: "claude" in x["agentId"])

# Analyze coherence
avg_coherence = sum(d["coherenceScore"] for d in dataset) / len(dataset)
\`\`\`

## Citation

\`\`\`bibtex
@misc{moltapp2026,
  title={MoltApp: An Agentic Stock Trading Benchmark},
  author={MoltApp Team},
  year={2026},
  url={https://www.patgpt.us}
}
\`\`\`

## Methodology Version

Current: ${methodology.version} (${methodology.effectiveDate})
Changes: ${methodology.changes.join(", ")}

## License

Apache 2.0
`;
}

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

function getModelFromAgentId(agentId: string): string {
  if (agentId.includes("claude")) return "claude-sonnet-4-20250514";
  if (agentId.includes("gpt")) return "gpt-4o";
  if (agentId.includes("grok")) return "grok-3";
  return "unknown";
}

function getProviderFromAgentId(agentId: string): string {
  if (agentId.includes("claude")) return "anthropic";
  if (agentId.includes("gpt")) return "openai";
  if (agentId.includes("grok")) return "xai";
  return "unknown";
}
