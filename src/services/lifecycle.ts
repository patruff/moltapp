/**
 * Application Lifecycle Manager
 *
 * Handles graceful shutdown and deep health checks for the MoltApp platform.
 *
 * Graceful Shutdown:
 * - Listens for SIGTERM/SIGINT signals
 * - Stops accepting new requests
 * - Waits for in-flight trading rounds to complete
 * - Closes database connections
 * - Flushes pending webhook deliveries
 * - Exits cleanly
 *
 * Deep Health Checks:
 * - Database connectivity + latency
 * - Solana RPC availability + latency
 * - Jupiter API availability + latency
 * - Trading lock status
 * - Memory usage and uptime
 * - Overall readiness determination
 *
 * Readiness Probe:
 * - Returns 200 when ALL critical dependencies are healthy
 * - Returns 503 when any critical dependency is down
 * - Used by load balancers to route traffic
 */

import { db } from "../db/index.ts";
import { sql } from "drizzle-orm";
import { JUPITER_API_BASE_URL } from "../config/constants.ts";
import { errorMessage } from "../lib/errors.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DependencyHealth {
  name: string;
  status: "healthy" | "degraded" | "unhealthy";
  latencyMs: number;
  error?: string;
  details?: Record<string, unknown>;
}

export interface DeepHealthResult {
  status: "healthy" | "degraded" | "unhealthy";
  uptime: number;
  uptimeHuman: string;
  timestamp: string;
  memory: {
    heapUsedMB: number;
    heapTotalMB: number;
    rssMB: number;
    usagePercent: number;
  };
  dependencies: DependencyHealth[];
  /** Total latency of the health check itself */
  checkDurationMs: number;
}

export interface ReadinessResult {
  ready: boolean;
  status: "ready" | "not_ready";
  checks: Array<{
    name: string;
    passed: boolean;
    error?: string;
  }>;
}

export type ShutdownHook = () => Promise<void>;

export interface LifecycleMetrics {
  startedAt: string;
  uptime: number;
  shutdownInProgress: boolean;
  totalHealthChecks: number;
  lastHealthCheckAt: string | null;
  lastHealthStatus: string | null;
  registeredShutdownHooks: number;
  inFlightRequests: number;
}

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Database Health Check Parameters
 *
 * Controls timeout and latency thresholds for database dependency checks.
 */

/** Maximum time to wait for database health check before considering it failed (5 seconds) */
const DB_CHECK_TIMEOUT_MS = 5000;

/**
 * Database latency threshold for "degraded" status.
 * Queries slower than this are marked degraded but still functional.
 * (2 seconds = typical slow query threshold for Neon PostgreSQL)
 */
const DB_LATENCY_DEGRADED_THRESHOLD_MS = 2000;

/**
 * Solana RPC Health Check Parameters
 *
 * Controls timeout and latency thresholds for Solana RPC dependency checks.
 */

/** Maximum time to wait for Solana RPC health check before considering it failed (5 seconds) */
const SOLANA_RPC_CHECK_TIMEOUT_MS = 5000;

/**
 * Solana RPC latency threshold for "degraded" status.
 * RPC calls slower than this are marked degraded but still functional.
 * (3 seconds = slower than typical 1-2s mainnet-beta RPC response time)
 */
const SOLANA_LATENCY_DEGRADED_THRESHOLD_MS = 3000;

/**
 * Jupiter API Health Check Parameters
 *
 * Controls timeout and latency thresholds for Jupiter API dependency checks.
 */

/** Maximum time to wait for Jupiter API health check before considering it failed (5 seconds) */
const JUPITER_CHECK_TIMEOUT_MS = 5000;

/**
 * Jupiter API latency threshold for "degraded" status.
 * API calls slower than this are marked degraded but still functional.
 * (3 seconds = slower than typical 1-2s Jupiter price fetch)
 */
const JUPITER_LATENCY_DEGRADED_THRESHOLD_MS = 3000;

/**
 * Graceful Shutdown Parameters
 *
 * Controls shutdown timing and coordination.
 */

/**
 * Maximum time to wait for in-flight requests to complete during shutdown.
 * After this timeout, shutdown proceeds even if requests are still pending.
 * (30 seconds = allows most trading rounds to complete gracefully)
 */
