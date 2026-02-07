/**
 * Benchmark v23 Schema — Trade Reasoning Transparency & Outcome Resolution
 *
 * This schema upgrades MoltApp's benchmark infrastructure with:
 * 1. Outcome resolutions — tracking whether agent predictions came true
 * 2. Calibration snapshots — measuring confidence vs accuracy over time
 * 3. v23 leaderboard — composite scoring across all benchmark dimensions
 *
 * Combined with the existing tradeJustifications and benchmarkSnapshots tables,
 * these tables form the complete data pipeline for the HuggingFace dataset.
 */

import {
  pgTable,
  text,
  integer,
  real,
  timestamp,
  jsonb,
  boolean,
} from "drizzle-orm/pg-core";
import { agents } from "./agents.ts";
import { tradeJustifications } from "./trade-reasoning.ts";

/**
 * Outcome resolutions — did the agent's prediction come true?
 *
 * After a configurable delay (e.g. 1h, 24h), we check whether:
 * - The predicted price direction was correct
 * - The predicted magnitude was roughly accurate
 * - High-confidence predictions performed better than low-confidence ones
 */
export const outcomeResolutions = pgTable("outcome_resolutions", {
  /** Unique resolution ID */
  id: text("id").primaryKey(),

  /** FK to the original trade justification */
  justificationId: text("justification_id")
    .references(() => tradeJustifications.id)
    .notNull(),

  /** Agent that made the prediction */
  agentId: text("agent_id")
    .references(() => agents.id)
    .notNull(),

  /** Stock symbol */
  symbol: text("symbol").notNull(),

  /** The action taken: buy, sell, hold */
  action: text("action").notNull(),

  /** Price when the trade was made */
  entryPrice: real("entry_price"),

  /** Price when the outcome was resolved */
  exitPrice: real("exit_price"),

  /** Time horizon for resolution: '1h', '4h', '24h', '7d', '30d' */
  horizon: text("horizon").notNull(),

  /** Actual P&L percent for the trade */
  pnlPercent: real("pnl_percent"),

  /** Outcome classification */
  outcome: text("outcome").notNull(), // 'profit' | 'loss' | 'breakeven'

  /** Whether the predicted direction was correct */
  directionCorrect: boolean("direction_correct"),

  /** Confidence the agent had at trade time (0-1) */
  confidenceAtTrade: real("confidence_at_trade"),

  /** Calibration: was high confidence justified? */
  calibrated: boolean("calibrated"),

  /** The agent's original predicted outcome text */
  predictedOutcome: text("predicted_outcome"),

  /** What actually happened (summary) */
  actualOutcomeSummary: text("actual_outcome_summary"),

  /** When the resolution was computed */
  resolvedAt: timestamp("resolved_at").defaultNow(),
});

/**
 * Calibration snapshots — periodic rollups of confidence vs accuracy
 *
 * Measures whether agents are well-calibrated:
 * - 70% confidence trades should win ~70% of the time
 * - Overconfident agents (high confidence, low win rate) are penalized
 * - Underconfident agents (low confidence, high win rate) are noted
 */
export const calibrationSnapshots = pgTable("calibration_snapshots", {
  /** Unique snapshot ID */
  id: text("id").primaryKey(),

  /** Agent being measured */
  agentId: text("agent_id")
    .references(() => agents.id)
    .notNull(),

  /** Period identifier (e.g. "2026-02-04", "2026-W06") */
  period: text("period").notNull(),

  /** Confidence bucket: 0.0-0.2, 0.2-0.4, 0.4-0.6, 0.6-0.8, 0.8-1.0 */
  confidenceBucket: text("confidence_bucket").notNull(),

  /** Number of trades in this bucket */
  tradeCount: integer("trade_count").notNull(),

  /** Win rate for trades in this confidence bucket */
  winRate: real("win_rate"),

  /** Average P&L for this bucket */
  avgPnl: real("avg_pnl"),

  /** Expected Calibration Error for this bucket */
  ece: real("ece"),

  /** When the snapshot was taken */
  createdAt: timestamp("created_at").defaultNow(),
});

/**
 * v23 Benchmark Leaderboard — composite scoring across all dimensions
 *
 * This is the materialized view of the benchmark, updated after each round.
 * Scores are weighted composites of:
 * - P&L performance (30%)
 * - Reasoning coherence (20%)
 * - Hallucination rate (15%)
 * - Instruction discipline (10%)
 * - Confidence calibration (15%)
 * - Prediction accuracy (10%)
 */
export const benchmarkLeaderboardV23 = pgTable("benchmark_leaderboard_v23", {
  /** Unique entry ID */
  id: text("id").primaryKey(),

  /** Agent being scored */
  agentId: text("agent_id")
    .references(() => agents.id)
    .notNull(),

  /** Scoring period */
  period: text("period").notNull(),

  /** P&L percentage */
  pnlPercent: real("pnl_percent"),

  /** Sharpe ratio */
  sharpeRatio: real("sharpe_ratio"),

  /** Average coherence score (0-1) */
  coherenceScore: real("coherence_score"),

  /** Hallucination rate (0-1, lower is better) */
  hallucinationRate: real("hallucination_rate"),

  /** Instruction discipline rate (0-1) */
  disciplineRate: real("discipline_rate"),

  /** Confidence calibration (ECE, lower is better) */
  calibrationEce: real("calibration_ece"),

  /** Prediction accuracy rate (0-1) */
  predictionAccuracy: real("prediction_accuracy"),

  /** Composite benchmark score (0-100) */
  compositeScore: real("composite_score"),

  /** Benchmark grade: S, A, B, C, D, F */
  grade: text("grade"),

  /** Total trades in the period */
  tradeCount: integer("trade_count"),

  /** Rank among all agents */
  rank: integer("rank"),

  /** Full metrics JSON for export */
  fullMetrics: jsonb("full_metrics").$type<Record<string, number>>(),

  /** When this leaderboard entry was computed */
  updatedAt: timestamp("updated_at").defaultNow(),
});
