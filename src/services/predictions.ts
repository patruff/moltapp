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
import { calculateAverage, averageByKey } from "../lib/math-utils.ts";
import { errorMessage } from "../lib/errors.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Database prediction type inferred from schema */
type Prediction = typeof predictions.$inferSelect;

/** Database bet type inferred from schema */
type Bet = typeof predictionBets.$inferSelect;

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

// ---------------------------------------------------------------------------
// Validation Constants
// ---------------------------------------------------------------------------

/** Valid prediction types for validation */
const VALID_PREDICTION_TYPES: PredictionType[] = ["price_target", "direction", "volatility", "outperform"];

/** Valid directions for validation */
const VALID_DIRECTIONS: PredictionDirection[] = ["bullish", "bearish", "neutral"];

/** Valid time horizons for validation */
const VALID_HORIZONS: TimeHorizon[] = ["1h", "4h", "1d", "1w", "1m"];

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * AMM Odds Calculation Parameters
 *
 * These control the automated market maker's odds computation, which determines
 * payout multipliers for prediction market bets.
 */

/**
 * Even odds baseline for empty markets.
 *
 * When a prediction market starts with zero bets on either side, both "for"
 * and "against" positions receive even 2.0x odds (equivalent to 50/50 probability).
 * This ensures fair initial pricing before the AMM pool balances shift.
 *
 * @example Empty market: 0 tokens FOR, 0 tokens AGAINST → 2.0x odds both sides
 */
const ODDS_EVEN = 2.0;

/**
 * Volatility Prediction Thresholds
 *
 * These thresholds control correctness grading for volatility-type predictions.
 * Volatility predictions classify whether absolute price movement falls into
 * high/medium/low volatility buckets based on percentage change thresholds.
 */

/**
 * Bullish volatility threshold (expecting high volatility).
 *
 * When an agent predicts "bullish" volatility, they expect the stock to move
 * significantly in EITHER direction (up or down). The prediction is correct
 * if absolute price change >= 2.0%.
 *
 * @example TSLAx moves +3.5% → absChange = 3.5 >= 2.0 → CORRECT bullish vol
 * @example NVDAx moves -2.8% → absChange = 2.8 >= 2.0 → CORRECT bullish vol
 * @example AAPLx moves +1.2% → absChange = 1.2 < 2.0 → INCORRECT bullish vol
 */
const VOLATILITY_BULLISH_THRESHOLD = 2.0;

/**
 * Bearish volatility threshold (expecting low volatility).
 *
 * When an agent predicts "bearish" volatility, they expect the stock to remain
 * relatively stable with minimal price movement. The prediction is correct
 * if absolute price change < 1.0%.
 *
 * @example AAPLx moves +0.4% → absChange = 0.4 < 1.0 → CORRECT bearish vol
 * @example MSFTx moves -0.7% → absChange = 0.7 < 1.0 → CORRECT bearish vol
 * @example TSLAx moves +1.5% → absChange = 1.5 >= 1.0 → INCORRECT bearish vol
 */
const VOLATILITY_BEARISH_THRESHOLD = 1.0;

/**
 * Neutral volatility range (expecting moderate volatility).
 *
 * When an agent predicts "neutral" volatility, they expect moderate price
 * movement — neither extremely volatile nor completely flat. The prediction
 * is correct if absolute price change falls in [0.5%, 2.0%) range.
 *
 * @example GOOGx moves +1.2% → absChange = 1.2 in [0.5, 2.0) → CORRECT neutral vol
 * @example METAx moves -0.8% → absChange = 0.8 in [0.5, 2.0) → CORRECT neutral vol
 * @example TSLAx moves +2.5% → absChange = 2.5 >= 2.0 → INCORRECT neutral vol
 * @example AAPLx moves +0.3% → absChange = 0.3 < 0.5 → INCORRECT neutral vol
 */
const VOLATILITY_NEUTRAL_MIN = 0.5;
const VOLATILITY_NEUTRAL_MAX = 2.0;

