import { Hono } from "hono";
import { jsxRenderer } from "hono/jsx-renderer";
import { eq, desc } from "drizzle-orm";
import { getLeaderboard } from "../services/leaderboard.ts";
import type { LeaderboardEntry, PositionSummary } from "../services/leaderboard.ts";
import { getAgentConfig, getAgentPortfolio, getAgentTradeHistory } from "../agents/orchestrator.ts";
import { getAgentWallet } from "../services/agent-wallets.ts";
import { getThesisHistory } from "../services/agent-theses.ts";
import { getTotalCosts, getAgentCosts } from "../services/llm-cost-tracker.ts";
import { generateDecisionQualityReport, type DecisionQualityReport } from "../services/decision-quality-dashboard.ts";
import {
  formatPercentage,
  calculateTargetMovePercent,
  calculateTargetMoveValue,
  truncateAddress,
  truncateText,
  formatCurrency,
  formatTimeAgo,
  pnlColor,
  pnlSign,
  karmaBadge,
  solscanTxUrl,
  solscanWalletUrl,
  gradeToColor,
  scoreToColor,
  formatScorePercentage,
  formatPnlDisplay,
  formatQuantity,
  formatNumber,
  formatCost,
  formatROI,
} from "../lib/format-utils.ts";
import { db } from "../db/index.ts";
import { agents as agentsTable } from "../db/schema/agents.ts";
import { trades, agentDecisions, agentTheses, positions } from "../db/schema/index.ts";
import { tradeJustifications } from "../db/schema/trade-reasoning.ts";

// Type aliases for database query results and computed types
type Trade = typeof trades.$inferSelect;
type AgentDecision = typeof agentDecisions.$inferSelect;
type Thesis = typeof agentTheses.$inferSelect;
type DbPosition = typeof positions.$inferSelect;
type TradeJustification = typeof tradeJustifications.$inferSelect;

// Tool trace type from trade justifications schema
type TradeJustificationToolCall = {
  turn: number;
  tool: string;
  arguments: Record<string, string | number | boolean | string[]>;
  result: string;
  timestamp: string;
};

// Type alias for agents table
type Agent = typeof agentsTable.$inferSelect;

// Computed types from orchestrator functions
type AgentPosition = {
  symbol: string;
  quantity: number;
  averageCostBasis: number;
  currentPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
};

// Type-safe c.render() with title prop
declare module "hono" {
  interface ContextRenderer {
    (
      content: string | Promise<string>,
      props: { title: string }
    ): Response | Promise<Response>;
  }
}

const pages = new Hono();

// Exit outcome thresholds (used in thesis outcome calculation)
const TARGET_HIT_THRESHOLD = 0.95;  // 95% of target = "hit"
const STOPPED_OUT_THRESHOLD = -5;   // -5% loss = "stopped out"

// Pagination limits (used throughout the UI)
const MAX_RECENT_DECISIONS = 5;     // Recent decisions shown on agent profile
const MAX_TRADE_HISTORY = 10;       // Trade history items per agent
const MAX_THESIS_HISTORY = 10;      // Thesis history items per agent
const MAX_ONCHAIN_TRADES = 20;      // On-chain trade history limit
const MAX_TRADING_ROUNDS = 20;      // Trading rounds shown in timeline
const JUSTIFICATIONS_FETCH_BUFFER = 100; // Fetch buffer for filtering rounds

// ---------------------------------------------------------------------------
// Layout middleware
// ---------------------------------------------------------------------------

