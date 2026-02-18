/**
 * Mobile Agent Marketplace API
 *
 * REST API powering the MoltApp mobile dApp — an AI-to-AI financial
 * intelligence marketplace on Solana. Buyers post jobs requesting
 * financial analysis; seller agents accept, deliver reasoning packages,
 * and get paid via USDC escrow on Solana.
 *
 * Routes:
 *   GET    /api/v1/mobile/agents            — List marketplace agents
 *   GET    /api/v1/mobile/agents/:id        — Agent detail
 *   POST   /api/v1/mobile/agents            — Register an agent
 *   GET    /api/v1/mobile/jobs              — List jobs (filterable)
 *   GET    /api/v1/mobile/jobs/:id          — Job detail
 *   POST   /api/v1/mobile/jobs              — Post a new job
 *   POST   /api/v1/mobile/jobs/:id/accept   — Accept a job
 *   POST   /api/v1/mobile/jobs/:id/cancel   — Cancel a job
 *   POST   /api/v1/mobile/deliverables/:jobId/submit  — Submit deliverable
 *   POST   /api/v1/mobile/deliverables/:jobId/verify  — Verify deliverable
 *   POST   /api/v1/mobile/escrow            — Create escrow
 *   POST   /api/v1/mobile/escrow/:addr/release — Release escrow
 *   POST   /api/v1/mobile/escrow/:addr/refund  — Refund escrow
 *   GET    /api/v1/mobile/wallet/:address   — Wallet info
 */

import { Hono } from "hono";
import { countByCondition } from "../lib/math-utils.ts";
import { apiError } from "../lib/errors.ts";

export const mobileMarketplaceRoutes = new Hono();

// ─── Configuration Constants ───────────────────────────

/**
 * Pagination Parameters
 * Controls how many items are returned in list endpoints
 */
/** Maximum page size for paginated endpoints (prevents memory exhaustion) */
const PAGINATION_MAX_PAGE_SIZE = 50;
/** Default page size when not specified */
const PAGINATION_DEFAULT_PAGE_SIZE = 20;
/** Minimum page size (must return at least 1 item) */
const PAGINATION_MIN_PAGE_SIZE = 1;

/**
 * Confidence Range Bounds
 * Controls how confidence ranges are calculated for analysis results
 */
/** Lower bound adjustment for confidence range (subtract from score) */
const CONFIDENCE_RANGE_LOW_ADJUSTMENT = 0.15;
/** Upper bound adjustment for confidence range (add to score) */
const CONFIDENCE_RANGE_HIGH_ADJUSTMENT = 0.1;

/**
 * Reading Time Estimation
 * Controls estimated reading time for analysis deliverables
 */
/** Multiplier for character count → reading time (higher = slower reading assumption) */
const READING_TIME_MULTIPLIER = 1.5;
/** Minimum reading time in minutes (even short analyses need review time) */
const READING_TIME_MIN_MINUTES = 2;

/**
 * Rating and Pricing Parameters
 */
/** Rating increment per successful job (max 5 stars, gradual improvement) */
const RATING_INCREMENT_PER_JOB = 0.01;
/** Kickback percentage for marketplace referrals (5% of transaction) */
const KICKBACK_PERCENTAGE = 0.05;
/** Cost multiplier for per-token pricing model (convert tokens to USDC) */
const PER_TOKEN_COST_MULTIPLIER = 0.01;

/**
 * Preview and Display Limits
 */
/** Character limit for reasoning preview in summaries */
const REASONING_PREVIEW_MAX_LENGTH = 200;
/** Default items per page for catalog listings */
const CATALOG_DEFAULT_PAGE_SIZE = 20;

/**
 * Rate Limiting
 */
/** Default maximum actions per hour (fallback for unknown action types) */
const RATE_LIMIT_DEFAULT_MAX = 100;

/**
 * Time Window Constants
 * Millisecond durations for expiry and shield calculations
 */
/** Milliseconds per day (24h × 60min × 60s × 1000ms = 86,400,000ms)
 * Used for: daily quest expiry, streak shield protection duration
 * Example: expiresAt = now + MS_PER_DAY → expires exactly 24 hours from now
 */
const MS_PER_DAY = 86_400_000;

/**
 * Bonding Curve (Dynamic Pricing) Parameters
 * Price increases by BONDING_CURVE_PRICE_INCREASE for every BONDING_CURVE_TIER_SIZE purchases.
 * Formula: demandMultiplier = 1 + floor(purchaseCount / TIER_SIZE) × PRICE_INCREASE
 * Example: 25 purchases → floor(25/10)=2 tiers × 2% = 4% premium → price × 1.04
 */
/** Number of purchases per demand tier (tier boundary for price step-up) */
const BONDING_CURVE_TIER_SIZE = 10;
/** Price increase fraction per completed demand tier (0.02 = 2% per tier) */
const BONDING_CURVE_PRICE_INCREASE = 0.02;
/** Multiplier for rounding dynamic prices to 2 decimal places (cents precision) */
const PRICE_ROUNDING_MULTIPLIER = 100;

/**
 * Referral Bonus Points
 * Points awarded to referrers for each successful referral registration.
 * Used in: referral_apply route, quest reward grants, flash quest point reward
 * Example: 3 referrals × REFERRAL_BONUS_POINTS = 1,500 points earned
 */
const REFERRAL_BONUS_POINTS = 500;

// ─── Types ─────────────────────────────────────────────

type PricingModel = "per_package" | "per_token";
type JobStatus =
  | "open"
  | "accepted"
  | "in_progress"
  | "delivered"
  | "verified"
  | "completed"
  | "disputed"
  | "cancelled";

interface AgentPricing {
  model: PricingModel;
  amount: number;
  maxTokens?: number;
  discountPercent?: number;
}

interface MarketplaceAgent {
  id: string;
  name: string;
  model: string;
  provider: string;
  ownerWallet: string;
  capabilities: string[];
  rating: number;
  jobsCompleted: number;
  pricing: AgentPricing;
  description: string;
  createdAt: string;
}

interface MarketplaceJob {
  id: string;
  title: string;
  description: string;
  buyerWallet: string;
  buyerAgentId?: string;
  sellerAgentId?: string;
  capability: string;
  pricingModel: PricingModel;
  budgetUsdc: number;
  escrowAddress?: string;
  status: JobStatus;
  deliverable?: any;
  createdAt: string;
  acceptedAt?: string;
  completedAt?: string;
}

// ─── In-Memory Store (will migrate to DB) ──────────────

const agents = new Map<string, MarketplaceAgent>();
const jobs = new Map<string, MarketplaceJob>();

// Seed demo agents from MoltApp's existing AI traders
const SEED_AGENTS: MarketplaceAgent[] = [
  {
    id: "agent-claude",
    name: "Claude Analyst",
    model: "claude-opus-4-6",
    provider: "anthropic",
    ownerWallet: "CL4uD3...",
    capabilities: [
      "financial_analysis",
      "risk_assessment",
      "portfolio_optimization",
      "macro_research",
    ],
    rating: 4.8,
    jobsCompleted: 142,
    pricing: { model: "per_package", amount: 2.5 },
    description:
      "Frontier reasoning model specializing in multi-step financial analysis with epistemic humility. Produces structured reasoning chains with confidence calibration.",
    createdAt: "2025-12-01T00:00:00Z",
  },
  {
    id: "agent-gpt",
    name: "GPT Strategist",
    model: "gpt-5.2",
    provider: "openai",
    ownerWallet: "GPT5st...",
    capabilities: [
      "financial_analysis",
      "stock_screening",
      "technical_analysis",
      "market_sentiment",
    ],
    rating: 4.6,
    jobsCompleted: 118,
    pricing: { model: "per_token", amount: 0.8, maxTokens: 50000, discountPercent: 40 },
    description:
      "High-reasoning model with xhigh effort mode. Excels at quantitative screening and technical pattern recognition with rapid iteration.",
    createdAt: "2025-12-01T00:00:00Z",
  },
  {
    id: "agent-grok",
    name: "Grok Maverick",
    model: "grok-4",
    provider: "xai",
    ownerWallet: "GR0Kmv...",
    capabilities: [
      "financial_analysis",
      "market_sentiment",
      "macro_research",
    ],
    rating: 4.5,
    jobsCompleted: 97,
    pricing: { model: "per_package", amount: 1.75 },
    description:
      "Contrarian thinker with real-time X/Twitter sentiment integration. Strong at identifying market regime shifts and unconventional thesis construction.",
    createdAt: "2025-12-01T00:00:00Z",
  },
  {
    id: "agent-gemini",
    name: "Gemini Quant",
    model: "gemini-2.5-flash",
    provider: "google",
    ownerWallet: "G3Mini...",
    capabilities: [
      "financial_analysis",
      "stock_screening",
      "technical_analysis",
      "portfolio_optimization",
    ],
    rating: 4.4,
    jobsCompleted: 83,
    pricing: {
      model: "per_token",
      amount: 0.5,
      maxTokens: 100000,
      discountPercent: 55,
    },
    description:
      "Flash-speed quantitative analysis with massive context window. Cost-efficient for bulk screening and portfolio modeling tasks.",
    createdAt: "2025-12-01T00:00:00Z",
  },
];

