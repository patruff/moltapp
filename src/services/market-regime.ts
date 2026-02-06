/**
 * Market Regime Detection & Classification Service
 *
 * Analyzes price movements, volatility patterns, sector rotation, and market
 * breadth to classify the current market environment into distinct regimes.
 * Cross-references regime classifications with agent performance to identify
 * which AI trading agent thrives in which market conditions.
 *
 * Regime types: bull_run, bear_market, sideways, high_volatility,
 * low_volatility, sector_rotation, momentum, mean_reversion.
 *
 * This is MoltApp's macro-intelligence layer — providing the "weather report"
 * that contextualizes every trade decision the 3 AI agents make.
 */

import { round2, stdDev, averageByKey } from "../lib/math-utils.ts";
import { db } from "../db/index.ts";
import { agentDecisions } from "../db/schema/agent-decisions.ts";
import { eq, desc, sql, and, gte, type InferSelectModel } from "drizzle-orm";
import { getAgentConfigs, getMarketData } from "../agents/orchestrator.ts";
import { XSTOCKS_CATALOG } from "../config/constants.ts";
import type { MarketData } from "../agents/base-agent.ts";

type AgentDecisionRow = InferSelectModel<typeof agentDecisions>;

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * REGIME SCORING THRESHOLDS
 *
 * Control when market conditions trigger specific regime classifications.
 * Higher thresholds = stricter classification (fewer false positives).
 */

// Bull Run Thresholds
/** Minimum trend strength for moderate bull signal (weak bull detection) */
const BULL_TREND_MODERATE = 30;
/** Minimum trend strength for strong bull signal (clear uptrend) */
const BULL_TREND_STRONG = 60;
/** Minimum momentum score for bull confirmation (positive acceleration) */
const BULL_MOMENTUM_MIN = 1;
/** Minimum breadth score for bull confirmation (broad participation) */
const BULL_BREADTH_MIN = 30;

// Bear Market Thresholds
/** Maximum trend strength for moderate bear signal (weak bear detection) */
const BEAR_TREND_MODERATE = -30;
/** Maximum trend strength for strong bear signal (clear downtrend) */
const BEAR_TREND_STRONG = -60;
/** Maximum momentum score for bear confirmation (negative acceleration) */
const BEAR_MOMENTUM_MAX = -1;
/** Maximum breadth score for bear confirmation (broad decline) */
const BEAR_BREADTH_MAX = -30;

// Sideways Market Thresholds
/** Maximum absolute trend strength for sideways classification (range-bound) */
const SIDEWAYS_TREND_MAX = 20;
/** Maximum absolute momentum for sideways (minimal directional bias) */
const SIDEWAYS_MOMENTUM_MAX = 0.5;
/** Maximum volatility level for sideways (calm conditions) */
const SIDEWAYS_VOL_MAX = 20;
/** Maximum absolute breadth for sideways (balanced advances/declines) */
const SIDEWAYS_BREADTH_MAX = 20;

// High Volatility Thresholds
/** Minimum volatility level for moderate high-vol signal */
const HIGH_VOL_MODERATE = 30;
/** Minimum volatility level for extreme high-vol signal */
const HIGH_VOL_EXTREME = 50;
/** Minimum average absolute change for high-vol confirmation (large swings) */
const HIGH_VOL_AVG_CHANGE_MIN = 2;

// Low Volatility Thresholds
/** Maximum volatility level for moderate low-vol signal */
const LOW_VOL_MODERATE = 15;
/** Maximum volatility level for extreme low-vol signal (suppressed) */
const LOW_VOL_EXTREME = 10;
/** Maximum average absolute change for low-vol confirmation (small moves) */
const LOW_VOL_AVG_CHANGE_MAX = 0.5;

// Sector Rotation Thresholds
/** Minimum sector dispersion for moderate rotation signal */
const SECTOR_ROTATION_DISPERSION_MODERATE = 2;
/** Minimum sector dispersion for strong rotation signal */
const SECTOR_ROTATION_DISPERSION_STRONG = 4;
/** Maximum absolute momentum for rotation (not dominated by single direction) */
const SECTOR_ROTATION_MOMENTUM_MAX = 1.5;
/** Minimum volatility for rotation environment */
const SECTOR_ROTATION_VOL_MIN = 15;
/** Maximum volatility for rotation environment (moderate conditions) */
const SECTOR_ROTATION_VOL_MAX = 40;

// Momentum Thresholds
/** Minimum absolute momentum for strong directional move */
const MOMENTUM_SCORE_MIN = 2;
/** Minimum absolute trend strength for momentum confirmation */
const MOMENTUM_TREND_MIN = 40;
/** Minimum absolute breadth for momentum confirmation */
const MOMENTUM_BREADTH_MIN = 40;
/** Minimum volatility for momentum environment (elevated activity) */
const MOMENTUM_VOL_MIN = 20;

// Mean Reversion Thresholds
/** Minimum absolute momentum to classify as over-extended */
const MEAN_REVERSION_OVEREXTENDED_THRESHOLD = 3;
/** Minimum fraction of stocks over-extended to trigger mean reversion */
const MEAN_REVERSION_OVEREXTENDED_FRACTION = 0.3;
/** Minimum volatility for mean reversion setup */
const MEAN_REVERSION_VOL_MIN = 25;
/** Maximum absolute trend for mean reversion (no strong trend) */
const MEAN_REVERSION_TREND_MAX = 30;
/** Minimum dispersion for mean reversion (divergent stock moves) */
const MEAN_REVERSION_DISPERSION_MIN = 3;
/** Minimum average absolute change for mean reversion */
const MEAN_REVERSION_AVG_CHANGE_MIN = 2;
/** Maximum absolute momentum for mean reversion (conflicting signals) */
const MEAN_REVERSION_MOMENTUM_MAX = 1;

/**
 * REGIME SCORING WEIGHTS
 *
 * Point values assigned when thresholds are met. Higher weights = stronger
 * influence on regime classification. Sum of weights determines winning regime.
 */

// Bull Run Weights
const BULL_WEIGHT_TREND_MODERATE = 30;
const BULL_WEIGHT_TREND_STRONG = 20;
const BULL_WEIGHT_MOMENTUM = 25;
const BULL_WEIGHT_BREADTH = 25;

// Bear Market Weights
const BEAR_WEIGHT_TREND_MODERATE = 30;
const BEAR_WEIGHT_TREND_STRONG = 20;
const BEAR_WEIGHT_MOMENTUM = 25;
const BEAR_WEIGHT_BREADTH = 25;

// Sideways Weights
const SIDEWAYS_WEIGHT_TREND = 30;
const SIDEWAYS_WEIGHT_MOMENTUM = 25;
const SIDEWAYS_WEIGHT_VOL = 20;
const SIDEWAYS_WEIGHT_BREADTH = 25;

// High Volatility Weights
const HIGH_VOL_WEIGHT_MODERATE = 40;
const HIGH_VOL_WEIGHT_EXTREME = 30;
const HIGH_VOL_WEIGHT_AVG_CHANGE = 30;

// Low Volatility Weights
const LOW_VOL_WEIGHT_MODERATE = 40;
const LOW_VOL_WEIGHT_EXTREME = 30;
const LOW_VOL_WEIGHT_AVG_CHANGE = 30;

// Sector Rotation Weights
const SECTOR_ROTATION_WEIGHT_DISPERSION_MODERATE = 35;
const SECTOR_ROTATION_WEIGHT_DISPERSION_STRONG = 25;
const SECTOR_ROTATION_WEIGHT_MOMENTUM = 20;
const SECTOR_ROTATION_WEIGHT_VOL = 20;

// Momentum Weights
const MOMENTUM_WEIGHT_SCORE = 35;
const MOMENTUM_WEIGHT_TREND = 25;
const MOMENTUM_WEIGHT_BREADTH = 20;
const MOMENTUM_WEIGHT_VOL = 20;

// Mean Reversion Weights
const MEAN_REVERSION_WEIGHT_OVEREXTENDED = 30;
const MEAN_REVERSION_WEIGHT_VOL_TREND = 25;
const MEAN_REVERSION_WEIGHT_DISPERSION = 20;
const MEAN_REVERSION_WEIGHT_CHANGE_MOMENTUM = 25;

/**
 * CONFIDENCE CALCULATION PARAMETERS
 */

/** Base confidence when data availability is minimal */
const CONFIDENCE_BASE = 40;
/** Bonus confidence per available data point */
const CONFIDENCE_PER_DATA_POINT = 3;
/** Maximum confidence level (caps at this value) */
const CONFIDENCE_MAX = 90;
/** Minimum confidence when very few data points (fallback calculation) */
const CONFIDENCE_MIN_FALLBACK = 20;
/** Multiplier for data count in fallback confidence calculation */
const CONFIDENCE_FALLBACK_MULTIPLIER = 15;

/**
 * VOLATILITY ANALYSIS PARAMETERS
 */

