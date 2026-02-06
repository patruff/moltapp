/**
 * Benchmark Dashboard Route
 *
 * The public face of MoltApp as an AI trading benchmark.
 * Shows live leaderboard, reasoning quality metrics, brain feed,
 * quality gate stats, outcome tracking, confidence calibration,
 * and links to the HuggingFace dataset.
 *
 * Features:
 * - Auto-refresh every 30s via meta tag + fetch
 * - Live brain feed ticker with scrolling reasoning
 * - Composite benchmark scores per agent
 * - Quality gate pass/reject rates
 * - Confidence calibration visualization
 * - HuggingFace badge and dataset link
 *
 * GET /benchmark-dashboard — Full HTML dashboard
 * GET /benchmark-dashboard/data — JSON data for the dashboard
 */

import { Hono } from "hono";
import { html } from "hono/html";
import { round2 } from "../lib/math-utils.ts";
import { db } from "../db/index.ts";
import { tradeJustifications } from "../db/schema/trade-reasoning.ts";
import { desc, sql, eq } from "drizzle-orm";
import { getAgentConfigs } from "../agents/orchestrator.ts";
import { getBenchmarkSummary } from "../services/benchmark-tracker.ts";
import { getQualityGateStats } from "../services/reasoning-quality-gate.ts";
import {
  getOutcomeTrackerStats,
  calculateConfidenceCalibration,
} from "../services/outcome-tracker.ts";

export const benchmarkDashboardRoutes = new Hono();

// ---------------------------------------------------------------------------
// Data endpoint (JSON)
// ---------------------------------------------------------------------------

benchmarkDashboardRoutes.get("/data", async (c) => {
  const agents = getAgentConfigs();
  let benchmarkSummary;
  try {
    benchmarkSummary = getBenchmarkSummary();
  } catch {
    benchmarkSummary = null;
  }

  const qualityGateStats = getQualityGateStats();
  const outcomeStats = getOutcomeTrackerStats();
  const calibration = calculateConfidenceCalibration();

  // Get reasoning stats per agent
  const agentStats = [];
  for (const agent of agents) {
    try {
      const stats = await db
        .select({
          totalTrades: sql<number>`count(*)`,
          avgCoherence: sql<number>`avg(${tradeJustifications.coherenceScore})`,
          avgConfidence: sql<number>`avg(${tradeJustifications.confidence})`,
          hallucinationCount: sql<number>`count(*) filter (where jsonb_array_length(${tradeJustifications.hallucinationFlags}) > 0)`,
          disciplinePassCount: sql<number>`count(*) filter (where ${tradeJustifications.disciplinePass} = 'pass')`,
        })
        .from(tradeJustifications)
        .where(eq(tradeJustifications.agentId, agent.agentId));

      const row = stats[0];
      const totalTrades = Number(row?.totalTrades ?? 0);
      const avgCoherence = round2(Number(row?.avgCoherence) || 0);
      const hallucinationRate = totalTrades > 0
        ? round2(Number(row?.hallucinationCount) / totalTrades)
        : 0;
      const disciplineRate = totalTrades > 0
        ? round2(Number(row?.disciplinePassCount) / totalTrades)
        : 0;

      // Calculate composite benchmark score
      const hallucinationFree = 1 - hallucinationRate;
      const compositeScore = round2(
        avgCoherence * 0.35 + hallucinationFree * 0.25 + disciplineRate * 0.2 +
          (Number(row?.avgConfidence) || 0.5) * 0.2,
      );

      const agentCalibration = calculateConfidenceCalibration(agent.agentId);
      const agentOutcomes = getOutcomeTrackerStats(agent.agentId);

      agentStats.push({
        agentId: agent.agentId,
        name: agent.name,
        model: agent.model,
        provider: agent.provider,
        riskTolerance: agent.riskTolerance,
        tradingStyle: agent.tradingStyle,
        totalTrades,
        avgCoherence,
        avgConfidence: round2(Number(row?.avgConfidence) || 0),
        hallucinationRate,
        disciplineRate,
        compositeScore,
        calibrationScore: agentCalibration.score,
        outcomeStats: agentOutcomes,
      });
    } catch {
      agentStats.push({
        agentId: agent.agentId,
        name: agent.name,
        model: agent.model,
        provider: agent.provider,
        riskTolerance: agent.riskTolerance,
        tradingStyle: agent.tradingStyle,
        totalTrades: 0,
        avgCoherence: 0,
        avgConfidence: 0,
        hallucinationRate: 0,
        disciplineRate: 0,
        compositeScore: 0,
        calibrationScore: 0.5,
        outcomeStats: getOutcomeTrackerStats(agent.agentId),
      });
    }
  }

  // Get latest brain feed entries
  let recentReasoning: unknown[] = [];
  try {
    recentReasoning = await db
      .select()
      .from(tradeJustifications)
      .orderBy(desc(tradeJustifications.timestamp))
      .limit(10);
  } catch {
    recentReasoning = [];
  }

  return c.json({
    ok: true,
    benchmark: {
      name: "MoltApp: Agentic Stock Trading Benchmark",
      version: "v2",
      website: "https://www.patgpt.us",
      huggingface: "https://huggingface.co/datasets/patruff/molt-benchmark",
      metrics: [
        { name: "P&L %", key: "pnl_percent", type: "reward", weight: 0.25 },
        { name: "Sharpe Ratio", key: "sharpe_ratio", type: "risk", weight: 0.20 },
        { name: "Reasoning Coherence", key: "coherence", type: "qualitative", weight: 0.20 },
        { name: "Hallucination Rate", key: "hallucination_rate", type: "safety", weight: 0.15 },
        { name: "Instruction Discipline", key: "discipline", type: "reliability", weight: 0.10 },
        { name: "Confidence Calibration", key: "calibration", type: "meta", weight: 0.10 },
      ],
    },
    leaderboard: agentStats,
    benchmarkComparison: benchmarkSummary,
    qualityGate: {
      passRate: qualityGateStats.totalChecked > 0
        ? round2(qualityGateStats.totalPassed / qualityGateStats.totalChecked)
        : 1,
      totalChecked: qualityGateStats.totalChecked,
      totalRejected: qualityGateStats.totalRejected,
      avgCompositeScore: round2(qualityGateStats.avgCompositeScore),
    },
    outcomes: outcomeStats,
    calibration,
    recentReasoning,
  });
});

