/**
 * AI Agent Routes
 *
 * Public API endpoints for viewing AI trading agent profiles, stats,
 * trade history, and portfolios. These are the core endpoints that
 * power the MoltApp agent competition dashboard.
 *
 * All routes are PUBLIC (no auth required) — anyone can view agent activity.
 *
 * Routes:
 *   GET  /api/v1/agents                    — List all 3 AI agents with stats
 *   GET  /api/v1/agents/:agentId           — Agent profile with detailed stats
 *   GET  /api/v1/agents/:agentId/trades    — Agent's trade/decision history
 *   GET  /api/v1/agents/:agentId/portfolio — Agent's current positions
 *   POST /api/v1/agents/run-round          — Trigger a trading round (admin)
 */

import { Hono } from "hono";
import {
  getAgentConfigs,
  getAgentConfig,
  getAgentStats,
  getAgentTradeHistory,
  getAgentPortfolio,
  runTradingRound,
} from "../agents/orchestrator.ts";
import { agentDecisions } from "../db/schema/agent-decisions.ts";
import { getAllOnChainPortfolios } from "../services/onchain-portfolio.ts";
import { apiError, errorMessage } from "../lib/errors.ts";
import { clamp } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const agentRoutes = new Hono();

// ---------------------------------------------------------------------------
// Pagination Constants
// ---------------------------------------------------------------------------

/**
 * Default number of trades returned per page when no `limit` query param is provided.
 * Balances response size with usefulness — 20 decisions covers ~1 full trading round.
 */
const DEFAULT_TRADES_PAGE_SIZE = 20;

/**
 * Minimum value for the `limit` query parameter.
 * Prevents clients from requesting 0 results (which would be useless).
 */
const MIN_TRADES_PAGE_SIZE = 1;

/**
 * Maximum value for the `limit` query parameter.
 * Caps response size to prevent excessive database queries and large payloads.
 * 100 decisions covers ~5 full trading rounds of history.
 */
const MAX_TRADES_PAGE_SIZE = 100;

// ---------------------------------------------------------------------------
// GET /agents — List all AI agents with summary stats
// ---------------------------------------------------------------------------

agentRoutes.get("/", async (c) => {
  const configs = getAgentConfigs();

  // Fetch stats for all agents in parallel
  const statsPromises = configs.map(async (config) => {
    const stats = await getAgentStats(config.agentId);
    return {
      agentId: config.agentId,
      name: config.name,
      model: config.model,
      provider: config.provider,
      description: config.description,
      riskTolerance: config.riskTolerance,
      tradingStyle: config.tradingStyle,
      stats: {
        totalDecisions: stats.totalDecisions,
        buyCount: stats.buyCount,
        sellCount: stats.sellCount,
        holdCount: stats.holdCount,
        averageConfidence: stats.averageConfidence,
        favoriteStock: stats.favoriteStock,
      },
    };
  });

  const agents = await Promise.all(statsPromises);

  return c.json({
    agents,
    count: agents.length,
    description:
      "3 AI trading agents competing 24/7 on MoltApp. Each has a unique LLM backend, personality, and trading strategy.",
  });
});

// ---------------------------------------------------------------------------
// GET /agents/:agentId — Detailed agent profile
// ---------------------------------------------------------------------------

agentRoutes.get("/:agentId", async (c) => {
  const agentId = c.req.param("agentId");
  const config = getAgentConfig(agentId);

  if (!config) {
    return apiError(c, "AGENT_NOT_FOUND", `No agent with ID "${agentId}". Valid IDs: claude-value-investor, gpt-momentum-trader, grok-contrarian`);
  }

  const [stats, portfolio] = await Promise.all([
    getAgentStats(agentId),
    getAgentPortfolio(agentId),
  ]);

  return c.json({
    agent: {
      ...config,
      stats: {
        totalDecisions: stats.totalDecisions,
        buyCount: stats.buyCount,
        sellCount: stats.sellCount,
        holdCount: stats.holdCount,
        averageConfidence: stats.averageConfidence,
        favoriteStock: stats.favoriteStock,
        lastDecision: stats.lastDecision
          ? {
              action: stats.lastDecision.action,
              symbol: stats.lastDecision.symbol,
              confidence: stats.lastDecision.confidence,
              reasoning: stats.lastDecision.reasoning,
              timestamp: stats.lastDecision.createdAt,
            }
          : null,
      },
      portfolio: {
        cashBalance: portfolio.cashBalance,
        totalValue: portfolio.totalValue,
        totalPnl: portfolio.totalPnl,
        totalPnlPercent: portfolio.totalPnlPercent,
        positionCount: portfolio.positions.length,
        positions: portfolio.positions.map((p) => ({
          symbol: p.symbol,
          quantity: p.quantity,
          averageCostBasis: p.averageCostBasis,
          currentPrice: p.currentPrice,
          unrealizedPnl: p.unrealizedPnl,
          unrealizedPnlPercent: p.unrealizedPnlPercent,
        })),
      },
    },
  });
});

// ---------------------------------------------------------------------------
// GET /agents/:agentId/trades — Agent's decision/trade history
// ---------------------------------------------------------------------------

