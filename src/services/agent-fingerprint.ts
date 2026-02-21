/**
 * Agent Behavioral Fingerprinting
 *
 * Analyzes AI agent trading behavior to create unique "fingerprints" that
 * characterize each agent's decision-making patterns. This enables:
 *
 * - Behavioral distance metrics between agents (are Claude & GPT trading similarly?)
 * - Personality drift detection (has an agent's behavior changed over time?)
 * - Strategy clustering (which agents have converging/diverging strategies?)
 * - Correlation analysis (when agent A buys, does agent B also buy?)
 * - Pattern recognition (time-of-day preferences, sector biases)
 *
 * Each fingerprint is a multi-dimensional vector that captures:
 * 1. Action Distribution (buy/sell/hold ratios)
 * 2. Stock Preferences (which symbols they favor)
 * 3. Confidence Profile (distribution of confidence scores)
 * 4. Risk Appetite (position sizing, concentration)
 * 5. Timing Patterns (action frequency, hold duration)
 * 6. Sentiment Bias (bullish/bearish tendency)
 */

import { db } from "../db/index.ts";
import { agentDecisions } from "../db/schema/agent-decisions.ts";
import { trades } from "../db/schema/trades.ts";
import { eq, desc } from "drizzle-orm";
import { round2, round3, countByCondition, findMax, computeStdDev } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Lookback window sizes for fingerprint generation and drift detection.
 */

/**
 * Default lookback window for overall behavioral fingerprint generation.
 * Captures ~200 most recent decisions for comprehensive behavior analysis.
 */
const FINGERPRINT_LOOKBACK_DEFAULT = 200;

/**
 * Recent lookback window for drift detection.
 * Compares last 20 decisions against overall pattern to detect behavior changes.
 */
const FINGERPRINT_LOOKBACK_RECENT = 20;

/**
 * Minimum rounds required for meaningful drift detection.
 * Below this threshold, insufficient data exists for comparison.
 */
const DRIFT_DETECTION_MIN_ROUNDS = 30;

/**
 * Confidence distribution bucket boundaries.
 * Used to classify confidence scores into 5 tiers for profile analysis.
 */

/**
 * Boundary between veryLow and low confidence buckets (0-20 vs 21-40).
 */
const CONFIDENCE_BUCKET_VERY_LOW_MAX = 20;

/**
 * Boundary between low and moderate confidence buckets (21-40 vs 41-60).
 */
const CONFIDENCE_BUCKET_LOW_MAX = 40;

/**
 * Boundary between moderate and high confidence buckets (41-60 vs 61-80).
 */
const CONFIDENCE_BUCKET_MODERATE_MAX = 60;

/**
 * Boundary between high and veryHigh confidence buckets (61-80 vs 81-100).
 */
const CONFIDENCE_BUCKET_HIGH_MAX = 80;

/**
 * Display limits for stock preferences and decision history.
 */

/**
 * Maximum number of top stocks to include in fingerprint.
 * Captures agent's most frequently traded symbols without overwhelming detail.
 */
const TOP_STOCKS_DISPLAY_LIMIT = 10;

/**
 * Recent decisions window for sentiment bias calculation.
 * Tracks last 10 decisions to compute recentBias metric.
 */
const RECENT_DECISIONS_SENTIMENT_WINDOW = 10;

/**
 * Sentiment bias classification thresholds.
 */

/**
 * Percentage Precision Rounding Constants
 *
 * Used for 2-decimal percentage display formatting in action distributions
 * and stock preference weights.
 */

/**
 * Multiplier for 2-decimal percentage precision rounding.
 *
 * Formula: Math.round(fraction × MULTIPLIER) / DIVISOR
 * Example: 0.3333 → Math.round(0.3333 × 10000) / 100 → 3333 / 100 → 33.33%
 *
 * Used in:
 * - Action distribution percentages (buy/sell/hold ratios)
 * - Stock preference weights (relative frequency calculations)
 */
const PERCENTAGE_PRECISION_MULTIPLIER = 10000;

/**
 * Divisor for percentage precision rounding.
 *
 * Converts rounded integer back to 2-decimal percentage format.
 * Works with PERCENTAGE_PRECISION_MULTIPLIER to produce values like: 33.33%, 66.67%, etc.
 */
