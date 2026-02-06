/**
 * Portfolio Snapshot Routes
 *
 * API endpoints for accessing historical portfolio snapshots,
 * equity curves, drawdown analysis, and agent performance timelines.
 */

import { Hono } from "hono";
import {
  getAgentTimeline,
  compareAgentTimelines,
  takeSnapshot,
  getSnapshotMetrics,
} from "../services/portfolio-snapshots.ts";
import { errorMessage } from "../lib/errors.ts";

const app = new Hono();

/**
 * GET /api/v1/snapshots/:agentId/timeline
 * Get full performance timeline for an agent.
 * Query params: limit, fromDate, toDate
 */
app.get("/:agentId/timeline", async (c) => {
  const agentId = c.req.param("agentId");
  const limit = parseInt(c.req.query("limit") ?? "200");
  const fromDate = c.req.query("fromDate") ?? undefined;
  const toDate = c.req.query("toDate") ?? undefined;

  try {
    const timeline = await getAgentTimeline(agentId, { limit, fromDate, toDate });
    return c.json(timeline);
  } catch (err) {
    return c.json(
      { error: errorMessage(err) },
      500,
    );
  }
});

/**
 * GET /api/v1/snapshots/:agentId/equity-curve
 * Get just the equity curve data (lightweight).
 */
app.get("/:agentId/equity-curve", async (c) => {
  const agentId = c.req.param("agentId");
  const limit = parseInt(c.req.query("limit") ?? "500");

  try {
    const timeline = await getAgentTimeline(agentId, { limit });
    return c.json({
      agentId,
      points: timeline.equityCurve,
      summary: {
        startValue: timeline.summary.startValue,
        endValue: timeline.summary.endValue,
        totalReturnPercent: timeline.summary.totalReturnPercent,
        sharpeRatio: timeline.summary.sharpeRatio,
      },
    });
  } catch (err) {
    return c.json(
      { error: errorMessage(err) },
      500,
    );
  }
});

/**
 * GET /api/v1/snapshots/:agentId/drawdown
 * Get drawdown analysis for an agent.
 */
app.get("/:agentId/drawdown", async (c) => {
  const agentId = c.req.param("agentId");

  try {
    const timeline = await getAgentTimeline(agentId);
    return c.json({ agentId, drawdown: timeline.drawdown });
  } catch (err) {
    return c.json(
      { error: errorMessage(err) },
      500,
    );
  }
});

/**
 * GET /api/v1/snapshots/compare
 * Compare timelines across multiple agents.
 * Query: agents=claude-value-investor,gpt-momentum-trader,grok-contrarian
 */
app.get("/compare", async (c) => {
  const agentsParam = c.req.query("agents") ?? "";
  const agentIds = agentsParam.split(",").filter(Boolean);

  if (agentIds.length === 0) {
    return c.json({ error: "agents parameter required (comma-separated)" }, 400);
  }

  try {
    const comparison = await compareAgentTimelines(agentIds);
    return c.json(comparison);
  } catch (err) {
    return c.json(
      { error: errorMessage(err) },
      500,
    );
  }
});

/**
 * POST /api/v1/snapshots/:agentId/manual
 * Take a manual snapshot (admin/debug use).
 * Body: { marketPrices: { "AAPLx": 178.50, ... } }
 */
app.post("/:agentId/manual", async (c) => {
  const agentId = c.req.param("agentId");

  try {
    const body = await c.req.json<{ marketPrices?: Record<string, number> }>();
    const marketPrices = new Map<string, number>(
      Object.entries(body.marketPrices ?? {}),
    );

    const snapshot = await takeSnapshot(agentId, null, "manual", marketPrices);
    return c.json(snapshot);
  } catch (err) {
    return c.json(
      { error: errorMessage(err) },
      500,
    );
  }
});

/**
 * GET /api/v1/snapshots/metrics
 * Get snapshot service metrics.
 */
app.get("/metrics", async (c) => {
  return c.json(getSnapshotMetrics());
});

export const snapshotRoutes = app;
