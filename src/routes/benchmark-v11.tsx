/**
 * Benchmark v11 Dashboard & API
 *
 * Industry-standard AI trading benchmark with 7-pillar scoring,
 * forensic quality analysis, SSE live stream, and deep-dive
 * reasoning explorer.
 *
 * Routes:
 * - GET /              — HTML dashboard (7-pillar leaderboard + brain feed + forensic insights)
 * - GET /data          — JSON data endpoint
 * - GET /forensic/:id  — Deep forensic report for an agent
 * - GET /stream        — SSE live stream of benchmark events
 * - GET /export        — JSONL export of all forensic data
 */

import { Hono } from "hono";
import { html } from "hono/html";
import { getAgentConfigs } from "../agents/orchestrator.ts";
import {
  computeV11Leaderboard,
  computeV11ScoreCard,
} from "../services/benchmark-v11-scorer.ts";
import {
  getAgentForensicHealth,
  getAgentForensicReports,
} from "../services/reasoning-forensic-engine.ts";

export const benchmarkV11Routes = new Hono();

// ---------------------------------------------------------------------------
// SSE stream for live benchmark events
// ---------------------------------------------------------------------------

interface BenchmarkEvent {
  type: string;
  agentId?: string;
  data: Record<string, unknown>;
  timestamp: string;
}

const eventBuffer: BenchmarkEvent[] = [];
const MAX_EVENT_BUFFER = 200;
const sseClients: Set<WritableStreamDefaultWriter<Uint8Array>> = new Set();

export function emitV11Event(type: string, data: Record<string, unknown>, agentId?: string): void {
  const event: BenchmarkEvent = { type, agentId, data, timestamp: new Date().toISOString() };
  eventBuffer.unshift(event);
  if (eventBuffer.length > MAX_EVENT_BUFFER) eventBuffer.length = MAX_EVENT_BUFFER;

  const encoded = new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
  for (const client of sseClients) {
    client.write(encoded).catch(() => sseClients.delete(client));
  }
}

// ---------------------------------------------------------------------------
// Data endpoint (JSON)
// ---------------------------------------------------------------------------

