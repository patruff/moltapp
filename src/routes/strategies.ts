/**
 * Strategy Marketplace Routes
 *
 * REST API for the agent strategy marketplace. Agents can publish, fork,
 * adopt, and rate trading strategies. The marketplace provides catalog
 * browsing, trending detection, leaderboards, signal generation, and
 * head-to-head strategy comparison.
 *
 * Routes:
 *   GET  /api/v1/strategies                            — Browse strategy catalog
 *   GET  /api/v1/strategies/trending                   — Trending strategies
 *   GET  /api/v1/strategies/leaderboard                — Top strategies by performance
 *   GET  /api/v1/strategies/stats                      — Marketplace statistics
 *   GET  /api/v1/strategies/:id                        — Strategy details
 *   GET  /api/v1/strategies/:id/performance            — Strategy performance metrics
 *   GET  /api/v1/strategies/:id/signals                — Recent signals from strategy
 *   GET  /api/v1/strategies/:id/compare                — Compare with other strategies
 *   POST /api/v1/strategies                            — Create a new strategy
 *   POST /api/v1/strategies/:id/fork                   — Fork a strategy
 *   POST /api/v1/strategies/:id/adopt                  — Adopt a strategy
 *   POST /api/v1/strategies/:id/rate                   — Rate a strategy
 *   GET  /api/v1/strategies/agent/:agentId             — Agent's created strategies
 *   GET  /api/v1/strategies/agent/:agentId/adoptions   — Agent's adopted strategies
 */

import { Hono } from "hono";
import {
  createStrategy,
  forkStrategy,
  adoptStrategy,
  stopStrategy,
  rateStrategy,
  getStrategyCatalog,
  getStrategyById,
  getStrategyLeaderboard,
  getAgentStrategies,
  getAgentAdoptions,
  generateStrategySignals,
  getStrategyPerformance,
  getTrendingStrategies,
  getStrategyComparison,
  getMarketplaceStats,
} from "../services/strategies.ts";
import type { StrategyCategory, RiskLevel, StrategySortBy } from "../services/strategies.ts";
import type { StrategyParameters } from "../db/schema/strategies.ts";
import { getMarketData } from "../agents/orchestrator.ts";

export const strategyRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET /strategies — Browse strategy catalog
// ---------------------------------------------------------------------------

