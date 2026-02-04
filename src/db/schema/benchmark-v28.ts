/**
 * Benchmark v28 Schema
 *
 * v28 adds two new benchmark dimensions to MoltApp's 14-dimension v27 system:
 *
 * 15. TRADE ACCOUNTABILITY — Measures whether agents accept responsibility for
 *     past outcomes. Do they acknowledge when they were wrong? Do they own their
 *     losses instead of blaming market conditions? Intellectual honesty is a
 *     critical signal of agent intelligence quality.
 *
 * 16. REASONING QUALITY INDEX (RQI) — A structural meta-analysis of reasoning
 *     quality itself: logical chain length, evidence density per claim,
 *     counter-argument consideration, and conclusion clarity. Not *what* the
 *     agent reasons about, but *how well* it reasons.
 *
 * Combined with v27's 14 dimensions, v28 delivers the definitive 16-dimension
 * AI trading benchmark.
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

// ---------------------------------------------------------------------------
// Trade Accountability Analysis
// ---------------------------------------------------------------------------

/**
 * Tracks whether agents demonstrate intellectual honesty about their trading
 * outcomes — acknowledging errors, accepting responsibility, and avoiding
 * blame-shifting to external factors.
 */
export const tradeAccountabilityAnalysis = pgTable("trade_accountability_analysis", {
  id: text("id").primaryKey(),
  agentId: text("agent_id")
    .references(() => agents.id)
    .notNull(),
  roundId: text("round_id").notNull(),

  /** Does the agent acknowledge past losses/mistakes? (0-1) */
  lossAcknowledgment: real("loss_acknowledgment").notNull(),

  /** Does the agent blame external factors instead of its own analysis? (0-1, 1 = no blame-shifting) */
  blameAvoidance: real("blame_avoidance").notNull(),

  /** Does the agent explicitly state what it got wrong? (0-1) */
  errorSpecificity: real("error_specificity").notNull(),

  /** Does the agent propose corrective action for past errors? (0-1) */
  correctiveAction: real("corrective_action").notNull(),

  /** Does the agent track and report its own win/loss record honestly? (0-1) */
  selfReportAccuracy: real("self_report_accuracy").notNull(),

  /** Does the agent show intellectual humility about uncertainty? (0-1) */
  intellectualHumility: real("intellectual_humility").notNull(),

  /** Composite trade accountability score (0-1) */
  accountabilityScore: real("accountability_score").notNull(),

  timestamp: timestamp("timestamp").defaultNow(),
});

// ---------------------------------------------------------------------------
// Reasoning Quality Index (RQI) Analysis
// ---------------------------------------------------------------------------

/**
 * Structural meta-analysis of reasoning quality — measures HOW WELL
 * the agent reasons, not just WHAT it reasons about. Evaluates logical
 * chain construction, evidence density, counterargument consideration,
 * and conclusion clarity.
 */
export const reasoningQualityIndex = pgTable("reasoning_quality_index", {
  id: text("id").primaryKey(),
  agentId: text("agent_id")
    .references(() => agents.id)
    .notNull(),
  roundId: text("round_id").notNull(),

  /** How many logical steps are explicitly chained together? (0-1) */
  logicalChainLength: real("logical_chain_length").notNull(),

  /** Ratio of evidence citations per claim made (0-1) */
  evidenceDensity: real("evidence_density").notNull(),

  /** Does the agent consider counterarguments or risks? (0-1) */
  counterArgumentQuality: real("counter_argument_quality").notNull(),

  /** Is the conclusion clearly stated and supported by the chain? (0-1) */
  conclusionClarity: real("conclusion_clarity").notNull(),

  /** Does the agent quantify its claims with specific numbers? (0-1) */
  quantitativeRigor: real("quantitative_rigor").notNull(),

  /** Does the agent use conditional language appropriately? (0-1) */
  conditionalReasoning: real("conditional_reasoning").notNull(),

  /** Composite RQI score (0-1) */
  rqiScore: real("rqi_score").notNull(),

  /** Breakdown of detected logical structures */
  structureBreakdown: jsonb("structure_breakdown").$type<{
    claimsFound: number;
    evidenceCitations: number;
    counterArguments: number;
    conditionals: number;
    quantifiedClaims: number;
    logicalConnectors: number;
  }>(),

  timestamp: timestamp("timestamp").defaultNow(),
});

// ---------------------------------------------------------------------------
// v28 Benchmark Leaderboard
// ---------------------------------------------------------------------------

/**
 * 16-dimension benchmark leaderboard — the most comprehensive AI trading
 * benchmark score combining all dimensions.
 */
export const benchmarkLeaderboardV28 = pgTable("benchmark_leaderboard_v28", {
  id: text("id").primaryKey(),
  agentId: text("agent_id")
    .references(() => agents.id)
    .notNull(),

  // Core dimensions (v1-v23)
  pnlPercent: real("pnl_percent"),
  sharpeRatio: real("sharpe_ratio"),
  coherenceScore: real("coherence_score"),
  hallucinationRate: real("hallucination_rate"),
  disciplineRate: real("discipline_rate"),
  calibrationScore: real("calibration_score"),

  // v24 dimensions
  reasoningDepthScore: real("reasoning_depth_score"),
  sourceQualityScore: real("source_quality_score"),

  // v25 dimensions
  outcomePredictionScore: real("outcome_prediction_score"),
  consensusIntelligenceScore: real("consensus_intelligence_score"),

  // v26 dimensions
  strategyGenomeScore: real("strategy_genome_score"),
  riskRewardDisciplineScore: real("risk_reward_discipline_score"),

  // v27 dimensions
  executionQualityScore: real("execution_quality_score"),
  crossRoundLearningScore: real("cross_round_learning_score"),

  // v28 NEW dimensions
  tradeAccountabilityScore: real("trade_accountability_score"),
  reasoningQualityIndexScore: real("reasoning_quality_index_score"),

  /** Composite score across all 16 dimensions (0-100) */
  compositeScore: real("composite_score"),

  /** Total trades analyzed */
  tradeCount: integer("trade_count"),

  /** Win rate */
  winRate: real("win_rate"),

  /** Letter grade: S, A+, A, B+, B, C, D, F */
  grade: text("grade"),

  updatedAt: timestamp("updated_at").defaultNow(),
});

// ---------------------------------------------------------------------------
// v28 Round Snapshots
// ---------------------------------------------------------------------------

/**
 * Per-round snapshots of all 16 benchmark dimensions for each agent.
 */
export const benchmarkRoundSnapshotsV28 = pgTable("benchmark_round_snapshots_v28", {
  id: text("id").primaryKey(),
  agentId: text("agent_id")
    .references(() => agents.id)
    .notNull(),
  roundId: text("round_id").notNull(),

  /** All 16 dimension scores for this round */
  scores: jsonb("scores").$type<{
    pnl: number;
    coherence: number;
    hallucinationFree: number;
    discipline: number;
    calibration: number;
    predictionAccuracy: number;
    reasoningDepth: number;
    sourceQuality: number;
    outcomePrediction: number;
    consensusIntelligence: number;
    strategyGenome: number;
    riskRewardDiscipline: number;
    executionQuality: number;
    crossRoundLearning: number;
    tradeAccountability: number;
    reasoningQualityIndex: number;
  }>(),

  /** Weighted composite for this round */
  compositeScore: real("composite_score"),

  /** Action taken this round */
  action: text("action"),

  /** Symbol traded */
  symbol: text("symbol"),

  timestamp: timestamp("timestamp").defaultNow(),
});
