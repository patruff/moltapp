/**
 * Agent Performance API Routes
 *
 * Rich performance analytics for AI trading agents. Powers the leaderboard,
 * agent profile pages, and head-to-head comparison features.
 */

import { Hono } from "hono";
import {
  computeAgentPerformance,
  computeLeaderboard,
  compareAgents,
} from "../services/performance-tracker.ts";
import { getAgentConfigs } from "../agents/orchestrator.ts";

export const performanceRoutes = new Hono();

// ---------------------------------------------------------------------------
// Agent Performance
// ---------------------------------------------------------------------------

/**
 * GET /
 * Overview of all agent performance metrics.
 */
performanceRoutes.get("/", async (c) => {
  const agents = getAgentConfigs();
  const agentIds = agents.map((a) => a.agentId);

  const performances = await Promise.all(
    agentIds.map((id) => computeAgentPerformance(id)),
  );

  return c.json({
    agents: performances.map((perf) => {
      const config = agents.find((a) => a.agentId === perf.agentId);
      return {
        agentId: perf.agentId,
        name: config?.name ?? perf.agentId,
        model: config?.model ?? "unknown",
        provider: config?.provider ?? "unknown",
        summary: perf.summary,
        winRate: perf.trading.winRate,
        totalTrades: perf.trading.totalTrades,
        sharpeRatio: perf.risk.sharpeRatio,
        currentStreak: perf.trading.currentStreak,
      };
    }),
    computedAt: new Date().toISOString(),
  });
});

/**
 * GET /leaderboard
 * Competitive leaderboard ranked by P&L.
 */
performanceRoutes.get("/leaderboard", async (c) => {
  const agents = getAgentConfigs();
  const agentIds = agents.map((a) => a.agentId);
  const leaderboard = await computeLeaderboard(agentIds);

  return c.json({
    leaderboard: leaderboard.map((entry) => {
      const config = agents.find((a) => a.agentId === entry.agentId);
      return {
        ...entry,
        name: config?.name ?? entry.agentId,
        model: config?.model ?? "unknown",
        provider: config?.provider ?? "unknown",
      };
    }),
    computedAt: new Date().toISOString(),
  });
});

/**
 * GET /compare
 * Head-to-head comparison of agents across key metrics.
 * Query param: ?agents=agent1,agent2,agent3
 */
performanceRoutes.get("/compare", async (c) => {
  const agentsParam = c.req.query("agents");
  const allAgents = getAgentConfigs();
  const agentIds = agentsParam
    ? agentsParam.split(",").filter((id) => allAgents.some((a) => a.agentId === id))
    : allAgents.map((a) => a.agentId);

  if (agentIds.length < 2) {
    return c.json({ error: "Need at least 2 agents to compare" }, 400);
  }

  const comparison = await compareAgents(agentIds);

  return c.json({
    agents: agentIds.map((id) => {
      const config = allAgents.find((a) => a.agentId === id);
      return { agentId: id, name: config?.name, model: config?.model };
    }),
    metrics: comparison,
    computedAt: new Date().toISOString(),
  });
});

/**
 * GET /:agentId
 * Full performance metrics for a specific agent.
 */
performanceRoutes.get("/:agentId", async (c) => {
  const agentId = c.req.param("agentId");
  const agents = getAgentConfigs();
  const config = agents.find((a) => a.agentId === agentId);

  if (!config) {
    return c.json({ error: `Agent not found: ${agentId}` }, 404);
  }

  const performance = await computeAgentPerformance(agentId);

  return c.json({
    agent: {
      agentId: config.agentId,
      name: config.name,
      model: config.model,
      provider: config.provider,
      description: config.description,
      personality: config.personality,
      riskTolerance: config.riskTolerance,
      tradingStyle: config.tradingStyle,
    },
    performance,
  });
});

/**
 * GET /:agentId/risk
 * Risk metrics for a specific agent.
 */
performanceRoutes.get("/:agentId/risk", async (c) => {
  const agentId = c.req.param("agentId");
  const agents = getAgentConfigs();
  if (!agents.find((a) => a.agentId === agentId)) {
    return c.json({ error: `Agent not found: ${agentId}` }, 404);
  }

  const performance = await computeAgentPerformance(agentId);
  return c.json({
    agentId,
    risk: performance.risk,
    computedAt: performance.computedAt,
  });
});

/**
 * GET /:agentId/stocks
 * Per-stock performance breakdown for a specific agent.
 */
performanceRoutes.get("/:agentId/stocks", async (c) => {
  const agentId = c.req.param("agentId");
  const agents = getAgentConfigs();
  if (!agents.find((a) => a.agentId === agentId)) {
    return c.json({ error: `Agent not found: ${agentId}` }, 404);
  }

  const performance = await computeAgentPerformance(agentId);
  return c.json({
    agentId,
    stocks: performance.byStock,
    computedAt: performance.computedAt,
  });
});

/**
 * GET /:agentId/returns
 * Rolling returns for a specific agent.
 */
performanceRoutes.get("/:agentId/returns", async (c) => {
  const agentId = c.req.param("agentId");
  const agents = getAgentConfigs();
  if (!agents.find((a) => a.agentId === agentId)) {
    return c.json({ error: `Agent not found: ${agentId}` }, 404);
  }

  const performance = await computeAgentPerformance(agentId);
  return c.json({
    agentId,
    returns: performance.returns,
    trading: performance.trading,
    computedAt: performance.computedAt,
  });
});

/**
 * GET /:agentId/decisions
 * Decision quality metrics for a specific agent.
 */
performanceRoutes.get("/:agentId/decisions", async (c) => {
  const agentId = c.req.param("agentId");
  const agents = getAgentConfigs();
  if (!agents.find((a) => a.agentId === agentId)) {
    return c.json({ error: `Agent not found: ${agentId}` }, 404);
  }

  const performance = await computeAgentPerformance(agentId);
  return c.json({
    agentId,
    decisions: performance.decisions,
    computedAt: performance.computedAt,
  });
});
