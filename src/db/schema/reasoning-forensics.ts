/**
 * Reasoning Forensics Schema (v11)
 *
 * Deep forensic analysis of agent reasoning over time.
 * Tracks reasoning evolution, detects degradation patterns,
 * and stores cross-trade integrity violations.
 *
 * This is the "audit backbone" of the benchmark — every reasoning
 * artifact is stored for post-hoc researcher analysis.
 */

import {
  pgTable,
  text,
  real,
  integer,
  timestamp,
  jsonb,
  boolean,
} from "drizzle-orm/pg-core";
import { agents } from "./agents.ts";

/**
 * Reasoning forensic reports — deep per-trade analysis stored for researchers.
 * Each trade gets a forensic breakdown beyond the basic coherence score.
 */
export const reasoningForensicReports = pgTable("reasoning_forensic_reports", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").references(() => agents.id).notNull(),
  roundId: text("round_id").notNull(),
  tradeAction: text("trade_action").notNull(),
  symbol: text("symbol").notNull(),

  // Structural analysis
  sentenceCount: integer("sentence_count"),
  avgSentenceLength: real("avg_sentence_length"),
  quantitativeClaimCount: integer("quantitative_claim_count"),
  hedgeWordCount: integer("hedge_word_count"),
  causalConnectorCount: integer("causal_connector_count"),

  // Reasoning depth dimensions
  valuationMentioned: boolean("valuation_mentioned").default(false),
  technicalMentioned: boolean("technical_mentioned").default(false),
  fundamentalMentioned: boolean("fundamental_mentioned").default(false),
  macroMentioned: boolean("macro_mentioned").default(false),
  sentimentMentioned: boolean("sentiment_mentioned").default(false),
  riskMentioned: boolean("risk_mentioned").default(false),
  catalystMentioned: boolean("catalyst_mentioned").default(false),
  portfolioContextMentioned: boolean("portfolio_context_mentioned").default(false),

  // Quality metrics
  coherenceScore: real("coherence_score"),
  depthScore: real("depth_score"),
  originalityScore: real("originality_score"),
  clarityScore: real("clarity_score"),
  compositeForensicScore: real("composite_forensic_score"),

  // Cross-trade flags
  similarToPrevious: boolean("similar_to_previous").default(false),
  contradictsPrevious: boolean("contradicts_previous").default(false),
  previousTradeId: text("previous_trade_id"),

  // Full analysis blob
  fullAnalysis: jsonb("full_analysis").$type<Record<string, unknown>>(),

  createdAt: timestamp("created_at").defaultNow(),
});

/**
 * Reasoning integrity violations — cross-trade consistency failures.
 * Detects flip-flops, copypasta, confidence drift, etc.
 */
export const reasoningIntegrityViolations = pgTable("reasoning_integrity_violations", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").references(() => agents.id).notNull(),
  violationType: text("violation_type").notNull(), // flip_flop, copypasta, confidence_drift, source_fabrication, regression
  severity: text("severity").notNull(), // low, medium, high, critical
  description: text("description").notNull(),
  evidence: jsonb("evidence").$type<Record<string, unknown>>(),
  roundId: text("round_id"),
  relatedTradeIds: jsonb("related_trade_ids").$type<string[]>(),
  penaltyApplied: real("penalty_applied"),
  createdAt: timestamp("created_at").defaultNow(),
});

/**
 * Agent reasoning health — rolling aggregate of forensic metrics per agent.
 * Updated after each trade for fast dashboard queries.
 */
export const agentReasoningHealth = pgTable("agent_reasoning_health", {
  agentId: text("agent_id").references(() => agents.id).primaryKey(),
  windowSize: integer("window_size").default(50),
  avgCoherence: real("avg_coherence"),
  avgDepth: real("avg_depth"),
  avgOriginality: real("avg_originality"),
  avgClarity: real("avg_clarity"),
  compositeHealth: real("composite_health"),
  integrityScore: real("integrity_score"),
  totalViolations: integer("total_violations").default(0),
  trend: text("trend"), // improving, degrading, stable
  trendDelta: real("trend_delta"),
  lastUpdated: timestamp("last_updated").defaultNow(),
});
