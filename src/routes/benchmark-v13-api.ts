/**
 * Benchmark v13 Battle API
 *
 * Researcher-facing API for the head-to-head battle benchmark system.
 * Provides battle results, Elo rankings, reasoning comparisons,
 * head-to-head matrices, and battle highlight reels.
 *
 * Routes:
 *   GET  /battles           — Paginated battle history
 *   GET  /battles/:battleId — Single battle detail
 *   GET  /elo               — Elo leaderboard
 *   GET  /record/:agentId   — Agent's battle record
 *   GET  /matrix            — Head-to-head win/loss matrix
 *   GET  /highlights        — Battle highlight reel
 *   GET  /reasoning-compare — Compare two agents' reasoning
 *   GET  /stats             — Aggregate battle statistics
 *   GET  /schema            — v13 benchmark schema documentation
 *   GET  /export/jsonl      — Export battles as JSONL for researchers
 *   GET  /export/csv        — Export battles as CSV
 */

import { Hono } from "hono";
import {
  getBattleHistory,
  getEloLeaderboard,
  getAgentBattleRecord,
  getHeadToHeadMatrix,
  getBattleHighlights,
  getBattleStats,
  type BattleResult,
} from "../services/battle-scoring-engine.ts";
import {
  compareReasoning,
  getReasoningProfile,
} from "../services/reasoning-battle-engine.ts";

export const benchmarkV13ApiRoutes = new Hono();

// ---------------------------------------------------------------------------
// Battle History
// ---------------------------------------------------------------------------

/**
 * GET /battles — Paginated battle history with optional filters
 *
 * Query params:
 *   limit (default 20, max 100)
 *   offset (default 0)
 *   agent — filter by agent ID (battles involving this agent)
 *   highlights — if "true", only return highlight battles
 */
benchmarkV13ApiRoutes.get("/battles", (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10), 100);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);
  const agentId = c.req.query("agent") ?? undefined;
  const highlightsOnly = c.req.query("highlights") === "true";

  const { battles, total } = getBattleHistory({
    agentId,
    limit,
    offset,
    highlightsOnly,
  });

  return c.json({
    ok: true,
    battles: battles.map(summarizeBattle),
    total,
    limit,
    offset,
    filters: { agentId, highlightsOnly },
  });
});

/**
 * GET /battles/:battleId — Single battle with full detail
 */
benchmarkV13ApiRoutes.get("/battles/:battleId", (c) => {
  const battleId = c.req.param("battleId");
  const { battles } = getBattleHistory({ limit: 1000 });
  const battle = battles.find((b) => b.battleId === battleId);

  if (!battle) {
    return c.json({ ok: false, error: "Battle not found" }, 404);
  }

  return c.json({ ok: true, battle });
});

// ---------------------------------------------------------------------------
// Elo Rankings
// ---------------------------------------------------------------------------

/**
 * GET /elo — Current Elo leaderboard
 */
benchmarkV13ApiRoutes.get("/elo", (c) => {
  const leaderboard = getEloLeaderboard();

  return c.json({
    ok: true,
    leaderboard,
    system: {
      initialRating: 1500,
      kFactor: 32,
      algorithm: "Standard Elo with K=32",
      note: "Ratings derived from pairwise battle outcomes per trading round",
    },
  });
});

// ---------------------------------------------------------------------------
// Agent Battle Records
// ---------------------------------------------------------------------------

/**
 * GET /record/:agentId — Agent's complete battle record
 */
benchmarkV13ApiRoutes.get("/record/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const record = getAgentBattleRecord(agentId);

  return c.json({
    ok: true,
    record: {
      ...record,
      recentBattles: record.recentBattles.map(summarizeBattle),
    },
  });
});

// ---------------------------------------------------------------------------
// Head-to-Head Matrix
// ---------------------------------------------------------------------------

/**
 * GET /matrix — Full head-to-head win/loss/margin matrix
 */
benchmarkV13ApiRoutes.get("/matrix", (c) => {
  const matrix = getHeadToHeadMatrix();

  return c.json({
    ok: true,
    matrix,
    description: {
      agents: "Sorted list of agent IDs (row/column indices)",
      wins: "wins[i][j] = number of times agents[i] defeated agents[j]",
      avgMargins: "avgMargins[i][j] = average margin of victory when agents[i] beats agents[j]",
      matchups: "matchups[i][j] = total number of battles between agents[i] and agents[j]",
    },
  });
});

// ---------------------------------------------------------------------------
// Battle Highlights
// ---------------------------------------------------------------------------

/**
 * GET /highlights — Most interesting battles (close calls, upsets, ties)
 */
