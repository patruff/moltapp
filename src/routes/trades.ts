import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import { db } from "../db/index.ts";
import { trades } from "../db/schema/index.ts";

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

  let limit = 50;
  if (limitParam) {
    const parsed = parseInt(limitParam, 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, 200);
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
