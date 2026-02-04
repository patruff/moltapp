/**
 * Benchmark V36 Schema — 32-Dimension AI Trading Benchmark
 *
 * Extends v35's 30-dimension framework with two new dimensions:
 *
 * Market Microstructure Quality (new): Does the agent understand execution
 * mechanics like bid-ask spreads, order book depth, slippage, liquidity,
 * and market impact? Agents that discuss execution quality, slippage risk,
 * and order flow score highly. Agents that ignore execution mechanics and
 * only focus on price direction score poorly.
 *
 * Conviction Consistency (new): Does the agent's stated confidence match
 * the depth and quality of its reasoning? High confidence with shallow
 * reasoning is inconsistent. Low confidence with deep, well-sourced
 * reasoning is also inconsistent. The ideal is calibrated conviction:
 * confidence proportional to evidence quality.
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
 * V36 Trade Grades — individual trade quality assessments with
 * market microstructure quality and conviction consistency tracking
 */
export const v36TradeGrades = pgTable("v36_trade_grades", {
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
  causalReasoningScore: real("causal_reasoning_score"),
  epistemicHumilityScore: real("epistemic_humility_score"),
  reasoningTraceabilityScore: real("reasoning_traceability_score"),
  adversarialCoherenceScore: real("adversarial_coherence_score"),
  informationAsymmetryScore: real("information_asymmetry_score"),
  temporalReasoningScore: real("temporal_reasoning_score"),
  // NEW v36 dimensions
  marketMicrostructureScore: real("market_microstructure_score"),
  convictionConsistencyScore: real("conviction_consistency_score"),
  predictedOutcome: text("predicted_outcome"),
  actualOutcome: text("actual_outcome"),
  outcomeResolved: text("outcome_resolved").default("pending"),
  overallGrade: text("overall_grade").notNull(),
  gradedAt: timestamp("graded_at").defaultNow(),
});

/**
 * V36 Benchmark Scores — 32-dimension agent scores
 */
export const v36BenchmarkScores = pgTable("v36_benchmark_scores", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").references(() => agents.id).notNull(),
  roundId: text("round_id"),
  // Financial Performance (3 dims)
  pnlPercent: real("pnl_percent"),
  sharpeRatio: real("sharpe_ratio"),
  maxDrawdown: real("max_drawdown"),
  // Reasoning Quality (15 dims — 13 from v35 + microstructure + conviction consistency)
  coherence: real("coherence"),
  reasoningDepth: real("reasoning_depth"),
  sourceQuality: real("source_quality"),
  logicalConsistency: real("logical_consistency"),
  reasoningIntegrity: real("reasoning_integrity"),
  reasoningTransparency: real("reasoning_transparency"),
  reasoningGrounding: real("reasoning_grounding"),
  causalReasoning: real("causal_reasoning"),
  epistemicHumility: real("epistemic_humility"),
  reasoningTraceability: real("reasoning_traceability"),
  adversarialCoherence: real("adversarial_coherence"),
  informationAsymmetry: real("information_asymmetry"),
  temporalReasoningQuality: real("temporal_reasoning_quality"),
  marketMicrostructureQuality: real("market_microstructure_quality"),
  convictionConsistency: real("conviction_consistency"),
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
  // Governance (4 dims)
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
 * V36 Leaderboard — ranked agent scores
 */
export const v36Leaderboard = pgTable("v36_leaderboard", {
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
 * V36 Research Exports — snapshots for HuggingFace datasets
 */
export const v36ResearchExports = pgTable("v36_research_exports", {
  id: text("id").primaryKey(),
  exportType: text("export_type").notNull(),
  agentId: text("agent_id"),
  roundId: text("round_id"),
  data: jsonb("data").$type<Record<string, unknown>>(),
  dimensionCount: integer("dimension_count").default(32),
  version: text("version").default("36.0"),
  exportedAt: timestamp("exported_at").defaultNow(),
});
