/**
 * Autonomous Trading Round Runner
 *
 * Manages the automated trading cycle when running locally (not on Lambda).
 * This is the local equivalent of EventBridge + Lambda — it runs trading
 * rounds on a configurable interval with full safety controls.
 *
 * Features:
 * 1. Configurable interval (default: 30 min)
 * 2. Health checks before each round
 * 3. Graceful shutdown (finishes current round, then stops)
 * 4. Round history and status tracking
 * 5. Automatic error recovery (skip failed rounds, continue)
 * 6. Integration with all safety layers (circuit breakers, locks, etc.)
 * 7. Post-round analytics integration
 *
 * Usage:
 *   import { startAutonomousRunner, stopAutonomousRunner } from './autonomous-runner';
 *   startAutonomousRunner({ intervalMs: 30 * 60 * 1000 });
 */

import { runTradingRound } from "../agents/orchestrator.ts";
import { round3 } from "../lib/math-utils.ts";
import { analyzeRound, type RoundDecision } from "./round-analytics.ts";
import { recordRoundDecisions, type AgentDecisionRecord } from "./cross-agent-analyzer.ts";
import { isTradingHalted } from "./production-hardening.ts";
import { errorMessage } from "../lib/errors.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Default interval between trading rounds (30 minutes).
 * Formula: 30 minutes × 60 seconds × 1000 ms = 1,800,000 milliseconds
 * Purpose: Balances trading frequency with rate limiting and agent reasoning time.
 */
const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Maximum consecutive round failures before auto-pause (safety threshold).
 * Purpose: Prevents runaway errors from depleting resources or triggering
 * excessive API calls. After 3 consecutive failures, runner auto-pauses and
 * requires manual intervention via resumeRunner().
 */
const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Maximum round history entries to retain in memory.
 * Purpose: Prevents memory bloat from unbounded history accumulation.
 * Older entries are evicted (shift) when limit is reached.
 */
const MAX_HISTORY_ENTRIES = 100;

/**
 * Delay before executing the first immediate round (100ms startup buffer).
 * Purpose: Allows system initialization to complete before first round starts.
 * Short delay (100ms) prevents race conditions without noticeable user delay.
 */
const IMMEDIATE_EXECUTION_DELAY_MS = 100;

/**
 * Default limit for round history queries (last 50 rounds).
 * Purpose: Reasonable default for API responses and UI displays without
 * overwhelming clients with excessive data.
 */
const DEFAULT_HISTORY_QUERY_LIMIT = 50;

/**
 * Time window for calculating failed rounds statistics (24 hours).
 * Formula: 24 hours × 60 minutes × 60 seconds × 1000 ms = 86,400,000 milliseconds
 * Purpose: Tracks recent failure rate for operational monitoring and alerting.
 */
const STATS_WINDOW_24H_MS = 24 * 60 * 60 * 1000;

/**
 * US market hours for trading halt checks (Eastern Time, weekdays only).
 * MARKET_OPEN_MINUTES: 9:30 AM = 9 × 60 + 30 = 570 minutes from midnight
 * MARKET_CLOSE_MINUTES: 4:00 PM = 16 × 60 = 960 minutes from midnight
 * Purpose: Respects US equity market hours (xStocks trade 24/7 but prices
 * are US-market-driven). Used when respectMarketHours config is enabled.
 */
const MARKET_OPEN_MINUTES = 9 * 60 + 30; // 9:30 AM
const MARKET_CLOSE_MINUTES = 16 * 60; // 4:00 PM

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RunnerConfig {
  /** Interval between rounds in milliseconds (default: 30 min) */
  intervalMs: number;
  /** Maximum consecutive failures before auto-pause (default: 3) */
  maxConsecutiveFailures: number;
  /** Whether to run the first round immediately on start (default: true) */
  runImmediately: boolean;
  /** Whether to run post-round analytics (default: true) */
  enableAnalytics: boolean;
  /** Whether to skip rounds during non-market hours (default: false) */
  respectMarketHours: boolean;
  /** Callback after each round completes */
  onRoundComplete?: (result: RoundHistoryEntry) => void;
  /** Callback on error */
  onError?: (error: Error) => void;
}

export interface RoundHistoryEntry {
  roundId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  success: boolean;
  agentCount: number;
  errorCount: number;
  lockSkipped: boolean;
  decisions: {
    agentName: string;
    action: string;
    symbol: string;
    confidence: number;
    executed: boolean;
  }[];
  errors: string[];
}

