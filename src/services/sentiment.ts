/**
 * News Sentiment Analysis Engine
 *
 * Comprehensive sentiment analysis system that fuses multiple signal sources:
 * AI agent decisions, price momentum, volume analysis, simulated social signals,
 * and generated news headlines to produce composite sentiment scores for every
 * tracked stock.
 *
 * Core capabilities:
 *   - Per-stock multi-factor sentiment scoring (-100 to +100)
 *   - Sentiment heatmap (stock x timeframe grid)
 *   - Sentiment shift detection with trigger analysis
 *   - Per-agent sentiment profiling (bullishness, consistency, contrarian score)
 *   - Cross-agent sentiment correlation matrix
 *   - Simulated financial news digest with sentiment tags
 *   - Sector-level sentiment aggregation
 *   - Point-in-time sentiment timeline
 *   - Market mood index (fear/greed gauge)
 *
 * This is MoltApp's "market psychology" layer -- quantifying the collective
 * mood of the 3 AI agents, price action, and market structure into a single
 * unified sentiment framework.
 */

import { db } from "../db/index.ts";
import { agentDecisions } from "../db/schema/agent-decisions.ts";
import { eq, desc, gte, and, sql } from "drizzle-orm";
import { getMarketData, getAgentConfigs } from "../agents/orchestrator.ts";
import type { MarketData } from "../agents/base-agent.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Composite sentiment score for a single stock */
export interface SentimentScore {
  symbol: string;
  overall: number; // -100 to +100
  components: {
    agentSentiment: number;    // From AI agent decisions
    momentumSentiment: number; // From price action
    volumeSentiment: number;   // From volume analysis
    socialSentiment: number;   // From simulated social signals
    newsSentiment: number;     // From news keywords
  };
  signal: "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell";
  confidence: number;
  drivers: SentimentDriver[];
  generatedAt: string;
}

/** A single factor contributing to the composite sentiment */
export interface SentimentDriver {
  source: string;
  impact: number; // -100 to +100
  description: string;
  weight: number; // how much this contributes to overall
}

/** A simulated news headline with sentiment metadata */
export interface NewsSentiment {
  headline: string;
  source: string;
  sentiment: number; // -1 to +1
  symbols: string[];
  category: "earnings" | "macro" | "regulatory" | "product" | "market" | "analyst" | "insider";
  publishedAt: string;
}

/** Grid of sentiment values across stocks and timeframes */
export interface SentimentHeatmap {
  symbols: string[];
  timeframes: string[];
  cells: Array<{
    symbol: string;
    timeframe: string;
    sentiment: number;
    signal: string;
    dominantDriver: string;
  }>;
}

/** Detected change in sentiment for a stock */
export interface SentimentShift {
  symbol: string;
  previousSentiment: number;
  currentSentiment: number;
  change: number;
  direction: "improving" | "deteriorating" | "stable";
  significance: "major" | "moderate" | "minor";
  triggers: string[];
  detectedAt: string;
}

/** Sentiment profile for an individual AI agent */
interface AgentSentimentProfile {
  agentId: string;
  agentName: string;
  provider: string;
  overallBias: number; // -100 bullish to +100 bearish
  biasLabel: string;
  averageConfidence: number;
  totalDecisions: number;
  mostBullishStock: { symbol: string; score: number } | null;
  mostBearishStock: { symbol: string; score: number } | null;
  consistencyScore: number; // 0-100 how consistent are they
  flipFlopRate: number; // % of decisions that reversed previous
  contrarianScore: number; // 0-100 how often they disagree with consensus
  recentBias: number; // bias from last 10 decisions only
}

/** Correlation data between two agents */
interface AgentPairCorrelation {
  agent1: string;
  agent2: string;
  correlation: number; // -1 to +1
  agreementRate: number; // percentage
  sampleSize: number;
}

/** Full correlation matrix for all agents */
interface SentimentCorrelation {
  agents: string[];
  matrix: AgentPairCorrelation[];
  consensusStocks: Array<{ symbol: string; direction: string; confidence: number }>;
  divergenceStocks: Array<{ symbol: string; agents: Record<string, string>; spread: number }>;
  insights: string[];
}

/** Sector-level sentiment aggregation */
interface SectorSentimentData {
  sector: string;
  sentiment: number;
  signal: string;
  stockCount: number;
  stocks: Array<{ symbol: string; sentiment: number }>;
  leadingStock: string;
  laggingStock: string;
}

