/**
 * Benchmark API Routes
 *
 * Comprehensive REST API for accessing MoltApp's AI trading benchmark data.
 * This is the researcher-facing API that makes MoltApp a REAL benchmark:
 * downloadable, queryable, and exportable data.
 *
 * Routes:
 * - GET  /export/json           — Full benchmark dataset as JSON
 * - GET  /export/csv            — Full benchmark dataset as CSV
 * - GET  /reasoning-diffs       — Agent reasoning comparisons
 * - GET  /reasoning-diffs/:id   — Specific round diff
 * - GET  /strategy-attribution  — Which strategies work best
 * - GET  /strategy-attribution/:agentId — Agent's strategy profile
 * - GET  /hallucination-trends  — Hallucination rates over time
 * - GET  /hallucination-trends/:agentId — Agent-specific trend
 * - GET  /reasoning-profiles    — Agent reasoning fingerprints
 * - GET  /reasoning-profiles/:agentId — Single agent profile
 * - GET  /reasoning-profiles/compare — Side-by-side comparison
 * - GET  /validate              — Run validation on current dataset
 * - GET  /schema                — OpenAPI-style schema description
 */

import { Hono } from "hono";
import { db } from "../db/index.ts";
import { tradeJustifications } from "../db/schema/trade-reasoning.ts";
import { desc } from "drizzle-orm";
import {
  getRecentDiffReports,
  getRoundDiffReport,
  getAgentDiffProfile,
  getDiffAggregateStats,
} from "../services/reasoning-diff-engine.ts";
import {
  generateAttributionReport,
  getIntentRankings,
  getAgentIntentProfile,
} from "../services/strategy-attribution.ts";
import {
  generateHallucinationReport,
  getAgentHallucinationTrend,
  getRecentHallucinationEvents,
} from "../services/hallucination-tracker.ts";
import {
  getAllReasoningProfiles,
  buildReasoningProfile,
  compareProfiles,
} from "../services/reasoning-profile.ts";
import {
  validateBenchmarkDataset,
  type BenchmarkRecord,
} from "../services/benchmark-validator.ts";

export const benchmarkApiRoutes = new Hono();

// ---------------------------------------------------------------------------
// Export Endpoints
// ---------------------------------------------------------------------------

/**
 * GET /export/json — Full benchmark dataset as JSON
 *
 * Query params:
 *   limit (default 1000, max 10000)
 *   agent — filter by agent ID
 *   format — "array" (default) or "jsonl"
 */
benchmarkApiRoutes.get("/export/json", async (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "1000", 10), 10000);
  const agentFilter = c.req.query("agent");
  const format = c.req.query("format") ?? "array";

  try {
    let query = db
      .select()
      .from(tradeJustifications)
      .orderBy(desc(tradeJustifications.timestamp))
      .limit(limit);

    const records = await query;

    const filtered = agentFilter
      ? records.filter((r) => r.agentId === agentFilter)
      : records;

    const formatted = filtered.map((r) => ({
      id: r.id,
      agent_id: r.agentId,
      action: r.action,
      symbol: r.symbol,
      quantity: r.quantity,
      reasoning: r.reasoning,
      confidence: r.confidence,
      intent: r.intent,
      sources: r.sources,
      predicted_outcome: r.predictedOutcome,
      actual_outcome: r.actualOutcome,
      coherence_score: r.coherenceScore,
      hallucination_flags: r.hallucinationFlags,
      discipline_pass: r.disciplinePass === "pass",
      round_id: r.roundId,
      timestamp: r.timestamp?.toISOString() ?? null,
    }));

    if (format === "jsonl") {
      const jsonl = formatted.map((r) => JSON.stringify(r)).join("\n");
      c.header("Content-Type", "application/jsonl");
      c.header("Content-Disposition", 'attachment; filename="molt-benchmark.jsonl"');
      return c.body(jsonl);
    }

    return c.json({
      benchmark: "moltapp-v1",
      version: new Date().toISOString().split("T")[0],
      total: formatted.length,
      records: formatted,
    });
  } catch (err) {
    return c.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});

/**
 * GET /export/csv — Full benchmark dataset as CSV
 */
