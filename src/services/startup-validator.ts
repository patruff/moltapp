/**
 * Startup Health Validator
 *
 * Validates all critical dependencies at application startup before accepting
 * traffic. Checks database, Solana RPC, Jupiter API, and LLM providers.
 *
 * Each check runs with a timeout and reports its status independently.
 * The validator returns a comprehensive health report that can be used
 * to determine if the application is ready to serve requests.
 *
 * Features:
 * - Parallel dependency checks for fast startup
 * - Configurable timeouts per check
 * - Graceful degradation: advisory vs critical checks
 * - Structured health report for monitoring
 * - Periodic re-validation (optional background health ticker)
 */

import { db } from "../db/index.ts";
import { sql } from "drizzle-orm";
import { env } from "../config/env.ts";
import { errorMessage } from "../lib/errors.ts";
import { countByCondition } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CheckStatus = "healthy" | "degraded" | "unhealthy" | "skipped";
export type CheckSeverity = "critical" | "warning" | "info";

export interface HealthCheck {
  name: string;
  status: CheckStatus;
  severity: CheckSeverity;
  latencyMs: number;
  message: string;
  details?: Record<string, unknown>;
}

export interface StartupHealthReport {
  overall: CheckStatus;
  ready: boolean;
  timestamp: string;
  durationMs: number;
  checks: HealthCheck[];
  summary: {
    total: number;
    healthy: number;
    degraded: number;
    unhealthy: number;
    skipped: number;
    criticalFailures: string[];
  };
  environment: {
    nodeEnv: string;
    demoMode: boolean;
    tradingMode: string;
    hasAnthropicKey: boolean;
    hasOpenAIKey: boolean;
    hasXAIKey: boolean;
    hasSolanaRpc: boolean;
    hasHeliusKey: boolean;
    hasTurnkeyKeys: boolean;
  };
}

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

/**
 * Create a standardized HealthCheck object.
 *
 * Consolidates the repeated object construction pattern used across all health
 * check functions (database, Solana RPC, Jupiter API, LLM providers).
 *
 * Before this helper (23 instances of repeated code):
 * ```typescript
 * return {
 *   name: "database",
 *   status: "healthy",
 *   severity: "critical",
 *   latencyMs: Date.now() - start,
 *   message: `Connected (${latencyMs}ms)`,
 *   details: { provider: "neon" }
 * };
 * ```
 *
 * After this helper (single function call):
 * ```typescript
 * return createHealthCheck(
 *   "database",
 *   "healthy",
 *   "critical",
 *   Date.now() - start,
 *   `Connected (${latencyMs}ms)`,
 *   { provider: "neon" }
 * );
 * ```
 *
 * @param name - Health check identifier (e.g., "database", "solana_rpc")
 * @param status - Check result: healthy, degraded, unhealthy, or skipped
 * @param severity - Check importance: critical (blocks startup), warning (advisory), info (optional)
 * @param latencyMs - Check execution time in milliseconds
 * @param message - Human-readable status description
 * @param details - Optional additional context (URLs, versions, error codes)
 * @returns Standardized HealthCheck object
 */
function createHealthCheck(
  name: string,
  status: CheckStatus,
  severity: CheckSeverity,
  latencyMs: number,
  message: string,
  details?: Record<string, unknown>
): HealthCheck {
  const check: HealthCheck = {
    name,
    status,
    severity,
    latencyMs,
    message,
  };
  if (details) {
    check.details = details;
  }
  return check;
}

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Default timeout for all health checks unless overridden.
 *
 * Controls the maximum wait time for health check operations. If a check
 * exceeds this timeout, it's marked as unhealthy/degraded.
 *
 * Formula: Health check must complete within DEFAULT_CHECK_TIMEOUT_MS
 *
 * Example: 8000ms allows sufficient time for most API round-trips while
 * preventing indefinite hangs during startup validation
 *
 * @default 8000 - 8 seconds balances startup speed with network tolerance
 */
const DEFAULT_CHECK_TIMEOUT_MS = 8_000;

/**
 * Database-specific timeout for query execution.
 *
 * Database checks use a shorter timeout than default since DB queries
 * should be fast (<100ms typical). 5s allows for cold starts and network
 * latency while still failing fast on connection issues.
 *
 * Formula: Database query must complete within DATABASE_CHECK_TIMEOUT_MS
 *
 * @default 5000 - 5 seconds for database SELECT 1 query
 */
