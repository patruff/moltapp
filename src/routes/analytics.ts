/**
 * Portfolio Analytics API Routes
 *
 * Exposes institutional-grade portfolio metrics for each AI agent.
 * Includes Sharpe ratio, max drawdown, win rate, streaks, rolling
 * performance, equity curves, and head-to-head agent comparison.
 */

import { Hono } from "hono";
import {
  calculatePortfolioMetrics,
  calculateRollingPerformance,
  compareAgents,
  generateEquityCurve,
} from "../services/portfolio-analytics.ts";
import { errorMessage } from "../lib/errors.ts";

export const analyticsRoutes = new Hono();

const VALID_AGENTS = ["claude-trader", "gpt-trader", "grok-trader"];

// ---------------------------------------------------------------------------
// Agent Portfolio Metrics
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/analytics/:agentId
 * Full portfolio metrics for a single agent.
 */
analyticsRoutes.get("/:agentId", async (c) => {
  const agentId = c.req.param("agentId");

  if (!VALID_AGENTS.includes(agentId)) {
    return c.json(
      { error: "invalid_agent", message: `Unknown agent: ${agentId}` },
      400,
    );
  }

  try {
    const metrics = await calculatePortfolioMetrics(agentId);
    return c.json({ data: metrics });
  } catch (err) {
    console.error(`[Analytics] Failed to calculate metrics for ${agentId}:`, err);
    return c.json(
      {
        error: "metrics_error",
        message: errorMessage(err),
      },
      500,
    );
  }
});

/**
 * GET /api/v1/analytics/:agentId/rolling
 * Rolling performance (7d, 30d, 90d, all-time) for an agent.
 */
analyticsRoutes.get("/:agentId/rolling", async (c) => {
  const agentId = c.req.param("agentId");

  if (!VALID_AGENTS.includes(agentId)) {
    return c.json(
      { error: "invalid_agent", message: `Unknown agent: ${agentId}` },
      400,
    );
  }

  try {
    const rolling = await calculateRollingPerformance(agentId);
    return c.json({ data: rolling });
  } catch (err) {
    console.error(`[Analytics] Rolling performance error for ${agentId}:`, err);
    return c.json(
      {
        error: "rolling_error",
        message: errorMessage(err),
      },
      500,
    );
  }
});

/**
 * GET /api/v1/analytics/:agentId/equity-curve
 * Equity curve data points for charting.
 */
analyticsRoutes.get("/:agentId/equity-curve", async (c) => {
  const agentId = c.req.param("agentId");

  if (!VALID_AGENTS.includes(agentId)) {
    return c.json(
      { error: "invalid_agent", message: `Unknown agent: ${agentId}` },
      400,
    );
  }

  try {
    const curve = await generateEquityCurve(agentId);
    return c.json({ data: curve });
  } catch (err) {
    console.error(`[Analytics] Equity curve error for ${agentId}:`, err);
    return c.json(
      {
        error: "equity_curve_error",
        message: errorMessage(err),
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// Agent Comparison
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/analytics/compare/all
 * Head-to-head comparison of all 3 agents.
 */
analyticsRoutes.get("/compare/all", async (c) => {
  try {
    const comparison = await compareAgents();
    return c.json({ data: comparison });
  } catch (err) {
    console.error("[Analytics] Agent comparison error:", err);
    return c.json(
      {
        error: "comparison_error",
        message: errorMessage(err),
      },
      500,
    );
  }
});