agentRoutes.get("/:agentId/trades", async (c) => {
  const agentId = c.req.param("agentId");
  const config = getAgentConfig(agentId);

  if (!config) {
    return apiError(c, "AGENT_NOT_FOUND", `No agent with ID "${agentId}"`);
  }

  const limitStr = c.req.query("limit");
  const offsetStr = c.req.query("offset");

  // Safely parse limit with NaN check to prevent database query errors
  let limit = DEFAULT_TRADES_PAGE_SIZE;
  if (limitStr) {
    const parsed = parseInt(limitStr, 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = clamp(parsed, MIN_TRADES_PAGE_SIZE, MAX_TRADES_PAGE_SIZE);
    }
  }

  // Safely parse offset with NaN check
  let offset = 0;
  if (offsetStr) {
    const parsed = parseInt(offsetStr, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      offset = parsed;
    }
  }

  const history = await getAgentTradeHistory(agentId, limit, offset);

  return c.json({
    agentId,
    agentName: config.name,
    trades: history.decisions.map((d: typeof agentDecisions.$inferSelect) => ({
      id: d.id,
      action: d.action,
      symbol: d.symbol,
      quantity: d.quantity,
      reasoning: d.reasoning,
      confidence: d.confidence,
      modelUsed: d.modelUsed,
      executed: d.executed,
      timestamp: d.createdAt,
    })),
    total: history.total,
    limit: history.limit,
    offset: history.offset,
  });
});

// ---------------------------------------------------------------------------
// GET /agents/:agentId/portfolio — Agent's current positions
// ---------------------------------------------------------------------------

agentRoutes.get("/:agentId/portfolio", async (c) => {
  const agentId = c.req.param("agentId");
  const config = getAgentConfig(agentId);

  if (!config) {
    return apiError(c, "AGENT_NOT_FOUND", `No agent with ID "${agentId}"`);
  }

  const portfolio = await getAgentPortfolio(agentId);

  return c.json({
    agentId,
    agentName: config.name,
    portfolio: {
      cashBalance: portfolio.cashBalance,
      totalValue: portfolio.totalValue,
      totalPnl: portfolio.totalPnl,
      totalPnlPercent: portfolio.totalPnlPercent,
      positions: portfolio.positions.map((p) => ({
        symbol: p.symbol,
        quantity: p.quantity,
        averageCostBasis: p.averageCostBasis,
        currentPrice: p.currentPrice,
        marketValue: p.currentPrice * p.quantity,
        unrealizedPnl: p.unrealizedPnl,
        unrealizedPnlPercent: p.unrealizedPnlPercent,
      })),
    },
  });
});

// ---------------------------------------------------------------------------
// GET /agents/portfolios/on-chain — All agent portfolios from Solana blockchain
// ---------------------------------------------------------------------------

agentRoutes.get("/portfolios/on-chain", async (c) => {
  try {
    const portfolios = await getAllOnChainPortfolios();

    return c.json({
      portfolios: portfolios.map((p) => ({
        agentId: p.agentId,
        agentName: p.agentName,
        walletAddress: p.walletAddress,
        cashBalance: p.cashBalance,
        positions: p.positions.map((pos) => ({
          symbol: pos.symbol,
          name: pos.name,
          quantity: pos.quantity,
          currentPrice: pos.currentPrice,
          value: pos.value,
          averageCostBasis: pos.averageCostBasis,
          unrealizedPnl: pos.unrealizedPnl,
          unrealizedPnlPercent: pos.unrealizedPnlPercent,
        })),
        totalValue: p.totalValue,
        totalPnl: p.totalPnl,
        totalPnlPercent: p.totalPnlPercent,
        initialCapital: p.initialCapital,
        lastSyncedAt: p.lastSyncedAt,
        source: p.source,
      })),
      count: portfolios.length,
      syncedAt: new Date().toISOString(),
      description: "On-chain portfolios read directly from Solana blockchain — source of truth for agent holdings.",
    });
  } catch (error) {
    console.error("[API] Failed to get on-chain portfolios:", error);
    return apiError(c, "ON_CHAIN_FETCH_FAILED", errorMessage(error));
  }
});

// ---------------------------------------------------------------------------
// POST /agents/run-round — Manually trigger a trading round (admin only)
// ---------------------------------------------------------------------------

agentRoutes.post("/run-round", async (c) => {
  // Simple admin auth: require ADMIN_PASSWORD header
  const adminPassword = c.req.header("X-Admin-Password");
  const expectedPassword = process.env.ADMIN_PASSWORD;

  if (!expectedPassword || adminPassword !== expectedPassword) {
    return c.json(
      {
        error: "unauthorized",
        code: "unauthorized",
        details: "Admin password required. Set X-Admin-Password header.",
      },
      401,
    );
  }

  const result = await runTradingRound();

  return c.json({
    message: "Trading round complete",
    roundId: result.roundId,
    timestamp: result.timestamp,
    results: result.results.map((r) => ({
      agentId: r.agentId,
      agentName: r.agentName,
      action: r.decision.action,
      symbol: r.decision.symbol,
      quantity: r.decision.quantity,
      confidence: r.decision.confidence,
      reasoning: r.decision.reasoning,
      executed: r.executed,
      executionError: r.executionError,
    })),
    errors: result.errors,
  });
});
