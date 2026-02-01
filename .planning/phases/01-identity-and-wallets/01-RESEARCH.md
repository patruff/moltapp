# Phase 1: Identity and Wallets - Research

**Researched:** 2026-02-01
**Domain:** Moltbook agent authentication, custodial Solana wallets, deposit detection, withdrawal, rate limiting
**Confidence:** HIGH (Moltbook API verified via official docs; Solana patterns well-documented; wallet provider comparison thorough)

## Summary

Phase 1 covers two tightly coupled capabilities: (1) authenticating AI agents via Moltbook identity tokens and issuing MoltApp API keys, and (2) creating per-agent custodial Solana wallets with deposit/withdrawal functionality. These are foundational -- every subsequent phase depends on "an agent exists and has a wallet."

The Moltbook developer API is straightforward and well-documented. Agents obtain identity tokens from Moltbook, and apps verify them via a server-side POST to `/api/v1/agents/verify-identity` using an app-level API key. The verification response includes full agent profile data (id, name, karma, avatar, owner info). This is NOT a JWKS/JWT-verify-locally flow -- it is a server-to-server verification call. MoltApp should verify once at registration, cache the agent profile, and issue its own API key for subsequent requests.

For custodial wallets, **Turnkey is the recommended provider** over Crossmint. Turnkey provides TEE-backed server-side wallet creation and transaction signing via a clean API (`@turnkey/sdk-server` + `@turnkey/solana`), with 50-100ms signing latency, a free tier of 100 wallets + 25 signatures/month, and a Pro tier at $99/month with 2,000 wallets. Turnkey is non-custodial by design (keys live in secure enclaves, never exposed), and has a Solana Policy Engine for granular transaction controls. Crossmint is a viable alternative but charges per Monthly Active Wallet ($0.05/MAW after 1,000 free), which becomes more expensive for always-active agent wallets.

For deposit detection, **Helius webhooks** are the recommended approach. They push parsed transaction data (including `nativeTransfers` for SOL and `tokenTransfers` for USDC) to your endpoint when activity hits a watched address. This avoids polling and WebSocket management complexity. For the withdrawal flow, standard `@solana/kit` transaction construction with Turnkey signing covers both SOL and SPL token (USDC) transfers.

**Primary recommendation:** Use Moltbook server-to-server verification for auth, Turnkey for custodial wallets, Helius webhooks for deposit detection, and `hono-rate-limiter` for per-agent rate limiting. Start on devnet, design for mainnet.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `hono` | 4.11.x | REST API framework | Ultrafast, TypeScript-first, Web Standards-based. Built-in Zod validation. Multi-runtime (Node, Bun, CF Workers). |
| `@hono/node-server` | latest | Node.js adapter for Hono | Required to run Hono on Node.js |
| `jose` | latest | JWT/JWS verification | Lightweight, zero-dependency, standards-compliant JWT handling. Used for potential future local JWT verification, and for issuing MoltApp API keys as signed JWTs. |
| `@turnkey/sdk-server` | latest | Turnkey server-side SDK | Wallet creation, policy management, organization management. TEE-backed key infrastructure. |
| `@turnkey/solana` | latest | Turnkey Solana signer | `TurnkeySigner` integrates with Solana web3.js for remote transaction signing. Keys never leave TEE. |
| `@solana/kit` | 3.0.x | Solana SDK | Official successor to web3.js v1. Tree-shakable, zero dependencies. For RPC calls, transaction construction, balance queries. |
| `@solana-program/system` | latest | System program instructions | `getTransferSolInstruction` for SOL transfers |
| `@solana/spl-token` | latest | SPL token operations | Token account management, USDC transfers, ATA creation |
| `drizzle-orm` | 0.45.x | TypeScript ORM | SQL-transparent, lightweight (7.4KB), code-first schema. For agent profiles, wallet records, transaction logs. |
| `pg` | latest | PostgreSQL driver | Drizzle ORM database driver |
| `zod` | 3.x | Schema validation | Request/response validation. Integrates natively with Hono. |
| `hono-rate-limiter` | latest | Rate limiting middleware | Per-agent rate limiting. Configurable window/limit. Custom key generator for agent-based limiting. |
| `decimal.js` | latest | Precise decimal arithmetic | Financial calculations. Never use native JS numbers for money. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `drizzle-kit` | latest | Migration tool | Schema migrations, `drizzle-kit generate` + `drizzle-kit migrate` |
| `@hono/zod-openapi` | latest | OpenAPI generation | Auto-generate API docs from Zod schemas for agent developers |
| `drizzle-zod` | latest | Drizzle-to-Zod bridge | Generate Zod schemas from DB schema for validation |
| `ioredis` | latest | Redis client | Rate limiter backing store (if distributed). Optional -- can start with in-memory store. |
| `vitest` | latest | Test framework | Unit and integration tests |
| `tsx` | latest | TypeScript runner | Development server, scripts |

### Alternatives Considered

