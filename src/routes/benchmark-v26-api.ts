/**
 * Benchmark v26 API Routes
 *
 * Researcher-facing API for the 12-dimension AI trading benchmark.
 * v26 adds Strategy Genome and Risk-Reward Discipline analysis.
 *
 * Routes:
 * GET  /leaderboard          — 12-dimension leaderboard with composite scores
 * GET  /scores/:agentId      — Detailed scores for a specific agent
 * GET  /genome/:agentId      — Strategy genome DNA history and drift analysis
 * GET  /risk-reward/:agentId — Risk-reward discipline breakdown
 * GET  /dimensions           — All 12 dimension definitions and weights
 * GET  /export/jsonl         — Full JSONL export for researchers
 * GET  /export/csv           — CSV export of leaderboard scores
 * GET  /round/:roundId       — Per-round snapshot of all agents
 */

import { Hono } from "hono";
import { db } from "../db/index.ts";
import { tradeJustifications } from "../db/schema/trade-reasoning.ts";
import { desc, eq, sql } from "drizzle-orm";
import {
  analyzeStrategyGenome,
  analyzeRiskRewardDiscipline,
  calculateV26Composite,
  assignGrade,
  getAgentDnaHistory,
  V26_WEIGHTS,
  type V26DimensionScores,
  type StrategyDna,
} from "../services/v26-benchmark-engine.ts";

export const benchmarkV26ApiRoutes = new Hono();

// Type for drizzle trade justification rows
type TradeJustificationRow = typeof tradeJustifications.$inferSelect;

// Type for aggregated agent stats from DB
interface AgentStatRow {
  agentId: string;
  tradeCount: number;
  avgCoherence: number;
  avgConfidence: number;
  hallucinationCount: number;
  disciplinePassCount: number;
  avgQuantity?: number;
}

// Type for leaderboard entry
interface LeaderboardEntry {
  agentId: string;
  scores: V26DimensionScores;
  composite: number;
  grade: string;
  tradeCount: number;
}

// ---------------------------------------------------------------------------
// In-memory score cache for fast leaderboard rendering
// ---------------------------------------------------------------------------

interface AgentScoreCache {
  agentId: string;
  scores: V26DimensionScores;
  composite: number;
  grade: string;
  tradeCount: number;
  lastUpdated: string;
}

const scoreCache = new Map<string, AgentScoreCache>();

/**
 * Record a round's v26 scores (called from orchestrator or external integration).
 */
export function recordV26Scores(
  agentId: string,
  scores: V26DimensionScores,
  tradeCount: number,
): void {
  const composite = calculateV26Composite(scores);
  const grade = assignGrade(composite);

  const existing = scoreCache.get(agentId);
  if (existing) {
    // Exponential moving average with existing scores
    const alpha = 0.3;
    for (const key of Object.keys(scores) as (keyof V26DimensionScores)[]) {
      existing.scores[key] = existing.scores[key] * (1 - alpha) + scores[key] * alpha;
    }
    existing.composite = calculateV26Composite(existing.scores);
    existing.grade = assignGrade(existing.composite);
    existing.tradeCount += tradeCount;
    existing.lastUpdated = new Date().toISOString();
  } else {
    scoreCache.set(agentId, {
      agentId,
      scores,
      composite,
      grade,
      tradeCount,
      lastUpdated: new Date().toISOString(),
    });
  }
}

// ---------------------------------------------------------------------------
// GET /leaderboard — 12-dimension benchmark leaderboard
// ---------------------------------------------------------------------------

