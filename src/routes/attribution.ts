/**
 * Performance Attribution Routes
 *
 * Exposes comprehensive performance attribution and factor analysis for
 * MoltApp's AI trading agents. Answers the core question: WHERE did the
 * returns come from and WHY?
 *
 * Routes:
 *   GET /api/v1/attribution/:agentId              — Full attribution report
 *   GET /api/v1/attribution/:agentId/brinson      — Brinson-Fachler breakdown
 *   GET /api/v1/attribution/:agentId/factors       — Factor exposure analysis
 *   GET /api/v1/attribution/:agentId/alpha-beta    — Alpha/Beta decomposition
 *   GET /api/v1/attribution/:agentId/contributions — Trade contribution ranking
 *   GET /api/v1/attribution/:agentId/timing        — Timing analysis
 *   GET /api/v1/attribution/:agentId/risk          — Risk contribution per position
 *   GET /api/v1/attribution/compare                — Cross-agent attribution comparison
 */

import { Hono } from "hono";
import {
  getFullAttributionReport,
  getAttributionBreakdown,
  getFactorExposure,
  getAlphaBeta,
  getTradeContributions,
  getTimingAnalysis,
  getRiskContribution,
  compareAttribution,
} from "../services/attribution.ts";
import { parseQueryInt } from "../lib/query-params.js";
import { round2 } from "../lib/math-utils.ts";

export const attributionRoutes = new Hono();

// ---------------------------------------------------------------------------
// Valid agent IDs for request validation
// ---------------------------------------------------------------------------

const VALID_AGENT_IDS = new Set([
  "claude-value-investor",
  "gpt-momentum-trader",
  "grok-contrarian",
]);

/**
 * Validate that the given agent ID is one of the known agents.
 * Returns an error response object if invalid, or null if valid.
 */
