# Architecture

**Analysis Date:** 2026-02-05

## Pattern Overview

**Overall:** Multi-Agent AI Trading System with Tool-Calling Loop Architecture

**Key Characteristics:**
- Three autonomous AI agents (Claude Opus 4.5, GPT-5.2, Grok 4) operate independently via tool-calling loops
- Service-oriented architecture with clear separation between routes, services, agents, and database
- Dual deployment model: local development (Node.js) and serverless production (AWS Lambda)
- Event-driven execution pipeline with comprehensive observability and tracing
- Stateful agents maintain investment theses across trading rounds

## Layers

**Routes Layer:**
- Purpose: HTTP API endpoints and web page rendering
- Location: `src/routes/`
- Contains: 172 route files handling REST APIs, SSE streams, webhooks, and TSX page rendering
- Depends on: Services, middleware, database, schemas
- Used by: External clients (web, API consumers), Lambda handler
- Pattern: Hono framework with typed context, middleware chains (auth, rate limiting, validation)

**Middleware Layer:**
- Purpose: Cross-cutting request processing and security
- Location: `src/middleware/`
- Contains: `auth.ts` (API key verification), `error-handler.ts` (global error handling), `rate-limit.ts` (request throttling), `reasoning-gate.ts` (quality enforcement), `validation.ts` (input validation)
- Depends on: Database (API key lookup), lib/errors (standardized responses)
- Used by: All route handlers via Hono middleware chain

**Services Layer:**
- Purpose: Business logic, external integrations, and computational engines
- Location: `src/services/`
- Contains: 178 service files including trading execution, portfolio analytics, benchmark scoring, market data aggregation, AI agent coordination
- Depends on: Database, external APIs (Jupiter, Solana RPC, LLM providers), config
- Used by: Routes, agents, other services
- Pattern: Pure functions and stateless services, some maintain in-memory caches

**Agents Layer:**
- Purpose: Autonomous AI trading agents with tool-calling capabilities
- Location: `src/agents/`
- Contains: Agent implementations (`claude-trader.ts`, `gpt-trader.ts`, `grok-trader.ts`), base abstractions (`base-agent.ts`), tool definitions (`trading-tools.ts`), orchestrator (`orchestrator.ts`)
- Depends on: Services (trading, market data, theses), LLM SDKs (Anthropic, OpenAI), database
- Used by: Orchestrator (runs agents in parallel), trigger endpoints
- Pattern: Abstract base class with template method pattern, tool-calling loop via `runAgentLoop()`

**Database Layer:**
- Purpose: Persistent storage via PostgreSQL with Drizzle ORM
- Location: `src/db/`
- Contains: Schema definitions (`src/db/schema/`), database connection (`index.ts`), migrations
- Depends on: Config (DATABASE_URL), Drizzle ORM
- Used by: All services and routes requiring persistence
- Pattern: Drizzle schema → type inference → query builder, dual connection strategy (pg Pool locally, Neon HTTP in Lambda)

**Configuration Layer:**
- Purpose: Environment validation and secret management
- Location: `src/config/`
- Contains: `env.ts` (Zod-validated environment), `constants.ts` (static catalogs and addresses)
- Depends on: AWS Secrets Manager (Lambda only), process.env
- Used by: All layers requiring configuration
- Pattern: Load secrets from AWS → validate with Zod → typed config object

**Library Layer:**
- Purpose: Shared utilities and cross-cutting concerns
- Location: `src/lib/`
- Contains: `errors.ts` (standardized error handling and error codes)
- Depends on: Hono Context type
- Used by: All routes and middleware
- Pattern: Centralized error code registry with status mapping, `apiError()` helper

## Data Flow

**AI Trading Round Execution:**

1. **Trigger** — HTTP request to `/api/v1/trigger` or autonomous scheduler calls `runTradingRound()`
2. **Pre-Round Gate** — Validation checks (market hours, circuit breakers, trading lock status)
3. **Market Data Fetch** — Aggregate current prices for all stocks in XSTOCKS_CATALOG
4. **Parallel Agent Execution** — Run 3 agents simultaneously via `Promise.all()`
   - Each agent runs tool-calling loop: `runAgentLoop()` → LLM call → tool execution → repeat
   - Tools: `get_portfolio`, `get_stock_prices`, `search_news`, `get_technical_indicators`, `update_thesis`, `close_thesis`
   - Agent produces `TradingDecision` with reasoning, confidence, tool trace
5. **Reasoning Quality Gate** — Validate reasoning chains (coherence, depth, discipline)
6. **Trade Execution Pipeline** — `executePipeline()` processes all decisions
   - Mode check (paper vs live trading)
   - Buy/sell execution via `executeBuy()`/`executeSell()` → Jupiter swaps → Solana transactions
   - Record trade + position updates in database
7. **Post-Round Analytics** — Benchmark scoring, performance tracking, reasoning analysis
8. **Event Emission** — SSE streams, Discord webhooks, trade alerts
9. **Persistence** — Round data cached to DynamoDB, reasoning snapshots recorded

**State Management:**
- Database-backed state (positions, trades, decisions, theses)
- Agent theses persist across rounds in `agent_theses` table
- In-memory caches for market data, news search results (TTL-based)
- No frontend state management (server-rendered pages fetch fresh data)

**API Request Flow:**

1. **Request** → Routes layer receives HTTP request
2. **Middleware Chain** → Auth verification → Rate limiting → Validation
3. **Route Handler** → Calls service layer for business logic
4. **Service Execution** → Queries database, calls external APIs, performs computation
5. **Response** → Standardized JSON via `apiError()` or success response
6. **Error Handling** → Global error handler catches uncaught exceptions → `apiError()`

## Key Abstractions