benchmarkApiRoutes.get("/export/csv", async (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "1000", 10), 10000);

  try {
    const records = await db
      .select()
      .from(tradeJustifications)
      .orderBy(desc(tradeJustifications.timestamp))
      .limit(limit);

    const headers = [
      "id", "agent_id", "action", "symbol", "quantity", "confidence",
      "intent", "coherence_score", "discipline_pass", "hallucination_count",
      "reasoning_length", "sources_count", "round_id", "timestamp",
    ];

    const rows = records.map((r) => [
      r.id,
      r.agentId,
      r.action,
      r.symbol,
      r.quantity ?? 0,
      r.confidence,
      r.intent,
      r.coherenceScore ?? "",
      r.disciplinePass,
      Array.isArray(r.hallucinationFlags) ? (r.hallucinationFlags as string[]).length : 0,
      r.reasoning.length,
      Array.isArray(r.sources) ? (r.sources as string[]).length : 0,
      r.roundId ?? "",
      r.timestamp?.toISOString() ?? "",
    ]);

    const csv = [
      headers.join(","),
      ...rows.map((row) =>
        row.map((cell) => {
          const str = String(cell);
          return str.includes(",") || str.includes('"') || str.includes("\n")
            ? `"${str.replace(/"/g, '""')}"`
            : str;
        }).join(","),
      ),
    ].join("\n");

    c.header("Content-Type", "text/csv");
    c.header("Content-Disposition", 'attachment; filename="molt-benchmark.csv"');
    return c.body(csv);
  } catch (err) {
    return c.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// Reasoning Diffs
// ---------------------------------------------------------------------------

/**
 * GET /reasoning-diffs — Recent agent reasoning comparisons
 */
benchmarkApiRoutes.get("/reasoning-diffs", (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10), 100);
  const reports = getRecentDiffReports(limit);
  const aggregateStats = getDiffAggregateStats();

  return c.json({
    ok: true,
    reports,
    aggregateStats,
    description: "Pairwise comparison of how different AI agents reason about the same market data",
  });
});

/**
 * GET /reasoning-diffs/agent/:agentId — Agent's diff profile
 */
benchmarkApiRoutes.get("/reasoning-diffs/agent/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const profile = getAgentDiffProfile(agentId);

  return c.json({
    ok: true,
    profile,
    description: "How this agent's reasoning compares to its peers across all rounds",
  });
});

/**
 * GET /reasoning-diffs/:roundId — Specific round's diffs
 */
benchmarkApiRoutes.get("/reasoning-diffs/:roundId", (c) => {
  const roundId = c.req.param("roundId");
  const report = getRoundDiffReport(roundId);

  if (!report) {
    return c.json({ ok: false, error: "Round diff report not found" }, 404);
  }

  return c.json({ ok: true, report });
});

// ---------------------------------------------------------------------------
// Strategy Attribution
// ---------------------------------------------------------------------------

/**
 * GET /strategy-attribution — Which strategies produce best results
 */
benchmarkApiRoutes.get("/strategy-attribution", (c) => {
  const report = generateAttributionReport();

  return c.json({
    ok: true,
    report,
    description: "Analysis of which trading intents (momentum, value, contrarian, etc.) produce the best returns",
  });
});

/**
 * GET /strategy-attribution/rankings — Intent rankings only
 */
benchmarkApiRoutes.get("/strategy-attribution/rankings", (c) => {
  const rankings = getIntentRankings();

  return c.json({
    ok: true,
    rankings,
    description: "Trading intents ranked by average P&L",
  });
});

/**
 * GET /strategy-attribution/:agentId — Agent's strategy performance
 */
benchmarkApiRoutes.get("/strategy-attribution/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const profile = getAgentIntentProfile(agentId);

  if (!profile) {
    return c.json({ ok: false, error: "No strategy data for this agent" }, 404);
  }

  return c.json({ ok: true, profile });
});

// ---------------------------------------------------------------------------
// Hallucination Trends
// ---------------------------------------------------------------------------

/**
 * GET /hallucination-trends — Platform-wide hallucination analysis
 */
benchmarkApiRoutes.get("/hallucination-trends", (c) => {
  const report = generateHallucinationReport();

  return c.json({
    ok: true,
    report,
    description: "Tracks hallucination rates over time — are agents improving in factual accuracy?",
  });
});

/**
 * GET /hallucination-trends/events — Recent hallucination events
 */
benchmarkApiRoutes.get("/hallucination-trends/events", (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10), 100);
  const events = getRecentHallucinationEvents(limit);

  return c.json({ ok: true, events });
});

/**
 * GET /hallucination-trends/:agentId — Agent-specific hallucination trend
 */
benchmarkApiRoutes.get("/hallucination-trends/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const trend = getAgentHallucinationTrend(agentId);

  return c.json({ ok: true, trend });
});

// ---------------------------------------------------------------------------
// Reasoning Profiles
// ---------------------------------------------------------------------------

/**
 * GET /reasoning-profiles — All agent reasoning fingerprints
 */
benchmarkApiRoutes.get("/reasoning-profiles", (c) => {
  const profiles = getAllReasoningProfiles();

  return c.json({
    ok: true,
    profiles,
    description: "Statistical fingerprint of each agent's reasoning patterns: vocabulary, tone, consistency",
  });
});

/**
 * GET /reasoning-profiles/compare — Side-by-side comparison of two agents
 */
benchmarkApiRoutes.get("/reasoning-profiles/compare", (c) => {
  const agentA = c.req.query("a");
  const agentB = c.req.query("b");

  if (!agentA || !agentB) {
    return c.json({ ok: false, error: "Both 'a' and 'b' query params are required" }, 400);
  }

  const comparison = compareProfiles(agentA, agentB);
  return c.json({ ok: true, ...comparison });
});

/**
 * GET /reasoning-profiles/:agentId — Single agent's reasoning profile
 */
