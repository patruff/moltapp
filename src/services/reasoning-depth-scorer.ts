/**
 * Reasoning Depth Scorer (v16)
 *
 * Advanced NLP-based scoring of reasoning quality with a focus on DEPTH,
 * not just surface-level coherence. This measures whether an agent actually
 * thinks deeply or just produces plausible-sounding filler.
 *
 * Scoring Dimensions:
 * 1. ANALYTICAL BREADTH: How many distinct analytical angles are covered?
 * 2. EVIDENCE SPECIFICITY: Does reasoning cite specific data points vs vague assertions?
 * 3. CAUSAL CHAIN: Does the reasoning explain WHY (cause-effect), not just WHAT?
 * 4. RISK AWARENESS: Does the agent acknowledge what could go wrong?
 * 5. TEMPORAL REASONING: Does the agent reason about time horizons?
 * 6. COMPARATIVE ANALYSIS: Does the agent compare alternatives?
 * 7. QUANTITATIVE RIGOR: Are claims backed by numbers?
 * 8. THESIS STRUCTURE: Is there a clear thesis → evidence → conclusion flow?
 */

import { splitSentences, countWords, round3 } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DepthScore {
  /** Overall depth score 0.0 to 1.0 */
  overall: number;
  /** Classification: shallow, moderate, deep, exceptional */
  classification: "shallow" | "moderate" | "deep" | "exceptional";
  /** Grade letter */
  grade: string;
  /** Individual dimension scores */
  dimensions: {
    analyticalBreadth: DimensionScore;
    evidenceSpecificity: DimensionScore;
    causalChain: DimensionScore;
    riskAwareness: DimensionScore;
    temporalReasoning: DimensionScore;
    comparativeAnalysis: DimensionScore;
    quantitativeRigor: DimensionScore;
    thesisStructure: DimensionScore;
  };
  /** Raw text metrics */
  textMetrics: {
    wordCount: number;
    sentenceCount: number;
    avgSentenceLength: number;
    uniqueWordRatio: number;
    questionCount: number;
  };
  /** Detected analytical angles */
  anglesDetected: string[];
  /** Strongest dimension */
  strongestDimension: string;
  /** Weakest dimension */
  weakestDimension: string;
}

export interface DimensionScore {
  score: number;
  weight: number;
  evidence: string[];
}

// ---------------------------------------------------------------------------
// Dimension Weights
// ---------------------------------------------------------------------------

const DIMENSION_WEIGHTS = {
  analyticalBreadth:   0.18,
  evidenceSpecificity: 0.16,
  causalChain:         0.14,
  riskAwareness:       0.12,
  temporalReasoning:   0.10,
  comparativeAnalysis: 0.10,
  quantitativeRigor:   0.12,
  thesisStructure:     0.08,
};

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Grade Boundaries
 *
 * Maps overall depth scores (0.0-1.0) to letter grades (A+ through F).
 * Lower thresholds make grading more lenient; higher thresholds stricter.
 */
const GRADE_THRESHOLD_A_PLUS = 0.95;  // Exceptional reasoning (top 5%)
const GRADE_THRESHOLD_A = 0.90;       // Outstanding depth and rigor
const GRADE_THRESHOLD_A_MINUS = 0.85; // Excellent multi-dimensional analysis
const GRADE_THRESHOLD_B_PLUS = 0.80;  // Strong analytical breadth
const GRADE_THRESHOLD_B = 0.75;       // Good depth with minor gaps
const GRADE_THRESHOLD_B_MINUS = 0.70; // Above average analysis
const GRADE_THRESHOLD_C_PLUS = 0.65;  // Adequate depth
const GRADE_THRESHOLD_C = 0.60;       // Meets minimum depth requirements
const GRADE_THRESHOLD_C_MINUS = 0.55; // Below average depth
const GRADE_THRESHOLD_D_PLUS = 0.50;  // Minimal depth
const GRADE_THRESHOLD_D = 0.45;       // Poor analytical rigor
const GRADE_THRESHOLD_D_MINUS = 0.40; // Very limited depth (< 0.40 = F)

/**
 * Scoring Divisors
 *
 * Normalization parameters for computing dimension scores from raw counts.
 * Higher divisors make scoring stricter (require more evidence for high scores).
 */
