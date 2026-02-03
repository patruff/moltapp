/**
 * Event Stream Service
 *
 * Singleton EventBus powering MoltApp's real-time Server-Sent Events (SSE)
 * infrastructure. Every significant platform action — agent trades, round
 * completions, whale alerts, signal fires, debates — publishes a typed event
 * through this bus. Connected SSE clients receive those events instantly
 * with optional channel filtering.
 *
 * Architecture:
 *   1. Typed event channels covering all major platform activity
 *   2. In-memory ring buffer holding the last 100 events
 *   3. Subscriber management (add/remove with automatic cleanup)
 *   4. SSE formatting helpers (compliant with the EventSource spec)
 *   5. Connection stats tracking (active listeners, events per minute)
 *
 * Usage:
 *   import { eventBus } from "../services/event-stream.ts";
 *   eventBus.emit("trade_executed", { agentId: "...", symbol: "AAPL", ... });
 *
 * SSE wire format:
 *   id: evt_abc123\n
 *   event: trade_executed\n
 *   data: {"agentId":"...","symbol":"AAPL",...}\n\n
 */

// ---------------------------------------------------------------------------
// Event Channel Types
// ---------------------------------------------------------------------------

/** Every channel the EventBus can broadcast on */
export type EventType =
  | "trade_executed"
  | "round_started"
  | "round_completed"
  | "price_update"
  | "agent_decision"
  | "whale_alert"
  | "signal_fired"
  | "debate_started"
  | "prediction_created"
  | "sentiment_shift";

/** Canonical list for validation and subscription info */
export const EVENT_TYPES: EventType[] = [
  "trade_executed",
  "round_started",
  "round_completed",
  "price_update",
  "agent_decision",
  "whale_alert",
  "signal_fired",
  "debate_started",
  "prediction_created",
  "sentiment_shift",
];

// ---------------------------------------------------------------------------
// Per-Channel Data Shapes
// ---------------------------------------------------------------------------

/** Payload when an agent executes a trade */
export interface TradeExecutedData {
  agentId: string;
  agentName: string;
  symbol: string;
  action: "buy" | "sell" | "hold";
  quantity: number;
  price: number;
  confidence: number;
  reasoning: string;
}

/** Payload when a new trading round begins */
export interface RoundStartedData {
  roundId: string;
  agentCount: number;
  stockCount: number;
  startedAt: string;
}

/** Payload when a trading round finishes */
export interface RoundCompletedData {
  roundId: string;
  decisions: number;
  tradesExecuted: number;
  durationMs: number;
  summary: string;
}

/** Payload for a market price refresh */
export interface PriceUpdateData {
  symbol: string;
  price: number;
  change24h: number | null;
  volume: number | null;
  updatedAt: string;
}

/** Payload for an individual agent decision */
export interface AgentDecisionData {
  agentId: string;
  agentName: string;
  provider: string;
  symbol: string;
  action: "buy" | "sell" | "hold";
  confidence: number;
  reasoning: string;
}

/** Payload for a whale-level position change */
export interface WhaleAlertData {
  alertType: string;
  severity: "info" | "notable" | "significant" | "critical";
  agentId: string;
  agentName: string;
  symbol: string;
  action: string;
  confidence: number;
  details: string;
}

/** Payload when a technical signal triggers */
export interface SignalFiredData {
  signalId: string;
  symbol: string;
  signalType: string;
  direction: "bullish" | "bearish" | "neutral";
  strength: number;
  indicator: string;
  description: string;
}

/** Payload when agents begin a structured debate */
export interface DebateStartedData {
  debateId: string;
  symbol: string;
  topic: string;
  participants: Array<{ agentId: string; agentName: string; position: string }>;
}

/** Payload when a new prediction is published */
export interface PredictionCreatedData {
  predictionId: string;
  agentId: string;
  agentName: string;
  symbol: string;
  direction: "bullish" | "bearish";
  targetPrice: number;
  confidence: number;
  timeframe: string;
}

/** Payload when overall market sentiment shifts */
export interface SentimentShiftData {
  previousSentiment: string;
  newSentiment: string;
  magnitude: number;
  trigger: string;
  details: string;
}