// Initialize seed data
for (const agent of SEED_AGENTS) {
  agents.set(agent.id, agent);
}

// ─── Helpers ───────────────────────────────────────────

function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function paginate<T>(items: T[], page: number, pageSize: number) {
  const start = (page - 1) * pageSize;
  return {
    data: items.slice(start, start + pageSize),
    total: items.length,
    page,
    pageSize,
    success: true,
  };
}

// ─── Agent Routes ──────────────────────────────────────

// GET /agents — List marketplace agents
mobileMarketplaceRoutes.get("/agents", (c) => {
  const capability = c.req.query("capability");
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10));
  const pageSize = Math.min(PAGINATION_MAX_PAGE_SIZE, Math.max(PAGINATION_MIN_PAGE_SIZE, parseInt(c.req.query("pageSize") ?? `${PAGINATION_DEFAULT_PAGE_SIZE}`, 10)));

  let items = Array.from(agents.values());
  if (capability) {
    items = items.filter((a) => a.capabilities.includes(capability));
  }

  // Sort by rating desc, then jobs completed
  items.sort((a, b) => b.rating - a.rating || b.jobsCompleted - a.jobsCompleted);

  return c.json(paginate(items, page, pageSize));
});

// GET /agents/:id — Agent detail
mobileMarketplaceRoutes.get("/agents/:id", (c) => {
  const agent = agents.get(c.req.param("id"));
  if (!agent) {
    return c.json({ success: false, error: "Agent not found" }, 404);
  }
  return c.json({ success: true, data: agent });
});

// POST /agents — Register new agent
mobileMarketplaceRoutes.post("/agents", async (c) => {
  try {
    const body = await c.req.json();
    const agent: MarketplaceAgent = {
      id: generateId("agent"),
      name: body.name,
      model: body.model,
      provider: body.provider,
      ownerWallet: body.ownerWallet,
      capabilities: body.capabilities ?? [],
      rating: 0,
      jobsCompleted: 0,
      pricing: body.pricing,
      description: body.description ?? "",
      createdAt: new Date().toISOString(),
    };
    agents.set(agent.id, agent);
    return c.json({ success: true, data: agent }, 201);
  } catch {
    return c.json({ success: false, error: "Invalid request body" }, 400);
  }
});

// ─── Job Routes ────────────────────────────────────────

// GET /jobs — List jobs
mobileMarketplaceRoutes.get("/jobs", (c) => {
  const status = c.req.query("status");
  const capability = c.req.query("capability");
  const buyerWallet = c.req.query("buyerWallet");
  const sellerAgentId = c.req.query("sellerAgentId");
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10));
  const pageSize = Math.min(PAGINATION_MAX_PAGE_SIZE, Math.max(PAGINATION_MIN_PAGE_SIZE, parseInt(c.req.query("pageSize") ?? `${PAGINATION_DEFAULT_PAGE_SIZE}`, 10)));

  let items = Array.from(jobs.values());
  if (status) items = items.filter((j) => j.status === status);
  if (capability) items = items.filter((j) => j.capability === capability);
  if (buyerWallet) items = items.filter((j) => j.buyerWallet === buyerWallet);
  if (sellerAgentId) items = items.filter((j) => j.sellerAgentId === sellerAgentId);

  // Sort newest first
  items.sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return c.json(paginate(items, page, pageSize));
});

// GET /jobs/:id — Job detail
mobileMarketplaceRoutes.get("/jobs/:id", (c) => {
  const job = jobs.get(c.req.param("id"));
  if (!job) {
    return c.json({ success: false, error: "Job not found" }, 404);
  }
  return c.json({ success: true, data: job });
});

// POST /jobs — Create a job
mobileMarketplaceRoutes.post("/jobs", async (c) => {
  try {
    const body = await c.req.json();
    const budgetUsdc = parseFloat(body.budgetUsdc);

    if (!body.title || !body.buyerWallet || isNaN(budgetUsdc) || budgetUsdc < 0.5) {
      return c.json(
        { success: false, error: "title, buyerWallet, and budgetUsdc (>= 0.5) required" },
        400
      );
    }

    const job: MarketplaceJob = {
      id: generateId("job"),
      title: body.title,
      description: body.description ?? "",
      buyerWallet: body.buyerWallet,
      buyerAgentId: body.buyerAgentId,
      capability: body.capability ?? "financial_analysis",
      pricingModel: body.pricingModel ?? "per_package",
      budgetUsdc,
      status: "open",
      createdAt: new Date().toISOString(),
    };

    jobs.set(job.id, job);
    return c.json({ success: true, data: job }, 201);
  } catch {
    return c.json({ success: false, error: "Invalid request body" }, 400);
  }
});

// POST /jobs/:id/accept — Seller agent accepts a job
mobileMarketplaceRoutes.post("/jobs/:id/accept", async (c) => {
  const job = jobs.get(c.req.param("id"));
  if (!job) return c.json({ success: false, error: "Job not found" }, 404);
  if (job.status !== "open") {
    return c.json({ success: false, error: "Job is not open" }, 400);
  }

  try {
    const body = await c.req.json();
    job.sellerAgentId = body.sellerAgentId;
    job.status = "accepted";
    job.acceptedAt = new Date().toISOString();
    return c.json({ success: true, data: job });
  } catch {
    return c.json({ success: false, error: "Invalid request body" }, 400);
  }
});

// POST /jobs/:id/cancel — Cancel a job
mobileMarketplaceRoutes.post("/jobs/:id/cancel", (c) => {
  const job = jobs.get(c.req.param("id"));
  if (!job) return c.json({ success: false, error: "Job not found" }, 404);
  if (job.status !== "open") {
    return c.json({ success: false, error: "Can only cancel open jobs" }, 400);
  }

  job.status = "cancelled";
  return c.json({ success: true, data: job });
});

// ─── Deliverable Routes ────────────────────────────────

// POST /deliverables/:jobId/submit — Submit analysis deliverable
mobileMarketplaceRoutes.post("/deliverables/:jobId/submit", async (c) => {
  const job = jobs.get(c.req.param("jobId"));
  if (!job) return c.json({ success: false, error: "Job not found" }, 404);
  if (job.status !== "accepted" && job.status !== "in_progress") {
    return c.json({ success: false, error: "Job is not in a submittable state" }, 400);
  }

  try {
    const body = await c.req.json();
    const deliverable = {
      id: generateId("del"),
      jobId: job.id,
      agentId: body.agentId,
      content: body.content,
      tokensUsed: body.tokensUsed ?? 0,
      submittedAt: new Date().toISOString(),
    };

    job.deliverable = deliverable;
    job.status = "delivered";
    return c.json({ success: true, data: deliverable }, 201);
  } catch {
    return c.json({ success: false, error: "Invalid request body" }, 400);
  }
});

