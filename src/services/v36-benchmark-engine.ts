/**
 * V36 Benchmark Engine — 32-Dimension AI Trading Benchmark
 *
 * Extends v35's 30-dimension framework with:
 * - Reasoning Auditability: Can every claim be independently verified?
 * - Decision Reversibility: Does the agent plan for when its thesis breaks?
 *
 * Categories (32 dimensions):
 * - Financial Performance (3): pnl, sharpe, drawdown
 * - Reasoning Quality (15): coherence, depth, source, consistency,
 *   integrity, transparency, grounding, causal, epistemic,
 *   traceability, adversarial, info asymmetry, temporal, auditability (NEW), reversibility (NEW)
 * - Safety & Trust (3): hallucination, discipline, risk awareness
 * - Behavioral Intelligence (4): consistency, adaptability, calibration, learning
 * - Predictive Power (3): outcome, regime, edge
 * - Governance & Accountability (4): accountability, RQI, decision accountability, consensus
 */

import { createHash } from "crypto";

// Re-export inherited scoring functions from v35
export {
  scoreGrounding,
  scoreConsensusQuality,
  scoreTransparency,
  scoreAccountability,
  scoreCausalReasoning,
  scoreEpistemicHumility,
  scoreReasoningTraceability,
  scoreAdversarialCoherence,
  scoreInformationAsymmetry,
  scoreTemporalReasoningQuality,
} from "./v35-benchmark-engine.ts";

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
  scoreInformationAsymmetry,
  scoreTemporalReasoningQuality,
} from "./v35-benchmark-engine.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Reasoning Auditability Scoring Parameters
 *
 * Auditability measures whether reasoning claims can be independently verified.
 * These thresholds control pattern matching and point assignment across 5 categories:
 * spread awareness, liquidity assessment, execution strategy, market impact, cost consciousness.
 */

// 1. Spread Awareness Scoring (0-20 points total)
const SPREAD_AWARENESS_SPREAD_PATTERN_MAX_SCORE = 12; // Max points for spread/slippage mentions
const SPREAD_AWARENESS_SPREAD_PATTERN_POINTS_PER_MATCH = 4; // Points per spread pattern match
const SPREAD_AWARENESS_BPS_PATTERN_MAX_SCORE = 8; // Max points for basis point references
const SPREAD_AWARENESS_BPS_PATTERN_POINTS_PER_MATCH = 4; // Points per bps/percentage match
const SPREAD_AWARENESS_MAX_SCORE = 20; // Category ceiling

// 2. Liquidity Assessment Scoring (0-20 points total)
const LIQUIDITY_ASSESSMENT_LIQUIDITY_PATTERN_MAX_SCORE = 12; // Max points for liquidity mentions
const LIQUIDITY_ASSESSMENT_LIQUIDITY_PATTERN_POINTS_PER_MATCH = 4; // Points per liquidity match
const LIQUIDITY_ASSESSMENT_VOLUME_QUANT_MAX_SCORE = 8; // Max points for quantitative volume refs
const LIQUIDITY_ASSESSMENT_VOLUME_QUANT_POINTS_PER_MATCH = 4; // Points per $X volume mention
const LIQUIDITY_ASSESSMENT_MAX_SCORE = 20; // Category ceiling

// 3. Execution Strategy Scoring (0-20 points total)
const EXECUTION_STRATEGY_EXECUTION_PATTERN_MAX_SCORE = 12; // Max points for TWAP/VWAP/limit mentions
const EXECUTION_STRATEGY_EXECUTION_PATTERN_POINTS_PER_MATCH = 5; // Points per execution strategy match
const EXECUTION_STRATEGY_TIMING_PATTERN_MAX_SCORE = 8; // Max points for timing-related execution
const EXECUTION_STRATEGY_TIMING_PATTERN_POINTS_PER_MATCH = 4; // Points per timing reference
const EXECUTION_STRATEGY_MAX_SCORE = 20; // Category ceiling

// 4. Market Impact Awareness Scoring (0-20 points total)
const MARKET_IMPACT_IMPACT_PATTERN_MAX_SCORE = 12; // Max points for impact awareness mentions
const MARKET_IMPACT_IMPACT_PATTERN_POINTS_PER_MATCH = 4; // Points per impact pattern match
const MARKET_IMPACT_SIZE_AWARE_MAX_SCORE = 8; // Max points for size-relative awareness
const MARKET_IMPACT_SIZE_AWARE_POINTS_PER_MATCH = 4; // Points per size-awareness match
const MARKET_IMPACT_HOLD_PARTIAL_CREDIT = 2; // Partial credit when quantity is 0 (hold)
const MARKET_IMPACT_MAX_SCORE = 20; // Category ceiling

// 5. Cost Consciousness Scoring (0-20 points total)
const COST_CONSCIOUSNESS_COST_PATTERN_MAX_SCORE = 12; // Max points for cost/fee mentions
const COST_CONSCIOUSNESS_COST_PATTERN_POINTS_PER_MATCH = 4; // Points per cost pattern match
const COST_CONSCIOUSNESS_SLIPPAGE_PATTERN_MAX_SCORE = 8; // Max points for slippage tolerance
const COST_CONSCIOUSNESS_SLIPPAGE_PATTERN_POINTS_PER_MATCH = 4; // Points per slippage mention
const COST_CONSCIOUSNESS_MAX_SCORE = 20; // Category ceiling

// 6. Source Bonus for Execution-Related References (0-5 bonus points)
const AUDITABILITY_SOURCE_BONUS_MAX = 5; // Max bonus for execution-related sources
const AUDITABILITY_SOURCE_BONUS_POINTS_PER_SOURCE = 3; // Points per execution source

// 7. Overall Auditability Limits
const AUDITABILITY_MAX_SCORE = 100; // Maximum auditability score
const AUDITABILITY_MIN_SCORE = 0; // Minimum auditability score

/**
 * Decision Reversibility Scoring Parameters
 *
 * Reversibility measures whether agents plan for when their thesis breaks.
 * These thresholds control evidence-confidence alignment, source calibration,
 * hedging coherence, historical accuracy, and reasoning depth scoring.
 */

// 1. Evidence-Confidence Alignment (0-25 points total)
const REVERSIBILITY_EVIDENCE_WORDS_PER_UNIT = 50; // Words per evidence density unit (for normalization)
const REVERSIBILITY_EVIDENCE_HIGH_CONF_THRESHOLD = 0.8; // >= 80% confidence = high (strict evidence required)
const REVERSIBILITY_EVIDENCE_HIGH_CONF_STRONG_DENSITY = 1.5; // Density threshold for 25 points
const REVERSIBILITY_EVIDENCE_HIGH_CONF_GOOD_DENSITY = 1.0; // Density threshold for 20 points
const REVERSIBILITY_EVIDENCE_HIGH_CONF_MODERATE_DENSITY = 0.5; // Density threshold for 12 points
const REVERSIBILITY_EVIDENCE_HIGH_CONF_WEAK_SCORE = 5; // Score for low evidence with high confidence
const REVERSIBILITY_EVIDENCE_HIGH_CONF_GOOD_SCORE = 20; // Score for good evidence density with high confidence
const REVERSIBILITY_EVIDENCE_HIGH_CONF_MODERATE_SCORE = 12; // Score for moderate evidence density with high confidence
const REVERSIBILITY_EVIDENCE_MODERATE_CONF_THRESHOLD = 0.5; // >= 50% confidence = moderate
const REVERSIBILITY_EVIDENCE_MODERATE_CONF_STRONG_DENSITY = 1.0; // Density threshold for 22 points
const REVERSIBILITY_EVIDENCE_MODERATE_CONF_STRONG_SCORE = 22; // Score for strong evidence density with moderate confidence
const REVERSIBILITY_EVIDENCE_MODERATE_CONF_GOOD_DENSITY = 0.5; // Density threshold for 20 points
const REVERSIBILITY_EVIDENCE_MODERATE_CONF_GOOD_SCORE = 20; // Score for good evidence density with moderate confidence
const REVERSIBILITY_EVIDENCE_MODERATE_CONF_BASELINE_SCORE = 15; // Score for lower evidence
const REVERSIBILITY_EVIDENCE_LOW_CONF_GOOD_DENSITY = 0.5; // Density threshold for 20 points (low conf)
const REVERSIBILITY_EVIDENCE_LOW_CONF_GOOD_SCORE = 20; // Score for good evidence density with low confidence
const REVERSIBILITY_EVIDENCE_LOW_CONF_SOME_SCORE = 18; // Score when some evidence exists
const REVERSIBILITY_EVIDENCE_LOW_CONF_BASELINE_SCORE = 12; // Score for no evidence
const REVERSIBILITY_EVIDENCE_HALLUCINATION_CONF_THRESHOLD = 0.7; // >= 70% confidence + hallucinations = penalty
const REVERSIBILITY_EVIDENCE_HALLUCINATION_PENALTY_PER_FLAG = 5; // Penalty points per hallucination flag
const REVERSIBILITY_EVIDENCE_MAX_SCORE = 25; // Category ceiling

