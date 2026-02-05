/**
 * Trading Round History API
 *
 * Exposes trading round history for the dashboard and external consumers.
 * Shows the complete audit trail of every AI agent decision, execution
 * result, consensus analysis, and round-level statistics.
 *
 * Endpoints:
 * - GET /rounds — List recent trading rounds with pagination
 * - GET /rounds/:roundId — Get a specific round with full details
 * - GET /rounds/stats — Round statistics (averages, consensus breakdown)
 * - GET /rounds/agent/:agentId — Rounds filtered by agent
 * - GET /rounds/consensus — Consensus analysis across rounds
 * - GET /rounds/timeline — Timeline of round events for visualization
 */

import { Hono } from "hono";
import { parseQueryInt } from "../lib/query-params.ts";
import {
  getCachedRounds,
  getCachedRoundsByAgent,
  getRoundCacheStats,
  getRound,
  getPersisterStats,
  type PersistedRound,
  type PersistedAgentResult,
} from "../services/dynamo-round-persister.ts";

const roundHistory = new Hono();

// ---------------------------------------------------------------------------
// GET /rounds — List recent trading rounds
// ---------------------------------------------------------------------------

roundHistory.get("/", async (c) => {
  const limit = parseQueryInt(c.req.query("limit"), 20, 1, 100);
  const rounds = getCachedRounds(limit);

  return c.json({
    rounds: rounds.map(formatRoundSummary),
    total: rounds.length,
    limit,
    persistence: getPersisterStats(),
  });
});

// ---------------------------------------------------------------------------
// GET /rounds/stats — Round-level statistics
// ---------------------------------------------------------------------------

roundHistory.get("/stats", (c) => {
  const stats = getRoundCacheStats();
  const rounds = getCachedRounds(100);

  // Compute additional analytics
  const agentWinRates: Record<string, { wins: number; total: number }> = {};
  const symbolActivity: Record<string, { buys: number; sells: number; holds: number }> = {};

  for (const round of rounds) {
    for (const result of round.results) {
      // Track agent activity
      const agentStats = agentWinRates[result.agentName] ?? { wins: 0, total: 0 };
      agentStats.total++;
      if (result.executed && result.action !== "hold") {
        agentStats.wins++;
      }
      agentWinRates[result.agentName] = agentStats;

      // Track symbol activity
      const sym = symbolActivity[result.symbol] ?? { buys: 0, sells: 0, holds: 0 };
      if (result.action === "buy") sym.buys++;
      else if (result.action === "sell") sym.sells++;
      else sym.holds++;
      symbolActivity[result.symbol] = sym;
    }
  }

  return c.json({
    ...stats,
    agentActivity: Object.entries(agentWinRates).map(([name, stats]) => ({
      agent: name,
      totalDecisions: stats.total,
      activeTradeRate: stats.total > 0
        ? Math.round((stats.wins / stats.total) * 100)
        : 0,
    })),
    symbolActivity: Object.entries(symbolActivity)
      .sort(([, a], [, b]) => (b.buys + b.sells) - (a.buys + a.sells))
      .slice(0, 10)
      .map(([symbol, stats]) => ({
        symbol,
        ...stats,
        total: stats.buys + stats.sells + stats.holds,
      })),
  });
});

// ---------------------------------------------------------------------------
// GET /rounds/consensus — Consensus analysis
// ---------------------------------------------------------------------------

roundHistory.get("/consensus", (c) => {
  const rounds = getCachedRounds(50);

  const consensusCounts: Record<string, number> = {};
  const agreementPatterns: Array<{
    roundId: string;
    timestamp: string;
    agents: Array<{ name: string; action: string; symbol: string; confidence: number }>;
    agreement: string;
  }> = [];

  for (const round of rounds) {
    consensusCounts[round.consensus] = (consensusCounts[round.consensus] ?? 0) + 1;

    if (round.consensus === "unanimous" || round.consensus === "split") {
      agreementPatterns.push({
        roundId: round.roundId,
        timestamp: round.timestamp,
        agents: round.results.map((r) => ({
          name: r.agentName,
          action: r.action,
          symbol: r.symbol,
          confidence: r.confidence,
        })),
        agreement: round.consensus,
      });
    }
  }

  // Find stocks where agents frequently disagree
  const disagreementsBySymbol: Record<string, number> = {};
  for (const round of rounds) {
    const nonHold = round.results.filter((r) => r.action !== "hold");
    const actions = new Set(nonHold.map((r) => r.action));
    if (actions.size > 1) {
      for (const r of nonHold) {
        disagreementsBySymbol[r.symbol] = (disagreementsBySymbol[r.symbol] ?? 0) + 1;
      }
    }
  }

  return c.json({
    totalRounds: rounds.length,
    consensusBreakdown: consensusCounts,
    unanimousRate: rounds.length > 0
      ? Math.round(((consensusCounts["unanimous"] ?? 0) / rounds.length) * 100)
      : 0,
    splitRate: rounds.length > 0
      ? Math.round(((consensusCounts["split"] ?? 0) / rounds.length) * 100)
      : 0,
    recentPatterns: agreementPatterns.slice(0, 10),
    controversialStocks: Object.entries(disagreementsBySymbol)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([symbol, count]) => ({ symbol, disagreements: count })),
  });
});

