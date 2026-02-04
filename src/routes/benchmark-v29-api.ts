/**
 * Benchmark v29 API Routes
 *
 * Researcher-facing API for the 18-dimension AI trading benchmark.
 * v29 adds Market Regime Awareness and Edge Consistency analysis.
 *
 * Routes:
 * GET  /                              — v29 benchmark overview
 * GET  /leaderboard                   — 18-dimension leaderboard with composite scores
 * GET  /leaderboard/:agentId          — Specific agent's v29 scores
 * GET  /dimensions                    — Full dimension breakdown with categories
 * GET  /export                        — JSONL or CSV export for researchers
 * GET  /compare/:agentA/:agentB       — Head-to-head agent comparison
 * GET  /methodology                   — Scoring methodology documentation
 */

import { Hono } from "hono";
import {
  getV29Leaderboard,
  type V29BenchmarkScore,
} from "../services/v29-benchmark-engine.ts";

export const benchmarkV29ApiRoutes = new Hono();

// ---------------------------------------------------------------------------
// Dimension definitions
// ---------------------------------------------------------------------------

const V29_DIMENSIONS = [
  { key: "pnlPercent", name: "P&L", weight: 15, category: "performance", description: "Return on investment" },
  { key: "sharpeRatio", name: "Sharpe", weight: 10, category: "performance", description: "Risk-adjusted return" },
  { key: "reasoningCoherence", name: "Coherence", weight: 12, category: "reasoning", description: "Does reasoning match action?" },
  { key: "hallucinationRate", name: "Halluc-Free", weight: 10, category: "safety", description: "Absence of fabricated data" },
  { key: "instructionDiscipline", name: "Discipline", weight: 8, category: "reliability", description: "Compliance with trading rules" },
  { key: "confidenceCalibration", name: "Calibration", weight: 5, category: "reliability", description: "Confidence-outcome correlation" },
  { key: "reasoningDepth", name: "Depth", weight: 8, category: "reasoning", description: "Multi-step reasoning sophistication" },
  { key: "sourceDiversity", name: "Sources", weight: 5, category: "reasoning", description: "Breadth of data sources cited" },
  { key: "strategyConsistency", name: "Consistency", weight: 5, category: "strategy", description: "Sticks to declared strategy" },
  { key: "adaptability", name: "Adaptability", weight: 5, category: "strategy", description: "Adjusts after losses" },
  { key: "riskAwareness", name: "Risk Aware", weight: 5, category: "risk", description: "Discusses risk in reasoning" },
  { key: "outcomeAccuracy", name: "Outcome", weight: 4, category: "performance", description: "Prediction vs actual accuracy" },
  { key: "executionQuality", name: "Execution", weight: 2, category: "execution", description: "Trade execution efficiency" },
  { key: "crossRoundLearning", name: "Learning", weight: 2, category: "learning", description: "Improves over rounds" },
  { key: "tradeAccountability", name: "Accountability", weight: 2, category: "integrity", description: "Acknowledges past mistakes" },
  { key: "reasoningQualityIndex", name: "RQI", weight: 2, category: "reasoning", description: "Structural reasoning quality" },
  { key: "marketRegimeAwareness", name: "Regime", weight: 1, category: "strategy", description: "Recognizes market conditions" },
  { key: "edgeConsistency", name: "Edge", weight: 1, category: "performance", description: "Consistent positive edge" },
];

const TOTAL_WEIGHT = V29_DIMENSIONS.reduce((sum, d) => sum + d.weight, 0);

const AGENT_LABELS: Record<string, string> = {
  "claude-value-investor": "Claude ValueBot",
  "gpt-momentum-trader": "GPT MomentumBot",
  "grok-contrarian": "Grok ContrarianBot",
};

// ---------------------------------------------------------------------------
// GET / — v29 benchmark overview
// ---------------------------------------------------------------------------

benchmarkV29ApiRoutes.get("/", (c) => {
  return c.json({
    ok: true,
    version: "v29",
    dimensionCount: 18,
    dimensions: V29_DIMENSIONS,
    newInV29: [
      {
        dimension: "Market Regime Awareness",
        description:
          "Measures whether the agent recognizes and adapts to prevailing market " +
          "conditions (bull, bear, sideways, volatile). Rewards agents that identify " +
          "regime shifts, adjust position sizing accordingly, and reference macro " +
          "context in their reasoning.",
      },
      {
        dimension: "Edge Consistency",
        description:
          "Evaluates whether the agent maintains a consistent positive edge over " +
          "time rather than relying on lucky streaks. Measures win-rate stability, " +
          "profit factor consistency, and drawdown recovery patterns across rounds.",
      },
    ],
    methodology:
      "The v29 benchmark evaluates AI trading agents across 18 weighted dimensions. " +
      "Each dimension is scored 0-1 and combined into a weighted composite score (0-100). " +
      "v29 introduces Market Regime Awareness (recognizing market conditions) and " +
      "Edge Consistency (maintaining a reliable positive edge). " +
      "Tiers: S (>=85), A (>=70), B (>=55), C (>=40), D (<40).",
    website: "https://www.patgpt.us",
    dataset: "https://huggingface.co/datasets/patruff/molt-benchmark",
  });
});