/**
 * Outperform neutral threshold (expecting minimal relative movement).
 *
 * When an agent predicts "neutral" outperformance, they expect the stock to
 * track the benchmark closely with minimal deviation. The prediction is correct
 * if absolute price change < 1.0% (simplified benchmark comparison).
 *
 * Note: Full implementation would compare against SPY/QQQ benchmark returns.
 *
 * @example AAPLx moves +0.6% → absChange = 0.6 < 1.0 → CORRECT neutral outperform
 * @example NVDAx moves +1.8% → absChange = 1.8 >= 1.0 → INCORRECT neutral outperform
 */
const OUTPERFORM_NEUTRAL_THRESHOLD = 1.0;

/**
 * Maximum odds ceiling to prevent infinite payouts.
 *
 * Caps the highest payout multiplier at 100x when a market becomes extremely
 * one-sided (e.g., 99% of pool on one side). Prevents single-sided pools from
 * offering infinite odds when the denominator approaches zero.
 *
 * @example One-sided pool: 1000 FOR, 0 AGAINST → caps at 100x (not infinity)
 */
const MAX_ODDS = 100.0;

/**
 * Minimum odds floor to ensure payouts exceed wagers.
 *
 * Guarantees all winning bets receive at least 1.01x their wager, even in
 * heavily skewed markets. Prevents scenarios where winners receive less than
 * their original stake.
 *
 * @example Heavily skewed: 1000 FOR, 10 AGAINST → FOR odds floored at 1.01x
 */
const MIN_ODDS = 1.01;

/**
 * Decimal precision for odds rounding.
 *
 * Odds are rounded to 4 decimal places (e.g., 2.3456x) for display consistency
 * and to prevent floating-point precision issues in payout calculations.
 */
const ODDS_DECIMAL_PRECISION = 4;

/**
 * Payout Calculation Parameters
 *
 * Control how bet payouts are computed and rounded after prediction resolution.
 */

/**
 * Decimal precision for payout rounding.
 *
 * All payouts are rounded to 2 decimal places (cents) to match standard token
 * display format. Prevents sub-cent payout dust in user balances.
 *
 * @example Payout calculation: 125.456 tokens → 125.46 tokens (rounded to cents)
 */
const PAYOUT_DECIMAL_PRECISION = 2;

/**
 * Bet Limits and Validation
 *
 * Enforce betting boundaries to prevent abuse and maintain market stability.
 */

/**
 * Maximum single bet amount in virtual tokens.
 *
 * Caps individual bets at 100,000 tokens to prevent whale manipulation of odds
 * and to maintain fair market dynamics. Large bets shift AMM odds dramatically.
 *
 * @example Valid bet: 50,000 tokens (allowed)
 * @example Invalid bet: 150,000 tokens (rejected, exceeds MAX_BET_AMOUNT)
 */
const MAX_BET_AMOUNT = 100000;

/**
 * Prediction Resolution Thresholds
 *
 * Control how predictions are graded as correct/incorrect against actual market data.
 */

/**
 * Price target tolerance as a fraction of target price.
 *
 * For price_target predictions, the actual price must be within ±2% of the
 * predicted target to count as correct. Allows minor variance in exact price hits.
 *
 * @example Target $100, actual $98 → within 2% tolerance → CORRECT
 * @example Target $100, actual $95 → outside 2% tolerance → INCORRECT
 */
const PRICE_TARGET_TOLERANCE = 0.02;

/**
 * Minimum price movement for directional predictions (percentage).
 *
 * Directional "bullish" or "bearish" calls must see at least 0.1% price movement
 * in the predicted direction to count as correct. Prevents trivial sub-0.1% moves
 * from validating predictions.
 *
 * @example Bullish call: +0.15% move → CORRECT (exceeds 0.1% threshold)
 * @example Bullish call: +0.05% move → INCORRECT (below 0.1% threshold)
 */
