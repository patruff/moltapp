import { createMiddleware } from "hono/factory";
import { createHash } from "crypto";
import { eq, and } from "drizzle-orm";
import { db } from "../db/index.ts";
import { apiKeys } from "../db/schema/index.ts";

type AuthEnv = {
  Variables: {
    agentId: string;
  };
};

/**
 * API key verification middleware.
 *
 * Extracts Bearer token from Authorization header, hashes it,
 * and looks up the hash in the apiKeys table. If valid, sets
 * agentId in the request context for downstream handlers.
 */
export const authMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
  const authHeader = c.req.header("Authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "missing_api_key" }, 401);
  }

  const apiKey = authHeader.slice(7); // Remove "Bearer " prefix

  if (!apiKey) {
    return c.json({ error: "missing_api_key" }, 401);
  }

  // Hash the provided key and look up in database
  const keyHash = createHash("sha256").update(apiKey).digest("hex");

  const records = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, keyHash), eq(apiKeys.isRevoked, false)))
    .limit(1);

  if (records.length === 0) {
    return c.json({ error: "invalid_api_key" }, 401);
  }

  const record = records[0];

  // Set agent ID in context for downstream handlers
  c.set("agentId", record.agentId);

  // Fire-and-forget: update lastUsedAt timestamp
  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, record.id))
    .execute()
    .catch(() => {
      // Silently ignore -- non-critical
    });

  await next();
});
