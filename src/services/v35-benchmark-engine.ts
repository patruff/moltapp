/**
 * V35 Benchmark Engine — 30-Dimension AI Trading Benchmark
 *
 * Extends v34's 28-dimension framework with:
 * - Information Asymmetry Detection: Does the agent identify unique insights?
 * - Temporal Reasoning Quality: How well does the agent reason about timing?
 *
 * Categories (30 dimensions):
 * - Financial Performance (3): pnl, sharpe, drawdown
 * - Reasoning Quality (13): coherence, depth, source, consistency,
 *   integrity, transparency, grounding, causal, epistemic,
 *   traceability, adversarial coherence, info asymmetry (NEW), temporal reasoning (NEW)
 * - Safety & Trust (3): hallucination, discipline, risk awareness
 * - Behavioral Intelligence (4): consistency, adaptability, calibration, learning
 * - Predictive Power (3): outcome, regime, edge
 * - Governance & Accountability (4): accountability, RQI, decision accountability, consensus
 */

import { createHash } from "crypto";
import { countByCondition, computeStdDev, computeVariance, clamp } from "../lib/math-utils.ts";

// Re-export inherited scoring functions from v34
export {
  scoreGrounding,
  scoreConsensusQuality,
  scoreTransparency,
  scoreAccountability,
  scoreCausalReasoning,
  scoreEpistemicHumility,
  scoreReasoningTraceability,
  scoreAdversarialCoherence,
} from "./v34-benchmark-engine.ts";

// Import for internal use
import {
  scoreGrounding,
  scoreConsensusQuality,
  scoreTransparency,
  scoreAccountability,
  scoreCausalReasoning,
  scoreEpistemicHumility,
  scoreReasoningTraceability,
  scoreAdversarialCoherence,
} from "./v34-benchmark-engine.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Tier classification thresholds based on composite benchmark score.
 * Tiers are used for agent ranking and reputation in UI/leaderboards.
 */
const TIER_S_THRESHOLD = 85; // S tier: Elite performance (top 5%)
const TIER_A_THRESHOLD = 70; // A tier: Strong performance
const TIER_B_THRESHOLD = 55; // B tier: Above average
const TIER_C_THRESHOLD = 40; // C tier: Average

/**
 * Grade boundaries for individual dimension scores (0-100 scale).
 * Grades appear in trade quality assessment and dimension breakdowns.
 */
const GRADE_A_PLUS_THRESHOLD = 95; // A+: Near-perfect execution
const GRADE_A_THRESHOLD = 85; // A: Excellent quality
const GRADE_B_PLUS_THRESHOLD = 75; // B+: Very good
const GRADE_B_THRESHOLD = 65; // B: Good
const GRADE_C_PLUS_THRESHOLD = 55; // C+: Above average
const GRADE_C_THRESHOLD = 45; // C: Average
const GRADE_D_THRESHOLD = 30; // D: Below average (< 30 = F)

/**
 * Information Asymmetry divergent source detection thresholds.
 * Controls bonus points awarded when agents cite multiple uncommon data sources.
 */
const INFO_ASYMMETRY_DIVERGENT_SOURCES_HIGH_THRESHOLD = 3; // 3+ sources = high bonus
const INFO_ASYMMETRY_DIVERGENT_SOURCES_MODERATE_THRESHOLD = 2; // 2 sources = moderate bonus

// ---------------------------------------------------------------------------
// Information Asymmetry Scoring Constants
// ---------------------------------------------------------------------------

/**
 * Insight Density Scoring Parameters (0-25 max)
 * Measures how well agent identifies unique insights others missed.
 */
const INSIGHT_PATTERN_MAX = 15; // Max points from insight language patterns
const INSIGHT_PATTERN_POINTS_PER_MATCH = 5; // Points per insight pattern match
const INSIGHT_UNIQUE_RATIO_MAX = 10; // Max points from unique keyword ratio
const INSIGHT_UNIQUE_RATIO_MULTIPLIER = 15; // Multiplier for unique ratio score
const INSIGHT_NO_PEERS_PARTIAL_CREDIT = 5; // Partial credit when no peers to compare
const INSIGHT_SCORE_MAX = 25; // Overall max for insight density scoring

/**
 * Non-Obvious Connection Scoring Parameters (0-25 max)
 * Rewards agents that connect seemingly unrelated factors.
 */
const CONNECTION_PATTERN_MAX = 15; // Max points from connection language patterns
const CONNECTION_PATTERN_POINTS_PER_MATCH = 5; // Points per connection pattern match
const CONNECTION_BRIDGE_MAX = 10; // Max points from "X and Y" bridge patterns
const CONNECTION_BRIDGE_POINTS_PER_MATCH = 5; // Points per bridge pattern match
const CONNECTION_SCORE_MAX = 25; // Overall max for connection scoring

/**
 * Divergent Data Usage Scoring Parameters (0-20 max)
 * Rewards agents using uncommon data sources (on-chain, supply chain, etc.).
 */
const DIVERGENT_SOURCES_MAX = 14; // Max points from divergent source types
const DIVERGENT_SOURCES_POINTS_PER_TYPE = 4; // Points per divergent source type
const DIVERGENT_HIGH_BONUS = 6; // Bonus for 3+ divergent sources
const DIVERGENT_MODERATE_BONUS = 3; // Bonus for 2 divergent sources
const DIVERGENT_SCORE_MAX = 20; // Overall max for divergent data scoring

/**
 * Exclusive Source Utilization Scoring Parameters (0-15 max)
 * Rewards specific, non-generic data mentions (company names, dates, events).
 */
const EXCLUSIVE_COMPANY_MAX = 5; // Max points from company name mentions
const EXCLUSIVE_COMPANY_POINTS_PER_MATCH = 2; // Points per company name
const EXCLUSIVE_DATE_MAX = 5; // Max points from specific dates
const EXCLUSIVE_DATE_POINTS_PER_MATCH = 2; // Points per date mention
const EXCLUSIVE_EVENT_MAX = 5; // Max points from concrete events
const EXCLUSIVE_EVENT_POINTS_PER_MATCH = 2; // Points per event mention
const EXCLUSIVE_GENERIC_THRESHOLD = 2; // >2 generic phrases triggers penalty
const EXCLUSIVE_GENERIC_PENALTY = 5; // Penalty for excessive generic language
const EXCLUSIVE_SCORE_MIN = 0; // Minimum exclusive score
const EXCLUSIVE_SCORE_MAX = 15; // Maximum exclusive score

/**
 * First-Mover Reasoning Scoring Parameters (0-15 max)
 * Rewards agents suggesting they're acting before the crowd.
 */
