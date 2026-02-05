/**
 * Reasoning Explorer API
 *
 * Interactive API for exploring, searching, and analyzing the reasoning
 * data produced by AI trading agents. Designed for researchers, judges,
 * and curious observers who want to deeply understand HOW agents think.
 *
 * Routes:
 * - GET /search           — Full-text search across all reasoning
 * - GET /similar/:id      — Find similar reasoning to a given trade
 * - GET /trends           — Reasoning quality trends over time
 * - GET /vocabulary        — Agent vocabulary analysis
 * - GET /controversial    — Most controversial/disputed reasoning
 * - GET /exemplars        — Best and worst reasoning examples
 * - GET /intent-analysis  — Deep intent classification analysis
 * - GET /agent-style      — Writing style comparison between agents
 */

import { Hono } from "hono";
import { db } from "../db/index.ts";
import { tradeJustifications } from "../db/schema/trade-reasoning.ts";
import { desc, sql, eq, and, gte, lte } from "drizzle-orm";
import { apiError } from "../lib/errors.ts";

export const reasoningExplorerRoutes = new Hono();

// ---------------------------------------------------------------------------
// In-memory index for fast text search
// ---------------------------------------------------------------------------

interface IndexedReasoning {
  id: string;
  agentId: string;
  action: string;
  symbol: string;
  reasoning: string;
  confidence: number;
  coherenceScore: number;
  intent: string;
  wordCount: number;
  timestamp: string;
  terms: Set<string>;
}

const reasoningIndex: IndexedReasoning[] = [];
const MAX_INDEX_SIZE = 1000;

/**
 * Add a reasoning entry to the search index.
 * Called by the orchestrator after each trade.
 */
export function indexReasoning(entry: Omit<IndexedReasoning, "terms" | "wordCount">): void {
  const words = entry.reasoning.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const terms = new Set(words);
  const indexed: IndexedReasoning = {
    ...entry,
    wordCount: words.length,
    terms,
  };
  reasoningIndex.unshift(indexed);
  if (reasoningIndex.length > MAX_INDEX_SIZE) {
    reasoningIndex.length = MAX_INDEX_SIZE;
  }
}

// ---------------------------------------------------------------------------
// GET /search — Full-text search
// ---------------------------------------------------------------------------