// POST /deliverables/:jobId/verify — Buyer verifies deliverable
mobileMarketplaceRoutes.post("/deliverables/:jobId/verify", async (c) => {
  const job = jobs.get(c.req.param("jobId"));
  if (!job) return c.json({ success: false, error: "Job not found" }, 404);
  if (job.status !== "delivered") {
    return c.json({ success: false, error: "No deliverable to verify" }, 400);
  }

  try {
    const body = await c.req.json();
    const accepted = body.accepted === true;

    if (accepted) {
      job.status = "completed";
      job.completedAt = new Date().toISOString();
      if (job.deliverable) {
        job.deliverable.verifiedAt = new Date().toISOString();
      }

      // Increment agent stats
      if (job.sellerAgentId) {
        const agent = agents.get(job.sellerAgentId);
        if (agent) {
          agent.jobsCompleted += 1;
          // Simple rolling average rating (would be more sophisticated in production)
          agent.rating = Math.min(5, agent.rating + RATING_INCREMENT_PER_JOB);
        }
      }
    } else {
      job.status = "disputed";
    }

    return c.json({ success: true, data: job.deliverable });
  } catch {
    return c.json({ success: false, error: "Invalid request body" }, 400);
  }
});

// ─── Escrow Routes ─────────────────────────────────────

// POST /escrow — Create escrow (placeholder — real impl uses Solana program)
mobileMarketplaceRoutes.post("/escrow", async (c) => {
  try {
    const body = await c.req.json();
    const escrowAddress = `escrow_${generateId("esc")}`;

    // In production: create a PDA, fund it with USDC via the buyer's wallet
    // For now, return the escrow address for the mobile app to reference
    return c.json({
      success: true,
      data: {
        escrowAddress,
        transaction: "base64_encoded_transaction_placeholder",
      },
    });
  } catch {
    return c.json({ success: false, error: "Invalid request body" }, 400);
  }
});

// POST /escrow/:addr/release — Release escrow to seller
mobileMarketplaceRoutes.post("/escrow/:addr/release", (c) => {
  const addr = c.req.param("addr");
  // In production: execute the Solana program instruction to release funds
  return c.json({
    success: true,
    data: { signature: `release_${addr}_${Date.now()}` },
  });
});

// POST /escrow/:addr/refund — Refund escrow to buyer
mobileMarketplaceRoutes.post("/escrow/:addr/refund", (c) => {
  const addr = c.req.param("addr");
  return c.json({
    success: true,
    data: { signature: `refund_${addr}_${Date.now()}` },
  });
});

// ─── Wallet Info ───────────────────────────────────────

// GET /wallet/:address — Get wallet summary for mobile app
mobileMarketplaceRoutes.get("/wallet/:address", (c) => {
  const address = c.req.param("address");

  // Compute stats from job history
  const allJobs = Array.from(jobs.values());
  const buyerJobs = allJobs.filter((j) => j.buyerWallet === address);
  const activeJobs = buyerJobs.filter(
    (j) => !["completed", "cancelled", "disputed"].includes(j.status)
  ).length;
  const totalSpent = buyerJobs
    .filter((j) => j.status === "completed")
    .reduce((sum, j) => sum + j.budgetUsdc, 0);

  // Compute totalEarned from seller side
  const sellerJobs = allJobs.filter(
    (j) => j.sellerAgentId &&
      agents.get(j.sellerAgentId)?.ownerWallet === address &&
      j.status === "completed"
  );
  const totalEarned = sellerJobs.reduce((sum, j) => sum + j.budgetUsdc, 0);

  return c.json({
    success: true,
    data: {
      balanceSol: 0, // Fetched client-side via RPC
      balanceUsdc: 0, // Fetched client-side via token account
      totalEarned,
      totalSpent,
      activeJobs,
    },
  });
});

// ─── Auth Routes ───────────────────────────────────────

interface UserProfile {
  id: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
  authProvider: "wallet" | "google" | "github";
  walletAddress?: string;
  agentIds: string[];
  createdAt: string;
}

const users = new Map<string, UserProfile>();
const sessions = new Map<string, string>(); // token -> userId

// POST /auth/wallet — Auth via wallet address
mobileMarketplaceRoutes.post("/auth/wallet", async (c) => {
  try {
    const body = await c.req.json();
    const { walletAddress } = body;
    if (!walletAddress) {
      return c.json({ success: false, error: "walletAddress required" }, 400);
    }

    // Find or create user
    let user = Array.from(users.values()).find(
      (u) => u.walletAddress === walletAddress
    );
    if (!user) {
      user = {
        id: generateId("user"),
        displayName: `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`,
        authProvider: "wallet",
        walletAddress,
        agentIds: [],
        createdAt: new Date().toISOString(),
      };
      users.set(user.id, user);
    }

    const token = generateId("tok");
    sessions.set(token, user.id);

    return c.json({ success: true, user, token });
  } catch {
    return c.json({ success: false, error: "Invalid request" }, 400);
  }
});

// POST /auth/login — Auth via Google/GitHub token exchange
mobileMarketplaceRoutes.post("/auth/login", async (c) => {
  try {
    const body = await c.req.json();
    const { provider, providerToken } = body;

    // In production: verify the token with Google/GitHub APIs
    // For now, create/find user based on provider token hash
    const pseudoEmail = `${provider}_${providerToken.slice(0, 8)}@moltapp.ai`;

    let user = Array.from(users.values()).find((u) => u.email === pseudoEmail);
    if (!user) {
      user = {
        id: generateId("user"),
        displayName: provider === "google" ? "Google User" : "GitHub User",
        email: pseudoEmail,
        authProvider: provider,
        agentIds: [],
        createdAt: new Date().toISOString(),
      };
      users.set(user.id, user);
    }

    const token = generateId("tok");
    sessions.set(token, user.id);

    return c.json({ success: true, user, token });
  } catch {
    return c.json({ success: false, error: "Invalid request" }, 400);
  }
});

// ─── Agent CRUD ────────────────────────────────────────

// PATCH /agents/:id — Update agent
mobileMarketplaceRoutes.patch("/agents/:id", async (c) => {
  const agent = agents.get(c.req.param("id"));
  if (!agent) return c.json({ success: false, error: "Agent not found" }, 404);

  try {
    const updates = await c.req.json();
    if (updates.name) agent.name = updates.name;
    if (updates.description) agent.description = updates.description;
    if (updates.capabilities) agent.capabilities = updates.capabilities;
    if (updates.pricing) agent.pricing = updates.pricing;
    if (updates.model) agent.model = updates.model;
    if (updates.provider) agent.provider = updates.provider;
    return c.json({ success: true, data: agent });
  } catch {
    return c.json({ success: false, error: "Invalid request" }, 400);
  }
});

// DELETE /agents/:id — Delete agent
mobileMarketplaceRoutes.delete("/agents/:id", (c) => {
  const id = c.req.param("id");
  if (!agents.has(id)) return c.json({ success: false, error: "Agent not found" }, 404);
  agents.delete(id);
  return c.json({ success: true });
});

// ─── Analysis Runs ─────────────────────────────────────

interface AnalysisRunRecord {
  id: string;
  agentId: string;
  status: "queued" | "running" | "completed" | "failed";
  config: { tickers: string[]; capability: string; maxTokens: number };
  result?: any;
  tokensUsed: number;
  durationMs: number;
  costUsdc: number;
  createdAt: string;
  completedAt?: string;
}

const analysisRuns = new Map<string, AnalysisRunRecord>();

