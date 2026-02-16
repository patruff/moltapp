/**
 * Alert & Webhook Notification System
 *
 * Real-time alerts for trading events. Users register webhook URLs and receive
 * POST notifications when interesting events occur:
 *
 * Event types:
 * - trade_executed: Any agent executes a trade
 * - circuit_breaker_triggered: A circuit breaker blocks a trade
 * - whale_move: Large position change detected
 * - agent_streak: Agent hits 3+ win/loss streak
 * - round_completed: Trading round finishes with all agent results
 * - price_alert: Stock hits a configured price threshold
 * - agent_disagreement: Agents take opposite positions on same stock
 *
 * Architecture:
 * - In-memory subscription store (production would use DynamoDB)
 * - Non-blocking: fire-and-forget webhook delivery with retry
 * - Dead letter queue for failed deliveries
 * - Rate limiting per subscriber (max 60 webhooks/min)
 * - HMAC signature for webhook verification
 */

import { createHmac, randomBytes } from "crypto";
import { errorMessage } from "../lib/errors.ts";
import { countByCondition } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AlertEventType =
  | "trade_executed"
  | "circuit_breaker_triggered"
  | "whale_move"
  | "agent_streak"
  | "round_completed"
  | "price_alert"
  | "agent_disagreement"
  | "position_closed"
  | "new_high"
  | "daily_summary";

export interface WebhookSubscription {
  id: string;
  url: string;
  events: AlertEventType[];
  secret: string; // HMAC signing secret
  active: boolean;
  createdAt: string;
  /** Optional filter: only receive events for these agent IDs */
  agentFilter?: string[];
  /** Optional filter: only receive events for these symbols */
  symbolFilter?: string[];
  /** Rate limit tracking */
  deliveryCount: number;
  lastDeliveryAt: string | null;
  failureCount: number;
  lastFailureAt: string | null;
}

export interface AlertEvent {
  id: string;
  type: AlertEventType;
  timestamp: string;
  data: Record<string, unknown>;
  metadata: {
    roundId?: string;
    agentId?: string;
    symbol?: string;
    severity: "info" | "warning" | "critical";
  };
}

export interface WebhookDelivery {
  id: string;
  subscriptionId: string;
  eventId: string;
  url: string;
  status: "pending" | "delivered" | "failed" | "dead_letter";
  httpStatus?: number;
  attempt: number;
  maxAttempts: number;
  createdAt: string;
  deliveredAt?: string;
  error?: string;
}

