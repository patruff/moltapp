/**
 * Whale Tracker Routes
 *
 * Monitor large AI agent position changes, unusual trading patterns,
 * conviction spikes, cross-agent convergence, and smart money flow.
 *
 * Routes:
 *   GET  /api/v1/whales                          — Whale alert dashboard
 *   GET  /api/v1/whales/alerts                   — Recent whale alerts
 *   GET  /api/v1/whales/conviction               — High-conviction trade tracker
 *   GET  /api/v1/whales/heatmap                  — Position activity heatmap
 *   GET  /api/v1/whales/flow                     — Smart money flow analysis
 *   GET  /api/v1/whales/flow/sectors             — Smart money by sector
 */

import { Hono } from "hono";
import {
  getWhaleAlerts,
  getConvictionTracker,
  getPositionHeatmap,
  getSmartMoneyFlow,
} from "../services/whale-tracker.ts";
import { parseQueryInt } from "../lib/query-params.ts";
import { errorMessage } from "../lib/errors.ts";

export const whaleRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET /whales — Full whale tracker dashboard
// ---------------------------------------------------------------------------

whaleRoutes.get("/", async (c) => {
  try {
    const hours = parseQueryInt(c.req.query("hours"), 24, 1, 720);

    const [alerts, conviction, heatmap] = await Promise.all([
      getWhaleAlerts(hours),
      getConvictionTracker(75),
      getPositionHeatmap(),
    ]);

    return c.json({
      dashboard: {
        period: `${hours}h`,
        activity: alerts.overallActivity,
        alertCount: alerts.alerts.length,
        criticalAlerts: alerts.alertsBySeverity["critical"] ?? 0,
        smartMoneyDirection: alerts.smartMoneyFlow.flowDirection,
        overallConviction: conviction.overallConviction,
        hottestStock: heatmap.hottestCell?.symbol ?? null,
        mostActiveAgent: alerts.mostActiveWhale?.agentName ?? null,
        summary: alerts.summary,
      },
      topAlerts: alerts.alerts.slice(0, 5),
      topConvictionTrades: conviction.highConvictionTrades.slice(0, 5),
      generatedAt: new Date().toISOString(),
      description: "AI Agent Whale Tracker — monitoring large position changes, conviction spikes, and smart money flows.",
    });
  } catch (error) {
    console.error("[WhaleTracker] Dashboard error:", error);
    return c.json(
      {
        error: "whale_error",
        code: "dashboard_failed",
        details: errorMessage(error),
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /whales/alerts — Detailed whale alerts
// ---------------------------------------------------------------------------

whaleRoutes.get("/alerts", async (c) => {
  try {
    const typeFilter = c.req.query("type");
    const severityFilter = c.req.query("severity");
    const hours = parseQueryInt(c.req.query("hours"), 24, 1, 720);

    const activity = await getWhaleAlerts(hours);
    let alerts = activity.alerts;

    // Apply filters
    if (typeFilter) {
      alerts = alerts.filter((a) => a.type === typeFilter);
    }
    if (severityFilter) {
      alerts = alerts.filter((a) => a.severity === severityFilter);
    }

    return c.json({
      alerts,
      total: alerts.length,
      period: `${hours}h`,
      activity: activity.overallActivity,
      alertsByType: activity.alertsByType,
      alertsBySeverity: activity.alertsBySeverity,
      smartMoneyFlow: activity.smartMoneyFlow,
      filters: {
        type: typeFilter ?? "all",
        severity: severityFilter ?? "all",
        hours,
      },
    });
  } catch (error) {
    console.error("[WhaleTracker] Alerts error:", error);
    return c.json(
      {
        error: "whale_error",
        code: "alerts_failed",
        details: errorMessage(error),
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /whales/conviction — High-conviction trade tracker
// ---------------------------------------------------------------------------

whaleRoutes.get("/conviction", async (c) => {
  try {
    const minConfidence = parseQueryInt(c.req.query("min_confidence"), 75, 50, 100);

    const tracker = await getConvictionTracker(minConfidence);

    return c.json({
      conviction: tracker,
      description: `${tracker.highConvictionTrades.length} high-conviction trades (>=${minConfidence}% confidence). Overall platform conviction: ${tracker.overallConviction}%. ${tracker.interpretation}`,
    });
  } catch (error) {
    console.error("[WhaleTracker] Conviction error:", error);
    return c.json(
      {
        error: "whale_error",
        code: "conviction_failed",
        details: errorMessage(error),
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /whales/heatmap — Position activity heatmap
// ---------------------------------------------------------------------------

whaleRoutes.get("/heatmap", async (c) => {
  try {
    const heatmap = await getPositionHeatmap();

    return c.json({
      heatmap,
      description: `Position activity heatmap: ${heatmap.cells.length} active cells across ${heatmap.agents.length} agents and ${heatmap.symbols.length} stocks. Hottest: ${heatmap.hottestCell ? `${heatmap.hottestCell.agentId} on ${heatmap.hottestCell.symbol} (intensity: ${heatmap.hottestCell.intensity})` : "none"}.`,
    });
  } catch (error) {
    console.error("[WhaleTracker] Heatmap error:", error);
    return c.json(
      {
        error: "whale_error",
        code: "heatmap_failed",
        details: errorMessage(error),
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /whales/flow — Smart money flow analysis
// ---------------------------------------------------------------------------

whaleRoutes.get("/flow", async (c) => {
  try {
    const hours = parseQueryInt(c.req.query("hours"), 168, 1, 720);

    const flow = await getSmartMoneyFlow(hours);

    return c.json({
      flow,
      description: flow.narrative,
    });
  } catch (error) {
    console.error("[WhaleTracker] Flow error:", error);
    return c.json(
      {
        error: "whale_error",
        code: "flow_failed",
        details: errorMessage(error),
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /whales/flow/sectors — Smart money by sector
// ---------------------------------------------------------------------------

whaleRoutes.get("/flow/sectors", async (c) => {
  try {
    const hours = parseQueryInt(c.req.query("hours"), 168, 1, 720);

    const flow = await getSmartMoneyFlow(hours);

    return c.json({
      sectorFlows: flow.sectorFlows,
      aggregateFlow: flow.aggregateFlow,
      period: flow.period,
      description: `Sector-level smart money flows over ${flow.period}. Overall: ${flow.aggregateFlow.direction.replace(/_/g, " ").toUpperCase()}.`,
    });
  } catch (error) {
    console.error("[WhaleTracker] Sector flow error:", error);
    return c.json(
      {
        error: "whale_error",
        code: "sector_flow_failed",
        details: errorMessage(error),
      },
      500,
    );
  }
});
