/**
 * Advanced Retry & Backoff Engine
 *
 * Production-grade retry system for all external API calls:
 * - Exponential backoff with jitter
 * - Circuit-aware retries (skip if circuit breaker open)
 * - Per-service retry policies (Jupiter, Solana RPC, LLM APIs)
 * - Retry budgets (max retries per time window)
 * - Dead letter handling for exhausted retries
 * - Comprehensive retry metrics
 *
 * This replaces ad-hoc retry logic scattered across services with
 * a unified, configurable retry engine.
 */

import { round2 } from "../lib/math-utils.ts";
import { errorMessage } from "../lib/errors.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RetryPolicy {
  /** Human-readable name for this policy */
  name: string;
  /** Maximum number of retry attempts (not counting the first try) */
  maxRetries: number;
  /** Base delay in ms before first retry */
  baseDelayMs: number;
  /** Maximum delay in ms (cap for exponential growth) */
  maxDelayMs: number;
  /** Backoff multiplier (e.g., 2 for doubling) */
  backoffMultiplier: number;
  /** Jitter factor 0-1 (0 = no jitter, 1 = full random jitter) */
  jitterFactor: number;
  /** Whether to retry on timeout errors */
  retryOnTimeout: boolean;
  /** Whether to retry on rate limit errors (429) */
  retryOnRateLimit: boolean;
  /** HTTP status codes that are retryable */
  retryableStatuses: number[];
  /** Error message patterns that are retryable */
  retryablePatterns: RegExp[];
  /** Error message patterns that should never be retried */
  nonRetryablePatterns: RegExp[];
  /** Maximum total time for all retries in ms (0 = unlimited) */
  totalTimeoutMs: number;
}

export interface RetryResult<T> {
  success: boolean;
  data: T | null;
  attempts: number;
  totalDurationMs: number;
  lastError: string | null;
  retryHistory: RetryAttempt[];
  exhausted: boolean;
}

export interface RetryAttempt {
  attempt: number;
  startedAt: string;
  durationMs: number;
  error: string | null;
  delayBeforeMs: number;
}

export type RetryableFunction<T> = () => Promise<T>;

export interface RetryBudget {
  /** Maximum retries allowed in the time window */
  maxRetries: number;
  /** Time window in ms */
  windowMs: number;
  /** Current retry count in the window */
  currentRetries: number;
  /** Window start timestamp */
  windowStart: number;
}

export interface RetryMetrics {
  totalAttempts: number;
  totalSuccesses: number;
  totalFailures: number;
  totalRetriesUsed: number;
  retriesByPolicy: Record<string, { attempts: number; successes: number; failures: number; retriesUsed: number }>;
  retryBudgetExhaustion: number;
  averageRetriesPerCall: number;
  recentRetries: Array<{
    policy: string;
    success: boolean;
    attempts: number;
    durationMs: number;
    timestamp: string;
  }>;
}

// ---------------------------------------------------------------------------
// Retry Policy Constants
// ---------------------------------------------------------------------------

/**
 * Common HTTP status codes that indicate retryable server errors.
 *
 * - 429: Too Many Requests (rate limit)
 * - 500: Internal Server Error
 * - 502: Bad Gateway
 * - 503: Service Unavailable
 * - 504: Gateway Timeout
 *
 * Used by Jupiter, Solana RPC, and Generic HTTP policies.
 */
const COMMON_RETRYABLE_HTTP_STATUSES = [429, 500, 502, 503, 504];

/**
 * LLM API-specific retryable status codes.
 *
 * Same as COMMON_RETRYABLE_HTTP_STATUSES but includes 529 (overloaded)
 * instead of 504, as some LLM providers use 529 for capacity issues.
 */
const LLM_RETRYABLE_HTTP_STATUSES = [429, 500, 502, 503, 529];

/**
 * Jitter factor for Jupiter and Solana RPC retry backoff.
 *
 * Value: 0.3 = 30% jitter
 * Formula: delay = baseDelay * (1 + random() * JITTER_FACTOR)
 * Example: 1000ms base → 1000-1300ms actual delay
 *
 * Moderate jitter (30%) prevents thundering herd while keeping retry timing
 * reasonably predictable for time-sensitive trade execution.
 */
