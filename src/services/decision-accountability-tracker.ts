/**
 * Decision Accountability Tracker (v20)
 *
 * Closes the feedback loop between agent PREDICTIONS and OUTCOMES.
 * Unlike simple P&L tracking, this measures the quality of the agent's
 * reasoning PROCESS by checking if the specific claims it made came true.
 *
 * Key features:
 * 1. CLAIM REGISTRATION: Records specific verifiable claims at trade time
 * 2. OUTCOME RESOLUTION: Checks claims against subsequent market data
 * 3. ACCOUNTABILITY SCORING: Rates each agent's claim accuracy over time
 * 4. LEARNING DETECTION: Measures whether agents improve their claims
 * 5. OVERCONFIDENCE MAPPING: Identifies systematic overconfidence patterns
 *
 * This is the "receipts" engine — every claim an agent makes gets checked.
 */

import { countByCondition } from "../lib/math-utils.ts";
import { ID_RANDOM_START, ID_RANDOM_LENGTH_SHORT } from "../config/constants.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Claim Resolution Thresholds
 *
 * These constants control when directional and price target claims are
 * classified as verified vs contradicted by market data.
 */

/**
 * Flat direction classification threshold (1%)
 *
 * For "flat" directional claims, price moves ≤ this threshold classify as correct.
 *
 * Example: Hold claim with 0.8% move = correct; 1.5% move = incorrect
 *
 * Tuning impact: Raise to 2% to be more forgiving of "flat" predictions
 */
const CLAIM_FLAT_CLASSIFICATION_THRESHOLD = 0.01;

/**
 * Flat resolution threshold (2%)
 *
 * When resolving flat directional claims at expiration, movements < this
 * threshold count as flat (correct).
 *
 * Example: Flat prediction with 1.8% move at expiration = correct
 *
 * Tuning impact: Lower to 1.5% to be stricter on flat claims
 */
const CLAIM_FLAT_RESOLUTION_THRESHOLD = 0.02;

/**
 * Price target tolerance (5%)
 *
 * For price target claims, allow ±this % tolerance around target price.
 *
 * Example: Target $100, current $103 = 3% deviation = correct within 5% tolerance
 *
 * Tuning impact: Lower to 3% for stricter price target verification
 */
const PRICE_TARGET_TOLERANCE = 0.05;

/**
 * Confidence Bucket Definitions
 *
 * Constants for grouping claims by confidence level to detect overconfidence patterns.
 */

/**
 * Confidence bucket boundaries
 *
 * Array defining min/max confidence ranges for bucketing claims.
 * Used to detect if agents are well-calibrated (high conf = high accuracy).
 */
const CONFIDENCE_BUCKET_BOUNDARIES = [
  { label: "0.0-0.2", min: 0.0, max: 0.2 },
  { label: "0.2-0.4", min: 0.2, max: 0.4 },
  { label: "0.4-0.6", min: 0.4, max: 0.6 },
  { label: "0.6-0.8", min: 0.6, max: 0.8 },
  { label: "0.8-1.0", min: 0.8, max: 1.0 },
] as const;

/**
 * Upper bound offset for max bucket inclusion
 *
 * Set to 1.01 to include claims with confidence = 1.0 in the 0.8-1.0 bucket
 * (otherwise they'd be excluded by strict < comparison).
 *
 * Tuning impact: Not user-tunable (technical fix for inclusive upper bound)
 */
const CONFIDENCE_BUCKET_UPPER_OFFSET = 1.01;

/**
 * Overconfidence Detection Threshold
 *
 * High confidence threshold for overconfidence analysis.
 */

/**
 * High confidence threshold (70%)
 *
 * Claims with confidence > this value are classified as "high confidence".
 * Used to detect overconfidence (high conf + low accuracy = overconfident agent).
 *
 * Example: Confidence 75% claim that fails → contributes to overconfidence rate
 *
 * Tuning impact: Raise to 80% to only flag extreme overconfidence
 */
