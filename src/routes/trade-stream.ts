/**
 * Trade Stream API Routes
 *
 * Server-Sent Events (SSE) endpoint for real-time trading activity.
 * Clients connect and receive a continuous stream of trading events.
 *
 * Endpoints:
 * - GET /live       — SSE stream of real-time trading events
 * - GET /events     — Recent events (polling fallback)
 * - GET /metrics    — Stream metrics (subscribers, events)
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  subscribe,
  unsubscribe,
  getRecentEvents,
  getTradeStreamMetrics,
  type TradeStreamEvent,
  type TradeStreamEventType,
} from "../services/trade-stream.ts";

const app = new Hono();

/**
 * GET /live — Server-Sent Events stream
 *
 * Connect to this endpoint to receive real-time trading events.
 * Events are JSON-encoded and sent as SSE data messages.
 *
 * Query parameters:
 * - types: Comma-separated event types to filter (optional)
 * - agentIds: Comma-separated agent IDs to filter (optional)
 *
 * Example:
 *   curl -N https://patgpt.us/api/v1/trade-stream/live
 *   curl -N https://patgpt.us/api/v1/trade-stream/live?types=trade_executed,agent_decision
 */
app.get("/live", (c) => {
  const typesParam = c.req.query("types");
  const agentIdsParam = c.req.query("agentIds");

  const filter: {
    types?: TradeStreamEventType[];
    agentIds?: string[];
  } = {};

  if (typesParam) {
    filter.types = typesParam.split(",") as TradeStreamEventType[];
  }
  if (agentIdsParam) {
    filter.agentIds = agentIdsParam.split(",");
  }

  return streamSSE(c, async (stream) => {
    let subscriberId: string | null = null;

    try {
      // Send initial connection event
      await stream.writeSSE({
        event: "connected",
        data: JSON.stringify({
          message: "Connected to MoltApp Trade Stream",
          filter,
          timestamp: new Date().toISOString(),
        }),
      });

      // Send recent history as catchup
      const recentEvents = getRecentEvents(20, {
        types: filter.types,
        agentId: filter.agentIds?.[0],
      });

      for (const event of recentEvents) {
        await stream.writeSSE({
          event: event.type,
          id: event.id,
          data: JSON.stringify(event),
        });
      }

      // Subscribe to live events
      subscriberId = subscribe(
        (event: TradeStreamEvent) => {
          stream.writeSSE({
            event: event.type,
            id: event.id,
            data: JSON.stringify(event),
          }).catch(() => {
            // Connection closed — will be cleaned up
          });
        },
        filter,
      );

      // Keep connection alive until client disconnects
      // The stream will automatically close when the client disconnects
      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          resolve();
        });
      });
    } finally {
      if (subscriberId) {
        unsubscribe(subscriberId);
      }
    }
  });
});

/**
 * GET /events — Recent events (polling fallback)
 *
 * For clients that don't support SSE, this returns recent events as JSON.
 *
 * Query parameters:
 * - limit: Max events to return (default: 50, max: 200)
 * - types: Comma-separated event types to filter
 * - agentId: Single agent ID to filter
 * - since: ISO timestamp to filter events after
 */
app.get("/events", (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 200);
  const typesParam = c.req.query("types");
  const agentId = c.req.query("agentId");
  const since = c.req.query("since");

  let events = getRecentEvents(limit, {
    types: typesParam
      ? (typesParam.split(",") as TradeStreamEventType[])
      : undefined,
    agentId: agentId ?? undefined,
  });

  // Filter by timestamp if provided
  if (since) {
    const sinceTime = new Date(since).getTime();
    events = events.filter(
      (e) => new Date(e.timestamp).getTime() > sinceTime,
    );
  }

  return c.json({
    events,
    count: events.length,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /metrics — Stream metrics
 *
 * Returns current stream health: subscriber count, events emitted, etc.
 */
app.get("/metrics", (c) => {
  const metrics = getTradeStreamMetrics();
  return c.json(metrics);
});

export const tradeStreamRoutes = app;
