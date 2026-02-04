/**
 * Benchmark V32 Schema — 24-Dimension AI Trading Benchmark
 *
 * Adds Reasoning Grounding Score and Consensus Quality Index
 * to the v31 22-dimension framework, creating the most comprehensive
 * open benchmark for evaluating AI trading agents.
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

/**
 * V32 Trade Grades — individual trade quality assessments with
 * reasoning grounding and consensus quality tracking
 */
export const v32TradeGrades = pgTable("v32_trade_grades", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").references(() => agents.id).notNull(),
  roundId: text("round_id"),
  symbol: text("symbol").notNull(),
  action: text("action").notNull(),
  reasoning: text("reasoning").notNull(),
  confidence: real("confidence").notNull(),
  coherenceScore: real("coherence_score"),
  hallucinationFlags: jsonb("hallucination_flags").$type<string[]>(),
  disciplinePassed: text("discipline_passed").default("true"),
  reasoningDepthScore: real("reasoning_depth_score"),
  sourceQualityScore: real("source_quality_score"),
  logicalConsistencyScore: real("logical_consistency_score"),
  integrityHash: text("integrity_hash"),
  transparencyScore: real("transparency_score"),
  accountabilityScore: real("accountability_score"),
  groundingScore: real("grounding_score"),
  consensusQualityScore: real("consensus_quality_score"),
  predictedOutcome: text("predicted_outcome"),
  actualOutcome: text("actual_outcome"),
  outcomeResolved: text("outcome_resolved").default("pending"),
  overallGrade: text("overall_grade").notNull(),
  gradedAt: timestamp("graded_at").defaultNow(),
});

/**
 * V32 Benchmark Scores — 24-dimension agent scores
 */
export const v32BenchmarkScores = pgTable("v32_benchmark_scores", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").references(() => agents.id).notNull(),
  roundId: text("round_id"),
  // Financial Performance (3 dims)
  pnlPercent: real("pnl_percent"),
  sharpeRatio: real("sharpe_ratio"),
  maxDrawdown: real("max_drawdown"),
  // Reasoning Quality (7 dims — 6 from v31 + grounding)
  coherence: real("coherence"),
  reasoningDepth: real("reasoning_depth"),
  sourceQuality: real("source_quality"),
  logicalConsistency: real("logical_consistency"),
  reasoningIntegrity: real("reasoning_integrity"),
  reasoningTransparency: real("reasoning_transparency"),
  reasoningGrounding: real("reasoning_grounding"),
  // Safety & Trust (3 dims)
  hallucinationRate: real("hallucination_rate"),
  instructionDiscipline: real("instruction_discipline"),
  riskAwareness: real("risk_awareness"),
  // Behavioral Intelligence (4 dims)
  strategyConsistency: real("strategy_consistency"),
  adaptability: real("adaptability"),
  confidenceCalibration: real("confidence_calibration"),
  crossRoundLearning: real("cross_round_learning"),
  // Predictive Power (3 dims)
  outcomeAccuracy: real("outcome_accuracy"),
  marketRegimeAwareness: real("market_regime_awareness"),
  edgeConsistency: real("edge_consistency"),
  // Governance (4 dims — 3 from v31 + consensus quality)
  tradeAccountability: real("trade_accountability"),
  reasoningQualityIndex: real("reasoning_quality_index"),
  decisionAccountability: real("decision_accountability"),
  consensusQuality: real("consensus_quality"),
  // Composite
  compositeScore: real("composite_score"),
  tier: text("tier"),
  tradeCount: integer("trade_count"),
  scoredAt: timestamp("scored_at").defaultNow(),
});

/**
 * V32 Leaderboard — ranked agent scores
 */
export const v32Leaderboard = pgTable("v32_leaderboard", {
  agentId: text("agent_id").references(() => agents.id).primaryKey(),
  agentName: text("agent_name").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  compositeScore: real("composite_score").notNull(),
  tier: text("tier").notNull(),
  tradeCount: integer("trade_count").default(0),
  roundsPlayed: integer("rounds_played").default(0),
  dimensionScores: jsonb("dimension_scores").$type<Record<string, number>>(),
  lastUpdated: timestamp("last_updated").defaultNow(),
});

/**
 * V32 Research Exports — snapshots for HuggingFace datasets
 */
export const v32ResearchExports = pgTable("v32_research_exports", {
  id: text("id").primaryKey(),
  exportType: text("export_type").notNull(),
  agentId: text("agent_id"),
  roundId: text("round_id"),
  data: jsonb("data").$type<Record<string, unknown>>(),
  dimensionCount: integer("dimension_count").default(24),
  version: text("version").default("32.0"),
  exportedAt: timestamp("exported_at").defaultNow(),
});
