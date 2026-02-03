/**
 * Prediction Market Service
 *
 * Complete prediction market engine for AI agent forecasts. Agents publish
 * structured predictions (price targets, directional calls, volatility bets)
 * and any agent or user can wager virtual tokens for/against them.
 *
 * Odds are computed via an Automated Market Maker (AMM) that adjusts
 * dynamically as the pool balance shifts. When predictions expire or are
 * manually resolved, the engine grades correctness against real market
 * data and distributes payouts proportionally.
 *
 * Key concepts:
 *   - Predictions: Structured forecasts with confidence, horizon, reasoning
 *   - Markets: AMM pools that set odds for each prediction
 *   - Bets: Virtual token wagers locked at the odds when placed
 *   - Resolution: Automated grading against live prices + payout distribution
 */

import { db } from "../db/index.ts";
import {
  predictions,
  predictionBets,
  predictionMarkets,
} from "../db/schema/predictions.ts";
import { eq, desc, and, lte, sql, gte, asc, ne } from "drizzle-orm";
import { getMarketData } from "../agents/orchestrator.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Valid prediction types */
export type PredictionType =
  | "price_target"
  | "direction"
  | "volatility"
  | "outperform";

/** Valid directional outlooks */
export type PredictionDirection = "bullish" | "bearish" | "neutral";

/** Valid time horizons */
export type TimeHorizon = "1h" | "4h" | "1d" | "1w" | "1m";

/** Valid prediction statuses */
export type PredictionStatus =
  | "active"
  | "resolved_correct"
  | "resolved_incorrect"
  | "expired"
  | "cancelled";

/** Aggregate stats for an agent's prediction track record */
export interface AgentPredictionStats {
  agentId: string;
  totalPredictions: number;
  activePredictions: number;
  resolvedPredictions: number;
  correctPredictions: number;
  incorrectPredictions: number;
  winRate: number;
  avgConfidence: number;
  avgConfidenceWhenCorrect: number;
  avgConfidenceWhenIncorrect: number;
  calibrationScore: number;
  totalBetsReceived: number;
  totalPoolVolume: number;
  bestCall: { symbol: string; direction: string; confidence: number; priceDelta: number } | null;
  worstCall: { symbol: string; direction: string; confidence: number; priceDelta: number } | null;
  predictionsByType: Record<string, number>;
  predictionsByHorizon: Record<string, number>;
}

/** Leaderboard entry for agent prediction accuracy */
export interface PredictionLeaderboardEntry {
  agentId: string;
  totalPredictions: number;
  resolvedPredictions: number;
  correctPredictions: number;
  winRate: number;
  avgConfidence: number;
  calibrationScore: number;
  profitability: number;
  rank: number;
}

// ---------------------------------------------------------------------------
// AMM Odds Calculation
// ---------------------------------------------------------------------------

/**
 * Calculate dynamic odds using an Automated Market Maker formula.
 *
 * The AMM derives payout multipliers from pool ratios:
 *   oddsFor     = totalPool / forPool
 *   oddsAgainst = totalPool / againstPool
 *
 * Edge cases:
 *   - Empty pool: returns even odds (2.0) since both sides start equal
 *   - Single-sided pool: caps max odds at 100x to prevent infinite payouts
 *   - Minimum odds floor of 1.01 to ensure payouts always exceed wager
 *
 * @param forPool   - Total tokens in the "for" pool
 * @param againstPool - Total tokens in the "against" pool
 * @returns Object with oddsFor and oddsAgainst multipliers
 */
export function calculateDynamicOdds(
  forPool: number,
  againstPool: number,
): { oddsFor: number; oddsAgainst: number } {
  const totalPool = forPool + againstPool;

  // Empty market — return even odds
  if (totalPool === 0 || (forPool === 0 && againstPool === 0)) {
    return { oddsFor: 2.0, oddsAgainst: 2.0 };
  }

  // One-sided markets — cap at 100x, floor at 1.01x
  const MAX_ODDS = 100.0;
  const MIN_ODDS = 1.01;

  let oddsFor = forPool > 0 ? totalPool / forPool : MAX_ODDS;
  let oddsAgainst = againstPool > 0 ? totalPool / againstPool : MAX_ODDS;

  oddsFor = Math.max(MIN_ODDS, Math.min(MAX_ODDS, oddsFor));
  oddsAgainst = Math.max(MIN_ODDS, Math.min(MAX_ODDS, oddsAgainst));

  return {
    oddsFor: Math.round(oddsFor * 10000) / 10000,
    oddsAgainst: Math.round(oddsAgainst * 10000) / 10000,
  };
}

// ---------------------------------------------------------------------------
// Core Functions
// ---------------------------------------------------------------------------

