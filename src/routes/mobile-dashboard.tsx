import { Hono } from "hono";
import { jsxRenderer } from "hono/jsx-renderer";
import { getAgentConfigs } from "../agents/orchestrator.ts";
import { getLeaderboard } from "../services/leaderboard.ts";
import { getCostsByProvider } from "../services/llm-cost-tracker.ts";

// Type-safe c.render() with title prop
declare module "hono" {
  interface ContextRenderer {
    (
      content: string | Promise<string>,
      props: { title: string }
    ): Response | Promise<Response>;
  }
}

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: "#d97706",
  openai: "#10b981",
  xai: "#3b82f6",
  google: "#8b5cf6",
};

const mobileDashboard = new Hono();

mobileDashboard.use(
  "*",
  jsxRenderer(({ children, title }) => {
    return (
      <html lang="en" class="dark">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>{title}</title>
          <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
          <meta http-equiv="refresh" content="60" />
        </head>
        <body class="bg-gray-950 text-gray-100 min-h-screen font-mono p-4">
          {children}
        </body>
      </html>
    );
  })
);

mobileDashboard.get("/", async (c) => {
  const agents = getAgentConfigs();
  const leaderboard = await getLeaderboard();
  const costs = await getCostsByProvider();

  // Build lookup from agentId -> leaderboard entry
  const lbMap = new Map(leaderboard.entries.map((e) => [e.agentId, e]));

  return c.render(
    <div class="max-w-lg mx-auto space-y-6">
      {/* Header */}
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold text-white">MoltApp</h1>
        <span class="text-xs text-gray-500">
          {new Date().toLocaleTimeString()}
        </span>
      </div>

      {/* Active Agents */}
      <section>
        <h2 class="text-lg font-semibold text-gray-300 mb-3">Active Agents</h2>
        <div class="space-y-3">
          {agents.map((agent) => {
            const lb = lbMap.get(agent.agentId);
            const pnl = lb ? parseFloat(lb.totalPnlPercent) : 0;
            const pnlColor = pnl >= 0 ? "text-green-400" : "text-red-400";
            const pnlSign = pnl >= 0 ? "+" : "";
            const providerColor = PROVIDER_COLORS[agent.provider] ?? "#6b7280";
            const hasApiKey = !!agent.agentId; // if in getAgentConfigs(), key exists

            return (
              <div class="bg-gray-900 rounded-xl p-4 border border-gray-800">
                <div class="flex items-center justify-between mb-2">
                  <span class="font-semibold text-white text-base">{agent.name}</span>
                  <span
                    class="text-xs px-2 py-1 rounded-full font-medium"
                    style={`background-color: ${providerColor}20; color: ${providerColor}`}
                  >
                    {agent.provider.charAt(0).toUpperCase() + agent.provider.slice(1)}
                  </span>
                </div>
                <div class="text-xs text-gray-400 mb-3">{agent.model}</div>
                <div class="flex items-center justify-between">
                  <div>
                    <span class={`text-lg font-bold ${pnlColor}`}>
                      {pnlSign}{pnl.toFixed(2)}%
                    </span>
                    {lb && (
                      <span class="text-xs text-gray-500 ml-2">
                        {lb.tradeCount} trades
                      </span>
                    )}
                  </div>
                  <span class={`text-xs px-2 py-1 rounded-full ${hasApiKey ? "bg-green-900/40 text-green-400" : "bg-red-900/40 text-red-400"}`}>
                    {hasApiKey ? "Active" : "No API Key"}
                  </span>
                </div>
                {lb && (
                  <div class="mt-2 text-xs text-gray-500">
                    Portfolio: ${parseFloat(lb.totalPortfolioValue).toLocaleString()}
                  </div>
                )}
              </div>
            );
          })}
          {agents.length === 0 && (
            <div class="text-gray-500 text-sm text-center py-8">
              No agents configured. Set API keys to activate agents.
            </div>
          )}
        </div>
      </section>

      {/* LLM Spend by Provider */}
      <section>
        <h2 class="text-lg font-semibold text-gray-300 mb-1">LLM Spend</h2>
        <div class="text-xs text-gray-500 mb-3">
          Total: ${costs.totalCost.toFixed(2)}
        </div>
        <div class="space-y-3">
          {costs.byProvider.map((p) => {
            const color = PROVIDER_COLORS[p.provider] ?? "#6b7280";
            const pct = costs.totalCost > 0 ? (p.cost / costs.totalCost) * 100 : 0;

            return (
              <div class="bg-gray-900 rounded-xl p-4 border border-gray-800">
                <div class="flex items-center justify-between mb-2">
                  <div class="flex items-center gap-2">
                    <span
                      class="w-3 h-3 rounded-full inline-block"
                      style={`background-color: ${color}`}
                    ></span>
                    <span class="font-semibold text-white">{p.displayName}</span>
                  </div>
                  <span class="text-white font-bold">${p.cost.toFixed(2)}</span>
                </div>
                <div class="text-xs text-gray-500 mb-2">
                  {p.tokens.toLocaleString()} tokens
                </div>
                {/* Progress bar */}
                <div class="w-full bg-gray-800 rounded-full h-2 mb-3">
                  <div
                    class="h-2 rounded-full"
                    style={`width: ${Math.min(pct, 100)}%; background-color: ${color}`}
                  ></div>
                </div>
                <a
                  href={p.topUpUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="block text-center py-2 rounded-lg text-sm font-medium"
                  style={`background-color: ${color}20; color: ${color}; min-height: 44px; line-height: 28px`}
                >
                  Top Up Credits
                </a>
              </div>
            );
          })}
          {costs.byProvider.length === 0 && (
            <div class="text-gray-500 text-sm text-center py-8">
              No LLM usage recorded yet.
            </div>
          )}
        </div>
      </section>

      {/* Footer */}
      <div class="text-center text-xs text-gray-600 pb-4">
        Auto-refreshes every 60s
      </div>
    </div>,
    { title: "MoltApp — Mobile Dashboard" }
  );
});

export { mobileDashboard as mobileDashboardRoutes };