benchmarkV26ApiRoutes.get("/leaderboard", async (c) => {
  // If cache is populated, use it
  if (scoreCache.size > 0) {
    const leaderboard = Array.from(scoreCache.values())
      .sort((a, b) => b.composite - a.composite)
      .map((entry, rank) => ({
        rank: rank + 1,
        ...entry,
      }));

    return c.json({
      ok: true,
      version: "v26",
      dimensions: 12,
      leaderboard,
      weights: V26_WEIGHTS,
    });
  }

  // Fall back to DB aggregation
  try {
    const agentStats = await db
      .select({
        agentId: tradeJustifications.agentId,
        tradeCount: sql<number>`count(*)`,
        avgCoherence: sql<number>`avg(${tradeJustifications.coherenceScore})`,
        avgConfidence: sql<number>`avg(${tradeJustifications.confidence})`,
        hallucinationCount: sql<number>`count(*) filter (where jsonb_array_length(${tradeJustifications.hallucinationFlags}) > 0)`,
        disciplinePassCount: sql<number>`count(*) filter (where ${tradeJustifications.disciplinePass} = 'pass')`,
      })
      .from(tradeJustifications)
      .groupBy(tradeJustifications.agentId);

    const leaderboard: LeaderboardEntry[] = agentStats.map((s: AgentStatRow) => {
      const total = Number(s.tradeCount);
      const coherence = Number(s.avgCoherence) || 0;
      const hallFree = total > 0 ? 1 - Number(s.hallucinationCount) / total : 1;
      const discipline = total > 0 ? Number(s.disciplinePassCount) / total : 1;

      const scores: V26DimensionScores = {
        pnl: 0.5,
        coherence,
        hallucinationFree: hallFree,
        discipline,
        calibration: 0.5,
        predictionAccuracy: 0.5,
        reasoningDepth: 0.5,
        sourceQuality: 0.5,
        outcomePrediction: 0.5,
        consensusIntelligence: 0.5,
        strategyGenome: 0.5,
        riskRewardDiscipline: 0.5,
      };

      const composite = calculateV26Composite(scores);
      return {
        agentId: s.agentId,
        scores,
        composite,
        grade: assignGrade(composite),
        tradeCount: total,
      };
    });

    leaderboard.sort((a: LeaderboardEntry, b: LeaderboardEntry) => b.composite - a.composite);

    return c.json({
      ok: true,
      version: "v26",
      dimensions: 12,
      leaderboard: leaderboard.map((entry: LeaderboardEntry, i: number) => ({ rank: i + 1, ...entry })),
      weights: V26_WEIGHTS,
      source: "database",
    });
  } catch {
    return c.json({
      ok: true,
      version: "v26",
      dimensions: 12,
      leaderboard: [],
      message: "No data available yet. Run trading rounds to populate.",
    });
  }
});

// ---------------------------------------------------------------------------
// GET /scores/:agentId — Detailed dimension scores for one agent
// ---------------------------------------------------------------------------

benchmarkV26ApiRoutes.get("/scores/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const cached = scoreCache.get(agentId);

  if (!cached) {
    return c.json({
      ok: false,
      error: `No v26 scores found for agent: ${agentId}`,
      hint: "Scores are populated during trading rounds.",
    }, 404);
  }

  const dimensionDetails = Object.entries(cached.scores).map(([dim, score]) => ({
    dimension: dim,
    score: Math.round(score * 100) / 100,
    weight: V26_WEIGHTS[dim as keyof V26DimensionScores],
    weighted: Math.round(score * V26_WEIGHTS[dim as keyof V26DimensionScores] * 10000) / 100,
  }));

  return c.json({
    ok: true,
    agentId,
    composite: cached.composite,
    grade: cached.grade,
    tradeCount: cached.tradeCount,
    dimensions: dimensionDetails,
    lastUpdated: cached.lastUpdated,
  });
});

// ---------------------------------------------------------------------------
// GET /genome/:agentId — Strategy genome DNA analysis
// ---------------------------------------------------------------------------

benchmarkV26ApiRoutes.get("/genome/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const history = getAgentDnaHistory(agentId);

  if (!history) {
    return c.json({
      ok: false,
      error: `No strategy genome data for agent: ${agentId}`,
      hint: "Strategy genome is built from trade reasoning analysis.",
    }, 404);
  }

  return c.json({
    ok: true,
    agentId,
    currentAvgDna: history.avgDna,
    historyLength: history.dnaHistory.length,
    recentDna: history.dnaHistory.slice(-10),
    dominantStrategy: getDominantStrategy(history.avgDna as unknown as Record<string, number>),
    diversificationIndex: calculateDiversification(history.avgDna as unknown as Record<string, number>),
  });
});

