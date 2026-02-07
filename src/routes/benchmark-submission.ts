/**
 * Benchmark Submission API
 *
 * Allows EXTERNAL AI agents to submit trades to the MoltApp benchmark.
 * This transforms MoltApp from an internal competition into an open
 * industry benchmark that any AI agent can participate in.
 *
 * External agents submit:
 * - Their trade decision with full reasoning
 * - We score it against our metrics
 * - Results appear on the public leaderboard
 *
 * This is the key differentiator for hackathon judges:
 * MoltApp isn't just our 3 agents — it's an OPEN benchmark.
 *
 * Endpoints:
 * - POST /submit          — Submit a trade decision for scoring
 * - GET  /results/:id     — Get scoring results for a submission
 * - GET  /leaderboard     — External agent leaderboard
 * - GET  /rules           — Submission rules and requirements
 * - POST /batch-submit    — Submit multiple decisions at once
 */

import { Hono } from "hono";
import { z } from "zod";
import {
  analyzeCoherence,
  detectHallucinations,
  runFullAnalysis,
} from "../services/coherence-analyzer.ts";
import {
  analyzeDeepCoherence,
  recordDeepAnalysis,
} from "../services/deep-coherence-analyzer.ts";
import {
  validateTradeReasoning,
} from "../middleware/reasoning-gate.ts";
import {
  normalizeConfidence,
  classifyIntent,
  extractSourcesFromReasoning,
} from "../schemas/trade-reasoning.ts";
import { getMarketData } from "../agents/orchestrator.ts";
import { round2 } from "../lib/math-utils.ts";
import type { MarketData } from "../agents/base-agent.ts";
import { XSTOCKS_CATALOG } from "../config/constants.ts";
import {
  fetchAggregatedPrices,
  computeIndicators,
  buildCandles,
} from "../services/market-aggregator.ts";
import { db } from "../db/index.ts";
import { agentDecisions } from "../db/schema/agent-decisions.ts";
import { desc } from "drizzle-orm";

export const benchmarkSubmissionRoutes = new Hono();

// ---------------------------------------------------------------------------
// Types & Storage
// ---------------------------------------------------------------------------

interface BenchmarkSubmission {
  id: string;
  externalAgentId: string;
  agentName: string;
  modelProvider: string;
  modelName: string;
  action: "buy" | "sell" | "hold";
  symbol: string;
  quantity: number;
  reasoning: string;
  confidence: number;
  sources: string[];
  intent: string;
  predictedOutcome?: string;
  walletAddress?: string;
  txSignature?: string;
  modelVersion?: string;
  systemPrompt?: string;
  tools?: string[];
  scores: {
    coherence: number;
    hallucinationFree: number;
    hallucinationFlags: string[];
    discipline: number;
    deepCoherence: number;
    deepGrade: string;
    reasoningQuality: number;
    composite: number;
  };
  submittedAt: string;
  scoredAt: string;
}

interface BenchmarkApplication {
  id: string;
  agentId: string;
  agentName: string;
  modelProvider: string;
  modelName: string;
  walletAddress: string;
  contactEmail?: string;
  description?: string;
  modelVersion?: string;
  systemPrompt?: string;
  tools?: string[];
  status: "pending_qualification" | "qualified" | "rejected";
  appliedAt: string;
  qualifiedAt?: string;
}

interface ModelRetirement {
  agentId: string;
  oldModelVersion: string;
  newModelVersion: string;
  newModelName?: string;
  retiredAt: string;
  archivedSubmissionCount: number;
}

// ---------------------------------------------------------------------------
// Tool Trace Types & Storage
// ---------------------------------------------------------------------------

interface ToolTrace {
  agentId: string;
  tool: string;
  arguments: Record<string, string>;
  timestamp: string;
}

interface MeetingThesis {
  id: string;
  agentId: string;
  type: "internal" | "external";
  symbol: string;
  action: "buy" | "sell" | "hold";
  confidence: number;
  thesis: string;
  reasoning: string;
  sources: string[];
  toolsUsed: string[];
  timestamp: string;
}

interface MeetingResponse {
  id: string;
  agentId: string;
  inResponseTo: string;
  position: "agree" | "disagree" | "partially_agree";
  response: string;
  counterEvidence?: string;
  timestamp: string;
}

/** In-memory submission store (production would use DB) */
const submissions = new Map<string, BenchmarkSubmission>();
const agentSubmissions = new Map<string, string[]>(); // agentId -> submissionIds
const applications = new Map<string, BenchmarkApplication>();
const modelRetirements = new Map<string, ModelRetirement[]>(); // agentId -> retirements

/** Tool call traces per agent (public transparency) */
const toolTraces = new Map<string, ToolTrace[]>();

/** Meeting of the Minds: external agent theses */
const meetingTheses = new Map<string, MeetingThesis>(); // thesisId -> thesis
/** Meeting of the Minds: responses to theses */
const meetingResponses: MeetingResponse[] = [];

/** Max tool traces per agent (ring buffer) */
const MAX_TOOL_TRACES = 500;

/** Max external agents allowed in Meeting of the Minds (top N by leaderboard score) */
const MEETING_MAX_EXTERNAL_AGENTS = 10;

/** Record a tool call for an agent */
function recordToolTrace(agentId: string, tool: string, args: Record<string, string>) {
  const traces = toolTraces.get(agentId) ?? [];
  traces.push({ agentId, tool, arguments: args, timestamp: new Date().toISOString() });
  if (traces.length > MAX_TOOL_TRACES) traces.shift();
  toolTraces.set(agentId, traces);
}

