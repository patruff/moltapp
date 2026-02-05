/**
 * Signal Intelligence Routes
 *
 * Real-time market signals and technical analysis endpoints. Provides
 * structured, actionable intelligence from technical indicators and
 * cross-agent consensus analysis.
 *
 * Routes:
 *   GET  /api/v1/signals                  — Full signal dashboard
 *   GET  /api/v1/signals/active           — All active signals sorted by strength
 *   GET  /api/v1/signals/stock/:symbol    — Technical indicators for a stock
 *   GET  /api/v1/signals/consensus        — Cross-agent consensus data
 *   GET  /api/v1/signals/trending         — Trending stocks by signal density
 *   GET  /api/v1/signals/alerts           — High-priority alerts only
 */

import { Hono } from "hono";
import {
  getSignalDashboard,
  getAllSignals,
  getStockIndicators,
  getAgentConsensusData,
} from "../services/signals.ts";
import { parseQueryInt } from "../lib/query-params.js";

export const signalRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET /signals — Full signal intelligence dashboard
// ---------------------------------------------------------------------------

signalRoutes.get("/", async (c) => {
  try {
    const dashboard = await getSignalDashboard();

    return c.json({
      status: "ok",
      dashboard,
      description:
        "Real-time signal intelligence dashboard with technical indicators, agent consensus, and actionable alerts.",
    });
  } catch (error) {
    console.error("[Signals] Dashboard error:", error);
    return c.json(
      {
        error: "signal_error",
        code: "signal_dashboard_failed",
        details:
          error instanceof Error ? error.message : "Failed to generate signals",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /signals/active — All active signals
// ---------------------------------------------------------------------------

signalRoutes.get("/active", async (c) => {
  try {
    const directionFilter = c.req.query("direction"); // bullish, bearish, neutral
    const typeFilter = c.req.query("type"); // signal type
    const minStrength = parseQueryInt(c.req.query("min_strength"), 0, 0);
    const limit = parseQueryInt(c.req.query("limit"), 50, 1, 100);

    let signals = await getAllSignals();

    // Apply filters
    if (
      directionFilter &&
      ["bullish", "bearish", "neutral"].includes(directionFilter)
    ) {
      signals = signals.filter((s) => s.direction === directionFilter);
    }
    if (typeFilter) {
      signals = signals.filter((s) => s.type === typeFilter);
    }
    if (minStrength > 0) {
      signals = signals.filter((s) => s.strength >= minStrength);
    }

    const total = signals.length;
    signals = signals.slice(0, limit);

    return c.json({
      signals,
      total,
      returned: signals.length,
      filters: {
        direction: directionFilter ?? "all",
        type: typeFilter ?? "all",
        minStrength,
        limit,
      },
    });
  } catch (error) {
    console.error("[Signals] Active signals error:", error);
    return c.json(
      {
        error: "signal_error",
        code: "active_signals_failed",
        details:
          error instanceof Error
            ? error.message
            : "Failed to fetch active signals",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /signals/stock/:symbol — Technical indicators for a specific stock
// ---------------------------------------------------------------------------

signalRoutes.get("/stock/:symbol", async (c) => {
  const symbol = c.req.param("symbol");

  try {
    const indicators = await getStockIndicators(symbol);

    if (!indicators) {
      return c.json(
        {
          error: "stock_not_found",
          code: "stock_not_found",
          details: `No data available for symbol "${symbol}". Try AAPLx, NVDAx, TSLAx, etc.`,
        },
        404,
      );
    }

    // Also get signals specific to this stock
    const allSignals = await getAllSignals();
    const stockSignals = allSignals.filter(
      (s) => s.symbol.toLowerCase() === symbol.toLowerCase(),
    );

    return c.json({
      indicators,
      signals: stockSignals,
      signalCount: stockSignals.length,
      recommendation: indicators.overallSignal,
    });
  } catch (error) {
    console.error(`[Signals] Stock indicators error for ${symbol}:`, error);
    return c.json(
      {
        error: "signal_error",
        code: "stock_indicators_failed",
        details:
          error instanceof Error
            ? error.message
            : "Failed to compute indicators",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /signals/consensus — Cross-agent consensus analysis
// ---------------------------------------------------------------------------

signalRoutes.get("/consensus", async (c) => {
  try {
    const consensus = await getAgentConsensusData();

    // Summary stats
    const bullishConsensus = consensus.filter(
      (c) => c.consensusDirection === "bullish",
    );
    const bearishConsensus = consensus.filter(
      (c) => c.consensusDirection === "bearish",
    );
    const splitConsensus = consensus.filter(
      (c) => c.consensusDirection === "split",
    );

    return c.json({
      consensus,
      summary: {
        totalStocks: consensus.length,
        bullishStocks: bullishConsensus.length,
        bearishStocks: bearishConsensus.length,
        splitStocks: splitConsensus.length,
        avgAgreement:
          consensus.length > 0
            ? Math.round(
                (consensus.reduce((s, c) => s + c.agreementRate, 0) /
                  consensus.length) *
                  10,
              ) / 10
            : 0,
        avgConfidence:
          consensus.length > 0
            ? Math.round(
                (consensus.reduce((s, c) => s + c.averageConfidence, 0) /
                  consensus.length) *
                  10,
              ) / 10
            : 0,
      },
      description:
        "Cross-agent consensus analysis showing how the 3 AI agents align on each stock.",
    });
  } catch (error) {
    console.error("[Signals] Consensus error:", error);
    return c.json(
      {
        error: "signal_error",
        code: "consensus_failed",
        details:
          error instanceof Error
            ? error.message
            : "Failed to compute consensus",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /signals/trending — Stocks with highest signal activity
// ---------------------------------------------------------------------------

signalRoutes.get("/trending", async (c) => {
  try {
    const dashboard = await getSignalDashboard();

    return c.json({
      trending: dashboard.trendingStocks,
      volatilityIndex: dashboard.volatilityIndex,
      marketSentiment: dashboard.marketSentiment,
      signalDistribution: dashboard.signalsByType,
    });
  } catch (error) {
    console.error("[Signals] Trending error:", error);
    return c.json(
      {
        error: "signal_error",
        code: "trending_failed",
        details:
          error instanceof Error
            ? error.message
            : "Failed to compute trending stocks",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /signals/alerts — High-priority alerts only (strength >= 70)
// ---------------------------------------------------------------------------

signalRoutes.get("/alerts", async (c) => {
  try {
    const signals = await getAllSignals();
    const alerts = signals.filter((s) => s.strength >= 70);

    return c.json({
      alerts,
      count: alerts.length,
      criticalCount: alerts.filter((s) => s.strength >= 90).length,
      description:
        "High-priority market alerts — signals with strength >= 70/100.",
    });
  } catch (error) {
    console.error("[Signals] Alerts error:", error);
    return c.json(
      {
        error: "signal_error",
        code: "alerts_failed",
        details:
          error instanceof Error
            ? error.message
            : "Failed to fetch alerts",
      },
      500,
    );
  }
});
