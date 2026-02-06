/**
 * Competition Scoring Routes
 *
 * API endpoints for the multi-factor competition scoring system.
 * Provides leaderboard, per-round scores, head-to-head comparisons,
 * and historical score tracking.
 */

import { Hono } from "hono";
import {
  getLeaderboard,
  getHeadToHead,
  getAgentScoreHistory,
  getCompetitionMetrics,
} from "../services/competition-scoring.ts";
import { errorMessage } from "../lib/errors.ts";

const app = new Hono();

/**
 * GET /api/v1/scoring/leaderboard
 * Get the current competition leaderboard ranked by cumulative score.
 */
app.get("/leaderboard", (c) => {
  const leaderboard = getLeaderboard();
  return c.json({
    leaderboard,
    updatedAt: new Date().toISOString(),
  });
});

/**
 * GET /api/v1/scoring/:agentId/history
 * Get score history for a specific agent.
 * Query: limit (default 100)
 */
app.get("/:agentId/history", async (c) => {
  const agentId = c.req.param("agentId");
  const limit = parseInt(c.req.query("limit") ?? "100");

  try {
    const history = await getAgentScoreHistory(agentId, limit);
    return c.json({ agentId, scores: history });
  } catch (err) {
    return c.json(
      { error: errorMessage(err) },
      500,
    );
  }
});

/**
 * GET /api/v1/scoring/head-to-head/:agentA/:agentB
 * Get head-to-head record between two agents.
 */
app.get("/head-to-head/:agentA/:agentB", (c) => {
  const agentA = c.req.param("agentA");
  const agentB = c.req.param("agentB");

  const record = getHeadToHead(agentA, agentB);
  if (!record) {
    return c.json(
      { error: "No head-to-head data — both agents need scored rounds" },
      404,
    );
  }

  return c.json(record);
});

/**
 * GET /api/v1/scoring/metrics
 * Get competition scoring metrics.
 */
app.get("/metrics", (c) => {
  return c.json(getCompetitionMetrics());
});

export const scoringRoutes = app;
