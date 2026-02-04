/**
 * Brain Feed API Routes
 *
 * Live stream of AI agent reasoning — the "X-ray" into agent intelligence.
 * This is what makes MoltApp a benchmark: full transparency into WHY
 * agents trade, not just WHAT they trade.
 *
 * Routes:
 * - GET /                — Paginated feed of all agent reasoning
 * - GET /:agentId        — Specific agent's thought process
 * - GET /highlights       — Most interesting/controversial trades
 * - GET /stats            — Aggregate reasoning quality metrics
 */

import { Hono } from "hono";
import { db } from "../db/index.ts";
import { tradeJustifications, benchmarkSnapshots } from "../db/schema/trade-reasoning.ts";
import { agentDecisions } from "../db/schema/agent-decisions.ts";
import { eq, desc, sql, and, gte, lte } from "drizzle-orm";
import {
  analyzeCoherence,
  detectHallucinations,
} from "../services/coherence-analyzer.ts";
import {
  normalizeConfidence,
  extractSourcesFromReasoning,
  classifyIntent,
} from "../schemas/trade-reasoning.ts";

export const brainFeedRoutes = new Hono();

// ---------------------------------------------------------------------------
// In-memory cache for recent brain feed entries (fast reads)
// ---------------------------------------------------------------------------

interface BrainFeedEntry {
  id: string;
  agentId: string;
  action: string;
  symbol: string;
  quantity: number;
  reasoning: string;
  confidence: number;
  intent: string;
  sources: string[];
  coherenceScore: number;
  coherenceExplanation: string;
  hallucinationFlags: string[];
  predictedOutcome?: string;
  roundId?: string;
  timestamp: string;
}

const brainFeedCache: BrainFeedEntry[] = [];
const MAX_CACHE_SIZE = 500;

/**
 * Add an entry to the brain feed cache.
 * Called by the orchestrator after analyzing each trade.
 */
export function addBrainFeedEntry(entry: BrainFeedEntry): void {
  brainFeedCache.unshift(entry);
  if (brainFeedCache.length > MAX_CACHE_SIZE) {
    brainFeedCache.length = MAX_CACHE_SIZE;
  }
}

/**
 * Build a brain feed entry from an agent decision.
 * Used to retroactively populate the feed from existing decisions.
 */
