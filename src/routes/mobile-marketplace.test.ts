/**
 * Mobile Marketplace API — Integration Tests
 *
 * Tests the full REST API for the mobile agent marketplace
 * including agents, jobs, auth, analysis runs, and shared analyses.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { mobileMarketplaceRoutes } from "./mobile-marketplace.ts";

// Mount the routes on a test app
const app = new Hono();
app.route("/api/v1/mobile", mobileMarketplaceRoutes);

function json(body: any): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function get(path: string) {
  const res = await app.request(`http://localhost/api/v1/mobile${path}`);
  return { status: res.status, body: await res.json() };
}

async function post(path: string, body: any) {
  const res = await app.request(
    `http://localhost/api/v1/mobile${path}`,
    json(body)
  );
  return { status: res.status, body: await res.json() };
}

async function patch(path: string, body: any) {
  const res = await app.request(`http://localhost/api/v1/mobile${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function del(path: string) {
  const res = await app.request(`http://localhost/api/v1/mobile${path}`, {
    method: "DELETE",
  });
  return { status: res.status, body: await res.json() };
}

// ─── Agent Routes ──────────────────────────────────────

describe("Mobile Marketplace API — Agents", () => {
  it("GET /agents returns seed agents", async () => {
    const { status, body } = await get("/agents");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(4);
    expect(body.total).toBeGreaterThanOrEqual(4);
  });

  it("GET /agents filters by capability", async () => {
    const { body } = await get("/agents?capability=macro_research");
    expect(body.success).toBe(true);
    for (const agent of body.data) {
      expect(agent.capabilities).toContain("macro_research");
    }
  });

  it("GET /agents paginates correctly", async () => {
    const { body } = await get("/agents?page=1&pageSize=2");
    expect(body.data.length).toBeLessThanOrEqual(2);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(2);
  });

  it("GET /agents/:id returns specific agent", async () => {
    const { status, body } = await get("/agents/agent-claude");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe("agent-claude");
    expect(body.data.model).toBe("claude-opus-4-6");
    expect(body.data.provider).toBe("anthropic");
  });

  it("GET /agents/:id returns 404 for missing agent", async () => {
    const { status, body } = await get("/agents/nonexistent");
    expect(status).toBe(404);
    expect(body.success).toBe(false);
  });

  it("POST /agents creates a new agent", async () => {
    const { status, body } = await post("/agents", {
      name: "Test Agent",
      model: "test-model",
      provider: "test",
      ownerWallet: "TestWallet123",
      capabilities: ["financial_analysis"],
      pricing: { model: "per_package", amount: 5.0 },
      description: "A test agent",
    });
    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.name).toBe("Test Agent");
    expect(body.data.id).toMatch(/^agent_/);
    expect(body.data.rating).toBe(0);
    expect(body.data.jobsCompleted).toBe(0);

    // Verify it's retrievable
    const { body: fetched } = await get(`/agents/${body.data.id}`);
    expect(fetched.data.name).toBe("Test Agent");
  });

  it("PATCH /agents/:id updates an agent", async () => {
    const { body: created } = await post("/agents", {
      name: "Updatable Agent",
      model: "old-model",
      provider: "test",
      ownerWallet: "W1",
      pricing: { model: "per_package", amount: 1.0 },
    });

    const { status, body } = await patch(`/agents/${created.data.id}`, {
      name: "Updated Agent",
      description: "Now updated",
    });
    expect(status).toBe(200);
    expect(body.data.name).toBe("Updated Agent");
    expect(body.data.description).toBe("Now updated");
  });

  it("DELETE /agents/:id removes an agent", async () => {
    const { body: created } = await post("/agents", {
      name: "Deletable",
      model: "m",
      provider: "p",
      ownerWallet: "W2",
      pricing: { model: "per_package", amount: 1.0 },
    });

    const { status } = await del(`/agents/${created.data.id}`);
    expect(status).toBe(200);

    const { status: getStatus } = await get(`/agents/${created.data.id}`);
    expect(getStatus).toBe(404);
  });
});

// ─── Job Routes ────────────────────────────────────────

describe("Mobile Marketplace API — Jobs", () => {
  it("POST /jobs creates a job", async () => {
    const { status, body } = await post("/jobs", {
      title: "Daily stock analysis",
      description: "Need NVDA analysis",
      buyerWallet: "BuyerWallet123",
      capability: "financial_analysis",
      pricingModel: "per_package",
      budgetUsdc: 5.0,
    });
    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.title).toBe("Daily stock analysis");
    expect(body.data.status).toBe("open");
    expect(body.data.budgetUsdc).toBe(5.0);
  });

  it("POST /jobs rejects invalid budget", async () => {
    const { status, body } = await post("/jobs", {
      title: "Bad job",
      buyerWallet: "W1",
      budgetUsdc: 0.1, // Below minimum
    });
    expect(status).toBe(400);
    expect(body.success).toBe(false);
  });

  it("POST /jobs rejects missing title", async () => {
    const { status } = await post("/jobs", {
      buyerWallet: "W1",
      budgetUsdc: 5.0,
    });
    expect(status).toBe(400);
  });

  it("GET /jobs lists jobs", async () => {
    // Create a job first
    await post("/jobs", {
      title: "List test job",
      buyerWallet: "ListW",
      budgetUsdc: 2.0,
    });

    const { body } = await get("/jobs");
    expect(body.success).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
  });

  it("GET /jobs filters by status", async () => {
    const { body } = await get("/jobs?status=open");
    for (const job of body.data) {
      expect(job.status).toBe("open");
    }
  });

  it("GET /jobs filters by buyerWallet", async () => {
    await post("/jobs", {
      title: "Buyer filter test",
      buyerWallet: "UniqueWallet999",
      budgetUsdc: 3.0,
    });

    const { body } = await get("/jobs?buyerWallet=UniqueWallet999");
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    for (const job of body.data) {
      expect(job.buyerWallet).toBe("UniqueWallet999");
    }
  });

  it("POST /jobs/:id/accept transitions to accepted", async () => {
    const { body: created } = await post("/jobs", {
      title: "Acceptable job",
      buyerWallet: "B1",
      budgetUsdc: 5.0,
    });

    const { status, body } = await post(
      `/jobs/${created.data.id}/accept`,
      { sellerAgentId: "agent-claude" }
    );
    expect(status).toBe(200);
    expect(body.data.status).toBe("accepted");
    expect(body.data.sellerAgentId).toBe("agent-claude");
    expect(body.data.acceptedAt).toBeDefined();
  });

  it("POST /jobs/:id/accept rejects non-open job", async () => {
    const { body: created } = await post("/jobs", {
      title: "Cancel me first",
      buyerWallet: "B2",
      budgetUsdc: 5.0,
    });

    // Cancel it
    await post(`/jobs/${created.data.id}/cancel`, {});

    // Try to accept cancelled job
    const { status, body } = await post(
      `/jobs/${created.data.id}/accept`,
      { sellerAgentId: "agent-claude" }
    );
    expect(status).toBe(400);
    expect(body.success).toBe(false);
  });

  it("POST /jobs/:id/cancel transitions to cancelled", async () => {
    const { body: created } = await post("/jobs", {
      title: "Cancel test",
      buyerWallet: "B3",
      budgetUsdc: 5.0,
    });

    const { body } = await post(`/jobs/${created.data.id}/cancel`, {});
    expect(body.data.status).toBe("cancelled");
  });
});

// ─── Deliverable Routes ────────────────────────────────

describe("Mobile Marketplace API — Deliverables", () => {
  it("submit + verify deliverable completes the full job lifecycle", async () => {
    // 1. Create job
    const { body: jobRes } = await post("/jobs", {
      title: "Full lifecycle test",
      buyerWallet: "LifecycleBuyer",
      budgetUsdc: 10.0,
      capability: "financial_analysis",
    });
    const jobId = jobRes.data.id;

    // 2. Accept job
    await post(`/jobs/${jobId}/accept`, {
      sellerAgentId: "agent-claude",
    });

    // 3. Submit deliverable
    const { status: submitStatus, body: submitRes } = await post(
      `/deliverables/${jobId}/submit`,
      {
        agentId: "agent-claude",
        content: {
          summary: "Test analysis",
          reasoning: [
            {
              step: 1,
              thought: "Analyzed market",
              evidence: "Price data",
              conclusion: "Bullish",
            },
          ],
          recommendations: [
            {
              ticker: "NVDA",
              action: "buy",
              reasoning: "Strong momentum",
              confidenceScore: 0.85,
              timeHorizon: "1 week",
            },
          ],
          confidence: 0.85,
          dataSourcesUsed: ["Jupiter API"],
          generatedAt: new Date().toISOString(),
        },
        tokensUsed: 5000,
      }
    );
    expect(submitStatus).toBe(201);
    expect(submitRes.data.agentId).toBe("agent-claude");
    expect(submitRes.data.tokensUsed).toBe(5000);

    // Verify job is now "delivered"
    const { body: deliveredJob } = await get(`/jobs/${jobId}`);
    expect(deliveredJob.data.status).toBe("delivered");

    // 4. Verify deliverable (accept)
    const { body: verifyRes } = await post(
      `/deliverables/${jobId}/verify`,
      { accepted: true }
    );
    expect(verifyRes.success).toBe(true);

    // Verify job is now "completed"
    const { body: completedJob } = await get(`/jobs/${jobId}`);
    expect(completedJob.data.status).toBe("completed");
    expect(completedJob.data.completedAt).toBeDefined();
  });

  it("dispute puts job in disputed state", async () => {
    const { body: jobRes } = await post("/jobs", {
      title: "Dispute test",
      buyerWallet: "DisputeBuyer",
      budgetUsdc: 5.0,
    });
    const jobId = jobRes.data.id;

    await post(`/jobs/${jobId}/accept`, {
      sellerAgentId: "agent-gpt",
    });

    await post(`/deliverables/${jobId}/submit`, {
      agentId: "agent-gpt",
      content: { summary: "Bad analysis" },
      tokensUsed: 100,
    });

    await post(`/deliverables/${jobId}/verify`, { accepted: false });

    const { body } = await get(`/jobs/${jobId}`);
    expect(body.data.status).toBe("disputed");
  });

  it("rejects deliverable on non-accepted job", async () => {
    const { body: jobRes } = await post("/jobs", {
      title: "No submit test",
      buyerWallet: "NoSub",
      budgetUsdc: 5.0,
    });

    // Try to submit without accepting first
    const { status } = await post(
      `/deliverables/${jobRes.data.id}/submit`,
      { agentId: "agent-claude", content: {}, tokensUsed: 0 }
    );
    expect(status).toBe(400);
  });
});

// ─── Escrow Routes ─────────────────────────────────────

describe("Mobile Marketplace API — Escrow", () => {
  it("POST /escrow creates an escrow", async () => {
    const { status, body } = await post("/escrow", {
      jobId: "test-job",
      buyerWallet: "buyer",
      sellerWallet: "seller",
      amountUsdc: 10.0,
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.escrowAddress).toBeDefined();
  });

  it("POST /escrow/:addr/release returns signature", async () => {
    const { body } = await post("/escrow/test-addr/release", {});
    expect(body.success).toBe(true);
    expect(body.data.signature).toContain("release_test-addr");
  });

  it("POST /escrow/:addr/refund returns signature", async () => {
    const { body } = await post("/escrow/test-addr/refund", {});
    expect(body.success).toBe(true);
    expect(body.data.signature).toContain("refund_test-addr");
  });
});

// ─── Auth Routes ───────────────────────────────────────

describe("Mobile Marketplace API — Auth", () => {
  it("POST /auth/wallet creates user and returns token", async () => {
    const { status, body } = await post("/auth/wallet", {
      walletAddress: "PhAnToMwAlLeT123456789abcdef",
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.user).toBeDefined();
    expect(body.user.authProvider).toBe("wallet");
    expect(body.user.walletAddress).toBe("PhAnToMwAlLeT123456789abcdef");
    expect(body.token).toBeDefined();
  });

  it("POST /auth/wallet returns same user for same wallet", async () => {
    const addr = "ConsistentWallet999";
    const { body: first } = await post("/auth/wallet", { walletAddress: addr });
    const { body: second } = await post("/auth/wallet", { walletAddress: addr });
    expect(first.user.id).toBe(second.user.id);
  });

  it("POST /auth/wallet rejects missing address", async () => {
    const { status } = await post("/auth/wallet", {});
    expect(status).toBe(400);
  });

  it("POST /auth/login handles Google auth", async () => {
    const { status, body } = await post("/auth/login", {
      provider: "google",
      providerToken: "google_access_token_12345",
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.user.authProvider).toBe("google");
    expect(body.token).toBeDefined();
  });

  it("POST /auth/login handles GitHub auth", async () => {
    const { body } = await post("/auth/login", {
      provider: "github",
      providerToken: "github_code_abcdef",
    });
    expect(body.success).toBe(true);
    expect(body.user.authProvider).toBe("github");
  });
});

// ─── Wallet Info ───────────────────────────────────────

describe("Mobile Marketplace API — Wallet Info", () => {
  it("GET /wallet/:address returns wallet summary", async () => {
    const { body } = await get("/wallet/SomeWalletAddr");
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty("balanceSol");
    expect(body.data).toHaveProperty("balanceUsdc");
    expect(body.data).toHaveProperty("totalEarned");
    expect(body.data).toHaveProperty("totalSpent");
    expect(body.data).toHaveProperty("activeJobs");
  });

  it("tracks totalSpent from completed jobs", async () => {
    const wallet = "SpentTracker123";

    // Create and complete a job
    const { body: jobRes } = await post("/jobs", {
      title: "Spend tracking test",
      buyerWallet: wallet,
      budgetUsdc: 7.5,
    });
    await post(`/jobs/${jobRes.data.id}/accept`, {
      sellerAgentId: "agent-claude",
    });
    await post(`/deliverables/${jobRes.data.id}/submit`, {
      agentId: "agent-claude",
      content: { summary: "done" },
      tokensUsed: 100,
    });
    await post(`/deliverables/${jobRes.data.id}/verify`, {
      accepted: true,
    });

    const { body } = await get(`/wallet/${wallet}`);
    expect(body.data.totalSpent).toBeGreaterThanOrEqual(7.5);
  });
});

// ─── Analysis Runs ─────────────────────────────────────

describe("Mobile Marketplace API — Analysis Runs", () => {
  it("POST /analysis/run creates and returns analysis", async () => {
    const { status, body } = await post("/analysis/run", {
      agentId: "agent-claude",
      tickers: ["NVDA", "AAPL"],
      capability: "financial_analysis",
      maxTokens: 8000,
    });
    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("completed");
    expect(body.data.agentId).toBe("agent-claude");
    expect(body.data.tokensUsed).toBeGreaterThan(0);
    expect(body.data.result).toBeDefined();
    expect(body.data.result.summary).toContain("NVDA");
    expect(body.data.result.reasoning.length).toBe(2);
    expect(body.data.result.recommendations.length).toBe(2);
  });

  it("POST /analysis/run rejects invalid agent", async () => {
    const { status, body } = await post("/analysis/run", {
      agentId: "nonexistent",
      tickers: ["AAPL"],
    });
    expect(status).toBe(404);
    expect(body.success).toBe(false);
  });

  it("GET /analysis/:id retrieves a run", async () => {
    const { body: created } = await post("/analysis/run", {
      agentId: "agent-gpt",
      tickers: ["TSLA"],
      capability: "stock_screening",
      maxTokens: 4000,
    });

    const { status, body } = await get(`/analysis/${created.data.id}`);
    expect(status).toBe(200);
    expect(body.data.agentId).toBe("agent-gpt");
  });

  it("GET /analysis lists runs filtered by agent", async () => {
    await post("/analysis/run", {
      agentId: "agent-gemini",
      tickers: ["MSFT"],
    });

    const { body } = await get("/analysis?agentId=agent-gemini");
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    for (const run of body.data) {
      expect(run.agentId).toBe("agent-gemini");
    }
  });
});

// ─── Shared Analyses ───────────────────────────────────

describe("Mobile Marketplace API — Shared Analyses", () => {
  let analysisId: string;

  it("shares an analysis from a run", async () => {
    // First create an analysis run
    const { body: runRes } = await post("/analysis/run", {
      agentId: "agent-claude",
      tickers: ["NVDA", "AMD"],
      capability: "financial_analysis",
    });
    analysisId = runRes.data.id;

    const { status, body } = await post("/shared", {
      analysisRunId: analysisId,
      title: "NVDA + AMD Deep Dive",
      description: "Comprehensive analysis of semiconductor leaders",
      previewSummary: "Both NVDA and AMD show interesting patterns...",
      priceUsdc: 2.5,
      visibility: "public",
      maxPurchases: 100,
    });
    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.title).toBe("NVDA + AMD Deep Dive");
    expect(body.data.priceUsdc).toBe(2.5);
    expect(body.data.purchaseCount).toBe(0);
    expect(body.data.tickers).toContain("NVDA");
    expect(body.data.tickers).toContain("AMD");
  });

  it("GET /shared lists public analyses", async () => {
    const { body } = await get("/shared");
    expect(body.success).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    for (const item of body.data) {
      expect(item.visibility).toBe("public");
    }
  });

  it("GET /shared filters by capability", async () => {
    const { body } = await get("/shared?capability=financial_analysis");
    for (const item of body.data) {
      expect(item.capability).toBe("financial_analysis");
    }
  });

  it("GET /shared/:id hides content for paid items", async () => {
    // Create a paid analysis
    const { body: runRes } = await post("/analysis/run", {
      agentId: "agent-grok",
      tickers: ["GOOGL"],
    });
    const { body: shareRes } = await post("/shared", {
      analysisRunId: runRes.data.id,
      title: "Premium Analysis",
      priceUsdc: 10.0,
      visibility: "public",
    });

    const { body } = await get(`/shared/${shareRes.data.id}`);
    expect(body.success).toBe(true);
    expect(body.data.content).toBeUndefined(); // Hidden until purchased
    expect(body.data.title).toBe("Premium Analysis");
  });

  it("POST /shared/:id/purchase increments count and returns content", async () => {
    const { body: runRes } = await post("/analysis/run", {
      agentId: "agent-claude",
      tickers: ["META"],
    });
    const { body: shareRes } = await post("/shared", {
      analysisRunId: runRes.data.id,
      title: "Purchasable",
      priceUsdc: 1.0,
      visibility: "public",
      maxPurchases: 5,
    });

    const { body } = await post(`/shared/${shareRes.data.id}/purchase`, {
      buyerWallet: "PurchaserWallet",
    });
    expect(body.success).toBe(true);
    expect(body.data.purchaseCount).toBe(1);
    expect(body.data.content).toBeDefined(); // Now visible
  });

  it("rejects purchase when sold out", async () => {
    const { body: runRes } = await post("/analysis/run", {
      agentId: "agent-claude",
      tickers: ["AAPL"],
    });
    const { body: shareRes } = await post("/shared", {
      analysisRunId: runRes.data.id,
      title: "Limited",
      priceUsdc: 1.0,
      visibility: "public",
      maxPurchases: 1,
    });

    // Buy the one available
    await post(`/shared/${shareRes.data.id}/purchase`, {
      buyerWallet: "Buyer1",
    });

    // Second purchase should fail
    const { status, body } = await post(
      `/shared/${shareRes.data.id}/purchase`,
      { buyerWallet: "Buyer2" }
    );
    expect(status).toBe(400);
    expect(body.error).toContain("Sold out");
  });

  it("free analyses show content directly", async () => {
    const { body: runRes } = await post("/analysis/run", {
      agentId: "agent-gemini",
      tickers: ["CRM"],
    });
    const { body: shareRes } = await post("/shared", {
      analysisRunId: runRes.data.id,
      title: "Free Analysis",
      priceUsdc: 0,
      visibility: "public",
    });

    const { body } = await get(`/shared/${shareRes.data.id}`);
    expect(body.data.content).toBeDefined(); // Free = visible
  });
});

// ─── Edge Cases & Validation ───────────────────────────

describe("Mobile Marketplace API — Edge Cases", () => {
  it("agent rating increases after completed job", async () => {
    const { body: before } = await get("/agents/agent-claude");
    const ratingBefore = before.data.rating;

    // Complete a job with agent-claude as seller
    const { body: jobRes } = await post("/jobs", {
      title: "Rating test",
      buyerWallet: "RatingTestBuyer",
      budgetUsdc: 5.0,
    });
    await post(`/jobs/${jobRes.data.id}/accept`, {
      sellerAgentId: "agent-claude",
    });
    await post(`/deliverables/${jobRes.data.id}/submit`, {
      agentId: "agent-claude",
      content: { summary: "done" },
      tokensUsed: 100,
    });
    await post(`/deliverables/${jobRes.data.id}/verify`, {
      accepted: true,
    });

    const { body: after } = await get("/agents/agent-claude");
    expect(after.data.rating).toBeGreaterThanOrEqual(ratingBefore);
    expect(after.data.jobsCompleted).toBeGreaterThan(before.data.jobsCompleted);
  });

  it("handles concurrent job operations gracefully", async () => {
    const { body: jobRes } = await post("/jobs", {
      title: "Concurrent test",
      buyerWallet: "ConcurrentBuyer",
      budgetUsdc: 5.0,
    });
    const jobId = jobRes.data.id;

    // Try to accept and cancel simultaneously
    const [acceptRes, cancelRes] = await Promise.all([
      post(`/jobs/${jobId}/accept`, { sellerAgentId: "agent-gpt" }),
      post(`/jobs/${jobId}/cancel`, {}),
    ]);

    // One should succeed, one should fail (race condition, but both are valid)
    const successes = [acceptRes.body.success, cancelRes.body.success];
    expect(successes).toContain(true);
  });

  it("agents sorted by rating descending", async () => {
    const { body } = await get("/agents");
    const ratings = body.data.map((a: any) => a.rating);
    for (let i = 1; i < ratings.length; i++) {
      expect(ratings[i]).toBeLessThanOrEqual(ratings[i - 1]);
    }
  });

  it("jobs sorted by newest first", async () => {
    const { body } = await get("/jobs");
    const dates = body.data.map((j: any) => new Date(j.createdAt).getTime());
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i]).toBeLessThanOrEqual(dates[i - 1]);
    }
  });
});

// ─── Dual-Format Packages ─────────────────────────────

describe("Mobile Marketplace API — Dual-Format Packages", () => {
  let sharedId: string;

  it("POST /shared generates both humanPackage and agentPackage", async () => {
    const { body: runRes } = await post("/analysis/run", {
      agentId: "agent-claude",
      tickers: ["NVDA", "TSLA"],
      capability: "financial_analysis",
    });

    const { body } = await post("/shared", {
      analysisRunId: runRes.data.id,
      title: "Dual-format test",
      priceUsdc: 3.0,
      agentPriceUsdc: 1.5,
      visibility: "public",
      maxPurchases: 10,
      agentDiscoverable: true,
    });

    sharedId = body.data.id;
    expect(body.success).toBe(true);
    expect(body.data.humanPackage).toBeDefined();
    expect(body.data.humanPackage.executiveSummary).toBeTruthy();
    expect(body.data.humanPackage.keyTakeaways.length).toBeGreaterThan(0);
    expect(body.data.humanPackage.riskWarnings.length).toBeGreaterThan(0);
    expect(body.data.humanPackage.readingTimeMinutes).toBeGreaterThanOrEqual(2);
    expect(body.data.agentPackage).toBeDefined();
    expect(body.data.agentPackage.structuredData).toBeDefined();
    expect(body.data.agentPackage.reasoningChain.length).toBeGreaterThan(0);
    expect(body.data.agentPackage.confidenceIntervals.length).toBe(2);
    expect(body.data.agentPackage.metadata.modelUsed).toBe("claude-opus-4-6");
    expect(body.data.agentDiscoverable).toBe(true);
    expect(body.data.agentPriceUsdc).toBe(1.5);
  });

  it("human purchase returns human package", async () => {
    const { body } = await post(`/shared/${sharedId}/purchase`, {
      buyerWallet: "HumanBuyer",
      buyerType: "human",
    });
    expect(body.success).toBe(true);
    expect(body.data.packageType).toBe("human");
    expect(body.data.package).toBeDefined();
    expect(body.data.package.executiveSummary).toBeTruthy();
  });

  it("agent purchase returns agent package", async () => {
    const { body } = await post(`/shared/${sharedId}/purchase`, {
      buyerWallet: "AgentBuyer",
      buyerType: "agent",
    });
    expect(body.success).toBe(true);
    expect(body.data.packageType).toBe("agent");
    expect(body.data.package).toBeDefined();
    expect(body.data.package.structuredData).toBeDefined();
    expect(body.data.package.reasoningChain).toBeDefined();
  });

  it("agent purchase uses agent price when set", async () => {
    const { body } = await post(`/shared/${sharedId}/purchase`, {
      buyerWallet: "PriceCheckAgent",
      buyerType: "agent",
    });
    expect(body.data.priceUsdc).toBe(1.5); // agentPriceUsdc
  });

  it("human purchase uses standard price", async () => {
    const { body } = await post(`/shared/${sharedId}/purchase`, {
      buyerWallet: "PriceCheckHuman",
      buyerType: "human",
    });
    expect(body.data.priceUsdc).toBe(3.0); // standard priceUsdc
  });

  it("default purchase is human type", async () => {
    const { body } = await post(`/shared/${sharedId}/purchase`, {
      buyerWallet: "DefaultBuyer",
    });
    // Default should be human
    expect(body.data.packageType).toBe("human");
  });
});

// ─── Agent Discovery Catalog ──────────────────────────

describe("Mobile Marketplace API — Agent Discovery Catalog", () => {
  it("GET /catalog lists agent-discoverable analyses", async () => {
    const { body } = await get("/catalog");
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);

    // Each catalog item should have agent-friendly fields
    for (const item of body.data) {
      expect(item.id).toBeDefined();
      expect(item.title).toBeDefined();
      expect(item.priceUsdc).toBeDefined();
      expect(item.purchaseEndpoint).toContain("/api/v1/mobile/shared/");
      expect(typeof item.available).toBe("boolean");
    }
  });

  it("GET /catalog filters by capability", async () => {
    const { body } = await get("/catalog?capability=financial_analysis");
    for (const item of body.data) {
      expect(item.capability).toBe("financial_analysis");
    }
  });

  it("GET /catalog filters by maxPrice", async () => {
    const { body } = await get("/catalog?maxPrice=2.0");
    for (const item of body.data) {
      expect(item.priceUsdc).toBeLessThanOrEqual(2.0);
    }
  });

  it("catalog shows agent-specific pricing", async () => {
    // Create an analysis with agent discount
    const { body: runRes } = await post("/analysis/run", {
      agentId: "agent-gpt",
      tickers: ["AMZN"],
    });
    await post("/shared", {
      analysisRunId: runRes.data.id,
      title: "Agent-priced catalog item",
      priceUsdc: 5.0,
      agentPriceUsdc: 2.0,
      visibility: "public",
      agentDiscoverable: true,
    });

    const { body } = await get("/catalog");
    const item = body.data.find((d: any) => d.title === "Agent-priced catalog item");
    expect(item).toBeDefined();
    expect(item.priceUsdc).toBe(2.0); // Should show agent price
    expect(item.humanPriceUsdc).toBe(5.0);
  });
});

// ─── Quests ───────────────────────────────────────────

describe("Mobile Marketplace API — Quests", () => {
  it("GET /quests returns seed quests", async () => {
    const { body } = await get("/quests");
    expect(body.success).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(10);
  });

  it("quests have required fields", async () => {
    const { body } = await get("/quests");
    for (const quest of body.data) {
      expect(quest.id).toBeDefined();
      expect(quest.title).toBeTruthy();
      expect(quest.description).toBeTruthy();
      expect(quest.category).toBeDefined();
      expect(quest.pointsReward).toBeGreaterThan(0);
      expect(quest.requirement).toBeDefined();
      expect(quest.requirement.type).toBeDefined();
      expect(quest.requirement.count).toBeGreaterThanOrEqual(1);
      expect(quest.status).toBeDefined();
    }
  });

  it("quests include all categories", async () => {
    const { body } = await get("/quests");
    const categories = new Set(body.data.map((q: any) => q.category));
    expect(categories.has("onboarding")).toBe(true);
    expect(categories.has("marketplace")).toBe(true);
    expect(categories.has("social")).toBe(true);
    expect(categories.has("streak")).toBe(true);
  });

  it("quests are sorted by sortOrder", async () => {
    const { body } = await get("/quests");
    const orders = body.data.map((q: any) => q.sortOrder);
    for (let i = 1; i < orders.length; i++) {
      expect(orders[i]).toBeGreaterThanOrEqual(orders[i - 1]);
    }
  });

  it("POST /quests/:id/claim rejects uncompleted quest", async () => {
    const { status, body } = await post("/quests/quest-connect-wallet/claim", {});
    expect(status).toBe(400);
    expect(body.error).toContain("not completed");
  });

  it("POST /quests/:id/claim rejects unknown quest", async () => {
    const { status } = await post("/quests/nonexistent/claim", {});
    expect(status).toBe(404);
  });
});

// ─── Points & Leaderboard ─────────────────────────────

describe("Mobile Marketplace API — Points & Leaderboard", () => {
  it("GET /points returns user points", async () => {
    const { body } = await get("/points");
    expect(body.success).toBe(true);
    expect(typeof body.data.totalPoints).toBe("number");
  });

  it("GET /leaderboard returns ranked entries", async () => {
    const { body } = await get("/leaderboard");
    expect(body.success).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(10); // seed data

    // Check ranks are sequential
    for (let i = 0; i < body.data.length; i++) {
      expect(body.data[i].rank).toBe(i + 1);
    }
  });

  it("leaderboard entries have required fields", async () => {
    const { body } = await get("/leaderboard");
    for (const entry of body.data) {
      expect(entry.rank).toBeGreaterThanOrEqual(1);
      expect(entry.displayName).toBeTruthy();
      expect(typeof entry.points).toBe("number");
      expect(typeof entry.agentCount).toBe("number");
      expect(typeof entry.salesCount).toBe("number");
    }
  });

  it("leaderboard sorted by points descending", async () => {
    const { body } = await get("/leaderboard");
    const points = body.data.map((e: any) => e.points);
    for (let i = 1; i < points.length; i++) {
      expect(points[i]).toBeLessThanOrEqual(points[i - 1]);
    }
  });
});

// ─── Referrals ────────────────────────────────────────

describe("Mobile Marketplace API — Referrals", () => {
  it("GET /referrals returns referral list", async () => {
    const { body } = await get("/referrals");
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("POST /referrals/apply rejects missing code", async () => {
    const { status } = await post("/referrals/apply", {});
    expect(status).toBe(400);
  });

  it("POST /referrals/apply rejects invalid code", async () => {
    const { status } = await post("/referrals/apply", { code: "INVALID_CODE" });
    expect(status).toBe(404);
  });
});

// ─── Solana Blinks ────────────────────────────────────

describe("Mobile Marketplace API — Blinks", () => {
  it("GET /blinks returns available blinks", async () => {
    const { body } = await get("/blinks");
    expect(body.success).toBe(true);
    expect(body.data.length).toBe(3);

    const types = body.data.map((b: any) => b.type);
    expect(types).toContain("buy_analysis");
    expect(types).toContain("view_agent");
    expect(types).toContain("browse_marketplace");
  });

  it("blinks have required Solana Action fields", async () => {
    const { body } = await get("/blinks");
    for (const blink of body.data) {
      expect(blink.label).toBeTruthy();
      expect(blink.description).toBeTruthy();
      expect(blink.icon).toContain("http");
      expect(blink.actionUrl).toContain("solana-action:");
    }
  });

  it("GET /blinks/buy returns action spec", async () => {
    const { body } = await get("/blinks/buy?analysisId=fake");
    expect(body.label).toBeDefined();
    expect(body.description).toBeDefined();
    expect(body.icon).toBeDefined();
    expect(body.links).toBeDefined();
    expect(body.links.actions.length).toBeGreaterThan(0);
  });

  it("GET /blinks/agent returns agent action spec", async () => {
    const { body } = await get("/blinks/agent?agentId=agent-claude");
    expect(body.label).toContain("Claude");
    expect(body.description).toBeDefined();
    expect(body.links.actions.length).toBeGreaterThan(0);
  });

  it("GET /blinks/marketplace returns marketplace action spec", async () => {
    const { body } = await get("/blinks/marketplace");
    expect(body.label).toContain("MoltApp");
    expect(body.description).toContain("AI-to-AI");
    expect(body.links.actions.length).toBeGreaterThan(0);
  });
});

// ─── Social Proof Blink Teasers ───────────────────────

describe("Mobile Marketplace API — Blink Teasers", () => {
  let teaserSharedId: string;

  it("creates a shared analysis for teaser testing", async () => {
    const { body: runRes } = await post("/analysis/run", {
      agentId: "agent-claude",
      tickers: ["SOL", "USDC"],
      capability: "financial_analysis",
    });
    const { body } = await post("/shared", {
      analysisRunId: runRes.data.id,
      title: "SOL/USDC Alpha",
      previewSummary: "Strong buy signal for SOL",
      priceUsdc: 5.0,
      visibility: "public",
    });
    teaserSharedId = body.data.id;
    expect(teaserSharedId).toBeDefined();
  });

  it("GET /blinks/teaser/:id returns social proof data", async () => {
    const { body } = await get(`/blinks/teaser/${teaserSharedId}`);
    expect(body.title).toContain("Claude");
    expect(body.label).toContain("$5");
    expect(body.description).toBeTruthy();
    expect(body.metadata).toBeDefined();
    expect(body.metadata.purchaseCount).toBe(0);
    expect(body.metadata.agentName).toBe("Claude Analyst");
    expect(body.metadata.tickers).toContain("SOL");
    expect(body.links.actions.length).toBeGreaterThan(0);
  });

  it("teaser updates after purchases", async () => {
    await post(`/shared/${teaserSharedId}/purchase`, { buyerWallet: "T1" });
    await post(`/shared/${teaserSharedId}/purchase`, { buyerWallet: "T2" });

    const { body } = await get(`/blinks/teaser/${teaserSharedId}`);
    expect(body.metadata.purchaseCount).toBe(2);
    expect(body.label).toContain("2 buyers");
  });

  it("teaser handles unknown analysis gracefully", async () => {
    const { body } = await get("/blinks/teaser/nonexistent");
    expect(body.label).toBe("MoltApp Analysis");
  });
});

// ─── Dynamic Pricing ──────────────────────────────────

describe("Mobile Marketplace API — Dynamic Pricing", () => {
  it("price increases with demand (bonding curve)", async () => {
    const { body: runRes } = await post("/analysis/run", {
      agentId: "agent-gpt",
      tickers: ["AAPL"],
    });
    const { body: shareRes } = await post("/shared", {
      analysisRunId: runRes.data.id,
      title: "Demand test",
      priceUsdc: 10.0,
      visibility: "public",
      maxPurchases: 0,
    });
    const sharedId = shareRes.data.id;

    // First purchase — base price
    const { body: p1 } = await post(`/shared/${sharedId}/purchase`, { buyerWallet: "D1" });
    const price1 = p1.data.priceUsdc;
    expect(price1).toBe(10.0); // 0 previous, multiplier 1.0

    // Buy 9 more to get to 10 purchases
    for (let i = 2; i <= 10; i++) {
      await post(`/shared/${sharedId}/purchase`, { buyerWallet: `D${i}` });
    }

    // 11th purchase — should be 2% more
    const { body: p11 } = await post(`/shared/${sharedId}/purchase`, { buyerWallet: "D11" });
    expect(p11.data.priceUsdc).toBe(10.2); // 10 * 1.02
  });
});

// ─── Agent-to-Agent Referrals ─────────────────────────

describe("Mobile Marketplace API — Agent Referrals", () => {
  it("agent purchase with referrer earns kickback", async () => {
    const { body: runRes } = await post("/analysis/run", {
      agentId: "agent-grok",
      tickers: ["BTC"],
    });
    const { body: shareRes } = await post("/shared", {
      analysisRunId: runRes.data.id,
      title: "Kickback test",
      priceUsdc: 10.0,
      agentPriceUsdc: 5.0,
      visibility: "public",
    });

    const { body } = await post(`/shared/${shareRes.data.id}/purchase`, {
      buyerWallet: "BuyerAgent",
      buyerType: "agent",
      referrerAgentId: "agent-claude",
    });

    expect(body.success).toBe(true);
    expect(body.data.referralKickback).toBeDefined();
    expect(body.data.referralKickback.referrerAgentId).toBe("agent-claude");
    expect(body.data.referralKickback.kickbackUsdc).toBeGreaterThan(0);
  });

  it("GET /agent-referrals lists referral earnings", async () => {
    const { body } = await get("/agent-referrals?agentId=agent-claude");
    expect(body.success).toBe(true);
    expect(body.data.referralCount).toBeGreaterThan(0);
    expect(body.data.totalKickbackUsdc).toBeGreaterThan(0);
    expect(body.data.referrals.length).toBeGreaterThan(0);
  });

  it("no kickback for invalid referrer agent", async () => {
    const { body: runRes } = await post("/analysis/run", {
      agentId: "agent-gpt",
      tickers: ["ETH"],
    });
    const { body: shareRes } = await post("/shared", {
      analysisRunId: runRes.data.id,
      title: "No kickback test",
      priceUsdc: 5.0,
      visibility: "public",
    });

    const { body } = await post(`/shared/${shareRes.data.id}/purchase`, {
      buyerWallet: "BuyerAgent2",
      buyerType: "agent",
      referrerAgentId: "nonexistent-agent",
    });

    expect(body.success).toBe(true);
    expect(body.data.referralKickback).toBeUndefined();
  });
});

// ─── Anti-Sybil & Rate Limiting ───────────────────────

describe("Mobile Marketplace API — Anti-Sybil", () => {
  it("rejects self-referral", async () => {
    // Create a user first
    await post("/auth/wallet", { walletAddress: "SybilWallet123" });

    const { status, body } = await post("/referrals/apply", {
      code: "SybilWallet123",
      walletAddress: "SybilWallet123",
    });
    expect(status).toBe(400);
    expect(body.error).toContain("Cannot refer yourself");
  });

  it("rejects duplicate referral from same wallet", async () => {
    await post("/auth/wallet", { walletAddress: "ReferrerWallet999" });

    // First apply works
    const { body: first } = await post("/referrals/apply", {
      code: "ReferrerWallet999",
      walletAddress: "NewUser999",
    });
    expect(first.success).toBe(true);

    // Second apply fails
    const { status, body: second } = await post("/referrals/apply", {
      code: "ReferrerWallet999",
      walletAddress: "NewUser999",
    });
    expect(status).toBe(400);
    expect(second.error).toContain("already applied");
  });
});

// ─── Streak Shields ───────────────────────────────────

describe("Mobile Marketplace API — Streak Shields", () => {
  it("GET /streak-shield returns shield status", async () => {
    const { body } = await get("/streak-shield?userId=demo-user");
    expect(body.success).toBe(true);
    expect(typeof body.data.shieldsOwned).toBe("number");
    expect(typeof body.data.isProtected).toBe("boolean");
    expect(body.data.costPoints).toBeGreaterThan(0);
  });

  it("POST /streak-shield/buy rejects when not enough points", async () => {
    const { status, body } = await post("/streak-shield/buy", {
      userId: "broke-user",
    });
    expect(status).toBe(400);
    expect(body.error).toContain("points");
  });

  it("POST /streak-shield/activate rejects when no shields", async () => {
    const { status, body } = await post("/streak-shield/activate", {
      userId: "no-shield-user",
    });
    expect(status).toBe(400);
    expect(body.error).toContain("No streak shields");
  });
});

// ─── Notifications ────────────────────────────────────

describe("Mobile Marketplace API — Notifications", () => {
  it("GET /notifications returns empty list initially", async () => {
    const { body } = await get("/notifications?userId=fresh-user");
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
    expect(body.unreadCount).toBe(0);
  });

  it("POST /notifications/test creates a notification", async () => {
    const { body: createRes } = await post("/notifications/test", {
      userId: "notif-user",
      type: "analysis_published",
      title: "New Analysis",
      body: "Claude Analyst published a new SOL analysis",
    });
    expect(createRes.success).toBe(true);

    const { body } = await get("/notifications?userId=notif-user");
    expect(body.data.length).toBe(1);
    expect(body.data[0].title).toBe("New Analysis");
    expect(body.data[0].read).toBe(false);
    expect(body.unreadCount).toBe(1);
  });

  it("POST /notifications/:id/read marks as read", async () => {
    const { body: listRes } = await get("/notifications?userId=notif-user");
    const notifId = listRes.data[0].id;

    await post(`/notifications/${notifId}/read`, {});

    const { body } = await get("/notifications?userId=notif-user");
    expect(body.data[0].read).toBe(true);
    expect(body.unreadCount).toBe(0);
  });

  it("unreadOnly filter works", async () => {
    await post("/notifications/test", {
      userId: "filter-user",
      title: "Read me",
    });
    await post("/notifications/test", {
      userId: "filter-user",
      title: "Unread me",
    });

    // Mark first as read
    const { body: all } = await get("/notifications?userId=filter-user");
    await post(`/notifications/${all.data[0].id}/read`, {});

    const { body } = await get("/notifications?userId=filter-user&unreadOnly=true");
    expect(body.data.length).toBe(1);
  });
});

// ─── Seeker Deep Links & Manifest ─────────────────────

describe("Mobile Marketplace API — Seeker & Deep Links", () => {
  it("GET /manifest.json returns valid dApp manifest", async () => {
    const { body } = await get("/manifest.json");
    expect(body.name).toBe("MoltApp");
    expect(body.schema_version).toBe("v0.1");
    expect(body.website).toContain("patgpt.us");
    expect(body.app.android_package).toBe("us.patgpt.moltapp");
    expect(body.platforms).toContain("android");
    expect(body.category).toBe("defi");
    expect(body.media.length).toBeGreaterThan(0);
    expect(body.solana_mobile_dapp_publisher_portal).toBeDefined();
  });

  it("GET /deeplink generates deep link for home", async () => {
    const { body } = await get("/deeplink?action=home");
    expect(body.success).toBe(true);
    expect(body.data.deepLink).toBe("moltapp://");
    expect(body.data.universalLink).toContain("patgpt.us");
    expect(body.data.smsIntent).toContain("solana-mobile://");
    expect(body.data.isSeekerOptimized).toBe(true);
  });

  it("GET /deeplink generates deep link for referral", async () => {
    const { body } = await get("/deeplink?action=referral&ref=ABC123");
    expect(body.data.deepLink).toBe("moltapp://welcome?ref=ABC123");
    expect(body.data.universalLink).toContain("ref=ABC123");
    expect(body.data.smsIntent).toContain("solana-mobile://");
  });

  it("GET /deeplink generates deep link for analysis", async () => {
    const { body } = await get("/deeplink?action=buy&id=shared_123");
    expect(body.data.deepLink).toBe("moltapp://analysis/shared_123");
  });

  it("GET /deeplink generates deep link for agent", async () => {
    const { body } = await get("/deeplink?action=agent&id=agent-claude");
    expect(body.data.deepLink).toBe("moltapp://agent/agent-claude");
  });
});

// ─── Dynamic Quests ───────────────────────────────────

describe("Mobile Marketplace API — Dynamic Quests", () => {
  it("POST /quests/generate creates daily quest", async () => {
    const { body } = await post("/quests/generate", { type: "daily" });
    expect(body.success).toBe(true);
    expect(body.data.length).toBe(1);
    expect(body.data[0].title).toBe("Daily Login");
    expect(body.data[0].expiresAt).toBeDefined();
    expect(body.data[0].category).toBe("streak");
  });

  it("POST /quests/generate creates weekly competition quest", async () => {
    const { body } = await post("/quests/generate", { type: "weekly_competition" });
    expect(body.success).toBe(true);
    expect(body.data[0].title).toContain("Human vs. AI");
    expect(body.data[0].pointsReward).toBe(2000);
    expect(body.data[0].usdcReward).toBe(1.0);
  });

  it("POST /quests/generate creates flash quest", async () => {
    const { body } = await post("/quests/generate", { type: "flash" });
    expect(body.success).toBe(true);
    expect(body.data[0].title).toContain("Flash");
    const expiresAt = new Date(body.data[0].expiresAt).getTime();
    const now = Date.now();
    // Should expire within ~1 hour
    expect(expiresAt - now).toBeLessThan(3700_000);
  });

  it("dynamic quests appear in quest list", async () => {
    const { body } = await get("/quests");
    const dynamicQuests = body.data.filter((q: any) => q.sortOrder >= 100);
    expect(dynamicQuests.length).toBeGreaterThan(0);
  });
});
