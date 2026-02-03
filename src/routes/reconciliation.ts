/**
 * Position Reconciliation API
 *
 * Provides on-chain verification of agent positions. Compares what
 * MoltApp's database says agents own vs. what's actually in their
 * Solana wallets on-chain.
 *
 * Endpoints:
 * - GET /reconcile/:agentId — Full reconciliation report for an agent
 * - GET /reconcile/all — Reconcile all agents
 * - GET /reconcile/verify/:walletAddress/:mintAddress — Quick position verify
 * - GET /reconcile/stats — Reconciler system stats
 */

import { Hono } from "hono";
import {
  reconcileAgent,
  reconcileAllAgents,
  verifyPosition,
  getReconcilerStats,
} from "../services/position-reconciler.ts";
import { getAgentWallet } from "../services/agent-wallets.ts";

const reconciliation = new Hono();

const AGENT_IDS = ["claude-value-investor", "gpt-momentum-trader", "grok-contrarian"];

/** Helper to extract wallet address from agent config */
function getAgentWalletAddress(agentId: string): string | null {
  const wallet = getAgentWallet(agentId);
  return wallet?.publicKey ?? null;
}

// ---------------------------------------------------------------------------
// GET /reconcile/stats — Reconciler system stats
// ---------------------------------------------------------------------------

reconciliation.get("/stats", (c) => {
  return c.json(getReconcilerStats());
});

// ---------------------------------------------------------------------------
// GET /reconcile/all — Reconcile all agents
// ---------------------------------------------------------------------------

reconciliation.get("/all", async (c) => {
  const walletMap = new Map<string, string>();

  for (const agentId of AGENT_IDS) {
    const walletAddr = getAgentWalletAddress(agentId);
    if (walletAddr) {
      walletMap.set(agentId, walletAddr);
    }
  }

  if (walletMap.size === 0) {
    return c.json({
      reports: [],
      message: "No agent wallets configured. Set agent wallet addresses in environment.",
    });
  }

  const reports = await reconcileAllAgents(walletMap);

  return c.json({
    reports: reports.map((r) => ({
      agentId: r.agentId,
      walletAddress: r.walletAddress,
      solBalance: r.solBalance,
      summary: r.summary,
      positions: r.positions.length,
      durationMs: r.durationMs,
      reconciledAt: r.reconciledAt,
    })),
    overallHealth: reports.every((r) => r.summary.overallStatus === "healthy")
      ? "healthy"
      : reports.some((r) => r.summary.overallStatus === "critical")
        ? "critical"
        : "warning",
    agentsChecked: reports.length,
  });
});

// ---------------------------------------------------------------------------
// GET /reconcile/verify/:walletAddress/:mintAddress — Quick position verify
// ---------------------------------------------------------------------------

reconciliation.get("/verify/:walletAddress/:mintAddress", async (c) => {
  const walletAddress = c.req.param("walletAddress");
  const mintAddress = c.req.param("mintAddress");
  const expectedQty = parseFloat(c.req.query("expected") ?? "0");

  const result = await verifyPosition(walletAddress, mintAddress, expectedQty);

  return c.json({
    walletAddress,
    mintAddress,
    expectedQuantity: expectedQty,
    ...result,
  });
});

// ---------------------------------------------------------------------------
// GET /reconcile/:agentId — Full reconciliation report
// ---------------------------------------------------------------------------

reconciliation.get("/:agentId", async (c) => {
  const agentId = c.req.param("agentId");
  const walletAddr = getAgentWalletAddress(agentId);

  if (!walletAddr) {
    return c.json(
      {
        error: "Wallet not configured",
        agentId,
        message: `No wallet address configured for agent ${agentId}. Set in environment.`,
      },
      400,
    );
  }

  const report = await reconcileAgent(agentId, walletAddr);

  return c.json(report);
});

export { reconciliation as reconciliationRoutes };
