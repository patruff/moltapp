/**
 * Copy Trading Routes
 *
 * Enables users and agents to "follow" an AI trading agent and track
 * performance as if they had copied every trade. Features virtual portfolios,
 * copy trade execution, performance tracking, and follower leaderboards.
 *
 * Routes:
 *   POST   /api/v1/copy/follow              — Start following an AI agent
 *   DELETE /api/v1/copy/follow/:followerId   — Stop following
 *   GET    /api/v1/copy/portfolio/:followerId — Follower's copy portfolio
 *   GET    /api/v1/copy/history/:followerId   — Copy trade history
 *   POST   /api/v1/copy/sync/:followerId     — Sync latest agent decisions
 *   GET    /api/v1/copy/leaderboard          — Top copy traders
 *   GET    /api/v1/copy/agents/:agentId/followers — Agent's followers
 *   GET    /api/v1/copy/stats                — Copy trading platform stats
 */

import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/index.ts";
import { copyFollowers, copyTrades } from "../db/schema/copy-trading.ts";
import { agentDecisions } from "../db/schema/agent-decisions.ts";
import { eq, desc, sql, and } from "drizzle-orm";
import { getAgentConfig, getAgentConfigs, getMarketData } from "../agents/orchestrator.ts";
import type { MarketData } from "../agents/base-agent.ts";
import { clamp, countByCondition, round2 } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Type Aliases
// ---------------------------------------------------------------------------

type CopyFollower = typeof copyFollowers.$inferSelect;
type CopyTrade = typeof copyTrades.$inferSelect;
type AgentDecision = typeof agentDecisions.$inferSelect;

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const copyTradingRoutes = new Hono();

// ---------------------------------------------------------------------------
// Validation Schemas
// ---------------------------------------------------------------------------

const followSchema = z.object({
  followerId: z
    .string()
    .min(1, "followerId is required")
    .max(64, "followerId too long"),
  followerName: z
    .string()
    .min(1, "followerName is required")
    .max(64, "followerName too long"),
  targetAgentId: z
    .string()
    .min(1, "targetAgentId is required"),
  initialCapital: z
    .number()
    .min(100, "Minimum capital is $100")
    .max(1_000_000, "Maximum capital is $1,000,000")
    .optional()
    .default(10000),
});

// ---------------------------------------------------------------------------
// Copy Position type
// ---------------------------------------------------------------------------

interface CopyPosition {
  symbol: string;
  quantity: number;
  avgCost: number;
}

// ---------------------------------------------------------------------------
// POST /copy/follow — Start following an AI agent
// ---------------------------------------------------------------------------

copyTradingRoutes.post("/follow", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: "invalid_json", code: "invalid_json", details: "Request body must be valid JSON" },
      400,
    );
  }

  const parsed = followSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: "validation_failed",
        code: "validation_failed",
        details: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
      400,
    );
  }

  const { followerId, followerName, targetAgentId, initialCapital } = parsed.data;

  // Validate agent exists
  const config = getAgentConfig(targetAgentId);
  if (!config) {
    return c.json(
      {
        error: "agent_not_found",
        code: "agent_not_found",
        details: `No agent with ID "${targetAgentId}". Valid IDs: claude-value-investor, gpt-momentum-trader, grok-contrarian`,
      },
      404,
    );
  }

  // Check if already following
  const existing = await db
    .select()
    .from(copyFollowers)
    .where(
      and(
        eq(copyFollowers.followerId, followerId),
        eq(copyFollowers.targetAgentId, targetAgentId),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    return c.json(
      {
        error: "already_following",
        code: "already_following",
        details: `You are already following ${config.name}`,
        follow: formatFollower(existing[0]),
      },
      409,
    );
  }

  // Create the follow
  const [follower] = await db
    .insert(copyFollowers)
    .values({
      followerId,
      followerName,
      targetAgentId,
      initialCapital: String(initialCapital),
      currentCash: String(initialCapital),
      portfolioValue: String(initialCapital),
    })
    .returning();

  return c.json(
    {
      message: `Now copy trading ${config.name}!`,
      follow: formatFollower(follower),
      agentInfo: {
        agentId: config.agentId,
        agentName: config.name,
        provider: config.provider,
        riskTolerance: config.riskTolerance,
        tradingStyle: config.tradingStyle,
      },
    },
    201,
  );
});