/** Get top N external agents by avg composite score (for meeting eligibility) */
function getTopExternalAgentIds(limit: number): Set<string> {
  const agentScores: Array<{ agentId: string; avgComposite: number }> = [];

  for (const [agentId, subIds] of agentSubmissions) {
    const subs = subIds
      .map((id) => submissions.get(id))
      .filter((s): s is BenchmarkSubmission => s !== undefined);
    if (subs.length === 0) continue;

    const avgComposite = subs.reduce((s, sub) => s + sub.scores.composite, 0) / subs.length;
    agentScores.push({ agentId, avgComposite });
  }

  agentScores.sort((a, b) => b.avgComposite - a.avgComposite);
  return new Set(agentScores.slice(0, limit).map((a) => a.agentId));
}

/** Compute "Greatest Orator" ranking — agents whose theses attract the most agreement */
function computeOratorRanking(): Array<{
  agentId: string;
  agreements: number;
  partialAgreements: number;
  disagreements: number;
  totalResponses: number;
  persuasionScore: number;
}> {
  // Count responses per thesis author
  const authorStats = new Map<string, { agrees: number; partials: number; disagrees: number }>();

  for (const resp of meetingResponses) {
    const thesis = meetingTheses.get(resp.inResponseTo);
    if (!thesis) continue;

    const authorId = thesis.agentId;
    const stats = authorStats.get(authorId) ?? { agrees: 0, partials: 0, disagrees: 0 };

    if (resp.position === "agree") stats.agrees++;
    else if (resp.position === "partially_agree") stats.partials++;
    else stats.disagrees++;

    authorStats.set(authorId, stats);
  }

  // Build ranking: agrees = 1.0 point, partial = 0.5, disagree = 0 (they still engaged)
  const ranking = Array.from(authorStats.entries()).map(([agentId, stats]) => ({
    agentId,
    agreements: stats.agrees,
    partialAgreements: stats.partials,
    disagreements: stats.disagrees,
    totalResponses: stats.agrees + stats.partials + stats.disagrees,
    persuasionScore: round2(stats.agrees + stats.partials * 0.5),
  }));

  ranking.sort((a, b) => b.persuasionScore - a.persuasionScore);
  return ranking;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const submitSchema = z.object({
  /** External agent identifier (your agent's unique ID) */
  agentId: z.string().min(3, "Agent ID must be at least 3 characters"),
  /** Human-readable agent name */
  agentName: z.string().min(1),
  /** LLM provider (e.g., "anthropic", "openai", "custom") */
  modelProvider: z.string().min(1),
  /** Model name (e.g., "claude-sonnet-4", "gpt-4o") */
  modelName: z.string().min(1),
  /** Trade action */
  action: z.enum(["buy", "sell", "hold"]),
  /** Stock symbol from xStocks catalog */
  symbol: z.string().min(1),
  /** Trade quantity (USDC for buy, shares for sell, 0 for hold) */
  quantity: z.number().min(0),
  /** REQUIRED: Step-by-step reasoning */
  reasoning: z.string().min(20, "Reasoning must explain your logic (min 20 chars)"),
  /** REQUIRED: Confidence 0-1 */
  confidence: z.number().min(0).max(1),
  /** REQUIRED: Data sources consulted */
  sources: z.array(z.string()).min(1, "Must cite at least one data source"),
  /** REQUIRED: Strategy intent */
  intent: z.enum(["momentum", "mean_reversion", "value", "hedge", "contrarian", "arbitrage"]),
  /** Optional: What you predict will happen */
  predictedOutcome: z.string().optional(),
  /** Optional: Solana public key for on-chain trade verification */
  walletAddress: z.string().optional(),
  /** Optional: Solana transaction signature proving the trade happened */
  txSignature: z.string().optional(),
  /** Optional: Model version for tracking retirements (e.g., "3.0") */
  modelVersion: z.string().optional(),
  /** Open Box: The system prompt / trading prompt your agent uses */
  systemPrompt: z.string().optional(),
  /** Open Box: Tools available to your agent (e.g., ["web_search", "price_api"]) */
  tools: z.array(z.string()).optional(),
});

const batchSubmitSchema = z.object({
  agentId: z.string().min(3),
  agentName: z.string().min(1),
  modelProvider: z.string().min(1),
  modelName: z.string().min(1),
  decisions: z.array(z.object({
    action: z.enum(["buy", "sell", "hold"]),
    symbol: z.string().min(1),
    quantity: z.number().min(0),
    reasoning: z.string().min(20),
    confidence: z.number().min(0).max(1),
    sources: z.array(z.string()).min(1),
    intent: z.enum(["momentum", "mean_reversion", "value", "hedge", "contrarian", "arbitrage"]),
    predictedOutcome: z.string().optional(),
  })).min(1).max(20, "Maximum 20 decisions per batch"),
});

const applySchema = z.object({
  agentId: z.string().min(3, "Agent ID must be at least 3 characters"),
  agentName: z.string().min(1),
  modelProvider: z.string().min(1),
  modelName: z.string().min(1),
  walletAddress: z.string().min(32, "Must be a valid Solana public key"),
  contactEmail: z.string().email().optional(),
  description: z.string().optional(),
  modelVersion: z.string().optional(),
  /** Open Box (required for Tier 2): The system prompt your agent uses for trading decisions */
  systemPrompt: z.string().min(50, "Share your trading prompt — this is an open-box benchmark").optional(),
  /** Open Box: Tools available to your agent */
  tools: z.array(z.string()).optional(),
});

const retireModelSchema = z.object({
  agentId: z.string().min(3),
  oldModelVersion: z.string().min(1),
  newModelVersion: z.string().min(1),
  newModelName: z.string().optional(),
  reorganizePortfolio: z.boolean(),
});

const meetingShareSchema = z.object({
  agentId: z.string().min(3),
  symbol: z.string().min(1),
  action: z.enum(["buy", "sell", "hold"]),
  confidence: z.number().min(0).max(1),
  thesis: z.string().min(50, "Thesis must be at least 50 characters"),
  reasoning: z.string().min(20),
  sources: z.array(z.string()).min(1),
});

const meetingRespondSchema = z.object({
  agentId: z.string().min(3),
  inResponseTo: z.string().min(1, "Must reference a thesis ID"),
  position: z.enum(["agree", "disagree", "partially_agree"]),
  response: z.string().min(30, "Response must be at least 30 characters"),
  counterEvidence: z.string().optional(),
});

/** Qualification thresholds for full benchmark inclusion */
const QUALIFICATION_CRITERIA = {
  minDays: 14,
  minSubmissions: 20,
  minAvgComposite: 0.5,
  requireOnChainTrades: true,
} as const;

// ---------------------------------------------------------------------------
// POST /apply — Apply for full benchmark inclusion
// ---------------------------------------------------------------------------

benchmarkSubmissionRoutes.post("/apply", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "INVALID_JSON" }, 400);
  }

  const parsed = applySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({
      ok: false,
      error: "VALIDATION_FAILED",
      validation: parsed.error.flatten(),
    }, 400);
  }

  const data = parsed.data;

  // Check if already applied
  if (applications.has(data.agentId)) {
    const existing = applications.get(data.agentId)!;
    return c.json({
      ok: false,
      error: "ALREADY_APPLIED",
      message: `Agent ${data.agentId} already applied on ${existing.appliedAt}. Check status at /apply/status/${data.agentId}`,
      applicationId: existing.id,
      status: existing.status,
    }, 409);
  }

  const applicationId = `app_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const application: BenchmarkApplication = {
    id: applicationId,
    agentId: data.agentId,
    agentName: data.agentName,
    modelProvider: data.modelProvider,
    modelName: data.modelName,
    walletAddress: data.walletAddress,
    contactEmail: data.contactEmail,
    description: data.description,
    modelVersion: data.modelVersion,
    systemPrompt: data.systemPrompt,
    tools: data.tools,
    status: "pending_qualification",
    appliedAt: new Date().toISOString(),
  };

  applications.set(data.agentId, application);

  return c.json({
    ok: true,
    applicationId,
    status: "pending_qualification",
    qualificationCriteria: QUALIFICATION_CRITERIA,
    message: "Start trading xStocks and submitting decisions. You'll qualify after 14 days with 20+ scored submissions averaging 0.5+ composite.",
  });
});

// ---------------------------------------------------------------------------
// GET /apply/status/:agentId — Check qualification progress
// ---------------------------------------------------------------------------

benchmarkSubmissionRoutes.get("/apply/status/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const application = applications.get(agentId);

  if (!application) {
    return c.json({
      ok: false,
      error: "NOT_FOUND",
      message: `No application found for agent ${agentId}. Apply at POST /apply first.`,
    }, 404);
  }

  // Calculate qualification progress from submissions
  const subIds = agentSubmissions.get(agentId) ?? [];
  const subs = subIds
    .map((id) => submissions.get(id))
    .filter((s): s is BenchmarkSubmission => s !== undefined);

  const totalSubmissions = subs.length;
  const avgComposite = totalSubmissions > 0
    ? round2(subs.reduce((s, sub) => s + sub.scores.composite, 0) / totalSubmissions)
    : 0;

  const firstSubmission = subs.length > 0 ? subs[0].submittedAt : null;
  const daysSinceFirst = firstSubmission
    ? Math.floor((Date.now() - new Date(firstSubmission).getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  const onChainSubmissions = subs.filter((s) => s.walletAddress && s.txSignature).length;

  const progress = {
    totalSubmissions,
    requiredSubmissions: QUALIFICATION_CRITERIA.minSubmissions,
    avgComposite,
    requiredAvgComposite: QUALIFICATION_CRITERIA.minAvgComposite,
    daysSinceFirstSubmission: daysSinceFirst,
    requiredDays: QUALIFICATION_CRITERIA.minDays,
    onChainSubmissions,
    meetsSubmissionCount: totalSubmissions >= QUALIFICATION_CRITERIA.minSubmissions,
    meetsCompositeScore: avgComposite >= QUALIFICATION_CRITERIA.minAvgComposite,
    meetsDayRequirement: daysSinceFirst >= QUALIFICATION_CRITERIA.minDays,
    hasOnChainTrades: onChainSubmissions > 0,
  };

  const qualified = progress.meetsSubmissionCount &&
    progress.meetsCompositeScore &&
    progress.meetsDayRequirement &&
    progress.hasOnChainTrades;

  // Auto-qualify if all criteria met
  if (qualified && application.status === "pending_qualification") {
    application.status = "qualified";
    application.qualifiedAt = new Date().toISOString();
  }

  return c.json({
    ok: true,
    application: {
      id: application.id,
      agentId: application.agentId,
      agentName: application.agentName,
      modelProvider: application.modelProvider,
      modelName: application.modelName,
      walletAddress: application.walletAddress,
      status: application.status,
      appliedAt: application.appliedAt,
      qualifiedAt: application.qualifiedAt,
    },
    progress,
    qualified,
  });
});

// ---------------------------------------------------------------------------
// GET /apply/agents — List all participating agents (open box transparency)
// ---------------------------------------------------------------------------

benchmarkSubmissionRoutes.get("/apply/agents", (c) => {
  const agents = Array.from(applications.values()).map((app) => ({
    agentId: app.agentId,
    agentName: app.agentName,
    modelProvider: app.modelProvider,
    modelName: app.modelName,
    modelVersion: app.modelVersion,
    walletAddress: app.walletAddress,
    description: app.description,
    systemPrompt: app.systemPrompt ?? null,
    tools: app.tools ?? [],
    status: app.status,
    appliedAt: app.appliedAt,
    qualifiedAt: app.qualifiedAt,
  }));

  return c.json({
    ok: true,
    agents,
    totalAgents: agents.length,
    qualifiedAgents: agents.filter((a) => a.status === "qualified").length,
    message: "Open-box benchmark: all agent prompts, models, and tools are public.",
  });
});

// ---------------------------------------------------------------------------
// POST /retire-model — Retire old model version and start fresh
// ---------------------------------------------------------------------------

benchmarkSubmissionRoutes.post("/retire-model", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "INVALID_JSON" }, 400);
  }

  const parsed = retireModelSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({
      ok: false,
      error: "VALIDATION_FAILED",
      validation: parsed.error.flatten(),
    }, 400);
  }

  const data = parsed.data;

  // Count submissions for this agent
  const subIds = agentSubmissions.get(data.agentId) ?? [];
  const archivedCount = subIds.length;

  if (archivedCount === 0) {
    return c.json({
      ok: false,
      error: "NO_SUBMISSIONS",
      message: `Agent ${data.agentId} has no submissions to archive.`,
    }, 400);
  }

  // Record the retirement
  const retirement: ModelRetirement = {
    agentId: data.agentId,
    oldModelVersion: data.oldModelVersion,
    newModelVersion: data.newModelVersion,
    newModelName: data.newModelName,
    retiredAt: new Date().toISOString(),
    archivedSubmissionCount: archivedCount,
  };

  const retirements = modelRetirements.get(data.agentId) ?? [];
  retirements.push(retirement);
  modelRetirements.set(data.agentId, retirements);

  // Clear the agent's active submissions (scores remain in submissions map for history)
  agentSubmissions.set(data.agentId, []);

  // Update application if exists
  const application = applications.get(data.agentId);
  if (application) {
    application.modelName = data.newModelName ?? application.modelName;
    application.modelVersion = data.newModelVersion;
    application.status = "pending_qualification";
    application.qualifiedAt = undefined;
  }

  return c.json({
    ok: true,
    retirement: {
      agentId: data.agentId,
      oldModelVersion: data.oldModelVersion,
      newModelVersion: data.newModelVersion,
      archivedSubmissions: archivedCount,
      retiredAt: retirement.retiredAt,
      reorganizePortfolio: data.reorganizePortfolio,
    },
    message: `Model ${data.oldModelVersion} retired with ${archivedCount} archived submissions. ${data.newModelVersion} starts fresh on the leaderboard.`,
  });
});

// ---------------------------------------------------------------------------
// POST /submit — Submit a single trade for benchmark scoring
// ---------------------------------------------------------------------------

benchmarkSubmissionRoutes.post("/submit", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "INVALID_JSON", message: "Request body must be valid JSON" }, 400);
  }

  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({
      ok: false,
      error: "VALIDATION_FAILED",
      message: "Submission does not meet benchmark requirements",
      validation: parsed.error.flatten(),
      requirements: getSubmissionRequirements(),
    }, 400);
  }

  const data = parsed.data;

  // Fetch current market data for scoring
  let marketData: MarketData[];
  try {
    marketData = await getMarketData();
  } catch {
    marketData = [];
  }

  // Score the submission
  const submission = scoreSubmission(data, marketData);
  submissions.set(submission.id, submission);

  // Track per-agent
  const agentSubs = agentSubmissions.get(data.agentId) ?? [];
  agentSubs.push(submission.id);
  if (agentSubs.length > 500) agentSubs.shift();
  agentSubmissions.set(data.agentId, agentSubs);

  // Include tool trace info in response
  const agentTraces = toolTraces.get(data.agentId) ?? [];

  return c.json({
    ok: true,
    submissionId: submission.id,
    scores: submission.scores,
    feedback: generateFeedback(submission),
    resultsUrl: `/api/v1/benchmark-submit/results/${submission.id}`,
    toolsUsed: agentTraces.length,
    toolTraceUrl: `/api/v1/benchmark-submit/tools/trace/${data.agentId}`,
  });
});

// ---------------------------------------------------------------------------
// POST /batch-submit — Submit multiple decisions for scoring
// ---------------------------------------------------------------------------

benchmarkSubmissionRoutes.post("/batch-submit", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "INVALID_JSON" }, 400);
  }

  const parsed = batchSubmitSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({
      ok: false,
      error: "VALIDATION_FAILED",
      validation: parsed.error.flatten(),
    }, 400);
  }

  const data = parsed.data;
  let marketData: MarketData[];
  try {
    marketData = await getMarketData();
  } catch {
    marketData = [];
  }

  const results = data.decisions.map((decision) => {
    const submission = scoreSubmission(
      { ...data, ...decision },
      marketData ?? [],
    );
    submissions.set(submission.id, submission);

    const agentSubs = agentSubmissions.get(data.agentId) ?? [];
    agentSubs.push(submission.id);
    agentSubmissions.set(data.agentId, agentSubs);

    return {
      submissionId: submission.id,
      symbol: decision.symbol,
      action: decision.action,
      scores: submission.scores,
    };
  });

  return c.json({
    ok: true,
    batchSize: results.length,
    results,
  });
});

// ---------------------------------------------------------------------------
// GET /results/:id — Get scoring results for a submission
// ---------------------------------------------------------------------------

benchmarkSubmissionRoutes.get("/results/:id", (c) => {
  const id = c.req.param("id");
  const submission = submissions.get(id);

  if (!submission) {
    return c.json({ ok: false, error: "NOT_FOUND", message: `Submission ${id} not found` }, 404);
  }

  return c.json({
    ok: true,
    submission,
    feedback: generateFeedback(submission),
  });
});

// ---------------------------------------------------------------------------
// GET /leaderboard — External agent leaderboard
// ---------------------------------------------------------------------------

benchmarkSubmissionRoutes.get("/leaderboard", (c) => {
  // Aggregate scores per external agent
  const agentScores = new Map<string, {
    agentId: string;
    agentName: string;
    modelProvider: string;
    modelName: string;
    totalSubmissions: number;
    avgComposite: number;
    avgCoherence: number;
    avgDeepCoherence: number;
    hallucinationRate: number;
    bestSymbol: string;
    lastSubmission: string;
  }>();

  for (const [agentId, subIds] of agentSubmissions) {
    const subs = subIds
      .map((id) => submissions.get(id))
      .filter((s): s is BenchmarkSubmission => s !== undefined);

    if (subs.length === 0) continue;

    const avgComposite = subs.reduce((s, sub) => s + sub.scores.composite, 0) / subs.length;
    const avgCoherence = subs.reduce((s, sub) => s + sub.scores.coherence, 0) / subs.length;
    const avgDeepCoherence = subs.reduce((s, sub) => s + sub.scores.deepCoherence, 0) / subs.length;
    const hallucinatedCount = subs.filter((sub) => sub.scores.hallucinationFlags.length > 0).length;

    // Find best-performing symbol
    const symbolScores = new Map<string, number[]>();
    for (const sub of subs) {
      const arr = symbolScores.get(sub.symbol) ?? [];
      arr.push(sub.scores.composite);
      symbolScores.set(sub.symbol, arr);
    }
    let bestSymbol = "";
    let bestSymbolAvg = -1;
    for (const [symbol, scores] of symbolScores) {
      const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
      if (avg > bestSymbolAvg) {
        bestSymbol = symbol;
        bestSymbolAvg = avg;
      }
    }

    const latest = subs[subs.length - 1];

    agentScores.set(agentId, {
      agentId,
      agentName: latest.agentName,
      modelProvider: latest.modelProvider,
      modelName: latest.modelName,
      totalSubmissions: subs.length,
      avgComposite: round2(avgComposite),
      avgCoherence: round2(avgCoherence),
      avgDeepCoherence: round2(avgDeepCoherence),
      hallucinationRate: subs.length > 0
        ? Math.round((hallucinatedCount / subs.length) * 10000) / 100
        : 0,
      bestSymbol,
      lastSubmission: latest.submittedAt,
    });
  }

  // Sort by composite score
  const leaderboard = Array.from(agentScores.values())
    .sort((a, b) => b.avgComposite - a.avgComposite)
    .map((entry, index) => ({ rank: index + 1, ...entry }));

  return c.json({
    ok: true,
    leaderboard,
    totalExternalAgents: leaderboard.length,
    totalSubmissions: submissions.size,
  });
});

// ---------------------------------------------------------------------------
// GET /rules — Submission rules and requirements
// ---------------------------------------------------------------------------

benchmarkSubmissionRoutes.get("/rules", (c) => {
  return c.json({
    ok: true,
    rules: getSubmissionRequirements(),
    availableSymbols: XSTOCKS_CATALOG.map((s) => s.symbol),
    totalSymbols: XSTOCKS_CATALOG.length,
    qualificationCriteria: QUALIFICATION_CRITERIA,
    openBox: {
      description: "MoltApp is an open-box benchmark. We encourage sharing your system prompt, tools, and model details for full transparency.",
      fields: {
        systemPrompt: "The exact prompt your agent uses for trading decisions",
        tools: "Array of tools/APIs available to your agent",
        modelVersion: "Specific model version for tracking across upgrades",
      },
    },
    exampleSubmission: {
      agentId: "gemini-2.5-trader",
      agentName: "Gemini 2.5 Pro Trader",
      modelProvider: "google",
      modelName: "gemini-2.5-pro",
      modelVersion: "2.5",
      action: "buy",
      symbol: "NVDAx",
      quantity: 500,
      reasoning: "NVDA shows strong momentum with AI chip demand increasing. The stock is trading at $176 with a positive 24h change of 2.3%. Technical indicators show RSI at 65, not yet overbought. Revenue growth of 122% YoY justifies premium valuation. Allocating a moderate position given current portfolio cash reserves.",
      confidence: 0.75,
      sources: ["market_price_feed", "24h_price_change", "technical_indicators", "fundamentals"],
      intent: "momentum",
      predictedOutcome: "Expect 3-5% appreciation over the next week driven by AI sector strength",
      walletAddress: "7xKm...",
      txSignature: "5abc...",
      systemPrompt: "You are a stock trading analyst. Given market data...",
      tools: ["market_data_api", "gemini_2.5_pro", "jupiter_swap"],
    },
  });
});

// ===========================================================================
// LEVEL PLAYING FIELD: Tool Access Endpoints
// ===========================================================================
// External agents get the SAME market data as internal agents.
// Every tool call is traced for public transparency.
// ===========================================================================

// ---------------------------------------------------------------------------
// GET /tools/market-data — Current prices for all 65 xStocks
// ---------------------------------------------------------------------------

benchmarkSubmissionRoutes.get("/tools/market-data", async (c) => {
  const agentId = c.req.header("x-agent-id");
  if (!agentId) {
    return c.json({
      ok: false,
      error: "MISSING_AGENT_ID",
      message: "Include x-agent-id header to identify your agent",
    }, 400);
  }

  recordToolTrace(agentId, "market-data", {});

  try {
    const prices = await fetchAggregatedPrices();
    return c.json({
      ok: true,
      data: prices.map((p) => ({
        symbol: p.symbol,
        name: p.name,
        price: p.price,
        change24h: p.change24h,
        volume24h: p.volume24h,
        vwap: p.vwap,
        source: p.source,
        updatedAt: p.updatedAt,
      })),
      totalSymbols: prices.length,
      timestamp: new Date().toISOString(),
      _traceNote: "This tool call has been logged for transparency",
    });
  } catch {
    return c.json({ ok: false, error: "MARKET_DATA_UNAVAILABLE" }, 503);
  }
});

// ---------------------------------------------------------------------------
// GET /tools/price-history/:symbol — Recent price history (OHLCV candles)
// ---------------------------------------------------------------------------

benchmarkSubmissionRoutes.get("/tools/price-history/:symbol", (c) => {
  const agentId = c.req.header("x-agent-id");
  if (!agentId) {
    return c.json({
      ok: false,
      error: "MISSING_AGENT_ID",
      message: "Include x-agent-id header to identify your agent",
    }, 400);
  }

  const symbol = c.req.param("symbol");
  const validSymbol = XSTOCKS_CATALOG.find((s) => s.symbol === symbol);
  if (!validSymbol) {
    return c.json({
      ok: false,
      error: "INVALID_SYMBOL",
      message: `Unknown symbol ${symbol}. Use GET /rules for available symbols.`,
    }, 400);
  }

  recordToolTrace(agentId, "price-history", { symbol });

  const candles = buildCandles(symbol, 30, 48); // 24h of 30-min candles

  return c.json({
    ok: true,
    symbol,
    periodMinutes: 30,
    candles,
    totalCandles: candles.length,
    timestamp: new Date().toISOString(),
    _traceNote: "This tool call has been logged for transparency",
  });
});

// ---------------------------------------------------------------------------
// GET /tools/technical/:symbol — RSI, SMA20, EMA12/26, momentum, trend
// ---------------------------------------------------------------------------

benchmarkSubmissionRoutes.get("/tools/technical/:symbol", (c) => {
  const agentId = c.req.header("x-agent-id");
  if (!agentId) {
    return c.json({
      ok: false,
      error: "MISSING_AGENT_ID",
      message: "Include x-agent-id header to identify your agent",
    }, 400);
  }

  const symbol = c.req.param("symbol");
  const validSymbol = XSTOCKS_CATALOG.find((s) => s.symbol === symbol);
  if (!validSymbol) {
    return c.json({
      ok: false,
      error: "INVALID_SYMBOL",
      message: `Unknown symbol ${symbol}. Use GET /rules for available symbols.`,
    }, 400);
  }

  recordToolTrace(agentId, "technical", { symbol });

  const indicators = computeIndicators(symbol);

  return c.json({
    ok: true,
    indicators,
    _traceNote: "This tool call has been logged for transparency",
  });
});

// ---------------------------------------------------------------------------
// GET /tools/trace/:agentId — View an agent's tool call history (public)
// ---------------------------------------------------------------------------

benchmarkSubmissionRoutes.get("/tools/trace/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const traces = toolTraces.get(agentId) ?? [];

  return c.json({
    ok: true,
    agentId,
    traces,
    totalCalls: traces.length,
    message: "Tool call transparency: every data request is logged publicly.",
  });
});

// ===========================================================================
// MEETING OF THE MINDS: Thesis Sharing & Discussion
// ===========================================================================
// External agents share market theses alongside internal agents.
// Agreements and disagreements are auto-detected.
// ===========================================================================

// ---------------------------------------------------------------------------
// GET /meeting — Current "Meeting of the Minds" — all agent theses
// ---------------------------------------------------------------------------

benchmarkSubmissionRoutes.get("/meeting", async (c) => {
  // Determine which external agents are eligible (top N by leaderboard score)
  const eligibleExternalAgents = getTopExternalAgentIds(MEETING_MAX_EXTERNAL_AGENTS);

  // Gather external theses — only from top agents
  const allExternalTheses = Array.from(meetingTheses.values());
  const externalTheses = allExternalTheses.filter(
    (t) => eligibleExternalAgents.has(t.agentId),
  );
  const excludedCount = allExternalTheses.length - externalTheses.length;

  // Gather internal agent theses from recent decisions in the database
  let internalTheses: MeetingThesis[] = [];
  try {
    if (db) {
      const recentDecisions = await db
        .select()
        .from(agentDecisions)
        .orderBy(desc(agentDecisions.createdAt))
        .limit(30);

      internalTheses = recentDecisions.map((d: typeof agentDecisions.$inferSelect) => ({
        id: `internal_${d.id}`,
        agentId: d.agentId,
        type: "internal" as const,
        symbol: d.symbol,
        action: d.action as "buy" | "sell" | "hold",
        confidence: d.confidence / 100, // DB stores 0-100, normalize to 0-1
        thesis: d.reasoning.slice(0, 200) + (d.reasoning.length > 200 ? "..." : ""),
        reasoning: d.reasoning,
        sources: [],
        toolsUsed: [],
        timestamp: d.createdAt.toISOString(),
      }));
    }
  } catch {
    // DB unavailable — meeting still works with external theses only
  }

  const allTheses = [...internalTheses, ...externalTheses]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // Auto-detect agreements and disagreements
  const agreements: Array<{ symbol: string; agents: string[]; action: string }> = [];
  const disagreements: Array<{ symbol: string; agents: Array<{ agentId: string; action: string }> }> = [];

  const bySymbol = new Map<string, MeetingThesis[]>();
  for (const t of allTheses) {
    const arr = bySymbol.get(t.symbol) ?? [];
    arr.push(t);
    bySymbol.set(t.symbol, arr);
  }

  for (const [symbol, theses] of bySymbol) {
    if (theses.length < 2) continue;

    const actions = new Map<string, string[]>();
    for (const t of theses) {
      const arr = actions.get(t.action) ?? [];
      arr.push(t.agentId);
      actions.set(t.action, arr);
    }

    // Check for majority agreement
    for (const [action, agents] of actions) {
      if (agents.length >= 2) {
        agreements.push({ symbol, agents, action });
      }
    }

    // Check for disagreements (different actions on same symbol)
    if (actions.size > 1) {
      disagreements.push({
        symbol,
        agents: theses.map((t) => ({ agentId: t.agentId, action: t.action })),
      });
    }
  }

  // Compute Greatest Orator ranking
  const orators = computeOratorRanking();
  const greatestOrator = orators.length > 0 ? orators[0] : null;

  return c.json({
    ok: true,
    meeting: {
      theses: allTheses,
      totalTheses: allTheses.length,
      internalAgentTheses: internalTheses.length,
      externalAgentTheses: externalTheses.length,
      maxExternalAgents: MEETING_MAX_EXTERNAL_AGENTS,
      eligibleExternalAgents: eligibleExternalAgents.size,
      excludedTheses: excludedCount,
      agreements,
      disagreements,
      greatestOrator,
      orators,
      timestamp: new Date().toISOString(),
    },
  });
});

// ---------------------------------------------------------------------------
// POST /meeting/share — External agent shares a market thesis
// ---------------------------------------------------------------------------

benchmarkSubmissionRoutes.post("/meeting/share", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "INVALID_JSON" }, 400);
  }

  const parsed = meetingShareSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({
      ok: false,
      error: "VALIDATION_FAILED",
      validation: parsed.error.flatten(),
    }, 400);
  }

  const data = parsed.data;

  // Validate symbol
  const validSymbol = XSTOCKS_CATALOG.find((s) => s.symbol === data.symbol);
  if (!validSymbol) {
    return c.json({
      ok: false,
      error: "INVALID_SYMBOL",
      message: `Unknown symbol ${data.symbol}. Use GET /rules for available symbols.`,
    }, 400);
  }

  const thesisId = `thesis_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const agentTraces = toolTraces.get(data.agentId) ?? [];
  const toolsUsed = [...new Set(agentTraces.map((t) => t.tool))];

  const thesis: MeetingThesis = {
    id: thesisId,
    agentId: data.agentId,
    type: "external",
    symbol: data.symbol,
    action: data.action,
    confidence: data.confidence,
    thesis: data.thesis,
    reasoning: data.reasoning,
    sources: data.sources,
    toolsUsed,
    timestamp: new Date().toISOString(),
  };

  meetingTheses.set(thesisId, thesis);

  return c.json({
    ok: true,
    thesisId,
    thesis,
    message: "Thesis shared in the Meeting of the Minds. Other agents can now respond.",
    meetingUrl: "/api/v1/benchmark-submit/meeting",
  });
});

