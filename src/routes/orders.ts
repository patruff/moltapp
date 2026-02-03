/**
 * Advanced Order Management API Routes
 *
 * Endpoints for placing and managing limit orders, stop-losses,
 * trailing stops, take-profits, and bracket orders.
 */

import { Hono } from "hono";
import {
  placeLimitBuy,
  placeLimitSell,
  placeStopLoss,
  placeTrailingStop,
  placeTakeProfit,
  placeBracket,
  cancelOrder,
  cancelAllAgentOrders,
  getOrder,
  getAgentOrders,
  getSymbolOrders,
  getAllOrders,
  getOrderHistory,
  getOrderManagerMetrics,
  startOrderEvaluation,
  stopOrderEvaluation,
} from "../services/order-manager.ts";

export const orderRoutes = new Hono();

/** GET / — get all active orders */
orderRoutes.get("/", (c) => {
  return c.json({
    orders: getAllOrders(),
    metrics: getOrderManagerMetrics(),
  });
});

/** GET /:orderId — get a specific order */
orderRoutes.get("/:orderId", (c) => {
  const orderId = c.req.param("orderId");
  const order = getOrder(orderId);
  if (!order) return c.json({ error: "Order not found" }, 404);
  return c.json(order);
});

/** GET /agent/:agentId — get orders for an agent */
orderRoutes.get("/agent/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  return c.json({ agentId, orders: getAgentOrders(agentId) });
});

/** GET /symbol/:symbol — get orders for a symbol */
orderRoutes.get("/symbol/:symbol", (c) => {
  const symbol = c.req.param("symbol");
  return c.json({ symbol, orders: getSymbolOrders(symbol) });
});

/** GET /history — get order history */
orderRoutes.get("/history/all", (c) => {
  const limit = parseInt(c.req.query("limit") ?? "50", 10);
  return c.json({ history: getOrderHistory(limit) });
});

/** GET /metrics — get order manager metrics */
orderRoutes.get("/metrics/summary", (c) => {
  return c.json(getOrderManagerMetrics());
});

/** POST /limit-buy — place a limit buy order */
orderRoutes.post("/limit-buy", async (c) => {
  const body = (await c.req.json()) as {
    agentId: string;
    symbol: string;
    mintAddress: string;
    limitPrice: number;
    quantity: number;
    expiresAt?: string;
    roundId?: string;
    notes?: string;
  };
  const order = placeLimitBuy(body);
  return c.json(order, 201);
});

/** POST /limit-sell — place a limit sell order */
orderRoutes.post("/limit-sell", async (c) => {
  const body = (await c.req.json()) as {
    agentId: string;
    symbol: string;
    mintAddress: string;
    limitPrice: number;
    quantity: number;
    expiresAt?: string;
    roundId?: string;
    notes?: string;
  };
  const order = placeLimitSell(body);
  return c.json(order, 201);
});

/** POST /stop-loss — place a stop-loss order */
orderRoutes.post("/stop-loss", async (c) => {
  const body = (await c.req.json()) as {
    agentId: string;
    symbol: string;
    mintAddress: string;
    stopPrice: number;
    entryPrice: number;
    quantity: number;
    roundId?: string;
    notes?: string;
  };
  const order = placeStopLoss(body);
  return c.json(order, 201);
});

/** POST /trailing-stop — place a trailing stop order */
orderRoutes.post("/trailing-stop", async (c) => {
  const body = (await c.req.json()) as {
    agentId: string;
    symbol: string;
    mintAddress: string;
    trailPercent: number;
    entryPrice: number;
    quantity: number;
    roundId?: string;
    notes?: string;
  };
  const order = placeTrailingStop(body);
  return c.json(order, 201);
});

/** POST /take-profit — place a take-profit order */
orderRoutes.post("/take-profit", async (c) => {
  const body = (await c.req.json()) as {
    agentId: string;
    symbol: string;
    mintAddress: string;
    targetPrice: number;
    entryPrice: number;
    quantity: number;
    roundId?: string;
    notes?: string;
  };
  const order = placeTakeProfit(body);
  return c.json(order, 201);
});

/** POST /bracket — place a bracket order */
orderRoutes.post("/bracket", async (c) => {
  const body = (await c.req.json()) as {
    agentId: string;
    symbol: string;
    mintAddress: string;
    entryPrice: number;
    stopPrice: number;
    targetPrice: number;
    quantity: number;
    roundId?: string;
    notes?: string;
  };
  const order = placeBracket(body);
  return c.json(order, 201);
});

/** DELETE /:orderId — cancel an order */
orderRoutes.delete("/:orderId", (c) => {
  const orderId = c.req.param("orderId");
  const cancelled = cancelOrder(orderId);
  if (!cancelled) return c.json({ error: "Order not found or not cancellable" }, 404);
  return c.json({ status: "cancelled", orderId });
});

/** DELETE /agent/:agentId — cancel all orders for an agent */
orderRoutes.delete("/agent/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const count = cancelAllAgentOrders(agentId);
  return c.json({ status: "cancelled", agentId, cancelledCount: count });
});

/** POST /engine/start — start order evaluation engine */
orderRoutes.post("/engine/start", (c) => {
  startOrderEvaluation();
  return c.json({ status: "started" });
});

/** POST /engine/stop — stop order evaluation engine */
orderRoutes.post("/engine/stop", (c) => {
  stopOrderEvaluation();
  return c.json({ status: "stopped" });
});
