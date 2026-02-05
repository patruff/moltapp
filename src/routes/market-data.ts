/**
 * Market Data API Routes
 *
 * Aggregated market data, technical indicators, OHLCV candles,
 * market breadth, and correlation analysis for xStocks.
 */

import { Hono } from "hono";
import { parseQueryInt } from "../lib/query-params.ts";
import {
  fetchAggregatedPrices,
  getMarketSnapshot,
  computeIndicators,
  computeAllIndicators,
  computeMarketBreadth,
  computeCorrelations,
  buildCandles,
  getAggregatorStats,
} from "../services/market-aggregator.ts";

export const marketDataRoutes = new Hono();

// ---------------------------------------------------------------------------
// Market Snapshot
// ---------------------------------------------------------------------------

/**
 * GET /
 * Complete market snapshot: prices, breadth, top movers, indicators.
 */
marketDataRoutes.get("/", async (c) => {
  const snapshot = await getMarketSnapshot();
  return c.json(snapshot);
});

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

/**
 * GET /prices
 * Aggregated prices for all xStocks with VWAP and spread estimates.
 */
marketDataRoutes.get("/prices", async (c) => {
  const prices = await fetchAggregatedPrices();
  return c.json({
    prices,
    count: prices.length,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /prices/:symbol
 * Price data for a specific stock.
 */
marketDataRoutes.get("/prices/:symbol", async (c) => {
  const symbol = c.req.param("symbol");
  const prices = await fetchAggregatedPrices();
  const price = prices.find((p) => p.symbol.toLowerCase() === symbol.toLowerCase());

  if (!price) {
    return c.json({ error: `Stock not found: ${symbol}` }, 404);
  }

  return c.json(price);
});

// ---------------------------------------------------------------------------
// Technical Indicators
// ---------------------------------------------------------------------------

/**
 * GET /indicators
 * Technical indicators for all stocks.
 */
marketDataRoutes.get("/indicators", (c) => {
  const indicators = computeAllIndicators();
  return c.json({
    indicators,
    count: indicators.length,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /indicators/:symbol
 * Technical indicators for a specific stock.
 */
marketDataRoutes.get("/indicators/:symbol", (c) => {
  const symbol = c.req.param("symbol");
  const indicators = computeIndicators(symbol);
  return c.json(indicators);
});

// ---------------------------------------------------------------------------
// OHLCV Candles
// ---------------------------------------------------------------------------

/**
 * GET /candles/:symbol
 * OHLCV candle data for a stock.
 * Query params: ?period=30 (minutes), ?count=48 (number of candles)
 */
marketDataRoutes.get("/candles/:symbol", (c) => {
  const symbol = c.req.param("symbol");
  const period = parseInt(c.req.query("period") ?? "30");
  const count = parseQueryInt(c.req.query("count"), 48, 1, 200);

  const candles = buildCandles(symbol, period, count);

  return c.json({
    symbol,
    period: `${period}m`,
    candles,
    count: candles.length,
  });
});

// ---------------------------------------------------------------------------
// Market Breadth
// ---------------------------------------------------------------------------

/**
 * GET /breadth
 * Market-wide breadth analysis: advance/decline, regime classification.
 */
marketDataRoutes.get("/breadth", (c) => {
  return c.json(computeMarketBreadth());
});

// ---------------------------------------------------------------------------
// Correlations
// ---------------------------------------------------------------------------

/**
 * GET /correlations
 * Pairwise correlations between stock returns.
 */
marketDataRoutes.get("/correlations", (c) => {
  const correlations = computeCorrelations();
  return c.json({
    correlations,
    count: correlations.length,
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// Aggregator Health
// ---------------------------------------------------------------------------

/**
 * GET /health
 * Aggregator health and data quality stats.
 */
marketDataRoutes.get("/health", (c) => {
  return c.json(getAggregatorStats());
});
