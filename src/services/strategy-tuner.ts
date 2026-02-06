/**
 * Agent Strategy Tuner
 *
 * Dynamically adjusts agent trading parameters based on their historical
 * performance. This is adaptive risk management — agents that are losing
 * get more conservative, agents that are winning get more latitude.
 *
 * Tuning dimensions:
 * 1. Position sizing — reduce after losses, increase after wins
 * 2. Confidence threshold — require higher confidence during drawdowns
 * 3. Sector diversification — force diversification when concentrated
 * 4. Trading frequency — cool down agents during losing streaks
 * 5. Risk tolerance bands — tighten risk limits during high volatility
 *
 * All adjustments are bounded — they can't override circuit breakers or
 * violate hard limits. This is optimization within safety constraints.
 */

import { clamp, round2 } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentPerformanceSnapshot {
  agentId: string;
  totalPnl: number;
  totalPnlPercent: number;
  winRate: number;
  totalTrades: number;
  currentStreak: number; // positive = wins, negative = losses
  maxDrawdownPercent: number;
  sharpeRatio: number | null;
  positionConcentration: number; // 0-1, herfindahl index
  avgConfidence: number;
  recentVolatility: number; // stdev of daily returns
  daysSinceLastTrade: number;
}

export interface StrategyAdjustment {
  agentId: string;
  adjustedAt: string;
  /** Multiplier for position size (0.25 = 25% of normal, 1.5 = 150%) */
  positionSizeMultiplier: number;
  /** Minimum confidence score required to execute a trade (0-100) */
  minConfidenceThreshold: number;
  /** Maximum allocation to any single sector/stock (0-1) */
  maxSinglePositionAllocation: number;
  /** Minimum hours between trades for this agent */
  cooldownHours: number;
  /** Maximum portfolio allocation in equities (vs. cash) */
  maxEquityAllocation: number;
  /** Reasoning for each adjustment */
  adjustmentReasons: string[];
  /** The performance metrics that triggered adjustments */
  triggerMetrics: Partial<AgentPerformanceSnapshot>;
}

export interface TuningConfig {
  /** Enable/disable the strategy tuner */
  enabled: boolean;
  /** How often to recalculate adjustments (ms) */
  recalcIntervalMs: number;
  /** Minimum trades before tuning kicks in */
  minTradesForTuning: number;
  /** Win rate below which we start reducing position sizes */
  winRateFloor: number;
  /** Max drawdown % before forcing conservative mode */
  maxDrawdownThreshold: number;
  /** Losing streak count before forced cooldown */
  losingStreakCooldownTrigger: number;
  /** Position concentration HHI threshold for diversification trigger */
  concentrationThreshold: number;
  /** Sharpe ratio below which we reduce risk */
  sharpeFloor: number;
}

// ---------------------------------------------------------------------------
// Default Configuration
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: TuningConfig = {
  enabled: true,
  recalcIntervalMs: 30 * 60 * 1000, // 30 minutes (each round)
  minTradesForTuning: 5,
  winRateFloor: 0.35,
  maxDrawdownThreshold: 15, // 15% drawdown triggers conservative mode
  losingStreakCooldownTrigger: 4,
  concentrationThreshold: 0.5, // HHI above 0.5 = too concentrated
  sharpeFloor: -0.5,
};

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Strategy Tuner Adjustment Constants
 *
 * These constants control how aggressively the strategy tuner adjusts agent
 * trading parameters based on performance. All adjustments are bounded to
 * prevent runaway risk or extreme derisking.
 */

/**
 * Confidence Floor Thresholds
 *
 * Minimum confidence scores required to execute trades under various conditions.
 */

/**
 * Default minimum confidence threshold for all agents (%).
 * Set to 40 as baseline — agents with <40% confidence should hold.
 */
const MIN_CONFIDENCE_DEFAULT = 40;

/**
 * Minimum confidence threshold during drawdown protection (%).
 * Set to 70 to require high conviction when portfolio is declining.
 */
