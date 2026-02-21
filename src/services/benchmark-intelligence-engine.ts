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

import { computeStdDev, countByCondition, countWords, mean, round3, splitSentences, weightedSumByKey } from "../lib/math-utils.ts";

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

/**
 * Metric Window Size
 *
 * Maximum number of trades retained per agent in the scoring window.
 * Older entries are evicted when the window is full (FIFO).
 *
 * 200 trades chosen as the retention limit:
 * - Enough history to compute stable rolling averages (≥30 for CLT convergence)
 * - Recent enough to reflect current agent behaviour (not stale strategies)
 * - Bounded memory: 200 entries × ~15 arrays × 8 bytes ≈ 24 KB per agent
 *
 * Example: After 201st trade, the oldest entry is dropped from each metric array.
 */
const WINDOW_SIZE = 200;

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Grade Boundaries (A+ through F)
 *
 * These thresholds determine letter grades for composite scores and individual pillars.
 * Lower bounds are inclusive (score >= threshold).
 */
const GRADE_THRESHOLD_A_PLUS = 0.95;    // 95%+ = A+ (exceptional excellence)
const GRADE_THRESHOLD_A = 0.90;         // 90-95% = A (excellent)
const GRADE_THRESHOLD_A_MINUS = 0.85;   // 85-90% = A- (very good)
const GRADE_THRESHOLD_B_PLUS = 0.80;    // 80-85% = B+ (good)
const GRADE_THRESHOLD_B = 0.75;         // 75-80% = B (above average)
const GRADE_THRESHOLD_B_MINUS = 0.70;   // 70-75% = B- (slightly above average)
const GRADE_THRESHOLD_C_PLUS = 0.65;    // 65-70% = C+ (average)
const GRADE_THRESHOLD_C = 0.60;         // 60-65% = C (acceptable)
const GRADE_THRESHOLD_C_MINUS = 0.55;   // 55-60% = C- (below average)
const GRADE_THRESHOLD_D_PLUS = 0.50;    // 50-55% = D+ (poor)
const GRADE_THRESHOLD_D = 0.45;         // 45-50% = D (very poor)
const GRADE_THRESHOLD_D_MINUS = 0.40;   // 40-45% = D- (failing)
// Below 40% = F (unacceptable)

/**
 * Metacognition Scoring Parameters
 *
 * Controls how agent self-awareness and confidence calibration are measured.
 */
const META_MIN_SAMPLES = 5;                     // Minimum samples for metacognition analysis
const META_RECENT_WINDOW = 20;                  // Look at last 20 trades for recent calibration
const META_RECENT_MIN_SAMPLES = 3;              // Minimum samples in recent window
const META_HEDGE_HIGH_THRESHOLD = 2;            // >2 hedge words = high uncertainty expression
const META_HEDGE_LOW_THRESHOLD = 1;             // ≤1 hedge words = low uncertainty expression
const META_CONFIDENCE_LOW_THRESHOLD = 0.6;      // <60% confidence = low confidence
const META_CONFIDENCE_HIGH_THRESHOLD = 0.7;     // ≥70% confidence = high confidence
const META_CALIBRATION_BASE_SCORE = 0.5;        // Baseline score when insufficient data
const META_CALIBRATION_BOOST = 0.2;             // Score boost when well-calibrated
const META_COHERENCE_AMBIGUOUS_THRESHOLD = 0.5; // <50% coherence = ambiguous reasoning
const META_COHERENCE_CLEAR_THRESHOLD = 0.7;     // >70% coherence = clear reasoning
const META_REGIME_ADAPTATION_MIN_SAMPLES = 10;  // Minimum regime actions for adaptation analysis
const META_REGIME_ADAPTATION_MIN_REGIMES = 2;   // Minimum distinct regimes to analyze
const META_REGIME_ADAPTATION_BOOST = 0.3;       // Score boost for diverse regime behavior

/**
 * Metacognition Composite Weights
 *
 * How much each dimension contributes to overall metacognition score.
 */
const META_WEIGHT_UNCERTAINTY = 0.30;   // 30% - uncertainty calibration
const META_WEIGHT_CONFIDENCE = 0.30;    // 30% - confidence accuracy
const META_WEIGHT_HEDGING = 0.20;       // 20% - hedging appropriacy
const META_WEIGHT_REGIME = 0.20;        // 20% - regime adaptation

/**
 * Reasoning Efficiency Scoring Parameters
 *
 * Controls signal-to-noise ratio measurement in reasoning text.
 */