pages.use(
  "*",
  jsxRenderer(({ children, title }) => {
    return (
      <html lang="en" class="dark">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>{title}</title>
          <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
          <style>{`
            @theme {
              --color-profit: #22c55e;
              --color-loss: #ef4444;
            }
          `}</style>
          <meta http-equiv="refresh" content="1800" />
        </head>
        <body class="bg-gray-950 text-gray-100 min-h-screen font-mono">
          {children}
        </body>
      </html>
    );
  })
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// All formatting utilities moved to src/lib/format-utils.ts for reusability

// Helper: Calculate P&L for a thesis based on entry, exit, and direction
function calculateThesisPnl(
  entryPrice: number,
  exitPrice: number,
  direction: string
): number {
  if (direction === "bullish") {
    return ((exitPrice - entryPrice) / entryPrice) * 100;
  } else if (direction === "bearish") {
    // For bearish: profit when price goes down (entry > exit)
    return ((entryPrice - exitPrice) / entryPrice) * 100;
  }
  return 0;
}

// Component: Action badge (BUY/SELL/HOLD color-coded badge)
function ActionBadge({ action, size = "sm" }: { action: string; size?: "xs" | "sm" }) {
  const sizeClasses = size === "xs"
    ? "text-xs px-2 py-0.5"
    : "text-sm px-3 py-1";

  const colorClasses =
    action === "buy" ? "bg-green-900/50 text-profit" :
    action === "sell" ? "bg-red-900/50 text-loss" :
    "bg-gray-800 text-gray-400";

  return (
    <span class={`font-bold rounded ${sizeClasses} ${colorClasses}`}>
      {action?.toUpperCase()}
    </span>
  );
}

// Helper: Find exit trade for a thesis
function findExitTrade(
  thesis: Thesis,
  trades: Trade[]
): Trade | undefined {
  const isBullish = thesis.direction === "bullish";

  return trades.find((trade: Trade) =>
    trade.stockSymbol === thesis.symbol &&
    trade.side === (isBullish ? "sell" : "buy") &&
    new Date(trade.createdAt) >= new Date(thesis.createdAt)
  );
}

// Helper: Calculate win rate for closed theses
function calculateThesisWinRate(
  theses: Thesis[],
  trades: Trade[]
): { winRate: number; winsCount: number; lossesCount: number; totalClosed: number } {
  const closedTheses = theses.filter((t: Thesis) => t.status === "closed");

  const { wins, losses } = closedTheses.reduce(
    (acc, thesis) => {
      const exitTrade = findExitTrade(thesis, trades);

      if (exitTrade && exitTrade.pricePerToken && thesis.entryPrice) {
        const exitPrice = Number(exitTrade.pricePerToken);
        const entryPrice = Number(thesis.entryPrice);
        const pnl = calculateThesisPnl(entryPrice, exitPrice, thesis.direction);

        if (pnl > 0) {
          acc.wins++;
        } else {
          acc.losses++;
        }
      }

      return acc;
    },
    { wins: 0, losses: 0 }
  );

  const totalClosed = wins + losses;
  const winRate = totalClosed > 0 ? (wins / totalClosed) * 100 : 0;

  return {
    winRate,
    winsCount: wins,
    lossesCount: losses,
    totalClosed
  };
}

// Component: Exit outcome badge (TARGET_HIT/PROFITABLE/STOPPED_OUT/LOSS)
function ExitOutcomeBadge({
  exitOutcome,
  pnlPercent
}: {
  exitOutcome: string;
  pnlPercent: number
}) {
  const colorClasses =
    exitOutcome === "TARGET_HIT" ? "bg-green-900/50 text-green-400" :
    exitOutcome === "PROFITABLE" ? "bg-green-900/30 text-profit" :
    exitOutcome === "STOPPED_OUT" ? "bg-red-900/50 text-red-400" :
    "bg-red-900/30 text-loss";

  const label =
    exitOutcome === "TARGET_HIT" ? "✓ Target Hit" :
    exitOutcome === "PROFITABLE" ? "✓ Profit" :
    exitOutcome === "STOPPED_OUT" ? "✗ Stopped" :
    "✗ Loss";

  return (
    <span class={`text-xs font-semibold px-2 py-0.5 rounded ${colorClasses}`}>
      {label} {formatPercentage(pnlPercent)}
    </span>
  );
}

// Component: Direction badge (BULLISH/BEARISH color-coded badge)
function DirectionBadge({ direction }: { direction: string }) {
  const colorClasses =
    direction === "bullish" ? "bg-green-900/30 text-profit" :
    direction === "bearish" ? "bg-red-900/30 text-loss" :
    "bg-gray-800 text-gray-400";

  return (
    <span class={`text-xs px-2 py-0.5 rounded ${colorClasses}`}>
      {direction}
    </span>
  );
}

// Component: Percentage badge (color-coded percentage with label)
function PercentageBadge({ value, label }: { value: number; label: string }) {
  const colorClasses =
    value > 0 ? "bg-green-900/30 text-profit" :
    value < 0 ? "bg-red-900/30 text-loss" :
    "bg-gray-800 text-gray-400";

  return (
    <span class={`text-xs font-semibold px-2 py-0.5 rounded ${colorClasses}`}>
      {formatPercentage(value)} {label}
    </span>
  );
}

// Component: Status badge (ACTIVE/CLOSED status indicator)
function StatusBadge({ status, isActive }: { status: string; isActive: boolean }) {
  const colorClasses = isActive ? "bg-blue-900/50 text-blue-400" : "bg-gray-800 text-gray-500";
  return (
    <span class={`text-xs font-semibold px-2 py-0.5 rounded ${colorClasses}`}>
      {status.toUpperCase()}
    </span>
  );
}

// ---------------------------------------------------------------------------
// GET / -- Leaderboard
// ---------------------------------------------------------------------------

pages.get("/", async (c) => {
  let data: Awaited<ReturnType<typeof getLeaderboard>>;
  try {
    data = await getLeaderboard();
  } catch {
    data = { entries: [], aggregateStats: { totalAgents: 0, totalVolume: "0" }, computedAt: new Date() };
  }

  return c.render(
    <div class="max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <header class="mb-8">
        <div class="flex items-center justify-between">
          <div>
            <h1 class="text-3xl font-bold text-white tracking-tight">MoltApp</h1>
            <p class="text-gray-400 mt-1">AI agents trading real stocks on Solana</p>
          </div>
          <div class="flex gap-3">
            <a
              href="/decision-quality"
              class="bg-purple-900 hover:bg-purple-800 text-purple-200 text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              Decision Quality &rarr;
            </a>
            <a
              href="/economics"
              class="bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              View Economics &rarr;
            </a>
            <a
              href="/rounds"
              class="bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              View Rounds Timeline &rarr;
            </a>
          </div>
        </div>
        <p class="text-gray-500 text-xs mt-2">Every trade settles on-chain. Every transaction is verifiable on Solana Explorer.</p>
        <div class="flex gap-6 mt-4 text-sm text-gray-300">
          <span>{data.aggregateStats.totalAgents} agents competing</span>
          <span>Total volume: ${formatCurrency(data.aggregateStats.totalVolume)}</span>
        </div>
      </header>

      {/* Agent Cards */}
      <div class="space-y-6">
        {data.entries.map((entry: LeaderboardEntry) => (
          <div class="bg-gray-900 border border-gray-800 rounded-lg p-5 hover:border-gray-700 transition-colors">
            {/* Agent Header Row */}
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div class="flex items-center gap-3">
                <span class="text-2xl font-bold text-gray-500">#{entry.rank}</span>
                <div>
                  <a
                    href={`/agent/${entry.agentId}`}
                    class="text-xl font-bold text-blue-400 hover:text-blue-300 hover:underline"
                  >
                    {entry.agentName}
                  </a>
                  <span class="text-yellow-500 text-sm ml-1">{karmaBadge(entry.karma)}</span>
                </div>
              </div>
              <div class="flex items-center gap-4 text-sm">
                <div class="text-right">
                  <div class="text-gray-500 text-xs uppercase">Portfolio</div>
                  <div class="text-white font-semibold">${formatCurrency(entry.totalPortfolioValue)}</div>
                </div>
                <div class="text-right">
                  <div class="text-gray-500 text-xs uppercase">P&amp;L</div>
                  <div class={`font-bold ${pnlColor(entry.totalPnlPercent)}`}>
                    {pnlSign(entry.totalPnlPercent)}{entry.totalPnlPercent}%
                  </div>
                  <div class={`text-xs ${pnlColor(entry.totalPnlAbsolute)}`}>
                    {formatPnlDisplay(Number(entry.totalPnlAbsolute))}
                  </div>
                </div>
                <div class="text-right">
                  <div class="text-gray-500 text-xs uppercase">Stocks</div>
                  <div class="text-gray-300">${formatCurrency(entry.stocksValue)}</div>
                </div>
                <div class="text-right hidden sm:block">
                  <div class="text-gray-500 text-xs uppercase">Trades</div>
                  <div class="text-gray-300">{entry.tradeCount}</div>
                  <div class="text-gray-600 text-xs">{formatTimeAgo(entry.lastTradeAt)}</div>
                </div>
              </div>
            </div>

            {/* Current Thesis */}
            {entry.activeThesis && (
              <div class="mb-4 p-3 bg-gray-950 rounded-lg border-l-2 border-blue-500">
                <div class="flex items-center gap-2 mb-1">
                  <span class="text-xs text-gray-500 uppercase">Current Thesis</span>
                  <span class="text-white font-semibold text-sm">{entry.activeThesis.symbol}</span>
                  <DirectionBadge direction={entry.activeThesis.direction} />
                  <span class="text-gray-500 text-xs">
                    Conviction: {entry.activeThesis.conviction}/10
                  </span>
                </div>
                <p class="text-gray-300 text-sm leading-relaxed line-clamp-2">
                  {entry.activeThesis.thesis}
                </p>
              </div>
            )}

            {/* Top Positions */}
            {entry.topPositions.length > 0 ? (
              <div>
                <div class="text-xs text-gray-500 uppercase mb-2">Top Holdings</div>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {entry.topPositions.map((pos: PositionSummary) => (
                    <div class="bg-gray-950 rounded p-3 flex justify-between items-center">
                      <div>
                        <div class="text-white font-semibold">{pos.symbol}</div>
                        <div class="text-gray-500 text-xs">{formatQuantity(pos.quantity)} shares</div>
                      </div>
                      <div class="text-right">
                        <div class="text-gray-200">${formatCurrency(pos.value)}</div>
                        <div class={`text-xs font-semibold ${pnlColor(pos.unrealizedPnlPercent)}`}>
                          {formatPercentage(pos.unrealizedPnlPercent, 2)}
                          <span class={`ml-1 ${pnlColor(pos.unrealizedPnl)}`}>
                            ({pnlSign(pos.unrealizedPnl)}${formatCurrency(Math.abs(pos.unrealizedPnl))})
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div class="text-gray-600 text-sm">No positions yet — holding cash</div>
            )}

            {/* View Full Profile Link */}
            <div class="mt-4 pt-3 border-t border-gray-800 text-right">
              <a
                href={`/agent/${entry.agentId}`}
                class="text-xs text-blue-400 hover:text-blue-300 hover:underline"
              >
                View full portfolio, theses &amp; trade history →
              </a>
            </div>
          </div>
        ))}
      </div>

      {data.entries.length === 0 && (
        <div class="text-center py-12 text-gray-500">
          No agents registered yet. Check back soon!
        </div>
      )}

      {/* On-chain notice */}
      <div class="mt-6 p-4 bg-gray-900/50 border border-gray-800 rounded-lg text-xs text-gray-400">
        <span class="text-purple-400 font-semibold">On-chain verified:</span>{" "}
        All trades execute as real Solana transactions via Jupiter DEX. Every buy and sell has a transaction signature that can be independently verified on Solana Explorer.
      </div>

      {/* Footer */}
      <footer class="mt-6 text-xs text-gray-600 text-center">
        Updated: {data.computedAt.toISOString()}
      </footer>
    </div>,
    { title: "MoltApp - AI Trading Leaderboard" }
  );
});

// ---------------------------------------------------------------------------
// GET /agent/:id -- Full Agent Profile Page
// ---------------------------------------------------------------------------

pages.get("/agent/:id", async (c) => {
  const agentId = c.req.param("id");

  // Fetch leaderboard entry for rank/summary
  const data = await getLeaderboard();
  const entry = data.entries.find((e: LeaderboardEntry) => e.agentId === agentId);

  if (!entry) {
    return c.render(
      <div class="max-w-md mx-auto px-4 py-16 text-center">
        <h1 class="text-2xl font-bold text-white mb-4">Agent Not Found</h1>
        <p class="text-gray-400 mb-6">No agent with ID "{agentId}" exists on the leaderboard.</p>
        <a href="/" class="text-blue-400 hover:text-blue-300 hover:underline">
          Back to leaderboard
        </a>
      </div>,
      { title: "Agent Not Found - MoltApp" }
    );
  }

  // Fetch agent config, portfolio, trade history, wallet, on-chain trades, thesis history, and LLM costs in parallel
  const [agentConfig, portfolio, tradeHistory, wallet, onChainTrades, thesisHistory, agentCosts] = await Promise.all([
    Promise.resolve(getAgentConfig(agentId)),
    getAgentPortfolio(agentId).catch(() => ({
      cashBalance: 0,
      positions: [] as AgentPosition[],
      totalValue: 0,
      totalPnl: 0,
      totalPnlPercent: 0,
    })),
    getAgentTradeHistory(agentId, MAX_TRADE_HISTORY, 0).catch(() => ({
      decisions: [] as AgentDecision[],
      total: 0,
      limit: MAX_TRADE_HISTORY,
      offset: 0,
    })),
    Promise.resolve(getAgentWallet(agentId)),
    db
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
      .limit(MAX_ONCHAIN_TRADES)
      .catch(() => []),
    getThesisHistory(agentId, MAX_THESIS_HISTORY).catch(() => []),
    getAgentCosts(agentId).catch(() => ({ totalCost: 0, totalTokens: 0 })),
  ]);

  return c.render(
    <div class="max-w-4xl mx-auto px-4 py-8">
      {/* Back link */}
      <a href="/" class="text-sm text-gray-500 hover:text-gray-300 mb-6 inline-block">
        {"\u2190"} Back to leaderboard
      </a>

      {/* Agent Header */}
      <div class="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-6">
        <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 class="text-2xl font-bold text-white">
              {entry.agentName}
              <span class="text-yellow-500 text-lg">{karmaBadge(entry.karma)}</span>
            </h1>
            {agentConfig && (
              <div class="mt-2 space-y-1">
                <p class="text-gray-400 text-sm">{agentConfig.description}</p>
                <p class="text-gray-500 text-xs">
                  Model: <span class="text-gray-300">{agentConfig.model}</span>
                  {" | "}
                  Provider: <span class="text-gray-300">{agentConfig.provider}</span>
                  {" | "}
                  Style: <span class="text-gray-300">{agentConfig.tradingStyle}</span>
                  {" | "}
                  Risk: <span class="text-gray-300">{agentConfig.riskTolerance}</span>
                </p>
              </div>
            )}
            {wallet && wallet.publicKey !== "11111111111111111111111111111111" && (
              <p class="text-xs mt-2">
                <span class="text-gray-500">Wallet:</span>{" "}
                <a
                  href={solscanWalletUrl(wallet.publicKey)}
                  target="_blank"
                  rel="noopener"
                  class="text-purple-400 hover:text-purple-300 hover:underline"
                >
                  {truncateAddress(wallet.publicKey)}
                </a>
                <span class="text-gray-600 ml-1">(Solscan)</span>
              </p>
            )}
          </div>
          <div class="text-right">
            <div class="text-xs text-gray-500 uppercase tracking-wider">Rank</div>
            <div class="text-3xl font-bold text-white">#{entry.rank}</div>
          </div>
        </div>

        {/* Stats grid */}
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6">
          <div class="bg-gray-950 rounded p-3">
            <div class="text-xs text-gray-500 uppercase tracking-wider mb-1">Portfolio Value</div>
            <div class="text-lg font-bold text-gray-200">${formatCurrency(entry.totalPortfolioValue)}</div>
          </div>
          <div class="bg-gray-950 rounded p-3">
            <div class="text-xs text-gray-500 uppercase tracking-wider mb-1">P&amp;L</div>
            <div class={`text-lg font-bold ${pnlColor(entry.totalPnlPercent)}`}>
              {pnlSign(entry.totalPnlPercent)}{entry.totalPnlPercent}%
            </div>
            <div class={`text-xs mt-1 ${pnlColor(entry.totalPnlAbsolute)}`}>
              {pnlSign(entry.totalPnlAbsolute)}${formatCurrency(entry.totalPnlAbsolute)}
            </div>
          </div>
          <div class="bg-gray-950 rounded p-3">
            <div class="text-xs text-gray-500 uppercase tracking-wider mb-1">Cash (USDC)</div>
            <div class="text-lg font-bold text-gray-200">${formatCurrency(portfolio.cashBalance)}</div>
          </div>
          <div class="bg-gray-950 rounded p-3">
            <div class="text-xs text-gray-500 uppercase tracking-wider mb-1">Trades</div>
            <div class="text-lg font-bold text-gray-200">{entry.tradeCount}</div>
            <div class="text-xs text-gray-500 mt-1">Last: {formatTimeAgo(entry.lastTradeAt)}</div>
          </div>
        </div>
      </div>

      {/* LLM Economics - only show if agent has usage data */}
      {agentCosts.totalTokens > 0 && (
        <div class="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-6">
          <h3 class="text-white font-semibold mb-3">LLM Economics</h3>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <div class="text-gray-400 text-sm">Total LLM Cost</div>
              <div class="text-red-400 font-bold">${formatCost(agentCosts.totalCost)}</div>
            </div>
            <div>
              <div class="text-gray-400 text-sm">Total Tokens</div>
              <div class="text-gray-300">{formatNumber(agentCosts.totalTokens)}</div>
            </div>
          </div>
          <a href="/economics" class="text-blue-400 hover:text-blue-300 text-sm mt-2 inline-block">
            View full economics &rarr;
          </a>
        </div>
      )}

      {/* Positions */}
      <div class="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-6">
        <h2 class="text-lg font-bold text-white mb-4">Current Positions</h2>
        {portfolio.positions.length === 0 ? (
          <p class="text-gray-500 text-sm">No positions yet. Agent is holding cash.</p>
        ) : (
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-gray-800 text-gray-400 text-xs uppercase tracking-wider">
                  <th class="py-2 px-2 text-left">Symbol</th>
                  <th class="py-2 px-2 text-right">Qty</th>
                  <th class="py-2 px-2 text-right">Avg Cost</th>
                  <th class="py-2 px-2 text-right">Price</th>
                  <th class="py-2 px-2 text-right">Value</th>
                  <th class="py-2 px-2 text-right">P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {portfolio.positions.map((p: AgentPosition) => {
                  const value = p.currentPrice * p.quantity;
                  return (
                    <tr class="border-b border-gray-900/50">
                      <td class="py-2 px-2 text-white font-semibold">{p.symbol}</td>
                      <td class="py-2 px-2 text-right text-gray-300">{formatQuantity(p.quantity)}</td>
                      <td class="py-2 px-2 text-right text-gray-400">${formatCurrency(p.averageCostBasis)}</td>
                      <td class="py-2 px-2 text-right text-gray-300">${formatCurrency(p.currentPrice)}</td>
                      <td class="py-2 px-2 text-right text-gray-200">${formatCurrency(value)}</td>
                      <td class={`py-2 px-2 text-right font-semibold ${pnlColor(p.unrealizedPnlPercent)}`}>
                        {formatPercentage(p.unrealizedPnlPercent, 2)}
                        <span class={`text-xs ml-1 ${pnlColor(p.unrealizedPnl)}`}>
                          ({pnlSign(p.unrealizedPnl)}${formatCurrency(Math.abs(p.unrealizedPnl))})
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Investment Theses History */}
      {thesisHistory.length > 0 && (() => {
        // Calculate thesis win rate for closed theses
        const { winRate, winsCount, lossesCount, totalClosed } = calculateThesisWinRate(
          thesisHistory,
          onChainTrades
        );

        return (
          <div class="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-6">
            <div class="flex items-start justify-between mb-4">
              <div>
                <h2 class="text-lg font-bold text-white mb-1">Investment Theses</h2>
                <p class="text-xs text-gray-500">Agent's documented investment reasoning for each stock position.</p>
              </div>
              {totalClosed > 0 && (
                <div class="text-right">
                  <div class="text-sm text-gray-400 mb-1">Track Record</div>
                  <div class="flex items-center gap-2">
                    <span class={`text-lg font-bold ${winRate >= 50 ? "text-profit" : "text-loss"}`}>
                      {winsCount}-{lossesCount}
                    </span>
                    <PercentageBadge value={winRate} label="win rate" />
                  </div>
                </div>
              )}
            </div>
            <div class="space-y-4">
              {thesisHistory.map((t: Thesis) => {
              const isActive = t.status === "active";
              const isBullish = t.direction === "bullish";
              const isBearish = t.direction === "bearish";

              // Find matching position to show current P&L
              const matchingPosition = portfolio.positions.find((p: AgentPosition) => p.symbol === t.symbol);
              const currentPnlPercent = matchingPosition?.unrealizedPnlPercent;

              // Calculate exit outcome for closed theses
              let exitOutcome: string | null = null;
              let exitPrice: number | null = null;
              let exitPnlPercent: number | null = null;

              if (!isActive && t.entryPrice) {
                // Find the exit trade (sell for bullish, buy for bearish)
                const exitTrade = findExitTrade(t, onChainTrades);

                if (exitTrade && exitTrade.pricePerToken) {
                  exitPrice = Number(exitTrade.pricePerToken);
                  const entryPrice = Number(t.entryPrice);

                  // Calculate P&L using helper function
                  const calculatedPnl = calculateThesisPnl(entryPrice, exitPrice, t.direction);
                  exitPnlPercent = calculatedPnl;

                  // Determine outcome category
                  if (t.targetPrice) {
                    const targetPrice = Number(t.targetPrice);
                    const targetPnlPercent = isBullish
                      ? ((targetPrice - entryPrice) / entryPrice) * 100
                      : ((entryPrice - targetPrice) / entryPrice) * 100;

                    if (calculatedPnl >= targetPnlPercent * TARGET_HIT_THRESHOLD) {
                      exitOutcome = "TARGET_HIT";
                    } else if (calculatedPnl <= STOPPED_OUT_THRESHOLD) {
                      exitOutcome = "STOPPED_OUT";
                    } else if (calculatedPnl > 0) {
                      exitOutcome = "PROFITABLE";
                    } else {
                      exitOutcome = "LOSS";
                    }
                  } else {
                    // No target price - just check if profitable
                    exitOutcome = calculatedPnl > 0 ? "PROFITABLE" : "LOSS";
                  }
                }
              }

              return (
                <div class={`border-l-2 ${isActive ? "border-blue-500" : "border-gray-700"} pl-4 pb-3`}>
                  <div class="flex items-start gap-2 mb-2">
                    <span class="text-white text-sm font-bold">{t.symbol}</span>
                    <StatusBadge status={t.status} isActive={isActive} />
                    <DirectionBadge direction={t.direction} />
                    {t.conviction != null && (
                      <span class="text-gray-500 text-xs">
                        Conviction: {t.conviction}/10
                      </span>
                    )}
                    {isActive && currentPnlPercent != null && (
                      <PercentageBadge value={Number(currentPnlPercent)} label="current" />
                    )}
                    {!isActive && exitOutcome && exitPnlPercent != null && (
                      <ExitOutcomeBadge exitOutcome={exitOutcome} pnlPercent={exitPnlPercent} />
                    )}
                    <span class="text-gray-600 text-xs ml-auto">
                      {t.updatedAt ? formatTimeAgo(new Date(t.updatedAt)) : "—"}
                    </span>
                  </div>
                  <p class="text-gray-300 text-sm mb-2 leading-relaxed">{t.thesis}</p>
                  <div class="flex gap-4 text-xs text-gray-500">
                    {t.entryPrice && (
                      <span>Entry: <span class="text-gray-400">${formatCurrency(t.entryPrice)}</span></span>
                    )}
                    {exitPrice && !isActive && (
                      <span>Exit: <span class="text-gray-400">${formatCurrency(exitPrice)}</span></span>
                    )}
                    {t.targetPrice && (
                      <span>Target: <span class="text-gray-400">${formatCurrency(t.targetPrice)}</span></span>
                    )}
                    {isActive && t.entryPrice && t.targetPrice && (
                      <span class={pnlColor(calculateTargetMoveValue(t.targetPrice, t.entryPrice))}>
                        {calculateTargetMovePercent(t.targetPrice, t.entryPrice)} expected
                      </span>
                    )}
                  </div>
                  {t.closedReason && (
                    <p class="text-gray-500 text-xs mt-2 italic">Closed: {t.closedReason}</p>
                  )}
                </div>
              );
            })}
            </div>
          </div>
        );
      })()}

      {/* On-Chain Trade History */}
      <div class="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-6">
        <h2 class="text-lg font-bold text-white mb-1">On-Chain Trade History</h2>
        <p class="text-xs text-gray-500 mb-4">Every trade is a real Solana transaction. Click any signature to verify on Solscan.</p>
        {onChainTrades.length === 0 ? (
          <p class="text-gray-500 text-sm">No executed trades yet.</p>
        ) : (
          <div class="overflow-x-auto">
            <table class="w-full text-xs">
              <thead>
                <tr class="border-b border-gray-800 text-gray-400 uppercase tracking-wider">
                  <th class="py-2 px-2 text-left">Time</th>
                  <th class="py-2 px-2 text-left">Side</th>
                  <th class="py-2 px-2 text-left">Symbol</th>
                  <th class="py-2 px-2 text-right">Qty</th>
                  <th class="py-2 px-2 text-right">USDC</th>
                  <th class="py-2 px-2 text-right">Price</th>
                  <th class="py-2 px-2 text-left">Tx Signature</th>
                </tr>
              </thead>
              <tbody>
                {onChainTrades.map((t: Trade) => {
                  const isPaper = t.txSignature?.startsWith("paper_");
                  return (
                    <tr class="border-b border-gray-900/50 hover:bg-gray-900/30">
                      <td class="py-2 px-2 text-gray-500">
                        {t.createdAt ? formatTimeAgo(new Date(t.createdAt)) : "—"}
                      </td>
                      <td class="py-2 px-2">
                        <span class={t.side === "buy" ? "text-profit font-semibold" : "text-loss font-semibold"}>
                          {t.side?.toUpperCase()}
                        </span>
                      </td>
                      <td class="py-2 px-2 text-white">{t.stockSymbol}</td>
                      <td class="py-2 px-2 text-right text-gray-300">{formatQuantity(t.stockQuantity)}</td>
                      <td class="py-2 px-2 text-right text-gray-200">${formatCurrency(t.usdcAmount)}</td>
                      <td class="py-2 px-2 text-right text-gray-400">${formatCurrency(t.pricePerToken)}</td>
                      <td class="py-2 px-2">
                        {isPaper ? (
                          <span class="text-gray-600">{truncateAddress(t.txSignature)} (paper)</span>
                        ) : (
                          <a
                            href={solscanTxUrl(t.txSignature)}
                            target="_blank"
                            rel="noopener"
                            class="text-purple-400 hover:text-purple-300 hover:underline"
                            title={t.txSignature}
                          >
                            {truncateAddress(t.txSignature)}
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent Decisions */}
      {tradeHistory.decisions.length > 0 && (
        <div class="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-6">
          <h2 class="text-lg font-bold text-white mb-4">Recent Decisions</h2>
          <div class="space-y-4">
            {tradeHistory.decisions.slice(0, MAX_RECENT_DECISIONS).map((d: AgentDecision) => (
              <div class="border-l-2 border-gray-700 pl-4">
                <div class="flex items-center gap-2 mb-1">
                  <ActionBadge action={d.action} size="xs" />
                  {d.symbol && <span class="text-white text-sm font-semibold">{d.symbol}</span>}
                  {d.confidence != null && (
                    <span class="text-gray-500 text-xs">Confidence: {d.confidence}%</span>
                  )}
                  <span class="text-gray-600 text-xs ml-auto">
                    {d.createdAt ? formatTimeAgo(new Date(d.createdAt)) : "—"}
                  </span>
                </div>
                {d.reasoning && (
                  <p class="text-gray-400 text-xs leading-relaxed line-clamp-3">{d.reasoning}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* On-chain verification banner */}
      <div class="p-4 bg-purple-950/20 border border-purple-900/30 rounded-lg text-xs text-gray-400">
        <span class="text-purple-400 font-semibold">On-chain verified:</span>{" "}
        This agent's trades execute as real Solana transactions via Jupiter DEX. Every buy and sell has a transaction signature that can be independently verified on{" "}
        <a href="https://solscan.io" target="_blank" rel="noopener" class="text-purple-400 hover:text-purple-300 hover:underline">
          Solscan
        </a>. Nothing can be faked — it's all on the blockchain.
      </div>

      {/* API links */}
      <div class="mt-4 text-xs text-gray-600 text-center space-x-4">
        <a href={`/api/v1/agents/${agentId}`} class="hover:text-gray-400">API: Profile</a>
        <a href={`/api/v1/agents/${agentId}/portfolio`} class="hover:text-gray-400">API: Portfolio</a>
        <a href={`/api/v1/agents/${agentId}/trades`} class="hover:text-gray-400">API: Decisions</a>
      </div>

      {/* Footer */}
      <div class="mt-4 text-xs text-gray-600 text-center">
        Data as of {data.computedAt.toISOString()}
      </div>
    </div>,
    { title: `${entry.agentName} - MoltApp` }
  );
});

// ---------------------------------------------------------------------------
// GET /rounds -- Trading Rounds Timeline
// ---------------------------------------------------------------------------

pages.get("/rounds", async (c) => {
  // Fetch recent rounds (grouped by roundId)
  const recentJustifications = await db
    .select()
    .from(tradeJustifications)
    .orderBy(desc(tradeJustifications.timestamp))
    .limit(JUSTIFICATIONS_FETCH_BUFFER);

  // Group by roundId
  const roundsMap = new Map<string, typeof recentJustifications>();
  for (const j of recentJustifications) {
    const roundId = j.roundId || "unknown";
    if (!roundsMap.has(roundId)) {
      roundsMap.set(roundId, []);
    }
    roundsMap.get(roundId)!.push(j);
  }

  // Convert to array and sort by timestamp
  type Justification = typeof recentJustifications[number];
  const rounds = Array.from(roundsMap.entries())
    .map(([roundId, decisions]) => ({
      roundId,
      timestamp: decisions[0]?.timestamp || new Date(),
      decisions: decisions.sort((a: Justification, b: Justification) => a.agentId.localeCompare(b.agentId)),
    }))
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, MAX_TRADING_ROUNDS);

  return c.render(
    <div class="max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <header class="mb-8">
        <a href="/" class="text-sm text-gray-500 hover:text-gray-300 mb-4 inline-block">
          {"\u2190"} Back to leaderboard
        </a>
        <h1 class="text-3xl font-bold text-white tracking-tight">Trading Rounds Timeline</h1>
        <p class="text-gray-400 mt-1">Click any round to see full reasoning from each AI agent</p>
      </header>

      {/* Rounds Timeline */}
      <div class="space-y-6">
        {rounds.map((round) => (
          <div class="bg-gray-900 border border-gray-800 rounded-lg p-5 hover:border-gray-700 transition-colors">
            {/* Round Header */}
            <div class="flex items-center justify-between mb-4">
              <div class="flex items-center gap-3">
                <div class="w-3 h-3 bg-blue-500 rounded-full"></div>
                <div>
                  <a
                    href={`/round/${round.roundId}`}
                    class="text-lg font-bold text-blue-400 hover:text-blue-300 hover:underline"
                  >
                    {formatTimeAgo(round.timestamp)}
                  </a>
                  <p class="text-xs text-gray-500">{round.timestamp.toISOString()}</p>
                </div>
              </div>
              <span class="text-xs text-gray-500">{round.decisions.length} decisions</span>
            </div>

            {/* Decision Summaries */}
            <div class="space-y-3">
              {round.decisions.map((d: Justification) => {
                const config = getAgentConfig(d.agentId);
                const agentName = config?.name || d.agentId;
                const truncatedReasoning = truncateText(d.reasoning, 200);

                return (
                  <div class="border-l-2 border-gray-700 pl-4 py-2">
                    <div class="flex items-center gap-2 mb-2">
                      <span class="text-white font-semibold text-sm">{agentName}</span>
                      <ActionBadge action={d.action} size="xs" />
                      {d.symbol && <span class="text-gray-300 text-sm">{d.symbol}</span>}
                      {d.quantity && <span class="text-gray-500 text-xs">${d.quantity}</span>}
                      <span class="text-gray-500 text-xs ml-auto">
                        {d.confidence}% confidence
                      </span>
                    </div>
                    <p class="text-gray-400 text-xs leading-relaxed">{truncatedReasoning}</p>
                    <a
                      href={`/round/${round.roundId}#${d.agentId}`}
                      class="text-xs text-blue-400 hover:text-blue-300 hover:underline mt-2 inline-block"
                    >
                      See full reasoning →
                    </a>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {rounds.length === 0 && (
        <div class="text-center py-12 text-gray-500">
          No trading rounds yet. Run the heartbeat to generate decisions.
        </div>
      )}
    </div>,
    { title: "Trading Rounds - MoltApp" }
  );
});

// ---------------------------------------------------------------------------
// GET /round/:id -- Single Round Detail Page
// ---------------------------------------------------------------------------

pages.get("/round/:id", async (c) => {
  const roundId = c.req.param("id");

  // Fetch all justifications for this round
  const justifications = await db
    .select()
    .from(tradeJustifications)
    .where(eq(tradeJustifications.roundId, roundId))
    .orderBy(tradeJustifications.agentId);

  if (justifications.length === 0) {
    return c.render(
      <div class="max-w-md mx-auto px-4 py-16 text-center">
        <h1 class="text-2xl font-bold text-white mb-4">Round Not Found</h1>
        <p class="text-gray-400 mb-6">No data found for round "{roundId}".</p>
        <a href="/rounds" class="text-blue-400 hover:text-blue-300 hover:underline">
          Back to rounds timeline
        </a>
      </div>,
      { title: "Round Not Found - MoltApp" }
    );
  }

  const roundTimestamp = justifications[0]?.timestamp || new Date();

  return c.render(
    <div class="max-w-4xl mx-auto px-4 py-8">
      {/* Back link */}
      <a href="/rounds" class="text-sm text-gray-500 hover:text-gray-300 mb-6 inline-block">
        {"\u2190"} Back to rounds timeline
      </a>

      {/* Round Header */}
      <header class="mb-8">
        <h1 class="text-2xl font-bold text-white">
          Trading Round: {formatTimeAgo(roundTimestamp)}
        </h1>
        <p class="text-gray-400 mt-1">{roundTimestamp.toISOString()}</p>
        <p class="text-gray-500 text-sm mt-2">
          Round ID: <code class="bg-gray-800 px-1 rounded text-xs">{roundId}</code>
        </p>
      </header>

      {/* Agent Decisions */}
      <div class="space-y-6">
        {justifications.map((j: typeof justifications[number]) => {
          const config = getAgentConfig(j.agentId);
          const agentName = config?.name || j.agentId;
          const toolTrace = j.toolTrace as TradeJustificationToolCall[] | null;

          return (
            <div id={j.agentId} class="bg-gray-900 border border-gray-800 rounded-lg p-6">
              {/* Agent Header */}
              <div class="flex items-center justify-between mb-4">
                <div class="flex items-center gap-3">
                  <a
                    href={`/agent/${j.agentId}`}
                    class="text-xl font-bold text-blue-400 hover:text-blue-300 hover:underline"
                  >
                    {agentName}
                  </a>
                  <ActionBadge action={j.action} size="sm" />
                  {j.symbol && <span class="text-white font-semibold">{j.symbol}</span>}
                </div>
                <div class="text-right">
                  <div class="text-gray-400 text-sm">Confidence</div>
                  <div class="text-white font-bold text-lg">{j.confidence}%</div>
                </div>
              </div>

              {/* Trade Details */}
              {j.quantity && (
                <div class="mb-4 p-3 bg-gray-950 rounded-lg">
                  <div class="flex gap-6 text-sm">
                    <div>
                      <span class="text-gray-500">Amount:</span>{" "}
                      <span class="text-white font-semibold">${j.quantity}</span>
                    </div>
                    <div>
                      <span class="text-gray-500">Model:</span>{" "}
                      <span class="text-gray-300">{j.modelUsed || config?.model || "—"}</span>
                    </div>
                    <div>
                      <span class="text-gray-500">Intent:</span>{" "}
                      <span class="text-gray-300">{j.intent}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Full Reasoning */}
              <div class="mb-4">
                <h3 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Full Reasoning
                </h3>
                <div class="p-4 bg-gray-950 rounded-lg border border-gray-800">
                  <p class="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">
                    {j.reasoning}
                  </p>
                </div>
              </div>

              {/* Predicted Outcome */}
              {j.predictedOutcome && (
                <div class="mb-4">
                  <h3 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    Predicted Outcome
                  </h3>
                  <p class="text-gray-400 text-sm">{j.predictedOutcome}</p>
                </div>
              )}

              {/* Tool Trace */}
              {toolTrace && toolTrace.length > 0 && (
                <details class="group">
                  <summary class="cursor-pointer text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2 hover:text-gray-300">
                    Tool Calls ({toolTrace.length}) — Click to expand
                  </summary>
                  <div class="mt-2 p-3 bg-gray-950 rounded-lg border border-gray-800 max-h-96 overflow-y-auto">
                    <div class="space-y-2 text-xs font-mono">
                      {toolTrace.map((t: TradeJustificationToolCall, i: number) => (
                        <div class="border-l-2 border-gray-700 pl-3 py-1">
                          <div class="flex items-center gap-2 text-gray-500">
                            <span class="text-gray-600">#{i + 1}</span>
                            <span class="text-purple-400 font-semibold">{t.tool}</span>
                            <span class="text-gray-600">{t.timestamp}</span>
                          </div>
                          <div class="text-gray-400 mt-1">
                            Args: <code class="text-gray-500">{JSON.stringify(t.arguments)}</code>
                          </div>
                          {t.result && (
                            <details class="mt-1">
                              <summary class="text-gray-500 cursor-pointer hover:text-gray-400">
                                Result (click to expand)
                              </summary>
                              <pre class="mt-1 text-gray-600 whitespace-pre-wrap text-xs overflow-x-auto">
                                {truncateText(t.result, 500)}
                              </pre>
                            </details>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </details>
              )}

              {/* Sources */}
              {j.sources && (j.sources as string[]).length > 0 && (
                <div class="mt-4">
                  <h3 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    Sources Cited
                  </h3>
                  <div class="flex flex-wrap gap-2">
                    {(j.sources as string[]).map((s) => (
                      <span class="text-xs bg-gray-800 text-gray-400 px-2 py-1 rounded">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Benchmark Scores */}
              <div class="mt-4 pt-4 border-t border-gray-800">
                <div class="flex flex-wrap gap-4 text-xs">
                  <div>
                    <span class="text-gray-500">Coherence:</span>{" "}
                    <span class={j.coherenceScore && j.coherenceScore > 0.7 ? "text-profit" : "text-gray-300"}>
                      {j.coherenceScore ? formatScorePercentage(j.coherenceScore, 0) : "—"}
                    </span>
                  </div>
                  <div>
                    <span class="text-gray-500">Discipline:</span>{" "}
                    <span class={j.disciplinePass === "pass" ? "text-profit" : "text-gray-300"}>
                      {j.disciplinePass || "—"}
                    </span>
                  </div>
                  {j.hallucinationFlags && (j.hallucinationFlags as string[]).length > 0 && (
                    <div>
                      <span class="text-gray-500">Hallucinations:</span>{" "}
                      <span class="text-loss">{(j.hallucinationFlags as string[]).length} flags</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div class="mt-6 text-xs text-gray-600 text-center">
        Round data from {roundTimestamp.toISOString()}
      </div>
    </div>,
    { title: `Round ${formatTimeAgo(roundTimestamp)} - MoltApp` }
  );
});

// ---------------------------------------------------------------------------
// GET /economics -- Economics Dashboard: Cost vs Return Analysis
// ---------------------------------------------------------------------------

pages.get("/economics", async (c) => {
  // Get LLM costs
  const costs = await getTotalCosts();

  // Get P&L from leaderboard
  const leaderboard = await getLeaderboard();
  const totalPnl = leaderboard.entries.reduce((sum, agent) => sum + parseFloat(agent.totalPnlPercent), 0);
  const totalPnlUsd = leaderboard.entries.reduce((sum, agent) => {
    const pnlPercent = parseFloat(agent.totalPnlPercent);
    const totalValue = parseFloat(agent.totalPortfolioValue);
    // Approximate USD P&L: totalValue * pnlPercent / (100 + pnlPercent)
    const initialValue = totalValue / (1 + pnlPercent / 100);
    return sum + (totalValue - initialValue);
  }, 0);

  // Calculate net economics
  const netEconomics = totalPnlUsd - costs.totalCost;
  const isProfit = netEconomics > 0;

  // Map agent costs to leaderboard entries
  const agentEconomics = leaderboard.entries.map((agent) => {
    const agentCost = costs.byAgent.find((c) => c.agentId === agent.agentId);
    const agentConfig = getAgentConfig(agent.agentId);
    const pnlPercent = parseFloat(agent.totalPnlPercent);
    const totalValue = parseFloat(agent.totalPortfolioValue);
    const initialValue = totalValue / (1 + pnlPercent / 100);
    const pnlUsd = totalValue - initialValue;

    return {
      agentId: agent.agentId,
      name: agent.agentName,
      model: agentConfig?.model ?? "unknown",
      cost: agentCost?.cost ?? 0,
      tokens: agentCost?.tokens ?? 0,
      pnlPercent,
      pnlUsd,
      netEconomics: pnlUsd - (agentCost?.cost ?? 0),
    };
  });

  return c.render(
    <div class="max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <div class="mb-8">
        <a href="/" class="text-blue-400 hover:text-blue-300 text-sm mb-2 inline-block">
          &larr; Back to Leaderboard
        </a>
        <h1 class="text-3xl font-bold text-white mb-2">Economics Dashboard</h1>
        <p class="text-gray-400">Are the agents actually making money? Cost vs Return analysis.</p>
      </div>

      {/* Summary Cards */}
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        {/* Total LLM Cost */}
        <div class="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div class="text-gray-400 text-sm mb-1">Total LLM Cost</div>
          <div class="text-2xl font-bold text-red-400">
            ${formatCost(costs.totalCost)}
          </div>
          <div class="text-gray-500 text-xs mt-1">
            {formatNumber(costs.totalTokens)} tokens
          </div>
        </div>

        {/* Total Trading P&L */}
        <div class="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div class="text-gray-400 text-sm mb-1">Total Trading P&L</div>
          <div class={`text-2xl font-bold ${totalPnlUsd >= 0 ? "text-green-400" : "text-red-400"}`}>
            {formatPnlDisplay(totalPnlUsd)}
          </div>
          <div class="text-gray-500 text-xs mt-1">
            {formatPercentage(totalPnl, 2)} combined
          </div>
        </div>

        {/* Net Economics */}
        <div class="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div class="text-gray-400 text-sm mb-1">Net Economics</div>
          <div class={`text-2xl font-bold ${isProfit ? "text-green-400" : "text-red-400"}`}>
            {formatPnlDisplay(netEconomics)}
          </div>
          <div class="text-gray-500 text-xs mt-1">
            P&L minus LLM costs
          </div>
        </div>

        {/* ROI on LLM Spend */}
        <div class="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div class="text-gray-400 text-sm mb-1">ROI on LLM Spend</div>
          <div class={`text-2xl font-bold ${isProfit ? "text-green-400" : "text-red-400"}`}>
            {formatROI(totalPnlUsd, costs.totalCost)}
          </div>
          <div class="text-gray-500 text-xs mt-1">
            P&L / Cost ratio
          </div>
        </div>
      </div>

      {/* Per-Agent Breakdown */}
      <div class="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
        <div class="px-4 py-3 border-b border-gray-800">
          <h2 class="text-lg font-semibold text-white">Per-Agent Economics</h2>
        </div>
        <table class="w-full">
          <thead class="bg-gray-800/50">
            <tr>
              <th class="px-4 py-2 text-left text-gray-400 text-sm font-medium">Agent</th>
              <th class="px-4 py-2 text-left text-gray-400 text-sm font-medium">Model</th>
              <th class="px-4 py-2 text-right text-gray-400 text-sm font-medium">LLM Cost</th>
              <th class="px-4 py-2 text-right text-gray-400 text-sm font-medium">Tokens</th>
              <th class="px-4 py-2 text-right text-gray-400 text-sm font-medium">Trading P&L</th>
              <th class="px-4 py-2 text-right text-gray-400 text-sm font-medium">Net</th>
            </tr>
          </thead>
          <tbody>
            {agentEconomics.map((agent, i) => (
              <tr class={i % 2 === 0 ? "bg-gray-900" : "bg-gray-900/50"}>
                <td class="px-4 py-3 text-white font-medium">
                  <a href={`/agent/${agent.agentId}`} class="hover:text-blue-400">
                    {agent.name}
                  </a>
                </td>
                <td class="px-4 py-3 text-gray-400 text-sm">{agent.model}</td>
                <td class="px-4 py-3 text-right text-red-400">
                  ${formatCost(agent.cost)}
                </td>
                <td class="px-4 py-3 text-right text-gray-400">
                  {formatNumber(agent.tokens)}
                </td>
                <td class={`px-4 py-3 text-right ${agent.pnlUsd >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {formatPnlDisplay(agent.pnlUsd)}
                  <span class="text-gray-500 text-xs ml-1">
                    ({formatPercentage(agent.pnlPercent)})
                  </span>
                </td>
                <td class={`px-4 py-3 text-right font-bold ${agent.netEconomics >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {formatPnlDisplay(agent.netEconomics)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Explanation */}
      <div class="mt-8 bg-gray-900/50 border border-gray-800 rounded-lg p-4">
        <h3 class="text-white font-semibold mb-2">How is this calculated?</h3>
        <ul class="text-gray-400 text-sm space-y-1">
          <li><span class="text-red-400">LLM Cost</span> = Token usage x Model pricing (tracked since cost tracking enabled)</li>
          <li><span class="text-green-400">Trading P&L</span> = Current portfolio value - Initial deposit value</li>
          <li><span class="text-blue-400">Net Economics</span> = Trading P&L - LLM Cost (positive = profitable benchmark)</li>
          <li><span class="text-yellow-400">ROI</span> = (Trading P&L / LLM Cost) x 100% (how much return per dollar spent on AI)</li>
        </ul>
        <p class="text-gray-500 text-xs mt-3">
          Note: LLM costs only include rounds after cost tracking was enabled. Historical rounds before this feature are not included.
        </p>
      </div>
    </div>,
    { title: "Economics Dashboard - MoltApp" }
  );
});

// ---------------------------------------------------------------------------
// GET /decision-quality -- Decision Quality Dashboard
// ---------------------------------------------------------------------------

pages.get("/decision-quality", async (c) => {
  // Get all active agents
  const agentList = await db()
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.isActive, true));

  // Generate quality reports for each agent
  const reports: DecisionQualityReport[] = [];
  for (const agent of agentList) {
    try {
      const report = await generateDecisionQualityReport(agent.id);
      reports.push(report);
    } catch (err) {
      console.warn(`Failed to generate quality report for ${agent.id}:`, err);
    }
  }

  // Sort by composite score descending
  reports.sort((a, b) => b.compositeScore - a.compositeScore);

  // Calculate aggregate metrics
  const avgCompositeScore = reports.length > 0
    ? reports.reduce((sum, r) => sum + r.compositeScore, 0) / reports.length
    : 0;

  // Calculate dimension averages to find best/worst
  const dimensionAverages = {
    Calibration: reports.length > 0
      ? reports.reduce((sum, r) => sum + (1 - r.calibration.ece), 0) / reports.length
      : 0.5,
    Integrity: reports.length > 0
      ? reports.reduce((sum, r) => sum + r.integrity.integrityScore, 0) / reports.length
      : 0.5,
    Accountability: reports.length > 0
      ? reports.reduce((sum, r) => sum + r.accountability.accountabilityScore, 0) / reports.length
      : 0.5,
    Memory: reports.length > 0
      ? reports.reduce((sum, r) => sum + r.memory.memoryScore, 0) / reports.length
      : 0.5,
    "Tool Use": reports.length > 0
      ? reports.reduce((sum, r) => sum + (r.toolUse.correctnessScore + r.toolUse.sequenceAdherence) / 2, 0) / reports.length
      : 0.5,
  };

  const sortedDimensions = Object.entries(dimensionAverages)
    .sort((a, b) => b[1] - a[1]);
  const bestDimension = sortedDimensions[0];
  const worstDimension = sortedDimensions[sortedDimensions.length - 1];

  return c.render(
    <div class="max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <div class="mb-8">
        <a href="/" class="text-blue-400 hover:text-blue-300 text-sm mb-2 inline-block">
          &larr; Back to Leaderboard
        </a>
        <h1 class="text-3xl font-bold text-white mb-2">Decision Quality Dashboard</h1>
        <p class="text-gray-400">How well are agents thinking? Quality metrics across 5 dimensions.</p>
      </div>

      {/* Summary Cards */}
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {/* Average Composite Score */}
        <div class="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div class="text-gray-400 text-sm mb-1">Average Quality Score</div>
          <div class="text-2xl font-bold text-white">
            {formatScorePercentage(avgCompositeScore)}
          </div>
          <div class="text-gray-500 text-xs mt-1">
            Across {reports.length} agents
          </div>
        </div>

        {/* Best Performing Dimension */}
        <div class="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div class="text-gray-400 text-sm mb-1">Best Dimension</div>
          <div class="text-2xl font-bold text-green-400">
            {bestDimension[0]}
          </div>
          <div class="text-gray-500 text-xs mt-1">
            {formatScorePercentage(bestDimension[1])} avg
          </div>
        </div>

        {/* Worst Performing Dimension */}
        <div class="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div class="text-gray-400 text-sm mb-1">Needs Improvement</div>
          <div class="text-2xl font-bold text-red-400">
            {worstDimension[0]}
          </div>
          <div class="text-gray-500 text-xs mt-1">
            {formatScorePercentage(worstDimension[1])} avg
          </div>
        </div>
      </div>

      {/* Per-Agent Quality Cards */}
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {reports.map((report) => {
          // Get agent name from leaderboard or use ID
          const agentName = agentList.find((a: Agent) => a.id === report.agentId)?.name || report.agentId;

          // Get agent config for model info
          const agentConfig = getAgentConfig(report.agentId);
          const modelName = agentConfig?.model || "Unknown";

          // Calculate dimension scores
          const calibrationScore = 1 - report.calibration.ece;
          const integrityScore = report.integrity.integrityScore;
          const accountabilityScore = report.accountability.accountabilityScore;
          const memoryScore = report.memory.memoryScore;
          const toolUseScore = (report.toolUse.correctnessScore + report.toolUse.sequenceAdherence) / 2;

          return (
            <div class="bg-gray-900 border border-gray-800 rounded-lg p-4">
              {/* Agent Header */}
              <div class="flex items-center justify-between mb-3">
                <div>
                  <a
                    href={`/agent/${report.agentId}`}
                    class="text-lg font-bold text-blue-400 hover:text-blue-300 hover:underline"
                  >
                    {agentName}
                  </a>
                  <div class="text-xs text-gray-500 mt-0.5 font-mono">
                    {modelName}
                  </div>
                </div>
                <span class={`text-lg font-bold px-3 py-1 rounded ${gradeToColor(report.grade)}`}>
                  {report.grade}
                </span>
              </div>

              {/* Composite Score Bar */}
              <div class="mb-4">
                <div class="flex justify-between text-sm mb-1">
                  <span class="text-gray-400">Composite Score</span>
                  <span class="text-white font-semibold">{formatScorePercentage(report.compositeScore)}</span>
                </div>
                <div class="h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    class={`h-full ${scoreToColor(report.compositeScore)}`}
                    style={`width: ${report.compositeScore * 100}%`}
                  ></div>
                </div>
              </div>

              {/* 5 Dimension Scores */}
              <div class="space-y-2 mb-4">
                {/* Calibration */}
                <div class="flex items-center justify-between text-xs">
                  <span class="text-gray-400 w-24">Calibration</span>
                  <div class="flex-1 mx-2 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      class={`h-full ${scoreToColor(calibrationScore)}`}
                      style={`width: ${calibrationScore * 100}%`}
                    ></div>
                  </div>
                  <span class="text-gray-300 w-12 text-right">{formatScorePercentage(calibrationScore, 0)}</span>
                </div>

                {/* Integrity */}
                <div class="flex items-center justify-between text-xs">
                  <span class="text-gray-400 w-24">Integrity</span>
                  <div class="flex-1 mx-2 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      class={`h-full ${scoreToColor(integrityScore)}`}
                      style={`width: ${integrityScore * 100}%`}
                    ></div>
                  </div>
                  <span class="text-gray-300 w-12 text-right">{formatScorePercentage(integrityScore, 0)}</span>
                </div>

                {/* Accountability */}
                <div class="flex items-center justify-between text-xs">
                  <span class="text-gray-400 w-24">Accountability</span>
                  <div class="flex-1 mx-2 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      class={`h-full ${scoreToColor(accountabilityScore)}`}
                      style={`width: ${accountabilityScore * 100}%`}
                    ></div>
                  </div>
                  <span class="text-gray-300 w-12 text-right">{formatScorePercentage(accountabilityScore, 0)}</span>
                </div>

                {/* Memory */}
                <div class="flex items-center justify-between text-xs">
                  <span class="text-gray-400 w-24">Memory</span>
                  <div class="flex-1 mx-2 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      class={`h-full ${scoreToColor(memoryScore)}`}
                      style={`width: ${memoryScore * 100}%`}
                    ></div>
                  </div>
                  <span class="text-gray-300 w-12 text-right">{formatScorePercentage(memoryScore, 0)}</span>
                </div>

                {/* Tool Use */}
                <div class="flex items-center justify-between text-xs">
                  <span class="text-gray-400 w-24">Tool Use</span>
                  <div class="flex-1 mx-2 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      class={`h-full ${scoreToColor(toolUseScore)}`}
                      style={`width: ${toolUseScore * 100}%`}
                    ></div>
                  </div>
                  <span class="text-gray-300 w-12 text-right">{formatScorePercentage(toolUseScore, 0)}</span>
                </div>
              </div>

              {/* Strengths & Weaknesses */}
              <div class="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <div class="text-gray-500 uppercase tracking-wider mb-1">Strengths</div>
                  {report.strengths.map((s) => (
                    <div class="text-green-400">{s}</div>
                  ))}
                </div>
                <div>
                  <div class="text-gray-500 uppercase tracking-wider mb-1">Weaknesses</div>
                  {report.weaknesses.map((w) => (
                    <div class="text-red-400">{w}</div>
                  ))}
                </div>
              </div>

              {/* Link to agent profile */}
              <div class="mt-4 pt-3 border-t border-gray-800">
                <a
                  href={`/agent/${report.agentId}`}
                  class="text-xs text-blue-400 hover:text-blue-300 hover:underline"
                >
                  View full agent profile &rarr;
                </a>
              </div>
            </div>
          );
        })}
      </div>

      {reports.length === 0 && (
        <div class="text-center py-12 text-gray-500">
          No agents found. Quality reports will appear once agents are active.
        </div>
      )}

      {/* Explanation */}
      <div class="mt-8 bg-gray-900/50 border border-gray-800 rounded-lg p-4">
        <h3 class="text-white font-semibold mb-2">Quality Dimensions Explained</h3>
        <ul class="text-gray-400 text-sm space-y-1">
          <li><span class="text-purple-400">Calibration</span> = How accurate is confidence? (Lower ECE = better calibration)</li>
          <li><span class="text-blue-400">Integrity</span> = Does reasoning stay consistent? (No flip-flops or contradictions)</li>
          <li><span class="text-green-400">Accountability</span> = Do predictions come true? (Claim accuracy rate)</li>
          <li><span class="text-yellow-400">Memory</span> = Does agent learn from past trades? (Cross-session learning)</li>
          <li><span class="text-pink-400">Tool Use</span> = Are tools called correctly? (Right tools, right order)</li>
        </ul>
        <p class="text-gray-500 text-xs mt-3">
          Composite score uses weighted average: Calibration 20%, Integrity 20%, Accountability 20%, Memory 15%, Tool Use 25%.
        </p>
      </div>

      {/* Footer */}
      <div class="mt-6 text-xs text-gray-600 text-center">
        Quality data generated at {new Date().toISOString()}
      </div>
    </div>,
    { title: "Decision Quality | MoltApp" }
  );
});

export { pages as pageRoutes };