const MIN_CONFIDENCE_DRAWDOWN_PROTECT = 70;

/**
 * Minimum confidence threshold when win rate is poor (%).
 * Set to 60 to force better trade selection when struggling.
 */
const MIN_CONFIDENCE_LOW_WIN_RATE = 60;

/**
 * Minimum confidence threshold during winning streaks (%).
 * Set to 55 to maintain caution despite mean reversion risk.
 */
const MIN_CONFIDENCE_WINNING_STREAK = 55;

/**
 * Reduced confidence threshold to encourage dormant agents (%).
 * Set to 30 to lower bar when agent hasn't traded recently.
 */
const MIN_CONFIDENCE_INACTIVITY_BOOST = 30;

/**
 * Position Sizing Multipliers
 *
 * Adjustment factors for position size based on performance conditions.
 */

/**
 * Default position size multiplier (no adjustment).
 * Set to 1.0 = 100% of normal position size.
 */
const POSITION_SIZE_DEFAULT = 1.0;

/**
 * Minimum allowed position size multiplier (floor).
 * Set to 0.25 = 25% of normal size to prevent complete shutdown.
 */
const POSITION_SIZE_MIN = 0.25;

/**
 * Maximum allowed position size multiplier (ceiling).
 * Set to 2.0 = 200% of normal size to cap risk even for winners.
 */
const POSITION_SIZE_MAX = 2.0;

/**
 * Position size reduction during losing streaks.
 * Set to 0.5 = 50% reduction to protect capital.
 */
const POSITION_SIZE_LOSING_STREAK_REDUCTION = 0.5;

/**
 * Position size boost during winning streaks.
 * Set to 1.1 = 10% increase to capture momentum (but not too aggressive).
 */
const POSITION_SIZE_WINNING_STREAK_BOOST = 1.1;

/**
 * Position size boost during excellent Sharpe ratio.
 * Set to 1.15 = 15% increase when risk-adjusted returns are strong.
 */
const POSITION_SIZE_SHARPE_BOOST = 1.15;

/**
 * Multiplier for win rate bonus calculation.
 * Applied as: bonus = (winRate - 0.6) * 1.5, capped at 0.3.
 */
const POSITION_SIZE_WIN_RATE_BONUS_MULTIPLIER = 1.5;

/**
 * Maximum position size bonus from strong win rate.
 * Set to 0.3 = 30% max bonus to prevent overconfidence.
 */
const POSITION_SIZE_MAX_WIN_RATE_BONUS = 0.3;

/**
 * Multiplier for win rate deficit calculation.
 * Applied as: reduction = deficit * 2, capped at 0.5.
 */
const POSITION_SIZE_WIN_RATE_DEFICIT_MULTIPLIER = 2.0;

/**
 * Maximum position size reduction from poor win rate.
 * Set to 0.5 = 50% max reduction to maintain some activity.
 */
const POSITION_SIZE_MAX_WIN_RATE_REDUCTION = 0.5;

/**
 * Equity Allocation Limits
 *
 * Maximum percentage of portfolio that can be invested in equities vs. cash.
 */

/**
 * Default maximum equity allocation (fraction).
 * Set to 0.8 = 80% max in equities, 20% min cash buffer.
 */
const EQUITY_ALLOCATION_DEFAULT = 0.8;

/**
 * Conservative equity allocation during drawdowns (fraction).
 * Set to 0.5 = 50% max to preserve capital during losses.
 */
const EQUITY_ALLOCATION_CONSERVATIVE = 0.5;

/**
 * Recovery equity allocation after poor Sharpe ratio (fraction).
 * Set to 0.6 = 60% max to reduce risk exposure.
 */
const EQUITY_ALLOCATION_RECOVERY = 0.6;

/**
 * Minimum equity allocation floor (safety bound, fraction).
 * Set to 0.3 = 30% min to ensure some market participation.
 */
