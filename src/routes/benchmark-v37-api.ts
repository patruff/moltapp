/**
 * Benchmark V37 API — 34-Dimension AI Trading Benchmark
 *
 * Researcher-facing API for the v37 benchmark framework.
 * NEW in v37: Reasoning Composability + Strategic Foresight.
 *
 * Routes:
 * - GET /leaderboard               — Ranked agents by 34-dimension composite score
 * - GET /trade-grades              — Individual trade quality assessments
 * - GET /dimensions                — All 34 dimension definitions and weights
 * - GET /composability/:agentId    — Reasoning composability analysis (NEW)
 * - GET /foresight/:agentId        — Strategic foresight analysis (NEW)
 * - GET /auditability/:agentId     — Reasoning auditability analysis (inherited)
 * - GET /reversibility/:agentId    — Decision reversibility analysis (inherited)
 * - GET /reasoning-profile         — Cross-agent reasoning quality comparison
 * - GET /justification/:agentId    — Agent reasoning justification history
 * - GET /predictions               — Outcome predictions with resolution status
 * - GET /consensus                 — Multi-agent consensus analysis
 * - GET /export/jsonl              — Full benchmark dataset export (JSONL)
 * - GET /export/csv                — Agent scores export (CSV)
 * - GET /weight-analysis           — Data-driven dimension weight optimization analysis
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
  computeOptimalWeights,
  type V37TradeGrade,
} from "../services/v37-benchmark-engine.ts";
import { countByCondition, round2 } from "../lib/math-utils.ts";
import {
  TOP_TRADES_LIMIT,
  TOP_DIMENSIONS_LIMIT,
  WEAK_DIMENSIONS_LIMIT,
  REASONING_DISPLAY_LENGTH,
  REASONING_PREVIEW_LENGTH,
  TOP_CORRELATIONS_LIMIT,
} from "../lib/display-constants.ts";

export const benchmarkV37ApiRoutes = new Hono();

const startTime = Date.now();

// ---------------------------------------------------------------------------
// GET /leaderboard — Ranked agents by 34-dimension composite score
// ---------------------------------------------------------------------------

benchmarkV37ApiRoutes.get("/leaderboard", (c) => {
  const scores = getAgentScores();
  const sorted = [...scores].sort((a, b) => b.compositeScore - a.compositeScore);

  return c.json({
    ok: true,
    benchmark: "MoltApp v37",
    dimensions: getDimensionCount(),
    version: getBenchmarkVersion(),
    leaderboard: sorted.map((s, i) => ({
      rank: i + 1,
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
        .slice(0, TOP_DIMENSIONS_LIMIT)
        .map(([dim, score]) => ({ dimension: dim, score })),
      weakestDimensions: Object.entries(s.dimensions)
        .sort(([, a], [, b]) => a - b)
        .slice(0, WEAK_DIMENSIONS_LIMIT)
        .map(([dim, score]) => ({ dimension: dim, score })),
      reasoningProfitCorrelation: s.reasoningProfitCorrelation ?? null,
      lastUpdated: s.lastUpdated,
    })),
  });
});

// ---------------------------------------------------------------------------
// GET /trade-grades — Individual trade quality assessments
// ---------------------------------------------------------------------------

benchmarkV37ApiRoutes.get("/trade-grades", (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 200);
  const agentId = c.req.query("agent");
  const grades = agentId ? getTradeGradesByAgent(agentId, limit) : getTradeGrades(limit);

  return c.json({
    ok: true,
    count: grades.length,
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
        marketMicrostructure: g.reasoningAuditabilityScore,
        decisionReversibility: g.decisionReversibilityScore,
        reasoningComposability: g.reasoningComposabilityScore,
        strategicForesight: g.strategicForesightScore,
      },
      hallucinationFlags: g.hallucinationFlags,
      disciplinePassed: g.disciplinePassed,
      integrityHash: g.integrityHash,
      predictedOutcome: g.predictedOutcome,
      actualOutcome: g.actualOutcome,
      outcomeResolved: g.outcomeResolved,
      actualPnlPercent: g.actualPnlPercent ?? null,
      tradeOutcome: g.tradeOutcome ?? null,
      gradedAt: g.gradedAt,
    })),
    version: "37.0",
  });
});

// ---------------------------------------------------------------------------
// GET /dimensions — All 34 dimension definitions and weights
// ---------------------------------------------------------------------------

benchmarkV37ApiRoutes.get("/dimensions", (c) => {
  const weights = getDimensionWeights();

  return c.json({
    ok: true,
    dimensionCount: getDimensionCount(),
    version: getBenchmarkVersion(),
    categories: [
      {
        name: "Financial Performance", weight: 0.30, dimensions: [
          { key: "pnlPercent", label: "P&L %", weight: weights.pnlPercent, description: "ROI since round start" },
          { key: "sharpeRatio", label: "Sharpe Ratio", weight: weights.sharpeRatio, description: "Risk-adjusted return (annualized)" },
          { key: "maxDrawdown", label: "Max Drawdown", weight: weights.maxDrawdown, description: "Largest peak-to-trough decline" },
        ],
      },
      {
        name: "Reasoning Quality", weight: 0.35, dimensions: [
          { key: "coherence", label: "Coherence", weight: weights.coherence, description: "Reasoning logically supports trade action" },
          { key: "reasoningDepth", label: "Reasoning Depth", weight: weights.reasoningDepth, description: "Sophistication of multi-step reasoning" },
          { key: "sourceQuality", label: "Source Quality", weight: weights.sourceQuality, description: "Breadth and quality of data sources cited" },
          { key: "logicalConsistency", label: "Logical Consistency", weight: weights.logicalConsistency, description: "Internal logical consistency" },
          { key: "reasoningIntegrity", label: "Reasoning Integrity", weight: weights.reasoningIntegrity, description: "Cryptographic hash verification of reasoning chains" },
          { key: "reasoningTransparency", label: "Transparency", weight: weights.reasoningTransparency, description: "How well agent explains decision-making" },
          { key: "reasoningGrounding", label: "Grounding", weight: weights.reasoningGrounding, description: "How well reasoning anchored in real market data" },
          { key: "causalReasoning", label: "Causal Reasoning", weight: weights.causalReasoning, description: "Multi-step logical chain quality" },
          { key: "epistemicHumility", label: "Epistemic Humility", weight: weights.epistemicHumility, description: "Appropriate uncertainty acknowledgment" },
          { key: "reasoningTraceability", label: "Traceability", weight: weights.reasoningTraceability, description: "Can each claim be traced to a cited data source?" },
          { key: "adversarialCoherence", label: "Adversarial Coherence", weight: weights.adversarialCoherence, description: "Does reasoning hold up against contrary signals?" },
          { key: "informationAsymmetry", label: "Information Asymmetry", weight: weights.informationAsymmetry, description: "Does agent surface unique data or insights?" },
          { key: "temporalReasoningQuality", label: "Temporal Reasoning", weight: weights.temporalReasoningQuality, description: "How well agent reasons about time-dependent factors" },
          { key: "reasoningAuditability", label: "Reasoning Auditability", weight: weights.reasoningAuditability, description: "Can every claim be independently verified? Evidence specificity, falsifiability, verifiable reference density, audit trail completeness" },
          { key: "decisionReversibility", label: "Decision Reversibility", weight: weights.decisionReversibility, description: "Does the agent plan for when its thesis breaks? Exit conditions, invalidation criteria, contingency planning, risk-reward framing" },
          { key: "reasoningComposability", label: "Reasoning Composability", weight: weights.reasoningComposability, description: "Can reasoning sub-components be recombined into novel strategies? Modularity of argument structure, reusable reasoning patterns, cross-domain applicability", isNew: true },
          { key: "strategicForesight", label: "Strategic Foresight", weight: weights.strategicForesight, description: "Does the agent anticipate second-order effects and future market states? Scenario planning depth, cascading impact analysis, anticipatory positioning", isNew: true },
        ],
      },
      {
        name: "Safety & Trust", weight: 0.15, dimensions: [
          { key: "hallucinationRate", label: "Hallucination Rate", weight: weights.hallucinationRate, description: "Rate of factually incorrect claims" },
          { key: "instructionDiscipline", label: "Instruction Discipline", weight: weights.instructionDiscipline, description: "Compliance with trading rules" },
          { key: "riskAwareness", label: "Risk Awareness", weight: weights.riskAwareness, description: "Degree to which agent discusses risk" },
        ],
      },
      {
        name: "Behavioral Intelligence", weight: 0.08, dimensions: [
          { key: "strategyConsistency", label: "Strategy Consistency", weight: weights.strategyConsistency, description: "Consistency of strategy over time" },
          { key: "adaptability", label: "Adaptability", weight: weights.adaptability, description: "Ability to adjust to market conditions" },
          { key: "confidenceCalibration", label: "Confidence Calibration", weight: weights.confidenceCalibration, description: "Correlation between confidence and outcomes" },
          { key: "crossRoundLearning", label: "Cross-Round Learning", weight: weights.crossRoundLearning, description: "Evidence of learning from previous rounds" },
        ],
      },
      {
        name: "Predictive Power", weight: 0.07, dimensions: [
          { key: "outcomeAccuracy", label: "Outcome Accuracy", weight: weights.outcomeAccuracy, description: "Accuracy of predicted vs actual outcomes" },
          { key: "marketRegimeAwareness", label: "Regime Awareness", weight: weights.marketRegimeAwareness, description: "Recognition of market conditions" },
          { key: "edgeConsistency", label: "Edge Consistency", weight: weights.edgeConsistency, description: "Consistency of positive edge across rounds" },
        ],
      },
      {
        name: "Governance & Accountability", weight: 0.05, dimensions: [
          { key: "tradeAccountability", label: "Trade Accountability", weight: weights.tradeAccountability, description: "Taking responsibility for outcomes" },
          { key: "reasoningQualityIndex", label: "RQI", weight: weights.reasoningQualityIndex, description: "Aggregate reasoning quality metric" },
          { key: "decisionAccountability", label: "Decision Accountability", weight: weights.decisionAccountability, description: "Tracking predictions and acknowledging errors" },
          { key: "consensusQuality", label: "Consensus Quality", weight: weights.consensusQuality, description: "Quality of agreement/divergence with peers" },
        ],
      },
    ],
    totalWeight: Object.values(weights).reduce((a, b) => a + b, 0).toFixed(4),
  });
});

// ---------------------------------------------------------------------------
// GET /composability/:agentId — Reasoning composability analysis (NEW)
// ---------------------------------------------------------------------------

benchmarkV37ApiRoutes.get("/composability/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const trades = getTradeGradesByAgent(agentId, 100);

  if (trades.length === 0) {
    return c.json({
      ok: true,
      agentId,
      avgComposability: 0,
      distribution: { excellent: 0, good: 0, moderate: 0, weak: 0 },
      topTrades: [],
      version: "37.0",
    });
  }

  const scores = trades.map((t) => t.reasoningComposabilityScore);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;

  const distribution = {
    excellent: countByCondition(scores, (s) => s >= 80),
    good: countByCondition(scores, (s) => s >= 60 && s < 80),
    moderate: countByCondition(scores, (s) => s >= 40 && s < 60),
    weak: countByCondition(scores, (s) => s < 40),
  };

  const sorted = [...trades].sort((a, b) => b.reasoningComposabilityScore - a.reasoningComposabilityScore);

  const topTrades = sorted.slice(0, 5).map((t) => ({
    tradeId: t.tradeId,
    symbol: t.symbol,
    action: t.action,
    composabilityScore: t.reasoningComposabilityScore,
    sourceQuality: t.sourceQualityScore,
    overallGrade: t.overallGrade,
    reasoning: t.reasoning.slice(0, 300),
    gradedAt: t.gradedAt,
  }));

  const worstTrades = sorted.slice(-3).reverse().map((t) => ({
    tradeId: t.tradeId,
    symbol: t.symbol,
    action: t.action,
    composabilityScore: t.reasoningComposabilityScore,
    overallGrade: t.overallGrade,
    reasoning: t.reasoning.slice(0, 200),
    gradedAt: t.gradedAt,
  }));

  return c.json({
    ok: true,
    agentId,
    avgComposability: round2(avg),
    distribution,
    topTrades,
    worstTrades,
    interpretation: {
      excellent: "Reasoning sub-components are highly modular: arguments can be decomposed, recombined, and applied across domains with clear reusable patterns",
      good: "Most reasoning steps are modular but some arguments are monolithic or domain-locked",
      moderate: "Agent shows some modular reasoning but frequently relies on single-use argument chains",
      weak: "Reasoning is monolithic with no reusable components — arguments cannot be decomposed or recombined",
    },
    version: "37.0",
  });
});

// ---------------------------------------------------------------------------
// GET /foresight/:agentId — Strategic foresight analysis (NEW)
// ---------------------------------------------------------------------------

benchmarkV37ApiRoutes.get("/foresight/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const trades = getTradeGradesByAgent(agentId, 100);

  if (trades.length === 0) {
    return c.json({
      ok: true,
      agentId,
      avgForesight: 0,
      distribution: { calibrated: 0, moderate: 0, miscalibrated: 0 },
      topTrades: [],
      version: "37.0",
    });
  }

  const scores = trades.map((t) => t.strategicForesightScore);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;

  const distribution = {
    calibrated: countByCondition(scores, (s) => s >= 70),
    moderate: countByCondition(scores, (s) => s >= 40 && s < 70),
    miscalibrated: countByCondition(scores, (s) => s < 40),
  };

  // Find trades without foresight planning
  const noForesight = trades.filter(
    (t) => t.strategicForesightScore < 40,
  );
  const strongForesight = trades.filter(
    (t) => t.strategicForesightScore >= 70,
  );

  const sorted = [...trades].sort((a, b) => b.strategicForesightScore - a.strategicForesightScore);

  return c.json({
    ok: true,
    agentId,
    avgForesight: round2(avg),
    distribution,
    noForesightCount: noForesight.length,
    strongForesightCount: strongForesight.length,
    topTrades: sorted.slice(0, 5).map((t) => ({
      tradeId: t.tradeId,
      symbol: t.symbol,
      action: t.action,
      foresightScore: t.strategicForesightScore,
      confidence: t.confidence,
      reasoningDepth: t.reasoningDepthScore,
      coherence: t.coherenceScore,
      overallGrade: t.overallGrade,
      reasoning: t.reasoning.slice(0, 300),
      gradedAt: t.gradedAt,
    })),
    worstTrades: sorted.slice(-3).reverse().map((t) => ({
      tradeId: t.tradeId,
      symbol: t.symbol,
      action: t.action,
      foresightScore: t.strategicForesightScore,
      confidence: t.confidence,
      reasoningDepth: t.reasoningDepthScore,
      overallGrade: t.overallGrade,
      reasoning: t.reasoning.slice(0, 200),
      gradedAt: t.gradedAt,
    })),
    interpretation: {
      calibrated: "Agent anticipates second-order effects, models cascading market impacts, and positions for multiple future scenarios with clear scenario planning",
      moderate: "Agent mentions some future scenarios but lacks depth in cascading impact analysis or anticipatory positioning",
      miscalibrated: "Agent trades reactively with no anticipation of second-order effects or future market states — no strategic foresight",
    },
    version: "37.0",
  });
});

// ---------------------------------------------------------------------------
// GET /auditability/:agentId — Reasoning auditability analysis (inherited)
// ---------------------------------------------------------------------------

benchmarkV37ApiRoutes.get("/auditability/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const trades = getTradeGradesByAgent(agentId, 100);

  if (trades.length === 0) {
    return c.json({
      ok: true,
      agentId,
      avgAuditability: 0,
      distribution: { excellent: 0, good: 0, moderate: 0, weak: 0 },
      topTrades: [],
      version: "37.0",
    });
  }

  const scores = trades.map((t) => t.reasoningAuditabilityScore);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;

  const distribution = {
    excellent: countByCondition(scores, (s) => s >= 80),
    good: countByCondition(scores, (s) => s >= 60 && s < 80),
    moderate: countByCondition(scores, (s) => s >= 40 && s < 60),
    weak: countByCondition(scores, (s) => s < 40),
  };

  const sorted = [...trades].sort((a, b) => b.reasoningAuditabilityScore - a.reasoningAuditabilityScore);

  const topTrades = sorted.slice(0, 5).map((t) => ({
    tradeId: t.tradeId,
    symbol: t.symbol,
    action: t.action,
    auditabilityScore: t.reasoningAuditabilityScore,
    sourceQuality: t.sourceQualityScore,
    overallGrade: t.overallGrade,
    reasoning: t.reasoning.slice(0, 300),
    gradedAt: t.gradedAt,
  }));

  const worstTrades = sorted.slice(-3).reverse().map((t) => ({
    tradeId: t.tradeId,
    symbol: t.symbol,
    action: t.action,
    auditabilityScore: t.reasoningAuditabilityScore,
    overallGrade: t.overallGrade,
    reasoning: t.reasoning.slice(0, 200),
    gradedAt: t.gradedAt,
  }));

  return c.json({
    ok: true,
    agentId,
    avgAuditability: round2(avg),
    distribution,
    topTrades,
    worstTrades,
    interpretation: {
      excellent: "Every claim in reasoning can be independently verified: specific data cited, falsifiable predictions, clear provenance",
      good: "Most claims are verifiable but some lack specific data references or falsifiable criteria",
      moderate: "Agent cites some sources but many claims are vague or unfalsifiable",
      weak: "Reasoning contains mostly vague or unfalsifiable claims with no audit trail",
    },
    version: "37.0",
  });
});

// ---------------------------------------------------------------------------
// GET /reversibility/:agentId — Decision reversibility analysis (inherited)
// ---------------------------------------------------------------------------

benchmarkV37ApiRoutes.get("/reversibility/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const trades = getTradeGradesByAgent(agentId, 100);

  if (trades.length === 0) {
    return c.json({
      ok: true,
      agentId,
      avgReversibility: 0,
      distribution: { calibrated: 0, moderate: 0, miscalibrated: 0 },
      topTrades: [],
      version: "37.0",
    });
  }

  const scores = trades.map((t) => t.decisionReversibilityScore);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;

  const distribution = {
    calibrated: countByCondition(scores, (s) => s >= 70),
    moderate: countByCondition(scores, (s) => s >= 40 && s < 70),
    miscalibrated: countByCondition(scores, (s) => s < 40),
  };

  // Find trades without exit plans
  const noExitPlan = trades.filter(
    (t) => t.decisionReversibilityScore < 40,
  );
  const strongExitPlan = trades.filter(
    (t) => t.decisionReversibilityScore >= 70,
  );

  const sorted = [...trades].sort((a, b) => b.decisionReversibilityScore - a.decisionReversibilityScore);

  return c.json({
    ok: true,
    agentId,
    avgReversibility: round2(avg),
    distribution,
    noExitPlanCount: noExitPlan.length,
    strongExitPlanCount: strongExitPlan.length,
    topTrades: sorted.slice(0, 5).map((t) => ({
      tradeId: t.tradeId,
      symbol: t.symbol,
      action: t.action,
      reversibilityScore: t.decisionReversibilityScore,
      confidence: t.confidence,
      reasoningDepth: t.reasoningDepthScore,
      coherence: t.coherenceScore,
      overallGrade: t.overallGrade,
      reasoning: t.reasoning.slice(0, 300),
      gradedAt: t.gradedAt,
    })),
    worstTrades: sorted.slice(-3).reverse().map((t) => ({
      tradeId: t.tradeId,
      symbol: t.symbol,
      action: t.action,
      reversibilityScore: t.decisionReversibilityScore,
      confidence: t.confidence,
      reasoningDepth: t.reasoningDepthScore,
      overallGrade: t.overallGrade,
      reasoning: t.reasoning.slice(0, 200),
      gradedAt: t.gradedAt,
    })),
    interpretation: {
      calibrated: "Agent has clear exit plans, thesis invalidation criteria, and risk-reward framing for every trade",
      moderate: "Agent mentions some exit conditions but lacks comprehensive contingency planning",
      miscalibrated: "Agent enters trades without exit plans or thesis invalidation criteria — no reversibility planning",
    },
    version: "37.0",
  });
});

// ---------------------------------------------------------------------------
// GET /reasoning-profile — Cross-agent reasoning quality comparison
// ---------------------------------------------------------------------------

benchmarkV37ApiRoutes.get("/reasoning-profile", (c) => {
  const scores = getAgentScores();
  const profiles = scores.map((s) => ({
    agentId: s.agentId,
    agentName: s.agentName,
    provider: s.provider,
    model: s.model,
    compositeScore: s.compositeScore,
    tier: s.tier,
    reasoningQuality: {
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
      temporalReasoning: s.dimensions.temporalReasoningQuality,
      reasoningAuditability: s.dimensions.reasoningAuditability,
      decisionReversibility: s.dimensions.decisionReversibility,
      reasoningComposability: s.dimensions.reasoningComposability,
      strategicForesight: s.dimensions.strategicForesight,
    },
  }));

  return c.json({ ok: true, profiles, dimensions: getDimensionCount(), version: "37.0" });
});

// ---------------------------------------------------------------------------
// GET /justification/:agentId — Agent reasoning justification history
// ---------------------------------------------------------------------------

benchmarkV37ApiRoutes.get("/justification/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10), 100);
  const trades = getTradeGradesByAgent(agentId, limit);

  return c.json({
    ok: true,
    agentId,
    justifications: trades.map((t) => ({
      tradeId: t.tradeId,
      symbol: t.symbol,
      action: t.action,
      reasoning: t.reasoning,
      confidence: t.confidence,
      coherence: t.coherenceScore,
      hallucinationFlags: t.hallucinationFlags,
      auditabilityScore: t.reasoningAuditabilityScore,
      reversibilityScore: t.decisionReversibilityScore,
      composabilityScore: t.reasoningComposabilityScore,
      foresightScore: t.strategicForesightScore,
      overallGrade: t.overallGrade,
      gradedAt: t.gradedAt,
    })),
    version: "37.0",
  });
});

// ---------------------------------------------------------------------------
// GET /predictions — Outcome predictions with resolution status
// ---------------------------------------------------------------------------

benchmarkV37ApiRoutes.get("/predictions", (c) => {
  const trades = getTradeGrades(100);
  const predictions = trades
    .filter((t) => t.predictedOutcome)
    .map((t) => ({
      tradeId: t.tradeId,
      agentId: t.agentId,
      symbol: t.symbol,
      action: t.action,
      predicted: t.predictedOutcome,
      actual: t.actualOutcome,
      resolved: t.outcomeResolved,
      confidence: t.confidence,
      gradedAt: t.gradedAt,
    }));

  return c.json({ ok: true, predictions, count: predictions.length, version: "37.0" });
});

// ---------------------------------------------------------------------------
// GET /consensus — Multi-agent consensus analysis
// ---------------------------------------------------------------------------

benchmarkV37ApiRoutes.get("/consensus", (c) => {
  const summaries = getRoundSummaries(10);

  return c.json({
    ok: true,
    rounds: summaries.map((s) => ({
      roundId: s.roundId,
      timestamp: s.timestamp,
      consensusAgreement: s.consensusAgreement,
      marketRegime: s.marketRegime,
      avgConsensusQuality: s.avgConsensusQuality,
      avgReasoningAuditability: s.avgReasoningAuditability,
      avgDecisionReversibility: s.avgDecisionReversibility,
      agents: s.agentScores.map((a) => ({
        agentId: a.agentId,
        compositeScore: a.compositeScore,
        tier: a.tier,
      })),
    })),
    version: "37.0",
  });
});

// ---------------------------------------------------------------------------
// GET /export/jsonl — Full benchmark dataset export (JSONL)
// ---------------------------------------------------------------------------

benchmarkV37ApiRoutes.get("/export/jsonl", (c) => {
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
    causal_reasoning_score: t.causalReasoningScore,
    epistemic_humility_score: t.epistemicHumilityScore,
    reasoning_traceability_score: t.reasoningTraceabilityScore,
    adversarial_coherence_score: t.adversarialCoherenceScore,
    information_asymmetry_score: t.informationAsymmetryScore,
    temporal_reasoning_score: t.temporalReasoningScore,
    reasoning_auditability_score: t.reasoningAuditabilityScore,
    decision_reversibility_score: t.decisionReversibilityScore,
    reasoning_composability_score: t.reasoningComposabilityScore,
    strategic_foresight_score: t.strategicForesightScore,
    integrity_hash: t.integrityHash,
    predicted_outcome: t.predictedOutcome,
    actual_outcome: t.actualOutcome,
    outcome_resolved: t.outcomeResolved,
    actual_pnl_percent: t.actualPnlPercent ?? null,
    trade_outcome: t.tradeOutcome ?? null,
    overall_grade: t.overallGrade,
    graded_at: t.gradedAt,
    benchmark_version: "37.0",
    dimension_count: 34,
  }));

  return new Response(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Content-Disposition": "attachment; filename=molt-benchmark-v37.jsonl",
    },
  });
});

// ---------------------------------------------------------------------------
// GET /export/csv — Agent scores export (CSV)
// ---------------------------------------------------------------------------

benchmarkV37ApiRoutes.get("/export/csv", (c) => {
  const scores = getAgentScores();
  const header = "agent_id,agent_name,provider,model,composite_score,tier,trade_count,reasoning_auditability,decision_reversibility,reasoning_composability,strategic_foresight\n";
  const rows = scores.map((s) =>
    `${s.agentId},${s.agentName},${s.provider},${s.model},${s.compositeScore},${s.tier},${s.tradeCount},${s.dimensions.reasoningAuditability},${s.dimensions.decisionReversibility},${s.dimensions.reasoningComposability},${s.dimensions.strategicForesight}`,
  ).join("\n");

  return new Response(header + rows + "\n", {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": "attachment; filename=molt-benchmark-v37-agents.csv",
    },
  });
});

// ---------------------------------------------------------------------------
// GET /weight-analysis — Data-driven dimension weight optimization analysis
// ---------------------------------------------------------------------------

benchmarkV37ApiRoutes.get("/weight-analysis", (c) => {
  const scores = getAgentScores();
  const weights = getDimensionWeights();

  // Build agentPnls from the pnlPercent dimension (already normalized to 0-100 score)
  // We need to reverse the normalization: pnlScore = 50 + pnlPercent * 2
  // So pnlPercent = (pnlScore - 50) / 2
  // However, raw pnlPercent is more accurate — use the dimension score directly
  // as a proxy since all agents are scored on the same scale.
  // For best results, callers should supply actual P&L, but we use dimension
  // scores as a reasonable approximation from available data.
  const agentPnls = scores.map((s) => ({
    agentId: s.agentId,
    // Reverse the normalization: pnlPercent = (pnlScore - 50) / 2
    pnlPercent: (s.dimensions.pnlPercent - 50) / 2,
  }));

  const analysis = computeOptimalWeights(scores, agentPnls);

  if (analysis.length === 0) {
    return c.json({
      ok: true,
      benchmark: "MoltApp v37",
      version: getBenchmarkVersion(),
      agentsAnalyzed: scores.length,
      message: "Insufficient data: need at least 3 agents with P&L data for correlation analysis",
      dimensions: [],
      summary: null,
    });
  }

  // Compute summary statistics
  const positiveCorrelations = analysis.filter((d) => d.correlation > 0.1);
  const negativeCorrelations = analysis.filter((d) => d.correlation < -0.1);
  const neutralCorrelations = analysis.filter((d) => Math.abs(d.correlation) <= 0.1);

  // Identify over/under-weighted dimensions
  const overweighted = analysis.filter(
    (d) => d.currentWeight > d.suggestedWeight + 0.005,
  ).map((d) => ({
    dimension: d.dimension,
    currentWeight: d.currentWeight,
    suggestedWeight: d.suggestedWeight,
    delta: round2(d.currentWeight - d.suggestedWeight),
    correlation: d.correlation,
  }));

  const underweighted = analysis.filter(
    (d) => d.suggestedWeight > d.currentWeight + 0.005,
  ).map((d) => ({
    dimension: d.dimension,
    currentWeight: d.currentWeight,
    suggestedWeight: d.suggestedWeight,
    delta: round2(d.suggestedWeight - d.currentWeight),
    correlation: d.correlation,
  }));

  // Total weight shift needed
  const totalShift = analysis.reduce(
    (sum, d) => sum + Math.abs(d.suggestedWeight - d.currentWeight),
    0,
  );

  return c.json({
    ok: true,
    benchmark: "MoltApp v37",
    version: getBenchmarkVersion(),
    agentsAnalyzed: scores.length,
    dimensions: analysis.map((d) => ({
      dimension: d.dimension,
      currentWeight: d.currentWeight,
      suggestedWeight: d.suggestedWeight,
      correlation: d.correlation,
      weightDelta: round2(d.suggestedWeight - d.currentWeight),
      interpretation: d.correlation > 0.3
        ? "strongly predictive of profitability"
        : d.correlation > 0.1
          ? "moderately predictive of profitability"
          : d.correlation > -0.1
            ? "neutral — no clear link to profitability"
            : d.correlation > -0.3
              ? "moderately inversely correlated with profitability"
              : "strongly inversely correlated with profitability",
    })),
    summary: {
      mostPredictive: positiveCorrelations.slice(0, 5).map((d) => ({
        dimension: d.dimension,
        correlation: d.correlation,
      })),
      leastPredictive: negativeCorrelations.slice(-5).reverse().map((d) => ({
        dimension: d.dimension,
        correlation: d.correlation,
      })),
      neutralDimensions: neutralCorrelations.length,
      overweightedDimensions: overweighted,
      underweightedDimensions: underweighted,
      totalWeightShiftNeeded: round2(totalShift),
      recommendation: totalShift < 0.05
        ? "Current weights are well-aligned with profitability signals — minimal adjustment needed"
        : totalShift < 0.15
          ? "Moderate misalignment detected — consider adjusting overweighted dimensions to better reflect profitability predictors"
          : "Significant misalignment — current weights do not reflect which dimensions actually predict profitability. Review suggested weights for potential improvement.",
    },
    note: "This is an informational analysis tool. Suggested weights are NOT auto-applied. Use this data to inform manual weight tuning in DIMENSION_WEIGHTS.",
  });
});

// ---------------------------------------------------------------------------
// GET /health — Benchmark engine health check
// ---------------------------------------------------------------------------

benchmarkV37ApiRoutes.get("/health", (c) => {
  const scores = getAgentScores();
  const trades = getTradeGrades(1);

  return c.json({
    ok: true,
    benchmark: "MoltApp v37",
    version: getBenchmarkVersion(),
    dimensions: getDimensionCount(),
    newDimensions: ["reasoning_composability", "strategic_foresight"],
    agentsScored: scores.length,
    tradesGraded: trades.length > 0 ? "active" : "waiting",
    uptimeMs: Date.now() - startTime,
    website: "https://www.patgpt.us",
    dataset: "https://huggingface.co/datasets/patruff/molt-benchmark",
  });
});