/** Overall market mood index */
interface MarketMoodIndex {
  value: number; // -100 to +100
  label: string;
  classification: "extreme_fear" | "fear" | "neutral" | "greed" | "extreme_greed";
  components: {
    agentMood: number;
    priceMomentum: number;
    volumeTrend: number;
    breadth: number; // % of stocks with positive sentiment
  };
  description: string;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Sector classification for each tracked stock */
const SECTOR_MAP: Record<string, string> = {
  AAPLx: "Technology",
  AMZNx: "Consumer",
  GOOGLx: "Technology",
  METAx: "Technology",
  MSFTx: "Technology",
  NVDAx: "Technology",
  TSLAx: "Automotive",
  SPYx: "Index",
  QQQx: "Index",
  COINx: "Crypto",
  MSTRx: "Crypto",
  HOODx: "Fintech",
  NFLXx: "Entertainment",
  PLTRx: "Technology",
  GMEx: "Meme",
  LLYx: "Healthcare",
  CRMx: "Technology",
  AVGOx: "Technology",
  JPMx: "Finance",
};

/** Component weights for the composite sentiment score */
const SENTIMENT_WEIGHTS = {
  agentSentiment: 0.35,
  momentumSentiment: 0.25,
  volumeSentiment: 0.15,
  socialSentiment: 0.10,
  newsSentiment: 0.15,
};

/** Sentiment scoring algorithm thresholds and parameters */
const SENTIMENT_THRESHOLDS = {
  // Momentum sentiment thresholds (% change)
  MOMENTUM_STRONG: 3,           // |change| > 3% = strong momentum
  MOMENTUM_MODERATE: 1,         // |change| > 1% = moderate momentum
  PRICE_CHANGE_DIVISOR: 5,      // Maps ±5% price change to ±100 sentiment score

  // Volume sentiment parameters
  AVERAGE_VOLUME_BENCHMARK: 100_000_000,  // $100M assumed average daily volume
  VOLUME_RATIO_HIGH: 1.5,       // Volume ratio >1.5x = high conviction
  VOLUME_RATIO_LOW: 0.5,        // Volume ratio <0.5x = low conviction
  VOLUME_SCORE_MULTIPLIER: 30,  // Amplification factor for high-volume moves
  VOLUME_HIGH_SCORE: 20,        // Score for normal volume + positive price
  VOLUME_LOW_SCORE: 10,         // Score for low volume (dampened signal)

  // Social sentiment parameters
  SOCIAL_PRICE_INFLUENCE_MULT: 50,    // Price influence on social sentiment
  SOCIAL_NOISE_MIN: -30,              // Random noise floor for variety
  SOCIAL_NOISE_MAX: 30,               // Random noise ceiling for variety
  SOCIAL_KEYWORD_THRESHOLD: 3,        // keywords.length > 3 = popular stock
  SOCIAL_KEYWORD_BOOST: 10,           // Sentiment boost for popular stocks

  // News sentiment parameters
  NEWS_PRICE_INFLUENCE_MULT: 60,      // Price influence on news sentiment
  NEWS_NOISE_MIN: -15,                // Random noise floor for variety
  NEWS_NOISE_MAX: 15,                 // Random noise ceiling for variety

  // Sentiment shift detection thresholds
  SHIFT_MAJOR_THRESHOLD: 5,           // |change| > 5 = major shift direction
  SHIFT_MAJOR_SIGNIFICANCE: 30,       // |change| > 30 = major shift magnitude
  SHIFT_MODERATE_SIGNIFICANCE: 15,    // |change| > 15 = moderate shift magnitude

  // Impact detection thresholds (trigger identification)
  AGENT_IMPACT_THRESHOLD: 40,         // |agentSentiment| > 40 = consensus trigger
  MOMENTUM_IMPACT_THRESHOLD: 50,      // |momentumSentiment| > 50 = price trigger
  VOLUME_IMPACT_THRESHOLD: 40,        // |volumeSentiment| > 40 = volume trigger
  NEWS_IMPACT_THRESHOLD: 40,          // |newsSentiment| > 40 = news trigger

  // Sentiment signal classification
  STRONG_BUY_THRESHOLD: 40,           // overall > 40 = strong_buy
  BUY_THRESHOLD: 15,                  // overall > 15 = buy
  SELL_THRESHOLD: -15,                // overall < -15 = sell
  STRONG_SELL_THRESHOLD: -40,         // overall < -40 = strong_sell

  // Signal strength classification
  SENTIMENT_STRONG: 20,               // |score| > 20 = strong sentiment
} as const;

/** The 3 AI agent IDs */
const AGENT_IDS = [
  "claude-value-investor",
  "gpt-momentum-trader",
  "grok-contrarian",
];

/** Simulated news sources */
const NEWS_SOURCES = [
  "Reuters", "Bloomberg", "CNBC", "MarketWatch", "Financial Times",
  "Wall Street Journal", "Barrons", "Seeking Alpha", "The Motley Fool",
  "Yahoo Finance",
];

/** Simulated social keywords associated with stock characteristics */
const SOCIAL_KEYWORDS: Record<string, string[]> = {
  AAPLx: ["iPhone", "Apple Vision Pro", "services revenue", "buyback"],
  AMZNx: ["AWS", "Prime", "logistics", "AI cloud"],
  GOOGLx: ["search monopoly", "Gemini AI", "ad revenue", "antitrust"],
  METAx: ["metaverse", "Instagram Reels", "AI investment", "ad targeting"],
  MSFTx: ["Azure", "Copilot", "enterprise AI", "Office 365"],
  NVDAx: ["GPU shortage", "data center", "AI chips", "Jensen"],
  TSLAx: ["Cybertruck", "FSD", "Elon", "EV competition"],
  SPYx: ["S&P 500", "market rally", "risk-on", "index rebalance"],
  QQQx: ["Nasdaq", "tech rally", "growth stocks", "FAANG"],
  COINx: ["crypto exchange", "Bitcoin ETF", "regulation", "trading volume"],
  MSTRx: ["Bitcoin treasury", "Michael Saylor", "BTC accumulation", "leverage"],
  HOODx: ["retail trading", "options", "meme stocks", "commission-free"],
  NFLXx: ["subscriber growth", "password sharing", "streaming wars", "ad tier"],
  PLTRx: ["government contracts", "AI analytics", "defense", "big data"],
  GMEx: ["diamond hands", "short squeeze", "meme rally", "DFV"],
  LLYx: ["GLP-1", "weight loss drug", "pharma pipeline", "FDA approval"],
  CRMx: ["Salesforce AI", "enterprise cloud", "CRM market", "acquisitions"],
  AVGOx: ["semiconductors", "VMware", "networking chips", "AI infrastructure"],
  JPMx: ["banking", "interest rates", "Jamie Dimon", "investment banking"],
};

// ---------------------------------------------------------------------------
// Deterministic Seed Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic-ish hash from a string.
 * Used to produce stable but varied simulated values within a session.
 */
function hashSeed(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return Math.abs(hash);
}

/**
 * Seeded pseudo-random number in [min, max] range.
 * Combines the seed with the current hour so values shift over time
 * but remain stable within the same hour.
 */
function seededRandom(seed: string, min: number, max: number): number {
  const hourKey = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
  const h = hashSeed(seed + hourKey);
  const normalized = (h % 10000) / 10000; // 0..1
  return min + normalized * (max - min);
}

// ---------------------------------------------------------------------------
// Component Sentiment Calculators
// ---------------------------------------------------------------------------

/**
 * Compute agent-based sentiment for a symbol from recent decisions.
 * Maps buy -> positive, sell -> negative, hold -> neutral, weighted by confidence.
 */
async function computeAgentSentiment(symbol: string): Promise<{ score: number; drivers: SentimentDriver[] }> {
  const drivers: SentimentDriver[] = [];
  let weightedSum = 0;
  let totalWeight = 0;

  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // last 7 days
    const decisions = await db
      .select()
      .from(agentDecisions)
      .where(
        and(
          eq(agentDecisions.symbol, symbol),
          gte(agentDecisions.createdAt, cutoff),
        ),
      )
      .orderBy(desc(agentDecisions.createdAt))
      .limit(30);

    if (decisions.length === 0) {
      return { score: 0, drivers: [{ source: "agent_decisions", impact: 0, description: "No recent agent decisions for this stock", weight: SENTIMENT_WEIGHTS.agentSentiment }] };
    }

    const agentConfigs = getAgentConfigs();

    for (const d of decisions) {
      const actionScore = d.action === "buy" ? 1 : d.action === "sell" ? -1 : 0;
      const confidence = d.confidence / 100;
      // More recent decisions get higher weight (recency decay)
      const ageHours = (Date.now() - new Date(d.createdAt).getTime()) / (1000 * 60 * 60);
      const recencyWeight = Math.max(0.1, 1 - ageHours / (7 * 24));

      const w = confidence * recencyWeight;
      weightedSum += actionScore * w;
      totalWeight += w;
    }

    const rawScore = totalWeight > 0 ? (weightedSum / totalWeight) * 100 : 0;
    const score = Math.max(-100, Math.min(100, rawScore));

    // Build driver descriptions per agent
    for (const agentId of AGENT_IDS) {
      const agentDecs = decisions.filter((d: typeof decisions[number]) => d.agentId === agentId);
      if (agentDecs.length === 0) continue;

      const agentConfig = agentConfigs.find((a) => a.agentId === agentId);
      const buys = agentDecs.filter((d: typeof agentDecs[number]) => d.action === "buy").length;
      const sells = agentDecs.filter((d: typeof agentDecs[number]) => d.action === "sell").length;
      const holds = agentDecs.filter((d: typeof agentDecs[number]) => d.action === "hold").length;
      const avgConf = agentDecs.reduce((s: number, d: typeof agentDecs[number]) => s + d.confidence, 0) / agentDecs.length;
      const latest = agentDecs[0];

      const direction = buys > sells ? "bullish" : sells > buys ? "bearish" : "neutral";
      const agentImpact = buys > sells ? avgConf : sells > buys ? -avgConf : 0;

      drivers.push({
        source: `agent:${agentId}`,
        impact: Math.round(agentImpact),
        description: `${agentConfig?.name ?? agentId} is ${direction} (${buys}B/${sells}S/${holds}H, avg confidence ${Math.round(avgConf)}%). Latest: ${latest.action} at confidence ${latest.confidence}%`,
        weight: SENTIMENT_WEIGHTS.agentSentiment / AGENT_IDS.length,
      });
    }

    return { score, drivers };
  } catch (error) {
    console.error(`[Sentiment] Agent sentiment error for ${symbol}:`, error);
    return { score: 0, drivers: [{ source: "agent_decisions", impact: 0, description: "Error computing agent sentiment", weight: SENTIMENT_WEIGHTS.agentSentiment }] };
  }
}

/**
 * Compute momentum-based sentiment from 24h price change.
 * Strong moves map to extreme sentiment; small moves stay near neutral.
 */