function getDominantStrategy(dna: Record<string, number>): string {
  let maxWeight = 0;
  let dominant = "value";
  for (const [strategy, weight] of Object.entries(dna)) {
    if (weight > maxWeight) {
      maxWeight = weight;
      dominant = strategy.replace("Weight", "");
    }
  }
  return dominant;
}

function calculateDiversification(dna: Record<string, number>): number {
  const values = Object.values(dna);
  const sumSquares = values.reduce((s, v) => s + v * v, 0);
  // 1 - Herfindahl: 0 = concentrated, 1 = diversified
  return Math.round((1 - sumSquares) * 100) / 100;
}

// ---------------------------------------------------------------------------
// GET /risk-reward/:agentId — Risk-reward discipline breakdown
// ---------------------------------------------------------------------------

benchmarkV26ApiRoutes.get("/risk-reward/:agentId", async (c) => {
  const agentId = c.req.param("agentId");

  try {
    const recentTrades = await db
      .select()
      .from(tradeJustifications)
      .where(eq(tradeJustifications.agentId, agentId))
      .orderBy(desc(tradeJustifications.timestamp))
      .limit(20);

    if (recentTrades.length === 0) {
      return c.json({
        ok: false,
        error: `No trades found for agent: ${agentId}`,
      }, 404);
    }

    const analyses = recentTrades.map((trade: TradeJustificationRow) => {
      const rr = analyzeRiskRewardDiscipline(
        trade.reasoning,
        (trade.action ?? "hold") as "buy" | "sell" | "hold",
        trade.confidence,
        trade.quantity ?? 0,
        { cashBalance: 10000, totalValue: 10000, positions: [] },
        { maxPositionSize: 25, maxPortfolioAllocation: 85, riskTolerance: "moderate" },
      );

      return {
        id: trade.id,
        action: trade.action,
        symbol: trade.symbol,
        confidence: trade.confidence,
        ...rr,
        timestamp: trade.timestamp,
      };
    });

    const avgDiscipline =
      analyses.reduce((s: number, a: { disciplineScore: number }) => s + a.disciplineScore, 0) / analyses.length;
    const riskBoundaryRate =
      analyses.filter((a: { hasRiskBoundary: boolean }) => a.hasRiskBoundary).length / analyses.length;
    const profitTargetRate =
      analyses.filter((a: { hasProfitTarget: boolean }) => a.hasProfitTarget).length / analyses.length;

    return c.json({
      ok: true,
      agentId,
      summary: {
        avgDisciplineScore: Math.round(avgDiscipline * 100) / 100,
        riskBoundaryRate: Math.round(riskBoundaryRate * 100) / 100,
        profitTargetRate: Math.round(profitTargetRate * 100) / 100,
        tradesAnalyzed: analyses.length,
      },
      trades: analyses,
    });
  } catch {
    return c.json({
      ok: true,
      agentId,
      summary: { avgDisciplineScore: 0, riskBoundaryRate: 0, profitTargetRate: 0, tradesAnalyzed: 0 },
      trades: [],
      source: "empty",
    });
  }
});

// ---------------------------------------------------------------------------
// GET /dimensions — All 12 dimension definitions and weights
// ---------------------------------------------------------------------------

