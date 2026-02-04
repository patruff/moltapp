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
// ---------------------------------------------------------------------------

const DIMENSION_WEIGHTS: Record<keyof V37DimensionScores, number> = {
  pnlPercent: 0.04,                // reduced from 0.05
  sharpeRatio: 0.04,               // reduced from 0.05
  maxDrawdown: 0.04,
  coherence: 0.04,                 // reduced from 0.05
  reasoningDepth: 0.04,
  sourceQuality: 0.03,
  logicalConsistency: 0.03,
  reasoningIntegrity: 0.03,
  reasoningTransparency: 0.03,
  reasoningGrounding: 0.03,
  causalReasoning: 0.03,           // reduced from 0.04
  epistemicHumility: 0.03,         // reduced from 0.04
  reasoningTraceability: 0.03,
  adversarialCoherence: 0.03,
  informationAsymmetry: 0.03,
  temporalReasoningQuality: 0.03,
  reasoningAuditability: 0.03,     // reduced from 0.04
  decisionReversibility: 0.03,     // reduced from 0.04
  reasoningComposability: 0.03,    // NEW
  strategicForesight: 0.03,        // NEW
  hallucinationRate: 0.04,         // reduced from 0.05
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
  modularityScore += Math.min(8, independenceMatches.length * 4);

  // Sequential/numbered arguments
  const sequentialPatterns = /\b(?:first(?:ly)?[,:]|second(?:ly)?[,:]|third(?:ly)?[,:]|fourth(?:ly)?[,:]|1[\.\)]\s|2[\.\)]\s|3[\.\)]\s|4[\.\)]\s|point\s+(?:one|two|three|four)|argument\s+\d|reason\s+\d)\b/gi;
  const sequentialMatches = reasoning.match(sequentialPatterns) ?? [];
  modularityScore += Math.min(8, sequentialMatches.length * 3);

  // Bullet-style or list-style reasoning
  const bulletPatterns = /(?:^|\n)\s*[-*>]\s+\S/gm;
  const bulletMatches = reasoning.match(bulletPatterns) ?? [];
  modularityScore += Math.min(4, bulletMatches.length * 2);

  score += Math.min(20, modularityScore);

  // 2. Cross-Trade Reasoning Reuse (0-20)
  // Detect callbacks to previous analysis like "consistent with my thesis",
  // "as I noted", "building on", "reaffirming", "updating my view"
  let reuseScore = 0;

  const callbackPatterns = /\b(?:consistent with (?:my|our|the) (?:thesis|view|analysis|prior)|as I (?:noted|mentioned|observed|argued)|building on (?:my|our|the|previous)|reaffirming (?:my|our|the)|updating (?:my|our) (?:view|thesis|model|outlook)|in line with (?:my|our) (?:previous|earlier|prior)|confirms? (?:my|our) (?:earlier|previous|prior)|reinforc(?:es?|ing) (?:my|our) (?:thesis|view|conviction)|as previously (?:discussed|noted|analyzed|stated))\b/gi;
  const callbackMatches = reasoning.match(callbackPatterns) ?? [];
  reuseScore += Math.min(12, callbackMatches.length * 4);

  // Cross-reference with actual previous reasonings
  if (previousReasonings.length > 0) {
    // Check if key phrases from previous reasoning appear
    let sharedConcepts = 0;
    for (const prev of previousReasonings) {
      const prevWords = prev.toLowerCase().split(/\s+/).filter((w) => w.length > 5);
      const currentWords = new Set(reasoning.toLowerCase().split(/\s+/));
      const overlap = prevWords.filter((w) => currentWords.has(w)).length;
      if (overlap >= 3) sharedConcepts++;
    }
    reuseScore += Math.min(8, sharedConcepts * 4);
  } else {
    // No previous reasoning to compare — partial credit for self-referential structure
    reuseScore += 3;
  }

  score += Math.min(20, reuseScore);

  // 3. Hierarchical Structure (0-20)
  // Detect thesis -> sub-claims -> evidence structure.
  // Look for "my thesis is", "supporting this:", "evidence:", "because", "therefore"
  let hierarchyScore = 0;

  const thesisPatterns = /\b(?:my thesis (?:is|remains)|(?:core|central|main|overall) (?:thesis|argument|claim|view)|I (?:believe|argue|contend|maintain) that|the (?:key|main) (?:point|takeaway) is)\b/gi;
  const thesisMatches = reasoning.match(thesisPatterns) ?? [];
  hierarchyScore += Math.min(6, thesisMatches.length * 3);

  const subClaimPatterns = /\b(?:supporting this[,:]|sub-?claim|in support|additional(?:ly)?[,:]|furthermore[,:]|moreover[,:]|another (?:factor|reason|point)|a (?:key|second|further) (?:factor|point|consideration))\b/gi;
  const subClaimMatches = reasoning.match(subClaimPatterns) ?? [];
  hierarchyScore += Math.min(6, subClaimMatches.length * 3);

  const evidencePatterns = /\b(?:evidence[:\s]|the data (?:shows?|suggests?|indicates?)|because\b|therefore\b|this is (?:supported|evidenced|shown) by|as (?:shown|demonstrated|indicated) by|proof (?:of|that)|specifically[,:])\b/gi;
  const evidenceMatches = reasoning.match(evidencePatterns) ?? [];
  hierarchyScore += Math.min(8, evidenceMatches.length * 3);

  score += Math.min(20, hierarchyScore);

  // 4. Transferable Insights (0-20)
  // Detect general principles the agent articulates that apply beyond this trade.
  // e.g. "sectors with X tend to Y", "when interest rates Z, tech stocks..."
  let transferScore = 0;

  const generalPrinciplePatterns = /\b(?:sectors? with .{3,30} tend to|when (?:interest rates?|inflation|the Fed|GDP|earnings|volatility) .{3,30}(?:stocks?|equities|bonds?|crypto|assets?)|historically[,:]|as a (?:general )?rule|in (?:general|principle)|this pattern (?:suggests|indicates|shows)|a broader (?:trend|pattern|lesson)|the (?:lesson|takeaway|implication) (?:here )?is|this (?:applies|extends|generalizes) (?:to|beyond)|more (?:broadly|generally))\b/gi;
  const generalPrincipleMatches = reasoning.match(generalPrinciplePatterns) ?? [];
  transferScore += Math.min(12, generalPrincipleMatches.length * 4);

  // Framework-level thinking
  const frameworkPatterns = /\b(?:framework|mental model|heuristic|rule of thumb|first principles?|structural(?:ly)?|systematic(?:ally)?|paradigm|regime[- ]dependent|cycle[- ](?:dependent|aware)|macro (?:framework|lens|perspective))\b/gi;
  const frameworkMatches = reasoning.match(frameworkPatterns) ?? [];
  transferScore += Math.min(8, frameworkMatches.length * 3);

  score += Math.min(20, transferScore);

  // 5. Synthesis Quality (0-20)
  // Are sub-arguments combined coherently? Reward "combining these factors",
  // "on balance", "weighing X against Y", "net assessment"
  let synthesisScore = 0;

  const synthesisPatterns = /\b(?:combining these (?:factors|arguments|points|considerations)|on balance|weighing .{3,30} against|net assessment|all (?:things )?considered|taking (?:everything|all) (?:into account|together)|in (?:sum|summary|aggregate|total)|the (?:combined|cumulative|overall|net) (?:effect|impact|picture|view)|pulling (?:it|this|these) (?:all )?together|synthesizing|the (?:bottom line|upshot) is)\b/gi;
  const synthesisMatches = reasoning.match(synthesisPatterns) ?? [];
  synthesisScore += Math.min(12, synthesisMatches.length * 4);

  // Connective tissue between arguments
  const connectivePatterns = /\b(?:this (?:combined|coupled|paired) with|together (?:with|these)|in conjunction (?:with)?|alongside|coupled with|layered on top|in addition to the (?:above|previous)|building on (?:this|the above))\b/gi;
  const connectiveMatches = reasoning.match(connectivePatterns) ?? [];
  synthesisScore += Math.min(8, connectiveMatches.length * 3);

  score += Math.min(20, synthesisScore);

  // Bonus: high source count suggests modular research
  if (sources.length >= 4) {
    score += Math.min(5, (sources.length - 3) * 2);
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
  chainScore += Math.min(12, causalChainMatches.length * 4);

  // Multi-step "leads to" chains
  const leadsToPatterns = /\b(?:leads? to|results? in|causes?|triggers?|drives?)\b/gi;
  const leadsToMatches = fullText.match(leadsToPatterns) ?? [];
  // More "leads to" connectors = longer causal chains
  if (leadsToMatches.length >= 3) chainScore += 8;
  else if (leadsToMatches.length >= 2) chainScore += 5;
  else if (leadsToMatches.length >= 1) chainScore += 2;

  score += Math.min(20, chainScore);

  // 2. Scenario Branching (0-20)
  // Detect if/then/else reasoning: "If Fed holds rates, growth stocks rally.
  // If Fed hikes, rotate to defensives"
  let branchScore = 0;

  const ifThenPatterns = /\b(?:if .{5,80}(?:then|,\s*(?:I|we|the|this))|in (?:the )?(?:case|event|scenario) (?:that|of|where)|should .{3,40}(?:then|,\s*(?:I|we))|assuming .{3,40}(?:then|,))\b/gi;
  const ifThenMatches = fullText.match(ifThenPatterns) ?? [];
  branchScore += Math.min(8, ifThenMatches.length * 3);

  const elsePatterns = /\b(?:(?:else|otherwise|alternatively|conversely|on the other hand|if (?:instead|not|however))[,:]?\s+.{5,}|(?:bull|bear|base)\s+(?:case|scenario)|(?:upside|downside|base)\s+(?:case|scenario)|scenario (?:1|2|3|one|two|three|A|B|C))\b/gi;
  const elseMatches = fullText.match(elsePatterns) ?? [];
  branchScore += Math.min(8, elseMatches.length * 3);

  // Explicit scenario analysis
  const scenarioPatterns = /\b(?:scenario analysis|decision tree|contingent on|probability[- ]weighted|range of outcomes|multiple scenarios|best[- ]case .{3,30} worst[- ]case)\b/gi;
  const scenarioMatches = fullText.match(scenarioPatterns) ?? [];
  branchScore += Math.min(4, scenarioMatches.length * 2);

  score += Math.min(20, branchScore);

  // 3. Opportunity Cost Awareness (0-20)
  // Detect what agent considered but rejected: "Chose X over Y because",
  // "could have bought Z but", "opportunity cost"
  let opportunityScore = 0;

  const rejectionPatterns = /\b(?:(?:chose|choosing|picked|selected|prefer(?:red)?) .{3,40} (?:over|instead of|rather than)|could (?:have|alternatively) (?:bought|sold|traded|invested|chosen)|opportunity cost|(?:trade|trading)[- ]off|alternative(?:ly|s)?[,:]?\s+(?:I|we) could|instead of .{3,40}(?:I|we) (?:chose|opted|decided)|passed on|opted (?:not to|against)|decided against|the (?:alternative|other option) (?:was|would be))\b/gi;
  const rejectionMatches = fullText.match(rejectionPatterns) ?? [];
  opportunityScore += Math.min(12, rejectionMatches.length * 4);

  // Comparative analysis
  const comparativePatterns = /\b(?:compared to|relative to|versus|vs\.?\s+|better (?:risk[- ]reward|opportunity) in|more attractive than|less compelling than|higher (?:conviction|upside) in .{3,30} than)\b/gi;
  const comparativeMatches = fullText.match(comparativePatterns) ?? [];
  opportunityScore += Math.min(8, comparativeMatches.length * 3);

  score += Math.min(20, opportunityScore);

  // 4. Portfolio-Level Thinking (0-20)
  // Detect reasoning about how this trade fits the overall portfolio:
  // "This diversifies my", "reduces correlation with", "complements my position in"
  let portfolioScore = 0;

  const portfolioPatterns = /\b(?:(?:this )?diversif(?:ies|ying|ication)|reduces? (?:my|our|portfolio) (?:correlation|risk|exposure)|complements? (?:my|our) (?:position|holding|exposure|portfolio)|portfolio[- ]level|overall (?:portfolio|allocation|exposure|position)|position sizing|risk budget|(?:adds?|adding) (?:to (?:my|our) )?(?:exposure|allocation)|(?:overweight|underweight|neutral)[- ]?(?:ing)?|rebalanc(?:e|ing)|concentration risk|sector (?:exposure|allocation|balance))\b/gi;
  const portfolioMatches = fullText.match(portfolioPatterns) ?? [];
  portfolioScore += Math.min(12, portfolioMatches.length * 4);

  // Correlation/hedging awareness
  const correlationPatterns = /\b(?:correlat(?:ed|ion)|hedge(?:d|s|ing)?|offset(?:s|ting)?|uncorrelated|negative(?:ly)? correlated|tail[- ]risk|(?:beta|delta)[- ](?:neutral|adjusted)|risk[- ]adjusted (?:return|exposure)|Sharpe[- ]optimal)\b/gi;
  const correlationMatches = fullText.match(correlationPatterns) ?? [];
  portfolioScore += Math.min(8, correlationMatches.length * 3);

  score += Math.min(20, portfolioScore);

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
  if (timeframesUsed >= 3) timeframeScore += 14;
  else if (timeframesUsed === 2) timeframeScore += 10;
  else if (timeframesUsed === 1) timeframeScore += 5;

  // Explicit integration across timeframes
  const integrationPatterns = /\b(?:short[- ]term .{5,60} (?:but|while|whereas) .{5,60} long[- ]term|near[- ]term .{5,60} (?:but|while) .{5,60} (?:medium|long)[- ]term|across (?:time )?(?:horizons|frames|periods)|time[- ]horizon (?:analysis|integration|alignment)|(?:tactically|strategically) .{5,30} (?:but|while) (?:strategically|tactically))\b/gi;
  const integrationMatches = fullText.match(integrationPatterns) ?? [];
  timeframeScore += Math.min(6, integrationMatches.length * 3);

  score += Math.min(20, timeframeScore);

  // Bonus: sources that span multiple timeframes or strategic content
  const strategicSources = sources.filter((s) =>
    /strategy|outlook|forecast|scenario|macro|allocation|portfolio/i.test(s),
  );
  if (strategicSources.length > 0) {
    score += Math.min(5, strategicSources.length * 3);
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
