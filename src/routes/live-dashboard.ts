/**
 * Live Dashboard Data API
 *
 * Single endpoint that aggregates all the data needed for the real-time
 * competition dashboard. Instead of the frontend making 10+ API calls,
 * it makes one call here and gets everything.
 *
 * This is the data API behind the /compete dashboard page.
 */

import { Hono } from "hono";
import { getAgentConfigs, getTradingInfraStatus } from "../agents/orchestrator.ts";
import { getRunnerStatus, getRunnerStats } from "../services/autonomous-runner.ts";
import { getStrategyTunerStatus } from "../services/strategy-tuner.ts";
import { getAnalyzerStatus } from "../services/cross-agent-analyzer.ts";
import { getRecentRoundAnalytics, getAnalyticsStatus } from "../services/round-analytics.ts";
import { getCircuitBreakerStatus } from "../services/circuit-breaker.ts";
import { getLockStatus } from "../services/trading-lock.ts";
import { getSearchCacheMetrics } from "../services/search-cache.ts";
import { getEmergencyState, checkHealth } from "../services/production-hardening.ts";
import { collectAllMetrics } from "../services/observability.ts";

const app = new Hono();

/**
 * GET / — full dashboard data snapshot
 *
 * Returns everything the dashboard needs in one call:
 * - Agent profiles and current adjustments
 * - Recent round results and analytics
 * - System health (circuit breakers, locks, cache)
 * - Runner status (if running locally)
 * - Cross-agent insights
 */
app.get("/", async (c) => {
  const snapshot = buildDashboardSnapshot();
  return c.json(snapshot);
});

/**
 * GET /agents — agent profiles with strategy adjustments
 */
app.get("/agents", (c) => {
  const agents = getAgentConfigs();
  const tuner = getStrategyTunerStatus();

  const enriched = agents.map((agent) => {
    const adjustment = tuner.activeAdjustments.find(
      (a) => a.agentId === agent.agentId,
    );
    return {
      ...agent,
      strategyAdjustment: adjustment?.adjustment ?? null,
    };
  });

  return c.json({ agents: enriched });
});

/**
 * GET /rounds — recent round results with analytics
 */
app.get("/rounds", (c) => {
  const limit = parseInt(c.req.query("limit") ?? "10", 10);
  const analytics = getRecentRoundAnalytics(limit);
  return c.json({ rounds: analytics, count: analytics.length });
});

/**
 * GET /health — system health summary
 */
app.get("/health", (c) => {
  const emergency = getEmergencyState();
  const health = checkHealth();
  const infra = getTradingInfraStatus();
  const runner = getRunnerStatus();

  return c.json({
    emergency,
    health,
    infrastructure: infra,
    runner: {
      status: runner.status,
      totalRoundsRun: runner.totalRoundsRun,
      consecutiveFailures: runner.consecutiveFailures,
      nextScheduledAt: runner.nextScheduledAt,
    },
  });
});

/**
 * GET /insights — cross-agent insights and alerts
 */
app.get("/insights", (c) => {
  const analyzer = getAnalyzerStatus();
  return c.json(analyzer);
});

/**
 * GET /metrics — observability metrics for charts
 */
app.get("/metrics", (c) => {
  try {
    const metrics = collectAllMetrics();
    return c.json(metrics);
  } catch {
    return c.json({ error: "Metrics unavailable" });
  }
});

// ---------------------------------------------------------------------------
// Snapshot Builder
// ---------------------------------------------------------------------------

function buildDashboardSnapshot() {
  const now = new Date().toISOString();

  // Agent profiles
  const agents = getAgentConfigs();

  // Recent analytics
  const recentRounds = getRecentRoundAnalytics(5);

  // System status
  const circuitBreaker = getCircuitBreakerStatus();
  const lock = getLockStatus();
  const searchCache = getSearchCacheMetrics();
  const emergency = getEmergencyState();

  // Runner
  const runner = getRunnerStatus();
  const runnerStats = getRunnerStats();

  // Strategy tuner
  const tuner = getStrategyTunerStatus();

  // Cross-agent
  const crossAgent = getAnalyzerStatus();

  // Round analytics
  const analyticsStatus = getAnalyticsStatus();

  // Health
  let health: Record<string, unknown> = {};
  try {
    health = checkHealth() as unknown as Record<string, unknown>;
  } catch {
    health = { status: "unknown" };
  }

  return {
    generatedAt: now,
    version: "1.0.0",

    agents: agents.map((a) => ({
      ...a,
      strategyAdjustment:
        tuner.activeAdjustments.find((adj) => adj.agentId === a.agentId)
          ?.adjustment ?? null,
    })),

    recentRounds: recentRounds.map((r) => ({
      roundId: r.roundId,
      timestamp: r.timestamp,
      consensus: r.consensus.type,
      qualityScore: r.quality.roundQualityScore,
      activeAgents: r.participation.activeAgents,
      totalUsdc: r.metrics.totalUsdcTraded,
      durationMs: r.metrics.roundDurationMs,
    })),

    system: {
      emergency,
      health,
      circuitBreaker: {
        totalActivations:
          typeof circuitBreaker === "object" ? circuitBreaker : null,
      },
      lock,
      searchCache,
    },

    runner: {
      status: runner.status,
      startedAt: runner.startedAt,
      totalRoundsRun: runner.totalRoundsRun,
      successRate: runnerStats.successRate,
      avgDurationMs: runnerStats.avgRoundDurationMs,
      consecutiveFailures: runner.consecutiveFailures,
      nextScheduledAt: runner.nextScheduledAt,
    },

    tuner: {
      enabled: tuner.enabled,
      agentsWithAdjustments: tuner.stats.agentsWithActiveAdjustments,
      agentsInConservativeMode: tuner.stats.agentsInConservativeMode,
      avgPositionMultiplier: tuner.stats.averagePositionMultiplier,
    },

    crossAgent: {
      totalDecisionsTracked: crossAgent.totalDecisionsTracked,
      totalRoundsTracked: crossAgent.totalRoundsTracked,
      herdingAlerts: crossAgent.herdingAlertCount,
      contrarianSignals: crossAgent.contrarianSignalCount,
      styleDriftAlerts: crossAgent.styleDriftAlertCount,
    },

    analytics: analyticsStatus,
  };
}

export const liveDashboardRoutes = app;
