import { Hono } from "hono";
import { db } from "../db/index.ts";
import { sql } from "drizzle-orm";
import { errorMessage } from "../lib/errors.ts";

const healthRoutes = new Hono();

/** Track server start time for uptime calculation */
const serverStartTime = Date.now();

/**
 * GET /health - System health check with DB connection verification
 * 
 * Returns:
 * - status: "ok" or "degraded"
 * - uptime: milliseconds since server start
 * - database: { connected: boolean, latency?: number, error?: string }
 * - timestamp: current ISO timestamp
 */
healthRoutes.get("/", async (c) => {
  const startTime = Date.now();
  
  // Check database connection
  let dbConnected = false;
  let dbLatency: number | undefined;
  let dbError: string | undefined;
  
  try {
    const dbCheckStart = Date.now();
    // Simple query to verify DB connection
    await db.execute(sql`SELECT 1 as health_check`);
    dbLatency = Date.now() - dbCheckStart;
    dbConnected = true;
  } catch (err) {
    dbError = errorMessage(err);
  }
  
  // Calculate uptime
  const uptime = Date.now() - serverStartTime;
  
  // Determine overall status
  const status = dbConnected ? "ok" : "degraded";
  
  return c.json({
    status,
    uptime,
    database: {
      connected: dbConnected,
      ...(dbLatency !== undefined && { latency: dbLatency }),
      ...(dbError && { error: dbError }),
    },
    timestamp: new Date().toISOString(),
  });
});

export { healthRoutes };
