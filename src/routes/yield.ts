/**
 * DeFi Yield Optimizer API Routes
 *
 * Manages idle USDC yield optimization across DeFi protocols.
 * Shows yield opportunities, active positions, and earnings.
 */

import { Hono } from "hono";
import {
  getYieldSummary,
  getProtocols,
  getEligibleProtocols,
  getAgentYieldPositions,
  getAgentClosedPositions,
  calculateOptimalAllocation,
  depositToYield,
  withdrawFromYield,
  emergencyWithdrawAll,
  getYieldConfig,
  configureYield,
  updateProtocolApy,
  updateProtocolStatus,
} from "../services/defi-yield.ts";
import { apiError, handleError } from "../lib/errors.ts";
import { round2 } from "../lib/math-utils.ts";

export const yieldRoutes = new Hono();

/**
 * GET / — Comprehensive yield summary
 */
yieldRoutes.get("/", (c) => {
  const summary = getYieldSummary();
  return c.json({
    ok: true,
    summary,
  });
});

/**
 * GET /protocols — All registered yield protocols
 */
yieldRoutes.get("/protocols", (c) => {
  const eligible = c.req.query("eligible") === "true";
  const list = eligible ? getEligibleProtocols() : getProtocols();
  return c.json({
    ok: true,
    count: list.length,
    protocols: list,
  });
});

/**
 * GET /agent/:agentId — Yield positions for a specific agent
 */
yieldRoutes.get("/agent/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const active = getAgentYieldPositions(agentId);
  const closed = getAgentClosedPositions(agentId, 10);

  const totalDeposited = active.reduce((s, p) => s + p.depositedAmount, 0);
  const totalValue = active.reduce((s, p) => s + p.currentValue, 0);
  const totalYield = active.reduce((s, p) => s + p.yieldEarned, 0);

  return c.json({
    ok: true,
    agentId,
    activePositions: active,
    closedPositions: closed,
    totals: {
      deposited: round2(totalDeposited),
      currentValue: round2(totalValue),
      yieldEarned: round2(totalYield),
    },
  });
});

/**
 * GET /agent/:agentId/optimal — Calculate optimal yield allocation
 */
yieldRoutes.get("/agent/:agentId/optimal", (c) => {
  const agentId = c.req.param("agentId");
  const idleCash = parseFloat(c.req.query("idleCash") ?? "1000");

  if (isNaN(idleCash) || idleCash < 0) {
    return apiError(c, "VALIDATION_FAILED", "idleCash must be a non-negative number");
  }

  const allocation = calculateOptimalAllocation(agentId, idleCash);
  return c.json({
    ok: true,
    allocation,
  });
});

/**
 * POST /deposit — Deposit idle cash into a yield protocol
 */
yieldRoutes.post("/deposit", async (c) => {
  try {
    const body = await c.req.json();
    const { agentId, protocolId, amount } = body;

    if (!agentId || !protocolId || !amount) {
      return apiError(c, "VALIDATION_FAILED", "agentId, protocolId, and amount are required");
    }

    const position = depositToYield(agentId, protocolId, parseFloat(amount));
    return c.json({
      ok: true,
      position,
    });
  } catch (err) {
    return handleError(c, err);
  }
});

/**
 * POST /withdraw — Withdraw from a yield position
 */
yieldRoutes.post("/withdraw", async (c) => {
  try {
    const body = await c.req.json();
    const { positionId } = body;

    if (!positionId) {
      return apiError(c, "VALIDATION_FAILED", "positionId is required");
    }

    const result = withdrawFromYield(positionId);
    return c.json({
      ok: true,
      ...result,
    });
  } catch (err) {
    return handleError(c, err);
  }
});

/**
 * POST /emergency-withdraw — Emergency withdraw all positions for an agent
 */
yieldRoutes.post("/emergency-withdraw", async (c) => {
  try {
    const body = await c.req.json();
    const { agentId } = body;

    if (!agentId) {
      return apiError(c, "VALIDATION_FAILED", "agentId is required");
    }

    const result = emergencyWithdrawAll(agentId);
    return c.json({
      ok: true,
      ...result,
    });
  } catch (err) {
    return handleError(c, err);
  }
});

/**
 * GET /config — Get yield optimization configuration
 */
yieldRoutes.get("/config", (c) => {
  return c.json({
    ok: true,
    config: getYieldConfig(),
  });
});

/**
 * POST /config — Update yield optimization configuration
 */
yieldRoutes.post("/config", async (c) => {
  const body = await c.req.json();
  const config = configureYield(body);
  return c.json({
    ok: true,
    config,
  });
});

/**
 * POST /protocols/:id/apy — Update a protocol's APY
 */
yieldRoutes.post("/protocols/:id/apy", async (c) => {
  const protocolId = c.req.param("id");
  const body = await c.req.json();
  const { apy } = body;

  if (typeof apy !== "number" || apy < 0) {
    return apiError(c, "VALIDATION_FAILED", "apy must be a non-negative number");
  }

  updateProtocolApy(protocolId, apy);
  return c.json({ ok: true, protocolId, newApy: apy });
});

/**
 * POST /protocols/:id/status — Update a protocol's status
 */
yieldRoutes.post("/protocols/:id/status", async (c) => {
  const protocolId = c.req.param("id");
  const body = await c.req.json();
  const { status } = body;

  if (!["active", "degraded", "paused"].includes(status)) {
    return apiError(c, "VALIDATION_FAILED", "status must be: active, degraded, or paused");
  }

  updateProtocolStatus(protocolId, status);
  return c.json({ ok: true, protocolId, newStatus: status });
});
