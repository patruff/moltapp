/**
 * Trade Execution API Routes
 *
 * Endpoints for monitoring and controlling the trade execution pipeline.
 * These routes expose the execution engine's state, allow retrying failed
 * trades, and provide real-time execution statistics.
 *
 * All routes are public (read-only monitoring). Write operations
 * (retry, reset) are gated by admin auth.
 */

import { Hono } from "hono";
import {
  getExecutionStats,
  resetExecutionStats,
  retryFailedTrade,
  getTradingMode,
  isLiveTrading,
  executeDecision,
  executePipeline,
} from "../services/trade-executor.ts";
import {
  getRecoveryReport,
  getPendingRetries,
  getDeadLetterQueue,
  getStuckTrades,
  getFailedTrade,
  detectStuckTrades,
} from "../services/trade-recovery.ts";
import { getAgentConfigs } from "../agents/orchestrator.ts";
import { parseQueryInt } from "../lib/query-params.ts";

export const executionRoutes = new Hono();

// ---------------------------------------------------------------------------
// Execution Pipeline Status
// ---------------------------------------------------------------------------

/**
 * GET /
 * Overview of the execution engine status.
 */
executionRoutes.get("/", (c) => {
  const stats = getExecutionStats();
  const mode = getTradingMode();
  const isLive = isLiveTrading();
  const recovery = getRecoveryReport();

  return c.json({
    engine: {
      mode,
      isLive,
      status: "operational",
      description: isLive
        ? "LIVE MODE — Executing real Jupiter swaps on Solana"
        : "PAPER MODE — Simulating trades with current market prices",
    },
    stats: {
      totalExecutions: stats.totalExecutions,
      successRate: stats.totalExecutions > 0
        ? `${((stats.successfulExecutions / stats.totalExecutions) * 100).toFixed(1)}%`
        : "N/A",
      liveExecutions: stats.liveExecutions,
      paperExecutions: stats.paperExecutions,
      totalVolumeUSDC: `$${stats.totalVolumeUSDC.toLocaleString()}`,
      averageExecutionMs: `${stats.averageExecutionMs}ms`,
      lastExecutionAt: stats.lastExecutionAt,
    },
    recovery: {
      pendingRetries: recovery.pendingRetry,
      deadLettered: recovery.deadLettered,
      stuck: recovery.stuck,
      recovered: recovery.recovered,
    },
  });
});

// ---------------------------------------------------------------------------
// Detailed Execution Stats
// ---------------------------------------------------------------------------

/**
 * GET /stats
 * Full execution statistics with per-agent and per-symbol breakdowns.
 */
executionRoutes.get("/stats", (c) => {
  return c.json(getExecutionStats());
});

/**
 * GET /stats/agents
 * Per-agent execution breakdown.
 */
executionRoutes.get("/stats/agents", (c) => {
  const stats = getExecutionStats();
  const agents = getAgentConfigs();

  const agentStats = agents.map((agent) => {
    const exec = stats.executionsByAgent[agent.agentId] ?? { total: 0, success: 0, failed: 0 };
    return {
      agentId: agent.agentId,
      name: agent.name,
      model: agent.model,
      executions: exec,
      successRate: exec.total > 0
        ? `${((exec.success / exec.total) * 100).toFixed(1)}%`
        : "N/A",
    };
  });

  return c.json({ agents: agentStats });
});

/**
 * GET /stats/symbols
 * Per-symbol execution breakdown.
 */
executionRoutes.get("/stats/symbols", (c) => {
  const stats = getExecutionStats();
  return c.json({
    symbols: Object.entries(stats.executionsBySymbol)
      .map(([symbol, data]) => ({ symbol, ...data }))
      .sort((a, b) => b.volumeUSDC - a.volumeUSDC),
  });
});

// ---------------------------------------------------------------------------
// Recent Executions
// ---------------------------------------------------------------------------

/**
 * GET /recent
 * Last N execution results.
 */
executionRoutes.get("/recent", (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20"), 100);
  const stats = getExecutionStats();
  return c.json({
    executions: stats.recentExecutions.slice(0, limit),
    count: Math.min(limit, stats.recentExecutions.length),
  });
});

// ---------------------------------------------------------------------------
// Recovery & Retry
// ---------------------------------------------------------------------------

/**
 * GET /recovery
 * Recovery report for failed trades.
 */
executionRoutes.get("/recovery", (c) => {
  return c.json(getRecoveryReport());
});

/**
 * GET /recovery/pending
 * Trades awaiting retry.
 */
executionRoutes.get("/recovery/pending", (c) => {
  return c.json({ pending: getPendingRetries() });
});

/**
 * GET /recovery/dead-letter
 * Permanently failed trades.
 */
executionRoutes.get("/recovery/dead-letter", (c) => {
  return c.json({ deadLetter: getDeadLetterQueue() });
});

/**
 * GET /recovery/stuck
 * Trades submitted but not confirmed on-chain.
 */
executionRoutes.get("/recovery/stuck", (c) => {
  return c.json({ stuck: getStuckTrades() });
});

/**
 * GET /recovery/:recoveryId
 * Get details of a specific failed trade.
 */
executionRoutes.get("/recovery/:recoveryId", (c) => {
  const trade = getFailedTrade(c.req.param("recoveryId"));
  if (!trade) {
    return c.json({ error: "Recovery entry not found" }, 404);
  }
  return c.json(trade);
});

/**
 * POST /recovery/:recoveryId/retry
 * Retry a failed trade (admin only — requires X-Admin-Password).
 */
executionRoutes.post("/recovery/:recoveryId/retry", async (c) => {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminPassword && c.req.header("X-Admin-Password") !== adminPassword) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const recoveryId = c.req.param("recoveryId");
  const trade = getFailedTrade(recoveryId);
  if (!trade) {
    return c.json({ error: "Recovery entry not found" }, 404);
  }

  // Find agent name
  const agents = getAgentConfigs();
  const agentName = agents.find((a) => a.agentId === trade.agentId)?.name ?? trade.agentId;

  const result = await retryFailedTrade(recoveryId, agentName);
  if (!result) {
    return c.json({ error: "Trade not eligible for retry" }, 400);
  }

  return c.json({
    retried: true,
    result,
  });
});

/**
 * POST /recovery/scan-stuck
 * Scan for stuck trades (admin only).
 */
executionRoutes.post("/recovery/scan-stuck", (c) => {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminPassword && c.req.header("X-Admin-Password") !== adminPassword) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const stuck = detectStuckTrades();
  return c.json({
    detected: stuck.length,
    trades: stuck,
  });
});

// ---------------------------------------------------------------------------
// Mode & Configuration
// ---------------------------------------------------------------------------

/**
 * GET /mode
 * Current trading mode.
 */
executionRoutes.get("/mode", (c) => {
  return c.json({
    mode: getTradingMode(),
    isLive: isLiveTrading(),
    env: process.env.TRADING_MODE ?? "paper (default)",
    warning: isLiveTrading()
      ? "LIVE MODE ACTIVE — Real money trades will be executed on Solana"
      : "Paper mode — Trades are simulated, no real transactions",
  });
});

// ---------------------------------------------------------------------------
// Admin Actions
// ---------------------------------------------------------------------------

/**
 * POST /reset-stats
 * Reset execution statistics (admin only).
 */
executionRoutes.post("/reset-stats", (c) => {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminPassword && c.req.header("X-Admin-Password") !== adminPassword) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  resetExecutionStats();
  return c.json({ reset: true, message: "Execution statistics have been reset" });
});
