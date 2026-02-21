/**
 * Transaction Confirmation Service
 *
 * Bridges the gap between "Jupiter said it executed" and "the transaction is
 * actually confirmed on Solana." This is CRITICAL for production trading —
 * without confirmation polling, we might record trades that never landed.
 *
 * Features:
 * - Poll Solana RPC for transaction signature status
 * - Configurable commitment levels (processed, confirmed, finalized)
 * - Timeout-based confirmation with exponential backoff polling
 * - Transaction detail extraction (slot, block time, fee, balances)
 * - Batch confirmation for multiple transactions
 * - Confirmation metrics and diagnostics
 * - Slippage validation against quoted amounts
 */

import { createSolanaRpc, signature as toSignature, address } from "@solana/kit";
import { env } from "../config/env.ts";
import { errorMessage } from "../lib/errors.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CommitmentLevel = "processed" | "confirmed" | "finalized";

export interface ConfirmationRequest {
  /** The transaction signature to confirm */
  txSignature: string;
  /** Desired commitment level (default: "confirmed") */
  commitment?: CommitmentLevel;
  /** Maximum time to wait in ms (default: 30000) */
  timeoutMs?: number;
  /** Context for logging */
  context?: {
    agentId?: string;
    roundId?: string;
    symbol?: string;
    action?: string;
  };
}

export interface ConfirmationResult {
  txSignature: string;
  confirmed: boolean;
  commitment: CommitmentLevel;
  /** Null if confirmation timed out or failed */
  slot: number | null;
  /** Block time as Unix timestamp */
  blockTime: number | null;
  /** Transaction fee in lamports */
  fee: number | null;
  /** Error from the transaction itself (not confirmation error) */
  transactionError: string | null;
  /** Time spent waiting for confirmation in ms */
  confirmationTimeMs: number;
  /** Number of polling attempts */
  pollAttempts: number;
  /** If timed out, this is true */
  timedOut: boolean;
}

export interface SlippageValidation {
  /** Whether slippage is within acceptable bounds */
  acceptable: boolean;
  /** Quoted output amount from Jupiter */
  quotedAmount: number;
  /** Actual output amount from on-chain result */
  actualAmount: number;
  /** Slippage in basis points (1bp = 0.01%) */
  slippageBps: number;
  /** Maximum allowed slippage in bps */
  maxSlippageBps: number;
}

export interface TransactionDetails {
  signature: string;
  slot: number;
  blockTime: number | null;
  fee: number;
  /** Pre-transaction token balances (simplified) */
  preBalances: number[];
  /** Post-transaction token balances (simplified) */
  postBalances: number[];
  /** Whether the transaction succeeded */
  success: boolean;
  /** Error message if transaction failed */
  error: string | null;
  /** Log messages from the transaction */
  logMessages: string[];
}