/**
 * Create a new prediction and its associated betting market.
 *
 * The agent's prediction is recorded along with the current market price
 * at creation time. A fresh AMM market is initialized with empty pools
 * and even odds, ready to accept bets.
 *
 * @param agentId      - ID of the agent making the prediction
 * @param symbol       - Stock symbol (e.g. "AAPLx")
 * @param predictionType - Type of prediction (price_target, direction, etc.)
 * @param direction    - Bullish, bearish, or neutral outlook
 * @param targetPrice  - Specific price target (null for non-price_target types)
 * @param timeHorizon  - How far out the prediction extends
 * @param confidence   - Agent confidence 0-100
 * @param reasoning    - Agent's written analysis
 * @returns The created prediction and market objects
 */
export async function createPrediction(
  agentId: string,
  symbol: string,
  predictionType: PredictionType,
  direction: PredictionDirection,
  targetPrice: number | null,
  timeHorizon: TimeHorizon,
  confidence: number,
  reasoning: string,
): Promise<{ prediction: typeof predictions.$inferSelect; market: typeof predictionMarkets.$inferSelect }> {
  // Validate confidence range
  if (confidence < 0 || confidence > 100) {
    throw new Error("Confidence must be between 0 and 100");
  }

  // Validate prediction type
  const validTypes: PredictionType[] = ["price_target", "direction", "volatility", "outperform"];
  if (!validTypes.includes(predictionType)) {
    throw new Error(`Invalid prediction type: ${predictionType}. Must be one of: ${validTypes.join(", ")}`);
  }

  // Validate direction
  const validDirections: PredictionDirection[] = ["bullish", "bearish", "neutral"];
  if (!validDirections.includes(direction)) {
    throw new Error(`Invalid direction: ${direction}. Must be one of: ${validDirections.join(", ")}`);
  }

  // Validate time horizon
  const validHorizons: TimeHorizon[] = ["1h", "4h", "1d", "1w", "1m"];
  if (!validHorizons.includes(timeHorizon)) {
    throw new Error(`Invalid time horizon: ${timeHorizon}. Must be one of: ${validHorizons.join(", ")}`);
  }

  // price_target type requires a target price
  if (predictionType === "price_target" && targetPrice === null) {
    throw new Error("price_target predictions require a targetPrice");
  }

  // Fetch current market price for the symbol
  const marketData = await getMarketData();
  const stock = marketData.find(
    (m) => m.symbol.toLowerCase() === symbol.toLowerCase(),
  );
  if (!stock) {
    throw new Error(
      `Symbol "${symbol}" not found. Available symbols: ${marketData.map((m) => m.symbol).join(", ")}`,
    );
  }

  // Calculate expiry based on time horizon
  const now = new Date();
  const expiresAt = new Date(now);
  switch (timeHorizon) {
    case "1h":
      expiresAt.setHours(expiresAt.getHours() + 1);
      break;
    case "4h":
      expiresAt.setHours(expiresAt.getHours() + 4);
      break;
    case "1d":
      expiresAt.setDate(expiresAt.getDate() + 1);
      break;
    case "1w":
      expiresAt.setDate(expiresAt.getDate() + 7);
      break;
    case "1m":
      expiresAt.setMonth(expiresAt.getMonth() + 1);
      break;
  }

  // Insert prediction
  const [prediction] = await db
    .insert(predictions)
    .values({
      agentId,
      symbol: stock.symbol,
      predictionType,
      direction,
      targetPrice: targetPrice !== null ? String(targetPrice) : null,
      currentPriceAtCreation: String(stock.price),
      timeHorizon,
      confidence,
      reasoning,
      status: "active",
      expiresAt,
    })
    .returning();

  // Create associated market with empty pools and even odds
  const [market] = await db
    .insert(predictionMarkets)
    .values({
      predictionId: prediction.id,
      totalPool: "0",
      forPool: "0",
      againstPool: "0",
      currentOddsFor: "2.0",
      currentOddsAgainst: "2.0",
      totalBets: 0,
      status: "open",
    })
    .returning();

  console.log(
    `[Predictions] Created prediction ${prediction.id} by ${agentId}: ${direction} on ${symbol} (${predictionType}, ${timeHorizon}, ${confidence}% confidence)`,
  );

  return { prediction, market };
}

/**
 * Place a bet on a prediction.
 *
 * The bettor wagers virtual tokens on either the "for" or "against" side.
 * Odds are locked at the current AMM rate when the bet is placed. After
 * the bet, pool balances are updated and new odds are recalculated.
 *
 * @param predictionId - ID of the prediction to bet on
 * @param bettorId     - ID of the bettor (agent or user)
 * @param bettorType   - "agent" or "user"
 * @param position     - "for" or "against"
 * @param amount       - Virtual token amount to wager
 * @returns The created bet and updated market state
 */
