/**
 * Benchmark Reproducibility Engine
 *
 * For MoltApp to be a credible academic-grade benchmark, results must be
 * REPRODUCIBLE and STATISTICALLY SIGNIFICANT. This engine provides:
 *
 * 1. DETERMINISTIC REPLAY: Given the same market data and agent state,
 *    the benchmark scores should be the same. We hash all inputs to verify.
 *
 * 2. STATISTICAL SIGNIFICANCE: When comparing agents, we compute p-values
 *    and confidence intervals to determine if differences are real or noise.
 *
 * 3. BOOTSTRAP CONFIDENCE INTERVALS: For small sample sizes, we use
 *    bootstrap resampling to estimate score distributions.
 *
 * 4. EFFECT SIZE CALCULATION: Not just "is A better than B?" but "by how much?"
 *    using Cohen's d for standardized effect sizes.
 *
 * 5. BENCHMARK STABILITY: Track whether benchmark scores are stable over time
 *    or if the benchmark itself is noisy/unreliable.
 */

import { createHash } from "node:crypto";
import { round3, computeVariance, countByCondition } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Composite Score Calculation Weights
 *
 * These weights control how different dimensions contribute to the overall
 * benchmark composite score. Total sums to 1.0 (100%).
 *
 * Rationale:
 * - Coherence (35%): HIGHEST weight — logical consistency is primary indicator of quality
 * - Data Reference (20%): Must reference actual market data to be credible
 * - Hallucination-Free (20%): Critical to avoid fabricated data
 * - Structural (15%): Nice-to-have but not essential for quality
 * - Confidence (10%): Calibration matters but is secondary to reasoning quality
 * - Placeholder (10%): Reserved for future dimension (e.g., originality)
 */
const COMPOSITE_WEIGHT_COHERENCE = 0.25;
const COMPOSITE_WEIGHT_DEPTH = 0.20;
const COMPOSITE_WEIGHT_HALLUCINATION_FREE = 0.20;
const COMPOSITE_WEIGHT_DISCIPLINE = 0.15;
const COMPOSITE_WEIGHT_CONFIDENCE = 0.10;
const COMPOSITE_WEIGHT_PLACEHOLDER = 0.10;

/**
 * Effect Size Interpretation Thresholds (Cohen's d)
 *
 * These thresholds classify the magnitude of differences between agents:
 * - < 0.2: Negligible (differences too small to matter)
 * - 0.2-0.5: Small (noticeable but modest difference)
 * - 0.5-0.8: Medium (substantial practical difference)
 * - > 0.8: Large (very meaningful difference in performance)
 *
 * Based on Cohen (1988) conventional effect size standards for behavioral sciences.
 */
const EFFECT_SIZE_THRESHOLD_SMALL = 0.2;
const EFFECT_SIZE_THRESHOLD_MEDIUM = 0.5;
const EFFECT_SIZE_THRESHOLD_LARGE = 0.8;

/**
 * Statistical Significance Threshold (Alpha Level)
 *
 * P-value threshold for statistical significance testing.
 * - Standard alpha = 0.05 (95% confidence level)
 * - If p-value < 0.05, we reject null hypothesis (difference is significant)
 * - If p-value >= 0.05, insufficient evidence to claim real difference
 *
 * This is the conventional threshold in academic research for hypothesis testing.
 */
const STATISTICAL_SIGNIFICANCE_ALPHA = 0.05;

/**
 * P-Value Bounds
 *
 * - MIN_P_VALUE: Lower bound to prevent division by zero and numerical instability
 *   (p-values can't be exactly 0 due to finite sample sizes)
 * - MAX_P_VALUE: Upper bound is always 1.0 (100% probability)
 */
const MIN_P_VALUE = 0.0001;
const MAX_P_VALUE = 1;

/**
 * Bootstrap Confidence Interval Percentiles
 *
 * Percentile thresholds for constructing confidence intervals from bootstrap distributions:
 * - 95% CI: [2.5th percentile, 97.5th percentile]
 * - 99% CI: [0.5th percentile, 99.5th percentile]
 */
