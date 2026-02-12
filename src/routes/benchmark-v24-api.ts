/**
 * Benchmark v24 API — Reasoning Depth & Source Quality Engine
 *
 * Researcher-facing API for the v24 8-dimension benchmark:
 *   P&L | Coherence | Hallucination | Discipline | Calibration | Prediction | Depth | Source Quality
 *
 * Routes:
 *   GET  /leaderboard      — v24 8-dimension leaderboard
 *   GET  /agent/:id        — Agent's v24 detail profile
 *   GET  /depth-analysis   — Reasoning depth data for all agents
 *   GET  /source-analysis  — Source quality data for all agents
 *   GET  /round/:roundId   — Per-round v24 breakdown
 *   GET  /export/jsonl     — JSONL export for researchers
 *   GET  /export/csv       — CSV export for researchers
 *   POST /analyze          — Analyze arbitrary reasoning text
 */

import { Hono } from "hono";
import { db } from "../db/index.ts";
import {
  reasoningDepthAnalysis,
  sourceQualityAnalysis,
  benchmarkLeaderboardV24,
  benchmarkRoundSnapshotsV24,
} from "../db/schema/benchmark-v24.ts";
import { tradeJustifications } from "../db/schema/trade-reasoning.ts";
import { eq, desc, sql, and, gte, lte } from "drizzle-orm";
import { round2 } from "../lib/math-utils.ts";
import {
  analyzeReasoningDepthV24,
  analyzeSourceQualityV24,
  runV24Analysis,
  computeV24CompositeScore,
} from "../services/reasoning-depth-quality-engine.ts";

export const benchmarkV24ApiRoutes = new Hono();

// ---------------------------------------------------------------------------
// In-memory leaderboard cache
// ---------------------------------------------------------------------------

interface V24LeaderboardEntry {
  agentId: string;
  compositeScore: number;
  grade: string;
  rank: number;
  dimensions: {
    pnl: number;
    coherence: number;
    hallucinationFree: number;
    discipline: number;
    calibration: number;
    prediction: number;
    reasoningDepth: number;
    sourceQuality: number;
  };
  tradeCount: number;
  updatedAt: string;
}

const leaderboardCache: V24LeaderboardEntry[] = [];
const depthCache = new Map<string, { scores: number[]; patterns: Map<string, number> }>();
const sourceCache = new Map<string, { scores: number[]; categories: Map<string, number> }>();

/**
 * Record a v24 analysis result into the cache.
 * Called by the orchestrator after each trade.
 */
export function recordV24Metrics(
  agentId: string,
  justificationId: string,
  depth: ReturnType<typeof analyzeReasoningDepthV24>,
  sourceQuality: ReturnType<typeof analyzeSourceQualityV24>,
): void {
  // Update depth cache
  const depthEntry = depthCache.get(agentId) ?? { scores: [] as number[], patterns: new Map<string, number>() };
  depthEntry.scores.push(depth.depthScore);
  if (depthEntry.scores.length > 500) depthEntry.scores.shift();
  const patternCount = depthEntry.patterns.get(depth.reasoningPattern) ?? 0;
  depthEntry.patterns.set(depth.reasoningPattern, patternCount + 1);
  depthCache.set(agentId, depthEntry);

  // Update source cache
  const srcEntry = sourceCache.get(agentId) ?? { scores: [] as number[], categories: new Map<string, number>() };
  srcEntry.scores.push(sourceQuality.qualityScore);
  if (srcEntry.scores.length > 500) srcEntry.scores.shift();
  for (const cat of sourceQuality.sourceCategories) {
    const catCount = srcEntry.categories.get(cat) ?? 0;
    srcEntry.categories.set(cat, catCount + 1);
  }
  sourceCache.set(agentId, srcEntry);

  // Persist to DB (fire and forget)
  const depthId = `rd24_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const srcId = `sq24_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  db.insert(reasoningDepthAnalysis)
    .values({
      id: depthId,
      justificationId,
      agentId,
      depthScore: depth.depthScore,
      stepCount: depth.stepCount,
      connectiveDensity: depth.connectiveDensity,
      evidenceAnchoringScore: depth.evidenceAnchoringScore,
      counterArgumentScore: depth.counterArgumentScore,
      conclusionClarity: depth.conclusionClarity,
      wordCount: depth.wordCount,
      vocabularyRichness: depth.vocabularyRichness,
      reasoningPattern: depth.reasoningPattern,
    })
    .catch(() => {});

  db.insert(sourceQualityAnalysis)
    .values({
      id: srcId,
      justificationId,
      agentId,
      qualityScore: sourceQuality.qualityScore,
      sourceCount: sourceQuality.sourceCount,
      diversityScore: sourceQuality.diversityScore,
      specificityScore: sourceQuality.specificityScore,
      crossReferenceScore: sourceQuality.crossReferenceScore,
      integrationScore: sourceQuality.integrationScore,
      sourceCategories: sourceQuality.sourceCategories,
    })
    .catch(() => {});
}

