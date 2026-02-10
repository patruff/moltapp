/**
 * Wallet Setup Utilities
 *
 * Generates Solana keypairs, checks balances, and handles devnet airdrops
 * for the MoltApp onboarding flow.
 */

import { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import bs58 from "bs58";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MAINNET_RPC = "https://api.mainnet-beta.solana.com";
const DEVNET_RPC = "https://api.devnet.solana.com";

/** Polling interval for balance checks (ms) */
const POLL_INTERVAL_MS = 5_000;

/** Maximum time to wait for funding (ms) — 10 minutes */
const MAX_WAIT_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// Wallet Generation
// ---------------------------------------------------------------------------

export interface GeneratedWallet {
  publicKey: string;
  secretKey: string;
}

/**
 * Generate a new Solana keypair.
 * Returns base58-encoded public and secret keys.
 */
export function generateWallet(): GeneratedWallet {
  const keypair = Keypair.generate();
  return {
    publicKey: keypair.publicKey.toBase58(),
    secretKey: bs58.encode(keypair.secretKey),
  };
}

// ---------------------------------------------------------------------------
// Balance Checking
// ---------------------------------------------------------------------------

export interface WalletBalance {
  sol: number;
  lamports: number;
}

/**
 * Check SOL balance for a wallet address.
 */
export async function checkBalance(
  publicKey: string,
  devnet = false,
): Promise<WalletBalance> {
  const connection = new Connection(devnet ? DEVNET_RPC : MAINNET_RPC);
  const pubkey = new PublicKey(publicKey);
  const lamports = await connection.getBalance(pubkey);
  return {
    sol: lamports / LAMPORTS_PER_SOL,
    lamports,
  };
}

/**
 * Poll for wallet funding. Resolves when the wallet has at least
 * `minSol` SOL balance or times out.
 */
export async function waitForFunding(
  publicKey: string,
  minSol: number,
  devnet = false,
  onPoll?: (balance: WalletBalance) => void,
): Promise<WalletBalance> {
  const start = Date.now();

  while (Date.now() - start < MAX_WAIT_MS) {
    const balance = await checkBalance(publicKey, devnet);
    if (onPoll) onPoll(balance);

    if (balance.sol >= minSol) {
      return balance;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`Timeout: wallet not funded after ${MAX_WAIT_MS / 60000} minutes`);
}

// ---------------------------------------------------------------------------
// Devnet Airdrop
// ---------------------------------------------------------------------------

/**
 * Request a devnet SOL airdrop (for testing only).
 * Requests 2 SOL by default.
 */
export async function getDevnetAirdrop(
  publicKey: string,
  amount = 2,
): Promise<{ signature: string; sol: number }> {
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const pubkey = new PublicKey(publicKey);
  const signature = await connection.requestAirdrop(
    pubkey,
    amount * LAMPORTS_PER_SOL,
  );
  await connection.confirmTransaction(signature);
  return { signature, sol: amount };
}