const BOOTSTRAP_CI95_LOWER_PERCENTILE = 0.025;
const BOOTSTRAP_CI95_UPPER_PERCENTILE = 0.975;
const BOOTSTRAP_CI99_LOWER_PERCENTILE = 0.005;
const BOOTSTRAP_CI99_UPPER_PERCENTILE = 0.995;

/**
 * Benchmark Stability Thresholds
 *
 * - STABILITY_VARIANCE_THRESHOLD: Rolling window variance < 0.01 = stable agent
 *   (composite score varies < 1% over 10-round window)
 * - STABILITY_PUBLICATION_THRESHOLD: Overall stability >= 0.8 = publication-ready
 *   (80%+ of agents show stable scores)
 * - MIN_ROUNDS_PER_AGENT: Empirically determined minimum for stable rankings
 *   (20 rounds gives sufficient data for statistical confidence)
 */
const STABILITY_VARIANCE_THRESHOLD = 0.01;
const STABILITY_PUBLICATION_THRESHOLD = 0.8;
const MIN_ROUNDS_PER_AGENT = 20;

/**
 * T-Distribution Critical Values for 95% Confidence Intervals
 *
 * These approximate the t-distribution critical values for different degrees of freedom.
 * Used for constructing confidence intervals in Welch's t-test.
 *
 * As df increases, t-distribution converges to normal (z = 1.96).
 */
const T_CRITICAL_DF_120_PLUS = 1.96;
const T_CRITICAL_DF_60 = 2.0;
const T_CRITICAL_DF_30 = 2.042;
const T_CRITICAL_DF_20 = 2.086;
const T_CRITICAL_DF_10 = 2.228;
const T_CRITICAL_DF_5 = 2.571;
const T_CRITICAL_DEFAULT = 2.776;

/**
 * Normal Distribution Approximation Threshold
 *
 * For df > 30, the t-distribution is well-approximated by the normal distribution.
 * Below this threshold, we use the exact incomplete beta function calculation.
 */
const NORMAL_APPROXIMATION_DF_THRESHOLD = 30;

/**
 * Rolling Window Size for Stability Analysis
 *
 * Maximum window size for computing rolling variance of agent scores.
 * Smaller of this value or available sample size is used.
 */
const STABILITY_ROLLING_WINDOW_SIZE = 10;

/**
 * Minimum Sample Size for Statistical Tests
 *
 * Welch's t-test requires at least 2 samples per group to compute variance.
 * Below this, tests return null results (no statistical power).
 */
const MIN_SAMPLE_SIZE_FOR_TEST = 2;

/**
 * Minimum Sample Size for Stability Assessment
 *
 * Need at least 3 scores to compute meaningful variance estimates.
 */
const MIN_SAMPLE_SIZE_FOR_STABILITY = 3;

/**
 * Reproducibility Proof Hash Truncation Length
 *
 * Number of hex characters to keep from the full SHA-256 digest when
 * constructing input/output hashes for reproducibility proofs.
 *
 * 16 hex characters = 64 bits of entropy → ~1.8 × 10^19 unique proof IDs.
 * This is sufficient for collision-free identification while keeping IDs
 * compact enough to embed in API responses, URLs, and log messages.
 *
 * Rationale for 16 (not shorter):
 * - 8 chars (32 bits) → birthday collision at ~65K proofs (too risky)
 * - 16 chars (64 bits) → birthday collision at ~4 billion proofs (safe)
 * - 32 chars (128 bits) → unnecessarily long for human-readable IDs
 *
 * To increase entropy (e.g. for archival/academic datasets), change to 20
 * or 32. Both inputHash and outputHash in reproduceProof() + verifyProof()
 * must use the same length for proof verification to succeed.
 */
