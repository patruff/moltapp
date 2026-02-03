/**
 * Alert & Webhook Subscription Routes
 *
 * Manage webhook subscriptions and view alert history.
 *
 * Routes:
 *   POST   /api/v1/alerts/subscriptions          — Create a webhook subscription
 *   GET    /api/v1/alerts/subscriptions          — List all subscriptions
 *   GET    /api/v1/alerts/subscriptions/:id      — Get a subscription
 *   DELETE /api/v1/alerts/subscriptions/:id      — Delete a subscription
 *   POST   /api/v1/alerts/subscriptions/:id/activate   — Reactivate
 *   POST   /api/v1/alerts/subscriptions/:id/deactivate — Deactivate
 *   GET    /api/v1/alerts/events                 — Recent alert events
 *   GET    /api/v1/alerts/stats                  — Alert system stats
 *   GET    /api/v1/alerts/dead-letter            — Dead letter queue
 *   POST   /api/v1/alerts/dead-letter/:id/retry  — Retry a dead letter
 */

import { Hono } from "hono";
import {
  createSubscription,
  deleteSubscription,
  deactivateSubscription,
  reactivateSubscription,
  getSubscription,
  listSubscriptions,
  getAlertStats,
  getRecentAlerts,
  getDeadLetterQueue,
  retryDeadLetter,
  type AlertEventType,
} from "../services/alert-webhooks.ts";

export const alertRoutes = new Hono();

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const VALID_EVENT_TYPES: AlertEventType[] = [
  "trade_executed",
  "circuit_breaker_triggered",
  "whale_move",
  "agent_streak",
  "round_completed",
  "price_alert",
  "agent_disagreement",
  "position_closed",
  "new_high",
  "daily_summary",
];

// ---------------------------------------------------------------------------
// POST /subscriptions — Create a new webhook subscription
// ---------------------------------------------------------------------------

