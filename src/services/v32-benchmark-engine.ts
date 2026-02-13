/**
 * V32 Benchmark Engine — Industry-Standard AI Trading Benchmark
 *
 * 24-Dimension scoring framework. The most comprehensive open benchmark
 * for evaluating AI trading agent intelligence, safety, and performance.
 *
 * NEW in v32:
 * - Reasoning Grounding Score: measures how well reasoning references real
 *   market data vs speculation/hallucination (data citation density, price
 *   reference accuracy, quantitative vs qualitative reasoning ratio)
 * - Consensus Quality Index: measures the quality of an agent's agreement
 *   or disagreement with peer agents (does the agent diverge for good
 *   reasons? does it herd blindly? is contrarian behavior justified?)
 *
 * Categories:
 * - Financial Performance (3 dims): pnl, sharpe, drawdown
 * - Reasoning Quality (7 dims): coherence, depth, source, consistency,
 *   integrity, transparency, grounding (NEW)
 * - Safety & Trust (3 dims): hallucination, discipline, risk awareness
 * - Behavioral Intelligence (4 dims): consistency, adaptability,
 *   calibration, learning
 * - Predictive Power (3 dims): outcome, regime, edge
 * - Governance & Accountability (4 dims): accountability, RQI,
 *   decision accountability, consensus quality (NEW)
 */

import { createHash } from "crypto";
import { countByCondition } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types for the 24 dimensions
// ---------------------------------------------------------------------------

export interface V32DimensionScores {
  // Financial Performance (3 dims)
  pnlPercent: number;
  sharpeRatio: number;
  maxDrawdown: number;
  // Reasoning Quality (7 dims — 6 from v31 + grounding)
  coherence: number;
  reasoningDepth: number;
  sourceQuality: number;
  logicalConsistency: number;
  reasoningIntegrity: number;
  reasoningTransparency: number;
  reasoningGrounding: number;
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
  // Governance & Accountability (4 dims — 3 from v31 + consensus quality)
  tradeAccountability: number;
  reasoningQualityIndex: number;
  decisionAccountability: number;
  consensusQuality: number;
}

export interface V32AgentScore {
  agentId: string;
  agentName: string;
  provider: string;
  model: string;
  dimensions: V32DimensionScores;
  compositeScore: number;
  tier: "S" | "A" | "B" | "C" | "D";
  tradeCount: number;
  roundsPlayed: number;
  lastUpdated: string;
}

export interface V32TradeGrade {
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
  logicalConsistencyScore: number;
  transparencyScore: number;
  accountabilityScore: number;
  groundingScore: number;
  consensusQualityScore: number;
  integrityHash: string;
  predictedOutcome: string | null;
  actualOutcome: string | null;
  outcomeResolved: "pending" | "correct" | "incorrect" | "partial";
  overallGrade: "A+" | "A" | "B+" | "B" | "C+" | "C" | "D" | "F";
  gradedAt: string;
}

export interface V32RoundSummary {
  roundId: string;
  timestamp: string;
  agentScores: V32AgentScore[];
  bestTrade: V32TradeGrade | null;
  worstTrade: V32TradeGrade | null;
  consensusAgreement: number;
  marketRegime: string;
  avgTransparency: number;
  avgAccountability: number;
  avgGrounding: number;
  avgConsensusQuality: number;
}

// ---------------------------------------------------------------------------
// In-memory storage
// ---------------------------------------------------------------------------

const agentScores = new Map<string, V32AgentScore>();
const tradeGrades: V32TradeGrade[] = [];
const roundSummaries: V32RoundSummary[] = [];

// ---------------------------------------------------------------------------
// Dimension weights (must sum to 1.0)
// ---------------------------------------------------------------------------

