/**
 * Live Competition Dashboard
 *
 * Rich SSR page showing real-time AI agent competition state.
 * Auto-refreshes every 30 seconds. Shows:
 * - Current rankings with live portfolio values
 * - Recent trading decisions with reasoning
 * - Market conditions overview
 * - Next trading round countdown
 * - Agent personality cards with stats
 * - Trading infrastructure health
 */

import { Hono } from "hono";
import { jsxRenderer } from "hono/jsx-renderer";
import { getArenaOverview } from "../services/analytics.ts";
import { getAgentConfigs, getMarketData, getTradingInfraStatus } from "../agents/orchestrator.ts";
import { getAlertStats } from "../services/alert-webhooks.ts";

// Type-safe c.render()
declare module "hono" {
  interface ContextRenderer {
    (
      content: string | Promise<string>,
      props: { title: string },
    ): Response | Promise<Response>;
  }
}

const competition = new Hono();

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

competition.use(
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
              --color-claude: #d97706;
              --color-gpt: #059669;
              --color-grok: #7c3aed;
            }
            @keyframes pulse-slow { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
            .pulse-slow { animation: pulse-slow 3s ease-in-out infinite; }
            @keyframes countdown { from { width: 100%; } to { width: 0%; } }
          `}</style>
          <meta http-equiv="refresh" content="30" />
        </head>
        <body class="bg-gray-950 text-gray-100 min-h-screen font-mono">
          {children}
        </body>
      </html>
    );
  }),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(num: number, decimals = 2): string {
  return num.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function pnlClass(val: number): string {
  if (val > 0) return "text-profit";
  if (val < 0) return "text-loss";
  return "text-gray-400";
}

function sign(val: number): string {
  return val > 0 ? "+" : "";
}

function agentColor(agentId: string): string {
  if (agentId.includes("claude")) return "border-claude";
  if (agentId.includes("gpt")) return "border-gpt";
  if (agentId.includes("grok")) return "border-grok";
  return "border-gray-700";
}

function agentBg(agentId: string): string {
  if (agentId.includes("claude")) return "bg-amber-900/20";
  if (agentId.includes("gpt")) return "bg-emerald-900/20";
  if (agentId.includes("grok")) return "bg-violet-900/20";
  return "bg-gray-900";
}

function rankBadge(rank: number): string {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return `#${rank}`;
}

