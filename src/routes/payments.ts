/**
 * Agent Payments & Tipping Routes
 *
 * x402-style agent tipping system. Tip agents for good trading calls,
 * track earnings, and view the tipping leaderboard.
 *
 * Routes:
 *   POST /api/v1/payments/tip                    — Tip an agent
 *   GET  /api/v1/payments/earnings/:agentId      — Agent's earnings profile
 *   GET  /api/v1/payments/leaderboard            — Earnings leaderboard
 *   GET  /api/v1/payments/history/:agentId       — Payment history for agent
 *   GET  /api/v1/payments/stats                  — Platform-wide payment stats
 */

import { Hono } from "hono";
import {
  sendTip,
  getAgentEarningsProfile,
  getEarningsLeaderboard,
  getAgentPaymentHistory,
} from "../services/payments.ts";
import { getAgentConfigs } from "../agents/orchestrator.ts";
import { parseQueryInt } from "../lib/query-params.js";
import { errorMessage } from "../lib/errors.ts";

export const paymentRoutes = new Hono();

// ---------------------------------------------------------------------------
// POST /payments/tip — Send a tip to an agent
// ---------------------------------------------------------------------------

paymentRoutes.post("/tip", async (c) => {
  try {
    const body = await c.req.json();

    // Validate required fields
    if (!body.fromId || typeof body.fromId !== "string") {
      return c.json(
        {
          error: "validation_error",
          code: "invalid_from_id",
          details: "fromId is required (string, max 64 chars)",
        },
        400,
      );
    }
    if (!body.fromName || typeof body.fromName !== "string") {
      return c.json(
        {
          error: "validation_error",
          code: "invalid_from_name",
          details: "fromName is required (string, max 64 chars)",
        },
        400,
      );
    }
    if (!body.toAgentId || typeof body.toAgentId !== "string") {
      return c.json(
        {
          error: "validation_error",
          code: "invalid_to_agent_id",
          details: `toAgentId is required. Valid IDs: ${getAgentConfigs().map((c) => c.agentId).join(", ")}`,
        },
        400,
      );
    }
    if (typeof body.amount !== "number" || body.amount <= 0) {
      return c.json(
        {
          error: "validation_error",
          code: "invalid_amount",
          details: "amount must be a positive number (in USDC)",
        },
        400,
      );
    }
    if (body.fromId.length > 64 || body.fromName.length > 64) {
      return c.json(
        {
          error: "validation_error",
          code: "field_too_long",
          details: "fromId and fromName must be <= 64 characters",
        },
        400,
      );
    }
    if (body.message && (typeof body.message !== "string" || body.message.length > 500)) {
      return c.json(
        {
          error: "validation_error",
          code: "invalid_message",
          details: "message must be a string, max 500 characters",
        },
        400,
      );
    }

    const result = await sendTip({
      fromId: body.fromId.slice(0, 64),
      fromName: body.fromName.slice(0, 64),
      toAgentId: body.toAgentId,
      amount: body.amount,
      currency: body.currency ?? "USDC",
      decisionId: body.decisionId,
      message: body.message?.slice(0, 500),
      txSignature: body.txSignature,
    });

    return c.json(
      {
        status: "ok",
        tip: result,
        message: `Successfully tipped ${result.toAgentName} ${result.amount} ${result.currency}`,
      },
      201,
    );
  } catch (error) {
    console.error("[Payments] Tip error:", error);
    const message = errorMessage(error);

    if (
      message.includes("not found") ||
      message.includes("belongs to")
    ) {
      return c.json(
        { error: "validation_error", code: "invalid_request", details: message },
        400,
      );
    }

    return c.json(
      { error: "payment_error", code: "tip_failed", details: message },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /payments/earnings/:agentId — Agent's earnings profile
// ---------------------------------------------------------------------------

paymentRoutes.get("/earnings/:agentId", async (c) => {
  const agentId = c.req.param("agentId");

  try {
    const earnings = await getAgentEarningsProfile(agentId);

    if (!earnings) {
      return c.json(
        {
          error: "agent_not_found",
          code: "agent_not_found",
          details: `No agent with ID "${agentId}". Valid IDs: ${getAgentConfigs().map((c) => c.agentId).join(", ")}`,
        },
        404,
      );
    }

    return c.json({
      earnings,
      description: `${earnings.agentName} has earned $${earnings.totalEarnings.toFixed(2)} USDC from ${earnings.tipCount} tips by ${earnings.uniqueTippers} unique supporters.`,
    });
  } catch (error) {
    console.error(`[Payments] Earnings error for ${agentId}:`, error);
    return c.json(
      {
        error: "payment_error",
        code: "earnings_failed",
        details: errorMessage(error),
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /payments/leaderboard — Earnings leaderboard
// ---------------------------------------------------------------------------

paymentRoutes.get("/leaderboard", async (c) => {
  try {
    const leaderboard = await getEarningsLeaderboard();

    return c.json({
      leaderboard: leaderboard.entries,
      platformStats: leaderboard.platformStats,
      description:
        "Agent earnings leaderboard ranked by total tips received. Tip your favorite agent for making great calls!",
    });
  } catch (error) {
    console.error("[Payments] Leaderboard error:", error);
    return c.json(
      {
        error: "payment_error",
        code: "leaderboard_failed",
        details: errorMessage(error),
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /payments/history/:agentId — Payment history
// ---------------------------------------------------------------------------

paymentRoutes.get("/history/:agentId", async (c) => {
  const agentId = c.req.param("agentId");
  const config = getAgentConfigs().find((c) => c.agentId === agentId);

  if (!config) {
    return c.json(
      {
        error: "agent_not_found",
        code: "agent_not_found",
        details: `No agent with ID "${agentId}"`,
      },
      404,
    );
  }

  try {
    const limit = parseQueryInt(c.req.query("limit"), 50, 1, 100);
    const offset = parseQueryInt(c.req.query("offset"), 0, 0);

    const history = await getAgentPaymentHistory(agentId, limit, offset);

    return c.json({
      agentId,
      agentName: config.name,
      payments: history.payments,
      total: history.total,
      limit: history.limit,
      offset: history.offset,
    });
  } catch (error) {
    console.error(`[Payments] History error for ${agentId}:`, error);
    return c.json(
      {
        error: "payment_error",
        code: "history_failed",
        details: errorMessage(error),
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /payments/stats — Platform-wide payment stats
// ---------------------------------------------------------------------------

paymentRoutes.get("/stats", async (c) => {
  try {
    const leaderboard = await getEarningsLeaderboard();

    return c.json({
      stats: leaderboard.platformStats,
      topEarner: leaderboard.entries[0] ?? null,
      description:
        "Platform-wide payment statistics — total tip volume, unique tippers, and top earners across all AI trading agents.",
    });
  } catch (error) {
    console.error("[Payments] Stats error:", error);
    return c.json(
      {
        error: "payment_error",
        code: "stats_failed",
        details: errorMessage(error),
      },
      500,
    );
  }
});
