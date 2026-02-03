/**
 * Token Flow Analyzer API Routes
 *
 * Exposes endpoints for analyzing token flows between AI agents
 * and the market — flow summaries, agent profiles, heatmaps,
 * and market impact estimates.
 */

import { Hono } from "hono";
import {
  getFlowSummary,
  getAgentFlowProfile,
  getAllFlowSummaries,
  getFlowHeatmap,
  getFlowTimeline,
  getMarketImpact,
  getTokenConviction,
} from "../services/token-flow-analyzer.ts";

export const tokenFlowRoutes = new Hono();

/**
 * GET /summary/:symbol — Flow analysis for a specific token.
 */
tokenFlowRoutes.get("/summary/:symbol", (c) => {
  const symbol = c.req.param("symbol");
  const summary = getFlowSummary(symbol);
  if (!summary) {
    return c.json(
      { error: "no_data", message: `No flow data for symbol ${symbol}` },
      404,
    );
  }
  return c.json(summary);
});

/**
 * GET /summaries — Flow analysis for all tokens.
 */
tokenFlowRoutes.get("/summaries", (c) => {
  const summaries = getAllFlowSummaries();
  return c.json({ summaries, count: summaries.length });
});

/**
 * GET /agent/:agentId — Flow profile for a specific agent.
 */
tokenFlowRoutes.get("/agent/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const profile = getAgentFlowProfile(agentId);
  if (!profile) {
    return c.json(
      { error: "no_data", message: `No flow data for agent ${agentId}` },
      404,
    );
  }
  return c.json(profile);
});

/**
 * GET /heatmap — NxN grid: agent × symbol with flow intensity.
 */
tokenFlowRoutes.get("/heatmap", (c) => {
  const heatmap = getFlowHeatmap();
  return c.json(heatmap);
});

/**
 * GET /timeline — Chronological flow events.
 */
tokenFlowRoutes.get("/timeline", (c) => {
  const limit = parseInt(c.req.query("limit") ?? "100", 10);
  const agentId = c.req.query("agent") ?? undefined;
  const symbol = c.req.query("symbol") ?? undefined;
  const events = getFlowTimeline({ limit, agentId, symbol });
  return c.json({ events, count: events.length });
});

/**
 * GET /impact — Market impact estimates per agent.
 */
tokenFlowRoutes.get("/impact", (c) => {
  const impact = getMarketImpact();
  return c.json(impact);
});

/**
 * GET /conviction — Token conviction scores per agent.
 */
tokenFlowRoutes.get("/conviction", (c) => {
  const conviction = getTokenConviction();
  return c.json(conviction);
});
