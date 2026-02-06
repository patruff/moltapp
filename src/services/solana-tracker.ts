/**
 * Solana Chain Tracker
 *
 * Connects to Solana RPC to track wallet balances, token holdings, and
 * transaction history. Provides polling-based wallet watching with
 * configurable callbacks.
 *
 * Features:
 * - SOL balance queries
 * - SPL token balance enumeration (xStocks)
 * - Transaction history fetching
 * - Wallet polling with callback notifications
 * - Retry logic with exponential backoff
 * - Rate limiting: max 5 RPC calls/second with queuing
 */

import {
  createSolanaRpc,
  address,
  signature as toSignature,
  type Address,
  type Signature,
} from "@solana/kit";
import { env } from "../config/env.ts";
import { errorMessage } from "../lib/errors.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TokenBalance {
  mintAddress: string;
  /** Raw amount as string (no decimal adjustment) */
  rawAmount: string;
  /** Human-readable amount (adjusted for decimals) */
  amount: number;
  decimals: number;
  /** Token account address on-chain */
  tokenAccount: string;
}

export interface WalletBalances {
  address: string;
  solBalance: number;
  solBalanceLamports: bigint;
  tokens: TokenBalance[];
  fetchedAt: string;
}

export interface TransactionInfo {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: unknown | null;
  memo: string | null;
}

export interface WalletWatcher {
  address: string;
  intervalId: ReturnType<typeof setInterval>;
  lastSignature: string | null;
  stop: () => void;
}

type WalletChangeCallback = (
  address: string,
  transactions: TransactionInfo[],
) => void;

// ---------------------------------------------------------------------------
// RPC Rate Limiter (5 calls per second)
// ---------------------------------------------------------------------------

const RPC_RATE_LIMIT = 5;
const RPC_RATE_WINDOW_MS = 1000;

interface QueuedRequest<T> {
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  enqueuedAt: number;
}

class RpcRateLimiter {
  private callTimestamps: number[] = [];
  private queue: QueuedRequest<unknown>[] = [];
  private processing = false;

  /** Metrics */
  private _totalCalls = 0;
  private _rateLimitHits = 0;
  private _totalWaitMs = 0;

  get metrics() {
    return {
      totalCalls: this._totalCalls,
      rateLimitHits: this._rateLimitHits,
      avgWaitMs:
        this._totalCalls > 0
          ? Math.round(this._totalWaitMs / this._totalCalls)
          : 0,
      queueDepth: this.queue.length,
    };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this._totalCalls++;

    // Check if we can execute immediately
    const now = Date.now();
    this.callTimestamps = this.callTimestamps.filter(
      (ts) => now - ts < RPC_RATE_WINDOW_MS,
    );

    if (this.callTimestamps.length < RPC_RATE_LIMIT) {
      this.callTimestamps.push(now);
      return fn();
    }

    // Queue the request
    this._rateLimitHits++;
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        execute: fn as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
        enqueuedAt: now,
      });
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      this.callTimestamps = this.callTimestamps.filter(
        (ts) => now - ts < RPC_RATE_WINDOW_MS,
      );

      if (this.callTimestamps.length >= RPC_RATE_LIMIT) {
        // Wait until the oldest call expires
        const oldestTs = this.callTimestamps[0];
        const waitMs = RPC_RATE_WINDOW_MS - (now - oldestTs) + 10;
        await sleep(waitMs);
        continue;
      }

      const item = this.queue.shift();
      if (!item) break;

      this._totalWaitMs += Date.now() - item.enqueuedAt;
      this.callTimestamps.push(Date.now());

      try {
        const result = await item.execute();
        item.resolve(result);
      } catch (err) {
        item.reject(err instanceof Error ? err : new Error(String(err)));
      }
    }

    this.processing = false;
  }
}

const rpcLimiter = new RpcRateLimiter();

// ---------------------------------------------------------------------------
// Retry with exponential backoff
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