const PERCENTAGE_PRECISION_DIVISOR = 100;

/**
 * Bias volatility threshold for contrarian classification.
 * If >60% of consecutive non-hold decisions flip direction, agent is contrarian.
 */
const CONTRARIAN_VOLATILITY_THRESHOLD = 0.6;

/**
 * Sentiment difference threshold for divergence note generation.
 * |biasA - biasB| > 0.3 triggers "Different market outlook" note.
 */
const SENTIMENT_DIVERGENCE_THRESHOLD = 0.3;

/**
 * Feature vector normalization parameters.
 * Used to scale various metrics into 0-1 range for similarity computation.
 */

/**
 * Maximum reasonable confidence standard deviation for normalization.
 * Used to normalize stdDev from unbounded range to 0-1 scale.
 */
const CONFIDENCE_STDDEV_NORMALIZATION_MAX = 50;

/**
 * Average position size normalization ceiling.
 * Positions above $5000 are capped at 1.0 in normalized feature vector.
 */
const AVG_POSITION_SIZE_NORMALIZATION_MAX = 5000;

/**
 * Maximum position size normalization ceiling.
 * Max positions above $10,000 are capped at 1.0 in normalized feature vector.
 */
const MAX_POSITION_SIZE_NORMALIZATION_MAX = 10000;

/**
 * Stock diversity normalization factor.
 * Agents trading 10+ stocks get full 1.0 score for diversity dimension.
 */
const STOCK_DIVERSITY_NORMALIZATION_MAX = 10;

/**
 * Total decisions normalization ceiling for activity level.
 * Agents with 100+ decisions get full 1.0 score for activity dimension.
 */
const ACTIVITY_NORMALIZATION_MAX = 100;

/**
 * Divergence detection thresholds for similarity comparison.
 */

/**
 * Buy/sell ratio difference threshold for "significantly more bullish" note.
 * Difference >15% in buy decisions triggers divergence note.
 */
const BUY_RATIO_DIVERGENCE_THRESHOLD = 15;

/**
 * Confidence mean difference threshold for divergence note.
 * Difference >15 points in average confidence triggers note.
 */
const CONFIDENCE_DIVERGENCE_THRESHOLD = 15;

/**
 * Trade frequency difference threshold for divergence note.
 * Difference >0.3 in trade rate (30% more active) triggers note.
 */
const TRADE_FREQUENCY_DIVERGENCE_THRESHOLD = 0.3;

/**
 * Behavioral drift detection threshold.
 * Euclidean distance between recent and overall feature vectors >0.5 = significant drift.
 */
const DRIFT_SCORE_THRESHOLD = 0.5;

/**
 * Summary generation classification thresholds.
 * Used in generateSummary() to classify agent trading style and behavior.
 */

/**
 * Hold percent threshold for "cautious trader" classification.
 * If >60% of decisions are holds, agent is classified as cautious/defensive.
 */
const SUMMARY_HOLD_CAUTIOUS_THRESHOLD = 60;

/**
 * Buy percent threshold for "aggressive buyer" classification.
 * If >50% of decisions are buys, agent is classified as aggressive/growth-focused.
 */
const SUMMARY_BUY_AGGRESSIVE_THRESHOLD = 50;

/**
 * Sell percent threshold for "active seller" classification.
 * If >40% of decisions are sells, agent is classified as active profit-taker.
 */
const SUMMARY_SELL_ACTIVE_THRESHOLD = 40;

/**
 * Sentiment bias positive threshold for "bullish bias" classification.
 * overallBias >0.3 (30% net bullish) = bullish market view.
 */
const SUMMARY_SENTIMENT_BULLISH_THRESHOLD = 0.3;

/**
 * Sentiment bias negative threshold for "bearish bias" classification.
 * overallBias <-0.3 (30% net bearish) = bearish market view.
 */
const SUMMARY_SENTIMENT_BEARISH_THRESHOLD = -0.3;

/**
 * Confidence mean high threshold for "high conviction" classification.
 * mean >70% confidence = high conviction decision maker.
 */
const SUMMARY_CONFIDENCE_HIGH_THRESHOLD = 70;

/**
 * Confidence mean low threshold for "cautious" classification.
 * mean <40% confidence = cautious/uncertain decision maker.
 */
