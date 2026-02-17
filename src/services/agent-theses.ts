/**
 * Agent Theses Service
 *
 * CRUD operations for agent investment theses that persist across rounds.
 * Agents call these through tools to record, update, and close their
 * investment reasoning.
 */

import { db } from "../db/index.ts";
import { agentTheses } from "../db/schema/agent-theses.ts";
import { eq, and, desc } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ThesisInput {
  symbol: string;
  thesis: string;
  conviction: number;
  direction: "bullish" | "bearish" | "neutral";
  entryPrice?: string;
  targetPrice?: string;
}

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Default number of thesis records returned by getThesisHistory.
 * Covers a typical agent's recent thesis activity without overloading API responses.
 * Callers can pass a higher limit for full history exports.
 */
const THESIS_HISTORY_DEFAULT_LIMIT = 20;

// ---------------------------------------------------------------------------
// CRUD Operations
// ---------------------------------------------------------------------------

/**
 * Get all active theses for an agent.
 */
export async function getActiveTheses(agentId: string) {
  return db
    .select()
    .from(agentTheses)
    .where(
      and(
        eq(agentTheses.agentId, agentId),
        eq(agentTheses.status, "active"),
      ),
    )
    .orderBy(desc(agentTheses.updatedAt));
}

/**
 * Create or update a thesis. If an active thesis exists for the same
 * agent+symbol, it is updated in place. Otherwise a new one is created.
 */
export async function upsertThesis(agentId: string, input: ThesisInput) {
  const existing = await db
    .select()
    .from(agentTheses)
    .where(
      and(
        eq(agentTheses.agentId, agentId),
        eq(agentTheses.symbol, input.symbol),
        eq(agentTheses.status, "active"),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(agentTheses)
      .set({
        thesis: input.thesis,
        conviction: input.conviction,
        direction: input.direction,
        entryPrice: input.entryPrice ?? existing[0].entryPrice,
        targetPrice: input.targetPrice ?? existing[0].targetPrice,
        updatedAt: new Date(),
      })
      .where(eq(agentTheses.id, existing[0].id));
    return { action: "updated" as const, id: existing[0].id };
  }

  const [inserted] = await db
    .insert(agentTheses)
    .values({
      agentId,
      symbol: input.symbol,
      thesis: input.thesis,
      conviction: input.conviction,
      direction: input.direction,
      entryPrice: input.entryPrice,
      targetPrice: input.targetPrice,
      status: "active",
    })
    .returning({ id: agentTheses.id });
  return { action: "created" as const, id: inserted.id };
}

/**
 * Close an active thesis with a reason.
 */
export async function closeThesis(
  agentId: string,
  symbol: string,
  reason: string,
) {
  const result = await db
    .update(agentTheses)
    .set({
      status: "closed",
      closedReason: reason,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(agentTheses.agentId, agentId),
        eq(agentTheses.symbol, symbol),
        eq(agentTheses.status, "active"),
      ),
    )
    .returning({ id: agentTheses.id });
  return { closed: result.length };
}

/**
 * Get thesis history (all statuses) for an agent.
 */
export async function getThesisHistory(agentId: string, limit = THESIS_HISTORY_DEFAULT_LIMIT) {
  return db
    .select()
    .from(agentTheses)
    .where(eq(agentTheses.agentId, agentId))
    .orderBy(desc(agentTheses.updatedAt))
    .limit(limit);
}