const EQUITY_ALLOCATION_MIN = 0.3;

/**
 * Maximum equity allocation ceiling (safety bound, fraction).
 * Set to 0.9 = 90% max to always maintain cash buffer.
 */
const EQUITY_ALLOCATION_MAX = 0.9;

/**
 * Position Allocation Limits
 *
 * Maximum percentage of portfolio allocated to any single stock/position.
 */

/**
 * Default maximum allocation to single position (fraction).
 * Set to 0.25 = 25% max per stock to enforce diversification.
 */
const SINGLE_POSITION_ALLOCATION_DEFAULT = 0.25;

/**
 * Minimum single position allocation (floor, fraction).
 * Set to 0.10 = 10% min to prevent over-diversification.
 */
const SINGLE_POSITION_ALLOCATION_MIN = 0.10;

/**
 * Safety bound for single position allocation (min, fraction).
 * Set to 0.05 = 5% absolute min for safety clamp.
 */
const SINGLE_POSITION_ALLOCATION_SAFETY_MIN = 0.05;

/**
 * Safety bound for single position allocation (max, fraction).
 * Set to 0.30 = 30% absolute max for safety clamp.
 */
const SINGLE_POSITION_ALLOCATION_SAFETY_MAX = 0.30;

/**
 * Streak Thresholds
 *
 * Consecutive win/loss counts that trigger adjustments.
 */

/**
 * Winning streak length that triggers caution (count).
 * Set to 5 wins to add slight boost but raise confidence floor.
 */
const WINNING_STREAK_THRESHOLD = 5;

/**
 * Minimum trades required for strong win rate bonus.
 * Set to 10 trades to ensure statistical significance.
 */
const MIN_TRADES_FOR_WIN_RATE_BONUS = 10;

/**
 * Win rate threshold for position size bonus (fraction).
 * Set to 0.6 (60%) as cutoff for "strong performance".
 */
const WIN_RATE_STRONG_THRESHOLD = 0.6;

/**
 * Volatility Parameters
 *
 * Recent return volatility thresholds and adjustment factors.
 */

/**
 * Daily volatility threshold for position size reduction (%).
 * Set to 5% as cutoff — above this triggers vol-based sizing reduction.
 */
const VOLATILITY_HIGH_THRESHOLD = 5.0;

/**
 * Volatility reduction multiplier per % above threshold.
 * Applied as: reduction = (vol - 5) * 0.05, capped at 0.4.
 */
const VOLATILITY_REDUCTION_FACTOR = 0.05;

/**
 * Maximum position size reduction from high volatility.
 * Set to 0.4 = 40% max reduction for extreme volatility.
 */
const VOLATILITY_MAX_REDUCTION = 0.4;

/**
 * Sharpe Ratio Thresholds
 *
 * Risk-adjusted return thresholds for sizing adjustments.
 */

/**
 * Sharpe ratio threshold for expanded position sizing.
 * Set to 1.5 as cutoff for "excellent risk-adjusted returns".
 */
const SHARPE_EXCELLENT_THRESHOLD = 1.5;

/**
 * Sharpe ratio reduction multiplier below floor.
 * Applied as: reduction = abs(sharpe - floor) * 0.3, capped at 0.4.
 */
const SHARPE_REDUCTION_MULTIPLIER = 0.3;

/**
 * Maximum position size reduction from poor Sharpe ratio.
 * Set to 0.4 = 40% max reduction for very poor risk-adjusted returns.
 */
const SHARPE_MAX_REDUCTION = 0.4;

/**
 * Inactivity Parameters
 *
 * Time-based thresholds for encouraging dormant agents.
 */

/**
 * Days since last trade before inactivity boost triggers (days).
 * Set to 3 days to encourage idle agents to find opportunities.
 */
const INACTIVITY_THRESHOLD_DAYS = 3;

/**
 * P&L threshold below which inactivity boost is disabled (%).
 * Set to -5% to prevent encouraging agents with poor performance.
 */
