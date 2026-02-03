/**
 * Risk-Adjusted Leaderboard API Routes
 *
 * Ranks agents by risk-adjusted returns (Sharpe, Sortino, etc.)
 * rather than raw P&L. The "smart" leaderboard for serious traders.
 */

import { Hono } from "hono";
import {
  getRiskAdjustedLeaderboard,
  refreshRiskAdjustedLeaderboard,
  getAgentRiskDetail,
} from "../services/risk-adjusted-leaderboard.ts";

export const riskLeaderboardRoutes = new Hono();

/**
 * GET / — Full risk-adjusted leaderboard
 */
riskLeaderboardRoutes.get("/", (c) => {
  const leaderboard = getRiskAdjustedLeaderboard();
  return c.json({
    ok: true,
    leaderboard,
  });
});

/**
 * GET /rankings — Just the ranked entries (lighter payload)
 */
riskLeaderboardRoutes.get("/rankings", (c) => {
  const leaderboard = getRiskAdjustedLeaderboard();
  return c.json({
    ok: true,
    rankings: leaderboard.entries.map((e) => ({
      rank: e.rank,
      agentId: e.agentId,
      agentName: e.agentName,
      tier: e.tier,
      compositeScore: e.compositeScore,
      totalReturn: e.totalReturnPercent,
      sharpe: e.riskMetrics.sharpeRatio,
      sortino: e.riskMetrics.sortinoRatio,
      maxDrawdown: e.riskMetrics.maxDrawdownPercent,
      winRate: e.riskMetrics.winRate,
      tradeCount: e.tradeCount,
    })),
    methodology: leaderboard.methodology,
    computedAt: leaderboard.computedAt,
  });
});

/**
 * GET /agent/:agentId — Detailed risk analysis for a specific agent
 */
riskLeaderboardRoutes.get("/agent/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const detail = getAgentRiskDetail(agentId);

  if (!detail.entry) {
    return c.json(
      { ok: false, error: `No risk data found for agent ${agentId}` },
      404,
    );
  }

  return c.json({
    ok: true,
    ...detail,
  });
});

/**
 * POST /refresh — Force refresh the leaderboard (bypass cache)
 */
riskLeaderboardRoutes.post("/refresh", (c) => {
  const leaderboard = refreshRiskAdjustedLeaderboard();
  return c.json({
    ok: true,
    message: "Leaderboard refreshed",
    entryCount: leaderboard.entries.length,
    computedAt: leaderboard.computedAt,
  });
});

/**
 * GET /methodology — Explain the scoring methodology
 */
riskLeaderboardRoutes.get("/methodology", (c) => {
  return c.json({
    ok: true,
    methodology: {
      description:
        "Agents are ranked by a composite score that rewards risk-adjusted returns " +
        "rather than raw P&L. An agent earning steady 10% with minimal drawdowns " +
        "ranks higher than one earning volatile 25% with 40% drawdowns.",
      weights: {
        sharpeRatio: "35% — Excess return per unit of total risk",
        totalReturn: "25% — Raw cumulative return percentage",
        sortinoRatio: "20% — Excess return per unit of downside risk",
        winRate: "10% — Percentage of profitable trades",
        maxDrawdownPenalty: "10% — Penalty for large peak-to-trough declines",
      },
      tiers: {
        S: "Composite score >= 80: Elite risk-adjusted performance",
        A: "Composite score >= 60: Strong risk-adjusted performance",
        B: "Composite score >= 40: Average performance",
        C: "Composite score >= 20: Below average",
        D: "Composite score < 20: Poor risk management",
      },
      parameters: {
        riskFreeRate: "4.5% annualized (US Treasury approximation)",
        annualizationFactor: "252 trading days per year",
        minimumDataPoints: "2 daily returns required for risk calculation",
      },
    },
  });
});
