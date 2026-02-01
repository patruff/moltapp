---
phase: 02-trading
plan: 01
subsystem: database, api
tags: [drizzle, postgres, xstocks, token-2022, jupiter, solana]

# Dependency graph
requires:
  - phase: 01-identity-wallets
    provides: agents table schema, env validation pattern, drizzle-orm setup
provides:
  - positions and trades database tables with FK to agents
  - xStocks catalog (20 tokenized equities with mint addresses)
  - Token-2022 and ATA program address constants
  - Jupiter API base URL and required API key env var
affects: [02-02 trading services and routes, 03-competition leaderboard queries]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Composite unique constraint via drizzle unique().on() for positions"
    - "jsonb column for Jupiter route audit trail"

key-files:
  created:
    - src/db/schema/positions.ts
    - src/db/schema/trades.ts
    - src/db/migrations/0001_eager_reaper.sql
  modified:
    - src/db/schema/index.ts
    - src/config/constants.ts
    - src/config/env.ts

key-decisions:
  - "JUPITER_API_KEY is required (not optional) since all trading depends on Jupiter"
  - "ATA_PROGRAM_ADDRESS centralized as shared constant (was duplicated in withdrawal.ts and wallets.ts)"

patterns-established:
  - "Composite unique constraint: unique('name').on(col1, col2) for multi-column uniqueness"
  - "StockToken interface for typed token catalog entries"

# Metrics
duration: 3min
completed: 2026-02-01
---

# Phase 2 Plan 1: Schema and Constants Foundation Summary

**Positions/trades Drizzle schemas with agentId FK, 20-token xStocks catalog, Token-2022 constants, and Jupiter API key validation**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-01T09:48:14Z
- **Completed:** 2026-02-01T09:51:03Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Positions table with unique(agentId, mintAddress) constraint and numeric precision for quantity(20,9) and averageCostBasis(20,6)
- Trades table with txSignature unique constraint, jupiterRouteInfo jsonb, and status default 'confirmed'
- xStocks catalog of 20 top-traded tokenized equities with verified mint addresses
- JUPITER_API_KEY required at startup via env validation

## Task Commits

Each task was committed atomically:

1. **Task 1: Database schema for positions and trades tables** - `bb64521` (feat)
2. **Task 2: xStocks catalog, Token-2022 constants, and Jupiter env var** - `b9bf96c` (feat)

**Plan metadata:** (pending final commit)

## Files Created/Modified
- `src/db/schema/positions.ts` - Positions table: agentId FK, mintAddress, symbol, quantity(20,9), averageCostBasis(20,6), unique(agentId+mintAddress)
- `src/db/schema/trades.ts` - Trades table: agentId FK, side, stockMintAddress, stockSymbol, stockQuantity(20,9), usdcAmount(20,6), pricePerToken(20,6), txSignature unique, jupiterRouteInfo jsonb, status
- `src/db/schema/index.ts` - Added re-exports for positions and trades (now 6 total schemas)
- `src/db/migrations/0001_eager_reaper.sql` - Migration SQL for both new tables with FK constraints
- `src/config/constants.ts` - JUPITER_API_BASE_URL, TOKEN_2022_PROGRAM_ADDRESS, ATA_PROGRAM_ADDRESS, StockToken interface, XSTOCKS_CATALOG (20 tokens)
- `src/config/env.ts` - JUPITER_API_KEY as required env var

## Decisions Made
- JUPITER_API_KEY is required (not optional) since all Jupiter API calls need it and trading cannot function without it
- ATA_PROGRAM_ADDRESS added as a centralized constant; currently duplicated in withdrawal.ts and wallets.ts -- consolidation can happen in a future refactor
- Kept numeric precision consistent with Phase 1 pattern: 9 decimals for token amounts, 6 for USDC values

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

JUPITER_API_KEY must be added to the environment before the application will start. Obtain an API key from https://station.jup.ag/ and add to `.env`:

```
JUPITER_API_KEY=your_jupiter_api_key_here
```

## Next Phase Readiness
- Schema foundation complete for Plan 02-02 (trading services and routes)
- Positions and trades tables ready for service layer queries
- xStocks catalog available for token validation in trade endpoints
- Jupiter constants ready for DEX integration service

---
*Phase: 02-trading*
*Completed: 2026-02-01*
