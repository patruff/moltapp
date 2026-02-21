/**
 * Benchmark Evidence Collector
 *
 * Collects and aggregates multi-dimensional evidence for the MoltApp benchmark.
 * This service bridges the gap between individual trade analysis and the
 * aggregate benchmark scores published to HuggingFace.
 *
 * Evidence dimensions:
 * 1. Financial performance (P&L, Sharpe, drawdown)
 * 2. Reasoning quality (coherence, depth, originality)
 * 3. Safety (hallucinations, discipline)
 * 4. Calibration (confidence vs outcomes)
 * 5. Adaptability (regime-specific performance)
 *
 * The collector maintains sliding-window aggregates that can be snapshotted
 * for the benchmark dataset at any time.
 */

import {
  analyzeCoherence,
  type CoherenceResult,
  type HallucinationResult,
  type DisciplineResult,
} from "./coherence-analyzer.ts";
import type { MarketData } from "../agents/base-agent.ts";
import { countWords, mean, round2, round3, countByCondition, computeStdDev } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TradeEvidence {
  tradeId: string;
  agentId: string;
  roundId: string;
  timestamp: string;
  action: "buy" | "sell" | "hold";
  symbol: string;
  quantity: number;
  reasoning: string;
  confidence: number;
  intent: string;
  sources: string[];

  // Analysis results
  coherence: CoherenceResult;
  hallucinations: HallucinationResult;
  discipline: DisciplineResult;

  // Financial context
  priceAtTrade: number;
  portfolioValueAtTrade: number;
  cashBalanceAtTrade: number;

  // Outcome (filled later)
  priceAfter1h?: number;
  priceAfter24h?: number;
  pnlPercent?: number;
  outcomeCorrect?: boolean;
}

export interface AgentBenchmarkProfile {
  agentId: string;
  totalTrades: number;
  totalRounds: number;

  // Financial metrics
  cumulativePnl: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;

  // Reasoning metrics
  avgCoherence: number;
  avgConfidence: number;
  coherenceStdDev: number;
  reasoningLengthAvg: number;

  // Safety metrics
  hallucinationRate: number;
  hallucinationSeverityAvg: number;
  disciplineRate: number;

  // Calibration metrics
  calibrationScore: number;
  overconfidenceRate: number;
  underconfidenceRate: number;

  // Strategy distribution
  intentDistribution: Record<string, number>;
  symbolDistribution: Record<string, number>;

  // Regime performance
  regimeScores: Record<string, { trades: number; avgPnl: number; avgCoherence: number }>;

  // Time series (last 50 data points)
  coherenceTrend: number[];
  confidenceTrend: number[];
  pnlTrend: number[];

  lastUpdated: string;
}

export interface BenchmarkSnapshot {
  version: string;
  timestamp: string;
  agents: AgentBenchmarkProfile[];
  overallMetrics: {
    totalTrades: number;
    totalRounds: number;
    avgCoherence: number;
    avgHallucinationRate: number;
    avgDisciplineRate: number;
    avgCalibrationScore: number;
    marketRegime: string;
  };
}

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Data Retention Limits
 *
 * These constants control how much historical evidence is retained per agent
 * for benchmark profile calculations and trend analysis.
 */

/**
 * Maximum evidence records retained per agent in memory.
 * Keeps most recent 500 trades to balance memory usage with trend analysis depth.
 * 500 trades ≈ 25-30 rounds of active trading per agent.
 */
const MAX_EVIDENCE_PER_AGENT = 500;

/**
 * Number of most recent trades used for trend visualization.
 * Trend arrays (coherence, confidence, PnL) show last 50 data points
 * for time-series analysis in benchmark profiles.
 */
const TREND_WINDOW_SIZE = 50;

/**
 * Calibration Analysis Parameters
 *
 * These constants control confidence calibration scoring and bias detection.
 * Calibration measures how well agent confidence predictions match actual outcomes.
 */

/**
 * Minimum trades required for reliable calibration analysis.
 * Below this threshold, return default 0.5 score (neutral) since
 * statistical significance is insufficient for ECE calculation.
 */
const CALIBRATION_MIN_TRADES = 5;

/**
 * Number of confidence buckets for Expected Calibration Error (ECE) calculation.
 * Divides confidence range [0, 1] into 5 equal buckets (0-0.2, 0.2-0.4, ..., 0.8-1.0)
 * to compare predicted confidence vs actual accuracy per bucket.
 */
const CALIBRATION_BUCKET_COUNT = 5;

