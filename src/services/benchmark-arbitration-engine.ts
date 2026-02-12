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
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * EVIDENCE SCORING WEIGHTS
 *
 * NLP pattern weights for detecting quantitative evidence in agent reasoning.
 * Higher weights = stronger evidence signal.
 */

/** Dollar amounts ($100, $52.50) — strongest evidence of price-grounded analysis */
const EVIDENCE_WEIGHT_DOLLAR_AMOUNTS = 0.15;

/** Percentages (5%, -2.3%) — shows quantitative change awareness */
const EVIDENCE_WEIGHT_PERCENTAGES = 0.12;

/** Fundamental metrics (P/E, EPS, revenue, earnings) — financial statement grounding */
const EVIDENCE_WEIGHT_FUNDAMENTAL_METRICS = 0.10;

/** Technical indicators (RSI, MACD, SMA, EMA) — TA awareness */
const EVIDENCE_WEIGHT_TECHNICAL_INDICATORS = 0.10;

/** Volume data with numbers (volume 1.2M) — liquidity awareness */
const EVIDENCE_WEIGHT_VOLUME_DATA = 0.08;

/** Technical levels (support at, resistance at) — key price zones */
const EVIDENCE_WEIGHT_TECHNICAL_LEVELS = 0.08;

/** Market cap mentions — size/category awareness */
const EVIDENCE_WEIGHT_MARKET_CAP = 0.06;

/** Income metrics (yield, dividend) — value investor signals */
const EVIDENCE_WEIGHT_INCOME_METRICS = 0.06;

/** Date references (2024-01-15) — temporal anchoring */
const EVIDENCE_WEIGHT_DATE_REFERENCES = 0.05;

/** Temporal anchors (quarter, Q1, fiscal) — earnings cycle awareness */
const EVIDENCE_WEIGHT_TEMPORAL_ANCHORS = 0.05;

/**
 * LOGICAL CONNECTOR WEIGHTS
 *
 * Weights for causal reasoning markers that indicate logical structure.
 * Higher weights = stronger causal reasoning signal.
 */

/** "therefore" — strongest causal conclusion marker */
const LOGIC_WEIGHT_THEREFORE = 0.12;

/** "if...then" — conditional logic structure */
const LOGIC_WEIGHT_IF_THEN = 0.12;

/** "because" — causal explanation */
const LOGIC_WEIGHT_BECAUSE = 0.10;

/** "as a result" — consequence marker */
const LOGIC_WEIGHT_AS_A_RESULT = 0.10;

/** "on the other hand" — balanced consideration */
const LOGIC_WEIGHT_ON_THE_OTHER_HAND = 0.10;

/** "due to" — causal attribution */
const LOGIC_WEIGHT_DUE_TO = 0.08;

/** "given that" — premise marker */
const LOGIC_WEIGHT_GIVEN_THAT = 0.08;

/** "however" — counterargument consideration */
const LOGIC_WEIGHT_HOWEVER = 0.08;

/** "nevertheless" — acknowledging counterpoint */
const LOGIC_WEIGHT_NEVERTHELESS = 0.08;

/** "leading to" — causal chain */
const LOGIC_WEIGHT_LEADING_TO = 0.07;

/** "driven by" — causal driver identification */
const LOGIC_WEIGHT_DRIVEN_BY = 0.07;

/** "since" — temporal/causal reasoning */
const LOGIC_WEIGHT_SINCE = 0.06;

/**
 * RISK AWARENESS WEIGHTS
 *
 * Weights for risk disclosure patterns. Higher weights = better risk management.
 */

/** "stop-loss" — explicit exit plan, highest risk awareness signal */
const RISK_WEIGHT_STOP_LOSS = 0.15;

/** "downside" — downside scenario consideration */
const RISK_WEIGHT_DOWNSIDE = 0.12;

/** "worst-case" — stress test thinking */
const RISK_WEIGHT_WORST_CASE = 0.12;

/** "max loss/drawdown" — quantified risk limits */
const RISK_WEIGHT_MAX_LOSS = 0.12;

/** "uncertain" — acknowledges unknowns */
const RISK_WEIGHT_UNCERTAIN = 0.10;

/** "hedge" — risk mitigation strategy */
const RISK_WEIGHT_HEDGE = 0.10;

/** "if...falls" — downside scenario planning */
const RISK_WEIGHT_IF_FALLS = 0.10;

/** "volatile" / "volatility" — volatility awareness */
const RISK_WEIGHT_VOLATILE = 0.08;

