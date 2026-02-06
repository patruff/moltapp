import { Decimal } from "decimal.js";
import { db } from "../db/index.ts";
import { agents, positions, trades, transactions } from "../db/schema/index.ts";
import { agentTheses } from "../db/schema/agent-theses.ts";
import { eq, sql, count, max, desc, and, type InferSelectModel } from "drizzle-orm";
import { getPrices } from "./jupiter.ts";
import { XSTOCKS_CATALOG } from "../config/constants.ts";
import { getOnChainPortfolio } from "./onchain-portfolio.ts";

/** Initial capital per agent ($50 USDC) - used for P&L calculation */
const AGENT_INITIAL_CAPITAL = 50;

// Mock base prices for when Jupiter API doesn't return data
// These approximate real stock prices in USD
const MOCK_BASE_PRICES: Record<string, number> = {
  AAPLx: 178, AMZNx: 178, GOOGLx: 175, METAx: 505, MSFTx: 415, NVDAx: 131, TSLAx: 245,
  AVGOx: 168, AMDx: 125, INTCx: 22, NFLXx: 875, PLTRx: 65, COINx: 225, MSTRx: 320,
  HOODx: 25, CRCLx: 42, GMEx: 27, JPMx: 195, BACx: 38, GSx: 385, Vx: 275, MAx: 460,
  LLYx: 850, UNHx: 520, JNJx: 155, MRKx: 105, PFEx: 28, WMTx: 165, KOx: 62, PEPx: 175,
  MCDx: 290, XOMx: 105, CVXx: 155, SPYx: 512, QQQx: 440, TQQQx: 65, GLDx: 175, VTIx: 265,
  TBLLx: 50, TMOx: 580, ACNx: 340, CRMx: 265, ORCLx: 125, IBMx: 168, CSCOx: 48,
};

/** Generate a mock price with small random variation */
function generateMockPrice(symbol: string): number {
  const base = MOCK_BASE_PRICES[symbol] ?? 100;
  // Add ±5% random variation for realism
  const variation = 0.95 + Math.random() * 0.1;
  return base * variation;
}

/** Create symbol-to-mint lookup for mock prices */
const symbolToMint = new Map(XSTOCKS_CATALOG.map(s => [s.mintAddress, s.symbol]));

// Database query result types
type PositionRow = typeof positions.$inferSelect;
type TradeRow = typeof trades.$inferSelect;
type AgentRow = InferSelectModel<typeof agents>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PositionSummary {
  symbol: string;
  quantity: number;
  currentPrice: number;
  value: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
}

