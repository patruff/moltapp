/**
 * V37 Benchmark Engine — 34-Dimension AI Trading Benchmark
 *
 * Extends v36's 32-dimension framework with:
 * - Reasoning Synthesis Quality: Can the agent synthesize information from
 *   multiple heterogeneous sources into a unified, coherent thesis? Measures
 *   cross-source integration, conflicting data reconciliation, multi-modal
 *   reasoning (price + volume + news + sentiment), evidence weighting, and
 *   synthesis originality. Agents that parrot a single source score poorly.
 *
 * - Strategic Foresight: Does the agent reason about second- and third-order
 *   effects, not just immediate price direction? Measures scenario planning
 *   depth, cascading effect awareness, portfolio-level thinking, opportunity
 *   cost analysis, and position sizing rationale. Agents that only say
 *   "price will go up" without strategic context score poorly.
 *
 * Categories (34 dimensions):
 * - Financial Performance (3): pnl, sharpe, drawdown
 * - Reasoning Quality (17): coherence, depth, source, consistency,
 *   integrity, transparency, grounding, causal, epistemic,
 *   traceability, adversarial, info asymmetry, temporal,
 *   auditability, reversibility, synthesis (NEW), foresight (NEW)
 * - Safety & Trust (3): hallucination, discipline, risk awareness
 * - Behavioral Intelligence (4): consistency, adaptability, calibration, learning
 * - Predictive Power (3): outcome, regime, edge
 * - Governance & Accountability (4): accountability, RQI, decision accountability, consensus
 */

import { createHash } from "crypto";

// Import inherited scoring functions from v36
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

// Re-export for consumers
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
};

// ---------------------------------------------------------------------------
// Types for the 34 dimensions
// ---------------------------------------------------------------------------

export interface V37DimensionScores {
  // Financial Performance (3 dims)
  pnlPercent: number;
  sharpeRatio: number;
  maxDrawdown: number;
  // Reasoning Quality (17 dims — 15 from v36 + synthesis + foresight)
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
  reasoningComposability: number;  // NEW
  strategicForesight: number;          // NEW
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
  strategicForesightScore: number;    // NEW
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
  avgStrategicForesight: number;    // NEW
}

// ---------------------------------------------------------------------------
// In-memory storage
// ---------------------------------------------------------------------------

const agentScores = new Map<string, V37AgentScore>();
const tradeGrades: V37TradeGrade[] = [];
const roundSummaries: V37RoundSummary[] = [];

// ---------------------------------------------------------------------------
// Dimension weights (must sum to 1.0) — 34 entries
// ---------------------------------------------------------------------------

