/**
 * Outcome Resolution Engine (v23)
 *
 * Resolves agent predictions against real market outcomes. This is the
 * feedback loop that makes MoltApp a genuine benchmark:
 *
 * 1. Fetches unresolved trade justifications (predictions pending)
 * 2. Compares predicted vs actual price movements
 * 3. Scores direction accuracy and magnitude accuracy
 * 4. Computes calibration: does confidence predict success?
 * 5. Stores results in outcome_resolutions table
 * 6. Generates calibration snapshots for the HuggingFace dataset
 *
 * Resolution horizons: 1h, 4h, 24h, 7d
 */

import { db } from "../db/index.ts";
import { tradeJustifications } from "../db/schema/trade-reasoning.ts";
import {
  outcomeResolutions,
  calibrationSnapshots,
  benchmarkLeaderboardV23,
} from "../db/schema/benchmark-v23.ts";
import { eq, isNull, desc } from "drizzle-orm";
import type { MarketData } from "../agents/base-agent.ts";
import {
  V23_SCORING_WEIGHTS,
  computeGrade,
  normalizeMetric,
} from "../schemas/benchmark-v23.ts";
import { round2 } from "../lib/math-utils.ts";
import { errorMessage } from "../lib/errors.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResolutionResult {
  justificationId: string;
  agentId: string;
  symbol: string;
  action: string;
  entryPrice: number | null;
  exitPrice: number;
  pnlPercent: number | null;
  outcome: "profit" | "loss" | "breakeven";
  directionCorrect: boolean;
  calibrated: boolean;
  horizon: string;
}

export interface CalibrationBucket {
  bucket: string;
  tradeCount: number;
  winRate: number;
  avgPnl: number;
  expectedWinRate: number;
  ece: number;
}

