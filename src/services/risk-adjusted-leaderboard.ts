/**
 * Risk-Adjusted Leaderboard
 *
 * Ranks agents by risk-adjusted returns rather than raw P&L percentage.
 * Uses multiple metrics to provide a comprehensive ranking:
 *
 * Primary ranking: Composite Score (weighted blend)
 * - 35% Sharpe Ratio (risk-adjusted return)
 * - 25% Total Return %
 * - 20% Sortino Ratio (downside risk)
 * - 10% Win Rate
 * - 10% Max Drawdown (penalizes large drawdowns)
 *
 * This is the "smart" leaderboard that evaluates quality of returns,
 * not just quantity. An agent that returns 15% with 5% drawdown
 * ranks higher than one returning 25% with 40% drawdown.
 */

import { round2, sumByKey, averageByKey, computeVariance, computeDownsideVariance } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RiskMetrics {
  /** Annualized Sharpe Ratio (excess return / volatility) */
  sharpeRatio: number;
  /** Sortino Ratio (excess return / downside deviation) */
  sortinoRatio: number;
  /** Maximum drawdown as percentage (0-100) */
  maxDrawdownPercent: number;
  /** Annualized volatility as percentage */
  volatilityPercent: number;
  /** Downside deviation (only negative returns) */
  downsideDeviation: number;
  /** Calmar Ratio (annualized return / max drawdown) */
  calmarRatio: number;
  /** Win rate as percentage (0-100) */
  winRate: number;
  /** Profit factor (gross profit / gross loss) */
  profitFactor: number;
  /** Average win / average loss ratio */
  payoffRatio: number;
  /** Number of trading days with data */
  tradingDays: number;
}

export interface RiskAdjustedEntry {
  rank: number;
  agentId: string;
  agentName: string;
  compositeScore: number;
  totalReturnPercent: number;
  riskMetrics: RiskMetrics;
  scoreBreakdown: {
    sharpeComponent: number;
    returnComponent: number;
    sortinoComponent: number;
    winRateComponent: number;
    drawdownPenalty: number;
  };
  /** Tier based on composite score: S/A/B/C/D */
  tier: "S" | "A" | "B" | "C" | "D";
  /** Number of trades analyzed */
  tradeCount: number;
  /** Total portfolio value */
  portfolioValue: number;
}

export interface RiskAdjustedLeaderboard {
  entries: RiskAdjustedEntry[];
  methodology: string;
  computedAt: string;
  benchmarkReturn: number;
  riskFreeRate: number;
  aggregateStats: {
    avgSharpe: number;
    avgReturn: number;
    avgDrawdown: number;
    bestSharpe: { agentId: string; value: number } | null;
    worstDrawdown: { agentId: string; value: number } | null;
  };
}

export interface AgentReturnSeries {
  agentId: string;
  agentName: string;
  dailyReturns: DailyReturn[];
  trades: TradeRecord[];
}

interface DailyReturn {
  date: string;
  returnPercent: number;
  cumulativeReturn: number;
  portfolioValue: number;
}

