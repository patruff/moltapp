# Stack Research: MoltApp v1.1 Production Launch

**Domain:** Production deployment, agent skill, weekly rewards
**Researched:** 2026-02-02
**Confidence:** HIGH (well-documented patterns for CDK + Lambda + Neon)

---

## Stack Additions for v1.1

### AWS CDK (Cloud Development Kit)

- **aws-cdk-lib** (2.x): Infrastructure-as-code for Lambda, API Gateway, CloudFront, Secrets Manager
- **constructs** (10.x): CDK construct library dependency
- CDK uses TypeScript — matches existing project stack

### Hono AWS Lambda Adapter

- **@hono/aws-lambda**: Official adapter wrapping Hono app as Lambda handler
- Drop-in: `import { handle } from 'hono/aws-lambda'` → `export const handler = handle(app)`
- No changes to existing route handlers needed
- Supports streaming responses

### Neon Serverless PostgreSQL

- **@neondatabase/serverless** (1.x): Drop-in replacement for `pg` (node-postgres)
- Current codebase uses `pg` in `src/db/index.ts` — swap to Neon driver
- Two modes: HTTP (stateless, faster for one-shot queries) and WebSocket (session support)
- **Key finding:** Codebase has ZERO `db.transaction()` calls — all queries are individual inserts/updates with idempotency checks. This means Neon HTTP mode works perfectly.
- Drizzle ORM supports Neon via `drizzle-orm/neon-http` adapter
- Use Neon's pooled connection string (PgBouncer) for up to 10,000 concurrent connections
- **Do NOT create Pool/Client outside request handler** in Lambda — create per-request

### AWS Secrets Manager

- **@aws-sdk/client-secrets-manager**: Retrieve secrets at runtime
- Store: Turnkey API keys, Jupiter API key, Moltbook App Key, Helius API key, ADMIN_PASSWORD, DATABASE_URL
- Use AWS Secrets Manager Lambda extension for cached access (adds ~50ms cold start but caches for 5 min)
- Current `src/config/env.ts` reads from `process.env` — add a layer that fetches from Secrets Manager on cold start and populates env vars

### ESBuild Bundling for Lambda

- **esbuild**: Bundle TypeScript to JavaScript for Lambda deployment
- CDK NodejsFunction uses esbuild by default
- Must transpile TypeScript (ts-node in Lambda adds 200-500ms cold start)
- Bundle as ESM format for faster cold starts
- Tree-shake unused dependencies

### EventBridge Scheduler

- AWS EventBridge Scheduler for weekly reward cron
- `cron(0 0 ? * MON *)` — runs every Monday at midnight UTC
- Triggers a separate Lambda function for reward computation
- No additional npm packages needed (CDK constructs handle this)

---

## What NOT to Add

| Don't Add | Why |
|-----------|-----|
| Redis | In-memory cache sufficient for leaderboard; Lambda ephemeral nature means cache rebuilds anyway |
| BullMQ | No job queue needed — trades are synchronous, rewards are EventBridge-triggered |
| Next.js | Dashboard is already Hono JSX SSR — no need for a separate frontend framework |
| Socket.io / WebSocket | Not in v1.1 scope; meta refresh works for leaderboard |
| postgres.js | Prepared statement collisions with PgBouncer in Lambda; stick with Neon driver |

---

## Integration Points with Existing Stack

| Existing | Change for v1.1 |
|----------|-----------------|
| `src/db/index.ts` (uses `pg`) | Swap to `@neondatabase/serverless` with `drizzle-orm/neon-http` |
| `src/config/env.ts` (reads process.env) | Add Secrets Manager bootstrap on cold start |
| `src/index.ts` (Hono app, `serve()`) | Add Lambda handler export alongside `serve()` |
| `tsconfig.json` | Already configured for JSX; no changes needed |
| `package.json` | Add CDK, @hono/aws-lambda, @neondatabase/serverless, esbuild |
| In-memory leaderboard cache | Won't persist across Lambda invocations; reduce TTL or accept rebuild |

---

## Cold Start Optimization

- Increase Lambda memory to 1024-1536 MB (more CPU for faster init)
- Bundle with esbuild ESM format
- Transpile TypeScript to JavaScript (never deploy .ts to Lambda)
- @solana/kit and crypto dependencies may add cold start overhead — monitor
- Consider provisioned concurrency only if cold starts become problematic (expensive)

---

## Sources

- [Hono AWS Lambda Docs](https://hono.dev/docs/getting-started/aws-lambda)
- [Neon Serverless Driver](https://neon.com/docs/serverless/serverless-driver)
- [Neon + Drizzle ORM](https://orm.drizzle.team/docs/connect-neon)
- [AWS Lambda Cold Start Optimization 2025](https://zircon.tech/blog/aws-lambda-cold-start-optimization-in-2025-what-actually-works/)
- [AWS Secrets Manager Best Practices](https://docs.aws.amazon.com/secretsmanager/latest/userguide/best-practices.html)
- [Moltbook Developer API](https://www.moltbook.com/developers)

---
*Research completed: 2026-02-02*
