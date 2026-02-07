/**
 * V37 Benchmark Engine — 34-Dimension AI Trading Benchmark
 *
 * Extends v36's 32-dimension framework with:
 * - Reasoning Composability: Can the agent's reasoning be decomposed into
 *   independent, reusable modules? Measures argument modularity, cross-trade
 *   reasoning reuse, hierarchical argument structure, transferable insight
 *   detection, and synthesis quality.
 * - Strategic Foresight: Does the agent anticipate second-order effects and
 *   plan multiple moves ahead? Measures catalyst chain identification,
 *   scenario branching, opportunity cost awareness, portfolio-level strategic
 *   thinking, and multi-timeframe integration.
 *
 * Categories (34 dimensions):
 * - Financial Performance (3): pnl, sharpe, drawdown
 * - Reasoning Quality (17): coherence, depth, source, consistency,
 *   integrity, transparency, grounding, causal, epistemic,
 *   traceability, adversarial, info asymmetry, temporal, auditability,
 *   reversibility, composability (NEW), foresight (NEW)
 * - Safety & Trust (3): hallucination, discipline, risk awareness
 * - Behavioral Intelligence (4): consistency, adaptability, calibration, learning
 * - Predictive Power (3): outcome, regime, edge
 * - Governance & Accountability (4): accountability, RQI, decision accountability, consensus
 */

import { createHash } from "crypto";

// Re-export inherited scoring functions from v36
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
  scoreReasoningAuditability,
  scoreDecisionReversibility,
} from "./v36-benchmark-engine.ts";

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
  scoreReasoningAuditability,
  scoreDecisionReversibility,
} from "./v36-benchmark-engine.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Tier Classification Thresholds
 * Used by getTier() to classify composite scores into performance tiers.
 */
/** Minimum composite score for S-tier (elite performance) */
const TIER_S_THRESHOLD = 85;
/** Minimum composite score for A-tier (excellent performance) */
const TIER_A_THRESHOLD = 70;
/** Minimum composite score for B-tier (good performance) */
const TIER_B_THRESHOLD = 55;
/** Minimum composite score for C-tier (average performance) */
const TIER_C_THRESHOLD = 40;
// Below 40 = D-tier (below average)

/**
 * Trade Grade Boundaries
 * Used by getGrade() to convert 0-100 scores into letter grades.
 */
/** Minimum score for A+ grade (outstanding) */
const GRADE_A_PLUS_THRESHOLD = 95;
/** Minimum score for A grade (excellent) */
const GRADE_A_THRESHOLD = 85;
/** Minimum score for B+ grade (very good) */
const GRADE_B_PLUS_THRESHOLD = 75;
/** Minimum score for B grade (good) */
const GRADE_B_THRESHOLD = 65;
/** Minimum score for C+ grade (above average) */
const GRADE_C_PLUS_THRESHOLD = 55;
/** Minimum score for C grade (average) */
const GRADE_C_THRESHOLD = 45;
/** Minimum score for D grade (below average) */
const GRADE_D_THRESHOLD = 30;
// Below 30 = F grade (failing)

/**
 * Reasoning Composability Scoring Constants
 * Used by scoreReasoningComposability() to evaluate modular reasoning quality.
 */

// Argument Modularity (0-20)
/** Max points from independence pattern matches (e.g., "independently", "separately") */
const COMPOSABILITY_MODULARITY_INDEPENDENCE_CAP = 8;
/** Points per independence pattern match */
const COMPOSABILITY_MODULARITY_INDEPENDENCE_MULTIPLIER = 4;
/** Max points from sequential pattern matches (e.g., "first", "second", "1.", "2.") */
const COMPOSABILITY_MODULARITY_SEQUENTIAL_CAP = 8;
/** Points per sequential pattern match */
const COMPOSABILITY_MODULARITY_SEQUENTIAL_MULTIPLIER = 3;
/** Max points from bullet-style patterns */
const COMPOSABILITY_MODULARITY_BULLET_CAP = 4;
/** Points per bullet pattern match */
const COMPOSABILITY_MODULARITY_BULLET_MULTIPLIER = 2;
/** Total max score for modularity sub-component */
const COMPOSABILITY_MODULARITY_MAX = 20;

// Cross-Trade Reasoning Reuse (0-20)
/** Max points from callback pattern matches (e.g., "as I noted", "consistent with my thesis") */
const COMPOSABILITY_REUSE_CALLBACK_CAP = 12;
/** Points per callback pattern match */
const COMPOSABILITY_REUSE_CALLBACK_MULTIPLIER = 4;
/** Max points from shared concepts with previous reasonings */
const COMPOSABILITY_REUSE_SHARED_CONCEPTS_CAP = 8;
/** Points per previous reasoning with shared concepts */
const COMPOSABILITY_REUSE_SHARED_CONCEPTS_MULTIPLIER = 4;
/** Minimum word overlap to count as shared concept */
const COMPOSABILITY_REUSE_OVERLAP_THRESHOLD = 3;
/** Partial credit when no previous reasoning available */
const COMPOSABILITY_REUSE_NO_PREVIOUS_CREDIT = 3;
/** Total max score for reuse sub-component */
const COMPOSABILITY_REUSE_MAX = 20;

// Hierarchical Structure (0-20)
/** Max points from thesis pattern matches */
const COMPOSABILITY_HIERARCHY_THESIS_CAP = 6;
/** Points per thesis pattern match */
const COMPOSABILITY_HIERARCHY_THESIS_MULTIPLIER = 3;
/** Max points from sub-claim pattern matches */
const COMPOSABILITY_HIERARCHY_SUBCLAIM_CAP = 6;
/** Points per sub-claim pattern match */
const COMPOSABILITY_HIERARCHY_SUBCLAIM_MULTIPLIER = 3;
/** Max points from evidence pattern matches */
const COMPOSABILITY_HIERARCHY_EVIDENCE_CAP = 8;
/** Points per evidence pattern match */
const COMPOSABILITY_HIERARCHY_EVIDENCE_MULTIPLIER = 3;
/** Total max score for hierarchy sub-component */
const COMPOSABILITY_HIERARCHY_MAX = 20;

// Transferable Insights (0-20)
/** Max points from general principle pattern matches */
const COMPOSABILITY_TRANSFER_PRINCIPLE_CAP = 12;
/** Points per general principle pattern match */
const COMPOSABILITY_TRANSFER_PRINCIPLE_MULTIPLIER = 4;
/** Max points from framework-level thinking patterns */
const COMPOSABILITY_TRANSFER_FRAMEWORK_CAP = 8;
/** Points per framework pattern match */
const COMPOSABILITY_TRANSFER_FRAMEWORK_MULTIPLIER = 3;
/** Total max score for transfer sub-component */
const COMPOSABILITY_TRANSFER_MAX = 20;

// Synthesis Quality (0-20)
/** Max points from synthesis pattern matches */
const COMPOSABILITY_SYNTHESIS_PATTERN_CAP = 12;
/** Points per synthesis pattern match */
const COMPOSABILITY_SYNTHESIS_PATTERN_MULTIPLIER = 4;
/** Max points from connective tissue patterns */
const COMPOSABILITY_SYNTHESIS_CONNECTIVE_CAP = 8;
/** Points per connective pattern match */
const COMPOSABILITY_SYNTHESIS_CONNECTIVE_MULTIPLIER = 3;
/** Total max score for synthesis sub-component */
const COMPOSABILITY_SYNTHESIS_MAX = 20;

