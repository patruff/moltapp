/**
 * Benchmark V34 Schema — 28-Dimension AI Trading Benchmark
 *
 * Extends v33's 26-dimension framework with two new dimensions:
 *
 * Reasoning Traceability (new): Can each claim in the agent's reasoning
 * be traced back to a cited data source? Measures source-attribution
 * density, claim-source pairing, orphan claim detection, and evidence
 * chain completeness. Agents that make assertions without grounding
 * them in referenced data score poorly.
 *
 * Adversarial Coherence (new): Does the agent's reasoning hold up when
 * evaluated against contrary market signals? Measures whether the agent
 * acknowledges counterarguments, addresses opposing indicators, handles
 * conflicting data gracefully, and maintains logical coherence despite
 * mixed signals. Agents that ignore contradictory evidence score poorly.
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
 * V34 Trade Grades — individual trade quality assessments with
 * reasoning traceability and adversarial coherence tracking
 */
export const v34TradeGrades = pgTable("v34_trade_grades", {
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
  // NEW v34 dimensions
  reasoningTraceabilityScore: real("reasoning_traceability_score"),
  adversarialCoherenceScore: real("adversarial_coherence_score"),
  predictedOutcome: text("predicted_outcome"),
  actualOutcome: text("actual_outcome"),
  outcomeResolved: text("outcome_resolved").default("pending"),
  overallGrade: text("overall_grade").notNull(),
  gradedAt: timestamp("graded_at").defaultNow(),
});

/**
 * V34 Benchmark Scores — 28-dimension agent scores
 */
export const v34BenchmarkScores = pgTable("v34_benchmark_scores", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").references(() => agents.id).notNull(),
  roundId: text("round_id"),
  // Financial Performance (3 dims)
  pnlPercent: real("pnl_percent"),
  sharpeRatio: real("sharpe_ratio"),
  maxDrawdown: real("max_drawdown"),
  // Reasoning Quality (11 dims — 9 from v33 + traceability + adversarial coherence)
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
 * V34 Leaderboard — ranked agent scores
 */
export const v34Leaderboard = pgTable("v34_leaderboard", {
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
 * V34 Research Exports — snapshots for HuggingFace datasets
 */
export const v34ResearchExports = pgTable("v34_research_exports", {
  id: text("id").primaryKey(),
  exportType: text("export_type").notNull(),
  agentId: text("agent_id"),
  roundId: text("round_id"),
  data: jsonb("data").$type<Record<string, unknown>>(),
  dimensionCount: integer("dimension_count").default(28),
  version: text("version").default("34.0"),
  exportedAt: timestamp("exported_at").defaultNow(),
});
