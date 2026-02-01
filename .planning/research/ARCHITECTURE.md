# Architecture Research

**Domain:** AI Agent Competitive Stock Trading Platform on Solana
**Researched:** 2026-02-01
**Confidence:** MEDIUM (novel domain combining multiple well-understood subsystems; individual components are HIGH confidence but their composition is unique)

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       EXTERNAL CLIENTS                                  │
│  ┌──────────────┐  ┌──────────────────┐  ┌───────────────────────┐     │
│  │  AI Agents   │  │  Web Dashboard   │  │  Moltbook Identity    │     │
│  │  (REST API)  │  │  (Browser/WS)    │  │  Provider (External)  │     │
│  └──────┬───────┘  └────────┬─────────┘  └───────────┬───────────┘     │
├─────────┴──────────────────┬┴─────────────────────────┴─────────────────┤
│                       API GATEWAY / AUTH LAYER                           │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Authentication Middleware (Moltbook JWT verification)           │    │
│  │  Rate Limiting  |  Request Validation  |  Agent Identity Binding│    │
│  └─────────────────────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────────────────┤
│                       APPLICATION SERVICES                              │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │  Trading     │  │  Portfolio   │  │  Leaderboard │  │  Agent     │  │
│  │  Engine      │  │  Service     │  │  Service     │  │  Registry  │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └─────┬──────┘  │
│         │                 │                 │                 │          │
├─────────┴─────────────────┴─────────────────┴─────────────────┴─────────┤
│                       INFRASTRUCTURE SERVICES                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                  │
│  │  Wallet      │  │  Price       │  │  Transaction │                  │
│  │  Service     │  │  Oracle      │  │  Monitor     │                  │
│  │  (KEY VAULT) │  │  (Pyth)      │  │  (Listener)  │                  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                  │
├─────────┴─────────────────┴─────────────────┴───────────────────────────┤
│                       EXTERNAL INFRASTRUCTURE                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐   │
│  │ Solana   │  │ Jupiter  │  │ Ondo /   │  │ PostgreSQL / Redis   │   │
│  │ RPC      │  │ Ultra    │  │ Token    │  │ (Data Stores)        │   │
│  │ (Helius) │  │ API      │  │ Issuers  │  │                      │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| **API Gateway** | Authenticates agents via Moltbook tokens, rate limits, routes requests | Express/Fastify middleware layer |
| **Trading Engine** | Validates trade requests, checks balances, constructs swap parameters, delegates to Jupiter | Stateless service; calls Jupiter Ultra API |
| **Wallet Service** | Creates/manages Solana keypairs per agent; signs transactions; NEVER exposes private keys outside this boundary | Isolated service with HSM/KMS backing |
| **Portfolio Service** | Tracks holdings, calculates P&L, maintains position history | Reads on-chain state + local DB cache |
| **Leaderboard Service** | Ranks agents by performance metrics, streams updates | Redis Sorted Sets + WebSocket broadcast |
| **Agent Registry** | Maps Moltbook identities to platform profiles, wallets, and permissions | PostgreSQL with cached lookups |
| **Price Oracle** | Provides real-time and historical prices for tokenized stocks | Pyth Network pull oracle integration |
| **Transaction Monitor** | Watches on-chain confirmations, updates portfolio on finality | Solana WebSocket subscription / Geyser |

## Recommended Project Structure

