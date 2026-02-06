/**
 * $STONKS Token Helpers
 *
 * High-level functions for $STONKS token operations used by the lending engine.
 * Wraps monad-client.ts with lending-specific logic.
 */

import {
  getStonksBalance,
  transferStonks,
  getAgentMonadAddress,
  getAllAgentAddresses,
  getMonBalance,
} from "./monad-client.ts";
import { errorMessage } from "../lib/errors.ts";

/** Agent $STONKS portfolio snapshot */
export interface AgentStonksSnapshot {
  agentId: string;
  address: string;
  stonksBalance: number;
  monBalance: number;
}

/** Get $STONKS and MON balances for all agents */
export async function getAllAgentBalances(): Promise<AgentStonksSnapshot[]> {
  const agents = getAllAgentAddresses();
  const snapshots: AgentStonksSnapshot[] = [];

  for (const { agentId, address } of agents) {
    try {
      const [stonksBalance, monBalance] = await Promise.all([
        getStonksBalance(address),
        getMonBalance(address),
      ]);
      snapshots.push({ agentId, address, stonksBalance, monBalance });
    } catch (err) {
      console.warn(
        `[STONKS] Failed to fetch balance for ${agentId}: ${errorMessage(err)}`,
      );
      snapshots.push({ agentId, address, stonksBalance: 0, monBalance: 0 });
    }
  }

  return snapshots;
}

/** Get $STONKS balance for a specific agent */
export async function getAgentStonksBalance(agentId: string): Promise<number> {
  const address = getAgentMonadAddress(agentId);
  return getStonksBalance(address);
}

/**
 * Execute a $STONKS loan transfer from lender to borrower on Monad.
 * Returns the transaction hash.
 */
export async function executeLoanTransfer(
  lenderAgentId: string,
  borrowerAgentId: string,
  amount: number,
): Promise<string> {
  const borrowerAddress = getAgentMonadAddress(borrowerAgentId);
  console.log(
    `[STONKS] Transferring ${amount} $STONKS: ${lenderAgentId} → ${borrowerAgentId} (${borrowerAddress})`,
  );
  const txHash = await transferStonks(lenderAgentId, borrowerAddress, amount);
  console.log(`[STONKS] Transfer confirmed: ${txHash}`);
  return txHash;
}

/**
 * Execute a loan settlement: borrower repays lender with interest.
 * Returns the transaction hash.
 */
export async function executeSettlementTransfer(
  borrowerAgentId: string,
  lenderAgentId: string,
  principalPlusInterest: number,
): Promise<string> {
  const lenderAddress = getAgentMonadAddress(lenderAgentId);

  // Check if borrower has enough $STONKS
  const borrowerBalance = await getAgentStonksBalance(borrowerAgentId);
  const repayAmount = Math.min(principalPlusInterest, borrowerBalance);

  if (repayAmount <= 0) {
    throw new Error(
      `Borrower ${borrowerAgentId} has 0 $STONKS — cannot settle loan`,
    );
  }

  if (repayAmount < principalPlusInterest) {
    console.warn(
      `[STONKS] Partial settlement: ${borrowerAgentId} has ${borrowerBalance} but owes ${principalPlusInterest}`,
    );
  }

  console.log(
    `[STONKS] Settlement: ${borrowerAgentId} → ${lenderAgentId} (${lenderAddress}): ${repayAmount} $STONKS`,
  );
  const txHash = await transferStonks(borrowerAgentId, lenderAddress, repayAmount);
  console.log(`[STONKS] Settlement confirmed: ${txHash}`);
  return txHash;
}
