/**
 * On-Chain Verification Service
 *
 * Verifies that trades executed by MoltApp agents are REAL by checking
 * Solana blockchain state. This is a critical differentiator for the
 * hackathon — proving that trades aren't simulated.
 *
 * Features:
 * - Verify a trade's transaction signature on-chain
 * - Get human-readable transaction details (sender, receiver, amounts)
 * - Generate Solana Explorer links for transparency
 * - Batch verification for all trades in a round
 * - On-chain portfolio snapshot (SOL + all SPL token balances)
 * - Block confirmation level tracking
 */

import {
  createSolanaRpc,
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
} from "@solana/kit";
import { errorMessage } from "../lib/errors.ts";
import { countByCondition } from "../lib/math-utils.ts";
import {
  TOKEN_PROGRAM_ADDRESS,
  TOKEN_2022_PROGRAM_ADDRESS,
  ATA_PROGRAM_ADDRESS,
  SOL_LAMPORTS_PER_SOL,
  SOL_DECIMALS,
  BATCH_VERIFY_INTER_TX_DELAY_MS,
} from "../config/constants.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TransactionVerification {
  signature: string;
  verified: boolean;
  slot: number | null;
  blockTime: number | null;
  blockTimeHuman: string | null;
  confirmationStatus: "processed" | "confirmed" | "finalized" | "unknown";
  fee: number | null; // lamports
  err: string | null;
  explorerUrl: string;
  solscanUrl: string;
}

export interface TransactionDetails {
  signature: string;
  slot: number;
  blockTime: number | null;
  success: boolean;
  fee: number; // lamports
  feeSol: string;
  signers: string[];
  programIds: string[];
  preBalances: number[];
  postBalances: number[];
  explorerUrl: string;
}

export interface OnChainBalance {
  address: string;
  solBalance: number; // lamports
  solBalanceFormatted: string;
  tokenBalances: TokenBalance[];
  explorerUrl: string;
  verifiedAt: string;
}

export interface TokenBalance {
  mint: string;
  symbol: string | null;
  amount: string; // raw
  decimals: number;
  uiAmount: number;
}

export interface BatchVerificationResult {
  roundId: string;
  verifications: TransactionVerification[];
  allVerified: boolean;
  verifiedCount: number;
  failedCount: number;
  totalTransactions: number;
  verifiedAt: string;
}

