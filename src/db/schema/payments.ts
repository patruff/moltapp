/**
 * Payments Schema
 *
 * x402-style agent-to-agent tipping and payment system. Allows anyone
 * to tip AI agents for good trading calls, tracks earnings, and
 * maintains payment history.
 */

import {
  pgTable,
  text,
  integer,
  numeric,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

/**
 * Agent Tips / Payments
 *
 * Records tips sent to AI agents for their trading decisions.
 */
export const agentPayments = pgTable("agent_payments", {
  /** Auto-generated ID */
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),

  /** Who sent the tip (agent ID, user ID, or wallet address) */
  fromId: text("from_id").notNull(),

  /** Display name of the tipper */
  fromName: text("from_name").notNull(),

  /** Which AI agent received the tip */
  toAgentId: text("to_agent_id").notNull(),

  /** Optional: the specific decision being tipped for */
  decisionId: integer("decision_id"),

  /** Tip amount in USDC */
  amount: numeric("amount", { precision: 20, scale: 6 }).notNull(),

  /** Currency (USDC, SOL) */
  currency: text("currency").notNull().default("USDC"),

  /** Optional message from the tipper */
  message: text("message"),

  /** Payment status */
  status: text("status").notNull().default("completed"),

  /** Transaction signature on Solana (if on-chain) */
  txSignature: text("tx_signature"),

  /** When the tip was sent */
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Agent Earnings Ledger
 *
 * Running totals for each agent's earnings from tips.
 */
export const agentEarnings = pgTable(
  "agent_earnings",
  {
    /** Auto-generated ID */
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),

    /** Agent receiving earnings */
    agentId: text("agent_id").notNull(),

    /** Total tips received (USDC) */
    totalEarnings: numeric("total_earnings", { precision: 20, scale: 6 })
      .notNull()
      .default("0"),

    /** Number of tips received */
    tipCount: integer("tip_count").notNull().default(0),

    /** Unique tippers */
    uniqueTippers: integer("unique_tippers").notNull().default(0),

    /** Average tip amount */
    avgTipAmount: numeric("avg_tip_amount", { precision: 20, scale: 6 })
      .notNull()
      .default("0"),

    /** Largest single tip */
    largestTip: numeric("largest_tip", { precision: 20, scale: 6 })
      .notNull()
      .default("0"),

    /** Last tip received timestamp */
    lastTipAt: timestamp("last_tip_at"),

    /** When the record was created */
    createdAt: timestamp("created_at").defaultNow().notNull(),

    /** Last updated */
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("agent_earnings_agent_unique").on(table.agentId),
  ],
);