export interface ThesisSummary {
  symbol: string;
  thesis: string;
  direction: string;
  conviction: number;
}

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
  // Enhanced data for richer display
  topPositions: PositionSummary[]; // Top 3 positions by value
  activeThesis: ThesisSummary | null; // Most recent active thesis
  stocksValue: string; // Total value in stocks (not cash)
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

  // Step 3: Fetch live Jupiter prices for all unique mints (with mock fallback)
  const uniqueMints = [
    ...new Set(allPositions.map((p: PositionRow) => p.mintAddress)),
  ] as string[];
  const jupiterPrices =
    uniqueMints.length > 0 ? await getPrices(uniqueMints) : {};

  // Build priceMap with mock fallback for missing prices
  const priceMap: Record<string, { usdPrice: number; priceChange24h: number } | null> = {};
  for (const mint of uniqueMints) {
    const jupiterPrice = jupiterPrices[mint];
    if (jupiterPrice) {
      priceMap[mint] = jupiterPrice;
    } else {
      // Use mock price as fallback
      const symbol = symbolToMint.get(mint);
      if (symbol) {
        priceMap[mint] = { usdPrice: generateMockPrice(symbol), priceChange24h: 0 };
      }
    }
  }

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

  // Step 6: Fetch all active theses (single query)
  const allActiveTheses = await db
    .select()
    .from(agentTheses)
    .where(eq(agentTheses.status, "active"))
    .orderBy(desc(agentTheses.updatedAt));

  // Build lookup maps for O(1) access
  type TradeStatsRow = typeof tradeStats[number];
  type DepositStatsRow = typeof depositStats[number];
  type ThesisRow = typeof allActiveTheses[number];

  const tradeStatsMap = new Map<string, TradeStatsRow>(tradeStats.map((t: TradeStatsRow) => [t.agentId, t]));
  const depositStatsMap = new Map<string, DepositStatsRow>(
    depositStats.map((d: DepositStatsRow) => [d.agentId, d])
  );
  // Group theses by agent (already sorted by most recent first)
  const thesesByAgent = new Map<string, ThesisRow[]>();
  for (const thesis of allActiveTheses) {
    const existing = thesesByAgent.get(thesis.agentId) ?? [];
    existing.push(thesis);
    thesesByAgent.set(thesis.agentId, existing);
  }

  // Step 7: Fetch on-chain portfolios for all agents (for accurate cash + position values)
  const onChainPortfolios = await Promise.all(
    allAgents.map(async (agent: AgentRow) => {
      try {
        return await getOnChainPortfolio(agent.id);
      } catch {
        return null;
      }
    })
  );
  const onChainMap = new Map(
    onChainPortfolios
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .map((p) => [p.agentId, p])
  );

  // Step 8: Compute per-agent metrics using on-chain data
  let totalVolumeDecimal = new Decimal(0);

  const entries: LeaderboardEntry[] = allAgents.map((agent: AgentRow) => {
    const agentTradeStats = tradeStatsMap.get(agent.id);
    const onChainPortfolio = onChainMap.get(agent.id);

    const totalBuyUsdc = new Decimal(agentTradeStats?.totalBuyUsdc ?? "0");
    const totalSellUsdc = new Decimal(agentTradeStats?.totalSellUsdc ?? "0");

    // Use on-chain data for accurate cash balance and position values
    const usdcCashBalance = new Decimal(onChainPortfolio?.cashBalance ?? 0);
    let marketValue = new Decimal(0);
    const positionSummaries: PositionSummary[] = [];

    if (onChainPortfolio) {
      for (const pos of onChainPortfolio.positions) {
        marketValue = marketValue.plus(pos.value);
        positionSummaries.push({
          symbol: pos.symbol,
          quantity: pos.quantity,
          currentPrice: pos.currentPrice,
          value: pos.value,
          unrealizedPnl: pos.unrealizedPnl,
          unrealizedPnlPercent: pos.unrealizedPnlPercent,
        });
      }
    } else {
      // Fallback to database positions with mock prices if on-chain unavailable
      const agentPositions = allPositions.filter(
        (p: PositionRow) => p.agentId === agent.id
      );
      for (const pos of agentPositions) {
        const priceInfo = priceMap[pos.mintAddress];
        if (priceInfo) {
          const quantity = new Decimal(pos.quantity).toNumber();
          const currentPrice = new Decimal(priceInfo.usdPrice).toNumber();
          const value = quantity * currentPrice;
          const costBasis = new Decimal(pos.averageCostBasis).toNumber();
          const totalCost = quantity * costBasis;
          const unrealizedPnl = value - totalCost;
          const unrealizedPnlPercent = totalCost > 0 ? (unrealizedPnl / totalCost) * 100 : 0;

          marketValue = marketValue.plus(value);
          positionSummaries.push({
            symbol: pos.symbol,
            quantity,
            currentPrice,
            value,
            unrealizedPnl,
            unrealizedPnlPercent,
          });
        }
      }
    }

    // Sort positions by value descending, get top 3
    positionSummaries.sort((a, b) => b.value - a.value);
    const topPositions = positionSummaries.slice(0, 3);

    // Get most recent active thesis for this agent
    const agentThesesList = thesesByAgent.get(agent.id) ?? [];
    const activeThesis: ThesisSummary | null = agentThesesList.length > 0
      ? {
          symbol: agentThesesList[0].symbol,
          thesis: agentThesesList[0].thesis,
          direction: agentThesesList[0].direction,
          conviction: agentThesesList[0].conviction,
        }
      : null;

    // Current Portfolio Value = USDC cash balance + market value of positions
    const currentPortfolioValue = usdcCashBalance.plus(marketValue);

    // Total P&L uses initial capital as baseline (since deposits aren't tracked)
    const totalPnlAbsolute = currentPortfolioValue.minus(AGENT_INITIAL_CAPITAL);
    const totalPnlPercent = new Decimal(AGENT_INITIAL_CAPITAL).isZero()
      ? new Decimal(0)
      : totalPnlAbsolute.div(AGENT_INITIAL_CAPITAL).times(100);

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
      topPositions,
      activeThesis,
      stocksValue: marketValue.toFixed(2),
    };
  });

  // Step 9: Sort by P&L percentage descending, assign ranks
  entries.sort((a, b) => {
    const aPnl = new Decimal(a.totalPnlPercent);
    const bPnl = new Decimal(b.totalPnlPercent);
    return bPnl.minus(aPnl).toNumber();
  });

  for (let i = 0; i < entries.length; i++) {
    entries[i].rank = i + 1;
  }

  // Step 10: Compute aggregate stats
  const aggregateStats = {
    totalAgents: allAgents.length,
    totalVolume: totalVolumeDecimal.toFixed(2),
  };

  // Step 11: Update cache
  cache = {
    entries,
    aggregateStats,
    computedAt: new Date(),
  };
}
