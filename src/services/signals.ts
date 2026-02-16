/**
 * Signal Intelligence Service
 *
 * Real-time market signal generation and analysis engine. Computes technical
 * indicators (RSI, MACD, Bollinger, VWAP), generates AI-powered alerts,
 * detects cross-agent signal consensus, and provides actionable intelligence
 * for each tracked stock.
 *
 * This is MoltApp's "alpha generation" layer — turning raw price data into
 * structured, timestamped signals that agents (and humans) can act on.
 */

import { db } from "../db/index.ts";
import { agentDecisions } from "../db/schema/agent-decisions.ts";
import { eq, desc, gte, and } from "drizzle-orm";
import { getMarketData, getAgentConfigs } from "../agents/orchestrator.ts";
import type { MarketData } from "../agents/base-agent.ts";
import { round2, round3, computeVariance } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Technical Indicator Configuration Constants
 *
 * All technical indicator periods, thresholds, and parameters are defined here
 * for easy tuning and benchmark reproducibility. These control RSI, MACD,
 * Bollinger Bands, volume analysis, momentum calculations, and signal generation.
 */

// ===== RSI (Relative Strength Index) Parameters =====

/**
 * RSI period (lookback window in price bars)
 * Standard: 14 periods
 */
const RSI_PERIOD = 14;

/**
 * RSI oversold threshold (below this = oversold, potential bounce)
 * Standard: 30 (aggressive traders use 20)
 */
const RSI_OVERSOLD_THRESHOLD = 30;

/**
 * RSI overbought threshold (above this = overbought, potential pullback)
 * Standard: 70 (aggressive traders use 80)
 */
const RSI_OVERBOUGHT_THRESHOLD = 70;

/**
 * RSI extreme oversold threshold (very strong signal)
 * Used in overall signal scoring
 */
const RSI_EXTREME_OVERSOLD = 20;

/**
 * RSI extreme overbought threshold (very strong signal)
 * Used in overall signal scoring
 */
const RSI_EXTREME_OVERBOUGHT = 80;

/**
 * RSI neutral default (when insufficient data)
 */
const RSI_NEUTRAL_DEFAULT = 50;

// ===== MACD (Moving Average Convergence Divergence) Parameters =====

/**
 * MACD fast EMA period
 * Standard: 12 periods
 */
const MACD_FAST_PERIOD = 12;

/**
 * MACD slow EMA period
 * Standard: 26 periods
 */
const MACD_SLOW_PERIOD = 26;

/**
 * MACD signal line period (EMA of MACD line)
 * Standard: 9 periods
 */
const MACD_SIGNAL_PERIOD = 9;

// ===== Bollinger Bands Parameters =====

/**
 * Bollinger Bands period (moving average lookback)
 * Standard: 20 periods
 */
const BOLLINGER_PERIOD = 20;

/**
 * Bollinger Bands standard deviation multiplier
 * Standard: 2 (upper/lower bands are 2σ from middle)
 */
const BOLLINGER_STDDEV_MULTIPLIER = 2;

/**
 * Bollinger Bands squeeze threshold (bandwidth % below this = squeeze)
 * Squeeze: Low volatility, typically precedes big move
 * Standard: 4% bandwidth
 */
const BOLLINGER_SQUEEZE_THRESHOLD = 4;

/**
 * Bollinger Bands %B lower threshold (price at or below lower band)
 * Used for breakout detection
 */
const BOLLINGER_PERCENT_B_LOWER = 0;

/**
 * Bollinger Bands %B upper threshold (price at or above upper band)
 * Used for breakout detection
 */
const BOLLINGER_PERCENT_B_UPPER = 1.0;

/**
 * Bollinger Bands %B near lower threshold (price near lower band)
 * Used for overall signal scoring
 */
const BOLLINGER_PERCENT_B_NEAR_LOWER = 0.1;

/**
 * Bollinger Bands %B near upper threshold (price near upper band)
 * Used for overall signal scoring
 */
const BOLLINGER_PERCENT_B_NEAR_UPPER = 0.9;

/**
 * Bollinger Bands %B neutral position (price at middle band)
 */
const BOLLINGER_PERCENT_B_NEUTRAL = 0.5;

/**
 * Bollinger position classification lower threshold (< 0.2 = near lower)
 */
const BOLLINGER_POSITION_LOWER_THRESHOLD = 0.2;

/**
 * Bollinger position classification upper threshold (> 0.8 = near upper)
 */
const BOLLINGER_POSITION_UPPER_THRESHOLD = 0.8;

// ===== Volume Profile Parameters =====

/**
 * Volume spike threshold (current/average ratio)
 * Spike when volume > 2.0× average
 */
const VOLUME_SPIKE_THRESHOLD = 2.0;

/**
 * Volume trend increase threshold (ratio > this = increasing)
 * Standard: 1.3× average
 */
const VOLUME_TREND_INCREASE = 1.3;

/**
 * Volume trend decrease threshold (ratio < this = decreasing)
 * Standard: 0.7× average
 */
const VOLUME_TREND_DECREASE = 0.7;

// ===== Momentum Parameters =====

/**
 * Short-term momentum period (5 periods back)
 * Used for momentum shift detection
 */
const MOMENTUM_SHORT_TERM_PERIOD = 5;

/**
 * Medium-term momentum period (14 periods back)
 * Used for momentum shift detection and trend comparison
 */
const MOMENTUM_MEDIUM_TERM_PERIOD = 14;

/**
 * Long-term momentum period (30 periods back)
 * Used for overall trend strength
 */
const MOMENTUM_LONG_TERM_PERIOD = 30;

/**
 * Momentum acceleration threshold (|acceleration| > this = shift signal)
 * Acceleration = short-term - medium-term momentum
 */
const MOMENTUM_ACCELERATION_THRESHOLD = 2;

