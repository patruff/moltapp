/**
 * Real-Time Event Stream Routes
 *
 * Server-Sent Events (SSE) endpoints for MoltApp. Clients open a persistent
 * HTTP connection to `/api/v1/stream` and receive a live feed of every
 * platform event — agent trades, round results, whale alerts, signal fires,
 * debates, and more — as they happen.
 *
 * Also exposes REST endpoints for recent event history, available channels,
 * and stream health statistics.
 *
 * Routes:
 *   GET  /api/v1/stream               — SSE endpoint (text/event-stream)
 *   GET  /api/v1/stream/events        — Recent events (REST, last 100)
 *   GET  /api/v1/stream/subscribe     — Subscription info (available channels)
 *   GET  /api/v1/stream/stats         — Stream stats (connections, events/min)
 *
 * SSE Query Parameters:
 *   ?types=trade_executed,price_update — Comma-separated channel filter
 *   ?since=2026-02-04T00:00:00Z       — Replay events after this timestamp
 *   ?replay=20                         — Number of recent events to replay on connect (default 10, max 50)
 *
 * Example (curl):
 *   curl -N -H "Accept: text/event-stream" \
 *     "http://localhost:3000/api/v1/stream?types=trade_executed,whale_alert"
 *
 * Example (browser):
 *   const es = new EventSource("/api/v1/stream?types=trade_executed");
 *   es.addEventListener("trade_executed", (e) => {
 *     const data = JSON.parse(e.data);
 *     console.log("Trade:", data);
 *   });
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  eventBus,
  EventBus,
} from "../services/event-stream.ts";
import type {
  EventType,
  StreamEvent,
} from "../services/event-stream.ts";
import { parseQueryInt } from "../lib/query-params.js";
import { errorMessage } from "../lib/errors.ts";

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const streamRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET /stream — SSE live event stream
// ---------------------------------------------------------------------------

/**
 * Primary SSE endpoint. Opens a long-lived HTTP connection and pushes events
 * to the client as they are emitted on the EventBus.
 *
 * Behaviour:
 *   1. On connect, replay the last N events (default 10) so the client has
 *      context. Respects `?types` filter and `?since` timestamp.
 *   2. Register a subscriber on the EventBus with the type filter.
 *   3. Send events as they arrive via `stream.writeSSE()`.
 *   4. Send a heartbeat comment (`:heartbeat`) every 30 seconds to keep
 *      the connection alive through proxies and load balancers.
 *   5. On client disconnect (abort), clean up the subscriber.
 */
streamRoutes.get("/", (c) => {
  // Parse optional type filter
  const typesParam = c.req.query("types");
  const typeFilter: EventType[] | null = typesParam
    ? EventBus.parseTypeFilter(typesParam)
    : null;

  // Parse optional since timestamp for replay window
  const sinceParam = c.req.query("since");

  // Parse optional replay count (how many recent events to send on connect)
  const replayCount = parseQueryInt(c.req.query("replay"), 10, 0, 50);

  return streamSSE(c, async (stream) => {
    let subscriberId: string | null = null;
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    let aborted = false;

    // -------------------------------------------------------------------
    // Cleanup handler — called when the client disconnects
    // -------------------------------------------------------------------
    stream.onAbort(() => {
      aborted = true;
      if (subscriberId) {
        eventBus.unsubscribe(subscriberId);
        subscriberId = null;
      }
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
    });

    // -------------------------------------------------------------------
    // Phase 1: Replay recent events so the client has context
    // -------------------------------------------------------------------
    try {
      const recentEvents = eventBus.getRecentEvents(
        sinceParam ?? undefined,
        typeFilter ?? undefined,
        replayCount,
      );

      // Replay in chronological order (oldest first)
      const chronological = [...recentEvents].reverse();
      for (const event of chronological) {
        if (aborted) return;
        await stream.writeSSE({
          id: event.id,
          event: event.type,
          data: JSON.stringify({
            ...event.data,
            _meta: {
              eventId: event.id,
              type: event.type,
              timestamp: event.timestamp,
              replay: true,
            },
          }),
        });
      }

      // Send a synthetic "connected" comment after replay
      if (!aborted) {
        await stream.writeSSE({
          id: `connected_${Date.now().toString(36)}`,
          event: "connected",
          data: JSON.stringify({
            message: "SSE connection established",
            replayed: chronological.length,
            filter: typeFilter ?? "all",
            timestamp: new Date().toISOString(),
          }),
        });
      }
    } catch (err) {
      console.error("[Stream] Error during replay phase:", err);
    }

    // -------------------------------------------------------------------
    // Phase 2: Subscribe to live events
    // -------------------------------------------------------------------
    subscriberId = eventBus.subscribe(
      async (event: StreamEvent) => {
        if (aborted) return;
        try {
          await stream.writeSSE({
            id: event.id,
            event: event.type,
            data: JSON.stringify({
              ...event.data,
              _meta: {
                eventId: event.id,
                type: event.type,
                timestamp: event.timestamp,
                replay: false,
              },
            }),
          });
        } catch (err) {
          // Client likely disconnected; onAbort will handle cleanup
          console.error("[Stream] Error writing SSE event:", err);
        }
      },
      typeFilter,
    );

    // -------------------------------------------------------------------
    // Phase 3: Heartbeat to keep connection alive
    // -------------------------------------------------------------------
    heartbeatInterval = setInterval(async () => {
      if (aborted) {
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        return;
      }
      try {
        await stream.writeSSE({
          id: `hb_${Date.now().toString(36)}`,
          event: "heartbeat",
          data: JSON.stringify({
            timestamp: new Date().toISOString(),
            connections: eventBus.getStats().activeConnections,
          }),
        });
      } catch {
        // Connection may have been closed — cleanup happens in onAbort
      }
    }, 30_000);

    // -------------------------------------------------------------------
    // Keep the stream open until the client disconnects.
    // We use an infinite loop with a sleep to avoid the handler returning
    // (which would close the response). The onAbort callback handles
    // cleanup when the client goes away.
    // -------------------------------------------------------------------
    while (!aborted) {
      await stream.sleep(1000);
    }
  });
});

