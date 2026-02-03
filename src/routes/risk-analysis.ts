/**
 * Portfolio Risk Analysis API
 *
 * Exposes the institutional-grade risk analytics engine via REST endpoints.
 * Provides VaR, stress tests, concentration analysis, and risk scoring
 * for each AI trading agent's portfolio.
 *
 * Endpoints:
 * - GET /risk/:agentId — Full risk report for an agent
 * - GET /risk/:agentId/stress — Stress test scenarios only
 * - GET /risk/:agentId/concentration — Sector concentration only
 * - GET /risk/compare — Side-by-side risk comparison of all agents
 * - GET /risk/stats — Risk analyzer system stats
 */

import { Hono } from "hono";
import {
  analyzePortfolioRisk,
  getRiskAnalyzerStats,
  type PortfolioRiskReport,
} from "../services/portfolio-risk-analyzer.ts";
import { getPortfolioContext } from "../agents/orchestrator.ts";

const riskAnalysis = new Hono();

const AGENT_IDS = ["claude-value-investor", "gpt-momentum-trader", "grok-contrarian"];

// ---------------------------------------------------------------------------
// GET /risk/compare — Compare risk across all agents
// ---------------------------------------------------------------------------

riskAnalysis.get("/compare", async (c) => {
  const reports: PortfolioRiskReport[] = [];

  for (const agentId of AGENT_IDS) {
    try {
      const portfolio = await getPortfolioContext(agentId, []);
      const report = await analyzePortfolioRisk(
        agentId,
        portfolio.totalValue,
        portfolio.cashBalance,
      );
      reports.push(report);
    } catch (err) {
      console.error(`[RiskAPI] Failed to analyze ${agentId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return c.json({
    comparison: reports.map((r) => ({
      agentId: r.agentId,
      riskScore: r.riskScore,
      riskLevel: r.riskLevel,
      var95: r.var95,
      var95Dollar: r.var95Dollar,
      beta: r.beta,
      maxDrawdown: r.drawdown.maxDrawdownPercent,
      portfolioValue: r.portfolioValue,
      warnings: r.warnings.length,
    })),
    lowestRisk: reports.reduce((min, r) => (r.riskScore < min.riskScore ? r : min), reports[0])?.agentId ?? null,
    highestRisk: reports.reduce((max, r) => (r.riskScore > max.riskScore ? r : max), reports[0])?.agentId ?? null,
    generatedAt: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// GET /risk/stats — Analyzer system stats
// ---------------------------------------------------------------------------

riskAnalysis.get("/stats", (c) => {
  return c.json(getRiskAnalyzerStats());
});

// ---------------------------------------------------------------------------
// GET /risk/:agentId/stress — Stress tests only
// ---------------------------------------------------------------------------

riskAnalysis.get("/:agentId/stress", async (c) => {
  const agentId = c.req.param("agentId");

  try {
    const portfolio = await getPortfolioContext(agentId, []);
    const report = await analyzePortfolioRisk(
      agentId,
      portfolio.totalValue,
      portfolio.cashBalance,
    );

    return c.json({
      agentId,
      portfolioValue: report.portfolioValue,
      stressTests: report.stressTests,
      worstCase: report.stressTests.reduce(
        (worst, t) => (t.portfolioImpactPercent < worst.portfolioImpactPercent ? t : worst),
        report.stressTests[0],
      ),
      bestCase: report.stressTests.reduce(
        (best, t) => (t.portfolioImpactPercent > best.portfolioImpactPercent ? t : best),
        report.stressTests[0],
      ),
    });
  } catch (err) {
    return c.json(
      { error: "Failed to run stress tests", message: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /risk/:agentId/concentration — Sector concentration only
// ---------------------------------------------------------------------------

riskAnalysis.get("/:agentId/concentration", async (c) => {
  const agentId = c.req.param("agentId");

  try {
    const portfolio = await getPortfolioContext(agentId, []);
    const report = await analyzePortfolioRisk(
      agentId,
      portfolio.totalValue,
      portfolio.cashBalance,
    );

    return c.json({
      agentId,
      portfolioValue: report.portfolioValue,
      sectorConcentration: report.sectorConcentration,
      positionRisk: report.positionRisk,
      warnings: report.warnings.filter((w) =>
        w.toLowerCase().includes("concentration") || w.toLowerCase().includes("sector"),
      ),
    });
  } catch (err) {
    return c.json(
      { error: "Failed to analyze concentration", message: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /risk/:agentId — Full risk report
// ---------------------------------------------------------------------------

riskAnalysis.get("/:agentId", async (c) => {
  const agentId = c.req.param("agentId");

  try {
    const portfolio = await getPortfolioContext(agentId, []);
    const report = await analyzePortfolioRisk(
      agentId,
      portfolio.totalValue,
      portfolio.cashBalance,
    );

    return c.json(report);
  } catch (err) {
    return c.json(
      { error: "Failed to generate risk report", message: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});

export { riskAnalysis as riskAnalysisRoutes };
