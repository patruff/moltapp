/**
 * Portfolio Optimizer Routes
 *
 * Markowitz mean-variance optimization, Kelly criterion sizing,
 * risk parity allocation, efficient frontier calculation, and
 * portfolio rebalancing recommendations for AI trading agents.
 *
 * Routes:
 *   GET  /api/v1/optimizer/:agentId              — Optimal portfolio for an agent
 *   GET  /api/v1/optimizer/:agentId/kelly        — Kelly criterion sizing
 *   GET  /api/v1/optimizer/:agentId/rebalance    — Rebalancing recommendations
 *   GET  /api/v1/optimizer/frontier               — Efficient frontier
 *   GET  /api/v1/optimizer/risk-parity            — Risk parity portfolio
 *   GET  /api/v1/optimizer/correlations           — Stock correlation matrix
 *   GET  /api/v1/optimizer/compare                — Compare all agents' portfolios
 */

import { Hono } from "hono";
import {
  getOptimalPortfolio,
  getEfficientFrontier,
  getCorrelationMatrix,
  getKellyCriterion,
  getRiskParityPortfolio,
  getRebalanceRecommendations,
  compareAgentPortfolios,
} from "../services/portfolio-optimizer.ts";
import { getAgentConfig, getAgentConfigs } from "../agents/orchestrator.ts";

export const optimizerRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET /optimizer/frontier — Efficient frontier (before /:agentId)
// ---------------------------------------------------------------------------

