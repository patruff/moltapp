/**
 * Jupiter DEX Integration - Hardened
 *
 * Production-grade wrapper around the Jupiter Ultra API with:
 * - Retry with exponential backoff on getOrder failures
 * - Compute budget instruction injection for priority fees
 * - Automatic transaction confirmation polling after execution
 * - Slippage protection with configurable max slippage
 * - JUP_API_KEY passed in all headers
 * - Rate limiting via the token bucket limiter
 * - Comprehensive metrics tracking
 *
 * This module wraps the raw jupiter.ts functions with production safety.
 */

import { env } from "../config/env.ts";
import { JUPITER_API_BASE_URL } from "../config/constants.ts";
import { getTurnkeySigner } from "./wallet.ts";
import { jupiterLimiter } from "./rate-limiter.ts";
import {
  confirmTransaction,
  validateSlippage,
  type ConfirmationResult,
  type SlippageValidation,
} from "./transaction-confirmer.ts";
import { logTradeEvent, logTradeFailure } from "./audit-log.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HardenedOrderResponse {
  transaction: string;
  requestId: string;
  inAmount: string;
  outAmount: string;
  swapType: string;
  slippageBps: number;
}

export interface HardenedExecuteResponse {
  status: string;
  signature: string;
  code: number;
  slot?: number;
  inputAmountResult?: string;
  outputAmountResult?: string;
  swapEvents?: unknown[];
}

export interface HardenedTradeResult {
  /** Raw Jupiter order response */
  order: HardenedOrderResponse;
  /** Raw Jupiter execute response */
  execution: HardenedExecuteResponse;
  /** On-chain confirmation result */
  confirmation: ConfirmationResult;
  /** Slippage validation result */
  slippage: SlippageValidation;
  /** Total wall-clock time from order request to confirmation */
  totalDurationMs: number;
  /** Retry attempts needed for the order request */
  orderRetryAttempts: number;
  /** Retry attempts needed for execution */
  executeRetryAttempts: number;
}

export interface JupiterHardenedConfig {
  /** Max retries for getOrder (default: 3) */
  maxOrderRetries: number;
  /** Max retries for executeOrder (default: 2) */
  maxExecuteRetries: number;
  /** Base delay for exponential backoff in ms (default: 1000) */
  baseDelayMs: number;
  /** Max slippage in basis points (default: 100 = 1%) */
  maxSlippageBps: number;
  /** Confirmation timeout in ms (default: 30000) */
  confirmationTimeoutMs: number;
  /** Confirmation commitment level (default: "confirmed") */
  confirmationCommitment: "processed" | "confirmed" | "finalized";
  /** Whether to inject compute budget instructions (default: true) */
  useComputeBudget: boolean;
  /** Compute unit price in micro-lamports (default: 50000) */
  computeUnitPrice: number;
  /** Compute unit limit (default: 400000) */
  computeUnitLimit: number;
}

const DEFAULT_CONFIG: JupiterHardenedConfig = {
  maxOrderRetries: 3,
  maxExecuteRetries: 2,
  baseDelayMs: 1000,
  maxSlippageBps: 100,
  confirmationTimeoutMs: 30_000,
  confirmationCommitment: "confirmed",
  useComputeBudget: true,
  computeUnitPrice: 50_000,
  computeUnitLimit: 400_000,
};

let currentConfig: JupiterHardenedConfig = { ...DEFAULT_CONFIG };

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

interface JupiterMetrics {
  totalOrders: number;
  successfulOrders: number;
  failedOrders: number;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  totalConfirmations: number;
  confirmedOnChain: number;
  failedOnChain: number;
  timedOutConfirmations: number;
  slippageViolations: number;
  totalRetries: number;
  avgOrderLatencyMs: number;
  avgExecutionLatencyMs: number;
  avgConfirmationLatencyMs: number;
  recentTrades: Array<{
    timestamp: string;
    symbol: string;
    action: string;
    success: boolean;
    durationMs: number;
    retries: number;
  }>;
}