const SUMMARY_CONFIDENCE_LOW_THRESHOLD = 40;

/**
 * Stock comparison parameters for fingerprint similarity analysis.
 */

/**
 * Number of top stocks to compare between agents in compareFingerprints().
 * Compares top 3 most-traded stocks to assess sector preference overlap.
 */
const TOP_STOCKS_COMPARISON_LIMIT = 3;

/**
 * Correlation matrix computation parameters.
 */

/**
 * Decision lookback window for correlation matrix computation.
 * Fetches last 100 decisions per agent to compute pairwise correlations.
 */
const CORRELATION_MATRIX_LOOKBACK = 100;

/**
 * Strong correlation threshold for highlighting agent pairs.
 * Absolute correlation >0.5 indicates strong positive/negative relationship.
 */
const STRONG_CORRELATION_THRESHOLD = 0.5;

/**
 * Minimum sample size required for valid Pearson correlation.
 * Below 3 data points, correlation computation is unreliable and returns 0.
 */
const MIN_PEARSON_CORRELATION_SAMPLES = 3;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActionDistribution {
  buyPercent: number;
  sellPercent: number;
  holdPercent: number;
  totalDecisions: number;
}

export interface StockPreference {
  symbol: string;
  tradeCount: number;
  buyCount: number;
  sellCount: number;
  avgConfidence: number;
  weight: number; // percent of total activity
}

export interface ConfidenceProfile {
  mean: number;
  median: number;
  stdDev: number;
  distribution: {
    veryLow: number;  // 0-20
    low: number;      // 21-40
    moderate: number;  // 41-60
    high: number;     // 61-80
    veryHigh: number; // 81-100
  };
  calibration: number; // how well confidence predicts success (-1 to 1)
}

export interface RiskAppetite {
  avgPositionSize: number;
  maxPositionSize: number;
  avgPortfolioConcentration: number;
  maxConcurrentPositions: number;
  tradeFrequency: number; // trades per round
  holdDurationAvg: number; // rounds between buy and sell
}

export interface SentimentBias {
  overallBias: number; // -1 (bearish) to 1 (bullish)
  recentBias: number;  // last 10 decisions
  biasVolatility: number; // how often bias flips
  contrarian: boolean; // does agent tend to go against majority?
}

export interface BehavioralFingerprint {
  agentId: string;
  generatedAt: string;
  roundsAnalyzed: number;
  actionDistribution: ActionDistribution;
  topStocks: StockPreference[];
  confidenceProfile: ConfidenceProfile;
  riskAppetite: RiskAppetite;
  sentimentBias: SentimentBias;
  /** Normalized feature vector for similarity computation (16 dimensions) */
  featureVector: number[];
  /** Human-readable behavior summary */
  summary: string;
}

export interface BehavioralSimilarity {
  agentA: string;
  agentB: string;
  /** Cosine similarity (0 = completely different, 1 = identical behavior) */
  cosineSimilarity: number;
  /** Euclidean distance (lower = more similar) */
  euclideanDistance: number;
  /** Per-dimension comparison */
  dimensionComparison: Array<{
    dimension: string;
    valueA: number;
    valueB: number;
    difference: number;
  }>;
  /** Natural language description of differences */
  divergenceNotes: string[];
}

export interface CorrelationMatrix {
  agents: string[];
  matrix: number[][]; // Pearson correlation of decision sequences
  strongCorrelations: Array<{
    agentA: string;
    agentB: string;
    correlation: number;
    type: "positive" | "negative";
  }>;
}

// ---------------------------------------------------------------------------
// Fingerprint Generation
// ---------------------------------------------------------------------------

/**
 * Generate a behavioral fingerprint for an agent from their decision history.
 */
