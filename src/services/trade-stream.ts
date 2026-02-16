/**
 * Trade Stream Service
 *
 * Real-time event streaming for trading activity. Provides a Server-Sent
 * Events (SSE) compatible stream that broadcasts:
 *
 * - Agent decisions (buy/sell/hold with reasoning)
 * - Trade executions (paper & live)
 * - Circuit breaker activations
 * - Round start/complete events
 * - Agent disagreement alerts
 * - System health changes
 *
 * Clients connect via GET /api/v1/trade-stream and receive a continuous
 * stream of JSON events. Supports multiple concurrent subscribers.
 *
 * Features:
 * - Subscriber management (add/remove/broadcast)
 * - Event history buffer (last 200 events)
 * - Heartbeat every 30 seconds to keep connections alive
 * - Event filtering by type or agentId
 * - Metrics: subscriber count, events emitted, uptime
 */

import { errorMessage } from "../lib/errors.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TradeStreamEventType =
  | "round_started"
  | "round_completed"
  | "agent_decision"
  | "trade_executed"
  | "trade_failed"
  | "circuit_breaker"
  | "agent_disagreement"
  | "health_change"
  | "heartbeat"
  | "system";

export interface TradeStreamEvent {
  id: string;
  type: TradeStreamEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

export type StreamSubscriber = (event: TradeStreamEvent) => void;

interface SubscriberEntry {
  id: string;
  callback: StreamSubscriber;
  subscribedAt: string;
  filter?: {
    types?: TradeStreamEventType[];
    agentIds?: string[];
  };
  eventsReceived: number;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const subscribers = new Map<string, SubscriberEntry>();
const eventHistory: TradeStreamEvent[] = [];
const MAX_HISTORY = 200;

let eventCounter = 0;
let totalEventsEmitted = 0;
let startedAt = new Date().toISOString();

// Heartbeat interval
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// Subscriber Management
// ---------------------------------------------------------------------------

/**
 * Subscribe to the trade stream.
 * Returns a subscriber ID that can be used to unsubscribe.
 */
export function subscribe(
  callback: StreamSubscriber,
  filter?: {
    types?: TradeStreamEventType[];
    agentIds?: string[];
  },
): string {
  const id = `sub_${Date.now()}_${Math.random().toString(36).slice(ID_RANDOM_START, ID_RANDOM_START + ID_RANDOM_LENGTH_STANDARD)}`;

  subscribers.set(id, {
    id,
    callback,
    subscribedAt: new Date().toISOString(),
    filter,
    eventsReceived: 0,
  });

  // Start heartbeat if this is the first subscriber
  if (subscribers.size === 1) {
    startHeartbeat();
  }

  console.log(
    `[TradeStream] Subscriber ${id} connected (total: ${subscribers.size})`,
  );

  return id;
}

/**
 * Unsubscribe from the trade stream.
 */
export function unsubscribe(subscriberId: string): boolean {
  const removed = subscribers.delete(subscriberId);

  if (removed) {
    console.log(
      `[TradeStream] Subscriber ${subscriberId} disconnected (total: ${subscribers.size})`,
    );
  }

  // Stop heartbeat if no subscribers
  if (subscribers.size === 0) {
    stopHeartbeat();
  }

  return removed;
}

/**
 * Get the current subscriber count.
 */
export function getSubscriberCount(): number {
  return subscribers.size;
}

// ---------------------------------------------------------------------------
// Event Emission
// ---------------------------------------------------------------------------

/**
 * Emit an event to all subscribers.
 */
export function emitTradeStreamEvent(
  type: TradeStreamEventType,
  data: Record<string, unknown>,
): TradeStreamEvent {
  eventCounter++;
  totalEventsEmitted++;

  const event: TradeStreamEvent = {
    id: `evt_${eventCounter}`,
    type,
    timestamp: new Date().toISOString(),
    data,
  };

  // Store in history
  eventHistory.push(event);
  if (eventHistory.length > MAX_HISTORY) {
    eventHistory.splice(0, eventHistory.length - MAX_HISTORY);
  }

  // Broadcast to subscribers
  for (const [, entry] of subscribers) {
    try {
      // Apply filters
      if (entry.filter?.types && !entry.filter.types.includes(type)) {
        continue;
      }
      if (entry.filter?.agentIds) {
        const eventAgentId = data.agentId as string | undefined;
        if (eventAgentId && !entry.filter.agentIds.includes(eventAgentId)) {
          continue;
        }
      }

      entry.callback(event);
      entry.eventsReceived++;
    } catch (err) {
      console.warn(
        `[TradeStream] Error sending to subscriber ${entry.id}: ${errorMessage(err)}`,
      );
    }
  }

  return event;
}

// ---------------------------------------------------------------------------
// Convenience Emitters
// ---------------------------------------------------------------------------

/**
 * Emit a round started event.
 */
export function emitRoundStarted(roundId: string, agentCount: number): void {
  emitTradeStreamEvent("round_started", {
    roundId,
    agentCount,
    message: `Trading round ${roundId} started with ${agentCount} agents`,
  });
}

/**
 * Emit a round completed event.
 */
export function emitRoundCompleted(
  roundId: string,
  results: Array<{
    agentId: string;
    agentName: string;
    action: string;
    symbol: string;
    confidence: number;
    executed: boolean;
  }>,
  durationMs: number,
): void {
  emitTradeStreamEvent("round_completed", {
    roundId,
    durationMs,
    results,
    summary: results.map(
      (r) => `${r.agentName}: ${r.action.toUpperCase()} ${r.symbol} (${r.confidence}%)`,
    ).join(" | "),
  });
}

/**
 * Emit an agent decision event.
 */
export function emitAgentDecision(
  agentId: string,
  agentName: string,
  action: string,
  symbol: string,
  quantity: number,
  confidence: number,
  reasoning: string,
): void {
  emitTradeStreamEvent("agent_decision", {
    agentId,
    agentName,
    action,
    symbol,
    quantity,
    confidence,
    reasoning,
  });
}

/**
 * Emit a trade execution event.
 */
export function emitTradeExecuted(
  agentId: string,
  agentName: string,
  action: string,
  symbol: string,
  quantity: number,
  price: number,
  txSignature: string,
  mode: "live" | "paper",
): void {
  emitTradeStreamEvent("trade_executed", {
    agentId,
    agentName,
    action,
    symbol,
    quantity,
    price,
    txSignature,
    mode,
    usdcValue: action === "buy" ? quantity : quantity * price,
  });
}

/**
 * Emit a circuit breaker activation event.
 */
export function emitCircuitBreakerActivation(
  agentId: string,
  breaker: string,
  reason: string,
  action: "blocked" | "clamped",
): void {
  emitTradeStreamEvent("circuit_breaker", {
    agentId,
    breaker,
    reason,
    action,
  });
}

/**
 * Emit an agent disagreement event.
 */
export function emitDisagreement(
  symbol: string,
  agents: Array<{ agentId: string; agentName: string; action: string }>,
): void {
  emitTradeStreamEvent("agent_disagreement", {
    symbol,
    agents,
    message: `Agents disagree on ${symbol}: ${agents.map((a) => `${a.agentName} says ${a.action.toUpperCase()}`).join(", ")}`,
  });
}

// ---------------------------------------------------------------------------
// Event History
// ---------------------------------------------------------------------------

/**
 * Get recent events from the history buffer.
 */
export function getRecentEvents(
  limit = 50,
  filter?: {
    types?: TradeStreamEventType[];
    agentId?: string;
  },
): TradeStreamEvent[] {
  let events = eventHistory;

  if (filter?.types) {
    events = events.filter((e) => filter.types!.includes(e.type));
  }
  if (filter?.agentId) {
    events = events.filter(
      (e) => (e.data.agentId as string | undefined) === filter.agentId,
    );
  }

  return events.slice(-limit);
}

/**
 * Get the total event count.
 */
export function getTotalEventCount(): number {
  return totalEventsEmitted;
}

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

function startHeartbeat(): void {
  if (heartbeatInterval) return;
  heartbeatInterval = setInterval(() => {
    emitTradeStreamEvent("heartbeat", {
      subscribers: subscribers.size,
      uptime: Date.now() - new Date(startedAt).getTime(),
    });
  }, 30_000);
}

function stopHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export interface TradeStreamMetrics {
  subscriberCount: number;
  totalEventsEmitted: number;
  historyBufferSize: number;
  startedAt: string;
  uptimeMs: number;
  subscriberDetails: Array<{
    id: string;
    subscribedAt: string;
    eventsReceived: number;
    hasTypeFilter: boolean;
    hasAgentFilter: boolean;
  }>;
}

/**
 * Get trade stream metrics.
 */
export function getTradeStreamMetrics(): TradeStreamMetrics {
  return {
    subscriberCount: subscribers.size,
    totalEventsEmitted,
    historyBufferSize: eventHistory.length,
    startedAt,
    uptimeMs: Date.now() - new Date(startedAt).getTime(),
    subscriberDetails: Array.from(subscribers.values()).map((s) => ({
      id: s.id,
      subscribedAt: s.subscribedAt,
      eventsReceived: s.eventsReceived,
      hasTypeFilter: !!s.filter?.types,
      hasAgentFilter: !!s.filter?.agentIds,
    })),
  };
}

/**
 * Reset trade stream state (for testing).
 */
export function resetTradeStream(): void {
  subscribers.clear();
  eventHistory.length = 0;
  eventCounter = 0;
  totalEventsEmitted = 0;
  startedAt = new Date().toISOString();
  stopHeartbeat();
}
