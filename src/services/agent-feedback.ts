/**
 * Agent Performance Feedback Loop
 *
 * Tracks agent trade outcomes over time and generates self-improvement
 * signals that can be injected into agent prompts. Enables agents to
 * learn from their own history without external retraining.
 *
 * Features:
 * - Outcome tracking: link decisions to actual PnL results
 * - Win/loss streak detection
 * - Per-symbol performance tracking
 * - Confidence calibration (are high-confidence trades actually better?)
 * - Pattern recognition (time-of-day, market conditions)
 * - Feedback prompt generation for agent system prompts
 * - Cross-agent comparison signals
 */

import { countByCondition, findMax, findMin, round2, round3, sumByKey, averageByKey } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Confidence bucket boundaries for calibration analysis.
 * Agents are grouped into 5 confidence ranges to measure if high-confidence
 * trades actually win more often than low-confidence trades.
 */
const CONFIDENCE_BUCKET_0_MIN = 0;
const CONFIDENCE_BUCKET_1_MIN = 20;
const CONFIDENCE_BUCKET_2_MIN = 40;
const CONFIDENCE_BUCKET_3_MIN = 60;
const CONFIDENCE_BUCKET_4_MIN = 80;

/**
 * Calibration tolerance threshold (0-1 scale).
 * If |actual win rate - expected win rate| < 0.2, the agent is considered
 * well-calibrated for that confidence bucket.
 * Example: 60-80% confidence bucket expects 70% win rate; if actual is 65-75%,
 * agent is calibrated (difference < 20 percentage points).
 */
const CALIBRATION_TOLERANCE = 0.2;

/**
 * Calibration normalization divisor for expected win rate calculation.
 * Expected win rate = (bucket min + bucket max) / 200
 * Example: 60-80% bucket → (60 + 80) / 200 = 0.70 (70% expected win rate)
 */
const CALIBRATION_NORMALIZATION_DIVISOR = 200;

/**
 * Minimum trades required in a confidence bucket to assess calibration.
 * Buckets with < 3 trades are excluded from calibration scoring to prevent
 * statistical noise from small samples.
 */
const CALIBRATION_MIN_TRADES_PER_BUCKET = 3;

/**
 * Calibration assessment thresholds (0-1 scale).
 * Determines the verbal assessment of overall calibration quality.
 */
const CALIBRATION_WELL_CALIBRATED_THRESHOLD = 0.8; // ≥80% of buckets calibrated = "Well-calibrated"
const CALIBRATION_MODERATE_THRESHOLD = 0.6; // ≥60% = "Moderately calibrated"
const CALIBRATION_POOR_THRESHOLD = 0.3; // ≥30% = "Poorly calibrated", <30% = "Not calibrated"

/**
 * Win rate thresholds for feedback generation (0-1 scale).
 * Used to provide actionable advice based on agent's win rate performance.
 */
const FEEDBACK_WIN_RATE_LOW_THRESHOLD = 0.4; // <40% = poor performance, suggest selectivity
const FEEDBACK_WIN_RATE_HIGH_THRESHOLD = 0.6; // >60% = strong performance, positive reinforcement

/**
 * Minimum resolved outcomes required for calibration feedback.
 * Prevents premature calibration warnings when agent is still building history.
 */
const FEEDBACK_MIN_RESOLVED_FOR_CALIBRATION = 10;

/**
 * Minimum outcomes required for meaningful feedback generation.
 * Below this threshold, agents get generic "build track record" message.
 * Example: Agent with 2 trades doesn't have enough history for pattern insights.
 */
const FEEDBACK_MIN_OUTCOMES = 3;

/**
 * Streak length thresholds for feedback alerts (absolute value).
 * Agents on 3+ win or loss streaks get specific advice (risk management).
 * Example: 3 consecutive wins → "maintain discipline, don't oversize"
 *          3 consecutive losses → "reduce position sizes until streak breaks"
 */