function computeMomentumSentiment(marketData: MarketData): { score: number; driver: SentimentDriver } {
  const change = marketData.change24h ?? 0;

  // Map % change to sentiment: +-5% -> +-100
  let score = (change / SENTIMENT_THRESHOLDS.PRICE_CHANGE_DIVISOR) * 100;
  score = Math.max(-100, Math.min(100, score));

  const direction = change > SENTIMENT_THRESHOLDS.MOMENTUM_MODERATE ? "positive" : change < -SENTIMENT_THRESHOLDS.MOMENTUM_MODERATE ? "negative" : "flat";
  const strength = Math.abs(change) > SENTIMENT_THRESHOLDS.MOMENTUM_STRONG ? "strong" : Math.abs(change) > SENTIMENT_THRESHOLDS.MOMENTUM_MODERATE ? "moderate" : "mild";

  return {
    score,
    driver: {
      source: "price_momentum",
      impact: Math.round(score),
      description: `${strength} ${direction} momentum: ${change > 0 ? "+" : ""}${change.toFixed(2)}% in 24h at $${marketData.price.toFixed(2)}`,
      weight: SENTIMENT_WEIGHTS.momentumSentiment,
    },
  };
}

/**
 * Compute volume-based sentiment.
 * Above-average volume amplifies the current price direction.
 * Below-average volume suggests lack of conviction.
 */
function computeVolumeSentiment(marketData: MarketData): { score: number; driver: SentimentDriver } {
  const volume = marketData.volume24h ?? 0;
  // Assume average volume is ~$100M for these stocks
  const averageVolume = SENTIMENT_THRESHOLDS.AVERAGE_VOLUME_BENCHMARK;
  const volumeRatio = volume / averageVolume;

  let score: number;
  const change = marketData.change24h ?? 0;

  if (volumeRatio > SENTIMENT_THRESHOLDS.VOLUME_RATIO_HIGH) {
    // High volume amplifies the price direction
    score = change > 0 ? Math.min(100, volumeRatio * SENTIMENT_THRESHOLDS.VOLUME_SCORE_MULTIPLIER) : Math.max(-100, -volumeRatio * SENTIMENT_THRESHOLDS.VOLUME_SCORE_MULTIPLIER);
  } else if (volumeRatio < SENTIMENT_THRESHOLDS.VOLUME_RATIO_LOW) {
    // Low volume = low conviction, dampen signal
    score = change > 0 ? SENTIMENT_THRESHOLDS.VOLUME_LOW_SCORE : change < 0 ? -SENTIMENT_THRESHOLDS.VOLUME_LOW_SCORE : 0;
  } else {
    // Normal volume
    score = change > 0 ? SENTIMENT_THRESHOLDS.VOLUME_HIGH_SCORE : change < 0 ? -SENTIMENT_THRESHOLDS.VOLUME_HIGH_SCORE : 0;
  }

  score = Math.max(-100, Math.min(100, score));
  const volLabel = volumeRatio > SENTIMENT_THRESHOLDS.VOLUME_RATIO_HIGH ? "above average" : volumeRatio < SENTIMENT_THRESHOLDS.VOLUME_RATIO_LOW ? "below average" : "normal";
  const volFormatted = volume > 0 ? `$${(volume / 1_000_000).toFixed(1)}M` : "N/A";

  return {
    score,
    driver: {
      source: "volume_analysis",
      impact: Math.round(score),
      description: `Volume ${volLabel} (${volFormatted}, ${volumeRatio.toFixed(1)}x avg). ${volumeRatio > 1.5 ? "High conviction move." : volumeRatio < 0.5 ? "Low conviction - signal weakened." : "Normal activity."}`,
      weight: SENTIMENT_WEIGHTS.volumeSentiment,
    },
  };
}

/**
 * Compute simulated social sentiment based on stock characteristics.
 * Uses keyword matching and seeded randomization for variety.
 */
function computeSocialSentiment(symbol: string, marketData: MarketData): { score: number; driver: SentimentDriver } {
  const keywords = SOCIAL_KEYWORDS[symbol] ?? [];
  const change = marketData.change24h ?? 0;

  // Base social sentiment loosely follows price with noise
  const priceInfluence = (change / SENTIMENT_THRESHOLDS.PRICE_CHANGE_DIVISOR) * SENTIMENT_THRESHOLDS.SOCIAL_PRICE_INFLUENCE_MULT;
  const socialNoise = seededRandom(`social-${symbol}`, SENTIMENT_THRESHOLDS.SOCIAL_NOISE_MIN, SENTIMENT_THRESHOLDS.SOCIAL_NOISE_MAX);
  const keywordBoost = keywords.length > SENTIMENT_THRESHOLDS.SOCIAL_KEYWORD_THRESHOLD ? SENTIMENT_THRESHOLDS.SOCIAL_KEYWORD_BOOST : 0; // popular stocks get a mention boost

  let score = priceInfluence + socialNoise + keywordBoost;
  score = Math.max(-100, Math.min(100, score));

  const mentionCount = Math.round(seededRandom(`mentions-${symbol}`, 50, 5000));
  const buzzWord = keywords.length > 0 ? keywords[hashSeed(symbol + new Date().toISOString().slice(0, 13)) % keywords.length] : symbol;

  return {
    score,
    driver: {
      source: "social_signals",
      impact: Math.round(score),
      description: `~${mentionCount.toLocaleString()} social mentions. Trending topic: "${buzzWord}". Sentiment ${score > 20 ? "positive" : score < -20 ? "negative" : "mixed"}.`,
      weight: SENTIMENT_WEIGHTS.socialSentiment,
    },
  };
}

/**
 * Compute news-based sentiment from simulated news conditions.
 * Generates a sentiment score based on the stock's current state.
 */
function computeNewsSentiment(symbol: string, marketData: MarketData): { score: number; driver: SentimentDriver } {
  const change = marketData.change24h ?? 0;
  const sector = SECTOR_MAP[symbol] ?? "General";

  // News sentiment correlates with price action but with a bias toward the sector narrative
  const sectorBias = getSectorBias(sector);
  const priceInfluence = (change / SENTIMENT_THRESHOLDS.PRICE_CHANGE_DIVISOR) * SENTIMENT_THRESHOLDS.NEWS_PRICE_INFLUENCE_MULT;
  const newsNoise = seededRandom(`news-${symbol}`, SENTIMENT_THRESHOLDS.NEWS_NOISE_MIN, SENTIMENT_THRESHOLDS.NEWS_NOISE_MAX);

  let score = priceInfluence + sectorBias + newsNoise;
  score = Math.max(-100, Math.min(100, score));

  const headline = generateSingleHeadline(symbol, marketData, score);

  return {
    score,
    driver: {
      source: "news_sentiment",
      impact: Math.round(score),
      description: `Latest: "${headline}". News flow ${score > 20 ? "positive" : score < -20 ? "negative" : "neutral"} for ${sector} sector.`,
      weight: SENTIMENT_WEIGHTS.newsSentiment,
    },
  };
}

/**
 * Get a sector-level bias to add to news sentiment.
 * Simulates macro narratives (e.g. "AI boom" boosts tech sentiment).
 */
function getSectorBias(sector: string): number {
  const biases: Record<string, number> = {
    Technology: seededRandom("sector-tech", 5, 20),
    Consumer: seededRandom("sector-consumer", -5, 10),
    Automotive: seededRandom("sector-auto", -15, 15),
    Index: seededRandom("sector-index", -5, 10),
    Crypto: seededRandom("sector-crypto", -25, 25),
    Fintech: seededRandom("sector-fintech", -10, 15),
    Entertainment: seededRandom("sector-entertain", -10, 15),
    Meme: seededRandom("sector-meme", -30, 30),
    Healthcare: seededRandom("sector-health", 0, 20),
    Finance: seededRandom("sector-finance", -5, 15),
    General: 0,
  };
  return biases[sector] ?? 0;
}

/**
 * Generate a single realistic headline for a stock.
 */
