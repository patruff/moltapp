/**
 * Activity Feed Routes
 *
 * Public activity feed showing all AI agent trading decisions in real-time.
 * This is the social backbone of MoltApp — users can watch agents make
 * decisions, see their reasoning, and track which agent is winning.
 *
 * Routes:
 *   GET /api/v1/feed            — Public feed of all recent agent decisions
 *   GET /api/v1/feed/:agentId   — Specific agent's activity feed
 *   GET /api/v1/feed/summary    — Aggregate feed statistics
 */

import { Hono } from "hono";
import { db } from "../db/index.ts";
import { agentDecisions } from "../db/schema/agent-decisions.ts";
import { tradeReactions } from "../db/schema/trade-reactions.ts";
import { tradeComments } from "../db/schema/trade-comments.ts";
import { desc, eq, sql, and, inArray } from "drizzle-orm";
import { getAgentConfig } from "../agents/orchestrator.ts";
import { parseQueryInt } from "../lib/query-params.js";

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const feedRoutes = new Hono();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FeedEntry {
  id: number;
  agentId: string;
  agentName: string;
  agentProvider: string;
  action: string;
  symbol: string;
  quantity: string;
  reasoning: string;
  confidence: number;
  modelUsed: string;
  timestamp: Date;
  reactions: {
    bullish: number;
    bearish: number;
  };
  commentCount: number;
}

// ---------------------------------------------------------------------------
// GET /feed/summary — Aggregate feed stats (must be before /:agentId)
// ---------------------------------------------------------------------------

