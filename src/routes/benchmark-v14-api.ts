/**
 * Benchmark v14 API — Researcher-Facing Endpoints
 *
 * Exposes the new v14 pillar data for researchers:
 * - Prediction resolution profiles
 * - Calibration curves (reliability diagrams)
 * - Reasoning volatility analysis
 * - Consensus divergence scoring
 * - JSONL/CSV exports for the HuggingFace dataset
 *
 * Routes:
 * - GET /predictions/:agentId     — Prediction resolution profile
 * - GET /calibration/:agentId     — Calibration curve + reliability diagram
 * - GET /volatility/:agentId      — Reasoning volatility analysis
 * - GET /consensus                — Cross-agent consensus divergence
 * - GET /consensus/recent         — Recent consensus snapshots
 * - GET /export/v14               — Full v14 dataset export (JSONL)
 * - GET /schema                   — v14 benchmark schema documentation
 */

import { Hono } from "hono";
import {
  buildAgentPredictionProfile,
  getPendingPredictions,
  getResolvedPredictions,
  getResolutionStats,
} from "../services/outcome-resolution-engine.ts";
import {
  analyzeCalibration,
  compareAgentCalibration,
  getCalibrationData,
} from "../services/confidence-calibration-analyzer.ts";
import {
  analyzeVolatility,
  compareAgentVolatility,
} from "../services/reasoning-volatility-tracker.ts";
import {
  buildDivergenceProfile,
  getRecentConsensus,
} from "../services/consensus-divergence-scorer.ts";

export const benchmarkV14ApiRoutes = new Hono();

// ---------------------------------------------------------------------------
// Prediction Resolution
// ---------------------------------------------------------------------------

/**
 * GET /predictions/:agentId — Full prediction profile for an agent
 */
benchmarkV14ApiRoutes.get("/predictions/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const profile = buildAgentPredictionProfile(agentId);
  const pending = getPendingPredictions().filter((p) => p.agentId === agentId);
  const resolved = getResolvedPredictions().filter((p) => p.agentId === agentId);

  return c.json({
    ok: true,
    agentId,
    profile,
    recentPending: pending.slice(-10),
    recentResolved: resolved.slice(-20),
  });
});

/**
 * GET /predictions — All agents prediction overview
 */
benchmarkV14ApiRoutes.get("/predictions", (c) => {
  const stats = getResolutionStats();
  const allPredictions = getResolvedPredictions();
  const agentIds = [...new Set(allPredictions.map((p) => p.agentId))];
  const agents = agentIds.map((agentId) => buildAgentPredictionProfile(agentId));

  return c.json({
    ok: true,
    overview: stats,
    agents,
  });
});

// ---------------------------------------------------------------------------
// Calibration Curves
// ---------------------------------------------------------------------------

/**
 * GET /calibration/:agentId — Calibration analysis + reliability diagram
 */
benchmarkV14ApiRoutes.get("/calibration/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const analysis = analyzeCalibration(agentId);

  return c.json({
    ok: true,
    agentId,
    calibration: analysis,
    reliabilityDiagram: analysis.reliabilityDiagram,
    interpretation: {
      ece: `ECE ${analysis.ece.toFixed(3)} — ${analysis.ece < 0.05 ? "excellent" : analysis.ece < 0.1 ? "good" : analysis.ece < 0.2 ? "moderate" : "poor"} calibration`,
      brierScore: `Brier ${analysis.brierScore.toFixed(3)} — ${analysis.brierScore < 0.1 ? "strong" : analysis.brierScore < 0.2 ? "decent" : "weak"} probabilistic accuracy`,
      monotonic: analysis.monotonicCalibration
        ? "Higher confidence reliably predicts better outcomes"
        : "Confidence does NOT reliably predict outcome quality",
    },
  });
});

/**
 * GET /calibration — Compare calibration across all agents
 */
benchmarkV14ApiRoutes.get("/calibration", (c) => {
  const comparison = compareAgentCalibration();
  return c.json({
    ok: true,
    comparison: {
      bestCalibrated: comparison.bestCalibrated,
      worstCalibrated: comparison.worstCalibrated,
      rankings: comparison.rankings,
    },
    agents: comparison.agents.map((a) => ({
      agentId: a.agentId,
      ece: a.ece,
      brierScore: a.brierScore,
      grade: a.grade,
      monotonicCalibration: a.monotonicCalibration,
      overconfidenceRatio: a.overconfidenceRatio,
      dataPoints: a.totalDataPoints,
    })),
  });
});

