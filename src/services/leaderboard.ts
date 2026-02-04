import { Decimal } from "decimal.js";
import { db } from "../db/index.ts";
import { agents, positions, trades, transactions } from "../db/schema/index.ts";
import { eq, sql, count, max } from "drizzle-orm";
import { getPrices } from "./jupiter.ts";

// Database query result types
type PositionRow = typeof positions.$inferSelect;
type TradeRow = typeof trades.$inferSelect;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LeaderboardEntry {
  rank: number;
  agentId: string;
  agentName: string;
  karma: number;
  totalPortfolioValue: string; // formatted to 2 decimal places
  totalPnlPercent: string; // formatted to 2 decimal places
  totalPnlAbsolute: string; // formatted to 2 decimal places
  tradeCount: number;
  lastTradeAt: Date | null;
}

export interface LeaderboardData {
  entries: LeaderboardEntry[];
  aggregateStats: {
    totalAgents: number;
    totalVolume: string; // sum of all USDC traded
  };
  computedAt: Date;
}

// ---------------------------------------------------------------------------
// Cache (module-level singleton)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes — short for live demo
let cache: LeaderboardData | null = null;
let refreshPromise: Promise<void> | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the leaderboard data. Returns cached data if fresh (< 30 min old).
 * Prevents thundering herd by coalescing concurrent refresh requests.
 */
export async function getLeaderboard(): Promise<LeaderboardData> {
  // 1. Return cache if still fresh
  if (cache && Date.now() - cache.computedAt.getTime() < CACHE_TTL_MS) {
    return cache;
  }

  // 2. If a refresh is already in progress, wait for it (thundering herd prevention)
  if (refreshPromise !== null) {
    await refreshPromise;
    return cache!;
  }

  // 3. Start a new refresh
  refreshPromise = refreshLeaderboard();
  try {
    await refreshPromise;
  } finally {
    refreshPromise = null;
  }

  return cache!;
}

// ---------------------------------------------------------------------------
// Internal -- Leaderboard computation
// ---------------------------------------------------------------------------