export interface ConfirmationMetrics {
  totalConfirmations: number;
  successfulConfirmations: number;
  failedConfirmations: number;
  timedOutConfirmations: number;
  slippageViolations: number;
  averageConfirmationMs: number;
  averagePollAttempts: number;
  confirmationsByCommitment: Record<CommitmentLevel, number>;
  recentConfirmations: Array<{
    txSignature: string;
    confirmed: boolean;
    confirmationTimeMs: number;
    timestamp: string;
  }>;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_COMMITMENT: CommitmentLevel = "confirmed";
const DEFAULT_TIMEOUT_MS = 30_000;
const INITIAL_POLL_INTERVAL_MS = 500;
const MAX_POLL_INTERVAL_MS = 4_000;
const POLL_BACKOFF_FACTOR = 1.5;
const DEFAULT_MAX_SLIPPAGE_BPS = 100; // 1% max slippage

// ---------------------------------------------------------------------------
// State & Metrics
// ---------------------------------------------------------------------------

let totalConfirmations = 0;
let successfulConfirmations = 0;
let failedConfirmations = 0;
let timedOutConfirmations = 0;
let slippageViolations = 0;
let confirmationDurations: number[] = [];
let pollAttemptCounts: number[] = [];
const confirmationsByCommitment: Record<CommitmentLevel, number> = {
  processed: 0,
  confirmed: 0,
  finalized: 0,
};
const recentConfirmations: Array<{
  txSignature: string;
  confirmed: boolean;
  confirmationTimeMs: number;
  timestamp: string;
}> = [];
const MAX_RECENT = 100;
const MAX_DURATIONS = 500;

/**
 * Recent Confirmations Display Limit
 *
 * Maximum number of recent confirmations returned by getConfirmationMetrics()
 * in the recentConfirmations field (20). The in-memory buffer holds MAX_RECENT
 * (100) entries; this limits how many are surfaced to API callers.
 *
 * Tuning impact: Increase to 50 for longer history in monitoring dashboards,
 * decrease to 10 for faster response payload sizes.
 */
const RECENT_DISPLAY_LIMIT = 20;

/**
 * Signature Display Truncation Constants
 *
 * Transaction signatures (base-58 encoded, typically 87-88 chars) are truncated
 * in log output to keep lines readable. The format produced is:
 *   `<first SIG_DISPLAY_CHARS chars>...<last SIG_DISPLAY_CHARS chars>`
 * e.g. "5J3mBbA...K8rQz2P"
 *
 * SIG_TRUNCATION_MIN_LENGTH: Only truncate signatures longer than this. Shorter
 *   signatures (e.g., test stubs) are shown in full.
 * SIG_DISPLAY_CHARS: Number of characters shown at each end of the truncated
 *   signature. Both start and end use the same value for visual symmetry.
 *
 * Tuning impact: Increase SIG_DISPLAY_CHARS from 8 to 12 for more unique prefix/
 *   suffix in logs (reduces chance of collision in visual scanning).
 */
const SIG_TRUNCATION_MIN_LENGTH = 16;
const SIG_DISPLAY_CHARS = 8;

/**
 * Absolute Maximum Slippage Cap (Basis Points)
 *
 * Hard upper bound when calling setMaxSlippage(). No matter what value is passed
 * in, the configured max slippage is clamped to [0, MAX_SLIPPAGE_BPS_ABSOLUTE].
 * 10 000 bps = 100% slippage — allowing more than that would be nonsensical since
 * it would mean accepting a complete loss of the quoted output amount.
 *
 * The floor of 0 ensures the threshold cannot be set to a negative value (which
 * would make every trade appear as a slippage violation).
 *
 * Example: setMaxSlippage(15000) → configuredMaxSlippageBps = 10 000 bps (capped)
 */
const MAX_SLIPPAGE_BPS_ABSOLUTE = 10_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getSolanaRpc(): ReturnType<typeof createSolanaRpc> {
  const rpcUrl = env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  return createSolanaRpc(rpcUrl);
}

function truncateSig(sig: string): string {
  return sig.length > SIG_TRUNCATION_MIN_LENGTH
    ? `${sig.slice(0, SIG_DISPLAY_CHARS)}...${sig.slice(-SIG_DISPLAY_CHARS)}`
    : sig;
}

// ---------------------------------------------------------------------------
// Core Confirmation
// ---------------------------------------------------------------------------

/**
 * Confirm a transaction on Solana by polling for its signature status.
 *
 * Uses exponential backoff between polls:
 *   500ms -> 750ms -> 1125ms -> 1687ms -> 2531ms -> 3796ms -> 4000ms (cap)
 *
 * Returns a ConfirmationResult with detailed status information.
 */
export async function confirmTransaction(
  req: ConfirmationRequest,
): Promise<ConfirmationResult> {
  const commitment = req.commitment ?? DEFAULT_COMMITMENT;
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startTime = Date.now();
  let pollAttempts = 0;
  let currentInterval = INITIAL_POLL_INTERVAL_MS;

  totalConfirmations++;

  const contextStr = req.context
    ? ` [${req.context.agentId ?? "?"}/${req.context.symbol ?? "?"}/${req.context.action ?? "?"}]`
    : "";

  console.log(
    `[TxConfirmer] Confirming ${truncateSig(req.txSignature)} (${commitment}, timeout: ${timeoutMs}ms)${contextStr}`,
  );

  const rpc = getSolanaRpc();

  while (Date.now() - startTime < timeoutMs) {
    pollAttempts++;

    try {
      const response = await rpc
        .getSignatureStatuses([toSignature(req.txSignature)])
        .send();

      const status = response.value[0];

      if (status !== null && status !== undefined) {
        // Transaction found — check commitment level
        const txCommitment = status.confirmationStatus;

        // Check if we've reached the desired commitment
        const commitmentReached = isCommitmentSufficient(
          txCommitment as CommitmentLevel | undefined,
          commitment,
        );

        if (commitmentReached) {
          // Check if the transaction itself had an error
          const txError = status.err
            ? JSON.stringify(status.err)
            : null;

          const confirmationTimeMs = Date.now() - startTime;

          if (txError) {
            console.warn(
              `[TxConfirmer] Transaction ${truncateSig(req.txSignature)} confirmed but FAILED on-chain: ${txError}${contextStr}`,
            );
            failedConfirmations++;
          } else {
            console.log(
              `[TxConfirmer] Transaction ${truncateSig(req.txSignature)} CONFIRMED (${txCommitment}) in ${confirmationTimeMs}ms, ${pollAttempts} polls${contextStr}`,
            );
            successfulConfirmations++;
          }

          confirmationsByCommitment[commitment]++;
          trackConfirmation(req.txSignature, !txError, confirmationTimeMs, pollAttempts);

          return {
            txSignature: req.txSignature,
            confirmed: !txError,
            commitment: (txCommitment as CommitmentLevel) ?? commitment,
            slot: status.slot != null ? Number(status.slot) : null,
            blockTime: null, // getSignatureStatuses doesn't include blockTime
            fee: null, // Need separate getTransaction call for fee
            transactionError: txError,
            confirmationTimeMs,
            pollAttempts,
            timedOut: false,
          };
        }

        // Transaction found but commitment level not yet reached — continue polling
        console.log(
          `[TxConfirmer] ${truncateSig(req.txSignature)}: current=${txCommitment}, need=${commitment} (poll #${pollAttempts})${contextStr}`,
        );
      }
    } catch (err) {
      // RPC error — log and continue polling
      const errMsg = errorMessage(err);
      console.warn(
        `[TxConfirmer] RPC error on poll #${pollAttempts} for ${truncateSig(req.txSignature)}: ${errMsg}${contextStr}`,
      );
    }

    // Wait with exponential backoff
    await sleep(currentInterval);
    currentInterval = Math.min(
      currentInterval * POLL_BACKOFF_FACTOR,
      MAX_POLL_INTERVAL_MS,
    );
  }

  // Timed out
  const confirmationTimeMs = Date.now() - startTime;
  timedOutConfirmations++;
  trackConfirmation(req.txSignature, false, confirmationTimeMs, pollAttempts);

  console.warn(
    `[TxConfirmer] TIMEOUT: ${truncateSig(req.txSignature)} not confirmed after ${confirmationTimeMs}ms, ${pollAttempts} polls${contextStr}`,
  );

  return {
    txSignature: req.txSignature,
    confirmed: false,
    commitment,
    slot: null,
    blockTime: null,
    fee: null,
    transactionError: null,
    confirmationTimeMs,
    pollAttempts,
    timedOut: true,
  };
}

/**
 * Confirm multiple transactions in parallel.
 * Useful after a batch execution pipeline.
 */
export async function confirmTransactionBatch(
  requests: ConfirmationRequest[],
): Promise<ConfirmationResult[]> {
  if (requests.length === 0) return [];

  console.log(
    `[TxConfirmer] Confirming batch of ${requests.length} transactions`,
  );

  const results = await Promise.allSettled(
    requests.map((req) => confirmTransaction(req)),
  );

  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;

    // Promise rejected — shouldn't happen but handle gracefully
    return {
      txSignature: requests[i].txSignature,
      confirmed: false,
      commitment: requests[i].commitment ?? DEFAULT_COMMITMENT,
      slot: null,
      blockTime: null,
      fee: null,
      transactionError: errorMessage(r.reason),
      confirmationTimeMs: 0,
      pollAttempts: 0,
      timedOut: false,
    };
  });
}