export async function generateFingerprint(
  agentId: string,
  options?: { lookbackRounds?: number },
): Promise<BehavioralFingerprint> {
  const lookback = options?.lookbackRounds ?? FINGERPRINT_LOOKBACK_DEFAULT;

  // Fetch decision history
  const decisions = await db
    .select()
    .from(agentDecisions)
    .where(eq(agentDecisions.agentId, agentId))
    .orderBy(desc(agentDecisions.createdAt))
    .limit(lookback);

  // Fetch trade history
  const agentTrades = await db
    .select()
    .from(trades)
    .where(eq(trades.agentId, agentId))
    .orderBy(desc(trades.createdAt))
    .limit(lookback);

  // 1. Action Distribution
  const actionDistribution = computeActionDistribution(decisions);

  // 2. Stock Preferences
  const topStocks = computeStockPreferences(decisions);

  // 3. Confidence Profile
  const confidenceProfile = computeConfidenceProfile(decisions);

  // 4. Risk Appetite
  const riskAppetite = computeRiskAppetite(decisions, agentTrades);

  // 5. Sentiment Bias
  const sentimentBias = computeSentimentBias(decisions);

  // 6. Feature Vector (normalized for similarity computation)
  const featureVector = buildFeatureVector(
    actionDistribution,
    topStocks,
    confidenceProfile,
    riskAppetite,
    sentimentBias,
  );

  // 7. Summary
  const summary = generateSummary(
    agentId,
    actionDistribution,
    topStocks,
    confidenceProfile,
    sentimentBias,
  );

  return {
    agentId,
    generatedAt: new Date().toISOString(),
    roundsAnalyzed: decisions.length,
    actionDistribution,
    topStocks,
    confidenceProfile,
    riskAppetite,
    sentimentBias,
    featureVector,
    summary,
  };
}

// ---------------------------------------------------------------------------
// Component Computations
// ---------------------------------------------------------------------------

function computeActionDistribution(
  decisions: Array<{ action: string }>,
): ActionDistribution {
  const total = decisions.length;
  if (total === 0) {
    return { buyPercent: 0, sellPercent: 0, holdPercent: 0, totalDecisions: 0 };
  }

  const buys = countByCondition(decisions, (d) => d.action === "buy");
  const sells = countByCondition(decisions, (d) => d.action === "sell");
  const holds = countByCondition(decisions, (d) => d.action === "hold");

  return {
    buyPercent: Math.round((buys / total) * PERCENTAGE_PRECISION_MULTIPLIER) / PERCENTAGE_PRECISION_DIVISOR,
    sellPercent: Math.round((sells / total) * PERCENTAGE_PRECISION_MULTIPLIER) / PERCENTAGE_PRECISION_DIVISOR,
    holdPercent: Math.round((holds / total) * PERCENTAGE_PRECISION_MULTIPLIER) / PERCENTAGE_PRECISION_DIVISOR,
    totalDecisions: total,
  };
}

function computeStockPreferences(
  decisions: Array<{ symbol: string; action: string; confidence: number }>,
): StockPreference[] {
  const symbolMap = new Map<
    string,
    { total: number; buys: number; sells: number; confidenceSum: number }
  >();

  for (const d of decisions) {
    if (d.action === "hold") continue;
    const existing = symbolMap.get(d.symbol) ?? {
      total: 0, buys: 0, sells: 0, confidenceSum: 0,
    };
    existing.total++;
    if (d.action === "buy") existing.buys++;
    if (d.action === "sell") existing.sells++;
    existing.confidenceSum += d.confidence;
    symbolMap.set(d.symbol, existing);
  }

  const nonHoldCount = countByCondition(decisions, (d) => d.action !== "hold");

  const preferences: StockPreference[] = [];
  for (const [symbol, data] of symbolMap) {
    preferences.push({
      symbol,
      tradeCount: data.total,
      buyCount: data.buys,
      sellCount: data.sells,
      avgConfidence: data.total > 0 ? Math.round(data.confidenceSum / data.total) : 0,
      weight: nonHoldCount > 0 ? Math.round((data.total / nonHoldCount) * PERCENTAGE_PRECISION_MULTIPLIER) / PERCENTAGE_PRECISION_DIVISOR : 0,
    });
  }

  // Sort by trade count descending
  preferences.sort((a, b) => b.tradeCount - a.tradeCount);
  return preferences.slice(0, TOP_STOCKS_DISPLAY_LIMIT);
}