// ---------------------------------------------------------------------------
// DELETE /copy/follow/:followerId — Stop following (unfollow all or specific)
// ---------------------------------------------------------------------------

copyTradingRoutes.delete("/follow/:followerId", async (c) => {
  const followerId = c.req.param("followerId");
  const targetAgentId = c.req.query("agentId");

  const conditions = targetAgentId
    ? and(eq(copyFollowers.followerId, followerId), eq(copyFollowers.targetAgentId, targetAgentId))
    : eq(copyFollowers.followerId, followerId);

  const deleted = await db
    .delete(copyFollowers)
    .where(conditions)
    .returning();

  if (deleted.length === 0) {
    return c.json({ error: "not_found", code: "not_found", details: "No active follow found" }, 404);
  }

  return c.json({
    message: `Unfollowed ${deleted.length} agent(s)`,
    unfollowed: deleted.map((f: CopyFollower) => ({
      targetAgentId: f.targetAgentId,
      finalPortfolioValue: parseFloat(f.portfolioValue),
      totalPnl: parseFloat(f.totalPnl),
      tradesCopied: f.tradesCopied,
    })),
  });
});

// ---------------------------------------------------------------------------
// GET /copy/portfolio/:followerId — Follower's copy portfolio
// ---------------------------------------------------------------------------

copyTradingRoutes.get("/portfolio/:followerId", async (c) => {
  const followerId = c.req.param("followerId");

  const follows = await db
    .select()
    .from(copyFollowers)
    .where(eq(copyFollowers.followerId, followerId));

  if (follows.length === 0) {
    return c.json(
      { error: "not_found", code: "not_found", details: "No copy trading portfolios found for this follower" },
      404,
    );
  }

  // Get current market prices
  let marketData: MarketData[] = [];
  try {
    marketData = await getMarketData();
  } catch {
    // use empty
  }

  const portfolios = follows.map((f: CopyFollower) => {
    const positions = (f.positions as CopyPosition[]) ?? [];
    const config = getAgentConfig(f.targetAgentId);

    // Recalculate portfolio value with current prices
    let positionsValue = 0;
    const enrichedPositions = positions.map((pos) => {
      const market = marketData.find((m) => m.symbol.toLowerCase() === pos.symbol.toLowerCase());
      const currentPrice = market?.price ?? pos.avgCost;
      const marketValue = currentPrice * pos.quantity;
      const unrealizedPnl = (currentPrice - pos.avgCost) * pos.quantity;
      positionsValue += marketValue;

      return {
        symbol: pos.symbol,
        quantity: pos.quantity,
        avgCost: pos.avgCost,
        currentPrice,
        marketValue: round2(marketValue),
        unrealizedPnl: round2(unrealizedPnl),
        unrealizedPnlPercent: pos.avgCost > 0
          ? Math.round(((currentPrice - pos.avgCost) / pos.avgCost) * 10000) / 100
          : 0,
      };
    });

    const cash = parseFloat(f.currentCash);
    const totalValue = cash + positionsValue;
    const initialCap = parseFloat(f.initialCapital);
    const totalPnl = totalValue - initialCap;
    const totalPnlPercent = initialCap > 0 ? (totalPnl / initialCap) * 100 : 0;

    return {
      targetAgentId: f.targetAgentId,
      targetAgentName: config?.name ?? f.targetAgentId,
      targetProvider: config?.provider ?? "unknown",
      followedSince: f.createdAt,
      initialCapital: initialCap,
      currentCash: cash,
      positionsValue: round2(positionsValue),
      totalValue: round2(totalValue),
      totalPnl: round2(totalPnl),
      totalPnlPercent: round2(totalPnlPercent),
      tradesCopied: f.tradesCopied,
      positions: enrichedPositions,
      isActive: f.isActive === "true",
    };
  });

  // Aggregate
  type Portfolio = typeof portfolios[number];
  const totalValue = portfolios.reduce((s: number, p: Portfolio) => s + p.totalValue, 0);
  const totalInitial = portfolios.reduce((s: number, p: Portfolio) => s + p.initialCapital, 0);

  return c.json({
    followerId,
    followerName: follows[0].followerName,
    summary: {
      totalPortfolioValue: round2(totalValue),
      totalInitialCapital: totalInitial,
      totalPnl: round2(totalValue - totalInitial),
      totalPnlPercent: totalInitial > 0 ? Math.round(((totalValue - totalInitial) / totalInitial) * 10000) / 100 : 0,
      agentsFollowed: portfolios.length,
      totalTradesCopied: portfolios.reduce((s: number, p: Portfolio) => s + p.tradesCopied, 0),
    },
    portfolios,
  });
});