/** Map event type to its strongly-typed payload */
export interface EventDataMap {
  trade_executed: TradeExecutedData;
  round_started: RoundStartedData;
  round_completed: RoundCompletedData;
  price_update: PriceUpdateData;
  agent_decision: AgentDecisionData;
  whale_alert: WhaleAlertData;
  signal_fired: SignalFiredData;
  debate_started: DebateStartedData;
  prediction_created: PredictionCreatedData;
  sentiment_shift: SentimentShiftData;
}

// ---------------------------------------------------------------------------
// StreamEvent (the envelope)
// ---------------------------------------------------------------------------

/**
 * A single event in the stream. Every event has a globally unique id,
 * a typed channel, an ISO-8601 timestamp, and a strongly-typed data payload.
 */
export interface StreamEvent<T extends EventType = EventType> {
  /** Globally unique event identifier (e.g. `evt_abc123def`) */
  id: string;
  /** The channel this event belongs to */
  type: T;
  /** ISO-8601 timestamp of when the event was created */
  timestamp: string;
  /** Strongly-typed payload specific to the event type */
  data: EventDataMap[T];
}

// ---------------------------------------------------------------------------
// Subscriber type
// ---------------------------------------------------------------------------

/** Callback signature for event subscribers */
export type EventSubscriber = (event: StreamEvent) => void;

/** Internal subscriber record with optional type filter */
interface SubscriberRecord {
  id: string;
  callback: EventSubscriber;
  /** If set, subscriber only receives events for these types */
  typeFilter: EventType[] | null;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Connection Stats
// ---------------------------------------------------------------------------

/** Real-time statistics about the event stream */
export interface StreamStats {
  /** Number of currently connected SSE subscribers */
  activeConnections: number;
  /** Total events emitted since service start */
  totalEventsEmitted: number;
  /** Events emitted in the last 60 seconds */
  eventsLastMinute: number;
  /** Events broken down by type in the last 60 seconds */
  eventsByType: Partial<Record<EventType, number>>;
  /** Size of the in-memory event buffer */
  bufferSize: number;
  /** Maximum buffer capacity */
  bufferCapacity: number;
  /** ISO timestamp of the most recent event */
  lastEventAt: string | null;
  /** Service uptime in milliseconds */
  uptimeMs: number;
}

// ---------------------------------------------------------------------------
// EventBus Implementation
// ---------------------------------------------------------------------------

/** Maximum events retained in the ring buffer */
const MAX_BUFFER_SIZE = 100;

/** Window (ms) for "events per minute" calculation */
const RATE_WINDOW_MS = 60_000;

/**
 * Generate a short, unique event identifier.
 * Format: `evt_<timestamp36>_<random>`
 */
function generateEventId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `evt_${ts}_${rand}`;
}

/**
 * Generate a short, unique subscriber identifier.
 */
function generateSubscriberId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `sub_${rand}`;
}

/**
 * EventBus — singleton that manages the entire real-time event pipeline.
 *
 * Responsibilities:
 *   - Accept typed `emit()` calls from anywhere in the codebase
 *   - Fan-out events to all registered subscribers (with optional filtering)
 *   - Maintain an in-memory ring buffer for replay on new connections
 *   - Track connection and throughput statistics
 */
export class EventBus {
  /** Ring buffer of recent events (newest at the end) */
  private buffer: StreamEvent[] = [];

  /** Active subscribers keyed by id */
  private subscribers: Map<string, SubscriberRecord> = new Map();

  /** Epoch timestamps of recent emissions for rate calculation */
  private emissionTimestamps: number[] = [];

  /** Counter for total events emitted since instantiation */
  private totalEmitted = 0;

  /** Timestamp of the most recently emitted event */
  private lastEventAt: string | null = null;

  /** Epoch when this bus was created */
  private readonly startedAt: number = Date.now();

  // -----------------------------------------------------------------------
  // Emit
  // -----------------------------------------------------------------------