const ANALYTICAL_BREADTH_DIVISOR = 5;        // angles / 5 = breadth score (5+ angles = 1.0)
const EVIDENCE_SPECIFICITY_FACTOR = 0.08;    // specific references / (wordCount * 0.08 + 1)
const CAUSAL_CHAIN_DIVISOR = 4;              // causal connectors / 4 = causal score
const RISK_AWARENESS_DIVISOR = 4;            // risk patterns / 4 = risk score
const TEMPORAL_REASONING_DIVISOR = 3;        // temporal patterns / 3 = temporal score
const COMPARATIVE_ANALYSIS_DIVISOR = 3;      // comparative patterns / 3 = comparative score
const QUANTITATIVE_RIGOR_FACTOR = 0.3;       // numbers / (sentenceCount * 0.3 + 1)

/**
 * Classification Boundaries
 *
 * Thresholds for classifying reasoning depth (exceptional/deep/moderate/shallow).
 * Used in leaderboard presentation and agent profiles.
 */
const CLASSIFICATION_EXCEPTIONAL_THRESHOLD = 0.80; // >= 0.80 = exceptional reasoning
const CLASSIFICATION_DEEP_THRESHOLD = 0.55;        // >= 0.55 = deep reasoning
const CLASSIFICATION_MODERATE_THRESHOLD = 0.30;    // >= 0.30 = moderate reasoning (< 0.30 = shallow)

/**
 * Thesis Structure Scoring Weights
 *
 * Weight distribution for thesis structure dimension (thesis + evidence + conclusion).
 * Must sum to 1.0 for normalized scoring.
 */
const THESIS_STRUCTURE_WEIGHT_THESIS = 0.35;      // 35% for thesis statement
const THESIS_STRUCTURE_WEIGHT_EVIDENCE = 0.35;    // 35% for supporting evidence
const THESIS_STRUCTURE_WEIGHT_CONCLUSION = 0.30;  // 30% for conclusion

/**
 * Thesis Structure Detection Thresholds
 *
 * Minimum evidence counts to consider thesis structure element present.
 */
const THESIS_EVIDENCE_MIN_NUMBERS = 2;  // >= 2 specific numbers = has evidence
const THESIS_EVIDENCE_MIN_CAUSAL = 1;   // >= 1 causal connector = has evidence

/**
 * Quick Classification Thresholds
 *
 * Fast depth classification without full scoring (used in high-volume contexts).
 * Combines word count and analytical angle count for quick triage.
 */
const QUICK_CLASSIFY_WORD_MIN_SHALLOW = 15;       // < 15 words = always shallow
const QUICK_CLASSIFY_WORD_MIN_EXCEPTIONAL = 80;   // >= 80 words required for exceptional
const QUICK_CLASSIFY_WORD_MIN_DEEP = 40;          // >= 40 words required for deep
const QUICK_CLASSIFY_WORD_MIN_MODERATE = 20;      // >= 20 words required for moderate
const QUICK_CLASSIFY_ANGLES_MIN_EXCEPTIONAL = 5;  // >= 5 angles required for exceptional
const QUICK_CLASSIFY_ANGLES_MIN_DEEP = 3;         // >= 3 angles required for deep
const QUICK_CLASSIFY_ANGLES_MIN_MODERATE = 1;     // >= 1 angle required for moderate

/**
 * Comparison Margin Thresholds
 *
 * Thresholds for determining winners in head-to-head depth comparisons.
 */
const COMPARISON_TIE_MARGIN = 0.02;              // Overall score difference < 0.02 = tie
const COMPARISON_DIMENSION_WIN_MARGIN = 0.05;    // Dimension score difference > 0.05 = clear winner

// ---------------------------------------------------------------------------
// Analytical Angle Detection
// ---------------------------------------------------------------------------