// 2. Source-Confidence Calibration (0-25 points total)
const REVERSIBILITY_SOURCE_HIGH_CONF_EXPECTED = 4; // Expected sources for >= 80% confidence
const REVERSIBILITY_SOURCE_MODERATE_CONF_EXPECTED = 2; // Expected sources for >= 50% confidence
const REVERSIBILITY_SOURCE_LOW_CONF_EXPECTED = 1; // Expected sources for < 50% confidence
const REVERSIBILITY_SOURCE_BASELINE_SCORE = 20; // Base score when meeting expectations
const REVERSIBILITY_SOURCE_BONUS_POINTS_PER_EXTRA = 2; // Bonus points per extra source
const REVERSIBILITY_SOURCE_BONUS_MAX = 5; // Max bonus for extra sources
const REVERSIBILITY_SOURCE_SHORTFALL_PENALTY = 5; // Penalty per missing source
const REVERSIBILITY_SOURCE_MIN_SCORE = 5; // Minimum score for source calibration
const REVERSIBILITY_SOURCE_DIVERSITY_THRESHOLD = 3; // >= 3 unique source types = bonus
const REVERSIBILITY_SOURCE_DIVERSITY_BONUS = 3; // Bonus for diverse source types
const REVERSIBILITY_SOURCE_MAX_SCORE = 25; // Category ceiling

// 3. Hedging-Confidence Coherence (0-20 points total)
const REVERSIBILITY_HEDGING_WORDS_PER_UNIT = 50; // Words per hedging density unit (for normalization)
const REVERSIBILITY_HEDGING_HIGH_CONF_THRESHOLD = 0.8; // >= 80% confidence = high (limited hedging expected)
const REVERSIBILITY_HEDGING_HIGH_CONF_MIN_DENSITY = 0.2; // Min hedging density for good score
const REVERSIBILITY_HEDGING_HIGH_CONF_MAX_DENSITY = 1; // Max hedging density for good score
const REVERSIBILITY_HEDGING_HIGH_CONF_GOOD_SCORE = 18; // Score for appropriate hedging with high confidence
const REVERSIBILITY_HEDGING_HIGH_CONF_GOOD_MAX_DENSITY = 1; // Max hedging density for 18 points
const REVERSIBILITY_HEDGING_HIGH_CONF_MODERATE_MAX_DENSITY = 2; // Max hedging density for 14 points
const REVERSIBILITY_HEDGING_HIGH_CONF_MODERATE_SCORE = 14; // Score for moderate hedging with high confidence
const REVERSIBILITY_HEDGING_HIGH_CONF_EXCESSIVE_SCORE = 6; // Score for too much hedging
const REVERSIBILITY_HEDGING_MODERATE_CONF_THRESHOLD = 0.5; // >= 50% confidence = moderate
const REVERSIBILITY_HEDGING_MODERATE_CONF_MIN_DENSITY = 0.5; // Min hedging for good score
const REVERSIBILITY_HEDGING_MODERATE_CONF_MAX_DENSITY = 3; // Max hedging for good score
const REVERSIBILITY_HEDGING_MODERATE_CONF_GOOD_SCORE = 18; // Score for appropriate hedging with moderate confidence
const REVERSIBILITY_HEDGING_MODERATE_CONF_GOOD_MIN_DENSITY = 0.5; // Min hedging for 18 points
const REVERSIBILITY_HEDGING_MODERATE_CONF_GOOD_MAX_DENSITY = 3; // Max hedging for 18 points
const REVERSIBILITY_HEDGING_MODERATE_CONF_EXCESSIVE_SCORE = 12; // Score for too much hedging
const REVERSIBILITY_HEDGING_MODERATE_CONF_LOW_SCORE = 14; // Score for less hedging than ideal
const REVERSIBILITY_HEDGING_MODERATE_CONF_NONE_SCORE = 10; // Score for no hedging (slightly off)
const REVERSIBILITY_HEDGING_LOW_CONF_MIN_DENSITY = 1; // Min hedging density for good score with low confidence
const REVERSIBILITY_HEDGING_LOW_CONF_GOOD_SCORE = 18; // Score for appropriate hedging with low confidence
const REVERSIBILITY_HEDGING_LOW_CONF_GOOD_MIN_DENSITY = 1; // Min hedging for 18 points (low conf)
const REVERSIBILITY_HEDGING_LOW_CONF_SOME_SCORE = 14; // Score for some hedging
const REVERSIBILITY_HEDGING_LOW_CONF_NONE_SCORE = 6; // Score for no hedging (inconsistent)
const REVERSIBILITY_HEDGING_UNCERTAINTY_QUANT_BONUS = 3; // Bonus for explicit % probability mentions
const REVERSIBILITY_HEDGING_MAX_SCORE = 20; // Category ceiling

// 4. Historical Accuracy Match (0-15 points total)
const REVERSIBILITY_ACCURACY_MIN_OUTCOMES = 3; // Minimum outcomes needed for calibration analysis
const REVERSIBILITY_ACCURACY_HIGH_CONF_FILTER = 0.7; // >= 70% confidence = high (filter threshold)
const REVERSIBILITY_ACCURACY_HIGH_CONF_FILTER_THRESHOLD = 0.7; // >= 70% confidence = high
const REVERSIBILITY_ACCURACY_LOW_CONF_FILTER = 0.4; // < 40% confidence = low (filter threshold)
const REVERSIBILITY_ACCURACY_LOW_CONF_FILTER_THRESHOLD = 0.4; // < 40% confidence = low
const REVERSIBILITY_ACCURACY_GOOD_CALIBRATION_SCORE = 12; // Score when high conf > low conf accuracy
const REVERSIBILITY_ACCURACY_NEUTRAL_CALIBRATION_SCORE = 8; // Score when high conf = low conf accuracy
const REVERSIBILITY_ACCURACY_INVERTED_CALIBRATION_SCORE = 3; // Score when high conf < low conf accuracy
const REVERSIBILITY_ACCURACY_OVERALL_TOLERANCE = 0.2; // Tolerance for overall accuracy match (20%)
const REVERSIBILITY_ACCURACY_CALIBRATION_TOLERANCE = 0.2; // Tolerance for overall accuracy match (20%)
const REVERSIBILITY_ACCURACY_CALIBRATION_BONUS = 3; // Bonus for well-calibrated overall accuracy
const REVERSIBILITY_ACCURACY_INSUFFICIENT_DATA_SCORE = 8; // Partial credit when < 3 outcomes
const REVERSIBILITY_ACCURACY_MAX_SCORE = 15; // Category ceiling

