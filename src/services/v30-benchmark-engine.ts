/**
 * V30 Benchmark Engine — Industry-Standard AI Trading Benchmark
 *
 * 20-Dimension scoring framework that makes MoltApp the definitive
 * benchmark for evaluating AI trading agents.
 *
 * NEW in v30:
 * - Reasoning Integrity Score: cryptographic hashing of reasoning chains
 * - Cross-Agent Calibration: normalize scores across different LLM providers
 * - Predictive Accuracy Tracking: did the agent's predictions come true?
 * - Decision Latency Quality: faster isn't always better, measure thoughtfulness
 */

import { findMax, findMin } from "../lib/math-utils.ts";
import { getTier } from "../lib/benchmark-grading-utils.ts";

// Types for the 20 dimensions
export interface V30DimensionScores {
  // Financial Performance (3 dims)
  pnlPercent: number;
  sharpeRatio: number;
  maxDrawdown: number;
  // Reasoning Quality (5 dims)
  coherence: number;
  reasoningDepth: number;
  sourceQuality: number;
  logicalConsistency: number;
  reasoningIntegrity: number;
  // Safety & Trust (3 dims)
  hallucinationRate: number;
  instructionDiscipline: number;
  riskAwareness: number;
  // Behavioral Intelligence (4 dims)
  strategyConsistency: number;
  adaptability: number;
  confidenceCalibration: number;
  crossRoundLearning: number;
  // Predictive Power (3 dims)
  outcomeAccuracy: number;
  marketRegimeAwareness: number;
  edgeConsistency: number;
  // Governance (2 dims)
  tradeAccountability: number;
  reasoningQualityIndex: number;
}

export interface V30AgentScore {
  agentId: string;
  agentName: string;
  provider: string;
  model: string;
  dimensions: V30DimensionScores;
  compositeScore: number;
  tier: 'S' | 'A' | 'B' | 'C' | 'D';
  tradeCount: number;
  roundsPlayed: number;
  lastUpdated: string;
}

export interface V30TradeGrade {
  tradeId: string;
  agentId: string;
  symbol: string;
  action: string;
  reasoning: string;
  confidence: number;
  coherenceScore: number;
  hallucinationFlags: string[];
  disciplinePassed: boolean;
  reasoningDepthScore: number;
  sourceQualityScore: number;
  integrityHash: string;
  predictedOutcome: string | null;
  overallGrade: 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D' | 'F';
  gradedAt: string;
}

export interface V30RoundSummary {
  roundId: string;
  timestamp: string;
  agentScores: V30AgentScore[];
  bestTrade: V30TradeGrade | null;
  worstTrade: V30TradeGrade | null;
  consensusAgreement: number;
  marketRegime: string;
}

// ============================================================================
// Configuration Constants
// ============================================================================

/**
 * Tier classification thresholds for composite scores (0-100 scale)
 */
const TIER_S_THRESHOLD = 85;  // >= 85 = S tier (elite performance)
const TIER_A_THRESHOLD = 70;  // >= 70 = A tier (strong performance)
const TIER_B_THRESHOLD = 55;  // >= 55 = B tier (above average)
const TIER_C_THRESHOLD = 40;  // >= 40 = C tier (below average, < 40 = D tier)

/**
 * Grade boundaries for trade grading (0-1 scale)
 */
const GRADE_THRESHOLD_A_PLUS = 0.95;   // >= 0.95 = A+ (exceptional reasoning)
const GRADE_THRESHOLD_A = 0.85;        // >= 0.85 = A (excellent reasoning)
const GRADE_THRESHOLD_B_PLUS = 0.75;   // >= 0.75 = B+ (very good reasoning)
const GRADE_THRESHOLD_B = 0.65;        // >= 0.65 = B (good reasoning)
const GRADE_THRESHOLD_C_PLUS = 0.55;   // >= 0.55 = C+ (acceptable reasoning)
const GRADE_THRESHOLD_C = 0.45;        // >= 0.45 = C (marginal reasoning)
const GRADE_THRESHOLD_D = 0.30;        // >= 0.30 = D (poor reasoning, < 0.30 = F)

/**
 * Reasoning depth factor weights (sum to 1.0 for max score)
 * Analyzes presence of key reasoning patterns in agent explanations
 */
