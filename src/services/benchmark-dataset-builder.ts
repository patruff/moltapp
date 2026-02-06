/**
 * Benchmark Dataset Builder
 *
 * Transforms raw trade justifications into structured benchmark datasets
 * suitable for ML training, evaluation, and HuggingFace publication.
 *
 * Features:
 * - Per-round aggregation with consensus metrics
 * - Train/test/validation split generation
 * - Statistical summary computation (mean, std, percentiles)
 * - Crosstab analysis (agent x intent, agent x regime)
 * - Time-series export for longitudinal studies
 * - JSONL + Parquet-ready formatting
 *
 * This is the data science backbone of MoltApp's benchmark.
 */

import { mean } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DatasetRecord {
  /** Unique record ID */
  id: string;
  /** Which split this record belongs to */
  split: "train" | "test" | "validation";
  /** Agent identifier */
  agent_id: string;
  /** Agent's LLM provider */
  agent_provider: string;
  /** Trade action */
  action: "buy" | "sell" | "hold";
  /** Stock symbol */
  symbol: string;
  /** Quantity traded */
  quantity: number;
  /** Full reasoning text */
  reasoning: string;
  /** Reasoning word count */
  reasoning_word_count: number;
  /** Confidence 0-1 */
  confidence: number;
  /** Trading intent classification */
  intent: string;
  /** Data sources cited */
  sources: string[];
  /** Number of sources cited */
  source_count: number;
  /** Predicted outcome text */
  predicted_outcome: string | null;
  /** Actual outcome text */
  actual_outcome: string | null;
  /** Coherence score 0-1 */
  coherence_score: number;
  /** Number of hallucination flags */
  hallucination_count: number;
  /** Hallucination flags detail */
  hallucination_flags: string[];
  /** Whether agent followed rules */
  discipline_pass: boolean;
  /** Trading round ID */
  round_id: string | null;
  /** ISO timestamp */
  timestamp: string;
  /** Day of week (0=Sunday) */
  day_of_week: number;
  /** Hour of day (0-23) */
  hour_of_day: number;
}

export interface RoundAggregation {
  round_id: string;
  timestamp: string;
  agent_count: number;
  buy_count: number;
  sell_count: number;
  hold_count: number;
  consensus: "unanimous" | "majority" | "split" | "all_hold";
  avg_coherence: number;
  avg_confidence: number;
  total_hallucinations: number;
  discipline_pass_rate: number;
  dominant_intent: string;
  symbols_traded: string[];
}

export interface DatasetStatistics {
  total_records: number;
  split_counts: { train: number; test: number; validation: number };
  agent_distribution: Record<string, number>;
  action_distribution: Record<string, number>;
  intent_distribution: Record<string, number>;
  symbol_distribution: Record<string, number>;
  coherence_stats: DistributionStats;
  confidence_stats: DistributionStats;
  hallucination_stats: DistributionStats;
  reasoning_length_stats: DistributionStats;
  discipline_pass_rate: number;
  temporal_coverage: { first: string; last: string; total_days: number };
  round_count: number;
  crosstab_agent_intent: Record<string, Record<string, number>>;
  crosstab_agent_action: Record<string, Record<string, number>>;
}

export interface DistributionStats {
  mean: number;
  std: number;
  min: number;
  max: number;
  p25: number;
  p50: number;
  p75: number;
}

export interface DatasetBundle {
  records: DatasetRecord[];
  rounds: RoundAggregation[];
  statistics: DatasetStatistics;
  metadata: DatasetMetadata;
}

export interface DatasetMetadata {
  benchmark: string;
  version: string;
  generated_at: string;
  schema_version: string;
  metrics_measured: string[];
  split_ratios: { train: number; test: number; validation: number };
}

// ---------------------------------------------------------------------------
// Raw input type (from DB)
// ---------------------------------------------------------------------------