const INACTIVITY_PNL_FLOOR = -5;

/**
 * Confidence reduction for inactivity boost (points).
 * Set to 10 points lower threshold to encourage dormant trading.
 */
const INACTIVITY_CONFIDENCE_REDUCTION = 10;

/**
 * Cooldown Parameters
 *
 * Hours multiplier for losing streak cooldown calculation.
 */

/**
 * Cooldown hours per losing streak count.
 * Applied as: hours = abs(streak) * 2, capped at 24.
 */
const COOLDOWN_HOURS_PER_STREAK = 2;

/**
 * Maximum cooldown hours (ceiling).
 * Set to 24 hours max to prevent indefinite lockout.
 */
const COOLDOWN_MAX_HOURS = 24;

/**
 * Safety Bounds for Clamps
 *
 * Absolute min/max values for all adjustment parameters.
 */

/**
 * Minimum allowed confidence threshold (safety bound, %).
 * Set to 20 to prevent agents from trading on coin flips.
 */
const CONFIDENCE_THRESHOLD_SAFETY_MIN = 20;

/**
 * Maximum allowed confidence threshold (safety bound, %).
 * Set to 90 to prevent completely blocking all trades.
 */
const CONFIDENCE_THRESHOLD_SAFETY_MAX = 90;

/**
 * Minimum allowed cooldown hours (safety bound).
 * Set to 0 = no forced cooldown by default.
 */
const COOLDOWN_HOURS_SAFETY_MIN = 0;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Current adjustments per agent */
const activeAdjustments = new Map<string, StrategyAdjustment>();

/** Historical adjustments for audit trail */
const adjustmentHistory: StrategyAdjustment[] = [];
const MAX_HISTORY = 500;

/** Current config (mutable for runtime updates) */
let config: TuningConfig = { ...DEFAULT_CONFIG };

/** Last recalc timestamp per agent */
const lastRecalcTime = new Map<string, number>();

// ---------------------------------------------------------------------------
// Core Tuning Engine
// ---------------------------------------------------------------------------

/**
 * Calculate strategy adjustments for an agent based on their performance.
 * Returns the adjustments without applying them — call applyAdjustments()
 * to make them active.
 */
