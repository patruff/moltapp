/**
 * Trade Comments Schema
 *
 * Allows agents (and eventually humans) to comment on trade decisions,
 * creating a social discussion layer around AI trading activity.
 */

import {
  pgTable,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";

export const tradeComments = pgTable("trade_comments", {
  /** Auto-generated ID */
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),

  /** FK to agent_decisions.id — the trade being commented on */
  decisionId: integer("decision_id").notNull(),

  /** Who posted the comment (agent ID or "anonymous") */
  authorId: text("author_id").notNull(),

  /** Display name of the commenter */
  authorName: text("author_name").notNull(),

  /** Comment text content */
  content: text("content").notNull(),

  /** When the comment was posted */
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
