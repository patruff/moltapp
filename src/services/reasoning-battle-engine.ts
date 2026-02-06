/**
 * Reasoning Battle Engine — Deep Reasoning Quality Comparison
 *
 * Goes beyond simple coherence scoring to compare HOW two agents reason
 * about the same market conditions. This is the qualitative backbone
 * of the v13 battle benchmark.
 *
 * Analysis dimensions:
 *  1. Analytical Breadth: How many factors did each agent consider?
 *  2. Evidence Quality: Did the agent cite real data vs. vague claims?
 *  3. Causal Reasoning: Did the agent explain WHY, not just WHAT?
 *  4. Risk Awareness: Did the agent acknowledge downside scenarios?
 *  5. Intellectual Honesty: Did the agent acknowledge uncertainty?
 *  6. Actionability: Is the reasoning precise enough to verify?
 *  7. Uniqueness: Is the reasoning original or templated?
 */

import { round3, splitSentences, weightedSum } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReasoningComparisonResult {
  agentAId: string;
  agentBId: string;
  agentAScore: number;
  agentBScore: number;
  winner: string | null;
  dimensions: ReasoningDimensionResult[];
  detailedAnalysis: DetailedAnalysis;
  summary: string;
}

export interface ReasoningDimensionResult {
  name: string;
  weight: number;
  agentAScore: number;
  agentBScore: number;
  winner: string | null;
  explanation: string;
}

interface DetailedAnalysis {
  agentA: ReasoningProfile;
  agentB: ReasoningProfile;
}

interface ReasoningProfile {
  agentId: string;
  wordCount: number;
  sentenceCount: number;
  analyticalAngles: string[];
  evidenceCitations: string[];
  causalClaims: number;
  riskMentions: number;
  uncertaintyAcknowledgements: number;
  quantitativeClaims: number;
  hedgeWords: number;
  actionableStatements: number;
  uniquePhrases: number;
  sophisticationLevel: 1 | 2 | 3 | 4 | 5;
}

// ---------------------------------------------------------------------------
// Analytical Dimension Detectors
// ---------------------------------------------------------------------------

/** Analytical angles an agent might consider */
const ANALYTICAL_ANGLES: [string, RegExp][] = [
  ["valuation", /\b(P\/E|valuation|undervalued|overvalued|fair\s+value|intrinsic|multiple|earnings\s+yield)\b/i],
  ["technical", /\b(RSI|MACD|moving\s+average|support|resistance|breakout|trend|momentum|chart)\b/i],
  ["fundamental", /\b(revenue|earnings|growth|margin|cash\s+flow|balance\s+sheet|dividend|profit|EPS)\b/i],
  ["macro", /\b(interest\s+rate|inflation|GDP|Fed|monetary\s+policy|recession|employment|economic)\b/i],
  ["sentiment", /\b(sentiment|fear|greed|bullish|bearish|mood|psychology|panic|euphoria)\b/i],
  ["sector", /\b(sector|industry|peer|competitor|relative|compared\s+to|sector\s+rotation)\b/i],
  ["risk", /\b(risk|downside|stop.?loss|drawdown|volatility|exposure|hedge|protect)\b/i],
  ["catalyst", /\b(catalyst|event|earnings\s+report|FDA|launch|acquisition|announcement|conference)\b/i],
  ["portfolio", /\b(portfolio|allocation|position\s+size|diversif|concentration|rebalance|weight)\b/i],
  ["market_structure", /\b(volume|liquidity|spread|order\s+flow|market\s+maker|depth|bid.?ask)\b/i],
];

/** Evidence quality patterns */
const EVIDENCE_PATTERNS: [string, RegExp][] = [
  ["price_citation", /\$\d+\.?\d*/],
  ["percentage_citation", /[+-]?\d+\.?\d*%/],
  ["time_reference", /\b(today|yesterday|this\s+week|24h|past\s+month|recent|currently)\b/i],
  ["data_source", /\b(Jupiter|market\s+data|price\s+feed|chart|volume\s+data|news)\b/i],
  ["comparison", /\b(compared\s+to|relative\s+to|versus|vs\.|higher\s+than|lower\s+than)\b/i],
  ["specific_value", /\b\d+\.\d{2,}\b/],
];

