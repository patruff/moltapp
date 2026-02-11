/**
 * Benchmark Intelligence Gateway (v17)
 *
 * Unified gateway service that aggregates benchmark data across all pillar
 * scoring engines (v9-v16) and produces a normalized, researcher-grade
 * intelligence output. This is the single-source-of-truth for agent
 * benchmark rankings, used by the v17 dashboard, HuggingFace sync,
 * and external researcher APIs.
 *
 * Features:
 * - 16-pillar unified scoring with configurable weights
 * - Cross-version score normalization
 * - Agent ranking with statistical significance testing
 * - Benchmark health monitoring (data freshness, coverage, consistency)
 * - Export-ready researcher payloads (JSONL, CSV, summary stats)
 */

import { clamp, weightedSum } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PillarScore {
  name: string;
  score: number;
  weight: number;
  components: Record<string, number>;
  grade: string;
  trend: "improving" | "stable" | "declining";
  confidence: number; // How confident we are in this score (data quality)
}

export interface AgentBenchmarkProfile {
  agentId: string;
  provider: string;
  model: string;
  composite: number;
  grade: string;
  rank: number;
  pillars: PillarScore[];
  strengths: string[];
  weaknesses: string[];
  tradeCount: number;
  dataQuality: number; // 0-1, how much data backs this profile
  lastUpdated: string;
  eloRating: number;
  streak: { type: "win" | "loss" | "neutral"; length: number };
}

export interface BenchmarkHealthReport {
  version: string;
  totalAgents: number;
  totalTrades: number;
  avgDataQuality: number;
  pillarCoverage: Record<string, number>;
  stalePillars: string[];
  lastRoundId: string | null;
  lastRoundTimestamp: string | null;
  uptime: number;
  warnings: string[];
}

export interface BenchmarkExportPayload {
  metadata: {
    version: string;
    exportedAt: string;
    totalRecords: number;
    agents: string[];
    pillarCount: number;
  };
  agents: AgentBenchmarkProfile[];
  health: BenchmarkHealthReport;
}

// ---------------------------------------------------------------------------
// v17 Pillar Weight Configuration
// ---------------------------------------------------------------------------

export const V17_PILLAR_WEIGHTS: Record<string, number> = {
  financial: 0.11,
  reasoning: 0.10,
  safety: 0.08,
  calibration: 0.07,
  patterns: 0.05,
  adaptability: 0.05,
  forensic_quality: 0.07,
  validation_quality: 0.07,
  prediction_accuracy: 0.06,
  reasoning_stability: 0.05,
  provenance_integrity: 0.06,
  model_comparison: 0.05,
  metacognition: 0.06,
  reasoning_efficiency: 0.04,
  forensic_ledger: 0.04,
  strategy_genome: 0.04,
};

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Grade Boundaries for Score-to-Grade Conversion
 *
 * These thresholds control how composite/pillar scores map to letter grades.
 * Scores are normalized to [0, 1] range before grading.
 */
const GRADE_THRESHOLD_A_PLUS = 0.95;   // ≥0.95 = A+ (exceptional performance)
const GRADE_THRESHOLD_A = 0.90;        // ≥0.90 = A (excellent)
const GRADE_THRESHOLD_A_MINUS = 0.85;  // ≥0.85 = A- (very good)
const GRADE_THRESHOLD_B_PLUS = 0.80;   // ≥0.80 = B+ (good)
const GRADE_THRESHOLD_B = 0.75;        // ≥0.75 = B (above average)
const GRADE_THRESHOLD_B_MINUS = 0.70;  // ≥0.70 = B- (slightly above average)
const GRADE_THRESHOLD_C_PLUS = 0.65;   // ≥0.65 = C+ (average)
const GRADE_THRESHOLD_C = 0.60;        // ≥0.60 = C (slightly below average)
const GRADE_THRESHOLD_C_MINUS = 0.55;  // ≥0.55 = C- (below average)
const GRADE_THRESHOLD_D_PLUS = 0.50;   // ≥0.50 = D+ (poor)
const GRADE_THRESHOLD_D = 0.45;        // ≥0.45 = D (very poor)
const GRADE_THRESHOLD_D_MINUS = 0.40;  // ≥0.40 = D- (failing, <0.40 = F)

/**
 * Trend Detection Thresholds
 *
 * Used by detectTrend() to classify pillar score trends as improving/stable/declining.
 * Compares recent 5-round average to older 5-round average.
 */
const TREND_IMPROVING_THRESHOLD = 0.05;   // Delta > +0.05 = improving trend
const TREND_DECLINING_THRESHOLD = -0.05;  // Delta < -0.05 = declining trend

/**
 * Pillar History Management
 *
 * Controls how much historical data is retained and used for trend analysis.
 */
