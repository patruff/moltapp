/**
 * Benchmark v9 Dashboard
 *
 * Industry-standard AI trading benchmark page with:
 * - Regime-aware composite scoring with 5-pillar breakdown
 * - Live leaderboard with grades (A+ to F) and rank changes
 * - Brain feed ticker with real-time agent reasoning
 * - Integrity scores and violation summaries
 * - HuggingFace dataset badge and researcher API links
 * - Auto-refreshing data (30s intervals)
 *
 * GET /benchmark-v9      — Full HTML dashboard
 * GET /benchmark-v9/data — JSON data endpoint
 */

import { Hono } from "hono";
import { html } from "hono/html";
import {
  getV9Leaderboard,
  getAgentScore,
  exportV9Snapshot,
  getTrackedAgents,
} from "../services/benchmark-v9-scorer.ts";
import {
  analyzeIntegrity,
  analyzeCrossAgentIntegrity,
  getAllIntegrityScores,
} from "../services/reasoning-integrity-engine.ts";
import { getAgentConfigs } from "../agents/orchestrator.ts";
import { db } from "../db/index.ts";
import { tradeJustifications } from "../db/schema/trade-reasoning.ts";
import { desc, eq, sql } from "drizzle-orm";

export const benchmarkV9Routes = new Hono();

// ---------------------------------------------------------------------------
// GET /data — JSON data endpoint
// ---------------------------------------------------------------------------

benchmarkV9Routes.get("/data", async (c) => {
  const leaderboard = getV9Leaderboard();
  const snapshot = exportV9Snapshot("sideways");
  const integrityScores = getAllIntegrityScores();
  const crossAgent = analyzeCrossAgentIntegrity();
  const agents = getAgentConfigs();

  // Enrich leaderboard with agent names and integrity
  const enriched = leaderboard.map((entry) => {
    const config = agents.find((a) => a.agentId === entry.agentId);
    return {
      ...entry,
      name: config?.name ?? entry.agentId,
      model: config?.model ?? "unknown",
      provider: config?.provider ?? "unknown",
      integrityScore: integrityScores[entry.agentId] ?? 1.0,
    };
  });

  // Get recent brain feed
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
    // DB unavailable
  }

  return c.json({
    ok: true,
    version: "v9",
    leaderboard: enriched,
    snapshot,
    integrityScores,
    crossAgent: {
      herdingRate: crossAgent.herding.rate,
      diversityScore: crossAgent.diversityScore,
      collusionSuspected: crossAgent.collusion.suspected,
    },
    recentReasoning,
  });
});

// ---------------------------------------------------------------------------
// GET / — HTML Dashboard
// ---------------------------------------------------------------------------

