/**
 * Wallet Provisioning API Routes
 *
 * Manages Turnkey-based wallet creation and monitoring for AI agents.
 * Provides endpoints for provisioning, health checks, and status.
 */

import { Hono } from "hono";
import {
  provisionAllWallets,
  getProvisionedWallet,
  getAllProvisionedWallets,
  checkWalletHealth,
  checkAllWalletHealth,
  getProvisioningStatus,
} from "../services/wallet-provisioner.ts";
import { errorMessage } from "../lib/errors.ts";

export const walletProvisioningRoutes = new Hono();

// ---------------------------------------------------------------------------
// Provisioning
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/wallets/provision
 * Provision wallets for all 3 agents.
 * Idempotent — skips agents that already have wallets.
 */
walletProvisioningRoutes.post("/provision", async (c) => {
  try {
    const result = await provisionAllWallets();
    return c.json({
      data: result,
      message: result.success
        ? "All wallets provisioned successfully"
        : `Provisioning completed with ${result.errors.length} error(s)`,
    });
  } catch (err) {
    console.error("[WalletProvisioning] Provisioning error:", err);
    return c.json(
      {
        error: "provisioning_error",
        message: errorMessage(err),
      },
      500,
    );
  }
});

/**
 * GET /api/v1/wallets/status
 * Get provisioning status for all agents.
 */
walletProvisioningRoutes.get("/status", (c) => {
  const status = getProvisioningStatus();
  return c.json({ data: status });
});

/**
 * GET /api/v1/wallets/all
 * Get all provisioned wallets.
 */
walletProvisioningRoutes.get("/all", (c) => {
  const wallets = getAllProvisionedWallets();
  return c.json({ data: wallets });
});

/**
 * GET /api/v1/wallets/:agentId
 * Get wallet details for a specific agent.
 */
walletProvisioningRoutes.get("/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const wallet = getProvisionedWallet(agentId);

  if (!wallet) {
    return c.json(
      {
        error: "wallet_not_found",
        message: `No provisioned wallet for agent ${agentId}`,
      },
      404,
    );
  }

  return c.json({ data: wallet });
});

// ---------------------------------------------------------------------------
// Health Checks
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/wallets/health/all
 * Health check for all agent wallets.
 */
walletProvisioningRoutes.get("/health/all", async (c) => {
  try {
    const health = await checkAllWalletHealth();
    const allHealthy = health.every(
      (h) => h.hasSufficientFees && h.signerAvailable,
    );

    return c.json({
      data: {
        overall: allHealthy ? "healthy" : "degraded",
        wallets: health,
      },
    });
  } catch (err) {
    console.error("[WalletProvisioning] Health check error:", err);
    return c.json(
      {
        error: "health_check_error",
        message: errorMessage(err),
      },
      500,
    );
  }
});

/**
 * GET /api/v1/wallets/health/:agentId
 * Health check for a specific agent's wallet.
 */
walletProvisioningRoutes.get("/health/:agentId", async (c) => {
  const agentId = c.req.param("agentId");

  try {
    const health = await checkWalletHealth(agentId);
    return c.json({ data: health });
  } catch (err) {
    console.error(`[WalletProvisioning] Health check error for ${agentId}:`, err);
    return c.json(
      {
        error: "health_check_error",
        message: errorMessage(err),
      },
      500,
    );
  }
});
