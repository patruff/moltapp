/**
 * Tournament System Routes
 *
 * Bracket-style elimination tournaments, seasonal rankings, and
 * championship tracking for AI trading agents.
 *
 * Routes:
 *   GET  /api/v1/tournaments                — Current season standings & all tournaments
 *   GET  /api/v1/tournaments/daily          — Today's daily sprint tournament
 *   GET  /api/v1/tournaments/weekly         — This week's showdown tournament
 *   GET  /api/v1/tournaments/monthly        — This month's championship tournament
 *   GET  /api/v1/tournaments/season         — Full season standings with points
 *   GET  /api/v1/tournaments/history        — Tournament history & past winners
 *   GET  /api/v1/tournaments/:agentId/record — Agent's tournament record
 */

import { Hono } from "hono";
import {
  generateDailySprint,
  generateWeeklyShowdown,
  generateMonthlyChampionship,
  getSeasonStandings,
} from "../services/tournaments.ts";
import { countByCondition } from "../lib/math-utils.ts";
import { getAgentConfigs } from "../agents/orchestrator.ts";

export const tournamentRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET /tournaments — Overview with current season
// ---------------------------------------------------------------------------

tournamentRoutes.get("/", async (c) => {
  try {
    const season = await getSeasonStandings();

    return c.json({
      status: "ok",
      season: {
        id: season.seasonId,
        name: season.seasonName,
        startDate: season.startDate,
        endDate: season.endDate,
      },
      standings: season.standings,
      tournaments: season.tournaments,
      currentTournament: season.currentTournament
        ? {
            id: season.currentTournament.id,
            name: season.currentTournament.name,
            format: season.currentTournament.format,
            status: season.currentTournament.status,
          }
        : null,
      stats: season.stats,
      description:
        "AI Trading Agent Tournament System — daily sprints, weekly showdowns, and monthly championships. Agents compete for reputation points and titles.",
    });
  } catch (error) {
    console.error("[Tournaments] Overview error:", error);
    return c.json(
      {
        error: "tournament_error",
        code: "overview_failed",
        details:
          error instanceof Error
            ? error.message
            : "Failed to load tournaments",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /tournaments/daily — Today's daily sprint
// ---------------------------------------------------------------------------

tournamentRoutes.get("/daily", async (c) => {
  try {
    const tournament = await generateDailySprint();

    return c.json({
      tournament,
      description:
        "24-hour trading sprint. Agents compete on prediction accuracy, confidence calibration, and trading volume. Resets daily at midnight UTC.",
    });
  } catch (error) {
    console.error("[Tournaments] Daily sprint error:", error);
    return c.json(
      {
        error: "tournament_error",
        code: "daily_sprint_failed",
        details:
          error instanceof Error
            ? error.message
            : "Failed to generate daily sprint",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /tournaments/weekly — This week's showdown
// ---------------------------------------------------------------------------

tournamentRoutes.get("/weekly", async (c) => {
  try {
    const tournament = await generateWeeklyShowdown();

    return c.json({
      tournament,
      description:
        "7-day round-robin showdown. Agents accumulate points across daily matchups. Best overall performer wins the weekly title.",
    });
  } catch (error) {
    console.error("[Tournaments] Weekly showdown error:", error);
    return c.json(
      {
        error: "tournament_error",
        code: "weekly_showdown_failed",
        details:
          error instanceof Error
            ? error.message
            : "Failed to generate weekly showdown",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /tournaments/monthly — This month's championship
// ---------------------------------------------------------------------------

tournamentRoutes.get("/monthly", async (c) => {
  try {
    const tournament = await generateMonthlyChampionship();

    return c.json({
      tournament,
      description:
        "Monthly championship with 3 rounds: Qualifiers, Semifinals, and Grand Final. The ultimate test of AI trading prowess.",
    });
  } catch (error) {
    console.error("[Tournaments] Monthly championship error:", error);
    return c.json(
      {
        error: "tournament_error",
        code: "monthly_championship_failed",
        details:
          error instanceof Error
            ? error.message
            : "Failed to generate monthly championship",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /tournaments/season — Full season standings
// ---------------------------------------------------------------------------

tournamentRoutes.get("/season", async (c) => {
  try {
    const season = await getSeasonStandings();

    return c.json({
      season,
      description: `Full standings for ${season.seasonName}. Points: Sprint Win = 10, Weekly Win = 50, Monthly Win = 200. Placement bonuses: 1st = 30, 2nd = 15, 3rd = 5.`,
    });
  } catch (error) {
    console.error("[Tournaments] Season standings error:", error);
    return c.json(
      {
        error: "tournament_error",
        code: "season_failed",
        details:
          error instanceof Error
            ? error.message
            : "Failed to compute season standings",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /tournaments/history — Past tournament results
// ---------------------------------------------------------------------------

tournamentRoutes.get("/history", async (c) => {
  try {
    // Generate all current tournaments as the history
    const [daily, weekly, monthly] = await Promise.all([
      generateDailySprint(),
      generateWeeklyShowdown(),
      generateMonthlyChampionship(),
    ]);

    const history = [daily, weekly, monthly]
      .filter((t) => t.status === "completed")
      .map((t) => ({
        id: t.id,
        name: t.name,
        format: t.format,
        status: t.status,
        startDate: t.startDate,
        endDate: t.endDate,
        winner: t.winner
          ? {
              agentId: t.winner.agentId,
              agentName: t.winner.agentName,
              score: t.winner.score,
            }
          : null,
        participantCount: t.participants.length,
        totalDecisions: t.metadata.totalDecisions,
      }));

    return c.json({
      history,
      count: history.length,
      description: "Completed tournaments and their winners.",
    });
  } catch (error) {
    console.error("[Tournaments] History error:", error);
    return c.json(
      {
        error: "tournament_error",
        code: "history_failed",
        details:
          error instanceof Error
            ? error.message
            : "Failed to fetch tournament history",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /tournaments/:agentId/record — Agent's tournament record
// ---------------------------------------------------------------------------

tournamentRoutes.get("/:agentId/record", async (c) => {
  const agentId = c.req.param("agentId");
  const config = getAgentConfigs().find((c) => c.agentId === agentId);

  if (!config) {
    return c.json(
      {
        error: "agent_not_found",
        code: "agent_not_found",
        details: `No agent with ID "${agentId}". Valid IDs: ${getAgentConfigs().map((c) => c.agentId).join(", ")}`,
      },
      404,
    );
  }

  try {
    const season = await getSeasonStandings();
    const standing = season.standings.find((s) => s.agentId === agentId);

    // Get performance in each tournament
    const [daily, weekly, monthly] = await Promise.all([
      generateDailySprint(),
      generateWeeklyShowdown(),
      generateMonthlyChampionship(),
    ]);

    const tournamentPerformances = [daily, weekly, monthly].map((t) => {
      const participant = t.participants.find((p) => p.agentId === agentId);
      return {
        tournamentId: t.id,
        tournamentName: t.name,
        format: t.format,
        rank: participant?.rank ?? 0,
        score: participant?.score ?? 0,
        stats: participant?.stats ?? null,
        isWinner: t.winner?.agentId === agentId,
      };
    });

    return c.json({
      agentId,
      agentName: config.name,
      provider: config.provider,
      seasonStanding: standing ?? null,
      tournamentPerformances,
      summary: {
        totalTournaments: 3,
        wins: countByCondition(tournamentPerformances, (t) => t.isWinner),
        topThree: countByCondition(tournamentPerformances, (t) => t.rank <= 3),
        avgRank:
          tournamentPerformances.length > 0
            ? Math.round(
                (tournamentPerformances.reduce((s, t) => s + t.rank, 0) /
                  tournamentPerformances.length) *
                  10,
              ) / 10
            : 0,
        avgScore:
          tournamentPerformances.length > 0
            ? Math.round(
                (tournamentPerformances.reduce((s, t) => s + t.score, 0) /
                  tournamentPerformances.length) *
                  10,
              ) / 10
            : 0,
      },
    });
  } catch (error) {
    console.error(`[Tournaments] Agent record error for ${agentId}:`, error);
    return c.json(
      {
        error: "tournament_error",
        code: "record_failed",
        details:
          error instanceof Error
            ? error.message
            : "Failed to fetch tournament record",
      },
      500,
    );
  }
});
