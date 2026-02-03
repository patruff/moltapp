/**
 * Copy Trading Schema
 *
 * Enables users/agents to "follow" an AI trading agent and track performance
 * as if they had copied every trade. Stores follower relationships, virtual
 * copy portfolios, and performance snapshots.
 */

import {
  pgTable,
  text,
  integer,
  numeric,
  timestamp,
  unique,
  jsonb,
} from "drizzle-orm/pg-core";

/**
 * Copy Trading Followers
 *
 * Tracks who is following which AI agent. Each follower has a virtual
 * portfolio that mirrors the agent's decisions.
 */
export const copyFollowers = pgTable(
  "copy_followers",
  {
    /** Auto-generated ID */
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),

    /** Who is following (agent ID, user ID, or anonymous session) */
    followerId: text("follower_id").notNull(),

    /** Display name for the follower */
    followerName: text("follower_name").notNull(),

    /** Which AI agent they're copying */
    targetAgentId: text("target_agent_id").notNull(),

    /** Virtual starting capital for copy portfolio */
    initialCapital: numeric("initial_capital", {
      precision: 20,
      scale: 6,
    })
      .notNull()
      .default("10000"),

    /** Current virtual cash balance */
    currentCash: numeric("current_cash", { precision: 20, scale: 6 })
      .notNull()
      .default("10000"),

    /** Total portfolio value (cash + positions at current prices) */
    portfolioValue: numeric("portfolio_value", {
      precision: 20,
      scale: 6,
    })
      .notNull()
      .default("10000"),

    /** Total P&L since following */
    totalPnl: numeric("total_pnl", { precision: 20, scale: 6 })
      .notNull()
      .default("0"),

    /** Total P&L percentage */
    totalPnlPercent: numeric("total_pnl_percent", {
      precision: 10,
      scale: 4,
    })
      .notNull()
      .default("0"),

    /** Number of trades copied */
    tradesCopied: integer("trades_copied").notNull().default(0),

    /** Virtual positions (JSONB array of { symbol, quantity, avgCost }) */
    positions: jsonb("positions").default("[]"),

    /** Whether this follow is active */
    isActive: text("is_active").notNull().default("true"),

    /** When the follow started */
    createdAt: timestamp("created_at").defaultNow().notNull(),

    /** Last portfolio update */
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    /** One active follow per follower per agent */
    unique("copy_follower_agent_unique").on(
      table.followerId,
      table.targetAgentId,
    ),
  ],
);

/**
 * Copy Trade Log
 *
 * Records each trade that was virtually copied from an AI agent.
 */
export const copyTrades = pgTable("copy_trades", {
  /** Auto-generated ID */
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),

  /** FK to copy_followers */
  followerId: text("follower_id").notNull(),

  /** The AI agent that made the original decision */
  sourceAgentId: text("source_agent_id").notNull(),

  /** The original decision ID this was copied from */
  sourceDecisionId: integer("source_decision_id").notNull(),

  /** Action: buy, sell, or hold */
  action: text("action").notNull(),

  /** Stock symbol */
  symbol: text("symbol").notNull(),

  /** Virtual quantity */
  quantity: numeric("quantity", { precision: 20, scale: 9 }).notNull(),

  /** Virtual price at time of copy */
  price: numeric("price", { precision: 20, scale: 6 }).notNull(),

  /** Virtual P&L on this trade (for sells) */
  tradePnl: numeric("trade_pnl", { precision: 20, scale: 6 }).default("0"),

  /** Agent's original confidence */
  confidence: integer("confidence").notNull(),

  /** Agent's original reasoning */
  reasoning: text("reasoning").notNull(),

  /** When the copy was executed */
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
