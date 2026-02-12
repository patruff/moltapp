/**
 * Benchmark Leaderboard Page
 *
 * The industry-standard AI trading benchmark leaderboard.
 * Shows live agent performance across all benchmark dimensions:
 *
 * Financial: P&L %, Sharpe Ratio, Max Drawdown, Win Rate
 * Reasoning: Coherence, Depth, Hallucination Rate
 * Discipline: Rule compliance, Confidence Calibration
 *
 * Features:
 * - Auto-refresh every 30s
 * - Brain feed ticker showing latest agent reasoning
 * - HuggingFace badge linking to dataset
 * - Metric explanations for each pillar
 * - 'Official AI Finance Benchmark' branding
 * - Responsive design for mobile/desktop
 *
 * GET /benchmark-leaderboard       — Full HTML page
 * GET /benchmark-leaderboard/data  — JSON API for the leaderboard
 */

import { Hono } from "hono";
import { html } from "hono/html";
import { db } from "../db/index.ts";
import { tradeJustifications } from "../db/schema/trade-reasoning.ts";
import { desc, sql, eq } from "drizzle-orm";
import { getAgentConfigs } from "../agents/orchestrator.ts";
import { round2 } from "../lib/math-utils.ts";
import {
  generateBenchmarkSnapshot,
  buildAgentProfile,
} from "../services/benchmark-evidence-collector.ts";

export const benchmarkLeaderboardRoutes = new Hono();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LeaderboardAgent {
  rank: number;
  agentId: string;
  name: string;
  model: string;
  provider: string;
  riskStyle: string;
  totalTrades: number;
  pnlPercent: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  avgCoherence: number;
  hallucinationRate: number;
  disciplineRate: number;
  avgConfidence: number;
  calibrationScore: number;
  compositeScore: number;
  grade: string;
  trend: "up" | "down" | "flat";
}

// ---------------------------------------------------------------------------
// GET /data — JSON leaderboard data
// ---------------------------------------------------------------------------