interface RawJustification {
  id: string;
  agentId: string;
  action: string;
  symbol: string;
  quantity: number | null;
  reasoning: string;
  confidence: number;
  intent: string;
  sources: string[] | null;
  predictedOutcome: string | null;
  actualOutcome: string | null;
  coherenceScore: number | null;
  hallucinationFlags: string[] | null;
  disciplinePass: string | null;
  roundId: string | null;
  timestamp: Date | null;
}

// ---------------------------------------------------------------------------
// Core Builder
// ---------------------------------------------------------------------------

/**
 * Build a complete benchmark dataset from raw trade justifications.
 *
 * @param rawData - Array of justification records from the database
 * @param splitRatios - Train/test/validation split ratios (must sum to 1)
 * @returns Complete dataset bundle ready for export
 */
export function buildDataset(
  rawData: RawJustification[],
  splitRatios = { train: 0.7, test: 0.2, validation: 0.1 },
): DatasetBundle {
  // Sort by timestamp for consistent splitting
  const sorted = [...rawData].sort((a, b) => {
    const ta = a.timestamp?.getTime() ?? 0;
    const tb = b.timestamp?.getTime() ?? 0;
    return ta - tb;
  });

  // Assign splits (temporal split — later data in test/val)
  const trainEnd = Math.floor(sorted.length * splitRatios.train);
  const testEnd = trainEnd + Math.floor(sorted.length * splitRatios.test);

  const records: DatasetRecord[] = sorted.map((raw, index) => {
    let split: "train" | "test" | "validation";
    if (index < trainEnd) split = "train";
    else if (index < testEnd) split = "test";
    else split = "validation";

    const ts = raw.timestamp ?? new Date();
    const sources = raw.sources ?? [];
    const hallucinationFlags = raw.hallucinationFlags ?? [];
    const words = raw.reasoning.split(/\s+/).filter((w) => w.length > 0);

    return {
      id: raw.id,
      split,
      agent_id: raw.agentId,
      agent_provider: inferProvider(raw.agentId),
      action: raw.action as "buy" | "sell" | "hold",
      symbol: raw.symbol,
      quantity: raw.quantity ?? 0,
      reasoning: raw.reasoning,
      reasoning_word_count: words.length,
      confidence: raw.confidence,
      intent: raw.intent,
      sources,
      source_count: sources.length,
      predicted_outcome: raw.predictedOutcome,
      actual_outcome: raw.actualOutcome,
      coherence_score: raw.coherenceScore ?? 0,
      hallucination_count: hallucinationFlags.length,
      hallucination_flags: hallucinationFlags,
      discipline_pass: raw.disciplinePass === "pass",
      round_id: raw.roundId,
      timestamp: ts.toISOString(),
      day_of_week: ts.getDay(),
      hour_of_day: ts.getHours(),
    };
  });

  // Build round aggregations
  const rounds = buildRoundAggregations(records);

  // Compute statistics
  const statistics = computeStatistics(records);

  const metadata: DatasetMetadata = {
    benchmark: "moltapp-v5",
    version: new Date().toISOString().split("T")[0],
    generated_at: new Date().toISOString(),
    schema_version: "2.0.0",
    metrics_measured: [
      "coherence_score",
      "hallucination_count",
      "discipline_pass",
      "confidence",
      "reasoning_word_count",
      "source_count",
    ],
    split_ratios: splitRatios,
  };

  return { records, rounds, statistics, metadata };
}

// ---------------------------------------------------------------------------
// Round Aggregation
// ---------------------------------------------------------------------------