// ---------------------------------------------------------------------------
// GET /stream/events — Recent events (REST)
// ---------------------------------------------------------------------------

/**
 * Return recent events from the in-memory ring buffer as a JSON array.
 * Useful for clients that want a snapshot without opening an SSE connection.
 *
 * Query parameters:
 *   ?types=trade_executed,price_update — Filter by event type
 *   ?since=2026-02-04T00:00:00Z       — Only events after this timestamp
 *   ?limit=50                          — Max events to return (default 100)
 */
streamRoutes.get("/events", (c) => {
  try {
    const typesParam = c.req.query("types");
    const sinceParam = c.req.query("since");
    const typeFilter = typesParam
      ? EventBus.parseTypeFilter(typesParam)
      : undefined;

    const limit = parseQueryInt(c.req.query("limit"), 100, 1, 100);

    const events = eventBus.getRecentEvents(
      sinceParam ?? undefined,
      typeFilter,
      limit,
    );

    return c.json({
      events,
      total: events.length,
      filters: {
        types: typeFilter ?? "all",
        since: sinceParam ?? null,
        limit,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Stream] Events query error:", error);
    return c.json(
      {
        error: "stream_error",
        code: "events_query_failed",
        details: errorMessage(error),
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /stream/subscribe — Available channels & subscription info
// ---------------------------------------------------------------------------

/**
 * Informational endpoint describing every available event channel, how to
 * connect, and example payloads. Useful for API consumers to discover
 * what is streamable.
 */
streamRoutes.get("/subscribe", (c) => {
  const channels = EventBus.getChannelDescriptions();

  return c.json({
    endpoint: "/api/v1/stream",
    protocol: "Server-Sent Events (SSE)",
    channels,
    totalChannels: channels.length,
    usage: {
      allEvents: "GET /api/v1/stream",
      filteredEvents: "GET /api/v1/stream?types=trade_executed,whale_alert",
      withReplay: "GET /api/v1/stream?replay=20&since=2026-02-04T00:00:00Z",
    },
    clientExamples: {
      browser: [
        'const es = new EventSource("/api/v1/stream?types=trade_executed");',
        'es.addEventListener("trade_executed", (e) => {',
        "  const data = JSON.parse(e.data);",
        '  console.log("Trade:", data);',
        "});",
      ].join("\n"),
      curl: 'curl -N -H "Accept: text/event-stream" "http://localhost:3000/api/v1/stream"',
    },
    heartbeat: {
      intervalSeconds: 30,
      format: "SSE event with type 'heartbeat'",
    },
    replayOnConnect: {
      default: 10,
      max: 50,
      description: "Recent events are replayed when a client first connects. Replay events have _meta.replay=true.",
    },
  });
});

// ---------------------------------------------------------------------------
// GET /stream/stats — Stream health & throughput statistics
// ---------------------------------------------------------------------------

/**
 * Return real-time statistics about the event stream: active connections,
 * total events emitted, events per minute, buffer utilization, and uptime.
 */
streamRoutes.get("/stats", (c) => {
  try {
    const stats = eventBus.getStats();

    // Format uptime into human-readable string
    const uptimeSec = Math.floor(stats.uptimeMs / 1000);
    const hours = Math.floor(uptimeSec / 3600);
    const minutes = Math.floor((uptimeSec % 3600) / 60);
    const seconds = uptimeSec % 60;
    const uptimeFormatted = `${hours}h ${minutes}m ${seconds}s`;

    // Buffer utilization percentage
    const bufferUtilization =
      stats.bufferCapacity > 0
        ? Math.round((stats.bufferSize / stats.bufferCapacity) * 10000) / 100
        : 0;

    return c.json({
      stats: {
        ...stats,
        uptimeFormatted,
        bufferUtilization: `${bufferUtilization}%`,
        eventsPerSecond:
          stats.eventsLastMinute > 0
            ? Math.round((stats.eventsLastMinute / 60) * 100) / 100
            : 0,
      },
      health: stats.activeConnections >= 0 ? "ok" : "degraded",
      description: `Event stream: ${stats.activeConnections} active connection(s), ${stats.eventsLastMinute} events/min, buffer ${bufferUtilization}% full. Uptime: ${uptimeFormatted}.`,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Stream] Stats error:", error);
    return c.json(
      {
        error: "stream_error",
        code: "stats_failed",
        details: errorMessage(error),
      },
      500,
    );
  }
});
