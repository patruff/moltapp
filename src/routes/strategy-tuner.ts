/**
 * Strategy Tuner API Routes
 *
 * Manage and inspect agent strategy adjustments.
 */

import { Hono } from "hono";
import {
  getStrategyTunerStatus,
  getActiveAdjustment,
  getAgentAdjustmentHistory,
  calculateAdjustments,
  forceRecalculate,
  resetAllAdjustments,
  resetAgentAdjustments,
  updateConfig,
  setEnabled,
  getTuningConfig,
  type AgentPerformanceSnapshot,
} from "../services/strategy-tuner.ts";

const app = new Hono();

/** GET /status — full strategy tuner status */
app.get("/status", (c) => {
  return c.json(getStrategyTunerStatus());
});

/** GET /config — current tuning config */
app.get("/config", (c) => {
  return c.json(getTuningConfig());
});

/** PUT /config — update tuning config */
app.put("/config", async (c) => {
  const body = await c.req.json();
  const updated = updateConfig(body);
  return c.json(updated);
});

/** POST /enable — enable the strategy tuner */
app.post("/enable", (c) => {
  setEnabled(true);
  return c.json({ enabled: true });
});

/** POST /disable — disable the strategy tuner */
app.post("/disable", (c) => {
  setEnabled(false);
  return c.json({ enabled: false });
});

/** GET /agent/:agentId — get active adjustment for an agent */
app.get("/agent/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const adjustment = getActiveAdjustment(agentId);
  if (!adjustment) {
    return c.json({ agentId, adjustment: null, message: "No active adjustments" });
  }
  return c.json({ agentId, adjustment });
});

/** GET /agent/:agentId/history — get adjustment history for an agent */
app.get("/agent/:agentId/history", (c) => {
  const agentId = c.req.param("agentId");
  const limit = parseInt(c.req.query("limit") ?? "20", 10);
  const history = getAgentAdjustmentHistory(agentId, limit);
  return c.json({ agentId, history, count: history.length });
});

/** POST /agent/:agentId/recalculate — force recalculation */
app.post("/agent/:agentId/recalculate", async (c) => {
  const agentId = c.req.param("agentId");
  const body = (await c.req.json()) as AgentPerformanceSnapshot;

  if (!body.agentId) {
    body.agentId = agentId;
  }

  const adjustment = forceRecalculate(body);
  return c.json({ agentId, adjustment });
});

/** POST /agent/:agentId/reset — reset adjustments for an agent */
app.post("/agent/:agentId/reset", (c) => {
  const agentId = c.req.param("agentId");
  resetAgentAdjustments(agentId);
  return c.json({ agentId, message: "Adjustments reset" });
});

/** POST /reset-all — reset all adjustments */
app.post("/reset-all", (c) => {
  resetAllAdjustments();
  return c.json({ message: "All adjustments reset" });
});

/** POST /simulate — simulate adjustments without applying */
app.post("/simulate", async (c) => {
  const body = (await c.req.json()) as AgentPerformanceSnapshot;
  const adjustment = calculateAdjustments(body);
  return c.json({
    simulated: true,
    adjustment,
    note: "These adjustments are NOT applied — use /agent/:agentId/recalculate to apply",
  });
});

export const strategyTunerRoutes = app;
