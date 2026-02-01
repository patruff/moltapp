# Phase 02: Trading - Research

**Researched:** 2026-02-01
**Domain:** Jupiter Ultra API integration, xStocks tokenized stock discovery, Solana transaction signing with Turnkey
**Confidence:** HIGH

## Summary

Phase 2 requires integrating three external systems: Jupiter Ultra API for swap execution, Jupiter Price API V3 for stock price discovery, and xStocks (Backed Finance) tokenized stocks as the trading assets. Research confirms that all three systems are production-ready and well-documented. The Jupiter Ultra API handles transaction construction, slippage optimization, priority fees, and transaction landing -- MoltApp only needs to sign the transaction and submit it.

The critical technical challenge is bridging Jupiter's transaction format (which uses legacy `@solana/web3.js` `VersionedTransaction`) with MoltApp's `@solana/kit` codebase and Turnkey signing. Phase 1 already solved this pattern: extract raw message bytes from the transaction, sign with `TurnkeySigner.signMessage()`, and inject the signature back. The same approach works for Jupiter -- deserialize the base64 transaction, extract message bytes, sign with Turnkey, reassemble, and submit to Jupiter's `/execute` endpoint.

xStocks discovery is straightforward: all 76 xStocks mint addresses start with the prefix `Xs` and are Token-2022 tokens under program `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`. Jupiter's `/ultra/v1/search` endpoint can look up tokens by symbol. A curated catalog of known xStocks addresses is more reliable than dynamic discovery for v1.

**Primary recommendation:** Use Jupiter Ultra API with the existing Turnkey `signMessage` pattern from Phase 1. Do NOT use `@solana/web3.js` legacy library. Maintain a curated xStocks catalog with periodic refresh from Jupiter's search API.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Jupiter Ultra API | v1 | Swap execution (quote + execute) | Handles 50%+ Solana DEX volume; manages slippage, priority fees, tx landing |
| Jupiter Price API | V3 | Token price queries | Official Jupiter price source, last-swap pricing, up to 50 tokens per query |
| Jupiter Search API | v1 | Token discovery/metadata | Find xStocks tokens by symbol/mint, returns metadata |
| @solana/kit | ^5.5.1 | Transaction decoding, ATA derivation | Already in project; official Solana SDK successor |
| @turnkey/solana | ^1.1.22 | Transaction signing via `signMessage` | Already in project; Turnkey signer for raw Ed25519 |
| decimal.js | ^10.6.0 | Financial math (token amounts, prices) | Already in project; prevents floating point errors |
| drizzle-orm | ^0.45.1 | Database schema (positions, trades tables) | Already in project; SQL-transparent ORM |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @solana/web3.js | 1.x (AVOID) | Legacy Solana SDK | Do NOT add -- use @solana/kit + raw byte manipulation instead |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Jupiter Ultra API | Jupiter Swap/Metis API | Swap API allows custom instructions + CPI but requires managing your own RPC, priority fees, and tx submission. Ultra handles all of this. Use Ultra unless you need to modify the transaction. |
| Curated xStocks catalog | Dynamic Jupiter discovery | Dynamic discovery could miss new tokens or include non-xStocks; curated list is deterministic and reliable. Can add refresh mechanism later. |
| Jupiter Price API V3 | Pyth Network oracle | Pyth gives sub-second prices but requires on-chain integration. Jupiter Price V3 is HTTP-based, simpler for v1. Pyth deferred to Phase 4. |

### No New Dependencies Required

All needed libraries are already in `package.json`. Jupiter Ultra API and Price API are HTTP-only integrations (plain `fetch` calls). No new npm packages needed.

## Architecture Patterns

### Recommended Project Structure

```
src/
  config/
    constants.ts        # Add JUPITER_API_BASE_URL, TOKEN_2022_PROGRAM_ADDRESS, xStocks catalog
  db/
    schema/
      positions.ts      # NEW: positions table
      trades.ts         # NEW: trades table (rename from transactions overlap)
      index.ts          # Re-export new schemas
  services/
    jupiter.ts          # NEW: Jupiter Ultra API client (quote, execute, price, search)
    trading.ts          # NEW: Trade execution orchestrator (validate -> quote -> sign -> execute -> record)
    stocks.ts           # NEW: xStocks catalog + price lookup
  routes/
    trading.ts          # NEW: POST /api/v1/trading/buy, POST /api/v1/trading/sell
    stocks.ts           # NEW: GET /api/v1/stocks, GET /api/v1/stocks/:symbol
    positions.ts        # NEW: GET /api/v1/positions
    trades.ts           # NEW: GET /api/v1/trades
```

### Pattern 1: Jupiter Ultra API Integration Flow

**What:** Two-step swap: GET order (unsigned tx) then POST execute (signed tx)
**When to use:** Every stock buy/sell operation

