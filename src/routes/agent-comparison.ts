/**
 * Agent Comparison API Routes
 *
 * Deep head-to-head analytics and performance comparison for AI agents.
 * Provides rankings, head-to-head matchups, risk metrics, and style analysis.
 *
 * Endpoints:
 * - GET /            — Full comparison report (all agents)
 * - GET /snapshot/:agentId — Individual agent performance snapshot
 * - GET /head-to-head/:agent1/:agent2 — Head-to-head matchup
 * - GET /rankings     — Multi-factor rankings
 * - GET /insights     — AI-generated performance insights
 */

import { Hono } from "hono";
import {
  generateComparisonReport,
  buildAgentSnapshot,
  compareHeadToHead,
  getStoredRoundCount,
} from "../services/agent-comparison.ts";

const app = new Hono();

/**
 * GET / — Full comparison report
 *
 * Returns comprehensive comparison of all 3 AI agents including:
 * - Individual snapshots (P&L, win rate, risk metrics, style)
 * - Multi-factor rankings
 * - Head-to-head matchups
 * - Performance insights
 */
app.get("/", (c) => {
  const report = generateComparisonReport();
  return c.json(report);
});

/**
 * GET /snapshot/:agentId — Individual agent snapshot
 *
 * Deep performance analysis for a single agent.
 */
app.get("/snapshot/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const agentNames: Record<string, string> = {
    "claude-trader": "Claude Trader",
    "gpt-trader": "GPT Trader",
    "grok-trader": "Grok Trader",
  };

  const agentName = agentNames[agentId];
  if (!agentName) {
    return c.json(
      { error: `Unknown agent: ${agentId}. Valid: ${Object.keys(agentNames).join(", ")}` },
      404,
    );
  }

  const snapshot = buildAgentSnapshot(agentId, agentName);
  return c.json(snapshot);
});

/**
 * GET /head-to-head/:agent1/:agent2 — Head-to-head comparison
 *
 * Compares two agents on rounds where both traded.
 */
app.get("/head-to-head/:agent1/:agent2", (c) => {
  const agent1 = c.req.param("agent1");
  const agent2 = c.req.param("agent2");

  const agentNames: Record<string, string> = {
    "claude-trader": "Claude Trader",
    "gpt-trader": "GPT Trader",
    "grok-trader": "Grok Trader",
  };

  if (!agentNames[agent1] || !agentNames[agent2]) {
    return c.json(
      { error: "Unknown agent IDs. Valid: claude-trader, gpt-trader, grok-trader" },
      400,
    );
  }

  if (agent1 === agent2) {
    return c.json({ error: "Cannot compare an agent with itself" }, 400);
  }

  const result = compareHeadToHead(
    agent1,
    agentNames[agent1],
    agent2,
    agentNames[agent2],
  );
  return c.json(result);
});

/**
 * GET /rankings — Multi-factor rankings
 *
 * Returns agents ranked by various metrics.
 */
app.get("/rankings", (c) => {
  const report = generateComparisonReport();
  return c.json({
    roundsAnalyzed: report.roundsAnalyzed,
    rankings: report.rankings,
  });
});

/**
 * GET /insights — Performance insights
 *
 * Returns AI-generated insights about agent performance and competition dynamics.
 */
app.get("/insights", (c) => {
  const report = generateComparisonReport();
  return c.json({
    roundsAnalyzed: report.roundsAnalyzed,
    insights: report.insights,
    generatedAt: report.generatedAt,
  });
});

/**
 * GET /stats — Quick stats about comparison data
 */
app.get("/stats", (c) => {
  return c.json({
    storedRounds: getStoredRoundCount(),
    agents: ["claude-trader", "gpt-trader", "grok-trader"],
    status: "ready",
  });
});

export const agentComparisonRoutes = app;
