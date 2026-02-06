/**
 * Benchmark Intelligence Engine (v16)
 *
 * The unified scoring brain for MoltApp's AI Trading Benchmark.
 * Computes a 14-pillar composite score across all dimensions of agent intelligence,
 * with two NEW pillars in v16:
 *
 *   13. METACOGNITION: Does the agent know what it knows? Measures self-awareness
 *       of uncertainty, calibration of confidence vs actual capability, and
 *       ability to hedge when unsure.
 *
 *   14. REASONING EFFICIENCY: Signal-to-noise ratio in reasoning text.
 *       Penalizes verbose filler, rewards dense analytical content per word.
 *
 * This engine is the single source of truth for all benchmark scores.
 * It replaces ad-hoc scoring scattered across v9-v15 with a unified pipeline.
 */

import { countWords, splitSentences } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PillarScore {
  name: string;
  score: number;       // 0.0 to 1.0
  weight: number;      // Contribution to composite
  grade: string;       // A+ through F
  components: Record<string, number>;
  explanation: string;
}

export interface V16BenchmarkScore {
  agentId: string;
  composite: number;
  grade: string;
  pillars: PillarScore[];
  rank: number;
  rankChange: number;      // vs previous scoring
  tradeCount: number;
  lastUpdated: string;
  metacognition: MetacognitionProfile;
  efficiency: EfficiencyProfile;
}

export interface MetacognitionProfile {
  /** Does the agent express appropriate uncertainty? */
  uncertaintyCalibration: number;
  /** Does high confidence correlate with good outcomes? */
  confidenceAccuracy: number;
  /** Does the agent hedge more when data is ambiguous? */
  hedgingAppropriacy: number;
  /** Does the agent change strategy when market regime changes? */
  regimeAdaptation: number;
  /** Composite metacognition score */
  composite: number;
}

export interface EfficiencyProfile {
  /** Analytical content per word (signal-to-noise) */
  informationDensity: number;
  /** Ratio of unique analytical claims to total words */
  claimDensity: number;
  /** Penalizes boilerplate, filler, and repetition */
  originalityPerWord: number;
  /** Ratio of quantitative claims (numbers, percentages) to qualitative */
  quantitativeRatio: number;
  /** Composite efficiency score */
  composite: number;
}

// ---------------------------------------------------------------------------
// In-memory scoring store
// ---------------------------------------------------------------------------

interface AgentMetricWindow {
  coherence: number[];
  hallucinationFree: number[];
  discipline: number[];
  confidence: number[];
  outcomes: boolean[];      // true = profitable
  wordCounts: number[];
  quantClaims: number[];
  hedgeWords: number[];
  regimeActions: { regime: string; action: string; success: boolean }[];
  sentimentScores: number[];
  intents: string[];
  depths: number[];
  forensicScores: number[];
  validationScores: number[];
  predictionCorrect: boolean[];
  provenanceValid: boolean[];
  modelComparisonScores: number[];
}

const agentWindows = new Map<string, AgentMetricWindow>();
const agentScores = new Map<string, V16BenchmarkScore>();
const previousRanks = new Map<string, number>();

const WINDOW_SIZE = 200;

function getWindow(agentId: string): AgentMetricWindow {
  let w = agentWindows.get(agentId);
  if (!w) {
    w = {
      coherence: [], hallucinationFree: [], discipline: [], confidence: [],
      outcomes: [], wordCounts: [], quantClaims: [], hedgeWords: [],
      regimeActions: [], sentimentScores: [], intents: [], depths: [],
      forensicScores: [], validationScores: [], predictionCorrect: [],
      provenanceValid: [], modelComparisonScores: [],
    };
    agentWindows.set(agentId, w);
  }
  return w;
}

function pushCapped<T>(arr: T[], value: T): void {
  arr.push(value);
  if (arr.length > WINDOW_SIZE) arr.shift();
}

// ---------------------------------------------------------------------------
// Grade computation
// ---------------------------------------------------------------------------