/**
 * Update the v24 leaderboard for a specific agent.
 */
export function updateV24Leaderboard(
  agentId: string,
  metrics: {
    pnlPercent?: number;
    avgCoherence?: number;
    hallucinationFreeRate?: number;
    disciplineRate?: number;
    calibrationScore?: number;
    predictionAccuracy?: number;
    tradeCount?: number;
  },
): void {
  const depthEntry = depthCache.get(agentId);
  const srcEntry = sourceCache.get(agentId);

  const avgDepth = depthEntry && depthEntry.scores.length > 0
    ? depthEntry.scores.reduce((a, b) => a + b, 0) / depthEntry.scores.length
    : 0.5;

  const avgSourceQuality = srcEntry && srcEntry.scores.length > 0
    ? srcEntry.scores.reduce((a, b) => a + b, 0) / srcEntry.scores.length
    : 0.5;

  const { composite, grade } = computeV24CompositeScore({
    pnlPercent: metrics.pnlPercent ?? 0,
    coherenceScore: metrics.avgCoherence ?? 0.5,
    hallucinationFreeRate: metrics.hallucinationFreeRate ?? 0.9,
    disciplineRate: metrics.disciplineRate ?? 0.9,
    calibrationScore: metrics.calibrationScore ?? 0.3,
    predictionAccuracy: metrics.predictionAccuracy ?? 0.5,
    reasoningDepthScore: avgDepth,
    sourceQualityScore: avgSourceQuality,
  });

  // Update or insert into cache
  const existing = leaderboardCache.findIndex((e) => e.agentId === agentId);
  const entry: V24LeaderboardEntry = {
    agentId,
    compositeScore: composite,
    grade,
    rank: 0,
    dimensions: {
      pnl: metrics.pnlPercent ?? 0,
      coherence: round2(metrics.avgCoherence ?? 0.5),
      hallucinationFree: round2(metrics.hallucinationFreeRate ?? 0.9),
      discipline: round2(metrics.disciplineRate ?? 0.9),
      calibration: round2(metrics.calibrationScore ?? 0.3),
      prediction: round2(metrics.predictionAccuracy ?? 0.5),
      reasoningDepth: round2(avgDepth),
      sourceQuality: round2(avgSourceQuality),
    },
    tradeCount: metrics.tradeCount ?? 0,
    updatedAt: new Date().toISOString(),
  };

  if (existing >= 0) {
    leaderboardCache[existing] = entry;
  } else {
    leaderboardCache.push(entry);
  }

  // Re-rank
  leaderboardCache.sort((a, b) => b.compositeScore - a.compositeScore);
  leaderboardCache.forEach((e, i) => {
    e.rank = i + 1;
  });

  // Persist to DB (fire and forget)
  const leaderboardId = `lb24_${agentId}`;
  db.insert(benchmarkLeaderboardV24)
    .values({
      id: leaderboardId,
      agentId,
      compositeScore: composite,
      pnlPercent: metrics.pnlPercent ?? 0,
      avgCoherence: metrics.avgCoherence ?? 0.5,
      hallucinationFreeRate: metrics.hallucinationFreeRate ?? 0.9,
      disciplineRate: metrics.disciplineRate ?? 0.9,
      calibrationScore: metrics.calibrationScore ?? 0.3,
      predictionAccuracy: metrics.predictionAccuracy ?? 0.5,
      avgReasoningDepth: avgDepth,
      avgSourceQuality: avgSourceQuality,
      tradeCount: metrics.tradeCount ?? 0,
      rank: entry.rank,
      grade,
    })
    .onConflictDoNothing()
    .catch(() => {});
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /leaderboard — v24 8-dimension leaderboard
 */
benchmarkV24ApiRoutes.get("/leaderboard", async (c) => {
  // Try DB first, fall back to cache
  try {
    const rows = await db
      .select()
      .from(benchmarkLeaderboardV24)
      .orderBy(desc(benchmarkLeaderboardV24.compositeScore))
      .limit(50);

    if (rows.length > 0) {
      return c.json({
        ok: true,
        version: "v24",
        dimensions: 8,
        leaderboard: rows.map((r: typeof rows[number], i: number) => ({
          rank: i + 1,
          agentId: r.agentId,
          compositeScore: r.compositeScore,
          grade: r.grade,
          dimensions: {
            pnl: r.pnlPercent,
            coherence: r.avgCoherence,
            hallucinationFree: r.hallucinationFreeRate,
            discipline: r.disciplineRate,
            calibration: r.calibrationScore,
            prediction: r.predictionAccuracy,
            reasoningDepth: r.avgReasoningDepth,
            sourceQuality: r.avgSourceQuality,
          },
          tradeCount: r.tradeCount,
        })),
        source: "database",
      });
    }
  } catch {
    // Fall through to cache
  }

  return c.json({
    ok: true,
    version: "v24",
    dimensions: 8,
    leaderboard: leaderboardCache,
    source: "cache",
  });
});

/**
 * GET /agent/:id — Agent's v24 detail profile
 */
benchmarkV24ApiRoutes.get("/agent/:id", async (c) => {
  const agentId = c.req.param("id");
  const cached = leaderboardCache.find((e) => e.agentId === agentId);
  const depthData = depthCache.get(agentId);
  const srcData = sourceCache.get(agentId);

  // Get reasoning pattern distribution
  const patternDist: Record<string, number> = {};
  if (depthData) {
    for (const [pattern, count] of depthData.patterns) {
      patternDist[pattern] = count;
    }
  }

  // Get source category distribution
  const categoryDist: Record<string, number> = {};
  if (srcData) {
    for (const [cat, count] of srcData.categories) {
      categoryDist[cat] = count;
    }
  }

  return c.json({
    ok: true,
    agentId,
    v24Profile: cached ?? null,
    reasoningDepthProfile: {
      avgScore: depthData
        ? round2(depthData.scores.reduce((a, b) => a + b, 0) / depthData.scores.length)
        : null,
      sampleCount: depthData?.scores.length ?? 0,
      patternDistribution: patternDist,
      recentScores: depthData?.scores.slice(-20) ?? [],
    },
    sourceQualityProfile: {
      avgScore: srcData
        ? round2(srcData.scores.reduce((a, b) => a + b, 0) / srcData.scores.length)
        : null,
      sampleCount: srcData?.scores.length ?? 0,
      categoryDistribution: categoryDist,
      recentScores: srcData?.scores.slice(-20) ?? [],
    },
  });
});

/**
 * GET /depth-analysis — Reasoning depth data for all agents
 */
benchmarkV24ApiRoutes.get("/depth-analysis", async (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 200);

  try {
    const rows = await db
      .select()
      .from(reasoningDepthAnalysis)
      .orderBy(desc(reasoningDepthAnalysis.analyzedAt))
      .limit(limit);

    return c.json({ ok: true, analysis: rows, source: "database" });
  } catch {
    // Return from cache
    const allEntries: Array<{
      agentId: string;
      avgDepth: number;
      tradeCount: number;
      topPattern: string;
    }> = [];

    for (const [agentId, data] of depthCache) {
      const avg = data.scores.reduce((a, b) => a + b, 0) / data.scores.length;
      let topPattern = "general";
      let topCount = 0;
      for (const [p, c] of data.patterns) {
        if (c > topCount) { topPattern = p; topCount = c; }
      }
      allEntries.push({
        agentId,
        avgDepth: round2(avg),
        tradeCount: data.scores.length,
        topPattern,
      });
    }

    return c.json({ ok: true, analysis: allEntries, source: "cache" });
  }
});

