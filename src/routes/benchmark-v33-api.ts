/**
 * Benchmark V33 API — 26-Dimension AI Trading Benchmark
 *
 * Researcher-facing API for the v33 benchmark framework.
 * NEW in v33: Justification Depth + Prediction Precision dimensions.
 *
 * Routes:
 * - GET /leaderboard              — Ranked agents by composite score
 * - GET /trade-grades             — Individual trade quality assessments
 * - GET /dimensions               — All 26 dimension definitions and weights
 * - GET /justification/:agentId   — Justification depth analysis for an agent
 * - GET /predictions              — Prediction precision analysis
 * - GET /grounding/:agentId       — Reasoning grounding analysis for an agent
 * - GET /consensus                — Consensus quality analysis across agents
 * - GET /export/jsonl             — Full benchmark dataset export (JSONL)
 * - GET /export/csv               — Agent scores export (CSV)
 * - GET /health                   — Benchmark engine health check
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
  type V33TradeGrade,
} from "../services/v33-benchmark-engine.ts";

export const benchmarkV33ApiRoutes = new Hono();

const startTime = Date.now();

// ---------------------------------------------------------------------------
// GET /leaderboard — Ranked agents by 26-dimension composite score
// ---------------------------------------------------------------------------

benchmarkV33ApiRoutes.get("/leaderboard", (c) => {
  const scores = getAgentScores();
  const sorted = [...scores].sort((a, b) => b.compositeScore - a.compositeScore);

  return c.json({
    ok: true,
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
    dimensionCount: 26,
    version: "33.0",
  });
});

// ---------------------------------------------------------------------------
// GET /trade-grades — Individual trade quality assessments
// ---------------------------------------------------------------------------

benchmarkV33ApiRoutes.get("/trade-grades", (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 200);
  const agentId = c.req.query("agentId");

  const grades = agentId
    ? getTradeGradesByAgent(agentId, limit)
    : getTradeGrades(limit);

  return c.json({
    ok: true,
    grades: grades.map((g) => ({
      tradeId: g.tradeId,
      agentId: g.agentId,
      symbol: g.symbol,
      action: g.action,
      reasoning: g.reasoning.slice(0, 300),
      confidence: g.confidence,
      intent: g.intent,
      overallGrade: g.overallGrade,
      scores: {
        coherence: g.coherenceScore,
        reasoningDepth: g.reasoningDepthScore,
        sourceQuality: g.sourceQualityScore,
        logicalConsistency: g.logicalConsistencyScore,
        transparency: g.transparencyScore,
        accountability: g.accountabilityScore,
        grounding: g.groundingScore,
        consensusQuality: g.consensusQualityScore,
        causalReasoning: g.causalReasoningScore,
        epistemicHumility: g.epistemicHumilityScore,
      },
      hallucinationFlags: g.hallucinationFlags,
      disciplinePassed: g.disciplinePassed,
      integrityHash: g.integrityHash,
      predictedOutcome: g.predictedOutcome,
      actualOutcome: g.actualOutcome,
      outcomeResolved: g.outcomeResolved,
      gradedAt: g.gradedAt,
    })),
    total: grades.length,
    version: "33.0",
  });
});

// ---------------------------------------------------------------------------
// GET /dimensions — All 26 dimension definitions and weights
// ---------------------------------------------------------------------------

benchmarkV33ApiRoutes.get("/dimensions", (c) => {
  const weights = getDimensionWeights();

  const categories = [
    {
      name: "Financial Performance",
      weight: 0.18,
      dimensions: [
        { key: "pnlPercent", weight: weights.pnlPercent, description: "ROI since round start" },
        { key: "sharpeRatio", weight: weights.sharpeRatio, description: "Risk-adjusted return (annualized)" },
        { key: "maxDrawdown", weight: weights.maxDrawdown, description: "Largest peak-to-trough decline" },
      ],
    },
    {
      name: "Reasoning Quality",
      weight: 0.42,
      dimensions: [
        { key: "coherence", weight: weights.coherence, description: "Reasoning logically supports trade action" },
        { key: "reasoningDepth", weight: weights.reasoningDepth, description: "Sophistication of multi-step reasoning" },
        { key: "sourceQuality", weight: weights.sourceQuality, description: "Breadth and quality of data sources cited" },
        { key: "logicalConsistency", weight: weights.logicalConsistency, description: "Internal logical consistency" },
        { key: "reasoningIntegrity", weight: weights.reasoningIntegrity, description: "Cryptographic hash verification of reasoning chains" },
        { key: "reasoningTransparency", weight: weights.reasoningTransparency, description: "How well agent explains decision-making" },
        { key: "reasoningGrounding", weight: weights.reasoningGrounding, description: "How well reasoning anchored in real market data" },
        { key: "causalReasoning", weight: weights.causalReasoning, description: "Multi-step logical chain quality — evidence-to-conclusion bridging", isNew: true },
        { key: "epistemicHumility", weight: weights.epistemicHumility, description: "Specificity and measurability of predicted outcomes", isNew: true },
      ],
    },
    {
      name: "Safety & Trust",
      weight: 0.12,
      dimensions: [
        { key: "hallucinationRate", weight: weights.hallucinationRate, description: "Rate of factually incorrect claims" },
        { key: "instructionDiscipline", weight: weights.instructionDiscipline, description: "Compliance with trading rules" },
        { key: "riskAwareness", weight: weights.riskAwareness, description: "Degree to which agent discusses risk" },
      ],
    },
    {
      name: "Behavioral Intelligence",
      weight: 0.10,
      dimensions: [
        { key: "strategyConsistency", weight: weights.strategyConsistency, description: "Consistency of strategy over time" },
        { key: "adaptability", weight: weights.adaptability, description: "Ability to adjust to market conditions" },
        { key: "confidenceCalibration", weight: weights.confidenceCalibration, description: "Correlation between confidence and outcomes" },
        { key: "crossRoundLearning", weight: weights.crossRoundLearning, description: "Evidence of learning from previous rounds" },
      ],
    },
    {
      name: "Predictive Power",
      weight: 0.07,
      dimensions: [
        { key: "outcomeAccuracy", weight: weights.outcomeAccuracy, description: "Accuracy of predicted vs actual outcomes" },
        { key: "marketRegimeAwareness", weight: weights.marketRegimeAwareness, description: "Recognition of market conditions" },
        { key: "edgeConsistency", weight: weights.edgeConsistency, description: "Consistency of positive edge across rounds" },
      ],
    },
    {
      name: "Governance & Accountability",
      weight: 0.11,
      dimensions: [
        { key: "tradeAccountability", weight: weights.tradeAccountability, description: "Taking responsibility for outcomes" },
        { key: "reasoningQualityIndex", weight: weights.reasoningQualityIndex, description: "Aggregate reasoning quality metric" },
        { key: "decisionAccountability", weight: weights.decisionAccountability, description: "Tracking predictions and acknowledging errors" },
        { key: "consensusQuality", weight: weights.consensusQuality, description: "Quality of agreement/divergence with peers" },
      ],
    },
  ];

  return c.json({
    ok: true,
    benchmark: "moltapp-v33",
    dimensionCount: getDimensionCount(),
    version: getBenchmarkVersion(),
    categories,
    totalWeight: Object.values(weights).reduce((a, b) => a + b, 0).toFixed(4),
  });
});

// ---------------------------------------------------------------------------
// GET /justification/:agentId — Justification depth analysis
// ---------------------------------------------------------------------------

benchmarkV33ApiRoutes.get("/justification/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const trades = getTradeGradesByAgent(agentId, 100);

  if (trades.length === 0) {
    return c.json({
      ok: true,
      agentId,
      avgCausalReasoning: 0,
      distribution: { excellent: 0, good: 0, moderate: 0, weak: 0 },
      topTrades: [],
      version: "33.0",
    });
  }

  const depthScores = trades.map((t) => t.causalReasoningScore);
  const avg = depthScores.reduce((a, b) => a + b, 0) / depthScores.length;

  const distribution = {
    excellent: countByCondition(depthScores, (s) => s >= 80),
    good: countByCondition(depthScores, (s) => s >= 60 && s < 80),
    moderate: countByCondition(depthScores, (s) => s >= 40 && s < 60),
    weak: countByCondition(depthScores, (s) => s < 40),
  };

  const sorted = [...trades].sort((a, b) => b.causalReasoningScore - a.causalReasoningScore);
  const topTrades = sorted.slice(0, 5).map((t) => ({
    tradeId: t.tradeId,
    symbol: t.symbol,
    action: t.action,
    causalReasoning: t.causalReasoningScore,
    overallGrade: t.overallGrade,
    reasoning: t.reasoning.slice(0, 300),
    gradedAt: t.gradedAt,
  }));

  return c.json({
    ok: true,
    agentId,
    avgCausalReasoning: round2(avg),
    distribution,
    topTrades,
    version: "33.0",
  });
});

// ---------------------------------------------------------------------------
// GET /predictions — Prediction precision analysis
// ---------------------------------------------------------------------------

benchmarkV33ApiRoutes.get("/predictions", (c) => {
  const allTrades = getTradeGrades(2000);
  const tradesWithPredictions = allTrades.filter((t) => t.predictedOutcome !== null);

  const precisionScores = tradesWithPredictions.map((t) => t.epistemicHumilityScore);
  const precisionDistribution = {
    highPrecision: countByCondition(precisionScores, (s) => s >= 70),
    mediumPrecision: countByCondition(precisionScores, (s) => s >= 40 && s < 70),
    lowPrecision: countByCondition(precisionScores, (s) => s < 40),
  };

  const resolved = tradesWithPredictions.filter((t) => t.outcomeResolved !== "pending");
  const correct = countByCondition(tradesWithPredictions, (t) => t.outcomeResolved === "correct");
  const incorrect = countByCondition(tradesWithPredictions, (t) => t.outcomeResolved === "incorrect");
  const partial = countByCondition(tradesWithPredictions, (t) => t.outcomeResolved === "partial");

  const agentMap = new Map<string, { scores: number[]; correct: number; total: number }>();
  for (const t of tradesWithPredictions) {
    let entry = agentMap.get(t.agentId);
    if (!entry) {
      entry = { scores: [], correct: 0, total: 0 };
      agentMap.set(t.agentId, entry);
    }
    entry.scores.push(t.epistemicHumilityScore);
    if (t.outcomeResolved !== "pending") {
      entry.total++;
      if (t.outcomeResolved === "correct") entry.correct++;
    }
  }

  const agentRankings = Array.from(agentMap.entries())
    .map(([id, data]) => ({
      agentId: id,
      avgPrecisionScore: Math.round(
        (data.scores.reduce((a, b) => a + b, 0) / data.scores.length) * 100,
      ) / 100,
      predictionCount: data.scores.length,
      resolvedCount: data.total,
      accuracyRate: data.total > 0 ? round2(data.correct / data.total) : 0,
    }))
    .sort((a, b) => b.avgPrecisionScore - a.avgPrecisionScore);

  return c.json({
    ok: true,
    predictionAnalysis: {
      totalPredictions: tradesWithPredictions.length,
      precisionDistribution,
      outcomeResolution: {
        resolved: resolved.length,
        correct,
        incorrect,
        partial,
        pending: tradesWithPredictions.length - resolved.length,
      },
    },
    agentRankings,
    version: "33.0",
  });
});

// ---------------------------------------------------------------------------
// GET /grounding/:agentId — Reasoning grounding analysis
// ---------------------------------------------------------------------------

benchmarkV33ApiRoutes.get("/grounding/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const trades = getTradeGradesByAgent(agentId, 100);

  if (trades.length === 0) {
    return c.json({
      ok: true,
      agentId,
      groundingAnalysis: { avgGroundingScore: 0, tradesAnalyzed: 0 },
    });
  }

  const groundingScores = trades.map((t) => t.groundingScore);
  const avg = groundingScores.reduce((a, b) => a + b, 0) / groundingScores.length;

  return c.json({
    ok: true,
    agentId,
    benchmark: "moltapp-v33",
    groundingAnalysis: {
      avgGroundingScore: round2(avg),
      tradesAnalyzed: trades.length,
      highlyGrounded: countByCondition(trades, (t) => t.groundingScore >= 70),
      poorlyGrounded: countByCondition(trades, (t) => t.groundingScore < 40),
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

benchmarkV33ApiRoutes.get("/consensus", (c) => {
  const scores = getAgentScores();
  const rounds = getRoundSummaries(20);

  return c.json({
    ok: true,
    benchmark: "moltapp-v33",
    consensusAnalysis: {
      agents: scores.map((s) => ({
        agentId: s.agentId,
        agentName: s.agentName,
        consensusQuality: s.dimensions.consensusQuality,
        causalReasoning: s.dimensions.causalReasoning,
        epistemicHumility: s.dimensions.epistemicHumility,
        tier: s.tier,
      })),
      recentRounds: rounds.slice(0, 5).map((r) => ({
        roundId: r.roundId,
        consensusAgreement: r.consensusAgreement,
        avgConsensusQuality: r.avgConsensusQuality,
        avgCausalReasoning: r.avgCausalReasoning,
        avgEpistemicHumility: r.avgEpistemicHumility,
        avgGrounding: r.avgGrounding,
        marketRegime: r.marketRegime,
      })),
    },
  });
});

// ---------------------------------------------------------------------------
// GET /export/jsonl — Full benchmark dataset export (JSONL)
// ---------------------------------------------------------------------------

benchmarkV33ApiRoutes.get("/export/jsonl", (c) => {
  const grades = getTradeGrades(2000);

  const lines = grades.map((g) => JSON.stringify({
    benchmark_version: "33.0",
    dimension_count: 26,
    trade_id: g.tradeId,
    agent_id: g.agentId,
    symbol: g.symbol,
    action: g.action,
    reasoning: g.reasoning,
    confidence: g.confidence,
    intent: g.intent,
    sources: g.sources,
    coherence_score: g.coherenceScore,
    reasoning_depth: g.reasoningDepthScore,
    source_quality: g.sourceQualityScore,
    logical_consistency: g.logicalConsistencyScore,
    integrity_hash: g.integrityHash,
    transparency_score: g.transparencyScore,
    accountability_score: g.accountabilityScore,
    grounding_score: g.groundingScore,
    consensus_quality_score: g.consensusQualityScore,
    causal_reasoning_score: g.causalReasoningScore,
    epistemic_humility_score: g.epistemicHumilityScore,
    hallucination_flags: g.hallucinationFlags,
    discipline_passed: g.disciplinePassed,
    predicted_outcome: g.predictedOutcome,
    actual_outcome: g.actualOutcome,
    outcome_resolved: g.outcomeResolved,
    overall_grade: g.overallGrade,
    graded_at: g.gradedAt,
  }));

  const jsonl = lines.join("\n") + "\n";

  return new Response(jsonl, {
    headers: {
      "Content-Type": "application/jsonl",
      "Content-Disposition": 'attachment; filename="molt-benchmark-v33.jsonl"',
    },
  });
});

// ---------------------------------------------------------------------------
// GET /export/csv — CSV export of agent scores
// ---------------------------------------------------------------------------

benchmarkV33ApiRoutes.get("/export/csv", (c) => {
  const scores = getAgentScores();
  const sorted = [...scores].sort((a, b) => b.compositeScore - a.compositeScore);

  const dimensionNames = [
    "pnlPercent", "sharpeRatio", "maxDrawdown",
    "coherence", "reasoningDepth", "sourceQuality",
    "logicalConsistency", "reasoningIntegrity", "reasoningTransparency",
    "reasoningGrounding", "causalReasoning", "epistemicHumility",
    "hallucinationRate", "instructionDiscipline", "riskAwareness",
    "strategyConsistency", "adaptability", "confidenceCalibration",
    "crossRoundLearning", "outcomeAccuracy", "marketRegimeAwareness",
    "edgeConsistency", "tradeAccountability", "reasoningQualityIndex",
    "decisionAccountability", "consensusQuality",
  ];

  const headers = [
    "agent_id", "agent_name", "provider", "model",
    "composite_score", "tier",
    ...dimensionNames,
  ];

  const rows = sorted.map((s) => {
    const dimValues = dimensionNames.map(
      (dim) => s.dimensions[dim as keyof typeof s.dimensions] ?? 0,
    );
    return [
      s.agentId,
      `"${s.agentName}"`,
      s.provider,
      s.model,
      s.compositeScore,
      s.tier,
      ...dimValues,
    ].join(",");
  });

  const csv = [headers.join(","), ...rows].join("\n") + "\n";

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": 'attachment; filename="molt-benchmark-v33-agents.csv"',
    },
  });
});

// ---------------------------------------------------------------------------
// GET /health — Benchmark engine health check
// ---------------------------------------------------------------------------

benchmarkV33ApiRoutes.get("/health", (c) => {
  const scores = getAgentScores();
  const allTrades = getTradeGrades(2000);
  const uptimeMs = Date.now() - startTime;
  const uptimeSeconds = Math.floor(uptimeMs / 1000);

  return c.json({
    ok: true,
    benchmark: "moltapp-v33",
    dimensionCount: getDimensionCount(),
    tradeCount: allTrades.length,
    agentCount: scores.length,
    version: getBenchmarkVersion(),
    uptime: `${uptimeSeconds}s`,
    engineStatus: "operational",
    newInV33: [
      "justification_depth: Multi-step logical chain quality — evidence-to-conclusion bridging",
      "prediction_precision: Specificity and measurability of predicted outcomes",
    ],
  });
});
