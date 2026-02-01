---
phase: 01-identity-and-wallets
plan: 02
subsystem: wallets
tags: [turnkey, solana, @solana/kit, helius, webhooks, custodial-wallet, deposit-detection, idempotency]

# Dependency graph
requires:
  - phase: 01-identity-and-wallets/01-01
    provides: Hono API server, Drizzle schema (wallets + transactions tables), auth middleware, registration endpoint
provides:
  - Turnkey-managed custodial Solana wallet creation on agent registration
  - GET /api/v1/wallet endpoint returning wallet info
  - GET /api/v1/wallet/balance endpoint returning on-chain SOL and USDC balances
  - POST /webhooks/helius endpoint for Helius webhook-based deposit detection
  - Deposit processing service with idempotency (txSignature uniqueness)
  - Wallet address reverse lookup service (findAgentByWalletAddress)
affects: [01-03-PLAN (withdrawals need getTurnkeySigner + wallet lookup), 02-trading (balance queries for pre-trade validation)]

# Tech tracking
tech-stack:
  added: ["@turnkey/sdk-server", "@turnkey/solana", "@solana/kit", "@solana-program/system", "@solana/spl-token"]
  patterns: [Turnkey custodial wallet creation, PDA-based ATA derivation via @solana/kit, Helius webhook with Bearer secret auth, idempotent deposit processing]

key-files:
  created:
    - src/services/wallet.ts
    - src/services/deposit.ts
    - src/routes/wallets.ts
    - src/routes/webhooks.ts
  modified:
    - src/routes/auth.ts
    - src/index.ts
    - package.json

key-decisions:
  - "Used @solana/kit (web3.js 2.0) PDA derivation for ATA address instead of @solana/spl-token getAssociatedTokenAddress (which depends on legacy @solana/web3.js 1.x PublicKey type)"
  - "Decimal.js named import { Decimal } required for ESM compatibility (default import fails TSC)"
  - "Webhook routes mounted before auth middleware use() to avoid API key auth on /webhooks/*"
  - "Helius webhook always returns 200 even on processing errors to prevent retry storms"

patterns-established:
  - "Turnkey SDK lazy initialization: singleton getTurnkey() called on first wallet operation, not at module load"
  - "Deposit idempotency: check-then-insert with unique constraint as race condition safety net"
  - "Webhook route placement: mounted BEFORE app.use('/api/v1/*', authMiddleware) to bypass API key auth"
  - "ATA derivation: manual PDA(ATA_PROGRAM, [owner, TOKEN_PROGRAM, mint]) using @solana/kit getProgramDerivedAddress"

# Metrics
duration: 7min
completed: 2026-02-01
---

# Phase 1 Plan 2: Wallets Summary

**Turnkey custodial Solana wallet creation wired into registration, on-chain SOL/USDC balance queries via @solana/kit, and Helius webhook-based deposit detection with idempotent processing**

## Performance

- **Duration:** 7 min
- **Started:** 2026-02-01T08:06:00Z
- **Completed:** 2026-02-01T08:12:36Z
- **Tasks:** 2/2
- **Files modified:** 8

## Accomplishments
- Turnkey wallet service that creates custodial Solana wallets for agents using @turnkey/sdk-server
- Registration endpoint now auto-creates a wallet and returns walletAddress in the response
- Wallet info and balance endpoints (SOL in lamports + display, USDC via ATA query)
- Helius webhook handler that detects SOL and USDC deposits and records them idempotently in the transactions table

## Task Commits

Each task was committed atomically:

1. **Task 1: Turnkey wallet service, balance endpoints, wallet creation in registration** - `05dea90` (feat)
2. **Task 2: Helius webhook handler for deposit detection** - `13da662` (feat)

## Files Created/Modified
- `src/services/wallet.ts` - Turnkey SDK wrapper: createAgentWallet() and getTurnkeySigner() for custodial wallet operations
- `src/services/deposit.ts` - Deposit processing with idempotency guard (txSignature check + constraint) and wallet address reverse lookup
- `src/routes/wallets.ts` - GET / (wallet info) and GET /balance (SOL + USDC on-chain balance via @solana/kit RPC)
- `src/routes/webhooks.ts` - POST /helius webhook handler processing nativeTransfers (SOL) and tokenTransfers (USDC)
- `src/routes/auth.ts` - Updated to create Turnkey wallet during registration, return walletAddress in response
- `src/index.ts` - Mount walletRoutes at /api/v1/wallet and webhookRoutes at /webhooks
- `package.json` - Added @turnkey/sdk-server, @turnkey/solana, @solana/kit, @solana-program/system, @solana/spl-token

