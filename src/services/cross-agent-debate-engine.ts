/**
 * Cross-Agent Reasoning Debate Engine (v19)
 *
 * Structures formal debates between AI agents when they disagree.
 * Unlike simple arbitration (who had better reasoning), debates
 * create a structured argument flow:
 *
 * 1. OPENING STATEMENTS — each agent's initial thesis
 * 2. REBUTTAL ANALYSIS — how each agent's reasoning responds to the other
 * 3. EVIDENCE CLASH — where do the agents cite conflicting data?
 * 4. LOGICAL CHAIN COMPARISON — whose cause-effect chain is stronger?
 * 5. VERDICT — structured scoring of the debate
 *
 * This is the "reasoning transparency" pillar — it makes agent
 * thinking adversarial and testable, not just passively scored.
 */

import { splitSentences, countWords, round2, round3, sortEntriesDescending, countWhere } from "../lib/math-utils.ts";
import { ID_RANDOM_START, ID_RANDOM_LENGTH_SHORT, REASONING_SNIPPET_LENGTH } from "../config/constants.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Rebuttal Strength Scoring
 *
 * Measures how well an agent's reasoning addresses opponent's claims.
 */

/** Base score for any rebuttal attempt (30%) */
const REBUTTAL_BASE_SCORE = 0.3;

/** Weight for addressing opponent's key claims/vocabulary (30% max) */
const REBUTTAL_ADDRESS_WEIGHT = 0.3;

/** Bonus for superior evidence (15% when more evidence than opponent) */
const REBUTTAL_EVIDENCE_BONUS_SUPERIOR = 0.15;

/** Bonus for any counter-evidence (8% when some evidence present) */
const REBUTTAL_EVIDENCE_BONUS_BASIC = 0.08;

/** Points per logical connector in rebuttal (4% each, 20% max) */
const REBUTTAL_CONNECTOR_POINTS = 0.04;

/** Maximum connector bonus (20%) */
const REBUTTAL_CONNECTOR_MAX = 0.2;

/**
 * Evidence Clash Detection
 *
 * Thresholds for detecting conflicting claims between agents.
 */

/** Price gap threshold for evidence clash (10% = agents citing different price points) */
const EVIDENCE_CLASH_PRICE_GAP_THRESHOLD = 0.1;

/**
 * Thesis Clarity Scoring
 *
 * Measures how clear and actionable the agent's opening thesis is.
 */

/** Points awarded when thesis contains actionable language (buy/sell/hold) */
const THESIS_CLARITY_ACTION_BONUS = 0.5;

/** Points awarded when thesis lacks actionable language */
const THESIS_CLARITY_NO_ACTION_PENALTY = 0.2;

/** Points awarded when thesis is optimal length (5-30 words) */
const THESIS_CLARITY_LENGTH_BONUS = 0.3;

/** Points awarded when thesis is too short/long */
const THESIS_CLARITY_LENGTH_PENALTY = 0.1;

/** Points awarded when supporting points exist */
const THESIS_CLARITY_SUPPORT_BONUS = 0.2;

/**
 * Evidence Quality Scoring
 *
 * Rewards quantitative grounding in supporting arguments.
 */

/** Points per supporting point with quantitative data ($X, Y%, P/E ratio) */
const EVIDENCE_QUALITY_QUANTITATIVE_POINTS = 0.2;

/** Points per supporting point with qualitative claims only */
const EVIDENCE_QUALITY_QUALITATIVE_POINTS = 0.08;

/**
 * Logical Strength Scoring
 *
 * Measures causal reasoning structure.
 */

/** Base logical strength score (20%) */
const LOGICAL_STRENGTH_BASE = 0.2;

/** Points per causal connector (because, therefore, thus, etc.) */
const LOGICAL_STRENGTH_CONNECTOR_POINTS = 0.1;

/**
 * Intellectual Honesty Scoring
 *
 * Assesses whether agent acknowledges uncertainty appropriately.
 * Too much hedging = weak conviction, too little = overconfidence.
 */

/** Score when hedge rate is in optimal range (0.02-0.05) - base */
const INTELLECTUAL_HONESTY_OPTIMAL_BASE = 0.7;

/** Maximum bonus in optimal range (30%) */
const INTELLECTUAL_HONESTY_OPTIMAL_MAX_BONUS = 0.3;

/** Multiplier for hedge rate bonus in optimal range */
const INTELLECTUAL_HONESTY_OPTIMAL_MULTIPLIER = 10;

/** Lower bound for optimal hedge rate (2% of words) */
const INTELLECTUAL_HONESTY_HEDGE_RATE_MIN = 0.01;

/** Upper bound for optimal hedge rate (6% of words) */
const INTELLECTUAL_HONESTY_HEDGE_RATE_MAX = 0.06;