function validateAgentId(agentId: string): { error: string; code: string; details: string; validAgents: string[] } | null {
  if (!VALID_AGENT_IDS.has(agentId)) {
    return {
      error: "invalid_agent",
      code: "agent_not_found",
      details: `Agent "${agentId}" not found. Valid IDs: ${Array.from(VALID_AGENT_IDS).join(", ")}`,
      validAgents: Array.from(VALID_AGENT_IDS),
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// GET /compare — Cross-agent attribution comparison (must be before :agentId)
// ---------------------------------------------------------------------------

attributionRoutes.get("/compare", async (c) => {
  try {
    const agentsParam = c.req.query("agents");
    let agentIds: string[] | undefined;

    if (agentsParam) {
      agentIds = agentsParam.split(",").map((s) => s.trim());
      // Validate each agent ID
      for (const id of agentIds) {
        const err = validateAgentId(id);
        if (err) return c.json(err, 400);
      }
    }

    const comparison = await compareAttribution(agentIds);

    return c.json({
      status: "ok",
      comparison,
      description:
        "Cross-agent attribution comparison — which agent has the best stock selection, timing, and risk management.",
    });
  } catch (error) {
    console.error("[Attribution] Comparison error:", error);
    return c.json(
      {
        error: "attribution_error",
        code: "comparison_failed",
        details: error instanceof Error ? error.message : "Failed to compare agent attributions",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /:agentId — Full attribution report
// ---------------------------------------------------------------------------

attributionRoutes.get("/:agentId", async (c) => {
  const agentId = c.req.param("agentId");

  const err = validateAgentId(agentId);
  if (err) return c.json(err, 400);

  try {
    const report = await getFullAttributionReport(agentId);

    if (!report) {
      return c.json(
        {
          error: "attribution_error",
          code: "report_generation_failed",
          details: `Could not generate attribution report for agent "${agentId}".`,
        },
        404,
      );
    }

    return c.json({
      status: "ok",
      report,
      description:
        "Full performance attribution report including Brinson-Fachler decomposition, factor exposures, alpha/beta, trade contributions, timing analysis, and risk contribution.",
    });
  } catch (error) {
    console.error(`[Attribution] Full report error for ${agentId}:`, error);
    return c.json(
      {
        error: "attribution_error",
        code: "full_report_failed",
        details: error instanceof Error ? error.message : "Failed to generate full attribution report",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /:agentId/brinson — Brinson-Fachler attribution breakdown
// ---------------------------------------------------------------------------

attributionRoutes.get("/:agentId/brinson", async (c) => {
  const agentId = c.req.param("agentId");

  const err = validateAgentId(agentId);
  if (err) return c.json(err, 400);

  try {
    const period = c.req.query("period"); // e.g. "7d", "30d", "90d"
    const attribution = await getAttributionBreakdown(agentId, period);

    return c.json({
      status: "ok",
      attribution,
      description:
        "Brinson-Fachler performance attribution. Decomposes returns into allocation effect (sector weight decisions), selection effect (stock picking within sectors), and interaction effect.",
    });
  } catch (error) {
    console.error(`[Attribution] Brinson error for ${agentId}:`, error);
    return c.json(
      {
        error: "attribution_error",
        code: "brinson_failed",
        details: error instanceof Error ? error.message : "Failed to compute Brinson-Fachler attribution",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /:agentId/factors — Factor exposure analysis
// ---------------------------------------------------------------------------

attributionRoutes.get("/:agentId/factors", async (c) => {
  const agentId = c.req.param("agentId");

  const err = validateAgentId(agentId);
  if (err) return c.json(err, 400);

  try {
    const exposure = await getFactorExposure(agentId);

    return c.json({
      status: "ok",
      exposure,
      description:
        "Multi-factor exposure analysis. Loading scores range from -100 (extreme short/aversion) to +100 (extreme long/preference) across Momentum, Value, Size, Volatility, Quality, and Crypto factors.",
    });
  } catch (error) {
    console.error(`[Attribution] Factor exposure error for ${agentId}:`, error);
    return c.json(
      {
        error: "attribution_error",
        code: "factor_exposure_failed",
        details: error instanceof Error ? error.message : "Failed to compute factor exposure",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /:agentId/alpha-beta — Alpha/Beta decomposition
// ---------------------------------------------------------------------------

attributionRoutes.get("/:agentId/alpha-beta", async (c) => {
  const agentId = c.req.param("agentId");

  const err = validateAgentId(agentId);
  if (err) return c.json(err, 400);

  try {
    const benchmark = c.req.query("benchmark") ?? "SPYx";
    const decomposition = await getAlphaBeta(agentId, benchmark);

    return c.json({
      status: "ok",
      decomposition,
      description:
        "Alpha/Beta decomposition against a benchmark. Alpha = excess return above benchmark * beta. Beta = sensitivity to benchmark movements. Includes R-squared, tracking error, and information ratio.",
    });
  } catch (error) {
    console.error(`[Attribution] Alpha/Beta error for ${agentId}:`, error);
    return c.json(
      {
        error: "attribution_error",
        code: "alpha_beta_failed",
        details: error instanceof Error ? error.message : "Failed to compute alpha/beta decomposition",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /:agentId/contributions — Trade contribution ranking
// ---------------------------------------------------------------------------

attributionRoutes.get("/:agentId/contributions", async (c) => {
  const agentId = c.req.param("agentId");

  const err = validateAgentId(agentId);
  if (err) return c.json(err, 400);

  try {
    const limit = parseQueryInt(c.req.query("limit"), 50, 1, 200);

    const contributions = await getTradeContributions(agentId, limit);

    // Summary statistics
    const totalPnl = contributions.reduce((s, c) => s + c.pnl, 0);
    const winners = contributions.filter((c) => c.pnl > 0);
    const losers = contributions.filter((c) => c.pnl < 0);
    const convictionTrades = contributions.filter((c) => c.isConvictionTrade);
    const avgTimingScore = contributions.length > 0
      ? contributions.reduce((s, c) => s + c.timingScore, 0) / contributions.length
      : 0;

    return c.json({
      status: "ok",
      contributions,
      summary: {
        totalTrades: contributions.length,
        totalPnl: round2(totalPnl),
        winnerCount: winners.length,
        loserCount: losers.length,
        convictionTradeCount: convictionTrades.length,
        avgTimingScore: Math.round(avgTimingScore * 10) / 10,
        biggestWinner: winners.sort((a, b) => b.pnl - a.pnl)[0] ?? null,
        biggestLoser: losers.sort((a, b) => a.pnl - b.pnl)[0] ?? null,
      },
      description:
        "Trade contribution analysis. Each trade ranked by absolute P&L impact, including holding period, timing score, conviction level, and portfolio contribution.",
    });
  } catch (error) {
    console.error(`[Attribution] Contributions error for ${agentId}:`, error);
    return c.json(
      {
        error: "attribution_error",
        code: "contributions_failed",
        details: error instanceof Error ? error.message : "Failed to compute trade contributions",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /:agentId/timing — Timing analysis
// ---------------------------------------------------------------------------

attributionRoutes.get("/:agentId/timing", async (c) => {
  const agentId = c.req.param("agentId");

  const err = validateAgentId(agentId);
  if (err) return c.json(err, 400);

  try {
    const timing = await getTimingAnalysis(agentId);

    // Find best and worst time slots
    const bestTimeSlot = timing.timeOfDayPerformance.reduce(
      (a, b) => (b.winRate > a.winRate && b.decisions > 0 ? b : a),
      timing.timeOfDayPerformance[0],
    );
    const bestDay = timing.dayOfWeekPerformance.reduce(
      (a, b) => (b.winRate > a.winRate && b.decisions > 0 ? b : a),
      timing.dayOfWeekPerformance[0],
    );
    const bestRegime = timing.regimePerformance.reduce(
      (a, b) => (b.winRate > a.winRate && b.decisions > 0 ? b : a),
      timing.regimePerformance[0],
    );

    return c.json({
      status: "ok",
      timing,
      insights: {
        bestTimeSlot: bestTimeSlot?.slot ?? "N/A",
        bestDayOfWeek: bestDay?.day ?? "N/A",
        bestMarketRegime: bestRegime?.regime ?? "N/A",
        executionSpeed: timing.avgDecisionToExecutionMs < 5000
          ? "Fast (<5s)"
          : timing.avgDecisionToExecutionMs < 30000
            ? "Moderate (5-30s)"
            : "Slow (>30s)",
      },
      description:
        "Market timing analysis. Measures decision-to-execution speed, time-of-day/day-of-week patterns, and performance across different market regimes.",
    });
  } catch (error) {
    console.error(`[Attribution] Timing error for ${agentId}:`, error);
    return c.json(
      {
        error: "attribution_error",
        code: "timing_failed",
        details: error instanceof Error ? error.message : "Failed to compute timing analysis",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /:agentId/risk — Risk contribution per position
// ---------------------------------------------------------------------------

attributionRoutes.get("/:agentId/risk", async (c) => {
  const agentId = c.req.param("agentId");

  const err = validateAgentId(agentId);
  if (err) return c.json(err, 400);

  try {
    const risk = await getRiskContribution(agentId);

    // Group risk by sector
    const sectorRisk = new Map<string, { totalWeight: number; totalComponentVaR: number; positionCount: number }>();
    for (const pos of risk.positions) {
      const entry = sectorRisk.get(pos.sector) ?? { totalWeight: 0, totalComponentVaR: 0, positionCount: 0 };
      entry.totalWeight += pos.weight;
      entry.totalComponentVaR += pos.componentVaR;
      entry.positionCount++;
      sectorRisk.set(pos.sector, entry);
    }

    const sectorBreakdown = Array.from(sectorRisk.entries())
      .map(([sector, data]) => ({
        sector,
        weight: Math.round(data.totalWeight * 10000) / 100,
        componentVaR: round2(data.totalComponentVaR),
        positionCount: data.positionCount,
      }))
      .sort((a, b) => b.componentVaR - a.componentVaR);

    // Risk assessment narrative
    let riskAssessment: string;
    if (risk.concentrationScore > 70) {
      riskAssessment = "CRITICAL: Extremely concentrated portfolio. Single-stock risk dominates. Immediate diversification recommended.";
    } else if (risk.concentrationScore > 50) {
      riskAssessment = "WARNING: Moderately concentrated portfolio. A few positions account for most of the risk. Consider rebalancing.";
    } else if (risk.concentrationScore > 25) {
      riskAssessment = "ACCEPTABLE: Reasonably diversified across multiple positions and sectors. Risk is well-distributed.";
    } else {
      riskAssessment = "EXCELLENT: Well-diversified portfolio with balanced risk contributions across positions.";
    }

    return c.json({
      status: "ok",
      risk,
      sectorBreakdown,
      assessment: riskAssessment,
      description:
        "Risk contribution analysis per position. Includes marginal VaR, component VaR, concentration score (0=diversified, 100=single stock), Herfindahl index, and diversification ratio.",
    });
  } catch (error) {
    console.error(`[Attribution] Risk error for ${agentId}:`, error);
    return c.json(
      {
        error: "attribution_error",
        code: "risk_failed",
        details: error instanceof Error ? error.message : "Failed to compute risk contribution",
      },
      500,
    );
  }
});