/**
 * GET /source-analysis — Source quality data for all agents
 */
benchmarkV24ApiRoutes.get("/source-analysis", async (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 200);

  try {
    const rows = await db
      .select()
      .from(sourceQualityAnalysis)
      .orderBy(desc(sourceQualityAnalysis.analyzedAt))
      .limit(limit);

    return c.json({ ok: true, analysis: rows, source: "database" });
  } catch {
    const allEntries: Array<{
      agentId: string;
      avgQuality: number;
      tradeCount: number;
      topCategories: string[];
    }> = [];

    for (const [agentId, data] of sourceCache) {
      const avg = data.scores.reduce((a, b) => a + b, 0) / data.scores.length;
      const sorted = [...data.categories.entries()].sort((a, b) => b[1] - a[1]);
      allEntries.push({
        agentId,
        avgQuality: round2(avg),
        tradeCount: data.scores.length,
        topCategories: sorted.slice(0, 5).map(([c]) => c),
      });
    }

    return c.json({ ok: true, analysis: allEntries, source: "cache" });
  }
});

/**
 * GET /export/jsonl — JSONL export for researchers
 */
benchmarkV24ApiRoutes.get("/export/jsonl", async (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "500", 10), 5000);

  try {
    const justifications = await db
      .select()
      .from(tradeJustifications)
      .orderBy(desc(tradeJustifications.timestamp))
      .limit(limit);

    const lines: string[] = [];

    for (const j of justifications) {
      const { depth, sourceQuality } = runV24Analysis(
        j.reasoning,
        (j.sources as string[]) ?? [],
      );

      lines.push(JSON.stringify({
        agent_id: j.agentId,
        round_id: j.roundId,
        timestamp: j.timestamp?.toISOString(),
        action: j.action,
        symbol: j.symbol,
        quantity: j.quantity,
        reasoning: j.reasoning,
        confidence: j.confidence,
        sources: j.sources,
        intent: j.intent,
        coherence_score: j.coherenceScore,
        hallucination_flags: j.hallucinationFlags,
        discipline_pass: j.disciplinePass === "pass",
        // v24 new fields
        reasoning_depth_score: depth.depthScore,
        step_count: depth.stepCount,
        connective_density: depth.connectiveDensity,
        evidence_anchoring: depth.evidenceAnchoringScore,
        counter_argument_score: depth.counterArgumentScore,
        reasoning_pattern: depth.reasoningPattern,
        source_quality_score: sourceQuality.qualityScore,
        source_diversity: sourceQuality.diversityScore,
        source_specificity: sourceQuality.specificityScore,
        source_cross_reference: sourceQuality.crossReferenceScore,
        source_integration: sourceQuality.integrationScore,
        source_categories: sourceQuality.sourceCategories,
      }));
    }

    c.header("Content-Type", "application/jsonl");
    c.header("Content-Disposition", `attachment; filename="moltapp-v24-benchmark.jsonl"`);
    return c.body(lines.join("\n") + "\n");
  } catch {
    return c.json({ ok: false, error: "Export failed — database unavailable" }, 500);
  }
});