reasoningExplorerRoutes.get("/search", async (c) => {
  const query = c.req.query("q") ?? "";
  const agentFilter = c.req.query("agent");
  const actionFilter = c.req.query("action");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10), 100);

  if (!query || query.length < 2) {
    return apiError(c, "VALIDATION_FAILED", "Query must be at least 2 characters");
  }

  const queryTerms = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);

  // Search in-memory index
  const scored = reasoningIndex
    .filter((entry) => {
      if (agentFilter && entry.agentId !== agentFilter) return false;
      if (actionFilter && entry.action !== actionFilter) return false;
      return true;
    })
    .map((entry) => {
      // TF-IDF-lite scoring: count matching terms weighted by rarity
      let score = 0;
      for (const qt of queryTerms) {
        if (entry.terms.has(qt)) {
          score += 1;
        }
        // Partial match bonus
        for (const t of entry.terms) {
          if (t.includes(qt) && t !== qt) {
            score += 0.5;
          }
        }
      }
      // Boost exact phrase match
      if (entry.reasoning.toLowerCase().includes(query.toLowerCase())) {
        score += queryTerms.length * 2;
      }
      return { entry, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  // Also try DB search for broader results
  let dbResults: { id: string; agentId: string; action: string; symbol: string; reasoning: string; confidence: number | null; coherenceScore: number | null; intent: string; timestamp: Date | null }[] = [];
  try {
    dbResults = await db
      .select({
        id: tradeJustifications.id,
        agentId: tradeJustifications.agentId,
        action: tradeJustifications.action,
        symbol: tradeJustifications.symbol,
        reasoning: tradeJustifications.reasoning,
        confidence: tradeJustifications.confidence,
        coherenceScore: tradeJustifications.coherenceScore,
        intent: tradeJustifications.intent,
        timestamp: tradeJustifications.timestamp,
      })
      .from(tradeJustifications)
      .where(sql`${tradeJustifications.reasoning} ILIKE ${"%" + query + "%"}`)
      .limit(limit);
  } catch {
    // DB search optional
  }

  // Merge results (deduplicate by ID)
  const seenIds = new Set(scored.map((s) => s.entry.id));
  const mergedResults = [
    ...scored.map((s) => ({
      id: s.entry.id,
      agentId: s.entry.agentId,
      action: s.entry.action,
      symbol: s.entry.symbol,
      reasoning: s.entry.reasoning,
      confidence: s.entry.confidence,
      coherenceScore: s.entry.coherenceScore,
      intent: s.entry.intent,
      relevanceScore: Math.round(s.score * 100) / 100,
      source: "index" as const,
    })),
    ...dbResults
      .filter((r) => !seenIds.has(r.id))
      .map((r) => ({
        id: r.id,
        agentId: r.agentId,
        action: r.action,
        symbol: r.symbol,
        reasoning: r.reasoning,
        confidence: r.confidence ?? 0,
        coherenceScore: r.coherenceScore ?? 0,
        intent: r.intent,
        relevanceScore: 1,
        source: "database" as const,
      })),
  ];

  return c.json({
    ok: true,
    query,
    results: mergedResults.slice(0, limit),
    total: mergedResults.length,
  });
});

// ---------------------------------------------------------------------------
// GET /similar/:id — Find similar reasoning
// ---------------------------------------------------------------------------

reasoningExplorerRoutes.get("/similar/:id", (c) => {
  const targetId = c.req.param("id");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "5", 10), 20);

  const target = reasoningIndex.find((e) => e.id === targetId);
  if (!target) {
    return apiError(c, "REASONING_NOT_FOUND", "Reasoning not found in index");
  }

  // Compute Jaccard similarity with all other entries
  const similarities = reasoningIndex
    .filter((e) => e.id !== targetId)
    .map((entry) => {
      let intersection = 0;
      for (const t of target.terms) {
        if (entry.terms.has(t)) intersection++;
      }
      const union = target.terms.size + entry.terms.size - intersection;
      const similarity = union > 0 ? intersection / union : 0;

      return { entry, similarity };
    })
    .filter((s) => s.similarity > 0.1)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

  return c.json({
    ok: true,
    target: {
      id: target.id,
      agentId: target.agentId,
      action: target.action,
      symbol: target.symbol,
      reasoning: target.reasoning.slice(0, 300),
    },
    similar: similarities.map((s) => ({
      id: s.entry.id,
      agentId: s.entry.agentId,
      action: s.entry.action,
      symbol: s.entry.symbol,
      reasoning: s.entry.reasoning.slice(0, 300),
      similarity: Math.round(s.similarity * 1000) / 1000,
      sameAction: s.entry.action === target.action,
      sameSymbol: s.entry.symbol === target.symbol,
    })),
  });
});

// ---------------------------------------------------------------------------
// GET /trends — Reasoning quality trends
// ---------------------------------------------------------------------------

