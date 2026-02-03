/**
 * Strategy Marketplace Schema
 *
 * Database tables for the agent strategy marketplace. Agents can publish
 * trading strategies (entry/exit rules, position sizing, risk parameters),
 * other agents can adopt and rate them, and the system generates real-time
 * trading signals based on strategy parameters.
 *
 * Tables:
 * - strategies: Published trading strategies with parameters, backtest results
 * - strategy_adoptions: Tracks which agents are using which strategies
 * - strategy_ratings: Star ratings and text reviews from agents
 * - strategy_signals: Generated buy/sell/stop signals from strategy rules
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  numeric,
  jsonb,
  boolean,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Types for JSONB columns
// ---------------------------------------------------------------------------

/** Strategy parameters stored as JSONB */
export interface StrategyParameters {
  /** Entry conditions (e.g., RSI < 30, MACD crossover) */
  entryRules: Array<{
    indicator: string;
    condition: string;
    value: number;
    weight: number;
  }>;
  /** Exit conditions (e.g., take profit at 5%, trailing stop at 3%) */
  exitRules: Array<{
    type: "take_profit" | "stop_loss" | "trailing_stop" | "time_based" | "indicator";
    value: number;
    indicator?: string;
    condition?: string;
  }>;
  /** Position sizing rules */
  positionSizing: {
    method: "fixed" | "percent_portfolio" | "kelly" | "risk_parity";
    value: number;
    maxPositionPercent: number;
  };
  /** Risk management */
  riskManagement: {
    maxDrawdownPercent: number;
    maxCorrelation: number;
    maxOpenPositions: number;
    dailyLossLimit: number;
  };
  /** Target symbols or sectors */
  universe?: string[];
  /** Custom parameters specific to the strategy */
  custom?: Record<string, unknown>;
}

/** Backtest result summary stored as JSONB */
export interface BacktestResults {
  period: string;
  totalReturn: number;
  annualizedReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  profitFactor: number;
  totalTrades: number;
  avgTradeReturn: number;
  equityCurve: Array<{ date: string; value: number }>;
  lastRunAt: string;
}

/** Signal metadata stored as JSONB */
export interface SignalMetadata {
  triggerRule: string;
  indicators: Record<string, number>;
  confidence: number;
  reasoning: string;
  expiresAt?: string;
}

// ---------------------------------------------------------------------------
// strategies — Published trading strategies
// ---------------------------------------------------------------------------

/**
 * Published Trading Strategies
 *
 * Each strategy is a set of entry/exit rules, position sizing parameters,
 * and risk management config that any agent can adopt. Strategies can be
 * forked (creating a child with modifications), rated, and tracked for
 * aggregate performance across all adopters.
 */
export const strategies = pgTable("strategies", {
  /** Auto-generated UUID primary key */
  id: text("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),

  /** Agent ID of the strategy creator */
  creatorAgentId: text("creator_agent_id").notNull(),

  /** Strategy display name (e.g., "Momentum Alpha V2") */
  name: text("name").notNull(),

  /** Detailed description of the strategy approach */
  description: text("description").notNull(),

  /** Strategy category classification */
  category: text("category").notNull(),

  /** Full strategy configuration — entry/exit rules, position sizing, risk */
  parameters: jsonb("parameters").notNull().$type<StrategyParameters>(),

  /** Historical backtest performance data */
  backtestResults: jsonb("backtest_results").$type<BacktestResults>(),

  /** Risk level classification */
  riskLevel: text("risk_level").notNull(),

  /** Trading timeframe */
  timeframe: text("timeframe").notNull(),

  /** Version number, incremented on updates */
  version: integer("version").notNull().default(1),

  /** Parent strategy ID if this was forked */
  parentStrategyId: text("parent_strategy_id"),

  /** Whether the strategy is publicly listed in the marketplace */
  isPublic: boolean("is_public").notNull().default(true),

  /** Strategy lifecycle status */
  status: text("status").notNull().default("active"),

  /** Number of agents currently using this strategy */
  totalAdopters: integer("total_adopters").notNull().default(0),

  /** Average star rating (1-5 scale) */
  avgRating: numeric("avg_rating").notNull().default("0"),

  /** Total number of ratings received */
  totalRatings: integer("total_ratings").notNull().default(0),

  /** When the strategy was first published */
  createdAt: timestamp("created_at").defaultNow(),

  /** When the strategy was last updated */
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ---------------------------------------------------------------------------
// strategy_adoptions — Agent strategy usage tracking
// ---------------------------------------------------------------------------

/**
 * Strategy Adoptions
 *
 * Tracks which agents have adopted which strategies, along with their
 * individual performance since adoption and number of trades executed
 * under the strategy.
 */
export const strategyAdoptions = pgTable("strategy_adoptions", {
  /** Auto-generated UUID primary key */
  id: text("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),

  /** FK to strategies.id */
  strategyId: text("strategy_id").notNull(),

  /** Agent ID of the adopter */
  agentId: text("agent_id").notNull(),

  /** Adoption status */
  status: text("status").notNull().default("active"),

  /** When the agent adopted this strategy */
  adoptedAt: timestamp("adopted_at").defaultNow(),

  /** Percentage return since adoption */
  performanceSinceAdoption: numeric("performance_since_adoption").default("0"),

  /** Number of trades executed under this strategy */
  tradesExecuted: integer("trades_executed").default(0),
});

// ---------------------------------------------------------------------------
// strategy_ratings — Star ratings and reviews
// ---------------------------------------------------------------------------

/**
 * Strategy Ratings
 *
 * Agents can rate strategies 1-5 stars with an optional text review.
 * Aggregate rating is maintained on the strategies table for fast reads.
 */
export const strategyRatings = pgTable("strategy_ratings", {
  /** Auto-generated UUID primary key */
  id: text("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),

  /** FK to strategies.id */
  strategyId: text("strategy_id").notNull(),

  /** Agent ID of the rater */
  raterId: text("rater_id").notNull(),

  /** Star rating (1-5) */
  rating: integer("rating").notNull(),

  /** Optional text review */
  review: text("review"),

  /** When the rating was submitted */
  createdAt: timestamp("created_at").defaultNow(),
});

// ---------------------------------------------------------------------------
// strategy_signals — Generated trading signals
// ---------------------------------------------------------------------------

/**
 * Strategy Signals
 *
 * Real-time trading signals generated by applying strategy rules against
 * current market data. Each signal indicates a potential action (entry,
 * exit, scale in/out, stop loss) with direction and strength.
 */
export const strategySignals = pgTable("strategy_signals", {
  /** Auto-generated UUID primary key */
  id: text("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),

  /** FK to strategies.id */
  strategyId: text("strategy_id").notNull(),

  /** Stock symbol the signal applies to */
  symbol: text("symbol").notNull(),

  /** Type of signal generated */
  signalType: text("signal_type").notNull(),

  /** Trade direction */
  direction: text("direction").notNull(),

  /** Signal strength (0-100) */
  strength: integer("strength").notNull(),

  /** Price at signal generation */
  price: numeric("price").notNull(),

  /** Additional signal context */
  metadata: jsonb("metadata").$type<SignalMetadata>(),

  /** When the signal was generated */
  createdAt: timestamp("created_at").defaultNow(),
});
