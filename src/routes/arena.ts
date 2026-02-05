/**
 * Agent Arena Routes
 *
 * The competitive arena where all 3 AI trading agents face off. Provides
 * overview rankings, head-to-head comparisons, battle simulations, and
 * a beautiful web dashboard for spectators.
 *
 * Routes:
 *   GET  /api/v1/arena                     — Arena overview with rankings
 *   GET  /api/v1/arena/compare/:a1/:a2     — Head-to-head agent comparison
 *   POST /api/v1/arena/simulate            — Simulate a trading round
 *   GET  /api/v1/arena/history             — Recent trading round history
 *   GET  /api/v1/arena/leaderboard         — Detailed performance leaderboard
 *   GET  /api/v1/arena/consensus           — What are agents agreeing/disagreeing on
 */

import { Hono } from "hono";
import { z } from "zod";
import { getArenaOverview, compareAgents } from "../services/analytics.ts";
import {
  getAgentConfigs,
  getAgentConfig,
  getMarketData,
  getPortfolioContext,
  runTradingRound,
  getAgentStats,
} from "../agents/orchestrator.ts";
import { db } from "../db/index.ts";
import { agentDecisions } from "../db/schema/agent-decisions.ts";
import { desc, eq, sql, and } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const arenaRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET /arena — Full arena overview with all 3 agents ranked
// ---------------------------------------------------------------------------