const DATABASE_CHECK_TIMEOUT_MS = 5_000;

/**
 * Database latency threshold for degraded status.
 *
 * If database responds but takes longer than this threshold, mark as
 * "degraded" instead of "healthy". Indicates slow but functional connection.
 *
 * Formula: latency > DATABASE_DEGRADED_THRESHOLD_MS = degraded status
 *
 * Example: 2500ms query = degraded (slow but working)
 *
 * @default 2000 - 2 seconds threshold distinguishes healthy from slow DB
 */
const DATABASE_DEGRADED_THRESHOLD_MS = 2000;

/**
 * Solana RPC fetch timeout for AbortSignal.
 *
 * Inner timeout for fetch() API call to Solana RPC endpoint. This is the
 * AbortSignal timeout passed to fetch(), which cancels the request if it
 * takes too long.
 *
 * Formula: fetch() aborts after SOLANA_RPC_FETCH_TIMEOUT_MS
 *
 * @default 5000 - 5 seconds for RPC getSlot call
 */
const SOLANA_RPC_FETCH_TIMEOUT_MS = 5000;

/**
 * Solana RPC outer timeout for withTimeout wrapper.
 *
 * Outer timeout wrapping the entire Solana RPC health check including fetch,
 * JSON parsing, and error handling. Should be slightly longer than fetch timeout
 * to allow graceful error handling.
 *
 * Formula: Total check duration must stay within SOLANA_RPC_OUTER_TIMEOUT_MS
 *
 * @default 6000 - 6 seconds (1s buffer beyond fetch timeout)
 */
const SOLANA_RPC_OUTER_TIMEOUT_MS = 6_000;

/**
 * Solana RPC latency threshold for degraded status.
 *
 * If RPC responds successfully but takes longer than this threshold, mark
 * as "degraded" instead of "healthy". High latency impacts trade execution.
 *
 * Formula: latency > SOLANA_RPC_DEGRADED_THRESHOLD_MS = degraded status
 *
 * Example: 3500ms RPC call = degraded (slow network)
 *
 * @default 3000 - 3 seconds threshold for acceptable Solana RPC latency
 */
const SOLANA_RPC_DEGRADED_THRESHOLD_MS = 3000;

/**
 * Jupiter API fetch timeout for AbortSignal.
 *
 * Inner timeout for fetch() API call to Jupiter price endpoint. Shorter than
 * RPC timeout since Jupiter API is typically very fast (<500ms).
 *
 * Formula: fetch() aborts after JUPITER_API_FETCH_TIMEOUT_MS
 *
 * @default 5000 - 5 seconds for Jupiter price check
 */
const JUPITER_API_FETCH_TIMEOUT_MS = 5000;

/**
 * Jupiter API outer timeout for withTimeout wrapper.
 *
 * Outer timeout wrapping the entire Jupiter API health check. Should be
 * slightly longer than fetch timeout for graceful error handling.
 *
 * Formula: Total check duration must stay within JUPITER_API_OUTER_TIMEOUT_MS
 *
 * @default 6000 - 6 seconds (1s buffer beyond fetch timeout)
 */
const JUPITER_API_OUTER_TIMEOUT_MS = 6_000;

/**
 * Anthropic API (Claude) fetch timeout for AbortSignal.
 *
 * Inner timeout for fetch() API call to Anthropic. Longer than other checks
 * since LLM API includes model initialization and response generation overhead.
 *
 * Formula: fetch() aborts after ANTHROPIC_API_FETCH_TIMEOUT_MS
 *
 * @default 10000 - 10 seconds for Anthropic messages endpoint
 */
const ANTHROPIC_API_FETCH_TIMEOUT_MS = 10000;

/**
 * Anthropic API outer timeout for withTimeout wrapper.
 *
 * Outer timeout wrapping the entire Anthropic API health check. Should be
 * longer than fetch timeout to allow for response parsing.
 *
 * Formula: Total check duration must stay within ANTHROPIC_API_OUTER_TIMEOUT_MS
 *
 * @default 12000 - 12 seconds (2s buffer beyond fetch timeout)
 */
const ANTHROPIC_API_OUTER_TIMEOUT_MS = 12_000;

