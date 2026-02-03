/**
 * Infrastructure Status Routes
 *
 * Exposes trading infrastructure status including:
 * - Trading lock status
 * - Circuit breaker configuration and activations
 * - Rate limiter metrics
 * - Search cache metrics
 * - Agent wallet statuses
 * - Solana RPC metrics
 */

import { Hono } from "hono";
import { getLockStatus, forceReleaseLock } from "../services/trading-lock.ts";
import {
  getCircuitBreakerStatus,
  getRecentActivations,
  getCircuitBreakerConfig,
  configureCircuitBreaker,
  resetAgentState,
  type CircuitBreakerConfig,
} from "../services/circuit-breaker.ts";
import { getAllRateLimiterMetrics } from "../services/rate-limiter.ts";
import { getSearchCacheMetrics, invalidateCache } from "../services/search-cache.ts";
import { getRpcMetrics } from "../services/solana-tracker.ts";
import {
  getAllAgentWallets,
  getAllAgentWalletStatuses,
} from "../services/agent-wallets.ts";
import { getTradingInfraStatus } from "../agents/orchestrator.ts";

export const infraRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET /status — Full infrastructure status overview
// ---------------------------------------------------------------------------

infraRoutes.get("/status", async (c) => {
  const infraStatus = getTradingInfraStatus();
  const rateLimiters = getAllRateLimiterMetrics();
  const rpcMetrics = getRpcMetrics();

  return c.json({
    status: "operational",
    timestamp: new Date().toISOString(),
    tradingLock: infraStatus.lock,
    circuitBreaker: {
      config: infraStatus.circuitBreaker.config,
      agentStates: infraStatus.circuitBreaker.agentStates,
      totalActivations: infraStatus.circuitBreaker.totalActivations,
    },
    rateLimiters,
    searchCache: infraStatus.searchCache,
    solanaRpc: rpcMetrics,
  });
});

// ---------------------------------------------------------------------------
// GET /lock — Trading lock status
// ---------------------------------------------------------------------------

infraRoutes.get("/lock", (c) => {
  return c.json(getLockStatus());
});

// ---------------------------------------------------------------------------
// POST /lock/release — Force release trading lock (admin)
// ---------------------------------------------------------------------------

infraRoutes.post("/lock/release", async (c) => {
  const released = await forceReleaseLock();
  return c.json({ released });
});

// ---------------------------------------------------------------------------
// GET /circuit-breaker — Circuit breaker status
// ---------------------------------------------------------------------------

infraRoutes.get("/circuit-breaker", (c) => {
  return c.json(getCircuitBreakerStatus());
});

// ---------------------------------------------------------------------------
// GET /circuit-breaker/config — Get current circuit breaker config
// ---------------------------------------------------------------------------

infraRoutes.get("/circuit-breaker/config", (c) => {
  return c.json(getCircuitBreakerConfig());
});

// ---------------------------------------------------------------------------
// PUT /circuit-breaker/config — Update circuit breaker config
// ---------------------------------------------------------------------------

infraRoutes.put("/circuit-breaker/config", async (c) => {
  const body = await c.req.json<Partial<CircuitBreakerConfig>>();
  const updated = configureCircuitBreaker(body);
  return c.json(updated);
});

// ---------------------------------------------------------------------------
// GET /circuit-breaker/activations — Recent activations
// ---------------------------------------------------------------------------

infraRoutes.get("/circuit-breaker/activations", (c) => {
  const limit = Number(c.req.query("limit") || "50");
  return c.json(getRecentActivations(limit));
});

// ---------------------------------------------------------------------------
// POST /circuit-breaker/reset/:agentId — Reset agent state
// ---------------------------------------------------------------------------

infraRoutes.post("/circuit-breaker/reset/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  resetAgentState(agentId);
  return c.json({ reset: true, agentId });
});

// ---------------------------------------------------------------------------
// GET /rate-limiters — Rate limiter metrics
// ---------------------------------------------------------------------------

infraRoutes.get("/rate-limiters", (c) => {
  return c.json(getAllRateLimiterMetrics());
});

// ---------------------------------------------------------------------------
// GET /search-cache — Search cache metrics
// ---------------------------------------------------------------------------

infraRoutes.get("/search-cache", (c) => {
  return c.json(getSearchCacheMetrics());
});

// ---------------------------------------------------------------------------
// POST /search-cache/invalidate — Invalidate search cache
// ---------------------------------------------------------------------------

infraRoutes.post("/search-cache/invalidate", (c) => {
  invalidateCache();
  return c.json({ invalidated: true });
});

// ---------------------------------------------------------------------------
// GET /wallets — Agent wallet configurations
// ---------------------------------------------------------------------------

infraRoutes.get("/wallets", (c) => {
  return c.json(getAllAgentWallets());
});

// ---------------------------------------------------------------------------
// GET /wallets/status — Live wallet balances
// ---------------------------------------------------------------------------

infraRoutes.get("/wallets/status", async (c) => {
  const statuses = await getAllAgentWalletStatuses();
  return c.json(statuses);
});

// ---------------------------------------------------------------------------
// GET /rpc — Solana RPC metrics
// ---------------------------------------------------------------------------

infraRoutes.get("/rpc", (c) => {
  return c.json(getRpcMetrics());
});
