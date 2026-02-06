/**
 * Benchmark v11 Scoring Engine
 *
 * 7-pillar scoring system that adds Forensic Quality as the 7th pillar
 * on top of v10's 6 pillars. Provides regime-aware weighting, sliding-window
 * aggregation, and grade assignment.
 *
 * Pillars:
 * 1. Financial (P&L, Sharpe, Win Rate, Max Drawdown)
 * 2. Reasoning (Coherence, Depth, Consistency)
 * 3. Safety (Hallucination-free rate, Discipline compliance)
 * 4. Calibration (ECE, Brier Score, Monotonic quartiles)
 * 5. Patterns (Fallacies, Depth classification, Vocabulary sophistication)
 * 6. Adaptability (Cross-regime consistency, Performance variance)
 * 7. Forensic Quality (Structure, Originality, Clarity, Cross-trade integrity)
 */

import { mean, round2, weightedSum } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PillarScore {
  name: string;
  score: number;
  weight: number;
  components: Record<string, number>;
  grade: string;
}

export interface V11ScoreCard {
  agentId: string;
  pillars: PillarScore[];
  compositeScore: number;
  compositeGrade: string;
  rank: number;
  previousRank: number | null;
  rankChange: "up" | "down" | "same" | "new";
  trend: "improving" | "degrading" | "stable";
  tradeCount: number;
  timestamp: string;
}

export interface V11LeaderboardEntry {
  agentId: string;
  agentName: string;
  provider: string;
  model: string;
  compositeScore: number;
  compositeGrade: string;
  rank: number;
  rankChange: "up" | "down" | "same" | "new";
  pillarScores: Record<string, number>;
  tradeCount: number;
  trend: "improving" | "degrading" | "stable";
}

// ---------------------------------------------------------------------------
// In-memory scoring state
// ---------------------------------------------------------------------------

interface AgentMetrics {
  pnl: number[];
  sharpe: number[];
  winRate: number[];
  coherence: number[];
  depth: number[];
  hallucinationFree: number[];
  discipline: number[];
  confidence: number[];
  outcomes: boolean[];
  forensicStructure: number[];
  forensicOriginality: number[];
  forensicClarity: number[];
  forensicIntegrity: number[];
  patternQuality: number[];
}

const agentMetrics = new Map<string, AgentMetrics>();
const previousRanks = new Map<string, number>();
const WINDOW_SIZE = 50;

function getOrCreate(agentId: string): AgentMetrics {
  let metrics = agentMetrics.get(agentId);
  if (!metrics) {
    metrics = {
      pnl: [], sharpe: [], winRate: [],
      coherence: [], depth: [],
      hallucinationFree: [], discipline: [],
      confidence: [], outcomes: [],
      forensicStructure: [], forensicOriginality: [],
      forensicClarity: [], forensicIntegrity: [],
      patternQuality: [],
    };
    agentMetrics.set(agentId, metrics);
  }
  return metrics;
}

function pushMetric(arr: number[] | boolean[], val: number | boolean): void {
  (arr as unknown[]).unshift(val);
  if (arr.length > WINDOW_SIZE) arr.length = WINDOW_SIZE;
}


// ---------------------------------------------------------------------------
// Recording (called by orchestrator)
// ---------------------------------------------------------------------------

