/**
 * Benchmark v25 API — 10-Dimension Researcher-Facing Data Export
 *
 * Routes:
 *   GET  /leaderboard      — v25 10-dimension leaderboard
 *   GET  /agent/:id        — Agent's v25 detail profile
 *   GET  /predictions      — Outcome prediction tracking data
 *   GET  /consensus        — Consensus intelligence data
 *   GET  /export/jsonl     — JSONL export for researchers
 *   GET  /export/csv       — CSV export for researchers
 *   POST /analyze          — Analyze arbitrary reasoning text
 */

import { Hono } from "hono";
import { averageByKey, countByCondition, mean, round2 } from "../lib/math-utils.ts";
import { db } from "../db/index.ts";
import { tradeJustifications } from "../db/schema/trade-reasoning.ts";
import { desc, eq } from "drizzle-orm";
import {
  computeV25CompositeScore,
  parsePrediction,
  analyzeConsensusIntelligence,
  computeMajorityAction,
  scoreOutcomePrediction,
  type V25RoundAgentData,
  type V25CompositeScore,
} from "../services/v25-benchmark-engine.ts";
import {
  analyzeReasoningDepthV24,
  analyzeSourceQualityV24,
} from "../services/reasoning-depth-quality-engine.ts";
import {
  normalizeConfidence,
  classifyIntent,
} from "../schemas/trade-reasoning.ts";
import {
  analyzeCoherence,
  detectHallucinations,
} from "../services/coherence-analyzer.ts";

export const benchmarkV25ApiRoutes = new Hono();

type JustificationRow = {
  id: string;
  tradeId: number | null;
  agentId: string;
  reasoning: string;
  confidence: number;
  sources: unknown;
  intent: string;
  predictedOutcome: string | null;
  actualOutcome: string | null;
  coherenceScore: number | null;
  hallucinationFlags: unknown;
  action: string;
  symbol: string;
  quantity: number | null;
  roundId: string | null;
  disciplinePass: string | null;
  timestamp: Date | null;
};

// ---------------------------------------------------------------------------
// In-memory caches
// ---------------------------------------------------------------------------

interface V25AgentCache {
  trades: number;
  coherence: number[];
  hallucinationFreeRates: number[];
  disciplineRates: number[];
  depthScores: number[];
  sourceQualityScores: number[];
  predictionScores: number[];
  consensusScores: number[];
  recentReasoning: string[];
  intents: Record<string, number>;
}

const agentCache = new Map<string, V25AgentCache>();
const predictionCache: Array<{
  agentId: string;
  roundId: string;
  symbol: string;
  predictedDirection: string;
  predictedMagnitude: number | null;
  timeframeSpecified: string | null;
  confidence: number;
  timestamp: string;
}> = [];
const consensusCache: Array<{
  roundId: string;
  agentId: string;
  agreedWithMajority: number;
  wasContrarian: number;
  reasoningSimilarity: number;
  independentThinkingScore: number;
  timestamp: string;
}> = [];

/**
 * Record v25 metrics from orchestrator.
 */
