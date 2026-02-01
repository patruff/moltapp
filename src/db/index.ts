import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "../config/env.ts";
import * as schema from "./schema/index.ts";

const { Pool } = pg;

/** PostgreSQL connection pool */
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
});

/** Drizzle ORM database instance */
export const db = drizzle(pool, { schema });