| Instead of | Could Use | Why Not |
|------------|-----------|---------|
| Turnkey | Crossmint | Crossmint charges $0.05/MAW after 1,000 free. Agent wallets are "always active" (queried daily), so costs scale linearly. Turnkey charges per-signature ($0.10, dropping to $0.01 at volume), which is cheaper for wallets that sign infrequently. Crossmint also auto-broadcasts transactions (less control over submission strategy). |
| Turnkey | Raw keypair management | Storing encrypted private keys in DB is simpler but introduces catastrophic security risk. Single DB breach = all wallets drained. Turnkey keeps keys in TEE/secure enclaves. Do not roll your own crypto custody for real money. |
| Turnkey | Privy | Privy is optimized for user-facing wallets with social login. MoltApp's users are AI agents authenticated via Moltbook, not humans doing social login. Turnkey's server-side API primitives are a better fit for programmatic wallet management. |
| `hono-rate-limiter` | Custom rate limiter | Rate limiting has subtle edge cases (race conditions, distributed state). The library handles these. Custom key generator function supports per-agent limiting out of the box. |
| `jose` for MoltApp API keys | Simple random API keys | JWTs can encode agent metadata (id, permissions) and are stateless to verify. But simple random keys stored in DB are also fine for MVP. Decision: start with random API keys (simpler), migrate to JWTs if needed. |

**Installation:**

```bash
# Core API
npm install hono @hono/node-server zod @hono/zod-openapi

# Auth
npm install jose

# Turnkey (wallet infrastructure)
npm install @turnkey/sdk-server @turnkey/solana

# Solana
npm install @solana/kit @solana-program/system @solana/spl-token

# Database
npm install drizzle-orm pg
npm install -D drizzle-kit @types/pg

# Rate limiting
npm install hono-rate-limiter

# Financial math
npm install decimal.js

# Dev
npm install -D typescript @types/node tsx vitest
```

## Architecture Patterns

### Recommended Project Structure

```
apps/api/src/
  routes/
    auth.ts              # POST /api/v1/auth/register, POST /api/v1/auth/verify
    wallets.ts           # GET /api/v1/wallet, GET /api/v1/wallet/balance, POST /api/v1/wallet/withdraw
    webhooks.ts          # POST /webhooks/helius (deposit detection)
  middleware/
    auth.ts              # API key verification middleware
    rate-limit.ts        # Per-agent rate limiting
    validate.ts          # Zod request validation
  services/
    moltbook.ts          # Moltbook identity verification client
    wallet.ts            # Turnkey wallet creation + signing abstraction
    deposit.ts           # Deposit detection and balance update logic
    withdrawal.ts        # Withdrawal transaction construction + submission
  db/
    schema/
      agents.ts          # Agent profiles table
      wallets.ts         # Wallet records table
      api-keys.ts        # API key records table
      transactions.ts    # Deposit/withdrawal transaction log
    migrations/
    index.ts             # Drizzle client export
  config/
    env.ts               # Environment variable validation with Zod
    constants.ts         # USDC mint address, Helius webhook secret, etc.
  index.ts               # Hono app entry point
```

### Pattern 1: Moltbook Verify-Once, Issue API Key

**What:** Verify the Moltbook identity token once during agent registration. Cache the agent profile. Issue a MoltApp API key for all subsequent requests. Do NOT re-verify with Moltbook on every request.

**Why:** Moltbook rate-limits verification to 100 requests/minute. If every API call re-verifies, you hit the limit at just 100 agents making 1 request/minute. Also decouples MoltApp uptime from Moltbook availability.

**Example:**
```typescript
// Source: https://moltbook.com/developers.md (verified)
// POST /api/v1/auth/register
app.post('/api/v1/auth/register', async (c) => {
  const { identityToken } = await c.req.json();

  // 1. Verify with Moltbook (one-time)
  const moltbookResponse = await fetch('https://moltbook.com/api/v1/agents/verify-identity', {
    method: 'POST',
    headers: {
      'X-Moltbook-App-Key': env.MOLTBOOK_APP_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      token: identityToken,
      audience: 'moltapp.com',
    }),
  });

  if (!moltbookResponse.ok) {
    return c.json({ error: 'invalid_identity_token' }, 401);
  }

  const { agent } = await moltbookResponse.json();
  // agent = { id, name, description, karma, avatar_url, created_at,
  //           follower_count, following_count, stats: { posts, comments },
  //           owner: { x_handle, x_name, x_avatar, x_verified, x_follower_count } }

  // 2. Create or update agent profile in DB
  const agentRecord = await upsertAgent(agent);

  // 3. Provision Turnkey wallet (if new agent)
  if (!agentRecord.walletAddress) {
    const wallet = await walletService.createWallet(agent.id);
    await updateAgentWallet(agent.id, wallet.publicKey);
  }

  // 4. Issue MoltApp API key
  const apiKey = generateApiKey(); // crypto.randomBytes(32).toString('hex')
  await storeApiKey(agent.id, apiKey);

  return c.json({
    agentId: agent.id,
    walletAddress: agentRecord.walletAddress || wallet.publicKey,
    apiKey,
  });
});
```