export function calculateAdjustments(
  perf: AgentPerformanceSnapshot,
): StrategyAdjustment {
  const reasons: string[] = [];
  const triggers: Partial<AgentPerformanceSnapshot> = {};

  // Start with baseline (no adjustment)
  let positionSizeMultiplier = POSITION_SIZE_DEFAULT;
  let minConfidenceThreshold = MIN_CONFIDENCE_DEFAULT;
  let maxSinglePositionAllocation = SINGLE_POSITION_ALLOCATION_DEFAULT;
  let cooldownHours = COOLDOWN_HOURS_SAFETY_MIN;
  let maxEquityAllocation = EQUITY_ALLOCATION_DEFAULT;

  // Skip tuning if insufficient data
  if (perf.totalTrades < config.minTradesForTuning) {
    reasons.push(
      `Insufficient trades (${perf.totalTrades}/${config.minTradesForTuning}) — using defaults`,
    );
    return buildAdjustment(perf.agentId, {
      positionSizeMultiplier,
      minConfidenceThreshold,
      maxSinglePositionAllocation,
      cooldownHours,
      maxEquityAllocation,
      adjustmentReasons: reasons,
      triggerMetrics: triggers,
    });
  }

  // -----------------------------------------------------------------------
  // 1. Win Rate Adjustment
  // -----------------------------------------------------------------------
  if (perf.winRate < config.winRateFloor) {
    // Below floor: scale down proportionally
    const deficit = config.winRateFloor - perf.winRate;
    const reduction = Math.min(deficit * POSITION_SIZE_WIN_RATE_DEFICIT_MULTIPLIER, POSITION_SIZE_MAX_WIN_RATE_REDUCTION);
    positionSizeMultiplier *= 1 - reduction;
    minConfidenceThreshold = Math.max(minConfidenceThreshold, MIN_CONFIDENCE_LOW_WIN_RATE);
    reasons.push(
      `Win rate ${(perf.winRate * 100).toFixed(1)}% below floor ${(config.winRateFloor * 100).toFixed(0)}% — reducing position size by ${(reduction * 100).toFixed(0)}%`,
    );
    triggers.winRate = perf.winRate;
  } else if (perf.winRate > WIN_RATE_STRONG_THRESHOLD && perf.totalTrades >= MIN_TRADES_FOR_WIN_RATE_BONUS) {
    // Strong performance: allow slightly larger positions
    const bonus = Math.min((perf.winRate - WIN_RATE_STRONG_THRESHOLD) * POSITION_SIZE_WIN_RATE_BONUS_MULTIPLIER, POSITION_SIZE_MAX_WIN_RATE_BONUS);
    positionSizeMultiplier *= 1 + bonus;
    reasons.push(
      `Win rate ${(perf.winRate * 100).toFixed(1)}% above ${(WIN_RATE_STRONG_THRESHOLD * 100).toFixed(0)}% — bonus position size +${(bonus * 100).toFixed(0)}%`,
    );
    triggers.winRate = perf.winRate;
  }

  // -----------------------------------------------------------------------
  // 2. Drawdown Protection
  // -----------------------------------------------------------------------
  if (perf.maxDrawdownPercent > config.maxDrawdownThreshold) {
    const severity = perf.maxDrawdownPercent / config.maxDrawdownThreshold;
    positionSizeMultiplier *= Math.max(POSITION_SIZE_MIN, 1 / severity);
    maxEquityAllocation = Math.min(maxEquityAllocation, EQUITY_ALLOCATION_CONSERVATIVE);
    minConfidenceThreshold = Math.max(minConfidenceThreshold, MIN_CONFIDENCE_DRAWDOWN_PROTECT);
    reasons.push(
      `Max drawdown ${perf.maxDrawdownPercent.toFixed(1)}% exceeds ${config.maxDrawdownThreshold}% threshold — entering conservative mode`,
    );
    triggers.maxDrawdownPercent = perf.maxDrawdownPercent;
  }

  // -----------------------------------------------------------------------
  // 3. Losing Streak Cooldown
  // -----------------------------------------------------------------------
  if (perf.currentStreak <= -config.losingStreakCooldownTrigger) {
    cooldownHours = Math.min(
      Math.abs(perf.currentStreak) * COOLDOWN_HOURS_PER_STREAK,
      COOLDOWN_MAX_HOURS,
    );
    positionSizeMultiplier *= POSITION_SIZE_LOSING_STREAK_REDUCTION;
    reasons.push(
      `Losing streak of ${Math.abs(perf.currentStreak)} — imposing ${cooldownHours}h cooldown + ${((1 - POSITION_SIZE_LOSING_STREAK_REDUCTION) * 100).toFixed(0)}% size reduction`,
    );
    triggers.currentStreak = perf.currentStreak;
  } else if (perf.currentStreak >= WINNING_STREAK_THRESHOLD) {
    // Winning streak: slight boost but also caution (mean reversion)
    positionSizeMultiplier *= POSITION_SIZE_WINNING_STREAK_BOOST;
    minConfidenceThreshold = Math.max(minConfidenceThreshold, MIN_CONFIDENCE_WINNING_STREAK);
    reasons.push(
      `Winning streak of ${perf.currentStreak} — slight boost but raising confidence floor (mean reversion risk)`,
    );
    triggers.currentStreak = perf.currentStreak;
  }

  // -----------------------------------------------------------------------
  // 4. Concentration Diversification
  // -----------------------------------------------------------------------
  if (perf.positionConcentration > config.concentrationThreshold) {
    maxSinglePositionAllocation = Math.max(
      SINGLE_POSITION_ALLOCATION_MIN,
      maxSinglePositionAllocation * (1 - (perf.positionConcentration - config.concentrationThreshold)),
    );
    reasons.push(
      `Position HHI ${perf.positionConcentration.toFixed(2)} exceeds ${config.concentrationThreshold} — reducing max allocation to ${(maxSinglePositionAllocation * 100).toFixed(0)}%`,
    );
    triggers.positionConcentration = perf.positionConcentration;
  }

  // -----------------------------------------------------------------------
  // 5. Sharpe Ratio Risk Adjustment
  // -----------------------------------------------------------------------
  if (perf.sharpeRatio !== null && perf.sharpeRatio < config.sharpeFloor) {
    const reduction = Math.min(Math.abs(perf.sharpeRatio - config.sharpeFloor) * SHARPE_REDUCTION_MULTIPLIER, SHARPE_MAX_REDUCTION);
    positionSizeMultiplier *= 1 - reduction;
    maxEquityAllocation = Math.min(maxEquityAllocation, EQUITY_ALLOCATION_RECOVERY);
    reasons.push(
      `Sharpe ratio ${perf.sharpeRatio.toFixed(2)} below floor ${config.sharpeFloor} — reducing risk exposure`,
    );
    triggers.sharpeRatio = perf.sharpeRatio;
  } else if (perf.sharpeRatio !== null && perf.sharpeRatio > SHARPE_EXCELLENT_THRESHOLD) {
    // Excellent risk-adjusted returns: allow more
    positionSizeMultiplier *= POSITION_SIZE_SHARPE_BOOST;
    reasons.push(
      `Sharpe ratio ${perf.sharpeRatio.toFixed(2)} above ${SHARPE_EXCELLENT_THRESHOLD} — allowing expanded position sizing`,
    );
    triggers.sharpeRatio = perf.sharpeRatio;
  }

  // -----------------------------------------------------------------------
  // 6. Volatility-Based Sizing (Kelly-Lite)
  // -----------------------------------------------------------------------
  if (perf.recentVolatility > VOLATILITY_HIGH_THRESHOLD) {
    // High daily volatility: reduce position sizes
    const volReduction = Math.min((perf.recentVolatility - VOLATILITY_HIGH_THRESHOLD) * VOLATILITY_REDUCTION_FACTOR, VOLATILITY_MAX_REDUCTION);
    positionSizeMultiplier *= 1 - volReduction;
    reasons.push(
      `Recent volatility ${perf.recentVolatility.toFixed(1)}% — reducing position size by ${(volReduction * 100).toFixed(0)}%`,
    );
    triggers.recentVolatility = perf.recentVolatility;
  }

  // -----------------------------------------------------------------------
  // 7. Inactivity Boost (encourage dormant agents to trade)
  // -----------------------------------------------------------------------
  if (perf.daysSinceLastTrade > INACTIVITY_THRESHOLD_DAYS && perf.totalPnlPercent > INACTIVITY_PNL_FLOOR) {
    minConfidenceThreshold = Math.max(MIN_CONFIDENCE_INACTIVITY_BOOST, minConfidenceThreshold - INACTIVITY_CONFIDENCE_REDUCTION);
    reasons.push(
      `${perf.daysSinceLastTrade} days since last trade — lowering confidence threshold to encourage activity`,
    );
    triggers.daysSinceLastTrade = perf.daysSinceLastTrade;
  }

  // -----------------------------------------------------------------------
  // Clamp all values to safety bounds
  // -----------------------------------------------------------------------
  positionSizeMultiplier = clamp(positionSizeMultiplier, POSITION_SIZE_MIN, POSITION_SIZE_MAX);
  minConfidenceThreshold = clamp(minConfidenceThreshold, CONFIDENCE_THRESHOLD_SAFETY_MIN, CONFIDENCE_THRESHOLD_SAFETY_MAX);
  maxSinglePositionAllocation = clamp(maxSinglePositionAllocation, SINGLE_POSITION_ALLOCATION_SAFETY_MIN, SINGLE_POSITION_ALLOCATION_SAFETY_MAX);
  cooldownHours = clamp(cooldownHours, COOLDOWN_HOURS_SAFETY_MIN, COOLDOWN_MAX_HOURS);
  maxEquityAllocation = clamp(maxEquityAllocation, EQUITY_ALLOCATION_MIN, EQUITY_ALLOCATION_MAX);

  if (reasons.length === 0) {
    reasons.push("No adjustments needed — performance within normal bounds");
  }

  return buildAdjustment(perf.agentId, {
    positionSizeMultiplier,
    minConfidenceThreshold,
    maxSinglePositionAllocation,
    cooldownHours,
    maxEquityAllocation,
    adjustmentReasons: reasons,
    triggerMetrics: triggers,
  });
}