arenaRoutes.get("/", async (c) => {
  try {
    const overview = await getArenaOverview();

    return c.json({
      arena: {
        title: "MoltApp Agent Arena",
        subtitle: "3 AI agents compete 24/7 on real tokenized stocks",
        ...overview,
      },
    });
  } catch (error) {
    console.error("[Arena] Failed to get overview:", error);
    return c.json(
      {
        error: "internal_error",
        code: "internal_error",
        details: "Failed to compute arena overview",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /arena/compare/:agent1/:agent2 — Head-to-head comparison
// ---------------------------------------------------------------------------

arenaRoutes.get("/compare/:agent1/:agent2", async (c) => {
  const agent1 = c.req.param("agent1");
  const agent2 = c.req.param("agent2");

  if (agent1 === agent2) {
    return c.json(
      {
        error: "validation_failed",
        code: "validation_failed",
        details: "Cannot compare an agent with itself",
      },
      400,
    );
  }

  const config1 = getAgentConfig(agent1);
  const config2 = getAgentConfig(agent2);

  if (!config1) {
    return c.json({ error: "agent_not_found", code: "agent_not_found", details: `Agent "${agent1}" not found` }, 404);
  }
  if (!config2) {
    return c.json({ error: "agent_not_found", code: "agent_not_found", details: `Agent "${agent2}" not found` }, 404);
  }

  try {
    const comparison = await compareAgents(agent1, agent2);
    if (!comparison) {
      return c.json({ error: "comparison_failed", code: "comparison_failed", details: "Unable to compare agents" }, 500);
    }

    return c.json({
      comparison: {
        title: `${config1.name} vs ${config2.name}`,
        ...comparison,
      },
    });
  } catch (error) {
    console.error("[Arena] Comparison failed:", error);
    return c.json({ error: "internal_error", code: "internal_error", details: "Failed to compare agents" }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /arena/simulate — Simulate a trading round (admin only)
// ---------------------------------------------------------------------------

arenaRoutes.post("/simulate", async (c) => {
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

  try {
    const result = await runTradingRound();

    return c.json({
      simulation: {
        title: "Trading Round Simulation",
        roundId: result.roundId,
        timestamp: result.timestamp,
        agents: result.results.map((r) => ({
          agentId: r.agentId,
          agentName: r.agentName,
          decision: {
            action: r.decision.action,
            symbol: r.decision.symbol,
            quantity: r.decision.quantity,
            confidence: r.decision.confidence,
            reasoning: r.decision.reasoning,
          },
          executed: r.executed,
          executionError: r.executionError,
        })),
        errors: result.errors,
        summary: {
          totalAgents: result.results.length,
          buyCount: result.results.filter((r) => r.decision.action === "buy").length,
          sellCount: result.results.filter((r) => r.decision.action === "sell").length,
          holdCount: result.results.filter((r) => r.decision.action === "hold").length,
          avgConfidence: result.results.length > 0
            ? Math.round(
                (result.results.reduce((s, r) => s + r.decision.confidence, 0) /
                  result.results.length) *
                  10,
              ) / 10
            : 0,
          consensus:
            result.results.length >= 2 &&
            result.results.every((r) => r.decision.action === result.results[0].decision.action),
        },
      },
    });
  } catch (error) {
    console.error("[Arena] Simulation failed:", error);
    return c.json({ error: "internal_error", code: "internal_error", details: "Simulation failed" }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /arena/history — Recent trading round history
// ---------------------------------------------------------------------------

arenaRoutes.get("/history", async (c) => {
  const limitStr = c.req.query("limit");

  let limit = 20;
  if (limitStr) {
    const parsed = parseInt(limitStr, 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = Math.min(100, Math.max(1, parsed));
    }
  }

  try {
    // Get recent decisions grouped by round
    const decisions = await db
      .select()
      .from(agentDecisions)
      .orderBy(desc(agentDecisions.createdAt))
      .limit(limit * 3); // 3 agents per round

    // Group by round
    type RoundDecision = {
      agentId: string;
      agentName: string;
      action: string;
      symbol: string;
      quantity: string;
      confidence: number;
      reasoning: string;
      modelUsed: string;
    };

    type RoundEntry = {
      roundId: string;
      timestamp: Date;
      decisions: RoundDecision[];
    };

    const roundMap = new Map<string, RoundEntry>();

    for (const d of decisions) {
      const key = d.roundId ?? `solo_${d.id}`;
      const entry: RoundEntry = roundMap.get(key) ?? {
        roundId: key,
        timestamp: d.createdAt,
        decisions: [],
      };

      const config = getAgentConfig(d.agentId);
      entry.decisions.push({
        agentId: d.agentId,
        agentName: config?.name ?? d.agentId,
        action: d.action,
        symbol: d.symbol,
        quantity: d.quantity,
        confidence: d.confidence,
        reasoning: d.reasoning,
        modelUsed: d.modelUsed,
      });
      roundMap.set(key, entry);
    }

    const rounds = Array.from(roundMap.values())
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit)
      .map((round) => ({
        ...round,
        consensus: round.decisions.length >= 2 &&
          round.decisions.every((d) => d.action === round.decisions[0].action),
        avgConfidence: round.decisions.length > 0
          ? Math.round(
              (round.decisions.reduce((s, d) => s + d.confidence, 0) / round.decisions.length) * 10,
            ) / 10
          : 0,
      }));

    return c.json({
      history: {
        rounds,
        total: roundMap.size,
        limit,
      },
    });
  } catch (error) {
    console.error("[Arena] Failed to get history:", error);
    return c.json({ error: "internal_error", code: "internal_error", details: "Failed to load history" }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /arena/leaderboard — Detailed performance leaderboard
// ---------------------------------------------------------------------------

arenaRoutes.get("/leaderboard", async (c) => {
  try {
    const configs = getAgentConfigs();
    const marketData = await getMarketData();

    const entries = await Promise.all(
      configs.map(async (config) => {
        const [stats, portfolio] = await Promise.all([
          getAgentStats(config.agentId),
          getPortfolioContext(config.agentId, marketData),
        ]);

        return {
          agentId: config.agentId,
          agentName: config.name,
          provider: config.provider,
          model: config.model,
          riskTolerance: config.riskTolerance,
          tradingStyle: config.tradingStyle,
          performance: {
            totalDecisions: stats.totalDecisions,
            buyCount: stats.buyCount,
            sellCount: stats.sellCount,
            holdCount: stats.holdCount,
            averageConfidence: stats.averageConfidence,
            favoriteStock: stats.favoriteStock,
          },
          portfolio: {
            cashBalance: portfolio.cashBalance,
            totalValue: portfolio.totalValue,
            totalPnl: portfolio.totalPnl,
            totalPnlPercent: portfolio.totalPnlPercent,
            positionCount: portfolio.positions.length,
          },
          lastActivity: stats.lastDecision
            ? {
                action: stats.lastDecision.action,
                symbol: stats.lastDecision.symbol,
                confidence: stats.lastDecision.confidence,
                timestamp: stats.lastDecision.createdAt,
              }
            : null,
        };
      }),
    );

    // Sort by portfolio value
    entries.sort((a, b) => b.portfolio.totalValue - a.portfolio.totalValue);
    const ranked = entries.map((e, i) => ({ rank: i + 1, ...e }));

    return c.json({
      leaderboard: {
        title: "Agent Performance Leaderboard",
        updatedAt: new Date().toISOString(),
        agents: ranked,
      },
    });
  } catch (error) {
    console.error("[Arena] Failed to get leaderboard:", error);
    return c.json({ error: "internal_error", code: "internal_error", details: "Failed to compute leaderboard" }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /arena/consensus — What are agents agreeing/disagreeing on
// ---------------------------------------------------------------------------

arenaRoutes.get("/consensus", async (c) => {
  try {
    const configs = getAgentConfigs();

    // Get latest decision from each agent
    const latestDecisions = await Promise.all(
      configs.map(async (config) => {
        const latest = await db
          .select()
          .from(agentDecisions)
          .where(eq(agentDecisions.agentId, config.agentId))
          .orderBy(desc(agentDecisions.createdAt))
          .limit(1);

        return {
          agentId: config.agentId,
          agentName: config.name,
          provider: config.provider,
          decision: latest[0] ?? null,
        };
      }),
    );

    // Find agreement/disagreement
    const validDecisions = latestDecisions.filter((d) => d.decision !== null);
    const actions = validDecisions.map((d) => d.decision!.action);
    const uniqueActions = new Set(actions);

    const consensus = {
      isConsensus: uniqueActions.size === 1 && validDecisions.length >= 2,
      consensusAction: uniqueActions.size === 1 ? actions[0] : null,
      agentPositions: latestDecisions.map((d) => ({
        agentId: d.agentId,
        agentName: d.agentName,
        provider: d.provider,
        action: d.decision?.action ?? "no_data",
        symbol: d.decision?.symbol ?? "N/A",
        confidence: d.decision?.confidence ?? 0,
        reasoning: d.decision?.reasoning ?? "No recent decision",
        timestamp: d.decision?.createdAt ?? null,
      })),
      disagreements: [] as Array<{
        agent1: string;
        agent2: string;
        agent1Action: string;
        agent2Action: string;
        conflictLevel: "high" | "medium" | "low";
      }>,
    };

    // Find pairwise disagreements
    for (let i = 0; i < validDecisions.length; i++) {
      for (let j = i + 1; j < validDecisions.length; j++) {
        const d1 = validDecisions[i];
        const d2 = validDecisions[j];
        if (d1.decision!.action !== d2.decision!.action) {
          const isBuySell =
            (d1.decision!.action === "buy" && d2.decision!.action === "sell") ||
            (d1.decision!.action === "sell" && d2.decision!.action === "buy");

          consensus.disagreements.push({
            agent1: d1.agentName,
            agent2: d2.agentName,
            agent1Action: d1.decision!.action,
            agent2Action: d2.decision!.action,
            conflictLevel: isBuySell ? "high" : "medium",
          });
        }
      }
    }

    return c.json({ consensus });
  } catch (error) {
    console.error("[Arena] Failed to get consensus:", error);
    return c.json({ error: "internal_error", code: "internal_error", details: "Failed to compute consensus" }, 500);
  }
});