const FEEDBACK_STREAK_ALERT_THRESHOLD = 3;

/**
 * Profit factor classification thresholds.
 * Profit factor = total wins / total losses (measures risk-reward efficiency).
 *
 * BREAK_EVEN: 1.0 — Agent is losing money (every $1 won costs $1+ to lose)
 * EXCELLENT: 2.0 — Strong performance (every $1 lost generates $2+ in wins)
 *
 * Examples:
 * - Profit factor 0.8: Losing $1.25 for every $1 gained → cut losses faster
 * - Profit factor 2.5: Winning $2.50 for every $1 lost → excellent risk management
 */
const PROFIT_FACTOR_BREAK_EVEN = 1.0;
const PROFIT_FACTOR_EXCELLENT = 2.0;

/**
 * Action performance differential threshold (0-1 scale).
 * If buy vs sell win rate differs by >15 percentage points, flag as significant.
 * Example: Buy 65% win rate, Sell 45% win rate → 20 point gap → "focus on buys"
 * Used to identify if agent has directional bias (better at buying dips vs timing exits).
 */
const ACTION_PERFORMANCE_DIFFERENTIAL_THRESHOLD = 0.15;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TradeOutcome {
  outcomeId: string;
  agentId: string;
  roundId: string;
  symbol: string;
  action: "buy" | "sell" | "hold";
  quantity: number;
  confidence: number;
  /** Entry price at time of decision */
  entryPrice: number;
  /** Exit price when position was closed (null if still open) */
  exitPrice: number | null;
  /** Realized PnL in USDC (null if still open) */
  realizedPnl: number | null;
  /** Realized PnL as percentage (null if still open) */
  realizedPnlPercent: number | null;
  /** Unrealized PnL at last check */
  unrealizedPnl: number;
  /** Whether this trade was profitable */
  profitable: boolean | null;
  /** Decision timestamp */
  decidedAt: string;
  /** Resolution timestamp */
  resolvedAt: string | null;
  /** Agent's reasoning at decision time */
  reasoning: string;
}

export interface AgentPerformanceProfile {
  agentId: string;
  totalOutcomes: number;
  resolvedOutcomes: number;
  /** Win rate for resolved trades (0-1) */
  winRate: number;
  /** Average PnL per trade */
  averagePnl: number;
  /** Average PnL for winning trades */
  averageWin: number;
  /** Average PnL for losing trades */
  averageLoss: number;
  /** Profit factor: total wins / total losses */
  profitFactor: number;
  /** Current streak: positive = wins, negative = losses */
  currentStreak: number;
  /** Best streak ever */
  bestStreak: number;
  /** Worst streak ever */
  worstStreak: number;
  /** Confidence calibration data */
  confidenceCalibration: ConfidenceCalibration;
  /** Per-symbol performance */
  symbolPerformance: Record<string, SymbolPerformance>;
  /** Per-action performance */
  actionPerformance: Record<string, ActionPerformance>;
  /** Last updated */
  updatedAt: string;
}

export interface ConfidenceCalibration {
  /** Buckets: 0-20, 20-40, 40-60, 60-80, 80-100 */
  buckets: Array<{
    range: string;
    minConfidence: number;
    maxConfidence: number;
    totalTrades: number;
    wins: number;
    winRate: number;
    /** Is the agent well-calibrated in this range? */
    calibrated: boolean;
  }>;
  /** Overall calibration score (0 = terrible, 1 = perfect) */
  calibrationScore: number;
  /** Verbal assessment */
  assessment: string;
}

export interface SymbolPerformance {
  symbol: string;
  trades: number;
  wins: number;
  winRate: number;
  totalPnl: number;
  averagePnl: number;
  bestTrade: number;
  worstTrade: number;
}

export interface ActionPerformance {
  action: string;
  trades: number;
  wins: number;
  winRate: number;
  averagePnl: number;
  averageConfidence: number;
}