// ---------------------------------------------------------------------------
// Reasoning Volatility
// ---------------------------------------------------------------------------

/**
 * GET /volatility/:agentId — Reasoning volatility analysis
 */
benchmarkV14ApiRoutes.get("/volatility/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const analysis = analyzeVolatility(agentId);

  return c.json({
    ok: true,
    agentId,
    volatility: analysis,
    interpretation: {
      stability: `Stability ${(analysis.stabilityScore * 100).toFixed(0)}% (${analysis.grade})`,
      sentiment: analysis.sentimentVolatility > 0.3
        ? "High sentiment swings — reasoning tone changes significantly between rounds"
        : "Stable sentiment — consistent reasoning tone",
      confidence: analysis.confidenceVolatility > 0.2
        ? "Confidence levels vary widely"
        : "Consistent confidence levels",
      intentDrift: analysis.intentDriftRate > 0.3
        ? "Frequently switches strategies"
        : "Consistent strategy approach",
      flips: analysis.convictionFlipRate > 0.2
        ? "Frequently reverses positions on same stocks"
        : "Steady convictions",
    },
  });
});

/**
 * GET /volatility — Compare volatility across all agents
 */
benchmarkV14ApiRoutes.get("/volatility", (c) => {
  const comparison = compareAgentVolatility();
  return c.json({
    ok: true,
    comparison: {
      mostStable: comparison.mostStable,
      mostVolatile: comparison.mostVolatile,
      rankings: comparison.rankings,
    },
    agents: comparison.agents.map((a) => ({
      agentId: a.agentId,
      stabilityScore: a.stabilityScore,
      grade: a.grade,
      sentimentVolatility: a.sentimentVolatility,
      convictionFlipRate: a.convictionFlipRate,
      recentTrend: a.recentTrend,
      roundsAnalyzed: a.roundsAnalyzed,
    })),
  });
});

// ---------------------------------------------------------------------------
// Consensus Divergence
// ---------------------------------------------------------------------------

/**
 * GET /consensus — Full consensus divergence profile
 */
benchmarkV14ApiRoutes.get("/consensus", (c) => {
  const profile = buildDivergenceProfile();
  return c.json({
    ok: true,
    consensus: profile,
  });
});

/**
 * GET /consensus/recent — Recent consensus snapshots
 */
benchmarkV14ApiRoutes.get("/consensus/recent", (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10), 100);
  const recent = getRecentConsensus(limit);

  return c.json({
    ok: true,
    snapshots: recent.map((r) => ({
      roundId: r.roundId,
      timestamp: r.timestamp,
      consensusType: r.consensusType,
      consensusAction: r.consensusAction,
      consensusSymbol: r.consensusSymbol,
      agreementScore: r.agreementScore,
      contrarians: r.contrarians,
      majorityAvgConfidence: r.majorityAvgConfidence,
      contrarianAvgConfidence: r.contrarianAvgConfidence,
    })),
    total: recent.length,
  });
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * GET /export/v14 — Full v14 benchmark data as JSONL
 */
benchmarkV14ApiRoutes.get("/export/v14", (c) => {
  const resolved = getResolvedPredictions();
  const calibData = getCalibrationData();
  const divergence = buildDivergenceProfile();
  const resolutionStats = getResolutionStats();

  const records = resolved.map((r) => ({
    type: "prediction_resolution",
    agent_id: r.agentId,
    symbol: r.symbol,
    action: r.action,
    confidence: r.confidence,
    predicted_outcome: r.predictedOutcome,
    direction_correct: r.directionCorrect,
    pnl_percent: r.pnlPercent,
    price_at_prediction: r.priceAtPrediction,
    exit_price: r.exitPrice,
    round_id: r.roundId,
    registered_at: r.registeredAt,
    resolved_at: r.resolvedAt,
  }));

  const calibRecords = calibData.map((d) => ({
    type: "calibration_point",
    agent_id: d.agentId,
    confidence: d.confidence,
    outcome: d.outcome,
    coherence_score: d.coherenceScore,
    action: d.action,
    symbol: d.symbol,
    round_id: d.roundId,
    timestamp: d.timestamp,
  }));

  const allRecords = [...records, ...calibRecords];
  const jsonl = allRecords.map((r) => JSON.stringify(r)).join("\n");

  return new Response(jsonl, {
    headers: {
      "Content-Type": "application/jsonl",
      "Content-Disposition": `attachment; filename="moltapp-v14-${new Date().toISOString().split("T")[0]}.jsonl"`,
    },
  });
});

