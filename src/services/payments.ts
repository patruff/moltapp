/**
 * Agent Payments & Tipping Service
 *
 * x402-style agent-to-agent tipping system. Allows users and agents to
 * tip AI trading agents for good calls, track earnings, and view payment
 * history. Designed for future integration with Solana on-chain payments.
 *
 * Features:
 * - Tip agents for specific trading decisions or general performance
 * - Track agent earnings with running totals
 * - Payment history with messages
 * - Leaderboard of top earners
 * - Tipper recognition (top supporters)
 */

import { db } from "../db/index.ts";
import { agentPayments, agentEarnings } from "../db/schema/payments.ts";
import { agentDecisions } from "../db/schema/agent-decisions.ts";
import { eq, desc, sql, and, gte } from "drizzle-orm";
import { getAgentConfigs } from "../agents/orchestrator.ts";
import { ISO_DATE_DISPLAY_LENGTH } from "../config/constants.ts";

// Database query result types
type PaymentRow = typeof agentPayments.$inferSelect;

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Maximum allowed tip amount in USDC.
 * Prevents accidental overpayments and constrains the tipping economy.
 * Example: A user cannot send a tip larger than $1,000,000 USDC.
 */
const MAX_TIP_AMOUNT_USDC = 1_000_000;

/**
 * Number of recent tips to show in an agent's earnings profile.
 * Controls how many recent tip transactions are returned alongside summary stats.
 * Example: An agent with 500 tips will only show the 20 most recent ones.
 */
const RECENT_TIPS_DISPLAY_LIMIT = 20;

/**
 * Number of top tippers to show in an agent's earnings profile.
 * Controls the leaderboard of supporters ranked by total amount tipped.
 * Example: Shows the 10 most generous supporters, even if there are 100+ tippers.
 */
const TOP_TIPPERS_DISPLAY_LIMIT = 10;

/**
 * Default number of payment history records returned per page.
 * Used when the caller does not specify a limit parameter.
 * Balances response size with completeness for typical pagination scenarios.
 */
const DEFAULT_PAYMENT_HISTORY_LIMIT = 50;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TipRequest {
  fromId: string;
  fromName: string;
  toAgentId: string;
  amount: number;
  currency?: string;
  decisionId?: number;
  message?: string;
  txSignature?: string;
}

export interface TipResult {
  id: number;
  fromName: string;
  toAgentId: string;
  toAgentName: string;
  amount: number;
  currency: string;
  message: string | null;
  decisionId: number | null;
  createdAt: Date;
}

export interface AgentEarningsProfile {
  agentId: string;
  agentName: string;
  provider: string;
  totalEarnings: number;
  tipCount: number;
  uniqueTippers: number;
  avgTipAmount: number;
  largestTip: number;
  lastTipAt: string | null;
  recentTips: RecentTip[];
  topTippers: TopTipper[];
  earningsByDay: DailyEarnings[];
}

interface RecentTip {
  id: number;
  fromName: string;
  amount: number;
  currency: string;
  message: string | null;
  decisionId: number | null;
  createdAt: string;
}

interface TopTipper {
  fromId: string;
  fromName: string;
  totalAmount: number;
  tipCount: number;
}

interface DailyEarnings {
  date: string;
  totalAmount: number;
  tipCount: number;
}

export interface EarningsLeaderboard {
  entries: EarningsLeaderboardEntry[];
  platformStats: PlatformPaymentStats;
}

interface EarningsLeaderboardEntry {
  rank: number;
  agentId: string;
  agentName: string;
  provider: string;
  totalEarnings: number;
  tipCount: number;
  uniqueTippers: number;
  avgTipAmount: number;
}

interface PlatformPaymentStats {
  totalTipVolume: number;
  totalTips: number;
  uniqueTippers: number;
  uniqueRecipients: number;
  avgTipAmount: number;
  largestTip: number;
  mostTippedAgent: string | null;
}

// ---------------------------------------------------------------------------
// Core Functions
// ---------------------------------------------------------------------------

/**
 * Send a tip to an AI agent.
 */
