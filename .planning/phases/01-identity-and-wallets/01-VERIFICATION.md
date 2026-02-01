---
phase: 01-identity-and-wallets
verified: 2026-02-01T08:24:48Z
status: passed
score: 19/19 must-haves verified
---

# Phase 01: Identity and Wallets Verification Report

**Phase Goal:** Agents can prove their Moltbook identity, receive a custodial Solana wallet, fund it, and manage their balance -- all securely with real money at stake

**Verified:** 2026-02-01T08:24:48Z
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Agent can POST an identity token to /api/v1/auth/register and receive an API key | ✓ VERIFIED | auth.ts:23 POST /register endpoint, calls verifyIdentity (line 40), generates API key (lines 115-118), returns apiKey in response (line 130) |
| 2 | Agent profile (name, karma, avatar) is persisted in the database after registration | ✓ VERIFIED | auth.ts:55-76 upserts agent profile with onConflictDoUpdate, stores name, karma, avatarUrl, ownerXHandle, ownerXName |
| 3 | API requests without a valid API key are rejected with 401 | ✓ VERIFIED | middleware/auth.ts:20-44 checks Bearer token, hashes it, queries apiKeys table, returns 401 if missing or invalid |
| 4 | API requests exceeding rate limit are rejected with 429 | ✓ VERIFIED | middleware/rate-limit.ts:22-28 configures rateLimiter with 60 req/min limit per agentId, applied in index.ts:30 |
| 5 | New agent registration automatically creates a Turnkey-managed Solana wallet | ✓ VERIFIED | auth.ts:78-104 checks for existing wallet, calls createAgentWallet (line 91), inserts into wallets table (line 92), returns walletAddress (line 131) |
| 6 | Agent can query their SOL and USDC balance via GET /api/v1/wallet/balance | ✓ VERIFIED | wallets.ts:95 GET /balance endpoint, queries SOL via getBalance (line 113), queries USDC via getTokenAccountBalance (line 127), returns formatted balances (lines 136-145) |
| 7 | SOL or USDC sent to agent deposit address is detected and recorded via Helius webhook | ✓ VERIFIED | webhooks.ts:41 POST /helius endpoint, processes nativeTransfers (lines 71-88) and tokenTransfers (lines 91-109), calls processDeposit which inserts into transactions table with idempotency (deposit.ts:45) |
| 8 | Agent can withdraw SOL to an external Solana address via POST /api/v1/wallet/withdraw | ✓ VERIFIED | wallets.ts:157 POST /withdraw endpoint, validates balance (lines 229-304), calls withdrawSOL (line 314), signs with Turnkey (withdrawal.ts:241-244), records transaction (wallets.ts:346) |
| 9 | Agent can withdraw USDC to an external Solana address via POST /api/v1/wallet/withdraw | ✓ VERIFIED | wallets.ts:157 POST /withdraw accepts tokenType USDC, validates USDC balance (lines 276-303), calls withdrawUSDC (line 321), builds SPL token transfer (withdrawal.ts:304), signs with Turnkey (line 322-326) |
| 10 | Withdrawal is rejected if insufficient balance for amount + transaction fee | ✓ VERIFIED | wallets.ts:230-304 estimates fee (line 235), checks SOL balance >= amount + fee (lines 238-255), checks USDC balance >= amount AND SOL >= fee (lines 257-303) |
| 11 | Withdrawal transaction is recorded in the transactions table | ✓ VERIFIED | wallets.ts:346-356 inserts withdrawal into transactions table with agentId, type, tokenType, amount, txSignature, status, destinationAddress, confirmedAt |