const SHUTDOWN_DRAIN_TIMEOUT_MS = 30_000;

/**
 * Maximum time to wait for each shutdown hook to complete.
 * Hooks exceeding this timeout are terminated to prevent hung shutdown.
 * (10 seconds = allows database close, webhook flush, etc.)
 */
const SHUTDOWN_HOOK_TIMEOUT_MS = 10_000;

/**
 * Memory Usage Threshold
 *
 * Controls when high memory usage triggers "degraded" health status.
 */

/**
 * Heap memory usage percentage threshold for "degraded" status.
 * When heapUsed/heapTotal exceeds this, system is marked degraded.
 * (90% = approaching V8 heap limit, GC pressure likely)
 */
const MEMORY_USAGE_DEGRADED_THRESHOLD_PERCENT = 90;

/**
 * Memory Unit Conversion
 *
 * Used when converting raw Node.js process.memoryUsage() byte counts to
 * human-readable megabytes for health check responses and dashboards.
 *
 * Formula: bytes / BYTES_PER_MB / BYTES_PER_MB = megabytes
 * Example: 52,428,800 bytes / 1024 / 1024 = 50 MB
 *
 * Note: 1 MB = 1024 KiB = 1024 × 1024 bytes = 1,048,576 bytes.
 * The division is applied twice: first bytes→KiB, then KiB→MiB.
 */
const BYTES_PER_MB = 1024;

/**
 * Percentage Multiplier
 *
 * Converts a decimal fraction (0–1) to an integer percentage (0–100).
 * Used when computing heap usage percent from heapUsed/heapTotal ratio.
 *
 * Formula: Math.round((heapUsedMB / heapTotalMB) * PERCENT_MULTIPLIER)
 * Example: 0.72 × 100 = 72%
 */
const PERCENT_MULTIPLIER = 100;

/**
 * Shutdown Drain Check Interval
 *
 * How often the graceful shutdown loop polls in-flight request count
 * while waiting for active requests to drain before closing connections.
 *
 * (1 second = frequent enough to log progress without busy-waiting;
 *  the loop is bounded by SHUTDOWN_DRAIN_TIMEOUT_MS = 30 s)
 */
const SHUTDOWN_DRAIN_CHECK_INTERVAL_MS = 1000;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const startedAt = Date.now();
let shutdownInProgress = false;
let totalHealthChecks = 0;
let lastHealthCheckAt: string | null = null;
let lastHealthStatus: string | null = null;
let inFlightRequests = 0;

const shutdownHooks: Array<{ name: string; hook: ShutdownHook }> = [];

// ---------------------------------------------------------------------------
// In-Flight Request Tracking
// ---------------------------------------------------------------------------

/**
 * Increment the in-flight request counter.
 * Call at the start of request handling.
 */
export function trackRequestStart(): void {
  inFlightRequests++;
}

/**
 * Decrement the in-flight request counter.
 * Call at the end of request handling.
 */
export function trackRequestEnd(): void {
  inFlightRequests = Math.max(0, inFlightRequests - 1);
}

/**
 * Get current in-flight request count.
 */
export function getInFlightCount(): number {
  return inFlightRequests;
}

// ---------------------------------------------------------------------------
// Shutdown Hook Registration
// ---------------------------------------------------------------------------

/**
 * Register a hook to be called during graceful shutdown.
 * Hooks run in order of registration.
 */
export function registerShutdownHook(name: string, hook: ShutdownHook): void {
  shutdownHooks.push({ name, hook });
  console.log(`[Lifecycle] Registered shutdown hook: ${name}`);
}

// ---------------------------------------------------------------------------
// Deep Health Check
// ---------------------------------------------------------------------------

/**
 * Run a comprehensive health check of all dependencies.
 * This is more thorough than the basic /health endpoint.
 */
