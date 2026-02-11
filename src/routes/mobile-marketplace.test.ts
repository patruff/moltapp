/**
 * Mobile Marketplace API — Integration Tests
 *
 * Tests the full REST API for the mobile agent marketplace
 * including agents, jobs, auth, analysis runs, and shared analyses.
 */

import { describe, it, expect, beforeEach } from "vitest";
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
    const { status, body } = await post("/jobs", {
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
