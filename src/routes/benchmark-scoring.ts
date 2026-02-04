/**
 * Benchmark Scoring API Routes
 *
 * REST API for the v3 Composite Scoring Engine.
 * Provides scorecard computation, agent rankings, grade assignments,
 * factor analysis, and score history.
 *
 * Routes:
 * - GET  /scorecard            — Full benchmark scorecard with all agents
 * - GET  /scorecard/:agentId   — Single agent's detailed score breakdown
 * - GET  /history/:agentId     — Agent's score history (for trend charts)
 * - GET  /factors              — Factor weight descriptions
 * - GET  /correlations         — Factor correlation matrix
 * - GET  /grade-distribution   — Distribution of grades across agents
 */

import { Hono } from "hono";
import { db } from "../db/index.ts";
import { tradeJustifications } from "../db/schema/trade-reasoning.ts";
import { eq, sql } from "drizzle-orm";
import { getAgentConfigs } from "../agents/orchestrator.ts";
import {
  computeBenchmarkScorecard,
  getAgentScoreHistory,
  getCachedScorecard,
  setCachedScorecard,
  type AgentFactorInputs,
} from "../services/benchmark-scoring-engine.ts";
import { calculateConfidenceCalibration } from "../services/outcome-tracker.ts";

export const benchmarkScoringRoutes = new Hono();

// ---------------------------------------------------------------------------
// Helper: Gather agent factor inputs from DB
// ---------------------------------------------------------------------------

async function gatherAgentInputs(): Promise<AgentFactorInputs[]> {
  const agents = getAgentConfigs();
  const inputs: AgentFactorInputs[] = [];

  for (const agent of agents) {
    try {
      const stats = await db
        .select({
          totalTrades: sql<number>`count(*)`,
          avgCoherence: sql<number>`avg(${tradeJustifications.coherenceScore})`,
          avgConfidence: sql<number>`avg(${tradeJustifications.confidence})`,
          hallucinationCount: sql<number>`count(*) filter (where jsonb_array_length(${tradeJustifications.hallucinationFlags}) > 0)`,
          disciplinePassCount: sql<number>`count(*) filter (where ${tradeJustifications.disciplinePass} = 'pass')`,
        })
        .from(tradeJustifications)
        .where(eq(tradeJustifications.agentId, agent.agentId));

      const row = stats[0];
      const totalTrades = Number(row?.totalTrades ?? 0);
      const avgCoherence = Number(row?.avgCoherence) || 0;
      const hallucinationRate = totalTrades > 0
        ? Number(row?.hallucinationCount) / totalTrades
        : 0;
      const disciplineRate = totalTrades > 0
        ? Number(row?.disciplinePassCount) / totalTrades
        : 0;

      const calibration = calculateConfidenceCalibration(agent.agentId);

      inputs.push({
        agentId: agent.agentId,
        agentName: agent.name,
        provider: agent.provider,
        model: agent.model,
        pnlPercent: 0, // Would come from portfolio tracker in production
        sharpeRatio: 0, // Would come from analytics in production
        avgCoherence,
        hallucinationRate,
        disciplineRate,
        calibrationScore: calibration.score,
        tradeCount: totalTrades,
      });
    } catch {
      inputs.push({
        agentId: agent.agentId,
        agentName: agent.name,
        provider: agent.provider,
        model: agent.model,
        pnlPercent: 0,
        sharpeRatio: 0,
        avgCoherence: 0,
        hallucinationRate: 0,
        disciplineRate: 0,
        calibrationScore: 0.5,
        tradeCount: 0,
      });
    }
  }

  return inputs;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /scorecard — Full benchmark scorecard
 */
benchmarkScoringRoutes.get("/scorecard", async (c) => {
  const forceRefresh = c.req.query("refresh") === "true";

  if (!forceRefresh) {
    const cached = getCachedScorecard();
    if (cached) {
      return c.json({ ok: true, scorecard: cached, source: "cache" });
    }
  }

  const inputs = await gatherAgentInputs();
  const scorecard = computeBenchmarkScorecard(inputs);
  setCachedScorecard(scorecard);

  return c.json({ ok: true, scorecard });
});

/**
 * GET /scorecard/:agentId — Single agent's score
 */
benchmarkScoringRoutes.get("/scorecard/:agentId", async (c) => {
  const agentId = c.req.param("agentId");

  const cached = getCachedScorecard();
  if (cached) {
    const agent = cached.agents.find((a) => a.agentId === agentId);
    if (agent) {
      return c.json({ ok: true, agent, platformAverages: cached.platformAverages });
    }
  }

  // Compute fresh
  const inputs = await gatherAgentInputs();
  const scorecard = computeBenchmarkScorecard(inputs);
  setCachedScorecard(scorecard);

  const agent = scorecard.agents.find((a) => a.agentId === agentId);
  if (!agent) {
    return c.json({ ok: false, error: "Agent not found" }, 404);
  }

  return c.json({ ok: true, agent, platformAverages: scorecard.platformAverages });
});

/**
 * GET /history/:agentId — Score history for trend visualization
 */
benchmarkScoringRoutes.get("/history/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 200);

  const history = getAgentScoreHistory(agentId, limit);

  return c.json({
    ok: true,
    agentId,
    history,
    total: history.length,
  });
});

