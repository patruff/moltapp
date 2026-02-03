/**
 * Real-Time Price API Routes
 *
 * Exposes the real-time price streaming service via HTTP endpoints.
 */

import { Hono } from "hono";
import {
  getPrice,
  getAllPrices,
  getPrices,
  getAggregatedPrice,
  getPriceHistory,
  getPriceStreamMetrics,
  startPriceStream,
  stopPriceStream,
  resetVwap,
  injectPrice,
} from "../services/realtime-prices.ts";

export const realtimePriceRoutes = new Hono();

/** GET /prices — get all current prices */
realtimePriceRoutes.get("/prices", (c) => {
  return c.json({
    prices: getAllPrices(),
    metrics: getPriceStreamMetrics(),
    fetchedAt: new Date().toISOString(),
  });
});

/** GET /prices/:symbol — get price for a specific symbol */
realtimePriceRoutes.get("/prices/:symbol", (c) => {
  const symbol = c.req.param("symbol");
  const price = getPrice(symbol);

  if (!price) {
    return c.json({ error: `No price available for ${symbol}` }, 404);
  }

  return c.json(price);
});

/** GET /prices/:symbol/aggregate — get aggregated multi-source price */
realtimePriceRoutes.get("/prices/:symbol/aggregate", (c) => {
  const symbol = c.req.param("symbol");
  const price = getAggregatedPrice(symbol);

  if (!price) {
    return c.json({ error: `No aggregated price for ${symbol}` }, 404);
  }

  return c.json(price);
});

/** GET /prices/:symbol/history — get price history */
realtimePriceRoutes.get("/prices/:symbol/history", (c) => {
  const symbol = c.req.param("symbol");
  const limit = parseInt(c.req.query("limit") ?? "50", 10);
  const history = getPriceHistory(symbol, limit);

  return c.json({ symbol, history, count: history.length });
});

/** POST /prices/batch — get prices for multiple symbols */
realtimePriceRoutes.post("/prices/batch", async (c) => {
  const body = (await c.req.json()) as { symbols?: string[] };
  const symbols = body.symbols ?? [];
  const prices = getPrices(symbols);

  return c.json({ prices, count: prices.length });
});

/** GET /stream/metrics — get streaming service metrics */
realtimePriceRoutes.get("/stream/metrics", (c) => {
  return c.json(getPriceStreamMetrics());
});

/** POST /stream/start — start price streaming */
realtimePriceRoutes.post("/stream/start", async (c) => {
  await startPriceStream();
  return c.json({ status: "started", metrics: getPriceStreamMetrics() });
});

/** POST /stream/stop — stop price streaming */
realtimePriceRoutes.post("/stream/stop", (c) => {
  stopPriceStream();
  return c.json({ status: "stopped" });
});

/** POST /stream/reset-vwap — reset VWAP trackers */
realtimePriceRoutes.post("/stream/reset-vwap", (c) => {
  resetVwap();
  return c.json({ status: "vwap_reset" });
});

/** POST /prices/inject — inject a price (for testing) */
realtimePriceRoutes.post("/prices/inject", async (c) => {
  const body = (await c.req.json()) as {
    symbol: string;
    price: number;
    source?: string;
    change24h?: number;
  };

  if (!body.symbol || !body.price) {
    return c.json({ error: "symbol and price required" }, 400);
  }

  injectPrice(body.symbol, body.price, body.source ?? "manual", body.change24h ?? null);
  return c.json({ status: "injected", symbol: body.symbol, price: body.price });
});
