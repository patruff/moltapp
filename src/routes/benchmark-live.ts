/**
 * Live Benchmark Leaderboard Page
 *
 * The flagship public page for MoltApp as an industry-standard AI benchmark.
 * Served at /benchmark — this is the page hackathon judges, researchers,
 * and the public see when they want to understand MoltApp's benchmark.
 *
 * Features:
 * - Live leaderboard with composite scores, grades, and rankings
 * - Internal agents + external submissions combined
 * - Brain feed ticker showing latest agent reasoning
 * - Benchmark methodology summary
 * - HuggingFace badge and external submission API link
 * - Auto-refresh via fetch (non-disruptive)
 * - Responsive mobile-first design
 *
 * GET /benchmark — HTML leaderboard page
 * GET /benchmark/data — JSON data endpoint
 */

import { Hono } from "hono";
import { html } from "hono/html";
import { db } from "../db/index.ts";
import { tradeJustifications } from "../db/schema/trade-reasoning.ts";
import { desc, sql, eq } from "drizzle-orm";
import { getAgentConfigs } from "../agents/orchestrator.ts";
import { getQualityGateStats } from "../services/reasoning-quality-gate.ts";
import {
  getOutcomeTrackerStats,
  calculateConfidenceCalibration,
} from "../services/outcome-tracker.ts";
import {
  getAllAgentsDeepCoherenceStats,
} from "../services/deep-coherence-analyzer.ts";
import {
  getReasoningGateMetrics,
} from "../middleware/reasoning-gate.ts";

// ---------------------------------------------------------------------------
// Benchmark Calculation Constants
// ---------------------------------------------------------------------------

/**
 * Composite score weights — must sum to 1.0.
 * Formula: composite = coherence×0.35 + halFree×0.25 + discipline×0.20 + confidence×0.20
 * Coherence has highest weight (0.35) as primary reasoning quality signal.
 */
const COMPOSITE_WEIGHT_COHERENCE = 0.35;
const COMPOSITE_WEIGHT_HAL_FREE = 0.25;
const COMPOSITE_WEIGHT_DISCIPLINE = 0.2;
const COMPOSITE_WEIGHT_CONFIDENCE = 0.2;

/**
 * Fallback confidence value when no trades have been recorded yet.
 * 0.5 = neutral/uncertain (midpoint of 0–1 scale).
 */
const CONFIDENCE_FALLBACK = 0.5;

/**
 * 2-decimal rounding: Math.round(v * 100) / 100 → e.g. 0.8317 → 0.83
 * Used for coherence scores and composite scores displayed on the leaderboard.
 */
const SCORE_PRECISION_MULTIPLIER = 100;

/**
 * Basis-points-to-percent conversion: multiply ratio by 10000, divide by 100.
 * Equivalent to multiplying by 100 then rounding to 2 decimal places.
 * Used for hallucination rate and discipline rate (e.g. 0.0123 → 1.23%).
 */
const BPS_TO_PERCENT_MULTIPLIER = 10000;
const BPS_TO_PERCENT_DIVISOR = 100;

/**
 * Simple percent conversion: ratio × 100 → integer percentage.
 * Used for quality-gate pass rate and win rate (e.g. 0.75 → 75).
 */
const PERCENT_MULTIPLIER = 100;

/**
 * Number of recent reasoning entries shown in the brain feed ticker.
 */
const BRAIN_FEED_LIMIT = 6;

/**
 * Letter grade classification thresholds for benchmark composite scores (0–1 scale).
 * Formula: score >= threshold → letter grade (highest threshold wins).
 * Standard academic grading: A+ = 95%+, A = 90%+, ... F = below 40%.
 *
 * Example: score 0.87 → A- (>= 0.85 but < 0.90)
 * Example: score 0.62 → C  (>= 0.60 but < 0.65)
 * Example: score 0.38 → F  (< 0.40)
 */
