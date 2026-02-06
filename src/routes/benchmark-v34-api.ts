/**
 * Benchmark V34 API — 28-Dimension AI Trading Benchmark
 *
 * Researcher-facing API for the v34 benchmark framework.
 * NEW in v34: Reasoning Traceability + Adversarial Coherence dimensions.
 *
 * Routes:
 * - GET /leaderboard              — Ranked agents by composite score
 * - GET /trade-grades             — Individual trade quality assessments
 * - GET /dimensions               — All 28 dimension definitions and weights
 * - GET /traceability/:agentId    — Reasoning traceability analysis for an agent
 * - GET /adversarial/:agentId     — Adversarial coherence analysis for an agent
 * - GET /reasoning-profile        — Cross-agent reasoning quality comparison
 * - GET /export/jsonl             — Full benchmark dataset export (JSONL)
 * - GET /export/csv               — Agent scores export (CSV)
 * - GET /health                   — Benchmark engine health check
 */

import { Hono } from "hono";
import {
  getAgentScores,
  getAgentScore,
  getTradeGrades,
  getTradeGradesByAgent,
  getRoundSummaries,
  getDimensionWeights,
  getDimensionCount,
  getBenchmarkVersion,
  type V34TradeGrade,
} from "../services/v34-benchmark-engine.ts";
import { round2, countByCondition } from "../lib/math-utils.ts";

export const benchmarkV34ApiRoutes = new Hono();

const startTime = Date.now();

// ---------------------------------------------------------------------------
// GET /leaderboard — Ranked agents by 28-dimension composite score
// ---------------------------------------------------------------------------

benchmarkV34ApiRoutes.get("/leaderboard", (c) => {
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
    dimensionCount: 28,
    version: "34.0",
  });
});

// ---------------------------------------------------------------------------
// GET /trade-grades — Individual trade quality assessments
// ---------------------------------------------------------------------------

benchmarkV34ApiRoutes.get("/trade-grades", (c) => {
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
        reasoningTraceability: g.reasoningTraceabilityScore,
        adversarialCoherence: g.adversarialCoherenceScore,
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
    version: "34.0",
  });
});

// ---------------------------------------------------------------------------
// GET /dimensions — All 28 dimension definitions and weights
// ---------------------------------------------------------------------------

benchmarkV34ApiRoutes.get("/dimensions", (c) => {
  const weights = getDimensionWeights();

  const categories = [
    {
      name: "Financial Performance",
      weight: 0.16,
      dimensions: [
        { key: "pnlPercent", weight: weights.pnlPercent, description: "ROI since round start" },
        { key: "sharpeRatio", weight: weights.sharpeRatio, description: "Risk-adjusted return (annualized)" },
        { key: "maxDrawdown", weight: weights.maxDrawdown, description: "Largest peak-to-trough decline" },
      ],
    },
    {
      name: "Reasoning Quality",
      weight: 0.46,
      dimensions: [
        { key: "coherence", weight: weights.coherence, description: "Reasoning logically supports trade action" },
        { key: "reasoningDepth", weight: weights.reasoningDepth, description: "Sophistication of multi-step reasoning" },
        { key: "sourceQuality", weight: weights.sourceQuality, description: "Breadth and quality of data sources cited" },
        { key: "logicalConsistency", weight: weights.logicalConsistency, description: "Internal logical consistency" },
        { key: "reasoningIntegrity", weight: weights.reasoningIntegrity, description: "Cryptographic hash verification of reasoning chains" },
        { key: "reasoningTransparency", weight: weights.reasoningTransparency, description: "How well agent explains decision-making" },
        { key: "reasoningGrounding", weight: weights.reasoningGrounding, description: "How well reasoning anchored in real market data" },
        { key: "causalReasoning", weight: weights.causalReasoning, description: "Multi-step logical chain quality — evidence-to-conclusion bridging" },
        { key: "epistemicHumility", weight: weights.epistemicHumility, description: "Appropriate uncertainty acknowledgment and prediction precision" },
        { key: "reasoningTraceability", weight: weights.reasoningTraceability, description: "Can each claim be traced to a cited data source? Measures source-attribution density, claim-source pairing, orphan claim detection", isNew: true },
        { key: "adversarialCoherence", weight: weights.adversarialCoherence, description: "Does reasoning hold up against contrary signals? Measures counterargument acknowledgment, conflicting-data handling, scenario planning", isNew: true },
      ],
    },
    {
      name: "Safety & Trust",
      weight: 0.11,
      dimensions: [
        { key: "hallucinationRate", weight: weights.hallucinationRate, description: "Rate of factually incorrect claims" },
        { key: "instructionDiscipline", weight: weights.instructionDiscipline, description: "Compliance with trading rules" },
        { key: "riskAwareness", weight: weights.riskAwareness, description: "Degree to which agent discusses risk" },
      ],
    },
    {
      name: "Behavioral Intelligence",
      weight: 0.09,
      dimensions: [
        { key: "strategyConsistency", weight: weights.strategyConsistency, description: "Consistency of strategy over time" },
        { key: "adaptability", weight: weights.adaptability, description: "Ability to adjust to market conditions" },
        { key: "confidenceCalibration", weight: weights.confidenceCalibration, description: "Correlation between confidence and outcomes" },
        { key: "crossRoundLearning", weight: weights.crossRoundLearning, description: "Evidence of learning from previous rounds" },
      ],
    },
    {
      name: "Predictive Power",
      weight: 0.06,
      dimensions: [
        { key: "outcomeAccuracy", weight: weights.outcomeAccuracy, description: "Accuracy of predicted vs actual outcomes" },
        { key: "marketRegimeAwareness", weight: weights.marketRegimeAwareness, description: "Recognition of market conditions" },
        { key: "edgeConsistency", weight: weights.edgeConsistency, description: "Consistency of positive edge across rounds" },
      ],
    },
    {
      name: "Governance & Accountability",
      weight: 0.10,
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
    benchmark: "moltapp-v34",
    dimensionCount: getDimensionCount(),
    version: getBenchmarkVersion(),
    categories,
    totalWeight: Object.values(weights).reduce((a, b) => a + b, 0).toFixed(4),
  });
});

