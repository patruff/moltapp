/**
 * Benchmark Arbitration Engine (v19)
 *
 * When agents disagree on a trade, this engine arbitrates:
 * - Who had the better reasoning?
 * - Who was more calibrated?
 * - Who was factually correct?
 *
 * This creates a structured "court case" for every disagreement round,
 * scoring each side on evidence quality, logical consistency, and
 * outcome prediction accuracy.
 *
 * Arbitration dimensions:
 * 1. EVIDENCE WEIGHT — which agent cited more concrete, verifiable data?
 * 2. LOGICAL CONSISTENCY — whose reasoning had fewer internal contradictions?
 * 3. CALIBRATION ACCURACY — whose confidence better predicted the outcome?
 * 4. RISK DISCLOSURE — who better identified potential downsides?
 * 5. ORIGINALITY — who brought novel analysis vs templated responses?
 */

import { countByCondition, round2, sortEntriesDescending } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ArbitrationCase {
  caseId: string;
  roundId: string;
  symbol: string;
  /** The two agents whose reasoning is being compared */
  agentA: string;
  agentB: string;
  /** Actions taken by each agent */
  actionA: string;
  actionB: string;
  /** Full reasoning text */
  reasoningA: string;
  reasoningB: string;
  /** Confidence levels */
  confidenceA: number;
  confidenceB: number;
  /** Dimension scores for each agent */
  scoresA: ArbitrationScores;
  scoresB: ArbitrationScores;
  /** Overall winner */
  winner: string | "tie";
  /** Margin of victory (0-1) */
  margin: number;
  /** Detailed ruling explaining the decision */
  ruling: string;
  /** Was this a disagreement (buy vs sell)? */
  isDisagreement: boolean;
  /** Outcome resolution (filled later) */
  outcomeVerdict?: "agentA_correct" | "agentB_correct" | "both_wrong" | "pending";
  timestamp: string;
}

export interface ArbitrationScores {
  evidenceWeight: number;
  logicalConsistency: number;
  calibrationAccuracy: number;
  riskDisclosure: number;
  originality: number;
  composite: number;
}

