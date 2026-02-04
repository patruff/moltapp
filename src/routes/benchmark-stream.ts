/**
 * Live Benchmark Stream
 *
 * Real-time Server-Sent Events (SSE) stream of benchmark events.
 * Researchers and dashboard UIs can subscribe to get live updates
 * as agents trade, reason, and get scored.
 *
 * Events:
 * - trade_reasoning: Agent made a decision with full reasoning
 * - coherence_scored: Coherence analysis completed
 * - peer_review: Peer review completed
 * - depth_analyzed: Reasoning depth scored
 * - regime_detected: Market regime changed
 * - hallucination_flagged: Hallucination detected in reasoning
 * - benchmark_update: Aggregate benchmark scores updated
 *
 * Routes:
 * - GET /api/v1/benchmark-stream — SSE stream of live events
 * - GET /api/v1/benchmark-stream/recent — Recent events (non-SSE)
 * - GET /api/v1/benchmark-stream/stats — Stream statistics
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

export const benchmarkStreamRoutes = new Hono();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BenchmarkEvent {
  id: string;
  type:
    | "trade_reasoning"
    | "coherence_scored"
    | "peer_review"
    | "depth_analyzed"
    | "regime_detected"
    | "hallucination_flagged"
    | "benchmark_update"
    | "round_completed";
  agentId?: string;
  data: Record<string, unknown>;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Event Buffer
// ---------------------------------------------------------------------------

const eventBuffer: BenchmarkEvent[] = [];
const MAX_BUFFER = 500;
let eventCounter = 0;

// Active SSE subscribers
const subscribers: Set<(event: BenchmarkEvent) => void> = new Set();

/**
 * Emit a benchmark event to all SSE subscribers and the event buffer.
 * Called by the orchestrator, coherence analyzer, peer review system, etc.
 */
export function emitBenchmarkEvent(
  type: BenchmarkEvent["type"],
  data: Record<string, unknown>,
  agentId?: string,
): void {
  eventCounter++;
  const event: BenchmarkEvent = {
    id: `bev_${eventCounter}_${Date.now()}`,
    type,
    agentId,
    data,
    timestamp: new Date().toISOString(),
  };

  // Add to buffer
  eventBuffer.unshift(event);
  if (eventBuffer.length > MAX_BUFFER) {
    eventBuffer.length = MAX_BUFFER;
  }

  // Notify all SSE subscribers
  for (const callback of subscribers) {
    try {
      callback(event);
    } catch {
      // Remove broken subscriber
      subscribers.delete(callback);
    }
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET / — SSE stream of live benchmark events
 *
 * Query params:
 *   types — comma-separated event types to filter (default: all)
 *   agent — filter by agent ID
 */
benchmarkStreamRoutes.get("/", (c) => {
  const typeFilter = c.req.query("types")?.split(",");
  const agentFilter = c.req.query("agent");

  return streamSSE(c, async (stream) => {
    // Send initial connection event
    await stream.writeSSE({
      event: "connected",
      data: JSON.stringify({
        message: "Connected to MoltApp Benchmark Stream",
        filters: { types: typeFilter ?? "all", agent: agentFilter ?? "all" },
        bufferedEvents: eventBuffer.length,
      }),
      id: "0",
    });

    // Send recent events as replay
    const recentEvents = eventBuffer
      .filter((e) => {
        if (typeFilter && !typeFilter.includes(e.type)) return false;
        if (agentFilter && e.agentId !== agentFilter) return false;
        return true;
      })
      .slice(0, 10)
      .reverse();

    for (const event of recentEvents) {
      await stream.writeSSE({
        event: event.type,
        data: JSON.stringify({ ...event.data, agentId: event.agentId }),
        id: event.id,
      });
    }

    // Subscribe to new events
    const callback = async (event: BenchmarkEvent) => {
      if (typeFilter && !typeFilter.includes(event.type)) return;
      if (agentFilter && event.agentId !== agentFilter) return;

      try {
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify({ ...event.data, agentId: event.agentId }),
          id: event.id,
        });
      } catch {
        subscribers.delete(callback);
      }
    };

    subscribers.add(callback);

    // Keep connection alive with heartbeat
    const heartbeat = setInterval(async () => {
      try {
        await stream.writeSSE({
          event: "heartbeat",
          data: JSON.stringify({
            time: new Date().toISOString(),
            subscribers: subscribers.size,
          }),
          id: `hb_${Date.now()}`,
        });
      } catch {
        clearInterval(heartbeat);
        subscribers.delete(callback);
      }
    }, 15000);

    // Cleanup on disconnect
    stream.onAbort(() => {
      clearInterval(heartbeat);
      subscribers.delete(callback);
    });

    // Keep stream alive (will be closed by abort)
    await new Promise<void>((resolve) => {
      stream.onAbort(() => resolve());
    });
  });
});

/**
 * GET /recent — Recent events (JSON, not SSE)
 *
 * Query params:
 *   limit (default 50, max 200)
 *   type — filter by event type
 *   agent — filter by agent ID
 */
benchmarkStreamRoutes.get("/recent", (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 200);
  const typeFilter = c.req.query("type");
  const agentFilter = c.req.query("agent");

  let filtered = eventBuffer;
  if (typeFilter) {
    filtered = filtered.filter((e) => e.type === typeFilter);
  }
  if (agentFilter) {
    filtered = filtered.filter((e) => e.agentId === agentFilter);
  }

  return c.json({
    ok: true,
    events: filtered.slice(0, limit),
    total: filtered.length,
    subscribers: subscribers.size,
  });
});

/**
 * GET /stats — Stream statistics
 */
benchmarkStreamRoutes.get("/stats", (c) => {
  // Count events by type
  const typeCounts: Record<string, number> = {};
  for (const event of eventBuffer) {
    typeCounts[event.type] = (typeCounts[event.type] ?? 0) + 1;
  }

  // Count events by agent
  const agentCounts: Record<string, number> = {};
  for (const event of eventBuffer) {
    if (event.agentId) {
      agentCounts[event.agentId] = (agentCounts[event.agentId] ?? 0) + 1;
    }
  }

  // Events per minute (last 5 minutes)
  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  const recentCount = eventBuffer.filter(
    (e) => new Date(e.timestamp).getTime() > fiveMinAgo,
  ).length;
  const eventsPerMinute = Math.round((recentCount / 5) * 10) / 10;

  return c.json({
    ok: true,
    stats: {
      totalEvents: eventCounter,
      bufferedEvents: eventBuffer.length,
      activeSubscribers: subscribers.size,
      eventsPerMinute,
      eventsByType: typeCounts,
      eventsByAgent: agentCounts,
      oldestEvent: eventBuffer[eventBuffer.length - 1]?.timestamp ?? null,
      newestEvent: eventBuffer[0]?.timestamp ?? null,
    },
  });
});