const ANALYTICAL_ANGLES: Record<string, RegExp[]> = {
  valuation: [
    /P\/E\s+ratio/i, /price[\s-]to[\s-](?:earnings|book|sales)/i,
    /undervalued|overvalued/i, /intrinsic\s+value/i,
    /fair\s+value|price\s+target/i, /multiple\s+expansion/i,
    /EV\/EBITDA/i, /DCF/i, /book\s+value/i,
  ],
  technical: [
    /moving\s+average|SMA|EMA/i, /RSI|relative\s+strength/i,
    /MACD/i, /Bollinger\s+Band/i, /support\s+(?:level|at)/i,
    /resistance\s+(?:level|at)/i, /breakout/i, /chart\s+pattern/i,
    /volume\s+(?:spike|surge|profile|analysis)/i, /Fibonacci/i,
    /stochastic/i, /divergence/i, /momentum\s+indicator/i,
    /candlestick/i, /trend\s*line/i, /golden\s+cross/i,
    /death\s+cross/i, /head\s+and\s+shoulders/i,
  ],
  fundamental: [
    /revenue\s+(?:growth|decline|beat|miss)/i, /earnings\s+(?:growth|beat|miss|surprise)/i,
    /profit\s+margin/i, /free\s+cash\s+flow/i, /balance\s+sheet/i,
    /debt[\s-]to[\s-]equity/i, /ROE|return\s+on\s+equity/i,
    /guidance/i, /margin\s+(?:expansion|compression)/i,
    /operating\s+(?:income|expenses)/i, /cost\s+(?:cutting|reduction)/i,
  ],
  macro: [
    /interest\s+rate/i, /Fed|Federal\s+Reserve/i, /inflation/i,
    /GDP|gross\s+domestic/i, /unemployment/i, /CPI/i,
    /monetary\s+policy/i, /fiscal\s+(?:policy|stimulus)/i,
    /recession/i, /economic\s+(?:growth|slowdown|cycle)/i,
    /Treasury|bond\s+yield/i, /dollar\s+(?:strength|weakness)/i,
  ],
  sentiment: [
    /market\s+sentiment/i, /investor\s+(?:confidence|fear|greed)/i,
    /VIX|fear\s+index/i, /put[\s-]call\s+ratio/i,
    /short\s+interest/i, /retail\s+(?:investor|trader)/i,
    /institutional\s+(?:buying|selling)/i, /insider\s+(?:buying|selling)/i,
    /social\s+media\s+sentiment/i, /fear\s+and\s+greed/i,
  ],
  sector: [
    /sector\s+(?:rotation|performance|comparison)/i,
    /industry\s+(?:trend|comparison|leader)/i,
    /peer\s+(?:group|comparison|performance)/i,
    /market\s+share/i, /competitive\s+(?:advantage|landscape|position)/i,
    /moat|barrier\s+to\s+entry/i, /TAM|total\s+addressable\s+market/i,
  ],
  risk: [
    /risk[\s-]reward/i, /downside\s+(?:risk|scenario|protection)/i,
    /stop[\s-]loss/i, /position\s+sizing/i,
    /portfolio\s+(?:concentration|diversification)/i,
    /worst[\s-]case/i, /tail\s+risk/i, /hedg/i,
    /maximum\s+(?:drawdown|loss)/i, /risk\s+management/i,
  ],
  catalyst: [
    /earnings\s+(?:call|report|season)/i, /product\s+launch/i,
    /FDA\s+(?:approval|decision)/i, /merger|acquisition|M&A/i,
    /IPO/i, /stock\s+(?:split|buyback)/i, /dividend/i,
    /regulation|regulatory/i, /partnership|collaboration/i,
    /patent/i, /clinical\s+trial/i, /new\s+contract/i,
  ],
  portfolio: [
    /portfolio\s+(?:allocation|weight|balance|rebalancing)/i,
    /position\s+(?:size|limit|management)/i,
    /cash\s+(?:buffer|reserve|allocation)/i,
    /concentration\s+risk/i, /diversif/i,
    /allocation\s+(?:target|limit)/i,
    /exposure|overexposed|underexposed/i,
  ],
  timing: [
    /entry\s+point|exit\s+(?:point|strategy)/i,
    /time\s+horizon/i, /short[\s-]term|medium[\s-]term|long[\s-]term/i,
    /holding\s+period/i, /swing\s+trade|day\s+trade/i,
    /dollar[\s-]cost\s+averag/i, /scaling\s+(?:in|out)/i,
    /patience|wait\s+for/i,
  ],
};

// ---------------------------------------------------------------------------
// Causal Connectors
// ---------------------------------------------------------------------------

