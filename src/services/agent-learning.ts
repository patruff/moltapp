/**
 * Agent Learning & Feedback Loop
 *
 * Enables AI agents to learn from their past trades and improve over time.
 * This is the intelligence layer that separates MoltApp from simple LLM wrappers.
 *
 * Architecture:
 * 1. Post-Trade Analysis — after each round, evaluate what happened
 * 2. Pattern Recognition — identify recurring winning/losing patterns
 * 3. Prompt Enhancement — inject learnings into future agent prompts
 * 4. Calibration Tracking — measure how well agents predict outcomes
 * 5. Adaptive Risk Adjustment — tune risk parameters based on performance
 * 6. Cross-Agent Learning — share insights across agents (filtered by style)
 *
 * Learning is stored in-memory with periodic DynamoDB persistence.
 * Each agent maintains its own learning context that grows over time.
 */

import { eventBus } from "./event-stream.ts";
import { averageByKey, countByCondition, round2, round3 } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TradeOutcome {
  /** Agent that made the trade */
  agentId: string;
  /** Trading round ID */
  roundId: string;
  /** Stock symbol */
  symbol: string;
  /** Buy or sell */
  action: "buy" | "sell" | "hold";
  /** Agent's confidence when making the decision (0-100) */
  confidenceAtDecision: number;
  /** Price when the decision was made */
  priceAtDecision: number;
  /** Price at evaluation time (e.g., 30 min later, end of day) */
  priceAtEvaluation: number;
  /** P&L percentage of this specific trade */
  pnlPercent: number;
  /** Was the direction correct? (buy and price went up, or sell and price went down) */
  directionCorrect: boolean;
  /** Agent's reasoning at time of decision */
  reasoning: string;
  /** ISO timestamp of the trade */
  tradedAt: string;
  /** ISO timestamp of the evaluation */
  evaluatedAt: string;
}

export interface LearningPattern {
  patternId: string;
  agentId: string;
  /** Pattern type */
  type:
    | "winning_setup"
    | "losing_setup"
    | "overconfident"
    | "underconfident"
    | "symbol_strength"
    | "symbol_weakness"
    | "timing_pattern"
    | "market_condition";
  /** Human-readable description */
  description: string;
  /** How many times this pattern has been observed */
  occurrences: number;
  /** Average P&L when this pattern appears */
  avgPnlPercent: number;
  /** Confidence in the pattern (grows with more observations) */
  patternConfidence: number;
  /** Relevant symbols */
  symbols: string[];
  /** First observed */
  firstSeen: string;
  /** Last observed */
  lastSeen: string;
  /** Whether to include this in agent prompts */
  includeInPrompt: boolean;
}

export interface CalibrationData {
  agentId: string;
  /** Total predictions evaluated */
  totalPredictions: number;
  /** Predictions where the direction was correct */
  correctDirections: number;
  /** Direction accuracy percentage */
  directionAccuracy: number;
  /** Calibration by confidence bucket */
  calibrationBuckets: Array<{
    confidenceRange: string;
    predictions: number;
    correct: number;
    accuracy: number;
    isCalibrated: boolean;
  }>;
  /** Average confidence on correct predictions */
  avgConfidenceWhenCorrect: number;
  /** Average confidence on incorrect predictions */
  avgConfidenceWhenIncorrect: number;
  /** Brier score (lower is better, 0 = perfect) */
  brierScore: number;
  /** Overconfidence bias (positive = overconfident) */
  overconfidenceBias: number;
}

export interface AdaptiveRiskParams {
  agentId: string;
  /** Suggested position size multiplier (0.5 = half normal, 2.0 = double) */
  positionSizeMultiplier: number;
  /** Suggested confidence threshold for trading (raise if often wrong) */
  minConfidenceThreshold: number;
  /** Suggested symbols to avoid */
  avoidSymbols: string[];
  /** Suggested symbols where agent excels */
  strengthSymbols: string[];
  /** Recent win rate */
  recentWinRate: number;
  /** Streak info */
  currentStreak: { type: "win" | "loss"; count: number };
  /** Last updated */
  updatedAt: string;
}

export interface AgentLearningContext {
  agentId: string;
  /** Number of trades analyzed */
  tradesAnalyzed: number;
  /** Overall win rate */
  winRate: number;
  /** Patterns discovered */
  patterns: LearningPattern[];
  /** Calibration metrics */
  calibration: CalibrationData;
  /** Adaptive risk parameters */
  riskParams: AdaptiveRiskParams;
  /** Recent trade outcomes */
  recentOutcomes: TradeOutcome[];
  /** Generated prompt section for this agent's learnings */
  promptSection: string;
  /** Last updated */
  updatedAt: string;
}