async function withRetry<T>(
  operation: () => Promise<T>,
  label: string,
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await rpcLimiter.execute(operation);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        const delayMs = BASE_DELAY_MS * Math.pow(2, attempt);
        const jitter = Math.random() * delayMs * 0.3;
        console.warn(
          `[SolanaTracker] ${label} attempt ${attempt + 1} failed: ${lastError.message}. Retrying in ${Math.round(delayMs + jitter)}ms...`,
        );
        await sleep(delayMs + jitter);
      }
    }
  }

  throw new Error(
    `[SolanaTracker] ${label} failed after ${MAX_RETRIES + 1} attempts: ${lastError?.message}`,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getSolanaRpc() {
  const rpcUrl =
    env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  return createSolanaRpc(rpcUrl);
}

const LAMPORTS_PER_SOL = 1_000_000_000;

// ---------------------------------------------------------------------------
// Core Functions
// ---------------------------------------------------------------------------

/**
 * Get SOL balance for a wallet address.
 * Returns balance in SOL (as a number) and raw lamports (as bigint).
 */
export async function getBalance(
  walletAddress: string,
): Promise<{ sol: number; lamports: bigint }> {
  const rpc = getSolanaRpc();

  const result = await withRetry(async () => {
    const response = await rpc
      .getBalance(address(walletAddress))
      .send();
    return response.value;
  }, `getBalance(${walletAddress.slice(0, 8)}...)`);

  return {
    sol: Number(result) / LAMPORTS_PER_SOL,
    lamports: result,
  };
}

/**
 * Get all SPL token balances for a wallet address.
 * Returns an array of token holdings including xStocks and other SPL tokens.
 */
export async function getTokenBalances(
  walletAddress: string,
): Promise<TokenBalance[]> {
  const rpc = getSolanaRpc();

  // Token program IDs to query
  const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

  const results: TokenBalance[] = [];

  for (const programId of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
    try {
      const accounts = await withRetry(async () => {
        const response = await rpc
          .getTokenAccountsByOwner(
            address(walletAddress),
            { programId: address(programId) as Address<typeof programId> },
            { encoding: "jsonParsed" },
          )
          .send();
        return response.value;
      }, `getTokenAccounts(${walletAddress.slice(0, 8)}..., ${programId.slice(0, 8)}...)`);

      for (const account of accounts) {
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
        if (!info?.mint || !info?.tokenAmount) continue;

        const rawAmount = info.tokenAmount.amount ?? "0";
        const decimals = info.tokenAmount.decimals ?? 0;
        const amount = info.tokenAmount.uiAmount ?? 0;

        // Skip zero-balance accounts
        if (rawAmount === "0") continue;

        results.push({
          mintAddress: info.mint,
          rawAmount,
          amount,
          decimals,
          tokenAccount: account.pubkey as unknown as string,
        });
      }
    } catch (err) {
      console.warn(
        `[SolanaTracker] Failed to fetch token accounts for program ${programId.slice(0, 8)}...: ${errorMessage(err)}`,
      );
    }
  }

  return results;
}

/**
 * Get full wallet balances including SOL and all tokens.
 */
export async function getWalletBalances(
  walletAddress: string,
): Promise<WalletBalances> {
  const [solResult, tokens] = await Promise.all([
    getBalance(walletAddress),
    getTokenBalances(walletAddress),
  ]);

  return {
    address: walletAddress,
    solBalance: solResult.sol,
    solBalanceLamports: solResult.lamports,
    tokens,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Get recent transactions for a wallet address.
 */
export async function getRecentTransactions(
  walletAddress: string,
  limit = 20,
): Promise<TransactionInfo[]> {
  const rpc = getSolanaRpc();

  const signatures = await withRetry(async () => {
    const response = await rpc
      .getSignaturesForAddress(address(walletAddress), {
        limit,
      })
      .send();
    return response;
  }, `getRecentTransactions(${walletAddress.slice(0, 8)}...)`);

  return signatures.map((sig) => ({
    signature: sig.signature as unknown as string,
    slot: Number(sig.slot),
    blockTime: sig.blockTime ? Number(sig.blockTime) : null,
    err: sig.err,
    memo: sig.memo ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Wallet Watching (Polling)
// ---------------------------------------------------------------------------

/** Active watchers, keyed by wallet address */
const activeWatchers = new Map<string, WalletWatcher>();

/**
 * Watch a wallet for new transactions by polling every `intervalMs`.
 * Calls the callback with any new transactions since last check.
 *
 * Default polling interval: 60 seconds.
 */
export function watchWallet(
  walletAddress: string,
  callback: WalletChangeCallback,
  intervalMs = 60_000,
): WalletWatcher {
  // Stop existing watcher for this address
  const existing = activeWatchers.get(walletAddress);
  if (existing) {
    existing.stop();
  }

  let lastSignature: string | null = null;
  let isPolling = false;

  const poll = async () => {
    if (isPolling) return;
    isPolling = true;

    try {
      const rpc = getSolanaRpc();

      const signatures = await withRetry(async () => {
        const opts: { limit: number; until?: Signature } = { limit: 10 };
        if (lastSignature) {
          opts.until = toSignature(lastSignature);
        }
        const response = await rpc
          .getSignaturesForAddress(address(walletAddress), opts)
          .send();
        return response;
      }, `watchPoll(${walletAddress.slice(0, 8)}...)`);

      if (signatures.length > 0) {
        const newTxs: TransactionInfo[] = signatures.map((sig) => ({
          signature: sig.signature as unknown as string,
          slot: Number(sig.slot),
          blockTime: sig.blockTime ? Number(sig.blockTime) : null,
          err: sig.err,
          memo: sig.memo ?? null,
        }));

        lastSignature = newTxs[0].signature;

        // Only callback if we had a previous checkpoint (skip first poll)
        if (lastSignature !== null) {
          callback(walletAddress, newTxs);
        }
      }
    } catch (err) {
      console.error(
        `[SolanaTracker] Watch poll failed for ${walletAddress.slice(0, 8)}...: ${errorMessage(err)}`,
      );
    } finally {
      isPolling = false;
    }
  };

  // Initial poll to set the baseline
  poll();

  const intervalId = setInterval(poll, intervalMs);

  const watcher: WalletWatcher = {
    address: walletAddress,
    intervalId,
    lastSignature,
    stop: () => {
      clearInterval(intervalId);
      activeWatchers.delete(walletAddress);
      console.log(
        `[SolanaTracker] Stopped watching ${walletAddress.slice(0, 8)}...`,
      );
    },
  };

  activeWatchers.set(walletAddress, watcher);
  return watcher;
}

/**
 * Stop all active wallet watchers.
 */
export function stopAllWatchers(): void {
  for (const [addr, watcher] of activeWatchers) {
    clearInterval(watcher.intervalId);
    console.log(`[SolanaTracker] Stopped watching ${addr.slice(0, 8)}...`);
  }
  activeWatchers.clear();
}

/**
 * Get the number of active watchers.
 */
export function getActiveWatcherCount(): number {
  return activeWatchers.size;
}

/**
 * Get RPC rate limiter metrics.
 */
export function getRpcMetrics() {
  return rpcLimiter.metrics;
}