export function recordV25Metrics(
  roundId: string,
  agentData: V25RoundAgentData,
  allAgents: V25RoundAgentData[],
  coherenceScore: number,
  hallucinationFree: number,
  disciplinePass: boolean,
  depthScore: number,
  sourceQuality: number,
): void {
  // Prediction analysis
  const prediction = parsePrediction(agentData.reasoning, agentData.predictedOutcome);
  predictionCache.push({
    agentId: agentData.agentId,
    roundId,
    symbol: agentData.symbol,
    predictedDirection: prediction.predictedDirection,
    predictedMagnitude: prediction.predictedMagnitude,
    timeframeSpecified: prediction.timeframeSpecified,
    confidence: prediction.confidenceInPrediction,
    timestamp: new Date().toISOString(),
  });
  if (predictionCache.length > 1000) predictionCache.shift();

  // Consensus analysis
  const consensus = analyzeConsensusIntelligence(agentData, allAgents);
  consensusCache.push({
    roundId,
    agentId: agentData.agentId,
    agreedWithMajority: consensus.agreedWithMajority,
    wasContrarian: consensus.wasContrarian,
    reasoningSimilarity: consensus.reasoningSimilarity,
    independentThinkingScore: consensus.independentThinkingScore,
    timestamp: new Date().toISOString(),
  });
  if (consensusCache.length > 1000) consensusCache.shift();

  // Agent cache
  const existing = agentCache.get(agentData.agentId) ?? {
    trades: 0,
    coherence: [],
    hallucinationFreeRates: [],
    disciplineRates: [],
    depthScores: [],
    sourceQualityScores: [],
    predictionScores: [],
    consensusScores: [],
    recentReasoning: [],
    intents: {},
  };

  existing.trades++;
  existing.coherence.push(coherenceScore);
  existing.hallucinationFreeRates.push(hallucinationFree);
  existing.disciplineRates.push(disciplinePass ? 1 : 0);
  existing.depthScores.push(depthScore);
  existing.sourceQualityScores.push(sourceQuality);
  existing.predictionScores.push(prediction.confidenceInPrediction > 0 ? 0.6 : 0.3);
  existing.consensusScores.push(consensus.independentThinkingScore);
  existing.recentReasoning.unshift(agentData.reasoning.slice(0, 200));
  if (existing.recentReasoning.length > 10) existing.recentReasoning.pop();

  const intent = classifyIntent(agentData.reasoning, agentData.action);
  existing.intents[intent] = (existing.intents[intent] ?? 0) + 1;

  // Trim arrays
  const max = 500;
  for (const arr of [existing.coherence, existing.hallucinationFreeRates, existing.disciplineRates, existing.depthScores, existing.sourceQualityScores, existing.predictionScores, existing.consensusScores]) {
    if (arr.length > max) arr.shift();
  }

  agentCache.set(agentData.agentId, existing);
}


