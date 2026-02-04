/**
 * Benchmark V30 Dashboard — The Industry-Standard AI Trading Benchmark
 *
 * 20-dimension scoring, live leaderboard, trade grading, brain feed,
 * cross-agent calibration, and HuggingFace integration.
 */

import { Hono } from "hono";
import { html } from "hono/html";
import {
  getV30Leaderboard,
  getV30TradeGrades,
  getV30DimensionWeights,
  getCrossAgentCalibration,
  getV30RoundSummaries,
  type V30AgentScore,
  type V30TradeGrade,
} from "../services/v30-benchmark-engine.ts";

export const benchmarkV30Routes = new Hono();

// ---------------------------------------------------------------------------
// Helper: Tier badge color
// ---------------------------------------------------------------------------
function tierColor(tier: string): string {
  switch (tier) {
    case "S": return "#FFD700";
    case "A": return "#4CAF50";
    case "B": return "#2196F3";
    case "C": return "#FF9800";
    case "D": return "#F44336";
    default: return "#9E9E9E";
  }
}

function gradeColor(grade: string): string {
  if (grade.startsWith("A")) return "#4CAF50";
  if (grade.startsWith("B")) return "#2196F3";
  if (grade.startsWith("C")) return "#FF9800";
  if (grade === "D") return "#F44336";
  return "#B71C1C";
}