function buildRoundAggregations(records: DatasetRecord[]): RoundAggregation[] {
  const byRound = new Map<string, DatasetRecord[]>();
  for (const r of records) {
    if (!r.round_id) continue;
    const list = byRound.get(r.round_id) ?? [];
    list.push(r);
    byRound.set(r.round_id, list);
  }

  const rounds: RoundAggregation[] = [];
  for (const [roundId, roundRecords] of byRound) {
    const buyCount = roundRecords.filter((r) => r.action === "buy").length;
    const sellCount = roundRecords.filter((r) => r.action === "sell").length;
    const holdCount = roundRecords.filter((r) => r.action === "hold").length;

    let consensus: RoundAggregation["consensus"];
    const nonHold = buyCount + sellCount;
    if (nonHold === 0) consensus = "all_hold";
    else if (buyCount === nonHold || sellCount === nonHold) consensus = "unanimous";
    else if (buyCount > sellCount * 2 || sellCount > buyCount * 2) consensus = "majority";
    else consensus = "split";

    // Count intents
    const intentCounts = new Map<string, number>();
    for (const r of roundRecords) {
      intentCounts.set(r.intent, (intentCounts.get(r.intent) ?? 0) + 1);
    }
    const dominantIntent = Array.from(intentCounts.entries())
      .sort(([, a], [, b]) => b - a)[0]?.[0] ?? "unknown";

    const symbols = [...new Set(roundRecords.filter((r) => r.action !== "hold").map((r) => r.symbol))];
    const disciplinePasses = roundRecords.filter((r) => r.discipline_pass).length;

    rounds.push({
      round_id: roundId,
      timestamp: roundRecords[0].timestamp,
      agent_count: roundRecords.length,
      buy_count: buyCount,
      sell_count: sellCount,
      hold_count: holdCount,
      consensus,
      avg_coherence: mean(roundRecords.map((r) => r.coherence_score)),
      avg_confidence: mean(roundRecords.map((r) => r.confidence)),
      total_hallucinations: roundRecords.reduce((s, r) => s + r.hallucination_count, 0),
      discipline_pass_rate: roundRecords.length > 0 ? disciplinePasses / roundRecords.length : 1,
      dominant_intent: dominantIntent,
      symbols_traded: symbols,
    });
  }

  return rounds.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

function computeStatistics(records: DatasetRecord[]): DatasetStatistics {
  const splitCounts = { train: 0, test: 0, validation: 0 };
  const agentDist: Record<string, number> = {};
  const actionDist: Record<string, number> = {};
  const intentDist: Record<string, number> = {};
  const symbolDist: Record<string, number> = {};
  const crosstabAgentIntent: Record<string, Record<string, number>> = {};
  const crosstabAgentAction: Record<string, Record<string, number>> = {};

  for (const r of records) {
    splitCounts[r.split]++;
    agentDist[r.agent_id] = (agentDist[r.agent_id] ?? 0) + 1;
    actionDist[r.action] = (actionDist[r.action] ?? 0) + 1;
    intentDist[r.intent] = (intentDist[r.intent] ?? 0) + 1;
    symbolDist[r.symbol] = (symbolDist[r.symbol] ?? 0) + 1;

    // Crosstabs
    if (!crosstabAgentIntent[r.agent_id]) crosstabAgentIntent[r.agent_id] = {};
    crosstabAgentIntent[r.agent_id][r.intent] = (crosstabAgentIntent[r.agent_id][r.intent] ?? 0) + 1;

    if (!crosstabAgentAction[r.agent_id]) crosstabAgentAction[r.agent_id] = {};
    crosstabAgentAction[r.agent_id][r.action] = (crosstabAgentAction[r.agent_id][r.action] ?? 0) + 1;
  }

  const coherenceValues = records.map((r) => r.coherence_score);
  const confidenceValues = records.map((r) => r.confidence);
  const hallucinationValues = records.map((r) => r.hallucination_count);
  const lengthValues = records.map((r) => r.reasoning_word_count);

  const disciplinePasses = records.filter((r) => r.discipline_pass).length;
  const timestamps = records.map((r) => r.timestamp).sort();
  const roundIds = new Set(records.map((r) => r.round_id).filter(Boolean));

  let totalDays = 0;
  if (timestamps.length >= 2) {
    const first = new Date(timestamps[0]);
    const last = new Date(timestamps[timestamps.length - 1]);
    totalDays = Math.ceil((last.getTime() - first.getTime()) / (1000 * 60 * 60 * 24));
  }

  return {
    total_records: records.length,
    split_counts: splitCounts,
    agent_distribution: agentDist,
    action_distribution: actionDist,
    intent_distribution: intentDist,
    symbol_distribution: symbolDist,
    coherence_stats: computeDistributionStats(coherenceValues),
    confidence_stats: computeDistributionStats(confidenceValues),
    hallucination_stats: computeDistributionStats(hallucinationValues),
    reasoning_length_stats: computeDistributionStats(lengthValues),
    discipline_pass_rate: records.length > 0 ? round4(disciplinePasses / records.length) : 1,
    temporal_coverage: {
      first: timestamps[0] ?? "",
      last: timestamps[timestamps.length - 1] ?? "",
      total_days: totalDays,
    },
    round_count: roundIds.size,
    crosstab_agent_intent: crosstabAgentIntent,
    crosstab_agent_action: crosstabAgentAction,
  };
}

function computeDistributionStats(values: number[]): DistributionStats {
  if (values.length === 0) {
    return { mean: 0, std: 0, min: 0, max: 0, p25: 0, p50: 0, p75: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const m = mean(values);
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length;

  return {
    mean: round4(m),
    std: round4(Math.sqrt(variance)),
    min: round4(sorted[0]),
    max: round4(sorted[sorted.length - 1]),
    p25: round4(percentile(sorted, 25)),
    p50: round4(percentile(sorted, 50)),
    p75: round4(percentile(sorted, 75)),
  };
}

// ---------------------------------------------------------------------------
// Export Formatters
// ---------------------------------------------------------------------------

/**
 * Format dataset as JSONL (one JSON object per line).
 */
export function formatAsJsonl(records: DatasetRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join("\n");
}

/**
 * Format dataset as CSV with headers.
 */
export function formatAsCsv(records: DatasetRecord[]): string {
  const headers = [
    "id", "split", "agent_id", "agent_provider", "action", "symbol",
    "quantity", "reasoning_word_count", "confidence", "intent",
    "source_count", "coherence_score", "hallucination_count",
    "discipline_pass", "round_id", "timestamp", "day_of_week", "hour_of_day",
  ];

  const rows = records.map((r) =>
    [
      r.id, r.split, r.agent_id, r.agent_provider, r.action, r.symbol,
      r.quantity, r.reasoning_word_count, r.confidence, r.intent,
      r.source_count, r.coherence_score, r.hallucination_count,
      r.discipline_pass ? 1 : 0, r.round_id ?? "", r.timestamp,
      r.day_of_week, r.hour_of_day,
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","),
  );

  return [headers.join(","), ...rows].join("\n");
}

/**
 * Generate a time-series dataset grouped by date for trend analysis.
 */
export function buildTimeSeries(records: DatasetRecord[]): {
  date: string;
  agent_id: string;
  trade_count: number;
  avg_coherence: number;
  avg_confidence: number;
  hallucination_rate: number;
  discipline_rate: number;
  buy_ratio: number;
}[] {
  // Group by date + agent
  const groups = new Map<string, DatasetRecord[]>();
  for (const r of records) {
    const date = r.timestamp.split("T")[0];
    const key = `${date}:${r.agent_id}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }

  const series: ReturnType<typeof buildTimeSeries> = [];
  for (const [key, groupRecords] of groups) {
    const [date, agentId] = key.split(":");
    const total = groupRecords.length;
    const halCount = groupRecords.filter((r) => r.hallucination_count > 0).length;
    const discCount = groupRecords.filter((r) => r.discipline_pass).length;
    const buyCount = groupRecords.filter((r) => r.action === "buy").length;

    series.push({
      date,
      agent_id: agentId,
      trade_count: total,
      avg_coherence: round4(mean(groupRecords.map((r) => r.coherence_score))),
      avg_confidence: round4(mean(groupRecords.map((r) => r.confidence))),
      hallucination_rate: round4(halCount / total),
      discipline_rate: round4(discCount / total),
      buy_ratio: round4(buyCount / total),
    });
  }

  return series.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inferProvider(agentId: string): string {
  if (agentId.includes("claude")) return "anthropic";
  if (agentId.includes("gpt")) return "openai";
  if (agentId.includes("grok")) return "xai";
  return "unknown";
}


function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
