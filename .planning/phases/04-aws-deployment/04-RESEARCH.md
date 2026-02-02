# Phase 4: AWS Deployment - Research

**Researched:** 2026-02-02
**Domain:** AWS serverless infrastructure (Lambda, API Gateway, CloudFront, CDK, Neon PostgreSQL)
**Confidence:** HIGH

## Summary

This phase wraps the existing MoltApp Hono API server in AWS serverless infrastructure. The app code (auth, wallets, trading, leaderboard) remains unchanged -- the work is: (1) create a Lambda entry point that wraps the existing Hono app, (2) swap the `pg` database driver for `@neondatabase/serverless` HTTP driver, (3) load secrets from AWS Secrets Manager instead of `.env`, and (4) define all infrastructure as a CDK stack.

The codebase has been audited and is Lambda-friendly: zero `db.transaction()` calls (safe for Neon HTTP mode), one `process.exit(1)` call in `src/config/env.ts` (must become `throw`), no `db.query.*` relational queries (no schema parameter needed for neon-http), and the in-memory rate limiter (`hono-rate-limiter`) is the only stateful concern (acceptable for v1 since API Gateway provides its own throttling).

**Primary recommendation:** Use CDK `NodejsFunction` with ESM bundling + `HttpApi` + `CloudFront Distribution` with `HttpOrigin` pointing at the API Gateway execute URL. Fetch secrets from Secrets Manager using direct `@aws-sdk/client-secrets-manager` SDK call at module top-level (top-level await in ESM) for simplicity. Use Neon HTTP driver (`drizzle-orm/neon-http`) as a drop-in replacement for the current `drizzle-orm/node-postgres` driver.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `aws-cdk-lib` | ^2.170+ | Infrastructure-as-code for all AWS resources | Official AWS CDK v2 -- single package for all constructs |
| `hono` | ^4.11.7 (existing) | Web framework running on Lambda | Already in use; `hono/aws-lambda` adapter is built-in |
| `@neondatabase/serverless` | ^1.0+ | Serverless PostgreSQL driver for Neon | HTTP mode -- stateless, no connection pooling, perfect for Lambda |
| `drizzle-orm` | ^0.45.1 (existing) | ORM -- swap driver from `node-postgres` to `neon-http` | Already in use; `drizzle-orm/neon-http` is official Neon driver |
| `@aws-sdk/client-secrets-manager` | ^3.x | Fetch secrets from Secrets Manager on cold start | AWS SDK v3 modular -- only import what you need, tree-shakeable |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `constructs` | ^10.x | CDK construct peer dependency | Required by aws-cdk-lib |
| `aws-cdk` | ^2.170+ | CDK CLI tool | Dev dependency for `cdk deploy`, `cdk synth` |
| `tsx` | ^4.21.0 (existing) | Run TypeScript locally | Existing -- used for `npm run dev` local mode |
| `esbuild` | (bundled with CDK) | TypeScript/ESM bundling for Lambda | CDK's `NodejsFunction` uses esbuild internally |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `HttpApi` + `HttpOrigin` | `FunctionUrlOrigin` (CloudFront direct to Lambda URL) | Simpler and cheaper, but CloudFront OAC overwrites the `Authorization` header -- MoltApp uses `Authorization: Bearer` for auth. Would require CloudFront Function to copy to `X-Authorization` and clients must send `x-amz-content-sha256` for POST/PUT. Too much friction for API clients. |
| Direct SDK for secrets | AWS Parameters and Secrets Lambda Extension (layer) | Extension provides caching and local HTTP endpoint. But adds a Lambda layer dependency, and MoltApp only needs one secret fetch on cold start. Direct SDK is simpler, no layer needed. |
| Neon HTTP driver | Neon WebSocket driver (`drizzle-orm/neon-serverless`) | WebSocket mode supports interactive transactions and is a drop-in for `pg`. But requires `ws` package in Lambda, connections can't outlive a request, and the codebase has zero `db.transaction()` calls. HTTP mode is faster and simpler. |