/**
 * Momentum strong directional threshold (|momentum| > this = breakout)
 * Used for price breakout signal generation
 */
const MOMENTUM_BREAKOUT_THRESHOLD = 3;

/**
 * Momentum overall signal contribution threshold (> this = bullish/bearish)
 * Used in overall signal scoring
 */
const MOMENTUM_SIGNAL_THRESHOLD = 2;

/**
 * Momentum acceleration signal contribution threshold (> this = bonus score)
 * Used in overall signal scoring
 */
const MOMENTUM_ACCELERATION_SIGNAL = 1;

// ===== Signal Generation Parameters =====

/**
 * Signal expiry time (milliseconds)
 * Standard: 30 minutes for technical signals
 */
const SIGNAL_EXPIRY_MS = 30 * 60 * 1000;

/**
 * Consensus signal expiry time (milliseconds)
 * Longer expiry for agent consensus signals
 */
const SIGNAL_CONSENSUS_EXPIRY_MS = 60 * 60 * 1000;

/**
 * RSI signal strength multiplier (per point beyond threshold)
 * strength = (threshold_distance) * multiplier
 */
const SIGNAL_RSI_STRENGTH_MULTIPLIER = 3;

/**
 * MACD histogram strength multiplier
 * strength = |histogram| * multiplier
 */
const SIGNAL_MACD_STRENGTH_MULTIPLIER = 500;

/**
 * Bollinger squeeze strength multiplier
 * strength = (threshold - bandwidth) * multiplier
 */
const SIGNAL_BOLLINGER_SQUEEZE_MULTIPLIER = 25;

/**
 * Bollinger breakout strength divisor (percentB distance from center)
 * strength = |percentB - 0.5| * 100
 */
const SIGNAL_BOLLINGER_BREAKOUT_DIVISOR = 0.5;

/**
 * MACD rounding precision (4 decimal places)
 * Precision multiplier: 10000 = 4 decimal places
 * Example: Math.round(value * 10000) / 10000 → 0.1234
 * Used for MACD line, signal line, and histogram display formatting
 */
const MACD_ROUNDING_PRECISION = 10000;

/**
 * Volume spike strength multiplier
 * strength = ratio * multiplier
 */
const SIGNAL_VOLUME_STRENGTH_MULTIPLIER = 25;

/**
 * Momentum shift strength multiplier
 * strength = |acceleration| * multiplier
 */
const SIGNAL_MOMENTUM_STRENGTH_MULTIPLIER = 10;

/**
 * Price breakout strength multiplier
 * strength = |momentum| * multiplier
 */
const SIGNAL_BREAKOUT_STRENGTH_MULTIPLIER = 10;

/**
 * Strong signal threshold (strength >= this = strong buy/sell)
 * Used for dashboard filtering
 */
const SIGNAL_STRONG_THRESHOLD = 70;

// ===== Agent Consensus Parameters =====

/**
 * Agent consensus agreement threshold (% of agents agreeing)
 * >= 80% agreement = consensus signal
 */
const CONSENSUS_AGREEMENT_THRESHOLD = 80;

/**
 * Agent consensus strength multiplier (for divergence signals)
 * strength = avgConfidence * multiplier
 */
const CONSENSUS_DIVERGENCE_MULTIPLIER = 0.7;

/**
 * Agent consensus minimum agents for divergence signal
 * Need at least 2 agents for meaningful split
 */
const CONSENSUS_MIN_AGENTS_DIVERGENCE = 2;

/**
 * High-confidence trade threshold (confidence >= this)
 * Used for individual agent signal generation
 */
const CONSENSUS_HIGH_CONFIDENCE_THRESHOLD = 85;

/**
 * Agent consensus lookback window (milliseconds)
 * Look at last 24 hours of decisions
 */
const CONSENSUS_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/**
 * High-confidence trade lookback window (milliseconds)
 * Look at last 2 hours for high-conviction trades
 */
const CONSENSUS_HIGH_CONF_LOOKBACK_MS = 2 * 60 * 60 * 1000;

/**
 * Agent consensus recent decisions limit (per agent)
 * Fetch last N decisions per agent
 */
const CONSENSUS_RECENT_DECISIONS_LIMIT = 10;

/**
 * High-confidence trades limit (global)
 * Show top N high-confidence trades in signals
 */
const CONSENSUS_HIGH_CONF_LIMIT = 5;

// ===== Overall Signal Scoring Parameters =====

/**
 * Overall signal strong buy threshold (composite score >= this)
 * Composite score from RSI + MACD + Bollinger + Momentum
 */
const OVERALL_SIGNAL_STRONG_BUY = 3;

/**
 * Overall signal buy threshold (composite score >= this)
 */
const OVERALL_SIGNAL_BUY = 1.5;

/**
 * Overall signal strong sell threshold (composite score <= this)
 */
const OVERALL_SIGNAL_STRONG_SELL = -3;

/**
 * Overall signal sell threshold (composite score <= this)
 */
const OVERALL_SIGNAL_SELL = -1.5;

/**
 * RSI contribution to overall signal (extreme oversold)
 */
const OVERALL_RSI_EXTREME_OVERSOLD_SCORE = 2;

/**
 * RSI contribution to overall signal (oversold)
 */
const OVERALL_RSI_OVERSOLD_SCORE = 1;

/**
 * RSI contribution to overall signal (extreme overbought)
 */
const OVERALL_RSI_EXTREME_OVERBOUGHT_SCORE = -2;

/**
 * RSI contribution to overall signal (overbought)
 */
const OVERALL_RSI_OVERBOUGHT_SCORE = -1;

/**
 * MACD crossover contribution to overall signal
 */
const OVERALL_MACD_CROSSOVER_SCORE = 1;

/**
 * MACD histogram contribution to overall signal
 */
const OVERALL_MACD_HISTOGRAM_SCORE = 0.5;

/**
 * Bollinger %B contribution to overall signal (near lower/upper)
 */
