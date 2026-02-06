/**
 * Benchmark v27 API Routes
 *
 * Researcher-facing API for the 14-dimension AI trading benchmark.
 * v27 adds Execution Quality and Cross-Round Learning analysis.
 *
 * Routes:
 * GET  /                          — v27 benchmark overview
 * GET  /leaderboard               — 14-dimension leaderboard with composite scores
 * GET  /leaderboard/:agentId      — Specific agent's v27 scores
 * GET  /execution-quality/:agentId — Agent's execution quality history
 * GET  /learning/:agentId         — Agent's cross-round learning history
 * GET  /dimensions                — Full dimension breakdown with categories
 * GET  /export                    — JSONL export for researchers
 * GET  /compare/:agentA/:agentB  — Head-to-head agent comparison
 * GET  /methodology               — Scoring methodology documentation
 */

import { Hono } from "hono";
import {
  getExecutionQualityHistory,
  getCrossRoundLearningHistory,
  getV27Leaderboard,
  computeV27Composite,
  type V27CompositeScore,
} from "../services/v27-benchmark-engine.ts";
import { V27_DIMENSIONS } from "../schemas/benchmark-v27.ts";
import { mean, round2, sumByKey } from "../lib/math-utils.ts";

export const benchmarkV27ApiRoutes = new Hono();

// ---------------------------------------------------------------------------
// Dimension weight map derived from V27_DIMENSIONS for quick lookups
// ---------------------------------------------------------------------------

const DIMENSION_WEIGHTS: Record<string, number> = {};
for (const dim of V27_DIMENSIONS) {
  DIMENSION_WEIGHTS[dim.key] = dim.weight;
}

const TOTAL_WEIGHT = sumByKey(V27_DIMENSIONS, 'weight');

// ---------------------------------------------------------------------------
// GET / — v27 benchmark overview
// ---------------------------------------------------------------------------

benchmarkV27ApiRoutes.get("/", (c) => {
  return c.json({
    ok: true,
    version: "v27",
    dimensionCount: 14,
    dimensions: V27_DIMENSIONS,
    methodology:
      "The v27 benchmark evaluates AI trading agents across 14 weighted dimensions. " +
      "Each dimension is scored 0-1 and combined into a weighted composite score (0-100). " +
      "v27 introduces Execution Quality (slippage awareness, price realism, timing rationale, " +
      "execution plan quality, market impact awareness) and Cross-Round Learning (lesson " +
      "application, mistake avoidance, strategy adaptation, outcome integration, reasoning evolution). " +
      "Grades range from S (>=90) through F (<35).",
    website: "https://www.patgpt.us",
  });
});

// ---------------------------------------------------------------------------
// GET /leaderboard — 14-dimension leaderboard
// ---------------------------------------------------------------------------

benchmarkV27ApiRoutes.get("/leaderboard", (c) => {
  try {
    const cache = getV27Leaderboard();

    const entries = Array.from(cache.entries())
      .map(([agentId, scores]) => ({ agentId, ...scores }))
      .sort((a, b) => b.composite - a.composite)
      .map((entry, index) => ({
        rank: index + 1,
        ...entry,
      }));

    return c.json({
      ok: true,
      version: "v27",
      dimensions: 14,
      totalWeight: TOTAL_WEIGHT,
      leaderboard: entries,
      weights: DIMENSION_WEIGHTS,
      gradingScale: {
        S: ">=90",
        "A+": ">=85",
        A: ">=80",
        "B+": ">=70",
        B: ">=60",
        C: ">=50",
        D: ">=35",
        F: "<35",
      },
    });
  } catch {
    return c.json({
      ok: true,
      version: "v27",
      dimensions: 14,
      leaderboard: [],
      message: "No data available yet. Run trading rounds to populate.",
    });
  }
});

// ---------------------------------------------------------------------------
// GET /leaderboard/:agentId — specific agent's v27 scores
// ---------------------------------------------------------------------------