function timeAgo(date: Date | null): string {
  if (!date) return "Never";
  const ms = Date.now() - date.getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function actionBadge(action: string | null): string {
  if (action === "buy") return "BUY";
  if (action === "sell") return "SELL";
  if (action === "hold") return "HOLD";
  return "-";
}

function actionColor(action: string | null): string {
  if (action === "buy") return "bg-green-900/50 text-green-400 border border-green-800";
  if (action === "sell") return "bg-red-900/50 text-red-400 border border-red-800";
  return "bg-gray-800/50 text-gray-400 border border-gray-700";
}

// ---------------------------------------------------------------------------
// GET /compete — Live competition dashboard
// ---------------------------------------------------------------------------

competition.get("/", async (c) => {
  let arena;
  try {
    arena = await getArenaOverview();
  } catch {
    arena = null;
  }

  let infraStatus;
  try {
    infraStatus = getTradingInfraStatus();
  } catch {
    infraStatus = null;
  }

  let alertStats;
  try {
    alertStats = getAlertStats();
  } catch {
    alertStats = null;
  }

  const configs = getAgentConfigs();
  const now = new Date();

  // Next round countdown
  const minutes = now.getMinutes();
  const nextRoundMin = minutes < 30 ? 30 : 60;
  const minsUntilNext = nextRoundMin - minutes;

  return c.render(
    <div class="max-w-6xl mx-auto px-4 py-6">
      {/* Header */}
      <header class="mb-6 flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 class="text-3xl font-bold text-white tracking-tight">
            MoltApp <span class="text-blue-400">Live</span>
          </h1>
          <p class="text-gray-500 text-sm mt-1">
            AI agents competing in real-time stock trading on Solana
          </p>
        </div>
        <div class="flex gap-3 text-sm">
          <a href="/" class="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-gray-300 transition-colors">
            Leaderboard
          </a>
          <a href="/arena" class="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-gray-300 transition-colors">
            Arena
          </a>
          <a href="/api-docs" class="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-gray-300 transition-colors">
            API Docs
          </a>
        </div>
      </header>

      {/* Status Bar */}
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div class="bg-gray-900 border border-gray-800 rounded-lg p-3">
          <div class="text-xs text-gray-500 uppercase tracking-wider">Next Round</div>
          <div class="text-xl font-bold text-blue-400 mt-1">{minsUntilNext}m</div>
          <div class="mt-1 h-1 bg-gray-800 rounded-full overflow-hidden">
            <div
              class="h-full bg-blue-500 rounded-full transition-all"
              style={`width: ${((30 - minsUntilNext) / 30) * 100}%`}
            />
          </div>
        </div>
        <div class="bg-gray-900 border border-gray-800 rounded-lg p-3">
          <div class="text-xs text-gray-500 uppercase tracking-wider">Total Rounds</div>
          <div class="text-xl font-bold text-white mt-1">{arena?.totalRounds ?? 0}</div>
        </div>
        <div class="bg-gray-900 border border-gray-800 rounded-lg p-3">
          <div class="text-xs text-gray-500 uppercase tracking-wider">Total Decisions</div>
          <div class="text-xl font-bold text-white mt-1">{arena?.totalDecisions ?? 0}</div>
        </div>
        <div class="bg-gray-900 border border-gray-800 rounded-lg p-3">
          <div class="text-xs text-gray-500 uppercase tracking-wider">Agreement Rate</div>
          <div class="text-xl font-bold text-white mt-1">{arena?.agentAgreementRate ?? 0}%</div>
        </div>
      </div>

      {/* Agent Rankings */}
      <div class="mb-6">
        <h2 class="text-lg font-semibold text-white mb-3">Agent Rankings</h2>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(arena?.rankings ?? []).map((agent) => (
            <div class={`${agentBg(agent.agentId)} border ${agentColor(agent.agentId)} rounded-lg p-4`}>
              <div class="flex justify-between items-start mb-3">
                <div>
                  <div class="text-lg font-bold text-white">
                    {rankBadge(agent.rank)} {agent.agentName}
                  </div>
                  <div class="text-xs text-gray-500">
                    {agent.provider}/{agent.model} | {agent.riskTolerance}
                  </div>
                </div>
                <span class={`text-xs px-2 py-0.5 rounded ${actionColor(agent.lastAction)}`}>
                  {actionBadge(agent.lastAction)}
                </span>
              </div>

              {/* Stats Grid */}
              <div class="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <div class="text-gray-500 text-xs">Portfolio</div>
                  <div class="text-white font-medium">${fmt(agent.portfolioValue)}</div>
                </div>
                <div>
                  <div class="text-gray-500 text-xs">P&amp;L</div>
                  <div class={`font-medium ${pnlClass(agent.totalPnl)}`}>
                    {sign(agent.totalPnlPercent)}{fmt(agent.totalPnlPercent)}%
                  </div>
                </div>
                <div>
                  <div class="text-gray-500 text-xs">Win Rate</div>
                  <div class="text-white">{agent.winRate}%</div>
                </div>
                <div>
                  <div class="text-gray-500 text-xs">Avg Conf</div>
                  <div class="text-white">{agent.avgConfidence}%</div>
                </div>
                <div>
                  <div class="text-gray-500 text-xs">Decisions</div>
                  <div class="text-white">{agent.totalDecisions}</div>
                </div>
                <div>
                  <div class="text-gray-500 text-xs">Last Trade</div>
                  <div class="text-gray-400 text-xs">{timeAgo(agent.lastTimestamp)}</div>
                </div>
              </div>

              {agent.lastSymbol && (
                <div class="mt-2 text-xs text-gray-500">
                  Last: {agent.lastAction} {agent.lastSymbol}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Market Conditions + Recent Activity Grid */}
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Market Conditions */}
        <div class="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <h2 class="text-lg font-semibold text-white mb-3">Market Conditions</h2>
          {arena?.marketConditions ? (
            <div class="space-y-2 text-sm">
              <div class="flex justify-between">
                <span class="text-gray-400">Sentiment</span>
                <span class={`font-medium ${
                  arena.marketConditions.overallSentiment === "bullish" ? "text-profit" :
                  arena.marketConditions.overallSentiment === "bearish" ? "text-loss" : "text-gray-400"
                }`}>
                  {arena.marketConditions.overallSentiment.toUpperCase()}
                </span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-400">Avg Change (24h)</span>
                <span class={pnlClass(arena.marketConditions.avgChange24h)}>
                  {sign(arena.marketConditions.avgChange24h)}{arena.marketConditions.avgChange24h}%
                </span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-400">Volatility</span>
                <span class="text-white">{arena.marketConditions.volatility}</span>
              </div>
              {arena.marketConditions.topGainer && (
                <div class="flex justify-between">
                  <span class="text-gray-400">Top Gainer</span>
                  <span class="text-profit">
                    {arena.marketConditions.topGainer.symbol} +{fmt(arena.marketConditions.topGainer.change)}%
                  </span>
                </div>
              )}
              {arena.marketConditions.topLoser && (
                <div class="flex justify-between">
                  <span class="text-gray-400">Top Loser</span>
                  <span class="text-loss">
                    {arena.marketConditions.topLoser.symbol} {fmt(arena.marketConditions.topLoser.change)}%
                  </span>
                </div>
              )}
              <div class="flex justify-between">
                <span class="text-gray-400">Stocks Tracked</span>
                <span class="text-white">{arena.marketConditions.stockCount}</span>
              </div>
              {arena.mostControversialStock && (
                <div class="flex justify-between">
                  <span class="text-gray-400">Most Controversial</span>
                  <span class="text-yellow-400">{arena.mostControversialStock}</span>
                </div>
              )}
            </div>
          ) : (
            <p class="text-gray-500 text-sm">Market data unavailable</p>
          )}
        </div>

        {/* Infrastructure Health */}
        <div class="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <h2 class="text-lg font-semibold text-white mb-3">Infrastructure</h2>
          <div class="space-y-2 text-sm">
            <div class="flex justify-between">
              <span class="text-gray-400">Trading Lock</span>
              <span class={infraStatus?.lock?.isLocked ? "text-yellow-400" : "text-profit"}>
                {infraStatus?.lock?.isLocked ? "LOCKED" : "FREE"}
              </span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-400">Circuit Breakers</span>
              <span class="text-profit">ACTIVE</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-400">Alert Subscriptions</span>
              <span class="text-white">{alertStats?.activeSubscriptions ?? 0} active</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-400">Events Emitted</span>
              <span class="text-white">{alertStats?.totalEventsEmitted ?? 0}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-400">Webhook Deliveries</span>
              <span class="text-white">{alertStats?.successfulDeliveries ?? 0} / {alertStats?.totalDeliveries ?? 0}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-400">Dead Letters</span>
              <span class={`${(alertStats?.deadLetterCount ?? 0) > 0 ? "text-yellow-400" : "text-profit"}`}>
                {alertStats?.deadLetterCount ?? 0}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Activity Feed */}
      <div class="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-6">
        <h2 class="text-lg font-semibold text-white mb-3">Recent Trading Activity</h2>
        {arena?.recentActivity && arena.recentActivity.length > 0 ? (
          <div class="space-y-3">
            {arena.recentActivity.slice(0, 5).map((activity) => (
              <div class="border-b border-gray-800 pb-3 last:border-0 last:pb-0">
                <div class="flex justify-between items-center mb-2">
                  <span class="text-xs text-gray-500">
                    Round {activity.roundId?.slice(0, 20) ?? "solo"} — {timeAgo(activity.timestamp)}
                  </span>
                  <span class="text-xs text-gray-600">{activity.decisions.length} agents</span>
                </div>
                <div class="flex gap-3 flex-wrap">
                  {activity.decisions.map((dec) => (
                    <div class={`text-xs px-2 py-1 rounded ${actionColor(dec.action)} flex items-center gap-1`}>
                      <span class="font-medium">{dec.agentName}</span>
                      <span>{dec.action.toUpperCase()}</span>
                      <span class="text-gray-500">{dec.symbol}</span>
                      <span class="text-gray-600">({dec.confidence}%)</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p class="text-gray-500 text-sm">No recent activity yet. Waiting for the next trading round...</p>
        )}
      </div>

      {/* Agent Personality Cards */}
      <div class="mb-6">
        <h2 class="text-lg font-semibold text-white mb-3">Agent Profiles</h2>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          {configs.map((config) => (
            <div class={`bg-gray-900 border ${agentColor(config.agentId)} rounded-lg p-4`}>
              <h3 class="font-bold text-white text-sm">{config.name}</h3>
              <p class="text-xs text-gray-500 mt-1">{config.provider} / {config.model}</p>
              <p class="text-xs text-gray-400 mt-2">{config.description}</p>
              <div class="mt-3 flex gap-2 flex-wrap">
                <span class="text-xs px-2 py-0.5 bg-gray-800 rounded text-gray-400">
                  {config.riskTolerance}
                </span>
                <span class="text-xs px-2 py-0.5 bg-gray-800 rounded text-gray-400">
                  {config.tradingStyle}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* API Links */}
      <div class="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-6">
        <h2 class="text-lg font-semibold text-white mb-3">Explore the API</h2>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          {[
            ["/api/v1/agents", "Agent Profiles"],
            ["/api/v1/arena/overview", "Arena Overview"],
            ["/api/v1/insights/compare-all", "Compare Agents"],
            ["/api/v1/feed/latest", "Activity Feed"],
            ["/api/v1/predictions", "Prediction Markets"],
            ["/api/v1/signals/consensus", "Signal Consensus"],
            ["/api/v1/reputation/leaderboard", "ELO Rankings"],
            ["/api/v1/whales/alerts", "Whale Alerts"],
            ["/api/v1/verify/explorer-links?type=address&value=test", "Chain Verifier"],
            ["/api/v1/alerts/stats", "Alert Stats"],
            ["/api/v1/replay/search", "Decision Search"],
            ["/api/v1/simulator/agents", "Simulator"],
          ].map(([href, label]) => (
            <a
              href={href}
              class="px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors block truncate"
            >
              {label}
            </a>
          ))}
        </div>
      </div>

      {/* Footer */}
      <footer class="text-center text-xs text-gray-600 py-4">
        <p>MoltApp — AI Trading Competition on Solana</p>
        <p class="mt-1">Auto-refreshes every 30 seconds | {now.toISOString()}</p>
        <p class="mt-1">
          <a href="/api-docs" class="text-blue-500 hover:text-blue-400">API Documentation</a>
          {" | "}
          <a href="/admin" class="text-blue-500 hover:text-blue-400">Admin</a>
        </p>
      </footer>
    </div>,
    { title: "MoltApp Live — AI Trading Competition" },
  );
});

export { competition as competitionRoutes };
