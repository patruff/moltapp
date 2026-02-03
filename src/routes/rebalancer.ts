/**
 * Portfolio Rebalancer API Routes
 *
 * Exposes portfolio optimization, strategy comparison, and rebalance
 * proposal generation for each AI trading agent.
 */

import { Hono } from "hono";
import {
  generateRebalanceProposal,
  compareStrategies,
  getRebalanceConfig,
  getRebalancerStatus,
  getRebalanceHistory,
  type RebalanceStrategy,
} from "../services/portfolio-rebalancer.ts";

const rebalancer = new Hono();

// ---------------------------------------------------------------------------
// GET /api/v1/rebalancer — Rebalancer system status
// ---------------------------------------------------------------------------
rebalancer.get("/", (c) => {
  const status = getRebalancerStatus();
  return c.json({
    status: "ok",
    data: status,
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/rebalancer/propose/:agentId — Generate rebalance proposal
// ---------------------------------------------------------------------------
rebalancer.get("/propose/:agentId", async (c) => {
  try {
    const agentId = c.req.param("agentId");
    const strategy = (c.req.query("strategy") || "mean-variance") as RebalanceStrategy;
    const riskTolerance = (c.req.query("risk") || "moderate") as
      | "conservative"
      | "moderate"
      | "aggressive";

    const config = getRebalanceConfig(riskTolerance, { strategy });

    // Build current portfolio from query params or use demo data
    const cashBalance = Number(c.req.query("cash")) || 1000;
    const positionsParam = c.req.query("positions");

    let portfolioPositions: Array<{
      symbol: string;
      quantity: number;
      currentPrice: number;
    }> = [];

    if (positionsParam) {
      try {
        portfolioPositions = JSON.parse(positionsParam);
      } catch {
        // Use empty portfolio if parse fails
      }
    }

    const proposal = await generateRebalanceProposal(agentId, config, {
      cashBalance,
      positions: portfolioPositions,
    });

    return c.json({
      status: "ok",
      data: proposal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ status: "error", error: message }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/rebalancer/compare/:agentId — Compare all strategies
// ---------------------------------------------------------------------------
rebalancer.get("/compare/:agentId", async (c) => {
  try {
    const agentId = c.req.param("agentId");
    const riskTolerance = (c.req.query("risk") || "moderate") as
      | "conservative"
      | "moderate"
      | "aggressive";

    const config = getRebalanceConfig(riskTolerance);

    const cashBalance = Number(c.req.query("cash")) || 1000;
    const positionsParam = c.req.query("positions");

    let portfolioPositions: Array<{
      symbol: string;
      quantity: number;
      currentPrice: number;
    }> = [];

    if (positionsParam) {
      try {
        portfolioPositions = JSON.parse(positionsParam);
      } catch {
        // Use empty portfolio
      }
    }

    const comparison = await compareStrategies(agentId, config, {
      cashBalance,
      positions: portfolioPositions,
    });

    return c.json({
      status: "ok",
      data: {
        bestStrategy: comparison.bestStrategy,
        comparison: comparison.comparison,
        proposals: comparison.proposals,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ status: "error", error: message }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/rebalancer/history/:agentId — Rebalance history for an agent
// ---------------------------------------------------------------------------
rebalancer.get("/history/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const limit = Number(c.req.query("limit")) || 20;
  const history = getRebalanceHistory(agentId, limit);

  return c.json({
    status: "ok",
    data: {
      agentId,
      count: history.length,
      history,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/rebalancer/strategies — List available strategies
// ---------------------------------------------------------------------------
rebalancer.get("/strategies", (c) => {
  return c.json({
    status: "ok",
    data: {
      strategies: [
        {
          id: "mean-variance",
          name: "Mean-Variance (Markowitz)",
          description:
            "Maximizes Sharpe ratio by finding optimal risk-return tradeoff. Best for moderate risk tolerance.",
          riskLevel: "moderate",
        },
        {
          id: "risk-parity",
          name: "Risk Parity",
          description:
            "Each position contributes equal risk to portfolio. Lower volatility positions get higher weight. Best for conservative investors.",
          riskLevel: "conservative",
        },
        {
          id: "kelly",
          name: "Kelly Criterion",
          description:
            "Optimal bet sizing based on historical win rate and payoff ratio. Uses half-Kelly for safety. Best for aggressive traders with good track records.",
          riskLevel: "aggressive",
        },
        {
          id: "volatility-target",
          name: "Volatility Targeting",
          description:
            "Scales positions to achieve a target portfolio volatility. Reduces exposure in volatile markets, increases in calm markets.",
          riskLevel: "moderate",
        },
        {
          id: "max-diversification",
          name: "Maximum Diversification",
          description:
            "Minimizes average correlation between holdings. Overweights uncorrelated assets for maximum diversification benefit.",
          riskLevel: "conservative",
        },
        {
          id: "equal-weight",
          name: "Equal Weight",
          description:
            "Simple 1/N allocation across all positions. No optimization, but robust and hard to beat in practice.",
          riskLevel: "moderate",
        },
      ],
      defaultConfigs: {
        conservative: {
          strategy: "risk-parity",
          targetVolatility: 0.1,
          maxSingleAllocation: 0.2,
          minCashReserve: 0.3,
        },
        moderate: {
          strategy: "mean-variance",
          targetVolatility: 0.15,
          maxSingleAllocation: 0.25,
          minCashReserve: 0.2,
        },
        aggressive: {
          strategy: "kelly",
          targetVolatility: 0.25,
          maxSingleAllocation: 0.35,
          minCashReserve: 0.1,
        },
      },
    },
  });
});

export { rebalancer as rebalancerRoutes };