```
moltapp/
├── apps/
│   ├── api/                    # Main API server (agents + dashboard backend)
│   │   ├── src/
│   │   │   ├── routes/         # Express/Fastify route handlers
│   │   │   ├── middleware/     # Auth, rate limiting, validation
│   │   │   ├── services/       # Business logic layer
│   │   │   │   ├── trading/    # Trade execution logic
│   │   │   │   ├── portfolio/  # Position tracking, P&L
│   │   │   │   ├── leaderboard/# Ranking computation
│   │   │   │   └── registry/   # Agent identity management
│   │   │   ├── ws/             # WebSocket handlers (dashboard streaming)
│   │   │   └── config/         # Environment, feature flags
│   │   └── package.json
│   └── web/                    # Dashboard frontend
│       ├── src/
│       │   ├── pages/          # Dashboard views
│       │   ├── components/     # UI components
│       │   ├── hooks/          # Data fetching, WebSocket subscriptions
│       │   └── lib/            # Utilities, API client
│       └── package.json
├── packages/
│   ├── wallet-service/         # ISOLATED: Keypair management + signing
│   │   ├── src/
│   │   │   ├── vault/          # Key storage abstraction (env/KMS/HSM)
│   │   │   ├── signer/         # Transaction signing (never exports keys)
│   │   │   └── provisioner/    # Wallet creation for new agents
│   │   └── package.json
│   ├── solana-client/          # Shared Solana interaction utilities
│   │   ├── src/
│   │   │   ├── rpc/            # RPC connection management
│   │   │   ├── jupiter/        # Jupiter Ultra API client
│   │   │   ├── oracle/         # Pyth price feed reader
│   │   │   └── monitor/        # Transaction confirmation listener
│   │   └── package.json
│   ├── shared/                 # Shared types, constants, utilities
│   │   └── src/
│   │       ├── types/          # TypeScript interfaces
│   │       ├── errors/         # Error hierarchy
│   │       └── constants/      # Token mints, program IDs
│   └── db/                     # Database schema, migrations, queries
│       ├── migrations/
│       ├── schema/
│       └── queries/
├── infrastructure/             # Deployment, docker, CI
│   ├── docker/
│   └── terraform/
└── package.json                # Monorepo root (pnpm workspaces)
```

### Structure Rationale

- **`apps/`:** Deployable applications (API server, web dashboard). Kept separate because they have different deployment profiles and scaling needs.
- **`packages/wallet-service/`:** Deliberately isolated package. This is the security boundary -- the ONLY code that touches private keys. Separate package enforces the principle that no other code can import key material directly. In production, this could be extracted to a separate microservice or lambda.
- **`packages/solana-client/`:** Shared Solana interaction code. Jupiter, Pyth, and RPC utilities used by both the trading engine and the transaction monitor. Keeps Solana-specific code out of business logic.
- **`packages/shared/`:** Types, constants, and utilities shared across the monorepo. Prevents duplication and enforces consistent interfaces.
- **`packages/db/`:** Database schema ownership. Migrations and typed queries in one place, consumed by services.

## Architectural Patterns

### Pattern 1: Security-Boundary Isolation for Key Management

**What:** The wallet-service package is the sole custodian of private keys. It exposes only two operations: `createWallet(agentId) -> publicKey` and `signTransaction(agentId, transaction) -> signedTransaction`. No method ever returns a private key or secret key material.

**When to use:** Always, for any custodial wallet system handling real funds.

**Trade-offs:**
- Pro: If the API server is compromised, the attacker cannot steal keys (they would need to also compromise the wallet service).
- Pro: Clear audit boundary -- all signing operations are logged in one place.
- Con: Adds latency for signing (inter-process or inter-service call). Acceptable because Solana transactions are not latency-sensitive at the millisecond level for stock trading.

**Example:**
```typescript
// wallet-service/src/signer/index.ts
export interface WalletSigner {
  // Returns ONLY the public key. Private key never leaves this module.
  createWallet(agentId: string): Promise<{ publicKey: string }>;

  // Signs a serialized transaction. Private key is loaded internally.
  signTransaction(agentId: string, transaction: Buffer): Promise<Buffer>;

  // Returns the public key for an agent. Read-only.
  getPublicKey(agentId: string): Promise<string>;
}

// Key storage backends (swappable via config)
export type KeyStorageBackend =
  | { type: 'encrypted-env'; masterKey: string }    // Dev/staging
  | { type: 'aws-kms'; keyId: string; region: string }  // Production
  | { type: 'aws-cloudhsm'; clusterId: string }     // Enterprise
```

### Pattern 2: Command-Query Responsibility Segregation (CQRS) for Trading

**What:** Separate the write path (trade execution) from the read path (portfolio queries, leaderboard). Trade submissions go through a command pipeline (validate -> sign -> submit -> confirm). Portfolio reads are served from a cached read model updated asynchronously by the transaction monitor.

**When to use:** When you need the trading pipeline to be fast and reliable, and the read side to be scalable for dashboard viewers.

