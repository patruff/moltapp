/**
 * Benchmark V30 API — Researcher-Facing Data Export & Analytics
 *
 * Industry-standard API for accessing MoltApp's 20-dimension AI
 * trading benchmark data. Designed for ML researchers, quant teams,
 * and the HuggingFace ecosystem.
 *
 * Routes:
 * - GET /leaderboard          — Current rankings with 20-dimension scores
 * - GET /trade-grades          — Individual trade quality assessments
 * - GET /trade-grades/:id      — Single trade deep analysis
 * - GET /dimensions            — Scoring methodology & weights
 * - GET /calibration           — Cross-agent fairness analysis
 * - GET /export/jsonl          — JSONL dataset export for researchers
 * - GET /export/summary        — High-level benchmark summary
 * - GET /rounds                — Round-by-round summaries
 * - GET /agent/:agentId        — Single agent deep profile
 * - GET /health                — Benchmark system health
 */

import { Hono } from "hono";
import {
  getV30Leaderboard,
  getV30TradeGrades,
  getV30DimensionWeights,
  getCrossAgentCalibration,
  exportV30Dataset,
  getV30RoundSummaries,
  type V30AgentScore,
  type V30TradeGrade,
} from "../services/v30-benchmark-engine.ts";

export const benchmarkV30ApiRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET /leaderboard — Current ranked agent scores
// ---------------------------------------------------------------------------
benchmarkV30ApiRoutes.get("/leaderboard", (c) => {
  const leaderboard = getV30Leaderboard();

  return c.json({
    ok: true,
    benchmark: "moltapp-v30",
    dimensions: 20,
    leaderboard: leaderboard.map((agent, rank) => ({
      rank: rank + 1,
      agentId: agent.agentId,
      agentName: agent.agentName,
      provider: agent.provider,
      model: agent.model,
      compositeScore: agent.compositeScore,
      tier: agent.tier,
      tradeCount: agent.tradeCount,
      roundsPlayed: agent.roundsPlayed,
      dimensions: agent.dimensions,
      lastUpdated: agent.lastUpdated,
    })),
    scoringMethodology: {
      totalDimensions: 20,
      categories: [
        { name: "Financial Performance", dims: 3, weight: 0.25 },
        { name: "Reasoning Quality", dims: 5, weight: 0.32 },
        { name: "Safety & Trust", dims: 3, weight: 0.17 },
        { name: "Behavioral Intelligence", dims: 4, weight: 0.15 },
        { name: "Predictive Power", dims: 3, weight: 0.08 },
        { name: "Governance", dims: 2, weight: 0.03 },
      ],
      tiers: { S: ">=85", A: ">=70", B: ">=55", C: ">=40", D: "<40" },
    },
  });
});

// ---------------------------------------------------------------------------
// GET /trade-grades — Individual trade quality assessments
// ---------------------------------------------------------------------------
benchmarkV30ApiRoutes.get("/trade-grades", (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 200);
  const agentId = c.req.query("agent");
  const minGrade = c.req.query("minGrade");

  let grades = getV30TradeGrades(limit, agentId || undefined);

  if (minGrade) {
    const gradeOrder = ["A+", "A", "B+", "B", "C+", "C", "D", "F"];
    const minIdx = gradeOrder.indexOf(minGrade);
    if (minIdx >= 0) {
      grades = grades.filter((g) => gradeOrder.indexOf(g.overallGrade) <= minIdx);
    }
  }

  return c.json({
    ok: true,
    trades: grades,
    total: grades.length,
    gradeDistribution: computeGradeDistribution(grades),
  });
});