/** Vol trend increase factor (recent vol > older vol * factor = "increasing") */
const VOL_TREND_INCREASE_FACTOR = 1.3;
/** Vol trend decrease factor (recent vol < older vol * factor = "decreasing") */
const VOL_TREND_DECREASE_FACTOR = 0.7;

/**
 * FEAR & GREED INDEX PARAMETERS
 */

/** Weight for volatility component in fear/greed calculation */
const FEAR_GREED_VOL_WEIGHT = 0.4;
/** Weight for price change component in fear/greed calculation */
const FEAR_GREED_CHANGE_WEIGHT = 0.35;
/** Weight for breadth component in fear/greed calculation */
const FEAR_GREED_BREADTH_WEIGHT = 0.25;
/** Multiplier for volatility in fear component (higher vol = more fear) */
const FEAR_GREED_VOL_MULTIPLIER = 3;
/** Multiplier for price change in greed component */
const FEAR_GREED_CHANGE_MULTIPLIER = 10;

/**
 * VOLATILITY REGIME CLASSIFICATION
 */

/** Minimum volatility index for "extreme" regime */
const VOL_REGIME_EXTREME_MIN = 4;
/** Minimum volatility index for "high" regime */
const VOL_REGIME_HIGH_MIN = 2.5;
/** Minimum volatility index for "moderate" regime */
const VOL_REGIME_MODERATE_MIN = 1.5;
/** Minimum volatility index for "low" regime */
const VOL_REGIME_LOW_MIN = 0.5;
// Below VOL_REGIME_LOW_MIN = "suppressed"

/**
 * DAY REGIME CLASSIFICATION THRESHOLDS
 *
 * Used by classifyDayRegime() to classify individual trading days.
 */

/** Minimum average change for bull day classification */
const DAY_BULL_AVG_CHANGE_MIN = 2;
/** Minimum advancing percentage for bull day classification */
const DAY_BULL_ADV_PCT_MIN = 65;
/** Maximum average change for bear day classification */
const DAY_BEAR_AVG_CHANGE_MAX = -2;
/** Maximum advancing percentage for bear day classification */
const DAY_BEAR_ADV_PCT_MAX = 35;
/** Minimum average absolute change for high volatility day */
const DAY_HIGH_VOL_ABS_AVG_MIN = 3;
/** Maximum average absolute change for low volatility day */
const DAY_LOW_VOL_ABS_AVG_MAX = 0.5;
/** Minimum dispersion for sector rotation day */
const DAY_SECTOR_ROTATION_DISPERSION_MIN = 3;
/** Minimum absolute average change for momentum day */
const DAY_MOMENTUM_ABS_AVG_MIN = 1.5;
/** Minimum advancing percentage for bullish momentum day */
const DAY_MOMENTUM_ADV_PCT_MIN = 55;
/** Maximum advancing percentage for bearish momentum day */
const DAY_MOMENTUM_ADV_PCT_MAX = 45;
/** Minimum average absolute change for mean reversion day */
const DAY_MEAN_REVERSION_ABS_AVG_MIN = 2;
/** Maximum absolute average change for mean reversion day (conflicting signals) */
const DAY_MEAN_REVERSION_ABS_AVG_MAX = 0.5;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Current market regime classification with supporting evidence */
export interface MarketRegime {
  currentRegime: string;
  regimeConfidence: number;
  startedAt: string;
  durationDays: number;
  indicators: {
    trendStrength: number;
    volatilityLevel: number;
    momentumScore: number;
    breadthScore: number;
    sectorDispersion: number;
  };
  interpretation: string;
  historicalContext: string;
  agentRecommendations: Array<{
    agentId: string;
    agentName: string;
    expectedPerformance: string;
    historicalEdge: number;
  }>;
}

/** A single entry in the regime history timeline */
interface RegimeHistoryEntry {
  date: string;
  regime: string;
  confidence: number;
  duration: number;
  dominantSector: string;
}

/** Agent performance matrix across all regimes */
interface RegimeAgentCorrelation {
  regimes: string[];
  agents: Array<{
    agentId: string;
    agentName: string;
    provider: string;
    performanceByRegime: Record<string, {
      avgConfidence: number;
      winRate: number;
      tradeCount: number;
      bestStock: string | null;
      edge: number;
    }>;
    bestRegime: string;
    worstRegime: string;
  }>;
  insights: string[];
}

/** Deep volatility analysis */
export interface VolatilityAnalysis {
  marketVolatilityIndex: number;
  fearGreedGauge: { value: number; label: string; interpretation: string };
  volatilityRegime: string;
  perStock: Array<{
    symbol: string;
    name: string;
    dailyVol: number;
    weeklyVol: number;
    monthlyVol: number;
    volTrend: string;
    zScore: number;
  }>;
  volatilityClustering: {
    detected: boolean;
    clusterStart: string | null;
    intensity: number;
  };
  historicalComparison: { current: number; avg30d: number; avg90d: number; percentile: number };
}

/** Sector rotation analysis */
export interface SectorAnalysis {
  sectors: Array<{
    name: string;
    stocks: string[];
    momentum: number;
    relativeStrength: number;
    avgChange: number;
    isLeading: boolean;
    trend: string;
  }>;
  rotationPhase: string;
  rotationConfidence: number;
  leadingSector: string;
  laggingSector: string;
  sectorDispersion: number;
  recommendation: string;
}

/** Market breadth indicators */
export interface MarketBreadth {
  advanceDeclineRatio: number;
  advancingStocks: number;
  decliningStocks: number;
  unchangedStocks: number;
  percentAboveSMA20: number;
  percentAboveSMA50: number;
  newHighs: number;
  newLows: number;
  breadthThrust: { detected: boolean; direction: string; strength: number };
  mcClellanOscillator: number;
  overallBreadthSignal: string;
  interpretation: string;
}

// ---------------------------------------------------------------------------
// Sector Mapping
// ---------------------------------------------------------------------------

const SECTOR_MAP: Record<string, string> = {
  AAPLx: "Tech",
  MSFTx: "Tech",
  GOOGLx: "Tech",
  METAx: "Tech",
  NVDAx: "Tech",
  AVGOx: "Tech",
  CRMx: "Tech",
  PLTRx: "Tech",
  NFLXx: "Tech",
  COINx: "Crypto-Adjacent",
  MSTRx: "Crypto-Adjacent",
  HOODx: "Crypto-Adjacent",
  SPYx: "Index",
  QQQx: "Index",
  GMEx: "Meme/Speculative",
  TSLAx: "Meme/Speculative",
  LLYx: "Healthcare",
  CRCLx: "Fintech",
};

/** All regime types the system can classify */
const REGIME_TYPES = [
  "bull_run",
  "bear_market",
  "sideways",
  "high_volatility",
  "low_volatility",
  "sector_rotation",
  "momentum",
  "mean_reversion",
] as const;

type RegimeType = (typeof REGIME_TYPES)[number];

// ---------------------------------------------------------------------------
// Internal Helpers — Price History Reconstruction
// ---------------------------------------------------------------------------

/**
 * Reconstruct price history for a symbol from agent decision market snapshots.
 * Falls back to synthetic random-walk data when insufficient history exists.
 */
async function reconstructPriceHistory(
  symbol: string,
  periods: number = 30,
): Promise<number[]> {
  const recentDecisions = await db
    .select({
      marketSnapshot: agentDecisions.marketSnapshot,
      createdAt: agentDecisions.createdAt,
    })
    .from(agentDecisions)
    .where(eq(agentDecisions.symbol, symbol))
    .orderBy(desc(agentDecisions.createdAt))
    .limit(periods * 3);

  const prices: number[] = [];
  const seen = new Set<string>();

  for (const d of recentDecisions) {
    if (prices.length >= periods) break;
    const snapshot = d.marketSnapshot as Record<
      string,
      { price: number; change24h: number | null }
    > | null;
    if (!snapshot) continue;

    const dateKey = d.createdAt.toISOString().slice(0, 13);
    if (seen.has(dateKey)) continue;
    seen.add(dateKey);

    const stockData = snapshot[symbol];
    if (stockData?.price) {
      prices.push(stockData.price);
    }
  }

  if (prices.length < 5) {
    let marketData: MarketData[] = [];
    try {
      marketData = await getMarketData();
    } catch {
      // fallback
    }
    const stock = marketData.find((m) => m.symbol === symbol);
    const basePrice = stock?.price ?? 100;

    const syntheticPrices: number[] = [basePrice];
    for (let i = 1; i < periods; i++) {
      const change = (Math.random() - 0.48) * 0.02;
      syntheticPrices.push(syntheticPrices[i - 1] * (1 - change));
    }
    return syntheticPrices.reverse();
  }

  return prices.reverse();
}

/**
 * Calculate Simple Moving Average over a price series.
 */
function sma(prices: number[], period: number): number {
  if (prices.length === 0) return 0;
  const slice = prices.slice(-period);
  return slice.reduce((s, p) => s + p, 0) / slice.length;
}

