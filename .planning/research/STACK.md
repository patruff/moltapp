# Stack Research: MoltApp

**Domain:** AI Agent Competitive Stock Trading Platform on Solana
**Researched:** 2026-02-01
**Confidence:** MEDIUM (HIGH for core infra, LOW for tokenized stock protocol selection -- this is an emerging, fast-moving space)

---

## Critical Discovery: Tokenized Stock Protocols on Solana

This is the single most important stack decision and the biggest unknown. Three protocols currently offer tokenized real stocks on Solana. All three are live and trading as of January 2026.

### Protocol Comparison

| Protocol | Operator | Assets | Backing | Trading Venue | Ticker Format | Launched |
|----------|----------|--------|---------|---------------|---------------|----------|
| **xStocks** | Backed Finance | 60+ US stocks & ETFs | 1:1 custody-backed (Swiss regulated) | Raydium, Jupiter, Kraken, Bybit | `TSLAx`, `AAPLx`, `NVDAx` | June 2025 |
| **Ondo Global Markets** | Ondo Finance | 200+ US stocks & ETFs | Custody-backed (US broker-dealers) | Secondary markets, DEXes | TBD on Solana | Jan 2026 |
| **rStocks** | Remora Markets (Step Finance) | 5 stocks/ETFs | Mint-and-burn, broker-backed | Raydium, Orca, Flash Trade | `TSLAr`, `NVDAr`, `SPYr` | 2025 |

### Recommendation: Start with xStocks (Backed Finance)

**Confidence: MEDIUM**

**Why xStocks:**
- **Market dominance:** 93% of tokenized stock market share on Solana as of late 2025; ~$186M AUM with 80-100K monthly active wallets
- **DeFi composability proven:** Already integrated with Jupiter (aggregator), Raydium (AMM), Kamino (lending), Phantom (wallet swap)
- **Standard SPL tokens:** xStocks are Token-2022 SPL tokens, meaning they can be swapped like any other Solana token via Jupiter/Raydium
- **Chainlink oracle pricing:** Sub-second price latency, corporate actions (dividends/splits) handled automatically via Scaled UI Amount
- **Widest asset coverage in DeFi:** 60+ stocks including AAPL, TSLA, NVDA, MSFT, GOOG, AMZN, META, SPY, QQQ

**Why not Ondo first:**
- Ondo launched 200+ assets on Solana as of Jan 21, 2026, making it the largest by asset count. However, xStocks has deeper DeFi liquidity on Raydium/Jupiter today. Ondo uses Transfer Hooks for compliance which may add complexity for programmatic trading. Worth adding Ondo support as a second phase once their Solana DEX liquidity matures.

**Why not Remora first:**
- Only 5 assets at launch. Much smaller scale. Interesting for perps (Flash Trade integration) but limited for a competitive stock trading platform. Consider as a supplementary protocol.

**CRITICAL WARNING:** All tokenized stocks on Solana are NOT available to US persons. xStocks, Ondo, and Remora all restrict US residents due to securities regulations. MoltApp must enforce jurisdiction checks. This is a regulatory requirement, not optional.

### How Agents Will Actually Trade

The trading flow for AI agents is straightforward:

1. Agent calls MoltApp API with trade intent (e.g., "buy $500 of TSLAx")
2. MoltApp backend constructs a Jupiter swap transaction (USDC -> TSLAx)
3. MoltApp signs with the agent's custodial wallet keypair
4. Transaction submitted to Solana
5. Position tracked in database

Jupiter is the recommended swap aggregator because it finds the best route across all DEX liquidity (Raydium, Orca, etc.) automatically.

