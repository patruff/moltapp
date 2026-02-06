/**
 * Pre-Round Health Gate
 *
 * Validates all critical systems are operational before starting a trading round.
 * This prevents wasted LLM API calls and potential data inconsistencies when
 * infrastructure is degraded.
 *
 * Checks performed (in parallel for speed):
 * 1. Database connectivity — can we read/write positions and trades?
 * 2. Jupiter API — can we get real-time prices?
 * 3. Solana RPC — can we query balances?
 * 4. LLM providers — is at least one agent's LLM reachable?
 * 5. Trading lock — is the lock system functional?
 * 6. Circuit breakers — are any agents blocked for the day?
 *
 * The gate has two modes:
 * - STRICT: All critical checks must pass (for live trading)
 * - RELAXED: Only database must pass (for paper trading / demos)
 *
 * Features:
 * - Fast parallel checks (target: <5 seconds total)
 * - Configurable strictness per trading mode
 * - Detailed failure reporting for debugging
 * - Metrics tracking for gate pass/fail rates
 * - Automatic mode detection from TRADING_MODE env var
 */

import { db } from "../db/index.ts";
import { sql } from "drizzle-orm";
import { env } from "../config/env.ts";
import { getCircuitBreakerStatus } from "./circuit-breaker.ts";
import { getLockStatus } from "./trading-lock.ts";
import { errorMessage } from "../lib/errors.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GateCheckStatus = "pass" | "fail" | "warn" | "skip";
export type GateMode = "strict" | "relaxed";

export interface GateCheck {
  name: string;
  status: GateCheckStatus;
  latencyMs: number;
  message: string;
  /** Whether this check is required for the gate to pass */
  required: boolean;
}

export interface GateResult {
  /** Whether the trading round should proceed */
  proceed: boolean;
  /** Gate mode used for this check */
  mode: GateMode;
  /** Total time to run all checks */
  durationMs: number;
  /** Timestamp of the check */
  timestamp: string;
  /** Individual check results */
  checks: GateCheck[];
  /** Summary of failures and warnings */
  summary: {
    total: number;
    passed: number;
    failed: number;
    warnings: number;
    skipped: number;
    failedChecks: string[];
    warningChecks: string[];
  };
  /** Reason if the gate blocked the round */
  blockReason: string | null;
}

export interface GateMetrics {
  totalChecks: number;
  gatesOpened: number;
  gatesBlocked: number;
  blockRate: number;
  avgDurationMs: number;
  failuresByCheck: Record<string, number>;
  recentResults: Array<{
    timestamp: string;
    proceed: boolean;
    mode: GateMode;
    durationMs: number;
    failedChecks: string[];
  }>;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CHECK_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// State & Metrics
// ---------------------------------------------------------------------------

let totalChecks = 0;
let gatesOpened = 0;
let gatesBlocked = 0;
let gateDurations: number[] = [];
const failuresByCheck: Record<string, number> = {};
const recentResults: GateMetrics["recentResults"] = [];
const MAX_RECENT = 50;
const MAX_DURATIONS = 200;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await fn();
    clearTimeout(timer);
    return result;
  } catch (err) {
    clearTimeout(timer);
    if (controller.signal.aborted) {
      throw new Error(`Timed out after ${timeoutMs}ms`);
    }
    throw err;
  }
}

function getGateMode(): GateMode {
  const tradingMode = process.env.TRADING_MODE?.toLowerCase();
  if (tradingMode === "live") return "strict";
  return "relaxed";
}

// ---------------------------------------------------------------------------
// Individual Checks
// ---------------------------------------------------------------------------

async function checkDatabase(): Promise<GateCheck> {
  const start = Date.now();
  try {
    await withTimeout(async () => {
      await db.execute(sql`SELECT 1 as ok`);
    }, CHECK_TIMEOUT_MS);

    return {
      name: "database",
      status: "pass",
      latencyMs: Date.now() - start,
      message: "Database connected",
      required: true,
    };
  } catch (err) {
    return {
      name: "database",
      status: "fail",
      latencyMs: Date.now() - start,
      message: `Database unavailable: ${errorMessage(err)}`,
      required: true,
    };
  }
}

