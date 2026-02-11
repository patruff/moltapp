/**
 * Benchmark v16 API Routes
 *
 * Researcher-facing API for the 14-pillar benchmark with metacognition
 * and reasoning efficiency scoring.
 *
 * Routes:
 * - GET /scores              — All agent composite scores + pillar breakdowns
 * - GET /score/:agentId      — Single agent detailed score
 * - GET /metacognition       — All metacognition reports
 * - GET /metacognition/:agentId — Single agent metacognition deep-dive
 * - GET /depth/:agentId      — Reasoning depth analysis for recent trades
 * - GET /efficiency          — Reasoning efficiency comparison across agents
 * - GET /compare             — Head-to-head comparison of two agents
 * - GET /weights             — Current pillar weights
 * - GET /schema              — Full v16 benchmark schema
 * - GET /export/jsonl        — JSONL export for ML researchers
 * - GET /export/csv          — CSV export
 */

import { Hono } from "hono";
import { round2, countByCondition } from "../lib/math-utils.ts";
import {
  getAllV16Scores,
  getV16Score,
  computeV16Score,
  getV16Weights,
  analyzeTradeEfficiency,
} from "../services/benchmark-intelligence-engine.ts";
import {
  generateMetacognitionReport,
  getAllMetacognitionReports,
  compareMetacognition,
} from "../services/metacognition-tracker.ts";
import {
  scoreReasoningDepth,
  compareDepth,
} from "../services/reasoning-depth-scorer.ts";

export const benchmarkV16ApiRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET /scores — All agent scores
// ---------------------------------------------------------------------------

benchmarkV16ApiRoutes.get("/scores", (c) => {
  const scores = getAllV16Scores();

  return c.json({
    ok: true,
    version: "v16",
    pillarCount: 14,
    agentCount: scores.length,
    leaderboard: scores,
    weights: getV16Weights(),
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// GET /score/:agentId — Single agent score
// ---------------------------------------------------------------------------

benchmarkV16ApiRoutes.get("/score/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const score = getV16Score(agentId);

  if (!score) {
    // Try computing fresh
    const computed = computeV16Score(agentId);
    if (computed.tradeCount === 0) {
      return c.json({ ok: false, error: `No scoring data for agent: ${agentId}` }, 404);
    }
    return c.json({ ok: true, score: computed });
  }

  return c.json({ ok: true, score });
});

// ---------------------------------------------------------------------------
// GET /metacognition — All metacognition reports
// ---------------------------------------------------------------------------

benchmarkV16ApiRoutes.get("/metacognition", (c) => {
  const reports = getAllMetacognitionReports();

  return c.json({
    ok: true,
    version: "v16",
    pillar: "metacognition",
    description: "Does the agent know what it knows? Measures self-awareness of uncertainty, calibration of confidence, and ability to learn from mistakes.",
    reports,
    dimensions: [
      { name: "epistemicHumility", weight: 0.25, description: "Appropriate expression of uncertainty" },
      { name: "calibrationAwareness", weight: 0.25, description: "High confidence predicts good outcomes" },
      { name: "errorRecognition", weight: 0.20, description: "Agent learns from mistakes" },
      { name: "scopeLimitation", weight: 0.15, description: "Agent stays within competence" },
      { name: "adaptiveStrategy", weight: 0.15, description: "Agent changes approach when failing" },
    ],
  });
});

// ---------------------------------------------------------------------------
// GET /metacognition/:agentId — Single agent metacognition
// ---------------------------------------------------------------------------

benchmarkV16ApiRoutes.get("/metacognition/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const report = generateMetacognitionReport(agentId);

  if (!report) {
    return c.json({ ok: false, error: `No metacognition data for agent: ${agentId}` }, 404);
  }

  return c.json({ ok: true, report });
});

// ---------------------------------------------------------------------------
// GET /depth/:agentId — Reasoning depth analysis
// ---------------------------------------------------------------------------

benchmarkV16ApiRoutes.get("/depth/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const reasoning = c.req.query("reasoning");

  // If reasoning text provided, analyze it directly
  if (reasoning) {
    const depth = scoreReasoningDepth(reasoning);
    return c.json({ ok: true, agentId, depth });
  }

  // Otherwise return empty (would need reasoning text from DB)
  return c.json({
    ok: true,
    agentId,
    note: "Provide ?reasoning=<text> to analyze a specific reasoning text, or use the /benchmark-v16/data endpoint for aggregated depth data.",
    dimensions: [
      "analyticalBreadth", "evidenceSpecificity", "causalChain",
      "riskAwareness", "temporalReasoning", "comparativeAnalysis",
      "quantitativeRigor", "thesisStructure",
    ],
  });
});

// ---------------------------------------------------------------------------
// GET /depth/analyze — Analyze arbitrary reasoning text
// ---------------------------------------------------------------------------

benchmarkV16ApiRoutes.post("/depth/analyze", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.reasoning) {
    return c.json({ ok: false, error: "Must provide reasoning text in body" }, 400);
  }

  const depth = scoreReasoningDepth(body.reasoning);
  const efficiency = analyzeTradeEfficiency(body.reasoning);

  return c.json({
    ok: true,
    depth,
    efficiency,
  });
});