const HIGH_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Learning Trend Detection Thresholds
 *
 * Constants for detecting whether agents are improving, stable, or declining in accuracy.
 */

/**
 * Learning trend improvement threshold (5%)
 *
 * If recent accuracy exceeds historical accuracy by > this %, classify as "improving".
 *
 * Example: Historical 60% → recent 66% = +6% improvement → "improving" trend
 *
 * Tuning impact: Lower to 3% to detect improvement earlier; raise to 8% for stricter classification
 */
const LEARNING_TREND_IMPROVEMENT_THRESHOLD = 0.05;

/**
 * Learning trend decline threshold (5%)
 *
 * If recent accuracy falls below historical accuracy by > this %, classify as "declining".
 *
 * Example: Historical 65% → recent 58% = -7% decline → "declining" trend
 *
 * Tuning impact: Same as improvement threshold (symmetric)
 */
const LEARNING_TREND_DECLINE_THRESHOLD = 0.05;

/**
 * Composite Accountability Score Weights
 *
 * These weights determine how different metrics combine to produce the overall
 * accountability score (0-1). Weights must sum to 1.0.
 */

/**
 * Accuracy rate weight (35%)
 *
 * Percentage of resolved claims that were correct. Primary accountability metric.
 *
 * Example: 80% accuracy contributes 0.8 * 0.35 = 0.28 to composite score
 *
 * Tuning impact: Raise to 40% to emphasize raw accuracy over calibration
 */
const ACCOUNTABILITY_WEIGHT_ACCURACY = 0.35;

/**
 * Overconfidence penalty weight (25%)
 *
 * Penalty for making high-confidence claims that fail. Rewards calibration.
 *
 * Example: 20% overconfidence contributes (1 - 0.2) * 0.25 = 0.20 to score
 *
 * Tuning impact: Raise to 30% to penalize overconfidence more heavily
 */
const ACCOUNTABILITY_WEIGHT_OVERCONFIDENCE = 0.25;

/**
 * Learning trend weight (20%)
 *
 * Bonus/penalty for improving/declining accuracy. Rewards agent learning.
 *
 * Example: "improving" trend contributes 0.8 * 0.20 = 0.16 to score
 *
 * Tuning impact: Lower to 15% to reduce emphasis on trend vs current accuracy
 */
const ACCOUNTABILITY_WEIGHT_LEARNING_TREND = 0.20;

/**
 * Resolved claims volume weight (20%)
 *
 * Bonus for having sufficient sample size. Rewards agents making verifiable claims.
 *
 * Example: 15 resolved claims contributes min(1, 15/20) * 0.20 = 0.15 to score
 *
 * Tuning impact: Lower to 15% if you want less emphasis on claim volume
 */
const ACCOUNTABILITY_WEIGHT_VOLUME = 0.20;

/**
 * Claims count normalization divisor
 *
 * Normalize resolved claim count to 0-1 by dividing by this value (20 claims).
 * Reaching 20+ resolved claims = 1.0 volume score.
 *
 * Example: 10 resolved claims = 10/20 = 0.5 volume score
 *
 * Tuning impact: Lower to 15 to reach full volume score faster; raise to 30 for stricter requirement
 */
const CLAIMS_VOLUME_NORMALIZATION = 20;

/**
 * Learning Trend Score Values
 *
 * Score values (0-1) assigned to each learning trend classification.
 */

/**
 * Improving trend score (0.8)
 *
 * Score multiplier when agent shows improving accuracy trend.
 */
const LEARNING_TREND_SCORE_IMPROVING = 0.8;

/**
 * Stable trend score (0.5)
 *
 * Score multiplier when agent shows stable accuracy (no significant change).
 */
const LEARNING_TREND_SCORE_STABLE = 0.5;

/**
 * Declining trend score (0.2)
 *
 * Score multiplier when agent shows declining accuracy trend (penalty).
 */
const LEARNING_TREND_SCORE_DECLINING = 0.2;