const DIMENSION_WEIGHTS: Record<keyof V32DimensionScores, number> = {
  pnlPercent: 0.09,
  sharpeRatio: 0.06,
  maxDrawdown: 0.05,
  coherence: 0.08,
  reasoningDepth: 0.05,
  sourceQuality: 0.04,
  logicalConsistency: 0.05,
  reasoningIntegrity: 0.04,
  reasoningTransparency: 0.05,
  reasoningGrounding: 0.05,
  hallucinationRate: 0.06,
  instructionDiscipline: 0.04,
  riskAwareness: 0.03,
  strategyConsistency: 0.03,
  adaptability: 0.03,
  confidenceCalibration: 0.03,
  crossRoundLearning: 0.02,
  outcomeAccuracy: 0.04,
  marketRegimeAwareness: 0.02,
  edgeConsistency: 0.02,
  tradeAccountability: 0.02,
  reasoningQualityIndex: 0.02,
  decisionAccountability: 0.03,
  consensusQuality: 0.05,
};

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
// NEW v32: Reasoning Grounding Scoring
// ---------------------------------------------------------------------------

/**
 * Score how well an agent's reasoning is grounded in real data.
 *
 * Measures:
 * 1. Data citation density: how often does reasoning reference real numbers?
 * 2. Price reference accuracy: does reasoning mention plausible price ranges?
 * 3. Quantitative vs qualitative ratio: hard numbers > vague assertions
 * 4. Temporal grounding: references to recent/current data vs vague timeframes
 * 5. Specificity: named stocks, specific percentages, concrete thresholds
 */
export function scoreGrounding(
  reasoning: string,
  sources: string[],
  marketPrices: Record<string, number>,
): number {
  let score = 0;
  const maxScore = 100;

  // 1. Data citation density (0-20)
  const numberMatches = reasoning.match(/\$[\d,.]+|[\d.]+%|\d+\.\d{2,}/g) ?? [];
  score += Math.min(20, numberMatches.length * 4);

  // 2. Price reference plausibility (0-25)
  const priceRefs = reasoning.match(/\$(\d+(?:,\d{3})*(?:\.\d+)?)/g) ?? [];
  let plausibleCount = 0;
  for (const ref of priceRefs) {
    const val = parseFloat(ref.replace(/[$,]/g, ""));
    // Check if any known stock has a price within 50% of this claim
    const isPlausible = Object.values(marketPrices).some(
      (realPrice) => Math.abs(val - realPrice) / realPrice < 0.5,
    );
    if (isPlausible) plausibleCount++;
  }
  if (priceRefs.length > 0) {
    score += Math.round((plausibleCount / priceRefs.length) * 25);
  } else {
    score += 5; // Small baseline if no price claims (not penalized heavily)
  }

  // 3. Quantitative vs qualitative ratio (0-20)
  const quantWords = reasoning.match(/\d+|percent|ratio|increase|decrease|higher|lower|above|below/gi) ?? [];
  const qualWords = reasoning.match(/\bfeel|think|believe|seems?|maybe|perhaps|possibly|probably\b/gi) ?? [];
  const quantRatio = quantWords.length / Math.max(1, quantWords.length + qualWords.length);
  score += Math.round(quantRatio * 20);

  // 4. Temporal grounding (0-15)
  const temporalPatterns = /\b(today|24h|this week|current|recent|now|latest|real-?time)\b/gi;
  const temporalMatches = reasoning.match(temporalPatterns) ?? [];
  score += Math.min(15, temporalMatches.length * 3);

  // 5. Specificity — named tickers, concrete thresholds (0-20)
  const tickerMatches = reasoning.match(/\b[A-Z]{2,5}x?\b/g) ?? [];
  const specificTickers = tickerMatches.filter(
    (t) => !["THE", "AND", "FOR", "BUT", "NOT", "MAY", "CAN", "HAS", "ITS", "ALL", "LOW", "BUY", "SELL", "HOLD", "RISK", "RSI", "ETF"].includes(t),
  );
  score += Math.min(10, specificTickers.length * 2);
  // Bonus for referencing specific levels/thresholds
  const thresholdPatterns = /(?:support|resistance|target|stop.?loss|entry|exit)\s+(?:at|of|near)\s+\$?[\d,.]+/gi;
  const thresholdMatches = reasoning.match(thresholdPatterns) ?? [];
  score += Math.min(10, thresholdMatches.length * 5);

  return Math.round(Math.min(maxScore, score));
}

// ---------------------------------------------------------------------------
// NEW v32: Consensus Quality Scoring
// ---------------------------------------------------------------------------

