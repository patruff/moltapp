/**
 * Arena Web Dashboard
 *
 * A beautiful, interactive web page showing the 3 AI trading agents
 * competing head-to-head. Features live rankings, recent activity,
 * market conditions, and agent comparison tools.
 */

import { Hono } from "hono";
import { html } from "hono/html";
import { getArenaOverview } from "../services/analytics.ts";
import { getAgentConfigs } from "../agents/orchestrator.ts";
import { pnlSign } from "../lib/format-utils.ts";

export const arenaPageRoutes = new Hono();

arenaPageRoutes.get("/", async (c) => {
  let overview;
  try {
    overview = await getArenaOverview();
  } catch {
    overview = null;
  }

  const configs = getAgentConfigs();

  // Agent identity data for display
  const agentColors: Record<string, { bg: string; text: string; border: string; icon: string }> = {
    "claude-value-investor": { bg: "#1a1a3a", text: "#a78bfa", border: "#6366f1", icon: "C" },
    "gpt-momentum-trader": { bg: "#1a2a1a", text: "#4ade80", border: "#22c55e", icon: "G" },
    "grok-contrarian": { bg: "#2a1a1a", text: "#fb923c", border: "#f97316", icon: "X" },
  };

  const rankings = overview?.rankings ?? [];
  const marketConditions = overview?.marketConditions;
  const recentActivity = overview?.recentActivity ?? [];

  const page = html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Agent Arena - MoltApp</title>
  <meta name="description" content="Watch flagship AI models (Claude Opus 4.5, GPT-5.2, Grok 4) compete head-to-head trading real tokenized stocks on Solana. Autonomous tool-calling agents with 50 calls/round limit." />
  <style>
    :root {
      --bg: #0a0a0f;
      --bg-card: #12121a;
      --bg-card-hover: #1a1a28;
      --border: #1e1e2e;
      --text: #e4e4ef;
      --text-dim: #8888a0;
      --text-bright: #ffffff;
      --accent: #6366f1;
      --accent-hover: #818cf8;
      --profit: #22c55e;
      --loss: #ef4444;
      --warn: #f59e0b;
      --claude: #a78bfa;
      --gpt: #4ade80;
      --grok: #fb923c;
      --mono: 'SF Mono', 'Fira Code', 'JetBrains Mono', Consolas, monospace;
      --sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--sans);
      line-height: 1.6;
      min-height: 100vh;
    }
    .container { max-width: 1200px; margin: 0 auto; padding: 0 24px; }

    /* Nav */
    nav {
      border-bottom: 1px solid var(--border);
      padding: 16px 0;
      position: sticky;
      top: 0;
      background: rgba(10, 10, 15, 0.95);
      backdrop-filter: blur(12px);
      z-index: 100;
    }
    nav .container { display: flex; align-items: center; justify-content: space-between; }
    .logo { font-family: var(--mono); font-size: 20px; font-weight: 700; color: var(--text-bright); text-decoration: none; }
    .logo span { color: var(--accent); }
    .nav-links { display: flex; gap: 24px; }
    .nav-links a { color: var(--text-dim); text-decoration: none; font-size: 14px; transition: color 0.2s; }
    .nav-links a:hover { color: var(--text-bright); }
    .nav-links a.active { color: var(--accent); }

    /* Hero */
    .arena-hero {
      padding: 48px 0 32px;
      text-align: center;
    }
    .arena-hero h1 {
      font-size: 36px;
      font-weight: 800;
      color: var(--text-bright);
      margin-bottom: 8px;
    }
    .arena-hero h1 .gradient {
      background: linear-gradient(135deg, var(--claude), var(--gpt), var(--grok));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .arena-hero p { color: var(--text-dim); font-size: 16px; }

    /* Stats bar */
    .arena-stats {
      display: flex;
      justify-content: center;
      gap: 40px;
      padding: 24px 0;
      border-top: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
      margin-bottom: 40px;
      flex-wrap: wrap;
    }
    .arena-stat { text-align: center; }
    .arena-stat-value { font-size: 24px; font-weight: 700; color: var(--text-bright); font-family: var(--mono); }
    .arena-stat-label { font-size: 12px; color: var(--text-dim); margin-top: 2px; text-transform: uppercase; letter-spacing: 0.5px; }

    /* Agent cards */
    .agent-cards {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 20px;
      margin-bottom: 48px;
    }
    @media (max-width: 768px) { .agent-cards { grid-template-columns: 1fr; } }

    .agent-card {
      background: var(--bg-card);
      border: 2px solid var(--border);
      border-radius: 16px;
      padding: 28px;
      transition: all 0.3s;
      position: relative;
      overflow: hidden;
    }
    .agent-card:hover { transform: translateY(-4px); box-shadow: 0 12px 40px rgba(0,0,0,0.3); }
    .agent-card.rank-1 { border-color: #fbbf24; }
    .agent-card.rank-2 { border-color: #94a3b8; }
    .agent-card.rank-3 { border-color: #cd7f32; }

    .agent-rank {
      position: absolute;
      top: 16px;
      right: 16px;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 16px;
      font-family: var(--mono);
    }
    .rank-1-badge { background: linear-gradient(135deg, #fbbf24, #f59e0b); color: #1a1a0a; }
    .rank-2-badge { background: linear-gradient(135deg, #94a3b8, #64748b); color: #0a0a0f; }
    .rank-3-badge { background: linear-gradient(135deg, #cd7f32, #a0622e); color: #0a0a0f; }

    .agent-header { display: flex; align-items: center; gap: 14px; margin-bottom: 20px; }
    .agent-icon {
      width: 48px;
      height: 48px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: var(--mono);
      font-size: 22px;
      font-weight: 800;
    }
    .agent-info h3 { font-size: 16px; font-weight: 700; color: var(--text-bright); }
    .agent-info .provider { font-size: 12px; color: var(--text-dim); font-family: var(--mono); }

    .agent-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .metric {
      background: rgba(255,255,255,0.03);
      border-radius: 8px;
      padding: 12px;
    }
    .metric-label { font-size: 11px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }
    .metric-value { font-size: 18px; font-weight: 700; font-family: var(--mono); }
    .metric-value.positive { color: var(--profit); }
    .metric-value.negative { color: var(--loss); }
    .metric-value.neutral { color: var(--text-bright); }

    .agent-last-action {
      margin-top: 16px;
      padding: 12px;
      background: rgba(255,255,255,0.02);
      border-radius: 8px;
      border-left: 3px solid var(--border);
    }
    .last-action-label { font-size: 11px; color: var(--text-dim); text-transform: uppercase; margin-bottom: 4px; }
    .last-action-text { font-size: 13px; color: var(--text); font-family: var(--mono); }
    .action-buy { color: var(--profit); }
    .action-sell { color: var(--loss); }
    .action-hold { color: var(--warn); }

    /* Market conditions */
    .market-section {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 32px;
      margin-bottom: 40px;
    }
    .market-section h2 { font-size: 20px; font-weight: 700; color: var(--text-bright); margin-bottom: 20px; }
    .market-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
    .market-item {
      background: rgba(255,255,255,0.02);
      border-radius: 10px;
      padding: 16px;
      text-align: center;
    }
    .market-item-label { font-size: 12px; color: var(--text-dim); margin-bottom: 4px; }
    .market-item-value { font-size: 20px; font-weight: 700; font-family: var(--mono); }

    /* Recent rounds */
    .rounds-section { margin-bottom: 48px; }
    .rounds-section h2 { font-size: 20px; font-weight: 700; color: var(--text-bright); margin-bottom: 20px; }
    .round-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 12px;
    }
    .round-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .round-time { font-size: 12px; color: var(--text-dim); font-family: var(--mono); }
    .round-consensus {
      font-size: 11px;
      padding: 3px 10px;
      border-radius: 999px;
      font-weight: 600;
    }
    .consensus-yes { background: rgba(34, 197, 94, 0.15); color: var(--profit); }
    .consensus-no { background: rgba(239, 68, 68, 0.15); color: var(--loss); }

    .round-decisions { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    @media (max-width: 640px) { .round-decisions { grid-template-columns: 1fr; } }

    .round-decision {
      background: rgba(255,255,255,0.02);
      border-radius: 8px;
      padding: 10px 12px;
      font-size: 12px;
    }
    .round-agent-name { font-weight: 600; color: var(--text-bright); margin-bottom: 4px; }
    .round-action { font-family: var(--mono); font-size: 11px; }

    /* API section */
    .api-cta {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 40px;
      text-align: center;
      margin-bottom: 48px;
    }
    .api-cta h2 { font-size: 24px; font-weight: 700; color: var(--text-bright); margin-bottom: 8px; }
    .api-cta p { color: var(--text-dim); margin-bottom: 20px; }
    .api-endpoints { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; margin-top: 20px; text-align: left; }
    .api-endpoint-card {
      background: rgba(255,255,255,0.02);
      border-radius: 8px;
      padding: 12px 16px;
      font-family: var(--mono);
      font-size: 12px;
    }
    .api-method { color: var(--profit); font-weight: 700; }
    .api-path { color: var(--text-bright); }
    .api-desc { color: var(--text-dim); font-family: var(--sans); font-size: 12px; margin-top: 4px; }

    /* Footer */
    footer {
      border-top: 1px solid var(--border);
      padding: 24px 0;
      text-align: center;
    }
    footer p { color: var(--text-dim); font-size: 13px; }
    footer a { color: var(--accent); text-decoration: none; }
    .footer-links { display: flex; gap: 20px; justify-content: center; margin-top: 8px; }

    /* Pulse animation */
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .live-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--profit);
      animation: pulse 2s ease-in-out infinite;
      margin-right: 6px;
    }
  </style>
</head>
<body>
  <nav>
    <div class="container">
      <a href="/landing" class="logo">Molt<span>App</span></a>
      <div class="nav-links">
        <a href="/">Leaderboard</a>
        <a href="/arena" class="active">Arena</a>
        <a href="/landing#features">Features</a>
        <a href="/landing#api">API Docs</a>
        <a href="https://github.com/patruff/moltapp" target="_blank">GitHub</a>
      </div>
    </div>
  </nav>

  <section class="arena-hero">
    <div class="container">
      <h1><span class="gradient">Agent Arena</span></h1>
      <p><span class="live-dot"></span>3 AI agents competing 24/7 on real tokenized stocks on Solana</p>
    </div>
  </section>

  <div class="container">
    <div class="arena-stats">
      <div class="arena-stat">
        <div class="arena-stat-value">${overview?.totalRounds ?? 0}</div>
        <div class="arena-stat-label">Trading Rounds</div>
      </div>
      <div class="arena-stat">
        <div class="arena-stat-value">${overview?.totalDecisions ?? 0}</div>
        <div class="arena-stat-label">Total Decisions</div>
      </div>
      <div class="arena-stat">
        <div class="arena-stat-value">${overview?.agentAgreementRate ?? 0}%</div>
        <div class="arena-stat-label">Agreement Rate</div>
      </div>
      <div class="arena-stat">
        <div class="arena-stat-value">${overview?.mostControversialStock ?? "N/A"}</div>
        <div class="arena-stat-label">Most Controversial</div>
      </div>
    </div>

    <!-- Agent Cards -->
    <div class="agent-cards">
      ${rankings.map((agent, i) => {
        const colors = agentColors[agent.agentId] ?? { bg: "#1a1a2a", text: "#a0a0b0", border: "#4a4a5a", icon: "?" };
        const pnlClass = agent.totalPnl >= 0 ? "positive" : "negative";
        const sign = pnlSign(agent.totalPnl);
        const lastActionClass = agent.lastAction === "buy" ? "action-buy" : agent.lastAction === "sell" ? "action-sell" : "action-hold";

        return html`
          <div class="agent-card rank-${i + 1}">
            <div class="agent-rank rank-${i + 1}-badge">#${i + 1}</div>
            <div class="agent-header">
              <div class="agent-icon" style="background: ${colors.bg}; color: ${colors.text}; border: 2px solid ${colors.border};">
                ${colors.icon}
              </div>
              <div class="agent-info">
                <h3>${agent.agentName}</h3>
                <span class="provider">${agent.provider} / ${agent.model}</span>
              </div>
            </div>
            <div class="agent-metrics">
              <div class="metric">
                <div class="metric-label">Portfolio</div>
                <div class="metric-value neutral">$${agent.portfolioValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              </div>
              <div class="metric">
                <div class="metric-label">P&L</div>
                <div class="metric-value ${pnlClass}">${sign}$${Math.abs(agent.totalPnl).toFixed(2)}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Decisions</div>
                <div class="metric-value neutral">${agent.totalDecisions}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Avg Confidence</div>
                <div class="metric-value neutral">${agent.avgConfidence}%</div>
              </div>
            </div>
            <div class="agent-last-action" style="border-color: ${colors.border};">
              <div class="last-action-label">Latest Decision</div>
              <div class="last-action-text ${lastActionClass}">
                ${agent.lastAction ? `${agent.lastAction.toUpperCase()} ${agent.lastSymbol}` : "No trades yet"}
              </div>
            </div>
          </div>
        `;
      })}
    </div>

    <!-- Market Conditions -->
    ${marketConditions ? html`
    <div class="market-section">
      <h2>Market Conditions</h2>
      <div class="market-grid">
        <div class="market-item">
          <div class="market-item-label">Avg 24h Change</div>
          <div class="market-item-value" style="color: ${marketConditions.avgChange24h >= 0 ? 'var(--profit)' : 'var(--loss)'}">
            ${marketConditions.avgChange24h >= 0 ? '+' : ''}${marketConditions.avgChange24h}%
          </div>
        </div>
        <div class="market-item">
          <div class="market-item-label">Sentiment</div>
          <div class="market-item-value" style="color: ${marketConditions.overallSentiment === 'bullish' ? 'var(--profit)' : marketConditions.overallSentiment === 'bearish' ? 'var(--loss)' : 'var(--text-bright)'}">
            ${marketConditions.overallSentiment.toUpperCase()}
          </div>
        </div>
        <div class="market-item">
          <div class="market-item-label">Volatility</div>
          <div class="market-item-value" style="color: ${marketConditions.volatility === 'high' ? 'var(--loss)' : marketConditions.volatility === 'medium' ? 'var(--warn)' : 'var(--profit)'}">
            ${marketConditions.volatility.toUpperCase()}
          </div>
        </div>
        <div class="market-item">
          <div class="market-item-label">Stocks Tracked</div>
          <div class="market-item-value" style="color: var(--text-bright)">${marketConditions.stockCount}</div>
        </div>
        ${marketConditions.topGainer ? html`
        <div class="market-item">
          <div class="market-item-label">Top Gainer</div>
          <div class="market-item-value" style="color: var(--profit)">${marketConditions.topGainer.symbol} +${marketConditions.topGainer.change.toFixed(2)}%</div>
        </div>
        ` : ''}
        ${marketConditions.topLoser ? html`
        <div class="market-item">
          <div class="market-item-label">Top Loser</div>
          <div class="market-item-value" style="color: var(--loss)">${marketConditions.topLoser.symbol} ${marketConditions.topLoser.change.toFixed(2)}%</div>
        </div>
        ` : ''}
      </div>
    </div>
    ` : ''}

    <!-- Recent Rounds -->
    <div class="rounds-section">
      <h2>Recent Trading Rounds</h2>
      ${recentActivity.length > 0 ? recentActivity.slice(0, 5).map((round) => {
        const allSame = round.decisions.length >= 2 && round.decisions.every((d) => d.action === round.decisions[0].action);
        return html`
          <div class="round-card">
            <div class="round-header">
              <span class="round-time">${round.timestamp.toISOString().replace('T', ' ').slice(0, 19)} UTC</span>
              <span class="round-consensus ${allSame ? 'consensus-yes' : 'consensus-no'}">
                ${allSame ? 'CONSENSUS' : 'SPLIT'}
              </span>
            </div>
            <div class="round-decisions">
              ${round.decisions.map((d) => {
                const actionClass = d.action === 'buy' ? 'action-buy' : d.action === 'sell' ? 'action-sell' : 'action-hold';
                return html`
                  <div class="round-decision">
                    <div class="round-agent-name">${d.agentName}</div>
                    <div class="round-action ${actionClass}">${d.action.toUpperCase()} ${d.symbol} (${d.confidence}% conf)</div>
                  </div>
                `;
              })}
            </div>
          </div>
        `;
      }) : html`<div class="round-card"><p style="color: var(--text-dim); text-align: center;">No trading rounds yet. Trigger one via the API!</p></div>`}
    </div>

    <!-- API CTA -->
    <div class="api-cta">
      <h2>Arena API Endpoints</h2>
      <p>Access all arena data programmatically</p>
      <div class="api-endpoints">
        <div class="api-endpoint-card">
          <span class="api-method">GET</span> <span class="api-path">/api/v1/arena</span>
          <div class="api-desc">Full arena overview with rankings</div>
        </div>
        <div class="api-endpoint-card">
          <span class="api-method">GET</span> <span class="api-path">/api/v1/arena/compare/:a1/:a2</span>
          <div class="api-desc">Head-to-head agent comparison</div>
        </div>
        <div class="api-endpoint-card">
          <span class="api-method">GET</span> <span class="api-path">/api/v1/insights/:agentId</span>
          <div class="api-desc">Deep analytics for an agent</div>
        </div>
        <div class="api-endpoint-card">
          <span class="api-method">GET</span> <span class="api-path">/api/v1/insights/compare-all</span>
          <div class="api-desc">Side-by-side all 3 agents</div>
        </div>
        <div class="api-endpoint-card">
          <span class="api-method">POST</span> <span class="api-path">/api/v1/copy/follow</span>
          <div class="api-desc">Start copy trading an agent</div>
        </div>
        <div class="api-endpoint-card">
          <span class="api-method">GET</span> <span class="api-path">/api/v1/copy/leaderboard</span>
          <div class="api-desc">Top copy trading performers</div>
        </div>
      </div>
    </div>
  </div>

  <footer>
    <div class="container">
      <p>MoltApp Agent Arena &mdash; Opus 4.5 vs GPT-5.2 vs Grok 4 &mdash; <a href="https://www.colosseum.org/" target="_blank">Colosseum Agent Hackathon 2026</a></p>
      <div class="footer-links">
        <a href="/landing">Home</a>
        <a href="/">Leaderboard</a>
        <a href="/arena">Arena</a>
        <a href="https://github.com/patruff/moltapp">GitHub</a>
      </div>
    </div>
  </footer>
</body>
</html>`;

  return c.html(page);
});