const HASH_TRUNCATION_LENGTH = 16;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StatisticalTest {
  /** Test name (e.g., "Welch's t-test") */
  testName: string;
  /** Computed test statistic */
  statistic: number;
  /** P-value (probability this difference occurred by chance) */
  pValue: number;
  /** Is the difference statistically significant at alpha=0.05? */
  significant: boolean;
  /** Effect size (Cohen's d) */
  effectSize: number;
  /** Effect size interpretation */
  effectInterpretation: "negligible" | "small" | "medium" | "large";
  /** 95% confidence interval for the difference */
  confidenceInterval: [number, number];
  /** Sample sizes */
  sampleSizes: [number, number];
}

export interface BootstrapResult {
  /** Original sample mean */
  mean: number;
  /** Bootstrap standard error */
  standardError: number;
  /** 95% confidence interval */
  ci95: [number, number];
  /** 99% confidence interval */
  ci99: [number, number];
  /** Number of bootstrap iterations */
  iterations: number;
  /** Sample size */
  sampleSize: number;
}

export interface AgentComparison {
  agentA: string;
  agentB: string;
  /** Statistical test results for each metric */
  tests: {
    coherence: StatisticalTest;
    depth: StatisticalTest;
    hallucinationRate: StatisticalTest;
    overallComposite: StatisticalTest;
  };
  /** Which agent is better (with confidence) */
  verdict: {
    winner: string | null; // null if no significant difference
    metric: string;
    confidence: number;
    margin: number;
  };
}

export interface BenchmarkStability {
  /** How stable are benchmark scores over time? */
  overallStability: number; // 0-1
  /** Per-agent stability */
  agentStability: Array<{
    agentId: string;
    scoreVariance: number;
    isStable: boolean;
    windowSize: number;
  }>;
  /** Is the benchmark reliable enough for publication? */
  publicationReady: boolean;
  /** Minimum rounds needed for stable rankings */
  minimumRoundsNeeded: number;
  /** Current rounds available */
  currentRounds: number;
}