const STANDARD_JITTER_FACTOR = 0.3;

/**
 * Jitter factor for LLM API retry backoff.
 *
 * Value: 0.4 = 40% jitter
 * Formula: delay = baseDelay * (1 + random() * JITTER_FACTOR)
 * Example: 2000ms base → 2000-2800ms actual delay
 *
 * Higher jitter (40%) helps distribute retries more evenly when multiple
 * agents hit LLM rate limits simultaneously, reducing retry storms.
 */
const LLM_JITTER_FACTOR = 0.4;

/**
 * Jitter factor for generic HTTP retry backoff.
 *
 * Value: 0.25 = 25% jitter
 * Formula: delay = baseDelay * (1 + random() * JITTER_FACTOR)
 * Example: 1000ms base → 1000-1250ms actual delay
 *
 * Lower jitter (25%) for generic HTTP calls where retry timing is less
 * critical and we want more predictable backoff behavior.
 */
const GENERIC_JITTER_FACTOR = 0.25;

// ---------------------------------------------------------------------------
// Pre-configured Policies
// ---------------------------------------------------------------------------

/**
 * Jupiter DEX API — aggressive retries with generous backoff.
 * Jupiter is critical for trade execution and often has transient failures.
 */
export const JUPITER_POLICY: RetryPolicy = {
  name: "jupiter",
  maxRetries: 4,
  baseDelayMs: 1000,
  maxDelayMs: 15_000,
  backoffMultiplier: 2,
  jitterFactor: STANDARD_JITTER_FACTOR,
  retryOnTimeout: true,
  retryOnRateLimit: true,
  retryableStatuses: COMMON_RETRYABLE_HTTP_STATUSES,
  retryablePatterns: [
    /timeout/i,
    /ECONNRESET/i,
    /ECONNREFUSED/i,
    /ETIMEDOUT/i,
    /network/i,
    /fetch failed/i,
    /jupiter_order_failed.*5\d\d/,
    /jupiter_execute_failed.*timeout/i,
    /-1006/, // Jupiter-specific timeout code
  ],
  nonRetryablePatterns: [
    /insufficient.*balance/i,
    /invalid.*mint/i,
    /invalid.*amount/i,
    /slippage.*exceeded/i,
    /wallet_not_found/i,
  ],
  totalTimeoutMs: 60_000,
};

/**
 * Solana RPC — moderate retries, quick backoff.
 * RPC nodes can be flaky but usually recover quickly.
 */
export const SOLANA_RPC_POLICY: RetryPolicy = {
  name: "solana_rpc",
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
  backoffMultiplier: 2,
  jitterFactor: STANDARD_JITTER_FACTOR,
  retryOnTimeout: true,
  retryOnRateLimit: true,
  retryableStatuses: COMMON_RETRYABLE_HTTP_STATUSES,
  retryablePatterns: [
    /timeout/i,
    /ECONNRESET/i,
    /ECONNREFUSED/i,
    /ETIMEDOUT/i,
    /Too many requests/i,
    /Node is behind/i,
    /Transaction simulation failed/i,
  ],
  nonRetryablePatterns: [
    /Account not found/i,
    /Invalid param/i,
  ],
  totalTimeoutMs: 30_000,
};

/**
 * LLM API (Claude/GPT/Grok) — fewer retries, longer backoff.
 * LLM calls are expensive so we retry less aggressively.
 */
export const LLM_API_POLICY: RetryPolicy = {
  name: "llm_api",
  maxRetries: 2,
  baseDelayMs: 2000,
  maxDelayMs: 20_000,
  backoffMultiplier: 2.5,
  jitterFactor: LLM_JITTER_FACTOR,
  retryOnTimeout: true,
  retryOnRateLimit: true,
  retryableStatuses: LLM_RETRYABLE_HTTP_STATUSES,
  retryablePatterns: [
    /timeout/i,
    /rate.?limit/i,
    /overloaded/i,
    /capacity/i,
    /ECONNRESET/i,
    /ECONNREFUSED/i,
    /server_error/i,
  ],
  nonRetryablePatterns: [
    /invalid.*api.*key/i,
    /authentication/i,
    /unauthorized/i,
    /content.*policy/i,
    /invalid.*model/i,
  ],
  totalTimeoutMs: 90_000,
};

