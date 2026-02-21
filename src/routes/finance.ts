/**
 * Finance-as-a-Service (FaaS) Routes — Analyst-to-Client Marketplace
 *
 * Peer-to-peer AI financial analysis marketplace with x402 micropayments.
 * Analysts register their AI agents, clients pay for portfolio analysis,
 * payment routes directly to analyst's Solana wallet via x402 DynamicPayTo.
 *
 * Free routes (discovery + registration):
 *   GET  /api/v1/finance/skill.md                — Machine-readable service spec
 *   GET  /api/v1/finance/analysts                 — Browse registered analysts
 *   GET  /api/v1/finance/analysts/:id             — Specific analyst profile
 *   GET  /api/v1/finance/analysts/:id/pricing     — Tier pricing breakdown
 *   GET  /api/v1/finance/stats                    — Marketplace statistics
 *   POST /api/v1/finance/register-analyst         — Register as provider
 *   POST /api/v1/finance/register-client          — Register wallet
 *   POST /api/v1/finance/analysts/:id/toggle      — Toggle active status
 *
 * Paid routes (x402 gated — payment to analyst wallet):
 *   GET  /api/v1/finance/analyze/:analystId/quick     — Quick portfolio review
 *   GET  /api/v1/finance/analyze/:analystId/standard  — Full analysis + signals
 *   GET  /api/v1/finance/analyze/:analystId/deep      — Deep analysis + recs
 */

import { Hono, type Context } from "hono";
import { paymentMiddlewareFromConfig } from "@x402/hono";
import type { Network } from "@x402/hono";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import {
  registerAnalyst,
  registerClient,
  toggleAnalystActive,
  listAnalysts,
  getAnalyst,
  estimatePrice,
  calculateDynamicPrice,
  runAnalysis,
  getMarketplaceStats,
  generateFinanceSkillMd,
  postJob,
  listOpenJobs,
  getJob,
  acceptJob,
  fulfillJob,
  type PackageTier,
  type LlmProvider,
} from "../services/finance-service.ts";
import {
  ADVICE_WALLET,
  getSolanaNetwork,
} from "../services/paid-advice.ts";
import { errorMessage } from "../lib/errors.ts";

export const financeRoutes = new Hono();

// ---------------------------------------------------------------------------
// x402 Payment Middleware Configuration
// ---------------------------------------------------------------------------

const SOLANA_NETWORK = getSolanaNetwork() as Network;

/** Fallback wallet if analyst wallet is missing */
const FALLBACK_WALLET = ADVICE_WALLET;

/**
 * Extract analyst ID from the request path.
 * Paths look like: /analyze/analyst_xxx_yyy/quick
 */
function extractAnalystId(path: string): string {
  const match = path.match(/\/analyze\/(analyst_[^/]+)\//);
  return match?.[1] ?? "";
}

/**
 * Extract job ID from the request path.
 * Paths look like: /jobs/job_123_abc/fulfill
 */
function extractJobId(path: string): string {
  const match = path.match(/\/jobs\/(job_[^/]+)\//);
  return match?.[1] ?? "";
}

/**
 * Build x402 route config for a given tier.
 * Uses DynamicPrice (based on analyst model + markup) and
 * DynamicPayTo (routes payment to analyst's Solana wallet).
 */
function buildX402TierConfig(tier: PackageTier) {
  return {
    accepts: [
      {
        scheme: "exact" as const,
        price: (ctx: { path: string }) => {
          const analystId = extractAnalystId(ctx.path);
          return calculateDynamicPrice(analystId, tier);
        },
        network: SOLANA_NETWORK,
        payTo: (ctx: { path: string }) => {
          const analystId = extractAnalystId(ctx.path);
          const analyst = getAnalyst(analystId);
          return analyst?.walletAddress ?? FALLBACK_WALLET;
        },
      },
    ],
    description: `${tier.charAt(0).toUpperCase() + tier.slice(1)} AI portfolio analysis`,
    mimeType: "application/json",
  };
}

const financeX402Routes: Record<string, ReturnType<typeof buildX402TierConfig>> = {
  "GET /analyze/:analystId/quick": buildX402TierConfig("quick"),
  "GET /analyze/:analystId/standard": buildX402TierConfig("standard"),
  "GET /analyze/:analystId/deep": buildX402TierConfig("deep"),
  // Job board: client pays analyst's budget on fulfillment
  "POST /jobs/:id/fulfill": {
    accepts: [
      {
        scheme: "exact" as const,
        price: (ctx: { path: string }) => {
          const jobId = extractJobId(ctx.path);
          const job = getJob(jobId);
          return job ? `$${job.budgetUsd.toFixed(4)}` : `$0.01`;
        },
        network: SOLANA_NETWORK,
        payTo: (ctx: { path: string }) => {
          const jobId = extractJobId(ctx.path);
          const job = getJob(jobId);
          if (job?.acceptedBy) {
            const analyst = getAnalyst(job.acceptedBy);
            return analyst?.walletAddress ?? FALLBACK_WALLET;
          }
          return FALLBACK_WALLET;
        },
      },
    ],
    description: "Fulfill analysis job — payment routes to analyst wallet",
    mimeType: "application/json",
  },
};

// Initialize x402 facilitator and middleware
const facilitatorUrl =
  process.env.X402_FACILITATOR_URL || "https://x402.org/facilitator";

const facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorUrl });
const svmScheme = new ExactSvmScheme();

