import {
  pgTable,
  text,
  integer,
  numeric,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { agents } from "./agents.ts";

export const positions = pgTable(
  "positions",
  {
    /** Auto-generated ID */
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),

    /** FK to agents table */
    agentId: text("agent_id")
      .references(() => agents.id)
      .notNull(),

    /** xStocks token mint address */
    mintAddress: text("mint_address").notNull(),

    /** Token symbol (e.g., "AAPLx") */
    symbol: text("symbol").notNull(),

    /** Token quantity (9 decimals for precision) */
    quantity: numeric("quantity", { precision: 20, scale: 9 }).notNull(),

    /** Average cost basis in USDC per token (6 decimals) */
    averageCostBasis: numeric("average_cost_basis", {
      precision: 20,
      scale: 6,
    }).notNull(),

    /** When the position was first opened */
    createdAt: timestamp("created_at").defaultNow().notNull(),

    /** When the position was last updated (buy/sell) */
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    /** One position per agent per stock token */
    unique("positions_agent_mint_unique").on(table.agentId, table.mintAddress),
  ],
);