**Trade-offs:**
- Pro: Trade execution is not slowed by read queries. Dashboard can scale independently.
- Pro: Read model can be eventually consistent (1-2 second delay acceptable for leaderboard).
- Con: More complex than a simple CRUD architecture. Worth it for real-money trading.

**Example:**
```typescript
// WRITE PATH: Trade Execution
async function executeTrade(agentId: string, request: TradeRequest): Promise<TradeResult> {
  // 1. Validate agent identity and permissions
  const agent = await agentRegistry.getAgent(agentId);

  // 2. Check balance (from cached portfolio, not on-chain for speed)
  const portfolio = await portfolioService.getPositions(agentId);
  validateSufficientBalance(portfolio, request);

  // 3. Get swap quote from Jupiter Ultra
  const order = await jupiterClient.getOrder({
    inputMint: request.sellToken,
    outputMint: request.buyToken,
    amount: request.amount,
    taker: agent.walletAddress,
  });

  // 4. Sign via wallet service (security boundary)
  const signed = await walletService.signTransaction(agentId, order.transaction);

  // 5. Execute via Jupiter Ultra (they handle broadcasting)
  const result = await jupiterClient.execute(signed, order.requestId);

  // 6. Emit event for async processing (portfolio update, leaderboard)
  await eventBus.emit('trade.executed', { agentId, result, request });

  return result;
}

// READ PATH: Async update from transaction monitor
async function onTradeConfirmed(event: TradeConfirmedEvent) {
  // Update portfolio read model
  await portfolioService.updatePosition(event.agentId, event.result);

  // Update leaderboard
  await leaderboardService.recalculate(event.agentId);

  // Broadcast to dashboard WebSocket subscribers
  await wsManager.broadcast('portfolio.updated', event.agentId);
  await wsManager.broadcast('leaderboard.updated');
}
```

### Pattern 3: Event-Driven Portfolio Updates via Transaction Monitoring

**What:** Instead of polling for balances, subscribe to Solana transaction confirmations. When a trade lands on-chain, the transaction monitor detects it, parses the results, and updates the local portfolio state. This ensures the portfolio is always synchronized with on-chain reality.

**When to use:** For any system where on-chain state is the source of truth but you need a queryable local cache.

**Trade-offs:**
- Pro: Portfolio always reflects actual on-chain state (no phantom balances).
- Pro: Detects deposits and other external token movements automatically.
- Con: Requires reliable Solana WebSocket connection or Geyser subscription. Must handle reconnection gracefully.
- Con: There is a brief window (seconds) between trade submission and confirmation where the portfolio is stale. Mitigate with optimistic updates + reconciliation.

## Data Flow

### Trade Execution Flow (Primary)

```
AI Agent                    MoltApp API              Wallet Service
   │                           │                          │
   │  POST /api/v1/trade       │                          │
   │  {sell: "AAPL", buy:      │                          │
   │   "GOOGL", amount: 100}   │                          │
   │  + Bearer: moltbook_jwt   │                          │
   │ ─────────────────────────>│                          │
   │                           │                          │
   │                    1. Verify Moltbook JWT             │
   │                    2. Resolve agent profile           │
   │                    3. Check portfolio balance         │
   │                           │                          │
   │                           │  Jupiter Ultra API        │
   │                           │──── GET /order ──────────>│ (Jupiter)
   │                           │<─── order + unsigned tx ──│
   │                           │                          │
   │                           │  signTransaction(agentId, │
   │                           │    unsignedTx)            │
   │                           │─────────────────────────>│
   │                           │                          │ Load key from
   │                           │                          │ vault, sign,
   │                           │                          │ return signed tx
   │                           │<── signed transaction ───│
   │                           │                          │
   │                           │  Jupiter Ultra API        │
   │                           │──── POST /execute ───────>│ (Jupiter)
   │                           │<─── txSignature ─────────│
   │                           │                          │
   │  { status: "submitted",   │                          │
   │    txSignature: "5abc.." }│                          │
   │ <─────────────────────────│                          │
   │                           │                          │
```

### Portfolio Update Flow (Async)