const DIRECTION_MIN_MOVE_PCT = 0.1;

/**
 * Neutral direction tolerance band (percentage).
 *
 * For "neutral" directional predictions, the price must stay within ±0.5% of the
 * entry price to count as correct. Defines the acceptable range for "sideways" moves.
 *
 * @example Neutral call: -0.3% move → CORRECT (within ±0.5% band)
 * @example Neutral call: +0.8% move → INCORRECT (exceeds ±0.5% band)
 */
const DIRECTION_NEUTRAL_TOLERANCE_PCT = 0.5;

/**
 * Calibration Analysis Parameters
 *
 * Control how agent confidence calibration is measured against actual accuracy.
 */

/**
 * Confidence bucket size for calibration analysis (percentage points).
 *
 * Agent predictions are grouped into 10-point confidence buckets (0-9%, 10-19%, etc.)
 * to compare stated confidence against actual win rate. Larger buckets = coarser analysis.
 *
 * @example 75% confidence → bucket 70-79% → compare 75% stated vs actual win rate in bucket
 */
const CALIBRATION_BUCKET_SIZE = 10;

/**
 * Minimum predictions per calibration bucket for statistical significance.
 *
 * Buckets with fewer than 2 predictions are excluded from calibration error calculation
 * to avoid drawing conclusions from insufficient sample sizes.
 *
 * @example Bucket with 1 prediction → excluded (insufficient data)
 * @example Bucket with 5 predictions → included (meets MIN_BUCKET_SAMPLES)
 */
const CALIBRATION_MIN_BUCKET_SAMPLES = 2;

/**
 * Default calibration score when insufficient data exists.
 *
 * If an agent has too few predictions to compute meaningful calibration error,
 * return neutral 50/100 score. Avoids penalizing agents with limited track records.
 *
 * @example Agent with 0 resolved predictions → calibration score = 50 (neutral)
 */
const CALIBRATION_DEFAULT_SCORE = 50;

/**
 * Calibration Bucket Midpoint Offset
 *
 * When converting a bucket's lower bound to an expected accuracy percentage,
 * add half the bucket size to get the midpoint. For 10-point buckets (0-9%,
 * 10-19%, etc.) the midpoint is bucket + 5.
 *
 * Formula: expectedAccuracy = (bucket + MIDPOINT_OFFSET) / SCORE_MULTIPLIER
 * Example: bucket=70 → (70 + 5) / 100 = 0.75 (75% expected accuracy)
 */
const CALIBRATION_BUCKET_MIDPOINT_OFFSET = CALIBRATION_BUCKET_SIZE / 2;

/**
 * Calibration Score Multiplier
 *
 * Converts a decimal fraction (0.0–1.0) to a 0–100 integer score and converts
 * decimal probabilities to percentage form.
 *
 * Used in:
 *  - calibrationScore: Math.round((1 - error) × 100) → integer 0–100
 *  - deltaPct: (delta / creation) × 100 → price change as percentage
 *
 * Example: calibration error 0.12 → score = round((1 - 0.12) × 100) = 88
 */
const CALIBRATION_SCORE_MULTIPLIER = 100;

/**
 * Leaderboard Ranking Weights
 *
 * Control how agents are scored and ranked in the prediction leaderboard composite metric.
 */

/**
 * Win rate weight in leaderboard profitability score.
 *
 * Win rate contributes 40% to the composite profitability metric. Highest weight
 * because prediction accuracy is the primary skill being measured.
 *
 * @example 80% win rate → contributes 32 points (0.80 × 40) to profitability
 */
const LEADERBOARD_WEIGHT_WIN_RATE = 40;

/**
 * Calibration score weight in leaderboard profitability score.
 *
 * Calibration contributes 30% to composite profitability. Rewards agents whose
 * confidence levels accurately match their actual win rates.
 *
 * @example 90 calibration score → contributes 27 points (0.90 × 30) to profitability
 */