const CAUSAL_PATTERNS: RegExp[] = [
  /\bbecause\b/i, /\btherefore\b/i, /\bdue\s+to\b/i,
  /\bas\s+a\s+result\b/i, /\bconsequently\b/i, /\bthis\s+(?:means|suggests|implies|indicates)\b/i,
  /\bleading\s+to\b/i, /\bcaused\s+by\b/i, /\bdriven\s+by\b/i,
  /\bif\s+.+\s+then\b/i, /\bgiven\s+that\b/i,
  /\bwhich\s+(?:means|suggests|would)\b/i,
  /\bfor\s+this\s+reason\b/i, /\bhence\b/i,
];

// ---------------------------------------------------------------------------
// Risk Awareness Patterns
// ---------------------------------------------------------------------------

const RISK_PATTERNS: RegExp[] = [
  /\brisk\b/i, /\bdownside\b/i, /\bworst[\s-]case\b/i,
  /\bcould\s+(?:fall|decline|drop)\b/i, /\bif\s+(?:wrong|incorrect)\b/i,
  /\bstop[\s-]loss\b/i, /\bhedg/i, /\bvolatil/i,
  /\buncertain/i, /\bcaveat/i, /\bwarn/i,
  /\blimit\s+(?:losses|downside|exposure)\b/i,
  /\bprotect/i, /\bdefensive/i,
  /\bcounterargument/i, /\bon\s+the\s+other\s+hand\b/i,
  /\bcontrary\s+(?:evidence|argument|view)\b/i,
];

// ---------------------------------------------------------------------------
// Temporal Patterns
// ---------------------------------------------------------------------------

const TEMPORAL_PATTERNS: RegExp[] = [
  /\bshort[\s-]term\b/i, /\bmedium[\s-]term\b/i, /\blong[\s-]term\b/i,
  /\bnext\s+(?:week|month|quarter|year|earnings)\b/i,
  /\bwithin\s+\d+\s+(?:day|week|month)/i,
  /\btime\s+horizon\b/i, /\bholding\s+period\b/i,
  /\bby\s+(?:year|quarter)[\s-]end\b/i,
  /\b(?:24h|48h|72h|1[\s-]week|2[\s-]week|1[\s-]month)/i,
  /\bhistoric/i, /\bseasonality/i, /\brecent(?:ly)?\b/i,
  /\bprevious(?:ly)?\b/i, /\bover\s+the\s+past\b/i,
];

// ---------------------------------------------------------------------------
// Comparative Patterns
// ---------------------------------------------------------------------------

const COMPARATIVE_PATTERNS: RegExp[] = [
  /\bcompared\s+to\b/i, /\bversus\b/i, /\bvs\.?\b/i,
  /\brelative\s+to\b/i, /\boutperform/i, /\bunderperform/i,
  /\bbetter\s+than\b/i, /\bworse\s+than\b/i,
  /\balternative\b/i, /\binstead\s+of\b/i,
  /\bwhile\s+.+\s+on\s+the\s+other\b/i,
  /\bwhereas\b/i, /\bin\s+contrast\b/i,
  /\brather\s+than\b/i,
];

// ---------------------------------------------------------------------------
// Core Scoring Function
// ---------------------------------------------------------------------------

function scoreToGrade(score: number): string {
  if (score >= GRADE_THRESHOLD_A_PLUS) return "A+";
  if (score >= GRADE_THRESHOLD_A) return "A";
  if (score >= GRADE_THRESHOLD_A_MINUS) return "A-";
  if (score >= GRADE_THRESHOLD_B_PLUS) return "B+";
  if (score >= GRADE_THRESHOLD_B) return "B";
  if (score >= GRADE_THRESHOLD_B_MINUS) return "B-";
  if (score >= GRADE_THRESHOLD_C_PLUS) return "C+";
  if (score >= GRADE_THRESHOLD_C) return "C";
  if (score >= GRADE_THRESHOLD_C_MINUS) return "C-";
  if (score >= GRADE_THRESHOLD_D_PLUS) return "D+";
  if (score >= GRADE_THRESHOLD_D) return "D";
  if (score >= GRADE_THRESHOLD_D_MINUS) return "D-";
  return "F";
}

/**
 * Perform full depth analysis on a reasoning text.
 */
