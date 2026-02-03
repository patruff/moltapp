/**
 * Production Hardening & Risk Monitoring Routes
 *
 * Exposes all production hardening services, risk monitoring, transaction
 * confirmation, retry engine metrics, agent feedback, and structured logging.
 *
 * All endpoints are public for monitoring/debugging — no auth required.
 */

import { Hono } from "hono";

// Transaction Confirmer
import {
  getConfirmationMetrics,
  resetConfirmationMetrics,
  getMaxSlippage,
  setMaxSlippage,
} from "../services/transaction-confirmer.ts";

// Production Hardening
import {
  getEmergencyState,
  emergencyHalt,
  emergencyResume,
  isTradingHalted,
  checkHealth,
  getHardeningMetrics,
  resetHardeningMetrics,
  getTimeoutConfig,
  configureTimeouts,
  checkMarketDataFreshness,
  getJupiterFailureCount,
  type AgentTimeoutConfig,
} from "../services/production-hardening.ts";

// Retry Engine
import {
  getRetryMetrics,
  resetRetryMetrics,
  getRetryBudgetStatus,
} from "../services/retry-engine.ts";

// Risk Monitor
import {
  getRiskMonitorMetrics,
  getAnomalies,
  getAllRiskScores,
  getRiskScore,
  getSnapshots,
  getDrawdownTracker,
  resetRiskMonitor,
  type AnomalyType,
} from "../services/risk-monitor.ts";

// Agent Feedback
import {
  getPerformanceProfile,
  generateFeedbackPrompt,
  generateCrossAgentComparison,
  getRecentOutcomes,
  getPendingOutcomes,
  getFeedbackMetrics,
  resetFeedbackData,
} from "../services/agent-feedback.ts";

// Structured Logger
import {
  getRecentLogs,
  getRecentMetrics,
  getLoggerStats,
  getLoggerConfig,
  configureLogger,
  resetLoggerStats,
  type LogLevel,
} from "../services/structured-logger.ts";

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const hardeningRoutes = new Hono();

// ===========================
// Health & Emergency
// ===========================

/** Comprehensive system health check */
hardeningRoutes.get("/health", (c) => {
  const health = checkHealth();
  const statusCode = health.status === "critical" ? 503 : health.status === "degraded" ? 200 : 200;
  return c.json(health, statusCode);
});

/** Get emergency halt state */
hardeningRoutes.get("/emergency", (c) => {
  return c.json(getEmergencyState());
});

/** Trigger emergency halt */
hardeningRoutes.post("/emergency/halt", async (c) => {
  const body = await c.req.json<{
    reason: string;
    triggeredBy?: string;
    autoResumeSeconds?: number;
  }>();
  const state = emergencyHalt(
    body.triggeredBy ?? "api",
    body.reason,
    body.autoResumeSeconds,
  );
  return c.json(state);
});

/** Resume from emergency halt */
hardeningRoutes.post("/emergency/resume", async (c) => {
  const body = await c.req.json<{ resumedBy?: string }>().catch(() => ({}));
  const state = emergencyResume((body as { resumedBy?: string }).resumedBy ?? "api");
  return c.json(state);
});

/** Quick check: is trading halted? */
hardeningRoutes.get("/trading-status", (c) => {
  return c.json(isTradingHalted());
});

// ===========================
// Transaction Confirmation
// ===========================

/** Get transaction confirmation metrics */
hardeningRoutes.get("/confirmations", (c) => {
  return c.json(getConfirmationMetrics());
});

/** Get/set max slippage */
hardeningRoutes.get("/slippage", (c) => {
  return c.json({ maxSlippageBps: getMaxSlippage() });
});

hardeningRoutes.post("/slippage", async (c) => {
  const body = await c.req.json<{ maxSlippageBps: number }>();
  setMaxSlippage(body.maxSlippageBps);
  return c.json({ maxSlippageBps: getMaxSlippage() });
});

/** Reset confirmation metrics */
hardeningRoutes.post("/confirmations/reset", (c) => {
  resetConfirmationMetrics();
  return c.json({ ok: true });
});

// ===========================
// Timeout Configuration
// ===========================

/** Get timeout configuration */
hardeningRoutes.get("/timeouts", (c) => {
  return c.json(getTimeoutConfig());
});

/** Update timeout configuration */
hardeningRoutes.post("/timeouts", async (c) => {
  const body = await c.req.json<Partial<AgentTimeoutConfig>>();
  const updated = configureTimeouts(body);
  return c.json(updated);
});

// ===========================
// Market Data Freshness
// ===========================

hardeningRoutes.get("/market-freshness", (c) => {
  return c.json(checkMarketDataFreshness());
});

hardeningRoutes.get("/jupiter-health", (c) => {
  return c.json({
    consecutiveFailures: getJupiterFailureCount(),
    healthy: getJupiterFailureCount() < 3,
  });
});

// ===========================
// Retry Engine
// ===========================