const DIMENSION_WEIGHTS: Record<keyof V37DimensionScores, number> = {
  pnlPercent: 0.04,
  sharpeRatio: 0.04,
  maxDrawdown: 0.04,
  coherence: 0.04,
  reasoningDepth: 0.04,
  sourceQuality: 0.03,
  logicalConsistency: 0.03,
  reasoningIntegrity: 0.03,
  reasoningTransparency: 0.03,
  reasoningGrounding: 0.03,
  causalReasoning: 0.03,
  epistemicHumility: 0.03,
  reasoningTraceability: 0.03,
  adversarialCoherence: 0.03,
  informationAsymmetry: 0.03,
  temporalReasoningQuality: 0.03,
  reasoningAuditability: 0.03,
  decisionReversibility: 0.03,
  reasoningComposability: 0.04,   // NEW
  strategicForesight: 0.04,           // NEW
  hallucinationRate: 0.04,
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
  decisionAccountability: 0.02,
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
// NEW v37: Reasoning Synthesis Quality
// ---------------------------------------------------------------------------

/**
 * Can the agent synthesize information from multiple heterogeneous sources
 * into a unified, coherent investment thesis? This dimension distinguishes
 * agents that truly integrate multiple data streams from agents that
 * merely list facts from a single source.
 *
 * Measures:
 * 1. Cross-Source Integration (0-20): Does reasoning weave together data from
 *    multiple source types (price, volume, news, fundamentals, sentiment)?
 * 2. Conflicting Data Reconciliation (0-20): When sources disagree, does the
 *    agent acknowledge and resolve the conflict?
 * 3. Multi-Modal Reasoning (0-20): Does the agent combine quantitative
 *    (numbers, percentages) with qualitative (narrative, context) reasoning?
 * 4. Evidence Weighting (0-20): Does the agent assign different weights to
 *    different evidence, explaining why some data matters more?
 * 5. Synthesis Originality (0-20): Does the combined analysis yield a novel
 *    insight, or just restate what each source said independently?
 */
export function scoreReasoningComposability(
  reasoning: string,
  sources: string[],
  peerReasonings: string[],
): number {
  let score = 0;
  const maxScore = 100;

  // 1. Cross-Source Integration (0-20)
  let crossSourceScore = 0;

  // Count distinct data domain references in reasoning
  const dataDomains = [
    { pattern: /\b(?:price|trading\s+at|\$[\d,.]+|quote|bid|ask)\b/i, domain: "price" },
    { pattern: /\b(?:volume|liquidity|traded\s+[\d,]+|ADV|average\s+daily)\b/i, domain: "volume" },
    { pattern: /\b(?:news|headline|announced|report(?:ed|s)|earnings|guidance)\b/i, domain: "news" },
    { pattern: /\b(?:P\/E|revenue|margin|EPS|fundamentals?|valuation|book\s+value)\b/i, domain: "fundamentals" },
    { pattern: /\b(?:sentiment|mood|fear|greed|bullish\s+consensus|bearish\s+consensus)\b/i, domain: "sentiment" },
    { pattern: /\b(?:RSI|MACD|moving\s+average|bollinger|technical|support|resistance)\b/i, domain: "technical" },
    { pattern: /\b(?:sector|peer|industry|correlation|relative\s+to|compared\s+to)\b/i, domain: "sector" },
    { pattern: /\b(?:macro|Fed|interest\s+rate|GDP|inflation|CPI|employment)\b/i, domain: "macro" },
  ];

  const detectedDomains = new Set<string>();
  for (const { pattern, domain } of dataDomains) {
    if (pattern.test(reasoning)) {
      detectedDomains.add(domain);
    }
  }

  // Integration connectors — language that bridges domains
  const integrationPatterns = /\b(?:combined\s+with|together\s+with|in\s+light\s+of|considering\s+(?:both|all)|cross-referencing|triangulat|corroborat|alongside|when\s+viewed\s+(?:together|holistically)|the\s+confluence\s+of|synthesizing|integrating|taking\s+into\s+account\s+both)\b/gi;
  const integrationMatches = reasoning.match(integrationPatterns) ?? [];

  if (detectedDomains.size >= 4) crossSourceScore = 14;
  else if (detectedDomains.size >= 3) crossSourceScore = 10;
  else if (detectedDomains.size >= 2) crossSourceScore = 6;
  else crossSourceScore = 2;

  crossSourceScore += Math.min(6, integrationMatches.length * 3);
  score += Math.min(20, crossSourceScore);

  // 2. Conflicting Data Reconciliation (0-20)
  let conflictScore = 0;

  const conflictPatterns = /\b(?:however|despite|although|on\s+the\s+other\s+hand|conflicting|contradicts?|mixed\s+signals?|divergen(?:ce|t)|while\s+.*\s+suggests?|tension\s+between|at\s+odds\s+with|notwithstanding)\b/gi;
  const conflictMatches = reasoning.match(conflictPatterns) ?? [];

  const resolutionPatterns = /\b(?:on\s+balance|net\s+(?:effect|result)|weighing|overall|ultimately|the\s+(?:stronger|weaker)\s+signal|I\s+(?:prioritize|weight|favor)|this\s+outweighs|more\s+important(?:ly)?|the\s+decisive\s+factor|tips?\s+the\s+(?:scale|balance))\b/gi;
  const resolutionMatches = reasoning.match(resolutionPatterns) ?? [];

  if (conflictMatches.length > 0 && resolutionMatches.length > 0) {
    // Acknowledged conflict AND resolved it
    conflictScore = 14 + Math.min(6, resolutionMatches.length * 3);
  } else if (conflictMatches.length > 0) {
    // Acknowledged conflict but didn't resolve
    conflictScore = 8;
  } else if (detectedDomains.size >= 3) {
    // Multiple domains but no conflict mentioned — could mean everything aligns
    conflictScore = 10;
  } else {
    conflictScore = 4;
  }

  score += Math.min(20, conflictScore);

  // 3. Multi-Modal Reasoning (0-20)
  let multiModalScore = 0;

  // Quantitative markers
  const quantPatterns = /(?:\$[\d,.]+|[\d,.]+%|\d+x|\d+\.\d+|ratio\s+of|per\s+share|basis\s+points?)/gi;
  const quantMatches = reasoning.match(quantPatterns) ?? [];

  // Qualitative/narrative markers
  const qualPatterns = /\b(?:narrative|story|thesis|context|sentiment|perception|tone|mood|expectation|market\s+psychology|investor\s+(?:confidence|fear)|backdrop)\b/gi;
  const qualMatches = reasoning.match(qualPatterns) ?? [];

  // Causal/logical connectors
  const causalPatterns = /\b(?:because|therefore|consequently|implies|leads\s+to|results?\s+in|driven\s+by|caused\s+by|as\s+a\s+result)\b/gi;
  const causalMatches = reasoning.match(causalPatterns) ?? [];

  const hasQuant = quantMatches.length >= 2;
  const hasQual = qualMatches.length >= 1;
  const hasCausal = causalMatches.length >= 2;

  if (hasQuant && hasQual && hasCausal) multiModalScore = 18;
  else if (hasQuant && hasQual) multiModalScore = 14;
  else if (hasQuant && hasCausal) multiModalScore = 12;
  else if (hasQuant) multiModalScore = 8;
  else multiModalScore = 4;

  // Bonus for explicit quant-to-qual bridge
  if (/\b(?:this\s+(?:data|number|metric)\s+(?:suggests?|indicates?|means?)|quantitatively|the\s+numbers?\s+(?:tell|show|suggest))\b/i.test(reasoning)) {
    multiModalScore += 2;
  }

  score += Math.min(20, multiModalScore);

  // 4. Evidence Weighting (0-20)
  let weightingScore = 0;

  const weightingPatterns = /\b(?:more\s+(?:important(?:ly)?|significant(?:ly)?|relevant|weight)|less\s+(?:important|significant|relevant)|primary\s+(?:driver|factor|reason)|secondary\s+(?:factor|consideration)|the\s+(?:key|main|primary|critical)\s+(?:factor|driver|signal|indicator)|weighted\s+(?:by|toward)|strongest\s+signal|weakest\s+signal|I\s+(?:emphasize|de-emphasize|discount|prioritize)|carries?\s+more\s+weight)\b/gi;
  const weightingMatches = reasoning.match(weightingPatterns) ?? [];

  weightingScore += Math.min(12, weightingMatches.length * 4);

  // Explicit ranking of evidence
  const rankingPatterns = /\b(?:first(?:ly)?|second(?:ly)?|third(?:ly)?|most\s+important(?:ly)?|least\s+important(?:ly)?|primarily|additionally|moreover|furthermore)\b/gi;
  const rankingMatches = reasoning.match(rankingPatterns) ?? [];
  weightingScore += Math.min(8, rankingMatches.length * 2);

  score += Math.min(20, weightingScore);

  // 5. Synthesis Originality (0-20)
  let originalityScore = 0;

  // Check if the conclusion goes beyond just restating inputs
  const synthesisPatterns = /\b(?:this\s+combination|taken\s+together|the\s+(?:bigger|broader|larger)\s+picture|connecting\s+the\s+dots|what\s+this\s+means\s+(?:is|for)|my\s+(?:thesis|conclusion|view)\s+is|putting\s+it\s+(?:all\s+)?together|the\s+(?:key\s+)?insight|I\s+(?:conclude|believe|assess)\s+that|the\s+(?:net|overall)\s+(?:thesis|takeaway|conclusion))\b/gi;
  const synthesisMatches = reasoning.match(synthesisPatterns) ?? [];

  originalityScore += Math.min(10, synthesisMatches.length * 4);

  // Check for unique insight compared to peers
  if (peerReasonings.length > 0) {
    const ownWords = new Set(reasoning.toLowerCase().split(/\s+/).filter((w) => w.length > 4));
    let uniqueWordCount = 0;
    const peerWords = new Set<string>();
    for (const peer of peerReasonings) {
      for (const w of peer.toLowerCase().split(/\s+/).filter((w) => w.length > 4)) {
        peerWords.add(w);
      }
    }
    for (const w of ownWords) {
      if (!peerWords.has(w)) uniqueWordCount++;
    }
    const uniqueRatio = ownWords.size > 0 ? uniqueWordCount / ownWords.size : 0;
    if (uniqueRatio >= 0.3) originalityScore += 6;
    else if (uniqueRatio >= 0.15) originalityScore += 4;
    else originalityScore += 2;
  } else {
    originalityScore += 4; // No peers to compare — partial credit
  }

  // Bonus for source diversity in synthesis
  if (sources.length >= 3 && detectedDomains.size >= 3) {
    originalityScore += 2;
  }

  score += Math.min(20, originalityScore);

  // Bonus: reasoning length indicates synthesis effort
  const wordCount = reasoning.split(/\s+/).length;
  if (wordCount >= 100 && detectedDomains.size >= 3) {
    score += 3;
  }

  return Math.round(Math.min(maxScore, Math.max(0, score)));
}

// ---------------------------------------------------------------------------
// NEW v37: Strategic Foresight
// ---------------------------------------------------------------------------

/**
 * Does the agent reason about second- and third-order effects, not just
 * immediate price direction? This distinguishes shallow "price will go up"
 * reasoning from sophisticated strategic thinking.
 *
 * Measures:
 * 1. Scenario Planning Depth (0-20): Does agent consider multiple future
 *    scenarios (bull, bear, base case)?
 * 2. Cascading Effect Awareness (0-20): Does agent reason about second-
 *    and third-order consequences (e.g., "if rates rise, then housing slows,
 *    then banks lose mortgage revenue")?
 * 3. Portfolio-Level Thinking (0-20): Does the agent consider how this trade
 *    fits within the broader portfolio, not just the single-stock thesis?
 * 4. Opportunity Cost Analysis (0-20): Does the agent consider what it's
 *    giving up by making this trade instead of alternatives?
 * 5. Position Sizing Rationale (0-20): Does the agent explain why this
 *    specific quantity / allocation, not just direction?
 */
export function scoreStrategicForesight(
  reasoning: string,
  action: string,
  confidence: number,
  sources: string[],
  quantity: number,
): number {
  let score = 0;
  const maxScore = 100;

  // 1. Scenario Planning Depth (0-20)
  let scenarioScore = 0;

  const scenarioPatterns = /\b(?:(?:bull|bear|base)\s+case|scenario|(?:best|worst|most\s+likely)\s+(?:case|outcome)|if\s+.*\s+then|upside\s+scenario|downside\s+scenario|in\s+the\s+event\s+(?:of|that)|should\s+.*\s+(?:happen|occur|materialize)|alternatively|under\s+(?:adverse|favorable)\s+conditions|stress\s+(?:case|test|scenario))\b/gi;
  const scenarioMatches = reasoning.match(scenarioPatterns) ?? [];

  scenarioScore += Math.min(12, scenarioMatches.length * 4);

  // Explicit probability assignment to scenarios
  const probPatterns = /\b(?:(?:\d{1,3}%?\s+(?:chance|probability|likelihood))|(?:(?:probability|chance|likelihood)\s+(?:of|is|at)\s+\d{1,3}%?)|(?:most\s+likely|least\s+likely|unlikely|probable|improbable))\b/gi;
  const probMatches = reasoning.match(probPatterns) ?? [];
  scenarioScore += Math.min(8, probMatches.length * 4);

  score += Math.min(20, scenarioScore);

  // 2. Cascading Effect Awareness (0-20)
  let cascadeScore = 0;

  // Multi-step causal chains
  const cascadePatterns = /\b(?:which\s+(?:would|could|will|may)\s+(?:lead\s+to|result\s+in|cause|trigger)|in\s+turn|knock[- ]on\s+effect|downstream\s+(?:effect|impact|consequence)|ripple\s+effect|second[- ]order\s+(?:effect|impact)|third[- ]order|cascad(?:e|ing)|chain\s+reaction|domino\s+effect|(?:if|when)\s+.*\s+then\s+.*\s+(?:and\s+)?then)\b/gi;
  const cascadeMatches = reasoning.match(cascadePatterns) ?? [];

  cascadeScore += Math.min(12, cascadeMatches.length * 5);

  // Cross-market / cross-asset reasoning
  const crossAssetPatterns = /\b(?:interest\s+rates?\s+(?:affect|impact|influence)|dollar\s+(?:strength|weakness)|bond\s+(?:yields?|market)|oil\s+prices?|commodity|currency|FX|cross[- ]asset|contagion|spill[- ]?over|sector\s+rotation|capital\s+flows?|risk[- ]on|risk[- ]off)\b/gi;
  const crossAssetMatches = reasoning.match(crossAssetPatterns) ?? [];
  cascadeScore += Math.min(8, crossAssetMatches.length * 3);

  score += Math.min(20, cascadeScore);

  // 3. Portfolio-Level Thinking (0-20)
  let portfolioScore = 0;

  const portfolioPatterns = /\b(?:portfolio\s+(?:level|context|allocation|balance|exposure|concentration|diversif|weight|impact)|overall\s+(?:exposure|allocation|position|portfolio)|(?:correlat|diversif)\w*\s+(?:with|across|benefit)|existing\s+(?:position|exposure|holding)|net\s+exposure|portfolio\s+(?:risk|return|sharpe)|asset\s+(?:allocation|mix)|rebalance?|hedg(?:e|ing)\s+(?:against|my|the|existing)|beta\s+(?:to|exposure|of\s+portfolio))\b/gi;
  const portfolioMatches = reasoning.match(portfolioPatterns) ?? [];

  portfolioScore += Math.min(14, portfolioMatches.length * 4);

  // Reference to how this trade changes portfolio composition
  const compositionPatterns = /\b(?:brings?\s+(?:my|our|the)\s+(?:allocation|exposure|weight)\s+to|after\s+this\s+trade|resulting\s+(?:allocation|exposure|portfolio)|total\s+(?:allocation|exposure)\s+(?:would|will)\s+be|this\s+(?:increases?|decreases?|maintains?)\s+(?:my|our)\s+(?:exposure|allocation|position))\b/gi;
  const compositionMatches = reasoning.match(compositionPatterns) ?? [];
  portfolioScore += Math.min(6, compositionMatches.length * 3);

  score += Math.min(20, portfolioScore);

  // 4. Opportunity Cost Analysis (0-20)
  let opportunityCostScore = 0;

  const oppCostPatterns = /\b(?:opportunity\s+cost|alternative(?:ly|s)?|instead\s+of|compared\s+to\s+(?:buying|selling|holding|investing)|rather\s+than|versus|(?:better|worse)\s+(?:use|deployment)\s+of\s+capital|capital\s+allocation\s+(?:choice|decision)|could\s+(?:instead|alternatively)|relative\s+(?:value|attractiveness|return)|if\s+I\s+(?:instead|alternatively)|deploy\s+(?:capital|funds)\s+(?:in|to|toward)|this\s+over|prefer\s+(?:this|it)\s+to|more\s+attractive\s+than)\b/gi;
  const oppCostMatches = reasoning.match(oppCostPatterns) ?? [];

  opportunityCostScore += Math.min(14, oppCostMatches.length * 5);

  // Explicit comparison with other stocks/opportunities
  const comparisonPatterns = /\b(?:(?:more|less)\s+attractive\s+than\s+\w+|prefer\s+\w+\s+(?:over|to)|ranks?\s+(?:above|below|higher|lower)|best\s+(?:opportunity|option|value)\s+(?:among|across)|screen(?:ed|ing)\s+(?:for|across))\b/gi;
  const comparisonMatches = reasoning.match(comparisonPatterns) ?? [];
  opportunityCostScore += Math.min(6, comparisonMatches.length * 3);

  score += Math.min(20, opportunityCostScore);

  // 5. Position Sizing Rationale (0-20)
  let sizingScore = 0;

  const sizingPatterns = /\b(?:position\s+siz(?:e|ing)|(?:allocat|invest)\w*\s+\$?[\d,.]+|(?:\d+%?\s+of\s+(?:portfolio|capital|cash|AUM))|(?:small|moderate|large|full)\s+(?:position|allocation)|scaled?\s+(?:in|into|out)|size\s+(?:based\s+on|proportional|relative)|Kelly\s+(?:criterion|formula)|risk\s+per\s+trade|max(?:imum)?\s+(?:position|allocation|exposure)|limit(?:ing|ed)?\s+(?:to|at)\s+\d+%?|underweight|overweight|equal[- ]weight)\b/gi;
  const sizingMatches = reasoning.match(sizingPatterns) ?? [];

  sizingScore += Math.min(12, sizingMatches.length * 4);

  // Risk-based sizing rationale
  const riskSizingPatterns = /\b(?:risk[- ]adjusted\s+(?:position|size|allocation)|volatility[- ](?:scaled|adjusted|weighted)|sizing\s+(?:reflects?|accounts?\s+for)\s+(?:risk|uncertainty|volatility)|(?:smaller|larger)\s+(?:because|due\s+to|given)\s+(?:higher|lower)\s+(?:risk|volatility|uncertainty))\b/gi;
  const riskSizingMatches = reasoning.match(riskSizingPatterns) ?? [];
  sizingScore += Math.min(8, riskSizingMatches.length * 4);

  score += Math.min(20, sizingScore);

  // Bonus: hold actions with strategic rationale (not just "nothing to do")
  if (action === "hold") {
    const strategicHoldPatterns = /\b(?:maintaining\s+(?:exposure|position)|waiting\s+for\s+(?:catalyst|confirmation|better\s+entry)|preserving\s+(?:capital|optionality)|patient|strategic\s+patience|thesis\s+(?:intact|unchanged|still\s+valid))\b/gi;
    const strategicHoldMatches = reasoning.match(strategicHoldPatterns) ?? [];
    if (strategicHoldMatches.length > 0) score += 3;
  }

  // Bonus: confidence calibration with sizing
  if (quantity > 0) {
    const conf = confidence > 1 ? confidence / 100 : confidence;
    if (conf >= 0.8 && /\b(?:large|full|significant|substantial)\s+(?:position|allocation)\b/i.test(reasoning)) {
      score += 2; // High confidence + large size rationale = good
    }
    if (conf < 0.5 && /\b(?:small|modest|limited|partial|starter)\s+(?:position|allocation)\b/i.test(reasoning)) {
      score += 2; // Low confidence + small size rationale = good
    }
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
  );
  const strategicForesightScore = scoreStrategicForesight(
    input.reasoning,
    input.action,
    input.confidence,
    input.sources,
    input.quantity ?? 0,
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
