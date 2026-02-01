import { eq } from "drizzle-orm";
import { Decimal } from "decimal.js";
import { db } from "../db/index.ts";
import { wallets, transactions } from "../db/schema/index.ts";

export interface DepositParams {
  agentId: string;
  type: "SOL" | "USDC";
  /** Raw amount: lamports for SOL, raw token amount for USDC */
  amount: string;
  txSignature: string;
  timestamp: number;
}

/**
 * Process a deposit event with idempotency protection.
 *
 * If the txSignature already exists in the transactions table,
 * the deposit is silently ignored (no error thrown).
 *
 * SOL amounts are converted from lamports (/ 1e9).
 * USDC amounts are converted from raw token units (/ 1e6).
 */
export async function processDeposit(params: DepositParams): Promise<void> {
  const { agentId, type, amount, txSignature, timestamp } = params;

  // Idempotency check: skip if transaction already recorded
  const existing = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.txSignature, txSignature))
    .limit(1);

  if (existing.length > 0) {
    console.log(`Duplicate deposit ignored: ${txSignature}`);
    return;
  }

  // Convert raw amount to decimal
  const divisor = type === "SOL" ? 1e9 : 1e6;
  const decimalAmount = new Decimal(amount).div(divisor).toFixed(9);
  const confirmedAt = new Date(timestamp * 1000);

  try {
    await db.insert(transactions).values({
      agentId,
      type: "deposit",
      tokenType: type,
      amount: decimalAmount,
      txSignature,
      status: "confirmed",
      confirmedAt,
    });
  } catch (err: unknown) {
    // Race condition safety: unique constraint violation on txSignature
    // means another process already inserted this deposit
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.includes("unique") ||
      message.includes("duplicate") ||
      message.includes("23505") // PostgreSQL unique_violation code
    ) {
      console.log(`Duplicate deposit ignored (constraint): ${txSignature}`);
      return;
    }
    throw err;
  }
}

/**
 * Find an agent by their wallet's public key (deposit address).
 * Returns the agent ID if found, null otherwise.
 */
export async function findAgentByWalletAddress(
  walletAddress: string
): Promise<{ id: string } | null> {
  const records = await db
    .select({ agentId: wallets.agentId })
    .from(wallets)
    .where(eq(wallets.publicKey, walletAddress))
    .limit(1);

  if (records.length === 0) {
    return null;
  }

  return { id: records[0].agentId };
}