optimizerRoutes.get("/frontier", async (c) => {
  try {
    const frontier = await getEfficientFrontier();

    return c.json({
      frontier,
      description: `Efficient frontier with ${frontier.points.length} portfolio points. Optimal Sharpe: ${frontier.optimalPoint.sharpeRatio} at ${(frontier.optimalPoint.volatility * 100).toFixed(1)}% vol, ${(frontier.optimalPoint.expectedReturn * 100).toFixed(1)}% return. Risk-free rate: ${(frontier.capitalMarketLine.riskFreeRate * 100).toFixed(1)}%.`,
    });
  } catch (error) {
    console.error("[Optimizer] Frontier error:", error);
    return c.json(
      {
        error: "optimizer_error",
        code: "frontier_failed",
        details: error instanceof Error ? error.message : "Failed to compute frontier",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /optimizer/risk-parity — Risk parity portfolio
// ---------------------------------------------------------------------------

optimizerRoutes.get("/risk-parity", async (c) => {
  try {
    const portfolio = await getRiskParityPortfolio();

    return c.json({
      riskParity: portfolio,
      description: `Risk parity portfolio with ${portfolio.allocations.length} stocks. Parity score: ${portfolio.riskParityScore}/100. ${portfolio.methodology}`,
    });
  } catch (error) {
    console.error("[Optimizer] Risk parity error:", error);
    return c.json(
      {
        error: "optimizer_error",
        code: "risk_parity_failed",
        details: error instanceof Error ? error.message : "Failed to compute risk parity",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /optimizer/correlations — Stock correlation matrix
// ---------------------------------------------------------------------------

optimizerRoutes.get("/correlations", async (c) => {
  try {
    const matrix = await getCorrelationMatrix();

    return c.json({
      correlations: matrix,
      description: `${matrix.symbols.length}x${matrix.symbols.length} correlation matrix. Average correlation: ${matrix.avgCorrelation}. ${matrix.strongPositive.length} strong positive pairs, ${matrix.strongNegative.length} strong negative pairs.`,
    });
  } catch (error) {
    console.error("[Optimizer] Correlations error:", error);
    return c.json(
      {
        error: "optimizer_error",
        code: "correlations_failed",
        details: error instanceof Error ? error.message : "Failed to compute correlations",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /optimizer/compare — Compare all agents' optimal portfolios
// ---------------------------------------------------------------------------

optimizerRoutes.get("/compare", async (c) => {
  try {
    const comparison = await compareAgentPortfolios();

    return c.json({
      comparison,
      description: `Portfolio optimization comparison for ${comparison.agents.length} agents. Best allocator: ${comparison.bestAllocator.agentName} (Sharpe: ${comparison.bestAllocator.sharpe}).`,
    });
  } catch (error) {
    console.error("[Optimizer] Comparison error:", error);
    return c.json(
      {
        error: "optimizer_error",
        code: "comparison_failed",
        details: error instanceof Error ? error.message : "Failed to compare portfolios",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /optimizer/:agentId — Optimal portfolio for an agent
// ---------------------------------------------------------------------------

optimizerRoutes.get("/:agentId", async (c) => {
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
    const portfolio = await getOptimalPortfolio(agentId);

    if (!portfolio) {
      return c.json(
        {
          error: "no_data",
          code: "no_portfolio_data",
          details: `No trading data for ${config.name}`,
        },
        404,
      );
    }

    return c.json({
      portfolio,
      description: `Optimal portfolio for ${config.name}: Expected return ${(portfolio.portfolioMetrics.expectedReturn * 100).toFixed(1)}%, Vol ${(portfolio.portfolioMetrics.expectedVolatility * 100).toFixed(1)}%, Sharpe ${portfolio.portfolioMetrics.sharpeRatio}. ${portfolio.changes.length} rebalancing changes recommended.`,
    });
  } catch (error) {
    console.error(`[Optimizer] Error for ${agentId}:`, error);
    return c.json(
      {
        error: "optimizer_error",
        code: "optimization_failed",
        details: error instanceof Error ? error.message : "Failed to optimize portfolio",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /optimizer/:agentId/kelly — Kelly criterion position sizing
// ---------------------------------------------------------------------------

optimizerRoutes.get("/:agentId/kelly", async (c) => {
  const agentId = c.req.param("agentId");
  const config = getAgentConfig(agentId);

  if (!config) {
    return c.json(
      { error: "agent_not_found", code: "agent_not_found", details: `Agent "${agentId}" not found` },
      404,
    );
  }

  try {
    const kelly = await getKellyCriterion(agentId);

    if (!kelly) {
      return c.json(
        { error: "no_data", code: "no_kelly_data", details: `No trading data for ${config.name}` },
        404,
      );
    }

    return c.json({
      kelly,
      description: `Kelly criterion for ${config.name}: Overall leverage ${kelly.overallLeverage}x. ${kelly.interpretation}`,
    });
  } catch (error) {
    console.error(`[Optimizer] Kelly error for ${agentId}:`, error);
    return c.json(
      {
        error: "optimizer_error",
        code: "kelly_failed",
        details: error instanceof Error ? error.message : "Failed to compute Kelly criterion",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /optimizer/:agentId/rebalance — Rebalancing recommendations
// ---------------------------------------------------------------------------

optimizerRoutes.get("/:agentId/rebalance", async (c) => {
  const agentId = c.req.param("agentId");
  const config = getAgentConfig(agentId);

  if (!config) {
    return c.json(
      { error: "agent_not_found", code: "agent_not_found", details: `Agent "${agentId}" not found` },
      404,
    );
  }

  try {
    const rebalance = await getRebalanceRecommendations(agentId);

    if (!rebalance) {
      return c.json(
        { error: "no_data", code: "no_rebalance_data", details: `No data for ${config.name}` },
        404,
      );
    }

    return c.json({
      rebalance,
      description: `Rebalance urgency: ${rebalance.urgency.toUpperCase()}. ${rebalance.summary}`,
    });
  } catch (error) {
    console.error(`[Optimizer] Rebalance error for ${agentId}:`, error);
    return c.json(
      {
        error: "optimizer_error",
        code: "rebalance_failed",
        details: error instanceof Error ? error.message : "Failed to compute rebalancing",
      },
      500,
    );
  }
});
