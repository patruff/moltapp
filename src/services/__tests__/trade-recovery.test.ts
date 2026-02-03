/**
 * Trade Recovery Service Tests
 *
 * Validates the trade recovery system:
 * - Failed trade registration
 * - Retry tracking and policy
 * - Dead letter queue
 * - Stuck trade detection
 * - Recovery reports
 * - Manual resolution
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  registerFailedTrade,
  recordRetryAttempt,
  markTradeStuck,
  resolveManually,
  getPendingRetries,
  getDeadLetterQueue,
  getStuckTrades,
  getFailedTrade,
  getAgentFailedTrades,
  getRecoveryReport,
  setRetryPolicy,
  getRetryPolicy,
  clearRecoveryState,
} from "../trade-recovery.ts";

describe("Trade Recovery Service", () => {
  beforeEach(() => {
    clearRecoveryState();
    setRetryPolicy({
      maxAttempts: 3,
      initialDelayMs: 100, // Short delays for tests
      backoffMultiplier: 2,
      maxDelayMs: 1000,
      jitter: false,
    });
  });

  describe("registerFailedTrade", () => {
    it("should register a retryable trade failure", () => {
      const trade = registerFailedTrade({
        agentId: "claude-trader",
        side: "buy",
        symbol: "AAPLx",
        quantity: "25",
        error: "Jupiter API timeout",
        errorCode: "jupiter_order_failed",
      });

      expect(trade.recoveryId).toMatch(/^rcv_/);
      expect(trade.status).toBe("pending");
      expect(trade.maxAttempts).toBe(3);
      expect(trade.nextRetryAt).not.toBeNull();
    });

    it("should dead-letter non-retryable errors immediately", () => {
      const trade = registerFailedTrade({
        agentId: "gpt-trader",
        side: "buy",
        symbol: "NVDAx",
        quantity: "50",
        error: "Not enough USDC",
        errorCode: "insufficient_usdc_balance",
      });

      expect(trade.status).toBe("dead_letter");
      expect(trade.maxAttempts).toBe(0);
      expect(trade.nextRetryAt).toBeNull();
    });

    it("should include round ID and metadata", () => {
      const trade = registerFailedTrade({
        agentId: "grok-trader",
        side: "sell",
        symbol: "TSLAx",
        quantity: "1.5",
        error: "Network timeout",
        errorCode: "network_error",
        roundId: "round_123",
        metadata: { attempt: 1 },
      });

      expect(trade.roundId).toBe("round_123");
      expect(trade.metadata).toEqual({ attempt: 1 });
    });
  });

  describe("recordRetryAttempt", () => {
    it("should mark trade as recovered on success", () => {
      const trade = registerFailedTrade({
        agentId: "claude-trader",
        side: "buy",
        symbol: "AAPLx",
        quantity: "25",
        error: "Timeout",
        errorCode: "rpc_timeout",
      });

      const updated = recordRetryAttempt(trade.recoveryId, true);
      expect(updated).not.toBeNull();
      expect(updated!.status).toBe("recovered");
      expect(updated!.attempts).toBe(2);
    });

    it("should schedule next retry on failure", () => {
      const trade = registerFailedTrade({
        agentId: "claude-trader",
        side: "buy",
        symbol: "AAPLx",
        quantity: "25",
        error: "Timeout",
        errorCode: "rpc_timeout",
      });

      const updated = recordRetryAttempt(trade.recoveryId, false);
      expect(updated!.status).toBe("pending");
      expect(updated!.nextRetryAt).not.toBeNull();
    });

    it("should dead-letter after max retries", () => {
      setRetryPolicy({ maxAttempts: 2 });
      const trade = registerFailedTrade({
        agentId: "claude-trader",
        side: "buy",
        symbol: "AAPLx",
        quantity: "25",
        error: "Timeout",
        errorCode: "rpc_timeout",
      });

      // First retry (attempt 2 of 2)
      const updated = recordRetryAttempt(trade.recoveryId, false);
      expect(updated!.status).toBe("dead_letter");
      expect(updated!.nextRetryAt).toBeNull();
    });

    it("should return null for unknown recovery ID", () => {
      const result = recordRetryAttempt("rcv_nonexistent", true);
      expect(result).toBeNull();
    });
  });

  describe("markTradeStuck", () => {
    it("should mark a trade as stuck with tx signature", () => {
      const trade = registerFailedTrade({
        agentId: "gpt-trader",
        side: "sell",
        symbol: "NVDAx",
        quantity: "2",
        error: "Confirmation timeout",
        errorCode: "transaction_timeout",
      });

      const updated = markTradeStuck(
        trade.recoveryId,
        "5xKbMvp...txSig",
      );
      expect(updated!.status).toBe("stuck");
      expect(updated!.txSignature).toBe("5xKbMvp...txSig");
    });
  });

  describe("resolveManually", () => {
    it("should allow manual resolution to recovered", () => {
      const trade = registerFailedTrade({
        agentId: "grok-trader",
        side: "buy",
        symbol: "SPYx",
        quantity: "10",
        error: "Unknown error",
        errorCode: "unknown",
      });

      const updated = resolveManually(
        trade.recoveryId,
        "recovered",
        "Confirmed on-chain via Solscan",
      );
      expect(updated!.status).toBe("recovered");
    });

    it("should allow manual resolution to dead letter", () => {
      const trade = registerFailedTrade({
        agentId: "claude-trader",
        side: "sell",
        symbol: "GMEx",
        quantity: "100",
        error: "Permanent failure",
        errorCode: "unknown",
      });

      const updated = resolveManually(
        trade.recoveryId,
        "dead_letter",
        "Funds safe, position intact",
      );
      expect(updated!.status).toBe("dead_letter");
    });
  });

  describe("Query functions", () => {
    beforeEach(() => {
      // Register various failure types
      registerFailedTrade({
        agentId: "claude-trader",
        side: "buy",
        symbol: "AAPLx",
        quantity: "10",
        error: "Timeout",
        errorCode: "rpc_timeout",
      });
      registerFailedTrade({
        agentId: "gpt-trader",
        side: "sell",
        symbol: "NVDAx",
        quantity: "5",
        error: "No balance",
        errorCode: "insufficient_usdc_balance",
      });
      registerFailedTrade({
        agentId: "claude-trader",
        side: "buy",
        symbol: "TSLAx",
        quantity: "20",
        error: "Jupiter down",
        errorCode: "jupiter_order_failed",
      });
    });

    it("should return dead letter queue", () => {
      const dead = getDeadLetterQueue();
      expect(dead).toHaveLength(1);
      expect(dead[0].errorCode).toBe("insufficient_usdc_balance");
    });

    it("should return agent's failed trades", () => {
      const claudeTrades = getAgentFailedTrades("claude-trader");
      expect(claudeTrades).toHaveLength(2);
    });

    it("should get a specific trade by ID", () => {
      const all = getAgentFailedTrades("gpt-trader");
      const trade = getFailedTrade(all[0].recoveryId);
      expect(trade).not.toBeNull();
      expect(trade!.agentId).toBe("gpt-trader");
    });
  });

  describe("Recovery Report", () => {
    it("should generate comprehensive report", () => {
      registerFailedTrade({
        agentId: "claude-trader",
        side: "buy",
        symbol: "AAPLx",
        quantity: "10",
        error: "Timeout",
        errorCode: "rpc_timeout",
      });
      registerFailedTrade({
        agentId: "gpt-trader",
        side: "sell",
        symbol: "NVDAx",
        quantity: "5",
        error: "No balance",
        errorCode: "insufficient_usdc_balance",
      });

      const report = getRecoveryReport();
      expect(report.totalFailed).toBe(2);
      expect(report.pendingRetry).toBe(1);
      expect(report.deadLettered).toBe(1);
      expect(report.byErrorCode).toHaveProperty("rpc_timeout", 1);
      expect(report.byErrorCode).toHaveProperty("insufficient_usdc_balance", 1);
      expect(report.byAgent).toHaveProperty("claude-trader", 1);
      expect(report.byAgent).toHaveProperty("gpt-trader", 1);
      expect(report.recentActivity.length).toBeGreaterThan(0);
    });
  });

  describe("Retry Policy", () => {
    it("should allow updating retry policy", () => {
      setRetryPolicy({ maxAttempts: 5, initialDelayMs: 500 });
      const policy = getRetryPolicy();
      expect(policy.maxAttempts).toBe(5);
      expect(policy.initialDelayMs).toBe(500);
    });
  });
});