const EFFICIENCY_INFO_DENSITY_SCALING = 0.03;   // Analytical hits / (wordCount * 0.03 + 1)
const EFFICIENCY_QUANT_RATIO_SCALING = 0.5;     // Quant claims / sentences * 0.5

/**
 * Reasoning Efficiency Composite Weights
 *
 * How much each dimension contributes to overall efficiency score.
 */
const EFFICIENCY_WEIGHT_INFO_DENSITY = 0.30;    // 30% - analytical patterns per word
const EFFICIENCY_WEIGHT_CLAIM_DENSITY = 0.25;   // 25% - filler ratio (inverted)
const EFFICIENCY_WEIGHT_ORIGINALITY = 0.25;     // 25% - unique bigrams / total bigrams
const EFFICIENCY_WEIGHT_QUANT_RATIO = 0.20;     // 20% - quantitative claims ratio

/**
 * Financial Outcome Scoring
 *
 * Win = 0.7, Loss = 0.3 (proxy until actual P&L integrated).
 */
const FINANCIAL_WIN_SCORE = 0.7;    // Score assigned to winning trades
const FINANCIAL_LOSS_SCORE = 0.3;   // Score assigned to losing trades

/**
 * Calibration Scoring Parameters
 *
 * Measures consistency of confidence levels across trades.
 */
const CALIBRATION_STDDEV_MULTIPLIER = 2;    // Multiplier for confidence stddev penalty

/**
 * Adaptability Scoring Parameters
 *
 * Measures diversity of trading intents (buy/sell/hold/trim).
 */
const ADAPTABILITY_INTENT_DIVERSITY_DIVISOR = 4;    // Divide intent count by 4
const ADAPTABILITY_INTENT_DIVERSITY_MULTIPLIER = 0.5; // Multiply result by 0.5
const ADAPTABILITY_BASE_SCORE = 0.3;                // Add 0.3 baseline

/**
 * Default Scores for Missing Data
 *
 * When insufficient data exists, use these fallback scores.
 */
const DEFAULT_SCORE_MISSING_DATA = 0.5; // 50% when no data available

/**
 * Sentiment Proxy Calculation
 *
 * Converts coherence (0-1) to sentiment (-1 to +1).
 */
const SENTIMENT_COHERENCE_MULTIPLIER = 2;   // coherence * 2 - 1
const SENTIMENT_COHERENCE_OFFSET = 1;       // Subtract 1 to center at 0

/**
 * Efficiency Aggregate Fallback Values
 *
 * Used when computing efficiency from aggregate window stats.
 */
const EFFICIENCY_AGGREGATE_CLAIM_DENSITY_DEFAULT = 0.7;     // Default claim density
const EFFICIENCY_AGGREGATE_ORIGINALITY_DEFAULT = 0.6;       // Default originality per word
const EFFICIENCY_AGGREGATE_QUANT_SCALING = 0.15;            // Quant claims * 0.15
const EFFICIENCY_AGGREGATE_WORD_COUNT_FALLBACK = 50;        // Default word count when missing

/**
 * Formatting Precision Constants
 *
 * Control decimal precision for pillar explanation strings shown in benchmark UI.
 * These affect how scores are displayed in the leaderboard and agent profile pages.
 *
 * Examples:
 * - PERCENT_PRECISION = 0 → "85%" (win rate, safety percentages)
 * - SCORE_PRECISION_HIGH = 3 → "0.842" (coherence, depth, forensic scores)
 * - SCORE_PRECISION_MEDIUM = 2 → "0.84" (uncertainty calibration, confidence accuracy)
 */
const FORMATTING_PRECISION_PERCENT = 0;        // Percentage display (85%, no decimals)
const FORMATTING_PRECISION_SCORE_HIGH = 3;     // High-precision score display (0.842)
const FORMATTING_PRECISION_SCORE_MEDIUM = 2;   // Medium-precision score display (0.84)

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

// REMOVED: Duplicate stddev function - using computeStdDev from math-utils.ts instead
// Original implementation used population stddev (divide by n), but computeStdDev defaults to sample (n-1)
// For this use case (confidence/sentiment calibration), population stddev is appropriate