reasoningExplorerRoutes.get("/trends", async (c) => {
  const agentId = c.req.query("agent");

  try {
    const conditions = [];
    if (agentId) {
      conditions.push(eq(tradeJustifications.agentId, agentId));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get daily averages
    const dailyStats = await db
      .select({
        date: sql<string>`date_trunc('day', ${tradeJustifications.timestamp})::text`,
        avgCoherence: sql<number>`avg(${tradeJustifications.coherenceScore})`,
        avgConfidence: sql<number>`avg(${tradeJustifications.confidence})`,
        tradeCount: sql<number>`count(*)`,
        hallucinationCount: sql<number>`count(*) filter (where jsonb_array_length(${tradeJustifications.hallucinationFlags}) > 0)`,
      })
      .from(tradeJustifications)
      .where(whereClause)
      .groupBy(sql`date_trunc('day', ${tradeJustifications.timestamp})`)
      .orderBy(sql`date_trunc('day', ${tradeJustifications.timestamp})`);

    const trends = dailyStats.map((d: typeof dailyStats[0]) => ({
      date: d.date,
      avgCoherence: Math.round((Number(d.avgCoherence) || 0) * 1000) / 1000,
      avgConfidence: Math.round((Number(d.avgConfidence) || 0) * 1000) / 1000,
      tradeCount: Number(d.tradeCount),
      hallucinationRate: Number(d.tradeCount) > 0
        ? Math.round((Number(d.hallucinationCount) / Number(d.tradeCount)) * 1000) / 1000
        : 0,
    }));

    return c.json({
      ok: true,
      agent: agentId ?? "all",
      trends,
      datapoints: trends.length,
    });
  } catch {
    // Fall back to in-memory index
    const filtered = agentId
      ? reasoningIndex.filter((e) => e.agentId === agentId)
      : reasoningIndex;

    // Group by date
    const byDate = new Map<string, IndexedReasoning[]>();
    for (const entry of filtered) {
      const date = entry.timestamp.split("T")[0];
      const list = byDate.get(date) ?? [];
      list.push(entry);
      byDate.set(date, list);
    }

    const trends = Array.from(byDate.entries()).map(([date, entries]) => ({
      date,
      avgCoherence: Math.round((entries.reduce((s, e) => s + e.coherenceScore, 0) / entries.length) * 1000) / 1000,
      avgConfidence: Math.round((entries.reduce((s, e) => s + e.confidence, 0) / entries.length) * 1000) / 1000,
      tradeCount: entries.length,
    }));

    return c.json({
      ok: true,
      agent: agentId ?? "all",
      trends: trends.sort((a, b) => a.date.localeCompare(b.date)),
      datapoints: trends.length,
      source: "cache",
    });
  }
});

// ---------------------------------------------------------------------------
// GET /vocabulary — Agent vocabulary analysis
// ---------------------------------------------------------------------------

reasoningExplorerRoutes.get("/vocabulary", (c) => {
  const agentId = c.req.query("agent");

  const filtered = agentId
    ? reasoningIndex.filter((e) => e.agentId === agentId)
    : reasoningIndex;

  if (filtered.length === 0) {
    return c.json({ ok: true, agent: agentId ?? "all", vocabulary: [], uniqueTerms: 0 });
  }

  // Word frequency analysis
  const wordFreq = new Map<string, number>();
  const stopWords = new Set([
    "the", "and", "for", "that", "with", "this", "from", "are", "was", "has",
    "its", "have", "will", "can", "but", "not", "all", "our", "more", "been",
    "than", "into", "also", "may", "which", "would", "could", "should",
  ]);

  for (const entry of filtered) {
    const words = entry.reasoning.toLowerCase().split(/\s+/).filter((w) =>
      w.length > 3 && !stopWords.has(w) && !/^\d+\.?\d*%?$/.test(w),
    );
    for (const word of words) {
      wordFreq.set(word, (wordFreq.get(word) ?? 0) + 1);
    }
  }

  const sorted = Array.from(wordFreq.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 50);

  // Compute uniqueness ratio per agent
  const agentVocab: Record<string, { uniqueTerms: number; totalWords: number; ratio: number }> = {};
  const agentGroups = new Map<string, IndexedReasoning[]>();
  for (const entry of reasoningIndex) {
    const list = agentGroups.get(entry.agentId) ?? [];
    list.push(entry);
    agentGroups.set(entry.agentId, list);
  }

  for (const [aid, entries] of agentGroups) {
    const allTerms = new Set<string>();
    let totalWords = 0;
    for (const entry of entries) {
      const words = entry.reasoning.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      totalWords += words.length;
      for (const w of words) allTerms.add(w);
    }
    agentVocab[aid] = {
      uniqueTerms: allTerms.size,
      totalWords,
      ratio: totalWords > 0 ? Math.round((allTerms.size / totalWords) * 1000) / 1000 : 0,
    };
  }

  return c.json({
    ok: true,
    agent: agentId ?? "all",
    topTerms: sorted.map(([word, count]) => ({ word, count })),
    uniqueTerms: wordFreq.size,
    totalReasonings: filtered.length,
    agentVocabularyStats: agentVocab,
  });
});

// ---------------------------------------------------------------------------
// GET /controversial — Most disputed reasoning
// ---------------------------------------------------------------------------

reasoningExplorerRoutes.get("/controversial", async (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "10", 10), 50);

  try {
    // Find trades where agents disagreed on the same symbol in the same round
    const controversial = await db
      .select({
        roundId: tradeJustifications.roundId,
        symbol: tradeJustifications.symbol,
        actionCount: sql<number>`count(distinct ${tradeJustifications.action})`,
        tradeCount: sql<number>`count(*)`,
        avgCoherence: sql<number>`avg(${tradeJustifications.coherenceScore})`,
      })
      .from(tradeJustifications)
      .groupBy(tradeJustifications.roundId, tradeJustifications.symbol)
      .having(sql`count(distinct ${tradeJustifications.action}) > 1`)
      .orderBy(desc(sql`count(distinct ${tradeJustifications.action})`))
      .limit(limit);

    // For each controversial round/symbol, get the actual reasoning
    const detailed = [];
    for (const entry of controversial) {
      if (!entry.roundId) continue;

      const reasonings = await db
        .select({
          agentId: tradeJustifications.agentId,
          action: tradeJustifications.action,
          reasoning: tradeJustifications.reasoning,
          confidence: tradeJustifications.confidence,
          coherenceScore: tradeJustifications.coherenceScore,
          intent: tradeJustifications.intent,
        })
        .from(tradeJustifications)
        .where(and(
          eq(tradeJustifications.roundId, entry.roundId),
          eq(tradeJustifications.symbol, entry.symbol),
        ))
        .limit(5);

      detailed.push({
        roundId: entry.roundId,
        symbol: entry.symbol,
        distinctActions: Number(entry.actionCount),
        avgCoherence: Math.round((Number(entry.avgCoherence) || 0) * 100) / 100,
        reasonings: reasonings.map((r: typeof reasonings[0]) => ({
          agentId: r.agentId,
          action: r.action,
          reasoning: r.reasoning.slice(0, 300),
          confidence: r.confidence,
          coherenceScore: r.coherenceScore,
          intent: r.intent,
        })),
      });
    }

    return c.json({
      ok: true,
      controversial: detailed,
      total: controversial.length,
      description: "Rounds where agents took opposing actions on the same stock",
    });
  } catch {
    return c.json({ ok: true, controversial: [], total: 0, source: "cache" });
  }
});