function computeConfidenceProfile(
  decisions: Array<{ confidence: number }>,
): ConfidenceProfile {
  if (decisions.length === 0) {
    return {
      mean: 0, median: 0, stdDev: 0,
      distribution: { veryLow: 0, low: 0, moderate: 0, high: 0, veryHigh: 0 },
      calibration: 0,
    };
  }

  const confidences = decisions.map((d) => d.confidence).sort((a, b) => a - b);
  const mean = confidences.reduce((a, b) => a + b, 0) / confidences.length;
  const median = confidences[Math.floor(confidences.length / 2)];

  // Standard deviation (sample variance: multiply by n/(n-1) Bessel correction)
  const n = confidences.length;
  const stdDev = n > 1 ? computeStdDev(confidences) * Math.sqrt(n / (n - 1)) : 0;

  // Distribution buckets
  const distribution = {
    veryLow: countByCondition(confidences, (c) => c <= CONFIDENCE_BUCKET_VERY_LOW_MAX),
    low: countByCondition(confidences, (c) => c > CONFIDENCE_BUCKET_VERY_LOW_MAX && c <= CONFIDENCE_BUCKET_LOW_MAX),
    moderate: countByCondition(confidences, (c) => c > CONFIDENCE_BUCKET_LOW_MAX && c <= CONFIDENCE_BUCKET_MODERATE_MAX),
    high: countByCondition(confidences, (c) => c > CONFIDENCE_BUCKET_MODERATE_MAX && c <= CONFIDENCE_BUCKET_HIGH_MAX),
    veryHigh: countByCondition(confidences, (c) => c > CONFIDENCE_BUCKET_HIGH_MAX),
  };

  return {
    mean: round2(mean),
    median,
    stdDev: round2(stdDev),
    distribution,
    calibration: 0, // Would need outcome data to compute
  };
}

function computeRiskAppetite(
  decisions: Array<{ action: string; quantity: string }>,
  tradeHistory: Array<{ usdcAmount: string }>,
): RiskAppetite {
  const amounts = tradeHistory.map((t) => parseFloat(t.usdcAmount));
  const avgPositionSize = amounts.length > 0
    ? amounts.reduce((sum, amt) => sum + amt, 0) / amounts.length
    : 0;
  const maxPositionSize = findMax(amounts.map(value => ({ value })), 'value')?.value ?? 0;

  // Trade frequency: non-hold decisions / total decisions
  const nonHolds = countByCondition(decisions, (d) => d.action !== "hold");
  const tradeFrequency =
    decisions.length > 0 ? round2(nonHolds / decisions.length) : 0;

  return {
    avgPositionSize: round2(avgPositionSize),
    maxPositionSize: round2(maxPositionSize),
    avgPortfolioConcentration: 0, // Would need position data
    maxConcurrentPositions: 0, // Would need position history
    tradeFrequency,
    holdDurationAvg: 0, // Would need matched buy/sell pairs
  };
}

function computeSentimentBias(
  decisions: Array<{ action: string; confidence: number }>,
): SentimentBias {
  if (decisions.length === 0) {
    return { overallBias: 0, recentBias: 0, biasVolatility: 0, contrarian: false };
  }

  // Map actions to numeric sentiment: buy = +1, sell = -1, hold = 0
  const sentiments: number[] = decisions.map((d) => {
    if (d.action === "buy") return 1;
    if (d.action === "sell") return -1;
    return 0;
  });

  const overallBias =
    sentiments.reduce((a: number, b: number) => a + b, 0) / sentiments.length;

  const recent = sentiments.slice(0, RECENT_DECISIONS_SENTIMENT_WINDOW);
  const recentBias =
    recent.length > 0
      ? recent.reduce((a: number, b: number) => a + b, 0) / recent.length
      : 0;

  // Bias volatility: how often does sentiment flip sign?
  let flips = 0;
  for (let i = 1; i < sentiments.length; i++) {
    if (
      sentiments[i] !== 0 &&
      sentiments[i - 1] !== 0 &&
      sentiments[i] !== sentiments[i - 1]
    ) {
      flips++;
    }
  }
  const nonZeroCount = countByCondition(sentiments, (s) => s !== 0);
  const biasVolatility =
    nonZeroCount > 1
      ? round2(flips / (nonZeroCount - 1))
      : 0;

  return {
    overallBias: round3(overallBias),
    recentBias: round3(recentBias),
    biasVolatility,
    contrarian: biasVolatility > CONTRARIAN_VOLATILITY_THRESHOLD,
  };
}

// ---------------------------------------------------------------------------
// Feature Vector
// ---------------------------------------------------------------------------