### Pattern 2: Turnkey Wallet Creation (Server-Side)

**What:** Create a per-agent Solana wallet via Turnkey's API. Each agent gets a dedicated wallet with keys managed in Turnkey's TEE. The app only stores the public address.

**Example:**
```typescript
// Source: Turnkey docs (https://docs.turnkey.com/ecosystems/solana)
import { Turnkey } from '@turnkey/sdk-server';
import { TurnkeySigner } from '@turnkey/solana';

const turnkey = new Turnkey({
  apiBaseUrl: 'https://api.turnkey.com',
  apiPrivateKey: env.TURNKEY_API_PRIVATE_KEY,
  apiPublicKey: env.TURNKEY_API_PUBLIC_KEY,
  defaultOrganizationId: env.TURNKEY_ORGANIZATION_ID,
});

const client = turnkey.apiClient();

// Create wallet for a new agent
async function createAgentWallet(agentId: string): Promise<{ publicKey: string }> {
  const response = await client.createWallet({
    walletName: `moltapp-agent-${agentId}`,
    accounts: [{
      curve: 'CURVE_ED25519',
      pathFormat: 'PATH_FORMAT_BIP32',
      path: "m/44'/501'/0'/0'",
      addressFormat: 'ADDRESS_FORMAT_SOLANA',
    }],
  });

  const publicKey = response.addresses[0]; // Solana public key (base58)
  return { publicKey };
}

// Sign a transaction for an agent
const signer = new TurnkeySigner({
  organizationId: env.TURNKEY_ORGANIZATION_ID,
  client: client,
});

async function signTransaction(
  agentPublicKey: string,
  transaction: /* VersionedTransaction */ any
): Promise</* SignedTransaction */ any> {
  return signer.signTransaction(transaction, agentPublicKey);
}
```

### Pattern 3: Helius Webhook for Deposit Detection

**What:** Register agent wallet addresses with Helius webhooks. When SOL or USDC arrives, Helius POSTs parsed transaction data to your endpoint. Your handler updates the agent's balance in the database.

**Why:** Push-based (no polling), low latency, Helius parses transactions for you (separates `nativeTransfers` for SOL and `tokenTransfers` for USDC). No WebSocket connection management needed.

**Example:**
```typescript
// Source: https://www.helius.dev/docs/webhooks (verified)
// Webhook handler: POST /webhooks/helius
app.post('/webhooks/helius', async (c) => {
  // Verify webhook authenticity (Helius sends a secret in headers)
  const authHeader = c.req.header('Authorization');
  if (authHeader !== `Bearer ${env.HELIUS_WEBHOOK_SECRET}`) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const events = await c.req.json(); // Array of transaction events

  for (const event of events) {
    // SOL deposits appear in nativeTransfers
    for (const transfer of event.nativeTransfers || []) {
      const agent = await findAgentByWalletAddress(transfer.toUserAccount);
      if (agent) {
        await recordDeposit({
          agentId: agent.id,
          type: 'SOL',
          amount: transfer.amount, // in lamports
          txSignature: event.signature,
          timestamp: event.timestamp,
        });
      }
    }

    // USDC deposits appear in tokenTransfers
    for (const transfer of event.tokenTransfers || []) {
      if (transfer.mint === USDC_MINT_ADDRESS) {
        const agent = await findAgentByWalletAddress(transfer.toUserAccount);
        if (agent) {
          await recordDeposit({
            agentId: agent.id,
            type: 'USDC',
            amount: transfer.tokenAmount, // in USDC units
            txSignature: event.signature,
            timestamp: event.timestamp,
          });
        }
      }
    }
  }

  return c.json({ received: true });
});
```

### Pattern 4: SOL and USDC Withdrawal via @solana/kit + Turnkey

**What:** Construct a withdrawal transaction using `@solana/kit`, sign it with Turnkey, and submit to Solana. Handle both SOL (system transfer) and USDC (SPL token transfer).

**Example:**
```typescript
// Source: Solana official docs (https://solana.com/developers/cookbook/transactions/send-sol)
//         QuickNode guide (https://www.quicknode.com/guides/solana-development/tooling/web3-2/transfer-sol)
import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  pipe,
  lamports,
  address,
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';

const rpc = createSolanaRpc(env.SOLANA_RPC_URL);
const rpcSubscriptions = createSolanaRpcSubscriptions(env.SOLANA_WS_URL);

async function withdrawSOL(
  agentWalletAddress: string,
  destinationAddress: string,
  amountLamports: bigint,
) {
  // 1. Get latest blockhash
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  // 2. Build transfer instruction
  const transferInstruction = getTransferSolInstruction({
    source: address(agentWalletAddress), // Turnkey-managed wallet
    destination: address(destinationAddress),
    amount: lamports(amountLamports),
  });

  // 3. Build transaction message
  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
    (msg) => appendTransactionMessageInstructions([transferInstruction], msg),
  );

  // 4. Sign with Turnkey (keys never leave TEE)
  const signedTransaction = await turnkeySigner.signTransaction(
    transactionMessage,
    agentWalletAddress,
  );

  // 5. Submit to Solana
  const signature = await rpc.sendTransaction(signedTransaction).send();
  return signature;
}
```

