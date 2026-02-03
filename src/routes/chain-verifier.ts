/**
 * On-Chain Verification Routes
 *
 * Prove that MoltApp trades are REAL by verifying them on Solana blockchain.
 * This is the transparency layer that separates MoltApp from paper-trading platforms.
 *
 * Routes:
 *   GET  /api/v1/verify/tx/:signature              — Verify a single transaction
 *   GET  /api/v1/verify/tx/:signature/details       — Full on-chain transaction details
 *   GET  /api/v1/verify/trade/:tradeId              — Generate complete trade proof
 *   POST /api/v1/verify/round/:roundId              — Batch verify all trades in a round
 *   GET  /api/v1/verify/wallet/:address             — On-chain balance snapshot
 *   GET  /api/v1/verify/wallet/:address/tokens      — All SPL token balances
 *   GET  /api/v1/verify/explorer-links              — Generate explorer links
 */

import { Hono } from "hono";
import {
  verifyTransaction,
  getTransactionDetails,
  getOnChainBalance,
  batchVerifyRound,
  generateTradeProof,
  getExplorerUrls,
} from "../services/chain-verifier.ts";
import { db } from "../db/index.ts";
import { trades } from "../db/schema/index.ts";
import { eq } from "drizzle-orm";
import { getAgentConfig } from "../agents/orchestrator.ts";

export const chainVerifierRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET /tx/:signature — Verify a single transaction on Solana
// ---------------------------------------------------------------------------

