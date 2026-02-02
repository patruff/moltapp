# Pitfalls Research: MoltApp v1.1 Production Launch

**Domain:** Deploying Hono app to AWS Lambda, Neon PostgreSQL, agent skills, rewards
**Researched:** 2026-02-02

---

## Pitfall 1: Lambda Cold Starts with Crypto Dependencies

**Risk:** @solana/kit, Turnkey SDK, and crypto libraries are large. Cold starts could exceed 3-5 seconds, making trading API calls feel slow.

**Warning Signs:**
- Init Duration > 2000ms in CloudWatch
- Agents timing out on first call after idle period

**Prevention:**
- Bundle with esbuild ESM format (tree-shake unused exports)
- Set Lambda memory to 1024-1536 MB (more CPU for faster init)
- Transpile TypeScript to JavaScript (never deploy .ts files)
- Monitor Init Duration in CloudWatch
- Consider provisioned concurrency (1 instance) if cold starts exceed 3 seconds

**Phase:** Deployment (CDK + Lambda)

---

## Pitfall 2: Neon Connection Pooling Misconfiguration

**Risk:** Using wrong connection string or creating connection pools in module scope causes exhausted connections or "too many clients" errors.

**Warning Signs:**
- "too many clients already" errors
- Intermittent connection timeouts
- Database CPU spikes

**Prevention:**
- Use Neon's **pooled** connection string (port 6543, not 5432)
- Use `@neondatabase/serverless` HTTP mode (stateless, no pooling needed)
- Do NOT create Pool/Client objects outside Lambda handler
- Do NOT use client-side pooling (pg.Pool) with Neon's server-side pooling (double pooling)
- Codebase has zero `db.transaction()` calls — HTTP mode works perfectly

**Phase:** Database swap

---

## Pitfall 3: Secrets Manager Cold Start Overhead

**Risk:** Fetching secrets from Secrets Manager on every cold start adds 200-500ms latency. If done synchronously in module scope, it blocks all initialization.

**Warning Signs:**
- Consistently high Init Duration
- Secrets fetch timing logged at 200ms+

**Prevention:**
- Use AWS Secrets Manager Lambda Extension (caches secrets for 5 min, adds ~50ms)
- Or fetch secrets once in cold start init, cache in process.env for warm invocations
- Never fetch secrets per-request — only on cold start
- Bundle secret names as env vars, not secret values

**Phase:** Secrets Manager integration

---

## Pitfall 4: process.exit(1) in Lambda

**Risk:** Current `src/config/env.ts` calls `process.exit(1)` on Zod validation failure. In Lambda, this kills the execution environment and can cause confusing error reporting.

**Warning Signs:**
- Lambda reporting "Runtime exited with error: signal: killed"
- No useful error logs when env vars are misconfigured

**Prevention:**
- Change `process.exit(1)` to `throw new Error(...)` for Lambda compatibility
- Lambda will catch the error and report it as an init error
- Keep `process.exit(1)` only for local dev mode (check `AWS_LAMBDA_FUNCTION_NAME`)

**Phase:** Lambda adapter

---

## Pitfall 5: In-Memory Cache Not Shared Across Lambda Instances

**Risk:** Leaderboard cache (30-min TTL) only lives within one Lambda instance. Multiple concurrent instances each compute their own cache, wasting Jupiter API calls and causing inconsistent data across requests.

**Warning Signs:**
- Higher-than-expected Jupiter API usage
- Different users seeing different leaderboard data
- Increased Lambda duration for cached routes

**Prevention:**
- Accept this for v1.1 — leaderboard computation is fast (batch SQL + one Jupiter call)
- CloudFront caching of HTML pages reduces Lambda invocations
- For the API, same-instance cache still helps for burst traffic
- Future: move to external cache (Redis/DynamoDB) if it becomes a problem

**Phase:** Acceptable limitation, no action needed

---

## Pitfall 6: ESM/CJS Bundling Issues with CDK NodejsFunction

**Risk:** The codebase uses TypeScript ESM with `.ts` import extensions and `rewriteRelativeImportExtensions`. CDK's NodejsFunction uses esbuild but may mishandle ESM imports or `.ts` extensions.

**Warning Signs:**
- esbuild errors during `cdk deploy`
- "Cannot find module" at Lambda runtime
- Unexpected CJS/ESM interop issues

**Prevention:**
- Configure NodejsFunction with explicit esbuild options: `format: 'esm'`, `platform: 'node'`
- Set `banner: { js: "import{createRequire}from'module';const require=createRequire(import.meta.url);" }` if any CJS dependencies need `require()`
- Use `bundling.externalModules` to exclude problematic native modules
- Test the esbuild output locally: `npx esbuild src/lambda.ts --bundle --format=esm --platform=node --outdir=dist`

**Phase:** CDK scaffold

---

## Pitfall 7: Helius Webhook URL Change on Redeployment

**Risk:** API Gateway URL changes if the stack is recreated. Helius webhook callback URL becomes invalid.

**Warning Signs:**
- Deposits stop being detected
- Webhook POST requests return 404

**Prevention:**
- Use a custom domain with Route53 + ACM certificate (stable URL)
- Or use CloudFront distribution URL (changes less frequently)
- Store Helius webhook configuration in CDK so it can be updated programmatically
- For v1.1: manually update Helius webhook URL after first deployment, use CloudFront URL

**Phase:** CDK infrastructure

---

## Pitfall 8: Weekly Reward Double-Execution

**Risk:** EventBridge may trigger the reward Lambda twice (at-least-once delivery). Without idempotency, an agent could receive double rewards.

**Warning Signs:**
- Duplicate rows in rewards table
- Agents showing inflated reward balances

**Prevention:**
- Use UNIQUE constraint on `(agent_id, week_start, reason)` in rewards table
- Use `INSERT ... ON CONFLICT DO NOTHING` for idempotent writes
- Log warning if duplicate detected (indicates EventBridge retry)

**Phase:** Weekly rewards

---

## Pitfall 9: Lambda Timeout on Trading Operations

**Risk:** Trade execution involves Jupiter API call + Turnkey signing + Solana transaction submission. If any of these is slow, Lambda may timeout (default 3 seconds).

**Warning Signs:**
- "Task timed out after X seconds" errors
- Partial trade execution (signed but not submitted)

**Prevention:**
- Set Lambda timeout to 30 seconds (trades can take 5-10 seconds)
- Set API Gateway timeout to match (29 seconds max for HTTP API)
- Add timeout handling in trading service (abort if approaching Lambda timeout)
- Monitor p99 trade duration

**Phase:** CDK Lambda configuration

---

## Pitfall 10: Skill File API URL Hardcoding

**Risk:** Skill file hardcodes the API URL. When the URL changes (different deployment, custom domain), all agents have outdated skills.

**Warning Signs:**
- Agents failing to connect after URL change
- Stale SKILL.md files in agent installations

**Prevention:**
- Use environment variable in SKILL.md: `requires: env: ["MOLTAPP_URL"]`
- Don't hardcode URL in instructions — reference `$MOLTAPP_URL`
- Provide a `/api/v1/info` endpoint that returns current API docs
- Version the skill file so agents can check for updates

**Phase:** Moltbook Skill

---
*Research completed: 2026-02-02*
