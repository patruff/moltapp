/**
 * Agent Debate Routes
 *
 * AI agents argue about stocks with structured rebuttals and scoring.
 * When agents disagree, they debate their positions with conviction
 * ratings, supporting evidence, and a judging system.
 *
 * Routes:
 *   GET  /api/v1/debates                        — All active debates
 *   GET  /api/v1/debates/stock/:symbol          — Generate debate for a stock
 *   GET  /api/v1/debates/outlook                — Market outlook from all agents
 *   GET  /api/v1/debates/history                — Past debate outcomes
 *   GET  /api/v1/debates/:agentId/stats         — Agent's debate performance
 */

import { Hono } from "hono";
import {
  generateDebate,
  getActiveDebates,
  getDebateHistory,
  generateMarketOutlook,
  getAgentDebateStats,
} from "../services/debates.ts";
import { getAgentConfig, getAgentConfigs } from "../agents/orchestrator.ts";
import { errorMessage } from "../lib/errors.ts";

export const debateRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET /debates — List all active debates
// ---------------------------------------------------------------------------

debateRoutes.get("/", async (c) => {
  try {
    const debates = await getActiveDebates();

    return c.json({
      debates,
      count: debates.length,
      description: "Active stock debates where AI agents disagree. Each debate features structured arguments, rebuttals, and conviction scoring.",
    });
  } catch (error) {
    console.error("[Debates] Active debates error:", error);
    return c.json(
      {
        error: "debate_error",
        code: "active_debates_failed",
        details: errorMessage(error),
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /debates/outlook — Full market outlook from all agents
// ---------------------------------------------------------------------------

debateRoutes.get("/outlook", async (c) => {
  try {
    const outlook = await generateMarketOutlook();

    return c.json({
      outlook,
      description: `Market outlook: ${outlook.overallSentiment.toUpperCase()}. ${outlook.agentOutlooks.length} agents reporting. ${outlook.consensusAreas.length} areas of agreement, ${outlook.disagreementAreas.length} areas of disagreement.`,
    });
  } catch (error) {
    console.error("[Debates] Outlook error:", error);
    return c.json(
      {
        error: "debate_error",
        code: "outlook_failed",
        details: errorMessage(error),
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /debates/history — Past debate outcomes
// ---------------------------------------------------------------------------

debateRoutes.get("/history", async (c) => {
  try {
    const history = await getDebateHistory();

    return c.json({
      history,
      description: "Historical debate outcomes showing which agent's position was ultimately correct.",
    });
  } catch (error) {
    console.error("[Debates] History error:", error);
    return c.json(
      {
        error: "debate_error",
        code: "history_failed",
        details: errorMessage(error),
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /debates/stock/:symbol — Generate debate for a specific stock
// ---------------------------------------------------------------------------

debateRoutes.get("/stock/:symbol", async (c) => {
  const symbol = c.req.param("symbol");

  try {
    const debate = await generateDebate(symbol);

    if (!debate) {
      return c.json(
        {
          error: "no_data",
          code: "no_debate_data",
          details: `Not enough agent opinions on "${symbol}" to generate a debate. Agents need recent decisions on this stock.`,
        },
        404,
      );
    }

    return c.json({
      debate,
      description: `${debate.topic} — ${debate.participants.length} agents debating. Winner: ${debate.judging.winner.agentName} (score: ${debate.judging.winner.score}).`,
    });
  } catch (error) {
    console.error(`[Debates] Debate error for ${symbol}:`, error);
    return c.json(
      {
        error: "debate_error",
        code: "debate_generation_failed",
        details: errorMessage(error),
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /debates/:agentId/stats — Agent's debate performance
// ---------------------------------------------------------------------------

debateRoutes.get("/:agentId/stats", async (c) => {
  const agentId = c.req.param("agentId");
  const config = getAgentConfig(agentId);

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
    const stats = await getAgentDebateStats(agentId);

    if (!stats) {
      return c.json(
        {
          error: "no_data",
          code: "no_debate_stats",
          details: `No debate data available for ${config.name}`,
        },
        404,
      );
    }

    return c.json({
      stats,
      description: `${config.name} debate record: ${stats.wins}W-${stats.losses}L-${stats.draws}D (${stats.winRate.toFixed(1)}% win rate). Avg conviction: ${stats.avgConviction}%. Favorite position: ${stats.favoritePosition}.`,
    });
  } catch (error) {
    console.error(`[Debates] Stats error for ${agentId}:`, error);
    return c.json(
      {
        error: "debate_error",
        code: "stats_failed",
        details: errorMessage(error),
      },
      500,
    );
  }
});
