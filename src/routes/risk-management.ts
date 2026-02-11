/**
 * Risk Management Routes
 *
 * Comprehensive risk monitoring and management API for AI trading agents.
 * Provides dashboards, VaR calculations, drawdown analysis, stop-loss
 * management, stress testing, correlation analysis, and platform-wide
 * risk monitoring.
 *
 * Routes:
 *   GET  /api/v1/risk                          — Platform risk summary
 *   GET  /api/v1/risk/:agentId                 — Agent risk dashboard
 *   GET  /api/v1/risk/:agentId/var             — Value-at-Risk details
 *   GET  /api/v1/risk/:agentId/drawdown        — Drawdown analysis
 *   GET  /api/v1/risk/:agentId/concentration   — Concentration risk
 *   GET  /api/v1/risk/:agentId/correlations    — Position correlation matrix
 *   GET  /api/v1/risk/:agentId/metrics         — Risk-adjusted return metrics
 *   GET  /api/v1/risk/:agentId/stress-test     — Portfolio stress test results
 *   GET  /api/v1/risk/:agentId/stops           — Active stop-loss/take-profit rules
 *   POST /api/v1/risk/:agentId/stops           — Create a stop rule
 *   DELETE /api/v1/risk/:agentId/stops/:ruleId — Cancel a stop rule
 *   GET  /api/v1/risk/alerts                   — Risk alerts
 *   POST /api/v1/risk/alerts/:alertId/ack      — Acknowledge an alert
 */

import { Hono } from "hono";
import { countByCondition } from "../lib/math-utils.ts";
import {
  getAgentRiskDashboard,
  getPlatformRiskSummary,
  calculateVaR,
  calculateDrawdown,
  calculateConcentrationRisk,
  calculateCorrelationMatrix,
  calculateRiskAdjustedMetrics,
  runStressTests,
  getStopRules,
  createStopRule,
  cancelStopRule,
  checkStopRules,
  getAlerts,
  acknowledgeAlert,
} from "../services/risk-management.ts";
import { getAgentConfigs, getMarketData, getPortfolioContext } from "../agents/orchestrator.ts";
import { apiError } from "../lib/errors.ts";

export const riskRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET /risk — Platform-wide risk summary
// ---------------------------------------------------------------------------

riskRoutes.get("/", async (c) => {
  const summary = await getPlatformRiskSummary();
  return c.json({
    ok: true,
    data: summary,
  });
});

// ---------------------------------------------------------------------------
// GET /risk/alerts — All risk alerts
// ---------------------------------------------------------------------------

riskRoutes.get("/alerts", async (c) => {
  const agentId = c.req.query("agentId");
  const severity = c.req.query("severity");
  const limit = parseInt(c.req.query("limit") ?? "50", 10);

  const alerts = getAlerts(agentId, severity, limit);

  return c.json({
    ok: true,
    data: {
      alerts,
      total: alerts.length,
      filters: { agentId: agentId ?? "all", severity: severity ?? "all" },
    },
  });
});

// ---------------------------------------------------------------------------
// POST /risk/alerts/:alertId/ack — Acknowledge an alert
// ---------------------------------------------------------------------------

riskRoutes.post("/alerts/:alertId/ack", async (c) => {
  const alertId = c.req.param("alertId");
  const success = acknowledgeAlert(alertId);

  if (!success) {
    return apiError(c, "ALERT_NOT_FOUND");
  }

  return c.json({ ok: true, message: "Alert acknowledged" });
});

// ---------------------------------------------------------------------------
// GET /risk/:agentId — Full risk dashboard for an agent
// ---------------------------------------------------------------------------

riskRoutes.get("/:agentId", async (c) => {
  const agentId = c.req.param("agentId");
  const dashboard = await getAgentRiskDashboard(agentId);

  if (!dashboard) {
    return apiError(c, "AGENT_NOT_FOUND");
  }

  return c.json({
    ok: true,
    data: dashboard,
  });
});

// ---------------------------------------------------------------------------
// GET /risk/:agentId/var — Value-at-Risk details
// ---------------------------------------------------------------------------