const PILLAR_HISTORY_MIN_FOR_TREND = 4;       // Minimum records needed to compute trend
const PILLAR_HISTORY_RECENT_WINDOW = 5;      // Recent 5 rounds for trend comparison
const PILLAR_HISTORY_OLDER_WINDOW = 10;      // Older 5 rounds (rounds 6-10) for trend baseline
const PILLAR_HISTORY_RETENTION_LIMIT = 200;  // Max history records per agent (circular buffer)

/**
 * Confidence Calculation Parameters
 *
 * Confidence indicates how much data backs the pillar score (0 = no data, 1 = full confidence).
 * Used by UI to show statistical significance of scores.
 */
const CONFIDENCE_CALCULATION_DIVISOR = 20;   // history.length / 20 = confidence (20 rounds = 100%)
const DATA_QUALITY_CALCULATION_DIVISOR = 50; // history.length / 50 = dataQuality (50 rounds = 100%)

/**
 * Top N Display Limits
 *
 * Controls how many top/bottom pillars are shown as strengths/weaknesses in agent profiles.
 */
const TOP_STRENGTHS_LIMIT = 3;    // Top 3 pillars shown as strengths
const TOP_WEAKNESSES_LIMIT = 3;   // Bottom 3 pillars shown as weaknesses

/**
 * Data Quality Thresholds
 *
 * Used by health monitoring to warn about agents with insufficient data.
 */
const DATA_QUALITY_LOW_THRESHOLD = 0.3;        // <30% data quality triggers warning
const PILLAR_CONFIDENCE_MIN_FOR_COVERAGE = 0.3; // Pillar confidence >30% counts as "covered"

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

const agentProfiles = new Map<string, AgentBenchmarkProfile>();
const pillarHistory = new Map<string, { timestamp: number; scores: Record<string, number> }[]>();
let lastRoundId: string | null = null;
let lastRoundTimestamp: string | null = null;
const startTime = Date.now();

// ---------------------------------------------------------------------------
// Grade helpers
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

function detectTrend(history: { timestamp: number; scores: Record<string, number> }[], pillar: string): "improving" | "stable" | "declining" {
  if (history.length < PILLAR_HISTORY_MIN_FOR_TREND) return "stable";
  const recent = history.slice(-PILLAR_HISTORY_RECENT_WINDOW);
  const older = history.slice(-PILLAR_HISTORY_OLDER_WINDOW, -PILLAR_HISTORY_RECENT_WINDOW);
  if (older.length === 0) return "stable";

  const recentAvg = recent.reduce((s, h) => s + (h.scores[pillar] ?? 0), 0) / recent.length;
  const olderAvg = older.reduce((s, h) => s + (h.scores[pillar] ?? 0), 0) / older.length;
  const diff = recentAvg - olderAvg;

  if (diff > TREND_IMPROVING_THRESHOLD) return "improving";
  if (diff < TREND_DECLINING_THRESHOLD) return "declining";
  return "stable";
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Record pillar scores for an agent from a trading round.
 * Called by the orchestrator after all per-round analysis is complete.
 */
export function recordV17Scores(
  agentId: string,
  provider: string,
  model: string,
  scores: Record<string, number>,
  roundId: string,
  tradeCount?: number,
): void {
  lastRoundId = roundId;
  lastRoundTimestamp = new Date().toISOString();

  // Record in history
  const history = pillarHistory.get(agentId) ?? [];
  history.push({ timestamp: Date.now(), scores });
  if (history.length > PILLAR_HISTORY_RETENTION_LIMIT) history.splice(0, history.length - PILLAR_HISTORY_RETENTION_LIMIT);
  pillarHistory.set(agentId, history);

  // Build pillar details
  const pillars: PillarScore[] = Object.entries(V17_PILLAR_WEIGHTS).map(([name, weight]) => {
    const score = clamp(scores[name] ?? 0.5, 0, 1);
    return {
      name,
      score,
      weight,
      components: { raw: scores[name] ?? 0.5 },
      grade: scoreToGrade(score),
      trend: detectTrend(history, name),
      confidence: Math.min(1, (history.length / CONFIDENCE_CALCULATION_DIVISOR)),
    };
  });

  // Compute weighted composite
  const composite = pillars.reduce((sum, p) => sum + p.score * p.weight, 0);

  // Identify strengths (top 3) and weaknesses (bottom 3)
  const sorted = [...pillars].sort((a, b) => b.score - a.score);
  const strengths = sorted.slice(0, TOP_STRENGTHS_LIMIT).map((p) => `${p.name}: ${p.score.toFixed(2)} (${p.grade})`);
  const weaknesses = sorted.slice(-TOP_WEAKNESSES_LIMIT).map((p) => `${p.name}: ${p.score.toFixed(2)} (${p.grade})`);

  const existing = agentProfiles.get(agentId);

  agentProfiles.set(agentId, {
    agentId,
    provider,
    model,
    composite,
    grade: scoreToGrade(composite),
    rank: 0, // Updated in getRankings()
    pillars,
    strengths,
    weaknesses,
    tradeCount: (existing?.tradeCount ?? 0) + (tradeCount ?? 1),
    dataQuality: Math.min(1, (history.length / DATA_QUALITY_CALCULATION_DIVISOR)),
    lastUpdated: new Date().toISOString(),
    eloRating: existing?.eloRating ?? 1500,
    streak: existing?.streak ?? { type: "neutral", length: 0 },
  });
}

/**
 * Update Elo ratings based on pairwise comparisons.
 */
export function updateV17Elo(results: { agentId: string; composite: number }[]): void {
  const K = 32;
  const sorted = [...results].sort((a, b) => b.composite - a.composite);

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = agentProfiles.get(sorted[i].agentId);
      const b = agentProfiles.get(sorted[j].agentId);
      if (!a || !b) continue;

      const expected = 1 / (1 + Math.pow(10, (b.eloRating - a.eloRating) / 400));
      const actual = sorted[i].composite > sorted[j].composite ? 1 : sorted[i].composite === sorted[j].composite ? 0.5 : 0;

      a.eloRating = Math.round(a.eloRating + K * (actual - expected));
      b.eloRating = Math.round(b.eloRating + K * ((1 - actual) - (1 - expected)));
    }
  }

  // Update streaks
  if (sorted.length > 0) {
    const winner = agentProfiles.get(sorted[0].agentId);
    if (winner) {
      if (winner.streak.type === "win") {
        winner.streak.length++;
      } else {
        winner.streak = { type: "win", length: 1 };
      }
    }
    for (let i = 1; i < sorted.length; i++) {
      const loser = agentProfiles.get(sorted[i].agentId);
      if (loser) {
        if (loser.streak.type === "loss") {
          loser.streak.length++;
        } else {
          loser.streak = { type: "loss", length: 1 };
        }
      }
    }
  }
}

