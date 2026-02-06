/**
 * Trading Session Replay Routes
 *
 * API endpoints for reconstructing and replaying complete trading sessions.
 * Enables DVR-like functionality: see what each agent saw, thought, and did.
 */

import { Hono } from "hono";
import {
  replaySession,
  listSessions,
  compareAgentSessions,
  exportForPresentation,
} from "../services/session-replay.ts";
import { errorMessage } from "../lib/errors.ts";

const app = new Hono();

/**
 * GET /api/v1/replay/sessions
 * List available trading sessions.
 * Query: limit, agentId, fromDate, toDate
 */
app.get("/sessions", async (c) => {
  const limit = parseInt(c.req.query("limit") ?? "50");
  const agentId = c.req.query("agentId") ?? undefined;
  const fromDate = c.req.query("fromDate") ?? undefined;
  const toDate = c.req.query("toDate") ?? undefined;

  try {
    const sessions = await listSessions({ limit, agentId, fromDate, toDate });
    return c.json({ sessions, count: sessions.length });
  } catch (err) {
    return c.json(
      { error: errorMessage(err) },
      500,
    );
  }
});

/**
 * GET /api/v1/replay/:roundId
 * Replay a complete trading session with full context.
 */
app.get("/:roundId", async (c) => {
  const roundId = c.req.param("roundId");

  try {
    const replay = await replaySession(roundId);
    return c.json(replay);
  } catch (err) {
    return c.json(
      { error: errorMessage(err) },
      500,
    );
  }
});

/**
 * GET /api/v1/replay/:roundId/presentation
 * Export a session replay in a simplified presentation format.
 */
app.get("/:roundId/presentation", async (c) => {
  const roundId = c.req.param("roundId");

  try {
    const replay = await replaySession(roundId);
    const presentation = exportForPresentation(replay);
    return c.json(presentation);
  } catch (err) {
    return c.json(
      { error: errorMessage(err) },
      500,
    );
  }
});

/**
 * GET /api/v1/replay/:roundId/timeline
 * Get just the timeline events for a session (lightweight).
 */
app.get("/:roundId/timeline", async (c) => {
  const roundId = c.req.param("roundId");

  try {
    const replay = await replaySession(roundId);
    return c.json({
      roundId: replay.roundId,
      timestamp: replay.timestamp,
      duration: replay.duration,
      events: replay.timeline,
      eventCount: replay.timeline.length,
    });
  } catch (err) {
    return c.json(
      { error: errorMessage(err) },
      500,
    );
  }
});

/**
 * GET /api/v1/replay/agent/:agentId/compare
 * Compare an agent's performance across multiple sessions.
 * Query: limit (default 20)
 */
app.get("/agent/:agentId/compare", async (c) => {
  const agentId = c.req.param("agentId");
  const limit = parseInt(c.req.query("limit") ?? "20");

  try {
    const comparison = await compareAgentSessions(agentId, limit);
    return c.json(comparison);
  } catch (err) {
    return c.json(
      { error: errorMessage(err) },
      500,
    );
  }
});

/**
 * GET /api/v1/replay/:roundId/summary
 * Get just the summary for a session (very lightweight).
 */
app.get("/:roundId/summary", async (c) => {
  const roundId = c.req.param("roundId");

  try {
    const replay = await replaySession(roundId);
    return c.json({
      roundId: replay.roundId,
      timestamp: replay.timestamp,
      duration: replay.duration,
      tradingMode: replay.tradingMode,
      agentCount: replay.agentCount,
      summary: replay.summary,
      annotations: replay.annotations,
    });
  } catch (err) {
    return c.json(
      { error: errorMessage(err) },
      500,
    );
  }
});

export const sessionReplayRoutes = app;