/**
 * Build a normalized 16-dimensional feature vector for similarity comparison.
 */
function buildFeatureVector(
  actions: ActionDistribution,
  stocks: StockPreference[],
  confidence: ConfidenceProfile,
  risk: RiskAppetite,
  sentiment: SentimentBias,
): number[] {
  return [
    // Action distribution (3 dims)
    actions.buyPercent / 100,
    actions.sellPercent / 100,
    actions.holdPercent / 100,
    // Confidence profile (3 dims)
    confidence.mean / 100,
    confidence.stdDev / CONFIDENCE_STDDEV_NORMALIZATION_MAX,
    confidence.median / 100,
    // Risk appetite (3 dims)
    Math.min(1, risk.avgPositionSize / AVG_POSITION_SIZE_NORMALIZATION_MAX),
    Math.min(1, risk.maxPositionSize / MAX_POSITION_SIZE_NORMALIZATION_MAX),
    risk.tradeFrequency,
    // Sentiment (3 dims)
    (sentiment.overallBias + 1) / 2, // Map -1..1 to 0..1
    (sentiment.recentBias + 1) / 2,
    sentiment.biasVolatility,
    // Stock diversity (2 dims)
    Math.min(1, stocks.length / STOCK_DIVERSITY_NORMALIZATION_MAX),
    stocks.length > 0 ? stocks[0].weight / 100 : 0, // Concentration in top stock
    // Activity (2 dims)
    Math.min(1, actions.totalDecisions / ACTIVITY_NORMALIZATION_MAX),
    actions.totalDecisions > 0
      ? (actions.totalDecisions - (actions.holdPercent / 100 * actions.totalDecisions)) / actions.totalDecisions
      : 0,
  ];
}

// ---------------------------------------------------------------------------
// Similarity Computation
// ---------------------------------------------------------------------------

/**
 * Compute behavioral similarity between two agents.
 */
export async function computeSimilarity(
  agentA: string,
  agentB: string,
): Promise<BehavioralSimilarity> {
  const [fpA, fpB] = await Promise.all([
    generateFingerprint(agentA),
    generateFingerprint(agentB),
  ]);

  const vecA = fpA.featureVector;
  const vecB = fpB.featureVector;

  // Cosine similarity
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  const cosineSimilarity =
    normA > 0 && normB > 0
      ? round3(dotProduct / (Math.sqrt(normA) * Math.sqrt(normB)))
      : 0;

  // Euclidean distance
  let sumSquaredDiff = 0;
  for (let i = 0; i < vecA.length; i++) {
    sumSquaredDiff += Math.pow(vecA[i] - vecB[i], 2);
  }
  const euclideanDistance = round3(Math.sqrt(sumSquaredDiff));

  // Per-dimension comparison
  const dimensionNames = [
    "buy_ratio", "sell_ratio", "hold_ratio",
    "confidence_mean", "confidence_stddev", "confidence_median",
    "avg_position_size", "max_position_size", "trade_frequency",
    "overall_bias", "recent_bias", "bias_volatility",
    "stock_diversity", "top_stock_concentration",
    "activity_level", "action_rate",
  ];

  const dimensionComparison = dimensionNames.map((name, i) => ({
    dimension: name,
    valueA: round3(vecA[i]),
    valueB: round3(vecB[i]),
    difference: round3(Math.abs(vecA[i] - vecB[i])),
  }));

  // Generate divergence notes
  const divergenceNotes = generateDivergenceNotes(fpA, fpB, dimensionComparison);

  return {
    agentA,
    agentB,
    cosineSimilarity,
    euclideanDistance,
    dimensionComparison,
    divergenceNotes,
  };
}

/**
 * Build a correlation matrix showing how agents' decisions correlate.
 */
