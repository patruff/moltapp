/**
 * Observability Metrics Exporter
 *
 * Centralized metrics aggregation for the entire MoltApp trading platform.
 * Collects metrics from all subsystems and exposes them in a structured
 * format for monitoring dashboards and alerting.
 *
 * Metrics exported:
 * - Trade execution: latency (p50/p95/p99), success/fail rates, volume
 * - Jupiter API: order/execute latency, retry rates, slippage
 * - Solana RPC: call rates, queue depth, error rates
 * - Circuit breakers: activation rates, blocked trades
 * - Rate limiters: hit rates, queue depths
 * - Agent performance: decisions, win rates, P&L
 * - System health: uptime, memory, gate pass/fail
 *
 * Output formats:
 * - JSON endpoint (for dashboards)
 * - Prometheus text format (for Prometheus/Grafana)
 * - CloudWatch-compatible metrics (for AWS deployment)
 *
 * Features:
 * - Percentile calculations (p50, p95, p99)
 * - Rolling windows (1min, 5min, 15min, 1hr)
 * - Custom metric registration
 * - Metric snapshotting for time-series export
 */

import { getExecutionStats } from "./trade-executor.ts";
import { getCircuitBreakerStatus } from "./circuit-breaker.ts";
import { getAllRateLimiterMetrics } from "./rate-limiter.ts";
import { getSearchCacheMetrics } from "./search-cache.ts";
import { getLockStatus } from "./trading-lock.ts";
import { getRpcMetrics } from "./solana-tracker.ts";
import { getConfirmationMetrics } from "./transaction-confirmer.ts";
import { getGateMetrics } from "./pre-round-gate.ts";
import { getJupiterHardenedMetrics } from "./jupiter-hardened.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MetricValue {
  name: string;
  value: number;
  unit: string;
  labels?: Record<string, string>;
  timestamp?: string;
}