// ---------------------------------------------------------------------------
// GET /traceability/:agentId — Reasoning traceability analysis
// ---------------------------------------------------------------------------

benchmarkV34ApiRoutes.get("/traceability/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const trades = getTradeGradesByAgent(agentId, 100);

  if (trades.length === 0) {
    return c.json({
      ok: true,
      agentId,
      avgTraceability: 0,
      distribution: { excellent: 0, good: 0, moderate: 0, weak: 0 },
      topTrades: [],
      version: "34.0",
    });
  }

  const scores = trades.map((t) => t.reasoningTraceabilityScore);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;

  const distribution = {
    excellent: countByCondition(scores, (s) => s >= 80),
    good: countByCondition(scores, (s) => s >= 60 && s < 80),
    moderate: countByCondition(scores, (s) => s >= 40 && s < 60),
    weak: countByCondition(scores, (s) => s < 40),
  };

  const sorted = [...trades].sort((a, b) => b.reasoningTraceabilityScore - a.reasoningTraceabilityScore);
  const topTrades = sorted.slice(0, 5).map((t) => ({
    tradeId: t.tradeId,
    symbol: t.symbol,
    action: t.action,
    traceabilityScore: t.reasoningTraceabilityScore,
    sourceQuality: t.sourceQualityScore,
    overallGrade: t.overallGrade,
    reasoning: t.reasoning.slice(0, 300),
    gradedAt: t.gradedAt,
  }));

  const worstTrades = sorted.slice(-3).reverse().map((t) => ({
    tradeId: t.tradeId,
    symbol: t.symbol,
    action: t.action,
    traceabilityScore: t.reasoningTraceabilityScore,
    overallGrade: t.overallGrade,
    reasoning: t.reasoning.slice(0, 200),
    gradedAt: t.gradedAt,
  }));

  return c.json({
    ok: true,
    agentId,
    avgTraceability: round2(avg),
    distribution,
    topTrades,
    worstTrades,
    interpretation: {
      excellent: "Every claim backed by cited data source",
      good: "Most claims traceable; minor orphan claims",
      moderate: "Some claims lack source attribution",
      weak: "Many unsupported assertions; poor source-claim pairing",
    },
    version: "34.0",
  });
});

// ---------------------------------------------------------------------------
// GET /adversarial/:agentId — Adversarial coherence analysis
// ---------------------------------------------------------------------------

benchmarkV34ApiRoutes.get("/adversarial/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const trades = getTradeGradesByAgent(agentId, 100);

  if (trades.length === 0) {
    return c.json({
      ok: true,
      agentId,
      avgAdversarialCoherence: 0,
      distribution: { resilient: 0, moderate: 0, fragile: 0 },
      topTrades: [],
      version: "34.0",
    });
  }

  const scores = trades.map((t) => t.adversarialCoherenceScore);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;

  const distribution = {
    resilient: countByCondition(scores, (s) => s >= 70),
    moderate: countByCondition(scores, (s) => s >= 40 && s < 70),
    fragile: countByCondition(scores, (s) => s < 40),
  };

  const sorted = [...trades].sort((a, b) => b.adversarialCoherenceScore - a.adversarialCoherenceScore);

  // Most resilient trades (reasoning holds up under scrutiny)
  const resilientTrades = sorted.slice(0, 5).map((t) => ({
    tradeId: t.tradeId,
    symbol: t.symbol,
    action: t.action,
    adversarialCoherence: t.adversarialCoherenceScore,
    coherenceScore: t.coherenceScore,
    confidence: t.confidence,
    overallGrade: t.overallGrade,
    reasoning: t.reasoning.slice(0, 300),
    gradedAt: t.gradedAt,
  }));

  // Most fragile trades (reasoning crumbles under contrary evidence)
  const fragileTrades = sorted.slice(-3).reverse().map((t) => ({
    tradeId: t.tradeId,
    symbol: t.symbol,
    action: t.action,
    adversarialCoherence: t.adversarialCoherenceScore,
    coherenceScore: t.coherenceScore,
    confidence: t.confidence,
    overallGrade: t.overallGrade,
    reasoning: t.reasoning.slice(0, 200),
    gradedAt: t.gradedAt,
  }));

  return c.json({
    ok: true,
    agentId,
    avgAdversarialCoherence: round2(avg),
    distribution,
    resilientTrades,
    fragileTrades,
    interpretation: {
      resilient: "Agent acknowledges counterarguments, handles conflicting data, plans for scenarios",
      moderate: "Agent addresses some contrary signals but misses others",
      fragile: "Agent ignores contradictory evidence; one-sided analysis only",
    },
    version: "34.0",
  });
});

