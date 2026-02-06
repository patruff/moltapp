/**
 * Trading Monitor Dashboard
 *
 * Real-time SSR dashboard with Chart.js integration for monitoring
 * AI agent trading activity, portfolio performance, and system health.
 *
 * Features:
 * - Live equity curves per agent (Chart.js line charts)
 * - Agent comparison radar chart (Sharpe, Win Rate, PnL, etc.)
 * - Recent trade activity feed
 * - System health indicators (circuit breakers, rate limits, locks)
 * - Auto-refresh every 30 seconds
 */

import { Hono } from "hono";
import { html } from "hono/html";
import { errorMessage } from "../lib/errors.ts";
import { getAgentConfigs, getTradingInfraStatus } from "../agents/orchestrator.ts";
import {
  calculatePortfolioMetrics,
  compareAgents,
  generateEquityCurve,
} from "../services/portfolio-analytics.ts";
import { getSearchCacheMetrics } from "../services/search-cache.ts";
import { getNewsProviderMetrics, getAvailableProviders } from "../services/news-provider.ts";
import { getProvisioningStatus } from "../services/wallet-provisioner.ts";
import { getExecutionStats, getTradingMode } from "../services/trade-executor.ts";

export const monitorRoutes = new Hono();

// ---------------------------------------------------------------------------
// Dashboard Page
// ---------------------------------------------------------------------------

