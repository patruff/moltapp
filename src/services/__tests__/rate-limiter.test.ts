/**
 * Rate Limiter Tests
 *
 * Validates the token bucket rate limiter:
 * - Token consumption and refill
 * - Queue behavior when rate limited
 * - Metrics tracking
 * - Jitter generation
 * - Pre-configured bucket instances
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  TokenBucketRateLimiter,
  getTradeJitterMs,
  getAllRateLimiterMetrics,
  type RateLimiterConfig,
} from "../rate-limiter.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<RateLimiterConfig> = {}): RateLimiterConfig {
  return {
    name: "test-limiter",
    maxTokens: 3,
    refillRate: 3,
    refillIntervalMs: 1000,
    maxQueueSize: 5,
    ...overrides,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TokenBucketRateLimiter", () => {
  let limiter: TokenBucketRateLimiter;

  afterEach(() => {
    limiter?.destroy();
  });

  describe("Token consumption", () => {
    it("should execute immediately when tokens available", async () => {
      limiter = new TokenBucketRateLimiter(makeConfig({ maxTokens: 5 }));
      let called = false;
      await limiter.execute(async () => {
        called = true;
        return "ok";
      });
      expect(called).toBe(true);
    });

    it("should track token count in metrics", async () => {
      limiter = new TokenBucketRateLimiter(makeConfig({ maxTokens: 3 }));
      expect(limiter.metrics.currentTokens).toBe(3);

      await limiter.execute(async () => "a");
      expect(limiter.metrics.currentTokens).toBe(2);

      await limiter.execute(async () => "b");
      expect(limiter.metrics.currentTokens).toBe(1);
    });

    it("should return the result from the executed function", async () => {
      limiter = new TokenBucketRateLimiter(makeConfig());
      const result = await limiter.execute(async () => 42);
      expect(result).toBe(42);
    });
  });

  describe("Rate limiting and queueing", () => {
    it("should reject when queue is full", async () => {
      limiter = new TokenBucketRateLimiter(
        makeConfig({ maxTokens: 0, maxQueueSize: 1, refillIntervalMs: 60000 }),
      );

      // First request gets queued (never completes in this test)
      const p1 = limiter.execute(async () => "queued-1").catch(() => "rejected");

      // Second request should be rejected (queue of 1 is full)
      await expect(
        limiter.execute(async () => "rejected"),
      ).rejects.toThrow("Queue full");

      // Clean up the queued promise
      limiter.destroy();
      await p1;
    });

    it("should track rate limit hits in metrics", async () => {
      limiter = new TokenBucketRateLimiter(
        makeConfig({ maxTokens: 1, maxQueueSize: 10, refillIntervalMs: 60000 }),
      );

      // First call consumes the only token
      await limiter.execute(async () => "ok");
      expect(limiter.metrics.rateLimitHits).toBe(0);

      // Second call will be rate limited and queued
      const queuedPromise = limiter.execute(async () => "queued");
      expect(limiter.metrics.rateLimitHits).toBe(1);

      limiter.destroy();
      await queuedPromise.catch(() => {}); // Clean up
    });
  });

  describe("Metrics", () => {
    it("should track total requests", async () => {
      limiter = new TokenBucketRateLimiter(makeConfig({ maxTokens: 10 }));
      expect(limiter.metrics.totalRequests).toBe(0);

      await limiter.execute(async () => null);
      await limiter.execute(async () => null);
      await limiter.execute(async () => null);

      expect(limiter.metrics.totalRequests).toBe(3);
    });

    it("should report correct metric structure", () => {
      limiter = new TokenBucketRateLimiter(makeConfig());
      const m = limiter.metrics;
      expect(m).toHaveProperty("name", "test-limiter");
      expect(m).toHaveProperty("currentTokens");
      expect(m).toHaveProperty("maxTokens");
      expect(m).toHaveProperty("queueDepth");
      expect(m).toHaveProperty("totalRequests");
      expect(m).toHaveProperty("rateLimitHits");
      expect(m).toHaveProperty("totalWaitMs");
      expect(m).toHaveProperty("avgWaitMs");
    });
  });

  describe("Destroy", () => {
    it("should reject queued items on destroy", async () => {
      limiter = new TokenBucketRateLimiter(
        makeConfig({ maxTokens: 0, maxQueueSize: 10, refillIntervalMs: 60000 }),
      );

      const p = limiter.execute(async () => "never").catch((err) => err.message);
      limiter.destroy();
      const msg = await p;
      expect(msg).toContain("Shutting down");
    });
  });
});

describe("Trade Jitter", () => {
  it("should return a value between 1000 and 5000ms", () => {
    for (let i = 0; i < 100; i++) {
      const jitter = getTradeJitterMs();
      expect(jitter).toBeGreaterThanOrEqual(1000);
      expect(jitter).toBeLessThan(5000);
    }
  });

  it("should produce different values (not constant)", () => {
    const values = new Set<number>();
    for (let i = 0; i < 50; i++) {
      values.add(getTradeJitterMs());
    }
    expect(values.size).toBeGreaterThan(1);
  });
});

describe("Pre-configured Rate Limiters", () => {
  it("should expose metrics for all 3 buckets", () => {
    const metrics = getAllRateLimiterMetrics();
    expect(metrics).toHaveLength(3);
    expect(metrics.map((m) => m.name)).toEqual([
      "solana-rpc",
      "llm-api",
      "jupiter-dex",
    ]);
  });
});