export async function sendTip(request: TipRequest): Promise<TipResult> {
  const config = getAgentConfigs().find((c) => c.agentId === request.toAgentId);
  if (!config) {
    throw new Error(
      `Agent not found: ${request.toAgentId}. Valid IDs: ${getAgentConfigs().map((c) => c.agentId).join(", ")}`,
    );
  }

  if (request.amount <= 0) {
    throw new Error("Tip amount must be greater than 0");
  }

  if (request.amount > MAX_TIP_AMOUNT_USDC) {
    throw new Error("Tip amount cannot exceed 1,000,000 USDC");
  }

  // Validate decision exists if specified
  if (request.decisionId) {
    const decision = await db
      .select()
      .from(agentDecisions)
      .where(eq(agentDecisions.id, request.decisionId))
      .limit(1);

    if (decision.length === 0) {
      throw new Error(`Decision not found: ${request.decisionId}`);
    }

    // Verify the decision belongs to the tipped agent
    if (decision[0].agentId !== request.toAgentId) {
      throw new Error(
        `Decision ${request.decisionId} belongs to ${decision[0].agentId}, not ${request.toAgentId}`,
      );
    }
  }

  const currency = request.currency ?? "USDC";

  // Insert payment record
  const [payment] = await db
    .insert(agentPayments)
    .values({
      fromId: request.fromId,
      fromName: request.fromName,
      toAgentId: request.toAgentId,
      amount: String(request.amount),
      currency,
      decisionId: request.decisionId ?? null,
      message: request.message ?? null,
      status: "completed",
      txSignature: request.txSignature ?? null,
    })
    .returning();

  // Update or create earnings record
  await updateEarnings(request.toAgentId, request.amount, request.fromId);

  return {
    id: payment.id,
    fromName: request.fromName,
    toAgentId: request.toAgentId,
    toAgentName: config.name,
    amount: request.amount,
    currency,
    message: request.message ?? null,
    decisionId: request.decisionId ?? null,
    createdAt: payment.createdAt,
  };
}

/**
 * Update an agent's earnings totals.
 */
async function updateEarnings(
  agentId: string,
  tipAmount: number,
  tipperId: string,
): Promise<void> {
  // Check if earnings record exists
  const existing = await db
    .select()
    .from(agentEarnings)
    .where(eq(agentEarnings.agentId, agentId))
    .limit(1);

  if (existing.length === 0) {
    // Create new earnings record
    await db.insert(agentEarnings).values({
      agentId,
      totalEarnings: String(tipAmount),
      tipCount: 1,
      uniqueTippers: 1,
      avgTipAmount: String(tipAmount),
      largestTip: String(tipAmount),
      lastTipAt: new Date(),
    });
  } else {
    const current = existing[0];
    const newTotal = parseFloat(current.totalEarnings) + tipAmount;
    const newCount = current.tipCount + 1;
    const newAvg = newTotal / newCount;
    const newLargest = Math.max(parseFloat(current.largestTip), tipAmount);

    // Count unique tippers
    const uniqueTipperQuery = await db
      .select({ count: sql<number>`count(distinct from_id)` })
      .from(agentPayments)
      .where(eq(agentPayments.toAgentId, agentId));
    const uniqueCount = Number(uniqueTipperQuery[0]?.count ?? 0);

    await db
      .update(agentEarnings)
      .set({
        totalEarnings: String(newTotal),
        tipCount: newCount,
        uniqueTippers: uniqueCount,
        avgTipAmount: String(newAvg),
        largestTip: String(newLargest),
        lastTipAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(agentEarnings.agentId, agentId));
  }
}

/**
 * Get an agent's earnings profile.
 */
export async function getAgentEarningsProfile(
  agentId: string,
): Promise<AgentEarningsProfile | null> {
  const config = getAgentConfigs().find((c) => c.agentId === agentId);
  if (!config) return null;

  // Get earnings totals
  const earnings = await db
    .select()
    .from(agentEarnings)
    .where(eq(agentEarnings.agentId, agentId))
    .limit(1);

  const earningsData = earnings[0];

  // Get recent tips
  const recentTips = await db
    .select()
    .from(agentPayments)
    .where(eq(agentPayments.toAgentId, agentId))
    .orderBy(desc(agentPayments.createdAt))
    .limit(RECENT_TIPS_DISPLAY_LIMIT);

  // Get top tippers
  let topTippers: TopTipper[] = [];
  try {
    const tipperQuery = await db
      .select({
        fromId: agentPayments.fromId,
        fromName: agentPayments.fromName,
        totalAmount: sql<string>`sum(${agentPayments.amount})`,
        tipCount: sql<number>`count(*)`,
      })
      .from(agentPayments)
      .where(eq(agentPayments.toAgentId, agentId))
      .groupBy(agentPayments.fromId, agentPayments.fromName)
      .orderBy(sql`sum(${agentPayments.amount}) desc`)
      .limit(TOP_TIPPERS_DISPLAY_LIMIT);

    topTippers = tipperQuery.map((t: typeof tipperQuery[number]) => ({
      fromId: t.fromId,
      fromName: t.fromName,
      totalAmount: parseFloat(t.totalAmount),
      tipCount: Number(t.tipCount),
    }));
  } catch {
    // table might not exist yet
  }

  // Get daily earnings for the last 7 days
  const earningsByDay: DailyEarnings[] = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    date.setHours(0, 0, 0, 0);
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + 1);

    try {
      const dayTips = await db
        .select({
          totalAmount: sql<string>`coalesce(sum(${agentPayments.amount}), '0')`,
          tipCount: sql<number>`count(*)`,
        })
        .from(agentPayments)
        .where(
          and(
            eq(agentPayments.toAgentId, agentId),
            gte(agentPayments.createdAt, date),
          ),
        );

      earningsByDay.push({
        date: date.toISOString().slice(0, ISO_DATE_DISPLAY_LENGTH),
        totalAmount: parseFloat(dayTips[0]?.totalAmount ?? "0"),
        tipCount: Number(dayTips[0]?.tipCount ?? 0),
      });
    } catch {
      earningsByDay.push({
        date: date.toISOString().slice(0, ISO_DATE_DISPLAY_LENGTH),
        totalAmount: 0,
        tipCount: 0,
      });
    }
  }

  return {
    agentId,
    agentName: config.name,
    provider: config.provider,
    totalEarnings: earningsData ? parseFloat(earningsData.totalEarnings) : 0,
    tipCount: earningsData?.tipCount ?? 0,
    uniqueTippers: earningsData?.uniqueTippers ?? 0,
    avgTipAmount: earningsData
      ? parseFloat(earningsData.avgTipAmount)
      : 0,
    largestTip: earningsData ? parseFloat(earningsData.largestTip) : 0,
    lastTipAt: earningsData?.lastTipAt?.toISOString() ?? null,
    recentTips: recentTips.map((t: PaymentRow) => ({
      id: t.id,
      fromName: t.fromName,
      amount: parseFloat(t.amount),
      currency: t.currency,
      message: t.message,
      decisionId: t.decisionId,
      createdAt: t.createdAt.toISOString(),
    })),
    topTippers,
    earningsByDay,
  };
}

