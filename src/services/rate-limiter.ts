/**
 * Token Bucket Rate Limiter
 *
 * Generic rate limiting infrastructure for all external API calls.
 * Uses token bucket algorithm with queuing and jitter.
 *
 * Pre-configured buckets:
 * - Solana RPC: 5 requests/second
 * - LLM APIs (Anthropic/OpenAI/xAI): 10 requests/minute
 * - Jupiter DEX: 2 requests/second
 *
 * Features:
 * - Token bucket with refill
 * - Queue with FIFO ordering when rate limit hit
 * - Random jitter (1-5 seconds) for trade executions
 * - Metrics: rate limit hits, queue depth, avg wait time
 */

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Solana RPC Rate Limiting Configuration
 *
 * Controls throughput for on-chain data queries (getBalance, getTransaction, getAccountInfo).
 * Conservative limit to avoid overwhelming public RPC endpoints.
 */

/** Maximum Solana RPC requests allowed in bucket at once */
const SOLANA_RPC_MAX_TOKENS = 5;

/** Tokens refilled per interval for Solana RPC (5/sec = 300/min) */
const SOLANA_RPC_REFILL_RATE = 5;

/** Refill interval for Solana RPC in milliseconds (1 second) */
const SOLANA_RPC_REFILL_INTERVAL_MS = 1000;

/** Maximum queued Solana RPC requests before rejecting new ones */
const SOLANA_RPC_MAX_QUEUE_SIZE = 100;

/**
 * LLM API Rate Limiting Configuration
 *
 * Controls throughput for Claude/GPT/Grok agent reasoning calls.
 * Matches typical tier-1 API rate limits (10 requests/minute).
 */

/** Maximum LLM API requests allowed in bucket at once */
const LLM_API_MAX_TOKENS = 10;

/** Tokens refilled per interval for LLM APIs (10/min) */
const LLM_API_REFILL_RATE = 10;

/** Refill interval for LLM APIs in milliseconds (60 seconds) */
const LLM_API_REFILL_INTERVAL_MS = 60_000;

/** Maximum queued LLM API requests before rejecting new ones */
const LLM_API_MAX_QUEUE_SIZE = 20;

/**
 * Jupiter DEX Rate Limiting Configuration
 *
 * Controls throughput for DEX swap executions and quote requests.
 * Conservative limit (2/sec) to avoid triggering Jupiter's anti-spam filters.
 */

/** Maximum Jupiter DEX requests allowed in bucket at once */
const JUPITER_MAX_TOKENS = 2;

/** Tokens refilled per interval for Jupiter DEX (2/sec = 120/min) */
const JUPITER_REFILL_RATE = 2;

/** Refill interval for Jupiter DEX in milliseconds (1 second) */
const JUPITER_REFILL_INTERVAL_MS = 1000;

/** Maximum queued Jupiter DEX requests before rejecting new ones */
const JUPITER_MAX_QUEUE_SIZE = 50;

/**
 * Trade Execution Jitter Parameters
 *
 * Random delay added between sequential agent trade executions to:
 * - Prevent all agents from hitting Jupiter simultaneously
 * - Reduce MEV risk from predictable execution timing
 * - Smooth out RPC load spikes
 */

/** Minimum jitter delay in milliseconds (1 second floor) */
const JITTER_MIN_MS = 1000;

/** Maximum jitter delay in milliseconds (5 second ceiling) */
const JITTER_MAX_MS = 5000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RateLimiterConfig {
  /** Human-readable name for logging */
  name: string;
  /** Maximum tokens in the bucket */
  maxTokens: number;
  /** Tokens added per refill */
  refillRate: number;
  /** Refill interval in milliseconds */
  refillIntervalMs: number;
  /** Maximum queue size (0 = unlimited) */
  maxQueueSize?: number;
}

export interface RateLimiterMetrics {
  name: string;
  currentTokens: number;
  maxTokens: number;
  queueDepth: number;
  totalRequests: number;
  rateLimitHits: number;
  totalWaitMs: number;
  avgWaitMs: number;
}

interface QueuedItem<T> {
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  enqueuedAt: number;
}

// ---------------------------------------------------------------------------
// Token Bucket Rate Limiter
// ---------------------------------------------------------------------------

export class TokenBucketRateLimiter {
  private tokens: number;
  private readonly config: RateLimiterConfig;
  private readonly queue: QueuedItem<unknown>[] = [];
  private processing = false;
  private lastRefillTime: number;
  private refillIntervalId: ReturnType<typeof setInterval> | null = null;

  // Metrics
  private _totalRequests = 0;
  private _rateLimitHits = 0;
  private _totalWaitMs = 0;

  constructor(config: RateLimiterConfig) {
    this.config = config;
    this.tokens = config.maxTokens;
    this.lastRefillTime = Date.now();

    // Start refill timer
    this.refillIntervalId = setInterval(() => {
      this.refill();
    }, config.refillIntervalMs);
  }

