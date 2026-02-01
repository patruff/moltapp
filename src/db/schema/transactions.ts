import {
  pgTable,
  text,
  integer,
  numeric,
  timestamp,
} from "drizzle-orm/pg-core";
import { agents } from "./agents.ts";

export const transactions = pgTable("transactions", {
  /** Auto-generated ID */
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),

  /** FK to agents table */
  agentId: text("agent_id")
    .references(() => agents.id)
    .notNull(),

  /** Transaction type: 'deposit' or 'withdrawal' */
  type: text("type").notNull(),

  /** Token type: 'SOL' or 'USDC' */
  tokenType: text("token_type").notNull(),

  /** Amount (SOL has 9 decimals, USDC has 6) */
  amount: numeric("amount", { precision: 20, scale: 9 }).notNull(),

  /** Solana transaction signature (idempotency key) */
  txSignature: text("tx_signature").notNull().unique(),

  /** Transaction status: 'pending' | 'confirmed' | 'failed' */
  status: text("status").notNull().default("pending"),

  /** Destination address (for withdrawals only) */
  destinationAddress: text("destination_address"),

  /** When the transaction record was created */
  createdAt: timestamp("created_at").defaultNow().notNull(),

  /** When the transaction was confirmed on-chain */
  confirmedAt: timestamp("confirmed_at"),
});