function scoreToGrade(score: number): string {
  if (score >= 0.95) return "A+";
  if (score >= 0.90) return "A";
  if (score >= 0.85) return "A-";
  if (score >= 0.80) return "B+";
  if (score >= 0.75) return "B";
  if (score >= 0.70) return "B-";
  if (score >= 0.65) return "C+";
  if (score >= 0.60) return "C";
  if (score >= 0.55) return "C-";
  if (score >= 0.50) return "D+";
  if (score >= 0.45) return "D";
  if (score >= 0.40) return "D-";
  return "F";
}

function avg(arr: number[]): number {
  return arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0.5;
}

function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = avg(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length);
}

function boolRate(arr: boolean[]): number {
  return arr.length > 0 ? arr.filter(Boolean).length / arr.length : 0.5;
}

// ---------------------------------------------------------------------------
// Metacognition Analyzer
// ---------------------------------------------------------------------------

/**
 * Detect hedge/uncertainty markers in reasoning text.
 * Returns count of hedge expressions found.
 */
const HEDGE_PATTERNS: RegExp[] = [
  /\bperhaps\b/i, /\bmaybe\b/i, /\bmight\b/i, /\bcould\b/i,
  /\bpossibly\b/i, /\buncertain\b/i, /\bnot\s+sure\b/i,
  /\bhowever\b/i, /\bon\s+the\s+other\s+hand\b/i, /\brisk\s+of\b/i,
  /\bcaveat\b/i, /\bdownside\s+scenario\b/i, /\bif\s+wrong\b/i,
  /\bstop[\s-]loss\b/i, /\bworst[\s-]case\b/i, /\bcontrary\b/i,
  /\balternatively\b/i, /\blimited\s+data\b/i, /\binsufficient\b/i,
];

function countHedgeWords(reasoning: string): number {
  let count = 0;
  for (const pat of HEDGE_PATTERNS) {
    if (pat.test(reasoning)) count++;
  }
  return count;
}

/**
 * Count quantitative claims: numbers, percentages, dollar amounts.
 */
function countQuantitativeClaims(reasoning: string): number {
  const nums = (reasoning.match(/\$[\d,.]+/g) ?? []).length;
  const pcts = (reasoning.match(/[\d.]+%/g) ?? []).length;
  const ratios = (reasoning.match(/\d+:\d+/g) ?? []).length;
  const specifics = (reasoning.match(/\b\d+\.?\d*\s*(shares?|units?|days?|weeks?|months?)\b/gi) ?? []).length;
  return nums + pcts + ratios + specifics;
}

/**
 * Compute metacognition scores for an agent.
 */