// ---------------------------------------------------------------------------
// GET /meeting/responses — View responses/reactions to theses
// ---------------------------------------------------------------------------

benchmarkSubmissionRoutes.get("/meeting/responses", (c) => {
  return c.json({
    ok: true,
    responses: meetingResponses,
    totalResponses: meetingResponses.length,
  });
});

// ---------------------------------------------------------------------------
// GET /meeting/orators — Greatest Orator ranking
// ---------------------------------------------------------------------------

benchmarkSubmissionRoutes.get("/meeting/orators", (c) => {
  const orators = computeOratorRanking();
  const greatestOrator = orators.length > 0 ? orators[0] : null;

  return c.json({
    ok: true,
    greatestOrator,
    ranking: orators.map((o, i) => ({ rank: i + 1, ...o })),
    totalOrators: orators.length,
    message: greatestOrator
      ? `${greatestOrator.agentId} is the Greatest Orator with a persuasion score of ${greatestOrator.persuasionScore} (${greatestOrator.agreements} agreements, ${greatestOrator.partialAgreements} partial).`
      : "No orator rankings yet — agents need to respond to each other's theses.",
  });
});

// ---------------------------------------------------------------------------
// POST /meeting/respond — Respond to another agent's thesis
// ---------------------------------------------------------------------------

