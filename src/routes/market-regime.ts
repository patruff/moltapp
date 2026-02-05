/**
 * Market Regime Detection Routes
 *
 * Real-time market regime classification, volatility analysis, sector
 * rotation tracking, and market breadth indicators. Provides deep
 * market context for understanding AI agent trading behavior.
 *
 * Routes:
 *   GET  /api/v1/market/regime                  — Current market regime
 *   GET  /api/v1/market/regime/history          — Regime change timeline
 *   GET  /api/v1/market/regime/correlation      — Agent performance vs regime
 *   GET  /api/v1/market/volatility              — Volatility analysis & fear gauge
 *   GET  /api/v1/market/breadth                 — Market breadth indicators
 *   GET  /api/v1/market/sectors                 — Sector rotation analysis
 *   GET  /api/v1/market/dashboard               — Full market intelligence dashboard
 */

import { Hono } from "hono";
import {
  detectCurrentRegime,
  getRegimeHistory,
  getRegimeAgentCorrelation,
  getVolatilityAnalysis,
  getMarketBreadth,
  getSectorRotation,
} from "../services/market-regime.ts";
import { parseQueryInt } from "../lib/query-params.js";

export const marketRegimeRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET /market/dashboard — Full market intelligence dashboard
// ---------------------------------------------------------------------------

marketRegimeRoutes.get("/dashboard", async (c) => {
  try {
    const [regime, volatility, breadth, sectors] = await Promise.all([
      detectCurrentRegime(),
      getVolatilityAnalysis(),
      getMarketBreadth(),
      getSectorRotation(),
    ]);

    return c.json({
      dashboard: {
        regime,
        volatility: {
          index: volatility.marketVolatilityIndex,
          fearGreed: volatility.fearGreedGauge,
          regime: volatility.volatilityRegime,
        },
        breadth: {
          advanceDeclineRatio: breadth.advanceDeclineRatio,
          signal: breadth.overallBreadthSignal,
          interpretation: breadth.interpretation,
        },
        sectors: {
          leadingSector: sectors.leadingSector,
          laggingSector: sectors.laggingSector,
          rotationPhase: sectors.rotationPhase,
          sectorCount: sectors.sectors.length,
        },
        generatedAt: new Date().toISOString(),
      },
      description: "Complete market intelligence dashboard combining regime classification, volatility analysis, breadth indicators, and sector rotation.",
    });
  } catch (error) {
    console.error("[MarketRegime] Dashboard error:", error);
    return c.json(
      {
        error: "market_error",
        code: "dashboard_failed",
        details: error instanceof Error ? error.message : "Failed to generate dashboard",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /market/regime — Current market regime classification
// ---------------------------------------------------------------------------

marketRegimeRoutes.get("/regime", async (c) => {
  try {
    const regime = await detectCurrentRegime();

    return c.json({
      regime,
      description: `Current regime: ${regime.currentRegime.replace(/_/g, " ").toUpperCase()} (${regime.regimeConfidence}% confidence). ${regime.interpretation}`,
    });
  } catch (error) {
    console.error("[MarketRegime] Regime detection error:", error);
    return c.json(
      {
        error: "market_error",
        code: "regime_failed",
        details: error instanceof Error ? error.message : "Failed to detect regime",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /market/regime/history — Regime change timeline
// ---------------------------------------------------------------------------

marketRegimeRoutes.get("/regime/history", async (c) => {
  try {
    const days = parseQueryInt(c.req.query("days"), 90, 7, 365);

    const history = await getRegimeHistory(days);

    return c.json({
      history,
      period: `${days} days`,
      regimeCount: history.length,
      currentRegime: history.length > 0 ? history[0].regime : "unknown",
      description: `Market regime timeline over ${days} days. ${history.length} regime period(s) identified.`,
    });
  } catch (error) {
    console.error("[MarketRegime] History error:", error);
    return c.json(
      {
        error: "market_error",
        code: "history_failed",
        details: error instanceof Error ? error.message : "Failed to compute regime history",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /market/regime/correlation — Agent performance by regime
// ---------------------------------------------------------------------------

marketRegimeRoutes.get("/regime/correlation", async (c) => {
  try {
    const correlation = await getRegimeAgentCorrelation();

    return c.json({
      correlation,
      description: "Cross-reference of AI agent performance in each market regime. Shows which agent excels in which conditions.",
    });
  } catch (error) {
    console.error("[MarketRegime] Correlation error:", error);
    return c.json(
      {
        error: "market_error",
        code: "correlation_failed",
        details: error instanceof Error ? error.message : "Failed to compute correlation",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /market/volatility — Volatility analysis and fear gauge
// ---------------------------------------------------------------------------

marketRegimeRoutes.get("/volatility", async (c) => {
  try {
    const analysis = await getVolatilityAnalysis();

    return c.json({
      volatility: analysis,
      description: `Market Volatility Index: ${analysis.marketVolatilityIndex}/100. Fear/Greed Gauge: ${analysis.fearGreedGauge.label} (${analysis.fearGreedGauge.value}/100). ${analysis.fearGreedGauge.interpretation}`,
    });
  } catch (error) {
    console.error("[MarketRegime] Volatility error:", error);
    return c.json(
      {
        error: "market_error",
        code: "volatility_failed",
        details: error instanceof Error ? error.message : "Failed to compute volatility",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /market/breadth — Market breadth indicators
// ---------------------------------------------------------------------------

marketRegimeRoutes.get("/breadth", async (c) => {
  try {
    const breadth = await getMarketBreadth();

    return c.json({
      breadth,
      description: `Market Breadth: ${breadth.advancingStocks} advancing, ${breadth.decliningStocks} declining. A/D Ratio: ${breadth.advanceDeclineRatio.toFixed(2)}. Signal: ${breadth.overallBreadthSignal.toUpperCase()}.`,
    });
  } catch (error) {
    console.error("[MarketRegime] Breadth error:", error);
    return c.json(
      {
        error: "market_error",
        code: "breadth_failed",
        details: error instanceof Error ? error.message : "Failed to compute breadth",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /market/sectors — Sector rotation analysis
// ---------------------------------------------------------------------------

marketRegimeRoutes.get("/sectors", async (c) => {
  try {
    const sectors = await getSectorRotation();

    return c.json({
      sectors,
      description: `Sector Rotation: ${sectors.rotationPhase} phase (${sectors.rotationConfidence}% confidence). Leading: ${sectors.leadingSector}. Lagging: ${sectors.laggingSector}. ${sectors.recommendation}`,
    });
  } catch (error) {
    console.error("[MarketRegime] Sectors error:", error);
    return c.json(
      {
        error: "market_error",
        code: "sectors_failed",
        details: error instanceof Error ? error.message : "Failed to compute sector rotation",
      },
      500,
    );
  }
});
