/**
 * Agent Insights Routes
 *
 * Deep-dive analytics for individual AI trading agents. Provides advanced
 * performance metrics, trading pattern detection, sentiment analysis,
 * risk assessment, and sector allocation breakdowns.
 *
 * Routes:
 *   GET /api/v1/insights/:agentId              — Full analytics for an agent
 *   GET /api/v1/insights/:agentId/risk         — Risk metrics (Sharpe, drawdown, etc.)
 *   GET /api/v1/insights/:agentId/patterns     — Trading pattern analysis
 *   GET /api/v1/insights/:agentId/sectors      — Sector allocation breakdown
 *   GET /api/v1/insights/:agentId/streaks      — Win/loss streak analysis
 *   GET /api/v1/insights/:agentId/sentiment    — Bullish/bearish sentiment profile
 *   GET /api/v1/insights/:agentId/activity      — Hourly activity heatmap data
 *   GET /api/v1/insights/compare-all           — Side-by-side all 3 agents
 */

import { Hono } from "hono";
import {
  getAgentAnalytics,
  getArenaOverview,
  type AnalyticsPeriod,
} from "../services/analytics.ts";
import { getAgentConfig, getAgentConfigs } from "../agents/orchestrator.ts";

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const insightsRoutes = new Hono();

// ---------------------------------------------------------------------------
// Helper: Parse period from query string
// ---------------------------------------------------------------------------

function parsePeriod(query: string | undefined): AnalyticsPeriod {
  if (query === "24h" || query === "7d" || query === "30d" || query === "all") {
    return query;
  }
  return "all";
}

// ---------------------------------------------------------------------------
// GET /insights/compare-all — Side-by-side comparison of all 3 agents
// (Must be before /:agentId to avoid route conflict)
// ---------------------------------------------------------------------------