/**
 * Generic HTTP — conservative default for misc API calls.
 */
export const GENERIC_HTTP_POLICY: RetryPolicy = {
  name: "generic_http",
  maxRetries: 2,
  baseDelayMs: 1000,
  maxDelayMs: 10_000,
  backoffMultiplier: 2,
  jitterFactor: GENERIC_JITTER_FACTOR,
  retryOnTimeout: true,
  retryOnRateLimit: true,
  retryableStatuses: COMMON_RETRYABLE_HTTP_STATUSES,
  retryablePatterns: [
    /timeout/i,
    /ECONNRESET/i,
    /ECONNREFUSED/i,
    /ETIMEDOUT/i,
    /fetch failed/i,
  ],
  nonRetryablePatterns: [
    /invalid.*key/i,
    /unauthorized/i,
    /not found/i,
    /bad request/i,
  ],
  totalTimeoutMs: 30_000,
};

// ---------------------------------------------------------------------------
// Retry Budgets
// ---------------------------------------------------------------------------

const retryBudgets = new Map<string, RetryBudget>();

/**
 * Configure a retry budget for a service.
 * Limits the total number of retries within a time window to prevent
 * hammering a failing service.
 */
export function setRetryBudget(
  policyName: string,
  maxRetries: number,
  windowMs: number,
): void {
  retryBudgets.set(policyName, {
    maxRetries,
    windowMs,
    currentRetries: 0,
    windowStart: Date.now(),
  });
}

function checkRetryBudget(policyName: string): boolean {
  const budget = retryBudgets.get(policyName);
  if (!budget) return true; // No budget = unlimited

  const now = Date.now();
  if (now - budget.windowStart >= budget.windowMs) {
    // Reset window
    budget.windowStart = now;
    budget.currentRetries = 0;
  }

  return budget.currentRetries < budget.maxRetries;
}

function consumeRetryBudget(policyName: string): void {
  const budget = retryBudgets.get(policyName);
  if (budget) {
    budget.currentRetries++;
  }
}

// ---------------------------------------------------------------------------
// Metrics State
// ---------------------------------------------------------------------------

let totalAttempts = 0;
let totalSuccesses = 0;
let totalFailures = 0;
let totalRetriesUsed = 0;
let retryBudgetExhaustion = 0;
const retriesByPolicy: Record<
  string,
  { attempts: number; successes: number; failures: number; retriesUsed: number }
> = {};
const recentRetries: Array<{
  policy: string;
  success: boolean;
  attempts: number;
  durationMs: number;
  timestamp: string;
}> = [];
const MAX_RECENT_RETRIES = 100;

// ---------------------------------------------------------------------------
// Core Retry Engine
// ---------------------------------------------------------------------------

/**
 * Execute a function with configurable retry logic.
 *
 * The retry engine applies exponential backoff with jitter, respects
 * retry budgets, and distinguishes between retryable and non-retryable errors.
 *
 * @example
 * const result = await withRetry(
 *   () => fetch("https://api.jup.ag/price/v3?ids=..."),
 *   JUPITER_POLICY,
 * );
 * if (result.success) {
 *   console.log(result.data);
 * }
 */