monitorRoutes.get("/", async (c) => {
  // Fetch data in parallel
  const [
    agentConfigs,
    infraStatus,
    comparisonResult,
    cacheMetrics,
    newsMetrics,
    providers,
    walletStatus,
    execStats,
    tradingMode,
  ] = await Promise.all([
    Promise.resolve(getAgentConfigs()),
    Promise.resolve(getTradingInfraStatus()),
    compareAgents().catch(() => null),
    Promise.resolve(getSearchCacheMetrics()),
    Promise.resolve(getNewsProviderMetrics()),
    Promise.resolve(getAvailableProviders()),
    Promise.resolve(getProvisioningStatus()),
    Promise.resolve(getExecutionStats()),
    Promise.resolve(getTradingMode()),
  ]);

  // Fetch equity curves for each agent
  const equityCurves: Record<string, Array<{ timestamp: string; portfolioValue: number; cumulativePnl: number }>> = {};
  for (const agent of agentConfigs) {
    try {
      equityCurves[agent.agentId] = await generateEquityCurve(agent.agentId);
    } catch {
      equityCurves[agent.agentId] = [];
    }
  }

  const agents = comparisonResult?.agents ?? [];

  return c.html(
    html`<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="refresh" content="30" />
  <title>MoltApp Monitor — AI Trading Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'SF Mono', 'Fira Code', monospace; background: #0a0a0f; color: #e0e0e0; }
    .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; border-bottom: 1px solid #1a1a2e; padding-bottom: 16px; }
    .header h1 { font-size: 24px; color: #00ff88; }
    .header .meta { font-size: 12px; color: #666; }
    .grid { display: grid; gap: 16px; }
    .grid-3 { grid-template-columns: repeat(3, 1fr); }
    .grid-2 { grid-template-columns: repeat(2, 1fr); }
    .card { background: #12121e; border: 1px solid #1a1a2e; border-radius: 8px; padding: 16px; }
    .card h3 { font-size: 14px; color: #888; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 1px; }
    .stat { font-size: 28px; font-weight: bold; }
    .stat.green { color: #00ff88; }
    .stat.red { color: #ff4444; }
    .stat.yellow { color: #ffaa00; }
    .stat.blue { color: #4488ff; }
    .stat-label { font-size: 11px; color: #666; margin-top: 4px; }
    .agent-card { background: #12121e; border: 1px solid #1a1a2e; border-radius: 8px; padding: 20px; }
    .agent-name { font-size: 18px; font-weight: bold; margin-bottom: 8px; }
    .agent-model { font-size: 12px; color: #666; }
    .metrics-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 16px; }
    .metric { text-align: center; }
    .metric-value { font-size: 20px; font-weight: bold; }
    .metric-label { font-size: 10px; color: #666; text-transform: uppercase; }
    .rank-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; }
    .rank-1 { background: #ffd700; color: #000; }
    .rank-2 { background: #c0c0c0; color: #000; }
    .rank-3 { background: #cd7f32; color: #000; }
    .chart-container { position: relative; height: 250px; margin-top: 12px; }
    .status-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
    .status-item { text-align: center; padding: 8px; border-radius: 4px; background: #1a1a2e; }
    .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; }
    .status-dot.ok { background: #00ff88; }
    .status-dot.warn { background: #ffaa00; }
    .status-dot.error { background: #ff4444; }
    .section { margin-top: 24px; }
    .section-title { font-size: 16px; color: #888; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 1px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { text-align: left; padding: 8px; color: #666; border-bottom: 1px solid #1a1a2e; }
    td { padding: 8px; border-bottom: 1px solid #0a0a1a; }
    .positive { color: #00ff88; }
    .negative { color: #ff4444; }
    @media (max-width: 768px) { .grid-3 { grid-template-columns: 1fr; } .grid-2 { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>MOLT MONITOR</h1>
      <div class="meta">
        Trading Mode: <strong>${tradingMode}</strong> |
        Last refresh: ${new Date().toISOString().split("T")[1].split(".")[0]} UTC |
        Auto-refresh: 30s
      </div>
    </div>

    <!-- System Status -->
    <div class="status-grid">
      <div class="status-item">
        <span class="status-dot ${infraStatus.lock.isLocked ? "warn" : "ok"}"></span>
        Trade Lock: ${infraStatus.lock.isLocked ? "LOCKED" : "FREE"}
      </div>
      <div class="status-item">
        <span class="status-dot ${cacheMetrics.itemsCached > 0 ? "ok" : "warn"}"></span>
        News Cache: ${cacheMetrics.itemsCached} items (${cacheMetrics.hitRate}% hit)
      </div>
      <div class="status-item">
        <span class="status-dot ${providers.length > 0 ? "ok" : "warn"}"></span>
        News APIs: ${providers.length > 0 ? providers.join(", ") : "mock only"}
      </div>
      <div class="status-item">
        <span class="status-dot ${walletStatus.provisioned > 0 ? "ok" : "error"}"></span>
        Wallets: ${walletStatus.provisioned}/${walletStatus.totalAgents} active
      </div>
    </div>

    <!-- Execution Stats -->
    <div class="section">
      <div class="grid grid-3">
        <div class="card">
          <h3>Trades Executed</h3>
          <div class="stat blue">${execStats.totalExecutions}</div>
          <div class="stat-label">${execStats.totalExecutions > 0 ? ((execStats.successfulExecutions / execStats.totalExecutions) * 100).toFixed(1) : "0.0"}% success rate</div>
        </div>
        <div class="card">
          <h3>Total Volume</h3>
          <div class="stat green">$${execStats.totalVolumeUSDC.toFixed(2)}</div>
          <div class="stat-label">USDC traded</div>
        </div>
        <div class="card">
          <h3>Pipeline</h3>
          <div class="stat yellow">${execStats.failedExecutions} failed</div>
          <div class="stat-label">${execStats.liveExecutions} live / ${execStats.paperExecutions} paper</div>
        </div>
      </div>
    </div>

    <!-- Agent Cards -->
    <div class="section">
      <div class="section-title">Agent Performance</div>
      <div class="grid grid-3">
        ${agents.map(
          (agent) => {
            const m = agent.metrics;
            const config = agentConfigs.find((a) => a.agentId === m.agentId);
            const pnlClass = m.totalPnl >= 0 ? "green" : "red";
            const rankClass = `rank-${agent.rank}`;
            return html`
              <div class="agent-card">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <div>
                    <div class="agent-name">${config?.name ?? m.agentId}</div>
                    <div class="agent-model">${config?.model ?? ""} | ${config?.tradingStyle ?? ""}</div>
                  </div>
                  <span class="rank-badge ${rankClass}">#${agent.rank}</span>
                </div>
                <div class="metrics-grid">
                  <div class="metric">
                    <div class="metric-value ${pnlClass}">$${m.totalPnl.toFixed(2)}</div>
                    <div class="metric-label">Total P&L</div>
                  </div>
                  <div class="metric">
                    <div class="metric-value">${m.winRate.toFixed(1)}%</div>
                    <div class="metric-label">Win Rate</div>
                  </div>
                  <div class="metric">
                    <div class="metric-value">${m.sharpeRatio !== null ? m.sharpeRatio.toFixed(2) : "N/A"}</div>
                    <div class="metric-label">Sharpe</div>
                  </div>
                  <div class="metric">
                    <div class="metric-value red">${m.maxDrawdownPercent.toFixed(1)}%</div>
                    <div class="metric-label">Max DD</div>
                  </div>
                  <div class="metric">
                    <div class="metric-value">${m.totalTrades}</div>
                    <div class="metric-label">Trades</div>
                  </div>
                  <div class="metric">
                    <div class="metric-value">${m.profitFactor !== null ? m.profitFactor.toFixed(2) : "N/A"}</div>
                    <div class="metric-label">Profit Factor</div>
                  </div>
                </div>
                <div class="chart-container">
                  <canvas id="chart-${m.agentId}"></canvas>
                </div>
              </div>
            `;
          },
        )}
      </div>
    </div>

    <!-- Comparison Table -->
    <div class="section">
      <div class="section-title">Head-to-Head Comparison</div>
      <div class="card">
        <table>
          <thead>
            <tr>
              <th>Agent</th>
              <th>P&L</th>
              <th>Win Rate</th>
              <th>Sharpe</th>
              <th>Sortino</th>
              <th>Max DD</th>
              <th>Profit Factor</th>
              <th>Trades</th>
              <th>Vol ($)</th>
              <th>Expectancy</th>
              <th>Win Streak</th>
            </tr>
          </thead>
          <tbody>
            ${agents.map(
              (agent) => {
                const m = agent.metrics;
                const config = agentConfigs.find((a) => a.agentId === m.agentId);
                return html`
                  <tr>
                    <td><strong>${config?.name ?? m.agentId}</strong></td>
                    <td class="${m.totalPnl >= 0 ? "positive" : "negative"}">$${m.totalPnl.toFixed(2)}</td>
                    <td>${m.winRate.toFixed(1)}%</td>
                    <td>${m.sharpeRatio !== null ? m.sharpeRatio.toFixed(2) : "—"}</td>
                    <td>${m.sortinoRatio !== null ? m.sortinoRatio.toFixed(2) : "—"}</td>
                    <td class="negative">${m.maxDrawdownPercent.toFixed(1)}%</td>
                    <td>${m.profitFactor !== null ? m.profitFactor.toFixed(2) : "—"}</td>
                    <td>${m.totalTrades}</td>
                    <td>$${m.totalVolumeUsdc.toFixed(0)}</td>
                    <td class="${m.expectancy >= 0 ? "positive" : "negative"}">$${m.expectancy.toFixed(2)}</td>
                    <td>${m.longestWinStreak}</td>
                  </tr>
                `;
              },
            )}
          </tbody>
        </table>
      </div>
    </div>

    <!-- News Provider Status -->
    <div class="section">
      <div class="grid grid-2">
        <div class="card">
          <h3>News Providers</h3>
          <table>
            <thead>
              <tr><th>Provider</th><th>Calls</th><th>Success</th><th>Avg ms</th><th>Last Error</th></tr>
            </thead>
            <tbody>
              ${Object.entries(newsMetrics).map(
                ([name, m]) => html`
                  <tr>
                    <td><strong>${name}</strong></td>
                    <td>${m.calls}</td>
                    <td>${m.calls > 0 ? ((m.successes / m.calls) * 100).toFixed(0) : 0}%</td>
                    <td>${m.avgResponseMs.toFixed(0)}</td>
                    <td style="color: #ff4444; font-size: 10px;">${m.lastError ?? "—"}</td>
                  </tr>
                `,
              )}
            </tbody>
          </table>
        </div>
        <div class="card">
          <h3>Wallet Provisioning</h3>
          <table>
            <thead>
              <tr><th>Agent</th><th>Public Key</th><th>Status</th></tr>
            </thead>
            <tbody>
              ${walletStatus.wallets.map(
                (w) => html`
                  <tr>
                    <td>${w.agentName}</td>
                    <td style="font-size: 10px;">${w.publicKey ? w.publicKey.slice(0, 12) + "..." : "—"}</td>
                    <td>
                      <span class="status-dot ${w.status === "active" ? "ok" : w.status === "pending_fund" ? "warn" : "error"}"></span>
                      ${w.status}
                    </td>
                  </tr>
                `,
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div style="text-align: center; margin-top: 32px; color: #333; font-size: 11px;">
      MoltApp Monitor v1.0 | AI Trading Competition Platform | patgpt.us
    </div>
  </div>

  <script>
    // Equity curve charts
    const chartData = ${html`${JSON.stringify(equityCurves)}`};
    const colors = {
      'claude-trader': { border: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.1)' },
      'gpt-trader': { border: '#10b981', bg: 'rgba(16, 185, 129, 0.1)' },
      'grok-trader': { border: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)' },
    };

    for (const [agentId, curve] of Object.entries(chartData)) {
      const canvas = document.getElementById('chart-' + agentId);
      if (!canvas || !curve.length) continue;

      const color = colors[agentId] || { border: '#4488ff', bg: 'rgba(68, 136, 255, 0.1)' };

      new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
          labels: curve.map(p => {
            const d = new Date(p.timestamp);
            return d.getMonth() + 1 + '/' + d.getDate() + ' ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
          }),
          datasets: [{
            label: 'Portfolio Value ($)',
            data: curve.map(p => p.portfolioValue),
            borderColor: color.border,
            backgroundColor: color.bg,
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 2,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
          },
          scales: {
            x: {
              display: false,
            },
            y: {
              grid: { color: 'rgba(255,255,255,0.05)' },
              ticks: { color: '#666', font: { size: 10 } },
            }
          }
        }
      });
    }
  </script>
</body>
</html>`,
  );
});

// ---------------------------------------------------------------------------
// JSON API for AJAX updates
// ---------------------------------------------------------------------------

/**
 * GET /monitor/api/summary
 * JSON endpoint for dashboard data (for future AJAX polling).
 */
monitorRoutes.get("/api/summary", async (c) => {
  try {
    const [comparison, infraStatus, cacheMetrics, execStats] =
      await Promise.all([
        compareAgents().catch(() => null),
        Promise.resolve(getTradingInfraStatus()),
        Promise.resolve(getSearchCacheMetrics()),
        Promise.resolve(getExecutionStats()),
      ]);

    return c.json({
      data: {
        agents: comparison,
        infrastructure: infraStatus,
        cache: cacheMetrics,
        execution: execStats,
        tradingMode: getTradingMode(),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    return c.json(
      {
        error: "summary_error",
        message: errorMessage(err),
      },
      500,
    );
  }
});
