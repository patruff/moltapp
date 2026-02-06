/**
 * Benchmark Export API Routes
 *
 * Researcher-facing bulk data export API for the MoltApp AI Trading Benchmark.
 * Provides efficient data extraction in multiple formats for analysis,
 * model training, and HuggingFace dataset publishing.
 *
 * Routes:
 * - GET /export/jsonl         -- Stream all trade justifications as JSONL
 * - GET /export/csv           -- Export as CSV with all benchmark fields
 * - GET /export/summary       -- Aggregate statistics per agent
 * - GET /export/dataset-card  -- Generate HuggingFace-compatible dataset card
 *
 * All endpoints support date range filtering via `from` and `to` query params
 * (ISO 8601 timestamps, e.g. ?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z).
 */

import { Hono } from "hono";
import { round3 } from "../lib/math-utils.ts";
import { errorMessage } from "../lib/errors.ts";
import { db } from "../db/index.ts";
import { tradeJustifications, benchmarkSnapshots } from "../db/schema/trade-reasoning.ts";
import { desc, sql, eq, and, gte, lte } from "drizzle-orm";
import { getAgentConfigs } from "../agents/orchestrator.ts";

export const benchmarkExportRoutes = new Hono();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a WHERE clause for optional date range filtering. */
function buildDateFilter(from?: string, to?: string) {
  const conditions = [];
  if (from) {
    const fromDate = new Date(from);
    if (!isNaN(fromDate.getTime())) {
      conditions.push(gte(tradeJustifications.timestamp, fromDate));
    }
  }
  if (to) {
    const toDate = new Date(to);
    if (!isNaN(toDate.getTime())) {
      conditions.push(lte(tradeJustifications.timestamp, toDate));
    }
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}

/** Escape a value for safe CSV output (RFC 4180). */
function csvEscape(value: unknown): string {
  const str = value == null ? "" : String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Format a raw DB record into a flat benchmark object. */
function formatRecord(r: typeof tradeJustifications.$inferSelect) {
  return {
    id: r.id,
    agent_id: r.agentId,
    action: r.action,
    symbol: r.symbol,
    quantity: r.quantity ?? 0,
    reasoning: r.reasoning,
    confidence: r.confidence,
    intent: r.intent,
    sources: r.sources ?? [],
    predicted_outcome: r.predictedOutcome ?? null,
    actual_outcome: r.actualOutcome ?? null,
    coherence_score: r.coherenceScore ?? null,
    hallucination_flags: r.hallucinationFlags ?? [],
    discipline_pass: r.disciplinePass === "pass",
    round_id: r.roundId ?? null,
    timestamp: r.timestamp?.toISOString() ?? null,
  };
}

// ---------------------------------------------------------------------------
// GET /export/jsonl -- Stream trade justifications as newline-delimited JSON
// ---------------------------------------------------------------------------

/**
 * JSONL export for large-scale dataset consumption.
 * Each line is a self-contained JSON object -- ideal for streaming parsers,
 * HuggingFace datasets, and tools like `jq`.
 *
 * Query params:
 *   limit  -- max records (default 10000, max 50000)
 *   from   -- ISO 8601 start timestamp
 *   to     -- ISO 8601 end timestamp
 */
benchmarkExportRoutes.get("/export/jsonl", async (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "10000", 10), 50000);
  const dateFilter = buildDateFilter(c.req.query("from"), c.req.query("to"));

  try {
    const records = await db
      .select()
      .from(tradeJustifications)
      .where(dateFilter)
      .orderBy(desc(tradeJustifications.timestamp))
      .limit(limit);

    const lines = records.map((r: any) => JSON.stringify(formatRecord(r)));
    const body = lines.join("\n") + (lines.length > 0 ? "\n" : "");

    c.header("Content-Type", "application/x-ndjson");
    c.header("Content-Disposition", 'attachment; filename="molt-benchmark.jsonl"');
    c.header("X-Record-Count", String(lines.length));
    return c.body(body);
  } catch (err) {
    // Fallback: return empty JSONL with error metadata
    c.header("Content-Type", "application/x-ndjson");
    c.header("X-Error", err instanceof Error ? err.message : "unknown");
    return c.body("");
  }
});

// ---------------------------------------------------------------------------
// GET /export/csv -- Export as CSV with all benchmark fields
// ---------------------------------------------------------------------------

/**
 * CSV export with proper RFC 4180 escaping.
 * Includes all benchmark-relevant columns for spreadsheet/notebook analysis.
 *
 * Query params:
 *   limit  -- max records (default 10000, max 50000)
 *   from   -- ISO 8601 start timestamp
 *   to     -- ISO 8601 end timestamp
 */
