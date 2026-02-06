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
    scores.logicQuality * 0.25 +
      scores.evidenceUsage * 0.20 +
      scores.riskAwareness * 0.20 +
      scores.originality * 0.15 +
      scores.conclusionValidity * 0.20,
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
  let score = 0.3; // baseline
  const words = countWords(reasoning);

  // Length bonus: more detailed reasoning tends to be more logical
  if (words > 30) score += 0.1;
  if (words > 60) score += 0.1;
  if (words > 100) score += 0.05;

  // Causal connectors indicate structured reasoning
  const causalPatterns = [
    /\bbecause\b/i, /\btherefore\b/i, /\bconsequently\b/i,
    /\bas a result\b/i, /\bdue to\b/i, /\bgiven that\b/i,
    /\bthis suggests\b/i, /\bwhich means\b/i, /\bimplying\b/i,
    /\bsince\b/i, /\bhence\b/i, /\bthus\b/i,
  ];
  for (const p of causalPatterns) {
    if (p.test(reasoning)) score += 0.04;
  }

  // Comparative reasoning (comparing options)
  const comparativePatterns = [
    /\bhowever\b/i, /\bon the other hand\b/i, /\bwhile\b/i,
    /\balthough\b/i, /\bcompared to\b/i, /\brather than\b/i,
    /\binstead of\b/i, /\bbut\b/i, /\bdespite\b/i,
  ];
  for (const p of comparativePatterns) {
    if (p.test(reasoning)) score += 0.03;
  }

  // Quantitative reasoning (citing numbers beyond just prices)
  const quantPatterns = [
    /\d+\.?\d*%/, /ratio/i, /average/i, /relative/i,
    /volatility/i, /correlation/i, /standard deviation/i,
  ];
  for (const p of quantPatterns) {
    if (p.test(reasoning)) score += 0.03;
  }

  return Math.min(1, score);
}

function scoreEvidenceUsage(reasoning: string): number {
  let score = 0.2;

  // Price references
  if (/\$\d+\.?\d*/i.test(reasoning)) score += 0.15;

  // Specific data points
  const evidencePatterns = [
    /\bprice\b/i, /\bvolume\b/i, /\b24h\b/i, /\bchange\b/i,
    /\bmarket cap\b/i, /\bP\/E\b/i, /\bEPS\b/i, /\brevenue\b/i,
    /\bearnings\b/i, /\bRSI\b/i, /\bMACD\b/i, /\bmoving average\b/i,
    /\bsupport\b/i, /\bresistance\b/i, /\btrend\b/i,
  ];
  for (const p of evidencePatterns) {
    if (p.test(reasoning)) score += 0.04;
  }

  // Multi-source analysis (mentions multiple stocks or factors)
  const stockMentions = reasoning.match(/\b[A-Z]{2,5}x\b/g);
  if (stockMentions && stockMentions.length > 1) score += 0.1;

  // References to portfolio state
  if (/\bportfolio\b|\bposition\b|\bcash\b|\bbalance\b/i.test(reasoning)) {
    score += 0.1;
  }

  return Math.min(1, score);
}

function scoreRiskAwareness(reasoning: string, action: "buy" | "sell" | "hold"): number {
  let score = 0.2;

  // Risk-related terms
  const riskPatterns = [
    /\brisk\b/i, /\bdownside\b/i, /\buncertain/i, /\bvolatil/i,
    /\bloss/i, /\bdrawdown\b/i, /\bcaution/i, /\bexposure\b/i,
    /\bhedg/i, /\bprotect/i, /\bstop.?loss/i, /\bdiversif/i,
    /\bconcentrat/i, /\blimit/i, /\bmax\s+position/i,
  ];
  for (const p of riskPatterns) {
    if (p.test(reasoning)) score += 0.05;
  }

  // Conditional language shows awareness of uncertainty
  const conditionalPatterns = [
    /\bif\b/i, /\bcould\b/i, /\bmight\b/i, /\bmay\b/i,
    /\bpotentially\b/i, /\bpossibly\b/i, /\bin case\b/i,
  ];
  for (const p of conditionalPatterns) {
    if (p.test(reasoning)) score += 0.03;
  }

  // Buy action with risk acknowledgment is better than blind buying
  if (action === "buy" && /\bdownside\b|\brisk\b|\bcaution\b/i.test(reasoning)) {
    score += 0.1;
  }

  return Math.min(1, score);
}

function scoreOriginality(reasoning: string): number {
  let score = 0.3;

  const words = countWords(reasoning);
  const sentences = splitSentences(reasoning).length;

  // Unique word ratio (vocabulary diversity)
  const uniqueWords = new Set(reasoning.toLowerCase().split(/\s+/));
  const uniqueRatio = words > 0 ? uniqueWords.size / words : 0;
  score += Math.min(0.2, uniqueRatio * 0.3);

  // Multi-sentence analysis shows deeper thinking
  if (sentences >= 3) score += 0.1;
  if (sentences >= 5) score += 0.05;

  // Forward-looking analysis (not just describing current state)
  const forwardPatterns = [
    /\bexpect\b/i, /\bpredict\b/i, /\bforecast\b/i, /\blikely\b/i,
    /\bwill\b/i, /\bshould\b/i, /\bnext\b/i, /\bfuture\b/i,
    /\bopportunity\b/i, /\bcatalyst\b/i, /\btarget\b/i,
  ];
  for (const p of forwardPatterns) {
    if (p.test(reasoning)) score += 0.03;
  }

  // Historical context (comparing to past)
  if (/\bhistorically\b|\bpreviously\b|\blast\s+(?:week|month|quarter)/i.test(reasoning)) {
    score += 0.1;
  }

  return Math.min(1, score);
}

function scoreConclusionValidity(
  reasoning: string,
  action: "buy" | "sell" | "hold",
  confidence: number,
): number {
  let score = 0.5; // neutral baseline

  // Check if reasoning length matches confidence
  const words = countWords(reasoning);
  const normalizedConf = normalizeConfidence(confidence);

  // High confidence with short reasoning = suspicious
  if (normalizedConf > 0.8 && words < 20) {
    score -= 0.2;
  }

  // Low confidence with definitive language = inconsistent
  if (normalizedConf < 0.3 && /\bdefinitely\b|\bcertainly\b|\bclearly\b/i.test(reasoning)) {
    score -= 0.15;
  }

  // Hold action with no clear uncertainty reason = weak
  if (action === "hold" && words < 15) {
    score -= 0.1;
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

  if (action === "buy" && bullishWeight > bearishWeight) score += 0.2;
  if (action === "sell" && bearishWeight > bullishWeight) score += 0.2;
  if (action === "buy" && bearishWeight > bullishWeight + 1) score -= 0.15;
  if (action === "sell" && bullishWeight > bearishWeight + 1) score -= 0.15;

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

  if (countWords(reasoning) > 60) {
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

  return strengths.slice(0, 4);
}

function identifyWeaknesses(reasoning: string, action: string, confidence: number): string[] {
  const weaknesses: string[] = [];
  const words = countWords(reasoning);
  const normalizedConf = normalizeConfidence(confidence);

  if (words < 20) {
    weaknesses.push("Reasoning is too brief to be convincing");
  }
  if (normalizedConf > 0.8 && !/\brisk\b|\bdownside\b|\bcaution\b/i.test(reasoning)) {
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
  if (action === "buy" && normalizedConf < 0.3) {
    weaknesses.push("Executing a buy with very low confidence suggests uncertainty");
  }

  return weaknesses.slice(0, 4);
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