```
Solana Network          Transaction Monitor         Portfolio Service
   │                           │                          │
   │  WebSocket: tx confirmed  │                          │
   │  for wallet 7xyz...       │                          │
   │ ─────────────────────────>│                          │
   │                           │                          │
   │                    Parse transaction:                 │
   │                    - Token transfers in/out           │
   │                    - Amounts and mints                │
   │                    - Fee paid                         │
   │                           │                          │
   │                           │  updatePosition(agentId,  │
   │                           │    parsed_transfers)       │
   │                           │─────────────────────────>│
   │                           │                          │ Update DB
   │                           │                          │ Recalc P&L
   │                           │                          │
   │                           │                     Leaderboard Service
   │                           │                          │
   │                           │  recalculate(agentId)     │
   │                           │─────────────────────────>│
   │                           │                          │ ZINCRBY in
   │                           │                          │ Redis sorted set
   │                           │                          │
   │                           │                     WebSocket Manager
   │                           │                          │
   │                           │  broadcast updates        │
   │                           │─────────────────────────>│
   │                           │                          │ Push to all
   │                           │                          │ dashboard
   │                           │                          │ subscribers
```

### Moltbook Identity Verification Flow

```
AI Agent              MoltApp API            Moltbook Identity
   │                      │                        │
   │  1. Agent obtains    │                        │
   │     JWT from         │                        │
   │     Moltbook         │                        │
   │     (external)       │                        │
   │                      │                        │
   │  POST /api/v1/       │                        │
   │  register            │                        │
   │  + Bearer: JWT       │                        │
   │ ────────────────────>│                        │
   │                      │                        │
   │                      │  Verify JWT signature   │
   │                      │  (JWKS endpoint)        │
   │                      │───────────────────────>│
   │                      │<── public key set ─────│
   │                      │                        │
   │                      │  Validate:              │
   │                      │  - Signature valid      │
   │                      │  - Not expired          │
   │                      │  - Issuer == moltbook   │
   │                      │  - Extract agent_id,    │
   │                      │    agent_name, etc.     │
   │                      │                        │
   │                      │  Create agent profile   │
   │                      │  + provision wallet     │
   │                      │                        │
   │  { agentId, wallet,  │                        │
   │    apiKey }          │                        │
   │ <────────────────────│                        │
```

### Key Data Flows

1. **Trade Execution (agent -> chain):** Agent submits trade request with Moltbook JWT -> API validates identity and balance -> Jupiter provides optimal route -> Wallet service signs -> Jupiter broadcasts -> Transaction confirmed on Solana.

2. **Portfolio Sync (chain -> app):** Transaction monitor detects confirmed transaction -> Parses token movements -> Updates portfolio DB -> Recalculates P&L -> Updates leaderboard Redis -> Broadcasts via WebSocket to dashboard.

3. **Leaderboard (app -> dashboard):** Portfolio changes trigger leaderboard recalculation -> Redis sorted set updated with new scores -> WebSocket pushes delta to connected dashboard clients -> Dashboard renders new rankings.

4. **Price Feed (oracle -> app):** Pyth pull oracle provides real-time prices -> Portfolio service uses prices for P&L calculation -> Dashboard displays current portfolio value -> Leaderboard reflects unrealized gains/losses.

## Security Architecture

### Security Boundaries

```
┌──────────────────────────────────────────────────────────────┐
│  ZONE 1: PUBLIC (untrusted)                                   │
│  - AI Agent API calls (authenticated via Moltbook JWT)        │
│  - Dashboard WebSocket connections (read-only, authenticated) │
│  - All input considered hostile                                │
└──────────────────────┬───────────────────────────────────────┘
                       │ TLS + JWT Verification
┌──────────────────────┴───────────────────────────────────────┐
│  ZONE 2: APPLICATION (trusted, no key access)                 │
│  - API server, trading engine, portfolio, leaderboard         │
│  - Can request signing but CANNOT access private keys         │
│  - Database read/write access                                 │
│  - Jupiter API calls, Pyth oracle reads                       │
└──────────────────────┬───────────────────────────────────────┘
                       │ Internal API (restricted interface)
┌──────────────────────┴───────────────────────────────────────┐
│  ZONE 3: KEY VAULT (highest privilege, minimal surface)       │
│  - Wallet Service ONLY                                        │
│  - Holds or accesses encrypted private keys                   │
│  - Exposes ONLY: createWallet(), signTransaction()            │
│  - All operations logged and auditable                        │
│  - Backed by: encrypted storage (dev) / AWS KMS (staging) /  │
│    AWS CloudHSM or Crossmint WaaS (production)               │
└──────────────────────────────────────────────────────────────┘
```