```typescript
// Source: https://dev.jup.ag/docs/ultra-api/execute-order (verified 2026-02-01)

// Step 1: Get order (quote + unsigned transaction)
const orderResponse = await fetch(
  `https://api.jup.ag/ultra/v1/order?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&taker=${walletAddress}`,
  { headers: { 'x-api-key': env.JUPITER_API_KEY } }
);
const order = await orderResponse.json();
// order.transaction = base64 encoded unsigned transaction
// order.requestId = identifier for execute endpoint

// Step 2: Deserialize, sign, re-encode
// CRITICAL: Jupiter says "you cannot modify Ultra Swap transactions"
// We only sign -- no modifications allowed
const txBytes = Buffer.from(order.transaction, 'base64');

// Extract message bytes for Turnkey signing (same pattern as Phase 1 withdrawal)
// VersionedTransaction wire format: [signatures_count, ...signatures, message_bytes]
// We need the message_bytes portion to sign with Turnkey

// Step 3: Submit signed transaction to Jupiter
const executeResponse = await fetch('https://api.jup.ag/ultra/v1/execute', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': env.JUPITER_API_KEY,
  },
  body: JSON.stringify({
    signedTransaction: signedBase64,
    requestId: order.requestId,
  }),
});
const result = await executeResponse.json();
// result.status === "Success" means swap confirmed
// result.signature = on-chain tx signature
```

### Pattern 2: Transaction Signing with Turnkey (Bridging Jupiter + @solana/kit)

**What:** Sign a Jupiter-provided base64 transaction using Turnkey's `signMessage` without importing `@solana/web3.js`
**When to use:** Every trade execution

**Critical insight:** The existing Phase 1 codebase already uses `TurnkeySigner.signMessage()` on raw message bytes (see `src/services/withdrawal.ts` line 93-98). Jupiter provides a full serialized transaction (not just message bytes), so we need to parse the wire format to extract the message bytes.

```typescript
// Source: Solana wire format specification + Phase 1 withdrawal.ts pattern

// Solana VersionedTransaction wire format:
// [compact_array_length(num_signatures), ...signatures(64 bytes each), ...message_bytes]
// For an unsigned tx from Jupiter, signatures are 64 zero bytes per signer

function extractMessageBytes(txBytes: Uint8Array): {
  messageBytes: Uint8Array;
  signerCount: number;
  signatureOffset: number;
} {
  // First byte(s) = compact-u16 encoding of number of signers
  // For most Jupiter txs this is 1 (the taker/fee payer)
  let offset = 0;
  let signerCount = txBytes[offset];
  offset += 1; // compact-u16: if < 128, it's just one byte

  // Skip past the signature placeholders (64 bytes each)
  const signatureOffset = offset;
  offset += signerCount * 64;

  // Everything after signatures is the message bytes
  const messageBytes = txBytes.slice(offset);
  return { messageBytes, signerCount, signatureOffset };
}

// Sign with Turnkey (same as Phase 1)
const turnkeySigner = getTurnkeySigner();
const signature = await turnkeySigner.signMessage(
  messageBytes,
  walletAddress
);

// Reassemble: replace the first signature placeholder with real signature
const signedTx = new Uint8Array(txBytes);
signedTx.set(signature, signatureOffset);
const signedBase64 = Buffer.from(signedTx).toString('base64');
```

**Alternative approach (simpler, verified to work):** Use `@solana/kit`'s `getTransactionDecoder()` to decode the wire format properly, avoiding manual byte parsing:

```typescript
import { getTransactionDecoder, getTransactionEncoder } from '@solana/kit';

// Decode Jupiter's base64 transaction
const txBytes = Buffer.from(order.transaction, 'base64');
const decoder = getTransactionDecoder();
const decoded = decoder.decode(txBytes);

// decoded.messageBytes contains the message to sign
// decoded.signatures is a map of address -> signature (null for unsigned)

// Sign the message bytes with Turnkey
const signature = await turnkeySigner.signMessage(
  new Uint8Array(decoded.messageBytes),
  walletAddress
);

// Inject signature and re-encode
const encoder = getTransactionEncoder();
const signedTx = {
  messageBytes: decoded.messageBytes,
  signatures: { ...decoded.signatures, [walletAddress]: signature },
};
const signedBase64 = Buffer.from(encoder.encode(signedTx)).toString('base64');
```

### Pattern 3: xStocks Token Catalog

**What:** Curated catalog of xStocks mint addresses with Jupiter search API fallback
**When to use:** Stock listing endpoints and trade validation

```typescript
// Source: https://xstocks.com/products (verified 2026-02-01)
// All xStocks addresses start with "Xs" prefix

