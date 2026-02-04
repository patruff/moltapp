/**
 * Benchmark v25 Schema — Outcome Prediction Engine & Consensus Intelligence
 *
 * v25 extends the benchmark from 8 to 10 dimensions:
 *
 * 1-8: All v24 dimensions (P&L, Coherence, Hallucination, Discipline, Calibration,
 *       Prediction, Depth, Source Quality)
 *
 * 9.  OUTCOME PREDICTION ACCURACY: Tracks what each agent predicted vs what happened.
 *     - Directional accuracy (predicted up, went up)
 *     - Magnitude accuracy (predicted +5%, actual +3%)
 *     - Time-horizon discipline (did agent specify a timeframe?)
 *
 * 10. CONSENSUS INTELLIGENCE: How does the agent behave relative to the group?
 *     - Agreement rate with majority decision
 *     - Contrarian success rate (when agent disagrees and is right)
 *     - Herd behavior detection (blindly following the crowd)
 *     - Independent thinking score
 *
 * These two dimensions complete the MoltApp benchmark as an industry-standard
 * evaluation of AI agent trading intelligence.
 */

import {
  pgTable,
  text,
  integer,
  real,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { agents } from "./agents.ts";
import { tradeJustifications } from "./trade-reasoning.ts";

// ---------------------------------------------------------------------------
// Outcome Prediction Tracking
// ---------------------------------------------------------------------------

/**
 * Per-trade outcome prediction analysis.
 * Tracks what the agent predicted vs what actually happened.
 */
export const outcomePredictionTracking = pgTable("outcome_prediction_tracking_v25", {
  id: text("id").primaryKey(),

  /** FK to trade_justifications */
  justificationId: text("justification_id")
    .references(() => tradeJustifications.id)
    .notNull(),

  /** Agent that made this prediction */
  agentId: text("agent_id")
    .references(() => agents.id)
    .notNull(),

  /** Round identifier */
  roundId: text("round_id").notNull(),

  /** Predicted direction: 'up' | 'down' | 'flat' | 'unspecified' */
  predictedDirection: text("predicted_direction").notNull(),

  /** Actual direction after resolution period */
  actualDirection: text("actual_direction"),

  /** Predicted magnitude (e.g., +5%) — null if not specified */
  predictedMagnitude: real("predicted_magnitude"),

  /** Actual magnitude */
  actualMagnitude: real("actual_magnitude"),

  /** Did the agent specify a timeframe? */
  timeframeSpecified: text("timeframe_specified"),

  /** Directional accuracy: 1 = correct, 0 = wrong, null = unresolved */
  directionalAccuracy: real("directional_accuracy"),

  /** Magnitude accuracy: 0-1 (how close was the predicted % to actual %) */
  magnitudeAccuracy: real("magnitude_accuracy"),

  /** Overall prediction quality score: 0-1 */
  predictionQuality: real("prediction_quality"),

  /** Price at time of prediction */
  priceAtPrediction: real("price_at_prediction"),

  /** Price at resolution */
  priceAtResolution: real("price_at_resolution"),

  /** Symbol being predicted */
  symbol: text("symbol").notNull(),

  /** Status: pending | resolved | expired */
  status: text("status").notNull().default("pending"),

  /** When this prediction was made */
  createdAt: timestamp("created_at").defaultNow(),

  /** When this prediction was resolved */
  resolvedAt: timestamp("resolved_at"),
});

// ---------------------------------------------------------------------------
// Consensus Intelligence
// ---------------------------------------------------------------------------

/**
 * Per-round consensus intelligence analysis.
 * Measures how each agent relates to the group decision.
 */
export const consensusIntelligence = pgTable("consensus_intelligence_v25", {
  id: text("id").primaryKey(),

  /** Round identifier */
  roundId: text("round_id").notNull(),

  /** Agent being analyzed */
  agentId: text("agent_id")
    .references(() => agents.id)
    .notNull(),

  /** The agent's action this round */
  agentAction: text("agent_action").notNull(),

  /** The agent's symbol this round */
  agentSymbol: text("agent_symbol").notNull(),

  /** The majority action this round (what most agents did) */
  majorityAction: text("majority_action").notNull(),

  /** Did this agent agree with the majority? */
  agreedWithMajority: real("agreed_with_majority").notNull(),

  /** Confidence delta: agent's confidence vs group average */
  confidenceDelta: real("confidence_delta"),

  /** Was this agent contrarian (disagreed with majority)? */
  wasContrarian: real("was_contrarian").notNull(),

  /** If contrarian, was the agent right? null if not contrarian or unresolved */
  contrarianSuccess: real("contrarian_success"),

  /** Reasoning similarity to other agents (0 = unique, 1 = identical reasoning) */
  reasoningSimilarity: real("reasoning_similarity").notNull(),

  /** Independent thinking score: high similarity + agreement = herd; low similarity = independent */
  independentThinkingScore: real("independent_thinking_score").notNull(),

  /** Number of agents in this round */
  agentCountInRound: integer("agent_count_in_round").notNull(),

  /** Full consensus breakdown */
  consensusBreakdown: jsonb("consensus_breakdown").$type<{
    actions: Record<string, number>;
    symbols: Record<string, number>;
    avgConfidence: number;
    agreementRate: number;
  }>(),

  /** Round timestamp */
  timestamp: timestamp("timestamp").defaultNow(),
});

// ---------------------------------------------------------------------------
// v25 Leaderboard — 10-Dimension Benchmark
// ---------------------------------------------------------------------------

/**
 * v25 Benchmark Leaderboard — the definitive 10-dimension scoring.
 */
export const benchmarkLeaderboardV25 = pgTable("benchmark_leaderboard_v25", {
  id: text("id").primaryKey(),

  /** Agent being scored */
  agentId: text("agent_id")
    .references(() => agents.id)
    .notNull(),

  /** 10-dimension composite score (0-100) */
  compositeScore: real("composite_score"),

  // --- 10 individual dimension scores ---

  /** D1: P&L return percentage */
  pnlPercent: real("pnl_percent"),

  /** D2: Average reasoning coherence (0-1) */
  avgCoherence: real("avg_coherence"),

  /** D3: Hallucination-free rate (0-1) */
  hallucinationFreeRate: real("hallucination_free_rate"),

  /** D4: Instruction discipline rate (0-1) */
  disciplineRate: real("discipline_rate"),

  /** D5: Confidence calibration (0-1) */
  calibrationScore: real("calibration_score"),

  /** D6: Directional prediction accuracy (0-1) */
  predictionAccuracy: real("prediction_accuracy"),

  /** D7: Average reasoning depth score (0-1) */
  avgReasoningDepth: real("avg_reasoning_depth"),

  /** D8: Average source quality score (0-1) */
  avgSourceQuality: real("avg_source_quality"),

  /** D9: NEW — Outcome prediction quality (0-1) */
  outcomePredictionScore: real("outcome_prediction_score"),

  /** D10: NEW — Consensus intelligence (0-1) */
  consensusIntelligenceScore: real("consensus_intelligence_score"),

  /** Sharpe ratio */
  sharpeRatio: real("sharpe_ratio"),

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
// v25 Round Snapshots — Per-Round 10-Dimension Data
// ---------------------------------------------------------------------------

/**
 * Per-round v25 benchmark data for time-series analysis.
 */
export const benchmarkRoundSnapshotsV25 = pgTable("benchmark_round_snapshots_v25", {
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

  /** Outcome prediction quality for this round */
  outcomePredictionScore: real("outcome_prediction_score"),

  /** Consensus intelligence score for this round */
  consensusScore: real("consensus_score"),

  /** 10-dimension composite for this round */
  roundComposite: real("round_composite"),

  /** Full metrics blob */
  metrics: jsonb("metrics").$type<Record<string, number>>(),

  /** Round timestamp */
  timestamp: timestamp("timestamp").defaultNow(),
});
