/**
 * Benchmark v3 Composite Scoring Engine
 *
 * The definitive scoring system for MoltApp's AI trading benchmark.
 * Computes weighted multi-factor composite scores that determine agent rankings.
 *
 * Factors (6 pillars):
 * 1. P&L % (25%) — Raw financial return
 * 2. Sharpe Ratio (20%) — Risk-adjusted return
 * 3. Reasoning Coherence (20%) — Logic-action alignment
 * 4. Hallucination Rate (15%) — Factual accuracy
 * 5. Instruction Discipline (10%) — Rule compliance
 * 6. Confidence Calibration (10%) — Self-awareness accuracy
 *
 * Additionally computes:
 * - Percentile rankings per factor
 * - Factor-weighted composite score
 * - Benchmark grade (A+ through F)
 * - Temporal trend (improving / stable / degrading)
 * - Statistical significance flags
 */

import { clamp, round3 } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BenchmarkFactorScore {
  /** Factor name */
  name: string;
  /** Raw value */
  raw: number;
  /** Normalized score 0-1 */
  normalized: number;
  /** Weight in composite */
  weight: number;
  /** Weighted contribution to composite */
  contribution: number;
  /** Percentile rank among all agents (0-100) */
  percentile: number;
  /** Short description of what this measures */
  description: string;
}

export interface AgentBenchmarkScore {
  agentId: string;
  agentName: string;
  provider: string;
  model: string;

  /** Individual factor scores */
  factors: BenchmarkFactorScore[];

  /** Weighted composite score 0-1 */
  composite: number;

  /** Letter grade (A+ through F) */
  grade: string;

  /** Rank among all agents (1 = best) */
  rank: number;

  /** Number of trades used for scoring */
  tradeCount: number;

  /** Whether the sample size is statistically meaningful (>= 10 trades) */
  statisticallySignificant: boolean;

  /** Trend compared to previous period */
  trend: "improving" | "stable" | "degrading" | "insufficient_data";

  /** Timestamp when score was computed */
  computedAt: string;
}

export interface BenchmarkScorecard {
  /** Version identifier */
  version: string;
  /** All agent scores, sorted by composite descending */
  agents: AgentBenchmarkScore[];
  /** Platform-wide averages */
  platformAverages: Record<string, number>;
  /** Factor correlation matrix (which factors predict outcomes?) */
  factorCorrelations: FactorCorrelation[];
  /** Generated at */
  generatedAt: string;
}

export interface FactorCorrelation {
  factorA: string;
  factorB: string;
  correlation: number;
}