/**
 * OpenAI API fetch timeout for AbortSignal.
 *
 * Inner timeout for fetch() API call to OpenAI models endpoint. Shorter than
 * Anthropic since models list is a lightweight metadata endpoint.
 *
 * Formula: fetch() aborts after OPENAI_API_FETCH_TIMEOUT_MS
 *
 * @default 5000 - 5 seconds for OpenAI models list
 */
const OPENAI_API_FETCH_TIMEOUT_MS = 5000;

/**
 * OpenAI API outer timeout for withTimeout wrapper.
 *
 * Outer timeout wrapping the entire OpenAI API health check.
 *
 * Formula: Total check duration must stay within OPENAI_API_OUTER_TIMEOUT_MS
 *
 * @default 6000 - 6 seconds (1s buffer beyond fetch timeout)
 */
const OPENAI_API_OUTER_TIMEOUT_MS = 6_000;

/**
 * xAI (Grok) API fetch timeout for AbortSignal.
 *
 * Inner timeout for fetch() API call to xAI models endpoint. Same as OpenAI
 * since both use similar lightweight metadata endpoints.
 *
 * Formula: fetch() aborts after XAI_API_FETCH_TIMEOUT_MS
 *
 * @default 5000 - 5 seconds for xAI models list
 */
const XAI_API_FETCH_TIMEOUT_MS = 5000;

/**
 * xAI API outer timeout for withTimeout wrapper.
 *
 * Outer timeout wrapping the entire xAI API health check.
 *
 * Formula: Total check duration must stay within XAI_API_OUTER_TIMEOUT_MS
 *
 * @default 6000 - 6 seconds (1s buffer beyond fetch timeout)
 */
const XAI_API_OUTER_TIMEOUT_MS = 6_000;

// ---------------------------------------------------------------------------
// Check Timeout Wrapper
// ---------------------------------------------------------------------------

async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number = DEFAULT_CHECK_TIMEOUT_MS,
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

// ---------------------------------------------------------------------------
// Individual Health Checks
// ---------------------------------------------------------------------------

/**
 * Check database connectivity and query latency.
 */
async function checkDatabase(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    await withTimeout(async () => {
      return await db.execute(sql`SELECT 1 as ok, NOW() as server_time`);
    }, DATABASE_CHECK_TIMEOUT_MS);

    const latencyMs = Date.now() - start;
    const isSlowButOk = latencyMs > DATABASE_DEGRADED_THRESHOLD_MS;

    return createHealthCheck(
      "database",
      isSlowButOk ? "degraded" : "healthy",
      "critical",
      latencyMs,
      isSlowButOk
        ? `Connected but slow (${latencyMs}ms)`
        : `Connected (${latencyMs}ms)`,
      {
        provider: env.DATABASE_URL?.includes("neon") ? "neon" : "postgres",
      }
    );
  } catch (err) {
    return createHealthCheck(
      "database",
      "unhealthy",
      "critical",
      Date.now() - start,
      `Connection failed: ${errorMessage(err)}`
    );
  }
}

/**
 * Check Solana RPC connectivity by fetching the latest slot.
 */
async function checkSolanaRpc(): Promise<HealthCheck> {
  const rpcUrl = env.SOLANA_RPC_URL;
  if (!rpcUrl) {
    return createHealthCheck(
      "solana_rpc",
      "skipped",
      "warning",
      0,
      "SOLANA_RPC_URL not configured — using default mainnet"
    );
  }

  const start = Date.now();
  try {
    const response = await withTimeout(async () => {
      return await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getSlot",
          params: [{ commitment: "finalized" }],
        }),
        signal: AbortSignal.timeout(SOLANA_RPC_FETCH_TIMEOUT_MS),
      });
    }, SOLANA_RPC_OUTER_TIMEOUT_MS);

    const latencyMs = Date.now() - start;

    if (!response.ok) {
      return createHealthCheck(
        "solana_rpc",
        "unhealthy",
        "warning",
        latencyMs,
        `HTTP ${response.status}`
      );
    }

    const data = (await response.json()) as { result?: number; error?: { message: string } };

    if (data.error) {
      return createHealthCheck(
        "solana_rpc",
        "degraded",
        "warning",
        latencyMs,
        `RPC error: ${data.error.message}`
      );
    }

    return createHealthCheck(
      "solana_rpc",
      latencyMs > SOLANA_RPC_DEGRADED_THRESHOLD_MS ? "degraded" : "healthy",
      "warning",
      latencyMs,
      `Slot ${data.result} (${latencyMs}ms)`,
      { slot: data.result, rpcUrl: rpcUrl.replace(/\/\/.*@/, "//***@") }
    );
  } catch (err) {
    return createHealthCheck(
      "solana_rpc",
      "unhealthy",
      "warning",
      Date.now() - start,
      `Failed: ${errorMessage(err)}`
    );
  }
}