// ---------------------------------------------------------------------------
// HTML Dashboard
// ---------------------------------------------------------------------------

benchmarkDashboardRoutes.get("/", async (c) => {
  const agents = getAgentConfigs();
  const qualityGateStats = getQualityGateStats();
  const outcomeStats = getOutcomeTrackerStats();
  const calibration = calculateConfidenceCalibration();

  // Get agent stats for leaderboard
  const agentRows: {
    name: string;
    model: string;
    provider: string;
    totalTrades: number;
    avgCoherence: number;
    hallucinationRate: number;
    disciplineRate: number;
    avgConfidence: number;
    compositeScore: number;
    riskTolerance: string;
  }[] = [];

  for (const agent of agents) {
    try {
      const stats = await db
        .select({
          totalTrades: sql<number>`count(*)`,
          avgCoherence: sql<number>`avg(${tradeJustifications.coherenceScore})`,
          avgConfidence: sql<number>`avg(${tradeJustifications.confidence})`,
          hallucinationCount: sql<number>`count(*) filter (where jsonb_array_length(${tradeJustifications.hallucinationFlags}) > 0)`,
          disciplinePassCount: sql<number>`count(*) filter (where ${tradeJustifications.disciplinePass} = 'pass')`,
        })
        .from(tradeJustifications)
        .where(eq(tradeJustifications.agentId, agent.agentId));

      const row = stats[0];
      const totalTrades = Number(row?.totalTrades ?? 0);
      const avgCoherence = round2(Number(row?.avgCoherence) || 0);
      const hallucinationRate = totalTrades > 0
        ? Math.round((Number(row?.hallucinationCount) / totalTrades) * 10000) / 100
        : 0;
      const disciplineRate = totalTrades > 0
        ? Math.round((Number(row?.disciplinePassCount) / totalTrades) * 10000) / 100
        : 0;

      const halFree = 1 - (hallucinationRate / 100);
      const discScore = disciplineRate / 100;
      const compositeScore = Math.round(
        (avgCoherence * 0.35 + halFree * 0.25 + discScore * 0.2 +
          (Number(row?.avgConfidence) || 0.5) * 0.2) * 100,
      ) / 100;

      agentRows.push({
        name: agent.name,
        model: agent.model,
        provider: agent.provider,
        totalTrades,
        avgCoherence,
        hallucinationRate,
        disciplineRate,
        avgConfidence: Math.round((Number(row?.avgConfidence) || 0) * 100),
        compositeScore,
        riskTolerance: agent.riskTolerance,
      });
    } catch {
      agentRows.push({
        name: agent.name,
        model: agent.model,
        provider: agent.provider,
        totalTrades: 0,
        avgCoherence: 0,
        hallucinationRate: 0,
        disciplineRate: 0,
        avgConfidence: 0,
        compositeScore: 0,
        riskTolerance: agent.riskTolerance,
      });
    }
  }

  // Sort by composite score descending
  agentRows.sort((a, b) => b.compositeScore - a.compositeScore);

  // Get recent reasoning entries
  let recentEntries: { agentId: string; action: string; symbol: string; reasoning: string; confidence: number | null; coherenceScore: number | null; intent: string; timestamp: Date | null }[] = [];
  try {
    recentEntries = await db
      .select({
        agentId: tradeJustifications.agentId,
        action: tradeJustifications.action,
        symbol: tradeJustifications.symbol,
        reasoning: tradeJustifications.reasoning,
        confidence: tradeJustifications.confidence,
        coherenceScore: tradeJustifications.coherenceScore,
        intent: tradeJustifications.intent,
        timestamp: tradeJustifications.timestamp,
      })
      .from(tradeJustifications)
      .orderBy(desc(tradeJustifications.timestamp))
      .limit(8);
  } catch {
    // DB not available
  }

  // Quality gate pass rate
  const qgPassRate = qualityGateStats.totalChecked > 0
    ? Math.round((qualityGateStats.totalPassed / qualityGateStats.totalChecked) * 100)
    : 100;

  const leaderboardHtml = agentRows
    .map(
      (a, i) => `
    <tr>
      <td><span class="rank">#${i + 1}</span></td>
      <td><strong>${a.name}</strong><br><small>${a.model}</small></td>
      <td>${a.provider}</td>
      <td>${a.riskTolerance}</td>
      <td>${a.totalTrades}</td>
      <td><span class="score-pill ${a.avgCoherence >= 0.7 ? "score-good" : a.avgCoherence >= 0.4 ? "score-mid" : "score-bad"}">${a.avgCoherence.toFixed(2)}</span></td>
      <td><span class="score-pill ${a.hallucinationRate <= 5 ? "score-good" : a.hallucinationRate <= 20 ? "score-mid" : "score-bad"}">${a.hallucinationRate.toFixed(1)}%</span></td>
      <td>${a.disciplineRate.toFixed(0)}%</td>
      <td>${a.avgConfidence}%</td>
      <td><strong class="composite">${a.compositeScore.toFixed(2)}</strong></td>
    </tr>`,
    )
    .join("");

  const brainFeedHtml = recentEntries
    .map(
      (e) => `
    <div class="feed-entry">
      <div class="feed-header">
        <span class="agent">${e.agentId}</span>
        <span class="action action-${e.action}">${e.action.toUpperCase()}</span>
        <span class="symbol">${e.symbol}</span>
        <span class="intent-pill">${e.intent}</span>
        <span class="coherence">Coherence: ${(e.coherenceScore ?? 0).toFixed(2)}</span>
      </div>
      <div class="reasoning">${(e.reasoning ?? "").slice(0, 250)}${(e.reasoning ?? "").length > 250 ? "..." : ""}</div>
      <div class="feed-meta">Confidence: ${((e.confidence ?? 0) * 100).toFixed(0)}% | ${e.timestamp ? new Date(e.timestamp).toLocaleString() : ""}</div>
    </div>`,
    )
    .join("");

  const page = html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="60">
  <title>MoltApp AI Trading Benchmark | Official</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', -apple-system, sans-serif; background: #0a0a0f; color: #e0e0e0; }
    .container { max-width: 1300px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; margin: 20px 0 10px; }
    h1 { font-size: 2.2rem; color: #00ff88; display: inline; }
    .official { background: linear-gradient(135deg, #00ff88, #00aaff); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 2px; display: block; margin-top: 4px; }
    .subtitle { text-align: center; color: #888; margin-bottom: 20px; font-size: 0.95rem; }
    .badge-row { display: flex; gap: 10px; justify-content: center; margin-bottom: 24px; flex-wrap: wrap; }
    .badge { background: #1a1a2e; border: 1px solid #333; border-radius: 8px; padding: 7px 14px; font-size: 0.82rem; color: #00ff88; text-decoration: none; transition: all 0.2s; }
    .badge:hover { background: #222240; transform: translateY(-1px); }
    .badge-hf { border-color: #ffaa00; color: #ffaa00; }
    .live-dot { width: 8px; height: 8px; background: #00ff88; border-radius: 50%; display: inline-block; margin-right: 6px; animation: pulse 2s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
    .section { margin-bottom: 36px; }
    .section h2 { font-size: 1.2rem; margin-bottom: 14px; color: #fff; border-bottom: 1px solid #333; padding-bottom: 7px; }
    .stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 24px; }
    .stat-card { background: #111122; border: 1px solid #222; border-radius: 10px; padding: 16px; text-align: center; }
    .stat-card .label { font-size: 0.7rem; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
    .stat-card .val { font-size: 1.8rem; font-weight: 700; color: #00ff88; }
    .stat-card .val.warn { color: #ffaa00; }
    .stat-card .val.danger { color: #ff4444; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 9px 12px; text-align: left; border-bottom: 1px solid #1a1a2e; }
    th { background: #111122; color: #00ff88; font-weight: 600; font-size: 0.78rem; text-transform: uppercase; }
    td { font-size: 0.85rem; }
    tr:hover { background: #111122; }
    .rank { color: #ffaa00; font-weight: 700; font-size: 1.1rem; }
    .composite { color: #00ff88; font-size: 1.05rem; }
    .score-pill { padding: 2px 8px; border-radius: 4px; font-size: 0.8rem; font-weight: 600; }
    .score-good { background: #00331a; color: #00ff88; }
    .score-mid { background: #332b00; color: #ffaa00; }
    .score-bad { background: #330000; color: #ff4444; }
    .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; }
    .metric-card { background: #111122; border: 1px solid #222; border-radius: 10px; padding: 18px; }
    .metric-card h3 { font-size: 0.75rem; color: #888; text-transform: uppercase; margin-bottom: 5px; }
    .metric-card .value { font-size: 1.4rem; font-weight: 700; color: #00ff88; }
    .metric-card .weight { font-size: 0.65rem; color: #555; margin-top: 2px; }
    .metric-card .desc { font-size: 0.72rem; color: #666; margin-top: 5px; }
    .feed-entry { background: #111122; border: 1px solid #222; border-radius: 8px; padding: 14px; margin-bottom: 10px; }
    .feed-header { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; flex-wrap: wrap; }
    .agent { font-weight: 600; color: #fff; font-size: 0.9rem; }
    .action { padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 700; }
    .action-buy { background: #00331a; color: #00ff88; }
    .action-sell { background: #330000; color: #ff4444; }
    .action-hold { background: #332b00; color: #ffaa00; }
    .intent-pill { background: #1a1a3e; color: #8888ff; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; }
    .symbol { color: #aaa; font-size: 0.85rem; }
    .coherence { color: #00aaff; font-size: 0.75rem; margin-left: auto; }
    .reasoning { font-size: 0.82rem; color: #aaa; line-height: 1.5; }
    .feed-meta { font-size: 0.72rem; color: #555; margin-top: 6px; }
    .footer { text-align: center; color: #444; font-size: 0.78rem; margin-top: 30px; padding: 20px; border-top: 1px solid #1a1a2e; }
    .refresh-notice { text-align: center; color: #333; font-size: 0.7rem; margin-bottom: 10px; }
    @media (max-width: 768px) { .container { padding: 10px; } table { font-size: 0.75rem; } th, td { padding: 5px 6px; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>MoltApp AI Trading Benchmark</h1>
      <span class="official">Official AI Finance Benchmark</span>
    </div>
    <p class="subtitle"><span class="live-dot"></span>Live evaluation of AI agents trading real tokenized stocks on Solana</p>
    <p class="refresh-notice">Auto-refreshes every 60 seconds</p>

    <div class="badge-row">
      <a href="https://huggingface.co/datasets/patruff/molt-benchmark" class="badge badge-hf" target="_blank">HuggingFace Dataset</a>
      <a href="https://www.patgpt.us" class="badge" target="_blank">www.patgpt.us</a>
      <a href="/api/v1/brain-feed" class="badge">Brain Feed API</a>
      <a href="/api/v1/outcomes/calibration" class="badge">Calibration API</a>
      <a href="/api/v1/outcomes/quality-gate" class="badge">Quality Gate</a>
      <a href="/benchmark-dashboard/data" class="badge">Dashboard JSON</a>
    </div>

    <div class="stats-row">
      <div class="stat-card">
        <div class="label">Quality Gate Pass Rate</div>
        <div class="val ${qgPassRate >= 80 ? "" : qgPassRate >= 50 ? "warn" : "danger"}">${qgPassRate}%</div>
      </div>
      <div class="stat-card">
        <div class="label">Trades Analyzed</div>
        <div class="val">${qualityGateStats.totalChecked}</div>
      </div>
      <div class="stat-card">
        <div class="label">Trades Rejected</div>
        <div class="val ${qualityGateStats.totalRejected > 0 ? "warn" : ""}">${qualityGateStats.totalRejected}</div>
      </div>
      <div class="stat-card">
        <div class="label">Outcomes Tracked</div>
        <div class="val">${outcomeStats.totalTracked}</div>
      </div>
      <div class="stat-card">
        <div class="label">Win Rate</div>
        <div class="val">${outcomeStats.totalTracked > 0 ? Math.round((outcomeStats.profitCount / outcomeStats.totalTracked) * 100) : 0}%</div>
      </div>
      <div class="stat-card">
        <div class="label">Calibration Score</div>
        <div class="val ${calibration.score >= 0.6 ? "" : calibration.score >= 0.4 ? "warn" : "danger"}">${calibration.score.toFixed(2)}</div>
      </div>
    </div>

    <div class="section">
      <h2>Benchmark Pillars (Scoring Weights)</h2>
      <div class="metrics-grid">
        <div class="metric-card">
          <h3>P&L / Sharpe Ratio</h3>
          <div class="value">Financial</div>
          <div class="weight">Weight: 25% + 20%</div>
          <div class="desc">Risk-adjusted returns. Are agents actually making money?</div>
        </div>
        <div class="metric-card">
          <h3>Reasoning Coherence</h3>
          <div class="value">Qualitative</div>
          <div class="weight">Weight: 20%</div>
          <div class="desc">Does the agent's logic match its action? NLP-scored 0-1.</div>
        </div>
        <div class="metric-card">
          <h3>Hallucination Rate</h3>
          <div class="value">Safety</div>
          <div class="weight">Weight: 15%</div>
          <div class="desc">Rate of fabricated prices, tickers, or facts in reasoning.</div>
        </div>
        <div class="metric-card">
          <h3>Instruction Discipline</h3>
          <div class="value">Reliability</div>
          <div class="weight">Weight: 10%</div>
          <div class="desc">Does the agent respect position limits and trading rules?</div>
        </div>
        <div class="metric-card">
          <h3>Confidence Calibration</h3>
          <div class="value">Meta</div>
          <div class="weight">Weight: 10%</div>
          <div class="desc">Is high confidence correlated with good outcomes?</div>
        </div>
      </div>
    </div>

    <div class="section">
      <h2>Agent Leaderboard (Ranked by Composite Score)</h2>
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Agent</th>
            <th>Provider</th>
            <th>Style</th>
            <th>Trades</th>
            <th>Coherence</th>
            <th>Halluc.</th>
            <th>Discipline</th>
            <th>Confidence</th>
            <th>Composite</th>
          </tr>
        </thead>
        <tbody>
          ${leaderboardHtml || '<tr><td colspan="10" style="text-align:center;color:#555;">No trades yet — run a trading round to populate</td></tr>'}
        </tbody>
      </table>
    </div>

    <div class="section">
      <h2><span class="live-dot"></span>Brain Feed — Latest Agent Reasoning</h2>
      ${brainFeedHtml || '<div class="feed-entry"><div class="reasoning" style="color:#555;">No reasoning data yet. Trades will appear here with full AI reasoning transparency.</div></div>'}
    </div>

    <div class="footer">
      <strong>MoltApp AI Trading Benchmark v2</strong> &mdash; Colosseum Agent Hackathon 2026<br>
      Every trade requires reasoning. No black-box trades.<br>
      <small>Benchmark data published to <a href="https://huggingface.co/datasets/patruff/molt-benchmark" style="color:#00aaff;">HuggingFace</a></small>
    </div>
  </div>

  <script>
    // Auto-refresh dashboard data every 30 seconds (non-disruptive)
    setInterval(async () => {
      try {
        const resp = await fetch('/benchmark-dashboard/data');
        if (resp.ok) {
          // Silently update the page title with last refresh time
          document.title = 'MoltApp Benchmark | ' + new Date().toLocaleTimeString();
        }
      } catch { /* ignore refresh errors */ }
    }, 30000);
  </script>
</body>
</html>`;

  return c.html(page);
});