/** "risk" (generic) — general risk mention */
const RISK_WEIGHT_RISK = 0.08;

/** "cautious" — risk-aware tone */
const RISK_WEIGHT_CAUTIOUS = 0.08;

/** "exposure" — portfolio risk awareness */
const RISK_WEIGHT_EXPOSURE = 0.08;

/** "concentration" — concentration risk awareness */
const RISK_WEIGHT_CONCENTRATION = 0.08;

/**
 * PATTERN SCORING PARAMETERS
 *
 * Controls how pattern matches contribute to dimension scores.
 */

/** Maximum pattern match count per pattern before saturation (diminishing returns) */
const PATTERN_MATCH_SATURATION = 4;

/** Maximum score cap for all pattern scoring (normalized 0-1 scale) */
const PATTERN_SCORE_MAX = 1.0;

/**
 * ORIGINALITY CALCULATION WEIGHTS
 *
 * Controls how text uniqueness/overlap affects originality scoring.
 */

/** Base originality score (prevents zero scores) */
const ORIGINALITY_BASE_SCORE = 0.4;

/** Weight multiplier for unique word percentage (higher = reward uniqueness more) */
const ORIGINALITY_UNIQUE_WORD_WEIGHT = 0.6;

/** Penalty multiplier for text overlap (higher = penalize overlap more) */
const ORIGINALITY_OVERLAP_PENALTY = 0.2;

/** Minimum word length for originality analysis (filters stopwords) */
const ORIGINALITY_MIN_WORD_LENGTH = 3;

/**
 * LOGICAL CONSISTENCY SCORING
 *
 * Weights for combining logic pattern detection with contradiction detection.
 */

/** Weight for logical connector patterns in consistency score */
const CONSISTENCY_LOGIC_PATTERN_WEIGHT = 0.6;

/** Weight for contradiction-free text in consistency score */
const CONSISTENCY_NO_CONTRADICTION_WEIGHT = 0.4;

/** Penalty per detected contradiction (applies multiple times if >1 found) */
const CONTRADICTION_PENALTY_PER_COUNT = 0.2;

/** Base consistency score (starts at 1.0, reduced by contradictions) */
const CONSISTENCY_BASE_SCORE = 1.0;

/**
 * CALIBRATION ACCURACY PARAMETERS
 *
 * Controls confidence calibration scoring — penalizes overconfidence without evidence.
 */

/** Base calibration score (neutral starting point) */
const CALIBRATION_BASE_SCORE = 0.5;

/** Confidence threshold for overconfidence check (>85% without evidence = penalty) */
const CALIBRATION_HIGH_CONFIDENCE_THRESHOLD = 0.85;

/** Evidence threshold for overconfidence penalty (<30% evidence triggers penalty) */
const CALIBRATION_LOW_EVIDENCE_THRESHOLD = 0.3;

/** Penalty applied when high confidence (>85%) lacks evidence (<30%) */
const CALIBRATION_OVERCONFIDENCE_PENALTY = 0.3;

/** Minimum confidence for calibration bonus (50-80% range with strong evidence) */
const CALIBRATION_BONUS_CONFIDENCE_MIN = 0.5;

/** Maximum confidence for calibration bonus (50-80% range with strong evidence) */
const CALIBRATION_BONUS_CONFIDENCE_MAX = 0.8;

/** Evidence threshold for calibration bonus (>40% evidence triggers bonus) */
const CALIBRATION_BONUS_EVIDENCE_THRESHOLD = 0.4;

/** Bonus applied for well-calibrated confidence (50-80% with strong evidence) */
const CALIBRATION_BONUS = 0.15;

/** Evidence contribution weight to final calibration score */
const CALIBRATION_EVIDENCE_WEIGHT = 0.2;

/**
 * COMPOSITE SCORE WEIGHTS
 *
 * Final arbitration score is weighted combination of 5 dimensions.
 * Must sum to 1.0 for normalized scoring.
 */

/** Evidence weight — 25% of composite (quantitative data grounding) */
const COMPOSITE_WEIGHT_EVIDENCE = 0.25;

/** Logic weight — 25% of composite (reasoning structure quality) */
const COMPOSITE_WEIGHT_LOGIC = 0.25;

/** Calibration weight — 20% of composite (confidence accuracy) */
const COMPOSITE_WEIGHT_CALIBRATION = 0.20;

/** Risk disclosure weight — 15% of composite (downside consideration) */
const COMPOSITE_WEIGHT_RISK = 0.15;

