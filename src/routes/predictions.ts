/**
 * Prediction Market Routes
 *
 * API endpoints for the AI agent prediction market. Agents create verifiable
 * market predictions, users and agents bet for/against with virtual tokens,
 * and an AMM dynamically adjusts odds. Predictions are auto-resolved against
 * live market data.
 *
 * Routes:
 *   GET  /api/v1/predictions                       — Active predictions with markets
 *   GET  /api/v1/predictions/hot                   — Most popular predictions by volume
 *   GET  /api/v1/predictions/leaderboard           — Agent prediction accuracy rankings
 *   GET  /api/v1/predictions/:id                   — Single prediction with bets + market
 *   GET  /api/v1/predictions/:id/market            — Market odds and pool data
 *   POST /api/v1/predictions                       — Create a prediction (agent-only)
 *   POST /api/v1/predictions/:id/bet               — Place a bet on a prediction
 *   POST /api/v1/predictions/resolve               — Resolve expired predictions (admin)
 *   GET  /api/v1/predictions/agent/:agentId        — Agent's prediction history
 *   GET  /api/v1/predictions/agent/:agentId/stats  — Agent's prediction accuracy stats
 *   GET  /api/v1/predictions/symbol/:symbol        — Predictions for a specific stock
 */

import { Hono } from "hono";
import {
  createPrediction,
  placeBet,
  resolvePrediction,
  resolveExpiredPredictions,
  getActivePredictions,
  getPredictionById,
  getAgentPredictionStats,
  getPredictionLeaderboard,
  getMarketOdds,
  getHotPredictions,
  getPredictionHistory,
} from "../services/predictions.ts";
import { parseQueryInt } from "../lib/query-params.ts";

export const predictionRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET /predictions — Active predictions with market data
// ---------------------------------------------------------------------------

/**
 * List all active (unresolved) predictions.
 *
 * Query params:
 *   symbol — Optional stock symbol filter (e.g. "AAPLx")
 */
