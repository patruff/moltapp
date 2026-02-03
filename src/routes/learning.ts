/**
 * Agent Learning API Routes
 *
 * Endpoints for the agent learning feedback loop, calibration,
 * pattern recognition, and adaptive risk parameters.
 */

import { Hono } from "hono";
import {
  recordTradeOutcome,
  analyzeRoundOutcomes,
  discoverPatterns,
  getCalibration,
  calculateAdaptiveRisk,
  generateLearningPrompt,
  getAgentLearningContext,
  getCrossAgentInsights,
  getLearningMetrics,
  resetAgentLearning,
  type TradeOutcome,
} from "../services/agent-learning.ts";

export const learningRoutes = new Hono();

/** GET / — get overall learning metrics */
learningRoutes.get("/", (c) => {
  return c.json(getLearningMetrics());
});

/** GET /agent/:agentId — get full learning context for an agent */
learningRoutes.get("/agent/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  return c.json(getAgentLearningContext(agentId));
});

/** GET /agent/:agentId/calibration — get calibration data */
learningRoutes.get("/agent/:agentId/calibration", (c) => {
  const agentId = c.req.param("agentId");
  return c.json(getCalibration(agentId));
});

/** GET /agent/:agentId/patterns — get discovered patterns */
learningRoutes.get("/agent/:agentId/patterns", (c) => {
  const agentId = c.req.param("agentId");
  return c.json({ agentId, patterns: discoverPatterns(agentId) });
});

/** GET /agent/:agentId/risk — get adaptive risk parameters */
learningRoutes.get("/agent/:agentId/risk", (c) => {
  const agentId = c.req.param("agentId");
  return c.json(calculateAdaptiveRisk(agentId));
});

/** GET /agent/:agentId/prompt — get generated learning prompt section */
learningRoutes.get("/agent/:agentId/prompt", (c) => {
  const agentId = c.req.param("agentId");
  const prompt = generateLearningPrompt(agentId);
  return c.json({ agentId, prompt, hasLearnings: prompt.length > 0 });
});

/** GET /agent/:agentId/cross-insights — get cross-agent insights */
learningRoutes.get("/agent/:agentId/cross-insights", (c) => {
  const agentId = c.req.param("agentId");
  const insights = getCrossAgentInsights(agentId);
  return c.json({ agentId, insights, hasInsights: insights.length > 0 });
});

/** POST /outcome — record a single trade outcome */
learningRoutes.post("/outcome", async (c) => {
  const body = (await c.req.json()) as TradeOutcome;
  recordTradeOutcome(body);
  return c.json({ status: "recorded", agentId: body.agentId, symbol: body.symbol });
});

/** POST /analyze-round — analyze outcomes from a completed round */
learningRoutes.post("/analyze-round", async (c) => {
  const body = (await c.req.json()) as {
    roundId: string;
    decisions: Array<{
      agentId: string;
      symbol: string;
      action: "buy" | "sell" | "hold";
      confidence: number;
      priceAtDecision: number;
      reasoning: string;
      tradedAt: string;
    }>;
    currentPrices: Record<string, number>;
  };

  const outcomes = analyzeRoundOutcomes(body.roundId, body.decisions, body.currentPrices);
  return c.json({ roundId: body.roundId, outcomes, count: outcomes.length });
});

/** DELETE /agent/:agentId — reset learning for an agent */
learningRoutes.delete("/agent/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  resetAgentLearning(agentId);
  return c.json({ status: "reset", agentId });
});