benchmarkApiRoutes.get("/reasoning-profiles/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const profile = buildReasoningProfile(agentId);

  return c.json({ ok: true, profile });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * GET /validate — Run validation on current benchmark dataset
 */
benchmarkApiRoutes.get("/validate", async (c) => {
  try {
    const records = await db
      .select()
      .from(tradeJustifications)
      .orderBy(desc(tradeJustifications.timestamp))
      .limit(5000);

    const benchmarkRecords: BenchmarkRecord[] = records.map((r) => ({
      id: r.id,
      agent_id: r.agentId,
      agent_provider: inferProvider(r.agentId),
      action: r.action,
      symbol: r.symbol,
      quantity: r.quantity ?? 0,
      reasoning: r.reasoning,
      confidence: r.confidence,
      intent: r.intent,
      sources: (r.sources as string[]) ?? [],
      predicted_outcome: r.predictedOutcome,
      actual_outcome: r.actualOutcome,
      coherence_score: r.coherenceScore,
      hallucination_flags: (r.hallucinationFlags as string[]) ?? [],
      discipline_pass: r.disciplinePass === "pass",
      round_id: r.roundId,
      timestamp: r.timestamp?.toISOString() ?? "",
    }));

    const result = validateBenchmarkDataset(benchmarkRecords);

    return c.json({
      ok: true,
      validation: result,
      description: "Data quality validation for the benchmark dataset before HuggingFace upload",
    });
  } catch (err) {
    return c.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});

function inferProvider(agentId: string): string {
  if (agentId.includes("claude")) return "anthropic";
  if (agentId.includes("gpt")) return "openai";
  if (agentId.includes("grok")) return "xai";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * GET /schema — OpenAPI-style schema description
 */
benchmarkApiRoutes.get("/schema", (c) => {
  return c.json({
    benchmark: "moltapp-v1",
    title: "MoltApp AI Trading Benchmark API",
    version: "2.0",
    description: "Comprehensive API for accessing AI agent trading benchmark data",
    website: "https://www.patgpt.us",
    huggingface: "https://huggingface.co/datasets/patruff/molt-benchmark",
    endpoints: {
      "GET /export/json": {
        description: "Download full benchmark dataset as JSON",
        params: { limit: "max records (default 1000)", agent: "filter by agent", format: "array|jsonl" },
      },
      "GET /export/csv": {
        description: "Download benchmark dataset as CSV",
        params: { limit: "max records (default 1000)" },
      },
      "GET /reasoning-diffs": {
        description: "Pairwise agent reasoning comparisons",
        params: { limit: "max reports (default 20)" },
      },
      "GET /reasoning-diffs/agent/:agentId": {
        description: "Agent's reasoning diff profile vs peers",
      },
      "GET /strategy-attribution": {
        description: "Which trading strategies produce best returns",
      },
      "GET /strategy-attribution/rankings": {
        description: "Intent rankings by P&L",
      },
      "GET /strategy-attribution/:agentId": {
        description: "Agent's per-strategy performance breakdown",
      },
      "GET /hallucination-trends": {
        description: "Hallucination rates over time for all agents",
      },
      "GET /hallucination-trends/events": {
        description: "Recent hallucination events",
      },
      "GET /hallucination-trends/:agentId": {
        description: "Agent-specific hallucination trend",
      },
      "GET /reasoning-profiles": {
        description: "Statistical reasoning fingerprints for all agents",
      },
      "GET /reasoning-profiles/compare?a=...&b=...": {
        description: "Side-by-side agent reasoning comparison",
      },
      "GET /reasoning-profiles/:agentId": {
        description: "Single agent's reasoning profile",
      },
      "GET /validate": {
        description: "Run data quality validation on benchmark dataset",
      },
    },
    dataSchema: {
      trade_justification: {
        id: "string — unique trade justification ID",
        agent_id: "string — agent identifier",
        action: "buy | sell | hold",
        symbol: "string — stock ticker (e.g., AAPLx)",
        quantity: "number — USDC for buys, shares for sells",
        reasoning: "string — step-by-step reasoning text",
        confidence: "number — 0.0 to 1.0",
        intent: "momentum | mean_reversion | value | hedge | contrarian | arbitrage",
        sources: "string[] — data sources cited",
        coherence_score: "number — 0.0 to 1.0 (NLP coherence analysis)",
        hallucination_flags: "string[] — factual errors detected",
        discipline_pass: "boolean — did agent follow trading rules",
        predicted_outcome: "string | null — what agent expected",
        actual_outcome: "string | null — what actually happened",
        round_id: "string | null — trading round identifier",
        timestamp: "ISO 8601 timestamp",
      },
    },
    benchmarkMetrics: [
      { name: "pnl_percent", weight: 0.25, type: "reward" },
      { name: "sharpe_ratio", weight: 0.20, type: "risk" },
      { name: "reasoning_coherence", weight: 0.20, type: "qualitative" },
      { name: "hallucination_rate", weight: 0.15, type: "safety" },
      { name: "instruction_discipline", weight: 0.10, type: "reliability" },
      { name: "confidence_calibration", weight: 0.10, type: "meta" },
    ],
  });
});
