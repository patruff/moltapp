/**
 * Production Hardening Layer
 *
 * Critical safety infrastructure for live trading:
 *
 * 1. Emergency Kill Switch — halt all trading instantly
 * 2. Market Data Staleness Detection — reject stale prices
 * 3. Health Monitoring — detect degraded service state
 * 4. Configuration Management — timeout configuration
 * 5. Metrics — hardening metrics tracking
 *
 * This module wraps the orchestrator's trading pipeline with production
 * safety guarantees that the base system doesn't provide.
 */

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

/**
 * Health Check Thresholds
 *
 * These constants control alert severity levels in checkHealth() and determine
 * when the system reports "degraded" vs "critical" states. Tuning these affects
 * ops team alert noise and response urgency.
 */

/**
 * Consecutive failure warning threshold.
 *
 * When consecutive round failures reach this value, health check reports "warn"
 * status. This is lower than MAX_CONSECUTIVE_FAILURES (5, which triggers auto-halt).
 *
 * Impact: Controls early warning system before critical auto-halt.
 */
const HEALTH_CONSECUTIVE_FAILURES_WARN_THRESHOLD = 3;

/**
 * Market data staleness critical multiplier.
 *
 * When data age exceeds (MAX_MARKET_DATA_AGE_SECONDS * this multiplier), health
 * check reports "fail" vs "warn". Multiplier of 2 means 240s (4 minutes) triggers
 * critical alert.
 *
 * Impact: Determines how stale data must be before critical alert.
 */
const HEALTH_MARKET_DATA_CRITICAL_MULTIPLIER = 2;

/**
 * Jupiter API failure warning threshold.
 *
 * When consecutive Jupiter failures reach this value, health check reports "warn"
 * status. This is lower than JUPITER_FAILURE_THRESHOLD (3, which triggers halt).
 *
 * Impact: Early warning before Jupiter failure halt.
 */
const HEALTH_JUPITER_FAILURES_WARN_THRESHOLD = 2;

/**
 * Agent timeout rate critical threshold (as fraction 0-1).
 *
 * When (agentTimeouts / totalRoundsProtected) exceeds this value, health check
 * reports "fail" status. 0.5 = 50% of rounds experiencing agent timeouts.
 *
 * Impact: Defines when timeout rate becomes critical vs warning.
 */
const HEALTH_TIMEOUT_RATE_CRITICAL_THRESHOLD = 0.5;

/**
 * Agent timeout rate warning threshold (as fraction 0-1).
 *
 * When (agentTimeouts / totalRoundsProtected) exceeds this value, health check
 * reports "warn" status. 0.2 = 20% of rounds experiencing agent timeouts.
 *
 * Impact: Early warning for elevated timeout rate.
 */
const HEALTH_TIMEOUT_RATE_WARN_THRESHOLD = 0.2;

/**
 * Last successful round age critical threshold (minutes).
 *
 * When last successful round age exceeds this value, health check reports "fail"
 * status. 90 minutes of no successful rounds = critical alert.
 *
 * Impact: Defines when prolonged failure becomes critical.
 */
const HEALTH_LAST_ROUND_AGE_CRITICAL_MINUTES = 90;

/**
 * Last successful round age warning threshold (minutes).
 *
 * When last successful round age exceeds this value, health check reports "warn"
 * status. 45 minutes of no successful rounds = warning alert.
 *
 * Impact: Early warning for prolonged failures.
 */
const HEALTH_LAST_ROUND_AGE_WARN_MINUTES = 45;

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
 * Get Jupiter failure count.
 */
export function getJupiterFailureCount(): number {
  return jupiterConsecutiveFailures;
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
        : metrics.consecutiveFailures >= HEALTH_CONSECUTIVE_FAILURES_WARN_THRESHOLD
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
      : freshness.ageSeconds > MAX_MARKET_DATA_AGE_SECONDS * HEALTH_MARKET_DATA_CRITICAL_MULTIPLIER
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
        : jupiterConsecutiveFailures >= HEALTH_JUPITER_FAILURES_WARN_THRESHOLD
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
      recentTimeoutRate > HEALTH_TIMEOUT_RATE_CRITICAL_THRESHOLD
        ? "fail"
        : recentTimeoutRate > HEALTH_TIMEOUT_RATE_WARN_THRESHOLD
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
        ageMinutes > HEALTH_LAST_ROUND_AGE_CRITICAL_MINUTES
          ? "fail"
          : ageMinutes > HEALTH_LAST_ROUND_AGE_WARN_MINUTES
            ? "warn"
            : "pass",
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