/**
 * Check Jupiter API availability by hitting the price endpoint.
 */
async function checkJupiterApi(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const headers: Record<string, string> = {};
    if (env.JUPITER_API_KEY) {
      headers["x-api-key"] = env.JUPITER_API_KEY;
    }

    // Use SOL mint as a lightweight price check
    const solMint = "So11111111111111111111111111111111111111112";
    const response = await withTimeout(async () => {
      return await fetch(
        `https://api.jup.ag/price/v3?ids=${solMint}`,
        { headers, signal: AbortSignal.timeout(JUPITER_API_FETCH_TIMEOUT_MS) },
      );
    }, JUPITER_API_OUTER_TIMEOUT_MS);

    const latencyMs = Date.now() - start;

    if (!response.ok) {
      return {
        name: "jupiter_api",
        status: "degraded",
        severity: "warning",
        latencyMs,
        message: `HTTP ${response.status} — price endpoint may be down`,
      };
    }

    const data = (await response.json()) as {
      data: Record<string, { price: string } | undefined>;
    };
    const solPrice = data.data?.[solMint]?.price;

    return {
      name: "jupiter_api",
      status: "healthy",
      severity: "warning",
      latencyMs,
      message: `OK (SOL price: $${solPrice ?? "unknown"}, ${latencyMs}ms)`,
      details: { hasApiKey: !!env.JUPITER_API_KEY },
    };
  } catch (err) {
    return {
      name: "jupiter_api",
      status: "unhealthy",
      severity: "warning",
      latencyMs: Date.now() - start,
      message: `Failed: ${errorMessage(err)}`,
    };
  }
}

/**
 * Check Anthropic API (Claude) availability.
 */
async function checkAnthropicApi(): Promise<HealthCheck> {
  if (!env.ANTHROPIC_API_KEY) {
    return {
      name: "anthropic_api",
      status: "skipped",
      severity: "info",
      latencyMs: 0,
      message: "ANTHROPIC_API_KEY not configured — Claude agent will not trade",
    };
  }

  const start = Date.now();
  try {
    // Use a lightweight models list endpoint
    const response = await withTimeout(async () => {
      return await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY!,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }],
        }),
        signal: AbortSignal.timeout(ANTHROPIC_API_FETCH_TIMEOUT_MS),
      });
    }, ANTHROPIC_API_OUTER_TIMEOUT_MS);

    const latencyMs = Date.now() - start;

    if (response.status === 200) {
      return {
        name: "anthropic_api",
        status: "healthy",
        severity: "info",
        latencyMs,
        message: `API key valid (${latencyMs}ms)`,
      };
    }

    if (response.status === 401) {
      return {
        name: "anthropic_api",
        status: "unhealthy",
        severity: "info",
        latencyMs,
        message: "Invalid API key (401)",
      };
    }

    // 429 or other errors still mean the key works
    return {
      name: "anthropic_api",
      status: "degraded",
      severity: "info",
      latencyMs,
      message: `HTTP ${response.status} — key may be valid but rate-limited`,
    };
  } catch (err) {
    return {
      name: "anthropic_api",
      status: "degraded",
      severity: "info",
      latencyMs: Date.now() - start,
      message: `Check failed: ${errorMessage(err)}`,
    };
  }
}

/**
 * Check OpenAI API availability.
 */
