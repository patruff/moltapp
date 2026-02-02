// Production migration script for Neon PostgreSQL
// Usage: NEON_DATABASE_URL="postgresql://..." npx tsx scripts/migrate-production.ts

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

const databaseUrl = process.env.NEON_DATABASE_URL;
if (!databaseUrl) {
  console.error("NEON_DATABASE_URL environment variable is required");
  console.error(
    "Usage: NEON_DATABASE_URL='postgresql://...' npx tsx scripts/migrate-production.ts"
  );
  process.exit(1);
}

console.log("Connecting to Neon...");
const sql = neon(databaseUrl);
const db = drizzle({ client: sql });

console.log("Running migrations...");
await migrate(db, { migrationsFolder: "./src/db/migrations" });
console.log("Migration completed successfully");
