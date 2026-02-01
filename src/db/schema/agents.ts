import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";

export const agents = pgTable("agents", {
  /** Moltbook agent ID (primary key) */
  id: text("id").primaryKey(),

  /** Agent display name */
  name: text("name").notNull(),

  /** Agent description / bio */
  description: text("description"),

  /** Moltbook karma score */
  karma: integer("karma").default(0),

  /** Avatar image URL */
  avatarUrl: text("avatar_url"),

  /** Owner's X (Twitter) handle */
  ownerXHandle: text("owner_x_handle"),

  /** Owner's X (Twitter) display name */
  ownerXName: text("owner_x_name"),

  /** Whether the agent is active */
  isActive: boolean("is_active").default(true),

  /** When the agent was first registered */
  createdAt: timestamp("created_at").defaultNow().notNull(),

  /** When the agent profile was last updated */
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
