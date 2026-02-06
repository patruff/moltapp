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
  let positionSizeMultiplier = 1.0;
  let minConfidenceThreshold = 40; // default minimum
  let maxSinglePositionAllocation = 0.25; // 25% max per stock
  let cooldownHours = 0; // no extra cooldown
  let maxEquityAllocation = 0.8; // 80% max in equities

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
    const reduction = Math.min(deficit * 2, 0.5); // max 50% reduction
    positionSizeMultiplier *= 1 - reduction;
    minConfidenceThreshold = Math.max(minConfidenceThreshold, 60);
    reasons.push(
      `Win rate ${(perf.winRate * 100).toFixed(1)}% below floor ${(config.winRateFloor * 100).toFixed(0)}% — reducing position size by ${(reduction * 100).toFixed(0)}%`,
    );
    triggers.winRate = perf.winRate;
  } else if (perf.winRate > 0.6 && perf.totalTrades >= 10) {
    // Strong performance: allow slightly larger positions
    const bonus = Math.min((perf.winRate - 0.6) * 1.5, 0.3); // max 30% bonus
    positionSizeMultiplier *= 1 + bonus;
    reasons.push(
      `Win rate ${(perf.winRate * 100).toFixed(1)}% above 60% — bonus position size +${(bonus * 100).toFixed(0)}%`,
    );
    triggers.winRate = perf.winRate;
  }

  // -----------------------------------------------------------------------
  // 2. Drawdown Protection
  // -----------------------------------------------------------------------
  if (perf.maxDrawdownPercent > config.maxDrawdownThreshold) {
    const severity = perf.maxDrawdownPercent / config.maxDrawdownThreshold;
    positionSizeMultiplier *= Math.max(0.25, 1 / severity);
    maxEquityAllocation = Math.min(maxEquityAllocation, 0.5);
    minConfidenceThreshold = Math.max(minConfidenceThreshold, 70);
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
      Math.abs(perf.currentStreak) * 2,
      24, // max 24 hour cooldown
    );
    positionSizeMultiplier *= 0.5;
    reasons.push(
      `Losing streak of ${Math.abs(perf.currentStreak)} — imposing ${cooldownHours}h cooldown + 50% size reduction`,
    );
    triggers.currentStreak = perf.currentStreak;
  } else if (perf.currentStreak >= 5) {
    // Winning streak: slight boost but also caution (mean reversion)
    positionSizeMultiplier *= 1.1;
    minConfidenceThreshold = Math.max(minConfidenceThreshold, 55);
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
      0.10,
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
    const reduction = Math.min(Math.abs(perf.sharpeRatio - config.sharpeFloor) * 0.3, 0.4);
    positionSizeMultiplier *= 1 - reduction;
    maxEquityAllocation = Math.min(maxEquityAllocation, 0.6);
    reasons.push(
      `Sharpe ratio ${perf.sharpeRatio.toFixed(2)} below floor ${config.sharpeFloor} — reducing risk exposure`,
    );
    triggers.sharpeRatio = perf.sharpeRatio;
  } else if (perf.sharpeRatio !== null && perf.sharpeRatio > 1.5) {
    // Excellent risk-adjusted returns: allow more
    positionSizeMultiplier *= 1.15;
    reasons.push(
      `Sharpe ratio ${perf.sharpeRatio.toFixed(2)} above 1.5 — allowing expanded position sizing`,
    );
    triggers.sharpeRatio = perf.sharpeRatio;
  }

  // -----------------------------------------------------------------------
  // 6. Volatility-Based Sizing (Kelly-Lite)
  // -----------------------------------------------------------------------
  if (perf.recentVolatility > 5) {
    // High daily volatility: reduce position sizes
    const volReduction = Math.min((perf.recentVolatility - 5) * 0.05, 0.4);
    positionSizeMultiplier *= 1 - volReduction;
    reasons.push(
      `Recent volatility ${perf.recentVolatility.toFixed(1)}% — reducing position size by ${(volReduction * 100).toFixed(0)}%`,
    );
    triggers.recentVolatility = perf.recentVolatility;
  }

  // -----------------------------------------------------------------------
  // 7. Inactivity Boost (encourage dormant agents to trade)
  // -----------------------------------------------------------------------
  if (perf.daysSinceLastTrade > 3 && perf.totalPnlPercent > -5) {
    minConfidenceThreshold = Math.max(30, minConfidenceThreshold - 10);
    reasons.push(
      `${perf.daysSinceLastTrade} days since last trade — lowering confidence threshold to encourage activity`,
    );
    triggers.daysSinceLastTrade = perf.daysSinceLastTrade;
  }

  // -----------------------------------------------------------------------
  // Clamp all values to safety bounds
  // -----------------------------------------------------------------------
  positionSizeMultiplier = clamp(positionSizeMultiplier, 0.25, 2.0);
  minConfidenceThreshold = clamp(minConfidenceThreshold, 20, 90);
  maxSinglePositionAllocation = clamp(maxSinglePositionAllocation, 0.05, 0.30);
  cooldownHours = clamp(cooldownHours, 0, 24);
  maxEquityAllocation = clamp(maxEquityAllocation, 0.3, 0.9);

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