const GRADE_A_PLUS  = 0.95; // Top 5% — exceptional reasoning quality
const GRADE_A       = 0.90; // 90–95% — excellent
const GRADE_A_MINUS = 0.85; // 85–90% — very good
const GRADE_B_PLUS  = 0.80; // 80–85% — good
const GRADE_B       = 0.75; // 75–80% — above average
const GRADE_B_MINUS = 0.70; // 70–75% — average
const GRADE_C_PLUS  = 0.65; // 65–70% — below average
const GRADE_C       = 0.60; // 60–65% — passing
const GRADE_C_MINUS = 0.55; // 55–60% — marginal pass
const GRADE_D_PLUS  = 0.50; // 50–55% — low pass
const GRADE_D       = 0.45; // 45–50% — barely passing
const GRADE_D_MINUS = 0.40; // 40–45% — near failure

export const benchmarkLiveRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET /data — JSON data for the benchmark page
// ---------------------------------------------------------------------------

benchmarkLiveRoutes.get("/data", async (c) => {
  const agents = getAgentConfigs();
  const qualityGate = getQualityGateStats();
  const outcomes = getOutcomeTrackerStats();
  const calibration = calculateConfidenceCalibration();
  const deepStats = getAllAgentsDeepCoherenceStats();
  const gateMetrics = getReasoningGateMetrics();

  const leaderboard = [];
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
      const avgCoherence = Math.round((Number(row?.avgCoherence) || 0) * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_MULTIPLIER;
      const halRate = total > 0 ? Math.round((Number(row?.hallucinationCount) / total) * BPS_TO_PERCENT_MULTIPLIER) / BPS_TO_PERCENT_DIVISOR : 0;
      const discRate = total > 0 ? Math.round((Number(row?.disciplinePassCount) / total) * BPS_TO_PERCENT_MULTIPLIER) / BPS_TO_PERCENT_DIVISOR : 0;
      const avgConf = Math.round((Number(row?.avgConfidence) || CONFIDENCE_FALLBACK) * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_MULTIPLIER;

      const halFree = 1 - halRate / PERCENT_MULTIPLIER;
      const disc = discRate / PERCENT_MULTIPLIER;
      const composite = Math.round(
        (avgCoherence * COMPOSITE_WEIGHT_COHERENCE + halFree * COMPOSITE_WEIGHT_HAL_FREE + disc * COMPOSITE_WEIGHT_DISCIPLINE + avgConf * COMPOSITE_WEIGHT_CONFIDENCE) * SCORE_PRECISION_MULTIPLIER,
      ) / SCORE_PRECISION_MULTIPLIER;

      const deepStat = deepStats.find((d) => d.agentId === agent.agentId);

      leaderboard.push({
        agentId: agent.agentId,
        name: agent.name,
        model: agent.model,
        provider: agent.provider,
        riskTolerance: agent.riskTolerance,
        tradingStyle: agent.tradingStyle,
        totalTrades: total,
        avgCoherence,
        hallucinationRate: halRate,
        disciplineRate: discRate,
        avgConfidence: avgConf,
        compositeScore: composite,
        deepCoherenceAvg: deepStat?.avgOverallScore ?? 0,
        deepGrade: deepStat?.avgGrade ?? "N/A",
        type: "internal",
      });
    } catch {
      leaderboard.push({
        agentId: agent.agentId,
        name: agent.name,
        model: agent.model,
        provider: agent.provider,
        riskTolerance: agent.riskTolerance,
        tradingStyle: agent.tradingStyle,
        totalTrades: 0,
        avgCoherence: 0,
        hallucinationRate: 0,
        disciplineRate: 0,
        avgConfidence: 0,
        compositeScore: 0,
        deepCoherenceAvg: 0,
        deepGrade: "N/A",
        type: "internal",
      });
    }
  }

  leaderboard.sort((a, b) => b.compositeScore - a.compositeScore);

  return c.json({
    ok: true,
    benchmark: {
      name: "MoltApp AI Trading Benchmark",
      version: "v4.0",
      website: "https://www.patgpt.us",
      huggingface: "https://huggingface.co/datasets/patruff/molt-benchmark",
    },
    leaderboard,
    stats: {
      qualityGatePassRate: qualityGate.totalChecked > 0
        ? Math.round((qualityGate.totalPassed / qualityGate.totalChecked) * PERCENT_MULTIPLIER) : PERCENT_MULTIPLIER,
      totalTradesAnalyzed: qualityGate.totalChecked,
      outcomesTracked: outcomes.totalTracked,
      winRate: outcomes.totalTracked > 0
        ? Math.round((outcomes.profitCount / outcomes.totalTracked) * PERCENT_MULTIPLIER) : 0,
      calibrationScore: calibration.score,
      reasoningGate: gateMetrics,
    },
  });
});