/**
 * Price Target Validation Parameters
 *
 * Constants for extracting and validating price target claims from agent reasoning.
 */

/**
 * Price target minimum value ($0)
 *
 * Lower bound for valid price targets. Targets ≤ this are rejected as invalid.
 *
 * Example: Target $0 or negative = invalid (rejected)
 *
 * Tuning impact: Not user-tunable (prevents obviously invalid targets)
 */
const PRICE_TARGET_MIN = 0;

/**
 * Price target maximum value ($100,000)
 *
 * Upper bound for valid price targets. Targets > this are rejected as unrealistic.
 *
 * Example: Target $150,000 = invalid (rejected as extraction error)
 *
 * Tuning impact: Lower to $50,000 if you want to reject extreme outliers
 */
const PRICE_TARGET_MAX = 100000;

/**
 * Price targets display limit (3)
 *
 * Maximum number of price target claims to extract from a single decision.
 * Prevents spam from agents listing many targets.
 *
 * Example: Agent mentions 5 targets, only first 3 are registered
 *
 * Tuning impact: Raise to 5 if you want to track more targets per decision
 */
const PRICE_TARGETS_MAX_COUNT = 3;

/**
 * Time Horizon Pattern Recognition
 *
 * Constants defining hour durations for common time horizon phrases in agent reasoning.
 */

/**
 * One-week horizon hours (168 = 7 days)
 *
 * Duration for "next week", "coming week" claims.
 * Represents one calendar week.
 *
 * Example: "Next week should see upside" → 7-day claim
 *
 * Tuning impact: Not user-tunable (standard week definition)
 */
const HORIZON_HOURS_ONE_WEEK = 168;

/**
 * Medium-term horizon hours (720 = 30 days)
 *
 * Duration for "medium-term", "next month", "coming weeks" claims.
 * Represents one month.
 *
 * Example: "Medium-term outlook positive" → 30-day claim
 *
 * Tuning impact: Raise to 1440 (60 days) for longer medium-term window
 */
const HORIZON_HOURS_MEDIUM_TERM = 720;

/**
 * Long-term horizon hours (2160 = 90 days)
 *
 * Duration for "long-term", "next quarter", "several months" claims.
 * Represents one quarter.
 *
 * Example: "Long-term bullish thesis" → 90-day claim
 *
 * Tuning impact: Raise to 4320 (180 days) for 6-month long-term definition
 */
const HORIZON_HOURS_LONG_TERM = 2160;

/**
 * Claim Expiration Parameters
 *
 * Constants for determining when claims expire if not resolved earlier.
 */

/**
 * Default claim expiration hours (48)
 *
 * Default time horizon when agent doesn't specify explicit timeframe.
 * Represents 2 trading days.
 *
 * Example: Generic "bullish on TSLAx" → 48-hour default expiration
 *
 * Tuning impact: Lower to 24 for faster claim turnover; raise to 72 for more patience
 */
const CLAIM_DEFAULT_EXPIRATION_HOURS = 48;

/**
 * Early Resolution Threshold
 *
 * Threshold for early directional claim resolution before expiration.
 */

/**
 * Early resolution movement threshold (2%)
 *
 * For directional claims, resolve early if price moves > this % before expiration.
 * Allows early verification when direction is clearly confirmed.
 *
 * Example: Buy claim with 2.5% up move resolves early as correct
 *
 * Tuning impact: Lower to 1.5% to resolve claims faster; raise to 3% for stricter verification
 */
const EARLY_RESOLUTION_MOVEMENT_THRESHOLD = 0.02;

