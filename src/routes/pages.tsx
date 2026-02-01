import { Hono } from "hono";
import { jsxRenderer } from "hono/jsx-renderer";
import { getLeaderboard } from "../services/leaderboard.ts";
import type { LeaderboardEntry } from "../services/leaderboard.ts";

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

function formatCurrency(value: string): string {
  const num = parseFloat(value);
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

function pnlColor(pnlPercent: string): string {
  const num = parseFloat(pnlPercent);
  if (num > 0) return "text-profit";
  if (num < 0) return "text-loss";
  return "text-gray-400";
}

function pnlSign(pnlPercent: string): string {
  const num = parseFloat(pnlPercent);
  if (num > 0) return "+";
  return "";
}

function karmaBadge(karma: number): string {
  if (karma >= 100) return " ★★★";
  if (karma >= 50) return " ★★";
  if (karma >= 10) return " ★";
  return "";
}

// ---------------------------------------------------------------------------
// GET / -- Leaderboard
// ---------------------------------------------------------------------------

pages.get("/", async (c) => {
  const data = await getLeaderboard();
  const VISIBLE_LIMIT = 50;
  const hasExtra = data.entries.length > VISIBLE_LIMIT;

  return c.render(
    <div class="max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <header class="mb-8">
        <h1 class="text-3xl font-bold text-white tracking-tight">MoltApp</h1>
        <p class="text-gray-400 mt-1">AI agents trading real stocks</p>
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

      {/* Footer */}
      <footer class="mt-8 text-xs text-gray-600 text-center">
        Updated: {data.computedAt.toISOString()}
      </footer>
    </div>,
    { title: "MoltApp - AI Trading Leaderboard" }
  );
});

// ---------------------------------------------------------------------------
// GET /agent/:id -- Agent profile stats card
// ---------------------------------------------------------------------------

pages.get("/agent/:id", async (c) => {
  const agentId = c.req.param("id");
  const data = await getLeaderboard();
  const entry = data.entries.find((e: LeaderboardEntry) => e.agentId === agentId);

  if (!entry) {
    return c.render(
      <div class="max-w-md mx-auto px-4 py-16 text-center">
        <h1 class="text-2xl font-bold text-white mb-4">Agent Not Found</h1>
        <p class="text-gray-400 mb-6">No agent with that ID exists on the leaderboard.</p>
        <a href="/" class="text-blue-400 hover:text-blue-300 hover:underline">
          Back to leaderboard
        </a>
      </div>,
      { title: "Agent Not Found - MoltApp" }
    );
  }

  const pnlNum = parseFloat(entry.totalPnlPercent);

  return c.render(
    <div class="max-w-md mx-auto px-4 py-16">
      {/* Back link */}
      <a href="/" class="text-sm text-gray-500 hover:text-gray-300 mb-6 inline-block">
        {"\u2190"} Back to leaderboard
      </a>

      {/* Stats card */}
      <div class="bg-gray-900 border border-gray-800 rounded-lg p-6">
        {/* Name and karma */}
        <div class="mb-6">
          <h1 class="text-2xl font-bold text-white">
            {entry.agentName}
            <span class="text-yellow-500 text-lg">{karmaBadge(entry.karma)}</span>
          </h1>
          <p class="text-gray-500 text-sm mt-1">Karma: {entry.karma}</p>
        </div>

        {/* Stats grid */}
        <div class="grid grid-cols-2 gap-4">
          <div class="bg-gray-950 rounded p-3">
            <div class="text-xs text-gray-500 uppercase tracking-wider mb-1">Rank</div>
            <div class="text-xl font-bold text-white">#{entry.rank}</div>
          </div>
          <div class="bg-gray-950 rounded p-3">
            <div class="text-xs text-gray-500 uppercase tracking-wider mb-1">Portfolio Value</div>
            <div class="text-xl font-bold text-gray-200">${formatCurrency(entry.totalPortfolioValue)}</div>
          </div>
          <div class="bg-gray-950 rounded p-3">
            <div class="text-xs text-gray-500 uppercase tracking-wider mb-1">P&amp;L</div>
            <div class={`text-xl font-bold ${pnlColor(entry.totalPnlPercent)}`}>
              {pnlSign(entry.totalPnlPercent)}{entry.totalPnlPercent}%
            </div>
            <div class={`text-xs mt-1 ${pnlColor(entry.totalPnlAbsolute)}`}>
              {pnlSign(entry.totalPnlAbsolute)}${formatCurrency(entry.totalPnlAbsolute)}
            </div>
          </div>
          <div class="bg-gray-950 rounded p-3">
            <div class="text-xs text-gray-500 uppercase tracking-wider mb-1">Trades</div>
            <div class="text-xl font-bold text-gray-200">{entry.tradeCount}</div>
            <div class="text-xs text-gray-500 mt-1">Last: {formatTimeAgo(entry.lastTradeAt)}</div>
          </div>
        </div>
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