feedRoutes.get("/summary", async (c) => {
  try {
    // Total decisions
    const totalResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(agentDecisions);
    const totalDecisions = Number(totalResult[0]?.count ?? 0);

    // Decisions per agent
    const perAgent = await db
      .select({
        agentId: agentDecisions.agentId,
        count: sql<number>`count(*)`,
        avgConfidence: sql<number>`avg(${agentDecisions.confidence})`,
      })
      .from(agentDecisions)
      .groupBy(agentDecisions.agentId);

    // Action distribution
    const actionDist = await db
      .select({
        action: agentDecisions.action,
        count: sql<number>`count(*)`,
      })
      .from(agentDecisions)
      .groupBy(agentDecisions.action);

    // Most traded symbols
    const topSymbols = await db
      .select({
        symbol: agentDecisions.symbol,
        count: sql<number>`count(*)`,
      })
      .from(agentDecisions)
      .where(sql`${agentDecisions.action} != 'hold'`)
      .groupBy(agentDecisions.symbol)
      .orderBy(sql`count(*) DESC`)
      .limit(5);

    // Total reactions
    const reactionsResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(tradeReactions);
    const totalReactions = Number(reactionsResult[0]?.count ?? 0);

    // Total comments
    const commentsResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(tradeComments);
    const totalComments = Number(commentsResult[0]?.count ?? 0);

    return c.json({
      summary: {
        totalDecisions,
        totalReactions,
        totalComments,
        agentBreakdown: perAgent.map((a: typeof perAgent[0]) => ({
          agentId: a.agentId,
          agentName: getAgentConfig(a.agentId)?.name ?? a.agentId,
          decisions: Number(a.count),
          averageConfidence: Math.round(Number(a.avgConfidence) * 10) / 10,
        })),
        actionDistribution: actionDist.reduce(
          (acc: Record<string, number>, d: typeof actionDist[0]) => {
            acc[d.action] = Number(d.count);
            return acc;
          },
          {} as Record<string, number>,
        ),
        topSymbols: topSymbols.map((s: typeof topSymbols[0]) => ({
          symbol: s.symbol,
          tradeCount: Number(s.count),
        })),
      },
    });
  } catch (error) {
    console.error("[Feed] Failed to get summary:", error);
    return c.json(
      {
        error: "internal_error",
        code: "internal_error",
        details: "Failed to compute feed summary",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /feed — Public feed of all agent activity
// ---------------------------------------------------------------------------

feedRoutes.get("/", async (c) => {
  const actionFilter = c.req.query("action"); // Optional: filter by buy/sell/hold
  const limit = parseQueryInt(c.req.query("limit"), 20, 1, 100);
  const offset = parseQueryInt(c.req.query("offset"), 0, 0);

  try {
    // Build query with optional action filter
    const conditions = actionFilter
      ? eq(agentDecisions.action, actionFilter)
      : undefined;

    const decisions = await db
      .select()
      .from(agentDecisions)
      .where(conditions)
      .orderBy(desc(agentDecisions.createdAt))
      .limit(limit)
      .offset(offset);

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(agentDecisions)
      .where(conditions);

    // Batch fetch reactions and comments for all decisions
    const decisionIds = decisions.map((d: typeof agentDecisions.$inferSelect) => d.id);
    const feedEntries = await enrichDecisionsWithSocial(decisions, decisionIds);

    return c.json({
      feed: feedEntries,
      total: Number(countResult[0]?.count ?? 0),
      limit,
      offset,
      filters: { action: actionFilter ?? null },
    });
  } catch (error) {
    console.error("[Feed] Failed to get feed:", error);
    return c.json(
      {
        error: "internal_error",
        code: "internal_error",
        details: "Failed to load activity feed",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /feed/:agentId — Specific agent's activity feed
// ---------------------------------------------------------------------------

feedRoutes.get("/:agentId", async (c) => {
  const agentId = c.req.param("agentId");
  const config = getAgentConfig(agentId);

  if (!config) {
    return c.json(
      {
        error: "agent_not_found",
        code: "agent_not_found",
        details: `No agent with ID "${agentId}". Valid IDs: claude-value-investor, gpt-momentum-trader, grok-contrarian`,
      },
      404,
    );
  }

  const limit = parseQueryInt(c.req.query("limit"), 20, 1, 100);
  const offset = parseQueryInt(c.req.query("offset"), 0, 0);

  try {
    const decisions = await db
      .select()
      .from(agentDecisions)
      .where(eq(agentDecisions.agentId, agentId))
      .orderBy(desc(agentDecisions.createdAt))
      .limit(limit)
      .offset(offset);

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(agentDecisions)
      .where(eq(agentDecisions.agentId, agentId));

    const decisionIds = decisions.map((d: typeof agentDecisions.$inferSelect) => d.id);
    const feedEntries = await enrichDecisionsWithSocial(decisions, decisionIds);

    return c.json({
      agentId,
      agentName: config.name,
      feed: feedEntries,
      total: Number(countResult[0]?.count ?? 0),
      limit,
      offset,
    });
  } catch (error) {
    console.error(`[Feed] Failed to get feed for ${agentId}:`, error);
    return c.json(
      {
        error: "internal_error",
        code: "internal_error",
        details: `Failed to load feed for agent ${agentId}`,
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Enrich decision rows with reaction counts and comment counts.
 * Batches DB queries for efficiency.
 */
async function enrichDecisionsWithSocial(
  decisions: Array<{
    id: number;
    agentId: string;
    action: string;
    symbol: string;
    quantity: string;
    reasoning: string;
    confidence: number;
    modelUsed: string;
    createdAt: Date;
  }>,
  decisionIds: number[],
): Promise<FeedEntry[]> {
  if (decisionIds.length === 0) {
    return [];
  }

  // Batch fetch reactions
  let reactionMap = new Map<number, { bullish: number; bearish: number }>();
  try {
    const reactions = await db
      .select({
        decisionId: tradeReactions.decisionId,
        reaction: tradeReactions.reaction,
        count: sql<number>`count(*)`,
      })
      .from(tradeReactions)
      .where(inArray(tradeReactions.decisionId, decisionIds))
      .groupBy(tradeReactions.decisionId, tradeReactions.reaction);

    for (const r of reactions) {
      const existing = reactionMap.get(r.decisionId) ?? {
        bullish: 0,
        bearish: 0,
      };
      if (r.reaction === "bullish") existing.bullish = Number(r.count);
      if (r.reaction === "bearish") existing.bearish = Number(r.count);
      reactionMap.set(r.decisionId, existing);
    }
  } catch {
    // Reactions table might not exist yet
  }

  // Batch fetch comment counts
  let commentMap = new Map<number, number>();
  try {
    const comments = await db
      .select({
        decisionId: tradeComments.decisionId,
        count: sql<number>`count(*)`,
      })
      .from(tradeComments)
      .where(inArray(tradeComments.decisionId, decisionIds))
      .groupBy(tradeComments.decisionId);

    for (const c of comments) {
      commentMap.set(c.decisionId, Number(c.count));
    }
  } catch {
    // Comments table might not exist yet
  }

  // Build feed entries
  return decisions.map((d) => {
    const config = getAgentConfig(d.agentId);
    return {
      id: d.id,
      agentId: d.agentId,
      agentName: config?.name ?? d.agentId,
      agentProvider: config?.provider ?? "unknown",
      action: d.action,
      symbol: d.symbol,
      quantity: d.quantity,
      reasoning: d.reasoning,
      confidence: d.confidence,
      modelUsed: d.modelUsed,
      timestamp: d.createdAt,
      reactions: reactionMap.get(d.id) ?? { bullish: 0, bearish: 0 },
      commentCount: commentMap.get(d.id) ?? 0,
    };
  });
}
