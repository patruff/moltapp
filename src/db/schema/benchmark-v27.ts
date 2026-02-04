/**
 * Benchmark v27 Schema
 *
 * v27 adds two new benchmark dimensions to MoltApp's 12-dimension v26 system:
 *
 * 13. EXECUTION QUALITY — Measures how well an agent's trade execution matches
 *     its stated intent. Tracks slippage awareness, timing quality, and whether
 *     the agent's price expectations were realistic.
 *
 * 14. CROSS-ROUND LEARNING — Measures whether agents actually learn from past
 *     trades. Do they adjust strategy after losses? Do they repeat successful
 *     patterns? Tracks reasoning evolution over time.
 *
 * Combined with v26's 12 dimensions, v27 delivers the definitive 14-dimension
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
// Execution Quality Analysis
// ---------------------------------------------------------------------------

/**
 * Tracks how well each agent's trade execution matches its stated intent —
 * slippage awareness, price realism, timing rationale, and market impact.
 */
export const executionQualityAnalysis = pgTable("execution_quality_analysis", {
  id: text("id").primaryKey(),
  agentId: text("agent_id")
    .references(() => agents.id)
    .notNull(),
  roundId: text("round_id").notNull(),

  /** Did the agent mention slippage risk in its reasoning? (0-1) */
  slippageAwareness: real("slippage_awareness").notNull(),

  /** Was the expected execution price realistic given market conditions? (0-1) */
  priceRealism: real("price_realism").notNull(),

  /** Did the agent explain WHY to trade NOW? (0-1) */
  timingRationale: real("timing_rationale").notNull(),

  /** Did the reasoning include a concrete execution plan? (0-1) */
  executionPlanQuality: real("execution_plan_quality").notNull(),

  /** Actual execution price vs expected price (null if no trade executed) */
  actualVsExpectedPrice: real("actual_vs_expected_price"),

  /** Did the agent consider its own market impact? (0-1) */
  marketImpactAwareness: real("market_impact_awareness").notNull(),

  /** Composite execution quality score (0-1) */
  executionQualityScore: real("execution_quality_score").notNull(),

  timestamp: timestamp("timestamp").defaultNow(),
});

// ---------------------------------------------------------------------------
// Cross-Round Learning Analysis
// ---------------------------------------------------------------------------

/**
 * Tracks whether agents learn from past trades — do they reference prior
 * outcomes, avoid repeated mistakes, and evolve their reasoning over time?
 */
export const crossRoundLearning = pgTable("cross_round_learning", {
  id: text("id").primaryKey(),
  agentId: text("agent_id")
    .references(() => agents.id)
    .notNull(),
  roundId: text("round_id").notNull(),

  /** How many past trades does the agent's reasoning reference? */
  referencedPastTrades: integer("referenced_past_trades").notNull(),

  /** Did the agent apply lessons from past outcomes? (0-1) */
  lessonApplication: real("lesson_application").notNull(),

  /** Did the agent avoid repeating past mistakes? (0-1, 1 = no repeats, 0 = exact same mistake again) */
  mistakeRepetition: real("mistake_repetition").notNull(),

  /** How much has the agent's strategy evolved from past rounds? (0-1) */
  strategyAdaptation: real("strategy_adaptation").notNull(),

  /** Did the agent acknowledge past outcomes in its reasoning? (0-1) */
  outcomeIntegration: real("outcome_integration").notNull(),

  /** Has the agent's reasoning quality improved over time? (0-1) */
  reasoningEvolution: real("reasoning_evolution").notNull(),

  /** Composite cross-round learning score (0-1) */
  learningScore: real("learning_score").notNull(),

  /** Which round IDs were referenced in the agent's reasoning */
  previousRoundIds: jsonb("previous_round_ids").$type<string[]>(),

  timestamp: timestamp("timestamp").defaultNow(),
});

// ---------------------------------------------------------------------------
// v27 Benchmark Leaderboard
// ---------------------------------------------------------------------------

/**
 * 14-dimension benchmark leaderboard — the most comprehensive AI trading
 * benchmark score combining all dimensions.
 */
export const benchmarkLeaderboardV27 = pgTable("benchmark_leaderboard_v27", {
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

  // v27 NEW dimensions
  executionQualityScore: real("execution_quality_score"),
  crossRoundLearningScore: real("cross_round_learning_score"),

  /** Composite score across all 14 dimensions (0-100) */
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
// v27 Round Snapshots
// ---------------------------------------------------------------------------

/**
 * Per-round snapshots of all 14 benchmark dimensions for each agent.
 */
export const benchmarkRoundSnapshotsV27 = pgTable("benchmark_round_snapshots_v27", {
  id: text("id").primaryKey(),
  agentId: text("agent_id")
    .references(() => agents.id)
    .notNull(),
  roundId: text("round_id").notNull(),

  /** All 14 dimension scores for this round */
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
  }>(),

  /** Weighted composite for this round */
  compositeScore: real("composite_score"),

  /** Action taken this round */
  action: text("action"),

  /** Symbol traded */
  symbol: text("symbol"),

  timestamp: timestamp("timestamp").defaultNow(),
});
