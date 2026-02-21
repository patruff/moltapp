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
import { errorMessage } from "../lib/errors.ts";
import { getAgentConfig, getAgentConfigs } from "../agents/orchestrator.ts";
import { parseQueryInt } from "../lib/query-params.js";
import { clamp, findMax, findMin } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Backtest Route Constants
// ---------------------------------------------------------------------------

/**
 * ISO date string slice length to extract YYYY-MM-DD format.
 * new Date().toISOString() produces "2025-01-23T10:30:00.000Z";
 * slicing 10 characters gives "2025-01-23" (date only, no time component).
 * Used for startDate/endDate parameters passed to backtesting service.
 */
const ISO_DATE_SLICE_LENGTH = 10;

/**
 * Milliseconds per calendar day.
 * Formula: 24 hours × 60 minutes × 60 seconds × 1000 ms = 86,400,000 ms.
 * Used to compute startDate from: Date.now() - days × MS_PER_DAY.
 * Example: 90 days × 86,400,000 = 7,776,000,000 ms = 90 days ago.
 */
const MS_PER_DAY = 86_400_000;

/**
 * Default number of days for backtest lookback window.
 * 90 days (~3 months) balances statistical significance with recency.
 * Agents trade ~2x per day, so 90 days = ~180 decision data points.
 */
const BACKTEST_DEFAULT_DAYS = 90;

/**
 * Minimum allowed backtest lookback period in days.
 * 7 days (1 week) is the minimum for any meaningful performance analysis.
 * Shorter periods have too few trades for reliable Sharpe/win-rate calculations.
 */
const BACKTEST_MIN_DAYS = 7;

/**
 * Maximum allowed backtest lookback period in days.
 * 365 days (1 year) caps API query cost and prevents excessive data aggregation.
 * Beyond 1 year, agent strategy drift makes historical comparison less meaningful.
 */
const BACKTEST_MAX_DAYS = 365;

/**
 * Default initial capital for backtest simulation in USD.
 * $10,000 is a standard retail investor starting portfolio size.
 * Matches BENCHMARK_INITIAL_PORTFOLIO_VALUE used in benchmark-tracker.ts.
 */
const BACKTEST_DEFAULT_CAPITAL = 10_000;

/**
 * Minimum allowed initial capital for backtest simulation in USD.
 * $1,000 floor ensures position sizing math doesn't produce sub-cent amounts.
 */
const BACKTEST_MIN_CAPITAL = 1_000;

/**
 * Maximum allowed initial capital for backtest simulation in USD.
 * $1,000,000 cap prevents unrealistically large portfolios that skew metrics.
 */
const BACKTEST_MAX_CAPITAL = 1_000_000;

export const backtestRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET /backtest/compare — Compare all agents (must be before /:agentId)
// ---------------------------------------------------------------------------

backtestRoutes.get("/compare", async (c) => {
  try {
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
        details: errorMessage(error),
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
    const days = parseQueryInt(c.req.query("days"), BACKTEST_DEFAULT_DAYS, BACKTEST_MIN_DAYS, BACKTEST_MAX_DAYS);
    const capitalStr = c.req.query("capital");
    const capital = capitalStr
      ? clamp(parseFloat(capitalStr) || BACKTEST_DEFAULT_CAPITAL, BACKTEST_MIN_CAPITAL, BACKTEST_MAX_CAPITAL)
      : BACKTEST_DEFAULT_CAPITAL;

    const endDate = new Date().toISOString().slice(0, ISO_DATE_SLICE_LENGTH);
    const startDate = new Date(Date.now() - days * MS_PER_DAY).toISOString().slice(0, ISO_DATE_SLICE_LENGTH);

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
        details: errorMessage(error),
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
    const days = parseQueryInt(c.req.query("days"), BACKTEST_DEFAULT_DAYS, BACKTEST_MIN_DAYS, BACKTEST_MAX_DAYS);

    const curve = await generateEquityCurve(agentId, days);

    return c.json({
      agentId,
      agentName: config.name,
      equityCurve: curve,
      dataPoints: curve.length,
      period: `${days} days`,
      startEquity: curve.length > 0 ? curve[0].equity : BACKTEST_DEFAULT_CAPITAL,
      endEquity: curve.length > 0 ? curve[curve.length - 1].equity : BACKTEST_DEFAULT_CAPITAL,
      peakEquity: findMax(curve, 'equity')?.equity ?? BACKTEST_DEFAULT_CAPITAL,
      maxDrawdown: findMin(curve, 'drawdown')?.drawdown ?? 0,
    });
  } catch (error) {
    console.error(`[Backtest] Equity curve error for ${agentId}:`, error);
    return c.json(
      {
        error: "backtest_error",
        code: "equity_failed",
        details: errorMessage(error),
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
        details: errorMessage(error),
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
        details: errorMessage(error),
      },
      500,
    );
  }
});