function generateSingleHeadline(symbol: string, marketData: MarketData, sentimentScore: number): string {
  const name = marketData.name ?? symbol.replace("x", "");
  const change = marketData.change24h ?? 0;

  if (sentimentScore > 50) {
    const templates = [
      `${name} Surges as Analysts Raise Price Targets`,
      `${name} Hits New Highs on Strong Institutional Buying`,
      `Wall Street Turns Bullish on ${name} Amid Growth Acceleration`,
    ];
    return templates[hashSeed(symbol + "pos") % templates.length];
  } else if (sentimentScore > 20) {
    const templates = [
      `${name} Ticks Higher on Positive Sector Sentiment`,
      `${name} Sees Steady Inflows as Market Confidence Builds`,
      `Analysts Maintain Overweight Rating on ${name}`,
    ];
    return templates[hashSeed(symbol + "mpos") % templates.length];
  } else if (sentimentScore < -50) {
    const templates = [
      `${name} Plunges on Profit-Taking and Macro Concerns`,
      `${name} Under Pressure as Sector Rotation Accelerates`,
      `Investors Flee ${name} on Weakening Fundamentals`,
    ];
    return templates[hashSeed(symbol + "neg") % templates.length];
  } else if (sentimentScore < -20) {
    const templates = [
      `${name} Slips as Growth Outlook Softens`,
      `${name} Faces Headwinds from Rising Competition`,
      `Analysts Flag Near-Term Risks for ${name}`,
    ];
    return templates[hashSeed(symbol + "mneg") % templates.length];
  } else {
    const templates = [
      `${name} Trades Flat as Market Awaits Catalysts`,
      `${name} Consolidates Near Key Levels`,
      `Mixed Signals Keep ${name} Range-Bound`,
    ];
    return templates[hashSeed(symbol + "neutral") % templates.length];
  }
}

/**
 * Classify a raw sentiment score (-100 to +100) into a signal label.
 */
function classifySignal(score: number): "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell" {
  if (score >= 60) return "strong_buy";
  if (score >= 20) return "buy";
  if (score <= -60) return "strong_sell";
  if (score <= -20) return "sell";
  return "neutral";
}

/**
 * Classify a mood value into a fear/greed label.
 */
