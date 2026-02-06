/**
 * Benchmark V32 API — 24-Dimension AI Trading Benchmark
 *
 * Researcher-facing API for the most comprehensive open benchmark
 * for evaluating AI trading agent intelligence.
 *
 * Routes:
 * - GET /leaderboard         — Ranked agents by composite score
 * - GET /trade-grades        — Individual trade quality assessments
 * - GET /dimensions          — All 24 dimension definitions and weights
 * - GET /grounding/:agentId  — Reasoning grounding analysis for an agent
 * - GET /consensus           — Consensus quality analysis across agents
 * - GET /export/jsonl        — Full benchmark dataset export (JSONL)
 * - GET /export/csv          — Full benchmark dataset export (CSV)
 * - GET /health              — Benchmark engine health check
 */

import { Hono } from "hono";
import { countByCondition, round2 } from "../lib/math-utils.ts";
import {
  getAgentScores,
  getAgentScore,
  getTradeGrades,
  getTradeGradesByAgent,
  getRoundSummaries,
  getDimensionWeights,
  getDimensionCount,
  getBenchmarkVersion,
  scoreGrounding,
  scoreConsensusQuality,
  type V32TradeGrade,
} from "../services/v32-benchmark-engine.ts";

export const benchmarkV32ApiRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET /leaderboard — Ranked agents by 24-dimension composite score
// ---------------------------------------------------------------------------

benchmarkV32ApiRoutes.get("/leaderboard", (c) => {
  const scores = getAgentScores();
  const sorted = [...scores].sort((a, b) => b.compositeScore - a.compositeScore);

  return c.json({
    ok: true,
    benchmark: "moltapp-v32",
    dimensions: getDimensionCount(),
    version: getBenchmarkVersion(),
    leaderboard: sorted.map((s, rank) => ({
      rank: rank + 1,
      agentId: s.agentId,
      agentName: s.agentName,
      provider: s.provider,
      model: s.model,
      compositeScore: s.compositeScore,
      tier: s.tier,
      tradeCount: s.tradeCount,
      roundsPlayed: s.roundsPlayed,
      topDimensions: Object.entries(s.dimensions)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([dim, score]) => ({ dimension: dim, score })),
      weakestDimensions: Object.entries(s.dimensions)
        .sort(([, a], [, b]) => a - b)
        .slice(0, 3)
        .map(([dim, score]) => ({ dimension: dim, score })),
      lastUpdated: s.lastUpdated,
    })),
  });
});

// ---------------------------------------------------------------------------
// GET /trade-grades — Individual trade quality assessments
// ---------------------------------------------------------------------------

benchmarkV32ApiRoutes.get("/trade-grades", (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 200);
  const agentId = c.req.query("agent");
  const minGrade = c.req.query("minGrade");

  let grades = agentId
    ? getTradeGradesByAgent(agentId, limit)
    : getTradeGrades(limit);

  if (minGrade) {
    const gradeOrder = ["A+", "A", "B+", "B", "C+", "C", "D", "F"];
    const minIdx = gradeOrder.indexOf(minGrade);
    if (minIdx >= 0) {
      grades = grades.filter(
        (g) => gradeOrder.indexOf(g.overallGrade) <= minIdx,
      );
    }
  }

  return c.json({
    ok: true,
    benchmark: "moltapp-v32",
    total: grades.length,
    grades: grades.map((g) => ({
      tradeId: g.tradeId,
      agentId: g.agentId,
      symbol: g.symbol,
      action: g.action,
      confidence: g.confidence,
      overallGrade: g.overallGrade,
      scores: {
        coherence: g.coherenceScore,
        depth: g.reasoningDepthScore,
        sourceQuality: g.sourceQualityScore,
        consistency: g.logicalConsistencyScore,
        transparency: g.transparencyScore,
        accountability: g.accountabilityScore,
        grounding: g.groundingScore,
        consensusQuality: g.consensusQualityScore,
      },
      hallucinationFlags: g.hallucinationFlags,
      disciplinePassed: g.disciplinePassed,
      integrityHash: g.integrityHash,
      predictedOutcome: g.predictedOutcome,
      actualOutcome: g.actualOutcome,
      outcomeResolved: g.outcomeResolved,
      gradedAt: g.gradedAt,
    })),
  });
});

