/**
 * Decision Replay Routes
 *
 * Full transparency into AI trading decisions. Replay any past decision
 * with complete context reconstruction.
 *
 * Routes:
 *   GET  /api/v1/replay/decision/:id         — Replay a single decision
 *   GET  /api/v1/replay/round/:roundId       — Replay entire round
 *   GET  /api/v1/replay/timeline/:agentId    — Agent decision timeline
 *   GET  /api/v1/replay/search               — Search decisions by criteria
 */

import { Hono } from "hono";
import { parseQueryInt } from "../lib/query-params.ts";
import {
  replayDecision,
  replayRound,
  getDecisionTimeline,
  searchDecisions,
} from "../services/decision-replay.ts";
import { getAgentConfig } from "../agents/orchestrator.ts";

export const decisionReplayRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET /decision/:id — Replay a single decision with full context
// ---------------------------------------------------------------------------

decisionReplayRoutes.get("/decision/:id", async (c) => {
  const idStr = c.req.param("id");
  const id = parseInt(idStr, 10);

  if (isNaN(id)) {
    return c.json(
      { error: "validation_error", code: "validation_error", details: "Decision ID must be a number" },
      400,
    );
  }

  try {
    const replay = await replayDecision(id);

    if (!replay) {
      return c.json(
        { error: "not_found", code: "not_found", details: `Decision ${id} not found` },
        404,
      );
    }

    return c.json({
      replay,
      summary: buildReplaySummary(replay),
    });
  } catch (err) {
    console.error("[DecisionReplay] Replay failed:", err);
    return c.json(
      { error: "internal_error", code: "internal_error", details: "Failed to replay decision" },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /round/:roundId — Replay entire trading round
// ---------------------------------------------------------------------------

decisionReplayRoutes.get("/round/:roundId", async (c) => {
  const roundId = c.req.param("roundId");

  try {
    const result = await replayRound(roundId);

    if (!result) {
      return c.json(
        { error: "not_found", code: "not_found", details: `Round ${roundId} not found or has no decisions` },
        404,
      );
    }

    return c.json({
      round: result,
      narrative: buildRoundNarrative(result),
    });
  } catch (err) {
    console.error("[DecisionReplay] Round replay failed:", err);
    return c.json(
      { error: "internal_error", code: "internal_error", details: "Failed to replay round" },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /timeline/:agentId — Agent decision timeline
// ---------------------------------------------------------------------------

decisionReplayRoutes.get("/timeline/:agentId", async (c) => {
  const agentId = c.req.param("agentId");
  const limit = parseQueryInt(c.req.query("limit"), 30, 1, 100);

  const config = getAgentConfig(agentId);
  if (!config) {
    return c.json(
      { error: "not_found", code: "not_found", details: `Agent ${agentId} not found` },
      404,
    );
  }

  try {
    const timeline = await getDecisionTimeline(agentId, limit);

    return c.json({
      agentId,
      agentName: config.name,
      timeline,
      total: timeline.length,
    });
  } catch (err) {
    console.error("[DecisionReplay] Timeline failed:", err);
    return c.json(
      { error: "internal_error", code: "internal_error", details: "Failed to build timeline" },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /search — Search decisions with filters
// ---------------------------------------------------------------------------

decisionReplayRoutes.get("/search", async (c) => {
  const agentId = c.req.query("agentId");
  const symbol = c.req.query("symbol");
  const action = c.req.query("action");
  const minConfidence = c.req.query("minConfidence") ? parseInt(c.req.query("minConfidence")!, 10) : undefined;
  const maxConfidence = c.req.query("maxConfidence") ? parseInt(c.req.query("maxConfidence")!, 10) : undefined;
  const limit = parseQueryInt(c.req.query("limit"), 50, 1, 200);

  try {
    const results = await searchDecisions({
      agentId,
      symbol,
      action,
      minConfidence,
      maxConfidence,
      limit,
    });

    return c.json({
      decisions: results,
      total: results.length,
      filters: { agentId, symbol, action, minConfidence, maxConfidence },
    });
  } catch (err) {
    console.error("[DecisionReplay] Search failed:", err);
    return c.json(
      { error: "internal_error", code: "internal_error", details: "Failed to search decisions" },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// Narrative Builders
// ---------------------------------------------------------------------------

function buildReplaySummary(replay: Awaited<ReturnType<typeof replayDecision>>): string {
  if (!replay) return "";

  const { decision, agent, marketContext, reasoningAnalysis, outcome } = replay;

  let summary = `${agent.agentName} (${agent.provider}/${agent.model}) decided to ${decision.action}`;

  if (decision.action !== "hold") {
    summary += ` ${decision.symbol}`;
  }

  summary += ` with ${decision.confidence}% confidence.`;

  if (marketContext.marketDirection !== "mixed") {
    summary += ` Market was ${marketContext.marketDirection} (avg ${marketContext.avgChange24h > 0 ? "+" : ""}${marketContext.avgChange24h}%).`;
  }

  if (reasoningAnalysis.keyFactors.length > 0) {
    summary += ` Key factor: "${reasoningAnalysis.keyFactors[0].slice(0, 100)}..."`;
  }

  summary += ` ${outcome.timeSinceDecision}. Verdict: ${outcome.hindsightVerdict}.`;

  return summary;
}

function buildRoundNarrative(result: NonNullable<Awaited<ReturnType<typeof replayRound>>>): string {
  const { roundSummary, decisions } = result;

  let narrative = `Trading round ${result.roundId}: `;

  if (roundSummary.consensus === "unanimous") {
    narrative += `All agents unanimously chose to ${roundSummary.dominantAction}.`;
  } else if (roundSummary.consensus === "majority") {
    narrative += `Majority ${roundSummary.dominantAction}, but agents showed diverging views.`;
  } else {
    narrative += `Complete disagreement — agents took different approaches.`;
  }

  narrative += ` Average confidence: ${roundSummary.avgConfidence}%.`;

  if (roundSummary.stockFocus.length > 0) {
    narrative += ` Stocks in focus: ${roundSummary.stockFocus.join(", ")}.`;
  }

  narrative += ` Agreement rate: ${roundSummary.agreementRate}%.`;

  // Add individual agent summaries
  for (const replay of decisions) {
    narrative += ` ${replay.agent.agentName}: ${replay.decision.action} ${replay.decision.symbol} (${replay.decision.confidence}%).`;
  }

  return narrative;
}