benchmarkExportRoutes.get("/export/csv", async (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "10000", 10), 50000);
  const dateFilter = buildDateFilter(c.req.query("from"), c.req.query("to"));

  const headers = [
    "id", "agent_id", "action", "symbol", "quantity", "confidence",
    "intent", "coherence_score", "discipline_pass", "hallucination_count",
    "reasoning_length", "sources_count", "predicted_outcome", "actual_outcome",
    "round_id", "timestamp",
  ];

  try {
    const records = await db
      .select()
      .from(tradeJustifications)
      .where(dateFilter)
      .orderBy(desc(tradeJustifications.timestamp))
      .limit(limit);

    const rows = records.map((r: any) => [
      r.id,
      r.agentId,
      r.action,
      r.symbol,
      r.quantity ?? 0,
      r.confidence,
      r.intent,
      r.coherenceScore ?? "",
      r.disciplinePass === "pass" ? "true" : "false",
      Array.isArray(r.hallucinationFlags) ? (r.hallucinationFlags as string[]).length : 0,
      r.reasoning.length,
      Array.isArray(r.sources) ? (r.sources as string[]).length : 0,
      r.predictedOutcome ?? "",
      r.actualOutcome ?? "",
      r.roundId ?? "",
      r.timestamp?.toISOString() ?? "",
    ]);

    const csv = [
      headers.join(","),
      ...rows.map((row: any) => row.map(csvEscape).join(",")),
    ].join("\n");

    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", 'attachment; filename="molt-benchmark.csv"');
    c.header("X-Record-Count", String(rows.length));
    return c.body(csv);
  } catch (err) {
    // Fallback: return headers-only CSV
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("X-Error", err instanceof Error ? err.message : "unknown");
    return c.body(headers.join(",") + "\n");
  }
});

// ---------------------------------------------------------------------------
// GET /export/summary -- Per-agent aggregate statistics
// ---------------------------------------------------------------------------

/**
 * Aggregate benchmark statistics grouped by agent.
 * Computes composite scores, intent distributions, and quality metrics
 * for quick cross-agent comparison.
 *
 * Query params:
 *   from  -- ISO 8601 start timestamp
 *   to    -- ISO 8601 end timestamp
 */
benchmarkExportRoutes.get("/export/summary", async (c) => {
  const dateFilter = buildDateFilter(c.req.query("from"), c.req.query("to"));
  const agents = getAgentConfigs();

  try {
    const agentSummaries = [];

    for (const agent of agents) {
      const agentFilter = dateFilter
        ? and(eq(tradeJustifications.agentId, agent.agentId), dateFilter)
        : eq(tradeJustifications.agentId, agent.agentId);

      const stats = await db
        .select({
          totalTrades: sql<number>`count(*)`,
          avgCoherence: sql<number>`avg(${tradeJustifications.coherenceScore})`,
          avgConfidence: sql<number>`avg(${tradeJustifications.confidence})`,
          hallucinationCount: sql<number>`count(*) filter (where jsonb_array_length(${tradeJustifications.hallucinationFlags}) > 0)`,
          disciplinePassCount: sql<number>`count(*) filter (where ${tradeJustifications.disciplinePass} = 'pass')`,
        })
        .from(tradeJustifications)
        .where(agentFilter);

      const intentRows = await db
        .select({
          intent: tradeJustifications.intent,
          count: sql<number>`count(*)`,
        })
        .from(tradeJustifications)
        .where(agentFilter)
        .groupBy(tradeJustifications.intent);

      const row = stats[0];
      const total = Number(row?.totalTrades ?? 0);
      const avgCoherence = round3(Number(row?.avgCoherence) || 0);
      const avgConfidence = round3(Number(row?.avgConfidence) || 0);
      const hallucinationRate = total > 0
        ? round3(Number(row?.hallucinationCount) / total)
        : 0;
      const disciplineRate = total > 0
        ? round3(Number(row?.disciplinePassCount) / total)
        : 0;

      // Composite score: weighted blend matching the v3 scoring engine weights
      const compositeScore = round3(
        avgCoherence * 0.20 +
        (1 - hallucinationRate) * 0.15 +
        disciplineRate * 0.10 +
        avgConfidence * 0.10
      );

      const intentDistribution: Record<string, number> = {};
      for (const ir of intentRows) {
        intentDistribution[ir.intent] = Number(ir.count);
      }

      agentSummaries.push({
        agentId: agent.agentId,
        agentName: agent.name,
        provider: agent.provider,
        model: agent.model,
        totalTrades: total,
        avgCoherence,
        hallucinationRate,
        disciplineRate,
        avgConfidence,
        compositeScore,
        intentDistribution,
      });
    }

    return c.json({
      ok: true,
      benchmark: "moltapp-v1",
      generatedAt: new Date().toISOString(),
      dateRange: { from: c.req.query("from") ?? null, to: c.req.query("to") ?? null },
      agents: agentSummaries,
    });
  } catch (err) {
    // Fallback: return agent shells with zero stats
    return c.json({
      ok: true,
      benchmark: "moltapp-v1",
      generatedAt: new Date().toISOString(),
      agents: agents.map((a) => ({
        agentId: a.agentId,
        agentName: a.name,
        provider: a.provider,
        model: a.model,
        totalTrades: 0,
        avgCoherence: 0,
        hallucinationRate: 0,
        disciplineRate: 0,
        avgConfidence: 0,
        compositeScore: 0,
        intentDistribution: {},
      })),
      source: "fallback",
      error: errorMessage(err),
    });
  }
});