async function checkOpenAIApi(): Promise<HealthCheck> {
  if (!env.OPENAI_API_KEY) {
    return {
      name: "openai_api",
      status: "skipped",
      severity: "info",
      latencyMs: 0,
      message: "OPENAI_API_KEY not configured — GPT agent will not trade",
    };
  }

  const start = Date.now();
  try {
    const response = await withTimeout(async () => {
      return await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
        signal: AbortSignal.timeout(OPENAI_API_FETCH_TIMEOUT_MS),
      });
    }, OPENAI_API_OUTER_TIMEOUT_MS);

    const latencyMs = Date.now() - start;

    if (response.status === 200) {
      return {
        name: "openai_api",
        status: "healthy",
        severity: "info",
        latencyMs,
        message: `API key valid (${latencyMs}ms)`,
      };
    }

    return {
      name: "openai_api",
      status: response.status === 401 ? "unhealthy" : "degraded",
      severity: "info",
      latencyMs,
      message: `HTTP ${response.status}`,
    };
  } catch (err) {
    return {
      name: "openai_api",
      status: "degraded",
      severity: "info",
      latencyMs: Date.now() - start,
      message: `Check failed: ${errorMessage(err)}`,
    };
  }
}

/**
 * Check xAI (Grok) API availability.
 */
async function checkXAIApi(): Promise<HealthCheck> {
  if (!env.XAI_API_KEY) {
    return {
      name: "xai_api",
      status: "skipped",
      severity: "info",
      latencyMs: 0,
      message: "XAI_API_KEY not configured — Grok agent will not trade",
    };
  }

  const start = Date.now();
  try {
    const response = await withTimeout(async () => {
      return await fetch("https://api.x.ai/v1/models", {
        headers: { Authorization: `Bearer ${env.XAI_API_KEY}` },
        signal: AbortSignal.timeout(XAI_API_FETCH_TIMEOUT_MS),
      });
    }, XAI_API_OUTER_TIMEOUT_MS);

    const latencyMs = Date.now() - start;

    if (response.status === 200) {
      return {
        name: "xai_api",
        status: "healthy",
        severity: "info",
        latencyMs,
        message: `API key valid (${latencyMs}ms)`,
      };
    }

    return {
      name: "xai_api",
      status: response.status === 401 ? "unhealthy" : "degraded",
      severity: "info",
      latencyMs,
      message: `HTTP ${response.status}`,
    };
  } catch (err) {
    return {
      name: "xai_api",
      status: "degraded",
      severity: "info",
      latencyMs: Date.now() - start,
      message: `Check failed: ${errorMessage(err)}`,
    };
  }
}

/**
 * Check environment configuration completeness.
 */
function checkEnvironment(): HealthCheck {
  const start = Date.now();
  const missing: string[] = [];
  const present: string[] = [];

  const criticalVars = ["DATABASE_URL", "MOLTBOOK_APP_KEY", "JUPITER_API_KEY", "ADMIN_PASSWORD"];
  const optionalVars = [
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "XAI_API_KEY",
    "SOLANA_RPC_URL",
    "HELIUS_API_KEY",
    "TURNKEY_API_PRIVATE_KEY",
    "TURNKEY_API_PUBLIC_KEY",
    "TURNKEY_ORGANIZATION_ID",
  ];

  for (const v of criticalVars) {
    if (process.env[v]) present.push(v);
    else missing.push(v);
  }

  const optionalMissing: string[] = [];
  for (const v of optionalVars) {
    if (process.env[v]) present.push(v);
    else optionalMissing.push(v);
  }

  const status: CheckStatus =
    missing.length > 0 ? "unhealthy" : optionalMissing.length > 3 ? "degraded" : "healthy";

  return {
    name: "environment",
    status,
    severity: missing.length > 0 ? "critical" : "info",
    latencyMs: Date.now() - start,
    message:
      missing.length > 0
        ? `Missing critical: ${missing.join(", ")}`
        : `${present.length} vars set, ${optionalMissing.length} optional missing`,
    details: {
      criticalPresent: criticalVars.filter((v) => process.env[v]),
      criticalMissing: missing,
      optionalMissing,
    },
  };
}

// ---------------------------------------------------------------------------
// Main Validator
// ---------------------------------------------------------------------------

/**
 * Run all startup health checks in parallel and return a comprehensive report.
 *
 * The application is considered "ready" if no critical checks are unhealthy.
 * Degraded critical checks trigger a warning but still allow startup.
 */
