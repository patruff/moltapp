/**
 * Production Hardening Layer
 *
 * Critical safety infrastructure for live trading:
 *
 * 1. Agent Timeout Protection — 30s hard limit on LLM calls
 * 2. Emergency Kill Switch — halt all trading instantly
 * 3. Market Data Staleness Detection — reject stale prices
 * 4. Agent Execution Order Randomization — prevent first-mover bias
 * 5. Round Timeout — abort entire round if it takes too long
 * 6. Health Monitoring — detect degraded service state
 *
 * This module wraps the orchestrator's trading pipeline with production
 * safety guarantees that the base system doesn't provide.
 */

import type { TradingDecision, MarketData, PortfolioContext } from "../agents/base-agent.ts";
import { errorMessage } from "../lib/errors.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentTimeoutConfig {
  /** Max time for an agent's analyze() call in ms (default: 30000) */
  analyzeTimeoutMs: number;
  /** Max time for trade execution in ms (default: 15000) */
  executionTimeoutMs: number;
  /** Max time for the entire round in ms (default: 240000 = 4 min) */
  roundTimeoutMs: number;
}

export interface EmergencyState {
  /** Whether trading is globally halted */
  halted: boolean;
  /** Who triggered the halt */
  haltedBy: string | null;
  /** When the halt was triggered */
  haltedAt: string | null;
  /** Reason for the halt */
  reason: string | null;
  /** Auto-resume time (ISO string) or null if manual resume required */
  autoResumeAt: string | null;
}

export interface MarketDataFreshness {
  /** Whether the data is considered fresh enough for trading */
  fresh: boolean;
  /** Data age in seconds */
  ageSeconds: number;
  /** Maximum allowed age in seconds */
  maxAgeSeconds: number;
  /** Number of stocks with real (non-mock) prices */
  realPriceCount: number;
  /** Total stocks */
  totalStocks: number;
  /** Percentage of stocks with real prices */
  realPricePercent: number;
}

export interface HealthStatus {
  /** Overall health: "healthy", "degraded", "critical" */
  status: "healthy" | "degraded" | "critical";
  /** Individual check results */
  checks: HealthCheck[];
  /** Last health check time */
  checkedAt: string;
}

export interface HealthCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
  value?: number;
}

export interface HardeningMetrics {
  agentTimeouts: number;
  executionTimeouts: number;
  roundTimeouts: number;
  emergencyHalts: number;
  staleDataRejections: number;
  totalRoundsProtected: number;
  consecutiveFailures: number;
  lastSuccessfulRound: string | null;
  agentTimeoutsByAgent: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_CONFIG: AgentTimeoutConfig = {
  analyzeTimeoutMs: 30_000,
  executionTimeoutMs: 15_000,
  roundTimeoutMs: 240_000,
};

const MAX_MARKET_DATA_AGE_SECONDS = 120; // 2 minutes
const MIN_REAL_PRICE_PERCENT = 30; // At least 30% of prices must be real
const MAX_CONSECUTIVE_FAILURES = 5; // Auto-halt after 5 consecutive failures
const JUPITER_FAILURE_THRESHOLD = 3; // Halt after 3 consecutive Jupiter failures

let timeoutConfig: AgentTimeoutConfig = { ...DEFAULT_TIMEOUT_CONFIG };

// ---------------------------------------------------------------------------
// Emergency Kill Switch State
// ---------------------------------------------------------------------------

const emergencyState: EmergencyState = {
  halted: false,
  haltedBy: null,
  haltedAt: null,
  reason: null,
  autoResumeAt: null,
};

// ---------------------------------------------------------------------------
// Metrics State
// ---------------------------------------------------------------------------

let metrics: HardeningMetrics = {
  agentTimeouts: 0,
  executionTimeouts: 0,
  roundTimeouts: 0,
  emergencyHalts: 0,
  staleDataRejections: 0,
  totalRoundsProtected: 0,
  consecutiveFailures: 0,
  lastSuccessfulRound: null,
  agentTimeoutsByAgent: {},
};

let jupiterConsecutiveFailures = 0;

// ---------------------------------------------------------------------------
// Agent Timeout Protection
// ---------------------------------------------------------------------------

/**
 * Wrap an agent's analyze() call with a hard timeout.
 *
 * If the agent doesn't respond within the configured timeout,
 * returns a fallback "hold" decision and logs the timeout.
 */
export async function withAgentTimeout(
  agentId: string,
  agentName: string,
  analyzeFn: () => Promise<TradingDecision>,
  overrideTimeoutMs?: number,
): Promise<{ decision: TradingDecision; timedOut: boolean }> {
  const timeout = overrideTimeoutMs ?? timeoutConfig.analyzeTimeoutMs;

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error(`AGENT_TIMEOUT: ${agentName} did not respond within ${timeout}ms`)),
      timeout,
    );
  });

  try {
    const decision = await Promise.race([analyzeFn(), timeoutPromise]);
    return { decision, timedOut: false };
  } catch (err) {
    const errMsg = errorMessage(err);

    if (errMsg.startsWith("AGENT_TIMEOUT:")) {
      metrics.agentTimeouts++;
      metrics.agentTimeoutsByAgent[agentId] =
        (metrics.agentTimeoutsByAgent[agentId] ?? 0) + 1;

      console.error(
        `[Hardening] AGENT TIMEOUT: ${agentName} (${agentId}) failed to respond in ${timeout}ms. Defaulting to hold.`,
      );

      return {
        decision: {
          action: "hold",
          symbol: "SPYx",
          quantity: 0,
          reasoning: `[Production Hardening: Agent Timeout] ${agentName} did not respond within ${timeout}ms. Defaulting to safe hold position.`,
          confidence: 0,
          timestamp: new Date().toISOString(),
        },
        timedOut: true,
      };
    }

    // Non-timeout error — rethrow
    throw err;
  }
}