benchmarkV27ApiRoutes.get("/leaderboard/:agentId", (c) => {
  const agentId = c.req.param("agentId");

  try {
    const cache = getV27Leaderboard();
    const scores = cache.get(agentId);

    if (!scores) {
      return c.json(
        {
          ok: false,
          error: `No v27 scores found for agent: ${agentId}`,
          hint: "Scores are populated during trading rounds.",
        },
        404,
      );
    }

    // Compute rank
    const allEntries = Array.from(cache.values()).sort(
      (a, b) => b.composite - a.composite,
    );
    const rank =
      allEntries.findIndex(
        (e) => e.composite === scores.composite && e.grade === scores.grade,
      ) + 1;

    // Build per-dimension detail
    const dimensionDetails = V27_DIMENSIONS.map((dim) => {
      const score = (scores as unknown as Record<string, number>)[dim.key] ?? 0;
      return {
        key: dim.key,
        name: dim.name,
        score: round2(score),
        weight: dim.weight,
        weightedContribution:
          round2(((score * dim.weight) / TOTAL_WEIGHT) * 100),
        category: dim.category,
      };
    });

    return c.json({
      ok: true,
      agentId,
      rank,
      composite: scores.composite,
      grade: scores.grade,
      dimensions: dimensionDetails,
    });
  } catch {
    return c.json(
      {
        ok: false,
        error: `Failed to retrieve scores for agent: ${agentId}`,
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /execution-quality/:agentId — agent's execution quality history
// ---------------------------------------------------------------------------

benchmarkV27ApiRoutes.get("/execution-quality/:agentId", (c) => {
  const agentId = c.req.param("agentId");

  try {
    const history = getExecutionQualityHistory(agentId);

    if (history.length === 0) {
      return c.json(
        {
          ok: false,
          error: `No execution quality data for agent: ${agentId}`,
          hint: "Execution quality is recorded during trading rounds.",
        },
        404,
      );
    }

    // Compute stats
    const scores = history.map((h) => h.executionQualityScore);
    const avg = mean(scores);
    const count = scores.length;

    // Trend: compare last 3 entries avg to overall avg
    let trend: "improving" | "declining" | "stable";
    if (count >= 3) {
      const recentSlice = scores.slice(-3);
      const recentAvg = mean(recentSlice);
      const delta = recentAvg - avg;
      if (delta > 0.03) {
        trend = "improving";
      } else if (delta < -0.03) {
        trend = "declining";
      } else {
        trend = "stable";
      }
    } else {
      trend = "stable";
    }

    return c.json({
      ok: true,
      agentId,
      history,
      stats: {
        avg: round2(avg),
        count,
        trend,
      },
    });
  } catch {
    return c.json(
      {
        ok: false,
        error: `Failed to retrieve execution quality for agent: ${agentId}`,
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /learning/:agentId — agent's cross-round learning history
// ---------------------------------------------------------------------------

benchmarkV27ApiRoutes.get("/learning/:agentId", (c) => {
  const agentId = c.req.param("agentId");

  try {
    const history = getCrossRoundLearningHistory(agentId);

    if (history.length === 0) {
      return c.json(
        {
          ok: false,
          error: `No cross-round learning data for agent: ${agentId}`,
          hint: "Learning data is recorded during trading rounds.",
        },
        404,
      );
    }

    // Compute stats
    const scores = history.map((h) => h.learningScore);
    const avg = mean(scores);
    const count = scores.length;

    // Trend: compare last 3 entries avg to overall avg
    let trend: "improving" | "declining" | "stable";
    if (count >= 3) {
      const recentSlice = scores.slice(-3);
      const recentAvg = mean(recentSlice);
      const delta = recentAvg - avg;
      if (delta > 0.03) {
        trend = "improving";
      } else if (delta < -0.03) {
        trend = "declining";
      } else {
        trend = "stable";
      }
    } else {
      trend = "stable";
    }

    return c.json({
      ok: true,
      agentId,
      history,
      stats: {
        avg: round2(avg),
        count,
        trend,
      },
    });
  } catch {
    return c.json(
      {
        ok: false,
        error: `Failed to retrieve learning history for agent: ${agentId}`,
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /dimensions — Full dimension breakdown
// ---------------------------------------------------------------------------

benchmarkV27ApiRoutes.get("/dimensions", (c) => {
  // Group dimensions by category
  const categories: Record<string, typeof V27_DIMENSIONS[number][]> = {};
  for (const dim of V27_DIMENSIONS) {
    if (!categories[dim.category]) {
      categories[dim.category] = [];
    }
    (categories[dim.category] as typeof V27_DIMENSIONS[number][]).push(dim);
  }

  return c.json({
    ok: true,
    version: "v27",
    totalDimensions: 14,
    totalWeight: TOTAL_WEIGHT,
    dimensions: V27_DIMENSIONS,
    byCategory: categories,
  });
});

// ---------------------------------------------------------------------------
// GET /export — JSONL export for researchers
// ---------------------------------------------------------------------------

benchmarkV27ApiRoutes.get("/export", (c) => {
  try {
    const cache = getV27Leaderboard();
    const entries = Array.from(cache.entries())
      .map(([agentId, scores]) => ({ agentId, ...scores }))
      .sort((a, b) => b.composite - a.composite);

    const metadataLine =
      "// MoltApp v27 14-Dimension Benchmark Export — " +
      `generated ${new Date().toISOString()} — ${entries.length} agents — ` +
      "https://www.patgpt.us";

    const lines = entries.map((entry, index) =>
      JSON.stringify({
        rank: index + 1,
        agent_id: entry.agentId,
        composite: entry.composite,
        grade: entry.grade,
        pnl: entry.pnl,
        coherence: entry.coherence,
        hallucination_free: entry.hallucinationFree,
        discipline: entry.discipline,
        calibration: entry.calibration,
        prediction_accuracy: entry.predictionAccuracy,
        reasoning_depth: entry.reasoningDepth,
        source_quality: entry.sourceQuality,
        outcome_prediction: entry.outcomePrediction,
        consensus_intelligence: entry.consensusIntelligence,
        strategy_genome: entry.strategyGenome,
        risk_reward_discipline: entry.riskRewardDiscipline,
        execution_quality: entry.executionQuality,
        cross_round_learning: entry.crossRoundLearning,
        benchmark_version: "v27",
      }),
    );

    c.header("Content-Type", "application/x-ndjson");
    c.header(
      "Content-Disposition",
      "attachment; filename=moltapp-benchmark-v27.jsonl",
    );
    return c.body([metadataLine, ...lines].join("\n"));
  } catch {
    return c.json(
      {
        ok: false,
        error: "Export failed — leaderboard data may be unavailable",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /compare/:agentA/:agentB — head-to-head comparison
// ---------------------------------------------------------------------------

benchmarkV27ApiRoutes.get("/compare/:agentA/:agentB", (c) => {
  const agentA = c.req.param("agentA");
  const agentB = c.req.param("agentB");

  try {
    const cache = getV27Leaderboard();
    const scoresA = cache.get(agentA);
    const scoresB = cache.get(agentB);

    if (!scoresA && !scoresB) {
      return c.json(
        {
          ok: false,
          error: `Neither agent found: ${agentA}, ${agentB}`,
          hint: "Scores are populated during trading rounds.",
        },
        404,
      );
    }

    if (!scoresA) {
      return c.json(
        {
          ok: false,
          error: `No v27 scores found for agent: ${agentA}`,
        },
        404,
      );
    }

    if (!scoresB) {
      return c.json(
        {
          ok: false,
          error: `No v27 scores found for agent: ${agentB}`,
        },
        404,
      );
    }

    // Dimension-by-dimension comparison
    let agentAWins = 0;
    let agentBWins = 0;
    let ties = 0;

    const dimensionComparison = V27_DIMENSIONS.map((dim) => {
      const valA =
        (scoresA as unknown as Record<string, number>)[dim.key] ?? 0;
      const valB =
        (scoresB as unknown as Record<string, number>)[dim.key] ?? 0;

      let winner: string;
      if (Math.abs(valA - valB) < 0.005) {
        winner = "tie";
        ties++;
      } else if (valA > valB) {
        winner = agentA;
        agentAWins++;
      } else {
        winner = agentB;
        agentBWins++;
      }

      return {
        dimension: dim.key,
        name: dim.name,
        weight: dim.weight,
        [agentA]: round2(valA),
        [agentB]: round2(valB),
        delta: round2(valA - valB),
        winner,
      };
    });

    // Overall winner
    let overallWinner: string;
    if (Math.abs(scoresA.composite - scoresB.composite) < 0.5) {
      overallWinner = "tie";
    } else if (scoresA.composite > scoresB.composite) {
      overallWinner = agentA;
    } else {
      overallWinner = agentB;
    }

    return c.json({
      ok: true,
      agents: {
        [agentA]: {
          composite: scoresA.composite,
          grade: scoresA.grade,
        },
        [agentB]: {
          composite: scoresB.composite,
          grade: scoresB.grade,
        },
      },
      overallWinner,
      dimensionWins: {
        [agentA]: agentAWins,
        [agentB]: agentBWins,
        ties,
      },
      dimensions: dimensionComparison,
    });
  } catch {
    return c.json(
      {
        ok: false,
        error: "Comparison failed — leaderboard data may be unavailable",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /methodology — scoring methodology documentation
// ---------------------------------------------------------------------------

benchmarkV27ApiRoutes.get("/methodology", (c) => {
  return c.json({
    ok: true,
    version: "v27",
    title: "MoltApp v27 — 14-Dimension AI Trading Benchmark Methodology",
    overview:
      "The v27 benchmark evaluates AI trading agents across 14 dimensions grouped into " +
      "7 categories. Each dimension is scored independently on a 0-1 scale, then combined " +
      "using calibrated weights into a composite score (0-100). The composite score maps to " +
      "a letter grade from S (exceptional) to F (failing).",
    compositeFormula:
      "composite = (sum(dimension_score * dimension_weight) / sum(all_weights)) * 100",
    totalWeight: TOTAL_WEIGHT,
    gradingScale: [
      { grade: "S", range: "90-100", label: "Exceptional" },
      { grade: "A+", range: "85-89.99", label: "Outstanding" },
      { grade: "A", range: "80-84.99", label: "Excellent" },
      { grade: "B+", range: "70-79.99", label: "Very Good" },
      { grade: "B", range: "60-69.99", label: "Good" },
      { grade: "C", range: "50-59.99", label: "Average" },
      { grade: "D", range: "35-49.99", label: "Below Average" },
      { grade: "F", range: "0-34.99", label: "Failing" },
    ],
    dimensions: [
      {
        key: "pnl",
        name: "P&L Return",
        weight: 12,
        category: "financial",
        since: "v1",
        scoring:
          "Portfolio returns relative to initial capital and market benchmark. " +
          "Normalized from raw percentage return to 0-1 based on historical performance bands.",
        rationale: "Highest weight because financial performance is the primary objective of a trading agent.",
      },
      {
        key: "coherence",
        name: "Reasoning Coherence",
        weight: 10,
        category: "qualitative",
        since: "v1",
        scoring:
          "NLP analysis of whether the stated reasoning logically supports the chosen action. " +
          "Checks for contradictions, non-sequiturs, and logical flow between evidence and conclusion.",
        rationale: "Coherent reasoning indicates reliable decision-making, not just lucky outcomes.",
      },
      {
        key: "hallucinationFree",
        name: "Hallucination-Free",
        weight: 8,
        category: "safety",
        since: "v1",
        scoring:
          "Fraction of trade justifications free from fabricated data points. " +
          "Detected by cross-referencing cited figures against actual market data feeds.",
        rationale: "Agents that hallucinate data are fundamentally unreliable regardless of other metrics.",
      },
      {
        key: "discipline",
        name: "Instruction Discipline",
        weight: 8,
        category: "safety",
        since: "v1",
        scoring:
          "Compliance rate with position limits, portfolio allocation rules, and trading constraints. " +
          "Binary pass/fail per trade, aggregated to a ratio.",
        rationale: "Rule adherence ensures agents can be safely deployed with real capital.",
      },
      {
        key: "calibration",
        name: "Confidence Calibration",
        weight: 7,
        category: "forecasting",
        since: "v23",
        scoring:
          "Expected Calibration Error (ECE) measuring alignment between self-reported confidence " +
          "and actual outcome accuracy. Lower ECE = better calibration = higher score.",
        rationale: "Well-calibrated agents provide actionable confidence signals for portfolio sizing.",
      },
      {
        key: "predictionAccuracy",
        name: "Prediction Accuracy",
        weight: 7,
        category: "forecasting",
        since: "v23",
        scoring:
          "Rate of correct directional predictions over time. " +
          "A prediction is correct if the asset moved in the predicted direction within the stated horizon.",
        rationale: "Prediction accuracy validates that the agent's market model has real signal.",
      },
      {
        key: "reasoningDepth",
        name: "Reasoning Depth",
        weight: 7,
        category: "qualitative",
        since: "v24",
        scoring:
          "Structural analysis of reasoning: number of logical steps, use of connectives, " +
          "evidence anchoring, consideration of alternatives, and acknowledgment of uncertainty.",
        rationale: "Deep reasoning correlates with robust decision-making under novel conditions.",
      },
      {
        key: "sourceQuality",
        name: "Source Quality",
        weight: 6,
        category: "qualitative",
        since: "v24",
        scoring:
          "Evaluation of cited data sources for diversity, relevance, and reliability. " +
          "Higher scores for citing multiple independent data types (price, volume, sentiment, on-chain).",
        rationale: "Better information inputs lead to better trading decisions.",
      },
      {
        key: "outcomePrediction",
        name: "Outcome Prediction",
        weight: 6,
        category: "forecasting",
        since: "v25",
        scoring:
          "Quality of predicted outcomes versus actual price movements. " +
          "Evaluates magnitude accuracy, not just direction.",
        rationale: "Precise outcome prediction enables better position sizing and risk management.",
      },
      {
        key: "consensusIntelligence",
        name: "Consensus Intelligence",
        weight: 5,
        category: "behavioral",
        since: "v25",
        scoring:
          "Measures independent thinking and contrarian success. " +
          "Agents that follow consensus blindly score lower; agents that successfully diverge score higher.",
        rationale: "Alpha generation requires the ability to identify opportunities that others miss.",
      },
      {
        key: "strategyGenome",
        name: "Strategy Genome",
        weight: 6,
        category: "behavioral",
        since: "v26",
        scoring:
          "Strategy DNA consistency analysis. Measures whether the agent maintains a coherent " +
          "trading style or drifts randomly between approaches. Computed via style fingerprinting " +
          "and multi-round DNA comparison.",
        rationale: "Consistent strategy application is key to long-term compounding.",
      },
      {
        key: "riskRewardDiscipline",
        name: "Risk-Reward Discipline",
        weight: 6,
        category: "behavioral",
        since: "v26",
        scoring:
          "Evaluates position sizing discipline, presence of risk boundaries (stop losses), " +
          "profit targets, and portfolio concentration management.",
        rationale: "Proper risk management prevents catastrophic drawdowns.",
      },
      {
        key: "executionQuality",
        name: "Execution Quality",
        weight: 6,
        category: "execution",
        since: "v27",
        scoring:
          "Five sub-dimensions scored 0-1 and combined: slippage awareness (20%), price realism " +
          "(25%), timing rationale (25%), execution plan quality (15%), market impact awareness (15%). " +
          "Evaluated via NLP pattern matching on trade reasoning text.",
        rationale: "Real-world trading success depends on execution, not just signal generation.",
      },
      {
        key: "crossRoundLearning",
        name: "Cross-Round Learning",
        weight: 6,
        category: "learning",
        since: "v27",
        scoring:
          "Six sub-dimensions scored 0-1 and combined: lesson application (25%), mistake repetition " +
          "avoidance (20%), strategy adaptation via 3-gram Jaccard distance (20%), outcome integration " +
          "(20%), and reasoning evolution (15%). References to past trades are also counted.",
        rationale: "Agents that learn from experience improve over time and avoid repeated failures.",
      },
    ],
    categories: [
      { name: "financial", description: "Direct financial performance metrics", dimensionCount: 1 },
      { name: "qualitative", description: "Quality of reasoning and information usage", dimensionCount: 3 },
      { name: "safety", description: "Safety and reliability guarantees", dimensionCount: 2 },
      { name: "forecasting", description: "Predictive accuracy and calibration", dimensionCount: 3 },
      { name: "behavioral", description: "Strategic consistency and risk management", dimensionCount: 3 },
      { name: "execution", description: "Trade execution planning and awareness", dimensionCount: 1 },
      { name: "learning", description: "Adaptation and improvement over time", dimensionCount: 1 },
    ],
    website: "https://www.patgpt.us",
  });
});
