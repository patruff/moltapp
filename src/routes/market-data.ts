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
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Default candle period in minutes when not specified by the caller.
 * 30-minute candles balance granularity with readability for intraday analysis.
 * Allowed range: 1–1440 minutes (1 minute to 1 full trading day).
 */
const DEFAULT_CANDLE_PERIOD_MINUTES = 30;

/**
 * Default number of candles to return when not specified by the caller.
 * 48 candles × 30-minute period = 24 hours of intraday history.
 * Allowed range: 1–200 candles.
 */
const DEFAULT_CANDLE_COUNT = 48;

/**
 * Maximum number of candles allowed per request.
 * Caps response size to prevent excessive computation and payload size.
 */
const MAX_CANDLE_COUNT = 200;

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
  const period = parseQueryInt(c.req.query("period"), DEFAULT_CANDLE_PERIOD_MINUTES, 1, 1440);
  const count = parseQueryInt(c.req.query("count"), DEFAULT_CANDLE_COUNT, 1, MAX_CANDLE_COUNT);

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
