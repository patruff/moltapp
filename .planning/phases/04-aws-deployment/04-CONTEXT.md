# Phase 4: AWS Deployment - Context

**Gathered:** 2026-02-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Deploy the existing Hono API server to AWS as serverless infrastructure. Lambda runs the app, API Gateway routes HTTP, CloudFront serves as CDN, Secrets Manager holds credentials, Neon PostgreSQL replaces local database. All defined as CDK infrastructure-as-code. The app code (auth, wallets, trading, leaderboard) is unchanged — this phase wraps it in production infrastructure.

</domain>

<decisions>
## Implementation Decisions

### CDK project structure
- CDK code lives in same repo under `infra/` folder (not a separate repo)
- Single CDK stack for all resources (Lambda, API Gateway, CloudFront, Secrets Manager)
- `infra/` has its own `package.json` and `tsconfig.json` — separate from the app

### Environment strategy
- Production only — one AWS environment, no separate dev/staging stack
- Test locally with `serve()`, deploy to production via `cdk deploy`
- Dual-mode entry point: `src/index.ts` runs locally, `src/lambda.ts` exports handler for Lambda — same app code, different entry points
- AWS region: us-east-1 (closest to Solana RPC clusters)

### Secrets and config
- Single JSON secret in Secrets Manager containing all env vars as keys (one fetch on cold start)
- Local development uses `.env` file (gitignored) — app detects Lambda vs local and reads from the right source
- ADMIN_PASSWORD stays as a simple password in Secrets Manager — good enough for v1.1

### URL and routing
- Custom domain: patgpt.us (user owns it, currently an S3 static site — will be replaced by MoltApp)
- Route53 + ACM certificate for HTTPS on patgpt.us
- Everything through Lambda — CloudFront forwards all requests to API Gateway/Lambda, caching controlled via Cache-Control headers
- Helius webhook callback URL configured manually after first deployment (point to patgpt.us/webhooks/helius)

### Claude's Discretion
- Lambda memory size and timeout configuration
- esbuild bundling options for ESM
- CloudFront cache behavior configuration (which paths to cache, TTLs)
- How to handle `process.exit(1)` in env.ts for Lambda compatibility
- Neon driver swap implementation details

</decisions>

<specifics>
## Specific Ideas

- Domain patgpt.us is currently an S3 static site — CDK deployment will replace it entirely
- The existing S3 site needs to be decommissioned or the DNS records pointed to the new CloudFront distribution
- User wants to deploy ASAP so agents can start interacting

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-aws-deployment*
*Context gathered: 2026-02-02*