**BaseTradingAgent:**
- Purpose: Abstract base class defining agent behavior contract
- Examples: `src/agents/claude-trader.ts`, `src/agents/gpt-trader.ts`, `src/agents/grok-trader.ts`
- Pattern: Template method pattern with `runAgentLoop()` orchestrating tool-calling, subclasses implement provider-specific `callWithTools()`

**TradingDecision:**
- Purpose: Structured output from agent reasoning process
- Examples: Used in `orchestrator.ts`, `trade-executor.ts`, `reasoning-quality-gate.ts`
- Pattern: Type-safe interface with action (buy/sell/hold), reasoning, confidence, tool trace

**ToolContext:**
- Purpose: Runtime context passed to tool executors providing data access
- Examples: `src/agents/trading-tools.ts` → `executeTool()`
- Pattern: Dependency injection of portfolio state and market data into tool functions

**PortfolioContext:**
- Purpose: Agent's current financial state (cash, positions, P&L)
- Examples: Built by `getPortfolioContext()` in `orchestrator.ts`, passed to agents
- Pattern: Immutable snapshot of portfolio state at round start

**ExecutionResult:**
- Purpose: Outcome record from trade execution attempt (success/failure/paper)
- Examples: Returned by `executeDecision()` in `trade-executor.ts`
- Pattern: Result type capturing execution metadata, errors, recovery IDs

**BenchmarkScore:**
- Purpose: Multi-dimensional evaluation of reasoning quality
- Examples: 34-dimension scoring in `v37-benchmark-engine.ts`
- Pattern: Composite scoring across financial, reasoning, epistemic, safety, predictive dimensions

## Entry Points

**Local Development Server:**
- Location: `src/index.ts`
- Triggers: `npm run dev` command
- Responsibilities: Start HTTP server on PORT, install signal handlers, register shutdown hooks
- Flow: `index.ts` → imports `app.ts` → passes to `@hono/node-server`

**AWS Lambda Handler:**
- Location: `src/lambda.ts`
- Triggers: API Gateway requests in production
- Responsibilities: Wrap Hono app with Lambda handler adapter
- Flow: `lambda.ts` → imports `app.ts` → exports `handle(app)` → AWS Lambda runtime invokes

**Lambda Trading Round Scheduler:**
- Location: `src/lambda-trading.ts`
- Triggers: EventBridge scheduled events (autonomous trading)
- Responsibilities: Execute trading round without HTTP context
- Flow: EventBridge → `lambda-trading.ts` → `runTradingRound()` → persists to DynamoDB

**Application Configuration:**
- Location: `src/app.ts`
- Triggers: Imported by both `index.ts` and `lambda.ts`
- Responsibilities: Define all route mounts, middleware chains, error handlers, initialize services
- Flow: Create Hono app → mount 172 routes → register global error handlers

## Error Handling

**Strategy:** Centralized error handling with typed error codes and HTTP status mapping

**Patterns:**
- **Middleware-level:** Global `onError()` handler in `app.ts` → `globalErrorHandler()` → `apiError()`
- **Route-level:** Try/catch → `handleError(err)` or direct `apiError(code, details)`
- **Service-level:** Throw structured errors with prefix format: `"error_code: details message"`
- **Validation:** Zod schema parsing → `parsed.error.flatten()` → `apiError("VALIDATION_FAILED", errors)`
- **Recovery:** Failed trades → dead-letter queue in `trade-recovery.ts` with retry logic

**Error Response Format:**
```json
{
  "error": "validation_failed",
  "code": "validation_failed",
  "details": { "field": ["error message"] }
}
```

**Error Codes Registry:**
- Location: `src/lib/errors.ts` → `ErrorCodes` object
- Maps error code to HTTP status (400, 401, 403, 404, 422, 429, 500, 502, 503)
- Examples: `VALIDATION_FAILED`, `INSUFFICIENT_BALANCE`, `QUALITY_GATE_REJECTED`, `JUPITER_ORDER_FAILED`

## Cross-Cutting Concerns

**Logging:**
- Console.log with structured prefixes (`[Orchestrator]`, `[Shutdown]`, `[Trade Executor]`)
- Trade audit log in `audit-log.ts` → persisted to database
- Observability metrics in `observability.ts` → latency tracking, health checks

**Validation:**
- Zod schemas for request bodies (`src/schemas/`)
- Route-level validation middleware (`src/middleware/validation.ts`)
- Reasoning quality gates (`reasoning-quality-gate.ts`, `adaptive-quality-gate.ts`)
- Input validation in tool executors (`trading-tools.ts`)

**Authentication:**
- API key authentication via `src/middleware/auth.ts`
- Bearer token → SHA256 hash → lookup in `api_keys` table
- Sets `agentId` in Hono context for downstream handlers
- Webhooks use separate secret header validation (not Bearer tokens)
- Admin routes use X-Admin-Password header

**Rate Limiting:**
- Per-agent rate limiting via `src/middleware/rate-limit.ts`
- Trade execution jitter to prevent burst load on Jupiter
- Circuit breakers for agent activity (`circuit-breaker.ts`)
- Moltbook DEX rate limiting (1 tx every 2 minutes)

**Observability:**
- Event stream via SSE (`event-stream.ts`)
- Discord webhook notifications (`discord-notifier.ts`)
- Benchmark data export to HuggingFace dataset
- Trading round persistence to DynamoDB for audit
- Tool trace capture for full reasoning transparency

**Testing:**
- Demo mode for paper trading (`DEMO_MODE` env flag)
- Trading mode toggle (live vs paper execution)
- Test fixtures in `src/services/__tests__/`
- Vitest test runner (`npm test`)

---

*Architecture analysis: 2026-02-05*
