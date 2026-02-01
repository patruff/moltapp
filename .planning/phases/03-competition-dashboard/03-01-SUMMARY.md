---
phase: 03-competition-dashboard
plan: 01
subsystem: api
tags: [leaderboard, jupiter, decimal.js, hono, drizzle, caching, jsx]

# Dependency graph
requires:
  - phase: 01-identity-wallets
    provides: "Agent auth, DB schema (agents, wallets, transactions), middleware"
  - phase: 02-trading
    provides: "Trading service, Jupiter integration, positions/trades schemas"
provides:
  - "Leaderboard computation service with 30-min cached portfolio values"
  - "Bot-facing JSON API at /api/v1/leaderboard and /api/v1/leaderboard/me"
  - "TSConfig JSX support for Phase 03 Plan 02 web pages"
  - "ADMIN_PASSWORD env var for admin dashboard auth"
affects:
  - 03-competition-dashboard-02 (web pages consume leaderboard service)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Module-level cache singleton with thundering herd prevention"
    - "Decimal.js for all financial P&L arithmetic"
    - "Batch SQL queries (not per-agent) for leaderboard computation"

key-files:
  created:
    - src/services/leaderboard.ts
    - src/routes/leaderboard-api.ts
  modified:
    - tsconfig.json
    - src/config/env.ts
    - src/index.ts

key-decisions:
  - "Conservative position valuation: if Jupiter price unavailable, position valued at 0"
  - "P&L percentage sort for leaderboard ranking (not absolute P&L)"
  - "Leaderboard mounted after auth middleware -- bot API is protected, not public"

patterns-established:
  - "Cache pattern: module-level singleton + TTL check + shared refresh promise for thundering herd"
  - "Leaderboard data computed via batch SQL + Jupiter prices, not per-agent queries"

# Metrics
duration: 2min
completed: 2026-02-01
---

# Phase 03 Plan 01: Leaderboard Data Layer Summary

**Leaderboard service computing per-agent portfolio P&L from DB positions + Jupiter live prices, cached 30 min, served via bot-facing JSON API**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-01T11:19:46Z
- **Completed:** 2026-02-01T11:22:11Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments
- Leaderboard computation service with efficient batch SQL (agents, positions, trades, transactions) + Jupiter price fetching
- In-memory cache with 30-minute TTL and thundering herd prevention via shared promise
- Bot-facing JSON API: GET /api/v1/leaderboard (full rankings) and GET /api/v1/leaderboard/me (own entry)
- TSConfig JSX support enabled for Plan 02 web pages
- ADMIN_PASSWORD env var added for admin dashboard authentication

## Task Commits

Each task was committed atomically:

1. **Task 1: Config prerequisites -- TSConfig JSX, ADMIN_PASSWORD env var** - `8776e24` (chore)
2. **Task 2: Leaderboard computation service with in-memory cache** - `12df1fb` (feat)
3. **Task 3: Bot-facing JSON API routes and mounting in index.ts** - `68dfdff` (feat)

## Files Created/Modified
- `tsconfig.json` - Added jsx: "react-jsx" and jsxImportSource: "hono/jsx"
- `src/config/env.ts` - Added ADMIN_PASSWORD as required Zod string
- `src/services/leaderboard.ts` - Leaderboard computation, caching, P&L via Decimal.js
- `src/routes/leaderboard-api.ts` - Bot-facing JSON API (GET / and GET /me)
- `src/index.ts` - Mounted leaderboard API after auth middleware

## Decisions Made
- Conservative position valuation: if Jupiter price is unavailable for a mint, position is valued at 0 rather than failing the entire computation
- Leaderboard ranked by P&L percentage descending (not absolute P&L), so agents with different capital sizes compete fairly
- Leaderboard API is protected behind existing auth + rate limiter -- bots need valid API keys

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

ADMIN_PASSWORD environment variable must be set before app startup (added as required in Zod schema).

## Next Phase Readiness
- Leaderboard service ready for Plan 02 web pages to consume via `getLeaderboard()`
- TSConfig JSX compilation enabled for .tsx files
- ADMIN_PASSWORD available in env for admin dashboard auth

---
*Phase: 03-competition-dashboard*
*Completed: 2026-02-01*