### Installation

**App dependencies (add to root `package.json`):**
```bash
npm install @neondatabase/serverless @aws-sdk/client-secrets-manager
npm uninstall pg @hono/node-server
npm uninstall -D @types/pg
```

Note: `pg` and `@hono/node-server` are only needed for local development. They should remain as `devDependencies` for the `serve()` local mode, not be removed entirely. Revisit: keep both drivers available, use conditional import.

**CDK dependencies (new `infra/package.json`):**
```bash
cd infra
npm init -y
npm install aws-cdk-lib constructs
npm install -D aws-cdk typescript
```

## Architecture Patterns

### Recommended Project Structure

```
moltapp/
├── src/
│   ├── index.ts           # Local entry point (serve() for dev)
│   ├── lambda.ts          # Lambda entry point (handle() for production) -- NEW
│   ├── app.ts             # Shared Hono app definition -- EXTRACTED from index.ts
│   ├── config/
│   │   └── env.ts         # MODIFIED: throw instead of process.exit, Lambda-aware loading
│   ├── db/
│   │   └── index.ts       # MODIFIED: conditional driver (neon-http in Lambda, pg locally)
│   └── ...                # All other files unchanged
├── infra/
│   ├── package.json       # CDK dependencies
│   ├── tsconfig.json      # CDK TypeScript config
│   ├── cdk.json           # CDK app config
│   └── lib/
│       └── moltapp-stack.ts  # Single CDK stack: Lambda, API GW, CloudFront, Secrets, Route53
└── package.json           # App dependencies
```

### Pattern 1: Dual-Mode Entry Point

**What:** Extract the shared Hono `app` into `src/app.ts`. Create two entry points that import it: `src/index.ts` (local dev with `serve()`) and `src/lambda.ts` (Lambda with `handle()`).

**Why:** Same app code, different runtime wrappers. No code duplication.

**Example -- `src/app.ts` (extracted):**
```typescript
// Source: hono.dev/docs/getting-started/aws-lambda
import { Hono } from "hono";
import { authRoutes } from "./routes/auth.ts";
import { walletRoutes } from "./routes/wallets.ts";
// ... all other route imports

type AppEnv = { Variables: { agentId: string } };
const app = new Hono<AppEnv>();

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// All routes registered here (same as current index.ts)
app.route("/", pageRoutes);
app.route("/api/v1/auth", authRoutes);
// ... all other routes

export default app;
```

**Example -- `src/lambda.ts`:**
```typescript
// Source: hono.dev/docs/getting-started/aws-lambda
import { handle } from "hono/aws-lambda";
import app from "./app.ts";

export const handler = handle(app);
```

**Example -- `src/index.ts` (modified):**
```typescript
import { serve } from "@hono/node-server";
import { env } from "./config/env.ts";
import app from "./app.ts";

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`MoltApp API listening on port ${info.port}`);
});
```

### Pattern 2: Lambda-Aware Environment Loading

**What:** Detect Lambda environment (`AWS_LAMBDA_FUNCTION_NAME` env var), fetch secrets from Secrets Manager on cold start using top-level await, then merge into `process.env` before Zod validation.

**Why:** Same Zod validation for both local (.env) and Lambda (Secrets Manager). Throw instead of `process.exit(1)` for Lambda compatibility.