alertRoutes.post("/subscriptions", async (c) => {
  try {
    const body = await c.req.json();

    if (!body.url || typeof body.url !== "string") {
      return c.json(
        { error: "validation_error", code: "validation_error", details: "url is required and must be a string" },
        400,
      );
    }

    if (!Array.isArray(body.events) || body.events.length === 0) {
      return c.json(
        { error: "validation_error", code: "validation_error", details: "events must be a non-empty array" },
        400,
      );
    }

    const invalidEvents = body.events.filter((e: string) => !VALID_EVENT_TYPES.includes(e as AlertEventType));
    if (invalidEvents.length > 0) {
      return c.json(
        {
          error: "validation_error",
          code: "validation_error",
          details: `Invalid event types: ${invalidEvents.join(", ")}. Valid types: ${VALID_EVENT_TYPES.join(", ")}`,
        },
        400,
      );
    }

    const subscription = createSubscription({
      url: body.url,
      events: body.events,
      agentFilter: body.agentFilter,
      symbolFilter: body.symbolFilter,
    });

    return c.json(
      {
        subscription: {
          id: subscription.id,
          url: subscription.url,
          events: subscription.events,
          secret: subscription.secret,
          active: subscription.active,
          createdAt: subscription.createdAt,
          agentFilter: subscription.agentFilter,
          symbolFilter: subscription.symbolFilter,
        },
        message: "Webhook subscription created. Save the secret — it is used to verify webhook signatures (HMAC-SHA256).",
      },
      201,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("max_subscriptions_reached") || msg.startsWith("invalid_url") || msg.startsWith("no_events")) {
      return c.json({ error: "validation_error", code: "validation_error", details: msg }, 400);
    }
    console.error("[Alerts] Create subscription failed:", err);
    return c.json({ error: "internal_error", code: "internal_error", details: "Failed to create subscription" }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /subscriptions — List all subscriptions
// ---------------------------------------------------------------------------

alertRoutes.get("/subscriptions", (c) => {
  const subs = listSubscriptions().map((s) => ({
    id: s.id,
    url: s.url,
    events: s.events,
    active: s.active,
    createdAt: s.createdAt,
    agentFilter: s.agentFilter,
    symbolFilter: s.symbolFilter,
    deliveryCount: s.deliveryCount,
    failureCount: s.failureCount,
    lastDeliveryAt: s.lastDeliveryAt,
    lastFailureAt: s.lastFailureAt,
  }));

  return c.json({ subscriptions: subs, total: subs.length });
});

// ---------------------------------------------------------------------------
// GET /subscriptions/:id — Get a single subscription
// ---------------------------------------------------------------------------

alertRoutes.get("/subscriptions/:id", (c) => {
  const id = c.req.param("id");
  const sub = getSubscription(id);

  if (!sub) {
    return c.json(
      { error: "not_found", code: "not_found", details: `Subscription ${id} not found` },
      404,
    );
  }

  return c.json({
    subscription: {
      id: sub.id,
      url: sub.url,
      events: sub.events,
      active: sub.active,
      createdAt: sub.createdAt,
      agentFilter: sub.agentFilter,
      symbolFilter: sub.symbolFilter,
      deliveryCount: sub.deliveryCount,
      failureCount: sub.failureCount,
      lastDeliveryAt: sub.lastDeliveryAt,
      lastFailureAt: sub.lastFailureAt,
    },
  });
});

// ---------------------------------------------------------------------------
// DELETE /subscriptions/:id — Delete a subscription
// ---------------------------------------------------------------------------

alertRoutes.delete("/subscriptions/:id", (c) => {
  const id = c.req.param("id");
  const deleted = deleteSubscription(id);

  if (!deleted) {
    return c.json(
      { error: "not_found", code: "not_found", details: `Subscription ${id} not found` },
      404,
    );
  }

  return c.json({ message: "Subscription deleted", id });
});

// ---------------------------------------------------------------------------
// POST /subscriptions/:id/activate — Reactivate a subscription
// ---------------------------------------------------------------------------

alertRoutes.post("/subscriptions/:id/activate", (c) => {
  const id = c.req.param("id");
  const success = reactivateSubscription(id);

  if (!success) {
    return c.json(
      { error: "not_found", code: "not_found", details: `Subscription ${id} not found` },
      404,
    );
  }

  return c.json({ message: "Subscription reactivated", id });
});

// ---------------------------------------------------------------------------
// POST /subscriptions/:id/deactivate — Deactivate a subscription
// ---------------------------------------------------------------------------

alertRoutes.post("/subscriptions/:id/deactivate", (c) => {
  const id = c.req.param("id");
  const success = deactivateSubscription(id);

  if (!success) {
    return c.json(
      { error: "not_found", code: "not_found", details: `Subscription ${id} not found` },
      404,
    );
  }

  return c.json({ message: "Subscription deactivated", id });
});

// ---------------------------------------------------------------------------
// GET /events — Recent alert events with optional filtering
// ---------------------------------------------------------------------------

alertRoutes.get("/events", (c) => {
  const type = c.req.query("type") as AlertEventType | undefined;
  const agentId = c.req.query("agentId");
  const symbol = c.req.query("symbol");
  const severity = c.req.query("severity") as "info" | "warning" | "critical" | undefined;
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 200);

  const events = getRecentAlerts({ type, agentId, symbol, severity, limit });

  return c.json({ events, total: events.length });
});

// ---------------------------------------------------------------------------
// GET /stats — Alert system statistics
// ---------------------------------------------------------------------------

alertRoutes.get("/stats", (c) => {
  const stats = getAlertStats();
  return c.json({ stats });
});

// ---------------------------------------------------------------------------
// GET /dead-letter — Dead letter queue
// ---------------------------------------------------------------------------

alertRoutes.get("/dead-letter", (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 200);
  const entries = getDeadLetterQueue(limit);
  return c.json({ deadLetter: entries, total: entries.length });
});

// ---------------------------------------------------------------------------
// POST /dead-letter/:id/retry — Retry a dead letter delivery
// ---------------------------------------------------------------------------

alertRoutes.post("/dead-letter/:id/retry", async (c) => {
  const id = c.req.param("id");
  const success = await retryDeadLetter(id);

  if (!success) {
    return c.json(
      { error: "not_found", code: "not_found", details: `Dead letter ${id} not found or event expired` },
      404,
    );
  }

  return c.json({ message: "Dead letter retried", id });
});

// ---------------------------------------------------------------------------
// GET /event-types — List available event types
// ---------------------------------------------------------------------------

alertRoutes.get("/event-types", (c) => {
  const types = VALID_EVENT_TYPES.map((type) => ({
    type,
    description: getEventTypeDescription(type),
  }));

  return c.json({ eventTypes: types });
});

function getEventTypeDescription(type: AlertEventType): string {
  switch (type) {
    case "trade_executed":
      return "An AI agent executes a trade (buy, sell, or hold decision)";
    case "circuit_breaker_triggered":
      return "A circuit breaker blocks or modifies a trade decision";
    case "whale_move":
      return "Large position change detected (>10% of portfolio)";
    case "agent_streak":
      return "An agent hits a 3+ win or loss streak";
    case "round_completed":
      return "A complete trading round finishes with all agent results";
    case "price_alert":
      return "A stock hits a configured price threshold";
    case "agent_disagreement":
      return "Two or more agents take opposite positions on the same stock";
    case "position_closed":
      return "An agent fully exits a position";
    case "new_high":
      return "An agent's portfolio hits a new all-time high";
    case "daily_summary":
      return "End-of-day summary of all trading activity";
  }
}
