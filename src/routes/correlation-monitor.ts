/**
 * Agent Correlation Monitor API Routes
 *
 * Exposes endpoints for real-time correlation analysis between
 * AI trading agents — herding detection, divergence alerts, and
 * regime analysis.
 */

import { Hono } from "hono";
import {
  getCorrelationMatrix,
  getHerdingAnalysis,
  getDivergenceAlerts,
  getRollingCorrelation,
  getRegimeAnalysis,
  getCorrelationReport,
} from "../services/agent-correlation-monitor.ts";

export const correlationMonitorRoutes = new Hono();

/**
 * GET /matrix — NxN correlation matrix between all agents.
 */
correlationMonitorRoutes.get("/matrix", (c) => {
  const matrix = getCorrelationMatrix();
  return c.json(matrix);
});

/**
 * GET /herding — Herding detection: are agents acting the same?
 */
correlationMonitorRoutes.get("/herding", (c) => {
  const analysis = getHerdingAnalysis();
  return c.json(analysis);
});

/**
 * GET /divergence — Divergence alerts: strong agent disagreements.
 */
correlationMonitorRoutes.get("/divergence", (c) => {
  const limit = parseInt(c.req.query("limit") ?? "20", 10);
  const alerts = getDivergenceAlerts(limit);
  return c.json({ alerts, count: alerts.length });
});

/**
 * GET /rolling/:pair — Rolling correlation for a specific agent pair.
 *
 * pair format: "claude-trader:gpt-momentum"
 */
correlationMonitorRoutes.get("/rolling/:pair", (c) => {
  const pairStr = c.req.param("pair");
  const agents = pairStr.split(":");
  if (agents.length !== 2) {
    return c.json(
      { error: "invalid_pair", message: "Use format agent1:agent2" },
      400,
    );
  }
  const windowSize = parseInt(c.req.query("window") ?? "20", 10);
  const rolling = getRollingCorrelation(
    [agents[0], agents[1]],
    windowSize,
  );
  return c.json(rolling);
});

/**
 * GET /regime — Are agents converging or diverging over time?
 */
correlationMonitorRoutes.get("/regime", (c) => {
  const analysis = getRegimeAnalysis();
  return c.json(analysis);
});

/**
 * GET /report — Full correlation report combining all analyses.
 */
correlationMonitorRoutes.get("/report", (c) => {
  const report = getCorrelationReport();
  return c.json(report);
});
