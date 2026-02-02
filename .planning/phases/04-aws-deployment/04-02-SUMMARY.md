---
phase: 04-aws-deployment
plan: 02
subsystem: infra
tags: [aws-cdk, lambda, api-gateway, cloudfront, secrets-manager, route53, acm, typescript]

# Dependency graph
requires:
  - phase: none
    provides: none (CDK project is standalone infrastructure definition)
provides:
  - CDK stack defining all AWS production resources (Lambda, API Gateway, CloudFront, Secrets Manager, Route53, ACM)
  - infra/ project with package.json, tsconfig, cdk.json, and entry point
  - MoltappStack class ready for `cdk deploy`
affects: [04-01 (lambda entry point referenced by stack), 04-03 (deployment uses this stack)]

# Tech tracking
tech-stack:
  added: [aws-cdk-lib, constructs, aws-cdk]
  patterns: [CDK single-stack, NodejsFunction ESM bundling, HttpApi + CloudFront origin]

key-files:
  created:
    - infra/package.json
    - infra/tsconfig.json
    - infra/cdk.json
    - infra/bin/app.ts
    - infra/lib/moltapp-stack.ts
  modified: []

key-decisions:
  - "Used .js extension in NodeNext import (bin/app.ts imports moltapp-stack.js) for TypeScript module resolution compatibility"
  - "Added root route (/) in addition to catch-all (/{proxy+}) because HttpApi proxy does not match root path"
  - "Shared single HttpLambdaIntegration instance across both routes"

patterns-established:
  - "CDK project in infra/ with separate package.json, isolated from app dependencies"
  - "NodejsFunction ESM bundling with createRequire banner for CJS compatibility"
  - "SECRET_ARN env var pattern: pass ARN to Lambda, fetch actual values at runtime"

# Metrics
duration: 6min
completed: 2026-02-02
---

# Phase 4 Plan 2: CDK Infrastructure Stack Summary

**AWS CDK stack with Lambda (ARM64/ESM/Node22), API Gateway HTTP API, CloudFront (no caching), Secrets Manager, Route53 + ACM for patgpt.us**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-02T02:37:44Z
- **Completed:** 2026-02-02T02:43:23Z
- **Tasks:** 2
- **Files created:** 5

## Accomplishments
- CDK project initialized in `infra/` with its own package.json, tsconfig, and dependencies
- MoltappStack defines all 7 AWS resource types: Lambda, API Gateway, CloudFront, Secrets Manager, ACM, Route53 hosted zone lookup, Route53 A record
- Lambda configured with ARM64 architecture, 1024 MB memory, 30s timeout, Node.js 22, ESM bundling with createRequire banner
- CloudFront distribution with caching disabled and ALL_VIEWER_EXCEPT_HOST_HEADER origin request policy (forwards Authorization and all custom headers)
- TypeScript compilation passes cleanly (`npx tsc --noEmit` succeeds)

## Task Commits

Each task was committed atomically:

1. **Task 1: Initialize CDK project in infra/** - `d8a2604` (chore)
2. **Task 2: Create MoltappStack with all AWS resources** - `6917c18` (feat)

## Files Created/Modified
- `infra/package.json` - CDK project dependencies (aws-cdk-lib, constructs, aws-cdk, typescript)
- `infra/tsconfig.json` - TypeScript config for CDK project (NodeNext, ES2022)
- `infra/cdk.json` - CDK app configuration pointing to bin/app.ts via tsx
- `infra/bin/app.ts` - CDK app entry point instantiating MoltappStack in us-east-1
- `infra/lib/moltapp-stack.ts` - Single CDK stack with Lambda, API Gateway, CloudFront, Secrets Manager, Route53, ACM

## Decisions Made
- Used `.js` extension in bin/app.ts import (`../lib/moltapp-stack.js`) instead of `.ts` -- TypeScript `NodeNext` module resolution requires `.js` extensions for local imports
- Added separate root route (`/`) alongside the catch-all `/{proxy+}` -- API Gateway HTTP API's proxy route does not match the root path, so both are needed
- Reused single `HttpLambdaIntegration` instance for both the root and proxy routes to keep the stack clean

## Deviations from Plan

None -- plan executed exactly as written. The `.js` import extension was a minor adjustment for TypeScript correctness, not a deviation from the plan's intent.

## Issues Encountered
- `cdk synth` fails because `../src/lambda.ts` (Lambda entry point) does not exist yet -- this is created by Plan 04-01 and is expected. The CDK `NodejsFunction` validates entry file existence at synthesis time, not at TypeScript compilation time. TypeScript compilation passes cleanly.

## User Setup Required

None -- no external service configuration required for the CDK project itself. AWS credentials and CDK bootstrap are needed before `cdk deploy` (documented in Plan 04-03).

## Next Phase Readiness
- CDK stack is ready; `cdk deploy` will work once Plan 04-01 creates `src/lambda.ts` and AWS credentials are configured
- Plan 04-01 (Lambda-ready app code) and Plan 04-03 (deployment) can proceed
- The stack references `../src/lambda.ts` and `../tsconfig.json` which must exist before `cdk synth`/`cdk deploy`

---
*Phase: 04-aws-deployment*
*Completed: 2026-02-02*
