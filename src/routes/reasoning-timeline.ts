/**
 * Reasoning Timeline API Routes
 *
 * Tracks how agent reasoning evolves over time.
 * This is what separates MoltApp from static benchmarks:
 * we measure CHANGE and ADAPTATION, not just snapshots.
 *
 * Routes:
 * - GET  /                 — All agent timelines summary
 * - GET  /:agentId         — Full timeline for one agent
 * - GET  /:agentId/vocabulary  — Vocabulary analysis over time
 * - GET  /:agentId/inflections — Behavioral inflection points
 * - GET  /compare           — Side-by-side timeline comparison
 */

import { Hono } from "hono";
import {
  buildAgentTimeline,
  getAllTimelines,
} from "../services/reasoning-timeline.ts";

export const reasoningTimelineRoutes = new Hono();

/**
 * GET / — All agent timelines (summary view)
 */
reasoningTimelineRoutes.get("/", (c) => {
  const timelines = getAllTimelines();

  const summaries = timelines.map((t) => ({
    agentId: t.agentId,
    totalEntries: t.totalEntries,
    adaptationScore: t.adaptationScore,
    consistencyScore: t.consistencyScore,
    vocabularyTrend: t.vocabularyMetrics.trend,
    inflectionCount: t.inflectionPoints.length,
    summary: t.summary,
  }));

  return c.json({
    ok: true,
    timelines: summaries,
    description: "How each agent's reasoning has evolved over time",
  });
});

/**
 * GET /:agentId — Full timeline for one agent
 */
reasoningTimelineRoutes.get("/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const timeline = buildAgentTimeline(agentId);

  return c.json({ ok: true, timeline });
});

/**
 * GET /:agentId/vocabulary — Vocabulary analysis
 */
reasoningTimelineRoutes.get("/:agentId/vocabulary", (c) => {
  const agentId = c.req.param("agentId");
  const timeline = buildAgentTimeline(agentId);

  return c.json({
    ok: true,
    agentId,
    vocabulary: timeline.vocabularyMetrics,
    description: "How the agent's analytical vocabulary has changed over time",
  });
});

/**
 * GET /:agentId/inflections — Behavioral inflection points
 */
reasoningTimelineRoutes.get("/:agentId/inflections", (c) => {
  const agentId = c.req.param("agentId");
  const timeline = buildAgentTimeline(agentId);

  return c.json({
    ok: true,
    agentId,
    inflectionPoints: timeline.inflectionPoints,
    description: "Key moments where the agent's behavior changed significantly",
  });
});

/**
 * GET /compare — Side-by-side comparison of two agents
 */
reasoningTimelineRoutes.get("/compare", (c) => {
  const agentA = c.req.query("a");
  const agentB = c.req.query("b");

  if (!agentA || !agentB) {
    return c.json({ ok: false, error: "Both 'a' and 'b' query params required" }, 400);
  }

  const timelineA = buildAgentTimeline(agentA);
  const timelineB = buildAgentTimeline(agentB);

  return c.json({
    ok: true,
    comparison: {
      agentA: {
        agentId: agentA,
        totalEntries: timelineA.totalEntries,
        adaptationScore: timelineA.adaptationScore,
        consistencyScore: timelineA.consistencyScore,
        vocabularyRichness: timelineA.vocabularyMetrics.richness,
        vocabularyTrend: timelineA.vocabularyMetrics.trend,
        inflectionCount: timelineA.inflectionPoints.length,
      },
      agentB: {
        agentId: agentB,
        totalEntries: timelineB.totalEntries,
        adaptationScore: timelineB.adaptationScore,
        consistencyScore: timelineB.consistencyScore,
        vocabularyRichness: timelineB.vocabularyMetrics.richness,
        vocabularyTrend: timelineB.vocabularyMetrics.trend,
        inflectionCount: timelineB.inflectionPoints.length,
      },
      verdicts: {
        betterAdaptation: timelineA.adaptationScore > timelineB.adaptationScore ? agentA : agentB,
        moreConsistent: timelineA.consistencyScore > timelineB.consistencyScore ? agentA : agentB,
        richerVocabulary: timelineA.vocabularyMetrics.richness > timelineB.vocabularyMetrics.richness ? agentA : agentB,
      },
    },
  });
});
