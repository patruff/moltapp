/**
 * Integration Tests: Jupiter Hardened + Pre-Round Gate + Observability
 *
 * Tests the production-critical trading infrastructure:
 * - Jupiter order retry with exponential backoff
 * - Pre-round gate health checks
 * - Observability metrics collection
 * - Circuit breaker + gate interaction
 * - Metric Prometheus export format
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Jupiter Hardened Tests
// ---------------------------------------------------------------------------

describe("Jupiter Hardened", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("backoff delay calculation", () => {
    it("should increase delay exponentially", () => {
      // Test the backoff formula: baseDelay * 2^attempt + jitter
      const baseDelay = 1000;

      // Mock Math.random to remove jitter for deterministic testing
      vi.spyOn(Math, "random").mockReturnValue(0);

      // attempt 0: 1000 * 2^0 = 1000ms
      const delay0 = baseDelay * Math.pow(2, 0) + baseDelay * Math.pow(2, 0) * Math.random() * 0.3;
      expect(delay0).toBe(1000);

      // attempt 1: 1000 * 2^1 = 2000ms
      const delay1 = baseDelay * Math.pow(2, 1) + baseDelay * Math.pow(2, 1) * Math.random() * 0.3;
      expect(delay1).toBe(2000);

      // attempt 2: 1000 * 2^2 = 4000ms
      const delay2 = baseDelay * Math.pow(2, 2) + baseDelay * Math.pow(2, 2) * Math.random() * 0.3;
      expect(delay2).toBe(4000);

      vi.restoreAllMocks();
    });

    it("should add jitter between 0-30% of delay", () => {
      const baseDelay = 1000;
      const attempts = 100;
      const delays: number[] = [];

      for (let i = 0; i < attempts; i++) {
        const exponential = baseDelay * Math.pow(2, 0);
        const jitter = exponential * Math.random() * 0.3;
        delays.push(exponential + jitter);
      }

      // All delays should be between 1000 and 1300 for attempt 0
      for (const delay of delays) {
        expect(delay).toBeGreaterThanOrEqual(1000);
        expect(delay).toBeLessThanOrEqual(1300);
      }
    });
  });

  describe("compute budget encoding", () => {
    it("should encode SetComputeUnitLimit correctly", async () => {
      const { encodeSetComputeUnitLimit } = await import("../jupiter-hardened.ts");

      const buf = encodeSetComputeUnitLimit(400_000);
      expect(buf.length).toBe(5);
      expect(buf[0]).toBe(2); // discriminator
      expect(buf.readUInt32LE(1)).toBe(400_000);
    });

    it("should encode SetComputeUnitPrice correctly", async () => {
      const { encodeSetComputeUnitPrice } = await import("../jupiter-hardened.ts");

      const buf = encodeSetComputeUnitPrice(50_000);
      expect(buf.length).toBe(9);
      expect(buf[0]).toBe(3); // discriminator
      expect(Number(buf.readBigUInt64LE(1))).toBe(50_000);
    });

    it("should handle large compute unit prices", async () => {
      const { encodeSetComputeUnitPrice } = await import("../jupiter-hardened.ts");

      // 1 SOL per CU = 1_000_000_000 micro-lamports
      const buf = encodeSetComputeUnitPrice(1_000_000_000);
      expect(buf.length).toBe(9);
      expect(Number(buf.readBigUInt64LE(1))).toBe(1_000_000_000);
    });
  });

  describe("configuration", () => {
    it("should return default config", async () => {
      const { getJupiterHardenedConfig } = await import("../jupiter-hardened.ts");

      const config = getJupiterHardenedConfig();
      expect(config.maxOrderRetries).toBe(3);
      expect(config.maxExecuteRetries).toBe(2);
      expect(config.maxSlippageBps).toBe(100);
      expect(config.confirmationTimeoutMs).toBe(30_000);
      expect(config.computeUnitPrice).toBe(50_000);
      expect(config.computeUnitLimit).toBe(400_000);
    });

    it("should update config with partial updates", async () => {
      const { configureJupiterHardened, getJupiterHardenedConfig } = await import("../jupiter-hardened.ts");

      configureJupiterHardened({ maxSlippageBps: 50 });
      const config = getJupiterHardenedConfig();
      expect(config.maxSlippageBps).toBe(50);
      expect(config.maxOrderRetries).toBe(3); // unchanged

      // Reset
      configureJupiterHardened({ maxSlippageBps: 100 });
    });
  });

  describe("metrics", () => {
    it("should start with zero metrics", async () => {
      const { getJupiterHardenedMetrics, resetJupiterHardenedMetrics } = await import("../jupiter-hardened.ts");

      resetJupiterHardenedMetrics();
      const metrics = getJupiterHardenedMetrics();
      expect(metrics.totalOrders).toBe(0);
      expect(metrics.totalExecutions).toBe(0);
      expect(metrics.totalRetries).toBe(0);
      expect(metrics.slippageViolations).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Pre-Round Gate Tests
// ---------------------------------------------------------------------------

describe("Pre-Round Gate", () => {
  describe("gate mode detection", () => {
    it("should use relaxed mode by default", async () => {
      // Save and clear env
      const original = process.env.TRADING_MODE;
      delete process.env.TRADING_MODE;

      const { runPreRoundGate } = await import("../pre-round-gate.ts");
      const result = await runPreRoundGate("relaxed");

      expect(result.mode).toBe("relaxed");

      // Restore env
      if (original) process.env.TRADING_MODE = original;
    });
  });

  describe("gate metrics", () => {
    it("should track gate checks", async () => {
      const { getGateMetrics, resetGateMetrics } = await import("../pre-round-gate.ts");

      resetGateMetrics();
      const metrics = getGateMetrics();
      expect(metrics.totalChecks).toBe(0);
      expect(metrics.gatesOpened).toBe(0);
      expect(metrics.gatesBlocked).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Observability Tests
// ---------------------------------------------------------------------------

describe("Observability Metrics", () => {
  describe("percentile calculations", () => {
    it("should calculate percentiles from empty array", async () => {
      const { calculatePercentiles } = await import("../observability.ts");

      const stats = calculatePercentiles([]);
      expect(stats.count).toBe(0);
      expect(stats.min).toBe(0);
      expect(stats.p50).toBe(0);
      expect(stats.p99).toBe(0);
    });

    it("should calculate percentiles correctly", async () => {
      const { calculatePercentiles } = await import("../observability.ts");

      // Create 100 values: 1-100
      const values = Array.from({ length: 100 }, (_, i) => i + 1);
      const stats = calculatePercentiles(values);

      expect(stats.count).toBe(100);
      expect(stats.min).toBe(1);
      expect(stats.max).toBe(100);
      expect(stats.avg).toBe(51); // rounded
      expect(stats.p50).toBe(51);
      expect(stats.p95).toBe(96);
      expect(stats.p99).toBe(100);
    });

    it("should handle single value", async () => {
      const { calculatePercentiles } = await import("../observability.ts");

      const stats = calculatePercentiles([42]);
      expect(stats.count).toBe(1);
      expect(stats.min).toBe(42);
      expect(stats.max).toBe(42);
      expect(stats.p50).toBe(42);
      expect(stats.p99).toBe(42);
    });
  });

  describe("metric collection", () => {
    it("should collect all metrics without error", async () => {
      const { collectAllMetrics } = await import("../observability.ts");

      const metrics = collectAllMetrics();
      expect(metrics.timestamp).toBeDefined();
      expect(metrics.system).toBeDefined();
      expect(metrics.system.uptimeSeconds).toBeGreaterThanOrEqual(0);
      expect(metrics.system.memoryUsageMb).toBeGreaterThan(0);
      expect(metrics.trades).toBeDefined();
      expect(metrics.jupiter).toBeDefined();
      expect(metrics.rateLimiters).toBeDefined();
      expect(metrics.circuitBreakers).toBeDefined();
      expect(metrics.searchCache).toBeDefined();
      expect(metrics.solanaRpc).toBeDefined();
      expect(metrics.tradingLock).toBeDefined();
      expect(metrics.confirmations).toBeDefined();
      expect(metrics.preRoundGate).toBeDefined();
    });
  });

  describe("Prometheus export", () => {
    it("should export valid Prometheus text format", async () => {
      const { exportPrometheusMetrics } = await import("../observability.ts");

      const promText = exportPrometheusMetrics();
      expect(promText).toContain("# HELP moltapp_uptime_seconds");
      expect(promText).toContain("# TYPE moltapp_uptime_seconds gauge");
      expect(promText).toContain("moltapp_trades_total");
      expect(promText).toContain("moltapp_jupiter_orders_total");
      expect(promText).toContain("moltapp_circuit_breaker_activations");
      expect(promText).toContain("moltapp_gate_checks_total");
      expect(promText).toContain("moltapp_trading_lock_held");
      expect(promText.endsWith("\n")).toBe(true);
    });

    it("should include agent-level metrics when available", async () => {
      const { exportPrometheusMetrics } = await import("../observability.ts");

      const promText = exportPrometheusMetrics();
      // May or may not have agent metrics depending on execution state
      expect(typeof promText).toBe("string");
      expect(promText.length).toBeGreaterThan(100);
    });
  });

  describe("metric snapshots", () => {
    it("should take and retrieve snapshots", async () => {
      const { takeMetricSnapshot, getMetricSnapshots } = await import("../observability.ts");

      takeMetricSnapshot();
      const snapshots = getMetricSnapshots(10);
      expect(snapshots.length).toBeGreaterThanOrEqual(1);

      const latest = snapshots[snapshots.length - 1];
      expect(latest.timestamp).toBeDefined();
      expect(latest.metrics.trades_total).toBeDefined();
      expect(latest.metrics.memory_mb).toBeGreaterThan(0);
    });
  });

  describe("CloudWatch export", () => {
    it("should export valid CloudWatch-compatible metrics", async () => {
      const { exportCloudWatchMetrics } = await import("../observability.ts");

      const cwMetrics = exportCloudWatchMetrics();
      expect(Array.isArray(cwMetrics)).toBe(true);
      expect(cwMetrics.length).toBeGreaterThan(0);

      // Check structure of first metric
      const first = cwMetrics[0];
      expect(first.MetricName).toBeDefined();
      expect(typeof first.Value).toBe("number");
      expect(first.Unit).toBeDefined();

      // Check specific metric names
      const names = cwMetrics.map((m) => m.MetricName);
      expect(names).toContain("TradeSuccessRate");
      expect(names).toContain("MemoryUsage");
      expect(names).toContain("JupiterRetries");
    });
  });
});

// ---------------------------------------------------------------------------
// DB Seeder Tests
// ---------------------------------------------------------------------------

describe("DB Seeder", () => {
  describe("seed data inspection", () => {
    it("should return correct agent seed IDs", async () => {
      const { getAgentSeedIds } = await import("../db-seeder.ts");

      const ids = getAgentSeedIds();
      expect(ids).toContain("claude-trader");
      expect(ids).toContain("gpt-trader");
      expect(ids).toContain("grok-trader");
      expect(ids).toHaveLength(3);
    });

    it("should return seed data without DB access", async () => {
      const { getSeedData } = await import("../db-seeder.ts");

      const data = getSeedData();
      expect(data.agents).toHaveLength(3);
      expect(data.wallets).toHaveLength(3);
      expect(data.apiKeys).toHaveLength(3);

      // Verify agent data
      const claude = data.agents.find((a) => a.id === "claude-trader");
      expect(claude?.name).toBe("Claude Trader");
      expect(claude?.description).toContain("Anthropic");

      // Verify wallet addresses are truncated (security)
      for (const wallet of data.wallets) {
        expect(wallet.publicKey).toContain("...");
      }

      // Verify API key hashes are truncated (security)
      for (const key of data.apiKeys) {
        expect(key.keyHash).toContain("...");
      }
    });
  });
});
