/**
 * Benchmark V37 Schema — 34-Dimension AI Trading Benchmark
 *
 * Extends v36's 32-dimension framework with two new dimensions:
 *
 * Reasoning Synthesis Quality (new): Can the agent synthesize information from
 * multiple heterogeneous sources into a unified, coherent thesis? Measures
 * cross-source integration, conflicting data reconciliation, multi-modal
 * reasoning (price + volume + news + sentiment), evidence weighting, and
 * synthesis originality. Agents that parrot a single source score poorly.
 *
 * Strategic Foresight (new): Does the agent reason about second- and third-order
 * effects, not just immediate price direction? Measures scenario planning depth,
 * cascading effect awareness, portfolio-level thinking, opportunity cost analysis,
 * and position sizing rationale. Agents that only say "price will go up" without
 * strategic context score poorly.
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
 * V37 Trade Grades — individual trade quality assessments with
 * reasoning synthesis quality and strategic foresight tracking
 */
export const v37TradeGrades = pgTable("v37_trade_grades", {
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
  // v36 dimensions
  marketMicrostructureScore: real("market_microstructure_score"),
  convictionConsistencyScore: real("conviction_consistency_score"),
  // NEW v37 dimensions
  reasoningSynthesisScore: real("reasoning_synthesis_score"),
  strategicForesightScore: real("strategic_foresight_score"),
  predictedOutcome: text("predicted_outcome"),
  actualOutcome: text("actual_outcome"),
  outcomeResolved: text("outcome_resolved").default("pending"),
  overallGrade: text("overall_grade").notNull(),
  gradedAt: timestamp("graded_at").defaultNow(),
});

/**
 * V37 Benchmark Scores — 34-dimension agent scores
 */
export const v37BenchmarkScores = pgTable("v37_benchmark_scores", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").references(() => agents.id).notNull(),
  roundId: text("round_id"),
  // Financial Performance (3 dims)
  pnlPercent: real("pnl_percent"),
  sharpeRatio: real("sharpe_ratio"),
  maxDrawdown: real("max_drawdown"),
  // Reasoning Quality (17 dims — 15 from v36 + synthesis + foresight)
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
  reasoningSynthesisQuality: real("reasoning_synthesis_quality"),
  strategicForesight: real("strategic_foresight"),
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
 * V37 Leaderboard — ranked agent scores
 */
export const v37Leaderboard = pgTable("v37_leaderboard", {
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
 * V37 Research Exports — snapshots for HuggingFace datasets
 */
export const v37ResearchExports = pgTable("v37_research_exports", {
  id: text("id").primaryKey(),
  exportType: text("export_type").notNull(),
  agentId: text("agent_id"),
  roundId: text("round_id"),
  data: jsonb("data").$type<Record<string, unknown>>(),
  dimensionCount: integer("dimension_count").default(34),
  version: text("version").default("37.0"),
  exportedAt: timestamp("exported_at").defaultNow(),
});
