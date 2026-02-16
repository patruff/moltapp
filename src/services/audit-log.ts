/**
 * Persistent Audit Log Service
 *
 * Compliance-grade audit trail for all trading operations, circuit breaker
 * activations, system events, and admin actions. Stores events in an
 * in-memory ring buffer with periodic flush to DynamoDB.
 *
 * Event categories:
 * - TRADE: buy/sell execution, trade confirmation, trade failure
 * - CIRCUIT_BREAKER: activation, config change, reset
 * - SYSTEM: startup, shutdown, health degradation
 * - ADMIN: force release lock, reset state, config change
 * - AGENT: decision made, portfolio snapshot, balance change
 * - AUTH: API key usage, rate limit hit
 *
 * Each event includes: timestamp, category, severity, agentId (if applicable),
 * action, details, and a unique eventId for traceability.
 */

import { errorMessage } from "../lib/errors.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuditCategory =
  | "TRADE"
  | "CIRCUIT_BREAKER"
  | "SYSTEM"
  | "ADMIN"
  | "AGENT"
  | "AUTH";

export type AuditSeverity = "info" | "warn" | "error" | "critical";

export interface AuditEvent {
  /** Unique event identifier */
  eventId: string;
  /** ISO timestamp */
  timestamp: string;
  /** Event category */
  category: AuditCategory;
  /** Severity level */
  severity: AuditSeverity;
  /** Action performed (e.g., "trade_executed", "circuit_breaker_activated") */
  action: string;
  /** Human-readable description */
  description: string;
  /** Agent ID if event relates to a specific agent */
  agentId?: string;
  /** Trading round ID if event relates to a trading round */
  roundId?: string;
  /** Additional structured data */
  metadata?: Record<string, unknown>;
  /** Source component that generated the event */
  source: string;
}

export interface AuditLogQuery {
  category?: AuditCategory;
  severity?: AuditSeverity;
  agentId?: string;
  roundId?: string;
  action?: string;
  source?: string;
  startTime?: string;
  endTime?: string;
  limit?: number;
  offset?: number;
}