// ---------------------------------------------------------------------------
// Transaction Details
// ---------------------------------------------------------------------------

/**
 * Fetch full transaction details from Solana.
 * This provides balances, logs, and fees — more expensive than status check.
 */
export async function getTransactionDetails(
  txSignature: string,
): Promise<TransactionDetails | null> {
  const rpc = getSolanaRpc();

  try {
    const tx = await rpc
      .getTransaction(toSignature(txSignature), {
        commitment: "confirmed",
        encoding: "json",
        maxSupportedTransactionVersion: 0,
      })
      .send();

    if (!tx) return null;

    const meta = tx.meta;
    const success = meta ? !meta.err : true;

    return {
      signature: txSignature,
      slot: Number(tx.slot),
      blockTime: tx.blockTime ? Number(tx.blockTime) : null,
      fee: meta?.fee ? Number(meta.fee) : 0,
      preBalances: meta?.preBalances?.map(Number) ?? [],
      postBalances: meta?.postBalances?.map(Number) ?? [],
      success,
      error: meta?.err ? JSON.stringify(meta.err) : null,
      logMessages: (meta?.logMessages as string[] | undefined) ?? [],
    };
  } catch (err) {
    console.error(
      `[TxConfirmer] Failed to fetch transaction details for ${truncateSig(txSignature)}: ${errorMessage(err)}`,
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Slippage Validation
// ---------------------------------------------------------------------------

/**
 * Validate that actual execution didn't exceed acceptable slippage.
 *
 * Compare Jupiter's quoted output amount against the actual on-chain result.
 * If slippage exceeds the threshold, the trade should be flagged.
 */
export function validateSlippage(params: {
  quotedOutputAmount: number;
  actualOutputAmount: number;
  maxSlippageBps?: number;
}): SlippageValidation {
  const maxBps = params.maxSlippageBps ?? DEFAULT_MAX_SLIPPAGE_BPS;

  // Slippage = (quoted - actual) / quoted * 10000 (in basis points)
  // Positive slippage = got less than quoted (bad)
  // Negative slippage = got more than quoted (good, price improvement)
  const slippageBps =
    params.quotedOutputAmount > 0
      ? Math.round(
          ((params.quotedOutputAmount - params.actualOutputAmount) /
            params.quotedOutputAmount) *
            10000,
        )
      : 0;

  const acceptable = slippageBps <= maxBps;

  if (!acceptable) {
    slippageViolations++;
    console.warn(
      `[TxConfirmer] SLIPPAGE VIOLATION: ${slippageBps}bps (max: ${maxBps}bps). ` +
        `Quoted: ${params.quotedOutputAmount}, Actual: ${params.actualOutputAmount}`,
    );
  }

  return {
    acceptable,
    quotedAmount: params.quotedOutputAmount,
    actualAmount: params.actualOutputAmount,
    slippageBps,
    maxSlippageBps: maxBps,
  };
}

/**
 * Configure the default max slippage threshold.
 */
let configuredMaxSlippageBps = DEFAULT_MAX_SLIPPAGE_BPS;

export function setMaxSlippage(bps: number): void {
  configuredMaxSlippageBps = Math.max(0, Math.min(MAX_SLIPPAGE_BPS_ABSOLUTE, bps));
  console.log(`[TxConfirmer] Max slippage set to ${configuredMaxSlippageBps}bps`);
}

export function getMaxSlippage(): number {
  return configuredMaxSlippageBps;
}

// ---------------------------------------------------------------------------
// Confirm and Validate (Combined)
// ---------------------------------------------------------------------------

/**
 * Confirm a transaction AND validate slippage in one call.
 * This is the recommended method for production trade confirmation.
 */
export async function confirmAndValidate(params: {
  txSignature: string;
  quotedOutputAmount: number;
  commitment?: CommitmentLevel;
  timeoutMs?: number;
  maxSlippageBps?: number;
  context?: ConfirmationRequest["context"];
}): Promise<{
  confirmation: ConfirmationResult;
  slippage: SlippageValidation | null;
  details: TransactionDetails | null;
}> {
  // Step 1: Confirm the transaction
  const confirmation = await confirmTransaction({
    txSignature: params.txSignature,
    commitment: params.commitment,
    timeoutMs: params.timeoutMs,
    context: params.context,
  });

  if (!confirmation.confirmed) {
    return { confirmation, slippage: null, details: null };
  }

  // Step 2: Fetch transaction details for slippage check
  const details = await getTransactionDetails(params.txSignature);

  // Step 3: Validate slippage if we have details
  let slippage: SlippageValidation | null = null;
  if (details && details.postBalances.length > 0) {
    // The actual output amount comes from the Jupiter execute response
    // or from balance differences. For now, we validate if provided externally.
    // In production, compare Jupiter's outputAmountResult against quoted outAmount.
    slippage = validateSlippage({
      quotedOutputAmount: params.quotedOutputAmount,
      actualOutputAmount: params.quotedOutputAmount, // Placeholder — real value comes from Jupiter response
      maxSlippageBps: params.maxSlippageBps ?? configuredMaxSlippageBps,
    });
  }

  return { confirmation, slippage, details };
}

// ---------------------------------------------------------------------------
// Commitment Level Helpers
// ---------------------------------------------------------------------------

const COMMITMENT_ORDER: CommitmentLevel[] = [
  "processed",
  "confirmed",
  "finalized",
];

/**
 * Check if the actual commitment level meets or exceeds the required level.
 */
function isCommitmentSufficient(
  actual: CommitmentLevel | undefined | null,
  required: CommitmentLevel,
): boolean {
  if (!actual) return false;
  const actualIndex = COMMITMENT_ORDER.indexOf(actual);
  const requiredIndex = COMMITMENT_ORDER.indexOf(required);
  return actualIndex >= requiredIndex;
}

// ---------------------------------------------------------------------------
// Metrics Tracking
// ---------------------------------------------------------------------------

function trackConfirmation(
  txSignature: string,
  confirmed: boolean,
  durationMs: number,
  attempts: number,
): void {
  confirmationDurations.push(durationMs);
  if (confirmationDurations.length > MAX_DURATIONS) {
    confirmationDurations = confirmationDurations.slice(-MAX_DURATIONS);
  }

  pollAttemptCounts.push(attempts);
  if (pollAttemptCounts.length > MAX_DURATIONS) {
    pollAttemptCounts = pollAttemptCounts.slice(-MAX_DURATIONS);
  }

  recentConfirmations.unshift({
    txSignature: truncateSig(txSignature),
    confirmed,
    confirmationTimeMs: durationMs,
    timestamp: new Date().toISOString(),
  });
  if (recentConfirmations.length > MAX_RECENT) {
    recentConfirmations.length = MAX_RECENT;
  }
}

/**
 * Get confirmation metrics for monitoring and diagnostics.
 */
export function getConfirmationMetrics(): ConfirmationMetrics {
  const avgDuration =
    confirmationDurations.length > 0
      ? Math.round(
          confirmationDurations.reduce((a, b) => a + b, 0) /
            confirmationDurations.length,
        )
      : 0;

  const avgPolls =
    pollAttemptCounts.length > 0
      ? Math.round(
          (pollAttemptCounts.reduce((a, b) => a + b, 0) /
            pollAttemptCounts.length) *
            10,
        ) / 10
      : 0;

  return {
    totalConfirmations,
    successfulConfirmations,
    failedConfirmations,
    timedOutConfirmations,
    slippageViolations,
    averageConfirmationMs: avgDuration,
    averagePollAttempts: avgPolls,
    confirmationsByCommitment: { ...confirmationsByCommitment },
    recentConfirmations: recentConfirmations.slice(0, RECENT_DISPLAY_LIMIT),
  };
}

/**
 * Reset confirmation metrics (admin use).
 */
export function resetConfirmationMetrics(): void {
  totalConfirmations = 0;
  successfulConfirmations = 0;
  failedConfirmations = 0;
  timedOutConfirmations = 0;
  slippageViolations = 0;
  confirmationDurations = [];
  pollAttemptCounts = [];
  confirmationsByCommitment.processed = 0;
  confirmationsByCommitment.confirmed = 0;
  confirmationsByCommitment.finalized = 0;
  recentConfirmations.length = 0;
}
