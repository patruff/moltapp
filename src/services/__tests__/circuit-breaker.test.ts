/**
 * Circuit Breaker Tests
 *
 * Validates all 6 circuit breaker checks:
 * 1. Cooldown period enforcement
 * 2. Daily loss limit halts
 * 3. Daily trade count limits
 * 4. Max trade size clamping
 * 5. Position limit clamping/blocking
 * 6. Insufficient funds blocking
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  checkCircuitBreakers,
  configureCircuitBreaker,
  recordTradeExecution,
  resetAllState,
  getCircuitBreakerConfig,
  getCircuitBreakerStatus,
  getRecentActivations,
} from "../circuit-breaker.ts";
import type {
  TradingDecision,
  PortfolioContext,
} from "../../agents/base-agent.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDecision(
  overrides: Partial<TradingDecision> = {},
): TradingDecision {
  return {
    action: "buy",
    symbol: "AAPLx",
    quantity: 25,
    reasoning: "Test buy decision",
    confidence: 80,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makePortfolio(
  overrides: Partial<PortfolioContext> = {},
): PortfolioContext {
  return {
    cashBalance: 5000,
    positions: [],
    totalValue: 10000,
    totalPnl: 0,
    totalPnlPercent: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Circuit Breaker", () => {
  beforeEach(() => {
    resetAllState();
    configureCircuitBreaker({
      maxTradeUsdc: 50,
      dailyLossLimitPercent: 10,
      cooldownSeconds: 600,
      positionLimitPercent: 25,
      maxDailyTrades: 20,
    });
  });

  describe("Configuration", () => {
    it("should return default config", () => {
      const config = getCircuitBreakerConfig();
      expect(config.maxTradeUsdc).toBe(50);
      expect(config.dailyLossLimitPercent).toBe(10);
      expect(config.cooldownSeconds).toBe(600);
      expect(config.positionLimitPercent).toBe(25);
      expect(config.maxDailyTrades).toBe(20);
    });

    it("should accept partial config updates", () => {
      configureCircuitBreaker({ maxTradeUsdc: 100 });
      const config = getCircuitBreakerConfig();
      expect(config.maxTradeUsdc).toBe(100);
      expect(config.cooldownSeconds).toBe(600); // unchanged
    });
  });

  describe("Hold decisions", () => {
    it("should always allow hold decisions", () => {
      const decision = makeDecision({ action: "hold", quantity: 0 });
      const portfolio = makePortfolio();
      const result = checkCircuitBreakers("agent-1", decision, portfolio);
      expect(result.allowed).toBe(true);
      expect(result.activations).toHaveLength(0);
    });
  });

  describe("Cooldown Period", () => {
    it("should block trades within cooldown period", () => {
      const decision = makeDecision();
      const portfolio = makePortfolio();

      // First trade passes
      const result1 = checkCircuitBreakers("agent-1", decision, portfolio);
      expect(result1.allowed).toBe(true);
      recordTradeExecution("agent-1");

      // Immediate second trade should be blocked
      const result2 = checkCircuitBreakers("agent-1", decision, portfolio);
      expect(result2.allowed).toBe(false);
      expect(result2.activations).toHaveLength(1);
      expect(result2.activations[0].breaker).toBe("COOLDOWN_PERIOD");
      expect(result2.activations[0].action).toBe("blocked");
    });

    it("should allow first trade with no prior history", () => {
      const decision = makeDecision();
      const portfolio = makePortfolio();
      const result = checkCircuitBreakers("agent-new", decision, portfolio);
      expect(result.allowed).toBe(true);
    });
  });

  describe("Daily Loss Limit", () => {
    it("should block trades when daily loss exceeds limit", () => {
      const decision = makeDecision();

      // First call sets dailyStartValue to portfolio.totalValue
      const portfolio1 = makePortfolio({ totalValue: 10000 });
      checkCircuitBreakers("agent-loss", decision, portfolio1);

      // Second call with big loss (total value dropped 15%)
      const portfolio2 = makePortfolio({ totalValue: 8500 });
      const result = checkCircuitBreakers("agent-loss", decision, portfolio2);
      expect(result.allowed).toBe(false);
      expect(result.activations[0].breaker).toBe("DAILY_LOSS_LIMIT");
    });

    it("should allow trades when loss is within limit", () => {
      const decision = makeDecision();
      const portfolio1 = makePortfolio({ totalValue: 10000 });
      checkCircuitBreakers("agent-ok", decision, portfolio1);

      const portfolio2 = makePortfolio({ totalValue: 9500 }); // 5% loss
      const result = checkCircuitBreakers("agent-ok", decision, portfolio2);
      expect(result.allowed).toBe(true);
    });
  });

  describe("Daily Trade Count", () => {
    it("should block trades when daily count exceeded", () => {
      configureCircuitBreaker({ maxDailyTrades: 2, cooldownSeconds: 0 });
      const decision = makeDecision();
      const portfolio = makePortfolio();

      // Record 2 trades
      checkCircuitBreakers("agent-freq", decision, portfolio);
      recordTradeExecution("agent-freq");
      checkCircuitBreakers("agent-freq", decision, portfolio);
      recordTradeExecution("agent-freq");

      // Third trade should be blocked
      const result = checkCircuitBreakers("agent-freq", decision, portfolio);
      expect(result.allowed).toBe(false);
      expect(result.activations[0].breaker).toBe("MAX_DAILY_TRADES");
    });
  });

  describe("Max Trade Size", () => {
    it("should clamp buy orders exceeding max trade size", () => {
      configureCircuitBreaker({ maxTradeUsdc: 50 });
      const decision = makeDecision({ quantity: 100 });
      const portfolio = makePortfolio();

      const result = checkCircuitBreakers("agent-big", decision, portfolio);
      expect(result.allowed).toBe(true);
      expect(result.decision.quantity).toBe(50);
      expect(result.activations).toHaveLength(1);
      expect(result.activations[0].breaker).toBe("MAX_TRADE_SIZE");
      expect(result.activations[0].action).toBe("clamped");
    });

    it("should pass buy orders within max trade size", () => {
      const decision = makeDecision({ quantity: 30 });
      const portfolio = makePortfolio();
      const result = checkCircuitBreakers("agent-small", decision, portfolio);
      expect(result.allowed).toBe(true);
      expect(result.decision.quantity).toBe(30);
      expect(result.activations).toHaveLength(0);
    });

    it("should not apply max trade size to sell orders", () => {
      const decision = makeDecision({
        action: "sell",
        symbol: "AAPLx",
        quantity: 100,
      });
      const portfolio = makePortfolio({
        positions: [
          {
            symbol: "AAPLx",
            quantity: 200,
            averageCostBasis: 178,
            currentPrice: 180,
            unrealizedPnl: 400,
            unrealizedPnlPercent: 1.1,
          },
        ],
      });
      const result = checkCircuitBreakers("agent-sell", decision, portfolio);
      expect(result.decision.quantity).toBe(100);
    });
  });

  describe("Position Limit", () => {
    it("should clamp buy when position would exceed limit", () => {
      configureCircuitBreaker({ positionLimitPercent: 25, maxTradeUsdc: 5000 });
      const decision = makeDecision({ quantity: 2000, symbol: "NVDAx" });
      const portfolio = makePortfolio({
        totalValue: 10000,
        cashBalance: 5000,
        positions: [
          {
            symbol: "NVDAx",
            quantity: 1,
            averageCostBasis: 890,
            currentPrice: 890,
            unrealizedPnl: 0,
            unrealizedPnlPercent: 0,
          },
        ],
      });
      const result = checkCircuitBreakers("agent-pos", decision, portfolio);
      // Existing position: 1 * 890 = $890. Max 25% of $10k = $2500. Max additional = $2500 - $890 = $1610
      expect(result.decision.quantity).toBeLessThanOrEqual(1610);
      expect(result.activations.some((a) => a.breaker === "POSITION_LIMIT")).toBe(true);
    });

    it("should block buy when already at position limit", () => {
      configureCircuitBreaker({ positionLimitPercent: 25, maxTradeUsdc: 5000 });
      const decision = makeDecision({ quantity: 100, symbol: "TSLAx" });
      const portfolio = makePortfolio({
        totalValue: 10000,
        cashBalance: 5000,
        positions: [
          {
            symbol: "TSLAx",
            quantity: 12,
            averageCostBasis: 245,
            currentPrice: 250,
            unrealizedPnl: 60,
            unrealizedPnlPercent: 2.0,
          },
        ],
      });
      // Existing position: 12 * 250 = $3000 = 30%, already over 25%
      const result = checkCircuitBreakers("agent-over", decision, portfolio);
      expect(result.allowed).toBe(false);
      expect(result.activations[0].breaker).toBe("POSITION_LIMIT");
      expect(result.activations[0].action).toBe("blocked");
    });
  });

  describe("Insufficient Funds", () => {
    it("should block buy when cash is nearly zero", () => {
      const decision = makeDecision({ quantity: 10 });
      const portfolio = makePortfolio({ cashBalance: 0.5, totalValue: 10000 });
      const result = checkCircuitBreakers("agent-broke", decision, portfolio);
      expect(result.allowed).toBe(false);
      expect(result.activations.some((a) => a.breaker === "INSUFFICIENT_FUNDS")).toBe(true);
    });

    it("should clamp buy to available cash", () => {
      const decision = makeDecision({ quantity: 40 });
      const portfolio = makePortfolio({ cashBalance: 20, totalValue: 10000 });
      const result = checkCircuitBreakers("agent-low", decision, portfolio);
      expect(result.allowed).toBe(true);
      expect(result.decision.quantity).toBe(20);
      expect(result.activations.some((a) => a.breaker === "INSUFFICIENT_FUNDS")).toBe(true);
    });
  });

  describe("Status & Metrics", () => {
    it("should report clean status with no history", () => {
      const status = getCircuitBreakerStatus();
      expect(status.totalActivations).toBe(0);
      expect(status.recentActivations).toHaveLength(0);
      expect(Object.keys(status.agentStates)).toHaveLength(0);
    });

    it("should track activations in log", () => {
      const decision = makeDecision({ quantity: 100 });
      const portfolio = makePortfolio();
      checkCircuitBreakers("agent-log", decision, portfolio);

      const activations = getRecentActivations(10);
      expect(activations.length).toBeGreaterThan(0);
      expect(activations[0].breaker).toBe("MAX_TRADE_SIZE");
    });

    it("should track agent state after trade", () => {
      const decision = makeDecision();
      const portfolio = makePortfolio();
      checkCircuitBreakers("agent-tracked", decision, portfolio);
      recordTradeExecution("agent-tracked");

      const status = getCircuitBreakerStatus();
      expect(status.agentStates["agent-tracked"]).toBeDefined();
      expect(status.agentStates["agent-tracked"].tradesToday).toBe(1);
      expect(status.agentStates["agent-tracked"].lastTradeTime).not.toBeNull();
    });
  });
});
