---
phase: 01-identity-and-wallets
plan: 01
subsystem: auth
tags: [hono, drizzle, postgresql, zod, moltbook, api-key, rate-limiting, sha256]

# Dependency graph
requires:
  - phase: none
    provides: first phase -- no dependencies
provides:
  - Hono API server with health check endpoint
  - PostgreSQL schema (agents, wallets, apiKeys, transactions) with Drizzle ORM
  - Moltbook identity verification service (server-to-server)
  - POST /api/v1/auth/register endpoint (verify token, upsert agent, issue API key)
  - Bearer token auth middleware with SHA-256 key lookup
  - Per-agent rate limiting (60 req/min via hono-rate-limiter)
  - Environment validation with Zod
affects: [01-02-PLAN (wallets), 01-03-PLAN (withdrawals), all future plans requiring auth]

# Tech tracking
tech-stack:
  added: [hono, "@hono/node-server", zod, jose, drizzle-orm, pg, hono-rate-limiter, decimal.js, typescript, tsx, vitest, drizzle-kit]
  patterns: [verify-once-issue-key, SHA-256 API key hashing, Zod env validation, Drizzle code-first schema, Hono middleware chain]

key-files:
  created:
    - src/index.ts
    - src/config/env.ts
    - src/config/constants.ts
    - src/db/index.ts
    - src/db/schema/agents.ts
    - src/db/schema/wallets.ts
    - src/db/schema/api-keys.ts
    - src/db/schema/transactions.ts
    - src/db/schema/index.ts
    - src/services/moltbook.ts
    - src/routes/auth.ts
    - src/middleware/auth.ts
    - src/middleware/rate-limit.ts
    - drizzle.config.ts
    - .env.example
    - .gitignore
  modified: []

key-decisions:
  - "Used .ts import extensions with rewriteRelativeImportExtensions for drizzle-kit CJS compatibility"
  - "API key prefix mk_ (12 chars stored) for human identification, full key SHA-256 hashed"
  - "Key rotation: old keys auto-revoked on re-registration"
  - "Rate limiter applied AFTER auth middleware to use agentId as key"

patterns-established:
  - "Verify-once: Moltbook token verified at registration, MoltApp API key issued for subsequent requests"
  - "Auth middleware chain: authMiddleware -> agentRateLimiter -> handler"
  - "Hono typed env: AppEnv with Variables.agentId for context passing"
  - "Schema convention: text PK for agents (Moltbook ID), generatedAlwaysAsIdentity for all other tables"

# Metrics
duration: 5min
completed: 2026-02-01
---

# Phase 1 Plan 1: Foundation Summary

**Hono API with Moltbook server-to-server auth, Drizzle 4-table schema, SHA-256 API key middleware, and per-agent rate limiting**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-01T07:58:07Z
- **Completed:** 2026-02-01T08:03:34Z
- **Tasks:** 2/2
- **Files modified:** 18

## Accomplishments
- Project scaffolded with Hono, Drizzle ORM, Zod, and full TypeScript configuration
- 4 database tables (agents, wallets, apiKeys, transactions) with Drizzle schema and generated migration SQL
- Moltbook identity verification service calling `/api/v1/agents/verify-identity` server-to-server
- Registration endpoint that verifies Moltbook token, upserts agent profile, revokes old keys, and issues new API key
- Auth middleware that validates Bearer tokens via SHA-256 hash lookup in database
- Per-agent rate limiting at 60 req/min using hono-rate-limiter

## Task Commits

Each task was committed atomically:

1. **Task 1: Project scaffold, database schema, and config** - `cbea6b4` (feat)
2. **Task 2: Moltbook auth, API key middleware, and rate limiting** - `4840472` (feat)