export interface ReproducibilityProof {
  /** Hash of all inputs that produced this score */
  inputHash: string;
  /** Hash of the scoring computation */
  outputHash: string;
  /** Timestamp of computation */
  computedAt: string;
  /** Methodology version */
  methodologyVersion: string;
  /** Can be independently verified */
  verifiable: boolean;
  /** Inputs summary */
  inputSummary: {
    agentId: string;
    tradeCount: number;
    roundCount: number;
    dateRange: [string, string];
  };
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface ScoreEntry {
  agentId: string;
  roundId: string;
  coherence: number;
  depth: number;
  hallucinationRate: number;
  discipline: number;
  confidence: number;
  composite: number;
  timestamp: string;
}

const scoreHistory: ScoreEntry[] = [];
const MAX_HISTORY = 5000;
const proofs: Map<string, ReproducibilityProof> = new Map();

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

/**
 * Record a benchmark score for reproducibility tracking.
 */
export function recordBenchmarkScore(
  agentId: string,
  roundId: string,
  scores: {
    coherence: number;
    depth: number;
    hallucinationRate: number;
    discipline: number;
    confidence: number;
  },
): void {
  const halFree = 1 - scores.hallucinationRate;
  const composite = Math.round(
    (scores.coherence * COMPOSITE_WEIGHT_COHERENCE +
     scores.depth * COMPOSITE_WEIGHT_DEPTH +
     halFree * COMPOSITE_WEIGHT_HALLUCINATION_FREE +
     scores.discipline * COMPOSITE_WEIGHT_DISCIPLINE +
     scores.confidence * COMPOSITE_WEIGHT_CONFIDENCE +
     0.5 * COMPOSITE_WEIGHT_PLACEHOLDER) * 100,
  ) / 100;

  scoreHistory.unshift({
    agentId,
    roundId,
    ...scores,
    composite,
    timestamp: new Date().toISOString(),
  });

  if (scoreHistory.length > MAX_HISTORY) {
    scoreHistory.length = MAX_HISTORY;
  }
}

// ---------------------------------------------------------------------------
// Statistical Tests
// ---------------------------------------------------------------------------

/**
 * Welch's t-test for comparing two agents' scores.
 * Unlike Student's t-test, Welch's doesn't assume equal variances.
 */
export function welchTTest(
  samplesA: number[],
  samplesB: number[],
): StatisticalTest {
  const nA = samplesA.length;
  const nB = samplesB.length;

  if (nA < MIN_SAMPLE_SIZE_FOR_TEST || nB < MIN_SAMPLE_SIZE_FOR_TEST) {
    return {
      testName: "Welch's t-test",
      statistic: 0,
      pValue: 1,
      significant: false,
      effectSize: 0,
      effectInterpretation: "negligible",
      confidenceInterval: [0, 0],
      sampleSizes: [nA, nB],
    };
  }

  const meanA = samplesA.reduce((s, v) => s + v, 0) / nA;
  const meanB = samplesB.reduce((s, v) => s + v, 0) / nB;

  const varA = computeVariance(samplesA);
  const varB = computeVariance(samplesB);

  const seA = varA / nA;
  const seB = varB / nB;
  const se = Math.sqrt(seA + seB);

  if (se === 0) {
    return {
      testName: "Welch's t-test",
      statistic: 0,
      pValue: 1,
      significant: false,
      effectSize: 0,
      effectInterpretation: "negligible",
      confidenceInterval: [0, 0],
      sampleSizes: [nA, nB],
    };
  }

  const t = (meanA - meanB) / se;

  // Welch-Satterthwaite degrees of freedom
  const df = (seA + seB) ** 2 /
    ((seA ** 2) / (nA - 1) + (seB ** 2) / (nB - 1));

  // Approximate p-value using normal distribution for large df
  const pValue = approximatePValue(Math.abs(t), df);

  // Cohen's d effect size
  const pooledSd = Math.sqrt(
    ((nA - 1) * varA + (nB - 1) * varB) / (nA + nB - 2),
  );
  const effectSize = pooledSd > 0 ? Math.abs(meanA - meanB) / pooledSd : 0;

  let effectInterpretation: StatisticalTest["effectInterpretation"];
  if (effectSize < EFFECT_SIZE_THRESHOLD_SMALL) effectInterpretation = "negligible";
  else if (effectSize < EFFECT_SIZE_THRESHOLD_MEDIUM) effectInterpretation = "small";
  else if (effectSize < EFFECT_SIZE_THRESHOLD_LARGE) effectInterpretation = "medium";
  else effectInterpretation = "large";

  // 95% confidence interval for the difference
  const tCrit = approximateTCritical(df);
  const ci: [number, number] = [
    round3(meanA - meanB - tCrit * se),
    round3(meanA - meanB + tCrit * se),
  ];

  return {
    testName: "Welch's t-test",
    statistic: round3(t),
    pValue: Math.round(pValue * 10000) / 10000,
    significant: pValue < STATISTICAL_SIGNIFICANCE_ALPHA,
    effectSize: round3(effectSize),
    effectInterpretation,
    confidenceInterval: ci,
    sampleSizes: [nA, nB],
  };
}

/**
 * Approximate p-value from t-statistic using normal approximation.
 * For df > 30 this is quite accurate.
 */
function approximatePValue(t: number, df: number): number {
  // For large df, t distribution approximates normal
  if (df > NORMAL_APPROXIMATION_DF_THRESHOLD) {
    return 2 * normalCDF(-t);
  }
  // For small df, use a rough approximation
  const x = df / (df + t * t);
  const p = incompleteBeta(df / 2, 0.5, x);
  return Math.max(MIN_P_VALUE, Math.min(MAX_P_VALUE, p));
}

/**
 * Approximate t-critical value for 95% CI.
 */
function approximateTCritical(df: number): number {
  if (df >= 120) return T_CRITICAL_DF_120_PLUS;
  if (df >= 60) return T_CRITICAL_DF_60;
  if (df >= 30) return T_CRITICAL_DF_30;
  if (df >= 20) return T_CRITICAL_DF_20;
  if (df >= 10) return T_CRITICAL_DF_10;
  if (df >= 5) return T_CRITICAL_DF_5;
  return T_CRITICAL_DEFAULT;
}

/**
 * Standard normal CDF approximation.
 */
function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.SQRT2;

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}