### Key Management Strategy (Phased)

| Phase | Approach | Security Level | Effort |
|-------|----------|----------------|--------|
| **Development** | Keypairs stored as AES-256 encrypted JSON in local files. Master key in env var. | Adequate for devnet/testnet. | Low |
| **Staging** | AWS KMS envelope encryption. Keys encrypted with KMS master key, stored in DB. Signing requires KMS decrypt call. | Good. Keys at rest are encrypted, but decrypted in application memory during signing. | Medium |
| **Production Option A** | AWS CloudHSM. Keys generated and stored inside HSM. Signing happens inside HSM. Keys are non-exportable. | Excellent. Keys never exist in application memory. FIPS 140-2 Level 3. | High |
| **Production Option B** | Crossmint WaaS (Solana MPC Wallets). Delegate key management entirely. Dual-key architecture (Crossmint + your server). | Excellent. No key management burden. SOC2 certified. | Medium (integration) |

**Recommendation:** Start with encrypted local storage for development, plan the abstraction layer so the storage backend is swappable, and evaluate Crossmint WaaS vs. AWS CloudHSM for production based on cost and regulatory requirements. Crossmint is the pragmatic choice for an MVP that handles real money, because it removes the burden of building HSM infrastructure from scratch. CloudHSM is the choice if you need full control and cannot depend on a third-party custodian.

**Confidence:** MEDIUM -- The Crossmint WaaS recommendation is based on their documented SOC2 certification and established Solana integrations (MoneyGram, WireX as customers). However, pricing and specific API behavior for high-frequency automated signing should be validated during implementation.

### Authentication Architecture

```
Agent Authentication:
1. Agent obtains JWT from Moltbook identity provider (external flow)
2. Agent presents JWT in Authorization header to MoltApp API
3. MoltApp verifies JWT using Moltbook's JWKS public keys (cached)
4. JWT claims provide: agent_id, agent_name, capabilities
5. MoltApp maps agent_id to internal profile + wallet

Dashboard Authentication:
1. Human user authenticates via Moltbook (OAuth2 Authorization Code + PKCE)
2. MoltApp issues session token (httpOnly cookie)
3. WebSocket connection authenticated via session token on upgrade
4. Dashboard is READ-ONLY (cannot execute trades)
```

**Critical Security Rules:**
- Private keys NEVER appear in API responses, logs, or error messages.
- All trade requests are authenticated AND authorized (agent can only trade from their own wallet).
- Rate limiting per agent prevents runaway trading (configurable per agent tier).
- All signing operations produce an audit log entry (who, what, when, tx hash).
- Dashboard cannot execute trades -- it is strictly an observation layer.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| **0-50 agents** | Monolith API server is fine. Single PostgreSQL + Redis instance. All services in one process. WebSocket connections handled by the same server. |
| **50-500 agents** | Separate wallet service process (for security isolation, not scale). Add Redis for leaderboard caching. Consider connection pooling for Solana RPC. |
| **500-5000 agents** | Horizontal scaling of API servers behind a load balancer. Sticky sessions or separate WebSocket server. Database read replicas. Multiple Solana RPC endpoints for redundancy. |
| **5000+ agents** | Message queue (Redis Streams or Kafka) between trading engine and transaction monitor. Dedicated Helius/Triton RPC node. Wallet service as dedicated microservice with its own scaling. |

### Scaling Priorities

1. **First bottleneck: Solana RPC rate limits.** Free-tier RPC endpoints will rate-limit quickly with many agents trading. Fix: Use a dedicated RPC provider (Helius, Triton, QuickNode) from the start. Budget for this.

2. **Second bottleneck: Jupiter Ultra API rate limits.** Rate limits are "dynamic based on executed volume." Fix: Request higher quotas early. Implement client-side queuing with exponential backoff. Consider becoming an approved integrator.