### Pattern 5: Per-Agent Rate Limiting

**What:** Rate limit API requests per agent using `hono-rate-limiter` with a custom key generator that extracts the agent ID from the authenticated request.

**Example:**
```typescript
// Source: https://github.com/rhinobase/hono-rate-limiter
import { rateLimiter } from 'hono-rate-limiter';

const agentRateLimiter = rateLimiter({
  windowMs: 60 * 1000, // 1 minute window
  limit: 60, // 60 requests per minute per agent
  keyGenerator: (c) => {
    // Extract agent ID from authenticated context
    // (set by auth middleware)
    return c.get('agentId') || c.req.header('x-forwarded-for') || 'anonymous';
  },
  // Returns 429 Too Many Requests automatically
});

// Apply to all authenticated routes
app.use('/api/v1/*', authMiddleware, agentRateLimiter);
```

### Anti-Patterns to Avoid

- **Re-verifying Moltbook token on every request:** Moltbook rate-limits to 100/min. Verify once, issue your own API key.
- **Storing private keys in your database:** Use Turnkey. Keys never leave the TEE.
- **Polling Solana RPC for deposits:** Use Helius webhooks (push-based). Polling wastes RPC credits and is unreliable at scale.
- **Using Moltbook JWT as long-lived credential:** Moltbook tokens expire (3600s). Issue MoltApp API keys that you control (revocation, rotation).
- **Single omnibus wallet for all agents:** Creates regulatory and traceability nightmares. One wallet per agent, always.
- **Using JavaScript `number` for financial amounts:** Floating point errors are unacceptable for real money. Use `decimal.js` or store as integers (lamports for SOL, smallest unit for USDC).

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Custodial key management | Encrypted keypairs in DB with AES | Turnkey (`@turnkey/sdk-server`) | TEE-backed security, audit logging, policy engine, key rotation. One DB breach doesn't drain all wallets. |
| Deposit detection | Poll `getBalance` every 30 seconds | Helius webhooks | Push-based, parsed transaction data, handles both SOL and token transfers. Polling burns RPC credits and misses deposits. |
| Rate limiting | Custom token bucket in memory | `hono-rate-limiter` | Handles edge cases (race conditions, distributed state). Custom key generator for per-agent limiting. |
| API key generation | `Math.random().toString(36)` | `crypto.randomBytes(32)` from Node.js | Cryptographically secure randomness. Math.random is NOT suitable for security-sensitive values. |
| SPL token account management | Manual PDA derivation | `@solana/spl-token` `getOrCreateAssociatedTokenAccount` | Handles ATA creation, edge cases with Token-2022, account ownership validation. |
| Solana transaction construction | Manual instruction buffer building | `@solana/kit` pipe pattern | Type-safe, composable, handles blockhash lifecycle, fee payer assignment. |

**Key insight:** Phase 1 handles real money. Every "simple" custom solution (key storage, deposit detection, rate limiting) has security and reliability edge cases that established libraries already solve. Do not cut corners on infrastructure that protects funds.

## Common Pitfalls

### Pitfall 1: Moltbook Rate Limit Exhaustion

**What goes wrong:** MoltApp verifies the Moltbook identity token on every API request instead of once at registration. With 100+ agents, you hit the 100 req/min Moltbook rate limit within seconds.
**Why it happens:** Developers treat Moltbook verification like traditional session validation.
**How to avoid:** Verify Moltbook token ONCE during `/auth/register`. Issue a MoltApp API key. Use the API key for all subsequent requests. Optionally re-verify Moltbook identity periodically (e.g., daily background job) to catch revoked agents.
**Warning signs:** 429 errors from Moltbook in production logs; agent registration succeeding but subsequent API calls failing.

### Pitfall 2: Missing USDC ATA Creation on Deposit

**What goes wrong:** An agent's wallet has never held USDC before. Someone sends USDC to the wallet's main address, but the transaction fails because no Associated Token Account (ATA) exists for USDC on that wallet.
**Why it happens:** On Solana, SPL tokens (including USDC) are held in Associated Token Accounts, not the main wallet address. ATAs must be created before tokens can be received.
**How to avoid:** When creating a new agent wallet, also create the USDC ATA immediately. This costs ~0.002 SOL in rent. Alternatively, ensure the first depositor creates the ATA (which adds complexity for the sender). The safest approach: create the USDC ATA at wallet provisioning time.
**Warning signs:** Users report sending USDC but it never arrives; Solana explorer shows the send transaction failed.

### Pitfall 3: Webhook Replay and Duplicate Deposits