// ---------------------------------------------------------------------------
// GET /dimensions — All 24 dimension definitions and weights
// ---------------------------------------------------------------------------

benchmarkV32ApiRoutes.get("/dimensions", (c) => {
  const weights = getDimensionWeights();

  const categories = [
    {
      name: "Financial Performance",
      weight: 0.20,
      dimensions: [
        { key: "pnlPercent", name: "P&L Percent", type: "reward", weight: weights.pnlPercent, description: "ROI since round start" },
        { key: "sharpeRatio", name: "Sharpe Ratio", type: "risk_adjustment", weight: weights.sharpeRatio, description: "Risk-adjusted return (annualized)" },
        { key: "maxDrawdown", name: "Max Drawdown", type: "risk", weight: weights.maxDrawdown, description: "Largest peak-to-trough decline" },
      ],
    },
    {
      name: "Reasoning Quality",
      weight: 0.37,
      dimensions: [
        { key: "coherence", name: "Coherence", type: "qualitative", weight: weights.coherence, description: "Does reasoning logically support the action?" },
        { key: "reasoningDepth", name: "Reasoning Depth", type: "qualitative", weight: weights.reasoningDepth, description: "Sophistication of multi-step reasoning" },
        { key: "sourceQuality", name: "Source Quality", type: "qualitative", weight: weights.sourceQuality, description: "Breadth and quality of data sources" },
        { key: "logicalConsistency", name: "Logical Consistency", type: "qualitative", weight: weights.logicalConsistency, description: "No internal contradictions" },
        { key: "reasoningIntegrity", name: "Integrity", type: "integrity", weight: weights.reasoningIntegrity, description: "Cryptographic hash verification" },
        { key: "reasoningTransparency", name: "Transparency", type: "transparency", weight: weights.reasoningTransparency, description: "How well agent explains decisions" },
        { key: "reasoningGrounding", name: "Grounding", type: "grounding", weight: weights.reasoningGrounding, description: "How well reasoning is grounded in real data vs speculation" },
      ],
    },
    {
      name: "Safety & Trust",
      weight: 0.13,
      dimensions: [
        { key: "hallucinationRate", name: "Hallucination Rate", type: "safety", weight: weights.hallucinationRate, description: "Rate of factually incorrect claims" },
        { key: "instructionDiscipline", name: "Instruction Discipline", type: "reliability", weight: weights.instructionDiscipline, description: "Compliance with trading rules" },
        { key: "riskAwareness", name: "Risk Awareness", type: "qualitative", weight: weights.riskAwareness, description: "Degree to which agent discusses risk" },
      ],
    },
    {
      name: "Behavioral Intelligence",
      weight: 0.11,
      dimensions: [
        { key: "strategyConsistency", name: "Strategy Consistency", type: "behavioral", weight: weights.strategyConsistency, description: "Consistency over time" },
        { key: "adaptability", name: "Adaptability", type: "behavioral", weight: weights.adaptability, description: "Ability to adjust to conditions" },
        { key: "confidenceCalibration", name: "Confidence Calibration", type: "calibration", weight: weights.confidenceCalibration, description: "Confidence vs outcome correlation" },
        { key: "crossRoundLearning", name: "Cross-Round Learning", type: "behavioral", weight: weights.crossRoundLearning, description: "Evidence of learning" },
      ],
    },
    {
      name: "Predictive Power",
      weight: 0.08,
      dimensions: [
        { key: "outcomeAccuracy", name: "Outcome Accuracy", type: "prediction", weight: weights.outcomeAccuracy, description: "Accuracy of predictions" },
        { key: "marketRegimeAwareness", name: "Regime Awareness", type: "contextual", weight: weights.marketRegimeAwareness, description: "Adapts to market conditions" },
        { key: "edgeConsistency", name: "Edge Consistency", type: "performance", weight: weights.edgeConsistency, description: "Consistency of positive edge" },
      ],
    },
    {
      name: "Governance & Accountability",
      weight: 0.11,
      dimensions: [
        { key: "tradeAccountability", name: "Trade Accountability", type: "governance", weight: weights.tradeAccountability, description: "Takes responsibility for outcomes" },
        { key: "reasoningQualityIndex", name: "RQI", type: "composite", weight: weights.reasoningQualityIndex, description: "Aggregate reasoning quality" },
        { key: "decisionAccountability", name: "Decision Accountability", type: "accountability", weight: weights.decisionAccountability, description: "Tracks and acknowledges errors" },
        { key: "consensusQuality", name: "Consensus Quality", type: "consensus", weight: weights.consensusQuality, description: "Quality of agreement/divergence with peers" },
      ],
    },
  ];

  return c.json({
    ok: true,
    benchmark: "moltapp-v32",
    dimensionCount: getDimensionCount(),
    version: getBenchmarkVersion(),
    categories,
    totalWeight: Object.values(weights).reduce((a, b) => a + b, 0).toFixed(4),
  });
});

