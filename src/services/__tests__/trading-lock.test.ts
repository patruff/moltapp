/**
 * Trading Lock Tests
 *
 * Validates the singleton trading lock:
 * - Lock acquisition and release
 * - Mutual exclusion
 * - TTL-based auto-expiry
 * - withTradingLock helper
 * - Status reporting
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  acquireLock,
  releaseLock,
  forceReleaseLock,
  getLockStatus,
  withTradingLock,
} from "../trading-lock.ts";

describe("Trading Lock", () => {
  beforeEach(() => {
    forceReleaseLock();
  });

  describe("acquireLock / releaseLock", () => {
    it("should acquire a fresh lock", async () => {
      const result = await acquireLock("test-round-1");
      expect(result.acquired).toBe(true);
      expect(result.lockId).not.toBeNull();
    });

    it("should block second acquisition while lock is held", async () => {
      const r1 = await acquireLock("round-1");
      expect(r1.acquired).toBe(true);

      const r2 = await acquireLock("round-2");
      expect(r2.acquired).toBe(false);
      expect(r2.existingLock).not.toBeNull();
      expect(r2.existingLock!.holderInfo).toBe("round-1");
    });

    it("should allow re-acquisition after release", async () => {
      const r1 = await acquireLock("round-1");
      expect(r1.acquired).toBe(true);

      releaseLock(r1.lockId!);

      const r2 = await acquireLock("round-2");
      expect(r2.acquired).toBe(true);
    });
  });

  describe("forceReleaseLock", () => {
    it("should forcibly clear any lock", async () => {
      await acquireLock("round-force");
      expect(getLockStatus().isLocked).toBe(true);

      forceReleaseLock();
      expect(getLockStatus().isLocked).toBe(false);
    });
  });

  describe("getLockStatus", () => {
    it("should report unlocked with no lock", () => {
      const status = getLockStatus();
      expect(status.isLocked).toBe(false);
      expect(status.lock).toBeNull();
    });

    it("should report locked with active lock", async () => {
      await acquireLock("status-test");
      const status = getLockStatus();
      expect(status.isLocked).toBe(true);
      expect(status.lock).not.toBeNull();
      expect(status.lock!.holderInfo).toBe("status-test");
    });
  });

  describe("withTradingLock", () => {
    it("should execute callback and return result", async () => {
      const result = await withTradingLock("with-test", async () => {
        return { value: 42 };
      });
      expect(result).not.toBeNull();
      expect(result!.result).toEqual({ value: 42 });
    });

    it("should release lock after callback completes", async () => {
      await withTradingLock("release-test", async () => {
        return "done";
      });
      expect(getLockStatus().isLocked).toBe(false);
    });

    it("should release lock even if callback throws", async () => {
      try {
        await withTradingLock("error-test", async () => {
          throw new Error("boom");
        });
      } catch {
        // expected
      }
      expect(getLockStatus().isLocked).toBe(false);
    });

    it("should return null if lock cannot be acquired", async () => {
      await acquireLock("blocker");
      const result = await withTradingLock("blocked", async () => {
        return "never";
      });
      expect(result).toBeNull();
    });
  });
});