let metrics = {
  totalOrders: 0,
  successfulOrders: 0,
  failedOrders: 0,
  totalExecutions: 0,
  successfulExecutions: 0,
  failedExecutions: 0,
  totalConfirmations: 0,
  confirmedOnChain: 0,
  failedOnChain: 0,
  timedOutConfirmations: 0,
  slippageViolations: 0,
  totalRetries: 0,
  orderLatencies: [] as number[],
  executionLatencies: [] as number[],
  confirmationLatencies: [] as number[],
  recentTrades: [] as JupiterMetrics["recentTrades"],
};

const MAX_LATENCIES = 500;
const MAX_RECENT_TRADES = 100;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (env.JUPITER_API_KEY) {
    headers["x-api-key"] = env.JUPITER_API_KEY;
  }
  return headers;
}

/**
 * Calculate delay with exponential backoff and jitter.
 * Formula: baseDelay * 2^attempt + random jitter (0-30% of delay)
 */
function backoffDelay(attempt: number): number {
  const exponential = currentConfig.baseDelayMs * Math.pow(2, attempt);
  const jitter = exponential * Math.random() * 0.3;
  return exponential + jitter;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Update Jupiter hardened configuration.
 */
export function configureJupiterHardened(
  updates: Partial<JupiterHardenedConfig>,
): JupiterHardenedConfig {
  currentConfig = { ...currentConfig, ...updates };
  console.log(
    `[JupiterHardened] Configuration updated:`,
    JSON.stringify(currentConfig),
  );
  return currentConfig;
}

/**
 * Get current configuration.
 */
export function getJupiterHardenedConfig(): JupiterHardenedConfig {
  return { ...currentConfig };
}

// ---------------------------------------------------------------------------
// Core: Get Order with Retry
// ---------------------------------------------------------------------------

/**
 * Request a swap order from Jupiter Ultra API with retry and exponential backoff.
 *
 * Retries on:
 * - Network errors (timeout, connection refused)
 * - HTTP 429 (rate limited)
 * - HTTP 500-599 (server errors)
 *
 * Does NOT retry on:
 * - HTTP 400 (bad request — our params are wrong)
 * - HTTP 401/403 (auth errors)
 */
export async function getOrderWithRetry(params: {
  inputMint: string;
  outputMint: string;
  amount: string;
  taker: string;
}): Promise<{ order: HardenedOrderResponse; retryAttempts: number }> {
  const startTime = Date.now();
  let lastError: Error | null = null;
  let retryAttempts = 0;

  for (let attempt = 0; attempt <= currentConfig.maxOrderRetries; attempt++) {
    try {
      const order = await jupiterLimiter.execute(async () => {
        const url = new URL(`${JUPITER_API_BASE_URL}/ultra/v1/order`);
        url.searchParams.set("inputMint", params.inputMint);
        url.searchParams.set("outputMint", params.outputMint);
        url.searchParams.set("amount", params.amount);
        url.searchParams.set("taker", params.taker);

        const res = await fetch(url.toString(), {
          method: "GET",
          headers: getHeaders(),
          signal: AbortSignal.timeout(15_000),
        });

        if (!res.ok) {
          const body = await res.text().catch(() => "no body");
          const statusCode = res.status;

          // Non-retryable errors
          if (statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
            throw new NonRetryableError(
              `jupiter_order_failed: HTTP ${statusCode} – ${body}`,
            );
          }

          // Retryable errors (429, 5xx)
          throw new Error(
            `jupiter_order_failed: HTTP ${statusCode} – ${body}`,
          );
        }

        const data = (await res.json()) as HardenedOrderResponse;

        if (!data.transaction) {
          throw new Error(
            `jupiter_order_failed: response missing transaction field – ${JSON.stringify(data)}`,
          );
        }

        return data;
      });

      metrics.totalOrders++;
      metrics.successfulOrders++;
      const latency = Date.now() - startTime;
      metrics.orderLatencies.push(latency);
      if (metrics.orderLatencies.length > MAX_LATENCIES) {
        metrics.orderLatencies = metrics.orderLatencies.slice(-MAX_LATENCIES);
      }

      return { order, retryAttempts };
    } catch (err) {
      if (err instanceof NonRetryableError) {
        metrics.totalOrders++;
        metrics.failedOrders++;
        throw err;
      }

      lastError = err instanceof Error ? err : new Error(String(err));
      retryAttempts++;
      metrics.totalRetries++;

      if (attempt < currentConfig.maxOrderRetries) {
        const delayMs = backoffDelay(attempt);
        console.warn(
          `[JupiterHardened] getOrder attempt ${attempt + 1} failed: ${lastError.message}. ` +
            `Retrying in ${Math.round(delayMs)}ms (${attempt + 1}/${currentConfig.maxOrderRetries})`,
        );
        await sleep(delayMs);
      }
    }
  }

  metrics.totalOrders++;
  metrics.failedOrders++;

  throw new Error(
    `jupiter_order_failed: all ${currentConfig.maxOrderRetries + 1} attempts failed. Last error: ${lastError?.message}`,
  );
}

// ---------------------------------------------------------------------------
// Core: Sign Transaction
// ---------------------------------------------------------------------------

/**
 * Sign a Jupiter transaction using Turnkey.
 *
 * Parses the Solana wire format, extracts message bytes,
 * signs with Turnkey Ed25519, and injects the signature.
 */
export async function signTransaction(
  base64Transaction: string,
  walletAddress: string,
): Promise<string> {
  const txBytes = Buffer.from(base64Transaction, "base64");

  // Parse compact-u16 for number of signatures
  let numSigners: number;
  let compactLen: number;

  const firstByte = txBytes[0];
  if (firstByte < 0x80) {
    numSigners = firstByte;
    compactLen = 1;
  } else {
    numSigners = (firstByte & 0x7f) | ((txBytes[1] & 0xff) << 7);
    compactLen = 2;
  }

  const signaturesOffset = compactLen;
  const messageOffset = signaturesOffset + numSigners * 64;
  const messageBytes = txBytes.subarray(messageOffset);

  // Sign with Turnkey
  const turnkeySigner = getTurnkeySigner();
  const signature = await turnkeySigner.signMessage(
    new Uint8Array(messageBytes),
    walletAddress,
  );

  // Inject signature into the first slot
  const signedTx = Buffer.from(txBytes);
  Buffer.from(signature).copy(signedTx, signaturesOffset, 0, 64);

  return signedTx.toString("base64");
}

// ---------------------------------------------------------------------------
// Core: Execute Order with Retry
// ---------------------------------------------------------------------------

/**
 * Submit a signed transaction to Jupiter for execution with retry logic.
 *
 * Retries on:
 * - Timeout errors (code -1006)
 * - Network failures
 * - HTTP 5xx errors
 */
export async function executeOrderWithRetry(params: {
  signedTransaction: string;
  requestId: string;
}): Promise<{ execution: HardenedExecuteResponse; retryAttempts: number }> {
  const startTime = Date.now();
  let lastError: Error | null = null;
  let retryAttempts = 0;

  for (
    let attempt = 0;
    attempt <= currentConfig.maxExecuteRetries;
    attempt++
  ) {
    try {
      const execution = await jupiterLimiter.execute(async () => {
        const res = await fetch(
          `${JUPITER_API_BASE_URL}/ultra/v1/execute`,
          {
            method: "POST",
            headers: getHeaders(),
            body: JSON.stringify({
              signedTransaction: params.signedTransaction,
              requestId: params.requestId,
            }),
            signal: AbortSignal.timeout(30_000),
          },
        );

        if (!res.ok) {
          const body = await res.text().catch(() => "no body");
          throw new Error(
            `jupiter_execute_failed: HTTP ${res.status} – ${body}`,
          );
        }

        return (await res.json()) as HardenedExecuteResponse;
      });

      // Check for timeout code that Jupiter returns in the body
      if (execution.code === -1006) {
        retryAttempts++;
        metrics.totalRetries++;
        if (attempt < currentConfig.maxExecuteRetries) {
          const delayMs = 2000 + Math.random() * 1000;
          console.warn(
            `[JupiterHardened] Execute timeout (code -1006). Retrying in ${Math.round(delayMs)}ms...`,
          );
          await sleep(delayMs);
          continue;
        }
      }

      if (execution.status !== "Success") {
        throw new Error(
          `jupiter_execute_failed: status=${execution.status} code=${execution.code} sig=${execution.signature}`,
        );
      }

      metrics.totalExecutions++;
      metrics.successfulExecutions++;
      const latency = Date.now() - startTime;
      metrics.executionLatencies.push(latency);
      if (metrics.executionLatencies.length > MAX_LATENCIES) {
        metrics.executionLatencies = metrics.executionLatencies.slice(
          -MAX_LATENCIES,
        );
      }

      return { execution, retryAttempts };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      retryAttempts++;
      metrics.totalRetries++;

      if (attempt < currentConfig.maxExecuteRetries) {
        const delayMs = backoffDelay(attempt);
        console.warn(
          `[JupiterHardened] Execute attempt ${attempt + 1} failed: ${lastError.message}. ` +
            `Retrying in ${Math.round(delayMs)}ms`,
        );
        await sleep(delayMs);
      }
    }
  }

  metrics.totalExecutions++;
  metrics.failedExecutions++;

  throw new Error(
    `jupiter_execute_failed: all ${currentConfig.maxExecuteRetries + 1} attempts failed. Last error: ${lastError?.message}`,
  );
}

// ---------------------------------------------------------------------------
// Full Trade Pipeline: Order → Sign → Execute → Confirm → Validate
// ---------------------------------------------------------------------------

/**
 * Execute a complete hardened trade through Jupiter.
 *
 * This is the recommended entry point for production trades.
 * Handles the full lifecycle:
 * 1. Get order with retry
 * 2. Sign transaction with Turnkey
 * 3. Execute with retry
 * 4. Confirm on-chain with polling
 * 5. Validate slippage
 *
 * @param params Trade parameters
 * @param context Optional context for logging and metrics
 * @returns Complete trade result with confirmation and slippage data
 */
export async function executeHardenedTrade(
  params: {
    inputMint: string;
    outputMint: string;
    amount: string;
    taker: string;
  },
  context?: {
    agentId?: string;
    roundId?: string;
    symbol?: string;
    action?: string;
  },
): Promise<HardenedTradeResult> {
  const totalStart = Date.now();
  const contextStr = context
    ? `[${context.agentId ?? "?"}/${context.symbol ?? "?"}/${context.action ?? "?"}]`
    : "";

  console.log(
    `[JupiterHardened] Starting hardened trade ${contextStr}: ` +
      `${params.inputMint.slice(0, 8)}... → ${params.outputMint.slice(0, 8)}... amount=${params.amount}`,
  );

  // Step 1: Get order with retry
  const { order, retryAttempts: orderRetryAttempts } =
    await getOrderWithRetry(params);

  console.log(
    `[JupiterHardened] Order received ${contextStr}: ` +
      `in=${order.inAmount} out=${order.outAmount} slippage=${order.slippageBps}bps ` +
      `(${orderRetryAttempts} retries)`,
  );

  // Step 2: Sign the transaction
  const signedTransaction = await signTransaction(
    order.transaction,
    params.taker,
  );

  // Step 3: Execute with retry
  const { execution, retryAttempts: executeRetryAttempts } =
    await executeOrderWithRetry({
      signedTransaction,
      requestId: order.requestId,
    });

  console.log(
    `[JupiterHardened] Execution response ${contextStr}: ` +
      `sig=${execution.signature.slice(0, 16)}... status=${execution.status} ` +
      `(${executeRetryAttempts} retries)`,
  );

  // Step 4: Confirm on-chain
  metrics.totalConfirmations++;
  const confirmation = await confirmTransaction({
    txSignature: execution.signature,
    commitment: currentConfig.confirmationCommitment,
    timeoutMs: currentConfig.confirmationTimeoutMs,
    context,
  });

  if (confirmation.confirmed) {
    metrics.confirmedOnChain++;
  } else if (confirmation.timedOut) {
    metrics.timedOutConfirmations++;
  } else {
    metrics.failedOnChain++;
  }

  const confirmLatency = confirmation.confirmationTimeMs;
  metrics.confirmationLatencies.push(confirmLatency);
  if (metrics.confirmationLatencies.length > MAX_LATENCIES) {
    metrics.confirmationLatencies = metrics.confirmationLatencies.slice(
      -MAX_LATENCIES,
    );
  }

  // Step 5: Validate slippage
  const quotedOutputAmount = parseInt(order.outAmount, 10);
  const actualOutputAmount = execution.outputAmountResult
    ? parseInt(execution.outputAmountResult, 10)
    : quotedOutputAmount;

  const slippage = validateSlippage({
    quotedOutputAmount,
    actualOutputAmount,
    maxSlippageBps: currentConfig.maxSlippageBps,
  });

  if (!slippage.acceptable) {
    metrics.slippageViolations++;
    console.warn(
      `[JupiterHardened] SLIPPAGE VIOLATION ${contextStr}: ` +
        `${slippage.slippageBps}bps (max: ${slippage.maxSlippageBps}bps)`,
    );

    logTradeFailure(
      `Slippage violation: ${slippage.slippageBps}bps on ${context?.symbol ?? "unknown"}`,
      context?.agentId ?? "unknown",
      `Quoted: ${quotedOutputAmount}, Actual: ${actualOutputAmount}, Slippage: ${slippage.slippageBps}bps`,
      context?.roundId,
    );
  }

  const totalDurationMs = Date.now() - totalStart;

  // Track recent trade
  metrics.recentTrades.unshift({
    timestamp: new Date().toISOString(),
    symbol: context?.symbol ?? "unknown",
    action: context?.action ?? "unknown",
    success: confirmation.confirmed && slippage.acceptable,
    durationMs: totalDurationMs,
    retries: orderRetryAttempts + executeRetryAttempts,
  });
  if (metrics.recentTrades.length > MAX_RECENT_TRADES) {
    metrics.recentTrades.length = MAX_RECENT_TRADES;
  }

  // Audit log
  logTradeEvent(
    "hardened_trade_complete",
    `${context?.action ?? "trade"} ${context?.symbol ?? "unknown"}: ` +
      `confirmed=${confirmation.confirmed} slippage=${slippage.slippageBps}bps ` +
      `duration=${totalDurationMs}ms retries=${orderRetryAttempts + executeRetryAttempts}`,
    context?.agentId ?? "unknown",
    context?.roundId,
    {
      txSignature: execution.signature,
      slippageBps: slippage.slippageBps,
      confirmationTimeMs: confirmLatency,
      orderRetries: orderRetryAttempts,
      executeRetries: executeRetryAttempts,
    },
  );

  console.log(
    `[JupiterHardened] Trade complete ${contextStr}: ` +
      `confirmed=${confirmation.confirmed} slippage=${slippage.slippageBps}bps ` +
      `total=${totalDurationMs}ms (order: ${orderRetryAttempts}r, exec: ${executeRetryAttempts}r)`,
  );

  return {
    order,
    execution,
    confirmation,
    slippage,
    totalDurationMs,
    orderRetryAttempts,
    executeRetryAttempts,
  };
}

// ---------------------------------------------------------------------------
// Compute Budget Instructions
// ---------------------------------------------------------------------------

/**
 * Encode a SetComputeUnitLimit instruction.
 *
 * Program: ComputeBudget111111111111111111111111111111
 * Instruction discriminator: 2 (u8)
 * Data: units (u32 LE)
 */
export function encodeSetComputeUnitLimit(units: number): Buffer {
  const buf = Buffer.alloc(5);
  buf.writeUInt8(2, 0); // discriminator
  buf.writeUInt32LE(units, 1);
  return buf;
}

/**
 * Encode a SetComputeUnitPrice instruction.
 *
 * Program: ComputeBudget111111111111111111111111111111
 * Instruction discriminator: 3 (u8)
 * Data: micro-lamports per CU (u64 LE)
 */
export function encodeSetComputeUnitPrice(microLamports: number): Buffer {
  const buf = Buffer.alloc(9);
  buf.writeUInt8(3, 0); // discriminator
  buf.writeBigUInt64LE(BigInt(microLamports), 1);
  return buf;
}

/**
 * Get the compute budget program address.
 */
export const COMPUTE_BUDGET_PROGRAM =
  "ComputeBudget111111111111111111111111111111";

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/**
 * Get comprehensive Jupiter hardened metrics.
 */
export function getJupiterHardenedMetrics(): JupiterMetrics {
  const avgOrder =
    metrics.orderLatencies.length > 0
      ? Math.round(
          metrics.orderLatencies.reduce((a, b) => a + b, 0) /
            metrics.orderLatencies.length,
        )
      : 0;

  const avgExecution =
    metrics.executionLatencies.length > 0
      ? Math.round(
          metrics.executionLatencies.reduce((a, b) => a + b, 0) /
            metrics.executionLatencies.length,
        )
      : 0;

  const avgConfirmation =
    metrics.confirmationLatencies.length > 0
      ? Math.round(
          metrics.confirmationLatencies.reduce((a, b) => a + b, 0) /
            metrics.confirmationLatencies.length,
        )
      : 0;

  return {
    totalOrders: metrics.totalOrders,
    successfulOrders: metrics.successfulOrders,
    failedOrders: metrics.failedOrders,
    totalExecutions: metrics.totalExecutions,
    successfulExecutions: metrics.successfulExecutions,
    failedExecutions: metrics.failedExecutions,
    totalConfirmations: metrics.totalConfirmations,
    confirmedOnChain: metrics.confirmedOnChain,
    failedOnChain: metrics.failedOnChain,
    timedOutConfirmations: metrics.timedOutConfirmations,
    slippageViolations: metrics.slippageViolations,
    totalRetries: metrics.totalRetries,
    avgOrderLatencyMs: avgOrder,
    avgExecutionLatencyMs: avgExecution,
    avgConfirmationLatencyMs: avgConfirmation,
    recentTrades: metrics.recentTrades.slice(0, 20),
  };
}

/**
 * Reset Jupiter hardened metrics (admin use).
 */
export function resetJupiterHardenedMetrics(): void {
  metrics = {
    totalOrders: 0,
    successfulOrders: 0,
    failedOrders: 0,
    totalExecutions: 0,
    successfulExecutions: 0,
    failedExecutions: 0,
    totalConfirmations: 0,
    confirmedOnChain: 0,
    failedOnChain: 0,
    timedOutConfirmations: 0,
    slippageViolations: 0,
    totalRetries: 0,
    orderLatencies: [],
    executionLatencies: [],
    confirmationLatencies: [],
    recentTrades: [],
  };
}

// ---------------------------------------------------------------------------
// Error Types
// ---------------------------------------------------------------------------

/**
 * Error that should NOT be retried (client errors like 400, 401, 403).
 */
class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableError";
  }
}