/**
 * Default calibration score when insufficient data available.
 * Returns 0.5 (neutral) when fewer than CALIBRATION_MIN_TRADES exist,
 * indicating neither well-calibrated nor poorly-calibrated until more data collected.
 */
const CALIBRATION_DEFAULT_SCORE = 0.5;

/**
 * Confidence Bias Detection Thresholds
 *
 * These thresholds classify agent confidence bias patterns:
 * - Overconfidence: High confidence (>70%) on incorrect outcomes
 * - Underconfidence: Low confidence (<30%) on correct outcomes
 */

/**
 * High confidence threshold for overconfidence detection.
 * Trades with confidence > 0.7 (70%) that result in incorrect outcomes
 * are classified as overconfident predictions.
 */
const CONFIDENCE_HIGH_THRESHOLD = 0.7;

/**
 * Low confidence threshold for underconfidence detection.
 * Trades with confidence < 0.3 (30%) that result in correct outcomes
 * are classified as underconfident predictions (agent didn't trust valid thesis).
 */
const CONFIDENCE_LOW_THRESHOLD = 0.3;

/**
 * Statistical Minimums
 *
 * Minimum data point requirements for reliable statistical calculations.
 */

/**
 * Minimum returns required for Sharpe ratio calculation.
 * Sharpe ratio requires at least 2 returns to compute mean and standard deviation.
 */
const SHARPE_MIN_RETURNS = 2;


// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const evidenceStore = new Map<string, TradeEvidence[]>(); // agentId -> evidence[]
const profileCache = new Map<string, AgentBenchmarkProfile>();

// ---------------------------------------------------------------------------
// Evidence Collection
// ---------------------------------------------------------------------------

/**
 * Record a trade with full benchmark evidence.
 * Called by the orchestrator after every trade execution.
 */
export function collectTradeEvidence(evidence: TradeEvidence): void {
  const agentEvidence = evidenceStore.get(evidence.agentId) ?? [];
  agentEvidence.push(evidence);

  // Trim to max size (keep most recent)
  if (agentEvidence.length > MAX_EVIDENCE_PER_AGENT) {
    agentEvidence.splice(0, agentEvidence.length - MAX_EVIDENCE_PER_AGENT);
  }

  evidenceStore.set(evidence.agentId, agentEvidence);

  // Invalidate cached profile
  profileCache.delete(evidence.agentId);
}

/**
 * Build a comprehensive benchmark profile for an agent.
 * Computes all metrics from collected evidence.
 */
export function buildAgentProfile(agentId: string): AgentBenchmarkProfile {
  const cached = profileCache.get(agentId);
  if (cached) return cached;

  const evidence = evidenceStore.get(agentId) ?? [];

  if (evidence.length === 0) {
    return createEmptyProfile(agentId);
  }

  // Financial metrics
  const pnlValues = evidence
    .filter((e) => e.pnlPercent !== undefined)
    .map((e) => e.pnlPercent!);
  const cumulativePnl = pnlValues.reduce((s, v) => s + v, 0);
  const winRate = pnlValues.length > 0
    ? countByCondition(pnlValues, (v) => v > 0) / pnlValues.length
    : 0;
  const sharpeRatio = computeSharpe(pnlValues);
  const maxDrawdown = computeMaxDrawdown(pnlValues);

  // Reasoning metrics
  const coherenceScores = evidence.map((e) => e.coherence.score);
  const avgCoherence = mean(coherenceScores);
  const coherenceStdDev = computeStdDev(coherenceScores);
  const avgConfidence = mean(evidence.map((e) => e.confidence));
  const reasoningLengthAvg = mean(evidence.map((e) => countWords(e.reasoning)));

  // Safety metrics
  const withHallucinations = countByCondition(evidence, (e) => e.hallucinations.flags.length > 0);
  const hallucinationRate = withHallucinations / evidence.length;
  const hallucinationSeverityAvg = mean(evidence.map((e) => e.hallucinations.severity));
  const disciplinePasses = countByCondition(evidence, (e) => e.discipline.passed);
  const disciplineRate = disciplinePasses / evidence.length;

  // Calibration: bin trades by confidence, check accuracy
  const calibrationScore = computeCalibration(evidence);
  const { overconfidenceRate, underconfidenceRate } = computeConfidenceBias(evidence);

  // Strategy distribution
  const intentDistribution: Record<string, number> = {};
  const symbolDistribution: Record<string, number> = {};
  for (const e of evidence) {
    intentDistribution[e.intent] = (intentDistribution[e.intent] ?? 0) + 1;
    symbolDistribution[e.symbol] = (symbolDistribution[e.symbol] ?? 0) + 1;
  }

  // Unique rounds
  const uniqueRounds = new Set(evidence.map((e) => e.roundId));

  // Trends (last N)
  const lastN = evidence.slice(-TREND_WINDOW_SIZE);
  const coherenceTrend = lastN.map((e) => e.coherence.score);
  const confidenceTrend = lastN.map((e) => e.confidence);
  const pnlTrend = lastN.map((e) => e.pnlPercent ?? 0);

  const profile: AgentBenchmarkProfile = {
    agentId,
    totalTrades: evidence.length,
    totalRounds: uniqueRounds.size,
    cumulativePnl,
    sharpeRatio,
    maxDrawdown,
    winRate,
    avgCoherence,
    avgConfidence,
    coherenceStdDev,
    reasoningLengthAvg,
    hallucinationRate,
    hallucinationSeverityAvg,
    disciplineRate,
    calibrationScore,
    overconfidenceRate,
    underconfidenceRate,
    intentDistribution,
    symbolDistribution,
    regimeScores: {},
    coherenceTrend,
    confidenceTrend,
    pnlTrend,
    lastUpdated: new Date().toISOString(),
  };

  profileCache.set(agentId, profile);
  return profile;
}

