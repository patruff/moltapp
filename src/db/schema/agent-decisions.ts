/**
 * Agent Decisions Schema
 *
 * Records every trading decision made by an AI agent, including their
 * reasoning, confidence level, the model used, and a snapshot of market
 * data at the time of the decision.
 */

import {
  pgTable,
  text,
  integer,
  numeric,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

export const agentDecisions = pgTable("agent_decisions", {
  /** Auto-generated ID */
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),

  /** AI agent identifier (e.g., "claude-value-investor") */
  agentId: text("agent_id").notNull(),

  /** Stock symbol the decision is about */
  symbol: text("symbol").notNull(),

  /** Decision action: buy, sell, or hold */
  action: text("action").notNull(),

  /** Quantity: USDC for buys, shares for sells, 0 for holds */
  quantity: numeric("quantity", { precision: 20, scale: 9 }).notNull(),

  /** The agent's reasoning / analysis */
  reasoning: text("reasoning").notNull(),

  /** Confidence score 0-100 */
  confidence: integer("confidence").notNull(),

  /** The LLM model used for this decision */
  modelUsed: text("model_used").notNull(),

  /** Snapshot of market prices at decision time */
  marketSnapshot: jsonb("market_snapshot"),

  /** Whether the trade was actually executed */
  executed: text("executed").default("pending"),

  /** Execution transaction signature (if executed) */
  txSignature: text("tx_signature"),

  /** Execution error (if failed) */
  executionError: text("execution_error"),

  /** Trading round ID this decision belongs to */
  roundId: text("round_id"),

  /** When the decision was made */
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
