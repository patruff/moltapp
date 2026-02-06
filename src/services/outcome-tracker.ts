/**
 * Outcome Tracker Service
 *
 * Retroactively fills in `actualOutcome` on trade justifications by comparing
 * the predicted outcomes to what actually happened. This is critical for:
 *
 * 1. CONFIDENCE CALIBRATION: Are high-confidence trades actually better?
 * 2. PREDICTION ACCURACY: Do agents predict outcomes correctly?
 * 3. BENCHMARK SCORING: Outcomes feed into the composite benchmark score.
 *
 * The tracker runs periodically (e.g., 1 hour after each trading round)
 * to give prices time to move and generate meaningful outcome data.
 */

import { db } from "../db/index.ts";
import { errorMessage } from "../lib/errors.ts";
import { tradeJustifications } from "../db/schema/trade-reasoning.ts";
import { trades } from "../db/schema/trades.ts";
import { eq, isNull, and, lte, sql, desc } from "drizzle-orm";
import type { MarketData } from "../agents/base-agent.ts";
import { round2 } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OutcomeResult {
  justificationId: string;
  agentId: string;
  symbol: string;
  action: string;
  entryPrice: number | null;
  currentPrice: number;
  pnlPercent: number | null;
  outcome: "profit" | "loss" | "breakeven" | "pending";
  outcomeText: string;
  confidenceAtTrade: number;
  wasCalibrated: boolean; // high confidence + profit OR low confidence + loss = calibrated
}