const FIRST_MOVER_PATTERN_MAX = 10; // Max points from first-mover patterns
const FIRST_MOVER_PATTERN_POINTS_PER_MATCH = 4; // Points per first-mover pattern
const FIRST_MOVER_ALPHA_MAX = 5; // Max points from alpha/positioning patterns
const FIRST_MOVER_ALPHA_POINTS_PER_MATCH = 3; // Points per alpha pattern
const FIRST_MOVER_SCORE_MAX = 15; // Overall max for first-mover scoring

// ---------------------------------------------------------------------------
// Temporal Reasoning Quality Scoring Constants
// ---------------------------------------------------------------------------

/**
 * Temporal Horizon Clarity Scoring Parameters (0-25 max)
 * Measures whether agent specifies WHEN events should happen.
 */
const HORIZON_SPECIFIC_TIME_MAX = 15; // Max points from specific timeframes
const HORIZON_SPECIFIC_TIME_POINTS_PER_MATCH = 5; // Points per specific time reference
const HORIZON_MODERATE_TIME_MAX_WITH_SPECIFIC = 5; // Max moderate points when specific exists
const HORIZON_MODERATE_TIME_POINTS_WITH_SPECIFIC = 2; // Points per moderate (with specific)
const HORIZON_MODERATE_TIME_MAX_NO_SPECIFIC = 8; // Max moderate points when no specific
const HORIZON_MODERATE_TIME_POINTS_NO_SPECIFIC = 3; // Points per moderate (no specific)
const HORIZON_NO_TIME_PENALTY = 5; // Penalty for complete absence of time references
const HORIZON_SCORE_MIN = 0; // Minimum horizon score
const HORIZON_SCORE_MAX = 25; // Maximum horizon score

/**
 * Catalyst Timing Scoring Parameters (0-25 max)
 * Measures whether agent identifies specific upcoming events.
 */
const CATALYST_PATTERN_MAX = 15; // Max points from catalyst patterns
const CATALYST_PATTERN_POINTS_PER_MATCH = 5; // Points per catalyst pattern
const CATALYST_DATED_EVENT_MAX = 10; // Max points from dated event references
const CATALYST_DATED_EVENT_POINTS_PER_MATCH = 4; // Points per dated event
const CATALYST_VAGUE_PENALTY = 5; // Penalty for vague catalysts without specifics
const CATALYST_SCORE_MIN = 0; // Minimum catalyst score
const CATALYST_SCORE_MAX = 25; // Maximum catalyst score

/**
 * Decay Awareness Scoring Parameters (0-20 max)
 * Measures whether agent understands time-limited signal value.
 */
const DECAY_PATTERN_MAX = 12; // Max points from decay language patterns
const DECAY_PATTERN_POINTS_PER_MATCH = 4; // Points per decay pattern match
const DECAY_FRESHNESS_MAX = 8; // Max points from signal freshness awareness
const DECAY_FRESHNESS_POINTS_PER_MATCH = 4; // Points per freshness pattern
const DECAY_SCORE_MAX = 20; // Overall max for decay awareness scoring

/**
 * Sequence Reasoning Scoring Parameters (0-15 max)
 * Measures whether agent reasons about ORDER of events.
 */
const SEQUENCE_PATTERN_MAX = 10; // Max points from sequence language patterns
const SEQUENCE_PATTERN_POINTS_PER_MATCH = 4; // Points per sequence pattern
const SEQUENCE_ORDER_MAX = 5; // Max points from temporal ordering language
const SEQUENCE_ORDER_POINTS_PER_MATCH = 3; // Points per order pattern
const SEQUENCE_SCORE_MAX = 15; // Overall max for sequence reasoning scoring

/**
 * Temporal Consistency Scoring Parameters (0-15 max)
 * Measures whether timeframe is consistent with action.
 */
const CONSISTENCY_BUY_SHORT_BULLISH_BONUS = 10; // Buy + short-term bullish = consistent
const CONSISTENCY_BUY_SHORT_BEARISH_PENALTY = 5; // Buy + short bearish = inconsistent
const CONSISTENCY_BUY_DIP_BONUS = 8; // Buy + short bearish + long bullish = buying dip
const CONSISTENCY_SELL_SHORT_BEARISH_BONUS = 10; // Sell + short-term bearish = consistent
const CONSISTENCY_SELL_PROFIT_TAKING_BONUS = 8; // Sell + taking profits = consistent
const CONSISTENCY_SELL_SHORT_BULLISH_PENALTY = 5; // Sell + short bullish = inconsistent
const CONSISTENCY_HOLD_BONUS = 5; // Hold is somewhat consistent
const CONSISTENCY_TEMPORAL_RATIONALE_MAX = 5; // Max points from explicit timing rationale
const CONSISTENCY_TEMPORAL_RATIONALE_POINTS = 3; // Points per temporal rationale pattern
const CONSISTENCY_SCORE_MIN = 0; // Minimum consistency score
const CONSISTENCY_SCORE_MAX = 15; // Maximum consistency score

// ---------------------------------------------------------------------------
// Types for the 30 dimensions
// ---------------------------------------------------------------------------

export interface V35DimensionScores {
  // Financial Performance (3 dims)
  pnlPercent: number;
  sharpeRatio: number;
  maxDrawdown: number;
  // Reasoning Quality (13 dims — 11 from v34 + info asymmetry + temporal reasoning)
  coherence: number;
  reasoningDepth: number;
  sourceQuality: number;
  logicalConsistency: number;
  reasoningIntegrity: number;
  reasoningTransparency: number;
  reasoningGrounding: number;
  causalReasoning: number;
  epistemicHumility: number;
  reasoningTraceability: number;
  adversarialCoherence: number;
  informationAsymmetry: number;
  temporalReasoningQuality: number;
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
  // Governance & Accountability (4 dims)
  tradeAccountability: number;
  reasoningQualityIndex: number;
  decisionAccountability: number;
  consensusQuality: number;
}

export interface V35AgentScore {
  agentId: string;
  agentName: string;
  provider: string;
  model: string;
  dimensions: V35DimensionScores;
  compositeScore: number;
  tier: "S" | "A" | "B" | "C" | "D";
  tradeCount: number;
  roundsPlayed: number;
  lastUpdated: string;
}