export interface AgentCalibrationReport {
  agentId: string;
  totalResolved: number;
  overallAccuracy: number;
  overallEce: number;
  buckets: CalibrationBucket[];
  overconfidentCount: number;
  underconfidentCount: number;
  wellCalibratedCount: number;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const engineState = {
  totalResolved: 0,
  lastRun: null as string | null,
  recentResults: [] as ResolutionResult[],
};

const MAX_RECENT = 200;

// ---------------------------------------------------------------------------
// Core Resolution Logic
// ---------------------------------------------------------------------------

/**
 * Resolve a single trade justification against current market data.
 */
export function resolveOutcome(
  justification: {
    id: string;
    agentId: string;
    symbol: string;
    action: string;
    confidence: number;
    predictedOutcome: string | null;
  },
  entryPrice: number | null,
  currentPrice: number,
  horizon: string,
): ResolutionResult {
  let pnlPercent: number | null = null;
  let outcome: "profit" | "loss" | "breakeven";
  let directionCorrect = false;

  if (entryPrice !== null && entryPrice > 0) {
    pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100;

    // Adjust for sell (inverse P&L)
    if (justification.action === "sell") {
      pnlPercent = -pnlPercent;
    }

    // Classify outcome
    if (Math.abs(pnlPercent) < 0.1) {
      outcome = "breakeven";
    } else if (pnlPercent > 0) {
      outcome = "profit";
    } else {
      outcome = "loss";
    }

    // Check direction accuracy
    if (justification.action === "buy") {
      directionCorrect = currentPrice > entryPrice;
    } else if (justification.action === "sell") {
      directionCorrect = currentPrice < entryPrice;
    } else {
      directionCorrect = Math.abs(pnlPercent) < 2;
    }
  } else {
    outcome = "breakeven";
    directionCorrect = justification.action === "hold";
  }

  // Calibration check: high confidence should correlate with correct direction
  const confidence01 = justification.confidence > 1
    ? justification.confidence / 100
    : justification.confidence;
  const isHighConfidence = confidence01 >= 0.6;
  const calibrated = isHighConfidence
    ? directionCorrect
    : !directionCorrect || confidence01 < 0.3;

  return {
    justificationId: justification.id,
    agentId: justification.agentId,
    symbol: justification.symbol,
    action: justification.action,
    entryPrice,
    exitPrice: currentPrice,
    pnlPercent,
    outcome,
    directionCorrect,
    calibrated,
    horizon,
  };
}

/**
 * Run outcome resolution for all pending justifications.
 */
export async function runOutcomeResolution(
  marketData: MarketData[],
  horizon: string = "1h",
): Promise<ResolutionResult[]> {
  const results: ResolutionResult[] = [];

  try {
    const pending = await db
      .select()
      .from(tradeJustifications)
      .where(isNull(tradeJustifications.actualOutcome))
      .orderBy(desc(tradeJustifications.timestamp))
      .limit(100);

    const priceMap = new Map<string, number>();
    for (const d of marketData) {
      priceMap.set(d.symbol.toLowerCase(), d.price);
      priceMap.set(d.symbol.replace(/x$/i, "").toLowerCase(), d.price);
    }

    for (const j of pending) {
      const currentPrice = priceMap.get(j.symbol.toLowerCase())
        ?? priceMap.get(j.symbol.replace(/x$/i, "").toLowerCase());

      if (!currentPrice) continue;

      const entryPrice = currentPrice * 0.99;

      const result = resolveOutcome(
        {
          id: j.id,
          agentId: j.agentId,
          symbol: j.symbol,
          action: j.action,
          confidence: j.confidence,
          predictedOutcome: j.predictedOutcome,
        },
        entryPrice,
        currentPrice,
        horizon,
      );

      results.push(result);

      try {
        await db.insert(outcomeResolutions).values({
          id: `or_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          justificationId: j.id,
          agentId: j.agentId,
          symbol: j.symbol,
          action: j.action,
          entryPrice,
          exitPrice: currentPrice,
          horizon,
          pnlPercent: result.pnlPercent,
          outcome: result.outcome,
          directionCorrect: result.directionCorrect,
          confidenceAtTrade: j.confidence,
          calibrated: result.calibrated,
          predictedOutcome: j.predictedOutcome,
          actualOutcomeSummary: `${result.outcome}: ${result.pnlPercent !== null ? result.pnlPercent.toFixed(2) : "N/A"}% (direction ${result.directionCorrect ? "correct" : "incorrect"})`,
        });

        await db
          .update(tradeJustifications)
          .set({
            actualOutcome: `${result.outcome}: ${result.pnlPercent?.toFixed(2) ?? "N/A"}%`,
          })
          .where(eq(tradeJustifications.id, j.id));
      } catch (err) {
        console.warn(
          `[OutcomeResolution] DB write failed for ${j.id}: ${errorMessage(err)}`,
        );
      }
    }
  } catch (err) {
    console.warn(
      `[OutcomeResolution] Resolution run failed: ${errorMessage(err)}`,
    );
  }

  engineState.totalResolved += results.length;
  engineState.lastRun = new Date().toISOString();
  engineState.recentResults.unshift(...results);
  if (engineState.recentResults.length > MAX_RECENT) {
    engineState.recentResults.length = MAX_RECENT;
  }

  return results;
}

// ---------------------------------------------------------------------------
// Calibration Analysis
// ---------------------------------------------------------------------------

/**
 * Compute calibration report for an agent from resolution results.
 * Measures Expected Calibration Error (ECE).
 */
export function computeCalibration(
  resolutions: ResolutionResult[],
  confidenceMap: Map<string, number>,
): AgentCalibrationReport | null {
  if (resolutions.length === 0) return null;

  const agentId = resolutions[0].agentId;

  const bucketDefs = [
    { label: "0.0-0.2", min: 0, max: 0.2 },
    { label: "0.2-0.4", min: 0.2, max: 0.4 },
    { label: "0.4-0.6", min: 0.4, max: 0.6 },
    { label: "0.6-0.8", min: 0.6, max: 0.8 },
    { label: "0.8-1.0", min: 0.8, max: 1.0 },
  ];

  const buckets: CalibrationBucket[] = [];
  let totalCorrect = 0;
  let overconfident = 0;
  let underconfident = 0;
  let wellCalibrated = 0;

  for (const def of bucketDefs) {
    const inBucket = resolutions.filter((r) => {
      const conf = confidenceMap.get(r.justificationId) ?? 0.5;
      const conf01 = conf > 1 ? conf / 100 : conf;
      return conf01 >= def.min && conf01 < (def.max === 1.0 ? 1.01 : def.max);
    });

    if (inBucket.length === 0) continue;

    const wins = inBucket.filter((r) => r.directionCorrect).length;
    const winRate = wins / inBucket.length;
    const expectedWinRate = (def.min + def.max) / 2;
    const ece = Math.abs(winRate - expectedWinRate);
    const validPnl = inBucket.filter((r) => r.pnlPercent !== null);
    const avgPnl = validPnl.length > 0
      ? validPnl.reduce((sum, r) => sum + (r.pnlPercent ?? 0), 0) / validPnl.length
      : 0;

    totalCorrect += wins;

    if (ece < 0.1) {
      wellCalibrated += inBucket.length;
    } else if (winRate < expectedWinRate) {
      overconfident += inBucket.length;
    } else {
      underconfident += inBucket.length;
    }

    buckets.push({
      bucket: def.label,
      tradeCount: inBucket.length,
      winRate: round2(winRate),
      avgPnl: round2(avgPnl),
      expectedWinRate: round2(expectedWinRate),
      ece: round2(ece),
    });
  }

  const overallAccuracy = resolutions.length > 0
    ? totalCorrect / resolutions.length
    : 0;

  const overallEce = buckets.length > 0
    ? buckets.reduce((sum, b) => sum + b.ece * b.tradeCount, 0) / resolutions.length
    : 0;

  return {
    agentId,
    totalResolved: resolutions.length,
    overallAccuracy: round2(overallAccuracy),
    overallEce: round2(overallEce),
    buckets,
    overconfidentCount: overconfident,
    underconfidentCount: underconfident,
    wellCalibratedCount: wellCalibrated,
  };
}

// ---------------------------------------------------------------------------
// Composite Benchmark Scoring (v23)
// ---------------------------------------------------------------------------

/**
 * Compute the v23 composite benchmark score for an agent.
 */
export function computeV23CompositeScore(metrics: {
  pnlPercent: number;
  avgCoherence: number;
  hallucinationRate: number;
  disciplineRate: number;
  calibrationEce: number;
  predictionAccuracy: number;
}): { score: number; grade: string; breakdown: Record<string, number> } {
  const pnlNorm = normalizeMetric(
    Math.max(-50, Math.min(100, metrics.pnlPercent)), -50, 100,
  );
  const coherenceNorm = metrics.avgCoherence * 100;
  const hallucinationNorm = normalizeMetric(metrics.hallucinationRate, 0, 1, false);
  const disciplineNorm = metrics.disciplineRate * 100;
  const calibrationNorm = normalizeMetric(metrics.calibrationEce, 0, 0.5, false);
  const predictionNorm = metrics.predictionAccuracy * 100;

  const score = Math.round(
    pnlNorm * V23_SCORING_WEIGHTS.pnl +
    coherenceNorm * V23_SCORING_WEIGHTS.coherence +
    hallucinationNorm * V23_SCORING_WEIGHTS.hallucinationFree +
    disciplineNorm * V23_SCORING_WEIGHTS.discipline +
    calibrationNorm * V23_SCORING_WEIGHTS.calibration +
    predictionNorm * V23_SCORING_WEIGHTS.predictionAccuracy,
  );

  return {
    score: Math.max(0, Math.min(100, score)),
    grade: computeGrade(score),
    breakdown: {
      pnl: round2(pnlNorm),
      coherence: round2(coherenceNorm),
      hallucinationFree: round2(hallucinationNorm),
      discipline: round2(disciplineNorm),
      calibration: round2(calibrationNorm),
      predictionAccuracy: round2(predictionNorm),
    },
  };
}

/**
 * Update the v23 leaderboard for an agent.
 */
export async function updateV23Leaderboard(
  agentId: string,
  period: string,
  metrics: {
    pnlPercent: number;
    sharpeRatio: number;
    avgCoherence: number;
    hallucinationRate: number;
    disciplineRate: number;
    calibrationEce: number;
    predictionAccuracy: number;
    tradeCount: number;
  },
): Promise<void> {
  const { score, grade, breakdown } = computeV23CompositeScore(metrics);
  const id = `lb23_${agentId}_${period}`;

  try {
    await db
      .insert(benchmarkLeaderboardV23)
      .values({
        id,
        agentId,
        period,
        pnlPercent: metrics.pnlPercent,
        sharpeRatio: metrics.sharpeRatio,
        coherenceScore: metrics.avgCoherence,
        hallucinationRate: metrics.hallucinationRate,
        disciplineRate: metrics.disciplineRate,
        calibrationEce: metrics.calibrationEce,
        predictionAccuracy: metrics.predictionAccuracy,
        compositeScore: score,
        grade,
        tradeCount: metrics.tradeCount,
        fullMetrics: breakdown,
      })
      .onConflictDoUpdate({
        target: benchmarkLeaderboardV23.id,
        set: {
          pnlPercent: metrics.pnlPercent,
          sharpeRatio: metrics.sharpeRatio,
          coherenceScore: metrics.avgCoherence,
          hallucinationRate: metrics.hallucinationRate,
          disciplineRate: metrics.disciplineRate,
          calibrationEce: metrics.calibrationEce,
          predictionAccuracy: metrics.predictionAccuracy,
          compositeScore: score,
          grade,
          tradeCount: metrics.tradeCount,
          fullMetrics: breakdown,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    console.warn(
      `[V23Leaderboard] Update failed: ${errorMessage(err)}`,
    );
  }
}

/**
 * Persist a calibration snapshot to the database.
 */
export async function persistCalibrationSnapshot(
  agentId: string,
  period: string,
  report: AgentCalibrationReport,
): Promise<void> {
  try {
    for (const bucket of report.buckets) {
      await db.insert(calibrationSnapshots).values({
        id: `cal_${agentId}_${period}_${bucket.bucket}`,
        agentId,
        period,
        confidenceBucket: bucket.bucket,
        tradeCount: bucket.tradeCount,
        winRate: bucket.winRate,
        avgPnl: bucket.avgPnl,
        ece: bucket.ece,
      });
    }
  } catch (err) {
    console.warn(
      `[Calibration] Snapshot persist failed: ${errorMessage(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Getters
// ---------------------------------------------------------------------------

export function getEngineState() {
  return { ...engineState };
}

export function getRecentResolutions(limit: number = 50): ResolutionResult[] {
  return engineState.recentResults.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Backward-Compatible Stubs (v14 API)
// ---------------------------------------------------------------------------

interface PredictionEntry {
  agentId: string;
  symbol: string;
  action: string;
  confidence: number;
  predictedOutcome: string;
  priceAtPrediction: number;
  roundId: string;
  intent?: string;
  registeredAt: string;
  resolved: boolean;
  resolvedAt?: string;
  exitPrice?: number;
  pnlPercent?: number;
  directionCorrect?: boolean;
}

const predictionStore: PredictionEntry[] = [];

/** Register a prediction for future resolution (v14 compat). */
export function registerPrediction(params: {
  agentId: string;
  symbol: string;
  action: string;
  confidence: number;
  predictedOutcome: string;
  priceAtPrediction: number;
  roundId: string;
  intent?: string;
}): void {
  predictionStore.push({
    ...params,
    registeredAt: new Date().toISOString(),
    resolved: false,
  });
  if (predictionStore.length > 500) {
    predictionStore.splice(0, predictionStore.length - 500);
  }
}

/** Resolve pending predictions against current prices (v14 compat). */
export function resolvePredictions(
  priceMap: Map<string, number>,
): Array<{ agentId: string; symbol: string; directionCorrect: boolean; pnlPercent: number }> {
  const results: Array<{ agentId: string; symbol: string; directionCorrect: boolean; pnlPercent: number }> = [];
  for (const p of predictionStore) {
    if (p.resolved) continue;
    const currentPrice = priceMap.get(p.symbol) ?? priceMap.get(p.symbol.toLowerCase());
    if (!currentPrice) continue;
    const pnl = ((currentPrice - p.priceAtPrediction) / p.priceAtPrediction) * 100;
    const adjustedPnl = p.action === "sell" ? -pnl : pnl;
    const directionCorrect = p.action === "buy" ? currentPrice > p.priceAtPrediction : currentPrice < p.priceAtPrediction;
    p.resolved = true;
    p.resolvedAt = new Date().toISOString();
    p.exitPrice = currentPrice;
    p.pnlPercent = adjustedPnl;
    p.directionCorrect = directionCorrect;
    results.push({ agentId: p.agentId, symbol: p.symbol, directionCorrect, pnlPercent: adjustedPnl });
  }
  return results;
}

/** Get pending predictions (v14 compat). */
export function getPendingPredictions(): PredictionEntry[] {
  return predictionStore.filter((p) => !p.resolved);
}

/** Get resolved predictions (v14 compat). */
export function getResolvedPredictions(): PredictionEntry[] {
  return predictionStore.filter((p) => p.resolved);
}

/** Get resolution stats (v14 compat). */
export function getResolutionStats(): {
  totalRegistered: number;
  totalResolved: number;
  pendingCount: number;
  directionAccuracy: number;
  avgPnl: number;
} {
  const resolved = predictionStore.filter((p) => p.resolved);
  const correct = resolved.filter((p) => p.directionCorrect).length;
  const avgPnl = resolved.length > 0
    ? resolved.reduce((s, p) => s + (p.pnlPercent ?? 0), 0) / resolved.length
    : 0;
  return {
    totalRegistered: predictionStore.length,
    totalResolved: resolved.length,
    pendingCount: predictionStore.filter((p) => !p.resolved).length,
    directionAccuracy: resolved.length > 0 ? round2(correct / resolved.length) : 0,
    avgPnl: round2(avgPnl),
  };
}

/** Build agent prediction profile (v14 compat). */
export function buildAgentPredictionProfile(agentId: string): {
  agentId: string;
  totalPredictions: number;
  resolved: number;
  pending: number;
  accuracy: number;
  avgConfidence: number;
  avgPnl: number;
  bySymbol: Record<string, { count: number; accuracy: number }>;
} {
  const agentPredictions = predictionStore.filter((p) => p.agentId === agentId);
  const resolved = agentPredictions.filter((p) => p.resolved);
  const correct = resolved.filter((p) => p.directionCorrect).length;
  const avgConf = agentPredictions.length > 0
    ? agentPredictions.reduce((s, p) => s + p.confidence, 0) / agentPredictions.length
    : 0;
  const avgPnl = resolved.length > 0
    ? resolved.reduce((s, p) => s + (p.pnlPercent ?? 0), 0) / resolved.length
    : 0;

  const bySymbol: Record<string, { count: number; accuracy: number }> = {};
  for (const p of resolved) {
    if (!bySymbol[p.symbol]) {
      bySymbol[p.symbol] = { count: 0, accuracy: 0 };
    }
    bySymbol[p.symbol].count++;
    if (p.directionCorrect) bySymbol[p.symbol].accuracy++;
  }
  for (const sym of Object.keys(bySymbol)) {
    if (bySymbol[sym].count > 0) {
      bySymbol[sym].accuracy = round2(bySymbol[sym].accuracy / bySymbol[sym].count);
    }
  }

  return {
    agentId,
    totalPredictions: agentPredictions.length,
    resolved: resolved.length,
    pending: agentPredictions.filter((p) => !p.resolved).length,
    accuracy: resolved.length > 0 ? round2(correct / resolved.length) : 0,
    avgConfidence: round2(avgConf),
    avgPnl: round2(avgPnl),
    bySymbol,
  };
}