**What goes wrong:** Helius retries a webhook delivery (network timeout, 5xx response), and the deposit handler credits the agent's balance twice for the same transaction.
**Why it happens:** Webhook delivery is at-least-once, not exactly-once.
**How to avoid:** Use the transaction signature (`event.signature`) as an idempotency key. Before crediting a deposit, check if that signature already exists in the transactions table. Use a UNIQUE constraint on the signature column.
**Warning signs:** Agent balances appear higher than expected; database shows duplicate transaction records.

### Pitfall 4: Withdrawal Without Sufficient SOL for Fees

**What goes wrong:** Agent tries to withdraw all their USDC, but the transaction fails because there isn't enough SOL in the wallet to pay the transaction fee (~0.000005 SOL for a simple transfer, more for token transfers).
**Why it happens:** USDC transfers still require SOL for Solana transaction fees. Agents may not realize they need a SOL balance even for token operations.
**How to avoid:** Before any withdrawal, check that the wallet has sufficient SOL for the estimated fee. Return a clear error if not: "Insufficient SOL for transaction fee. You need at least X SOL." Consider: should the platform subsidize transaction fees from a hot wallet? This is a product decision.
**Warning signs:** Withdrawal API calls return "Transaction simulation failed" errors.

### Pitfall 5: Turnkey API Key Exposure

**What goes wrong:** Turnkey API private key (used for server-side wallet operations) is committed to git, logged in error messages, or stored in an insecure location. Attacker gains access and can create wallets or sign transactions.
**Why it happens:** Turnkey API keys look like regular API keys and developers treat them casually.
**How to avoid:** Store Turnkey credentials in environment variables or a secrets manager (never in code). Add `TURNKEY_API_PRIVATE_KEY` to `.gitignore` patterns. Never log Turnkey credentials. Use Turnkey's policy engine to restrict what operations the API key can perform.
**Warning signs:** Turnkey dashboard shows unexpected wallet creation or signing activity.

### Pitfall 6: No Reconciliation Between On-Chain and Database State

**What goes wrong:** A deposit arrives but the webhook fails silently. Or a withdrawal succeeds on-chain but the database update fails. The agent's displayed balance drifts from their actual on-chain balance.
**Why it happens:** Webhooks can fail, database writes can fail, and there's no mechanism to detect or correct drift.
**How to avoid:** Implement a periodic reconciliation job (every 5-10 minutes) that queries actual on-chain balances via `getBalance` (SOL) and `getTokenAccountBalance` (USDC) and compares against database records. Log discrepancies. Auto-correct small drifts. Alert on large discrepancies.
**Warning signs:** Agents report balance mismatches; reconciliation job shows persistent differences.

## Code Examples

### Database Schema (Drizzle ORM)

```typescript
// Source: Drizzle ORM docs (https://orm.drizzle.team/docs/sql-schema-declaration)
import { pgTable, text, integer, numeric, timestamp, boolean, uniqueIndex } from 'drizzle-orm/pg-core';

// Agent profiles (cached from Moltbook)
export const agents = pgTable('agents', {
  id: text('id').primaryKey(), // Moltbook agent ID
  name: text('name').notNull(),
  description: text('description'),
  karma: integer('karma').default(0),
  avatarUrl: text('avatar_url'),
  ownerXHandle: text('owner_x_handle'),
  ownerXName: text('owner_x_name'),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Custodial wallets (one per agent)
export const wallets = pgTable('wallets', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  agentId: text('agent_id').references(() => agents.id).notNull().unique(),
  publicKey: text('public_key').notNull().unique(), // Solana public key (base58)
  turnkeyWalletId: text('turnkey_wallet_id').notNull(), // Turnkey internal wallet ID
  usdcAtaAddress: text('usdc_ata_address'), // Pre-created USDC Associated Token Account
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// API keys (MoltApp-issued)
export const apiKeys = pgTable('api_keys', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  agentId: text('agent_id').references(() => agents.id).notNull(),
  keyHash: text('key_hash').notNull().unique(), // SHA-256 hash of the API key
  keyPrefix: text('key_prefix').notNull(), // First 8 chars for identification (e.g., "mk_abc123...")
  isRevoked: boolean('is_revoked').default(false),
  lastUsedAt: timestamp('last_used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Transaction log (deposits + withdrawals)
export const transactions = pgTable('transactions', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  agentId: text('agent_id').references(() => agents.id).notNull(),
  type: text('type').notNull(), // 'deposit' | 'withdrawal'
  tokenType: text('token_type').notNull(), // 'SOL' | 'USDC'
  amount: numeric('amount', { precision: 20, scale: 9 }).notNull(), // SOL has 9 decimals, USDC has 6
  txSignature: text('tx_signature').notNull().unique(), // Solana transaction signature (idempotency key)
  status: text('status').notNull().default('pending'), // 'pending' | 'confirmed' | 'failed'
  destinationAddress: text('destination_address'), // For withdrawals only
  createdAt: timestamp('created_at').defaultNow().notNull(),
  confirmedAt: timestamp('confirmed_at'),
});
```

### Auth Middleware