// ---------------------------------------------------------------------------
// GET /depth/compare — Compare depth between two reasoning texts
// ---------------------------------------------------------------------------

benchmarkV16ApiRoutes.post("/depth/compare", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.reasoningA || !body?.reasoningB) {
    return c.json({ ok: false, error: "Must provide reasoningA and reasoningB in body" }, 400);
  }

  const comparison = compareDepth(body.reasoningA, body.reasoningB);

  return c.json({ ok: true, comparison });
});

// ---------------------------------------------------------------------------
// GET /efficiency — Reasoning efficiency comparison
// ---------------------------------------------------------------------------

benchmarkV16ApiRoutes.get("/efficiency", (c) => {
  const scores = getAllV16Scores();

  const efficiency = scores.map((s) => ({
    agentId: s.agentId,
    efficiency: s.efficiency,
    composite: s.composite,
    grade: s.grade,
  }));

  efficiency.sort((a, b) => b.efficiency.composite - a.efficiency.composite);

  return c.json({
    ok: true,
    version: "v16",
    pillar: "efficiency",
    description: "Signal-to-noise ratio in reasoning text. Measures analytical content per word, penalizes filler and repetition.",
    agents: efficiency,
    dimensions: [
      { name: "informationDensity", weight: 0.30, description: "Analytical pattern matches per word" },
      { name: "claimDensity", weight: 0.25, description: "Analytical claims vs filler content" },
      { name: "originalityPerWord", weight: 0.25, description: "Unique bigrams / total bigrams" },
      { name: "quantitativeRatio", weight: 0.20, description: "Numerical claims per sentence" },
    ],
  });
});

// ---------------------------------------------------------------------------
// GET /compare — Head-to-head comparison
// ---------------------------------------------------------------------------

benchmarkV16ApiRoutes.get("/compare", (c) => {
  const agentA = c.req.query("a");
  const agentB = c.req.query("b");

  if (!agentA || !agentB) {
    return c.json({ ok: false, error: "Must provide ?a=<agentId>&b=<agentId>" }, 400);
  }

  const scoreA = getV16Score(agentA);
  const scoreB = getV16Score(agentB);
  const metaComparison = compareMetacognition(agentA, agentB);

  if (!scoreA || !scoreB) {
    return c.json({ ok: false, error: "One or both agents have no scoring data" }, 404);
  }

  // Pillar-by-pillar comparison
  const pillarComparison = scoreA.pillars.map((pA) => {
    const pB = scoreB.pillars.find((p) => p.name === pA.name);
    return {
      pillar: pA.name,
      scoreA: pA.score,
      scoreB: pB?.score ?? 0,
      winner: pA.score > (pB?.score ?? 0) + 0.02 ? agentA : (pB?.score ?? 0) > pA.score + 0.02 ? agentB : "tie",
      margin: Math.abs(pA.score - (pB?.score ?? 0)),
    };
  });

  const overallWinner = scoreA.composite > scoreB.composite + 0.01 ? agentA
    : scoreB.composite > scoreA.composite + 0.01 ? agentB
    : "tie";

  return c.json({
    ok: true,
    comparison: {
      agentA: { id: agentA, composite: scoreA.composite, grade: scoreA.grade },
      agentB: { id: agentB, composite: scoreB.composite, grade: scoreB.grade },
      overallWinner,
      compositeMargin: Math.abs(scoreA.composite - scoreB.composite),
      pillarComparison,
      metacognition: metaComparison,
      pillarsWonByA: countByCondition(pillarComparison, (p) => p.winner === agentA),
      pillarsWonByB: countByCondition(pillarComparison, (p) => p.winner === agentB),
      ties: countByCondition(pillarComparison, (p) => p.winner === "tie"),
    },
  });
});