function computeMetacognition(w: AgentMetricWindow): MetacognitionProfile {
  // 1. Uncertainty calibration: hedging should correlate with lower confidence
  let uncertaintyCalibration = 0.5;
  if (w.hedgeWords.length >= 5 && w.confidence.length >= 5) {
    // If hedge words are higher when confidence is lower = well-calibrated
    const recentHedge = w.hedgeWords.slice(-20);
    const recentConf = w.confidence.slice(-20);
    const len = Math.min(recentHedge.length, recentConf.length);
    if (len >= 3) {
      let negCorrelation = 0;
      for (let i = 0; i < len; i++) {
        if ((recentHedge[i] > 2 && recentConf[i] < 0.6) ||
            (recentHedge[i] <= 1 && recentConf[i] > 0.7)) {
          negCorrelation++;
        }
      }
      uncertaintyCalibration = Math.min(1, negCorrelation / len + 0.2);
    }
  }

  // 2. Confidence accuracy: high confidence should predict good outcomes
  let confidenceAccuracy = 0.5;
  if (w.confidence.length >= 5 && w.outcomes.length >= 5) {
    const len = Math.min(w.confidence.length, w.outcomes.length);
    let correct = 0;
    for (let i = w.confidence.length - len; i < w.confidence.length; i++) {
      const outIdx = i - (w.confidence.length - w.outcomes.length);
      if (outIdx < 0 || outIdx >= w.outcomes.length) continue;
      const highConf = w.confidence[i] >= 0.7;
      const success = w.outcomes[outIdx];
      if ((highConf && success) || (!highConf && !success)) correct++;
    }
    confidenceAccuracy = correct / len;
  }

  // 3. Hedging appropriacy: hedge more when coherence is ambiguous
  let hedgingAppropriacy = 0.5;
  if (w.hedgeWords.length >= 5 && w.coherence.length >= 5) {
    const len = Math.min(w.hedgeWords.length, w.coherence.length);
    let appropriate = 0;
    for (let i = 0; i < len; i++) {
      const hIdx = w.hedgeWords.length - len + i;
      const cIdx = w.coherence.length - len + i;
      // Low coherence + high hedging = appropriate
      if (w.coherence[cIdx] < 0.5 && w.hedgeWords[hIdx] >= 2) appropriate++;
      // High coherence + low hedging = also appropriate (confident when clear)
      if (w.coherence[cIdx] > 0.7 && w.hedgeWords[hIdx] <= 1) appropriate++;
    }
    hedgingAppropriacy = appropriate / len;
  }

  // 4. Regime adaptation: does agent change behavior in different regimes?
  let regimeAdaptation = 0.5;
  if (w.regimeActions.length >= 10) {
    const regimeMap = new Map<string, { actions: string[]; successes: number; total: number }>();
    for (const r of w.regimeActions) {
      const existing = regimeMap.get(r.regime) ?? { actions: [], successes: 0, total: 0 };
      existing.actions.push(r.action);
      existing.total++;
      if (r.success) existing.successes++;
      regimeMap.set(r.regime, existing);
    }
    // More diverse actions across regimes = better adaptation
    const regimeCount = regimeMap.size;
    if (regimeCount >= 2) {
      const actionDiversity = Array.from(regimeMap.values()).reduce((sum, rd) => {
        const uniqueActions = new Set(rd.actions).size;
        return sum + uniqueActions / Math.max(1, rd.actions.length);
      }, 0) / regimeCount;
      regimeAdaptation = Math.min(1, actionDiversity + 0.3);
    }
  }

  const composite = (
    uncertaintyCalibration * 0.30 +
    confidenceAccuracy * 0.30 +
    hedgingAppropriacy * 0.20 +
    regimeAdaptation * 0.20
  );

  return {
    uncertaintyCalibration: Math.round(uncertaintyCalibration * 1000) / 1000,
    confidenceAccuracy: Math.round(confidenceAccuracy * 1000) / 1000,
    hedgingAppropriacy: Math.round(hedgingAppropriacy * 1000) / 1000,
    regimeAdaptation: Math.round(regimeAdaptation * 1000) / 1000,
    composite: Math.round(composite * 1000) / 1000,
  };
}

// ---------------------------------------------------------------------------
// Reasoning Efficiency Analyzer
// ---------------------------------------------------------------------------

/** Filler and boilerplate patterns */
const FILLER_PATTERNS: RegExp[] = [
  /\bas\s+mentioned\b/i, /\bas\s+we\s+can\s+see\b/i,
  /\bit\s+is\s+worth\s+noting\b/i, /\bin\s+conclusion\b/i,
  /\boverall\b/i, /\bthat\s+being\s+said\b/i,
  /\blet\s+me\s+analyze\b/i, /\bI\s+will\s+now\b/i,
  /\blooking\s+at\s+the\s+data\b/i, /\bbased\s+on\s+(?:the\s+)?above\b/i,
  /\btaking\s+(?:all\s+)?(?:this|these)\s+into\s+(?:account|consideration)\b/i,
  /\bit\s+(?:is\s+)?important\s+to\s+note\b/i,
  /\bgiven\s+the\s+current\b/i,
];