export async function buildCorrelationMatrix(
  agentIds: string[],
): Promise<CorrelationMatrix> {
  // Fetch decision sequences for each agent
  const agentSequences = new Map<string, number[]>();

  for (const agentId of agentIds) {
    const decisions = await db
      .select({
        roundId: agentDecisions.roundId,
        action: agentDecisions.action,
      })
      .from(agentDecisions)
      .where(eq(agentDecisions.agentId, agentId))
      .orderBy(desc(agentDecisions.createdAt))
      .limit(CORRELATION_MATRIX_LOOKBACK);

    // Convert to numeric sequence: buy=1, sell=-1, hold=0
    const sequence = decisions.map((d: typeof agentDecisions.$inferSelect) => {
      if (d.action === "buy") return 1;
      if (d.action === "sell") return -1;
      return 0;
    });

    agentSequences.set(agentId, sequence);
  }

  // Compute pairwise Pearson correlations
  const matrix: number[][] = [];
  const strongCorrelations: CorrelationMatrix["strongCorrelations"] = [];

  for (let i = 0; i < agentIds.length; i++) {
    matrix[i] = [];
    const seqI = agentSequences.get(agentIds[i]) ?? [];

    for (let j = 0; j < agentIds.length; j++) {
      if (i === j) {
        matrix[i][j] = 1;
        continue;
      }

      const seqJ = agentSequences.get(agentIds[j]) ?? [];
      const corr = pearsonCorrelation(seqI, seqJ);
      matrix[i][j] = round3(corr);

      // Track strong correlations
      if (i < j && Math.abs(corr) > STRONG_CORRELATION_THRESHOLD) {
        strongCorrelations.push({
          agentA: agentIds[i],
          agentB: agentIds[j],
          correlation: matrix[i][j],
          type: corr > 0 ? "positive" : "negative",
        });
      }
    }
  }

  return { agents: agentIds, matrix, strongCorrelations };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < MIN_PEARSON_CORRELATION_SAMPLES) return 0;

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i];
    sumY2 += y[i] * y[i];
  }

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt(
    (n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY),
  );

  if (denominator === 0) return 0;
  return numerator / denominator;
}

function generateDivergenceNotes(
  fpA: BehavioralFingerprint,
  fpB: BehavioralFingerprint,
  dimensions: BehavioralSimilarity["dimensionComparison"],
): string[] {
  const notes: string[] = [];

  // Compare action distributions
  const buyDiff = Math.abs(fpA.actionDistribution.buyPercent - fpB.actionDistribution.buyPercent);
  if (buyDiff > BUY_RATIO_DIVERGENCE_THRESHOLD) {
    const moreBullish = fpA.actionDistribution.buyPercent > fpB.actionDistribution.buyPercent
      ? fpA.agentId : fpB.agentId;
    notes.push(`${moreBullish} is significantly more bullish (${buyDiff.toFixed(0)}% more buy decisions)`);
  }

  // Compare confidence
  const confDiff = Math.abs(fpA.confidenceProfile.mean - fpB.confidenceProfile.mean);
  if (confDiff > CONFIDENCE_DIVERGENCE_THRESHOLD) {
    const moreConfident = fpA.confidenceProfile.mean > fpB.confidenceProfile.mean
      ? fpA.agentId : fpB.agentId;
    notes.push(`${moreConfident} has higher average confidence (${confDiff.toFixed(0)} points)`);
  }

  // Compare sentiment bias
  const sentDiff = Math.abs(fpA.sentimentBias.overallBias - fpB.sentimentBias.overallBias);
  if (sentDiff > SENTIMENT_DIVERGENCE_THRESHOLD) {
    notes.push(`Different market outlook: bias difference of ${sentDiff.toFixed(2)}`);
  }

  // Compare top stocks
  const topA = new Set(fpA.topStocks.slice(0, TOP_STOCKS_COMPARISON_LIMIT).map((s) => s.symbol));
  const topB = new Set(fpB.topStocks.slice(0, TOP_STOCKS_COMPARISON_LIMIT).map((s) => s.symbol));
  const overlap = [...topA].filter((s) => topB.has(s));
  if (overlap.length === 0 && topA.size > 0 && topB.size > 0) {
    notes.push("No overlap in top 3 traded stocks — very different sector preferences");
  } else if (overlap.length === TOP_STOCKS_COMPARISON_LIMIT) {
    notes.push("Same top 3 stocks — converging on similar opportunities");
  }

  // Compare trade frequency
  const freqDiff = Math.abs(fpA.riskAppetite.tradeFrequency - fpB.riskAppetite.tradeFrequency);
  if (freqDiff > TRADE_FREQUENCY_DIVERGENCE_THRESHOLD) {
    const moreActive = fpA.riskAppetite.tradeFrequency > fpB.riskAppetite.tradeFrequency
      ? fpA.agentId : fpB.agentId;
    notes.push(`${moreActive} trades more frequently (${freqDiff.toFixed(2)} higher trade rate)`);
  }

  if (notes.length === 0) {
    notes.push("Agents exhibit broadly similar trading behavior");
  }

  return notes;
}

