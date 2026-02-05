# Testing Patterns

**Analysis Date:** 2026-02-05

## Test Framework

**Runner:**
- Vitest 3.2.4
- Config: No explicit config file (uses defaults)

**Assertion Library:**
- Vitest built-in assertions (Jest-compatible API)

**Run Commands:**
```bash
npm test              # Run all tests
vitest run           # Explicit run command
vitest watch         # Watch mode (not in package.json)
```

## Test File Organization

**Location:**
- Co-located with source: `src/services/__tests__/`
- Tests live next to the code they test
- **7 test files identified:**
  - `src/services/__tests__/audit-log.test.ts`
  - `src/services/__tests__/rate-limiter.test.ts`
  - `src/services/__tests__/circuit-breaker.test.ts`
  - `src/services/__tests__/trading-lock.test.ts`
  - `src/services/__tests__/trade-recovery.test.ts`
  - `src/services/__tests__/e2e-trading-round.test.ts`
  - `src/services/__tests__/jupiter-hardened.test.ts`

**Naming:**
- Pattern: `<service-name>.test.ts`
- Matches source file name exactly: `audit-log.ts` → `audit-log.test.ts`

**Structure:**
```
src/services/
├── audit-log.ts
├── rate-limiter.ts
├── circuit-breaker.ts
└── __tests__/
    ├── audit-log.test.ts
    ├── rate-limiter.test.ts
    └── circuit-breaker.test.ts
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { functionToTest } from "../service-name.ts";

describe("Service Name", () => {
  beforeEach(() => {
    // Reset state before each test
  });

  describe("Feature Group", () => {
    it("should do something specific", async () => {
      const result = await functionToTest();
      expect(result).toBe(expected);
    });

    it("should handle edge case", () => {
      expect(() => dangerousFunction()).toThrow("Expected error");
    });
  });
});
```

**Patterns:**
- Top-level `describe()` per module/service
- Nested `describe()` for feature groups
- `it()` for individual test cases
- Descriptive test names: "should [expected behavior]"
- Use `async` for tests involving async code

## Test Helpers

**Helper Functions:**
- Defined at top of test file after imports
- Named clearly: `makeConfig()`, `makeMarketData()`, `sleep()`
- Used to create test fixtures and reduce boilerplate

**Example from `rate-limiter.test.ts`:**
```typescript
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
```

**Example from `e2e-trading-round.test.ts`:**
```typescript
function makeMarketData(count = 5): MarketData[] {
  const stocks = [
    { symbol: "AAPLx", name: "Apple", mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp" },
    { symbol: "NVDAx", name: "NVIDIA", mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh" },
    // ...
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
```

## Setup and Teardown

**beforeEach:**
- Reset state before each test
- Clear caches, reset singletons
- Common pattern: reset all state, then configure for test

**Example:**
```typescript
beforeEach(async () => {
  resetCircuitBreakers();
  await forceReleaseLock();
  invalidateCache();
  configureCircuitBreaker({
    maxTradeUsdc: 50,
    dailyLossLimitPercent: 10,
    cooldownSeconds: 0, // Disable cooldown for testing
  });
});
```

**afterEach:**
- Cleanup resources (timers, connections)
- Used sparingly (most cleanup in `beforeEach`)

**Example:**
```typescript
afterEach(() => {
  limiter?.destroy(); // Clean up rate limiter timers
});
```

## Mocking

**Framework:** No external mocking library (uses Vitest built-in mocks if needed)

**Patterns:**
- **No database mocking** — tests use in-memory state
- **No API mocking** — tests validate logic without external calls
- Services designed with testable interfaces
- Dependency injection via function parameters

**What to Mock:**
- External APIs not mocked in current tests
- Tests focus on in-memory components

**What NOT to Mock:**
- Internal functions being tested
- Simple utility functions
- Database queries (tests designed to run without DB)

## Fixtures and Factories

**Test Data:**
```typescript
// Factory pattern for creating test objects
function makeDecision(overrides: Partial<TradingDecision> = {}): TradingDecision {
  return {
    action: "buy",
    symbol: "AAPLx",
    quantity: 25,
    reasoning: "Bullish on Apple based on strong earnings",
    confidence: 78,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
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
```

**Location:**
- Defined inline at top of test file
- No shared fixtures directory
- Factories use partial overrides pattern

## Coverage

**Requirements:** No coverage threshold enforced

**View Coverage:**
```bash
# Coverage command not configured in package.json
# Would typically be: vitest run --coverage
```

## Test Types

**Unit Tests:**
- Test individual functions in isolation
- Example: `audit-log.test.ts` tests event logging functions
- Example: `rate-limiter.test.ts` tests token bucket algorithm
- Focus: Single function/class behavior

**Integration Tests:**
- Test multiple components together
- Example: `e2e-trading-round.test.ts` tests full trading pipeline
- Focus: Component interactions without external dependencies

**E2E Tests:**
- Framework: Not detected (no Playwright/Cypress config)
- Current E2E test (`e2e-trading-round.test.ts`) is actually integration test
- Tests full pipeline: market data → circuit breakers → trading lock → rate limiter

## Common Patterns

**Async Testing:**
```typescript
it("should acquire and release trading lock", async () => {
  const result = await acquireLock("test-round-1");
  expect(result.acquired).toBe(true);
  expect(result.lockId).toBeTruthy();
});
```

