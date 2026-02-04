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
  const maxScore = 100;

  // 1. Spread Awareness (0-20)
  let spreadScore = 0;

  const spreadPatterns = /\b(?:bid[- ]?ask\s+spread|spread\s+(?:is|at|of|around)|slippage\s+(?:risk|estimate|expected|of)|price\s+impact|execution\s+cost|market\s+order\s+cost|limit\s+order|fill\s+price|crossing\s+the\s+spread)\b/gi;
  const spreadMatches = reasoning.match(spreadPatterns) ?? [];
  spreadScore += Math.min(12, spreadMatches.length * 4);

  // Specific basis point or percentage spread references
  const bpsPatterns = /\b(?:\d+\s*(?:bps|basis\s+points?)|spread\s+of\s+\$?[\d.]+%?|[\d.]+%?\s+spread)\b/gi;
  const bpsMatches = reasoning.match(bpsPatterns) ?? [];
  spreadScore += Math.min(8, bpsMatches.length * 4);

  score += Math.min(20, spreadScore);

  // 2. Liquidity Assessment (0-20)
  let liquidityScore = 0;

  const liquidityPatterns = /\b(?:liquid(?:ity)?|volume\s+(?:is|at|of|supports?)|order\s+book\s+depth|thin(?:ly)?\s+traded|depth\s+of\s+(?:market|book)|average\s+daily\s+volume|ADV|market\s+depth|bid\s+size|ask\s+size|level\s*2|book\s+is\s+(?:thick|thin|deep|shallow))\b/gi;
  const liquidityMatches = reasoning.match(liquidityPatterns) ?? [];
  liquidityScore += Math.min(12, liquidityMatches.length * 4);

  // Quantitative volume references
  const volumeQuantPatterns = /\b(?:\$[\d.]+[MBK]?\s+(?:volume|traded)|[\d,]+\s+shares?\s+(?:volume|traded)|volume\s+of\s+[\d,.]+|[\d.]+[xX]\s+(?:average|normal)\s+volume)\b/gi;
  const volumeQuantMatches = reasoning.match(volumeQuantPatterns) ?? [];
  liquidityScore += Math.min(8, volumeQuantMatches.length * 4);

  score += Math.min(20, liquidityScore);

  // 3. Execution Strategy (0-20)
  let executionScore = 0;

  const executionPatterns = /\b(?:TWAP|VWAP|iceberg\s+order|DCA|dollar[- ]cost\s+averag|scale\s+(?:in|out)|partial\s+fill|limit\s+(?:order|price)|market\s+(?:on\s+close|on\s+open)|staged\s+execution|split\s+(?:the\s+)?order|time[- ]weighted)\b/gi;
  const executionMatches = reasoning.match(executionPatterns) ?? [];
  executionScore += Math.min(12, executionMatches.length * 5);

  // Timing-related execution
  const timingPatterns = /\b(?:trade\s+during\s+(?:high|peak)\s+volume|avoid\s+(?:open|close|low\s+volume)|execute\s+(?:at|near|around)|best\s+execution|minimize\s+(?:impact|slippage|cost))\b/gi;
  const timingMatches = reasoning.match(timingPatterns) ?? [];
  executionScore += Math.min(8, timingMatches.length * 4);

  score += Math.min(20, executionScore);

  // 4. Market Impact Awareness (0-20)
  let impactScore = 0;

  const impactPatterns = /\b(?:market\s+impact|price\s+impact|move\s+the\s+(?:market|price)|footprint|information\s+leakage|front[- ]running\s+risk|signaling|adverse\s+selection|toxic\s+flow|order\s+flow)\b/gi;
  const impactMatches = reasoning.match(impactPatterns) ?? [];
  impactScore += Math.min(12, impactMatches.length * 4);

  // Size-relative impact awareness
  if (quantity > 0) {
    const sizeAwarePatterns = /\b(?:position\s+size\s+relative|too\s+large\s+for|appropriate\s+size|sizing\s+based\s+on\s+(?:liquidity|volume)|size\s+vs\s+ADV|percentage\s+of\s+(?:volume|float))\b/gi;
    const sizeAwareMatches = reasoning.match(sizeAwarePatterns) ?? [];
    impactScore += Math.min(8, sizeAwareMatches.length * 4);
  } else {
    impactScore += 2; // Partial credit if quantity is 0 (hold)
  }

  score += Math.min(20, impactScore);

  // 5. Cost Consciousness (0-20)
  let costScore = 0;

  const costPatterns = /\b(?:transaction\s+cost|trading\s+cost|commission|fee(?:s)?\s+(?:of|at|around)|gas\s+(?:fee|cost)|network\s+fee|Jupiter\s+(?:fee|route)|swap\s+fee|total\s+cost|all[- ]in\s+cost|net\s+(?:of|after)\s+(?:fees|costs))\b/gi;
  const costMatches = reasoning.match(costPatterns) ?? [];
  costScore += Math.min(12, costMatches.length * 4);

  // Slippage tolerance
  const slippagePatterns = /\b(?:slippage\s+(?:tolerance|limit|of|around|expected)|max\s+slippage|acceptable\s+slippage|[\d.]+%?\s+slippage)\b/gi;
  const slippageMatches = reasoning.match(slippagePatterns) ?? [];
  costScore += Math.min(8, slippageMatches.length * 4);

  score += Math.min(20, costScore);

  // Bonus: agent references sources related to execution
  const execSources = sources.filter((s) =>
    /volume|liquidity|order.*book|execution|slippage/i.test(s),
  );
  if (execSources.length > 0) {
    score += Math.min(5, execSources.length * 3);
  }

  return Math.round(Math.min(maxScore, Math.max(0, score)));
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
  const maxScore = 100;

  // Normalize confidence to 0-1 if needed
  const conf = confidence > 1 ? confidence / 100 : confidence;

  // 1. Evidence-Confidence Alignment (0-25)
  // High confidence should come with specific evidence
  let evidenceScore = 0;

  const specificEvidencePatterns = /\b(?:specifically|in particular|data shows|evidence suggests|according to|based on (?:the|specific)|the numbers indicate|quantitatively|measured at|confirmed by)\b/gi;
  const evidenceMatches = reasoning.match(specificEvidencePatterns) ?? [];
  const evidenceDensity = evidenceMatches.length / Math.max(1, reasoning.split(/\s+/).length / 50);

  // Higher confidence needs more evidence
  if (conf >= 0.8) {
    // High confidence: need strong evidence
    if (evidenceDensity >= 1.5) evidenceScore = 25;
    else if (evidenceDensity >= 1.0) evidenceScore = 20;
    else if (evidenceDensity >= 0.5) evidenceScore = 12;
    else evidenceScore = 5; // High confidence + low evidence = bad
  } else if (conf >= 0.5) {
    // Moderate confidence: moderate evidence is fine
    if (evidenceDensity >= 1.0) evidenceScore = 22;
    else if (evidenceDensity >= 0.5) evidenceScore = 20;
    else evidenceScore = 15;
  } else {
    // Low confidence: some evidence should still exist
    if (evidenceDensity >= 0.5) evidenceScore = 20;
    else if (evidenceDensity > 0) evidenceScore = 18;
    else evidenceScore = 12;
  }

  // Penalize high confidence when hallucinations present
  if (conf >= 0.7 && hallucinationFlags.length > 0) {
    evidenceScore = Math.max(0, evidenceScore - hallucinationFlags.length * 5);
  }

  score += Math.min(25, evidenceScore);

  // 2. Source-Confidence Calibration (0-25)
  // More sources + high confidence = good. Few sources + high confidence = bad.
  let sourceScore = 0;

  const sourceCount = sources.length;
  const expectedSources = conf >= 0.8 ? 4 : conf >= 0.5 ? 2 : 1;

  if (sourceCount >= expectedSources) {
    sourceScore = 20 + Math.min(5, (sourceCount - expectedSources) * 2);
  } else {
    const shortfall = expectedSources - sourceCount;
    sourceScore = Math.max(5, 20 - shortfall * 5);
  }

  // Bonus for diverse source types
  const uniqueSourceTypes = new Set(sources.map((s) => s.split("_")[0]));
  if (uniqueSourceTypes.size >= 3) sourceScore += 3;

  score += Math.min(25, sourceScore);

  // 3. Hedging-Confidence Coherence (0-20)
  // High confidence + lots of hedging = inconsistent
  // Low confidence + no hedging = inconsistent
  let hedgingScore = 0;

  const hedgingPatterns = /\b(?:however|although|but|risk|uncertain|might|could|possibly|potential downside|caveat|on the other hand|that said|admittedly|if (?:the|this) fails)\b/gi;
  const hedgingMatches = reasoning.match(hedgingPatterns) ?? [];
  const hedgingDensity = hedgingMatches.length / Math.max(1, reasoning.split(/\s+/).length / 50);

  if (conf >= 0.8) {
    // High confidence: some hedging is OK (shows awareness), too much is inconsistent
    if (hedgingDensity >= 0 && hedgingDensity <= 1) hedgingScore = 18;
    else if (hedgingDensity <= 2) hedgingScore = 14;
    else hedgingScore = 6; // Too much hedging for high confidence
  } else if (conf >= 0.5) {
    // Moderate confidence: hedging is expected
    if (hedgingDensity >= 0.5 && hedgingDensity <= 3) hedgingScore = 18;
    else if (hedgingDensity > 3) hedgingScore = 12;
    else hedgingScore = 10; // No hedging at moderate confidence is slightly off
  } else {
    // Low confidence: hedging should be present
    if (hedgingDensity >= 1) hedgingScore = 18;
    else if (hedgingDensity > 0) hedgingScore = 14;
    else hedgingScore = 6; // Low confidence but no hedging = weird
  }

  // Bonus for explicit uncertainty quantification
  const uncertaintyQuantPatterns = /\b(?:probability\s+(?:of|around|at)\s+[\d]+%|[\d]+%\s+(?:chance|probability|likelihood)|odds (?:are|of)|risk[- ]reward\s+(?:ratio|of))\b/gi;
  const uncertaintyQuantMatches = reasoning.match(uncertaintyQuantPatterns) ?? [];
  if (uncertaintyQuantMatches.length > 0) hedgingScore += 3;

  score += Math.min(20, hedgingScore);

  // 4. Historical Accuracy Match (0-15)
  // Does this agent's confidence historically predict outcomes?
  let accuracyScore = 0;

  if (previousOutcomes.length >= 3) {
    // Bin outcomes by confidence level
    const highConfTrades = previousOutcomes.filter((o) => o.confidence >= 0.7);
    const lowConfTrades = previousOutcomes.filter((o) => o.confidence < 0.4);

    const highConfAccuracy = highConfTrades.length > 0
      ? highConfTrades.filter((o) => o.correct).length / highConfTrades.length
      : 0.5;
    const lowConfAccuracy = lowConfTrades.length > 0
      ? lowConfTrades.filter((o) => o.correct).length / lowConfTrades.length
      : 0.5;

    // High confidence should be more accurate than low confidence
    if (highConfAccuracy > lowConfAccuracy) {
      accuracyScore = 12; // Good calibration
    } else if (highConfAccuracy === lowConfAccuracy) {
      accuracyScore = 8; // Neutral
    } else {
      accuracyScore = 3; // Inverted — high confidence is LESS accurate
    }

    // Bonus for overall calibration
    const overallAccuracy = previousOutcomes.filter((o) => o.correct).length / previousOutcomes.length;
    if (Math.abs(overallAccuracy - conf) < 0.2) accuracyScore += 3;
  } else {
    // Not enough data — partial credit
    accuracyScore = 8;
  }

  score += Math.min(15, accuracyScore);

  // 5. Reasoning Depth Proportionality (0-15)
  // More words/clauses should correlate with higher confidence
  let depthScore = 0;

  const wordCount = reasoning.split(/\s+/).length;
  const clauseCount = reasoning.split(/[.;!?]/).filter((s) => s.trim().length > 0).length;

  if (conf >= 0.8) {
    // High confidence needs deep reasoning
    if (wordCount >= 80 && clauseCount >= 5) depthScore = 15;
    else if (wordCount >= 50 && clauseCount >= 3) depthScore = 10;
    else depthScore = 4; // Shallow reasoning + high confidence
  } else if (conf >= 0.5) {
    if (wordCount >= 40 && clauseCount >= 3) depthScore = 13;
    else if (wordCount >= 25) depthScore = 10;
    else depthScore = 7;
  } else {
    // Low confidence: even brief reasoning is OK
    if (wordCount >= 20) depthScore = 12;
    else depthScore = 8;
  }

  // Coherence bonus — if reasoning and action are coherent, conviction is more trustworthy
  if (coherenceScore >= 0.7) depthScore = Math.min(15, depthScore + 2);

  score += Math.min(15, depthScore);

  return Math.round(Math.min(maxScore, Math.max(0, score)));
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
  const tradeId = `v36_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

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
      pnlPercent: 50, sharpeRatio: 50, maxDrawdown: 50,
      coherence: 50, reasoningDepth: 50, sourceQuality: 50,
      logicalConsistency: 50, reasoningIntegrity: 50, reasoningTransparency: 50,
      reasoningGrounding: 50, causalReasoning: 50, epistemicHumility: 50,
      reasoningTraceability: 50, adversarialCoherence: 50,
      informationAsymmetry: 50, temporalReasoningQuality: 50,
      reasoningAuditability: 50, decisionReversibility: 50,
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

  // Reasoning Quality (15 dims)
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
