/**
 * Comments & Reactions Routes
 *
 * Social layer for AI trading decisions. Users and agents can comment on
 * trade decisions and react with bullish/bearish sentiment.
 *
 * Routes:
 *   POST /api/v1/trades/:decisionId/comments   — Post a comment on a trade
 *   GET  /api/v1/trades/:decisionId/comments   — Get comments for a trade
 *   POST /api/v1/trades/:decisionId/react      — React to a trade (bullish/bearish)
 *   GET  /api/v1/trades/:decisionId/reactions   — Get reaction counts
 *   DELETE /api/v1/trades/:decisionId/react     — Remove your reaction
 *   GET  /api/v1/trades/:decisionId             — Full trade detail with social data
 */

import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/index.ts";
import { agentDecisions } from "../db/schema/agent-decisions.ts";
import { tradeComments } from "../db/schema/trade-comments.ts";
import { tradeReactions } from "../db/schema/trade-reactions.ts";
import { eq, desc, and, sql } from "drizzle-orm";
import { getAgentConfig } from "../agents/orchestrator.ts";
import { apiError } from "../lib/errors.ts";
import { clamp } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const commentRoutes = new Hono();

// ---------------------------------------------------------------------------
// Validation Schemas
// ---------------------------------------------------------------------------

const commentSchema = z.object({
  authorId: z
    .string()
    .min(1, "authorId is required")
    .max(64, "authorId too long"),
  authorName: z
    .string()
    .min(1, "authorName is required")
    .max(64, "authorName too long"),
  content: z
    .string()
    .min(1, "content is required")
    .max(1000, "content must be 1000 characters or less"),
});

const reactionSchema = z.object({
  reactorId: z
    .string()
    .min(1, "reactorId is required")
    .max(64, "reactorId too long"),
  reaction: z.enum(["bullish", "bearish"], {
    error: "reaction must be 'bullish' or 'bearish'",
  }),
});

// ---------------------------------------------------------------------------
// Helper: Validate decision exists
// ---------------------------------------------------------------------------

async function getDecision(decisionId: number) {
  const results = await db
    .select()
    .from(agentDecisions)
    .where(eq(agentDecisions.id, decisionId))
    .limit(1);
  return results[0] ?? null;
}

// ---------------------------------------------------------------------------
// GET /trades/:decisionId — Full trade detail with social data
// ---------------------------------------------------------------------------

commentRoutes.get("/:decisionId", async (c) => {
  const decisionIdStr = c.req.param("decisionId");
  const decisionId = parseInt(decisionIdStr, 10);

  if (isNaN(decisionId)) {
    return apiError(c, "VALIDATION_FAILED", "decisionId must be a number");
  }

  const decision = await getDecision(decisionId);
  if (!decision) {
    return apiError(c, "DECISION_NOT_FOUND", `Decision ${decisionId} not found`);
  }

  const config = getAgentConfig(decision.agentId);

  // Fetch comments
  const comments = await db
    .select()
    .from(tradeComments)
    .where(eq(tradeComments.decisionId, decisionId))
    .orderBy(desc(tradeComments.createdAt));

  // Fetch reactions
  const reactions = await db
    .select({
      reaction: tradeReactions.reaction,
      count: sql<number>`count(*)`,
    })
    .from(tradeReactions)
    .where(eq(tradeReactions.decisionId, decisionId))
    .groupBy(tradeReactions.reaction);

  const reactionCounts = { bullish: 0, bearish: 0 };
  for (const r of reactions) {
    if (r.reaction === "bullish") reactionCounts.bullish = Number(r.count);
    if (r.reaction === "bearish") reactionCounts.bearish = Number(r.count);
  }

  return c.json({
    trade: {
      id: decision.id,
      agentId: decision.agentId,
      agentName: config?.name ?? decision.agentId,
      agentProvider: config?.provider ?? "unknown",
      action: decision.action,
      symbol: decision.symbol,
      quantity: decision.quantity,
      reasoning: decision.reasoning,
      confidence: decision.confidence,
      modelUsed: decision.modelUsed,
      marketSnapshot: decision.marketSnapshot,
      executed: decision.executed,
      timestamp: decision.createdAt,
    },
    reactions: reactionCounts,
    comments: comments.map((c: typeof tradeComments.$inferSelect) => ({
      id: c.id,
      authorId: c.authorId,
      authorName: c.authorName,
      content: c.content,
      timestamp: c.createdAt,
    })),
    commentCount: comments.length,
  });
});

// ---------------------------------------------------------------------------
// POST /trades/:decisionId/comments — Post a comment
// ---------------------------------------------------------------------------

commentRoutes.post("/:decisionId/comments", async (c) => {
  const decisionIdStr = c.req.param("decisionId");
  const decisionId = parseInt(decisionIdStr, 10);

  if (isNaN(decisionId)) {
    return apiError(c, "VALIDATION_FAILED", "decisionId must be a number");
  }

  // Parse and validate body
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, "INVALID_JSON", "Request body must be valid JSON");
  }

  const parsed = commentSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, "VALIDATION_FAILED", parsed.error.flatten());
  }

  // Check decision exists
  const decision = await getDecision(decisionId);
  if (!decision) {
    return apiError(c, "DECISION_NOT_FOUND", `Decision ${decisionId} not found`);
  }

  // Insert comment
  const [comment] = await db
    .insert(tradeComments)
    .values({
      decisionId,
      authorId: parsed.data.authorId,
      authorName: parsed.data.authorName,
      content: parsed.data.content,
    })
    .returning();

  return c.json(
    {
      comment: {
        id: comment.id,
        decisionId: comment.decisionId,
        authorId: comment.authorId,
        authorName: comment.authorName,
        content: comment.content,
        timestamp: comment.createdAt,
      },
    },
    201,
  );
});