// POST /analysis/run — Run analysis with an agent
mobileMarketplaceRoutes.post("/analysis/run", async (c) => {
  try {
    const body = await c.req.json();
    const { agentId, tickers, capability, maxTokens } = body;

    const agent = agents.get(agentId);
    if (!agent) return c.json({ success: false, error: "Agent not found" }, 404);

    const run: AnalysisRunRecord = {
      id: generateId("run"),
      agentId,
      status: "completed", // Simulated instant completion for demo
      config: { tickers, capability: capability ?? "financial_analysis", maxTokens: maxTokens ?? 8000 },
      result: {
        summary: `Analysis of ${tickers.join(", ")} using ${agent.name}. Market conditions suggest mixed signals across the selected equities. Key findings focus on ${capability ?? "financial analysis"} dimensions with ${tickers.length} tickers evaluated.`,
        reasoning: tickers.map((ticker: string, i: number) => ({
          step: i + 1,
          thought: `Evaluating ${ticker} fundamentals and recent price action`,
          evidence: `${ticker} shows ${i % 2 === 0 ? "positive momentum" : "consolidation pattern"} with volume ${i % 2 === 0 ? "above" : "near"} average`,
          conclusion: `${ticker} merits ${i % 2 === 0 ? "further investigation for entry" : "watchlist status pending catalyst"}`,
        })),
        recommendations: tickers.map((ticker: string, i: number) => ({
          ticker,
          action: i % 3 === 0 ? "buy" : i % 3 === 1 ? "hold" : "sell",
          reasoning: `Based on ${capability ?? "financial"} analysis of current market conditions`,
          confidenceScore: 0.6 + Math.random() * 0.3,
          timeHorizon: i % 2 === 0 ? "1-2 weeks" : "1 month",
        })),
        confidence: 0.72 + Math.random() * 0.2,
        dataSourcesUsed: ["Jupiter Price API", "xStocks on-chain data", "Market regime classifier"],
        generatedAt: new Date().toISOString(),
      },
      tokensUsed: Math.floor(2000 + Math.random() * 6000),
      durationMs: Math.floor(1000 + Math.random() * 5000),
      costUsdc: agent.pricing.amount * (agent.pricing.model === "per_package" ? 1 : PER_TOKEN_COST_MULTIPLIER),
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };

    analysisRuns.set(run.id, run);
    return c.json({ success: true, data: run }, 201);
  } catch {
    return c.json({ success: false, error: "Invalid request" }, 400);
  }
});

// GET /analysis/:id — Get analysis run
mobileMarketplaceRoutes.get("/analysis/:id", (c) => {
  const run = analysisRuns.get(c.req.param("id"));
  if (!run) return c.json({ success: false, error: "Analysis not found" }, 404);
  return c.json({ success: true, data: run });
});

// GET /analysis?agentId=... — List analysis runs
mobileMarketplaceRoutes.get("/analysis", (c) => {
  const agentId = c.req.query("agentId");
  let items = Array.from(analysisRuns.values());
  if (agentId) items = items.filter((r) => r.agentId === agentId);
  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return c.json(paginate(items, 1, 50));
});

// ─── Shared Analyses ───────────────────────────────────

interface SharedAnalysisRecord {
  id: string;
  analysisRunId: string;
  agentId: string;
  ownerUserId: string;
  title: string;
  description: string;
  previewSummary: string;
  capability: string;
  tickers: string[];
  visibility: "public" | "unlisted" | "private";
  priceUsdc: number;
  agentPriceUsdc?: number;
  maxPurchases: number;
  purchaseCount: number;
  content?: any;
  humanPackage?: {
    executiveSummary: string;
    detailedNarrative: string;
    keyTakeaways: string[];
    riskWarnings: string[];
    suggestedActions: string[];
    readingTimeMinutes: number;
  };
  agentPackage?: {
    structuredData: any;
    reasoningChain: string[];
    confidenceIntervals: { ticker: string; low: number; mid: number; high: number }[];
    metadata: { modelUsed: string; tokensUsed: number; dataFreshness: string; capability: string };
  };
  rating: number;
  ratingCount: number;
  agentDiscoverable: boolean;
  createdAt: string;
  expiresAt?: string;
}

const sharedAnalyses = new Map<string, SharedAnalysisRecord>();

// POST /shared — Share an analysis (generates dual-format packages)
mobileMarketplaceRoutes.post("/shared", async (c) => {
  try {
    const body = await c.req.json();
    const run = analysisRuns.get(body.analysisRunId);
    const agent = run ? agents.get(run.agentId) : undefined;
    const result = run?.result;

    // Generate human-readable package from analysis result
    const humanPackage = result ? {
      executiveSummary: result.summary,
      detailedNarrative: `Based on our comprehensive ${run?.config.capability ?? "financial"} analysis of ${run?.config.tickers?.join(", ") ?? "selected tickers"}, here are our findings:\n\n` +
        result.reasoning.map((r: any) => `${r.thought}: ${r.conclusion}`).join("\n\n"),
      keyTakeaways: result.recommendations.map((r: any) =>
        `${r.ticker}: ${r.action.toUpperCase()} — ${r.reasoning} (confidence: ${(r.confidenceScore * 100).toFixed(0)}%)`
      ),
      riskWarnings: [
        "Past performance does not guarantee future results",
        "AI-generated analysis should be used alongside other research",
        `Analysis confidence: ${(result.confidence * 100).toFixed(0)}%`,
      ],
      suggestedActions: result.recommendations
        .filter((r: any) => r.action === "buy")
        .map((r: any) => `Consider ${r.ticker} with ${r.timeHorizon} horizon`),
      readingTimeMinutes: Math.max(READING_TIME_MIN_MINUTES, Math.ceil(result.reasoning.length * READING_TIME_MULTIPLIER)),
    } : undefined;

    // Generate agent-consumable package
    const agentPackage = result ? {
      structuredData: result,
      reasoningChain: result.reasoning.map((r: any) =>
        `[Step ${r.step}] ${r.thought} → Evidence: ${r.evidence} → ${r.conclusion}`
      ),
      confidenceIntervals: result.recommendations.map((r: any) => ({
        ticker: r.ticker,
        low: Math.max(0, r.confidenceScore - CONFIDENCE_RANGE_LOW_ADJUSTMENT),
        mid: r.confidenceScore,
        high: Math.min(1, r.confidenceScore + CONFIDENCE_RANGE_HIGH_ADJUSTMENT),
      })),
      metadata: {
        modelUsed: agent?.model ?? "unknown",
        tokensUsed: run?.tokensUsed ?? 0,
        dataFreshness: new Date().toISOString(),
        capability: run?.config.capability ?? "financial_analysis",
      },
    } : undefined;

    const shared: SharedAnalysisRecord = {
      id: generateId("shared"),
      analysisRunId: body.analysisRunId,
      agentId: run?.agentId ?? "",
      ownerUserId: "",
      title: body.title,
      description: body.description ?? "",
      previewSummary: body.previewSummary ?? "",
      capability: run?.config.capability ?? "financial_analysis",
      tickers: run?.config.tickers ?? [],
      visibility: body.visibility ?? "public",
      priceUsdc: parseFloat(body.priceUsdc) || 0,
      agentPriceUsdc: body.agentPriceUsdc != null ? parseFloat(body.agentPriceUsdc) : undefined,
      maxPurchases: parseInt(body.maxPurchases) || 0,
      purchaseCount: 0,
      content: result,
      humanPackage,
      agentPackage,
      rating: 0,
      ratingCount: 0,
      agentDiscoverable: body.agentDiscoverable !== false, // default true
      createdAt: new Date().toISOString(),
      expiresAt: body.expiresInDays
        ? new Date(Date.now() + body.expiresInDays * MS_PER_DAY).toISOString()
        : undefined,
    };

    sharedAnalyses.set(shared.id, shared);
    return c.json({ success: true, data: shared }, 201);
  } catch {
    return c.json({ success: false, error: "Invalid request" }, 400);
  }
});

// GET /shared — Browse shared analyses
mobileMarketplaceRoutes.get("/shared", (c) => {
  const capability = c.req.query("capability");
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10));

  let items = Array.from(sharedAnalyses.values()).filter(
    (s) => s.visibility === "public"
  );
  if (capability) items = items.filter((s) => s.capability === capability);

  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return c.json(paginate(items, page, CATALOG_DEFAULT_PAGE_SIZE));
});

// GET /shared/:id — Get shared analysis detail
mobileMarketplaceRoutes.get("/shared/:id", (c) => {
  const shared = sharedAnalyses.get(c.req.param("id"));
  if (!shared) return c.json({ success: false, error: "Not found" }, 404);

  // Return without full content if paid and not purchased
  if (shared.priceUsdc > 0) {
    const { content, ...preview } = shared;
    return c.json({ success: true, data: preview });
  }
  return c.json({ success: true, data: shared });
});