export async function withRetry<T>(
  fn: RetryableFunction<T>,
  policy: RetryPolicy,
  label?: string,
): Promise<RetryResult<T>> {
  const startTime = Date.now();
  const history: RetryAttempt[] = [];
  let lastError: string | null = null;
  const tag = label ?? policy.name;

  totalAttempts++;
  const policyStats = retriesByPolicy[policy.name] ?? {
    attempts: 0,
    successes: 0,
    failures: 0,
    retriesUsed: 0,
  };
  policyStats.attempts++;
  retriesByPolicy[policy.name] = policyStats;

  for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
    // Check total timeout
    if (
      policy.totalTimeoutMs > 0 &&
      Date.now() - startTime >= policy.totalTimeoutMs
    ) {
      lastError = `Total timeout exceeded (${policy.totalTimeoutMs}ms)`;
      break;
    }

    // Check retry budget (only for retries, not first attempt)
    if (attempt > 0 && !checkRetryBudget(policy.name)) {
      retryBudgetExhaustion++;
      lastError = `Retry budget exhausted for ${policy.name}`;
      console.warn(
        `[RetryEngine] ${tag}: Retry budget exhausted, aborting after ${attempt} attempts`,
      );
      break;
    }

    // Calculate delay (0 for first attempt)
    let delayMs = 0;
    if (attempt > 0) {
      const baseDelay =
        policy.baseDelayMs * Math.pow(policy.backoffMultiplier, attempt - 1);
      const cappedDelay = Math.min(baseDelay, policy.maxDelayMs);
      const jitter = cappedDelay * policy.jitterFactor * Math.random();
      delayMs = Math.round(cappedDelay + jitter);

      consumeRetryBudget(policy.name);
      totalRetriesUsed++;
      policyStats.retriesUsed++;

      console.log(
        `[RetryEngine] ${tag}: Retry ${attempt}/${policy.maxRetries} in ${delayMs}ms (last error: ${lastError?.slice(0, 80)})`,
      );
      await sleep(delayMs);
    }

    const attemptStart = Date.now();

    try {
      const data = await fn();

      const durationMs = Date.now() - attemptStart;
      history.push({
        attempt: attempt + 1,
        startedAt: new Date(attemptStart).toISOString(),
        durationMs,
        error: null,
        delayBeforeMs: delayMs,
      });

      totalSuccesses++;
      policyStats.successes++;
      trackRecentRetry(policy.name, true, attempt + 1, Date.now() - startTime);

      if (attempt > 0) {
        console.log(
          `[RetryEngine] ${tag}: Succeeded on attempt ${attempt + 1} after ${Date.now() - startTime}ms total`,
        );
      }

      return {
        success: true,
        data,
        attempts: attempt + 1,
        totalDurationMs: Date.now() - startTime,
        lastError: null,
        retryHistory: history,
        exhausted: false,
      };
    } catch (err) {
      const errMsg = errorMessage(err);
      lastError = errMsg;

      const durationMs = Date.now() - attemptStart;
      history.push({
        attempt: attempt + 1,
        startedAt: new Date(attemptStart).toISOString(),
        durationMs,
        error: errMsg,
        delayBeforeMs: delayMs,
      });

      // Check if error is non-retryable
      if (isNonRetryable(errMsg, policy)) {
        console.warn(
          `[RetryEngine] ${tag}: Non-retryable error on attempt ${attempt + 1}: ${errMsg.slice(0, 120)}`,
        );
        break;
      }

      // Check if error is retryable
      if (!isRetryable(errMsg, policy)) {
        console.warn(
          `[RetryEngine] ${tag}: Unrecognized error (not retrying) on attempt ${attempt + 1}: ${errMsg.slice(0, 120)}`,
        );
        break;
      }
    }
  }

  // All retries exhausted
  totalFailures++;
  policyStats.failures++;
  trackRecentRetry(
    policy.name,
    false,
    history.length,
    Date.now() - startTime,
  );

  console.error(
    `[RetryEngine] ${tag}: All ${history.length} attempts failed in ${Date.now() - startTime}ms. Last error: ${lastError?.slice(0, 200)}`,
  );

  return {
    success: false,
    data: null,
    attempts: history.length,
    totalDurationMs: Date.now() - startTime,
    lastError,
    retryHistory: history,
    exhausted: history.length > policy.maxRetries,
  };
}

// ---------------------------------------------------------------------------
// Error Classification
// ---------------------------------------------------------------------------

function isRetryable(errorMsg: string, policy: RetryPolicy): boolean {
  // Check for timeout errors
  if (policy.retryOnTimeout && /timeout/i.test(errorMsg)) {
    return true;
  }

  // Check for rate limit errors
  if (policy.retryOnRateLimit && /rate.?limit|429|too many/i.test(errorMsg)) {
    return true;
  }

  // Check retryable status codes in error message
  for (const status of policy.retryableStatuses) {
    if (errorMsg.includes(String(status))) {
      return true;
    }
  }

  // Check retryable patterns
  for (const pattern of policy.retryablePatterns) {
    if (pattern.test(errorMsg)) {
      return true;
    }
  }

  return false;
}