// ---------------------------------------------------------------------------
// GET /rounds/timeline — Timeline for visualization
// ---------------------------------------------------------------------------

roundHistory.get("/timeline", (c) => {
  const limit = parseQueryInt(c.req.query("limit"), 48, 1, 200);
  const rounds = getCachedRounds(limit);

  const events = rounds.map((round) => ({
    roundId: round.roundId,
    timestamp: round.timestamp,
    durationMs: round.durationMs,
    tradingMode: round.tradingMode,
    consensus: round.consensus,
    agentCount: round.results.length,
    tradedCount: round.results.filter((r) => r.action !== "hold" && r.executed).length,
    errorCount: round.errors.length,
    topAction: getTopAction(round),
    summary: round.summary,
  }));

  return c.json({
    events,
    count: events.length,
    spanHours: events.length > 1
      ? Math.round(
          (new Date(events[0].timestamp).getTime() -
            new Date(events[events.length - 1].timestamp).getTime()) /
            3_600_000,
        )
      : 0,
  });
});

// ---------------------------------------------------------------------------
// GET /rounds/agent/:agentId — Rounds for a specific agent
// ---------------------------------------------------------------------------

roundHistory.get("/agent/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const limit = parseQueryInt(c.req.query("limit"), 20, 1, 100);
  const rounds = getCachedRoundsByAgent(agentId, limit);

  const agentDecisions = rounds.map((round) => {
    const agentResult = round.results.find((r) => r.agentId === agentId);
    return {
      roundId: round.roundId,
      timestamp: round.timestamp,
      decision: agentResult
        ? {
            action: agentResult.action,
            symbol: agentResult.symbol,
            quantity: agentResult.quantity,
            confidence: agentResult.confidence,
            reasoning: agentResult.reasoning,
            executed: agentResult.executed,
            executionError: agentResult.executionError,
          }
        : null,
      consensus: round.consensus,
      peerDecisions: round.results
        .filter((r) => r.agentId !== agentId)
        .map((r) => ({
          agentName: r.agentName,
          action: r.action,
          symbol: r.symbol,
          confidence: r.confidence,
        })),
    };
  });

  return c.json({
    agentId,
    rounds: agentDecisions,
    total: agentDecisions.length,
  });
});

// ---------------------------------------------------------------------------
// GET /rounds/:roundId — Specific round details
// ---------------------------------------------------------------------------

roundHistory.get("/:roundId", async (c) => {
  const roundId = c.req.param("roundId");

  // Check cache first
  const cached = getCachedRounds(100).find((r) => r.roundId === roundId);
  if (cached) {
    return c.json(formatRoundDetail(cached));
  }

  // Try DynamoDB
  const persisted = await getRound(roundId);
  if (persisted) {
    return c.json(formatRoundDetail(persisted));
  }

  return c.json({ error: "Round not found", roundId }, 404);
});

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function formatRoundSummary(round: PersistedRound) {
  return {
    roundId: round.roundId,
    timestamp: round.timestamp,
    durationMs: round.durationMs,
    tradingMode: round.tradingMode,
    consensus: round.consensus,
    summary: round.summary,
    agentCount: round.results.length,
    executed: round.results.filter((r) => r.executed).length,
    errors: round.errors.length,
    lockSkipped: round.lockSkipped,
  };
}

function formatRoundDetail(round: PersistedRound) {
  return {
    roundId: round.roundId,
    timestamp: round.timestamp,
    durationMs: round.durationMs,
    tradingMode: round.tradingMode,
    consensus: round.consensus,
    summary: round.summary,
    lockSkipped: round.lockSkipped,
    circuitBreakerActivations: round.circuitBreakerActivations,
    results: round.results.map((r) => ({
      agentId: r.agentId,
      agentName: r.agentName,
      action: r.action,
      symbol: r.symbol,
      quantity: r.quantity,
      reasoning: r.reasoning,
      confidence: r.confidence,
      executed: r.executed,
      executionError: r.executionError,
      txSignature: r.txSignature,
      filledPrice: r.filledPrice,
      usdcAmount: r.usdcAmount,
    })),
    errors: round.errors,
  };
}

function getTopAction(round: PersistedRound): { action: string; symbol: string } | null {
  const nonHold = round.results.filter((r) => r.action !== "hold" && r.executed);
  if (nonHold.length === 0) return null;
  // Return highest confidence executed trade
  const top = nonHold.sort((a, b) => b.confidence - a.confidence)[0];
  return { action: top.action, symbol: top.symbol };
}

export { roundHistory as roundHistoryRoutes };
