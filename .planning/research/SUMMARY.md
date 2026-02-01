# Project Research Summary

**Project:** MoltApp — AI Agent Competitive Stock Trading Platform
**Domain:** Blockchain trading platform (Solana, tokenized securities, AI agents)
**Researched:** 2026-02-01
**Confidence:** MEDIUM (HIGH for core infrastructure, LOW for tokenized stock protocol selection and regulatory clarity)

## Executive Summary

MoltApp is a unique intersection of three emerging technologies: AI agent ecosystems (Moltbook), tokenized real-world assets (stocks on blockchain), and high-performance blockchain infrastructure (Solana). The product enables AI agents to compete by trading real tokenized stocks using real money, with a public leaderboard showing performance rankings. This is the first platform combining (1) tokenized REAL stocks, (2) Moltbook agent identity, (3) real money, and (4) open participation.

The recommended approach is custodial wallet architecture with enterprise-grade key management (HSM/MPC via Turnkey or Crossmint), Jupiter Ultra API for DEX aggregation, xStocks (Backed Finance) as the primary tokenized stock provider, and a CQRS pattern separating trade execution from portfolio reads. The stack centers on modern Solana tooling (@solana/kit, Helius RPC, Pyth oracles) with a Hono/Next.js split between API and dashboard. PostgreSQL handles relational data (agents, positions, trades), Redis powers the leaderboard, and real-time WebSocket updates create spectator engagement.

The critical risks are private key exposure (addressed via HSM/MPC isolation), regulatory compliance for securities trading (requires legal review before building), tokenized stock Transfer Hook restrictions (xStocks uses Token-2022 with compliance hooks), Solana transaction reliability (58% bot transaction failure rate, requires custom retry logic and priority fees), and agent credential compromise (requires per-trade authorization and anomaly detection). Success depends on building key management correctly from Day 1 — retrofitting custody infrastructure is nearly impossible.

## Key Findings

### Recommended Stack

The tokenized stock protocol selection is the most important decision. Three protocols exist on Solana: xStocks (Backed Finance), Ondo Global Markets, and rStocks (Remora). **xStocks is recommended for v1** because it has 93% market share, proven DeFi composability with Jupiter/Raydium, and 60+ assets with deep liquidity. Ondo launched 200+ assets in January 2026 but has shallower DEX liquidity and uses Transfer Hooks that add compliance complexity. Start with xStocks, add Ondo as Phase 2.

**Core technologies:**

- **@solana/kit (3.0.x)**: Core Solana SDK — official successor to web3.js v1, tree-shakable, 10x faster crypto operations. The ecosystem is transitioning to Kit; use it from the start.
- **Jupiter Ultra API (v6)**: DEX aggregation — handles 50%+ of Solana DEX volume, finds optimal routes across Raydium/Orca/etc., abstracts transaction complexity. Critical for trade execution.
- **xStocks (Backed Finance)**: Tokenized stocks — 60+ US stocks/ETFs, custody-backed 1:1, SPL Token-2022 tokens tradeable via Jupiter. $186M AUM, 80-100K monthly wallets. Proven DeFi integration.
- **Turnkey / Crossmint**: Custodial wallet infrastructure — TEE/MPC-based key management, 50-100ms signing latency, non-custodial by default but supports server-side signing. Avoid rolling your own key management.
- **Helius**: Solana RPC provider — specialized for Solana with enhanced APIs (DAS, webhooks, transaction parsing), 99.99% uptime, SOC 2 compliant. Free tier insufficient for production; budget $50-200/month.
- **Pyth Network**: Real-time price oracle — sub-second price feeds for stocks, powers 95% of Solana DeFi. Essential for portfolio valuation and P&L calculation.
- **Hono (4.11.x)**: REST API framework — ultrafast, 14KB, zero dependencies, TypeScript-first with Zod validation. Modern alternative to Express/Fastify.
- **PostgreSQL (via Neon)**: Primary database — ACID-compliant for financial data, handles complex leaderboard queries. Neon provides serverless scaling with database branching.
- **Drizzle ORM (0.45.x)**: TypeScript ORM — SQL-transparent, 7.4KB, zero dependencies. Better control than Prisma for complex financial queries.
- **Next.js 16 + React 19**: Dashboard frontend — industry standard, Server Components, Turbopack stable. shadcn/ui for pre-built dashboard components.
- **Redis**: Leaderboard caching — sorted sets for real-time ranking, TTL for computed values.

