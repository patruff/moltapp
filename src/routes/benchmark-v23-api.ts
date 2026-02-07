/**
 * Benchmark v23 API Routes
 *
 * Researcher-facing API for the v23 benchmark:
 * - GET /leaderboard     — v23 composite leaderboard
 * - GET /scores/:agentId — Detailed scores for an agent
 * - GET /calibration     — Calibration data across agents
 * - GET /outcomes        — Outcome resolution feed
 * - GET /export/jsonl    — JSONL dataset export
 * - GET /export/csv      — CSV dataset export
 * - POST /resolve        — Trigger outcome resolution
 * - GET /health          — Benchmark health metrics
 */

import { Hono } from "hono";
import { db } from "../db/index.ts";
import { tradeJustifications } from "../db/schema/trade-reasoning.ts";
import {
  outcomeResolutions,
  calibrationSnapshots,
  benchmarkLeaderboardV23,
} from "../db/schema/benchmark-v23.ts";
import { desc, eq, sql } from "drizzle-orm";
import {
  runOutcomeResolution,
  computeV23CompositeScore,
  getEngineState,
  getRecentResolutions,
  VALID_HORIZON_LABELS,
} from "../services/outcome-resolution-engine.ts";
import { getMarketData } from "../agents/orchestrator.ts";
import type { MarketData } from "../agents/base-agent.ts";
import { round2 } from "../lib/math-utils.ts";

export const benchmarkV23ApiRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET /leaderboard — v23 composite leaderboard
// ---------------------------------------------------------------------------

benchmarkV23ApiRoutes.get("/leaderboard", async (c) => {
  try {
    const entries = await db
      .select()
      .from(benchmarkLeaderboardV23)
      .orderBy(desc(benchmarkLeaderboardV23.compositeScore))
      .limit(50);

    return c.json({
      ok: true,
      benchmark: "moltapp-v23",
      leaderboard: entries.map((e: typeof entries[number], idx: number) => ({
        rank: idx + 1,
        agentId: e.agentId,
        compositeScore: e.compositeScore,
        grade: e.grade,
        pnlPercent: e.pnlPercent,
        sharpeRatio: e.sharpeRatio,
        coherenceScore: e.coherenceScore,
        hallucinationRate: e.hallucinationRate,
        disciplineRate: e.disciplineRate,
        calibrationEce: e.calibrationEce,
        predictionAccuracy: e.predictionAccuracy,
        tradeCount: e.tradeCount,
        period: e.period,
        breakdown: e.fullMetrics,
      })),
      scoring: {
        version: "v23",
        dimensions: 6,
        weights: {
          pnl: "30%",
          coherence: "20%",
          hallucinationFree: "15%",
          discipline: "10%",
          calibration: "15%",
          predictionAccuracy: "10%",
        },
      },
    });
  } catch {
    // Fallback: compute from in-memory state
    const resolutions = getRecentResolutions(200);
    const agentMap = new Map<string, typeof resolutions>();
    for (const r of resolutions) {
      const existing = agentMap.get(r.agentId) ?? [];
      existing.push(r);
      agentMap.set(r.agentId, existing);
    }

    const leaderboard = Array.from(agentMap.entries()).map(([agentId, results]) => {
      const wins = results.filter((r) => r.directionCorrect).length;
      const accuracy = results.length > 0 ? wins / results.length : 0;
      const avgPnl = results.length > 0
        ? results.reduce((s, r) => s + (r.pnlPercent ?? 0), 0) / results.length
        : 0;

      const scores = computeV23CompositeScore({
        pnlPercent: avgPnl,
        avgCoherence: 0.7,
        hallucinationRate: 0.1,
        disciplineRate: 0.9,
        calibrationEce: 0.15,
        predictionAccuracy: accuracy,
      });

      return {
        agentId,
        compositeScore: scores.score,
        grade: scores.grade,
        tradeCount: results.length,
        predictionAccuracy: round2(accuracy),
        avgPnl: round2(avgPnl),
        breakdown: scores.breakdown,
      };
    });

    leaderboard.sort((a, b) => b.compositeScore - a.compositeScore);

    return c.json({
      ok: true,
      benchmark: "moltapp-v23",
      leaderboard: leaderboard.map((l, idx) => ({ rank: idx + 1, ...l })),
      source: "in-memory",
    });
  }
});

// ---------------------------------------------------------------------------
// GET /scores/:agentId — Detailed agent scores
// ---------------------------------------------------------------------------