export async function deepHealthCheck(): Promise<DeepHealthResult> {
  const checkStart = Date.now();
  totalHealthChecks++;

  const dependencies: DependencyHealth[] = [];

  // Check all dependencies in parallel
  const [dbHealth, solanaHealth, jupiterHealth] = await Promise.allSettled([
    checkDatabase(),
    checkSolanaRpc(),
    checkJupiterApi(),
  ]);

  if (dbHealth.status === "fulfilled") {
    dependencies.push(dbHealth.value);
  } else {
    dependencies.push(
      createDependencyHealth(
        "database",
        "unhealthy",
        -1,
        dbHealth.reason?.message ?? "Unknown error",
      ),
    );
  }

  if (solanaHealth.status === "fulfilled") {
    dependencies.push(solanaHealth.value);
  } else {
    dependencies.push(
      createDependencyHealth(
        "solana_rpc",
        "unhealthy",
        -1,
        solanaHealth.reason?.message ?? "Unknown error",
      ),
    );
  }

  if (jupiterHealth.status === "fulfilled") {
    dependencies.push(jupiterHealth.value);
  } else {
    dependencies.push(
      createDependencyHealth(
        "jupiter_api",
        "unhealthy",
        -1,
        jupiterHealth.reason?.message ?? "Unknown error",
      ),
    );
  }

  // Memory usage
  const mem = process.memoryUsage();
  const heapUsedMB = Math.round(mem.heapUsed / BYTES_PER_MB / BYTES_PER_MB);
  const heapTotalMB = Math.round(mem.heapTotal / BYTES_PER_MB / BYTES_PER_MB);
  const rssMB = Math.round(mem.rss / BYTES_PER_MB / BYTES_PER_MB);
  const usagePercent =
    heapTotalMB > 0
      ? Math.round((heapUsedMB / heapTotalMB) * PERCENT_MULTIPLIER)
      : 0;

  // Determine overall status
  const hasUnhealthy = dependencies.some((d) => d.status === "unhealthy");
  const hasDegraded = dependencies.some((d) => d.status === "degraded");
  const isHighMemory = usagePercent > MEMORY_USAGE_DEGRADED_THRESHOLD_PERCENT;

  let status: "healthy" | "degraded" | "unhealthy";
  if (hasUnhealthy) {
    status = "unhealthy";
  } else if (hasDegraded || isHighMemory) {
    status = "degraded";
  } else {
    status = "healthy";
  }

  const uptime = Date.now() - startedAt;
  const uptimeHuman = formatUptime(uptime);
  const checkDurationMs = Date.now() - checkStart;

  lastHealthCheckAt = new Date().toISOString();
  lastHealthStatus = status;

  return {
    status,
    uptime,
    uptimeHuman,
    timestamp: new Date().toISOString(),
    memory: { heapUsedMB, heapTotalMB, rssMB, usagePercent },
    dependencies,
    checkDurationMs,
  };
}

/**
 * Quick readiness probe — returns true only if ALL critical deps are available.
 * Suitable for K8s readiness probes and load balancer health checks.
 */
export async function readinessCheck(): Promise<ReadinessResult> {
  const checks: ReadinessResult["checks"] = [];

  // Database readiness
  try {
    await db.execute(sql`SELECT 1`);
    checks.push({ name: "database", passed: true });
  } catch (err) {
    checks.push({
      name: "database",
      passed: false,
      error: errorMessage(err),
    });
  }

  // Not shutting down
  if (shutdownInProgress) {
    checks.push({
      name: "shutdown",
      passed: false,
      error: "Graceful shutdown in progress",
    });
  } else {
    checks.push({ name: "shutdown", passed: true });
  }

  const allPassed = checks.every((c) => c.passed);

  return {
    ready: allPassed,
    status: allPassed ? "ready" : "not_ready",
    checks,
  };
}

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

/**
 * Create a DependencyHealth object with consistent structure.
 *
 * Consolidates duplicate object construction across all dependency check functions.
 * All health checks return this consistent shape for the /health API endpoint.
 *
 * @param name - Dependency identifier (e.g., "database", "solana_rpc", "jupiter_api")
 * @param status - Health status: "healthy", "degraded", or "unhealthy"
 * @param latencyMs - Response time in milliseconds (-1 for failed checks)
 * @param error - Optional error message (only for degraded/unhealthy states)
 * @param details - Optional metadata (e.g., endpoint URL, provider info)
 * @returns Standardized DependencyHealth object
 *
 * @example
 * // Before:
 * return {
 *   name: "database",
 *   status: "healthy",
 *   latencyMs: 45,
 *   details: { type: "postgresql" }
 * };
 *
 * // After:
 * return createDependencyHealth("database", "healthy", 45, undefined, {
 *   type: "postgresql"
 * });
 */