function generateSummary(
  agentId: string,
  actions: ActionDistribution,
  stocks: StockPreference[],
  confidence: ConfidenceProfile,
  sentiment: SentimentBias,
): string {
  const parts: string[] = [];

  // Style
  if (actions.holdPercent > SUMMARY_HOLD_CAUTIOUS_THRESHOLD) {
    parts.push("cautious trader (mostly holds)");
  } else if (actions.buyPercent > SUMMARY_BUY_AGGRESSIVE_THRESHOLD) {
    parts.push("aggressive buyer");
  } else if (actions.sellPercent > SUMMARY_SELL_ACTIVE_THRESHOLD) {
    parts.push("active seller / profit-taker");
  } else {
    parts.push("balanced trader");
  }

  // Sentiment
  if (sentiment.overallBias > SUMMARY_SENTIMENT_BULLISH_THRESHOLD) {
    parts.push("bullish bias");
  } else if (sentiment.overallBias < SUMMARY_SENTIMENT_BEARISH_THRESHOLD) {
    parts.push("bearish bias");
  } else {
    parts.push("neutral market view");
  }

  // Confidence
  if (confidence.mean > SUMMARY_CONFIDENCE_HIGH_THRESHOLD) {
    parts.push("high conviction decisions");
  } else if (confidence.mean < SUMMARY_CONFIDENCE_LOW_THRESHOLD) {
    parts.push("cautious/uncertain decision maker");
  }

  // Stock focus
  if (stocks.length === 1) {
    parts.push(`focused on ${stocks[0].symbol}`);
  } else if (stocks.length >= 5) {
    parts.push("diversified across many stocks");
  } else if (stocks.length > 0) {
    parts.push(`favors ${stocks[0].symbol}`);
  }

  return `${agentId}: ${parts.join(", ")}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get all agent fingerprints for comparison.
 */
export async function getAllFingerprints(
  agentIds: string[],
): Promise<BehavioralFingerprint[]> {
  return Promise.all(agentIds.map((id) => generateFingerprint(id)));
}

/**
 * Detect if an agent's behavior has drifted from its historical pattern.
 * Compares recent behavior (last 20 decisions) against overall pattern.
 */
export async function detectBehaviorDrift(
  agentId: string,
): Promise<{
  hasDrift: boolean;
  driftScore: number;
  dimensions: Array<{ dimension: string; recentValue: number; historicalValue: number }>;
}> {
  const overall = await generateFingerprint(agentId, { lookbackRounds: FINGERPRINT_LOOKBACK_DEFAULT });
  const recent = await generateFingerprint(agentId, { lookbackRounds: FINGERPRINT_LOOKBACK_RECENT });

  if (overall.roundsAnalyzed < DRIFT_DETECTION_MIN_ROUNDS) {
    return { hasDrift: false, driftScore: 0, dimensions: [] };
  }

  // Compute distance between recent and overall feature vectors
  let sumSquaredDiff = 0;
  const dimNames = [
    "buy_ratio", "sell_ratio", "hold_ratio",
    "confidence_mean", "confidence_stddev", "confidence_median",
    "avg_position_size", "max_position_size", "trade_frequency",
    "overall_bias", "recent_bias", "bias_volatility",
    "stock_diversity", "top_stock_concentration",
    "activity_level", "action_rate",
  ];

  const dimensions = dimNames.map((name, i) => {
    const diff = overall.featureVector[i] - recent.featureVector[i];
    sumSquaredDiff += diff * diff;
    return {
      dimension: name,
      recentValue: round3(recent.featureVector[i]),
      historicalValue: round3(overall.featureVector[i]),
    };
  });

  const driftScore = round3(Math.sqrt(sumSquaredDiff));
  const hasDrift = driftScore > DRIFT_SCORE_THRESHOLD;

  return { hasDrift, driftScore, dimensions };
}