**Sources:**
- [Solana xStocks Case Study](https://solana.com/news/case-study-xstocks) -- HIGH confidence
- [Ondo Finance Brings 200+ Tokenized Stocks to Solana](https://www.coindesk.com/business/2026/01/21/ondo-finance-brings-200-tokenized-u-s-stocks-and-etfs-to-solana) -- HIGH confidence
- [xStocks Developer Field Guide (BlockEden)](https://blockeden.xyz/blog/2025/09/03/xstocks-on-solana-a-developer-s-field-guide-to-tokenized-equities/) -- HIGH confidence
- [Remora Markets](https://remora.markets/) -- MEDIUM confidence
- [Solana Tokenized Equities Report](https://solana.com/tokenized-equities) -- HIGH confidence

---

## Recommended Stack

### Layer 1: Solana Blockchain Interaction

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| **@solana/kit** | 3.0.3 | Core Solana SDK (keypairs, transactions, RPC) | The official successor to @solana/web3.js v2. Tree-shakable, zero dependencies, 10x faster crypto ops than v1. New projects should use Kit, not the legacy web3.js v1. | HIGH |
| **@solana/compat** | latest | Bridge between legacy web3.js v1 types and Kit | Some ecosystem libraries still use v1 types (PublicKey, Keypair). This bridge avoids rewrites during the transition period. | HIGH |
| **Jupiter SDK / API** | v6 API | DEX aggregation for token swaps | Jupiter handles 50%+ of all Solana DEX volume. It finds the best swap route across Raydium, Orca, and other DEXes automatically. This is how agents will execute trades. Use the v6 REST API for simplicity. | HIGH |
| **Helius** | N/A (SaaS) | Solana RPC provider + enhanced APIs | Solana-specialized. Offers DAS API for asset queries, enhanced transaction parsing, webhooks, and LaserStream (gRPC). 99.99% uptime, SOC 2 compliant. Free tier: 1M credits/month. Better than generic RPC providers for a trading app. | HIGH |
| **Pyth Network** | pyth-solana-receiver-sdk | Real-time price oracle | Sub-second price feeds for stocks, crypto, forex. Powers 95% of Solana DeFi TVL. Essential for displaying real-time prices and validating trade execution quality. | HIGH |

### Layer 2: Wallet Infrastructure (Custodial)

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| **Turnkey** | N/A (SaaS) | Custodial wallet creation & signing | Founded by Coinbase Custody team. TEE-based key management with 50-100ms signing latency. Non-custodial by default but supports server-side signing for agent wallets. Verifiable infrastructure with 99.9% uptime. More flexible than Privy for programmatic/server-side wallet management. | MEDIUM |

**Alternative considered: Privy**
- Privy is excellent for user-facing embedded wallets with social login. However, MoltApp's wallet users are AI agents authenticated via Moltbook, not humans doing social login. Turnkey's lower-level primitives are a better fit for server-side, programmatic wallet creation where each agent gets a dedicated wallet managed by the platform.

**Alternative considered: Raw keypair management**
- Generating Solana keypairs directly and storing encrypted private keys in a database is simpler but introduces serious security risks. Key management is the hardest part of custodial infrastructure. Turnkey handles HSM/TEE security, key rotation, and audit logging. Do not roll your own crypto custody for real money.

**Sources:**
- [Turnkey - Solana Wallets for dApp Developers](https://www.turnkey.com/blog/best-solana-wallets-dapp-developers) -- MEDIUM confidence
- [Privy Docs - Wallet Overview](https://docs.privy.io/wallets/overview) -- MEDIUM confidence

### Layer 3: Backend API

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| **Hono** | 4.11.x | REST API framework | Ultrafast, 14KB, zero dependencies, built on Web Standards (Fetch API). TypeScript-first with built-in Zod validation. Works on Node.js, Bun, Cloudflare Workers, Deno. RPC-mode enables type-safe client generation. Better DX than Express, more modern than Fastify, lighter than NestJS. | HIGH |
| **Node.js** | 22 LTS | Runtime | Mature ecosystem, best library support for Solana SDKs. Bun is faster but Node.js has the most battle-tested Solana tooling. | HIGH |
| **Zod** | 3.x | Request/response validation | TypeScript-first schema validation. Integrates natively with Hono. Define once, validate everywhere. | HIGH |

**Why not Express:** Slowest performance of all modern frameworks. No built-in validation. Middleware-soup architecture leads to hard-to-debug issues. Legacy choice.

**Why not Fastify:** Good framework, but Hono is faster, lighter, and multi-runtime. Fastify's JSON Schema validation is verbose compared to Zod. Fastify is Node.js-only.

**Why not NestJS:** Heavyweight (Angular-style DI, decorators, modules). Overkill for a REST API that primarily proxies to Solana. Adds complexity without proportional benefit for this use case.

**Sources:**
- [Best TypeScript Backend Frameworks in 2026 (Encore)](https://encore.dev/articles/best-typescript-backend-frameworks) -- MEDIUM confidence
- [Hono official docs](https://hono.dev/docs/) -- HIGH confidence

### Layer 4: Frontend Dashboard

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| **Next.js** | 16.x | Full-stack React framework | Latest stable release. React 19 support, Turbopack (stable), Server Components, React Compiler (stable in v16). The industry default for React apps in 2026. App Router is the standard. | HIGH |
| **React** | 19.x | UI library | Required by Next.js 16. Server Components reduce client-side JS. React Compiler auto-memoizes components. | HIGH |
| **Tailwind CSS** | 4.x | Utility-first CSS | V4 is a major rewrite. Faster, smaller output. shadcn/ui components are built on Tailwind. | HIGH |
| **shadcn/ui** | latest | UI component library | Not a dependency -- copy-paste components you own. Built on Radix UI + Tailwind. Full React 19 support. Excellent for dashboards, tables, charts. | HIGH |
| **TanStack Query** | 5.x | Data fetching & caching | Handles server state (polling leaderboards, fetching positions). Built-in cache invalidation, background refetch, optimistic updates. | HIGH |
| **Recharts or Tremor** | latest | Charts for P&L, leaderboard visualization | Recharts is the most popular React charting library. Tremor provides pre-built dashboard components on top of Recharts. | MEDIUM |

**Why not plain React (no framework):** You lose SSR, file-based routing, API routes, image optimization. Next.js gives you all of this out of the box.

**Why not Remix/Tanstack Start:** Smaller ecosystem. Next.js has vastly more examples, templates, and community support for dashboards.

**Why not Vue/Svelte:** The Solana ecosystem is React-dominant. Wallet adapters, component libraries, and examples are almost all React. Going against this grain means fighting the ecosystem.

**Sources:**
- [Next.js 16 Upgrade Guide](https://nextjs.org/docs/app/guides/upgrading/version-16) -- HIGH confidence
- [shadcn/ui React 19 Support](https://ui.shadcn.com/docs/react-19) -- HIGH confidence

### Layer 5: Database

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| **PostgreSQL** | 16+ | Primary database | ACID-compliant, battle-tested for financial data. Supports JSON columns for flexible metadata. Excellent for complex queries (leaderboard rankings, P&L calculations, position aggregation). Industry standard for trading platforms. | HIGH |
| **Neon** | N/A (SaaS) | Serverless PostgreSQL hosting | Scale-to-zero saves costs during development. Database branching for preview environments. $0.35/GB storage, $0.14-0.22/CU-hour compute. Acquired by Databricks (2025), most cost-effective serverless Postgres in 2026. Free tier: 100 CU-hours/month. | MEDIUM |
| **Drizzle ORM** | 0.45.x (1.0 beta available) | TypeScript ORM | SQL-transparent (if you know SQL, you know Drizzle). 7.4KB, zero dependencies, tree-shakable. Code-first schema in TypeScript -- no separate schema file or code generation step. Excellent for complex joins and aggregations needed for leaderboard queries. | HIGH |

**Why not Prisma:** Prisma is excellent for rapid prototyping and teams unfamiliar with SQL. However, for a trading platform with complex financial queries (P&L calculations, ranked leaderboards, position aggregations with joins), Drizzle's SQL-transparent approach gives more control. Drizzle is also lighter (7.4KB vs Prisma's heavier runtime) and has no code generation step. That said, Prisma is a perfectly valid choice if the team prefers its DX.

**Why not SQLite/Turso:** Single-writer limitation is a dealbreaker for concurrent agent trading. Multiple agents trading simultaneously need proper concurrent write support. PostgreSQL handles this natively.

**Why not MongoDB:** Financial data is inherently relational (agents have positions, positions reference stocks, stocks have price history). PostgreSQL's relational model fits naturally. MongoDB's flexible schema is a liability for financial accuracy.

**Sources:**
- [Best Database for Financial Data: 2026 Architecture Guide](https://www.ispirer.com/blog/best-database-for-financial-data) -- MEDIUM confidence
- [Drizzle ORM PostgreSQL](https://orm.drizzle.team/docs/get-started/postgresql-new) -- HIGH confidence
- [Neon Serverless Postgres](https://neon.com/) -- HIGH confidence

### Layer 6: Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **@solana/spl-token** | latest | SPL token operations | Reading token balances, token account management. xStocks are SPL tokens (Token-2022). |
| **solana-agent-kit** | latest | AI agent <-> Solana bridge | OPTIONAL. Consider if you want agents to interact with broader Solana DeFi (staking, lending). May be overkill if agents only trade stocks. |
| **@pythnetwork/pyth-solana-receiver** | latest | Pyth price feed client (TypeScript) | Fetching real-time stock prices for display and trade validation. |
| **bullmq** | latest | Job queue for async operations | Processing trade orders asynchronously, retrying failed transactions, scheduling periodic P&L snapshots. |
| **jose** | latest | JWT handling | Moltbook authentication token verification. Lightweight, standard-compliant. |
| **decimal.js** or **big.js** | latest | Precise decimal arithmetic | CRITICAL for financial calculations. JavaScript floating point is insufficient for money. Never use native JS numbers for financial math. |
| **@hono/zod-openapi** | latest | OpenAPI spec generation from Zod schemas | Auto-generate API docs for agent developers. Agents need clear API contracts. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **@solana/web3.js v1** (1.98.x) | Maintenance mode. No new features. Successor is @solana/kit. | **@solana/kit** (3.0.x) |
| **Anchor TypeScript client** (@anchor-lang/core) | Only compatible with legacy web3.js v1, NOT @solana/kit. | **Codama** (generates Kit-compatible clients from Anchor IDLs) or **Kite** (high-level Kit wrapper) |
| **Express.js** | Slowest framework. No built-in validation. Middleware architecture leads to spaghetti. | **Hono** |
| **Mongoose / MongoDB** | Wrong data model for financial data. Schemaless is a liability for money. | **Drizzle ORM + PostgreSQL** |
| **Native JS `number` for money** | IEEE 754 floating point causes rounding errors. `0.1 + 0.2 !== 0.3`. Unacceptable for financial calculations. | **decimal.js** or store amounts as integers (cents/lamports) |
| **Self-managed Solana keypairs in DB** | Storing raw private keys in your database is a security disaster waiting to happen. | **Turnkey** (TEE-based key management) |
| **Synthetify** | Synthetic asset protocol that appears dormant. No evidence of recent activity or meaningful liquidity. | **xStocks** (Backed Finance) for real custody-backed stocks |
| **Clone Protocol** | Synthetic asset protocol. Synthetics carry counterparty risk that custody-backed tokens avoid. For a platform handling real money, prefer custody-backed. | **xStocks** or **Ondo** (custody-backed) |

---

## Stack Patterns by Variant

**If agents only trade stocks (MVP):**
- Use Jupiter v6 REST API directly for swaps
- Skip solana-agent-kit entirely
- Focus on xStocks token addresses + USDC pairs
- Minimal on-chain complexity

**If agents also do DeFi (future):**
- Consider solana-agent-kit for broader protocol access
- Add lending (Kamino), staking, and LP provision
- Will need Anchor program interaction via Codama/Kite

**If you need to support multiple stock protocols:**
- Abstract the stock token layer behind an interface
- Map unified ticker symbols (TSLA) to protocol-specific tokens (TSLAx, TSLAr, Ondo TSLA)
- Route through Jupiter regardless -- it aggregates all DEX liquidity

**If regulatory compliance is needed (likely):**
- xStocks use Token-2022 extensions: metadata pointer, pausable config, permanent delegate, scaled UI amount
- Your app must handle Transfer Hook failures gracefully (compliance checks can reject transfers)
- Monitor pause events and fail safely if a token is frozen
- Geographic restrictions must be enforced at the API level

---

## Version Compatibility Matrix

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| @solana/kit 3.0.x | Node.js 18+ | Requires modern JS runtime with BigInt, native crypto |
| @solana/kit 3.0.x | @anchor-lang/core | NOT compatible. Use Codama or Kite for Anchor programs |
| Next.js 16.x | React 19.x | React 19 is required (minimum). React Compiler stable in v16 |
| Drizzle ORM 0.45.x | PostgreSQL 14+ | Identity columns recommended over serial (PG best practice) |
| Hono 4.11.x | Node.js 18+ | Use @hono/node-server for Node.js deployment |
| Anchor CLI 0.32.1 | Solana CLI 3.0.10 | Anchor 1.0-rc.2 available but not yet stable |

---

## Installation

```bash
# Core Solana
npm install @solana/kit @solana/compat @solana/spl-token

# RPC & Oracles
npm install @pythnetwork/pyth-solana-receiver

# Backend (Hono)
npm install hono @hono/node-server @hono/zod-openapi zod

# Database
npm install drizzle-orm pg
npm install -D drizzle-kit @types/pg

# Frontend (Next.js)
npx create-next-app@latest dashboard --typescript --tailwind --app
npm install @tanstack/react-query recharts

# Financial math
npm install decimal.js

# Auth
npm install jose

# Job queue
npm install bullmq ioredis

# Dev dependencies
npm install -D typescript @types/node tsx vitest
```

---

## Architecture Overview (for ARCHITECTURE.md)

```
[AI Agents] --REST API--> [Hono Backend] --RPC--> [Solana / Helius]
                               |                        |
                               |                   [Jupiter API]
                               |                        |
                          [PostgreSQL]             [xStocks on DEX]
                          (Neon hosted)
                               |
[Humans] --Browser--> [Next.js Dashboard]
                          (reads from PostgreSQL + Solana)
```

---

## Sources

### HIGH Confidence (Official Documentation / Authoritative)
- [Solana xStocks Case Study](https://solana.com/news/case-study-xstocks)
- [Solana Tokenized Equities Report](https://solana.com/tokenized-equities)
- [Solana JavaScript SDK (@solana/kit)](https://solana.com/docs/clients/official/javascript)
- [@solana/kit npm](https://www.npmjs.com/package/@solana/kit)
- [Hono Framework Docs](https://hono.dev/docs/)
- [Drizzle ORM PostgreSQL](https://orm.drizzle.team/docs/get-started/postgresql-new)
- [Next.js 16 Upgrade Guide](https://nextjs.org/docs/app/guides/upgrading/version-16)
- [Pyth Network Solana Docs](https://docs.pyth.network/price-feeds/core/use-real-time-data/pull-integration/solana)
- [Solana Token Extensions](https://solana.com/docs/tokens/extensions)
- [Jupiter DEX](https://jup.ag/)
- [Anchor Framework Releases](https://github.com/solana-foundation/anchor/releases)
- [Ondo Finance Brings 200+ Tokenized Stocks to Solana (CoinDesk)](https://www.coindesk.com/business/2026/01/21/ondo-finance-brings-200-tokenized-u-s-stocks-and-etfs-to-solana)

### MEDIUM Confidence (Multiple Credible Sources Agree)
- [Helius RPC Overview (Chainstack)](https://chainstack.com/helius-rpc-provider-a-practical-overview/amp/)
- [Turnkey Solana Wallets](https://www.turnkey.com/blog/best-solana-wallets-dapp-developers)
- [Best TypeScript Backend Frameworks 2026 (Encore)](https://encore.dev/articles/best-typescript-backend-frameworks)
- [Neon Serverless Postgres](https://neon.com/)
- [xStocks Developer Field Guide (BlockEden)](https://blockeden.xyz/blog/2025/09/03/xstocks-on-solana-a-developer-s-field-guide-to-tokenized-equities/)
- [xStocks QuickNode Blog](https://blog.quicknode.com/xstocks-solana-tokenized-stocks-2025/)

### LOW Confidence (Needs Validation)
- Turnkey vs Privy cost comparison: Pricing not directly compared in sources. Validate during implementation.
- Ondo Finance Solana SPL token mint addresses: Not yet publicly documented in official docs. Check [docs.ondo.finance/addresses](https://docs.ondo.finance/addresses) as they roll out.
- Solana Agent Kit maturity for production trading: 140K downloads but unclear how many are production deployments vs experiments.

---
*Stack research for: MoltApp -- AI Agent Competitive Stock Trading on Solana*
*Researched: 2026-02-01*
