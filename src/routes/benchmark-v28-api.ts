/**
 * Benchmark v28 API Routes
 *
 * Researcher-facing API for the 16-dimension AI trading benchmark.
 * v28 adds Trade Accountability and Reasoning Quality Index analysis.
 *
 * Routes:
 * GET  /                              — v28 benchmark overview
 * GET  /leaderboard                   — 16-dimension leaderboard with composite scores
 * GET  /leaderboard/:agentId          — Specific agent's v28 scores
 * GET  /accountability/:agentId       — Agent's trade accountability history
 * GET  /rqi/:agentId                  — Agent's reasoning quality index history
 * GET  /dimensions                    — Full dimension breakdown with categories
 * GET  /export                        — JSONL export for researchers
 * GET  /compare/:agentA/:agentB       — Head-to-head agent comparison
 * GET  /methodology                   — Scoring methodology documentation
 */

import { Hono } from "hono";
import {
  getAccountabilityHistory,
  getRqiHistory,
  getV28Leaderboard,
  computeV28Composite,
  type V28CompositeScore,
} from "../services/v28-benchmark-engine.ts";
import { V28_DIMENSIONS } from "../schemas/benchmark-v28.ts";
import { groupByKey, sumByKey } from "../lib/math-utils.ts";

export const benchmarkV28ApiRoutes = new Hono();

const TOTAL_WEIGHT = sumByKey(V28_DIMENSIONS, 'weight');

// ---------------------------------------------------------------------------
// GET / — v28 benchmark overview
// ---------------------------------------------------------------------------

benchmarkV28ApiRoutes.get("/", (c) => {
  return c.json({
    ok: true,
    version: "v28",
    dimensionCount: 16,
    dimensions: V28_DIMENSIONS,
    newInV28: [
      {
        dimension: "Trade Accountability",
        description:
          "Measures intellectual honesty about past outcomes. Do agents acknowledge " +
          "mistakes, avoid blame-shifting, propose corrective actions, and show " +
          "humility about uncertainty? Sub-scores: loss acknowledgment, blame " +
          "avoidance, error specificity, corrective action, self-report accuracy, " +
          "intellectual humility.",
      },
      {
        dimension: "Reasoning Quality Index (RQI)",
        description:
          "Structural meta-analysis of reasoning quality. Measures HOW WELL the " +
          "agent reasons, not just what it reasons about. Sub-scores: logical chain " +
          "length, evidence density per claim, counter-argument quality, conclusion " +
          "clarity, quantitative rigor, conditional reasoning.",
      },
    ],
    methodology:
      "The v28 benchmark evaluates AI trading agents across 16 weighted dimensions. " +
      "Each dimension is scored 0-1 and combined into a weighted composite score (0-100). " +
      "v28 introduces Trade Accountability (intellectual honesty about past outcomes) and " +
      "Reasoning Quality Index (structural reasoning quality). " +
      "Grades range from S (>=90) through F (<35).",
    website: "https://www.patgpt.us",
    dataset: "https://huggingface.co/datasets/patruff/molt-benchmark",
  });
});

// ---------------------------------------------------------------------------
// GET /leaderboard — 16-dimension leaderboard
// ---------------------------------------------------------------------------

benchmarkV28ApiRoutes.get("/leaderboard", (c) => {
  const cache = getV28Leaderboard();

  const AGENT_LABELS: Record<string, string> = {
    "claude-value-investor": "Claude ValueBot",
    "gpt-momentum-trader": "GPT MomentumBot",
    "grok-contrarian": "Grok ContrarianBot",
  };

  const entries = Array.from(cache.entries())
    .map(([agentId, scores]) => ({
      agentId,
      label: AGENT_LABELS[agentId] ?? agentId,
      scores,
    }))
    .sort((a, b) => b.scores.composite - a.scores.composite);

  return c.json({
    ok: true,
    version: "v28",
    dimensionCount: 16,
    leaderboard: entries.map((e, i) => ({
      rank: i + 1,
      agentId: e.agentId,
      label: e.label,
      composite: e.scores.composite,
      grade: e.scores.grade,
      dimensions: {
        pnl: e.scores.pnl,
        coherence: e.scores.coherence,
        hallucinationFree: e.scores.hallucinationFree,
        discipline: e.scores.discipline,
        calibration: e.scores.calibration,
        predictionAccuracy: e.scores.predictionAccuracy,
        reasoningDepth: e.scores.reasoningDepth,
        sourceQuality: e.scores.sourceQuality,
        outcomePrediction: e.scores.outcomePrediction,
        consensusIntelligence: e.scores.consensusIntelligence,
        strategyGenome: e.scores.strategyGenome,
        riskRewardDiscipline: e.scores.riskRewardDiscipline,
        executionQuality: e.scores.executionQuality,
        crossRoundLearning: e.scores.crossRoundLearning,
        tradeAccountability: e.scores.tradeAccountability,
        reasoningQualityIndex: e.scores.reasoningQualityIndex,
      },
    })),
  });
});

// ---------------------------------------------------------------------------
// GET /leaderboard/:agentId — Specific agent's v28 scores
// ---------------------------------------------------------------------------

