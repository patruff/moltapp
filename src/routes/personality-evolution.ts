/**
 * Personality Evolution API Routes
 *
 * Exposes endpoints for tracking how AI agent personalities evolve
 * over time based on their trading decisions and performance.
 */

import { Hono } from "hono";
import {
  computePersonality,
  getPersonalityTimeline,
  getPersonalityDrift,
  getPersonalityComparison,
  getEvolutionStory,
} from "../services/personality-evolution.ts";

export const personalityEvolutionRoutes = new Hono();

/**
 * GET /current/:agentId — Get current personality snapshot for an agent.
 */
personalityEvolutionRoutes.get("/current/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const snapshot = computePersonality(agentId);
  if (!snapshot) {
    return c.json(
      { error: "no_data", message: `No decision data for agent ${agentId}` },
      404,
    );
  }
  return c.json(snapshot);
});

/**
 * GET /timeline/:agentId — Get personality snapshots over time.
 */
personalityEvolutionRoutes.get("/timeline/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const timeline = getPersonalityTimeline(agentId);
  return c.json({ agentId, snapshots: timeline, count: timeline.length });
});

/**
 * GET /drift/:agentId — How much has the agent's personality changed?
 */
personalityEvolutionRoutes.get("/drift/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const drift = getPersonalityDrift(agentId);
  if (!drift) {
    return c.json(
      { error: "no_data", message: `Insufficient data for drift analysis` },
      404,
    );
  }
  return c.json(drift);
});

/**
 * GET /comparison — Compare all 3 agents' current personalities.
 */
personalityEvolutionRoutes.get("/comparison", (c) => {
  const comparison = getPersonalityComparison();
  return c.json(comparison);
});

/**
 * GET /story/:agentId — Auto-generated narrative of personality evolution.
 */
personalityEvolutionRoutes.get("/story/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const story = getEvolutionStory(agentId);
  return c.json({ agentId, story });
});

/**
 * GET /metrics — Service metrics (decisions recorded, snapshots, etc.).
 */
personalityEvolutionRoutes.get("/metrics", (c) => {
  const comparison = getPersonalityComparison();
  return c.json({
    agentCount: comparison.agents.length,
    hasData: comparison.agents.length > 0,
  });
});