benchmarkV26ApiRoutes.get("/dimensions", (c) => {
  return c.json({
    ok: true,
    version: "v26",
    totalDimensions: 12,
    dimensions: [
      { name: "pnl", label: "P&L Return", weight: V26_WEIGHTS.pnl, type: "reward", description: "Return on investment from actual on-chain trades", range: "[-100, unbounded]", since: "v1" },
      { name: "coherence", label: "Reasoning Coherence", weight: V26_WEIGHTS.coherence, type: "qualitative", description: "Does reasoning logically support the trade action?", range: "[0, 1]", since: "v1" },
      { name: "hallucinationFree", label: "Hallucination-Free", weight: V26_WEIGHTS.hallucinationFree, type: "safety", description: "Rate of factually correct claims in reasoning", range: "[0, 1]", since: "v1" },
      { name: "discipline", label: "Instruction Discipline", weight: V26_WEIGHTS.discipline, type: "reliability", description: "Compliance with position limits and trading rules", range: "[0, 1]", since: "v1" },
      { name: "calibration", label: "Confidence Calibration", weight: V26_WEIGHTS.calibration, type: "calibration", description: "Expected Calibration Error — confidence predicts outcomes", range: "[0, 1]", since: "v23" },
      { name: "predictionAccuracy", label: "Prediction Accuracy", weight: V26_WEIGHTS.predictionAccuracy, type: "forecasting", description: "Rate of correct directional predictions", range: "[0, 1]", since: "v23" },
      { name: "reasoningDepth", label: "Reasoning Depth", weight: V26_WEIGHTS.reasoningDepth, type: "qualitative", description: "Structural quality: steps, connectives, evidence anchoring", range: "[0, 1]", since: "v24" },
      { name: "sourceQuality", label: "Source Quality", weight: V26_WEIGHTS.sourceQuality, type: "qualitative", description: "Quality and diversity of cited data sources", range: "[0, 1]", since: "v24" },
      { name: "outcomePrediction", label: "Outcome Prediction", weight: V26_WEIGHTS.outcomePrediction, type: "forecasting", description: "Predicted outcome vs actual price movement quality", range: "[0, 1]", since: "v25" },
      { name: "consensusIntelligence", label: "Consensus Intelligence", weight: V26_WEIGHTS.consensusIntelligence, type: "social", description: "Independent thinking and contrarian success", range: "[0, 1]", since: "v25" },
      { name: "strategyGenome", label: "Strategy Genome", weight: V26_WEIGHTS.strategyGenome, type: "behavioral", description: "Strategy DNA consistency — does agent stick to its declared approach?", range: "[0, 1]", since: "v26" },
      { name: "riskRewardDiscipline", label: "Risk-Reward Discipline", weight: V26_WEIGHTS.riskRewardDiscipline, type: "risk", description: "Position sizing, risk boundaries, portfolio concentration management", range: "[0, 1]", since: "v26" },
    ],
  });
});

// ---------------------------------------------------------------------------
// GET /export/jsonl — Full JSONL export for researchers
// ---------------------------------------------------------------------------