export interface OutcomeTrackerStats {
  totalTracked: number;
  profitCount: number;
  lossCount: number;
  breakevenCount: number;
  pendingCount: number;
  avgPnlPercent: number;
  calibrationScore: number; // 0-1: how often confidence matches outcome
  lastRun: string | null;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const trackerState: {
  lastRun: string | null;
  totalProcessed: number;
  outcomes: OutcomeResult[];
} = {
  lastRun: null,
  totalProcessed: 0,
  outcomes: [],
};

const MAX_OUTCOMES_CACHE = 500;

// ---------------------------------------------------------------------------
// Core: Track Outcomes
// ---------------------------------------------------------------------------

/**
 * Evaluate all trade justifications that don't have an `actualOutcome` yet.
 * Compares entry prices to current market prices to determine P&L.
 *
 * Called periodically by the autonomous runner or manually via API.
 */
export async function trackOutcomes(
  currentMarketData: MarketData[],
): Promise<OutcomeResult[]> {
  const results: OutcomeResult[] = [];
  const priceMap = new Map<string, number>();

  for (const md of currentMarketData) {
    priceMap.set(md.symbol.toLowerCase(), md.price);
  }

  try {
    // Find justifications without outcomes that are old enough (> 30 min)
    const cutoff = new Date(Date.now() - 30 * 60 * 1000);

    const pendingJustifications = await db
      .select()
      .from(tradeJustifications)
      .where(
        and(
          isNull(tradeJustifications.actualOutcome),
          lte(tradeJustifications.timestamp, cutoff),
        ),
      )
      .orderBy(desc(tradeJustifications.timestamp))
      .limit(100);

    for (const j of pendingJustifications) {
      const currentPrice = priceMap.get(j.symbol.toLowerCase());
      if (!currentPrice) continue;

      // For hold actions, outcome is neutral
      if (j.action === "hold") {
        const outcomeText = `Held position. ${j.symbol} currently at $${currentPrice.toFixed(2)}.`;
        await db
          .update(tradeJustifications)
          .set({ actualOutcome: outcomeText })
          .where(eq(tradeJustifications.id, j.id));

        results.push({
          justificationId: j.id,
          agentId: j.agentId,
          symbol: j.symbol,
          action: j.action,
          entryPrice: null,
          currentPrice,
          pnlPercent: null,
          outcome: "breakeven",
          outcomeText,
          confidenceAtTrade: j.confidence,
          wasCalibrated: true,
        });
        continue;
      }

      // For buy/sell, try to find the matching trade to get entry price
      let entryPrice: number | null = null;

      try {
        const matchingTrades = await db
          .select()
          .from(trades)
          .where(
            and(
              eq(trades.agentId, j.agentId),
              eq(trades.stockSymbol, j.symbol),
            ),
          )
          .orderBy(desc(trades.createdAt))
          .limit(1);

        if (matchingTrades.length > 0) {
          entryPrice = parseFloat(matchingTrades[0].pricePerToken);
        }
      } catch {
        // Can't find matching trade — estimate from quantity
      }

      // Calculate P&L
      let pnlPercent: number | null = null;
      let outcome: OutcomeResult["outcome"] = "pending";
      let outcomeText = "";

      if (entryPrice && entryPrice > 0) {
        if (j.action === "buy") {
          pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
        } else {
          // Sell: profit if price went down after selling
          pnlPercent = ((entryPrice - currentPrice) / entryPrice) * 100;
        }

        if (Math.abs(pnlPercent) < 0.5) {
          outcome = "breakeven";
          outcomeText = `Breakeven. Entry $${entryPrice.toFixed(2)}, current $${currentPrice.toFixed(2)} (${pnlPercent >= 0 ? "+" : ""}${pnlPercent.toFixed(2)}%).`;
        } else if (pnlPercent > 0) {
          outcome = "profit";
          outcomeText = `Profit: +${pnlPercent.toFixed(2)}%. Entry $${entryPrice.toFixed(2)}, current $${currentPrice.toFixed(2)}.`;
        } else {
          outcome = "loss";
          outcomeText = `Loss: ${pnlPercent.toFixed(2)}%. Entry $${entryPrice.toFixed(2)}, current $${currentPrice.toFixed(2)}.`;
        }
      } else {
        outcomeText = `${j.action === "buy" ? "Bought" : "Sold"} ${j.symbol}. Current price: $${currentPrice.toFixed(2)}.`;
        outcome = "pending";
      }

      // Determine confidence calibration
      const confidence01 = j.confidence;
      const highConfidence = confidence01 >= 0.6;
      const wasCalibrated =
        (highConfidence && outcome === "profit") ||
        (!highConfidence && outcome !== "profit") ||
        outcome === "breakeven";

      // Update the justification
      await db
        .update(tradeJustifications)
        .set({ actualOutcome: outcomeText })
        .where(eq(tradeJustifications.id, j.id));

      const result: OutcomeResult = {
        justificationId: j.id,
        agentId: j.agentId,
        symbol: j.symbol,
        action: j.action,
        entryPrice,
        currentPrice,
        pnlPercent,
        outcome,
        outcomeText,
        confidenceAtTrade: confidence01,
        wasCalibrated,
      };

      results.push(result);
      trackerState.outcomes.unshift(result);
    }

    // Trim cache
    if (trackerState.outcomes.length > MAX_OUTCOMES_CACHE) {
      trackerState.outcomes.length = MAX_OUTCOMES_CACHE;
    }

    trackerState.lastRun = new Date().toISOString();
    trackerState.totalProcessed += results.length;

    console.log(
      `[OutcomeTracker] Processed ${results.length} outcomes. ` +
        `Profit: ${results.filter((r) => r.outcome === "profit").length}, ` +
        `Loss: ${results.filter((r) => r.outcome === "loss").length}, ` +
        `Breakeven: ${results.filter((r) => r.outcome === "breakeven").length}`,
    );
  } catch (err) {
    console.error(
      `[OutcomeTracker] Failed: ${errorMessage(err)}`,
    );
  }

  return results;
}

// ---------------------------------------------------------------------------
// Confidence Calibration
// ---------------------------------------------------------------------------

/**
 * Calculate the confidence calibration score for an agent.
 * This measures whether high-confidence trades actually perform better
 * than low-confidence trades — a key benchmark metric.
 *
 * Returns a score from 0 (anti-calibrated) to 1 (perfectly calibrated).
 */
export function calculateConfidenceCalibration(
  agentId?: string,
): {
  score: number;
  buckets: Array<{
    confidenceRange: string;
    tradeCount: number;
    winRate: number;
    avgPnl: number;
  }>;
  totalTrades: number;
} {
  let outcomes = trackerState.outcomes;
  if (agentId) {
    outcomes = outcomes.filter((o) => o.agentId === agentId);
  }

  // Only use outcomes with actual P&L data
  const withPnl = outcomes.filter((o) => o.pnlPercent !== null);

  if (withPnl.length < 5) {
    return {
      score: 0.5, // neutral score when insufficient data
      buckets: [],
      totalTrades: withPnl.length,
    };
  }

  // Bucket by confidence level
  const buckets = [
    { min: 0, max: 0.25, label: "0-25%" },
    { min: 0.25, max: 0.5, label: "25-50%" },
    { min: 0.5, max: 0.75, label: "50-75%" },
    { min: 0.75, max: 1.01, label: "75-100%" },
  ];

  const bucketResults = buckets.map((bucket) => {
    const inBucket = withPnl.filter(
      (o) =>
        o.confidenceAtTrade >= bucket.min &&
        o.confidenceAtTrade < bucket.max,
    );
    const wins = inBucket.filter((o) => (o.pnlPercent ?? 0) > 0);
    const winRate = inBucket.length > 0 ? wins.length / inBucket.length : 0;
    const avgPnl =
      inBucket.length > 0
        ? inBucket.reduce((s, o) => s + (o.pnlPercent ?? 0), 0) / inBucket.length
        : 0;

    return {
      confidenceRange: bucket.label,
      tradeCount: inBucket.length,
      winRate: round2(winRate),
      avgPnl: round2(avgPnl),
    };
  });

  // Calibration score: monotonically increasing win rate across confidence buckets
  // Perfect calibration = win rate increases with confidence
  let score = 0.5; // start neutral
  const nonEmptyBuckets = bucketResults.filter((b) => b.tradeCount > 0);

  if (nonEmptyBuckets.length >= 2) {
    let correctOrder = 0;
    let totalPairs = 0;

    for (let i = 0; i < nonEmptyBuckets.length - 1; i++) {
      for (let j = i + 1; j < nonEmptyBuckets.length; j++) {
        totalPairs++;
        // Higher confidence bucket should have higher win rate
        if (nonEmptyBuckets[j].winRate >= nonEmptyBuckets[i].winRate) {
          correctOrder++;
        }
      }
    }

    score = totalPairs > 0 ? correctOrder / totalPairs : 0.5;
  }

  return {
    score: round2(score),
    buckets: bucketResults,
    totalTrades: withPnl.length,
  };
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

/**
 * Get aggregate outcome tracking statistics.
 */
export function getOutcomeTrackerStats(agentId?: string): OutcomeTrackerStats {
  let outcomes = trackerState.outcomes;
  if (agentId) {
    outcomes = outcomes.filter((o) => o.agentId === agentId);
  }

  const profitCount = outcomes.filter((o) => o.outcome === "profit").length;
  const lossCount = outcomes.filter((o) => o.outcome === "loss").length;
  const breakevenCount = outcomes.filter((o) => o.outcome === "breakeven").length;
  const pendingCount = outcomes.filter((o) => o.outcome === "pending").length;

  const withPnl = outcomes.filter((o) => o.pnlPercent !== null);
  const avgPnlPercent =
    withPnl.length > 0
      ? withPnl.reduce((s, o) => s + (o.pnlPercent ?? 0), 0) / withPnl.length
      : 0;

  const calibrated = outcomes.filter((o) => o.wasCalibrated).length;
  const calibrationScore =
    outcomes.length > 0 ? calibrated / outcomes.length : 0;

  return {
    totalTracked: outcomes.length,
    profitCount,
    lossCount,
    breakevenCount,
    pendingCount,
    avgPnlPercent: round2(avgPnlPercent),
    calibrationScore: round2(calibrationScore),
    lastRun: trackerState.lastRun,
  };
}

/**
 * Get recent outcomes for display in brain feed / dashboard.
 */
export function getRecentOutcomes(limit = 20, agentId?: string): OutcomeResult[] {
  let outcomes = trackerState.outcomes;
  if (agentId) {
    outcomes = outcomes.filter((o) => o.agentId === agentId);
  }
  return outcomes.slice(0, limit);
}