benchmarkV9Routes.get("/", async (c) => {
  const leaderboard = getV9Leaderboard();
  const agents = getAgentConfigs();
  const integrityScores = getAllIntegrityScores();
  const crossAgent = analyzeCrossAgentIntegrity();
  const snapshot = exportV9Snapshot("sideways");

  // Enrich leaderboard
  const rows = leaderboard.length > 0 ? leaderboard : agents.map((a, i) => ({
    rank: i + 1,
    agentId: a.agentId,
    composite: 0,
    grade: "—",
    pillars: { financial: 0, reasoning: 0, safety: 0, calibration: 0, adaptability: 0 },
    tradeCount: 0,
    change: "same" as const,
    percentile: 0,
  }));

  // Get recent reasoning for brain feed
  let recentEntries: {
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

  // Build leaderboard HTML
  const leaderboardHtml = rows.map((entry, i) => {
    const config = agents.find((a) => a.agentId === entry.agentId);
    const name = config?.name ?? entry.agentId;
    const model = config?.model ?? "";
    const integrity = integrityScores[entry.agentId] ?? 1.0;
    const changeIcon = entry.change === "up" ? "&#9650;" : entry.change === "down" ? "&#9660;" : "&#8212;";
    const changeColor = entry.change === "up" ? "#00ff88" : entry.change === "down" ? "#ff4444" : "#555";

    const gradeClass = entry.grade.startsWith("A") ? "grade-a"
      : entry.grade.startsWith("B") ? "grade-b"
      : entry.grade.startsWith("C") ? "grade-c"
      : "grade-d";

    return `<tr>
      <td><span class="rank">#${entry.rank}</span> <span style="color:${changeColor};font-size:0.7rem">${changeIcon}</span></td>
      <td><strong>${name}</strong><br><small class="model">${model}</small></td>
      <td><span class="grade ${gradeClass}">${entry.grade}</span></td>
      <td class="composite">${entry.composite.toFixed(3)}</td>
      <td>${entry.pillars.financial.toFixed(2)}</td>
      <td>${entry.pillars.reasoning.toFixed(2)}</td>
      <td>${entry.pillars.safety.toFixed(2)}</td>
      <td>${entry.pillars.calibration.toFixed(2)}</td>
      <td>${entry.pillars.adaptability.toFixed(2)}</td>
      <td><span class="integrity-pill ${integrity >= 0.9 ? "int-good" : integrity >= 0.7 ? "int-warn" : "int-bad"}">${integrity.toFixed(2)}</span></td>
      <td>${entry.tradeCount}</td>
    </tr>`;
  }).join("");

  // Build brain feed HTML
  const brainFeedHtml = recentEntries.map((e) => `
    <div class="feed-entry">
      <div class="feed-header">
        <span class="agent-tag">${e.agentId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 20)}</span>
        <span class="action-tag action-${e.action}">${e.action.toUpperCase()}</span>
        <span class="symbol-tag">${e.symbol}</span>
        <span class="intent-tag">${e.intent}</span>
        <span class="coherence-tag">${(e.coherenceScore ?? 0).toFixed(2)}</span>
      </div>
      <div class="reasoning-text">${(e.reasoning ?? "").slice(0, 220)}${(e.reasoning ?? "").length > 220 ? "..." : ""}</div>
      <div class="feed-footer">Confidence: ${((e.confidence ?? 0) * 100).toFixed(0)}% &middot; ${e.timestamp ? new Date(e.timestamp).toLocaleString() : ""}</div>
    </div>`).join("");

  const page = html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="60">
  <title>MoltApp Benchmark v9 | AI Trading Intelligence</title>
  <style>
    :root { --bg: #06060c; --card: #0d0d1a; --border: #1a1a2e; --accent: #00ff88; --accent2: #00aaff; --warn: #ffaa00; --danger: #ff4444; --text: #e0e0e0; --muted: #666; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'SF Mono', 'JetBrains Mono', monospace; background: var(--bg); color: var(--text); line-height: 1.6; }
    .container { max-width: 1400px; margin: 0 auto; padding: 24px; }
    .hero { text-align: center; padding: 32px 0 16px; }
    .hero h1 { font-size: 2rem; letter-spacing: -0.5px; }
    .hero h1 span { background: linear-gradient(135deg, var(--accent), var(--accent2)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .hero .version { font-size: 0.65rem; background: var(--accent); color: #000; padding: 2px 8px; border-radius: 3px; font-weight: 700; vertical-align: super; }
    .hero .tagline { color: var(--muted); font-size: 0.85rem; margin-top: 4px; }
    .hero .official { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 3px; color: var(--accent); margin-top: 2px; }
    .live-dot { width: 8px; height: 8px; background: var(--accent); border-radius: 50%; display: inline-block; margin-right: 6px; animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
    .links { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin: 16px 0; }
    .links a { background: var(--card); border: 1px solid var(--border); border-radius: 6px; padding: 6px 14px; font-size: 0.75rem; color: var(--accent); text-decoration: none; transition: all 0.15s; }
    .links a:hover { background: #111122; transform: translateY(-1px); }
    .links .hf-badge { border-color: var(--warn); color: var(--warn); }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; margin: 20px 0; }
    .stat { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 14px; text-align: center; }
    .stat .label { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); }
    .stat .val { font-size: 1.6rem; font-weight: 700; color: var(--accent); margin-top: 2px; }
    .stat .val.warn { color: var(--warn); }
    .section { margin: 28px 0; }
    .section h2 { font-size: 1rem; color: #fff; border-bottom: 1px solid var(--border); padding-bottom: 6px; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
    th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--border); }
    th { background: var(--card); color: var(--accent); font-weight: 600; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.5px; }
    tr:hover { background: rgba(0,255,136,0.03); }
    .rank { color: var(--warn); font-weight: 700; font-size: 1rem; }
    .model { color: var(--muted); font-size: 0.7rem; }
    .composite { font-weight: 700; color: var(--accent); font-size: 0.95rem; }
    .grade { padding: 2px 10px; border-radius: 4px; font-weight: 800; font-size: 0.8rem; display: inline-block; }
    .grade-a { background: #002211; color: var(--accent); border: 1px solid #004422; }
    .grade-b { background: #1a1a00; color: var(--warn); border: 1px solid #333300; }
    .grade-c { background: #1a0a00; color: #ff8800; border: 1px solid #331a00; }
    .grade-d { background: #1a0000; color: var(--danger); border: 1px solid #330000; }
    .integrity-pill { padding: 2px 6px; border-radius: 3px; font-size: 0.75rem; font-weight: 600; }
    .int-good { background: #002211; color: var(--accent); }
    .int-warn { background: #1a1a00; color: var(--warn); }
    .int-bad { background: #1a0000; color: var(--danger); }
    .pillars-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin: 16px 0; }
    .pillar { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 16px; text-align: center; }
    .pillar h3 { font-size: 0.65rem; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; }
    .pillar .value { font-size: 1.2rem; font-weight: 700; color: var(--accent); margin: 4px 0; }
    .pillar .desc { font-size: 0.6rem; color: #555; }
    .feed-entry { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-bottom: 8px; }
    .feed-header { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-bottom: 5px; }
    .agent-tag { font-weight: 600; color: #fff; font-size: 0.8rem; }
    .action-tag { padding: 1px 6px; border-radius: 3px; font-size: 0.65rem; font-weight: 700; }
    .action-buy { background: #002211; color: var(--accent); }
    .action-sell { background: #1a0000; color: var(--danger); }
    .action-hold { background: #1a1a00; color: var(--warn); }
    .intent-tag { background: #0d0d2a; color: #7777ff; padding: 1px 6px; border-radius: 3px; font-size: 0.65rem; }
    .symbol-tag { color: #888; font-size: 0.8rem; }
    .coherence-tag { color: var(--accent2); font-size: 0.7rem; margin-left: auto; }
    .reasoning-text { font-size: 0.75rem; color: #999; line-height: 1.5; }
    .feed-footer { font-size: 0.65rem; color: #444; margin-top: 4px; }
    .footer { text-align: center; color: #333; font-size: 0.7rem; margin-top: 32px; padding: 20px; border-top: 1px solid var(--border); }
    .footer a { color: var(--accent2); }
    @media (max-width: 768px) { .pillars-grid { grid-template-columns: repeat(2, 1fr); } table { font-size: 0.7rem; } th, td { padding: 4px 5px; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="hero">
      <h1><span>MoltApp</span> AI Trading Benchmark <span class="version">v9</span></h1>
      <div class="official">Industry-Standard AI Finance Benchmark</div>
      <div class="tagline"><span class="live-dot"></span>Live evaluation of AI agents trading real tokenized stocks on Solana</div>
    </div>

    <div class="links">
      <a href="https://huggingface.co/datasets/patruff/molt-benchmark" class="hf-badge" target="_blank">HuggingFace Dataset</a>
      <a href="https://www.patgpt.us" target="_blank">www.patgpt.us</a>
      <a href="/api/v1/brain-feed">Brain Feed API</a>
      <a href="/api/v1/researcher/schema">Researcher API</a>
      <a href="/api/v1/researcher/dataset?format=json">Dataset Export</a>
      <a href="/api/v1/researcher/reproducibility">Reproducibility</a>
      <a href="/benchmark-v9/data">Dashboard JSON</a>
    </div>

    <div class="stats-grid">
      <div class="stat">
        <div class="label">Total Trades</div>
        <div class="val">${snapshot.metrics.totalTrades}</div>
      </div>
      <div class="stat">
        <div class="label">Avg Coherence</div>
        <div class="val">${snapshot.metrics.avgCoherence.toFixed(3)}</div>
      </div>
      <div class="stat">
        <div class="label">Hallucination Rate</div>
        <div class="val ${snapshot.metrics.avgHallucinationRate > 0.1 ? "warn" : ""}">${(snapshot.metrics.avgHallucinationRate * 100).toFixed(1)}%</div>
      </div>
      <div class="stat">
        <div class="label">Discipline Rate</div>
        <div class="val">${(snapshot.metrics.avgDisciplineRate * 100).toFixed(1)}%</div>
      </div>
      <div class="stat">
        <div class="label">Herding Rate</div>
        <div class="val ${crossAgent.herding.rate > 0.5 ? "warn" : ""}">${(crossAgent.herding.rate * 100).toFixed(0)}%</div>
      </div>
      <div class="stat">
        <div class="label">Strategy Diversity</div>
        <div class="val">${crossAgent.diversityScore.toFixed(2)}</div>
      </div>
    </div>

    <div class="section">
      <h2>Scoring Pillars (Regime-Aware Weights)</h2>
      <div class="pillars-grid">
        <div class="pillar">
          <h3>Financial</h3>
          <div class="value">P&L + Sharpe</div>
          <div class="desc">Bull: 30% / Bear: 15%</div>
        </div>
        <div class="pillar">
          <h3>Reasoning</h3>
          <div class="value">Coherence</div>
          <div class="desc">Bear: 30% / Bull: 20%</div>
        </div>
        <div class="pillar">
          <h3>Safety</h3>
          <div class="value">Halluc + Disc</div>
          <div class="desc">Bear: 25% / Bull: 20%</div>
        </div>
        <div class="pillar">
          <h3>Calibration</h3>
          <div class="value">Conf Accuracy</div>
          <div class="desc">Volatile: 20% / else: 15%</div>
        </div>
        <div class="pillar">
          <h3>Adaptability</h3>
          <div class="value">Regime Consistency</div>
          <div class="desc">Volatile: 20% / else: 15%</div>
        </div>
      </div>
    </div>

    <div class="section">
      <h2>Agent Leaderboard (Composite Score)</h2>
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Agent</th>
            <th>Grade</th>
            <th>Composite</th>
            <th>Financial</th>
            <th>Reasoning</th>
            <th>Safety</th>
            <th>Calibration</th>
            <th>Adapt.</th>
            <th>Integrity</th>
            <th>Trades</th>
          </tr>
        </thead>
        <tbody>
          ${leaderboardHtml || '<tr><td colspan="11" style="text-align:center;color:#555;padding:20px;">No trades yet. Run a trading round to populate the leaderboard.</td></tr>'}
        </tbody>
      </table>
    </div>

    <div class="section">
      <h2><span class="live-dot"></span>Brain Feed — Latest Agent Reasoning</h2>
      ${brainFeedHtml || '<div class="feed-entry"><div class="reasoning-text" style="color:#444;">No reasoning data yet. Agent reasoning will appear here in real time.</div></div>'}
    </div>

    <div class="footer">
      <strong>MoltApp AI Trading Benchmark v9</strong> &mdash; Colosseum Agent Hackathon 2026<br>
      Every trade requires reasoning. No black-box trades. Regime-aware scoring.<br>
      <small>Data published to <a href="https://huggingface.co/datasets/patruff/molt-benchmark">HuggingFace</a> &middot; <a href="/api/v1/researcher/schema">Researcher API</a></small>
    </div>
  </div>

  <script>
    setInterval(async () => {
      try {
        const resp = await fetch('/benchmark-v9/data');
        if (resp.ok) document.title = 'MoltApp v9 | ' + new Date().toLocaleTimeString();
      } catch {}
    }, 30000);
  </script>
</body>
</html>`;

  return c.html(page);
});