export interface LearningMetrics {
  totalTradesAnalyzed: number;
  totalPatternsDiscovered: number;
  agentCount: number;
  avgWinRate: number;
  avgDirectionAccuracy: number;
  avgBrierScore: number;
  bestPerformer: { agentId: string; winRate: number } | null;
  worstPerformer: { agentId: string; winRate: number } | null;
  lastAnalysisAt: string | null;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Trade outcomes per agent: agentId -> outcomes[] */
const tradeOutcomes = new Map<string, TradeOutcome[]>();

/** Discovered patterns per agent: agentId -> patterns[] */
const agentPatterns = new Map<string, LearningPattern[]>();

/** Adaptive risk params per agent */
const riskParams = new Map<string, AdaptiveRiskParams>();

/** Last analysis timestamp */
let lastAnalysisAt: string | null = null;

/** Pattern ID counter */
let patternCounter = 0;

const MAX_OUTCOMES_PER_AGENT = 200;
const MAX_PATTERNS_PER_AGENT = 50;

// Calibration buckets
const CONFIDENCE_BUCKETS = [
  { min: 0, max: 20, label: "0-20%" },
  { min: 20, max: 40, label: "20-40%" },
  { min: 40, max: 60, label: "40-60%" },
  { min: 60, max: 80, label: "60-80%" },
  { min: 80, max: 100, label: "80-100%" },
];

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Pattern Recognition Thresholds
 *
 * These control when agent learning patterns are identified and flagged.
 * Tuning these affects how quickly agents learn from their trading history.
 */

/** Minimum trades required for pattern discovery */
const PATTERN_MIN_TRADES_FOR_DISCOVERY = 5;

/** Minimum trades per symbol required for symbol-specific performance classification */
const PATTERN_MIN_TRADES_PER_SYMBOL = 3;

/** Win rate threshold for identifying symbol strength (70% = strong performance) */
const PATTERN_SYMBOL_STRENGTH_WIN_RATE = 0.7;

/** Win rate threshold for identifying symbol weakness (30% = weak performance) */
const PATTERN_SYMBOL_WEAKNESS_WIN_RATE = 0.3;

/** Minimum occurrences to flag overconfidence pattern (3+ high-conf wrong trades) */
const PATTERN_OVERCONFIDENCE_MIN_OCCURRENCES = 3;

/** Minimum occurrences to flag underconfidence pattern (3+ low-conf right trades) */
const PATTERN_UNDERCONFIDENCE_MIN_OCCURRENCES = 3;

/** Minimum losing streak length to trigger losing setup pattern (4+ consecutive losses) */
const PATTERN_LOSING_STREAK_THRESHOLD = 4;

/** Minimum trades per action type for buy vs sell accuracy comparison */
const PATTERN_MIN_TRADES_PER_ACTION = 5;

/** Accuracy differential threshold for buy vs sell pattern (20% difference = pattern) */
const PATTERN_ACCURACY_DIFFERENTIAL_THRESHOLD = 0.2;

/**
 * Confidence Calibration Parameters
 *
 * These control calibration scoring and overconfidence/underconfidence detection.
 * Affects how agents adjust their confidence levels based on historical accuracy.
 */

/** High confidence threshold for overconfidence detection (80%+ confidence) */
const CALIBRATION_HIGH_CONFIDENCE_THRESHOLD = 80;

/** Low confidence threshold for underconfidence detection (≤40% confidence) */
const CALIBRATION_LOW_CONFIDENCE_THRESHOLD = 40;

/** Calibration tolerance: actual accuracy within ±15% of stated confidence = calibrated */
const CALIBRATION_TOLERANCE = 0.15;

/** Minimum predictions per bucket for statistical significance in calibration analysis */
const CALIBRATION_MIN_PREDICTIONS_PER_BUCKET = 3;

/** Overconfidence bias threshold for raising confidence bar (+15 = significant overconfidence) */
const CALIBRATION_OVERCONFIDENCE_BIAS_THRESHOLD = 15;

/** Underconfidence bias threshold for lowering confidence bar (-10 = significant underconfidence) */
const CALIBRATION_UNDERCONFIDENCE_BIAS_THRESHOLD = -10;

/** Overconfidence bias threshold for prompt warning (+10 = warn agent) */
const CALIBRATION_OVERCONFIDENCE_WARNING_THRESHOLD = 10;

/**
 * Adaptive Risk Parameters
 *
 * These control position sizing and confidence threshold adjustments based on performance.
 * Directly affects agent position sizing and trade frequency.
 */

/** Lookback window for adaptive risk calculation (last 30 trades) */
const ADAPTIVE_RISK_LOOKBACK_WINDOW = 30;

/** Minimum trades required for adaptive risk calculation (5+ for statistical significance) */
const ADAPTIVE_RISK_MIN_TRADES = 5;

/** Default position size multiplier when insufficient data (1.0x = normal sizing) */
const ADAPTIVE_RISK_DEFAULT_MULTIPLIER = 1.0;

/** Default minimum confidence threshold when insufficient data (50% baseline) */
const ADAPTIVE_RISK_DEFAULT_MIN_CONFIDENCE = 50;

/** Win rate threshold for 0.5x position reduction (< 35% = poor performance) */
const ADAPTIVE_RISK_WIN_RATE_REDUCTION_SEVERE = 0.35;

/** Win rate threshold for 0.75x position reduction (35-45% = below average) */
const ADAPTIVE_RISK_WIN_RATE_REDUCTION_MODERATE = 0.45;

/** Win rate threshold for 1.3x position increase (> 65% = strong performance) */
const ADAPTIVE_RISK_WIN_RATE_INCREASE_MODERATE = 0.65;

/** Win rate threshold for 1.5x position increase (> 75% = exceptional performance) */
const ADAPTIVE_RISK_WIN_RATE_INCREASE_STRONG = 0.75;

/** Position size multiplier for severe underperformance (0.5x = half normal size) */
const ADAPTIVE_RISK_MULTIPLIER_SEVERE_REDUCTION = 0.5;

/** Position size multiplier for moderate underperformance (0.75x = 25% reduction) */
const ADAPTIVE_RISK_MULTIPLIER_MODERATE_REDUCTION = 0.75;

/** Position size multiplier for moderate outperformance (1.3x = 30% increase) */
const ADAPTIVE_RISK_MULTIPLIER_MODERATE_INCREASE = 1.3;

/** Position size multiplier for strong outperformance (1.5x = 50% increase, capped) */
const ADAPTIVE_RISK_MULTIPLIER_STRONG_INCREASE = 1.5;

/** Raised minimum confidence for overconfident agents (65% vs 50% baseline) */
const ADAPTIVE_RISK_MIN_CONFIDENCE_OVERCONFIDENT = 65;

/** Lowered minimum confidence for underconfident agents (35% vs 50% baseline) */
const ADAPTIVE_RISK_MIN_CONFIDENCE_UNDERCONFIDENT = 35;

/** Symbol win rate threshold for avoiding symbol (≤ 20% = avoid) */
const ADAPTIVE_RISK_SYMBOL_AVOID_THRESHOLD = 0.2;

/** Symbol win rate threshold for strength symbol (≥ 75% = strength) */
const ADAPTIVE_RISK_SYMBOL_STRENGTH_THRESHOLD = 0.75;

/** Minimum trades per symbol for symbol-specific risk adjustment */
const ADAPTIVE_RISK_MIN_TRADES_PER_SYMBOL = 3;

/** Losing streak length to trigger position size reduction (3+ losses = reduce) */
const ADAPTIVE_RISK_LOSING_STREAK_THRESHOLD = 3;

/** Maximum position size multiplier during losing streak (0.6x cap) */
const ADAPTIVE_RISK_LOSING_STREAK_MAX_MULTIPLIER = 0.6;

/**
 * Prompt Generation Parameters
 *
 * These control which patterns and insights appear in agent learning prompts.
 * Affects what information agents receive to inform future decisions.
 */

/** Minimum trades for generating learning prompt (5+ for meaningful insights) */
const PROMPT_MIN_TRADES_FOR_GENERATION = 5;

/** Maximum patterns shown in prompt (top 5 most relevant) */
const PROMPT_MAX_PATTERNS_DISPLAYED = 5;

/** Minimum streak length for streak awareness in prompt (3+ trades = alert) */
const PROMPT_STREAK_AWARENESS_THRESHOLD = 3;

/** Pattern confidence threshold for prompt inclusion (60%+ = include in prompt) */
const PROMPT_PATTERN_CONFIDENCE_THRESHOLD = 60;

/**
 * Cross-Agent Learning Parameters
 *
 * These control how agents learn from each other's trading history and share insights.
 * Affects cross-agent intelligence sharing and learning prompt generation.
 */

/** Minimum trades required from other agents before including their insights (5+ for statistical reliability) */
const CROSS_AGENT_MIN_OUTCOMES_FOR_INSIGHTS = 5;

/** Recent trading outcomes window for cross-agent intelligence sharing (last 10 trades) */
const CROSS_AGENT_RECENT_TRADES_WINDOW = 10;

/** Recent actions display limit in cross-agent insights (show last 3 actions per agent) */
const CROSS_AGENT_RECENT_ACTIONS_DISPLAY_LIMIT = 3;

/**
 * Agent Snapshot Parameters
 *
 * These control what recent trading history is included in agent snapshots and learning prompts.
 * Affects how much historical context agents receive when making decisions.
 */

/** Recent outcomes window for agent snapshot generation (last 10 trades) */
const SNAPSHOT_RECENT_OUTCOMES_WINDOW = 10;

/**
 * Metrics Aggregation Parameters
 *
 * These control minimum data requirements for system-wide learning metrics calculation.
 * Ensures statistical significance when calculating overall system performance.
 */

/** Minimum trades per agent required for inclusion in system-wide metrics (3+ for basic statistics) */
const METRICS_MIN_TRADES_FOR_AGGREGATION = 3;

// ---------------------------------------------------------------------------
// Core Analysis
// ---------------------------------------------------------------------------

/**
 * Record a trade outcome for analysis.
 * Call this after evaluating a past trade (e.g., 30 min or 1 day later).
 */
export function recordTradeOutcome(outcome: TradeOutcome): void {
  let outcomes = tradeOutcomes.get(outcome.agentId);
  if (!outcomes) {
    outcomes = [];
    tradeOutcomes.set(outcome.agentId, outcomes);
  }

  outcomes.push(outcome);

  // Bound the array
  if (outcomes.length > MAX_OUTCOMES_PER_AGENT) {
    outcomes.splice(0, outcomes.length - MAX_OUTCOMES_PER_AGENT);
  }

  // Emit event
  try {
    eventBus.emit("trade_outcome_recorded", {
      agentId: outcome.agentId,
      symbol: outcome.symbol,
      pnlPercent: outcome.pnlPercent,
      directionCorrect: outcome.directionCorrect,
    });
  } catch {
    // Non-critical
  }
}

/**
 * Analyze trades from a completed round and generate outcomes.
 * Compares decision prices against current prices to evaluate performance.
 */
export function analyzeRoundOutcomes(
  roundId: string,
  decisions: Array<{
    agentId: string;
    symbol: string;
    action: "buy" | "sell" | "hold";
    confidence: number;
    priceAtDecision: number;
    reasoning: string;
    tradedAt: string;
  }>,
  currentPrices: Record<string, number>,
): TradeOutcome[] {
  const outcomes: TradeOutcome[] = [];
  const now = new Date().toISOString();

  for (const decision of decisions) {
    const currentPrice = currentPrices[decision.symbol];
    if (!currentPrice || decision.action === "hold") continue;

    const priceChange = currentPrice - decision.priceAtDecision;
    const pnlPercent =
      decision.priceAtDecision > 0
        ? (priceChange / decision.priceAtDecision) * 100
        : 0;

    // Direction correct if: buy and price went up, or sell and price went down
    const directionCorrect =
      (decision.action === "buy" && priceChange > 0) ||
      (decision.action === "sell" && priceChange < 0);

    const outcome: TradeOutcome = {
      agentId: decision.agentId,
      roundId,
      symbol: decision.symbol,
      action: decision.action,
      confidenceAtDecision: decision.confidence,
      priceAtDecision: decision.priceAtDecision,
      priceAtEvaluation: currentPrice,
      pnlPercent: decision.action === "sell" ? -pnlPercent : pnlPercent,
      directionCorrect,
      reasoning: decision.reasoning,
      tradedAt: decision.tradedAt,
      evaluatedAt: now,
    };

    outcomes.push(outcome);
    recordTradeOutcome(outcome);
  }

  lastAnalysisAt = now;
  return outcomes;
}

/**
 * Run pattern recognition on an agent's trade history.
 * Identifies recurring winning/losing setups, calibration issues, etc.
 */
export function discoverPatterns(agentId: string): LearningPattern[] {
  const outcomes = tradeOutcomes.get(agentId) ?? [];
  if (outcomes.length < PATTERN_MIN_TRADES_FOR_DISCOVERY) return []; // Need minimum data

  const patterns: LearningPattern[] = [];
  const now = new Date().toISOString();

  // --- Pattern 1: Symbol-specific strength/weakness ---
  const symbolStats = new Map<
    string,
    { wins: number; losses: number; totalPnl: number; count: number }
  >();

  for (const outcome of outcomes) {
    let stats = symbolStats.get(outcome.symbol);
    if (!stats) {
      stats = { wins: 0, losses: 0, totalPnl: 0, count: 0 };
      symbolStats.set(outcome.symbol, stats);
    }
    stats.count++;
    stats.totalPnl += outcome.pnlPercent;
    if (outcome.directionCorrect) stats.wins++;
    else stats.losses++;
  }

  for (const [symbol, stats] of symbolStats) {
    if (stats.count < PATTERN_MIN_TRADES_PER_SYMBOL) continue;

    const winRate = stats.wins / stats.count;
    const avgPnl = stats.totalPnl / stats.count;

    if (winRate >= PATTERN_SYMBOL_STRENGTH_WIN_RATE && avgPnl > 0) {
      patterns.push(createPattern(agentId, "symbol_strength",
        `Strong performance on ${symbol}: ${(winRate * 100).toFixed(0)}% win rate, avg +${avgPnl.toFixed(2)}% per trade`,
        stats.count, avgPnl, winRate * 100, [symbol], now,
      ));
    } else if (winRate <= PATTERN_SYMBOL_WEAKNESS_WIN_RATE && avgPnl < 0) {
      patterns.push(createPattern(agentId, "symbol_weakness",
        `Weak performance on ${symbol}: ${(winRate * 100).toFixed(0)}% win rate, avg ${avgPnl.toFixed(2)}% per trade`,
        stats.count, avgPnl, (1 - winRate) * 100, [symbol], now,
      ));
    }
  }

  // --- Pattern 2: Overconfidence/Underconfidence ---
  const highConfWrong = outcomes.filter(
    (o) => o.confidenceAtDecision >= CALIBRATION_HIGH_CONFIDENCE_THRESHOLD && !o.directionCorrect,
  );
  const lowConfRight = outcomes.filter(
    (o) => o.confidenceAtDecision <= CALIBRATION_LOW_CONFIDENCE_THRESHOLD && o.directionCorrect,
  );

  if (highConfWrong.length >= PATTERN_OVERCONFIDENCE_MIN_OCCURRENCES) {
    const avgLoss = averageByKey(highConfWrong, 'pnlPercent');
    patterns.push(createPattern(agentId, "overconfident",
      `Overconfidence detected: ${highConfWrong.length} high-confidence (${CALIBRATION_HIGH_CONFIDENCE_THRESHOLD}%+) trades were wrong, avg loss ${avgLoss.toFixed(2)}%. Consider lowering confidence or reducing position size on high-conviction calls.`,
      highConfWrong.length, avgLoss, CALIBRATION_HIGH_CONFIDENCE_THRESHOLD,
      [...new Set(highConfWrong.map((o) => o.symbol))], now,
    ));
  }

  if (lowConfRight.length >= PATTERN_UNDERCONFIDENCE_MIN_OCCURRENCES) {
    const avgGain = averageByKey(lowConfRight, 'pnlPercent');
    patterns.push(createPattern(agentId, "underconfident",
      `Underconfidence detected: ${lowConfRight.length} low-confidence (≤${CALIBRATION_LOW_CONFIDENCE_THRESHOLD}%) trades were correct, avg gain +${avgGain.toFixed(2)}%. You may be underestimating edge on some setups.`,
      lowConfRight.length, avgGain, 75,
      [...new Set(lowConfRight.map((o) => o.symbol))], now,
    ));
  }

  // --- Pattern 3: Winning/Losing Streaks ---
  const sorted = [...outcomes].sort(
    (a, b) => new Date(a.tradedAt).getTime() - new Date(b.tradedAt).getTime(),
  );

  let currentStreak = 0;
  let streakType: "win" | "loss" = "win";
  let maxWinStreak = 0;
  let maxLossStreak = 0;

  for (const outcome of sorted) {
    if (outcome.directionCorrect) {
      if (streakType === "win") currentStreak++;
      else { currentStreak = 1; streakType = "win"; }
      maxWinStreak = Math.max(maxWinStreak, currentStreak);
    } else {
      if (streakType === "loss") currentStreak++;
      else { currentStreak = 1; streakType = "loss"; }
      maxLossStreak = Math.max(maxLossStreak, currentStreak);
    }
  }

  if (maxLossStreak >= PATTERN_LOSING_STREAK_THRESHOLD) {
    patterns.push(createPattern(agentId, "losing_setup",
      `Extended losing streak detected: ${maxLossStreak} consecutive wrong predictions. Consider reducing position sizes during cold streaks.`,
      maxLossStreak, -2, 70, [], now,
    ));
  }

  // --- Pattern 4: Buy vs Sell accuracy ---
  const buyOutcomes = outcomes.filter((o) => o.action === "buy");
  const sellOutcomes = outcomes.filter((o) => o.action === "sell");

  if (buyOutcomes.length >= PATTERN_MIN_TRADES_PER_ACTION && sellOutcomes.length >= PATTERN_MIN_TRADES_PER_ACTION) {
    const buyAccuracy =
      countByCondition(buyOutcomes, (o) => o.directionCorrect) / buyOutcomes.length;
    const sellAccuracy =
      countByCondition(sellOutcomes, (o) => o.directionCorrect) / sellOutcomes.length;

    if (buyAccuracy > sellAccuracy + PATTERN_ACCURACY_DIFFERENTIAL_THRESHOLD) {
      patterns.push(createPattern(agentId, "winning_setup",
        `Better at buying (${(buyAccuracy * 100).toFixed(0)}%) than selling (${(sellAccuracy * 100).toFixed(0)}%). Consider focusing on long positions.`,
        buyOutcomes.length + sellOutcomes.length, 0, 65, [], now,
      ));
    } else if (sellAccuracy > buyAccuracy + PATTERN_ACCURACY_DIFFERENTIAL_THRESHOLD) {
      patterns.push(createPattern(agentId, "winning_setup",
        `Better at selling (${(sellAccuracy * 100).toFixed(0)}%) than buying (${(buyAccuracy * 100).toFixed(0)}%). Consider focusing on short/exit timing.`,
        buyOutcomes.length + sellOutcomes.length, 0, 65, [], now,
      ));
    }
  }

  // Store patterns
  agentPatterns.set(agentId, patterns.slice(0, MAX_PATTERNS_PER_AGENT));

  return patterns;
}

// ---------------------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------------------

/**
 * Calculate calibration metrics for an agent.
 * Measures how well the agent's confidence correlates with actual accuracy.
 */
export function getCalibration(agentId: string): CalibrationData {
  const outcomes = tradeOutcomes.get(agentId) ?? [];
  const tradingOutcomes = outcomes.filter((o) => o.action !== "hold");

  if (tradingOutcomes.length === 0) {
    return {
      agentId,
      totalPredictions: 0,
      correctDirections: 0,
      directionAccuracy: 0,
      calibrationBuckets: CONFIDENCE_BUCKETS.map((b) => ({
        confidenceRange: b.label,
        predictions: 0,
        correct: 0,
        accuracy: 0,
        isCalibrated: true,
      })),
      avgConfidenceWhenCorrect: 0,
      avgConfidenceWhenIncorrect: 0,
      brierScore: 0,
      overconfidenceBias: 0,
    };
  }

  const correct = tradingOutcomes.filter((o) => o.directionCorrect);
  const incorrect = tradingOutcomes.filter((o) => !o.directionCorrect);

  // Calibration buckets
  const buckets = CONFIDENCE_BUCKETS.map((bucket) => {
    const inBucket = tradingOutcomes.filter(
      (o) => o.confidenceAtDecision >= bucket.min && o.confidenceAtDecision < bucket.max,
    );
    const correctInBucket = inBucket.filter((o) => o.directionCorrect);
    const accuracy = inBucket.length > 0 ? correctInBucket.length / inBucket.length : 0;

    // "Calibrated" means actual accuracy is within tolerance of stated confidence
    const expectedAccuracy = (bucket.min + bucket.max) / 200; // Convert to 0-1
    const isCalibrated = inBucket.length < CALIBRATION_MIN_PREDICTIONS_PER_BUCKET || Math.abs(accuracy - expectedAccuracy) < CALIBRATION_TOLERANCE;

    return {
      confidenceRange: bucket.label,
      predictions: inBucket.length,
      correct: correctInBucket.length,
      accuracy: Math.round(accuracy * 100),
      isCalibrated,
    };
  });

  // Brier score: mean squared error between confidence and outcome
  let brierSum = 0;
  for (const outcome of tradingOutcomes) {
    const prob = outcome.confidenceAtDecision / 100;
    const actual = outcome.directionCorrect ? 1 : 0;
    brierSum += (prob - actual) ** 2;
  }
  const brierScore = tradingOutcomes.length > 0 ? brierSum / tradingOutcomes.length : 0;

  // Overconfidence bias
  const avgConfidence = averageByKey(tradingOutcomes, 'confidenceAtDecision');
  const actualAccuracy = (correct.length / tradingOutcomes.length) * 100;
  const overconfidenceBias = avgConfidence - actualAccuracy;

  return {
    agentId,
    totalPredictions: tradingOutcomes.length,
    correctDirections: correct.length,
    directionAccuracy: Math.round(actualAccuracy * 10) / 10,
    calibrationBuckets: buckets,
    avgConfidenceWhenCorrect:
      correct.length > 0
        ? Math.round(averageByKey(correct, 'confidenceAtDecision') * 10) / 10
        : 0,
    avgConfidenceWhenIncorrect:
      incorrect.length > 0
        ? Math.round(averageByKey(incorrect, 'confidenceAtDecision') * 10) / 10
        : 0,
    brierScore: round3(brierScore),
    overconfidenceBias: Math.round(overconfidenceBias * 10) / 10,
  };
}

// ---------------------------------------------------------------------------
// Adaptive Risk Parameters
// ---------------------------------------------------------------------------

/**
 * Calculate adaptive risk parameters based on recent performance.
 * These are injected into the agent's next trading round.
 */
export function calculateAdaptiveRisk(agentId: string): AdaptiveRiskParams {
  const outcomes = tradeOutcomes.get(agentId) ?? [];
  const recent = outcomes.slice(-ADAPTIVE_RISK_LOOKBACK_WINDOW);

  if (recent.length < ADAPTIVE_RISK_MIN_TRADES) {
    const defaultParams: AdaptiveRiskParams = {
      agentId,
      positionSizeMultiplier: ADAPTIVE_RISK_DEFAULT_MULTIPLIER,
      minConfidenceThreshold: ADAPTIVE_RISK_DEFAULT_MIN_CONFIDENCE,
      avoidSymbols: [],
      strengthSymbols: [],
      recentWinRate: 0,
      currentStreak: { type: "win", count: 0 },
      updatedAt: new Date().toISOString(),
    };
    riskParams.set(agentId, defaultParams);
    return defaultParams;
  }

  // Calculate recent win rate
  const tradingRecent = recent.filter((o) => o.action !== "hold");
  const wins = countByCondition(tradingRecent, (o) => o.directionCorrect);
  const winRate = tradingRecent.length > 0 ? wins / tradingRecent.length : 0.5;

  // Position size multiplier based on win rate
  let positionSizeMultiplier = ADAPTIVE_RISK_DEFAULT_MULTIPLIER;
  if (winRate < ADAPTIVE_RISK_WIN_RATE_REDUCTION_SEVERE) {
    positionSizeMultiplier = ADAPTIVE_RISK_MULTIPLIER_SEVERE_REDUCTION;
  } else if (winRate < ADAPTIVE_RISK_WIN_RATE_REDUCTION_MODERATE) {
    positionSizeMultiplier = ADAPTIVE_RISK_MULTIPLIER_MODERATE_REDUCTION;
  } else if (winRate > ADAPTIVE_RISK_WIN_RATE_INCREASE_STRONG) {
    positionSizeMultiplier = ADAPTIVE_RISK_MULTIPLIER_STRONG_INCREASE;
  } else if (winRate > ADAPTIVE_RISK_WIN_RATE_INCREASE_MODERATE) {
    positionSizeMultiplier = ADAPTIVE_RISK_MULTIPLIER_MODERATE_INCREASE;
  }

  // Minimum confidence threshold
  const calibration = getCalibration(agentId);
  let minConfidence = ADAPTIVE_RISK_DEFAULT_MIN_CONFIDENCE;
  if (calibration.overconfidenceBias > CALIBRATION_OVERCONFIDENCE_BIAS_THRESHOLD) {
    // Agent is overconfident — raise the bar
    minConfidence = ADAPTIVE_RISK_MIN_CONFIDENCE_OVERCONFIDENT;
  } else if (calibration.overconfidenceBias < CALIBRATION_UNDERCONFIDENCE_BIAS_THRESHOLD) {
    // Agent is underconfident — lower the bar
    minConfidence = ADAPTIVE_RISK_MIN_CONFIDENCE_UNDERCONFIDENT;
  }

  // Identify strong/weak symbols
  const symbolPerf = new Map<string, { wins: number; total: number }>();
  for (const outcome of recent) {
    const perf = symbolPerf.get(outcome.symbol) ?? { wins: 0, total: 0 };
    perf.total++;
    if (outcome.directionCorrect) perf.wins++;
    symbolPerf.set(outcome.symbol, perf);
  }

  const avoidSymbols: string[] = [];
  const strengthSymbols: string[] = [];

  for (const [symbol, perf] of symbolPerf) {
    if (perf.total < ADAPTIVE_RISK_MIN_TRADES_PER_SYMBOL) continue;
    const symbolWinRate = perf.wins / perf.total;
    if (symbolWinRate <= ADAPTIVE_RISK_SYMBOL_AVOID_THRESHOLD) avoidSymbols.push(symbol);
    else if (symbolWinRate >= ADAPTIVE_RISK_SYMBOL_STRENGTH_THRESHOLD) strengthSymbols.push(symbol);
  }

  // Current streak
  let streakType: "win" | "loss" = "win";
  let streakCount = 0;
  const sorted = [...tradingRecent].sort(
    (a, b) => new Date(b.tradedAt).getTime() - new Date(a.tradedAt).getTime(),
  );

  if (sorted.length > 0) {
    streakType = sorted[0].directionCorrect ? "win" : "loss";
    streakCount = 1;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].directionCorrect === sorted[0].directionCorrect) {
        streakCount++;
      } else {
        break;
      }
    }
  }

  // If on a losing streak, reduce position size
  if (streakType === "loss" && streakCount >= ADAPTIVE_RISK_LOSING_STREAK_THRESHOLD) {
    positionSizeMultiplier = Math.min(positionSizeMultiplier, ADAPTIVE_RISK_LOSING_STREAK_MAX_MULTIPLIER);
  }

  const params: AdaptiveRiskParams = {
    agentId,
    positionSizeMultiplier: round2(positionSizeMultiplier),
    minConfidenceThreshold: minConfidence,
    avoidSymbols,
    strengthSymbols,
    recentWinRate: Math.round(winRate * 1000) / 10,
    currentStreak: { type: streakType, count: streakCount },
    updatedAt: new Date().toISOString(),
  };

  riskParams.set(agentId, params);
  return params;
}

