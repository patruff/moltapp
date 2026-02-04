/**
 * Benchmark v26 Schema
 *
 * v26 adds two new benchmark dimensions to MoltApp's 10-dimension v25 system:
 *
 * 11. STRATEGY GENOME — Measures how consistent an agent's trading strategy is
 *     across trades. Does the agent stick to its declared style (value, momentum,
 *     contrarian) or drift randomly? Tracks strategy DNA fingerprint per round.
 *
 * 12. RISK-REWARD DISCIPLINE — Measures whether agents properly assess and
 *     manage risk/reward ratios. Do they size positions appropriately for the
 *     confidence level? Do they set mental stop-losses? Is the expected reward
 *     proportional to risk taken?
 *
 * Combined with v25's 10 dimensions, v26 delivers the definitive 12-dimension
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
// Strategy Genome Analysis
// ---------------------------------------------------------------------------

/**
 * Tracks each agent's strategy DNA — a fingerprint of their trading approach
 * measured across multiple dimensions over time.
 */
export const strategyGenomeAnalysis = pgTable("strategy_genome_analysis", {
  id: text("id").primaryKey(),
  agentId: text("agent_id")
    .references(() => agents.id)
    .notNull(),
  roundId: text("round_id").notNull(),

  /** How closely this trade matches the agent's declared style (0-1) */
  styleConsistencyScore: real("style_consistency_score").notNull(),

  /** Drift from the agent's historical average strategy vector (0-1, lower=more consistent) */
  strategyDrift: real("strategy_drift").notNull(),

  /** The dominant strategy pattern detected: value, momentum, contrarian, etc. */
  detectedStrategy: text("detected_strategy").notNull(),

  /** Agent's declared strategy for comparison */
  declaredStrategy: text("declared_strategy").notNull(),

  /** Strategy DNA vector: a normalized fingerprint of trading approach */
  strategyDna: jsonb("strategy_dna").$type<{
    valueWeight: number;
    momentumWeight: number;
    contrarianWeight: number;
    hedgeWeight: number;
    arbitrageWeight: number;
    meanReversionWeight: number;
  }>(),

  /** Historical average DNA vector for drift comparison */
  historicalAvgDna: jsonb("historical_avg_dna").$type<{
    valueWeight: number;
    momentumWeight: number;
    contrarianWeight: number;
    hedgeWeight: number;
    arbitrageWeight: number;
    meanReversionWeight: number;
  }>(),

  /** Number of trades in the analysis window */
  tradeWindowSize: integer("trade_window_size"),

  /** Composite genome score: consistency * (1 - drift) */
  genomeScore: real("genome_score").notNull(),

  timestamp: timestamp("timestamp").defaultNow(),
});

// ---------------------------------------------------------------------------
// Risk-Reward Discipline Analysis
// ---------------------------------------------------------------------------

/**
 * Tracks each trade's risk-reward discipline — does the agent properly
 * assess risk vs. potential reward and size positions accordingly?
 */
export const riskRewardDiscipline = pgTable("risk_reward_discipline", {
  id: text("id").primaryKey(),
  agentId: text("agent_id")
    .references(() => agents.id)
    .notNull(),
  roundId: text("round_id").notNull(),

  /** Position size relative to portfolio (%) */
  positionSizePercent: real("position_size_percent").notNull(),

  /** Agent's confidence level for this trade (0-1) */
  confidence: real("confidence").notNull(),

  /** Does position size scale with confidence? (0-1) */
  sizingDisciplineScore: real("sizing_discipline_score").notNull(),

  /** Implied risk-reward ratio from reasoning analysis */
  impliedRiskReward: real("implied_risk_reward"),

  /** Whether the agent mentioned a stop-loss or risk boundary */
  hasRiskBoundary: integer("has_risk_boundary").notNull(),

  /** Whether the agent specified a profit target */
  hasProfitTarget: integer("has_profit_target").notNull(),

  /** Risk awareness score: mentions of risk, downside, stop-loss (0-1) */
  riskAwarenessScore: real("risk_awareness_score").notNull(),

  /** Whether cash buffer was maintained per agent config */
  cashBufferMaintained: integer("cash_buffer_maintained").notNull(),

  /** Portfolio concentration after trade (Herfindahl index) */
  portfolioConcentration: real("portfolio_concentration"),

  /** Composite risk-reward discipline score (0-1) */
  disciplineScore: real("discipline_score").notNull(),

  timestamp: timestamp("timestamp").defaultNow(),
});

// ---------------------------------------------------------------------------
// v26 Benchmark Leaderboard
// ---------------------------------------------------------------------------

/**
 * 12-dimension benchmark leaderboard — the most comprehensive AI trading
 * benchmark score combining all dimensions.
 */
export const benchmarkLeaderboardV26 = pgTable("benchmark_leaderboard_v26", {
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

  // v26 NEW dimensions
  strategyGenomeScore: real("strategy_genome_score"),
  riskRewardDisciplineScore: real("risk_reward_discipline_score"),

  /** Composite score across all 12 dimensions (0-100) */
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
// v26 Round Snapshots
// ---------------------------------------------------------------------------

/**
 * Per-round snapshots of all 12 benchmark dimensions for each agent.
 */
export const benchmarkRoundSnapshotsV26 = pgTable("benchmark_round_snapshots_v26", {
  id: text("id").primaryKey(),
  agentId: text("agent_id")
    .references(() => agents.id)
    .notNull(),
  roundId: text("round_id").notNull(),

  /** All 12 dimension scores for this round */
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
  }>(),

  /** Weighted composite for this round */
  compositeScore: real("composite_score"),

  /** Action taken this round */
  action: text("action"),

  /** Symbol traded */
  symbol: text("symbol"),

  timestamp: timestamp("timestamp").defaultNow(),
});