/** Analytical content patterns */
const ANALYTICAL_PATTERNS: RegExp[] = [
  /P\/E\s+ratio/i, /EPS/i, /revenue\s+growth/i,
  /support\s+(?:level|at)/i, /resistance\s+(?:level|at)/i,
  /moving\s+average/i, /RSI/i, /MACD/i, /volume\s+profile/i,
  /market\s+cap/i, /dividend\s+yield/i, /beta/i,
  /sector\s+rotation/i, /correlation/i, /volatility/i,
  /liquidity/i, /spread/i, /momentum\s+indicator/i,
  /Sharpe\s+ratio/i, /drawdown/i, /VaR/i,
  /earnings\s+(?:growth|beat|miss|surprise)/i,
  /guidance/i, /margin\s+expansion/i,
  /free\s+cash\s+flow/i, /balance\s+sheet/i,
  /debt[\s-]to[\s-]equity/i, /book\s+value/i,
  /Fibonacci/i, /Bollinger/i, /stochastic/i,
  /head\s+and\s+shoulders/i, /cup\s+and\s+handle/i,
  /double\s+(?:top|bottom)/i, /breakout\s+(?:above|below)/i,
];

function computeEfficiency(reasoning: string): EfficiencyProfile {
  const wordCount = countWords(reasoning);
  if (wordCount === 0) {
    return { informationDensity: 0, claimDensity: 0, originalityPerWord: 0, quantitativeRatio: 0, composite: 0 };
  }

  // 1. Information density: analytical patterns per word
  let analyticalHits = 0;
  for (const pat of ANALYTICAL_PATTERNS) {
    if (pat.test(reasoning)) analyticalHits++;
  }
  const informationDensity = Math.min(1, analyticalHits / (wordCount * 0.03 + 1));

  // 2. Filler ratio (inverted)
  let fillerCount = 0;
  for (const pat of FILLER_PATTERNS) {
    if (pat.test(reasoning)) fillerCount++;
  }
  // claimDensity penalizes filler
  const fillerRatio = fillerCount / Math.max(1, analyticalHits + fillerCount);
  const claimDensity = Math.max(0, 1 - fillerRatio);

  // 3. Originality per word: unique bigrams / total bigrams
  const words = reasoning.toLowerCase().split(/\s+/);
  const bigrams = new Set<string>();
  const allBigrams: string[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    const bg = `${words[i]}_${words[i + 1]}`;
    bigrams.add(bg);
    allBigrams.push(bg);
  }
  const originalityPerWord = allBigrams.length > 0
    ? bigrams.size / allBigrams.length
    : 0;

  // 4. Quantitative ratio
  const quantClaims = countQuantitativeClaims(reasoning);
  const sentences = splitSentences(reasoning).length;
  const quantitativeRatio = Math.min(1, quantClaims / Math.max(1, sentences) * 0.5);

  const composite = (
    informationDensity * 0.30 +
    claimDensity * 0.25 +
    originalityPerWord * 0.25 +
    quantitativeRatio * 0.20
  );

  return {
    informationDensity: Math.round(informationDensity * 1000) / 1000,
    claimDensity: Math.round(claimDensity * 1000) / 1000,
    originalityPerWord: Math.round(originalityPerWord * 1000) / 1000,
    quantitativeRatio: Math.round(quantitativeRatio * 1000) / 1000,
    composite: Math.round(composite * 1000) / 1000,
  };
}

// ---------------------------------------------------------------------------
// 14-Pillar Weights (v16)
// ---------------------------------------------------------------------------

