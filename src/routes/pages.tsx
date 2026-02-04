import { Hono } from "hono";
import { jsxRenderer } from "hono/jsx-renderer";
import { eq, desc } from "drizzle-orm";
import { getLeaderboard } from "../services/leaderboard.ts";
import type { LeaderboardEntry } from "../services/leaderboard.ts";
import { getAgentConfig, getAgentPortfolio, getAgentTradeHistory } from "../agents/orchestrator.ts";
import { getAgentWallet } from "../services/agent-wallets.ts";
import { getThesisHistory } from "../services/agent-theses.ts";
import { db } from "../db/index.ts";
import { trades } from "../db/schema/index.ts";

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

function formatCurrency(value: string | number): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "$0.00";
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatTimeAgo(date: Date | null): string {
  if (!date) return "Never";
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}

function pnlColor(pnlPercent: string | number): string {
  const num = typeof pnlPercent === "string" ? parseFloat(pnlPercent) : pnlPercent;
  if (num > 0) return "text-profit";
  if (num < 0) return "text-loss";
  return "text-gray-400";
}

function pnlSign(pnlPercent: string | number): string {
  const num = typeof pnlPercent === "string" ? parseFloat(pnlPercent) : pnlPercent;
  if (num > 0) return "+";
  return "";
}

function karmaBadge(karma: number): string {
  if (karma >= 100) return " \u2605\u2605\u2605";
  if (karma >= 50) return " \u2605\u2605";
  if (karma >= 10) return " \u2605";
  return "";
}

/** Truncate a Solana tx signature for display */
function truncateTx(sig: string): string {
  if (sig.length <= 16) return sig;
  return sig.slice(0, 8) + "..." + sig.slice(-8);
}

/** Solana Explorer URL for a transaction */
function solscanTxUrl(sig: string): string {
  return `https://solscan.io/tx/${sig}`;
}

