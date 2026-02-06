/**
 * Agent Reasoning Duel API Routes
 *
 * Side-by-side comparison of how two agents reason about the SAME stock
 * in the SAME round. This is the "cage match" of AI trading —
 * researchers can see exactly where agents agree and disagree.
 *
 * Routes:
 * - GET  /                    — Recent duels (auto-detected disagreements)
 * - GET  /round/:roundId      — All duels from a specific round
 * - GET  /stock/:symbol       — Historical duels for a specific stock
 * - GET  /matchup             — Head-to-head comparison of two specific agents
 * - GET  /stats               — Duel statistics (who wins most?)
 */

import { Hono } from "hono";
import { parseQueryInt } from "../lib/query-params.ts";
import { db } from "../db/index.ts";
import { tradeJustifications } from "../db/schema/trade-reasoning.ts";
import { eq, desc, sql, and } from "drizzle-orm";
import { apiError, handleError } from "../lib/errors.ts";
import { round2 } from "../lib/math-utils.ts";

export const reasoningDuelRoutes = new Hono();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DuelEntry {
  agentId: string;
  action: string;
  symbol: string;
  reasoning: string;
  confidence: number;
  intent: string;
  coherenceScore: number | null;
  hallucinationFlags: unknown;
  timestamp: Date | null;
}

interface Duel {
  roundId: string;
  symbol: string;
  agentA: DuelEntry;
  agentB: DuelEntry;
  /** Did they agree on direction? */
  agreed: boolean;
  /** Who had better coherence? */
  coherenceWinner: string;
  /** Who was more confident? */
  confidenceLeader: string;
  /** Summary of the disagreement */
  summary: string;
}

// ---------------------------------------------------------------------------
// In-Memory Cache for Duels
// ---------------------------------------------------------------------------

const duelCache: Duel[] = [];
const MAX_CACHE = 200;

/**
 * Add a duel to the cache (called externally when rounds complete).
 */
export function recordDuel(duel: Duel): void {
  duelCache.unshift(duel);
  if (duelCache.length > MAX_CACHE) duelCache.length = MAX_CACHE;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET / — Recent duels (auto-detected disagreements)
 */
reasoningDuelRoutes.get("/", async (c) => {
  const limit = parseQueryInt(c.req.query("limit"), 20, 1, 100);

  // Try to build duels from DB
  try {
    const recent = await db
      .select({
        agentId: tradeJustifications.agentId,
        action: tradeJustifications.action,
        symbol: tradeJustifications.symbol,
        reasoning: tradeJustifications.reasoning,
        confidence: tradeJustifications.confidence,
        intent: tradeJustifications.intent,
        coherenceScore: tradeJustifications.coherenceScore,
        hallucinationFlags: tradeJustifications.hallucinationFlags,
        roundId: tradeJustifications.roundId,
        timestamp: tradeJustifications.timestamp,
      })
      .from(tradeJustifications)
      .orderBy(desc(tradeJustifications.timestamp))
      .limit(300);

    // Group by roundId + symbol to find disagreements
    const groups = new Map<string, DuelEntry[]>();
    for (const r of recent) {
      if (!r.roundId) continue;
      const key = `${r.roundId}:${r.symbol}`;
      const list = groups.get(key) ?? [];
      list.push({
        agentId: r.agentId,
        action: r.action,
        symbol: r.symbol,
        reasoning: r.reasoning,
        confidence: r.confidence,
        intent: r.intent,
        coherenceScore: r.coherenceScore,
        hallucinationFlags: r.hallucinationFlags,
        timestamp: r.timestamp,
      });
      groups.set(key, list);
    }

    const duels: Duel[] = [];
    for (const [key, entries] of groups) {
      if (entries.length < 2) continue;

      const [roundId] = key.split(":");
      // Generate all pairs
      for (let i = 0; i < entries.length - 1; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          const a = entries[i];
          const b = entries[j];

          const agreed = a.action === b.action;
          const cohA = a.coherenceScore ?? 0;
          const cohB = b.coherenceScore ?? 0;

          duels.push({
            roundId,
            symbol: a.symbol,
            agentA: a,
            agentB: b,
            agreed,
            coherenceWinner: cohA > cohB ? a.agentId : cohB > cohA ? b.agentId : "tie",
            confidenceLeader: a.confidence > b.confidence ? a.agentId : b.confidence > a.confidence ? b.agentId : "tie",
            summary: agreed
              ? `${a.agentId} and ${b.agentId} both chose to ${a.action} ${a.symbol}`
              : `${a.agentId} chose ${a.action} while ${b.agentId} chose ${b.action} on ${a.symbol}`,
          });
        }
      }
    }

    // Sort: disagreements first (more interesting)
    duels.sort((a, b) => (a.agreed === b.agreed ? 0 : a.agreed ? 1 : -1));

    return c.json({
      ok: true,
      duels: duels.slice(0, limit),
      total: duels.length,
      disagreements: duels.filter((d) => !d.agreed).length,
      agreements: duels.filter((d) => d.agreed).length,
    });
  } catch {
    // Fall back to cache
    return c.json({
      ok: true,
      duels: duelCache.slice(0, limit),
      total: duelCache.length,
      source: "cache",
    });
  }
});