/** Causal reasoning connectors */
const CAUSAL_PATTERNS = [
  /\b(because|since|due\s+to|therefore|consequently|thus|as\s+a\s+result|this\s+means|implies|suggests|indicates)\b/i,
  /\b(if\s+.+\s+then|given\s+that|considering\s+that|in\s+light\s+of)\b/i,
  /\b(leads\s+to|drives|causes|creates|results\s+in|contributes\s+to)\b/i,
];

/** Risk awareness patterns */
const RISK_PATTERNS = [
  /\b(risk|downside|danger|concern|worry|threat|warning|caution|careful|caveat)\b/i,
  /\b(could\s+fall|might\s+decline|potential\s+loss|worst\s+case|stop.?loss)\b/i,
  /\b(volatility|uncertainty|unpredictable|risky|vulnerable|exposed)\b/i,
];

/** Uncertainty acknowledgement patterns */
const UNCERTAINTY_PATTERNS = [
  /\b(uncertain|unclear|unknown|debatable|questionable)\b/i,
  /\b(might|may|could|possibly|perhaps|potentially)\b/i,
  /\b(limited\s+data|insufficient\s+information|hard\s+to\s+predict)\b/i,
];

/** Hedge word patterns */
const HEDGE_PATTERNS = [
  /\b(maybe|perhaps|possibly|somewhat|slightly|arguably|relatively)\b/i,
  /\b(tend\s+to|seem\s+to|appear\s+to|likely|unlikely|probably)\b/i,
];

/** Actionable statement patterns */
const ACTIONABLE_PATTERNS = [
  /\b(buy\s+at|sell\s+at|target\s+price|entry\s+point|exit\s+at)\b/i,
  /\b(position\s+size|allocat|invest\s+\$|spend\s+\$|limit\s+order)\b/i,
  /\b(I\s+recommend|I\s+suggest|my\s+target|I\s+expect|I\s+predict)\b/i,
];

/** Quantitative claim patterns */
const QUANTITATIVE_PATTERNS = [
  /\$[\d,.]+/,
  /\d+\.?\d*%/,
  /\d+\s+(shares?|units?|tokens?)/i,
  /\b\d{2,}x?\b/,
];

// ---------------------------------------------------------------------------
// Profiling
// ---------------------------------------------------------------------------