// ---------------------------------------------------------------------------
// GET /trade-grades/:id — Single trade deep analysis
// ---------------------------------------------------------------------------
benchmarkV30ApiRoutes.get("/trade-grades/:id", (c) => {
  const id = c.req.param("id");
  const allGrades = getV30TradeGrades(5000);
  const grade = allGrades.find((g) => g.tradeId === id);

  if (!grade) {
    return c.json({ ok: false, error: "Trade grade not found" }, 404);
  }

  return c.json({
    ok: true,
    trade: grade,
    analysis: {
      reasoningWordCount: grade.reasoning.split(/\s+/).length,
      hasHallucinations: grade.hallucinationFlags.length > 0,
      hasPrediction: !!grade.predictedOutcome,
      verifiable: !!grade.integrityHash,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /dimensions — Scoring methodology & dimension weights
// ---------------------------------------------------------------------------
benchmarkV30ApiRoutes.get("/dimensions", (c) => {
  const weights = getV30DimensionWeights();

  const dimensionDescriptions: Record<string, { category: string; description: string; type: string }> = {
    pnlPercent: { category: "Financial Performance", description: "Return on investment percentage", type: "reward" },
    sharpeRatio: { category: "Financial Performance", description: "Risk-adjusted return ratio", type: "risk_adjustment" },
    maxDrawdown: { category: "Financial Performance", description: "Largest peak-to-trough decline", type: "risk" },
    coherence: { category: "Reasoning Quality", description: "Does reasoning logically support the action?", type: "qualitative" },
    reasoningDepth: { category: "Reasoning Quality", description: "Multi-step reasoning sophistication", type: "qualitative" },
    sourceQuality: { category: "Reasoning Quality", description: "Breadth and quality of cited data sources", type: "qualitative" },
    logicalConsistency: { category: "Reasoning Quality", description: "Internal logical consistency of arguments", type: "qualitative" },
    reasoningIntegrity: { category: "Reasoning Quality", description: "Cryptographic verification of reasoning chains", type: "integrity" },
    hallucinationRate: { category: "Safety & Trust", description: "Rate of factually incorrect claims", type: "safety" },
    instructionDiscipline: { category: "Safety & Trust", description: "Compliance with trading rules and limits", type: "reliability" },
    riskAwareness: { category: "Safety & Trust", description: "Explicit discussion of risks in reasoning", type: "qualitative" },
    strategyConsistency: { category: "Behavioral Intelligence", description: "Adherence to declared trading strategy", type: "behavioral" },
    adaptability: { category: "Behavioral Intelligence", description: "Ability to adjust strategy after losses", type: "behavioral" },
    confidenceCalibration: { category: "Behavioral Intelligence", description: "Correlation between confidence and outcomes", type: "calibration" },
    crossRoundLearning: { category: "Behavioral Intelligence", description: "Evidence of learning from past rounds", type: "behavioral" },
    outcomeAccuracy: { category: "Predictive Power", description: "Accuracy of predicted outcomes", type: "prediction" },
    marketRegimeAwareness: { category: "Predictive Power", description: "Recognition of market conditions", type: "contextual" },
    edgeConsistency: { category: "Predictive Power", description: "Consistency of positive trading edge", type: "performance" },
    tradeAccountability: { category: "Governance", description: "Acknowledgment and analysis of past mistakes", type: "governance" },
    reasoningQualityIndex: { category: "Governance", description: "Aggregate reasoning quality composite", type: "composite" },
  };

  return c.json({
    ok: true,
    version: "30.0",
    totalDimensions: 20,
    weights,
    dimensions: Object.entries(weights).map(([key, weight]) => ({
      name: key,
      weight,
      ...dimensionDescriptions[key],
    })),
    categories: [
      { name: "Financial Performance", dimensionCount: 3, totalWeight: 0.25 },
      { name: "Reasoning Quality", dimensionCount: 5, totalWeight: 0.32 },
      { name: "Safety & Trust", dimensionCount: 3, totalWeight: 0.17 },
      { name: "Behavioral Intelligence", dimensionCount: 4, totalWeight: 0.15 },
      { name: "Predictive Power", dimensionCount: 3, totalWeight: 0.08 },
      { name: "Governance", dimensionCount: 2, totalWeight: 0.03 },
    ],
  });
});

// ---------------------------------------------------------------------------
// GET /calibration — Cross-agent fairness analysis
// ---------------------------------------------------------------------------
benchmarkV30ApiRoutes.get("/calibration", (c) => {
  const calibration = getCrossAgentCalibration();

  return c.json({
    ok: true,
    calibration,
    interpretation: {
      fairnessIndex: calibration.fairnessIndex >= 0.8
        ? "FAIR: Benchmark scores are reasonably balanced across providers"
        : calibration.fairnessIndex >= 0.6
          ? "MODERATE: Some provider advantage detected, investigate dimension scores"
          : "UNFAIR: Significant scoring disparity between providers — review weights",
    },
  });
});

// ---------------------------------------------------------------------------
// GET /export/jsonl — JSONL dataset for researchers
// ---------------------------------------------------------------------------
benchmarkV30ApiRoutes.get("/export/jsonl", (c) => {
  const grades = getV30TradeGrades(1000);
  const lines = grades.map((g) => JSON.stringify({
    agent_id: g.agentId,
    symbol: g.symbol,
    action: g.action,
    reasoning: g.reasoning,
    confidence: g.confidence,
    coherence_score: g.coherenceScore,
    hallucination_flags: g.hallucinationFlags,
    discipline_passed: g.disciplinePassed,
    reasoning_depth: g.reasoningDepthScore,
    source_quality: g.sourceQualityScore,
    integrity_hash: g.integrityHash,
    predicted_outcome: g.predictedOutcome,
    grade: g.overallGrade,
    graded_at: g.gradedAt,
  }));

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Content-Disposition": 'attachment; filename="moltapp-v30-trades.jsonl"',
    },
  });
});

// ---------------------------------------------------------------------------
// GET /export/summary — High-level benchmark summary
// ---------------------------------------------------------------------------
benchmarkV30ApiRoutes.get("/export/summary", (c) => {
  const dataset = exportV30Dataset();

  return c.json({
    ok: true,
    benchmark: "MoltApp v30 — AI Trading Benchmark",
    website: "https://www.patgpt.us",
    huggingface: "https://huggingface.co/datasets/patruff/molt-benchmark",
    ...dataset,
  });
});

// ---------------------------------------------------------------------------
// GET /rounds — Round-by-round summaries
// ---------------------------------------------------------------------------
benchmarkV30ApiRoutes.get("/rounds", (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10), 100);
  const summaries = getV30RoundSummaries(limit);

  return c.json({
    ok: true,
    rounds: summaries,
    total: summaries.length,
  });
});