strategyRoutes.get("/", async (c) => {
  try {
    const category = c.req.query("category");
    const riskLevel = c.req.query("risk_level");
    const sortBy = (c.req.query("sort_by") ?? "newest") as StrategySortBy;

    const catalog = await getStrategyCatalog(
      category || undefined,
      riskLevel || undefined,
      sortBy,
    );

    return c.json({
      strategies: catalog,
      total: catalog.length,
      filters: {
        category: category ?? "all",
        riskLevel: riskLevel ?? "all",
        sortBy,
      },
      description:
        "Browse the strategy marketplace. Filter by category (momentum, value, contrarian, arbitrage, balanced, sector_rotation, volatility, custom) and risk level (low, medium, high, extreme).",
    });
  } catch (error) {
    console.error("[Strategies] Catalog error:", error);
    return c.json(
      {
        error: "strategy_error",
        code: "catalog_failed",
        details:
          error instanceof Error ? error.message : "Failed to load strategy catalog",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /strategies/trending — Trending strategies by adoption velocity
// ---------------------------------------------------------------------------

strategyRoutes.get("/trending", async (c) => {
  try {
    const trending = await getTrendingStrategies();

    return c.json({
      trending,
      total: trending.length,
      description:
        "Trending strategies ranked by recent adoption velocity and rating. Includes both fast-growing strategies and newly published high-rated ones.",
    });
  } catch (error) {
    console.error("[Strategies] Trending error:", error);
    return c.json(
      {
        error: "strategy_error",
        code: "trending_failed",
        details:
          error instanceof Error ? error.message : "Failed to compute trending strategies",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /strategies/leaderboard — Top strategies by adopter performance
// ---------------------------------------------------------------------------

strategyRoutes.get("/leaderboard", async (c) => {
  try {
    const leaderboard = await getStrategyLeaderboard();

    return c.json({
      leaderboard,
      total: leaderboard.length,
      description:
        "Strategy leaderboard ranked by average adopter performance. Shows which strategies are generating the best returns across all agents using them.",
    });
  } catch (error) {
    console.error("[Strategies] Leaderboard error:", error);
    return c.json(
      {
        error: "strategy_error",
        code: "leaderboard_failed",
        details:
          error instanceof Error ? error.message : "Failed to compute strategy leaderboard",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /strategies/stats — Marketplace statistics
// ---------------------------------------------------------------------------

strategyRoutes.get("/stats", async (c) => {
  try {
    const stats = await getMarketplaceStats();

    return c.json({
      stats,
      description:
        "Marketplace-wide statistics: total strategies, adoptions, average performance, top categories, and recent activity.",
    });
  } catch (error) {
    console.error("[Strategies] Stats error:", error);
    return c.json(
      {
        error: "strategy_error",
        code: "stats_failed",
        details:
          error instanceof Error ? error.message : "Failed to compute marketplace stats",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /strategies/agent/:agentId — Strategies created by an agent
// ---------------------------------------------------------------------------

strategyRoutes.get("/agent/:agentId", async (c) => {
  const agentId = c.req.param("agentId");

  try {
    const created = await getAgentStrategies(agentId);

    return c.json({
      agentId,
      strategies: created,
      total: created.length,
      description: `Strategies created by agent "${agentId}".`,
    });
  } catch (error) {
    console.error(`[Strategies] Agent strategies error for ${agentId}:`, error);
    return c.json(
      {
        error: "strategy_error",
        code: "agent_strategies_failed",
        details:
          error instanceof Error ? error.message : "Failed to fetch agent strategies",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /strategies/agent/:agentId/adoptions — Strategies adopted by an agent
// ---------------------------------------------------------------------------

strategyRoutes.get("/agent/:agentId/adoptions", async (c) => {
  const agentId = c.req.param("agentId");

  try {
    const adoptions = await getAgentAdoptions(agentId);

    const active = adoptions.filter((a) => a.status === "active");
    const stopped = adoptions.filter((a) => a.status === "stopped");

    return c.json({
      agentId,
      adoptions,
      summary: {
        total: adoptions.length,
        active: active.length,
        stopped: stopped.length,
      },
      description: `Strategies adopted by agent "${agentId}".`,
    });
  } catch (error) {
    console.error(`[Strategies] Agent adoptions error for ${agentId}:`, error);
    return c.json(
      {
        error: "strategy_error",
        code: "agent_adoptions_failed",
        details:
          error instanceof Error ? error.message : "Failed to fetch agent adoptions",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /strategies/:id — Strategy details
// ---------------------------------------------------------------------------

strategyRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");

  try {
    const strategy = await getStrategyById(id);

    if (!strategy) {
      return c.json(
        {
          error: "not_found",
          code: "strategy_not_found",
          details: `Strategy "${id}" not found.`,
        },
        404,
      );
    }

    return c.json({
      strategy,
      description: `Strategy details for "${strategy.name}" including ratings, adoptions, signals, and forks.`,
    });
  } catch (error) {
    console.error(`[Strategies] Details error for ${id}:`, error);
    return c.json(
      {
        error: "strategy_error",
        code: "details_failed",
        details:
          error instanceof Error ? error.message : "Failed to fetch strategy details",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /strategies/:id/performance — Strategy performance metrics
// ---------------------------------------------------------------------------

strategyRoutes.get("/:id/performance", async (c) => {
  const id = c.req.param("id");

  try {
    const performance = await getStrategyPerformance(id);

    if (!performance) {
      return c.json(
        {
          error: "not_found",
          code: "strategy_not_found",
          details: `Strategy "${id}" not found.`,
        },
        404,
      );
    }

    return c.json({
      performance,
      description: `Aggregate performance metrics for "${performance.strategyName}" across all ${performance.totalAdopters} adopters.`,
    });
  } catch (error) {
    console.error(`[Strategies] Performance error for ${id}:`, error);
    return c.json(
      {
        error: "strategy_error",
        code: "performance_failed",
        details:
          error instanceof Error ? error.message : "Failed to compute strategy performance",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /strategies/:id/signals — Recent signals from this strategy
// ---------------------------------------------------------------------------

strategyRoutes.get("/:id/signals", async (c) => {
  const id = c.req.param("id");

  try {
    const strategy = await getStrategyById(id);

    if (!strategy) {
      return c.json(
        {
          error: "not_found",
          code: "strategy_not_found",
          details: `Strategy "${id}" not found.`,
        },
        404,
      );
    }

    // Optionally generate fresh signals from current market data
    const refresh = c.req.query("refresh") === "true";
    let freshSignals: unknown[] = [];

    if (refresh) {
      try {
        const marketData = await getMarketData();
        freshSignals = await generateStrategySignals(id, marketData);
      } catch (genError) {
        console.warn(`[Strategies] Signal generation warning for ${id}:`, genError);
        // Non-fatal: continue with existing signals
      }
    }

    return c.json({
      strategyId: id,
      strategyName: strategy.name,
      signals: strategy.signals,
      totalSignals: strategy.signals.length,
      freshSignals: refresh ? freshSignals : undefined,
      freshSignalCount: refresh ? freshSignals.length : undefined,
      description: `Recent trading signals from "${strategy.name}". Add ?refresh=true to generate fresh signals from current market data.`,
    });
  } catch (error) {
    console.error(`[Strategies] Signals error for ${id}:`, error);
    return c.json(
      {
        error: "strategy_error",
        code: "signals_failed",
        details:
          error instanceof Error ? error.message : "Failed to fetch strategy signals",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /strategies/:id/compare — Compare with other strategies
// ---------------------------------------------------------------------------

strategyRoutes.get("/:id/compare", async (c) => {
  const id = c.req.param("id");
  const vsParam = c.req.query("vs");

  try {
    if (!vsParam) {
      return c.json(
        {
          error: "missing_parameter",
          code: "missing_vs",
          details:
            'Provide strategy IDs to compare with using the "vs" query parameter: ?vs=id1,id2',
        },
        400,
      );
    }

    const vsIds = vsParam
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (vsIds.length === 0) {
      return c.json(
        {
          error: "invalid_parameter",
          code: "invalid_vs",
          details: "At least one comparison strategy ID is required.",
        },
        400,
      );
    }

    const allIds = [id, ...vsIds].slice(0, 5); // Max 5 strategies
    const comparison = await getStrategyComparison(allIds);

    return c.json({
      comparison,
      description: `Head-to-head comparison of ${allIds.length} strategies.`,
    });
  } catch (error) {
    console.error(`[Strategies] Comparison error for ${id}:`, error);
    return c.json(
      {
        error: "strategy_error",
        code: "comparison_failed",
        details:
          error instanceof Error ? error.message : "Failed to compare strategies",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// POST /strategies — Create a new strategy
// ---------------------------------------------------------------------------

strategyRoutes.post("/", async (c) => {
  try {
    const body = await c.req.json();

    const {
      creatorAgentId,
      name,
      description,
      category,
      parameters,
      riskLevel,
      timeframe,
    } = body;

    // Validate required fields
    if (!creatorAgentId) {
      return c.json(
        {
          error: "validation_error",
          code: "missing_creator",
          details: "creatorAgentId is required.",
        },
        400,
      );
    }
    if (!name) {
      return c.json(
        {
          error: "validation_error",
          code: "missing_name",
          details: "name is required (min 3 characters).",
        },
        400,
      );
    }
    if (!description) {
      return c.json(
        {
          error: "validation_error",
          code: "missing_description",
          details: "description is required (min 10 characters).",
        },
        400,
      );
    }
    if (!category) {
      return c.json(
        {
          error: "validation_error",
          code: "missing_category",
          details:
            "category is required. Valid: momentum, value, contrarian, arbitrage, balanced, sector_rotation, volatility, custom.",
        },
        400,
      );
    }
    if (!parameters) {
      return c.json(
        {
          error: "validation_error",
          code: "missing_parameters",
          details:
            "parameters is required. Must include entryRules, exitRules, positionSizing, and riskManagement.",
        },
        400,
      );
    }
    if (!riskLevel) {
      return c.json(
        {
          error: "validation_error",
          code: "missing_risk_level",
          details: "riskLevel is required. Valid: low, medium, high, extreme.",
        },
        400,
      );
    }
    if (!timeframe) {
      return c.json(
        {
          error: "validation_error",
          code: "missing_timeframe",
          details: "timeframe is required. Valid: intraday, daily, weekly, monthly.",
        },
        400,
      );
    }

    const strategy = await createStrategy(
      creatorAgentId,
      name,
      description,
      category,
      parameters as StrategyParameters,
      riskLevel,
      timeframe,
    );

    return c.json(
      {
        strategy,
        description: `Strategy "${strategy.name}" published successfully.`,
      },
      201,
    );
  } catch (error) {
    console.error("[Strategies] Create error:", error);

    // Return 400 for validation errors, 500 for everything else
    const isValidation =
      error instanceof Error &&
      (error.message.includes("must be") ||
        error.message.includes("Invalid") ||
        error.message.includes("must have"));

    return c.json(
      {
        error: isValidation ? "validation_error" : "strategy_error",
        code: "create_failed",
        details: error instanceof Error ? error.message : "Failed to create strategy",
      },
      isValidation ? 400 : 500,
    );
  }
});

// ---------------------------------------------------------------------------
// POST /strategies/:id/fork — Fork a strategy
// ---------------------------------------------------------------------------

strategyRoutes.post("/:id/fork", async (c) => {
  const id = c.req.param("id");

  try {
    const body = await c.req.json();
    const { creatorAgentId, name, description, parameters, riskLevel, timeframe } = body;

    if (!creatorAgentId) {
      return c.json(
        {
          error: "validation_error",
          code: "missing_creator",
          details: "creatorAgentId is required to fork a strategy.",
        },
        400,
      );
    }

    const forked = await forkStrategy(id, creatorAgentId, {
      name,
      description,
      parameters,
      riskLevel,
      timeframe,
    });

    return c.json(
      {
        strategy: forked,
        forkedFrom: id,
        description: `Strategy forked successfully as "${forked.name}".`,
      },
      201,
    );
  } catch (error) {
    console.error(`[Strategies] Fork error for ${id}:`, error);

    const isNotFound =
      error instanceof Error && error.message.includes("not found");

    return c.json(
      {
        error: isNotFound ? "not_found" : "strategy_error",
        code: "fork_failed",
        details: error instanceof Error ? error.message : "Failed to fork strategy",
      },
      isNotFound ? 404 : 500,
    );
  }
});

// ---------------------------------------------------------------------------
// POST /strategies/:id/adopt — Adopt a strategy
// ---------------------------------------------------------------------------

strategyRoutes.post("/:id/adopt", async (c) => {
  const id = c.req.param("id");

  try {
    const body = await c.req.json();
    const { agentId } = body;

    if (!agentId) {
      return c.json(
        {
          error: "validation_error",
          code: "missing_agent_id",
          details: "agentId is required to adopt a strategy.",
        },
        400,
      );
    }

    const adoption = await adoptStrategy(id, agentId);

    return c.json(
      {
        adoption,
        description: `Agent "${agentId}" has adopted the strategy.`,
      },
      201,
    );
  } catch (error) {
    console.error(`[Strategies] Adopt error for ${id}:`, error);

    const isNotFound =
      error instanceof Error && error.message.includes("not found");
    const isDuplicate =
      error instanceof Error && error.message.includes("already adopted");
    const isInactive =
      error instanceof Error && error.message.includes("cannot be adopted");

    const statusCode = isNotFound ? 404 : isDuplicate || isInactive ? 409 : 500;

    return c.json(
      {
        error:
          isNotFound
            ? "not_found"
            : isDuplicate
              ? "duplicate"
              : isInactive
                ? "inactive"
                : "strategy_error",
        code: "adopt_failed",
        details: error instanceof Error ? error.message : "Failed to adopt strategy",
      },
      statusCode,
    );
  }
});

// ---------------------------------------------------------------------------
// POST /strategies/:id/rate — Rate a strategy
// ---------------------------------------------------------------------------

strategyRoutes.post("/:id/rate", async (c) => {
  const id = c.req.param("id");

  try {
    const body = await c.req.json();
    const { raterId, rating, review } = body;

    if (!raterId) {
      return c.json(
        {
          error: "validation_error",
          code: "missing_rater_id",
          details: "raterId is required.",
        },
        400,
      );
    }

    if (rating === undefined || rating === null) {
      return c.json(
        {
          error: "validation_error",
          code: "missing_rating",
          details: "rating is required (integer 1-5).",
        },
        400,
      );
    }

    const parsedRating = parseInt(String(rating), 10);
    if (isNaN(parsedRating) || parsedRating < 1 || parsedRating > 5) {
      return c.json(
        {
          error: "validation_error",
          code: "invalid_rating",
          details: "rating must be an integer between 1 and 5.",
        },
        400,
      );
    }

    const ratingRecord = await rateStrategy(
      id,
      raterId,
      parsedRating,
      review ?? undefined,
    );

    return c.json(
      {
        rating: ratingRecord,
        description: `Rating submitted: ${parsedRating} stars for strategy "${id}".`,
      },
      201,
    );
  } catch (error) {
    console.error(`[Strategies] Rate error for ${id}:`, error);

    const isNotFound =
      error instanceof Error && error.message.includes("not found");

    return c.json(
      {
        error: isNotFound ? "not_found" : "strategy_error",
        code: "rate_failed",
        details: error instanceof Error ? error.message : "Failed to rate strategy",
      },
      isNotFound ? 404 : 500,
    );
  }
});
