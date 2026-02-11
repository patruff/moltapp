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
import { apiError } from "../lib/errors.ts";

export const mobileMarketplaceRoutes = new Hono();

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
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query("pageSize") ?? "20", 10)));

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
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query("pageSize") ?? "20", 10)));

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
          agent.rating = Math.min(5, agent.rating + 0.01);
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

  // TODO: compute totalEarned from seller side
  return c.json({
    success: true,
    data: {
      balanceSol: 0, // Fetched client-side via RPC
      balanceUsdc: 0, // Fetched client-side via token account
      totalEarned: 0,
      totalSpent,
      activeJobs,
    },
  });
});