export type RunnerStatus = "idle" | "running" | "paused" | "stopping" | "error";

interface RunnerState {
  status: RunnerStatus;
  startedAt: string | null;
  lastRoundAt: string | null;
  totalRoundsRun: number;
  totalRoundsSucceeded: number;
  totalRoundsFailed: number;
  totalRoundsSkipped: number;
  consecutiveFailures: number;
  currentRoundId: string | null;
  nextScheduledAt: string | null;
  history: RoundHistoryEntry[];
  pauseReason: string | null;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: RunnerConfig = {
  intervalMs: DEFAULT_INTERVAL_MS,
  maxConsecutiveFailures: MAX_CONSECUTIVE_FAILURES,
  runImmediately: true,
  enableAnalytics: true,
  respectMarketHours: false,
};

let config: RunnerConfig = { ...DEFAULT_CONFIG };
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let immediateHandle: ReturnType<typeof setTimeout> | null = null;

const state: RunnerState = {
  status: "idle",
  startedAt: null,
  lastRoundAt: null,
  totalRoundsRun: 0,
  totalRoundsSucceeded: 0,
  totalRoundsFailed: 0,
  totalRoundsSkipped: 0,
  consecutiveFailures: 0,
  currentRoundId: null,
  nextScheduledAt: null,
  history: [],
  pauseReason: null,
};

// Removed - replaced with MAX_HISTORY_ENTRIES constant above

// ---------------------------------------------------------------------------
// Runner Control
// ---------------------------------------------------------------------------

/**
 * Start the autonomous trading round runner.
 */
export function startAutonomousRunner(
  userConfig?: Partial<RunnerConfig>,
): {
  status: RunnerStatus;
  config: RunnerConfig;
  nextRoundAt: string | null;
} {
  if (state.status === "running") {
    return {
      status: state.status,
      config,
      nextRoundAt: state.nextScheduledAt,
    };
  }

  config = { ...DEFAULT_CONFIG, ...userConfig };
  state.status = "running";
  state.startedAt = new Date().toISOString();
  state.pauseReason = null;
  state.consecutiveFailures = 0;

  console.log(
    `[AutoRunner] Starting autonomous runner. Interval: ${config.intervalMs / 1000}s, ` +
      `runImmediately: ${config.runImmediately}`,
  );

  // Schedule recurring rounds
  intervalHandle = setInterval(executeRound, config.intervalMs);
  state.nextScheduledAt = new Date(
    Date.now() + config.intervalMs,
  ).toISOString();

  // Run immediately if configured
  if (config.runImmediately) {
    immediateHandle = setTimeout(executeRound, IMMEDIATE_EXECUTION_DELAY_MS);
  }

  return {
    status: state.status,
    config,
    nextRoundAt: config.runImmediately
      ? new Date().toISOString()
      : state.nextScheduledAt,
  };
}

/**
 * Stop the autonomous runner gracefully.
 * Waits for the current round to finish, then stops.
 */
export function stopAutonomousRunner(): {
  status: RunnerStatus;
  message: string;
} {
  if (state.status === "idle") {
    return { status: "idle", message: "Runner is not active" };
  }

  state.status = "stopping";

  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  if (immediateHandle) {
    clearTimeout(immediateHandle);
    immediateHandle = null;
  }

  state.nextScheduledAt = null;

  // If no round is currently running, go straight to idle
  if (!state.currentRoundId) {
    state.status = "idle";
    return { status: "idle", message: "Runner stopped" };
  }

  return {
    status: "stopping",
    message: `Waiting for current round ${state.currentRoundId} to finish`,
  };
}

/**
 * Pause the runner (can be resumed without losing state).
 */
export function pauseRunner(reason?: string): {
  status: RunnerStatus;
  message: string;
} {
  if (state.status !== "running") {
    return { status: state.status, message: "Runner is not active" };
  }

  state.status = "paused";
  state.pauseReason = reason ?? "Manual pause";

  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  if (immediateHandle) {
    clearTimeout(immediateHandle);
    immediateHandle = null;
  }

  state.nextScheduledAt = null;

  console.log(`[AutoRunner] Paused: ${state.pauseReason}`);
  return { status: "paused", message: `Paused: ${state.pauseReason}` };
}

/**
 * Resume a paused runner.
 */
export function resumeRunner(): {
  status: RunnerStatus;
  nextRoundAt: string;
} {
  if (state.status !== "paused") {
    return {
      status: state.status,
      nextRoundAt: state.nextScheduledAt ?? "N/A",
    };
  }

  state.status = "running";
  state.pauseReason = null;
  state.consecutiveFailures = 0;

  intervalHandle = setInterval(executeRound, config.intervalMs);
  state.nextScheduledAt = new Date(
    Date.now() + config.intervalMs,
  ).toISOString();

  console.log("[AutoRunner] Resumed");
  return { status: "running", nextRoundAt: state.nextScheduledAt };
}

/**
 * Trigger a single round immediately (outside the schedule).
 */
export async function triggerManualRound(): Promise<RoundHistoryEntry | null> {
  if (state.currentRoundId) {
    console.warn("[AutoRunner] Round already in progress, skipping manual trigger");
    return null;
  }

  return await executeRound();
}

// ---------------------------------------------------------------------------
// Core Round Execution
// ---------------------------------------------------------------------------

async function executeRound(): Promise<RoundHistoryEntry | null> {
  // Skip if already running a round
  if (state.currentRoundId) {
    console.log("[AutoRunner] Skipping — round already in progress");
    state.totalRoundsSkipped++;
    return null;
  }

  // Check emergency halt
  if (isTradingHalted().halted) {
    console.log("[AutoRunner] Skipping — emergency halt active");
    state.totalRoundsSkipped++;
    return null;
  }

  // Check market hours if configured
  if (config.respectMarketHours && !isMarketOpen()) {
    console.log("[AutoRunner] Skipping — market closed");
    state.totalRoundsSkipped++;
    return null;
  }

  // Check consecutive failure limit
  if (state.consecutiveFailures >= config.maxConsecutiveFailures) {
    console.warn(
      `[AutoRunner] Auto-pausing after ${state.consecutiveFailures} consecutive failures`,
    );
    pauseRunner(`Auto-paused: ${state.consecutiveFailures} consecutive failures`);
    return null;
  }

  const roundStartTime = Date.now();
  const startedAt = new Date().toISOString();
  state.currentRoundId = `auto_${Date.now()}`;

  console.log(`[AutoRunner] Starting round... (total: ${state.totalRoundsRun + 1})`);

  let historyEntry: RoundHistoryEntry;

  try {
    const result = await runTradingRound();
    const durationMs = Date.now() - roundStartTime;

    historyEntry = {
      roundId: result.roundId,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs,
      success: result.errors.length === 0,
      agentCount: result.results.length,
      errorCount: result.errors.length,
      lockSkipped: result.lockSkipped,
      decisions: result.results.map((r) => ({
        agentName: r.agentName,
        action: r.decision.action,
        symbol: r.decision.symbol,
        confidence: r.decision.confidence,
        executed: r.executed,
      })),
      errors: result.errors,
    };

    state.totalRoundsRun++;
    state.totalRoundsSucceeded++;
    state.consecutiveFailures = 0;
    state.lastRoundAt = new Date().toISOString();

    console.log(
      `[AutoRunner] Round ${result.roundId} completed in ${durationMs}ms. ` +
        `${result.results.length} agents, ${result.errors.length} errors.`,
    );

    // Post-round analytics
    if (config.enableAnalytics) {
      try {
        const roundDecisions: RoundDecision[] = result.results.map((r) => ({
          agentId: r.agentId,
          agentName: r.agentName,
          action: r.decision.action,
          symbol: r.decision.symbol,
          quantity: r.decision.quantity,
          confidence: r.decision.confidence,
          reasoning: r.decision.reasoning,
          executed: r.executed,
          executionError: r.executionError,
          txSignature: r.executionDetails?.txSignature,
          filledPrice: r.executionDetails?.filledPrice,
          usdcAmount: r.executionDetails?.usdcAmount,
        }));

        analyzeRound(
          result.roundId,
          result.timestamp,
          roundDecisions,
          [], // market data would be fetched from cache
          durationMs,
        );

        // Record for cross-agent analysis
        const crossDecisions: AgentDecisionRecord[] = result.results.map((r) => ({
          agentId: r.agentId,
          agentName: r.agentName,
          action: r.decision.action as "buy" | "sell" | "hold",
          symbol: r.decision.symbol,
          quantity: r.decision.quantity,
          confidence: r.decision.confidence,
          reasoning: r.decision.reasoning,
          timestamp: r.decision.timestamp,
          roundId: result.roundId,
          executed: r.executed,
        }));
        recordRoundDecisions(result.roundId, crossDecisions);
      } catch (analyticsErr) {
        console.warn(
          `[AutoRunner] Post-round analytics failed (non-critical): ${errorMessage(analyticsErr)}`,
        );
      }
    }

    // Notify callback
    config.onRoundComplete?.(historyEntry);
  } catch (error) {
    const durationMs = Date.now() - roundStartTime;
    const errorMsg = errorMessage(error);

    historyEntry = {
      roundId: state.currentRoundId,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs,
      success: false,
      agentCount: 0,
      errorCount: 1,
      lockSkipped: false,
      decisions: [],
      errors: [errorMsg],
    };

    state.totalRoundsRun++;
    state.totalRoundsFailed++;
    state.consecutiveFailures++;

    console.error(`[AutoRunner] Round failed: ${errorMsg}`);
    config.onError?.(error instanceof Error ? error : new Error(errorMsg));
  }

  // Store in history
  state.history.push(historyEntry);
  if (state.history.length > MAX_HISTORY_ENTRIES) {
    state.history.shift();
  }

  state.currentRoundId = null;

  // Update next scheduled time
  if (state.status === "running" && intervalHandle) {
    state.nextScheduledAt = new Date(
      Date.now() + config.intervalMs,
    ).toISOString();
  }

  // If we were stopping and round is done, go to idle
  if (state.status === "stopping") {
    state.status = "idle";
  }

  return historyEntry;
}

// ---------------------------------------------------------------------------
// Status & Queries
// ---------------------------------------------------------------------------

/**
 * Get the current runner status and statistics.
 */
export function getRunnerStatus(): RunnerState & { config: RunnerConfig } {
  return { ...state, config };
}

/**
 * Get round history with optional filtering.
 */
export function getRoundHistory(options?: {
  limit?: number;
  successOnly?: boolean;
  failedOnly?: boolean;
}): RoundHistoryEntry[] {
  let history = [...state.history];

  if (options?.successOnly) {
    history = history.filter((h) => h.success);
  }
  if (options?.failedOnly) {
    history = history.filter((h) => !h.success);
  }

  const limit = options?.limit ?? DEFAULT_HISTORY_QUERY_LIMIT;
  return history.slice(-limit);
}

/**
 * Get aggregate runner statistics.
 */
export function getRunnerStats(): {
  uptime: number | null;
  totalRoundsRun: number;
  successRate: number;
  avgRoundDurationMs: number;
  avgAgentsPerRound: number;
  failedRoundsLast24h: number;
} {
  const uptime = state.startedAt
    ? Date.now() - new Date(state.startedAt).getTime()
    : null;

  const successRate =
    state.totalRoundsRun > 0
      ? state.totalRoundsSucceeded / state.totalRoundsRun
      : 0;

  const durations = state.history.map((h) => h.durationMs);
  const avgDuration =
    durations.length > 0
      ? durations.reduce((s, d) => s + d, 0) / durations.length
      : 0;

  const agents = state.history.map((h) => h.agentCount);
  const avgAgents =
    agents.length > 0
      ? agents.reduce((s, a) => s + a, 0) / agents.length
      : 0;

  const oneDayAgo = new Date(Date.now() - STATS_WINDOW_24H_MS).toISOString();
  const failedLast24h = state.history.filter(
    (h) => !h.success && h.startedAt >= oneDayAgo,
  ).length;

  return {
    uptime,
    totalRoundsRun: state.totalRoundsRun,
    successRate: round3(successRate),
    avgRoundDurationMs: Math.round(avgDuration),
    avgAgentsPerRound: Math.round(avgAgents * 10) / 10,
    failedRoundsLast24h: failedLast24h,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Basic market hours check (US Eastern, 9:30 AM - 4:00 PM, weekdays).
 * xStocks may trade 24/7 on-chain, but price movements are US-market-driven.
 */
function isMarketOpen(): boolean {
  const now = new Date();
  const eastern = new Date(
    now.toLocaleString("en-US", { timeZone: "America/New_York" }),
  );
  const day = eastern.getDay();
  const hour = eastern.getHours();
  const minute = eastern.getMinutes();

  // Weekends
  if (day === 0 || day === 6) return false;

  // Before 9:30 AM or after 4:00 PM
  const timeMinutes = hour * 60 + minute;
  if (timeMinutes < MARKET_OPEN_MINUTES || timeMinutes >= MARKET_CLOSE_MINUTES) return false;

  return true;
}