// ---------------------------------------------------------------------------
// GET /exemplars — Best and worst reasoning examples
// ---------------------------------------------------------------------------

reasoningExplorerRoutes.get("/exemplars", async (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "5", 10), 20);

  try {
    // Best reasoning (highest coherence)
    const best = await db
      .select({
        id: tradeJustifications.id,
        agentId: tradeJustifications.agentId,
        action: tradeJustifications.action,
        symbol: tradeJustifications.symbol,
        reasoning: tradeJustifications.reasoning,
        confidence: tradeJustifications.confidence,
        coherenceScore: tradeJustifications.coherenceScore,
        intent: tradeJustifications.intent,
      })
      .from(tradeJustifications)
      .orderBy(desc(tradeJustifications.coherenceScore))
      .limit(limit);

    // Worst reasoning (lowest coherence, non-zero)
    const worst = await db
      .select({
        id: tradeJustifications.id,
        agentId: tradeJustifications.agentId,
        action: tradeJustifications.action,
        symbol: tradeJustifications.symbol,
        reasoning: tradeJustifications.reasoning,
        confidence: tradeJustifications.confidence,
        coherenceScore: tradeJustifications.coherenceScore,
        intent: tradeJustifications.intent,
      })
      .from(tradeJustifications)
      .where(gte(tradeJustifications.coherenceScore, 0.01))
      .orderBy(tradeJustifications.coherenceScore)
      .limit(limit);

    // Most verbose
    const verbose = await db
      .select({
        id: tradeJustifications.id,
        agentId: tradeJustifications.agentId,
        action: tradeJustifications.action,
        symbol: tradeJustifications.symbol,
        reasoning: tradeJustifications.reasoning,
        coherenceScore: tradeJustifications.coherenceScore,
      })
      .from(tradeJustifications)
      .orderBy(desc(sql`length(${tradeJustifications.reasoning})`))
      .limit(limit);

    return c.json({
      ok: true,
      bestReasoning: best.map((r: typeof best[0]) => ({
        ...r,
        reasoning: r.reasoning.slice(0, 500),
        wordCount: r.reasoning.split(/\s+/).length,
      })),
      worstReasoning: worst.map((r: typeof worst[0]) => ({
        ...r,
        reasoning: r.reasoning.slice(0, 500),
        wordCount: r.reasoning.split(/\s+/).length,
      })),
      mostVerbose: verbose.map((r: typeof verbose[0]) => ({
        id: r.id,
        agentId: r.agentId,
        action: r.action,
        symbol: r.symbol,
        coherenceScore: r.coherenceScore,
        wordCount: r.reasoning.split(/\s+/).length,
        preview: r.reasoning.slice(0, 200),
      })),
    });
  } catch {
    return c.json({ ok: true, bestReasoning: [], worstReasoning: [], mostVerbose: [], source: "cache" });
  }
});