interface TradeRecord {
  timestamp: string;
  action: "buy" | "sell";
  symbol: string;
  pnlPercent: number;
  pnlAbsolute: number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Annualized risk-free rate (US Treasury ~4.5%) */
const RISK_FREE_RATE = 0.045;

/** Trading days per year for annualization */
const TRADING_DAYS_PER_YEAR = 252;

/**
 * Maximum number of daily return data points to retain per agent.
 * 365 days = 1 year of trading history for rolling Sharpe/Sortino calculations.
 * Older entries are evicted when this limit is exceeded.
 */
const MAX_DAILY_RETURNS_HISTORY = 365;

/**
 * Maximum number of trade records to retain per agent.
 * 500 trades provides sufficient history for win rate, profit factor,
 * and payoff ratio calculations without excessive memory usage.
 */
const MAX_TRADES_HISTORY = 500;

/** Scoring weights */
const WEIGHTS = {
  sharpe: 0.35,
  totalReturn: 0.25,
  sortino: 0.20,
  winRate: 0.10,
  maxDrawdown: 0.10,
};

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ---------------------------------------------------------------------------
// Metric Normalization Bounds
// ---------------------------------------------------------------------------

/**
 * Sharpe Ratio normalization bounds.
 * Maps raw Sharpe to 0-100 scale for composite score.
 * -1 = consistently losing money after risk adjustment (floor)
 *  3 = exceptional risk-adjusted performance (ceiling, >3 is capped at 100)
 * Example: Sharpe of 1.0 (solid) maps to 50/100; Sharpe of 2.0 maps to 75/100.
 */
const SHARPE_NORMALIZE_MIN = -1;
const SHARPE_NORMALIZE_MAX = 3;

/**
 * Total Return % normalization bounds.
 * Maps raw total return percentage to 0-100 scale.
 * -20% = significant loss scenario (floor)
 * +50% = exceptional return scenario (ceiling, above is capped)
 * Example: +15% return maps to 50/100; +35% maps to 78/100.
 */
const RETURN_NORMALIZE_MIN = -20;
const RETURN_NORMALIZE_MAX = 50;

/**
 * Sortino Ratio normalization bounds.
 * Similar to Sharpe but uses downside deviation only.
 * -1 = high downside risk relative to return (floor)
 *  4 = very low downside risk relative to return (ceiling)
 * Example: Sortino of 1.5 maps to 50/100; Sortino of 3.0 maps to 80/100.
 */
const SORTINO_NORMALIZE_MIN = -1;
const SORTINO_NORMALIZE_MAX = 4;

/**
 * Win Rate % normalization bounds.
 * Maps win rate percentage to 0-100 scale.
 * 30% = poor win rate (floor — below this is capped at 0)
 * 80% = excellent win rate (ceiling — above this is capped at 100)
 * Example: 55% win rate maps to 50/100; 67.5% win rate maps to 75/100.
 */
const WIN_RATE_NORMALIZE_MIN = 30;
const WIN_RATE_NORMALIZE_MAX = 80;

/**
 * Max Drawdown % normalization bounds (inverted — lower drawdown = better score).
 * 0% = no drawdown at all (best possible, maps to 100/100)
 * 30% = severe drawdown (floor for normalization, maps to 0/100)
 * Example: 15% drawdown maps to 50/100 drawdown score; 0% drawdown = 100/100.
 */
const DRAWDOWN_NORMALIZE_MIN = 0;
const DRAWDOWN_NORMALIZE_MAX = 30;

// ---------------------------------------------------------------------------
// Tier Classification Thresholds
// ---------------------------------------------------------------------------

/**
 * Composite score thresholds for S/A/B/C/D tier classification.
 * Composite score is a weighted blend of Sharpe (35%), return (25%),
 * Sortino (20%), win rate (10%), and drawdown penalty (10%).
 *
 * Tier S: score ≥ 80 — exceptional risk-adjusted performance
 * Tier A: score ≥ 60 — strong risk-adjusted performance
 * Tier B: score ≥ 40 — adequate risk-adjusted performance
 * Tier C: score ≥ 20 — below-average risk-adjusted performance
 * Tier D: score  < 20 — poor risk-adjusted performance
 */
const TIER_S_THRESHOLD = 80;
const TIER_A_THRESHOLD = 60;
const TIER_B_THRESHOLD = 40;
const TIER_C_THRESHOLD = 20;

// ---------------------------------------------------------------------------
// Display Limits
// ---------------------------------------------------------------------------

/**
 * Number of most recent trades to include in agent detail API responses.
 * 50 trades provides enough history for pattern recognition without excessive payload.
 * Uses negative slice index: series.trades.slice(-RECENT_TRADES_DISPLAY_LIMIT)
 */
const RECENT_TRADES_DISPLAY_LIMIT = 50;
let cachedLeaderboard: RiskAdjustedLeaderboard | null = null;
let lastComputedAt = 0;

// ---------------------------------------------------------------------------
// In-Memory Agent Data (populated by orchestrator/performance tracker)
// ---------------------------------------------------------------------------

const agentReturnData = new Map<string, AgentReturnSeries>();

/**
 * Record a daily return for an agent.
 * Called by the orchestrator after each trading round.
 */
export function recordAgentReturn(
  agentId: string,
  agentName: string,
  dailyReturn: {
    date: string;
    returnPercent: number;
    portfolioValue: number;
  },
): void {
  let series = agentReturnData.get(agentId);
  if (!series) {
    series = { agentId, agentName, dailyReturns: [], trades: [] };
    agentReturnData.set(agentId, series);
  }

  // Avoid duplicate entries for same date
  const existing = series.dailyReturns.find(
    (r) => r.date === dailyReturn.date,
  );
  if (existing) {
    existing.returnPercent = dailyReturn.returnPercent;
    existing.portfolioValue = dailyReturn.portfolioValue;
    return;
  }

  const prevCumulative =
    series.dailyReturns.length > 0
      ? series.dailyReturns[series.dailyReturns.length - 1].cumulativeReturn
      : 0;

  series.dailyReturns.push({
    date: dailyReturn.date,
    returnPercent: dailyReturn.returnPercent,
    cumulativeReturn: prevCumulative + dailyReturn.returnPercent,
    portfolioValue: dailyReturn.portfolioValue,
  });

  // Keep last MAX_DAILY_RETURNS_HISTORY days
  if (series.dailyReturns.length > MAX_DAILY_RETURNS_HISTORY) {
    series.dailyReturns = series.dailyReturns.slice(-MAX_DAILY_RETURNS_HISTORY);
  }
}

/**
 * Record a trade outcome for win/loss tracking.
 */
export function recordTradeOutcome(
  agentId: string,
  agentName: string,
  trade: TradeRecord,
): void {
  let series = agentReturnData.get(agentId);
  if (!series) {
    series = { agentId, agentName, dailyReturns: [], trades: [] };
    agentReturnData.set(agentId, series);
  }

  series.trades.push(trade);

  // Keep last MAX_TRADES_HISTORY trades
  if (series.trades.length > MAX_TRADES_HISTORY) {
    series.trades = series.trades.slice(-MAX_TRADES_HISTORY);
  }
}

// ---------------------------------------------------------------------------
// Core: Compute Risk-Adjusted Leaderboard
// ---------------------------------------------------------------------------

/**
 * Get the risk-adjusted leaderboard.
 * Returns cached data if still fresh.
 */
export function getRiskAdjustedLeaderboard(): RiskAdjustedLeaderboard {
  const now = Date.now();

  if (cachedLeaderboard && now - lastComputedAt < CACHE_TTL_MS) {
    return cachedLeaderboard;
  }

  cachedLeaderboard = computeLeaderboard();
  lastComputedAt = now;
  return cachedLeaderboard;
}

/**
 * Force refresh the leaderboard (bypass cache).
 */
export function refreshRiskAdjustedLeaderboard(): RiskAdjustedLeaderboard {
  cachedLeaderboard = computeLeaderboard();
  lastComputedAt = Date.now();
  return cachedLeaderboard;
}

function computeLeaderboard(): RiskAdjustedLeaderboard {
  const entries: RiskAdjustedEntry[] = [];

  // Compute benchmark return (SPY buy-and-hold)
  const benchmarkReturn = computeBenchmarkReturn();

  for (const [agentId, series] of agentReturnData) {
    if (series.dailyReturns.length < 2) {
      // Need at least 2 data points for risk metrics
      entries.push(createMinimalEntry(agentId, series.agentName, series));
      continue;
    }

    const riskMetrics = calculateRiskMetrics(series.dailyReturns, series.trades);
    const totalReturnPercent =
      series.dailyReturns.length > 0
        ? series.dailyReturns[series.dailyReturns.length - 1].cumulativeReturn
        : 0;

    const portfolioValue =
      series.dailyReturns.length > 0
        ? series.dailyReturns[series.dailyReturns.length - 1].portfolioValue
        : 10000;

    // Calculate composite score
    const breakdown = calculateScoreBreakdown(riskMetrics, totalReturnPercent);
    const compositeScore =
      breakdown.sharpeComponent +
      breakdown.returnComponent +
      breakdown.sortinoComponent +
      breakdown.winRateComponent -
      breakdown.drawdownPenalty;

    entries.push({
      rank: 0, // assigned after sorting
      agentId,
      agentName: series.agentName,
      compositeScore: round2(compositeScore),
      totalReturnPercent: round2(totalReturnPercent),
      riskMetrics,
      scoreBreakdown: breakdown,
      tier: assignTier(compositeScore),
      tradeCount: series.trades.length,
      portfolioValue: round2(portfolioValue),
    });
  }

  // Sort by composite score descending
  entries.sort((a, b) => b.compositeScore - a.compositeScore);

  // Assign ranks
  for (let i = 0; i < entries.length; i++) {
    entries[i].rank = i + 1;
  }

  // Aggregate stats
  const aggregateStats = computeAggregateStats(entries);

  return {
    entries,
    methodology:
      `Composite Score = ${WEIGHTS.sharpe * 100}% Sharpe + ${WEIGHTS.totalReturn * 100}% Return ` +
      `+ ${WEIGHTS.sortino * 100}% Sortino + ${WEIGHTS.winRate * 100}% Win Rate ` +
      `- ${WEIGHTS.maxDrawdown * 100}% Max Drawdown Penalty. ` +
      `Risk-free rate: ${(RISK_FREE_RATE * 100).toFixed(1)}%. Annualized over ${TRADING_DAYS_PER_YEAR} trading days.`,
    computedAt: new Date().toISOString(),
    benchmarkReturn: round2(benchmarkReturn),
    riskFreeRate: RISK_FREE_RATE,
    aggregateStats,
  };
}

// ---------------------------------------------------------------------------
// Risk Metric Calculations
// ---------------------------------------------------------------------------

function calculateRiskMetrics(
  dailyReturns: DailyReturn[],
  trades: TradeRecord[],
): RiskMetrics {
  const returns = dailyReturns.map((r) => r.returnPercent / 100); // Convert to decimal

  // Basic stats
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = computeVariance(returns);
  const stdDev = Math.sqrt(variance);

  // Downside deviation (only negative returns)
  const downsideVariance = computeDownsideVariance(returns, true); // usePopulation=true matches original logic
  const downsideDeviation = Math.sqrt(downsideVariance);

  // Annualize
  const annualizedReturn = mean * TRADING_DAYS_PER_YEAR;
  const annualizedVolatility = stdDev * Math.sqrt(TRADING_DAYS_PER_YEAR);
  const annualizedDownside =
    downsideDeviation * Math.sqrt(TRADING_DAYS_PER_YEAR);

  // Sharpe Ratio
  const sharpeRatio =
    annualizedVolatility > 0
      ? (annualizedReturn - RISK_FREE_RATE) / annualizedVolatility
      : 0;

  // Sortino Ratio
  const sortinoRatio =
    annualizedDownside > 0
      ? (annualizedReturn - RISK_FREE_RATE) / annualizedDownside
      : 0;

  // Max Drawdown
  const maxDrawdownPercent = calculateMaxDrawdown(dailyReturns);

  // Calmar Ratio
  const calmarRatio =
    maxDrawdownPercent > 0 ? annualizedReturn / (maxDrawdownPercent / 100) : 0;

  // Win/Loss stats from trades
  const wins = trades.filter((t) => t.pnlPercent > 0);
  const losses = trades.filter((t) => t.pnlPercent <= 0);
  const winRate =
    trades.length > 0 ? (wins.length / trades.length) * 100 : 50;

  const grossProfit = sumByKey(wins, "pnlAbsolute");
  const grossLoss = Math.abs(sumByKey(losses, "pnlAbsolute"));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  const avgWin = averageByKey(wins, "pnlAbsolute");
  const avgLoss = Math.abs(averageByKey(losses, "pnlAbsolute"));
  const payoffRatio = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0;

  return {
    sharpeRatio: clampRatio(sharpeRatio),
    sortinoRatio: clampRatio(sortinoRatio),
    maxDrawdownPercent: round2(maxDrawdownPercent),
    volatilityPercent:
      round2(annualizedVolatility * 100),
    downsideDeviation: round2(annualizedDownside * 100),
    calmarRatio: clampRatio(calmarRatio),
    winRate: round2(winRate),
    profitFactor: clampRatio(profitFactor),
    payoffRatio: clampRatio(payoffRatio),
    tradingDays: dailyReturns.length,
  };
}

function calculateMaxDrawdown(dailyReturns: DailyReturn[]): number {
  if (dailyReturns.length === 0) return 0;

  let peak = dailyReturns[0].portfolioValue;
  let maxDrawdown = 0;

  for (const day of dailyReturns) {
    if (day.portfolioValue > peak) {
      peak = day.portfolioValue;
    }
    const drawdown = ((peak - day.portfolioValue) / peak) * 100;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  return maxDrawdown;
}

function clampRatio(value: number): number {
  if (!isFinite(value)) return 0;
  return round2(Math.max(-10, Math.min(10, value)));
}

// ---------------------------------------------------------------------------
// Score Breakdown
// ---------------------------------------------------------------------------

function calculateScoreBreakdown(
  metrics: RiskMetrics,
  totalReturnPercent: number,
): RiskAdjustedEntry["scoreBreakdown"] {
  // Normalize each metric to 0-100 scale, then weight
  const normalizedSharpe = normalizeMetric(metrics.sharpeRatio, SHARPE_NORMALIZE_MIN, SHARPE_NORMALIZE_MAX, false);
  const normalizedReturn = normalizeMetric(totalReturnPercent, RETURN_NORMALIZE_MIN, RETURN_NORMALIZE_MAX, false);
  const normalizedSortino = normalizeMetric(metrics.sortinoRatio, SORTINO_NORMALIZE_MIN, SORTINO_NORMALIZE_MAX, false);
  const normalizedWinRate = normalizeMetric(metrics.winRate, WIN_RATE_NORMALIZE_MIN, WIN_RATE_NORMALIZE_MAX, false);
  const normalizedDrawdown = normalizeMetric(
    metrics.maxDrawdownPercent,
    DRAWDOWN_NORMALIZE_MIN,
    DRAWDOWN_NORMALIZE_MAX,
    true,
  );

  return {
    sharpeComponent:
      round2(normalizedSharpe * WEIGHTS.sharpe),
    returnComponent:
      round2(normalizedReturn * WEIGHTS.totalReturn),
    sortinoComponent:
      round2(normalizedSortino * WEIGHTS.sortino),
    winRateComponent:
      round2(normalizedWinRate * WEIGHTS.winRate),
    drawdownPenalty:
      round2(normalizedDrawdown * WEIGHTS.maxDrawdown),
  };
}

/**
 * Normalize a metric to 0-100 scale.
 * @param value The raw metric value
 * @param min Expected minimum (maps to 0)
 * @param max Expected maximum (maps to 100)
 * @param invert If true, higher values are worse (e.g., drawdown)
 */
function normalizeMetric(
  value: number,
  min: number,
  max: number,
  invert: boolean,
): number {
  const clamped = Math.max(min, Math.min(max, value));
  let normalized = ((clamped - min) / (max - min)) * 100;
  if (invert) {
    normalized = 100 - normalized;
  }
  return Math.max(0, Math.min(100, normalized));
}

function assignTier(
  compositeScore: number,
): "S" | "A" | "B" | "C" | "D" {
  if (compositeScore >= TIER_S_THRESHOLD) return "S";
  if (compositeScore >= TIER_A_THRESHOLD) return "A";
  if (compositeScore >= TIER_B_THRESHOLD) return "B";
  if (compositeScore >= TIER_C_THRESHOLD) return "C";
  return "D";
}

// ---------------------------------------------------------------------------
// Minimal Entry (insufficient data)
// ---------------------------------------------------------------------------

function createMinimalEntry(
  agentId: string,
  agentName: string,
  series: AgentReturnSeries,
): RiskAdjustedEntry {
  const portfolioValue =
    series.dailyReturns.length > 0
      ? series.dailyReturns[series.dailyReturns.length - 1].portfolioValue
      : 10000;

  return {
    rank: 0,
    agentId,
    agentName,
    compositeScore: 0,
    totalReturnPercent: 0,
    riskMetrics: {
      sharpeRatio: 0,
      sortinoRatio: 0,
      maxDrawdownPercent: 0,
      volatilityPercent: 0,
      downsideDeviation: 0,
      calmarRatio: 0,
      winRate: 50,
      profitFactor: 0,
      payoffRatio: 0,
      tradingDays: series.dailyReturns.length,
    },
    scoreBreakdown: {
      sharpeComponent: 0,
      returnComponent: 0,
      sortinoComponent: 0,
      winRateComponent: 0,
      drawdownPenalty: 0,
    },
    tier: "D",
    tradeCount: series.trades.length,
    portfolioValue,
  };
}

// ---------------------------------------------------------------------------
// Benchmark Return (SPY buy-and-hold)
// ---------------------------------------------------------------------------

/** Tracked SPY daily returns for benchmark comparison */
const spyDailyReturns: Array<{ date: string; returnPercent: number }> = [];

/**
 * Record SPY daily return for benchmark calculation.
 */
export function recordBenchmarkReturn(
  date: string,
  returnPercent: number,
): void {
  const existing = spyDailyReturns.find((r) => r.date === date);
  if (existing) {
    existing.returnPercent = returnPercent;
    return;
  }

  spyDailyReturns.push({ date, returnPercent });

  if (spyDailyReturns.length > MAX_DAILY_RETURNS_HISTORY) {
    spyDailyReturns.splice(0, spyDailyReturns.length - MAX_DAILY_RETURNS_HISTORY);
  }
}

function computeBenchmarkReturn(): number {
  if (spyDailyReturns.length === 0) return 0;
  return sumByKey(spyDailyReturns, "returnPercent");
}

// ---------------------------------------------------------------------------
// Aggregate Stats
// ---------------------------------------------------------------------------

function computeAggregateStats(
  entries: RiskAdjustedEntry[],
): RiskAdjustedLeaderboard["aggregateStats"] {
  if (entries.length === 0) {
    return {
      avgSharpe: 0,
      avgReturn: 0,
      avgDrawdown: 0,
      bestSharpe: null,
      worstDrawdown: null,
    };
  }

  const avgSharpe =
    round2(
      entries.reduce((sum, e) => sum + e.riskMetrics.sharpeRatio, 0) /
        entries.length,
    );

  const avgReturn = round2(averageByKey(entries, "totalReturnPercent"));

  const avgDrawdown =
    round2(
      entries.reduce(
        (sum, e) => sum + e.riskMetrics.maxDrawdownPercent,
        0,
      ) /
        entries.length,
    );

  let bestSharpe: { agentId: string; value: number } | null = null;
  let worstDrawdown: { agentId: string; value: number } | null = null;

  for (const e of entries) {
    if (
      !bestSharpe ||
      e.riskMetrics.sharpeRatio > bestSharpe.value
    ) {
      bestSharpe = {
        agentId: e.agentId,
        value: e.riskMetrics.sharpeRatio,
      };
    }
    if (
      !worstDrawdown ||
      e.riskMetrics.maxDrawdownPercent > worstDrawdown.value
    ) {
      worstDrawdown = {
        agentId: e.agentId,
        value: e.riskMetrics.maxDrawdownPercent,
      };
    }
  }

  return { avgSharpe, avgReturn, avgDrawdown, bestSharpe, worstDrawdown };
}

// ---------------------------------------------------------------------------
// Agent Detail View
// ---------------------------------------------------------------------------

/**
 * Get detailed risk analysis for a specific agent.
 */
export function getAgentRiskDetail(agentId: string): {
  entry: RiskAdjustedEntry | null;
  equityCurve: DailyReturn[];
  recentTrades: TradeRecord[];
  benchmarkComparison: {
    agentReturn: number;
    benchmarkReturn: number;
    alpha: number;
    outperforming: boolean;
  };
} {
  const leaderboard = getRiskAdjustedLeaderboard();
  const entry = leaderboard.entries.find((e) => e.agentId === agentId) ?? null;
  const series = agentReturnData.get(agentId);

  const agentReturn = entry?.totalReturnPercent ?? 0;
  const benchReturn = leaderboard.benchmarkReturn;

  return {
    entry,
    equityCurve: series?.dailyReturns ?? [],
    recentTrades: series?.trades.slice(-RECENT_TRADES_DISPLAY_LIMIT) ?? [],
    benchmarkComparison: {
      agentReturn,
      benchmarkReturn: benchReturn,
      alpha: round2(agentReturn - benchReturn),
      outperforming: agentReturn > benchReturn,
    },
  };
}