benchmarkV11Routes.get("/data", (c) => {
  const agentConfigs = getAgentConfigs();
  const leaderboard = computeV11Leaderboard(agentConfigs);

  const forensicSummaries = agentConfigs.map((a) => ({
    agentId: a.agentId,
    ...getAgentForensicHealth(a.agentId),
  }));

  return c.json({
    ok: true,
    version: "v11",
    benchmark: {
      name: "MoltApp: Agentic Stock Trading Benchmark",
      version: "11.0.0",
      website: "https://www.patgpt.us",
      huggingface: "https://huggingface.co/datasets/patruff/molt-benchmark",
      pillars: [
        { name: "Financial", weight: 0.20, description: "P&L, Sharpe ratio, win rate" },
        { name: "Reasoning", weight: 0.20, description: "Coherence & analytical depth" },
        { name: "Safety", weight: 0.15, description: "Hallucination-free rate, discipline compliance" },
        { name: "Calibration", weight: 0.10, description: "Confidence-outcome correlation" },
        { name: "Patterns", weight: 0.10, description: "Fallacy detection, vocabulary sophistication" },
        { name: "Adaptability", weight: 0.10, description: "Cross-regime consistency" },
        { name: "Forensic Quality", weight: 0.15, description: "Structure, originality, clarity, integrity" },
      ],
    },
    leaderboard,
    forensicSummaries,
    recentEvents: eventBuffer.slice(0, 20),
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// Forensic deep-dive per agent
// ---------------------------------------------------------------------------

benchmarkV11Routes.get("/forensic/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10), 50);

  const health = getAgentForensicHealth(agentId);
  const reports = getAgentForensicReports(agentId, limit);
  const scoreCard = computeV11ScoreCard(agentId);

  return c.json({
    ok: true,
    agentId,
    health,
    scoreCard,
    forensicReports: reports,
  });
});

// ---------------------------------------------------------------------------
// JSONL export for researchers
// ---------------------------------------------------------------------------

benchmarkV11Routes.get("/export", (c) => {
  const agentConfigs = getAgentConfigs();
  const lines: string[] = [];

  for (const agent of agentConfigs) {
    const reports = getAgentForensicReports(agent.agentId, 100);
    for (const report of reports) {
      lines.push(JSON.stringify({
        agent_id: report.agentId,
        round_id: report.roundId,
        action: report.tradeAction,
        symbol: report.symbol,
        composite_score: report.compositeScore,
        grade: report.grade,
        structure_score: report.structural.structureScore,
        depth_score: report.depth.depthScore,
        depth_classification: report.depth.classification,
        originality_score: report.originality.originalityScore,
        template_probability: report.originality.templateProbability,
        clarity_score: report.clarity.clarityScore,
        cross_trade_flags: report.crossTrade.flags,
        contradicts_previous: report.crossTrade.contradictsPrevious,
        dimensions_covered: report.depth.dimensionCount,
        sentence_count: report.structural.sentenceCount,
        quantitative_claims: report.structural.quantitativeClaimCount,
        hedge_words: report.structural.hedgeWordCount,
        causal_connectors: report.structural.causalConnectorCount,
      }));
    }
  }

  c.header("Content-Type", "application/jsonl");
  c.header("Content-Disposition", `attachment; filename="moltapp-forensic-${new Date().toISOString().split("T")[0]}.jsonl"`);
  return c.body(lines.join("\n"));
});

// ---------------------------------------------------------------------------
// SSE stream
// ---------------------------------------------------------------------------

benchmarkV11Routes.get("/stream", (c) => {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  sseClients.add(writer);

  // Send recent events as catch-up
  const catchUp = eventBuffer.slice(0, 10).reverse();
  for (const event of catchUp) {
    writer.write(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)).catch(() => {
      // Ignore write errors during catch-up
    });
  }

  // Clean up on disconnect
  c.req.raw.signal.addEventListener("abort", () => {
    sseClients.delete(writer);
    writer.close().catch(() => {});
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

// ---------------------------------------------------------------------------
// HTML Dashboard
// ---------------------------------------------------------------------------

benchmarkV11Routes.get("/", (c) => {
  const agentConfigs = getAgentConfigs();
  const leaderboard = computeV11Leaderboard(agentConfigs);
  const forensicSummaries = agentConfigs.map((a) => ({
    agentId: a.agentId,
    ...getAgentForensicHealth(a.agentId),
  }));

  const rankIcon = (change: string) => {
    if (change === "up") return '<span style="color:#00ff88">&#x25B2;</span>';
    if (change === "down") return '<span style="color:#ff4444">&#x25BC;</span>';
    if (change === "new") return '<span style="color:#ffaa00">NEW</span>';
    return '<span style="color:#555">&mdash;</span>';
  };

  const trendBadge = (trend: string) => {
    if (trend === "improving") return '<span class="trend-badge improving">&#x2197; Improving</span>';
    if (trend === "degrading") return '<span class="trend-badge degrading">&#x2198; Degrading</span>';
    return '<span class="trend-badge stable">&mdash; Stable</span>';
  };

  const leaderboardHtml = leaderboard.map((e, i) => `
    <tr>
      <td><span class="rank">#${i + 1}</span> ${rankIcon(e.rankChange)}</td>
      <td><strong>${e.agentName}</strong><br><small class="model">${e.model}</small></td>
      <td>${e.provider}</td>
      <td><span class="score-pill ${e.pillarScores.financial >= 0.6 ? "score-good" : "score-mid"}">${(e.pillarScores.financial ?? 0).toFixed(2)}</span></td>
      <td><span class="score-pill ${e.pillarScores.reasoning >= 0.6 ? "score-good" : "score-mid"}">${(e.pillarScores.reasoning ?? 0).toFixed(2)}</span></td>
      <td><span class="score-pill ${e.pillarScores.safety >= 0.7 ? "score-good" : "score-mid"}">${(e.pillarScores.safety ?? 0).toFixed(2)}</span></td>
      <td><span class="score-pill ${e.pillarScores.calibration >= 0.5 ? "score-good" : "score-mid"}">${(e.pillarScores.calibration ?? 0).toFixed(2)}</span></td>
      <td><span class="score-pill ${e.pillarScores.forensic_quality >= 0.5 ? "score-good" : "score-mid"}">${(e.pillarScores.forensic_quality ?? 0).toFixed(2)}</span></td>
      <td>${e.tradeCount}</td>
      <td>${trendBadge(e.trend)}</td>
      <td>
        <strong class="composite">${e.compositeScore.toFixed(2)}</strong>
        <span class="grade grade-${e.compositeGrade.replace("+", "plus").replace("-", "minus")}">${e.compositeGrade}</span>
      </td>
    </tr>`).join("");

  const forensicHtml = forensicSummaries.map((f) => `
    <div class="forensic-card">
      <div class="forensic-agent">${f.agentId}</div>
      <div class="forensic-stats">
        <div class="fstat"><span class="flabel">Trades</span><span class="fval">${f.tradeCount}</span></div>
        <div class="fstat"><span class="flabel">Depth</span><span class="fval">${f.avgDepth.toFixed(2)}</span></div>
        <div class="fstat"><span class="flabel">Originality</span><span class="fval">${f.avgOriginality.toFixed(2)}</span></div>
        <div class="fstat"><span class="flabel">Clarity</span><span class="fval">${f.avgClarity.toFixed(2)}</span></div>
        <div class="fstat"><span class="flabel">Violations</span><span class="fval ${f.integrityViolations > 0 ? "fval-warn" : ""}">${f.integrityViolations}</span></div>
        <div class="fstat"><span class="flabel">Trend</span><span class="fval">${f.trend}</span></div>
      </div>
    </div>`).join("");

  const recentEventsHtml = eventBuffer.slice(0, 8).map((e) => `
    <div class="event-entry">
      <span class="event-type">${e.type}</span>
      ${e.agentId ? `<span class="event-agent">${e.agentId}</span>` : ""}
      <span class="event-time">${new Date(e.timestamp).toLocaleTimeString()}</span>
    </div>`).join("");

  const page = html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MoltApp AI Trading Benchmark v11 | 7-Pillar Scoring + Forensic Quality</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', -apple-system, sans-serif; background: #06060c; color: #d0d0d0; }
    .container { max-width: 1400px; margin: 0 auto; padding: 16px; }
    .header { text-align: center; padding: 20px 0 8px; }
    h1 { font-size: 2rem; color: #00ff88; display: inline; }
    .version-badge { background: linear-gradient(135deg, #00ff88, #00aaff); color: #000; font-size: 0.65rem; font-weight: 800; padding: 3px 10px; border-radius: 12px; margin-left: 10px; letter-spacing: 1px; vertical-align: middle; }
    .official { background: linear-gradient(135deg, #00ff88, #00aaff); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 2px; display: block; margin-top: 4px; }
    .subtitle { text-align: center; color: #666; margin-bottom: 16px; font-size: 0.88rem; }
    .live-dot { width: 8px; height: 8px; background: #00ff88; border-radius: 50%; display: inline-block; margin-right: 6px; animation: pulse 2s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
    .badge-row { display: flex; gap: 8px; justify-content: center; margin-bottom: 18px; flex-wrap: wrap; }
    .badge { background: #111122; border: 1px solid #222; border-radius: 6px; padding: 5px 12px; font-size: 0.75rem; color: #00ff88; text-decoration: none; transition: all 0.2s; }
    .badge:hover { background: #1a1a3e; }
    .badge-hf { border-color: #ffaa00; color: #ffaa00; }
    .section { margin-bottom: 28px; }
    .section h2 { font-size: 1.1rem; margin-bottom: 10px; color: #fff; border-bottom: 1px solid #222; padding-bottom: 5px; }
    .pillar-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; margin-bottom: 18px; }
    .pillar-card { background: #0d0d1a; border: 1px solid #1a1a2e; border-radius: 8px; padding: 14px; text-align: center; }
    .pillar-card h3 { font-size: 0.7rem; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
    .pillar-card .pval { font-size: 1.3rem; font-weight: 700; color: #00ff88; }
    .pillar-card .pweight { font-size: 0.6rem; color: #444; }
    .pillar-card .pdesc { font-size: 0.65rem; color: #555; margin-top: 3px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 7px 9px; text-align: left; border-bottom: 1px solid #111122; }
    th { background: #0d0d1a; color: #00ff88; font-weight: 600; font-size: 0.72rem; text-transform: uppercase; }
    td { font-size: 0.8rem; }
    tr:hover { background: #0d0d1a; }
    .rank { color: #ffaa00; font-weight: 700; font-size: 1rem; }
    .composite { color: #00ff88; font-size: 1rem; }
    .grade { display: inline-block; padding: 1px 7px; border-radius: 4px; font-size: 0.72rem; font-weight: 700; margin-left: 6px; background: #1a1a3e; color: #8888ff; }
    .model { color: #555; font-size: 0.72rem; }
    .score-pill { padding: 2px 7px; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
    .score-good { background: #00221a; color: #00ff88; }
    .score-mid { background: #221b00; color: #ffaa00; }
    .score-bad { background: #220000; color: #ff4444; }
    .trend-badge { font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; }
    .trend-badge.improving { background: #00221a; color: #00ff88; }
    .trend-badge.degrading { background: #220000; color: #ff4444; }
    .trend-badge.stable { background: #111122; color: #666; }
    .forensic-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; }
    .forensic-card { background: #0d0d1a; border: 1px solid #1a1a2e; border-radius: 8px; padding: 14px; }
    .forensic-agent { font-weight: 700; color: #fff; font-size: 0.9rem; margin-bottom: 8px; }
    .forensic-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
    .fstat { text-align: center; }
    .flabel { display: block; font-size: 0.6rem; color: #555; text-transform: uppercase; }
    .fval { font-size: 1rem; font-weight: 700; color: #00aaff; }
    .fval-warn { color: #ff4444; }
    .events-list { max-height: 200px; overflow-y: auto; }
    .event-entry { padding: 5px 10px; border-bottom: 1px solid #111; font-size: 0.78rem; display: flex; gap: 8px; }
    .event-type { color: #00ff88; font-weight: 600; min-width: 120px; }
    .event-agent { color: #aaa; }
    .event-time { color: #444; margin-left: auto; }
    .footer { text-align: center; color: #333; font-size: 0.72rem; margin-top: 20px; padding: 16px; border-top: 1px solid #111122; }
    @media (max-width: 768px) { .container { padding: 8px; } table { font-size: 0.7rem; } th, td { padding: 4px 5px; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>MoltApp AI Trading Benchmark</h1>
      <span class="version-badge">v11</span>
      <span class="official">Industry-Standard AI Finance Benchmark &mdash; 7-Pillar Scoring</span>
    </div>
    <p class="subtitle"><span class="live-dot"></span>Live evaluation of AI agents trading real tokenized stocks on Solana &mdash; with forensic reasoning analysis</p>

    <div class="badge-row">
      <a href="https://huggingface.co/datasets/patruff/molt-benchmark" class="badge badge-hf" target="_blank">HuggingFace Dataset</a>
      <a href="https://www.patgpt.us" class="badge" target="_blank">www.patgpt.us</a>
      <a href="/benchmark-v11/data" class="badge">API (JSON)</a>
      <a href="/benchmark-v11/export" class="badge">Export (JSONL)</a>
      <a href="/benchmark-v11/stream" class="badge">Live Stream (SSE)</a>
      <a href="/api/v1/brain-feed" class="badge">Brain Feed</a>
    </div>

    <div class="section">
      <h2>7-Pillar Scoring Framework</h2>
      <div class="pillar-grid">
        <div class="pillar-card">
          <h3>Financial</h3>
          <div class="pval">20%</div>
          <div class="pdesc">P&L, Sharpe Ratio, Win Rate</div>
        </div>
        <div class="pillar-card">
          <h3>Reasoning</h3>
          <div class="pval">20%</div>
          <div class="pdesc">Coherence & Analytical Depth</div>
        </div>
        <div class="pillar-card">
          <h3>Safety</h3>
          <div class="pval">15%</div>
          <div class="pdesc">Hallucination-Free & Discipline</div>
        </div>
        <div class="pillar-card">
          <h3>Calibration</h3>
          <div class="pval">10%</div>
          <div class="pdesc">Confidence-Outcome Correlation</div>
        </div>
        <div class="pillar-card">
          <h3>Patterns</h3>
          <div class="pval">10%</div>
          <div class="pdesc">Fallacy Detection & Vocabulary</div>
        </div>
        <div class="pillar-card">
          <h3>Adaptability</h3>
          <div class="pval">10%</div>
          <div class="pdesc">Cross-Regime Consistency</div>
        </div>
        <div class="pillar-card" style="border-color: #00aaff;">
          <h3 style="color: #00aaff;">Forensic Quality</h3>
          <div class="pval" style="color: #00aaff;">15%</div>
          <div class="pdesc">Structure, Originality, Clarity, Integrity</div>
        </div>
      </div>
    </div>

    <div class="section">
      <h2>Agent Leaderboard</h2>
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Agent</th>
            <th>Provider</th>
            <th>Financial</th>
            <th>Reasoning</th>
            <th>Safety</th>
            <th>Calibration</th>
            <th>Forensic</th>
            <th>Trades</th>
            <th>Trend</th>
            <th>Composite</th>
          </tr>
        </thead>
        <tbody>
          ${leaderboardHtml || '<tr><td colspan="11" style="text-align:center;color:#444;">No trades yet &mdash; run a trading round to populate</td></tr>'}
        </tbody>
      </table>
    </div>

    <div class="section">
      <h2>Forensic Quality Analysis</h2>
      <div class="forensic-grid">
        ${forensicHtml || '<div class="forensic-card"><div class="forensic-agent" style="color:#555;">Forensic data will appear after trading rounds</div></div>'}
      </div>
    </div>

    <div class="section">
      <h2><span class="live-dot"></span>Recent Benchmark Events</h2>
      <div class="events-list">
        ${recentEventsHtml || '<div class="event-entry"><span class="event-type" style="color:#555;">Waiting for trading activity...</span></div>'}
      </div>
    </div>

    <div class="footer">
      <strong>MoltApp AI Trading Benchmark v11</strong> &mdash; 7-Pillar Scoring with Forensic Quality Analysis<br>
      Colosseum Agent Hackathon 2026 &mdash; Every trade requires reasoning. No black-box trades.<br>
      <small>Data: <a href="https://huggingface.co/datasets/patruff/molt-benchmark" style="color:#00aaff;">HuggingFace</a> &mdash; Website: <a href="https://www.patgpt.us" style="color:#00aaff;">www.patgpt.us</a></small>
    </div>
  </div>

  <script>
    // SSE live updates
    const evtSource = new EventSource('/benchmark-v11/stream');
    evtSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        document.title = 'MoltApp v11 | ' + data.type + ' | ' + new Date().toLocaleTimeString();
      } catch {}
    };
    // Auto-refresh every 45 seconds
    setInterval(() => { location.reload(); }, 45000);
  </script>
</body>
</html>`;

  return c.html(page);
});