export interface FeedbackPrompt {
  agentId: string;
  /** The generated feedback text to inject into the system prompt */
  promptText: string;
  /** Key insights for the agent */
  insights: string[];
  /** Specific advice based on recent performance */
  advice: string[];
  /** Generated at */
  generatedAt: string;
}

export interface FeedbackMetrics {
  totalOutcomesTracked: number;
  resolvedOutcomes: number;
  pendingOutcomes: number;
  agentsTracked: number;
  feedbackPromptsGenerated: number;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const outcomesByAgent = new Map<string, TradeOutcome[]>();
const profileCache = new Map<string, AgentPerformanceProfile>();
const feedbackPromptCache = new Map<string, FeedbackPrompt>();

let feedbackPromptsGenerated = 0;
const MAX_OUTCOMES_PER_AGENT = 500;

// ---------------------------------------------------------------------------
// Outcome Tracking
// ---------------------------------------------------------------------------

/**
 * Record a new trade outcome. Called when an agent makes a trade decision.
 */
export function recordOutcome(params: {
  agentId: string;
  roundId: string;
  symbol: string;
  action: "buy" | "sell" | "hold";
  quantity: number;
  confidence: number;
  entryPrice: number;
  reasoning: string;
}): TradeOutcome {
  const outcome: TradeOutcome = {
    outcomeId: `outcome_${Date.now()}_${Math.random().toString(36).slice(ID_RANDOM_START, ID_RANDOM_START + ID_RANDOM_LENGTH_STANDARD)}`,
    agentId: params.agentId,
    roundId: params.roundId,
    symbol: params.symbol,
    action: params.action,
    quantity: params.quantity,
    confidence: params.confidence,
    entryPrice: params.entryPrice,
    exitPrice: null,
    realizedPnl: null,
    realizedPnlPercent: null,
    unrealizedPnl: 0,
    profitable: null,
    decidedAt: new Date().toISOString(),
    resolvedAt: null,
    reasoning: params.reasoning,
  };

  const agentOutcomes = outcomesByAgent.get(params.agentId) ?? [];
  agentOutcomes.push(outcome);

  if (agentOutcomes.length > MAX_OUTCOMES_PER_AGENT) {
    agentOutcomes.splice(0, agentOutcomes.length - MAX_OUTCOMES_PER_AGENT);
  }

  outcomesByAgent.set(params.agentId, agentOutcomes);

  // Invalidate profile cache
  profileCache.delete(params.agentId);
  feedbackPromptCache.delete(params.agentId);

  return outcome;
}

/**
 * Resolve an outcome with the actual exit price and PnL.
 * Called when a position is closed or at end-of-round for evaluation.
 */
export function resolveOutcome(
  agentId: string,
  outcomeId: string,
  exitPrice: number,
): TradeOutcome | null {
  const outcomes = outcomesByAgent.get(agentId);
  if (!outcomes) return null;

  const outcome = outcomes.find((o) => o.outcomeId === outcomeId);
  if (!outcome || outcome.resolvedAt) return null;

  outcome.exitPrice = exitPrice;
  outcome.resolvedAt = new Date().toISOString();

  if (outcome.action === "buy") {
    const pnl = (exitPrice - outcome.entryPrice) * outcome.quantity;
    const pnlPercent =
      outcome.entryPrice > 0
        ? ((exitPrice - outcome.entryPrice) / outcome.entryPrice) * 100
        : 0;
    outcome.realizedPnl = round2(pnl);
    outcome.realizedPnlPercent = round2(pnlPercent);
    outcome.profitable = pnl > 0;
  } else if (outcome.action === "sell") {
    // For sells, profit is entry - exit (sold at entry, price dropped = good)
    const pnl = (outcome.entryPrice - exitPrice) * outcome.quantity;
    const pnlPercent =
      outcome.entryPrice > 0
        ? ((outcome.entryPrice - exitPrice) / outcome.entryPrice) * 100
        : 0;
    outcome.realizedPnl = round2(pnl);
    outcome.realizedPnlPercent = round2(pnlPercent);
    outcome.profitable = pnl > 0;
  } else {
    // Hold — no PnL
    outcome.realizedPnl = 0;
    outcome.realizedPnlPercent = 0;
    outcome.profitable = true; // Holds are "neutral" wins
  }

  // Invalidate caches
  profileCache.delete(agentId);
  feedbackPromptCache.delete(agentId);

  return { ...outcome };
}

/**
 * Update unrealized PnL for open outcomes based on current prices.
 */
export function updateUnrealizedPnL(
  agentId: string,
  currentPrices: Record<string, number>,
): number {
  const outcomes = outcomesByAgent.get(agentId) ?? [];
  let totalUnrealized = 0;

  for (const outcome of outcomes) {
    if (outcome.resolvedAt) continue; // Already resolved

    const currentPrice = currentPrices[outcome.symbol];
    if (!currentPrice) continue;

    if (outcome.action === "buy") {
      outcome.unrealizedPnl =
        (currentPrice - outcome.entryPrice) * outcome.quantity;
    } else if (outcome.action === "sell") {
      outcome.unrealizedPnl =
        (outcome.entryPrice - currentPrice) * outcome.quantity;
    }

    totalUnrealized += outcome.unrealizedPnl;
  }

  return round2(totalUnrealized);
}

// ---------------------------------------------------------------------------
// Performance Profile
// ---------------------------------------------------------------------------

/**
 * Build a comprehensive performance profile for an agent.
 */
export function getPerformanceProfile(
  agentId: string,
): AgentPerformanceProfile {
  const cached = profileCache.get(agentId);
  if (cached) return cached;

  const outcomes = outcomesByAgent.get(agentId) ?? [];
  const resolved = outcomes.filter((o) => o.resolvedAt !== null);

  // Win/loss tracking
  const wins = resolved.filter((o) => o.profitable === true);
  const losses = resolved.filter((o) => o.profitable === false);
  const winRate = resolved.length > 0 ? wins.length / resolved.length : 0;

  // PnL calculations
  const totalWinPnl = sumByKey(wins, 'realizedPnl');
  const totalLossPnl = Math.abs(sumByKey(losses, 'realizedPnl'));
  const averagePnl = averageByKey(resolved, 'realizedPnl');
  const averageWin = wins.length > 0 ? totalWinPnl / wins.length : 0;
  const averageLoss =
    losses.length > 0 ? totalLossPnl / losses.length : 0;
  const profitFactor = totalLossPnl > 0 ? totalWinPnl / totalLossPnl : totalWinPnl > 0 ? Infinity : 0;

  // Streak calculation
  const { currentStreak, bestStreak, worstStreak } = calculateStreaks(resolved);

  // Confidence calibration
  const confidenceCalibration = calculateConfidenceCalibration(resolved);

  // Per-symbol performance
  const symbolPerformance = calculateSymbolPerformance(resolved);

  // Per-action performance
  const actionPerformance = calculateActionPerformance(resolved);

  const profile: AgentPerformanceProfile = {
    agentId,
    totalOutcomes: outcomes.length,
    resolvedOutcomes: resolved.length,
    winRate: round3(winRate),
    averagePnl: round2(averagePnl),
    averageWin: round2(averageWin),
    averageLoss: round2(averageLoss),
    profitFactor: profitFactor === Infinity ? 999 : round2(profitFactor),
    currentStreak,
    bestStreak,
    worstStreak,
    confidenceCalibration,
    symbolPerformance,
    actionPerformance,
    updatedAt: new Date().toISOString(),
  };

  profileCache.set(agentId, profile);
  return profile;
}

// ---------------------------------------------------------------------------
// Confidence Calibration
// ---------------------------------------------------------------------------

function calculateConfidenceCalibration(
  resolved: TradeOutcome[],
): ConfidenceCalibration {
  const buckets = [
    { range: "0-20", minConfidence: CONFIDENCE_BUCKET_0_MIN, maxConfidence: CONFIDENCE_BUCKET_1_MIN },
    { range: "20-40", minConfidence: CONFIDENCE_BUCKET_1_MIN, maxConfidence: CONFIDENCE_BUCKET_2_MIN },
    { range: "40-60", minConfidence: CONFIDENCE_BUCKET_2_MIN, maxConfidence: CONFIDENCE_BUCKET_3_MIN },
    { range: "60-80", minConfidence: CONFIDENCE_BUCKET_3_MIN, maxConfidence: CONFIDENCE_BUCKET_4_MIN },
    { range: "80-100", minConfidence: CONFIDENCE_BUCKET_4_MIN, maxConfidence: 100 },
  ].map((b) => {
    const trades = resolved.filter(
      (o) => o.confidence >= b.minConfidence && o.confidence < b.maxConfidence + 1,
    );
    const wins = trades.filter((o) => o.profitable === true);
    const winRate = trades.length > 0 ? wins.length / trades.length : 0;

    // A well-calibrated agent should have higher win rates at higher confidence
    const expectedWinRate = (b.minConfidence + b.maxConfidence) / CALIBRATION_NORMALIZATION_DIVISOR;
    const calibrated = Math.abs(winRate - expectedWinRate) < CALIBRATION_TOLERANCE;

    return {
      ...b,
      totalTrades: trades.length,
      wins: wins.length,
      winRate: round3(winRate),
      calibrated,
    };
  });

  // Calculate calibration score
  const calibratedBuckets = buckets.filter(
    (b) => b.totalTrades >= CALIBRATION_MIN_TRADES_PER_BUCKET && b.calibrated,
  );
  const scorableBuckets = buckets.filter((b) => b.totalTrades >= CALIBRATION_MIN_TRADES_PER_BUCKET);
  const calibrationScore =
    scorableBuckets.length > 0
      ? calibratedBuckets.length / scorableBuckets.length
      : 0;

  let assessment: string;
  if (calibrationScore >= CALIBRATION_WELL_CALIBRATED_THRESHOLD) assessment = "Well-calibrated: confidence matches outcomes";
  else if (calibrationScore >= CALIBRATION_MODERATE_THRESHOLD) assessment = "Moderately calibrated: some confidence-accuracy gaps";
  else if (calibrationScore >= CALIBRATION_POOR_THRESHOLD) assessment = "Poorly calibrated: confidence doesn't predict outcomes well";
  else assessment = "Not calibrated: confidence is essentially random";

  return { buckets, calibrationScore, assessment };
}

// ---------------------------------------------------------------------------
// Per-Symbol Performance
// ---------------------------------------------------------------------------

function calculateSymbolPerformance(
  resolved: TradeOutcome[],
): Record<string, SymbolPerformance> {
  const bySymbol = new Map<string, TradeOutcome[]>();

  for (const o of resolved) {
    if (o.action === "hold") continue;
    const list = bySymbol.get(o.symbol) ?? [];
    list.push(o);
    bySymbol.set(o.symbol, list);
  }

  const result: Record<string, SymbolPerformance> = {};

  for (const [symbol, trades] of bySymbol) {
    const wins = trades.filter((t) => t.profitable === true);
    const totalPnl = sumByKey(trades, 'realizedPnl');
    const averagePnl = averageByKey(trades, 'realizedPnl');
    const pnls = trades.map((t) => t.realizedPnl ?? 0);

    result[symbol] = {
      symbol,
      trades: trades.length,
      wins: wins.length,
      winRate: trades.length > 0 ? round3(wins.length / trades.length) : 0,
      totalPnl: round2(totalPnl),
      averagePnl: round2(averagePnl),
      bestTrade: round2(findMax(pnls.map(p => ({value: p})), 'value')?.value ?? 0),
      worstTrade: round2(findMin(pnls.map(p => ({value: p})), 'value')?.value ?? 0),
    };
  }

  return result;
}

// ---------------------------------------------------------------------------
// Per-Action Performance
// ---------------------------------------------------------------------------

function calculateActionPerformance(
  resolved: TradeOutcome[],
): Record<string, ActionPerformance> {
  const byAction = new Map<string, TradeOutcome[]>();

  for (const o of resolved) {
    const list = byAction.get(o.action) ?? [];
    list.push(o);
    byAction.set(o.action, list);
  }

  const result: Record<string, ActionPerformance> = {};

  for (const [action, trades] of byAction) {
    const wins = trades.filter((t) => t.profitable === true);
    const totalPnl = sumByKey(trades, 'realizedPnl');
    const avgConfidence = averageByKey(trades, 'confidence');

    result[action] = {
      action,
      trades: trades.length,
      wins: wins.length,
      winRate: trades.length > 0 ? round3(wins.length / trades.length) : 0,
      averagePnl: trades.length > 0 ? round2(totalPnl / trades.length) : 0,
      averageConfidence: Math.round(avgConfidence),
    };
  }

  return result;
}

// ---------------------------------------------------------------------------
// Streak Calculation
// ---------------------------------------------------------------------------

function calculateStreaks(resolved: TradeOutcome[]): {
  currentStreak: number;
  bestStreak: number;
  worstStreak: number;
} {
  if (resolved.length === 0) {
    return { currentStreak: 0, bestStreak: 0, worstStreak: 0 };
  }

  let currentStreak = 0;
  let bestStreak = 0;
  let worstStreak = 0;
  let streak = 0;

  // Sort by decision time
  const sorted = [...resolved].sort(
    (a, b) => new Date(a.decidedAt).getTime() - new Date(b.decidedAt).getTime(),
  );

  for (const outcome of sorted) {
    if (outcome.profitable === true) {
      streak = streak >= 0 ? streak + 1 : 1;
    } else if (outcome.profitable === false) {
      streak = streak <= 0 ? streak - 1 : -1;
    }

    bestStreak = Math.max(bestStreak, streak);
    worstStreak = Math.min(worstStreak, streak);
  }

  currentStreak = streak;

  return { currentStreak, bestStreak, worstStreak };
}

// ---------------------------------------------------------------------------
// Feedback Prompt Generation
// ---------------------------------------------------------------------------

/**
 * Generate a feedback prompt that can be injected into an agent's system prompt.
 * This gives the agent awareness of its own performance history.
 */
export function generateFeedbackPrompt(agentId: string): FeedbackPrompt {
  const cached = feedbackPromptCache.get(agentId);
  if (cached) return cached;

  const profile = getPerformanceProfile(agentId);
  const insights: string[] = [];
  const advice: string[] = [];

  // Only generate meaningful feedback with enough data
  if (profile.resolvedOutcomes < FEEDBACK_MIN_OUTCOMES) {
    const prompt: FeedbackPrompt = {
      agentId,
      promptText: "PERFORMANCE FEEDBACK: Not enough trade history yet. Focus on making well-reasoned decisions.",
      insights: ["New agent — building track record"],
      advice: ["Focus on high-confidence opportunities"],
      generatedAt: new Date().toISOString(),
    };
    feedbackPromptCache.set(agentId, prompt);
    feedbackPromptsGenerated++;
    return prompt;
  }

  // Win rate insight
  const winRatePct = (profile.winRate * 100).toFixed(1);
  insights.push(`Win rate: ${winRatePct}% (${profile.resolvedOutcomes} resolved trades)`);

  if (profile.winRate < FEEDBACK_WIN_RATE_LOW_THRESHOLD) {
    advice.push(`Your win rate is below ${FEEDBACK_WIN_RATE_LOW_THRESHOLD * 100}%. Consider being more selective — only trade with high conviction.`);
  } else if (profile.winRate > FEEDBACK_WIN_RATE_HIGH_THRESHOLD) {
    insights.push("Strong win rate! Your analysis has been accurate.");
  }

  // PnL insight
  if (profile.averagePnl > 0) {
    insights.push(`Average PnL per trade: +$${profile.averagePnl.toFixed(2)}`);
  } else {
    insights.push(`Average PnL per trade: -$${Math.abs(profile.averagePnl).toFixed(2)}`);
    advice.push("Average PnL is negative. Consider tighter stop-losses or smaller position sizes.");
  }

  // Profit factor
  if (profile.profitFactor < PROFIT_FACTOR_BREAK_EVEN) {
    advice.push(`Profit factor is ${profile.profitFactor.toFixed(2)} (below ${PROFIT_FACTOR_BREAK_EVEN} = losing money). Cut losses faster.`);
  } else if (profile.profitFactor > PROFIT_FACTOR_EXCELLENT) {
    insights.push(`Strong profit factor: ${profile.profitFactor.toFixed(2)} (>${PROFIT_FACTOR_EXCELLENT} is excellent)`);
  }

  // Streak insight
  if (profile.currentStreak >= FEEDBACK_STREAK_ALERT_THRESHOLD) {
    insights.push(`Currently on a ${profile.currentStreak}-trade winning streak`);
    advice.push("Hot streak — maintain discipline, don't let overconfidence lead to oversized bets.");
  } else if (profile.currentStreak <= -FEEDBACK_STREAK_ALERT_THRESHOLD) {
    insights.push(`Currently on a ${Math.abs(profile.currentStreak)}-trade losing streak`);
    advice.push("Losing streak — consider reducing position sizes until streak breaks.");
  }

  // Confidence calibration
  const cal = profile.confidenceCalibration;
  if (cal.calibrationScore < FEEDBACK_WIN_RATE_LOW_THRESHOLD && profile.resolvedOutcomes >= FEEDBACK_MIN_RESOLVED_FOR_CALIBRATION) {
    advice.push("Your confidence levels don't correlate with outcomes. Recalibrate — high confidence should mean higher win probability.");
  }

  // Find best and worst symbols
  const symbolEntries = Object.values(profile.symbolPerformance);
  if (symbolEntries.length > 0) {
    const sorted = [...symbolEntries].sort((a, b) => b.totalPnl - a.totalPnl);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];

    if (best.totalPnl > 0) {
      insights.push(`Best symbol: ${best.symbol} ($${best.totalPnl.toFixed(2)} total PnL, ${(best.winRate * 100).toFixed(0)}% win rate)`);
    }
    if (worst.totalPnl < 0) {
      advice.push(`Worst symbol: ${worst.symbol} ($${worst.totalPnl.toFixed(2)} total PnL). Consider avoiding or reversing your strategy on this stock.`);
    }
  }