// ---------------------------------------------------------------------------
// GET /grounding/:agentId — Reasoning grounding analysis
// ---------------------------------------------------------------------------

benchmarkV32ApiRoutes.get("/grounding/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const trades = getTradeGradesByAgent(agentId, 100);

  if (trades.length === 0) {
    return c.json({
      ok: true,
      agentId,
      groundingAnalysis: {
        avgGroundingScore: 0,
        tradesAnalyzed: 0,
        message: "No trades found for this agent",
      },
    });
  }

  const groundingScores = trades.map((t) => t.groundingScore);
  const avg = groundingScores.reduce((a, b) => a + b, 0) / groundingScores.length;
  const highlyGrounded = countByCondition(trades, (t) => t.groundingScore >= 70);
  const poorlyGrounded = countByCondition(trades, (t) => t.groundingScore < 40);

  return c.json({
    ok: true,
    agentId,
    groundingAnalysis: {
      avgGroundingScore: round2(avg),
      tradesAnalyzed: trades.length,
      highlyGroundedTrades: highlyGrounded,
      poorlyGroundedTrades: poorlyGrounded,
      groundingRate: round2(highlyGrounded / trades.length),
      recentTrades: trades.slice(0, 10).map((t) => ({
        tradeId: t.tradeId,
        symbol: t.symbol,
        action: t.action,
        groundingScore: t.groundingScore,
        overallGrade: t.overallGrade,
        gradedAt: t.gradedAt,
      })),
    },
  });
});

// ---------------------------------------------------------------------------
// GET /consensus — Consensus quality analysis across all agents
// ---------------------------------------------------------------------------

benchmarkV32ApiRoutes.get("/consensus", (c) => {
  const scores = getAgentScores();
  const rounds = getRoundSummaries(20);

  const agentConsensus = scores.map((s) => ({
    agentId: s.agentId,
    agentName: s.agentName,
    consensusQualityScore: s.dimensions.consensusQuality,
    tier: s.tier,
    interpretation: s.dimensions.consensusQuality >= 70
      ? "Strong independent thinker with justified divergence"
      : s.dimensions.consensusQuality >= 50
        ? "Balanced consensus participant"
        : "May be herding or making unjustified contrarian bets",
  }));

  return c.json({
    ok: true,
    benchmark: "moltapp-v32",
    consensusAnalysis: {
      agents: agentConsensus,
      recentRounds: rounds.slice(0, 5).map((r) => ({
        roundId: r.roundId,
        consensusAgreement: r.consensusAgreement,
        avgConsensusQuality: r.avgConsensusQuality,
        marketRegime: r.marketRegime,
      })),
    },
  });
});

