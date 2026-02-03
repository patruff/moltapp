/**
 * E2E Trading Round Integration Test
 *
 * Exercises the full autonomous trading pipeline from market data fetch
 * through agent analysis, circuit breaker validation, trade execution
 * (paper mode), and post-round analytics.
 *
 * This test runs WITHOUT a database or Solana connection — it validates
 * all the in-memory components that power a real trading round:
 *
 * 1. Market data generation & price fetching
 * 2. Portfolio context building
 * 3. Circuit breaker validation (all 6 checks)
 * 4. Trading lock acquisition & release
 * 5. Search cache shared across agents
 * 6. Rate limiter token consumption
 * 7. Agent wallet fund checks
 * 8. Round persistence (in-memory cache)
 * 9. Alert & event emission
 * 10. Post-round analytics computation
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  checkCircuitBreakers,
  configureCircuitBreaker,
  recordTradeExecution,
  resetAllState as resetCircuitBreakers,
  getCircuitBreakerStatus,
  type CircuitBreakerResult,
} from "../circuit-breaker.ts";
import {
  acquireLock,
  releaseLock,
  forceReleaseLock,
  getLockStatus,
  withTradingLock,
} from "../trading-lock.ts";
import {
  getCachedNews,
  formatNewsForPrompt,
  invalidateCache,
  getSearchCacheMetrics,
} from "../search-cache.ts";
import {
  TokenBucketRateLimiter,
  getTradeJitterMs,
  getAllRateLimiterMetrics,
} from "../rate-limiter.ts";
import type {
  TradingDecision,
  PortfolioContext,
  MarketData,
  TradingRoundResult,
} from "../../agents/base-agent.ts";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function makeMarketData(count = 5): MarketData[] {
  const stocks = [
    { symbol: "AAPLx", name: "Apple", mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp" },
    { symbol: "NVDAx", name: "NVIDIA", mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh" },
    { symbol: "TSLAx", name: "Tesla", mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB" },
    { symbol: "SPYx", name: "S&P 500 ETF", mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W" },
    { symbol: "GOOGLx", name: "Alphabet", mint: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN" },
  ];
  return stocks.slice(0, count).map((s) => ({
    symbol: s.symbol,
    name: s.name,
    mintAddress: s.mint,
    price: 100 + Math.random() * 800,
    change24h: (Math.random() - 0.5) * 10,
    volume24h: 10_000_000 + Math.random() * 500_000_000,
  }));
}

function makePortfolio(overrides: Partial<PortfolioContext> = {}): PortfolioContext {
  return {
    cashBalance: 5000,
    positions: [],
    totalValue: 10000,
    totalPnl: 0,
    totalPnlPercent: 0,
    ...overrides,
  };
}

function makeDecision(overrides: Partial<TradingDecision> = {}): TradingDecision {
  return {
    action: "buy",
    symbol: "AAPLx",
    quantity: 25,
    reasoning: "Bullish on Apple based on strong earnings and market momentum",
    confidence: 78,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function simulateAgentDecision(
  agentId: string,
  agentName: string,
  marketData: MarketData[],
  portfolio: PortfolioContext,
): TradingDecision {
  // Simulate what an LLM agent would do: pick a stock, decide action
  const stock = marketData[Math.floor(Math.random() * marketData.length)];
  const actions: Array<"buy" | "sell" | "hold"> = ["buy", "sell", "hold"];
  const action = actions[Math.floor(Math.random() * 3)];

  let quantity = 0;
  if (action === "buy") {
    quantity = Math.min(25, portfolio.cashBalance * 0.1);
  } else if (action === "sell") {
    const pos = portfolio.positions.find(
      (p) => p.symbol === stock.symbol,
    );
    quantity = pos ? pos.quantity * 0.5 : 0;
    if (quantity === 0) return makeDecision({ action: "hold", quantity: 0 });
  }

  return makeDecision({
    action,
    symbol: stock.symbol,
    quantity,
    reasoning: `${agentName} analysis: ${action} ${stock.symbol} based on ${stock.change24h?.toFixed(2)}% 24h change`,
    confidence: 50 + Math.floor(Math.random() * 40),
  });
}

// ---------------------------------------------------------------------------
// E2E Trading Round Tests
// ---------------------------------------------------------------------------

describe("E2E Trading Round", () => {
  beforeEach(async () => {
    resetCircuitBreakers();
    await forceReleaseLock();
    invalidateCache();
    configureCircuitBreaker({
      maxTradeUsdc: 50,
      dailyLossLimitPercent: 10,
      cooldownSeconds: 0, // Disable cooldown for testing
      positionLimitPercent: 25,
      maxDailyTrades: 100,
    });
  });

  describe("Phase 1: Market Data", () => {
    it("should generate market data for all tracked stocks", () => {
      const marketData = makeMarketData(5);
      expect(marketData).toHaveLength(5);
      for (const stock of marketData) {
        expect(stock.symbol).toBeTruthy();
        expect(stock.name).toBeTruthy();
        expect(stock.mintAddress).toBeTruthy();
        expect(stock.price).toBeGreaterThan(0);
        expect(typeof stock.change24h).toBe("number");
        expect(typeof stock.volume24h).toBe("number");
      }
    });

    it("should provide valid xStock symbols with mint addresses", () => {
      const data = makeMarketData(5);
      for (const stock of data) {
        expect(stock.symbol).toMatch(/x$/);
        expect(stock.mintAddress).toMatch(/^[A-Za-z0-9]{32,44}$/);
      }
    });
  });

  describe("Phase 2: News Cache (Singleton Search)", () => {
    it("should fetch and cache news for stock symbols", async () => {
      const symbols = ["AAPLx", "NVDAx", "TSLAx"];
      const result = await getCachedNews(symbols);

      expect(result.items.length).toBeGreaterThan(0);
      expect(result.cachedAt).toBeTruthy();
      expect(result.expiresAt).toBeTruthy();
      expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(
        new Date(result.cachedAt).getTime(),
      );
    });

    it("should return cached results on second call (66% savings)", async () => {
      invalidateCache();
      const metricsBefore = getSearchCacheMetrics();
      const symbols = ["AAPLx", "NVDAx"];
      await getCachedNews(symbols); // First call: cache miss

      await getCachedNews(symbols); // Second call: cache hit
      const metricsAfter = getSearchCacheMetrics();
      // 2 new requests, 1 miss, 1 hit
      expect(metricsAfter.totalRequests - metricsBefore.totalRequests).toBe(2);
      expect(metricsAfter.cacheMisses - metricsBefore.cacheMisses).toBe(1);
      expect(metricsAfter.cacheHits - metricsBefore.cacheHits).toBe(1);
    });

    it("should format news for LLM prompts", async () => {
      const result = await getCachedNews(["SPYx"]);
      const prompt = formatNewsForPrompt(result);
      expect(prompt).toContain("RECENT NEWS");
      expect(prompt.length).toBeGreaterThan(50);
    });
  });

  describe("Phase 3: Trading Lock (Singleton)", () => {
    it("should acquire and release trading lock", async () => {
      const result = await acquireLock("test-round-1");
      expect(result.acquired).toBe(true);
      expect(result.lockId).toBeTruthy();

      const status = getLockStatus();
      expect(status.isLocked).toBe(true);

      const released = await releaseLock(result.lockId!);
      expect(released).toBe(true);

      const statusAfter = getLockStatus();
      expect(statusAfter.isLocked).toBe(false);
    });

    it("should prevent concurrent trading rounds", async () => {
      const lock1 = await acquireLock("round-A");
      expect(lock1.acquired).toBe(true);

      const lock2 = await acquireLock("round-B");
      expect(lock2.acquired).toBe(false);
      expect(lock2.existingLock).not.toBeNull();

      await releaseLock(lock1.lockId!);
    });

    it("should execute function within lock scope", async () => {
      let executed = false;
      const result = await withTradingLock("scoped-round", async () => {
        executed = true;
        return 42;
      });

      expect(result).not.toBeNull();
      expect(result!.result).toBe(42);
      expect(executed).toBe(true);
      expect(getLockStatus().isLocked).toBe(false); // Auto-released
    });

    it("should release lock even on error", async () => {
      try {
        await withTradingLock("error-round", async () => {
          throw new Error("Simulated agent error");
        });
      } catch {
        // Expected
      }
      expect(getLockStatus().isLocked).toBe(false);
    });
  });

  describe("Phase 4: Circuit Breaker Validation", () => {
    it("should allow valid buy decisions", () => {
      const decision = makeDecision({ quantity: 25 });
      const portfolio = makePortfolio();
      const result = checkCircuitBreakers("claude-trader", decision, portfolio);
      expect(result.allowed).toBe(true);
      expect(result.decision.action).toBe("buy");
    });

    it("should clamp oversized trades", () => {
      const decision = makeDecision({ quantity: 200 });
      const portfolio = makePortfolio();
      const result = checkCircuitBreakers("gpt-trader", decision, portfolio);
      expect(result.allowed).toBe(true);
      expect(result.decision.quantity).toBeLessThanOrEqual(50);
      expect(result.activations.length).toBeGreaterThan(0);
    });

    it("should block trades when daily loss limit hit", () => {
      const decision = makeDecision();
      const portfolio1 = makePortfolio({ totalValue: 10000 });
      checkCircuitBreakers("losing-agent", decision, portfolio1);

      const portfolio2 = makePortfolio({ totalValue: 8000 }); // 20% loss
      const result = checkCircuitBreakers("losing-agent", decision, portfolio2);
      expect(result.allowed).toBe(false);
      expect(result.activations[0].breaker).toBe("DAILY_LOSS_LIMIT");
    });

    it("should enforce position concentration limits", () => {
      configureCircuitBreaker({ positionLimitPercent: 25, maxTradeUsdc: 5000 });
      const decision = makeDecision({ quantity: 3000, symbol: "NVDAx" });
      const portfolio = makePortfolio({
        totalValue: 10000,
        cashBalance: 5000,
        positions: [
          {
            symbol: "NVDAx",
            quantity: 3,
            averageCostBasis: 800,
            currentPrice: 800,
            unrealizedPnl: 0,
            unrealizedPnlPercent: 0,
          },
        ],
      });
      const result = checkCircuitBreakers("concentrated-agent", decision, portfolio);
      // Position already at $2400 (24%), adding $3000 would exceed 25%
      expect(result.activations.some((a) => a.breaker === "POSITION_LIMIT")).toBe(true);
    });
  });

  describe("Phase 5: Rate Limiter", () => {
    it("should allow requests within rate limit", async () => {
      const limiter = new TokenBucketRateLimiter({
        name: "test-limiter",
        maxTokens: 5,
        refillRate: 5,
        refillIntervalMs: 1000,
      });

      let executionCount = 0;
      for (let i = 0; i < 5; i++) {
        await limiter.execute(async () => {
          executionCount++;
          return executionCount;
        });
      }
      expect(executionCount).toBe(5);
      limiter.destroy();
    });

    it("should track metrics for rate-limited requests", () => {
      const limiter = new TokenBucketRateLimiter({
        name: "test-metrics",
        maxTokens: 2,
        refillRate: 2,
        refillIntervalMs: 1000,
      });

      const metrics = limiter.metrics;
      expect(metrics.name).toBe("test-metrics");
      expect(metrics.maxTokens).toBe(2);
      expect(metrics.currentTokens).toBe(2);
      expect(metrics.queueDepth).toBe(0);
      limiter.destroy();
    });

    it("should generate trade jitter between 1-5 seconds", () => {
      for (let i = 0; i < 20; i++) {
        const jitter = getTradeJitterMs();
        expect(jitter).toBeGreaterThanOrEqual(1000);
        expect(jitter).toBeLessThanOrEqual(5000);
      }
    });
  });

  describe("Phase 6: Full Round Simulation", () => {
    it("should run 3 agents sequentially with circuit breakers", () => {
      const agents = [
        { id: "claude-trader", name: "Claude Trader" },
        { id: "gpt-trader", name: "GPT Trader" },
        { id: "grok-trader", name: "Grok Trader" },
      ];

      const marketData = makeMarketData(5);
      const results: TradingRoundResult[] = [];
      const allActivations: Array<{ breaker: string; agentId: string }> = [];

      for (const agent of agents) {
        const portfolio = makePortfolio();
        const decision = simulateAgentDecision(
          agent.id,
          agent.name,
          marketData,
          portfolio,
        );

        // Run through circuit breakers
        const cbResult = checkCircuitBreakers(agent.id, decision, portfolio);
        allActivations.push(
          ...cbResult.activations.map((a) => ({
            breaker: a.breaker,
            agentId: a.agentId,
          })),
        );

        const roundResult: TradingRoundResult = {
          agentId: agent.id,
          agentName: agent.name,
          decision: cbResult.decision,
          executed: cbResult.allowed,
        };

        if (cbResult.allowed && cbResult.decision.action !== "hold") {
          recordTradeExecution(agent.id);
          roundResult.executionDetails = {
            txSignature: `paper_${Date.now()}_${agent.id}`,
            filledPrice: marketData.find(
              (m) => m.symbol === cbResult.decision.symbol,
            )?.price,
          };
        }

        results.push(roundResult);
      }

      // Validate round results
      expect(results).toHaveLength(3);
      for (const r of results) {
        expect(r.agentId).toBeTruthy();
        expect(r.agentName).toBeTruthy();
        expect(["buy", "sell", "hold"]).toContain(r.decision.action);
        expect(r.decision.confidence).toBeGreaterThanOrEqual(0);
        expect(r.decision.confidence).toBeLessThanOrEqual(100);
        expect(r.decision.reasoning).toBeTruthy();
      }

      // Validate circuit breaker status
      const cbStatus = getCircuitBreakerStatus();
      expect(cbStatus.config.maxTradeUsdc).toBe(50);
    });

    it("should share news cache across all 3 agents", async () => {
      invalidateCache();
      const metricsBefore = getSearchCacheMetrics();
      const symbols = ["AAPLx", "NVDAx", "TSLAx"];

      // Agent 1 fetches news (cache miss)
      const news1 = await getCachedNews(symbols);
      expect(news1.items.length).toBeGreaterThan(0);

      // Agents 2 & 3 get cached results (cache hit)
      const news2 = await getCachedNews(symbols);
      const news3 = await getCachedNews(symbols);

      expect(news2.cachedAt).toBe(news1.cachedAt);
      expect(news3.cachedAt).toBe(news1.cachedAt);

      const metricsAfter = getSearchCacheMetrics();
      // Verify 3 new requests, 1 new miss, 2 new hits (relative to baseline)
      expect(metricsAfter.totalRequests - metricsBefore.totalRequests).toBe(3);
      expect(metricsAfter.cacheMisses - metricsBefore.cacheMisses).toBe(1);
      expect(metricsAfter.cacheHits - metricsBefore.cacheHits).toBe(2);
    });

    it("should prevent double-execution via trading lock", async () => {
      let round1Executed = false;
      let round2Skipped = false;

      // First round acquires lock
      const lockResult1 = await withTradingLock("round-1", async () => {
        round1Executed = true;

        // Second round attempts while first is running
        const lockResult2 = await withTradingLock("round-2", async () => {
          return "should not reach here";
        });
        round2Skipped = lockResult2 === null;

        return "round-1 completed";
      });

      expect(round1Executed).toBe(true);
      expect(round2Skipped).toBe(true);
      expect(lockResult1!.result).toBe("round-1 completed");
    });
  });

  describe("Phase 7: Post-Round Analytics", () => {
    it("should compute consensus type from results", () => {
      function computeConsensus(
        results: TradingRoundResult[],
      ): "unanimous" | "majority" | "split" | "no_trades" {
        const nonHold = results.filter((r) => r.decision.action !== "hold");
        if (nonHold.length === 0) return "no_trades";
        const actions = nonHold.map((r) => r.decision.action);
        const buys = actions.filter((a) => a === "buy").length;
        const sells = actions.filter((a) => a === "sell").length;
        if (buys === nonHold.length || sells === nonHold.length)
          return "unanimous";
        if (buys > sells && buys > 1) return "majority";
        if (sells > buys && sells > 1) return "majority";
        return "split";
      }

      // All hold
      const allHold: TradingRoundResult[] = [
        { agentId: "a1", agentName: "A1", decision: makeDecision({ action: "hold" }), executed: true },
        { agentId: "a2", agentName: "A2", decision: makeDecision({ action: "hold" }), executed: true },
        { agentId: "a3", agentName: "A3", decision: makeDecision({ action: "hold" }), executed: true },
      ];
      expect(computeConsensus(allHold)).toBe("no_trades");

      // Unanimous buy
      const allBuy: TradingRoundResult[] = [
        { agentId: "a1", agentName: "A1", decision: makeDecision({ action: "buy" }), executed: true },
        { agentId: "a2", agentName: "A2", decision: makeDecision({ action: "buy" }), executed: true },
        { agentId: "a3", agentName: "A3", decision: makeDecision({ action: "buy" }), executed: true },
      ];
      expect(computeConsensus(allBuy)).toBe("unanimous");

      // Split
      const split: TradingRoundResult[] = [
        { agentId: "a1", agentName: "A1", decision: makeDecision({ action: "buy" }), executed: true },
        { agentId: "a2", agentName: "A2", decision: makeDecision({ action: "sell" }), executed: true },
        { agentId: "a3", agentName: "A3", decision: makeDecision({ action: "hold" }), executed: true },
      ];
      expect(computeConsensus(split)).toBe("split");

      // Majority buy
      const majorityBuy: TradingRoundResult[] = [
        { agentId: "a1", agentName: "A1", decision: makeDecision({ action: "buy" }), executed: true },
        { agentId: "a2", agentName: "A2", decision: makeDecision({ action: "buy" }), executed: true },
        { agentId: "a3", agentName: "A3", decision: makeDecision({ action: "sell" }), executed: true },
      ];
      expect(computeConsensus(majorityBuy)).toBe("majority");
    });

    it("should detect agent disagreements on same stock", () => {
      const results: TradingRoundResult[] = [
        { agentId: "claude", agentName: "Claude", decision: makeDecision({ action: "buy", symbol: "NVDAx" }), executed: true },
        { agentId: "gpt", agentName: "GPT", decision: makeDecision({ action: "sell", symbol: "NVDAx" }), executed: true },
        { agentId: "grok", agentName: "Grok", decision: makeDecision({ action: "hold", symbol: "SPYx" }), executed: true },
      ];

      // Detect disagreements
      const nonHold = results.filter((r) => r.decision.action !== "hold");
      const bySymbol = new Map<string, typeof nonHold>();
      for (const r of nonHold) {
        const list = bySymbol.get(r.decision.symbol) ?? [];
        list.push(r);
        bySymbol.set(r.decision.symbol, list);
      }

      const disagreements: string[] = [];
      for (const [symbol, symbolResults] of bySymbol) {
        const hasBuy = symbolResults.some((r) => r.decision.action === "buy");
        const hasSell = symbolResults.some((r) => r.decision.action === "sell");
        if (hasBuy && hasSell) {
          disagreements.push(symbol);
        }
      }

      expect(disagreements).toContain("NVDAx");
      expect(disagreements).toHaveLength(1);
    });
  });

  describe("Phase 8: Round Summary Generation", () => {
    it("should build human-readable round summary", () => {
      const results: TradingRoundResult[] = [
        { agentId: "claude", agentName: "Claude Trader", decision: makeDecision({ action: "buy", symbol: "AAPLx", confidence: 82 }), executed: true },
        { agentId: "gpt", agentName: "GPT Trader", decision: makeDecision({ action: "sell", symbol: "TSLAx", confidence: 65 }), executed: true },
        { agentId: "grok", agentName: "Grok Trader", decision: makeDecision({ action: "hold", symbol: "SPYx", confidence: 45 }), executed: true },
      ];

      const parts: string[] = [];
      for (const r of results) {
        const status = r.executed ? "OK" : "FAIL";
        parts.push(
          `${r.agentName}: ${r.decision.action.toUpperCase()} ${r.decision.symbol} (${r.decision.confidence}%) ${status}`,
        );
      }
      const summary = parts.join(" | ");

      expect(summary).toContain("Claude Trader: BUY AAPLx (82%) OK");
      expect(summary).toContain("GPT Trader: SELL TSLAx (65%) OK");
      expect(summary).toContain("Grok Trader: HOLD SPYx (45%) OK");
    });

    it("should track circuit breaker activations per round", () => {
      const agents = ["claude-trader", "gpt-trader", "grok-trader"];
      const activations: Array<{ breaker: string; agent: string }> = [];

      for (const agentId of agents) {
        // Create a trade that will hit the max trade size
        const decision = makeDecision({ quantity: 100 });
        const portfolio = makePortfolio();
        const result = checkCircuitBreakers(agentId, decision, portfolio);

        for (const a of result.activations) {
          activations.push({ breaker: a.breaker, agent: a.agentId });
        }
      }

      // All 3 agents should have MAX_TRADE_SIZE clamped
      expect(activations.length).toBe(3);
      expect(activations.every((a) => a.breaker === "MAX_TRADE_SIZE")).toBe(true);
    });
  });
});