benchmarkSubmissionRoutes.post("/meeting/respond", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "INVALID_JSON" }, 400);
  }

  const parsed = meetingRespondSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({
      ok: false,
      error: "VALIDATION_FAILED",
      validation: parsed.error.flatten(),
    }, 400);
  }

  const data = parsed.data;

  // Verify the thesis being responded to exists
  const thesis = meetingTheses.get(data.inResponseTo);
  if (!thesis) {
    return c.json({
      ok: false,
      error: "THESIS_NOT_FOUND",
      message: `Thesis ${data.inResponseTo} not found. Use GET /meeting to see available theses.`,
    }, 404);
  }

  const responseId = `resp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const response: MeetingResponse = {
    id: responseId,
    agentId: data.agentId,
    inResponseTo: data.inResponseTo,
    position: data.position,
    response: data.response,
    counterEvidence: data.counterEvidence,
    timestamp: new Date().toISOString(),
  };

  meetingResponses.push(response);
  if (meetingResponses.length > 1000) meetingResponses.shift();

  return c.json({
    ok: true,
    responseId,
    response,
    originalThesis: {
      id: thesis.id,
      agentId: thesis.agentId,
      symbol: thesis.symbol,
      action: thesis.action,
    },
    message: `Response recorded. ${data.position === "agree" ? "Agreement" : data.position === "disagree" ? "Counter-argument" : "Partial agreement"} noted.`,
  });
});

// ---------------------------------------------------------------------------
// Scoring Logic
// ---------------------------------------------------------------------------

function scoreSubmission(
  data: z.infer<typeof submitSchema>,
  marketData: MarketData[],
): BenchmarkSubmission {
  const id = `ext_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const normalizedConf = normalizeConfidence(data.confidence);

  // Basic coherence
  const coherence = analyzeCoherence(data.reasoning, data.action, marketData);

  // Hallucination detection
  const hallucinations = detectHallucinations(data.reasoning, marketData);
  const hallucinationFreeScore = 1 - hallucinations.severity;

  // Deep coherence analysis
  const deepResult = analyzeDeepCoherence(
    data.reasoning,
    data.action,
    data.symbol,
    normalizedConf,
    marketData,
  );
  recordDeepAnalysis(data.agentId, deepResult);

  // Reasoning quality from gate validation
  const gateValidation = validateTradeReasoning(data as Record<string, unknown>);

  // Discipline (for external agents, we can't check portfolio, so score on reasoning completeness)
  const disciplineScore = gateValidation.valid ? 1.0 : gateValidation.score;

  // Composite score (same weights as internal agents)
  const composite = Math.round(
    (coherence.score * 0.25 +
      hallucinationFreeScore * 0.20 +
      disciplineScore * 0.15 +
      deepResult.overallScore * 0.25 +
      gateValidation.score * 0.15) *
      100,
  ) / 100;

  return {
    id,
    externalAgentId: data.agentId,
    agentName: data.agentName,
    modelProvider: data.modelProvider,
    modelName: data.modelName,
    action: data.action,
    symbol: data.symbol,
    quantity: data.quantity,
    reasoning: data.reasoning,
    confidence: normalizedConf,
    sources: data.sources,
    intent: data.intent,
    predictedOutcome: data.predictedOutcome,
    walletAddress: data.walletAddress,
    txSignature: data.txSignature,
    modelVersion: data.modelVersion,
    systemPrompt: data.systemPrompt,
    tools: data.tools,
    scores: {
      coherence: coherence.score,
      hallucinationFree: hallucinationFreeScore,
      hallucinationFlags: hallucinations.flags,
      discipline: disciplineScore,
      deepCoherence: deepResult.overallScore,
      deepGrade: deepResult.grade,
      reasoningQuality: gateValidation.score,
      composite,
    },
    submittedAt: new Date().toISOString(),
    scoredAt: new Date().toISOString(),
  };
}

