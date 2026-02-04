/**
 * Benchmark V35 Schema — 30-Dimension AI Trading Benchmark
 *
 * Extends v34's 28-dimension framework with two new dimensions:
 *
 * Information Asymmetry Detection (new): Does the agent recognize and
 * exploit informational advantages or disadvantages in the market?
 * Measures whether the agent identifies when it has superior or
 * inferior information relative to the market consensus, adjusts
 * position sizing accordingly, and avoids overconfidence when
 * operating with incomplete data. Agents that trade aggressively
 * without acknowledging information gaps score poorly.
 *
 * Temporal Reasoning Quality (new): Does the agent correctly reason
 * about time-dependent factors in its trading decisions? Measures
 * the agent's ability to distinguish short-term noise from long-term
 * trends, appropriately weight recent vs. historical data, account
 * for time-decay in signal relevance, and maintain consistent
 * time-horizon alignment in its reasoning. Agents that conflate
 * timeframes or ignore temporal context score poorly.
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
 * V35 Trade Grades — individual trade quality assessments with
 * information asymmetry detection and temporal reasoning tracking
 */
export const v35TradeGrades = pgTable("v35_trade_grades", {
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
  // NEW v35 dimensions
  informationAsymmetryScore: real("information_asymmetry_score"),
  temporalReasoningScore: real("temporal_reasoning_score"),
  predictedOutcome: text("predicted_outcome"),
  actualOutcome: text("actual_outcome"),
  outcomeResolved: text("outcome_resolved").default("pending"),
  overallGrade: text("overall_grade").notNull(),
  gradedAt: timestamp("graded_at").defaultNow(),
});

/**
 * V35 Benchmark Scores — 30-dimension agent scores
 */
export const v35BenchmarkScores = pgTable("v35_benchmark_scores", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").references(() => agents.id).notNull(),
  roundId: text("round_id"),
  // Financial Performance (3 dims)
  pnlPercent: real("pnl_percent"),
  sharpeRatio: real("sharpe_ratio"),
  maxDrawdown: real("max_drawdown"),
  // Reasoning Quality (13 dims — 11 from v34 + information asymmetry + temporal reasoning)
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
 * V35 Leaderboard — ranked agent scores
 */
export const v35Leaderboard = pgTable("v35_leaderboard", {
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
 * V35 Research Exports — snapshots for HuggingFace datasets
 */
export const v35ResearchExports = pgTable("v35_research_exports", {
  id: text("id").primaryKey(),
  exportType: text("export_type").notNull(),
  agentId: text("agent_id"),
  roundId: text("round_id"),
  data: jsonb("data").$type<Record<string, unknown>>(),
  dimensionCount: integer("dimension_count").default(30),
  version: text("version").default("35.0"),
  exportedAt: timestamp("exported_at").defaultNow(),
});