function buildReasoningProfile(agentId: string, reasoning: string): ReasoningProfile {
  const words = reasoning.split(/\s+/);
  const sentences = splitSentences(reasoning);

  // Detect analytical angles
  const analyticalAngles: string[] = [];
  for (const [angle, pattern] of ANALYTICAL_ANGLES) {
    if (pattern.test(reasoning)) {
      analyticalAngles.push(angle);
    }
  }

  // Detect evidence citations
  const evidenceCitations: string[] = [];
  for (const [type, pattern] of EVIDENCE_PATTERNS) {
    if (pattern.test(reasoning)) {
      evidenceCitations.push(type);
    }
  }

  // Count causal claims
  let causalClaims = 0;
  for (const pattern of CAUSAL_PATTERNS) {
    const matches = reasoning.match(new RegExp(pattern.source, "gi"));
    causalClaims += matches?.length ?? 0;
  }

  // Count risk mentions
  let riskMentions = 0;
  for (const pattern of RISK_PATTERNS) {
    const matches = reasoning.match(new RegExp(pattern.source, "gi"));
    riskMentions += matches?.length ?? 0;
  }

  // Count uncertainty acknowledgements
  let uncertaintyAcknowledgements = 0;
  for (const pattern of UNCERTAINTY_PATTERNS) {
    const matches = reasoning.match(new RegExp(pattern.source, "gi"));
    uncertaintyAcknowledgements += matches?.length ?? 0;
  }

  // Count hedge words
  let hedgeWords = 0;
  for (const pattern of HEDGE_PATTERNS) {
    const matches = reasoning.match(new RegExp(pattern.source, "gi"));
    hedgeWords += matches?.length ?? 0;
  }

  // Count actionable statements
  let actionableStatements = 0;
  for (const pattern of ACTIONABLE_PATTERNS) {
    const matches = reasoning.match(new RegExp(pattern.source, "gi"));
    actionableStatements += matches?.length ?? 0;
  }

  // Count quantitative claims
  let quantitativeClaims = 0;
  for (const pattern of QUANTITATIVE_PATTERNS) {
    const matches = reasoning.match(new RegExp(pattern.source, "g"));
    quantitativeClaims += matches?.length ?? 0;
  }

  // Unique phrases (bigrams not commonly seen)
  const bigrams = new Set<string>();
  for (let i = 0; i < words.length - 1; i++) {
    const bigram = `${words[i].toLowerCase()} ${words[i + 1].toLowerCase()}`;
    bigrams.add(bigram);
  }
  const uniquePhrases = bigrams.size;

  // Sophistication level
  let sophistication: 1 | 2 | 3 | 4 | 5 = 1;
  const score =
    analyticalAngles.length * 1.5 +
    causalClaims * 1.0 +
    quantitativeClaims * 0.5 +
    riskMentions * 0.5 +
    actionableStatements * 1.0;

  if (score >= 20) sophistication = 5;
  else if (score >= 14) sophistication = 4;
  else if (score >= 8) sophistication = 3;
  else if (score >= 4) sophistication = 2;

  return {
    agentId,
    wordCount: words.length,
    sentenceCount: sentences.length,
    analyticalAngles,
    evidenceCitations,
    causalClaims,
    riskMentions,
    uncertaintyAcknowledgements,
    quantitativeClaims,
    hedgeWords,
    actionableStatements,
    uniquePhrases,
    sophisticationLevel: sophistication,
  };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function scoreDimension(
  name: string,
  weight: number,
  valueA: number,
  valueB: number,
  explanationFn: (a: number, b: number) => string,
): ReasoningDimensionResult {
  const normA = Math.min(1, Math.max(0, valueA));
  const normB = Math.min(1, Math.max(0, valueB));
  const diff = normA - normB;
  const threshold = 0.03;

  return {
    name,
    weight,
    agentAScore: round3(normA),
    agentBScore: round3(normB),
    winner: Math.abs(diff) <= threshold ? null : diff > 0 ? "A" : "B",
    explanation: explanationFn(normA, normB),
  };
}

/**
 * Compare two agents' reasoning head-to-head.
 */
export function compareReasoning(
  agentAId: string,
  reasoningA: string,
  agentBId: string,
  reasoningB: string,
): ReasoningComparisonResult {
  const profileA = buildReasoningProfile(agentAId, reasoningA);
  const profileB = buildReasoningProfile(agentBId, reasoningB);

  // 1. Analytical Breadth
  const breadthA = Math.min(1, profileA.analyticalAngles.length / 6);
  const breadthB = Math.min(1, profileB.analyticalAngles.length / 6);

  // 2. Evidence Quality
  const evidenceA = Math.min(1, (profileA.evidenceCitations.length * 0.2 + profileA.quantitativeClaims * 0.1));
  const evidenceB = Math.min(1, (profileB.evidenceCitations.length * 0.2 + profileB.quantitativeClaims * 0.1));

  // 3. Causal Reasoning
  const causalA = Math.min(1, profileA.causalClaims / 5);
  const causalB = Math.min(1, profileB.causalClaims / 5);

  // 4. Risk Awareness
  const riskA = Math.min(1, profileA.riskMentions / 3);
  const riskB = Math.min(1, profileB.riskMentions / 3);

  // 5. Intellectual Honesty
  const honestyA = Math.min(1, profileA.uncertaintyAcknowledgements / 3);
  const honestyB = Math.min(1, profileB.uncertaintyAcknowledgements / 3);

  // 6. Actionability
  const actionA = Math.min(1, profileA.actionableStatements / 3);
  const actionB = Math.min(1, profileB.actionableStatements / 3);

  // 7. Uniqueness (relative to each other)
  const allBigramsA = new Set(reasoningA.toLowerCase().split(/\s+/).map((w, i, arr) => i < arr.length - 1 ? `${w} ${arr[i + 1]}` : "").filter(Boolean));
  const allBigramsB = new Set(reasoningB.toLowerCase().split(/\s+/).map((w, i, arr) => i < arr.length - 1 ? `${w} ${arr[i + 1]}` : "").filter(Boolean));
  const intersection = new Set([...allBigramsA].filter((x) => allBigramsB.has(x)));
  const union = new Set([...allBigramsA, ...allBigramsB]);
  const jaccardSimilarity = union.size > 0 ? intersection.size / union.size : 0;
  const uniquenessA = 1 - jaccardSimilarity;
  const uniquenessB = 1 - jaccardSimilarity; // Both penalized equally for overlap

  const dimensions: ReasoningDimensionResult[] = [
    scoreDimension("analytical_breadth", 0.20, breadthA, breadthB,
      (a, b) => `A covers ${profileA.analyticalAngles.length} angles vs B's ${profileB.analyticalAngles.length}`),
    scoreDimension("evidence_quality", 0.20, evidenceA, evidenceB,
      (a, b) => `A cites ${profileA.evidenceCitations.length} evidence types, B cites ${profileB.evidenceCitations.length}`),
    scoreDimension("causal_reasoning", 0.15, causalA, causalB,
      (a, b) => `A has ${profileA.causalClaims} causal claims vs B's ${profileB.causalClaims}`),
    scoreDimension("risk_awareness", 0.15, riskA, riskB,
      (a, b) => `A mentions risk ${profileA.riskMentions} times vs B's ${profileB.riskMentions}`),
    scoreDimension("intellectual_honesty", 0.10, honestyA, honestyB,
      (a, b) => `A acknowledges uncertainty ${profileA.uncertaintyAcknowledgements} times vs B's ${profileB.uncertaintyAcknowledgements}`),
    scoreDimension("actionability", 0.10, actionA, actionB,
      (a, b) => `A has ${profileA.actionableStatements} actionable statements vs B's ${profileB.actionableStatements}`),
    scoreDimension("uniqueness", 0.10, uniquenessA, uniquenessB,
      () => `Reasoning overlap: ${(jaccardSimilarity * 100).toFixed(1)}% Jaccard similarity`),
  ];

  // Remap winner placeholders to actual agent IDs
  const mappedDimensions = dimensions.map((d) => ({
    ...d,
    winner: d.winner === "A" ? agentAId : d.winner === "B" ? agentBId : null,
  }));

  // Composite scores
  const agentAScore = weightedSum(mappedDimensions, "agentAScore", "weight");
  const agentBScore = weightedSum(mappedDimensions, "agentBScore", "weight");
  const diff = agentAScore - agentBScore;
  const winner = Math.abs(diff) < 0.02 ? null : diff > 0 ? agentAId : agentBId;

  // Generate summary
  const winnerName = winner ?? "Neither agent";
  const aWins = mappedDimensions.filter((d) => d.winner === agentAId).length;
  const bWins = mappedDimensions.filter((d) => d.winner === agentBId).length;

  const summary = winner
    ? `${winnerName} wins the reasoning comparison (${Math.round(Math.max(agentAScore, agentBScore) * 100)}% vs ${Math.round(Math.min(agentAScore, agentBScore) * 100)}%). ` +
      `Won ${winner === agentAId ? aWins : bWins} of 7 dimensions. ` +
      `Sophistication: ${profileA.agentId}=${profileA.sophisticationLevel}/5, ${profileB.agentId}=${profileB.sophisticationLevel}/5.`
    : `Dead heat in reasoning quality (${Math.round(agentAScore * 100)}% vs ${Math.round(agentBScore * 100)}%). Both agents at similar analytical depth.`;

  return {
    agentAId,
    agentBId,
    agentAScore: round3(agentAScore),
    agentBScore: round3(agentBScore),
    winner,
    dimensions: mappedDimensions,
    detailedAnalysis: { agentA: profileA, agentB: profileB },
    summary,
  };
}

/**
 * Compare all pairwise reasoning in a round.
 */
export function compareAllReasoning(
  participants: { agentId: string; reasoning: string }[],
): ReasoningComparisonResult[] {
  const results: ReasoningComparisonResult[] = [];

  for (let i = 0; i < participants.length; i++) {
    for (let j = i + 1; j < participants.length; j++) {
      results.push(
        compareReasoning(
          participants[i].agentId,
          participants[i].reasoning,
          participants[j].agentId,
          participants[j].reasoning,
        ),
      );
    }
  }

  return results;
}

/**
 * Build a reasoning profile for external API consumption.
 */
export function getReasoningProfile(agentId: string, reasoning: string): ReasoningProfile {
  return buildReasoningProfile(agentId, reasoning);
}