function classifyMood(value: number): "extreme_fear" | "fear" | "neutral" | "greed" | "extreme_greed" {
  if (value <= -60) return "extreme_fear";
  if (value <= -20) return "fear";
  if (value >= 60) return "extreme_greed";
  if (value >= 20) return "greed";
  return "neutral";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the full multi-factor sentiment breakdown for a single stock.
 *
 * Combines agent decisions, price momentum, volume analysis, simulated
 * social signals, and news sentiment into a weighted composite score
 * with individual driver details.
 *
 * @param symbol - Stock symbol (e.g. "AAPLx")
 * @returns Composite sentiment score with component breakdown and drivers
 */
export async function getStockSentiment(symbol: string): Promise<SentimentScore | null> {
  try {
    const allMarket = await getMarketData();
    const marketData = allMarket.find(
      (m) => m.symbol.toLowerCase() === symbol.toLowerCase(),
    );

    if (!marketData) return null;

    // Compute all components in parallel where possible
    const agentResult = await computeAgentSentiment(symbol);
    const momentumResult = computeMomentumSentiment(marketData);
    const volumeResult = computeVolumeSentiment(marketData);
    const socialResult = computeSocialSentiment(symbol, marketData);
    const newsResult = computeNewsSentiment(symbol, marketData);

    // Weighted composite
    const overall =
      agentResult.score * SENTIMENT_WEIGHTS.agentSentiment +
      momentumResult.score * SENTIMENT_WEIGHTS.momentumSentiment +
      volumeResult.score * SENTIMENT_WEIGHTS.volumeSentiment +
      socialResult.score * SENTIMENT_WEIGHTS.socialSentiment +
      newsResult.score * SENTIMENT_WEIGHTS.newsSentiment;

    const clampedOverall = Math.max(-100, Math.min(100, Math.round(overall)));

    // Aggregate drivers
    const drivers: SentimentDriver[] = [
      ...agentResult.drivers,
      momentumResult.driver,
      volumeResult.driver,
      socialResult.driver,
      newsResult.driver,
    ];

    // Confidence is the average of all driver absolute impacts, normalized
    const avgAbsImpact = drivers.reduce((s, d) => s + Math.abs(d.impact), 0) / drivers.length;
    const confidence = Math.min(100, Math.round(avgAbsImpact));

    return {
      symbol,
      overall: clampedOverall,
      components: {
        agentSentiment: Math.round(agentResult.score),
        momentumSentiment: Math.round(momentumResult.score),
        volumeSentiment: Math.round(volumeResult.score),
        socialSentiment: Math.round(socialResult.score),
        newsSentiment: Math.round(newsResult.score),
      },
      signal: classifySignal(clampedOverall),
      confidence,
      drivers,
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`[Sentiment] Error computing sentiment for ${symbol}:`, error);
    return null;
  }
}

/**
 * Get sentiment scores for all tracked stocks, sorted by absolute strength.
 *
 * @returns Array of sentiment scores for every stock, strongest signal first
 */
export async function getAllSentiments(): Promise<SentimentScore[]> {
  const allMarket = await getMarketData();
  const symbols = allMarket.map((m) => m.symbol);

  const results: SentimentScore[] = [];
  for (const symbol of symbols) {
    const sentiment = await getStockSentiment(symbol);
    if (sentiment) results.push(sentiment);
  }

  // Sort by absolute overall strength (strongest signals first)
  results.sort((a, b) => Math.abs(b.overall) - Math.abs(a.overall));
  return results;
}

/**
 * Generate a sentiment heatmap: grid of sentiment by stock x timeframe.
 *
 * Since we do not have true multi-timeframe data, we simulate timeframe
 * variation by applying decay/noise factors to the base sentiment.
 *
 * @returns Heatmap with symbols, timeframes, and cell values
 */
export async function getSentimentHeatmap(): Promise<SentimentHeatmap> {
  const timeframes = ["1h", "4h", "1d", "1w"];
  const allSentiments = await getAllSentiments();
  const symbols = allSentiments.map((s) => s.symbol);

  const cells: SentimentHeatmap["cells"] = [];

  for (const sentiment of allSentiments) {
    for (const tf of timeframes) {
      // Simulate timeframe variation: shorter = noisier, longer = smoother
      const tfMultiplier: Record<string, number> = { "1h": 0.6, "4h": 0.8, "1d": 1.0, "1w": 1.1 };
      const noise = seededRandom(`${sentiment.symbol}-${tf}`, -15, 15);
      const tfSentiment = Math.max(-100, Math.min(100,
        Math.round(sentiment.overall * (tfMultiplier[tf] ?? 1) + noise),
      ));

      // Determine dominant driver for this cell
      const drivers = sentiment.drivers.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
      const dominant = drivers[0]?.source ?? "unknown";

      cells.push({
        symbol: sentiment.symbol,
        timeframe: tf,
        sentiment: tfSentiment,
        signal: classifySignal(tfSentiment),
        dominantDriver: dominant,
      });
    }
  }

  return { symbols, timeframes, cells };
}

/**
 * Detect stocks where sentiment has shifted significantly.
 *
 * Compares current sentiment to a simulated "previous" baseline to
 * identify major, moderate, and minor shifts with trigger analysis.
 *
 * @returns Array of detected sentiment shifts sorted by absolute change
 */
export async function detectSentimentShifts(): Promise<SentimentShift[]> {
  const allSentiments = await getAllSentiments();
  const shifts: SentimentShift[] = [];

  for (const current of allSentiments) {
    // Simulate previous sentiment (a few hours ago) with a baseline shift
    const previousBase = seededRandom(`prev-${current.symbol}`, -60, 60);
    const change = current.overall - previousBase;
    const absChange = Math.abs(change);

    const direction: SentimentShift["direction"] =
      change > SENTIMENT_THRESHOLDS.SHIFT_MAJOR_THRESHOLD ? "improving" : change < -SENTIMENT_THRESHOLDS.SHIFT_MAJOR_THRESHOLD ? "deteriorating" : "stable";
    const significance: SentimentShift["significance"] =
      absChange > SENTIMENT_THRESHOLDS.SHIFT_MAJOR_SIGNIFICANCE ? "major" : absChange > SENTIMENT_THRESHOLDS.SHIFT_MODERATE_SIGNIFICANCE ? "moderate" : "minor";

    // Identify triggers for the shift
    const triggers: string[] = [];
    if (Math.abs(current.components.agentSentiment) > SENTIMENT_THRESHOLDS.AGENT_IMPACT_THRESHOLD) {
      triggers.push("Strong agent consensus shift");
    }
    if (Math.abs(current.components.momentumSentiment) > SENTIMENT_THRESHOLDS.MOMENTUM_IMPACT_THRESHOLD) {
      triggers.push("Significant price movement");
    }
    if (Math.abs(current.components.volumeSentiment) > SENTIMENT_THRESHOLDS.VOLUME_IMPACT_THRESHOLD) {
      triggers.push("Volume anomaly detected");
    }
    if (Math.abs(current.components.newsSentiment) > SENTIMENT_THRESHOLDS.NEWS_IMPACT_THRESHOLD) {
      triggers.push("News flow sentiment change");
    }
    if (triggers.length === 0) {
      triggers.push("Gradual multi-factor drift");
    }

    shifts.push({
      symbol: current.symbol,
      previousSentiment: Math.round(previousBase),
      currentSentiment: current.overall,
      change: Math.round(change),
      direction,
      significance,
      triggers,
      detectedAt: new Date().toISOString(),
    });
  }

  // Sort by absolute change (biggest shifts first)
  shifts.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  return shifts;
}

/**
 * Profile a single AI agent's sentiment behavior.
 *
 * Analyzes the agent's decision history to determine overall bias,
 * consistency, flip-flop rate, and contrarian tendency.
 *
 * @param agentId - Agent identifier (e.g. "claude-value-investor")
 * @returns Detailed sentiment profile for the agent
 */
export async function getAgentSentimentProfile(agentId: string): Promise<AgentSentimentProfile | null> {
  try {
    const agentConfigs = getAgentConfigs();
    const config = agentConfigs.find((a) => a.agentId === agentId);
    if (!config) return null;

    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days
    const decisions = await db
      .select()
      .from(agentDecisions)
      .where(
        and(
          eq(agentDecisions.agentId, agentId),
          gte(agentDecisions.createdAt, cutoff),
        ),
      )
      .orderBy(desc(agentDecisions.createdAt))
      .limit(200);

    if (decisions.length === 0) {
      return {
        agentId,
        agentName: config.name,
        provider: config.provider,
        overallBias: 0,
        biasLabel: "No data",
        averageConfidence: 0,
        totalDecisions: 0,
        mostBullishStock: null,
        mostBearishStock: null,
        consistencyScore: 0,
        flipFlopRate: 0,
        contrarianScore: 0,
        recentBias: 0,
      };
    }

    // Overall bias: buy -> +1, sell -> -1, hold -> 0, weighted by confidence
    let biasSum = 0;
    let biasWeight = 0;
    const avgConf = decisions.reduce((s: number, d: typeof decisions[number]) => s + d.confidence, 0) / decisions.length;

    for (const d of decisions) {
      const actionVal = d.action === "buy" ? 1 : d.action === "sell" ? -1 : 0;
      biasSum += actionVal * (d.confidence / 100);
      biasWeight += d.confidence / 100;
    }

    const overallBias = biasWeight > 0
      ? Math.max(-100, Math.min(100, Math.round((biasSum / biasWeight) * 100)))
      : 0;

    const biasLabel =
      overallBias > 40 ? "Strongly Bullish" :
      overallBias > 15 ? "Bullish" :
      overallBias < -40 ? "Strongly Bearish" :
      overallBias < -15 ? "Bearish" :
      "Neutral";

    // Per-symbol sentiment
    const symbolScores: Record<string, { sum: number; count: number }> = {};
    for (const d of decisions) {
      const actionVal = d.action === "buy" ? d.confidence : d.action === "sell" ? -d.confidence : 0;
      if (!symbolScores[d.symbol]) symbolScores[d.symbol] = { sum: 0, count: 0 };
      symbolScores[d.symbol].sum += actionVal;
      symbolScores[d.symbol].count += 1;
    }

    const symbolAverages = Object.entries(symbolScores).map(([sym, data]) => ({
      symbol: sym,
      score: data.count > 0 ? data.sum / data.count : 0,
    }));

    symbolAverages.sort((a, b) => b.score - a.score);
    const mostBullishStock = symbolAverages.length > 0 ? { symbol: symbolAverages[0].symbol, score: Math.round(symbolAverages[0].score) } : null;
    const mostBearishStock = symbolAverages.length > 0 ? { symbol: symbolAverages[symbolAverages.length - 1].symbol, score: Math.round(symbolAverages[symbolAverages.length - 1].score) } : null;

    // Consistency: how often does the agent maintain the same direction on the same stock?
    let consistentPairs = 0;
    let totalPairs = 0;
    const decisionsBySymbol: Record<string, typeof decisions> = {};
    for (const d of decisions) {
      if (!decisionsBySymbol[d.symbol]) decisionsBySymbol[d.symbol] = [];
      decisionsBySymbol[d.symbol].push(d);
    }

    for (const symDecs of Object.values(decisionsBySymbol)) {
      for (let i = 0; i < symDecs.length - 1; i++) {
        totalPairs++;
        if (symDecs[i].action === symDecs[i + 1].action) consistentPairs++;
      }
    }

    const consistencyScore = totalPairs > 0 ? Math.round((consistentPairs / totalPairs) * 100) : 50;

    // Flip-flop rate: how often does the agent reverse on the same stock?
    let flipFlops = 0;
    for (const symDecs of Object.values(decisionsBySymbol)) {
      for (let i = 0; i < symDecs.length - 1; i++) {
        const prev = symDecs[i + 1].action;
        const curr = symDecs[i].action;
        if ((prev === "buy" && curr === "sell") || (prev === "sell" && curr === "buy")) {
          flipFlops++;
        }
      }
    }
    const flipFlopRate = totalPairs > 0 ? Math.round((flipFlops / totalPairs) * 100) : 0;

    // Contrarian score: how often does this agent disagree with the other agents' consensus?
    let contrarianCount = 0;
    let comparisonCount = 0;

    // Group all agent decisions by timestamp proximity (same round)
    const allDecisions = await db
      .select()
      .from(agentDecisions)
      .where(gte(agentDecisions.createdAt, cutoff))
      .orderBy(desc(agentDecisions.createdAt))
      .limit(500);

    // Group by round (decisions within 5 minutes of each other on the same symbol)
    const roundGroups: Record<string, typeof allDecisions> = {};
    for (const d of allDecisions) {
      const roundKey = `${d.symbol}-${Math.floor(new Date(d.createdAt).getTime() / (5 * 60 * 1000))}`;
      if (!roundGroups[roundKey]) roundGroups[roundKey] = [];
      roundGroups[roundKey].push(d);
    }

    for (const group of Object.values(roundGroups)) {
      if (group.length < 2) continue;
      const thisAgentDec = group.find((d: typeof allDecisions[number]) => d.agentId === agentId);
      const otherDecs = group.filter((d: typeof allDecisions[number]) => d.agentId !== agentId);
      if (!thisAgentDec || otherDecs.length === 0) continue;

      comparisonCount++;
      // Consensus of others
      const otherBuys = otherDecs.filter((d: typeof otherDecs[number]) => d.action === "buy").length;
      const otherSells = otherDecs.filter((d: typeof otherDecs[number]) => d.action === "sell").length;
      const otherConsensus = otherBuys > otherSells ? "buy" : otherSells > otherBuys ? "sell" : "hold";

      if (thisAgentDec.action !== otherConsensus && thisAgentDec.action !== "hold" && otherConsensus !== "hold") {
        contrarianCount++;
      }
    }

    const contrarianScore = comparisonCount > 0 ? Math.round((contrarianCount / comparisonCount) * 100) : 50;

    // Recent bias (last 10 decisions)
    const recent = decisions.slice(0, 10);
    let recentBiasSum = 0;
    for (const d of recent) {
      recentBiasSum += d.action === "buy" ? 1 : d.action === "sell" ? -1 : 0;
    }
    const recentBias = recent.length > 0 ? Math.round((recentBiasSum / recent.length) * 100) : 0;

    return {
      agentId,
      agentName: config.name,
      provider: config.provider,
      overallBias,
      biasLabel,
      averageConfidence: Math.round(avgConf),
      totalDecisions: decisions.length,
      mostBullishStock,
      mostBearishStock,
      consistencyScore,
      flipFlopRate,
      contrarianScore,
      recentBias: Math.max(-100, Math.min(100, recentBias)),
    };
  } catch (error) {
    console.error(`[Sentiment] Agent profile error for ${agentId}:`, error);
    return null;
  }
}

/**
 * Compute the cross-agent sentiment correlation matrix.
 *
 * Measures how often agents agree/disagree, identifies consensus
 * stocks and divergence stocks, and calculates pairwise correlation.
 *
 * @returns Correlation matrix, consensus stocks, divergence stocks, and insights
 */
export async function getSentimentCorrelation(): Promise<SentimentCorrelation> {
  const agentConfigs = getAgentConfigs();
  const agentIds = agentConfigs.map((a) => a.agentId);

  try {
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000); // 14 days
    const allDecisions = await db
      .select()
      .from(agentDecisions)
      .where(gte(agentDecisions.createdAt, cutoff))
      .orderBy(desc(agentDecisions.createdAt))
      .limit(1000);

    // Group by round (decisions within 5 min on same symbol)
    const roundGroups: Record<string, typeof allDecisions> = {};
    for (const d of allDecisions) {
      const roundKey = `${d.symbol}-${Math.floor(new Date(d.createdAt).getTime() / (5 * 60 * 1000))}`;
      if (!roundGroups[roundKey]) roundGroups[roundKey] = [];
      roundGroups[roundKey].push(d);
    }

    // Build pairwise correlation data
    const pairData: Record<string, { agreements: number; total: number; scores1: number[]; scores2: number[] }> = {};
    for (let i = 0; i < agentIds.length; i++) {
      for (let j = i + 1; j < agentIds.length; j++) {
        pairData[`${agentIds[i]}|${agentIds[j]}`] = { agreements: 0, total: 0, scores1: [], scores2: [] };
      }
    }

    // Symbol-level consensus tracking
    const symbolDecisions: Record<string, Record<string, string>> = {};

    for (const group of Object.values(roundGroups)) {
      if (group.length < 2) continue;

      const decByAgent: Record<string, typeof allDecisions[0]> = {};
      for (const d of group) {
        decByAgent[d.agentId] = d;
      }

      const symbol = group[0].symbol;
      if (!symbolDecisions[symbol]) symbolDecisions[symbol] = {};

      for (const [aid, dec] of Object.entries(decByAgent)) {
        symbolDecisions[symbol][aid] = dec.action;
      }

      // Pairwise comparisons
      for (let i = 0; i < agentIds.length; i++) {
        for (let j = i + 1; j < agentIds.length; j++) {
          const d1 = decByAgent[agentIds[i]];
          const d2 = decByAgent[agentIds[j]];
          if (!d1 || !d2) continue;

          const key = `${agentIds[i]}|${agentIds[j]}`;
          pairData[key].total++;
          if (d1.action === d2.action) pairData[key].agreements++;

          const score1 = d1.action === "buy" ? 1 : d1.action === "sell" ? -1 : 0;
          const score2 = d2.action === "buy" ? 1 : d2.action === "sell" ? -1 : 0;
          pairData[key].scores1.push(score1);
          pairData[key].scores2.push(score2);
        }
      }
    }

    // Calculate correlation coefficients
    const matrix: AgentPairCorrelation[] = [];
    for (const [key, data] of Object.entries(pairData)) {
      const [a1, a2] = key.split("|");
      const correlation = computePearson(data.scores1, data.scores2);
      matrix.push({
        agent1: a1,
        agent2: a2,
        correlation: Math.round(correlation * 100) / 100,
        agreementRate: data.total > 0 ? Math.round((data.agreements / data.total) * 100) : 0,
        sampleSize: data.total,
      });
    }

    // Consensus stocks: all agents recently agreed
    const consensusStocks: SentimentCorrelation["consensusStocks"] = [];
    const divergenceStocks: SentimentCorrelation["divergenceStocks"] = [];

    for (const [symbol, agents] of Object.entries(symbolDecisions)) {
      const actions = Object.values(agents);
      const uniqueActions = [...new Set(actions)];

      if (uniqueActions.length === 1 && actions.length >= 2) {
        consensusStocks.push({
          symbol,
          direction: uniqueActions[0] === "buy" ? "bullish" : uniqueActions[0] === "sell" ? "bearish" : "neutral",
          confidence: 100,
        });
      } else if (uniqueActions.length > 1 && actions.includes("buy") && actions.includes("sell")) {
        divergenceStocks.push({
          symbol,
          agents,
          spread: 100, // max spread when buy and sell coexist
        });
      }
    }

    // Generate insights
    const insights: string[] = [];
    const highCorr = matrix.filter((m) => m.correlation > 0.5);
    const lowCorr = matrix.filter((m) => m.correlation < -0.3);

    if (highCorr.length > 0) {
      insights.push(`${highCorr.map((m) => `${m.agent1.split("-")[0]} and ${m.agent2.split("-")[0]}`).join(", ")} show strong agreement (correlation > 0.5)`);
    }
    if (lowCorr.length > 0) {
      insights.push(`${lowCorr.map((m) => `${m.agent1.split("-")[0]} and ${m.agent2.split("-")[0]}`).join(", ")} frequently disagree (negative correlation)`);
    }
    if (consensusStocks.length > 0) {
      insights.push(`${consensusStocks.length} stock(s) have full agent consensus: ${consensusStocks.map((s) => s.symbol).join(", ")}`);
    }
    if (divergenceStocks.length > 0) {
      insights.push(`${divergenceStocks.length} stock(s) show agent divergence (opposing views): ${divergenceStocks.map((s) => s.symbol).join(", ")}`);
    }
    if (insights.length === 0) {
      insights.push("Insufficient recent decision data to compute meaningful correlations");
    }

    return {
      agents: agentIds,
      matrix,
      consensusStocks,
      divergenceStocks,
      insights,
    };
  } catch (error) {
    console.error("[Sentiment] Correlation error:", error);
    return {
      agents: agentIds,
      matrix: [],
      consensusStocks: [],
      divergenceStocks: [],
      insights: ["Error computing correlation data"],
    };
  }
}