/** Originality weight — 15% of composite (novel vs templated analysis) */
const COMPOSITE_WEIGHT_ORIGINALITY = 0.15;

/**
 * ARBITRATION VERDICT THRESHOLDS
 *
 * Controls when arbitration declares winner vs tie.
 */

/** Tie threshold — composite score difference <3% = too close to call */
const ARBITRATION_TIE_THRESHOLD = 0.03;

/** Hold outcome threshold — |price change| <2% = hold was correct */
const OUTCOME_HOLD_CORRECT_THRESHOLD = 0.02;

/**
 * TREND DETECTION PARAMETERS
 *
 * Controls how agent arbitration performance trends are classified.
 */

/** Recent cases window for trend calculation */
const TREND_RECENT_WINDOW = 10;

/** Older cases window for trend comparison */
const TREND_OLDER_WINDOW_START = 10;
const TREND_OLDER_WINDOW_END = 20;

/** Minimum cases required in each window for reliable trend detection */
const TREND_MIN_CASES_PER_WINDOW = 5;

/** Improvement threshold — composite score increase >5% = improving trend */
const TREND_IMPROVEMENT_THRESHOLD = 0.05;

/** Decline threshold — composite score decrease >5% = declining trend */
const TREND_DECLINE_THRESHOLD = -0.05;

/**
 * PILLAR SCORE WEIGHTS
 *
 * Arbitration pillar score combines 4 metrics with different weights.
 * Used for leaderboard "Arbitration" pillar scoring.
 */

/** Win rate weight — 40% of pillar score (most important: did agent win debates?) */
const PILLAR_WEIGHT_WIN_RATE = 0.40;

/** Average composite weight — 30% of pillar score (reasoning quality) */
const PILLAR_WEIGHT_AVG_COMPOSITE = 0.30;

/** Outcome accuracy weight — 20% of pillar score (were decisions correct?) */
const PILLAR_WEIGHT_OUTCOME_ACCURACY = 0.20;

/** Trend weight — 10% of pillar score (is agent improving?) */
const PILLAR_WEIGHT_TREND = 0.10;

/** Trend score for "improving" trend classification */
const PILLAR_TREND_SCORE_IMPROVING = 0.8;

/** Trend score for "stable" trend classification */
const PILLAR_TREND_SCORE_STABLE = 0.5;

/** Trend score for "declining" trend classification */
const PILLAR_TREND_SCORE_DECLINING = 0.2;

// ---------------------------------------------------------------------------
// NLP Analysis Helpers
// ---------------------------------------------------------------------------

/** Quantitative evidence markers */
const EVIDENCE_PATTERNS: [RegExp, number][] = [
  [/\$[\d,]+\.?\d*/g, EVIDENCE_WEIGHT_DOLLAR_AMOUNTS],
  [/\d+\.?\d*%/g, EVIDENCE_WEIGHT_PERCENTAGES],
  [/P\/E|EPS|revenue|earnings/gi, EVIDENCE_WEIGHT_FUNDAMENTAL_METRICS],
  [/RSI|MACD|SMA|EMA|moving\s+average/gi, EVIDENCE_WEIGHT_TECHNICAL_INDICATORS],
  [/volume\s+[\d,]+/gi, EVIDENCE_WEIGHT_VOLUME_DATA],
  [/market\s+cap/gi, EVIDENCE_WEIGHT_MARKET_CAP],
  [/\d{4}-\d{2}-\d{2}/g, EVIDENCE_WEIGHT_DATE_REFERENCES],
  [/quarter|Q[1-4]|fiscal/gi, EVIDENCE_WEIGHT_TEMPORAL_ANCHORS],
  [/support\s+at|resistance\s+at/gi, EVIDENCE_WEIGHT_TECHNICAL_LEVELS],
  [/yield|dividend/gi, EVIDENCE_WEIGHT_INCOME_METRICS],
];

