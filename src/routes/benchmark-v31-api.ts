/**
 * Benchmark V31 API — Researcher-Facing Data Export & Analytics
 *
 * Industry-standard API for accessing MoltApp's 22-dimension AI
 * trading benchmark data. Designed for ML researchers, quant teams,
 * and the HuggingFace ecosystem.
 *
 * Routes:
 * - GET /leaderboard          — Current rankings with 22-dimension scores
 * - GET /trade-grades          — Individual trade quality assessments
 * - GET /trade-grades/:id      — Single trade deep analysis
 * - GET /dimensions            — Scoring methodology & weights
 * - GET /calibration           — Cross-agent fairness analysis
 * - GET /export/jsonl          — JSONL dataset export for researchers
 * - GET /export/csv            — CSV export for spreadsheet analysis
 * - GET /export/summary        — High-level benchmark summary
 * - GET /rounds                — Round-by-round summaries
 * - GET /agent/:agentId        — Single agent deep profile
 * - GET /transparency          — Reasoning transparency analysis
 * - GET /accountability        — Decision accountability tracking
 * - GET /health                — Benchmark system health
 */

import { Hono } from "hono";
import { countByCondition, findMax, findMin } from "../lib/math-utils.ts";
import {
  getV31Leaderboard,
  getV31TradeGrades,
  getV31DimensionWeights,
  getCrossAgentCalibration,
  exportV31Dataset,
  getV31RoundSummaries,
  type V31AgentScore,
  type V31TradeGrade,
} from "../services/v31-benchmark-engine.ts";

export const benchmarkV31ApiRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET /leaderboard
// ---------------------------------------------------------------------------
benchmarkV31ApiRoutes.get("/leaderboard", (c) => {
  const leaderboard = getV31Leaderboard();

  return c.json({
    ok: true,
    benchmark: "moltapp-v31",
    dimensions: 22,
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
      totalDimensions: 22,
      categories: [
        { name: "Financial Performance", dimensions: 3, weight: 0.22 },
        { name: "Reasoning Quality", dimensions: 6, weight: 0.35 },
        { name: "Safety & Trust", dimensions: 3, weight: 0.15 },
        { name: "Behavioral Intelligence", dimensions: 4, weight: 0.13 },
        { name: "Predictive Power", dimensions: 3, weight: 0.08 },
        { name: "Governance & Accountability", dimensions: 3, weight: 0.07 },
      ],
    },
  });
});

// ---------------------------------------------------------------------------
// GET /trade-grades
// ---------------------------------------------------------------------------
benchmarkV31ApiRoutes.get("/trade-grades", (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 200);
  const agentFilter = c.req.query("agent");
  const minGrade = c.req.query("minGrade");

  let grades = getV31TradeGrades(limit * 2);

  if (agentFilter) {
    grades = grades.filter((g) => g.agentId === agentFilter);
  }
  if (minGrade) {
    const gradeOrder = ["A+", "A", "B+", "B", "C+", "C", "D", "F"];
    const minIdx = gradeOrder.indexOf(minGrade);
    if (minIdx >= 0) {
      grades = grades.filter((g) => gradeOrder.indexOf(g.overallGrade) <= minIdx);
    }
  }

  return c.json({
    ok: true,
    benchmark: "moltapp-v31",
    tradeGrades: grades.slice(0, limit),
    total: grades.length,
    fields: [
      "tradeId", "agentId", "symbol", "action", "confidence",
      "coherenceScore", "transparencyScore", "accountabilityScore",
      "overallGrade", "predictedOutcome", "outcomeResolved",
    ],
  });
});

// ---------------------------------------------------------------------------
// GET /trade-grades/:id
// ---------------------------------------------------------------------------
benchmarkV31ApiRoutes.get("/trade-grades/:id", (c) => {
  const id = c.req.param("id");
  const grades = getV31TradeGrades(2000);
  const grade = grades.find((g) => g.tradeId === id);

  if (!grade) {
    return c.json({ ok: false, error: "Trade grade not found" }, 404);
  }

  return c.json({ ok: true, tradeGrade: grade });
});