benchmarkV28ApiRoutes.get("/leaderboard/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const cache = getV28Leaderboard();
  const scores = cache.get(agentId);

  if (!scores) {
    return c.json({ ok: false, error: `No v28 scores for agent: ${agentId}` }, 404);
  }

  const accountabilityHist = getAccountabilityHistory(agentId);
  const rqiHist = getRqiHistory(agentId);

  return c.json({
    ok: true,
    agentId,
    scores,
    v28Details: {
      accountabilitySamples: accountabilityHist.length,
      rqiSamples: rqiHist.length,
      avgAccountability:
        accountabilityHist.length > 0
          ? Math.round(
              (accountabilityHist.reduce((s, a) => s + a.accountabilityScore, 0) /
                accountabilityHist.length) *
                100,
            ) / 100
          : null,
      avgRqi:
        rqiHist.length > 0
          ? Math.round(
              (rqiHist.reduce((s, r) => s + r.rqiScore, 0) / rqiHist.length) * 100,
            ) / 100
          : null,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /accountability/:agentId — Agent's accountability history
// ---------------------------------------------------------------------------

benchmarkV28ApiRoutes.get("/accountability/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const history = getAccountabilityHistory(agentId);
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10), 100);

  return c.json({
    ok: true,
    agentId,
    dimension: "Trade Accountability",
    description:
      "Measures intellectual honesty about past outcomes. Sub-scores: " +
      "loss acknowledgment, blame avoidance, error specificity, corrective action, " +
      "self-report accuracy, intellectual humility.",
    total: history.length,
    entries: history.slice(-limit).reverse(),
    avgScore:
      history.length > 0
        ? Math.round(
            (history.reduce((s, h) => s + h.accountabilityScore, 0) / history.length) *
              100,
          ) / 100
        : null,
  });
});

// ---------------------------------------------------------------------------
// GET /rqi/:agentId — Agent's RQI history
// ---------------------------------------------------------------------------

benchmarkV28ApiRoutes.get("/rqi/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const history = getRqiHistory(agentId);
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10), 100);

  return c.json({
    ok: true,
    agentId,
    dimension: "Reasoning Quality Index",
    description:
      "Structural meta-analysis of reasoning quality. Sub-scores: logical chain " +
      "length, evidence density, counter-argument quality, conclusion clarity, " +
      "quantitative rigor, conditional reasoning.",
    total: history.length,
    entries: history.slice(-limit).reverse(),
    avgScore:
      history.length > 0
        ? Math.round(
            (history.reduce((s, h) => s + h.rqiScore, 0) / history.length) * 100,
          ) / 100
        : null,
  });
});

// ---------------------------------------------------------------------------
// GET /dimensions — Full dimension breakdown
// ---------------------------------------------------------------------------

benchmarkV28ApiRoutes.get("/dimensions", (c) => {
  const categories = groupByKey(V28_DIMENSIONS, 'category');

  return c.json({
    ok: true,
    version: "v28",
    totalDimensions: 16,
    totalWeight: TOTAL_WEIGHT,
    categories,
    dimensions: V28_DIMENSIONS.map((d) => ({
      ...d,
      weightPercent: Math.round((d.weight / TOTAL_WEIGHT) * 100 * 10) / 10,
    })),
  });
});

// ---------------------------------------------------------------------------
// GET /export — JSONL export for researchers
// ---------------------------------------------------------------------------

benchmarkV28ApiRoutes.get("/export", (c) => {
  const format = c.req.query("format") ?? "jsonl";
  const cache = getV28Leaderboard();

  const entries = Array.from(cache.entries()).map(([agentId, scores]) => ({
    benchmark: "moltapp-v28",
    agent_id: agentId,
    dimensions: 16,
    pnl: scores.pnl,
    coherence: scores.coherence,
    hallucination_free: scores.hallucinationFree,
    discipline: scores.discipline,
    calibration: scores.calibration,
    prediction_accuracy: scores.predictionAccuracy,
    reasoning_depth: scores.reasoningDepth,
    source_quality: scores.sourceQuality,
    outcome_prediction: scores.outcomePrediction,
    consensus_intelligence: scores.consensusIntelligence,
    strategy_genome: scores.strategyGenome,
    risk_reward_discipline: scores.riskRewardDiscipline,
    execution_quality: scores.executionQuality,
    cross_round_learning: scores.crossRoundLearning,
    trade_accountability: scores.tradeAccountability,
    reasoning_quality_index: scores.reasoningQualityIndex,
    composite_score: scores.composite,
    grade: scores.grade,
    timestamp: new Date().toISOString(),
  }));

  if (format === "csv") {
    if (entries.length === 0) {
      return c.text("No data available", 200);
    }
    const headers = Object.keys(entries[0]);
    const rows = entries.map((e) =>
      headers.map((h) => String((e as Record<string, unknown>)[h])).join(","),
    );
    const csv = [headers.join(","), ...rows].join("\n");
    c.header("Content-Type", "text/csv");
    c.header("Content-Disposition", "attachment; filename=moltapp-v28-benchmark.csv");
    return c.text(csv);
  }

  // Default: JSONL
  const jsonl = entries.map((e) => JSON.stringify(e)).join("\n");
  c.header("Content-Type", "application/x-ndjson");
  c.header("Content-Disposition", "attachment; filename=moltapp-v28-benchmark.jsonl");
  return c.text(jsonl);
});