  // Action performance
  const buyPerf = profile.actionPerformance["buy"];
  const sellPerf = profile.actionPerformance["sell"];

  if (buyPerf && sellPerf) {
    if (buyPerf.winRate > sellPerf.winRate + ACTION_PERFORMANCE_DIFFERENTIAL_THRESHOLD) {
      insights.push(`Buy trades are significantly better than sell trades (${(buyPerf.winRate * 100).toFixed(0)}% vs ${(sellPerf.winRate * 100).toFixed(0)}%)`);
      advice.push("You're better at buying dips than timing sells. Focus on buy opportunities.");
    } else if (sellPerf.winRate > buyPerf.winRate + ACTION_PERFORMANCE_DIFFERENTIAL_THRESHOLD) {
      insights.push(`Sell trades outperform buys (${(sellPerf.winRate * 100).toFixed(0)}% vs ${(buyPerf.winRate * 100).toFixed(0)}%)`);
      advice.push("You're good at taking profits. Don't be afraid to lock in gains.");
    }
  }

  // Build prompt text
  const promptLines = [
    "YOUR PERFORMANCE HISTORY (use this to improve your decisions):",
    "",
    ...insights.map((i) => `- ${i}`),
  ];

  if (advice.length > 0) {
    promptLines.push("", "AREAS FOR IMPROVEMENT:");
    promptLines.push(...advice.map((a) => `- ${a}`));
  }