function createDependencyHealth(
  name: string,
  status: "healthy" | "degraded" | "unhealthy",
  latencyMs: number,
  error?: string,
  details?: Record<string, unknown>,
): DependencyHealth {
  const health: DependencyHealth = {
    name,
    status,
    latencyMs,
  };

  if (error !== undefined) {
    health.error = error;
  }

  if (details !== undefined) {
    health.details = details;
  }

  return health;
}

// ---------------------------------------------------------------------------
// Dependency Checks
// ---------------------------------------------------------------------------

async function checkDatabase(): Promise<DependencyHealth> {
  const start = Date.now();
  try {
    const result = await Promise.race([
      db.execute(sql`SELECT 1 as health_check`),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `Database timeout (${DB_CHECK_TIMEOUT_MS / 1000}s)`,
              ),
            ),
          DB_CHECK_TIMEOUT_MS,
        ),
      ),
    ]);
    const latencyMs = Date.now() - start;

    return createDependencyHealth(
      "database",
      latencyMs > DB_LATENCY_DEGRADED_THRESHOLD_MS ? "degraded" : "healthy",
      latencyMs,
      undefined,
      {
        type: "postgresql",
        provider: "neon",
      },
    );
  } catch (err) {
    return createDependencyHealth(
      "database",
      "unhealthy",
      Date.now() - start,
      errorMessage(err),
    );
  }
}

async function checkSolanaRpc(): Promise<DependencyHealth> {
  const rpcUrl =
    process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
  const start = Date.now();

  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getHealth",
      }),
      signal: AbortSignal.timeout(SOLANA_RPC_CHECK_TIMEOUT_MS),
    });

    const latencyMs = Date.now() - start;

    if (!response.ok) {
      return createDependencyHealth(
        "solana_rpc",
        "unhealthy",
        latencyMs,
        `HTTP ${response.status}`,
      );
    }

    const data = (await response.json()) as {
      result?: string;
      error?: { message: string };
    };

    if (data.result === "ok") {
      return createDependencyHealth(
        "solana_rpc",
        latencyMs > SOLANA_LATENCY_DEGRADED_THRESHOLD_MS
          ? "degraded"
          : "healthy",
        latencyMs,
        undefined,
        {
          endpoint: rpcUrl.replace(/api-key=[^&]+/, "api-key=***"),
        },
      );
    }

    return createDependencyHealth(
      "solana_rpc",
      "degraded",
      latencyMs,
      data.error?.message ?? "RPC not healthy",
    );
  } catch (err) {
    return createDependencyHealth(
      "solana_rpc",
      "unhealthy",
      Date.now() - start,
      errorMessage(err),
    );
  }
}

async function checkJupiterApi(): Promise<DependencyHealth> {
  const start = Date.now();

  try {
    const jupiterApiKey = process.env.JUPITER_API_KEY;
    const headers: Record<string, string> = {};
    if (jupiterApiKey) {
      headers["x-api-key"] = jupiterApiKey;
    }

    // Use a lightweight endpoint: price of SOL
    const response = await fetch(
      `${JUPITER_API_BASE_URL}/price/v3?ids=So11111111111111111111111111111111111111112`,
      {
        headers,
        signal: AbortSignal.timeout(JUPITER_CHECK_TIMEOUT_MS),
      },
    );

    const latencyMs = Date.now() - start;

    if (!response.ok) {
      return createDependencyHealth(
        "jupiter_api",
        "unhealthy",
        latencyMs,
        `HTTP ${response.status}`,
      );
    }

    return createDependencyHealth(
      "jupiter_api",
      latencyMs > JUPITER_LATENCY_DEGRADED_THRESHOLD_MS
        ? "degraded"
        : "healthy",
      latencyMs,
      undefined,
      {
        endpoint: JUPITER_API_BASE_URL,
      },
    );
  } catch (err) {
    return createDependencyHealth(
      "jupiter_api",
      "unhealthy",
      Date.now() - start,
      errorMessage(err),
    );
  }
}

