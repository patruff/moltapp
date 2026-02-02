import { env } from "../config/env.ts";
import * as schema from "./schema/index.ts";

const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;

async function createDb() {
  if (isLambda) {
    const { neon } = await import("@neondatabase/serverless");
    const { drizzle } = await import("drizzle-orm/neon-http");
    const sql = neon(env.DATABASE_URL);
    return drizzle({ client: sql });
  } else {
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const pg = await import("pg");
    const pool = new pg.default.Pool({
      connectionString: env.DATABASE_URL,
    });
    return drizzle(pool, { schema });
  }
}

/** Drizzle ORM database instance (Neon HTTP in Lambda, pg Pool locally) */
export const db = await createDb();