// Apply x402 payment middleware to paid routes
if (FALLBACK_WALLET) {
  financeRoutes.use(
    "*",
    paymentMiddlewareFromConfig(
      financeX402Routes,
      facilitatorClient,
      [{ network: SOLANA_NETWORK, server: svmScheme }],
    ),
  );
} else {
  console.warn(
    "[Finance] No wallet configured — x402 payment middleware disabled. " +
    "Paid endpoints will return data for free.",
  );
}

// ---------------------------------------------------------------------------
// Free Routes (No Payment Required)
// ---------------------------------------------------------------------------

/**
 * GET /skill.md — Machine-readable service spec for agent discovery
 */
financeRoutes.get("/skill.md", (c) => {
  c.header("Content-Type", "text/markdown; charset=utf-8");
  return c.text(generateFinanceSkillMd());
});

/**
 * GET /analysts — Browse registered analysts with pricing
 */
financeRoutes.get("/analysts", (c) => {
  return c.json({
    analysts: listAnalysts(),
    paymentProtocol: "x402",
    network: SOLANA_NETWORK,
  });
});

/**
 * GET /analysts/:id — Specific analyst profile
 */
financeRoutes.get("/analysts/:id", (c) => {
  const analystId = c.req.param("id");
  const analyst = getAnalyst(analystId);
  if (!analyst) {
    return c.json({ error: "not_found", details: `Analyst ${analystId} not found` }, 404);
  }
  return c.json(analyst);
});

/**
 * GET /analysts/:id/pricing — Tier pricing breakdown for an analyst
 */
financeRoutes.get("/analysts/:id/pricing", (c) => {
  const analystId = c.req.param("id");
  const analyst = getAnalyst(analystId);
  if (!analyst) {
    return c.json({ error: "not_found", details: `Analyst ${analystId} not found` }, 404);
  }

  return c.json({
    analystId: analyst.analystId,
    analystName: analyst.name,
    model: analyst.model,
    markupPercent: analyst.markupPercent,
    tiers: {
      quick: estimatePrice(analystId, "quick"),
      standard: estimatePrice(analystId, "standard"),
      deep: estimatePrice(analystId, "deep"),
    },
  });
});

/**
 * GET /stats — Marketplace statistics
 */
financeRoutes.get("/stats", (c) => {
  return c.json(getMarketplaceStats());
});

/**
 * POST /register-analyst — Register as an analysis provider
 */
financeRoutes.post("/register-analyst", async (c) => {
  try {
    const body = await c.req.json();

    const validProviders: LlmProvider[] = ["anthropic", "openai", "xai", "google"];
    if (!validProviders.includes(body.provider)) {
      return c.json(
        { error: "invalid_provider", details: `Provider must be one of: ${validProviders.join(", ")}` },
        400,
      );
    }

    const analyst = registerAnalyst({
      name: body.name,
      walletAddress: body.walletAddress,
      model: body.model,
      provider: body.provider,
      markupPercent: body.markupPercent,
      description: body.description,
    });

    return c.json(analyst, 201);
  } catch (error) {
    return c.json(
      { error: "registration_failed", details: errorMessage(error) },
      400,
    );
  }
});

/**
 * POST /register-client — Register wallet for analysis
 */
financeRoutes.post("/register-client", async (c) => {
  try {
    const body = await c.req.json();
    const client = registerClient(body.walletAddress);
    return c.json(client, 201);
  } catch (error) {
    return c.json(
      { error: "registration_failed", details: errorMessage(error) },
      400,
    );
  }
});

/**
 * POST /analysts/:id/toggle — Toggle analyst "working?" status
 */
financeRoutes.post("/analysts/:id/toggle", async (c) => {
  try {
    const analystId = c.req.param("id");
    const body = await c.req.json();
    const isActive = Boolean(body.isActive);

    const success = toggleAnalystActive(analystId, isActive);
    if (!success) {
      return c.json({ error: "not_found", details: `Analyst ${analystId} not found` }, 404);
    }

    return c.json({ analystId, isActive });
  } catch (error) {
    return c.json(
      { error: "toggle_failed", details: errorMessage(error) },
      400,
    );
  }
});

