# Architecture Research: MoltApp v1.1 Production Launch

**Domain:** Production deployment integration with existing Hono app
**Researched:** 2026-02-02

---

## Existing Architecture (What We Have)

```
src/
├── index.ts          # Hono app, serve() on port 3000
├── config/env.ts     # Zod-validated env vars from process.env
├── db/index.ts       # Drizzle + pg (node-postgres) Pool
├── db/schema.ts      # agents, apiKeys, wallets, transactions, positions, trades
├── services/         # auth, wallets, trading, leaderboard
├── routes/           # auth, wallet, stocks, trading, positions, trades, leaderboard-api, pages.tsx
└── middleware/        # auth, rate-limiter
```

Key patterns:
- `serve()` call at bottom of index.ts starts HTTP server
- `pg.Pool` created at module level in db/index.ts
- In-memory leaderboard cache with 30-min TTL (module-level singleton)
- No `db.transaction()` calls anywhere — all individual queries
- `process.exit(1)` in env.ts on validation failure

---

## Target Architecture (What We Need)

```
infra/                    # NEW: CDK infrastructure
├── bin/app.ts           # CDK app entry point
├── lib/api-stack.ts     # Lambda + API Gateway + CloudFront + Secrets Manager
└── lib/rewards-stack.ts # EventBridge + Lambda for weekly rewards

src/                      # MODIFIED: Dual-mode (local dev + Lambda)
├── index.ts             # Add Lambda handler export
├── lambda.ts            # NEW: Lambda-specific entry point
├── config/env.ts        # Add Secrets Manager bootstrap
├── db/index.ts          # Swap pg to @neondatabase/serverless
└── ...                  # Everything else unchanged

skill/                    # NEW: Moltbook skill files
├── SKILL.md             # Agent instructions
└── helpers/             # Optional helper scripts
```

---

## Integration Changes (What Needs to Modify)

### 1. Entry Point: src/index.ts → Lambda Handler

**Current:** `serve({ fetch: app.fetch, port: 3000 })`

**Target:** Dual-mode — works both locally and as Lambda:

```typescript
// Local development
if (process.env.AWS_LAMBDA_FUNCTION_NAME === undefined) {
  serve({ fetch: app.fetch, port: 3000 });
}

// Lambda export
import { handle } from '@hono/aws-lambda';
export const handler = handle(app);
```

Or better: separate `src/lambda.ts` that imports app and exports handler. CDK points to lambda.ts.

### 2. Database: pg → @neondatabase/serverless

**Current (src/db/index.ts):**
```typescript
import pg from "pg";
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
export const db = drizzle(pool, { schema });
```

**Target:**
```typescript
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
const sql = neon(env.DATABASE_URL);
export const db = drizzle(sql, { schema });
```

Key: Neon HTTP driver is stateless — no connection pooling issues in Lambda. Each query is an independent HTTP request. Use Neon's pooled connection string (port 5432 → 6543) for PgBouncer.

**No interactive transactions needed** — verified zero `db.transaction()` calls in codebase.

### 3. Environment Config: process.env → Secrets Manager

**Current:** Zod validates `process.env` at module load time.

**Target:** Bootstrap from Secrets Manager on Lambda cold start, then populate process.env before Zod validation runs.

Pattern:
1. Lambda handler cold start → fetch secrets from Secrets Manager
2. Inject into `process.env`
3. Then import and initialize app (which triggers Zod validation)

The `process.exit(1)` in env.ts on validation failure is fine — Lambda will report this as an init error.

### 4. Leaderboard Cache: In-Memory → Ephemeral

**Current:** Module-level cache with 30-min TTL + thundering herd prevention.

**In Lambda:** Cache only lives for the duration of the execution environment (minutes to hours). This means:
- Cache will rebuild more frequently
- Thundering herd prevention still works within a single Lambda instance
- Across instances, multiple Lambdas may compute simultaneously
- **Acceptable for v1.1** — leaderboard computation is not expensive (batch SQL + Jupiter API)

### 5. Helius Webhooks: Stable URL

Helius webhooks need a stable callback URL. API Gateway provides this automatically.
- Configure Helius webhook to point to `https://{api-gateway-url}/webhooks/helius`
- Or use CloudFront custom domain

### 6. Static Pages: Lambda SSR (Keep Simple)

The leaderboard and agent profile pages are Hono JSX SSR. Keep them in the same Lambda — they're fast to render and already work.

CloudFront can cache the HTML responses (set Cache-Control headers) to reduce Lambda invocations for the public pages.

---

## New Components

### CDK Infrastructure Stack

| Resource | Purpose |
|----------|---------|
| Lambda Function | Runs Hono API server |
| API Gateway HTTP API | Routes HTTP requests to Lambda |
| CloudFront Distribution | CDN for web pages, caches static responses |
| Secrets Manager Secret | Stores all env vars (Turnkey keys, Jupiter key, etc.) |
| IAM Role | Lambda execution role with Secrets Manager read access |
| EventBridge Rule | Weekly cron for reward computation |
| Lambda Function (rewards) | Computes and stores weekly rewards |

### Rewards Schema Addition

```sql
CREATE TABLE rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  week_start TIMESTAMPTZ NOT NULL,
  week_end TIMESTAMPTZ NOT NULL,
  amount TEXT NOT NULL,        -- Amount in display units
  currency TEXT NOT NULL,      -- 'MOLT' or 'SOL'
  reason TEXT NOT NULL,        -- 'weekly_top_trader'
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, settled
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(agent_id, week_start, reason)  -- Idempotency
);
```

### Moltbook Skill Structure

```
skill/
├── SKILL.md          # Main skill file with YAML frontmatter + instructions
└── README.md         # Human-readable setup guide (for distribution)
```

---

## Suggested Build Order

1. **CDK scaffold + Lambda adapter** — Get the app deploying to Lambda (even without Neon or Secrets Manager)
2. **Neon database swap** — Replace pg with @neondatabase/serverless, test locally first
3. **Secrets Manager integration** — Bootstrap env vars from Secrets Manager on cold start
4. **CloudFront + full CDK stack** — Add CDN, caching, final infrastructure
5. **Moltbook Skill** — Create SKILL.md and distribute
6. **Weekly rewards** — Schema, EventBridge cron, computation Lambda

Phases 1-4 are deployment. Phase 5 is skill. Phase 6 is rewards.

---
*Research completed: 2026-02-02*
