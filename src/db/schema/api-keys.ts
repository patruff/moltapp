import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { agents } from "./agents.ts";

export const apiKeys = pgTable("api_keys", {
  /** Auto-generated ID */
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),

  /** FK to agents table */
  agentId: text("agent_id")
    .references(() => agents.id)
    .notNull(),

  /** SHA-256 hash of the API key (never store raw keys) */
  keyHash: text("key_hash").notNull().unique(),

  /** First 12 chars of the full key for identification (e.g., "mk_abc123...") */
  keyPrefix: text("key_prefix").notNull(),

  /** Whether this key has been revoked */
  isRevoked: boolean("is_revoked").default(false),

  /** Last time this key was used */
  lastUsedAt: timestamp("last_used_at"),

  /** When the key was issued */
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