export interface PercentileStats {
  count: number;
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface SystemMetrics {
  timestamp: string;
  uptimeSeconds: number;
  memoryUsageMb: number;
  nodeVersion: string;
  tradingMode: string;
  environment: string;
}

export interface TradeMetrics {
  total: number;
  successful: number;
  failed: number;
  successRate: number;
  liveCount: number;
  paperCount: number;
  totalVolumeUSDC: number;
  latency: PercentileStats;
  byAgent: Record<
    string,
    {
      total: number;
      success: number;
      failed: number;
      successRate: number;
    }
  >;
  bySymbol: Record<
    string,
    {
      buys: number;
      sells: number;
      volumeUSDC: number;
    }
  >;
}

export interface JupiterMetricsExport {
  orders: {
    total: number;
    successful: number;
    failed: number;
    successRate: number;
    avgLatencyMs: number;
  };
  executions: {
    total: number;
    successful: number;
    failed: number;
    successRate: number;
    avgLatencyMs: number;
  };
  confirmations: {
    total: number;
    confirmed: number;
    failed: number;
    timedOut: number;
    avgLatencyMs: number;
  };
  slippage: {
    violations: number;
  };
  retries: {
    total: number;
  };
}

export interface RateLimiterExport {
  buckets: Array<{
    name: string;
    currentTokens: number;
    maxTokens: number;
    queueDepth: number;
    totalRequests: number;
    rateLimitHits: number;
    hitRate: number;
    avgWaitMs: number;
  }>;
}

export interface CircuitBreakerExport {
  config: {
    maxTradeUsdc: number;
    dailyLossLimitPercent: number;
    cooldownSeconds: number;
    positionLimitPercent: number;
    maxDailyTrades: number;
  };
  agents: Record<
    string,
    {
      lastTradeTime: string | null;
      tradesToday: number;
      cooldownRemaining: number;
    }
  >;
  totalActivations: number;
  recentActivationCount: number;
}

export interface PreRoundGateExport {
  totalChecks: number;
  opened: number;
  blocked: number;
  blockRate: number;
  avgDurationMs: number;
  failuresByCheck: Record<string, number>;
}

export interface FullMetricsExport {
  timestamp: string;
  system: SystemMetrics;
  trades: TradeMetrics;
  jupiter: JupiterMetricsExport;
  rateLimiters: RateLimiterExport;
  circuitBreakers: CircuitBreakerExport;
  searchCache: {
    totalRequests: number;
    hitRate: number;
    itemsCached: number;
  };
  solanaRpc: {
    totalCalls: number;
    rateLimitHits: number;
    avgWaitMs: number;
    queueDepth: number;
  };
  tradingLock: {
    isLocked: boolean;
    holderInfo: string | null;
  };
  confirmations: {
    total: number;
    successful: number;
    failed: number;
    timedOut: number;
    avgConfirmationMs: number;
    avgPollAttempts: number;
  };
  preRoundGate: PreRoundGateExport;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const startedAt = Date.now();

/** Rolling latency window for percentile calculations */
const latencyWindow: number[] = [];
const MAX_LATENCY_WINDOW = 1000;

/** Metric snapshots for time-series */
const snapshots: Array<{ timestamp: string; metrics: Record<string, number> }> = [];
const MAX_SNAPSHOTS = 360; // 6 hours at 1 per minute

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Calculate percentile statistics from an array of numbers.
 */
export function calculatePercentiles(values: number[]): PercentileStats {
  if (values.length === 0) {
    return { count: 0, min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const len = sorted.length;

  return {
    count: len,
    min: sorted[0],
    max: sorted[len - 1],
    avg: Math.round(sorted.reduce((a, b) => a + b, 0) / len),
    p50: sorted[Math.floor(len * 0.5)],
    p95: sorted[Math.floor(len * 0.95)],
    p99: sorted[Math.floor(len * 0.99)],
  };
}

/**
 * Track a latency value in the rolling window.
 */
export function trackLatency(durationMs: number): void {
  latencyWindow.push(durationMs);
  if (latencyWindow.length > MAX_LATENCY_WINDOW) {
    latencyWindow.splice(0, latencyWindow.length - MAX_LATENCY_WINDOW);
  }
}

// ---------------------------------------------------------------------------
// Metric Collection
// ---------------------------------------------------------------------------

function collectSystemMetrics(): SystemMetrics {
  const memUsage = process.memoryUsage();

  return {
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    memoryUsageMb: Math.round(memUsage.heapUsed / 1024 / 1024),
    nodeVersion: process.version,
    tradingMode: process.env.TRADING_MODE ?? "paper",
    environment: process.env.NODE_ENV ?? "development",
  };
}

function collectTradeMetrics(): TradeMetrics {
  const stats = getExecutionStats();
  const total = stats.totalExecutions;
  const successRate =
    total > 0 ? Math.round((stats.successfulExecutions / total) * 100) : 0;

  // Build agent-level metrics
  const byAgent: TradeMetrics["byAgent"] = {};
  for (const [agentId, agentStats] of Object.entries(stats.executionsByAgent)) {
    byAgent[agentId] = {
      total: agentStats.total,
      success: agentStats.success,
      failed: agentStats.failed,
      successRate:
        agentStats.total > 0
          ? Math.round((agentStats.success / agentStats.total) * 100)
          : 0,
    };
  }

  return {
    total,
    successful: stats.successfulExecutions,
    failed: stats.failedExecutions,
    successRate,
    liveCount: stats.liveExecutions,
    paperCount: stats.paperExecutions,
    totalVolumeUSDC: stats.totalVolumeUSDC,
    latency: calculatePercentiles(latencyWindow),
    byAgent,
    bySymbol: { ...stats.executionsBySymbol },
  };
}

function collectJupiterMetrics(): JupiterMetricsExport {
  const jup = getJupiterHardenedMetrics();

  return {
    orders: {
      total: jup.totalOrders,
      successful: jup.successfulOrders,
      failed: jup.failedOrders,
      successRate:
        jup.totalOrders > 0
          ? Math.round((jup.successfulOrders / jup.totalOrders) * 100)
          : 0,
      avgLatencyMs: jup.avgOrderLatencyMs,
    },
    executions: {
      total: jup.totalExecutions,
      successful: jup.successfulExecutions,
      failed: jup.failedExecutions,
      successRate:
        jup.totalExecutions > 0
          ? Math.round(
              (jup.successfulExecutions / jup.totalExecutions) * 100,
            )
          : 0,
      avgLatencyMs: jup.avgExecutionLatencyMs,
    },
    confirmations: {
      total: jup.totalConfirmations,
      confirmed: jup.confirmedOnChain,
      failed: jup.failedOnChain,
      timedOut: jup.timedOutConfirmations,
      avgLatencyMs: jup.avgConfirmationLatencyMs,
    },
    slippage: {
      violations: jup.slippageViolations,
    },
    retries: {
      total: jup.totalRetries,
    },
  };
}

function collectRateLimiterMetrics(): RateLimiterExport {
  const allMetrics = getAllRateLimiterMetrics();

  return {
    buckets: allMetrics.map((m) => ({
      name: m.name,
      currentTokens: m.currentTokens,
      maxTokens: m.maxTokens,
      queueDepth: m.queueDepth,
      totalRequests: m.totalRequests,
      rateLimitHits: m.rateLimitHits,
      hitRate:
        m.totalRequests > 0
          ? Math.round((m.rateLimitHits / m.totalRequests) * 100)
          : 0,
      avgWaitMs: m.avgWaitMs,
    })),
  };
}

function collectCircuitBreakerMetrics(): CircuitBreakerExport {
  const status = getCircuitBreakerStatus();

  return {
    config: status.config,
    agents: status.agentStates,
    totalActivations: status.totalActivations,
    recentActivationCount: status.recentActivations.length,
  };
}

function collectPreRoundGateMetrics(): PreRoundGateExport {
  const gate = getGateMetrics();

  return {
    totalChecks: gate.totalChecks,
    opened: gate.gatesOpened,
    blocked: gate.gatesBlocked,
    blockRate: gate.blockRate,
    avgDurationMs: gate.avgDurationMs,
    failuresByCheck: gate.failuresByCheck,
  };
}

// ---------------------------------------------------------------------------
// Main Export Function
// ---------------------------------------------------------------------------

/**
 * Collect all metrics from every subsystem into a single structured export.
 *
 * This is the main entry point for dashboards and monitoring.
 */
export function collectAllMetrics(): FullMetricsExport {
  const lockStatus = getLockStatus();
  const searchCache = getSearchCacheMetrics();
  const rpcMetrics = getRpcMetrics();
  const confirmMetrics = getConfirmationMetrics();

  return {
    timestamp: new Date().toISOString(),
    system: collectSystemMetrics(),
    trades: collectTradeMetrics(),
    jupiter: collectJupiterMetrics(),
    rateLimiters: collectRateLimiterMetrics(),
    circuitBreakers: collectCircuitBreakerMetrics(),
    searchCache: {
      totalRequests: searchCache.totalRequests,
      hitRate: searchCache.hitRate,
      itemsCached: searchCache.itemsCached,
    },
    solanaRpc: {
      totalCalls: rpcMetrics.totalCalls,
      rateLimitHits: rpcMetrics.rateLimitHits,
      avgWaitMs: rpcMetrics.avgWaitMs,
      queueDepth: rpcMetrics.queueDepth,
    },
    tradingLock: {
      isLocked: lockStatus.isLocked,
      holderInfo: lockStatus.lock?.holderInfo ?? null,
    },
    confirmations: {
      total: confirmMetrics.totalConfirmations,
      successful: confirmMetrics.successfulConfirmations,
      failed: confirmMetrics.failedConfirmations,
      timedOut: confirmMetrics.timedOutConfirmations,
      avgConfirmationMs: confirmMetrics.averageConfirmationMs,
      avgPollAttempts: confirmMetrics.averagePollAttempts,
    },
    preRoundGate: collectPreRoundGateMetrics(),
  };
}

// ---------------------------------------------------------------------------
// Prometheus Format Export
// ---------------------------------------------------------------------------

/**
 * Export metrics in Prometheus text exposition format.
 *
 * Compatible with Prometheus scraping and Grafana dashboards.
 */
export function exportPrometheusMetrics(): string {
  const m = collectAllMetrics();
  const lines: string[] = [];

  function gauge(name: string, help: string, value: number, labels?: Record<string, string>): void {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} gauge`);
    const labelStr = labels
      ? `{${Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(",")}}`
      : "";
    lines.push(`${name}${labelStr} ${value}`);
  }

  function counter(name: string, help: string, value: number, labels?: Record<string, string>): void {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} counter`);
    const labelStr = labels
      ? `{${Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(",")}}`
      : "";
    lines.push(`${name}${labelStr} ${value}`);
  }

  // System metrics
  gauge("moltapp_uptime_seconds", "Application uptime in seconds", m.system.uptimeSeconds);
  gauge("moltapp_memory_heap_mb", "Heap memory usage in MB", m.system.memoryUsageMb);

  // Trade metrics
  counter("moltapp_trades_total", "Total trade executions", m.trades.total);
  counter("moltapp_trades_successful", "Successful trade executions", m.trades.successful);
  counter("moltapp_trades_failed", "Failed trade executions", m.trades.failed);
  gauge("moltapp_trades_success_rate", "Trade success rate percentage", m.trades.successRate);
  counter("moltapp_trades_volume_usdc", "Total trading volume in USDC", m.trades.totalVolumeUSDC);
  gauge("moltapp_trades_latency_p50_ms", "Trade execution latency p50", m.trades.latency.p50);
  gauge("moltapp_trades_latency_p95_ms", "Trade execution latency p95", m.trades.latency.p95);
  gauge("moltapp_trades_latency_p99_ms", "Trade execution latency p99", m.trades.latency.p99);

  // Agent metrics
  for (const [agentId, agentStats] of Object.entries(m.trades.byAgent)) {
    counter("moltapp_agent_trades_total", "Agent trade count", agentStats.total, { agent: agentId });
    counter("moltapp_agent_trades_success", "Agent successful trades", agentStats.success, { agent: agentId });
    gauge("moltapp_agent_success_rate", "Agent success rate", agentStats.successRate, { agent: agentId });
  }

  // Jupiter metrics
  counter("moltapp_jupiter_orders_total", "Jupiter order requests", m.jupiter.orders.total);
  counter("moltapp_jupiter_orders_failed", "Jupiter order failures", m.jupiter.orders.failed);
  gauge("moltapp_jupiter_order_latency_ms", "Average Jupiter order latency", m.jupiter.orders.avgLatencyMs);
  counter("moltapp_jupiter_executions_total", "Jupiter execute requests", m.jupiter.executions.total);
  counter("moltapp_jupiter_executions_failed", "Jupiter execution failures", m.jupiter.executions.failed);
  counter("moltapp_jupiter_retries_total", "Total Jupiter API retries", m.jupiter.retries.total);
  counter("moltapp_jupiter_slippage_violations", "Slippage limit violations", m.jupiter.slippage.violations);

  // Confirmation metrics
  counter("moltapp_confirmations_total", "Transaction confirmations attempted", m.confirmations.total);
  counter("moltapp_confirmations_successful", "Confirmed on-chain", m.confirmations.successful);
  counter("moltapp_confirmations_timed_out", "Confirmation timeouts", m.confirmations.timedOut);
  gauge("moltapp_confirmation_latency_ms", "Average confirmation latency", m.confirmations.avgConfirmationMs);

  // Rate limiter metrics
  for (const bucket of m.rateLimiters.buckets) {
    gauge("moltapp_ratelimit_tokens", "Available rate limit tokens", bucket.currentTokens, { bucket: bucket.name });
    gauge("moltapp_ratelimit_queue_depth", "Rate limit queue depth", bucket.queueDepth, { bucket: bucket.name });
    counter("moltapp_ratelimit_hits_total", "Rate limit hits", bucket.rateLimitHits, { bucket: bucket.name });
  }

  // Circuit breaker metrics
  counter("moltapp_circuit_breaker_activations", "Circuit breaker activations", m.circuitBreakers.totalActivations);

  // Search cache metrics
  gauge("moltapp_search_cache_hit_rate", "Search cache hit rate percentage", m.searchCache.hitRate);
  gauge("moltapp_search_cache_items", "Items in search cache", m.searchCache.itemsCached);

  // Solana RPC metrics
  counter("moltapp_solana_rpc_calls", "Total Solana RPC calls", m.solanaRpc.totalCalls);
  counter("moltapp_solana_rpc_rate_limits", "Solana RPC rate limit hits", m.solanaRpc.rateLimitHits);
  gauge("moltapp_solana_rpc_queue_depth", "Solana RPC queue depth", m.solanaRpc.queueDepth);

  // Pre-round gate metrics
  counter("moltapp_gate_checks_total", "Pre-round gate checks", m.preRoundGate.totalChecks);
  counter("moltapp_gate_blocked", "Pre-round gate blocks", m.preRoundGate.blocked);
  gauge("moltapp_gate_block_rate", "Pre-round gate block rate", m.preRoundGate.blockRate);

  // Lock status
  gauge("moltapp_trading_lock_held", "Whether trading lock is held", m.tradingLock.isLocked ? 1 : 0);

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Metric Snapshots (Time-Series)
// ---------------------------------------------------------------------------

/**
 * Take a metric snapshot for time-series tracking.
 * Call this periodically (e.g., every 60 seconds) from a timer.
 */
export function takeMetricSnapshot(): void {
  const m = collectAllMetrics();

  const snapshot: Record<string, number> = {
    trades_total: m.trades.total,
    trades_success_rate: m.trades.successRate,
    trades_volume_usdc: m.trades.totalVolumeUSDC,
    trades_latency_p50: m.trades.latency.p50,
    trades_latency_p95: m.trades.latency.p95,
    jupiter_orders: m.jupiter.orders.total,
    jupiter_retries: m.jupiter.retries.total,
    jupiter_slippage_violations: m.jupiter.slippage.violations,
    confirmations_success_rate:
      m.confirmations.total > 0
        ? Math.round(
            (m.confirmations.successful / m.confirmations.total) * 100,
          )
        : 0,
    rpc_calls: m.solanaRpc.totalCalls,
    rpc_rate_limits: m.solanaRpc.rateLimitHits,
    circuit_breaker_activations: m.circuitBreakers.totalActivations,
    cache_hit_rate: m.searchCache.hitRate,
    gate_block_rate: m.preRoundGate.blockRate,
    memory_mb: m.system.memoryUsageMb,
    uptime_s: m.system.uptimeSeconds,
  };

  snapshots.push({
    timestamp: m.timestamp,
    metrics: snapshot,
  });

  if (snapshots.length > MAX_SNAPSHOTS) {
    snapshots.splice(0, snapshots.length - MAX_SNAPSHOTS);
  }
}

/**
 * Get metric snapshots for time-series visualization.
 */
export function getMetricSnapshots(
  limit = 60,
): Array<{ timestamp: string; metrics: Record<string, number> }> {
  return snapshots.slice(-limit);
}

// ---------------------------------------------------------------------------
// Background Metric Collector
// ---------------------------------------------------------------------------

let collectorIntervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Start the background metric collector.
 * Takes snapshots at the specified interval (default: 60 seconds).
 */
export function startMetricCollector(intervalMs = 60_000): void {
  if (collectorIntervalId) {
    clearInterval(collectorIntervalId);
  }

  collectorIntervalId = setInterval(() => {
    try {
      takeMetricSnapshot();
    } catch (err) {
      console.warn(
        `[Observability] Metric snapshot failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, intervalMs);

  // Take an initial snapshot
  takeMetricSnapshot();

  console.log(
    `[Observability] Metric collector started (every ${intervalMs / 1000}s)`,
  );
}

/**
 * Stop the background metric collector.
 */
export function stopMetricCollector(): void {
  if (collectorIntervalId) {
    clearInterval(collectorIntervalId);
    collectorIntervalId = null;
    console.log("[Observability] Metric collector stopped");
  }
}

// ---------------------------------------------------------------------------
// CloudWatch-Compatible Metrics
// ---------------------------------------------------------------------------

/**
 * Export metrics in a format compatible with CloudWatch PutMetricData.
 * Use with the AWS SDK to push custom metrics to CloudWatch.
 */
export function exportCloudWatchMetrics(): Array<{
  MetricName: string;
  Value: number;
  Unit: string;
  Dimensions?: Array<{ Name: string; Value: string }>;
}> {
  const m = collectAllMetrics();
  const cwMetrics: Array<{
    MetricName: string;
    Value: number;
    Unit: string;
    Dimensions?: Array<{ Name: string; Value: string }>;
  }> = [];

  cwMetrics.push(
    { MetricName: "TradeSuccessRate", Value: m.trades.successRate, Unit: "Percent" },
    { MetricName: "TradeLatencyP50", Value: m.trades.latency.p50, Unit: "Milliseconds" },
    { MetricName: "TradeLatencyP95", Value: m.trades.latency.p95, Unit: "Milliseconds" },
    { MetricName: "TradingVolume", Value: m.trades.totalVolumeUSDC, Unit: "Count" },
    { MetricName: "JupiterRetries", Value: m.jupiter.retries.total, Unit: "Count" },
    { MetricName: "SlippageViolations", Value: m.jupiter.slippage.violations, Unit: "Count" },
    { MetricName: "ConfirmationRate", Value:
      m.confirmations.total > 0
        ? Math.round((m.confirmations.successful / m.confirmations.total) * 100)
        : 100,
      Unit: "Percent",
    },
    { MetricName: "CircuitBreakerActivations", Value: m.circuitBreakers.totalActivations, Unit: "Count" },
    { MetricName: "GateBlockRate", Value: m.preRoundGate.blockRate, Unit: "Percent" },
    { MetricName: "MemoryUsage", Value: m.system.memoryUsageMb, Unit: "Megabytes" },
  );

  // Per-agent metrics
  for (const [agentId, agentStats] of Object.entries(m.trades.byAgent)) {
    cwMetrics.push({
      MetricName: "AgentSuccessRate",
      Value: agentStats.successRate,
      Unit: "Percent",
      Dimensions: [{ Name: "AgentId", Value: agentId }],
    });
  }

  return cwMetrics;
}