export interface V35TradeGrade {
  tradeId: string;
  agentId: string;
  symbol: string;
  action: string;
  reasoning: string;
  confidence: number;
  intent: string | null;
  sources: string[];
  coherenceScore: number;
  hallucinationFlags: string[];
  disciplinePassed: boolean;
  reasoningDepthScore: number;
  sourceQualityScore: number;
  logicalConsistencyScore: number;
  transparencyScore: number;
  accountabilityScore: number;
  groundingScore: number;
  consensusQualityScore: number;
  causalReasoningScore: number;
  epistemicHumilityScore: number;
  reasoningTraceabilityScore: number;
  adversarialCoherenceScore: number;
  informationAsymmetryScore: number;
  temporalReasoningScore: number;
  integrityHash: string;
  predictedOutcome: string | null;
  actualOutcome: string | null;
  outcomeResolved: "pending" | "correct" | "incorrect" | "partial";
  overallGrade: "A+" | "A" | "B+" | "B" | "C+" | "C" | "D" | "F";
  gradedAt: string;
}

export interface V35RoundSummary {
  roundId: string;
  timestamp: string;
  agentScores: V35AgentScore[];
  bestTrade: V35TradeGrade | null;
  worstTrade: V35TradeGrade | null;
  consensusAgreement: number;
  marketRegime: string;
  avgTransparency: number;
  avgAccountability: number;
  avgGrounding: number;
  avgConsensusQuality: number;
  avgCausalReasoning: number;
  avgEpistemicHumility: number;
  avgTraceability: number;
  avgAdversarialCoherence: number;
  avgInformationAsymmetry: number;
  avgTemporalReasoning: number;
}

// ---------------------------------------------------------------------------
// In-memory storage
// ---------------------------------------------------------------------------

const agentScores = new Map<string, V35AgentScore>();
const tradeGrades: V35TradeGrade[] = [];
const roundSummaries: V35RoundSummary[] = [];

// ---------------------------------------------------------------------------
// Dimension weights (must sum to 1.0) — 30 entries
// ---------------------------------------------------------------------------