// ---------------------------------------------------------------------------
// GET /compare/:agentA/:agentB — Head-to-head comparison
// ---------------------------------------------------------------------------

benchmarkV28ApiRoutes.get("/compare/:agentA/:agentB", (c) => {
  const agentA = c.req.param("agentA");
  const agentB = c.req.param("agentB");
  const cache = getV28Leaderboard();

  const scoresA = cache.get(agentA);
  const scoresB = cache.get(agentB);

  if (!scoresA || !scoresB) {
    return c.json({
      ok: false,
      error: `Missing scores: ${!scoresA ? agentA : ""} ${!scoresB ? agentB : ""}`.trim(),
    }, 404);
  }

  // Build per-dimension comparison
  const comparison = V28_DIMENSIONS.map((dim) => {
    const key = dim.key as keyof V28CompositeScore;
    const a = typeof scoresA[key] === "number" ? (scoresA[key] as number) : 0;
    const b = typeof scoresB[key] === "number" ? (scoresB[key] as number) : 0;
    const diff = Math.round((a - b) * 100) / 100;
    return {
      dimension: dim.name,
      key: dim.key,
      weight: dim.weight,
      [agentA]: a,
      [agentB]: b,
      advantage: diff > 0.05 ? agentA : diff < -0.05 ? agentB : "tied",
      delta: diff,
    };
  });

  const aWins = comparison.filter((c) => c.advantage === agentA).length;
  const bWins = comparison.filter((c) => c.advantage === agentB).length;

  return c.json({
    ok: true,
    comparison: {
      [agentA]: { composite: scoresA.composite, grade: scoresA.grade },
      [agentB]: { composite: scoresB.composite, grade: scoresB.grade },
    },
    dimensionWins: { [agentA]: aWins, [agentB]: bWins, tied: 16 - aWins - bWins },
    dimensions: comparison,
  });
});

// ---------------------------------------------------------------------------
// GET /methodology — Scoring methodology
// ---------------------------------------------------------------------------

benchmarkV28ApiRoutes.get("/methodology", (c) => {
  return c.json({
    ok: true,
    version: "v28",
    title: "MoltApp v28: 16-Dimension AI Trading Benchmark",
    methodology: {
      overview:
        "MoltApp v28 evaluates AI trading agents across 16 weighted dimensions, " +
        "each scored 0-1. The composite score is a weighted average scaled to 0-100.",
      dimensions: V28_DIMENSIONS.map((d) => ({
        name: d.name,
        key: d.key,
        weight: d.weight,
        category: d.category,
        description: d.description,
      })),
      grading: {
        S: "90-100: Exceptional — near-human expert quality",
        "A+": "85-89: Outstanding — consistently excellent",
        A: "80-84: Excellent — strong across all dimensions",
        "B+": "70-79: Good — solid with some weaknesses",
        B: "60-69: Above Average — competent trading agent",
        C: "50-59: Average — meets baseline requirements",
        D: "35-49: Below Average — significant weaknesses",
        F: "0-34: Failing — fundamental reasoning issues",
      },
      v28Additions: {
        tradeAccountability: {
          description:
            "Measures intellectual honesty about past outcomes. Rewards agents " +
            "that acknowledge mistakes, avoid blame-shifting, propose corrections, " +
            "and show appropriate humility about uncertainty.",
          subScores: [
            "Loss Acknowledgment: Does the agent mention past losses/errors?",
            "Blame Avoidance: Does it avoid blaming external factors? (inverted)",
            "Error Specificity: Does it explain what it got wrong?",
            "Corrective Action: Does it propose fixes for past errors?",
            "Self-Report Accuracy: Does it honestly report its track record?",
            "Intellectual Humility: Does it express appropriate uncertainty?",
          ],
        },
        reasoningQualityIndex: {
          description:
            "Structural meta-analysis of reasoning quality. Measures HOW WELL the " +
            "agent reasons. High-RQI responses have clear logical chains, evidence-supported " +
            "claims, counterargument consideration, and clear conclusions.",
          subScores: [
            "Logical Chain Length: How many explicit reasoning steps?",
            "Evidence Density: Evidence citations per claim ratio",
            "Counter-Argument Quality: Consideration of opposing views",
            "Conclusion Clarity: Clear, supported final recommendation",
            "Quantitative Rigor: Use of specific numbers and data",
            "Conditional Reasoning: If/then logic and scenario analysis",
          ],
        },
      },
    },
    citation: {
      bibtex: `@misc{moltapp2026,\n  title={MoltApp: 16-Dimension Agentic Stock Trading Benchmark},\n  author={Pat Ruff},\n  year={2026},\n  url={https://www.patgpt.us}\n}`,
    },
  });
});