// ---------------------------------------------------------------------------
// GET /leaderboard — 18-dimension leaderboard
// ---------------------------------------------------------------------------

benchmarkV29ApiRoutes.get("/leaderboard", (c) => {
  const cache = getV29Leaderboard();

  const entries = Array.from(cache.entries())
    .map(([agentId, score]) => ({ agentId, score }))
    .sort((a, b) => b.score.compositeScore - a.score.compositeScore);

  return c.json({
    ok: true,
    version: "v29",
    dimensionCount: 18,
    leaderboard: entries.map((e, i) => ({
      rank: i + 1,
      agentId: e.agentId,
      label: AGENT_LABELS[e.agentId] ?? e.agentId,
      compositeScore: e.score.compositeScore,
      tier: e.score.tier,
      dimensions: {
        pnlPercent: e.score.pnlPercent,
        sharpeRatio: e.score.sharpeRatio,
        reasoningCoherence: e.score.reasoningCoherence,
        hallucinationRate: e.score.hallucinationRate,
        instructionDiscipline: e.score.instructionDiscipline,
        confidenceCalibration: e.score.confidenceCalibration,
        reasoningDepth: e.score.reasoningDepth,
        sourceDiversity: e.score.sourceDiversity,
        strategyConsistency: e.score.strategyConsistency,
        adaptability: e.score.adaptability,
        riskAwareness: e.score.riskAwareness,
        outcomeAccuracy: e.score.outcomeAccuracy,
        executionQuality: e.score.executionQuality,
        crossRoundLearning: e.score.crossRoundLearning,
        tradeAccountability: e.score.tradeAccountability,
        reasoningQualityIndex: e.score.reasoningQualityIndex,
        marketRegimeAwareness: e.score.marketRegimeAwareness,
        edgeConsistency: e.score.edgeConsistency,
      },
    })),
  });
});

// ---------------------------------------------------------------------------
// GET /leaderboard/:agentId — Specific agent's v29 scores
// ---------------------------------------------------------------------------

benchmarkV29ApiRoutes.get("/leaderboard/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const cache = getV29Leaderboard();
  const score = cache.find((s) => s.agentId === agentId);

  if (!score) {
    return c.json({ ok: false, error: `No v29 scores for agent: ${agentId}` }, 404);
  }

  return c.json({ ok: true, agentId, score });
});

// ---------------------------------------------------------------------------
// GET /dimensions — Full dimension breakdown grouped by category
// ---------------------------------------------------------------------------

benchmarkV29ApiRoutes.get("/dimensions", (c) => {
  const categories = new Map<string, (typeof V29_DIMENSIONS)[number][]>();
  for (const dim of V29_DIMENSIONS) {
    const list = categories.get(dim.category) ?? [];
    list.push(dim);
    categories.set(dim.category, list);
  }

  return c.json({
    ok: true,
    version: "v29",
    totalDimensions: 18,
    totalWeight: TOTAL_WEIGHT,
    categories: Object.fromEntries(categories),
    dimensions: V29_DIMENSIONS.map((d) => ({
      ...d,
      weightPercent: Math.round((d.weight / TOTAL_WEIGHT) * 100 * 10) / 10,
    })),
  });
});

// ---------------------------------------------------------------------------
// GET /export — JSONL or CSV export for researchers
// ---------------------------------------------------------------------------

benchmarkV29ApiRoutes.get("/export", (c) => {
  const format = c.req.query("format") ?? "jsonl";
  const cache = getV29Leaderboard();

  const records = Array.from(cache.entries()).map(([agentId, s]) => ({
    benchmark: "moltapp-v29",
    agent_id: agentId,
    dimensions: 18,
    pnl_percent: s.pnlPercent,
    sharpe_ratio: s.sharpeRatio,
    reasoning_coherence: s.reasoningCoherence,
    hallucination_rate: s.hallucinationRate,
    instruction_discipline: s.instructionDiscipline,
    confidence_calibration: s.confidenceCalibration,
    reasoning_depth: s.reasoningDepth,
    source_diversity: s.sourceDiversity,
    strategy_consistency: s.strategyConsistency,
    adaptability: s.adaptability,
    risk_awareness: s.riskAwareness,
    outcome_accuracy: s.outcomeAccuracy,
    execution_quality: s.executionQuality,
    cross_round_learning: s.crossRoundLearning,
    trade_accountability: s.tradeAccountability,
    reasoning_quality_index: s.reasoningQualityIndex,
    market_regime_awareness: s.marketRegimeAwareness,
    edge_consistency: s.edgeConsistency,
    composite_score: s.compositeScore,
    tier: s.tier,
    timestamp: new Date().toISOString(),
  }));

  if (format === "csv") {
    if (records.length === 0) {
      return c.text("No data available", 200);
    }
    const headers = Object.keys(records[0]);
    const rows = records.map((r) =>
      headers.map((h) => String((r as Record<string, unknown>)[h])).join(","),
    );
    const csv = [headers.join(","), ...rows].join("\n");
    c.header("Content-Type", "text/csv");
    c.header("Content-Disposition", "attachment; filename=moltapp-v29-benchmark.csv");
    return c.text(csv);
  }

  // Default: JSONL
  const jsonl = records.map((r) => JSON.stringify(r)).join("\n");
  c.header("Content-Type", "application/x-ndjson");
  c.header("Content-Disposition", "attachment; filename=moltapp-v29-benchmark.jsonl");
  return c.text(jsonl);
});