/**
 * Get all agent profiles sorted by composite score.
 */
export function getV17Rankings(): AgentBenchmarkProfile[] {
  const profiles = [...agentProfiles.values()].sort((a, b) => b.composite - a.composite);
  profiles.forEach((p, i) => { p.rank = i + 1; });
  return profiles;
}

/**
 * Get a single agent's profile.
 */
export function getV17AgentProfile(agentId: string): AgentBenchmarkProfile | null {
  return agentProfiles.get(agentId) ?? null;
}

/**
 * Get benchmark health report.
 */
export function getV17Health(): BenchmarkHealthReport {
  const profiles = [...agentProfiles.values()];
  const warnings: string[] = [];

  // Check for stale data
  const stalePillars: string[] = [];
  for (const [name] of Object.entries(V17_PILLAR_WEIGHTS)) {
    const hasCoverage = profiles.some((p) => p.pillars.find((pl) => pl.name === name && pl.confidence > PILLAR_CONFIDENCE_MIN_FOR_COVERAGE));
    if (!hasCoverage) stalePillars.push(name);
  }
  if (stalePillars.length > 0) {
    warnings.push(`${stalePillars.length} pillars have insufficient data coverage`);
  }

  // Check for agent data quality
  for (const p of profiles) {
    if (p.dataQuality < DATA_QUALITY_LOW_THRESHOLD) {
      warnings.push(`${p.agentId} has low data quality (${(p.dataQuality * 100).toFixed(0)}%)`);
    }
  }

  const pillarCoverage: Record<string, number> = {};
  for (const name of Object.keys(V17_PILLAR_WEIGHTS)) {
    const covered = profiles.filter((p) => p.pillars.find((pl) => pl.name === name && pl.score > 0)).length;
    pillarCoverage[name] = profiles.length > 0 ? covered / profiles.length : 0;
  }

  return {
    version: "v17",
    totalAgents: profiles.length,
    totalTrades: profiles.reduce((s, p) => s + p.tradeCount, 0),
    avgDataQuality: profiles.length > 0 ? profiles.reduce((s, p) => s + p.dataQuality, 0) / profiles.length : 0,
    pillarCoverage,
    stalePillars,
    lastRoundId,
    lastRoundTimestamp,
    uptime: Date.now() - startTime,
    warnings,
  };
}

/**
 * Export full benchmark payload for HuggingFace or researcher consumption.
 */
export function exportV17Benchmark(): BenchmarkExportPayload {
  const agents = getV17Rankings();
  return {
    metadata: {
      version: "v17",
      exportedAt: new Date().toISOString(),
      totalRecords: agents.reduce((s, a) => s + a.tradeCount, 0),
      agents: agents.map((a) => a.agentId),
      pillarCount: Object.keys(V17_PILLAR_WEIGHTS).length,
    },
    agents,
    health: getV17Health(),
  };
}

/**
 * Get pillar score history for an agent.
 */
export function getV17PillarHistory(agentId: string): { timestamp: number; scores: Record<string, number> }[] {
  return pillarHistory.get(agentId) ?? [];
}