export function scoreReasoningDepth(reasoning: string): DepthScore {
  const words = reasoning.split(/\s+/).filter((w) => w.length > 0);
  const wordCount = words.length;
  const sentences = splitSentences(reasoning, 0);
  const sentenceCount = sentences.length;
  const avgSentenceLength = sentenceCount > 0 ? wordCount / sentenceCount : 0;
  const uniqueWords = new Set(words.map((w) => w.toLowerCase()));
  const uniqueWordRatio = wordCount > 0 ? uniqueWords.size / wordCount : 0;
  const questionCount = (reasoning.match(/\?/g) ?? []).length;

  // 1. Analytical Breadth: count distinct analytical angles
  const anglesDetected: string[] = [];
  for (const [angle, patterns] of Object.entries(ANALYTICAL_ANGLES)) {
    for (const pat of patterns) {
      if (pat.test(reasoning)) {
        anglesDetected.push(angle);
        break; // One match per angle is enough
      }
    }
  }

  const breadthScore = Math.min(1, anglesDetected.length / ANALYTICAL_BREADTH_DIVISOR);
  const analyticalBreadth: DimensionScore = {
    score: breadthScore,
    weight: DIMENSION_WEIGHTS.analyticalBreadth,
    evidence: anglesDetected.map((a) => `Covers ${a} analysis`),
  };

  // 2. Evidence Specificity: specific data points vs vague claims
  const specificNumbers = (reasoning.match(/\$[\d,.]+|[\d.]+%|\d+\.\d+|\d{4,}/g) ?? []).length;
  const specificSymbols = (reasoning.match(/\b[A-Z]{2,5}x?\b/g) ?? []).length;
  const totalSpecific = specificNumbers + specificSymbols;
  const specificityScore = Math.min(1, totalSpecific / (wordCount * EVIDENCE_SPECIFICITY_FACTOR + 1));
  const evidenceSpecificity: DimensionScore = {
    score: specificityScore,
    weight: DIMENSION_WEIGHTS.evidenceSpecificity,
    evidence: [`${specificNumbers} numeric references, ${specificSymbols} symbol references`],
  };

  // 3. Causal Chain
  let causalCount = 0;
  const causalEvidence: string[] = [];
  for (const pat of CAUSAL_PATTERNS) {
    const match = reasoning.match(pat);
    if (match) {
      causalCount++;
      causalEvidence.push(match[0]);
    }
  }
  const causalScore = Math.min(1, causalCount / CAUSAL_CHAIN_DIVISOR);
  const causalChain: DimensionScore = {
    score: causalScore,
    weight: DIMENSION_WEIGHTS.causalChain,
    evidence: causalEvidence.slice(0, 5),
  };

  // 4. Risk Awareness
  let riskCount = 0;
  const riskEvidence: string[] = [];
  for (const pat of RISK_PATTERNS) {
    const match = reasoning.match(pat);
    if (match) {
      riskCount++;
      riskEvidence.push(match[0]);
    }
  }
  const riskScore = Math.min(1, riskCount / RISK_AWARENESS_DIVISOR);
  const riskAwareness: DimensionScore = {
    score: riskScore,
    weight: DIMENSION_WEIGHTS.riskAwareness,
    evidence: riskEvidence.slice(0, 5),
  };

  // 5. Temporal Reasoning
  let temporalCount = 0;
  const temporalEvidence: string[] = [];
  for (const pat of TEMPORAL_PATTERNS) {
    const match = reasoning.match(pat);
    if (match) {
      temporalCount++;
      temporalEvidence.push(match[0]);
    }
  }
  const temporalScore = Math.min(1, temporalCount / TEMPORAL_REASONING_DIVISOR);
  const temporalReasoning: DimensionScore = {
    score: temporalScore,
    weight: DIMENSION_WEIGHTS.temporalReasoning,
    evidence: temporalEvidence.slice(0, 5),
  };

  // 6. Comparative Analysis
  let compCount = 0;
  const compEvidence: string[] = [];
  for (const pat of COMPARATIVE_PATTERNS) {
    const match = reasoning.match(pat);
    if (match) {
      compCount++;
      compEvidence.push(match[0]);
    }
  }
  const compScore = Math.min(1, compCount / 3);
  const comparativeAnalysis: DimensionScore = {
    score: compScore,
    weight: DIMENSION_WEIGHTS.comparativeAnalysis,
    evidence: compEvidence.slice(0, 5),
  };

  // 7. Quantitative Rigor
  const quantScore = Math.min(1, specificNumbers / (sentenceCount * 0.3 + 1));
  const quantitativeRigor: DimensionScore = {
    score: quantScore,
    weight: DIMENSION_WEIGHTS.quantitativeRigor,
    evidence: [`${specificNumbers} quantitative claims across ${sentenceCount} sentences`],
  };

  // 8. Thesis Structure: detect intro, body, conclusion
  const hasThesis = /\b(?:thesis|believe|position|view|strategy|approach|decision)\b/i.test(reasoning);
  const hasEvidence = specificNumbers >= 2 || causalCount >= 1;
  const hasConclusion = /\b(?:therefore|thus|consequently|conclusion|accordingly|decision|action)\b/i.test(reasoning);
  const structureScore = (hasThesis ? 0.35 : 0) + (hasEvidence ? 0.35 : 0) + (hasConclusion ? 0.30 : 0);
  const thesisStructure: DimensionScore = {
    score: structureScore,
    weight: DIMENSION_WEIGHTS.thesisStructure,
    evidence: [
      hasThesis ? "Has thesis statement" : "Missing thesis",
      hasEvidence ? "Has supporting evidence" : "Missing evidence",
      hasConclusion ? "Has conclusion" : "Missing conclusion",
    ].filter((e) => !e.startsWith("Missing")),
  };

  // Compute overall score
  const dimensions = {
    analyticalBreadth,
    evidenceSpecificity,
    causalChain,
    riskAwareness,
    temporalReasoning,
    comparativeAnalysis,
    quantitativeRigor,
    thesisStructure,
  };

  const overall = Object.values(dimensions).reduce(
    (sum, dim) => sum + dim.score * dim.weight,
    0,
  );

  // Classification
  let classification: "shallow" | "moderate" | "deep" | "exceptional";
  if (overall >= 0.80) classification = "exceptional";
  else if (overall >= 0.55) classification = "deep";
  else if (overall >= 0.30) classification = "moderate";
  else classification = "shallow";

  // Find strongest/weakest
  const dimEntries = Object.entries(dimensions);
  dimEntries.sort((a, b) => b[1].score - a[1].score);
  const strongestDimension = dimEntries[0][0];
  const weakestDimension = dimEntries[dimEntries.length - 1][0];

  return {
    overall: round3(overall),
    classification,
    grade: scoreToGrade(overall),
    dimensions,
    textMetrics: {
      wordCount,
      sentenceCount,
      avgSentenceLength: Math.round(avgSentenceLength * 10) / 10,
      uniqueWordRatio: round3(uniqueWordRatio),
      questionCount,
    },
    anglesDetected,
    strongestDimension,
    weakestDimension,
  };
}