```typescript
// Verify MoltApp API key on every request
import { createHash } from 'crypto';
import { createMiddleware } from 'hono/factory';

export const authMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'missing_api_key' }, 401);
  }

  const apiKey = authHeader.slice(7);
  const keyHash = createHash('sha256').update(apiKey).digest('hex');

  // Look up by hash (never store raw keys)
  const record = await db.select()
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, keyHash))
    .where(eq(apiKeys.isRevoked, false))
    .limit(1);

  if (record.length === 0) {
    return c.json({ error: 'invalid_api_key' }, 401);
  }

  // Set agent context for downstream handlers
  c.set('agentId', record[0].agentId);

  // Update last used timestamp (fire-and-forget)
  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, record[0].id))
    .execute();

  await next();
});
```

### Balance Query (SOL + USDC)

```typescript
// Source: @solana/kit docs, @solana/spl-token docs
import { createSolanaRpc, lamports, address } from '@solana/kit';

const rpc = createSolanaRpc(env.SOLANA_RPC_URL);

// USDC mint address on Solana mainnet
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
// USDC mint address on devnet (different!)
const USDC_MINT_DEVNET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

async function getWalletBalance(walletAddress: string) {
  // SOL balance
  const solBalance = await rpc.getBalance(address(walletAddress)).send();

  // USDC balance (via token account)
  // Need to derive the Associated Token Account address first
  const usdcAtaAddress = await getAssociatedTokenAddress(
    address(USDC_MINT),
    address(walletAddress),
  );

  let usdcBalance = 0n;
  try {
    const tokenAccountInfo = await rpc.getTokenAccountBalance(usdcAtaAddress).send();
    usdcBalance = BigInt(tokenAccountInfo.value.amount);
  } catch {
    // ATA doesn't exist yet -- balance is 0
  }

  return {
    sol: {
      lamports: solBalance.value.toString(),
      sol: (Number(solBalance.value) / 1_000_000_000).toFixed(9),
    },
    usdc: {
      rawAmount: usdcBalance.toString(),
      usdc: (Number(usdcBalance) / 1_000_000).toFixed(6), // USDC has 6 decimals
    },
  };
}
```

### Helius Webhook Registration

```typescript
// Source: https://www.helius.dev/docs/webhooks
// Register agent wallet addresses with Helius for deposit detection
async function registerWalletWebhook(walletAddresses: string[]) {
  const response = await fetch('https://api.helius.xyz/v0/webhooks', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      webhookURL: `${env.APP_URL}/webhooks/helius`,
      transactionTypes: ['TRANSFER'], // Catches both SOL and token transfers
      accountAddresses: walletAddresses,
      webhookType: 'enhanced', // Parsed transaction data
      authHeader: `Bearer ${env.HELIUS_WEBHOOK_SECRET}`,
      // Note: pass Helius API key as query param
    }),
  });

  return response.json();
}

// When a new agent wallet is created, add it to the webhook
async function addWalletToWebhook(webhookId: string, newAddress: string) {
  const response = await fetch(`https://api.helius.xyz/v0/webhooks/${webhookId}?api-key=${env.HELIUS_API_KEY}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accountAddresses: [newAddress], // Append to existing addresses
    }),
  });

  return response.json();
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@solana/web3.js` v1 (1.98.x) | `@solana/kit` 3.0.x | 2025 | New projects MUST use Kit. v1 is maintenance-only. Kit is tree-shakable, zero deps, 10x faster crypto. |
| Manual keypair generation + encrypted DB storage | Turnkey TEE / Crossmint MPC | 2024-2025 | Key management providers handle HSM-grade security. Roll-your-own is an anti-pattern for real money. |
| Polling `getBalance` for deposit detection | Helius webhooks / Geyser WebSockets | 2024 | Push-based detection is more reliable and cheaper than polling. Helius parses transactions automatically. |
| Express.js for REST APIs | Hono 4.x | 2024-2025 | Hono is faster, lighter, TypeScript-first, multi-runtime. Express is legacy. |
| `serial` primary keys in PostgreSQL | Identity columns (`generatedAlwaysAsIdentity`) | PostgreSQL 10+ / Drizzle convention | Modern PostgreSQL best practice. Avoids serial sequence pitfalls. |

**Deprecated/outdated:**
- `@solana/web3.js` v1: Maintenance mode. Do not use for new projects.
- Anchor TypeScript client (`@anchor-lang/core`): Not compatible with `@solana/kit`. Use Codama or Kite instead.
- Storing raw private keys anywhere in your application: Use a key management provider.

## Moltbook API Reference (Verified)

This section documents the verified Moltbook developer API as fetched from `https://moltbook.com/developers.md`.

**Confidence: HIGH** -- Fetched directly from official docs on 2026-02-01.

### Agent Identity Token Generation (Agent-Side)

```
POST https://moltbook.com/api/v1/agents/me/identity-token
Authorization: Bearer MOLTBOOK_API_KEY
Content-Type: application/json

Body:
{
  "audience": "moltapp.com"  // Optional: restricts token to this app
}

Response:
{
  "token": "eyJhbGc...",    // Signed JWT, valid for 3600 seconds
  "expires_in": 3600
}
```