/**
 * Apply calculated adjustments — stores them as active for the agent.
 */
export function applyAdjustments(adjustment: StrategyAdjustment): void {
  activeAdjustments.set(adjustment.agentId, adjustment);

  // Record in history
  adjustmentHistory.push(adjustment);
  if (adjustmentHistory.length > MAX_HISTORY) {
    adjustmentHistory.shift();
  }

  lastRecalcTime.set(adjustment.agentId, Date.now());

  console.log(
    `[StrategyTuner] Applied adjustments for ${adjustment.agentId}: ` +
      `size=${adjustment.positionSizeMultiplier.toFixed(2)}x, ` +
      `minConf=${adjustment.minConfidenceThreshold}, ` +
      `maxPos=${(adjustment.maxSinglePositionAllocation * 100).toFixed(0)}%, ` +
      `cooldown=${adjustment.cooldownHours}h`,
  );
}

/**
 * Get the current active adjustment for an agent.
 * Returns null if no adjustment has been calculated yet.
 */
export function getActiveAdjustment(
  agentId: string,
): StrategyAdjustment | null {
  return activeAdjustments.get(agentId) ?? null;
}

/**
 * Check if an agent's decision should be modified or blocked based on
 * current strategy adjustments. This is called by the orchestrator before
 * executing a trade.
 */