/**
 * Get the earnings leaderboard.
 */
export async function getEarningsLeaderboard(): Promise<EarningsLeaderboard> {
  const configs = getAgentConfigs();
  const entries: EarningsLeaderboardEntry[] = [];

  for (const config of configs) {
    const earnings = await db
      .select()
      .from(agentEarnings)
      .where(eq(agentEarnings.agentId, config.agentId))
      .limit(1);

    const data = earnings[0];
    entries.push({
      rank: 0,
      agentId: config.agentId,
      agentName: config.name,
      provider: config.provider,
      totalEarnings: data ? parseFloat(data.totalEarnings) : 0,
      tipCount: data?.tipCount ?? 0,
      uniqueTippers: data?.uniqueTippers ?? 0,
      avgTipAmount: data ? parseFloat(data.avgTipAmount) : 0,
    });
  }

  entries.sort((a, b) => b.totalEarnings - a.totalEarnings);
  entries.forEach((e, i) => {
    e.rank = i + 1;
  });

  // Platform-wide stats
  let platformStats: PlatformPaymentStats = {
    totalTipVolume: 0,
    totalTips: 0,
    uniqueTippers: 0,
    uniqueRecipients: 0,
    avgTipAmount: 0,
    largestTip: 0,
    mostTippedAgent: null,
  };

  try {
    const platformQuery = await db
      .select({
        totalVolume: sql<string>`coalesce(sum(${agentPayments.amount}), '0')`,
        totalCount: sql<number>`count(*)`,
        uniqueTippers: sql<number>`count(distinct ${agentPayments.fromId})`,
        uniqueRecipients: sql<number>`count(distinct ${agentPayments.toAgentId})`,
        largestTip: sql<string>`coalesce(max(${agentPayments.amount}), '0')`,
      })
      .from(agentPayments);

    if (platformQuery[0]) {
      const q = platformQuery[0];
      platformStats = {
        totalTipVolume: parseFloat(q.totalVolume),
        totalTips: Number(q.totalCount),
        uniqueTippers: Number(q.uniqueTippers),
        uniqueRecipients: Number(q.uniqueRecipients),
        avgTipAmount:
          Number(q.totalCount) > 0
            ? parseFloat(q.totalVolume) / Number(q.totalCount)
            : 0,
        largestTip: parseFloat(q.largestTip),
        mostTippedAgent:
          entries.length > 0 && entries[0].totalEarnings > 0
            ? entries[0].agentName
            : null,
      };
    }
  } catch {
    // table might not exist
  }

  return { entries, platformStats };
}

/**
 * Get payment history for an agent (tips received).
 */
export async function getAgentPaymentHistory(
  agentId: string,
  limit: number = DEFAULT_PAYMENT_HISTORY_LIMIT,
  offset: number = 0,
): Promise<{
  payments: RecentTip[];
  total: number;
  limit: number;
  offset: number;
}> {
  const payments = await db
    .select()
    .from(agentPayments)
    .where(eq(agentPayments.toAgentId, agentId))
    .orderBy(desc(agentPayments.createdAt))
    .limit(limit)
    .offset(offset);

  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(agentPayments)
    .where(eq(agentPayments.toAgentId, agentId));

  return {
    payments: payments.map((p: PaymentRow) => ({
      id: p.id,
      fromName: p.fromName,
      amount: parseFloat(p.amount),
      currency: p.currency,
      message: p.message,
      decisionId: p.decisionId,
      createdAt: p.createdAt.toISOString(),
    })),
    total: Number(countResult[0]?.count ?? 0),
    limit,
    offset,
  };
}
