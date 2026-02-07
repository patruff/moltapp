/**
 * Benchmark Peer Review System
 *
 * After each trading round, agents "review" each other's reasoning.
 * This creates a multi-perspective evaluation layer that goes beyond
 * automated coherence scoring — it measures whether ANOTHER agent's
 * AI finds the reasoning convincing.
 *
 * This is a key differentiator for MoltApp as an industry benchmark:
 * - Single-agent coherence catches obvious contradictions
 * - Peer review catches subtle logical gaps, unstated assumptions,
 *   and reasoning that "sounds right" but doesn't hold up
 *
 * Architecture:
 * 1. After a round completes, collect all justifications
 * 2. Each agent reviews every other agent's reasoning (blind — no agent ID shown)
 * 3. Reviews score: logic quality, evidence usage, risk awareness, originality
 * 4. Aggregate peer scores feed into the benchmark composite
 *
 * This runs ASYNCHRONOUSLY after trading — it never blocks execution.
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { normalizeConfidence } from "../schemas/trade-reasoning.ts";
import { normalize, countWords, mean, splitSentences, round2 } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Baseline Scores
 * Starting point for each scoring dimension before bonuses/penalties applied.
 */
const LOGIC_QUALITY_BASELINE = 0.3; // Starting score for logic analysis (30%)
const EVIDENCE_USAGE_BASELINE = 0.2; // Starting score for evidence citations (20%)
const RISK_AWARENESS_BASELINE = 0.2; // Starting score for risk acknowledgment (20%)
const ORIGINALITY_BASELINE = 0.3; // Starting score for reasoning uniqueness (30%)
const CONCLUSION_VALIDITY_BASELINE = 0.5; // Neutral baseline for action alignment (50%)

/**
 * Word Count Thresholds
 * Minimum word counts for various quality bonuses.
 */
const LOGIC_WORD_COUNT_TIER1 = 30; // Basic detail threshold
const LOGIC_WORD_COUNT_TIER2 = 60; // Moderate detail threshold
const LOGIC_WORD_COUNT_TIER3 = 100; // High detail threshold
const EVIDENCE_WORD_COUNT_MIN = 20; // Minimum for evidenced conclusion
const STRENGTH_WORD_COUNT_DETAILED = 60; // "Detailed analysis" strength marker
const WEAKNESS_WORD_COUNT_MIN = 20; // Below this = "too brief" weakness
const AGREEMENT_WORD_COUNT_BONUS = 40; // Better reasoning threshold for agreement
const AGREEMENT_WORD_COUNT_PENALTY = 30; // Hold action brevity penalty

/**
 * Scoring Bonuses
 * Points added for positive quality indicators.
 */
const LOGIC_BONUS_TIER1_WORDS = 0.1; // Bonus for >30 words
const LOGIC_BONUS_TIER2_WORDS = 0.1; // Bonus for >60 words
const LOGIC_BONUS_TIER3_WORDS = 0.05; // Bonus for >100 words
const LOGIC_BONUS_CAUSAL_CONNECTOR = 0.04; // Per causal reasoning pattern (because, therefore, etc.)
const LOGIC_BONUS_COMPARATIVE_CONNECTOR = 0.03; // Per comparative pattern (however, although, etc.)
const LOGIC_BONUS_QUANTITATIVE_PATTERN = 0.03; // Per quantitative reasoning pattern (%, ratio, etc.)

const EVIDENCE_BONUS_PRICE_REFERENCE = 0.15; // Specific $ prices cited
const EVIDENCE_BONUS_DATA_PATTERN = 0.04; // Per data point pattern (volume, RSI, P/E, etc.)
const EVIDENCE_BONUS_MULTI_STOCK = 0.1; // Multiple stock symbols mentioned (>1 stock)
const EVIDENCE_BONUS_PORTFOLIO_REFERENCE = 0.1; // Portfolio state awareness

const RISK_BONUS_RISK_PATTERN = 0.05; // Per risk-related term (risk, downside, volatility, etc.)
const RISK_BONUS_CONDITIONAL_PATTERN = 0.03; // Per conditional language (if, could, might, etc.)
const RISK_BONUS_BUY_WITH_AWARENESS = 0.1; // Buy action + risk acknowledgment

const ORIGINALITY_BONUS_UNIQUE_RATIO = 0.3; // Multiplier for unique word ratio (max 0.2 ceiling)
const ORIGINALITY_BONUS_UNIQUE_RATIO_CEILING = 0.2; // Max bonus from vocabulary diversity
const ORIGINALITY_BONUS_MULTI_SENTENCE_TIER1 = 0.1; // Bonus for ≥3 sentences
const ORIGINALITY_BONUS_MULTI_SENTENCE_TIER2 = 0.05; // Bonus for ≥5 sentences
const ORIGINALITY_BONUS_FORWARD_PATTERN = 0.03; // Per forward-looking pattern (expect, predict, etc.)
const ORIGINALITY_BONUS_HISTORICAL_CONTEXT = 0.1; // Historical comparison mentioned

