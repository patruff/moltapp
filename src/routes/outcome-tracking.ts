/**
 * Outcome Tracking API Routes
 *
 * Exposes outcome tracking, confidence calibration, and reasoning quality
 * gate data via REST endpoints. These are critical benchmark infrastructure
 * that demonstrate MoltApp measures OUTCOMES, not just trades.
 *
 * Routes:
 * - POST /track           — Trigger outcome tracking (evaluates pending trades)
 * - GET  /stats           — Aggregate outcome statistics
 * - GET  /recent          — Recent outcome evaluations
 * - GET  /calibration     — Confidence calibration analysis
 * - GET  /calibration/:id — Per-agent calibration
 * - GET  /quality-gate    — Quality gate config and stats
 * - PUT  /quality-gate    — Update quality gate thresholds
 */

import { Hono } from "hono";
import { parseQueryInt } from "../lib/query-params.ts";
import {
  trackOutcomes,
  getOutcomeTrackerStats,
  getRecentOutcomes,
  calculateConfidenceCalibration,
} from "../services/outcome-tracker.ts";
import {
  getQualityGateStats,
  getQualityGateConfig,
  updateQualityGateConfig,
} from "../services/reasoning-quality-gate.ts";
import { getMarketData } from "../agents/orchestrator.ts";
import { apiError, handleError } from "../lib/errors.ts";

export const outcomeTrackingRoutes = new Hono();

// ---------------------------------------------------------------------------
// POST /track — Trigger outcome evaluation
// ---------------------------------------------------------------------------

outcomeTrackingRoutes.post("/track", async (c) => {
  try {
    const marketData = await getMarketData();
    const results = await trackOutcomes(marketData);

    return c.json({
      ok: true,
      tracked: results.length,
      summary: {
        profit: results.filter((r) => r.outcome === "profit").length,
        loss: results.filter((r) => r.outcome === "loss").length,
        breakeven: results.filter((r) => r.outcome === "breakeven").length,
        pending: results.filter((r) => r.outcome === "pending").length,
      },
      results: results.slice(0, 20),
    });
  } catch (err) {
    return handleError(c, err);
  }
});

// ---------------------------------------------------------------------------
// GET /stats — Aggregate outcome stats
// ---------------------------------------------------------------------------

outcomeTrackingRoutes.get("/stats", (c) => {
  const agentId = c.req.query("agent");
  const stats = getOutcomeTrackerStats(agentId);

  return c.json({
    ok: true,
    stats,
    description: {
      calibrationScore:
        "0-1 score measuring whether high-confidence trades perform better than low-confidence ones",
      avgPnlPercent: "Average P&L percentage across all tracked outcomes",
    },
  });
});

// ---------------------------------------------------------------------------
// GET /recent — Recent outcome evaluations
// ---------------------------------------------------------------------------

outcomeTrackingRoutes.get("/recent", (c) => {
  const limit = parseQueryInt(c.req.query("limit"), 20, 1, 100);
  const agentId = c.req.query("agent");
  const outcomes = getRecentOutcomes(limit, agentId);

  return c.json({
    ok: true,
    outcomes,
    count: outcomes.length,
  });
});

// ---------------------------------------------------------------------------
// GET /calibration — Confidence calibration analysis
// ---------------------------------------------------------------------------

outcomeTrackingRoutes.get("/calibration", (c) => {
  const calibration = calculateConfidenceCalibration();

  return c.json({
    ok: true,
    calibration,
    interpretation: {
      score: calibration.score,
      meaning:
        calibration.score >= 0.7
          ? "Well-calibrated: high confidence predicts good outcomes"
          : calibration.score >= 0.4
            ? "Moderately calibrated: some correlation between confidence and outcomes"
            : "Poorly calibrated: confidence doesn't predict outcome quality",
    },
    benchmarkMetric: {
      name: "confidence_calibration",
      type: "meta",
      description: "Measures whether agents know what they know",
    },
  });
});

// ---------------------------------------------------------------------------
// GET /calibration/:agentId — Per-agent calibration
// ---------------------------------------------------------------------------

outcomeTrackingRoutes.get("/calibration/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const calibration = calculateConfidenceCalibration(agentId);
  const overallCalibration = calculateConfidenceCalibration();

  return c.json({
    ok: true,
    agentId,
    calibration,
    vsOverall: {
      agentScore: calibration.score,
      overallScore: overallCalibration.score,
      delta: Math.round((calibration.score - overallCalibration.score) * 100) / 100,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /quality-gate — Quality gate status
// ---------------------------------------------------------------------------

outcomeTrackingRoutes.get("/quality-gate", (c) => {
  const stats = getQualityGateStats();

  return c.json({
    ok: true,
    qualityGate: {
      config: stats.config,
      stats: {
        totalChecked: stats.totalChecked,
        totalPassed: stats.totalPassed,
        totalRejected: stats.totalRejected,
        passRate:
          stats.totalChecked > 0
            ? Math.round((stats.totalPassed / stats.totalChecked) * 100) / 100
            : 1,
        avgCompositeScore: Math.round(stats.avgCompositeScore * 100) / 100,
        rejectionBreakdown: stats.rejectionsByReason,
      },
    },
    description:
      "The quality gate validates agent reasoning before trade execution. " +
      "Low-quality reasoning causes trades to be rejected and converted to holds.",
  });
});

// ---------------------------------------------------------------------------
// PUT /quality-gate — Update quality gate config
// ---------------------------------------------------------------------------

outcomeTrackingRoutes.put("/quality-gate", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, "INVALID_JSON");
  }

  const updates: Record<string, unknown> = {};
  const allowedKeys = [
    "minReasoningLength",
    "minCoherenceScore",
    "maxHallucinationSeverity",
    "minCompositeScore",
    "enforceRejection",
  ];

  for (const key of allowedKeys) {
    if (key in body) {
      updates[key] = body[key];
    }
  }

  const newConfig = updateQualityGateConfig(
    updates as Parameters<typeof updateQualityGateConfig>[0],
  );

  return c.json({
    ok: true,
    config: newConfig,
    message: "Quality gate configuration updated",
  });
});