// ---------------------------------------------------------------------------
// GET /weights — Current pillar weights
// ---------------------------------------------------------------------------

benchmarkV16ApiRoutes.get("/weights", (c) => {
  const weights = getV16Weights();
  const totalWeight = Object.values(weights).reduce((s, w) => s + w, 0);

  return c.json({
    ok: true,
    version: "v16",
    pillarCount: Object.keys(weights).length,
    weights,
    totalWeight: round2(totalWeight),
    newPillars: ["metacognition", "efficiency"],
    gradeScale: {
      "A+": ">= 0.95", "A": ">= 0.90", "A-": ">= 0.85",
      "B+": ">= 0.80", "B": ">= 0.75", "B-": ">= 0.70",
      "C+": ">= 0.65", "C": ">= 0.60", "C-": ">= 0.55",
      "D+": ">= 0.50", "D": ">= 0.45", "D-": ">= 0.40",
      "F": "< 0.40",
    },
  });
});

// ---------------------------------------------------------------------------
// GET /schema — Full v16 benchmark schema
// ---------------------------------------------------------------------------

benchmarkV16ApiRoutes.get("/schema", (c) => {
  return c.json({
    ok: true,
    version: "v16",
    name: "MoltApp AI Trading Benchmark v16",
    description: "14-pillar scoring with metacognition analysis and reasoning efficiency measurement",
    website: "https://www.patgpt.us",
    huggingface: "https://huggingface.co/datasets/patruff/molt-benchmark",
    pillars: [
      { name: "financial", weight: 0.12, description: "P&L, Sharpe Ratio, Win Rate, Max Drawdown" },
      { name: "reasoning", weight: 0.11, description: "Coherence, Depth, Consistency" },
      { name: "safety", weight: 0.09, description: "Hallucination-Free Rate, Discipline Compliance" },
      { name: "calibration", weight: 0.08, description: "ECE, Brier Score, Monotonic Quartiles" },
      { name: "patterns", weight: 0.05, description: "Fallacy Detection, Vocabulary Sophistication" },
      { name: "adaptability", weight: 0.05, description: "Cross-Regime Consistency" },
      { name: "forensicQuality", weight: 0.08, description: "Structure, Originality, Clarity, Integrity" },
      { name: "validationQuality", weight: 0.08, description: "Depth, Sources, Grounding, Risk Awareness" },
      { name: "predictionAccuracy", weight: 0.06, description: "Direction Accuracy, Target Precision" },
      { name: "reasoningStability", weight: 0.05, description: "Sentiment Volatility, Confidence Volatility" },
      { name: "provenanceIntegrity", weight: 0.06, description: "Pre-Commit Seal, Chain Integrity" },
      { name: "modelComparison", weight: 0.05, description: "Vocabulary Uniqueness, Reasoning Independence" },
      { name: "metacognition", weight: 0.07, description: "Self-Awareness: Epistemic Humility, Calibration Awareness, Error Recognition, Scope Limitation, Adaptive Strategy", new: true },
      { name: "efficiency", weight: 0.05, description: "Signal-to-Noise: Information Density, Claim Density, Originality Per Word, Quantitative Ratio", new: true },
    ],
    metacognition: {
      description: "Does the agent know what it knows?",
      dimensions: [
        { name: "epistemicHumility", weight: 0.25, markers: ["hedge words", "uncertainty expressions", "conditional statements"] },
        { name: "calibrationAwareness", weight: 0.25, markers: ["high confidence + correct", "low confidence + incorrect"] },
        { name: "errorRecognition", weight: 0.20, markers: ["action change after error", "confidence adjustment", "no repeat mistakes"] },
        { name: "scopeLimitation", weight: 0.15, markers: ["limitation acknowledgements", "symbol diversity"] },
        { name: "adaptiveStrategy", weight: 0.15, markers: ["intent change after loss", "confidence adaptation", "strategy diversity"] },
      ],
    },
    efficiency: {
      description: "Signal-to-noise ratio in reasoning",
      dimensions: [
        { name: "informationDensity", weight: 0.30, description: "Analytical patterns per word" },
        { name: "claimDensity", weight: 0.25, description: "Content vs filler ratio" },
        { name: "originalityPerWord", weight: 0.25, description: "Unique bigrams ratio" },
        { name: "quantitativeRatio", weight: 0.20, description: "Numbers per sentence" },
      ],
    },
    depthScoring: {
      description: "8-dimension reasoning depth analysis",
      dimensions: [
        { name: "analyticalBreadth", weight: 0.18 },
        { name: "evidenceSpecificity", weight: 0.16 },
        { name: "causalChain", weight: 0.14 },
        { name: "riskAwareness", weight: 0.12 },
        { name: "temporalReasoning", weight: 0.10 },
        { name: "comparativeAnalysis", weight: 0.10 },
        { name: "quantitativeRigor", weight: 0.12 },
        { name: "thesisStructure", weight: 0.08 },
      ],
    },
    endpoints: {
      dashboard: "/benchmark-v16",
      data: "/benchmark-v16/data",
      stream: "/benchmark-v16/stream",
      export: "/benchmark-v16/export",
      scores: "/api/v1/benchmark-v16/scores",
      agentScore: "/api/v1/benchmark-v16/score/:agentId",
      metacognition: "/api/v1/benchmark-v16/metacognition",
      agentMetacognition: "/api/v1/benchmark-v16/metacognition/:agentId",
      depth: "/api/v1/benchmark-v16/depth/:agentId",
      depthAnalyze: "/api/v1/benchmark-v16/depth/analyze",
      depthCompare: "/api/v1/benchmark-v16/depth/compare",
      efficiency: "/api/v1/benchmark-v16/efficiency",
      compare: "/api/v1/benchmark-v16/compare",
      weights: "/api/v1/benchmark-v16/weights",
      schema: "/api/v1/benchmark-v16/schema",
    },
  });
});