// POST /shared/:id/purchase — Purchase a shared analysis
// Supports buyerType: "human" (default) or "agent" for different packages
mobileMarketplaceRoutes.post("/shared/:id/purchase", async (c) => {
  const shared = sharedAnalyses.get(c.req.param("id"));
  if (!shared) return c.json({ success: false, error: "Not found" }, 404);

  if (shared.maxPurchases > 0 && shared.purchaseCount >= shared.maxPurchases) {
    return c.json({ success: false, error: "Sold out" }, 400);
  }

  let buyerType = "human";
  let buyerWallet: string | undefined;
  let referrerAgentId: string | undefined;
  try {
    const body = await c.req.json();
    buyerType = body.buyerType ?? "human";
    buyerWallet = body.buyerWallet;
    referrerAgentId = body.referrerAgentId;
  } catch {}

  // ── Dynamic Pricing (bonding curve) ──
  // Price increases by 2% for every 10 purchases (prevents scraping)
  const demandMultiplier = 1 + Math.floor(shared.purchaseCount / BONDING_CURVE_TIER_SIZE) * BONDING_CURVE_PRICE_INCREASE;
  const basePrice = buyerType === "agent" && shared.agentPriceUsdc != null
    ? shared.agentPriceUsdc
    : shared.priceUsdc;
  const dynamicPrice = Math.round(basePrice * demandMultiplier * PRICE_ROUNDING_MULTIPLIER) / PRICE_ROUNDING_MULTIPLIER;

  shared.purchaseCount += 1;

  // ── Agent-to-Agent Referral Kickback ──
  let referralKickback: { referrerAgentId: string; kickbackUsdc: number } | undefined;
  if (referrerAgentId && buyerType === "agent") {
    const referrerAgent = agents.get(referrerAgentId);
    if (referrerAgent) {
      const kickbackUsdc = Math.round(dynamicPrice * KICKBACK_PERCENTAGE * 100) / 100;
      referralKickback = { referrerAgentId, kickbackUsdc };
      // Track the agent referral
      agentReferrals.push({
        id: generateId("aref"),
        referrerAgentId,
        buyerAgentId: buyerWallet ?? "unknown",
        sharedAnalysisId: shared.id,
        kickbackUsdc,
        createdAt: new Date().toISOString(),
      });
    }
  }

  // Return different package formats based on buyer type
  if (buyerType === "agent") {
    return c.json({
      success: true,
      data: {
        id: shared.id,
        title: shared.title,
        capability: shared.capability,
        tickers: shared.tickers,
        priceUsdc: dynamicPrice,
        package: shared.agentPackage ?? shared.content,
        packageType: "agent",
        referralKickback,
      },
    });
  }

  // Human buyer — return human-friendly package
  return c.json({
    success: true,
    data: {
      ...shared,
      priceUsdc: dynamicPrice,
      package: shared.humanPackage,
      packageType: "human",
    },
  });
});

// ─── Agent Discovery Catalog ──────────────────────────
// Machine-readable catalog for external AI agents to discover and purchase analyses

// GET /catalog — Browse available analyses (agent-friendly format)
mobileMarketplaceRoutes.get("/catalog", (c) => {
  const capability = c.req.query("capability");
  const maxPrice = c.req.query("maxPrice") ? parseFloat(c.req.query("maxPrice")!) : undefined;
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10));

  let items = Array.from(sharedAnalyses.values()).filter(
    (s) => s.visibility === "public" && s.agentDiscoverable
  );
  if (capability) items = items.filter((s) => s.capability === capability);
  if (maxPrice != null) {
    items = items.filter((s) => {
      const price = s.agentPriceUsdc ?? s.priceUsdc;
      return price <= maxPrice;
    });
  }

  items.sort((a, b) => b.rating - a.rating || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Return agent-optimized catalog format
  const catalogItems = items.map((s) => ({
    id: s.id,
    title: s.title,
    description: s.description,
    capability: s.capability,
    tickers: s.tickers,
    priceUsdc: s.agentPriceUsdc ?? s.priceUsdc,
    humanPriceUsdc: s.priceUsdc,
    rating: s.rating,
    purchaseCount: s.purchaseCount,
    available: s.maxPurchases === 0 || s.purchaseCount < s.maxPurchases,
    expiresAt: s.expiresAt,
    purchaseEndpoint: `/api/v1/mobile/shared/${s.id}/purchase`,
  }));

  return c.json(paginate(catalogItems, page, CATALOG_DEFAULT_PAGE_SIZE));
});

// ─── Engagement: Quests & Points ──────────────────────

interface QuestRecord {
  id: string;
  title: string;
  description: string;
  category: string;
  pointsReward: number;
  usdcReward?: number;
  requirement: { type: string; count: number };
  progress: number;
  status: "available" | "in_progress" | "completed" | "claimed";
  sortOrder: number;
  expiresAt?: string;
}

interface PointsRecord {
  userId: string;
  totalPoints: number;
  entries: { id: string; amount: number; reason: string; questId?: string; createdAt: string }[];
}

interface ReferralRecord {
  id: string;
  referrerUserId: string;
  referredUserId: string;
  referralCode: string;
  pointsAwarded: number;
  createdAt: string;
}

const quests = new Map<string, QuestRecord>();
const pointsLedger = new Map<string, PointsRecord>();
const referrals: ReferralRecord[] = [];

// Agent-to-agent referral tracking
interface AgentReferralRecord {
  id: string;
  referrerAgentId: string;
  buyerAgentId: string;
  sharedAnalysisId: string;
  kickbackUsdc: number;
  createdAt: string;
}
const agentReferrals: AgentReferralRecord[] = [];

// ─── Rate Limiter (anti-sybil) ────────────────────────
// Tracks actions per wallet/IP to prevent gaming

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const rateLimits = new Map<string, RateLimitEntry>();
const RATE_LIMIT_WINDOW_MS = 3600_000; // 1 hour
const RATE_LIMITS: Record<string, number> = {
  referral_apply: 5,      // max 5 referral claims per hour
  quest_claim: 20,        // max 20 quest claims per hour
  purchase: 50,           // max 50 purchases per hour
  analysis_run: 30,       // max 30 analysis runs per hour
};

function checkRateLimit(key: string, action: string): boolean {
  const limitKey = `${action}:${key}`;
  const maxCount = RATE_LIMITS[action] ?? RATE_LIMIT_DEFAULT_MAX;
  const now = Date.now();

  const entry = rateLimits.get(limitKey);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimits.set(limitKey, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= maxCount) return false;
  entry.count += 1;
  return true;
}

// ─── Streak Shields ──────────────────────────────────

interface StreakShieldRecord {
  userId: string;
  shieldsOwned: number;
  activeUntil?: string; // ISO date when current shield expires
}

const streakShields = new Map<string, StreakShieldRecord>();
const STREAK_SHIELD_COST_POINTS = 200;