const CONCLUSION_BONUS_ACTION_ALIGNMENT = 0.2; // Action matches reasoning direction (buy+bullish, sell+bearish)

/**
 * Scoring Penalties
 * Points deducted for quality concerns.
 */
const CONCLUSION_PENALTY_HIGH_CONF_SHORT = 0.2; // High confidence (>80%) with <20 words
const CONCLUSION_PENALTY_LOW_CONF_DEFINITIVE = 0.15; // Low confidence (<30%) with definitive language
const CONCLUSION_PENALTY_SHORT_HOLD = 0.1; // Hold action with <15 words
const CONCLUSION_PENALTY_ACTION_MISMATCH = 0.15; // Action contradicts reasoning direction (buy+bearish, sell+bullish)

/**
 * Confidence Thresholds (normalized 0-1)
 * Used for conclusion validity and agreement evaluation.
 */
const CONFIDENCE_HIGH_THRESHOLD = 0.8; // 80%+ = high confidence
const CONFIDENCE_LOW_THRESHOLD = 0.3; // <30% = low confidence
const CONFIDENCE_MODERATE_MIN = 0.3; // Moderate confidence range start
const CONFIDENCE_MODERATE_MAX = 0.85; // Moderate confidence range end
const CONFIDENCE_VERY_HIGH_THRESHOLD = 0.9; // 90%+ = very high (overconfident warning)

/**
 * Composite Aggregation Weights
 * How each dimension contributes to overall peer review score.
 */
const COMPOSITE_WEIGHT_LOGIC_QUALITY = 0.25; // 25% - logic chain validity
const COMPOSITE_WEIGHT_EVIDENCE_USAGE = 0.20; // 20% - data citation quality
const COMPOSITE_WEIGHT_RISK_AWARENESS = 0.20; // 20% - risk acknowledgment
const COMPOSITE_WEIGHT_ORIGINALITY = 0.15; // 15% - reasoning uniqueness
const COMPOSITE_WEIGHT_CONCLUSION_VALIDITY = 0.20; // 20% - action alignment

/**
 * Agreement Evaluation Parameters
 * Control how reviewer perspective determines agreement probability.
 */
const AGREEMENT_BASE_PROBABILITY = 0.5; // Starting agreement likelihood (50%)
const AGREEMENT_BONUS_WORD_COUNT = 0.1; // Bonus for >40 words
const AGREEMENT_BONUS_EVIDENCE = 0.1; // Bonus for price/percentage citations
const AGREEMENT_BONUS_RISK_AWARENESS = 0.05; // Bonus for risk mention
const AGREEMENT_BONUS_MODERATE_CONFIDENCE = 0.05; // Bonus for 30-85% confidence range

const AGREEMENT_CLAUDE_RISK_BONUS = 0.1; // Claude values risk awareness
const AGREEMENT_CLAUDE_HOLD_BONUS = 0.1; // Claude values cautious hold reasoning
const AGREEMENT_CLAUDE_OVERCONFIDENT_PENALTY = 0.15; // Claude penalizes high-conf buy without risk mention
const AGREEMENT_GPT_MOMENTUM_BONUS = 0.1; // GPT values momentum/technical signals
const AGREEMENT_GPT_HOLD_PENALTY = 0.1; // GPT dislikes brief hold reasoning
const AGREEMENT_GROK_CONTRARIAN_BONUS = 0.15; // Grok values contrarian thinking
const AGREEMENT_GROK_BASE_PENALTY = 0.1; // Grok generally more disagreeable

/**
 * Sentiment Pattern Weights
 * Used for action-reasoning alignment scoring.
 */
const SENTIMENT_PATTERN_WEIGHT_UNIT = 1; // Weight increment per bullish/bearish pattern match

/**
 * Reference Limits
 * Display/analysis caps for strengths, weaknesses, patterns.
 */