const OVERALL_BOLLINGER_SCORE = 1;

/**
 * Momentum contribution to overall signal (strong directional)
 */
const OVERALL_MOMENTUM_SCORE = 1;

/**
 * Momentum acceleration contribution to overall signal
 */
const OVERALL_MOMENTUM_ACCELERATION_SCORE = 0.5;

// ===== Dashboard Parameters =====

/**
 * Market sentiment bullish threshold (bullish/bearish ratio)
 * If bullish > bearish * 1.5, market is risk_on
 */
const DASHBOARD_SENTIMENT_BULLISH_RATIO = 1.5;

/**
 * Dashboard top opportunities/risks limit
 * Show top N bullish/bearish signals
 */
const DASHBOARD_TOP_SIGNALS_LIMIT = 5;

/**
 * Dashboard technical summary stock limit
 * Show technical indicators for top N stocks
 */
const DASHBOARD_TECHNICAL_SUMMARY_LIMIT = 10;

/**
 * Dashboard trending stocks limit
 * Show top N stocks by signal count
 */
const DASHBOARD_TRENDING_LIMIT = 5;

// ===== Price History Parameters =====

/**
 * Price history default periods
 * Fetch last N price points for indicator calculations
 */
const PRICE_HISTORY_DEFAULT_PERIODS = 30;

/**
 * Price history decision multiplier
 * Fetch periods * multiplier decisions (not all will have symbol)
 */
const PRICE_HISTORY_DECISION_MULTIPLIER = 3;

/**
 * Price history minimum data points
 * Fall back to synthetic if < N historical prices
 */
const PRICE_HISTORY_MIN_DATA = 5;

/**
 * Synthetic price walk drift (slight upward bias)
 * Standard: -0.48 centers random() around +0.02
 */
const SYNTHETIC_PRICE_DRIFT = -0.48;

/**
 * Synthetic price walk volatility multiplier
 */
const SYNTHETIC_PRICE_VOLATILITY = 0.02;

/**
 * Synthetic fallback base price (when no market data)
 */
const SYNTHETIC_FALLBACK_PRICE = 100;

/**
 * Volume profile lookback window (days)
 * Calculate average from last N days
 */
const VOLUME_LOOKBACK_DAYS = 7;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A structured market signal */
export interface MarketSignal {
  id: string;
  symbol: string;
  type: SignalType;
  direction: "bullish" | "bearish" | "neutral";
  strength: number; // 0-100
  indicator: string;
  value: number;
  threshold: number;
  description: string;
  timeframe: "1h" | "4h" | "1d" | "1w";
  generatedAt: string;
  expiresAt: string;
}

export type SignalType =
  | "rsi_oversold"
  | "rsi_overbought"
  | "macd_crossover"
  | "macd_crossunder"
  | "bollinger_squeeze"
  | "bollinger_breakout"
  | "volume_spike"
  | "momentum_shift"
  | "trend_reversal"
  | "price_breakout"
  | "support_test"
  | "resistance_test"
  | "agent_consensus"
  | "agent_divergence"
  | "high_confidence_trade"
  | "whale_accumulation";

/** Technical indicator values for a stock */
export interface TechnicalIndicators {
  symbol: string;
  price: number;
  change24h: number | null;
  rsi: number;
  rsiSignal: "oversold" | "neutral" | "overbought";
  macd: MACDData;
  bollingerBands: BollingerBands;
  volumeProfile: VolumeProfile;
  momentum: MomentumData;
  trendStrength: number;
  overallSignal: "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell";
}

interface MACDData {
  macdLine: number;
  signalLine: number;
  histogram: number;
  crossover: "bullish" | "bearish" | "none";
}

interface BollingerBands {
  upper: number;
  middle: number;
  lower: number;
  bandwidth: number;
  percentB: number; // 0 = at lower, 1 = at upper, 0.5 = at middle
  squeeze: boolean;
}

interface VolumeProfile {
  current: number;
  average: number;
  ratio: number; // current/average
  spike: boolean;
  trend: "increasing" | "decreasing" | "stable";
}

interface MomentumData {
  shortTerm: number; // 5-period momentum
  mediumTerm: number; // 14-period momentum
  longTerm: number; // 30-period momentum
  acceleration: number;
}

/** Cross-agent signal consensus */
export interface AgentConsensus {
  symbol: string;
  agentSignals: AgentSignalEntry[];
  consensusDirection: "bullish" | "bearish" | "split" | "neutral";
  consensusStrength: number; // 0-100
  agreementRate: number; // percentage of agents that agree
  averageConfidence: number;
  lastUpdated: string;
}

interface AgentSignalEntry {
  agentId: string;
  agentName: string;
  provider: string;
  lastAction: "buy" | "sell" | "hold";
  confidence: number;
  reasoning: string;
  timestamp: string;
}

/** Real-time market intelligence dashboard data */
export interface SignalDashboard {
  generatedAt: string;
  marketSentiment: "risk_on" | "risk_off" | "neutral";
  totalSignals: number;
  strongBuySignals: number;
  strongSellSignals: number;
  topOpportunities: MarketSignal[];
  topRisks: MarketSignal[];
  agentConsensus: AgentConsensus[];
  technicalSummary: TechnicalSummary[];
  signalsByType: Record<string, number>;
  volatilityIndex: number;
  trendingStocks: TrendingStock[];
}

interface TechnicalSummary {
  symbol: string;
  price: number;
  overallSignal: string;
  rsi: number;
  macdSignal: string;
  bollingerPosition: string;
  volumeStatus: string;
}

interface TrendingStock {
  symbol: string;
  signalCount: number;
  dominantDirection: string;
  momentum: number;
}

// ---------------------------------------------------------------------------
// Price History Simulation
// ---------------------------------------------------------------------------