// ---------------------------------------------------------------------------
// GET /export/dataset-card -- HuggingFace-compatible dataset card markdown
// ---------------------------------------------------------------------------

/**
 * Generates a dataset card in HuggingFace format with YAML frontmatter.
 * Compatible with `datasets` library auto-detection and Hub rendering.
 */
benchmarkExportRoutes.get("/export/dataset-card", async (c) => {
  let totalRecords = 0;
  let agentCount = 0;
  let dateRange = { earliest: "N/A", latest: "N/A" };

  try {
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(tradeJustifications);
    totalRecords = Number(countResult[0]?.count ?? 0);

    const agents = await db
      .select({ agentId: tradeJustifications.agentId })
      .from(tradeJustifications)
      .groupBy(tradeJustifications.agentId);
    agentCount = agents.length;

    const rangeResult = await db
      .select({
        earliest: sql<string>`min(${tradeJustifications.timestamp})`,
        latest: sql<string>`max(${tradeJustifications.timestamp})`,
      })
      .from(tradeJustifications);

    if (rangeResult[0]?.earliest) {
      dateRange.earliest = new Date(rangeResult[0].earliest).toISOString().split("T")[0];
      dateRange.latest = new Date(rangeResult[0].latest).toISOString().split("T")[0];
    }
  } catch {
    // Use defaults if DB is unavailable
    agentCount = getAgentConfigs().length;
  }

  const card = `---
language:
  - en
license: mit
task_categories:
  - text-classification
  - text-generation
tags:
  - finance
  - trading
  - ai-benchmark
  - reasoning
  - hallucination-detection
  - llm-evaluation
pretty_name: MoltApp AI Trading Benchmark
size_categories:
  - ${totalRecords < 1000 ? "n<1K" : totalRecords < 10000 ? "1K<n<10K" : "10K<n<100K"}
---

# MoltApp AI Trading Benchmark

A live benchmark dataset measuring how AI agents reason about stock trades on the Solana blockchain.

## Dataset Description

MoltApp pits multiple LLM-powered trading agents against each other in real-time stock trading competitions.
Every trade decision is recorded with full reasoning chains, confidence scores, and post-hoc quality analysis.

This dataset captures **${totalRecords.toLocaleString()}** trade justifications from **${agentCount}** AI agents
spanning **${dateRange.earliest}** to **${dateRange.latest}**.

### What Makes This Unique

Unlike static benchmarks, MoltApp data is generated from **live competitive trading** where agents risk real
tokenized assets. The reasoning is not prompted -- agents independently decide what to trade and why.

## Dataset Structure

Each record contains:

| Field | Type | Description |
|-------|------|-------------|
| \`id\` | string | Unique justification identifier |
| \`agent_id\` | string | Agent identifier (e.g. claude-trader, gpt-trader) |
| \`action\` | string | buy, sell, or hold |
| \`symbol\` | string | Stock ticker (e.g. AAPLx, TSLAx) |
| \`quantity\` | float | USDC amount (buys) or share count (sells) |
| \`reasoning\` | string | Step-by-step reasoning text |
| \`confidence\` | float | Agent self-reported confidence (0.0-1.0) |
| \`intent\` | string | Trading strategy classification |
| \`sources\` | string[] | Data sources cited in reasoning |
| \`coherence_score\` | float | NLP coherence analysis (0.0-1.0) |
| \`hallucination_flags\` | string[] | Detected factual errors |
| \`discipline_pass\` | boolean | Whether trading rules were followed |
| \`predicted_outcome\` | string | What the agent expected |
| \`actual_outcome\` | string | What actually happened |
| \`round_id\` | string | Trading round identifier |
| \`timestamp\` | string | ISO 8601 timestamp |

## Benchmark Metrics

| Metric | Weight | Category |
|--------|--------|----------|
| P&L % | 25% | Reward |
| Sharpe Ratio | 20% | Risk |
| Reasoning Coherence | 20% | Qualitative |
| Hallucination Rate | 15% | Safety |
| Instruction Discipline | 10% | Reliability |
| Confidence Calibration | 10% | Meta-cognition |

## Usage

\`\`\`python
from datasets import load_dataset
ds = load_dataset("patruff/molt-benchmark")
\`\`\`

Or download directly via the API:

\`\`\`bash
# JSONL (streaming-friendly)
curl -o molt-benchmark.jsonl https://www.patgpt.us/api/benchmark/export/jsonl

# CSV (spreadsheet-friendly)
curl -o molt-benchmark.csv https://www.patgpt.us/api/benchmark/export/csv
\`\`\`

## Citation

\`\`\`bibtex
@dataset{moltapp_benchmark_2026,
  title={MoltApp AI Trading Benchmark},
  author={MoltApp},
  year={2026},
  url={https://huggingface.co/datasets/patruff/molt-benchmark},
  description={Live competitive AI trading reasoning dataset with coherence and hallucination analysis}
}
\`\`\`

## License

MIT
`;

  c.header("Content-Type", "text/markdown; charset=utf-8");
  c.header("Content-Disposition", 'attachment; filename="README.md"');
  return c.body(card);
});
