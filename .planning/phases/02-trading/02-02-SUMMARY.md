---
phase: 02-trading
plan: 02
subsystem: trading, api
tags: [jupiter, turnkey, solana, xstocks, hono, drizzle, decimal.js]

# Dependency graph
requires:
  - phase: 01-identity-wallets
    provides: wallets table, Turnkey signing (getTurnkeySigner), ATA derivation, auth middleware, rate limiter
  - phase: 02-01
    provides: positions/trades schemas, xStocks catalog, Jupiter constants, JUPITER_API_KEY env var
provides:
  - Jupiter Ultra API client (order/sign/execute/prices)
  - Stock catalog service with price enrichment
  - Full buy/sell trading flow with position management
  - 6 new API endpoints (stocks, trading, positions, trades)
affects: [03-competition leaderboard queries, 03-competition portfolio valuation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Solana wire format byte parsing for Turnkey signing bridge (compact-u16 + signature injection)"
    - "Jupiter Ultra API order->sign->execute pipeline"
    - "Weighted average cost basis via SQL upsert (onConflictDoUpdate)"
    - "Error prefix convention for service->route HTTP status translation"

key-files:
  created:
    - src/services/jupiter.ts
    - src/services/stocks.ts
    - src/services/trading.ts
    - src/routes/stocks.ts
    - src/routes/trading.ts
    - src/routes/positions.ts
    - src/routes/trades.ts
  modified:
    - src/index.ts

key-decisions:
  - "Jupiter transaction signing uses wire format byte parsing (compact-u16 header + 64-byte signature slots) rather than @solana/kit compile/decompile"
  - "Position weighted average cost basis computed in SQL for atomicity"
  - "Sells pass usdcAmount='0' as dummy value since TradeRequest.usdcAmount is required"

patterns-established:
  - "Error prefix convention: service throws 'prefix: detail', route maps prefix to HTTP status"
  - "Jupiter signing bridge pattern: decode base64 -> parse wire format -> sign messageBytes -> inject signature -> re-encode"
  - "Graceful degradation: price API failures return null prices, never throw"

# Metrics
duration: 4min
completed: 2026-02-01
---

# Phase 2 Plan 2: Trading Services and API Routes Summary

**Jupiter Ultra API client with Turnkey signing bridge, full buy/sell execution with position tracking, and 6 new API endpoints for stock discovery, trading, positions, and trade history**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-01T09:55:00Z
- **Completed:** 2026-02-01T09:58:55Z
- **Tasks:** 3
- **Files created:** 7
- **Files modified:** 1

## Accomplishments

- Jupiter Ultra API client: getOrder (GET /ultra/v1/order), signJupiterTransaction (wire format byte parsing + Turnkey Ed25519), executeOrder (POST /ultra/v1/execute with timeout retry), getPrices (Price API V3 with batching)
- Stock catalog service: getStockBySymbol (case-insensitive), getStockByMint, listStocksWithPrices (graceful degradation on price API failure)
- Trading execution service: executeBuy and executeSell with full validation pipeline (stock lookup, wallet check, balance check, Jupiter order/sign/execute, DB trade recording, position upsert/update)
- Position management: weighted average cost basis on buys (SQL upsert), quantity decrement on sells, row deletion when fully liquidated
- 6 new API endpoints all behind auth middleware + rate limiter

## Task Commits

Each task was committed atomically:

1. **Task 1: Jupiter API client and stock catalog service** - `a0922a2` (feat)
2. **Task 2: Trading execution service with position management** - `9cd3a08` (feat)
3. **Task 3: API routes and index.ts mounting** - `a8e3725` (feat)

## Files Created/Modified

- `src/services/jupiter.ts` - Jupiter Ultra API client: getOrder, signJupiterTransaction, executeOrder, getPrices with types JupiterOrderResponse, JupiterExecuteResponse, JupiterPrice
- `src/services/stocks.ts` - Stock catalog lookups (symbol/mint) and price-enriched listing with StockWithPrice type
- `src/services/trading.ts` - Trade execution orchestrator: executeBuy, executeSell with TradeRequest/TradeResult types, balance checks, position upsert logic
- `src/routes/stocks.ts` - GET / (list all stocks with prices), GET /:symbol (single stock detail)
- `src/routes/trading.ts` - POST /buy (zod validated), POST /sell (zod validated), error prefix -> HTTP status translation
- `src/routes/positions.ts` - GET / (list agent positions)
- `src/routes/trades.ts` - GET / (paginated trade history, limit/offset, max 200)
- `src/index.ts` - Added 4 new route imports and mountings after auth middleware

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/stocks | List all 20 xStocks with current USD prices |
| GET | /api/v1/stocks/:symbol | Single stock detail with price |
| POST | /api/v1/trading/buy | Execute buy: {stockSymbol, usdcAmount} |
| POST | /api/v1/trading/sell | Execute sell: {stockSymbol, stockQuantity} |
| GET | /api/v1/positions | List agent's current stock positions |
| GET | /api/v1/trades | Paginated trade history (?limit=50&offset=0) |

## Decisions Made

- Jupiter transaction signing uses wire format byte parsing (compact-u16 header for number of signers, skip 64-byte signature placeholders, extract message bytes) rather than @solana/kit deserialize/reserialize -- this preserves the exact transaction bytes Jupiter requires
- Position weighted average cost basis computed via SQL in onConflictDoUpdate for atomicity: `newAvgCost = (oldQty * oldAvg + newQty * newPrice) / (oldQty + newQty)`
- TradeRequest.usdcAmount is required (not optional) for type simplicity; sell routes pass "0" as dummy value since the sell flow uses stockQuantity instead
- Error prefix convention established: services throw `prefix: detail` strings, routes parse the prefix to map to HTTP status codes (404/400/502/500)
- Price API failures handled via graceful degradation: listStocksWithPrices returns null prices rather than throwing, ensuring the catalog is always available

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed missing usdcAmount in executeSell call**

- **Found during:** Task 3
- **Issue:** TradeRequest.usdcAmount is a required field but the sell route only passes stockSymbol and stockQuantity, causing a TypeScript error
- **Fix:** Passed `usdcAmount: "0"` as a dummy value for sell calls (the sell flow ignores usdcAmount and uses stockQuantity instead)
- **Files modified:** src/routes/trading.ts
- **Commit:** a8e3725

## Issues Encountered

None beyond the minor type fix documented above.

## Next Phase Readiness

- All trading endpoints operational (pending Jupiter API key and funded wallets for live execution)
- Phase 2 fully complete: schema (02-01) + services/routes (02-02)
- Ready for Phase 3 (Competition Dashboard): positions and trades tables available for leaderboard queries, portfolio valuation can use getPrices + positions data
- Agent portfolio flow complete: register -> create wallet -> fund wallet -> buy stocks -> check positions -> sell stocks -> check trade history -> withdraw

---
*Phase: 02-trading*
*Completed: 2026-02-01*
