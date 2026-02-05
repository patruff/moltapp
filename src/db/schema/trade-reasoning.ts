/**
 * Trade Reasoning Schema
 *
 * Every trade on MoltApp MUST include structured reasoning data.
 * This is the core of our AI benchmark — we don't just measure P&L,
 * we measure HOW agents think, whether their logic is coherent,
 * and whether they hallucinate market data.
 *
 * Benchmark pillars measured:
 * - reasoning_coherence: Does the agent's logic match its action?
 * - hallucination_rate: Does the agent fabricate prices or facts?
 * - instruction_discipline: Does the agent respect trading rules?
 * - confidence_calibration: Is high confidence correlated with good outcomes?
 */

import {
  pgTable,
  text,
  integer,
  real,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { trades } from "./trades.ts";
import { agents } from "./agents.ts";

/**
 * Trade justifications — the reasoning behind every trade decision.
 * Linked 1:1 with trades, but also stores rejected/hold decisions
 * for complete benchmark coverage.
 */
export const tradeJustifications = pgTable("trade_justifications", {
  /** Unique ID: trade_{timestamp}_{random} */
  id: text("id").primaryKey(),

  /** FK to trades table (null for hold decisions that didn't execute) */
  tradeId: integer("trade_id").references(() => trades.id),

  /** Agent that made this decision */
  agentId: text("agent_id")
    .references(() => agents.id)
    .notNull(),

  /** Step-by-step reasoning the agent provided */
  reasoning: text("reasoning").notNull(),

  /** Agent's self-reported confidence: 0.0 to 1.0 */
  confidence: real("confidence").notNull(),

  /** Data sources the agent cited in its reasoning */
  sources: jsonb("sources").$type<string[]>(),

  /** Complete tool call trace for full audit trail */
  toolTrace: jsonb("tool_trace").$type<{
    turn: number;
    tool: string;
    arguments: Record<string, any>;
    result: string;
    timestamp: string;
  }[]>(),

  /** Model used for this decision (e.g., claude-opus-4-5-20251101) */
  modelUsed: text("model_used"),

  /** Trading intent classification */
  intent: text("intent").notNull(),

  /** What the agent predicted would happen */
  predictedOutcome: text("predicted_outcome"),

  /** What actually happened (filled by outcome tracker) */
  actualOutcome: text("actual_outcome"),

  /** Coherence score: does reasoning match the action? 0.0 to 1.0 */
  coherenceScore: real("coherence_score"),

  /** Hallucination flags: factual errors found in reasoning */
  hallucinationFlags: jsonb("hallucination_flags").$type<string[]>(),

  /** The action taken: buy, sell, hold */
  action: text("action").notNull(),

  /** Stock symbol */
  symbol: text("symbol").notNull(),

  /** Quantity traded */
  quantity: real("quantity"),

  /** Trading round ID */
  roundId: text("round_id"),

  /** Whether instruction discipline was maintained */
  disciplinePass: text("discipline_pass").default("pending"),

  /** When the justification was recorded */
  timestamp: timestamp("timestamp").defaultNow(),
});

/**
 * Benchmark snapshots — periodic aggregation of benchmark metrics
 * for the HuggingFace dataset and public leaderboard.
 */
export const benchmarkSnapshots = pgTable("benchmark_snapshots", {
  /** Unique snapshot ID */
  id: text("id").primaryKey(),

  /** Agent being measured */
  agentId: text("agent_id")
    .references(() => agents.id)
    .notNull(),

  /** Snapshot period (e.g., "2026-02-04", "2026-W06") */
  period: text("period").notNull(),

  /** P&L percentage for the period */
  pnlPercent: real("pnl_percent"),

  /** Sharpe ratio for the period */
  sharpeRatio: real("sharpe_ratio"),

  /** Average coherence score across all trades */
  avgCoherence: real("avg_coherence"),

  /** Hallucination rate: flagged_trades / total_trades */
  hallucinationRate: real("hallucination_rate"),

  /** Instruction discipline rate */
  disciplineRate: real("discipline_rate"),

  /** Total number of trades in the period */
  tradeCount: integer("trade_count"),

  /** Win rate for the period */
  winRate: real("win_rate"),

  /** Confidence calibration: correlation(confidence, outcome) */
  confidenceCalibration: real("confidence_calibration"),

  /** Full metrics blob for HuggingFace */
  fullMetrics: jsonb("full_metrics").$type<Record<string, number>>(),

  /** When the snapshot was taken */
  createdAt: timestamp("created_at").defaultNow(),
});