  /**
   * Publish a typed event to all subscribers and store in the ring buffer.
   *
   * @param type  - The event channel
   * @param data  - Strongly-typed payload matching the channel
   * @returns The created StreamEvent (useful for logging / testing)
   *
   * @example
   * ```ts
   * eventBus.emit("trade_executed", {
   *   agentId: "claude-valuebot",
   *   agentName: "Claude ValueBot",
   *   symbol: "AAPLx",
   *   action: "buy",
   *   quantity: 5,
   *   price: 189.25,
   *   confidence: 82,
   *   reasoning: "P/E below historical median...",
   * });
   * ```
   */
  emit<T extends EventType>(type: T, data: EventDataMap[T]): StreamEvent<T> {
    const event: StreamEvent<T> = {
      id: generateEventId(),
      type,
      timestamp: new Date().toISOString(),
      data,
    };

    // Append to ring buffer, evict oldest if at capacity
    this.buffer.push(event as StreamEvent);
    if (this.buffer.length > MAX_BUFFER_SIZE) {
      this.buffer.shift();
    }

    // Update stats
    const now = Date.now();
    this.totalEmitted++;
    this.lastEventAt = event.timestamp;
    this.emissionTimestamps.push(now);

    // Prune emission timestamps older than the rate window
    const cutoff = now - RATE_WINDOW_MS;
    while (this.emissionTimestamps.length > 0 && this.emissionTimestamps[0] < cutoff) {
      this.emissionTimestamps.shift();
    }

    // Fan-out to subscribers
    for (const sub of this.subscribers.values()) {
      // Apply type filter if present
      if (sub.typeFilter && !sub.typeFilter.includes(type)) {
        continue;
      }
      try {
        sub.callback(event as StreamEvent);
      } catch (err) {
        console.error(`[EventBus] Subscriber ${sub.id} threw:`, err);
      }
    }

    return event;
  }

  // -----------------------------------------------------------------------
  // Subscribe / Unsubscribe
  // -----------------------------------------------------------------------

  /**
   * Register a callback to receive events.
   *
   * @param callback    - Function invoked for each matching event
   * @param typeFilter  - Optional array of event types to listen for.
   *                      If omitted or null, the subscriber gets everything.
   * @returns A subscriber id that can be passed to `unsubscribe()`.
   */
  subscribe(callback: EventSubscriber, typeFilter?: EventType[] | null): string {
    const id = generateSubscriberId();
    this.subscribers.set(id, {
      id,
      callback,
      typeFilter: typeFilter ?? null,
      createdAt: Date.now(),
    });
    return id;
  }

  /**
   * Remove a subscriber by id. Safe to call with an already-removed id.
   *
   * @param subscriberId - The id returned from `subscribe()`
   * @returns `true` if the subscriber existed and was removed
   */
  unsubscribe(subscriberId: string): boolean {
    return this.subscribers.delete(subscriberId);
  }

  // -----------------------------------------------------------------------
  // Query
  // -----------------------------------------------------------------------

  /**
   * Retrieve recent events from the ring buffer with optional filtering.
   *
   * @param since  - ISO-8601 timestamp; only events after this time are returned
   * @param types  - Optional array of event types to include
   * @param limit  - Maximum number of events to return (default: 100)
   * @returns Matching events sorted newest-first
   */
  getRecentEvents(
    since?: string,
    types?: EventType[],
    limit: number = MAX_BUFFER_SIZE,
  ): StreamEvent[] {
    let events = [...this.buffer];

    // Filter by timestamp
    if (since) {
      const sinceMs = new Date(since).getTime();
      if (!Number.isNaN(sinceMs)) {
        events = events.filter((e) => new Date(e.timestamp).getTime() > sinceMs);
      }
    }

    // Filter by type
    if (types && types.length > 0) {
      const typeSet = new Set<string>(types);
      events = events.filter((e) => typeSet.has(e.type));
    }

    // Return newest first, up to the limit
    return events.reverse().slice(0, limit);
  }

  /**
   * Get the last N events from the buffer (newest first).
   * Convenience wrapper used when new SSE clients connect.
   *
   * @param count - Number of events to retrieve (default 10)
   */
  getLatestEvents(count: number = 10): StreamEvent[] {
    return [...this.buffer].reverse().slice(0, count);
  }

  // -----------------------------------------------------------------------
  // Stats
  // -----------------------------------------------------------------------

  /**
   * Return a snapshot of stream statistics.
   */
  getStats(): StreamStats {
    const now = Date.now();
    const cutoff = now - RATE_WINDOW_MS;

    // Count events by type in the last minute
    const recentEvents = this.buffer.filter(
      (e) => new Date(e.timestamp).getTime() > cutoff,
    );
    const eventsByType: Partial<Record<EventType, number>> = {};
    for (const e of recentEvents) {
      eventsByType[e.type] = (eventsByType[e.type] ?? 0) + 1;
    }

    // Prune stale timestamps (in case emit hasn't been called recently)
    while (this.emissionTimestamps.length > 0 && this.emissionTimestamps[0] < cutoff) {
      this.emissionTimestamps.shift();
    }

    return {
      activeConnections: this.subscribers.size,
      totalEventsEmitted: this.totalEmitted,
      eventsLastMinute: this.emissionTimestamps.length,
      eventsByType,
      bufferSize: this.buffer.length,
      bufferCapacity: MAX_BUFFER_SIZE,
      lastEventAt: this.lastEventAt,
      uptimeMs: now - this.startedAt,
    };
  }