// ---------------------------------------------------------------------------
// Graceful Shutdown
// ---------------------------------------------------------------------------

/**
 * Initiate graceful shutdown.
 *
 * 1. Sets shutdown flag (rejects new requests via readiness probe)
 * 2. Waits for in-flight requests to drain (max 30s)
 * 3. Runs all registered shutdown hooks in order
 * 4. Exits the process
 */
export async function gracefulShutdown(signal: string): Promise<void> {
  if (shutdownInProgress) {
    console.log(`[Lifecycle] Shutdown already in progress, ignoring ${signal}`);
    return;
  }

  shutdownInProgress = true;
  const shutdownStart = Date.now();

  console.log(
    `[Lifecycle] Graceful shutdown initiated (signal: ${signal})`,
  );
  console.log(
    `[Lifecycle] ${inFlightRequests} in-flight requests, ${shutdownHooks.length} hooks to run`,
  );

  // Step 1: Wait for in-flight requests to drain
  const drainStart = Date.now();

  while (
    inFlightRequests > 0 &&
    Date.now() - drainStart < SHUTDOWN_DRAIN_TIMEOUT_MS
  ) {
    console.log(
      `[Lifecycle] Waiting for ${inFlightRequests} in-flight requests to complete...`,
    );
    await new Promise((resolve) =>
      setTimeout(resolve, SHUTDOWN_DRAIN_CHECK_INTERVAL_MS),
    );
  }

  if (inFlightRequests > 0) {
    console.warn(
      `[Lifecycle] Drain timeout reached with ${inFlightRequests} requests still in-flight`,
    );
  } else {
    console.log(
      `[Lifecycle] All in-flight requests drained in ${Date.now() - drainStart}ms`,
    );
  }

  // Step 2: Run shutdown hooks
  for (const { name, hook } of shutdownHooks) {
    try {
      console.log(`[Lifecycle] Running shutdown hook: ${name}`);
      await Promise.race([
        hook(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `Shutdown hook "${name}" timed out (${SHUTDOWN_HOOK_TIMEOUT_MS / 1000}s)`,
                ),
              ),
            SHUTDOWN_HOOK_TIMEOUT_MS,
          ),
        ),
      ]);
      console.log(`[Lifecycle] Shutdown hook completed: ${name}`);
    } catch (err) {
      console.error(
        `[Lifecycle] Shutdown hook "${name}" failed: ${errorMessage(err)}`,
      );
    }
  }

  const totalDuration = Date.now() - shutdownStart;
  console.log(
    `[Lifecycle] Graceful shutdown complete in ${totalDuration}ms. Exiting.`,
  );

  process.exit(0);
}

/**
 * Install signal handlers for graceful shutdown.
 * Call this once at application startup.
 */
export function installSignalHandlers(): void {
  const handler = (signal: string) => {
    gracefulShutdown(signal).catch((err) => {
      console.error(`[Lifecycle] Shutdown error: ${err}`);
      process.exit(1);
    });
  };

  process.on("SIGTERM", () => handler("SIGTERM"));
  process.on("SIGINT", () => handler("SIGINT"));

  // Uncaught exceptions — log and exit
  process.on("uncaughtException", (err) => {
    console.error(`[Lifecycle] Uncaught exception: ${err.message}`);
    console.error(err.stack);
    handler("uncaughtException");
  });

  // Unhandled promise rejections
  process.on("unhandledRejection", (reason) => {
    console.error(
      `[Lifecycle] Unhandled rejection: ${errorMessage(reason)}`,
    );
  });

  console.log("[Lifecycle] Signal handlers installed (SIGTERM, SIGINT)");
}

/**
 * Check if shutdown is in progress.
 */
export function isShuttingDown(): boolean {
  return shutdownInProgress;
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/**
 * Get lifecycle manager metrics.
 */
export function getLifecycleMetrics(): LifecycleMetrics {
  return {
    startedAt: new Date(startedAt).toISOString(),
    uptime: Date.now() - startedAt,
    shutdownInProgress,
    totalHealthChecks,
    lastHealthCheckAt,
    lastHealthStatus,
    registeredShutdownHooks: shutdownHooks.length,
    inFlightRequests,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}