**Example -- `src/config/env.ts` (modified):**
```typescript
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  MOLTBOOK_APP_KEY: z.string().min(1),
  JUPITER_API_KEY: z.string().min(1),
  ADMIN_PASSWORD: z.string().min(1),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  // ... optional fields unchanged
});

export type Env = z.infer<typeof envSchema>;

async function loadSecretsFromAWS(): Promise<void> {
  // Only run in Lambda
  if (!process.env.AWS_LAMBDA_FUNCTION_NAME) return;

  const { SecretsManagerClient, GetSecretValueCommand } = await import(
    "@aws-sdk/client-secrets-manager"
  );
  const client = new SecretsManagerClient({});
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: process.env.SECRET_ARN })
  );
  const secrets = JSON.parse(response.SecretString!);

  // Merge secret keys into process.env
  for (const [key, value] of Object.entries(secrets)) {
    process.env[key] = value as string;
  }
}

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const messages = result.error.issues.map(
      (i) => `  ${i.path.join(".")}: ${i.message}`
    );
    throw new Error(`Environment validation failed:\n${messages.join("\n")}`);
  }
  return result.data;
}

// Top-level await: fetch secrets before anything else on cold start
await loadSecretsFromAWS();
export const env = loadEnv();
```

### Pattern 3: Conditional Database Driver

**What:** Use `@neondatabase/serverless` HTTP driver in Lambda, `pg` Pool locally.

**Why:** Neon HTTP driver is stateless (no connection pool to manage), faster for single queries, no WebSocket setup needed. The codebase has zero `db.transaction()` calls and zero `db.query.*` relational queries, so HTTP mode is fully compatible.

**Example -- `src/db/index.ts` (modified):**
```typescript
import { env } from "../config/env.ts";
import * as schema from "./schema/index.ts";

const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;

async function createDb() {
  if (isLambda) {
    const { neon } = await import("@neondatabase/serverless");
    const { drizzle } = await import("drizzle-orm/neon-http");
    const sql = neon(env.DATABASE_URL);
    return drizzle({ client: sql });
  } else {
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const pg = await import("pg");
    const pool = new pg.default.Pool({ connectionString: env.DATABASE_URL });
    return drizzle(pool, { schema });
  }
}

export const db = await createDb();
```

### Pattern 4: CDK Stack with All Resources

**What:** Single CDK stack defining Lambda, API Gateway HttpApi, CloudFront Distribution, Secrets Manager secret, Route53 records, and ACM certificate.

**Example -- `infra/lib/moltapp-stack.ts`:**
```typescript
import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigatewayv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import { Construct } from "constructs";

export class MoltappStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // --- Secrets Manager ---
    const secret = new secretsmanager.Secret(this, "AppSecrets", {
      secretName: "moltapp/production",
      description: "MoltApp production secrets",
    });

    // --- Lambda Function ---
    const fn = new nodejs.NodejsFunction(this, "ApiFunction", {
      entry: "../src/lambda.ts",
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(30),
      environment: {
        NODE_ENV: "production",
        SECRET_ARN: secret.secretArn,
      },
      bundling: {
        format: nodejs.OutputFormat.ESM,
        target: "node22",
        mainFields: ["module", "main"],
        banner:
          "import{createRequire}from'module';const require=createRequire(import.meta.url);",
        minify: true,
        sourceMap: true,
        tsconfig: "../tsconfig.json",
        externalModules: [],  // Bundle everything
      },
    });
    secret.grantRead(fn);

    // --- API Gateway HTTP API ---
    const httpApi = new apigatewayv2.HttpApi(this, "HttpApi", {
      description: "MoltApp API",
    });
    httpApi.addRoutes({
      path: "/{proxy+}",
      methods: [apigatewayv2.HttpMethod.ANY],
      integration: new integrations.HttpLambdaIntegration("LambdaIntegration", fn),
    });

    // --- Route53 + ACM ---
    const zone = route53.HostedZone.fromLookup(this, "Zone", {
      domainName: "patgpt.us",
    });
    const certificate = new acm.Certificate(this, "Certificate", {
      domainName: "patgpt.us",
      validation: acm.CertificateValidation.fromDns(zone),
    });

    // --- CloudFront Distribution ---
    const apiOrigin = new origins.HttpOrigin(
      `${httpApi.httpApiId}.execute-api.${this.region}.amazonaws.com`
    );

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      domainNames: ["patgpt.us"],
      certificate,
      defaultBehavior: {
        origin: apiOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      },
    });

    // --- Route53 A Record ---
    new route53.ARecord(this, "AliasRecord", {
      zone,
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(distribution)
      ),
    });
  }
}
```