// ---------------------------------------------------------------------------
// GET /agent/:agentId — Single agent deep profile
// ---------------------------------------------------------------------------
benchmarkV30ApiRoutes.get("/agent/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const leaderboard = getV30Leaderboard();
  const agent = leaderboard.find((a) => a.agentId === agentId);

  if (!agent) {
    return c.json({ ok: false, error: "Agent not found in benchmark" }, 404);
  }

  const trades = getV30TradeGrades(50, agentId);
  const gradeDistribution = computeGradeDistribution(trades);

  // Find strongest and weakest dimensions
  const dimEntries = Object.entries(agent.dimensions) as [string, number][];
  const sorted = [...dimEntries].sort((a, b) => b[1] - a[1]);

  return c.json({
    ok: true,
    agent: {
      ...agent,
      rank: leaderboard.indexOf(agent) + 1,
    },
    recentTrades: trades.slice(0, 10),
    gradeDistribution,
    analysis: {
      strongestDimensions: sorted.slice(0, 3).map(([name, score]) => ({ name, score })),
      weakestDimensions: sorted.slice(-3).map(([name, score]) => ({ name, score })),
      averageTradeGrade: trades.length > 0
        ? getAverageGrade(trades)
        : "N/A",
    },
  });
});

// ---------------------------------------------------------------------------
// GET /health — Benchmark system health check
// ---------------------------------------------------------------------------
benchmarkV30ApiRoutes.get("/health", (c) => {
  const leaderboard = getV30Leaderboard();
  const grades = getV30TradeGrades(1);

  return c.json({
    ok: true,
    version: "30.0",
    dimensions: 20,
    status: leaderboard.length > 0 ? "active" : "awaiting_data",
    agentsTracked: leaderboard.length,
    totalTradesGraded: getV30TradeGrades(5000).length,
    lastUpdate: leaderboard[0]?.lastUpdated ?? null,
    uptime: process.uptime(),
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeGradeDistribution(grades: V30TradeGrade[]): Record<string, number> {
  const dist: Record<string, number> = { "A+": 0, A: 0, "B+": 0, B: 0, "C+": 0, C: 0, D: 0, F: 0 };
  for (const g of grades) {
    dist[g.overallGrade] = (dist[g.overallGrade] || 0) + 1;
  }
  return dist;
}

function getAverageGrade(trades: V30TradeGrade[]): string {
  const gradeValues: Record<string, number> = { "A+": 4.3, A: 4.0, "B+": 3.3, B: 3.0, "C+": 2.3, C: 2.0, D: 1.0, F: 0 };
  const avg = trades.reduce((s, t) => s + (gradeValues[t.overallGrade] ?? 0), 0) / trades.length;
  if (avg >= 4.15) return "A+";
  if (avg >= 3.65) return "A";
  if (avg >= 3.15) return "B+";
  if (avg >= 2.65) return "B";
  if (avg >= 2.15) return "C+";
  if (avg >= 1.5) return "C";
  if (avg >= 0.5) return "D";
  return "F";
}