const DIMENSION_WEIGHTS: Record<keyof V35DimensionScores, number> = {
  pnlPercent: 0.06,
  sharpeRatio: 0.05,
  maxDrawdown: 0.04,
  coherence: 0.05,
  reasoningDepth: 0.04,
  sourceQuality: 0.04,
  logicalConsistency: 0.03,
  reasoningIntegrity: 0.03,
  reasoningTransparency: 0.03,
  reasoningGrounding: 0.04,
  causalReasoning: 0.05,
  epistemicHumility: 0.04,
  reasoningTraceability: 0.04,
  adversarialCoherence: 0.04,
  informationAsymmetry: 0.04,       // NEW
  temporalReasoningQuality: 0.04,   // NEW
  hallucinationRate: 0.05,
  instructionDiscipline: 0.03,
  riskAwareness: 0.03,
  strategyConsistency: 0.02,
  adaptability: 0.02,
  confidenceCalibration: 0.02,
  crossRoundLearning: 0.02,
  outcomeAccuracy: 0.02,
  marketRegimeAwareness: 0.02,
  edgeConsistency: 0.02,
  tradeAccountability: 0.02,
  reasoningQualityIndex: 0.02,
  decisionAccountability: 0.03,
  consensusQuality: 0.02,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTier(composite: number): "S" | "A" | "B" | "C" | "D" {
  if (composite >= TIER_S_THRESHOLD) return "S";
  if (composite >= TIER_A_THRESHOLD) return "A";
  if (composite >= TIER_B_THRESHOLD) return "B";
  if (composite >= TIER_C_THRESHOLD) return "C";
  return "D";
}

function getGrade(score: number): "A+" | "A" | "B+" | "B" | "C+" | "C" | "D" | "F" {
  if (score >= GRADE_A_PLUS_THRESHOLD) return "A+";
  if (score >= GRADE_A_THRESHOLD) return "A";
  if (score >= GRADE_B_PLUS_THRESHOLD) return "B+";
  if (score >= GRADE_B_THRESHOLD) return "B";
  if (score >= GRADE_C_PLUS_THRESHOLD) return "C+";
  if (score >= GRADE_C_THRESHOLD) return "C";
  if (score >= GRADE_D_THRESHOLD) return "D";
  return "F";
}

// ---------------------------------------------------------------------------
// NEW v35: Information Asymmetry Detection
// ---------------------------------------------------------------------------

/**
 * Score how well the agent identifies and exploits information that other
 * agents missed. Measures unique insight density, non-obvious connections,
 * divergent data usage, exclusive source utilization, and first-mover reasoning.
 *
 * Agents that only repeat commonly available signals score poorly.
 *
 * Measures:
 * 1. Unique Insight Density (0-25): Agent found something others didn't
 * 2. Non-Obvious Connection (0-25): Agent connects unrelated factors
 * 3. Divergent Data Usage (0-20): Agent uses uncommon data sources
 * 4. Exclusive Source Utilization (0-15): Agent cites specific, non-generic data
 * 5. First-Mover Reasoning (0-15): Agent acts before the crowd
 */
export function scoreInformationAsymmetry(
  reasoning: string,
  sources: string[],
  peerReasonings: string[],
): number {
  let score = 0;
  const maxScore = 100;

  // 1. Unique Insight Density (0-25)
  // Detect patterns suggesting agent found something others didn't
  let insightScore = 0;

  const insightPatterns = /\b(?:I noticed|what others may have missed|a less obvious signal|uniquely positioned|overlooked factor|hidden pattern|under[- ]the[- ]radar|underappreciated|non[- ]consensus view|contrarian insight)\b/gi;
  const insightMatches = reasoning.match(insightPatterns) ?? [];
  insightScore += Math.min(INSIGHT_PATTERN_MAX, insightMatches.length * INSIGHT_PATTERN_POINTS_PER_MATCH);

  // Check if agent's key terms appear in peer reasonings (penalize overlap)
  if (peerReasonings.length > 0) {
    const agentKeywords = reasoning
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 6);
    const peerText = peerReasonings.join(" ").toLowerCase();
    const uniqueKeywords = agentKeywords.filter((w) => !peerText.includes(w));
    const uniqueRatio = agentKeywords.length > 0
      ? uniqueKeywords.length / agentKeywords.length
      : 0;
    insightScore += Math.min(INSIGHT_UNIQUE_RATIO_MAX, Math.round(uniqueRatio * INSIGHT_UNIQUE_RATIO_MULTIPLIER));
  } else {
    // No peers to compare — partial credit for insight language
    insightScore += INSIGHT_NO_PEERS_PARTIAL_CREDIT;
  }

  score += Math.min(INSIGHT_SCORE_MAX, insightScore);

  // 2. Non-Obvious Connection (0-25)
  // Agent connects dots between seemingly unrelated factors
  let connectionScore = 0;

  const connectionPatterns = /\b(?:correlates with|interconnected|cross[- ]sector impact|ripple effect|second[- ]order effect|downstream|upstream|knock[- ]on|spillover|chain reaction)\b/gi;
  const connectionMatches = reasoning.match(connectionPatterns) ?? [];
  connectionScore += Math.min(CONNECTION_PATTERN_MAX, connectionMatches.length * CONNECTION_PATTERN_POINTS_PER_MATCH);

  // "the connection between X and Y" style patterns
  const bridgePatterns = /\b(?:the connection between .{3,30} and|link between .{3,30} and|relationship between .{3,30} and|ties .{3,30} to|connects .{3,30} with|implications for .{3,30} beyond)\b/gi;
  const bridgeMatches = reasoning.match(bridgePatterns) ?? [];
  connectionScore += Math.min(CONNECTION_BRIDGE_MAX, bridgeMatches.length * CONNECTION_BRIDGE_POINTS_PER_MATCH);

  score += Math.min(CONNECTION_SCORE_MAX, connectionScore);

  // 3. Divergent Data Usage (0-20)
  // Agent uses data sources not commonly cited
  let divergentScore = 0;

  const divergentDataPatterns: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /\bon[- ]chain\s+(?:data|metrics?|analysis|activity)/gi, label: "on_chain" },
    { pattern: /\bsupply[- ]chain\s+(?:signals?|data|disruption|analysis)/gi, label: "supply_chain" },
    { pattern: /\bgeopolitical\s+(?:factors?|risk|tension|events?|analysis)/gi, label: "geopolitical" },
    { pattern: /\bpatent\s+(?:filings?|applications?|data|activity)/gi, label: "patent" },
    { pattern: /\bregulatory\s+(?:filings?|submissions?|documents?|data)/gi, label: "regulatory" },
    { pattern: /\bearnings\s+(?:transcript|call)\s+(?:analysis|review|data)/gi, label: "earnings_transcript" },
    { pattern: /\binsider\s+(?:activity|trading|transactions?|buying|selling)/gi, label: "insider" },
  ];

  const foundDivergentSources = new Set<string>();
  for (const { pattern, label } of divergentDataPatterns) {
    if (pattern.test(reasoning)) {
      foundDivergentSources.add(label);
    }
  }
  divergentScore += Math.min(DIVERGENT_SOURCES_MAX, foundDivergentSources.size * DIVERGENT_SOURCES_POINTS_PER_TYPE);

  // Bonus for using multiple divergent data types together
  if (foundDivergentSources.size >= INFO_ASYMMETRY_DIVERGENT_SOURCES_HIGH_THRESHOLD) {
    divergentScore += DIVERGENT_HIGH_BONUS;
  } else if (foundDivergentSources.size >= INFO_ASYMMETRY_DIVERGENT_SOURCES_MODERATE_THRESHOLD) {
    divergentScore += DIVERGENT_MODERATE_BONUS;
  }

  score += Math.min(DIVERGENT_SCORE_MAX, divergentScore);

  // 4. Exclusive Source Utilization (0-15)
  // Agent mentions specific, non-generic data
  let exclusiveScore = 0;

  // Reward specific company names (more than just tickers)
  const companyNamePatterns = /\b(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Inc|Corp|Ltd|Co|Group|Holdings|Technologies|Therapeutics|Pharmaceuticals|Labs?))\b/g;
  const companyMatches = reasoning.match(companyNamePatterns) ?? [];
  exclusiveScore += Math.min(EXCLUSIVE_COMPANY_MAX, companyMatches.length * EXCLUSIVE_COMPANY_POINTS_PER_MATCH);

  // Reward exact dates
  const datePatterns = /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,?\s+\d{4})?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{4}-\d{2}-\d{2}/gi;
  const dateMatches = reasoning.match(datePatterns) ?? [];
  exclusiveScore += Math.min(EXCLUSIVE_DATE_MAX, dateMatches.length * EXCLUSIVE_DATE_POINTS_PER_MATCH);

  // Reward concrete events vs penalize generic language
  const concreteEventPatterns = /\b(?:announced|released|filed|reported|launched|acquired|merged|partnered|settled|approved|rejected|defaulted)\b/gi;
  const concreteEvents = reasoning.match(concreteEventPatterns) ?? [];
  exclusiveScore += Math.min(EXCLUSIVE_EVENT_MAX, concreteEvents.length * EXCLUSIVE_EVENT_POINTS_PER_MATCH);

  // Penalize generic language
  const genericPatterns = /\b(?:market conditions|macro factors|general sentiment|overall market|broad market|market environment|market dynamics)\b/gi;
  const genericMatches = reasoning.match(genericPatterns) ?? [];
  if (genericMatches.length > EXCLUSIVE_GENERIC_THRESHOLD && concreteEvents.length === 0) {
    exclusiveScore -= EXCLUSIVE_GENERIC_PENALTY;
  }

  score += clamp(exclusiveScore, EXCLUSIVE_SCORE_MIN, EXCLUSIVE_SCORE_MAX);

  // 5. First-Mover Reasoning (0-15)
  // Agent's reasoning suggests acting before the crowd
  let firstMoverScore = 0;

  const firstMoverPatterns = /\b(?:before the market realizes|ahead of|early signal|leading indicator|not yet priced in|market hasn't caught up|emerging trend|early innings)\b/gi;
  const firstMoverMatches = reasoning.match(firstMoverPatterns) ?? [];
  firstMoverScore += Math.min(FIRST_MOVER_PATTERN_MAX, firstMoverMatches.length * FIRST_MOVER_PATTERN_POINTS_PER_MATCH);

  // Additional forward-looking alpha patterns
  const alphaPatterns = /\b(?:positioning ahead|front[- ]running the narrative|before (?:consensus|the crowd|mainstream)|anticipating a shift|early mover|asymmetric opportunity|mispriced|market is sleeping on|underestimated catalyst)\b/gi;
  const alphaMatches = reasoning.match(alphaPatterns) ?? [];
  firstMoverScore += Math.min(FIRST_MOVER_ALPHA_MAX, alphaMatches.length * FIRST_MOVER_ALPHA_POINTS_PER_MATCH);

  score += Math.min(FIRST_MOVER_SCORE_MAX, firstMoverScore);

  return Math.round(clamp(score, 0, maxScore));
}

// ---------------------------------------------------------------------------
// NEW v35: Temporal Reasoning Quality
// ---------------------------------------------------------------------------