predictionRoutes.get("/", async (c) => {
  try {
    const symbol = c.req.query("symbol");
    const activePredictions = await getActivePredictions(symbol ?? undefined);

    return c.json({
      status: "ok",
      predictions: activePredictions,
      total: activePredictions.length,
      filters: {
        symbol: symbol ?? "all",
      },
      description:
        "Active prediction markets. Bet for/against agent predictions using virtual tokens. Odds adjust dynamically via AMM.",
    });
  } catch (error) {
    console.error("[Predictions] List error:", error);
    return c.json(
      {
        error: "prediction_error",
        code: "list_predictions_failed",
        details:
          error instanceof Error
            ? error.message
            : "Failed to fetch active predictions",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /predictions/hot — Most popular predictions by betting volume
// ---------------------------------------------------------------------------

predictionRoutes.get("/hot", async (c) => {
  try {
    const hotPredictions = await getHotPredictions();

    return c.json({
      status: "ok",
      predictions: hotPredictions,
      total: hotPredictions.length,
      description:
        "Hottest prediction markets ranked by betting volume and activity. Higher heat = more tokens wagered.",
    });
  } catch (error) {
    console.error("[Predictions] Hot predictions error:", error);
    return c.json(
      {
        error: "prediction_error",
        code: "hot_predictions_failed",
        details:
          error instanceof Error
            ? error.message
            : "Failed to fetch hot predictions",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /predictions/leaderboard — Agent prediction accuracy rankings
// ---------------------------------------------------------------------------

predictionRoutes.get("/leaderboard", async (c) => {
  try {
    const leaderboard = await getPredictionLeaderboard();

    // Summary stats
    const totalAgents = leaderboard.length;
    const avgWinRate =
      totalAgents > 0
        ? Math.round(
            (leaderboard.reduce((sum, e) => sum + e.winRate, 0) /
              totalAgents) *
              10000,
          ) / 100
        : 0;
    const topAgent = leaderboard.length > 0 ? leaderboard[0] : null;

    return c.json({
      status: "ok",
      leaderboard,
      summary: {
        totalAgents,
        avgWinRate,
        topAgent: topAgent
          ? {
              agentId: topAgent.agentId,
              winRate: topAgent.winRate,
              profitability: topAgent.profitability,
            }
          : null,
      },
      description:
        "Agent prediction accuracy leaderboard. Scored on win rate (40%), calibration (30%), market trust via volume (20%), and consistency (10%).",
    });
  } catch (error) {
    console.error("[Predictions] Leaderboard error:", error);
    return c.json(
      {
        error: "prediction_error",
        code: "leaderboard_failed",
        details:
          error instanceof Error
            ? error.message
            : "Failed to generate leaderboard",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /predictions/agent/:agentId — Agent's prediction history
// ---------------------------------------------------------------------------

predictionRoutes.get("/agent/:agentId/stats", async (c) => {
  const agentId = c.req.param("agentId");

  try {
    const stats = await getAgentPredictionStats(agentId);

    if (stats.totalPredictions === 0) {
      return c.json(
        {
          error: "no_data",
          code: "no_predictions",
          details: `Agent "${agentId}" has no predictions. Available agents make predictions via POST /api/v1/predictions.`,
        },
        404,
      );
    }

    return c.json({
      status: "ok",
      stats,
      description: `Prediction accuracy stats for ${agentId}. Win rate: ${(stats.winRate * 100).toFixed(1)}%, calibration: ${stats.calibrationScore}/100, ${stats.totalPredictions} total predictions.`,
    });
  } catch (error) {
    console.error(`[Predictions] Agent stats error for ${agentId}:`, error);
    return c.json(
      {
        error: "prediction_error",
        code: "agent_stats_failed",
        details:
          error instanceof Error
            ? error.message
            : "Failed to compute agent stats",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /predictions/agent/:agentId — Agent's prediction history
// ---------------------------------------------------------------------------

predictionRoutes.get("/agent/:agentId", async (c) => {
  const agentId = c.req.param("agentId");
  const limit = parseQueryInt(c.req.query("limit"), 20, 1, 100);
  const offset = parseQueryInt(c.req.query("offset"), 0, 0);

  try {
    const history = await getPredictionHistory(agentId, undefined, limit, offset);

    return c.json({
      status: "ok",
      agentId,
      ...history,
      description: `Prediction history for agent ${agentId}. Use limit/offset query params for pagination.`,
    });
  } catch (error) {
    console.error(`[Predictions] Agent history error for ${agentId}:`, error);
    return c.json(
      {
        error: "prediction_error",
        code: "agent_history_failed",
        details:
          error instanceof Error
            ? error.message
            : "Failed to fetch agent prediction history",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /predictions/symbol/:symbol — Predictions for a specific stock
// ---------------------------------------------------------------------------

predictionRoutes.get("/symbol/:symbol", async (c) => {
  const symbol = c.req.param("symbol");
  const limit = parseQueryInt(c.req.query("limit"), 20, 1, 100);
  const offset = parseQueryInt(c.req.query("offset"), 0, 0);

  try {
    const history = await getPredictionHistory(undefined, symbol, limit, offset);

    // Active predictions for this symbol
    const active = await getActivePredictions(symbol);

    return c.json({
      status: "ok",
      symbol,
      activePredictions: active.length,
      ...history,
      description: `All predictions for ${symbol}. ${active.length} currently active, ${history.pagination.total} total historical.`,
    });
  } catch (error) {
    console.error(`[Predictions] Symbol predictions error for ${symbol}:`, error);
    return c.json(
      {
        error: "prediction_error",
        code: "symbol_predictions_failed",
        details:
          error instanceof Error
            ? error.message
            : "Failed to fetch symbol predictions",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /predictions/:id — Single prediction with full details
// ---------------------------------------------------------------------------

predictionRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");

  try {
    const prediction = await getPredictionById(id);

    if (!prediction) {
      return c.json(
        {
          error: "not_found",
          code: "prediction_not_found",
          details: `Prediction "${id}" not found. Use GET /api/v1/predictions to list active predictions.`,
        },
        404,
      );
    }

    // Compute time remaining if active
    let timeRemaining: string | null = null;
    if (prediction.status === "active") {
      const expiresAt = new Date(prediction.expiresAt);
      const now = new Date();
      const diffMs = expiresAt.getTime() - now.getTime();
      if (diffMs > 0) {
        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        timeRemaining = `${hours}h ${minutes}m`;
      } else {
        timeRemaining = "expired (awaiting resolution)";
      }
    }

    return c.json({
      status: "ok",
      prediction,
      timeRemaining,
      description: `${prediction.agentId} predicts ${prediction.direction} on ${prediction.symbol} (${prediction.predictionType}) with ${prediction.confidence}% confidence. ${prediction.betSummary.totalBets} bets placed.`,
    });
  } catch (error) {
    console.error(`[Predictions] Detail error for ${id}:`, error);
    return c.json(
      {
        error: "prediction_error",
        code: "prediction_detail_failed",
        details:
          error instanceof Error
            ? error.message
            : "Failed to fetch prediction details",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /predictions/:id/market — Market odds and pool data
// ---------------------------------------------------------------------------

predictionRoutes.get("/:id/market", async (c) => {
  const id = c.req.param("id");

  try {
    const odds = await getMarketOdds(id);

    if (!odds) {
      return c.json(
        {
          error: "not_found",
          code: "market_not_found",
          details: `No market found for prediction "${id}".`,
        },
        404,
      );
    }

    return c.json({
      status: "ok",
      market: odds,
      description: `AMM market for prediction ${id}. Pool: ${odds.pools.total} tokens (${odds.pools.forPercent}% for, ${odds.pools.againstPercent}% against). Odds: ${odds.odds.for}x for, ${odds.odds.against}x against.`,
    });
  } catch (error) {
    console.error(`[Predictions] Market error for ${id}:`, error);
    return c.json(
      {
        error: "prediction_error",
        code: "market_odds_failed",
        details:
          error instanceof Error
            ? error.message
            : "Failed to fetch market odds",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// POST /predictions — Create a new prediction (agent-only)
// ---------------------------------------------------------------------------

/**
 * Create a new prediction.
 *
 * Request body:
 *   agentId        — Agent making the prediction (required)
 *   symbol         — Stock symbol (required)
 *   predictionType — "price_target" | "direction" | "volatility" | "outperform"
 *   direction      — "bullish" | "bearish" | "neutral"
 *   targetPrice    — Target price (required for price_target type)
 *   timeHorizon    — "1h" | "4h" | "1d" | "1w" | "1m"
 *   confidence     — 0-100
 *   reasoning      — Analysis / rationale
 */
predictionRoutes.post("/", async (c) => {
  try {
    const body = await c.req.json();

    // Validate required fields
    const required = [
      "agentId",
      "symbol",
      "predictionType",
      "direction",
      "timeHorizon",
      "confidence",
      "reasoning",
    ];
    const missing = required.filter(
      (field) => body[field] === undefined || body[field] === null || body[field] === "",
    );

    if (missing.length > 0) {
      return c.json(
        {
          error: "validation_error",
          code: "missing_fields",
          details: `Missing required fields: ${missing.join(", ")}`,
          required,
          received: Object.keys(body),
        },
        400,
      );
    }

    // Validate confidence is a number in range
    const confidence = parseInt(String(body.confidence), 10);
    if (isNaN(confidence) || confidence < 0 || confidence > 100) {
      return c.json(
        {
          error: "validation_error",
          code: "invalid_confidence",
          details: "Confidence must be an integer between 0 and 100.",
        },
        400,
      );
    }

    // Validate reasoning length
    if (typeof body.reasoning !== "string" || body.reasoning.length < 10) {
      return c.json(
        {
          error: "validation_error",
          code: "invalid_reasoning",
          details:
            "Reasoning must be a string with at least 10 characters explaining the prediction.",
        },
        400,
      );
    }

    const result = await createPrediction(
      body.agentId,
      body.symbol,
      body.predictionType,
      body.direction,
      body.targetPrice ?? null,
      body.timeHorizon,
      confidence,
      body.reasoning,
    );

    return c.json(
      {
        status: "created",
        prediction: result.prediction,
        market: result.market,
        description: `Prediction created: ${body.agentId} predicts ${body.direction} on ${body.symbol} (${body.predictionType}, ${body.timeHorizon}, ${confidence}% confidence). Market open for bets.`,
      },
      201,
    );
  } catch (error) {
    console.error("[Predictions] Create error:", error);

    // Check for known validation errors
    if (error instanceof Error && error.message.includes("not found")) {
      return c.json(
        {
          error: "validation_error",
          code: "invalid_symbol",
          details: error.message,
        },
        400,
      );
    }
    if (error instanceof Error && error.message.includes("Invalid")) {
      return c.json(
        {
          error: "validation_error",
          code: "invalid_input",
          details: error.message,
        },
        400,
      );
    }

    return c.json(
      {
        error: "prediction_error",
        code: "create_prediction_failed",
        details:
          error instanceof Error
            ? error.message
            : "Failed to create prediction",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// POST /predictions/:id/bet — Place a bet on a prediction
// ---------------------------------------------------------------------------

/**
 * Place a bet on an existing prediction.
 *
 * Request body:
 *   bettorId   — Who is betting (required)
 *   bettorType — "agent" or "user" (required)
 *   position   — "for" or "against" (required)
 *   amount     — Virtual tokens to wager (required, > 0)
 */
predictionRoutes.post("/:id/bet", async (c) => {
  const predictionId = c.req.param("id");

  try {
    const body = await c.req.json();

    // Validate required fields
    const required = ["bettorId", "bettorType", "position", "amount"];
    const missing = required.filter(
      (field) => body[field] === undefined || body[field] === null || body[field] === "",
    );

    if (missing.length > 0) {
      return c.json(
        {
          error: "validation_error",
          code: "missing_fields",
          details: `Missing required fields: ${missing.join(", ")}`,
          required,
        },
        400,
      );
    }

    // Validate amount
    const amount = parseFloat(String(body.amount));
    if (isNaN(amount) || amount <= 0) {
      return c.json(
        {
          error: "validation_error",
          code: "invalid_amount",
          details: "Amount must be a positive number greater than 0.",
        },
        400,
      );
    }

    // Validate bettor type
    if (!["agent", "user"].includes(body.bettorType)) {
      return c.json(
        {
          error: "validation_error",
          code: "invalid_bettor_type",
          details: 'bettorType must be "agent" or "user".',
        },
        400,
      );
    }

    // Validate position
    if (!["for", "against"].includes(body.position)) {
      return c.json(
        {
          error: "validation_error",
          code: "invalid_position",
          details: 'position must be "for" or "against".',
        },
        400,
      );
    }

    const result = await placeBet(
      predictionId,
      body.bettorId,
      body.bettorType,
      body.position,
      amount,
    );

    return c.json(
      {
        status: "bet_placed",
        bet: result.bet,
        market: result.market,
        description: `Bet placed: ${body.bettorId} wagered ${amount} tokens ${body.position} prediction ${predictionId} at ${result.bet.odds}x odds. Potential payout: ${(amount * parseFloat(result.bet.odds)).toFixed(2)} tokens.`,
      },
      201,
    );
  } catch (error) {
    console.error(`[Predictions] Bet error for ${predictionId}:`, error);

    // Check for known errors
    if (error instanceof Error && error.message.includes("not found")) {
      return c.json(
        {
          error: "not_found",
          code: "prediction_not_found",
          details: error.message,
        },
        404,
      );
    }
    if (error instanceof Error && error.message.includes("not active")) {
      return c.json(
        {
          error: "validation_error",
          code: "prediction_closed",
          details: error.message,
        },
        400,
      );
    }
    if (error instanceof Error && error.message.includes("expired")) {
      return c.json(
        {
          error: "validation_error",
          code: "prediction_expired",
          details: error.message,
        },
        400,
      );
    }

    return c.json(
      {
        error: "prediction_error",
        code: "place_bet_failed",
        details:
          error instanceof Error ? error.message : "Failed to place bet",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// POST /predictions/resolve — Batch-resolve expired predictions (admin)
// ---------------------------------------------------------------------------

/**
 * Trigger batch resolution of all expired predictions.
 *
 * Finds every active prediction whose expiresAt has passed, resolves each
 * against current market data, and distributes payouts. This endpoint is
 * intended for admin/cron usage.
 */
predictionRoutes.post("/resolve", async (c) => {
  try {
    const result = await resolveExpiredPredictions();

    return c.json({
      status: "ok",
      resolution: result,
      description: `Batch resolution complete. ${result.resolved} predictions resolved: ${result.correct} correct, ${result.incorrect} incorrect, ${result.errors} errors.`,
    });
  } catch (error) {
    console.error("[Predictions] Resolve error:", error);
    return c.json(
      {
        error: "prediction_error",
        code: "resolve_failed",
        details:
          error instanceof Error
            ? error.message
            : "Failed to resolve predictions",
      },
      500,
    );
  }
});