/**
 * GET /export/csv — CSV export for researchers
 */
benchmarkV24ApiRoutes.get("/export/csv", async (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "500", 10), 5000);

  try {
    const justifications = await db
      .select()
      .from(tradeJustifications)
      .orderBy(desc(tradeJustifications.timestamp))
      .limit(limit);

    const headers = [
      "agent_id", "round_id", "timestamp", "action", "symbol", "quantity",
      "confidence", "intent", "coherence_score", "discipline_pass",
      "reasoning_depth_score", "step_count", "connective_density",
      "evidence_anchoring", "counter_argument_score", "reasoning_pattern",
      "source_quality_score", "source_diversity", "source_specificity",
      "source_cross_reference", "source_integration", "source_categories",
    ];

    const rows: string[] = [headers.join(",")];

    for (const j of justifications) {
      const { depth, sourceQuality } = runV24Analysis(
        j.reasoning,
        (j.sources as string[]) ?? [],
      );

      rows.push([
        j.agentId,
        j.roundId ?? "",
        j.timestamp?.toISOString() ?? "",
        j.action,
        j.symbol,
        j.quantity ?? 0,
        j.confidence,
        j.intent,
        j.coherenceScore ?? 0,
        j.disciplinePass === "pass" ? 1 : 0,
        depth.depthScore,
        depth.stepCount,
        depth.connectiveDensity,
        depth.evidenceAnchoringScore,
        depth.counterArgumentScore,
        `"${depth.reasoningPattern}"`,
        sourceQuality.qualityScore,
        sourceQuality.diversityScore,
        sourceQuality.specificityScore,
        sourceQuality.crossReferenceScore,
        sourceQuality.integrationScore,
        `"${sourceQuality.sourceCategories.join(";")}"`,
      ].join(","));
    }

    c.header("Content-Type", "text/csv");
    c.header("Content-Disposition", `attachment; filename="moltapp-v24-benchmark.csv"`);
    return c.body(rows.join("\n") + "\n");
  } catch {
    return c.json({ ok: false, error: "Export failed — database unavailable" }, 500);
  }
});