/**
 * Accuracy Display Precision Multiplier (100 = 2 decimal places).
 *
 * Used for all accuracy rate calculations in accountability profiles:
 * `Math.round(correctCount / totalCount * ACCURACY_PRECISION_MULTIPLIER) / ACCURACY_PRECISION_MULTIPLIER`
 *
 * Formula: Math.round(fraction × 100) / 100 → 2-decimal accuracy (e.g., 0.7333... → 0.73)
 * Example: 22 correct of 30 total → Math.round(0.7333 × 100) / 100 = 0.73
 *
 * Tuning: Change to 1000 for 3 decimal places (e.g., 0.733), or 10 for 1 decimal (0.7).
 * All 6 accuracy calculations in getAccountabilityProfile use this constant.
 */
const ACCURACY_PRECISION_MULTIPLIER = 100;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegisteredClaim {
  id: string;
  agentId: string;
  roundId: string;
  symbol: string;
  action: string;
  /** The claim text */
  claim: string;
  /** Type: directional, price_target, time_horizon, comparative */
  claimType: "directional" | "price_target" | "time_horizon" | "comparative" | "categorical";
  /** Confidence at time of claim */
  confidence: number;
  /** Parsed direction if directional */
  direction?: "up" | "down" | "flat";
  /** Parsed target price if price_target */
  targetPrice?: number;
  /** Parsed time horizon in hours */
  horizonHours?: number;
  /** When the claim was made */
  timestamp: string;
  /** Resolution status */
  status: "pending" | "correct" | "incorrect" | "expired" | "unverifiable";
  /** Resolution details */
  resolution?: string;
  /** Resolved at timestamp */
  resolvedAt?: string;
}