export async function placeBet(
  predictionId: string,
  bettorId: string,
  bettorType: "agent" | "user",
  position: "for" | "against",
  amount: number,
): Promise<{ bet: typeof predictionBets.$inferSelect; market: typeof predictionMarkets.$inferSelect }> {
  // Validate amount
  if (amount <= 0) {
    throw new Error("Bet amount must be greater than 0");
  }
  if (amount > 100000) {
    throw new Error("Maximum bet amount is 100,000 tokens");
  }

  // Validate bettor type
  if (!["agent", "user"].includes(bettorType)) {
    throw new Error('bettorType must be "agent" or "user"');
  }

  // Validate position
  if (!["for", "against"].includes(position)) {
    throw new Error('position must be "for" or "against"');
  }

  // Fetch prediction and ensure it's active
  const [prediction] = await db
    .select()
    .from(predictions)
    .where(eq(predictions.id, predictionId))
    .limit(1);

  if (!prediction) {
    throw new Error(`Prediction ${predictionId} not found`);
  }
  if (prediction.status !== "active") {
    throw new Error(
      `Prediction ${predictionId} is not active (status: ${prediction.status}). Cannot place bets on resolved/cancelled predictions.`,
    );
  }
  if (new Date(prediction.expiresAt) <= new Date()) {
    throw new Error(`Prediction ${predictionId} has expired. Cannot place new bets.`);
  }

  // Fetch market
  const [market] = await db
    .select()
    .from(predictionMarkets)
    .where(eq(predictionMarkets.predictionId, predictionId))
    .limit(1);

  if (!market) {
    throw new Error(`Market for prediction ${predictionId} not found`);
  }
  if (market.status !== "open") {
    throw new Error(`Market is ${market.status}. Cannot place bets.`);
  }

  // Calculate current odds for the bettor's position
  const currentForPool = parseFloat(market.forPool ?? "0");
  const currentAgainstPool = parseFloat(market.againstPool ?? "0");
  const odds = calculateDynamicOdds(currentForPool, currentAgainstPool);
  const lockedOdds = position === "for" ? odds.oddsFor : odds.oddsAgainst;

  // Create the bet
  const [bet] = await db
    .insert(predictionBets)
    .values({
      predictionId,
      bettorId,
      bettorType,
      position,
      amount: String(amount),
      odds: String(lockedOdds),
      status: "active",
    })
    .returning();

  // Update pool balances
  const newForPool =
    position === "for" ? currentForPool + amount : currentForPool;
  const newAgainstPool =
    position === "against" ? currentAgainstPool + amount : currentAgainstPool;
  const newTotalPool = newForPool + newAgainstPool;

  // Recalculate odds after the bet
  const newOdds = calculateDynamicOdds(newForPool, newAgainstPool);

  const [updatedMarket] = await db
    .update(predictionMarkets)
    .set({
      forPool: String(newForPool),
      againstPool: String(newAgainstPool),
      totalPool: String(newTotalPool),
      currentOddsFor: String(newOdds.oddsFor),
      currentOddsAgainst: String(newOdds.oddsAgainst),
      totalBets: (market.totalBets ?? 0) + 1,
    })
    .where(eq(predictionMarkets.id, market.id))
    .returning();

  console.log(
    `[Predictions] Bet placed: ${bettorId} (${bettorType}) bet ${amount} tokens ${position} prediction ${predictionId} at ${lockedOdds}x odds`,
  );

  return { bet, market: updatedMarket };
}

/**
 * Resolve a single prediction by checking the current market price.
 *
 * Determines whether the prediction was correct by comparing the
 * agent's forecast to the actual price. For directional predictions,
 * a correct call is one where the price moved in the predicted direction.
 * For price_target predictions, the price must be within 2% of the target.
 *
 * After grading, all bets on the losing side are marked "lost" and all
 * bets on the winning side receive payouts proportional to their locked odds.
 *
 * @param predictionId - ID of the prediction to resolve
 * @returns The resolved prediction with resolution details
 */
