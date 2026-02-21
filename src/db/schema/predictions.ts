/**
 * Prediction Market Schema
 *
 * Enables AI agents to make structured, verifiable market predictions with
 * confidence scores, time horizons, and resolution logic. Users and agents
 * can bet for/against predictions using virtual tokens. An AMM (Automated
 * Market Maker) dynamically adjusts odds based on pool sizes.
 *
 * Tables:
 *   predictions         — Individual agent predictions (price targets, direction calls)
 *   prediction_bets     — Wagers placed for/against a prediction
 *   prediction_markets  — AMM pool state and odds for each prediction
 */

import {
  pgTable,
  text,
  integer,
  numeric,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// predictions — Core prediction records
// ---------------------------------------------------------------------------

/**
 * A single prediction made by an AI agent.
 *
 * Each prediction specifies a market outlook (direction, target, horizon)
 * along with the agent's confidence and reasoning. Predictions are resolved
 * automatically when they expire or when a resolution check is triggered.
 */
export const predictions = pgTable("predictions", {
  /** UUID primary key */
  id: text("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),

  /** The AI agent that authored this prediction */
  agentId: text("agent_id").notNull(),

  /** Stock symbol the prediction is about (e.g. "AAPLx", "NVDAx") */
  symbol: text("symbol").notNull(),

  /**
   * Type of prediction:
   *   price_target — agent predicts a specific price level
   *   direction    — agent predicts up/down/flat movement
   *   volatility   — agent predicts high/low volatility
   *   outperform   — agent predicts relative outperformance
   */
  predictionType: text("prediction_type").notNull(),

  /**
   * Directional outlook:
   *   bullish  — price expected to rise
   *   bearish  — price expected to fall
   *   neutral  — price expected to stay flat
   */
  direction: text("direction").notNull(),

  /** Predicted target price (nullable — not all prediction types need one) */
  targetPrice: numeric("target_price", { precision: 20, scale: 6 }),

  /** Market price at the moment the prediction was created */
  currentPriceAtCreation: numeric("current_price_at_creation", {
    precision: 20,
    scale: 6,
  }).notNull(),

  /**
   * Time horizon for the prediction:
   *   1h — one hour
   *   4h — four hours
   *   1d — one day
   *   1w — one week
   *   1m — one month
   */
  timeHorizon: text("time_horizon").notNull(),

  /** Agent confidence 0-100 (higher = more conviction) */
  confidence: integer("confidence").notNull(),

  /** Agent's reasoning / analysis behind this prediction */
  reasoning: text("reasoning").notNull(),

  /**
   * Prediction lifecycle status:
   *   active             — open and tradeable
   *   resolved_correct   — prediction was right
   *   resolved_incorrect — prediction was wrong
   *   expired            — time ran out without explicit resolution
   *   cancelled          — voided (e.g. data error)
   */
  status: text("status").notNull().default("active"),

  /** Timestamp when the prediction was resolved (null while active) */
  resolvedAt: timestamp("resolved_at"),

  /** Actual market price at resolution time */
  resolutionPrice: numeric("resolution_price", { precision: 20, scale: 6 }),

  /** Human-readable explanation of how the prediction was graded */
  resolutionDetails: text("resolution_details"),

  /** When the prediction was created */
  createdAt: timestamp("created_at").defaultNow().notNull(),

  /** Deadline — prediction must resolve by this time */
  expiresAt: timestamp("expires_at").notNull(),
});

// ---------------------------------------------------------------------------
// prediction_bets — Individual wagers
// ---------------------------------------------------------------------------

/**
 * A single bet placed on a prediction.
 *
 * Bettors can wager virtual tokens "for" (prediction will be correct) or
 * "against" (prediction will be incorrect). Odds are locked at placement
 * time, and payouts are computed on resolution.
 */
export const predictionBets = pgTable("prediction_bets", {
  /** UUID primary key */
  id: text("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),

  /** FK to the prediction being bet on */
  predictionId: text("prediction_id").notNull(),

  /** Who placed this bet (agent ID or user ID) */
  bettorId: text("bettor_id").notNull(),

  /**
   * Bettor classification:
   *   agent — an AI trading agent
   *   user  — a human user
   */
  bettorType: text("bettor_type").notNull(),

  /**
   * Bet position:
   *   for     — bettor thinks the prediction will be correct
   *   against — bettor thinks the prediction will be wrong
   */
  position: text("position").notNull(),

  /** Virtual token amount wagered */
  amount: numeric("amount", { precision: 20, scale: 6 }).notNull(),

  /** Odds at the time this bet was placed (locked in) */
  odds: numeric("odds", { precision: 10, scale: 4 }).notNull(),

  /** Calculated payout (null until prediction resolves) */
  payout: numeric("payout", { precision: 20, scale: 6 }),

  /**
   * Bet lifecycle status:
   *   active    — prediction still open
   *   won       — bettor's position was correct
   *   lost      — bettor's position was wrong
   *   cancelled — voided (prediction cancelled)
   */
  status: text("status").notNull().default("active"),

  /** When the bet was placed */
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// prediction_markets — AMM pool state
// ---------------------------------------------------------------------------

/**
 * Market state for a prediction's betting pool.
 *
 * Uses an Automated Market Maker model where odds are derived from the
 * ratio of tokens in the "for" and "against" pools. As bets shift the
 * pool balance, odds adjust dynamically — similar to how Polymarket or
 * Augur work, but simplified.
 *
 * Formula:
 *   oddsFor     = totalPool / forPool     (payout multiplier for "for" bets)
 *   oddsAgainst = totalPool / againstPool (payout multiplier for "against" bets)
 */
export const predictionMarkets = pgTable("prediction_markets", {
  /** UUID primary key */
  id: text("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),

  /** FK to the prediction this market is for (1:1 relationship) */
  predictionId: text("prediction_id").notNull(),

  /** Total virtual tokens in the pool (forPool + againstPool) */
  totalPool: numeric("total_pool", { precision: 20, scale: 6 })
    .notNull()
    .default("0"),

  /** Tokens wagered on "for" (prediction correct) */
  forPool: numeric("for_pool", { precision: 20, scale: 6 })
    .notNull()
    .default("0"),

  /** Tokens wagered on "against" (prediction incorrect) */
  againstPool: numeric("against_pool", { precision: 20, scale: 6 })
    .notNull()
    .default("0"),

  /** Current payout multiplier for "for" bets */
  currentOddsFor: numeric("current_odds_for", { precision: 10, scale: 4 })
    .notNull()
    .default("1.0"),

  /** Current payout multiplier for "against" bets */
  currentOddsAgainst: numeric("current_odds_against", {
    precision: 10,
    scale: 4,
  })
    .notNull()
    .default("1.0"),

  /** Total number of bets placed on this market */
  totalBets: integer("total_bets").notNull().default(0),

  /**
   * Market status:
   *   open     — accepting bets
   *   closed   — no new bets (e.g. approaching expiry)
   *   resolved — prediction resolved, payouts distributed
   */
  status: text("status").notNull().default("open"),

  /** When the market was created */
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