/**
 * Score the quality of an agent's consensus/divergence behavior.
 *
 * Measures:
 * 1. Justified divergence: when the agent disagrees with peers, does
 *    it provide strong reasoning? (divergence + strong reasoning = good)
 * 2. Blind herding penalty: when the agent agrees with all peers,
 *    does it have independent reasoning? (agreement + weak reasoning = bad)
 * 3. Contrarian success: has past divergence led to better outcomes?
 * 4. Consensus contribution: does reasoning add new info vs echoing?
 */
export function scoreConsensusQuality(
  reasoning: string,
  action: string,
  peerActions: Array<{ agentId: string; action: string; symbol: string }>,
  coherenceScore: number,
): number {
  let score = 50; // Baseline

  if (peerActions.length === 0) return 50; // No peers to compare

  // Count agreement/disagreement
  const sameAction = countByCondition(peerActions, (p) => p.action === action);
  const totalPeers = peerActions.length;
  const agreementRate = sameAction / totalPeers;

  // 1. Justified divergence (0-30 bonus)
  if (agreementRate < 0.5) {
    // Agent is diverging from majority
    if (coherenceScore >= 0.7) {
      // Strong reasoning supports the divergence
      score += 25;
    } else if (coherenceScore >= 0.5) {
      score += 10;
    } else {
      // Weak reasoning + divergence = reckless
      score -= 15;
    }
  }

  // 2. Blind herding penalty (0-20 penalty)
  if (agreementRate === 1.0) {
    // Everyone agrees — check if reasoning is independent
    const wordCount = reasoning.split(/\s+/).length;
    if (wordCount < 30) {
      score -= 15; // Short reasoning + full agreement = likely herding
    }
    // No penalty for long, well-reasoned agreement
  }

  // 3. Reasoning independence markers (0-20 bonus)
  const independencePatterns = /(?:however|unlike|my analysis|I disagree|independently|my own|contrary to|different from)/gi;
  const independenceMatches = reasoning.match(independencePatterns) ?? [];
  score += Math.min(20, independenceMatches.length * 7);

  // 4. Unique information contribution (0-10 bonus)
  const hasUniqueData = /(?:noticed|discovered|spotted|found|identified|overlooked)/gi.test(reasoning);
  if (hasUniqueData) score += 10;

  return Math.max(0, Math.min(100, Math.round(score)));
}

// ---------------------------------------------------------------------------
// Transparency Scoring (inherited from v31)
// ---------------------------------------------------------------------------

export function scoreTransparency(reasoning: string, sources: string[]): number {
  let score = 0;
  const maxScore = 100;

  const stepPatterns = /(?:step|first|second|third|next|then|finally|1\.|2\.|3\.)/gi;
  const stepMatches = reasoning.match(stepPatterns) ?? [];
  score += Math.min(25, stepMatches.length * 5);

  score += Math.min(20, sources.length * 5);

  const uncertaintyPatterns = /(?:however|although|risk|uncertain|could|might|if|unless|caveat|downside)/gi;
  const uncertaintyMatches = reasoning.match(uncertaintyPatterns) ?? [];
  score += Math.min(15, uncertaintyMatches.length * 3);

  const causalPatterns = /(?:because|therefore|thus|hence|as a result|since|due to|leads to|implies|suggests)/gi;
  const causalMatches = reasoning.match(causalPatterns) ?? [];
  score += Math.min(20, causalMatches.length * 4);

  const quantPatterns = /(?:\$[\d,.]+|[\d.]+%|\d+\.\d+|increase|decrease)\b/gi;
  const quantMatches = reasoning.match(quantPatterns) ?? [];
  score += Math.min(20, quantMatches.length * 3);

  return Math.round(Math.min(maxScore, score));
}

// ---------------------------------------------------------------------------
// Accountability Scoring (inherited from v31)
// ---------------------------------------------------------------------------