// ---------------------------------------------------------------------------
// GET /intent-analysis — Deep intent classification analysis
// ---------------------------------------------------------------------------

reasoningExplorerRoutes.get("/intent-analysis", async (c) => {
  try {
    const intentStats = await db
      .select({
        intent: tradeJustifications.intent,
        agentId: tradeJustifications.agentId,
        count: sql<number>`count(*)`,
        avgCoherence: sql<number>`avg(${tradeJustifications.coherenceScore})`,
        avgConfidence: sql<number>`avg(${tradeJustifications.confidence})`,
        buyCount: sql<number>`count(*) filter (where ${tradeJustifications.action} = 'buy')`,
        sellCount: sql<number>`count(*) filter (where ${tradeJustifications.action} = 'sell')`,
        holdCount: sql<number>`count(*) filter (where ${tradeJustifications.action} = 'hold')`,
      })
      .from(tradeJustifications)
      .groupBy(tradeJustifications.intent, tradeJustifications.agentId);

    // Pivot by intent
    const byIntent: Record<string, {
      total: number;
      byAgent: Record<string, number>;
      avgCoherence: number;
      avgConfidence: number;
      actionMix: { buy: number; sell: number; hold: number };
    }> = {};

    for (const row of intentStats) {
      const intent = row.intent;
      if (!byIntent[intent]) {
        byIntent[intent] = {
          total: 0,
          byAgent: {},
          avgCoherence: 0,
          avgConfidence: 0,
          actionMix: { buy: 0, sell: 0, hold: 0 },
        };
      }
      const cnt = Number(row.count);
      byIntent[intent].total += cnt;
      byIntent[intent].byAgent[row.agentId] = cnt;
      byIntent[intent].actionMix.buy += Number(row.buyCount);
      byIntent[intent].actionMix.sell += Number(row.sellCount);
      byIntent[intent].actionMix.hold += Number(row.holdCount);
    }

    // Compute weighted averages
    for (const intent of Object.keys(byIntent)) {
      const rows = intentStats.filter((r: typeof intentStats[0]) => r.intent === intent);
      const totalCount = rows.reduce((s: number, r: typeof rows[0]) => s + Number(r.count), 0);
      byIntent[intent].avgCoherence = totalCount > 0
        ? Math.round(rows.reduce((s: number, r: typeof rows[0]) => s + Number(r.avgCoherence ?? 0) * Number(r.count), 0) / totalCount * 1000) / 1000
        : 0;
      byIntent[intent].avgConfidence = totalCount > 0
        ? Math.round(rows.reduce((s: number, r: typeof rows[0]) => s + Number(r.avgConfidence ?? 0) * Number(r.count), 0) / totalCount * 1000) / 1000
        : 0;
    }

    return c.json({
      ok: true,
      intents: byIntent,
      validIntents: ["momentum", "mean_reversion", "value", "hedge", "contrarian", "arbitrage"],
    });
  } catch {
    return c.json({ ok: true, intents: {}, source: "cache" });
  }
});

