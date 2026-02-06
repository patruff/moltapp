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
import { eq, desc, and, gte } from "drizzle-orm";
import { round3 } from "../lib/math-utils.ts";

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
  const lookback = options?.lookbackRounds ?? 200;

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

  const buys = decisions.filter((d) => d.action === "buy").length;
  const sells = decisions.filter((d) => d.action === "sell").length;
  const holds = decisions.filter((d) => d.action === "hold").length;

  return {
    buyPercent: Math.round((buys / total) * 10000) / 100,
    sellPercent: Math.round((sells / total) * 10000) / 100,
    holdPercent: Math.round((holds / total) * 10000) / 100,
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

  const nonHoldCount = decisions.filter((d) => d.action !== "hold").length;

  const preferences: StockPreference[] = [];
  for (const [symbol, data] of symbolMap) {
    preferences.push({
      symbol,
      tradeCount: data.total,
      buyCount: data.buys,
      sellCount: data.sells,
      avgConfidence: data.total > 0 ? Math.round(data.confidenceSum / data.total) : 0,
      weight: nonHoldCount > 0 ? Math.round((data.total / nonHoldCount) * 10000) / 100 : 0,
    });
  }

  // Sort by trade count descending
  preferences.sort((a, b) => b.tradeCount - a.tradeCount);
  return preferences.slice(0, 10); // Top 10
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

  // Standard deviation
  const variance =
    confidences.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) /
    Math.max(1, confidences.length - 1);
  const stdDev = Math.sqrt(variance);

  // Distribution buckets
  const distribution = {
    veryLow: confidences.filter((c) => c <= 20).length,
    low: confidences.filter((c) => c > 20 && c <= 40).length,
    moderate: confidences.filter((c) => c > 40 && c <= 60).length,
    high: confidences.filter((c) => c > 60 && c <= 80).length,
    veryHigh: confidences.filter((c) => c > 80).length,
  };

  return {
    mean: Math.round(mean * 100) / 100,
    median,
    stdDev: Math.round(stdDev * 100) / 100,
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
    ? amounts.reduce((a, b) => a + b, 0) / amounts.length
    : 0;
  const maxPositionSize = amounts.length > 0 ? Math.max(...amounts) : 0;

  // Trade frequency: non-hold decisions / total decisions
  const nonHolds = decisions.filter((d) => d.action !== "hold").length;
  const tradeFrequency =
    decisions.length > 0 ? Math.round((nonHolds / decisions.length) * 100) / 100 : 0;

  return {
    avgPositionSize: Math.round(avgPositionSize * 100) / 100,
    maxPositionSize: Math.round(maxPositionSize * 100) / 100,
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

  const recent = sentiments.slice(0, 10);
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
  const nonZeroCount = sentiments.filter((s) => s !== 0).length;
  const biasVolatility =
    nonZeroCount > 1
      ? Math.round((flips / (nonZeroCount - 1)) * 100) / 100
      : 0;

  return {
    overallBias: round3(overallBias),
    recentBias: round3(recentBias),
    biasVolatility,
    contrarian: biasVolatility > 0.6, // More than 60% of decisions flip
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
    confidence.stdDev / 50,  // Normalize: max reasonable stdDev ~50
    confidence.median / 100,
    // Risk appetite (3 dims)
    Math.min(1, risk.avgPositionSize / 5000), // Normalize: max $5000
    Math.min(1, risk.maxPositionSize / 10000),
    risk.tradeFrequency,
    // Sentiment (3 dims)
    (sentiment.overallBias + 1) / 2, // Map -1..1 to 0..1
    (sentiment.recentBias + 1) / 2,
    sentiment.biasVolatility,
    // Stock diversity (2 dims)
    Math.min(1, stocks.length / 10),
    stocks.length > 0 ? stocks[0].weight / 100 : 0, // Concentration in top stock
    // Activity (2 dims)
    Math.min(1, actions.totalDecisions / 100),
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
      .limit(100);

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
      if (i < j && Math.abs(corr) > 0.5) {
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
  if (n < 3) return 0;

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
  if (buyDiff > 15) {
    const moreBullish = fpA.actionDistribution.buyPercent > fpB.actionDistribution.buyPercent
      ? fpA.agentId : fpB.agentId;
    notes.push(`${moreBullish} is significantly more bullish (${buyDiff.toFixed(0)}% more buy decisions)`);
  }

  // Compare confidence
  const confDiff = Math.abs(fpA.confidenceProfile.mean - fpB.confidenceProfile.mean);
  if (confDiff > 15) {
    const moreConfident = fpA.confidenceProfile.mean > fpB.confidenceProfile.mean
      ? fpA.agentId : fpB.agentId;
    notes.push(`${moreConfident} has higher average confidence (${confDiff.toFixed(0)} points)`);
  }

  // Compare sentiment bias
  const sentDiff = Math.abs(fpA.sentimentBias.overallBias - fpB.sentimentBias.overallBias);
  if (sentDiff > 0.3) {
    notes.push(`Different market outlook: bias difference of ${sentDiff.toFixed(2)}`);
  }

  // Compare top stocks
  const topA = new Set(fpA.topStocks.slice(0, 3).map((s) => s.symbol));
  const topB = new Set(fpB.topStocks.slice(0, 3).map((s) => s.symbol));
  const overlap = [...topA].filter((s) => topB.has(s));
  if (overlap.length === 0 && topA.size > 0 && topB.size > 0) {
    notes.push("No overlap in top 3 traded stocks — very different sector preferences");
  } else if (overlap.length === 3) {
    notes.push("Same top 3 stocks — converging on similar opportunities");
  }

  // Compare trade frequency
  const freqDiff = Math.abs(fpA.riskAppetite.tradeFrequency - fpB.riskAppetite.tradeFrequency);
  if (freqDiff > 0.3) {
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
  if (actions.holdPercent > 60) {
    parts.push("cautious trader (mostly holds)");
  } else if (actions.buyPercent > 50) {
    parts.push("aggressive buyer");
  } else if (actions.sellPercent > 40) {
    parts.push("active seller / profit-taker");
  } else {
    parts.push("balanced trader");
  }

  // Sentiment
  if (sentiment.overallBias > 0.3) {
    parts.push("bullish bias");
  } else if (sentiment.overallBias < -0.3) {
    parts.push("bearish bias");
  } else {
    parts.push("neutral market view");
  }

  // Confidence
  if (confidence.mean > 70) {
    parts.push("high conviction decisions");
  } else if (confidence.mean < 40) {
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
  const overall = await generateFingerprint(agentId, { lookbackRounds: 200 });
  const recent = await generateFingerprint(agentId, { lookbackRounds: 20 });

  if (overall.roundsAnalyzed < 30) {
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
  const hasDrift = driftScore > 0.5; // Threshold for significant drift

  return { hasDrift, driftScore, dimensions };
}