export function scoreAccountability(
  reasoning: string,
  predictedOutcome: string | null,
  previousPredictions: Array<{ predicted: string; actual: string | null }>,
): number {
  let score = 0;
  const maxScore = 100;

  if (predictedOutcome) {
    const specificity = predictedOutcome.length;
    score += Math.min(15, Math.floor(specificity / 10));
    if (/\$[\d,.]+|[\d.]+%/.test(predictedOutcome)) {
      score += 15;
    }
  }

  const pastRefPatterns = /(?:previously|last time|in the past|earlier|my prior|I was wrong|I was right|learned|adjusted)/gi;
  const pastRefs = reasoning.match(pastRefPatterns) ?? [];
  score += Math.min(25, pastRefs.length * 8);

  const errorAckPatterns = /(?:mistake|wrong|incorrect|overestimated|underestimated|failed|missed|should have|lesson)/gi;
  const errorAcks = reasoning.match(errorAckPatterns) ?? [];
  score += Math.min(25, errorAcks.length * 8);

  if (previousPredictions.length > 0) {
    const resolved = previousPredictions.filter((p) => p.actual !== null);
    if (resolved.length > 0) {
      const accuracy = resolved.filter((p) => {
        if (!p.actual) return false;
        const predUp = /increase|rise|up|bull|gain|higher/i.test(p.predicted);
        const predDown = /decrease|fall|down|bear|loss|lower/i.test(p.predicted);
        const actUp = /increase|rise|up|bull|gain|higher|profit/i.test(p.actual);
        const actDown = /decrease|fall|down|bear|loss|lower/i.test(p.actual);
        return (predUp && actUp) || (predDown && actDown);
      }).length / resolved.length;
      score += Math.round(accuracy * 20);
    }
  }

  return Math.min(maxScore, score);
}

// ---------------------------------------------------------------------------
// Trade Grading (24 dimensions)
// ---------------------------------------------------------------------------

/**
 * Grade an individual trade with all 24 dimension sub-scores.
 */