### Anti-Patterns to Avoid

- **Passing secrets as Lambda environment variables in CDK:** This exposes secrets in CloudFormation templates and the Lambda console. Pass only the `SECRET_ARN` as an env var, fetch the actual secret values at runtime.
- **Using `pg` Pool in Lambda:** Connection pools don't work well in Lambda because each invocation may create a new pool, exhausting database connections. Use the stateless Neon HTTP driver instead.
- **Calling `process.exit()` in Lambda:** Lambda catches the exit and reports an error. Use `throw new Error()` instead.
- **Relying on in-memory state across invocations:** Lambda instances are ephemeral and concurrent. In-memory rate limiters lose state on cold start and are fragmented across instances. For v1, accept this limitation (API Gateway provides its own throttling). For v2, consider DynamoDB-backed rate limiting.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Lambda entry point adapter | Custom event parsing from API Gateway payloads | `hono/aws-lambda` `handle()` function | Handles APIGatewayProxyEventV2, binary encoding, headers, cookies, multi-value headers automatically |
| ESM bundling for Lambda | Manual esbuild scripts or Webpack configs | CDK `NodejsFunction` with `OutputFormat.ESM` | Handles bundling, tree-shaking, source maps, `createRequire` banner automatically |
| Infrastructure provisioning | Manual AWS console or custom CloudFormation | CDK constructs (`NodejsFunction`, `HttpApi`, `Distribution`) | Type-safe, composable, handles IAM permissions via `grant*` methods |
| Secret fetching/caching | Custom caching layer for Secrets Manager | Direct SDK call with top-level await (cache in module scope) | Module-level initialization runs once per cold start -- natural caching. Extension layer is overkill for one secret. |
| Database connection management | Connection pooling in Lambda | Neon HTTP driver (stateless) | Each query is an independent HTTP request. No pool to manage, no connections to close, no leaked connections across invocations. |
| SSL certificate provisioning | Manual ACM certificate requests | CDK `acm.Certificate` with `CertificateValidation.fromDns()` | Automatic DNS validation via Route53, automatic renewal |

**Key insight:** The CDK constructs handle the hard parts (IAM permissions, resource interconnection, bundling). The app code changes are minimal: extract shared app, add Lambda entry point, swap DB driver, make env loading async.

## Common Pitfalls

### Pitfall 1: ESM Banner Missing for CJS Dependencies
**What goes wrong:** Lambda crashes with `require is not defined` because some npm packages use CommonJS internally even when consumed as ESM.
**Why it happens:** esbuild's ESM output doesn't include `require()`. Packages like `pg`, `jose`, or transitive deps may use CJS `require()` patterns.
**How to avoid:** Always set the `banner` in CDK bundling options:
```
import{createRequire}from'module';const require=createRequire(import.meta.url);
```
**Warning signs:** `ReferenceError: require is not defined` in Lambda logs.

### Pitfall 2: process.exit() Kills Lambda Container
**What goes wrong:** `process.exit(1)` in `src/config/env.ts` terminates the Lambda container, causing a hard error with no useful error message.
**Why it happens:** Lambda reuses containers across invocations. `process.exit()` kills the Node.js process, and Lambda reports `Runtime.ExitError`.
**How to avoid:** Replace `process.exit(1)` with `throw new Error(...)`. The error propagates to the Lambda runtime and returns a proper 500 response.
**Warning signs:** `Runtime.ExitError` in CloudWatch logs.

### Pitfall 3: CloudFront Caches API Responses
**What goes wrong:** API responses are cached by CloudFront, returning stale data for authenticated requests.
**Why it happens:** CloudFront's default cache behavior caches GET requests. If `CachePolicy.CACHING_DISABLED` is not set, API responses get cached.
**How to avoid:** Set `cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED` for the API behavior. Optionally add `Cache-Control: no-store` headers in the Hono app for API routes.
**Warning signs:** Same response returned for different authenticated users; data doesn't update after writes.