/** Logical connector patterns */
const LOGIC_PATTERNS: [RegExp, number][] = [
  [/\bbecause\b/gi, LOGIC_WEIGHT_BECAUSE],
  [/\btherefore\b/gi, LOGIC_WEIGHT_THEREFORE],
  [/\bdue\s+to\b/gi, LOGIC_WEIGHT_DUE_TO],
  [/\bas\s+a\s+result\b/gi, LOGIC_WEIGHT_AS_A_RESULT],
  [/\bgiven\s+that\b/gi, LOGIC_WEIGHT_GIVEN_THAT],
  [/\bif\b.*\bthen\b/gi, LOGIC_WEIGHT_IF_THEN],
  [/\bsince\b/gi, LOGIC_WEIGHT_SINCE],
  [/\bhowever\b/gi, LOGIC_WEIGHT_HOWEVER],
  [/\bnevertheless\b/gi, LOGIC_WEIGHT_NEVERTHELESS],
  [/\bon\s+the\s+other\s+hand\b/gi, LOGIC_WEIGHT_ON_THE_OTHER_HAND],
  [/\bleading\s+to\b/gi, LOGIC_WEIGHT_LEADING_TO],
  [/\bdriven\s+by\b/gi, LOGIC_WEIGHT_DRIVEN_BY],
];

/** Risk awareness patterns */
const RISK_PATTERNS: [RegExp, number][] = [
  [/\brisk\b/gi, RISK_WEIGHT_RISK],
  [/\bdownside\b/gi, RISK_WEIGHT_DOWNSIDE],
  [/\bstop[- ]?loss\b/gi, RISK_WEIGHT_STOP_LOSS],
  [/\bworst[- ]?case\b/gi, RISK_WEIGHT_WORST_CASE],
  [/\bvolatil/gi, RISK_WEIGHT_VOLATILE],
  [/\buncertain/gi, RISK_WEIGHT_UNCERTAIN],
  [/\bcautious/gi, RISK_WEIGHT_CAUTIOUS],
  [/\bhedge\b/gi, RISK_WEIGHT_HEDGE],
  [/\bexposure\b/gi, RISK_WEIGHT_EXPOSURE],
  [/\bconcentrat/gi, RISK_WEIGHT_CONCENTRATION],
  [/\bif\s+.+\s+falls?\b/gi, RISK_WEIGHT_IF_FALLS],
  [/\bmax\s+(?:loss|drawdown)\b/gi, RISK_WEIGHT_MAX_LOSS],
];

function scorePatterns(text: string, patterns: [RegExp, number][]): number {
  let score = 0;
  for (const [pattern, weight] of patterns) {
    const matches = text.match(pattern);
    if (matches) {
      score += weight * Math.min(matches.length, PATTERN_MATCH_SATURATION);
    }
  }
  return Math.min(PATTERN_SCORE_MAX, score);
}