function buildLeaderboard(): Array<V25CompositeScore & { agentId: string; rank: number; tradeCount: number }> {
  const entries: Array<V25CompositeScore & { agentId: string; rank: number; tradeCount: number }> = [];

  for (const [agentId, data] of agentCache.entries()) {
    const score = computeV25CompositeScore({
      pnl: 0,
      coherence: mean(data.coherence),
      hallucinationFree: mean(data.hallucinationFreeRates),
      discipline: mean(data.disciplineRates),
      calibration: 0.5,
      prediction: 0.5,
      reasoningDepth: mean(data.depthScores),
      sourceQuality: mean(data.sourceQualityScores),
      outcomePrediction: mean(data.predictionScores),
      consensusIntelligence: mean(data.consensusScores),
    });
    entries.push({ ...score, agentId, rank: 0, tradeCount: data.trades });
  }

  entries.sort((a, b) => b.composite - a.composite);
  entries.forEach((e, i) => (e.rank = i + 1));
  return entries;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

benchmarkV25ApiRoutes.get("/leaderboard", async (c) => {
  // Try DB-backed leaderboard first
  try {
    const justifications = await db
      .select()
      .from(tradeJustifications)
      .orderBy(desc(tradeJustifications.timestamp))
      .limit(500);

    if (justifications.length > 0) {
      const agentMap = new Map<string, typeof justifications>();
      for (const j of justifications) {
        const arr = agentMap.get(j.agentId) ?? [];
        arr.push(j);
        agentMap.set(j.agentId, arr);
      }

      const entries: Array<V25CompositeScore & { agentId: string; rank: number; tradeCount: number }> = [];
      for (const [agentId, trades] of agentMap.entries()) {
        const avgCoh = trades.reduce((sum: number, t: JustificationRow) => sum + (t.coherenceScore ?? 0), 0) / trades.length;
        const hallucCount = countByCondition(trades, (t: JustificationRow) => !!(t.hallucinationFlags && (t.hallucinationFlags as string[]).length > 0));
        const hallucFree = 1 - hallucCount / trades.length;
        const discPass = countByCondition(trades, (t: JustificationRow) => t.disciplinePass !== "fail") / trades.length;

        let totalDepth = 0, totalSrc = 0, totalPred = 0;
        for (const t of trades.slice(0, 50)) {
          const d = analyzeReasoningDepthV24(t.reasoning);
          const s = analyzeSourceQualityV24(t.reasoning, (t.sources as string[]) ?? []);
          const p = parsePrediction(t.reasoning, t.predictedOutcome);
          totalDepth += d.depthScore;
          totalSrc += s.qualityScore;
          totalPred += p.confidenceInPrediction > 0 ? 0.6 : 0.3;
        }
        const n = Math.min(trades.length, 50);

        const score = computeV25CompositeScore({
          pnl: 0,
          coherence: avgCoh,
          hallucinationFree: hallucFree,
          discipline: discPass,
          calibration: 0.5,
          prediction: 0.5,
          reasoningDepth: totalDepth / n,
          sourceQuality: totalSrc / n,
          outcomePrediction: totalPred / n,
          consensusIntelligence: 0.5,
        });

        entries.push({ ...score, agentId, rank: 0, tradeCount: trades.length });
      }

      entries.sort((a, b) => b.composite - a.composite);
      entries.forEach((e, i) => (e.rank = i + 1));

      return c.json({ ok: true, version: "v25", dimensions: 10, leaderboard: entries, totalTrades: justifications.length, source: "database" });
    }
  } catch { /* fall through */ }

  // Fallback to cache
  const leaderboard = buildLeaderboard();
  return c.json({ ok: true, version: "v25", dimensions: 10, leaderboard, source: "cache" });
});

benchmarkV25ApiRoutes.get("/predictions", (c) => {
  const agentFilter = c.req.query("agent");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 200);

  let filtered = predictionCache;
  if (agentFilter) {
    filtered = filtered.filter((p) => p.agentId === agentFilter);
  }

  return c.json({
    ok: true,
    predictions: filtered.slice(-limit).reverse(),
    total: filtered.length,
    summary: {
      totalPredictions: filtered.length,
      directionalBreakdown: {
        up: countByCondition(filtered, (p) => p.predictedDirection === "up"),
        down: countByCondition(filtered, (p) => p.predictedDirection === "down"),
        flat: countByCondition(filtered, (p) => p.predictedDirection === "flat"),
        unspecified: countByCondition(filtered, (p) => p.predictedDirection === "unspecified"),
      },
      withTimeframe: countByCondition(filtered, (p) => p.timeframeSpecified !== null),
      withMagnitude: countByCondition(filtered, (p) => p.predictedMagnitude !== null),
    },
  });
});

benchmarkV25ApiRoutes.get("/consensus", (c) => {
  const agentFilter = c.req.query("agent");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 200);

  let filtered = consensusCache;
  if (agentFilter) {
    filtered = filtered.filter((p) => p.agentId === agentFilter);
  }

  // Per-agent summary
  const agentSummary = new Map<string, { agreed: number; contrarian: number; total: number; avgSimilarity: number; avgIndependence: number }>();
  for (const entry of filtered) {
    const existing = agentSummary.get(entry.agentId) ?? { agreed: 0, contrarian: 0, total: 0, avgSimilarity: 0, avgIndependence: 0 };
    existing.total++;
    existing.agreed += entry.agreedWithMajority;
    existing.contrarian += entry.wasContrarian;
    existing.avgSimilarity += entry.reasoningSimilarity;
    existing.avgIndependence += entry.independentThinkingScore;
    agentSummary.set(entry.agentId, existing);
  }

  const summaryArray = Array.from(agentSummary.entries()).map(([agentId, data]) => ({
    agentId,
    totalRounds: data.total,
    agreementRate: data.total > 0 ? round2(data.agreed / data.total) : 0,
    contrarianRate: data.total > 0 ? round2(data.contrarian / data.total) : 0,
    avgReasoningSimilarity: data.total > 0 ? round2(data.avgSimilarity / data.total) : 0,
    avgIndependentThinking: data.total > 0 ? round2(data.avgIndependence / data.total) : 0,
  }));

  return c.json({
    ok: true,
    consensusData: filtered.slice(-limit).reverse(),
    total: filtered.length,
    agentSummary: summaryArray,
  });
});