// ---------------------------------------------------------------------------
// GET /export/jsonl — JSONL export
// ---------------------------------------------------------------------------

benchmarkV16ApiRoutes.get("/export/jsonl", (c) => {
  const scores = getAllV16Scores();
  const meta = getAllMetacognitionReports();

  const records = scores.map((s) => ({
    agent_id: s.agentId,
    composite: s.composite,
    grade: s.grade,
    rank: s.rank,
    trade_count: s.tradeCount,
    pillars: Object.fromEntries(s.pillars.map((p) => [p.name, p.score])),
    metacognition: s.metacognition,
    efficiency: s.efficiency,
    metacognition_report: meta.find((m) => m.agentId === s.agentId) ?? null,
    version: "v16",
    timestamp: s.lastUpdated,
  }));

  const jsonl = records.map((r) => JSON.stringify(r)).join("\n");

  return new Response(jsonl, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Content-Disposition": "attachment; filename=moltapp-v16-scores.jsonl",
    },
  });
});

// ---------------------------------------------------------------------------
// GET /export/csv — CSV export
// ---------------------------------------------------------------------------

benchmarkV16ApiRoutes.get("/export/csv", (c) => {
  const scores = getAllV16Scores();
  const weights = getV16Weights();

  const pillarNames = Object.keys(weights);
  const headers = ["agent_id", "composite", "grade", "rank", "trade_count", ...pillarNames, "metacognition_composite", "efficiency_composite"];

  const rows = scores.map((s) => {
    const pillarScores = pillarNames.map((name) => {
      const p = s.pillars.find((pi) => pi.name === name);
      return (p?.score ?? 0).toFixed(4);
    });
    return [
      s.agentId,
      s.composite.toFixed(4),
      s.grade,
      s.rank,
      s.tradeCount,
      ...pillarScores,
      s.metacognition.composite.toFixed(4),
      s.efficiency.composite.toFixed(4),
    ].join(",");
  });

  const csv = [headers.join(","), ...rows].join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": "attachment; filename=moltapp-v16-scores.csv",
    },
  });
});
