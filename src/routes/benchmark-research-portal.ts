/**
 * Benchmark Research Portal
 *
 * Unified API for researchers to query, analyze, and download MoltApp
 * benchmark data. Designed for academic and industry research workflows.
 *
 * Routes:
 * - GET /dataset             — Download full dataset (JSONL/CSV)
 * - GET /dataset/statistics  — Dataset statistics and distributions
 * - GET /dataset/timeseries  — Time-series data for longitudinal studies
 * - GET /query               — Flexible query builder with filters
 * - GET /compare             — Cross-agent statistical comparison
 * - GET /hypothesis          — Hypothesis testing (t-test, chi-squared)
 * - GET /correlation         — Metric correlation matrix
 * - GET /schema              — Data schema documentation
 */

import { Hono } from "hono";
import { computeVariance, countByCondition, mean, round4, stdDev } from "../lib/math-utils.ts";
import { db } from "../db/index.ts";
import { tradeJustifications } from "../db/schema/trade-reasoning.ts";
import { desc, sql, eq, and, gte, lte } from "drizzle-orm";
import {
  buildDataset,
  formatAsJsonl,
  formatAsCsv,
  buildTimeSeries,
  type DatasetBundle,
} from "../services/benchmark-dataset-builder.ts";

export const benchmarkResearchPortalRoutes = new Hono();

// ---------------------------------------------------------------------------
// Dataset cache (refreshed every 5 minutes)
// ---------------------------------------------------------------------------

let cachedBundle: DatasetBundle | null = null;
let lastBuildTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function getDatasetBundle(): Promise<DatasetBundle> {
  const now = Date.now();
  if (cachedBundle && (now - lastBuildTime) < CACHE_TTL_MS) {
    return cachedBundle;
  }

  const rawData = await db
    .select()
    .from(tradeJustifications)
    .orderBy(desc(tradeJustifications.timestamp));

  cachedBundle = buildDataset(rawData as Parameters<typeof buildDataset>[0]);
  lastBuildTime = now;
  return cachedBundle;
}

// ---------------------------------------------------------------------------
// GET /dataset — Download full dataset
// ---------------------------------------------------------------------------