### Pitfall 4: CloudFront Strips Request Headers
**What goes wrong:** `Authorization` header or custom headers don't reach Lambda.
**Why it happens:** CloudFront strips most headers by default. The origin request policy must explicitly forward them.
**How to avoid:** Use `originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER` which forwards all viewer headers (except Host) to the origin.
**Warning signs:** Auth middleware returns 401 for valid API keys; `c.req.header("Authorization")` is undefined.

### Pitfall 5: Neon Connection String Requires Specific Format
**What goes wrong:** Database queries fail with connection errors in Lambda.
**Why it happens:** Neon requires the pooled connection string (with `-pooler` suffix on the hostname) for HTTP mode. The direct connection string won't work.
**How to avoid:** Use the pooled connection string from Neon dashboard: `postgresql://user:pass@ep-xxx-pooler.us-east-1.aws.neon.tech/dbname?sslmode=require`.
**Warning signs:** `connection refused` or `timeout` errors in Lambda logs when querying.

### Pitfall 6: In-Memory Rate Limiter Doesn't Work Across Lambda Instances
**What goes wrong:** Rate limits are not enforced consistently. Some requests bypass limits.
**Why it happens:** `hono-rate-limiter` uses in-memory storage by default. Each Lambda instance has its own memory space. With concurrent instances, counters are fragmented. On cold start, counters reset.
**How to avoid:** For v1, accept this limitation. API Gateway itself provides basic throttling (10,000 requests/second default). For v2, swap to DynamoDB-backed rate limiter.
**Warning signs:** Agent exceeds 60 req/min but doesn't get rate limited (or gets limited inconsistently).

### Pitfall 7: JSX/TSX Bundling Requires tsconfig Reference
**What goes wrong:** esbuild fails to compile `.tsx` files with Hono JSX.
**Why it happens:** Hono uses `jsxImportSource: "hono/jsx"` in tsconfig.json. CDK's `NodejsFunction` esbuild must know about this setting.
**How to avoid:** Set `tsconfig` in the bundling options to point to the project's tsconfig.json: `bundling: { tsconfig: "../tsconfig.json" }`.
**Warning signs:** Build error mentioning JSX factory or import source.

### Pitfall 8: Top-Level Await Requires ESM Output
**What goes wrong:** Lambda crashes with syntax error on `await` at module level.
**Why it happens:** Top-level await is only valid in ESM. If esbuild outputs CJS (the default), `await` at the top level is a syntax error.
**How to avoid:** Set `format: nodejs.OutputFormat.ESM` in bundling options. The output file will be `.mjs` which Lambda treats as ESM.
**Warning signs:** `SyntaxError: await is only valid in async functions and the top level bodies of modules`.

## Code Examples

### Lambda Handler (Complete)
```typescript
// Source: hono.dev/docs/getting-started/aws-lambda
// File: src/lambda.ts
import { handle } from "hono/aws-lambda";
import app from "./app.ts";

export const handler = handle(app);
```

### Secrets Manager Fetch (Direct SDK, Top-Level Await)
```typescript
// Source: docs.aws.amazon.com/lambda/latest/dg/with-secrets-manager.html
// Pattern: fetch once at module level, cached for container lifetime
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const client = new SecretsManagerClient({});
const response = await client.send(
  new GetSecretValueCommand({ SecretId: process.env.SECRET_ARN })
);
const secrets: Record<string, string> = JSON.parse(response.SecretString!);

// Merge into process.env so existing Zod validation works unchanged
for (const [key, value] of Object.entries(secrets)) {
  process.env[key] = value;
}
```