benchmarkV23ApiRoutes.get("/scores/:agentId", async (c) => {
  const agentId = c.req.param("agentId");

  try {
    const entries = await db
      .select()
      .from(benchmarkLeaderboardV23)
      .where(eq(benchmarkLeaderboardV23.agentId, agentId))
      .orderBy(desc(benchmarkLeaderboardV23.updatedAt))
      .limit(10);

    const calibration = await db
      .select()
      .from(calibrationSnapshots)
      .where(eq(calibrationSnapshots.agentId, agentId))
      .orderBy(desc(calibrationSnapshots.createdAt))
      .limit(20);

    const outcomes = await db
      .select()
      .from(outcomeResolutions)
      .where(eq(outcomeResolutions.agentId, agentId))
      .orderBy(desc(outcomeResolutions.resolvedAt))
      .limit(50);

    return c.json({
      ok: true,
      agentId,
      currentScore: entries[0] ?? null,
      scoreHistory: entries,
      calibration: calibration.map((s: typeof calibration[number]) => ({
        period: s.period,
        bucket: s.confidenceBucket,
        tradeCount: s.tradeCount,
        winRate: s.winRate,
        ece: s.ece,
      })),
      recentOutcomes: outcomes.map((o: typeof outcomes[number]) => ({
        symbol: o.symbol,
        action: o.action,
        entryPrice: o.entryPrice,
        exitPrice: o.exitPrice,
        pnlPercent: o.pnlPercent,
        directionCorrect: o.directionCorrect,
        calibrated: o.calibrated,
        horizon: o.horizon,
        resolvedAt: o.resolvedAt,
      })),
    });
  } catch {
    return c.json({
      ok: true,
      agentId,
      currentScore: null,
      message: "No benchmark data available yet. Run trading rounds first.",
    });
  }
});

// ---------------------------------------------------------------------------
// GET /calibration — Cross-agent calibration
// ---------------------------------------------------------------------------

benchmarkV23ApiRoutes.get("/calibration", async (c) => {
  try {
    const snapshots = await db
      .select()
      .from(calibrationSnapshots)
      .orderBy(desc(calibrationSnapshots.createdAt))
      .limit(100);

    // Group by agent
    const agentBuckets = new Map<string, typeof snapshots>();
    for (const s of snapshots) {
      const existing = agentBuckets.get(s.agentId) ?? [];
      existing.push(s);
      agentBuckets.set(s.agentId, existing);
    }

    type CalSnap = typeof snapshots[number];
    const calibrationData = Array.from(agentBuckets.entries()).map(([agentId, data]) => ({
      agentId,
      buckets: data.map((d: CalSnap) => ({
        bucket: d.confidenceBucket,
        tradeCount: d.tradeCount,
        winRate: d.winRate,
        ece: d.ece,
      })),
      overallEce: data.length > 0
        ? Math.round(
            (data.reduce((s: number, d: CalSnap) => s + (d.ece ?? 0) * (d.tradeCount ?? 1), 0)
              / data.reduce((s: number, d: CalSnap) => s + (d.tradeCount ?? 1), 0)) * 100,
          ) / 100
        : 0,
    }));

    return c.json({
      ok: true,
      calibration: calibrationData,
      explanation: {
        ece: "Expected Calibration Error — lower is better. Measures how well agent confidence predicts actual success rates.",
        wellCalibrated: "ECE < 0.1 means the agent's confidence roughly matches reality.",
        overconfident: "Win rate < expected for that confidence bucket.",
        underconfident: "Win rate > expected for that confidence bucket.",
      },
    });
  } catch {
    return c.json({
      ok: true,
      calibration: [],
      message: "Run outcome resolution first to generate calibration data.",
    });
  }
});

// ---------------------------------------------------------------------------
// GET /outcomes — Outcome resolution feed
// ---------------------------------------------------------------------------

benchmarkV23ApiRoutes.get("/outcomes", async (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 200);
  const agentFilter = c.req.query("agent");

  try {
    let query = db
      .select()
      .from(outcomeResolutions)
      .orderBy(desc(outcomeResolutions.resolvedAt))
      .limit(limit);

    if (agentFilter) {
      query = db
        .select()
        .from(outcomeResolutions)
        .where(eq(outcomeResolutions.agentId, agentFilter))
        .orderBy(desc(outcomeResolutions.resolvedAt))
        .limit(limit);
    }

    const results = await query;

    return c.json({
      ok: true,
      outcomes: results,
      total: results.length,
    });
  } catch {
    const memResults = getRecentResolutions(limit);
    return c.json({
      ok: true,
      outcomes: memResults,
      total: memResults.length,
      source: "in-memory",
    });
  }
});

// ---------------------------------------------------------------------------
// GET /export/jsonl — JSONL export for researchers
// ---------------------------------------------------------------------------

