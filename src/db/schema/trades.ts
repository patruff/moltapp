import {
  pgTable,
  text,
  integer,
  numeric,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { agents } from "./agents.ts";

export const trades = pgTable("trades", {
  /** Auto-generated ID */
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),

  /** FK to agents table */
  agentId: text("agent_id")
    .references(() => agents.id)
    .notNull(),

  /** Trade side: 'buy' or 'sell' */
  side: text("side").notNull(),

  /** xStocks token mint address */
  stockMintAddress: text("stock_mint_address").notNull(),

  /** Token symbol (e.g., "AAPLx") */
  stockSymbol: text("stock_symbol").notNull(),

  /** Token quantity received/sold (9 decimals) */
  stockQuantity: numeric("stock_quantity", {
    precision: 20,
    scale: 9,
  }).notNull(),

  /** USDC amount spent/received (6 decimals) */
  usdcAmount: numeric("usdc_amount", { precision: 20, scale: 6 }).notNull(),

  /** Execution price per token in USDC (6 decimals) */
  pricePerToken: numeric("price_per_token", {
    precision: 20,
    scale: 6,
  }).notNull(),

  /** Solana transaction signature (idempotency key) */
  txSignature: text("tx_signature").notNull().unique(),

  /** Jupiter route details for debugging/audit */
  jupiterRouteInfo: jsonb("jupiter_route_info"),

  /** Trade status: 'confirmed' or 'failed' */
  status: text("status").notNull().default("confirmed"),

  /** When the trade was recorded */
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