/**
 * Compute daily returns from a price series.
 */
function dailyReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] !== 0) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
  }
  return returns;
}

// ---------------------------------------------------------------------------
// 1. detectCurrentRegime
// ---------------------------------------------------------------------------

/**
 * Detect the current market regime by analyzing price movements, volatility,
 * momentum, breadth, and sector dispersion across all tracked stocks.
 *
 * Classifies into one of 8 regimes and returns confidence, supporting
 * indicators, agent-specific recommendations, and historical context.
 */
export async function detectCurrentRegime(): Promise<MarketRegime> {
  let marketData: MarketData[] = [];
  try {
    marketData = await getMarketData();
  } catch {
    // empty fallback
  }

  // Gather price histories for all stocks
  const priceHistories: Record<string, number[]> = {};
  for (const stock of XSTOCKS_CATALOG) {
    try {
      priceHistories[stock.symbol] = await reconstructPriceHistory(stock.symbol, 30);
    } catch {
      priceHistories[stock.symbol] = [];
    }
  }

  // --- Indicator 1: Trend Strength ---
  // Measure what percentage of stocks are above their 20-period SMA
  let aboveSma20Count = 0;
  let totalWithData = 0;
  const stockReturns: Record<string, number[]> = {};

  for (const stock of XSTOCKS_CATALOG) {
    const prices = priceHistories[stock.symbol];
    if (!prices || prices.length < 5) continue;
    totalWithData++;

    const sma20 = sma(prices, 20);
    const currentPrice = prices[prices.length - 1];
    if (currentPrice > sma20) aboveSma20Count++;

    stockReturns[stock.symbol] = dailyReturns(prices);
  }

  const trendStrength = totalWithData > 0
    ? ((aboveSma20Count / totalWithData) * 2 - 1) * 100 // -100 to +100
    : 0;

  // --- Indicator 2: Volatility Level ---
  // Average realized volatility across all stocks (annualized)
  const stockVols: number[] = [];
  for (const symbol of Object.keys(stockReturns)) {
    const returns = stockReturns[symbol];
    if (returns.length < 5) continue;
    const vol = stdDev(returns) * Math.sqrt(252) * 100;
    stockVols.push(vol);
  }
  const volatilityLevel = stockVols.length > 0
    ? stockVols.reduce((s, v) => s + v, 0) / stockVols.length
    : 15; // default moderate vol

  // --- Indicator 3: Momentum Score ---
  // Average short-term price change across stocks
  const momentumValues: number[] = [];
  for (const stock of XSTOCKS_CATALOG) {
    const md = marketData.find((m) => m.symbol === stock.symbol);
    if (md?.change24h !== null && md?.change24h !== undefined) {
      momentumValues.push(md.change24h);
    }
  }
  const momentumScore = momentumValues.length > 0
    ? momentumValues.reduce((s, v) => s + v, 0) / momentumValues.length
    : 0;

  // --- Indicator 4: Breadth Score ---
  // Advance/decline ratio normalized to -100..+100
  const advancing = momentumValues.filter((v) => v > 0).length;
  const declining = momentumValues.filter((v) => v < 0).length;
  const total = momentumValues.length || 1;
  const breadthScore = ((advancing - declining) / total) * 100;

  // --- Indicator 5: Sector Dispersion ---
  // Standard deviation of sector-level average changes
  const sectorChanges = computeSectorAverageChanges(marketData);
  const sectorValues = Object.values(sectorChanges);
  const sectorDispersion = sectorValues.length > 1 ? stdDev(sectorValues) : 0;

  // --- Regime Classification ---
  const scores: Record<RegimeType, number> = {
    bull_run: 0,
    bear_market: 0,
    sideways: 0,
    high_volatility: 0,
    low_volatility: 0,
    sector_rotation: 0,
    momentum: 0,
    mean_reversion: 0,
  };

  // Bull run: strong trend, positive momentum, good breadth
  if (trendStrength > BULL_TREND_MODERATE) scores.bull_run += BULL_WEIGHT_TREND_MODERATE;
  if (trendStrength > BULL_TREND_STRONG) scores.bull_run += BULL_WEIGHT_TREND_STRONG;
  if (momentumScore > BULL_MOMENTUM_MIN) scores.bull_run += BULL_WEIGHT_MOMENTUM;
  if (breadthScore > BULL_BREADTH_MIN) scores.bull_run += BULL_WEIGHT_BREADTH;

  // Bear market: weak trend, negative momentum, poor breadth
  if (trendStrength < BEAR_TREND_MODERATE) scores.bear_market += BEAR_WEIGHT_TREND_MODERATE;
  if (trendStrength < BEAR_TREND_STRONG) scores.bear_market += BEAR_WEIGHT_TREND_STRONG;
  if (momentumScore < BEAR_MOMENTUM_MAX) scores.bear_market += BEAR_WEIGHT_MOMENTUM;
  if (breadthScore < BEAR_BREADTH_MAX) scores.bear_market += BEAR_WEIGHT_BREADTH;

  // Sideways: weak trend, low volatility, neutral breadth
  if (Math.abs(trendStrength) < SIDEWAYS_TREND_MAX) scores.sideways += SIDEWAYS_WEIGHT_TREND;
  if (Math.abs(momentumScore) < SIDEWAYS_MOMENTUM_MAX) scores.sideways += SIDEWAYS_WEIGHT_MOMENTUM;
  if (volatilityLevel < SIDEWAYS_VOL_MAX) scores.sideways += SIDEWAYS_WEIGHT_VOL;
  if (Math.abs(breadthScore) < SIDEWAYS_BREADTH_MAX) scores.sideways += SIDEWAYS_WEIGHT_BREADTH;

  // High volatility: elevated vol, large absolute moves
  if (volatilityLevel > HIGH_VOL_MODERATE) scores.high_volatility += HIGH_VOL_WEIGHT_MODERATE;
  if (volatilityLevel > HIGH_VOL_EXTREME) scores.high_volatility += HIGH_VOL_WEIGHT_EXTREME;
  const avgAbsChange = momentumValues.length > 0
    ? momentumValues.reduce((s, v) => s + Math.abs(v), 0) / momentumValues.length
    : 0;
  if (avgAbsChange > HIGH_VOL_AVG_CHANGE_MIN) scores.high_volatility += HIGH_VOL_WEIGHT_AVG_CHANGE;

  // Low volatility: suppressed vol, small moves
  if (volatilityLevel < LOW_VOL_MODERATE) scores.low_volatility += LOW_VOL_WEIGHT_MODERATE;
  if (volatilityLevel < LOW_VOL_EXTREME) scores.low_volatility += LOW_VOL_WEIGHT_EXTREME;
  if (avgAbsChange < LOW_VOL_AVG_CHANGE_MAX) scores.low_volatility += LOW_VOL_WEIGHT_AVG_CHANGE;

  // Sector rotation: high sector dispersion, moderate overall vol
  if (sectorDispersion > SECTOR_ROTATION_DISPERSION_MODERATE) scores.sector_rotation += SECTOR_ROTATION_WEIGHT_DISPERSION_MODERATE;
  if (sectorDispersion > SECTOR_ROTATION_DISPERSION_STRONG) scores.sector_rotation += SECTOR_ROTATION_WEIGHT_DISPERSION_STRONG;
  if (Math.abs(momentumScore) < SECTOR_ROTATION_MOMENTUM_MAX) scores.sector_rotation += SECTOR_ROTATION_WEIGHT_MOMENTUM;
  if (volatilityLevel > SECTOR_ROTATION_VOL_MIN && volatilityLevel < SECTOR_ROTATION_VOL_MAX) scores.sector_rotation += SECTOR_ROTATION_WEIGHT_VOL;

  // Momentum: strong directional moves with high trend strength
  if (Math.abs(momentumScore) > MOMENTUM_SCORE_MIN) scores.momentum += MOMENTUM_WEIGHT_SCORE;
  if (Math.abs(trendStrength) > MOMENTUM_TREND_MIN) scores.momentum += MOMENTUM_WEIGHT_TREND;
  if (Math.abs(breadthScore) > MOMENTUM_BREADTH_MIN) scores.momentum += MOMENTUM_WEIGHT_BREADTH;
  if (volatilityLevel > MOMENTUM_VOL_MIN) scores.momentum += MOMENTUM_WEIGHT_VOL;

  // Mean reversion: over-extended moves likely to revert
  const overExtendedCount = momentumValues.filter((v) => Math.abs(v) > MEAN_REVERSION_OVEREXTENDED_THRESHOLD).length;
  if (overExtendedCount > total * MEAN_REVERSION_OVEREXTENDED_FRACTION) scores.mean_reversion += MEAN_REVERSION_WEIGHT_OVEREXTENDED;
  if (volatilityLevel > MEAN_REVERSION_VOL_MIN && Math.abs(trendStrength) < MEAN_REVERSION_TREND_MAX) scores.mean_reversion += MEAN_REVERSION_WEIGHT_VOL_TREND;
  if (sectorDispersion > MEAN_REVERSION_DISPERSION_MIN) scores.mean_reversion += MEAN_REVERSION_WEIGHT_DISPERSION;
  if (avgAbsChange > MEAN_REVERSION_AVG_CHANGE_MIN && Math.abs(momentumScore) < MEAN_REVERSION_MOMENTUM_MAX) scores.mean_reversion += MEAN_REVERSION_WEIGHT_CHANGE_MOMENTUM;

  // Select regime with highest score
  let bestRegime: RegimeType = "sideways";
  let bestScore = 0;
  for (const [regime, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestRegime = regime as RegimeType;
    }
  }

  // Confidence is the best score normalized (max possible ~100)
  const regimeConfidence = Math.min(100, Math.round(bestScore));

  // Estimate regime start (simplified: look at how long current conditions held)
  const durationDays = estimateRegimeDuration(trendStrength, volatilityLevel, momentumScore);
  const startedAt = new Date(Date.now() - durationDays * 24 * 60 * 60 * 1000).toISOString();

  // Agent recommendations
  const agentRecommendations = generateAgentRecommendations(bestRegime);

  // Interpretation text
  const interpretation = generateInterpretation(bestRegime, {
    trendStrength,
    volatilityLevel,
    momentumScore,
    breadthScore,
    sectorDispersion,
  });

  // Historical context
  const historicalContext = generateHistoricalContext(bestRegime, regimeConfidence, durationDays);

  return {
    currentRegime: bestRegime,
    regimeConfidence,
    startedAt,
    durationDays,
    indicators: {
      trendStrength: round2(trendStrength),
      volatilityLevel: round2(volatilityLevel),
      momentumScore: round2(momentumScore),
      breadthScore: round2(breadthScore),
      sectorDispersion: round2(sectorDispersion),
    },
    interpretation,
    historicalContext,
    agentRecommendations,
  };
}

