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
// Check Timeout Wrapper
// ---------------------------------------------------------------------------

const DEFAULT_CHECK_TIMEOUT_MS = 8_000;

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
    const result = await withTimeout(async () => {
      return await db.execute(sql`SELECT 1 as ok, NOW() as server_time`);
    }, 5_000);

    const latencyMs = Date.now() - start;
    const isSlowButOk = latencyMs > 2000;

    return {
      name: "database",
      status: isSlowButOk ? "degraded" : "healthy",
      severity: "critical",
      latencyMs,
      message: isSlowButOk
        ? `Connected but slow (${latencyMs}ms)`
        : `Connected (${latencyMs}ms)`,
      details: {
        provider: env.DATABASE_URL?.includes("neon") ? "neon" : "postgres",
      },
    };
  } catch (err) {
    return {
      name: "database",
      status: "unhealthy",
      severity: "critical",
      latencyMs: Date.now() - start,
      message: `Connection failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Check Solana RPC connectivity by fetching the latest slot.
 */
async function checkSolanaRpc(): Promise<HealthCheck> {
  const rpcUrl = env.SOLANA_RPC_URL;
  if (!rpcUrl) {
    return {
      name: "solana_rpc",
      status: "skipped",
      severity: "warning",
      latencyMs: 0,
      message: "SOLANA_RPC_URL not configured — using default mainnet",
    };
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
        signal: AbortSignal.timeout(5000),
      });
    }, 6_000);

    const latencyMs = Date.now() - start;

    if (!response.ok) {
      return {
        name: "solana_rpc",
        status: "unhealthy",
        severity: "warning",
        latencyMs,
        message: `HTTP ${response.status}`,
      };
    }

    const data = (await response.json()) as { result?: number; error?: { message: string } };

    if (data.error) {
      return {
        name: "solana_rpc",
        status: "degraded",
        severity: "warning",
        latencyMs,
        message: `RPC error: ${data.error.message}`,
      };
    }

    return {
      name: "solana_rpc",
      status: latencyMs > 3000 ? "degraded" : "healthy",
      severity: "warning",
      latencyMs,
      message: `Slot ${data.result} (${latencyMs}ms)`,
      details: { slot: data.result, rpcUrl: rpcUrl.replace(/\/\/.*@/, "//***@") },
    };
  } catch (err) {
    return {
      name: "solana_rpc",
      status: "unhealthy",
      severity: "warning",
      latencyMs: Date.now() - start,
      message: `Failed: ${err instanceof Error ? err.message : String(err)}`,
    };
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
        { headers, signal: AbortSignal.timeout(5000) },
      );
    }, 6_000);

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
      message: `Failed: ${err instanceof Error ? err.message : String(err)}`,
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
        signal: AbortSignal.timeout(10000),
      });
    }, 12_000);

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
      message: `Check failed: ${err instanceof Error ? err.message : String(err)}`,
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
        signal: AbortSignal.timeout(5000),
      });
    }, 6_000);

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
      message: `Check failed: ${err instanceof Error ? err.message : String(err)}`,
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
        signal: AbortSignal.timeout(5000),
      });
    }, 6_000);

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
      message: `Check failed: ${err instanceof Error ? err.message : String(err)}`,
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
  const healthy = checks.filter((c) => c.status === "healthy").length;
  const degraded = checks.filter((c) => c.status === "degraded").length;
  const unhealthy = checks.filter((c) => c.status === "unhealthy").length;
  const skipped = checks.filter((c) => c.status === "skipped").length;

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
        `[StartupValidator] Background health check failed: ${err instanceof Error ? err.message : String(err)}`,
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
