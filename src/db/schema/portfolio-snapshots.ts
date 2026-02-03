/**
 * Portfolio Snapshots Schema
 *
 * Persists point-in-time portfolio state for each agent. Snapshots are taken
 * after every trading round so we can reconstruct historical equity curves,
 * track P&L over time, and provide audit-grade portfolio history.
 *
 * One row per agent per trading round (or scheduled checkpoint).
 */

import {
  pgTable,
  text,
  integer,
  numeric,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

export const portfolioSnapshots = pgTable("portfolio_snapshots", {
  /** Auto-generated ID */
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),

  /** AI agent identifier */
  agentId: text("agent_id").notNull(),

  /** Trading round that triggered this snapshot (null for scheduled) */
  roundId: text("round_id"),

  /** Snapshot trigger type */
  trigger: text("trigger").notNull().default("round_end"),

  /** Cash balance in USDC */
  cashBalance: numeric("cash_balance", { precision: 20, scale: 6 }).notNull(),

  /** Total value of stock positions in USDC */
  positionsValue: numeric("positions_value", { precision: 20, scale: 6 }).notNull(),

  /** Total portfolio value (cash + positions) */
  totalValue: numeric("total_value", { precision: 20, scale: 6 }).notNull(),

  /** Cumulative P&L since inception */
  totalPnl: numeric("total_pnl", { precision: 20, scale: 6 }).notNull(),

  /** Cumulative P&L percentage */
  totalPnlPercent: numeric("total_pnl_percent", { precision: 10, scale: 4 }).notNull(),

  /** Number of open positions */
  positionCount: integer("position_count").notNull(),

  /** Detailed position breakdown at snapshot time */
  positions: jsonb("positions").notNull(),

  /** Snapshot timestamp */
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const competitionScores = pgTable("competition_scores", {
  /** Auto-generated ID */
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),

  /** AI agent identifier */
  agentId: text("agent_id").notNull(),

  /** Trading round this score belongs to */
  roundId: text("round_id").notNull(),

  /** Score for this individual round */
  roundScore: numeric("round_score", { precision: 10, scale: 4 }).notNull(),

  /** Cumulative score across all rounds */
  cumulativeScore: numeric("cumulative_score", { precision: 12, scale: 4 }).notNull(),

  /** Agent rank after this round */
  rank: integer("rank").notNull(),

  /** Scoring breakdown (P&L, Sharpe, win rate components) */
  breakdown: jsonb("breakdown").notNull(),

  /** Scored timestamp */
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
