/**
 * Backtesting Routes
 *
 * Strategy backtesting endpoints for simulating agent performance against
 * historical data. Provides equity curves, performance metrics, trade logs,
 * and cross-agent strategy comparison.
 *
 * Routes:
 *   GET  /api/v1/backtest/:agentId              — Run backtest for an agent
 *   GET  /api/v1/backtest/:agentId/equity       — Equity curve data
 *   GET  /api/v1/backtest/:agentId/strategy     — Strategy breakdown
 *   GET  /api/v1/backtest/:agentId/performance  — Period-based performance
 *   GET  /api/v1/backtest/compare               — Compare all agents' backtests
 */

import { Hono } from "hono";
import {
  runBacktest,
  getBacktestComparison,
  generateEquityCurve,
  getStrategyBreakdown,
  getHistoricalPerformance,
} from "../services/backtesting.ts";
import { getAgentConfig, getAgentConfigs } from "../agents/orchestrator.ts";

export const backtestRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET /backtest/compare — Compare all agents (must be before /:agentId)
// ---------------------------------------------------------------------------

backtestRoutes.get("/compare", async (c) => {
  try {
    const daysStr = c.req.query("days");
    const days = daysStr ? Math.min(365, Math.max(7, parseInt(daysStr, 10) || 90)) : 90;

    const comparison = await getBacktestComparison();

    return c.json({
      comparison,
      description:
        "Side-by-side backtest comparison of all 3 AI trading agents over the same period. Metrics include Sharpe ratio, win rate, max drawdown, and more.",
    });
  } catch (error) {
    console.error("[Backtest] Comparison error:", error);
    return c.json(
      {
        error: "backtest_error",
        code: "comparison_failed",
        details: error instanceof Error ? error.message : "Failed to compare agents",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /backtest/:agentId — Run full backtest
// ---------------------------------------------------------------------------

backtestRoutes.get("/:agentId", async (c) => {
  const agentId = c.req.param("agentId");
  const config = getAgentConfig(agentId);

  if (!config) {
    return c.json(
      {
        error: "agent_not_found",
        code: "agent_not_found",
        details: `No agent with ID "${agentId}". Valid IDs: ${getAgentConfigs().map((c) => c.agentId).join(", ")}`,
      },
      404,
    );
  }

  try {
    const daysStr = c.req.query("days");
    const capitalStr = c.req.query("capital");
    const days = daysStr ? Math.min(365, Math.max(7, parseInt(daysStr, 10) || 90)) : 90;
    const capital = capitalStr ? Math.min(1000000, Math.max(1000, parseFloat(capitalStr) || 10000)) : 10000;

    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

    const result = await runBacktest({
      agentId,
      startDate,
      endDate,
      initialCapital: capital,
    });

    return c.json({
      backtest: result,
      description: `Backtest results for ${config.name} over ${days} days with $${capital.toLocaleString()} initial capital.`,
    });
  } catch (error) {
    console.error(`[Backtest] Error for ${agentId}:`, error);
    return c.json(
      {
        error: "backtest_error",
        code: "backtest_failed",
        details: error instanceof Error ? error.message : "Failed to run backtest",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /backtest/:agentId/equity — Equity curve data
// ---------------------------------------------------------------------------

backtestRoutes.get("/:agentId/equity", async (c) => {
  const agentId = c.req.param("agentId");
  const config = getAgentConfig(agentId);

  if (!config) {
    return c.json(
      { error: "agent_not_found", code: "agent_not_found", details: `Agent "${agentId}" not found` },
      404,
    );
  }

  try {
    const daysStr = c.req.query("days");
    const days = daysStr ? Math.min(365, Math.max(7, parseInt(daysStr, 10) || 90)) : 90;

    const curve = await generateEquityCurve(agentId, days);

    return c.json({
      agentId,
      agentName: config.name,
      equityCurve: curve,
      dataPoints: curve.length,
      period: `${days} days`,
      startEquity: curve.length > 0 ? curve[0].equity : 10000,
      endEquity: curve.length > 0 ? curve[curve.length - 1].equity : 10000,
      peakEquity: curve.length > 0 ? Math.max(...curve.map((p) => p.equity)) : 10000,
      maxDrawdown: curve.length > 0 ? Math.min(...curve.map((p) => p.drawdown)) : 0,
    });
  } catch (error) {
    console.error(`[Backtest] Equity curve error for ${agentId}:`, error);
    return c.json(
      {
        error: "backtest_error",
        code: "equity_failed",
        details: error instanceof Error ? error.message : "Failed to generate equity curve",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /backtest/:agentId/strategy — Strategy breakdown
// ---------------------------------------------------------------------------

backtestRoutes.get("/:agentId/strategy", async (c) => {
  const agentId = c.req.param("agentId");
  const config = getAgentConfig(agentId);

  if (!config) {
    return c.json(
      { error: "agent_not_found", code: "agent_not_found", details: `Agent "${agentId}" not found` },
      404,
    );
  }

  try {
    const strategy = await getStrategyBreakdown(agentId);

    if (!strategy) {
      return c.json(
        {
          error: "no_data",
          code: "no_data",
          details: `No trading data available for ${config.name}`,
        },
        404,
      );
    }

    return c.json({
      strategy,
      description: `Strategy profile for ${config.name}: ${strategy.overallStyle}. Trades ${strategy.tradingFrequency} with ${strategy.avgDecisionsPerDay.toFixed(1)} decisions/day average.`,
    });
  } catch (error) {
    console.error(`[Backtest] Strategy error for ${agentId}:`, error);
    return c.json(
      {
        error: "backtest_error",
        code: "strategy_failed",
        details: error instanceof Error ? error.message : "Failed to analyze strategy",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /backtest/:agentId/performance — Period performance
// ---------------------------------------------------------------------------

backtestRoutes.get("/:agentId/performance", async (c) => {
  const agentId = c.req.param("agentId");
  const config = getAgentConfig(agentId);

  if (!config) {
    return c.json(
      { error: "agent_not_found", code: "agent_not_found", details: `Agent "${agentId}" not found` },
      404,
    );
  }

  try {
    const period = c.req.query("period") ?? "all";
    const validPeriods = ["1w", "1m", "3m", "6m", "all"];
    const safePeriod = validPeriods.includes(period)
      ? (period as "1w" | "1m" | "3m" | "6m" | "all")
      : "all";

    const performance = await getHistoricalPerformance(agentId, safePeriod);

    if (!performance) {
      return c.json(
        { error: "backtest_error", code: "no_performance_data", details: `No performance data for ${agentId}` },
        404,
      );
    }

    return c.json({
      agentId,
      agentName: config.name,
      period: safePeriod,
      performance,
      description: `${config.name} performance over ${safePeriod}: Sharpe ${performance.sharpeRatio.toFixed(2)}, Win Rate ${(performance.winRate * 100).toFixed(1)}%, Max Drawdown ${(performance.maxDrawdownPercent * 100).toFixed(1)}%`,
    });
  } catch (error) {
    console.error(`[Backtest] Performance error for ${agentId}:`, error);
    return c.json(
      {
        error: "backtest_error",
        code: "performance_failed",
        details: error instanceof Error ? error.message : "Failed to compute performance",
      },
      500,
    );
  }
});