/** Score when hedge rate exceeds upper bound - base before penalty */
const INTELLECTUAL_HONESTY_EXCESSIVE_BASE = 0.7;

/** Minimum score floor when excessive hedging (30%) */
const INTELLECTUAL_HONESTY_EXCESSIVE_MIN = 0.3;

/** Penalty multiplier for excessive hedging (per % over 0.06) */
const INTELLECTUAL_HONESTY_EXCESSIVE_PENALTY_MULTIPLIER = 10;

/** Score when hedge rate is below minimum - base */
const INTELLECTUAL_HONESTY_LOW_BASE = 0.3;

/** Bonus multiplier when hedge rate is below minimum (less hedging = slightly better) */
const INTELLECTUAL_HONESTY_LOW_BONUS_MULTIPLIER = 20;

/**
 * Composite Debate Score Weights
 *
 * How much each dimension contributes to overall debate winner determination.
 */

/** Weight for thesis clarity (15%) */
const COMPOSITE_WEIGHT_THESIS_CLARITY = 0.15;

/** Weight for evidence quality (30% - highest, most objective) */
const COMPOSITE_WEIGHT_EVIDENCE_QUALITY = 0.30;

/** Weight for logical strength (25% - second highest) */
const COMPOSITE_WEIGHT_LOGICAL_STRENGTH = 0.25;

/** Weight for rebuttal power (15%) */
const COMPOSITE_WEIGHT_REBUTTAL_POWER = 0.15;

/** Weight for intellectual honesty (15%) */
const COMPOSITE_WEIGHT_INTELLECTUAL_HONESTY = 0.15;

/**
 * Debate Verdict Classification
 *
 * Thresholds for determining debate outcome (win/loss/tie).
 */

/** Composite score margin for tie classification (within 3%) */
const DEBATE_TIE_MARGIN = 0.03;

/**
 * Logical Chain Comparison
 *
 * Weights for comparing causal reasoning chains between agents.
 */

/** Weight for causal claim count (40%) */
const LOGICAL_CHAIN_WEIGHT_CAUSAL = 0.4;

/** Weight for connector density (30%) */
const LOGICAL_CHAIN_WEIGHT_DENSITY = 0.3;

/** Weight for sentence/chain length (30%) */
const LOGICAL_CHAIN_WEIGHT_LENGTH = 0.3;

/** Multiplier for connector density (converts to 0-100 scale) */
const LOGICAL_CHAIN_DENSITY_MULTIPLIER = 100;

/** Minimum difference to classify one chain as stronger (1 point) */
const LOGICAL_CHAIN_STRENGTH_THRESHOLD = 1;

/**
 * Debate Quality Scoring
 *
 * Measures how substantive/valuable the debate was overall.
 */

/** Weight for average participant composite scores (40% of quality) */
const DEBATE_QUALITY_WEIGHT_COMPOSITE = 0.4;

/** Weight for evidence clashes (30% of quality) */
const DEBATE_QUALITY_WEIGHT_CLASHES = 0.3;

/** Points per evidence clash (20% per clash, capped at 1.0) */
const DEBATE_QUALITY_CLASH_POINTS = 0.2;

/** Score when many causal claims (>4 total between agents) - high-quality debate */
const DEBATE_QUALITY_SCORE_HIGH_CAUSAL = 0.3;

/** Score when few causal claims (≤4 total) - lower-quality debate */
const DEBATE_QUALITY_SCORE_LOW_CAUSAL = 0.15;

/** Threshold for classifying debate as high-quality (>4 causal claims total) */
const DEBATE_QUALITY_CAUSAL_THRESHOLD = 4;

/**
 * Profile Aggregation Weights
 *
 * How debate performance translates to overall agent "debate pillar" score.
 */

/** Weight for win rate (30%) */
const PROFILE_WEIGHT_WIN_RATE = 0.30;

/** Weight for average debate score (30%) */
const PROFILE_WEIGHT_AVG_SCORE = 0.30;

/** Weight for rebuttal win rate (20%) */
const PROFILE_WEIGHT_REBUTTAL = 0.20;

/** Weight for average debate quality (20%) */
const PROFILE_WEIGHT_QUALITY = 0.20;

/**
 * Thesis Extraction Parameters
 *
 * Controls how thesis statements are identified from reasoning text.
 */

/** Minimum sentence length for thesis extraction (characters) */
const THESIS_EXTRACTION_MIN_SENTENCE_LENGTH = 10;

/** Maximum number of sentences to search for actionable thesis (first N sentences) */
const THESIS_EXTRACTION_MAX_SEARCH_SENTENCES = 3;

/**
 * Supporting Points Extraction
 *
 * Controls how supporting evidence is identified from reasoning.
 */

