/**
 * Portfolio Simulator Routes
 *
 * "What if I copied this agent?" — simulate following AI agent decisions
 * to see hypothetical portfolio performance.
 *
 * Routes:
 *   POST /api/v1/simulator/run               — Run full portfolio simulation
 *   GET  /api/v1/simulator/quick/:agentId    — Quick simulation preview
 *   POST /api/v1/simulator/compare           — Compare multiple simulation scenarios
 */

import { Hono } from "hono";
import {
  runSimulation,
  quickSimulation,
  type SimulationConfig,
} from "../services/portfolio-simulator.ts";
import { getAgentConfig, getAgentConfigs } from "../agents/orchestrator.ts";
import { errorMessage } from "../lib/errors.ts";

export const simulatorRoutes = new Hono();

// ---------------------------------------------------------------------------
// POST /run — Run full portfolio simulation
// ---------------------------------------------------------------------------

simulatorRoutes.post("/run", async (c) => {
  try {
    const body = await c.req.json();

    // Validate required fields
    if (!body.agentIds || !Array.isArray(body.agentIds) || body.agentIds.length === 0) {
      return c.json(
        { error: "validation_error", code: "validation_error", details: "agentIds must be a non-empty array" },
        400,
      );
    }

    // Validate agent IDs exist
    for (const agentId of body.agentIds) {
      if (!getAgentConfig(agentId)) {
        return c.json(
          {
            error: "validation_error",
            code: "validation_error",
            details: `Agent "${agentId}" not found. Valid IDs: ${getAgentConfigs().map((c) => c.agentId).join(", ")}`,
          },
          400,
        );
      }
    }

    const config: SimulationConfig = {
      startingCapital: body.startingCapital ?? 10000,
      agentIds: body.agentIds,
      agentWeights: body.agentWeights,
      maxPositionAllocation: body.maxPositionAllocation ?? 0.25,
      minConfidenceThreshold: body.minConfidenceThreshold ?? 40,
      skipHolds: body.skipHolds ?? true,
      startDate: body.startDate ? new Date(body.startDate) : undefined,
      endDate: body.endDate ? new Date(body.endDate) : undefined,
    };

    const result = await runSimulation(config);

    return c.json({
      simulation: result,
      message: `Simulated ${result.summary.daysSimulated} days: ${result.summary.totalReturnPercent > 0 ? "+" : ""}${result.summary.totalReturnPercent}% return (${result.summary.tradesFollowed} trades followed)`,
    });
  } catch (err) {
    const msg = errorMessage(err);
    if (msg.includes("must be") || msg.includes("cannot exceed") || msg.includes("required")) {
      return c.json({ error: "validation_error", code: "validation_error", details: msg }, 400);
    }
    console.error("[Simulator] Run failed:", err);
    return c.json({ error: "internal_error", code: "internal_error", details: "Simulation failed" }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /quick/:agentId — Quick simulation preview
// ---------------------------------------------------------------------------

simulatorRoutes.get("/quick/:agentId", async (c) => {
  const agentId = c.req.param("agentId");
  const capital = parseInt(c.req.query("capital") ?? "10000", 10);

  const config = getAgentConfig(agentId);
  if (!config) {
    return c.json(
      {
        error: "not_found",
        code: "not_found",
        details: `Agent "${agentId}" not found. Valid IDs: ${getAgentConfigs().map((c) => c.agentId).join(", ")}`,
      },
      404,
    );
  }

  if (capital <= 0 || capital > 1_000_000) {
    return c.json(
      { error: "validation_error", code: "validation_error", details: "capital must be between 1 and 1,000,000" },
      400,
    );
  }

  try {
    const preview = await quickSimulation(agentId, capital);

    return c.json({
      preview,
      message: `If you had copy-traded ${preview.agentName} with $${capital}: estimated ${preview.estimatedReturnPercent > 0 ? "+" : ""}${preview.estimatedReturnPercent}% return`,
    });
  } catch (err) {
    console.error("[Simulator] Quick sim failed:", err);
    return c.json({ error: "internal_error", code: "internal_error", details: "Quick simulation failed" }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /compare — Compare multiple simulation scenarios
// ---------------------------------------------------------------------------

simulatorRoutes.post("/compare", async (c) => {
  try {
    const body = await c.req.json();

    if (!Array.isArray(body.scenarios) || body.scenarios.length < 2) {
      return c.json(
        { error: "validation_error", code: "validation_error", details: "At least 2 scenarios required for comparison" },
        400,
      );
    }

    if (body.scenarios.length > 5) {
      return c.json(
        { error: "validation_error", code: "validation_error", details: "Maximum 5 scenarios per comparison" },
        400,
      );
    }

    const results = [];
    for (const scenario of body.scenarios) {
      const config: SimulationConfig = {
        startingCapital: scenario.startingCapital ?? 10000,
        agentIds: scenario.agentIds ?? [],
        agentWeights: scenario.agentWeights,
        maxPositionAllocation: scenario.maxPositionAllocation ?? 0.25,
        minConfidenceThreshold: scenario.minConfidenceThreshold ?? 40,
        skipHolds: scenario.skipHolds ?? true,
        startDate: scenario.startDate ? new Date(scenario.startDate) : undefined,
        endDate: scenario.endDate ? new Date(scenario.endDate) : undefined,
      };

      const result = await runSimulation(config);
      results.push({
        name: scenario.name ?? config.agentIds.join("+"),
        summary: result.summary,
        riskMetrics: result.riskMetrics,
      });
    }

    // Rank scenarios
    const ranked = [...results].sort(
      (a, b) => b.summary.totalReturnPercent - a.summary.totalReturnPercent,
    );

    return c.json({
      comparison: {
        scenarios: results,
        ranking: ranked.map((r, i) => ({
          rank: i + 1,
          name: r.name,
          returnPercent: r.summary.totalReturnPercent,
          sharpeRatio: r.riskMetrics.sharpeRatio,
          maxDrawdownPercent: r.riskMetrics.maxDrawdownPercent,
        })),
        bestScenario: ranked[0]?.name ?? null,
      },
    });
  } catch (err) {
    const msg = errorMessage(err);
    if (msg.includes("must be") || msg.includes("cannot exceed") || msg.includes("required")) {
      return c.json({ error: "validation_error", code: "validation_error", details: msg }, 400);
    }
    console.error("[Simulator] Compare failed:", err);
    return c.json({ error: "internal_error", code: "internal_error", details: "Comparison failed" }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /agents — List agents available for simulation
// ---------------------------------------------------------------------------

simulatorRoutes.get("/agents", (c) => {
  const configs = getAgentConfigs();

  return c.json({
    agents: configs.map((config) => ({
      agentId: config.agentId,
      name: config.name,
      provider: config.provider,
      model: config.model,
      riskTolerance: config.riskTolerance,
      tradingStyle: config.tradingStyle,
    })),
    defaultConfig: {
      startingCapital: 10000,
      maxPositionAllocation: 0.25,
      minConfidenceThreshold: 40,
      skipHolds: true,
    },
  });
});