// ---------------------------------------------------------------------------
// Prompt Generation
// ---------------------------------------------------------------------------

/**
 * Generate a learning context prompt section for an agent.
 * This is injected into the agent's system prompt to inform future decisions.
 */
export function generateLearningPrompt(agentId: string): string {
  const outcomes = tradeOutcomes.get(agentId) ?? [];
  if (outcomes.length < PROMPT_MIN_TRADES_FOR_GENERATION) return "";

  const patterns = agentPatterns.get(agentId) ?? discoverPatterns(agentId);
  const calibration = getCalibration(agentId);
  const risk = calculateAdaptiveRisk(agentId);

  const sections: string[] = [];
  sections.push("LEARNING FROM YOUR PAST TRADES:");
  sections.push(`  Trades analyzed: ${outcomes.length}`);
  sections.push(`  Direction accuracy: ${calibration.directionAccuracy}%`);
  sections.push(`  Recent win rate: ${risk.recentWinRate}%`);

  if (calibration.overconfidenceBias > CALIBRATION_OVERCONFIDENCE_WARNING_THRESHOLD) {
    sections.push(
      `  WARNING: You tend to be overconfident (bias: +${calibration.overconfidenceBias}%). Consider being more cautious with high-confidence calls.`,
    );
  }
  if (calibration.overconfidenceBias < CALIBRATION_UNDERCONFIDENCE_BIAS_THRESHOLD) {
    sections.push(
      `  NOTE: You tend to be underconfident (bias: ${calibration.overconfidenceBias}%). Your low-confidence calls often succeed — trust your analysis more.`,
    );
  }

  // Add key patterns
  const promptPatterns = patterns.filter((p) => p.includeInPrompt);
  if (promptPatterns.length > 0) {
    sections.push("  KEY PATTERNS:");
    for (const pattern of promptPatterns.slice(0, PROMPT_MAX_PATTERNS_DISPLAYED)) {
      sections.push(`    - ${pattern.description}`);
    }
  }

  // Risk adjustments
  if (risk.avoidSymbols.length > 0) {
    sections.push(
      `  CAUTION: You have historically underperformed on: ${risk.avoidSymbols.join(", ")}. Consider smaller positions or avoiding these.`,
    );
  }
  if (risk.strengthSymbols.length > 0) {
    sections.push(
      `  STRENGTH: You perform well on: ${risk.strengthSymbols.join(", ")}. Consider these as higher-conviction opportunities.`,
    );
  }

  // Streak awareness
  if (risk.currentStreak.count >= PROMPT_STREAK_AWARENESS_THRESHOLD) {
    if (risk.currentStreak.type === "loss") {
      sections.push(
        `  ALERT: On a ${risk.currentStreak.count}-trade losing streak. Position sizes reduced. Focus on highest-conviction setups only.`,
      );
    } else {
      sections.push(
        `  STATUS: On a ${risk.currentStreak.count}-trade winning streak. Stay disciplined — don't increase risk.`,
      );
    }
  }

  sections.push(`  Position size adjustment: ${risk.positionSizeMultiplier}x normal`);
  sections.push(`  Minimum confidence to trade: ${risk.minConfidenceThreshold}%`);

  return sections.join("\n");
}