export interface AccountabilityProfile {
  agentId: string;
  totalClaims: number;
  resolvedClaims: number;
  correctClaims: number;
  incorrectClaims: number;
  pendingClaims: number;
  accuracyRate: number;
  overconfidenceRate: number;
  /** Accuracy by claim type */
  byType: Record<string, { total: number; correct: number; accuracy: number }>;
  /** Accuracy by symbol */
  bySymbol: Record<string, { total: number; correct: number; accuracy: number }>;
  /** Accuracy by confidence bucket */
  byConfidence: { bucket: string; total: number; correct: number; accuracy: number }[];
  /** Is accuracy improving over time? */
  learningTrend: "improving" | "stable" | "declining";
  /** Composite accountability score 0-1 */
  accountabilityScore: number;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const claimRegistry = new Map<string, RegisteredClaim[]>();
const MAX_CLAIMS_PER_AGENT = 500;

// ---------------------------------------------------------------------------
// Claim Registration
// ---------------------------------------------------------------------------

/**
 * Register verifiable claims from an agent's reasoning.
 */
export function registerClaims(
  agentId: string,
  roundId: string,
  symbol: string,
  action: string,
  reasoning: string,
  confidence: number,
): RegisteredClaim[] {
  const claims: RegisteredClaim[] = [];
  const conf01 = confidence > 1 ? confidence / 100 : confidence;

  // Extract directional claims
  const directionMatch = extractDirection(reasoning, action);
  if (directionMatch) {
    claims.push({
      id: `claim_${Date.now()}_${Math.random().toString(36).slice(ID_RANDOM_START, ID_RANDOM_START + ID_RANDOM_LENGTH_SHORT)}`,
      agentId,
      roundId,
      symbol,
      action,
      claim: directionMatch.text,
      claimType: "directional",
      confidence: conf01,
      direction: directionMatch.direction,
      timestamp: new Date().toISOString(),
      status: "pending",
    });
  }

  // Extract price target claims
  const priceTargets = extractPriceTargets(reasoning, symbol);
  for (const pt of priceTargets) {
    claims.push({
      id: `claim_${Date.now()}_${Math.random().toString(36).slice(ID_RANDOM_START, ID_RANDOM_START + ID_RANDOM_LENGTH_SHORT)}_pt`,
      agentId,
      roundId,
      symbol,
      action,
      claim: pt.text,
      claimType: "price_target",
      confidence: conf01,
      targetPrice: pt.price,
      timestamp: new Date().toISOString(),
      status: "pending",
    });
  }

  // Extract time horizon claims
  const horizonMatch = extractHorizon(reasoning);
  if (horizonMatch) {
    claims.push({
      id: `claim_${Date.now()}_${Math.random().toString(36).slice(ID_RANDOM_START, ID_RANDOM_START + ID_RANDOM_LENGTH_SHORT)}_th`,
      agentId,
      roundId,
      symbol,
      action,
      claim: horizonMatch.text,
      claimType: "time_horizon",
      confidence: conf01,
      horizonHours: horizonMatch.hours,
      timestamp: new Date().toISOString(),
      status: "pending",
    });
  }

  // Extract categorical claims (will outperform, will underperform)
  const categoricalClaims = extractCategoricalClaims(reasoning, symbol);
  for (const cc of categoricalClaims) {
    claims.push({
      id: `claim_${Date.now()}_${Math.random().toString(36).slice(ID_RANDOM_START, ID_RANDOM_START + ID_RANDOM_LENGTH_SHORT)}_cat`,
      agentId,
      roundId,
      symbol,
      action,
      claim: cc,
      claimType: "categorical",
      confidence: conf01,
      timestamp: new Date().toISOString(),
      status: "pending",
    });
  }

  // Store claims
  const existing = claimRegistry.get(agentId) ?? [];
  existing.unshift(...claims);
  if (existing.length > MAX_CLAIMS_PER_AGENT) existing.length = MAX_CLAIMS_PER_AGENT;
  claimRegistry.set(agentId, existing);

  return claims;
}

function extractDirection(reasoning: string, action: string): { text: string; direction: "up" | "down" | "flat" } | null {
  const lower = reasoning.toLowerCase();

  if (action === "buy" || /\b(?:will\s+rise|expected?\s+to\s+increase|upside|bullish|higher)\b/i.test(lower)) {
    return {
      text: `Expects price to move up (action: ${action})`,
      direction: "up",
    };
  }
  if (action === "sell" || /\b(?:will\s+fall|expected?\s+to\s+decrease|downside|bearish|lower)\b/i.test(lower)) {
    return {
      text: `Expects price to move down (action: ${action})`,
      direction: "down",
    };
  }
  if (action === "hold" || /\b(?:sideways|flat|range[\s-]bound|consolidat)\b/i.test(lower)) {
    return {
      text: `Expects price to remain flat (action: ${action})`,
      direction: "flat",
    };
  }

  return null;
}

function extractPriceTargets(reasoning: string, _symbol: string): { text: string; price: number }[] {
  const targets: { text: string; price: number }[] = [];
  const patterns = [
    /target\s+(?:price\s+)?(?:of\s+)?\$?([\d,.]+)/gi,
    /(?:reach|hit|test)\s+\$?([\d,.]+)/gi,
    /\$?([\d,.]+)\s+(?:target|level|resistance|support)/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(reasoning)) !== null) {
      const price = parseFloat(match[1].replace(/,/g, ""));
      if (price > PRICE_TARGET_MIN && price < PRICE_TARGET_MAX) {
        targets.push({
          text: `Price target: $${price.toFixed(2)}`,
          price,
        });
      }
    }
  }

  return targets.slice(0, PRICE_TARGETS_MAX_COUNT);
}

function extractHorizon(reasoning: string): { text: string; hours: number } | null {
  const patterns: [RegExp, number][] = [
    [/\b(?:next\s+few\s+hours?|intraday|today)\b/i, 8],
    [/\b(?:overnight|tomorrow|24\s*h)\b/i, 24],
    [/\b(?:this\s+week|next\s+few\s+days|short[\s-]term)\b/i, 120],
    [/\b(?:next\s+week|coming\s+week)\b/i, 168],
    [/\b(?:medium[\s-]term|next\s+month|coming\s+weeks)\b/i, 720],
    [/\b(?:long[\s-]term|next\s+quarter|several\s+months)\b/i, 2160],
  ];

  for (const [pattern, hours] of patterns) {
    const match = reasoning.match(pattern);
    if (match) {
      return { text: `Time horizon: ${match[0]}`, hours };
    }
  }

  return null;
}

