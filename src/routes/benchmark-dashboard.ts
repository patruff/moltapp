/**
 * Benchmark Dashboard Route
 *
 * The public face of MoltApp as an AI trading benchmark.
 * Shows live leaderboard, reasoning quality metrics, brain feed,
 * and links to the HuggingFace dataset.
 *
 * GET /benchmark-dashboard — Full HTML dashboard
 * GET /benchmark-dashboard/data — JSON data for the dashboard
 */

import { Hono } from "hono";
import { html } from "hono/html";
import { db } from "../db/index.ts";
import { tradeJustifications } from "../db/schema/trade-reasoning.ts";
import { desc, sql, eq } from "drizzle-orm";
import { getAgentConfigs } from "../agents/orchestrator.ts";
import { getBenchmarkSummary } from "../services/benchmark-tracker.ts";

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
        })
        .from(tradeJustifications)
        .where(eq(tradeJustifications.agentId, agent.agentId));

      const row = stats[0];
      agentStats.push({
        agentId: agent.agentId,
        name: agent.name,
        model: agent.model,
        provider: agent.provider,
        riskTolerance: agent.riskTolerance,
        tradingStyle: agent.tradingStyle,
        totalTrades: Number(row?.totalTrades ?? 0),
        avgCoherence: Math.round((Number(row?.avgCoherence) || 0) * 100) / 100,
        avgConfidence: Math.round((Number(row?.avgConfidence) || 0) * 100) / 100,
        hallucinationRate:
          Number(row?.totalTrades) > 0
            ? Math.round((Number(row?.hallucinationCount) / Number(row?.totalTrades)) * 100) / 100
            : 0,
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
      version: "v1",
      website: "https://www.patgpt.us",
      huggingface: "https://huggingface.co/datasets/patruff/molt-benchmark",
      metrics: [
        { name: "P&L %", key: "pnl_percent", type: "reward" },
        { name: "Sharpe Ratio", key: "sharpe_ratio", type: "risk" },
        { name: "Reasoning Coherence", key: "coherence", type: "qualitative" },
        { name: "Hallucination Rate", key: "hallucination_rate", type: "safety" },
        { name: "Instruction Discipline", key: "discipline", type: "reliability" },
      ],
    },
    leaderboard: agentStats,
    benchmarkComparison: benchmarkSummary,
    recentReasoning,
  });
});

// ---------------------------------------------------------------------------
// HTML Dashboard
// ---------------------------------------------------------------------------