const LEADERBOARD_WEIGHT_CALIBRATION = 30;

/**
 * Volume weight in leaderboard profitability score.
 *
 * Betting volume received contributes up to 20% to composite profitability. Rewards
 * agents whose predictions attract market participation (trust signal).
 *
 * Calculated as: min(20, log10(totalPoolVolume + 1) × 5)
 *
 * @example 1,000 tokens volume → ~15 points, 10,000 tokens → 20 points (capped)
 */
const LEADERBOARD_WEIGHT_VOLUME = 20;

/**
 * Volume score logarithm multiplier.
 *
 * Multiplier applied to log10(volume + 1) to scale volume score to 0-20 range.
 * Logarithmic scaling prevents whale volumes from dominating rankings.
 */
const LEADERBOARD_VOLUME_LOG_MULTIPLIER = 5;

/**
 * Consistency weight in leaderboard profitability score.
 *
 * Total predictions made contributes up to 10% to composite profitability. Rewards
 * agents who make consistent forecasts rather than one-off predictions.
 *
 * Calculated as: min(10, totalPredictions × 0.5)
 *
 * @example 5 predictions → 2.5 points, 20+ predictions → 10 points (capped)
 */
const LEADERBOARD_WEIGHT_CONSISTENCY = 10;

/**
 * Consistency score per-prediction multiplier.
 *
 * Each prediction contributes 0.5 points to consistency score, capped at
 * LEADERBOARD_WEIGHT_CONSISTENCY. Encourages regular prediction activity.
 */
const LEADERBOARD_CONSISTENCY_PER_PREDICTION = 0.5;

/**
 * Query Limits
 *
 * Default pagination and result set sizes for prediction history queries.
 */

/**
 * Maximum predictions returned in single query.
 *
 * Hard cap for getPredictionHistory() limit parameter. Prevents resource exhaustion
 * from requests for thousands of predictions at once.
 *
 * @example User requests limit=500 → clamped to 100 (MAX_QUERY_LIMIT)
 */
const MAX_QUERY_LIMIT = 100;

/**
 * Default predictions per page when limit not specified.
 *
 * Standard page size for pagination in getPredictionHistory(). Balances UX
 * (showing meaningful results) vs performance (avoiding large query overhead).
 *
 * @example getPredictionHistory() with no limit → returns 20 predictions
 */
const DEFAULT_QUERY_LIMIT = 20;

/**
 * Maximum hot predictions displayed.
 *
 * Top N predictions by pool volume shown in getHotPredictions(). Focuses on
 * the most actively traded markets with highest liquidity.
 *
 * @example getHotPredictions() → returns top 20 predictions by total pool size
 */
const HOT_PREDICTIONS_DISPLAY_LIMIT = 20;

/**
 * Even-Split Percent Default
 *
 * Fallback value (50%) used when a denominator is zero and an even split
 * assumption is appropriate:
 *   - Pool percentage: when totalPool === 0 both sides show 50%
 *   - Implied probability: when odds are 0 (no market yet) default to 50%
 *
 * Formula: forPercent = totalPool > 0 ? (forPool / totalPool) * 100 : EVEN_SPLIT_PERCENT
 * Example: empty pool → forPercent = 50, againstPercent = 50 (50/50 split)
 */
const EVEN_SPLIT_PERCENT = 50;

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
// Utility Functions
// ---------------------------------------------------------------------------

/**
 * Round a number to a specified number of decimal places.
 *
 * @param value - The number to round
 * @param decimals - Number of decimal places
 * @returns Rounded number
 */