benchmarkV25ApiRoutes.get("/agent/:id", async (c) => {
  const agentId = c.req.param("id");
  const cached = agentCache.get(agentId);

  if (!cached) {
    // Try DB
    try {
      const trades = await db
        .select()
        .from(tradeJustifications)
        .where(eq(tradeJustifications.agentId, agentId))
        .orderBy(desc(tradeJustifications.timestamp))
        .limit(100);

      if (trades.length === 0) {
        return c.json({ ok: false, error: "Agent not found" }, 404);
      }

      const avgCoh = trades.reduce((sum: number, t: JustificationRow) => sum + (t.coherenceScore ?? 0), 0) / trades.length;
      return c.json({
        ok: true,
        agentId,
        tradeCount: trades.length,
        avgCoherence: round2(avgCoh),
        recentTrades: trades.slice(0, 10).map((t: typeof trades[0]) => ({
          action: t.action,
          symbol: t.symbol,
          reasoning: t.reasoning.slice(0, 200),
          confidence: t.confidence,
          coherence: t.coherenceScore,
          intent: t.intent,
        })),
        source: "database",
      });
    } catch {
      return c.json({ ok: false, error: "Agent not found" }, 404);
    }
  }

  const score = computeV25CompositeScore({
    pnl: 0,
    coherence: mean(cached.coherence),
    hallucinationFree: mean(cached.hallucinationFreeRates),
    discipline: mean(cached.disciplineRates),
    calibration: 0.5,
    prediction: 0.5,
    reasoningDepth: mean(cached.depthScores),
    sourceQuality: mean(cached.sourceQualityScores),
    outcomePrediction: mean(cached.predictionScores),
    consensusIntelligence: mean(cached.consensusScores),
  });

  return c.json({
    ok: true,
    agentId,
    score,
    tradeCount: cached.trades,
    intentDistribution: cached.intents,
    recentReasoning: cached.recentReasoning,
  });
});

benchmarkV25ApiRoutes.get("/export/jsonl", async (c) => {
  try {
    const justifications = await db
      .select()
      .from(tradeJustifications)
      .orderBy(desc(tradeJustifications.timestamp))
      .limit(1000);

    const lines = justifications.map((j: typeof justifications[0]) => {
      const depth = analyzeReasoningDepthV24(j.reasoning);
      const source = analyzeSourceQualityV24(j.reasoning, (j.sources as string[]) ?? []);
      const pred = parsePrediction(j.reasoning, j.predictedOutcome);
      const confidence01 = normalizeConfidence(j.confidence);

      return JSON.stringify({
        agent_id: j.agentId,
        round_id: j.roundId ?? null,
        timestamp: j.timestamp?.toISOString() ?? null,
        action: j.action,
        symbol: j.symbol,
        quantity: j.quantity,
        reasoning: j.reasoning,
        confidence: confidence01,
        sources: j.sources ?? [],
        intent: j.intent,
        coherence_score: j.coherenceScore,
        hallucination_flags: j.hallucinationFlags ?? [],
        discipline_pass: j.disciplinePass === "pass",
        reasoning_depth_score: depth.depthScore,
        step_count: depth.stepCount,
        connective_density: depth.connectiveDensity,
        evidence_anchoring: depth.evidenceAnchoringScore,
        counter_argument_score: depth.counterArgumentScore,
        reasoning_pattern: depth.reasoningPattern,
        source_quality_score: source.qualityScore,
        source_diversity: source.diversityScore,
        source_specificity: source.specificityScore,
        source_cross_reference: source.crossReferenceScore,
        source_integration: source.integrationScore,
        predicted_direction: pred.predictedDirection,
        predicted_magnitude: pred.predictedMagnitude,
        timeframe_specified: pred.timeframeSpecified,
        outcome_prediction_confidence: pred.confidenceInPrediction,
        benchmark_version: "v25",
      });
    });

    c.header("Content-Type", "application/x-ndjson");
    c.header("Content-Disposition", "attachment; filename=moltapp-benchmark-v25.jsonl");
    return c.text(lines.join("\n"));
  } catch {
    return c.json({ ok: false, error: "Database unavailable — no export data" }, 503);
  }
});