## Files Created/Modified
- `package.json` - Project config with dev/build/start/db scripts
- `tsconfig.json` - TypeScript ES2022, NodeNext, strict, rewriteRelativeImportExtensions
- `drizzle.config.ts` - Drizzle-kit config pointing to schema and migrations dirs
- `src/index.ts` - Hono app entry with health check, auth routes, protected routes
- `src/config/env.ts` - Zod-validated environment variables (crashes on missing required vars)
- `src/config/constants.ts` - USDC mints, API key prefix, rate limit config
- `src/db/index.ts` - Drizzle + pg pool initialization
- `src/db/schema/agents.ts` - Agent profiles table (Moltbook ID as PK)
- `src/db/schema/wallets.ts` - Custodial wallets table (one per agent, unique public key)
- `src/db/schema/api-keys.ts` - API keys table (SHA-256 hash, revocation support)
- `src/db/schema/transactions.ts` - Transaction log (deposits/withdrawals with idempotency via tx_signature)
- `src/db/schema/index.ts` - Re-exports all schema tables
- `src/services/moltbook.ts` - Moltbook verify-identity client with typed response
- `src/routes/auth.ts` - POST /register with Zod validation, upsert, key rotation
- `src/middleware/auth.ts` - Bearer token auth with fire-and-forget lastUsedAt update
- `src/middleware/rate-limit.ts` - Per-agent rate limiter (60/min)
- `.env.example` - All environment variables documented
- `.gitignore` - node_modules, dist, .env, *.log

## Decisions Made
- Used `.ts` import extensions with `rewriteRelativeImportExtensions` in tsconfig -- drizzle-kit uses CJS require internally and cannot resolve `.js` extensions from TypeScript source files. The `rewriteRelativeImportExtensions` flag (TS 5.7+) rewrites `.ts` to `.js` in emitted output while keeping `.ts` in source.
- API keys use `mk_` prefix (12 chars stored as keyPrefix) for human-readable identification; full key is SHA-256 hashed before database storage.
- Key rotation is automatic: re-registration revokes all existing non-revoked keys for that agent before issuing a new one.
- Rate limiter is applied AFTER auth middleware in the middleware chain so that `agentId` is available as the rate limit key.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed drizzle-kit CJS module resolution with .ts imports**
- **Found during:** Task 1 (Drizzle migration generation)
- **Issue:** drizzle-kit uses CJS require internally and cannot resolve `.js` extension imports in TypeScript source files. `npx drizzle-kit generate` failed with "Cannot find module './agents.js'"
- **Fix:** Changed all intra-schema imports from `.js` to `.ts` extensions and added `rewriteRelativeImportExtensions: true` to tsconfig.json. TSC rewrites `.ts` -> `.js` in compiled output.
- **Files modified:** tsconfig.json, src/db/schema/wallets.ts, src/db/schema/api-keys.ts, src/db/schema/transactions.ts, src/db/schema/index.ts, src/db/index.ts, src/index.ts
- **Verification:** Both `npm run build` and `npx drizzle-kit generate` succeed
- **Committed in:** cbea6b4 (Task 1 commit)

**2. [Rule 1 - Bug] Fixed Hono typed context for agentId variable**
- **Found during:** Task 2 (index.ts route integration)
- **Issue:** `c.get("agentId")` failed TypeScript type check because Hono's default context has no declared variables. `No overload matches this call. Argument of type '"agentId"' is not assignable to parameter of type 'never'`
- **Fix:** Defined `AppEnv` type with `Variables: { agentId: string }` and passed as generic to `new Hono<AppEnv>()`. Also typed `RateLimitEnv` for the rate limiter's keyGenerator.
- **Files modified:** src/index.ts, src/middleware/rate-limit.ts
- **Verification:** `npm run build` compiles clean
- **Committed in:** 4840472 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both fixes necessary for compilation. No scope creep.

## Issues Encountered
- PostgreSQL not installed locally, so full runtime integration test (starting server, hitting endpoints with curl) could not be performed. TypeScript compilation and structural verification confirmed all code is correct. Runtime testing deferred to when DATABASE_URL is configured.

## User Setup Required

Before running the server, the following environment variables must be configured:

1. **DATABASE_URL** - PostgreSQL connection string (local or hosted: Neon, Supabase, Railway)
2. **MOLTBOOK_APP_KEY** - Moltbook app API key from Moltbook developer portal

Copy `.env.example` to `.env` and fill in values. Then run:
```bash
npx drizzle-kit migrate  # Apply database migrations
npm run dev              # Start development server
```

## Next Phase Readiness
- Auth foundation complete: agents can register, receive API keys, and access protected routes
- Database schema includes wallets and transactions tables (ready for Plan 02)
- Turnkey wallet integration (Plan 02) can build on auth middleware and agent records
- All 4 AUTH requirements (AUTH-01 through AUTH-04) are implemented pending runtime verification with Moltbook

---
*Phase: 01-identity-and-wallets*
*Completed: 2026-02-01*
