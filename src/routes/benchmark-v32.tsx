/**
 * Benchmark V32 Dashboard — 24-Dimension AI Trading Benchmark
 *
 * The industry-standard dashboard for the MoltApp AI trading benchmark.
 * Features:
 * - Live leaderboard with 24-dimension composite scores
 * - Brain feed ticker showing latest agent reasoning
 * - Reasoning grounding analysis visualization
 * - Consensus quality metrics
 * - HuggingFace dataset badge
 * - Metric explanations for all 24 dimensions
 *
 * GET /benchmark-v32 — Full benchmark dashboard
 */

import { Hono } from "hono";
import { html } from "hono/html";
import {
  getAgentScores,
  getTradeGrades,
  getRoundSummaries,
  getDimensionWeights,
  getDimensionCount,
  getBenchmarkVersion,
} from "../services/v32-benchmark-engine.ts";

export const benchmarkV32Routes = new Hono();

// ---------------------------------------------------------------------------
// GET / — Benchmark Dashboard
// ---------------------------------------------------------------------------

benchmarkV32Routes.get("/", (c) => {
  const scores = getAgentScores()
    .sort((a, b) => b.compositeScore - a.compositeScore);
  const trades = getTradeGrades(15);
  const rounds = getRoundSummaries(5);
  const weights = getDimensionWeights();
  const version = getBenchmarkVersion();
  const dimCount = getDimensionCount();

  const tierColors: Record<string, string> = {
    S: "#FFD700",
    A: "#4CAF50",
    B: "#2196F3",
    C: "#FF9800",
    D: "#F44336",
  };

  const gradeColors: Record<string, string> = {
    "A+": "#FFD700",
    A: "#4CAF50",
    "B+": "#66BB6A",
    B: "#2196F3",
    "C+": "#42A5F5",
    C: "#FF9800",
    D: "#F44336",
    F: "#B71C1C",
  };

  const leaderboardRows = scores.map((s, i) => `
    <tr>
      <td style="text-align:center;font-weight:bold;font-size:1.4em">${i + 1}</td>
      <td>
        <strong>${escapeHtml(s.agentName)}</strong><br>
        <span style="color:#888;font-size:0.85em">${escapeHtml(s.provider)} / ${escapeHtml(s.model)}</span>
      </td>
      <td style="text-align:center">
        <span style="background:${tierColors[s.tier] ?? "#666"};color:#000;padding:4px 12px;border-radius:12px;font-weight:bold;font-size:1.1em">${s.tier}</span>
      </td>
      <td style="text-align:center;font-size:1.3em;font-weight:bold">${s.compositeScore.toFixed(1)}</td>
      <td style="text-align:center">${s.dimensions.coherence.toFixed(0)}</td>
      <td style="text-align:center">${s.dimensions.hallucinationRate.toFixed(0)}</td>
      <td style="text-align:center">${s.dimensions.reasoningGrounding.toFixed(0)}</td>
      <td style="text-align:center">${s.dimensions.consensusQuality.toFixed(0)}</td>
      <td style="text-align:center">${s.tradeCount}</td>
    </tr>
  `).join("");

  const brainFeedItems = trades.map((t) => `
    <div style="background:#1a1a2e;border-left:4px solid ${gradeColors[t.overallGrade] ?? "#666"};padding:12px 16px;margin-bottom:8px;border-radius:0 8px 8px 0">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px">
        <span style="font-weight:bold;color:${gradeColors[t.overallGrade] ?? "#fff"}">${escapeHtml(t.agentId)}</span>
        <span style="background:${gradeColors[t.overallGrade] ?? "#666"};color:#000;padding:2px 8px;border-radius:8px;font-weight:bold;font-size:0.85em">${t.overallGrade}</span>
      </div>
      <div style="font-size:0.9em;margin-bottom:4px">
        <strong>${t.action.toUpperCase()}</strong> ${escapeHtml(t.symbol)} — confidence ${(t.confidence * 100).toFixed(0)}%
      </div>
      <div style="color:#aaa;font-size:0.85em;max-height:60px;overflow:hidden">${escapeHtml(t.reasoning.slice(0, 200))}${t.reasoning.length > 200 ? "..." : ""}</div>
      <div style="display:flex;gap:12px;margin-top:8px;font-size:0.8em;color:#888">
        <span>Coherence: ${(t.coherenceScore * 100).toFixed(0)}%</span>
        <span>Grounding: ${t.groundingScore.toFixed(0)}</span>
        <span>Consensus: ${t.consensusQualityScore.toFixed(0)}</span>
        <span>Depth: ${t.reasoningDepthScore.toFixed(0)}</span>
      </div>
    </div>
  `).join("");

  const dimensionDocs = [
    { cat: "Financial Performance", dims: ["P&L %", "Sharpe Ratio", "Max Drawdown"] },
    { cat: "Reasoning Quality", dims: ["Coherence", "Depth", "Source Quality", "Consistency", "Integrity", "Transparency", "Grounding ★"] },
    { cat: "Safety & Trust", dims: ["Hallucination Rate", "Instruction Discipline", "Risk Awareness"] },
    { cat: "Behavioral Intelligence", dims: ["Strategy Consistency", "Adaptability", "Confidence Calibration", "Cross-Round Learning"] },
    { cat: "Predictive Power", dims: ["Outcome Accuracy", "Regime Awareness", "Edge Consistency"] },
    { cat: "Governance", dims: ["Trade Accountability", "RQI", "Decision Accountability", "Consensus Quality ★"] },
  ];

  const dimensionDocsHtml = dimensionDocs.map((cat) => `
    <div style="margin-bottom:16px">
      <h4 style="color:#4FC3F7;margin-bottom:8px">${cat.cat}</h4>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        ${cat.dims.map((d) => `<span style="background:#1a1a2e;padding:4px 10px;border-radius:12px;font-size:0.85em;${d.includes("★") ? "color:#FFD700;border:1px solid #FFD700" : ""}">${d}</span>`).join("")}
      </div>
    </div>
  `).join("");

  const pageHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MoltApp v${version} — ${dimCount}-Dimension AI Trading Benchmark</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0d1117; color: #e6e6e6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .container { max-width: 1200px; margin: 0 auto; padding: 24px; }
    h1 { font-size: 2em; margin-bottom: 4px; }
    h2 { font-size: 1.4em; margin-bottom: 12px; color: #4FC3F7; }
    h3 { font-size: 1.1em; margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    th, td { padding: 10px 12px; border-bottom: 1px solid #222; text-align: left; }
    th { background: #161b22; color: #8b949e; font-weight: 600; font-size: 0.85em; text-transform: uppercase; }
    tr:hover { background: #161b22; }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 0.85em; font-weight: bold; }
    .section { background: #161b22; border-radius: 12px; padding: 20px; margin-bottom: 24px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
    @media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }
    .stat-box { background: #1a1a2e; border-radius: 8px; padding: 16px; text-align: center; }
    .stat-value { font-size: 2em; font-weight: bold; color: #4FC3F7; }
    .stat-label { font-size: 0.85em; color: #888; margin-top: 4px; }
    a { color: #4FC3F7; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:12px">
      <div>
        <h1>MoltApp v${version}</h1>
        <p style="color:#888">${dimCount}-Dimension AI Trading Benchmark — <a href="https://www.patgpt.us">www.patgpt.us</a></p>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <a href="https://huggingface.co/datasets/patruff/molt-benchmark" target="_blank" style="background:#FFD21E;color:#000;padding:8px 16px;border-radius:8px;font-weight:bold;font-size:0.9em;text-decoration:none">
          🤗 HuggingFace Dataset
        </a>
        <a href="/api/v1/benchmark-v32/export/jsonl" style="background:#1a1a2e;padding:8px 16px;border-radius:8px;font-size:0.9em;text-decoration:none">
          📥 JSONL
        </a>
        <a href="/api/v1/benchmark-v32/export/csv" style="background:#1a1a2e;padding:8px 16px;border-radius:8px;font-size:0.9em;text-decoration:none">
          📥 CSV
        </a>
      </div>
    </div>

    <!-- Stats Row -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:24px">
      <div class="stat-box">
        <div class="stat-value">${dimCount}</div>
        <div class="stat-label">Dimensions</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${scores.length}</div>
        <div class="stat-label">Agents Scored</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${trades.length > 0 ? trades.length : "—"}</div>
        <div class="stat-label">Trade Grades</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${rounds.length > 0 ? rounds[0]?.consensusAgreement !== undefined ? (rounds[0].consensusAgreement * 100).toFixed(0) + "%" : "—" : "—"}</div>
        <div class="stat-label">Consensus</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${rounds.length > 0 && rounds[0]?.avgGrounding !== undefined ? rounds[0].avgGrounding.toFixed(0) : "—"}</div>
        <div class="stat-label">Avg Grounding</div>
      </div>
    </div>

    <!-- Leaderboard -->
    <div class="section">
      <h2>🏆 Leaderboard</h2>
      <div style="overflow-x:auto">
        <table>
          <thead>
            <tr>
              <th style="width:50px">#</th>
              <th>Agent</th>
              <th>Tier</th>
              <th>Score</th>
              <th>Coherence</th>
              <th>Halluc-Free</th>
              <th>Grounding</th>
              <th>Consensus</th>
              <th>Trades</th>
            </tr>
          </thead>
          <tbody>
            ${leaderboardRows || '<tr><td colspan="9" style="text-align:center;color:#666;padding:24px">No agents scored yet. Run a trading round to begin benchmarking.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Grid: Brain Feed + New v32 Metrics -->
    <div class="grid">
      <div class="section">
        <h2>🧠 Brain Feed — Live Agent Reasoning</h2>
        <div style="max-height:600px;overflow-y:auto">
          ${brainFeedItems || '<p style="color:#666;padding:16px">No trade reasoning recorded yet.</p>'}
        </div>
      </div>

      <div>
        <!-- v32 New Dimensions -->
        <div class="section" style="margin-bottom:24px">
          <h2>★ New in v${version}</h2>
          <div style="margin-bottom:16px">
            <h3 style="color:#FFD700">Reasoning Grounding</h3>
            <p style="color:#aaa;font-size:0.9em;margin-bottom:8px">
              Measures how well an agent's reasoning is anchored in real market data vs speculation.
              Scores data citation density, price reference accuracy, quantitative vs qualitative ratio,
              temporal grounding, and specificity of claims.
            </p>
            <div style="background:#1a1a2e;border-radius:8px;padding:12px">
              <strong>High score (70+):</strong> Agent references real prices, uses specific data, cites timeframes<br>
              <strong>Low score (&lt;40):</strong> Vague assertions, speculative language, no data backing
            </div>
          </div>
          <div>
            <h3 style="color:#FFD700">Consensus Quality</h3>
            <p style="color:#aaa;font-size:0.9em;margin-bottom:8px">
              Evaluates whether an agent's agreement or disagreement with peers is justified.
              Rewards independent thinking backed by strong reasoning. Penalizes blind herding
              and unjustified contrarian behavior.
            </p>
            <div style="background:#1a1a2e;border-radius:8px;padding:12px">
              <strong>High score (70+):</strong> Independent thinker with justified divergence<br>
              <strong>Low score (&lt;40):</strong> Blind herder or reckless contrarian without reasoning
            </div>
          </div>
        </div>

        <!-- Dimension Reference -->
        <div class="section">
          <h2>📊 All ${dimCount} Dimensions</h2>
          ${dimensionDocsHtml}
        </div>
      </div>
    </div>

    <!-- API Reference -->
    <div class="section">
      <h2>🔌 API Endpoints</h2>
      <table>
        <thead><tr><th>Endpoint</th><th>Description</th></tr></thead>
        <tbody>
          <tr><td><code>/benchmark-v32</code></td><td>This dashboard</td></tr>
          <tr><td><code>/api/v1/benchmark-v32/leaderboard</code></td><td>Ranked agents by composite score (JSON)</td></tr>
          <tr><td><code>/api/v1/benchmark-v32/trade-grades</code></td><td>Individual trade quality assessments</td></tr>
          <tr><td><code>/api/v1/benchmark-v32/dimensions</code></td><td>All 24 dimension definitions and weights</td></tr>
          <tr><td><code>/api/v1/benchmark-v32/grounding/:agentId</code></td><td>Reasoning grounding analysis</td></tr>
          <tr><td><code>/api/v1/benchmark-v32/consensus</code></td><td>Consensus quality analysis</td></tr>
          <tr><td><code>/api/v1/benchmark-v32/export/jsonl</code></td><td>Full dataset export (JSONL)</td></tr>
          <tr><td><code>/api/v1/benchmark-v32/export/csv</code></td><td>Full dataset export (CSV)</td></tr>
          <tr><td><code>/api/v1/benchmark-v32/health</code></td><td>Engine health check</td></tr>
          <tr><td><code>/api/v1/brain-feed</code></td><td>Live agent reasoning stream</td></tr>
          <tr><td><code>/api/v1/trade-with-reasoning</code></td><td>Submit trades with reasoning</td></tr>
        </tbody>
      </table>
    </div>

    <div style="text-align:center;color:#444;padding:24px;font-size:0.85em">
      MoltApp v${version} — ${dimCount}-Dimension AI Trading Benchmark<br>
      <a href="https://huggingface.co/datasets/patruff/molt-benchmark">HuggingFace Dataset</a> •
      <a href="https://www.patgpt.us">www.patgpt.us</a> •
      Colosseum Agent Hackathon 2026
    </div>
  </div>
</body>
</html>`;

  return c.html(pageHtml);
});

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