### Neon HTTP Driver with Drizzle
```typescript
// Source: orm.drizzle.team/docs/connect-neon, neon.com/docs/serverless/serverless-driver
// File: src/db/index.ts (Lambda path)
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { env } from "../config/env.ts";

const sql = neon(env.DATABASE_URL);
export const db = drizzle({ client: sql });
```

### CDK ESM Bundling Configuration
```typescript
// Source: docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_nodejs.BundlingOptions.html
bundling: {
  format: nodejs.OutputFormat.ESM,
  target: "node22",
  mainFields: ["module", "main"],
  banner: "import{createRequire}from'module';const require=createRequire(import.meta.url);",
  minify: true,
  sourceMap: true,
  tsconfig: "../tsconfig.json",  // Picks up jsxImportSource for Hono JSX
  externalModules: [],           // Bundle everything (no node_modules in Lambda)
}
```

### CloudFront + HttpApi Origin
```typescript
// Source: docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cloudfront_origins-readme.html
const apiOrigin = new origins.HttpOrigin(
  `${httpApi.httpApiId}.execute-api.${this.region}.amazonaws.com`
);

new cloudfront.Distribution(this, "Distribution", {
  domainNames: ["patgpt.us"],
  certificate,
  defaultBehavior: {
    origin: apiOrigin,
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
    cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
    originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
  },
});
```

### Route53 + ACM (Same Region, us-east-1)
```typescript
// Source: docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_certificatemanager-readme.html
// No cross-region needed since stack deploys to us-east-1
const zone = route53.HostedZone.fromLookup(this, "Zone", {
  domainName: "patgpt.us",
});
const certificate = new acm.Certificate(this, "Certificate", {
  domainName: "patgpt.us",
  validation: acm.CertificateValidation.fromDns(zone),
});
```