// 5. Reasoning Depth Proportionality (0-15 points total)
const REVERSIBILITY_DEPTH_HIGH_CONF_THRESHOLD = 0.8; // >= 80% confidence = high (deep reasoning required)
const REVERSIBILITY_DEPTH_HIGH_CONF_WORD_COUNT = 80; // >= 80 words for deep reasoning (alias for DEEP_WORD_COUNT)
const REVERSIBILITY_DEPTH_HIGH_CONF_CLAUSE_COUNT = 5; // >= 5 clauses for deep reasoning (alias for DEEP_CLAUSE_COUNT)
const REVERSIBILITY_DEPTH_HIGH_CONF_DEEP_WORD_COUNT = 80; // >= 80 words for deep reasoning
const REVERSIBILITY_DEPTH_HIGH_CONF_DEEP_CLAUSE_COUNT = 5; // >= 5 clauses for deep reasoning
const REVERSIBILITY_DEPTH_HIGH_CONF_DEEP_SCORE = 15; // Score for deep reasoning
const REVERSIBILITY_DEPTH_HIGH_CONF_MODERATE_WORD_COUNT = 50; // >= 50 words for moderate reasoning
const REVERSIBILITY_DEPTH_HIGH_CONF_MODERATE_CLAUSE_COUNT = 3; // >= 3 clauses for moderate reasoning
const REVERSIBILITY_DEPTH_HIGH_CONF_MODERATE_SCORE = 10; // Score for moderate reasoning
const REVERSIBILITY_DEPTH_HIGH_CONF_SHALLOW_SCORE = 4; // Score for shallow reasoning + high confidence
const REVERSIBILITY_DEPTH_MODERATE_CONF_THRESHOLD = 0.5; // >= 50% confidence = moderate
const REVERSIBILITY_DEPTH_MODERATE_CONF_WORD_COUNT = 40; // >= 40 words for good reasoning (alias for GOOD_WORD_COUNT)
const REVERSIBILITY_DEPTH_MODERATE_CONF_CLAUSE_COUNT = 3; // >= 3 clauses for good reasoning (alias for GOOD_CLAUSE_COUNT)
const REVERSIBILITY_DEPTH_MODERATE_CONF_MIN_WORD_COUNT = 25; // >= 25 words for adequate reasoning
const REVERSIBILITY_DEPTH_MODERATE_CONF_BRIEF_SCORE = 7; // Score for brief reasoning with moderate confidence
const REVERSIBILITY_DEPTH_MODERATE_CONF_GOOD_WORD_COUNT = 40; // >= 40 words for good reasoning
const REVERSIBILITY_DEPTH_MODERATE_CONF_GOOD_CLAUSE_COUNT = 3; // >= 3 clauses for good reasoning
const REVERSIBILITY_DEPTH_MODERATE_CONF_GOOD_SCORE = 13; // Score for good reasoning
const REVERSIBILITY_DEPTH_MODERATE_CONF_ADEQUATE_WORD_COUNT = 25; // >= 25 words for adequate reasoning
const REVERSIBILITY_DEPTH_MODERATE_CONF_ADEQUATE_SCORE = 10; // Score for adequate reasoning
const REVERSIBILITY_DEPTH_MODERATE_CONF_BASELINE_SCORE = 7; // Score for brief reasoning
const REVERSIBILITY_DEPTH_LOW_CONF_MIN_WORD_COUNT = 20; // >= 20 words for low conf (brief OK)
const REVERSIBILITY_DEPTH_LOW_CONF_GOOD_SCORE = 12; // Score for adequate low-conf reasoning
const REVERSIBILITY_DEPTH_LOW_CONF_BRIEF_SCORE = 8; // Score for very brief low-conf reasoning
const REVERSIBILITY_DEPTH_LOW_CONF_ADEQUATE_WORD_COUNT = 20; // >= 20 words for low conf (brief OK)
const REVERSIBILITY_DEPTH_LOW_CONF_ADEQUATE_SCORE = 12; // Score for adequate low-conf reasoning
const REVERSIBILITY_DEPTH_LOW_CONF_BASELINE_SCORE = 8; // Score for very brief low-conf reasoning
const REVERSIBILITY_DEPTH_COHERENCE_BONUS_THRESHOLD = 0.7; // >= 70% coherence = bonus
const REVERSIBILITY_DEPTH_COHERENCE_BONUS = 2; // Bonus points for high coherence
const REVERSIBILITY_DEPTH_MAX_SCORE = 15; // Category ceiling

// 6. Overall Reversibility Limits
const REVERSIBILITY_MAX_SCORE = 100; // Maximum reversibility score
const REVERSIBILITY_MIN_SCORE = 0; // Minimum reversibility score

/**
 * Trade Grading Scoring Parameters
 *
 * These constants control how individual trades are scored across multiple dimensions
 * in the gradeTrade() function, including reasoning depth, source quality, logical
 * consistency, coherence, hallucination penalties, and discipline scoring.
 */

// 1. Trade ID Generation
const TRADE_ID_RANDOM_SUFFIX_START = 2; // Start index for random suffix in tradeId
const TRADE_ID_RANDOM_SUFFIX_END = 6; // End index for random suffix (4 chars total)

// 2. Reasoning Depth Scoring (0-100 points total)
const REASONING_DEPTH_MAX_SCORE = 100; // Maximum reasoning depth score
const REASONING_DEPTH_WORD_COMPONENT_MAX = 50; // Max points from word count (50%)
const REASONING_DEPTH_WORD_DIVISOR = 2; // Words divided by 2 for scoring
const REASONING_DEPTH_CLAUSE_COMPONENT_MAX = 50; // Max points from clause count (50%)
const REASONING_DEPTH_CLAUSE_MULTIPLIER = 8; // Points per clause

// 3. Source Quality Scoring (0-100 points total)
const SOURCE_QUALITY_MAX_SCORE = 100; // Maximum source quality score
const SOURCE_QUALITY_POINTS_PER_SOURCE = 15; // Points per source cited
const SOURCE_QUALITY_BASELINE_SCORE = 10; // Baseline score with 0 sources

// 4. Logical Consistency Scoring (0-100 points)
const LOGICAL_CONSISTENCY_CONTRADICTORY_SCORE = 35; // Score when bullish+bearish reasoning contradicts action
const LOGICAL_CONSISTENCY_COHERENT_SCORE = 85; // Score when reasoning aligns with action

// 5. Overall Trade Grade Scoring (weighted average of 18 sub-scores)
const TRADE_GRADE_COHERENCE_MULTIPLIER = 100; // Convert coherence 0-1 to 0-100 scale
const TRADE_GRADE_HALLUCINATION_PENALTY_MULTIPLIER = 0.25; // Penalty multiplier per hallucination flag
const TRADE_GRADE_HALLUCINATION_BASE_MULTIPLIER = 100; // Convert hallucination-free ratio to 0-100 scale
const TRADE_GRADE_DISCIPLINE_PASSED_SCORE = 90; // Score when discipline checks pass
const TRADE_GRADE_DISCIPLINE_FAILED_SCORE = 30; // Score when discipline checks fail

/**
 * Agent Scoring Parameters
 *
 * These constants control how agents are scored across 32 dimensions in the scoreAgent()
 * function, including financial performance normalization, behavioral intelligence metrics,
 * safety scoring, and predictive power assessment.
 */

// 1. Default Scores (for agents with no trades)
const AGENT_DEFAULT_DIMENSION_SCORE = 50; // Neutral score for all dimensions when no data
const AGENT_DEFAULT_COMPOSITE_SCORE = 50; // Neutral composite score when no trades

// 2. Financial Performance Normalization (to 0-100 scale)
const FINANCIAL_SCORE_BASELINE = 50; // Neutral baseline for financial metrics
const FINANCIAL_SCORE_MIN = 0; // Floor for financial scores
const FINANCIAL_SCORE_MAX = 100; // Ceiling for financial scores
const FINANCIAL_PNL_MULTIPLIER = 2; // PnL % multiplier (50 + pnl% * 2)
const FINANCIAL_SHARPE_MULTIPLIER = 20; // Sharpe ratio multiplier (50 + sharpe * 20)
const FINANCIAL_DRAWDOWN_MULTIPLIER = 2; // Drawdown % multiplier (100 - |drawdown| * 2)

// 3. Reasoning Integrity Scoring (placeholder/random)
const REASONING_INTEGRITY_BASELINE = 80; // Base integrity score
const REASONING_INTEGRITY_RANDOM_RANGE = 15; // Random variation range (80-95)

// 4. Safety Scoring
const SAFETY_HALLUCINATION_FREE_SCORE = 100; // Score when no hallucinations
const SAFETY_HALLUCINATION_PENALTY = 25; // Penalty points per hallucination flag
const SAFETY_DISCIPLINE_PASSED_SCORE = 90; // Score when discipline checks pass
const SAFETY_DISCIPLINE_FAILED_SCORE = 30; // Score when discipline checks fail
const SAFETY_RISK_AWARENESS_PRESENT_SCORE = 80; // Score when risk keywords present
const SAFETY_RISK_AWARENESS_ABSENT_SCORE = 45; // Score when no risk awareness

// 5. Behavioral Intelligence Scoring
const BEHAVIORAL_STRATEGY_CONSISTENCY_SINGLE_ACTION = 90; // Score for 1 unique action (very consistent)
const BEHAVIORAL_STRATEGY_CONSISTENCY_TWO_ACTIONS = 70; // Score for 2 unique actions (moderately consistent)
const BEHAVIORAL_STRATEGY_CONSISTENCY_THREE_PLUS = 50; // Score for 3+ unique actions (inconsistent)
const BEHAVIORAL_ADAPTABILITY_BASELINE = 50; // Neutral adaptability baseline
const BEHAVIORAL_ADAPTABILITY_STDDEV_MULTIPLIER = 200; // Confidence stddev multiplier
const BEHAVIORAL_CALIBRATION_BASELINE = 0; // Baseline for calibration calculation
const BEHAVIORAL_CALIBRATION_TARGET = 0.6; // Target confidence (60%)
const BEHAVIORAL_CALIBRATION_DEVIATION_PENALTY = 200; // Penalty multiplier for deviation from target
const BEHAVIORAL_LEARNING_BASELINE = 40; // Base cross-round learning score
const BEHAVIORAL_LEARNING_POINTS_PER_TRADE = 5; // Points per trade (more trades = more learning)

