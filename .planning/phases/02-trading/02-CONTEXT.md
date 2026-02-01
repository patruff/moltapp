# Phase 02: Trading — Discussion Context

**Phase Goal:** Agents can discover available tokenized stocks, execute market buy/sell orders, and track their positions and trade history

**Discussed:** 2026-02-01
**Requirements:** TRAD-01, TRAD-02, TRAD-03, TRAD-04

## Decisions

### 1. Stock Catalog Source
**Decision:** Jupiter auto-discovery
**Rationale:** Query Jupiter's token API to discover all available xStocks tokens dynamically. Filter by metadata (issuer, minimum liquidity) to ensure quality. No manual curation needed — Jupiter already knows which tokens are tradeable.
**Impact:** Need a stock discovery service that queries Jupiter, filters for xStocks tokens, and caches results. Refresh periodically (e.g., every 5 minutes).

### 2. Trade Execution Flow
**Decision:** Synchronous execution
**Rationale:** Agent sends trade request, waits for full lifecycle (quote → sign → submit → confirm), gets back confirmed results or clear error. Simpler API for agents — one request, one response. Platform handles retries internally.
**Impact:** Trade endpoint will block until confirmation. Need internal retry logic for Solana's ~58% bot failure rate. Timeout handling for stuck transactions. Agent-facing API is simple: POST trade, get result.

### 3. Transfer Hook / Whitelisting
**Decision:** Trust Jupiter to handle it
**Rationale:** Jupiter Ultra API routes through compliant paths that satisfy Token-2022 Transfer Hooks. If a trade fails due to hook rejection, return a clear error to the agent. Research during planning will confirm Jupiter's Transfer Hook support.
**Impact:** No upfront whitelisting process needed. Error handling must catch and translate Transfer Hook failures into agent-friendly messages.

### 4. Position Tracking
**Decision:** Local PostgreSQL positions table
**Rationale:** Since we only track MoltApp trades (not external transfers), a local DB table stays in sync. Fast reads for the API. Can add on-chain reconciliation later if needed.
**Impact:** New `positions` (or `holdings`) table in schema. Updated after each confirmed trade. Buy adds/increases position, sell decreases/removes. Ties into TRAD-03 (view positions).

### 5. Price Source
**Decision:** Jupiter price API only
**Rationale:** Use Jupiter's price API for both listing stocks and trade execution. Most accurate for actual trade prices since Jupiter is the DEX aggregator. Simpler than integrating two price sources.
**Impact:** Single price source integration. Prices reflect actual swap rates agents will get.

### 6. Trade History Scope
**Decision:** MoltApp trades only
**Rationale:** Only record trades executed through the MoltApp API. Simpler implementation, guaranteed data accuracy. External transfers show as balance changes but not in trade history.
**Impact:** Trades table records only our executed swaps. No need for Helius webhook integration for stock token movements (existing webhook already handles SOL/USDC deposits).

## New Schema Needed

### positions table
- agentId (FK -> agents)
- mintAddress (stock token mint)
- symbol (e.g., "AAPLx")
- quantity (numeric, token amount)
- averageCostBasis (numeric, USDC per token at purchase)
- createdAt, updatedAt

### trades table (or extend transactions)
- agentId (FK -> agents)
- side ('buy' | 'sell')
- stockMintAddress
- stockSymbol
- stockQuantity (tokens received/sold)
- usdcAmount (USDC spent/received)
- pricePerToken (USDC per token at execution)
- txSignature (Solana tx)
- jupiterRouteInfo (JSON, optional — route details for debugging)
- status ('confirmed' | 'failed')
- createdAt

## Integration Points

- **Jupiter Ultra API**: Quote + swap execution for all trades
- **Jupiter Price API**: Stock listing with current prices
- **Turnkey**: Transaction signing (already integrated from Phase 1)
- **Solana RPC**: Transaction submission and confirmation (already integrated)
- **Existing auth middleware**: All trade endpoints protected by API key auth
- **Existing rate limiter**: Applied to trade endpoints

## Open Questions for Research Phase

- What is Jupiter Ultra API's exact request/response format for Token-2022 swaps?
- How does Jupiter handle xStocks Transfer Hooks in practice?
- What's the best way to detect xStocks tokens from Jupiter's token list? (issuer metadata, mint authority, etc.)
- Jupiter rate limits for quote + swap endpoints
- Transaction confirmation strategy: poll getSignatureStatuses vs. WebSocket subscription

---
*Discussed: 2026-02-01*
