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
    | "round_completed"
    | "deep_coherence"
    | "pattern_analyzed"
    | "calibration_updated"
    | "v11_forensic"
    | "v13_battles";
  agentId?: string;
  data: Record<string, unknown>;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Maximum number of benchmark events retained in the in-memory ring buffer.
 * When exceeded, oldest events are evicted (FIFO via array truncation).
 * 500 events ≈ several full trading rounds of activity at typical emission rates.
 * Increase for longer replay history; decrease to reduce memory footprint.
 */
const MAX_BUFFER = 500;

/**
 * Number of historical events replayed to SSE subscribers on connection.
 * When a client connects, the last N matching events are sent immediately
 * so the subscriber sees recent activity without waiting for the next live event.
 * 10 events provides context without overwhelming slow clients at connect time.
 */
const SSE_REPLAY_WINDOW_SIZE = 10;

/**
 * Default number of events returned by GET /recent when no limit param is given.
 * Chosen to keep response size manageable for typical dashboard polling.
 */
const RECENT_EVENTS_DEFAULT_LIMIT = 50;

/**
 * Hard cap on the limit parameter for GET /recent.
 * Prevents accidental large responses; MAX_BUFFER (500) is the true upper bound,
 * but 200 provides a practical ceiling for API consumers.
 */
const RECENT_EVENTS_MAX_LIMIT = 200;

/**
 * Time window (milliseconds) used to calculate the events-per-minute rate.
 * 5 minutes = 300,000 ms. Counts events emitted in the last 5 minutes,
 * then divides by EVENTS_PER_MINUTE_WINDOW_MINUTES for the per-minute rate.
 */
const EVENTS_PER_MINUTE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Window length in minutes, paired with EVENTS_PER_MINUTE_WINDOW_MS.
 * eventsPerMinute = recentCount / EVENTS_PER_MINUTE_WINDOW_MINUTES
 * Must stay in sync with EVENTS_PER_MINUTE_WINDOW_MS (5 min = 300,000 ms).
 */
const EVENTS_PER_MINUTE_WINDOW_MINUTES = 5;

/**
 * Precision multiplier for the events-per-minute display value.
 * Math.round(rate × 10) / 10 → one decimal place (e.g., 3.7 events/min).
 */
const EVENTS_PER_MINUTE_PRECISION_MULTIPLIER = 10;

/**
 * Interval (milliseconds) between SSE heartbeat pings sent to each subscriber.
 * Heartbeats keep the HTTP connection alive through proxies and load balancers
 * that close idle connections. 15 s is well within the 30–60 s idle timeouts
 * common on Cloudflare, nginx, and AWS ALB.
 */
const HEARTBEAT_INTERVAL_MS = 15_000;

// ---------------------------------------------------------------------------
// Event Buffer
// ---------------------------------------------------------------------------

const eventBuffer: BenchmarkEvent[] = [];
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
      .slice(0, SSE_REPLAY_WINDOW_SIZE)
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
    }, HEARTBEAT_INTERVAL_MS);

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
  const limit = Math.min(parseInt(c.req.query("limit") ?? String(RECENT_EVENTS_DEFAULT_LIMIT), 10), RECENT_EVENTS_MAX_LIMIT);
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
  const windowStart = Date.now() - EVENTS_PER_MINUTE_WINDOW_MS;
  const recentCount = eventBuffer.filter(
    (e) => new Date(e.timestamp).getTime() > windowStart,
  ).length;
  const eventsPerMinute =
    Math.round((recentCount / EVENTS_PER_MINUTE_WINDOW_MINUTES) * EVENTS_PER_MINUTE_PRECISION_MULTIPLIER) /
    EVENTS_PER_MINUTE_PRECISION_MULTIPLIER;

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