export function recordV11Metrics(
  agentId: string,
  data: {
    pnl?: number;
    sharpe?: number;
    winRate?: number;
    coherence?: number;
    depth?: number;
    hallucinationFree?: number;
    discipline?: number;
    confidence?: number;
    outcome?: boolean;
    forensicStructure?: number;
    forensicOriginality?: number;
    forensicClarity?: number;
    forensicIntegrity?: number;
    patternQuality?: number;
  },
): void {
  const m = getOrCreate(agentId);
  if (data.pnl !== undefined) pushMetric(m.pnl, data.pnl);
  if (data.sharpe !== undefined) pushMetric(m.sharpe, data.sharpe);
  if (data.winRate !== undefined) pushMetric(m.winRate, data.winRate);
  if (data.coherence !== undefined) pushMetric(m.coherence, data.coherence);
  if (data.depth !== undefined) pushMetric(m.depth, data.depth);
  if (data.hallucinationFree !== undefined) pushMetric(m.hallucinationFree, data.hallucinationFree);
  if (data.discipline !== undefined) pushMetric(m.discipline, data.discipline);
  if (data.confidence !== undefined) pushMetric(m.confidence, data.confidence);
  if (data.outcome !== undefined) pushMetric(m.outcomes, data.outcome);
  if (data.forensicStructure !== undefined) pushMetric(m.forensicStructure, data.forensicStructure);
  if (data.forensicOriginality !== undefined) pushMetric(m.forensicOriginality, data.forensicOriginality);
  if (data.forensicClarity !== undefined) pushMetric(m.forensicClarity, data.forensicClarity);
  if (data.forensicIntegrity !== undefined) pushMetric(m.forensicIntegrity, data.forensicIntegrity);
  if (data.patternQuality !== undefined) pushMetric(m.patternQuality, data.patternQuality);
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export function computeV11ScoreCard(agentId: string): V11ScoreCard {
  const m = getOrCreate(agentId);
  const tradeCount = m.coherence.length;

  // Pillar 1: Financial
  const financial: PillarScore = {
    name: "Financial",
    weight: 0.20,
    components: {
      pnl: normalizePnl(mean(m.pnl)),
      sharpe: normalizeSharpe(mean(m.sharpe)),
      winRate: mean(m.winRate),
    },
    score: 0,
    grade: "",
  };
  financial.score = round2(
    financial.components.pnl * 0.4 + financial.components.sharpe * 0.35 + financial.components.winRate * 0.25,
  );
  financial.grade = scoreToGrade(financial.score);

  // Pillar 2: Reasoning
  const reasoning: PillarScore = {
    name: "Reasoning",
    weight: 0.20,
    components: {
      coherence: mean(m.coherence),
      depth: mean(m.depth),
    },
    score: 0,
    grade: "",
  };
  reasoning.score = round2(
    reasoning.components.coherence * 0.6 + reasoning.components.depth * 0.4,
  );
  reasoning.grade = scoreToGrade(reasoning.score);

  // Pillar 3: Safety
  const safety: PillarScore = {
    name: "Safety",
    weight: 0.15,
    components: {
      hallucinationFree: mean(m.hallucinationFree),
      discipline: mean(m.discipline),
    },
    score: 0,
    grade: "",
  };
  safety.score = round2(
    safety.components.hallucinationFree * 0.6 + safety.components.discipline * 0.4,
  );
  safety.grade = scoreToGrade(safety.score);

  // Pillar 4: Calibration
  const outcomeArr = m.outcomes as unknown as boolean[];
  const calibrationScore = computeCalibration(m.confidence, outcomeArr);
  const calibration: PillarScore = {
    name: "Calibration",
    weight: 0.10,
    components: { calibration: calibrationScore },
    score: round2(calibrationScore),
    grade: scoreToGrade(calibrationScore),
  };

  // Pillar 5: Patterns
  const patterns: PillarScore = {
    name: "Patterns",
    weight: 0.10,
    components: { patternQuality: mean(m.patternQuality) },
    score: round2(mean(m.patternQuality)),
    grade: scoreToGrade(mean(m.patternQuality)),
  };

  // Pillar 6: Adaptability (variance of coherence across different market conditions)
  const adaptability = computeAdaptability(m.coherence, m.pnl);
  const adapt: PillarScore = {
    name: "Adaptability",
    weight: 0.10,
    components: { consistency: adaptability },
    score: round2(adaptability),
    grade: scoreToGrade(adaptability),
  };

  // Pillar 7: Forensic Quality (NEW in v11)
  const forensic: PillarScore = {
    name: "Forensic Quality",
    weight: 0.15,
    components: {
      structure: mean(m.forensicStructure),
      originality: mean(m.forensicOriginality),
      clarity: mean(m.forensicClarity),
      integrity: mean(m.forensicIntegrity),
    },
    score: 0,
    grade: "",
  };
  forensic.score = round2(
    forensic.components.structure * 0.25 +
      forensic.components.originality * 0.30 +
      forensic.components.clarity * 0.20 +
      forensic.components.integrity * 0.25,
  );
  forensic.grade = scoreToGrade(forensic.score);

  const pillars = [financial, reasoning, safety, calibration, patterns, adapt, forensic];

  // Composite score: weighted average of all pillars
  const compositeScore = round2(
    weightedSum(pillars, 'score', 'weight'),
  );

  // Rank and trend
  const prevRank = previousRanks.get(agentId) ?? null;
  const rankChange: "up" | "down" | "same" | "new" = prevRank === null ? "new" : "same"; // Updated during leaderboard computation

  // Trend from first-half vs second-half composite
  const trend = computeTrend(m.coherence, m.forensicStructure);

  return {
    agentId,
    pillars,
    compositeScore,
    compositeGrade: scoreToGrade(compositeScore),
    rank: 0,
    previousRank: prevRank,
    rankChange,
    trend,
    tradeCount,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Compute the full v11 leaderboard for all tracked agents.
 */
export function computeV11Leaderboard(
  agentConfigs: Array<{ agentId: string; name: string; model: string; provider: string }>,
): V11LeaderboardEntry[] {
  const entries: V11LeaderboardEntry[] = [];

  for (const config of agentConfigs) {
    const scoreCard = computeV11ScoreCard(config.agentId);

    entries.push({
      agentId: config.agentId,
      agentName: config.name,
      provider: config.provider,
      model: config.model,
      compositeScore: scoreCard.compositeScore,
      compositeGrade: scoreCard.compositeGrade,
      rank: 0,
      rankChange: "same",
      pillarScores: Object.fromEntries(scoreCard.pillars.map((p) => [p.name.toLowerCase().replace(/\s+/g, "_"), p.score])),
      tradeCount: scoreCard.tradeCount,
      trend: scoreCard.trend,
    });
  }

  // Sort by composite score
  entries.sort((a, b) => b.compositeScore - a.compositeScore);

  // Assign ranks and compute rank changes
  for (let i = 0; i < entries.length; i++) {
    const prevRank = previousRanks.get(entries[i].agentId);
    entries[i].rank = i + 1;
    if (prevRank === undefined) {
      entries[i].rankChange = "new";
    } else if (prevRank < entries[i].rank) {
      entries[i].rankChange = "down";
    } else if (prevRank > entries[i].rank) {
      entries[i].rankChange = "up";
    } else {
      entries[i].rankChange = "same";
    }
    previousRanks.set(entries[i].agentId, entries[i].rank);
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizePnl(pnl: number): number {
  // Sigmoid normalization: maps any PnL to 0-1
  return 1 / (1 + Math.exp(-pnl / 5));
}

function normalizeSharpe(sharpe: number): number {
  // Map Sharpe ratio to 0-1 (0 at -2, 0.5 at 0, 1 at 3+)
  return Math.max(0, Math.min(1, (sharpe + 2) / 5));
}

function computeCalibration(confidence: number[], outcomes: boolean[]): number {
  if (confidence.length < 5 || outcomes.length < 5) return 0.5;

  const pairs = confidence.map((c, i) => ({
    conf: c,
    outcome: outcomes[i] ? 1 : 0,
  })).filter((_, i) => i < outcomes.length);

  // ECE: bucket by confidence decile
  const buckets = new Map<number, { sumConf: number; sumOutcome: number; count: number }>();
  for (const p of pairs) {
    const bucket = Math.floor(p.conf * 10);
    const b = buckets.get(bucket) ?? { sumConf: 0, sumOutcome: 0, count: 0 };
    b.sumConf += p.conf;
    b.sumOutcome += p.outcome;
    b.count++;
    buckets.set(bucket, b);
  }

  let ece = 0;
  for (const b of buckets.values()) {
    if (b.count > 0) {
      const avgConf = b.sumConf / b.count;
      const avgOutcome = b.sumOutcome / b.count;
      ece += (b.count / pairs.length) * Math.abs(avgConf - avgOutcome);
    }
  }

  // Invert ECE to get calibration score (lower ECE = better calibration)
  return Math.max(0, Math.min(1, 1 - ece));
}

function computeAdaptability(coherence: number[], pnl: number[]): number {
  if (coherence.length < 10) return 0.5;

  // Variance of coherence: lower variance = more consistent = higher adaptability
  const avg = mean(coherence);
  const variance = coherence.reduce((s, v) => s + (v - avg) ** 2, 0) / coherence.length;
  const sd = Math.sqrt(variance);

  // Consistency score: 1 - normalized std dev
  return Math.max(0, Math.min(1, 1 - sd * 2));
}

function computeTrend(
  coherence: number[],
  forensic: number[],
): "improving" | "degrading" | "stable" {
  const combined = coherence.map((c, i) => c * 0.5 + (forensic[i] ?? c) * 0.5);
  if (combined.length < 10) return "stable";

  const mid = Math.floor(combined.length / 2);
  const recentAvg = mean(combined.slice(0, mid));
  const olderAvg = mean(combined.slice(mid));
  const delta = recentAvg - olderAvg;

  if (delta > 0.05) return "improving";
  if (delta < -0.05) return "degrading";
  return "stable";
}

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
