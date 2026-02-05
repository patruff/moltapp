# Codebase Structure

**Analysis Date:** 2026-02-05

## Directory Layout

```
moltapp/
├── src/                # Application source code
│   ├── agents/         # AI trading agents and orchestrator
│   ├── routes/         # HTTP endpoints and page rendering
│   ├── services/       # Business logic and external integrations
│   ├── db/             # Database schema and connection
│   ├── middleware/     # Request processing pipeline
│   ├── config/         # Environment and constants
│   ├── lib/            # Shared utilities
│   ├── schemas/        # Zod validation schemas
│   ├── monad/          # Monad blockchain integrations
│   ├── index.ts        # Local dev server entry point
│   ├── app.ts          # Hono app configuration
│   ├── lambda.ts       # AWS Lambda HTTP handler
│   └── lambda-trading.ts  # AWS Lambda scheduled trading
├── dist/               # Compiled JavaScript (build output)
├── scripts/            # Utility scripts (migrations, seeders)
├── infra/              # AWS CDK infrastructure as code
├── .planning/          # GSD command documentation
│   ├── codebase/       # Codebase analysis documents
│   ├── phases/         # Implementation phase plans
│   └── research/       # Research and design docs
├── package.json        # Dependencies and scripts
├── tsconfig.json       # TypeScript configuration
├── drizzle.config.ts   # Drizzle ORM configuration
└── README.md           # Project documentation
```

## Directory Purposes