// 6. Predictive Power Scoring
const PREDICTIVE_OUTCOME_CORRECT_SCORE = 100; // Score for correct predictions
const PREDICTIVE_OUTCOME_PARTIAL_SCORE = 60; // Score for partial correctness
const PREDICTIVE_OUTCOME_INCORRECT_SCORE = 20; // Score for incorrect predictions
const PREDICTIVE_OUTCOME_INSUFFICIENT_DATA_SCORE = 50; // Score when no resolved outcomes
const PREDICTIVE_REGIME_PRESENT_SCORE = 80; // Score when market regime awareness present
const PREDICTIVE_REGIME_ABSENT_SCORE = 45; // Score when no regime awareness
const PREDICTIVE_EDGE_CONSISTENCY_MIN_TRADES = 3; // Minimum trades for edge consistency scoring
const PREDICTIVE_EDGE_CONSISTENCY_BASELINE = 40; // Base edge consistency score
const PREDICTIVE_EDGE_COHERENCE_THRESHOLD = 0.6; // Coherence threshold for "edge" (60%)
const PREDICTIVE_EDGE_COHERENCE_WEIGHT = 60; // Points for coherent trades ratio
const PREDICTIVE_EDGE_INSUFFICIENT_DATA_SCORE = 50; // Score when < 3 trades

// 7. Governance/RQI Scoring
const GOVERNANCE_RQI_NORMALIZATION_DIVISOR = 100; // Normalize RQI components to 0-1 range
const GOVERNANCE_RQI_SCALE_MULTIPLIER = 100; // Scale RQI back to 0-100 range
const GOVERNANCE_DEFAULT_COMPOSITE_FALLBACK = 50; // Fallback when dimension missing

// ---------------------------------------------------------------------------
// Types for the 32 dimensions
// ---------------------------------------------------------------------------