benchmarkResearchPortalRoutes.get("/dataset", async (c) => {
  const format = c.req.query("format") ?? "jsonl";
  const split = c.req.query("split") as "train" | "test" | "validation" | undefined;

  try {
    const bundle = await getDatasetBundle();
    let records = bundle.records;

    if (split) {
      records = records.filter((r) => r.split === split);
    }

    if (format === "csv") {
      const csv = formatAsCsv(records);
      c.header("Content-Type", "text/csv");
      c.header("Content-Disposition", `attachment; filename="moltapp-benchmark-${split ?? "full"}.csv"`);
      return c.body(csv);
    }

    const jsonl = formatAsJsonl(records);
    c.header("Content-Type", "application/jsonl");
    c.header("Content-Disposition", `attachment; filename="moltapp-benchmark-${split ?? "full"}.jsonl"`);
    return c.body(jsonl);
  } catch {
    return c.json({ ok: false, error: "Failed to build dataset" }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /dataset/statistics — Dataset statistics
// ---------------------------------------------------------------------------

benchmarkResearchPortalRoutes.get("/dataset/statistics", async (c) => {
  try {
    const bundle = await getDatasetBundle();

    return c.json({
      ok: true,
      statistics: bundle.statistics,
      metadata: bundle.metadata,
      round_summary: {
        total_rounds: bundle.rounds.length,
        consensus_distribution: countBy(bundle.rounds, (r) => r.consensus),
        avg_agents_per_round: bundle.rounds.length > 0
          ? Math.round((bundle.rounds.reduce((s, r) => s + r.agent_count, 0) / bundle.rounds.length) * 10) / 10
          : 0,
      },
    });
  } catch {
    return c.json({ ok: false, error: "Failed to compute statistics" }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /dataset/timeseries — Time-series data
// ---------------------------------------------------------------------------

benchmarkResearchPortalRoutes.get("/dataset/timeseries", async (c) => {
  try {
    const bundle = await getDatasetBundle();
    const timeSeries = buildTimeSeries(bundle.records);

    return c.json({
      ok: true,
      timeseries: timeSeries,
      datapoints: timeSeries.length,
      agents: [...new Set(timeSeries.map((t) => t.agent_id))],
    });
  } catch {
    return c.json({ ok: false, error: "Failed to build time series" }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /query — Flexible query builder
// ---------------------------------------------------------------------------

benchmarkResearchPortalRoutes.get("/query", async (c) => {
  const agentId = c.req.query("agent");
  const action = c.req.query("action");
  const intent = c.req.query("intent");
  const symbol = c.req.query("symbol");
  const minCoherence = parseFloat(c.req.query("minCoherence") ?? "0");
  const maxCoherence = parseFloat(c.req.query("maxCoherence") ?? "1");
  const minConfidence = parseFloat(c.req.query("minConfidence") ?? "0");
  const maxConfidence = parseFloat(c.req.query("maxConfidence") ?? "1");
  const hasHallucinations = c.req.query("hasHallucinations");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "100", 10), 500);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);

  try {
    const bundle = await getDatasetBundle();
    let records = bundle.records;

    // Apply filters
    if (agentId) records = records.filter((r) => r.agent_id === agentId);
    if (action) records = records.filter((r) => r.action === action);
    if (intent) records = records.filter((r) => r.intent === intent);
    if (symbol) records = records.filter((r) => r.symbol === symbol);
    if (minCoherence > 0) records = records.filter((r) => r.coherence_score >= minCoherence);
    if (maxCoherence < 1) records = records.filter((r) => r.coherence_score <= maxCoherence);
    if (minConfidence > 0) records = records.filter((r) => r.confidence >= minConfidence);
    if (maxConfidence < 1) records = records.filter((r) => r.confidence <= maxConfidence);
    if (hasHallucinations === "true") records = records.filter((r) => r.hallucination_count > 0);
    if (hasHallucinations === "false") records = records.filter((r) => r.hallucination_count === 0);

    const total = records.length;
    const paginated = records.slice(offset, offset + limit);

    return c.json({
      ok: true,
      results: paginated,
      total,
      limit,
      offset,
      filters_applied: {
        agent: agentId ?? "all",
        action: action ?? "all",
        intent: intent ?? "all",
        symbol: symbol ?? "all",
        coherence_range: [minCoherence, maxCoherence],
        confidence_range: [minConfidence, maxConfidence],
        has_hallucinations: hasHallucinations ?? "any",
      },
    });
  } catch {
    return c.json({ ok: false, error: "Query failed" }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /compare — Cross-agent statistical comparison
// ---------------------------------------------------------------------------

benchmarkResearchPortalRoutes.get("/compare", async (c) => {
  try {
    const bundle = await getDatasetBundle();
    const agentIds = Object.keys(bundle.statistics.agent_distribution);

    const comparison: Record<string, {
      agent_id: string;
      trade_count: number;
      coherence: { mean: number; std: number };
      confidence: { mean: number; std: number };
      hallucination_rate: number;
      discipline_rate: number;
      action_distribution: Record<string, number>;
      intent_distribution: Record<string, number>;
      avg_reasoning_length: number;
    }> = {};

    for (const agentId of agentIds) {
      const agentRecords = bundle.records.filter((r) => r.agent_id === agentId);
      const cohValues = agentRecords.map((r) => r.coherence_score);
      const confValues = agentRecords.map((r) => r.confidence);
      const halCount = countByCondition(agentRecords, (r) => r.hallucination_count > 0);
      const discCount = countByCondition(agentRecords, (r) => r.discipline_pass);
      const total = agentRecords.length;

      comparison[agentId] = {
        agent_id: agentId,
        trade_count: total,
        coherence: {
          mean: round4(mean(cohValues)),
          std: round4(stdDev(cohValues)),
        },
        confidence: {
          mean: round4(mean(confValues)),
          std: round4(stdDev(confValues)),
        },
        hallucination_rate: total > 0 ? round4(halCount / total) : 0,
        discipline_rate: total > 0 ? round4(discCount / total) : 1,
        action_distribution: countBy(agentRecords, (r) => r.action),
        intent_distribution: countBy(agentRecords, (r) => r.intent),
        avg_reasoning_length: round4(mean(agentRecords.map((r) => r.reasoning_word_count))),
      };
    }

    // Compute pairwise effect sizes (Cohen's d for coherence)
    const pairwiseEffects: { agent_a: string; agent_b: string; cohens_d: number; metric: string }[] = [];
    for (let i = 0; i < agentIds.length; i++) {
      for (let j = i + 1; j < agentIds.length; j++) {
        const aRecords = bundle.records.filter((r) => r.agent_id === agentIds[i]);
        const bRecords = bundle.records.filter((r) => r.agent_id === agentIds[j]);
        const aCoh = aRecords.map((r) => r.coherence_score);
        const bCoh = bRecords.map((r) => r.coherence_score);
        const d = cohensD(aCoh, bCoh);
        pairwiseEffects.push({
          agent_a: agentIds[i],
          agent_b: agentIds[j],
          cohens_d: round4(d),
          metric: "coherence",
        });
      }
    }

    return c.json({
      ok: true,
      agents: comparison,
      pairwise_effects: pairwiseEffects,
      total_records: bundle.records.length,
    });
  } catch {
    return c.json({ ok: false, error: "Comparison failed" }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /hypothesis — Hypothesis testing
// ---------------------------------------------------------------------------

benchmarkResearchPortalRoutes.get("/hypothesis", async (c) => {
  const metric = c.req.query("metric") ?? "coherence_score";
  const groupBy = c.req.query("groupBy") ?? "agent_id";

  try {
    const bundle = await getDatasetBundle();

    // Group records
    const groups = new Map<string, number[]>();
    for (const r of bundle.records) {
      const key = groupBy === "agent_id" ? r.agent_id
        : groupBy === "action" ? r.action
        : groupBy === "intent" ? r.intent
        : r.agent_id;

      const value = metric === "coherence_score" ? r.coherence_score
        : metric === "confidence" ? r.confidence
        : metric === "hallucination_count" ? r.hallucination_count
        : metric === "reasoning_word_count" ? r.reasoning_word_count
        : r.coherence_score;

      const list = groups.get(key) ?? [];
      list.push(value);
      groups.set(key, list);
    }

    // Compute group statistics
    const groupStats: Record<string, { n: number; mean: number; std: number; median: number }> = {};
    for (const [key, values] of groups) {
      const sorted = [...values].sort((a, b) => a - b);
      groupStats[key] = {
        n: values.length,
        mean: round4(mean(values)),
        std: round4(stdDev(values)),
        median: round4(sorted[Math.floor(sorted.length / 2)] ?? 0),
      };
    }

    // Kruskal-Wallis H-test approximation (non-parametric ANOVA)
    const allValues = bundle.records.map((r) =>
      metric === "coherence_score" ? r.coherence_score
      : metric === "confidence" ? r.confidence
      : r.coherence_score,
    );
    const grandMean = mean(allValues);
    let ssb = 0; // between-group sum of squares
    let ssw = 0; // within-group sum of squares
    for (const [, values] of groups) {
      const groupMean = mean(values);
      ssb += values.length * (groupMean - grandMean) ** 2;
      for (const v of values) {
        ssw += (v - groupMean) ** 2;
      }
    }
    const dfBetween = groups.size - 1;
    const dfWithin = allValues.length - groups.size;
    const fStatistic = dfBetween > 0 && dfWithin > 0
      ? (ssb / dfBetween) / (ssw / dfWithin)
      : 0;

    return c.json({
      ok: true,
      test: "one-way-anova-approximation",
      metric,
      group_by: groupBy,
      groups: groupStats,
      anova: {
        f_statistic: round4(fStatistic),
        df_between: dfBetween,
        df_within: dfWithin,
        significant: fStatistic > 3.0, // Rough threshold for p<0.05
        note: "Approximate F-test. For rigorous analysis, download the dataset and use scipy.stats.f_oneway",
      },
    });
  } catch {
    return c.json({ ok: false, error: "Hypothesis test failed" }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /correlation — Metric correlation matrix
// ---------------------------------------------------------------------------

benchmarkResearchPortalRoutes.get("/correlation", async (c) => {
  try {
    const bundle = await getDatasetBundle();

    const metrics = ["coherence_score", "confidence", "hallucination_count", "reasoning_word_count", "source_count"];
    const vectors: Record<string, number[]> = {};

    for (const m of metrics) {
      vectors[m] = bundle.records.map((r) => {
        switch (m) {
          case "coherence_score": return r.coherence_score;
          case "confidence": return r.confidence;
          case "hallucination_count": return r.hallucination_count;
          case "reasoning_word_count": return r.reasoning_word_count;
          case "source_count": return r.source_count;
          default: return 0;
        }
      });
    }

    // Compute Pearson correlation matrix
    const matrix: Record<string, Record<string, number>> = {};
    for (const a of metrics) {
      matrix[a] = {};
      for (const b of metrics) {
        matrix[a][b] = round4(pearsonCorrelation(vectors[a], vectors[b]));
      }
    }

    return c.json({
      ok: true,
      correlation_matrix: matrix,
      metrics,
      n: bundle.records.length,
      interpretation: {
        "> 0.7": "Strong positive correlation",
        "0.4 - 0.7": "Moderate positive correlation",
        "-0.4 - 0.4": "Weak or no correlation",
        "< -0.4": "Moderate to strong negative correlation",
      },
    });
  } catch {
    return c.json({ ok: false, error: "Correlation computation failed" }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /schema — Data schema documentation
// ---------------------------------------------------------------------------

benchmarkResearchPortalRoutes.get("/schema", (c) => {
  return c.json({
    ok: true,
    schema: {
      name: "MoltApp Benchmark Dataset Schema v2",
      description: "Structured dataset of AI agent trading decisions with reasoning quality metrics",
      fields: {
        id: { type: "string", description: "Unique record identifier" },
        split: { type: "string", enum: ["train", "test", "validation"], description: "Dataset split" },
        agent_id: { type: "string", description: "Agent identifier" },
        agent_provider: { type: "string", enum: ["anthropic", "openai", "xai"], description: "LLM provider" },
        action: { type: "string", enum: ["buy", "sell", "hold"], description: "Trade action" },
        symbol: { type: "string", description: "Stock ticker symbol" },
        quantity: { type: "number", description: "Trade quantity" },
        reasoning: { type: "string", description: "Full step-by-step reasoning text" },
        reasoning_word_count: { type: "integer", description: "Word count of reasoning" },
        confidence: { type: "number", range: [0, 1], description: "Self-reported confidence" },
        intent: { type: "string", enum: ["momentum", "mean_reversion", "value", "hedge", "contrarian", "arbitrage"], description: "Strategy intent" },
        sources: { type: "string[]", description: "Data sources cited" },
        source_count: { type: "integer", description: "Number of sources cited" },
        predicted_outcome: { type: "string|null", description: "What agent expected" },
        actual_outcome: { type: "string|null", description: "What actually happened" },
        coherence_score: { type: "number", range: [0, 1], description: "NLP coherence score" },
        hallucination_count: { type: "integer", description: "Number of factual errors detected" },
        discipline_pass: { type: "boolean", description: "Whether agent followed trading rules" },
        round_id: { type: "string|null", description: "Trading round identifier" },
        timestamp: { type: "ISO 8601", description: "When the decision was made" },
        day_of_week: { type: "integer", range: [0, 6], description: "0=Sunday" },
        hour_of_day: { type: "integer", range: [0, 23], description: "UTC hour" },
      },
      download_formats: ["jsonl", "csv"],
      endpoints: {
        full_dataset: "/api/v1/research-portal/dataset",
        statistics: "/api/v1/research-portal/dataset/statistics",
        timeseries: "/api/v1/research-portal/dataset/timeseries",
        query: "/api/v1/research-portal/query",
        compare: "/api/v1/research-portal/compare",
        hypothesis: "/api/v1/research-portal/hypothesis",
        correlation: "/api/v1/research-portal/correlation",
      },
      citation: {
        bibtex: `@misc{moltapp2026,\n  title={MoltApp: An Agentic Stock Trading Benchmark},\n  author={MoltApp Team},\n  year={2026},\n  url={https://www.patgpt.us}\n}`,
      },
    },
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------


function countBy<T>(items: T[], keyFn: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function cohensD(a: number[], b: number[]): number {
  if (a.length < 2 || b.length < 2) return 0;
  const meanA = mean(a);
  const meanB = mean(b);
  const varA = computeVariance(a);
  const varB = computeVariance(b);
  const pooledStd = Math.sqrt(((a.length - 1) * varA + (b.length - 1) * varB) / (a.length + b.length - 2));
  return pooledStd > 0 ? (meanA - meanB) / pooledStd : 0;
}

function pearsonCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 2) return 0;
  const n = x.length;
  const mx = mean(x);
  const my = mean(y);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const xi = x[i] - mx;
    const yi = y[i] - my;
    num += xi * yi;
    dx += xi * xi;
    dy += yi * yi;
  }
  const denom = Math.sqrt(dx * dy);
  return denom > 0 ? num / denom : 0;
}