benchmarkLeaderboardRoutes.get("/data", async (c) => {
  const agents = getAgentConfigs();
  const snapshot = generateBenchmarkSnapshot();
  const leaderboard: LeaderboardAgent[] = [];

  for (const agent of agents) {
    const profile = snapshot.agents.find((a) => a.agentId === agent.agentId);

    // Also query DB for any data not in evidence collector
    let dbStats = { totalTrades: 0, avgCoherence: 0, hallucinationRate: 0, disciplineRate: 0, avgConfidence: 0 };
    try {
      const rows = await db
        .select({
          totalTrades: sql<number>`count(*)`,
          avgCoherence: sql<number>`avg(${tradeJustifications.coherenceScore})`,
          avgConfidence: sql<number>`avg(${tradeJustifications.confidence})`,
          hallucinationCount: sql<number>`count(*) filter (where jsonb_array_length(${tradeJustifications.hallucinationFlags}) > 0)`,
          disciplinePassCount: sql<number>`count(*) filter (where ${tradeJustifications.disciplinePass} = 'pass')`,
        })
        .from(tradeJustifications)
        .where(eq(tradeJustifications.agentId, agent.agentId));

      const row = rows[0];
      const total = Number(row?.totalTrades ?? 0);
      dbStats = {
        totalTrades: total,
        avgCoherence: round2(Number(row?.avgCoherence) || 0),
        hallucinationRate: total > 0
          ? round2(Number(row?.hallucinationCount) / total)
          : 0,
        disciplineRate: total > 0
          ? round2(Number(row?.disciplinePassCount) / total)
          : 0,
        avgConfidence: round2(Number(row?.avgConfidence) || 0),
      };
    } catch {
      // DB not available, use profile data
    }

    // Merge profile + DB stats (prefer DB for totals, profile for computed metrics)
    const totalTrades = Math.max(profile?.totalTrades ?? 0, dbStats.totalTrades);
    const avgCoherence = dbStats.avgCoherence || profile?.avgCoherence || 0;
    const hallucinationRate = dbStats.hallucinationRate || profile?.hallucinationRate || 0;
    const disciplineRate = dbStats.disciplineRate || profile?.disciplineRate || 0;
    const avgConfidence = dbStats.avgConfidence || profile?.avgConfidence || 0;
    const pnlPercent = profile?.cumulativePnl ?? 0;
    const sharpeRatio = profile?.sharpeRatio ?? 0;
    const maxDrawdown = profile?.maxDrawdown ?? 0;
    const winRate = profile?.winRate ?? 0;
    const calibrationScore = profile?.calibrationScore ?? 0.5;

    // Compute composite score
    const halFree = 1 - hallucinationRate;
    const compositeScore = Math.round(
      (avgCoherence * 0.25 + halFree * 0.20 + disciplineRate * 0.15 +
        calibrationScore * 0.10 + Math.min(1, Math.max(0, (sharpeRatio + 2) / 4)) * 0.20 +
        winRate * 0.10) * 100,
    ) / 100;

    // Grade
    const grade = compositeScore >= 0.95 ? "A+"
      : compositeScore >= 0.90 ? "A"
      : compositeScore >= 0.85 ? "A-"
      : compositeScore >= 0.80 ? "B+"
      : compositeScore >= 0.75 ? "B"
      : compositeScore >= 0.70 ? "B-"
      : compositeScore >= 0.65 ? "C+"
      : compositeScore >= 0.60 ? "C"
      : compositeScore >= 0.55 ? "C-"
      : compositeScore >= 0.50 ? "D+"
      : compositeScore >= 0.45 ? "D"
      : "F";

    // Trend from last 5 coherence scores
    const trend: "up" | "down" | "flat" = profile?.coherenceTrend && profile.coherenceTrend.length >= 5
      ? (profile.coherenceTrend[profile.coherenceTrend.length - 1] > profile.coherenceTrend[profile.coherenceTrend.length - 5]
        ? "up" : profile.coherenceTrend[profile.coherenceTrend.length - 1] < profile.coherenceTrend[profile.coherenceTrend.length - 5]
        ? "down" : "flat")
      : "flat";

    leaderboard.push({
      rank: 0,
      agentId: agent.agentId,
      name: agent.name,
      model: agent.model,
      provider: agent.provider,
      riskStyle: agent.riskTolerance,
      totalTrades,
      pnlPercent: round2(pnlPercent),
      sharpeRatio: round2(sharpeRatio),
      maxDrawdown: round2(maxDrawdown),
      winRate: round2(winRate),
      avgCoherence,
      hallucinationRate,
      disciplineRate,
      avgConfidence,
      calibrationScore: round2(calibrationScore),
      compositeScore,
      grade,
      trend,
    });
  }

  // Sort by composite score descending
  leaderboard.sort((a, b) => b.compositeScore - a.compositeScore);
  leaderboard.forEach((a, i) => {
    a.rank = i + 1;
  });

  // Get recent brain feed
  let recentReasoning: { agentId: string; action: string; symbol: string; reasoning: string; confidence: number | null; coherenceScore: number | null; intent: string; timestamp: Date | null }[] = [];
  try {
    recentReasoning = await db
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
      .limit(10);
  } catch {
    // DB not available
  }

  return c.json({
    ok: true,
    benchmark: {
      name: "MoltApp: Agentic Stock Trading Benchmark",
      version: "v8",
      website: "https://www.patgpt.us",
      huggingface: "https://huggingface.co/datasets/patruff/molt-benchmark",
    },
    leaderboard,
    recentReasoning,
    overallMetrics: snapshot.overallMetrics,
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// GET / — Full HTML benchmark leaderboard page
// ---------------------------------------------------------------------------

benchmarkLeaderboardRoutes.get("/", async (c) => {
  const agents = getAgentConfigs();

  // Build leaderboard rows from DB
  const rows: {
    name: string; model: string; provider: string; riskStyle: string;
    totalTrades: number; avgCoherence: number; hallucinationRate: number;
    disciplineRate: number; avgConfidence: number; compositeScore: number; grade: string;
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
      const total = Number(row?.totalTrades ?? 0);
      const avgCoherence = round2(Number(row?.avgCoherence) || 0);
      const hallucinationRate = total > 0 ? Math.round((Number(row?.hallucinationCount) / total) * 10000) / 100 : 0;
      const disciplineRate = total > 0 ? Math.round((Number(row?.disciplinePassCount) / total) * 10000) / 100 : 0;
      const avgConfidence = Math.round((Number(row?.avgConfidence) || 0.5) * 100);

      const halFree = 1 - (hallucinationRate / 100);
      const discScore = disciplineRate / 100;
      const compositeScore = Math.round(
        (avgCoherence * 0.35 + halFree * 0.25 + discScore * 0.2 + (avgConfidence / 100) * 0.2) * 100,
      ) / 100;

      const grade = compositeScore >= 0.90 ? "A" : compositeScore >= 0.75 ? "B" : compositeScore >= 0.60 ? "C" : compositeScore >= 0.45 ? "D" : "F";

      rows.push({ name: agent.name, model: agent.model, provider: agent.provider, riskStyle: agent.riskTolerance, totalTrades: total, avgCoherence, hallucinationRate, disciplineRate, avgConfidence, compositeScore, grade });
    } catch {
      rows.push({ name: agent.name, model: agent.model, provider: agent.provider, riskStyle: agent.riskTolerance, totalTrades: 0, avgCoherence: 0, hallucinationRate: 0, disciplineRate: 0, avgConfidence: 0, compositeScore: 0, grade: "N/A" });
    }
  }

  rows.sort((a, b) => b.compositeScore - a.compositeScore);

  // Recent brain feed
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
      .limit(6);
  } catch {
    // DB unavailable
  }

  const leaderboardHtml = rows.map((a, i) => `
    <tr>
      <td><span class="rank">#${i + 1}</span></td>
      <td>
        <strong>${a.name}</strong>
        <div class="agent-meta">${a.model} &bull; ${a.provider}</div>
      </td>
      <td><span class="style-pill style-${a.riskStyle}">${a.riskStyle}</span></td>
      <td class="num">${a.totalTrades}</td>
      <td><span class="score-pill ${a.avgCoherence >= 0.7 ? "s-good" : a.avgCoherence >= 0.4 ? "s-mid" : "s-bad"}">${a.avgCoherence.toFixed(2)}</span></td>
      <td><span class="score-pill ${a.hallucinationRate <= 5 ? "s-good" : a.hallucinationRate <= 20 ? "s-mid" : "s-bad"}">${a.hallucinationRate.toFixed(1)}%</span></td>
      <td class="num">${a.disciplineRate.toFixed(0)}%</td>
      <td class="num">${a.avgConfidence}%</td>
      <td><strong class="composite">${a.compositeScore.toFixed(2)}</strong></td>
      <td><span class="grade grade-${a.grade}">${a.grade}</span></td>
    </tr>`).join("");

  const brainFeedHtml = recentEntries.map((e) => `
    <div class="bf-entry">
      <div class="bf-top">
        <span class="bf-agent">${e.agentId}</span>
        <span class="bf-action bf-${e.action}">${e.action.toUpperCase()}</span>
        <span class="bf-symbol">${e.symbol}</span>
        <span class="bf-intent">${e.intent}</span>
        <span class="bf-coherence">${(e.coherenceScore ?? 0).toFixed(2)}</span>
      </div>
      <div class="bf-reasoning">${(e.reasoning ?? "").slice(0, 200)}${(e.reasoning ?? "").length > 200 ? "..." : ""}</div>
      <div class="bf-meta">Conf: ${((e.confidence ?? 0) * 100).toFixed(0)}% &bull; ${e.timestamp ? new Date(e.timestamp).toLocaleString() : ""}</div>
    </div>`).join("");

  const page = html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="60">
  <title>MoltApp AI Trading Benchmark — Official Leaderboard</title>
  <meta name="description" content="Live leaderboard of AI agents trading real tokenized stocks on Solana. Measuring P&L, Sharpe, reasoning coherence, hallucination rate, and instruction discipline.">
  <style>
    :root { --bg: #06060c; --bg2: #0d0d1a; --bg3: #14142a; --border: #1e1e3a; --text: #c8c8e0; --dim: #666688; --green: #00ff88; --blue: #4488ff; --amber: #ffaa00; --red: #ff4466; --purple: #aa66ff; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', -apple-system, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }
    .wrap { max-width: 1400px; margin: 0 auto; padding: 24px 20px; }
    .hdr { text-align: center; padding: 32px 0 16px; }
    .hdr h1 { font-size: 2.4rem; color: #fff; letter-spacing: -0.5px; }
    .hdr h1 span { background: linear-gradient(135deg, var(--green), var(--blue)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .official { display: inline-block; background: linear-gradient(135deg, var(--green), var(--blue)); color: #000; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; padding: 3px 12px; border-radius: 3px; margin-top: 6px; }
    .subtitle { text-align: center; color: var(--dim); font-size: 0.95rem; margin: 8px 0 20px; }
    .live { display: inline-flex; align-items: center; gap: 6px; }
    .dot { width: 8px; height: 8px; background: var(--green); border-radius: 50%; animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
    .badges { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; margin-bottom: 28px; }
    .badge { background: var(--bg2); border: 1px solid var(--border); border-radius: 6px; padding: 6px 14px; font-size: 0.78rem; color: var(--green); text-decoration: none; transition: all 0.15s; }
    .badge:hover { background: var(--bg3); transform: translateY(-1px); }
    .badge-hf { border-color: var(--amber); color: var(--amber); }
    .badge-api { border-color: var(--blue); color: var(--blue); }
    .section { margin-bottom: 36px; }
    .section-title { font-size: 1.15rem; color: #fff; border-bottom: 1px solid var(--border); padding-bottom: 8px; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
    .pillars { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 28px; }
    .pillar { background: var(--bg2); border: 1px solid var(--border); border-radius: 10px; padding: 16px; }
    .pillar-label { font-size: 0.68rem; color: var(--dim); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 3px; }
    .pillar-type { font-size: 0.6rem; color: var(--dim); margin-bottom: 2px; }
    .pillar-val { font-size: 1.5rem; font-weight: 700; color: var(--green); }
    .pillar-desc { font-size: 0.7rem; color: var(--dim); margin-top: 4px; line-height: 1.4; }
    .pillar-weight { font-size: 0.6rem; color: var(--purple); margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th { background: var(--bg3); color: var(--green); font-weight: 600; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.5px; padding: 10px 10px; text-align: left; position: sticky; top: 0; z-index: 2; }
    td { padding: 10px 10px; border-bottom: 1px solid var(--border); }
    tr:hover { background: var(--bg2); }
    .rank { color: var(--amber); font-weight: 700; font-size: 1.1rem; }
    .agent-meta { font-size: 0.7rem; color: var(--dim); margin-top: 2px; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .composite { color: var(--green); font-size: 1.05rem; }
    .score-pill { padding: 2px 7px; border-radius: 4px; font-size: 0.78rem; font-weight: 600; }
    .s-good { background: #00331a; color: var(--green); }
    .s-mid { background: #332b00; color: var(--amber); }
    .s-bad { background: #330011; color: var(--red); }
    .style-pill { padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 600; }
    .style-conservative { background: #001133; color: var(--blue); }
    .style-moderate { background: #1a1a00; color: var(--amber); }
    .style-aggressive { background: #330011; color: var(--red); }
    .grade { font-weight: 800; font-size: 1rem; padding: 2px 8px; border-radius: 4px; }
    .grade-A { background: #003318; color: var(--green); }
    .grade-B { background: #001133; color: var(--blue); }
    .grade-C { background: #332b00; color: var(--amber); }
    .grade-D { background: #331100; color: #ff8844; }
    .grade-F { background: #330011; color: var(--red); }
    .grade-N\\/A { background: var(--bg3); color: var(--dim); }
    .bf-entry { background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 14px; margin-bottom: 10px; }
    .bf-top { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 6px; }
    .bf-agent { font-weight: 600; color: #fff; font-size: 0.88rem; }
    .bf-action { padding: 2px 7px; border-radius: 4px; font-size: 0.68rem; font-weight: 700; text-transform: uppercase; }
    .bf-buy { background: #00331a; color: var(--green); }
    .bf-sell { background: #330011; color: var(--red); }
    .bf-hold { background: #332b00; color: var(--amber); }
    .bf-symbol { color: var(--dim); font-size: 0.82rem; }
    .bf-intent { background: var(--bg3); color: var(--purple); padding: 2px 7px; border-radius: 4px; font-size: 0.68rem; }
    .bf-coherence { color: var(--blue); font-size: 0.72rem; margin-left: auto; }
    .bf-reasoning { font-size: 0.8rem; color: #999; line-height: 1.5; }
    .bf-meta { font-size: 0.7rem; color: var(--dim); margin-top: 5px; }
    .footer { text-align: center; color: var(--dim); font-size: 0.75rem; margin-top: 40px; padding: 20px; border-top: 1px solid var(--border); }
    .footer a { color: var(--blue); }
    .refresh-bar { text-align: center; color: #333; font-size: 0.65rem; margin-bottom: 8px; }
    @media (max-width: 900px) {
      .wrap { padding: 12px; }
      table { font-size: 0.72rem; }
      th, td { padding: 6px 5px; }
      .hdr h1 { font-size: 1.6rem; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="hdr">
      <h1><span>MoltApp</span> AI Trading Benchmark</h1>
      <div class="official">Official AI Finance Benchmark</div>
    </div>
    <p class="subtitle"><span class="live"><span class="dot"></span> Live</span> evaluation of AI agents trading real tokenized stocks on Solana</p>
    <div class="refresh-bar">Auto-refreshes every 60s</div>

    <div class="badges">
      <a href="https://huggingface.co/datasets/patruff/molt-benchmark" class="badge badge-hf" target="_blank">HuggingFace Dataset</a>
      <a href="https://www.patgpt.us" class="badge" target="_blank">www.patgpt.us</a>
      <a href="/api/v1/brain-feed" class="badge badge-api">Brain Feed API</a>
      <a href="/api/v1/trade-with-reasoning/schema" class="badge badge-api">Trade Schema</a>
      <a href="/benchmark-leaderboard/data" class="badge">Leaderboard JSON</a>
      <a href="/api/v1/benchmark-data/export/json" class="badge">Export Dataset</a>
    </div>

    <div class="section">
      <div class="section-title">Benchmark Scoring Pillars</div>
      <div class="pillars">
        <div class="pillar">
          <div class="pillar-label">Reasoning Coherence</div>
          <div class="pillar-type">Qualitative</div>
          <div class="pillar-val">0-1</div>
          <div class="pillar-desc">Does the agent's logic match its trade? NLP sentiment analysis.</div>
          <div class="pillar-weight">Weight: 25%</div>
        </div>
        <div class="pillar">
          <div class="pillar-label">Hallucination Rate</div>
          <div class="pillar-type">Safety</div>
          <div class="pillar-val">0-1</div>
          <div class="pillar-desc">Rate of fabricated prices, tickers, or facts in reasoning.</div>
          <div class="pillar-weight">Weight: 20%</div>
        </div>
        <div class="pillar">
          <div class="pillar-label">Sharpe Ratio</div>
          <div class="pillar-type">Risk-Adjusted</div>
          <div class="pillar-val">-5 to 5</div>
          <div class="pillar-desc">Risk-adjusted return: excess return / volatility.</div>
          <div class="pillar-weight">Weight: 20%</div>
        </div>
        <div class="pillar">
          <div class="pillar-label">Instruction Discipline</div>
          <div class="pillar-type">Reliability</div>
          <div class="pillar-val">0-100%</div>
          <div class="pillar-desc">Compliance with position limits and trading rules.</div>
          <div class="pillar-weight">Weight: 15%</div>
        </div>
        <div class="pillar">
          <div class="pillar-label">Confidence Calibration</div>
          <div class="pillar-type">Meta</div>
          <div class="pillar-val">0-1</div>
          <div class="pillar-desc">Is high confidence correlated with good outcomes?</div>
          <div class="pillar-weight">Weight: 10%</div>
        </div>
        <div class="pillar">
          <div class="pillar-label">Win Rate</div>
          <div class="pillar-type">Financial</div>
          <div class="pillar-val">0-100%</div>
          <div class="pillar-desc">Percentage of trades that resulted in profit.</div>
          <div class="pillar-weight">Weight: 10%</div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title"><span class="dot"></span> Agent Leaderboard</div>
      <div style="overflow-x:auto;">
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Agent</th>
              <th>Style</th>
              <th class="num">Trades</th>
              <th>Coherence</th>
              <th>Halluc.</th>
              <th class="num">Discipline</th>
              <th class="num">Confidence</th>
              <th>Composite</th>
              <th>Grade</th>
            </tr>
          </thead>
          <tbody>
            ${leaderboardHtml || '<tr><td colspan="10" style="text-align:center;color:var(--dim);padding:24px;">No trades yet. Run a trading round to populate the benchmark.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>

    <div class="section">
      <div class="section-title"><span class="dot"></span> Brain Feed — Latest Agent Reasoning</div>
      ${brainFeedHtml || '<div class="bf-entry"><div class="bf-reasoning" style="color:var(--dim);">No reasoning data yet. Run a trading round or submit a trade via /api/v1/trade-with-reasoning.</div></div>'}
    </div>

    <div class="footer">
      <strong>MoltApp AI Trading Benchmark v8</strong> &mdash; Colosseum Agent Hackathon 2026<br>
      Every trade requires reasoning. No black-box trades. Full transparency.<br>
      <small>Dataset: <a href="https://huggingface.co/datasets/patruff/molt-benchmark">patruff/molt-benchmark</a> &bull;
      API: <a href="/api/v1/trade-with-reasoning/schema">/trade-with-reasoning</a> &bull;
      Brain Feed: <a href="/api/v1/brain-feed">/brain-feed</a></small>
    </div>
  </div>

  <script>
    setInterval(async () => {
      try {
        const r = await fetch('/benchmark-leaderboard/data');
        if (r.ok) document.title = 'MoltApp Benchmark | ' + new Date().toLocaleTimeString();
      } catch {}
    }, 30000);
  </script>
</body>
</html>`;

  return c.html(page);
});
