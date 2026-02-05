# Coding Conventions

**Analysis Date:** 2026-02-05

## Naming Patterns

**Files:**
- kebab-case for all files: `agent-intelligence.ts`, `portfolio-analytics.ts`, `trading-lock.ts`
- Test files: `*.test.ts` pattern (e.g., `audit-log.test.ts`, `rate-limiter.test.ts`)
- Schema files: singular entity name (e.g., `agents.ts`, `trades.ts`, `positions.ts`)
- Route files: plural or descriptive (e.g., `agents.ts`, `copy-trading.ts`, `pages.tsx`)

**Functions:**
- camelCase for all functions: `getAgentStats()`, `executeTool()`, `processDeposit()`
- Async functions use `async` keyword, return `Promise<T>`
- Exported functions document purpose in JSDoc-style comments

**Variables:**
- camelCase for local variables: `agentId`, `totalValue`, `marketData`
- UPPER_SNAKE_CASE for constants: `USDC_MINT_MAINNET`, `MIN_SOL_FOR_FEES`, `TOKEN_PROGRAM_ADDRESS`
- Descriptive names over abbreviations: `configuration` not `cfg`, `response` not `resp`

**Types:**
- PascalCase for interfaces/types: `TradingDecision`, `PortfolioContext`, `AgentConfig`
- Suffix `Schema` for Zod schemas: `buyOrderSchema`, `paginationSchema`, `envSchema`
- Type aliases from schema inference: `type Trade = typeof trades.$inferSelect`
- Use `interface` for object shapes, `type` for unions/aliases

## Code Style

**Formatting:**
- No formatter config detected (Prettier/Biome not configured)
- 2-space indentation (inferred from existing code)
- 100-character line length soft limit
- Trailing commas in multi-line objects/arrays
- Double quotes for strings (except JSX attributes)

**Linting:**
- No ESLint config detected
- TypeScript strict mode enabled (`"strict": true` in tsconfig.json)
- Compiler options: `forceConsistentCasingInFileNames`, `skipLibCheck`

## Import Organization

**Order:**
1. External packages (`hono`, `zod`, `drizzle-orm`)
2. Internal shared modules (`../db/`, `../lib/`, `../config/`)
3. Internal feature modules (`../services/`, `../agents/`)
4. Relative imports (`./`)

**Path Aliases:**
- No path aliases configured
- All imports use relative paths: `../services/trading.ts`, `./base-agent.ts`
- Deep relative imports common: `../../agents/orchestrator.ts`

**Import Style:**
```typescript
import { Hono } from "hono";
import { z } from "zod";
import type { Context, Next } from "hono";
import { db } from "../db/index.ts";
import { agentDecisions } from "../db/schema/agent-decisions.ts";
import { eq, desc, sql } from "drizzle-orm";
```

## Error Handling

**Patterns:**
- Centralized error handling via `src/lib/errors.ts`
- Use `apiError(c, "ERROR_CODE", details)` helper for API responses
- Define error codes in `ErrorCodes` constant with status mapping
- Error response format: `{ error: string, code: string, details?: unknown }`
- Use `throwApiError()` to throw errors that will be caught by middleware

**Example:**
```typescript
import { apiError } from "../lib/errors.ts";

// In route handler
if (!config) {
  return apiError(c, "AGENT_NOT_FOUND", `No agent with ID "${agentId}"`);
}
```

**Error Categories:**
- 400: Validation failures (`VALIDATION_FAILED`, `INVALID_AMOUNT`)
- 401: Authentication failures (`INVALID_API_KEY`, `MISSING_API_KEY`)
- 404: Resource not found (`AGENT_NOT_FOUND`, `STOCK_NOT_FOUND`)
- 422: Business logic rejection (`QUALITY_GATE_REJECTED`)
- 429: Rate limiting (`RATE_LIMITED`)
- 500: Internal errors (`INTERNAL_ERROR`, `TRADE_EXECUTION_FAILED`)
- 502: External service failures (`JUPITER_ORDER_FAILED`)
- 503: Service unavailable (`MOLTBOOK_RATE_LIMITED`)

## Logging

**Framework:** Console-based (no structured logging library)

**Patterns:**
- Prefix log messages with service/component: `[TradingLock]`, `[CircuitBreaker]`
- Log levels implicit via console methods: `console.log()`, `console.warn()`, `console.error()`
- Structured audit logging via `src/services/audit-log.ts` service
- Use audit log for trade events, circuit breakers, admin actions

**Example:**
```typescript
console.log(`[TradingLock] Lock acquired: ${lockId} by "${roundId}"`);
logTradeEvent("trade_executed", "Bought AAPLx for $25", agentId, roundId);
```

## Comments

**When to Comment:**
- File-level JSDoc explaining module purpose (all route files, services)
- Complex business logic requiring context
- Non-obvious algorithm implementations
- TODOs with context (rare in codebase)
- **NOT** for self-explanatory code

