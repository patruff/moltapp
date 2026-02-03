/**
 * Monte Carlo Simulation API Routes
 *
 * Exposes endpoints for running Monte Carlo simulations on agent
 * trading strategies to forecast potential outcomes.
 */

import { Hono } from "hono";
import {
  runMonteCarloSimulation,
  runComparativeSimulation,
  getSimulationMetrics,
  type MonteCarloConfig,
} from "../services/monte-carlo-backtester.ts";

export const monteCarloRoutes = new Hono();

/**
 * GET /simulate/:agentId — Run Monte Carlo simulation for a single agent.
 *
 * Query params:
 * - simulations: number of simulations (default 1000)
 * - horizon: horizon in days (default 30)
 * - capital: initial capital (default 10000)
 * - confidence: confidence level 0-1 (default 0.95)
 */
monteCarloRoutes.get("/simulate/:agentId", async (c) => {
  const agentId = c.req.param("agentId");

  const config: Partial<MonteCarloConfig> = {};
  const sims = c.req.query("simulations");
  if (sims) config.numSimulations = parseInt(sims, 10);
  const horizon = c.req.query("horizon");
  if (horizon) config.horizonDays = parseInt(horizon, 10);
  const capital = c.req.query("capital");
  if (capital) config.initialCapital = parseFloat(capital);
  const confidence = c.req.query("confidence");
  if (confidence) config.confidenceLevel = parseFloat(confidence);

  try {
    const report = runMonteCarloSimulation(agentId, config);
    if (!report) {
      return c.json(
        {
          error: "insufficient_data",
          message: `Not enough historical trade data for agent ${agentId}. Need at least 5 trades.`,
        },
        400,
      );
    }
    return c.json(report);
  } catch (err) {
    return c.json(
      {
        error: "simulation_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }
});

/**
 * GET /compare — Run Monte Carlo for all 3 agents and compare.
 */
monteCarloRoutes.get("/compare", async (c) => {
  const config: Partial<MonteCarloConfig> = {};
  const sims = c.req.query("simulations");
  if (sims) config.numSimulations = parseInt(sims, 10);
  const horizon = c.req.query("horizon");
  if (horizon) config.horizonDays = parseInt(horizon, 10);

  try {
    const comparison = runComparativeSimulation(config);
    return c.json(comparison);
  } catch (err) {
    return c.json(
      {
        error: "comparison_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }
});

/**
 * GET /metrics — Simulation service metrics.
 */
monteCarloRoutes.get("/metrics", (c) => {
  return c.json(getSimulationMetrics());
});