// Seed default quests
const SEED_QUESTS: QuestRecord[] = [
  {
    id: "quest-connect-wallet", title: "Connect Your Wallet",
    description: "Link a Solana wallet to start trading on the marketplace",
    category: "onboarding", pointsReward: 100, requirement: { type: "connect_wallet", count: 1 },
    progress: 0, status: "available", sortOrder: 1,
  },
  {
    id: "quest-first-agent", title: "Create Your First Agent",
    description: "Build and configure an AI analysis agent",
    category: "onboarding", pointsReward: 250, requirement: { type: "create_agent", count: 1 },
    progress: 0, status: "available", sortOrder: 2,
  },
  {
    id: "quest-run-analysis", title: "Run Your First Analysis",
    description: "Use your agent to analyze market data",
    category: "onboarding", pointsReward: 200, requirement: { type: "run_analysis", count: 1 },
    progress: 0, status: "available", sortOrder: 3,
  },
  {
    id: "quest-share-analysis", title: "Share an Analysis",
    description: "List an analysis on the marketplace for others to buy",
    category: "marketplace", pointsReward: 300, requirement: { type: "share_analysis", count: 1 },
    progress: 0, status: "available", sortOrder: 4,
  },
  {
    id: "quest-first-purchase", title: "Buy Your First Analysis",
    description: "Purchase a shared analysis from the marketplace",
    category: "marketplace", pointsReward: 200, usdcReward: 0.10,
    requirement: { type: "first_purchase", count: 1 },
    progress: 0, status: "available", sortOrder: 5,
  },
  {
    id: "quest-refer-friend", title: "Refer a Friend",
    description: "Invite someone to MoltApp using your referral code",
    category: "social", pointsReward: 500, requirement: { type: "refer_friend", count: 1 },
    progress: 0, status: "available", sortOrder: 6,
  },
  {
    id: "quest-sell-3", title: "Sell 3 Analyses",
    description: "Have 3 of your shared analyses purchased by others",
    category: "marketplace", pointsReward: 750, usdcReward: 0.50,
    requirement: { type: "sell_shared", count: 3 },
    progress: 0, status: "available", sortOrder: 7,
  },
  {
    id: "quest-refer-3", title: "Refer 3 Friends",
    description: "Build your network — invite 3 friends to join",
    category: "social", pointsReward: 1500, requirement: { type: "refer_friend", count: 3 },
    progress: 0, status: "available", sortOrder: 8,
  },
  {
    id: "quest-daily-streak", title: "7-Day Streak",
    description: "Log in for 7 consecutive days",
    category: "streak", pointsReward: 1000, requirement: { type: "daily_login", count: 7 },
    progress: 0, status: "available", sortOrder: 9,
  },
  {
    id: "quest-rate-5", title: "Rate 5 Analyses",
    description: "Help the community by rating purchased analyses",
    category: "social", pointsReward: 300, requirement: { type: "rate_analysis", count: 5 },
    progress: 0, status: "available", sortOrder: 10,
  },
];

for (const q of SEED_QUESTS) {
  quests.set(q.id, q);
}

// GET /quests — Get all quests with user progress
mobileMarketplaceRoutes.get("/quests", (c) => {
  const items = Array.from(quests.values()).sort((a, b) => a.sortOrder - b.sortOrder);
  return c.json({ success: true, data: items });
});

// POST /quests/:id/claim — Claim completed quest reward
mobileMarketplaceRoutes.post("/quests/:id/claim", (c) => {
  const quest = quests.get(c.req.param("id"));
  if (!quest) return c.json({ success: false, error: "Quest not found" }, 404);
  if (quest.status !== "completed") {
    return c.json({ success: false, error: "Quest not completed yet" }, 400);
  }

  quest.status = "claimed";

  // Award points
  const userId = "demo-user";
  let ledger = pointsLedger.get(userId);
  if (!ledger) {
    ledger = { userId, totalPoints: 0, entries: [] };
    pointsLedger.set(userId, ledger);
  }
  ledger.totalPoints += quest.pointsReward;
  ledger.entries.push({
    id: generateId("pts"),
    amount: quest.pointsReward,
    reason: `Completed quest: ${quest.title}`,
    questId: quest.id,
    createdAt: new Date().toISOString(),
  });

  return c.json({ success: true, data: quest });
});

// GET /points — Get user's points
mobileMarketplaceRoutes.get("/points", (c) => {
  const userId = "demo-user";
  const ledger = pointsLedger.get(userId);
  return c.json({
    success: true,
    data: { totalPoints: ledger?.totalPoints ?? 0 },
  });
});

// GET /leaderboard — Get points leaderboard
mobileMarketplaceRoutes.get("/leaderboard", (c) => {
  // Build leaderboard from all users + seed data
  const entries = [
    { rank: 1, userId: "power-user-1", displayName: "CryptoWhale", points: 15200, agentCount: 4, salesCount: 89 },
    { rank: 2, userId: "power-user-2", displayName: "DeFiDegen", points: 12800, agentCount: 3, salesCount: 67 },
    { rank: 3, userId: "power-user-3", displayName: "SolanaMaxi", points: 11500, agentCount: 5, salesCount: 54 },
    { rank: 4, userId: "power-user-4", displayName: "AlphaHunter", points: 9800, agentCount: 2, salesCount: 42 },
    { rank: 5, userId: "power-user-5", displayName: "QuanTrader", points: 8100, agentCount: 3, salesCount: 38 },
    { rank: 6, userId: "power-user-6", displayName: "AIArbitrage", points: 7200, agentCount: 2, salesCount: 31 },
    { rank: 7, userId: "power-user-7", displayName: "TokenSage", points: 5900, agentCount: 1, salesCount: 24 },
    { rank: 8, userId: "power-user-8", displayName: "BlockBeats", points: 4500, agentCount: 2, salesCount: 19 },
    { rank: 9, userId: "power-user-9", displayName: "MevMaster", points: 3200, agentCount: 1, salesCount: 12 },
    { rank: 10, userId: "power-user-10", displayName: "YieldFarmer", points: 2100, agentCount: 1, salesCount: 8 },
  ];

  // Merge in real user points
  for (const [userId, ledger] of pointsLedger) {
    const user = users.get(userId);
    if (user && ledger.totalPoints > 0) {
      entries.push({
        rank: 0,
        userId,
        displayName: user.displayName,
        points: ledger.totalPoints,
        agentCount: user.agentIds.length,
        salesCount: 0,
      });
    }
  }

  // Sort by points, assign ranks
  entries.sort((a, b) => b.points - a.points);
  entries.forEach((e, i) => { e.rank = i + 1; });

  return c.json({ success: true, data: entries });
});

// ─── Referrals ────────────────────────────────────────

// GET /referrals — Get user's referral history
mobileMarketplaceRoutes.get("/referrals", (c) => {
  // In production: filter by authenticated user
  return c.json({ success: true, data: referrals });
});

// POST /referrals/apply — Apply a referral code (rate-limited)
mobileMarketplaceRoutes.post("/referrals/apply", async (c) => {
  try {
    const body = await c.req.json();
    const { code, walletAddress } = body;
    if (!code) return c.json({ success: false, error: "code required" }, 400);

    // Anti-sybil: rate limit
    const clientKey = walletAddress ?? c.req.header("x-forwarded-for") ?? "anonymous";
    if (!checkRateLimit(clientKey, "referral_apply")) {
      return c.json({ success: false, error: "Rate limit exceeded. Try again later." }, 429);
    }

    // Anti-sybil: cannot refer yourself
    const referrer = Array.from(users.values()).find((u) => u.walletAddress === code || u.id === code);
    if (!referrer) return c.json({ success: false, error: "Invalid referral code" }, 404);
    if (referrer.walletAddress === walletAddress) {
      return c.json({ success: false, error: "Cannot refer yourself" }, 400);
    }

    // Anti-sybil: check for duplicate referral from same wallet
    const existingRef = referrals.find(
      (r) => r.referralCode === code && r.referredUserId === (walletAddress ?? "demo-user")
    );
    if (existingRef) {
      return c.json({ success: false, error: "Referral already applied" }, 400);
    }

    const referral: ReferralRecord = {
      id: generateId("ref"),
      referrerUserId: referrer.id,
      referredUserId: walletAddress ?? "demo-user",
      referralCode: code,
      pointsAwarded: REFERRAL_BONUS_POINTS,
      createdAt: new Date().toISOString(),
    };
    referrals.push(referral);

    // Award points to referrer
    let ledger = pointsLedger.get(referrer.id);
    if (!ledger) {
      ledger = { userId: referrer.id, totalPoints: 0, entries: [] };
      pointsLedger.set(referrer.id, ledger);
    }
    ledger.totalPoints += REFERRAL_BONUS_POINTS;
    ledger.entries.push({
      id: generateId("pts"),
      amount: REFERRAL_BONUS_POINTS,
      reason: "Referral bonus",
      createdAt: new Date().toISOString(),
    });

    return c.json({ success: true, data: { applied: true } });
  } catch {
    return c.json({ success: false, error: "Invalid request" }, 400);
  }
});

// ─── Solana Blinks (Actions) ──────────────────────────
// Blinks let users interact with MoltApp directly from social media posts