/** Minimum sentence length for supporting points extraction (characters) */
const SUPPORTING_POINTS_MIN_SENTENCE_LENGTH = 15;

/** Maximum number of supporting points to extract and score */
const SUPPORTING_POINTS_MAX_COUNT = 5;

/**
 * Weakness Detection Thresholds
 *
 * Parameters for identifying reasoning weaknesses (excessive hedging, lack of quantification).
 */

/** Hedge word count threshold for flagging excessive hedging */
const WEAKNESS_HEDGE_COUNT_THRESHOLD = 3;

/** Word count threshold below which hedge rate is considered problematic */
const WEAKNESS_WORD_COUNT_THRESHOLD = 100;

/**
 * Thesis Word Count Validation
 *
 * Optimal thesis length range for clarity scoring.
 */

/** Minimum thesis word count for clarity bonus (too short = vague) */
const THESIS_WORD_COUNT_MIN = 5;

/** Maximum thesis word count for clarity bonus (too long = unfocused) */
const THESIS_WORD_COUNT_MAX = 30;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DebateRound {
  debateId: string;
  roundId: string;
  symbol: string;
  topic: string;
  participants: DebateParticipant[];
  evidenceClashes: EvidenceClash[];
  logicalChainAnalysis: LogicalChainResult;
  verdict: DebateVerdict;
  debateQualityScore: number;
  timestamp: string;
}

export interface DebateParticipant {
  agentId: string;
  action: string;
  reasoning: string;
  confidence: number;
  thesisStatement: string;
  supportingPoints: string[];
  weaknesses: string[];
  rebuttalStrength: number;
}

export interface EvidenceClash {
  dimension: string;
  agentAClaim: string;
  agentBClaim: string;
  clashType: "contradiction" | "interpretation_diff" | "data_gap" | "emphasis_diff";
  winner: string | "unresolved";
  explanation: string;
}

export interface LogicalChainResult {
  agentAChainLength: number;
  agentBChainLength: number;
  agentAConnectorDensity: number;
  agentBConnectorDensity: number;
  agentACausalClaims: number;
  agentBCausalClaims: number;
  strongerChain: string | "equal";
}

export interface DebateVerdict {
  winner: string | "tie";
  scores: Record<string, DebateScore>;
  margin: number;
  keyFactor: string;
  narrative: string;
}

export interface DebateScore {
  thesisClarity: number;
  evidenceQuality: number;
  logicalStrength: number;
  rebuttalPower: number;
  intellectualHonesty: number;
  composite: number;
}