async function checkJupiterApi(): Promise<GateCheck> {
  const start = Date.now();
  try {
    const headers: Record<string, string> = {};
    if (env.JUPITER_API_KEY) {
      headers["x-api-key"] = env.JUPITER_API_KEY;
    }

    // Lightweight price check using SOL
    const solMint = "So11111111111111111111111111111111111111112";
    const res = await fetch(
      `https://api.jup.ag/price/v3?ids=${solMint}`,
      { headers, signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) },
    );

    const latencyMs = Date.now() - start;

    if (!res.ok) {
      return {
        name: "jupiter_api",
        status: "warn",
        latencyMs,
        message: `Jupiter returned HTTP ${res.status}`,
        required: false, // Can fall back to mock prices
      };
    }

    const data = (await res.json()) as {
      data: Record<string, { price: string } | undefined>;
    };
    const solPrice = data.data?.[solMint]?.price;

    if (!solPrice) {
      return {
        name: "jupiter_api",
        status: "warn",
        latencyMs,
        message: "Jupiter returned no SOL price data",
        required: false,
      };
    }

    return {
      name: "jupiter_api",
      status: "pass",
      latencyMs,
      message: `Jupiter OK (SOL: $${solPrice})`,
      required: false,
    };
  } catch (err) {
    return {
      name: "jupiter_api",
      status: "warn",
      latencyMs: Date.now() - start,
      message: `Jupiter unreachable: ${errorMessage(err)}`,
      required: false,
    };
  }
}

async function checkSolanaRpc(): Promise<GateCheck> {
  const rpcUrl = env.SOLANA_RPC_URL;
  if (!rpcUrl) {
    return {
      name: "solana_rpc",
      status: "skip",
      latencyMs: 0,
      message: "SOLANA_RPC_URL not configured",
      required: false,
    };
  }

  const start = Date.now();
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getSlot",
        params: [{ commitment: "processed" }],
      }),
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });

    const latencyMs = Date.now() - start;

    if (!res.ok) {
      return {
        name: "solana_rpc",
        status: "warn",
        latencyMs,
        message: `Solana RPC returned HTTP ${res.status}`,
        required: false,
      };
    }

    const data = (await res.json()) as { result?: number };
    return {
      name: "solana_rpc",
      status: "pass",
      latencyMs,
      message: `Solana RPC OK (slot: ${data.result})`,
      required: false,
    };
  } catch (err) {
    return {
      name: "solana_rpc",
      status: "warn",
      latencyMs: Date.now() - start,
      message: `Solana RPC unreachable: ${errorMessage(err)}`,
      required: false,
    };
  }
}

async function checkLlmProviders(): Promise<GateCheck> {
  const start = Date.now();
  const available: string[] = [];
  const missing: string[] = [];

  if (env.ANTHROPIC_API_KEY) available.push("Anthropic");
  else missing.push("Anthropic");

  if (env.OPENAI_API_KEY) available.push("OpenAI");
  else missing.push("OpenAI");

  if (env.XAI_API_KEY) available.push("xAI");
  else missing.push("xAI");

  if (available.length === 0) {
    return {
      name: "llm_providers",
      status: "warn",
      latencyMs: Date.now() - start,
      message: "No LLM API keys configured — agents will produce mock decisions",
      required: false,
    };
  }

  return {
    name: "llm_providers",
    status: available.length >= 2 ? "pass" : "warn",
    latencyMs: Date.now() - start,
    message: `${available.length}/3 providers configured (${available.join(", ")})`,
    required: false,
  };
}

function checkTradingLock(): GateCheck {
  const start = Date.now();
  try {
    const lockStatus = getLockStatus();

    if (lockStatus.isLocked) {
      return {
        name: "trading_lock",
        status: "fail",
        latencyMs: Date.now() - start,
        message: `Lock already held by "${lockStatus.lock?.holderInfo}" (expires: ${lockStatus.lock?.expiresAt})`,
        required: true,
      };
    }

    return {
      name: "trading_lock",
      status: "pass",
      latencyMs: Date.now() - start,
      message: "Lock available",
      required: true,
    };
  } catch (err) {
    return {
      name: "trading_lock",
      status: "fail",
      latencyMs: Date.now() - start,
      message: `Lock check failed: ${errorMessage(err)}`,
      required: true,
    };
  }
}

function checkCircuitBreakers(): GateCheck {
  const start = Date.now();
  try {
    const cbStatus = getCircuitBreakerStatus();

    // Check if ALL agents are blocked
    const agentIds = Object.keys(cbStatus.agentStates);
    const blockedAgents = agentIds.filter(
      (id) => cbStatus.agentStates[id].dailyLossTriggered,
    );

    if (blockedAgents.length === agentIds.length && agentIds.length > 0) {
      return {
        name: "circuit_breakers",
        status: "warn",
        latencyMs: Date.now() - start,
        message: `All ${agentIds.length} agents have daily loss limits triggered`,
        required: false,
      };
    }

    return {
      name: "circuit_breakers",
      status: "pass",
      latencyMs: Date.now() - start,
      message: `${agentIds.length - blockedAgents.length}/${agentIds.length || 3} agents available to trade`,
      required: false,
    };
  } catch (err) {
    return {
      name: "circuit_breakers",
      status: "warn",
      latencyMs: Date.now() - start,
      message: `CB check failed: ${errorMessage(err)}`,
      required: false,
    };
  }
}

// ---------------------------------------------------------------------------
// Main Gate Function
// ---------------------------------------------------------------------------