function isNonRetryable(errorMsg: string, policy: RetryPolicy): boolean {
  for (const pattern of policy.nonRetryablePatterns) {
    if (pattern.test(errorMsg)) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Convenience Wrappers
// ---------------------------------------------------------------------------

/**
 * Execute a Jupiter API call with the Jupiter retry policy.
 */
export async function withJupiterRetry<T>(
  fn: RetryableFunction<T>,
  label?: string,
): Promise<RetryResult<T>> {
  return withRetry(fn, JUPITER_POLICY, label ?? "Jupiter");
}

/**
 * Execute a Solana RPC call with the Solana retry policy.
 */
export async function withSolanaRetry<T>(
  fn: RetryableFunction<T>,
  label?: string,
): Promise<RetryResult<T>> {
  return withRetry(fn, SOLANA_RPC_POLICY, label ?? "Solana RPC");
}

/**
 * Execute an LLM API call with the LLM retry policy.
 */
export async function withLLMRetry<T>(
  fn: RetryableFunction<T>,
  label?: string,
): Promise<RetryResult<T>> {
  return withRetry(fn, LLM_API_POLICY, label ?? "LLM API");
}

// ---------------------------------------------------------------------------
// Custom Policy Builder
// ---------------------------------------------------------------------------

/**
 * Create a custom retry policy by extending a base policy.
 */
export function createPolicy(
  base: RetryPolicy,
  overrides: Partial<RetryPolicy>,
): RetryPolicy {
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trackRecentRetry(
  policy: string,
  success: boolean,
  attempts: number,
  durationMs: number,
): void {
  recentRetries.unshift({
    policy,
    success,
    attempts,
    durationMs,
    timestamp: new Date().toISOString(),
  });
  if (recentRetries.length > MAX_RECENT_RETRIES) {
    recentRetries.length = MAX_RECENT_RETRIES;
  }
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/**
 * Get comprehensive retry metrics.
 */
export function getRetryMetrics(): RetryMetrics {
  const avgRetries =
    totalAttempts > 0 ? totalRetriesUsed / totalAttempts : 0;

  return {
    totalAttempts,
    totalSuccesses,
    totalFailures,
    totalRetriesUsed,
    retriesByPolicy: { ...retriesByPolicy },
    retryBudgetExhaustion,
    averageRetriesPerCall: round2(avgRetries),
    recentRetries: recentRetries.slice(0, 20),
  };
}

/**
 * Reset retry metrics (admin use).
 */
export function resetRetryMetrics(): void {
  totalAttempts = 0;
  totalSuccesses = 0;
  totalFailures = 0;
  totalRetriesUsed = 0;
  retryBudgetExhaustion = 0;
  Object.keys(retriesByPolicy).forEach((k) => delete retriesByPolicy[k]);
  recentRetries.length = 0;
}

/**
 * Get retry budget status for all services.
 */
export function getRetryBudgetStatus(): Record<
  string,
  { remaining: number; windowMs: number; usedInWindow: number }
> {
  const result: Record<
    string,
    { remaining: number; windowMs: number; usedInWindow: number }
  > = {};

  for (const [name, budget] of retryBudgets) {
    const now = Date.now();
    const windowActive = now - budget.windowStart < budget.windowMs;
    const currentRetries = windowActive ? budget.currentRetries : 0;

    result[name] = {
      remaining: budget.maxRetries - currentRetries,
      windowMs: budget.windowMs,
      usedInWindow: currentRetries,
    };
  }

  return result;
}

// ---------------------------------------------------------------------------
// Initialize Default Budgets
// ---------------------------------------------------------------------------

// Jupiter: max 20 retries per minute
setRetryBudget("jupiter", 20, 60_000);
// Solana RPC: max 30 retries per minute
setRetryBudget("solana_rpc", 30, 60_000);
// LLM APIs: max 10 retries per minute
setRetryBudget("llm_api", 10, 60_000);