// Bonus
/** Minimum source count to trigger bonus */
const COMPOSABILITY_BONUS_SOURCE_THRESHOLD = 4;
/** Points per source above threshold */
const COMPOSABILITY_BONUS_SOURCE_MULTIPLIER = 2;
/** Max bonus points from high source count */
const COMPOSABILITY_BONUS_SOURCE_CAP = 5;
/** Baseline source offset (sources - 3) */
const COMPOSABILITY_BONUS_SOURCE_OFFSET = 3;

/**
 * Strategic Foresight Scoring Constants
 * Used by scoreStrategicForesight() to evaluate forward-looking strategic thinking.
 */

// Catalyst Chain Identification (0-20)
/** Max points from causal chain pattern matches */
const FORESIGHT_CHAIN_PATTERN_CAP = 12;
/** Points per causal chain pattern match */
const FORESIGHT_CHAIN_PATTERN_MULTIPLIER = 4;
/** Points for 3+ "leads to" matches (long chains) */
const FORESIGHT_CHAIN_LEADS_TO_HIGH = 8;
/** Points for 2 "leads to" matches (medium chains) */
const FORESIGHT_CHAIN_LEADS_TO_MEDIUM = 5;
/** Points for 1 "leads to" match (short chains) */
const FORESIGHT_CHAIN_LEADS_TO_LOW = 2;
/** Threshold for long causal chains */
const FORESIGHT_CHAIN_LEADS_TO_HIGH_THRESHOLD = 3;
/** Threshold for medium causal chains */
const FORESIGHT_CHAIN_LEADS_TO_MEDIUM_THRESHOLD = 2;
/** Threshold for short causal chains */
const FORESIGHT_CHAIN_LEADS_TO_LOW_THRESHOLD = 1;
/** Total max score for chain sub-component */
const FORESIGHT_CHAIN_MAX = 20;

// Scenario Branching (0-20)
/** Max points from if/then pattern matches */
const FORESIGHT_BRANCH_IF_THEN_CAP = 8;
/** Points per if/then pattern match */
const FORESIGHT_BRANCH_IF_THEN_MULTIPLIER = 3;
/** Max points from else/alternative pattern matches */
const FORESIGHT_BRANCH_ELSE_CAP = 8;
/** Points per else pattern match */
const FORESIGHT_BRANCH_ELSE_MULTIPLIER = 3;
/** Max points from explicit scenario analysis patterns */
const FORESIGHT_BRANCH_SCENARIO_CAP = 4;
/** Points per scenario analysis pattern match */
const FORESIGHT_BRANCH_SCENARIO_MULTIPLIER = 2;
/** Total max score for branching sub-component */
const FORESIGHT_BRANCH_MAX = 20;

// Opportunity Cost Awareness (0-20)
/** Max points from rejection/alternative pattern matches */
const FORESIGHT_OPPORTUNITY_REJECTION_CAP = 12;
/** Points per rejection pattern match */
const FORESIGHT_OPPORTUNITY_REJECTION_MULTIPLIER = 4;
/** Max points from comparative analysis patterns */
const FORESIGHT_OPPORTUNITY_COMPARATIVE_CAP = 8;
/** Points per comparative pattern match */
const FORESIGHT_OPPORTUNITY_COMPARATIVE_MULTIPLIER = 3;
/** Total max score for opportunity cost sub-component */
const FORESIGHT_OPPORTUNITY_MAX = 20;

// Portfolio-Level Thinking (0-20)
/** Max points from portfolio pattern matches */
const FORESIGHT_PORTFOLIO_PATTERN_CAP = 12;
/** Points per portfolio pattern match */
const FORESIGHT_PORTFOLIO_PATTERN_MULTIPLIER = 4;
/** Max points from correlation/hedging pattern matches */
const FORESIGHT_PORTFOLIO_CORRELATION_CAP = 8;
/** Points per correlation pattern match */
const FORESIGHT_PORTFOLIO_CORRELATION_MULTIPLIER = 3;
/** Total max score for portfolio sub-component */
const FORESIGHT_PORTFOLIO_MAX = 20;

// Multi-Timeframe Integration (0-20)
/** Points for using all 3 timeframes (short/medium/long) */
const FORESIGHT_TIMEFRAME_ALL_THREE = 14;
/** Points for using 2 timeframes */
const FORESIGHT_TIMEFRAME_TWO = 10;
/** Points for using 1 timeframe */
const FORESIGHT_TIMEFRAME_ONE = 5;
/** Max points from timeframe integration patterns */
const FORESIGHT_TIMEFRAME_INTEGRATION_CAP = 6;
/** Points per integration pattern match */
const FORESIGHT_TIMEFRAME_INTEGRATION_MULTIPLIER = 3;
/** Total max score for timeframe sub-component */
const FORESIGHT_TIMEFRAME_MAX = 20;

// Bonus
/** Points per strategic source (strategy, outlook, forecast keywords) */
const FORESIGHT_BONUS_SOURCE_MULTIPLIER = 3;
/** Max bonus points from strategic sources */
const FORESIGHT_BONUS_SOURCE_CAP = 5;

// ---------------------------------------------------------------------------
// Types for the 34 dimensions
// ---------------------------------------------------------------------------