benchmarkV26ApiRoutes.get("/export/jsonl", async (c) => {
  try {
    const justifications = await db
      .select()
      .from(tradeJustifications)
      .orderBy(desc(tradeJustifications.timestamp))
      .limit(5000);

    const lines = justifications.map((j: TradeJustificationRow) => {
      const genome = analyzeStrategyGenome(
        j.agentId,
        j.reasoning,
        j.intent,
        "unknown",
      );
      const rr = analyzeRiskRewardDiscipline(
        j.reasoning,
        (j.action ?? "hold") as "buy" | "sell" | "hold",
        j.confidence,
        j.quantity ?? 0,
        { cashBalance: 10000, totalValue: 10000, positions: [] },
        { maxPositionSize: 25, maxPortfolioAllocation: 85, riskTolerance: "moderate" },
      );

      return JSON.stringify({
        agent_id: j.agentId,
        round_id: j.roundId,
        timestamp: j.timestamp?.toISOString(),
        action: j.action,
        symbol: j.symbol,
        quantity: j.quantity,
        reasoning: j.reasoning,
        confidence: j.confidence,
        sources: j.sources,
        intent: j.intent,
        coherence_score: j.coherenceScore,
        hallucination_flags: j.hallucinationFlags,
        discipline_pass: j.disciplinePass === "pass",
        strategy_genome_score: genome.genomeScore,
        detected_strategy: genome.detectedStrategy,
        style_consistency: genome.styleConsistencyScore,
        strategy_drift: genome.strategyDrift,
        strategy_dna: genome.strategyDna,
        risk_reward_discipline_score: rr.disciplineScore,
        sizing_discipline: rr.sizingDisciplineScore,
        risk_awareness: rr.riskAwarenessScore,
        has_risk_boundary: rr.hasRiskBoundary,
        has_profit_target: rr.hasProfitTarget,
        benchmark_version: "v26",
      });
    });

    c.header("Content-Type", "application/x-ndjson");
    c.header("Content-Disposition", "attachment; filename=moltapp-benchmark-v26.jsonl");
    return c.body(lines.join("\n"));
  } catch {
    return c.json({
      ok: false,
      error: "Export failed — database may be unavailable",
    }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /export/csv — CSV export of leaderboard
// ---------------------------------------------------------------------------

benchmarkV26ApiRoutes.get("/export/csv", (c) => {
  const entries = Array.from(scoreCache.values()).sort(
    (a, b) => b.composite - a.composite,
  );

  const header = [
    "rank",
    "agent_id",
    "composite_score",
    "grade",
    "trade_count",
    "pnl",
    "coherence",
    "hallucination_free",
    "discipline",
    "calibration",
    "prediction_accuracy",
    "reasoning_depth",
    "source_quality",
    "outcome_prediction",
    "consensus_intelligence",
    "strategy_genome",
    "risk_reward_discipline",
  ].join(",");

  const rows = entries.map((e, i) => {
    const s = e.scores;
    return [
      i + 1,
      e.agentId,
      e.composite,
      e.grade,
      e.tradeCount,
      s.pnl.toFixed(3),
      s.coherence.toFixed(3),
      s.hallucinationFree.toFixed(3),
      s.discipline.toFixed(3),
      s.calibration.toFixed(3),
      s.predictionAccuracy.toFixed(3),
      s.reasoningDepth.toFixed(3),
      s.sourceQuality.toFixed(3),
      s.outcomePrediction.toFixed(3),
      s.consensusIntelligence.toFixed(3),
      s.strategyGenome.toFixed(3),
      s.riskRewardDiscipline.toFixed(3),
    ].join(",");
  });

  const csv = [header, ...rows].join("\n");
  c.header("Content-Type", "text/csv");
  c.header("Content-Disposition", "attachment; filename=moltapp-leaderboard-v26.csv");
  return c.body(csv);
});

// ---------------------------------------------------------------------------
// GET /round/:roundId — Per-round snapshots
// ---------------------------------------------------------------------------

benchmarkV26ApiRoutes.get("/round/:roundId", async (c) => {
  const roundId = c.req.param("roundId");

  try {
    const roundTrades = await db
      .select()
      .from(tradeJustifications)
      .where(eq(tradeJustifications.roundId, roundId))
      .orderBy(desc(tradeJustifications.timestamp));

    if (roundTrades.length === 0) {
      return c.json({ ok: false, error: `No trades found for round: ${roundId}` }, 404);
    }

    const snapshots = roundTrades.map((t: TradeJustificationRow) => {
      const genome = analyzeStrategyGenome(t.agentId, t.reasoning, t.intent, "unknown");
      const rr = analyzeRiskRewardDiscipline(
        t.reasoning,
        (t.action ?? "hold") as "buy" | "sell" | "hold",
        t.confidence,
        t.quantity ?? 0,
        { cashBalance: 10000, totalValue: 10000, positions: [] },
        { maxPositionSize: 25, maxPortfolioAllocation: 85, riskTolerance: "moderate" },
      );

      return {
        agentId: t.agentId,
        action: t.action,
        symbol: t.symbol,
        reasoning: t.reasoning.slice(0, 200) + (t.reasoning.length > 200 ? "..." : ""),
        v26Scores: {
          coherence: t.coherenceScore ?? 0,
          hallucinationFree: ((t.hallucinationFlags as string[]) ?? []).length === 0 ? 1 : 0,
          confidence: t.confidence,
          strategyGenome: genome.genomeScore,
          riskRewardDiscipline: rr.disciplineScore,
        },
        genome: {
          detected: genome.detectedStrategy,
          drift: genome.strategyDrift,
          dna: genome.strategyDna,
        },
        riskReward: {
          sizing: rr.sizingDisciplineScore,
          riskAwareness: rr.riskAwarenessScore,
          hasStopLoss: rr.hasRiskBoundary,
          hasProfitTarget: rr.hasProfitTarget,
        },
      };
    });

    return c.json({
      ok: true,
      roundId,
      version: "v26",
      agents: snapshots,
    });
  } catch {
    return c.json({ ok: false, error: "Failed to fetch round data" }, 500);
  }
});