// ---------------------------------------------------------------------------
// GET /copy/history/:followerId — Copy trade history
// ---------------------------------------------------------------------------

copyTradingRoutes.get("/history/:followerId", async (c) => {
  const followerId = c.req.param("followerId");
  const limitStr = c.req.query("limit");
  const offsetStr = c.req.query("offset");

  let limit = 20;
  if (limitStr) {
    const parsed = parseInt(limitStr, 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = clamp(parsed, 1, 100);
    }
  }

  let offset = 0;
  if (offsetStr) {
    const parsed = parseInt(offsetStr, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      offset = parsed;
    }
  }

  const trades = await db
    .select()
    .from(copyTrades)
    .where(eq(copyTrades.followerId, followerId))
    .orderBy(desc(copyTrades.createdAt))
    .limit(limit)
    .offset(offset);

  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(copyTrades)
    .where(eq(copyTrades.followerId, followerId));

  return c.json({
    followerId,
    trades: trades.map((t: CopyTrade) => {
      const config = getAgentConfig(t.sourceAgentId);
      return {
        id: t.id,
        sourceAgentId: t.sourceAgentId,
        sourceAgentName: config?.name ?? t.sourceAgentId,
        sourceDecisionId: t.sourceDecisionId,
        action: t.action,
        symbol: t.symbol,
        quantity: parseFloat(t.quantity),
        price: parseFloat(t.price),
        tradePnl: parseFloat(t.tradePnl ?? "0"),
        confidence: t.confidence,
        reasoning: t.reasoning,
        timestamp: t.createdAt,
      };
    }),
    total: Number(countResult[0]?.count ?? 0),
    limit,
    offset,
  });
});

// ---------------------------------------------------------------------------
// POST /copy/sync/:followerId — Sync latest agent decisions
// ---------------------------------------------------------------------------

