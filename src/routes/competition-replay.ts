/**
 * Competition Replay API Routes
 *
 * Exposes endpoints for replaying competition sessions — showing
 * decision trees, key turning points, and auto-generated narratives.
 */

import { Hono } from "hono";
import {
  generateNarrative,
  getDecisionTree,
  getKeyMoments,
  getReplayTimeline,
  getCompetitionSummary,
  getAgentArc,
} from "../services/competition-replay.ts";

export const competitionReplayRoutes = new Hono();

/**
 * GET /narrative — Auto-generated competition narrative with chapters.
 */
competitionReplayRoutes.get("/narrative", (c) => {
  const narrative = generateNarrative();
  return c.json(narrative);
});

/**
 * GET /decision-tree/:agentId — Hierarchical decision tree for an agent.
 */
competitionReplayRoutes.get("/decision-tree/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const tree = getDecisionTree(agentId);
  return c.json(tree);
});

/**
 * GET /moments — Most impactful moments in the competition.
 */
competitionReplayRoutes.get("/moments", (c) => {
  const limit = parseInt(c.req.query("limit") ?? "10", 10);
  const moments = getKeyMoments(limit);
  return c.json({ moments, count: moments.length });
});

/**
 * GET /timeline — Chronological event replay with optional filtering.
 */
competitionReplayRoutes.get("/timeline", (c) => {
  const startTime = c.req.query("start") ?? undefined;
  const endTime = c.req.query("end") ?? undefined;
  const timeline = getReplayTimeline(startTime, endTime);
  const limit = parseInt(c.req.query("limit") ?? "100", 10);
  const limited = timeline.slice(0, limit);
  return c.json({ events: limited, count: limited.length, total: timeline.length });
});

/**
 * GET /summary — Current competition state and standings.
 */
competitionReplayRoutes.get("/summary", (c) => {
  const summary = getCompetitionSummary();
  return c.json(summary);
});

/**
 * GET /arc/:agentId — Narrative arc for a single agent.
 */
competitionReplayRoutes.get("/arc/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const arc = getAgentArc(agentId);
  return c.json(arc);
});