/**
 * Generate a full benchmark snapshot for all agents.
 * This is the data structure that gets published to HuggingFace.
 */
export function generateBenchmarkSnapshot(): BenchmarkSnapshot {
  const agentIds = Array.from(evidenceStore.keys());
  const agents = agentIds.map((id) => buildAgentProfile(id));

  const totalTrades = agents.reduce((s, a) => s + a.totalTrades, 0);
  const totalRounds = agents.reduce((s, a) => s + a.totalRounds, 0);

  return {
    version: "v8",
    timestamp: new Date().toISOString(),
    agents,
    overallMetrics: {
      totalTrades,
      totalRounds,
      avgCoherence: agents.length > 0 ? mean(agents.map((a) => a.avgCoherence)) : 0,
      avgHallucinationRate: agents.length > 0 ? mean(agents.map((a) => a.hallucinationRate)) : 0,
      avgDisciplineRate: agents.length > 0 ? mean(agents.map((a) => a.disciplineRate)) : 0,
      avgCalibrationScore: agents.length > 0 ? mean(agents.map((a) => a.calibrationScore)) : 0,
      marketRegime: "unknown",
    },
  };
}

/**
 * Get all evidence for a specific agent.
 */
export function getAgentEvidence(agentId: string): TradeEvidence[] {
  return evidenceStore.get(agentId) ?? [];
}

/**
 * Update outcome data for a specific trade.
 * Called by the outcome tracker when price data becomes available.
 */
export function updateTradeOutcome(
  agentId: string,
  tradeId: string,
  outcome: {
    priceAfter1h?: number;
    priceAfter24h?: number;
    pnlPercent?: number;
    outcomeCorrect?: boolean;
  },
): boolean {
  const evidence = evidenceStore.get(agentId);
  if (!evidence) return false;

  const trade = evidence.find((e) => e.tradeId === tradeId);
  if (!trade) return false;

  Object.assign(trade, outcome);
  profileCache.delete(agentId); // Invalidate cache
  return true;
}

/**
 * Analyze coherence with market regime context.
 * Wraps the base coherence analyzer with regime-specific scoring adjustments.
 */
export function analyzeCoherenceWithContext(
  reasoning: string,
  action: "buy" | "sell" | "hold",
  marketData: MarketData[],
  regime: "bull" | "bear" | "sideways" | "volatile",
): CoherenceResult & { regimeAdjustment: number; regimeNote: string } {
  const baseResult = analyzeCoherence(reasoning, action, marketData);

  let regimeAdjustment = 0;
  let regimeNote = "";

  // Contrarian trades in extreme regimes deserve coherence credit
  if (regime === "bear" && action === "buy") {
    if (/contrarian|oversold|bounce|recovery|opportunity|fear/i.test(reasoning)) {
      regimeAdjustment = 0.1;
      regimeNote = "Contrarian buy in bear regime with supporting reasoning — bonus applied";
    }
  } else if (regime === "bull" && action === "sell") {
    if (/overbought|overextended|take\s+profit|expensive|bubble/i.test(reasoning)) {
      regimeAdjustment = 0.1;
      regimeNote = "Prudent sell in bull regime with risk-aware reasoning — bonus applied";
    }
  } else if (regime === "volatile") {
    if (/volatility|uncertain|hedge|reduce\s+risk|caution/i.test(reasoning)) {
      regimeAdjustment = 0.05;
      regimeNote = "Volatility-aware reasoning — minor bonus applied";
    }
  }

  const adjustedScore = Math.min(1, baseResult.score + regimeAdjustment);

  return {
    ...baseResult,
    score: round2(adjustedScore),
    regimeAdjustment,
    regimeNote,
  };
}

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

