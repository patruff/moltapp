---
phase: 04-aws-deployment
plan: 01
subsystem: infra
tags: [lambda, hono, neon, secrets-manager, aws, serverless, dual-entry]

# Dependency graph
requires:
  - phase: 03-competition-dashboard
    provides: "Complete Hono app with all routes, middleware, and DB queries"
provides:
  - "Shared Hono app (src/app.ts) with all route registrations"
  - "Lambda entry point (src/lambda.ts) exporting handler"
  - "Lambda-aware env loading with Secrets Manager fetch"
  - "Conditional DB driver: Neon HTTP in Lambda, pg Pool locally"
affects: [04-02 (CDK stack needs lambda.ts as entry), 04-03 (CI/CD pipeline)]

# Tech tracking
tech-stack:
  added: ["@aws-sdk/client-secrets-manager", "@neondatabase/serverless"]
  patterns: ["dual entry point (local serve vs Lambda handle)", "runtime detection via AWS_LAMBDA_FUNCTION_NAME", "dynamic imports for conditional driver loading", "top-level await for async initialization"]

key-files:
  created: ["src/app.ts", "src/lambda.ts"]
  modified: ["src/index.ts", "src/config/env.ts", "src/db/index.ts", "package.json"]

key-decisions:
  - "Detect Lambda runtime via AWS_LAMBDA_FUNCTION_NAME env var (set automatically by AWS)"
  - "Use dynamic imports for driver-specific code to avoid bundling both drivers"
  - "Top-level await in env.ts and db/index.ts for async initialization"
  - "SECRET_ARN env var used to identify which Secrets Manager secret to fetch"
  - "Neon HTTP drizzle instance created without schema param (no relational queries used)"

patterns-established:
  - "Dual entry point: app.ts defines routes, index.ts serves locally, lambda.ts handles Lambda"
  - "Runtime detection: check AWS_LAMBDA_FUNCTION_NAME for Lambda vs local branching"
  - "Error handling: throw Error instead of process.exit for Lambda compatibility"

# Metrics
duration: 15min
completed: 2026-02-02
---

# Phase 4 Plan 1: Lambda-Compatible App Summary

**Dual entry points (local serve + Lambda handle) with Secrets Manager env loading and conditional Neon HTTP / pg Pool database driver**

## Performance

- **Duration:** 15 min
- **Started:** 2026-02-02T02:37:27Z
- **Completed:** 2026-02-02T02:52:46Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- Extracted shared Hono app to `src/app.ts` with all routes, middleware, and handlers
- Created Lambda entry point `src/lambda.ts` wrapping the same app with `hono/aws-lambda`
- Made env loading async with Secrets Manager fetch on cold start (no-op locally)
- Replaced `process.exit(1)` with `throw Error` for Lambda compatibility
- Added conditional DB driver: Neon HTTP in Lambda, pg Pool in local dev

## Task Commits

Each task was committed atomically:

1. **Task 1: Extract shared Hono app and create dual entry points** - `58ca053` (feat)
2. **Task 2: Make environment loading Lambda-aware with Secrets Manager** - `057007f` (feat)
3. **Task 3: Add conditional Neon HTTP database driver for Lambda** - `14e5c72` (feat)

## Files Created/Modified
- `src/app.ts` - Shared Hono app with all route registrations, middleware, and handlers (new)
- `src/lambda.ts` - Lambda entry point using hono/aws-lambda handle() (new)
- `src/index.ts` - Thin local-dev wrapper importing app from app.ts
- `src/config/env.ts` - Async loadSecretsFromAWS() + throw instead of process.exit
- `src/db/index.ts` - Conditional DB driver with dynamic imports and top-level await
- `package.json` - Added @aws-sdk/client-secrets-manager and @neondatabase/serverless

## Decisions Made
- **Runtime detection via AWS_LAMBDA_FUNCTION_NAME:** This env var is automatically set by AWS Lambda, making it the most reliable way to detect Lambda runtime without any configuration.
- **Dynamic imports for conditional loading:** Prevents bundling both pg and Neon drivers in all environments. Only the needed driver is loaded at runtime.
- **Top-level await pattern:** Both env.ts and db/index.ts use top-level await for async initialization. This works because the project uses ES modules (type: "module" in package.json).
- **SECRET_ARN for secret identification:** The Lambda function receives SECRET_ARN as an env var (set by CDK in plan 04-02), keeping the secret name configurable.
- **No schema param for Neon HTTP drizzle:** The codebase uses zero `db.query.*` relational queries, only `db.select/insert/update/delete`, so schema registration is not needed for the Neon HTTP driver.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. AWS account setup and CDK deployment are handled in plan 04-02.

## Next Phase Readiness
- Lambda entry point ready for CDK stack to reference as handler
- Environment loading ready for Secrets Manager integration
- Database driver ready for Neon serverless in production
- Next: Plan 04-02 creates CDK infrastructure (Lambda, API Gateway, Secrets Manager, Neon DB)

---
*Phase: 04-aws-deployment*
*Completed: 2026-02-02*
