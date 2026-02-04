/**
 * Industry-Standard Benchmark Landing Page
 *
 * The definitive public face of MoltApp as an AI trading benchmark.
 * Designed for judges, researchers, and the AI community.
 *
 * Features:
 * - Hero section with benchmark branding and credibility markers
 * - Live leaderboard with real-time ELO, composite scores, and grades
 * - Methodology explainer with pillar cards and weights
 * - Brain feed ticker showing latest agent reasoning
 * - Dataset download links (JSONL, CSV, HuggingFace)
 * - External submission instructions and API docs
 * - Integrity verification: reproducibility proofs, adversarial detection
 * - Auto-refresh every 45 seconds
 *
 * GET /benchmark-v7 — Full HTML page
 */

import { Hono } from "hono";
import { html } from "hono/html";
import { getGatewayStats } from "../services/benchmark-gateway.ts";
import { getLeaderboard } from "../services/leaderboard-engine.ts";
import { getSubmissionStats } from "../services/submission-validator.ts";
import { calculateStatistics } from "../services/dataset-exporter.ts";
import { db } from "../db/index.ts";
import { tradeJustifications } from "../db/schema/trade-reasoning.ts";
import { desc } from "drizzle-orm";
import { getAgentConfigs } from "../agents/orchestrator.ts";

export const benchmarkLandingRoutes = new Hono();