### Production Migration Script
```typescript
// Source: neon.com/docs/guides/drizzle-migrations
// File: scripts/migrate-production.ts
// Run from developer machine: NEON_DATABASE_URL=... npx tsx scripts/migrate-production.ts
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

const sql = neon(process.env.NEON_DATABASE_URL!);
const db = drizzle(sql);

await migrate(db, { migrationsFolder: "./src/db/migrations" });
console.log("Migration completed");
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `DnsValidatedCertificate` (CDK) | `acm.Certificate` with `CertificateValidation.fromDns()` | CDK v2.x (deprecated) | Use new construct; old one still works but is deprecated |
| REST API Gateway (`apigateway.RestApi`) | HTTP API Gateway (`apigatewayv2.HttpApi`) | 2020 | HTTP API is faster, cheaper ($1/M vs $3.5/M), lower latency |
| CJS Lambda bundles | ESM Lambda bundles with top-level await | Node.js 14+ (2022) | 40%+ cold start improvement; native top-level await for init |
| AWS SDK v2 (monolithic) | AWS SDK v3 (modular, tree-shakeable) | 2020 | Smaller bundles, faster cold starts, ~40ms improvement |
| Lambda INIT phase free | Lambda INIT phase billed | August 1, 2025 | Cold start optimization now saves money, not just latency |
| CloudFront REST API origin | CloudFront HttpOrigin for HttpApi or FunctionUrlOrigin | CDK v2.x | `RestApiOrigin` only works with REST API; use `HttpOrigin` for HttpApi |

**Deprecated/outdated:**
- `@aws-cdk/aws-lambda-nodejs` (v1): Replaced by `aws-cdk-lib/aws-lambda-nodejs` in CDK v2
- `DnsValidatedCertificate`: Deprecated, use `acm.Certificate` with DNS validation
- AWS SDK v2: No longer receives feature updates; use v3

## Discretionary Recommendations

These are areas marked as "Claude's Discretion" in the phase context:

### Lambda Memory Size and Timeout
**Recommendation:** 1024 MB memory, 30 second timeout.
**Rationale:** Lambda allocates CPU proportionally to memory. At 1024 MB, you get a meaningful CPU boost over the 128 MB default, which accelerates cold starts (especially TLS handshakes for Neon and Secrets Manager). 30 seconds gives enough headroom for cold start + Secrets Manager fetch + Neon query. The app's typical response time is well under 1 second.

### esbuild Bundling Options for ESM
**Recommendation:** Use the configuration shown in the Code Examples section above: `OutputFormat.ESM`, `target: "node22"`, `mainFields: ["module", "main"]`, `banner` with `createRequire`, `minify: true`, `sourceMap: true`, `externalModules: []`.
**Rationale:** ESM format enables top-level await for secrets fetching. The `createRequire` banner handles CJS transitive dependencies. `minify` reduces bundle size for faster cold starts. `sourceMap: true` enables readable CloudWatch error traces. Empty `externalModules` bundles everything (no node_modules folder in Lambda).

### CloudFront Cache Behavior Configuration
**Recommendation:** Use `CACHING_DISABLED` for all paths (single behavior). The entire app is dynamic -- API responses are per-user, and even the leaderboard HTML is server-rendered with live data.
**Rationale:** MoltApp has no static assets (Tailwind CSS is loaded from CDN, no images/fonts served from the app). Every response depends on database state. Caching would cause stale data bugs. If caching is desired later, add `Cache-Control` headers to specific routes (e.g., leaderboard page with 60s max-age).

### How to Handle `process.exit(1)` in env.ts
**Recommendation:** Replace `process.exit(1)` with `throw new Error(message)`. The error message should include the Zod validation details.
**Rationale:** `process.exit()` kills the Lambda container with no useful error output. `throw` propagates to the Lambda runtime, which logs the error to CloudWatch and returns a 500 to the caller. This also works correctly in local mode (the unhandled error crashes the process with a stack trace, which is the desired behavior).

### Neon Driver Swap Implementation
**Recommendation:** Use dynamic `import()` in `src/db/index.ts` to conditionally load the Neon HTTP driver (Lambda) or `pg` Pool (local). Detect Lambda via `process.env.AWS_LAMBDA_FUNCTION_NAME`.
**Rationale:** This keeps both drivers available. Local development continues using `pg` (which works with any PostgreSQL, not just Neon). Production uses the Neon HTTP driver for stateless, connection-pool-free queries. The codebase uses zero `db.query.*` relational queries and zero `db.transaction()` calls, so the neon-http driver is fully compatible with all existing queries.

## Open Questions

1. **Route53 hosted zone for patgpt.us -- existing or new?**
   - What we know: User owns patgpt.us and it currently points to an S3 static site
   - What's unclear: Is there an existing Route53 hosted zone, or is DNS managed elsewhere? `HostedZone.fromLookup()` requires an existing hosted zone in the same account.
   - Recommendation: Verify during implementation. If the zone exists, use `fromLookup`. If not, the CDK stack should create one (then update domain registrar NS records).

2. **Existing S3 site replacement**
   - What we know: patgpt.us currently serves an S3 static site
   - What's unclear: Is there a CloudFormation stack for the existing site that needs to be deleted first? Are there DNS records that will conflict?
   - Recommendation: Document the cutover process. May need to delete existing CloudFront distribution / S3 website configuration before deploying the new stack.

3. **Neon database provisioning**
   - What we know: Production will use Neon serverless PostgreSQL
   - What's unclear: Is the Neon project already created? What region is it in?
   - Recommendation: Create Neon project in AWS us-east-1 region for lowest latency to Lambda. Add the connection string to the Secrets Manager secret.

4. **Drizzle-kit migrations against Neon**
   - What we know: `drizzle-kit migrate` uses `drizzle.config.ts` which reads `DATABASE_URL`
   - What's unclear: Does `drizzle-kit` work with the Neon HTTP connection string directly, or does it need the direct (non-pooler) connection string?
   - Recommendation: Test with the pooled connection string first. If it fails, use the direct connection string for migrations only.

## Sources

### Primary (HIGH confidence)
- [Hono AWS Lambda docs](https://hono.dev/docs/getting-started/aws-lambda) - Handler pattern, CDK setup, handle/streamHandle
- [Neon serverless driver docs](https://neon.com/docs/serverless/serverless-driver) - HTTP vs WebSocket modes, neon() function, transaction support
- [Drizzle ORM + Neon docs](https://orm.drizzle.team/docs/connect-neon) - neon-http driver setup, import paths
- [CDK NodejsFunction API](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_nodejs.NodejsFunction.html) - Construct properties, runtime selection
- [CDK BundlingOptions API](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_nodejs.BundlingOptions.html) - format, banner, target, mainFields, externalModules
- [CDK CloudFront Origins](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cloudfront_origins-readme.html) - HttpOrigin, FunctionUrlOrigin, RestApiOrigin
- [CDK ACM module](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_certificatemanager-readme.html) - Certificate, DNS validation
- [Lambda Secrets Manager docs](https://docs.aws.amazon.com/lambda/latest/dg/with-secrets-manager.html) - Extension layer, SDK pattern, caching

### Secondary (MEDIUM confidence)
- [Hono Lambdalith with Function URLs and CloudFront](https://www.eliasbrange.dev/posts/lambdalith-auth-cloudfront-lambda-function-url/) - FunctionUrlOrigin pattern, OAC Authorization header workaround, cost comparison
- [AWS Lambda ESM and top-level await blog](https://aws.amazon.com/blogs/compute/using-node-js-es-modules-and-top-level-await-in-aws-lambda/) - ESM performance benefits, 43.5% cold start improvement
- [CDK ESM Template (esplo.net)](https://www.esplo.net/en/products/cdk-esm-template) - ESM bundling banner pattern
- [AWS CDK Issue #25145](https://github.com/aws/aws-cdk/issues/25145) - ESM compilation issues with NodejsFunction
- [Neon Drizzle migrations guide](https://neon.com/docs/guides/drizzle-migrations) - Production migration with neon-http migrator
- [AWS Lambda cold start optimization 2025](https://zircon.tech/blog/aws-lambda-cold-start-optimization-in-2025-what-actually-works/) - Memory sizing, INIT billing changes
- [Lambda Function URLs vs API Gateway](https://theburningmonk.com/2024/03/when-to-use-api-gateway-vs-lambda-function-urls/) - Cost and feature comparison

### Tertiary (LOW confidence)
- [AWS Lambda cold start cost 2025](https://edgedelta.com/company/knowledge-center/aws-lambda-cold-start-cost) - August 2025 INIT billing change (needs verification)
- [Rate limiting for serverless](https://aws.amazon.com/blogs/architecture/rate-limiting-strategies-for-serverless-applications/) - DynamoDB-backed rate limiting patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries verified against official documentation; import paths and API confirmed
- Architecture: HIGH - Dual-mode entry point pattern verified in Hono docs and community examples; CDK constructs verified in API docs
- Pitfalls: HIGH - ESM banner, process.exit, CloudFront caching, header stripping all documented in official sources and real-world blog posts
- Discretionary recommendations: MEDIUM - Memory sizing and timeout are general best practices; specific optimal values depend on actual cold start measurements

**Codebase audit findings:**
- `process.exit(1)`: 1 occurrence in `src/config/env.ts:34` -- must become `throw`
- `db.transaction()`: 0 occurrences -- Neon HTTP mode is fully compatible
- `db.query.*`: 0 occurrences -- no relational queries, schema parameter not needed for neon-http
- Database imports: All files import `db` from `src/db/index.ts` -- single file to swap driver
- JSX: 1 file uses `.tsx` (`src/routes/pages.tsx`) -- esbuild needs tsconfig reference for `jsxImportSource`

**Research date:** 2026-02-02
**Valid until:** 2026-03-04 (30 days -- stable ecosystem, CDK and Neon APIs are mature)