/**
 * Incomplete beta function approximation (for p-value calculation).
 */
function incompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  // Simple continued fraction approximation
  const maxIter = 100;
  const eps = 1e-8;

  const lnBeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta);

  let f = 1, c = 1, d = 1;
  for (let i = 0; i <= maxIter; i++) {
    let m = Math.floor(i / 2);
    let numerator: number;

    if (i === 0) {
      numerator = 1;
    } else if (i % 2 === 0) {
      numerator = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    } else {
      numerator = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
    }

    d = 1 + numerator * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1 / d;

    c = 1 + numerator / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;

    const cd = c * d;
    f *= cd;

    if (Math.abs(cd - 1) < eps) break;
  }

  return front * (f - 1) / a;
}

function lnGamma(x: number): number {
  // Stirling's approximation
  if (x <= 0) return 0;
  const c = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.001208650973866179, -0.000005395239384953,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (const cj of c) {
    y += 1;
    ser += cj / y;
  }
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

// ---------------------------------------------------------------------------
// Bootstrap Confidence Intervals
// ---------------------------------------------------------------------------

/**
 * Bootstrap resampling for confidence intervals.
 * Essential for small sample sizes where parametric tests may not apply.
 */
export function bootstrapCI(
  samples: number[],
  iterations = 1000,
): BootstrapResult {
  if (samples.length === 0) {
    return {
      mean: 0,
      standardError: 0,
      ci95: [0, 0],
      ci99: [0, 0],
      iterations,
      sampleSize: 0,
    };
  }

  const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
  const bootstrapMeans: number[] = [];

  // Deterministic seed for reproducibility
  let seed = samples.reduce((s, v) => s + Math.round(v * 1000), 42);

  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (let j = 0; j < samples.length; j++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const idx = seed % samples.length;
      sum += samples[idx];
    }
    bootstrapMeans.push(sum / samples.length);
  }

  bootstrapMeans.sort((a, b) => a - b);

  const standardError = Math.sqrt(
    bootstrapMeans.reduce((s, v) => s + (v - mean) ** 2, 0) / iterations,
  );

  const ci95Lower = bootstrapMeans[Math.floor(iterations * BOOTSTRAP_CI95_LOWER_PERCENTILE)];
  const ci95Upper = bootstrapMeans[Math.floor(iterations * BOOTSTRAP_CI95_UPPER_PERCENTILE)];
  const ci99Lower = bootstrapMeans[Math.floor(iterations * BOOTSTRAP_CI99_LOWER_PERCENTILE)];
  const ci99Upper = bootstrapMeans[Math.floor(iterations * BOOTSTRAP_CI99_UPPER_PERCENTILE)];

  return {
    mean: round3(mean),
    standardError: round3(standardError),
    ci95: [round3(ci95Lower), round3(ci95Upper)],
    ci99: [round3(ci99Lower), round3(ci99Upper)],
    iterations,
    sampleSize: samples.length,
  };
}

// ---------------------------------------------------------------------------
// Agent Comparison
// ---------------------------------------------------------------------------

/**
 * Compare two agents with full statistical rigor.
 */
export function compareAgents(agentA: string, agentB: string): AgentComparison {
  const scoresA = scoreHistory.filter((e) => e.agentId === agentA);
  const scoresB = scoreHistory.filter((e) => e.agentId === agentB);

  const tests = {
    coherence: welchTTest(
      scoresA.map((s) => s.coherence),
      scoresB.map((s) => s.coherence),
    ),
    depth: welchTTest(
      scoresA.map((s) => s.depth),
      scoresB.map((s) => s.depth),
    ),
    hallucinationRate: welchTTest(
      scoresA.map((s) => s.hallucinationRate),
      scoresB.map((s) => s.hallucinationRate),
    ),
    overallComposite: welchTTest(
      scoresA.map((s) => s.composite),
      scoresB.map((s) => s.composite),
    ),
  };

  // Determine winner
  let winner: string | null = null;
  let winMetric = "";
  let winConfidence = 0;
  let winMargin = 0;

  if (tests.overallComposite.significant) {
    const meanA = scoresA.length > 0 ? scoresA.reduce((s, v) => s + v.composite, 0) / scoresA.length : 0;
    const meanB = scoresB.length > 0 ? scoresB.reduce((s, v) => s + v.composite, 0) / scoresB.length : 0;
    winner = meanA > meanB ? agentA : agentB;
    winMetric = "overallComposite";
    winConfidence = 1 - tests.overallComposite.pValue;
    winMargin = Math.abs(meanA - meanB);
  }

  return {
    agentA,
    agentB,
    tests,
    verdict: {
      winner,
      metric: winMetric,
      confidence: round3(winConfidence),
      margin: round3(winMargin),
    },
  };
}