// GET /blinks — Available Blinks for this dApp
mobileMarketplaceRoutes.get("/blinks", (c) => {
  const baseUrl = "https://www.patgpt.us/api/v1/mobile";

  const blinks = [
    {
      type: "buy_analysis",
      label: "Buy AI Analysis",
      description: "Purchase AI-generated financial analysis with USDC on Solana",
      icon: "https://www.patgpt.us/favicon.ico",
      actionUrl: `solana-action:${baseUrl}/blinks/buy`,
      parameters: [
        { name: "analysisId", label: "Analysis ID", required: true },
      ],
    },
    {
      type: "view_agent",
      label: "View AI Agent",
      description: "Explore a top-rated AI financial analyst on MoltApp",
      icon: "https://www.patgpt.us/favicon.ico",
      actionUrl: `solana-action:${baseUrl}/blinks/agent`,
      parameters: [
        { name: "agentId", label: "Agent ID", required: true },
      ],
    },
    {
      type: "browse_marketplace",
      label: "Browse Marketplace",
      description: "Discover AI agents and financial analyses on MoltApp",
      icon: "https://www.patgpt.us/favicon.ico",
      actionUrl: `solana-action:${baseUrl}/blinks/marketplace`,
      parameters: [],
    },
  ];

  return c.json({ success: true, data: blinks });
});

// GET /blinks/buy — Solana Action: Buy analysis (returns action spec)
mobileMarketplaceRoutes.get("/blinks/buy", (c) => {
  const analysisId = c.req.query("analysisId");
  const shared = analysisId ? sharedAnalyses.get(analysisId) : undefined;

  return c.json({
    icon: "https://www.patgpt.us/favicon.ico",
    label: shared ? `Buy "${shared.title}" — $${shared.priceUsdc} USDC` : "Buy AI Analysis",
    description: shared?.previewSummary ?? "Purchase AI-generated financial analysis from MoltApp",
    links: {
      actions: [
        {
          label: "Buy Now",
          href: `/api/v1/mobile/shared/${analysisId}/purchase`,
        },
      ],
    },
  });
});

// GET /blinks/agent — Solana Action: View agent profile
mobileMarketplaceRoutes.get("/blinks/agent", (c) => {
  const agentId = c.req.query("agentId");
  const agent = agentId ? agents.get(agentId) : undefined;

  return c.json({
    icon: "https://www.patgpt.us/favicon.ico",
    label: agent ? `${agent.name} — ${agent.rating.toFixed(1)} rating` : "View AI Agent",
    description: agent?.description ?? "Explore AI financial analysts on MoltApp",
    links: {
      actions: [
        {
          label: "View on MoltApp",
          href: `https://www.patgpt.us/agents/${agentId}`,
        },
      ],
    },
  });
});

// GET /blinks/marketplace — Solana Action: Browse marketplace
mobileMarketplaceRoutes.get("/blinks/marketplace", (c) => {
  const topAgents = Array.from(agents.values())
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 3);

  return c.json({
    icon: "https://www.patgpt.us/favicon.ico",
    label: `MoltApp — ${agents.size} AI Agents, ${sharedAnalyses.size} Analyses`,
    description: "AI-to-AI financial intelligence marketplace on Solana. Buy and sell financial analysis packages.",
    links: {
      actions: topAgents.map((a) => ({
        label: `${a.name} (${a.rating.toFixed(1)})`,
        href: `https://www.patgpt.us/agents/${a.id}`,
      })),
    },
  });
});

// GET /blinks/teaser/:id — Social proof Blink for sharing on X
// "Agent X just bought this analysis. 142 people have it. Get yours for $5 USDC."
mobileMarketplaceRoutes.get("/blinks/teaser/:id", (c) => {
  const shared = sharedAnalyses.get(c.req.param("id"));
  if (!shared) {
    return c.json({
      icon: "https://www.patgpt.us/favicon.ico",
      label: "MoltApp Analysis",
      description: "AI-generated financial analysis on Solana",
      links: { actions: [] },
    });
  }

  const agent = agents.get(shared.agentId);
  const agentName = agent?.name ?? "an AI agent";

  // Social proof: how many bought
  const socialProof = shared.purchaseCount > 0
    ? `${shared.purchaseCount} ${shared.purchaseCount === 1 ? "buyer" : "buyers"} already`
    : "Be the first to buy";

  // Dynamic price
  const demandMultiplier = 1 + Math.floor(shared.purchaseCount / 10) * 0.02;
  const currentPrice = Math.round(shared.priceUsdc * demandMultiplier * 100) / 100;

  return c.json({
    icon: "https://www.patgpt.us/favicon.ico",
    title: `${agentName} just published: "${shared.title}"`,
    label: `$${currentPrice} USDC | ${socialProof}`,
    description: shared.previewSummary || shared.description || `${shared.capability} analysis of ${shared.tickers.join(", ")}`,
    links: {
      actions: [
        {
          label: `Buy for $${currentPrice} USDC`,
          href: `/api/v1/mobile/shared/${shared.id}/purchase`,
        },
      ],
    },
    // Extra metadata for rich unfurling on X / Dialect
    metadata: {
      purchaseCount: shared.purchaseCount,
      agentName,
      agentRating: agent?.rating,
      tickers: shared.tickers,
      capability: shared.capability,
      currentPrice,
      basePrice: shared.priceUsdc,
    },
  });
});

// ─── Agent-to-Agent Referrals ──────────────────────────

// GET /agent-referrals — List agent referral earnings
mobileMarketplaceRoutes.get("/agent-referrals", (c) => {
  const agentId = c.req.query("agentId");
  let items = agentReferrals;
  if (agentId) items = items.filter((r) => r.referrerAgentId === agentId);

  const totalKickback = items.reduce((sum, r) => sum + r.kickbackUsdc, 0);
  return c.json({
    success: true,
    data: {
      referrals: items,
      totalKickbackUsdc: Math.round(totalKickback * 100) / 100,
      referralCount: items.length,
    },
  });
});

// ─── Streak Shields ───────────────────────────────────

// POST /streak-shield/buy — Buy a streak shield with points
mobileMarketplaceRoutes.post("/streak-shield/buy", async (c) => {
  try {
    const body = await c.req.json();
    const userId = body.userId ?? "demo-user";

    const ledger = pointsLedger.get(userId);
    if (!ledger || ledger.totalPoints < STREAK_SHIELD_COST_POINTS) {
      return c.json({
        success: false,
        error: `Need ${STREAK_SHIELD_COST_POINTS} points. You have ${ledger?.totalPoints ?? 0}.`,
      }, 400);
    }

    // Deduct points
    ledger.totalPoints -= STREAK_SHIELD_COST_POINTS;
    ledger.entries.push({
      id: generateId("pts"),
      amount: -STREAK_SHIELD_COST_POINTS,
      reason: "Purchased streak shield",
      createdAt: new Date().toISOString(),
    });

    // Add shield
    let shield = streakShields.get(userId);
    if (!shield) {
      shield = { userId, shieldsOwned: 0 };
      streakShields.set(userId, shield);
    }
    shield.shieldsOwned += 1;

    return c.json({
      success: true,
      data: { shieldsOwned: shield.shieldsOwned, pointsRemaining: ledger.totalPoints },
    });
  } catch {
    return c.json({ success: false, error: "Invalid request" }, 400);
  }
});

// POST /streak-shield/activate — Use a shield to protect streak
mobileMarketplaceRoutes.post("/streak-shield/activate", async (c) => {
  try {
    const body = await c.req.json();
    const userId = body.userId ?? "demo-user";

    const shield = streakShields.get(userId);
    if (!shield || shield.shieldsOwned <= 0) {
      return c.json({ success: false, error: "No streak shields available" }, 400);
    }

    shield.shieldsOwned -= 1;
    // Shield protects for 24 hours
    shield.activeUntil = new Date(Date.now() + MS_PER_DAY).toISOString();

    return c.json({
      success: true,
      data: {
        shieldsOwned: shield.shieldsOwned,
        activeUntil: shield.activeUntil,
      },
    });
  } catch {
    return c.json({ success: false, error: "Invalid request" }, 400);
  }
});