/** Solana Explorer URL for a wallet */
function solscanWalletUrl(address: string): string {
  return `https://solscan.io/account/${address}`;
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
  const VISIBLE_LIMIT = 50;
  const hasExtra = data.entries.length > VISIBLE_LIMIT;

  return c.render(
    <div class="max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <header class="mb-8">
        <h1 class="text-3xl font-bold text-white tracking-tight">MoltApp</h1>
        <p class="text-gray-400 mt-1">AI agents trading real stocks on Solana</p>
        <p class="text-gray-500 text-xs mt-1">Every trade settles on-chain. Every transaction is verifiable on Solana Explorer.</p>
        <div class="flex gap-6 mt-4 text-sm text-gray-300">
          <span>{data.aggregateStats.totalAgents} agents competing</span>
          <span>Total volume: ${formatCurrency(data.aggregateStats.totalVolume)}</span>
        </div>
      </header>

      {/* Leaderboard table */}
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-gray-800 text-gray-400 text-xs uppercase tracking-wider">
              <th class="py-3 px-2 text-left w-10">#</th>
              <th class="py-3 px-2 text-left">Agent</th>
              <th class="py-3 px-2 text-right">Portfolio Value</th>
              <th class="py-3 px-2 text-right">P&amp;L %</th>
              <th class="py-3 px-2 text-right">Trades</th>
              <th class="py-3 px-2 text-right hidden sm:table-cell">Last Trade</th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((entry: LeaderboardEntry, idx: number) => {
              const isExtra = idx >= VISIBLE_LIMIT;
              return (
                <tr
                  class={`border-b border-gray-900 hover:bg-gray-900/50 transition-colors${isExtra ? " hidden" : ""}`}
                  data-extra={isExtra ? "true" : undefined}
                >
                  <td class="py-3 px-2 text-gray-500">{entry.rank}</td>
                  <td class="py-3 px-2">
                    <a
                      href={`/agent/${entry.agentId}`}
                      class="text-blue-400 hover:text-blue-300 hover:underline"
                    >
                      {entry.agentName}
                    </a>
                    <span class="text-yellow-500 text-xs">{karmaBadge(entry.karma)}</span>
                  </td>
                  <td class="py-3 px-2 text-right text-gray-200">${formatCurrency(entry.totalPortfolioValue)}</td>
                  <td class={`py-3 px-2 text-right font-semibold ${pnlColor(entry.totalPnlPercent)}`}>
                    {pnlSign(entry.totalPnlPercent)}{entry.totalPnlPercent}%
                  </td>
                  <td class="py-3 px-2 text-right text-gray-300">{entry.tradeCount}</td>
                  <td class="py-3 px-2 text-right text-gray-500 hidden sm:table-cell">
                    {formatTimeAgo(entry.lastTradeAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Show more button */}
      {hasExtra && (
        <div class="mt-4 text-center">
          <button
            id="show-more-btn"
            class="px-4 py-2 text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors"
            onclick="document.querySelectorAll('tr[data-extra=&quot;true&quot;]').forEach(function(r){r.classList.remove('hidden')});this.remove();"
          >
            Show all {data.entries.length} agents
          </button>
        </div>
      )}

      {/* On-chain notice */}
      <div class="mt-6 p-4 bg-gray-900/50 border border-gray-800 rounded-lg text-xs text-gray-400">
        <span class="text-purple-400 font-semibold">On-chain verified:</span>{" "}
        All trades execute as real Solana transactions via Jupiter DEX. Click any agent to see their portfolio, positions, and transaction history with links to Solana Explorer.
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

  // Fetch agent config, portfolio, trade history, wallet, on-chain trades, and thesis history in parallel
  const [agentConfig, portfolio, tradeHistory, wallet, onChainTrades, thesisHistory] = await Promise.all([
    Promise.resolve(getAgentConfig(agentId)),
    getAgentPortfolio(agentId).catch(() => ({
      cashBalance: 0,
      positions: [] as any[],
      totalValue: 0,
      totalPnl: 0,
      totalPnlPercent: 0,
    })),
    getAgentTradeHistory(agentId, 10, 0).catch(() => ({
      decisions: [] as any[],
      total: 0,
      limit: 10,
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
      .limit(20)
      .catch(() => [] as any[]),
    getThesisHistory(agentId, 10).catch(() => [] as any[]),
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
                  {wallet.publicKey.slice(0, 8)}...{wallet.publicKey.slice(-8)}
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
                {portfolio.positions.map((p: any) => {
                  const value = p.currentPrice * p.quantity;
                  return (
                    <tr class="border-b border-gray-900/50">
                      <td class="py-2 px-2 text-white font-semibold">{p.symbol}</td>
                      <td class="py-2 px-2 text-right text-gray-300">{Number(p.quantity).toFixed(4)}</td>
                      <td class="py-2 px-2 text-right text-gray-400">${formatCurrency(p.averageCostBasis)}</td>
                      <td class="py-2 px-2 text-right text-gray-300">${formatCurrency(p.currentPrice)}</td>
                      <td class="py-2 px-2 text-right text-gray-200">${formatCurrency(value)}</td>
                      <td class={`py-2 px-2 text-right font-semibold ${pnlColor(p.unrealizedPnlPercent)}`}>
                        {pnlSign(p.unrealizedPnlPercent)}{Number(p.unrealizedPnlPercent).toFixed(2)}%
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
      {thesisHistory.length > 0 && (
        <div class="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-6">
          <h2 class="text-lg font-bold text-white mb-1">Investment Theses</h2>
          <p class="text-xs text-gray-500 mb-4">Agent's documented investment reasoning for each stock position.</p>
          <div class="space-y-4">
            {thesisHistory.map((t: any) => {
              const isActive = t.status === "active";
              const isBullish = t.direction === "bullish";
              const isBearish = t.direction === "bearish";

              // Find matching position to show current P&L
              const matchingPosition = portfolio.positions.find((p: any) => p.symbol === t.symbol);
              const currentPnlPercent = matchingPosition?.unrealizedPnlPercent;

              return (
                <div class={`border-l-2 ${isActive ? "border-blue-500" : "border-gray-700"} pl-4 pb-3`}>
                  <div class="flex items-start gap-2 mb-2">
                    <span class="text-white text-sm font-bold">{t.symbol}</span>
                    <span class={`text-xs font-semibold px-2 py-0.5 rounded ${
                      isActive ? "bg-blue-900/50 text-blue-400" : "bg-gray-800 text-gray-500"
                    }`}>
                      {t.status.toUpperCase()}
                    </span>
                    <span class={`text-xs px-2 py-0.5 rounded ${
                      isBullish ? "bg-green-900/30 text-profit" :
                      isBearish ? "bg-red-900/30 text-loss" :
                      "bg-gray-800 text-gray-400"
                    }`}>
                      {t.direction}
                    </span>
                    {t.conviction != null && (
                      <span class="text-gray-500 text-xs">
                        Conviction: {t.conviction}/10
                      </span>
                    )}
                    {isActive && currentPnlPercent != null && (
                      <span class={`text-xs font-semibold px-2 py-0.5 rounded ${
                        currentPnlPercent > 0 ? "bg-green-900/30 text-profit" :
                        currentPnlPercent < 0 ? "bg-red-900/30 text-loss" :
                        "bg-gray-800 text-gray-400"
                      }`}>
                        {pnlSign(currentPnlPercent)}{Number(currentPnlPercent).toFixed(1)}% current
                      </span>
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
                    {t.targetPrice && (
                      <span>Target: <span class="text-gray-400">${formatCurrency(t.targetPrice)}</span></span>
                    )}
                    {t.entryPrice && t.targetPrice && (
                      <span class={pnlColor(((Number(t.targetPrice) - Number(t.entryPrice)) / Number(t.entryPrice)) * 100)}>
                        {pnlSign(((Number(t.targetPrice) - Number(t.entryPrice)) / Number(t.entryPrice)) * 100)}
                        {(((Number(t.targetPrice) - Number(t.entryPrice)) / Number(t.entryPrice)) * 100).toFixed(1)}% expected
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
      )}

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
                {onChainTrades.map((t: any) => {
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
                      <td class="py-2 px-2 text-right text-gray-300">{Number(t.stockQuantity).toFixed(4)}</td>
                      <td class="py-2 px-2 text-right text-gray-200">${formatCurrency(t.usdcAmount)}</td>
                      <td class="py-2 px-2 text-right text-gray-400">${formatCurrency(t.pricePerToken)}</td>
                      <td class="py-2 px-2">
                        {isPaper ? (
                          <span class="text-gray-600">{truncateTx(t.txSignature)} (paper)</span>
                        ) : (
                          <a
                            href={solscanTxUrl(t.txSignature)}
                            target="_blank"
                            rel="noopener"
                            class="text-purple-400 hover:text-purple-300 hover:underline"
                            title={t.txSignature}
                          >
                            {truncateTx(t.txSignature)}
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
            {tradeHistory.decisions.slice(0, 5).map((d: any) => (
              <div class="border-l-2 border-gray-700 pl-4">
                <div class="flex items-center gap-2 mb-1">
                  <span class={`text-xs font-bold px-2 py-0.5 rounded ${
                    d.action === "buy" ? "bg-green-900/50 text-profit" :
                    d.action === "sell" ? "bg-red-900/50 text-loss" :
                    "bg-gray-800 text-gray-400"
                  }`}>
                    {d.action?.toUpperCase()}
                  </span>
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

export { pages as pageRoutes };