// ---------------------------------------------------------------------------
// GET /reasoning-profile — Cross-agent reasoning quality comparison
// ---------------------------------------------------------------------------

benchmarkV34ApiRoutes.get("/reasoning-profile", (c) => {
  const scores = getAgentScores();

  const profiles = scores.map((s) => ({
    agentId: s.agentId,
    agentName: s.agentName,
    provider: s.provider,
    model: s.model,
    tier: s.tier,
    compositeScore: s.compositeScore,
    reasoningProfile: {
      coherence: s.dimensions.coherence,
      depth: s.dimensions.reasoningDepth,
      sourceQuality: s.dimensions.sourceQuality,
      logicalConsistency: s.dimensions.logicalConsistency,
      transparency: s.dimensions.reasoningTransparency,
      grounding: s.dimensions.reasoningGrounding,
      causalReasoning: s.dimensions.causalReasoning,
      epistemicHumility: s.dimensions.epistemicHumility,
      traceability: s.dimensions.reasoningTraceability,
      adversarialCoherence: s.dimensions.adversarialCoherence,
    },
    safetyProfile: {
      hallucinationRate: s.dimensions.hallucinationRate,
      discipline: s.dimensions.instructionDiscipline,
      riskAwareness: s.dimensions.riskAwareness,
    },
    strengthsAndWeaknesses: {
      strengths: Object.entries(s.dimensions)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([dim, score]) => `${dim}: ${score}`),
      weaknesses: Object.entries(s.dimensions)
        .sort(([, a], [, b]) => a - b)
        .slice(0, 3)
        .map(([dim, score]) => `${dim}: ${score}`),
    },
  }));

  return c.json({
    ok: true,
    profiles,
    version: "34.0",
    dimensionCount: 28,
  });
});

// ---------------------------------------------------------------------------
// GET /export/jsonl — Full benchmark dataset export (JSONL)
// ---------------------------------------------------------------------------

benchmarkV34ApiRoutes.get("/export/jsonl", (c) => {
  const grades = getTradeGrades(2000);

  const lines = grades.map((g) => JSON.stringify({
    benchmark_version: "34.0",
    dimension_count: 28,
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
    reasoning_traceability_score: g.reasoningTraceabilityScore,
    adversarial_coherence_score: g.adversarialCoherenceScore,
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
      "Content-Disposition": 'attachment; filename="molt-benchmark-v34.jsonl"',
    },
  });
});

// ---------------------------------------------------------------------------
// GET /export/csv — CSV export of agent scores
// ---------------------------------------------------------------------------

benchmarkV34ApiRoutes.get("/export/csv", (c) => {
  const scores = getAgentScores();
  const sorted = [...scores].sort((a, b) => b.compositeScore - a.compositeScore);

  const dimensionNames = [
    "pnlPercent", "sharpeRatio", "maxDrawdown",
    "coherence", "reasoningDepth", "sourceQuality",
    "logicalConsistency", "reasoningIntegrity", "reasoningTransparency",
    "reasoningGrounding", "causalReasoning", "epistemicHumility",
    "reasoningTraceability", "adversarialCoherence",
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
      "Content-Disposition": 'attachment; filename="molt-benchmark-v34-agents.csv"',
    },
  });
});

// ---------------------------------------------------------------------------
// GET /health — Benchmark engine health check
// ---------------------------------------------------------------------------

benchmarkV34ApiRoutes.get("/health", (c) => {
  const scores = getAgentScores();
  const allTrades = getTradeGrades(2000);
  const uptimeMs = Date.now() - startTime;
  const uptimeSeconds = Math.floor(uptimeMs / 1000);

  return c.json({
    ok: true,
    benchmark: "moltapp-v34",
    dimensionCount: getDimensionCount(),
    tradeCount: allTrades.length,
    agentCount: scores.length,
    version: getBenchmarkVersion(),
    uptime: `${uptimeSeconds}s`,
    engineStatus: "operational",
    newInV34: [
      "reasoning_traceability: Can each claim be traced to a cited data source? Source-attribution density, claim-source pairing, orphan claim detection",
      "adversarial_coherence: Does reasoning hold up against contrary signals? Counterargument acknowledgment, conflicting-data handling, scenario planning",
    ],
  });
});
