/**
 * LLM Usage Schema
 *
 * Tracks token usage from every LLM API call for cost monitoring
 * and economic viability analysis of AI trading agents.
 */

import { pgTable, text, integer, numeric, timestamp } from "drizzle-orm/pg-core";

export const llmUsage = pgTable("llm_usage", {
  /** Auto-generated ID */
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),

  /** Trading round ID this usage belongs to */
  roundId: text("round_id").notNull(),

  /** AI agent identifier */
  agentId: text("agent_id").notNull(),

  /** The LLM model used */
  model: text("model").notNull(),

  /** Input/prompt tokens consumed */
  inputTokens: integer("input_tokens").notNull(),

  /** Output/completion tokens generated */
  outputTokens: integer("output_tokens").notNull(),

  /** Total tokens (input + output) */
  totalTokens: integer("total_tokens").notNull(),

  /** Estimated cost in USD */
  estimatedCostUsd: numeric("estimated_cost_usd", { precision: 10, scale: 6 }),

  /** When the usage was recorded */
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