**JSDoc/TSDoc:**
- Required for exported functions/interfaces
- Include parameter descriptions for non-obvious params
- Include return type descriptions
- Example blocks for complex APIs

**Example:**
```typescript
/**
 * Resolve an agent's wallet from environment variables.
 * Falls back to DB wallet lookup + Turnkey if env keys aren't set.
 */
async function resolveAgentWallet(agentId: string): Promise<ResolvedWallet>
```

## Function Design

**Size:**
- Keep functions focused on single responsibility
- Extract helpers for repeated logic
- Test helpers are small, composable functions
- Service functions range 20-100 lines typical

**Parameters:**
- Use object parameters for 3+ params or optional params
- Type parameters with interfaces, not inline objects
- Prefer readonly arrays for immutable data: `readonly string[]`

**Example:**
```typescript
interface DepositParams {
  txSignature: string;
  fromAddress: string;
  amount: string;
}

export async function processDeposit(params: DepositParams): Promise<void>
```

**Return Values:**
- Always specify return types explicitly
- Use `Promise<T>` for async functions
- Return structured objects, not tuples
- Use discriminated unions for result types: `{ ok: true, data: T } | { ok: false, error: string }`

## Module Design

**Exports:**
- Named exports preferred over default exports
- Export types alongside implementations
- Group related exports in barrel files (`src/db/schema/index.ts`)

**Example:**
```typescript
export interface TradingDecision { /* ... */ }
export class BaseTradingAgent { /* ... */ }
export { executeTool, type ToolContext };
```

**Barrel Files:**
- Used in `src/db/schema/index.ts` to re-export all schemas
- Used in `src/routes/` indirectly (imported in `app.ts`)
- Not overused — most imports are direct

## TypeScript Patterns

**Type Inference:**
- Drizzle schema inference: `typeof trades.$inferSelect`
- Zod schema inference: `z.infer<typeof schema>`
- Minimal `any` usage (actively being removed per memory)

**Type Assertions:**
- Prefer type guards over `as` assertions
- Use `as const` for literal types
- Type parameters in generic functions: `<T extends z.ZodTypeAny>`

**Utility Types:**
- `Partial<T>` for optional fields
- `Record<string, T>` for maps
- `InferSelectModel<T>` from Drizzle
- `Context` and `Next` from Hono

## Database Conventions

**Schema Definition:**
- Drizzle ORM with PostgreSQL
- Schema files in `src/db/schema/`
- Use `pgTable()` from `drizzle-orm/pg-core`
- Column naming: snake_case in DB, camelCase in TypeScript

**Query Patterns:**
```typescript
import { db } from "../db/index.ts";
import { trades, positions } from "../db/schema/index.ts";
import { eq, desc, and, gte } from "drizzle-orm";

const results = await db
  .select()
  .from(trades)
  .where(eq(trades.agentId, agentId))
  .orderBy(desc(trades.createdAt))
  .limit(20);
```

## API Route Conventions

**Route Structure:**
- Routes in `src/routes/` (one file per resource/feature)
- Use Hono router: `const router = new Hono()`
- Export named constant: `export const agentRoutes = new Hono()`
- Mount in `src/app.ts`

**Endpoint Patterns:**
```typescript
agentRoutes.get("/", async (c) => { /* list */ });
agentRoutes.get("/:id", async (c) => { /* detail */ });
agentRoutes.post("/", async (c) => { /* create */ });
```

**Validation:**
- Use `validateBody()` / `validateQuery()` middleware
- Define schemas with Zod
- Access validated data: `c.get("validatedBody")`

**Response Format:**
```typescript
return c.json({ agents, count, description });
return apiError(c, "ERROR_CODE", details);
```

## Testing Conventions

**Framework:** Vitest (see TESTING.md)

**Assertion Style:**
- `expect(value).toBe(expected)` for primitives
- `expect(value).toEqual(expected)` for objects
- `expect(array).toHaveLength(n)`
- `expect(value).toBeGreaterThan(n)`

## Constants and Configuration

**Location:**
- Environment variables: `src/config/env.ts`
- App constants: `src/config/constants.ts`
- Service-specific constants at top of file

**Pattern:**
```typescript
const MIN_SOL_FOR_FEES = 10_000_000n; // 0.01 SOL in lamports
const TOKEN_PROGRAM_ADDRESS = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
```

## Async/Await Conventions

**Always use async/await:**
- No raw promises or callbacks
- Error handling via try/catch in routes
- Use `Promise.all()` for parallel operations

**Example:**
```typescript
const [stats, portfolio] = await Promise.all([
  getAgentStats(agentId),
  getAgentPortfolio(agentId),
]);
```

---

*Convention analysis: 2026-02-05*