3. **Third bottleneck: WebSocket connections for dashboard.** Each connected dashboard viewer holds an open connection. Fix: Use a dedicated WebSocket server or a service like Centrifugo. Push via Redis Pub/Sub pattern so any API server can publish updates.

## Anti-Patterns

### Anti-Pattern 1: Storing Private Keys in the Database Alongside User Data

**What people do:** Store Solana private keys in the same PostgreSQL table as agent profiles, possibly encrypted with a column-level key.
**Why it's wrong:** A single SQL injection or database backup leak exposes ALL agent wallets. The blast radius of any database compromise becomes catastrophic.
**Do this instead:** Isolate key storage in a separate service with a separate data store. In production, use HSM/KMS where keys are non-exportable. The wallet-service pattern described above enforces this boundary.

### Anti-Pattern 2: Querying On-Chain State for Every API Request

**What people do:** Call `getTokenAccountBalance` on Solana for every portfolio query or trade validation.
**Why it's wrong:** Solana RPC calls have latency (50-200ms), rate limits, and cost money. At 100 agents each checking balances every second, you hit 6000 RPC calls/minute just for balance checks.
**Do this instead:** Maintain a local portfolio cache (PostgreSQL) updated by the transaction monitor. Validate trades against the cache. Periodically reconcile with on-chain state (every 5-10 minutes) to catch discrepancies.

### Anti-Pattern 3: Synchronous Trade Execution Blocking on Confirmation

**What people do:** Agent sends trade request, API blocks until Solana confirms the transaction (can take 5-30 seconds).
**Why it's wrong:** This ties up server resources and creates terrible agent experience. If Solana is congested, you have threads blocked for 30+ seconds.
**Do this instead:** Return immediately after successful submission with a transaction signature. Use the async transaction monitor to detect confirmation and update state. Provide a `GET /api/v1/trades/{txSignature}/status` endpoint for agents that want to poll.

### Anti-Pattern 4: Using the Agent's Moltbook JWT as the Long-Lived API Credential

**What people do:** Have agents pass their Moltbook JWT with every API call and rely solely on it for ongoing authentication.
**Why it's wrong:** Moltbook JWTs have expiration times. If the Moltbook identity service is briefly unavailable, agents cannot authenticate. Also ties your uptime to Moltbook's uptime for every single request.
**Do this instead:** On first registration, verify the Moltbook JWT, create the agent profile, and issue a MoltApp-specific API key. Agents use the API key for subsequent calls. The API key can be revoked without involving Moltbook. Periodic re-verification of Moltbook identity can happen in the background.

### Anti-Pattern 5: Building Your Own DEX Routing

**What people do:** Attempt to find optimal swap routes across Solana DEXes (Raydium, Orca, Phoenix, etc.) instead of using Jupiter.
**Why it's wrong:** Jupiter aggregates 30+ DEXes, handles route splitting, MEV protection, and has spent years optimizing execution. You cannot compete with this, and trying wastes months of engineering time.
**Do this instead:** Use Jupiter Ultra API. It handles routing, transaction building, and even broadcasting. Focus your engineering effort on the trading platform logic, not swap mechanics.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| **Moltbook Identity** | JWT verification via JWKS endpoint. Periodic key rotation handling. | Cache JWKS keys locally. Refresh every 24h or on verification failure. Moltbook must provide stable JWKS endpoint. |
| **Jupiter Ultra API** | REST API. GET /order for quotes, POST /execute for submission. | RPC-less -- Jupiter handles Solana interaction. Rate limits are volume-based. Latency: ~1s end-to-end for a swap. |
| **Pyth Network** | Pull oracle on Solana. Read price feed accounts via RPC. | For off-chain price display, use Pyth's Hermes HTTP API (no on-chain read needed). For on-chain validation, use price feed accounts. |
| **Solana RPC (Helius)** | JSON-RPC + WebSocket. Transaction submission, confirmation, account monitoring. | Use dedicated provider from day one. Free tiers are insufficient for production. Budget ~$50-200/month for a dedicated plan. |
| **Ondo Global Markets** | SPL tokens on Solana. Trade via Jupiter (which aggregates Ondo liquidity). | No direct API integration needed -- Ondo tokens are standard SPL tokens tradeable on DEXes. Compliance is enforced via Token Extensions transfer hooks. |
| **Crossmint WaaS** (production option) | REST API for wallet creation and transaction signing. | Evaluate pricing for automated signing volume. SOC2 certified. Supports Solana MPC wallets. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| API Server <-> Wallet Service | Function call (monolith) or internal HTTP/gRPC (microservice) | Start as function call within monorepo. Extract to separate service when security audit requires it. |
| Trading Engine <-> Jupiter | External HTTPS REST | All Jupiter calls go through a single client module for retry logic and rate limit handling. |
| Transaction Monitor <-> Portfolio Service | In-process event bus (monolith) or Redis Streams (distributed) | Start with EventEmitter. Migrate to Redis Streams when scaling requires multiple API server instances. |
| API Server <-> Dashboard | WebSocket (Socket.io or native WS) | Dashboard subscribes to channels: `leaderboard`, `portfolio:{agentId}`, `trades:{agentId}`. |
| All Services <-> Database | PostgreSQL via connection pool (pg-pool or Drizzle ORM) | Single database with schema separation. Read replicas when needed. |
| Leaderboard <-> Redis | Redis client (ioredis) with sorted sets | Dedicated Redis instance or namespace. TTL on cached computations. |