export interface TradeProof {
  tradeId: number;
  txSignature: string;
  verification: TransactionVerification;
  onChainDetails: TransactionDetails | null;
  agentId: string;
  agentName: string;
  side: string;
  symbol: string;
  quantity: string;
  usdcAmount: string;
  proofGenerated: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Blockchain program addresses imported from config/constants.ts:
// - TOKEN_PROGRAM_ADDRESS (standard SPL Token)
// - TOKEN_2022_PROGRAM_ADDRESS (Token Extensions, used by xStocks)
// - ATA_PROGRAM_ADDRESS (Associated Token Account)
// - SOL_LAMPORTS_PER_SOL (conversion factor)
// - SOL_DECIMALS (display precision)
// - BATCH_VERIFY_INTER_TX_DELAY_MS (batch verification rate limiting)

// Rename imported constants to match local naming convention (ID suffix)
const TOKEN_PROGRAM_ID = TOKEN_PROGRAM_ADDRESS;
const TOKEN_2022_PROGRAM_ID = TOKEN_2022_PROGRAM_ADDRESS;
const ATA_PROGRAM_ID = ATA_PROGRAM_ADDRESS;

const EXPLORER_BASE = "https://explorer.solana.com";
const SOLSCAN_BASE = "https://solscan.io";

// Retry configuration
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

/**
 * Maximum random jitter added to retry delays: 500ms (0-500ms range).
 *
 * Purpose: Prevents thundering herd when multiple RPC calls fail simultaneously.
 * Formula: delay = BASE_DELAY_MS × 2^(attempt-1) + random() × RETRY_JITTER_MAX_MS
 *
 * Examples:
 * - Attempt 1: 1000ms + 0-500ms = 1000-1500ms total delay
 * - Attempt 2: 2000ms + 0-500ms = 2000-2500ms total delay
 * - Attempt 3: 4000ms + 0-500ms = 4000-4500ms total delay
 *
 * Increase this value for more aggressive randomization (e.g., 1000ms for 0-1s jitter).
 */
const RETRY_JITTER_MAX_MS = 500;

/**
 * Number of characters shown at the start of a signature or wallet address in log
 * messages, producing a short human-readable prefix like "5J3mBbA...".
 *
 * Purpose: Solana signatures are 88-character base58 strings and wallet addresses are
 * 44 characters — both are far too long for log lines.  Showing only the first 8
 * characters provides enough entropy to distinguish entries at a glance while keeping
 * logs concise.
 *
 * Examples:
 * - Signature "5J3mBbAx...K8rQz2Py" → "5J3mBbAx..."  (8 chars + "...")
 * - Wallet   "7xK9mD3q...uF5vL1Np" → "7xK9mD3q..."  (8 chars + "...")
 *
 * Used in:
 * - getSignatureStatuses log label (verifyTransaction)
 * - getTransaction log label (getTransactionDetails)
 * - getBalance log label (getOnChainBalance)
 */
const DISPLAY_TRUNCATION_CHARS = 8;

// SOL conversion constants imported from config/constants.ts:
// - SOL_LAMPORTS_PER_SOL = 1_000_000_000 (lamports to SOL conversion)
// - SOL_DECIMALS = 9 (display precision for SOL amounts)
// - BATCH_VERIFY_INTER_TX_DELAY_MS = 200 (batch verification rate limiting)

const SOL_DISPLAY_DECIMALS = SOL_DECIMALS; // Alias for backwards compatibility

// Cache for RPC client
let rpcClient: ReturnType<typeof createSolanaRpc> | null = null;

// ---------------------------------------------------------------------------
// RPC Client
// ---------------------------------------------------------------------------

function getRpc() {
  if (!rpcClient) {
    const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
    rpcClient = createSolanaRpc(rpcUrl);
  }
  return rpcClient;
}

/**
 * Get the network cluster for explorer URLs.
 */
function getCluster(): string {
  const url = process.env.SOLANA_RPC_URL || "";
  if (url.includes("devnet")) return "?cluster=devnet";
  if (url.includes("testnet")) return "?cluster=testnet";
  return ""; // mainnet-beta (default)
}

// ---------------------------------------------------------------------------
// Retry Helper
// ---------------------------------------------------------------------------

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1) + Math.random() * RETRY_JITTER_MAX_MS;
      console.warn(
        `[ChainVerifier] ${label} attempt ${attempt} failed, retrying in ${Math.round(delay)}ms: ${errorMessage(err)}`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("unreachable");
}

// ---------------------------------------------------------------------------
// Core Verification Functions
// ---------------------------------------------------------------------------

/**
 * Verify a single transaction signature on Solana.
 */
export async function verifyTransaction(signature: string): Promise<TransactionVerification> {
  const cluster = getCluster();
  const result: TransactionVerification = {
    signature,
    verified: false,
    slot: null,
    blockTime: null,
    blockTimeHuman: null,
    confirmationStatus: "unknown",
    fee: null,
    err: null,
    explorerUrl: `${EXPLORER_BASE}/tx/${signature}${cluster}`,
    solscanUrl: `${SOLSCAN_BASE}/tx/${signature}${cluster.replace("?cluster=", "?cluster=")}`,
  };

  try {
    const rpc = getRpc();

    // Get signature status
    const statusResponse = await withRetry(
      () => rpc.getSignatureStatuses([signature as unknown as Parameters<typeof rpc.getSignatureStatuses>[0][0]]).send(),
      `getSignatureStatuses(${signature.slice(0, DISPLAY_TRUNCATION_CHARS)}...)`,
    );

    const status = statusResponse.value[0];
    if (!status) {
      result.err = "Transaction not found on chain";
      return result;
    }

    result.slot = Number(status.slot);
    result.confirmationStatus = status.confirmationStatus ?? "unknown";
    result.err = status.err ? JSON.stringify(status.err) : null;
    result.verified = !status.err && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized");

    // Try to get block time
    try {
      const blockTimeResponse = await rpc.getBlockTime(status.slot).send();
      if (blockTimeResponse) {
        const blockTimeNum = Number(blockTimeResponse);
        result.blockTime = blockTimeNum;
        result.blockTimeHuman = new Date(blockTimeNum * 1000).toISOString();
      }
    } catch {
      // Block time not always available
    }

    return result;
  } catch (err) {
    result.err = `Verification failed: ${errorMessage(err)}`;
    return result;
  }
}