  get metrics(): RateLimiterMetrics {
    return {
      name: this.config.name,
      currentTokens: this.tokens,
      maxTokens: this.config.maxTokens,
      queueDepth: this.queue.length,
      totalRequests: this._totalRequests,
      rateLimitHits: this._rateLimitHits,
      totalWaitMs: this._totalWaitMs,
      avgWaitMs:
        this._totalRequests > 0
          ? Math.round(this._totalWaitMs / this._totalRequests)
          : 0,
    };
  }

  /**
   * Execute a function with rate limiting.
   * If a token is available, executes immediately.
   * Otherwise, queues the request and processes when tokens refill.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this._totalRequests++;

    // Try to consume a token immediately
    if (this.tokens > 0) {
      this.tokens--;
      return fn();
    }

    // Rate limited — queue the request
    this._rateLimitHits++;

    const maxQueue = this.config.maxQueueSize ?? 0;
    if (maxQueue > 0 && this.queue.length >= maxQueue) {
      throw new Error(
        `[RateLimiter:${this.config.name}] Queue full (${maxQueue} items). Request rejected.`,
      );
    }

    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        execute: fn as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
        enqueuedAt: Date.now(),
      });
    });
  }

  /**
   * Refill tokens and process queued requests.
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefillTime;
    const intervals = Math.floor(elapsed / this.config.refillIntervalMs);

    if (intervals > 0) {
      this.tokens = Math.min(
        this.config.maxTokens,
        this.tokens + this.config.refillRate * intervals,
      );
      this.lastRefillTime = now;
    }

    this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      while (this.queue.length > 0 && this.tokens > 0) {
        this.tokens--;
        const item = this.queue.shift();
        if (!item) break;

        this._totalWaitMs += Date.now() - item.enqueuedAt;

        try {
          const result = await item.execute();
          item.resolve(result);
        } catch (err) {
          item.reject(err instanceof Error ? err : new Error(String(err)));
        }
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * Stop the refill timer. Call when shutting down.
   */
  destroy(): void {
    if (this.refillIntervalId !== null) {
      clearInterval(this.refillIntervalId);
      this.refillIntervalId = null;
    }

    // Reject all queued requests
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      item?.reject(
        new Error(`[RateLimiter:${this.config.name}] Shutting down`),
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Pre-configured Buckets
// ---------------------------------------------------------------------------

/** Solana RPC: 5 requests per second */
export const solanaRpcLimiter = new TokenBucketRateLimiter({
  name: "solana-rpc",
  maxTokens: SOLANA_RPC_MAX_TOKENS,
  refillRate: SOLANA_RPC_REFILL_RATE,
  refillIntervalMs: SOLANA_RPC_REFILL_INTERVAL_MS,
  maxQueueSize: SOLANA_RPC_MAX_QUEUE_SIZE,
});

/** LLM APIs (Anthropic/OpenAI/xAI): 10 requests per minute */
export const llmApiLimiter = new TokenBucketRateLimiter({
  name: "llm-api",
  maxTokens: LLM_API_MAX_TOKENS,
  refillRate: LLM_API_REFILL_RATE,
  refillIntervalMs: LLM_API_REFILL_INTERVAL_MS,
  maxQueueSize: LLM_API_MAX_QUEUE_SIZE,
});

/** Jupiter DEX: 2 requests per second */
export const jupiterLimiter = new TokenBucketRateLimiter({
  name: "jupiter-dex",
  maxTokens: JUPITER_MAX_TOKENS,
  refillRate: JUPITER_REFILL_RATE,
  refillIntervalMs: JUPITER_REFILL_INTERVAL_MS,
  maxQueueSize: JUPITER_MAX_QUEUE_SIZE,
});

// ---------------------------------------------------------------------------
// Trade Execution Jitter
// ---------------------------------------------------------------------------

/**
 * Add random jitter between agent trade executions.
 * Returns a delay in milliseconds between JITTER_MIN_MS and JITTER_MAX_MS.
 */
export function getTradeJitterMs(): number {
  return JITTER_MIN_MS + Math.floor(Math.random() * (JITTER_MAX_MS - JITTER_MIN_MS));
}

/**
 * Sleep for the jitter duration. Call between agent executions.
 */
export async function applyTradeJitter(): Promise<void> {
  const jitterMs = getTradeJitterMs();
  console.log(
    `[RateLimiter] Applying ${jitterMs}ms jitter before next trade execution`,
  );
  await new Promise((resolve) => setTimeout(resolve, jitterMs));
}

// ---------------------------------------------------------------------------
// Aggregate Metrics
// ---------------------------------------------------------------------------

/**
 * Get metrics for all pre-configured rate limiters.
 */
export function getAllRateLimiterMetrics(): RateLimiterMetrics[] {
  return [
    solanaRpcLimiter.metrics,
    llmApiLimiter.metrics,
    jupiterLimiter.metrics,
  ];
}

/**
 * Destroy all pre-configured rate limiters (call on shutdown).
 */
export function destroyAllRateLimiters(): void {
  solanaRpcLimiter.destroy();
  llmApiLimiter.destroy();
  jupiterLimiter.destroy();
}