export function evaluateDecision(
  agentId: string,
  decision: { action: string; confidence: number; quantity: number },
  portfolioValue: number,
): {
  allowed: boolean;
  modifiedQuantity: number;
  reason: string | null;
} {
  const adj = activeAdjustments.get(agentId);
  if (!adj || !config.enabled) {
    return { allowed: true, modifiedQuantity: decision.quantity, reason: null };
  }

  // Check confidence threshold
  if (
    decision.action !== "hold" &&
    decision.confidence < adj.minConfidenceThreshold
  ) {
    return {
      allowed: false,
      modifiedQuantity: 0,
      reason: `Confidence ${decision.confidence}% below tuned threshold ${adj.minConfidenceThreshold}%`,
    };
  }

  // Check cooldown
  if (adj.cooldownHours > 0) {
    const lastCalc = lastRecalcTime.get(agentId) ?? 0;
    const hoursSinceCalc = (Date.now() - lastCalc) / (1000 * 60 * 60);
    // Cooldown is advisory — we track it but don't hard-block
    // (circuit breaker handles hard cooldown)
  }

  // Adjust quantity based on position size multiplier
  const modifiedQuantity =
    decision.action !== "hold"
      ? round2(decision.quantity * adj.positionSizeMultiplier)
      : 0;

  // Check against max single position allocation
  const maxPositionUsd = portfolioValue * adj.maxSinglePositionAllocation;
  const finalQuantity =
    decision.action === "buy"
      ? Math.min(modifiedQuantity, maxPositionUsd)
      : modifiedQuantity;

  const wasModified = finalQuantity !== decision.quantity;

  return {
    allowed: true,
    modifiedQuantity: finalQuantity,
    reason: wasModified
      ? `Position sized from $${decision.quantity.toFixed(2)} to $${finalQuantity.toFixed(2)} (${adj.positionSizeMultiplier.toFixed(2)}x multiplier)`
      : null,
  };
}