function extractCategoricalClaims(reasoning: string, symbol: string): string[] {
  const claims: string[] = [];
  const lower = reasoning.toLowerCase();

  if (/\b(?:outperform|beat\s+the\s+market|alpha)\b/i.test(lower)) {
    claims.push(`${symbol} will outperform the market`);
  }
  if (/\b(?:underperform|lag\s+(?:the\s+)?market|drag)\b/i.test(lower)) {
    claims.push(`${symbol} will underperform the market`);
  }
  if (/\b(?:recovery|rebound|bounce\s+back)\b/i.test(lower)) {
    claims.push(`${symbol} expected to recover`);
  }
  if (/\b(?:correction|pullback|dip)\b/i.test(lower)) {
    claims.push(`${symbol} expected to correct`);
  }

  return claims;
}

// ---------------------------------------------------------------------------
// Outcome Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve pending claims against actual market data.
 * Call this periodically (e.g., after each trading round).
 */
export function resolvePendingClaims(
  currentPrices: Map<string, number>,
  previousPrices: Map<string, number>,
): { resolved: number; correct: number; incorrect: number } {
  let resolved = 0;
  let correct = 0;
  let incorrect = 0;
  const now = new Date();

  for (const [_agentId, claims] of claimRegistry.entries()) {
    for (const claim of claims) {
      if (claim.status !== "pending") continue;

      // Check if claim has expired (default: 48 hours)
      const claimAge = (now.getTime() - new Date(claim.timestamp).getTime()) / 3600000;
      const maxAge = claim.horizonHours ?? 48;

      if (claimAge > maxAge) {
        // Try to resolve before expiring
        const resolveResult = tryResolve(claim, currentPrices, previousPrices);
        if (resolveResult !== null) {
          claim.status = resolveResult ? "correct" : "incorrect";
          claim.resolution = resolveResult ? "Claim verified against market data" : "Claim contradicted by market data";
          if (resolveResult) correct++;
          else incorrect++;
        } else {
          claim.status = "expired";
          claim.resolution = "Could not verify within time horizon";
        }
        claim.resolvedAt = now.toISOString();
        resolved++;
        continue;
      }

      // Try early resolution for directional claims
      if (claim.claimType === "directional" && claim.direction) {
        const currentPrice = currentPrices.get(claim.symbol.toLowerCase());
        const prevPrice = previousPrices.get(claim.symbol.toLowerCase());
        if (currentPrice && prevPrice && prevPrice > 0) {
          const pctChange = (currentPrice - prevPrice) / prevPrice;
          // Resolve if move > threshold
          if (Math.abs(pctChange) > EARLY_RESOLUTION_MOVEMENT_THRESHOLD) {
            const moved = pctChange > 0 ? "up" : "down";
            const isCorrect = moved === claim.direction || (claim.direction === "flat" && Math.abs(pctChange) < CLAIM_FLAT_CLASSIFICATION_THRESHOLD);
            claim.status = isCorrect ? "correct" : "incorrect";
            claim.resolution = `Price moved ${(pctChange * 100).toFixed(1)}% (${moved}), predicted ${claim.direction}`;
            claim.resolvedAt = now.toISOString();
            resolved++;
            if (isCorrect) correct++;
            else incorrect++;
          }
        }
      }
    }
  }

  return { resolved, correct, incorrect };
}