// ---------------------------------------------------------------------------
// GET /export/jsonl — Full dataset export for researchers
// ---------------------------------------------------------------------------

benchmarkV32ApiRoutes.get("/export/jsonl", (c) => {
  const trades = getTradeGrades(2000);
  const lines = trades.map((t) => JSON.stringify({
    trade_id: t.tradeId,
    agent_id: t.agentId,
    symbol: t.symbol,
    action: t.action,
    reasoning: t.reasoning,
    confidence: t.confidence,
    coherence_score: t.coherenceScore,
    hallucination_flags: t.hallucinationFlags,
    discipline_passed: t.disciplinePassed,
    reasoning_depth: t.reasoningDepthScore,
    source_quality: t.sourceQualityScore,
    logical_consistency: t.logicalConsistencyScore,
    transparency_score: t.transparencyScore,
    accountability_score: t.accountabilityScore,
    grounding_score: t.groundingScore,
    consensus_quality_score: t.consensusQualityScore,
    integrity_hash: t.integrityHash,
    predicted_outcome: t.predictedOutcome,
    actual_outcome: t.actualOutcome,
    outcome_resolved: t.outcomeResolved,
    overall_grade: t.overallGrade,
    graded_at: t.gradedAt,
    benchmark_version: "32.0",
    dimension_count: 24,
  }));

  const jsonl = lines.join("\n") + "\n";

  c.header("Content-Type", "application/jsonl");
  c.header("Content-Disposition", 'attachment; filename="molt-benchmark-v32.jsonl"');
  return c.body(jsonl);
});

// ---------------------------------------------------------------------------
// GET /export/csv — CSV export for researchers
// ---------------------------------------------------------------------------

benchmarkV32ApiRoutes.get("/export/csv", (c) => {
  const trades = getTradeGrades(2000);

  const headers = [
    "trade_id", "agent_id", "symbol", "action", "confidence",
    "coherence_score", "reasoning_depth", "source_quality",
    "logical_consistency", "transparency_score", "accountability_score",
    "grounding_score", "consensus_quality_score", "integrity_hash",
    "hallucination_count", "discipline_passed", "overall_grade",
    "outcome_resolved", "graded_at", "benchmark_version", "dimension_count",
  ];

  const rows = trades.map((t) => [
    t.tradeId, t.agentId, t.symbol, t.action, t.confidence,
    t.coherenceScore, t.reasoningDepthScore, t.sourceQualityScore,
    t.logicalConsistencyScore, t.transparencyScore, t.accountabilityScore,
    t.groundingScore, t.consensusQualityScore, t.integrityHash,
    t.hallucinationFlags.length, t.disciplinePassed, t.overallGrade,
    t.outcomeResolved, t.gradedAt, "32.0", 24,
  ].join(","));

  const csv = [headers.join(","), ...rows].join("\n") + "\n";

  c.header("Content-Type", "text/csv");
  c.header("Content-Disposition", 'attachment; filename="molt-benchmark-v32.csv"');
  return c.body(csv);
});

// ---------------------------------------------------------------------------
// GET /health — Benchmark engine health
// ---------------------------------------------------------------------------

benchmarkV32ApiRoutes.get("/health", (c) => {
  const scores = getAgentScores();
  const trades = getTradeGrades(1);
  const rounds = getRoundSummaries(1);

  return c.json({
    ok: true,
    benchmark: "moltapp-v32",
    version: getBenchmarkVersion(),
    dimensions: getDimensionCount(),
    health: {
      agentsScored: scores.length,
      totalTradeGrades: getTradeGrades(2000).length,
      totalRoundSummaries: getRoundSummaries(200).length,
      latestTrade: trades[0]?.gradedAt ?? null,
      latestRound: rounds[0]?.timestamp ?? null,
      engineStatus: "operational",
    },
    newInV32: [
      "reasoning_grounding: Measures how well reasoning is anchored in real market data",
      "consensus_quality: Measures quality of agreement/divergence with peer agents",
    ],
  });
});