// ---------------------------------------------------------------------------
// Full Agent Learning Context
// ---------------------------------------------------------------------------

/**
 * Get the complete learning context for an agent.
 * Used by the orchestrator to enrich agent prompts.
 */
export function getAgentLearningContext(agentId: string): AgentLearningContext {
  const outcomes = tradeOutcomes.get(agentId) ?? [];
  const patterns = agentPatterns.get(agentId) ?? discoverPatterns(agentId);
  const calibration = getCalibration(agentId);
  const risk = calculateAdaptiveRisk(agentId);
  const promptSection = generateLearningPrompt(agentId);

  const tradingOutcomes = outcomes.filter((o) => o.action !== "hold");
  const winRate =
    tradingOutcomes.length > 0
      ? (countByCondition(tradingOutcomes, (o) => o.directionCorrect) /
          tradingOutcomes.length) *
        100
      : 0;

  return {
    agentId,
    tradesAnalyzed: outcomes.length,
    winRate: Math.round(winRate * 10) / 10,
    patterns,
    calibration,
    riskParams: risk,
    recentOutcomes: outcomes.slice(-SNAPSHOT_RECENT_OUTCOMES_WINDOW),
    promptSection,
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Cross-Agent Learning
// ---------------------------------------------------------------------------

/**
 * Get insights from other agents that might be useful.
 * Filters for relevance to the requesting agent's trading style.
 */
export function getCrossAgentInsights(
  requestingAgentId: string,
): string {
  const allAgentIds = Array.from(tradeOutcomes.keys());
  const otherAgents = allAgentIds.filter((id) => id !== requestingAgentId);

  if (otherAgents.length === 0) return "";

  const insights: string[] = [];
  insights.push("CROSS-AGENT INTELLIGENCE:");

  for (const agentId of otherAgents) {
    const outcomes = tradeOutcomes.get(agentId) ?? [];
    if (outcomes.length < CROSS_AGENT_MIN_OUTCOMES_FOR_INSIGHTS) continue;

    const tradingOutcomes = outcomes.filter((o) => o.action !== "hold");
    const recent = tradingOutcomes.slice(-CROSS_AGENT_RECENT_TRADES_WINDOW);
    const recentWinRate =
      recent.length > 0
        ? (recent.filter((o) => o.directionCorrect).length / recent.length) * 100
        : 0;

    // Share recent action summary
    const recentActions = recent
      .slice(-CROSS_AGENT_RECENT_ACTIONS_DISPLAY_LIMIT)
      .map((o) => `${o.action} ${o.symbol}`);
    insights.push(
      `  ${agentId}: ${recentWinRate.toFixed(0)}% recent accuracy — latest: ${recentActions.join(", ")}`,
    );
  }

  return insights.join("\n");
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/**
 * Get overall learning system metrics.
 */
export function getLearningMetrics(): LearningMetrics {
  let totalTrades = 0;
  let totalPatterns = 0;
  let totalWinRate = 0;
  let totalAccuracy = 0;
  let totalBrier = 0;
  let agentCount = 0;
  let bestPerformer: { agentId: string; winRate: number } | null = null;
  let worstPerformer: { agentId: string; winRate: number } | null = null;

  for (const [agentId, outcomes] of tradeOutcomes) {
    const tradingOutcomes = outcomes.filter((o) => o.action !== "hold");
    if (tradingOutcomes.length < 3) continue;

    agentCount++;
    totalTrades += outcomes.length;
    totalPatterns += (agentPatterns.get(agentId) ?? []).length;

    const winRate =
      (tradingOutcomes.filter((o) => o.directionCorrect).length /
        tradingOutcomes.length) *
      100;
    totalWinRate += winRate;

    const calibration = getCalibration(agentId);
    totalAccuracy += calibration.directionAccuracy;
    totalBrier += calibration.brierScore;

    if (!bestPerformer || winRate > bestPerformer.winRate) {
      bestPerformer = { agentId, winRate: Math.round(winRate * 10) / 10 };
    }
    if (!worstPerformer || winRate < worstPerformer.winRate) {
      worstPerformer = { agentId, winRate: Math.round(winRate * 10) / 10 };
    }
  }

  return {
    totalTradesAnalyzed: totalTrades,
    totalPatternsDiscovered: totalPatterns,
    agentCount,
    avgWinRate: agentCount > 0 ? Math.round((totalWinRate / agentCount) * 10) / 10 : 0,
    avgDirectionAccuracy:
      agentCount > 0 ? Math.round((totalAccuracy / agentCount) * 10) / 10 : 0,
    avgBrierScore: agentCount > 0 ? round3(totalBrier / agentCount) : 0,
    bestPerformer,
    worstPerformer,
    lastAnalysisAt,
  };
}

/**
 * Reset all learning data for an agent (admin use).
 */
export function resetAgentLearning(agentId: string): void {
  tradeOutcomes.delete(agentId);
  agentPatterns.delete(agentId);
  riskParams.delete(agentId);
  console.log(`[AgentLearning] Reset learning data for ${agentId}`);
}

/**
 * Reset all learning data (admin use).
 */
export function resetAllLearning(): void {
  tradeOutcomes.clear();
  agentPatterns.clear();
  riskParams.clear();
  lastAnalysisAt = null;
  console.log("[AgentLearning] All learning data reset");
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

function createPattern(
  agentId: string,
  type: LearningPattern["type"],
  description: string,
  occurrences: number,
  avgPnlPercent: number,
  patternConfidence: number,
  symbols: string[],
  now: string,
): LearningPattern {
  patternCounter++;
  return {
    patternId: `pat_${patternCounter.toString(36)}`,
    agentId,
    type,
    description,
    occurrences,
    avgPnlPercent: round2(avgPnlPercent),
    patternConfidence: Math.round(patternConfidence),
    symbols,
    firstSeen: now,
    lastSeen: now,
    includeInPrompt: patternConfidence >= PROMPT_PATTERN_CONFIDENCE_THRESHOLD,
  };
}