/**
 * Compute Pearson correlation coefficient between two arrays.
 */
function computePearson(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i];
    sumY2 += y[i] * y[i];
  }

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

  if (denominator === 0) return 0;
  return numerator / denominator;
}

/**
 * Generate a simulated news digest for a stock or the entire market.
 *
 * Creates realistic financial headlines based on current price action,
 * recent agent decisions, volume anomalies, and sector movements.
 *
 * @param symbol - Optional stock symbol; omit for market-wide news
 * @returns Array of simulated news headlines with sentiment scores
 */
export async function generateNewsDigest(symbol?: string): Promise<NewsSentiment[]> {
  try {
    const allMarket = await getMarketData();
    const targets = symbol
      ? allMarket.filter((m) => m.symbol.toLowerCase() === symbol.toLowerCase())
      : allMarket;

    if (targets.length === 0) return [];

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentDecisions = await db
      .select()
      .from(agentDecisions)
      .where(gte(agentDecisions.createdAt, cutoff))
      .orderBy(desc(agentDecisions.createdAt))
      .limit(100);

    const news: NewsSentiment[] = [];

    for (const stock of targets) {
      const change = stock.change24h ?? 0;
      const volume = stock.volume24h ?? 0;
      const sector = SECTOR_MAP[stock.symbol] ?? "General";
      const keywords = SOCIAL_KEYWORDS[stock.symbol] ?? [];
      const stockDecisions = recentDecisions.filter((d: typeof recentDecisions[number]) => d.symbol === stock.symbol);
      const name = stock.name ?? stock.symbol.replace("x", "");

      // Generate 2-4 headlines per stock
      const headlineCount = symbol ? 4 : 2; // more for single stock view

      // Headline 1: Price action based
      const priceHeadline = generatePriceHeadline(name, stock.symbol, change, stock.price);
      news.push({
        headline: priceHeadline.text,
        source: NEWS_SOURCES[hashSeed(stock.symbol + "price") % NEWS_SOURCES.length],
        sentiment: Math.max(-1, Math.min(1, change / 5)),
        symbols: [stock.symbol],
        category: "market",
        publishedAt: new Date(Date.now() - hashSeed(stock.symbol + "t1") % (4 * 60 * 60 * 1000)).toISOString(),
      });

      // Headline 2: Agent decision based (if decisions exist)
      if (stockDecisions.length > 0) {
        const agentHeadline = generateAgentHeadline(name, stock.symbol, stockDecisions);
        news.push({
          headline: agentHeadline.text,
          source: NEWS_SOURCES[hashSeed(stock.symbol + "agent") % NEWS_SOURCES.length],
          sentiment: agentHeadline.sentiment,
          symbols: [stock.symbol],
          category: "analyst",
          publishedAt: new Date(Date.now() - hashSeed(stock.symbol + "t2") % (6 * 60 * 60 * 1000)).toISOString(),
        });
      }

      // Headline 3: Volume-based (if notable)
      if (volume > 150_000_000) {
        news.push({
          headline: `${name} Volume Surges ${((volume / 100_000_000) * 100 - 100).toFixed(0)}% Above Average on Heavy Institutional Activity`,
          source: NEWS_SOURCES[hashSeed(stock.symbol + "vol") % NEWS_SOURCES.length],
          sentiment: change > 0 ? 0.5 : -0.3,
          symbols: [stock.symbol],
          category: "market",
          publishedAt: new Date(Date.now() - hashSeed(stock.symbol + "t3") % (3 * 60 * 60 * 1000)).toISOString(),
        });
      }

      // Headline 4: Sector/keyword based
      if (headlineCount >= 4 && keywords.length > 0) {
        const keyword = keywords[hashSeed(stock.symbol + "kw" + new Date().toISOString().slice(0, 13)) % keywords.length];
        const sectorSentiment = seededRandom(`sector-news-${stock.symbol}`, -0.5, 0.5);
        const category = selectCategory(stock.symbol, sector);

        news.push({
          headline: generateKeywordHeadline(name, keyword, sectorSentiment),
          source: NEWS_SOURCES[hashSeed(stock.symbol + "sector") % NEWS_SOURCES.length],
          sentiment: Math.round(sectorSentiment * 100) / 100,
          symbols: [stock.symbol],
          category,
          publishedAt: new Date(Date.now() - hashSeed(stock.symbol + "t4") % (8 * 60 * 60 * 1000)).toISOString(),
        });
      }
    }

    // Add a couple of macro headlines for market-wide digest
    if (!symbol) {
      const spyData = allMarket.find((m) => m.symbol === "SPYx");
      const qqqData = allMarket.find((m) => m.symbol === "QQQx");

      if (spyData) {
        const spyChange = spyData.change24h ?? 0;
        news.push({
          headline: spyChange > 0
            ? `Markets Rally as S&P 500 Climbs ${spyChange.toFixed(1)}% on Risk Appetite`
            : spyChange < -1
            ? `Wall Street Selloff Deepens as S&P 500 Drops ${Math.abs(spyChange).toFixed(1)}%`
            : "Markets Tread Water as Traders Await Fed Signals",
          source: "Reuters",
          sentiment: Math.max(-1, Math.min(1, spyChange / 3)),
          symbols: ["SPYx"],
          category: "macro",
          publishedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        });
      }

      if (qqqData) {
        const qqqChange = qqqData.change24h ?? 0;
        news.push({
          headline: qqqChange > 1
            ? `Tech-Heavy Nasdaq Outperforms as AI Optimism Lifts Mega-Caps`
            : qqqChange < -1
            ? `Nasdaq Underperforms as Growth Stock Valuations Compress`
            : "Nasdaq Flat as Sector Rotation Continues",
          source: "Bloomberg",
          sentiment: Math.max(-1, Math.min(1, qqqChange / 3)),
          symbols: ["QQQx"],
          category: "macro",
          publishedAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
        });
      }
    }

    // Sort by publishedAt descending (newest first)
    news.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
    return news;
  } catch (error) {
    console.error("[Sentiment] News digest error:", error);
    return [];
  }
}