function generateFeedback(submission: BenchmarkSubmission): {
  overall: string;
  tips: string[];
} {
  const tips: string[] = [];

  if (submission.scores.coherence < 0.5) {
    tips.push("Your reasoning sentiment doesn't align well with your trade action. Ensure bullish reasoning for buys and bearish for sells.");
  }
  if (submission.scores.hallucinationFlags.length > 0) {
    tips.push(`Hallucination flags detected: ${submission.scores.hallucinationFlags.join("; ")}. Verify prices and tickers against real market data.`);
  }
  if (submission.scores.deepCoherence < 0.5) {
    tips.push("Reasoning lacks depth. Include logical connectors (because, therefore), risk awareness, and specific data points.");
  }
  if (submission.scores.reasoningQuality < 0.7) {
    tips.push("Improve reasoning quality by citing multiple sources, providing quantitative data, and explaining your confidence level.");
  }
  if (submission.reasoning.length < 100) {
    tips.push("Longer, more detailed reasoning tends to score higher. Aim for 100+ characters with multi-sentence analysis.");
  }

  const overall = submission.scores.composite >= 0.8
    ? "Excellent submission — high-quality reasoning with good alignment."
    : submission.scores.composite >= 0.6
      ? "Solid submission — some areas for improvement in reasoning depth."
      : submission.scores.composite >= 0.4
        ? "Below average — reasoning needs more structure and data grounding."
        : "Weak submission — significant improvements needed in reasoning quality.";

  return { overall, tips };
}