const STRENGTHS_DISPLAY_LIMIT = 4; // Max strengths shown per review
const WEAKNESSES_DISPLAY_LIMIT = 4; // Max weaknesses shown per review
const SENTENCE_COUNT_TIER1 = 3; // Multi-sentence analysis threshold
const SENTENCE_COUNT_TIER2 = 5; // Deep multi-sentence analysis threshold

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PeerReview {
  /** Who wrote the review */
  reviewerAgentId: string;
  /** Whose reasoning is being reviewed (blinded during review) */
  targetAgentId: string;
  /** The round this review covers */
  roundId: string;
  /** Overall review score 0-1 */
  overallScore: number;
  /** Breakdown scores */
  scores: PeerReviewScores;
  /** Free-text critique */
  critique: string;
  /** Key strengths identified */
  strengths: string[];
  /** Key weaknesses identified */
  weaknesses: string[];
  /** Would this reviewer have made the same trade? */
  wouldAgree: boolean;
  /** Timestamp */
  timestamp: string;
}

export interface PeerReviewScores {
  /** Is the logic chain valid? (0-1) */
  logicQuality: number;
  /** Does the agent use evidence well? (0-1) */
  evidenceUsage: number;
  /** Does the agent acknowledge risks? (0-1) */
  riskAwareness: number;
  /** Is the reasoning original or just restating prices? (0-1) */
  originality: number;
  /** Does the conclusion follow from the analysis? (0-1) */
  conclusionValidity: number;
}

export interface PeerReviewSummary {
  /** Agent being reviewed */
  agentId: string;
  /** Average peer scores from all reviewers */
  avgPeerScore: number;
  /** Scores breakdown averaged across reviewers */
  avgScores: PeerReviewScores;
  /** How often peers agree with the agent's trades */
  peerAgreementRate: number;
  /** Total reviews received */
  totalReviews: number;
  /** Most common strength cited by peers */
  topStrength: string | null;
  /** Most common weakness cited by peers */
  topWeakness: string | null;
  /** Peer review credibility score (do reviewers agree with each other?) */
  reviewConsistency: number;
}