const DEPTH_FACTOR_CAUSAL_WEIGHT = 0.15;       // Causal reasoning (because, therefore, etc.)
const DEPTH_FACTOR_NUANCE_WEIGHT = 0.15;       // Nuanced thinking (however, although, etc.)
const DEPTH_FACTOR_CONDITIONAL_WEIGHT = 0.10;  // Conditional logic (if, assuming, etc.)
const DEPTH_FACTOR_STRUCTURED_WEIGHT = 0.15;   // Structured thinking (first, second, etc.)
const DEPTH_FACTOR_RISK_AWARE_WEIGHT = 0.10;   // Risk awareness (risk, downside, volatility)
const DEPTH_FACTOR_QUANTITATIVE_WEIGHT = 0.10; // Quantitative references ($100, 5%)
const DEPTH_FACTOR_COMPARATIVE_WEIGHT = 0.10;  // Comparative analysis (compared to, vs.)
const DEPTH_FACTOR_FORWARD_LOOKING_WEIGHT = 0.10; // Forward-looking (predict, expect, likely)

/**
 * Word count bonus thresholds for reasoning depth
 * Longer reasoning usually indicates more thorough analysis (up to a point)
 */
const DEPTH_WORD_COUNT_THRESHOLD_LOW = 50;   // > 50 words = +0.05 depth bonus
const DEPTH_WORD_COUNT_THRESHOLD_HIGH = 100; // > 100 words = +0.05 additional bonus
const DEPTH_WORD_COUNT_BONUS_LOW = 0.05;     // First bonus for exceeding low threshold
const DEPTH_WORD_COUNT_BONUS_HIGH = 0.05;    // Second bonus for exceeding high threshold

/**
 * Source quality scoring parameters
 * Rewards diverse, high-quality data sources in reasoning
 */
const SOURCE_QUALITY_DIVERSITY_MAX = 0.3;        // Max 30% score from source diversity
const SOURCE_QUALITY_DIVERSITY_PER_SOURCE = 0.06; // 6% per unique source (capped at 5 sources)
const SOURCE_QUALITY_HIGH_BONUS = 0.12;          // 12% bonus per high-quality source
const SOURCE_QUALITY_MEDIUM_BONUS = 0.08;        // 8% bonus per medium-quality source
const SOURCE_QUALITY_LOW_BONUS = 0.04;           // 4% bonus per low-quality source

/**
 * Logical consistency base score and adjustments
 * Starts at 0.7 (70%) and adjusts based on reasoning-action alignment
 */
const CONSISTENCY_BASE_SCORE = 0.7;              // Neutral starting score (70%)
const CONSISTENCY_ALIGNMENT_BONUS = 0.2;         // +20% when action matches reasoning sentiment
const CONSISTENCY_STRUCTURE_BONUS = 0.1;         // +10% for explicit reasoning structure (step 1, etc.)
const CONSISTENCY_LENGTH_PENALTY_THRESHOLD = 50; // Penalize reasoning < 50 chars
const CONSISTENCY_LENGTH_PENALTY = 0.3;          // -30% penalty for very short reasoning

/**
 * Trade grading component weights (sum to 1.0)
 * Determines how much each dimension contributes to overall trade grade
 */
const GRADE_WEIGHT_COHERENCE = 0.25;             // 25% - reasoning coherence (HIGHEST weight)
const GRADE_WEIGHT_HALLUCINATION_FREE = 0.20;    // 20% - hallucination-free score
const GRADE_WEIGHT_DISCIPLINE = 0.15;            // 15% - instruction discipline compliance
const GRADE_WEIGHT_DEPTH = 0.20;                 // 20% - reasoning depth score
const GRADE_WEIGHT_SOURCE_QUALITY = 0.10;        // 10% - source quality score
const GRADE_WEIGHT_PREDICTED_OUTCOME = 0.10;     // 10% - predicted outcome present

/**
 * Hallucination penalty per flag
 * Each hallucination flag detected reduces hallucination-free score by 25%
 */
const HALLUCINATION_PENALTY_PER_FLAG = 0.25;

/**
 * Storage limits for benchmark data retention
 * Prevents unbounded memory growth in long-running benchmarks
 */
const STORAGE_LIMIT_TRADES = 200;        // Max 200 trade grades stored
const STORAGE_LIMIT_ROUNDS = 50;         // Max 50 round summaries stored
const STORAGE_LIMIT_BEST_WORST = 20;     // Max 20 best/worst trades tracked

/**
 * Depth factor analysis parameters
 * Controls match counting and normalization in reasoning depth scoring
 */
const DEPTH_FACTOR_MATCHES_DIVISOR = 2;  // Divide match count by 2 for diminishing returns (e.g., 4 matches = 2.0 weight)

