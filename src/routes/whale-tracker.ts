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

// ---------------------------------------------------------------------------
// Route Display & Default Constants
// ---------------------------------------------------------------------------

/**
 * Default hours window for whale alert queries (24 hours).
 * Used in the dashboard and /alerts endpoints as the default lookback period.
 * Range: 1–720 hours (1 hour to 30 days).
 */
const DEFAULT_ALERT_HOURS = 24;

/**
 * Default hours window for smart money flow analysis (168 hours = 7 days).
 * Flow analysis needs a longer window than alerts to detect capital movement trends.
 * Used in /flow and /flow/sectors endpoints.
 * Range: 1–720 hours.
 */
const DEFAULT_FLOW_HOURS = 168;

/**
 * Minimum confidence threshold for high-conviction trade detection (75%).
 * Trades at or above this confidence level are classified as "high conviction".
 * Used in both the dashboard summary (hardcoded call) and the /conviction endpoint default.
 * Range: 50–100 (parseQueryInt enforces bounds).
 */
const DEFAULT_MIN_CONVICTION_CONFIDENCE = 75;

/**
 * Number of top alerts shown in the dashboard summary response.
 * Limits the dashboard to the most critical alerts rather than flooding the response.
 * Full alert list available via GET /whales/alerts.
 * Example: 20 alerts exist → dashboard shows top 5 most recent/severe.
 */
const DASHBOARD_TOP_ALERTS_LIMIT = 5;

/**
 * Number of top conviction trades shown in the dashboard summary response.
 * Limits dashboard to highest-confidence trades rather than the full conviction list.
 * Full list available via GET /whales/conviction.
 * Example: 12 high-conviction trades → dashboard shows top 5.
 */
const DASHBOARD_TOP_CONVICTION_LIMIT = 5;

export const whaleRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET /whales — Full whale tracker dashboard
// ---------------------------------------------------------------------------

whaleRoutes.get("/", async (c) => {
  try {
    const hours = parseQueryInt(c.req.query("hours"), DEFAULT_ALERT_HOURS, 1, 720);

    const [alerts, conviction, heatmap] = await Promise.all([
      getWhaleAlerts(hours),
      getConvictionTracker(DEFAULT_MIN_CONVICTION_CONFIDENCE),
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
      topAlerts: alerts.alerts.slice(0, DASHBOARD_TOP_ALERTS_LIMIT),
      topConvictionTrades: conviction.highConvictionTrades.slice(0, DASHBOARD_TOP_CONVICTION_LIMIT),
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
    const hours = parseQueryInt(c.req.query("hours"), DEFAULT_ALERT_HOURS, 1, 720);

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
    const minConfidence = parseQueryInt(c.req.query("min_confidence"), DEFAULT_MIN_CONVICTION_CONFIDENCE, 50, 100);

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
    const hours = parseQueryInt(c.req.query("hours"), DEFAULT_FLOW_HOURS, 1, 720);

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
    const hours = parseQueryInt(c.req.query("hours"), DEFAULT_FLOW_HOURS, 1, 720);

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
