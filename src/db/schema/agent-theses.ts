import {
  pgTable,
  text,
  integer,
  numeric,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

/**
 * Agent Investment Theses
 *
 * Persists each agent's investment theses across trading rounds.
 * Agents create/update theses when they research a stock, and close
 * them when their conviction changes or the position is exited.
 */
export const agentTheses = pgTable(
  "agent_theses",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),

    /** Which agent owns this thesis */
    agentId: text("agent_id").notNull(),

    /** Stock symbol (e.g. "AAPLx") */
    symbol: text("symbol").notNull(),

    /** Free-text thesis: why the agent is bullish/bearish */
    thesis: text("thesis").notNull(),

    /** Conviction level 1-10 */
    conviction: integer("conviction").notNull().default(5),

    /** Direction: bullish / bearish / neutral */
    direction: text("direction").notNull().default("neutral"),

    /** Entry price when thesis was formed */
    entryPrice: numeric("entry_price", { precision: 20, scale: 9 }),

    /** Target price the agent expects */
    targetPrice: numeric("target_price", { precision: 20, scale: 9 }),

    /** active / closed / revised */
    status: text("status").notNull().default("active"),

    /** Why the thesis was closed */
    closedReason: text("closed_reason"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("agent_theses_active_unique").on(
      table.agentId,
      table.symbol,
      table.status,
    ),
  ],
);