// ---------------------------------------------------------------------------
// GET /agent-style — Writing style comparison
// ---------------------------------------------------------------------------

reasoningExplorerRoutes.get("/agent-style", (c) => {
  const agentGroups = new Map<string, IndexedReasoning[]>();
  for (const entry of reasoningIndex) {
    const list = agentGroups.get(entry.agentId) ?? [];
    list.push(entry);
    agentGroups.set(entry.agentId, list);
  }

  const styles: Record<string, {
    avgWordCount: number;
    avgSentenceLength: number;
    questionFrequency: number;
    hedgingFrequency: number;
    assertiveFrequency: number;
    dataReferenceRate: number;
    avgCoherence: number;
    sampleCount: number;
  }> = {};

  for (const [agentId, entries] of agentGroups) {
    const wordCounts = entries.map((e) => e.wordCount);
    const avgWordCount = wordCounts.reduce((s, v) => s + v, 0) / entries.length;

    let totalSentences = 0;
    let totalQuestions = 0;
    let totalHedging = 0;
    let totalAssertive = 0;
    let totalDataRef = 0;

    for (const entry of entries) {
      const sentences = entry.reasoning.split(/[.!?]+/).filter((s) => s.trim().length > 3);
      totalSentences += sentences.length;
      totalQuestions += (entry.reasoning.match(/\?/g) ?? []).length;
      totalHedging += (entry.reasoning.match(/\b(might|could|possibly|perhaps|maybe|uncertain)\b/gi) ?? []).length;
      totalAssertive += (entry.reasoning.match(/\b(clearly|definitely|certainly|strongly|must|should)\b/gi) ?? []).length;
      totalDataRef += (entry.reasoning.match(/\$\d|%|\d+\.\d/g) ?? []).length;
    }

    const avgSentenceLength = totalSentences > 0
      ? wordCounts.reduce((s, v) => s + v, 0) / totalSentences
      : 0;

    styles[agentId] = {
      avgWordCount: Math.round(avgWordCount),
      avgSentenceLength: Math.round(avgSentenceLength * 10) / 10,
      questionFrequency: Math.round((totalQuestions / entries.length) * 100) / 100,
      hedgingFrequency: Math.round((totalHedging / entries.length) * 100) / 100,
      assertiveFrequency: Math.round((totalAssertive / entries.length) * 100) / 100,
      dataReferenceRate: Math.round((totalDataRef / entries.length) * 100) / 100,
      avgCoherence: Math.round((entries.reduce((s, e) => s + e.coherenceScore, 0) / entries.length) * 1000) / 1000,
      sampleCount: entries.length,
    };
  }

  return c.json({
    ok: true,
    agentStyles: styles,
    interpretation: {
      avgWordCount: "Average words per reasoning — longer may indicate deeper analysis",
      questionFrequency: "How often the agent asks questions in its reasoning",
      hedgingFrequency: "Use of uncertain language (might, could, possibly)",
      assertiveFrequency: "Use of confident language (clearly, definitely, must)",
      dataReferenceRate: "How often the agent cites specific numbers/data",
    },
  });
});
