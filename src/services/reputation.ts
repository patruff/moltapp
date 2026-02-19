/**
 * Agent Reputation & Trust Score Service
 *
 * Implements an ELO-inspired rating system for AI trading agents. Each agent
 * has a reputation score that rises and falls based on prediction accuracy,
 * confidence calibration, consistency, and social engagement.
 *
 * Key mechanics:
 * - ELO Rating: Agents gain/lose points based on prediction outcomes
 * - Trust Score: Composite metric combining accuracy, calibration, consistency
 * - Prediction Tracking: Validates whether agent calls were correct
 * - Confidence Calibration: Are 80% confidence calls right 80% of the time?
 * - Trust Decay: Scores decay slightly over time to reward active traders
 * - Badges: Achievement system for milestones
 */

import { db } from "../db/index.ts";
import { agentDecisions } from "../db/schema/agent-decisions.ts";
import { eq, desc, gte, sql, and } from "drizzle-orm";
import { getAgentConfigs, getMarketData } from "../agents/orchestrator.ts";
import type { MarketData } from "../agents/base-agent.ts";
import { countByCondition, clamp, averageByKey, computeVariance } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Full reputation profile for an agent */
export interface AgentReputation {
  agentId: string;
  agentName: string;
  provider: string;

  // Core ratings
  eloRating: number;
  eloTier: EloTier;
  trustScore: number; // 0-100
  trustLevel: TrustLevel;
  rank: number;

  // Prediction accuracy
  predictionAccuracy: PredictionAccuracy;

  // Confidence calibration
  calibration: CalibrationData;

  // Consistency metrics
  consistency: ConsistencyMetrics;

  // Badges
  badges: Badge[];

  // History
  ratingHistory: RatingHistoryEntry[];

  // Meta
  lastUpdated: string;
  totalDecisions: number;
  activeSince: string | null;
}

export type EloTier =
  | "bronze"
  | "silver"
  | "gold"
  | "platinum"
  | "diamond"
  | "master"
  | "grandmaster";

export type TrustLevel = "untrusted" | "low" | "moderate" | "high" | "elite";

interface PredictionAccuracy {
  totalPredictions: number;
  correctPredictions: number;
  accuracy: number; // percentage
  buyAccuracy: number;
  sellAccuracy: number;
  holdAccuracy: number;
  recentAccuracy: number; // last 10 decisions
  accuracyTrend: "improving" | "declining" | "stable";
}

interface CalibrationData {
  overallCalibration: number; // 0-100, 100 = perfectly calibrated
  bins: CalibrationBin[];
  isOverconfident: boolean;
  isUnderconfident: boolean;
  brierScore: number; // 0-1, lower = better
}

interface CalibrationBin {
  confidenceRange: string;
  predictedProbability: number; // avg confidence in bin
  actualAccuracy: number; // actual success rate
  count: number;
  calibrationError: number; // |predicted - actual|
}

interface ConsistencyMetrics {
  decisionConsistency: number; // 0-100, how consistent are decisions
  styleAdherence: number; // 0-100, does agent follow its stated style
  volatilityScore: number; // 0-100, higher = more volatile decisions
  streakDiscipline: number; // 0-100, does agent avoid tilt after losses
  timeConsistency: number; // 0-100, consistent timing of trades
}

interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;
  rarity: "common" | "uncommon" | "rare" | "epic" | "legendary";
  earnedAt: string;
}

interface RatingHistoryEntry {
  date: string;
  eloRating: number;
  trustScore: number;
  event: string;
}