async function refreshLeaderboard(): Promise<void> {
  // Step 1: Fetch all active agents
  const allAgents = await db
    .select()
    .from(agents)
    .where(eq(agents.isActive, true));

  // Step 2: Fetch all positions (single query)
  const allPositions = await db.select().from(positions);

  // Step 3: Fetch live Jupiter prices for all unique mints
  const uniqueMints: string[] = [
    ...new Set(allPositions.map((p: PositionRow) => p.mintAddress)),
  ];
  const priceMap =
    uniqueMints.length > 0 ? await getPrices(uniqueMints) : {};

  // Step 4: Aggregate trade stats per agent (single SQL query)
  const tradeStats = await db
    .select({
      agentId: trades.agentId,
      tradeCount: count(trades.id),
      lastTradeAt: max(trades.createdAt),
      totalBuyUsdc: sql<string>`COALESCE(SUM(CASE WHEN ${trades.side} = 'buy' THEN ${trades.usdcAmount}::numeric ELSE 0 END), 0)`,
      totalSellUsdc: sql<string>`COALESCE(SUM(CASE WHEN ${trades.side} = 'sell' THEN ${trades.usdcAmount}::numeric ELSE 0 END), 0)`,
    })
    .from(trades)
    .where(eq(trades.status, "confirmed"))
    .groupBy(trades.agentId);

  // Step 5: Aggregate deposit/withdrawal stats per agent (single SQL query)
  const depositStats = await db
    .select({
      agentId: transactions.agentId,
      totalDeposited: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'deposit' AND ${transactions.tokenType} = 'USDC' THEN ${transactions.amount}::numeric ELSE 0 END), 0)`,
      totalWithdrawn: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'withdrawal' AND ${transactions.tokenType} = 'USDC' THEN ${transactions.amount}::numeric ELSE 0 END), 0)`,
    })
    .from(transactions)
    .where(eq(transactions.status, "confirmed"))
    .groupBy(transactions.agentId);

  // Build lookup maps for O(1) access
  type TradeStatsRow = typeof tradeStats[number];
  type DepositStatsRow = typeof depositStats[number];

  const tradeStatsMap = new Map<string, TradeStatsRow>(tradeStats.map((t: TradeStatsRow) => [t.agentId, t]));
  const depositStatsMap = new Map<string, DepositStatsRow>(
    depositStats.map((d: DepositStatsRow) => [d.agentId, d])
  );

  // Step 6: Compute per-agent metrics using Decimal.js
  let totalVolumeDecimal = new Decimal(0);

  const entries: LeaderboardEntry[] = allAgents.map((agent) => {
    const agentPositions = allPositions.filter(
      (p: PositionRow) => p.agentId === agent.id
    );
    const agentTradeStats = tradeStatsMap.get(agent.id);
    const agentDepositStats = depositStatsMap.get(agent.id);

    const totalBuyUsdc = new Decimal(
      agentTradeStats?.totalBuyUsdc ?? "0"
    );
    const totalSellUsdc = new Decimal(
      agentTradeStats?.totalSellUsdc ?? "0"
    );
    const totalDeposited = new Decimal(
      agentDepositStats?.totalDeposited ?? "0"
    );
    const totalWithdrawn = new Decimal(
      agentDepositStats?.totalWithdrawn ?? "0"
    );

    // USDC cash balance = totalDeposited - totalWithdrawn - totalBuyUsdc + totalSellUsdc
    const usdcCashBalance = totalDeposited
      .minus(totalWithdrawn)
      .minus(totalBuyUsdc)
      .plus(totalSellUsdc);

    // Market value of positions
    let marketValue = new Decimal(0);
    for (const pos of agentPositions) {
      const priceInfo = priceMap[pos.mintAddress];
      if (priceInfo) {
        const quantity = new Decimal(pos.quantity);
        const price = new Decimal(priceInfo.usdPrice);
        marketValue = marketValue.plus(quantity.times(price));
      }
      // If no price available, position valued at 0 (conservative)
    }

    // Current Portfolio Value = USDC cash balance + market value of positions
    const currentPortfolioValue = usdcCashBalance.plus(marketValue);

    // Total P&L (absolute) = Current Portfolio Value - Total Capital Deposited
    const totalPnlAbsolute = currentPortfolioValue.minus(totalDeposited);

    // Total P&L (%) = (Total P&L / Total Capital Deposited) * 100
    const totalPnlPercent = totalDeposited.isZero()
      ? new Decimal(0)
      : totalPnlAbsolute.div(totalDeposited).times(100);

    // Accumulate total volume (buys + sells)
    totalVolumeDecimal = totalVolumeDecimal
      .plus(totalBuyUsdc)
      .plus(totalSellUsdc);

    const tradeCount = agentTradeStats?.tradeCount ?? 0;
    const lastTradeAt = agentTradeStats?.lastTradeAt
      ? new Date(agentTradeStats.lastTradeAt)
      : null;

    return {
      rank: 0, // assigned after sorting
      agentId: agent.id,
      agentName: agent.name,
      karma: agent.karma ?? 0,
      totalPortfolioValue: currentPortfolioValue.toFixed(2),
      totalPnlPercent: totalPnlPercent.toFixed(2),
      totalPnlAbsolute: totalPnlAbsolute.toFixed(2),
      tradeCount,
      lastTradeAt,
    };
  });

  // Step 7: Sort by P&L percentage descending, assign ranks
  entries.sort((a, b) => {
    const aPnl = new Decimal(a.totalPnlPercent);
    const bPnl = new Decimal(b.totalPnlPercent);
    return bPnl.minus(aPnl).toNumber();
  });

  for (let i = 0; i < entries.length; i++) {
    entries[i].rank = i + 1;
  }

  // Step 8: Compute aggregate stats
  const aggregateStats = {
    totalAgents: allAgents.length,
    totalVolume: totalVolumeDecimal.toFixed(2),
  };

  // Step 9: Update cache
  cache = {
    entries,
    aggregateStats,
    computedAt: new Date(),
  };
}