export async function validateStartupHealth(): Promise<StartupHealthReport> {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  console.log("[StartupValidator] Running health checks...");

  // Run environment check synchronously (instant)
  const envCheck = checkEnvironment();

  // Run external dependency checks in parallel
  const [dbCheck, solanaCheck, jupiterCheck, anthropicCheck, openaiCheck, xaiCheck] =
    await Promise.all([
      checkDatabase(),
      checkSolanaRpc(),
      checkJupiterApi(),
      checkAnthropicApi(),
      checkOpenAIApi(),
      checkXAIApi(),
    ]);

  const checks = [envCheck, dbCheck, solanaCheck, jupiterCheck, anthropicCheck, openaiCheck, xaiCheck];

  // Compute summary
  const healthy = countByCondition(checks, (c) => c.status === "healthy");
  const degraded = countByCondition(checks, (c) => c.status === "degraded");
  const unhealthy = countByCondition(checks, (c) => c.status === "unhealthy");
  const skipped = countByCondition(checks, (c) => c.status === "skipped");

  const criticalFailures = checks
    .filter((c) => c.severity === "critical" && c.status === "unhealthy")
    .map((c) => c.name);

  // Overall status
  let overall: CheckStatus;
  if (criticalFailures.length > 0) {
    overall = "unhealthy";
  } else if (unhealthy > 0 || degraded > 0) {
    overall = "degraded";
  } else {
    overall = "healthy";
  }

  const ready = criticalFailures.length === 0;
  const durationMs = Date.now() - startTime;

  const report: StartupHealthReport = {
    overall,
    ready,
    timestamp,
    durationMs,
    checks,
    summary: {
      total: checks.length,
      healthy,
      degraded,
      unhealthy,
      skipped,
      criticalFailures,
    },
    environment: {
      nodeEnv: env.NODE_ENV,
      demoMode: env.DEMO_MODE,
      tradingMode: process.env.TRADING_MODE ?? "paper",
      hasAnthropicKey: !!env.ANTHROPIC_API_KEY,
      hasOpenAIKey: !!env.OPENAI_API_KEY,
      hasXAIKey: !!env.XAI_API_KEY,
      hasSolanaRpc: !!env.SOLANA_RPC_URL,
      hasHeliusKey: !!env.HELIUS_API_KEY,
      hasTurnkeyKeys: !!(env.TURNKEY_API_PRIVATE_KEY && env.TURNKEY_API_PUBLIC_KEY),
    },
  };

  // Log results
  for (const check of checks) {
    const icon =
      check.status === "healthy" ? "OK" :
      check.status === "degraded" ? "WARN" :
      check.status === "unhealthy" ? "FAIL" : "SKIP";
    console.log(
      `[StartupValidator] ${icon} ${check.name}: ${check.message} (${check.latencyMs}ms)`,
    );
  }

  console.log(
    `[StartupValidator] Overall: ${overall.toUpperCase()} | Ready: ${ready} | ${durationMs}ms | ` +
    `${healthy} healthy, ${degraded} degraded, ${unhealthy} unhealthy, ${skipped} skipped`,
  );

  return report;
}

// ---------------------------------------------------------------------------
// Background Health Ticker (optional)
// ---------------------------------------------------------------------------

let healthTickerInterval: ReturnType<typeof setInterval> | null = null;
let lastHealthReport: StartupHealthReport | null = null;

/**
 * Start a background health check that runs every `intervalMs`.
 * Default: every 5 minutes.
 */
export function startHealthTicker(intervalMs: number = 5 * 60 * 1000): void {
  if (healthTickerInterval) {
    clearInterval(healthTickerInterval);
  }

  healthTickerInterval = setInterval(async () => {
    try {
      lastHealthReport = await validateStartupHealth();
    } catch (err) {
      console.error(
        `[StartupValidator] Background health check failed: ${errorMessage(err)}`,
      );
    }
  }, intervalMs);

  console.log(`[StartupValidator] Background health ticker started (every ${intervalMs / 1000}s)`);
}

/**
 * Stop the background health ticker.
 */
export function stopHealthTicker(): void {
  if (healthTickerInterval) {
    clearInterval(healthTickerInterval);
    healthTickerInterval = null;
    console.log("[StartupValidator] Background health ticker stopped");
  }
}

/**
 * Get the most recent health report (from background ticker or startup).
 */
export function getLastHealthReport(): StartupHealthReport | null {
  return lastHealthReport;
}

/**
 * Set the last health report (called from startup).
 */
export function setLastHealthReport(report: StartupHealthReport): void {
  lastHealthReport = report;
}