/**
 * Compare all agents pairwise.
 */
export function compareAllAgents(): AgentComparison[] {
  const agentIds = [...new Set(scoreHistory.map((e) => e.agentId))];
  const comparisons: AgentComparison[] = [];

  for (let i = 0; i < agentIds.length; i++) {
    for (let j = i + 1; j < agentIds.length; j++) {
      comparisons.push(compareAgents(agentIds[i], agentIds[j]));
    }
  }

  return comparisons;
}

// ---------------------------------------------------------------------------
// Benchmark Stability
// ---------------------------------------------------------------------------

/**
 * Assess whether the benchmark has enough data for stable rankings.
 */
export function assessBenchmarkStability(): BenchmarkStability {
  const agentIds = [...new Set(scoreHistory.map((e) => e.agentId))];
  const roundIds = [...new Set(scoreHistory.map((e) => e.roundId))];

  const agentStability = agentIds.map((agentId) => {
    const scores = scoreHistory
      .filter((e) => e.agentId === agentId)
      .map((e) => e.composite);

    if (scores.length < 3) {
      return {
        agentId,
        scoreVariance: 1,
        isStable: false,
        windowSize: scores.length,
      };
    }

    // Compute rolling window variance
    const windowSize = Math.min(STABILITY_ROLLING_WINDOW_SIZE, scores.length);
    const windows: number[] = [];
    for (let i = 0; i <= scores.length - windowSize; i++) {
      const window = scores.slice(i, i + windowSize);
      const mean = window.reduce((s, v) => s + v, 0) / window.length;
      windows.push(mean);
    }

    const windowVariance = windows.length > 1
      ? windows.reduce((s, v, _, a) => {
          const mean = a.reduce((ss, vv) => ss + vv, 0) / a.length;
          return s + (v - mean) ** 2;
        }, 0) / (windows.length - 1)
      : 0;

    return {
      agentId,
      scoreVariance: Math.round(windowVariance * 10000) / 10000,
      isStable: windowVariance < STABILITY_VARIANCE_THRESHOLD,
      windowSize,
    };
  });

  const stableCount = countByCondition(agentStability, (a) => a.isStable);
  const overallStability = agentIds.length > 0
    ? Math.round((stableCount / agentIds.length) * 100) / 100
    : 0;

  // Minimum rounds needed: empirically, ~20 rounds per agent for stability
  const minimumRoundsNeeded = agentIds.length * MIN_ROUNDS_PER_AGENT;

  return {
    overallStability,
    agentStability,
    publicationReady: overallStability >= 0.8 && roundIds.length >= minimumRoundsNeeded,
    minimumRoundsNeeded,
    currentRounds: roundIds.length,
  };
}

// ---------------------------------------------------------------------------
// Reproducibility Proofs
// ---------------------------------------------------------------------------

/**
 * Generate a reproducibility proof for an agent's benchmark scores.
 */