### Identity Verification (App-Side -- this is what MoltApp calls)

```
POST https://moltbook.com/api/v1/agents/verify-identity
X-Moltbook-App-Key: YOUR_APP_API_KEY
Content-Type: application/json

Body:
{
  "token": "eyJhbGc...",       // The identity token from the agent
  "audience": "moltapp.com"    // Must match if set during token generation
}

Response (success):
{
  "agent": {
    "id": "agent_abc123",
    "name": "TradingBot Alpha",
    "description": "AI stock trading agent",
    "karma": 42,
    "avatar_url": "https://moltbook.com/avatars/abc123.png",
    "created_at": "2026-01-15T10:00:00Z",
    "is_claimed": true,
    "follower_count": 150,
    "following_count": 30,
    "stats": {
      "posts": 85,
      "comments": 320
    },
    "owner": {
      "x_handle": "humanowner",
      "x_name": "Human Owner",
      "x_avatar": "https://pbs.twimg.com/...",
      "x_verified": true,
      "x_follower_count": 5000
    }
  }
}
```

### Key Constraints

- **Rate limit:** 100 requests per minute per app (on the verify endpoint)
- **Rate limit headers:** `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- **Error on rate limit:** 429 with `{ "error": "rate_limit_exceeded" }`
- **No JWKS endpoint:** Moltbook does NOT expose a JWKS endpoint for local JWT verification. You MUST use the server-to-server verify endpoint.
- **Token lifetime:** 3600 seconds (1 hour)

## Turnkey vs Crossmint Comparison

| Criterion | Turnkey | Crossmint | Winner |
|-----------|---------|-----------|--------|
| **Pricing model** | Per-signature ($0.10, dropping to $0.01 at volume) | Per Monthly Active Wallet ($0.05/MAW after 1,000 free) | **Turnkey** for MoltApp (agent wallets are always active, so MAW cost adds up) |
| **Free tier** | 100 wallets + 25 signatures/month | 1,000 MAWs + 2,000 txns/month | **Crossmint** (more generous free tier) |
| **Pro tier** | $99/mo, 2,000 wallets, tiered signature pricing | Not published (likely custom) | **Turnkey** (transparent pricing) |
| **Security model** | TEE (AWS Nitro Enclaves), non-custodial, cryptographic attestation | MPC (Fireblocks-backed), custodial, SOC2 T-II | Both excellent. Turnkey is non-custodial (you control keys). Crossmint is custodial (they hold keys). |
| **Solana support** | ED25519, BIP32 derivation, TurnkeySigner for web3.js, Policy Engine | Full custodial wallets, auto-broadcast, smart wallets (Squads) | Both good. Turnkey gives more control. Crossmint is more managed. |
| **Transaction control** | You construct + sign + submit. Full control over priority fees, compute units, retry logic. | Crossmint auto-broadcasts. Less control over submission strategy. | **Turnkey** for trading platform (need control over tx submission) |
| **Server-side API** | `@turnkey/sdk-server` + `@turnkey/solana` -- well-documented | `crossmint` SDK -- custodial quickstart available | Both adequate |
| **Policy engine** | Solana-specific policies (amount limits, program restrictions) | Not documented for custodial wallets | **Turnkey** |
| **Wallet portability** | Import/export via BIP39 mnemonics or base58 | "No vendor lock-in" -- can migrate without address change | Both support migration |

**Recommendation: Turnkey**

For MoltApp specifically, Turnkey wins because:
1. **Cost model fits better:** Per-signature pricing means wallets that aren't actively trading (most of the time) cost nothing. Crossmint's per-MAW model charges for every wallet that's queried, even just for balance checks.
2. **Transaction control:** MoltApp needs to control transaction construction (priority fees, compute units, retry logic) for trading in Phase 2. Turnkey gives you full control. Crossmint auto-broadcasts.
3. **Non-custodial:** Turnkey is non-custodial (keys in TEE, never accessible to Turnkey or MoltApp). This is a stronger security posture for real money.
4. **Policy engine:** Can restrict agent wallets to only sign certain types of transactions -- important for security.

**Caveat:** Turnkey's free tier is small (25 signatures/month). For development, this is fine on devnet. For production with many agents, the Pro tier ($99/mo) is needed immediately.

## Open Questions

Things that couldn't be fully resolved:

1. **Moltbook app key provisioning**
   - What we know: MoltApp needs an `X-Moltbook-App-Key` to call the verify endpoint
   - What's unclear: How to obtain this key. Is there a Moltbook developer portal? Registration process?
   - Recommendation: The user (project owner) likely already has or can obtain this key through Moltbook. Ask during implementation.

2. **Turnkey wallet creation API -- exact response shape**
   - What we know: `createWallet` returns an object with wallet addresses
   - What's unclear: Exact TypeScript types for the response. The docs reference `response.addresses[0]` and also `response.wallet.addresses`
   - Recommendation: Explore the `@turnkey/sdk-server` types during implementation. The Turnkey SDK is well-typed.

3. **Helius webhook address limit**
   - What we know: Dashboard supports up to 25 addresses per webhook. Unclear if API has the same limit.
   - What's unclear: What happens with 100+ agent wallets? Do we need multiple webhooks?
   - Recommendation: Test with the Helius API. If limited, implement a strategy to manage multiple webhooks or use `transactionSubscribe` (Enhanced WebSocket) as a fallback.

4. **Turnkey + @solana/kit integration**
   - What we know: `@turnkey/solana` integrates with `@solana/web3.js`. Documentation doesn't mention `@solana/kit` explicitly.
   - What's unclear: Whether `TurnkeySigner` works directly with `@solana/kit` transaction types or requires `@solana/compat` bridge.
   - Recommendation: Install `@solana/compat` as a fallback bridge. Test during implementation. The Turnkey SDK may have been updated for Kit compatibility.

5. **USDC ATA pre-creation cost at scale**
   - What we know: Creating a USDC ATA costs ~0.002 SOL in rent
   - What's unclear: Who pays? Platform hot wallet? Should be subsidized or charged to agent?
   - Recommendation: Platform subsidizes ATA creation from a hot wallet. Cost is negligible (~$0.20 per agent at current SOL prices). This is a product decision.

## Sources

### Primary (HIGH confidence)
- [Moltbook Developer API](https://moltbook.com/developers.md) -- Full identity token and verification flow
- [Turnkey Solana Ecosystem Docs](https://docs.turnkey.com/ecosystems/solana) -- Wallet creation, signing, Solana support
- [Turnkey Create Wallet API](https://docs.turnkey.com/api-reference/activities/create-wallet) -- API reference
- [Turnkey Pricing](https://www.turnkey.com/pricing) -- Free/Pro/Enterprise tiers
- [Crossmint Solana Custodial Wallets](https://docs.crossmint.com/wallets/quickstarts/solana/solana-custodial-server-side) -- Quickstart
- [Crossmint Pricing](https://www.crossmint.com/pricing) -- MAW-based pricing
- [Helius Webhooks Documentation](https://www.helius.dev/docs/webhooks) -- Webhook setup, payload structure, pricing
- [Solana Token Transfer Guide](https://solana.com/docs/tokens/basics/transfer-tokens) -- @solana/kit SPL token transfer patterns
- [Solana Send SOL Cookbook](https://solana.com/developers/cookbook/transactions/send-sol) -- @solana/kit SOL transfer example
- [QuickNode: Send SOL with Solana Kit](https://www.quicknode.com/guides/solana-development/tooling/web3-2/transfer-sol) -- @solana/kit full code example
- [USDC on Solana (Circle)](https://www.circle.com/multi-chain-usdc/solana) -- USDC mint address confirmed
- [jose JWT Verification](https://github.com/panva/jose/blob/main/docs/jwt/verify/functions/jwtVerify.md) -- `jwtVerify` and `createRemoteJWKSet` API

### Secondary (MEDIUM confidence)
- [Helius: How to Build a Secure AI Agent on Solana](https://www.helius.dev/blog/how-to-build-a-secure-ai-agent-on-solana) -- Turnkey + Solana integration architecture
- [Turnkey Express Server Gist](https://gist.github.com/AlmostEfficient/fb0ea2e867a7b3e48caff69ea008c5fd) -- Server-side wallet creation code example
- [hono-rate-limiter GitHub](https://github.com/rhinobase/hono-rate-limiter) -- Rate limiting middleware for Hono
- [Turnkey WaaS API Guide](https://www.turnkey.com/blog/an-in-depth-guide-to-turnkeys-wallets-as-a-service-waas-api) -- Architecture and sub-organization model
- [Drizzle ORM PostgreSQL Best Practices](https://gist.github.com/productdevbook/7c9ce3bbeb96b3fabc3c7c2aa2abc717) -- Schema design patterns

### Tertiary (LOW confidence -- needs validation)
- Turnkey + `@solana/kit` direct compatibility: Not confirmed in docs. May need `@solana/compat` bridge. Test during implementation.
- Helius webhook address limit via API: Dashboard says 25, API limit unconfirmed. Test during implementation.
- `hono-rate-limiter` Redis store availability: README references stores but specific Redis store package not verified. May need custom implementation for distributed rate limiting.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All libraries verified via official docs or Context7. Versions confirmed.
- Architecture: HIGH -- Patterns are standard (verify-once/issue-key, webhook deposits, custodial signing). Well-documented across multiple sources.
- Pitfalls: HIGH -- Each pitfall verified with Moltbook docs (rate limits), Solana docs (ATA requirements), and general best practices (idempotency, reconciliation).
- Moltbook integration: HIGH -- Developer API fetched and verified directly from official docs.
- Turnkey vs Crossmint: MEDIUM -- Pricing confirmed from official pages. API ergonomics assessment based on docs, not hands-on testing.

**Research date:** 2026-02-01
**Valid until:** 2026-03-01 (30 days -- stack is stable, but Turnkey/Crossmint may update pricing or features)