/**
 * Since we don't have full historical OHLCV candle data from Jupiter,
 * we generate synthetic price history from agent decisions and current
 * market data. Each decision stores a market snapshot, so we can
 * reconstruct a price series from past rounds.
 */
async function getPriceHistory(
  symbol: string,
  periods: number = PRICE_HISTORY_DEFAULT_PERIODS,
): Promise<number[]> {
  // Fetch recent decisions that contain market snapshots for this symbol
  const recentDecisions = await db
    .select({
      marketSnapshot: agentDecisions.marketSnapshot,
      createdAt: agentDecisions.createdAt,
    })
    .from(agentDecisions)
    .where(eq(agentDecisions.symbol, symbol))
    .orderBy(desc(agentDecisions.createdAt))
    .limit(periods * PRICE_HISTORY_DECISION_MULTIPLIER); // get extra since not all will have the symbol

  const prices: number[] = [];
  const seen = new Set<string>();

  for (const d of recentDecisions) {
    if (prices.length >= periods) break;
    const snapshot = d.marketSnapshot as Record<
      string,
      { price: number; change24h: number | null }
    > | null;
    if (!snapshot) continue;

    const dateKey = d.createdAt.toISOString().slice(0, 13); // group by hour
    if (seen.has(dateKey)) continue;
    seen.add(dateKey);

    const stockData = snapshot[symbol];
    if (stockData?.price) {
      prices.push(stockData.price);
    }
  }

  // If we don't have enough data, generate synthetic history from current price
  if (prices.length < PRICE_HISTORY_MIN_DATA) {
    const currentMarket = await getMarketData();
    const stock = currentMarket.find((m) => m.symbol === symbol);
    const basePrice = stock?.price ?? SYNTHETIC_FALLBACK_PRICE;

    // Generate a random walk backward from current price
    const syntheticPrices: number[] = [basePrice];
    for (let i = 1; i < periods; i++) {
      const change = (Math.random() + SYNTHETIC_PRICE_DRIFT) * SYNTHETIC_PRICE_VOLATILITY; // slight upward bias
      syntheticPrices.push(syntheticPrices[i - 1] * (1 - change));
    }
    return syntheticPrices.reverse();
  }

  return prices.reverse(); // chronological order
}

// ---------------------------------------------------------------------------
// Technical Indicator Calculations
// ---------------------------------------------------------------------------

/** Calculate RSI (Relative Strength Index) */
function calculateRSI(prices: number[], period: number = RSI_PERIOD): number {
  if (prices.length < period + 1) return RSI_NEUTRAL_DEFAULT; // default neutral

  const changes: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }

  const recentChanges = changes.slice(-period);
  let gains = 0;
  let losses = 0;

  for (const change of recentChanges) {
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Calculate MACD (Moving Average Convergence Divergence) */
function calculateMACD(prices: number[]): MACDData {
  const ema12 = calculateEMA(prices, MACD_FAST_PERIOD);
  const ema26 = calculateEMA(prices, MACD_SLOW_PERIOD);
  const macdLine = ema12 - ema26;

  // Signal line (9-period EMA of MACD)
  // Simplified: use recent MACD values
  const macdValues = [];
  for (let i = Math.max(0, prices.length - MACD_SIGNAL_PERIOD); i < prices.length; i++) {
    const e12 = calculateEMA(prices.slice(0, i + 1), MACD_FAST_PERIOD);
    const e26 = calculateEMA(prices.slice(0, i + 1), MACD_SLOW_PERIOD);
    macdValues.push(e12 - e26);
  }
  const signalLine =
    macdValues.length > 0
      ? macdValues.reduce((s, v) => s + v, 0) / macdValues.length
      : 0;

  const histogram = macdLine - signalLine;

  let crossover: "bullish" | "bearish" | "none" = "none";
  if (macdValues.length >= 2) {
    const prevHistogram =
      macdValues[macdValues.length - 2] -
      (macdValues.length >= 3
        ? macdValues
            .slice(0, -1)
            .reduce((s, v) => s + v, 0) / (macdValues.length - 1)
        : signalLine);
    if (prevHistogram < 0 && histogram > 0) crossover = "bullish";
    else if (prevHistogram > 0 && histogram < 0) crossover = "bearish";
  }

  return {
    macdLine: Math.round(macdLine * MACD_ROUNDING_PRECISION) / MACD_ROUNDING_PRECISION,
    signalLine: Math.round(signalLine * MACD_ROUNDING_PRECISION) / MACD_ROUNDING_PRECISION,
    histogram: Math.round(histogram * MACD_ROUNDING_PRECISION) / MACD_ROUNDING_PRECISION,
    crossover,
  };
}

/** Calculate EMA (Exponential Moving Average) */
function calculateEMA(prices: number[], period: number): number {
  if (prices.length === 0) return 0;
  if (prices.length < period) {
    return prices.reduce((s, p) => s + p, 0) / prices.length;
  }

  const multiplier = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((s, p) => s + p, 0) / period;

  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }

  return ema;
}

/** Calculate Bollinger Bands */
function calculateBollingerBands(
  prices: number[],
  period: number = 20,
  stdDevMultiplier: number = 2,
): BollingerBands {
  const recentPrices = prices.slice(-period);
  const middle = recentPrices.reduce((s, p) => s + p, 0) / recentPrices.length;

  const variance = computeVariance(recentPrices, true); // population variance
  const stdDev = Math.sqrt(variance);

  const upper = middle + stdDevMultiplier * stdDev;
  const lower = middle - stdDevMultiplier * stdDev;
  const bandwidth = ((upper - lower) / middle) * 100;

  const currentPrice = prices[prices.length - 1];
  const percentB =
    upper !== lower ? (currentPrice - lower) / (upper - lower) : 0.5;

  // Squeeze: bandwidth < 4% (low volatility, typically precedes big move)
  const squeeze = bandwidth < 4;

  return {
    upper: round2(upper),
    middle: round2(middle),
    lower: round2(lower),
    bandwidth: round2(bandwidth),
    percentB: round3(percentB),
    squeeze,
  };
}