/**
 * GET /round/:roundId — All duels from a specific round
 */
reasoningDuelRoutes.get("/round/:roundId", async (c) => {
  const roundId = c.req.param("roundId");

  try {
    const entries = await db
      .select({
        agentId: tradeJustifications.agentId,
        action: tradeJustifications.action,
        symbol: tradeJustifications.symbol,
        reasoning: tradeJustifications.reasoning,
        confidence: tradeJustifications.confidence,
        intent: tradeJustifications.intent,
        coherenceScore: tradeJustifications.coherenceScore,
        hallucinationFlags: tradeJustifications.hallucinationFlags,
        timestamp: tradeJustifications.timestamp,
      })
      .from(tradeJustifications)
      .where(eq(tradeJustifications.roundId, roundId))
      .orderBy(desc(tradeJustifications.timestamp));

    // Group by symbol
    const bySymbol = new Map<string, DuelEntry[]>();
    for (const e of entries) {
      const list = bySymbol.get(e.symbol) ?? [];
      list.push(e);
      bySymbol.set(e.symbol, list);
    }

    const duels: Duel[] = [];
    for (const [symbol, symbolEntries] of bySymbol) {
      for (let i = 0; i < symbolEntries.length - 1; i++) {
        for (let j = i + 1; j < symbolEntries.length; j++) {
          const a = symbolEntries[i];
          const b = symbolEntries[j];
          const agreed = a.action === b.action;
          const cohA = a.coherenceScore ?? 0;
          const cohB = b.coherenceScore ?? 0;

          duels.push({
            roundId,
            symbol,
            agentA: a,
            agentB: b,
            agreed,
            coherenceWinner: cohA > cohB ? a.agentId : cohB > cohA ? b.agentId : "tie",
            confidenceLeader: a.confidence > b.confidence ? a.agentId : b.confidence > a.confidence ? b.agentId : "tie",
            summary: agreed
              ? `Both agents chose ${a.action} on ${symbol}`
              : `Disagreement: ${a.agentId} ${a.action} vs ${b.agentId} ${b.action} on ${symbol}`,
          });
        }
      }
    }

    return c.json({ ok: true, roundId, duels, totalEntries: entries.length });
  } catch (err) {
    return handleError(c, err);
  }
});

/**
 * GET /stock/:symbol — Historical duels for a stock
 */
