/**
 * Benchmark Analytics API
 *
 * Researcher-facing API endpoints for the v10 benchmark additions:
 * - Confidence calibration analysis (ECE, Brier, reliability diagrams)
 * - Reasoning pattern analysis (fallacies, depth, vocabulary, templates)
 * - Cross-trade quality trend detection
 * - Aggregate benchmark health metrics
 *
 * These endpoints provide machine-readable data for ML researchers
 * building on the MoltApp benchmark.
 *
 * Routes:
 * - GET /calibration                — All agents calibration reports
 * - GET /calibration/:agentId       — Single agent calibration
 * - GET /calibration/summary        — Aggregate calibration metrics
 * - GET /patterns/:agentId          — Pattern analysis for agent's recent reasoning
 * - GET /patterns/:agentId/trend    — Quality trend over time
 * - GET /patterns/:agentId/template — Template/repetition detection
 * - GET /health                     — Overall benchmark health
 */

import { Hono } from "hono";
import { countByCondition, round2 } from "../lib/math-utils.ts";
import {
  generateCalibrationReport,
  getAllCalibrationReports,
  getCalibrationSummary,
  getCalibrationSamples,
} from "../services/calibration-engine.ts";
import {
  analyzeReasoningPatterns,
  detectQualityTrend,
  detectTemplateUsage,
} from "../services/reasoning-pattern-detector.ts";
import {
  getAllIntegrityScores,
  analyzeCrossAgentIntegrity,
} from "../services/reasoning-integrity-engine.ts";
import {
  getV9Leaderboard,
  exportV9Snapshot,
} from "../services/benchmark-v9-scorer.ts";
import { db } from "../db/index.ts";
import { tradeJustifications } from "../db/schema/trade-reasoning.ts";
import { desc, eq } from "drizzle-orm";

export const benchmarkAnalyticsRoutes = new Hono();

// ---------------------------------------------------------------------------
// Calibration Endpoints
// ---------------------------------------------------------------------------

/**
 * GET /calibration/summary — Aggregate calibration metrics across all agents
 */
benchmarkAnalyticsRoutes.get("/calibration/summary", (c) => {
  const summary = getCalibrationSummary();
  return c.json({
    ok: true,
    calibration: summary,
    methodology: {
      ece: "Expected Calibration Error: weighted average of |confidence - win_rate| per bucket",
      brierScore: "Mean squared error of probabilistic forecasts: (1/n) * sum((confidence - outcome)^2)",
      buckets: 10,
      windowSize: 500,
    },
  });
});

/**
 * GET /calibration — Full calibration reports for all agents
 */
benchmarkAnalyticsRoutes.get("/calibration", (c) => {
  const reports = getAllCalibrationReports();
  return c.json({
    ok: true,
    reports,
    agentCount: reports.length,
  });
});

/**
 * GET /calibration/:agentId — Single agent calibration report
 */
benchmarkAnalyticsRoutes.get("/calibration/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const report = generateCalibrationReport(agentId);
  const samples = getCalibrationSamples(agentId);

  return c.json({
    ok: true,
    report,
    recentSamples: samples.slice(-20).map((s) => ({
      confidence: s.confidence,
      outcome: s.outcome,
      pnlPercent: s.pnlPercent,
      timestamp: new Date(s.timestamp).toISOString(),
    })),
  });
});

// ---------------------------------------------------------------------------
// Pattern Analysis Endpoints
// ---------------------------------------------------------------------------

/**
 * GET /patterns/:agentId — Full pattern analysis on agent's recent reasoning
 */
benchmarkAnalyticsRoutes.get("/patterns/:agentId", async (c) => {
  const agentId = c.req.param("agentId");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "10", 10), 50);

  // Fetch recent reasoning from DB
  let entries: { reasoning: string; action: string; symbol: string; confidence: number | null; timestamp: Date | null }[] = [];
  try {
    entries = await db
      .select({
        reasoning: tradeJustifications.reasoning,
        action: tradeJustifications.action,
        symbol: tradeJustifications.symbol,
        confidence: tradeJustifications.confidence,
        timestamp: tradeJustifications.timestamp,
      })
      .from(tradeJustifications)
      .where(eq(tradeJustifications.agentId, agentId))
      .orderBy(desc(tradeJustifications.timestamp))
      .limit(limit);
  } catch {
    // DB unavailable
  }

  const analyses = entries.map((e) => {
    const analysis = analyzeReasoningPatterns(agentId, e.reasoning);
    return {
      action: e.action,
      symbol: e.symbol,
      confidence: e.confidence,
      timestamp: e.timestamp?.toISOString() ?? null,
      fallacies: analysis.fallacies,
      depth: analysis.depth,
      vocabulary: analysis.vocabulary,
      qualityScore: analysis.qualityScore,
      hedgeRatio: analysis.hedgeRatio,
      quantitativeRatio: analysis.quantitativeRatio,
      templateProbability: analysis.templateProbability,
    };
  });

  // Aggregate stats
  const avgQuality = analyses.length > 0
    ? analyses.reduce((s, a) => s + a.qualityScore, 0) / analyses.length : 0;
  const totalFallacies = analyses.reduce((s, a) => s + a.fallacies.length, 0);
  const depthDistribution: Record<string, number> = {};
  for (const a of analyses) {
    depthDistribution[a.depth.classification] = (depthDistribution[a.depth.classification] ?? 0) + 1;
  }

  return c.json({
    ok: true,
    agentId,
    analyses,
    aggregate: {
      avgQualityScore: round2(avgQuality),
      totalFallacies,
      depthDistribution,
      sampleCount: analyses.length,
    },
  });
});

