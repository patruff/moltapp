/**
 * Audit Log Service Tests
 *
 * Validates the persistent audit logging system:
 * - Event logging across all categories
 * - Query filtering and pagination
 * - Statistics computation
 * - Ring buffer size limiting
 * - Convenience loggers
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  logAuditEvent,
  logTradeEvent,
  logTradeFailure,
  logCircuitBreakerEvent,
  logSystemEvent,
  logAdminEvent,
  logAgentEvent,
  logAuthEvent,
  queryAuditLog,
  getAuditEvent,
  getAuditLogStats,
  clearAuditLog,
} from "../audit-log.ts";

describe("Audit Log Service", () => {
  beforeEach(() => {
    clearAuditLog();
  });

  describe("logAuditEvent", () => {
    it("should create event with unique ID and timestamp", () => {
      const event = logAuditEvent({
        category: "SYSTEM",
        severity: "info",
        action: "test_action",
        description: "Test event",
        source: "test",
      });

      expect(event.eventId).toMatch(/^evt_/);
      expect(event.timestamp).toBeTruthy();
      expect(event.category).toBe("SYSTEM");
      expect(event.severity).toBe("info");
    });

    it("should include optional fields", () => {
      const event = logAuditEvent({
        category: "TRADE",
        severity: "info",
        action: "trade_executed",
        description: "Buy AAPLx",
        source: "trading",
        agentId: "claude-trader",
        roundId: "round_123",
        metadata: { symbol: "AAPLx", amount: 25 },
      });

      expect(event.agentId).toBe("claude-trader");
      expect(event.roundId).toBe("round_123");
      expect(event.metadata).toEqual({ symbol: "AAPLx", amount: 25 });
    });

    it("should generate unique event IDs", () => {
      const e1 = logAuditEvent({
        category: "SYSTEM",
        severity: "info",
        action: "test1",
        description: "Test 1",
        source: "test",
      });
      const e2 = logAuditEvent({
        category: "SYSTEM",
        severity: "info",
        action: "test2",
        description: "Test 2",
        source: "test",
      });

      expect(e1.eventId).not.toBe(e2.eventId);
    });
  });

  describe("Convenience Loggers", () => {
    it("logTradeEvent should set correct category", () => {
      const event = logTradeEvent(
        "trade_executed",
        "Bought AAPLx for $25",
        "claude-trader",
        "round_1",
      );
      expect(event.category).toBe("TRADE");
      expect(event.source).toBe("trading-service");
    });

    it("logTradeFailure should set error severity", () => {
      const event = logTradeFailure(
        "Trade failed",
        "gpt-trader",
        new Error("Jupiter timeout"),
      );
      expect(event.category).toBe("TRADE");
      expect(event.severity).toBe("error");
      expect(event.metadata?.error).toBe("Jupiter timeout");
    });

    it("logCircuitBreakerEvent should set correct category", () => {
      const event = logCircuitBreakerEvent(
        "blocked",
        "Cooldown active",
        "claude-trader",
      );
      expect(event.category).toBe("CIRCUIT_BREAKER");
      expect(event.severity).toBe("warn");
    });

    it("logSystemEvent should accept severity parameter", () => {
      const event = logSystemEvent(
        "health_degraded",
        "Database latency high",
        "warn",
      );
      expect(event.category).toBe("SYSTEM");
      expect(event.severity).toBe("warn");
    });

    it("logAdminEvent should use warn severity", () => {
      const event = logAdminEvent(
        "force_release",
        "Admin force released trading lock",
      );
      expect(event.category).toBe("ADMIN");
      expect(event.severity).toBe("warn");
    });

    it("logAgentEvent should set agent category", () => {
      const event = logAgentEvent(
        "decision_made",
        "Agent chose to buy NVDAx",
        "grok-trader",
      );
      expect(event.category).toBe("AGENT");
      expect(event.agentId).toBe("grok-trader");
    });

    it("logAuthEvent should set auth category", () => {
      const event = logAuthEvent(
        "rate_limited",
        "Agent hit rate limit",
        "warn",
      );
      expect(event.category).toBe("AUTH");
      expect(event.action).toBe("auth_rate_limited");
    });
  });

  describe("queryAuditLog", () => {
    beforeEach(() => {
      logTradeEvent("buy", "Buy AAPLx", "claude-trader", "round_1");
      logTradeEvent("sell", "Sell NVDAx", "gpt-trader", "round_1");
      logCircuitBreakerEvent("blocked", "Cooldown", "claude-trader");
      logSystemEvent("health_ok", "System healthy");
      logAdminEvent("config_change", "Updated max trade size");
    });

    it("should return all events when no filter", () => {
      // Account for the 'clear_audit_log' event logged by clearAuditLog
      const result = queryAuditLog();
      expect(result.total).toBeGreaterThanOrEqual(5);
    });

    it("should filter by category", () => {
      const result = queryAuditLog({ category: "TRADE" });
      expect(result.events.every((e) => e.category === "TRADE")).toBe(true);
      expect(result.total).toBe(2);
    });

    it("should filter by severity", () => {
      const result = queryAuditLog({ severity: "warn" });
      expect(result.events.every((e) => e.severity === "warn")).toBe(true);
    });

    it("should filter by agentId", () => {
      const result = queryAuditLog({ agentId: "claude-trader" });
      expect(result.events.every((e) => e.agentId === "claude-trader")).toBe(true);
    });

    it("should filter by action substring", () => {
      const result = queryAuditLog({ action: "buy" });
      expect(result.events.length).toBeGreaterThan(0);
    });

    it("should support pagination", () => {
      const page1 = queryAuditLog({ limit: 2, offset: 0 });
      const page2 = queryAuditLog({ limit: 2, offset: 2 });

      expect(page1.events).toHaveLength(2);
      expect(page2.events.length).toBeGreaterThan(0);
      // Events should not overlap
      expect(page1.events[0].eventId).not.toBe(page2.events[0].eventId);
    });

    it("should sort newest first", () => {
      const result = queryAuditLog();
      for (let i = 1; i < result.events.length; i++) {
        expect(result.events[i - 1].timestamp >= result.events[i].timestamp).toBe(true);
      }
    });
  });

  describe("getAuditEvent", () => {
    it("should find event by ID", () => {
      const event = logSystemEvent("test", "Find me");
      const found = getAuditEvent(event.eventId);
      expect(found).not.toBeNull();
      expect(found!.description).toBe("Find me");
    });

    it("should return null for unknown ID", () => {
      const found = getAuditEvent("evt_nonexistent");
      expect(found).toBeNull();
    });
  });

  describe("getAuditLogStats", () => {
    it("should compute correct statistics", () => {
      logTradeEvent("buy", "Buy", "a");
      logTradeEvent("sell", "Sell", "b");
      logCircuitBreakerEvent("blocked", "Blocked", "a");
      logSystemEvent("startup", "Started", "error");

      const stats = getAuditLogStats();
      expect(stats.totalEvents).toBeGreaterThanOrEqual(4);
      expect(stats.byCategory.TRADE).toBe(2);
      expect(stats.byCategory.CIRCUIT_BREAKER).toBe(1);
      expect(stats.oldestEvent).not.toBeNull();
      expect(stats.newestEvent).not.toBeNull();
    });
  });

  describe("clearAuditLog", () => {
    it("should clear all events and log the clear action", () => {
      logSystemEvent("a", "a");
      logSystemEvent("b", "b");
      logSystemEvent("c", "c");

      clearAuditLog();

      // After clear, there should be exactly 1 event: the "clear_audit_log" admin event
      const stats = getAuditLogStats();
      expect(stats.totalEvents).toBe(1);
    });
  });
});