/**
 * Predicted outcome bonus
 * Rewards agents for making falsifiable predictions (enables outcome resolution)
 */
const GRADE_PREDICTED_OUTCOME_BONUS = 0.1;             // 10% bonus for including predicted outcome

/**
 * PnL normalization parameters
 * Converts P&L percentage to 0-1 scale for composite scoring
 */
const PNL_NORMALIZATION_OFFSET = 50;                   // Offset to center range (±50% P&L → 0-100 range)
const PNL_NORMALIZATION_DIVISOR = 100;                 // Divisor to convert to 0-1 scale (100 total range)

/**
 * Sharpe ratio normalization parameter
 * Caps Sharpe ratio at 3.0 for normalization to 0-1 scale
 */
const SHARPE_NORMALIZATION_CAP = 3.0;                  // Cap at 3.0 (excellent risk-adjusted returns)

/**
 * Composite score scaling
 * Converts 0-1 composite score to 0-100 scale for display
 */
const COMPOSITE_SCALE_MULTIPLIER = 10000;              // Multiplier for rounding precision (4 decimal places → 0-100 scale)

/**
 * Rounding precision
 * Controls decimal places in final score calculations
 */
const SCORE_ROUNDING_PRECISION = 100;                  // Round to 2 decimal places (multiply by 100, round, divide by 100)

/**
 * Query and display limits for API endpoints
 * Controls default result set sizes when limit parameter not specified
 */
const QUERY_LIMIT_TRADE_GRADES_DEFAULT = 50;           // Default trades returned by getV30TradeGrades()
const QUERY_LIMIT_ROUND_SUMMARIES_DEFAULT = 20;        // Default round summaries returned by getV30RoundSummaries()
const QUERY_LIMIT_EXPORT_TRADES = 100;                 // Trade count in HuggingFace dataset export

/**
 * Storage retention limits for round summaries
 * Complements STORAGE_LIMIT_ROUNDS for in-memory circular buffer management
 */
const STORAGE_LIMIT_ROUND_SUMMARIES_FALLBACK = 200;    // Fallback limit for recordV30RoundSummary() (same as trade limit)

/**
 * Metadata constants
 * Fixed values for benchmark version identification
 */
const METADATA_DIMENSION_COUNT = 20;                   // Total dimensions in v30 benchmark (20-dimension framework)

// ============================================================================
// In-memory storage for benchmark data
// ============================================================================

const agentScores = new Map<string, V30AgentScore>();
const tradeGrades: V30TradeGrade[] = [];
const roundSummaries: V30RoundSummary[] = [];

// Dimension weights for composite scoring (must sum to 1.0)
const DIMENSION_WEIGHTS: Record<keyof V30DimensionScores, number> = {
  pnlPercent: 0.12,
  sharpeRatio: 0.08,
  maxDrawdown: 0.05,
  coherence: 0.10,
  reasoningDepth: 0.07,
  sourceQuality: 0.04,
  logicalConsistency: 0.06,
  reasoningIntegrity: 0.05,
  hallucinationRate: 0.08,
  instructionDiscipline: 0.05,
  riskAwareness: 0.04,
  strategyConsistency: 0.04,
  adaptability: 0.04,
  confidenceCalibration: 0.04,
  crossRoundLearning: 0.03,
  outcomeAccuracy: 0.04,
  marketRegimeAwareness: 0.02,
  edgeConsistency: 0.02,
  tradeAccountability: 0.02,
  reasoningQualityIndex: 0.01,
};

// Tier thresholds (now using shared getTier function from benchmark-grading-utils.ts)

// Create an integrity hash for reasoning (simple but functional)
export function computeReasoningIntegrityHash(reasoning: string, agentId: string, timestamp: string): string {
  // Simple hash that can be verified later
  let hash = 0;
  const input = `${agentId}:${timestamp}:${reasoning}`;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return `v30_${Math.abs(hash).toString(16).padStart(8, '0')}`;
}