export interface AgentFactorInputs {
  agentId: string;
  agentName: string;
  provider: string;
  model: string;
  pnlPercent: number;
  sharpeRatio: number;
  avgCoherence: number;
  hallucinationRate: number;
  disciplineRate: number;
  calibrationScore: number;
  tradeCount: number;
  /** Previous period scores for trend computation */
  previousComposite?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FACTOR_WEIGHTS = {
  pnl_percent: 0.25,
  sharpe_ratio: 0.20,
  reasoning_coherence: 0.20,
  hallucination_rate: 0.15,
  instruction_discipline: 0.10,
  confidence_calibration: 0.10,
} as const;

const GRADE_THRESHOLDS: [number, string][] = [
  [0.95, "A+"],
  [0.90, "A"],
  [0.85, "A-"],
  [0.80, "B+"],
  [0.75, "B"],
  [0.70, "B-"],
  [0.65, "C+"],
  [0.60, "C"],
  [0.55, "C-"],
  [0.50, "D+"],
  [0.45, "D"],
  [0.40, "D-"],
  [0.0, "F"],
];

/**
 * Trend Detection Thresholds
 *
 * NOTE: benchmark-v3 (this file) uses 0.03 threshold for trend detection,
 * while benchmark-v11 uses 0.05 threshold. This difference is intentional:
 * - v3 uses MORE SENSITIVE detection (0.03) to catch smaller performance shifts
 * - v11 uses LESS SENSITIVE detection (0.05) to reduce noise in longer-term trends
 *
 * This reflects different scoring philosophies:
 * - v3: Real-time monitoring, flag small changes early
 * - v11: Holistic assessment, require substantial shifts for trend classification
 */

/**
 * Threshold for improving classification (delta > 0.03 = improving trend).
 * V3 uses 0.03 (40% more sensitive than v11's 0.05) to detect improvements faster.
 */
const TREND_IMPROVING_THRESHOLD = 0.03;

/**
 * Threshold for degrading classification (delta < -0.03 = degrading trend).
 * V3 uses -0.03 (40% more sensitive than v11's -0.05) to detect degradation faster.
 */
const TREND_DEGRADING_THRESHOLD = -0.03;

/**
 * P&L Normalization Parameters
 *
 * Maps P&L percentages to normalized 0-1 scores for composite calculation.
 * Formula: (pnl + LOWER) / (UPPER - LOWER)
 *
 * Current bounds: [-50%, +50%] → [0, 1]
 * - -50% loss maps to score 0.0
 * - 0% P&L maps to score 0.5
 * - +50% gain maps to score 1.0
 *
 * TUNING: Adjust bounds to change score sensitivity:
 * - Narrower range (e.g., [-30%, +30%]) → more sensitive to small P&L changes
 * - Wider range (e.g., [-100%, +100%]) → less sensitive, rewards extreme performance
 */
const PNL_NORMALIZATION_LOWER_BOUND = -50;
const PNL_NORMALIZATION_UPPER_BOUND = 50;

/**
 * Sharpe Ratio Normalization Parameters
 *
 * Maps Sharpe ratios to normalized 0-1 scores for composite calculation.
 * Formula: (sharpe + LOWER) / (UPPER - LOWER)
 *
 * Current bounds: [-2, +3] → [0, 1]
 * - Sharpe -2 (terrible risk-adjusted return) maps to score 0.0
 * - Sharpe 0 (risk-free equivalent) maps to score 0.4
 * - Sharpe +3 (exceptional risk-adjusted return) maps to score 1.0
 *
 * TUNING: Adjust bounds to change score sensitivity:
 * - Range choice affects relative weight of risk-adjusted vs absolute returns
 * - Current asymmetric range [-2, +3] reflects:
 *   - Downside: Sharpe < -2 is catastrophic (overweight risk, massive drawdowns)
 *   - Upside: Sharpe > 3 is rare in crypto (capping at 3 prevents outlier dominance)
 */
const SHARPE_NORMALIZATION_LOWER_BOUND = -2;
const SHARPE_NORMALIZATION_UPPER_BOUND = 3;

/**
 * Statistical Significance Threshold
 *
 * Minimum trades required for benchmark score to be considered statistically meaningful.
 * Scores below this threshold are flagged with statisticallySignificant: false.
 *
 * Current threshold: 10 trades
 * - Provides basic confidence in averages (Sharpe, coherence, hallucination rate)
 * - Prevents single lucky/unlucky trades from dominating score
 *
 * TUNING: Adjust based on desired confidence level:
 * - Lower (5 trades) → faster score updates, but noisier rankings
 * - Higher (20 trades) → more stable rankings, but slower to detect emerging patterns
 */
const STATISTICAL_SIGNIFICANCE_MIN_TRADES = 10;

/**
 * Percentile Calculation Minimum Agents
 *
 * Minimum number of agents required for meaningful percentile calculations.
 * When fewer agents exist, percentile rankings may be misleading.
 *
 * Current threshold: 3 agents
 * - Allows basic "top/middle/bottom" classification
 * - Prevents division-by-zero in percentile formula
 *
 * TUNING: This is a safety threshold, rarely needs adjustment.
 */
const PERCENTILE_CALCULATION_MIN_AGENTS = 3;

// ---------------------------------------------------------------------------
// State: Score History for Trend Analysis
// ---------------------------------------------------------------------------

interface ScoreHistoryEntry {
  agentId: string;
  composite: number;
  factors: Record<string, number>;
  timestamp: string;
}

const scoreHistory: ScoreHistoryEntry[] = [];
const MAX_HISTORY = 1000;

// ---------------------------------------------------------------------------
// Core: Compute Benchmark Scores
// ---------------------------------------------------------------------------

/**
 * Compute the full benchmark scorecard for all agents.
 */
export function computeBenchmarkScorecard(
  agentInputs: AgentFactorInputs[],
): BenchmarkScorecard {
  if (agentInputs.length === 0) {
    return {
      version: "v3",
      agents: [],
      platformAverages: {},
      factorCorrelations: [],
      generatedAt: new Date().toISOString(),
    };
  }

  // Step 1: Compute raw factor scores for each agent
  const agentScores: AgentBenchmarkScore[] = agentInputs.map((input) => {
    const factors = computeFactors(input);
    const composite = factors.reduce((sum, f) => sum + f.contribution, 0);
    const grade = assignGrade(composite);
    const trend = computeTrend(input.agentId, composite, input.previousComposite);

    return {
      agentId: input.agentId,
      agentName: input.agentName,
      provider: input.provider,
      model: input.model,
      factors,
      composite: round(composite),
      grade,
      rank: 0, // assigned below
      tradeCount: input.tradeCount,
      statisticallySignificant: input.tradeCount >= STATISTICAL_SIGNIFICANCE_MIN_TRADES,
      trend,
      computedAt: new Date().toISOString(),
    };
  });

  // Step 2: Compute percentile rankings per factor
  const factorNames = Object.keys(FACTOR_WEIGHTS);
  for (const factorName of factorNames) {
    const values = agentScores.map((a) => {
      const factor = a.factors.find((f) => f.name === factorName);
      return factor?.normalized ?? 0;
    });
    values.sort((a, b) => a - b);

    for (const agent of agentScores) {
      const factor = agent.factors.find((f) => f.name === factorName);
      if (factor) {
        const rank = values.indexOf(factor.normalized);
        factor.percentile = round((rank / Math.max(1, values.length - 1)) * 100);
      }
    }
  }

  // Step 3: Sort by composite and assign ranks
  agentScores.sort((a, b) => b.composite - a.composite);
  agentScores.forEach((a, i) => { a.rank = i + 1; });

  // Step 4: Platform averages
  const platformAverages: Record<string, number> = {};
  for (const factorName of factorNames) {
    const values = agentScores.map((a) => {
      const factor = a.factors.find((f) => f.name === factorName);
      return factor?.normalized ?? 0;
    });
    platformAverages[factorName] = round(
      values.reduce((s, v) => s + v, 0) / values.length,
    );
  }
  platformAverages["composite"] = round(
    agentScores.reduce((s, a) => s + a.composite, 0) / agentScores.length,
  );

  // Step 5: Factor correlations
  const factorCorrelations = computeFactorCorrelations(agentScores);

  // Step 6: Record to history
  for (const agent of agentScores) {
    scoreHistory.unshift({
      agentId: agent.agentId,
      composite: agent.composite,
      factors: Object.fromEntries(
        agent.factors.map((f) => [f.name, f.normalized]),
      ),
      timestamp: agent.computedAt,
    });
  }
  if (scoreHistory.length > MAX_HISTORY) {
    scoreHistory.length = MAX_HISTORY;
  }

  return {
    version: "v3",
    agents: agentScores,
    platformAverages,
    factorCorrelations,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Get the score history for an agent (for trend charts).
 */
export function getAgentScoreHistory(
  agentId: string,
  limit = 50,
): ScoreHistoryEntry[] {
  return scoreHistory
    .filter((e) => e.agentId === agentId)
    .slice(0, limit);
}

/**
 * Get the latest scorecard from cache (or compute fresh).
 */
let cachedScorecard: BenchmarkScorecard | null = null;

export function getCachedScorecard(): BenchmarkScorecard | null {
  return cachedScorecard;
}

export function setCachedScorecard(sc: BenchmarkScorecard): void {
  cachedScorecard = sc;
}

// ---------------------------------------------------------------------------
// Factor Computation
// ---------------------------------------------------------------------------

function computeFactors(input: AgentFactorInputs): BenchmarkFactorScore[] {
  return [
    {
      name: "pnl_percent",
      raw: input.pnlPercent,
      normalized: normalizePnl(input.pnlPercent),
      weight: FACTOR_WEIGHTS.pnl_percent,
      contribution: normalizePnl(input.pnlPercent) * FACTOR_WEIGHTS.pnl_percent,
      percentile: 0,
      description: "Return on investment since competition start",
    },
    {
      name: "sharpe_ratio",
      raw: input.sharpeRatio,
      normalized: normalizeSharpe(input.sharpeRatio),
      weight: FACTOR_WEIGHTS.sharpe_ratio,
      contribution: normalizeSharpe(input.sharpeRatio) * FACTOR_WEIGHTS.sharpe_ratio,
      percentile: 0,
      description: "Risk-adjusted return (higher = better return per unit of risk)",
    },
    {
      name: "reasoning_coherence",
      raw: input.avgCoherence,
      normalized: clamp(input.avgCoherence, 0, 1),
      weight: FACTOR_WEIGHTS.reasoning_coherence,
      contribution: clamp(input.avgCoherence, 0, 1) * FACTOR_WEIGHTS.reasoning_coherence,
      percentile: 0,
      description: "Does the agent's logic match its trading action?",
    },
    {
      name: "hallucination_rate",
      raw: input.hallucinationRate,
      normalized: clamp(1 - input.hallucinationRate, 0, 1), // Invert: lower rate = higher score
      weight: FACTOR_WEIGHTS.hallucination_rate,
      contribution: clamp(1 - input.hallucinationRate, 0, 1) * FACTOR_WEIGHTS.hallucination_rate,
      percentile: 0,
      description: "Factual accuracy — lower hallucination rate is better",
    },
    {
      name: "instruction_discipline",
      raw: input.disciplineRate,
      normalized: clamp(input.disciplineRate, 0, 1),
      weight: FACTOR_WEIGHTS.instruction_discipline,
      contribution: clamp(input.disciplineRate, 0, 1) * FACTOR_WEIGHTS.instruction_discipline,
      percentile: 0,
      description: "Compliance with position limits and trading rules",
    },
    {
      name: "confidence_calibration",
      raw: input.calibrationScore,
      normalized: clamp(input.calibrationScore, 0, 1),
      weight: FACTOR_WEIGHTS.confidence_calibration,
      contribution: clamp(input.calibrationScore, 0, 1) * FACTOR_WEIGHTS.confidence_calibration,
      percentile: 0,
      description: "Self-awareness: is high confidence correlated with good outcomes?",
    },
  ];
}

// ---------------------------------------------------------------------------
// Normalization Functions
// ---------------------------------------------------------------------------

/** Normalize P&L using configured bounds */
function normalizePnl(pnl: number): number {
  const range = PNL_NORMALIZATION_UPPER_BOUND - PNL_NORMALIZATION_LOWER_BOUND;
  return clamp((pnl - PNL_NORMALIZATION_LOWER_BOUND) / range, 0, 1);
}

/** Normalize Sharpe ratio using configured bounds */
function normalizeSharpe(sharpe: number): number {
  const range = SHARPE_NORMALIZATION_UPPER_BOUND - SHARPE_NORMALIZATION_LOWER_BOUND;
  return clamp((sharpe - SHARPE_NORMALIZATION_LOWER_BOUND) / range, 0, 1);
}

function round(v: number): number {
  return round3(v);
}

// ---------------------------------------------------------------------------
// Grade Assignment
// ---------------------------------------------------------------------------

function assignGrade(composite: number): string {
  for (const [threshold, grade] of GRADE_THRESHOLDS) {
    if (composite >= threshold) return grade;
  }
  return "F";
}

// ---------------------------------------------------------------------------
// Trend Computation
// ---------------------------------------------------------------------------

function computeTrend(
  agentId: string,
  currentComposite: number,
  previousComposite?: number,
): AgentBenchmarkScore["trend"] {
  const prev = previousComposite ?? getLastComposite(agentId);
  if (prev === null) return "insufficient_data";

  const delta = currentComposite - prev;
  if (delta > TREND_IMPROVING_THRESHOLD) return "improving";
  if (delta < TREND_DEGRADING_THRESHOLD) return "degrading";
  return "stable";
}

function getLastComposite(agentId: string): number | null {
  const entry = scoreHistory.find((e) => e.agentId === agentId);
  return entry?.composite ?? null;
}

// ---------------------------------------------------------------------------
// Factor Correlations
// ---------------------------------------------------------------------------

function computeFactorCorrelations(
  agents: AgentBenchmarkScore[],
): FactorCorrelation[] {
  if (agents.length < PERCENTILE_CALCULATION_MIN_AGENTS) return [];

  const factorNames = Object.keys(FACTOR_WEIGHTS);
  const correlations: FactorCorrelation[] = [];

  for (let i = 0; i < factorNames.length; i++) {
    for (let j = i + 1; j < factorNames.length; j++) {
      const nameA = factorNames[i];
      const nameB = factorNames[j];

      const valuesA = agents.map(
        (a) => a.factors.find((f) => f.name === nameA)?.normalized ?? 0,
      );
      const valuesB = agents.map(
        (a) => a.factors.find((f) => f.name === nameB)?.normalized ?? 0,
      );

      const corr = pearsonCorrelation(valuesA, valuesB);
      correlations.push({
        factorA: nameA,
        factorB: nameB,
        correlation: round(corr),
      });
    }
  }

  return correlations;
}

/**
 * Simple Pearson correlation coefficient between two arrays.
 */
function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 2) return 0;

  const meanX = x.reduce((s, v) => s + v, 0) / n;
  const meanY = y.reduce((s, v) => s + v, 0) / n;

  let num = 0;
  let denX = 0;
  let denY = 0;

  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
}