riskRoutes.get("/:agentId/var", async (c) => {
  const agentId = c.req.param("agentId");
  const configs = getAgentConfigs();
  const config = configs.find((a) => a.agentId === agentId);
  if (!config) {
    return apiError(c, "AGENT_NOT_FOUND");
  }

  const portfolio = await getPortfolioContext(agentId, await getMarketData());
  const var_ = calculateVaR(portfolio);

  return c.json({
    ok: true,
    data: {
      agentId,
      agentName: config.name,
      portfolioValue: portfolio.totalValue,
      ...var_,
      interpretation: {
        var95: `There is a 95% probability that the portfolio will not lose more than $${var_.var95.toFixed(2)} in a single day`,
        var99: `There is a 99% probability that the portfolio will not lose more than $${var_.var99.toFixed(2)} in a single day`,
        cvar95: `If losses exceed VaR, the expected loss is $${var_.cvar95.toFixed(2)}`,
      },
    },
  });
});

// ---------------------------------------------------------------------------
// GET /risk/:agentId/drawdown — Drawdown analysis
// ---------------------------------------------------------------------------

riskRoutes.get("/:agentId/drawdown", async (c) => {
  const agentId = c.req.param("agentId");
  const configs = getAgentConfigs();
  const config = configs.find((a) => a.agentId === agentId);
  if (!config) {
    return apiError(c, "AGENT_NOT_FOUND");
  }

  const portfolio = await getPortfolioContext(agentId, await getMarketData());
  const drawdown = calculateDrawdown(portfolio, agentId, config.riskTolerance);

  return c.json({
    ok: true,
    data: {
      agentId,
      agentName: config.name,
      riskTolerance: config.riskTolerance,
      ...drawdown,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /risk/:agentId/concentration — Concentration risk
// ---------------------------------------------------------------------------

riskRoutes.get("/:agentId/concentration", async (c) => {
  const agentId = c.req.param("agentId");
  const configs = getAgentConfigs();
  const config = configs.find((a) => a.agentId === agentId);
  if (!config) {
    return apiError(c, "AGENT_NOT_FOUND");
  }

  const portfolio = await getPortfolioContext(agentId, await getMarketData());
  const concentration = calculateConcentrationRisk(portfolio);

  return c.json({
    ok: true,
    data: {
      agentId,
      agentName: config.name,
      positionCount: portfolio.positions.length,
      ...concentration,
      guidance: concentration.level === "highly_concentrated"
        ? "Consider diversifying — single-stock risk is elevated"
        : concentration.level === "concentrated"
          ? "Portfolio is moderately concentrated — monitor closely"
          : "Portfolio diversification is healthy",
    },
  });
});

// ---------------------------------------------------------------------------
// GET /risk/:agentId/correlations — Position correlation matrix
// ---------------------------------------------------------------------------

riskRoutes.get("/:agentId/correlations", async (c) => {
  const agentId = c.req.param("agentId");
  const configs = getAgentConfigs();
  const config = configs.find((a) => a.agentId === agentId);
  if (!config) {
    return apiError(c, "AGENT_NOT_FOUND");
  }

  const portfolio = await getPortfolioContext(agentId, await getMarketData());
  const correlations = calculateCorrelationMatrix(portfolio.positions);

  // Find most and least correlated pairs
  const highCorrelation = correlations.filter((c) => c.strength === "very_strong");
  const diversifying = correlations.filter((c) => c.direction === "negative");

  return c.json({
    ok: true,
    data: {
      agentId,
      agentName: config.name,
      positionCount: portfolio.positions.length,
      pairCount: correlations.length,
      correlations,
      summary: {
        highlyCorrelatedPairs: highCorrelation.length,
        diversifyingPairs: diversifying.length,
        averageCorrelation: correlations.length > 0
          ? Math.round(
              correlations.reduce((s, c) => s + c.correlation, 0) /
                correlations.length * 1000,
            ) / 1000
          : 0,
      },
    },
  });
});

// ---------------------------------------------------------------------------
// GET /risk/:agentId/metrics — Risk-adjusted return metrics
// ---------------------------------------------------------------------------

riskRoutes.get("/:agentId/metrics", async (c) => {
  const agentId = c.req.param("agentId");
  const configs = getAgentConfigs();
  const config = configs.find((a) => a.agentId === agentId);
  if (!config) {
    return apiError(c, "AGENT_NOT_FOUND");
  }

  const portfolio = await getPortfolioContext(agentId, await getMarketData());
  const metrics = calculateRiskAdjustedMetrics(portfolio, agentId);

  return c.json({
    ok: true,
    data: {
      agentId,
      agentName: config.name,
      metrics,
      interpretation: {
        sortinoRatio: metrics.sortinoRatio > 2
          ? "Excellent risk-adjusted returns (downside-focused)"
          : metrics.sortinoRatio > 1
            ? "Good downside-adjusted returns"
            : "Returns are not well-compensating for downside risk",
        beta: metrics.beta > 1.2
          ? "Aggressive — portfolio amplifies market moves"
          : metrics.beta < 0.8
            ? "Defensive — portfolio dampens market moves"
            : "Market-neutral beta",
        alpha: metrics.alpha > 0
          ? `Generating ${metrics.alpha}% excess return above market expectations`
          : `Underperforming market expectations by ${Math.abs(metrics.alpha)}%`,
        profitFactor: metrics.profitFactor > 1.5
          ? "Strong profit factor — gross profits significantly exceed losses"
          : metrics.profitFactor > 1
            ? "Positive profit factor but narrow margin"
            : "Losses exceed profits — strategy needs review",
      },
    },
  });
});

// ---------------------------------------------------------------------------
// GET /risk/:agentId/stress-test — Portfolio stress testing
// ---------------------------------------------------------------------------

riskRoutes.get("/:agentId/stress-test", async (c) => {
  const agentId = c.req.param("agentId");
  const configs = getAgentConfigs();
  const config = configs.find((a) => a.agentId === agentId);
  if (!config) {
    return apiError(c, "AGENT_NOT_FOUND");
  }

  const portfolio = await getPortfolioContext(agentId, await getMarketData());
  const results = runStressTests(portfolio);

  const worstCase = results.reduce(
    (worst, r) => (r.portfolioImpact < worst.portfolioImpact ? r : worst),
    results[0],
  );
  const nonSurvivable = results.filter((r) => !r.survivable);

  return c.json({
    ok: true,
    data: {
      agentId,
      agentName: config.name,
      portfolioValue: portfolio.totalValue,
      scenarioCount: results.length,
      results,
      summary: {
        worstCaseScenario: worstCase?.scenario ?? "N/A",
        worstCaseLoss: worstCase?.portfolioImpact ?? 0,
        worstCaseLossPercent: worstCase?.portfolioImpactPercent ?? 0,
        nonSurvivableScenarios: nonSurvivable.length,
        resilience: nonSurvivable.length === 0
          ? "Portfolio survives all tested scenarios"
          : `WARNING: Portfolio may not survive ${nonSurvivable.map((s) => s.scenario).join(", ")}`,
      },
    },
  });
});

// ---------------------------------------------------------------------------
// GET /risk/:agentId/stops — Get stop-loss rules
// ---------------------------------------------------------------------------

riskRoutes.get("/:agentId/stops", async (c) => {
  const agentId = c.req.param("agentId");
  const status = c.req.query("status");
  const rules = getStopRules(agentId, status);

  return c.json({
    ok: true,
    data: {
      agentId,
      rules,
      activeCount: countByCondition(rules, (r) => r.status === "active"),
      triggeredCount: countByCondition(rules, (r) => r.status === "triggered"),
    },
  });
});

// ---------------------------------------------------------------------------
// POST /risk/:agentId/stops — Create a stop rule
// ---------------------------------------------------------------------------

riskRoutes.post("/:agentId/stops", async (c) => {
  const agentId = c.req.param("agentId");
  const body = await c.req.json();

  const { symbol, type, triggerPrice, triggerPercent, action } = body;

  if (!symbol || !type || triggerPrice === undefined) {
    return apiError(c, "VALIDATION_FAILED", {
      fields: ["symbol", "type", "triggerPrice"],
      message: "Missing required fields",
    });
  }

  if (!["stop_loss", "take_profit", "trailing_stop"].includes(type)) {
    return apiError(c, "VALIDATION_FAILED", {
      field: "type",
      message: "type must be stop_loss, take_profit, or trailing_stop",
    });
  }

  const rule = createStopRule({
    agentId,
    symbol,
    type,
    triggerPrice: Number(triggerPrice),
    triggerPercent: Number(triggerPercent ?? 0),
    action: action ?? "alert_only",
  });

  return c.json({ ok: true, data: rule }, 201);
});

// ---------------------------------------------------------------------------
// DELETE /risk/:agentId/stops/:ruleId — Cancel a stop rule
// ---------------------------------------------------------------------------

riskRoutes.delete("/:agentId/stops/:ruleId", async (c) => {
  const agentId = c.req.param("agentId");
  const ruleId = c.req.param("ruleId");

  const cancelled = cancelStopRule(agentId, ruleId);
  if (!cancelled) {
    return apiError(c, "STOP_RULE_NOT_FOUND");
  }

  return c.json({ ok: true, data: cancelled });
});