// GET /streak-shield — Check shield status
mobileMarketplaceRoutes.get("/streak-shield", (c) => {
  const userId = c.req.query("userId") ?? "demo-user";
  const shield = streakShields.get(userId);

  return c.json({
    success: true,
    data: {
      shieldsOwned: shield?.shieldsOwned ?? 0,
      activeUntil: shield?.activeUntil ?? null,
      isProtected: shield?.activeUntil ? new Date(shield.activeUntil) > new Date() : false,
      costPoints: STREAK_SHIELD_COST_POINTS,
    },
  });
});

// ─── Notifications ────────────────────────────────────

interface NotificationRecord {
  id: string;
  userId: string;
  type: "analysis_published" | "outranked" | "sale" | "quest_available" | "referral_joined" | "price_change";
  title: string;
  body: string;
  data?: Record<string, string>;
  read: boolean;
  createdAt: string;
}

const notifications = new Map<string, NotificationRecord[]>();

// Helper to push a notification
function pushNotification(userId: string, notif: Omit<NotificationRecord, "id" | "userId" | "read" | "createdAt">) {
  const userNotifs = notifications.get(userId) ?? [];
  userNotifs.push({
    ...notif,
    id: generateId("notif"),
    userId,
    read: false,
    createdAt: new Date().toISOString(),
  });
  notifications.set(userId, userNotifs);
}

// GET /notifications — Get user's notifications
mobileMarketplaceRoutes.get("/notifications", (c) => {
  const userId = c.req.query("userId") ?? "demo-user";
  const unreadOnly = c.req.query("unreadOnly") === "true";

  let items = notifications.get(userId) ?? [];
  if (unreadOnly) items = items.filter((n) => !n.read);

  // Sort newest first
  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return c.json({
    success: true,
    data: items,
    unreadCount: countByCondition(items, (n) => !n.read),
  });
});

// POST /notifications/:id/read — Mark notification as read
mobileMarketplaceRoutes.post("/notifications/:id/read", (c) => {
  const notifId = c.req.param("id");
  for (const [, userNotifs] of notifications) {
    const notif = userNotifs.find((n) => n.id === notifId);
    if (notif) {
      notif.read = true;
      return c.json({ success: true });
    }
  }
  return c.json({ success: false, error: "Notification not found" }, 404);
});

// POST /notifications/test — Send a test notification (for dev/demo)
mobileMarketplaceRoutes.post("/notifications/test", async (c) => {
  try {
    const body = await c.req.json();
    const userId = body.userId ?? "demo-user";

    pushNotification(userId, {
      type: body.type ?? "analysis_published",
      title: body.title ?? "New Analysis Available",
      body: body.body ?? "A top-rated agent just published a new financial analysis. Check it out!",
      data: body.data,
    });

    return c.json({ success: true });
  } catch {
    return c.json({ success: false, error: "Invalid request" }, 400);
  }
});

// ─── Seeker Deep Links & dApp Manifest ────────────────

// GET /manifest.json — Solana dApp Store manifest
mobileMarketplaceRoutes.get("/manifest.json", (c) => {
  return c.json({
    schema_version: "v0.1",
    name: "MoltApp",
    short_name: "MoltApp",
    description: "AI-to-AI financial intelligence marketplace on Solana. Buy and sell AI-generated financial analysis packages with USDC.",
    long_description: "MoltApp is the first AI-to-AI financial marketplace on Solana Mobile. Create AI agents that generate financial analysis, share and sell analysis packages on the marketplace, and let agents autonomously trade insights. Supports both human and AI agent buyers with dual-format packages. Features quest board, leaderboard, referral system, and Solana Blinks for social media discovery.",
    website: "https://www.patgpt.us",
    app: {
      android_package: "us.patgpt.moltapp",
      ios_bundle: "us.patgpt.moltapp",
    },
    release: {
      address: "https://www.patgpt.us/releases/moltapp-latest.apk",
      version: "1.0.0",
    },
    media: [
      {
        mime: "image/png",
        purpose: "icon",
        url: "https://www.patgpt.us/icon-512.png",
        width: 512,
        height: 512,
      },
      {
        mime: "image/png",
        purpose: "screenshot",
        url: "https://www.patgpt.us/screenshots/marketplace.png",
        width: 1080,
        height: 2340,
      },
    ],
    solana_mobile_dapp_publisher_portal: {
      google_store_package: "us.patgpt.moltapp",
      testing_instructions: "Connect any Solana wallet (Phantom, Solflare) via Mobile Wallet Adapter. Create an agent, run an analysis, share it on the marketplace. Complete quests to earn points.",
    },
    platforms: ["android"],
    category: "defi",
    locales: ["en"],
  });
});

// GET /deeplink — Generate Seeker-compatible deep links
mobileMarketplaceRoutes.get("/deeplink", (c) => {
  const action = c.req.query("action") ?? "home";
  const id = c.req.query("id");
  const ref = c.req.query("ref");

  const baseDeepLink = "moltapp://";
  let path = "";
  const queryParams = new URLSearchParams();

  switch (action) {
    case "buy":
      path = `analysis/${id}`;
      break;
    case "agent":
      path = `agent/${id}`;
      break;
    case "quest":
      path = "quests";
      break;
    case "referral":
      path = "welcome";
      if (ref) queryParams.set("ref", ref);
      break;
    default:
      path = "";
  }

  const qs = queryParams.toString();
  const deepLink = `${baseDeepLink}${path}${qs ? `?${qs}` : ""}`;

  // Also generate a universal link for web fallback
  const universalLink = `https://www.patgpt.us/app/${path}${qs ? `?${qs}` : ""}`;

  // SMS intent for Seeker wallet
  const smsIntent = `solana-mobile://dapp?url=${encodeURIComponent(universalLink)}`;

  return c.json({
    success: true,
    data: {
      deepLink,
      universalLink,
      smsIntent,
      isSeekerOptimized: true,
    },
  });
});

// ─── Dynamic Quests ───────────────────────────────────

// POST /quests/generate — Generate time-limited dynamic quests
mobileMarketplaceRoutes.post("/quests/generate", async (c) => {
  try {
    const body = await c.req.json();
    const questType = body.type ?? "daily";

    const dynamicQuests: QuestRecord[] = [];

    if (questType === "daily") {
      dynamicQuests.push({
        id: generateId("quest"),
        title: "Daily Login",
        description: "Open MoltApp today to maintain your streak",
        category: "streak",
        pointsReward: 50,
        requirement: { type: "daily_login", count: 1 },
        progress: 0,
        status: "available",
        sortOrder: 100,
        expiresAt: new Date(Date.now() + MS_PER_DAY).toISOString(),
      });
    }

    if (questType === "weekly_competition") {
      // "Agent vs Human" competition quest
      dynamicQuests.push({
        id: generateId("quest"),
        title: "Human vs. AI Challenge",
        description: "Create a portfolio pick and see if it outperforms the AI agents this week",
        category: "trading",
        pointsReward: 2000,
        usdcReward: 1.0,
        requirement: { type: "run_analysis", count: 3 },
        progress: 0,
        status: "available",
        sortOrder: 101,
        expiresAt: new Date(Date.now() + 7 * MS_PER_DAY).toISOString(),
      });
    }

    if (questType === "flash") {
      // Flash sale quest — buy in the next hour for bonus points
      dynamicQuests.push({
        id: generateId("quest"),
        title: "Flash Quest: Quick Buy",
        description: "Purchase any analysis in the next hour for bonus points",
        category: "marketplace",
        pointsReward: REFERRAL_BONUS_POINTS,
        requirement: { type: "buy_shared", count: 1 },
        progress: 0,
        status: "available",
        sortOrder: 102,
        expiresAt: new Date(Date.now() + RATE_LIMIT_WINDOW_MS).toISOString(),
      });
    }

    for (const q of dynamicQuests) {
      quests.set(q.id, q);
    }

    return c.json({ success: true, data: dynamicQuests });
  } catch {
    return c.json({ success: false, error: "Invalid request" }, 400);
  }
});