  const promptText = promptLines.join("\n");

  const feedbackPrompt: FeedbackPrompt = {
    agentId,
    promptText,
    insights,
    advice,
    generatedAt: new Date().toISOString(),
  };

  feedbackPromptCache.set(agentId, feedbackPrompt);
  feedbackPromptsGenerated++;

  return feedbackPrompt;
}

// ---------------------------------------------------------------------------
// Cross-Agent Comparison
// ---------------------------------------------------------------------------

/**
 * Generate a comparison signal between agents.
 * Can be used to show agents where they rank relative to competitors.
 */
export function generateCrossAgentComparison(
  agentIds: string[],
): Array<{
  agentId: string;
  rank: number;
  winRate: number;
  totalPnl: number;
  profitFactor: number;
  comparisonNote: string;
}> {
  const profiles = agentIds.map((id) => ({
    id,
    profile: getPerformanceProfile(id),
  }));

  // Sort by total PnL
  const sorted = [...profiles].sort(
    (a, b) =>
      (b.profile.averagePnl * b.profile.resolvedOutcomes) -
      (a.profile.averagePnl * a.profile.resolvedOutcomes),
  );

  return sorted.map((entry, index) => {
    const p = entry.profile;
    const totalPnl = round2(p.averagePnl * p.resolvedOutcomes);

    let comparisonNote: string;
    if (index === 0) {
      comparisonNote = "Leading the competition! Maintain your edge.";
    } else {
      const leader = sorted[0].profile;
      const leaderPnl = leader.averagePnl * leader.resolvedOutcomes;
      const gap = leaderPnl - totalPnl;
      comparisonNote = `$${gap.toFixed(2)} behind the leader. ${p.winRate < leader.winRate ? "Improve trade selection." : "Increase position conviction."}`;
    }

    return {
      agentId: entry.id,
      rank: index + 1,
      winRate: p.winRate,
      totalPnl,
      profitFactor: p.profitFactor,
      comparisonNote,
    };
  });
}