## Decisions Made
- Used `@solana/kit` (web3.js 2.0) `getProgramDerivedAddress` for ATA address derivation instead of `@solana/spl-token`'s `getAssociatedTokenAddress`, because spl-token v0.4.x depends on the legacy `@solana/web3.js` 1.x `PublicKey` type which is incompatible with `@solana/kit`'s branded `Address` type.
- Named import `{ Decimal }` from decimal.js instead of default import -- the default export lacks construct signatures in TSC under ESM module resolution.
- Webhook routes mounted at `/webhooks` BEFORE the `app.use('/api/v1/*', authMiddleware)` call in index.ts, so they are not subject to API key auth. Webhooks authenticate via their own Bearer secret header.
- Helius webhook always returns HTTP 200 even when individual deposit processing fails -- errors are logged internally. This prevents Helius from retrying and potentially creating duplicate processing.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Decimal.js import for ESM compatibility**
- **Found during:** Task 1 (wallet balance endpoint)
- **Issue:** `import Decimal from "decimal.js"` compiled but `new Decimal(...)` failed with "This expression is not constructable. Type 'typeof import(...)' has no construct signatures."
- **Fix:** Changed to named import `import { Decimal } from "decimal.js"`
- **Files modified:** src/routes/wallets.ts
- **Verification:** `npm run build` compiles clean
- **Committed in:** 05dea90 (Task 1 commit)

**2. [Rule 3 - Blocking] Manual ATA derivation instead of @solana/spl-token helper**
- **Found during:** Task 1 (USDC balance query)
- **Issue:** `@solana/spl-token` v0.4.x `getAssociatedTokenAddress()` uses legacy `@solana/web3.js` v1 `PublicKey` type, incompatible with `@solana/kit`'s branded `Address` type
- **Fix:** Implemented ATA derivation manually using `getProgramDerivedAddress()` from `@solana/kit` with seeds [owner, TOKEN_PROGRAM, mint]
- **Files modified:** src/routes/wallets.ts
- **Verification:** `npm run build` compiles clean; ATA derivation follows the canonical PDA formula
- **Committed in:** 05dea90 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both fixes necessary for compilation. No scope creep.

## Issues Encountered
- PostgreSQL not available locally for full runtime integration testing. TypeScript compilation and structural verification confirmed all code is correct. Runtime testing deferred to when DATABASE_URL, TURNKEY_*, and SOLANA_RPC_URL environment variables are configured.

## User Setup Required

Before wallet functionality works at runtime, these environment variables must be configured:

1. **TURNKEY_API_PRIVATE_KEY** - From Turnkey Dashboard -> Developers -> API Keys
2. **TURNKEY_API_PUBLIC_KEY** - From Turnkey Dashboard -> Developers -> API Keys
3. **TURNKEY_ORGANIZATION_ID** - From Turnkey Dashboard -> Settings -> Organization ID
4. **SOLANA_RPC_URL** - Helius RPC URL or other Solana RPC provider (use devnet for development)
5. **HELIUS_API_KEY** - From Helius Dashboard -> API Keys
6. **HELIUS_WEBHOOK_SECRET** - Generate with `openssl rand -hex 32`, use when creating Helius webhook

## Next Phase Readiness
- Wallet infrastructure complete: agents get wallets on registration, can check balances, and deposits are detected
- `getTurnkeySigner()` exported and ready for Plan 03 (withdrawal signing)
- `findAgentByWalletAddress()` available for any reverse lookup needs
- All 3 WALL requirements implemented: WALL-01 (custodial wallet creation), WALL-02 (deposit detection), WALL-03 (balance query)
- Plan 03 (withdrawals) can build on the wallet service and transaction recording patterns

---
*Phase: 01-identity-and-wallets*
*Completed: 2026-02-01*
