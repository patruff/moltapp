/**
 * Integration tests for the Benchmark Submission API
 *
 * Tests all endpoints:
 * - POST /apply — Apply for full benchmark inclusion
 * - GET /apply/status/:agentId — Check qualification progress
 * - GET /apply/agents — List all participating agents
 * - POST /retire-model — Retire old model version
 * - POST /submit — Submit a trade for scoring
 * - GET /results/:id — Get submission results
 * - GET /leaderboard — External agent leaderboard
 * - GET /rules — Submission rules
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock heavy dependencies before importing routes
vi.mock("../services/coherence-analyzer.ts", () => ({
  analyzeCoherence: vi.fn(() => ({ score: 0.75, details: {} })),
  detectHallucinations: vi.fn(() => ({ severity: 0.1, flags: [] })),
  runFullAnalysis: vi.fn(() => ({})),
}));

vi.mock("../services/deep-coherence-analyzer.ts", () => ({
  analyzeDeepCoherence: vi.fn(() => ({
    overallScore: 0.72,
    grade: "B+",
    dimensions: {},
  })),
  recordDeepAnalysis: vi.fn(),
}));

vi.mock("../middleware/reasoning-gate.ts", () => ({
  validateTradeReasoning: vi.fn(() => ({
    valid: true,
    score: 0.85,
    feedback: [],
  })),
}));

vi.mock("../agents/orchestrator.ts", () => ({
  getMarketData: vi.fn(async () => []),
}));

vi.mock("../schemas/trade-reasoning.ts", () => ({
  normalizeConfidence: vi.fn((c: number) => c),
  classifyIntent: vi.fn(() => "momentum"),
  extractSourcesFromReasoning: vi.fn(() => []),
}));

vi.mock("../lib/math-utils.ts", () => ({
  round2: (n: number) => Math.round(n * 100) / 100,
}));

vi.mock("../config/constants.ts", () => ({
  XSTOCKS_CATALOG: [
    { symbol: "AAPLx", name: "Apple", mintAddress: "abc123" },
    { symbol: "NVDAx", name: "NVIDIA", mintAddress: "def456" },
    { symbol: "TSLAx", name: "Tesla", mintAddress: "ghi789" },
  ],
}));

import { benchmarkSubmissionRoutes } from "./benchmark-submission.ts";

// Helper to make requests to the routes
function req(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers: {} };
  if (body) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] =
      "application/json";
  }
  return benchmarkSubmissionRoutes.request(path, init);
}

// Valid application payload
const validApplication = {
  agentId: "gemini-trader-v1",
  agentName: "Gemini 2.5 Pro Trader",
  modelProvider: "google",
  modelName: "gemini-2.5-pro",
  walletAddress: "7xKmQFcMHxYKadT7AZMH2qYmooiWBbGSfnFKe1m1234",
  contactEmail: "team@example.com",
  description: "AI trading agent powered by Gemini 2.5 Pro",
  modelVersion: "2.5",
  systemPrompt:
    "You are a stock trading analyst. Analyze market data and make buy/sell/hold decisions with confidence levels.",
  tools: ["market_data_api", "gemini_2.5_pro", "jupiter_swap"],
};

// Valid submission payload
const validSubmission = {
  agentId: "gemini-trader-v1",
  agentName: "Gemini 2.5 Pro Trader",
  modelProvider: "google",
  modelName: "gemini-2.5-pro",
  action: "buy" as const,
  symbol: "NVDAx",
  quantity: 500,
  reasoning:
    "NVDA shows strong momentum with AI chip demand increasing. The stock is trading at $176 with a positive 24h change of 2.3%. Technical indicators show RSI at 65, not yet overbought.",
  confidence: 0.75,
  sources: ["market_price_feed", "24h_price_change", "technical_indicators"],
  intent: "momentum" as const,
  predictedOutcome: "Expect 3-5% appreciation over the next week",
  walletAddress: "7xKmQFcMHxYKadT7AZMH2qYmooiWBbGSfnFKe1m1234",
  txSignature: "5abc123def456",
  modelVersion: "2.5",
  systemPrompt: "You are a stock trading analyst...",
  tools: ["market_data_api", "gemini_2.5_pro"],
};

// =========================================================================
// POST /apply — Apply for full benchmark inclusion
// =========================================================================

describe("POST /apply", () => {
  it("should accept a valid application", async () => {
    const res = await req("POST", "/apply", validApplication);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.applicationId).toMatch(/^app_/);
    expect(json.status).toBe("pending_qualification");
    expect(json.qualificationCriteria).toEqual({
      minDays: 14,
      minSubmissions: 20,
      minAvgComposite: 0.5,
      requireOnChainTrades: true,
    });
    expect(json.message).toContain("Start trading");
  });

  it("should reject duplicate applications (409)", async () => {
    // First apply
    await req("POST", "/apply", {
      ...validApplication,
      agentId: "duplicate-test-agent",
    });

    // Second apply with same agentId
    const res = await req("POST", "/apply", {
      ...validApplication,
      agentId: "duplicate-test-agent",
    });
    expect(res.status).toBe(409);

    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toBe("ALREADY_APPLIED");
  });

  it("should reject invalid JSON", async () => {
    const res = await benchmarkSubmissionRoutes.request("/apply", {
      method: "POST",
      body: "not json",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBe("INVALID_JSON");
  });

  it("should validate required fields", async () => {
    const res = await req("POST", "/apply", {
      agentId: "ab", // too short (min 3)
      agentName: "",
      modelProvider: "",
      modelName: "",
      walletAddress: "short", // too short (min 32)
    });
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBe("VALIDATION_FAILED");
  });

  it("should accept application without optional fields", async () => {
    const res = await req("POST", "/apply", {
      agentId: "minimal-agent",
      agentName: "Minimal Agent",
      modelProvider: "custom",
      modelName: "my-model-v1",
      walletAddress: "7xKmQFcMHxYKadT7AZMH2qYmooiWBbGSfnFKe1mXXXX",
    });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.ok).toBe(true);
  });
});

// =========================================================================
// GET /apply/status/:agentId — Check qualification progress
// =========================================================================

describe("GET /apply/status/:agentId", () => {
  it("should return 404 for unknown agent", async () => {
    const res = await req("GET", "/apply/status/nonexistent-agent");
    expect(res.status).toBe(404);

    const json = await res.json();
    expect(json.error).toBe("NOT_FOUND");
  });

  it("should return progress for applied agent", async () => {
    // Apply first
    await req("POST", "/apply", {
      ...validApplication,
      agentId: "status-test-agent",
    });

    const res = await req("GET", "/apply/status/status-test-agent");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.application.agentId).toBe("status-test-agent");
    expect(json.application.status).toBe("pending_qualification");
    expect(json.progress).toBeDefined();
    expect(json.progress.totalSubmissions).toBe(0);
    expect(json.progress.requiredSubmissions).toBe(20);
    expect(json.progress.meetsSubmissionCount).toBe(false);
    expect(json.qualified).toBe(false);
  });
});

// =========================================================================
// GET /apply/agents — List all participating agents
// =========================================================================

describe("GET /apply/agents", () => {
  it("should list all applied agents with open-box info", async () => {
    // Apply an agent with full open-box data
    await req("POST", "/apply", {
      ...validApplication,
      agentId: "agents-list-test",
    });

    const res = await req("GET", "/apply/agents");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.agents.length).toBeGreaterThan(0);
    expect(json.message).toContain("Open-box");

    // Find our test agent
    const agent = json.agents.find(
      (a: { agentId: string }) => a.agentId === "agents-list-test"
    );
    expect(agent).toBeDefined();
    expect(agent.modelProvider).toBe("google");
    expect(agent.modelName).toBe("gemini-2.5-pro");
    expect(agent.systemPrompt).toBeTruthy();
    expect(agent.tools).toEqual([
      "market_data_api",
      "gemini_2.5_pro",
      "jupiter_swap",
    ]);
  });
});

// =========================================================================
// POST /submit — Submit a trade for scoring
// =========================================================================

describe("POST /submit", () => {
  it("should score a valid submission", async () => {
    const res = await req("POST", "/submit", validSubmission);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.submissionId).toMatch(/^ext_/);
    expect(json.scores).toBeDefined();
    expect(json.scores.composite).toBeGreaterThanOrEqual(0);
    expect(json.scores.composite).toBeLessThanOrEqual(1);
    expect(json.scores.coherence).toBeDefined();
    expect(json.scores.hallucinationFree).toBeDefined();
    expect(json.scores.deepCoherence).toBeDefined();
    expect(json.scores.discipline).toBeDefined();
    expect(json.feedback).toBeDefined();
    expect(json.resultsUrl).toContain("/api/v1/benchmark-submit/results/");
  });

  it("should accept optional open-box fields", async () => {
    const res = await req("POST", "/submit", {
      ...validSubmission,
      agentId: "openbox-test-agent",
      systemPrompt: "You are a trading analyst with access to real-time data.",
      tools: ["web_search", "price_api", "chart_analysis"],
    });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it("should accept optional wallet fields", async () => {
    const res = await req("POST", "/submit", {
      ...validSubmission,
      agentId: "wallet-test-agent",
      walletAddress: "8yLn123abc456def",
      txSignature: "txsig_abc123def456",
    });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it("should reject invalid JSON", async () => {
    const res = await benchmarkSubmissionRoutes.request("/submit", {
      method: "POST",
      body: "invalid json{",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBe("INVALID_JSON");
  });

  it("should validate required fields", async () => {
    const res = await req("POST", "/submit", {
      agentId: "ab", // too short
      action: "invalid_action",
    });
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBe("VALIDATION_FAILED");
  });
});

// =========================================================================
// GET /results/:id — Get submission results
// =========================================================================

describe("GET /results/:id", () => {
  it("should return 404 for unknown submission", async () => {
    const res = await req("GET", "/results/nonexistent-id");
    expect(res.status).toBe(404);

    const json = await res.json();
    expect(json.error).toBe("NOT_FOUND");
  });

  it("should return results for submitted trade", async () => {
    // Submit first
    const submitRes = await req("POST", "/submit", {
      ...validSubmission,
      agentId: "results-test-agent",
    });
    const submitJson = await submitRes.json();
    const submissionId = submitJson.submissionId;

    // Fetch results
    const res = await req("GET", `/results/${submissionId}`);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.submission.id).toBe(submissionId);
    expect(json.submission.externalAgentId).toBe("results-test-agent");
    expect(json.submission.scores).toBeDefined();
    expect(json.feedback).toBeDefined();
  });
});

// =========================================================================
// POST /retire-model — Retire old model version
// =========================================================================

describe("POST /retire-model", () => {
  it("should reject when agent has no submissions", async () => {
    const res = await req("POST", "/retire-model", {
      agentId: "no-submissions-agent",
      oldModelVersion: "1.0",
      newModelVersion: "2.0",
      reorganizePortfolio: true,
    });
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBe("NO_SUBMISSIONS");
  });

  it("should retire model after submissions exist", async () => {
    // Submit some trades first
    await req("POST", "/submit", {
      ...validSubmission,
      agentId: "retire-test-agent",
      modelVersion: "1.0",
    });
    await req("POST", "/submit", {
      ...validSubmission,
      agentId: "retire-test-agent",
      modelVersion: "1.0",
      symbol: "AAPLx",
    });

    // Retire the model
    const res = await req("POST", "/retire-model", {
      agentId: "retire-test-agent",
      oldModelVersion: "1.0",
      newModelVersion: "2.0",
      newModelName: "gemini-3.0-pro",
      reorganizePortfolio: true,
    });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.retirement.agentId).toBe("retire-test-agent");
    expect(json.retirement.oldModelVersion).toBe("1.0");
    expect(json.retirement.newModelVersion).toBe("2.0");
    expect(json.retirement.archivedSubmissions).toBe(2);
    expect(json.message).toContain("retired");
  });

  it("should reset application status after retirement", async () => {
    // Apply first
    await req("POST", "/apply", {
      ...validApplication,
      agentId: "retire-status-test",
    });

    // Submit a trade
    await req("POST", "/submit", {
      ...validSubmission,
      agentId: "retire-status-test",
    });

    // Retire model
    await req("POST", "/retire-model", {
      agentId: "retire-status-test",
      oldModelVersion: "2.5",
      newModelVersion: "3.0",
      reorganizePortfolio: false,
    });

    // Check application status is reset
    const res = await req("GET", "/apply/status/retire-status-test");
    const json = await res.json();
    expect(json.application.status).toBe("pending_qualification");
    expect(json.progress.totalSubmissions).toBe(0);
  });

  it("should validate required fields", async () => {
    const res = await req("POST", "/retire-model", {
      agentId: "ab", // too short
    });
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBe("VALIDATION_FAILED");
  });
});

// =========================================================================
// GET /leaderboard — External agent leaderboard
// =========================================================================

describe("GET /leaderboard", () => {
  it("should return leaderboard with submissions", async () => {
    // Submit trades from multiple agents
    await req("POST", "/submit", {
      ...validSubmission,
      agentId: "leaderboard-agent-1",
      agentName: "Agent Alpha",
    });
    await req("POST", "/submit", {
      ...validSubmission,
      agentId: "leaderboard-agent-2",
      agentName: "Agent Beta",
    });

    const res = await req("GET", "/leaderboard");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.leaderboard.length).toBeGreaterThanOrEqual(2);
    expect(json.totalExternalAgents).toBeGreaterThanOrEqual(2);

    // Check leaderboard entry structure
    const entry = json.leaderboard[0];
    expect(entry.rank).toBe(1);
    expect(entry.agentId).toBeDefined();
    expect(entry.avgComposite).toBeDefined();
    expect(entry.totalSubmissions).toBeGreaterThan(0);
  });
});

// =========================================================================
// GET /rules — Submission rules
// =========================================================================

describe("GET /rules", () => {
  it("should return all rules and requirements", async () => {
    const res = await req("GET", "/rules");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.rules).toBeDefined();
    expect(json.rules.required_fields).toBeDefined();
    expect(json.rules.optional_fields).toBeDefined();
    expect(json.rules.scoring).toBeDefined();
  });

  it("should list available symbols from XSTOCKS_CATALOG", async () => {
    const res = await req("GET", "/rules");
    const json = await res.json();

    expect(json.availableSymbols).toEqual(["AAPLx", "NVDAx", "TSLAx"]);
    expect(json.totalSymbols).toBe(3);
  });

  it("should include qualification criteria", async () => {
    const res = await req("GET", "/rules");
    const json = await res.json();

    expect(json.qualificationCriteria).toEqual({
      minDays: 14,
      minSubmissions: 20,
      minAvgComposite: 0.5,
      requireOnChainTrades: true,
    });
  });

  it("should include open-box transparency fields", async () => {
    const res = await req("GET", "/rules");
    const json = await res.json();

    expect(json.openBox).toBeDefined();
    expect(json.openBox.fields.systemPrompt).toBeDefined();
    expect(json.openBox.fields.tools).toBeDefined();
    expect(json.openBox.fields.modelVersion).toBeDefined();
  });

  it("should include optional fields for wallet and open-box", async () => {
    const res = await req("GET", "/rules");
    const json = await res.json();

    expect(json.rules.optional_fields.walletAddress).toBeDefined();
    expect(json.rules.optional_fields.txSignature).toBeDefined();
    expect(json.rules.optional_fields.systemPrompt).toBeDefined();
    expect(json.rules.optional_fields.tools).toBeDefined();
  });

  it("should include example submission with new fields", async () => {
    const res = await req("GET", "/rules");
    const json = await res.json();

    expect(json.exampleSubmission).toBeDefined();
    expect(json.exampleSubmission.systemPrompt).toBeDefined();
    expect(json.exampleSubmission.tools).toBeDefined();
    expect(json.exampleSubmission.walletAddress).toBeDefined();
  });
});

// =========================================================================
// Full workflow: Apply → Submit → Check Status → Leaderboard
// =========================================================================

describe("Full agent onboarding workflow", () => {
  it("should handle complete lifecycle", async () => {
    const agentId = "full-workflow-agent";

    // Step 1: Apply
    const applyRes = await req("POST", "/apply", {
      ...validApplication,
      agentId,
    });
    expect(applyRes.status).toBe(200);
    const applyJson = await applyRes.json();
    expect(applyJson.ok).toBe(true);

    // Step 2: Check initial status (no submissions yet)
    const status1Res = await req("GET", `/apply/status/${agentId}`);
    const status1Json = await status1Res.json();
    expect(status1Json.progress.totalSubmissions).toBe(0);
    expect(status1Json.qualified).toBe(false);

    // Step 3: Submit a trade
    const submitRes = await req("POST", "/submit", {
      ...validSubmission,
      agentId,
    });
    expect(submitRes.status).toBe(200);
    const submitJson = await submitRes.json();
    expect(submitJson.scores.composite).toBeGreaterThan(0);

    // Step 4: Check status after submission (should show 1 submission)
    const status2Res = await req("GET", `/apply/status/${agentId}`);
    const status2Json = await status2Res.json();
    expect(status2Json.progress.totalSubmissions).toBe(1);
    // Still not qualified (needs 20 submissions, 14 days, on-chain trades)
    expect(status2Json.qualified).toBe(false);

    // Step 5: Agent appears on leaderboard
    const lbRes = await req("GET", "/leaderboard");
    const lbJson = await lbRes.json();
    const entry = lbJson.leaderboard.find(
      (e: { agentId: string }) => e.agentId === agentId
    );
    expect(entry).toBeDefined();
    expect(entry.totalSubmissions).toBe(1);

    // Step 6: Agent visible in agents list
    const agentsRes = await req("GET", "/apply/agents");
    const agentsJson = await agentsRes.json();
    const agent = agentsJson.agents.find(
      (a: { agentId: string }) => a.agentId === agentId
    );
    expect(agent).toBeDefined();
    expect(agent.status).toBe("pending_qualification");
  });
});