copyTradingRoutes.post("/sync/:followerId", async (c) => {
  const followerId = c.req.param("followerId");

  // Get all active follows for this follower
  const follows = await db
    .select()
    .from(copyFollowers)
    .where(
      and(eq(copyFollowers.followerId, followerId), eq(copyFollowers.isActive, "true")),
    );

  if (follows.length === 0) {
    return c.json(
      { error: "not_found", code: "not_found", details: "No active follows found" },
      404,
    );
  }

  // Get current market data for pricing
  let marketData: MarketData[] = [];
  try {
    marketData = await getMarketData();
  } catch {
    // empty
  }

  const syncResults: Array<{
    agentId: string;
    agentName: string;
    newDecisions: number;
    tradesCopied: number;
  }> = [];

  for (const follow of follows) {
    const config = getAgentConfig(follow.targetAgentId);
    const agentName = config?.name ?? follow.targetAgentId;

    // Find decisions made after the last sync
    const existingCopyIds = await db
      .select({ sourceDecisionId: copyTrades.sourceDecisionId })
      .from(copyTrades)
      .where(
        and(
          eq(copyTrades.followerId, followerId),
          eq(copyTrades.sourceAgentId, follow.targetAgentId),
        ),
      );

    const copiedIds = new Set(existingCopyIds.map((r: { sourceDecisionId: number }) => r.sourceDecisionId));

    // Get agent's recent decisions
    const recentDecisions = await db
      .select()
      .from(agentDecisions)
      .where(eq(agentDecisions.agentId, follow.targetAgentId))
      .orderBy(desc(agentDecisions.createdAt))
      .limit(50);

    // Filter to new, uncopied decisions
    const newDecisions = recentDecisions.filter((d: AgentDecision) => !copiedIds.has(d.id));

    if (newDecisions.length === 0) {
      syncResults.push({ agentId: follow.targetAgentId, agentName, newDecisions: 0, tradesCopied: 0 });
      continue;
    }

    // Process each new decision (oldest first)
    let currentCash = parseFloat(follow.currentCash);
    let positions: CopyPosition[] = (follow.positions as CopyPosition[]) ?? [];
    let tradesCopied = follow.tradesCopied;
    let totalPnl = parseFloat(follow.totalPnl);

    const reversedNew = [...newDecisions].reverse(); // oldest first

    for (const decision of reversedNew) {
      if (decision.action === "hold") {
        // Record the hold but don't change portfolio
        await db.insert(copyTrades).values({
          followerId,
          sourceAgentId: follow.targetAgentId,
          sourceDecisionId: decision.id,
          action: "hold",
          symbol: decision.symbol,
          quantity: "0",
          price: "0",
          confidence: decision.confidence,
          reasoning: decision.reasoning,
        });
        tradesCopied++;
        continue;
      }

      // Get current price for this symbol
      const market = marketData.find(
        (m) => m.symbol.toLowerCase() === decision.symbol.toLowerCase(),
      );
      const price = market?.price ?? 100; // fallback

      if (decision.action === "buy") {
        // Buy with proportional sizing (same % of portfolio as agent)
        const usdcAmount = Math.min(
          parseFloat(decision.quantity) || 500,
          currentCash * 0.25, // max 25% of cash per trade
          currentCash - 100, // keep $100 buffer
        );

        if (usdcAmount <= 0) continue;

        const quantity = usdcAmount / price;
        currentCash -= usdcAmount;

        // Update or create position
        const existingPos = positions.find(
          (p) => p.symbol.toLowerCase() === decision.symbol.toLowerCase(),
        );
        if (existingPos) {
          const totalQty = existingPos.quantity + quantity;
          existingPos.avgCost =
            (existingPos.avgCost * existingPos.quantity + price * quantity) / totalQty;
          existingPos.quantity = totalQty;
        } else {
          positions.push({
            symbol: decision.symbol,
            quantity,
            avgCost: price,
          });
        }

        await db.insert(copyTrades).values({
          followerId,
          sourceAgentId: follow.targetAgentId,
          sourceDecisionId: decision.id,
          action: "buy",
          symbol: decision.symbol,
          quantity: String(quantity),
          price: String(price),
          confidence: decision.confidence,
          reasoning: decision.reasoning,
        });
        tradesCopied++;
      } else if (decision.action === "sell") {
        // Sell position if we have one
        const posIdx = positions.findIndex(
          (p) => p.symbol.toLowerCase() === decision.symbol.toLowerCase(),
        );
        if (posIdx === -1) continue; // no position to sell

        const pos = positions[posIdx];
        const sellQty = Math.min(
          parseFloat(decision.quantity) || pos.quantity,
          pos.quantity,
        );
        const proceeds = sellQty * price;
        const tradePnl = (price - pos.avgCost) * sellQty;

        currentCash += proceeds;
        totalPnl += tradePnl;

        pos.quantity -= sellQty;
        if (pos.quantity <= 0.0001) {
          positions.splice(posIdx, 1);
        }

        await db.insert(copyTrades).values({
          followerId,
          sourceAgentId: follow.targetAgentId,
          sourceDecisionId: decision.id,
          action: "sell",
          symbol: decision.symbol,
          quantity: String(sellQty),
          price: String(price),
          tradePnl: String(tradePnl),
          confidence: decision.confidence,
          reasoning: decision.reasoning,
        });
        tradesCopied++;
      }
    }

    // Calculate total portfolio value
    let positionsValue = 0;
    for (const pos of positions) {
      const market = marketData.find(
        (m) => m.symbol.toLowerCase() === pos.symbol.toLowerCase(),
      );
      positionsValue += (market?.price ?? pos.avgCost) * pos.quantity;
    }
    const portfolioValue = currentCash + positionsValue;
    const initialCapital = parseFloat(follow.initialCapital);
    const pnlPercent = initialCapital > 0 ? ((portfolioValue - initialCapital) / initialCapital) * 100 : 0;

    // Update follower record
    await db
      .update(copyFollowers)
      .set({
        currentCash: String(currentCash),
        portfolioValue: String(portfolioValue),
        totalPnl: String(portfolioValue - initialCapital),
        totalPnlPercent: String(pnlPercent),
        tradesCopied,
        positions: positions,
        updatedAt: new Date(),
      })
      .where(eq(copyFollowers.id, follow.id));

    syncResults.push({
      agentId: follow.targetAgentId,
      agentName,
      newDecisions: newDecisions.length,
      tradesCopied: countByCondition(newDecisions, (d: AgentDecision) => d.action !== "hold"),
    });
  }

  return c.json({
    message: "Sync complete",
    followerId,
    results: syncResults,
    totalNewDecisions: syncResults.reduce((s, r) => s + r.newDecisions, 0),
    totalTradesCopied: syncResults.reduce((s, r) => s + r.tradesCopied, 0),
  });
});

