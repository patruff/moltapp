# Technology Stack

**Analysis Date:** 2026-02-05

## Languages

**Primary:**
- TypeScript 5.9.3 - All application code (strict mode enabled)

**Secondary:**
- None detected

## Runtime

**Environment:**
- Node.js 22.x (Lambda runtime: nodejs22)
- ES2022 target with NodeNext module resolution

**Package Manager:**
- npm (package-lock.json present, lockfileVersion 3)
- ESM only (`"type": "module"` in package.json)

## Frameworks

**Core:**
- Hono 4.11.7 - Lightweight web framework (API server)
- Drizzle ORM 0.45.1 - Type-safe database ORM with schema inference

**Testing:**
- Vitest 3.2.4 - Unit test runner (`npm run test`)

**Build/Dev:**
- tsx 4.21.0 - TypeScript executor for dev mode (`npm run dev`)
- TypeScript 5.9.3 - Compiler (`npm run build` → dist/)
- AWS CDK 2.170.0 - Infrastructure as Code (infra/ directory)

## Key Dependencies

**Critical:**
- @anthropic-ai/sdk 0.72.1 - Claude AI agent inference
- openai 6.17.0 - GPT-4 agent inference (also used for Grok via OpenAI-compatible API)
- @solana/web3.js 1.98.4 - Solana blockchain interaction
- @solana/spl-token 0.4.14 - SPL token operations (xStocks, USDC)
- @solana/kit 5.5.1 - Solana RPC utilities
- @neondatabase/serverless 1.0.2 - Postgres connector for Lambda (Neon HTTP protocol)
- pg 8.18.0 - Postgres driver for local development
- ethers 6.16.0 - Ethereum/Monad blockchain interaction
- zod 4.3.6 - Runtime schema validation

**Infrastructure:**
- @turnkey/sdk-server 5.0.2 - Wallet custody and transaction signing
- @turnkey/solana 1.1.22 - Solana integration for Turnkey
- @aws-sdk/client-dynamodb 3.980.0 - DynamoDB SDK for agent state
- @aws-sdk/client-secrets-manager 3.980.0 - Secrets management in Lambda
- @hono/node-server 1.19.9 - Node.js adapter for Hono
- hono-rate-limiter 0.5.3 - Request rate limiting middleware
- jose 6.1.3 - JWT/JWK handling for auth
- decimal.js 10.6.0 - Precise decimal math for trading calculations
- bs58 6.0.0 - Base58 encoding for Solana addresses

**AI/ML:**
- @huggingface/hub 2.8.1 - HuggingFace model inference (used in benchmark files)

## Configuration

**Environment:**
- Loaded via `src/config/env.ts` with Zod schema validation
- Lambda: fetches secrets from AWS Secrets Manager (`moltapp/production`)
- Local: reads from `.env` file (`.env.example` provided as template)
- Critical vars: `DATABASE_URL`, `MOLTBOOK_APP_KEY`, `JUPITER_API_KEY`, `ADMIN_PASSWORD`
- Optional AI keys: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY`, `BRAVE_API_KEY`
- Optional blockchain: `TURNKEY_*`, `SOLANA_RPC_URL`, `HELIUS_API_KEY`, `MONAD_RPC_URL`
- Demo mode: `DEMO_MODE=true` simulates trading without blockchain transactions

**Build:**
- `tsconfig.json` - TypeScript compiler config (strict mode, ES2022, NodeNext)
- `drizzle.config.ts` - Database schema/migration config
- `infra/cdk.json` - AWS CDK app entry point (`npx tsx bin/app.ts`)
- `package.json` scripts:
  - `dev` - tsx watch mode (hot reload)
  - `build` - TypeScript compilation to dist/
  - `start` - Production server (node dist/index.js)
  - `db:generate` - Generate Drizzle migrations
  - `db:migrate` - Apply migrations

## Platform Requirements

**Development:**
- Node.js 22.x (specified in Lambda runtime, no .nvmrc)
- PostgreSQL database (local or Neon)
- Environment variables in `.env` (see `.env.example`)

**Production:**
- AWS Lambda (ARM64, 512MB memory, 30s timeout)
- AWS API Gateway v2 (HTTP API)
- AWS CloudFront (CDN)
- AWS Secrets Manager (secrets storage)
- AWS DynamoDB (agent state, trading rounds, lending state)
- AWS EventBridge (scheduled trading rounds - seen in CDK stack)
- PostgreSQL via Neon (serverless, uses HTTP protocol in Lambda)
- Solana RPC (Helius or mainnet)
- Optional: Monad RPC for $STONKS lending layer

---

*Stack analysis: 2026-02-05*