/**
 * Get detailed transaction information from on-chain data.
 */
export async function getTransactionDetails(signature: string): Promise<TransactionDetails | null> {
  try {
    const rpc = getRpc();
    const cluster = getCluster();

    const tx = await withRetry(
      () =>
        rpc.getTransaction(signature as unknown as Parameters<typeof rpc.getTransaction>[0], {
          encoding: "json" as const,
          maxSupportedTransactionVersion: 0,
        }).send(),
      `getTransaction(${signature.slice(0, DISPLAY_TRUNCATION_CHARS)}...)`,
    );

    if (!tx) return null;

    const meta = tx.meta;
    const message = tx.transaction.message;

    // Extract account keys
    const accountKeys = message.accountKeys?.map((k: unknown) => String(k)) ?? [];

    // Extract program IDs from instructions
    const programIds = new Set<string>();
    for (const ix of message.instructions ?? []) {
      const programIdx = (ix as { programIdIndex?: number }).programIdIndex;
      if (programIdx !== undefined && accountKeys[programIdx]) {
        programIds.add(accountKeys[programIdx]);
      }
    }

    const fee = meta?.fee ? Number(meta.fee) : 0;

    return {
      signature,
      slot: Number(tx.slot),
      blockTime: tx.blockTime ? Number(tx.blockTime) : null,
      success: !meta?.err,
      fee,
      feeSol: (fee / SOL_LAMPORTS_PER_SOL).toFixed(SOL_DISPLAY_DECIMALS),
      signers: accountKeys.slice(0, (message as { header?: { numRequiredSignatures?: number } }).header?.numRequiredSignatures ?? 1),
      programIds: Array.from(programIds),
      preBalances: (meta?.preBalances ?? []).map(Number),
      postBalances: (meta?.postBalances ?? []).map(Number),
      explorerUrl: `${EXPLORER_BASE}/tx/${signature}${cluster}`,
    };
  } catch (err) {
    console.error(
      `[ChainVerifier] Failed to get transaction details: ${errorMessage(err)}`,
    );
    return null;
  }
}

/**
 * Get on-chain balance snapshot for a wallet address.
 */