/** Calculate volume profile from agent decision frequency */
function calculateVolumeProfile(
  decisionCount: number,
  avgDecisionCount: number,
): VolumeProfile {
  const ratio = avgDecisionCount > 0 ? decisionCount / avgDecisionCount : 1;
  const spike = ratio > 2.0;
  const trend: "increasing" | "decreasing" | "stable" =
    ratio > 1.3 ? "increasing" : ratio < 0.7 ? "decreasing" : "stable";

  return {
    current: decisionCount,
    average: avgDecisionCount,
    ratio: round2(ratio),
    spike,
    trend,
  };
}

/** Calculate momentum across multiple timeframes */
function calculateMomentum(prices: number[]): MomentumData {
  const current = prices[prices.length - 1] ?? 0;

  const shortTerm =
    prices.length >= 5
      ? ((current - prices[prices.length - 5]) / prices[prices.length - 5]) *
        100
      : 0;

  const mediumTerm =
    prices.length >= 14
      ? ((current - prices[prices.length - 14]) /
          prices[prices.length - 14]) *
        100
      : 0;

  const longTerm =
    prices.length >= 30
      ? ((current - prices[0]) / prices[0]) * 100
      : mediumTerm;

  // Acceleration: rate of change of momentum
  const acceleration = shortTerm - mediumTerm;

  return {
    shortTerm: round2(shortTerm),
    mediumTerm: round2(mediumTerm),
    longTerm: round2(longTerm),
    acceleration: round2(acceleration),
  };
}

// ---------------------------------------------------------------------------
// Signal Generation
// ---------------------------------------------------------------------------

