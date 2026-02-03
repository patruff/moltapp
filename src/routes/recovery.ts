/**
 * Trade Recovery API Routes
 *
 * Provides visibility into the trade recovery system. Shows failed trades,
 * dead letter queue, stuck trades, and recovery reports.
 *
 * Admin endpoints allow manual resolution of stuck/dead-lettered trades.
 */

import { Hono } from "hono";
import { env } from "../config/env.ts";
import {
  getRecoveryReport,
  getDeadLetterQueue,
  getStuckTrades,
  getPendingRetries,
  getFailedTrade,
  getAgentFailedTrades,
  resolveManually,
  getRetryPolicy,
  setRetryPolicy,
  type RetryPolicy,
} from "../services/trade-recovery.ts";

const recoveryRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET /api/v1/recovery — Recovery report
// ---------------------------------------------------------------------------

recoveryRoutes.get("/", (c) => {
  const report = getRecoveryReport();
  return c.json(report);
});

// ---------------------------------------------------------------------------
// GET /api/v1/recovery/dead-letter — Dead letter queue
// ---------------------------------------------------------------------------

recoveryRoutes.get("/dead-letter", (c) => {
  const trades = getDeadLetterQueue();
  return c.json({ trades, count: trades.length });
});

// ---------------------------------------------------------------------------
// GET /api/v1/recovery/stuck — Stuck trades
// ---------------------------------------------------------------------------

recoveryRoutes.get("/stuck", (c) => {
  const trades = getStuckTrades();
  return c.json({ trades, count: trades.length });
});

// ---------------------------------------------------------------------------
// GET /api/v1/recovery/pending — Pending retries
// ---------------------------------------------------------------------------

recoveryRoutes.get("/pending", (c) => {
  const trades = getPendingRetries();
  return c.json({ trades, count: trades.length });
});

// ---------------------------------------------------------------------------
// GET /api/v1/recovery/policy — Current retry policy
// ---------------------------------------------------------------------------

recoveryRoutes.get("/policy", (c) => {
  return c.json(getRetryPolicy());
});

// ---------------------------------------------------------------------------
// GET /api/v1/recovery/agent/:agentId — Failed trades for agent
// ---------------------------------------------------------------------------

recoveryRoutes.get("/agent/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const trades = getAgentFailedTrades(agentId);
  return c.json({ trades, count: trades.length });
});

// ---------------------------------------------------------------------------
// GET /api/v1/recovery/:recoveryId — Single failed trade
// ---------------------------------------------------------------------------

recoveryRoutes.get("/:recoveryId", (c) => {
  const recoveryId = c.req.param("recoveryId");
  const trade = getFailedTrade(recoveryId);

  if (!trade) {
    return c.json({ error: "not_found", message: "Recovery entry not found" }, 404);
  }

  return c.json(trade);
});

// ---------------------------------------------------------------------------
// Admin: POST /api/v1/recovery/:recoveryId/resolve — Manual resolution
// ---------------------------------------------------------------------------

recoveryRoutes.post("/:recoveryId/resolve", async (c) => {
  const password = c.req.header("X-Admin-Password");
  if (!password || password !== env.ADMIN_PASSWORD) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const recoveryId = c.req.param("recoveryId");
  const body = await c.req.json<{
    resolution: "recovered" | "dead_letter";
    notes: string;
  }>();

  if (!body.resolution || !["recovered", "dead_letter"].includes(body.resolution)) {
    return c.json(
      { error: "invalid_resolution", message: "resolution must be 'recovered' or 'dead_letter'" },
      400,
    );
  }

  const trade = resolveManually(
    recoveryId,
    body.resolution,
    body.notes || "Manual admin resolution",
  );

  if (!trade) {
    return c.json({ error: "not_found", message: "Recovery entry not found" }, 404);
  }

  return c.json({ success: true, trade });
});

// ---------------------------------------------------------------------------
// Admin: PUT /api/v1/recovery/policy — Update retry policy
// ---------------------------------------------------------------------------

recoveryRoutes.put("/policy", async (c) => {
  const password = c.req.header("X-Admin-Password");
  if (!password || password !== env.ADMIN_PASSWORD) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const updates = await c.req.json<Partial<RetryPolicy>>();
  const policy = setRetryPolicy(updates);
  return c.json({ success: true, policy });
});

export { recoveryRoutes };
