/**
 * Lifecycle & Health Routes
 *
 * Deep health checks and readiness probes for production monitoring.
 *
 * Endpoints:
 * - GET  /deep-health   — Comprehensive dependency health check
 * - GET  /readiness      — K8s-style readiness probe
 * - GET  /metrics        — Lifecycle manager metrics
 */

import { Hono } from "hono";
import {
  deepHealthCheck,
  readinessCheck,
  getLifecycleMetrics,
} from "../services/lifecycle.ts";

export const lifecycleRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET /deep-health — Comprehensive health check
// ---------------------------------------------------------------------------

lifecycleRoutes.get("/deep-health", async (c) => {
  const result = await deepHealthCheck();
  const statusCode = result.status === "healthy" ? 200 : result.status === "degraded" ? 200 : 503;
  return c.json(result, statusCode);
});

// ---------------------------------------------------------------------------
// GET /readiness — Readiness probe
// ---------------------------------------------------------------------------

lifecycleRoutes.get("/readiness", async (c) => {
  const result = await readinessCheck();
  return c.json(result, result.ready ? 200 : 503);
});

// ---------------------------------------------------------------------------
// GET /metrics — Lifecycle metrics
// ---------------------------------------------------------------------------

lifecycleRoutes.get("/metrics", (c) => {
  return c.json(getLifecycleMetrics());
});