export async function getOnChainBalance(walletAddress: string): Promise<OnChainBalance> {
  const rpc = getRpc();
  const cluster = getCluster();

  // Get SOL balance
  const solResponse = await withRetry(
    () => rpc.getBalance(address(walletAddress)).send(),
    `getBalance(${walletAddress.slice(0, DISPLAY_TRUNCATION_CHARS)}...)`,
  );

  const solBalance = Number(solResponse.value);

  // Get all token accounts
  const tokenBalances: TokenBalance[] = [];

  try {
    // Try both Token Program and Token-2022
    for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
      try {
        const tokenResponse = await rpc.getTokenAccountsByOwner(
          address(walletAddress),
          { programId: address(programId) },
          { encoding: "jsonParsed" },
        ).send();

        for (const account of tokenResponse.value) {
          const parsed = account.account.data as unknown as {
            parsed?: {
              info?: {
                mint?: string;
                tokenAmount?: {
                  amount?: string;
                  decimals?: number;
                  uiAmount?: number;
                };
              };
            };
          };

          const info = parsed?.parsed?.info;
          if (info?.mint && info?.tokenAmount) {
            tokenBalances.push({
              mint: info.mint,
              symbol: null, // Would need a token registry lookup
              amount: info.tokenAmount.amount ?? "0",
              decimals: info.tokenAmount.decimals ?? 0,
              uiAmount: info.tokenAmount.uiAmount ?? 0,
            });
          }
        }
      } catch {
        // Program might not have accounts for this wallet
      }
    }
  } catch (err) {
    console.warn(
      `[ChainVerifier] Token balance fetch failed: ${errorMessage(err)}`,
    );
  }

  return {
    address: walletAddress,
    solBalance,
    solBalanceFormatted: `${(solBalance / SOL_LAMPORTS_PER_SOL).toFixed(SOL_DISPLAY_DECIMALS)} SOL`,
    tokenBalances,
    explorerUrl: `${EXPLORER_BASE}/address/${walletAddress}${cluster}`,
    verifiedAt: new Date().toISOString(),
  };
}

/**
 * Batch verify all transactions in a trading round.
 */
export async function batchVerifyRound(
  roundId: string,
  signatures: string[],
): Promise<BatchVerificationResult> {
  const verifications: TransactionVerification[] = [];

  // Verify in sequence to respect RPC rate limits
  for (const sig of signatures) {
    const verification = await verifyTransaction(sig);
    verifications.push(verification);

    // Small delay between verifications
    if (signatures.indexOf(sig) < signatures.length - 1) {
      await new Promise((r) => setTimeout(r, BATCH_VERIFY_INTER_TX_DELAY_MS));
    }
  }

  const verifiedCount = countByCondition(verifications, (v) => v.verified);
  const failedCount = countByCondition(verifications, (v) => !v.verified);

  return {
    roundId,
    verifications,
    allVerified: failedCount === 0 && verifiedCount > 0,
    verifiedCount,
    failedCount,
    totalTransactions: signatures.length,
    verifiedAt: new Date().toISOString(),
  };
}

/**
 * Generate a complete trade proof with on-chain verification.
 */
export async function generateTradeProof(params: {
  tradeId: number;
  txSignature: string;
  agentId: string;
  agentName: string;
  side: string;
  symbol: string;
  quantity: string;
  usdcAmount: string;
}): Promise<TradeProof> {
  const [verification, details] = await Promise.all([
    verifyTransaction(params.txSignature),
    getTransactionDetails(params.txSignature),
  ]);

  return {
    tradeId: params.tradeId,
    txSignature: params.txSignature,
    verification,
    onChainDetails: details,
    agentId: params.agentId,
    agentName: params.agentName,
    side: params.side,
    symbol: params.symbol,
    quantity: params.quantity,
    usdcAmount: params.usdcAmount,
    proofGenerated: new Date().toISOString(),
  };
}

/**
 * Get ATA address for a wallet + mint pair.
 */
export async function getAssociatedTokenAddress(
  ownerAddress: string,
  mintAddress: string,
): Promise<string> {
  const encoder = getAddressEncoder();
  const [pda] = await getProgramDerivedAddress({
    programAddress: address(ATA_PROGRAM_ID),
    seeds: [
      encoder.encode(address(ownerAddress)),
      encoder.encode(address(TOKEN_PROGRAM_ID)),
      encoder.encode(address(mintAddress)),
    ],
  });
  return pda;
}

/**
 * Generate explorer URLs for various entities.
 */
export function getExplorerUrls(type: "tx" | "address" | "token", value: string) {
  const cluster = getCluster();
  const pathMap = { tx: "tx", address: "address", token: "address" };

  return {
    explorer: `${EXPLORER_BASE}/${pathMap[type]}/${value}${cluster}`,
    solscan: `${SOLSCAN_BASE}/${pathMap[type]}/${value}${cluster.replace("?cluster=", "?cluster=")}`,
  };
}