/**
 * GET /factors — Factor weight descriptions
 */
benchmarkScoringRoutes.get("/factors", (c) => {
  return c.json({
    ok: true,
    version: "v3",
    factors: [
      { name: "pnl_percent", weight: 0.25, type: "reward", description: "Raw financial return — did the agent make money?" },
      { name: "sharpe_ratio", weight: 0.20, type: "risk", description: "Risk-adjusted return — how much risk was taken for the return?" },
      { name: "reasoning_coherence", weight: 0.20, type: "qualitative", description: "Logic-action alignment — does the reasoning support the trade?" },
      { name: "hallucination_rate", weight: 0.15, type: "safety", description: "Factual accuracy — did the agent fabricate data?" },
      { name: "instruction_discipline", weight: 0.10, type: "reliability", description: "Rule compliance — did the agent respect limits?" },
      { name: "confidence_calibration", weight: 0.10, type: "meta", description: "Self-awareness — is confidence correlated with success?" },
    ],
    gradeScale: [
      "A+ (95+)", "A (90-94)", "A- (85-89)",
      "B+ (80-84)", "B (75-79)", "B- (70-74)",
      "C+ (65-69)", "C (60-64)", "C- (55-59)",
      "D+ (50-54)", "D (45-49)", "D- (40-44)",
      "F (below 40)",
    ],
  });
});

/**
 * GET /correlations — Factor correlation matrix
 */
benchmarkScoringRoutes.get("/correlations", async (c) => {
  const cached = getCachedScorecard();
  if (cached && cached.factorCorrelations.length > 0) {
    return c.json({ ok: true, correlations: cached.factorCorrelations });
  }

  const inputs = await gatherAgentInputs();
  const scorecard = computeBenchmarkScorecard(inputs);
  setCachedScorecard(scorecard);

  return c.json({ ok: true, correlations: scorecard.factorCorrelations });
});

/**
 * GET /grade-distribution — How many agents at each grade level
 */
benchmarkScoringRoutes.get("/grade-distribution", async (c) => {
  const cached = getCachedScorecard();
  const scorecard = cached ?? computeBenchmarkScorecard(await gatherAgentInputs());

  const distribution: Record<string, number> = {};
  for (const agent of scorecard.agents) {
    distribution[agent.grade] = (distribution[agent.grade] ?? 0) + 1;
  }

  return c.json({
    ok: true,
    distribution,
    totalAgents: scorecard.agents.length,
    avgComposite: scorecard.platformAverages["composite"] ?? 0,
  });
});
