/**
 * Benchmark Comparison API Routes
 *
 * Shows how each AI agent performs relative to simple buy-and-hold
 * strategies. Answers: "Are the AI agents actually beating the market?"
 */

import { Hono } from "hono";
import { countByCondition } from "../lib/math-utils.ts";
import {
  getBenchmarkSummary,
  getAgentBenchmarkComparison,
  getBenchmarkHistory,
  getLatestBenchmark,
} from "../services/benchmark-tracker.ts";

export const benchmarkRoutes = new Hono();

/**
 * GET / — Full benchmark comparison summary for all agents
 */
benchmarkRoutes.get("/", (c) => {
  const summary = getBenchmarkSummary();
  return c.json({
    ok: true,
    summary,
  });
});

/**
 * GET /agent/:agentId — Benchmark comparison for a specific agent
 */
benchmarkRoutes.get("/agent/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const comparison = getAgentBenchmarkComparison(agentId);

  if (!comparison) {
    return c.json(
      {
        ok: false,
        error: `No benchmark data found for agent ${agentId}. Need at least 2 daily returns.`,
      },
      404,
    );
  }

  return c.json({
    ok: true,
    comparison,
  });
});

/**
 * GET /history — Raw benchmark price/return history for charting
 */
benchmarkRoutes.get("/history", (c) => {
  const limit = parseInt(c.req.query("limit") ?? "90", 10);
  const history = getBenchmarkHistory(Math.min(limit, 365));

  return c.json({
    ok: true,
    count: history.length,
    history,
  });
});

/**
 * GET /latest — Latest benchmark snapshot
 */
benchmarkRoutes.get("/latest", (c) => {
  const latest = getLatestBenchmark();

  if (!latest) {
    return c.json({
      ok: false,
      error: "No benchmark data recorded yet",
    }, 404);
  }

  return c.json({
    ok: true,
    snapshot: latest,
  });
});

/**
 * GET /alpha — Quick alpha check for all agents (are they beating the market?)
 */
benchmarkRoutes.get("/alpha", (c) => {
  const summary = getBenchmarkSummary();

  const alphaReport = summary.agentComparisons.map((comp) => ({
    agentId: comp.agentId,
    agentName: comp.agentName,
    agentReturn: comp.agentReturn,
    benchmarkReturn: comp.spyReturn,
    alpha: comp.alpha,
    beta: comp.beta,
    outperforming: comp.outperforming,
    verdict: comp.alpha > 5
      ? "STRONG OUTPERFORMER"
      : comp.alpha > 0
        ? "Beating benchmark"
        : comp.alpha > -5
          ? "Slightly underperforming"
          : "SIGNIFICANTLY UNDERPERFORMING",
  }));

  const avgAlpha =
    alphaReport.length > 0
      ? Math.round(
          (alphaReport.reduce((sum, a) => sum + a.alpha, 0) /
            alphaReport.length) *
            100,
        ) / 100
      : 0;

  const outperformers = countByCondition(alphaReport, (a) => a.outperforming);

  return c.json({
    ok: true,
    overallVerdict:
      outperformers === alphaReport.length
        ? "ALL agents beating the market"
        : outperformers > 0
          ? `${outperformers}/${alphaReport.length} agents beating the market`
          : "No agents currently beating the market",
    averageAlpha: avgAlpha,
    benchmarkReturn: summary.spyCumulativeReturn,
    agents: alphaReport,
  });
});