/**
 * Wrap a trade execution with a hard timeout.
 */
export async function withExecutionTimeout<T>(
  label: string,
  executeFn: () => Promise<T>,
  overrideTimeoutMs?: number,
): Promise<{ result: T | null; timedOut: boolean; error?: string }> {
  const timeout = overrideTimeoutMs ?? timeoutConfig.executionTimeoutMs;

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error(`EXECUTION_TIMEOUT: ${label} did not complete within ${timeout}ms`)),
      timeout,
    );
  });

  try {
    const result = await Promise.race([executeFn(), timeoutPromise]);
    return { result, timedOut: false };
  } catch (err) {
    const errMsg = errorMessage(err);

    if (errMsg.startsWith("EXECUTION_TIMEOUT:")) {
      metrics.executionTimeouts++;
      console.error(
        `[Hardening] EXECUTION TIMEOUT: ${label} did not complete in ${timeout}ms`,
      );
      return { result: null, timedOut: true, error: errMsg };
    }

    return { result: null, timedOut: false, error: errMsg };
  }
}

/**
 * Wrap an entire trading round with a hard timeout.
 */
export async function withRoundTimeout<T>(
  roundId: string,
  roundFn: () => Promise<T>,
  overrideTimeoutMs?: number,
): Promise<{ result: T | null; timedOut: boolean }> {
  const timeout = overrideTimeoutMs ?? timeoutConfig.roundTimeoutMs;

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error(`ROUND_TIMEOUT: Round ${roundId} did not complete within ${timeout}ms`)),
      timeout,
    );
  });

  metrics.totalRoundsProtected++;

  try {
    const result = await Promise.race([roundFn(), timeoutPromise]);
    metrics.consecutiveFailures = 0;
    metrics.lastSuccessfulRound = new Date().toISOString();
    return { result, timedOut: false };
  } catch (err) {
    const errMsg = errorMessage(err);

    if (errMsg.startsWith("ROUND_TIMEOUT:")) {
      metrics.roundTimeouts++;
      metrics.consecutiveFailures++;
      console.error(
        `[Hardening] ROUND TIMEOUT: Round ${roundId} exceeded ${timeout}ms limit`,
      );

      // Auto-halt after too many consecutive failures
      if (metrics.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        emergencyHalt(
          "system",
          `Auto-halted after ${MAX_CONSECUTIVE_FAILURES} consecutive round failures`,
          60 * 15, // 15 minute auto-resume
        );
      }

      return { result: null, timedOut: true };
    }

    metrics.consecutiveFailures++;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Emergency Kill Switch
// ---------------------------------------------------------------------------

/**
 * Halt all trading immediately.
 *
 * @param triggeredBy - Who triggered the halt (e.g., "admin", "system", "circuit_breaker")
 * @param reason - Why trading was halted
 * @param autoResumeSeconds - If set, automatically resume after this many seconds
 */
export function emergencyHalt(
  triggeredBy: string,
  reason: string,
  autoResumeSeconds?: number,
): EmergencyState {
  emergencyState.halted = true;
  emergencyState.haltedBy = triggeredBy;
  emergencyState.haltedAt = new Date().toISOString();
  emergencyState.reason = reason;

  if (autoResumeSeconds) {
    const resumeAt = new Date(Date.now() + autoResumeSeconds * 1000);
    emergencyState.autoResumeAt = resumeAt.toISOString();
  } else {
    emergencyState.autoResumeAt = null;
  }

  metrics.emergencyHalts++;

  console.error(
    `[Hardening] EMERGENCY HALT triggered by ${triggeredBy}: ${reason}` +
      (autoResumeSeconds
        ? ` (auto-resume in ${autoResumeSeconds}s)`
        : " (manual resume required)"),
  );

  return { ...emergencyState };
}

/**
 * Resume trading after an emergency halt.
 */
export function emergencyResume(resumedBy: string): EmergencyState {
  if (!emergencyState.halted) {
    return { ...emergencyState };
  }

  console.log(
    `[Hardening] Trading RESUMED by ${resumedBy} (was halted by ${emergencyState.haltedBy}: ${emergencyState.reason})`,
  );

  emergencyState.halted = false;
  emergencyState.haltedBy = null;
  emergencyState.haltedAt = null;
  emergencyState.reason = null;
  emergencyState.autoResumeAt = null;

  // Reset consecutive failure counter
  metrics.consecutiveFailures = 0;
  jupiterConsecutiveFailures = 0;

  return { ...emergencyState };
}

/**
 * Check if trading is currently halted.
 * Also handles auto-resume if the resume time has passed.
 */
export function isTradingHalted(): {
  halted: boolean;
  reason: string | null;
} {
  if (!emergencyState.halted) {
    return { halted: false, reason: null };
  }

  // Check auto-resume
  if (emergencyState.autoResumeAt) {
    const resumeTime = new Date(emergencyState.autoResumeAt).getTime();
    if (Date.now() >= resumeTime) {
      console.log(
        `[Hardening] Auto-resuming trading (halt expired at ${emergencyState.autoResumeAt})`,
      );
      emergencyResume("auto-resume");
      return { halted: false, reason: null };
    }
  }

  return { halted: true, reason: emergencyState.reason };
}

/**
 * Get the current emergency state.
 */
export function getEmergencyState(): EmergencyState {
  // Trigger auto-resume check
  isTradingHalted();
  return { ...emergencyState };
}

// ---------------------------------------------------------------------------
// Market Data Freshness
// ---------------------------------------------------------------------------

/** Track when market data was last fetched */
let lastMarketDataFetch: number = 0;
let lastRealPriceCount: number = 0;
let lastTotalStockCount: number = 0;

/**
 * Record a market data fetch and its quality.
 */
export function recordMarketDataFetch(
  realPriceCount: number,
  totalStocks: number,
): void {
  lastMarketDataFetch = Date.now();
  lastRealPriceCount = realPriceCount;
  lastTotalStockCount = totalStocks;
}

/**
 * Check if market data is fresh enough for trading.
 */
export function checkMarketDataFreshness(): MarketDataFreshness {
  const ageSeconds =
    lastMarketDataFetch > 0
      ? (Date.now() - lastMarketDataFetch) / 1000
      : Infinity;

  const realPercent =
    lastTotalStockCount > 0
      ? (lastRealPriceCount / lastTotalStockCount) * 100
      : 0;

  const fresh =
    ageSeconds <= MAX_MARKET_DATA_AGE_SECONDS &&
    realPercent >= MIN_REAL_PRICE_PERCENT;

  if (!fresh && lastMarketDataFetch > 0) {
    metrics.staleDataRejections++;
  }

  return {
    fresh,
    ageSeconds: Math.round(ageSeconds),
    maxAgeSeconds: MAX_MARKET_DATA_AGE_SECONDS,
    realPriceCount: lastRealPriceCount,
    totalStocks: lastTotalStockCount,
    realPricePercent: Math.round(realPercent * 10) / 10,
  };
}

// ---------------------------------------------------------------------------
// Jupiter Failure Tracking
// ---------------------------------------------------------------------------

/**
 * Record a Jupiter API failure. Auto-halts after threshold consecutive failures.
 */
export function recordJupiterFailure(): void {
  jupiterConsecutiveFailures++;

  if (jupiterConsecutiveFailures >= JUPITER_FAILURE_THRESHOLD) {
    emergencyHalt(
      "jupiter-monitor",
      `Jupiter API has failed ${jupiterConsecutiveFailures} consecutive times. Auto-halting to prevent mock-price trading.`,
      60 * 5, // 5 minute auto-resume
    );
  }
}

/**
 * Record a successful Jupiter API call. Resets the failure counter.
 */
export function recordJupiterSuccess(): void {
  jupiterConsecutiveFailures = 0;
}

/**
 * Get Jupiter failure count.
 */
export function getJupiterFailureCount(): number {
  return jupiterConsecutiveFailures;
}

// ---------------------------------------------------------------------------
// Agent Execution Order Randomization
// ---------------------------------------------------------------------------

/**
 * Shuffle an array of agents to randomize execution order.
 * Prevents first-mover advantage in sequential execution.
 * Uses Fisher-Yates shuffle for uniform distribution.
 */
export function shuffleAgentOrder<T>(agents: T[]): T[] {
  const shuffled = [...agents];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// ---------------------------------------------------------------------------
// Health Monitoring
// ---------------------------------------------------------------------------

/**
 * Run a comprehensive health check of the trading system.
 */
export function checkHealth(): HealthStatus {
  const checks: HealthCheck[] = [];

  // Check 1: Emergency halt status
  const haltStatus = isTradingHalted();
  checks.push({
    name: "emergency_halt",
    status: haltStatus.halted ? "fail" : "pass",
    message: haltStatus.halted
      ? `Trading halted: ${haltStatus.reason}`
      : "Trading active",
  });

  // Check 2: Consecutive failures
  checks.push({
    name: "consecutive_failures",
    status:
      metrics.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES
        ? "fail"
        : metrics.consecutiveFailures >= 3
          ? "warn"
          : "pass",
    message: `${metrics.consecutiveFailures} consecutive round failures`,
    value: metrics.consecutiveFailures,
  });

  // Check 3: Market data freshness
  const freshness = checkMarketDataFreshness();
  checks.push({
    name: "market_data_freshness",
    status: freshness.fresh
      ? "pass"
      : freshness.ageSeconds > MAX_MARKET_DATA_AGE_SECONDS * 2
        ? "fail"
        : "warn",
    message: `Data age: ${freshness.ageSeconds}s, real prices: ${freshness.realPricePercent}%`,
    value: freshness.ageSeconds,
  });

  // Check 4: Jupiter API health
  checks.push({
    name: "jupiter_api",
    status:
      jupiterConsecutiveFailures >= JUPITER_FAILURE_THRESHOLD
        ? "fail"
        : jupiterConsecutiveFailures >= 2
          ? "warn"
          : "pass",
    message: `${jupiterConsecutiveFailures} consecutive Jupiter failures`,
    value: jupiterConsecutiveFailures,
  });

  // Check 5: Agent timeouts
  const recentTimeoutRate =
    metrics.totalRoundsProtected > 0
      ? metrics.agentTimeouts / metrics.totalRoundsProtected
      : 0;
  checks.push({
    name: "agent_timeouts",
    status:
      recentTimeoutRate > 0.5
        ? "fail"
        : recentTimeoutRate > 0.2
          ? "warn"
          : "pass",
    message: `${metrics.agentTimeouts} total timeouts across ${metrics.totalRoundsProtected} rounds (${(recentTimeoutRate * 100).toFixed(1)}% rate)`,
    value: metrics.agentTimeouts,
  });

  // Check 6: Last successful round
  if (metrics.lastSuccessfulRound) {
    const ageMs =
      Date.now() - new Date(metrics.lastSuccessfulRound).getTime();
    const ageMinutes = ageMs / 60_000;
    checks.push({
      name: "last_successful_round",
      status:
        ageMinutes > 90 ? "fail" : ageMinutes > 45 ? "warn" : "pass",
      message: `Last success: ${Math.round(ageMinutes)} minutes ago`,
      value: Math.round(ageMinutes),
    });
  } else {
    checks.push({
      name: "last_successful_round",
      status: "warn",
      message: "No successful rounds recorded yet",
    });
  }

  // Determine overall status
  const hasFail = checks.some((c) => c.status === "fail");
  const hasWarn = checks.some((c) => c.status === "warn");
  const overallStatus = hasFail ? "critical" : hasWarn ? "degraded" : "healthy";

  return {
    status: overallStatus,
    checks,
    checkedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Configuration Management
// ---------------------------------------------------------------------------

/**
 * Update timeout configuration.
 */
export function configureTimeouts(
  updates: Partial<AgentTimeoutConfig>,
): AgentTimeoutConfig {
  timeoutConfig = { ...timeoutConfig, ...updates };
  console.log(
    `[Hardening] Timeout config updated: analyze=${timeoutConfig.analyzeTimeoutMs}ms, execution=${timeoutConfig.executionTimeoutMs}ms, round=${timeoutConfig.roundTimeoutMs}ms`,
  );
  return { ...timeoutConfig };
}

/**
 * Get current timeout configuration.
 */
export function getTimeoutConfig(): AgentTimeoutConfig {
  return { ...timeoutConfig };
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/**
 * Get hardening metrics.
 */
export function getHardeningMetrics(): HardeningMetrics {
  return { ...metrics, agentTimeoutsByAgent: { ...metrics.agentTimeoutsByAgent } };
}

/**
 * Reset hardening metrics (admin use).
 */
export function resetHardeningMetrics(): void {
  metrics = {
    agentTimeouts: 0,
    executionTimeouts: 0,
    roundTimeouts: 0,
    emergencyHalts: 0,
    staleDataRejections: 0,
    totalRoundsProtected: 0,
    consecutiveFailures: 0,
    lastSuccessfulRound: null,
    agentTimeoutsByAgent: {},
  };
  jupiterConsecutiveFailures = 0;
}