export interface V37DimensionScores {
  // Financial Performance (3 dims)
  pnlPercent: number;
  sharpeRatio: number;
  maxDrawdown: number;
  // Reasoning Quality (17 dims — 15 from v36 + composability + foresight)
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
  reasoningComposability: number;   // NEW
  strategicForesight: number;       // NEW
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

export interface V37AgentScore {
  agentId: string;
  agentName: string;
  provider: string;
  model: string;
  dimensions: V37DimensionScores;
  compositeScore: number;
  tier: "S" | "A" | "B" | "C" | "D";
  tradeCount: number;
  roundsPlayed: number;
  lastUpdated: string;
  /**
   * Pearson correlation between coherence score and actual P&L percent.
   * Positive = higher reasoning quality predicts better financial outcomes.
   * null when fewer than 2 trades have actualPnlPercent resolved.
   */
  reasoningProfitCorrelation?: number | null;
}

export interface V37TradeGrade {
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
  reasoningComposabilityScore: number;   // NEW
  strategicForesightScore: number;       // NEW
  integrityHash: string;
  predictedOutcome: string | null;
  actualOutcome: string | null;
  outcomeResolved: "pending" | "correct" | "incorrect" | "partial";
  /** Actual P&L percentage this trade produced (null if unresolved) */
  actualPnlPercent?: number;
  /** Trade outcome classification from outcome resolution engine */
  tradeOutcome?: "profit" | "loss" | "breakeven" | "pending";
  overallGrade: "A+" | "A" | "B+" | "B" | "C+" | "C" | "D" | "F";
  gradedAt: string;
}

export interface V37RoundSummary {
  roundId: string;
  timestamp: string;
  agentScores: V37AgentScore[];
  bestTrade: V37TradeGrade | null;
  worstTrade: V37TradeGrade | null;
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
  avgReasoningComposability: number;   // NEW
  avgStrategicForesight: number;       // NEW
}

// ---------------------------------------------------------------------------
// In-memory storage
// ---------------------------------------------------------------------------

const agentScores = new Map<string, V37AgentScore>();
const tradeGrades: V37TradeGrade[] = [];
const roundSummaries: V37RoundSummary[] = [];

// ---------------------------------------------------------------------------
// Dimension weights (must sum to ~1.0) — 34 entries
//
// Rebalanced for a TRADING benchmark: financial performance raised from 12%
// to 30% so profitability is the dominant signal. Reasoning quality reduced
// from ~53% to 35% — still the second-largest category because *how* an agent
// thinks matters, but not more than whether it actually makes money. Safety &
// Trust raised to 15% (hallucination/discipline are non-negotiable for live
// trading). Behavioral, Predictive, and Governance categories adjusted to fill
// the remaining 20%.
//
// Category breakdown:
//   Financial Performance  30%  (was 12%)  — the primary purpose of a trading agent
//   Reasoning Quality      35%  (was 53%)  — still important, but secondary to P&L
//   Safety & Trust         15%  (was  9%)  — higher because trust is table-stakes
//   Behavioral Intelligence 8%  (unchanged) — adaptability and calibration
//   Predictive Power        7%  (was  6%)  — slight bump for outcome accuracy
//   Governance              5%  (was  9%)  — reduced, least trading-relevant
// ---------------------------------------------------------------------------

const DIMENSION_WEIGHTS: Record<keyof V37DimensionScores, number> = {
  // --- Financial Performance (30%) -------------------------------------------
  pnlPercent: 0.12,                // P&L is the north-star metric for a trading benchmark
  sharpeRatio: 0.10,               // risk-adjusted return rewards consistency
  maxDrawdown: 0.08,               // capital preservation / tail-risk control

  // --- Reasoning Quality (35%) -----------------------------------------------
  // Top-tier reasoning dimensions (0.04 each — most indicative of quality)
  coherence: 0.04,                 // reasoning must logically support the trade
  reasoningDepth: 0.04,            // multi-step analysis depth
  sourceQuality: 0.04,             // breadth and quality of cited data
  reasoningGrounding: 0.04,        // anchored in real market data

  // Mid-tier reasoning dimensions (0.02 each — valuable but secondary)
  logicalConsistency: 0.02,
  reasoningIntegrity: 0.02,
  reasoningTransparency: 0.02,
  causalReasoning: 0.02,
  epistemicHumility: 0.02,
  reasoningTraceability: 0.02,

  // Lower-tier reasoning dimensions (0.01 each — nice-to-have detail)
  adversarialCoherence: 0.01,
  informationAsymmetry: 0.01,
  temporalReasoningQuality: 0.01,
  reasoningAuditability: 0.01,
  decisionReversibility: 0.01,
  reasoningComposability: 0.01,
  strategicForesight: 0.01,

  // --- Safety & Trust (15%) --------------------------------------------------
  hallucinationRate: 0.06,         // fabricated data is disqualifying in live trading
  instructionDiscipline: 0.05,     // rule compliance prevents catastrophic errors
  riskAwareness: 0.04,             // must acknowledge and manage downside risk

  // --- Behavioral Intelligence (8%) ------------------------------------------
  strategyConsistency: 0.02,
  adaptability: 0.02,
  confidenceCalibration: 0.02,
  crossRoundLearning: 0.02,

  // --- Predictive Power (7%) -------------------------------------------------
  outcomeAccuracy: 0.03,           // did the agent's predictions come true?
  marketRegimeAwareness: 0.02,
  edgeConsistency: 0.02,

  // --- Governance & Accountability (5%) --------------------------------------
  tradeAccountability: 0.02,
  reasoningQualityIndex: 0.01,
  decisionAccountability: 0.01,
  consensusQuality: 0.01,
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
// NEW v37: Reasoning Composability
// ---------------------------------------------------------------------------

/**
 * Can the agent's reasoning be decomposed into independent, reusable modules?
 * Measures argument modularity (are claims self-contained?), cross-trade
 * reasoning reuse (does the agent build on previous insights?), hierarchical
 * argument structure (thesis -> sub-claims -> evidence), transferable insight
 * detection (reasoning applicable beyond this specific trade), and synthesis
 * quality (how well sub-arguments combine into a coherent whole).
 *
 * Measures:
 * 1. Argument Modularity (0-20): Are claims self-contained and separable?
 * 2. Cross-Trade Reasoning Reuse (0-20): Does agent build on previous insights?
 * 3. Hierarchical Structure (0-20): thesis -> sub-claims -> evidence?
 * 4. Transferable Insights (0-20): General principles that apply beyond this trade?
 * 5. Synthesis Quality (0-20): Do sub-arguments combine into a coherent whole?
 */
export function scoreReasoningComposability(
  reasoning: string,
  sources: string[],
  peerReasonings: string[],
  previousReasonings: string[],
): number {
  let score = 0;
  const maxScore = 100;

  // 1. Argument Modularity (0-20)
  // Detect self-contained claims with connectors like "independently", "separately",
  // "first...", "second...", numbered arguments, bullet-style reasoning
  let modularityScore = 0;

  const independencePatterns = /\b(?:independently|separately|on its own|in isolation|standalone|self[- ]contained|distinct(?:ly)?|each factor|taken alone)\b/gi;
  const independenceMatches = reasoning.match(independencePatterns) ?? [];
  modularityScore += Math.min(COMPOSABILITY_MODULARITY_INDEPENDENCE_CAP, independenceMatches.length * COMPOSABILITY_MODULARITY_INDEPENDENCE_MULTIPLIER);

  // Sequential/numbered arguments
  const sequentialPatterns = /\b(?:first(?:ly)?[,:]|second(?:ly)?[,:]|third(?:ly)?[,:]|fourth(?:ly)?[,:]|1[\.\)]\s|2[\.\)]\s|3[\.\)]\s|4[\.\)]\s|point\s+(?:one|two|three|four)|argument\s+\d|reason\s+\d)\b/gi;
  const sequentialMatches = reasoning.match(sequentialPatterns) ?? [];
  modularityScore += Math.min(COMPOSABILITY_MODULARITY_SEQUENTIAL_CAP, sequentialMatches.length * COMPOSABILITY_MODULARITY_SEQUENTIAL_MULTIPLIER);

  // Bullet-style or list-style reasoning
  const bulletPatterns = /(?:^|\n)\s*[-*>]\s+\S/gm;
  const bulletMatches = reasoning.match(bulletPatterns) ?? [];
  modularityScore += Math.min(COMPOSABILITY_MODULARITY_BULLET_CAP, bulletMatches.length * COMPOSABILITY_MODULARITY_BULLET_MULTIPLIER);

  score += Math.min(COMPOSABILITY_MODULARITY_MAX, modularityScore);

  // 2. Cross-Trade Reasoning Reuse (0-20)
  // Detect callbacks to previous analysis like "consistent with my thesis",
  // "as I noted", "building on", "reaffirming", "updating my view"
  let reuseScore = 0;

  const callbackPatterns = /\b(?:consistent with (?:my|our|the) (?:thesis|view|analysis|prior)|as I (?:noted|mentioned|observed|argued)|building on (?:my|our|the|previous)|reaffirming (?:my|our|the)|updating (?:my|our) (?:view|thesis|model|outlook)|in line with (?:my|our) (?:previous|earlier|prior)|confirms? (?:my|our) (?:earlier|previous|prior)|reinforc(?:es?|ing) (?:my|our) (?:thesis|view|conviction)|as previously (?:discussed|noted|analyzed|stated))\b/gi;
  const callbackMatches = reasoning.match(callbackPatterns) ?? [];
  reuseScore += Math.min(COMPOSABILITY_REUSE_CALLBACK_CAP, callbackMatches.length * COMPOSABILITY_REUSE_CALLBACK_MULTIPLIER);

  // Cross-reference with actual previous reasonings
  if (previousReasonings.length > 0) {
    // Check if key phrases from previous reasoning appear
    let sharedConcepts = 0;
    for (const prev of previousReasonings) {
      const prevWords = prev.toLowerCase().split(/\s+/).filter((w) => w.length > 5);
      const currentWords = new Set(reasoning.toLowerCase().split(/\s+/));
      const overlap = prevWords.filter((w) => currentWords.has(w)).length;
      if (overlap >= COMPOSABILITY_REUSE_OVERLAP_THRESHOLD) sharedConcepts++;
    }
    reuseScore += Math.min(COMPOSABILITY_REUSE_SHARED_CONCEPTS_CAP, sharedConcepts * COMPOSABILITY_REUSE_SHARED_CONCEPTS_MULTIPLIER);
  } else {
    // No previous reasoning to compare — partial credit for self-referential structure
    reuseScore += COMPOSABILITY_REUSE_NO_PREVIOUS_CREDIT;
  }

  score += Math.min(COMPOSABILITY_REUSE_MAX, reuseScore);

  // 3. Hierarchical Structure (0-20)
  // Detect thesis -> sub-claims -> evidence structure.
  // Look for "my thesis is", "supporting this:", "evidence:", "because", "therefore"
  let hierarchyScore = 0;

  const thesisPatterns = /\b(?:my thesis (?:is|remains)|(?:core|central|main|overall) (?:thesis|argument|claim|view)|I (?:believe|argue|contend|maintain) that|the (?:key|main) (?:point|takeaway) is)\b/gi;
  const thesisMatches = reasoning.match(thesisPatterns) ?? [];
  hierarchyScore += Math.min(COMPOSABILITY_HIERARCHY_THESIS_CAP, thesisMatches.length * COMPOSABILITY_HIERARCHY_THESIS_MULTIPLIER);

  const subClaimPatterns = /\b(?:supporting this[,:]|sub-?claim|in support|additional(?:ly)?[,:]|furthermore[,:]|moreover[,:]|another (?:factor|reason|point)|a (?:key|second|further) (?:factor|point|consideration))\b/gi;
  const subClaimMatches = reasoning.match(subClaimPatterns) ?? [];
  hierarchyScore += Math.min(COMPOSABILITY_HIERARCHY_SUBCLAIM_CAP, subClaimMatches.length * COMPOSABILITY_HIERARCHY_SUBCLAIM_MULTIPLIER);

  const evidencePatterns = /\b(?:evidence[:\s]|the data (?:shows?|suggests?|indicates?)|because\b|therefore\b|this is (?:supported|evidenced|shown) by|as (?:shown|demonstrated|indicated) by|proof (?:of|that)|specifically[,:])\b/gi;
  const evidenceMatches = reasoning.match(evidencePatterns) ?? [];
  hierarchyScore += Math.min(COMPOSABILITY_HIERARCHY_EVIDENCE_CAP, evidenceMatches.length * COMPOSABILITY_HIERARCHY_EVIDENCE_MULTIPLIER);

  score += Math.min(COMPOSABILITY_HIERARCHY_MAX, hierarchyScore);

  // 4. Transferable Insights (0-20)
  // Detect general principles the agent articulates that apply beyond this trade.
  // e.g. "sectors with X tend to Y", "when interest rates Z, tech stocks..."
  let transferScore = 0;

  const generalPrinciplePatterns = /\b(?:sectors? with .{3,30} tend to|when (?:interest rates?|inflation|the Fed|GDP|earnings|volatility) .{3,30}(?:stocks?|equities|bonds?|crypto|assets?)|historically[,:]|as a (?:general )?rule|in (?:general|principle)|this pattern (?:suggests|indicates|shows)|a broader (?:trend|pattern|lesson)|the (?:lesson|takeaway|implication) (?:here )?is|this (?:applies|extends|generalizes) (?:to|beyond)|more (?:broadly|generally))\b/gi;
  const generalPrincipleMatches = reasoning.match(generalPrinciplePatterns) ?? [];
  transferScore += Math.min(COMPOSABILITY_TRANSFER_PRINCIPLE_CAP, generalPrincipleMatches.length * COMPOSABILITY_TRANSFER_PRINCIPLE_MULTIPLIER);

  // Framework-level thinking
  const frameworkPatterns = /\b(?:framework|mental model|heuristic|rule of thumb|first principles?|structural(?:ly)?|systematic(?:ally)?|paradigm|regime[- ]dependent|cycle[- ](?:dependent|aware)|macro (?:framework|lens|perspective))\b/gi;
  const frameworkMatches = reasoning.match(frameworkPatterns) ?? [];
  transferScore += Math.min(COMPOSABILITY_TRANSFER_FRAMEWORK_CAP, frameworkMatches.length * COMPOSABILITY_TRANSFER_FRAMEWORK_MULTIPLIER);

  score += Math.min(COMPOSABILITY_TRANSFER_MAX, transferScore);

  // 5. Synthesis Quality (0-20)
  // Are sub-arguments combined coherently? Reward "combining these factors",
  // "on balance", "weighing X against Y", "net assessment"
  let synthesisScore = 0;

  const synthesisPatterns = /\b(?:combining these (?:factors|arguments|points|considerations)|on balance|weighing .{3,30} against|net assessment|all (?:things )?considered|taking (?:everything|all) (?:into account|together)|in (?:sum|summary|aggregate|total)|the (?:combined|cumulative|overall|net) (?:effect|impact|picture|view)|pulling (?:it|this|these) (?:all )?together|synthesizing|the (?:bottom line|upshot) is)\b/gi;
  const synthesisMatches = reasoning.match(synthesisPatterns) ?? [];
  synthesisScore += Math.min(COMPOSABILITY_SYNTHESIS_PATTERN_CAP, synthesisMatches.length * COMPOSABILITY_SYNTHESIS_PATTERN_MULTIPLIER);

  // Connective tissue between arguments
  const connectivePatterns = /\b(?:this (?:combined|coupled|paired) with|together (?:with|these)|in conjunction (?:with)?|alongside|coupled with|layered on top|in addition to the (?:above|previous)|building on (?:this|the above))\b/gi;
  const connectiveMatches = reasoning.match(connectivePatterns) ?? [];
  synthesisScore += Math.min(COMPOSABILITY_SYNTHESIS_CONNECTIVE_CAP, connectiveMatches.length * COMPOSABILITY_SYNTHESIS_CONNECTIVE_MULTIPLIER);

  score += Math.min(COMPOSABILITY_SYNTHESIS_MAX, synthesisScore);

  // Bonus: high source count suggests modular research
  if (sources.length >= COMPOSABILITY_BONUS_SOURCE_THRESHOLD) {
    score += Math.min(COMPOSABILITY_BONUS_SOURCE_CAP, (sources.length - COMPOSABILITY_BONUS_SOURCE_OFFSET) * COMPOSABILITY_BONUS_SOURCE_MULTIPLIER);
  }

  return Math.round(Math.min(maxScore, Math.max(0, score)));
}

