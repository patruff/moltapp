/**
 * Benchmark v24 Schema — Reasoning Depth & Source Quality Engine
 *
 * v24 adds two new benchmark dimensions beyond v23:
 *
 * 1. REASONING DEPTH SCORE: How structured and deep is the agent's reasoning?
 *    - Step count, logical connectives, evidence anchoring, counter-argument awareness
 *    - Scored 0-1 with sub-dimensions
 *
 * 2. SOURCE QUALITY SCORE: How well does the agent use its data sources?
 *    - Source diversity, recency, specificity, cross-referencing
 *    - Scored 0-1 with sub-dimensions
 *
 * Combined with v23's 6 dimensions, v24 has 8 benchmark dimensions:
 *   P&L | Coherence | Hallucination | Discipline | Calibration | Prediction | Depth | Source Quality
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

// ---------------------------------------------------------------------------
// Reasoning Depth Analysis
// ---------------------------------------------------------------------------

/**
 * Per-trade reasoning depth analysis.
 * Measures how structured, logical, and thorough an agent's reasoning is.
 */
export const reasoningDepthAnalysis = pgTable("reasoning_depth_analysis_v24", {
  id: text("id").primaryKey(),

  /** FK to trade_justifications */
  justificationId: text("justification_id")
    .references(() => tradeJustifications.id)
    .notNull(),

  /** Agent that produced this reasoning */
  agentId: text("agent_id")
    .references(() => agents.id)
    .notNull(),

  /** Overall depth score: 0.0 to 1.0 */
  depthScore: real("depth_score").notNull(),

  /** Number of distinct reasoning steps identified */
  stepCount: integer("step_count").notNull(),

  /** Logical connective density (therefore, because, however, ...) per sentence */
  connectiveDensity: real("connective_density").notNull(),

  /** Does the reasoning reference specific data points from the prompt? 0-1 */
  evidenceAnchoringScore: real("evidence_anchoring_score").notNull(),

  /** Does the reasoning consider counter-arguments or risks? 0-1 */
  counterArgumentScore: real("counter_argument_score").notNull(),

  /** Does the reasoning have a clear conclusion that matches the action? 0-1 */
  conclusionClarity: real("conclusion_clarity").notNull(),

  /** Word count of reasoning text */
  wordCount: integer("word_count").notNull(),

  /** Unique vocabulary size (type-token ratio proxy) */
  vocabularyRichness: real("vocabulary_richness").notNull(),

  /** Detected reasoning pattern */
  reasoningPattern: text("reasoning_pattern").notNull(),

  /** When this analysis was performed */
  analyzedAt: timestamp("analyzed_at").defaultNow(),
});

// ---------------------------------------------------------------------------
// Source Quality Analysis
// ---------------------------------------------------------------------------

/**
 * Per-trade source quality analysis.
 * Measures how well the agent uses and cites its data sources.
 */
export const sourceQualityAnalysis = pgTable("source_quality_analysis_v24", {
  id: text("id").primaryKey(),

  /** FK to trade_justifications */
  justificationId: text("justification_id")
    .references(() => tradeJustifications.id)
    .notNull(),

  /** Agent that produced this reasoning */
  agentId: text("agent_id")
    .references(() => agents.id)
    .notNull(),

  /** Overall source quality score: 0.0 to 1.0 */
  qualityScore: real("quality_score").notNull(),

  /** Number of distinct sources cited */
  sourceCount: integer("source_count").notNull(),

  /** How diverse are the source types? 0-1 */
  diversityScore: real("diversity_score").notNull(),

  /** Are sources mentioned with specific values/data? 0-1 */
  specificityScore: real("specificity_score").notNull(),

  /** Does the reasoning cross-reference multiple sources? 0-1 */
  crossReferenceScore: real("cross_reference_score").notNull(),

  /** Are data points from sources actually used in the argument? 0-1 */
  integrationScore: real("integration_score").notNull(),

  /** List of source categories detected */
  sourceCategories: jsonb("source_categories").$type<string[]>(),

  /** When this analysis was performed */
  analyzedAt: timestamp("analyzed_at").defaultNow(),
});

// ---------------------------------------------------------------------------
// v24 Leaderboard
// ---------------------------------------------------------------------------

/**
 * v24 Benchmark Leaderboard — 8-dimension composite scoring.
 */
export const benchmarkLeaderboardV24 = pgTable("benchmark_leaderboard_v24", {
  id: text("id").primaryKey(),

  /** Agent being scored */
  agentId: text("agent_id")
    .references(() => agents.id)
    .notNull(),

  /** 8-dimension composite score (0-100) */
  compositeScore: real("composite_score"),

  // --- Individual dimension scores (all 0-1 except pnlPercent) ---

  /** P&L return percentage */
  pnlPercent: real("pnl_percent"),

  /** Sharpe ratio */
  sharpeRatio: real("sharpe_ratio"),

  /** Average reasoning coherence */
  avgCoherence: real("avg_coherence"),

  /** Hallucination-free rate (1 - hallucination_rate) */
  hallucinationFreeRate: real("hallucination_free_rate"),

  /** Instruction discipline rate */
  disciplineRate: real("discipline_rate"),

  /** Confidence calibration (lower ECE = better) */
  calibrationScore: real("calibration_score"),

  /** Directional prediction accuracy */
  predictionAccuracy: real("prediction_accuracy"),

  /** NEW v24: Average reasoning depth score */
  avgReasoningDepth: real("avg_reasoning_depth"),

  /** NEW v24: Average source quality score */
  avgSourceQuality: real("avg_source_quality"),

  /** Total trades analyzed */
  tradeCount: integer("trade_count"),

  /** Leaderboard rank (1 = best) */
  rank: integer("rank"),

  /** Grade: S / A / B / C / D / F */
  grade: text("grade"),

  /** Last updated */
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ---------------------------------------------------------------------------
// v24 Round Snapshots
// ---------------------------------------------------------------------------

/**
 * Per-round v24 benchmark data for time-series analysis.
 */
export const benchmarkRoundSnapshotsV24 = pgTable("benchmark_round_snapshots_v24", {
  id: text("id").primaryKey(),

  /** Round identifier */
  roundId: text("round_id").notNull(),

  /** Agent being measured */
  agentId: text("agent_id")
    .references(() => agents.id)
    .notNull(),

  /** Action taken this round */
  action: text("action").notNull(),

  /** Symbol traded */
  symbol: text("symbol").notNull(),

  /** Coherence score for this round */
  coherenceScore: real("coherence_score"),

  /** Reasoning depth score for this round */
  depthScore: real("depth_score"),

  /** Source quality score for this round */
  sourceQualityScore: real("source_quality_score"),

  /** Hallucination flags count */
  hallucinationCount: integer("hallucination_count"),

  /** Confidence reported */
  confidence: real("confidence"),

  /** 8-dimension composite for this round */
  roundComposite: real("round_composite"),

  /** Full metrics blob */
  metrics: jsonb("metrics").$type<Record<string, number>>(),

  /** Round timestamp */
  timestamp: timestamp("timestamp").defaultNow(),
});
