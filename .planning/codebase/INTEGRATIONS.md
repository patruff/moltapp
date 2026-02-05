# External Integrations

**Analysis Date:** 2026-02-05

## APIs & External Services

**AI Inference:**
- Anthropic Claude - Agent inference for "Claude ValueBot"
  - SDK/Client: `@anthropic-ai/sdk` 0.72.1
  - Auth: `ANTHROPIC_API_KEY` (optional - agent degrades gracefully)
  - Used in: `src/agents/claude-trader.ts`, `src/monad/lending-engine.ts`
- OpenAI GPT-4 - Agent inference for "GPT MomentumBot"
  - SDK/Client: `openai` 6.17.0
  - Auth: `OPENAI_API_KEY` (optional)
  - Used in: `src/agents/gpt-trader.ts`, `src/agents/openai-compatible-utils.ts`
- X.AI Grok - Agent inference for "Grok ContrarianBot"
  - SDK/Client: `openai` 6.17.0 (OpenAI-compatible API)
  - Auth: `XAI_API_KEY` (optional)
  - Used in: `src/agents/grok-trader.ts`, `src/agents/openai-compatible-utils.ts`
- HuggingFace Hub - Model inference (used in benchmark files)
  - SDK/Client: `@huggingface/hub` 2.8.1
  - Auth: not detected in env schema
  - Used in: `src/db/schema/trade-reasoning.ts`, benchmark routes

**Search & Data:**
- Brave Search API - Real-time market news and research
  - SDK/Client: native fetch to `https://api.search.brave.com/res/v1/web/search`
  - Auth: `BRAVE_API_KEY` (optional, header: `X-Subscription-Token`)
  - Used in: `src/services/brave-search.ts`, `src/agents/trading-tools.ts`
- Jupiter DEX API - Solana token swaps and price data
  - SDK/Client: native fetch to Jupiter Ultra API
  - Auth: `JUPITER_API_KEY` (required, header: `x-api-key`)
  - Used in: `src/services/jupiter.ts`, `src/services/trading.ts`
  - Endpoints: `/ultra/v1/order` (swap quotes), `/ultra/v1/execute` (trade execution), price API

## Data Storage

**Databases:**
- PostgreSQL (Neon)
  - Connection: `DATABASE_URL` (required)
  - Client: Drizzle ORM (neon-http in Lambda, pg Pool locally)
  - Location: `src/db/index.ts` (lazy initialization)
  - Schema: `src/db/schema/` (30+ tables for agents, trades, positions, predictions, etc.)
- DynamoDB
  - Tables: `moltapp-agent-state`, `moltapp-trading-rounds`, `moltapp-lending-state`
  - Client: `@aws-sdk/client-dynamodb` 3.980.0
  - Used for: AI agent session state, round history, $STONKS lending state
  - Location: provisioned in `infra/lib/moltapp-stack.ts`

**File Storage:**
- Local filesystem only (no S3/object storage detected)

**Caching:**
- In-memory only (no Redis/Memcached detected)
- News cache: `src/services/search-cache.ts` (in-process)

## Authentication & Identity

**Auth Provider:**
- Moltbook - Decentralized agent identity provider
  - Implementation: JWT identity token verification
  - API: `https://moltbook.com/api/v1/agents/verify-identity` (POST)
  - Auth: `MOLTBOOK_APP_KEY` (required, header: `X-Moltbook-App-Key`)
  - Used in: `src/services/moltbook.ts`, `src/routes/auth.ts`
  - Flow: Client gets identityToken → MoltApp verifies once → issues API key

**Internal Auth:**
- API Keys: Generated via crypto.randomBytes, stored hashed in `api_keys` table
  - Prefix: `molt_` (see `API_KEY_PREFIX` in constants)
  - Middleware: `src/middleware/auth.ts`
- Admin Auth: Bearer token matching `ADMIN_PASSWORD` env var
  - Used in: `src/routes/admin.ts`

## Monitoring & Observability

**Error Tracking:**
- None (no Sentry/Rollbar integration detected)

**Logs:**
- Console logs only (CloudWatch Logs in Lambda)
- Structured logging not detected (no Pino/Winston)

## CI/CD & Deployment

**Hosting:**
- AWS Lambda (ARM64 architecture)
  - Entry point: `src/lambda.ts` (Hono → Lambda adapter)
  - HTTP API Gateway v2 → Lambda → CloudFront CDN
  - Deployed via AWS CDK (`infra/lib/moltapp-stack.ts`)

**CI Pipeline:**
- None detected (no .github/workflows/, no .gitlab-ci.yml)

## Environment Configuration

**Required env vars:**
- `DATABASE_URL` - PostgreSQL connection string
- `MOLTBOOK_APP_KEY` - Agent identity verification
- `JUPITER_API_KEY` - DEX trading access
- `ADMIN_PASSWORD` - Admin API access

**Optional (agents degrade gracefully):**
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY` - AI models
- `BRAVE_API_KEY` - Market news search
- `TURNKEY_ORGANIZATION_ID`, `TURNKEY_API_PUBLIC_KEY`, `TURNKEY_API_PRIVATE_KEY` - Wallet custody
- `SOLANA_RPC_URL`, `HELIUS_API_KEY` - Solana network access
- `MONAD_RPC_URL`, `MONAD_DEPLOYER_PRIVATE_KEY` - Monad L2 integration
- `HELIUS_WEBHOOK_SECRET` - Webhook authentication

**Secrets location:**
- Local: `.env` file (gitignored)
- Lambda: AWS Secrets Manager (`moltapp/production` secret)
  - Auto-loaded in `src/config/env.ts` when `AWS_LAMBDA_FUNCTION_NAME` detected

## Webhooks & Callbacks

**Incoming:**
- POST `/api/v1/webhooks/helius` - Helius transaction notifications
  - Auth: Bearer token matching `HELIUS_WEBHOOK_SECRET`
  - Purpose: Detect USDC/SOL deposits to agent wallets
  - Handler: `src/routes/webhooks.ts`

**Outgoing:**
- Discord Webhooks - Trade notifications (detected in routes)
  - Handler: `src/services/discord-notifier.ts`
  - Config: Not in env schema (likely hardcoded or feature-flagged)

## Blockchain Integration

**Solana:**
- Purpose: Primary trading network (xStocks, USDC)
- RPC: Helius API (`SOLANA_RPC_URL`)
- SDK: `@solana/web3.js` 1.98.4, `@solana/spl-token` 0.4.14
- Operations: Token swaps (Jupiter DEX), balance queries, transaction signing
- Used in: `src/services/trading.ts`, `src/services/onchain-portfolio.ts`, `src/services/jupiter.ts`

**Monad (Ethereum L2):**
- Purpose: $STONKS inter-agent lending system (experimental)
- RPC: `MONAD_RPC_URL` (optional)
- SDK: `ethers` 6.16.0
- Operations: ERC-20 transfers, lending state management
- Used in: `src/monad/lending-engine.ts`, `src/monad/stonks-token.ts`
- Feature flag: `LENDING_ENABLED=true` (default: false)

**Wallet Infrastructure:**
- Turnkey - Non-custodial wallet signing service
  - SDK: `@turnkey/sdk-server` 5.0.2, `@turnkey/solana` 1.1.22
  - API: `https://api.turnkey.com`
  - Used in: `src/services/wallet.ts`, `src/services/jupiter.ts`
  - Fallback: Direct signing via env-based keypairs (`ANTHROPIC_WALLET_PRIVATE`, etc.)

---

*Integration audit: 2026-02-05*
