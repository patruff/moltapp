/**
 * Pre-Trade Deliberation & Post-Trade Meeting of Minds API Routes
 *
 * Exposes the multi-agent deliberation engine for monitoring
 * and analysis. Shows how agents debate before and after trades.
 */

import { Hono } from "hono";
import {
  getDeliberationMetrics,
  getDeliberation,
  getDeliberationForRound,
  getRecentDeliberations,
  getDeliberationConfig,
  configureDeliberation,
} from "../services/pre-trade-deliberation.ts";
import {
  getMeetingByRoundId,
  getLatestMeeting,
  getRecentMeetings,
} from "../services/meeting-of-minds.ts";
import { apiError } from "../lib/errors.ts";

export const deliberationRoutes = new Hono();

/**
 * GET /metrics — Deliberation system metrics
 */
deliberationRoutes.get("/metrics", (c) => {
  const metrics = getDeliberationMetrics();
  return c.json({
    ok: true,
    metrics,
  });
});

/**
 * GET /recent — Recent deliberation rounds
 */
deliberationRoutes.get("/recent", (c) => {
  const limit = parseInt(c.req.query("limit") ?? "10", 10);
  const deliberations = getRecentDeliberations(Math.min(limit, 50));
  return c.json({
    ok: true,
    count: deliberations.length,
    deliberations,
  });
});

/**
 * GET /:id — Get a specific deliberation by ID
 */
deliberationRoutes.get("/:id", (c) => {
  const id = c.req.param("id");

  // Check if it's a round ID or deliberation ID
  let result = getDeliberation(id);
  if (!result) {
    result = getDeliberationForRound(id);
  }

  if (!result) {
    return apiError(c, "DELIBERATION_NOT_FOUND");
  }

  return c.json({
    ok: true,
    deliberation: result,
  });
});

/**
 * GET /round/:roundId — Get deliberation for a specific trading round
 */
deliberationRoutes.get("/round/:roundId", (c) => {
  const roundId = c.req.param("roundId");
  const result = getDeliberationForRound(roundId);

  if (!result) {
    return apiError(c, "DELIBERATION_NOT_FOUND", `Round: ${roundId}`);
  }

  return c.json({
    ok: true,
    deliberation: result,
  });
});

/**
 * GET /config — Get deliberation configuration
 */
deliberationRoutes.get("/config", (c) => {
  return c.json({
    ok: true,
    config: getDeliberationConfig(),
  });
});

/**
 * POST /config — Update deliberation configuration
 */
deliberationRoutes.post("/config", async (c) => {
  const body = await c.req.json();
  const config = configureDeliberation(body);
  return c.json({
    ok: true,
    config,
  });
});

// ---------------------------------------------------------------------------
// Meeting of Minds (Post-Trade Deliberation)
// ---------------------------------------------------------------------------

/**
 * GET /meeting/latest — Most recent meeting transcript
 */
deliberationRoutes.get("/meeting/latest", (c) => {
  const meeting = getLatestMeeting();
  if (!meeting) {
    return apiError(c, "DELIBERATION_NOT_FOUND", "No meetings recorded yet");
  }
  return c.json({ ok: true, meeting });
});

/**
 * GET /meeting/recent — Recent meetings
 */
deliberationRoutes.get("/meeting/recent", (c) => {
  const limit = parseInt(c.req.query("limit") ?? "10", 10);
  const meetings = getRecentMeetings(Math.min(limit, 50));
  return c.json({ ok: true, count: meetings.length, meetings });
});

/**
 * GET /meeting/:roundId — Meeting transcript for a specific round
 */
deliberationRoutes.get("/meeting/:roundId", (c) => {
  const roundId = c.req.param("roundId");
  const meeting = getMeetingByRoundId(roundId);
  if (!meeting) {
    return apiError(c, "DELIBERATION_NOT_FOUND", `No meeting for round: ${roundId}`);
  }
  return c.json({ ok: true, meeting });
});