benchmarkV13ApiRoutes.get("/highlights", (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "10", 10), 50);
  const highlights = getBattleHighlights(limit);

  return c.json({
    ok: true,
    highlights: highlights.map((h) => ({
      battleId: h.battleId,
      reason: h.reason,
      battle: summarizeBattle(h.battle),
    })),
  });
});

// ---------------------------------------------------------------------------
// Reasoning Comparison
// ---------------------------------------------------------------------------

/**
 * GET /reasoning-compare — Compare two reasoning texts head-to-head
 *
 * Query params:
 *   agentA — agent A ID
 *   agentB — agent B ID
 *   reasoningA — agent A's reasoning text (URL-encoded)
 *   reasoningB — agent B's reasoning text (URL-encoded)
 */
benchmarkV13ApiRoutes.get("/reasoning-compare", (c) => {
  const agentA = c.req.query("agentA") ?? "agent-a";
  const agentB = c.req.query("agentB") ?? "agent-b";
  const reasoningA = c.req.query("reasoningA") ?? "";
  const reasoningB = c.req.query("reasoningB") ?? "";

  if (!reasoningA || !reasoningB) {
    return c.json({
      ok: false,
      error: "Both reasoningA and reasoningB query params are required",
    }, 400);
  }

  const result = compareReasoning(agentA, reasoningA, agentB, reasoningB);

  return c.json({ ok: true, comparison: result });
});

/**
 * GET /reasoning-profile — Get reasoning quality profile for a text
 *
 * Query params:
 *   agentId — agent ID
 *   reasoning — reasoning text (URL-encoded)
 */
benchmarkV13ApiRoutes.get("/reasoning-profile", (c) => {
  const agentId = c.req.query("agentId") ?? "unknown";
  const reasoning = c.req.query("reasoning") ?? "";

  if (!reasoning) {
    return c.json({ ok: false, error: "reasoning query param is required" }, 400);
  }

  const profile = getReasoningProfile(agentId, reasoning);

  return c.json({ ok: true, profile });
});

// ---------------------------------------------------------------------------
// Aggregate Stats
// ---------------------------------------------------------------------------

/**
 * GET /stats — Aggregate battle statistics
 */
benchmarkV13ApiRoutes.get("/stats", (c) => {
  const stats = getBattleStats();

  return c.json({
    ok: true,
    stats,
    benchmarkVersion: "v13",
    description: "Head-to-head agent battle benchmark with 7-dimension reasoning comparison",
  });
});

// ---------------------------------------------------------------------------
// Schema Documentation
// ---------------------------------------------------------------------------

/**
 * GET /schema — v13 benchmark schema for researchers
 */
benchmarkV13ApiRoutes.get("/schema", (c) => {
  return c.json({
    ok: true,
    benchmarkVersion: "v13",
    name: "MoltApp Battle Benchmark",
    description: "Head-to-head agent battle scoring with Elo rankings, reasoning quality comparisons, and win/loss matrices",
    battleDimensions: [
      { name: "financial", weight: 0.20, description: "P&L comparison for the round" },
      { name: "reasoning_coherence", weight: 0.20, description: "Coherence of reasoning vs action" },
      { name: "reasoning_depth", weight: 0.15, description: "Analytical depth of reasoning" },
      { name: "conviction_calibration", weight: 0.15, description: "Confidence appropriateness" },
      { name: "originality", weight: 0.10, description: "Reasoning novelty vs templates" },
      { name: "safety", weight: 0.10, description: "Hallucination-free rate" },
      { name: "discipline", weight: 0.10, description: "Rule compliance" },
    ],
    reasoningComparisonDimensions: [
      { name: "analytical_breadth", weight: 0.20, description: "Number of analytical factors considered" },
      { name: "evidence_quality", weight: 0.20, description: "Concrete data citations vs vague claims" },
      { name: "causal_reasoning", weight: 0.15, description: "Explanatory causal chains" },
      { name: "risk_awareness", weight: 0.15, description: "Acknowledgement of downside scenarios" },
      { name: "intellectual_honesty", weight: 0.10, description: "Uncertainty acknowledgement" },
      { name: "actionability", weight: 0.10, description: "Precision of recommendations" },
      { name: "uniqueness", weight: 0.10, description: "Originality of reasoning" },
    ],
    eloSystem: {
      initialRating: 1500,
      kFactor: 32,
      algorithm: "Standard Elo with pairwise round-by-round matchups",
    },
    endpoints: {
      battles: "/api/v1/benchmark-v13/battles",
      elo: "/api/v1/benchmark-v13/elo",
      record: "/api/v1/benchmark-v13/record/:agentId",
      matrix: "/api/v1/benchmark-v13/matrix",
      highlights: "/api/v1/benchmark-v13/highlights",
      reasoningCompare: "/api/v1/benchmark-v13/reasoning-compare",
      stats: "/api/v1/benchmark-v13/stats",
      exportJsonl: "/api/v1/benchmark-v13/export/jsonl",
      exportCsv: "/api/v1/benchmark-v13/export/csv",
    },
  });
});