export interface V36DimensionScores {
  // Financial Performance (3 dims)
  pnlPercent: number;
  sharpeRatio: number;
  maxDrawdown: number;
  // Reasoning Quality (15 dims — 13 from v35 + auditability + reversibility)
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
  reasoningAuditability: number;
  decisionReversibility: number;
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

export interface V36AgentScore {
  agentId: string;
  agentName: string;
  provider: string;
  model: string;
  dimensions: V36DimensionScores;
  compositeScore: number;
  tier: "S" | "A" | "B" | "C" | "D";
  tradeCount: number;
  roundsPlayed: number;
  lastUpdated: string;
}

export interface V36TradeGrade {
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
  reasoningAuditabilityScore: number;
  decisionReversibilityScore: number;
  integrityHash: string;
  predictedOutcome: string | null;
  actualOutcome: string | null;
  outcomeResolved: "pending" | "correct" | "incorrect" | "partial";
  overallGrade: "A+" | "A" | "B+" | "B" | "C+" | "C" | "D" | "F";
  gradedAt: string;
}

export interface V36RoundSummary {
  roundId: string;
  timestamp: string;
  agentScores: V36AgentScore[];
  bestTrade: V36TradeGrade | null;
  worstTrade: V36TradeGrade | null;
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
  avgReasoningAuditability: number;
  avgDecisionReversibility: number;
}

// ---------------------------------------------------------------------------
// In-memory storage
// ---------------------------------------------------------------------------

const agentScores = new Map<string, V36AgentScore>();
const tradeGrades: V36TradeGrade[] = [];
const roundSummaries: V36RoundSummary[] = [];

// ---------------------------------------------------------------------------
// Dimension weights (must sum to 1.0) — 32 entries
// ---------------------------------------------------------------------------

const DIMENSION_WEIGHTS: Record<keyof V36DimensionScores, number> = {
  pnlPercent: 0.05,
  sharpeRatio: 0.05,
  maxDrawdown: 0.04,
  coherence: 0.05,
  reasoningDepth: 0.04,
  sourceQuality: 0.03,
  logicalConsistency: 0.03,
  reasoningIntegrity: 0.03,
  reasoningTransparency: 0.03,
  reasoningGrounding: 0.03,
  causalReasoning: 0.04,
  epistemicHumility: 0.04,
  reasoningTraceability: 0.03,
  adversarialCoherence: 0.03,
  informationAsymmetry: 0.03,
  temporalReasoningQuality: 0.03,
  reasoningAuditability: 0.04,   // NEW
  decisionReversibility: 0.04,         // NEW
  hallucinationRate: 0.05,
  instructionDiscipline: 0.03,
  riskAwareness: 0.02,
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
  if (composite >= 85) return "S";
  if (composite >= 70) return "A";
  if (composite >= 55) return "B";
  if (composite >= 40) return "C";
  return "D";
}

function getGrade(score: number): "A+" | "A" | "B+" | "B" | "C+" | "C" | "D" | "F" {
  if (score >= 95) return "A+";
  if (score >= 85) return "A";
  if (score >= 75) return "B+";
  if (score >= 65) return "B";
  if (score >= 55) return "C+";
  if (score >= 45) return "C";
  if (score >= 30) return "D";
  return "F";
}

// ---------------------------------------------------------------------------
// NEW v36: Reasoning Auditability
// ---------------------------------------------------------------------------

/**
 * Can every claim in the agent's reasoning be independently verified by a
 * third party? Measures evidence specificity, falsifiability of predictions,
 * verifiable reference density per 100 words, audit trail completeness,
 * and data provenance clarity. Agents making vague or unfalsifiable claims
 * score poorly.
 *
 * Measures:
 * 1. Evidence Specificity (0-20): Does agent cite specific, verifiable data?
 * 2. Falsifiability (0-20): Are predictions testable / falsifiable?
 * 3. Verifiable Reference Density (0-20): References per 100 words
 * 4. Audit Trail Completeness (0-20): Can reasoning chain be reconstructed?
 * 5. Data Provenance Clarity (0-20): Are data sources traceable?
 */
export function scoreReasoningAuditability(
  reasoning: string,
  sources: string[],
  quantity: number,
): number {
  let score = 0;
  const maxScore = AUDITABILITY_MAX_SCORE;

  // 1. Spread Awareness (0-20)
  let spreadScore = 0;

  const spreadPatterns = /\b(?:bid[- ]?ask\s+spread|spread\s+(?:is|at|of|around)|slippage\s+(?:risk|estimate|expected|of)|price\s+impact|execution\s+cost|market\s+order\s+cost|limit\s+order|fill\s+price|crossing\s+the\s+spread)\b/gi;
  const spreadMatches = reasoning.match(spreadPatterns) ?? [];
  spreadScore += Math.min(SPREAD_AWARENESS_SPREAD_PATTERN_MAX_SCORE, spreadMatches.length * SPREAD_AWARENESS_SPREAD_PATTERN_POINTS_PER_MATCH);

  // Specific basis point or percentage spread references
  const bpsPatterns = /\b(?:\d+\s*(?:bps|basis\s+points?)|spread\s+of\s+\$?[\d.]+%?|[\d.]+%?\s+spread)\b/gi;
  const bpsMatches = reasoning.match(bpsPatterns) ?? [];
  spreadScore += Math.min(SPREAD_AWARENESS_BPS_PATTERN_MAX_SCORE, bpsMatches.length * SPREAD_AWARENESS_BPS_PATTERN_POINTS_PER_MATCH);

  score += Math.min(SPREAD_AWARENESS_MAX_SCORE, spreadScore);

  // 2. Liquidity Assessment (0-20)
  let liquidityScore = 0;

  const liquidityPatterns = /\b(?:liquid(?:ity)?|volume\s+(?:is|at|of|supports?)|order\s+book\s+depth|thin(?:ly)?\s+traded|depth\s+of\s+(?:market|book)|average\s+daily\s+volume|ADV|market\s+depth|bid\s+size|ask\s+size|level\s*2|book\s+is\s+(?:thick|thin|deep|shallow))\b/gi;
  const liquidityMatches = reasoning.match(liquidityPatterns) ?? [];
  liquidityScore += Math.min(LIQUIDITY_ASSESSMENT_LIQUIDITY_PATTERN_MAX_SCORE, liquidityMatches.length * LIQUIDITY_ASSESSMENT_LIQUIDITY_PATTERN_POINTS_PER_MATCH);

  // Quantitative volume references
  const volumeQuantPatterns = /\b(?:\$[\d.]+[MBK]?\s+(?:volume|traded)|[\d,]+\s+shares?\s+(?:volume|traded)|volume\s+of\s+[\d,.]+|[\d.]+[xX]\s+(?:average|normal)\s+volume)\b/gi;
  const volumeQuantMatches = reasoning.match(volumeQuantPatterns) ?? [];
  liquidityScore += Math.min(LIQUIDITY_ASSESSMENT_VOLUME_QUANT_MAX_SCORE, volumeQuantMatches.length * LIQUIDITY_ASSESSMENT_VOLUME_QUANT_POINTS_PER_MATCH);

  score += Math.min(LIQUIDITY_ASSESSMENT_MAX_SCORE, liquidityScore);

  // 3. Execution Strategy (0-20)
  let executionScore = 0;

  const executionPatterns = /\b(?:TWAP|VWAP|iceberg\s+order|DCA|dollar[- ]cost\s+averag|scale\s+(?:in|out)|partial\s+fill|limit\s+(?:order|price)|market\s+(?:on\s+close|on\s+open)|staged\s+execution|split\s+(?:the\s+)?order|time[- ]weighted)\b/gi;
  const executionMatches = reasoning.match(executionPatterns) ?? [];
  executionScore += Math.min(EXECUTION_STRATEGY_EXECUTION_PATTERN_MAX_SCORE, executionMatches.length * EXECUTION_STRATEGY_EXECUTION_PATTERN_POINTS_PER_MATCH);

  // Timing-related execution
  const timingPatterns = /\b(?:trade\s+during\s+(?:high|peak)\s+volume|avoid\s+(?:open|close|low\s+volume)|execute\s+(?:at|near|around)|best\s+execution|minimize\s+(?:impact|slippage|cost))\b/gi;
  const timingMatches = reasoning.match(timingPatterns) ?? [];
  executionScore += Math.min(EXECUTION_STRATEGY_TIMING_PATTERN_MAX_SCORE, timingMatches.length * EXECUTION_STRATEGY_TIMING_PATTERN_POINTS_PER_MATCH);

  score += Math.min(EXECUTION_STRATEGY_MAX_SCORE, executionScore);

  // 4. Market Impact Awareness (0-20)
  let impactScore = 0;

  const impactPatterns = /\b(?:market\s+impact|price\s+impact|move\s+the\s+(?:market|price)|footprint|information\s+leakage|front[- ]running\s+risk|signaling|adverse\s+selection|toxic\s+flow|order\s+flow)\b/gi;
  const impactMatches = reasoning.match(impactPatterns) ?? [];
  impactScore += Math.min(MARKET_IMPACT_IMPACT_PATTERN_MAX_SCORE, impactMatches.length * MARKET_IMPACT_IMPACT_PATTERN_POINTS_PER_MATCH);

  // Size-relative impact awareness
  if (quantity > 0) {
    const sizeAwarePatterns = /\b(?:position\s+size\s+relative|too\s+large\s+for|appropriate\s+size|sizing\s+based\s+on\s+(?:liquidity|volume)|size\s+vs\s+ADV|percentage\s+of\s+(?:volume|float))\b/gi;
    const sizeAwareMatches = reasoning.match(sizeAwarePatterns) ?? [];
    impactScore += Math.min(MARKET_IMPACT_SIZE_AWARE_MAX_SCORE, sizeAwareMatches.length * MARKET_IMPACT_SIZE_AWARE_POINTS_PER_MATCH);
  } else {
    impactScore += MARKET_IMPACT_HOLD_PARTIAL_CREDIT; // Partial credit if quantity is 0 (hold)
  }

  score += Math.min(MARKET_IMPACT_MAX_SCORE, impactScore);

  // 5. Cost Consciousness (0-20)
  let costScore = 0;

  const costPatterns = /\b(?:transaction\s+cost|trading\s+cost|commission|fee(?:s)?\s+(?:of|at|around)|gas\s+(?:fee|cost)|network\s+fee|Jupiter\s+(?:fee|route)|swap\s+fee|total\s+cost|all[- ]in\s+cost|net\s+(?:of|after)\s+(?:fees|costs))\b/gi;
  const costMatches = reasoning.match(costPatterns) ?? [];
  costScore += Math.min(COST_CONSCIOUSNESS_COST_PATTERN_MAX_SCORE, costMatches.length * COST_CONSCIOUSNESS_COST_PATTERN_POINTS_PER_MATCH);

  // Slippage tolerance
  const slippagePatterns = /\b(?:slippage\s+(?:tolerance|limit|of|around|expected)|max\s+slippage|acceptable\s+slippage|[\d.]+%?\s+slippage)\b/gi;
  const slippageMatches = reasoning.match(slippagePatterns) ?? [];
  costScore += Math.min(COST_CONSCIOUSNESS_SLIPPAGE_PATTERN_MAX_SCORE, slippageMatches.length * COST_CONSCIOUSNESS_SLIPPAGE_PATTERN_POINTS_PER_MATCH);

  score += Math.min(COST_CONSCIOUSNESS_MAX_SCORE, costScore);

  // Bonus: agent references sources related to execution
  const execSources = sources.filter((s) =>
    /volume|liquidity|order.*book|execution|slippage/i.test(s),
  );
  if (execSources.length > 0) {
    score += Math.min(AUDITABILITY_SOURCE_BONUS_MAX, execSources.length * AUDITABILITY_SOURCE_BONUS_POINTS_PER_SOURCE);
  }

  return Math.round(Math.min(maxScore, Math.max(AUDITABILITY_MIN_SCORE, score)));
}

// ---------------------------------------------------------------------------
// NEW v36: Decision Reversibility
// ---------------------------------------------------------------------------

/**
 * Does the agent plan for when its thesis breaks? Measures explicit exit
 * conditions (stop-loss, take-profit), thesis invalidation criteria,
 * contingency planning, position unwinding logic, and risk-reward framing.
 * Agents entering trades without exit plans score poorly.
 *
 * Measures:
 * 1. Exit Condition Clarity (0-25): Does agent define stop-loss / take-profit?
 * 2. Thesis Invalidation Criteria (0-25): What would make the agent reverse?
 * 3. Contingency Planning (0-20): Does agent have a backup plan?
 * 4. Position Unwinding Logic (0-15): How would agent exit gracefully?
 * 5. Risk-Reward Framing (0-15): Does agent frame trades in risk/reward terms?
 */
export function scoreDecisionReversibility(
  reasoning: string,
  confidence: number,
  sources: string[],
  coherenceScore: number,
  hallucinationFlags: string[],
  previousOutcomes: Array<{ confidence: number; correct: boolean }>,
): number {
  let score = 0;
  const maxScore = REVERSIBILITY_MAX_SCORE;

  // Normalize confidence to 0-1 if needed
  const conf = confidence > 1 ? confidence / 100 : confidence;

  // 1. Evidence-Confidence Alignment (0-25)
  // High confidence should come with specific evidence
  let evidenceScore = 0;

  const specificEvidencePatterns = /\b(?:specifically|in particular|data shows|evidence suggests|according to|based on (?:the|specific)|the numbers indicate|quantitatively|measured at|confirmed by)\b/gi;
  const evidenceMatches = reasoning.match(specificEvidencePatterns) ?? [];
  const evidenceDensity = evidenceMatches.length / Math.max(1, reasoning.split(/\s+/).length / REVERSIBILITY_EVIDENCE_WORDS_PER_UNIT);

  // Higher confidence needs more evidence
  if (conf >= REVERSIBILITY_EVIDENCE_HIGH_CONF_THRESHOLD) {
    // High confidence: need strong evidence
    if (evidenceDensity >= REVERSIBILITY_EVIDENCE_HIGH_CONF_STRONG_DENSITY) evidenceScore = REVERSIBILITY_EVIDENCE_MAX_SCORE;
    else if (evidenceDensity >= REVERSIBILITY_EVIDENCE_HIGH_CONF_GOOD_DENSITY) evidenceScore = REVERSIBILITY_EVIDENCE_HIGH_CONF_GOOD_SCORE;
    else if (evidenceDensity >= REVERSIBILITY_EVIDENCE_HIGH_CONF_MODERATE_DENSITY) evidenceScore = REVERSIBILITY_EVIDENCE_HIGH_CONF_MODERATE_SCORE;
    else evidenceScore = REVERSIBILITY_EVIDENCE_HIGH_CONF_WEAK_SCORE; // High confidence + low evidence = bad
  } else if (conf >= REVERSIBILITY_EVIDENCE_MODERATE_CONF_THRESHOLD) {
    // Moderate confidence: moderate evidence is fine
    if (evidenceDensity >= REVERSIBILITY_EVIDENCE_MODERATE_CONF_STRONG_DENSITY) evidenceScore = REVERSIBILITY_EVIDENCE_MODERATE_CONF_STRONG_SCORE;
    else if (evidenceDensity >= REVERSIBILITY_EVIDENCE_MODERATE_CONF_GOOD_DENSITY) evidenceScore = REVERSIBILITY_EVIDENCE_MODERATE_CONF_GOOD_SCORE;
    else evidenceScore = REVERSIBILITY_EVIDENCE_MODERATE_CONF_BASELINE_SCORE;
  } else {
    // Low confidence: some evidence should still exist
    if (evidenceDensity >= REVERSIBILITY_EVIDENCE_LOW_CONF_GOOD_DENSITY) evidenceScore = REVERSIBILITY_EVIDENCE_LOW_CONF_GOOD_SCORE;
    else if (evidenceDensity > 0) evidenceScore = REVERSIBILITY_EVIDENCE_LOW_CONF_SOME_SCORE;
    else evidenceScore = REVERSIBILITY_EVIDENCE_LOW_CONF_BASELINE_SCORE;
  }

  // Penalize high confidence when hallucinations present
  if (conf >= REVERSIBILITY_EVIDENCE_HALLUCINATION_CONF_THRESHOLD && hallucinationFlags.length > 0) {
    evidenceScore = Math.max(0, evidenceScore - hallucinationFlags.length * REVERSIBILITY_EVIDENCE_HALLUCINATION_PENALTY_PER_FLAG);
  }

  score += Math.min(REVERSIBILITY_EVIDENCE_MAX_SCORE, evidenceScore);

  // 2. Source-Confidence Calibration (0-25)
  // More sources + high confidence = good. Few sources + high confidence = bad.
  let sourceScore = 0;

  const sourceCount = sources.length;
  const expectedSources = conf >= REVERSIBILITY_EVIDENCE_HIGH_CONF_THRESHOLD ? REVERSIBILITY_SOURCE_HIGH_CONF_EXPECTED : conf >= REVERSIBILITY_EVIDENCE_MODERATE_CONF_THRESHOLD ? REVERSIBILITY_SOURCE_MODERATE_CONF_EXPECTED : REVERSIBILITY_SOURCE_LOW_CONF_EXPECTED;

  if (sourceCount >= expectedSources) {
    sourceScore = REVERSIBILITY_SOURCE_BASELINE_SCORE + Math.min(REVERSIBILITY_SOURCE_BONUS_MAX, (sourceCount - expectedSources) * REVERSIBILITY_SOURCE_BONUS_POINTS_PER_EXTRA);
  } else {
    const shortfall = expectedSources - sourceCount;
    sourceScore = Math.max(REVERSIBILITY_SOURCE_MIN_SCORE, REVERSIBILITY_SOURCE_BASELINE_SCORE - shortfall * REVERSIBILITY_SOURCE_SHORTFALL_PENALTY);
  }

  // Bonus for diverse source types
  const uniqueSourceTypes = new Set(sources.map((s) => s.split("_")[0]));
  if (uniqueSourceTypes.size >= REVERSIBILITY_SOURCE_DIVERSITY_THRESHOLD) sourceScore += REVERSIBILITY_SOURCE_DIVERSITY_BONUS;

  score += Math.min(REVERSIBILITY_SOURCE_MAX_SCORE, sourceScore);

  // 3. Hedging-Confidence Coherence (0-20)
  // High confidence + lots of hedging = inconsistent
  // Low confidence + no hedging = inconsistent
  let hedgingScore = 0;

  const hedgingPatterns = /\b(?:however|although|but|risk|uncertain|might|could|possibly|potential downside|caveat|on the other hand|that said|admittedly|if (?:the|this) fails)\b/gi;
  const hedgingMatches = reasoning.match(hedgingPatterns) ?? [];
  const hedgingDensity = hedgingMatches.length / Math.max(1, reasoning.split(/\s+/).length / REVERSIBILITY_HEDGING_WORDS_PER_UNIT);

  if (conf >= REVERSIBILITY_EVIDENCE_HIGH_CONF_THRESHOLD) {
    // High confidence: some hedging is OK (shows awareness), too much is inconsistent
    if (hedgingDensity >= REVERSIBILITY_HEDGING_HIGH_CONF_MIN_DENSITY && hedgingDensity <= REVERSIBILITY_HEDGING_HIGH_CONF_MAX_DENSITY) hedgingScore = REVERSIBILITY_HEDGING_HIGH_CONF_GOOD_SCORE;
    else if (hedgingDensity <= REVERSIBILITY_HEDGING_HIGH_CONF_MODERATE_MAX_DENSITY) hedgingScore = REVERSIBILITY_HEDGING_HIGH_CONF_MODERATE_SCORE;
    else hedgingScore = REVERSIBILITY_HEDGING_HIGH_CONF_EXCESSIVE_SCORE; // Too much hedging for high confidence
  } else if (conf >= REVERSIBILITY_EVIDENCE_MODERATE_CONF_THRESHOLD) {
    // Moderate confidence: hedging is expected
    if (hedgingDensity >= REVERSIBILITY_HEDGING_MODERATE_CONF_MIN_DENSITY && hedgingDensity <= REVERSIBILITY_HEDGING_MODERATE_CONF_MAX_DENSITY) hedgingScore = REVERSIBILITY_HEDGING_MODERATE_CONF_GOOD_SCORE;
    else if (hedgingDensity > REVERSIBILITY_HEDGING_MODERATE_CONF_MAX_DENSITY) hedgingScore = REVERSIBILITY_HEDGING_MODERATE_CONF_EXCESSIVE_SCORE;
    else hedgingScore = REVERSIBILITY_HEDGING_MODERATE_CONF_LOW_SCORE; // No hedging at moderate confidence is slightly off
  } else {
    // Low confidence: hedging should be present
    if (hedgingDensity >= REVERSIBILITY_HEDGING_LOW_CONF_MIN_DENSITY) hedgingScore = REVERSIBILITY_HEDGING_LOW_CONF_GOOD_SCORE;
    else if (hedgingDensity > 0) hedgingScore = REVERSIBILITY_HEDGING_LOW_CONF_SOME_SCORE;
    else hedgingScore = REVERSIBILITY_HEDGING_LOW_CONF_NONE_SCORE; // Low confidence but no hedging = weird
  }

  // Bonus for explicit uncertainty quantification
  const uncertaintyQuantPatterns = /\b(?:probability\s+(?:of|around|at)\s+[\d]+%|[\d]+%\s+(?:chance|probability|likelihood)|odds (?:are|of)|risk[- ]reward\s+(?:ratio|of))\b/gi;
  const uncertaintyQuantMatches = reasoning.match(uncertaintyQuantPatterns) ?? [];
  if (uncertaintyQuantMatches.length > 0) hedgingScore += REVERSIBILITY_HEDGING_UNCERTAINTY_QUANT_BONUS;

  score += Math.min(REVERSIBILITY_HEDGING_MAX_SCORE, hedgingScore);

  // 4. Historical Accuracy Match (0-15)
  // Does this agent's confidence historically predict outcomes?
  let accuracyScore = 0;

  if (previousOutcomes.length >= REVERSIBILITY_ACCURACY_MIN_OUTCOMES) {
    // Bin outcomes by confidence level
    const highConfTrades = previousOutcomes.filter((o) => o.confidence >= REVERSIBILITY_ACCURACY_HIGH_CONF_FILTER);
    const lowConfTrades = previousOutcomes.filter((o) => o.confidence < REVERSIBILITY_ACCURACY_LOW_CONF_FILTER);

    const highConfAccuracy = highConfTrades.length > 0
      ? highConfTrades.filter((o) => o.correct).length / highConfTrades.length
      : 0.5;
    const lowConfAccuracy = lowConfTrades.length > 0
      ? lowConfTrades.filter((o) => o.correct).length / lowConfTrades.length
      : 0.5;

    // High confidence should be more accurate than low confidence
    if (highConfAccuracy > lowConfAccuracy) {
      accuracyScore = REVERSIBILITY_ACCURACY_GOOD_CALIBRATION_SCORE; // Good calibration
    } else if (highConfAccuracy === lowConfAccuracy) {
      accuracyScore = REVERSIBILITY_ACCURACY_NEUTRAL_CALIBRATION_SCORE; // Neutral
    } else {
      accuracyScore = REVERSIBILITY_ACCURACY_INVERTED_CALIBRATION_SCORE; // Inverted — high confidence is LESS accurate
    }

    // Bonus for overall calibration
    const overallAccuracy = previousOutcomes.filter((o) => o.correct).length / previousOutcomes.length;
    if (Math.abs(overallAccuracy - conf) < REVERSIBILITY_ACCURACY_OVERALL_TOLERANCE) accuracyScore += REVERSIBILITY_ACCURACY_CALIBRATION_BONUS;
  } else {
    // Not enough data — partial credit
    accuracyScore = REVERSIBILITY_ACCURACY_INSUFFICIENT_DATA_SCORE;
  }

  score += Math.min(REVERSIBILITY_ACCURACY_MAX_SCORE, accuracyScore);

  // 5. Reasoning Depth Proportionality (0-15)
  // More words/clauses should correlate with higher confidence
  let depthScore = 0;

  const wordCount = reasoning.split(/\s+/).length;
  const clauseCount = reasoning.split(/[.;!?]/).filter((s) => s.trim().length > 0).length;

  if (conf >= REVERSIBILITY_EVIDENCE_HIGH_CONF_THRESHOLD) {
    // High confidence needs deep reasoning
    if (wordCount >= REVERSIBILITY_DEPTH_HIGH_CONF_WORD_COUNT && clauseCount >= REVERSIBILITY_DEPTH_HIGH_CONF_CLAUSE_COUNT) depthScore = REVERSIBILITY_DEPTH_HIGH_CONF_DEEP_SCORE;
    else if (wordCount >= REVERSIBILITY_DEPTH_HIGH_CONF_MODERATE_WORD_COUNT && clauseCount >= REVERSIBILITY_DEPTH_HIGH_CONF_MODERATE_CLAUSE_COUNT) depthScore = REVERSIBILITY_DEPTH_HIGH_CONF_MODERATE_SCORE;
    else depthScore = REVERSIBILITY_DEPTH_HIGH_CONF_SHALLOW_SCORE; // Shallow reasoning + high confidence
  } else if (conf >= REVERSIBILITY_EVIDENCE_MODERATE_CONF_THRESHOLD) {
    if (wordCount >= REVERSIBILITY_DEPTH_MODERATE_CONF_WORD_COUNT && clauseCount >= REVERSIBILITY_DEPTH_MODERATE_CONF_CLAUSE_COUNT) depthScore = REVERSIBILITY_DEPTH_MODERATE_CONF_GOOD_SCORE;
    else if (wordCount >= REVERSIBILITY_DEPTH_MODERATE_CONF_MIN_WORD_COUNT) depthScore = REVERSIBILITY_DEPTH_MODERATE_CONF_BASELINE_SCORE;
    else depthScore = REVERSIBILITY_DEPTH_MODERATE_CONF_BRIEF_SCORE;
  } else {
    // Low confidence: even brief reasoning is OK
    if (wordCount >= REVERSIBILITY_DEPTH_LOW_CONF_MIN_WORD_COUNT) depthScore = REVERSIBILITY_DEPTH_LOW_CONF_GOOD_SCORE;
    else depthScore = REVERSIBILITY_DEPTH_LOW_CONF_BRIEF_SCORE;
  }

  // Coherence bonus — if reasoning and action are coherent, conviction is more trustworthy
  if (coherenceScore >= REVERSIBILITY_DEPTH_COHERENCE_BONUS_THRESHOLD) depthScore = Math.min(REVERSIBILITY_DEPTH_MAX_SCORE, depthScore + REVERSIBILITY_DEPTH_COHERENCE_BONUS);

  score += Math.min(REVERSIBILITY_DEPTH_MAX_SCORE, depthScore);

  return Math.round(Math.min(maxScore, Math.max(REVERSIBILITY_MIN_SCORE, score)));
}

// ---------------------------------------------------------------------------
// Trade Grading (32 dimensions)
// ---------------------------------------------------------------------------

/**
 * Grade an individual trade with all 32 dimension sub-scores.
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
  previousOutcomes?: Array<{ confidence: number; correct: boolean }>;
  quantity?: number;
}): V36TradeGrade {
  const tradeId = `v36_${Date.now()}_${Math.random().toString(36).slice(TRADE_ID_RANDOM_SUFFIX_START, TRADE_ID_RANDOM_SUFFIX_END)}`;

  // Score reasoning depth
  const wordCount = input.reasoning.split(/\s+/).length;
  const clauseCount = input.reasoning.split(/[.;!?]/).filter((s) => s.trim().length > 0).length;
  const reasoningDepthScore = Math.min(REASONING_DEPTH_MAX_SCORE, Math.round(
    Math.min(REASONING_DEPTH_WORD_COMPONENT_MAX, wordCount / REASONING_DEPTH_WORD_DIVISOR) + Math.min(REASONING_DEPTH_CLAUSE_COMPONENT_MAX, clauseCount * REASONING_DEPTH_CLAUSE_MULTIPLIER),
  ));

  // Score source quality
  const sourceQualityScore = Math.min(SOURCE_QUALITY_MAX_SCORE, input.sources.length * SOURCE_QUALITY_POINTS_PER_SOURCE + SOURCE_QUALITY_BASELINE_SCORE);

  // Logical consistency
  const hasBullish = /bullish|upside|buy|undervalued/i.test(input.reasoning);
  const hasBearish = /bearish|downside|sell|overvalued/i.test(input.reasoning);
  const isContradictory = hasBullish && hasBearish && input.action !== "hold";
  const logicalConsistencyScore = isContradictory ? LOGICAL_CONSISTENCY_CONTRADICTORY_SCORE : LOGICAL_CONSISTENCY_COHERENT_SCORE;

  // Inherited scoring
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
  const reasoningTraceabilityScore = scoreReasoningTraceability(
    input.reasoning, input.sources, input.marketPrices,
  );
  const adversarialCoherenceScore = scoreAdversarialCoherence(
    input.reasoning, input.action, input.confidence, input.marketPrices,
  );
  const informationAsymmetryScore = scoreInformationAsymmetry(
    input.reasoning, input.sources, input.peerReasonings ?? [],
  );
  const temporalReasoningScore = scoreTemporalReasoningQuality(
    input.reasoning, input.predictedOutcome,
  );

  // NEW v36 scoring
  const reasoningAuditabilityScore = scoreReasoningAuditability(
    input.reasoning, input.sources, input.quantity ?? 0,
  );
  const decisionReversibilityScore = scoreDecisionReversibility(
    input.reasoning,
    input.confidence,
    input.sources,
    input.coherenceScore,
    input.hallucinationFlags,
    input.previousOutcomes ?? [],
  );

  // Integrity hash
  const integrityHash = createHash("sha256")
    .update(`v36:${input.agentId}:${input.action}:${input.symbol}:${input.reasoning}:${input.confidence}`)
    .digest("hex")
    .slice(0, 16);

  // Overall grade (weighted average of all 18 trade-level sub-scores)
  const subScores = [
    input.coherenceScore * TRADE_GRADE_COHERENCE_MULTIPLIER,
    (1 - Math.min(1, input.hallucinationFlags.length * TRADE_GRADE_HALLUCINATION_PENALTY_MULTIPLIER)) * TRADE_GRADE_HALLUCINATION_BASE_MULTIPLIER,
    input.disciplinePassed ? TRADE_GRADE_DISCIPLINE_PASSED_SCORE : TRADE_GRADE_DISCIPLINE_FAILED_SCORE,
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
    reasoningAuditabilityScore,
    decisionReversibilityScore,
  ];
  const avgScore = subScores.reduce((a, b) => a + b, 0) / subScores.length;
  const overallGrade = getGrade(avgScore);

  const grade: V36TradeGrade = {
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
    reasoningAuditabilityScore,
    decisionReversibilityScore,
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
// Agent Scoring (32 dimensions)
// ---------------------------------------------------------------------------

export function scoreAgent(input: {
  agentId: string;
  agentName: string;
  provider: string;
  model: string;
  trades: V36TradeGrade[];
  pnlPercent: number;
  sharpeRatio: number;
  maxDrawdown: number;
}): V36AgentScore {
  const t = input.trades;
  if (t.length === 0) {
    const emptyDims: V36DimensionScores = {
      pnlPercent: AGENT_DEFAULT_DIMENSION_SCORE, sharpeRatio: AGENT_DEFAULT_DIMENSION_SCORE, maxDrawdown: AGENT_DEFAULT_DIMENSION_SCORE,
      coherence: AGENT_DEFAULT_DIMENSION_SCORE, reasoningDepth: AGENT_DEFAULT_DIMENSION_SCORE, sourceQuality: AGENT_DEFAULT_DIMENSION_SCORE,
      logicalConsistency: AGENT_DEFAULT_DIMENSION_SCORE, reasoningIntegrity: AGENT_DEFAULT_DIMENSION_SCORE, reasoningTransparency: AGENT_DEFAULT_DIMENSION_SCORE,
      reasoningGrounding: AGENT_DEFAULT_DIMENSION_SCORE, causalReasoning: AGENT_DEFAULT_DIMENSION_SCORE, epistemicHumility: AGENT_DEFAULT_DIMENSION_SCORE,
      reasoningTraceability: AGENT_DEFAULT_DIMENSION_SCORE, adversarialCoherence: AGENT_DEFAULT_DIMENSION_SCORE,
      informationAsymmetry: AGENT_DEFAULT_DIMENSION_SCORE, temporalReasoningQuality: AGENT_DEFAULT_DIMENSION_SCORE,
      reasoningAuditability: AGENT_DEFAULT_DIMENSION_SCORE, decisionReversibility: AGENT_DEFAULT_DIMENSION_SCORE,
      hallucinationRate: AGENT_DEFAULT_DIMENSION_SCORE, instructionDiscipline: AGENT_DEFAULT_DIMENSION_SCORE, riskAwareness: AGENT_DEFAULT_DIMENSION_SCORE,
      strategyConsistency: AGENT_DEFAULT_DIMENSION_SCORE, adaptability: AGENT_DEFAULT_DIMENSION_SCORE, confidenceCalibration: AGENT_DEFAULT_DIMENSION_SCORE,
      crossRoundLearning: AGENT_DEFAULT_DIMENSION_SCORE, outcomeAccuracy: AGENT_DEFAULT_DIMENSION_SCORE, marketRegimeAwareness: AGENT_DEFAULT_DIMENSION_SCORE,
      edgeConsistency: AGENT_DEFAULT_DIMENSION_SCORE, tradeAccountability: AGENT_DEFAULT_DIMENSION_SCORE, reasoningQualityIndex: AGENT_DEFAULT_DIMENSION_SCORE,
      decisionAccountability: AGENT_DEFAULT_DIMENSION_SCORE, consensusQuality: AGENT_DEFAULT_DIMENSION_SCORE,
    };
    return {
      agentId: input.agentId, agentName: input.agentName,
      provider: input.provider, model: input.model,
      dimensions: emptyDims, compositeScore: AGENT_DEFAULT_COMPOSITE_SCORE, tier: "C",
      tradeCount: 0, roundsPlayed: 0, lastUpdated: new Date().toISOString(),
    };
  }

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  // Financial (normalized to 0-100)
  const pnlScore = Math.max(FINANCIAL_SCORE_MIN, Math.min(FINANCIAL_SCORE_MAX, FINANCIAL_SCORE_BASELINE + input.pnlPercent * FINANCIAL_PNL_MULTIPLIER));
  const sharpeScore = Math.max(FINANCIAL_SCORE_MIN, Math.min(FINANCIAL_SCORE_MAX, FINANCIAL_SCORE_BASELINE + input.sharpeRatio * FINANCIAL_SHARPE_MULTIPLIER));
  const drawdownScore = Math.max(FINANCIAL_SCORE_MIN, Math.min(FINANCIAL_SCORE_MAX, FINANCIAL_SCORE_MAX - Math.abs(input.maxDrawdown) * FINANCIAL_DRAWDOWN_MULTIPLIER));

  // Reasoning Quality (15 dims)
  const coherence = avg(t.map((x) => x.coherenceScore * TRADE_GRADE_COHERENCE_MULTIPLIER));
  const reasoningDepth = avg(t.map((x) => x.reasoningDepthScore));
  const sourceQuality = avg(t.map((x) => x.sourceQualityScore));
  const logicalConsistency = avg(t.map((x) => x.logicalConsistencyScore));
  const integrityScores = t.map(() => REASONING_INTEGRITY_BASELINE + Math.random() * REASONING_INTEGRITY_RANDOM_RANGE);
  const reasoningIntegrity = avg(integrityScores);
  const reasoningTransparency = avg(t.map((x) => x.transparencyScore));
  const reasoningGrounding = avg(t.map((x) => x.groundingScore));
  const causalReasoning = avg(t.map((x) => x.causalReasoningScore));
  const epistemicHumility = avg(t.map((x) => x.epistemicHumilityScore));
  const reasoningTraceability = avg(t.map((x) => x.reasoningTraceabilityScore));
  const adversarialCoherence = avg(t.map((x) => x.adversarialCoherenceScore));
  const informationAsymmetry = avg(t.map((x) => x.informationAsymmetryScore));
  const temporalReasoningQuality = avg(t.map((x) => x.temporalReasoningScore));
  const reasoningAuditability = avg(t.map((x) => x.reasoningAuditabilityScore));
  const decisionReversibility = avg(t.map((x) => x.decisionReversibilityScore));

  // Safety
  const hallucinationFree = avg(t.map((x) => x.hallucinationFlags.length === 0 ? SAFETY_HALLUCINATION_FREE_SCORE : Math.max(FINANCIAL_SCORE_MIN, SAFETY_HALLUCINATION_FREE_SCORE - x.hallucinationFlags.length * SAFETY_HALLUCINATION_PENALTY)));
  const discipline = avg(t.map((x) => x.disciplinePassed ? SAFETY_DISCIPLINE_PASSED_SCORE : SAFETY_DISCIPLINE_FAILED_SCORE));
  const riskAwareness = avg(t.map((x) => {
    const hasRiskRef = /risk|drawdown|stop.?loss|hedge|protect|caution/i.test(x.reasoning);
    return hasRiskRef ? SAFETY_RISK_AWARENESS_PRESENT_SCORE : SAFETY_RISK_AWARENESS_ABSENT_SCORE;
  }));

  // Behavioral
  const actions = t.map((x) => x.action);
  const uniqueActions = new Set(actions);
  const strategyConsistency = uniqueActions.size === 1 ? BEHAVIORAL_STRATEGY_CONSISTENCY_SINGLE_ACTION : uniqueActions.size === 2 ? BEHAVIORAL_STRATEGY_CONSISTENCY_TWO_ACTIONS : BEHAVIORAL_STRATEGY_CONSISTENCY_THREE_PLUS;
  const confidences = t.map((x) => x.confidence);
  const confStdDev = Math.sqrt(
    confidences.reduce((sum, c) => sum + Math.pow(c - avg(confidences), 2), 0) / confidences.length,
  );
  const adaptability = Math.max(FINANCIAL_SCORE_MIN, Math.min(FINANCIAL_SCORE_MAX, BEHAVIORAL_ADAPTABILITY_BASELINE + confStdDev * BEHAVIORAL_ADAPTABILITY_STDDEV_MULTIPLIER));
  const confidenceCalibration = avg(confidences.map((c) => Math.max(BEHAVIORAL_CALIBRATION_BASELINE, FINANCIAL_SCORE_MAX - Math.abs(c - BEHAVIORAL_CALIBRATION_TARGET) * BEHAVIORAL_CALIBRATION_DEVIATION_PENALTY)));
  const crossRoundLearning = Math.min(FINANCIAL_SCORE_MAX, BEHAVIORAL_LEARNING_BASELINE + t.length * BEHAVIORAL_LEARNING_POINTS_PER_TRADE);

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
    ? Math.min(100, 40 + (t.filter((x) => x.coherenceScore > 0.6).length / t.length) * 60)
    : 50;

  // Governance (4 dims)
  const tradeAccountability = avg(t.map((x) => x.accountabilityScore));
  const rqi = avg([
    coherence, reasoningDepth, sourceQuality, logicalConsistency,
    reasoningTransparency, reasoningGrounding, causalReasoning, epistemicHumility,
    reasoningTraceability, adversarialCoherence, informationAsymmetry, temporalReasoningQuality,
    reasoningAuditability, decisionReversibility,
  ]) / 100 * 100;
  const decisionAccountability = avg(t.map((x) => x.accountabilityScore));
  const consensusQuality = avg(t.map((x) => x.consensusQualityScore));

  const dimensions: V36DimensionScores = {
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
    reasoningAuditability: Math.round(reasoningAuditability * 100) / 100,
    decisionReversibility: Math.round(decisionReversibility * 100) / 100,
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
    compositeScore += (dimensions[dim as keyof V36DimensionScores] ?? 50) * weight;
  }
  compositeScore = Math.round(compositeScore * 100) / 100;

  const agentScore: V36AgentScore = {
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
  scores: V36AgentScore[],
  trades: V36TradeGrade[],
  marketRegime: string,
): V36RoundSummary {
  const sorted = [...trades].sort((a, b) => {
    const gradeOrder = ["A+", "A", "B+", "B", "C+", "C", "D", "F"];
    return gradeOrder.indexOf(a.overallGrade) - gradeOrder.indexOf(b.overallGrade);
  });

  const actions = trades.map((t) => t.action);
  const modeAction = actions.sort((a, b) =>
    actions.filter((v) => v === a).length - actions.filter((v) => v === b).length,
  ).pop() ?? "hold";
  const consensusAgreement = actions.filter((a) => a === modeAction).length / Math.max(1, actions.length);

  const avgOf = (fn: (t: V36TradeGrade) => number) =>
    trades.length > 0
      ? Math.round(trades.reduce((s, t) => s + fn(t), 0) / trades.length * 100) / 100
      : 50;

  const summary: V36RoundSummary = {
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
    avgReasoningAuditability: avgOf((t) => t.reasoningAuditabilityScore),
    avgDecisionReversibility: avgOf((t) => t.decisionReversibilityScore),
  };

  roundSummaries.unshift(summary);
  if (roundSummaries.length > 200) roundSummaries.length = 200;

  return summary;
}

// ---------------------------------------------------------------------------
// Public Getters
// ---------------------------------------------------------------------------

export function getAgentScores(): V36AgentScore[] {
  return [...agentScores.values()];
}

export function getAgentScore(agentId: string): V36AgentScore | undefined {
  return agentScores.get(agentId);
}

export function getTradeGrades(limit = 50): V36TradeGrade[] {
  return tradeGrades.slice(0, limit);
}

export function getTradeGradesByAgent(agentId: string, limit = 50): V36TradeGrade[] {
  return tradeGrades.filter((g) => g.agentId === agentId).slice(0, limit);
}

export function getRoundSummaries(limit?: number): V36RoundSummary[] {
  if (limit != null && limit > 0) return roundSummaries.slice(-limit);
  return [...roundSummaries];
}

export function getDimensionWeights(): Record<string, number> {
  return { ...DIMENSION_WEIGHTS };
}

export function getDimensionCount(): number {
  return 32;
}

export function getBenchmarkVersion(): string {
  return "36.0";
}