**Score:** 11/11 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/index.ts` | Hono app entry point with route mounting | ✓ VERIFIED | 51 lines, mounts authRoutes (line 24), walletRoutes (line 33), webhookRoutes (line 27), applies auth + rate limit middleware (line 30), serves on env.PORT (line 41) |
| `src/db/schema/agents.ts` | Agent profiles table | ✓ VERIFIED | 40 lines, pgTable "agents" with id (PK), name, description, karma, avatarUrl, ownerXHandle, ownerXName, isActive, createdAt, updatedAt |
| `src/db/schema/api-keys.ts` | API key records table | ✓ VERIFIED | 34 lines, pgTable "api_keys" with id (auto), agentId (FK), keyHash (unique), keyPrefix, isRevoked, lastUsedAt, createdAt |
| `src/db/schema/wallets.ts` | Wallets table | ✓ VERIFIED | 31 lines, pgTable "wallets" with id (auto), agentId (FK, unique), publicKey (unique), turnkeyWalletId, usdcAtaAddress, createdAt |
| `src/db/schema/transactions.ts` | Transactions table | ✓ VERIFIED | 43 lines, pgTable "transactions" with id (auto), agentId (FK), type, tokenType, amount numeric(20,9), txSignature (unique), status, destinationAddress, createdAt, confirmedAt |
| `src/services/moltbook.ts` | Moltbook identity verification client | ✓ VERIFIED | 65 lines, exports verifyIdentity function that POSTs to moltbook.com/api/v1/agents/verify-identity with X-Moltbook-App-Key header, handles 401/429/errors, returns MoltbookAgent |
| `src/routes/auth.ts` | Registration endpoint | ✓ VERIFIED | 138 lines, exports authRoutes, POST /register validates body, calls verifyIdentity, upserts agent, creates wallet via createAgentWallet, generates and stores API key hash, returns apiKey + walletAddress |
| `src/middleware/auth.ts` | API key verification middleware | ✓ VERIFIED | 61 lines, exports authMiddleware, extracts Bearer token, SHA-256 hashes it, queries apiKeys table, sets agentId in context, updates lastUsedAt, returns 401 if missing/invalid |
| `src/middleware/rate-limit.ts` | Per-agent rate limiting | ✓ VERIFIED | 28 lines, exports agentRateLimiter using hono-rate-limiter, 60 req/min window, keyGenerator uses agentId from context |
| `src/services/wallet.ts` | Turnkey wallet creation abstraction | ✓ VERIFIED | 87 lines, exports createAgentWallet (creates Turnkey wallet with DEFAULT_SOLANA_ACCOUNTS, returns publicKey + turnkeyWalletId) and getTurnkeySigner (returns TurnkeySigner for signing) |
| `src/services/deposit.ts` | Deposit processing with idempotency | ✓ VERIFIED | 88 lines, exports processDeposit (checks txSignature uniqueness, inserts into transactions with type='deposit', converts lamports/raw amounts to decimal) and findAgentByWalletAddress |
| `src/routes/wallets.ts` | Wallet balance and withdrawal endpoints | ✓ VERIFIED | 377 lines, exports walletRoutes, GET / (wallet info), GET /balance (queries on-chain SOL + USDC via RPC), POST /withdraw (validates balance, calls withdrawSOL/USDC, records transaction) |
| `src/routes/webhooks.ts` | Helius webhook handler for deposit detection | ✓ VERIFIED | 120 lines, exports webhookRoutes, POST /helius verifies Bearer secret, processes nativeTransfers (SOL) and tokenTransfers (USDC), calls processDeposit for matching agent wallets |
| `src/services/withdrawal.ts` | SOL and USDC withdrawal transaction construction and signing | ✓ VERIFIED | 372 lines, exports withdrawSOL (builds transfer instruction, signs with Turnkey via signWithTurnkey, submits to RPC), withdrawUSDC (builds ATA creation + SPL transfer, signs with Turnkey), estimateWithdrawalFee |

**Score:** 14/14 artifacts verified

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| src/routes/auth.ts | src/services/moltbook.ts | calls verifyIdentity during registration | ✓ WIRED | auth.ts:7 imports verifyIdentity, line 40 calls it with identityToken |
| src/routes/auth.ts | src/db/schema/agents.ts | upserts agent profile after Moltbook verification | ✓ WIRED | auth.ts:6 imports agents schema, lines 55-76 db.insert(agents).onConflictDoUpdate |
| src/routes/auth.ts | src/services/wallet.ts | calls createAgentWallet during registration | ✓ WIRED | auth.ts:8 imports createAgentWallet, line 91 calls it, line 92 inserts into wallets table |
| src/middleware/auth.ts | src/db/schema/api-keys.ts | looks up hashed API key in database | ✓ WIRED | auth.ts:5 imports apiKeys schema, line 34 hashes key, lines 36-40 queries by keyHash |
| src/index.ts | src/middleware/rate-limit.ts | applies rate limiter to /api/v1/* routes | ✓ WIRED | index.ts:8 imports agentRateLimiter, line 30 applies to /api/v1/* after authMiddleware |
| src/routes/wallets.ts | @solana/kit | queries on-chain balance via RPC | ✓ WIRED | wallets.ts:5-10 imports createSolanaRpc, line 59 creates RPC client, line 113 calls getBalance, line 127 calls getTokenAccountBalance |
| src/routes/webhooks.ts | src/services/deposit.ts | processes Helius webhook events into deposit records | ✓ WIRED | webhooks.ts:3 imports processDeposit + findAgentByWalletAddress, lines 79 and 100 call processDeposit with event data |
| src/services/deposit.ts | src/db/schema/transactions.ts | inserts deposit with txSignature as idempotency key | ✓ WIRED | deposit.ts:4 imports transactions schema, line 45 db.insert(transactions).values with txSignature unique constraint |
| src/routes/wallets.ts | src/services/withdrawal.ts | calls withdrawSOL or withdrawUSDC based on tokenType | ✓ WIRED | wallets.ts:19-22 imports withdrawSOL, withdrawUSDC, estimateWithdrawalFee, lines 314 and 321 call based on tokenType |
| src/services/withdrawal.ts | src/services/wallet.ts | uses TurnkeySigner to sign withdrawal transactions | ✓ WIRED | withdrawal.ts:20 imports getTurnkeySigner, line 94 calls it, signWithTurnkey (line 90-98) uses turnkeySigner.signMessage |
| src/services/withdrawal.ts | @solana/kit | constructs and submits Solana transactions | ✓ WIRED | withdrawal.ts:1-13 imports Solana kit, line 223 getTransferSolInstruction, lines 230-235 pipe for transaction message, line 261 sendTransaction |
| src/routes/wallets.ts | src/db/schema/transactions.ts | records withdrawal in transactions table | ✓ WIRED | wallets.ts:12 imports transactions schema, line 346 db.insert(transactions).values after successful withdrawal |

**Score:** 12/12 key links verified

### Requirements Coverage

| Requirement | Status | Supporting Truths |
|-------------|--------|-------------------|
| AUTH-01: Agent can authenticate by presenting a Moltbook identity token | ✓ SATISFIED | Truth #1 (register endpoint), Truth #2 (profile cached) |
| AUTH-02: Verified agent profile (name, karma, avatar) is cached locally | ✓ SATISFIED | Truth #2 (agent upsert with profile fields) |
| AUTH-03: Agent receives a MoltApp API key after initial Moltbook auth | ✓ SATISFIED | Truth #1 (API key generation and return) |
| AUTH-04: API requests are rate-limited per agent to prevent abuse | ✓ SATISFIED | Truth #4 (rate limiter middleware) |
| WALL-01: Authenticated agent automatically gets a custodial Solana wallet | ✓ SATISFIED | Truth #5 (wallet creation via Turnkey) |
| WALL-02: Agent can fund wallet by sending SOL or USDC to their deposit address | ✓ SATISFIED | Truth #7 (Helius webhook deposit detection) |
| WALL-03: Agent can view wallet balance (SOL, USDC, and token holdings) via API | ✓ SATISFIED | Truth #6 (GET /balance endpoint) |
| WALL-04: Agent can withdraw SOL/USDC to an external Solana address | ✓ SATISFIED | Truth #8 (SOL withdrawal), Truth #9 (USDC withdrawal), Truth #10 (balance validation), Truth #11 (transaction recording) |

**Score:** 8/8 requirements satisfied

### Anti-Patterns Found

No blocking anti-patterns detected.

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| src/index.ts | 35 | Comment "Placeholder: GET /api/v1/me" | ℹ️ Info | Test endpoint for auth middleware verification - intentional, not problematic |

### Code Quality Metrics

- **Total TypeScript files:** 17
- **Total lines of code:** 1,336 (key files)
- **Compilation status:** ✓ PASSES (npm run build with zero errors)
- **Database migrations:** ✓ EXISTS (0000_whole_the_spike.sql with all 4 tables)
- **Stub patterns:** 0 blocking stubs found
- **TODO/FIXME comments:** 0 found
- **Export coverage:** 100% (all route modules export their Hono apps)

### Structural Verification

**Level 1 (Existence):** 14/14 artifacts exist ✓
**Level 2 (Substantive):** 14/14 artifacts are substantive (proper line counts, no stubs, exports present) ✓
**Level 3 (Wired):** 14/14 artifacts are wired (imported and used correctly) ✓

**Middleware Application:**
- ✓ authMiddleware applied to /api/v1/* (except /api/v1/auth/register)
- ✓ agentRateLimiter applied AFTER authMiddleware (correct order for agentId context)
- ✓ Webhook routes NOT behind auth middleware (use own Bearer secret)

**Database Schema:**
- ✓ All 4 tables defined: agents, api_keys, wallets, transactions
- ✓ Foreign key constraints: api_keys.agentId → agents.id, wallets.agentId → agents.id, transactions.agentId → agents.id
- ✓ Unique constraints: apiKeys.keyHash, wallets.agentId, wallets.publicKey, transactions.txSignature
- ✓ Identity columns: api_keys.id, wallets.id, transactions.id use generatedAlwaysAsIdentity()
- ✓ Numeric precision: transactions.amount is numeric(20, 9) for SOL/USDC decimals

**Critical Wiring Verified:**
1. ✓ Moltbook identity verification → agent profile upsert → API key generation → wallet creation (full registration flow)
2. ✓ API key Bearer token → SHA-256 hash → database lookup → agentId context setting (auth flow)
3. ✓ Helius webhook → nativeTransfers/tokenTransfers parsing → findAgentByWalletAddress → processDeposit → transactions insert (deposit flow)
4. ✓ Withdrawal request → balance validation → withdrawSOL/USDC → Turnkey signing → RPC submission → transactions insert (withdrawal flow)
5. ✓ Balance query → RPC getBalance (SOL) → RPC getTokenAccountBalance (USDC ATA) → decimal formatting (balance flow)

---

## Summary

**Phase 01 goal is ACHIEVED.**

All 11 observable truths are verified. All 14 required artifacts exist, are substantive, and are wired correctly. All 12 key links are functioning. All 8 requirements (AUTH-01 through AUTH-04, WALL-01 through WALL-04) are satisfied.

The codebase implements a complete identity and wallet system:
1. Agents authenticate via Moltbook identity tokens
2. Agent profiles are cached with karma, avatar, and owner info
3. API keys are issued and validated via SHA-256 hashing
4. Rate limiting prevents abuse (60 req/min per agent)
5. Turnkey-managed custodial Solana wallets are created automatically
6. Deposits are detected via Helius webhooks with idempotency protection
7. Balances are queried from on-chain state (SOL and USDC)
8. Withdrawals are signed via Turnkey and submitted to Solana with balance validation

No gaps found. No human verification required for structural completeness.

**Next Steps:** Phase 01 is complete and verified. Proceed to Phase 02.

---

_Verified: 2026-02-01T08:24:48Z_
_Verifier: Claude (gsd-verifier)_