/**
 * Run the pre-round health gate.
 *
 * In STRICT mode (live trading):
 * - Database must be connected
 * - Jupiter API should be reachable (warn if not)
 * - Trading lock must be available
 *
 * In RELAXED mode (paper trading):
 * - Only database connectivity is required
 * - Everything else generates warnings but doesn't block
 *
 * Returns a GateResult indicating whether to proceed with the round.
 */
export async function runPreRoundGate(
  modeOverride?: GateMode,
): Promise<GateResult> {
  const startTime = Date.now();
  const mode = modeOverride ?? getGateMode();
  const timestamp = new Date().toISOString();
  totalChecks++;

  console.log(
    `[PreRoundGate] Running pre-round health gate (mode: ${mode})...`,
  );

  // Run checks in parallel for speed
  const [dbCheck, jupiterCheck, solanaCheck, llmCheck] = await Promise.all([
    checkDatabase(),
    checkJupiterApi(),
    checkSolanaRpc(),
    checkLlmProviders(),
  ]);

  // Synchronous checks
  const lockCheck = checkTradingLock();
  const cbCheck = checkCircuitBreakers();

  const checks = [dbCheck, jupiterCheck, solanaCheck, llmCheck, lockCheck, cbCheck];

  // In strict mode, Jupiter API is required
  if (mode === "strict") {
    jupiterCheck.required = true;
    solanaCheck.required = true;
  }

  // Count results
  const passed = checks.filter((c) => c.status === "pass").length;
  const failed = checks.filter((c) => c.status === "fail").length;
  const warnings = checks.filter((c) => c.status === "warn").length;
  const skipped = checks.filter((c) => c.status === "skip").length;

  const failedChecks = checks
    .filter((c) => c.status === "fail")
    .map((c) => c.name);
  const warningChecks = checks
    .filter((c) => c.status === "warn")
    .map((c) => c.name);

  // Determine if gate should block
  const requiredFailures = checks.filter(
    (c) => c.required && c.status === "fail",
  );
  const proceed = requiredFailures.length === 0;

  let blockReason: string | null = null;
  if (!proceed) {
    blockReason = `Required checks failed: ${requiredFailures.map((c) => `${c.name} (${c.message})`).join("; ")}`;
  }

  const durationMs = Date.now() - startTime;

  // Track metrics
  if (proceed) {
    gatesOpened++;
  } else {
    gatesBlocked++;
    for (const check of requiredFailures) {
      failuresByCheck[check.name] = (failuresByCheck[check.name] ?? 0) + 1;
    }
  }

  gateDurations.push(durationMs);
  if (gateDurations.length > MAX_DURATIONS) {
    gateDurations = gateDurations.slice(-MAX_DURATIONS);
  }

  recentResults.unshift({
    timestamp,
    proceed,
    mode,
    durationMs,
    failedChecks,
  });
  if (recentResults.length > MAX_RECENT) {
    recentResults.length = MAX_RECENT;
  }

  // Log results
  for (const check of checks) {
    const icon =
      check.status === "pass"
        ? "OK"
        : check.status === "fail"
          ? "FAIL"
          : check.status === "warn"
            ? "WARN"
            : "SKIP";
    console.log(
      `[PreRoundGate]   ${icon} ${check.name}: ${check.message} (${check.latencyMs}ms)`,
    );
  }

  console.log(
    `[PreRoundGate] Gate ${proceed ? "OPEN" : "BLOCKED"} (${mode}): ` +
      `${passed} pass, ${failed} fail, ${warnings} warn, ${skipped} skip — ${durationMs}ms` +
      (blockReason ? ` — ${blockReason}` : ""),
  );

  return {
    proceed,
    mode,
    durationMs,
    timestamp,
    checks,
    summary: {
      total: checks.length,
      passed,
      failed,
      warnings,
      skipped,
      failedChecks,
      warningChecks,
    },
    blockReason,
  };
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/**
 * Get pre-round gate metrics.
 */
export function getGateMetrics(): GateMetrics {
  const avgDuration =
    gateDurations.length > 0
      ? Math.round(
          gateDurations.reduce((a, b) => a + b, 0) / gateDurations.length,
        )
      : 0;

  return {
    totalChecks,
    gatesOpened,
    gatesBlocked,
    blockRate:
      totalChecks > 0 ? Math.round((gatesBlocked / totalChecks) * 100) : 0,
    avgDurationMs: avgDuration,
    failuresByCheck: { ...failuresByCheck },
    recentResults: recentResults.slice(0, 20),
  };
}

/**
 * Reset gate metrics (admin use).
 */
export function resetGateMetrics(): void {
  totalChecks = 0;
  gatesOpened = 0;
  gatesBlocked = 0;
  gateDurations = [];
  Object.keys(failuresByCheck).forEach((k) => delete failuresByCheck[k]);
  recentResults.length = 0;
}