/** Generate a price-action headline */
function generatePriceHeadline(name: string, symbol: string, change: number, price: number): { text: string; sentiment: number } {
  if (change > 3) {
    return { text: `${name} Soars ${change.toFixed(1)}% to $${price.toFixed(2)} as Bulls Take Control`, sentiment: 0.8 };
  } else if (change > 1) {
    return { text: `${name} Gains ${change.toFixed(1)}% on Broad Market Strength`, sentiment: 0.4 };
  } else if (change < -3) {
    return { text: `${name} Tumbles ${Math.abs(change).toFixed(1)}% in Heavy Selling`, sentiment: -0.8 };
  } else if (change < -1) {
    return { text: `${name} Dips ${Math.abs(change).toFixed(1)}% Amid Cautious Trading`, sentiment: -0.4 };
  } else {
    return { text: `${name} Holds Steady at $${price.toFixed(2)} in Quiet Session`, sentiment: 0 };
  }
}

/** Generate a headline based on agent decisions */
function generateAgentHeadline(
  name: string,
  symbol: string,
  decisions: Array<{ action: string; agentId: string; confidence: number }>,
): { text: string; sentiment: number } {
  const buys = decisions.filter((d) => d.action === "buy");
  const sells = decisions.filter((d) => d.action === "sell");
  const avgConf = decisions.reduce((s, d) => s + d.confidence, 0) / decisions.length;

  if (buys.length > sells.length) {
    return {
      text: `AI Trading Models Signal Buy on ${name} with ${Math.round(avgConf)}% Average Confidence`,
      sentiment: 0.6,
    };
  } else if (sells.length > buys.length) {
    return {
      text: `AI Models Turn Cautious on ${name}, ${sells.length} of ${decisions.length} Recommend Sell`,
      sentiment: -0.5,
    };
  } else {
    return {
      text: `AI Agents Split on ${name} as Trading Models Diverge on Outlook`,
      sentiment: 0,
    };
  }
}

/** Generate a keyword/sector headline */
function generateKeywordHeadline(name: string, keyword: string, sentiment: number): string {
  if (sentiment > 0.2) {
    return `${name} Positioned to Benefit from ${keyword} Tailwinds, Analysts Say`;
  } else if (sentiment < -0.2) {
    return `${keyword} Headwinds Could Weigh on ${name}, Industry Watchers Warn`;
  } else {
    return `How ${keyword} Developments May Shape ${name}'s Next Quarter`;
  }
}