export interface AuditLogStats {
  totalEvents: number;
  byCategory: Record<AuditCategory, number>;
  bySeverity: Record<AuditSeverity, number>;
  oldestEvent: string | null;
  newestEvent: string | null;
  flushStats: {
    totalFlushes: number;
    lastFlushTime: string | null;
    pendingEvents: number;
  };
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Maximum events to keep in memory */
const MAX_BUFFER_SIZE = 5000;

/** How often to attempt DynamoDB flush (ms) */
const FLUSH_INTERVAL_MS = 60_000;

/** DynamoDB table name (from environment) */
const AUDIT_TABLE =
  process.env.AGENT_STATE_TABLE || "moltapp-agent-state";

// ---------------------------------------------------------------------------
// In-Memory State
// ---------------------------------------------------------------------------

const eventBuffer: AuditEvent[] = [];
let flushCount = 0;
let lastFlushTime: string | null = null;
let flushIntervalId: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// Event ID Generation
// ---------------------------------------------------------------------------

import {
  ID_RANDOM_START,
  ID_RANDOM_LENGTH_SHORT,
} from "../config/id-generation-constants.ts";

let eventCounter = 0;

function generateEventId(): string {
  eventCounter++;
  return `evt_${Date.now()}_${eventCounter.toString(36)}_${Math.random().toString(36).slice(ID_RANDOM_START, ID_RANDOM_START + ID_RANDOM_LENGTH_SHORT)}`;
}

// ---------------------------------------------------------------------------
// Core Functions
// ---------------------------------------------------------------------------

/**
 * Log an audit event.
 *
 * Events are stored in memory and periodically flushed to DynamoDB.
 * Critical and error events are also logged to console immediately.
 */
export function logAuditEvent(
  params: Omit<AuditEvent, "eventId" | "timestamp">,
): AuditEvent {
  const event: AuditEvent = {
    eventId: generateEventId(),
    timestamp: new Date().toISOString(),
    ...params,
  };

  // Add to ring buffer
  eventBuffer.push(event);
  if (eventBuffer.length > MAX_BUFFER_SIZE) {
    eventBuffer.splice(0, eventBuffer.length - MAX_BUFFER_SIZE);
  }

  // Console output for high-severity events
  if (event.severity === "critical") {
    console.error(
      `[AUDIT:CRITICAL] ${event.action} — ${event.description}`,
      event.metadata ? JSON.stringify(event.metadata) : "",
    );
  } else if (event.severity === "error") {
    console.error(
      `[AUDIT:ERROR] ${event.action} — ${event.description}`,
    );
  }

  return event;
}

// ---------------------------------------------------------------------------
// Convenience Loggers
// ---------------------------------------------------------------------------

/** Log a trade execution event */
export function logTradeEvent(
  action: string,
  description: string,
  agentId: string,
  roundId?: string,
  metadata?: Record<string, unknown>,
): AuditEvent {
  return logAuditEvent({
    category: "TRADE",
    severity: "info",
    action,
    description,
    agentId,
    roundId,
    metadata,
    source: "trading-service",
  });
}

/** Log a trade failure event */
export function logTradeFailure(
  description: string,
  agentId: string,
  error: Error | string,
  roundId?: string,
  metadata?: Record<string, unknown>,
): AuditEvent {
  return logAuditEvent({
    category: "TRADE",
    severity: "error",
    action: "trade_failed",
    description,
    agentId,
    roundId,
    metadata: {
      ...metadata,
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
    },
    source: "trading-service",
  });
}

/** Log a circuit breaker activation */
export function logCircuitBreakerEvent(
  action: string,
  description: string,
  agentId: string,
  metadata?: Record<string, unknown>,
): AuditEvent {
  return logAuditEvent({
    category: "CIRCUIT_BREAKER",
    severity: action === "blocked" ? "warn" : "info",
    action: `cb_${action}`,
    description,
    agentId,
    metadata,
    source: "circuit-breaker",
  });
}

/** Log a system event */
export function logSystemEvent(
  action: string,
  description: string,
  severity: AuditSeverity = "info",
  metadata?: Record<string, unknown>,
): AuditEvent {
  return logAuditEvent({
    category: "SYSTEM",
    severity,
    action,
    description,
    metadata,
    source: "system",
  });
}

/** Log an admin action */
export function logAdminEvent(
  action: string,
  description: string,
  metadata?: Record<string, unknown>,
): AuditEvent {
  return logAuditEvent({
    category: "ADMIN",
    severity: "warn",
    action: `admin_${action}`,
    description,
    metadata,
    source: "admin",
  });
}

/** Log an agent decision event */
export function logAgentEvent(
  action: string,
  description: string,
  agentId: string,
  metadata?: Record<string, unknown>,
): AuditEvent {
  return logAuditEvent({
    category: "AGENT",
    severity: "info",
    action,
    description,
    agentId,
    metadata,
    source: "agent",
  });
}

/** Log an auth event */
export function logAuthEvent(
  action: string,
  description: string,
  severity: AuditSeverity = "info",
  metadata?: Record<string, unknown>,
): AuditEvent {
  return logAuditEvent({
    category: "AUTH",
    severity,
    action: `auth_${action}`,
    description,
    metadata,
    source: "auth",
  });
}

// ---------------------------------------------------------------------------
// Query Functions
// ---------------------------------------------------------------------------

/**
 * Query audit events with filtering and pagination.
 */
export function queryAuditLog(query: AuditLogQuery = {}): {
  events: AuditEvent[];
  total: number;
  limit: number;
  offset: number;
} {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;

  let filtered = [...eventBuffer];

  if (query.category) {
    filtered = filtered.filter((e) => e.category === query.category);
  }
  if (query.severity) {
    filtered = filtered.filter((e) => e.severity === query.severity);
  }
  if (query.agentId) {
    filtered = filtered.filter((e) => e.agentId === query.agentId);
  }
  if (query.roundId) {
    filtered = filtered.filter((e) => e.roundId === query.roundId);
  }
  if (query.action) {
    filtered = filtered.filter((e) =>
      e.action.toLowerCase().includes(query.action!.toLowerCase()),
    );
  }
  if (query.source) {
    filtered = filtered.filter((e) => e.source === query.source);
  }
  if (query.startTime) {
    filtered = filtered.filter((e) => e.timestamp >= query.startTime!);
  }
  if (query.endTime) {
    filtered = filtered.filter((e) => e.timestamp <= query.endTime!);
  }

  // Sort newest first
  filtered.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const total = filtered.length;
  const events = filtered.slice(offset, offset + limit);

  return { events, total, limit, offset };
}

/**
 * Get a single audit event by ID.
 */
export function getAuditEvent(eventId: string): AuditEvent | null {
  return eventBuffer.find((e) => e.eventId === eventId) ?? null;
}

/**
 * Get audit log statistics.
 */
export function getAuditLogStats(): AuditLogStats {
  const byCategory: Record<AuditCategory, number> = {
    TRADE: 0,
    CIRCUIT_BREAKER: 0,
    SYSTEM: 0,
    ADMIN: 0,
    AGENT: 0,
    AUTH: 0,
  };
  const bySeverity: Record<AuditSeverity, number> = {
    info: 0,
    warn: 0,
    error: 0,
    critical: 0,
  };

  for (const event of eventBuffer) {
    byCategory[event.category]++;
    bySeverity[event.severity]++;
  }

  return {
    totalEvents: eventBuffer.length,
    byCategory,
    bySeverity,
    oldestEvent: eventBuffer.length > 0 ? eventBuffer[0].timestamp : null,
    newestEvent:
      eventBuffer.length > 0
        ? eventBuffer[eventBuffer.length - 1].timestamp
        : null,
    flushStats: {
      totalFlushes: flushCount,
      lastFlushTime,
      pendingEvents: eventBuffer.length,
    },
  };
}

// ---------------------------------------------------------------------------
// DynamoDB Flush (best-effort)
// ---------------------------------------------------------------------------

/**
 * Attempt to flush buffered events to DynamoDB.
 *
 * This is best-effort — if DynamoDB is unavailable, events remain in
 * the in-memory buffer. Uses batch writes for efficiency.
 */
export async function flushToDynamoDB(): Promise<{
  flushed: number;
  errors: number;
}> {
  if (eventBuffer.length === 0) {
    return { flushed: 0, errors: 0 };
  }

  let flushed = 0;
  let errors = 0;

  try {
    // Lazy import to avoid loading DynamoDB SDK when not needed
    const { DynamoDBClient, BatchWriteItemCommand } = await import(
      "@aws-sdk/client-dynamodb"
    );
    const client = new DynamoDBClient({});

    // Batch events into groups of 25 (DynamoDB limit)
    const eventsToFlush = eventBuffer.slice(-500); // Flush last 500

    for (let i = 0; i < eventsToFlush.length; i += 25) {
      const batch = eventsToFlush.slice(i, i + 25);
      const putRequests = batch.map((event) => ({
        PutRequest: {
          Item: {
            agentId: { S: `AUDIT#${event.category}` },
            lastTradeTimestamp: { S: event.timestamp },
            eventId: { S: event.eventId },
            category: { S: event.category },
            severity: { S: event.severity },
            action: { S: event.action },
            description: { S: event.description },
            source: { S: event.source },
            ...(event.agentId
              ? { targetAgentId: { S: event.agentId } }
              : {}),
            ...(event.roundId ? { roundId: { S: event.roundId } } : {}),
            ...(event.metadata
              ? { metadata: { S: JSON.stringify(event.metadata) } }
              : {}),
            ttl: {
              N: String(
                Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60, // 90 day TTL
              ),
            },
          },
        },
      }));

      try {
        await client.send(
          new BatchWriteItemCommand({
            RequestItems: {
              [AUDIT_TABLE]: putRequests,
            },
          }),
        );
        flushed += batch.length;
      } catch (batchErr) {
        console.error(
          `[AuditLog] DynamoDB batch write failed:`,
          errorMessage(batchErr),
        );
        errors += batch.length;
      }
    }

    flushCount++;
    lastFlushTime = new Date().toISOString();
  } catch (err) {
    console.warn(
      `[AuditLog] DynamoDB flush skipped (not available):`,
      errorMessage(err),
    );
  }

  return { flushed, errors };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Start periodic DynamoDB flush.
 */
export function startAuditLogFlusher(): void {
  if (flushIntervalId) return;
  flushIntervalId = setInterval(() => {
    flushToDynamoDB().catch((err) => {
      console.error(
        `[AuditLog] Flush error:`,
        errorMessage(err),
      );
    });
  }, FLUSH_INTERVAL_MS);

  logSystemEvent("audit_log_started", "Audit log flusher started");
}

/**
 * Stop periodic flush and do a final flush.
 */
export async function stopAuditLogFlusher(): Promise<void> {
  if (flushIntervalId) {
    clearInterval(flushIntervalId);
    flushIntervalId = null;
  }

  logSystemEvent("audit_log_stopped", "Audit log flusher stopped");
  await flushToDynamoDB();
}

/**
 * Clear all in-memory audit events (admin use).
 */
export function clearAuditLog(): void {
  const count = eventBuffer.length;
  eventBuffer.length = 0;
  eventCounter = 0;
  logAdminEvent("clear_audit_log", `Cleared ${count} audit events`);
}