function tryResolve(
  claim: RegisteredClaim,
  currentPrices: Map<string, number>,
  previousPrices: Map<string, number>,
): boolean | null {
  const currentPrice = currentPrices.get(claim.symbol.toLowerCase());
  const prevPrice = previousPrices.get(claim.symbol.toLowerCase());

  if (!currentPrice || !prevPrice || prevPrice === 0) return null;

  if (claim.claimType === "directional" && claim.direction) {
    const pctChange = (currentPrice - prevPrice) / prevPrice;
    if (claim.direction === "up") return pctChange > 0;
    if (claim.direction === "down") return pctChange < 0;
    if (claim.direction === "flat") return Math.abs(pctChange) < CLAIM_FLAT_RESOLUTION_THRESHOLD;
  }

  if (claim.claimType === "price_target" && claim.targetPrice) {
    const tolerance = claim.targetPrice * PRICE_TARGET_TOLERANCE;
    return Math.abs(currentPrice - claim.targetPrice) < tolerance;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Accountability Scoring
// ---------------------------------------------------------------------------

/**
 * Build full accountability profile for an agent.
 */
export function getAccountabilityProfile(agentId: string): AccountabilityProfile {
  const claims = claimRegistry.get(agentId) ?? [];
  const resolved = claims.filter((c) => c.status === "correct" || c.status === "incorrect");
  const correctClaims = claims.filter((c) => c.status === "correct");
  const incorrectClaims = claims.filter((c) => c.status === "incorrect");
  const pendingClaims = claims.filter((c) => c.status === "pending");

  // By type
  const byType: Record<string, { total: number; correct: number; accuracy: number }> = {};
  for (const claim of resolved) {
    if (!byType[claim.claimType]) byType[claim.claimType] = { total: 0, correct: 0, accuracy: 0 };
    byType[claim.claimType].total++;
    if (claim.status === "correct") byType[claim.claimType].correct++;
  }
  for (const key of Object.keys(byType)) {
    byType[key].accuracy = byType[key].total > 0 ? Math.round((byType[key].correct / byType[key].total) * ACCURACY_PRECISION_MULTIPLIER) / ACCURACY_PRECISION_MULTIPLIER : 0;
  }

  // By symbol
  const bySymbol: Record<string, { total: number; correct: number; accuracy: number }> = {};
  for (const claim of resolved) {
    if (!bySymbol[claim.symbol]) bySymbol[claim.symbol] = { total: 0, correct: 0, accuracy: 0 };
    bySymbol[claim.symbol].total++;
    if (claim.status === "correct") bySymbol[claim.symbol].correct++;
  }
  for (const key of Object.keys(bySymbol)) {
    bySymbol[key].accuracy = bySymbol[key].total > 0 ? Math.round((bySymbol[key].correct / bySymbol[key].total) * ACCURACY_PRECISION_MULTIPLIER) / ACCURACY_PRECISION_MULTIPLIER : 0;
  }

  // By confidence bucket
  const byConfidence = CONFIDENCE_BUCKET_BOUNDARIES.map((b) => {
    const inBucket = resolved.filter((c) => c.confidence >= b.min && c.confidence < (b.max === 1.0 ? CONFIDENCE_BUCKET_UPPER_OFFSET : b.max));
    const correctInBucket = countByCondition(inBucket, (c) => c.status === "correct");
    return {
      bucket: b.label,
      total: inBucket.length,
      correct: correctInBucket,
      accuracy: inBucket.length > 0 ? Math.round((correctInBucket / inBucket.length) * ACCURACY_PRECISION_MULTIPLIER) / ACCURACY_PRECISION_MULTIPLIER : 0,
    };
  });

  // Overconfidence rate
  const highConfResolved = resolved.filter((c) => c.confidence > HIGH_CONFIDENCE_THRESHOLD);
  const highConfWrong = countByCondition(highConfResolved, (c) => c.status === "incorrect");
  const overconfidenceRate = highConfResolved.length > 0
    ? Math.round((highConfWrong / highConfResolved.length) * ACCURACY_PRECISION_MULTIPLIER) / ACCURACY_PRECISION_MULTIPLIER
    : 0;

  // Learning trend: compare first half vs second half accuracy
  const halfIdx = Math.floor(resolved.length / 2);
  const firstHalf = resolved.slice(halfIdx);
  const secondHalf = resolved.slice(0, halfIdx);
  const firstAcc = firstHalf.length > 0 ? countByCondition(firstHalf, (c) => c.status === "correct") / firstHalf.length : 0;
  const secondAcc = secondHalf.length > 0 ? countByCondition(secondHalf, (c) => c.status === "correct") / secondHalf.length : 0;
  let learningTrend: "improving" | "stable" | "declining" = "stable";
  if (secondAcc - firstAcc > LEARNING_TREND_IMPROVEMENT_THRESHOLD) learningTrend = "improving";
  if (firstAcc - secondAcc > LEARNING_TREND_DECLINE_THRESHOLD) learningTrend = "declining";

  // Accuracy rate
  const accuracyRate = resolved.length > 0
    ? Math.round((correctClaims.length / resolved.length) * ACCURACY_PRECISION_MULTIPLIER) / ACCURACY_PRECISION_MULTIPLIER
    : 0;

  // Composite accountability score
  const accountabilityScore = Math.round((
    accuracyRate * ACCOUNTABILITY_WEIGHT_ACCURACY +
    (1 - overconfidenceRate) * ACCOUNTABILITY_WEIGHT_OVERCONFIDENCE +
    (learningTrend === "improving" ? LEARNING_TREND_SCORE_IMPROVING : learningTrend === "stable" ? LEARNING_TREND_SCORE_STABLE : LEARNING_TREND_SCORE_DECLINING) * ACCOUNTABILITY_WEIGHT_LEARNING_TREND +
    Math.min(1, resolved.length / CLAIMS_VOLUME_NORMALIZATION) * ACCOUNTABILITY_WEIGHT_VOLUME
  ) * ACCURACY_PRECISION_MULTIPLIER) / ACCURACY_PRECISION_MULTIPLIER;

  return {
    agentId,
    totalClaims: claims.length,
    resolvedClaims: resolved.length,
    correctClaims: correctClaims.length,
    incorrectClaims: incorrectClaims.length,
    pendingClaims: pendingClaims.length,
    accuracyRate,
    overconfidenceRate,
    byType,
    bySymbol,
    byConfidence,
    learningTrend,
    accountabilityScore,
  };
}

/**
 * Get all accountability profiles.
 */
export function getAllAccountabilityProfiles(): Record<string, AccountabilityProfile> {
  const profiles: Record<string, AccountabilityProfile> = {};
  for (const agentId of claimRegistry.keys()) {
    profiles[agentId] = getAccountabilityProfile(agentId);
  }
  return profiles;
}

/**
 * Get accountability pillar score for an agent (0-1).
 */
export function getAccountabilityPillarScore(agentId: string): number {
  const profile = getAccountabilityProfile(agentId);
  return profile.accountabilityScore;
}

/**
 * Get aggregate accountability stats.
 */
export function getAccountabilityStats(): {
  totalClaimsTracked: number;
  totalResolved: number;
  overallAccuracy: number;
  mostAccountable: string | null;
  leastAccountable: string | null;
} {
  let totalClaims = 0;
  let totalResolved = 0;
  let totalCorrect = 0;
  let best = { id: "", score: 0 };
  let worst = { id: "", score: 1 };

  for (const agentId of claimRegistry.keys()) {
    const profile = getAccountabilityProfile(agentId);
    totalClaims += profile.totalClaims;
    totalResolved += profile.resolvedClaims;
    totalCorrect += profile.correctClaims;
    if (profile.accountabilityScore > best.score) best = { id: agentId, score: profile.accountabilityScore };
    if (profile.accountabilityScore < worst.score) worst = { id: agentId, score: profile.accountabilityScore };
  }

  return {
    totalClaimsTracked: totalClaims,
    totalResolved,
    overallAccuracy: totalResolved > 0 ? Math.round((totalCorrect / totalResolved) * ACCURACY_PRECISION_MULTIPLIER) / ACCURACY_PRECISION_MULTIPLIER : 0,
    mostAccountable: best.id || null,
    leastAccountable: worst.id || null,
  };
}