export interface AgentDebateProfile {
  agentId: string;
  totalDebates: number;
  wins: number;
  losses: number;
  ties: number;
  winRate: number;
  avgScore: number;
  bestDimension: string;
  worstDimension: string;
  avgDebateQuality: number;
  rebuttalWinRate: number;
  evidenceClashWinRate: number;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const debates: DebateRound[] = [];
const MAX_DEBATES = 1500;

// ---------------------------------------------------------------------------
// NLP Helpers
// ---------------------------------------------------------------------------

function extractThesis(reasoning: string): string {
  const sentences = splitSentences(reasoning, THESIS_EXTRACTION_MIN_SENTENCE_LENGTH);
  if (sentences.length === 0) return reasoning.slice(0, REASONING_SNIPPET_LENGTH);

  // The thesis is usually the first actionable sentence
  for (const s of sentences.slice(0, THESIS_EXTRACTION_MAX_SEARCH_SENTENCES)) {
    if (/should|recommend|bullish|bearish|buy|sell|hold|position|undervalued|overvalued/i.test(s)) {
      return s.trim();
    }
  }
  return sentences[0].trim();
}

function extractSupportingPoints(reasoning: string): string[] {
  const points: string[] = [];
  const sentences = splitSentences(reasoning, SUPPORTING_POINTS_MIN_SENTENCE_LENGTH);

  for (const s of sentences) {
    if (/because|due\s+to|driven\s+by|supported\s+by|evidence|data\s+shows/i.test(s)) {
      points.push(s.trim());
    }
  }

  if (points.length === 0) {
    // Fall back to sentences with quantitative claims
    for (const s of sentences) {
      if (/\$[\d,]+|\d+%|\d+\.\d+/i.test(s)) {
        points.push(s.trim());
      }
    }
  }

  return points.slice(0, SUPPORTING_POINTS_MAX_COUNT);
}

function extractWeaknesses(reasoning: string): string[] {
  const weaknesses: string[] = [];

  // Check for hedging without substance
  const hedgeCount = (reasoning.match(/\b(perhaps|maybe|might|possibly|could be)\b/gi) ?? []).length;
  const wordCount = countWords(reasoning);
  if (hedgeCount > WEAKNESS_HEDGE_COUNT_THRESHOLD && wordCount < WEAKNESS_WORD_COUNT_THRESHOLD) {
    weaknesses.push("Excessive hedging relative to reasoning length");
  }

  // Check for lack of specificity
  if (!/\$[\d,]+|\d+\.?\d*%/.test(reasoning)) {
    weaknesses.push("No quantitative claims — reasoning is entirely qualitative");
  }

  // Check for circular reasoning
  if (/\bbuy\b.*\bbecause\b.*\bundervalued\b.*\bbuy\b/i.test(reasoning)) {
    weaknesses.push("Potential circular reasoning detected");
  }

  // Check for missing risk acknowledgment
  if (!/risk|downside|cautio|danger|concern|worry|threat/i.test(reasoning)) {
    weaknesses.push("No risk factors acknowledged");
  }

  // Check for templated language
  if (/based on current market conditions|in the current market environment/i.test(reasoning)) {
    weaknesses.push("Templated/boilerplate language detected");
  }

  return weaknesses;
}

function computeRebuttalStrength(ownReasoning: string, opponentReasoning: string): number {
  const ownLower = ownReasoning.toLowerCase();
  const oppLower = opponentReasoning.toLowerCase();

  let score = REBUTTAL_BASE_SCORE;

  // Does agent address the opponent's key claims?
  const oppKeywords = oppLower.match(/\b\w{5,}\b/g) ?? [];
  const oppUniqueWords = new Set(oppKeywords);
  const addressedCount = [...oppUniqueWords].filter(w => ownLower.includes(w)).length;
  const addressRate = oppUniqueWords.size > 0 ? addressedCount / oppUniqueWords.size : 0;
  score += addressRate * REBUTTAL_ADDRESS_WEIGHT;

  // Does agent counter with different evidence?
  const ownEvidence = (ownLower.match(/\$[\d,]+|\d+%|P\/E|RSI|MACD|volume/gi) ?? []).length;
  const oppEvidence = (oppLower.match(/\$[\d,]+|\d+%|P\/E|RSI|MACD|volume/gi) ?? []).length;
  if (ownEvidence > oppEvidence) score += REBUTTAL_EVIDENCE_BONUS_SUPERIOR;
  else if (ownEvidence > 0) score += REBUTTAL_EVIDENCE_BONUS_BASIC;

  // Logical connectors = stronger argumentation
  const connectors = (ownLower.match(/\bbecause|therefore|however|nevertheless|despite|although\b/g) ?? []).length;
  score += Math.min(REBUTTAL_CONNECTOR_MAX, connectors * REBUTTAL_CONNECTOR_POINTS);

  return Math.min(1, round2(score));
}

// ---------------------------------------------------------------------------
// Evidence Clash Detection
// ---------------------------------------------------------------------------

function detectEvidenceClashes(
  reasoningA: string,
  reasoningB: string,
  agentA: string,
  agentB: string,
): EvidenceClash[] {
  const clashes: EvidenceClash[] = [];

  // Sentiment clash
  const aBullish = /bullish|upside|growth|undervalued|buy/i.test(reasoningA);
  const aBearish = /bearish|downside|decline|overvalued|sell/i.test(reasoningA);
  const bBullish = /bullish|upside|growth|undervalued|buy/i.test(reasoningB);
  const bBearish = /bearish|downside|decline|overvalued|sell/i.test(reasoningB);

  if ((aBullish && bBearish) || (aBearish && bBullish)) {
    clashes.push({
      dimension: "directional_sentiment",
      agentAClaim: aBullish ? "Bullish outlook" : "Bearish outlook",
      agentBClaim: bBullish ? "Bullish outlook" : "Bearish outlook",
      clashType: "contradiction",
      winner: "unresolved",
      explanation: "Agents hold opposite directional views on the same stock at the same time",
    });
  }

  // Price interpretation clash
  const aPriceMatch = reasoningA.match(/\$(\d+\.?\d*)/);
  const bPriceMatch = reasoningB.match(/\$(\d+\.?\d*)/);
  if (aPriceMatch && bPriceMatch) {
    const aPrice = parseFloat(aPriceMatch[1]);
    const bPrice = parseFloat(bPriceMatch[1]);
    if (Math.abs(aPrice - bPrice) / Math.max(aPrice, bPrice) > EVIDENCE_CLASH_PRICE_GAP_THRESHOLD) {
      clashes.push({
        dimension: "price_reference",
        agentAClaim: `$${aPrice}`,
        agentBClaim: `$${bPrice}`,
        clashType: "data_gap",
        winner: "unresolved",
        explanation: `Agents reference different price points (>${(EVIDENCE_CLASH_PRICE_GAP_THRESHOLD * 100).toFixed(0)}% gap)`,
      });
    }
  }

  // Risk assessment clash
  const aHighRisk = /high\s+risk|risky|dangerous|volatile/i.test(reasoningA);
  const aLowRisk = /low\s+risk|safe|stable|minimal\s+risk/i.test(reasoningA);
  const bHighRisk = /high\s+risk|risky|dangerous|volatile/i.test(reasoningB);
  const bLowRisk = /low\s+risk|safe|stable|minimal\s+risk/i.test(reasoningB);

  if ((aHighRisk && bLowRisk) || (aLowRisk && bHighRisk)) {
    clashes.push({
      dimension: "risk_assessment",
      agentAClaim: aHighRisk ? "High risk" : "Low risk",
      agentBClaim: bHighRisk ? "High risk" : "Low risk",
      clashType: "interpretation_diff",
      winner: "unresolved",
      explanation: "Agents disagree on risk level for the same asset",
    });
  }

  // Technical vs Fundamental emphasis
  const aTech = /RSI|MACD|SMA|support|resistance|breakout|moving\s+average/i.test(reasoningA);
  const aFund = /P\/E|earnings|revenue|margin|growth\s+rate|fundamentals/i.test(reasoningA);
  const bTech = /RSI|MACD|SMA|support|resistance|breakout|moving\s+average/i.test(reasoningB);
  const bFund = /P\/E|earnings|revenue|margin|growth\s+rate|fundamentals/i.test(reasoningB);

  if ((aTech && !aFund && bFund && !bTech) || (aFund && !aTech && bTech && !bFund)) {
    clashes.push({
      dimension: "analytical_framework",
      agentAClaim: aTech ? "Technical analysis" : "Fundamental analysis",
      agentBClaim: bTech ? "Technical analysis" : "Fundamental analysis",
      clashType: "emphasis_diff",
      winner: "unresolved",
      explanation: "Agents use different analytical frameworks to reach conclusions",
    });
  }

  return clashes;
}

// ---------------------------------------------------------------------------
// Logical Chain Analysis
// ---------------------------------------------------------------------------

const CAUSAL_CONNECTORS = [
  /\bbecause\b/gi, /\btherefore\b/gi, /\bthus\b/gi,
  /\bhence\b/gi, /\bconsequently\b/gi, /\bas\s+a\s+result\b/gi,
  /\bdue\s+to\b/gi, /\bleading\s+to\b/gi, /\bdriven\s+by\b/gi,
  /\bif\b.{5,30}\bthen\b/gi, /\bgiven\s+that\b/gi,
  /\bsince\b/gi, /\bimplying\b/gi,
];

function analyzeLogicalChain(
  reasoningA: string,
  reasoningB: string,
): LogicalChainResult {
  const sentencesA = splitSentences(reasoningA, THESIS_EXTRACTION_MIN_SENTENCE_LENGTH);
  const sentencesB = splitSentences(reasoningB, THESIS_EXTRACTION_MIN_SENTENCE_LENGTH);

  let connectorsA = 0;
  let connectorsB = 0;
  let causalA = 0;
  let causalB = 0;

  for (const pattern of CAUSAL_CONNECTORS) {
    const matchesA = reasoningA.match(pattern);
    const matchesB = reasoningB.match(pattern);
    if (matchesA) {
      connectorsA += matchesA.length;
      causalA += matchesA.length;
    }
    if (matchesB) {
      connectorsB += matchesB.length;
      causalB += matchesB.length;
    }
  }

  const wordsA = countWords(reasoningA) || 1;
  const wordsB = countWords(reasoningB) || 1;

  const densityA = round3(connectorsA / wordsA);
  const densityB = round3(connectorsB / wordsB);

  let stronger: string | "equal" = "equal";
  const scoreA = causalA * LOGICAL_CHAIN_WEIGHT_CAUSAL +
                 densityA * LOGICAL_CHAIN_DENSITY_MULTIPLIER * LOGICAL_CHAIN_WEIGHT_DENSITY +
                 sentencesA.length * LOGICAL_CHAIN_WEIGHT_LENGTH;
  const scoreB = causalB * LOGICAL_CHAIN_WEIGHT_CAUSAL +
                 densityB * LOGICAL_CHAIN_DENSITY_MULTIPLIER * LOGICAL_CHAIN_WEIGHT_DENSITY +
                 sentencesB.length * LOGICAL_CHAIN_WEIGHT_LENGTH;
  if (Math.abs(scoreA - scoreB) > LOGICAL_CHAIN_STRENGTH_THRESHOLD) {
    stronger = scoreA > scoreB ? "agentA" : "agentB";
  }

  return {
    agentAChainLength: sentencesA.length,
    agentBChainLength: sentencesB.length,
    agentAConnectorDensity: densityA,
    agentBConnectorDensity: densityB,
    agentACausalClaims: causalA,
    agentBCausalClaims: causalB,
    strongerChain: stronger,
  };
}

// ---------------------------------------------------------------------------
// Core Debate Engine
// ---------------------------------------------------------------------------

function scoreDebateParticipant(
  participant: DebateParticipant,
  opponent: DebateParticipant,
): DebateScore {
  // Thesis clarity: how clear and direct is the opening thesis?
  const thesisWords = countWords(participant.thesisStatement);
  const thesisHasAction = /buy|sell|hold|bullish|bearish/i.test(participant.thesisStatement);
  const thesisClarity = Math.min(1,
    (thesisHasAction ? THESIS_CLARITY_ACTION_BONUS : THESIS_CLARITY_NO_ACTION_PENALTY) +
    (thesisWords > THESIS_WORD_COUNT_MIN && thesisWords < THESIS_WORD_COUNT_MAX ? THESIS_CLARITY_LENGTH_BONUS : THESIS_CLARITY_LENGTH_PENALTY) +
    (participant.supportingPoints.length > 0 ? THESIS_CLARITY_SUPPORT_BONUS : 0)
  );

  // Evidence quality: supporting points with quantitative data
  let evidenceQuality = 0;
  for (const point of participant.supportingPoints) {
    if (/\$[\d,]+|\d+%|P\/E|\d+\.\d+/i.test(point)) evidenceQuality += EVIDENCE_QUALITY_QUANTITATIVE_POINTS;
    else evidenceQuality += EVIDENCE_QUALITY_QUALITATIVE_POINTS;
  }
  evidenceQuality = Math.min(1, evidenceQuality);

  // Logical strength: causal connectors, structure
  const connectorCount = (participant.reasoning.match(
    /because|therefore|thus|hence|consequently|due to|leading to|given that|since/gi
  ) ?? []).length;
  const logicalStrength = Math.min(1, LOGICAL_STRENGTH_BASE + connectorCount * LOGICAL_STRENGTH_CONNECTOR_POINTS);

  // Rebuttal power: how well does the reasoning address opponent's claims
  const rebuttalPower = participant.rebuttalStrength;

  // Intellectual honesty: acknowledges uncertainty and weaknesses
  const hedges = (participant.reasoning.match(/perhaps|maybe|might|uncertain|unclear|risk|however/gi) ?? []).length;
  const totalWords = countWords(participant.reasoning);
  const hedgeRate = totalWords > 0 ? hedges / totalWords : 0;
  // Sweet spot: some hedging is good (0.01-0.06), too much is bad
  const intellectualHonesty = hedgeRate > INTELLECTUAL_HONESTY_HEDGE_RATE_MIN && hedgeRate < INTELLECTUAL_HONESTY_HEDGE_RATE_MAX
    ? INTELLECTUAL_HONESTY_OPTIMAL_BASE + Math.min(INTELLECTUAL_HONESTY_OPTIMAL_MAX_BONUS, hedgeRate * INTELLECTUAL_HONESTY_OPTIMAL_MULTIPLIER)
    : hedgeRate > INTELLECTUAL_HONESTY_HEDGE_RATE_MAX
      ? Math.max(INTELLECTUAL_HONESTY_EXCESSIVE_MIN, INTELLECTUAL_HONESTY_EXCESSIVE_BASE - (hedgeRate - INTELLECTUAL_HONESTY_HEDGE_RATE_MAX) * INTELLECTUAL_HONESTY_EXCESSIVE_PENALTY_MULTIPLIER)
      : INTELLECTUAL_HONESTY_LOW_BASE + hedgeRate * INTELLECTUAL_HONESTY_LOW_BONUS_MULTIPLIER;

  const composite = round2(
    thesisClarity * COMPOSITE_WEIGHT_THESIS_CLARITY +
    evidenceQuality * COMPOSITE_WEIGHT_EVIDENCE_QUALITY +
    logicalStrength * COMPOSITE_WEIGHT_LOGICAL_STRENGTH +
    rebuttalPower * COMPOSITE_WEIGHT_REBUTTAL_POWER +
    intellectualHonesty * COMPOSITE_WEIGHT_INTELLECTUAL_HONESTY,
  );

  return {
    thesisClarity: round2(thesisClarity),
    evidenceQuality: round2(evidenceQuality),
    logicalStrength: round2(logicalStrength),
    rebuttalPower: round2(rebuttalPower),
    intellectualHonesty: round2(Math.min(1, intellectualHonesty)),
    composite,
  };
}

/**
 * Conduct a structured debate between two agents.
 */
export function conductDebate(
  roundId: string,
  symbol: string,
  agentA: string,
  agentB: string,
  actionA: string,
  actionB: string,
  reasoningA: string,
  reasoningB: string,
  confidenceA: number,
  confidenceB: number,
): DebateRound {
  // Build participant profiles
  const participantA: DebateParticipant = {
    agentId: agentA,
    action: actionA,
    reasoning: reasoningA,
    confidence: confidenceA,
    thesisStatement: extractThesis(reasoningA),
    supportingPoints: extractSupportingPoints(reasoningA),
    weaknesses: extractWeaknesses(reasoningA),
    rebuttalStrength: computeRebuttalStrength(reasoningA, reasoningB),
  };

  const participantB: DebateParticipant = {
    agentId: agentB,
    action: actionB,
    reasoning: reasoningB,
    confidence: confidenceB,
    thesisStatement: extractThesis(reasoningB),
    supportingPoints: extractSupportingPoints(reasoningB),
    weaknesses: extractWeaknesses(reasoningB),
    rebuttalStrength: computeRebuttalStrength(reasoningB, reasoningA),
  };

  // Analyze evidence clashes
  const evidenceClashes = detectEvidenceClashes(reasoningA, reasoningB, agentA, agentB);

  // Analyze logical chains
  const logicalChainAnalysis = analyzeLogicalChain(reasoningA, reasoningB);

  // Score each participant
  const scoreA = scoreDebateParticipant(participantA, participantB);
  const scoreB = scoreDebateParticipant(participantB, participantA);

  // Determine verdict
  const diff = scoreA.composite - scoreB.composite;
  const margin = Math.abs(diff);
  const winner = margin < DEBATE_TIE_MARGIN ? "tie" : (diff > 0 ? agentA : agentB);

  // Find key differentiating factor
  const dimensionDiffs: [string, number][] = [
    ["thesis clarity", scoreA.thesisClarity - scoreB.thesisClarity],
    ["evidence quality", scoreA.evidenceQuality - scoreB.evidenceQuality],
    ["logical strength", scoreA.logicalStrength - scoreB.logicalStrength],
    ["rebuttal power", scoreA.rebuttalPower - scoreB.rebuttalPower],
    ["intellectual honesty", scoreA.intellectualHonesty - scoreB.intellectualHonesty],
  ];
  dimensionDiffs.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const keyFactor = dimensionDiffs[0][0];

  // Generate narrative
  let narrative: string;
  if (winner === "tie") {
    narrative = `Closely contested debate on ${symbol}. Both agents presented comparable reasoning quality. `;
    narrative += `Key battleground: ${keyFactor}. Evidence clashes: ${evidenceClashes.length}. `;
    narrative += `Logical chains: ${logicalChainAnalysis.strongerChain === "equal" ? "equivalent" : `${logicalChainAnalysis.strongerChain} leads`}.`;
  } else {
    narrative = `${winner} wins the ${symbol} debate by ${(margin * 100).toFixed(1)}% margin. `;
    narrative += `Decisive factor: ${keyFactor}. `;
    if (evidenceClashes.length > 0) {
      narrative += `${evidenceClashes.length} evidence clash(es) identified. `;
    }
    const winnerWeaknesses = winner === agentA ? participantA.weaknesses : participantB.weaknesses;
    if (winnerWeaknesses.length > 0) {
      narrative += `Winner's weakness: ${winnerWeaknesses[0]}.`;
    }
  }

  // Debate quality = how substantive was this debate?
  const debateQualityScore = round2(Math.min(1,
    (scoreA.composite + scoreB.composite) / 2 * DEBATE_QUALITY_WEIGHT_COMPOSITE +
    Math.min(1, evidenceClashes.length * DEBATE_QUALITY_CLASH_POINTS) * DEBATE_QUALITY_WEIGHT_CLASHES +
    (logicalChainAnalysis.agentACausalClaims + logicalChainAnalysis.agentBCausalClaims > DEBATE_QUALITY_CAUSAL_THRESHOLD ? DEBATE_QUALITY_SCORE_HIGH_CAUSAL : DEBATE_QUALITY_SCORE_LOW_CAUSAL),
  ));

  const debate: DebateRound = {
    debateId: `debate_${Date.now()}_${Math.random().toString(36).slice(ID_RANDOM_START, ID_RANDOM_START + ID_RANDOM_LENGTH_SHORT)}`,
    roundId,
    symbol,
    topic: `Should agents ${actionA === actionB ? actionA : `${actionA} vs ${actionB}`} ${symbol}?`,
    participants: [participantA, participantB],
    evidenceClashes,
    logicalChainAnalysis,
    verdict: {
      winner,
      scores: { [agentA]: scoreA, [agentB]: scoreB },
      margin: round2(margin),
      keyFactor,
      narrative,
    },
    debateQualityScore,
    timestamp: new Date().toISOString(),
  };

  debates.unshift(debate);
  if (debates.length > MAX_DEBATES) debates.length = MAX_DEBATES;

  return debate;
}

// ---------------------------------------------------------------------------
// Profile Aggregation
// ---------------------------------------------------------------------------

export function getAgentDebateProfile(agentId: string): AgentDebateProfile {
  const agentDebates = debates.filter(d =>
    d.participants.some(p => p.agentId === agentId),
  );

  let wins = 0, losses = 0, ties = 0;
  let scoreSum = 0;
  let qualitySum = 0;
  let rebuttalWins = 0;
  let rebuttalTotal = 0;
  let evidenceWins = 0;
  let evidenceTotal = 0;
  const dimensionSums: Record<string, number> = {
    thesisClarity: 0, evidenceQuality: 0, logicalStrength: 0,
    rebuttalPower: 0, intellectualHonesty: 0,
  };

  for (const d of agentDebates) {
    const score = d.verdict.scores[agentId];
    if (!score) continue;

    scoreSum += score.composite;
    qualitySum += d.debateQualityScore;

    if (d.verdict.winner === "tie") ties++;
    else if (d.verdict.winner === agentId) wins++;
    else losses++;

    for (const dim of Object.keys(dimensionSums)) {
      dimensionSums[dim] += score[dim as keyof DebateScore] as number;
    }

    // Rebuttal comparison
    const participants = d.participants;
    const self = participants.find(p => p.agentId === agentId);
    const opp = participants.find(p => p.agentId !== agentId);
    if (self && opp) {
      rebuttalTotal++;
      if (self.rebuttalStrength > opp.rebuttalStrength) rebuttalWins++;
    }

    // Evidence clash wins
    for (const clash of d.evidenceClashes) {
      evidenceTotal++;
      if (clash.winner === agentId) evidenceWins++;
    }
  }

  const total = agentDebates.length || 1;
  const avgDims: Record<string, number> = {};
  for (const [dim, sum] of Object.entries(dimensionSums)) {
    avgDims[dim] = round2(sum / total);
  }

  const sortedDims = sortEntriesDescending(avgDims);

  return {
    agentId,
    totalDebates: agentDebates.length,
    wins,
    losses,
    ties,
    winRate: agentDebates.length > 0 ? round2(wins / agentDebates.length) : 0,
    avgScore: round2(scoreSum / total),
    bestDimension: sortedDims[0]?.[0] ?? "none",
    worstDimension: sortedDims[sortedDims.length - 1]?.[0] ?? "none",
    avgDebateQuality: round2(qualitySum / total),
    rebuttalWinRate: rebuttalTotal > 0 ? round2(rebuttalWins / rebuttalTotal) : 0,
    evidenceClashWinRate: evidenceTotal > 0 ? round2(evidenceWins / evidenceTotal) : 0,
  };
}

export function getAllDebateProfiles(): AgentDebateProfile[] {
  const agentIds = new Set<string>();
  for (const d of debates) {
    for (const p of d.participants) agentIds.add(p.agentId);
  }
  return [...agentIds].map(getAgentDebateProfile);
}

export function getRecentDebates(limit: number = 20): DebateRound[] {
  return debates.slice(0, limit);
}

export function getDebateById(debateId: string): DebateRound | undefined {
  return debates.find(d => d.debateId === debateId);
}

export function getDebatePillarScore(agentId: string): number {
  const profile = getAgentDebateProfile(agentId);
  if (profile.totalDebates === 0) return 0.5;

  return round2(
    profile.winRate * PROFILE_WEIGHT_WIN_RATE +
    profile.avgScore * PROFILE_WEIGHT_AVG_SCORE +
    profile.rebuttalWinRate * PROFILE_WEIGHT_REBUTTAL +
    profile.avgDebateQuality * PROFILE_WEIGHT_QUALITY,
  );
}

export function getDebateStats(): {
  totalDebates: number;
  avgQuality: number;
  avgMargin: number;
  tieRate: number;
  totalEvidenceClashes: number;
} {
  const totalClashes = debates.reduce((s, d) => s + d.evidenceClashes.length, 0);
  const qualitySum = debates.reduce((s, d) => s + d.debateQualityScore, 0);
  const marginSum = debates.reduce((s, d) => s + d.verdict.margin, 0);
  const ties = countWhere(debates, d => d.verdict.winner === "tie");

  return {
    totalDebates: debates.length,
    avgQuality: debates.length > 0 ? round2(qualitySum / debates.length) : 0,
    avgMargin: debates.length > 0 ? round2(marginSum / debates.length) : 0,
    tieRate: debates.length > 0 ? round2(ties / debates.length) : 0,
    totalEvidenceClashes: totalClashes,
  };
}