function roundTo(value: number, decimals: number): number {
  const multiplier = Math.pow(10, decimals);
  return Math.round(value * multiplier) / multiplier;
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
    return { oddsFor: ODDS_EVEN, oddsAgainst: ODDS_EVEN };
  }

  // One-sided markets — cap at MAX_ODDS, floor at MIN_ODDS
  let oddsFor = forPool > 0 ? totalPool / forPool : MAX_ODDS;
  let oddsAgainst = againstPool > 0 ? totalPool / againstPool : MAX_ODDS;

  oddsFor = Math.max(MIN_ODDS, Math.min(MAX_ODDS, oddsFor));
  oddsAgainst = Math.max(MIN_ODDS, Math.min(MAX_ODDS, oddsAgainst));

  return {
    oddsFor: roundTo(oddsFor, ODDS_DECIMAL_PRECISION),
    oddsAgainst: roundTo(oddsAgainst, ODDS_DECIMAL_PRECISION),
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
  if (!VALID_PREDICTION_TYPES.includes(predictionType)) {
    throw new Error(`Invalid prediction type: ${predictionType}. Must be one of: ${VALID_PREDICTION_TYPES.join(", ")}`);
  }

  // Validate direction
  if (!VALID_DIRECTIONS.includes(direction)) {
    throw new Error(`Invalid direction: ${direction}. Must be one of: ${VALID_DIRECTIONS.join(", ")}`);
  }

  // Validate time horizon
  if (!VALID_HORIZONS.includes(timeHorizon)) {
    throw new Error(`Invalid time horizon: ${timeHorizon}. Must be one of: ${VALID_HORIZONS.join(", ")}`);
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
  if (amount > MAX_BET_AMOUNT) {
    throw new Error(`Maximum bet amount is ${MAX_BET_AMOUNT.toLocaleString()} tokens`);
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
  const priceDeltaPercent = (priceDelta / creationPrice) * CALIBRATION_SCORE_MULTIPLIER;

  // Determine correctness based on prediction type
  let isCorrect = false;
  let resolutionDetails = "";

  switch (prediction.predictionType) {
    case "price_target": {
      const target = parseFloat(prediction.targetPrice ?? "0");
      // Correct if price is within PRICE_TARGET_TOLERANCE of target
      const tolerance = target * PRICE_TARGET_TOLERANCE;
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
      // Correct if price moved in the predicted direction by at least DIRECTION_MIN_MOVE_PCT
      if (prediction.direction === "bullish") {
        isCorrect = priceDeltaPercent >= DIRECTION_MIN_MOVE_PCT;
      } else if (prediction.direction === "bearish") {
        isCorrect = priceDeltaPercent <= -DIRECTION_MIN_MOVE_PCT;
      } else {
        // Neutral: price stayed within +/- DIRECTION_NEUTRAL_TOLERANCE_PCT
        isCorrect = Math.abs(priceDeltaPercent) < DIRECTION_NEUTRAL_TOLERANCE_PCT;
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
        isCorrect = absChange >= VOLATILITY_BULLISH_THRESHOLD;
      } else if (prediction.direction === "bearish") {
        isCorrect = absChange < VOLATILITY_BEARISH_THRESHOLD;
      } else {
        isCorrect = absChange >= VOLATILITY_NEUTRAL_MIN && absChange < VOLATILITY_NEUTRAL_MAX;
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
        isCorrect = Math.abs(priceDeltaPercent) < OUTPERFORM_NEUTRAL_THRESHOLD;
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
          payout: String(roundTo(payout, 2)),
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
        `${pred.id}: ERROR — ${errorMessage(error)}`,
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
        (p: Prediction) => p.symbol.toLowerCase() === symbol.toLowerCase(),
      )
    : results;

  // Attach market data for each prediction
  const withMarkets = await Promise.all(
    filtered.map(async (pred: Prediction) => {
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
  const forBets = bets.filter((b: Bet) => b.position === "for");
  const againstBets = bets.filter((b: Bet) => b.position === "against");

  return {
    ...prediction,
    market: market ?? null,
    bets,
    betSummary: {
      totalBets: bets.length,
      forBets: forBets.length,
      againstBets: againstBets.length,
      forVolume: forBets.reduce((sum: number, b: Bet) => sum + parseFloat(b.amount), 0),
      againstVolume: againstBets.reduce(
        (sum: number, b: Bet) => sum + parseFloat(b.amount),
        0,
      ),
      uniqueBettors: new Set(bets.map((b: Bet) => b.bettorId)).size,
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

  const active = agentPredictions.filter((p: Prediction) => p.status === "active");
  const resolved = agentPredictions.filter(
    (p: Prediction) =>
      p.status === "resolved_correct" || p.status === "resolved_incorrect",
  );
  const correct = resolved.filter((p: Prediction) => p.status === "resolved_correct");
  const incorrect = resolved.filter((p: Prediction) => p.status === "resolved_incorrect");

  // Win rate
  const winRate =
    resolved.length > 0 ? correct.length / resolved.length : 0;

  // Average confidence
  const avgConfidence = averageByKey(agentPredictions, 'confidence');
  const avgConfidenceWhenCorrect = averageByKey(correct, 'confidence');
  const avgConfidenceWhenIncorrect = averageByKey(incorrect, 'confidence');

  // Calibration score: how close is confidence to actual accuracy?
  // Perfect calibration = 0, higher = worse calibration
  // Bucket predictions by confidence decile and compare to actual accuracy
  const calibrationBuckets = new Map<number, { total: number; correct: number }>();
  for (const pred of resolved) {
    const bucket = Math.floor(pred.confidence / CALIBRATION_BUCKET_SIZE) * CALIBRATION_BUCKET_SIZE;
    const entry = calibrationBuckets.get(bucket) ?? { total: 0, correct: 0 };
    entry.total++;
    if (pred.status === "resolved_correct") entry.correct++;
    calibrationBuckets.set(bucket, entry);
  }

  let calibrationError = 0;
  let calibrationBucketCount = 0;
  for (const [bucket, data] of calibrationBuckets) {
    if (data.total >= CALIBRATION_MIN_BUCKET_SAMPLES) {
      const expectedAccuracy = (bucket + CALIBRATION_BUCKET_MIDPOINT_OFFSET) / CALIBRATION_SCORE_MULTIPLIER; // midpoint of bucket
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
            (1 - calibrationError / calibrationBucketCount) * CALIBRATION_SCORE_MULTIPLIER,
          ),
        )
      : CALIBRATION_DEFAULT_SCORE; // default if not enough data

  // Best and worst calls (by price delta)
  let bestCall: AgentPredictionStats["bestCall"] = null;
  let worstCall: AgentPredictionStats["worstCall"] = null;

  for (const pred of resolved) {
    const creation = parseFloat(pred.currentPriceAtCreation);
    const resolution = parseFloat(pred.resolutionPrice ?? "0");
    const delta = resolution - creation;
    const deltaPct = creation > 0 ? (delta / creation) * CALIBRATION_SCORE_MULTIPLIER : 0;

    // For correct predictions, bigger absolute delta = better call
    // For incorrect, bigger absolute delta = worse call
    if (pred.status === "resolved_correct") {
      if (!bestCall || Math.abs(deltaPct) > Math.abs(bestCall.priceDelta)) {
        bestCall = {
          symbol: pred.symbol,
          direction: pred.direction,
          confidence: pred.confidence,
          priceDelta: roundTo(deltaPct, 2),
        };
      }
    }
    if (pred.status === "resolved_incorrect") {
      if (!worstCall || Math.abs(deltaPct) > Math.abs(worstCall.priceDelta)) {
        worstCall = {
          symbol: pred.symbol,
          direction: pred.direction,
          confidence: pred.confidence,
          priceDelta: roundTo(deltaPct, 2),
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
    winRate: roundTo(winRate, 4),
    avgConfidence: roundTo(avgConfidence, 1),
    avgConfidenceWhenCorrect: roundTo(avgConfidenceWhenCorrect, 1),
    avgConfidenceWhenIncorrect: roundTo(avgConfidenceWhenIncorrect, 1),
    calibrationScore,
    totalBetsReceived,
    totalPoolVolume: roundTo(totalPoolVolume, 2),
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

  const agentIds = [...new Set(allPreds.map((p: Prediction) => p.agentId))];

  const entries: PredictionLeaderboardEntry[] = [];

  for (const agentId of agentIds) {
    const stats = await getAgentPredictionStats(agentId as string);

    // Composite score for ranking
    const winRateScore = stats.winRate * LEADERBOARD_WEIGHT_WIN_RATE;
    const calibrationBonus = (stats.calibrationScore / CALIBRATION_SCORE_MULTIPLIER) * LEADERBOARD_WEIGHT_CALIBRATION;
    const volumeScore = Math.min(LEADERBOARD_WEIGHT_VOLUME, Math.log10(stats.totalPoolVolume + 1) * LEADERBOARD_VOLUME_LOG_MULTIPLIER);
    const consistencyScore = Math.min(LEADERBOARD_WEIGHT_CONSISTENCY, stats.totalPredictions * LEADERBOARD_CONSISTENCY_PER_PREDICTION);
    const profitability =
      winRateScore + calibrationBonus + volumeScore + consistencyScore;

    entries.push({
      agentId: agentId as string,
      totalPredictions: stats.totalPredictions,
      resolvedPredictions: stats.resolvedPredictions,
      correctPredictions: stats.correctPredictions,
      winRate: stats.winRate,
      avgConfidence: stats.avgConfidence,
      calibrationScore: stats.calibrationScore,
      profitability: roundTo(profitability, 2),
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

  // Implied probabilities: (1 / decimalOdds) * 100 gives a 0-100 percentage
  const impliedProbFor =
    liveOdds.oddsFor > 0 ? (1 / liveOdds.oddsFor) * CALIBRATION_SCORE_MULTIPLIER : EVEN_SPLIT_PERCENT;
  const impliedProbAgainst =
    liveOdds.oddsAgainst > 0 ? (1 / liveOdds.oddsAgainst) * CALIBRATION_SCORE_MULTIPLIER : EVEN_SPLIT_PERCENT;

  return {
    predictionId,
    status: market.status,
    pools: {
      total: totalPool,
      for: forPool,
      against: againstPool,
      forPercent:
        totalPool > 0 ? roundTo((forPool / totalPool) * CALIBRATION_SCORE_MULTIPLIER, 2) : EVEN_SPLIT_PERCENT,
      againstPercent:
        totalPool > 0
          ? roundTo((againstPool / totalPool) * CALIBRATION_SCORE_MULTIPLIER, 2)
          : EVEN_SPLIT_PERCENT,
    },
    odds: {
      for: liveOdds.oddsFor,
      against: liveOdds.oddsAgainst,
    },
    impliedProbability: {
      // impliedProbFor is already 0-100 (percentage), so no further multiplication needed
      forPercent: roundTo(impliedProbFor, 2),
      againstPercent: roundTo(impliedProbAgainst, 2),
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
    markets.slice(0, HOT_PREDICTIONS_DISPLAY_LIMIT).map(async (market: typeof predictionMarkets.$inferSelect) => {
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
  const safeLimit = Math.min(MAX_QUERY_LIMIT, Math.max(1, limit));
  const safeOffset = Math.max(0, offset);

  // Build conditions
  let allPredictions = await db
    .select()
    .from(predictions)
    .orderBy(desc(predictions.createdAt));

  // Apply filters
  if (agentId) {
    allPredictions = allPredictions.filter((p: Prediction) => p.agentId === agentId);
  }
  if (symbol) {
    allPredictions = allPredictions.filter(
      (p: Prediction) => p.symbol.toLowerCase() === symbol.toLowerCase(),
    );
  }

  const total = allPredictions.length;
  const page = allPredictions.slice(safeOffset, safeOffset + safeLimit);

  // Attach market data
  const withMarkets = await Promise.all(
    page.map(async (pred: Prediction) => {
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
