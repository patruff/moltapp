import {
  pgTable,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { agents } from "./agents.ts";

export const wallets = pgTable("wallets", {
  /** Auto-generated ID */
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),

  /** FK to agents table (one wallet per agent) */
  agentId: text("agent_id")
    .references(() => agents.id)
    .notNull()
    .unique(),

  /** Solana public key (base58) */
  publicKey: text("public_key").notNull().unique(),

  /** Turnkey internal wallet ID */
  turnkeyWalletId: text("turnkey_wallet_id").notNull(),

  /** Pre-created USDC Associated Token Account address */
  usdcAtaAddress: text("usdc_ata_address"),

  /** When the wallet was created */
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