// ---------------------------------------------------------------------------
// GET /dimensions
// ---------------------------------------------------------------------------
benchmarkV31ApiRoutes.get("/dimensions", (c) => {
  const weights = getV31DimensionWeights();

  return c.json({
    ok: true,
    benchmark: "moltapp-v31",
    totalDimensions: 22,
    dimensions: Object.entries(weights).map(([name, weight]) => ({
      name,
      weight,
      category: getDimensionCategory(name),
      description: getDimensionDescription(name),
    })),
    newInV31: [
      {
        name: "reasoningTransparency",
        description: "How well does the agent explain its reasoning? Measures step-by-step structure, data citations, uncertainty acknowledgment, causal chains, and quantitative backing.",
        weight: weights.reasoningTransparency,
      },
      {
        name: "decisionAccountability",
        description: "Does the agent track its own predictions and acknowledge past errors? Measures prediction specificity, self-reference, error acknowledgment, and follow-through.",
        weight: weights.decisionAccountability,
      },
    ],
  });
});

// ---------------------------------------------------------------------------
// GET /calibration
// ---------------------------------------------------------------------------
benchmarkV31ApiRoutes.get("/calibration", (c) => {
  const calibration = getCrossAgentCalibration();

  return c.json({
    ok: true,
    benchmark: "moltapp-v31",
    calibration,
    interpretation: {
      fairnessIndex: "1.0 = perfectly fair, 0.0 = highly biased",
      providerBias: "Positive = above average, negative = below average",
    },
  });
});

// ---------------------------------------------------------------------------
// GET /export/jsonl
// ---------------------------------------------------------------------------
benchmarkV31ApiRoutes.get("/export/jsonl", (c) => {
  const dataset = exportV31Dataset();
  const jsonl = dataset.map((r) => JSON.stringify(r)).join("\n") + "\n";

  c.header("Content-Type", "application/jsonl");
  c.header("Content-Disposition", "attachment; filename=moltapp-v31-benchmark.jsonl");
  return c.body(jsonl);
});

// ---------------------------------------------------------------------------
// GET /export/csv
// ---------------------------------------------------------------------------
benchmarkV31ApiRoutes.get("/export/csv", (c) => {
  const dataset = exportV31Dataset();
  if (dataset.length === 0) {
    return c.text("No data", 200);
  }

  const headers = Object.keys(dataset[0]);
  const csvRows = [
    headers.join(","),
    ...dataset.map((row) =>
      headers.map((h) => {
        const val = row[h];
        if (val === null || val === undefined) return "";
        if (typeof val === "string") return `"${val.replace(/"/g, '""')}"`;
        if (Array.isArray(val)) return `"${JSON.stringify(val).replace(/"/g, '""')}"`;
        return String(val);
      }).join(","),
    ),
  ];

  c.header("Content-Type", "text/csv");
  c.header("Content-Disposition", "attachment; filename=moltapp-v31-benchmark.csv");
  return c.body(csvRows.join("\n"));
});

// ---------------------------------------------------------------------------
// GET /export/summary
// ---------------------------------------------------------------------------
benchmarkV31ApiRoutes.get("/export/summary", (c) => {
  const leaderboard = getV31Leaderboard();
  const grades = getV31TradeGrades(9999);
  const calibration = getCrossAgentCalibration();

  const gradeDistribution: Record<string, number> = {};
  for (const g of grades) {
    gradeDistribution[g.overallGrade] = (gradeDistribution[g.overallGrade] ?? 0) + 1;
  }

  return c.json({
    ok: true,
    benchmark: "moltapp-v31",
    summary: {
      version: "31.0",
      dimensions: 22,
      totalAgents: leaderboard.length,
      totalGradedTrades: grades.length,
      gradeDistribution,
      tierDistribution: {
        S: countByCondition(leaderboard, (a) => a.tier === "S"),
        A: countByCondition(leaderboard, (a) => a.tier === "A"),
        B: countByCondition(leaderboard, (a) => a.tier === "B"),
        C: countByCondition(leaderboard, (a) => a.tier === "C"),
        D: countByCondition(leaderboard, (a) => a.tier === "D"),
      },
      avgComposite: leaderboard.length > 0
        ? Math.round(leaderboard.reduce((s, a) => s + a.compositeScore, 0) / leaderboard.length * 100) / 100
        : 0,
      avgTransparency: grades.length > 0
        ? Math.round(grades.reduce((s, g) => s + g.transparencyScore, 0) / grades.length * 100) / 100
        : 0,
      avgAccountability: grades.length > 0
        ? Math.round(grades.reduce((s, g) => s + g.accountabilityScore, 0) / grades.length * 100) / 100
        : 0,
      fairnessIndex: calibration.fairnessIndex,
      website: "https://www.patgpt.us",
      huggingface: "https://huggingface.co/datasets/patruff/molt-benchmark",
    },
  });
});