/**
 * GET /patterns/:agentId/trend — Quality trend over time
 */
benchmarkAnalyticsRoutes.get("/patterns/:agentId/trend", (c) => {
  const agentId = c.req.param("agentId");
  const trend = detectQualityTrend(agentId);

  return c.json({
    ok: true,
    agentId,
    trend: trend.trend,
    recentAvg: trend.recentAvg,
    historicalAvg: trend.historicalAvg,
    sampleCount: trend.sampleCount,
    interpretation: trend.trend === "improving"
      ? "Agent's reasoning quality is improving over time"
      : trend.trend === "degrading"
        ? "Agent's reasoning quality is declining — may need prompt tuning"
        : "Agent's reasoning quality is stable",
  });
});

/**
 * GET /patterns/:agentId/template — Template/repetition detection
 */
benchmarkAnalyticsRoutes.get("/patterns/:agentId/template", (c) => {
  const agentId = c.req.param("agentId");
  const result = detectTemplateUsage(agentId);

  return c.json({
    ok: true,
    agentId,
    avgSimilarity: result.avgSimilarity,
    isTemplated: result.isTemplated,
    pairCount: result.pairCount,
    interpretation: result.isTemplated
      ? "WARNING: Agent appears to use templated/repetitive reasoning (>70% Jaccard similarity)"
      : "Agent reasoning shows sufficient variation across trades",
  });
});

// ---------------------------------------------------------------------------
// Benchmark Health Endpoint
// ---------------------------------------------------------------------------

/**
 * GET /health — Overall benchmark health metrics
 */
benchmarkAnalyticsRoutes.get("/health", (c) => {
  const leaderboard = getV9Leaderboard();
  const snapshot = exportV9Snapshot("sideways");
  const crossAgent = analyzeCrossAgentIntegrity();
  const calibration = getCalibrationSummary();

  // Health checks
  const checks: { name: string; status: "pass" | "warn" | "fail"; detail: string }[] = [];

  // Check 1: Do we have trade data?
  checks.push({
    name: "trade_data",
    status: snapshot.metrics.totalTrades > 0 ? "pass" : "fail",
    detail: `${snapshot.metrics.totalTrades} trades recorded`,
  });

  // Check 2: Is coherence above minimum?
  checks.push({
    name: "coherence_quality",
    status: snapshot.metrics.avgCoherence >= 0.5 ? "pass" : snapshot.metrics.avgCoherence >= 0.3 ? "warn" : "fail",
    detail: `Avg coherence: ${snapshot.metrics.avgCoherence.toFixed(3)}`,
  });

  // Check 3: Hallucination rate below threshold?
  checks.push({
    name: "hallucination_safety",
    status: snapshot.metrics.avgHallucinationRate <= 0.1 ? "pass" : snapshot.metrics.avgHallucinationRate <= 0.2 ? "warn" : "fail",
    detail: `Hallucination rate: ${(snapshot.metrics.avgHallucinationRate * 100).toFixed(1)}%`,
  });

  // Check 4: Are all agents active?
  checks.push({
    name: "agent_coverage",
    status: leaderboard.length >= 3 ? "pass" : leaderboard.length >= 2 ? "warn" : "fail",
    detail: `${leaderboard.length} agents on leaderboard`,
  });

  // Check 5: No excessive herding?
  checks.push({
    name: "diversity",
    status: crossAgent.herding.rate <= 0.5 ? "pass" : crossAgent.herding.rate <= 0.7 ? "warn" : "fail",
    detail: `Herding rate: ${(crossAgent.herding.rate * 100).toFixed(0)}%`,
  });

  // Check 6: Calibration data present?
  checks.push({
    name: "calibration_data",
    status: calibration.totalSamples > 10 ? "pass" : calibration.totalSamples > 0 ? "warn" : "fail",
    detail: `${calibration.totalSamples} calibration samples`,
  });

  const passCount = countByCondition(checks, (ch) => ch.status === "pass");
  const overallStatus = checks.every((ch) => ch.status === "pass") ? "healthy"
    : checks.some((ch) => ch.status === "fail") ? "degraded"
    : "warning";

  return c.json({
    ok: true,
    version: "v10",
    status: overallStatus,
    score: `${passCount}/${checks.length}`,
    checks,
    metrics: {
      totalTrades: snapshot.metrics.totalTrades,
      avgCoherence: snapshot.metrics.avgCoherence,
      hallucinationRate: snapshot.metrics.avgHallucinationRate,
      disciplineRate: snapshot.metrics.avgDisciplineRate,
      avgECE: calibration.avgECE,
      avgBrierScore: calibration.avgBrierScore,
      herdingRate: crossAgent.herding.rate,
      diversityScore: crossAgent.diversityScore,
    },
  });
});