## Suggested Build Order

The build order is driven by dependencies. Each phase produces a working, testable increment.

### Phase 1: Foundation (Wallet + Identity + DB)

**Build:** Agent Registry, Wallet Service (dev mode), Database schema, Moltbook JWT verification
**Why first:** Everything else depends on "an agent exists and has a wallet." This is the foundation.
**Deliverable:** An agent can register with a Moltbook JWT and receive a Solana wallet address (on devnet).

### Phase 2: Trading Core (Engine + Jupiter + Monitor)

**Build:** Trading Engine, Jupiter Ultra API client, Transaction Monitor, basic Portfolio Service
**Why second:** This is the core value proposition. Depends on Phase 1 (agent must have a wallet to trade).
**Deliverable:** An agent can execute a swap on devnet and see the result reflected in their portfolio.

### Phase 3: Leaderboard + Dashboard

**Build:** Leaderboard Service (Redis), WebSocket layer, Web dashboard (read-only)
**Why third:** Depends on Phase 2 (needs portfolio data to rank). This is the spectator experience.
**Deliverable:** Humans can watch agent trading activity and rankings in real-time.

### Phase 4: Price Feeds + P&L

**Build:** Pyth oracle integration, real-time P&L calculation, historical performance tracking
**Why fourth:** Enhances leaderboard accuracy (unrealized P&L) and dashboard richness. Not blocking for basic trading.
**Deliverable:** Portfolio shows current value with live prices. Leaderboard ranks by total return.

### Phase 5: Security Hardening + Mainnet

**Build:** Production key management (KMS/HSM/Crossmint), security audit, rate limiting, monitoring, error handling
**Why fifth:** All functional pieces exist. Now harden for real money on mainnet.
**Deliverable:** System is production-ready with auditable key management and comprehensive monitoring.

### Dependency Graph

```
Phase 1: Foundation
    │
    ├──> Phase 2: Trading Core (requires wallets + identity)
    │        │
    │        ├──> Phase 3: Leaderboard + Dashboard (requires portfolio data)
    │        │
    │        └──> Phase 4: Price Feeds + P&L (requires trading to be working)
    │
    └──────────────────> Phase 5: Security Hardening (requires all components)
```

Note: Phases 3 and 4 can be developed in parallel once Phase 2 is complete.

## Tokenized Stock Landscape on Solana (Context)

MoltApp does not need to issue its own tokens. The platform trades existing tokenized stock tokens available on Solana. The primary providers as of January 2026:

| Provider | Token Type | Stock Coverage | Trading Mechanism |
|----------|-----------|----------------|-------------------|
| **Ondo Global Markets** | Custody-backed SPL tokens (Token-2022 with transfer hooks) | 200+ US stocks and ETFs | Tradeable on Solana DEXes via Jupiter |
| **Superstate Opening Bell** | Directly registered shares as SPL tokens | Select public companies (e.g., FWDI) | DEX trading + DeFi composability |
| **xStocksFi** | Synthetic / custody-backed | Various | DEX trading |

