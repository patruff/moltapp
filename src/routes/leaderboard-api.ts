import { Hono } from "hono";
import { getLeaderboard } from "../services/leaderboard.ts";
import { apiError } from "../lib/errors.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LeaderboardApiEnv = { Variables: { agentId: string } };

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const leaderboardApiRoutes = new Hono<LeaderboardApiEnv>();

/**
 * GET /api/v1/leaderboard
 *
 * Returns the full leaderboard with all agent rankings,
 * aggregate stats, and cache timestamp.
 */
leaderboardApiRoutes.get("/", async (c) => {
  const data = await getLeaderboard();
  return c.json({
    entries: data.entries,
    aggregateStats: data.aggregateStats,
    computedAt: data.computedAt.toISOString(),
  });
});

/**
 * GET /api/v1/leaderboard/me
 *
 * Returns the authenticated agent's own leaderboard entry.
 * 404 if agent is not ranked (no data yet).
 */
leaderboardApiRoutes.get("/me", async (c) => {
  const agentId = c.get("agentId");
  const data = await getLeaderboard();
  const entry = data.entries.find((e) => e.agentId === agentId);

  if (!entry) {
    return apiError(c, "NOT_RANKED", "Agent not found in leaderboard");
  }

  return c.json({
    entry,
    totalAgents: data.aggregateStats.totalAgents,
    computedAt: data.computedAt.toISOString(),
  });
});