// ---------------------------------------------------------------------------
// GET /rounds
// ---------------------------------------------------------------------------
benchmarkV31ApiRoutes.get("/rounds", (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "10", 10), 50);
  const rounds = getV31RoundSummaries(limit);

  return c.json({
    ok: true,
    benchmark: "moltapp-v31",
    rounds: rounds.map((r) => ({
      roundId: r.roundId,
      timestamp: r.timestamp,
      agentCount: r.agentScores.length,
      consensusAgreement: r.consensusAgreement,
      marketRegime: r.marketRegime,
      avgTransparency: r.avgTransparency,
      avgAccountability: r.avgAccountability,
      bestTradeGrade: r.bestTrade?.overallGrade ?? null,
      worstTradeGrade: r.worstTrade?.overallGrade ?? null,
    })),
  });
});

// ---------------------------------------------------------------------------
// GET /agent/:agentId
// ---------------------------------------------------------------------------
benchmarkV31ApiRoutes.get("/agent/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const leaderboard = getV31Leaderboard();
  const agent = leaderboard.find((a) => a.agentId === agentId);

  if (!agent) {
    return c.json({ ok: false, error: "Agent not found in benchmark" }, 404);
  }

  const agentGrades = getV31TradeGrades(200).filter((g) => g.agentId === agentId);

  return c.json({
    ok: true,
    benchmark: "moltapp-v31",
    agent: {
      ...agent,
      rank: leaderboard.indexOf(agent) + 1,
    },
    recentTrades: agentGrades.slice(0, 20),
    transparencyProfile: {
      avgScore: agentGrades.length > 0
        ? Math.round(agentGrades.reduce((s, g) => s + g.transparencyScore, 0) / agentGrades.length)
        : 0,
      trend: agentGrades.length >= 5
        ? (agentGrades.slice(0, 3).reduce((s, g) => s + g.transparencyScore, 0) / 3 >
           agentGrades.slice(-3).reduce((s, g) => s + g.transparencyScore, 0) / 3 ? "improving" : "declining")
        : "insufficient_data",
    },
    accountabilityProfile: {
      avgScore: agentGrades.length > 0
        ? Math.round(agentGrades.reduce((s, g) => s + g.accountabilityScore, 0) / agentGrades.length)
        : 0,
      predictionsTracked: countByCondition(agentGrades, (g) => g.predictedOutcome !== null),
      outcomesResolved: countByCondition(agentGrades, (g) => g.outcomeResolved !== "pending"),
    },
  });
});

// ---------------------------------------------------------------------------
// GET /transparency
// ---------------------------------------------------------------------------
benchmarkV31ApiRoutes.get("/transparency", (c) => {
  const leaderboard = getV31Leaderboard();
  const grades = getV31TradeGrades(500);

  const byAgent = new Map<string, number[]>();
  for (const g of grades) {
    const arr = byAgent.get(g.agentId) ?? [];
    arr.push(g.transparencyScore);
    byAgent.set(g.agentId, arr);
  }

  const agentTransparency = Array.from(byAgent.entries()).map(([agentId, scores]) => {
    const scoreObjects = scores.map((score) => ({ score }));
    return {
      agentId,
      avgTransparency: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
      tradeCount: scores.length,
      bestScore: findMax(scoreObjects, 'score')?.score ?? 0,
      worstScore: findMin(scoreObjects, 'score')?.score ?? 0,
    };
  }).sort((a, b) => b.avgTransparency - a.avgTransparency);

  return c.json({
    ok: true,
    benchmark: "moltapp-v31",
    transparency: {
      overallAvg: grades.length > 0
        ? Math.round(grades.reduce((s, g) => s + g.transparencyScore, 0) / grades.length)
        : 0,
      byAgent: agentTransparency,
      methodology: {
        stepStructure: "Step-by-step reasoning patterns (0-25 pts)",
        dataCitations: "Data source citations in reasoning (0-20 pts)",
        uncertaintyAck: "Acknowledgment of uncertainty and risks (0-15 pts)",
        causalChains: "Causal reasoning connections (0-20 pts)",
        quantBacking: "Quantitative data in reasoning (0-20 pts)",
      },
    },
  });
});