/** Generate all signals for a single stock */
function generateStockSignals(
  symbol: string,
  price: number,
  indicators: TechnicalIndicators,
): MarketSignal[] {
  const signals: MarketSignal[] = [];
  const now = new Date();
  const signalId = () =>
    `sig_${symbol}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const expiry = new Date(now.getTime() + 30 * 60 * 1000); // 30 min expiry

  // RSI signals
  if (indicators.rsi < 30) {
    signals.push({
      id: signalId(),
      symbol,
      type: "rsi_oversold",
      direction: "bullish",
      strength: Math.min(100, Math.round((30 - indicators.rsi) * SIGNAL_RSI_STRENGTH_MULTIPLIER)),
      indicator: "RSI",
      value: indicators.rsi,
      threshold: 30,
      description: `${symbol} RSI at ${indicators.rsi.toFixed(1)} — oversold territory. Potential bounce opportunity.`,
      timeframe: "1d",
      generatedAt: now.toISOString(),
      expiresAt: expiry.toISOString(),
    });
  } else if (indicators.rsi > 70) {
    signals.push({
      id: signalId(),
      symbol,
      type: "rsi_overbought",
      direction: "bearish",
      strength: Math.min(100, Math.round((indicators.rsi - 70) * SIGNAL_RSI_STRENGTH_MULTIPLIER)),
      indicator: "RSI",
      value: indicators.rsi,
      threshold: 70,
      description: `${symbol} RSI at ${indicators.rsi.toFixed(1)} — overbought territory. Potential pullback ahead.`,
      timeframe: "1d",
      generatedAt: now.toISOString(),
      expiresAt: expiry.toISOString(),
    });
  }

  // MACD crossover signals
  if (indicators.macd.crossover === "bullish") {
    signals.push({
      id: signalId(),
      symbol,
      type: "macd_crossover",
      direction: "bullish",
      strength: Math.min(
        100,
        Math.round(Math.abs(indicators.macd.histogram) * SIGNAL_MACD_STRENGTH_MULTIPLIER),
      ),
      indicator: "MACD",
      value: indicators.macd.macdLine,
      threshold: indicators.macd.signalLine,
      description: `${symbol} MACD bullish crossover — momentum shifting upward.`,
      timeframe: "1d",
      generatedAt: now.toISOString(),
      expiresAt: expiry.toISOString(),
    });
  } else if (indicators.macd.crossover === "bearish") {
    signals.push({
      id: signalId(),
      symbol,
      type: "macd_crossunder",
      direction: "bearish",
      strength: Math.min(
        100,
        Math.round(Math.abs(indicators.macd.histogram) * SIGNAL_MACD_STRENGTH_MULTIPLIER),
      ),
      indicator: "MACD",
      value: indicators.macd.macdLine,
      threshold: indicators.macd.signalLine,
      description: `${symbol} MACD bearish crossunder — momentum shifting downward.`,
      timeframe: "1d",
      generatedAt: now.toISOString(),
      expiresAt: expiry.toISOString(),
    });
  }

  // Bollinger Band signals
  if (indicators.bollingerBands.squeeze) {
    signals.push({
      id: signalId(),
      symbol,
      type: "bollinger_squeeze",
      direction: "neutral",
      strength: Math.min(
        100,
        Math.round((4 - indicators.bollingerBands.bandwidth) * SIGNAL_BOLLINGER_SQUEEZE_MULTIPLIER),
      ),
      indicator: "Bollinger Bands",
      value: indicators.bollingerBands.bandwidth,
      threshold: 4,
      description: `${symbol} Bollinger Band squeeze — low volatility period. Breakout imminent.`,
      timeframe: "1d",
      generatedAt: now.toISOString(),
      expiresAt: expiry.toISOString(),
    });
  }

  if (
    indicators.bollingerBands.percentB > 1.0 ||
    indicators.bollingerBands.percentB < 0
  ) {
    const breakoutDir = indicators.bollingerBands.percentB > 1 ? "bullish" : "bearish";
    signals.push({
      id: signalId(),
      symbol,
      type: "bollinger_breakout",
      direction: breakoutDir,
      strength: Math.min(
        100,
        Math.round(
          Math.abs(indicators.bollingerBands.percentB - 0.5) * 100,
        ),
      ),
      indicator: "Bollinger Bands",
      value: price,
      threshold:
        breakoutDir === "bullish"
          ? indicators.bollingerBands.upper
          : indicators.bollingerBands.lower,
      description: `${symbol} broke ${breakoutDir === "bullish" ? "above upper" : "below lower"} Bollinger Band — ${breakoutDir} breakout.`,
      timeframe: "1d",
      generatedAt: now.toISOString(),
      expiresAt: expiry.toISOString(),
    });
  }

  // Volume spike
  if (indicators.volumeProfile.spike) {
    signals.push({
      id: signalId(),
      symbol,
      type: "volume_spike",
      direction:
        indicators.momentum.shortTerm > 0 ? "bullish" : "bearish",
      strength: Math.min(
        100,
        Math.round(indicators.volumeProfile.ratio * SIGNAL_VOLUME_STRENGTH_MULTIPLIER),
      ),
      indicator: "Volume",
      value: indicators.volumeProfile.current,
      threshold: indicators.volumeProfile.average * 2,
      description: `${symbol} volume spike: ${indicators.volumeProfile.ratio.toFixed(1)}x average — increased activity.`,
      timeframe: "1h",
      generatedAt: now.toISOString(),
      expiresAt: expiry.toISOString(),
    });
  }

  // Momentum shift
  if (
    Math.abs(indicators.momentum.acceleration) > 2 &&
    indicators.momentum.shortTerm * indicators.momentum.mediumTerm < 0
  ) {
    signals.push({
      id: signalId(),
      symbol,
      type: "momentum_shift",
      direction: indicators.momentum.shortTerm > 0 ? "bullish" : "bearish",
      strength: Math.min(
        100,
        Math.round(Math.abs(indicators.momentum.acceleration) * SIGNAL_MOMENTUM_STRENGTH_MULTIPLIER),
      ),
      indicator: "Momentum",
      value: indicators.momentum.shortTerm,
      threshold: 0,
      description: `${symbol} momentum shift — short-term ${indicators.momentum.shortTerm > 0 ? "bullish" : "bearish"} diverging from medium-term trend.`,
      timeframe: "4h",
      generatedAt: now.toISOString(),
      expiresAt: expiry.toISOString(),
    });
  }

  // Price breakout (strong directional move)
  if (Math.abs(indicators.momentum.shortTerm) > 3) {
    signals.push({
      id: signalId(),
      symbol,
      type: "price_breakout",
      direction: indicators.momentum.shortTerm > 0 ? "bullish" : "bearish",
      strength: Math.min(
        100,
        Math.round(Math.abs(indicators.momentum.shortTerm) * SIGNAL_BREAKOUT_STRENGTH_MULTIPLIER),
      ),
      indicator: "Price Action",
      value: price,
      threshold: price * (1 - indicators.momentum.shortTerm / 100),
      description: `${symbol} ${indicators.momentum.shortTerm > 0 ? "surging" : "plunging"} ${Math.abs(indicators.momentum.shortTerm).toFixed(1)}% — strong directional move.`,
      timeframe: "1h",
      generatedAt: now.toISOString(),
      expiresAt: expiry.toISOString(),
    });
  }

  return signals;
}

/** Determine overall signal from indicators */
function computeOverallSignal(
  rsi: number,
  macd: MACDData,
  bollinger: BollingerBands,
  momentum: MomentumData,
): "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell" {
  let score = 0;

  // RSI contribution (-2 to +2)
  if (rsi < 20) score += 2;
  else if (rsi < 30) score += 1;
  else if (rsi > 80) score -= 2;
  else if (rsi > 70) score -= 1;

  // MACD contribution (-1 to +1)
  if (macd.crossover === "bullish") score += 1;
  else if (macd.crossover === "bearish") score -= 1;
  if (macd.histogram > 0) score += 0.5;
  else if (macd.histogram < 0) score -= 0.5;

  // Bollinger contribution (-1 to +1)
  if (bollinger.percentB < 0.1) score += 1;
  else if (bollinger.percentB > 0.9) score -= 1;

  // Momentum contribution (-1.5 to +1.5)
  if (momentum.shortTerm > 2) score += 1;
  else if (momentum.shortTerm < -2) score -= 1;
  if (momentum.acceleration > 1) score += 0.5;
  else if (momentum.acceleration < -1) score -= 0.5;

  if (score >= 3) return "strong_buy";
  if (score >= 1.5) return "buy";
  if (score <= -3) return "strong_sell";
  if (score <= -1.5) return "sell";
  return "neutral";
}

// ---------------------------------------------------------------------------
// Public API Functions
// ---------------------------------------------------------------------------

/**
 * Compute full technical indicators for a single stock.
 */
export async function getStockIndicators(
  symbol: string,
): Promise<TechnicalIndicators | null> {
  const marketData = await getMarketData();
  const stock = marketData.find(
    (m) => m.symbol.toLowerCase() === symbol.toLowerCase(),
  );
  if (!stock) return null;

  const priceHistory = await getPriceHistory(symbol);

  const rsi = calculateRSI(priceHistory);
  const macd = calculateMACD(priceHistory);
  const bollingerBands = calculateBollingerBands(priceHistory);
  const momentum = calculateMomentum(priceHistory);

  // Volume from decision frequency
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  let recentCount = 0;
  let weekCount = 0;
  try {
    const recentDecisions = await db
      .select()
      .from(agentDecisions)
      .where(
        and(
          eq(agentDecisions.symbol, symbol),
          gte(agentDecisions.createdAt, oneDayAgo),
        ),
      );
    recentCount = recentDecisions.length;

    const weekDecisions = await db
      .select()
      .from(agentDecisions)
      .where(
        and(
          eq(agentDecisions.symbol, symbol),
          gte(agentDecisions.createdAt, oneWeekAgo),
        ),
      );
    weekCount = weekDecisions.length;
  } catch {
    // ignore DB errors
  }

  const avgDailyCount = weekCount / 7;
  const volumeProfile = calculateVolumeProfile(recentCount, avgDailyCount);

  const rsiSignal: "oversold" | "neutral" | "overbought" =
    rsi < 30 ? "oversold" : rsi > 70 ? "overbought" : "neutral";

  const overallSignal = computeOverallSignal(
    rsi,
    macd,
    bollingerBands,
    momentum,
  );

  return {
    symbol,
    price: stock.price,
    change24h: stock.change24h,
    rsi: Math.round(rsi * 10) / 10,
    rsiSignal,
    macd,
    bollingerBands,
    volumeProfile,
    momentum,
    trendStrength: Math.round(Math.abs(momentum.mediumTerm) * 10) / 10,
    overallSignal,
  };
}

/**
 * Get all active signals across all tracked stocks.
 */
export async function getAllSignals(): Promise<MarketSignal[]> {
  const marketData = await getMarketData();
  const allSignals: MarketSignal[] = [];

  for (const stock of marketData) {
    const indicators = await getStockIndicators(stock.symbol);
    if (!indicators) continue;

    const stockSignals = generateStockSignals(
      stock.symbol,
      stock.price,
      indicators,
    );
    allSignals.push(...stockSignals);
  }

  // Add agent consensus signals
  const consensusSignals = await generateAgentConsensusSignals();
  allSignals.push(...consensusSignals);

  // Sort by strength descending
  return allSignals.sort((a, b) => b.strength - a.strength);
}

/**
 * Get cross-agent consensus for each stock.
 */
export async function getAgentConsensusData(): Promise<AgentConsensus[]> {
  const configs = getAgentConfigs();
  const symbols = new Set<string>();
  const agentDecisionMap = new Map<
    string,
    Map<
      string,
      { action: string; confidence: number; reasoning: string; timestamp: Date }
    >
  >();

  // Fetch recent decisions for all agents
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  for (const config of configs) {
    const decisions = await db
      .select()
      .from(agentDecisions)
      .where(
        and(
          eq(agentDecisions.agentId, config.agentId),
          gte(agentDecisions.createdAt, oneDayAgo),
        ),
      )
      .orderBy(desc(agentDecisions.createdAt))
      .limit(10);

    const symbolMap = new Map<
      string,
      { action: string; confidence: number; reasoning: string; timestamp: Date }
    >();

    for (const d of decisions) {
      if (!symbolMap.has(d.symbol)) {
        symbolMap.set(d.symbol, {
          action: d.action,
          confidence: d.confidence,
          reasoning: d.reasoning,
          timestamp: d.createdAt,
        });
        symbols.add(d.symbol);
      }
    }

    agentDecisionMap.set(config.agentId, symbolMap);
  }

  // Build consensus for each symbol
  const consensusList: AgentConsensus[] = [];

  for (const symbol of symbols) {
    const agentSignals: AgentSignalEntry[] = [];

    for (const config of configs) {
      const symbolMap = agentDecisionMap.get(config.agentId);
      const decision = symbolMap?.get(symbol);
      if (decision) {
        agentSignals.push({
          agentId: config.agentId,
          agentName: config.name,
          provider: config.provider,
          lastAction: decision.action as "buy" | "sell" | "hold",
          confidence: decision.confidence,
          reasoning: decision.reasoning,
          timestamp: decision.timestamp.toISOString(),
        });
      }
    }

    if (agentSignals.length === 0) continue;

    // Calculate consensus
    const buyCount = agentSignals.filter((s) => s.lastAction === "buy").length;
    const sellCount = agentSignals.filter(
      (s) => s.lastAction === "sell",
    ).length;
    const holdCount = agentSignals.filter(
      (s) => s.lastAction === "hold",
    ).length;
    const total = agentSignals.length;

    let consensusDirection: "bullish" | "bearish" | "split" | "neutral";
    if (buyCount > total / 2) consensusDirection = "bullish";
    else if (sellCount > total / 2) consensusDirection = "bearish";
    else if (holdCount > total / 2) consensusDirection = "neutral";
    else consensusDirection = "split";

    const maxDirection = Math.max(buyCount, sellCount, holdCount);
    const agreementRate = (maxDirection / total) * 100;
    const avgConfidence =
      agentSignals.reduce((s, a) => s + a.confidence, 0) / total;
    const consensusStrength = agreementRate * (avgConfidence / 100);

    consensusList.push({
      symbol,
      agentSignals,
      consensusDirection,
      consensusStrength: Math.round(consensusStrength * 10) / 10,
      agreementRate: Math.round(agreementRate * 10) / 10,
      averageConfidence: Math.round(avgConfidence * 10) / 10,
      lastUpdated: new Date().toISOString(),
    });
  }

  return consensusList.sort(
    (a, b) => b.consensusStrength - a.consensusStrength,
  );
}

/**
 * Generate signals specifically from agent consensus/divergence patterns.
 */
async function generateAgentConsensusSignals(): Promise<MarketSignal[]> {
  const consensus = await getAgentConsensusData();
  const signals: MarketSignal[] = [];
  const now = new Date();
  const expiry = new Date(now.getTime() + 60 * 60 * 1000); // 1hr expiry

  for (const c of consensus) {
    if (c.agreementRate >= 80 && c.consensusDirection !== "neutral") {
      signals.push({
        id: `sig_consensus_${c.symbol}_${Date.now()}`,
        symbol: c.symbol,
        type: "agent_consensus",
        direction: c.consensusDirection === "bullish" ? "bullish" : "bearish",
        strength: Math.round(c.consensusStrength),
        indicator: "Agent Consensus",
        value: c.agreementRate,
        threshold: 80,
        description: `All agents agree: ${c.consensusDirection} on ${c.symbol} (${c.agreementRate}% agreement, avg confidence ${c.averageConfidence}%)`,
        timeframe: "1h",
        generatedAt: now.toISOString(),
        expiresAt: expiry.toISOString(),
      });
    }

    if (c.consensusDirection === "split" && c.agentSignals.length >= 2) {
      signals.push({
        id: `sig_divergence_${c.symbol}_${Date.now()}`,
        symbol: c.symbol,
        type: "agent_divergence",
        direction: "neutral",
        strength: Math.round(c.averageConfidence * 0.7),
        indicator: "Agent Divergence",
        value: c.agreementRate,
        threshold: 50,
        description: `Agents split on ${c.symbol} — high-confidence disagreement suggests inflection point.`,
        timeframe: "1h",
        generatedAt: now.toISOString(),
        expiresAt: expiry.toISOString(),
      });
    }
  }

  // High-confidence individual agent trades
  const recentHighConf = await db
    .select()
    .from(agentDecisions)
    .where(gte(agentDecisions.createdAt, new Date(Date.now() - 2 * 60 * 60 * 1000)))
    .orderBy(desc(agentDecisions.confidence))
    .limit(5);

  for (const d of recentHighConf) {
    if (d.confidence >= 85 && d.action !== "hold") {
      const config = getAgentConfigs().find((c) => c.agentId === d.agentId);
      signals.push({
        id: `sig_highconf_${d.id}_${Date.now()}`,
        symbol: d.symbol,
        type: "high_confidence_trade",
        direction: d.action === "buy" ? "bullish" : "bearish",
        strength: d.confidence,
        indicator: `${config?.name ?? d.agentId} High-Confidence`,
        value: d.confidence,
        threshold: 85,
        description: `${config?.name ?? d.agentId} made a ${d.confidence}% confidence ${d.action.toUpperCase()} on ${d.symbol}: "${d.reasoning.slice(0, 100)}..."`,
        timeframe: "1h",
        generatedAt: d.createdAt.toISOString(),
        expiresAt: expiry.toISOString(),
      });
    }
  }

  return signals;
}

/**
 * Build the full signal intelligence dashboard.
 */
export async function getSignalDashboard(): Promise<SignalDashboard> {
  const marketData = await getMarketData();
  const allSignals = await getAllSignals();
  const agentConsensus = await getAgentConsensusData();

  // Market sentiment
  const bullishSignals = allSignals.filter(
    (s) => s.direction === "bullish",
  ).length;
  const bearishSignals = allSignals.filter(
    (s) => s.direction === "bearish",
  ).length;
  const marketSentiment: "risk_on" | "risk_off" | "neutral" =
    bullishSignals > bearishSignals * 1.5
      ? "risk_on"
      : bearishSignals > bullishSignals * 1.5
        ? "risk_off"
        : "neutral";

  // Strong signals
  const strongBuySignals = allSignals.filter(
    (s) => s.direction === "bullish" && s.strength >= 70,
  ).length;
  const strongSellSignals = allSignals.filter(
    (s) => s.direction === "bearish" && s.strength >= 70,
  ).length;

  // Top opportunities and risks
  const topOpportunities = allSignals
    .filter((s) => s.direction === "bullish")
    .slice(0, 5);
  const topRisks = allSignals
    .filter((s) => s.direction === "bearish")
    .slice(0, 5);

  // Technical summaries
  const technicalSummary: TechnicalSummary[] = [];
  for (const stock of marketData.slice(0, 10)) {
    const indicators = await getStockIndicators(stock.symbol);
    if (!indicators) continue;

    technicalSummary.push({
      symbol: stock.symbol,
      price: stock.price,
      overallSignal: indicators.overallSignal,
      rsi: indicators.rsi,
      macdSignal: indicators.macd.crossover,
      bollingerPosition:
        indicators.bollingerBands.percentB < 0.2
          ? "near_lower"
          : indicators.bollingerBands.percentB > 0.8
            ? "near_upper"
            : "middle",
      volumeStatus: indicators.volumeProfile.trend,
    });
  }

  // Signal type distribution
  const signalsByType: Record<string, number> = {};
  for (const s of allSignals) {
    signalsByType[s.type] = (signalsByType[s.type] ?? 0) + 1;
  }

  // Volatility index (average of all stock changes)
  const changes = marketData
    .filter((m) => m.change24h !== null)
    .map((m) => Math.abs(m.change24h!));
  const volatilityIndex =
    changes.length > 0
      ? round2(changes.reduce((s, c) => s + c, 0) / changes.length)
      : 0;

  // Trending stocks (most signals)
  const stockSignalCounts = new Map<
    string,
    { count: number; bullish: number; bearish: number; momentum: number }
  >();
  for (const s of allSignals) {
    const entry = stockSignalCounts.get(s.symbol) ?? {
      count: 0,
      bullish: 0,
      bearish: 0,
      momentum: 0,
    };
    entry.count++;
    if (s.direction === "bullish") entry.bullish++;
    if (s.direction === "bearish") entry.bearish++;
    entry.momentum = s.strength;
    stockSignalCounts.set(s.symbol, entry);
  }

  const trendingStocks: TrendingStock[] = Array.from(
    stockSignalCounts.entries(),
  )
    .map(([symbol, data]) => ({
      symbol,
      signalCount: data.count,
      dominantDirection: data.bullish > data.bearish ? "bullish" : "bearish",
      momentum: data.momentum,
    }))
    .sort((a, b) => b.signalCount - a.signalCount)
    .slice(0, 5);

  return {
    generatedAt: new Date().toISOString(),
    marketSentiment,
    totalSignals: allSignals.length,
    strongBuySignals,
    strongSellSignals,
    topOpportunities,
    topRisks,
    agentConsensus,
    technicalSummary,
    signalsByType,
    volatilityIndex,
    trendingStocks,
  };
}