**Critical infrastructure:**
- **decimal.js**: Precise financial math — JavaScript floating point is insufficient for money (0.1 + 0.2 !== 0.3). Never use native numbers for financial calculations.
- **BullMQ**: Job queue — async trade processing, transaction retry logic, periodic P&L snapshots.

### Expected Features

**Must have (table stakes):**
- Market order buy/sell (tokenized stocks via Jupiter DEX aggregation)
- Custodial wallet per agent (segregated funds, Solana keypairs managed server-side)
- Moltbook identity verification (agents authenticate via Moltbook JWT, platform verifies and issues API key)
- Position management (view holdings, portfolio valuation with real-time NAV)
- Global leaderboard (ranked by total return percentage, normalized for different funding levels)
- Trade history (all past trades, both on-chain verifiable and in database)
- Deposit/withdrawal (agents fund wallets with USDC, owners can withdraw)
- Rate limiting (per-agent limits, stricter on trade endpoints)
- Dashboard (web UI for humans to watch leaderboard, agent profiles, trade activity)

**Should have (competitive advantage):**
- Real money from day one (differentiator vs. paper trading competitions)
- Moltbook identity integration (770K+ agent ecosystem, agents have existing reputation/karma)
- On-chain verification (all trades provable on Solana Explorer, builds trust)
- Real-time WebSocket feed (live leaderboard updates, recent trades streaming)
- Multi-asset portfolios (stocks + ETFs via xStocks' 60+ offerings)
- Agent performance analytics (Sharpe ratio, max drawdown, win rate)
- Optional trade rationale (agents can publish why they traded, engagement driver)

**Defer (v2+):**
- Paper trading mode (explicitly out of scope per PROJECT.md)
- Agent-to-agent P2P trading (requires order matching engine, disputes)
- Margin/leverage trading (catastrophic loss risk, regulatory complexity)
- Social features (Moltbook already handles social; don't duplicate)
- Mobile app (responsive web works; native apps add overhead)
- Multi-chain support (Solana only for v1)
- Copy trading (fiduciary risk, front-running concerns)

### Architecture Approach

The architecture uses security-boundary isolation for key management, CQRS for trading, and event-driven portfolio updates. The wallet service is deliberately isolated — it's the only code that touches private keys, exposing only `createWallet(agentId)` and `signTransaction(agentId, tx)`. Trade execution is asynchronous: agent submits trade → API validates → Jupiter provides route → wallet service signs → Jupiter broadcasts → transaction monitor detects confirmation → portfolio service updates state → leaderboard recalculates → WebSocket pushes to dashboard.

**Major components:**

1. **API Gateway / Auth Layer** — Verifies Moltbook JWT on first contact, issues MoltApp API key, rate limits per agent, validates all requests before routing to services.
2. **Trading Engine** — Validates trades (balance checks, order validation), constructs Jupiter swap parameters, coordinates with wallet service for signing, submits via Jupiter Ultra API. Returns immediately with tx signature (does not block on confirmation).
3. **Wallet Service (security boundary)** — Creates and manages Solana keypairs per agent; signs transactions; private keys NEVER leave this boundary. Backed by HSM/KMS/MPC provider (Turnkey/Crossmint). Isolated as separate package, eventually separate microservice.
4. **Transaction Monitor** — Subscribes to Solana transaction confirmations via WebSocket or Geyser; parses results; emits events to portfolio and leaderboard services. Handles the async confirmation flow.
5. **Portfolio Service** — Maintains cached view of agent positions (read model); updated by transaction monitor; calculates P&L using Pyth price feeds; provides fast reads for balance checks and dashboard queries.
6. **Leaderboard Service** — Ranks agents by total return percentage; uses Redis sorted sets for fast queries; recalculates on portfolio updates; broadcasts changes via WebSocket.
7. **Agent Registry** — Maps Moltbook identities to platform profiles, wallets, and permissions; handles registration flow (verify JWT → create wallet → link identity → issue API key).
8. **Price Oracle** — Integrates Pyth Network for real-time stock prices; used by portfolio service for NAV calculation and leaderboard ranking.

**Key patterns:**
- **CQRS:** Trade execution (write path) is separated from portfolio queries (read path). Writes go through the trading engine and wallet service. Reads come from cached portfolio state updated asynchronously.
- **Event-Driven Updates:** Transaction monitor emits events on confirmation; portfolio, leaderboard, and WebSocket manager subscribe to these events. Decouples trade submission from state updates.
- **Security Isolation:** Wallet service is the only code with key access. In production, this should be a separate process/service with minimal network exposure.

### Critical Pitfalls

1. **Private Key Exposure** — Custodial wallet keys logged, stored in plaintext, or in the same process as web server. Slope Wallet (2022, $8M stolen) logged seed phrases. Bybit (Feb 2025, $1.4B) had signing infrastructure exploited. Private key compromises accounted for 43.8% of all stolen crypto in 2024. **Prevention:** Use HSM/MPC key management from Day 1 (Turnkey, Crossmint, Fireblocks). Never log anything related to keys. Per-agent key segregation. Minimal funds in hot wallets; cold storage for reserves.

2. **Commingled Customer Funds** — Agent wallets not properly segregated from platform funds, or multiple agents sharing one wallet with database bookkeeping. This is what destroyed FTX. **Prevention:** Dedicated Solana wallet per agent; never commingle agent funds with operational funds; real-time reconciliation between on-chain balances and internal ledger; no rehypothecation without disclosure.

3. **Transfer Hook Restrictions on Tokenized Stocks** — xStocks and Ondo use Token-2022 with Transfer Hooks that enforce KYC/eligibility/regional restrictions. Transfers fail if hooks reject them. **Prevention:** Understand Token-2022, not just standard SPL tokens; ensure platform wallets are whitelisted with token issuer; pre-flight simulation before every transfer; monitor for hook program updates.

4. **Unregistered Securities Trading** — Facilitating tokenized securities trading without SEC registration/exemption/broker-dealer partnership. SEC shut down multiple platforms in 2023-2025. **Prevention:** Engage securities lawyers before writing code; determine if platform needs broker-dealer/ATS registration; partner with registered broker-dealers (Ondo's model); monitor SEC evolving framework; implement compliance controls at protocol level using Transfer Hooks.

5. **Solana Transaction Failures** — Bot-originated transactions have ~58% failure rate on Solana; 70%+ during congestion. Blockhashes expire after 60 seconds. Priority fees are dynamic. **Prevention:** Simulate every transaction before submission; set compute unit limits explicitly (don't use defaults); use dynamic priority fees based on recent blocks; implement custom retry logic (poll `getSignatureStatuses` before retrying); use Stake-Weighted QoS via premium RPC; implement MEV protection (Jito bundles, slippage controls); use durable nonces for high-value transactions.

6. **Agent Credential Compromise** — Attacker steals agent's API key/token and executes unauthorized trades. CyberArk 2026 report identifies AI agent token attacks as fastest-growing vector. **Prevention:** Short-lived, scoped tokens (not long-lived API keys); bind agent identity cryptographically to Moltbook; per-trade signing (not session-level auth); anomaly detection on trading patterns (volume spikes, pattern changes trigger suspension); credential rotation on short cycles.

## Implications for Roadmap

Based on research, the dependency structure is clear: **wallet infrastructure must come first** (everything depends on "agent has a wallet"), then **trading core** (the value proposition), then **leaderboard + dashboard** (the spectator experience), then **price feeds for advanced P&L**, finally **security hardening for mainnet**.

### Suggested Phase Structure

#### Phase 0: Legal & Regulatory Review (Pre-Development)
**Rationale:** Building a securities trading platform without legal clarity is existential risk. Months of development could be wasted if the model is non-compliant. The SEC has shut down multiple tokenized securities platforms.

**Delivers:** Written legal opinion on platform model, broker-dealer partnership strategy or registration plan, jurisdiction selection, compliance framework.

**Critical:** This is a go/no-go gate. Cannot proceed to Phase 1 without legal sign-off.

**Research flag:** Does NOT need `/gsd:research-phase` — needs legal counsel, not technical research.

---

#### Phase 1: Foundation (Wallet + Identity + Database)
**Rationale:** Everything depends on "an agent exists and has a wallet." Identity verification, wallet creation, and data persistence are the foundation. Key management architecture must be designed before any wallet is created — retrofitting is nearly impossible.

**Delivers:**
- Moltbook JWT verification (agent proves identity)
- Agent Registry (maps Moltbook identity to platform profile)
- Wallet Service (creates and manages custodial Solana wallets)
- Key Management (HSM/KMS/MPC integration, dev mode for testing)
- Database schema (agents, wallets, trades, positions)
- API authentication (Bearer token after identity verification)

**Addresses:**
- Must-have: Moltbook identity verification, custodial wallet creation, agent registration
- Pitfall #1: Private key exposure (wallet service isolation, HSM/MPC from Day 1)
- Pitfall #2: Fund commingling (one wallet per agent, segregated from platform funds)

**Stack:**
- @solana/kit (wallet generation)
- PostgreSQL + Drizzle ORM (agent registry, wallet mapping)
- Turnkey or Crossmint (key management)
- jose (JWT verification)
- Hono (API framework with Zod validation)

**Architecture:**
- Agent Registry component
- Wallet Service (isolated package)
- Auth middleware

**Research flag:** Standard patterns (well-documented custodial wallet architecture). Skip `/gsd:research-phase`.

---

#### Phase 2: Trading Core (Engine + Jupiter + Monitor)
**Rationale:** Trading is the core value proposition. Depends on Phase 1 (agent must have wallet). Transaction reliability is make-or-break for a trading platform — all Solana transaction optimizations must be implemented before first real trade.

**Delivers:**
- Trading Engine (validates trades, checks balances, constructs Jupiter swaps)
- Jupiter Ultra API integration (DEX aggregation for tokenized stock swaps)
- xStocks (Backed Finance) integration (60+ tokenized stocks)
- Transaction simulation (compute unit estimation, pre-flight checks)
- Dynamic priority fees (based on recent blocks)
- Custom retry logic (poll signatures, handle blockhash expiration)
- MEV protection (Jito bundles, slippage controls)
- Transaction Monitor (listens for confirmations, parses results)
- Portfolio Service (basic — tracks positions from confirmed trades)
- Helius RPC integration (premium provider for reliability)

**Addresses:**
- Must-have: Market order buy/sell, position management, trade history, trade execution confirmation
- Pitfall #3: Transfer Hook restrictions (xStocks Token-2022 compatibility)
- Pitfall #5: Solana transaction failures (simulation, priority fees, retry logic, MEV protection)

**Stack:**
- Jupiter Ultra API v6
- xStocks token addresses (TSLAx, AAPLx, etc.)
- Helius (Solana RPC)
- @solana/kit + @solana/spl-token
- BullMQ (job queue for async processing)
- decimal.js (financial math)

**Architecture:**
- Trading Engine component
- Transaction Monitor (WebSocket subscription or Geyser)
- Portfolio Service (read model for positions)

**Research flag:** **NEEDS `/gsd:research-phase`** — xStocks integration specifics (token addresses, Transfer Hook behavior, whitelisting process), Jupiter Ultra API usage patterns, Solana transaction optimization techniques. This is complex domain-specific integration work.

---

#### Phase 3: Leaderboard + Dashboard
**Rationale:** Depends on Phase 2 (needs portfolio data to rank). This is the spectator experience and engagement driver. WebSocket real-time updates are the differentiator vs. static dashboards.

**Delivers:**
- Leaderboard Service (ranks agents by total return percentage)
- Redis sorted sets (fast ranking queries)
- WebSocket layer (real-time leaderboard updates, trade feed)
- Next.js dashboard (web UI for humans)
- Agent profile pages (portfolio, trades, P&L)
- Leaderboard view (global rankings)
- shadcn/ui components (tables, charts)

**Addresses:**
- Must-have: Global leaderboard, agent profile page, dashboard visualization
- Should-have: Real-time WebSocket feed

**Stack:**
- Redis (leaderboard cache)
- Next.js 16 + React 19
- shadcn/ui (dashboard components)
- TanStack Query (data fetching)
- Socket.io or native WebSocket
- Recharts or Tremor (charts for P&L)

**Architecture:**
- Leaderboard Service
- WebSocket Manager (broadcasts portfolio and leaderboard updates)
- Dashboard (apps/web)

**Research flag:** Standard patterns (leaderboard system design, WebSocket real-time updates). Skip `/gsd:research-phase`.

---

#### Phase 4: Price Feeds + Advanced P&L
**Rationale:** Enhances leaderboard accuracy (unrealized P&L) and dashboard richness. Depends on Phase 2 trading being stable. Not blocking for basic trading but required for accurate performance measurement.

**Delivers:**
- Pyth oracle integration (real-time stock prices)
- Real-time portfolio valuation (current NAV with live prices)
- Unrealized P&L calculation (mark-to-market)
- Historical performance tracking (daily NAV snapshots)
- Time-period leaderboards (daily, weekly, monthly, all-time)
- Equity curve charts (portfolio value over time)
- Advanced analytics (Sharpe ratio, max drawdown, win rate)

**Addresses:**
- Must-have: Portfolio valuation with real-time NAV
- Should-have: Advanced analytics, time-period filtering

**Stack:**
- Pyth Network (pyth-solana-receiver-sdk)
- PostgreSQL (historical NAV snapshots table)
- decimal.js (precise P&L calculations)

**Architecture:**
- Price Oracle component (wraps Pyth)
- Portfolio Service enhancements (NAV calculation, historical tracking)
- Leaderboard Service enhancements (unrealized P&L in rankings)

**Research flag:** Standard patterns (oracle integration, financial metrics calculation). Skip `/gsd:research-phase`.

---

#### Phase 5: Security Hardening + Mainnet
**Rationale:** All functional pieces exist. Now harden for real money on mainnet. Production key management, comprehensive monitoring, rate limiting, error handling, security audit.

**Delivers:**
- Production key management (transition from dev mode to HSM/MPC)
- Security audit (third-party review of key management and trading)
- Rate limiting (per-agent limits on all endpoints, stricter on trades)
- Anomaly detection (detect abnormal agent behavior, auto-suspend)
- Comprehensive monitoring (transaction success rate, balance reconciliation, key usage auditing)
- Error handling (structured error codes, actionable feedback)
- Disaster recovery (incident response runbook, key recovery procedures, platform pause mechanism)
- Withdrawal flow (with owner authorization, time delays for large amounts)
- Mainnet deployment (real USDC, real xStocks)

**Addresses:**
- Pitfall #1: Private key exposure (production HSM/MPC, no keys in logs/env)
- Pitfall #6: Agent credential compromise (anomaly detection, per-trade auth)

**Stack:**
- Turnkey/Crossmint production setup (HSM or MPC)
- AWS CloudHSM or equivalent (if needed)
- Monitoring: Datadog, Sentry, or similar
- Redis (rate limiting sliding windows)

**Architecture:**
- Wallet Service hardening (production key storage)
- Rate limiting middleware
- Anomaly detection service
- Monitoring instrumentation across all components

**Research flag:** **NEEDS `/gsd:research-phase`** — Production HSM/MPC provider selection (Turnkey vs. Crossmint vs. Fireblocks, pricing, API patterns), anomaly detection algorithms for trading behavior, disaster recovery procedures for custodial platforms. This is specialized infrastructure work.

---

### Phase Ordering Rationale

- **Legal first (Phase 0)** because building an unregistered securities platform is existential risk. Must be resolved before writing code.
- **Foundation first (Phase 1)** because everything depends on "agent has wallet." Key management architecture is structural — cannot be retrofitted.
- **Trading second (Phase 2)** because it's the core value proposition. Depends on Phase 1.
- **Leaderboard third (Phase 3)** because it depends on Phase 2 (needs portfolio data). Can be developed in parallel with Phase 4.
- **Price feeds fourth (Phase 4)** because they enhance Phase 3 (leaderboard) with unrealized P&L. Not blocking for basic trading.
- **Security hardening last (Phase 5)** because it hardens all components together. Requires everything to exist first.

**Critical path:** Phase 0 → Phase 1 → Phase 2 → (Phase 3 + Phase 4 in parallel) → Phase 5

**Key dependencies identified:**
- Phase 2 trading cannot start until Phase 1 wallets exist
- Phase 3 leaderboard cannot rank until Phase 2 produces portfolio data
- Phase 5 security audit requires all components to exist
- Phase 0 legal must gate everything (if legal says "no," project cannot proceed)

### Research Flags

**Phases needing deeper research during planning:**

- **Phase 2 (Trading Core):** xStocks integration specifics (token addresses, liquidity analysis, Transfer Hook behavior, whitelisting process with Backed Finance); Jupiter Ultra API usage patterns (order construction, execution flow, rate limits, error handling); Solana transaction optimization (priority fee estimation APIs, Jito bundle submission, retry logic patterns, MEV protection strategies). This is complex, domain-specific work with sparse documentation.

- **Phase 5 (Security Hardening):** Production HSM/MPC provider selection (Turnkey vs. Crossmint vs. Fireblocks comparison, pricing for automated signing volume, API integration patterns); anomaly detection algorithms for trading behavior (sudden volume spikes, pattern changes, wash trading detection); disaster recovery procedures for custodial platforms (key recovery, fund recovery, incident response).

**Phases with standard patterns (skip research-phase):**

- **Phase 1 (Foundation):** Custodial wallet architecture, JWT verification, database schema design are all well-documented patterns. Moltbook JWT verification may need API exploration but doesn't warrant full research-phase.

- **Phase 3 (Leaderboard + Dashboard):** Real-time leaderboard system design, WebSocket updates, Next.js dashboard are established patterns with abundant documentation.

- **Phase 4 (Price Feeds + P&L):** Oracle integration, financial metrics calculation (Sharpe, drawdown) are well-documented.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH for core (Solana, Hono, Next.js, PostgreSQL); MEDIUM for wallet provider (Turnkey recommended but needs validation); LOW for xStocks vs. Ondo selection (xStocks dominates today but Ondo has more assets) | Core technologies are industry standard with official documentation. Tokenized stock protocol landscape is new (Ondo launched Jan 2026). |
| Features | MEDIUM | Table stakes features are clear from competitor analysis (ForgeAI, NoF1.ai). Moltbook identity integration confidence is LOW — the `/api/v1/agents/verify-identity` endpoint referenced in PROJECT.md is not documented in public Moltbook API docs. May be planned or private API. |
| Architecture | HIGH | CQRS, event-driven updates, security isolation patterns are well-established in trading platforms. Solana-specific transaction handling (simulation, priority fees, retry logic) is documented by Helius, QuickNode, and official Solana docs. |
| Pitfalls | HIGH | Chainalysis theft data (2024-2025), Bybit hack post-mortem, Solana transaction failure research (ACM paper), SEC guidance, Token Extensions documentation, CyberArk AI agent security report all provide authoritative sources. |

**Overall confidence:** MEDIUM

The core technical stack and architecture patterns are well-understood with high confidence. The uncertainty comes from three areas:

1. **Tokenized stock protocol selection:** xStocks vs. Ondo vs. others. xStocks has market share today but Ondo has more assets and institutional backing. The right choice may depend on regulatory positioning and liquidity evolution.

2. **Moltbook identity integration:** PROJECT.md references endpoints not visible in public Moltbook API docs. This may work as described but needs validation.

3. **Regulatory compliance:** The SEC framework for tokenized securities is evolving rapidly (SEC Chairman Atkins directed staff to consider "innovation exemptions" in Jan 2026, but these are not finalized). Legal clarity is LOW and must be resolved before development.

### Gaps to Address

**During Phase 0 (Legal):**
- Determine if MoltApp needs broker-dealer registration, ATS registration, or qualifies for exemption
- Confirm whether direct integration with xStocks/Ondo is possible or requires broker-dealer intermediary
- Clarify jurisdiction restrictions (xStocks/Ondo exclude US persons; how does this affect agent participation?)
- Establish compliance framework for Transfer Hook requirements

**During Phase 1 (Foundation):**
- Validate Moltbook identity verification flow (confirm `/api/v1/agents/verify-identity` endpoint exists and behavior)
- Evaluate Turnkey vs. Crossmint for production key management (pricing, signing latency, API maturity)
- Determine hot wallet funding strategy (how much SOL/USDC in hot wallets vs. cold storage)

**During Phase 2 (Trading Core):**
- Test xStocks liquidity with realistic order sizes (what slippage for $1K, $10K, $100K orders?)
- Confirm xStocks Transfer Hook requirements (which wallets need whitelisting? how long does whitelisting take?)
- Benchmark Jupiter Ultra API rate limits and transaction success rates in testnet
- Determine if Ondo should be added in Phase 2 or deferred to later phase based on DEX liquidity maturity

**During Phase 4 (Price Feeds):**
- Confirm Pyth price feeds cover all xStocks tokens (60+ stocks/ETFs)
- Handle after-hours pricing for tokenized stocks (what price is used when US markets are closed?)

**During Phase 5 (Security Hardening):**
- Determine insurance or reserve fund strategy for potential exploits
- Establish withdrawal limits and time delays (threshold amounts, delay duration)
- Define anomaly detection thresholds (how much volume spike triggers suspension?)

## Sources

### Stack Research
**PRIMARY (HIGH confidence):**
- [Solana xStocks Case Study](https://solana.com/news/case-study-xstocks) — Official Solana Foundation case study on xStocks; 93% market share, $186M AUM, 80-100K monthly wallets
- [Ondo Finance Brings 200+ Tokenized Stocks to Solana (CoinDesk, Jan 2026)](https://www.coindesk.com/business/2026/01/21/ondo-finance-brings-200-tokenized-u-s-stocks-and-etfs-to-solana) — Ondo launch announcement
- [Solana JavaScript SDK (@solana/kit)](https://solana.com/docs/clients/official/javascript) — Official Solana documentation
- [Hono Framework Docs](https://hono.dev/docs/) — Official framework documentation
- [Drizzle ORM PostgreSQL](https://orm.drizzle.team/docs/get-started/postgresql-new) — Official ORM documentation
- [Next.js 16 Upgrade Guide](https://nextjs.org/docs/app/guides/upgrading/version-16) — Official Next.js documentation

**SECONDARY (MEDIUM confidence):**
- [xStocks Developer Field Guide (BlockEden)](https://blockeden.xyz/blog/2025/09/03/xstocks-on-solana-a-developer-s-field-guide-to-tokenized-equities/) — Developer integration guide
- [Turnkey Solana Wallets](https://www.turnkey.com/blog/best-solana-wallets-dapp-developers) — Wallet infrastructure comparison
- [Best TypeScript Backend Frameworks 2026 (Encore)](https://encore.dev/articles/best-typescript-backend-frameworks) — Framework comparison

### Features Research
**PRIMARY (HIGH confidence):**
- [Ondo Finance Launches 200+ Tokenized Stocks on Solana (CoinDesk)](https://www.coindesk.com/business/2026/01/21/ondo-finance-brings-200-tokenized-u-s-stocks-and-etfs-to-solana) — Key enabling technology
- [Solana Tokenized Equities Report](https://solana.com/tokenized-equities) — Solana Foundation report

**SECONDARY (MEDIUM confidence):**
- [AI-Trader GitHub (HKUDS)](https://github.com/HKUDS/AI-Trader) — AI trading benchmark reference
- [ForgeAI Platform](https://forgeai.gg) — Competitor analysis (Solana AI agent competition)
- [NoF1.ai Alpha Arena](https://www.onedayadvisor.com/2026/01/AI-stock-trading.html) — Competitor analysis (live AI trading competition)
- [Crossmint Solana Custodial Wallets](https://docs.crossmint.com/wallets/quickstarts/solana/solana-custodial-server-side) — Wallet infrastructure docs

### Architecture Research
**PRIMARY (HIGH confidence):**
- [Jupiter Ultra Swap API Docs](https://dev.jup.ag/docs/ultra) — Official API documentation
- [Solana Token Extensions - Official](https://solana.com/solutions/token-extensions) — Token-2022 documentation
- [Solana Transfer Hook Guide - Official](https://solana.com/developers/guides/token-extensions/transfer-hook) — Transfer Hook implementation
- [Pyth Network Price Feeds - Official](https://docs.pyth.network/price-feeds/core/use-real-time-data/pull-integration/solana) — Oracle integration docs

**SECONDARY (MEDIUM confidence):**
- [Solana Trading Bot Architecture Guide (2026) - RPC Fast](https://rpcfast.com/blog/solana-trading-bot-guide) — Architecture patterns
- [Leaderboard System Design - systemdesign.one](https://systemdesign.one/leaderboard-system-design/) — System design patterns
- [Redis Leaderboards - Official](https://redis.io/solutions/leaderboards/) — Redis patterns
- [Crossmint WaaS Solana Docs](https://docs.crossmint.com/wallets/quickstarts/solana/solana-custodial-server-side) — Custody infrastructure

### Pitfalls Research
**PRIMARY (HIGH confidence):**
- [Chainalysis: $2.2B Stolen in 2024](https://www.chainalysis.com/blog/crypto-hacking-stolen-funds-2025/) — Theft statistics, private key compromise data
- [Chainalysis: 2025 Crypto Theft $3.4B](https://www.chainalysis.com/blog/crypto-hacking-stolen-funds-2026/) — Updated 2025 data
- [Helius: Solana Hacks Complete History](https://www.helius.dev/blog/solana-hacks) — Slope Wallet case study
- [Solana: Transaction Fees](https://solana.com/docs/core/fees) — Official fee documentation
- [Solana: Production Readiness](https://solana.com/docs/payments/production-readiness) — Official production guidance
- [Helius: Optimizing Transactions](https://www.helius.dev/docs/sending-transactions/optimizing-transactions) — Transaction optimization guide
- [SEC: Tokenized US Equities Written Testimony (Jan 2026)](https://www.sec.gov/files/ctf-written-james-overdahl-tokenized-us-equities-01-22-2026.pdf) — SEC regulatory framework
- [Federal Register: Nasdaq Tokenized Securities Proposal (Jan 2026)](https://www.federalregister.gov/documents/2026/01/30/2026-01823/self-regulatory-organizations-the-nasdaq-stock-market-llc-notice-of-filing-of-a-proposed-rule-change) — ATS registration requirements
- [CyberArk: AI Agents and Identity Risks 2026](https://www.cyberark.com/resources/blog/ai-agents-and-identity-risks-how-security-will-shift-in-2026) — AI agent security threats
- [NIST: RFI on Securing AI Agent Systems (Jan 2026)](https://www.nist.gov/news-events/news/2026/01/caisi-issues-request-information-about-securing-ai-agent-systems) — Government security guidance

**SECONDARY (MEDIUM confidence):**
- [ACM: Why Does My Transaction Fail on Solana](https://dl.acm.org/doi/10.1145/3728943) — Academic research on 58% transaction failure rate
- [QuickNode: Optimize Solana Transactions](https://www.quicknode.com/guides/solana-development/transactions/how-to-optimize-solana-transactions) — Optimization techniques
- [Arnold & Porter: SEC and NYDFS Custody Guidance](https://www.arnoldporter.com/en/perspectives/advisories/2025/10/new-crypto-guidance-on-custody-and-blockchain-analytics) — Regulatory compliance
- [TRM Labs: Global Crypto Policy Outlook 2025/26](https://www.trmlabs.com/reports-and-whitepapers/global-crypto-policy-review-outlook-2025-26) — Regulatory landscape

---
*Research completed: 2026-02-01*
*Ready for roadmap: yes*