/**
 * POST /analyze — Analyze arbitrary reasoning text (for external agents)
 */
benchmarkV24ApiRoutes.post("/analyze", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.reasoning || typeof body.reasoning !== "string") {
    return c.json({ ok: false, error: "Missing 'reasoning' field (string)" }, 400);
  }

  const sources: string[] = Array.isArray(body.sources)
    ? body.sources.filter((s: unknown) => typeof s === "string")
    : [];

  const result = runV24Analysis(body.reasoning, sources);

  return c.json({
    ok: true,
    v24Analysis: {
      reasoningDepth: result.depth,
      sourceQuality: result.sourceQuality,
      v24Score: result.v24Score,
      tips: generateTips(result.depth, result.sourceQuality),
    },
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateTips(
  depth: ReturnType<typeof analyzeReasoningDepthV24>,
  sourceQuality: ReturnType<typeof analyzeSourceQualityV24>,
): string[] {
  const tips: string[] = [];

  if (depth.stepCount < 3) {
    tips.push("Add more reasoning steps — break your analysis into 3+ distinct logical steps");
  }
  if (depth.connectiveDensity < 0.3) {
    tips.push("Use more logical connectives (therefore, because, however) to show reasoning flow");
  }
  if (depth.evidenceAnchoringScore < 0.5) {
    tips.push("Reference specific data points ($178.50, +3.2%, RSI at 62) to anchor your reasoning");
  }
  if (depth.counterArgumentScore < 0.3) {
    tips.push("Consider counter-arguments and risks — what could go wrong with this trade?");
  }
  if (depth.conclusionClarity < 0.5) {
    tips.push("Make your conclusion explicit — clearly state why you're choosing this action");
  }
  if (sourceQuality.diversityScore < 0.5) {
    tips.push("Diversify your sources — use price data, volume, technicals, and fundamentals");
  }
  if (sourceQuality.specificityScore < 0.5) {
    tips.push("Cite specific values from your sources, not just general references");
  }
  if (sourceQuality.crossReferenceScore < 0.3) {
    tips.push("Cross-reference multiple sources — show how different data points align");
  }

  return tips;
}