// ---------------------------------------------------------------------------
// Job Board Routes (No Payment Required)
// ---------------------------------------------------------------------------

/**
 * POST /jobs — Post a new analysis job
 */
financeRoutes.post("/jobs", async (c) => {
  try {
    const body = await c.req.json();
    const validTiers: PackageTier[] = ["quick", "standard", "deep"];
    if (!validTiers.includes(body.tier)) {
      return c.json({ error: "invalid_tier", details: `Tier must be one of: ${validTiers.join(", ")}` }, 400);
    }
    const job = postJob({
      clientWallet: body.clientWallet,
      title: body.title,
      description: body.description,
      sector: body.sector,
      symbol: body.symbol,
      tier: body.tier,
      budgetUsd: Number(body.budgetUsd),
    });
    return c.json(job, 201);
  } catch (error) {
    return c.json({ error: "post_job_failed", details: errorMessage(error) }, 400);
  }
});

/**
 * GET /jobs — List open jobs (query: ?sector=tech&tier=deep&minBudget=0.05)
 */
financeRoutes.get("/jobs", (c) => {
  const sector = c.req.query("sector") || undefined;
  const tier = (c.req.query("tier") as PackageTier) || undefined;
  const minBudget = c.req.query("minBudget") ? Number(c.req.query("minBudget")) : undefined;
  return c.json({ jobs: listOpenJobs({ sector, tier, minBudget }) });
});

/**
 * GET /jobs/:id — Get specific job details
 */
financeRoutes.get("/jobs/:id", (c) => {
  const job = getJob(c.req.param("id"));
  if (!job) {
    return c.json({ error: "not_found", details: "Job not found" }, 404);
  }
  return c.json(job);
});

/**
 * POST /jobs/:id/accept — Analyst accepts a job
 */
financeRoutes.post("/jobs/:id/accept", async (c) => {
  try {
    const body = await c.req.json();
    if (!body.analystId) {
      return c.json({ error: "missing_analyst", details: "analystId is required" }, 400);
    }
    const job = acceptJob(c.req.param("id"), body.analystId);
    return c.json(job);
  } catch (error) {
    return c.json({ error: "accept_failed", details: errorMessage(error) }, 400);
  }
});

/**
 * POST /jobs/:id/fulfill — Fulfill an accepted job (triggers LLM analysis)
 */
financeRoutes.post("/jobs/:id/fulfill", async (c) => {
  try {
    const job = await fulfillJob(c.req.param("id"));
    return c.json(job);
  } catch (error) {
    console.error("[Finance] Fulfillment error:", error);
    return c.json({ error: "fulfill_failed", details: errorMessage(error) }, 500);
  }
});

// ---------------------------------------------------------------------------
// Paid Routes (x402 Gated — payment handled by middleware)
// ---------------------------------------------------------------------------

/**
 * GET /analyze/:analystId/quick — Quick portfolio review
 * Query params: ?wallet=<solana_address>&symbol=TSLAx (optional)
 */
financeRoutes.get("/analyze/:analystId/quick", async (c) => {
  return handleAnalysis(c, "quick");
});

/**
 * GET /analyze/:analystId/standard — Standard analysis + signals
 * Query params: ?wallet=<solana_address>&symbol=TSLAx (optional)
 */
financeRoutes.get("/analyze/:analystId/standard", async (c) => {
  return handleAnalysis(c, "standard");
});

/**
 * GET /analyze/:analystId/deep — Deep analysis + recommendations
 * Query params: ?wallet=<solana_address>&symbol=TSLAx (optional)
 */
financeRoutes.get("/analyze/:analystId/deep", async (c) => {
  return handleAnalysis(c, "deep");
});

/**
 * Shared handler for all analysis tiers.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleAnalysis(c: Context<any, any>, tier: PackageTier) {
  try {
    const analystId = c.req.param("analystId");
    const wallet = c.req.query("wallet");
    const symbol = c.req.query("symbol") || undefined;

    if (!wallet) {
      return c.json(
        { error: "missing_wallet", details: "Query param ?wallet=<solana_address> is required" },
        400,
      );
    }

    const result = await runAnalysis(analystId, wallet, tier, symbol);
    return c.json(result);
  } catch (error) {
    console.error(`[Finance] Analysis error (${tier}):`, error);
    return c.json(
      { error: "analysis_failed", details: errorMessage(error) },
      500,
    );
  }
}
