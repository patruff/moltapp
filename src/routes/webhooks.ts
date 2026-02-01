import { Hono } from "hono";
import { env } from "../config/env.ts";
import { processDeposit, findAgentByWalletAddress } from "../services/deposit.ts";
import { USDC_MINT_MAINNET, USDC_MINT_DEVNET } from "../config/constants.ts";

/** Helius enhanced transaction event shape (relevant fields) */
interface HeliusNativeTransfer {
  fromUserAccount: string;
  toUserAccount: string;
  amount: number; // lamports
}

interface HeliusTokenTransfer {
  fromUserAccount: string;
  toUserAccount: string;
  mint: string;
  tokenAmount: number;
}

interface HeliusTransactionEvent {
  signature: string;
  timestamp: number;
  nativeTransfers?: HeliusNativeTransfer[];
  tokenTransfers?: HeliusTokenTransfer[];
}

function getUsdcMint(): string {
  return env.NODE_ENV === "production" ? USDC_MINT_MAINNET : USDC_MINT_DEVNET;
}

export const webhookRoutes = new Hono();

/**
 * POST /helius - Helius webhook handler for deposit detection
 *
 * Receives enhanced transaction events from Helius and records deposits
 * for agent wallets. Always returns 200 to prevent Helius retries.
 *
 * Authentication: Bearer token matching HELIUS_WEBHOOK_SECRET.
 */
webhookRoutes.post("/helius", async (c) => {
  // 1. Verify webhook authenticity
  const authHeader = c.req.header("Authorization");
  const expectedToken = env.HELIUS_WEBHOOK_SECRET;

  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    return c.json({ error: "unauthorized" }, 401);
  }

  // 2. Parse transaction events
  let events: HeliusTransactionEvent[];
  try {
    events = await c.req.json();
  } catch {
    // Malformed body -- still return 200 to prevent retries
    console.error("Helius webhook: malformed request body");
    return c.json({ received: true });
  }

  if (!Array.isArray(events)) {
    console.error("Helius webhook: body is not an array");
    return c.json({ received: true });
  }

  const usdcMint = getUsdcMint();

  // 3. Process each event
  for (const event of events) {
    try {
      // Process native SOL transfers
      if (event.nativeTransfers) {
        for (const transfer of event.nativeTransfers) {
          if (transfer.amount <= 0) continue;

          const agent = await findAgentByWalletAddress(
            transfer.toUserAccount
          );
          if (agent) {
            await processDeposit({
              agentId: agent.id,
              type: "SOL",
              amount: transfer.amount.toString(),
              txSignature: event.signature,
              timestamp: event.timestamp,
            });
          }
        }
      }

      // Process USDC token transfers
      if (event.tokenTransfers) {
        for (const transfer of event.tokenTransfers) {
          if (transfer.mint !== usdcMint) continue;
          if (transfer.tokenAmount <= 0) continue;

          const agent = await findAgentByWalletAddress(
            transfer.toUserAccount
          );
          if (agent) {
            await processDeposit({
              agentId: agent.id,
              type: "USDC",
              amount: transfer.tokenAmount.toString(),
              txSignature: event.signature,
              timestamp: event.timestamp,
            });
          }
        }
      }
    } catch (err) {
      // Log but do not fail the webhook -- always return 200
      console.error(
        `Helius webhook: error processing event ${event.signature}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return c.json({ received: true });
});
