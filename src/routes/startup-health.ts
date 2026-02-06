/**
 * Startup Health & Dependency Validation Routes
 *
 * Provides deep health check endpoints that validate all external dependencies
 * (database, Solana RPC, Jupiter, LLM APIs). More comprehensive than /health.
 */

import { Hono } from "hono";
import {
  validateStartupHealth,
  getLastHealthReport,
  startHealthTicker,
  stopHealthTicker,
} from "../services/startup-validator.ts";
import { errorMessage } from "../lib/errors.ts";

const app = new Hono();

/**
 * GET /api/v1/health-deep
 * Run a full deep health check of all dependencies.
 * This is more expensive than /health — takes 5-15 seconds.
 */
app.get("/", async (c) => {
  try {
    const report = await validateStartupHealth();

    const statusCode = report.overall === "unhealthy" ? 503 : 200;
    return c.json(report, statusCode);
  } catch (err) {
    return c.json(
      {
        overall: "unhealthy",
        ready: false,
        error: errorMessage(err),
      },
      503,
    );
  }
});

/**
 * GET /api/v1/health-deep/cached
 * Get the most recent health report without re-running checks.
 * Returns cached data from background ticker or last manual check.
 */
app.get("/cached", (c) => {
  const report = getLastHealthReport();
  if (!report) {
    return c.json(
      { error: "No cached health report. Run GET /api/v1/health-deep first." },
      404,
    );
  }
  return c.json(report);
});

/**
 * GET /api/v1/health-deep/readiness
 * Simple readiness probe for load balancers / k8s.
 * Returns 200 if ready, 503 if not.
 */
app.get("/readiness", (c) => {
  const report = getLastHealthReport();
  if (report && report.ready) {
    return c.json({ ready: true, overall: report.overall }, 200);
  }
  return c.json({ ready: false, overall: report?.overall ?? "unknown" }, 503);
});

/**
 * POST /api/v1/health-deep/ticker/start
 * Start the background health ticker.
 * Body: { intervalMs?: number } (default 300000 = 5 minutes)
 */
app.post("/ticker/start", async (c) => {
  try {
    const body = await c.req.json<{ intervalMs?: number }>().catch(() => ({ intervalMs: undefined }));
    const intervalMs = body.intervalMs ?? 300_000;
    startHealthTicker(intervalMs);
    return c.json({ started: true, intervalMs });
  } catch (err) {
    return c.json(
      { error: errorMessage(err) },
      500,
    );
  }
});

/**
 * POST /api/v1/health-deep/ticker/stop
 * Stop the background health ticker.
 */
app.post("/ticker/stop", (c) => {
  stopHealthTicker();
  return c.json({ stopped: true });
});

/**
 * GET /api/v1/health-deep/environment
 * Get environment configuration summary (no secrets).
 */
app.get("/environment", (c) => {
  const report = getLastHealthReport();
  if (report) {
    return c.json(report.environment);
  }

  // Basic env info without running full check
  return c.json({
    nodeEnv: process.env.NODE_ENV ?? "development",
    tradingMode: process.env.TRADING_MODE ?? "paper",
    hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
    hasOpenAIKey: !!process.env.OPENAI_API_KEY,
    hasXAIKey: !!process.env.XAI_API_KEY,
    hasSolanaRpc: !!process.env.SOLANA_RPC_URL,
    hasHeliusKey: !!process.env.HELIUS_API_KEY,
    hasTurnkeyKeys: !!(process.env.TURNKEY_API_PRIVATE_KEY && process.env.TURNKEY_API_PUBLIC_KEY),
  });
});

export const startupHealthRoutes = app;