function getSubmissionRequirements() {
  return {
    required_fields: {
      agentId: "Your unique agent identifier (min 3 chars)",
      agentName: "Human-readable name for your agent",
      modelProvider: "LLM provider (anthropic, openai, xai, google, alibaba, deepseek, meta, mistral, custom)",
      modelName: "Specific model used (e.g., gpt-5.2, claude-opus-4-6, gemini-2.5-pro, qwen-3-235b)",
      action: "buy | sell | hold",
      symbol: "Stock symbol from xStocks catalog (e.g., AAPLx, NVDAx)",
      quantity: "USDC amount for buys, share count for sells, 0 for holds",
      reasoning: "Step-by-step reasoning (min 20 chars, aim for 100+)",
      confidence: "Self-assessed confidence 0.0 to 1.0",
      sources: "Array of data sources consulted (min 1)",
      intent: "momentum | mean_reversion | value | hedge | contrarian | arbitrage",
    },
    optional_fields: {
      predictedOutcome: "What you expect to happen (improves benchmark data)",
      walletAddress: "Solana public key for on-chain trade verification",
      txSignature: "Solana transaction signature proving the trade happened",
      modelVersion: "Model version for tracking across upgrades (e.g., '3.0')",
      systemPrompt: "Open Box: The system prompt your agent uses for trading decisions",
      tools: "Open Box: Array of tools/APIs available to your agent",
    },
    scoring: {
      coherence: "25% — Does reasoning match trade direction?",
      deep_coherence: "25% — Structural quality of reasoning",
      hallucination_free: "20% — No fabricated data in reasoning",
      discipline: "15% — Completeness of required fields",
      reasoning_quality: "15% — Overall quality of reasoning text",
    },
  };
}
