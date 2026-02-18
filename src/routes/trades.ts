import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import { db } from "../db/index.ts";
import { trades } from "../db/schema/index.ts";

// ---------------------------------------------------------------------------
// Pagination Constants
// ---------------------------------------------------------------------------

/**
 * Default number of trades returned per page when no `limit` query param is given.
 *
 * 50 covers roughly 1-2 full trading rounds of history without bloating the
 * response payload for callers that don't need deep history.
 *
 * Formula: trades.slice(-DEFAULT_TRADES_LIMIT) = most recent N records.
 * Example: agent has 500 trades → default response returns the latest 50.
 */
const DEFAULT_TRADES_LIMIT = 50;

/**
 * Hard upper-bound applied to the caller-supplied `?limit=` query parameter.
 *
 * Prevents runaway queries that would return thousands of rows in a single
 * response.  Callers that need more history should paginate using `?offset=`.
 *
 * Example: caller requests limit=9999 → clamped to MAX_TRADES_LIMIT (200).
 */
const MAX_TRADES_LIMIT = 200;

type TradesEnv = { Variables: { agentId: string } };

export const tradeRoutes = new Hono<TradesEnv>();

// ---------------------------------------------------------------------------
// GET / -- List agent's trade history
// ---------------------------------------------------------------------------

tradeRoutes.get("/", async (c) => {
  const agentId = c.get("agentId");

  // Parse pagination params
  const limitParam = c.req.query("limit");
  const offsetParam = c.req.query("offset");

  let limit = DEFAULT_TRADES_LIMIT;
  if (limitParam) {
    const parsed = parseInt(limitParam, 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, MAX_TRADES_LIMIT);
    }
  }

  let offset = 0;
  if (offsetParam) {
    const parsed = parseInt(offsetParam, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      offset = parsed;
    }
  }

  const records = await db
    .select({
      id: trades.id,
      side: trades.side,
      stockSymbol: trades.stockSymbol,
      stockQuantity: trades.stockQuantity,
      usdcAmount: trades.usdcAmount,
      pricePerToken: trades.pricePerToken,
      txSignature: trades.txSignature,
      status: trades.status,
      createdAt: trades.createdAt,
    })
    .from(trades)
    .where(eq(trades.agentId, agentId))
    .orderBy(desc(trades.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json({ trades: records });
});
