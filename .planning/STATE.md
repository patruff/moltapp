# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-01)

**Core value:** Agents can trade tokenized real stocks on Solana and compete on a public leaderboard -- the trading must be secure since real funds are at stake.
**Current focus:** Phase 1 complete. Ready for Phase 2: Trading

## Current Position

Phase: 1 of 3 (Identity and Wallets) -- COMPLETE
Plan: 3 of 3 in current phase
Status: Phase 1 complete
Last activity: 2026-02-01 -- Completed 01-03-PLAN.md (Withdrawals: SOL and USDC withdrawal with Turnkey signing)

Progress: [████░░░░░░] 43% (3/7 plans)

## Performance Metrics

**Velocity:**
- Total plans completed: 3
- Average duration: 6 min
- Total execution time: 17 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. Identity and Wallets | 3/3 | 17 min | 6 min |

**Recent Trend:**
- Last 5 plans: 01-01 (5 min), 01-02 (7 min), 01-03 (5 min)
- Trend: stable

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: 3-phase quick-depth structure (Identity+Wallets -> Trading -> Competition Dashboard)
- [Roadmap]: Auth and Wallets combined into Phase 1 (tightly coupled -- wallet creation requires auth)
- [Research]: xStocks recommended as primary tokenized stock provider; Jupiter Ultra API for DEX aggregation
- [Research]: Turnkey or Crossmint recommended for custodial key management (HSM/MPC)
- [01-01]: Used .ts import extensions with rewriteRelativeImportExtensions for drizzle-kit CJS compatibility
- [01-01]: API key prefix mk_ (12 chars stored), full key SHA-256 hashed
- [01-01]: Key rotation: old keys auto-revoked on re-registration
- [01-01]: Rate limiter applied AFTER auth middleware to use agentId as key
- [01-02]: Used @solana/kit PDA derivation for ATA address (not @solana/spl-token which depends on legacy web3.js)
- [01-02]: Decimal.js named import { Decimal } required for ESM compatibility
- [01-02]: Webhook routes mounted before auth middleware to bypass API key auth
- [01-02]: Helius webhook always returns 200 to prevent retry storms; errors logged internally
- [01-03]: Turnkey signMessage used directly on compiled transaction messageBytes (avoids TransactionWithinSizeLimit brand type issues)
- [01-03]: Manual SPL Token instruction byte encoding for @solana/kit compatibility (legacy @solana/spl-token types incompatible)
- [01-03]: CreateAssociatedTokenAccountIdempotent always included in USDC withdrawal for first-time recipients
- [01-03]: Conservative fee estimation: 5000 lamports SOL, 2_044_280 lamports USDC (worst-case ATA creation)

### Pending Todos

None yet.

### Blockers/Concerns

- [Research]: Moltbook identity verification endpoint not confirmed in public API docs -- needs validation
- [Research]: Tokenized stock Transfer Hook restrictions (xStocks Token-2022) may require wallet whitelisting
- [Research]: Legal/regulatory review for securities trading flagged as pre-development concern -- user decision needed
- [01-01]: PostgreSQL not installed locally -- full runtime integration test deferred until DATABASE_URL is configured
- [01-02]: Turnkey, Helius, and Solana RPC env vars required for runtime wallet operations -- not yet configured

## Session Continuity

Last session: 2026-02-01T08:20Z
Stopped at: Completed 01-03-PLAN.md -- Phase 1 (Identity and Wallets) fully complete
Resume file: None