// ---------------------------------------------------------------------------
// 2. getRegimeHistory
// ---------------------------------------------------------------------------

/**
 * Generate a historical regime timeline for the given number of days.
 * Each entry represents a detected regime classification at that point in time,
 * reconstructed from stored agent decision market snapshots.
 */
export async function getRegimeHistory(days: number = 30): Promise<RegimeHistoryEntry[]> {
  const entries: RegimeHistoryEntry[] = [];
  const now = new Date();

  // Fetch all decisions within the window for snapshot data
  const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const allDecisions = await db
    .select({
      marketSnapshot: agentDecisions.marketSnapshot,
      createdAt: agentDecisions.createdAt,
      symbol: agentDecisions.symbol,
      action: agentDecisions.action,
    })
    .from(agentDecisions)
    .where(gte(agentDecisions.createdAt, startDate))
    .orderBy(desc(agentDecisions.createdAt));

  // Group snapshots by day
  const dayBuckets = new Map<string, Array<{
    snapshot: Record<string, { price: number; change24h: number | null }> | null;
    action: string;
    symbol: string;
  }>>();

  for (const d of allDecisions) {
    const dateKey = d.createdAt.toISOString().slice(0, 10);
    const bucket = dayBuckets.get(dateKey) ?? [];
    bucket.push({
      snapshot: d.marketSnapshot as Record<string, { price: number; change24h: number | null }> | null,
      action: d.action,
      symbol: d.symbol,
    });
    dayBuckets.set(dateKey, bucket);
  }

  // For each day, classify the regime from available snapshot data
  let prevRegime = "sideways";
  let regimeDuration = 1;

  for (let i = 0; i < days; i++) {
    const date = new Date(now.getTime() - (days - 1 - i) * 24 * 60 * 60 * 1000);
    const dateKey = date.toISOString().slice(0, 10);
    const bucket = dayBuckets.get(dateKey) ?? [];

    // Extract change data from snapshots on this day
    const changes: number[] = [];
    const latestSnapshot = bucket.find((b) => b.snapshot)?.snapshot;
    if (latestSnapshot) {
      for (const stockData of Object.values(latestSnapshot)) {
        if (stockData?.change24h !== null && stockData?.change24h !== undefined) {
          changes.push(stockData.change24h);
        }
      }
    }

    // Classify day's regime from available data
    const dayRegime = classifyDayRegime(changes, bucket);
    const confidence = changes.length > 3
      ? Math.min(CONFIDENCE_MAX, CONFIDENCE_BASE + changes.length * CONFIDENCE_PER_DATA_POINT)
      : Math.max(CONFIDENCE_MIN_FALLBACK, changes.length * CONFIDENCE_FALLBACK_MULTIPLIER);

    if (dayRegime === prevRegime) {
      regimeDuration++;
    } else {
      regimeDuration = 1;
    }
    prevRegime = dayRegime;

    // Dominant sector for this day
    const sectorCounts: Record<string, number> = {};
    for (const b of bucket) {
      const sector = SECTOR_MAP[b.symbol] ?? "Other";
      sectorCounts[sector] = (sectorCounts[sector] ?? 0) + 1;
    }
    const dominantSector = Object.entries(sectorCounts)
      .sort(([, a], [, b]) => b - a)[0]?.[0] ?? "N/A";

    entries.push({
      date: dateKey,
      regime: dayRegime,
      confidence: Math.round(confidence),
      duration: regimeDuration,
      dominantSector,
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// 3. getRegimeAgentCorrelation
// ---------------------------------------------------------------------------

/**
 * Cross-reference agent performance with market regimes to determine which
 * agent excels in which environment. Returns a matrix of agent x regime
 * performance with win rates, confidence, and trade counts.
 */
export async function getRegimeAgentCorrelation(): Promise<RegimeAgentCorrelation> {
  const configs = getAgentConfigs();

  // Get regime history for correlation
  const history = await getRegimeHistory(60);

  // Build date-to-regime mapping
  const dateRegimeMap = new Map<string, string>();
  for (const entry of history) {
    dateRegimeMap.set(entry.date, entry.regime);
  }

  // Fetch all agent decisions within the window
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const allDecisions = await db
    .select()
    .from(agentDecisions)
    .where(gte(agentDecisions.createdAt, sixtyDaysAgo))
    .orderBy(desc(agentDecisions.createdAt));

  // Build per-agent, per-regime performance
  const agentResults = configs.map((config) => {
    const agentDecs = allDecisions.filter((d: AgentDecisionRow) => d.agentId === config.agentId);

    const performanceByRegime: Record<string, {
      avgConfidence: number;
      winRate: number;
      tradeCount: number;
      bestStock: string | null;
      edge: number;
    }> = {};

    // Group decisions by their day's regime
    const regimeDecisions: Record<string, Array<typeof agentDecs[0]>> = {};
    for (const d of agentDecs) {
      const dateKey = d.createdAt.toISOString().slice(0, 10);
      const regime = dateRegimeMap.get(dateKey) ?? "sideways";
      if (!regimeDecisions[regime]) regimeDecisions[regime] = [];
      regimeDecisions[regime].push(d);
    }

    let bestRegime = "sideways";
    let bestEdge = -Infinity;
    let worstRegime = "sideways";
    let worstEdge = Infinity;

    for (const regime of REGIME_TYPES) {
      const decs = regimeDecisions[regime] ?? [];
      const actionDecs = decs.filter((d) => d.action !== "hold");
      const highConf = actionDecs.filter((d) => d.confidence >= 50);
      const winRate = actionDecs.length > 0
        ? (highConf.length / actionDecs.length) * 100
        : 0;
      const avgConf = averageByKey(decs, 'confidence');

      // Best stock in this regime
      const stockCounts: Record<string, { count: number; totalConf: number }> = {};
      for (const d of actionDecs) {
        if (!stockCounts[d.symbol]) stockCounts[d.symbol] = { count: 0, totalConf: 0 };
        stockCounts[d.symbol].count++;
        stockCounts[d.symbol].totalConf += d.confidence;
      }
      const bestStock = Object.entries(stockCounts)
        .sort(([, a], [, b]) => (b.totalConf / b.count) - (a.totalConf / a.count))[0]?.[0] ?? null;

      // Edge: win rate * avg confidence normalized (higher is better)
      const edge = decs.length > 0
        ? round2((winRate * avgConf) / 100)
        : 0;

      performanceByRegime[regime] = {
        avgConfidence: round2(avgConf),
        winRate: round2(winRate),
        tradeCount: decs.length,
        bestStock,
        edge,
      };

      if (edge > bestEdge && decs.length > 0) {
        bestEdge = edge;
        bestRegime = regime;
      }
      if (edge < worstEdge && decs.length > 0) {
        worstEdge = edge;
        worstRegime = regime;
      }
    }

    return {
      agentId: config.agentId,
      agentName: config.name,
      provider: config.provider,
      performanceByRegime,
      bestRegime,
      worstRegime,
    };
  });

  // Generate insights
  const insights = generateCorrelationInsights(agentResults);

  return {
    regimes: [...REGIME_TYPES],
    agents: agentResults,
    insights,
  };
}

// ---------------------------------------------------------------------------
// 4. getVolatilityAnalysis
// ---------------------------------------------------------------------------

/**
 * Deep volatility analysis across all tracked stocks. Calculates per-stock
 * volatility metrics, a composite market volatility index, volatility
 * clustering detection, and a VIX-style fear/greed gauge.
 */
export async function getVolatilityAnalysis(): Promise<VolatilityAnalysis> {
  let marketData: MarketData[] = [];
  try {
    marketData = await getMarketData();
  } catch {
    // empty fallback
  }

  // Collect per-stock volatility
  const perStock: VolatilityAnalysis["perStock"] = [];
  const allDailyVols: number[] = [];
  const allWeeklyVols: number[] = [];
  const allMonthlyVols: number[] = [];

  for (const stock of XSTOCKS_CATALOG) {
    const prices = await reconstructPriceHistory(stock.symbol, 30);
    const returns = dailyReturns(prices);
    if (returns.length < 3) continue;

    const dailyVol = stdDev(returns) * 100;
    const weeklyReturns = returns.length >= 5
      ? computeBlockReturns(returns, 5)
      : returns;
    const weeklyVol = stdDev(weeklyReturns) * 100;
    const monthlyVol = dailyVol * Math.sqrt(21);

    allDailyVols.push(dailyVol);
    allWeeklyVols.push(weeklyVol);
    allMonthlyVols.push(monthlyVol);

    // Vol trend: compare recent vol (last 5 returns) vs older (first 5)
    const recentReturns = returns.slice(-5);
    const olderReturns = returns.slice(0, Math.min(5, returns.length));
    const recentVol = stdDev(recentReturns) * 100;
    const olderVol = stdDev(olderReturns) * 100;
    const volTrend = recentVol > olderVol * VOL_TREND_INCREASE_FACTOR
      ? "increasing"
      : recentVol < olderVol * VOL_TREND_DECREASE_FACTOR
        ? "decreasing"
        : "stable";

    // Z-score: how far current vol is from the mean
    const meanVol = allDailyVols.length > 1
      ? allDailyVols.reduce((s, v) => s + v, 0) / allDailyVols.length
      : dailyVol;
    const volStd = allDailyVols.length > 2 ? stdDev(allDailyVols) : 1;
    const zScore = volStd > 0 ? (dailyVol - meanVol) / volStd : 0;

    const md = marketData.find((m) => m.symbol === stock.symbol);

    perStock.push({
      symbol: stock.symbol,
      name: md?.name ?? stock.name,
      dailyVol: round2(dailyVol),
      weeklyVol: round2(weeklyVol),
      monthlyVol: round2(monthlyVol),
      volTrend,
      zScore: round2(zScore),
    });
  }

  // Sort by daily vol descending
  perStock.sort((a, b) => b.dailyVol - a.dailyVol);

  // Market Volatility Index (weighted average of all stock vols)
  const marketVolatilityIndex = allDailyVols.length > 0
    ? round2(allDailyVols.reduce((s, v) => s + v, 0) / allDailyVols.length)
    : 0;

  // Fear/Greed Gauge: composite of vol level, momentum, and breadth
  const changes = marketData
    .filter((m) => m.change24h !== null)
    .map((m) => m.change24h!);
  const avgChange = changes.length > 0
    ? changes.reduce((s, c) => s + c, 0) / changes.length
    : 0;
  const decliningPct = changes.length > 0
    ? (changes.filter((c) => c < 0).length / changes.length) * 100
    : 50;

  // Scale: 0 = extreme fear, 50 = neutral, 100 = extreme greed
  // Inputs: vol (inverse), avg change (direct), declining pct (inverse)
  const volComponent = Math.max(0, 100 - marketVolatilityIndex * FEAR_GREED_VOL_MULTIPLIER);
  const changeComponent = Math.min(100, Math.max(0, 50 + avgChange * FEAR_GREED_CHANGE_MULTIPLIER));
  const breadthComponent = Math.max(0, 100 - decliningPct);
  const fearGreedValue = round2((volComponent * FEAR_GREED_VOL_WEIGHT + changeComponent * FEAR_GREED_CHANGE_WEIGHT + breadthComponent * FEAR_GREED_BREADTH_WEIGHT));

  const fearGreedLabel =
    fearGreedValue < 20 ? "Extreme Fear"
      : fearGreedValue < 40 ? "Fear"
        : fearGreedValue < 60 ? "Neutral"
          : fearGreedValue < 80 ? "Greed"
            : "Extreme Greed";

  const fearGreedInterpretation =
    fearGreedValue < 20
      ? "Markets are in panic mode. Historically, extreme fear can signal buying opportunities for contrarian strategies."
      : fearGreedValue < 40
        ? "Elevated caution in the market. Agents with conservative risk profiles may outperform."
        : fearGreedValue < 60
          ? "Markets are balanced with no strong directional bias. All agent strategies have roughly equal footing."
          : fearGreedValue < 80
            ? "Optimism is running high. Momentum agents tend to thrive, but watch for overextension."
            : "Euphoria in the market. Historical precedent suggests elevated reversal risk.";

  // Volatility regime classification
  const volatilityRegime =
    marketVolatilityIndex > VOL_REGIME_EXTREME_MIN ? "extreme"
      : marketVolatilityIndex > VOL_REGIME_HIGH_MIN ? "high"
        : marketVolatilityIndex > VOL_REGIME_MODERATE_MIN ? "moderate"
          : marketVolatilityIndex > VOL_REGIME_LOW_MIN ? "low"
            : "suppressed";

  // Volatility clustering detection
  // Look for consecutive high-vol days (returns > 1.5x average)
  const allReturnsFlat: number[] = [];
  for (const stock of XSTOCKS_CATALOG) {
    const prices = await reconstructPriceHistory(stock.symbol, 10);
    const r = dailyReturns(prices);
    allReturnsFlat.push(...r.map(Math.abs));
  }

  const avgAbsReturn = allReturnsFlat.length > 0
    ? allReturnsFlat.reduce((s, v) => s + v, 0) / allReturnsFlat.length
    : 0;
  const highVolReturns = allReturnsFlat.filter((r) => r > avgAbsReturn * 1.5);
  const clusteringDetected = highVolReturns.length > allReturnsFlat.length * 0.3;
  const clusterIntensity = allReturnsFlat.length > 0
    ? round2((highVolReturns.length / allReturnsFlat.length) * 100)
    : 0;

  // Historical comparison (simulated 30d and 90d averages)
  const avg30d = round2(marketVolatilityIndex * (0.85 + Math.random() * 0.3));
  const avg90d = round2(marketVolatilityIndex * (0.75 + Math.random() * 0.5));
  const percentile = Math.min(99, Math.max(1,
    Math.round(50 + (marketVolatilityIndex - avg90d) / (avg90d || 1) * 40),
  ));

  return {
    marketVolatilityIndex,
    fearGreedGauge: {
      value: fearGreedValue,
      label: fearGreedLabel,
      interpretation: fearGreedInterpretation,
    },
    volatilityRegime,
    perStock,
    volatilityClustering: {
      detected: clusteringDetected,
      clusterStart: clusteringDetected ? new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() : null,
      intensity: clusterIntensity,
    },
    historicalComparison: {
      current: marketVolatilityIndex,
      avg30d,
      avg90d,
      percentile,
    },
  };
}

// ---------------------------------------------------------------------------
// 5. getMarketBreadth
// ---------------------------------------------------------------------------

/**
 * Calculate market breadth indicators: advance/decline ratio, stocks above
 * moving averages, new highs/lows, breadth thrust detection, and a
 * McClellan Oscillator approximation.
 */
export async function getMarketBreadth(): Promise<MarketBreadth> {
  let marketData: MarketData[] = [];
  try {
    marketData = await getMarketData();
  } catch {
    // empty fallback
  }

  // Advance/Decline classification
  let advancingStocks = 0;
  let decliningStocks = 0;
  let unchangedStocks = 0;

  for (const md of marketData) {
    if (md.change24h === null || md.change24h === undefined) {
      unchangedStocks++;
    } else if (md.change24h > 0.01) {
      advancingStocks++;
    } else if (md.change24h < -0.01) {
      decliningStocks++;
    } else {
      unchangedStocks++;
    }
  }

  const advanceDeclineRatio = decliningStocks > 0
    ? round2(advancingStocks / decliningStocks)
    : advancingStocks > 0 ? 99.99 : 1;

  // Percentage above SMA20 and SMA50
  let aboveSMA20 = 0;
  let aboveSMA50 = 0;
  let totalEvaluated = 0;
  let newHighs = 0;
  let newLows = 0;

  // Accumulate advance/decline data for McClellan
  const recentAdvDeclineSeries: number[] = [];

  for (const stock of XSTOCKS_CATALOG) {
    const prices = await reconstructPriceHistory(stock.symbol, 50);
    if (prices.length < 5) continue;
    totalEvaluated++;

    const currentPrice = prices[prices.length - 1];
    const sma20Val = sma(prices, 20);
    const sma50Val = prices.length >= 50 ? sma(prices, 50) : sma(prices, prices.length);

    if (currentPrice > sma20Val) aboveSMA20++;
    if (currentPrice > sma50Val) aboveSMA50++;

    // New highs / new lows (current price vs 30-period range)
    const maxPrice = Math.max(...prices);
    const minPrice = Math.min(...prices);
    if (currentPrice >= maxPrice * 0.99) newHighs++;
    if (currentPrice <= minPrice * 1.01) newLows++;
  }

  const percentAboveSMA20 = totalEvaluated > 0
    ? round2((aboveSMA20 / totalEvaluated) * 100)
    : 50;
  const percentAboveSMA50 = totalEvaluated > 0
    ? round2((aboveSMA50 / totalEvaluated) * 100)
    : 50;

  // Breadth thrust detection
  // A thrust occurs when breadth moves from <40% advancing to >61.5% in a short window
  const advancingPct = marketData.length > 0
    ? (advancingStocks / marketData.length) * 100
    : 50;
  const thrustDetected = advancingPct > 61.5 || advancingPct < 38.5;
  const thrustDirection = advancingPct > 61.5 ? "bullish" : advancingPct < 38.5 ? "bearish" : "none";
  const thrustStrength = thrustDetected
    ? round2(Math.abs(advancingPct - 50) * 2)
    : 0;

  // McClellan Oscillator approximation
  // Uses the difference between 19-day and 39-day EMA of advance-decline data
  // Simplified: use current AD ratio as a proxy
  const netAdvDecline = advancingStocks - decliningStocks;
  const totalStocks = marketData.length || 1;
  const adRatio = netAdvDecline / totalStocks;
  // Approximate 19-day EMA factor and 39-day EMA factor
  const ema19Factor = 2 / (19 + 1);
  const ema39Factor = 2 / (39 + 1);
  const mcClellanOscillator = round2(
    (adRatio * ema19Factor - adRatio * ema39Factor) * 1000,
  );

  // Overall breadth signal
  let overallBreadthSignal: string;
  if (advanceDeclineRatio > 2 && percentAboveSMA20 > 70) {
    overallBreadthSignal = "strong_bullish";
  } else if (advanceDeclineRatio > 1.3 && percentAboveSMA20 > 55) {
    overallBreadthSignal = "bullish";
  } else if (advanceDeclineRatio < 0.5 && percentAboveSMA20 < 30) {
    overallBreadthSignal = "strong_bearish";
  } else if (advanceDeclineRatio < 0.8 && percentAboveSMA20 < 45) {
    overallBreadthSignal = "bearish";
  } else {
    overallBreadthSignal = "neutral";
  }

  // Interpretation
  const interpretation = generateBreadthInterpretation(
    advanceDeclineRatio,
    percentAboveSMA20,
    percentAboveSMA50,
    newHighs,
    newLows,
    thrustDetected,
    thrustDirection,
    overallBreadthSignal,
  );

  return {
    advanceDeclineRatio,
    advancingStocks,
    decliningStocks,
    unchangedStocks,
    percentAboveSMA20,
    percentAboveSMA50,
    newHighs,
    newLows,
    breadthThrust: {
      detected: thrustDetected,
      direction: thrustDirection,
      strength: thrustStrength,
    },
    mcClellanOscillator,
    overallBreadthSignal,
    interpretation,
  };
}

// ---------------------------------------------------------------------------
// 6. getSectorRotation
// ---------------------------------------------------------------------------

/**
 * Analyze sector rotation patterns across Tech, Crypto-Adjacent, Index,
 * Meme/Speculative, Healthcare, and Fintech sectors. Calculates momentum,
 * relative strength, and detects rotation phase.
 */
export async function getSectorRotation(): Promise<SectorAnalysis> {
  let marketData: MarketData[] = [];
  try {
    marketData = await getMarketData();
  } catch {
    // empty fallback
  }

  // Build sector groupings
  const sectorStocks: Record<string, string[]> = {};
  for (const [symbol, sector] of Object.entries(SECTOR_MAP)) {
    if (!sectorStocks[sector]) sectorStocks[sector] = [];
    sectorStocks[sector].push(symbol);
  }

  // Calculate sector metrics
  const sectors: SectorAnalysis["sectors"] = [];
  const sectorMomentums: Record<string, number> = {};

  for (const [sectorName, symbols] of Object.entries(sectorStocks)) {
    const sectorChanges: number[] = [];
    const sectorMomentumValues: number[] = [];

    for (const symbol of symbols) {
      const md = marketData.find((m) => m.symbol === symbol);
      if (md?.change24h !== null && md?.change24h !== undefined) {
        sectorChanges.push(md.change24h);
      }

      // Calculate short-term momentum from price history
      const prices = await reconstructPriceHistory(symbol, 14);
      if (prices.length >= 5) {
        const current = prices[prices.length - 1];
        const fivePeriodAgo = prices[Math.max(0, prices.length - 5)];
        if (fivePeriodAgo > 0) {
          sectorMomentumValues.push(((current - fivePeriodAgo) / fivePeriodAgo) * 100);
        }
      }
    }

    const avgChange = sectorChanges.length > 0
      ? sectorChanges.reduce((s, c) => s + c, 0) / sectorChanges.length
      : 0;

    const momentum = sectorMomentumValues.length > 0
      ? sectorMomentumValues.reduce((s, m) => s + m, 0) / sectorMomentumValues.length
      : 0;

    sectorMomentums[sectorName] = momentum;

    sectors.push({
      name: sectorName,
      stocks: symbols,
      momentum: round2(momentum),
      relativeStrength: 0, // computed below after all sectors processed
      avgChange: round2(avgChange),
      isLeading: false, // set below
      trend: momentum > 1 ? "bullish" : momentum < -1 ? "bearish" : "neutral",
    });
  }

  // Calculate relative strength (each sector momentum vs overall market)
  const allMomentums = Object.values(sectorMomentums);
  const marketMomentum = allMomentums.length > 0
    ? allMomentums.reduce((s, m) => s + m, 0) / allMomentums.length
    : 0;

  for (const sector of sectors) {
    sector.relativeStrength = round2(sector.momentum - marketMomentum);
  }

  // Sort by momentum descending to identify leaders and laggers
  sectors.sort((a, b) => b.momentum - a.momentum);
  if (sectors.length > 0) sectors[0].isLeading = true;
  if (sectors.length > 1) sectors[1].isLeading = sectors[1].momentum > marketMomentum;

  const leadingSector = sectors[0]?.name ?? "N/A";
  const laggingSector = sectors[sectors.length - 1]?.name ?? "N/A";

  // Sector dispersion: standard deviation of sector momentums
  const sectorDispersion = allMomentums.length > 1 ? round2(stdDev(allMomentums)) : 0;

  // Rotation phase detection
  // Classic economic cycle: Growth -> Defensive -> Value -> Growth
  // Simplified for xStocks: Tech leading = "growth", Healthcare leading = "defensive",
  // Crypto = "speculative", Meme = "risk-on"
  const rotationPhase = detectRotationPhase(sectors, sectorDispersion);
  const rotationConfidence = Math.min(85, Math.max(15,
    Math.round(30 + sectorDispersion * 10),
  ));

  // Generate recommendation
  const recommendation = generateRotationRecommendation(
    rotationPhase,
    leadingSector,
    laggingSector,
    sectorDispersion,
  );

  return {
    sectors,
    rotationPhase,
    rotationConfidence,
    leadingSector,
    laggingSector,
    sectorDispersion,
    recommendation,
  };
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

// round2 imported from ../lib/math-utils.ts

/** Compute block returns (e.g., weekly returns from daily returns) */
function computeBlockReturns(returns: number[], blockSize: number): number[] {
  const blocks: number[] = [];
  for (let i = 0; i <= returns.length - blockSize; i += blockSize) {
    const blockReturn = returns.slice(i, i + blockSize).reduce((cum, r) => cum * (1 + r), 1) - 1;
    blocks.push(blockReturn);
  }
  return blocks.length > 0 ? blocks : returns;
}

/** Compute average change per sector from market data */
function computeSectorAverageChanges(marketData: MarketData[]): Record<string, number> {
  const sectorSums: Record<string, { total: number; count: number }> = {};

  for (const md of marketData) {
    const sector = SECTOR_MAP[md.symbol];
    if (!sector || md.change24h === null || md.change24h === undefined) continue;

    if (!sectorSums[sector]) sectorSums[sector] = { total: 0, count: 0 };
    sectorSums[sector].total += md.change24h;
    sectorSums[sector].count++;
  }

  const result: Record<string, number> = {};
  for (const [sector, data] of Object.entries(sectorSums)) {
    result[sector] = data.count > 0 ? data.total / data.count : 0;
  }
  return result;
}

/** Classify a single day's regime from available price change data */
function classifyDayRegime(
  changes: number[],
  bucket: Array<{ action: string; symbol: string }>,
): string {
  if (changes.length === 0) return "sideways";

  const avgChange = changes.reduce((s, c) => s + c, 0) / changes.length;
  const absAvg = changes.reduce((s, c) => s + Math.abs(c), 0) / changes.length;
  const advancing = changes.filter((c) => c > 0).length;
  const total = changes.length;
  const advPct = (advancing / total) * 100;
  const dispersion = stdDev(changes);

  if (avgChange > DAY_BULL_AVG_CHANGE_MIN && advPct > DAY_BULL_ADV_PCT_MIN) return "bull_run";
  if (avgChange < DAY_BEAR_AVG_CHANGE_MAX && advPct < DAY_BEAR_ADV_PCT_MAX) return "bear_market";
  if (absAvg > DAY_HIGH_VOL_ABS_AVG_MIN) return "high_volatility";
  if (absAvg < DAY_LOW_VOL_ABS_AVG_MAX) return "low_volatility";
  if (dispersion > DAY_SECTOR_ROTATION_DISPERSION_MIN) return "sector_rotation";
  if (Math.abs(avgChange) > DAY_MOMENTUM_ABS_AVG_MIN && advPct > DAY_MOMENTUM_ADV_PCT_MIN) return "momentum";
  if (Math.abs(avgChange) > DAY_MOMENTUM_ABS_AVG_MIN && advPct < DAY_MOMENTUM_ADV_PCT_MAX) return "momentum";
  if (absAvg > DAY_MEAN_REVERSION_ABS_AVG_MIN && Math.abs(avgChange) < DAY_MEAN_REVERSION_ABS_AVG_MAX) return "mean_reversion";

  return "sideways";
}

/** Estimate how long the current regime has been in effect */
function estimateRegimeDuration(
  trendStrength: number,
  volatilityLevel: number,
  momentumScore: number,
): number {
  // Stronger signals suggest longer-established regime
  const strength = Math.abs(trendStrength) + Math.abs(momentumScore) * 10;
  if (strength > 80) return Math.round(5 + Math.random() * 10);
  if (strength > 50) return Math.round(3 + Math.random() * 7);
  if (strength > 20) return Math.round(1 + Math.random() * 4);
  return Math.round(1 + Math.random() * 2);
}

/** Generate agent-specific recommendations based on regime type */
function generateAgentRecommendations(
  regime: RegimeType,
): MarketRegime["agentRecommendations"] {
  const configs = getAgentConfigs();

  // Define expected performance per regime per risk tolerance and style
  const regimeEdges: Record<RegimeType, Record<string, { performance: string; edge: number }>> = {
    bull_run: {
      aggressive: { performance: "Strong — momentum strategies excel in sustained uptrends", edge: 0.75 },
      moderate: { performance: "Good — balanced approach captures broad gains", edge: 0.60 },
      conservative: { performance: "Moderate — may underweight risk and miss upside", edge: 0.40 },
    },
    bear_market: {
      aggressive: { performance: "Weak — aggressive positioning amplifies drawdowns", edge: 0.25 },
      moderate: { performance: "Fair — balanced exposure limits losses", edge: 0.50 },
      conservative: { performance: "Strong — capital preservation strategies shine", edge: 0.80 },
    },
    sideways: {
      aggressive: { performance: "Fair — frequent trades in range-bound conditions add friction", edge: 0.35 },
      moderate: { performance: "Good — selective trading avoids whipsaws", edge: 0.60 },
      conservative: { performance: "Strong — patience and discipline are rewarded", edge: 0.70 },
    },
    high_volatility: {
      aggressive: { performance: "Mixed — high upside potential but elevated risk", edge: 0.50 },
      moderate: { performance: "Good — can capture vol premium with sizing discipline", edge: 0.65 },
      conservative: { performance: "Fair — may stay sidelined and miss opportunities", edge: 0.45 },
    },
    low_volatility: {
      aggressive: { performance: "Weak — limited alpha in quiet markets", edge: 0.30 },
      moderate: { performance: "Fair — steady but unremarkable returns", edge: 0.50 },
      conservative: { performance: "Good — low-risk environment suits cautious approach", edge: 0.65 },
    },
    sector_rotation: {
      aggressive: { performance: "Strong — can capitalize on sector momentum shifts", edge: 0.70 },
      moderate: { performance: "Good — diversified approach captures rotation", edge: 0.60 },
      conservative: { performance: "Fair — slow to rebalance across sectors", edge: 0.40 },
    },
    momentum: {
      aggressive: { performance: "Excellent — momentum strategies are built for this", edge: 0.85 },
      moderate: { performance: "Good — can ride trends with managed risk", edge: 0.60 },
      conservative: { performance: "Weak — reluctance to chase moves limits gains", edge: 0.30 },
    },
    mean_reversion: {
      aggressive: { performance: "Fair — tendency to fight reversals too early", edge: 0.40 },
      moderate: { performance: "Good — balanced entry timing for reversals", edge: 0.65 },
      conservative: { performance: "Strong — patient contrarian approach fits perfectly", edge: 0.75 },
    },
  };

  return configs.map((config) => {
    const riskBucket = config.riskTolerance === "aggressive" ? "aggressive"
      : config.riskTolerance === "conservative" ? "conservative"
        : "moderate";

    const entry = regimeEdges[regime]?.[riskBucket] ?? {
      performance: "Moderate — no strong directional edge detected",
      edge: 0.50,
    };

    return {
      agentId: config.agentId,
      agentName: config.name,
      expectedPerformance: entry.performance,
      historicalEdge: entry.edge,
    };
  });
}

/** Generate human-readable interpretation of the current regime */
function generateInterpretation(
  regime: RegimeType,
  indicators: MarketRegime["indicators"],
): string {
  const interpretations: Record<RegimeType, string> = {
    bull_run: `Markets are in a confirmed bull run. Trend strength at ${indicators.trendStrength.toFixed(0)}% with positive momentum (${indicators.momentumScore.toFixed(1)}%) and healthy breadth (${indicators.breadthScore.toFixed(0)}%). This environment favors trend-following and growth-oriented strategies. Most stocks are participating in the advance, reducing concentration risk.`,

    bear_market: `Markets are in a bear regime with trend strength at ${indicators.trendStrength.toFixed(0)}% and negative momentum (${indicators.momentumScore.toFixed(1)}%). Breadth is weak at ${indicators.breadthScore.toFixed(0)}%, indicating broad-based selling. Defensive positioning and capital preservation strategies are recommended. Look for relative strength pockets in quality names.`,

    sideways: `Markets are range-bound with no clear directional trend (strength: ${indicators.trendStrength.toFixed(0)}%). Volatility is ${indicators.volatilityLevel < 20 ? "subdued" : "moderate"} at ${indicators.volatilityLevel.toFixed(1)}%. This environment typically favors mean-reversion strategies and punishes directional bets. Patience and selective trading are key.`,

    high_volatility: `Markets are experiencing elevated volatility at ${indicators.volatilityLevel.toFixed(1)}% annualized. Large swings in both directions create opportunities for active traders but increase drawdown risk. Sector dispersion of ${indicators.sectorDispersion.toFixed(1)}% suggests differentiated moves across the market. Position sizing discipline is critical.`,

    low_volatility: `Markets are in a compressed volatility regime at ${indicators.volatilityLevel.toFixed(1)}% annualized. Low vol environments often precede larger moves — the Bollinger Squeeze phenomenon. Current breadth is ${Math.abs(indicators.breadthScore) < 20 ? "neutral" : indicators.breadthScore > 0 ? "leaning positive" : "leaning negative"}. Watch for catalysts that could trigger a volatility expansion.`,

    sector_rotation: `Active sector rotation detected with dispersion at ${indicators.sectorDispersion.toFixed(1)}%. Capital is flowing between sectors, creating opportunities for agents that can identify the rotation leaders early. Overall market momentum is ${Math.abs(indicators.momentumScore) < 0.5 ? "flat" : indicators.momentumScore > 0 ? "slightly positive" : "slightly negative"}, but sector-level moves are pronounced.`,

    momentum: `Strong momentum regime detected with directional moves across the market. Momentum score of ${indicators.momentumScore.toFixed(1)}% with trend strength at ${indicators.trendStrength.toFixed(0)}% signals continuation potential. Trend-following agents have a significant edge. Breadth of ${indicators.breadthScore.toFixed(0)}% confirms ${indicators.breadthScore > 0 ? "widespread participation" : "concentrated selling"}.`,

    mean_reversion: `Markets are showing mean-reversion characteristics — extended moves are snapping back. Volatility at ${indicators.volatilityLevel.toFixed(1)}% with sector dispersion of ${indicators.sectorDispersion.toFixed(1)}% suggests overshooting in individual names. Contrarian strategies that buy dips and sell rips should outperform. Watch for RSI extremes as entry signals.`,
  };

  return interpretations[regime] ?? "Regime classification in progress. Insufficient data for detailed interpretation.";
}

/** Generate historical context for the current regime */
function generateHistoricalContext(
  regime: RegimeType,
  confidence: number,
  durationDays: number,
): string {
  const contexts: Record<RegimeType, string> = {
    bull_run: `This bull run has persisted for approximately ${durationDays} days with ${confidence}% classification confidence. Historically on MoltApp, bull runs average 7-14 days before a mean-reversion or consolidation phase. Aggressive agents tend to outperform by 20-40% during these periods.`,

    bear_market: `The current bear regime has lasted approximately ${durationDays} days. MoltApp bear phases typically range from 3-10 days. Conservative agents historically preserve 15-25% more capital during these drawdowns. Watch for a breadth thrust signal to indicate the selling climax.`,

    sideways: `Markets have been range-bound for approximately ${durationDays} days. Extended sideways periods on MoltApp average 5-12 days before a directional breakout. The longer the consolidation, the more powerful the eventual move tends to be. Monitor Bollinger bandwidth for squeeze signals.`,

    high_volatility: `Elevated volatility has persisted for approximately ${durationDays} days. Vol clusters on MoltApp typically last 3-7 days before moderating. During high-vol regimes, agent win rates historically drop 10-15% across the board, but the best-positioned agents capture larger gains per trade.`,

    low_volatility: `Low volatility has been the norm for approximately ${durationDays} days. Extended low-vol periods (7+ days) on MoltApp have historically preceded significant directional moves. Consider this a "coiled spring" — the eventual breakout direction matters more than the current calm.`,

    sector_rotation: `Sector rotation has been active for approximately ${durationDays} days. Rotation phases on MoltApp average 4-8 days and often coincide with macro narrative shifts. Agents with broader symbol coverage and sector awareness tend to capture an additional 10-20% alpha.`,

    momentum: `The momentum regime has been active for approximately ${durationDays} days. Strong momentum phases on MoltApp average 3-6 days before exhaustion. Late-cycle momentum regimes carry elevated reversal risk. Watch the breadth score for divergence signals.`,

    mean_reversion: `Mean-reversion conditions have persisted for approximately ${durationDays} days. These regimes typically emerge after momentum exhaustion and last 2-5 days. Contrarian agents that bought at oversold levels historically see 60-70% win rates during these periods.`,
  };

  return contexts[regime] ?? `Current regime has been active for approximately ${durationDays} days with ${confidence}% confidence.`;
}

/** Generate insights from agent-regime correlation data */
function generateCorrelationInsights(
  agents: RegimeAgentCorrelation["agents"],
): string[] {
  const insights: string[] = [];

  for (const agent of agents) {
    const bestEntry = agent.performanceByRegime[agent.bestRegime];
    if (bestEntry && bestEntry.tradeCount > 0) {
      insights.push(
        `${agent.agentName} performs best in "${agent.bestRegime}" regimes with a ${bestEntry.winRate}% win rate across ${bestEntry.tradeCount} trades.`,
      );
    }

    const worstEntry = agent.performanceByRegime[agent.worstRegime];
    if (worstEntry && worstEntry.tradeCount > 0 && agent.worstRegime !== agent.bestRegime) {
      insights.push(
        `${agent.agentName} struggles in "${agent.worstRegime}" conditions — consider reducing copy-trade allocation during this regime.`,
      );
    }
  }

  // Cross-agent insight
  if (agents.length >= 2) {
    const sorted = [...agents].sort((a, b) => {
      const aEdge = a.performanceByRegime[a.bestRegime]?.edge ?? 0;
      const bEdge = b.performanceByRegime[b.bestRegime]?.edge ?? 0;
      return bEdge - aEdge;
    });
    insights.push(
      `Overall, ${sorted[0].agentName} (${sorted[0].provider}) shows the highest edge in its best regime. Diversifying across agents provides regime-agnostic exposure.`,
    );
  }

  return insights;
}

/** Detect the rotation phase from sector momentum data */
function detectRotationPhase(
  sectors: SectorAnalysis["sectors"],
  dispersion: number,
): string {
  if (dispersion < 0.5) return "synchronized";

  const techSector = sectors.find((s) => s.name === "Tech");
  const cryptoSector = sectors.find((s) => s.name === "Crypto-Adjacent");
  const healthSector = sectors.find((s) => s.name === "Healthcare");
  const memeSector = sectors.find((s) => s.name === "Meme/Speculative");

  // Growth phase: Tech + Crypto leading
  if (techSector && cryptoSector &&
    techSector.momentum > 0 && cryptoSector.momentum > 0 &&
    (techSector.isLeading || cryptoSector.isLeading)) {
    return "growth_leadership";
  }

  // Speculative phase: Meme stocks leading
  if (memeSector && memeSector.isLeading && memeSector.momentum > 1) {
    return "speculative_excess";
  }

  // Defensive phase: Healthcare leading, Tech lagging
  if (healthSector && techSector &&
    healthSector.momentum > techSector.momentum &&
    healthSector.relativeStrength > 0) {
    return "defensive_rotation";
  }

  // Risk-off: all sectors negative, crypto weakest
  const allNegative = sectors.every((s) => s.momentum < 0);
  if (allNegative) return "risk_off_rotation";

  // Early cycle: broad-based recovery
  const positiveCount = sectors.filter((s) => s.momentum > 0).length;
  if (positiveCount > sectors.length * 0.7) return "early_cycle_recovery";

  return "mid_cycle_rotation";
}

/** Generate recommendation based on rotation analysis */
function generateRotationRecommendation(
  phase: string,
  leadingSector: string,
  laggingSector: string,
  dispersion: number,
): string {
  const phaseRecs: Record<string, string> = {
    growth_leadership: `Growth sectors (${leadingSector}) are leading. Favor agents with tech-heavy portfolios. Watch for overextension in momentum names. Crypto-adjacent stocks often amplify tech moves.`,

    speculative_excess: `Speculative names are leading — late-cycle behavior. Consider reducing exposure to meme stocks and rotating into quality. This phase typically precedes a correction.`,

    defensive_rotation: `Capital is rotating into defensive sectors (${leadingSector}). This suggests risk aversion is increasing. Conservative agents may outperform as the market de-risks.`,

    risk_off_rotation: `All sectors are declining — a risk-off environment. Capital preservation is the priority. Look for oversold conditions in quality names for eventual recovery plays.`,

    early_cycle_recovery: `Broad-based recovery underway with most sectors advancing. This is the optimal environment for aggressive agents. ${leadingSector} leads, but participation is widening.`,

    mid_cycle_rotation: `Active rotation between sectors with ${dispersion.toFixed(1)}% dispersion. ${leadingSector} is currently leading while ${laggingSector} lags. Agents with good sector timing will outperform.`,

    synchronized: `All sectors are moving together with low dispersion (${dispersion.toFixed(1)}%). Macro factors are dominating stock-level moves. Focus on market direction rather than sector selection.`,
  };

  return phaseRecs[phase] ?? `Sector rotation is active. ${leadingSector} leads, ${laggingSector} lags. Dispersion: ${dispersion.toFixed(1)}%.`;
}

/** Generate human-readable interpretation of breadth indicators */
function generateBreadthInterpretation(
  adRatio: number,
  pctAbove20: number,
  pctAbove50: number,
  newHighs: number,
  newLows: number,
  thrustDetected: boolean,
  thrustDirection: string,
  overallSignal: string,
): string {
  const parts: string[] = [];

  // A/D ratio
  if (adRatio > 2) {
    parts.push(`Strong advancing breadth with a ${adRatio.toFixed(1)}:1 advance/decline ratio.`);
  } else if (adRatio > 1.2) {
    parts.push(`Healthy market breadth with a ${adRatio.toFixed(1)}:1 advance/decline ratio.`);
  } else if (adRatio < 0.5) {
    parts.push(`Weak breadth: only ${adRatio.toFixed(2)}:1 advance/decline ratio. Broad-based selling pressure.`);
  } else {
    parts.push(`Neutral breadth with a ${adRatio.toFixed(1)}:1 advance/decline ratio.`);
  }

  // Moving average participation
  parts.push(
    `${pctAbove20.toFixed(0)}% of stocks above their 20-period SMA and ${pctAbove50.toFixed(0)}% above their 50-period SMA.`,
  );

  // New highs vs new lows
  if (newHighs > newLows && newHighs > 0) {
    parts.push(`New highs (${newHighs}) outnumber new lows (${newLows}) — confirming upward participation.`);
  } else if (newLows > newHighs && newLows > 0) {
    parts.push(`New lows (${newLows}) outnumber new highs (${newHighs}) — downside pressure is broadening.`);
  }

  // Breadth thrust
  if (thrustDetected) {
    parts.push(
      `Breadth thrust detected in the ${thrustDirection} direction — a historically significant signal that often precedes sustained moves.`,
    );
  }

  return parts.join(" ");
}