interface StockToken {
  symbol: string;       // e.g., "AAPLx"
  name: string;         // e.g., "Apple"
  mintAddress: string;  // Solana mint address
  decimals: number;     // Token decimals (need to verify per-token)
}

const XSTOCKS_CATALOG: StockToken[] = [
  { symbol: 'AAPLx', name: 'Apple', mintAddress: 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp', decimals: 9 },
  { symbol: 'NVDAx', name: 'NVIDIA', mintAddress: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh', decimals: 9 },
  { symbol: 'TSLAx', name: 'Tesla', mintAddress: 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB', decimals: 9 },
  // ... 73 more tokens from xstocks.com/products
];

// Note: Token decimals MUST be verified on-chain before first use.
// Jupiter /order endpoint expects amount in raw token units (pre-decimals).
```

### Pattern 4: Buy/Sell Trade Flow

**What:** Complete synchronous trade execution
**When to use:** POST /api/v1/trading/buy and POST /api/v1/trading/sell

```
Agent Request (buy AAPLx for 100 USDC)
  |
  v
1. Validate: agent exists, has wallet, stock is in catalog
  |
  v
2. Balance check: agent has >= 100 USDC + SOL for fees
  |
  v
3. Jupiter /order: inputMint=USDC, outputMint=AAPLx, amount=100000000 (100 USDC in 6-decimal units)
  |
  v
4. Sign transaction with Turnkey (extract messageBytes, signMessage)
  |
  v
5. Jupiter /execute: submit signedTransaction + requestId
  |
  v
6. If status === "Success":
   - Record trade in trades table
   - Update positions table (upsert: add quantity, recalculate avg cost basis)
   - Return success with trade details
  |
  v
7. If failed: return error with Jupiter error code translation
```

### Pattern 5: Price Lookup with Jupiter Price API V3

```typescript
// Source: https://dev.jup.ag/docs/price/v3 (verified 2026-02-01)
// Endpoint: GET https://api.jup.ag/price/v3?ids={comma-separated-mints}
// Max 50 mints per request
// Requires x-api-key header

const mintAddresses = stocks.map(s => s.mintAddress).join(',');
const priceResponse = await fetch(
  `https://api.jup.ag/price/v3?ids=${mintAddresses}`,
  { headers: { 'x-api-key': env.JUPITER_API_KEY } }
);
const prices = await priceResponse.json();
// prices[mintAddress] = { usdPrice: number, blockId: string, decimals: number, priceChange24h: number }
// Note: some tokens may return null if no recent trades (7+ days inactive)
```

### Anti-Patterns to Avoid

- **Modifying Jupiter Ultra transactions:** Jupiter explicitly prohibits this. The tx must be signed as-is. If you need custom instructions, use the Swap/Metis API instead.
- **Using `@solana/web3.js` alongside `@solana/kit`:** Phase 1 established `@solana/kit` as the SDK. Do not add legacy `web3.js` -- use the raw byte signing pattern already proven in Phase 1.
- **Building your own DEX routing:** Jupiter aggregates 20+ DEXs with optimal routing. Never hand-roll swap logic.
- **Using Price API V2 or `lite-api.jup.ag`:** Deprecated as of January 31, 2026. Use `api.jup.ag` with API key.
- **Dynamic xStocks discovery without validation:** Jupiter search returns all tokens, including unverified ones. Always validate against the known xStocks catalog.
- **Floating-point math for token amounts:** Always use `decimal.js` and `BigInt` for token amounts. USDC has 6 decimals, SOL has 9, xStocks tokens need verification.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| DEX routing/aggregation | Custom AMM integration | Jupiter Ultra API | Jupiter aggregates 20+ DEXs, handles optimal routing, slippage, priority fees |
| Transaction landing | Custom retry logic | Jupiter Ultra `/execute` | Jupiter's ShadowLane engine handles broadcasting, retries, priority fee optimization |
| Slippage protection | Manual slippage calculation | Jupiter RTSE (Real-Time Slippage Estimator) | Ultra automatically optimizes slippage per trade |
| Priority fee estimation | Custom fee calculation | Jupiter Ultra (automatic) | Ultra handles priority fees and Jito tips automatically |
| Transaction confirmation | Custom polling/websocket logic | Jupiter `/execute` response | Execute endpoint returns final status (Success/failure); poll by resubmitting same params for up to 2 minutes |
| Token price feeds | Custom oracle integration | Jupiter Price API V3 | HTTP-based, last-swap pricing, handles 50 tokens per request |
| xStocks token validation | Custom on-chain token parsing | Curated catalog + Jupiter search | xStocks products page provides canonical list; Jupiter search validates tradability |

**Key insight:** Jupiter Ultra API is specifically designed to be an all-in-one solution. It handles the transaction construction, slippage, priority fees, transaction landing, and confirmation. MoltApp's only responsibility is: validate the trade request, sign the transaction, and record the result.

## Common Pitfalls

### Pitfall 1: Deprecated Jupiter API Endpoints
**What goes wrong:** Using `lite-api.jup.ag` or Price API V2 endpoints that were deprecated January 31, 2026.
**Why it happens:** Many tutorials and examples still reference old endpoints.
**How to avoid:** Use `https://api.jup.ag` as the base URL for ALL Jupiter APIs. Always include `x-api-key` header. Use Price API V3 (`/price/v3`), not V2.
**Warning signs:** 401 Unauthorized errors, empty responses, timeouts.

### Pitfall 2: Token-2022 ATA Derivation Uses Different Program ID
**What goes wrong:** Deriving xStocks token ATAs using the standard SPL Token program ID, getting wrong addresses.
**Why it happens:** xStocks are Token-2022 tokens. The ATA PDA derivation includes the token program ID as a seed. Token-2022 program (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`) produces different ATAs than SPL Token program (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`).
**How to avoid:** When deriving ATAs for xStocks tokens, use the Token-2022 program ID in the seed. Jupiter Ultra handles this internally for swap transactions, but position tracking code that reads token account balances must use the correct program ID.
**Warning signs:** `getTokenAccountsByOwner` returns empty results for known holdings.

```typescript
// WRONG: Using SPL Token program for xStocks ATA
const [wrongAta] = await getProgramDerivedAddress({
  programAddress: address(ATA_PROGRAM_ADDRESS),
  seeds: [ownerBytes, encoder.encode(address(TOKEN_PROGRAM_ADDRESS)), mintBytes],
});

// CORRECT: Using Token-2022 program for xStocks ATA
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const [correctAta] = await getProgramDerivedAddress({
  programAddress: address(ATA_PROGRAM_ADDRESS),
  seeds: [ownerBytes, encoder.encode(address(TOKEN_2022_PROGRAM)), mintBytes],
});
```

### Pitfall 3: Jupiter Order Expiration
**What goes wrong:** Getting a quote, taking too long to sign, then submitting an expired transaction.
**Why it happens:** Jupiter orders have a limited validity window. If signing takes too long (e.g., Turnkey latency spike), the order expires.
**How to avoid:** Sign immediately after receiving the order. If execute returns error code -1 (cached order expired), re-fetch a fresh order and retry. The execute endpoint allows polling with the same params for up to 2 minutes.
**Warning signs:** Execute error code -1 or -1005 (transaction expired).

### Pitfall 4: Insufficient SOL for Transaction Fees
**What goes wrong:** Agent has USDC but not enough SOL to pay for the swap transaction fee.
**Why it happens:** Even with Jupiter's gasless support, gasless only activates when the agent has <0.01 SOL AND the trade is >=$10. If the agent has some SOL but not enough, the transaction fails.
**How to avoid:** Check SOL balance before executing trade. Require minimum SOL balance (e.g., 0.01 SOL). Jupiter's gasless feature may cover this for qualifying trades, but don't rely on it.
**Warning signs:** Jupiter order response error code 2 ("top up SOL for gas").

### Pitfall 5: Mixing Up Token Decimals
**What goes wrong:** Sending wrong amount to Jupiter because of decimal mismatch. USDC has 6 decimals, SOL has 9, xStocks decimals vary.
**Why it happens:** Jupiter `/order` expects `amount` in raw token units (smallest denomination).
**How to avoid:** Always convert using the correct decimal count. Use `decimal.js` for all conversions. Verify xStocks token decimals on-chain before hardcoding.
**Warning signs:** Absurdly large or small trade amounts, unexpected slippage.

### Pitfall 6: Not Handling Jupiter Execute Polling
**What goes wrong:** Assuming the first `/execute` response is final and missing successful transactions.
**Why it happens:** Network latency can cause the execute response to timeout before Jupiter confirms the transaction.
**How to avoid:** If the execute response doesn't indicate final status, resubmit the same `signedTransaction` + `requestId` to poll. Safe to do for up to 2 minutes -- same signature prevents double execution.
**Warning signs:** Transactions that succeed on-chain but appear as failed in the app.

### Pitfall 7: Jupiter Rate Limits on Order Endpoint
**What goes wrong:** Getting 429 rate limited during high-volume trading.
**Why it happens:** Jupiter Ultra has dynamic rate limits starting at 50 requests per 10-second window. Rate limits scale with executed swap volume over 24 hours.
**How to avoid:** Implement exponential backoff on 429 responses. Since MoltApp's per-agent rate limit is 60 req/min, and not all requests are trade requests, this is unlikely to hit Jupiter limits in early stages. Monitor and upgrade if needed.
**Warning signs:** HTTP 429 responses from Jupiter.

## Code Examples

### Complete Buy Trade Example

```typescript
// Source: Jupiter Ultra API docs + Phase 1 Turnkey signing pattern

import { Decimal } from 'decimal.js';

interface TradeRequest {
  agentId: string;
  walletAddress: string;
  stockSymbol: string;     // e.g., "AAPLx"
  usdcAmount: string;      // e.g., "100.00" in USDC
  side: 'buy' | 'sell';
}

interface TradeResult {
  txSignature: string;
  status: 'confirmed' | 'failed';
  stockSymbol: string;
  stockQuantity: string;   // tokens received/sold
  usdcAmount: string;      // USDC spent/received
  pricePerToken: string;   // USDC per token
}

async function executeBuyTrade(req: TradeRequest): Promise<TradeResult> {
  const stock = XSTOCKS_CATALOG.find(s => s.symbol === req.stockSymbol);
  if (!stock) throw new Error('stock_not_found');

  const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const usdcRawAmount = new Decimal(req.usdcAmount).mul(1e6).toFixed(0);

  // 1. Get Jupiter order
  const orderUrl = new URL('https://api.jup.ag/ultra/v1/order');
  orderUrl.searchParams.set('inputMint', USDC_MINT);
  orderUrl.searchParams.set('outputMint', stock.mintAddress);
  orderUrl.searchParams.set('amount', usdcRawAmount);
  orderUrl.searchParams.set('taker', req.walletAddress);

  const orderRes = await fetch(orderUrl.toString(), {
    headers: { 'x-api-key': env.JUPITER_API_KEY },
  });
  const order = await orderRes.json();

  if (!order.transaction) {
    throw new Error(`jupiter_order_failed: ${JSON.stringify(order)}`);
  }

  // 2. Sign transaction (using Phase 1 pattern)
  const signedBase64 = await signJupiterTransaction(
    order.transaction,
    req.walletAddress,
  );

  // 3. Execute via Jupiter
  const executeRes = await fetch('https://api.jup.ag/ultra/v1/execute', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.JUPITER_API_KEY,
    },
    body: JSON.stringify({
      signedTransaction: signedBase64,
      requestId: order.requestId,
    }),
  });
  const result = await executeRes.json();

  if (result.status !== 'Success') {
    throw new Error(`jupiter_execute_failed: code=${result.code} ${JSON.stringify(result)}`);
  }

  // 4. Calculate trade details from result
  const stockQuantity = new Decimal(result.outputAmountResult || order.outAmount)
    .div(new Decimal(10).pow(stock.decimals));
  const usdcSpent = new Decimal(req.usdcAmount);
  const pricePerToken = usdcSpent.div(stockQuantity);

  return {
    txSignature: result.signature,
    status: 'confirmed',
    stockSymbol: req.stockSymbol,
    stockQuantity: stockQuantity.toFixed(stock.decimals),
    usdcAmount: usdcSpent.toFixed(6),
    pricePerToken: pricePerToken.toFixed(6),
  };
}
```

### Jupiter Transaction Signing with Turnkey

```typescript
// Bridging Jupiter base64 transaction with Turnkey signMessage
// Avoids importing @solana/web3.js -- uses raw byte manipulation like Phase 1

import { getTurnkeySigner } from './wallet.ts';

async function signJupiterTransaction(
  base64Transaction: string,
  walletAddress: string,
): Promise<string> {
  const txBytes = new Uint8Array(
    Buffer.from(base64Transaction, 'base64')
  );

  // Parse Solana wire format to extract message bytes
  // Wire format: [compact_u16(num_sigs), sig0(64 bytes), sig1(64 bytes)..., message_bytes...]
  let offset = 0;
  const numSignatures = txBytes[offset]; // compact-u16, usually 1 byte for < 128 signers
  offset += 1;

  const signaturesStart = offset;
  offset += numSignatures * 64; // skip signature placeholders

  const messageBytes = txBytes.slice(offset);

  // Sign message bytes with Turnkey (same as Phase 1 withdrawal pattern)
  const turnkeySigner = getTurnkeySigner();
  const signature = await turnkeySigner.signMessage(
    new Uint8Array(messageBytes),
    walletAddress,
  );

  // Inject real signature into first signature slot
  const signedTx = new Uint8Array(txBytes);
  signedTx.set(signature, signaturesStart);

  return Buffer.from(signedTx).toString('base64');
}
```

### Database Schema: Positions Table

```typescript
// Follows Phase 1 patterns: generatedAlwaysAsIdentity, FK to agents, numeric for amounts
import { pgTable, text, integer, numeric, timestamp, unique } from 'drizzle-orm/pg-core';
import { agents } from './agents.ts';

export const positions = pgTable('positions', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  agentId: text('agent_id').references(() => agents.id).notNull(),
  mintAddress: text('mint_address').notNull(),
  symbol: text('symbol').notNull(),
  quantity: numeric('quantity', { precision: 20, scale: 9 }).notNull(),
  averageCostBasis: numeric('average_cost_basis', { precision: 20, scale: 6 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  uniqueAgentMint: unique().on(table.agentId, table.mintAddress),
}));
```

### Database Schema: Trades Table

```typescript
import { pgTable, text, integer, numeric, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { agents } from './agents.ts';

export const trades = pgTable('trades', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  agentId: text('agent_id').references(() => agents.id).notNull(),
  side: text('side').notNull(), // 'buy' | 'sell'
  stockMintAddress: text('stock_mint_address').notNull(),
  stockSymbol: text('stock_symbol').notNull(),
  stockQuantity: numeric('stock_quantity', { precision: 20, scale: 9 }).notNull(),
  usdcAmount: numeric('usdc_amount', { precision: 20, scale: 6 }).notNull(),
  pricePerToken: numeric('price_per_token', { precision: 20, scale: 6 }).notNull(),
  txSignature: text('tx_signature').notNull().unique(),
  jupiterRouteInfo: jsonb('jupiter_route_info'),
  status: text('status').notNull().default('confirmed'), // 'confirmed' | 'failed'
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `lite-api.jup.ag` (no API key) | `api.jup.ag` with `x-api-key` header | Jan 31, 2026 | Must use `api.jup.ag`; get free key from `portal.jup.ag` |
| Jupiter Price API V2 | Jupiter Price API V3 (`/price/v3`) | Jan 2026 | V3 uses last-swap pricing; query up to 50 mints |
| Jupiter Quote + Swap API V6 | Jupiter Ultra API V1 | 2025 | Ultra is all-in-one: quote, execute, tx landing, slippage, priority fees |
| `@solana/web3.js` 1.x | `@solana/kit` 5.x | 2025 | Kit is official successor; Phase 1 already uses it |
| Token Program (SPL) | Token-2022 (Token Extensions) | 2024 | xStocks use Token-2022 with Transfer Hooks; different ATA derivation |

**Deprecated/outdated:**
- `https://lite-api.jup.ag/*` -- deprecated Jan 31, 2026, use `api.jup.ag`
- `https://quote-api.jup.ag/v6/*` -- deprecated, use Ultra API
- `https://price.jup.ag` -- deprecated, use Price API V3
- `https://tokens.jup.ag` -- deprecated, use Tokens API V2

## Jupiter Ultra API Reference

### Endpoints

| Endpoint | Method | Purpose | Latency |
|----------|--------|---------|---------|
| `/ultra/v1/order` | GET | Get quote + unsigned transaction | ~300ms |
| `/ultra/v1/execute` | POST | Submit signed tx, get result | 700ms-2s |
| `/ultra/v1/search` | GET | Find tokens by symbol/name/mint | ~15ms |
| `/ultra/v1/holdings/{address}` | GET | Token balances for wallet | ~70ms |
| `/ultra/v1/shield` | GET | Token security info | ~150ms |
| `/price/v3` | GET | Token USD prices (up to 50) | N/A |

### Authentication

All endpoints require `x-api-key` header. Free key from `portal.jup.ag`.

### Rate Limits

Dynamic rate limits based on 24-hour executed swap volume:

| 24h Volume | Requests per 10-second window |
|------------|-------------------------------|
| $0 | 50 |
| $10,000 | 51 |
| $100,000 | 61 |
| $1,000,000 | 165 |

Recalculated every 10 minutes. Pro plan does NOT increase Ultra rate limits.

### Order Response Fields

- `transaction`: base64 encoded unsigned transaction (sign this, do not modify)
- `requestId`: use with `/execute`
- `swapType`: "aggregator" or "rfq"
- `slippageBps`: auto-optimized slippage

### Execute Response Fields

- `status`: "Success" or failure
- `signature`: on-chain transaction signature
- `code`: error code (0 = success, negative = failure)
- `slot`: Solana slot of confirmation
- `inputAmountResult`: actual input amount
- `outputAmountResult`: actual output amount
- `swapEvents`: detailed swap event data

### Execute Error Codes

| Code | Meaning | Action |
|------|---------|--------|
| 0 | Success | Trade confirmed |
| -1 | Cached order expired | Re-fetch order and retry |
| -2 | Failed to decode signed transaction | Check signing logic |
| -3 | Message bytes invalid (transaction modified) | Do not modify Ultra transactions |
| -1000 | Transaction failed network submission | Retry with new order |
| -1005 | Transaction expired before confirmation | Retry with new order |
| -1006 | Submission timeout | Poll with same params |

### Jupiter Fees

Jupiter takes 5-10 basis points (0.05-0.10%) per swap automatically. No additional fees unless integrator adds referral fees.

## xStocks Token Reference

### Known Mint Addresses (76 tokens from xstocks.com/products, verified 2026-02-01)

Top-traded xStocks for initial catalog:

| Symbol | Name | Mint Address |
|--------|------|-------------|
| AAPLx | Apple | `XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp` |
| AMZNx | Amazon | `Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg` |
| GOOGLx | Alphabet | `XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN` |
| METAx | Meta | `Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu` |
| MSFTx | Microsoft | `XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX` |
| NVDAx | NVIDIA | `Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh` |
| TSLAx | Tesla | `XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB` |
| SPYx | S&P 500 | `XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W` |
| QQQx | Nasdaq 100 | `Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ` |
| COINx | Coinbase | `Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu` |
| CRCLx | Circle | `XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1` |
| MSTRx | MicroStrategy | `XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ` |
| AVGOx | Broadcom | `XsgSaSvNSqLTtFuyWPBhK9196Xb9Bbdyjj4fH3cPJGo` |
| JPMx | JPMorgan Chase | `XsMAqkcKsUewDrzVkait4e5u4y8REgtyS7jWgCpLV2C` |
| HOODx | Robinhood | `XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg` |
| LLYx | Eli Lilly | `Xsnuv4omNoHozR6EEW5mXkw8Nrny5rB3jVfLqi6gKMH` |
| CRMx | Salesforce | `XsczbcQ3zfcgAEt9qHQES8pxKAVG5rujPSHQEXi4kaN` |
| NFLXx | Netflix | `XsEH7wWfJJu2ZT3UCFeVfALnVA6CP5ur7Ee11KmzVpL` |
| PLTRx | Palantir | `XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4` |
| GMEx | GameStop | `Xsf9mBktVB9BSU5kf4nHxPq5hCBJ2j2ui3ecFGxPRGc` |

Full list: 76 tokens at https://xstocks.com/products

### xStocks Technical Details

- **Token standard:** Token-2022 (Token Extensions) program `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`
- **Transfer Hooks:** Enabled for compliance enforcement
- **Mint address pattern:** All start with `Xs` prefix
- **Ticker pattern:** Stock ticker + `x` suffix (e.g., AAPL -> AAPLx)
- **Backing:** 1:1 backed by real shares held in custody (Swiss regulatory oversight)
- **Issuer:** Backed Assets (JE) Limited (Jersey-based SPV)
- **Dividends:** Automatically reinvested into token balances
- **Oracle:** Chainlink xStocks Data Streams for on-chain price accuracy

### Transfer Hook Implications

Jupiter Ultra API handles Transfer Hook routing transparently. When Jupiter routes a swap involving xStocks, it ensures the transaction satisfies Transfer Hook requirements. If a Transfer Hook rejects the transfer, the Jupiter execute response will return a failure code. MoltApp does NOT need to interact with Transfer Hooks directly -- Jupiter handles this.

**Risk:** If a specific agent wallet address is not whitelisted by the xStocks Transfer Hook program, swaps will fail. This needs testing on devnet/mainnet. The Turnkey cookbook for Jupiter demonstrates successful swaps, suggesting standard wallets work.

## Token-2022 Position Tracking

### Reading xStocks Balances

To read an agent's xStocks token balances for position verification:

```typescript
// Must use Token-2022 program ID to find xStocks token accounts
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

// Option 1: Query all Token-2022 accounts for the wallet
// RPC: getTokenAccountsByOwner with programId filter
const response = await rpc.getTokenAccountsByOwner(
  address(walletAddress),
  { programId: address(TOKEN_2022_PROGRAM) },
  { encoding: 'jsonParsed' }
).send();

// Option 2: Query specific xStocks token balance
// Derive ATA with Token-2022 program ID (NOT standard SPL Token program)
const encoder = getAddressEncoder();
const [ata] = await getProgramDerivedAddress({
  programAddress: address(ATA_PROGRAM_ADDRESS),
  seeds: [
    encoder.encode(address(walletAddress)),
    encoder.encode(address(TOKEN_2022_PROGRAM)),  // <-- Token-2022, NOT Token program
    encoder.encode(address(stockMintAddress)),
  ],
});
const balance = await rpc.getTokenAccountBalance(address(ata)).send();
```

## New Environment Variables Needed

```
JUPITER_API_KEY=<free key from portal.jup.ag>
```

This is the only new env var. All other infrastructure (Turnkey, Solana RPC, Helius, DB) is already configured from Phase 1.

## Open Questions

1. **xStocks token decimals**
   - What we know: xStocks are Token-2022 tokens. USDC is 6 decimals, SOL is 9.
   - What's unclear: The exact decimal count for each xStocks token. Likely 9 (standard Solana SPL) but must be verified on-chain.
   - Recommendation: Query `getMint` on-chain for each token in the catalog at startup to get authoritative decimal counts. Cache the results.

2. **Transfer Hook whitelisting**
   - What we know: xStocks use Transfer Hooks for compliance. Jupiter handles this transparently for swaps.
   - What's unclear: Whether agent wallets created by Turnkey are automatically compatible with xStocks Transfer Hooks, or if there's a whitelisting step.
   - Recommendation: Test a small swap on mainnet (or devnet if xStocks has devnet deployment) early in development. If Transfer Hooks reject the transaction, investigate whitelisting with Backed Finance.

3. **Jupiter Ultra API response for Token-2022 swaps**
   - What we know: Jupiter Ultra V3 explicitly expanded Token-2022 support. The standard execute response includes `status`, `signature`, `inputAmountResult`, `outputAmountResult`.
   - What's unclear: Whether Token-2022 swaps return any additional fields or behave differently in the response.
   - Recommendation: Test with a real xStocks swap and verify the response format matches documentation.

4. **Sell-side flow: xStocks to USDC**
   - What we know: Jupiter handles routing in both directions. For selling, inputMint = xStocks token, outputMint = USDC.
   - What's unclear: Whether selling xStocks requires the agent to have a pre-existing ATA for the xStocks token (Jupiter may create it during buy, but the ATA derivation must use Token-2022 program ID).
   - Recommendation: The buy trade creates the ATA via Jupiter's transaction. For sell, the agent already has tokens in the ATA. Jupiter's order should handle the reverse routing. Test both directions.

## Sources

### Primary (HIGH confidence)
- [Jupiter Ultra API - Official Docs](https://dev.jup.ag/docs/ultra) - All endpoints, flow, rate limits
- [Jupiter Ultra Execute Order](https://dev.jup.ag/docs/ultra-api/execute-order) - Complete signing + execution example
- [Jupiter Ultra Rate Limits](https://dev.jup.ag/docs/ultra/rate-limit) - Dynamic rate limit tiers
- [Jupiter Ultra Response Codes](https://dev.jup.ag/docs/ultra/response) - Complete error code reference
- [Jupiter Price API V3](https://dev.jup.ag/docs/price/v3) - Current price endpoint
- [Jupiter Migrate from Lite API](https://dev.jup.ag/portal/migrate-from-lite-api) - Deprecation details
- [xStocks Products Page](https://xstocks.com/products) - Complete token catalog with mint addresses
- [Turnkey + Jupiter Cookbook](https://docs.turnkey.com/cookbook/jupiter) - Official Turnkey Jupiter integration
- [Turnkey Solana Signing](https://docs.turnkey.com/networks/solana) - signMessage and signTransaction approaches
- [Solana getTokenAccountsByOwner](https://solana.com/docs/rpc/http/gettokenaccountsbyowner) - Token-2022 filter by programId
- [Solana Token-2022 ATA Derivation](https://solana.com/developers/courses/token-extensions/token-extensions-in-the-client) - Different program ID in seeds

### Secondary (MEDIUM confidence)
- [Solana xStocks Case Study](https://solana.com/news/case-study-xstocks) - xStocks ecosystem overview, market share
- [Jupiter Ultra V3 Launch (The Block)](https://www.theblock.co/press-releases/375289/jupiter-launches-ultra-v3-the-ultimate-trading-engine-for-solana) - Token-2022 gasless support confirmation
- [QuickNode xStocks Developer Guide](https://blog.quicknode.com/xstocks-solana-tokenized-stocks-2025/) - xStocks technical details
- [Helius: Solana Commitment Levels](https://www.helius.dev/blog/solana-commitment-levels) - Transaction confirmation timing
- [Panda Academy xStocks Mint Addresses](https://academy.pandatool.org/en_US/question/1491) - Cross-reference for mint addresses

### Tertiary (LOW confidence)
- xStocks token decimals: assumed 9 based on standard Solana convention; needs on-chain verification
- Transfer Hook whitelisting: assumed Jupiter handles transparently based on documentation language; needs testing

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Jupiter Ultra API is well-documented; all libraries already in project
- Architecture: HIGH - Phase 1 patterns (Turnkey signing, Hono routes, Drizzle schema) directly apply; Jupiter flow is two HTTP calls
- Pitfalls: HIGH - Deprecation dates verified, Token-2022 ATA derivation confirmed in official Solana docs
- xStocks catalog: HIGH - Mint addresses from official xstocks.com/products page
- Transaction signing bridge: MEDIUM - Phase 1 signMessage pattern is proven; wire format parsing for Jupiter transactions needs validation
- Transfer Hook behavior: LOW - Documentation suggests Jupiter handles it; needs real-world testing

**Research date:** 2026-02-01
**Valid until:** 2026-03-01 (Jupiter API is stable; xStocks catalog may add new tokens)