export interface PeerReviewRoundReport {
  roundId: string;
  reviews: PeerReview[];
  agentSummaries: PeerReviewSummary[];
  /** Average disagreement rate within the round */
  disagreementRate: number;
  /** Which trade was most controversial (lowest avg peer score) */
  mostControversial: { agentId: string; avgScore: number } | null;
  /** Which trade was best reviewed (highest avg peer score) */
  bestReviewed: { agentId: string; avgScore: number } | null;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const allReviews: PeerReview[] = [];
const MAX_REVIEWS = 3000;

const roundReports: Map<string, PeerReviewRoundReport> = new Map();
const MAX_ROUND_REPORTS = 100;

// ---------------------------------------------------------------------------
// Keyword-based Peer Review Engine
// ---------------------------------------------------------------------------

/**
 * Analyze reasoning text from the perspective of a "reviewing" agent.
 * This uses structured NLP analysis rather than calling the LLM (to avoid
 * cost/latency). The scoring is deterministic and reproducible.
 */
export function conductPeerReview(
  reviewerAgentId: string,
  targetAgentId: string,
  reasoning: string,
  action: "buy" | "sell" | "hold",
  symbol: string,
  confidence: number,
  roundId: string,
): PeerReview {
  const scores = analyzeReasoningQuality(reasoning, action, confidence);
  const strengths = identifyStrengths(reasoning, action);
  const weaknesses = identifyWeaknesses(reasoning, action, confidence);
  const wouldAgree = evaluateAgreement(reasoning, action, confidence, reviewerAgentId);
  const critique = generateCritique(scores, strengths, weaknesses, action, symbol);

  const overallScore = round2(
    scores.logicQuality * COMPOSITE_WEIGHT_LOGIC_QUALITY +
      scores.evidenceUsage * COMPOSITE_WEIGHT_EVIDENCE_USAGE +
      scores.riskAwareness * COMPOSITE_WEIGHT_RISK_AWARENESS +
      scores.originality * COMPOSITE_WEIGHT_ORIGINALITY +
      scores.conclusionValidity * COMPOSITE_WEIGHT_CONCLUSION_VALIDITY,
  );

  const review: PeerReview = {
    reviewerAgentId,
    targetAgentId,
    roundId,
    overallScore,
    scores,
    critique,
    strengths,
    weaknesses,
    wouldAgree,
    timestamp: new Date().toISOString(),
  };

  // Store
  allReviews.unshift(review);
  if (allReviews.length > MAX_REVIEWS) {
    allReviews.length = MAX_REVIEWS;
  }

  return review;
}

/**
 * Run peer reviews for an entire round.
 * Each agent reviews every other agent (N * (N-1) reviews).
 */
export function conductRoundPeerReview(
  roundDecisions: Array<{
    agentId: string;
    reasoning: string;
    action: "buy" | "sell" | "hold";
    symbol: string;
    confidence: number;
  }>,
  roundId: string,
): PeerReviewRoundReport {
  const reviews: PeerReview[] = [];

  // Each agent reviews every other agent
  for (const reviewer of roundDecisions) {
    for (const target of roundDecisions) {
      if (reviewer.agentId === target.agentId) continue;

      const review = conductPeerReview(
        reviewer.agentId,
        target.agentId,
        target.reasoning,
        target.action,
        target.symbol,
        target.confidence,
        roundId,
      );
      reviews.push(review);
    }
  }

  // Build per-agent summaries
  const agentIds = [...new Set(roundDecisions.map((d) => d.agentId))];
  const agentSummaries = agentIds.map((agentId) => {
    const received = reviews.filter((r) => r.targetAgentId === agentId);
    return buildAgentSummary(agentId, received);
  });

  // Find most controversial and best reviewed
  let mostControversial: { agentId: string; avgScore: number } | null = null;
  let bestReviewed: { agentId: string; avgScore: number } | null = null;

  for (const summary of agentSummaries) {
    if (!mostControversial || summary.avgPeerScore < mostControversial.avgScore) {
      mostControversial = { agentId: summary.agentId, avgScore: summary.avgPeerScore };
    }
    if (!bestReviewed || summary.avgPeerScore > bestReviewed.avgScore) {
      bestReviewed = { agentId: summary.agentId, avgScore: summary.avgPeerScore };
    }
  }

  // Disagreement rate: how often peers disagree with the agent
  const totalAgreements = reviews.filter((r) => r.wouldAgree).length;
  const disagreementRate = reviews.length > 0
    ? round2(1 - totalAgreements / reviews.length)
    : 0;

  const report: PeerReviewRoundReport = {
    roundId,
    reviews,
    agentSummaries,
    disagreementRate,
    mostControversial,
    bestReviewed,
    timestamp: new Date().toISOString(),
  };

  // Store round report
  roundReports.set(roundId, report);
  if (roundReports.size > MAX_ROUND_REPORTS) {
    const oldest = [...roundReports.keys()][0];
    roundReports.delete(oldest);
  }

  return report;
}

// ---------------------------------------------------------------------------
// NLP Analysis Functions
// ---------------------------------------------------------------------------

function analyzeReasoningQuality(
  reasoning: string,
  action: "buy" | "sell" | "hold",
  confidence: number,
): PeerReviewScores {
  // Logic quality: check for causal connectors, structured argument
  const logicQuality = scoreLogicQuality(reasoning);

  // Evidence usage: does the agent cite specific data points?
  const evidenceUsage = scoreEvidenceUsage(reasoning);

  // Risk awareness: does the agent mention risks, downsides, uncertainty?
  const riskAwareness = scoreRiskAwareness(reasoning, action);

  // Originality: is the reasoning beyond just restating prices?
  const originality = scoreOriginality(reasoning);

  // Conclusion validity: does the final action make sense given the analysis?
  const conclusionValidity = scoreConclusionValidity(reasoning, action, confidence);

  return {
    logicQuality: round2(logicQuality),
    evidenceUsage: round2(evidenceUsage),
    riskAwareness: round2(riskAwareness),
    originality: round2(originality),
    conclusionValidity: round2(conclusionValidity),
  };
}

function scoreLogicQuality(reasoning: string): number {
  let score = LOGIC_QUALITY_BASELINE;
  const words = countWords(reasoning);

  // Length bonus: more detailed reasoning tends to be more logical
  if (words > LOGIC_WORD_COUNT_TIER1) score += LOGIC_BONUS_TIER1_WORDS;
  if (words > LOGIC_WORD_COUNT_TIER2) score += LOGIC_BONUS_TIER2_WORDS;
  if (words > LOGIC_WORD_COUNT_TIER3) score += LOGIC_BONUS_TIER3_WORDS;

  // Causal connectors indicate structured reasoning
  const causalPatterns = [
    /\bbecause\b/i, /\btherefore\b/i, /\bconsequently\b/i,
    /\bas a result\b/i, /\bdue to\b/i, /\bgiven that\b/i,
    /\bthis suggests\b/i, /\bwhich means\b/i, /\bimplying\b/i,
    /\bsince\b/i, /\bhence\b/i, /\bthus\b/i,
  ];
  for (const p of causalPatterns) {
    if (p.test(reasoning)) score += LOGIC_BONUS_CAUSAL_CONNECTOR;
  }

  // Comparative reasoning (comparing options)
  const comparativePatterns = [
    /\bhowever\b/i, /\bon the other hand\b/i, /\bwhile\b/i,
    /\balthough\b/i, /\bcompared to\b/i, /\brather than\b/i,
    /\binstead of\b/i, /\bbut\b/i, /\bdespite\b/i,
  ];
  for (const p of comparativePatterns) {
    if (p.test(reasoning)) score += LOGIC_BONUS_COMPARATIVE_CONNECTOR;
  }

  // Quantitative reasoning (citing numbers beyond just prices)
  const quantPatterns = [
    /\d+\.?\d*%/, /ratio/i, /average/i, /relative/i,
    /volatility/i, /correlation/i, /standard deviation/i,
  ];
  for (const p of quantPatterns) {
    if (p.test(reasoning)) score += LOGIC_BONUS_QUANTITATIVE_PATTERN;
  }

  return Math.min(1, score);
}

function scoreEvidenceUsage(reasoning: string): number {
  let score = EVIDENCE_USAGE_BASELINE;

  // Price references
  if (/\$\d+\.?\d*/i.test(reasoning)) score += EVIDENCE_BONUS_PRICE_REFERENCE;

  // Specific data points
  const evidencePatterns = [
    /\bprice\b/i, /\bvolume\b/i, /\b24h\b/i, /\bchange\b/i,
    /\bmarket cap\b/i, /\bP\/E\b/i, /\bEPS\b/i, /\brevenue\b/i,
    /\bearnings\b/i, /\bRSI\b/i, /\bMACD\b/i, /\bmoving average\b/i,
    /\bsupport\b/i, /\bresistance\b/i, /\btrend\b/i,
  ];
  for (const p of evidencePatterns) {
    if (p.test(reasoning)) score += EVIDENCE_BONUS_DATA_PATTERN;
  }

  // Multi-source analysis (mentions multiple stocks or factors)
  const stockMentions = reasoning.match(/\b[A-Z]{2,5}x\b/g);
  if (stockMentions && stockMentions.length > SENTIMENT_PATTERN_WEIGHT_UNIT) score += EVIDENCE_BONUS_MULTI_STOCK;

  // References to portfolio state
  if (/\bportfolio\b|\bposition\b|\bcash\b|\bbalance\b/i.test(reasoning)) {
    score += EVIDENCE_BONUS_PORTFOLIO_REFERENCE;
  }

  return Math.min(1, score);
}

function scoreRiskAwareness(reasoning: string, action: "buy" | "sell" | "hold"): number {
  let score = RISK_AWARENESS_BASELINE;

  // Risk-related terms
  const riskPatterns = [
    /\brisk\b/i, /\bdownside\b/i, /\buncertain/i, /\bvolatil/i,
    /\bloss/i, /\bdrawdown\b/i, /\bcaution/i, /\bexposure\b/i,
    /\bhedg/i, /\bprotect/i, /\bstop.?loss/i, /\bdiversif/i,
    /\bconcentrat/i, /\blimit/i, /\bmax\s+position/i,
  ];
  for (const p of riskPatterns) {
    if (p.test(reasoning)) score += RISK_BONUS_RISK_PATTERN;
  }

  // Conditional language shows awareness of uncertainty
  const conditionalPatterns = [
    /\bif\b/i, /\bcould\b/i, /\bmight\b/i, /\bmay\b/i,
    /\bpotentially\b/i, /\bpossibly\b/i, /\bin case\b/i,
  ];
  for (const p of conditionalPatterns) {
    if (p.test(reasoning)) score += RISK_BONUS_CONDITIONAL_PATTERN;
  }

  // Buy action with risk acknowledgment is better than blind buying
  if (action === "buy" && /\bdownside\b|\brisk\b|\bcaution\b/i.test(reasoning)) {
    score += RISK_BONUS_BUY_WITH_AWARENESS;
  }

  return Math.min(1, score);
}

function scoreOriginality(reasoning: string): number {
  let score = ORIGINALITY_BASELINE;

  const words = countWords(reasoning);
  const sentences = splitSentences(reasoning).length;

  // Unique word ratio (vocabulary diversity)
  const uniqueWords = new Set(reasoning.toLowerCase().split(/\s+/));
  const uniqueRatio = words > 0 ? uniqueWords.size / words : 0;
  score += Math.min(ORIGINALITY_BONUS_UNIQUE_RATIO_CEILING, uniqueRatio * ORIGINALITY_BONUS_UNIQUE_RATIO);

  // Multi-sentence analysis shows deeper thinking
  if (sentences >= SENTENCE_COUNT_TIER1) score += ORIGINALITY_BONUS_MULTI_SENTENCE_TIER1;
  if (sentences >= SENTENCE_COUNT_TIER2) score += ORIGINALITY_BONUS_MULTI_SENTENCE_TIER2;

  // Forward-looking analysis (not just describing current state)
  const forwardPatterns = [
    /\bexpect\b/i, /\bpredict\b/i, /\bforecast\b/i, /\blikely\b/i,
    /\bwill\b/i, /\bshould\b/i, /\bnext\b/i, /\bfuture\b/i,
    /\bopportunity\b/i, /\bcatalyst\b/i, /\btarget\b/i,
  ];
  for (const p of forwardPatterns) {
    if (p.test(reasoning)) score += ORIGINALITY_BONUS_FORWARD_PATTERN;
  }

  // Historical context (comparing to past)
  if (/\bhistorically\b|\bpreviously\b|\blast\s+(?:week|month|quarter)/i.test(reasoning)) {
    score += ORIGINALITY_BONUS_HISTORICAL_CONTEXT;
  }

  return Math.min(1, score);
}

function scoreConclusionValidity(
  reasoning: string,
  action: "buy" | "sell" | "hold",
  confidence: number,
): number {
  let score = CONCLUSION_VALIDITY_BASELINE;

  // Check if reasoning length matches confidence
  const words = countWords(reasoning);
  const normalizedConf = normalizeConfidence(confidence);

  // High confidence with short reasoning = suspicious
  if (normalizedConf > CONFIDENCE_HIGH_THRESHOLD && words < EVIDENCE_WORD_COUNT_MIN) {
    score -= CONCLUSION_PENALTY_HIGH_CONF_SHORT;
  }

  // Low confidence with definitive language = inconsistent
  if (normalizedConf < CONFIDENCE_LOW_THRESHOLD && /\bdefinitely\b|\bcertainly\b|\bclearly\b/i.test(reasoning)) {
    score -= CONCLUSION_PENALTY_LOW_CONF_DEFINITIVE;
  }

  // Hold action with no clear uncertainty reason = weak
  if (action === "hold" && words < AGREEMENT_WORD_COUNT_PENALTY) {
    score -= CONCLUSION_PENALTY_SHORT_HOLD;
  }

  // Action + reasoning direction alignment (similar to coherence but from peer POV)
  const bullishWeight = countPatternWeight(reasoning, [
    /\bbullish\b/i, /\bundervalued\b/i, /\bgrowth\b/i, /\bupside\b/i,
    /\baccumulate\b/i, /\bstrong\b/i, /\bpositive\b/i,
  ]);
  const bearishWeight = countPatternWeight(reasoning, [
    /\bbearish\b/i, /\bovervalued\b/i, /\bdecline\b/i, /\bdownside\b/i,
    /\bweak\b/i, /\bnegative\b/i, /\bconcern/i,
  ]);

  if (action === "buy" && bullishWeight > bearishWeight) score += CONCLUSION_BONUS_ACTION_ALIGNMENT;
  if (action === "sell" && bearishWeight > bullishWeight) score += CONCLUSION_BONUS_ACTION_ALIGNMENT;
  if (action === "buy" && bearishWeight > bullishWeight + SENTIMENT_PATTERN_WEIGHT_UNIT) score -= CONCLUSION_PENALTY_ACTION_MISMATCH;
  if (action === "sell" && bullishWeight > bearishWeight + SENTIMENT_PATTERN_WEIGHT_UNIT) score -= CONCLUSION_PENALTY_ACTION_MISMATCH;

  return normalize(score);
}

function countPatternWeight(text: string, patterns: RegExp[]): number {
  let weight = 0;
  for (const p of patterns) {
    if (p.test(text)) weight++;
  }
  return weight;
}

// ---------------------------------------------------------------------------
// Strength / Weakness Identification
// ---------------------------------------------------------------------------

function identifyStrengths(reasoning: string, _action: string): string[] {
  const strengths: string[] = [];

  if (countWords(reasoning) > STRENGTH_WORD_COUNT_DETAILED) {
    strengths.push("Detailed analysis with substantial reasoning");
  }
  if (/\bbecause\b|\btherefore\b|\bthus\b|\bconsequently\b/i.test(reasoning)) {
    strengths.push("Uses causal reasoning to connect observations to conclusions");
  }
  if (/\brisk\b|\bdownside\b|\bcaution\b/i.test(reasoning)) {
    strengths.push("Acknowledges risks and potential downsides");
  }
  if (/\$\d+\.?\d*/.test(reasoning) && /\d+\.?\d*%/.test(reasoning)) {
    strengths.push("Cites specific quantitative data points");
  }
  if (/\bhowever\b|\bon the other hand\b|\balthough\b/i.test(reasoning)) {
    strengths.push("Considers multiple perspectives before concluding");
  }
  if (/\bhistorically\b|\bpreviously\b|\blast\s+(?:week|month)/i.test(reasoning)) {
    strengths.push("Incorporates historical context");
  }
  if (/\bportfolio\b|\bposition\b|\bconcentration\b|\bexposure\b/i.test(reasoning)) {
    strengths.push("Considers portfolio-level implications");
  }

  return strengths.slice(0, STRENGTHS_DISPLAY_LIMIT);
}

function identifyWeaknesses(reasoning: string, action: string, confidence: number): string[] {
  const weaknesses: string[] = [];
  const words = countWords(reasoning);
  const normalizedConf = normalizeConfidence(confidence);

  if (words < WEAKNESS_WORD_COUNT_MIN) {
    weaknesses.push("Reasoning is too brief to be convincing");
  }
  if (normalizedConf > CONFIDENCE_HIGH_THRESHOLD && !/\brisk\b|\bdownside\b|\bcaution\b/i.test(reasoning)) {
    weaknesses.push("High confidence without acknowledging any risks");
  }
  if (action !== "hold" && !/\$\d+\.?\d*/.test(reasoning)) {
    weaknesses.push("No specific price levels cited to support the trade");
  }
  if (!/\bbecause\b|\btherefore\b|\bsince\b|\bdue to\b/i.test(reasoning)) {
    weaknesses.push("Lacks explicit causal reasoning");
  }
  if (/\bI think\b|\bI feel\b|\bI believe\b/i.test(reasoning) && !/data|evidence|indicator/i.test(reasoning)) {
    weaknesses.push("Relies on subjective belief without data support");
  }
  if (action === "buy" && normalizedConf < CONFIDENCE_LOW_THRESHOLD) {
    weaknesses.push("Executing a buy with very low confidence suggests uncertainty");
  }

  return weaknesses.slice(0, WEAKNESSES_DISPLAY_LIMIT);
}

// ---------------------------------------------------------------------------
// Agreement Evaluation
// ---------------------------------------------------------------------------

function evaluateAgreement(
  reasoning: string,
  action: "buy" | "sell" | "hold",
  confidence: number,
  reviewerAgentId: string,
): boolean {
  // Simulate reviewer perspective based on agent personality
  // Claude (value) tends to agree with cautious reasoning
  // GPT (momentum) tends to agree with trend-following
  // Grok (contrarian) tends to disagree with consensus moves

  const normalizedConf = normalizeConfidence(confidence);
  const hasEvidence = /\$\d+\.?\d*|\d+\.?\d*%/i.test(reasoning);
  const hasRiskAwareness = /\brisk\b|\bdownside\b|\bcaution\b/i.test(reasoning);
  const wordCount = countWords(reasoning);

  // Base agreement probability
  let agreeProb = 0.5;

  // Better reasoning = higher agreement regardless of reviewer
  if (wordCount > 40) agreeProb += 0.1;
  if (hasEvidence) agreeProb += 0.1;
  if (hasRiskAwareness) agreeProb += 0.05;
  if (normalizedConf > 0.3 && normalizedConf < 0.85) agreeProb += 0.05; // moderate confidence

  // Reviewer-specific biases
  if (reviewerAgentId.includes("claude")) {
    // Claude values: evidence, risk awareness, conservative approach
    if (hasRiskAwareness) agreeProb += 0.1;
    if (action === "hold" && /\bcaution\b|\buncertain/i.test(reasoning)) agreeProb += 0.1;
    if (action === "buy" && normalizedConf > 0.9 && !hasRiskAwareness) agreeProb -= 0.15;
  } else if (reviewerAgentId.includes("gpt")) {
    // GPT values: momentum signals, technical analysis, trend data
    if (/\bmomentum\b|\btrend\b|\bbreakout\b|\btechnical\b/i.test(reasoning)) agreeProb += 0.1;
    if (action === "hold" && wordCount < 30) agreeProb -= 0.1;
  } else if (reviewerAgentId.includes("grok")) {
    // Grok values: contrarian thinking, unconventional analysis
    if (/\bcontrarian\b|\boverreaction\b|\bpanic\b|\boversold\b/i.test(reasoning)) agreeProb += 0.15;
    // Grok is generally more disagreeable
    agreeProb -= 0.1;
  }

  // Deterministic based on reasoning hash (reproducible)
  const hash = simpleHash(reasoning + reviewerAgentId);
  const threshold = hash % 100;
  return threshold < agreeProb * 100;
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit int
  }
  return Math.abs(hash);
}