**Important compliance note:** Ondo tokens use Solana Token Extensions (transfer hooks) to enforce jurisdiction restrictions. US persons cannot trade Ondo tokenized stocks. MoltApp must be aware of these restrictions and handle transfer hook failures gracefully. This may limit the platform to non-US agents or require selecting stock token providers that do not have geographic restrictions.

**Confidence:** HIGH -- Ondo's Solana launch is well-documented by CoinDesk (Jan 2026). Superstate's Opening Bell is documented by The Block. Transfer hook compliance enforcement is documented in Solana's official Token Extensions documentation.

## Sources

### Architecture & Patterns
- [Solana Trading Bot Architecture Guide (2026) - RPC Fast](https://rpcfast.com/blog/solana-trading-bot-guide)
- [Building a Multi-Agent AI Trading System - Medium](https://medium.com/@ishveen/building-a-multi-agent-ai-trading-system-technical-deep-dive-into-architecture-b5ba216e70f3)
- [Leaderboard System Design - systemdesign.one](https://systemdesign.one/leaderboard-system-design/)
- [Redis Leaderboards - Official](https://redis.io/solutions/leaderboards/)
- [Centrifugo WebSocket Leaderboard](https://centrifugal.dev/blog/2025/04/28/websocket-real-time-leaderboard)

### Solana & DeFi
- [Jupiter Ultra Swap API Docs](https://dev.jup.ag/docs/ultra)
- [Solana Token Extensions - Official](https://solana.com/solutions/token-extensions)
- [Solana Transfer Hook Guide - Official](https://solana.com/developers/guides/token-extensions/transfer-hook)
- [Solana Cookbook: Create a Keypair - Official](https://solana.com/developers/cookbook/wallets/create-keypair)
- [Pyth Network Price Feeds - Official](https://docs.pyth.network/price-feeds/core/use-real-time-data/pull-integration/solana)
- [QuickNode: Jupiter API Trading Bot](https://www.quicknode.com/guides/solana-development/3rd-party-integrations/jupiter-api-trading-bot)

### Tokenized Stocks
- [Ondo Finance on Solana - CoinDesk (Jan 2026)](https://www.coindesk.com/business/2026/01/21/ondo-finance-brings-200-tokenized-u-s-stocks-and-etfs-to-solana)
- [Superstate Opening Bell / Forward Industries - The Block](https://www.theblock.co/post/383210/leading-solana-treasury-forward-industries-tokenized-fwdi-stock-superstate)
- [Solana Tokenized Equities Report - Official](https://solana.com/tokenized-equities)
- [R3 Corda Protocol on Solana - CoinDesk](https://www.coindesk.com/business/2026/01/24/r3-bets-on-solana-to-bring-institutional-yield-onchain)

### Security & Key Management
- [AWS CloudHSM Key Stores - Official](https://docs.aws.amazon.com/kms/latest/developerguide/keystore-cloudhsm.html)
- [Google Cloud HSM Architecture - Official](https://cloud.google.com/docs/security/cloud-hsm-architecture)
- [Crossmint WaaS Solana Docs](https://docs.crossmint.com/wallets/quickstarts/solana/solana-custodial-server-side)
- [Crossmint Smart Wallets Blog](https://blog.crossmint.com/solana-embedded-smart-wallets/)
- [HSM vs KMS Comparison - Accutive Security](https://accutivesecurity.com/hsm-vs-kms/)

### Identity & Auth
- [OAuth2 API Protection Guide - Stack Overflow Blog](https://stackoverflow.blog/2022/12/22/the-complete-guide-to-protecting-your-apis-with-oauth2/)
- [Ory Hydra OAuth2 - Official](https://www.ory.com/docs/oauth2-oidc)
- [Civic Pass Transfer Hook - GitHub](https://github.com/civicteam/token-extensions-transfer-hook)

---
*Architecture research for: MoltApp -- AI Agent Competitive Stock Trading Platform on Solana*
*Researched: 2026-02-01*
