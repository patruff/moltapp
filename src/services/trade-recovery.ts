/**
 * Trade Recovery Service
 *
 * Handles recovery of failed, stuck, or partially-executed trades.
 * Provides mechanisms to:
 *
 * 1. Detect stuck trades (submitted but not confirmed)
 * 2. Retry failed trade executions with exponential backoff
 * 3. Reconcile on-chain state with database state
 * 4. Generate recovery reports for manual intervention
 * 5. Dead-letter queue for permanently failed trades
 *
 * This is critical production infrastructure — real money is at stake.
 */

import { logTradeEvent, logTradeFailure, logSystemEvent } from "./audit-log.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TradeStatus =
  | "pending"
  | "submitted"
  | "confirmed"
  | "failed"
  | "stuck"
  | "recovered"
  | "dead_letter";

export interface FailedTrade {
  /** Unique recovery ID */
  recoveryId: string;
  /** Original trade details */
  agentId: string;
  side: "buy" | "sell";
  symbol: string;
  quantity: string;
  /** What went wrong */
  error: string;
  errorCode: string;
  /** Recovery attempts */
  attempts: number;
  maxAttempts: number;
  /** When the trade was first attempted */
  firstAttemptAt: string;
  /** When the last retry happened */
  lastAttemptAt: string;
  /** Next scheduled retry (if any) */
  nextRetryAt: string | null;
  /** Current status */
  status: TradeStatus;
  /** On-chain transaction signature (if submitted) */
  txSignature?: string;
  /** Trading round that spawned this trade */
  roundId?: string;
  /** Additional context */
  metadata?: Record<string, unknown>;
}

export interface RecoveryReport {
  /** Total failed trades in the queue */
  totalFailed: number;
  /** Trades awaiting retry */
  pendingRetry: number;
  /** Trades that permanently failed (dead letter) */
  deadLettered: number;
  /** Successfully recovered trades */
  recovered: number;
  /** Stuck trades (submitted but unconfirmed) */
  stuck: number;
  /** Breakdown by error type */
  byErrorCode: Record<string, number>;
  /** Breakdown by agent */
  byAgent: Record<string, number>;
  /** Breakdown by symbol */
  bySymbol: Record<string, number>;
  /** Recent recovery activity */
  recentActivity: RecoveryActivity[];
}

export interface RecoveryActivity {
  recoveryId: string;
  action: string;
  timestamp: string;
  result: string;
  details?: string;
}

export interface RetryPolicy {
  /** Maximum number of retry attempts */
  maxAttempts: number;
  /** Initial backoff delay in ms */
  initialDelayMs: number;
  /** Backoff multiplier (exponential) */
  backoffMultiplier: number;
  /** Maximum delay between retries in ms */
  maxDelayMs: number;
  /** Add jitter to retry delays */
  jitter: boolean;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  initialDelayMs: 2000,
  backoffMultiplier: 2,
  maxDelayMs: 30_000,
  jitter: true,
};

/** Maximum failed trades to keep in memory */
const MAX_QUEUE_SIZE = 500;

/** Trades older than this (ms) are considered stuck */
const STUCK_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// In-Memory State
// ---------------------------------------------------------------------------

const failedTrades = new Map<string, FailedTrade>();
const recoveryLog: RecoveryActivity[] = [];
let currentRetryPolicy: RetryPolicy = { ...DEFAULT_RETRY_POLICY };
let recoveryCounter = 0;

// ---------------------------------------------------------------------------
// ID Generation
// ---------------------------------------------------------------------------