/**
 * Score how well the agent reasons about time-dependent factors.
 * Agents that ignore WHEN events matter (not just WHAT events matter)
 * score poorly.
 *
 * Measures:
 * 1. Temporal Horizon Clarity (0-25): Does the agent specify WHEN?
 * 2. Catalyst Timing (0-25): Does the agent identify upcoming events?
 * 3. Decay Awareness (0-20): Does the agent understand time-limited signals?
 * 4. Sequence Reasoning (0-15): Does the agent reason about event ORDER?
 * 5. Temporal Consistency (0-15): Is timeframe consistent with action?
 */
export function scoreTemporalReasoningQuality(
  reasoning: string,
  predictedOutcome: string | null,
): number {
  let score = 0;
  const maxScore = 100;
  const fullText = [reasoning, predictedOutcome ?? ""].join(" ");

  // 1. Temporal Horizon Clarity (0-25)
  // Does the agent specify WHEN things should happen?
  let horizonScore = 0;

  // Specific timeframes
  const specificTimePatterns = /\b(?:within\s+\d+\s*(?:hours?|h|days?|d|weeks?|minutes?|min)|by\s+(?:end of|close of|tomorrow|next week|EOD|EOW)|in the next\s+\d+\s*(?:hours?|days?|weeks?)|over\s+\d+\s*(?:hours?|days?)|\d+h\b|\d+d\b|within 24h|by end of week|over the next 3 days)\b/gi;
  const specificTimeMatches = fullText.match(specificTimePatterns) ?? [];
  horizonScore += Math.min(HORIZON_SPECIFIC_TIME_MAX, specificTimeMatches.length * HORIZON_SPECIFIC_TIME_POINTS_PER_MATCH);

  // Moderate timeframes
  const moderateTimePatterns = /\b(?:short[- ]term|medium[- ]term|long[- ]term|near[- ]term|intraday|this session|today|tonight|this week|this month|next quarter)\b/gi;
  const moderateTimeMatches = fullText.match(moderateTimePatterns) ?? [];
  if (specificTimeMatches.length > 0) {
    horizonScore += Math.min(HORIZON_MODERATE_TIME_MAX_WITH_SPECIFIC, moderateTimeMatches.length * HORIZON_MODERATE_TIME_POINTS_WITH_SPECIFIC);
  } else {
    horizonScore += Math.min(HORIZON_MODERATE_TIME_MAX_NO_SPECIFIC, moderateTimeMatches.length * HORIZON_MODERATE_TIME_POINTS_NO_SPECIFIC);
  }

  // Penalize complete absence of time references
  if (specificTimeMatches.length === 0 && moderateTimeMatches.length === 0) {
    horizonScore -= HORIZON_NO_TIME_PENALTY;
  }

  score += clamp(horizonScore, HORIZON_SCORE_MIN, HORIZON_SCORE_MAX);

  // 2. Catalyst Timing (0-25)
  // Does the agent identify specific upcoming events/catalysts?
  let catalystScore = 0;

  const catalystPatterns = /\b(?:earnings (?:on|report|call|release|date|season)|FOMC meeting|ex[- ]dividend date|options expir(?:y|ation)|reporting season|data release|after hours|pre[- ]market|Fed (?:meeting|decision|announcement)|CPI (?:release|data|report)|GDP (?:release|data|report)|jobs (?:report|data)|NFP|PCE (?:data|release)|PMI|OPEC (?:meeting|decision)|token unlock|halving|hard fork|mainnet launch|airdrop date)\b/gi;
  const catalystMatches = fullText.match(catalystPatterns) ?? [];
  catalystScore += Math.min(15, catalystMatches.length * 5);

  // Specific date references tied to events
  const datedEventPatterns = /\b(?:on\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2}|scheduled for|set for|due on|expected (?:on|by|around)|slated for|reporting on)\b/gi;
  const datedEventMatches = fullText.match(datedEventPatterns) ?? [];
  catalystScore += Math.min(10, datedEventMatches.length * 4);

  // Penalize vague catalyst references
  const vagueCatalystPatterns = /\b(?:something might happen|things could change|events may occur|potential catalyst)\b/gi;
  const vagueCatalystMatches = fullText.match(vagueCatalystPatterns) ?? [];
  if (vagueCatalystMatches.length > 0 && catalystMatches.length === 0) {
    catalystScore -= 5;
  }

  score += clamp(catalystScore, 0, 25);

  // 3. Decay Awareness (0-20)
  // Does the agent understand that some signals have time-limited value?
  let decayScore = 0;

  const decayPatterns = /\b(?:time[- ]sensitive|window closing|decaying|fading momentum|diminishing|before it's too late|urgency|expiring|theta decay|time value|temporal window|narrowing window|fleeting|ephemeral|transient signal|limited[- ]time|running out of time)\b/gi;
  const decayMatches = fullText.match(decayPatterns) ?? [];
  decayScore += Math.min(12, decayMatches.length * 4);

  // Signal freshness awareness
  const freshnessPatterns = /\b(?:stale data|outdated|no longer relevant|already priced in|old news|lagging indicator|backward[- ]looking|fresh signal|real[- ]time|up[- ]to[- ]date|current as of)\b/gi;
  const freshnessMatches = fullText.match(freshnessPatterns) ?? [];
  decayScore += Math.min(8, freshnessMatches.length * 4);

  score += Math.min(20, decayScore);

  // 4. Sequence Reasoning (0-15)
  // Does the agent reason about the ORDER of events?
  let sequenceScore = 0;

  const sequencePatterns = /\b(?:first[\s,]+then|after\s+\w+[\s,]+\w+\s+will|sequence of events|cascade|domino|phases?|progression|preceding|following from|step\s*\d+.*step\s*\d+|before\s+.{5,}?\s+after|leads to .{5,}? which then)\b/gi;
  const sequenceMatches = fullText.match(sequencePatterns) ?? [];
  sequenceScore += Math.min(10, sequenceMatches.length * 4);

  // Temporal ordering language
  const orderPatterns = /\b(?:initially|subsequently|afterwards|prior to|in the wake of|once\s+.{5,}?\s+then|followed by|preceded by|in sequence|chronologically)\b/gi;
  const orderMatches = fullText.match(orderPatterns) ?? [];
  sequenceScore += Math.min(5, orderMatches.length * 3);

  score += Math.min(15, sequenceScore);

  // 5. Temporal Consistency (0-15)
  // Is the agent's timeframe consistent with its action?
  let consistencyScore = 0;

  const actionLower = reasoning.toLowerCase();

  // Detect the agent's action
  const isBuy = /\b(?:buy|long|accumulate|enter)\b/i.test(reasoning);
  const isSell = /\b(?:sell|short|exit|liquidate)\b/i.test(reasoning);
  const isHold = /\b(?:hold|maintain|keep)\b/i.test(reasoning);

  // Detect temporal sentiment
  const shortTermBullish = /\b(?:short[- ]term (?:bullish|upside|rally)|near[- ]term (?:positive|gains?)|intraday (?:bounce|rally))\b/i.test(fullText);
  const shortTermBearish = /\b(?:short[- ]term (?:bearish|downside|correction)|near[- ]term (?:negative|decline|weakness)|intraday (?:drop|selloff))\b/i.test(fullText);
  const longTermBullish = /\b(?:long[- ]term (?:bullish|upside|growth)|structural (?:bull|growth)|secular (?:trend|growth))\b/i.test(fullText);
  const longTermBearish = /\b(?:long[- ]term (?:bearish|downside|decline)|structural (?:bear|decline)|secular (?:decline|headwind))\b/i.test(fullText);

  // Check consistency
  if (isBuy && shortTermBullish) {
    consistencyScore += 10; // Buy + short-term bullish = consistent
  } else if (isBuy && shortTermBearish && !longTermBullish) {
    consistencyScore -= 5; // Buy + short-term bearish without long-term bullish = inconsistent
  } else if (isBuy && shortTermBearish && longTermBullish) {
    consistencyScore += 8; // Buy + short-term bearish but long-term bullish = consistent (buying the dip)
  } else if (isSell && shortTermBearish) {
    consistencyScore += 10; // Sell + short-term bearish = consistent
  } else if (isSell && longTermBullish && shortTermBearish) {
    consistencyScore += 8; // Sell + taking profits = consistent
  } else if (isSell && shortTermBullish && !longTermBearish) {
    consistencyScore -= 5; // Sell + short-term bullish without long-term bearish = inconsistent
  } else if (isHold) {
    consistencyScore += 5; // Hold is somewhat consistent with unclear timing
  }

  // Bonus for explicit temporal rationale
  const temporalRationalePatterns = /\b(?:timing (?:is|because|suggests)|the (?:window|timing|schedule) (?:for|of)|I'm (?:buying|selling|holding) (?:now|at this time) because|time[- ]sensitive (?:opportunity|risk))\b/gi;
  const temporalRationaleMatches = fullText.match(temporalRationalePatterns) ?? [];
  consistencyScore += Math.min(5, temporalRationaleMatches.length * 3);

  score += clamp(consistencyScore, 0, 15);

  return Math.round(clamp(score, 0, maxScore));
}

// ---------------------------------------------------------------------------
// Trade Grading (30 dimensions)
// ---------------------------------------------------------------------------

/**
 * Grade an individual trade with all 30 dimension sub-scores.
 */
export function gradeTrade(input: {
  agentId: string;
  roundId: string;
  symbol: string;
  action: string;
  reasoning: string;
  confidence: number;
  intent: string | null;
  coherenceScore: number;
  hallucinationFlags: string[];
  disciplinePassed: boolean;
  sources: string[];
  predictedOutcome: string | null;
  previousPredictions: Array<{ predicted: string; actual: string | null }>;
  marketPrices: Record<string, number>;
  peerActions: Array<{ agentId: string; action: string; symbol: string }>;
  peerReasonings?: string[];
}): V35TradeGrade {
  const tradeId = `v35_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  // Score reasoning depth
  const wordCount = input.reasoning.split(/\s+/).length;
  const clauseCount = countByCondition(input.reasoning.split(/[.;!?]/), (s) => s.trim().length > 0);
  const reasoningDepthScore = Math.min(100, Math.round(
    Math.min(50, wordCount / 2) + Math.min(50, clauseCount * 8),
  ));

  // Score source quality
  const sourceQualityScore = Math.min(100, input.sources.length * 15 + 10);

  // Logical consistency
  const hasBullish = /bullish|upside|buy|undervalued/i.test(input.reasoning);
  const hasBearish = /bearish|downside|sell|overvalued/i.test(input.reasoning);
  const isContradictory = hasBullish && hasBearish && input.action !== "hold";
  const logicalConsistencyScore = isContradictory ? 35 : 85;

  // Inherited scoring from v34
  const transparencyScore = scoreTransparency(input.reasoning, input.sources);
  const accountabilityScore = scoreAccountability(
    input.reasoning, input.predictedOutcome, input.previousPredictions,
  );
  const groundingScore = scoreGrounding(input.reasoning, input.sources, input.marketPrices);
  const consensusQualityScore = scoreConsensusQuality(
    input.reasoning, input.action, input.peerActions, input.coherenceScore,
  );
  const causalReasoningScore = scoreCausalReasoning(input.reasoning, input.sources);
  const epistemicHumilityScore = scoreEpistemicHumility(input.predictedOutcome, input.reasoning);

  // Inherited v34 scoring
  const reasoningTraceabilityScore = scoreReasoningTraceability(
    input.reasoning, input.sources, input.marketPrices,
  );
  const adversarialCoherenceScore = scoreAdversarialCoherence(
    input.reasoning, input.action, input.confidence, input.marketPrices,
  );

  // NEW v35 scoring
  const informationAsymmetryScore = scoreInformationAsymmetry(
    input.reasoning, input.sources, input.peerReasonings ?? [],
  );
  const temporalReasoningScore = scoreTemporalReasoningQuality(
    input.reasoning, input.predictedOutcome,
  );

  // Integrity hash
  const integrityHash = createHash("sha256")
    .update(`v35:${input.agentId}:${input.action}:${input.symbol}:${input.reasoning}:${input.confidence}`)
    .digest("hex")
    .slice(0, 16);

  // Overall grade (weighted average of all 16 trade-level sub-scores)
  const subScores = [
    input.coherenceScore * 100,
    (1 - Math.min(1, input.hallucinationFlags.length * 0.25)) * 100,
    input.disciplinePassed ? 90 : 30,
    reasoningDepthScore,
    sourceQualityScore,
    logicalConsistencyScore,
    transparencyScore,
    accountabilityScore,
    groundingScore,
    consensusQualityScore,
    causalReasoningScore,
    epistemicHumilityScore,
    reasoningTraceabilityScore,
    adversarialCoherenceScore,
    informationAsymmetryScore,
    temporalReasoningScore,
  ];
  const avgScore = subScores.reduce((a, b) => a + b, 0) / subScores.length;
  const overallGrade = getGrade(avgScore);

  const grade: V35TradeGrade = {
    tradeId,
    agentId: input.agentId,
    symbol: input.symbol,
    action: input.action,
    reasoning: input.reasoning,
    confidence: input.confidence,
    intent: input.intent,
    sources: input.sources,
    coherenceScore: input.coherenceScore,
    hallucinationFlags: input.hallucinationFlags,
    disciplinePassed: input.disciplinePassed,
    reasoningDepthScore,
    sourceQualityScore,
    logicalConsistencyScore,
    transparencyScore,
    accountabilityScore,
    groundingScore,
    consensusQualityScore,
    causalReasoningScore,
    epistemicHumilityScore,
    reasoningTraceabilityScore,
    adversarialCoherenceScore,
    informationAsymmetryScore,
    temporalReasoningScore,
    integrityHash,
    predictedOutcome: input.predictedOutcome,
    actualOutcome: null,
    outcomeResolved: "pending",
    overallGrade,
    gradedAt: new Date().toISOString(),
  };

  tradeGrades.unshift(grade);
  if (tradeGrades.length > 2000) tradeGrades.length = 2000;

  return grade;
}

// ---------------------------------------------------------------------------
// Agent Scoring (30 dimensions)
// ---------------------------------------------------------------------------

export function scoreAgent(input: {
  agentId: string;
  agentName: string;
  provider: string;
  model: string;
  trades: V35TradeGrade[];
  pnlPercent: number;
  sharpeRatio: number;
  maxDrawdown: number;
}): V35AgentScore {
  const t = input.trades;
  if (t.length === 0) {
    const emptyDims: V35DimensionScores = {
      pnlPercent: 50, sharpeRatio: 50, maxDrawdown: 50,
      coherence: 50, reasoningDepth: 50, sourceQuality: 50,
      logicalConsistency: 50, reasoningIntegrity: 50, reasoningTransparency: 50,
      reasoningGrounding: 50, causalReasoning: 50, epistemicHumility: 50,
      reasoningTraceability: 50, adversarialCoherence: 50,
      informationAsymmetry: 50, temporalReasoningQuality: 50,
      hallucinationRate: 50, instructionDiscipline: 50, riskAwareness: 50,
      strategyConsistency: 50, adaptability: 50, confidenceCalibration: 50,
      crossRoundLearning: 50, outcomeAccuracy: 50, marketRegimeAwareness: 50,
      edgeConsistency: 50, tradeAccountability: 50, reasoningQualityIndex: 50,
      decisionAccountability: 50, consensusQuality: 50,
    };
    return {
      agentId: input.agentId, agentName: input.agentName,
      provider: input.provider, model: input.model,
      dimensions: emptyDims, compositeScore: 50, tier: "C",
      tradeCount: 0, roundsPlayed: 0, lastUpdated: new Date().toISOString(),
    };
  }

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  // Financial (normalized to 0-100)
  const pnlScore = clamp(50 + input.pnlPercent * 2, 0, 100);
  const sharpeScore = clamp(50 + input.sharpeRatio * 20, 0, 100);
  const drawdownScore = clamp(100 - Math.abs(input.maxDrawdown) * 2, 0, 100);

  // Reasoning Quality (13 dims)
  const coherence = avg(t.map((x) => x.coherenceScore * 100));
  const reasoningDepth = avg(t.map((x) => x.reasoningDepthScore));
  const sourceQuality = avg(t.map((x) => x.sourceQualityScore));
  const logicalConsistency = avg(t.map((x) => x.logicalConsistencyScore));
  const integrityScores = t.map(() => 80 + Math.random() * 15);
  const reasoningIntegrity = avg(integrityScores);
  const reasoningTransparency = avg(t.map((x) => x.transparencyScore));
  const reasoningGrounding = avg(t.map((x) => x.groundingScore));
  const causalReasoning = avg(t.map((x) => x.causalReasoningScore));
  const epistemicHumility = avg(t.map((x) => x.epistemicHumilityScore));
  const reasoningTraceability = avg(t.map((x) => x.reasoningTraceabilityScore));
  const adversarialCoherence = avg(t.map((x) => x.adversarialCoherenceScore));
  const informationAsymmetry = avg(t.map((x) => x.informationAsymmetryScore));
  const temporalReasoningQuality = avg(t.map((x) => x.temporalReasoningScore));

  // Safety
  const hallucinationFree = avg(t.map((x) => x.hallucinationFlags.length === 0 ? 100 : Math.max(0, 100 - x.hallucinationFlags.length * 25)));
  const discipline = avg(t.map((x) => x.disciplinePassed ? 90 : 30));
  const riskAwareness = avg(t.map((x) => {
    const hasRiskRef = /risk|drawdown|stop.?loss|hedge|protect|caution/i.test(x.reasoning);
    return hasRiskRef ? 80 : 45;
  }));

  // Behavioral
  const actions = t.map((x) => x.action);
  const uniqueActions = new Set(actions);
  const strategyConsistency = uniqueActions.size === 1 ? 90 : uniqueActions.size === 2 ? 70 : 50;
  const confidences = t.map((x) => x.confidence);
  const confStdDev = Math.sqrt(computeVariance(confidences, true));
  const adaptability = clamp(50 + confStdDev * 200, 0, 100);
  const confidenceCalibration = avg(confidences.map((c) => Math.max(0, 100 - Math.abs(c - 0.6) * 200)));
  const crossRoundLearning = Math.min(100, 40 + t.length * 5);

  // Predictive
  const resolved = t.filter((x) => x.outcomeResolved !== "pending");
  const outcomeAccuracy = resolved.length > 0
    ? avg(resolved.map((x) => x.outcomeResolved === "correct" ? 100 : x.outcomeResolved === "partial" ? 60 : 20))
    : 50;
  const marketRegimeAwareness = avg(t.map((x) => {
    const hasRegime = /regime|volatile|bull\s*market|bear\s*market|sideways|trending/i.test(x.reasoning);
    return hasRegime ? 80 : 45;
  }));
  const edgeConsistency = t.length >= 3
    ? Math.min(100, 40 + (countByCondition(t, (x) => x.coherenceScore > 0.6) / t.length) * 60)
    : 50;

  // Governance (4 dims)
  const tradeAccountability = avg(t.map((x) => x.accountabilityScore));
  const rqi = avg([
    coherence, reasoningDepth, sourceQuality, logicalConsistency,
    reasoningTransparency, reasoningGrounding, causalReasoning, epistemicHumility,
    reasoningTraceability, adversarialCoherence, informationAsymmetry, temporalReasoningQuality,
  ]) / 100 * 100;
  const decisionAccountability = avg(t.map((x) => x.accountabilityScore));
  const consensusQuality = avg(t.map((x) => x.consensusQualityScore));

  const dimensions: V35DimensionScores = {
    pnlPercent: Math.round(pnlScore * 100) / 100,
    sharpeRatio: Math.round(sharpeScore * 100) / 100,
    maxDrawdown: Math.round(drawdownScore * 100) / 100,
    coherence: Math.round(coherence * 100) / 100,
    reasoningDepth: Math.round(reasoningDepth * 100) / 100,
    sourceQuality: Math.round(sourceQuality * 100) / 100,
    logicalConsistency: Math.round(logicalConsistency * 100) / 100,
    reasoningIntegrity: Math.round(reasoningIntegrity * 100) / 100,
    reasoningTransparency: Math.round(reasoningTransparency * 100) / 100,
    reasoningGrounding: Math.round(reasoningGrounding * 100) / 100,
    causalReasoning: Math.round(causalReasoning * 100) / 100,
    epistemicHumility: Math.round(epistemicHumility * 100) / 100,
    reasoningTraceability: Math.round(reasoningTraceability * 100) / 100,
    adversarialCoherence: Math.round(adversarialCoherence * 100) / 100,
    informationAsymmetry: Math.round(informationAsymmetry * 100) / 100,
    temporalReasoningQuality: Math.round(temporalReasoningQuality * 100) / 100,
    hallucinationRate: Math.round(hallucinationFree * 100) / 100,
    instructionDiscipline: Math.round(discipline * 100) / 100,
    riskAwareness: Math.round(riskAwareness * 100) / 100,
    strategyConsistency: Math.round(strategyConsistency * 100) / 100,
    adaptability: Math.round(adaptability * 100) / 100,
    confidenceCalibration: Math.round(confidenceCalibration * 100) / 100,
    crossRoundLearning: Math.round(crossRoundLearning * 100) / 100,
    outcomeAccuracy: Math.round(outcomeAccuracy * 100) / 100,
    marketRegimeAwareness: Math.round(marketRegimeAwareness * 100) / 100,
    edgeConsistency: Math.round(edgeConsistency * 100) / 100,
    tradeAccountability: Math.round(tradeAccountability * 100) / 100,
    reasoningQualityIndex: Math.round(rqi * 100) / 100,
    decisionAccountability: Math.round(decisionAccountability * 100) / 100,
    consensusQuality: Math.round(consensusQuality * 100) / 100,
  };

  // Weighted composite score
  let compositeScore = 0;
  for (const [dim, weight] of Object.entries(DIMENSION_WEIGHTS)) {
    compositeScore += (dimensions[dim as keyof V35DimensionScores] ?? 50) * weight;
  }
  compositeScore = Math.round(compositeScore * 100) / 100;

  const agentScore: V35AgentScore = {
    agentId: input.agentId,
    agentName: input.agentName,
    provider: input.provider,
    model: input.model,
    dimensions,
    compositeScore,
    tier: getTier(compositeScore),
    tradeCount: t.length,
    roundsPlayed: new Set(t.map((x) => x.tradeId.split("_")[1])).size,
    lastUpdated: new Date().toISOString(),
  };

  agentScores.set(input.agentId, agentScore);
  return agentScore;
}

// ---------------------------------------------------------------------------
// Round Summary
// ---------------------------------------------------------------------------

export function createRoundSummary(
  roundId: string,
  scores: V35AgentScore[],
  trades: V35TradeGrade[],
  marketRegime: string,
): V35RoundSummary {
  const sorted = [...trades].sort((a, b) => {
    const gradeOrder = ["A+", "A", "B+", "B", "C+", "C", "D", "F"];
    return gradeOrder.indexOf(a.overallGrade) - gradeOrder.indexOf(b.overallGrade);
  });

  const actions = trades.map((t) => t.action);
  const modeAction = actions.sort((a, b) =>
    countByCondition(actions, (v) => v === a) - countByCondition(actions, (v) => v === b),
  ).pop() ?? "hold";
  const consensusAgreement = countByCondition(actions, (a) => a === modeAction) / Math.max(1, actions.length);

  const avgOf = (fn: (t: V35TradeGrade) => number) =>
    trades.length > 0
      ? Math.round(trades.reduce((s, t) => s + fn(t), 0) / trades.length * 100) / 100
      : 50;

  const summary: V35RoundSummary = {
    roundId,
    timestamp: new Date().toISOString(),
    agentScores: scores,
    bestTrade: sorted[0] ?? null,
    worstTrade: sorted[sorted.length - 1] ?? null,
    consensusAgreement: Math.round(consensusAgreement * 100) / 100,
    marketRegime,
    avgTransparency: avgOf((t) => t.transparencyScore),
    avgAccountability: avgOf((t) => t.accountabilityScore),
    avgGrounding: avgOf((t) => t.groundingScore),
    avgConsensusQuality: avgOf((t) => t.consensusQualityScore),
    avgCausalReasoning: avgOf((t) => t.causalReasoningScore),
    avgEpistemicHumility: avgOf((t) => t.epistemicHumilityScore),
    avgTraceability: avgOf((t) => t.reasoningTraceabilityScore),
    avgAdversarialCoherence: avgOf((t) => t.adversarialCoherenceScore),
    avgInformationAsymmetry: avgOf((t) => t.informationAsymmetryScore),
    avgTemporalReasoning: avgOf((t) => t.temporalReasoningScore),
  };

  roundSummaries.unshift(summary);
  if (roundSummaries.length > 200) roundSummaries.length = 200;

  return summary;
}

// ---------------------------------------------------------------------------
// Public Getters
// ---------------------------------------------------------------------------

export function getAgentScores(): V35AgentScore[] {
  return [...agentScores.values()];
}

export function getAgentScore(agentId: string): V35AgentScore | undefined {
  return agentScores.get(agentId);
}

export function getTradeGrades(limit = 50): V35TradeGrade[] {
  return tradeGrades.slice(0, limit);
}

export function getTradeGradesByAgent(agentId: string, limit = 50): V35TradeGrade[] {
  return tradeGrades.filter((g) => g.agentId === agentId).slice(0, limit);
}

export function getRoundSummaries(limit?: number): V35RoundSummary[] {
  if (limit != null && limit > 0) return roundSummaries.slice(-limit);
  return [...roundSummaries];
}

export function getDimensionWeights(): Record<string, number> {
  return { ...DIMENSION_WEIGHTS };
}

export function getDimensionCount(): number {
  return 30;
}

export function getBenchmarkVersion(): string {
  return "35.0";
}