/**
 * Quick depth classification without full analysis.
 */
export function quickClassify(reasoning: string): "shallow" | "moderate" | "deep" | "exceptional" {
  const words = countWords(reasoning);
  if (words < 15) return "shallow";

  let angles = 0;
  for (const patterns of Object.values(ANALYTICAL_ANGLES)) {
    for (const pat of patterns) {
      if (pat.test(reasoning)) {
        angles++;
        break;
      }
    }
  }

  if (angles >= 5 && words >= 80) return "exceptional";
  if (angles >= 3 && words >= 40) return "deep";
  if (angles >= 1 && words >= 20) return "moderate";
  return "shallow";
}

/**
 * Compare depth scores between two reasoning texts.
 */
export function compareDepth(reasoningA: string, reasoningB: string): {
  scoreA: DepthScore;
  scoreB: DepthScore;
  winner: "A" | "B" | "tie";
  margin: number;
  dimensionWins: { A: string[]; B: string[] };
} {
  const scoreA = scoreReasoningDepth(reasoningA);
  const scoreB = scoreReasoningDepth(reasoningB);

  const margin = Math.abs(scoreA.overall - scoreB.overall);
  const winner = margin < 0.02 ? "tie" : (scoreA.overall > scoreB.overall ? "A" : "B");

  const dimensionWins: { A: string[]; B: string[] } = { A: [], B: [] };
  const dimNamesA = Object.keys(scoreA.dimensions) as (keyof typeof scoreA.dimensions)[];
  for (const dim of dimNamesA) {
    if (scoreA.dimensions[dim].score > scoreB.dimensions[dim].score + 0.05) {
      dimensionWins.A.push(dim);
    } else if (scoreB.dimensions[dim].score > scoreA.dimensions[dim].score + 0.05) {
      dimensionWins.B.push(dim);
    }
  }

  return { scoreA, scoreB, winner, margin: round3(margin), dimensionWins };
}