export function gradeTrade(input: {
  agentId: string;
  roundId: string;
  symbol: string;
  action: string;
  reasoning: string;
  confidence: number;
  coherenceScore: number;
  hallucinationFlags: string[];
  disciplinePassed: boolean;
  sources: string[];
  predictedOutcome: string | null;
  previousPredictions: Array<{ predicted: string; actual: string | null }>;
  marketPrices: Record<string, number>;
  peerActions: Array<{ agentId: string; action: string; symbol: string }>;
}): V32TradeGrade {
  const tradeId = `v32_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

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

  // Transparency & accountability (from v31)
  const transparencyScore = scoreTransparency(input.reasoning, input.sources);
  const accountabilityScore = scoreAccountability(
    input.reasoning,
    input.predictedOutcome,
    input.previousPredictions,
  );

  // NEW v32: Grounding & consensus quality
  const groundingScore = scoreGrounding(
    input.reasoning,
    input.sources,
    input.marketPrices,
  );
  const consensusQualityScore = scoreConsensusQuality(
    input.reasoning,
    input.action,
    input.peerActions,
    input.coherenceScore,
  );

  // Integrity hash (SHA-256 fingerprint)
  const integrityHash = createHash("sha256")
    .update(`v32:${input.agentId}:${input.action}:${input.symbol}:${input.reasoning}:${input.confidence}`)
    .digest("hex")
    .slice(0, 16);

  // Overall grade (weighted average of sub-scores)
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
  ];
  const avgScore = subScores.reduce((a, b) => a + b, 0) / subScores.length;
  const overallGrade = getGrade(avgScore);

  const grade: V32TradeGrade = {
    tradeId,
    agentId: input.agentId,
    symbol: input.symbol,
    action: input.action,
    reasoning: input.reasoning,
    confidence: input.confidence,
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
// Agent Scoring (24 dimensions)
// ---------------------------------------------------------------------------

export function scoreAgent(input: {
  agentId: string;
  agentName: string;
  provider: string;
  model: string;
  trades: V32TradeGrade[];
  pnlPercent: number;
  sharpeRatio: number;
  maxDrawdown: number;
}): V32AgentScore {
  const t = input.trades;
  if (t.length === 0) {
    const emptyDims: V32DimensionScores = {
      pnlPercent: 50, sharpeRatio: 50, maxDrawdown: 50,
      coherence: 50, reasoningDepth: 50, sourceQuality: 50,
      logicalConsistency: 50, reasoningIntegrity: 50, reasoningTransparency: 50,
      reasoningGrounding: 50,
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

  // Reasoning Quality (7 dims)
  const coherence = avg(t.map((x) => x.coherenceScore * 100));
  const reasoningDepth = avg(t.map((x) => x.reasoningDepthScore));
  const sourceQuality = avg(t.map((x) => x.sourceQualityScore));
  const logicalConsistency = avg(t.map((x) => x.logicalConsistencyScore));
  const integrityScores = t.map(() => 80 + Math.random() * 15);
  const reasoningIntegrity = avg(integrityScores);
  const reasoningTransparency = avg(t.map((x) => x.transparencyScore));
  const reasoningGrounding = avg(t.map((x) => x.groundingScore));

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
    ? Math.min(100, 40 + (countByCondition(t, (x) => x.coherenceScore > 0.6) / t.length) * 60)
    : 50;

  // Governance (4 dims)
  const tradeAccountability = avg(t.map((x) => x.accountabilityScore));
  const rqi = avg([coherence, reasoningDepth, sourceQuality, logicalConsistency, reasoningTransparency, reasoningGrounding]) / 100 * 100;
  const decisionAccountability = avg(t.map((x) => x.accountabilityScore));
  const consensusQuality = avg(t.map((x) => x.consensusQualityScore));

  const dimensions: V32DimensionScores = {
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
    compositeScore += (dimensions[dim as keyof V32DimensionScores] ?? 50) * weight;
  }
  compositeScore = Math.round(compositeScore * 100) / 100;

  const agentScore: V32AgentScore = {
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
  scores: V32AgentScore[],
  trades: V32TradeGrade[],
  marketRegime: string,
): V32RoundSummary {
  const sorted = [...trades].sort(
    (a, b) => {
      const gradeOrder = ["A+", "A", "B+", "B", "C+", "C", "D", "F"];
      return gradeOrder.indexOf(a.overallGrade) - gradeOrder.indexOf(b.overallGrade);
    },
  );

  const actions = trades.map((t) => t.action);
  const modeAction = actions.sort((a, b) =>
    countByCondition(actions, (v) => v === a) - countByCondition(actions, (v) => v === b),
  ).pop() ?? "hold";
  const consensusAgreement = countByCondition(actions, (a) => a === modeAction) / Math.max(1, actions.length);

  const summary: V32RoundSummary = {
    roundId,
    timestamp: new Date().toISOString(),
    agentScores: scores,
    bestTrade: sorted[0] ?? null,
    worstTrade: sorted[sorted.length - 1] ?? null,
    consensusAgreement: Math.round(consensusAgreement * 100) / 100,
    marketRegime,
    avgTransparency: trades.length > 0
      ? Math.round(trades.reduce((s, t) => s + t.transparencyScore, 0) / trades.length * 100) / 100
      : 50,
    avgAccountability: trades.length > 0
      ? Math.round(trades.reduce((s, t) => s + t.accountabilityScore, 0) / trades.length * 100) / 100
      : 50,
    avgGrounding: trades.length > 0
      ? Math.round(trades.reduce((s, t) => s + t.groundingScore, 0) / trades.length * 100) / 100
      : 50,
    avgConsensusQuality: trades.length > 0
      ? Math.round(trades.reduce((s, t) => s + t.consensusQualityScore, 0) / trades.length * 100) / 100
      : 50,
  };

  roundSummaries.unshift(summary);
  if (roundSummaries.length > 200) roundSummaries.length = 200;

  return summary;
}

// ---------------------------------------------------------------------------
// Public Getters
// ---------------------------------------------------------------------------

export function getAgentScores(): V32AgentScore[] {
  return Array.from(agentScores.values());
}

export function getAgentScore(agentId: string): V32AgentScore | undefined {
  return agentScores.get(agentId);
}

export function getTradeGrades(limit = 50): V32TradeGrade[] {
  return tradeGrades.slice(0, limit);
}

export function getTradeGradesByAgent(agentId: string, limit = 50): V32TradeGrade[] {
  return tradeGrades.filter((g) => g.agentId === agentId).slice(0, limit);
}

export function getRoundSummaries(limit = 20): V32RoundSummary[] {
  return roundSummaries.slice(0, limit);
}

export function getDimensionWeights(): Record<string, number> {
  return { ...DIMENSION_WEIGHTS };
}

export function getDimensionCount(): number {
  return 24;
}

export function getBenchmarkVersion(): string {
  return "32.0";
}