export function generateReproducibilityProof(agentId: string): ReproducibilityProof {
  const agentScores = scoreHistory.filter((e) => e.agentId === agentId);

  if (agentScores.length === 0) {
    return {
      inputHash: "no_data",
      outputHash: "no_data",
      computedAt: new Date().toISOString(),
      methodologyVersion: "moltapp-v3",
      verifiable: false,
      inputSummary: {
        agentId,
        tradeCount: 0,
        roundCount: 0,
        dateRange: ["", ""],
      },
    };
  }

  // Hash all inputs
  const inputData = agentScores.map((s) => ({
    round: s.roundId,
    c: s.coherence,
    d: s.depth,
    h: s.hallucinationRate,
    disc: s.discipline,
    conf: s.confidence,
  }));
  const inputHash = createHash("sha256")
    .update(JSON.stringify(inputData))
    .digest("hex")
    .slice(0, HASH_TRUNCATION_LENGTH);

  // Hash the output scores
  const outputData = agentScores.map((s) => s.composite);
  const outputHash = createHash("sha256")
    .update(JSON.stringify(outputData))
    .digest("hex")
    .slice(0, HASH_TRUNCATION_LENGTH);

  const roundIds = [...new Set(agentScores.map((s) => s.roundId))];
  const timestamps = agentScores.map((s) => s.timestamp).sort();

  const proof: ReproducibilityProof = {
    inputHash,
    outputHash,
    computedAt: new Date().toISOString(),
    methodologyVersion: "moltapp-v3",
    verifiable: true,
    inputSummary: {
      agentId,
      tradeCount: agentScores.length,
      roundCount: roundIds.length,
      dateRange: [timestamps[0], timestamps[timestamps.length - 1]],
    },
  };

  proofs.set(`${agentId}_${inputHash}`, proof);
  return proof;
}

/**
 * Verify a reproducibility proof.
 */
export function verifyProof(agentId: string, inputHash: string): {
  verified: boolean;
  proof: ReproducibilityProof | null;
  message: string;
} {
  const key = `${agentId}_${inputHash}`;
  const proof = proofs.get(key);

  if (!proof) {
    return {
      verified: false,
      proof: null,
      message: `No proof found for agent ${agentId} with hash ${inputHash}`,
    };
  }

  // Re-compute and verify
  const agentScores = scoreHistory.filter((e) => e.agentId === agentId);
  const inputData = agentScores.map((s) => ({
    round: s.roundId,
    c: s.coherence,
    d: s.depth,
    h: s.hallucinationRate,
    disc: s.discipline,
    conf: s.confidence,
  }));
  const recomputedHash = createHash("sha256")
    .update(JSON.stringify(inputData))
    .digest("hex")
    .slice(0, HASH_TRUNCATION_LENGTH);

  const verified = recomputedHash === inputHash;

  return {
    verified,
    proof,
    message: verified
      ? "Proof verified — benchmark scores are reproducible from the recorded inputs"
      : "Proof MISMATCH — underlying data has changed since proof was generated",
  };
}

// ---------------------------------------------------------------------------
// Query API
// ---------------------------------------------------------------------------

/**
 * Get bootstrap confidence intervals for an agent's composite score.
 */
export function getAgentBootstrapCI(agentId: string): BootstrapResult {
  const scores = scoreHistory
    .filter((e) => e.agentId === agentId)
    .map((e) => e.composite);
  return bootstrapCI(scores);
}

/**
 * Get all recorded scores for an agent.
 */
export function getAgentScoreHistory(agentId: string, limit = 50): ScoreEntry[] {
  return scoreHistory
    .filter((e) => e.agentId === agentId)
    .slice(0, limit);
}

/**
 * Get overall benchmark statistics.
 */
export function getBenchmarkStats(): {
  totalScores: number;
  agents: string[];
  rounds: number;
  avgComposite: number;
  stability: BenchmarkStability;
} {
  const agents = [...new Set(scoreHistory.map((e) => e.agentId))];
  const rounds = [...new Set(scoreHistory.map((e) => e.roundId))].length;
  const avgComposite = scoreHistory.length > 0
    ? Math.round((scoreHistory.reduce((s, e) => s + e.composite, 0) / scoreHistory.length) * 100) / 100
    : 0;

  return {
    totalScores: scoreHistory.length,
    agents,
    rounds,
    avgComposite,
    stability: assessBenchmarkStability(),
  };
}