/** Get retry metrics */
hardeningRoutes.get("/retries", (c) => {
  return c.json(getRetryMetrics());
});

/** Get retry budget status */
hardeningRoutes.get("/retries/budgets", (c) => {
  return c.json(getRetryBudgetStatus());
});

/** Reset retry metrics */
hardeningRoutes.post("/retries/reset", (c) => {
  resetRetryMetrics();
  return c.json({ ok: true });
});

// ===========================
// Risk Monitor
// ===========================

/** Get risk monitor overview */
hardeningRoutes.get("/risk", (c) => {
  return c.json({
    metrics: getRiskMonitorMetrics(),
    allRiskScores: getAllRiskScores(),
  });
});

/** Get risk score for a specific agent */
hardeningRoutes.get("/risk/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const score = getRiskScore(agentId);
  const drawdown = getDrawdownTracker(agentId);
  const snapshots = getSnapshots(agentId, 10);
  return c.json({ score, drawdown, recentSnapshots: snapshots });
});

/** Get anomalies */
hardeningRoutes.get("/risk/anomalies", (c) => {
  const agentId = c.req.query("agentId");
  const type = c.req.query("type") as AnomalyType | undefined;
  const severity = c.req.query("severity");
  const limit = parseInt(c.req.query("limit") ?? "50");

  return c.json(getAnomalies({ agentId, type, severity, limit }));
});

/** Reset risk monitor */
hardeningRoutes.post("/risk/reset", (c) => {
  resetRiskMonitor();
  return c.json({ ok: true });
});

// ===========================
// Agent Feedback
// ===========================

/** Get agent performance profile */
hardeningRoutes.get("/feedback/:agentId/profile", (c) => {
  const agentId = c.req.param("agentId");
  return c.json(getPerformanceProfile(agentId));
});

/** Get generated feedback prompt for an agent */
hardeningRoutes.get("/feedback/:agentId/prompt", (c) => {
  const agentId = c.req.param("agentId");
  return c.json(generateFeedbackPrompt(agentId));
});

/** Get recent outcomes for an agent */
hardeningRoutes.get("/feedback/:agentId/outcomes", (c) => {
  const agentId = c.req.param("agentId");
  const limit = parseInt(c.req.query("limit") ?? "20");
  return c.json({
    recent: getRecentOutcomes(agentId, limit),
    pending: getPendingOutcomes(agentId),
  });
});

/** Cross-agent comparison */
hardeningRoutes.get("/feedback/comparison", (c) => {
  const agentIds = c.req.query("agents")?.split(",") ?? [
    "agent_claude",
    "agent_gpt",
    "agent_grok",
  ];
  return c.json(generateCrossAgentComparison(agentIds));
});

/** Feedback system metrics */
hardeningRoutes.get("/feedback/metrics", (c) => {
  return c.json(getFeedbackMetrics());
});

/** Reset feedback data */
hardeningRoutes.post("/feedback/reset", (c) => {
  resetFeedbackData();
  return c.json({ ok: true });
});

// ===========================
// Structured Logging
// ===========================

/** Get recent logs */
hardeningRoutes.get("/logs", (c) => {
  const level = c.req.query("level") as LogLevel | undefined;
  const service = c.req.query("service");
  const roundId = c.req.query("roundId");
  const agentId = c.req.query("agentId");
  const limit = parseInt(c.req.query("limit") ?? "50");

  return c.json(getRecentLogs({ level, service, roundId, agentId, limit }));
});

/** Get recent metrics */
hardeningRoutes.get("/logs/metrics", (c) => {
  const limit = parseInt(c.req.query("limit") ?? "50");
  return c.json(getRecentMetrics(limit));
});

/** Get logger stats */
hardeningRoutes.get("/logs/stats", (c) => {
  return c.json(getLoggerStats());
});

/** Get/update logger config */
hardeningRoutes.get("/logs/config", (c) => {
  return c.json(getLoggerConfig());
});

hardeningRoutes.post("/logs/config", async (c) => {
  const body = await c.req.json();
  const updated = configureLogger(body);
  return c.json(updated);
});

/** Reset logger stats */
hardeningRoutes.post("/logs/reset", (c) => {
  resetLoggerStats();
  return c.json({ ok: true });
});

// ===========================
// Combined Metrics Dashboard
// ===========================

/** One-stop dashboard endpoint with all metrics */
hardeningRoutes.get("/dashboard", (c) => {
  return c.json({
    health: checkHealth(),
    emergency: getEmergencyState(),
    hardening: getHardeningMetrics(),
    confirmations: getConfirmationMetrics(),
    retries: getRetryMetrics(),
    risk: {
      metrics: getRiskMonitorMetrics(),
      scores: getAllRiskScores(),
    },
    feedback: getFeedbackMetrics(),
    logging: getLoggerStats(),
    marketFreshness: checkMarketDataFreshness(),
    jupiter: {
      consecutiveFailures: getJupiterFailureCount(),
      healthy: getJupiterFailureCount() < 3,
    },
  });
});