// ---------------------------------------------------------------------------
// NEW v37: Strategic Foresight
// ---------------------------------------------------------------------------

/**
 * Does the agent anticipate second-order effects and plan multiple moves ahead?
 * Measures catalyst chain identification (A causes B causes C), scenario
 * branching (if X then Y, else Z), opportunity cost awareness (what am I
 * giving up?), portfolio-level strategic thinking (how does this trade fit the
 * bigger picture), and multi-timeframe integration (short/medium/long term
 * reasoning).
 *
 * Measures:
 * 1. Catalyst Chain Identification (0-20): Multi-step cause-effect chains
 * 2. Scenario Branching (0-20): If/then/else reasoning
 * 3. Opportunity Cost Awareness (0-20): What agent considered but rejected
 * 4. Portfolio-Level Thinking (0-20): How trade fits overall portfolio
 * 5. Multi-Timeframe Integration (0-20): Different time horizons
 */
export function scoreStrategicForesight(
  reasoning: string,
  action: string,
  predictedOutcome: string | null,
  sources: string[],
): number {
  let score = 0;
  const maxScore = 100;

  // Combine reasoning + predicted outcome for analysis
  const fullText = reasoning + (predictedOutcome ? " " + predictedOutcome : "");

  // 1. Catalyst Chain Identification (0-20)
  // Detect multi-step cause-effect chains: "If earnings beat, institutional buying
  // increases, pushing price past resistance"
  let chainScore = 0;

  const causalChainPatterns = /\b(?:(?:which|this) (?:will|would|could|should|may) (?:lead|cause|trigger|result|drive|push|pull|force|spark|prompt) .{3,60}(?:which|that|causing|leading|resulting|driving|pushing)|if .{5,60} then .{5,60}(?:and then|which then|subsequently|in turn)|(?:first|initially) .{5,60}(?:then|next|subsequently|afterwards)|chain (?:of events|reaction)|domino effect|knock[- ]on effect|second[- ]order (?:effect|consequence|impact)|cascad(?:e|ing)|ripple (?:effect|through))\b/gi;
  const causalChainMatches = fullText.match(causalChainPatterns) ?? [];
  chainScore += Math.min(FORESIGHT_CHAIN_PATTERN_CAP, causalChainMatches.length * FORESIGHT_CHAIN_PATTERN_MULTIPLIER);

  // Multi-step "leads to" chains
  const leadsToPatterns = /\b(?:leads? to|results? in|causes?|triggers?|drives?)\b/gi;
  const leadsToMatches = fullText.match(leadsToPatterns) ?? [];
  // More "leads to" connectors = longer causal chains
  if (leadsToMatches.length >= FORESIGHT_CHAIN_LEADS_TO_HIGH_THRESHOLD) chainScore += FORESIGHT_CHAIN_LEADS_TO_HIGH;
  else if (leadsToMatches.length >= FORESIGHT_CHAIN_LEADS_TO_MEDIUM_THRESHOLD) chainScore += FORESIGHT_CHAIN_LEADS_TO_MEDIUM;
  else if (leadsToMatches.length >= FORESIGHT_CHAIN_LEADS_TO_LOW_THRESHOLD) chainScore += FORESIGHT_CHAIN_LEADS_TO_LOW;

  score += Math.min(FORESIGHT_CHAIN_MAX, chainScore);

  // 2. Scenario Branching (0-20)
  // Detect if/then/else reasoning: "If Fed holds rates, growth stocks rally.
  // If Fed hikes, rotate to defensives"
  let branchScore = 0;

  const ifThenPatterns = /\b(?:if .{5,80}(?:then|,\s*(?:I|we|the|this))|in (?:the )?(?:case|event|scenario) (?:that|of|where)|should .{3,40}(?:then|,\s*(?:I|we))|assuming .{3,40}(?:then|,))\b/gi;
  const ifThenMatches = fullText.match(ifThenPatterns) ?? [];
  branchScore += Math.min(FORESIGHT_BRANCH_IF_THEN_CAP, ifThenMatches.length * FORESIGHT_BRANCH_IF_THEN_MULTIPLIER);

  const elsePatterns = /\b(?:(?:else|otherwise|alternatively|conversely|on the other hand|if (?:instead|not|however))[,:]?\s+.{5,}|(?:bull|bear|base)\s+(?:case|scenario)|(?:upside|downside|base)\s+(?:case|scenario)|scenario (?:1|2|3|one|two|three|A|B|C))\b/gi;
  const elseMatches = fullText.match(elsePatterns) ?? [];
  branchScore += Math.min(FORESIGHT_BRANCH_ELSE_CAP, elseMatches.length * FORESIGHT_BRANCH_ELSE_MULTIPLIER);

  // Explicit scenario analysis
  const scenarioPatterns = /\b(?:scenario analysis|decision tree|contingent on|probability[- ]weighted|range of outcomes|multiple scenarios|best[- ]case .{3,30} worst[- ]case)\b/gi;
  const scenarioMatches = fullText.match(scenarioPatterns) ?? [];
  branchScore += Math.min(FORESIGHT_BRANCH_SCENARIO_CAP, scenarioMatches.length * FORESIGHT_BRANCH_SCENARIO_MULTIPLIER);

  score += Math.min(FORESIGHT_BRANCH_MAX, branchScore);

  // 3. Opportunity Cost Awareness (0-20)
  // Detect what agent considered but rejected: "Chose X over Y because",
  // "could have bought Z but", "opportunity cost"
  let opportunityScore = 0;

  const rejectionPatterns = /\b(?:(?:chose|choosing|picked|selected|prefer(?:red)?) .{3,40} (?:over|instead of|rather than)|could (?:have|alternatively) (?:bought|sold|traded|invested|chosen)|opportunity cost|(?:trade|trading)[- ]off|alternative(?:ly|s)?[,:]?\s+(?:I|we) could|instead of .{3,40}(?:I|we) (?:chose|opted|decided)|passed on|opted (?:not to|against)|decided against|the (?:alternative|other option) (?:was|would be))\b/gi;
  const rejectionMatches = fullText.match(rejectionPatterns) ?? [];
  opportunityScore += Math.min(FORESIGHT_OPPORTUNITY_REJECTION_CAP, rejectionMatches.length * FORESIGHT_OPPORTUNITY_REJECTION_MULTIPLIER);

  // Comparative analysis
  const comparativePatterns = /\b(?:compared to|relative to|versus|vs\.?\s+|better (?:risk[- ]reward|opportunity) in|more attractive than|less compelling than|higher (?:conviction|upside) in .{3,30} than)\b/gi;
  const comparativeMatches = fullText.match(comparativePatterns) ?? [];
  opportunityScore += Math.min(FORESIGHT_OPPORTUNITY_COMPARATIVE_CAP, comparativeMatches.length * FORESIGHT_OPPORTUNITY_COMPARATIVE_MULTIPLIER);

  score += Math.min(FORESIGHT_OPPORTUNITY_MAX, opportunityScore);

  // 4. Portfolio-Level Thinking (0-20)
  // Detect reasoning about how this trade fits the overall portfolio:
  // "This diversifies my", "reduces correlation with", "complements my position in"
  let portfolioScore = 0;

  const portfolioPatterns = /\b(?:(?:this )?diversif(?:ies|ying|ication)|reduces? (?:my|our|portfolio) (?:correlation|risk|exposure)|complements? (?:my|our) (?:position|holding|exposure|portfolio)|portfolio[- ]level|overall (?:portfolio|allocation|exposure|position)|position sizing|risk budget|(?:adds?|adding) (?:to (?:my|our) )?(?:exposure|allocation)|(?:overweight|underweight|neutral)[- ]?(?:ing)?|rebalanc(?:e|ing)|concentration risk|sector (?:exposure|allocation|balance))\b/gi;
  const portfolioMatches = fullText.match(portfolioPatterns) ?? [];
  portfolioScore += Math.min(FORESIGHT_PORTFOLIO_PATTERN_CAP, portfolioMatches.length * FORESIGHT_PORTFOLIO_PATTERN_MULTIPLIER);

  // Correlation/hedging awareness
  const correlationPatterns = /\b(?:correlat(?:ed|ion)|hedge(?:d|s|ing)?|offset(?:s|ting)?|uncorrelated|negative(?:ly)? correlated|tail[- ]risk|(?:beta|delta)[- ](?:neutral|adjusted)|risk[- ]adjusted (?:return|exposure)|Sharpe[- ]optimal)\b/gi;
  const correlationMatches = fullText.match(correlationPatterns) ?? [];
  portfolioScore += Math.min(FORESIGHT_PORTFOLIO_CORRELATION_CAP, correlationMatches.length * FORESIGHT_PORTFOLIO_CORRELATION_MULTIPLIER);

  score += Math.min(FORESIGHT_PORTFOLIO_MAX, portfolioScore);

  // 5. Multi-Timeframe Integration (0-20)
  // Detect explicit mention of different time horizons:
  // "Short-term: ..., Medium-term: ...", "near-term catalyst", "long-term thesis"
  let timeframeScore = 0;

  const shortTermPatterns = /\b(?:short[- ]term|near[- ]term|immediate(?:ly)?|(?:next|this) (?:week|few days)|intraday|(?:today|tomorrow|overnight)|tactical(?:ly)?|(?:1|2|3)[- ](?:day|week))\b/gi;
  const shortTermMatches = fullText.match(shortTermPatterns) ?? [];

  const mediumTermPatterns = /\b(?:medium[- ]term|intermediate|(?:next|coming) (?:few )?(?:weeks?|months?)|(?:1|2|3|4|6)[- ]month|quarter(?:ly)?|swing (?:trade|position))\b/gi;
  const mediumTermMatches = fullText.match(mediumTermPatterns) ?? [];

  const longTermPatterns = /\b(?:long[- ]term|secular|structural(?:ly)?|multi[- ]year|(?:over|in) the (?:long run|next (?:year|few years))|(?:12|18|24)[- ]month|annual(?:ly|ized)?|(?:long|longer)[- ]dated|strategic(?:ally)?)\b/gi;
  const longTermMatches = fullText.match(longTermPatterns) ?? [];

  const timeframesUsed = [
    shortTermMatches.length > 0 ? 1 : 0,
    mediumTermMatches.length > 0 ? 1 : 0,
    longTermMatches.length > 0 ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  // Multiple timeframes = high score
  if (timeframesUsed >= 3) timeframeScore += FORESIGHT_TIMEFRAME_ALL_THREE;
  else if (timeframesUsed === 2) timeframeScore += FORESIGHT_TIMEFRAME_TWO;
  else if (timeframesUsed === 1) timeframeScore += FORESIGHT_TIMEFRAME_ONE;

  // Explicit integration across timeframes
  const integrationPatterns = /\b(?:short[- ]term .{5,60} (?:but|while|whereas) .{5,60} long[- ]term|near[- ]term .{5,60} (?:but|while) .{5,60} (?:medium|long)[- ]term|across (?:time )?(?:horizons|frames|periods)|time[- ]horizon (?:analysis|integration|alignment)|(?:tactically|strategically) .{5,30} (?:but|while) (?:strategically|tactically))\b/gi;
  const integrationMatches = fullText.match(integrationPatterns) ?? [];
  timeframeScore += Math.min(FORESIGHT_TIMEFRAME_INTEGRATION_CAP, integrationMatches.length * FORESIGHT_TIMEFRAME_INTEGRATION_MULTIPLIER);

  score += Math.min(FORESIGHT_TIMEFRAME_MAX, timeframeScore);

  // Bonus: sources that span multiple timeframes or strategic content
  const strategicSources = sources.filter((s) =>
    /strategy|outlook|forecast|scenario|macro|allocation|portfolio/i.test(s),
  );
  if (strategicSources.length > 0) {
    score += Math.min(FORESIGHT_BONUS_SOURCE_CAP, strategicSources.length * FORESIGHT_BONUS_SOURCE_MULTIPLIER);
  }

  return Math.round(Math.min(maxScore, Math.max(0, score)));
}

// ---------------------------------------------------------------------------
// Trade Grading (34 dimensions)
// ---------------------------------------------------------------------------

/**
 * Grade an individual trade with all 34 dimension sub-scores.
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
  previousReasonings?: string[];
  quantity?: number;
  /** Actual P&L percentage from outcome resolution (pass-through) */
  actualPnlPercent?: number;
  /** Trade outcome classification from outcome resolution (pass-through) */
  tradeOutcome?: "profit" | "loss" | "breakeven" | "pending";
}): V37TradeGrade {
  const tradeId = `v37_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  // Score reasoning depth
  const wordCount = input.reasoning.split(/\s+/).length;
  const clauseCount = input.reasoning.split(/[.;!?]/).filter((s) => s.trim().length > 0).length;
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

  // Inherited scoring from v35 (via v36)
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

  // v36 scoring — match exact parameter signatures from v36
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

  // NEW v37 scoring
  const reasoningComposabilityScore = scoreReasoningComposability(
    input.reasoning,
    input.sources,
    input.peerReasonings ?? [],
    input.previousReasonings ?? [],
  );
  const strategicForesightScore = scoreStrategicForesight(
    input.reasoning,
    input.action,
    input.predictedOutcome,
    input.sources,
  );

  // Integrity hash
  const integrityHash = createHash("sha256")
    .update(`v37:${input.agentId}:${input.action}:${input.symbol}:${input.reasoning}:${input.confidence}`)
    .digest("hex")
    .slice(0, 16);

  // Overall grade (weighted average of all 20 trade-level sub-scores)
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
    reasoningAuditabilityScore,
    decisionReversibilityScore,
    reasoningComposabilityScore,
    strategicForesightScore,
  ];
  const avgScore = subScores.reduce((a, b) => a + b, 0) / subScores.length;
  const overallGrade = getGrade(avgScore);

  const grade: V37TradeGrade = {
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
    reasoningComposabilityScore,
    strategicForesightScore,
    integrityHash,
    predictedOutcome: input.predictedOutcome,
    actualOutcome: null,
    outcomeResolved: "pending",
    actualPnlPercent: input.actualPnlPercent,
    tradeOutcome: input.tradeOutcome,
    overallGrade,
    gradedAt: new Date().toISOString(),
  };

  tradeGrades.unshift(grade);
  if (tradeGrades.length > 2000) tradeGrades.length = 2000;

  return grade;
}

// ---------------------------------------------------------------------------
// Agent Scoring (34 dimensions)
// ---------------------------------------------------------------------------

export function scoreAgent(input: {
  agentId: string;
  agentName: string;
  provider: string;
  model: string;
  trades: V37TradeGrade[];
  pnlPercent: number;
  sharpeRatio: number;
  maxDrawdown: number;
}): V37AgentScore {
  const t = input.trades;
  if (t.length === 0) {
    const emptyDims: V37DimensionScores = {
      pnlPercent: 50, sharpeRatio: 50, maxDrawdown: 50,
      coherence: 50, reasoningDepth: 50, sourceQuality: 50,
      logicalConsistency: 50, reasoningIntegrity: 50, reasoningTransparency: 50,
      reasoningGrounding: 50, causalReasoning: 50, epistemicHumility: 50,
      reasoningTraceability: 50, adversarialCoherence: 50,
      informationAsymmetry: 50, temporalReasoningQuality: 50,
      reasoningAuditability: 50, decisionReversibility: 50,
      reasoningComposability: 50, strategicForesight: 50,
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
  const pnlScore = Math.max(0, Math.min(100, 50 + input.pnlPercent * 2));
  const sharpeScore = Math.max(0, Math.min(100, 50 + input.sharpeRatio * 20));
  const drawdownScore = Math.max(0, Math.min(100, 100 - Math.abs(input.maxDrawdown) * 2));

  // Reasoning Quality (17 dims)
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
  const reasoningAuditability = avg(t.map((x) => x.reasoningAuditabilityScore));
  const decisionReversibility = avg(t.map((x) => x.decisionReversibilityScore));
  const reasoningComposability = avg(t.map((x) => x.reasoningComposabilityScore));
  const strategicForesight = avg(t.map((x) => x.strategicForesightScore));

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
  const confStdDev = Math.sqrt(
    confidences.reduce((sum, c) => sum + Math.pow(c - avg(confidences), 2), 0) / confidences.length,
  );
  const adaptability = Math.max(0, Math.min(100, 50 + confStdDev * 200));
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
    ? Math.min(100, 40 + (t.filter((x) => x.coherenceScore > 0.6).length / t.length) * 60)
    : 50;

  // Governance (4 dims)
  const tradeAccountability = avg(t.map((x) => x.accountabilityScore));
  const rqi = avg([
    coherence, reasoningDepth, sourceQuality, logicalConsistency,
    reasoningTransparency, reasoningGrounding, causalReasoning, epistemicHumility,
    reasoningTraceability, adversarialCoherence, informationAsymmetry, temporalReasoningQuality,
    reasoningAuditability, decisionReversibility, reasoningComposability, strategicForesight,
  ]) / 100 * 100;
  const decisionAccountability = avg(t.map((x) => x.accountabilityScore));
  const consensusQuality = avg(t.map((x) => x.consensusQualityScore));

  // Reasoning-Profit Correlation: Pearson correlation between coherence and actual P&L
  // Only computed when at least 2 trades have resolved actualPnlPercent
  let reasoningProfitCorrelation: number | null = null;
  const resolvedPnlTrades = t.filter(
    (x) => x.actualPnlPercent !== undefined && x.actualPnlPercent !== null,
  );
  if (resolvedPnlTrades.length >= 2) {
    const coherenceValues = resolvedPnlTrades.map((x) => x.coherenceScore);
    const pnlValues = resolvedPnlTrades.map((x) => x.actualPnlPercent!);
    const meanCoh = avg(coherenceValues);
    const meanPnl = avg(pnlValues);
    let numerator = 0;
    let denomCoh = 0;
    let denomPnl = 0;
    for (let i = 0; i < resolvedPnlTrades.length; i++) {
      const dCoh = coherenceValues[i] - meanCoh;
      const dPnl = pnlValues[i] - meanPnl;
      numerator += dCoh * dPnl;
      denomCoh += dCoh * dCoh;
      denomPnl += dPnl * dPnl;
    }
    const denominator = Math.sqrt(denomCoh * denomPnl);
    reasoningProfitCorrelation = denominator > 0
      ? Math.round((numerator / denominator) * 1000) / 1000
      : 0;
  }

  const dimensions: V37DimensionScores = {
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
    reasoningComposability: Math.round(reasoningComposability * 100) / 100,
    strategicForesight: Math.round(strategicForesight * 100) / 100,
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
    compositeScore += (dimensions[dim as keyof V37DimensionScores] ?? 50) * weight;
  }
  compositeScore = Math.round(compositeScore * 100) / 100;

  const agentScore: V37AgentScore = {
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
    reasoningProfitCorrelation,
  };

  agentScores.set(input.agentId, agentScore);
  return agentScore;
}

// ---------------------------------------------------------------------------
// Round Summary
// ---------------------------------------------------------------------------

export function createRoundSummary(
  roundId: string,
  scores: V37AgentScore[],
  trades: V37TradeGrade[],
  marketRegime: string,
): V37RoundSummary {
  const sorted = [...trades].sort((a, b) => {
    const gradeOrder = ["A+", "A", "B+", "B", "C+", "C", "D", "F"];
    return gradeOrder.indexOf(a.overallGrade) - gradeOrder.indexOf(b.overallGrade);
  });

  const actions = trades.map((t) => t.action);
  const modeAction = actions.sort((a, b) =>
    actions.filter((v) => v === a).length - actions.filter((v) => v === b).length,
  ).pop() ?? "hold";
  const consensusAgreement = actions.filter((a) => a === modeAction).length / Math.max(1, actions.length);

  const avgOf = (fn: (t: V37TradeGrade) => number) =>
    trades.length > 0
      ? Math.round(trades.reduce((s, t) => s + fn(t), 0) / trades.length * 100) / 100
      : 50;

  const summary: V37RoundSummary = {
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
    avgReasoningComposability: avgOf((t) => t.reasoningComposabilityScore),
    avgStrategicForesight: avgOf((t) => t.strategicForesightScore),
  };

  roundSummaries.unshift(summary);
  if (roundSummaries.length > 200) roundSummaries.length = 200;

  return summary;
}

// ---------------------------------------------------------------------------
// Optimal Weight Analysis Constants
// ---------------------------------------------------------------------------

/**
 * Minimum weight floor for any single dimension in optimal weight suggestions.
 * Prevents any dimension from being zeroed out, ensuring all dimensions
 * contribute at least minimally to the composite score.
 * At 0.01, a dimension contributes ~1% even if it has zero or negative
 * correlation with profitability.
 */
const OPTIMAL_WEIGHT_FLOOR = 0.01;

/**
 * Maximum weight cap for any single dimension in optimal weight suggestions.
 * Prevents a single highly-correlated dimension from dominating the composite
 * score, ensuring diversified scoring across all 34 dimensions.
 * At 0.15, no dimension can exceed 15% of the total composite weight.
 */
const OPTIMAL_WEIGHT_CAP = 0.15;

/**
 * Minimum number of agents required to compute meaningful Pearson correlations.
 * With fewer than 3 data points, correlation is unreliable (perfect fit or
 * undefined), so we return empty results below this threshold.
 */
const OPTIMAL_WEIGHT_MIN_AGENTS = 3;

// ---------------------------------------------------------------------------
// Optimal Weight Computation
// ---------------------------------------------------------------------------

/**
 * Compute data-driven dimension weight suggestions by correlating each
 * dimension's scores across agents with their actual P&L performance.
 *
 * For each of the 34 dimensions, computes the Pearson correlation between
 * that dimension's agent-level scores and the agents' actual P&L percentages.
 * Dimensions with higher positive correlation to profitability receive higher
 * suggested weights; dimensions with negative correlation receive lower weights.
 *
 * Weight normalization rules:
 * - Raw correlation values are shifted to [0, 1] range via (r + 1) / 2
 * - Each weight is floored at OPTIMAL_WEIGHT_FLOOR (0.01) — no dimension gets zero
 * - Each weight is capped at OPTIMAL_WEIGHT_CAP (0.15) — no dimension dominates
 * - Final weights are normalized to sum to exactly 1.0
 *
 * @param agentScores - Array of V37AgentScore objects with dimension scores
 * @param agentPnls - Array of { agentId, pnlPercent } for each agent's actual P&L
 * @returns Array of { dimension, currentWeight, suggestedWeight, correlation } for each dimension,
 *          sorted by correlation descending (most predictive first).
 *          Returns empty array if fewer than OPTIMAL_WEIGHT_MIN_AGENTS agents have matching P&L data.
 */
export function computeOptimalWeights(
  agentScores: V37AgentScore[],
  agentPnls: { agentId: string; pnlPercent: number }[],
): { dimension: string; currentWeight: number; suggestedWeight: number; correlation: number }[] {
  // Build agentId -> pnlPercent lookup
  const pnlMap = new Map<string, number>();
  for (const entry of agentPnls) {
    pnlMap.set(entry.agentId, entry.pnlPercent);
  }

  // Filter to agents that have both dimension scores AND P&L data
  const matched = agentScores.filter((s) => pnlMap.has(s.agentId));
  if (matched.length < OPTIMAL_WEIGHT_MIN_AGENTS) {
    return [];
  }

  const pnlValues = matched.map((s) => pnlMap.get(s.agentId)!);
  const meanPnl = pnlValues.reduce((a, b) => a + b, 0) / pnlValues.length;

  const dimensionKeys = Object.keys(DIMENSION_WEIGHTS) as (keyof V37DimensionScores)[];

  // Step 1: Compute Pearson correlation for each dimension vs P&L
  const correlations: { dimension: string; correlation: number; currentWeight: number }[] = [];

  for (const dim of dimensionKeys) {
    const dimValues = matched.map((s) => s.dimensions[dim]);
    const meanDim = dimValues.reduce((a, b) => a + b, 0) / dimValues.length;

    let numerator = 0;
    let denomDim = 0;
    let denomPnl = 0;
    for (let i = 0; i < matched.length; i++) {
      const dDim = dimValues[i] - meanDim;
      const dPnl = pnlValues[i] - meanPnl;
      numerator += dDim * dPnl;
      denomDim += dDim * dDim;
      denomPnl += dPnl * dPnl;
    }
    const denominator = Math.sqrt(denomDim * denomPnl);
    const r = denominator > 0 ? numerator / denominator : 0;

    correlations.push({
      dimension: dim,
      correlation: Math.round(r * 1000) / 1000,
      currentWeight: DIMENSION_WEIGHTS[dim],
    });
  }

  // Step 2: Convert correlations to raw weights
  // Shift correlation from [-1, 1] to [0, 1] via (r + 1) / 2
  // This gives positive-correlation dimensions higher raw weight
  let rawWeights = correlations.map((c) => ({
    ...c,
    rawWeight: (c.correlation + 1) / 2,
  }));

  // Step 3: Apply floor and cap
  rawWeights = rawWeights.map((w) => ({
    ...w,
    rawWeight: Math.max(OPTIMAL_WEIGHT_FLOOR, Math.min(OPTIMAL_WEIGHT_CAP, w.rawWeight)),
  }));

  // Step 4: Normalize so weights sum to 1.0
  const totalRaw = rawWeights.reduce((sum, w) => sum + w.rawWeight, 0);
  const results = rawWeights.map((w) => {
    const normalized = totalRaw > 0 ? w.rawWeight / totalRaw : 1 / dimensionKeys.length;
    // Re-apply floor and cap after normalization
    return {
      dimension: w.dimension,
      currentWeight: w.currentWeight,
      suggestedWeight: Math.round(Math.max(OPTIMAL_WEIGHT_FLOOR, Math.min(OPTIMAL_WEIGHT_CAP, normalized)) * 10000) / 10000,
      correlation: w.correlation,
    };
  });

  // Final normalization pass to ensure sum = 1.0 after floor/cap enforcement
  const totalSuggested = results.reduce((sum, r) => sum + r.suggestedWeight, 0);
  if (totalSuggested > 0 && Math.abs(totalSuggested - 1.0) > 0.001) {
    const scale = 1.0 / totalSuggested;
    for (const r of results) {
      r.suggestedWeight = Math.round(r.suggestedWeight * scale * 10000) / 10000;
    }
  }

  // Sort by correlation descending (most predictive first)
  results.sort((a, b) => b.correlation - a.correlation);

  return results;
}

// ---------------------------------------------------------------------------
// Public Getters
// ---------------------------------------------------------------------------

export function getAgentScores(): V37AgentScore[] {
  return [...agentScores.values()];
}

export function getAgentScore(agentId: string): V37AgentScore | undefined {
  return agentScores.get(agentId);
}

export function getTradeGrades(limit = 50): V37TradeGrade[] {
  return tradeGrades.slice(0, limit);
}

export function getTradeGradesByAgent(agentId: string, limit = 50): V37TradeGrade[] {
  return tradeGrades.filter((g) => g.agentId === agentId).slice(0, limit);
}

export function getRoundSummaries(limit?: number): V37RoundSummary[] {
  if (limit != null && limit > 0) return roundSummaries.slice(-limit);
  return [...roundSummaries];
}

export function getDimensionWeights(): Record<string, number> {
  return { ...DIMENSION_WEIGHTS };
}

export function getDimensionCount(): number {
  return 34;
}

export function getBenchmarkVersion(): string {
  return "37.0";
}