// ---------------------------------------------------------------------------
// GET /copy/leaderboard — Top copy traders
// ---------------------------------------------------------------------------

copyTradingRoutes.get("/leaderboard", async (c) => {
  const limitStr = c.req.query("limit");

  let limit = 20;
  if (limitStr) {
    const parsed = parseInt(limitStr, 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = clamp(parsed, 1, 100);
    }
  }

  try {
    const followers = await db
      .select()
      .from(copyFollowers)
      .orderBy(desc(sql`CAST(${copyFollowers.portfolioValue} AS NUMERIC)`))
      .limit(limit);

    const leaderboard = followers.map((f: CopyFollower, i: number) => {
      const config = getAgentConfig(f.targetAgentId);
      return {
        rank: i + 1,
        followerId: f.followerId,
        followerName: f.followerName,
        targetAgentId: f.targetAgentId,
        targetAgentName: config?.name ?? f.targetAgentId,
        initialCapital: parseFloat(f.initialCapital),
        portfolioValue: parseFloat(f.portfolioValue),
        totalPnl: parseFloat(f.totalPnl),
        totalPnlPercent: parseFloat(f.totalPnlPercent),
        tradesCopied: f.tradesCopied,
        followingSince: f.createdAt,
      };
    });

    return c.json({
      leaderboard: {
        title: "Copy Trading Leaderboard",
        subtitle: "Top performers following AI trading agents",
        entries: leaderboard,
        total: leaderboard.length,
      },
    });
  } catch (error) {
    console.error("[CopyTrading] Leaderboard failed:", error);
    return c.json({ error: "internal_error", code: "internal_error", details: "Failed to load leaderboard" }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /copy/agents/:agentId/followers — Agent's followers
// ---------------------------------------------------------------------------

copyTradingRoutes.get("/agents/:agentId/followers", async (c) => {
  const agentId = c.req.param("agentId");
  const config = getAgentConfig(agentId);

  if (!config) {
    return c.json({ error: "agent_not_found", code: "agent_not_found", details: `Agent "${agentId}" not found` }, 404);
  }

  try {
    const followers = await db
      .select()
      .from(copyFollowers)
      .where(eq(copyFollowers.targetAgentId, agentId))
      .orderBy(desc(sql`CAST(${copyFollowers.portfolioValue} AS NUMERIC)`));

    return c.json({
      agentId,
      agentName: config.name,
      followerCount: followers.length,
      followers: followers.map((f: typeof followers[0]) => ({
        followerId: f.followerId,
        followerName: f.followerName,
        initialCapital: parseFloat(f.initialCapital),
        portfolioValue: parseFloat(f.portfolioValue),
        totalPnl: parseFloat(f.totalPnl),
        totalPnlPercent: parseFloat(f.totalPnlPercent),
        tradesCopied: f.tradesCopied,
        isActive: f.isActive === "true",
        followingSince: f.createdAt,
      })),
      aggregateStats: {
        totalFollowers: followers.length,
        activeFollowers: countByCondition(followers, (f: typeof followers[0]) => f.isActive === "true"),
        totalCopiedCapital: followers.reduce((s: number, f: typeof followers[0]) => s + parseFloat(f.initialCapital), 0),
        avgFollowerPnl: followers.length > 0
          ? round2(
              followers.reduce((s: number, f: typeof followers[0]) => s + parseFloat(f.totalPnlPercent), 0) / followers.length,
            )
          : 0,
      },
    });
  } catch (error) {
    console.error(`[CopyTrading] Followers failed for ${agentId}:`, error);
    return c.json({ error: "internal_error", code: "internal_error", details: "Failed to load followers" }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /copy/stats — Platform-wide copy trading stats
// ---------------------------------------------------------------------------

copyTradingRoutes.get("/stats", async (c) => {
  try {
    // Total followers
    const followerCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(copyFollowers);

    // Total copied trades
    const tradeCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(copyTrades);

    // Total capital under copy management
    const capitalResult = await db
      .select({ total: sql<number>`COALESCE(SUM(CAST(${copyFollowers.initialCapital} AS NUMERIC)), 0)` })
      .from(copyFollowers);

    // Most followed agent
    const agentFollowCounts = await db
      .select({
        agentId: copyFollowers.targetAgentId,
        count: sql<number>`count(*)`,
      })
      .from(copyFollowers)
      .groupBy(copyFollowers.targetAgentId)
      .orderBy(desc(sql`count(*)`))
      .limit(1);

    const mostFollowed = agentFollowCounts[0];
    const mostFollowedConfig = mostFollowed ? getAgentConfig(mostFollowed.agentId) : null;

    // Best performing copy portfolio
    const bestPortfolio = await db
      .select()
      .from(copyFollowers)
      .orderBy(desc(sql`CAST(${copyFollowers.totalPnlPercent} AS NUMERIC)`))
      .limit(1);

    return c.json({
      stats: {
        title: "Copy Trading Platform Statistics",
        totalFollowers: Number(followerCount[0]?.count ?? 0),
        totalCopiedTrades: Number(tradeCount[0]?.count ?? 0),
        totalCopiedCapital: Number(capitalResult[0]?.total ?? 0),
        mostFollowedAgent: mostFollowedConfig
          ? {
              agentId: mostFollowed!.agentId,
              agentName: mostFollowedConfig.name,
              followerCount: Number(mostFollowed!.count),
            }
          : null,
        bestPerformer: bestPortfolio[0]
          ? {
              followerId: bestPortfolio[0].followerId,
              followerName: bestPortfolio[0].followerName,
              pnlPercent: parseFloat(bestPortfolio[0].totalPnlPercent),
            }
          : null,
        perAgent: getAgentConfigs().map((config) => {
          const followers = agentFollowCounts.find((a: typeof agentFollowCounts[0]) => a.agentId === config.agentId);
          return {
            agentId: config.agentId,
            agentName: config.name,
            followerCount: Number(followers?.count ?? 0),
          };
        }),
      },
    });
  } catch (error) {
    console.error("[CopyTrading] Stats failed:", error);
    return c.json({ error: "internal_error", code: "internal_error", details: "Failed to compute stats" }, 500);
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatFollower(f: typeof copyFollowers.$inferSelect) {
  return {
    id: f.id,
    followerId: f.followerId,
    followerName: f.followerName,
    targetAgentId: f.targetAgentId,
    initialCapital: parseFloat(f.initialCapital),
    currentCash: parseFloat(f.currentCash),
    portfolioValue: parseFloat(f.portfolioValue),
    totalPnl: parseFloat(f.totalPnl),
    totalPnlPercent: parseFloat(f.totalPnlPercent),
    tradesCopied: f.tradesCopied,
    isActive: f.isActive === "true",
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  };
}