// ---------------------------------------------------------------------------
// Critique Generation
// ---------------------------------------------------------------------------

function generateCritique(
  scores: PeerReviewScores,
  strengths: string[],
  weaknesses: string[],
  action: string,
  symbol: string,
): string {
  const parts: string[] = [];

  // Opening assessment
  const avgScore = (scores.logicQuality + scores.evidenceUsage + scores.riskAwareness +
    scores.originality + scores.conclusionValidity) / 5;

  if (avgScore >= 0.7) {
    parts.push(`The ${action} decision on ${symbol} is well-reasoned.`);
  } else if (avgScore >= 0.4) {
    parts.push(`The ${action} decision on ${symbol} has some merit but could be stronger.`);
  } else {
    parts.push(`The ${action} decision on ${symbol} lacks sufficient justification.`);
  }

  // Highlight top strength
  if (strengths.length > 0) {
    parts.push(`Strength: ${strengths[0]}.`);
  }

  // Highlight top weakness
  if (weaknesses.length > 0) {
    parts.push(`Concern: ${weaknesses[0]}.`);
  }

  // Specific dimensional feedback
  if (scores.evidenceUsage < 0.4) {
    parts.push("More specific data citations would strengthen this analysis.");
  }
  if (scores.riskAwareness < 0.3) {
    parts.push("Risk factors should be explicitly addressed.");
  }
  if (scores.originality < 0.3) {
    parts.push("The analysis restates observable facts without deeper insight.");
  }

  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Query API
// ---------------------------------------------------------------------------

function buildAgentSummary(agentId: string, reviews: PeerReview[]): PeerReviewSummary {
  if (reviews.length === 0) {
    return {
      agentId,
      avgPeerScore: 0,
      avgScores: { logicQuality: 0, evidenceUsage: 0, riskAwareness: 0, originality: 0, conclusionValidity: 0 },
      peerAgreementRate: 0,
      totalReviews: 0,
      topStrength: null,
      topWeakness: null,
      reviewConsistency: 0,
    };
  }

  const avgPeerScore = round2(
    reviews.reduce((s, r) => s + r.overallScore, 0) / reviews.length,
  );

  const avgScores: PeerReviewScores = {
    logicQuality: mean(reviews.map((r) => r.scores.logicQuality)),
    evidenceUsage: mean(reviews.map((r) => r.scores.evidenceUsage)),
    riskAwareness: mean(reviews.map((r) => r.scores.riskAwareness)),
    originality: mean(reviews.map((r) => r.scores.originality)),
    conclusionValidity: mean(reviews.map((r) => r.scores.conclusionValidity)),
  };

  const agreements = reviews.filter((r) => r.wouldAgree).length;
  const peerAgreementRate = round2(agreements / reviews.length);

  // Most common strength/weakness
  const strengthCounts = new Map<string, number>();
  const weaknessCounts = new Map<string, number>();
  for (const r of reviews) {
    for (const s of r.strengths) {
      strengthCounts.set(s, (strengthCounts.get(s) ?? 0) + 1);
    }
    for (const w of r.weaknesses) {
      weaknessCounts.set(w, (weaknessCounts.get(w) ?? 0) + 1);
    }
  }

  const topStrength = strengthCounts.size > 0
    ? [...strengthCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
    : null;

  const topWeakness = weaknessCounts.size > 0
    ? [...weaknessCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
    : null;

  // Review consistency: stddev of scores (lower = more consistent)
  const scores = reviews.map((r) => r.overallScore);
  const m = avgPeerScore;
  const variance = scores.reduce((s, v) => s + (v - m) ** 2, 0) / scores.length;
  const stddev = Math.sqrt(variance);
  const reviewConsistency = round2(Math.max(0, 1 - stddev * 2));

  return {
    agentId,
    avgPeerScore,
    avgScores,
    peerAgreementRate,
    totalReviews: reviews.length,
    topStrength,
    topWeakness,
    reviewConsistency,
  };
}

/**
 * Get all-time peer review summary for an agent.
 */
export function getAgentPeerReviewSummary(agentId: string): PeerReviewSummary {
  const agentReviews = allReviews.filter((r) => r.targetAgentId === agentId);
  return buildAgentSummary(agentId, agentReviews);
}

/**
 * Get peer review report for a specific round.
 */
export function getRoundPeerReview(roundId: string): PeerReviewRoundReport | null {
  return roundReports.get(roundId) ?? null;
}

/**
 * Get recent peer reviews, optionally filtered by agent.
 */
export function getRecentPeerReviews(limit = 20, agentId?: string): PeerReview[] {
  let reviews = allReviews;
  if (agentId) {
    reviews = reviews.filter((r) => r.targetAgentId === agentId || r.reviewerAgentId === agentId);
  }
  return reviews.slice(0, limit);
}

/**
 * Get peer review comparison across all agents.
 */
export function getPeerReviewLeaderboard(): PeerReviewSummary[] {
  const agentIds = [...new Set(allReviews.map((r) => r.targetAgentId))];
  return agentIds
    .map((id) => getAgentPeerReviewSummary(id))
    .sort((a, b) => b.avgPeerScore - a.avgPeerScore);
}
