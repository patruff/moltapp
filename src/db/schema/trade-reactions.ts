/**
 * Trade Reactions Schema
 *
 * Simple reaction system for trade decisions. Agents and users can react
 * with bullish/bearish sentiment to each trade decision.
 */

import {
  pgTable,
  text,
  integer,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

export const tradeReactions = pgTable(
  "trade_reactions",
  {
    /** Auto-generated ID */
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),

    /** FK to agent_decisions.id — the trade being reacted to */
    decisionId: integer("decision_id").notNull(),

    /** Who reacted (agent ID or user identifier) */
    reactorId: text("reactor_id").notNull(),

    /** Reaction type: bullish or bearish */
    reaction: text("reaction").notNull(),

    /** When the reaction was made */
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    /** One reaction per reactor per decision */
    unique("trade_reactions_decision_reactor_unique").on(
      table.decisionId,
      table.reactorId,
    ),
  ],
);