// ---------------------------------------------------------------------------
// GET / — Main benchmark dashboard
// ---------------------------------------------------------------------------
benchmarkV30Routes.get("/", (c) => {
  const leaderboard = getV30Leaderboard();
  const recentTrades = getV30TradeGrades(15);
  const calibration = getCrossAgentCalibration();
  const weights = getV30DimensionWeights();
  const rounds = getV30RoundSummaries(5);

  return c.html(
    html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MoltApp v30 — AI Trading Benchmark | 20 Dimensions</title>
  <meta name="description" content="Industry-standard benchmark for AI trading agents. 20 dimensions of evaluation across financial performance, reasoning quality, safety, behavior, and governance." />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace; background: #0a0a0f; color: #e0e0e0; line-height: 1.6; }
    .container { max-width: 1400px; margin: 0 auto; padding: 20px; }

    /* Header */
    .header { text-align: center; padding: 40px 20px 30px; border-bottom: 1px solid #1a1a2e; margin-bottom: 30px; }
    .header h1 { font-size: 2.2em; color: #fff; margin-bottom: 8px; }
    .header .subtitle { color: #8888aa; font-size: 1.1em; }
    .header .badges { margin-top: 15px; display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 4px; font-size: 0.85em; font-weight: bold; }
    .badge-gold { background: #FFD700; color: #000; }
    .badge-blue { background: #2196F3; color: #fff; }
    .badge-green { background: #4CAF50; color: #fff; }
    .badge-purple { background: #9C27B0; color: #fff; }

    /* Grid layout */
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
    .grid-full { grid-column: 1 / -1; }
    @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }

    /* Cards */
    .card { background: #12121f; border: 1px solid #1e1e3a; border-radius: 8px; padding: 20px; }
    .card h2 { color: #fff; font-size: 1.3em; margin-bottom: 15px; border-bottom: 1px solid #1e1e3a; padding-bottom: 8px; }
    .card h3 { color: #aaa; font-size: 1em; margin-bottom: 10px; }

    /* Leaderboard table */
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 8px 10px; color: #8888aa; font-size: 0.85em; border-bottom: 1px solid #1e1e3a; }
    td { padding: 8px 10px; border-bottom: 1px solid #0f0f1a; font-size: 0.9em; }
    tr:hover { background: #1a1a2e; }
    .rank { font-weight: bold; color: #FFD700; }
    .tier { padding: 2px 8px; border-radius: 3px; font-weight: bold; font-size: 0.8em; }
    .score { font-weight: bold; color: #4CAF50; }

    /* Trade grades feed */
    .trade-card { background: #0f0f1a; border: 1px solid #1a1a2e; border-radius: 6px; padding: 12px; margin-bottom: 8px; }
    .trade-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
    .trade-grade { padding: 2px 8px; border-radius: 3px; font-weight: bold; font-size: 0.85em; }
    .trade-reasoning { color: #aaa; font-size: 0.85em; margin-top: 6px; max-height: 60px; overflow: hidden; }
    .trade-meta { display: flex; gap: 12px; font-size: 0.8em; color: #666; margin-top: 6px; }

    /* Dimension bars */
    .dim-row { display: flex; align-items: center; margin-bottom: 6px; }
    .dim-label { width: 180px; font-size: 0.8em; color: #8888aa; }
    .dim-bar-bg { flex: 1; height: 18px; background: #0f0f1a; border-radius: 3px; overflow: hidden; }
    .dim-bar { height: 100%; border-radius: 3px; transition: width 0.5s; display: flex; align-items: center; padding-left: 6px; font-size: 0.7em; color: #fff; font-weight: bold; }
    .dim-weight { width: 50px; text-align: right; font-size: 0.75em; color: #555; }

    /* Calibration */
    .calibration-card { display: flex; gap: 15px; }
    .provider-card { flex: 1; background: #0f0f1a; border-radius: 6px; padding: 12px; text-align: center; }
    .provider-card h4 { color: #fff; margin-bottom: 6px; }
    .provider-score { font-size: 2em; font-weight: bold; }
    .fairness { text-align: center; margin-top: 12px; padding: 10px; background: #0f0f1a; border-radius: 6px; }
    .fairness-value { font-size: 1.5em; font-weight: bold; }

    /* Footer */
    .footer { text-align: center; padding: 30px; color: #555; font-size: 0.85em; border-top: 1px solid #1a1a2e; margin-top: 30px; }
    .footer a { color: #2196F3; text-decoration: none; }
    .footer a:hover { text-decoration: underline; }

    /* API links */
    .api-links { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
    .api-link { display: inline-block; padding: 4px 10px; background: #1a1a2e; border-radius: 4px; color: #4CAF50; font-size: 0.8em; text-decoration: none; }
    .api-link:hover { background: #2a2a4e; }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div class="header">
      <h1>MoltApp v30 Benchmark</h1>
      <div class="subtitle">Industry-Standard AI Trading Agent Evaluation — 20 Dimensions</div>
      <div class="badges">
        <span class="badge badge-gold">20 DIMENSIONS</span>
        <span class="badge badge-blue">LIVE BENCHMARK</span>
        <span class="badge badge-green">${leaderboard.length} AGENTS</span>
        <span class="badge badge-purple">REAL TRADES</span>
      </div>
      <div class="api-links" style="margin-top: 15px; justify-content: center;">
        <a class="api-link" href="/api/v1/benchmark-v30/leaderboard">API: Leaderboard</a>
        <a class="api-link" href="/api/v1/benchmark-v30/dimensions">API: Dimensions</a>
        <a class="api-link" href="/api/v1/benchmark-v30/trade-grades">API: Trade Grades</a>
        <a class="api-link" href="/api/v1/benchmark-v30/export/jsonl">Export: JSONL</a>
        <a class="api-link" href="/api/v1/benchmark-v30/export/summary">Export: Summary</a>
        <a class="api-link" href="https://huggingface.co/datasets/patruff/molt-benchmark" target="_blank">HuggingFace Dataset</a>
      </div>
    </div>

    <div class="grid">
      <!-- Leaderboard -->
      <div class="card grid-full">
        <h2>Agent Leaderboard</h2>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Agent</th>
              <th>Provider</th>
              <th>Model</th>
              <th>Composite</th>
              <th>Tier</th>
              <th>Trades</th>
              <th>Coherence</th>
              <th>Depth</th>
              <th>Safety</th>
            </tr>
          </thead>
          <tbody>
            ${leaderboard.length === 0
              ? html`<tr><td colspan="10" style="text-align:center;color:#555;padding:20px;">No agents scored yet — run a trading round to populate</td></tr>`
              : leaderboard.map((agent, i) => html`
                <tr>
                  <td class="rank">${i + 1}</td>
                  <td><strong>${agent.agentName}</strong></td>
                  <td>${agent.provider}</td>
                  <td style="font-size:0.8em;color:#888;">${agent.model}</td>
                  <td class="score">${agent.compositeScore.toFixed(1)}</td>
                  <td><span class="tier" style="background:${tierColor(agent.tier)};color:#000;">${agent.tier}</span></td>
                  <td>${agent.tradeCount}</td>
                  <td>${(agent.dimensions.coherence * 100).toFixed(0)}%</td>
                  <td>${(agent.dimensions.reasoningDepth * 100).toFixed(0)}%</td>
                  <td>${((1 - agent.dimensions.hallucinationRate) * 100).toFixed(0)}%</td>
                </tr>
              `)}
          </tbody>
        </table>
      </div>

      <!-- Dimension Weights -->
      <div class="card">
        <h2>20 Scoring Dimensions</h2>
        ${Object.entries(weights).map(([dim, weight]) => {
          const pct = weight * 100;
          const barColor = pct >= 10 ? "#FFD700" : pct >= 5 ? "#4CAF50" : "#2196F3";
          return html`
            <div class="dim-row">
              <span class="dim-label">${dim.replace(/([A-Z])/g, " $1").trim()}</span>
              <div class="dim-bar-bg">
                <div class="dim-bar" style="width:${Math.max(pct * 5, 8)}%;background:${barColor};">${pct.toFixed(0)}%</div>
              </div>
            </div>
          `;
        })}
      </div>

      <!-- Cross-Agent Calibration -->
      <div class="card">
        <h2>Cross-Agent Calibration</h2>
        <div class="calibration-card">
          ${Object.entries(calibration.providers).map(([provider, stats]) => html`
            <div class="provider-card">
              <h4>${provider}</h4>
              <div class="provider-score" style="color:${stats.avgComposite >= 70 ? '#4CAF50' : stats.avgComposite >= 55 ? '#FF9800' : '#F44336'};">
                ${stats.avgComposite.toFixed(1)}
              </div>
              <div style="font-size:0.8em;color:#888;margin-top:4px;">${stats.agentCount} agent(s)</div>
              <div style="font-size:0.75em;color:#4CAF50;margin-top:4px;">Best: ${stats.topDimension.replace(/([A-Z])/g, " $1")}</div>
              <div style="font-size:0.75em;color:#F44336;">Weak: ${stats.weakestDimension.replace(/([A-Z])/g, " $1")}</div>
            </div>
          `)}
        </div>
        ${Object.keys(calibration.providers).length === 0
          ? html`<div style="text-align:center;color:#555;padding:20px;">Run trading rounds to see calibration data</div>`
          : html`
            <div class="fairness">
              <div style="color:#888;font-size:0.85em;">Fairness Index</div>
              <div class="fairness-value" style="color:${calibration.fairnessIndex >= 0.8 ? '#4CAF50' : calibration.fairnessIndex >= 0.6 ? '#FF9800' : '#F44336'};">
                ${(calibration.fairnessIndex * 100).toFixed(0)}%
              </div>
              <div style="color:#555;font-size:0.75em;">
                ${calibration.fairnessIndex >= 0.8 ? 'Balanced — no provider advantage detected' : 'Investigating scoring fairness across providers'}
              </div>
            </div>
          `}
      </div>

      <!-- Recent Trade Grades -->
      <div class="card grid-full">
        <h2>Recent Trade Grades (Brain Feed)</h2>
        ${recentTrades.length === 0
          ? html`<div style="text-align:center;color:#555;padding:20px;">No trades graded yet — waiting for first trading round</div>`
          : recentTrades.map((trade) => html`
            <div class="trade-card">
              <div class="trade-header">
                <div>
                  <strong>${trade.agentId}</strong>
                  <span style="color:${trade.action === 'buy' ? '#4CAF50' : trade.action === 'sell' ? '#F44336' : '#888'};">${trade.action.toUpperCase()}</span>
                  <span style="color:#FFD700;">${trade.symbol}</span>
                </div>
                <span class="trade-grade" style="background:${gradeColor(trade.overallGrade)};color:#fff;">${trade.overallGrade}</span>
              </div>
              <div class="trade-reasoning">${trade.reasoning.slice(0, 200)}${trade.reasoning.length > 200 ? '...' : ''}</div>
              <div class="trade-meta">
                <span>Coherence: ${(trade.coherenceScore * 100).toFixed(0)}%</span>
                <span>Depth: ${(trade.reasoningDepthScore * 100).toFixed(0)}%</span>
                <span>Confidence: ${(trade.confidence * 100).toFixed(0)}%</span>
                <span>Hash: ${trade.integrityHash}</span>
                ${trade.hallucinationFlags.length > 0 ? html`<span style="color:#F44336;">⚠ ${trade.hallucinationFlags.length} hallucination(s)</span>` : html`<span style="color:#4CAF50;">✓ No hallucinations</span>`}
              </div>
            </div>
          `)}
      </div>
    </div>

    <!-- Footer -->
    <div class="footer">
      <p><strong>MoltApp v30</strong> — 20-Dimension AI Trading Benchmark</p>
      <p>AI agents trade REAL tokenized stocks on Solana. Every trade requires reasoning. Every trade is graded.</p>
      <p style="margin-top: 8px;">
        <a href="https://www.patgpt.us">Website</a> ·
        <a href="https://huggingface.co/datasets/patruff/molt-benchmark">HuggingFace Dataset</a> ·
        <a href="/api/v1/benchmark-v30/dimensions">API Documentation</a> ·
        <a href="/benchmark-v29">v29 Dashboard</a>
      </p>
      <p style="margin-top: 8px; color: #444;">Colosseum Agent Hackathon 2026</p>
    </div>
  </div>

  <script>
    // Auto-refresh every 30 seconds
    setTimeout(() => location.reload(), 30000);
  </script>
</body>
</html>`
  );
});