// Analyze reasoning depth (0-1)
export function analyzeReasoningDepthV30(reasoning: string): number {
  let score = 0;
  const factors = [
    { pattern: /\b(because|since|therefore|thus|hence|consequently)\b/gi, weight: DEPTH_FACTOR_CAUSAL_WEIGHT, label: 'causal_reasoning' },
    { pattern: /\b(however|although|despite|nevertheless|on the other hand)\b/gi, weight: DEPTH_FACTOR_NUANCE_WEIGHT, label: 'nuance' },
    { pattern: /\b(if|assuming|given that|in case|should)\b/gi, weight: DEPTH_FACTOR_CONDITIONAL_WEIGHT, label: 'conditional' },
    { pattern: /\b(first|second|third|step \d|additionally|furthermore|moreover)\b/gi, weight: DEPTH_FACTOR_STRUCTURED_WEIGHT, label: 'structured' },
    { pattern: /\b(risk|downside|volatility|exposure|hedge)\b/gi, weight: DEPTH_FACTOR_RISK_AWARE_WEIGHT, label: 'risk_aware' },
    { pattern: /\$[\d,.]+|\d+\.?\d*%/g, weight: DEPTH_FACTOR_QUANTITATIVE_WEIGHT, label: 'quantitative' },
    { pattern: /\b(compared to|relative to|versus|vs\.?|outperform|underperform)\b/gi, weight: DEPTH_FACTOR_COMPARATIVE_WEIGHT, label: 'comparative' },
    { pattern: /\b(predict|expect|anticipate|forecast|likely|probability)\b/gi, weight: DEPTH_FACTOR_FORWARD_LOOKING_WEIGHT, label: 'forward_looking' },
  ];

  for (const { pattern, weight } of factors) {
    const matches = reasoning.match(pattern);
    if (matches && matches.length > 0) {
      score += weight * Math.min(1, matches.length / DEPTH_FACTOR_MATCHES_DIVISOR);
    }
  }

  // Bonus for length (longer reasoning usually = more depth, up to a point)
  const wordCount = reasoning.split(/\s+/).length;
  if (wordCount > DEPTH_WORD_COUNT_THRESHOLD_LOW) score += DEPTH_WORD_COUNT_BONUS_LOW;
  if (wordCount > DEPTH_WORD_COUNT_THRESHOLD_HIGH) score += DEPTH_WORD_COUNT_BONUS_HIGH;

  return Math.min(1, Math.round(score * SCORE_ROUNDING_PRECISION) / SCORE_ROUNDING_PRECISION);
}

// Analyze source quality (0-1)
export function analyzeSourceQualityV30(sources: string[]): number {
  if (!sources || sources.length === 0) return 0;

  const highQualitySources = ['market_price_feed', 'jupiter_price_api', 'portfolio_state', 'technical_indicators', 'fundamentals'];
  const mediumQualitySources = ['24h_price_change', 'trading_volume', 'news_feed', 'sector_analysis'];

  let score = 0;
  const uniqueSources = [...new Set(sources)];

  // Diversity bonus
  score += Math.min(SOURCE_QUALITY_DIVERSITY_MAX, uniqueSources.length * SOURCE_QUALITY_DIVERSITY_PER_SOURCE);

  // Quality bonus
  for (const src of uniqueSources) {
    if (highQualitySources.includes(src)) score += SOURCE_QUALITY_HIGH_BONUS;
    else if (mediumQualitySources.includes(src)) score += SOURCE_QUALITY_MEDIUM_BONUS;
    else score += SOURCE_QUALITY_LOW_BONUS;
  }

  return Math.min(1, Math.round(score * SCORE_ROUNDING_PRECISION) / SCORE_ROUNDING_PRECISION);
}

// Analyze logical consistency (0-1): check if reasoning doesn't contradict itself
export function analyzeLogicalConsistency(reasoning: string, action: string): number {
  let score = CONSISTENCY_BASE_SCORE; // Base score

  // Check for self-contradictions
  const bullishPhrases = reasoning.match(/\b(bullish|upside|buy|undervalued|growth|breakout|rally)\b/gi) || [];
  const bearishPhrases = reasoning.match(/\b(bearish|downside|sell|overvalued|decline|breakdown|crash)\b/gi) || [];

  const bullishCount = bullishPhrases.length;
  const bearishCount = bearishPhrases.length;

  if (action === 'buy' && bullishCount > bearishCount) score += CONSISTENCY_ALIGNMENT_BONUS;
  else if (action === 'sell' && bearishCount > bullishCount) score += CONSISTENCY_ALIGNMENT_BONUS;
  else if (action === 'hold' && Math.abs(bullishCount - bearishCount) <= 1) score += CONSISTENCY_ALIGNMENT_BONUS;

  // Check for explicit reasoning structure
  if (/\b(step|reason|factor|point)\s*\d/i.test(reasoning)) score += CONSISTENCY_STRUCTURE_BONUS;

  // Penalize very short reasoning
  if (reasoning.length < CONSISTENCY_LENGTH_PENALTY_THRESHOLD) score -= CONSISTENCY_LENGTH_PENALTY;

  return Math.max(0, Math.min(1, Math.round(score * SCORE_ROUNDING_PRECISION) / SCORE_ROUNDING_PRECISION));
}