// ---------------------------------------------------------------------------
// GET /compare/:agentA/:agentB — Head-to-head comparison
// ---------------------------------------------------------------------------

benchmarkV29ApiRoutes.get("/compare/:agentA/:agentB", (c) => {
  const agentA = c.req.param("agentA");
  const agentB = c.req.param("agentB");
  const cache = getV29Leaderboard();

  const scoresA = cache.find((s) => s.agentId === agentA);
  const scoresB = cache.find((s) => s.agentId === agentB);

  if (!scoresA || !scoresB) {
    return c.json({
      ok: false,
      error: `Missing scores: ${!scoresA ? agentA : ""} ${!scoresB ? agentB : ""}`.trim(),
    }, 404);
  }

  const comparison = V29_DIMENSIONS.map((dim) => {
    const key = dim.key as keyof V29BenchmarkScore;
    const a = typeof scoresA[key] === "number" ? (scoresA[key] as number) : 0;
    const b = typeof scoresB[key] === "number" ? (scoresB[key] as number) : 0;
    const delta = Math.round((a - b) * 100) / 100;
    return {
      dimension: dim.name,
      key: dim.key,
      weight: dim.weight,
      [agentA]: a,
      [agentB]: b,
      advantage: delta > 0.05 ? agentA : delta < -0.05 ? agentB : "tied",
      delta,
    };
  });

  const aWins = comparison.filter((r) => r.advantage === agentA).length;
  const bWins = comparison.filter((r) => r.advantage === agentB).length;

  return c.json({
    ok: true,
    comparison: {
      [agentA]: { compositeScore: scoresA.compositeScore, tier: scoresA.tier },
      [agentB]: { compositeScore: scoresB.compositeScore, tier: scoresB.tier },
    },
    dimensionWins: { [agentA]: aWins, [agentB]: bWins, tied: 18 - aWins - bWins },
    dimensions: comparison,
    verdict:
      scoresA.compositeScore > scoresB.compositeScore
        ? `${AGENT_LABELS[agentA] ?? agentA} leads overall`
        : scoresB.compositeScore > scoresA.compositeScore
          ? `${AGENT_LABELS[agentB] ?? agentB} leads overall`
          : "Dead heat",
  });
});

// ---------------------------------------------------------------------------
// GET /methodology — Scoring methodology documentation
// ---------------------------------------------------------------------------

benchmarkV29ApiRoutes.get("/methodology", (c) => {
  return c.json({
    ok: true,
    version: "v29",
    title: "MoltApp v29: 18-Dimension AI Trading Benchmark",
    methodology: {
      overview:
        "MoltApp v29 evaluates AI trading agents across 18 weighted dimensions, " +
        "each scored 0-1. The composite score is a weighted average scaled to 0-100. " +
        "Weights sum to 100%.",
      dimensions: V29_DIMENSIONS.map((d) => ({
        name: d.name,
        key: d.key,
        weight: d.weight,
        category: d.category,
        description: d.description,
      })),
      tierThresholds: {
        S: ">=85: Exceptional — elite trading intelligence",
        A: ">=70: Strong — consistently high-quality decisions",
        B: ">=55: Competent — solid baseline performance",
        C: ">=40: Developing — meaningful weaknesses present",
        D: "<40: Deficient — fundamental reasoning gaps",
      },
      dataSources: [
        "On-chain trade history (PnL, execution timing)",
        "LLM reasoning traces (coherence, depth, quality)",
        "Round-over-round performance deltas (learning, consistency)",
        "Risk and position-sizing metadata",
      ],
      benchmarkRules: [
        "All dimensions scored 0-1 before weighting",
        "Composite = sum(dimension * weight) / totalWeight * 100",
        "Minimum 3 rounds required for stable scoring",
        "Hallucination and accountability use inverted scales (higher = better)",
      ],
      v29Additions: {
        marketRegimeAwareness: {
          description:
            "Recognizes prevailing market conditions (bull, bear, sideways, volatile) " +
            "and adjusts strategy accordingly. Rewards agents that detect regime shifts " +
            "and reference macro context in reasoning.",
          weight: 1,
        },
        edgeConsistency: {
          description:
            "Evaluates whether the agent maintains a consistent positive edge rather " +
            "than relying on variance. Measures win-rate stability, profit factor " +
            "consistency, and drawdown recovery across rounds.",
          weight: 1,
        },
      },
    },
    citation: {
      bibtex:
        `@misc{moltapp2026,\n  title={MoltApp: 18-Dimension Agentic Stock Trading Benchmark},\n  author={Pat Ruff},\n  year={2026},\n  url={https://www.patgpt.us}\n}`,
    },
  });
});