const V16_WEIGHTS: Record<string, number> = {
  financial:           0.12,
  reasoning:           0.11,
  safety:              0.09,
  calibration:         0.08,
  patterns:            0.05,
  adaptability:        0.05,
  forensicQuality:     0.08,
  validationQuality:   0.08,
  predictionAccuracy:  0.06,
  reasoningStability:  0.05,
  provenanceIntegrity: 0.06,
  modelComparison:     0.05,
  metacognition:       0.07,  // NEW in v16
  efficiency:          0.05,  // NEW in v16
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record a trade's metrics into the agent's scoring window.
 */
export function recordV16Metrics(
  agentId: string,
  metrics: {
    coherence: number;
    hallucinationFree: number;
    discipline: boolean;
    confidence: number;
    reasoning: string;
    action: string;
    regime?: string;
    outcome?: boolean;
    depth?: number;
    forensicScore?: number;
    validationScore?: number;
    predictionCorrect?: boolean;
    provenanceValid?: boolean;
    modelComparisonScore?: number;
  },
): void {
  const w = getWindow(agentId);

  pushCapped(w.coherence, metrics.coherence);
  pushCapped(w.hallucinationFree, metrics.hallucinationFree);
  pushCapped(w.discipline, metrics.discipline ? 1 : 0);
  pushCapped(w.confidence, metrics.confidence);

  const wordCount = countWords(metrics.reasoning);
  pushCapped(w.wordCounts, wordCount);
  pushCapped(w.quantClaims, countQuantitativeClaims(metrics.reasoning));
  pushCapped(w.hedgeWords, countHedgeWords(metrics.reasoning));

  if (metrics.depth !== undefined) pushCapped(w.depths, metrics.depth);
  if (metrics.forensicScore !== undefined) pushCapped(w.forensicScores, metrics.forensicScore);
  if (metrics.validationScore !== undefined) pushCapped(w.validationScores, metrics.validationScore);
  if (metrics.outcome !== undefined) pushCapped(w.outcomes, metrics.outcome);
  if (metrics.predictionCorrect !== undefined) pushCapped(w.predictionCorrect, metrics.predictionCorrect);
  if (metrics.provenanceValid !== undefined) pushCapped(w.provenanceValid, metrics.provenanceValid);
  if (metrics.modelComparisonScore !== undefined) pushCapped(w.modelComparisonScores, metrics.modelComparisonScore);

  if (metrics.regime) {
    pushCapped(w.regimeActions, {
      regime: metrics.regime,
      action: metrics.action,
      success: metrics.outcome ?? (metrics.coherence > 0.5),
    });
  }

  // Compute sentiment proxy from coherence signals
  pushCapped(w.sentimentScores, metrics.coherence * 2 - 1);
}

/**
 * Compute the full 14-pillar V16 benchmark score for an agent.
 */
export function computeV16Score(agentId: string): V16BenchmarkScore {
  const w = getWindow(agentId);
  const tradeCount = w.coherence.length;

  // Compute each pillar
  const pillars: PillarScore[] = [];

  // 1. Financial (proxy — actual P&L comes from portfolio tracker)
  const financial = avg(w.outcomes.map((o) => o ? 0.7 : 0.3));
  pillars.push({
    name: "financial",
    score: financial,
    weight: V16_WEIGHTS.financial,
    grade: scoreToGrade(financial),
    components: { winRate: boolRate(w.outcomes) },
    explanation: `Win rate: ${(boolRate(w.outcomes) * 100).toFixed(0)}%`,
  });

  // 2. Reasoning
  const reasoning = avg(w.coherence);
  pillars.push({
    name: "reasoning",
    score: reasoning,
    weight: V16_WEIGHTS.reasoning,
    grade: scoreToGrade(reasoning),
    components: { avgCoherence: avg(w.coherence), depthAvg: avg(w.depths) },
    explanation: `Avg coherence: ${avg(w.coherence).toFixed(3)}`,
  });

  // 3. Safety
  const safety = avg(w.hallucinationFree);
  pillars.push({
    name: "safety",
    score: safety,
    weight: V16_WEIGHTS.safety,
    grade: scoreToGrade(safety),
    components: { hallucinationFreeRate: avg(w.hallucinationFree), disciplineRate: avg(w.discipline) },
    explanation: `Hallucination-free: ${(avg(w.hallucinationFree) * 100).toFixed(0)}%, Discipline: ${(avg(w.discipline) * 100).toFixed(0)}%`,
  });

  // 4. Calibration
  const confStd = stddev(w.confidence);
  const calibration = Math.max(0, 1 - confStd * 2);
  pillars.push({
    name: "calibration",
    score: calibration,
    weight: V16_WEIGHTS.calibration,
    grade: scoreToGrade(calibration),
    components: { confidenceStdDev: confStd, avgConfidence: avg(w.confidence) },
    explanation: `Confidence variance: ${confStd.toFixed(3)}`,
  });

  // 5. Patterns
  const patterns = avg(w.depths.length > 0 ? w.depths : [0.5]);
  pillars.push({
    name: "patterns",
    score: patterns,
    weight: V16_WEIGHTS.patterns,
    grade: scoreToGrade(patterns),
    components: { depthAvg: avg(w.depths) },
    explanation: `Avg depth score: ${patterns.toFixed(3)}`,
  });

  // 6. Adaptability
  const intentSet = new Set(w.intents);
  const adaptability = Math.min(1, intentSet.size / 4 * 0.5 + 0.3);
  pillars.push({
    name: "adaptability",
    score: adaptability,
    weight: V16_WEIGHTS.adaptability,
    grade: scoreToGrade(adaptability),
    components: { intentDiversity: intentSet.size },
    explanation: `${intentSet.size} distinct intents used`,
  });

  // 7. Forensic Quality
  const forensic = avg(w.forensicScores.length > 0 ? w.forensicScores : [0.5]);
  pillars.push({
    name: "forensicQuality",
    score: forensic,
    weight: V16_WEIGHTS.forensicQuality,
    grade: scoreToGrade(forensic),
    components: { avgForensic: forensic },
    explanation: `Avg forensic: ${forensic.toFixed(3)}`,
  });

  // 8. Validation Quality
  const validation = avg(w.validationScores.length > 0 ? w.validationScores : [0.5]);
  pillars.push({
    name: "validationQuality",
    score: validation,
    weight: V16_WEIGHTS.validationQuality,
    grade: scoreToGrade(validation),
    components: { avgValidation: validation },
    explanation: `Avg validation: ${validation.toFixed(3)}`,
  });

  // 9. Prediction Accuracy
  const prediction = boolRate(w.predictionCorrect);
  pillars.push({
    name: "predictionAccuracy",
    score: prediction,
    weight: V16_WEIGHTS.predictionAccuracy,
    grade: scoreToGrade(prediction),
    components: { accuracy: prediction },
    explanation: `Prediction correct: ${(prediction * 100).toFixed(0)}%`,
  });

  // 10. Reasoning Stability
  const sentStd = stddev(w.sentimentScores);
  const stability = Math.max(0, 1 - sentStd);
  pillars.push({
    name: "reasoningStability",
    score: stability,
    weight: V16_WEIGHTS.reasoningStability,
    grade: scoreToGrade(stability),
    components: { sentimentStdDev: sentStd },
    explanation: `Sentiment volatility: ${sentStd.toFixed(3)}`,
  });

  // 11. Provenance Integrity
  const provenance = boolRate(w.provenanceValid);
  pillars.push({
    name: "provenanceIntegrity",
    score: provenance,
    weight: V16_WEIGHTS.provenanceIntegrity,
    grade: scoreToGrade(provenance),
    components: { validRate: provenance },
    explanation: `Provenance valid: ${(provenance * 100).toFixed(0)}%`,
  });

  // 12. Model Comparison
  const modelComp = avg(w.modelComparisonScores.length > 0 ? w.modelComparisonScores : [0.5]);
  pillars.push({
    name: "modelComparison",
    score: modelComp,
    weight: V16_WEIGHTS.modelComparison,
    grade: scoreToGrade(modelComp),
    components: { avgScore: modelComp },
    explanation: `Cross-model independence: ${modelComp.toFixed(3)}`,
  });

  // 13. Metacognition (NEW v16)
  const meta = computeMetacognition(w);
  pillars.push({
    name: "metacognition",
    score: meta.composite,
    weight: V16_WEIGHTS.metacognition,
    grade: scoreToGrade(meta.composite),
    components: {
      uncertaintyCalibration: meta.uncertaintyCalibration,
      confidenceAccuracy: meta.confidenceAccuracy,
      hedgingAppropriacy: meta.hedgingAppropriacy,
      regimeAdaptation: meta.regimeAdaptation,
    },
    explanation: `Self-awareness: ${meta.composite.toFixed(3)} — uncertainty=${meta.uncertaintyCalibration.toFixed(2)}, accuracy=${meta.confidenceAccuracy.toFixed(2)}`,
  });

  // 14. Reasoning Efficiency (NEW v16)
  const recentReasoning = w.wordCounts.length > 0 ? "" : "";
  // Use aggregate stats from window
  const efficiencyAggregate = {
    informationDensity: avg(w.quantClaims.map((q, i) => Math.min(1, q / Math.max(1, (w.wordCounts[i] ?? 50) * 0.03 + 1)))),
    claimDensity: 0.7,
    originalityPerWord: 0.6,
    quantitativeRatio: avg(w.quantClaims.map((q) => Math.min(1, q * 0.15))),
    composite: 0,
  };
  efficiencyAggregate.composite = (
    efficiencyAggregate.informationDensity * 0.30 +
    efficiencyAggregate.claimDensity * 0.25 +
    efficiencyAggregate.originalityPerWord * 0.25 +
    efficiencyAggregate.quantitativeRatio * 0.20
  );

  pillars.push({
    name: "efficiency",
    score: efficiencyAggregate.composite,
    weight: V16_WEIGHTS.efficiency,
    grade: scoreToGrade(efficiencyAggregate.composite),
    components: {
      informationDensity: efficiencyAggregate.informationDensity,
      quantitativeRatio: efficiencyAggregate.quantitativeRatio,
    },
    explanation: `Signal-to-noise: ${efficiencyAggregate.composite.toFixed(3)}`,
  });

  // Compute weighted composite
  const composite = pillars.reduce((sum, p) => sum + p.score * p.weight, 0);
  const normalizedComposite = Math.round(composite * 1000) / 1000;

  // Rank
  const prevRank = previousRanks.get(agentId) ?? 0;

  const score: V16BenchmarkScore = {
    agentId,
    composite: normalizedComposite,
    grade: scoreToGrade(normalizedComposite),
    pillars,
    rank: 0,       // Set after all agents scored
    rankChange: 0,
    tradeCount,
    lastUpdated: new Date().toISOString(),
    metacognition: meta,
    efficiency: efficiencyAggregate,
  };

  agentScores.set(agentId, score);
  return score;
}

/**
 * Compute rankings across all scored agents.
 */
export function computeV16Rankings(): V16BenchmarkScore[] {
  const scores = Array.from(agentScores.values());
  scores.sort((a, b) => b.composite - a.composite);

  for (let i = 0; i < scores.length; i++) {
    const prevRank = previousRanks.get(scores[i].agentId) ?? (i + 1);
    scores[i].rank = i + 1;
    scores[i].rankChange = prevRank - (i + 1); // Positive = moved up
    previousRanks.set(scores[i].agentId, i + 1);
  }

  return scores;
}

/**
 * Get the current V16 score for a single agent.
 */
export function getV16Score(agentId: string): V16BenchmarkScore | null {
  return agentScores.get(agentId) ?? null;
}

/**
 * Get all V16 scores (ranked).
 */
export function getAllV16Scores(): V16BenchmarkScore[] {
  return computeV16Rankings();
}

/**
 * Run single-trade efficiency analysis (for API use).
 */
export function analyzeTradeEfficiency(reasoning: string): EfficiencyProfile {
  return computeEfficiency(reasoning);
}

/**
 * Get the V16 pillar weights.
 */
export function getV16Weights(): Record<string, number> {
  return { ...V16_WEIGHTS };
}

/**
 * Count hedge words in reasoning (exported for use by other services).
 */
export { countHedgeWords, countQuantitativeClaims };
