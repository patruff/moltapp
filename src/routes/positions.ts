import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/index.ts";
import { positions } from "../db/schema/index.ts";

type PositionEnv = { Variables: { agentId: string } };

export const positionRoutes = new Hono<PositionEnv>();

// ---------------------------------------------------------------------------
// GET / -- List agent's current positions
// ---------------------------------------------------------------------------

positionRoutes.get("/", async (c) => {
  const agentId = c.get("agentId");

  const records = await db
    .select({
      symbol: positions.symbol,
      mintAddress: positions.mintAddress,
      quantity: positions.quantity,
      averageCostBasis: positions.averageCostBasis,
      updatedAt: positions.updatedAt,
    })
    .from(positions)
    .where(eq(positions.agentId, agentId));

  return c.json({ positions: records });
});