insightsRoutes.get("/compare-all", async (c) => {
  const period = parsePeriod(c.req.query("period"));

  try {
    const configs = getAgentConfigs();
    const analyticsPromises = configs.map((config) =>
      getAgentAnalytics(config.agentId, period),
    );

    const results = await Promise.all(analyticsPromises);
    const validResults = results.filter((r) => r !== null);

    // Build comparison table
    const comparison = validResults.map((analytics) => ({
      agentId: analytics.agentId,
      agentName: analytics.agentName,
      provider: analytics.provider,
      performance: {
        totalDecisions: analytics.performance.totalDecisions,
        winRate: analytics.performance.winRate,
        avgConfidence: analytics.performance.avgConfidence,
        profitFactor: analytics.performance.profitFactor,
        totalPnl: analytics.performance.totalPnl,
        totalPnlPercent: analytics.performance.totalPnlPercent,
      },
      risk: {
        sharpeRatio: analytics.riskMetrics.sharpeRatio,
        sortinoRatio: analytics.riskMetrics.sortinoRatio,
        maxDrawdown: analytics.riskMetrics.maxDrawdownPercent,
        volatility: analytics.riskMetrics.volatility,
        valueAtRisk95: analytics.riskMetrics.valueAtRisk95,
      },
      patterns: {
        preferredAction: analytics.tradingPatterns.preferredAction,
        tradeFrequency: analytics.tradingPatterns.tradeFrequency,
        symbolDiversity: analytics.tradingPatterns.symbolDiversity,
        reversalRate: analytics.tradingPatterns.reversalRate,
        mostTradedSymbol: analytics.tradingPatterns.mostTradedSymbol,
      },
      sentiment: analytics.sentimentProfile,
      streaks: {
        currentStreak: analytics.streaks.currentStreak,
        longestWinStreak: analytics.streaks.longestWinStreak,
        longestLossStreak: analytics.streaks.longestLossStreak,
      },
      social: analytics.socialMetrics,
      topSectors: analytics.sectorAllocation.slice(0, 3).map((s) => ({
        sector: s.sector,
        allocation: s.allocation,
      })),
    }));

    // Determine leader in each category
    const leaders = {
      winRate: findLeader(comparison, (a) => a.performance.winRate),
      confidence: findLeader(comparison, (a) => a.performance.avgConfidence),
      sharpeRatio: findLeader(comparison, (a) => a.risk.sharpeRatio),
      diversity: findLeader(comparison, (a) => a.patterns.symbolDiversity),
      social: findLeader(comparison, (a) => a.social.totalReactions + a.social.totalComments),
      consistency: findLeader(comparison, (a) => a.sentiment.sentimentConsistency),
    };

    return c.json({
      comparison: {
        period,
        agents: comparison,
        leaders,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("[Insights] Compare-all failed:", error);
    return c.json(
      { error: "internal_error", code: "internal_error", details: "Failed to compare agents" },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /insights/:agentId — Full analytics for a single agent
// ---------------------------------------------------------------------------

insightsRoutes.get("/:agentId", async (c) => {
  const agentId = c.req.param("agentId");
  const period = parsePeriod(c.req.query("period"));

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

  try {
    const analytics = await getAgentAnalytics(agentId, period);
    if (!analytics) {
      return c.json({ error: "analytics_failed", code: "analytics_failed", details: "Failed to compute analytics" }, 500);
    }

    return c.json({
      insights: {
        ...analytics,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`[Insights] Failed for ${agentId}:`, error);
    return c.json({ error: "internal_error", code: "internal_error", details: "Failed to compute insights" }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /insights/:agentId/risk — Risk metrics only
// ---------------------------------------------------------------------------

insightsRoutes.get("/:agentId/risk", async (c) => {
  const agentId = c.req.param("agentId");
  const period = parsePeriod(c.req.query("period"));

  const config = getAgentConfig(agentId);
  if (!config) {
    return c.json({ error: "agent_not_found", code: "agent_not_found", details: `Agent "${agentId}" not found` }, 404);
  }

  try {
    const analytics = await getAgentAnalytics(agentId, period);
    if (!analytics) {
      return c.json({ error: "analytics_failed", code: "analytics_failed", details: "Failed to compute analytics" }, 500);
    }

    return c.json({
      agentId,
      agentName: config.name,
      period,
      riskMetrics: analytics.riskMetrics,
      interpretation: interpretRisk(analytics.riskMetrics),
    });
  } catch (error) {
    console.error(`[Insights] Risk failed for ${agentId}:`, error);
    return c.json({ error: "internal_error", code: "internal_error", details: "Failed to compute risk metrics" }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /insights/:agentId/patterns — Trading patterns analysis
// ---------------------------------------------------------------------------

insightsRoutes.get("/:agentId/patterns", async (c) => {
  const agentId = c.req.param("agentId");
  const period = parsePeriod(c.req.query("period"));

  const config = getAgentConfig(agentId);
  if (!config) {
    return c.json({ error: "agent_not_found", code: "agent_not_found", details: `Agent "${agentId}" not found` }, 404);
  }

  try {
    const analytics = await getAgentAnalytics(agentId, period);
    if (!analytics) {
      return c.json({ error: "analytics_failed", code: "analytics_failed", details: "Failed to compute analytics" }, 500);
    }

    return c.json({
      agentId,
      agentName: config.name,
      period,
      patterns: analytics.tradingPatterns,
      interpretation: interpretPatterns(analytics.tradingPatterns),
    });
  } catch (error) {
    console.error(`[Insights] Patterns failed for ${agentId}:`, error);
    return c.json({ error: "internal_error", code: "internal_error", details: "Failed to compute patterns" }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /insights/:agentId/sectors — Sector allocation
// ---------------------------------------------------------------------------

insightsRoutes.get("/:agentId/sectors", async (c) => {
  const agentId = c.req.param("agentId");
  const period = parsePeriod(c.req.query("period"));

  const config = getAgentConfig(agentId);
  if (!config) {
    return c.json({ error: "agent_not_found", code: "agent_not_found", details: `Agent "${agentId}" not found` }, 404);
  }

  try {
    const analytics = await getAgentAnalytics(agentId, period);
    if (!analytics) {
      return c.json({ error: "analytics_failed", code: "analytics_failed", details: "Failed to compute analytics" }, 500);
    }

    return c.json({
      agentId,
      agentName: config.name,
      period,
      sectorAllocation: analytics.sectorAllocation,
      totalSectors: analytics.sectorAllocation.length,
    });
  } catch (error) {
    console.error(`[Insights] Sectors failed for ${agentId}:`, error);
    return c.json({ error: "internal_error", code: "internal_error", details: "Failed to compute sector allocation" }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /insights/:agentId/streaks — Win/loss streak analysis
// ---------------------------------------------------------------------------

insightsRoutes.get("/:agentId/streaks", async (c) => {
  const agentId = c.req.param("agentId");
  const period = parsePeriod(c.req.query("period"));

  const config = getAgentConfig(agentId);
  if (!config) {
    return c.json({ error: "agent_not_found", code: "agent_not_found", details: `Agent "${agentId}" not found` }, 404);
  }

  try {
    const analytics = await getAgentAnalytics(agentId, period);
    if (!analytics) {
      return c.json({ error: "analytics_failed", code: "analytics_failed", details: "Failed to compute analytics" }, 500);
    }

    return c.json({
      agentId,
      agentName: config.name,
      period,
      streaks: analytics.streaks,
      interpretation: interpretStreaks(analytics.streaks),
    });
  } catch (error) {
    console.error(`[Insights] Streaks failed for ${agentId}:`, error);
    return c.json({ error: "internal_error", code: "internal_error", details: "Failed to compute streaks" }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /insights/:agentId/sentiment — Sentiment profile
// ---------------------------------------------------------------------------

insightsRoutes.get("/:agentId/sentiment", async (c) => {
  const agentId = c.req.param("agentId");
  const period = parsePeriod(c.req.query("period"));

  const config = getAgentConfig(agentId);
  if (!config) {
    return c.json({ error: "agent_not_found", code: "agent_not_found", details: `Agent "${agentId}" not found` }, 404);
  }

  try {
    const analytics = await getAgentAnalytics(agentId, period);
    if (!analytics) {
      return c.json({ error: "analytics_failed", code: "analytics_failed", details: "Failed to compute analytics" }, 500);
    }

    return c.json({
      agentId,
      agentName: config.name,
      period,
      sentiment: analytics.sentimentProfile,
    });
  } catch (error) {
    console.error(`[Insights] Sentiment failed for ${agentId}:`, error);
    return c.json({ error: "internal_error", code: "internal_error", details: "Failed to compute sentiment" }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /insights/:agentId/activity — Hourly activity heatmap data
// ---------------------------------------------------------------------------

insightsRoutes.get("/:agentId/activity", async (c) => {
  const agentId = c.req.param("agentId");
  const period = parsePeriod(c.req.query("period"));

  const config = getAgentConfig(agentId);
  if (!config) {
    return c.json({ error: "agent_not_found", code: "agent_not_found", details: `Agent "${agentId}" not found` }, 404);
  }

  try {
    const analytics = await getAgentAnalytics(agentId, period);
    if (!analytics) {
      return c.json({ error: "analytics_failed", code: "analytics_failed", details: "Failed to compute analytics" }, 500);
    }

    // Find peak hours
    const sortedHours = [...analytics.hourlyActivity].sort((a, b) => b.decisions - a.decisions);
    const peakHour = sortedHours[0];
    const quietHour = sortedHours[sortedHours.length - 1];

    return c.json({
      agentId,
      agentName: config.name,
      period,
      hourlyActivity: analytics.hourlyActivity,
      summary: {
        peakHour: peakHour ? { hour: peakHour.hour, decisions: peakHour.decisions } : null,
        quietHour: quietHour ? { hour: quietHour.hour, decisions: quietHour.decisions } : null,
        totalActiveHours: analytics.hourlyActivity.filter((h) => h.decisions > 0).length,
      },
    });
  } catch (error) {
    console.error(`[Insights] Activity failed for ${agentId}:`, error);
    return c.json({ error: "internal_error", code: "internal_error", details: "Failed to compute activity" }, 500);
  }
});

// ---------------------------------------------------------------------------
// Interpretation Helpers
// ---------------------------------------------------------------------------

function interpretRisk(risk: {
  sharpeRatio: number;
  maxDrawdownPercent: number;
  volatility: number;
  sortinoRatio: number;
  calmarRatio: number;
}): string[] {
  const insights: string[] = [];

  if (risk.sharpeRatio > 2) insights.push("Excellent risk-adjusted returns (Sharpe > 2)");
  else if (risk.sharpeRatio > 1) insights.push("Good risk-adjusted returns (Sharpe > 1)");
  else if (risk.sharpeRatio > 0) insights.push("Positive but modest risk-adjusted returns");
  else insights.push("Negative risk-adjusted returns - strategy needs review");

  if (risk.maxDrawdownPercent > 20) insights.push("High max drawdown indicates significant risk exposure");
  else if (risk.maxDrawdownPercent > 10) insights.push("Moderate drawdown risk");
  else insights.push("Low drawdown risk - conservative positioning");

  if (risk.sortinoRatio > risk.sharpeRatio * 1.5) {
    insights.push("Sortino ratio significantly above Sharpe suggests good downside protection");
  }

  if (risk.volatility > 0.3) insights.push("High volatility in decision confidence");
  else if (risk.volatility < 0.1) insights.push("Very consistent confidence levels");

  return insights;
}

function interpretPatterns(patterns: {
  tradeFrequency: string;
  preferredAction: string;
  symbolDiversity: number;
  reversalRate: number;
  mostTradedSymbol: string | null;
}): string[] {
  const insights: string[] = [];

  if (patterns.tradeFrequency === "high") insights.push("Active trader - makes frequent decisions");
  else if (patterns.tradeFrequency === "low") insights.push("Patient trader - waits for high-conviction setups");

  if (patterns.symbolDiversity > 50) insights.push("Highly diversified across many stocks");
  else if (patterns.symbolDiversity < 20) insights.push("Concentrated in a few favorite stocks");

  if (patterns.reversalRate > 30) insights.push("Frequently reverses position - reactive to market changes");
  else insights.push("Consistent directional bias - sticks to convictions");

  if (patterns.mostTradedSymbol) {
    insights.push(`Strong affinity for ${patterns.mostTradedSymbol}`);
  }

  return insights;
}

function interpretStreaks(streaks: {
  currentStreak: { type: string; length: number };
  longestWinStreak: number;
  longestLossStreak: number;
}): string[] {
  const insights: string[] = [];

  if (streaks.currentStreak.type === "win" && streaks.currentStreak.length >= 3) {
    insights.push(`On a hot streak! ${streaks.currentStreak.length} wins in a row`);
  } else if (streaks.currentStreak.type === "loss" && streaks.currentStreak.length >= 3) {
    insights.push(`Cold streak: ${streaks.currentStreak.length} consecutive losses`);
  }

  if (streaks.longestWinStreak >= 5) {
    insights.push(`Best run: ${streaks.longestWinStreak} consecutive wins`);
  }

  if (streaks.longestLossStreak >= 5) {
    insights.push(`Worst slump: ${streaks.longestLossStreak} consecutive losses`);
  }

  if (streaks.longestWinStreak > streaks.longestLossStreak * 2) {
    insights.push("Win streaks significantly longer than loss streaks - strong momentum player");
  }

  return insights;
}

// ---------------------------------------------------------------------------
// Helper: Find leader in a metric
// ---------------------------------------------------------------------------

function findLeader<T extends { agentId: string; agentName: string }>(
  agents: T[],
  metric: (agent: T) => number,
): { agentId: string; agentName: string; value: number } | null {
  if (agents.length === 0) return null;

  let leader = agents[0];
  let maxVal = metric(leader);

  for (const agent of agents.slice(1)) {
    const val = metric(agent);
    if (val > maxVal) {
      maxVal = val;
      leader = agent;
    }
  }

  return { agentId: leader.agentId, agentName: leader.agentName, value: Math.round(maxVal * 100) / 100 };
}