benchmarkV25ApiRoutes.get("/export/csv", async (c) => {
  try {
    const justifications = await db
      .select()
      .from(tradeJustifications)
      .orderBy(desc(tradeJustifications.timestamp))
      .limit(1000);

    const headers = [
      "agent_id", "round_id", "timestamp", "action", "symbol", "quantity",
      "confidence", "coherence_score", "hallucination_count", "discipline_pass",
      "intent", "reasoning_depth", "source_quality", "predicted_direction",
      "predicted_magnitude", "reasoning_length", "benchmark_version",
    ];

    const rows = justifications.map((j: typeof justifications[0]) => {
      const depth = analyzeReasoningDepthV24(j.reasoning);
      const source = analyzeSourceQualityV24(j.reasoning, (j.sources as string[]) ?? []);
      const pred = parsePrediction(j.reasoning, j.predictedOutcome);

      return [
        j.agentId,
        j.roundId ?? "",
        j.timestamp?.toISOString() ?? "",
        j.action,
        j.symbol,
        j.quantity ?? 0,
        normalizeConfidence(j.confidence),
        j.coherenceScore ?? 0,
        (j.hallucinationFlags as string[])?.length ?? 0,
        j.disciplinePass === "pass" ? 1 : 0,
        j.intent,
        depth.depthScore.toFixed(3),
        source.qualityScore.toFixed(3),
        pred.predictedDirection,
        pred.predictedMagnitude ?? "",
        j.reasoning.length,
        "v25",
      ].join(",");
    });

    c.header("Content-Type", "text/csv");
    c.header("Content-Disposition", "attachment; filename=moltapp-benchmark-v25.csv");
    return c.text([headers.join(","), ...rows].join("\n"));
  } catch {
    return c.json({ ok: false, error: "Database unavailable" }, 503);
  }
});

benchmarkV25ApiRoutes.post("/analyze", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.reasoning) {
    return c.json({ ok: false, error: "Provide { reasoning, action?, symbol?, sources? }" }, 400);
  }

  const reasoning = body.reasoning as string;
  const action = (body.action as string) ?? "hold";
  const sources = (body.sources as string[]) ?? [];

  const depth = analyzeReasoningDepthV24(reasoning);
  const sourceQ = analyzeSourceQualityV24(reasoning, sources);
  const pred = parsePrediction(reasoning, body.predictedOutcome);
  const coherence = analyzeCoherence(reasoning, action as "buy" | "sell" | "hold");
  const hallucinations = detectHallucinations(reasoning, []);

  return c.json({
    ok: true,
    analysis: {
      coherence: { score: coherence.score, explanation: coherence.explanation },
      hallucinations: { count: hallucinations.flags.length, flags: hallucinations.flags },
      reasoningDepth: depth,
      sourceQuality: sourceQ,
      outcomePrediction: pred,
      v25_dimensions: {
        coherence: coherence.score,
        hallucinationFree: 1 - hallucinations.severity,
        reasoningDepth: depth.depthScore,
        sourceQuality: sourceQ.qualityScore,
        outcomePredictionConfidence: pred.confidenceInPrediction,
      },
    },
  });
});