**Error Testing:**
```typescript
it("should reject when queue is full", async () => {
  await expect(
    limiter.execute(async () => "rejected"),
  ).rejects.toThrow("Queue full");
});
```

**State Verification:**
```typescript
it("should track token count in metrics", async () => {
  limiter = new TokenBucketRateLimiter(makeConfig({ maxTokens: 3 }));
  expect(limiter.metrics.currentTokens).toBe(3);

  await limiter.execute(async () => "a");
  expect(limiter.metrics.currentTokens).toBe(2);
});
```

**Sequential Test Steps:**
```typescript
it("should run 3 agents sequentially with circuit breakers", () => {
  const agents = [
    { id: "claude-trader", name: "Claude Trader" },
    { id: "gpt-trader", name: "GPT Trader" },
    { id: "grok-trader", name: "Grok Trader" },
  ];

  const marketData = makeMarketData(5);
  const results: TradingRoundResult[] = [];

  for (const agent of agents) {
    const portfolio = makePortfolio();
    const decision = simulateAgentDecision(agent.id, agent.name, marketData, portfolio);
    const cbResult = checkCircuitBreakers(agent.id, decision, portfolio);
    results.push({ /* ... */ });
  }

  expect(results).toHaveLength(3);
  // Additional assertions...
});
```

**Parallel Operations:**
```typescript
it("should share news cache across all 3 agents", async () => {
  const symbols = ["AAPLx", "NVDAx", "TSLAx"];

  const news1 = await getCachedNews(symbols);
  const news2 = await getCachedNews(symbols);
  const news3 = await getCachedNews(symbols);

  expect(news2.cachedAt).toBe(news1.cachedAt);
  expect(news3.cachedAt).toBe(news1.cachedAt);
});
```

## Test Documentation

**File Headers:**
```typescript
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
```

**Test Categories:**
- Clearly labeled with nested `describe()` blocks
- Each test group has descriptive name
- Comments explain non-obvious test logic

## Assertions

**Common Matchers:**
- `toBe()` — strict equality for primitives
- `toEqual()` — deep equality for objects/arrays
- `toBeTruthy()` / `toBeFalsy()` — boolean coercion
- `toHaveLength()` — array/string length
- `toBeGreaterThan()` / `toBeLessThan()` — numeric comparison
- `toBeGreaterThanOrEqual()` / `toBeLessThanOrEqual()` — inclusive comparison
- `toContain()` — array/string contains value
- `toThrow()` — function throws error
- `rejects.toThrow()` — async function rejects with error
- `toMatch()` — regex match

**Property Checks:**
```typescript
expect(event).toHaveProperty("eventId");
expect(event.eventId).toMatch(/^evt_/);
```

**Numeric Ranges:**
```typescript
for (let i = 0; i < 100; i++) {
  const jitter = getTradeJitterMs();
  expect(jitter).toBeGreaterThanOrEqual(1000);
  expect(jitter).toBeLessThan(5000);
}
```

## Test Isolation

**Singleton Management:**
- Services use singleton pattern (trading lock, circuit breaker, search cache)
- Tests reset singletons in `beforeEach()`
- Explicit reset functions: `resetAllState()`, `clearAuditLog()`, `invalidateCache()`

**State Independence:**
- Each test can run in isolation
- No cross-test dependencies
- Parallel execution safe (default Vitest behavior)

## Test Output

**Console Logging:**
- Tests emit console output showing service behavior
- Useful for debugging failed tests
- Example: `[TradingLock] Lock acquired: lock_123`

**Log Levels:**
- stdout: info messages
- stderr: warning/error messages

## Performance Testing

**Timing Tests:**
```typescript
it("should generate trade jitter between 1-5 seconds", () => {
  for (let i = 0; i < 20; i++) {
    const jitter = getTradeJitterMs();
    expect(jitter).toBeGreaterThanOrEqual(1000);
    expect(jitter).toBeLessThanOrEqual(5000);
  }
});
```

**Randomness Verification:**
```typescript
it("should produce different values (not constant)", () => {
  const values = new Set<number>();
  for (let i = 0; i < 50; i++) {
    values.add(getTradeJitterMs());
  }
  expect(values.size).toBeGreaterThan(1);
});
```

## E2E Test Architecture

**Full Pipeline Test (`e2e-trading-round.test.ts`):**
1. Phase 1: Market Data — generate test market data
2. Phase 2: News Cache — validate singleton search cache
3. Phase 3: Trading Lock — prevent concurrent rounds
4. Phase 4: Circuit Breaker — validate all 6 safety checks
5. Phase 5: Rate Limiter — token bucket validation
6. Phase 6: Full Round — 3 agents sequential execution
7. Phase 7: Post-Round Analytics — consensus computation
8. Phase 8: Round Summary — human-readable output

**Design:**
- No external dependencies (DB, Solana, APIs)
- In-memory state only
- Validates core trading infrastructure
- 23 tests covering full autonomous pipeline

## Test Organization Best Practices

**Descriptive Names:**
- Test names complete sentences: "should acquire and release trading lock"
- Avoid vague names: "test lock" ❌ → "should prevent concurrent trading rounds" ✅

**Single Assertion Focus:**
- Each test verifies one behavior
- Multiple assertions OK if testing same concept
- Example: test both token count AND metrics update

**Edge Cases:**
- Test boundary conditions: empty arrays, zero values, max limits
- Test error paths: invalid input, missing resources
- Test concurrent operations: multiple agents, queue full

---

*Testing analysis: 2026-02-05*