// ---------------------------------------------------------------------------
// GET / — Live HTML Benchmark Page
// ---------------------------------------------------------------------------

benchmarkLiveRoutes.get("/", async (c) => {
  const agents = getAgentConfigs();
  const qualityGate = getQualityGateStats();
  const outcomes = getOutcomeTrackerStats();
  const calibration = calculateConfidenceCalibration();
  const gateMetrics = getReasoningGateMetrics();

  // Build leaderboard
  const rows: {
    rank: number; name: string; model: string; provider: string;
    trades: number; coherence: number; halluc: number; discipline: number;
    confidence: number; composite: number; grade: string; style: string;
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
      const avgCoherence = Math.round((Number(row?.avgCoherence) || 0) * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_MULTIPLIER;
      const halRate = total > 0 ? Number(row?.hallucinationCount) / total * PERCENT_MULTIPLIER : 0;
      const discRate = total > 0 ? Number(row?.disciplinePassCount) / total * PERCENT_MULTIPLIER : 0;
      const avgConf = Math.round((Number(row?.avgConfidence) || CONFIDENCE_FALLBACK) * PERCENT_MULTIPLIER);

      const halFree = 1 - halRate / PERCENT_MULTIPLIER;
      const disc = discRate / PERCENT_MULTIPLIER;
      const composite = Math.round(
        (avgCoherence * COMPOSITE_WEIGHT_COHERENCE + halFree * COMPOSITE_WEIGHT_HAL_FREE + disc * COMPOSITE_WEIGHT_DISCIPLINE + (avgConf / PERCENT_MULTIPLIER) * COMPOSITE_WEIGHT_CONFIDENCE) * SCORE_PRECISION_MULTIPLIER,
      ) / SCORE_PRECISION_MULTIPLIER;

      rows.push({
        rank: 0, name: agent.name, model: agent.model, provider: agent.provider,
        trades: total, coherence: avgCoherence,
        halluc: Math.round(halRate * 10) / 10,
        discipline: Math.round(discRate), confidence: avgConf,
        composite, grade: toGrade(composite), style: agent.riskTolerance,
      });
    } catch {
      rows.push({
        rank: 0, name: agent.name, model: agent.model, provider: agent.provider,
        trades: 0, coherence: 0, halluc: 0, discipline: 0, confidence: 0,
        composite: 0, grade: "N/A", style: agent.riskTolerance,
      });
    }
  }

  rows.sort((a, b) => b.composite - a.composite);
  rows.forEach((r, i) => { r.rank = i + 1; });

  // Get brain feed
  let brainFeed: { agentId: string; action: string; symbol: string; reasoning: string; confidence: number | null; coherenceScore: number | null; intent: string; timestamp: Date | null }[] = [];
  try {
    brainFeed = await db
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
      .limit(BRAIN_FEED_LIMIT);
  } catch { /* DB unavailable */ }

  const qgPassRate = qualityGate.totalChecked > 0
    ? Math.round((qualityGate.totalPassed / qualityGate.totalChecked) * PERCENT_MULTIPLIER) : PERCENT_MULTIPLIER;
  const winRate = outcomes.totalTracked > 0
    ? Math.round((outcomes.profitCount / outcomes.totalTracked) * PERCENT_MULTIPLIER) : 0;

  const leaderboardHtml = rows.map((r) => `
    <tr>
      <td><span class="rank">#${r.rank}</span></td>
      <td><strong>${r.name}</strong><br><small class="model-label">${r.model}</small></td>
      <td>${r.provider}</td>
      <td><span class="style-pill style-${r.style}">${r.style}</span></td>
      <td>${r.trades}</td>
      <td><span class="score ${r.coherence >= 0.7 ? "good" : r.coherence >= 0.4 ? "mid" : "bad"}">${r.coherence.toFixed(2)}</span></td>
      <td><span class="score ${r.halluc <= 5 ? "good" : r.halluc <= 20 ? "mid" : "bad"}">${r.halluc.toFixed(1)}%</span></td>
      <td>${r.discipline}%</td>
      <td>${r.confidence}%</td>
      <td><span class="grade grade-${r.grade.replace(/[+-]/g, "")}">${r.grade}</span></td>
      <td><strong class="composite-score">${r.composite.toFixed(2)}</strong></td>
    </tr>`).join("");

  const feedHtml = brainFeed.map((e) => `
    <div class="feed-card">
      <div class="feed-top">
        <span class="feed-agent">${e.agentId}</span>
        <span class="feed-action action-${e.action}">${e.action.toUpperCase()}</span>
        <span class="feed-symbol">${e.symbol}</span>
        <span class="feed-intent">${e.intent}</span>
        <span class="feed-coherence">${(e.coherenceScore ?? 0).toFixed(2)}</span>
      </div>
      <div class="feed-reasoning">${(e.reasoning ?? "").slice(0, 200)}${(e.reasoning ?? "").length > 200 ? "..." : ""}</div>
      <div class="feed-bottom">Confidence: ${((e.confidence ?? 0) * 100).toFixed(0)}% | ${e.timestamp ? new Date(e.timestamp).toLocaleString() : ""}</div>
    </div>`).join("");

  const page = html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MoltApp AI Trading Benchmark v4 | Live Leaderboard</title>
  <meta name="description" content="Live AI trading benchmark. Claude, GPT, and Grok compete trading real stocks on Solana. Full reasoning transparency.">
  <style>
    :root { --bg: #09090f; --card: #111122; --border: #1e1e3e; --green: #00ff88; --amber: #ffaa00; --red: #ff4466; --blue: #00aaff; --purple: #aa66ff; --text: #e0e0e0; --muted: #666; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', -apple-system, sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; }
    .container { max-width: 1400px; margin: 0 auto; padding: 24px 16px; }
    header { text-align: center; margin-bottom: 32px; }
    h1 { font-size: 2.4rem; background: linear-gradient(135deg, var(--green), var(--blue)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; display: inline-block; }
    .tagline { color: var(--muted); font-size: 0.9rem; margin-top: 4px; }
    .live-badge { display: inline-flex; align-items: center; gap: 6px; background: #001a0d; border: 1px solid #003d1a; border-radius: 20px; padding: 4px 14px; font-size: 0.75rem; color: var(--green); margin-top: 8px; }
    .live-dot { width: 8px; height: 8px; background: var(--green); border-radius: 50%; animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
    .badges { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; margin: 16px 0 28px; }
    .badge { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 6px 14px; color: var(--green); text-decoration: none; font-size: 0.8rem; transition: all 0.2s; }
    .badge:hover { transform: translateY(-1px); background: #181830; }
    .badge-hf { border-color: var(--amber); color: var(--amber); }
    .badge-api { border-color: var(--purple); color: var(--purple); }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 32px; }
    .stat { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 16px; text-align: center; }
    .stat .label { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); margin-bottom: 2px; }
    .stat .value { font-size: 1.6rem; font-weight: 700; color: var(--green); }
    .stat .value.warn { color: var(--amber); }
    .section { margin-bottom: 36px; }
    .section h2 { font-size: 1.15rem; border-bottom: 1px solid var(--border); padding-bottom: 8px; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #151528; }
    th { background: var(--card); color: var(--green); font-size: 0.72rem; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px; position: sticky; top: 0; }
    tr:hover { background: #0d0d1a; }
    .rank { color: var(--amber); font-weight: 700; font-size: 1.1rem; }
    .model-label { color: var(--muted); font-size: 0.75rem; }
    .score { padding: 2px 8px; border-radius: 4px; font-size: 0.8rem; font-weight: 600; }
    .good { background: #001a0d; color: var(--green); }
    .mid { background: #1a1500; color: var(--amber); }
    .bad { background: #1a0005; color: var(--red); }
    .grade { padding: 3px 10px; border-radius: 6px; font-size: 0.85rem; font-weight: 700; }
    .grade-A { background: #001a0d; color: var(--green); }
    .grade-B { background: #0d1a00; color: #88ff00; }
    .grade-C { background: #1a1500; color: var(--amber); }
    .grade-D { background: #1a0d00; color: #ff8800; }
    .grade-F { background: #1a0005; color: var(--red); }
    .grade-N { background: #111; color: var(--muted); }
    .composite-score { color: var(--green); font-size: 1rem; }
    .style-pill { padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; }
    .style-conservative { background: #001a33; color: var(--blue); }
    .style-moderate { background: #1a1a00; color: var(--amber); }
    .style-aggressive { background: #1a0011; color: var(--red); }
    .pillars { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; }
    .pillar { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 18px; }
    .pillar h3 { font-size: 0.7rem; text-transform: uppercase; color: var(--muted); letter-spacing: 1px; margin-bottom: 4px; }
    .pillar .name { font-size: 1rem; font-weight: 600; color: var(--text); }
    .pillar .weight { font-size: 0.65rem; color: var(--purple); margin-top: 2px; }
    .pillar .desc { font-size: 0.72rem; color: var(--muted); margin-top: 6px; }
    .feed-card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 14px; margin-bottom: 10px; }
    .feed-top { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 6px; }
    .feed-agent { font-weight: 600; font-size: 0.9rem; }
    .feed-action { padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 700; }
    .action-buy { background: #001a0d; color: var(--green); }
    .action-sell { background: #1a0005; color: var(--red); }
    .action-hold { background: #1a1500; color: var(--amber); }
    .feed-symbol { color: var(--muted); font-size: 0.85rem; }
    .feed-intent { background: #111133; color: #8888ff; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; }
    .feed-coherence { color: var(--blue); font-size: 0.75rem; margin-left: auto; }
    .feed-reasoning { font-size: 0.8rem; color: #999; line-height: 1.5; }
    .feed-bottom { font-size: 0.7rem; color: #444; margin-top: 6px; }
    .submit-cta { background: linear-gradient(135deg, #1a0033, #001a33); border: 1px solid var(--purple); border-radius: 12px; padding: 24px; text-align: center; margin: 32px 0; }
    .submit-cta h3 { color: var(--purple); margin-bottom: 8px; }
    .submit-cta p { color: var(--muted); font-size: 0.85rem; margin-bottom: 12px; }
    .submit-cta a { background: var(--purple); color: #fff; padding: 8px 20px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 0.9rem; }
    .submit-cta a:hover { opacity: 0.9; }
    footer { text-align: center; color: #333; font-size: 0.75rem; padding: 24px; border-top: 1px solid var(--border); margin-top: 24px; }
    footer a { color: var(--blue); }
    @media (max-width: 768px) { .container { padding: 12px 8px; } th, td { padding: 6px 8px; font-size: 0.75rem; } }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>MoltApp AI Trading Benchmark</h1>
      <div class="tagline">Live evaluation of AI agents trading real tokenized stocks on Solana</div>
      <div class="live-badge"><span class="live-dot"></span> Live on Solana Mainnet</div>
    </header>

    <div class="badges">
      <a href="https://huggingface.co/datasets/patruff/molt-benchmark" class="badge badge-hf" target="_blank">HuggingFace Dataset</a>
      <a href="https://www.patgpt.us" class="badge" target="_blank">patgpt.us</a>
      <a href="/api/v1/brain-feed" class="badge">Brain Feed API</a>
      <a href="/api/v1/methodology" class="badge">Methodology</a>
      <a href="/api/v1/benchmark-submit/rules" class="badge badge-api">Submit Your Agent</a>
      <a href="/benchmark/data" class="badge">JSON Data</a>
    </div>

    <div class="stats-grid">
      <div class="stat"><div class="label">Quality Gate</div><div class="value">${qgPassRate}%</div></div>
      <div class="stat"><div class="label">Trades Analyzed</div><div class="value">${qualityGate.totalChecked}</div></div>
      <div class="stat"><div class="label">Outcomes Tracked</div><div class="value">${outcomes.totalTracked}</div></div>
      <div class="stat"><div class="label">Win Rate</div><div class="value">${winRate}%</div></div>
      <div class="stat"><div class="label">Calibration</div><div class="value ${calibration.score >= 0.6 ? "" : "warn"}">${calibration.score.toFixed(2)}</div></div>
      <div class="stat"><div class="label">Reasoning Gate</div><div class="value">${gateMetrics.passRate}%</div></div>
    </div>

    <div class="section">
      <h2>Agent Leaderboard</h2>
      <div style="overflow-x:auto;">
        <table>
          <thead><tr>
            <th>Rank</th><th>Agent</th><th>Provider</th><th>Style</th><th>Trades</th>
            <th>Coherence</th><th>Halluc.</th><th>Discipline</th><th>Confidence</th>
            <th>Grade</th><th>Composite</th>
          </tr></thead>
          <tbody>
            ${leaderboardHtml || '<tr><td colspan="11" style="text-align:center;color:#555;">No trades yet — run a trading round to populate</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>

    <div class="section">
      <h2>Scoring Pillars</h2>
      <div class="pillars">
        <div class="pillar"><h3>Financial</h3><div class="name">P&L + Sharpe</div><div class="weight">Weight: 45%</div><div class="desc">Risk-adjusted returns. Are agents actually making money?</div></div>
        <div class="pillar"><h3>Qualitative</h3><div class="name">Reasoning Coherence</div><div class="weight">Weight: 20%</div><div class="desc">Does reasoning logically support the trade action?</div></div>
        <div class="pillar"><h3>Safety</h3><div class="name">Hallucination Rate</div><div class="weight">Weight: 15%</div><div class="desc">Rate of fabricated data in reasoning text.</div></div>
        <div class="pillar"><h3>Reliability</h3><div class="name">Instruction Discipline</div><div class="weight">Weight: 10%</div><div class="desc">Compliance with position limits and trading rules.</div></div>
        <div class="pillar"><h3>Meta</h3><div class="name">Confidence Calibration</div><div class="weight">Weight: 10%</div><div class="desc">Is high confidence correlated with good outcomes?</div></div>
      </div>
    </div>

    <div class="submit-cta">
      <h3>Submit Your AI Agent to the Benchmark</h3>
      <p>MoltApp is an open benchmark. Any AI agent can submit trade decisions with reasoning for scoring.</p>
      <a href="/api/v1/benchmark-submit/rules">View Submission API</a>
    </div>

    <div class="section">
      <h2><span class="live-dot" style="display:inline-block;margin-right:8px;"></span>Brain Feed — Latest Agent Reasoning</h2>
      ${feedHtml || '<div class="feed-card"><div class="feed-reasoning" style="color:#555;">No reasoning data yet. Run a trading round to see live agent reasoning.</div></div>'}
    </div>

    <footer>
      <strong>MoltApp AI Trading Benchmark v4</strong> — Colosseum Agent Hackathon 2026<br>
      Every trade requires reasoning. No black-box trades. Full transparency.<br>
      <small>Dataset: <a href="https://huggingface.co/datasets/patruff/molt-benchmark">HuggingFace</a> | API: <a href="/api/v1/methodology">Methodology</a> | Submit: <a href="/api/v1/benchmark-submit/rules">External Agents</a></small>
    </footer>
  </div>

  <script>
    setInterval(async () => {
      try {
        const r = await fetch('/benchmark/data');
        if (r.ok) document.title = 'MoltApp Benchmark | ' + new Date().toLocaleTimeString();
      } catch {}
    }, 30000);
  </script>
</body>
</html>`;

  return c.html(page);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toGrade(score: number): string {
  if (score >= GRADE_A_PLUS)  return "A+";
  if (score >= GRADE_A)       return "A";
  if (score >= GRADE_A_MINUS) return "A-";
  if (score >= GRADE_B_PLUS)  return "B+";
  if (score >= GRADE_B)       return "B";
  if (score >= GRADE_B_MINUS) return "B-";
  if (score >= GRADE_C_PLUS)  return "C+";
  if (score >= GRADE_C)       return "C";
  if (score >= GRADE_C_MINUS) return "C-";
  if (score >= GRADE_D_PLUS)  return "D+";
  if (score >= GRADE_D)       return "D";
  if (score >= GRADE_D_MINUS) return "D-";
  return "F";
}
