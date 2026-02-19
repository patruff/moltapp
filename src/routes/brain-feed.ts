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
import { round2 } from "../lib/math-utils.ts";
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
import { parseQueryInt } from "../lib/query-params.js";

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

// ---------------------------------------------------------------------------
// Pagination Defaults
// ---------------------------------------------------------------------------

/** Default number of entries returned by the main feed and agent feed routes. */
const FEED_DEFAULT_LIMIT = 20;

/** Maximum number of entries the caller may request from the main/agent feed. */
const FEED_MAX_LIMIT = 100;

/** Default page offset (start from the beginning). */
const FEED_DEFAULT_OFFSET = 0;

/** Default number of highlight entries returned by the /highlights route. */
const HIGHLIGHTS_DEFAULT_LIMIT = 10;

/** Maximum number of highlight entries the caller may request. */
const HIGHLIGHTS_MAX_LIMIT = 50;

// ---------------------------------------------------------------------------
// Highlights Thresholds
// ---------------------------------------------------------------------------

/**
 * Coherence score ceiling for "low coherence" highlights.
 * Trades where reasoning score ≤ 0.4 are flagged as contradicting the action —
 * these reveal the most interesting agent failure modes.
 */
const LOW_COHERENCE_THRESHOLD = 0.4;

/**
 * Confidence floor for "high confidence risk" highlights.
 * Trades where the agent is ≥ 80% confident are tracked for outcome review —
 * high conviction combined with a bad outcome is the most instructive failure.
 */
const HIGH_CONFIDENCE_HIGHLIGHT_THRESHOLD = 0.8;

/**
 * Weight applied to confidence in the interestingness sort score.
 *
 * Interestingness = coherenceScore − confidence × CONFIDENCE_INTEREST_WEIGHT
 *
 * A lower score = more interesting. Subtracting a fraction of confidence means
 * high-confidence trades bubble up alongside low-coherence ones.
 * Example: coherence 0.6, confidence 0.9 → 0.6 − 0.9×0.3 = 0.33 (interesting)
 */
const CONFIDENCE_INTEREST_WEIGHT = 0.3;

// ---------------------------------------------------------------------------
// Stats Precision
// ---------------------------------------------------------------------------

/**
 * Multiplier/divisor pair for rounding aggregate stats to 2 decimal places.
 * Formula: Math.round(value × 100) / 100 → e.g. 0.8333 → 0.83
 */
const STATS_PRECISION_MULTIPLIER = 100;

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
  const limit = parseQueryInt(c.req.query("limit"), FEED_DEFAULT_LIMIT, 1, FEED_MAX_LIMIT);
  const offset = parseQueryInt(c.req.query("offset"), FEED_DEFAULT_OFFSET, 0);
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
  const limit = parseQueryInt(c.req.query("limit"), HIGHLIGHTS_DEFAULT_LIMIT, 1, HIGHLIGHTS_MAX_LIMIT);

  try {
    // Query low-coherence trades from DB
    const lowCoherence = await db
      .select()
      .from(tradeJustifications)
      .where(lte(tradeJustifications.coherenceScore, LOW_COHERENCE_THRESHOLD))
      .orderBy(desc(tradeJustifications.timestamp))
      .limit(limit);

    // Query high-confidence trades that might have bad outcomes
    const highConfidence = await db
      .select()
      .from(tradeJustifications)
      .where(gte(tradeJustifications.confidence, HIGH_CONFIDENCE_HIGHLIGHT_THRESHOLD))
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
      const scoreA = (a.coherenceScore ?? 1) - (a.confidence ?? 0) * CONFIDENCE_INTEREST_WEIGHT;
      const scoreB = (b.coherenceScore ?? 1) - (b.confidence ?? 0) * CONFIDENCE_INTEREST_WEIGHT;
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
      .filter((e) => e.coherenceScore < LOW_COHERENCE_THRESHOLD || e.confidence > HIGH_CONFIDENCE_HIGHLIGHT_THRESHOLD)
      .sort((a, b) => {
        const scoreA = a.coherenceScore - a.confidence * CONFIDENCE_INTEREST_WEIGHT;
        const scoreB = b.coherenceScore - b.confidence * CONFIDENCE_INTEREST_WEIGHT;
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
      avgCoherence: round2(Number(s.avgCoherence) || 0),
      avgConfidence: round2(Number(s.avgConfidence) || 0),
      hallucinationRate:
        Number(s.totalTrades) > 0
          ? round2(Number(s.hallucinationCount) / Number(s.totalTrades))
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
                  STATS_PRECISION_MULTIPLIER,
              ) / STATS_PRECISION_MULTIPLIER
            : 0,
        overallHallucinationRate:
          agentStats.length > 0
            ? Math.round(
                (agentStats.reduce((sum: number, a: typeof agentStats[0]) => sum + a.hallucinationRate, 0) /
                  agentStats.length) *
                  STATS_PRECISION_MULTIPLIER,
              ) / STATS_PRECISION_MULTIPLIER
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
      avgCoherence: round2(data.coherence.reduce((s, v) => s + v, 0) / data.coherence.length),
      avgConfidence: round2(data.confidence.reduce((s, v) => s + v, 0) / data.confidence.length),
      hallucinationRate: round2(data.hallucinations / data.coherence.length),
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
  const limit = parseQueryInt(c.req.query("limit"), FEED_DEFAULT_LIMIT, 1, FEED_MAX_LIMIT);
  const offset = parseQueryInt(c.req.query("offset"), FEED_DEFAULT_OFFSET, 0);

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
        avgCoherence: round2(avgCoherence),
        hallucinationRate: total > 0 ? round2(hallucinationCount / justifications.length) : 0,
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