// ---------------------------------------------------------------------------
// Export Endpoints (Researcher-Facing)
// ---------------------------------------------------------------------------

/**
 * GET /export/jsonl — Export battles as JSONL for ML research
 */
benchmarkV13ApiRoutes.get("/export/jsonl", (c) => {
  const { battles } = getBattleHistory({ limit: 1000 });

  const jsonl = battles
    .map((b) => JSON.stringify({
      battle_id: b.battleId,
      round_id: b.roundId,
      timestamp: b.timestamp,
      agent_a: b.agentA.agentId,
      agent_b: b.agentB.agentId,
      winner: b.overallWinner,
      margin: b.marginOfVictory,
      composite_a: b.compositeScoreA,
      composite_b: b.compositeScoreB,
      agent_a_action: b.agentA.action,
      agent_b_action: b.agentB.action,
      agent_a_symbol: b.agentA.symbol,
      agent_b_symbol: b.agentB.symbol,
      agent_a_reasoning: b.agentA.reasoning,
      agent_b_reasoning: b.agentB.reasoning,
      agent_a_confidence: b.agentA.confidence,
      agent_b_confidence: b.agentB.confidence,
      agent_a_coherence: b.agentA.coherenceScore,
      agent_b_coherence: b.agentB.coherenceScore,
      dimensions: Object.fromEntries(
        b.dimensions.map((d) => [d.name, { winner: d.winnerAgentId, a: d.scoreA, b: d.scoreB }]),
      ),
      narrative: b.narrative,
      highlight: b.highlight,
    }))
    .join("\n");

  return new Response(jsonl, {
    headers: {
      "Content-Type": "application/jsonl",
      "Content-Disposition": `attachment; filename="moltapp-battles-v13-${new Date().toISOString().split("T")[0]}.jsonl"`,
    },
  });
});

/**
 * GET /export/csv — Export battles as CSV
 */
benchmarkV13ApiRoutes.get("/export/csv", (c) => {
  const { battles } = getBattleHistory({ limit: 1000 });

  const headers = [
    "battle_id", "round_id", "timestamp", "agent_a", "agent_b",
    "winner", "margin", "composite_a", "composite_b",
    "agent_a_action", "agent_b_action", "agent_a_symbol", "agent_b_symbol",
    "agent_a_confidence", "agent_b_confidence",
    "agent_a_coherence", "agent_b_coherence",
    "highlight", "narrative",
  ];

  const rows = battles.map((b) => [
    b.battleId, b.roundId, b.timestamp, b.agentA.agentId, b.agentB.agentId,
    b.overallWinner ?? "tie", b.marginOfVictory, b.compositeScoreA, b.compositeScoreB,
    b.agentA.action, b.agentB.action, b.agentA.symbol, b.agentB.symbol,
    b.agentA.confidence, b.agentB.confidence,
    b.agentA.coherenceScore, b.agentB.coherenceScore,
    b.highlight, `"${b.narrative.replace(/"/g, '""')}"`,
  ]);

  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="moltapp-battles-v13-${new Date().toISOString().split("T")[0]}.csv"`,
    },
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Summarize a battle result (omit full reasoning text for list views).
 */
function summarizeBattle(b: BattleResult) {
  return {
    battleId: b.battleId,
    roundId: b.roundId,
    timestamp: b.timestamp,
    agentA: {
      agentId: b.agentA.agentId,
      action: b.agentA.action,
      symbol: b.agentA.symbol,
      confidence: b.agentA.confidence,
      coherenceScore: b.agentA.coherenceScore,
    },
    agentB: {
      agentId: b.agentB.agentId,
      action: b.agentB.action,
      symbol: b.agentB.symbol,
      confidence: b.agentB.confidence,
      coherenceScore: b.agentB.coherenceScore,
    },
    overallWinner: b.overallWinner,
    marginOfVictory: b.marginOfVictory,
    compositeScoreA: b.compositeScoreA,
    compositeScoreB: b.compositeScoreB,
    dimensions: b.dimensions.map((d) => ({
      name: d.name,
      winner: d.winnerAgentId,
      scoreA: d.scoreA,
      scoreB: d.scoreB,
    })),
    narrative: b.narrative,
    highlight: b.highlight,
  };
}