// ---------------------------------------------------------------------------
// GET /trades/:decisionId/comments — Get comments for a trade
// ---------------------------------------------------------------------------

commentRoutes.get("/:decisionId/comments", async (c) => {
  const decisionIdStr = c.req.param("decisionId");
  const decisionId = parseInt(decisionIdStr, 10);

  if (isNaN(decisionId)) {
    return apiError(c, "VALIDATION_FAILED", "decisionId must be a number");
  }

  const limitStr = c.req.query("limit");
  const offsetStr = c.req.query("offset");

  let limit = 20;
  if (limitStr) {
    const parsed = parseInt(limitStr, 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = clamp(parsed, 1, 100);
    }
  }

  let offset = 0;
  if (offsetStr) {
    const parsed = parseInt(offsetStr, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      offset = parsed;
    }
  }

  const comments = await db
    .select()
    .from(tradeComments)
    .where(eq(tradeComments.decisionId, decisionId))
    .orderBy(desc(tradeComments.createdAt))
    .limit(limit)
    .offset(offset);

  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(tradeComments)
    .where(eq(tradeComments.decisionId, decisionId));

  return c.json({
    decisionId,
    comments: comments.map((c: typeof tradeComments.$inferSelect) => ({
      id: c.id,
      authorId: c.authorId,
      authorName: c.authorName,
      content: c.content,
      timestamp: c.createdAt,
    })),
    total: Number(countResult[0]?.count ?? 0),
    limit,
    offset,
  });
});

// ---------------------------------------------------------------------------
// POST /trades/:decisionId/react — React to a trade
// ---------------------------------------------------------------------------

commentRoutes.post("/:decisionId/react", async (c) => {
  const decisionIdStr = c.req.param("decisionId");
  const decisionId = parseInt(decisionIdStr, 10);

  if (isNaN(decisionId)) {
    return apiError(c, "VALIDATION_FAILED", "decisionId must be a number");
  }

  // Parse and validate body
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, "INVALID_JSON", "Request body must be valid JSON");
  }

  const parsed = reactionSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, "VALIDATION_FAILED", parsed.error.flatten());
  }

  // Check decision exists
  const decision = await getDecision(decisionId);
  if (!decision) {
    return apiError(c, "DECISION_NOT_FOUND", `Decision ${decisionId} not found`);
  }

  // Upsert reaction (one per reactor per decision)
  try {
    // Delete existing reaction if any
    await db
      .delete(tradeReactions)
      .where(
        and(
          eq(tradeReactions.decisionId, decisionId),
          eq(tradeReactions.reactorId, parsed.data.reactorId),
        ),
      );

    // Insert new reaction
    const [reaction] = await db
      .insert(tradeReactions)
      .values({
        decisionId,
        reactorId: parsed.data.reactorId,
        reaction: parsed.data.reaction,
      })
      .returning();

    // Fetch updated counts
    const counts = await getReactionCounts(decisionId);

    return c.json({
      reaction: {
        id: reaction.id,
        decisionId: reaction.decisionId,
        reactorId: reaction.reactorId,
        reaction: reaction.reaction,
        timestamp: reaction.createdAt,
      },
      reactions: counts,
    });
  } catch (error) {
    console.error("[Comments] Failed to upsert reaction:", error);
    return apiError(c, "INTERNAL_ERROR", "Failed to save reaction");
  }
});

// ---------------------------------------------------------------------------
// GET /trades/:decisionId/reactions — Get reaction counts
// ---------------------------------------------------------------------------

commentRoutes.get("/:decisionId/reactions", async (c) => {
  const decisionIdStr = c.req.param("decisionId");
  const decisionId = parseInt(decisionIdStr, 10);

  if (isNaN(decisionId)) {
    return apiError(c, "VALIDATION_FAILED", "decisionId must be a number");
  }

  const counts = await getReactionCounts(decisionId);

  return c.json({
    decisionId,
    reactions: counts,
  });
});

// ---------------------------------------------------------------------------
// DELETE /trades/:decisionId/react — Remove a reaction
// ---------------------------------------------------------------------------

commentRoutes.delete("/:decisionId/react", async (c) => {
  const decisionIdStr = c.req.param("decisionId");
  const decisionId = parseInt(decisionIdStr, 10);

  if (isNaN(decisionId)) {
    return apiError(c, "VALIDATION_FAILED", "decisionId must be a number");
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, "INVALID_JSON", "Request body must be valid JSON with reactorId");
  }

  const schema = z.object({
    reactorId: z.string().min(1),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, "VALIDATION_FAILED", "reactorId is required");
  }

  await db
    .delete(tradeReactions)
    .where(
      and(
        eq(tradeReactions.decisionId, decisionId),
        eq(tradeReactions.reactorId, parsed.data.reactorId),
      ),
    );

  const counts = await getReactionCounts(decisionId);

  return c.json({
    message: "Reaction removed",
    decisionId,
    reactions: counts,
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getReactionCounts(
  decisionId: number,
): Promise<{ bullish: number; bearish: number; total: number }> {
  const reactions = await db
    .select({
      reaction: tradeReactions.reaction,
      count: sql<number>`count(*)`,
    })
    .from(tradeReactions)
    .where(eq(tradeReactions.decisionId, decisionId))
    .groupBy(tradeReactions.reaction);

  const counts = { bullish: 0, bearish: 0, total: 0 };
  for (const r of reactions) {
    if (r.reaction === "bullish") counts.bullish = Number(r.count);
    if (r.reaction === "bearish") counts.bearish = Number(r.count);
  }
  counts.total = counts.bullish + counts.bearish;
  return counts;
}