function boolRate(arr: boolean[]): number {
  return arr.length > 0 ? countByCondition(arr, Boolean) / arr.length : 0.5;
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
  let uncertaintyCalibration = META_CALIBRATION_BASE_SCORE;
  if (w.hedgeWords.length >= META_MIN_SAMPLES && w.confidence.length >= META_MIN_SAMPLES) {
    // If hedge words are higher when confidence is lower = well-calibrated
    const recentHedge = w.hedgeWords.slice(-META_RECENT_WINDOW);
    const recentConf = w.confidence.slice(-META_RECENT_WINDOW);
    const len = Math.min(recentHedge.length, recentConf.length);
    if (len >= META_RECENT_MIN_SAMPLES) {
      let negCorrelation = 0;
      for (let i = 0; i < len; i++) {
        if ((recentHedge[i] > META_HEDGE_HIGH_THRESHOLD && recentConf[i] < META_CONFIDENCE_LOW_THRESHOLD) ||
            (recentHedge[i] <= META_HEDGE_LOW_THRESHOLD && recentConf[i] > META_CONFIDENCE_HIGH_THRESHOLD)) {
          negCorrelation++;
        }
      }
      uncertaintyCalibration = Math.min(1, negCorrelation / len + META_CALIBRATION_BOOST);
    }
  }

  // 2. Confidence accuracy: high confidence should predict good outcomes
  let confidenceAccuracy = META_CALIBRATION_BASE_SCORE;
  if (w.confidence.length >= META_MIN_SAMPLES && w.outcomes.length >= META_MIN_SAMPLES) {
    const len = Math.min(w.confidence.length, w.outcomes.length);
    let correct = 0;
    for (let i = w.confidence.length - len; i < w.confidence.length; i++) {
      const outIdx = i - (w.confidence.length - w.outcomes.length);
      if (outIdx < 0 || outIdx >= w.outcomes.length) continue;
      const highConf = w.confidence[i] >= META_CONFIDENCE_HIGH_THRESHOLD;
      const success = w.outcomes[outIdx];
      if ((highConf && success) || (!highConf && !success)) correct++;
    }
    confidenceAccuracy = correct / len;
  }

  // 3. Hedging appropriacy: hedge more when coherence is ambiguous
  let hedgingAppropriacy = META_CALIBRATION_BASE_SCORE;
  if (w.hedgeWords.length >= META_MIN_SAMPLES && w.coherence.length >= META_MIN_SAMPLES) {
    const len = Math.min(w.hedgeWords.length, w.coherence.length);
    let appropriate = 0;
    for (let i = 0; i < len; i++) {
      const hIdx = w.hedgeWords.length - len + i;
      const cIdx = w.coherence.length - len + i;
      // Low coherence + high hedging = appropriate
      if (w.coherence[cIdx] < META_COHERENCE_AMBIGUOUS_THRESHOLD && w.hedgeWords[hIdx] >= META_HEDGE_HIGH_THRESHOLD) appropriate++;
      // High coherence + low hedging = also appropriate (confident when clear)
      if (w.coherence[cIdx] > META_COHERENCE_CLEAR_THRESHOLD && w.hedgeWords[hIdx] <= META_HEDGE_LOW_THRESHOLD) appropriate++;
    }
    hedgingAppropriacy = appropriate / len;
  }

  // 4. Regime adaptation: does agent change behavior in different regimes?
  let regimeAdaptation = META_CALIBRATION_BASE_SCORE;
  if (w.regimeActions.length >= META_REGIME_ADAPTATION_MIN_SAMPLES) {
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
    if (regimeCount >= META_REGIME_ADAPTATION_MIN_REGIMES) {
      const actionDiversity = Array.from(regimeMap.values()).reduce((sum, rd) => {
        const uniqueActions = new Set(rd.actions).size;
        return sum + uniqueActions / Math.max(1, rd.actions.length);
      }, 0) / regimeCount;
      regimeAdaptation = Math.min(1, actionDiversity + META_REGIME_ADAPTATION_BOOST);
    }
  }

  const composite = (
    uncertaintyCalibration * META_WEIGHT_UNCERTAINTY +
    confidenceAccuracy * META_WEIGHT_CONFIDENCE +
    hedgingAppropriacy * META_WEIGHT_HEDGING +
    regimeAdaptation * META_WEIGHT_REGIME
  );

  return {
    uncertaintyCalibration: round3(uncertaintyCalibration),
    confidenceAccuracy: round3(confidenceAccuracy),
    hedgingAppropriacy: round3(hedgingAppropriacy),
    regimeAdaptation: round3(regimeAdaptation),
    composite: round3(composite),
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
  const informationDensity = Math.min(1, analyticalHits / (wordCount * EFFICIENCY_INFO_DENSITY_SCALING + 1));

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
  const quantitativeRatio = Math.min(1, quantClaims / Math.max(1, sentences) * EFFICIENCY_QUANT_RATIO_SCALING);

  const composite = (
    informationDensity * EFFICIENCY_WEIGHT_INFO_DENSITY +
    claimDensity * EFFICIENCY_WEIGHT_CLAIM_DENSITY +
    originalityPerWord * EFFICIENCY_WEIGHT_ORIGINALITY +
    quantitativeRatio * EFFICIENCY_WEIGHT_QUANT_RATIO
  );

  return {
    informationDensity: round3(informationDensity),
    claimDensity: round3(claimDensity),
    originalityPerWord: round3(originalityPerWord),
    quantitativeRatio: round3(quantitativeRatio),
    composite: round3(composite),
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
      success: metrics.outcome ?? (metrics.coherence > META_COHERENCE_AMBIGUOUS_THRESHOLD),
    });
  }

  // Compute sentiment proxy from coherence signals
  pushCapped(w.sentimentScores, metrics.coherence * SENTIMENT_COHERENCE_MULTIPLIER - SENTIMENT_COHERENCE_OFFSET);
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
  const financial = mean(w.outcomes.map((o) => o ? FINANCIAL_WIN_SCORE : FINANCIAL_LOSS_SCORE));
  pillars.push({
    name: "financial",
    score: financial,
    weight: V16_WEIGHTS.financial,
    grade: scoreToGrade(financial),
    components: { winRate: boolRate(w.outcomes) },
    explanation: `Win rate: ${(boolRate(w.outcomes) * 100).toFixed(FORMATTING_PRECISION_PERCENT)}%`,
  });

  // 2. Reasoning
  const reasoning = mean(w.coherence);
  pillars.push({
    name: "reasoning",
    score: reasoning,
    weight: V16_WEIGHTS.reasoning,
    grade: scoreToGrade(reasoning),
    components: { avgCoherence: mean(w.coherence), depthAvg: mean(w.depths) },
    explanation: `Avg coherence: ${mean(w.coherence).toFixed(FORMATTING_PRECISION_SCORE_HIGH)}`,
  });

  // 3. Safety
  const safety = mean(w.hallucinationFree);
  pillars.push({
    name: "safety",
    score: safety,
    weight: V16_WEIGHTS.safety,
    grade: scoreToGrade(safety),
    components: { hallucinationFreeRate: mean(w.hallucinationFree), disciplineRate: mean(w.discipline) },
    explanation: `Hallucination-free: ${(mean(w.hallucinationFree) * 100).toFixed(FORMATTING_PRECISION_PERCENT)}%, Discipline: ${(mean(w.discipline) * 100).toFixed(FORMATTING_PRECISION_PERCENT)}%`,
  });

  // 4. Calibration
  const confStd = computeStdDev(w.confidence, true);  // Population stddev for calibration scoring
  const calibration = Math.max(0, 1 - confStd * CALIBRATION_STDDEV_MULTIPLIER);
  pillars.push({
    name: "calibration",
    score: calibration,
    weight: V16_WEIGHTS.calibration,
    grade: scoreToGrade(calibration),
    components: { confidenceStdDev: confStd, avgConfidence: mean(w.confidence) },
    explanation: `Confidence variance: ${confStd.toFixed(FORMATTING_PRECISION_SCORE_HIGH)}`,
  });

  // 5. Patterns
  const patterns = mean(w.depths.length > 0 ? w.depths : [DEFAULT_SCORE_MISSING_DATA]);
  pillars.push({
    name: "patterns",
    score: patterns,
    weight: V16_WEIGHTS.patterns,
    grade: scoreToGrade(patterns),
    components: { depthAvg: mean(w.depths) },
    explanation: `Avg depth score: ${patterns.toFixed(FORMATTING_PRECISION_SCORE_HIGH)}`,
  });

  // 6. Adaptability
  const intentSet = new Set(w.intents);
  const adaptability = Math.min(1, intentSet.size / ADAPTABILITY_INTENT_DIVERSITY_DIVISOR * ADAPTABILITY_INTENT_DIVERSITY_MULTIPLIER + ADAPTABILITY_BASE_SCORE);
  pillars.push({
    name: "adaptability",
    score: adaptability,
    weight: V16_WEIGHTS.adaptability,
    grade: scoreToGrade(adaptability),
    components: { intentDiversity: intentSet.size },
    explanation: `${intentSet.size} distinct intents used`,
  });

  // 7. Forensic Quality
  const forensic = mean(w.forensicScores.length > 0 ? w.forensicScores : [DEFAULT_SCORE_MISSING_DATA]);
  pillars.push({
    name: "forensicQuality",
    score: forensic,
    weight: V16_WEIGHTS.forensicQuality,
    grade: scoreToGrade(forensic),
    components: { avgForensic: forensic },
    explanation: `Avg forensic: ${forensic.toFixed(FORMATTING_PRECISION_SCORE_HIGH)}`,
  });

  // 8. Validation Quality
  const validation = mean(w.validationScores.length > 0 ? w.validationScores : [DEFAULT_SCORE_MISSING_DATA]);
  pillars.push({
    name: "validationQuality",
    score: validation,
    weight: V16_WEIGHTS.validationQuality,
    grade: scoreToGrade(validation),
    components: { avgValidation: validation },
    explanation: `Avg validation: ${validation.toFixed(FORMATTING_PRECISION_SCORE_HIGH)}`,
  });

  // 9. Prediction Accuracy
  const prediction = boolRate(w.predictionCorrect);
  pillars.push({
    name: "predictionAccuracy",
    score: prediction,
    weight: V16_WEIGHTS.predictionAccuracy,
    grade: scoreToGrade(prediction),
    components: { accuracy: prediction },
    explanation: `Prediction correct: ${(prediction * 100).toFixed(FORMATTING_PRECISION_PERCENT)}%`,
  });

  // 10. Reasoning Stability
  const sentStd = computeStdDev(w.sentimentScores, true);  // Population stddev for sentiment volatility scoring
  const stability = Math.max(0, 1 - sentStd);
  pillars.push({
    name: "reasoningStability",
    score: stability,
    weight: V16_WEIGHTS.reasoningStability,
    grade: scoreToGrade(stability),
    components: { sentimentStdDev: sentStd },
    explanation: `Sentiment volatility: ${sentStd.toFixed(FORMATTING_PRECISION_SCORE_HIGH)}`,
  });

  // 11. Provenance Integrity
  const provenance = boolRate(w.provenanceValid);
  pillars.push({
    name: "provenanceIntegrity",
    score: provenance,
    weight: V16_WEIGHTS.provenanceIntegrity,
    grade: scoreToGrade(provenance),
    components: { validRate: provenance },
    explanation: `Provenance valid: ${(provenance * 100).toFixed(FORMATTING_PRECISION_PERCENT)}%`,
  });

  // 12. Model Comparison
  const modelComp = mean(w.modelComparisonScores.length > 0 ? w.modelComparisonScores : [DEFAULT_SCORE_MISSING_DATA]);
  pillars.push({
    name: "modelComparison",
    score: modelComp,
    weight: V16_WEIGHTS.modelComparison,
    grade: scoreToGrade(modelComp),
    components: { avgScore: modelComp },
    explanation: `Cross-model independence: ${modelComp.toFixed(FORMATTING_PRECISION_SCORE_HIGH)}`,
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
    explanation: `Self-awareness: ${meta.composite.toFixed(FORMATTING_PRECISION_SCORE_HIGH)} — uncertainty=${meta.uncertaintyCalibration.toFixed(FORMATTING_PRECISION_SCORE_MEDIUM)}, accuracy=${meta.confidenceAccuracy.toFixed(FORMATTING_PRECISION_SCORE_MEDIUM)}`,
  });

  // 14. Reasoning Efficiency (NEW v16)
  // Use aggregate stats from window
  const efficiencyAggregate = {
    informationDensity: mean(w.quantClaims.map((q, i) => Math.min(1, q / Math.max(1, (w.wordCounts[i] ?? EFFICIENCY_AGGREGATE_WORD_COUNT_FALLBACK) * EFFICIENCY_INFO_DENSITY_SCALING + 1)))),
    claimDensity: EFFICIENCY_AGGREGATE_CLAIM_DENSITY_DEFAULT,
    originalityPerWord: EFFICIENCY_AGGREGATE_ORIGINALITY_DEFAULT,
    quantitativeRatio: mean(w.quantClaims.map((q) => Math.min(1, q * EFFICIENCY_AGGREGATE_QUANT_SCALING))),
    composite: 0,
  };
  efficiencyAggregate.composite = (
    efficiencyAggregate.informationDensity * EFFICIENCY_WEIGHT_INFO_DENSITY +
    efficiencyAggregate.claimDensity * EFFICIENCY_WEIGHT_CLAIM_DENSITY +
    efficiencyAggregate.originalityPerWord * EFFICIENCY_WEIGHT_ORIGINALITY +
    efficiencyAggregate.quantitativeRatio * EFFICIENCY_WEIGHT_QUANT_RATIO
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
    explanation: `Signal-to-noise: ${efficiencyAggregate.composite.toFixed(FORMATTING_PRECISION_SCORE_HIGH)}`,
  });

  // Compute weighted composite
  const composite = weightedSumByKey(pillars, 'score', 'weight');
  const normalizedComposite = round3(composite);

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