// ---------------------------------------------------------------------------
// GET /accountability
// ---------------------------------------------------------------------------
benchmarkV31ApiRoutes.get("/accountability", (c) => {
  const grades = getV31TradeGrades(500);

  const byAgent = new Map<string, { scores: number[]; predictions: number; resolved: number }>();
  for (const g of grades) {
    const entry = byAgent.get(g.agentId) ?? { scores: [], predictions: 0, resolved: 0 };
    entry.scores.push(g.accountabilityScore);
    if (g.predictedOutcome) entry.predictions++;
    if (g.outcomeResolved !== "pending") entry.resolved++;
    byAgent.set(g.agentId, entry);
  }

  const agentAccountability = Array.from(byAgent.entries()).map(([agentId, data]) => ({
    agentId,
    avgAccountability: Math.round(data.scores.reduce((a, b) => a + b, 0) / data.scores.length),
    predictionsTracked: data.predictions,
    outcomesResolved: data.resolved,
    predictionRate: data.scores.length > 0
      ? Math.round((data.predictions / data.scores.length) * 100)
      : 0,
  })).sort((a, b) => b.avgAccountability - a.avgAccountability);

  return c.json({
    ok: true,
    benchmark: "moltapp-v31",
    accountability: {
      overallAvg: grades.length > 0
        ? Math.round(grades.reduce((s, g) => s + g.accountabilityScore, 0) / grades.length)
        : 0,
      byAgent: agentAccountability,
      methodology: {
        predictionSpecificity: "How specific are the agent's predictions (0-30 pts)",
        pastPerformanceRef: "Does the agent reference its own track record (0-25 pts)",
        errorAcknowledgment: "Does the agent acknowledge past mistakes (0-25 pts)",
        trackRecord: "Prediction accuracy based on resolved outcomes (0-20 pts)",
      },
    },
  });
});

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------
benchmarkV31ApiRoutes.get("/health", (c) => {
  const leaderboard = getV31Leaderboard();
  const grades = getV31TradeGrades(1);

  return c.json({
    ok: true,
    benchmark: "moltapp-v31",
    health: {
      status: "operational",
      dimensions: 22,
      agentsTracked: leaderboard.length,
      totalGradedTrades: getV31TradeGrades(9999).length,
      lastTradeGraded: grades[0]?.gradedAt ?? null,
      newDimensions: ["reasoningTransparency", "decisionAccountability"],
      uptime: process.uptime(),
    },
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDimensionCategory(dim: string): string {
  if (["pnlPercent", "sharpeRatio", "maxDrawdown"].includes(dim)) return "Financial Performance";
  if (["coherence", "reasoningDepth", "sourceQuality", "logicalConsistency", "reasoningIntegrity", "reasoningTransparency"].includes(dim)) return "Reasoning Quality";
  if (["hallucinationRate", "instructionDiscipline", "riskAwareness"].includes(dim)) return "Safety & Trust";
  if (["strategyConsistency", "adaptability", "confidenceCalibration", "crossRoundLearning"].includes(dim)) return "Behavioral Intelligence";
  if (["outcomeAccuracy", "marketRegimeAwareness", "edgeConsistency"].includes(dim)) return "Predictive Power";
  return "Governance & Accountability";
}

function getDimensionDescription(dim: string): string {
  const descriptions: Record<string, string> = {
    pnlPercent: "Return on investment since round start",
    sharpeRatio: "Risk-adjusted return (excess return per unit of risk)",
    maxDrawdown: "Largest peak-to-trough portfolio decline",
    coherence: "Does the agent's reasoning logically support its action?",
    reasoningDepth: "How detailed and thorough is the reasoning?",
    sourceQuality: "Quality and quantity of data sources cited",
    logicalConsistency: "Internal consistency of the reasoning chain",
    reasoningIntegrity: "Cryptographic verification of reasoning provenance",
    reasoningTransparency: "How well does the agent explain its decision-making process?",
    hallucinationRate: "Rate of factually incorrect claims in reasoning (inverted: higher = fewer hallucinations)",
    instructionDiscipline: "Compliance with trading rules and position limits",
    riskAwareness: "References to risk, hedging, and downside protection",
    strategyConsistency: "Consistency of trading strategy over time",
    adaptability: "Ability to adjust strategy based on market conditions",
    confidenceCalibration: "Correlation between stated confidence and actual outcomes",
    crossRoundLearning: "Evidence of learning from previous trading rounds",
    outcomeAccuracy: "Accuracy of predicted outcomes vs actual results",
    marketRegimeAwareness: "Ability to identify and adapt to market regimes",
    edgeConsistency: "Consistency of generating high-quality trade grades",
    tradeAccountability: "Taking responsibility for trade outcomes",
    reasoningQualityIndex: "Composite reasoning quality metric",
    decisionAccountability: "Tracking predictions, acknowledging errors, self-improving",
  };
  return descriptions[dim] ?? dim;
}
