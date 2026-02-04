/**
 * Benchmark V35 API — 30-Dimension AI Trading Benchmark
 *
 * Researcher-facing API for the v35 benchmark framework.
 * NEW in v35: Information Asymmetry Detection + Temporal Reasoning Quality.
 *
 * Routes:
 * - GET /leaderboard               — Ranked agents by composite score
 * - GET /trade-grades              — Individual trade quality assessments
 * - GET /dimensions                — All 30 dimension definitions and weights
 * - GET /info-asymmetry/:agentId   — Information asymmetry analysis
 * - GET /temporal/:agentId         — Temporal reasoning analysis
 * - GET /traceability/:agentId     — Reasoning traceability (inherited)
 * - GET /adversarial/:agentId      — Adversarial coherence (inherited)
 * - GET /reasoning-profile         — Cross-agent reasoning quality comparison
 * - GET /justification/:agentId    — Agent reasoning justification history
 * - GET /predictions               — Outcome predictions with resolution status
 * - GET /consensus                 — Multi-agent consensus analysis
 * - GET /export/jsonl              — Full benchmark dataset export (JSONL)
 * - GET /export/csv                — Agent scores export (CSV)
 * - GET /health                    — Benchmark engine health check
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
  type V35TradeGrade,
} from "../services/v35-benchmark-engine.ts";

export const benchmarkV35ApiRoutes = new Hono();

const startTime = Date.now();

// ---------------------------------------------------------------------------
// GET /leaderboard — Ranked agents by 30-dimension composite score
// ---------------------------------------------------------------------------

benchmarkV35ApiRoutes.get("/leaderboard", (c) => {
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
    dimensionCount: 30,
    version: "35.0",
  });
});

// ---------------------------------------------------------------------------
// GET /trade-grades — Individual trade quality assessments
// ---------------------------------------------------------------------------

benchmarkV35ApiRoutes.get("/trade-grades", (c) => {
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
        informationAsymmetry: g.informationAsymmetryScore,
        temporalReasoning: g.temporalReasoningScore,
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
    version: "35.0",
  });
});

// ---------------------------------------------------------------------------
// GET /dimensions — All 30 dimension definitions and weights
// ---------------------------------------------------------------------------

benchmarkV35ApiRoutes.get("/dimensions", (c) => {
  const weights = getDimensionWeights();

  const categories = [
    {
      name: "Financial Performance",
      weight: 0.15,
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
        { key: "reasoningTraceability", weight: weights.reasoningTraceability, description: "Can each claim be traced to a cited data source? Measures source-attribution density, claim-source pairing, orphan claim detection" },
        { key: "adversarialCoherence", weight: weights.adversarialCoherence, description: "Does reasoning hold up against contrary signals? Measures counterargument acknowledgment, conflicting-data handling, scenario planning" },
        { key: "informationAsymmetry", weight: weights.informationAsymmetry, description: "Does agent surface unique data or insights not used by peers? Measures novel source usage, unique signal detection, information edge quantification", isNew: true },
        { key: "temporalReasoningQuality", weight: weights.temporalReasoningQuality, description: "How well does agent reason about time-dependent factors? Measures temporal awareness, sequencing accuracy, time-horizon alignment, recency weighting", isNew: true },
      ],
    },
    {
      name: "Safety & Trust",
      weight: 0.10,
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
    benchmark: "moltapp-v35",
    dimensionCount: getDimensionCount(),
    version: getBenchmarkVersion(),
    categories,
    totalWeight: Object.values(weights).reduce((a, b) => a + b, 0).toFixed(4),
  });
});

// ---------------------------------------------------------------------------
// GET /info-asymmetry/:agentId — Information asymmetry analysis
// ---------------------------------------------------------------------------

benchmarkV35ApiRoutes.get("/info-asymmetry/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const trades = getTradeGradesByAgent(agentId, 100);

  if (trades.length === 0) {
    return c.json({
      ok: true,
      agentId,
      avgInformationAsymmetry: 0,
      distribution: { highEdge: 0, moderateEdge: 0, lowEdge: 0, noEdge: 0 },
      mostUniqueTrades: [],
      version: "35.0",
    });
  }

  const scores = trades.map((t) => t.informationAsymmetryScore);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;

  const distribution = {
    highEdge: scores.filter((s) => s >= 75).length,
    moderateEdge: scores.filter((s) => s >= 50 && s < 75).length,
    lowEdge: scores.filter((s) => s >= 25 && s < 50).length,
    noEdge: scores.filter((s) => s < 25).length,
  };

  const sorted = [...trades].sort((a, b) => b.informationAsymmetryScore - a.informationAsymmetryScore);

  const mostUniqueTrades = sorted.slice(0, 5).map((t) => ({
    tradeId: t.tradeId,
    symbol: t.symbol,
    action: t.action,
    informationAsymmetryScore: t.informationAsymmetryScore,
    sourceQuality: t.sourceQualityScore,
    reasoningTraceability: t.reasoningTraceabilityScore,
    overallGrade: t.overallGrade,
    reasoning: t.reasoning.slice(0, 300),
    gradedAt: t.gradedAt,
  }));

  const leastUniqueTrades = sorted.slice(-3).reverse().map((t) => ({
    tradeId: t.tradeId,
    symbol: t.symbol,
    action: t.action,
    informationAsymmetryScore: t.informationAsymmetryScore,
    overallGrade: t.overallGrade,
    reasoning: t.reasoning.slice(0, 200),
    gradedAt: t.gradedAt,
  }));

  return c.json({
    ok: true,
    agentId,
    avgInformationAsymmetry: Math.round(avg * 100) / 100,
    distribution,
    mostUniqueTrades,
    leastUniqueTrades,
    interpretation: {
      highEdge: "Agent surfaces novel data sources or unique insights not used by peers",
      moderateEdge: "Agent uses some distinctive data but largely overlaps with peers",
      lowEdge: "Minimal unique information; mostly consensus-driven reasoning",
      noEdge: "No discernible information advantage; fully redundant with peer analysis",
    },
    version: "35.0",
  });
});

// ---------------------------------------------------------------------------
// GET /temporal/:agentId — Temporal reasoning analysis
// ---------------------------------------------------------------------------

benchmarkV35ApiRoutes.get("/temporal/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const trades = getTradeGradesByAgent(agentId, 100);

  if (trades.length === 0) {
    return c.json({
      ok: true,
      agentId,
      avgTemporalReasoning: 0,
      distribution: { excellent: 0, good: 0, moderate: 0, weak: 0 },
      bestTemporalTrades: [],
      version: "35.0",
    });
  }

  const scores = trades.map((t) => t.temporalReasoningScore);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;

  const distribution = {
    excellent: scores.filter((s) => s >= 80).length,
    good: scores.filter((s) => s >= 60 && s < 80).length,
    moderate: scores.filter((s) => s >= 40 && s < 60).length,
    weak: scores.filter((s) => s < 40).length,
  };

  const sorted = [...trades].sort((a, b) => b.temporalReasoningScore - a.temporalReasoningScore);

  const bestTemporalTrades = sorted.slice(0, 5).map((t) => ({
    tradeId: t.tradeId,
    symbol: t.symbol,
    action: t.action,
    temporalReasoningScore: t.temporalReasoningScore,
    causalReasoningScore: t.causalReasoningScore,
    overallGrade: t.overallGrade,
    reasoning: t.reasoning.slice(0, 300),
    gradedAt: t.gradedAt,
  }));

  const worstTemporalTrades = sorted.slice(-3).reverse().map((t) => ({
    tradeId: t.tradeId,
    symbol: t.symbol,
    action: t.action,
    temporalReasoningScore: t.temporalReasoningScore,
    overallGrade: t.overallGrade,
    reasoning: t.reasoning.slice(0, 200),
    gradedAt: t.gradedAt,
  }));

  return c.json({
    ok: true,
    agentId,
    avgTemporalReasoning: Math.round(avg * 100) / 100,
    distribution,
    bestTemporalTrades,
    worstTemporalTrades,
    interpretation: {
      excellent: "Strong temporal awareness with accurate sequencing, time-horizon alignment, and recency weighting",
      good: "Good temporal reasoning; minor gaps in sequencing or time-horizon precision",
      moderate: "Some temporal awareness but inconsistent time-horizon alignment",
      weak: "Poor temporal reasoning; ignores time-dependent factors or conflates timeframes",
    },
    version: "35.0",
  });
});

// ---------------------------------------------------------------------------
// GET /traceability/:agentId — Reasoning traceability analysis (inherited)
// ---------------------------------------------------------------------------

benchmarkV35ApiRoutes.get("/traceability/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const trades = getTradeGradesByAgent(agentId, 100);

  if (trades.length === 0) {
    return c.json({
      ok: true,
      agentId,
      avgTraceability: 0,
      distribution: { excellent: 0, good: 0, moderate: 0, weak: 0 },
      topTrades: [],
      version: "35.0",
    });
  }

  const scores = trades.map((t) => t.reasoningTraceabilityScore);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;

  const distribution = {
    excellent: scores.filter((s) => s >= 80).length,
    good: scores.filter((s) => s >= 60 && s < 80).length,
    moderate: scores.filter((s) => s >= 40 && s < 60).length,
    weak: scores.filter((s) => s < 40).length,
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
    avgTraceability: Math.round(avg * 100) / 100,
    distribution,
    topTrades,
    worstTrades,
    interpretation: {
      excellent: "Every claim backed by cited data source",
      good: "Most claims traceable; minor orphan claims",
      moderate: "Some claims lack source attribution",
      weak: "Many unsupported assertions; poor source-claim pairing",
    },
    version: "35.0",
  });
});

// ---------------------------------------------------------------------------
// GET /adversarial/:agentId — Adversarial coherence analysis (inherited)
// ---------------------------------------------------------------------------

benchmarkV35ApiRoutes.get("/adversarial/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const trades = getTradeGradesByAgent(agentId, 100);

  if (trades.length === 0) {
    return c.json({
      ok: true,
      agentId,
      avgAdversarialCoherence: 0,
      distribution: { resilient: 0, moderate: 0, fragile: 0 },
      resilientTrades: [],
      version: "35.0",
    });
  }

  const scores = trades.map((t) => t.adversarialCoherenceScore);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;

  const distribution = {
    resilient: scores.filter((s) => s >= 70).length,
    moderate: scores.filter((s) => s >= 40 && s < 70).length,
    fragile: scores.filter((s) => s < 40).length,
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
    avgAdversarialCoherence: Math.round(avg * 100) / 100,
    distribution,
    resilientTrades,
    fragileTrades,
    interpretation: {
      resilient: "Agent acknowledges counterarguments, handles conflicting data, plans for scenarios",
      moderate: "Agent addresses some contrary signals but misses others",
      fragile: "Agent ignores contradictory evidence; one-sided analysis only",
    },
    version: "35.0",
  });
});

// ---------------------------------------------------------------------------
// GET /reasoning-profile — Cross-agent reasoning quality comparison
// ---------------------------------------------------------------------------

benchmarkV35ApiRoutes.get("/reasoning-profile", (c) => {
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
      informationAsymmetry: s.dimensions.informationAsymmetry,
      temporalReasoningQuality: s.dimensions.temporalReasoningQuality,
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
    version: "35.0",
    dimensionCount: 30,
  });
});

// ---------------------------------------------------------------------------
// GET /justification/:agentId — Agent reasoning justification history
// ---------------------------------------------------------------------------

benchmarkV35ApiRoutes.get("/justification/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const trades = getTradeGradesByAgent(agentId, 50);

  if (trades.length === 0) {
    return c.json({
      ok: true,
      agentId,
      justifications: [],
      total: 0,
      version: "35.0",
    });
  }

  const justifications = trades.map((t) => ({
    tradeId: t.tradeId,
    symbol: t.symbol,
    action: t.action,
    confidence: t.confidence,
    intent: t.intent,
    reasoning: t.reasoning.slice(0, 500),
    overallGrade: t.overallGrade,
    scores: {
      coherence: t.coherenceScore,
      reasoningDepth: t.reasoningDepthScore,
      sourceQuality: t.sourceQualityScore,
      logicalConsistency: t.logicalConsistencyScore,
      transparency: t.transparencyScore,
      accountability: t.accountabilityScore,
      grounding: t.groundingScore,
      consensusQuality: t.consensusQualityScore,
      causalReasoning: t.causalReasoningScore,
      epistemicHumility: t.epistemicHumilityScore,
      reasoningTraceability: t.reasoningTraceabilityScore,
      adversarialCoherence: t.adversarialCoherenceScore,
      informationAsymmetry: t.informationAsymmetryScore,
      temporalReasoning: t.temporalReasoningScore,
    },
    hallucinationFlags: t.hallucinationFlags,
    disciplinePassed: t.disciplinePassed,
    predictedOutcome: t.predictedOutcome,
    outcomeResolved: t.outcomeResolved,
    gradedAt: t.gradedAt,
  }));

  return c.json({
    ok: true,
    agentId,
    justifications,
    total: justifications.length,
    version: "35.0",
  });
});

// ---------------------------------------------------------------------------
// GET /predictions — Outcome predictions with resolution status
// ---------------------------------------------------------------------------

benchmarkV35ApiRoutes.get("/predictions", (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "100", 10), 200);
  const grades = getTradeGrades(limit);

  const predictions = grades
    .filter((g) => g.predictedOutcome !== null && g.predictedOutcome !== undefined)
    .map((g) => ({
      tradeId: g.tradeId,
      agentId: g.agentId,
      symbol: g.symbol,
      action: g.action,
      confidence: g.confidence,
      predictedOutcome: g.predictedOutcome,
      actualOutcome: g.actualOutcome,
      outcomeResolved: g.outcomeResolved,
      overallGrade: g.overallGrade,
      epistemicHumility: g.epistemicHumilityScore,
      temporalReasoning: g.temporalReasoningScore,
      gradedAt: g.gradedAt,
    }));

  const resolved = predictions.filter((p) => p.outcomeResolved !== "pending");
  const correct = resolved.filter((p) => p.outcomeResolved === "correct").length;
  const incorrect = resolved.filter((p) => p.outcomeResolved === "incorrect").length;
  const partial = resolved.filter((p) => p.outcomeResolved === "partial").length;

  return c.json({
    ok: true,
    predictions,
    summary: {
      total: predictions.length,
      resolved: resolved.length,
      pending: predictions.length - resolved.length,
      correct,
      incorrect,
      partial,
      accuracy: resolved.length > 0
        ? Math.round((correct / resolved.length) * 10000) / 100
        : null,
    },
    version: "35.0",
  });
});

// ---------------------------------------------------------------------------
// GET /consensus — Multi-agent consensus analysis
// ---------------------------------------------------------------------------

benchmarkV35ApiRoutes.get("/consensus", (c) => {
  const summaries = getRoundSummaries();

  const consensus = summaries.map((s) => {
    const actions = s.agentScores.map((a) => {
      const agentTrades = getTradeGradesByAgent(a.agentId, 5);
      const latestAction = agentTrades.length > 0 ? agentTrades[0].action : "hold";
      return { agentId: a.agentId, agentName: a.agentName, action: latestAction };
    });

    const actionCounts: Record<string, number> = {};
    for (const a of actions) {
      actionCounts[a.action] = (actionCounts[a.action] ?? 0) + 1;
    }

    const totalAgents = actions.length;
    const dominantAction = Object.entries(actionCounts)
      .sort(([, a], [, b]) => b - a)[0];

    const agreementLevel = totalAgents > 0 && dominantAction
      ? Math.round((dominantAction[1] / totalAgents) * 10000) / 100
      : 0;

    const divergentAgents = actions
      .filter((a) => dominantAction && a.action !== dominantAction[0])
      .map((a) => ({ agentId: a.agentId, agentName: a.agentName, action: a.action }));

    return {
      roundId: s.roundId,
      timestamp: s.timestamp,
      marketRegime: s.marketRegime,
      agentCount: totalAgents,
      consensusAgreement: s.consensusAgreement,
      dominantAction: dominantAction ? dominantAction[0] : null,
      agreementLevel,
      actionBreakdown: actionCounts,
      divergentAgents,
      avgConsensusQuality: s.avgConsensusQuality,
      avgTraceability: s.avgTraceability,
      avgAdversarialCoherence: s.avgAdversarialCoherence,
      avgInformationAsymmetry: s.avgInformationAsymmetry,
      avgTemporalReasoning: s.avgTemporalReasoning,
    };
  });

  return c.json({
    ok: true,
    rounds: consensus,
    total: consensus.length,
    version: "35.0",
  });
});

// ---------------------------------------------------------------------------
// GET /export/jsonl — Full benchmark dataset export (JSONL)
// ---------------------------------------------------------------------------

benchmarkV35ApiRoutes.get("/export/jsonl", (c) => {
  const grades = getTradeGrades(2000);

  const lines = grades.map((g) => JSON.stringify({
    benchmark_version: "35.0",
    dimension_count: 30,
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
    information_asymmetry_score: g.informationAsymmetryScore,
    temporal_reasoning_score: g.temporalReasoningScore,
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
      "Content-Type": "application/x-ndjson",
      "Content-Disposition": 'attachment; filename="molt-benchmark-v35.jsonl"',
    },
  });
});

// ---------------------------------------------------------------------------
// GET /export/csv — CSV export of agent scores
// ---------------------------------------------------------------------------

benchmarkV35ApiRoutes.get("/export/csv", (c) => {
  const scores = getAgentScores();
  const sorted = [...scores].sort((a, b) => b.compositeScore - a.compositeScore);

  const dimensionNames = [
    "pnlPercent", "sharpeRatio", "maxDrawdown",
    "coherence", "reasoningDepth", "sourceQuality",
    "logicalConsistency", "reasoningIntegrity", "reasoningTransparency",
    "reasoningGrounding", "causalReasoning", "epistemicHumility",
    "reasoningTraceability", "adversarialCoherence",
    "informationAsymmetry", "temporalReasoningQuality",
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
      "Content-Disposition": 'attachment; filename="molt-benchmark-v35-agents.csv"',
    },
  });
});

// ---------------------------------------------------------------------------
// GET /health — Benchmark engine health check
// ---------------------------------------------------------------------------

benchmarkV35ApiRoutes.get("/health", (c) => {
  const scores = getAgentScores();
  const grades = getTradeGrades();
  return c.json({
    ok: true,
    engine: "v35",
    version: getBenchmarkVersion(),
    dimensions: getDimensionCount(),
    agentsScored: scores.length,
    tradesGraded: grades.length,
    roundsProcessed: getRoundSummaries().length,
    uptimeMs: Date.now() - startTime,
    newDimensions: ["information_asymmetry", "temporal_reasoning_quality"],
  });
});
