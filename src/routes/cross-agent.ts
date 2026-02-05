/**
 * Cross-Agent Analysis API Routes
 *
 * Surface insights about agent behavior patterns, herding detection,
 * contrarian signals, and style drift.
 */

import { Hono } from "hono";
import {
  getAnalyzerStatus,
  generateReport,
  computeCorrelationMatrix,
  recordRoundDecisions,
  updateDecisionPnl,
  type AgentDecisionRecord,
} from "../services/cross-agent-analyzer.ts";
import { parseQueryInt } from "../lib/query-params.js";

const app = new Hono();

/** GET /status — analyzer status and recent metrics */
app.get("/status", (c) => {
  return c.json(getAnalyzerStatus());
});

/** GET /report — full cross-agent analysis report */
app.get("/report", (c) => {
  const days = parseQueryInt(c.req.query("days"), 7, 1, 365);
  const report = generateReport(days);
  return c.json(report);
});

/** GET /correlations — pairwise agent correlation matrix */
app.get("/correlations", (c) => {
  const matrix = computeCorrelationMatrix();
  return c.json({ correlations: matrix, computedAt: new Date().toISOString() });
});

/** GET /herding — recent herding alerts */
app.get("/herding", (c) => {
  const days = parseQueryInt(c.req.query("days"), 7, 1, 365);
  const report = generateReport(days);
  return c.json({
    alerts: report.herdingAlerts,
    totalAlerts: report.herdingAlerts.length,
    herdingFrequency: report.stats.herdingFrequency,
  });
});

/** GET /contrarian — recent contrarian signals */
app.get("/contrarian", (c) => {
  const days = parseQueryInt(c.req.query("days"), 7, 1, 365);
  const report = generateReport(days);
  return c.json({
    signals: report.contrarianSignals,
    totalSignals: report.contrarianSignals.length,
    contrarianAccuracy: report.stats.contrarianAccuracy,
  });
});

/** GET /drift — style drift alerts */
app.get("/drift", (c) => {
  const days = parseQueryInt(c.req.query("days"), 7, 1, 365);
  const report = generateReport(days);
  return c.json({
    alerts: report.styleDriftAlerts,
    totalAlerts: report.styleDriftAlerts.length,
  });
});

/** GET /consensus — recent consensus history */
app.get("/consensus", (c) => {
  const report = generateReport(7);
  return c.json({
    history: report.consensusHistory,
    totalRounds: report.totalRoundsAnalyzed,
    unanimousAccuracy: report.stats.unanimousAccuracy,
  });
});

/** GET /insights — AI-generated insights about agent behavior */
app.get("/insights", (c) => {
  const days = parseQueryInt(c.req.query("days"), 7, 1, 365);
  const report = generateReport(days);
  return c.json({
    insights: report.insights,
    stats: report.stats,
    periodDays: days,
  });
});

/** POST /record — record round decisions for analysis */
app.post("/record", async (c) => {
  const body = await c.req.json() as {
    roundId: string;
    decisions: AgentDecisionRecord[];
  };

  if (!body.roundId || !Array.isArray(body.decisions)) {
    return c.json({ error: "roundId and decisions[] required" }, 400);
  }

  recordRoundDecisions(body.roundId, body.decisions);
  return c.json({
    recorded: body.decisions.length,
    roundId: body.roundId,
  });
});

/** POST /pnl — update decision P&L result */
app.post("/pnl", async (c) => {
  const body = await c.req.json() as {
    agentId: string;
    roundId: string;
    pnl: number;
  };

  if (!body.agentId || !body.roundId || typeof body.pnl !== "number") {
    return c.json({ error: "agentId, roundId, and pnl required" }, 400);
  }

  updateDecisionPnl(body.agentId, body.roundId, body.pnl);
  return c.json({ updated: true });
});

export const crossAgentRoutes = app;