export function buildBrainFeedEntry(
  decision: {
    agentId: string;
    action: string;
    symbol: string;
    quantity: string | number;
    reasoning: string;
    confidence: number;
    roundId?: string | null;
    createdAt?: Date | null;
  },
  coherence: { score: number; explanation: string },
  hallucinations: { flags: string[] },
): BrainFeedEntry {
  const confidence01 = normalizeConfidence(decision.confidence);
  const sources = extractSourcesFromReasoning(decision.reasoning);
  const intent = classifyIntent(decision.reasoning, decision.action);

  return {
    id: `bf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    agentId: decision.agentId,
    action: decision.action,
    symbol: decision.symbol,
    quantity: typeof decision.quantity === "string" ? parseFloat(decision.quantity) : decision.quantity,
    reasoning: decision.reasoning,
    confidence: confidence01,
    intent,
    sources,
    coherenceScore: coherence.score,
    coherenceExplanation: coherence.explanation,
    hallucinationFlags: hallucinations.flags,
    roundId: decision.roundId ?? undefined,
    timestamp: decision.createdAt?.toISOString() ?? new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET / — Paginated brain feed with filtering
 *
 * Query params:
 *   limit (default 20, max 100)
 *   offset (default 0)
 *   agent — filter by agent ID
 *   intent — filter by trading intent
 *   minConfidence — minimum confidence (0-1)
 *   maxConfidence — maximum confidence (0-1)
 */
brainFeedRoutes.get("/", async (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10), 100);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);
  const agentFilter = c.req.query("agent");
  const intentFilter = c.req.query("intent");
  const minConfidence = parseFloat(c.req.query("minConfidence") ?? "0");
  const maxConfidence = parseFloat(c.req.query("maxConfidence") ?? "1");

  // Try DB first, fall back to cache
  try {
    const conditions = [];
    if (agentFilter) {
      conditions.push(eq(tradeJustifications.agentId, agentFilter));
    }
    if (intentFilter) {
      conditions.push(eq(tradeJustifications.intent, intentFilter));
    }
    if (minConfidence > 0) {
      conditions.push(gte(tradeJustifications.confidence, minConfidence));
    }
    if (maxConfidence < 1) {
      conditions.push(lte(tradeJustifications.confidence, maxConfidence));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const justifications = await db
      .select()
      .from(tradeJustifications)
      .where(whereClause)
      .orderBy(desc(tradeJustifications.timestamp))
      .limit(limit)
      .offset(offset);

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(tradeJustifications)
      .where(whereClause);

    return c.json({
      ok: true,
      feed: justifications,
      total: Number(countResult[0]?.count ?? 0),
      limit,
      offset,
      source: "database",
    });
  } catch {
    // Fall back to in-memory cache
    let filtered = brainFeedCache;
    if (agentFilter) {
      filtered = filtered.filter((e) => e.agentId === agentFilter);
    }
    if (intentFilter) {
      filtered = filtered.filter((e) => e.intent === intentFilter);
    }
    filtered = filtered.filter(
      (e) => e.confidence >= minConfidence && e.confidence <= maxConfidence,
    );

    const paginated = filtered.slice(offset, offset + limit);

    return c.json({
      ok: true,
      feed: paginated,
      total: filtered.length,
      limit,
      offset,
      source: "cache",
    });
  }
});

/**
 * GET /highlights — Most interesting/controversial trades
 *
 * "Interesting" = low coherence OR high confidence + wrong outcome
 * These are the trades that reveal agent weaknesses.
 */
brainFeedRoutes.get("/highlights", async (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "10", 10), 50);

  try {
    // Query low-coherence trades from DB
    const lowCoherence = await db
      .select()
      .from(tradeJustifications)
      .where(lte(tradeJustifications.coherenceScore, 0.4))
      .orderBy(desc(tradeJustifications.timestamp))
      .limit(limit);

    // Query high-confidence trades that might have bad outcomes
    const highConfidence = await db
      .select()
      .from(tradeJustifications)
      .where(gte(tradeJustifications.confidence, 0.8))
      .orderBy(desc(tradeJustifications.timestamp))
      .limit(limit);

    // Merge and deduplicate
    const seenIds = new Set<string>();
    const highlights: typeof lowCoherence = [];

    for (const entry of [...lowCoherence, ...highConfidence]) {
      if (!seenIds.has(entry.id)) {
        seenIds.add(entry.id);
        highlights.push(entry);
      }
    }

    // Sort by "interestingness": low coherence first, then high confidence
    highlights.sort((a: typeof tradeJustifications.$inferSelect, b: typeof tradeJustifications.$inferSelect) => {
      const scoreA = (a.coherenceScore ?? 1) - (a.confidence ?? 0) * 0.3;
      const scoreB = (b.coherenceScore ?? 1) - (b.confidence ?? 0) * 0.3;
      return scoreA - scoreB;
    });

    return c.json({
      ok: true,
      highlights: highlights.slice(0, limit),
      criteria: {
        lowCoherence: "Trades where reasoning contradicts the action (coherence < 0.4)",
        highConfidenceRisk: "Trades with very high confidence (> 0.8) that need outcome tracking",
      },
    });
  } catch {
    // Fall back to cache
    const highlights = brainFeedCache
      .filter((e) => e.coherenceScore < 0.4 || e.confidence > 0.8)
      .sort((a, b) => {
        const scoreA = a.coherenceScore - a.confidence * 0.3;
        const scoreB = b.coherenceScore - b.confidence * 0.3;
        return scoreA - scoreB;
      })
      .slice(0, limit);

    return c.json({
      ok: true,
      highlights,
      criteria: {
        lowCoherence: "Trades where reasoning contradicts the action",
        highConfidenceRisk: "Very high confidence trades needing outcome review",
      },
      source: "cache",
    });
  }
});

/**
 * GET /stats — Aggregate reasoning quality metrics across all agents
 */
brainFeedRoutes.get("/stats", async (c) => {
  try {
    const stats = await db
      .select({
        agentId: tradeJustifications.agentId,
        totalTrades: sql<number>`count(*)`,
        avgCoherence: sql<number>`avg(${tradeJustifications.coherenceScore})`,
        avgConfidence: sql<number>`avg(${tradeJustifications.confidence})`,
        hallucinationCount: sql<number>`count(*) filter (where jsonb_array_length(${tradeJustifications.hallucinationFlags}) > 0)`,
      })
      .from(tradeJustifications)
      .groupBy(tradeJustifications.agentId);

    const agentStats = stats.map((s: typeof stats[0]) => ({
      agentId: s.agentId,
      totalTrades: Number(s.totalTrades),
      avgCoherence: Math.round((Number(s.avgCoherence) || 0) * 100) / 100,
      avgConfidence: Math.round((Number(s.avgConfidence) || 0) * 100) / 100,
      hallucinationRate:
        Number(s.totalTrades) > 0
          ? Math.round((Number(s.hallucinationCount) / Number(s.totalTrades)) * 100) / 100
          : 0,
    }));

    return c.json({
      ok: true,
      benchmarkMetrics: {
        agents: agentStats,
        overallCoherence:
          agentStats.length > 0
            ? Math.round(
                (agentStats.reduce((sum: number, a: typeof agentStats[0]) => sum + a.avgCoherence, 0) /
                  agentStats.length) *
                  100,
              ) / 100
            : 0,
        overallHallucinationRate:
          agentStats.length > 0
            ? Math.round(
                (agentStats.reduce((sum: number, a: typeof agentStats[0]) => sum + a.hallucinationRate, 0) /
                  agentStats.length) *
                  100,
              ) / 100
            : 0,
      },
    });
  } catch {
    // Fall back to cache stats
    const agentMap = new Map<string, { coherence: number[]; confidence: number[]; hallucinations: number }>();
    for (const entry of brainFeedCache) {
      const existing = agentMap.get(entry.agentId) ?? { coherence: [], confidence: [], hallucinations: 0 };
      existing.coherence.push(entry.coherenceScore);
      existing.confidence.push(entry.confidence);
      if (entry.hallucinationFlags.length > 0) existing.hallucinations++;
      agentMap.set(entry.agentId, existing);
    }

    const agentStats = Array.from(agentMap.entries()).map(([agentId, data]) => ({
      agentId,
      totalTrades: data.coherence.length,
      avgCoherence: Math.round((data.coherence.reduce((s, v) => s + v, 0) / data.coherence.length) * 100) / 100,
      avgConfidence: Math.round((data.confidence.reduce((s, v) => s + v, 0) / data.confidence.length) * 100) / 100,
      hallucinationRate: Math.round((data.hallucinations / data.coherence.length) * 100) / 100,
    }));

    return c.json({
      ok: true,
      benchmarkMetrics: { agents: agentStats },
      source: "cache",
    });
  }
});

/**
 * GET /:agentId — Specific agent's thought process history
 */
brainFeedRoutes.get("/:agentId", async (c) => {
  const agentId = c.req.param("agentId");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10), 100);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);

  try {
    const justifications = await db
      .select()
      .from(tradeJustifications)
      .where(eq(tradeJustifications.agentId, agentId))
      .orderBy(desc(tradeJustifications.timestamp))
      .limit(limit)
      .offset(offset);

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(tradeJustifications)
      .where(eq(tradeJustifications.agentId, agentId));

    // Calculate agent-specific benchmark scores
    const total = Number(countResult[0]?.count ?? 0);
    const avgCoherence = justifications.length > 0
      ? justifications.reduce((s: number, j: typeof justifications[0]) => s + (j.coherenceScore ?? 0), 0) / justifications.length
      : 0;

    const hallucinationCount = justifications.filter(
      (j: typeof justifications[0]) => j.hallucinationFlags && (j.hallucinationFlags as string[]).length > 0,
    ).length;

    return c.json({
      ok: true,
      agentId,
      feed: justifications,
      total,
      limit,
      offset,
      benchmarkScores: {
        avgCoherence: Math.round(avgCoherence * 100) / 100,
        hallucinationRate: total > 0 ? Math.round((hallucinationCount / justifications.length) * 100) / 100 : 0,
        tradesAnalyzed: justifications.length,
      },
    });
  } catch {
    // Fall back to cache
    const filtered = brainFeedCache.filter((e) => e.agentId === agentId);
    const paginated = filtered.slice(offset, offset + limit);

    return c.json({
      ok: true,
      agentId,
      feed: paginated,
      total: filtered.length,
      limit,
      offset,
      source: "cache",
    });
  }
});