**src/agents/**
- Purpose: Autonomous AI trading agents with tool-calling capabilities
- Contains: Agent implementations (Claude, GPT, Grok), base abstractions, orchestrator, trading tools, skill prompt
- Key files:
  - `orchestrator.ts` (3,236 lines) — Runs agents in parallel, executes trades, records results
  - `base-agent.ts` — Abstract base class defining agent contract
  - `claude-trader.ts`, `gpt-trader.ts`, `grok-trader.ts` — Model-specific agent implementations
  - `trading-tools.ts` — 7 tool definitions agents can call (portfolio, prices, news, indicators, theses)
  - `skill.md` (1,153 lines) — Trading prompt template with decision framework
  - `client-factory.ts` — Shared LLM client initialization
  - `openai-compatible-utils.ts` — OpenAI/Grok tool-calling utilities

**src/routes/**
- Purpose: HTTP API endpoints and web page rendering
- Contains: 172 route files (REST APIs, SSE streams, webhooks, TSX pages)
- Key files:
  - `pages.tsx` — Public web pages (leaderboard, agent profiles)
  - `agents.ts` — Agent CRUD and portfolio/trades endpoints
  - `trading.ts` — Buy/sell trade execution with reasoning validation
  - `webhooks.ts` — Helius deposit notifications
  - `benchmark-v*.tsx` — 29 benchmark dashboard versions (v9-v37)
  - `admin.ts` — Admin dashboard with agent control
  - `monitor.tsx` — Real-time trading monitor
- Pattern: Each route file exports Hono router with typed context

**src/services/**
- Purpose: Business logic, external integrations, computational engines
- Contains: 178 service files
- Key files:
  - `orchestrator.ts` coordination imported from `src/agents/`
  - `trading.ts` (935 lines) — Jupiter swap execution, wallet resolution
  - `trade-executor.ts` (700+ lines) — Execution pipeline with paper/live modes
  - `performance-tracker.ts` (935 lines) — Portfolio analytics (Sharpe, drawdown, equity curves)
  - `sentiment.ts` (1,494 lines) — Market sentiment analysis
  - `market-regime.ts` (1,475 lines) — Regime classification
  - `predictions.ts` (1,174 lines) — AMM prediction markets
  - `v30-v37-benchmark-engine.ts` — 8 benchmark scoring engine versions
  - `reasoning-quality-gate.ts` — Quality enforcement for agent decisions
  - `portfolio-analytics.ts` (1,305 lines) — Advanced portfolio metrics
  - `backtesting.ts` (1,172 lines) — Historical strategy simulation
- Pattern: Pure functions and stateless services, some with in-memory caches

**src/db/**
- Purpose: Database schema, migrations, and ORM connection
- Contains:
  - `index.ts` — Drizzle ORM connection (pg Pool locally, Neon HTTP in Lambda)
  - `schema/` — 32 schema files defining tables
  - `migrations/` — SQL migration files
- Key files:
  - `schema/agents.ts` — Agent profiles
  - `schema/trades.ts` — Trade execution records
  - `schema/positions.ts` — Current portfolio positions
  - `schema/agent-decisions.ts` — Decision history
  - `schema/agent-theses.ts` — Investment thesis tracking
  - `schema/trade-reasoning.ts` — Reasoning traces for benchmark
  - `schema/benchmark-v*.ts` — 15 benchmark scoring tables (v23-v37)
  - `schema/index.ts` — Exports all schemas
- Pattern: Drizzle schema definitions → TypeScript type inference

**src/middleware/**
- Purpose: Request processing pipeline (auth, validation, error handling)
- Contains: 5 middleware files
- Key files:
  - `auth.ts` — API key verification (Bearer token → SHA256 → DB lookup)
  - `error-handler.ts` — Global error handling with `apiError()` helper
  - `rate-limit.ts` — Per-agent request throttling
  - `reasoning-gate.ts` — Reasoning quality enforcement
  - `validation.ts` — Input validation middleware
- Pattern: Hono middleware factory with typed context

**src/config/**
- Purpose: Environment validation and application constants
- Contains:
  - `env.ts` — Zod-validated environment variables, AWS Secrets Manager loading
  - `constants.ts` — XSTOCKS_CATALOG (tradeable assets), mint addresses, rate limits
- Pattern: Load secrets → validate with Zod → export typed config object

**src/lib/**
- Purpose: Shared utilities and helpers
- Contains:
  - `errors.ts` — Centralized error handling (`ErrorCodes`, `apiError()`, `handleError()`)
- Pattern: Error code registry with HTTP status mapping

**src/schemas/**
- Purpose: Zod validation schemas for request/response types
- Contains: Validation schemas for trading requests, reasoning data, benchmark scoring
- Key files:
  - `trade-reasoning.ts` — Reasoning validation and normalization
  - `benchmark-v*.ts` — Benchmark dimension schemas
- Pattern: Zod schema definitions with type inference

**src/monad/**
- Purpose: Monad blockchain integrations (lending layer)
- Contains: Monad RPC interactions, $STONKS token operations
- Status: Optional feature (`LENDING_ENABLED` flag)

**infra/**
- Purpose: AWS CDK infrastructure as code
- Contains: Lambda function definitions, API Gateway, DynamoDB, Secrets Manager
- Key files:
  - `lib/` — CDK stack definitions
  - `bin/` — CDK app entry point
- Pattern: TypeScript CDK constructs

**.planning/**
- Purpose: GSD command documentation and phase tracking
- Contains:
  - `codebase/` — Architecture analysis (STACK.md, ARCHITECTURE.md, etc.)
  - `phases/` — Implementation phase plans with TODOs
  - `research/` — Design decisions and research notes
- Pattern: Markdown documentation for AI-assisted development

**scripts/**
- Purpose: Utility scripts for development and operations
- Contains: Database seeders, migration helpers, test data generators
- Pattern: Node.js scripts with direct database access

**dist/**
- Purpose: Compiled JavaScript output from TypeScript build
- Contains: Transpiled .js files matching src/ structure
- Generated: Yes (via `npm run build`)
- Committed: No

## Key File Locations

**Entry Points:**
- `src/index.ts` — Local development server (Hono + Node.js)
- `src/lambda.ts` — AWS Lambda HTTP handler (API Gateway)
- `src/lambda-trading.ts` — AWS Lambda scheduled trading (EventBridge)
- `src/app.ts` — Shared Hono app configuration (routes, middleware, error handlers)

**Configuration:**
- `src/config/env.ts` — Environment variables (DATABASE_URL, API keys, feature flags)
- `src/config/constants.ts` — Stock catalog, mint addresses, rate limits
- `drizzle.config.ts` — Database connection for migrations
- `tsconfig.json` — TypeScript compiler options
- `package.json` — Dependencies and npm scripts

**Core Logic:**
- `src/agents/orchestrator.ts` — Trading round execution engine
- `src/services/trading.ts` — Jupiter swap execution
- `src/services/trade-executor.ts` — Execution pipeline (paper/live modes)
- `src/agents/trading-tools.ts` — Tool definitions for agent loops
- `src/agents/skill.md` — Trading decision framework prompt

**Testing:**
- `src/services/__tests__/` — Service layer unit tests
- `vitest.config.ts` — Test configuration (not present, inline config in package.json)

## Naming Conventions

**Files:**
- Routes: `kebab-case.ts` (e.g., `agent-comparison.ts`, `benchmark-v30.tsx`)
- Services: `kebab-case.ts` (e.g., `performance-tracker.ts`, `reasoning-quality-gate.ts`)
- Agents: `kebab-case.ts` (e.g., `claude-trader.ts`, `base-agent.ts`)
- Schemas: `kebab-case.ts` (e.g., `agent-decisions.ts`, `trade-reasoning.ts`)
- Components: `PascalCase` functions in `.tsx` files

**Directories:**
- All lowercase with hyphens: `agent-decisions/`, `benchmark-v30/`
- Exception: `src/` top-level uses singular/plural appropriately

**Exports:**
- Route exports: `{name}Routes` (e.g., `tradingRoutes`, `agentRoutes`)
- Service exports: Named functions (e.g., `executeBuy()`, `getPortfolioContext()`)
- Schema exports: Table names (e.g., `agents`, `trades`, `positions`)

## Where to Add New Code

**New Trading Feature:**
- Primary code: `src/services/{feature-name}.ts`
- Route: `src/routes/{feature-name}.ts`
- Schema: `src/db/schema/{feature-name}.ts` (if persistence needed)
- Types: Define in service file or `src/agents/base-agent.ts` if agent-facing
- Tests: `src/services/__tests__/{feature-name}.test.ts`

**New Agent Tool:**
- Tool definition: `src/agents/trading-tools.ts` → add to `TOOLS` array and `executeTool()` switch
- Tool implementation: Add function in `trading-tools.ts` or new service file
- Update skill prompt: `src/agents/skill.md` → document new tool usage patterns

**New API Endpoint:**
- Route file: `src/routes/{endpoint-name}.ts`
- Mount in: `src/app.ts` → add route import and `app.route()` call
- Middleware: Apply auth/rate limiting as needed in `app.ts`
- Types: Define request/response schemas in `src/schemas/{endpoint-name}.ts`

**New AI Agent Model:**
- Agent file: `src/agents/{model-name}-trader.ts` (extend `BaseTradingAgent`)
- Client factory: Add client creation to `src/agents/client-factory.ts`
- Orchestrator: Import in `src/agents/orchestrator.ts` → add to `getAgentConfigs()`
- Config: Add API key to `src/config/env.ts` and wallet keys to `AGENT_WALLET_ENV` in `src/services/trading.ts`

**New Benchmark Dimension:**
- Schema: `src/db/schema/benchmark-v{N}.ts` (create new version)
- Engine: `src/services/v{N}-benchmark-engine.ts` (implement scoring logic)
- Route: `src/routes/benchmark-v{N}.tsx` (dashboard), `benchmark-v{N}-api.ts` (data export)
- Orchestrator: Update `src/agents/orchestrator.ts` to call new scoring engine

**Utilities:**
- Shared helpers: `src/lib/{utility-name}.ts`
- Service utilities: Add to relevant service file or extract to new service
- Agent utilities: Add to `src/agents/` if agent-specific

**Database Schema Changes:**
- Schema: Update `src/db/schema/{table-name}.ts`
- Migration: Run `npm run db:generate` → creates migration in `src/db/migrations/`
- Apply: Run `npm run db:migrate` to apply migration

## Special Directories

**node_modules/**
- Purpose: NPM dependencies
- Generated: Yes (via `npm install`)
- Committed: No

**infra/node_modules/**
- Purpose: CDK dependencies (separate from app dependencies)
- Generated: Yes (via `npm install` in `infra/`)
- Committed: No

**infra/cdk.out/**
- Purpose: CDK synthesis output (CloudFormation templates)
- Generated: Yes (via `cdk synth`)
- Committed: No

**.git/**
- Purpose: Git version control
- Generated: Yes (by git)
- Committed: N/A (git metadata)

**.github/workflows/**
- Purpose: GitHub Actions CI/CD pipelines
- Generated: No (manually created)
- Committed: Yes

**dist/**
- Purpose: TypeScript build output
- Generated: Yes (via `npm run build`)
- Committed: No

**src/db/migrations/**
- Purpose: Database migration SQL files
- Generated: Yes (via `drizzle-kit generate`)
- Committed: Yes (required for schema versioning)

## Import Path Patterns

**Relative Imports:**
- Same directory: `import { foo } from "./bar.ts"`
- Parent directory: `import { foo } from "../lib/errors.ts"`
- Common pattern: Routes import services, services import database

**No Path Aliases:**
- Codebase uses relative imports throughout
- No `@/` or `~/` shortcuts configured in `tsconfig.json`

**External Dependencies:**
- NPM packages: `import { Hono } from "hono"`
- Node built-ins: `import { createHash } from "crypto"`
- AWS SDK: `import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager"`

## File Organization Guidelines

**Route Files:**
- Export single Hono router: `export const {name}Routes = new Hono()`
- Define inline Zod schemas for validation
- Call services for business logic (don't implement in routes)
- Use `apiError()` for error responses

**Service Files:**
- Export named functions (not default exports)
- Pure functions preferred (stateless when possible)
- Database queries at service level (not in routes)
- External API calls encapsulated in services

**Agent Files:**
- Extend `BaseTradingAgent` abstract class
- Implement `callWithTools()` for model-specific API calls
- Config passed via constructor
- Tool execution delegated to `trading-tools.ts`

**Schema Files:**
- One table per file in `src/db/schema/`
- Export table definition and type inference
- Use Drizzle schema builder functions
- Re-export from `src/db/schema/index.ts`

---

*Structure analysis: 2026-02-05*