reasoningDuelRoutes.get("/stock/:symbol", async (c) => {
  const symbol = c.req.param("symbol");
  const limit = parseQueryInt(c.req.query("limit"), 20, 1, 100);

  try {
    const entries = await db
      .select({
        agentId: tradeJustifications.agentId,
        action: tradeJustifications.action,
        symbol: tradeJustifications.symbol,
        reasoning: tradeJustifications.reasoning,
        confidence: tradeJustifications.confidence,
        intent: tradeJustifications.intent,
        coherenceScore: tradeJustifications.coherenceScore,
        hallucinationFlags: tradeJustifications.hallucinationFlags,
        roundId: tradeJustifications.roundId,
        timestamp: tradeJustifications.timestamp,
      })
      .from(tradeJustifications)
      .where(eq(tradeJustifications.symbol, symbol))
      .orderBy(desc(tradeJustifications.timestamp))
      .limit(limit * 3); // Get enough to find duels

    // Group by round
    const byRound = new Map<string, DuelEntry[]>();
    for (const e of entries) {
      if (!e.roundId) continue;
      const list = byRound.get(e.roundId) ?? [];
      list.push(e);
      byRound.set(e.roundId, list);
    }

    const duels: Duel[] = [];
    for (const [roundId, roundEntries] of byRound) {
      if (roundEntries.length < 2) continue;

      for (let i = 0; i < roundEntries.length - 1; i++) {
        for (let j = i + 1; j < roundEntries.length; j++) {
          const a = roundEntries[i];
          const b = roundEntries[j];
          const agreed = a.action === b.action;
          const cohA = a.coherenceScore ?? 0;
          const cohB = b.coherenceScore ?? 0;

          duels.push({
            roundId,
            symbol,
            agentA: a,
            agentB: b,
            agreed,
            coherenceWinner: cohA > cohB ? a.agentId : cohB > cohA ? b.agentId : "tie",
            confidenceLeader: a.confidence > b.confidence ? a.agentId : b.confidence > a.confidence ? b.agentId : "tie",
            summary: `${a.agentId} ${a.action} vs ${b.agentId} ${b.action}`,
          });
        }
      }
    }

    return c.json({
      ok: true,
      symbol,
      duels: duels.slice(0, limit),
      total: duels.length,
    });
  } catch (err) {
    return handleError(c, err);
  }
});

/**
 * GET /matchup — Head-to-head comparison of two specific agents
 * Query params: a=agentIdA, b=agentIdB
 */
