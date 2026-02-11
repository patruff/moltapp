/**
 * Solana escrow service for AI agent marketplace.
 *
 * The escrow flow:
 * 1. Buyer posts a job → funds are locked in an escrow USDC token account
 * 2. Seller agent completes the work → submits deliverable
 * 3. Buyer agent verifies the deliverable → escrow releases to seller
 * 4. If disputed → funds return to buyer (or go to arbitration)
 *
 * This uses a simple USDC transfer escrow pattern with a PDA (Program Derived Address)
 * managed by MoltApp's backend. For the hackathon, the escrow is a server-mediated
 * USDC transfer rather than a full on-chain Anchor program.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { USDC_MINT, USDC_DECIMALS, SOLANA_RPC_ENDPOINT } from "../utils/constants";

const connection = new Connection(SOLANA_RPC_ENDPOINT, "confirmed");

/**
 * Build a USDC transfer transaction for funding an escrow.
 * The buyer signs this via Mobile Wallet Adapter.
 */
export async function buildEscrowFundTransaction(params: {
  buyerPublicKey: PublicKey;
  escrowPublicKey: PublicKey;
  amountUsdc: number;
}): Promise<Transaction> {
  const { buyerPublicKey, escrowPublicKey, amountUsdc } = params;

  // Get associated token accounts for USDC
  const buyerUsdcAccount = await getAssociatedTokenAddress(
    USDC_MINT,
    buyerPublicKey
  );
  const escrowUsdcAccount = await getAssociatedTokenAddress(
    USDC_MINT,
    escrowPublicKey,
    true // allowOwnerOffCurve for PDA
  );

  // Convert USDC amount to smallest units
  const amountRaw = BigInt(Math.round(amountUsdc * 10 ** USDC_DECIMALS));

  const transaction = new Transaction().add(
    createTransferInstruction(
      buyerUsdcAccount,
      escrowUsdcAccount,
      buyerPublicKey,
      amountRaw,
      [],
      TOKEN_PROGRAM_ID
    )
  );

  return transaction;
}

/**
 * Build a USDC release transaction from escrow to seller.
 * Called after deliverable verification.
 */
export async function buildEscrowReleaseTransaction(params: {
  escrowPublicKey: PublicKey;
  sellerPublicKey: PublicKey;
  amountUsdc: number;
  escrowAuthority: PublicKey;
}): Promise<Transaction> {
  const { escrowPublicKey, sellerPublicKey, amountUsdc, escrowAuthority } =
    params;

  const escrowUsdcAccount = await getAssociatedTokenAddress(
    USDC_MINT,
    escrowPublicKey,
    true
  );
  const sellerUsdcAccount = await getAssociatedTokenAddress(
    USDC_MINT,
    sellerPublicKey
  );

  const amountRaw = BigInt(Math.round(amountUsdc * 10 ** USDC_DECIMALS));

  const transaction = new Transaction().add(
    createTransferInstruction(
      escrowUsdcAccount,
      sellerUsdcAccount,
      escrowAuthority,
      amountRaw,
      [],
      TOKEN_PROGRAM_ID
    )
  );

  return transaction;
}

/**
 * Check the USDC balance of an account.
 */
export async function getUsdcBalance(
  ownerPublicKey: PublicKey
): Promise<number> {
  try {
    const tokenAccount = await getAssociatedTokenAddress(
      USDC_MINT,
      ownerPublicKey
    );
    const account = await getAccount(connection, tokenAccount);
    return Number(account.amount) / 10 ** USDC_DECIMALS;
  } catch {
    return 0;
  }
}

/**
 * Verify an escrow account has sufficient funds.
 */
export async function verifyEscrowFunded(
  escrowPublicKey: PublicKey,
  expectedAmountUsdc: number
): Promise<boolean> {
  const balance = await getUsdcBalance(escrowPublicKey);
  return balance >= expectedAmountUsdc;
}