export interface AlertStats {
  totalSubscriptions: number;
  activeSubscriptions: number;
  totalEventsEmitted: number;
  totalDeliveries: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  deadLetterCount: number;
  eventCounts: Record<AlertEventType, number>;
  recentEvents: AlertEvent[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Subscription Management Limits
 */

/** Maximum webhook subscriptions allowed system-wide: 100 */
const MAX_SUBSCRIPTIONS = 100;

/** Maximum delivery retry attempts before dead letter: 3 */
const MAX_RETRIES = 3;

/** Maximum webhook deliveries per subscriber per minute: 60 */
const RATE_LIMIT_PER_MINUTE = 60;

/** HTTP timeout for webhook delivery requests: 10 seconds */
const WEBHOOK_TIMEOUT_MS = 10_000;

/** Maximum recent events retained in memory: 200 */
const MAX_RECENT_EVENTS = 200;

/** Maximum dead letter queue entries: 500 */
const MAX_DEAD_LETTER = 500;

/**
 * Retry Policy Parameters
 */

/**
 * Exponential backoff base multiplier: 2.
 * Formula: delay = 2^attempt × BASE_DELAY_MS + random jitter
 * Example: attempt 1 → 2s, attempt 2 → 4s, attempt 3 → 8s
 */
const RETRY_BACKOFF_BASE = 2;

/**
 * Base delay for retry backoff calculation: 1000ms (1 second).
 * Combined with RETRY_BACKOFF_BASE for exponential backoff.
 */
const RETRY_BASE_DELAY_MS = 1000;

/**
 * Maximum random jitter added to retry delay: 1000ms (0-1 second).
 * Prevents thundering herd when multiple deliveries fail simultaneously.
 */
const RETRY_JITTER_MAX_MS = 1000;

/**
 * Auto-deactivation threshold for consecutive webhook failures: 10.
 * Subscription is deactivated after 10 consecutive failed deliveries.
 */
const AUTO_DEACTIVATE_FAILURE_THRESHOLD = 10;

/**
 * Time Window Constants
 */

/**
 * Rate limit time window in milliseconds: 60,000ms (1 minute).
 * Used to enforce RATE_LIMIT_PER_MINUTE deliveries per subscriber.
 */
const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Display Formatting Constants
 */

/**
 * Recent events display limit for stats API: 20.
 * Number of most recent events shown in getAlertStats() response.
 */
const RECENT_EVENTS_STATS_LIMIT = 20;

/**
 * Query Result Limit Constants
 */

/**
 * Default query result limit for alert and dead letter queue APIs: 50.
 *
 * Controls pagination defaults for:
 * - getDeadLetterQueue(): Returns last 50 failed deliveries by default
 * - getRecentAlerts(): Returns up to 50 filtered alert events by default
 *
 * Purpose: Prevents unbounded memory consumption while providing reasonable
 * default page size for API consumers. Users can override via limit parameter.
 *
 * Example:
 * - getDeadLetterQueue() returns 50 most recent failures
 * - getRecentAlerts({ limit: 100 }) overrides to return 100 results
 */
const DEFAULT_QUERY_RESULT_LIMIT = 50;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const subscriptions = new Map<string, WebhookSubscription>();
const recentEvents: AlertEvent[] = [];
const deadLetterQueue: WebhookDelivery[] = [];
const eventCounts: Record<string, number> = {};
let totalDeliveries = 0;
let successfulDeliveries = 0;
let failedDeliveries = 0;

// Rate limit tracking: subscriberId -> timestamps of recent deliveries
const deliveryTimestamps = new Map<string, number[]>();

// ---------------------------------------------------------------------------
// Subscription Management
// ---------------------------------------------------------------------------

/**
 * Register a new webhook subscription.
 */
export function createSubscription(params: {
  url: string;
  events: AlertEventType[];
  agentFilter?: string[];
  symbolFilter?: string[];
}): WebhookSubscription {
  if (subscriptions.size >= MAX_SUBSCRIPTIONS) {
    throw new Error(`max_subscriptions_reached: limit is ${MAX_SUBSCRIPTIONS}`);
  }

  // Validate URL
  try {
    new URL(params.url);
  } catch {
    throw new Error(`invalid_url: ${params.url}`);
  }

  if (params.events.length === 0) {
    throw new Error("no_events: at least one event type is required");
  }

  const id = `sub_${Date.now()}_${randomBytes(4).toString("hex")}`;
  const secret = randomBytes(32).toString("hex");

  const subscription: WebhookSubscription = {
    id,
    url: params.url,
    events: params.events,
    secret,
    active: true,
    createdAt: new Date().toISOString(),
    agentFilter: params.agentFilter,
    symbolFilter: params.symbolFilter,
    deliveryCount: 0,
    lastDeliveryAt: null,
    failureCount: 0,
    lastFailureAt: null,
  };

  subscriptions.set(id, subscription);
  console.log(`[AlertWebhooks] Created subscription ${id} for ${params.url} (${params.events.join(",")})`);

  return subscription;
}

/**
 * Deactivate a webhook subscription.
 */
export function deactivateSubscription(id: string): boolean {
  const sub = subscriptions.get(id);
  if (!sub) return false;

  sub.active = false;
  console.log(`[AlertWebhooks] Deactivated subscription ${id}`);
  return true;
}

/**
 * Reactivate a webhook subscription.
 */
export function reactivateSubscription(id: string): boolean {
  const sub = subscriptions.get(id);
  if (!sub) return false;

  sub.active = true;
  sub.failureCount = 0;
  console.log(`[AlertWebhooks] Reactivated subscription ${id}`);
  return true;
}

/**
 * Delete a webhook subscription permanently.
 */
export function deleteSubscription(id: string): boolean {
  const existed = subscriptions.delete(id);
  deliveryTimestamps.delete(id);
  if (existed) {
    console.log(`[AlertWebhooks] Deleted subscription ${id}`);
  }
  return existed;
}

/**
 * Get a subscription by ID.
 */
export function getSubscription(id: string): WebhookSubscription | null {
  return subscriptions.get(id) ?? null;
}

/**
 * List all subscriptions.
 */
export function listSubscriptions(): WebhookSubscription[] {
  return Array.from(subscriptions.values());
}

// ---------------------------------------------------------------------------
// Event Emission
// ---------------------------------------------------------------------------

/**
 * Emit an alert event. This is the main entry point for the alert system.
 * Non-blocking: delivers to all matching subscriptions asynchronously.
 */
export function emitAlert(
  type: AlertEventType,
  data: Record<string, unknown>,
  metadata: Omit<AlertEvent["metadata"], "severity"> & { severity?: "info" | "warning" | "critical" },
): AlertEvent {
  const event: AlertEvent = {
    id: `evt_${Date.now()}_${randomBytes(4).toString("hex")}`,
    type,
    timestamp: new Date().toISOString(),
    data,
    metadata: {
      ...metadata,
      severity: metadata.severity ?? inferSeverity(type),
    },
  };

  // Track event
  recentEvents.unshift(event);
  if (recentEvents.length > MAX_RECENT_EVENTS) {
    recentEvents.length = MAX_RECENT_EVENTS;
  }
  eventCounts[type] = (eventCounts[type] ?? 0) + 1;

  // Find matching subscriptions and deliver
  const matchingSubs = findMatchingSubscriptions(event);

  if (matchingSubs.length > 0) {
    console.log(
      `[AlertWebhooks] Emitting ${type} event ${event.id} to ${matchingSubs.length} subscribers`,
    );
  }

  // Fire-and-forget delivery
  for (const sub of matchingSubs) {
    deliverWebhook(sub, event).catch((err) => {
      console.error(
        `[AlertWebhooks] Delivery failed for ${sub.id}: ${errorMessage(err)}`,
      );
    });
  }

  return event;
}

/**
 * Emit a trade execution alert.
 */
export function emitTradeAlert(params: {
  agentId: string;
  agentName: string;
  action: "buy" | "sell" | "hold";
  symbol: string;
  quantity: number;
  confidence: number;
  reasoning: string;
  roundId?: string;
}): AlertEvent {
  return emitAlert(
    "trade_executed",
    {
      agentId: params.agentId,
      agentName: params.agentName,
      action: params.action,
      symbol: params.symbol,
      quantity: params.quantity,
      confidence: params.confidence,
      reasoning: params.reasoning,
    },
    {
      roundId: params.roundId,
      agentId: params.agentId,
      symbol: params.symbol,
    },
  );
}

/**
 * Emit a circuit breaker triggered alert.
 */
export function emitCircuitBreakerAlert(params: {
  agentId: string;
  breakerType: string;
  reason: string;
  originalAction: string;
  originalSymbol: string;
  threshold: string;
  actualValue: string;
}): AlertEvent {
  return emitAlert(
    "circuit_breaker_triggered",
    params,
    {
      agentId: params.agentId,
      symbol: params.originalSymbol,
      severity: "warning",
    },
  );
}

/**
 * Emit a round completed alert with all agent results.
 */
export function emitRoundCompletedAlert(params: {
  roundId: string;
  results: Array<{
    agentId: string;
    agentName: string;
    action: string;
    symbol: string;
    confidence: number;
    executed: boolean;
  }>;
  errors: string[];
  circuitBreakerActivations: number;
}): AlertEvent {
  return emitAlert(
    "round_completed",
    {
      results: params.results,
      agentCount: params.results.length,
      errorCount: params.errors.length,
      circuitBreakerActivations: params.circuitBreakerActivations,
    },
    {
      roundId: params.roundId,
      severity: params.errors.length > 0 ? "warning" : "info",
    },
  );
}

/**
 * Emit an agent disagreement alert (opposite positions on same stock).
 */
export function emitAgentDisagreementAlert(params: {
  roundId: string;
  symbol: string;
  agents: Array<{
    agentId: string;
    agentName: string;
    action: string;
    confidence: number;
  }>;
}): AlertEvent {
  return emitAlert(
    "agent_disagreement",
    params,
    {
      roundId: params.roundId,
      symbol: params.symbol,
    },
  );
}

// ---------------------------------------------------------------------------
// Webhook Delivery
// ---------------------------------------------------------------------------

/**
 * Deliver a webhook with retry logic.
 */
async function deliverWebhook(
  sub: WebhookSubscription,
  event: AlertEvent,
  attempt = 1,
): Promise<void> {
  // Rate limit check
  if (!checkRateLimit(sub.id)) {
    console.warn(`[AlertWebhooks] Rate limited: ${sub.id} (${sub.url})`);
    return;
  }

  const delivery: WebhookDelivery = {
    id: `dlv_${Date.now()}_${randomBytes(4).toString("hex")}`,
    subscriptionId: sub.id,
    eventId: event.id,
    url: sub.url,
    status: "pending",
    attempt,
    maxAttempts: MAX_RETRIES,
    createdAt: new Date().toISOString(),
  };

  const payload = JSON.stringify({
    event: event.type,
    id: event.id,
    timestamp: event.timestamp,
    data: event.data,
    metadata: event.metadata,
  });

  // Compute HMAC signature
  const signature = createHmac("sha256", sub.secret)
    .update(payload)
    .digest("hex");

  try {
    const response = await fetch(sub.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-MoltApp-Signature": `sha256=${signature}`,
        "X-MoltApp-Event": event.type,
        "X-MoltApp-Delivery-Id": delivery.id,
        "X-MoltApp-Timestamp": event.timestamp,
        "User-Agent": "MoltApp-Webhooks/1.0",
      },
      body: payload,
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });

    delivery.httpStatus = response.status;
    totalDeliveries++;

    if (response.ok) {
      delivery.status = "delivered";
      delivery.deliveredAt = new Date().toISOString();
      sub.deliveryCount++;
      sub.lastDeliveryAt = delivery.deliveredAt;
      successfulDeliveries++;
      recordDeliveryTimestamp(sub.id);
    } else {
      throw new Error(`HTTP ${response.status}: ${await response.text().catch(() => "no body")}`);
    }
  } catch (err) {
    const errorMsg = errorMessage(err);
    delivery.error = errorMsg;
    delivery.status = "failed";
    failedDeliveries++;

    // Retry with exponential backoff
    if (attempt < MAX_RETRIES) {
      const delay = Math.pow(RETRY_BACKOFF_BASE, attempt) * RETRY_BASE_DELAY_MS + Math.random() * RETRY_JITTER_MAX_MS;
      console.warn(
        `[AlertWebhooks] Delivery failed for ${sub.id}, retrying in ${Math.round(delay)}ms (attempt ${attempt}/${MAX_RETRIES}): ${errorMsg}`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      return deliverWebhook(sub, event, attempt + 1);
    }

    // Max retries exceeded — dead letter
    delivery.status = "dead_letter";
    deadLetterQueue.push(delivery);
    if (deadLetterQueue.length > MAX_DEAD_LETTER) {
      deadLetterQueue.shift();
    }

    sub.failureCount++;
    sub.lastFailureAt = new Date().toISOString();

    // Auto-deactivate after consecutive failures threshold
    if (sub.failureCount >= AUTO_DEACTIVATE_FAILURE_THRESHOLD) {
      sub.active = false;
      console.error(
        `[AlertWebhooks] Auto-deactivated subscription ${sub.id} after ${sub.failureCount} failures`,
      );
    }

    console.error(
      `[AlertWebhooks] Dead letter for ${sub.id}: ${errorMsg}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Find subscriptions that match an event's type and filters.
 */
function findMatchingSubscriptions(event: AlertEvent): WebhookSubscription[] {
  const matching: WebhookSubscription[] = [];

  for (const sub of subscriptions.values()) {
    if (!sub.active) continue;
    if (!sub.events.includes(event.type)) continue;

    // Agent filter
    if (sub.agentFilter && sub.agentFilter.length > 0 && event.metadata.agentId) {
      if (!sub.agentFilter.includes(event.metadata.agentId)) continue;
    }

    // Symbol filter
    if (sub.symbolFilter && sub.symbolFilter.length > 0 && event.metadata.symbol) {
      if (!sub.symbolFilter.includes(event.metadata.symbol)) continue;
    }

    matching.push(sub);
  }

  return matching;
}

/**
 * Infer severity from event type.
 */
function inferSeverity(type: AlertEventType): "info" | "warning" | "critical" {
  switch (type) {
    case "circuit_breaker_triggered":
      return "warning";
    case "whale_move":
      return "warning";
    case "agent_disagreement":
      return "info";
    case "new_high":
      return "info";
    default:
      return "info";
  }
}

/**
 * Check rate limit for a subscriber.
 */
function checkRateLimit(subscriberId: string): boolean {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  let timestamps = deliveryTimestamps.get(subscriberId) ?? [];
  timestamps = timestamps.filter((t) => t > windowStart);
  deliveryTimestamps.set(subscriberId, timestamps);

  return timestamps.length < RATE_LIMIT_PER_MINUTE;
}

/**
 * Record a delivery timestamp for rate limiting.
 */
function recordDeliveryTimestamp(subscriberId: string): void {
  const timestamps = deliveryTimestamps.get(subscriberId) ?? [];
  timestamps.push(Date.now());
  deliveryTimestamps.set(subscriberId, timestamps);
}

// ---------------------------------------------------------------------------
// Stats & Monitoring
// ---------------------------------------------------------------------------

/**
 * Get comprehensive alert system statistics.
 */
export function getAlertStats(): AlertStats {
  const allEventTypes: AlertEventType[] = [
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

  const typedCounts: Record<AlertEventType, number> = {} as Record<AlertEventType, number>;
  for (const type of allEventTypes) {
    typedCounts[type] = eventCounts[type] ?? 0;
  }

  return {
    totalSubscriptions: subscriptions.size,
    activeSubscriptions: countByCondition(Array.from(subscriptions.values()), (s) => s.active),
    totalEventsEmitted: recentEvents.length + Object.values(eventCounts).reduce((s, c) => s + c, 0) - recentEvents.length,
    totalDeliveries,
    successfulDeliveries,
    failedDeliveries,
    deadLetterCount: deadLetterQueue.length,
    eventCounts: typedCounts,
    recentEvents: recentEvents.slice(0, RECENT_EVENTS_STATS_LIMIT),
  };
}

/**
 * Get dead letter queue entries.
 */
export function getDeadLetterQueue(limit = DEFAULT_QUERY_RESULT_LIMIT): WebhookDelivery[] {
  return deadLetterQueue.slice(-limit).reverse();
}

/**
 * Retry a dead letter delivery.
 */
export async function retryDeadLetter(deliveryId: string): Promise<boolean> {
  const idx = deadLetterQueue.findIndex((d) => d.id === deliveryId);
  if (idx === -1) return false;

  const delivery = deadLetterQueue[idx];
  const sub = subscriptions.get(delivery.subscriptionId);
  if (!sub) return false;

  const event = recentEvents.find((e) => e.id === delivery.eventId);
  if (!event) return false;

  // Remove from dead letter
  deadLetterQueue.splice(idx, 1);

  // Retry delivery
  await deliverWebhook(sub, event, 1);
  return true;
}

/**
 * Get recent events with optional filtering.
 */
export function getRecentAlerts(params?: {
  type?: AlertEventType;
  agentId?: string;
  symbol?: string;
  severity?: "info" | "warning" | "critical";
  limit?: number;
}): AlertEvent[] {
  let filtered = recentEvents;

  if (params?.type) {
    filtered = filtered.filter((e) => e.type === params.type);
  }
  if (params?.agentId) {
    filtered = filtered.filter((e) => e.metadata.agentId === params.agentId);
  }
  if (params?.symbol) {
    filtered = filtered.filter((e) => e.metadata.symbol === params.symbol);
  }
  if (params?.severity) {
    filtered = filtered.filter((e) => e.metadata.severity === params.severity);
  }

  return filtered.slice(0, params?.limit ?? DEFAULT_QUERY_RESULT_LIMIT);
}