  // -----------------------------------------------------------------------
  // SSE Formatting
  // -----------------------------------------------------------------------

  /**
   * Format a StreamEvent into a spec-compliant SSE string.
   *
   * Output format:
   * ```
   * id: evt_abc123\n
   * event: trade_executed\n
   * data: {"agentId":"...","symbol":"AAPL"}\n
   * \n
   * ```
   *
   * @param event - The event to format
   * @returns A string ready to be written to an SSE response stream
   */
  static formatSSE(event: StreamEvent): string {
    const lines: string[] = [];
    lines.push(`id: ${event.id}`);
    lines.push(`event: ${event.type}`);

    // Data must be a single line per the SSE spec. JSON.stringify guarantees
    // no literal newlines, but we guard against edge cases.
    const jsonData = JSON.stringify({
      ...event.data,
      _meta: {
        eventId: event.id,
        type: event.type,
        timestamp: event.timestamp,
      },
    });
    lines.push(`data: ${jsonData}`);

    // Two trailing newlines terminate the event
    return lines.join("\n") + "\n\n";
  }

  /**
   * Format a heartbeat comment for keep-alive. This is NOT an event —
   * it is an SSE comment that clients silently ignore but prevents
   * proxy / load-balancer timeouts.
   *
   * @returns `:heartbeat\n\n`
   */
  static formatHeartbeat(): string {
    return `:heartbeat ${new Date().toISOString()}\n\n`;
  }

  // -----------------------------------------------------------------------
  // Metadata helpers
  // -----------------------------------------------------------------------

  /**
   * Return a description of every available channel for the /subscribe
   * info endpoint.
   */
  static getChannelDescriptions(): Array<{
    type: EventType;
    description: string;
  }> {
    return [
      { type: "trade_executed", description: "Fired when any agent executes a buy or sell trade" },
      { type: "round_started", description: "Fired when a new automated trading round begins" },
      { type: "round_completed", description: "Fired when a trading round finishes with all agent results" },
      { type: "price_update", description: "Fired when market prices are refreshed from Jupiter" },
      { type: "agent_decision", description: "Fired for each individual agent decision with full reasoning" },
      { type: "whale_alert", description: "Fired when a large position change or conviction spike is detected" },
      { type: "signal_fired", description: "Fired when a technical indicator triggers a signal (RSI, MACD, etc.)" },
      { type: "debate_started", description: "Fired when agents begin a structured debate about a stock" },
      { type: "prediction_created", description: "Fired when an agent publishes a new price prediction" },
      { type: "sentiment_shift", description: "Fired when overall market sentiment changes direction" },
    ];
  }

  /**
   * Validate that a string is a known EventType.
   *
   * @param value - The string to validate
   * @returns `true` if the value is a valid EventType
   */
  static isValidEventType(value: string): value is EventType {
    return EVENT_TYPES.includes(value as EventType);
  }

  /**
   * Parse a comma-separated type filter string into validated EventType[].
   * Unknown types are silently dropped.
   *
   * @param raw - e.g. "trade_executed,price_update,invalid_type"
   * @returns Array of valid EventType values (may be empty)
   */
  static parseTypeFilter(raw: string): EventType[] {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => EventBus.isValidEventType(s)) as EventType[];
  }
}

// ---------------------------------------------------------------------------
// Singleton instance
// ---------------------------------------------------------------------------

/**
 * The global EventBus instance. Import this from anywhere to emit or
 * subscribe to real-time events.
 *
 * @example
 * ```ts
 * import { eventBus } from "../services/event-stream.ts";
 *
 * // Emit an event
 * eventBus.emit("trade_executed", { agentId: "...", ... });
 *
 * // Subscribe to specific types
 * const subId = eventBus.subscribe(
 *   (event) => console.log(event),
 *   ["trade_executed", "whale_alert"],
 * );
 *
 * // Later: unsubscribe
 * eventBus.unsubscribe(subId);
 * ```
 */
export const eventBus = new EventBus();
