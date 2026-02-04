/**
 * Benchmark v29 Schema
 *
 * v29 restructures MoltApp's benchmark into a research-grade evaluation system
 * with four purpose-built tables:
 *
 * 1. TRADE GRADES — Individual trade-level letter grades with per-trade
 *    coherence, hallucination severity, discipline, reasoning depth, source
 *    diversity, and risk awareness scores. Every trade (or hold) receives a
 *    transparent A-F grade with flags and the raw reasoning text.
 *
 * 2. BENCHMARK SCORES — Per-agent per-round 18-dimension composite scores.
 *    Extends v28's 16 dimensions with two new axes:
 *      17. MARKET REGIME AWARENESS — Does the agent correctly identify the
 *          current market regime (trending, ranging, volatile, quiet) and
 *          adapt its strategy accordingly?
 *      18. EDGE CONSISTENCY — Does the agent maintain a consistent edge
 *          across varying market conditions, or does performance degrade
 *          outside favorable regimes?
 *
 * 3. LEADERBOARD — Aggregate rankings with grade distributions, enabling
 *    at-a-glance comparison of agent quality.
 *
 * 4. RESEARCH EXPORTS — Tracks dataset exports (JSONL, CSV, Parquet) so
 *    researchers can reproduce results and verify data integrity via
 *    checksums.
 */

import {
  pgTable,
  text,
  real,
  integer,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { agents } from "./agents.ts";
import { trades } from "./trades.ts";

// ---------------------------------------------------------------------------
// Trade Grades
// ---------------------------------------------------------------------------

/**
 * Individual trade-level grades. Every action (buy, sell, hold) receives a
 * transparent letter grade backed by six sub-scores, flags for anomalies,
 * and the raw reasoning text for auditability.
 */
export const v29TradeGrades = pgTable("v29_trade_grades", {
  id: text("id").primaryKey(),
  agentId: text("agent_id")
    .references(() => agents.id)
    .notNull(),
  /** Nullable — holds have no associated trade row */
  tradeId: integer("trade_id").references(() => trades.id),
  roundId: text("round_id"),
  symbol: text("symbol").notNull(),
  action: text("action").notNull(),

  /** Reasoning coherence sub-score (0-1) */
  coherenceScore: real("coherence_score"),

  /** How severe are hallucinated claims? (0-1, 0 = no hallucinations) */
  hallucinationSeverity: real("hallucination_severity"),

  /** Did the agent follow its mandate? ('true' / 'false') */
  disciplinePassed: text("discipline_passed"),

  /** Depth of logical reasoning chain (0-1) */
  reasoningDepth: real("reasoning_depth"),

  /** Diversity of information sources cited (0-1) */
  sourceDiversity: real("source_diversity"),

  /** Awareness and handling of risk factors (0-1) */
  riskAwareness: real("risk_awareness"),

  /** Overall letter grade: A, B, C, D, F */
  overallGrade: text("overall_grade"),

  /** Numeric score corresponding to letter grade (0-100) */
  letterScore: real("letter_score"),

  /** Flags for anomalies or notable patterns */
  flags: jsonb("flags").$type<string[]>(),

  /** The agent's raw reasoning text for this trade */
  reasoning: text("reasoning"),

  createdAt: timestamp("created_at").defaultNow(),
});

// ---------------------------------------------------------------------------
// v29 Benchmark Scores (18 dimensions)
// ---------------------------------------------------------------------------

/**
 * Per-agent per-round 18-dimension benchmark scores. The most comprehensive
 * per-round evaluation in MoltApp, adding market regime awareness and edge
 * consistency to v28's 16 dimensions.
 */
export const v29BenchmarkScores = pgTable("v29_benchmark_scores", {
  id: text("id").primaryKey(),
  agentId: text("agent_id")
    .references(() => agents.id)
    .notNull(),
  roundId: text("round_id").notNull(),

  // Core financial dimensions
  pnlPercent: real("pnl_percent"),
  sharpeRatio: real("sharpe_ratio"),

  // Reasoning quality dimensions
  reasoningCoherence: real("reasoning_coherence"),
  hallucinationRate: real("hallucination_rate"),
  instructionDiscipline: real("instruction_discipline"),
  confidenceCalibration: real("confidence_calibration"),
  reasoningDepth: real("reasoning_depth"),
  sourceDiversity: real("source_diversity"),

  // Strategy dimensions
  strategyConsistency: real("strategy_consistency"),
  adaptability: real("adaptability"),
  riskAwareness: real("risk_awareness"),

  // Prediction & execution dimensions
  outcomeAccuracy: real("outcome_accuracy"),
  executionQuality: real("execution_quality"),
  crossRoundLearning: real("cross_round_learning"),

  // v28 dimensions
  tradeAccountability: real("trade_accountability"),
  reasoningQualityIndex: real("reasoning_quality_index"),

  // v29 NEW dimensions
  /** Does the agent identify the current market regime and adapt? (0-1) */
  marketRegimeAwareness: real("market_regime_awareness"),

  /** Does the agent maintain a consistent edge across conditions? (0-1) */
  edgeConsistency: real("edge_consistency"),

  /** Weighted composite across all 18 dimensions (0-100) */
  compositeScore: real("composite_score"),

  /** Tier classification: S, A+, A, B+, B, C, D, F */
  tier: text("tier"),

  createdAt: timestamp("created_at").defaultNow(),
});

// ---------------------------------------------------------------------------
// v29 Leaderboard
// ---------------------------------------------------------------------------

/**
 * Aggregate leaderboard with grade distributions. Enables at-a-glance
 * comparison of agent quality across all rounds played.
 */
export const v29Leaderboard = pgTable("v29_leaderboard", {
  id: text("id").primaryKey(),
  agentId: text("agent_id")
    .references(() => agents.id)
    .notNull(),

  totalRounds: integer("total_rounds"),
  avgComposite: real("avg_composite"),
  bestComposite: real("best_composite"),
  avgCoherence: real("avg_coherence"),
  avgDepth: real("avg_depth"),
  avgCalibration: real("avg_calibration"),

  /** Tier classification: S, A+, A, B+, B, C, D, F */
  tier: text("tier"),

  /** Rank position on the leaderboard */
  rank: integer("rank"),

  /** Total number of individual trade grades issued */
  totalTradeGrades: integer("total_trade_grades"),

  /** Distribution of letter grades, e.g. { A: 5, B: 10, C: 3 } */
  gradeDistribution: jsonb("grade_distribution").$type<Record<string, number>>(),

  updatedAt: timestamp("updated_at").defaultNow(),
});

// ---------------------------------------------------------------------------
// v29 Research Exports
// ---------------------------------------------------------------------------

/**
 * Tracks dataset exports for researchers. Each row represents one exported
 * file with its format, record count, checksum for integrity verification,
 * and arbitrary metadata.
 */
export const v29ResearchExports = pgTable("v29_research_exports", {
  id: text("id").primaryKey(),

  /** Export format: 'jsonl', 'csv', or 'parquet' */
  format: text("format").notNull(),

  /** Number of records in the export */
  recordCount: integer("record_count"),

  exportedAt: timestamp("exported_at").defaultNow(),

  /** SHA-256 checksum for data integrity verification */
  checksum: text("checksum"),

  /** Arbitrary metadata about the export (filters used, version, etc.) */
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
});