chainVerifierRoutes.get("/tx/:signature", async (c) => {
  const signature = c.req.param("signature");

  if (!signature || signature.length < 32) {
    return c.json(
      { error: "validation_error", code: "validation_error", details: "Invalid transaction signature" },
      400,
    );
  }

  try {
    const verification = await verifyTransaction(signature);

    return c.json({
      verification,
      message: verification.verified
        ? "Transaction verified on Solana blockchain"
        : `Transaction verification failed: ${verification.err ?? "not confirmed"}`,
    });
  } catch (err) {
    console.error("[ChainVerifier] Verify tx failed:", err);
    return c.json(
      { error: "verification_failed", code: "verification_failed", details: "Failed to verify transaction on chain" },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /tx/:signature/details — Full on-chain transaction details
// ---------------------------------------------------------------------------

chainVerifierRoutes.get("/tx/:signature/details", async (c) => {
  const signature = c.req.param("signature");

  if (!signature || signature.length < 32) {
    return c.json(
      { error: "validation_error", code: "validation_error", details: "Invalid transaction signature" },
      400,
    );
  }

  try {
    const details = await getTransactionDetails(signature);

    if (!details) {
      return c.json(
        { error: "not_found", code: "not_found", details: "Transaction not found on chain" },
        404,
      );
    }

    return c.json({
      transaction: details,
      verified: details.success,
      message: details.success
        ? `Transaction confirmed at slot ${details.slot} with fee ${details.feeSol} SOL`
        : "Transaction found but execution failed",
    });
  } catch (err) {
    console.error("[ChainVerifier] Get tx details failed:", err);
    return c.json(
      { error: "internal_error", code: "internal_error", details: "Failed to fetch transaction details" },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /trade/:tradeId — Generate complete trade proof
// ---------------------------------------------------------------------------

chainVerifierRoutes.get("/trade/:tradeId", async (c) => {
  const tradeIdStr = c.req.param("tradeId");
  const tradeId = parseInt(tradeIdStr, 10);

  if (isNaN(tradeId)) {
    return c.json(
      { error: "validation_error", code: "validation_error", details: "tradeId must be a number" },
      400,
    );
  }

  try {
    // Look up trade in database
    const tradeRecords = await db
      .select()
      .from(trades)
      .where(eq(trades.id, tradeId))
      .limit(1);

    if (tradeRecords.length === 0) {
      return c.json(
        { error: "not_found", code: "not_found", details: `Trade ${tradeId} not found` },
        404,
      );
    }

    const trade = tradeRecords[0];

    if (!trade.txSignature) {
      return c.json(
        { error: "no_signature", code: "no_signature", details: "Trade has no on-chain transaction (may be a simulated trade)" },
        404,
      );
    }

    const config = getAgentConfig(trade.agentId);
    const proof = await generateTradeProof({
      tradeId: trade.id,
      txSignature: trade.txSignature,
      agentId: trade.agentId,
      agentName: config?.name ?? trade.agentId,
      side: trade.side,
      symbol: trade.stockSymbol,
      quantity: trade.stockQuantity,
      usdcAmount: trade.usdcAmount,
    });

    return c.json({
      proof,
      message: proof.verification.verified
        ? "Trade verified on Solana blockchain — this is a REAL trade"
        : `Trade verification status: ${proof.verification.confirmationStatus}`,
    });
  } catch (err) {
    console.error("[ChainVerifier] Trade proof failed:", err);
    return c.json(
      { error: "internal_error", code: "internal_error", details: "Failed to generate trade proof" },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// POST /round/:roundId — Batch verify all trades in a round
// ---------------------------------------------------------------------------

chainVerifierRoutes.post("/round/:roundId", async (c) => {
  const roundId = c.req.param("roundId");

  try {
    const body = await c.req.json().catch(() => ({}));
    const signatures: string[] = body.signatures ?? [];

    if (signatures.length === 0) {
      return c.json(
        { error: "validation_error", code: "validation_error", details: "signatures array is required" },
        400,
      );
    }

    if (signatures.length > 20) {
      return c.json(
        { error: "validation_error", code: "validation_error", details: "Maximum 20 signatures per batch" },
        400,
      );
    }

    const result = await batchVerifyRound(roundId, signatures);

    return c.json({
      result,
      message: result.allVerified
        ? `All ${result.verifiedCount} transactions verified on Solana`
        : `${result.verifiedCount}/${result.totalTransactions} transactions verified`,
    });
  } catch (err) {
    console.error("[ChainVerifier] Batch verify failed:", err);
    return c.json(
      { error: "internal_error", code: "internal_error", details: "Failed to batch verify round" },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /wallet/:address — On-chain balance snapshot
// ---------------------------------------------------------------------------

chainVerifierRoutes.get("/wallet/:address", async (c) => {
  const walletAddress = c.req.param("address");

  if (!walletAddress || walletAddress.length < 32) {
    return c.json(
      { error: "validation_error", code: "validation_error", details: "Invalid wallet address" },
      400,
    );
  }

  try {
    const balance = await getOnChainBalance(walletAddress);

    return c.json({
      balance,
      tokenCount: balance.tokenBalances.length,
      message: `Wallet holds ${balance.solBalanceFormatted} and ${balance.tokenBalances.length} SPL tokens`,
    });
  } catch (err) {
    console.error("[ChainVerifier] Wallet balance failed:", err);
    return c.json(
      { error: "internal_error", code: "internal_error", details: "Failed to fetch on-chain balance" },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /wallet/:address/tokens — SPL token balances only
// ---------------------------------------------------------------------------

chainVerifierRoutes.get("/wallet/:address/tokens", async (c) => {
  const walletAddress = c.req.param("address");

  if (!walletAddress || walletAddress.length < 32) {
    return c.json(
      { error: "validation_error", code: "validation_error", details: "Invalid wallet address" },
      400,
    );
  }

  try {
    const balance = await getOnChainBalance(walletAddress);

    // Filter to only non-zero balances
    const nonZeroTokens = balance.tokenBalances.filter((t) => t.uiAmount > 0);

    return c.json({
      address: walletAddress,
      tokens: nonZeroTokens,
      totalTokenTypes: nonZeroTokens.length,
      explorerUrl: balance.explorerUrl,
      verifiedAt: balance.verifiedAt,
    });
  } catch (err) {
    console.error("[ChainVerifier] Token balances failed:", err);
    return c.json(
      { error: "internal_error", code: "internal_error", details: "Failed to fetch token balances" },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /explorer-links — Generate explorer links for any entity
// ---------------------------------------------------------------------------

chainVerifierRoutes.get("/explorer-links", (c) => {
  const type = c.req.query("type") as "tx" | "address" | "token" | undefined;
  const value = c.req.query("value");

  if (!type || !value) {
    return c.json(
      { error: "validation_error", code: "validation_error", details: "type and value query params required. type: tx|address|token" },
      400,
    );
  }

  if (!["tx", "address", "token"].includes(type)) {
    return c.json(
      { error: "validation_error", code: "validation_error", details: "type must be one of: tx, address, token" },
      400,
    );
  }

  const urls = getExplorerUrls(type, value);

  return c.json({
    type,
    value,
    urls,
  });
});