export interface AgentArbitrationProfile {
  agentId: string;
  totalCases: number;
  wins: number;
  losses: number;
  ties: number;
  winRate: number;
  avgComposite: number;
  strengthDimension: string;
  weaknessDimension: string;
  disagreementRecord: { wins: number; losses: number };
  outcomeAccuracy: number;
  recentTrend: "improving" | "stable" | "declining";
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const arbitrationCases: ArbitrationCase[] = [];
const MAX_CASES = 2000;

// ---------------------------------------------------------------------------
// NLP Analysis Helpers
// ---------------------------------------------------------------------------

/** Quantitative evidence markers */
const EVIDENCE_PATTERNS: [RegExp, number][] = [
  [/\$[\d,]+\.?\d*/g, 0.15],       // Dollar amounts
  [/\d+\.?\d*%/g, 0.12],           // Percentages
  [/P\/E|EPS|revenue|earnings/gi, 0.10], // Fundamental metrics
  [/RSI|MACD|SMA|EMA|moving\s+average/gi, 0.10], // Technical indicators
  [/volume\s+[\d,]+/gi, 0.08],     // Volume with numbers
  [/market\s+cap/gi, 0.06],        // Market cap mention
  [/\d{4}-\d{2}-\d{2}/g, 0.05],   // Date references
  [/quarter|Q[1-4]|fiscal/gi, 0.05], // Temporal anchors
  [/support\s+at|resistance\s+at/gi, 0.08], // Technical levels
  [/yield|dividend/gi, 0.06],       // Income metrics
];

/** Logical connector patterns */
const LOGIC_PATTERNS: [RegExp, number][] = [
  [/\bbecause\b/gi, 0.10],
  [/\btherefore\b/gi, 0.12],
  [/\bdue\s+to\b/gi, 0.08],
  [/\bas\s+a\s+result\b/gi, 0.10],
  [/\bgiven\s+that\b/gi, 0.08],
  [/\bif\b.*\bthen\b/gi, 0.12],
  [/\bsince\b/gi, 0.06],
  [/\bhowever\b/gi, 0.08],
  [/\bnevertheless\b/gi, 0.08],
  [/\bon\s+the\s+other\s+hand\b/gi, 0.10],
  [/\bleading\s+to\b/gi, 0.07],
  [/\bdriven\s+by\b/gi, 0.07],
];

/** Risk awareness patterns */
const RISK_PATTERNS: [RegExp, number][] = [
  [/\brisk\b/gi, 0.08],
  [/\bdownside\b/gi, 0.12],
  [/\bstop[- ]?loss\b/gi, 0.15],
  [/\bworst[- ]?case\b/gi, 0.12],
  [/\bvolatil/gi, 0.08],
  [/\buncertain/gi, 0.10],
  [/\bcautious/gi, 0.08],
  [/\bhedge\b/gi, 0.10],
  [/\bexposure\b/gi, 0.08],
  [/\bconcentrat/gi, 0.08],
  [/\bif\s+.+\s+falls?\b/gi, 0.10],
  [/\bmax\s+(?:loss|drawdown)\b/gi, 0.12],
];

function scorePatterns(text: string, patterns: [RegExp, number][]): number {
  let score = 0;
  for (const [pattern, weight] of patterns) {
    const matches = text.match(pattern);
    if (matches) {
      score += weight * Math.min(matches.length, 4);
    }
  }
  return Math.min(1, score);
}

function computeOriginality(textA: string, textB: string): [number, number] {
  const wordsA = new Set(textA.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const wordsB = new Set(textB.toLowerCase().split(/\s+/).filter(w => w.length > 3));

  if (wordsA.size === 0 && wordsB.size === 0) return [0.5, 0.5];

  const intersectionSize = [...wordsA].filter(w => wordsB.has(w)).length;
  const unionSize = new Set([...wordsA, ...wordsB]).size;
  const jaccard = unionSize > 0 ? intersectionSize / unionSize : 0;

  // Lower overlap = more original
  const overlap = jaccard;
  const uniqueA = wordsA.size > 0
    ? [...wordsA].filter(w => !wordsB.has(w)).length / wordsA.size
    : 0;
  const uniqueB = wordsB.size > 0
    ? [...wordsB].filter(w => !wordsA.has(w)).length / wordsB.size
    : 0;

  return [
    Math.min(1, 0.4 + uniqueA * 0.6 - overlap * 0.2),
    Math.min(1, 0.4 + uniqueB * 0.6 - overlap * 0.2),
  ];
}

function detectContradictions(text: string): number {
  let contradictions = 0;
  if (/bullish/i.test(text) && /bearish/i.test(text)) contradictions++;
  if (/should\s+buy/i.test(text) && /should\s+sell/i.test(text)) contradictions++;
  if (/overvalued/i.test(text) && /undervalued/i.test(text)) contradictions++;
  if (/support/i.test(text) && /breakdown/i.test(text) &&
      !/support.*breakdown|breakdown.*support/i.test(text)) {
    // Only flag if not discussing support levels breaking down (which is valid)
  }
  if (/strong\s+buy/i.test(text) && /caution|cautious/i.test(text)) contradictions++;
  return Math.max(0, 1 - contradictions * 0.2);
}

// ---------------------------------------------------------------------------
// Core Arbitration
// ---------------------------------------------------------------------------

function scoreAgent(
  reasoning: string,
  confidence: number,
  opponentReasoning: string,
): ArbitrationScores {
  const evidence = scorePatterns(reasoning, EVIDENCE_PATTERNS);
  const logic = scorePatterns(reasoning, LOGIC_PATTERNS);
  const consistency = detectContradictions(reasoning);
  const logicalConsistency = (logic * 0.6 + consistency * 0.4);
  const riskDisclosure = scorePatterns(reasoning, RISK_PATTERNS);

  // Calibration: penalize extreme confidence without evidence
  const calibrationPenalty = confidence > 0.85 && evidence < 0.3 ? 0.3 : 0;
  const calibrationBonus = (confidence > 0.5 && confidence < 0.8 && evidence > 0.4) ? 0.15 : 0;
  const calibrationAccuracy = Math.min(1, Math.max(0,
    0.5 + calibrationBonus - calibrationPenalty + evidence * 0.2
  ));

  const [originality] = computeOriginality(reasoning, opponentReasoning);

  const composite =
    evidence * 0.25 +
    logicalConsistency * 0.25 +
    calibrationAccuracy * 0.20 +
    riskDisclosure * 0.15 +
    originality * 0.15;

  return {
    evidenceWeight: round2(evidence),
    logicalConsistency: round2(logicalConsistency),
    calibrationAccuracy: round2(calibrationAccuracy),
    riskDisclosure: round2(riskDisclosure),
    originality: round2(originality),
    composite: round2(composite),
  };
}

/**
 * Run arbitration between two agents on a specific trade.
 */
export function arbitrate(
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
): ArbitrationCase {
  const scoresA = scoreAgent(reasoningA, confidenceA, reasoningB);
  const scoresB = scoreAgent(reasoningB, confidenceB, reasoningA);

  // Recalculate originality as pairwise
  const [origA, origB] = computeOriginality(reasoningA, reasoningB);
  scoresA.originality = round2(origA);
  scoresB.originality = round2(origB);
  scoresA.composite = round2(
    scoresA.evidenceWeight * 0.25 +
    scoresA.logicalConsistency * 0.25 +
    scoresA.calibrationAccuracy * 0.20 +
    scoresA.riskDisclosure * 0.15 +
    scoresA.originality * 0.15
  );
  scoresB.composite = round2(
    scoresB.evidenceWeight * 0.25 +
    scoresB.logicalConsistency * 0.25 +
    scoresB.calibrationAccuracy * 0.20 +
    scoresB.riskDisclosure * 0.15 +
    scoresB.originality * 0.15
  );

  const diff = scoresA.composite - scoresB.composite;
  const margin = Math.abs(diff);
  const winner = margin < 0.03 ? "tie" : (diff > 0 ? agentA : agentB);
  const isDisagreement = actionA !== actionB;

  // Generate ruling
  let ruling: string;
  if (winner === "tie") {
    ruling = `Near-identical reasoning quality on ${symbol}. Both agents scored within 3% composite. `;
    ruling += `Evidence: ${agentA}=${scoresA.evidenceWeight.toFixed(2)} vs ${agentB}=${scoresB.evidenceWeight.toFixed(2)}. `;
    ruling += `Logic: ${agentA}=${scoresA.logicalConsistency.toFixed(2)} vs ${agentB}=${scoresB.logicalConsistency.toFixed(2)}.`;
  } else {
    const winnerScores = winner === agentA ? scoresA : scoresB;
    const loserScores = winner === agentA ? scoresB : scoresA;
    const loser = winner === agentA ? agentB : agentA;

    // Find strongest dimension advantage
    const dimensions: [string, number][] = [
      ["evidence", winnerScores.evidenceWeight - loserScores.evidenceWeight],
      ["logic", winnerScores.logicalConsistency - loserScores.logicalConsistency],
      ["calibration", winnerScores.calibrationAccuracy - loserScores.calibrationAccuracy],
      ["risk awareness", winnerScores.riskDisclosure - loserScores.riskDisclosure],
      ["originality", winnerScores.originality - loserScores.originality],
    ];
    dimensions.sort((a, b) => b[1] - a[1]);
    const topAdvantage = dimensions[0];

    ruling = `${winner} wins arbitration on ${symbol} by ${(margin * 100).toFixed(1)}% margin. `;
    ruling += `Strongest advantage: ${topAdvantage[0]} (+${(topAdvantage[1] * 100).toFixed(1)}%). `;
    if (isDisagreement) {
      ruling += `DISAGREEMENT: ${agentA}=${actionA} vs ${agentB}=${actionB}. `;
      ruling += `Outcome tracking will reveal who was right.`;
    }
  }

  const arCase: ArbitrationCase = {
    caseId: `arb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    roundId,
    symbol,
    agentA,
    agentB,
    actionA,
    actionB,
    reasoningA,
    reasoningB,
    confidenceA,
    confidenceB,
    scoresA,
    scoresB,
    winner,
    margin: round2(margin),
    ruling,
    isDisagreement,
    timestamp: new Date().toISOString(),
  };

  arbitrationCases.unshift(arCase);
  if (arbitrationCases.length > MAX_CASES) {
    arbitrationCases.length = MAX_CASES;
  }

  return arCase;
}

/**
 * Resolve outcome: given a price movement, who was right?
 */
export function resolveArbitrationOutcome(
  caseId: string,
  priceChange: number,
): ArbitrationCase | null {
  const arCase = arbitrationCases.find(c => c.caseId === caseId);
  if (!arCase) return null;

  const aCorrect = (arCase.actionA === "buy" && priceChange > 0) ||
                   (arCase.actionA === "sell" && priceChange < 0) ||
                   (arCase.actionA === "hold" && Math.abs(priceChange) < 0.02);

  const bCorrect = (arCase.actionB === "buy" && priceChange > 0) ||
                   (arCase.actionB === "sell" && priceChange < 0) ||
                   (arCase.actionB === "hold" && Math.abs(priceChange) < 0.02);

  if (aCorrect && !bCorrect) arCase.outcomeVerdict = "agentA_correct";
  else if (bCorrect && !aCorrect) arCase.outcomeVerdict = "agentB_correct";
  else arCase.outcomeVerdict = "both_wrong";

  return arCase;
}

// ---------------------------------------------------------------------------
// Profile Aggregation
// ---------------------------------------------------------------------------

export function getAgentArbitrationProfile(agentId: string): AgentArbitrationProfile {
  const cases = arbitrationCases.filter(
    c => c.agentA === agentId || c.agentB === agentId,
  );

  let wins = 0;
  let losses = 0;
  let ties = 0;
  let compositeSum = 0;
  const dimensionSums: Record<string, number> = {
    evidenceWeight: 0, logicalConsistency: 0, calibrationAccuracy: 0,
    riskDisclosure: 0, originality: 0,
  };
  let disagreementWins = 0;
  let disagreementLosses = 0;
  let outcomeCorrect = 0;
  let outcomeTotal = 0;

  for (const c of cases) {
    const isA = c.agentA === agentId;
    const scores = isA ? c.scoresA : c.scoresB;

    compositeSum += scores.composite;
    for (const dim of Object.keys(dimensionSums)) {
      dimensionSums[dim] += scores[dim as keyof ArbitrationScores] as number;
    }

    if (c.winner === "tie") ties++;
    else if (c.winner === agentId) wins++;
    else losses++;

    if (c.isDisagreement) {
      if (c.winner === agentId) disagreementWins++;
      else if (c.winner !== "tie") disagreementLosses++;
    }

    if (c.outcomeVerdict && c.outcomeVerdict !== "pending") {
      outcomeTotal++;
      const agentCorrect = (isA && c.outcomeVerdict === "agentA_correct") ||
                           (!isA && c.outcomeVerdict === "agentB_correct");
      if (agentCorrect) outcomeCorrect++;
    }
  }

  const total = cases.length || 1;
  const avgDimensions: Record<string, number> = {};
  for (const [dim, sum] of Object.entries(dimensionSums)) {
    avgDimensions[dim] = round2(sum / total);
  }

  const sortedDims = sortEntriesDescending(avgDimensions);
  const strength = sortedDims[0]?.[0] ?? "none";
  const weakness = sortedDims[sortedDims.length - 1]?.[0] ?? "none";

  // Trend detection: last 10 vs previous 10
  const recentCases = cases.slice(0, 10);
  const olderCases = cases.slice(10, 20);
  let trend: "improving" | "stable" | "declining" = "stable";
  if (recentCases.length >= 5 && olderCases.length >= 5) {
    const recentAvg = recentCases.reduce((s, c) => {
      const scores = c.agentA === agentId ? c.scoresA : c.scoresB;
      return s + scores.composite;
    }, 0) / recentCases.length;
    const olderAvg = olderCases.reduce((s, c) => {
      const scores = c.agentA === agentId ? c.scoresA : c.scoresB;
      return s + scores.composite;
    }, 0) / olderCases.length;
    const diff = recentAvg - olderAvg;
    if (diff > 0.05) trend = "improving";
    else if (diff < -0.05) trend = "declining";
  }

  return {
    agentId,
    totalCases: cases.length,
    wins,
    losses,
    ties,
    winRate: cases.length > 0 ? round2(wins / cases.length) : 0,
    avgComposite: round2(compositeSum / total),
    strengthDimension: strength,
    weaknessDimension: weakness,
    disagreementRecord: { wins: disagreementWins, losses: disagreementLosses },
    outcomeAccuracy: outcomeTotal > 0
      ? round2(outcomeCorrect / outcomeTotal)
      : 0,
    recentTrend: trend,
  };
}

export function getAllArbitrationProfiles(): AgentArbitrationProfile[] {
  const agentIds = new Set<string>();
  for (const c of arbitrationCases) {
    agentIds.add(c.agentA);
    agentIds.add(c.agentB);
  }
  return [...agentIds].map(getAgentArbitrationProfile);
}

export function getRecentCases(limit: number = 20): ArbitrationCase[] {
  return arbitrationCases.slice(0, limit);
}

export function getDisagreementCases(limit: number = 20): ArbitrationCase[] {
  return arbitrationCases.filter(c => c.isDisagreement).slice(0, limit);
}

export function getArbitrationPillarScore(agentId: string): number {
  const profile = getAgentArbitrationProfile(agentId);
  if (profile.totalCases === 0) return 0.5;

  // Weighted: win rate 40%, composite 30%, outcome accuracy 20%, trend 10%
  const trendScore = profile.recentTrend === "improving" ? 0.8
    : profile.recentTrend === "stable" ? 0.5 : 0.2;

  return round2(
    profile.winRate * 0.40 +
    profile.avgComposite * 0.30 +
    profile.outcomeAccuracy * 0.20 +
    trendScore * 0.10
  );
}

export function getCaseById(caseId: string): ArbitrationCase | undefined {
  return arbitrationCases.find(c => c.caseId === caseId);
}

export function getArbitrationStats(): {
  totalCases: number;
  disagreements: number;
  avgMargin: number;
  tieRate: number;
  resolvedOutcomes: number;
} {
  const disagreements = countByCondition(arbitrationCases, c => c.isDisagreement);
  const ties = countByCondition(arbitrationCases, c => c.winner === "tie");
  const marginSum = arbitrationCases.reduce((s, c) => s + c.margin, 0);
  const resolved = countByCondition(arbitrationCases, c => !!(c.outcomeVerdict && c.outcomeVerdict !== "pending"));

  return {
    totalCases: arbitrationCases.length,
    disagreements,
    avgMargin: arbitrationCases.length > 0
      ? round2(marginSum / arbitrationCases.length)
      : 0,
    tieRate: arbitrationCases.length > 0
      ? round2(ties / arbitrationCases.length)
      : 0,
    resolvedOutcomes: resolved,
  };
}
