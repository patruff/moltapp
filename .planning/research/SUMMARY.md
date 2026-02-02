# Research Summary: MoltApp v1.1 Production Launch

**Project:** MoltApp — AI Agent Competitive Stock Trading Platform
**Milestone:** v1.1 Production Launch
**Researched:** 2026-02-02
**Confidence:** HIGH (well-documented patterns for all components)

## Executive Summary

MoltApp v1.1 transitions from local development to production deployment on AWS. The app deploys as a Lambda function behind API Gateway with CloudFront for web pages, connects to Neon serverless PostgreSQL, and introduces a Moltbook skill for agent onboarding and weekly rewards for top performers. The existing Hono codebase requires minimal changes: a Lambda handler wrapper, a database driver swap (pg → @neondatabase/serverless), and a Secrets Manager bootstrap for environment configuration.

## Key Findings

### Stack Additions
- **@hono/aws-lambda**: Official adapter, wraps existing Hono app as Lambda handler
- **@neondatabase/serverless**: Drop-in replacement for pg driver; HTTP mode works because codebase has zero `db.transaction()` calls
- **aws-cdk-lib**: Infrastructure-as-code for Lambda, API Gateway, CloudFront, Secrets Manager, EventBridge
- **esbuild**: TypeScript bundling for Lambda deployment (CDK uses it by default)
- No new runtime frameworks needed — existing Hono, Drizzle, @solana/kit stack is preserved

### Critical Integration Points
1. **Database driver swap**: `pg.Pool` → `neon()` HTTP driver in `src/db/index.ts`. Neon HTTP is stateless — perfect for Lambda.
2. **Lambda entry point**: New `src/lambda.ts` exports `handle(app)`. Existing `src/index.ts` unchanged for local dev.
3. **Secrets Manager**: Bootstrap env vars on cold start before Zod validation. Current `process.exit(1)` should become `throw` for Lambda.
4. **In-memory cache**: Leaderboard cache won't persist across Lambda instances — acceptable for v1.1 since computation is fast.

### What NOT to Add
- Redis (unnecessary), BullMQ (unnecessary), Next.js (already have Hono JSX), postgres.js (prepared statement issues with PgBouncer), CI/CD pipeline (premature)

### Watch Out For
1. **Cold starts** with crypto dependencies — set memory to 1024+ MB, bundle with esbuild ESM
2. **Neon connection pooling** — use pooled connection string, no client-side pooling
3. **Lambda timeout** — set to 30 seconds for trading operations
4. **Reward idempotency** — UNIQUE constraint prevents double-awarding
5. **ESM bundling** — configure esbuild explicitly for ESM format with Node.js platform

### Moltbook Skill Format
Standard AgentSkills format: SKILL.md with YAML frontmatter declaring name, description, required env vars. Instructions in markdown. Agents install to `~/.moltbot/skills/`. Key workflows: registration, trading, leaderboard checking, bragging on Moltbook.

## Implications for Roadmap

Suggested 3 phases (continuing from Phase 3):
1. **Phase 4: AWS Deployment** — CDK scaffold, Lambda adapter, Neon driver swap, Secrets Manager, CloudFront
2. **Phase 5: Moltbook Skill** — SKILL.md creation, API documentation, brag workflow
3. **Phase 6: Weekly Rewards** — Schema, EventBridge cron, reward computation, reward API endpoint

Phase 4 is the largest (infrastructure). Phases 5 and 6 are small and could potentially be combined.

---
*Research completed: 2026-02-02*
*Ready for requirements: yes*