// ---------------------------------------------------------------------------
// Data Access
// ---------------------------------------------------------------------------

/**
 * Get recent outcomes for an agent.
 */
export function getRecentOutcomes(
  agentId: string,
  limit = 20,
): TradeOutcome[] {
  const outcomes = outcomesByAgent.get(agentId) ?? [];
  return outcomes.slice(-limit).reverse();
}

/**
 * Get pending (unresolved) outcomes for an agent.
 */
export function getPendingOutcomes(agentId: string): TradeOutcome[] {
  const outcomes = outcomesByAgent.get(agentId) ?? [];
  return outcomes.filter((o) => o.resolvedAt === null);
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/**
 * Get feedback system metrics.
 */
export function getFeedbackMetrics(): FeedbackMetrics {
  let totalOutcomes = 0;
  let resolvedOutcomes = 0;
  let pendingOutcomes = 0;

  for (const [, outcomes] of outcomesByAgent) {
    totalOutcomes += outcomes.length;
    resolvedOutcomes += countByCondition(outcomes, (o) => o.resolvedAt !== null);
    pendingOutcomes += countByCondition(outcomes, (o) => o.resolvedAt === null);
  }

  return {
    totalOutcomesTracked: totalOutcomes,
    resolvedOutcomes,
    pendingOutcomes,
    agentsTracked: outcomesByAgent.size,
    feedbackPromptsGenerated,
  };
}

/**
 * Reset all feedback data (admin use).
 */
export function resetFeedbackData(): void {
  outcomesByAgent.clear();
  profileCache.clear();
  feedbackPromptCache.clear();
  feedbackPromptsGenerated = 0;
}