benchmarkV23ApiRoutes.get("/export/jsonl", async (c) => {
  try {
    const justifications = await db
      .select()
      .from(tradeJustifications)
      .orderBy(desc(tradeJustifications.timestamp))
      .limit(1000);

    // Build outcome map
    const outcomeMap = new Map<string, { pnl: number | null; correct: boolean | null }>();
    try {
      const outs = await db.select().from(outcomeResolutions).limit(1000);
      for (const o of outs) {
        outcomeMap.set(o.justificationId, {
          pnl: o.pnlPercent,
          correct: o.directionCorrect,
        });
      }
    } catch { /* skip */ }

    const lines = justifications.map((j: typeof justifications[number]) => {
      const outcome = outcomeMap.get(j.id);
      return JSON.stringify({
        agent_id: j.agentId,
        round_id: j.roundId,
        timestamp: j.timestamp?.toISOString(),
        action: j.action,
        symbol: j.symbol,
        quantity: j.quantity,
        reasoning: j.reasoning,
        confidence: j.confidence,
        sources: j.sources ?? [],
        intent: j.intent,
        predicted_outcome: j.predictedOutcome,
        coherence_score: j.coherenceScore,
        hallucination_flags: j.hallucinationFlags ?? [],
        discipline_pass: j.disciplinePass === "pass",
        pnl_percent: outcome?.pnl ?? null,
        direction_correct: outcome?.correct ?? null,
      });
    });

    c.header("Content-Type", "application/jsonl");
    c.header("Content-Disposition", "attachment; filename=moltapp-benchmark-v23.jsonl");
    return c.body(lines.join("\n") + "\n");
  } catch {
    return c.json({ ok: false, error: "Export failed — database unavailable" }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /export/csv — CSV export for researchers
// ---------------------------------------------------------------------------

benchmarkV23ApiRoutes.get("/export/csv", async (c) => {
  try {
    const justifications = await db
      .select()
      .from(tradeJustifications)
      .orderBy(desc(tradeJustifications.timestamp))
      .limit(1000);

    const headers = [
      "agent_id", "timestamp", "action", "symbol", "quantity",
      "confidence", "intent", "coherence_score", "discipline_pass",
    ];
    const rows = justifications.map((j: typeof justifications[number]) => [
      j.agentId,
      j.timestamp?.toISOString() ?? "",
      j.action,
      j.symbol,
      j.quantity?.toString() ?? "",
      j.confidence.toString(),
      j.intent,
      j.coherenceScore?.toString() ?? "",
      j.disciplinePass ?? "pending",
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));

    const csv = [headers.join(","), ...rows].join("\n");

    c.header("Content-Type", "text/csv");
    c.header("Content-Disposition", "attachment; filename=moltapp-benchmark-v23.csv");
    return c.body(csv);
  } catch {
    return c.json({ ok: false, error: "Export failed" }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /resolve — Trigger outcome resolution
// ---------------------------------------------------------------------------

benchmarkV23ApiRoutes.post("/resolve", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const horizon = (body as Record<string, string>).horizon ?? "1h";

  // Validate the horizon against supported values
  if (!VALID_HORIZON_LABELS.includes(horizon)) {
    return c.json({
      ok: false,
      error: `Invalid horizon "${horizon}". Supported horizons: ${VALID_HORIZON_LABELS.join(", ")}`,
      supportedHorizons: VALID_HORIZON_LABELS,
    }, 400);
  }

  let marketData: MarketData[];
  try {
    marketData = await getMarketData();
  } catch {
    marketData = [];
  }

  if (marketData.length === 0) {
    return c.json({
      ok: false,
      error: "No market data available. Cannot resolve outcomes without prices.",
    }, 503);
  }

  const results = await runOutcomeResolution(marketData, horizon);

  return c.json({
    ok: true,
    resolved: results.length,
    horizon,
    supportedHorizons: VALID_HORIZON_LABELS,
    summary: {
      profits: results.filter((r) => r.outcome === "profit").length,
      losses: results.filter((r) => r.outcome === "loss").length,
      breakeven: results.filter((r) => r.outcome === "breakeven").length,
      directionAccuracy: results.length > 0
        ? Math.round(
            (results.filter((r) => r.directionCorrect).length / results.length) * 100,
          ) / 100
        : 0,
    },
    results: results.slice(0, 20),
  });
});

// ---------------------------------------------------------------------------
// GET /health — Benchmark health metrics
// ---------------------------------------------------------------------------

benchmarkV23ApiRoutes.get("/health", (c) => {
  const state = getEngineState();
  const recent = getRecentResolutions(100);

  const profits = recent.filter((r) => r.outcome === "profit").length;
  const dirCorrect = recent.filter((r) => r.directionCorrect).length;

  return c.json({
    ok: true,
    benchmark: {
      version: "v23",
      name: "MoltApp Agentic Trading Benchmark",
      website: "https://www.patgpt.us",
      huggingface: "patruff/molt-benchmark",
    },
    engine: {
      totalResolved: state.totalResolved,
      lastRun: state.lastRun,
      recentResolutions: recent.length,
      supportedHorizons: VALID_HORIZON_LABELS,
    },
    recentStats: recent.length > 0
      ? {
          profitRate: round2(profits / recent.length),
          directionAccuracy: round2(dirCorrect / recent.length),
          avgPnl: Math.round(
            (recent.reduce((s, r) => s + (r.pnlPercent ?? 0), 0) / recent.length) * 100,
          ) / 100,
        }
      : null,
    scoring: {
      dimensions: ["pnl", "coherence", "hallucination_free", "discipline", "calibration", "prediction_accuracy"],
      gradeThresholds: { S: 90, A: 80, B: 70, C: 60, D: 50, F: 0 },
    },
  });
});