function computeOriginality(textA: string, textB: string): [number, number] {
  const wordsA = new Set(textA.toLowerCase().split(/\s+/).filter(w => w.length > ORIGINALITY_MIN_WORD_LENGTH));
  const wordsB = new Set(textB.toLowerCase().split(/\s+/).filter(w => w.length > ORIGINALITY_MIN_WORD_LENGTH));

  if (wordsA.size === 0 && wordsB.size === 0) return [0.5, 0.5];

  const intersectionSize = countByCondition([...wordsA], w => wordsB.has(w));
  const unionSize = new Set([...wordsA, ...wordsB]).size;
  const jaccard = unionSize > 0 ? intersectionSize / unionSize : 0;

  // Lower overlap = more original
  const overlap = jaccard;
  const uniqueA = wordsA.size > 0
    ? countByCondition([...wordsA], w => !wordsB.has(w)) / wordsA.size
    : 0;
  const uniqueB = wordsB.size > 0
    ? countByCondition([...wordsB], w => !wordsA.has(w)) / wordsB.size
    : 0;

  return [
    Math.min(PATTERN_SCORE_MAX, ORIGINALITY_BASE_SCORE + uniqueA * ORIGINALITY_UNIQUE_WORD_WEIGHT - overlap * ORIGINALITY_OVERLAP_PENALTY),
    Math.min(PATTERN_SCORE_MAX, ORIGINALITY_BASE_SCORE + uniqueB * ORIGINALITY_UNIQUE_WORD_WEIGHT - overlap * ORIGINALITY_OVERLAP_PENALTY),
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
  return Math.max(0, CONSISTENCY_BASE_SCORE - contradictions * CONTRADICTION_PENALTY_PER_COUNT);
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
  const logicalConsistency = (logic * CONSISTENCY_LOGIC_PATTERN_WEIGHT + consistency * CONSISTENCY_NO_CONTRADICTION_WEIGHT);
  const riskDisclosure = scorePatterns(reasoning, RISK_PATTERNS);

  // Calibration: penalize extreme confidence without evidence
  const calibrationPenalty = confidence > CALIBRATION_HIGH_CONFIDENCE_THRESHOLD && evidence < CALIBRATION_LOW_EVIDENCE_THRESHOLD ? CALIBRATION_OVERCONFIDENCE_PENALTY : 0;
  const calibrationBonus = (confidence > CALIBRATION_BONUS_CONFIDENCE_MIN && confidence < CALIBRATION_BONUS_CONFIDENCE_MAX && evidence > CALIBRATION_BONUS_EVIDENCE_THRESHOLD) ? CALIBRATION_BONUS : 0;
  const calibrationAccuracy = Math.min(PATTERN_SCORE_MAX, Math.max(0,
    CALIBRATION_BASE_SCORE + calibrationBonus - calibrationPenalty + evidence * CALIBRATION_EVIDENCE_WEIGHT
  ));

  const [originality] = computeOriginality(reasoning, opponentReasoning);

  const composite =
    evidence * COMPOSITE_WEIGHT_EVIDENCE +
    logicalConsistency * COMPOSITE_WEIGHT_LOGIC +
    calibrationAccuracy * COMPOSITE_WEIGHT_CALIBRATION +
    riskDisclosure * COMPOSITE_WEIGHT_RISK +
    originality * COMPOSITE_WEIGHT_ORIGINALITY;

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
    scoresA.evidenceWeight * COMPOSITE_WEIGHT_EVIDENCE +
    scoresA.logicalConsistency * COMPOSITE_WEIGHT_LOGIC +
    scoresA.calibrationAccuracy * COMPOSITE_WEIGHT_CALIBRATION +
    scoresA.riskDisclosure * COMPOSITE_WEIGHT_RISK +
    scoresA.originality * COMPOSITE_WEIGHT_ORIGINALITY
  );
  scoresB.composite = round2(
    scoresB.evidenceWeight * COMPOSITE_WEIGHT_EVIDENCE +
    scoresB.logicalConsistency * COMPOSITE_WEIGHT_LOGIC +
    scoresB.calibrationAccuracy * COMPOSITE_WEIGHT_CALIBRATION +
    scoresB.riskDisclosure * COMPOSITE_WEIGHT_RISK +
    scoresB.originality * COMPOSITE_WEIGHT_ORIGINALITY
  );

  const diff = scoresA.composite - scoresB.composite;
  const margin = Math.abs(diff);
  const winner = margin < ARBITRATION_TIE_THRESHOLD ? "tie" : (diff > 0 ? agentA : agentB);
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
                   (arCase.actionA === "hold" && Math.abs(priceChange) < OUTCOME_HOLD_CORRECT_THRESHOLD);

  const bCorrect = (arCase.actionB === "buy" && priceChange > 0) ||
                   (arCase.actionB === "sell" && priceChange < 0) ||
                   (arCase.actionB === "hold" && Math.abs(priceChange) < OUTCOME_HOLD_CORRECT_THRESHOLD);

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
  const recentCases = cases.slice(0, TREND_RECENT_WINDOW);
  const olderCases = cases.slice(TREND_OLDER_WINDOW_START, TREND_OLDER_WINDOW_END);
  let trend: "improving" | "stable" | "declining" = "stable";
  if (recentCases.length >= TREND_MIN_CASES_PER_WINDOW && olderCases.length >= TREND_MIN_CASES_PER_WINDOW) {
    const recentAvg = recentCases.reduce((s, c) => {
      const scores = c.agentA === agentId ? c.scoresA : c.scoresB;
      return s + scores.composite;
    }, 0) / recentCases.length;
    const olderAvg = olderCases.reduce((s, c) => {
      const scores = c.agentA === agentId ? c.scoresA : c.scoresB;
      return s + scores.composite;
    }, 0) / olderCases.length;
    const diff = recentAvg - olderAvg;
    if (diff > TREND_IMPROVEMENT_THRESHOLD) trend = "improving";
    else if (diff < TREND_DECLINE_THRESHOLD) trend = "declining";
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
  const trendScore = profile.recentTrend === "improving" ? PILLAR_TREND_SCORE_IMPROVING
    : profile.recentTrend === "stable" ? PILLAR_TREND_SCORE_STABLE : PILLAR_TREND_SCORE_DECLINING;

  return round2(
    profile.winRate * PILLAR_WEIGHT_WIN_RATE +
    profile.avgComposite * PILLAR_WEIGHT_AVG_COMPOSITE +
    profile.outcomeAccuracy * PILLAR_WEIGHT_OUTCOME_ACCURACY +
    trendScore * PILLAR_WEIGHT_TREND
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
