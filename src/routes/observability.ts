/**
 * Observability Routes
 *
 * Endpoints for metrics, health gates, database seeding, and Prometheus scraping.
 * Aggregates all platform telemetry into accessible API endpoints.
 */

import { Hono } from "hono";
import {
  collectAllMetrics,
  exportPrometheusMetrics,
  getMetricSnapshots,
  exportCloudWatchMetrics,
  takeMetricSnapshot,
} from "../services/observability.ts";
import {
  runPreRoundGate,
  getGateMetrics,
  resetGateMetrics,
  type GateMode,
} from "../services/pre-round-gate.ts";
import {
  seedDatabase,
  checkSeedStatus,
  getSeedData,
} from "../services/db-seeder.ts";
import {
  getJupiterHardenedMetrics,
  getJupiterHardenedConfig,
  configureJupiterHardened,
  resetJupiterHardenedMetrics,
} from "../services/jupiter-hardened.ts";

const observabilityRoutes = new Hono();

// ---------------------------------------------------------------------------
// Full Metrics (JSON)
// ---------------------------------------------------------------------------

/**
 * GET /metrics
 * Returns all platform metrics as structured JSON.
 * Used by dashboards and monitoring tools.
 */
observabilityRoutes.get("/metrics", (c) => {
  const metrics = collectAllMetrics();
  return c.json(metrics);
});

/**
 * GET /metrics/prometheus
 * Returns metrics in Prometheus text exposition format.
 * Use this endpoint as the scrape target for Prometheus.
 */
observabilityRoutes.get("/metrics/prometheus", (c) => {
  const promText = exportPrometheusMetrics();
  return c.text(promText, 200, {
    "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
  });
});

/**
 * GET /metrics/cloudwatch
 * Returns metrics formatted for AWS CloudWatch PutMetricData.
 */
observabilityRoutes.get("/metrics/cloudwatch", (c) => {
  const cwMetrics = exportCloudWatchMetrics();
  return c.json({
    namespace: "MoltApp/Trading",
    metrics: cwMetrics,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /metrics/timeseries?limit=60
 * Returns metric snapshots for time-series visualization.
 */
observabilityRoutes.get("/metrics/timeseries", (c) => {
  const limit = parseInt(c.req.query("limit") ?? "60", 10);
  const snapshots = getMetricSnapshots(Math.min(limit, 360));
  return c.json({
    count: snapshots.length,
    snapshots,
  });
});

/**
 * POST /metrics/snapshot
 * Manually trigger a metric snapshot.
 */
observabilityRoutes.post("/metrics/snapshot", (c) => {
  takeMetricSnapshot();
  return c.json({ ok: true, message: "Metric snapshot taken" });
});

// ---------------------------------------------------------------------------
// Pre-Round Gate
// ---------------------------------------------------------------------------

/**
 * GET /gate/status
 * Run the pre-round health gate and return results.
 * Query param: mode=strict|relaxed (optional)
 */
observabilityRoutes.get("/gate/status", async (c) => {
  const modeParam = c.req.query("mode") as GateMode | undefined;
  const result = await runPreRoundGate(
    modeParam === "strict" || modeParam === "relaxed" ? modeParam : undefined,
  );
  return c.json(result);
});

/**
 * GET /gate/metrics
 * Returns pre-round gate metrics.
 */
observabilityRoutes.get("/gate/metrics", (c) => {
  return c.json(getGateMetrics());
});

/**
 * POST /gate/reset
 * Reset gate metrics (admin use).
 */
observabilityRoutes.post("/gate/reset", (c) => {
  resetGateMetrics();
  return c.json({ ok: true, message: "Gate metrics reset" });
});

// ---------------------------------------------------------------------------
// Database Seeder
// ---------------------------------------------------------------------------

/**
 * POST /seed
 * Run the database seeder. Idempotent — safe to call multiple times.
 */
observabilityRoutes.post("/seed", async (c) => {
  const result = await seedDatabase();
  return c.json(result, result.success ? 200 : 500);
});

/**
 * GET /seed/status
 * Check what seed records exist and what's missing.
 */
observabilityRoutes.get("/seed/status", async (c) => {
  const status = await checkSeedStatus();
  return c.json(status);
});

/**
 * GET /seed/data
 * Inspect the seed data that would be created (no DB access needed).
 */
observabilityRoutes.get("/seed/data", (c) => {
  return c.json(getSeedData());
});

// ---------------------------------------------------------------------------
// Jupiter Hardened
// ---------------------------------------------------------------------------

/**
 * GET /jupiter/metrics
 * Returns Jupiter hardened trade pipeline metrics.
 */
observabilityRoutes.get("/jupiter/metrics", (c) => {
  return c.json(getJupiterHardenedMetrics());
});

/**
 * GET /jupiter/config
 * Returns current Jupiter hardened configuration.
 */
observabilityRoutes.get("/jupiter/config", (c) => {
  return c.json(getJupiterHardenedConfig());
});

/**
 * PUT /jupiter/config
 * Update Jupiter hardened configuration.
 * Body: partial JupiterHardenedConfig
 */
observabilityRoutes.put("/jupiter/config", async (c) => {
  const body = await c.req.json();
  const updated = configureJupiterHardened(body);
  return c.json(updated);
});

/**
 * POST /jupiter/metrics/reset
 * Reset Jupiter hardened metrics (admin use).
 */
observabilityRoutes.post("/jupiter/metrics/reset", (c) => {
  resetJupiterHardenedMetrics();
  return c.json({ ok: true, message: "Jupiter hardened metrics reset" });
});

export { observabilityRoutes };