function generateRecoveryId(): string {
  recoveryCounter++;
  return `rcv_${Date.now()}_${recoveryCounter.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

// ---------------------------------------------------------------------------
// Core Functions
// ---------------------------------------------------------------------------

/**
 * Register a failed trade for recovery tracking.
 *
 * Call this when a trade execution fails. The trade will be queued
 * for automatic retry (if eligible) or dead-lettered.
 */
export function registerFailedTrade(params: {
  agentId: string;
  side: "buy" | "sell";
  symbol: string;
  quantity: string;
  error: string;
  errorCode: string;
  txSignature?: string;
  roundId?: string;
  metadata?: Record<string, unknown>;
}): FailedTrade {
  const recoveryId = generateRecoveryId();
  const now = new Date().toISOString();

  // Determine if this error is retryable
  const retryable = isRetryableError(params.errorCode);
  const maxAttempts = retryable ? currentRetryPolicy.maxAttempts : 0;

  const trade: FailedTrade = {
    recoveryId,
    agentId: params.agentId,
    side: params.side,
    symbol: params.symbol,
    quantity: params.quantity,
    error: params.error,
    errorCode: params.errorCode,
    attempts: 1,
    maxAttempts,
    firstAttemptAt: now,
    lastAttemptAt: now,
    nextRetryAt: retryable ? calculateNextRetry(1) : null,
    status: retryable ? "pending" : "dead_letter",
    txSignature: params.txSignature,
    roundId: params.roundId,
    metadata: params.metadata,
  };

  failedTrades.set(recoveryId, trade);

  // Enforce queue size limit
  if (failedTrades.size > MAX_QUEUE_SIZE) {
    const oldestKey = failedTrades.keys().next().value;
    if (oldestKey) failedTrades.delete(oldestKey);
  }

  // Log the event
  logRecoveryActivity(
    recoveryId,
    "registered",
    retryable ? "queued_for_retry" : "dead_lettered",
    `${params.side} ${params.quantity} ${params.symbol}: ${params.error}`,
  );

  logTradeFailure(
    `Trade failed: ${params.side} ${params.quantity} ${params.symbol}`,
    params.agentId,
    params.error,
    params.roundId,
    {
      recoveryId,
      errorCode: params.errorCode,
      retryable,
      maxAttempts,
    },
  );

  return trade;
}

/**
 * Record a retry attempt for a failed trade.
 *
 * Returns the updated trade state. If all retries are exhausted,
 * moves the trade to dead_letter status.
 */
export function recordRetryAttempt(
  recoveryId: string,
  success: boolean,
  details?: string,
): FailedTrade | null {
  const trade = failedTrades.get(recoveryId);
  if (!trade) return null;

  trade.attempts++;
  trade.lastAttemptAt = new Date().toISOString();

  if (success) {
    trade.status = "recovered";
    trade.nextRetryAt = null;

    logRecoveryActivity(
      recoveryId,
      "retry_success",
      "recovered",
      details ?? `Trade recovered after ${trade.attempts} attempts`,
    );

    logTradeEvent(
      "trade_recovered",
      `Recovered ${trade.side} ${trade.quantity} ${trade.symbol}`,
      trade.agentId,
      trade.roundId,
      { recoveryId, attempts: trade.attempts },
    );
  } else if (trade.attempts >= trade.maxAttempts) {
    trade.status = "dead_letter";
    trade.nextRetryAt = null;

    logRecoveryActivity(
      recoveryId,
      "max_retries_exhausted",
      "dead_lettered",
      details ?? `All ${trade.maxAttempts} attempts failed`,
    );
  } else {
    trade.status = "pending";
    trade.nextRetryAt = calculateNextRetry(trade.attempts);

    logRecoveryActivity(
      recoveryId,
      "retry_failed",
      `retry_${trade.attempts}_of_${trade.maxAttempts}`,
      details ?? "Will retry",
    );
  }

  return trade;
}

/**
 * Mark a submitted-but-unconfirmed trade as stuck.
 *
 * Stuck trades need manual investigation — they may have succeeded
 * on-chain but the confirmation was lost.
 */
export function markTradeStuck(
  recoveryId: string,
  txSignature: string,
): FailedTrade | null {
  const trade = failedTrades.get(recoveryId);
  if (!trade) return null;

  trade.status = "stuck";
  trade.txSignature = txSignature;
  trade.nextRetryAt = null;

  logRecoveryActivity(
    recoveryId,
    "marked_stuck",
    "needs_manual_review",
    `Transaction ${txSignature} submitted but not confirmed`,
  );

  logSystemEvent(
    "trade_stuck",
    `Stuck trade detected: ${trade.side} ${trade.quantity} ${trade.symbol} (tx: ${txSignature})`,
    "warn",
    { recoveryId, agentId: trade.agentId },
  );

  return trade;
}

/**
 * Manually resolve a failed or stuck trade.
 *
 * Used by admins after manual investigation.
 */
export function resolveManually(
  recoveryId: string,
  resolution: "recovered" | "dead_letter",
  notes: string,
): FailedTrade | null {
  const trade = failedTrades.get(recoveryId);
  if (!trade) return null;

  trade.status = resolution;
  trade.nextRetryAt = null;

  logRecoveryActivity(
    recoveryId,
    "manual_resolution",
    resolution,
    notes,
  );

  return trade;
}

// ---------------------------------------------------------------------------
// Query Functions
// ---------------------------------------------------------------------------

/**
 * Get all trades pending retry.
 */
export function getPendingRetries(): FailedTrade[] {
  const now = new Date().toISOString();
  return [...failedTrades.values()]
    .filter(
      (t) =>
        t.status === "pending" &&
        t.nextRetryAt !== null &&
        t.nextRetryAt <= now,
    )
    .sort((a, b) => (a.nextRetryAt ?? "").localeCompare(b.nextRetryAt ?? ""));
}

/**
 * Get all dead-lettered trades.
 */
export function getDeadLetterQueue(): FailedTrade[] {
  return [...failedTrades.values()].filter((t) => t.status === "dead_letter");
}

/**
 * Get all stuck trades.
 */
export function getStuckTrades(): FailedTrade[] {
  return [...failedTrades.values()].filter((t) => t.status === "stuck");
}

/**
 * Get a specific failed trade by recovery ID.
 */
export function getFailedTrade(recoveryId: string): FailedTrade | null {
  return failedTrades.get(recoveryId) ?? null;
}

/**
 * Get all failed trades for an agent.
 */
export function getAgentFailedTrades(agentId: string): FailedTrade[] {
  return [...failedTrades.values()].filter((t) => t.agentId === agentId);
}

/**
 * Generate a comprehensive recovery report.
 */
export function getRecoveryReport(): RecoveryReport {
  const all = [...failedTrades.values()];

  const byErrorCode: Record<string, number> = {};
  const byAgent: Record<string, number> = {};
  const bySymbol: Record<string, number> = {};

  for (const trade of all) {
    byErrorCode[trade.errorCode] =
      (byErrorCode[trade.errorCode] ?? 0) + 1;
    byAgent[trade.agentId] = (byAgent[trade.agentId] ?? 0) + 1;
    bySymbol[trade.symbol] = (bySymbol[trade.symbol] ?? 0) + 1;
  }

  return {
    totalFailed: all.length,
    pendingRetry: all.filter((t) => t.status === "pending").length,
    deadLettered: all.filter((t) => t.status === "dead_letter").length,
    recovered: all.filter((t) => t.status === "recovered").length,
    stuck: all.filter((t) => t.status === "stuck").length,
    byErrorCode,
    byAgent,
    bySymbol,
    recentActivity: recoveryLog.slice(-20),
  };
}

// ---------------------------------------------------------------------------
// Retry Policy
// ---------------------------------------------------------------------------

/**
 * Update the retry policy.
 */
export function setRetryPolicy(
  updates: Partial<RetryPolicy>,
): RetryPolicy {
  currentRetryPolicy = { ...currentRetryPolicy, ...updates };
  return { ...currentRetryPolicy };
}

/**
 * Get the current retry policy.
 */
export function getRetryPolicy(): RetryPolicy {
  return { ...currentRetryPolicy };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determine if an error code represents a retryable failure.
 *
 * Retryable: network timeouts, RPC errors, temporary Jupiter issues
 * Non-retryable: insufficient balance, invalid parameters, stock not found
 */
function isRetryableError(errorCode: string): boolean {
  const retryableCodes = new Set([
    "jupiter_order_failed",
    "jupiter_execute_failed",
    "rpc_timeout",
    "rpc_error",
    "network_error",
    "rate_limited",
    "transaction_timeout",
    "slot_skipped",
  ]);

  const nonRetryableCodes = new Set([
    "insufficient_usdc_balance",
    "insufficient_sol_for_fees",
    "insufficient_stock_balance",
    "stock_not_found",
    "wallet_not_found",
    "invalid_amount",
    "position_limit_exceeded",
    "daily_loss_limit",
  ]);

  if (retryableCodes.has(errorCode)) return true;
  if (nonRetryableCodes.has(errorCode)) return false;

  // Default: retry unknown errors once
  return true;
}

/**
 * Calculate the next retry time using exponential backoff with optional jitter.
 */
function calculateNextRetry(attemptNumber: number): string {
  const delay = Math.min(
    currentRetryPolicy.initialDelayMs *
      Math.pow(currentRetryPolicy.backoffMultiplier, attemptNumber - 1),
    currentRetryPolicy.maxDelayMs,
  );

  const jitter = currentRetryPolicy.jitter
    ? Math.random() * delay * 0.3 // Up to 30% jitter
    : 0;

  const totalDelay = delay + jitter;
  return new Date(Date.now() + totalDelay).toISOString();
}

/**
 * Log a recovery activity.
 */
function logRecoveryActivity(
  recoveryId: string,
  action: string,
  result: string,
  details?: string,
): void {
  recoveryLog.push({
    recoveryId,
    action,
    timestamp: new Date().toISOString(),
    result,
    details,
  });

  // Keep bounded
  if (recoveryLog.length > 1000) {
    recoveryLog.splice(0, recoveryLog.length - 1000);
  }
}

// ---------------------------------------------------------------------------
// Automatic Stuck Trade Detection
// ---------------------------------------------------------------------------

/**
 * Scan for trades that appear stuck (submitted but not confirmed
 * within the threshold).
 *
 * Call periodically from the trading round orchestrator.
 */
export function detectStuckTrades(): FailedTrade[] {
  const now = Date.now();
  const stuckTrades: FailedTrade[] = [];

  for (const trade of failedTrades.values()) {
    if (trade.status === "submitted" && trade.txSignature) {
      const submittedAt = new Date(trade.lastAttemptAt).getTime();
      if (now - submittedAt > STUCK_THRESHOLD_MS) {
        trade.status = "stuck";
        stuckTrades.push(trade);

        logRecoveryActivity(
          trade.recoveryId,
          "auto_detected_stuck",
          "stuck",
          `Transaction submitted ${Math.round((now - submittedAt) / 1000)}s ago without confirmation`,
        );
      }
    }
  }

  return stuckTrades;
}

/**
 * Clear all recovery state (admin use).
 */
export function clearRecoveryState(): void {
  const count = failedTrades.size;
  failedTrades.clear();
  recoveryLog.length = 0;
  recoveryCounter = 0;

  logSystemEvent(
    "recovery_state_cleared",
    `Cleared ${count} failed trades from recovery queue`,
    "warn",
  );
}