// ---------------------------------------------------------------------------
// Configuration Management
// ---------------------------------------------------------------------------

/**
 * Update tuning configuration at runtime.
 */
export function updateConfig(partial: Partial<TuningConfig>): TuningConfig {
  config = { ...config, ...partial };
  console.log("[StrategyTuner] Config updated:", config);
  return config;
}

/**
 * Get current tuning configuration.
 */
export function getTuningConfig(): TuningConfig {
  return { ...config };
}

/**
 * Enable or disable the strategy tuner.
 */
export function setEnabled(enabled: boolean): void {
  config.enabled = enabled;
  console.log(`[StrategyTuner] ${enabled ? "ENABLED" : "DISABLED"}`);
}

// ---------------------------------------------------------------------------
// Reporting & Diagnostics
// ---------------------------------------------------------------------------

/**
 * Get a full status report for all agents' strategy adjustments.
 */
export function getStrategyTunerStatus(): {
  enabled: boolean;
  config: TuningConfig;
  activeAdjustments: { agentId: string; adjustment: StrategyAdjustment }[];
  recentHistory: StrategyAdjustment[];
  stats: {
    totalAdjustmentsCalculated: number;
    agentsWithActiveAdjustments: number;
    averagePositionMultiplier: number;
    agentsInConservativeMode: number;
    agentsWithCooldown: number;
  };
} {
  const adjustments = Array.from(activeAdjustments.entries()).map(
    ([agentId, adj]) => ({
      agentId,
      adjustment: adj,
    }),
  );

  const multipliers = adjustments.map((a) => a.adjustment.positionSizeMultiplier);
  const avgMultiplier =
    multipliers.length > 0
      ? multipliers.reduce((s, v) => s + v, 0) / multipliers.length
      : 1.0;

  return {
    enabled: config.enabled,
    config,
    activeAdjustments: adjustments,
    recentHistory: adjustmentHistory.slice(-20),
    stats: {
      totalAdjustmentsCalculated: adjustmentHistory.length,
      agentsWithActiveAdjustments: activeAdjustments.size,
      averagePositionMultiplier: round2(avgMultiplier),
      agentsInConservativeMode: adjustments.filter(
        (a) => a.adjustment.positionSizeMultiplier < 0.5,
      ).length,
      agentsWithCooldown: adjustments.filter(
        (a) => a.adjustment.cooldownHours > 0,
      ).length,
    },
  };
}

/**
 * Get adjustment history for a specific agent.
 */
export function getAgentAdjustmentHistory(
  agentId: string,
  limit = 20,
): StrategyAdjustment[] {
  return adjustmentHistory
    .filter((a) => a.agentId === agentId)
    .slice(-limit);
}

/**
 * Force recalculation of adjustments for an agent (admin use).
 */
export function forceRecalculate(
  perf: AgentPerformanceSnapshot,
): StrategyAdjustment {
  const adjustment = calculateAdjustments(perf);
  applyAdjustments(adjustment);
  return adjustment;
}

/**
 * Reset all adjustments (returns to default behavior).
 */
export function resetAllAdjustments(): void {
  activeAdjustments.clear();
  console.log("[StrategyTuner] All adjustments reset to defaults");
}

/**
 * Reset adjustments for a specific agent.
 */
export function resetAgentAdjustments(agentId: string): void {
  activeAdjustments.delete(agentId);
  lastRecalcTime.delete(agentId);
  console.log(`[StrategyTuner] Adjustments reset for ${agentId}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildAdjustment(
  agentId: string,
  params: Omit<StrategyAdjustment, "agentId" | "adjustedAt">,
): StrategyAdjustment {
  return {
    agentId,
    adjustedAt: new Date().toISOString(),
    ...params,
  };
}