// ---------------------------------------------------------------------------
// Schema Documentation
// ---------------------------------------------------------------------------

/**
 * GET /schema — v14 benchmark schema documentation
 */
benchmarkV14ApiRoutes.get("/schema", (c) => {
  return c.json({
    ok: true,
    benchmark: "moltapp-v14",
    version: "14.0.0",
    description: "MoltApp AI Trading Benchmark v14 — 10-Pillar Evaluation with Outcome Resolution",
    pillars: [
      {
        id: "financial",
        name: "Financial Performance",
        weight: 0.15,
        metrics: ["pnl_percent", "sharpe_ratio", "win_rate", "max_drawdown"],
        description: "Raw trading performance: did the agent make money?",
      },
      {
        id: "reasoning",
        name: "Reasoning Quality",
        weight: 0.14,
        metrics: ["coherence", "depth", "consistency"],
        description: "Does the reasoning logically support the trade action?",
      },
      {
        id: "safety",
        name: "Safety & Compliance",
        weight: 0.12,
        metrics: ["hallucination_free_rate", "discipline_rate"],
        description: "Does the agent fabricate data or violate rules?",
      },
      {
        id: "calibration",
        name: "Confidence Calibration",
        weight: 0.10,
        metrics: ["ece", "brier_score", "monotonic_quartiles"],
        description: "Does the agent's confidence predict outcome quality?",
      },
      {
        id: "patterns",
        name: "Reasoning Patterns",
        weight: 0.07,
        metrics: ["fallacy_detection", "vocabulary_sophistication", "template_avoidance"],
        description: "Does the agent use sophisticated, non-templated reasoning?",
      },
      {
        id: "adaptability",
        name: "Market Adaptability",
        weight: 0.07,
        metrics: ["cross_regime_consistency", "regime_accuracy"],
        description: "Does the agent perform across different market conditions?",
      },
      {
        id: "forensic_quality",
        name: "Forensic Quality",
        weight: 0.10,
        metrics: ["structure", "originality", "clarity", "integrity"],
        description: "Deep structural analysis of reasoning quality.",
      },
      {
        id: "validation_quality",
        name: "Validation Quality",
        weight: 0.10,
        metrics: ["depth", "sources", "grounding", "risk_awareness"],
        description: "Does the reasoning reference real data and consider risks?",
      },
      {
        id: "prediction_accuracy",
        name: "Prediction Accuracy",
        weight: 0.08,
        metrics: ["direction_accuracy", "target_precision", "resolution_quality"],
        description: "Do the agent's forward-looking predictions come true?",
        newInV14: true,
      },
      {
        id: "reasoning_stability",
        name: "Reasoning Stability",
        weight: 0.07,
        metrics: ["sentiment_volatility", "confidence_volatility", "intent_drift", "conviction_flip_rate"],
        description: "Is the agent's reasoning consistent across rounds?",
        newInV14: true,
      },
    ],
    endpoints: {
      dashboard: "/benchmark-v14",
      data: "/benchmark-v14/data",
      stream: "/benchmark-v14/stream",
      predictions: "/api/v1/benchmark-v14/predictions/:agentId",
      calibration: "/api/v1/benchmark-v14/calibration/:agentId",
      volatility: "/api/v1/benchmark-v14/volatility/:agentId",
      consensus: "/api/v1/benchmark-v14/consensus",
      export: "/api/v1/benchmark-v14/export/v14",
    },
    huggingface: "https://huggingface.co/datasets/patruff/molt-benchmark",
    website: "https://www.patgpt.us",
  });
});