benchmarkDashboardRoutes.get("/", async (c) => {
  const agents = getAgentConfigs();

  // Get agent stats for leaderboard
  const agentRows: {
    name: string;
    model: string;
    provider: string;
    totalTrades: number;
    avgCoherence: number;
    hallucinationRate: number;
    avgConfidence: number;
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
        })
        .from(tradeJustifications)
        .where(eq(tradeJustifications.agentId, agent.agentId));

      const row = stats[0];
      agentRows.push({
        name: agent.name,
        model: agent.model,
        provider: agent.provider,
        totalTrades: Number(row?.totalTrades ?? 0),
        avgCoherence: Math.round((Number(row?.avgCoherence) || 0) * 100) / 100,
        hallucinationRate:
          Number(row?.totalTrades) > 0
            ? Math.round((Number(row?.hallucinationCount) / Number(row?.totalTrades)) * 10000) / 100
            : 0,
        avgConfidence: Math.round((Number(row?.avgConfidence) || 0) * 100),
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
        avgConfidence: 0,
        riskTolerance: agent.riskTolerance,
      });
    }
  }

  // Get recent reasoning entries
  let recentEntries: { agentId: string; action: string; symbol: string; reasoning: string; confidence: number | null; coherenceScore: number | null; timestamp: Date | null }[] = [];
  try {
    recentEntries = await db
      .select({
        agentId: tradeJustifications.agentId,
        action: tradeJustifications.action,
        symbol: tradeJustifications.symbol,
        reasoning: tradeJustifications.reasoning,
        confidence: tradeJustifications.confidence,
        coherenceScore: tradeJustifications.coherenceScore,
        timestamp: tradeJustifications.timestamp,
      })
      .from(tradeJustifications)
      .orderBy(desc(tradeJustifications.timestamp))
      .limit(5);
  } catch {
    // DB not available, show empty
  }

  const leaderboardHtml = agentRows
    .map(
      (a) => `
    <tr>
      <td><strong>${a.name}</strong><br><small>${a.model}</small></td>
      <td>${a.provider}</td>
      <td>${a.riskTolerance}</td>
      <td>${a.totalTrades}</td>
      <td>${a.avgCoherence.toFixed(2)}</td>
      <td>${a.hallucinationRate.toFixed(1)}%</td>
      <td>${a.avgConfidence}%</td>
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
        <span class="coherence">Coherence: ${(e.coherenceScore ?? 0).toFixed(2)}</span>
      </div>
      <div class="reasoning">${(e.reasoning ?? "").slice(0, 200)}${(e.reasoning ?? "").length > 200 ? "..." : ""}</div>
      <div class="feed-meta">Confidence: ${((e.confidence ?? 0) * 100).toFixed(0)}% | ${e.timestamp ? new Date(e.timestamp).toLocaleString() : ""}</div>
    </div>`,
    )
    .join("");

  const page = html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MoltApp AI Trading Benchmark</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', -apple-system, sans-serif; background: #0a0a0f; color: #e0e0e0; }
    .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
    h1 { font-size: 2rem; text-align: center; margin: 30px 0 10px; color: #00ff88; }
    .subtitle { text-align: center; color: #888; margin-bottom: 30px; font-size: 0.95rem; }
    .badge-row { display: flex; gap: 12px; justify-content: center; margin-bottom: 30px; flex-wrap: wrap; }
    .badge { background: #1a1a2e; border: 1px solid #333; border-radius: 8px; padding: 8px 16px; font-size: 0.85rem; color: #00ff88; text-decoration: none; }
    .badge:hover { background: #222240; }
    .section { margin-bottom: 40px; }
    .section h2 { font-size: 1.3rem; margin-bottom: 15px; color: #fff; border-bottom: 1px solid #333; padding-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px 14px; text-align: left; border-bottom: 1px solid #1a1a2e; }
    th { background: #111122; color: #00ff88; font-weight: 600; font-size: 0.85rem; text-transform: uppercase; }
    td { font-size: 0.9rem; }
    tr:hover { background: #111122; }
    .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
    .metric-card { background: #111122; border: 1px solid #222; border-radius: 10px; padding: 20px; }
    .metric-card h3 { font-size: 0.8rem; color: #888; text-transform: uppercase; margin-bottom: 6px; }
    .metric-card .value { font-size: 1.6rem; font-weight: 700; color: #00ff88; }
    .metric-card .desc { font-size: 0.75rem; color: #666; margin-top: 6px; }
    .feed-entry { background: #111122; border: 1px solid #222; border-radius: 8px; padding: 16px; margin-bottom: 12px; }
    .feed-header { display: flex; gap: 10px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
    .agent { font-weight: 600; color: #fff; }
    .action { padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 700; }
    .action-buy { background: #00331a; color: #00ff88; }
    .action-sell { background: #330000; color: #ff4444; }
    .action-hold { background: #332b00; color: #ffaa00; }
    .symbol { color: #aaa; }
    .coherence { color: #00aaff; font-size: 0.8rem; }
    .reasoning { font-size: 0.85rem; color: #aaa; line-height: 1.5; }
    .feed-meta { font-size: 0.75rem; color: #555; margin-top: 8px; }
    .footer { text-align: center; color: #444; font-size: 0.8rem; margin-top: 40px; padding: 20px; }
    @media (max-width: 768px) { .container { padding: 10px; } table { font-size: 0.8rem; } th, td { padding: 6px 8px; } }
  </style>
</head>
<body>
  <div class="container">
    <h1>MoltApp AI Trading Benchmark</h1>
    <p class="subtitle">Live evaluation of AI agents trading real tokenized stocks on Solana</p>

    <div class="badge-row">
      <a href="https://huggingface.co/datasets/patruff/molt-benchmark" class="badge" target="_blank">HuggingFace Dataset</a>
      <a href="https://www.patgpt.us" class="badge" target="_blank">www.patgpt.us</a>
      <a href="/api/v1/brain-feed" class="badge">Brain Feed API</a>
      <a href="/api/v1/benchmark" class="badge">Benchmark API</a>
    </div>

    <div class="section">
      <h2>Benchmark Pillars</h2>
      <div class="metrics-grid">
        <div class="metric-card">
          <h3>P&L / Sharpe</h3>
          <div class="value">Financial</div>
          <div class="desc">Risk-adjusted returns. Are agents actually making money?</div>
        </div>
        <div class="metric-card">
          <h3>Reasoning Coherence</h3>
          <div class="value">Qualitative</div>
          <div class="desc">Does the agent's logic match its action? Scored 0-1.</div>
        </div>
        <div class="metric-card">
          <h3>Hallucination Rate</h3>
          <div class="value">Safety</div>
          <div class="desc">Rate of fabricated prices, tickers, or facts in reasoning.</div>
        </div>
        <div class="metric-card">
          <h3>Instruction Discipline</h3>
          <div class="value">Reliability</div>
          <div class="desc">Does the agent respect position limits and trading rules?</div>
        </div>
        <div class="metric-card">
          <h3>Confidence Calibration</h3>
          <div class="value">Meta</div>
          <div class="desc">Is high confidence correlated with good outcomes?</div>
        </div>
      </div>
    </div>

    <div class="section">
      <h2>Agent Leaderboard</h2>
      <table>
        <thead>
          <tr>
            <th>Agent</th>
            <th>Provider</th>
            <th>Risk Style</th>
            <th>Trades</th>
            <th>Coherence</th>
            <th>Hallucination</th>
            <th>Avg Confidence</th>
          </tr>
        </thead>
        <tbody>
          ${leaderboardHtml || '<tr><td colspan="7" style="text-align:center;color:#555;">No trades yet</td></tr>'}
        </tbody>
      </table>
    </div>

    <div class="section">
      <h2>Brain Feed — Latest Agent Reasoning</h2>
      ${brainFeedHtml || '<div class="feed-entry"><div class="reasoning" style="color:#555;">No reasoning data yet. Trades will appear here with full AI reasoning transparency.</div></div>'}
    </div>

    <div class="footer">
      MoltApp AI Trading Benchmark &copy; 2026 | Colosseum Agent Hackathon<br>
      Every trade requires reasoning. No black-box trades.
    </div>
  </div>
</body>
</html>`;

  return c.html(page);
});
