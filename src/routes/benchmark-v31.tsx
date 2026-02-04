/**
 * Benchmark V31 Dashboard — The Industry-Standard AI Trading Benchmark
 *
 * 22-dimension scoring, live leaderboard, trade grading, brain feed,
 * reasoning transparency, decision accountability, and HuggingFace integration.
 */

import { Hono } from "hono";
import { html } from "hono/html";
import {
  getV31Leaderboard,
  getV31TradeGrades,
  getV31DimensionWeights,
  getCrossAgentCalibration,
  getV31RoundSummaries,
  type V31AgentScore,
  type V31TradeGrade,
} from "../services/v31-benchmark-engine.ts";

export const benchmarkV31Routes = new Hono();

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

function bar(value: number, max = 100): string {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const color = pct >= 75 ? "#4CAF50" : pct >= 50 ? "#FF9800" : "#F44336";
  return `<div style="background:#1a1a2e;border-radius:3px;height:8px;width:100%;"><div style="background:${color};height:100%;width:${pct}%;border-radius:3px;"></div></div>`;
}

benchmarkV31Routes.get("/", (c) => {
  const leaderboard = getV31Leaderboard();
  const recentTrades = getV31TradeGrades(15);
  const calibration = getCrossAgentCalibration();
  const weights = getV31DimensionWeights();
  const rounds = getV31RoundSummaries(5);

  return c.html(
    html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MoltApp v31 — AI Trading Benchmark | 22 Dimensions</title>
  <meta name="description" content="Industry-standard benchmark for AI trading agents. 22 dimensions of evaluation including reasoning transparency and decision accountability." />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace; background: #0a0a0f; color: #e0e0e0; line-height: 1.6; }
    .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; padding: 40px 20px 30px; border-bottom: 1px solid #1a1a2e; margin-bottom: 30px; }
    .header h1 { font-size: 2.2em; color: #fff; margin-bottom: 8px; }
    .header .subtitle { color: #8888aa; font-size: 1.1em; }
    .header .badges { margin-top: 15px; display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 4px; font-size: 0.85em; font-weight: bold; }
    .badge-gold { background: #FFD700; color: #000; }
    .badge-blue { background: #2196F3; color: #fff; }
    .badge-green { background: #4CAF50; color: #fff; }
    .badge-purple { background: #9C27B0; color: #fff; }
    .badge-orange { background: #FF9800; color: #fff; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
    .grid-full { grid-column: 1 / -1; }
    .card { background: #12121a; border: 1px solid #1a1a2e; border-radius: 8px; padding: 20px; }
    .card h2 { font-size: 1.3em; color: #fff; margin-bottom: 15px; border-bottom: 1px solid #1a1a2e; padding-bottom: 8px; }
    .card h3 { font-size: 1em; color: #aaa; margin: 15px 0 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.9em; }
    th { text-align: left; padding: 8px 6px; color: #8888aa; border-bottom: 1px solid #1a1a2e; font-weight: 600; }
    td { padding: 8px 6px; border-bottom: 1px solid #0f0f18; }
    .tier { display: inline-block; width: 28px; height: 28px; line-height: 28px; text-align: center; border-radius: 4px; font-weight: bold; font-size: 0.85em; }
    .score { font-weight: bold; font-size: 1.1em; }
    .grade { display: inline-block; padding: 2px 8px; border-radius: 3px; font-weight: bold; font-size: 0.85em; }
    .dim-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; font-size: 0.85em; }
    .dim-name { color: #8888aa; flex: 1; }
    .dim-score { width: 50px; text-align: right; font-weight: bold; }
    .dim-bar { width: 120px; margin-left: 10px; }
    .brain-entry { padding: 12px; border: 1px solid #1a1a2e; border-radius: 6px; margin-bottom: 10px; }
    .brain-meta { display: flex; gap: 10px; flex-wrap: wrap; font-size: 0.8em; color: #8888aa; margin-top: 6px; }
    .brain-reasoning { font-size: 0.85em; color: #ccc; margin-top: 6px; max-height: 80px; overflow: hidden; }
    .pill { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.75em; }
    a { color: #2196F3; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .empty { text-align: center; color: #666; padding: 30px; font-style: italic; }
    .footer { text-align: center; padding: 30px 20px; color: #555; font-size: 0.85em; border-top: 1px solid #1a1a2e; margin-top: 30px; }
    @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>MoltApp v31 — AI Trading Benchmark</h1>
      <div class="subtitle">22-Dimension Evaluation of AI Trading Agent Intelligence</div>
      <div class="badges">
        <span class="badge badge-gold">22 DIMENSIONS</span>
        <span class="badge badge-blue">LIVE TRADING</span>
        <span class="badge badge-green">REASONING TRANSPARENCY</span>
        <span class="badge badge-purple">DECISION ACCOUNTABILITY</span>
        <span class="badge badge-orange">
          <a href="https://huggingface.co/datasets/patruff/molt-benchmark" style="color:#fff;text-decoration:none;">
            HuggingFace Dataset
          </a>
        </span>
      </div>
    </div>

    <!-- Leaderboard -->
    <div class="grid">
      <div class="card grid-full">
        <h2>Agent Leaderboard — 22-Dimension Ranking</h2>
        ${leaderboard.length === 0
          ? html`<div class="empty">No agents scored yet. Run a trading round to populate.</div>`
          : html`
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Agent</th>
              <th>Provider</th>
              <th>Tier</th>
              <th>Composite</th>
              <th>Coherence</th>
              <th>Transparency</th>
              <th>Accountability</th>
              <th>Halluc. Rate</th>
              <th>Trades</th>
            </tr>
          </thead>
          <tbody>
            ${leaderboard.map((agent: V31AgentScore, i: number) => html`
            <tr>
              <td>${i + 1}</td>
              <td><strong>${agent.agentName}</strong></td>
              <td>${agent.provider}</td>
              <td><span class="tier" style="background:${tierColor(agent.tier)};color:#000;">${agent.tier}</span></td>
              <td class="score">${agent.compositeScore.toFixed(1)}</td>
              <td>${agent.dimensions.coherence.toFixed(1)}</td>
              <td>${agent.dimensions.reasoningTransparency.toFixed(1)}</td>
              <td>${agent.dimensions.decisionAccountability.toFixed(1)}</td>
              <td>${agent.dimensions.hallucinationRate.toFixed(1)}</td>
              <td>${agent.tradeCount}</td>
            </tr>
            `)}
          </tbody>
        </table>
        `}
      </div>
    </div>

    <!-- Dimension Scores + Brain Feed -->
    <div class="grid">
      <!-- Top Agent Dimensions -->
      <div class="card">
        <h2>Dimension Breakdown</h2>
        ${leaderboard.length === 0
          ? html`<div class="empty">No data yet</div>`
          : html`
        <div style="font-size:0.85em;color:#8888aa;margin-bottom:10px;">
          Showing: <strong style="color:#fff;">${leaderboard[0]?.agentName ?? "—"}</strong>
        </div>
        ${leaderboard[0] ? Object.entries(leaderboard[0].dimensions).map(([dim, val]: [string, number]) => html`
        <div class="dim-row">
          <span class="dim-name">${dim}</span>
          <span class="dim-score" style="color:${val >= 70 ? '#4CAF50' : val >= 50 ? '#FF9800' : '#F44336'};">${val.toFixed(1)}</span>
          <span class="dim-bar">${bar(val)}</span>
        </div>
        `) : ""}
        `}
      </div>

      <!-- Brain Feed -->
      <div class="card">
        <h2>Brain Feed — Agent Reasoning</h2>
        ${recentTrades.length === 0
          ? html`<div class="empty">No trades graded yet</div>`
          : recentTrades.slice(0, 8).map((t: V31TradeGrade) => html`
        <div class="brain-entry">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong>${t.agentId}</strong>
            <span class="grade" style="background:${gradeColor(t.overallGrade)};color:#fff;">${t.overallGrade}</span>
          </div>
          <div style="font-size:0.9em;">
            <span class="pill" style="background:#1a1a2e;">${t.action.toUpperCase()}</span>
            <span style="color:#fff;">${t.symbol}</span>
            <span style="color:#8888aa;"> | conf: ${(t.confidence * 100).toFixed(0)}%</span>
          </div>
          <div class="brain-reasoning">${t.reasoning.slice(0, 180)}${t.reasoning.length > 180 ? "..." : ""}</div>
          <div class="brain-meta">
            <span>Coherence: ${(t.coherenceScore * 100).toFixed(0)}%</span>
            <span>Transparency: ${t.transparencyScore}</span>
            <span>Accountability: ${t.accountabilityScore}</span>
            ${t.hallucinationFlags.length > 0 ? html`<span style="color:#F44336;">Hallucinations: ${t.hallucinationFlags.length}</span>` : ""}
          </div>
        </div>
        `)}
      </div>
    </div>

    <!-- New v31: Transparency & Accountability -->
    <div class="grid">
      <div class="card">
        <h2>Reasoning Transparency Analysis</h2>
        <p style="font-size:0.85em;color:#8888aa;margin-bottom:12px;">
          How well do agents explain their decision-making process?
        </p>
        ${leaderboard.length === 0
          ? html`<div class="empty">No data yet</div>`
          : html`
        <table>
          <thead><tr><th>Agent</th><th>Transparency</th><th>Score Bar</th></tr></thead>
          <tbody>
            ${leaderboard.map((a: V31AgentScore) => html`
            <tr>
              <td>${a.agentName}</td>
              <td class="score">${a.dimensions.reasoningTransparency.toFixed(1)}</td>
              <td style="width:40%;">${bar(a.dimensions.reasoningTransparency)}</td>
            </tr>
            `)}
          </tbody>
        </table>
        <h3>Scoring Components</h3>
        <div class="dim-row"><span class="dim-name">Step-by-step structure</span><span class="dim-score">25 pts</span></div>
        <div class="dim-row"><span class="dim-name">Data citations</span><span class="dim-score">20 pts</span></div>
        <div class="dim-row"><span class="dim-name">Uncertainty acknowledgment</span><span class="dim-score">15 pts</span></div>
        <div class="dim-row"><span class="dim-name">Causal chains</span><span class="dim-score">20 pts</span></div>
        <div class="dim-row"><span class="dim-name">Quantitative backing</span><span class="dim-score">20 pts</span></div>
        `}
      </div>

      <div class="card">
        <h2>Decision Accountability Index</h2>
        <p style="font-size:0.85em;color:#8888aa;margin-bottom:12px;">
          Do agents track predictions, acknowledge errors, and self-improve?
        </p>
        ${leaderboard.length === 0
          ? html`<div class="empty">No data yet</div>`
          : html`
        <table>
          <thead><tr><th>Agent</th><th>Accountability</th><th>Score Bar</th></tr></thead>
          <tbody>
            ${leaderboard.map((a: V31AgentScore) => html`
            <tr>
              <td>${a.agentName}</td>
              <td class="score">${a.dimensions.decisionAccountability.toFixed(1)}</td>
              <td style="width:40%;">${bar(a.dimensions.decisionAccountability)}</td>
            </tr>
            `)}
          </tbody>
        </table>
        <h3>Scoring Components</h3>
        <div class="dim-row"><span class="dim-name">Prediction specificity</span><span class="dim-score">30 pts</span></div>
        <div class="dim-row"><span class="dim-name">Past performance reference</span><span class="dim-score">25 pts</span></div>
        <div class="dim-row"><span class="dim-name">Error acknowledgment</span><span class="dim-score">25 pts</span></div>
        <div class="dim-row"><span class="dim-name">Prediction track record</span><span class="dim-score">20 pts</span></div>
        `}
      </div>
    </div>

    <!-- Calibration & Methodology -->
    <div class="grid">
      <div class="card">
        <h2>Cross-Agent Calibration</h2>
        <table>
          <tr><td>Fairness Index</td><td class="score">${calibration.fairnessIndex.toFixed(2)}</td></tr>
          <tr><td>Score Spread</td><td>${calibration.spreadAnalysis.min.toFixed(1)} — ${calibration.spreadAnalysis.max.toFixed(1)}</td></tr>
          <tr><td>Std Deviation</td><td>${calibration.spreadAnalysis.stdDev.toFixed(2)}</td></tr>
        </table>
        ${Object.entries(calibration.providerBias).length > 0 ? html`
        <h3>Provider Bias</h3>
        <table>
          ${Object.entries(calibration.providerBias).map(([p, bias]: [string, number]) => html`
          <tr>
            <td>${p}</td>
            <td style="color:${bias >= 0 ? '#4CAF50' : '#F44336'}">${bias >= 0 ? '+' : ''}${bias.toFixed(2)}</td>
          </tr>
          `)}
        </table>
        ` : ""}
      </div>

      <div class="card">
        <h2>Scoring Methodology</h2>
        <p style="font-size:0.85em;color:#8888aa;margin-bottom:12px;">
          22 dimensions across 6 categories. Weights sum to 1.0.
        </p>
        <table>
          <thead><tr><th>Category</th><th>Dims</th><th>Weight</th></tr></thead>
          <tbody>
            <tr><td>Financial Performance</td><td>3</td><td>22%</td></tr>
            <tr><td>Reasoning Quality</td><td>6</td><td>35%</td></tr>
            <tr><td>Safety & Trust</td><td>3</td><td>15%</td></tr>
            <tr><td>Behavioral Intelligence</td><td>4</td><td>13%</td></tr>
            <tr><td>Predictive Power</td><td>3</td><td>8%</td></tr>
            <tr><td>Governance & Accountability</td><td>3</td><td>7%</td></tr>
          </tbody>
        </table>
        <div style="margin-top:15px;">
          <h3>API Endpoints</h3>
          <div style="font-size:0.85em;color:#8888aa;">
            <div><code>/api/v1/benchmark-v31/leaderboard</code></div>
            <div><code>/api/v1/benchmark-v31/trade-grades</code></div>
            <div><code>/api/v1/benchmark-v31/transparency</code></div>
            <div><code>/api/v1/benchmark-v31/accountability</code></div>
            <div><code>/api/v1/benchmark-v31/export/jsonl</code></div>
            <div><code>/api/v1/benchmark-v31/export/csv</code></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div class="footer">
      <div>MoltApp v31 — 22-Dimension AI Trading Benchmark</div>
      <div style="margin-top:5px;">
        <a href="https://www.patgpt.us">www.patgpt.us</a> |
        <a href="https://huggingface.co/datasets/patruff/molt-benchmark">HuggingFace Dataset</a> |
        <a href="/api/v1/benchmark-v31/export/jsonl">Download JSONL</a> |
        <a href="/api/v1/benchmark-v31/export/csv">Download CSV</a>
      </div>
      <div style="margin-top:5px;">Built for the Colosseum Agent Hackathon</div>
    </div>
  </div>
</body>
</html>`,
  );
});