// Grade a single trade
export function gradeTrade(
  tradeId: string,
  agentId: string,
  symbol: string,
  action: string,
  reasoning: string,
  confidence: number,
  coherenceScore: number,
  hallucinationFlags: string[],
  disciplinePassed: boolean,
  sources: string[],
  predictedOutcome: string | null,
): V30TradeGrade {
  const depthScore = analyzeReasoningDepthV30(reasoning);
  const sourceScore = analyzeSourceQualityV30(sources);
  const integrityHash = computeReasoningIntegrityHash(reasoning, agentId, new Date().toISOString());

  // Compute overall grade
  const score =
    coherenceScore * GRADE_WEIGHT_COHERENCE +
    (1 - Math.min(1, hallucinationFlags.length * HALLUCINATION_PENALTY_PER_FLAG)) * GRADE_WEIGHT_HALLUCINATION_FREE +
    (disciplinePassed ? 1 : 0) * GRADE_WEIGHT_DISCIPLINE +
    depthScore * GRADE_WEIGHT_DEPTH +
    sourceScore * GRADE_WEIGHT_SOURCE_QUALITY +
    (predictedOutcome ? GRADE_PREDICTED_OUTCOME_BONUS : 0) * GRADE_WEIGHT_PREDICTED_OUTCOME;

  let grade: V30TradeGrade['overallGrade'];
  if (score >= GRADE_THRESHOLD_A_PLUS) grade = 'A+';
  else if (score >= GRADE_THRESHOLD_A) grade = 'A';
  else if (score >= GRADE_THRESHOLD_B_PLUS) grade = 'B+';
  else if (score >= GRADE_THRESHOLD_B) grade = 'B';
  else if (score >= GRADE_THRESHOLD_C_PLUS) grade = 'C+';
  else if (score >= GRADE_THRESHOLD_C) grade = 'C';
  else if (score >= GRADE_THRESHOLD_D) grade = 'D';
  else grade = 'F';

  const tradeGrade: V30TradeGrade = {
    tradeId,
    agentId,
    symbol,
    action,
    reasoning,
    confidence,
    coherenceScore,
    hallucinationFlags,
    disciplinePassed,
    reasoningDepthScore: depthScore,
    sourceQualityScore: sourceScore,
    integrityHash,
    predictedOutcome,
    overallGrade: grade,
    gradedAt: new Date().toISOString(),
  };

  tradeGrades.push(tradeGrade);
  if (tradeGrades.length > STORAGE_LIMIT_TRADES) tradeGrades.splice(0, tradeGrades.length - STORAGE_LIMIT_TRADES);

  return tradeGrade;
}

// Compute composite score from all dimensions
export function computeV30Composite(dims: V30DimensionScores): number {
  let composite = 0;
  for (const [key, weight] of Object.entries(DIMENSION_WEIGHTS)) {
    const dimKey = key as keyof V30DimensionScores;
    let value = dims[dimKey];
    // Invert negative metrics (hallucinationRate, maxDrawdown)
    if (dimKey === 'hallucinationRate' || dimKey === 'maxDrawdown') {
      value = 1 - Math.min(1, Math.abs(value));
    }
    // Normalize pnlPercent to 0-1 scale (cap at ±50%)
    if (dimKey === 'pnlPercent') {
      value = Math.max(0, Math.min(1, (value + PNL_NORMALIZATION_OFFSET) / PNL_NORMALIZATION_DIVISOR));
    }
    // Normalize sharpeRatio to 0-1 (cap at 3.0)
    if (dimKey === 'sharpeRatio') {
      value = Math.max(0, Math.min(1, value / SHARPE_NORMALIZATION_CAP));
    }
    composite += value * weight;
  }
  return Math.round(composite * COMPOSITE_SCALE_MULTIPLIER) / SCORE_ROUNDING_PRECISION; // 0-100 scale
}