reasoningDuelRoutes.get("/matchup", async (c) => {
  const agentA = c.req.query("a");
  const agentB = c.req.query("b");

  if (!agentA || !agentB) {
    return apiError(c, "VALIDATION_FAILED", "Both 'a' and 'b' query params required");
  }

  try {
    // Get all decisions from both agents
    const entriesA = await db
      .select({
        agentId: tradeJustifications.agentId,
        action: tradeJustifications.action,
        symbol: tradeJustifications.symbol,
        reasoning: tradeJustifications.reasoning,
        confidence: tradeJustifications.confidence,
        intent: tradeJustifications.intent,
        coherenceScore: tradeJustifications.coherenceScore,
        hallucinationFlags: tradeJustifications.hallucinationFlags,
        roundId: tradeJustifications.roundId,
        timestamp: tradeJustifications.timestamp,
      })
      .from(tradeJustifications)
      .where(eq(tradeJustifications.agentId, agentA))
      .orderBy(desc(tradeJustifications.timestamp))
      .limit(100);

    const entriesB = await db
      .select({
        agentId: tradeJustifications.agentId,
        action: tradeJustifications.action,
        symbol: tradeJustifications.symbol,
        reasoning: tradeJustifications.reasoning,
        confidence: tradeJustifications.confidence,
        intent: tradeJustifications.intent,
        coherenceScore: tradeJustifications.coherenceScore,
        hallucinationFlags: tradeJustifications.hallucinationFlags,
        roundId: tradeJustifications.roundId,
        timestamp: tradeJustifications.timestamp,
      })
      .from(tradeJustifications)
      .where(eq(tradeJustifications.agentId, agentB))
      .orderBy(desc(tradeJustifications.timestamp))
      .limit(100);

    // Find matching rounds
    const roundsA = new Map<string, DuelEntry>();
    for (const e of entriesA) {
      if (e.roundId) roundsA.set(`${e.roundId}:${e.symbol}`, e);
    }

    const duels: Duel[] = [];
    let agreementCount = 0;
    let aCoherenceWins = 0;
    let bCoherenceWins = 0;

    for (const b of entriesB) {
      if (!b.roundId) continue;
      const key = `${b.roundId}:${b.symbol}`;
      const a = roundsA.get(key);
      if (!a) continue;

      const agreed = a.action === b.action;
      if (agreed) agreementCount++;

      const cohA = a.coherenceScore ?? 0;
      const cohB = b.coherenceScore ?? 0;
      if (cohA > cohB) aCoherenceWins++;
      else if (cohB > cohA) bCoherenceWins++;

      duels.push({
        roundId: b.roundId,
        symbol: b.symbol,
        agentA: a,
        agentB: b,
        agreed,
        coherenceWinner: cohA > cohB ? a.agentId : cohB > cohA ? b.agentId : "tie",
        confidenceLeader: a.confidence > b.confidence ? a.agentId : b.confidence > a.confidence ? b.agentId : "tie",
        summary: agreed
          ? `Both ${a.action} ${a.symbol}`
          : `${a.agentId} ${a.action} vs ${b.agentId} ${b.action} on ${a.symbol}`,
      });
    }

    const totalDuels = duels.length;
    const avgCohA = entriesA.length > 0
      ? entriesA.reduce((s: number, e: typeof entriesA[0]) => s + (e.coherenceScore ?? 0), 0) / entriesA.length
      : 0;
    const avgCohB = entriesB.length > 0
      ? entriesB.reduce((s: number, e: typeof entriesB[0]) => s + (e.coherenceScore ?? 0), 0) / entriesB.length
      : 0;

    return c.json({
      ok: true,
      matchup: {
        agentA,
        agentB,
        totalDuels,
        agreementRate: totalDuels > 0 ? Math.round((agreementCount / totalDuels) * 100) : 0,
        coherenceComparison: {
          [agentA]: { avgCoherence: round2(avgCohA), wins: aCoherenceWins },
          [agentB]: { avgCoherence: round2(avgCohB), wins: bCoherenceWins },
          overallWinner: aCoherenceWins > bCoherenceWins ? agentA : bCoherenceWins > aCoherenceWins ? agentB : "tie",
        },
        recentDuels: duels.slice(0, 20),
      },
    });
  } catch (err) {
    return handleError(c, err);
  }
});

/**
 * GET /stats — Duel statistics
 */
reasoningDuelRoutes.get("/stats", async (c) => {
  try {
    // Get per-agent coherence stats
    const agentStats = await db
      .select({
        agentId: tradeJustifications.agentId,
        totalTrades: sql<number>`count(*)`,
        avgCoherence: sql<number>`avg(${tradeJustifications.coherenceScore})`,
        avgConfidence: sql<number>`avg(${tradeJustifications.confidence})`,
        buyCount: sql<number>`count(*) filter (where ${tradeJustifications.action} = 'buy')`,
        sellCount: sql<number>`count(*) filter (where ${tradeJustifications.action} = 'sell')`,
        holdCount: sql<number>`count(*) filter (where ${tradeJustifications.action} = 'hold')`,
      })
      .from(tradeJustifications)
      .groupBy(tradeJustifications.agentId);

    const rankings = agentStats
      .map((s: typeof agentStats[0]) => ({
        agentId: s.agentId,
        totalTrades: Number(s.totalTrades),
        avgCoherence: round2(Number(s.avgCoherence) || 0),
        avgConfidence: round2(Number(s.avgConfidence) || 0),
        actionSplit: {
          buy: Number(s.buyCount),
          sell: Number(s.sellCount),
          hold: Number(s.holdCount),
        },
      }))
      .sort((a: { avgCoherence: number }, b: { avgCoherence: number }) => b.avgCoherence - a.avgCoherence);

    return c.json({
      ok: true,
      rankings,
      coherenceLeader: rankings[0]?.agentId ?? null,
      totalAgents: rankings.length,
    });
  } catch (err) {
    return handleError(c, err);
  }
});