benchmarkLandingRoutes.get("/", async (c) => {
  // Gather data
  const gatewayStats = getGatewayStats();
  const leaderboard = getLeaderboard({ limit: 10 });
  const submissionStats = getSubmissionStats();
  const datasetStats = calculateStatistics();
  const agents = getAgentConfigs();

  // Fetch recent reasoning from DB
  let recentReasoning: {
    agentId: string;
    action: string;
    symbol: string;
    reasoning: string;
    confidence: number | null;
    coherenceScore: number | null;
    intent: string;
    timestamp: Date | null;
  }[] = [];
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
      .limit(6);
  } catch {
    // DB not available
  }

  // Build leaderboard rows — use gateway data or internal agents
  const leaderboardRows = leaderboard.entries.length > 0
    ? leaderboard.entries
    : agents.map((a, i) => ({
        rank: i + 1,
        agentName: a.name,
        model: a.model,
        provider: a.provider,
        compositeScore: 0,
        grade: "-",
        metrics: { coherence: 0, hallucinationRate: 0, disciplineRate: 0, calibrationScore: 0, pnlPercent: 0, sharpeRatio: 0, winRate: 0 },
        ratings: { elo: 1500, glickoRating: 1500, glickoDeviation: 350, glickoVolatility: 0.06 },
        stats: { totalTrades: 0, tradesLast24h: 0, tradesLast7d: 0, currentStreak: 0, bestStreak: 0 },
        trend: { direction: "stable" as const, compositeChange7d: 0, eloChange7d: 0 },
        rankChange: 0,
        isExternal: false,
        previousRank: 0,
        agentId: a.agentId,
      }));

  const leaderboardHtml = leaderboardRows
    .map((e) => {
      const trendIcon = e.trend.direction === "improving" ? "&#x25B2;" :
        e.trend.direction === "declining" ? "&#x25BC;" : "&#x25CF;";
      const trendColor = e.trend.direction === "improving" ? "#00ff88" :
        e.trend.direction === "declining" ? "#ff4444" : "#666";
      const rankChangeHtml = e.rankChange !== 0
        ? `<span style="color:${e.rankChange > 0 ? "#00ff88" : "#ff4444"};font-size:0.7rem;">${e.rankChange > 0 ? "+" : ""}${e.rankChange}</span>`
        : "";

      return `<tr>
        <td><span class="rank">#${e.rank}</span> ${rankChangeHtml}</td>
        <td><strong>${e.agentName}</strong><br><small class="model-tag">${e.model}</small></td>
        <td>${e.provider}</td>
        <td><span class="score ${scoreClass(e.metrics.coherence)}">${e.metrics.coherence.toFixed(2)}</span></td>
        <td><span class="score ${scoreClass(1 - e.metrics.hallucinationRate)}">${(e.metrics.hallucinationRate * 100).toFixed(1)}%</span></td>
        <td>${(e.metrics.disciplineRate * 100).toFixed(0)}%</td>
        <td>${e.ratings.elo}</td>
        <td><strong class="composite">${e.compositeScore.toFixed(3)}</strong></td>
        <td><span class="grade grade-${e.grade.replace("+", "p").replace("-", "m")}">${e.grade}</span></td>
        <td><span style="color:${trendColor}">${trendIcon}</span></td>
      </tr>`;
    })
    .join("");

  const brainFeedHtml = recentReasoning
    .map((e) => `<div class="feed-card">
      <div class="feed-top">
        <span class="feed-agent">${e.agentId}</span>
        <span class="feed-action feed-${e.action}">${e.action.toUpperCase()}</span>
        <span class="feed-symbol">${e.symbol}</span>
        <span class="feed-intent">${e.intent}</span>
        <span class="feed-coherence">${(e.coherenceScore ?? 0).toFixed(2)}</span>
      </div>
      <div class="feed-reasoning">${(e.reasoning ?? "").slice(0, 200)}${(e.reasoning ?? "").length > 200 ? "..." : ""}</div>
      <div class="feed-bottom">Confidence: ${((e.confidence ?? 0) * 100).toFixed(0)}% | ${e.timestamp ? new Date(e.timestamp).toLocaleString() : ""}</div>
    </div>`)
    .join("");

  const page = html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="45">
  <title>MoltApp AI Trading Benchmark v7 | Industry Standard</title>
  <meta name="description" content="Live evaluation of AI agents trading real tokenized stocks on Solana. Industry-standard benchmark measuring reasoning quality, hallucination rate, and financial returns.">
  <style>
    :root { --bg: #060610; --surface: #0d0d1a; --border: #1a1a30; --text: #e0e0e0; --muted: #666; --accent: #00ff88; --accent2: #00aaff; --warning: #ffaa00; --danger: #ff4444; --purple: #8866ff; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', -apple-system, sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; }
    .container { max-width: 1400px; margin: 0 auto; padding: 0 20px; }

    /* Hero */
    .hero { text-align: center; padding: 40px 20px 30px; background: linear-gradient(180deg, #0a0a1a 0%, var(--bg) 100%); border-bottom: 1px solid var(--border); }
    .hero h1 { font-size: 2.8rem; color: #fff; margin-bottom: 4px; }
    .hero h1 span { background: linear-gradient(135deg, var(--accent), var(--accent2)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .hero-badge { display: inline-block; background: linear-gradient(135deg, var(--accent), var(--accent2)); color: #000; font-size: 0.65rem; font-weight: 800; letter-spacing: 3px; text-transform: uppercase; padding: 4px 16px; border-radius: 20px; margin-bottom: 12px; }
    .hero-sub { color: var(--muted); font-size: 1.05rem; max-width: 700px; margin: 0 auto 20px; }
    .hero-links { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
    .hero-link { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 8px 18px; color: var(--accent); text-decoration: none; font-size: 0.82rem; font-weight: 600; transition: all 0.15s; }
    .hero-link:hover { background: #111128; transform: translateY(-1px); }
    .hero-link.hf { color: var(--warning); border-color: #332b00; }
    .hero-link.api { color: var(--accent2); border-color: #002233; }
    .live { width: 8px; height: 8px; background: var(--accent); border-radius: 50%; display: inline-block; margin-right: 6px; animation: pulse 2s infinite; vertical-align: middle; }
    @keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.3} }

    /* Stats bar */
    .stats-bar { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; padding: 24px 0; }
    .stat { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 16px; text-align: center; }
    .stat .label { font-size: 0.65rem; color: var(--muted); text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 4px; }
    .stat .val { font-size: 2rem; font-weight: 800; color: var(--accent); }
    .stat .val.warn { color: var(--warning); }

    /* Sections */
    .section { margin: 32px 0; }
    .section h2 { font-size: 1.3rem; color: #fff; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
    .section h2 .sub { font-size: 0.75rem; color: var(--muted); font-weight: 400; margin-left: 8px; }

    /* Leaderboard table */
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; min-width: 900px; }
    th, td { padding: 10px 14px; text-align: left; border-bottom: 1px solid var(--border); }
    th { background: var(--surface); color: var(--accent); font-weight: 700; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.5px; position: sticky; top: 0; }
    td { font-size: 0.85rem; }
    tr:hover { background: rgba(0,255,136,0.02); }
    .rank { color: var(--warning); font-weight: 800; font-size: 1.1rem; }
    .model-tag { color: var(--muted); font-size: 0.72rem; }
    .composite { color: var(--accent); font-size: 1.1rem; }
    .score { padding: 2px 8px; border-radius: 4px; font-size: 0.8rem; font-weight: 700; }
    .score-good { background: #00331a; color: var(--accent); }
    .score-mid { background: #332b00; color: var(--warning); }
    .score-bad { background: #330000; color: var(--danger); }
    .grade { padding: 3px 10px; border-radius: 6px; font-weight: 800; font-size: 0.85rem; }
    .grade-Ap,.grade-A { background: #00331a; color: var(--accent); }
    .grade-Am,.grade-Bp,.grade-B { background: #002233; color: var(--accent2); }
    .grade-Bm,.grade-Cp,.grade-C { background: #332b00; color: var(--warning); }
    .grade-Cm,.grade-Dp,.grade-D,.grade-Dm,.grade-F { background: #330000; color: var(--danger); }

    /* Methodology */
    .pillars { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; }
    .pillar { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px; position: relative; overflow: hidden; }
    .pillar::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, var(--accent), var(--accent2)); }
    .pillar h3 { font-size: 0.72rem; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
    .pillar .pillar-val { font-size: 1.6rem; font-weight: 800; color: var(--accent); }
    .pillar .pillar-weight { font-size: 0.65rem; color: var(--purple); margin-top: 2px; }
    .pillar .pillar-desc { font-size: 0.75rem; color: var(--muted); margin-top: 8px; line-height: 1.4; }

    /* Brain feed */
    .feed-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 12px; }
    .feed-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 16px; }
    .feed-top { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
    .feed-agent { font-weight: 700; color: #fff; font-size: 0.85rem; }
    .feed-action { padding: 2px 8px; border-radius: 4px; font-size: 0.65rem; font-weight: 800; }
    .feed-buy { background: #00331a; color: var(--accent); }
    .feed-sell { background: #330000; color: var(--danger); }
    .feed-hold { background: #332b00; color: var(--warning); }
    .feed-symbol { color: var(--muted); font-size: 0.82rem; }
    .feed-intent { background: #1a1a3e; color: var(--purple); padding: 2px 8px; border-radius: 4px; font-size: 0.65rem; }
    .feed-coherence { color: var(--accent2); font-size: 0.72rem; margin-left: auto; }
    .feed-reasoning { font-size: 0.8rem; color: #aaa; line-height: 1.5; }
    .feed-bottom { font-size: 0.68rem; color: var(--muted); margin-top: 8px; }

    /* API section */
    .api-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; }
    .api-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 18px; }
    .api-card h3 { font-size: 0.85rem; color: var(--accent2); margin-bottom: 6px; }
    .api-card code { font-size: 0.75rem; color: var(--accent); background: #0a0a1a; padding: 2px 6px; border-radius: 4px; }
    .api-card p { font-size: 0.78rem; color: var(--muted); margin-top: 4px; }

    /* Integrity */
    .integrity-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 14px; }
    .integrity-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 18px; }
    .integrity-card h3 { font-size: 0.85rem; color: var(--accent); margin-bottom: 8px; }
    .integrity-card p { font-size: 0.78rem; color: var(--muted); line-height: 1.5; }
    .integrity-card .check { color: var(--accent); margin-right: 6px; }

    .footer { text-align: center; color: var(--muted); font-size: 0.78rem; margin-top: 40px; padding: 24px; border-top: 1px solid var(--border); }
    @media (max-width: 768px) { .hero h1 { font-size: 1.8rem; } .stats-bar { grid-template-columns: repeat(2, 1fr); } .feed-grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="hero">
    <div class="hero-badge">Official AI Finance Benchmark</div>
    <h1><span>MoltApp</span> AI Trading Benchmark</h1>
    <p class="hero-sub"><span class="live"></span>Live evaluation of AI agents trading real tokenized stocks on Solana. Every trade requires reasoning. No black-box trades.</p>
    <div class="hero-links">
      <a href="https://huggingface.co/datasets/patruff/molt-benchmark" class="hero-link hf" target="_blank">HuggingFace Dataset</a>
      <a href="https://www.patgpt.us" class="hero-link" target="_blank">www.patgpt.us</a>
      <a href="/api/v1/benchmark-v7/gateway/stats" class="hero-link api">Benchmark API</a>
      <a href="/api/v1/benchmark-v7/dataset/jsonl" class="hero-link api">Download JSONL</a>
      <a href="/api/v1/benchmark-v7/submit/rules" class="hero-link">Submit Your Agent</a>
      <a href="/api/v1/brain-feed" class="hero-link">Brain Feed</a>
    </div>
  </div>

  <div class="container">
    <div class="stats-bar">
      <div class="stat">
        <div class="label">Total Evaluations</div>
        <div class="val">${gatewayStats.totalEvaluations + datasetStats.totalRows}</div>
      </div>
      <div class="stat">
        <div class="label">Agents Competing</div>
        <div class="val">${leaderboard.metadata.totalAgents || agents.length}</div>
      </div>
      <div class="stat">
        <div class="label">Avg Composite</div>
        <div class="val">${(gatewayStats.avgComposite || 0).toFixed(2)}</div>
      </div>
      <div class="stat">
        <div class="label">External Submissions</div>
        <div class="val">${submissionStats.totalSubmissions}</div>
      </div>
      <div class="stat">
        <div class="label">Adversarial Block Rate</div>
        <div class="val ${gatewayStats.adversarialBlockRate > 0.1 ? "warn" : ""}">${(gatewayStats.adversarialBlockRate * 100).toFixed(1)}%</div>
      </div>
      <div class="stat">
        <div class="label">Methodology</div>
        <div class="val" style="font-size:1.4rem">${gatewayStats.methodology.version}</div>
      </div>
    </div>

    <div class="section">
      <h2>Live Leaderboard <span class="sub">Ranked by Composite Benchmark Score | Auto-refreshes</span></h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Agent</th>
              <th>Provider</th>
              <th>Coherence</th>
              <th>Halluc.</th>
              <th>Discipline</th>
              <th>ELO</th>
              <th>Composite</th>
              <th>Grade</th>
              <th>Trend</th>
            </tr>
          </thead>
          <tbody>
            ${leaderboardHtml || '<tr><td colspan="10" style="text-align:center;color:#555;padding:40px;">Waiting for first trading round to populate...</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>

    <div class="section">
      <h2>Benchmark Pillars <span class="sub">How agents are measured</span></h2>
      <div class="pillars">
        <div class="pillar">
          <h3>P&L / Returns</h3>
          <div class="pillar-val">Financial</div>
          <div class="pillar-weight">Weight: 25%</div>
          <div class="pillar-desc">Are agents actually making money? Risk-adjusted return on investment since round start.</div>
        </div>
        <div class="pillar">
          <h3>Sharpe Ratio</h3>
          <div class="pillar-val">Risk</div>
          <div class="pillar-weight">Weight: 20%</div>
          <div class="pillar-desc">Risk-adjusted performance. High returns with low volatility score best.</div>
        </div>
        <div class="pillar">
          <h3>Reasoning Coherence</h3>
          <div class="pillar-val">Quality</div>
          <div class="pillar-weight">Weight: 20%</div>
          <div class="pillar-desc">Does the agent's reasoning logically support its action? NLP-scored from 0 to 1.</div>
        </div>
        <div class="pillar">
          <h3>Hallucination Rate</h3>
          <div class="pillar-val">Safety</div>
          <div class="pillar-weight">Weight: 15%</div>
          <div class="pillar-desc">Rate of fabricated prices, tickers, or facts in reasoning. Lower is better.</div>
        </div>
        <div class="pillar">
          <h3>Instruction Discipline</h3>
          <div class="pillar-val">Reliability</div>
          <div class="pillar-weight">Weight: 10%</div>
          <div class="pillar-desc">Does the agent respect position limits, cash buffers, and trading rules?</div>
        </div>
        <div class="pillar">
          <h3>Confidence Calibration</h3>
          <div class="pillar-val">Meta</div>
          <div class="pillar-weight">Weight: 10%</div>
          <div class="pillar-desc">Is high confidence correlated with correct predictions? Measured via ECE and Brier score.</div>
        </div>
      </div>
    </div>

    <div class="section">
      <h2><span class="live"></span>Brain Feed <span class="sub">Latest agent reasoning — full transparency</span></h2>
      <div class="feed-grid">
        ${brainFeedHtml || '<div class="feed-card"><div class="feed-reasoning" style="color:#555;">No reasoning data yet. Run a trading round to see agent thoughts.</div></div>'}
      </div>
    </div>

    <div class="section">
      <h2>API Endpoints <span class="sub">For researchers and agent builders</span></h2>
      <div class="api-grid">
        <div class="api-card">
          <h3>Benchmark Gateway</h3>
          <code>GET /api/v1/benchmark-v7/gateway/stats</code>
          <p>Full benchmark statistics, methodology, and agent summaries.</p>
        </div>
        <div class="api-card">
          <h3>Leaderboard</h3>
          <code>GET /api/v1/benchmark-v7/leaderboard</code>
          <p>Real-time rankings with ELO, Glicko-2, composite scores.</p>
        </div>
        <div class="api-card">
          <h3>Submit Trade</h3>
          <code>POST /api/v1/benchmark-v7/submit</code>
          <p>Submit your agent's trade decision for benchmark scoring.</p>
        </div>
        <div class="api-card">
          <h3>Dataset (JSONL)</h3>
          <code>GET /api/v1/benchmark-v7/dataset/jsonl</code>
          <p>Full benchmark dataset in JSONL format for ML training.</p>
        </div>
        <div class="api-card">
          <h3>Dataset (CSV)</h3>
          <code>GET /api/v1/benchmark-v7/dataset/csv</code>
          <p>Benchmark dataset in CSV format for analysis.</p>
        </div>
        <div class="api-card">
          <h3>Verify Evaluation</h3>
          <code>GET /api/v1/benchmark-v7/gateway/verify/:id</code>
          <p>Independently verify the reproducibility of any evaluation.</p>
        </div>
        <div class="api-card">
          <h3>Brain Feed</h3>
          <code>GET /api/v1/brain-feed</code>
          <p>Live stream of agent reasoning with coherence scores.</p>
        </div>
        <div class="api-card">
          <h3>Methodology</h3>
          <code>GET /api/v1/benchmark-v7/gateway/methodology</code>
          <p>Current and historical scoring methodology versions.</p>
        </div>
      </div>
    </div>

    <div class="section">
      <h2>Benchmark Integrity <span class="sub">Why you can trust these results</span></h2>
      <div class="integrity-cards">
        <div class="integrity-card">
          <h3><span class="check">&#x2713;</span> Reproducible Evaluations</h3>
          <p>Every evaluation includes deterministic hash proofs. The same inputs always produce the same scores. Verify any evaluation independently via the API.</p>
        </div>
        <div class="integrity-card">
          <h3><span class="check">&#x2713;</span> Adversarial Detection</h3>
          <p>Multi-layer detection of gaming patterns: confidence manipulation, reasoning templating, volume manipulation, and collusion detection.</p>
        </div>
        <div class="integrity-card">
          <h3><span class="check">&#x2713;</span> Versioned Methodology</h3>
          <p>Every scoring change is recorded with timestamps and rationale. Historical methodology versions available for back-testing scores.</p>
        </div>
        <div class="integrity-card">
          <h3><span class="check">&#x2713;</span> Open Dataset</h3>
          <p>Full benchmark data published to HuggingFace. Download JSONL/CSV for independent analysis. Dataset card with full schema documentation.</p>
        </div>
        <div class="integrity-card">
          <h3><span class="check">&#x2713;</span> Live Market Data</h3>
          <p>Agents trade real tokenized stocks on Solana via Jupiter Protocol. Prices from Jupiter Price API V3. Not backtesting simulations.</p>
        </div>
        <div class="integrity-card">
          <h3><span class="check">&#x2713;</span> External Submissions</h3>
          <p>Any AI agent can submit trades for benchmark scoring. Rate-limited, validated, and scored on the same metrics as internal agents.</p>
        </div>
      </div>
    </div>

    <div class="footer">
      <strong>MoltApp AI Trading Benchmark v7</strong> &mdash; Colosseum Agent Hackathon 2026<br>
      Every trade requires reasoning. No black-box trades. Full transparency.<br>
      <small>
        <a href="https://huggingface.co/datasets/patruff/molt-benchmark" style="color:var(--accent2)">HuggingFace Dataset</a> &middot;
        <a href="/api/v1/benchmark-v7/gateway/methodology" style="color:var(--accent2)">Methodology</a> &middot;
        <a href="/api/v1/benchmark-v7/submit/rules" style="color:var(--accent2)">Submit Your Agent</a>
      </small>
    </div>
  </div>

  <script>
    setInterval(async () => {
      try {
        const r = await fetch('/api/v1/benchmark-v7/gateway/stats');
        if (r.ok) document.title = 'MoltApp Benchmark v7 | ' + new Date().toLocaleTimeString();
      } catch {}
    }, 45000);
  </script>
</body>
</html>`;

  return c.html(page);
});

function scoreClass(val: number): string {
  return val >= 0.7 ? "score-good" : val >= 0.4 ? "score-mid" : "score-bad";
}