/** Reputation leaderboard entry */
export interface ReputationLeaderboardEntry {
  rank: number;
  agentId: string;
  agentName: string;
  provider: string;
  eloRating: number;
  eloTier: EloTier;
  trustScore: number;
  trustLevel: TrustLevel;
  predictionAccuracy: number;
  calibrationScore: number;
  totalDecisions: number;
  badges: Badge[];
  trend: "up" | "down" | "stable";
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INITIAL_ELO = 1200;
const ELO_K_FACTOR = 32;
const TRUST_DECAY_RATE = 0.005; // 0.5% decay per day of inactivity

/**
 * Price Movement Classification Thresholds
 *
 * Used for validating hold decisions and detecting market conditions.
 */

/**
 * Hold accuracy threshold: ±2% price movement = hold was correct
 * If |price change| < 2%, the hold decision is considered accurate (price stayed flat).
 * Increase to 3% to be more lenient on hold accuracy validation.
 */
const HOLD_ACCURACY_PRICE_THRESHOLD = 2;

/**
 * Crash detection threshold: -3% 24h change = market crash
 * When change24h < -3%, triggers "Diamond Hands" badge tracking for hold-through-dips.
 * Used in contrarian win detection and hold discipline scoring.
 */
const CRASH_DETECTION_THRESHOLD = -3;

/**
 * Contrarian threshold: ±2% 24h change = contrarian trade opportunity
 * Buy when change24h < -2% (buying into weakness) or sell when change24h > +2% (taking profit).
 * Increase to ±3% to require stronger contrarian signals.
 */
const CONTRARIAN_THRESHOLD = 2;

/**
 * Sample Size and Statistical Significance Thresholds
 *
 * Minimum data requirements for reliable metric calculations.
 */

/**
 * Minimum decisions for consistency calculation: 3 trades
 * Below 3 decisions, consistency metrics return default 50 scores (insufficient data).
 * Increase to 5 for more reliable consistency measurements.
 */
const MIN_DECISIONS_FOR_CONSISTENCY = 3;

/**
 * Maximum time gaps allowed for consistency: 2 gaps
 * If gaps.length > 2, time consistency calculation adjusts for variability.
 * Used in time consistency scoring (lines 807).
 */
const MAX_TIME_GAPS_FOR_CONSISTENCY = 2;

/**
 * Minimum decisions for calibration: 1 decision
 * Empty arrays skip calibration bin calculations, but 1+ decisions trigger full analysis.
 * Currently used implicitly (decisions.length > 0 checks).
 */
const MIN_DECISIONS_FOR_CALIBRATION = 1;

/**
 * Accuracy Trend Detection Thresholds
 *
 * Used to classify agent performance trajectory as improving/declining/stable.
 */

/**
 * Trend detection delta: ±5% accuracy change = improving/declining
 * recentAccuracy > accuracy + 5 = "improving", recentAccuracy < accuracy - 5 = "declining".
 * Increase to ±7% to require stronger trend confirmation before classification.
 */
const ACCURACY_TREND_THRESHOLD = 5;

/**
 * Confidence Threshold Classification
 *
 * Thresholds for high/low confidence decision classification across multiple contexts.
 */

/**
 * High confidence threshold: 70% confidence
 * Used in streak discipline (line 790: prev.confidence > 70) to detect high-conviction trades.
 * Increase to 75% to tighten high-confidence classification criteria.
 */
const HIGH_CONFIDENCE_THRESHOLD = 70;

/**
 * Low confidence threshold: 30% confidence
 * Used in streak discipline (line 791: curr.confidence < 30) to detect panic/overreaction.
 * Paired with HIGH_CONFIDENCE_THRESHOLD to flag wild confidence swings (70 → 30 = -10 discipline penalty).
 */
const LOW_CONFIDENCE_THRESHOLD = 30;

/**
 * Moderate confidence threshold for style adherence: 60% confidence
 * Used in style adherence calculation (lines 764, 768) to assess conservative/aggressive fit.
 * Conservative agents should have avgConf < 60, aggressive agents should have avgConf > 60.
 */
const MODERATE_CONFIDENCE_THRESHOLD = 60;

/**
 * Calibration Bin Detection Thresholds
 *
 * Used to classify agents as overconfident/underconfident based on prediction vs outcome gaps.
 */

/**
 * Calibration bias threshold: 10% gap between predicted and actual
 * If avgPredicted > avgActual + 10, agent is overconfident.
 * If avgActual > avgPredicted + 10, agent is underconfident.
 * Used in calibration.isOverconfident/isUnderconfident flags (lines 715-716).
 */
const CALIBRATION_BIAS_THRESHOLD = 10;

/**
 * Badge Threshold Constants
 *
 * Milestones for earning achievement badges.
 */

/**
 * First trade badge: 1 decision
 * Immediate achievement for making first trading decision.
 */
const BADGE_FIRST_TRADE_THRESHOLD = 1;

/**
 * Getting started badge: 10 decisions
 * Common badge for completing 10 trading decisions.
 */
const BADGE_TEN_TRADES_THRESHOLD = 10;

/**
 * Active trader badge: 50 decisions
 * Uncommon badge for completing 50 trading decisions.
 */
const BADGE_FIFTY_TRADES_THRESHOLD = 50;

/**
 * Centurion badge: 100 decisions
 * Rare badge for completing 100 trading decisions.
 */
const BADGE_HUNDRED_TRADES_THRESHOLD = 100;

/**
 * Sharp shooter accuracy: 70% prediction accuracy
 * Rare badge requiring both accuracy and minimum trade count.
 */
const BADGE_SHARP_SHOOTER_ACCURACY = 70;

/**
 * Minimum trades for sharp shooter badge: 10 decisions
 * Ensures statistical significance for accuracy badge.
 */
const BADGE_SHARP_SHOOTER_MIN_TRADES = 10;

/**
 * Well calibrated badge: 10% calibration error threshold
 * Epic badge for confidence calibration within 10% of actual outcomes.
 */
const BADGE_WELL_CALIBRATED_ERROR_MAX = 10;

/**
 * Minimum trades for calibration badge: 20 decisions
 * Requires sufficient data for reliable calibration measurement.
 */
const BADGE_WELL_CALIBRATED_MIN_TRADES = 20;

/**
 * Hot streak badge: 5 correct predictions in a row
 * Uncommon badge for demonstrating short-term consistency.
 */
const BADGE_HOT_STREAK_LENGTH = 5;

/**
 * On fire badge: 10 correct predictions in a row
 * Epic badge for exceptional winning streak.
 */
const BADGE_ON_FIRE_STREAK_LENGTH = 10;

/**
 * Contrarian wins threshold: 5 profitable contrarian trades
 * Rare badge for profiting while disagreeing with market/other agents.
 */
const BADGE_CONTRARIAN_WINS_THRESHOLD = 5;

/**
 * Diamond hands threshold: 3+ hold-through-dips
 * Epic badge for holding through 3+ consecutive market crashes and recovering.
 */
const BADGE_DIAMOND_HANDS_THRESHOLD = 3;

/**
 * Rising star ELO: 1500 rating
 * Uncommon badge for reaching intermediate ELO rating.
 */
const BADGE_RISING_STAR_ELO = 1500;

/**
 * Master trader ELO: 1800 rating
 * Legendary badge for reaching elite ELO rating.
 */
const BADGE_MASTER_TRADER_ELO = 1800;

/**
 * Trust Score Component Weights
 *
 * Weighted factors for calculating composite trust score (0-100).
 */

/**
 * Accuracy weight in trust score: 35%
 * HIGHEST weight — prediction accuracy is primary indicator of agent quality.
 */
const TRUST_WEIGHT_ACCURACY = 0.35;

/**
 * Calibration weight in trust score: 25%
 * Second highest — confidence calibration shows self-awareness and honesty.
 */
const TRUST_WEIGHT_CALIBRATION = 0.25;

/**
 * Consistency weight in trust score: 20%
 * Measures decision consistency, style adherence, and discipline.
 */
const TRUST_WEIGHT_CONSISTENCY = 0.20;

/**
 * Activity weight in trust score: 20%
 * Rewards frequent, recent trading (with decay for inactivity).
 */
const TRUST_WEIGHT_ACTIVITY = 0.20;

/**
 * Activity Score Calculation Constants
 *
 * Parameters for measuring trading frequency and recency.
 */

/**
 * Activity baseline score: 70 points
 * Starting score before volume bonus and decay penalty.
 */
const ACTIVITY_SCORE_BASELINE = 70;

/**
 * Activity volume multiplier: 0.5 points per decision
 * Each trade adds 0.5 points to activity score (capped at max bonus).
 */
const ACTIVITY_VOLUME_MULTIPLIER = 0.5;

/**
 * Activity max volume bonus: 30 points
 * Maximum bonus from trading volume (reached at 60 trades).
 */
const ACTIVITY_MAX_VOLUME_BONUS = 30;

/**
 * Style Adherence Calculation Constants
 *
 * Multipliers for measuring how well agents follow their stated trading style.
 */

/**
 * Conservative hold ratio multiplier: 150
 * Conservative agents rewarded for higher hold ratios (multiplier * holdRatio).
 */
const STYLE_CONSERVATIVE_HOLD_MULTIPLIER = 150;

/**
 * Aggressive action ratio multiplier: 120
 * Aggressive agents rewarded for higher buy/sell ratios (multiplier * actionRatio).
 */
const STYLE_AGGRESSIVE_ACTION_MULTIPLIER = 120;

/**
 * Moderate balance multiplier: 80
 * Moderate agents rewarded for balanced buy/sell distribution (multiplier * balance).
 */
const STYLE_MODERATE_BALANCE_MULTIPLIER = 80;

/**
 * Style adherence confidence bonus: 20 points
 * Bonus when agent's avg confidence aligns with risk tolerance (conservative < 60, aggressive > 60).
 */
const STYLE_ADHERENCE_CONFIDENCE_BONUS = 20;

/**
 * Moderate balance base score: 20 points
 * Base score added to moderate agents' balance calculation.
 */
const STYLE_MODERATE_BASE_SCORE = 20;

/**
 * Default and Baseline Score Constants
 *
 * Fallback scores used when insufficient data or as starting points.
 */

/**
 * Default score: 50 points
 * Used when insufficient data for metric calculation (neutral score).
 * Applied to: accuracy, calibration, consistency metrics, activity, trust defaults.
 */
const DEFAULT_SCORE = 50;

/**
 * Streak discipline default: 70 points
 * Starting score for streak discipline before penalty deductions (default good behavior).
 */
const STREAK_DISCIPLINE_DEFAULT = 70;

/**
 * Streak discipline penalty: 10 points per violation
 * Penalty for high-confidence → low-confidence swings after losses (70→30 confidence swing).
 */
const STREAK_DISCIPLINE_PENALTY = 10;

/**
 * Recent Decisions Display Limit
 *
 * Number of most-recent trade decisions included in "recent accuracy" and
 * "rating history" calculations.  Keeping the window small (10) ensures the
 * metric reflects current performance rather than a long tail of stale trades.
 *
 * Used in:
 *   - computePredictionAccuracy(): recent action slice + recentValidated cap
 *   - buildRatingHistory(): history.slice(-10) for ELO/trust history
 *
 * Formula:  recentAccuracy = (recentCorrect / min(recent.length, 10)) × 100
 * Example:  agent has 50 decisions → we analyse the 10 most-recent ones
 */
const RECENT_DECISIONS_DISPLAY_LIMIT = 10;

/**
 * Volatility/Consistency Multipliers
 *
 * Scaling factors for confidence stability and time consistency calculations.
 */

/**
 * Decision consistency multiplier: 2
 * Converts confidence standard deviation to consistency score (100 - stdDev * 2).
 */
const DECISION_CONSISTENCY_MULTIPLIER = 2;

/**
 * Volatility score multiplier: 2
 * Converts average confidence swing to volatility score (avgSwing * 2).
 */
const VOLATILITY_SCORE_MULTIPLIER = 2;

/**
 * Time consistency multiplier: 50
 * Converts gap coefficient of variation to time consistency (100 - gapCV * 50).
 */
const TIME_CONSISTENCY_MULTIPLIER = 50;

/**
 * ELO Score Calculation Constants
 *
 * Magnitude scaling factors for converting price changes to ELO scores.
 */

/**
 * ELO score baseline: 0.5
 * Neutral starting point for ELO score before magnitude adjustment (50% expected score).
 */
const ELO_SCORE_BASELINE = 0.5;

/**
 * ELO price magnitude divisor: 10
 * Converts price change percentage to ELO score magnitude (priceChange / 10).
 * Example: 5% price change → ±0.5 score adjustment.
 */
const ELO_PRICE_MAGNITUDE_DIVISOR = 10;

/**
 * ELO score floor: 0
 * Minimum ELO rating (prevents negative ratings).
 */
const ELO_SCORE_FLOOR = 0;

/**
 * ELO score ceiling: 1
 * Maximum ELO score per decision (caps magnitude bonus at 100%).
 */
const ELO_SCORE_CEILING = 1;

/**
 * ELO Tier Boundary Constants
 *
 * Rating thresholds for agent tier classification in the leaderboard.
 */

/**
 * Grandmaster tier minimum ELO: 2000
 * Elite tier for the absolute best performers (top 1% of agents).
 */
const ELO_TIER_GRANDMASTER_MIN = 2000;

/**
 * Master tier minimum ELO: 1800
 * Expert tier for consistently exceptional performance.
 */
const ELO_TIER_MASTER_MIN = 1800;

/**
 * Diamond tier minimum ELO: 1600
 * Advanced tier for strong, reliable traders.
 */
const ELO_TIER_DIAMOND_MIN = 1600;

/**
 * Platinum tier minimum ELO: 1400
 * Above-average tier for competent traders.
 */
const ELO_TIER_PLATINUM_MIN = 1400;

/**
 * Gold tier minimum ELO: 1200
 * Starting tier (INITIAL_ELO) for new agents, average performance.
 */
const ELO_TIER_GOLD_MIN = 1200;

/**
 * Silver tier minimum ELO: 1000
 * Below-average tier for struggling traders.
 */
const ELO_TIER_SILVER_MIN = 1000;

/**
 * Bronze tier minimum ELO: 0
 * Lowest tier for poor performance (floor).
 */
const ELO_TIER_BRONZE_MIN = 0;

/**
 * Trust Level Boundary Constants
 *
 * Trust score thresholds for agent reliability classification.
 */

/**
 * Elite trust level minimum: 85 score
 * Highest trust level for exceptional reliability (top tier agents).
 */
const TRUST_LEVEL_ELITE_MIN = 85;

/**
 * High trust level minimum: 65 score
 * Strong trust level for reliable, well-calibrated agents.
 */
const TRUST_LEVEL_HIGH_MIN = 65;

/**
 * Moderate trust level minimum: 45 score
 * Average trust level for moderately reliable agents (default range).
 */
const TRUST_LEVEL_MODERATE_MIN = 45;

/**
 * Low trust level minimum: 25 score
 * Below-average trust level for unreliable or uncalibrated agents.
 */
const TRUST_LEVEL_LOW_MIN = 25;

/**
 * Untrusted level minimum: 0 score
 * Lowest trust level for unproven or consistently inaccurate agents.
 */
const TRUST_LEVEL_UNTRUSTED_MIN = 0;

/**
 * Score Display Precision Constants
 *
 * Rounding multipliers used throughout reputation metrics to produce
 * human-readable values with consistent decimal precision.
 *
 * Formula: Math.round(value × MULTIPLIER) / DIVISOR
 */

/**
 * 1-decimal precision multiplier: 10
 * Produces one decimal place for accuracy/calibration/consistency/trust scores.
 *
 * Formula:  Math.round(value × 10) / 10  →  e.g. 83.4%
 * Example:  accuracy = 0.834 → Math.round(0.834 × 10) / 10 = 8.3 (× 100 elsewhere = 83.3%)
 *           or for 0–100 scores: Math.round(83.456 × 10) / 10 = 83.5
 *
 * Used for: accuracy, buyAccuracy, sellAccuracy, holdAccuracy, recentAccuracy,
 *           predictedProbability, actualAccuracy, calibrationError,
 *           overallCalibration, decisionConsistency, styleAdherence,
 *           volatilityScore, streakDiscipline, timeConsistency, trustScore,
 *           computeReputationScore result.
 */
const SCORE_PRECISION_MULTIPLIER = 10;

/**
 * 1-decimal precision divisor: 10
 * Paired with SCORE_PRECISION_MULTIPLIER — divide after Math.round to restore scale.
 */
const SCORE_PRECISION_DIVISOR = 10;

/**
 * Brier score 4-decimal precision multiplier: 10 000
 * Brier score is a squared probability error in [0, 1]; 4 decimal places
 * (e.g. 0.1234) give meaningful resolution without noise.
 *
 * Formula:  Math.round(brierScore × 10_000) / 10_000  →  e.g. 0.1234
 * Example:  0.12345 → Math.round(1234.5) / 10_000 = 1235 / 10_000 = 0.1235
 *
 * Used for: brierScore in computeCalibrationMetrics.
 */
const BRIER_SCORE_PRECISION_MULTIPLIER = 10_000;

/**
 * Brier score 4-decimal precision divisor: 10 000
 * Paired with BRIER_SCORE_PRECISION_MULTIPLIER.
 */
const BRIER_SCORE_PRECISION_DIVISOR = 10_000;

// ---------------------------------------------------------------------------
// Tier and Level Configuration Arrays
// ---------------------------------------------------------------------------

/**
 * ELO tier boundaries array
 * Maps ELO rating thresholds to tier classifications.
 * Ordered from highest to lowest for lookup efficiency.
 */
const ELO_TIERS: Array<{ min: number; tier: EloTier }> = [
  { min: ELO_TIER_GRANDMASTER_MIN, tier: "grandmaster" },
  { min: ELO_TIER_MASTER_MIN, tier: "master" },
  { min: ELO_TIER_DIAMOND_MIN, tier: "diamond" },
  { min: ELO_TIER_PLATINUM_MIN, tier: "platinum" },
  { min: ELO_TIER_GOLD_MIN, tier: "gold" },
  { min: ELO_TIER_SILVER_MIN, tier: "silver" },
  { min: ELO_TIER_BRONZE_MIN, tier: "bronze" },
];

/**
 * Trust level boundaries array
 * Maps trust score thresholds to trust level classifications.
 * Ordered from highest to lowest for lookup efficiency.
 */
const TRUST_LEVELS: Array<{ min: number; level: TrustLevel }> = [
  { min: TRUST_LEVEL_ELITE_MIN, level: "elite" },
  { min: TRUST_LEVEL_HIGH_MIN, level: "high" },
  { min: TRUST_LEVEL_MODERATE_MIN, level: "moderate" },
  { min: TRUST_LEVEL_LOW_MIN, level: "low" },
  { min: TRUST_LEVEL_UNTRUSTED_MIN, level: "untrusted" },
];

// ---------------------------------------------------------------------------
// Badge Definitions
// ---------------------------------------------------------------------------

const BADGE_DEFINITIONS: Array<{
  id: string;
  name: string;
  description: string;
  icon: string;
  rarity: Badge["rarity"];
  condition: (stats: DecisionStats) => boolean;
}> = [
  {
    id: "first_trade",
    name: "First Trade",
    description: "Made your first trading decision",
    icon: "🎯",
    rarity: "common",
    condition: (s) => s.totalDecisions >= BADGE_FIRST_TRADE_THRESHOLD,
  },
  {
    id: "ten_trades",
    name: "Getting Started",
    description: "Completed 10 trading decisions",
    icon: "📈",
    rarity: "common",
    condition: (s) => s.totalDecisions >= BADGE_TEN_TRADES_THRESHOLD,
  },
  {
    id: "fifty_trades",
    name: "Active Trader",
    description: "Completed 50 trading decisions",
    icon: "⚡",
    rarity: "uncommon",
    condition: (s) => s.totalDecisions >= BADGE_FIFTY_TRADES_THRESHOLD,
  },
  {
    id: "hundred_trades",
    name: "Centurion",
    description: "Completed 100 trading decisions",
    icon: "💎",
    rarity: "rare",
    condition: (s) => s.totalDecisions >= BADGE_HUNDRED_TRADES_THRESHOLD,
  },
  {
    id: "high_accuracy",
    name: "Sharp Shooter",
    description: "Achieved 70%+ prediction accuracy",
    icon: "🎯",
    rarity: "rare",
    condition: (s) => s.accuracy >= BADGE_SHARP_SHOOTER_ACCURACY && s.totalDecisions >= BADGE_SHARP_SHOOTER_MIN_TRADES,
  },
  {
    id: "well_calibrated",
    name: "Well Calibrated",
    description: "Confidence calibration within 10%",
    icon: "⚖️",
    rarity: "epic",
    condition: (s) => s.calibrationError <= BADGE_WELL_CALIBRATED_ERROR_MAX && s.totalDecisions >= BADGE_WELL_CALIBRATED_MIN_TRADES,
  },
  {
    id: "win_streak_5",
    name: "Hot Streak",
    description: "5 correct predictions in a row",
    icon: "🔥",
    rarity: "uncommon",
    condition: (s) => s.maxWinStreak >= BADGE_HOT_STREAK_LENGTH,
  },
  {
    id: "win_streak_10",
    name: "On Fire",
    description: "10 correct predictions in a row",
    icon: "🔥",
    rarity: "epic",
    condition: (s) => s.maxWinStreak >= BADGE_ON_FIRE_STREAK_LENGTH,
  },
  {
    id: "contrarian_winner",
    name: "Contrarian",
    description: "Profitable while disagreeing with other agents",
    icon: "🦊",
    rarity: "rare",
    condition: (s) => s.contrarianWins >= BADGE_CONTRARIAN_WINS_THRESHOLD,
  },
  {
    id: "diamond_hands",
    name: "Diamond Hands",
    description: "Held through 3+ consecutive dips and recovered",
    icon: "💎",
    rarity: "epic",
    condition: (s) => s.holdThroughDips >= BADGE_DIAMOND_HANDS_THRESHOLD,
  },
  {
    id: "elo_1500",
    name: "Rising Star",
    description: "Reached ELO rating of 1500",
    icon: "⭐",
    rarity: "uncommon",
    condition: (s) => s.eloRating >= BADGE_RISING_STAR_ELO,
  },
  {
    id: "elo_1800",
    name: "Master Trader",
    description: "Reached ELO rating of 1800",
    icon: "👑",
    rarity: "legendary",
    condition: (s) => s.eloRating >= BADGE_MASTER_TRADER_ELO,
  },
];

// ---------------------------------------------------------------------------
// Internal Stats Type
// ---------------------------------------------------------------------------

interface DecisionStats {
  totalDecisions: number;
  accuracy: number;
  calibrationError: number;
  maxWinStreak: number;
  contrarianWins: number;
  holdThroughDips: number;
  eloRating: number;
}

// ---------------------------------------------------------------------------
// Core Reputation Calculation
// ---------------------------------------------------------------------------

/**
 * Calculate the full reputation profile for an agent.
 */
export async function getAgentReputation(
  agentId: string,
): Promise<AgentReputation | null> {
  const config = getAgentConfigs().find((c) => c.agentId === agentId);
  if (!config) return null;

  // Fetch all decisions
  const decisions = await db
    .select()
    .from(agentDecisions)
    .where(eq(agentDecisions.agentId, agentId))
    .orderBy(desc(agentDecisions.createdAt));

  if (decisions.length === 0) {
    return buildEmptyReputation(agentId, config.name, config.provider);
  }

  // Get market data for validation
  let marketData: MarketData[] = [];
  try {
    marketData = await getMarketData();
  } catch {
    // continue without market data
  }

  // Calculate prediction accuracy
  const predictionAccuracy = calculatePredictionAccuracy(decisions, marketData);

  // Calculate ELO rating
  const eloRating = calculateEloRating(decisions, marketData);
  const eloTier = getEloTier(eloRating);

  // Calculate calibration
  const calibration = calculateCalibration(decisions, marketData);

  // Calculate consistency
  const consistency = calculateConsistency(decisions, config);

  // Calculate trust score
  const trustScore = calculateTrustScore(
    predictionAccuracy,
    calibration,
    consistency,
    decisions,
  );
  const trustLevel = getTrustLevel(trustScore);

  // Calculate badges
  const stats: DecisionStats = {
    totalDecisions: decisions.length,
    accuracy: predictionAccuracy.accuracy,
    calibrationError: calibration.overallCalibration,
    maxWinStreak: calculateMaxWinStreak(decisions, marketData),
    contrarianWins: calculateContrarianWins(decisions, marketData),
    holdThroughDips: calculateHoldThroughDips(decisions, marketData),
    eloRating,
  };
  const badges = calculateBadges(stats);

  // Build rating history (last 10 data points)
  const ratingHistory = buildRatingHistory(decisions, marketData);

  return {
    agentId,
    agentName: config.name,
    provider: config.provider,
    eloRating,
    eloTier,
    trustScore,
    trustLevel,
    rank: 0, // set by leaderboard
    predictionAccuracy,
    calibration,
    consistency,
    badges,
    ratingHistory,
    lastUpdated: new Date().toISOString(),
    totalDecisions: decisions.length,
    activeSince: decisions[decisions.length - 1]?.createdAt?.toISOString() ?? null,
  };
}

/**
 * Get the reputation leaderboard with all agents ranked.
 */
export async function getReputationLeaderboard(): Promise<
  ReputationLeaderboardEntry[]
> {
  const configs = getAgentConfigs();
  const entries: ReputationLeaderboardEntry[] = [];

  for (const config of configs) {
    const rep = await getAgentReputation(config.agentId);
    if (!rep) continue;

    entries.push({
      rank: 0,
      agentId: rep.agentId,
      agentName: rep.agentName,
      provider: rep.provider,
      eloRating: rep.eloRating,
      eloTier: rep.eloTier,
      trustScore: rep.trustScore,
      trustLevel: rep.trustLevel,
      predictionAccuracy: rep.predictionAccuracy.accuracy,
      calibrationScore: rep.calibration.overallCalibration,
      totalDecisions: rep.totalDecisions,
      badges: rep.badges,
      trend:
        rep.predictionAccuracy.accuracyTrend === "improving"
          ? "up"
          : rep.predictionAccuracy.accuracyTrend === "declining"
            ? "down"
            : "stable",
    });
  }

  // Sort by ELO rating
  entries.sort((a, b) => b.eloRating - a.eloRating);
  entries.forEach((e, i) => {
    e.rank = i + 1;
  });

  return entries;
}

// ---------------------------------------------------------------------------
// Prediction Accuracy
// ---------------------------------------------------------------------------

function calculatePredictionAccuracy(
  decisions: Array<{
    action: string;
    symbol: string;
    confidence: number;
    marketSnapshot: unknown;
    createdAt: Date;
  }>,
  currentMarket: MarketData[],
): PredictionAccuracy {
  const actionDecisions = decisions.filter((d) => d.action !== "hold");
  let correct = 0;
  let buyCorrect = 0;
  let buyTotal = 0;
  let sellCorrect = 0;
  let sellTotal = 0;

  for (const d of actionDecisions) {
    const snapshot = d.marketSnapshot as Record<
      string,
      { price: number }
    > | null;
    const snapshotPrice = snapshot?.[d.symbol]?.price;
    const currentStock = currentMarket.find((m) => m.symbol === d.symbol);
    const currentPrice = currentStock?.price;

    if (!snapshotPrice || !currentPrice) continue;

    const priceChange = ((currentPrice - snapshotPrice) / snapshotPrice) * 100;

    if (d.action === "buy") {
      buyTotal++;
      if (priceChange > 0) {
        correct++;
        buyCorrect++;
      }
    } else if (d.action === "sell") {
      sellTotal++;
      if (priceChange < 0) {
        correct++;
        sellCorrect++;
      }
    }
  }

  const totalValidated = buyTotal + sellTotal;
  const accuracy =
    totalValidated > 0 ? (correct / totalValidated) * 100 : 50;
  const buyAccuracy = buyTotal > 0 ? (buyCorrect / buyTotal) * 100 : 0;
  const sellAccuracy = sellTotal > 0 ? (sellCorrect / sellTotal) * 100 : 0;

  // Hold accuracy: how often hold was appropriate (minimal price movement)
  const holdDecisions = decisions.filter((d) => d.action === "hold");
  let holdCorrect = 0;
  for (const d of holdDecisions) {
    const snapshot = d.marketSnapshot as Record<
      string,
      { price: number }
    > | null;
    const snapshotPrice = snapshot?.[d.symbol]?.price;
    const currentStock = currentMarket.find((m) => m.symbol === d.symbol);
    if (snapshotPrice && currentStock) {
      const change =
        Math.abs(
          ((currentStock.price - snapshotPrice) / snapshotPrice) * 100,
        );
      if (change < HOLD_ACCURACY_PRICE_THRESHOLD) holdCorrect++; // price stayed flat = hold was right
    }
  }
  const holdAccuracy =
    holdDecisions.length > 0
      ? (holdCorrect / holdDecisions.length) * 100
      : 0;

  // Recent accuracy (last 10)
  const recent = actionDecisions.slice(0, RECENT_DECISIONS_DISPLAY_LIMIT);
  let recentCorrect = 0;
  for (const d of recent) {
    const snapshot = d.marketSnapshot as Record<
      string,
      { price: number }
    > | null;
    const snapshotPrice = snapshot?.[d.symbol]?.price;
    const currentStock = currentMarket.find((m) => m.symbol === d.symbol);
    if (!snapshotPrice || !currentStock) continue;
    const change =
      ((currentStock.price - snapshotPrice) / snapshotPrice) * 100;
    if (
      (d.action === "buy" && change > 0) ||
      (d.action === "sell" && change < 0)
    )
      recentCorrect++;
  }
  const recentValidated = Math.min(recent.length, RECENT_DECISIONS_DISPLAY_LIMIT);
  const recentAccuracy =
    recentValidated > 0 ? (recentCorrect / recentValidated) * 100 : 50;

  // Trend
  const accuracyTrend: "improving" | "declining" | "stable" =
    recentAccuracy > accuracy + ACCURACY_TREND_THRESHOLD
      ? "improving"
      : recentAccuracy < accuracy - ACCURACY_TREND_THRESHOLD
        ? "declining"
        : "stable";

  return {
    totalPredictions: totalValidated,
    correctPredictions: correct,
    accuracy: Math.round(accuracy * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR,
    buyAccuracy: Math.round(buyAccuracy * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR,
    sellAccuracy: Math.round(sellAccuracy * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR,
    holdAccuracy: Math.round(holdAccuracy * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR,
    recentAccuracy: Math.round(recentAccuracy * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR,
    accuracyTrend,
  };
}

// ---------------------------------------------------------------------------
// ELO Rating
// ---------------------------------------------------------------------------

function calculateEloRating(
  decisions: Array<{
    action: string;
    symbol: string;
    confidence: number;
    marketSnapshot: unknown;
  }>,
  currentMarket: MarketData[],
): number {
  let elo = INITIAL_ELO;
  const actionDecisions = decisions
    .filter((d) => d.action !== "hold")
    .reverse(); // chronological

  for (const d of actionDecisions) {
    const snapshot = d.marketSnapshot as Record<
      string,
      { price: number }
    > | null;
    const snapshotPrice = snapshot?.[d.symbol]?.price;
    const currentStock = currentMarket.find((m) => m.symbol === d.symbol);

    if (!snapshotPrice || !currentStock) continue;

    const priceChange =
      ((currentStock.price - snapshotPrice) / snapshotPrice) * 100;

    // Expected score: based on confidence
    const confidenceNorm = d.confidence / 100;
    const expectedScore = confidenceNorm;

    // Actual score: 1 if correct, 0 if wrong, scaled by magnitude
    let actualScore: number;
    if (d.action === "buy") {
      actualScore = priceChange > 0 ? Math.min(ELO_SCORE_CEILING, ELO_SCORE_BASELINE + priceChange / ELO_PRICE_MAGNITUDE_DIVISOR) : Math.max(ELO_SCORE_FLOOR, ELO_SCORE_BASELINE + priceChange / ELO_PRICE_MAGNITUDE_DIVISOR);
    } else {
      actualScore = priceChange < 0 ? Math.min(ELO_SCORE_CEILING, ELO_SCORE_BASELINE + Math.abs(priceChange) / ELO_PRICE_MAGNITUDE_DIVISOR) : Math.max(ELO_SCORE_FLOOR, ELO_SCORE_BASELINE - priceChange / ELO_PRICE_MAGNITUDE_DIVISOR);
    }

    // ELO update
    const adjustment = ELO_K_FACTOR * (actualScore - expectedScore);
    elo += adjustment;

    // Floor at 0
    elo = Math.max(ELO_SCORE_FLOOR, elo);
  }

  return Math.round(elo);
}

function getEloTier(rating: number): EloTier {
  for (const tier of ELO_TIERS) {
    if (rating >= tier.min) return tier.tier;
  }
  return "bronze";
}

// ---------------------------------------------------------------------------
// Confidence Calibration
// ---------------------------------------------------------------------------

function calculateCalibration(
  decisions: Array<{
    action: string;
    symbol: string;
    confidence: number;
    marketSnapshot: unknown;
  }>,
  currentMarket: MarketData[],
): CalibrationData {
  const actionDecisions = decisions.filter((d) => d.action !== "hold");

  // Create calibration bins (10% intervals)
  const bins: CalibrationBin[] = [];
  const binRanges = [
    [0, 20],
    [20, 40],
    [40, 60],
    [60, 80],
    [80, 100],
  ];

  let totalBrierScore = 0;
  let brierCount = 0;

  for (const [low, high] of binRanges) {
    const binDecisions = actionDecisions.filter(
      (d) => d.confidence >= low && d.confidence < (high === 100 ? 101 : high),
    );
    if (binDecisions.length === 0) {
      bins.push({
        confidenceRange: `${low}-${high}%`,
        predictedProbability: (low + high) / 2,
        actualAccuracy: 0,
        count: 0,
        calibrationError: 0,
      });
      continue;
    }

    const avgConfidence = averageByKey(binDecisions, 'confidence');

    let correct = 0;
    for (const d of binDecisions) {
      const snapshot = d.marketSnapshot as Record<
        string,
        { price: number }
      > | null;
      const snapshotPrice = snapshot?.[d.symbol]?.price;
      const currentStock = currentMarket.find((m) => m.symbol === d.symbol);

      if (!snapshotPrice || !currentStock) continue;

      const change =
        ((currentStock.price - snapshotPrice) / snapshotPrice) * 100;
      const isCorrect =
        (d.action === "buy" && change > 0) ||
        (d.action === "sell" && change < 0);
      if (isCorrect) correct++;

      // Brier score component
      const predicted = d.confidence / 100;
      const outcome = isCorrect ? 1 : 0;
      totalBrierScore += (predicted - outcome) ** 2;
      brierCount++;
    }

    const actualAccuracy = (correct / binDecisions.length) * 100;
    const calibrationError = Math.abs(avgConfidence - actualAccuracy);

    bins.push({
      confidenceRange: `${low}-${high}%`,
      predictedProbability: Math.round(avgConfidence * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR,
      actualAccuracy: Math.round(actualAccuracy * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR,
      count: binDecisions.length,
      calibrationError: Math.round(calibrationError * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR,
    });
  }

  // Overall calibration score
  const activeBinsWithData = bins.filter((b) => b.count > 0);
  const avgCalibrationError =
    activeBinsWithData.length > 0 ? averageByKey(activeBinsWithData, 'calibrationError') : 50;
  const overallCalibration = Math.max(0, 100 - avgCalibrationError);

  // Brier score
  const brierScore = brierCount > 0 ? totalBrierScore / brierCount : 0.5;

  // Over/under confidence
  const avgPredicted =
    activeBinsWithData.length > 0
      ? averageByKey(activeBinsWithData, 'predictedProbability')
      : 50;
  const avgActual =
    activeBinsWithData.length > 0
      ? averageByKey(activeBinsWithData, 'actualAccuracy')
      : 50;

  return {
    overallCalibration: Math.round(overallCalibration * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR,
    bins,
    isOverconfident: avgPredicted > avgActual + CALIBRATION_BIAS_THRESHOLD,
    isUnderconfident: avgActual > avgPredicted + CALIBRATION_BIAS_THRESHOLD,
    brierScore: Math.round(brierScore * BRIER_SCORE_PRECISION_MULTIPLIER) / BRIER_SCORE_PRECISION_DIVISOR,
  };
}

// ---------------------------------------------------------------------------
// Consistency Metrics
// ---------------------------------------------------------------------------

function calculateConsistency(
  decisions: Array<{
    action: string;
    symbol: string;
    confidence: number;
    createdAt: Date;
  }>,
  config: { tradingStyle: string; riskTolerance: string },
): ConsistencyMetrics {
  if (decisions.length < MIN_DECISIONS_FOR_CONSISTENCY) {
    return {
      decisionConsistency: 50,
      styleAdherence: 50,
      volatilityScore: 50,
      streakDiscipline: 50,
      timeConsistency: 50,
    };
  }

  // Decision consistency: are confidence levels stable?
  const confidences = decisions.map((d) => d.confidence);
  const avgConf =
    confidences.reduce((s, c) => s + c, 0) / confidences.length;
  const confVariance = computeVariance(confidences, true); // population variance
  const confStdDev = Math.sqrt(confVariance);
  const decisionConsistency = Math.max(0, 100 - confStdDev * 2);

  // Style adherence: does the agent follow its personality?
  const buyCount = countByCondition(decisions, (d) => d.action === "buy");
  const sellCount = countByCondition(decisions, (d) => d.action === "sell");
  const holdCount = countByCondition(decisions, (d) => d.action === "hold");
  const total = decisions.length;

  let styleAdherence = 50;
  if (config.riskTolerance === "conservative") {
    // Conservative agents should hold more, have lower avg confidence
    const holdRatio = holdCount / total;
    styleAdherence = Math.min(100, holdRatio * 150 + (avgConf < MODERATE_CONFIDENCE_THRESHOLD ? 20 : 0));
  } else if (config.riskTolerance === "aggressive") {
    // Aggressive agents should trade more (fewer holds), higher confidence
    const actionRatio = (buyCount + sellCount) / total;
    styleAdherence = Math.min(100, actionRatio * 120 + (avgConf > MODERATE_CONFIDENCE_THRESHOLD ? 20 : 0));
  } else {
    // Moderate: balanced approach
    const balance = 1 - Math.abs(buyCount - sellCount) / total;
    styleAdherence = Math.min(100, balance * 80 + 20);
  }

  // Volatility score: how much do confidence levels swing?
  let totalSwing = 0;
  for (let i = 1; i < confidences.length; i++) {
    totalSwing += Math.abs(confidences[i] - confidences[i - 1]);
  }
  const avgSwing = totalSwing / (confidences.length - 1);
  const volatilityScore = Math.min(100, avgSwing * 2);

  // Streak discipline: does agent overreact after losses?
  let streakDiscipline = 70; // default good
  for (let i = 1; i < decisions.length; i++) {
    const prev = decisions[i];
    const curr = decisions[i - 1];
    // If previous was a high-confidence action and current swings wildly, bad
    if (
      prev.confidence > HIGH_CONFIDENCE_THRESHOLD &&
      curr.confidence < LOW_CONFIDENCE_THRESHOLD &&
      prev.action !== "hold"
    ) {
      streakDiscipline -= 10;
    }
  }
  streakDiscipline = clamp(streakDiscipline, 0, 100);

  // Time consistency: are trades evenly spaced?
  const gaps: number[] = [];
  for (let i = 1; i < decisions.length; i++) {
    gaps.push(
      decisions[i - 1].createdAt.getTime() - decisions[i].createdAt.getTime(),
    );
  }
  let timeConsistency = 50;
  if (gaps.length > MAX_TIME_GAPS_FOR_CONSISTENCY) {
    const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    const gapVariance = computeVariance(gaps, true); // population variance
    const gapCV = Math.sqrt(gapVariance) / (avgGap || 1); // coefficient of variation
    timeConsistency = Math.max(0, 100 - gapCV * 50);
  }

  return {
    decisionConsistency: Math.round(decisionConsistency * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR,
    styleAdherence: Math.round(styleAdherence * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR,
    volatilityScore: Math.round(volatilityScore * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR,
    streakDiscipline: Math.round(streakDiscipline * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR,
    timeConsistency: Math.round(timeConsistency * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR,
  };
}

// ---------------------------------------------------------------------------
// Trust Score
// ---------------------------------------------------------------------------

function calculateTrustScore(
  accuracy: PredictionAccuracy,
  calibration: CalibrationData,
  consistency: ConsistencyMetrics,
  decisions: Array<{ createdAt: Date }>,
): number {
  const accuracyScore = accuracy.accuracy;
  const calibrationScore = calibration.overallCalibration;
  const consistencyScore =
    (consistency.decisionConsistency +
      consistency.styleAdherence +
      consistency.streakDiscipline) /
    3;

  // Activity score: reward frequent, recent trading
  let activityScore = DEFAULT_SCORE;
  if (decisions.length > 0) {
    const daysSinceLastTrade =
      (Date.now() - decisions[0].createdAt.getTime()) / (24 * 60 * 60 * 1000);
    const decayPenalty = daysSinceLastTrade * TRUST_DECAY_RATE * 100;
    const volumeBonus = Math.min(ACTIVITY_MAX_VOLUME_BONUS, decisions.length * ACTIVITY_VOLUME_MULTIPLIER);
    activityScore = Math.max(ELO_SCORE_FLOOR, ACTIVITY_SCORE_BASELINE + volumeBonus - decayPenalty);
  }

  const raw =
    accuracyScore * TRUST_WEIGHT_ACCURACY +
    calibrationScore * TRUST_WEIGHT_CALIBRATION +
    consistencyScore * TRUST_WEIGHT_CONSISTENCY +
    activityScore * TRUST_WEIGHT_ACTIVITY;

  return Math.round(clamp(raw, 0, 100) * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR;
}

function getTrustLevel(score: number): TrustLevel {
  for (const level of TRUST_LEVELS) {
    if (score >= level.min) return level.level;
  }
  return "untrusted";
}

// ---------------------------------------------------------------------------
// Badge System
// ---------------------------------------------------------------------------

function calculateBadges(stats: DecisionStats): Badge[] {
  const earned: Badge[] = [];
  const now = new Date().toISOString();

  for (const def of BADGE_DEFINITIONS) {
    if (def.condition(stats)) {
      earned.push({
        id: def.id,
        name: def.name,
        description: def.description,
        icon: def.icon,
        rarity: def.rarity,
        earnedAt: now,
      });
    }
  }

  return earned;
}

// ---------------------------------------------------------------------------
// Helper Calculations
// ---------------------------------------------------------------------------

function calculateMaxWinStreak(
  decisions: Array<{
    action: string;
    symbol: string;
    marketSnapshot: unknown;
  }>,
  currentMarket: MarketData[],
): number {
  let maxStreak = 0;
  let currentStreak = 0;

  const actionDecisions = decisions.filter((d) => d.action !== "hold");
  for (const d of actionDecisions) {
    const snapshot = d.marketSnapshot as Record<
      string,
      { price: number }
    > | null;
    const snapshotPrice = snapshot?.[d.symbol]?.price;
    const currentStock = currentMarket.find((m) => m.symbol === d.symbol);

    if (!snapshotPrice || !currentStock) continue;

    const change =
      ((currentStock.price - snapshotPrice) / snapshotPrice) * 100;
    const correct =
      (d.action === "buy" && change > 0) ||
      (d.action === "sell" && change < 0);

    if (correct) {
      currentStreak++;
      maxStreak = Math.max(maxStreak, currentStreak);
    } else {
      currentStreak = 0;
    }
  }

  return maxStreak;
}

function calculateContrarianWins(
  decisions: Array<{
    action: string;
    symbol: string;
    marketSnapshot: unknown;
  }>,
  currentMarket: MarketData[],
): number {
  let wins = 0;
  for (const d of decisions) {
    if (d.action === "hold") continue;
    const snapshot = d.marketSnapshot as Record<
      string,
      { price: number; change24h: number | null }
    > | null;
    const snapshotData = snapshot?.[d.symbol];
    if (!snapshotData?.change24h) continue;

    const currentStock = currentMarket.find((m) => m.symbol === d.symbol);
    if (!currentStock) continue;

    const priceChange =
      ((currentStock.price - snapshotData.price) / snapshotData.price) * 100;
    const isContrarian =
      (d.action === "buy" && snapshotData.change24h < -CONTRARIAN_THRESHOLD) ||
      (d.action === "sell" && snapshotData.change24h > CONTRARIAN_THRESHOLD);
    const isCorrect =
      (d.action === "buy" && priceChange > 0) ||
      (d.action === "sell" && priceChange < 0);

    if (isContrarian && isCorrect) wins++;
  }
  return wins;
}

function calculateHoldThroughDips(
  decisions: Array<{
    action: string;
    symbol: string;
    marketSnapshot: unknown;
    confidence: number;
  }>,
  _currentMarket: MarketData[],
): number {
  let holdThroughDips = 0;
  const holdDecisions = decisions.filter((d) => d.action === "hold");

  for (const d of holdDecisions) {
    const snapshot = d.marketSnapshot as Record<
      string,
      { price: number; change24h: number | null }
    > | null;
    const snapshotData = snapshot?.[d.symbol];
    if (snapshotData?.change24h !== null && snapshotData?.change24h !== undefined && snapshotData.change24h < CRASH_DETECTION_THRESHOLD) {
      holdThroughDips++;
    }
  }

  return holdThroughDips;
}

function buildRatingHistory(
  decisions: Array<{
    action: string;
    symbol: string;
    confidence: number;
    marketSnapshot: unknown;
    createdAt: Date;
  }>,
  currentMarket: MarketData[],
): RatingHistoryEntry[] {
  const history: RatingHistoryEntry[] = [];
  let elo = INITIAL_ELO;
  let correctCount = 0;
  let totalCount = 0;

  const chronological = [...decisions].reverse();
  const sampleRate = Math.max(1, Math.floor(chronological.length / 10));

  for (let i = 0; i < chronological.length; i++) {
    const d = chronological[i];
    if (d.action === "hold") continue;

    totalCount++;
    const snapshot = d.marketSnapshot as Record<
      string,
      { price: number }
    > | null;
    const snapshotPrice = snapshot?.[d.symbol]?.price;
    const currentStock = currentMarket.find((m) => m.symbol === d.symbol);

    if (snapshotPrice && currentStock) {
      const change =
        ((currentStock.price - snapshotPrice) / snapshotPrice) * 100;
      const isCorrect =
        (d.action === "buy" && change > 0) ||
        (d.action === "sell" && change < 0);
      if (isCorrect) correctCount++;

      const expectedScore = d.confidence / 100;
      let actualScore: number;
      if (d.action === "buy") {
        actualScore = change > 0 ? Math.min(ELO_SCORE_CEILING, ELO_SCORE_BASELINE + change / ELO_PRICE_MAGNITUDE_DIVISOR) : Math.max(ELO_SCORE_FLOOR, ELO_SCORE_BASELINE + change / ELO_PRICE_MAGNITUDE_DIVISOR);
      } else {
        actualScore = change < 0 ? Math.min(ELO_SCORE_CEILING, ELO_SCORE_BASELINE + Math.abs(change) / ELO_PRICE_MAGNITUDE_DIVISOR) : Math.max(ELO_SCORE_FLOOR, ELO_SCORE_BASELINE - change / ELO_PRICE_MAGNITUDE_DIVISOR);
      }
      elo += ELO_K_FACTOR * (actualScore - expectedScore);
      elo = Math.max(ELO_SCORE_FLOOR, elo);
    }

    if (i % sampleRate === 0 || i === chronological.length - 1) {
      const trust = totalCount > 0 ? (correctCount / totalCount) * 100 : 50;
      history.push({
        date: d.createdAt.toISOString(),
        eloRating: Math.round(elo),
        trustScore: Math.round(trust * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR,
        event: `${d.action.toUpperCase()} ${d.symbol} (${d.confidence}%)`,
      });
    }
  }

  return history.slice(-RECENT_DECISIONS_DISPLAY_LIMIT);
}

function buildEmptyReputation(
  agentId: string,
  agentName: string,
  provider: string,
): AgentReputation {
  return {
    agentId,
    agentName,
    provider,
    eloRating: INITIAL_ELO,
    eloTier: "gold",
    trustScore: 50,
    trustLevel: "moderate",
    rank: 0,
    predictionAccuracy: {
      totalPredictions: 0,
      correctPredictions: 0,
      accuracy: 0,
      buyAccuracy: 0,
      sellAccuracy: 0,
      holdAccuracy: 0,
      recentAccuracy: 0,
      accuracyTrend: "stable",
    },
    calibration: {
      overallCalibration: 50,
      bins: [],
      isOverconfident: false,
      isUnderconfident: false,
      brierScore: 0.5,
    },
    consistency: {
      decisionConsistency: 50,
      styleAdherence: 50,
      volatilityScore: 50,
      streakDiscipline: 50,
      timeConsistency: 50,
    },
    badges: [],
    ratingHistory: [],
    lastUpdated: new Date().toISOString(),
    totalDecisions: 0,
    activeSince: null,
  };
}