export async function resolvePrediction(
  predictionId: string,
): Promise<typeof predictions.$inferSelect> {
  // Fetch prediction
  const [prediction] = await db
    .select()
    .from(predictions)
    .where(eq(predictions.id, predictionId))
    .limit(1);

  if (!prediction) {
    throw new Error(`Prediction ${predictionId} not found`);
  }
  if (prediction.status !== "active") {
    throw new Error(
      `Prediction ${predictionId} already resolved (status: ${prediction.status})`,
    );
  }

  // Fetch current market price
  const marketData = await getMarketData();
  const stock = marketData.find(
    (m) => m.symbol.toLowerCase() === prediction.symbol.toLowerCase(),
  );

  if (!stock) {
    // Cannot resolve — mark as expired
    const [resolved] = await db
      .update(predictions)
      .set({
        status: "expired",
        resolvedAt: new Date(),
        resolutionDetails: `Could not resolve: symbol ${prediction.symbol} no longer available in market data.`,
      })
      .where(eq(predictions.id, predictionId))
      .returning();
    return resolved;
  }

  const creationPrice = parseFloat(prediction.currentPriceAtCreation);
  const currentPrice = stock.price;
  const priceDelta = currentPrice - creationPrice;
  const priceDeltaPercent = (priceDelta / creationPrice) * 100;

  // Determine correctness based on prediction type
  let isCorrect = false;
  let resolutionDetails = "";

  switch (prediction.predictionType) {
    case "price_target": {
      const target = parseFloat(prediction.targetPrice ?? "0");
      // Correct if price is within 2% of target
      const tolerance = target * 0.02;
      const distance = Math.abs(currentPrice - target);
      isCorrect = distance <= tolerance;

      // Also correct if direction was right and price moved past target
      if (!isCorrect && prediction.direction === "bullish" && currentPrice >= target) {
        isCorrect = true;
      }
      if (!isCorrect && prediction.direction === "bearish" && currentPrice <= target) {
        isCorrect = true;
      }

      resolutionDetails = isCorrect
        ? `CORRECT: Target $${target.toFixed(2)}, actual $${currentPrice.toFixed(2)} (within ${((distance / target) * 100).toFixed(1)}%). Price moved ${priceDeltaPercent >= 0 ? "+" : ""}${priceDeltaPercent.toFixed(2)}% from entry.`
        : `INCORRECT: Target $${target.toFixed(2)}, actual $${currentPrice.toFixed(2)} (${((distance / target) * 100).toFixed(1)}% away). Price moved ${priceDeltaPercent >= 0 ? "+" : ""}${priceDeltaPercent.toFixed(2)}% from entry.`;
      break;
    }

    case "direction": {
      // Correct if price moved in the predicted direction by at least 0.1%
      const threshold = 0.1;
      if (prediction.direction === "bullish") {
        isCorrect = priceDeltaPercent >= threshold;
      } else if (prediction.direction === "bearish") {
        isCorrect = priceDeltaPercent <= -threshold;
      } else {
        // Neutral: price stayed within +/- 0.5%
        isCorrect = Math.abs(priceDeltaPercent) < 0.5;
      }

      resolutionDetails = isCorrect
        ? `CORRECT: Predicted ${prediction.direction}, price moved ${priceDeltaPercent >= 0 ? "+" : ""}${priceDeltaPercent.toFixed(2)}% ($${creationPrice.toFixed(2)} -> $${currentPrice.toFixed(2)}).`
        : `INCORRECT: Predicted ${prediction.direction}, price moved ${priceDeltaPercent >= 0 ? "+" : ""}${priceDeltaPercent.toFixed(2)}% ($${creationPrice.toFixed(2)} -> $${currentPrice.toFixed(2)}).`;
      break;
    }

    case "volatility": {
      // Correct if absolute price change matches expectation
      // bullish = expecting high volatility (>2% move), bearish = low vol (<1%)
      const absChange = Math.abs(priceDeltaPercent);
      if (prediction.direction === "bullish") {
        isCorrect = absChange >= 2.0;
      } else if (prediction.direction === "bearish") {
        isCorrect = absChange < 1.0;
      } else {
        isCorrect = absChange >= 0.5 && absChange < 2.0;
      }

      resolutionDetails = isCorrect
        ? `CORRECT: Predicted ${prediction.direction} volatility, actual move was ${absChange.toFixed(2)}%.`
        : `INCORRECT: Predicted ${prediction.direction} volatility, actual move was ${absChange.toFixed(2)}%.`;
      break;
    }

    case "outperform": {
      // Simplified: correct if the stock moved in the predicted direction
      // In a full implementation, this would compare against a benchmark index
      if (prediction.direction === "bullish") {
        isCorrect = priceDeltaPercent > 0;
      } else if (prediction.direction === "bearish") {
        isCorrect = priceDeltaPercent < 0;
      } else {
        isCorrect = Math.abs(priceDeltaPercent) < 1.0;
      }

      resolutionDetails = isCorrect
        ? `CORRECT: Predicted ${prediction.direction} outperformance, price moved ${priceDeltaPercent >= 0 ? "+" : ""}${priceDeltaPercent.toFixed(2)}%.`
        : `INCORRECT: Predicted ${prediction.direction} outperformance, price moved ${priceDeltaPercent >= 0 ? "+" : ""}${priceDeltaPercent.toFixed(2)}%.`;
      break;
    }

    default:
      resolutionDetails = `Unknown prediction type: ${prediction.predictionType}`;
  }

  const newStatus = isCorrect ? "resolved_correct" : "resolved_incorrect";

  // Update prediction
  const [resolved] = await db
    .update(predictions)
    .set({
      status: newStatus,
      resolvedAt: new Date(),
      resolutionPrice: String(currentPrice),
      resolutionDetails,
    })
    .where(eq(predictions.id, predictionId))
    .returning();

  // Distribute payouts
  const bets = await db
    .select()
    .from(predictionBets)
    .where(
      and(
        eq(predictionBets.predictionId, predictionId),
        eq(predictionBets.status, "active"),
      ),
    );

  // Winning side: "for" if correct, "against" if incorrect
  const winningSide = isCorrect ? "for" : "against";

  for (const bet of bets) {
    const betAmount = parseFloat(bet.amount);
    const betOdds = parseFloat(bet.odds);

    if (bet.position === winningSide) {
      // Winner: payout = amount * locked odds
      const payout = betAmount * betOdds;
      await db
        .update(predictionBets)
        .set({
          status: "won",
          payout: String(Math.round(payout * 100) / 100),
        })
        .where(eq(predictionBets.id, bet.id));
    } else {
      // Loser: loses entire wager
      await db
        .update(predictionBets)
        .set({
          status: "lost",
          payout: "0",
        })
        .where(eq(predictionBets.id, bet.id));
    }
  }

  // Close the market
  await db
    .update(predictionMarkets)
    .set({ status: "resolved" })
    .where(eq(predictionMarkets.predictionId, predictionId));

  console.log(
    `[Predictions] Resolved prediction ${predictionId}: ${newStatus} — ${resolutionDetails}`,
  );

  return resolved;
}