/** Select a news category based on stock/sector characteristics */
function selectCategory(symbol: string, sector: string): NewsSentiment["category"] {
  const categories: Record<string, NewsSentiment["category"]> = {
    Technology: "product",
    Crypto: "regulatory",
    Healthcare: "product",
    Finance: "earnings",
    Meme: "market",
    Fintech: "product",
    Entertainment: "earnings",
    Automotive: "product",
    Consumer: "earnings",
    Index: "macro",
  };
  return categories[sector] ?? "market";
}

/**
 * Aggregate sentiment by sector.
 *
 * Groups all stock sentiments by their sector classification and
 * computes average sentiment, leading/lagging stocks per sector.
 *
 * @returns Array of sector sentiment data sorted by sentiment strength
 */
export async function getSectorSentiment(): Promise<SectorSentimentData[]> {
  const allSentiments = await getAllSentiments();

  // Group by sector
  const sectorGroups: Record<string, SentimentScore[]> = {};
  for (const s of allSentiments) {
    const sector = SECTOR_MAP[s.symbol] ?? "Other";
    if (!sectorGroups[sector]) sectorGroups[sector] = [];
    sectorGroups[sector].push(s);
  }

  const sectors: SectorSentimentData[] = [];

  for (const [sector, stocks] of Object.entries(sectorGroups)) {
    const avgSentiment = stocks.reduce((sum, s) => sum + s.overall, 0) / stocks.length;
    const sorted = [...stocks].sort((a, b) => b.overall - a.overall);

    sectors.push({
      sector,
      sentiment: Math.round(avgSentiment),
      signal: classifySignal(Math.round(avgSentiment)),
      stockCount: stocks.length,
      stocks: stocks.map((s) => ({ symbol: s.symbol, sentiment: s.overall })),
      leadingStock: sorted[0]?.symbol ?? "N/A",
      laggingStock: sorted[sorted.length - 1]?.symbol ?? "N/A",
    });
  }

  // Sort by absolute sentiment strength
  sectors.sort((a, b) => Math.abs(b.sentiment) - Math.abs(a.sentiment));
  return sectors;
}

/**
 * Get sentiment history over time for a stock.
 *
 * Since we do not persist historical sentiment, this generates a
 * simulated timeline by replaying sentiment with time-shifted noise
 * to show how sentiment might have evolved.
 *
 * @param symbol - Stock symbol
 * @param hours - Number of hours to look back (default 24)
 * @returns Array of point-in-time sentiment snapshots
 */
export async function getSentimentTimeline(
  symbol: string,
  hours: number = 24,
): Promise<Array<{ timestamp: string; sentiment: number; signal: string; components: Record<string, number> }>> {
  const currentSentiment = await getStockSentiment(symbol);
  if (!currentSentiment) return [];

  const timeline: Array<{ timestamp: string; sentiment: number; signal: string; components: Record<string, number> }> = [];
  const now = Date.now();
  const intervalMs = Math.max(1, Math.floor(hours / 24)) * 60 * 60 * 1000; // 1h intervals for <= 24h
  const steps = Math.min(48, Math.ceil(hours));

  for (let i = steps; i >= 0; i--) {
    const timestamp = new Date(now - i * intervalMs).toISOString();
    const timeKey = timestamp.slice(0, 13);

    // Simulate historical sentiment by adding time-decayed noise
    const decay = 1 - (i / steps) * 0.4; // older = more different from current
    const noise = seededRandom(`timeline-${symbol}-${timeKey}`, -25, 25);
    const historicalSentiment = Math.max(-100, Math.min(100,
      Math.round(currentSentiment.overall * decay + noise),
    ));

    // Simulate component breakdown
    const componentNoise = (comp: string) => seededRandom(`tl-${symbol}-${comp}-${timeKey}`, -15, 15);

    timeline.push({
      timestamp,
      sentiment: historicalSentiment,
      signal: classifySignal(historicalSentiment),
      components: {
        agentSentiment: Math.round(currentSentiment.components.agentSentiment * decay + componentNoise("agent")),
        momentumSentiment: Math.round(currentSentiment.components.momentumSentiment * decay + componentNoise("momentum")),
        volumeSentiment: Math.round(currentSentiment.components.volumeSentiment * decay + componentNoise("volume")),
        socialSentiment: Math.round(currentSentiment.components.socialSentiment * decay + componentNoise("social")),
        newsSentiment: Math.round(currentSentiment.components.newsSentiment * decay + componentNoise("news")),
      },
    });
  }

  return timeline;
}

/**
 * Compute the overall Market Mood Index.
 *
 * A single number from -100 to +100 representing aggregate market
 * psychology, combining all stock sentiments, agent mood, volume
 * trends, and market breadth into a "fear and greed" style gauge.
 *
 * @returns Market mood index with classification and component breakdown
 */
export async function getMarketMoodIndex(): Promise<MarketMoodIndex> {
  try {
    const allSentiments = await getAllSentiments();
    const allMarket = await getMarketData();

    if (allSentiments.length === 0) {
      return {
        value: 0,
        label: "Neutral",
        classification: "neutral",
        components: { agentMood: 0, priceMomentum: 0, volumeTrend: 0, breadth: 50 },
        description: "Insufficient data to compute market mood.",
        generatedAt: new Date().toISOString(),
      };
    }

    // Component 1: Agent mood (average agent sentiment component across all stocks)
    const agentMood = allSentiments.reduce((s, st) => s + st.components.agentSentiment, 0) / allSentiments.length;

    // Component 2: Price momentum (average momentum component)
    const priceMomentum = allSentiments.reduce((s, st) => s + st.components.momentumSentiment, 0) / allSentiments.length;

    // Component 3: Volume trend
    const volumeTrend = allSentiments.reduce((s, st) => s + st.components.volumeSentiment, 0) / allSentiments.length;

    // Component 4: Market breadth (% of stocks with positive sentiment)
    const positiveStocks = allSentiments.filter((s) => s.overall > 0).length;
    const breadth = (positiveStocks / allSentiments.length) * 100;

    // Weighted composite mood
    const moodValue = Math.round(
      agentMood * 0.30 +
      priceMomentum * 0.30 +
      volumeTrend * 0.15 +
      (breadth - 50) * 0.50, // breadth centered at 50%, scaled
    );

    const clamped = Math.max(-100, Math.min(100, moodValue));
    const classification = classifyMood(clamped);

    const labelMap: Record<string, string> = {
      extreme_fear: "Extreme Fear",
      fear: "Fear",
      neutral: "Neutral",
      greed: "Greed",
      extreme_greed: "Extreme Greed",
    };

    const descriptionMap: Record<string, string> = {
      extreme_fear: "Markets are in a state of extreme fear. Widespread selling pressure, low confidence, and negative momentum dominate. Historically, extreme fear has preceded buying opportunities.",
      fear: "Market participants are fearful. Sentiment is skewed negative with caution prevailing across sectors. Selective contrarian opportunities may be emerging.",
      neutral: "Markets are balanced with no dominant sentiment. Mixed signals across agents, sectors, and price action suggest a wait-and-see environment.",
      greed: "Optimism is building across the market. Positive momentum, strong agent confidence, and healthy breadth suggest risk-on behavior.",
      extreme_greed: "Markets are in a state of extreme greed. Euphoric sentiment, heavy buying, and broad-based rallies dominate. Historically, extreme greed has preceded corrections.",
    };

    return {
      value: clamped,
      label: labelMap[classification] ?? "Neutral",
      classification,
      components: {
        agentMood: Math.round(agentMood),
        priceMomentum: Math.round(priceMomentum),
        volumeTrend: Math.round(volumeTrend),
        breadth: Math.round(breadth),
      },
      description: descriptionMap[classification] ?? "Unable to classify market mood.",
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error("[Sentiment] Market mood error:", error);
    return {
      value: 0,
      label: "Unknown",
      classification: "neutral",
      components: { agentMood: 0, priceMomentum: 0, volumeTrend: 0, breadth: 50 },
      description: "Error computing market mood index.",
      generatedAt: new Date().toISOString(),
    };
  }
}