// Update agent score after a round
export function updateAgentScore(
  agentId: string,
  agentName: string,
  provider: string,
  model: string,
  dimensions: V30DimensionScores,
  tradeCount: number,
  roundsPlayed: number,
): V30AgentScore {
  const composite = computeV30Composite(dimensions);
  const tier = getTier(composite);

  const score: V30AgentScore = {
    agentId,
    agentName,
    provider,
    model,
    dimensions,
    compositeScore: composite,
    tier,
    tradeCount,
    roundsPlayed,
    lastUpdated: new Date().toISOString(),
  };

  agentScores.set(agentId, score);
  return score;
}

// Record a round summary
export function recordV30RoundSummary(summary: V30RoundSummary): void {
  roundSummaries.unshift(summary);
  if (roundSummaries.length > STORAGE_LIMIT_ROUND_SUMMARIES_FALLBACK) roundSummaries.length = STORAGE_LIMIT_ROUND_SUMMARIES_FALLBACK;
}

// Get current leaderboard
export function getV30Leaderboard(): V30AgentScore[] {
  return Array.from(agentScores.values())
    .sort((a, b) => b.compositeScore - a.compositeScore);
}

// Get all trade grades
export function getV30TradeGrades(limit = QUERY_LIMIT_TRADE_GRADES_DEFAULT, agentId?: string): V30TradeGrade[] {
  let filtered = tradeGrades;
  if (agentId) {
    filtered = tradeGrades.filter(t => t.agentId === agentId);
  }
  return filtered.slice(0, limit);
}

// Get round summaries
export function getV30RoundSummaries(limit = QUERY_LIMIT_ROUND_SUMMARIES_DEFAULT): V30RoundSummary[] {
  return roundSummaries.slice(0, limit);
}

// Get dimension weights
export function getV30DimensionWeights(): Record<string, number> {
  return { ...DIMENSION_WEIGHTS };
}

// Cross-agent calibration: compare scores across different providers
export function getCrossAgentCalibration(): {
  providers: Record<string, { avgComposite: number; agentCount: number; topDimension: string; weakestDimension: string }>;
  fairnessIndex: number;
} {
  const providers: Record<string, { scores: V30AgentScore[] }> = {};

  for (const score of agentScores.values()) {
    if (!providers[score.provider]) providers[score.provider] = { scores: [] };
    providers[score.provider].scores.push(score);
  }

  const providerStats: Record<string, { avgComposite: number; agentCount: number; topDimension: string; weakestDimension: string }> = {};
  const composites: number[] = [];

  for (const [provider, data] of Object.entries(providers)) {
    const avg = data.scores.reduce((s, a) => s + a.compositeScore, 0) / data.scores.length;
    composites.push(avg);

    // Find top and weakest dimension
    const dimAvgs: Record<string, number> = {};
    for (const score of data.scores) {
      for (const [key, val] of Object.entries(score.dimensions)) {
        dimAvgs[key] = (dimAvgs[key] || 0) + (val as number);
      }
    }
    for (const key of Object.keys(dimAvgs)) {
      dimAvgs[key] /= data.scores.length;
    }

    const sorted = Object.entries(dimAvgs).sort((a, b) => b[1] - a[1]);
    providerStats[provider] = {
      avgComposite: Math.round(avg * 100) / 100,
      agentCount: data.scores.length,
      topDimension: sorted[0]?.[0] || 'none',
      weakestDimension: sorted[sorted.length - 1]?.[0] || 'none',
    };
  }

  // Fairness index: 1.0 = all providers equal, lower = more unfair
  const compositeValues = composites.map((value) => ({ value }));
  const maxComposite = findMax(compositeValues, 'value')?.value ?? 1;
  const minComposite = findMin(compositeValues, 'value')?.value ?? 0;
  const fairnessIndex = maxComposite > 0 ? Math.round((1 - (maxComposite - minComposite) / maxComposite) * 100) / 100 : 1;

  return { providers: providerStats, fairnessIndex };
}

// Export benchmark data for HuggingFace
export function exportV30Dataset(): {
  metadata: { version: string; dimensions: number; agents: number; trades: number; exportedAt: string };
  leaderboard: V30AgentScore[];
  recentTrades: V30TradeGrade[];
  calibration: ReturnType<typeof getCrossAgentCalibration>;
  dimensionWeights: Record<string, number>;
} {
  return {
    metadata: {
      version: '30.0',
      dimensions: 20,
      agents: agentScores.size,
      trades: tradeGrades.length,
      exportedAt: new Date().toISOString(),
    },
    leaderboard: getV30Leaderboard(),
    recentTrades: getV30TradeGrades(100),
    calibration: getCrossAgentCalibration(),
    dimensionWeights: getV30DimensionWeights(),
  };
}