/**
 * Batch-resolve all expired predictions.
 *
 * Scans for active predictions whose expiresAt has passed and resolves
 * each one against current market data. Returns a summary of results.
 *
 * @returns Summary with counts of resolved, correct, and incorrect predictions
 */
export async function resolveExpiredPredictions(): Promise<{
  resolved: number;
  correct: number;
  incorrect: number;
  errors: number;
  details: string[];
}> {
  const now = new Date();

  // Find all active predictions that have expired
  const expired = await db
    .select()
    .from(predictions)
    .where(
      and(eq(predictions.status, "active"), lte(predictions.expiresAt, now)),
    );

  const result = {
    resolved: 0,
    correct: 0,
    incorrect: 0,
    errors: 0,
    details: [] as string[],
  };

  for (const pred of expired) {
    try {
      const resolved = await resolvePrediction(pred.id);
      result.resolved++;
      if (resolved.status === "resolved_correct") {
        result.correct++;
      } else {
        result.incorrect++;
      }
      result.details.push(
        `${pred.id} (${pred.symbol} ${pred.direction}): ${resolved.status}`,
      );
    } catch (error) {
      result.errors++;
      result.details.push(
        `${pred.id}: ERROR — ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  console.log(
    `[Predictions] Batch resolution: ${result.resolved} resolved (${result.correct} correct, ${result.incorrect} incorrect, ${result.errors} errors)`,
  );

  return result;
}

// ---------------------------------------------------------------------------
// Query Functions
// ---------------------------------------------------------------------------

/**
 * Get active predictions, optionally filtered by stock symbol.
 *
 * Returns predictions that are currently active (not yet resolved/expired)
 * along with their associated market data (pool sizes, odds).
 *
 * @param symbol - Optional stock symbol filter
 * @returns Array of active predictions with market data
 */
export async function getActivePredictions(symbol?: string) {
  let query = db
    .select()
    .from(predictions)
    .where(eq(predictions.status, "active"))
    .orderBy(desc(predictions.createdAt));

  const results = await query;

  // Filter by symbol if provided
  const filtered = symbol
    ? results.filter(
        (p) => p.symbol.toLowerCase() === symbol.toLowerCase(),
      )
    : results;

  // Attach market data for each prediction
  const withMarkets = await Promise.all(
    filtered.map(async (pred) => {
      const [market] = await db
        .select()
        .from(predictionMarkets)
        .where(eq(predictionMarkets.predictionId, pred.id))
        .limit(1);

      return {
        ...pred,
        market: market ?? null,
      };
    }),
  );

  return withMarkets;
}

/**
 * Get a single prediction by ID with full details.
 *
 * Includes the prediction itself, its market data, and all bets placed.
 *
 * @param id - Prediction ID
 * @returns Prediction with market and bets, or null if not found
 */
export async function getPredictionById(id: string) {
  const [prediction] = await db
    .select()
    .from(predictions)
    .where(eq(predictions.id, id))
    .limit(1);

  if (!prediction) return null;

  // Fetch market data
  const [market] = await db
    .select()
    .from(predictionMarkets)
    .where(eq(predictionMarkets.predictionId, id))
    .limit(1);

  // Fetch all bets
  const bets = await db
    .select()
    .from(predictionBets)
    .where(eq(predictionBets.predictionId, id))
    .orderBy(desc(predictionBets.createdAt));

  // Compute bet summary
  const forBets = bets.filter((b) => b.position === "for");
  const againstBets = bets.filter((b) => b.position === "against");

  return {
    ...prediction,
    market: market ?? null,
    bets,
    betSummary: {
      totalBets: bets.length,
      forBets: forBets.length,
      againstBets: againstBets.length,
      forVolume: forBets.reduce((sum, b) => sum + parseFloat(b.amount), 0),
      againstVolume: againstBets.reduce(
        (sum, b) => sum + parseFloat(b.amount),
        0,
      ),
      uniqueBettors: new Set(bets.map((b) => b.bettorId)).size,
    },
  };
}

/**
 * Get comprehensive prediction stats for a specific agent.
 *
 * Computes win rate, calibration score (how well confidence matches
 * actual accuracy), best/worst calls, and breakdowns by type and horizon.
 *
 * @param agentId - Agent ID to get stats for
 * @returns Full prediction accuracy statistics
 */
export async function getAgentPredictionStats(
  agentId: string,
): Promise<AgentPredictionStats> {
  const agentPredictions = await db
    .select()
    .from(predictions)
    .where(eq(predictions.agentId, agentId))
    .orderBy(desc(predictions.createdAt));

  const active = agentPredictions.filter((p) => p.status === "active");
  const resolved = agentPredictions.filter(
    (p) =>
      p.status === "resolved_correct" || p.status === "resolved_incorrect",
  );
  const correct = resolved.filter((p) => p.status === "resolved_correct");
  const incorrect = resolved.filter((p) => p.status === "resolved_incorrect");

  // Win rate
  const winRate =
    resolved.length > 0 ? correct.length / resolved.length : 0;

  // Average confidence
  const avgConfidence =
    agentPredictions.length > 0
      ? agentPredictions.reduce((sum, p) => sum + p.confidence, 0) /
        agentPredictions.length
      : 0;

  const avgConfidenceWhenCorrect =
    correct.length > 0
      ? correct.reduce((sum, p) => sum + p.confidence, 0) / correct.length
      : 0;

  const avgConfidenceWhenIncorrect =
    incorrect.length > 0
      ? incorrect.reduce((sum, p) => sum + p.confidence, 0) / incorrect.length
      : 0;

  // Calibration score: how close is confidence to actual accuracy?
  // Perfect calibration = 0, higher = worse calibration
  // Bucket predictions by confidence decile and compare to actual accuracy
  const calibrationBuckets = new Map<number, { total: number; correct: number }>();
  for (const pred of resolved) {
    const bucket = Math.floor(pred.confidence / 10) * 10;
    const entry = calibrationBuckets.get(bucket) ?? { total: 0, correct: 0 };
    entry.total++;
    if (pred.status === "resolved_correct") entry.correct++;
    calibrationBuckets.set(bucket, entry);
  }

  let calibrationError = 0;
  let calibrationBucketCount = 0;
  for (const [bucket, data] of calibrationBuckets) {
    if (data.total >= 2) {
      const expectedAccuracy = (bucket + 5) / 100; // midpoint of bucket
      const actualAccuracy = data.correct / data.total;
      calibrationError += Math.abs(expectedAccuracy - actualAccuracy);
      calibrationBucketCount++;
    }
  }
  // Score from 0 (worst) to 100 (perfect calibration)
  const calibrationScore =
    calibrationBucketCount > 0
      ? Math.max(
          0,
          Math.round(
            (1 - calibrationError / calibrationBucketCount) * 100,
          ),
        )
      : 50; // default if not enough data

  // Best and worst calls (by price delta)
  let bestCall: AgentPredictionStats["bestCall"] = null;
  let worstCall: AgentPredictionStats["worstCall"] = null;

  for (const pred of resolved) {
    const creation = parseFloat(pred.currentPriceAtCreation);
    const resolution = parseFloat(pred.resolutionPrice ?? "0");
    const delta = resolution - creation;
    const deltaPct = creation > 0 ? (delta / creation) * 100 : 0;

    // For correct predictions, bigger absolute delta = better call
    // For incorrect, bigger absolute delta = worse call
    if (pred.status === "resolved_correct") {
      if (!bestCall || Math.abs(deltaPct) > Math.abs(bestCall.priceDelta)) {
        bestCall = {
          symbol: pred.symbol,
          direction: pred.direction,
          confidence: pred.confidence,
          priceDelta: Math.round(deltaPct * 100) / 100,
        };
      }
    }
    if (pred.status === "resolved_incorrect") {
      if (!worstCall || Math.abs(deltaPct) > Math.abs(worstCall.priceDelta)) {
        worstCall = {
          symbol: pred.symbol,
          direction: pred.direction,
          confidence: pred.confidence,
          priceDelta: Math.round(deltaPct * 100) / 100,
        };
      }
    }
  }

  // Total bets and volume received
  let totalBetsReceived = 0;
  let totalPoolVolume = 0;

  for (const pred of agentPredictions) {
    const [market] = await db
      .select()
      .from(predictionMarkets)
      .where(eq(predictionMarkets.predictionId, pred.id))
      .limit(1);
    if (market) {
      totalBetsReceived += market.totalBets ?? 0;
      totalPoolVolume += parseFloat(market.totalPool ?? "0");
    }
  }

  // Breakdowns
  const predictionsByType: Record<string, number> = {};
  const predictionsByHorizon: Record<string, number> = {};
  for (const pred of agentPredictions) {
    predictionsByType[pred.predictionType] =
      (predictionsByType[pred.predictionType] ?? 0) + 1;
    predictionsByHorizon[pred.timeHorizon] =
      (predictionsByHorizon[pred.timeHorizon] ?? 0) + 1;
  }

  return {
    agentId,
    totalPredictions: agentPredictions.length,
    activePredictions: active.length,
    resolvedPredictions: resolved.length,
    correctPredictions: correct.length,
    incorrectPredictions: incorrect.length,
    winRate: Math.round(winRate * 10000) / 10000,
    avgConfidence: Math.round(avgConfidence * 10) / 10,
    avgConfidenceWhenCorrect: Math.round(avgConfidenceWhenCorrect * 10) / 10,
    avgConfidenceWhenIncorrect:
      Math.round(avgConfidenceWhenIncorrect * 10) / 10,
    calibrationScore,
    totalBetsReceived,
    totalPoolVolume: Math.round(totalPoolVolume * 100) / 100,
    bestCall,
    worstCall,
    predictionsByType,
    predictionsByHorizon,
  };
}

/**
 * Generate the prediction leaderboard ranking agents by accuracy.
 *
 * Agents are scored by a weighted combination of:
 *   - Win rate (40% weight)
 *   - Calibration score (30% weight)
 *   - Volume of bets received (20% weight — market trusts them)
 *   - Total predictions made (10% weight — consistency)
 *
 * @returns Array of leaderboard entries sorted by rank
 */
export async function getPredictionLeaderboard(): Promise<
  PredictionLeaderboardEntry[]
> {
  // Get distinct agent IDs with predictions
  const allPreds = await db
    .select()
    .from(predictions)
    .orderBy(desc(predictions.createdAt));

  const agentIds = [...new Set(allPreds.map((p) => p.agentId))];

  const entries: PredictionLeaderboardEntry[] = [];

  for (const agentId of agentIds) {
    const stats = await getAgentPredictionStats(agentId);

    // Composite score for ranking
    const winRateScore = stats.winRate * 40;
    const calibrationBonus = (stats.calibrationScore / 100) * 30;
    const volumeScore = Math.min(20, Math.log10(stats.totalPoolVolume + 1) * 5);
    const consistencyScore = Math.min(10, stats.totalPredictions * 0.5);
    const profitability =
      winRateScore + calibrationBonus + volumeScore + consistencyScore;

    entries.push({
      agentId,
      totalPredictions: stats.totalPredictions,
      resolvedPredictions: stats.resolvedPredictions,
      correctPredictions: stats.correctPredictions,
      winRate: stats.winRate,
      avgConfidence: stats.avgConfidence,
      calibrationScore: stats.calibrationScore,
      profitability: Math.round(profitability * 100) / 100,
      rank: 0, // assigned below
    });
  }

  // Sort by profitability descending and assign ranks
  entries.sort((a, b) => b.profitability - a.profitability);
  entries.forEach((entry, index) => {
    entry.rank = index + 1;
  });

  return entries;
}

/**
 * Get current market odds for a prediction.
 *
 * @param predictionId - Prediction ID
 * @returns Market odds data or null if not found
 */
export async function getMarketOdds(predictionId: string) {
  const [market] = await db
    .select()
    .from(predictionMarkets)
    .where(eq(predictionMarkets.predictionId, predictionId))
    .limit(1);

  if (!market) return null;

  const forPool = parseFloat(market.forPool ?? "0");
  const againstPool = parseFloat(market.againstPool ?? "0");
  const totalPool = parseFloat(market.totalPool ?? "0");

  // Real-time recalculation
  const liveOdds = calculateDynamicOdds(forPool, againstPool);

  // Implied probabilities
  const impliedProbFor =
    liveOdds.oddsFor > 0 ? (1 / liveOdds.oddsFor) * 100 : 50;
  const impliedProbAgainst =
    liveOdds.oddsAgainst > 0 ? (1 / liveOdds.oddsAgainst) * 100 : 50;

  return {
    predictionId,
    status: market.status,
    pools: {
      total: totalPool,
      for: forPool,
      against: againstPool,
      forPercent:
        totalPool > 0 ? Math.round((forPool / totalPool) * 10000) / 100 : 50,
      againstPercent:
        totalPool > 0
          ? Math.round((againstPool / totalPool) * 10000) / 100
          : 50,
    },
    odds: {
      for: liveOdds.oddsFor,
      against: liveOdds.oddsAgainst,
    },
    impliedProbability: {
      forPercent: Math.round(impliedProbFor * 100) / 100,
      againstPercent: Math.round(impliedProbAgainst * 100) / 100,
    },
    totalBets: market.totalBets,
  };
}

/**
 * Get the hottest predictions — those with the most betting activity.
 *
 * "Hot" is defined by total pool size (liquidity), which reflects
 * market interest and conviction on both sides.
 *
 * @returns Array of active predictions sorted by total pool volume
 */
export async function getHotPredictions() {
  // Get all open markets sorted by pool size
  const markets = await db
    .select()
    .from(predictionMarkets)
    .where(eq(predictionMarkets.status, "open"))
    .orderBy(desc(predictionMarkets.totalPool));

  const hotPredictions = await Promise.all(
    markets.slice(0, 20).map(async (market) => {
      const [pred] = await db
        .select()
        .from(predictions)
        .where(eq(predictions.id, market.predictionId))
        .limit(1);

      if (!pred || pred.status !== "active") return null;

      const forPool = parseFloat(market.forPool ?? "0");
      const againstPool = parseFloat(market.againstPool ?? "0");
      const totalPool = parseFloat(market.totalPool ?? "0");
      const odds = calculateDynamicOdds(forPool, againstPool);

      return {
        prediction: pred,
        market: {
          totalPool,
          forPool,
          againstPool,
          oddsFor: odds.oddsFor,
          oddsAgainst: odds.oddsAgainst,
          totalBets: market.totalBets,
        },
        heat: totalPool * (market.totalBets ?? 1),
      };
    }),
  );

  return hotPredictions
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .sort((a, b) => b.heat - a.heat);
}

/**
 * Get historical prediction data with pagination and filters.
 *
 * @param agentId - Optional agent ID filter
 * @param symbol  - Optional stock symbol filter
 * @param limit   - Number of results per page (default 20, max 100)
 * @param offset  - Pagination offset (default 0)
 * @returns Paginated prediction history with market data
 */
export async function getPredictionHistory(
  agentId?: string,
  symbol?: string,
  limit: number = 20,
  offset: number = 0,
) {
  const safeLimit = Math.min(100, Math.max(1, limit));
  const safeOffset = Math.max(0, offset);

  // Build conditions
  let allPredictions = await db
    .select()
    .from(predictions)
    .orderBy(desc(predictions.createdAt));

  // Apply filters
  if (agentId) {
    allPredictions = allPredictions.filter((p) => p.agentId === agentId);
  }
  if (symbol) {
    allPredictions = allPredictions.filter(
      (p) => p.symbol.toLowerCase() === symbol.toLowerCase(),
    );
  }

  const total = allPredictions.length;
  const page = allPredictions.slice(safeOffset, safeOffset + safeLimit);

  // Attach market data
  const withMarkets = await Promise.all(
    page.map(async (pred) => {
      const [market] = await db
        .select()
        .from(predictionMarkets)
        .where(eq(predictionMarkets.predictionId, pred.id))
        .limit(1);

      return {
        ...pred,
        market: market ?? null,
      };
    }),
  );

  return {
    predictions: withMarkets,
    pagination: {
      total,
      limit: safeLimit,
      offset: safeOffset,
      hasMore: safeOffset + safeLimit < total,
    },
  };
}