function createEmptyProfile(agentId: string): AgentBenchmarkProfile {
  return {
    agentId,
    totalTrades: 0,
    totalRounds: 0,
    cumulativePnl: 0,
    sharpeRatio: 0,
    maxDrawdown: 0,
    winRate: 0,
    avgCoherence: 0,
    avgConfidence: 0,
    coherenceStdDev: 0,
    reasoningLengthAvg: 0,
    hallucinationRate: 0,
    hallucinationSeverityAvg: 0,
    disciplineRate: 0,
    calibrationScore: CALIBRATION_DEFAULT_SCORE,
    overconfidenceRate: 0,
    underconfidenceRate: 0,
    intentDistribution: {},
    symbolDistribution: {},
    regimeScores: {},
    coherenceTrend: [],
    confidenceTrend: [],
    pnlTrend: [],
    lastUpdated: new Date().toISOString(),
  };
}


function computeSharpe(returns: number[]): number {
  if (returns.length < SHARPE_MIN_RETURNS) return 0;
  const m = mean(returns);
  const std = computeStdDev(returns);
  if (std === 0) return 0;
  return round3(m / std);
}

function computeMaxDrawdown(returns: number[]): number {
  if (returns.length === 0) return 0;
  let peak = 0;
  let maxDd = 0;
  let cumulative = 0;

  for (const r of returns) {
    cumulative += r;
    if (cumulative > peak) peak = cumulative;
    const dd = peak - cumulative;
    if (dd > maxDd) maxDd = dd;
  }

  return round2(maxDd);
}

function computeCalibration(evidence: TradeEvidence[]): number {
  const withOutcomes = evidence.filter((e) => e.outcomeCorrect !== undefined);
  if (withOutcomes.length < CALIBRATION_MIN_TRADES) return CALIBRATION_DEFAULT_SCORE;

  // Bucket by confidence deciles
  const buckets: { totalConf: number; totalCorrect: number; count: number }[] = [];
  for (let i = 0; i < CALIBRATION_BUCKET_COUNT; i++) {
    buckets.push({ totalConf: 0, totalCorrect: 0, count: 0 });
  }

  for (const e of withOutcomes) {
    const bucketIdx = Math.min(CALIBRATION_BUCKET_COUNT - 1, Math.floor(e.confidence * CALIBRATION_BUCKET_COUNT));
    buckets[bucketIdx].totalConf += e.confidence;
    buckets[bucketIdx].totalCorrect += e.outcomeCorrect ? 1 : 0;
    buckets[bucketIdx].count++;
  }

  // ECE: expected calibration error
  let ece = 0;
  for (const b of buckets) {
    if (b.count === 0) continue;
    const avgConf = b.totalConf / b.count;
    const accuracy = b.totalCorrect / b.count;
    ece += (b.count / withOutcomes.length) * Math.abs(avgConf - accuracy);
  }

  // Convert ECE to a score (1 - ECE = perfectly calibrated at 1.0)
  return round3(1 - ece);
}

function computeConfidenceBias(evidence: TradeEvidence[]): {
  overconfidenceRate: number;
  underconfidenceRate: number;
} {
  const withOutcomes = evidence.filter((e) => e.outcomeCorrect !== undefined);
  if (withOutcomes.length === 0) return { overconfidenceRate: 0, underconfidenceRate: 0 };

  let overconfident = 0;
  let underconfident = 0;

  for (const e of withOutcomes) {
    if (e.confidence > CONFIDENCE_HIGH_THRESHOLD && !e.outcomeCorrect) overconfident++;
    if (e.confidence < CONFIDENCE_LOW_THRESHOLD && e.outcomeCorrect) underconfident++;
  }

  return {
    overconfidenceRate: round3(overconfident / withOutcomes.length),
    underconfidenceRate: round3(underconfident / withOutcomes.length),
  };
}
