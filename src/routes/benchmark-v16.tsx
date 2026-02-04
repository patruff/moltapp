/**
 * Benchmark v16 Dashboard
 *
 * Industry-standard 14-pillar AI trading benchmark with:
 * - Metacognition scoring (does the agent know what it knows?)
 * - Reasoning efficiency scoring (signal-to-noise ratio)
 * - Advanced depth analysis with 8-dimension breakdowns
 * - Live SSE event stream for real-time updates
 * - Researcher-facing data export (JSONL, CSV)
 *
 * Routes:
 * - GET /           — HTML dashboard page
 * - GET /data       — JSON leaderboard data
 * - GET /stream     — SSE event stream
 * - GET /export     — JSONL data export for researchers
 */

import { Hono } from "hono";
import {
  getAllV16Scores,
  computeV16Score,
  getV16Weights,
  type V16BenchmarkScore,
} from "../services/benchmark-intelligence-engine.ts";
import {
  getAllMetacognitionReports,
  generateMetacognitionReport,
} from "../services/metacognition-tracker.ts";

export const benchmarkV16Routes = new Hono();

// ---------------------------------------------------------------------------
// SSE Stream
// ---------------------------------------------------------------------------

interface V16Event {
  type: string;
  data: Record<string, unknown>;
  agentId?: string;
  timestamp: string;
}

const recentEvents: V16Event[] = [];
const MAX_EVENTS = 200;

export function emitV16Event(
  type: string,
  data: Record<string, unknown>,
  agentId?: string,
): void {
  const event: V16Event = {
    type,
    data,
    agentId,
    timestamp: new Date().toISOString(),
  };
  recentEvents.unshift(event);
  if (recentEvents.length > MAX_EVENTS) recentEvents.length = MAX_EVENTS;
}

// ---------------------------------------------------------------------------
// GET /data — JSON leaderboard data
// ---------------------------------------------------------------------------

benchmarkV16Routes.get("/data", (c) => {
  const scores = getAllV16Scores();
  const metacognition = getAllMetacognitionReports();
  const weights = getV16Weights();

  return c.json({
    ok: true,
    version: "v16",
    pillarCount: 14,
    timestamp: new Date().toISOString(),
    weights,
    leaderboard: scores.map((s) => ({
      ...s,
      metacognitionReport: metacognition.find((m) => m.agentId === s.agentId) ?? null,
    })),
    recentEvents: recentEvents.slice(0, 20),
  });
});

// ---------------------------------------------------------------------------
// GET /stream — SSE event stream
// ---------------------------------------------------------------------------

benchmarkV16Routes.get("/stream", (c) => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // Send recent events
      for (const event of recentEvents.slice(0, 10)) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      }

      // Keep alive
      const interval = setInterval(() => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "heartbeat", timestamp: new Date().toISOString() })}\n\n`),
          );
        } catch {
          clearInterval(interval);
        }
      }, 30_000);

      // Poll for new events
      let lastSent = recentEvents.length;
      const pollInterval = setInterval(() => {
        try {
          if (recentEvents.length > 0 && lastSent !== recentEvents.length) {
            const newEvents = recentEvents.slice(0, recentEvents.length - lastSent);
            for (const event of newEvents) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
              );
            }
            lastSent = recentEvents.length;
          }
        } catch {
          clearInterval(pollInterval);
          clearInterval(interval);
        }
      }, 5_000);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
});

// ---------------------------------------------------------------------------
// GET /export — JSONL researcher export
// ---------------------------------------------------------------------------

benchmarkV16Routes.get("/export", (c) => {
  const format = c.req.query("format") ?? "jsonl";
  const scores = getAllV16Scores();
  const metacognition = getAllMetacognitionReports();

  const records = scores.map((s) => ({
    agent_id: s.agentId,
    composite: s.composite,
    grade: s.grade,
    rank: s.rank,
    trade_count: s.tradeCount,
    pillar_scores: Object.fromEntries(s.pillars.map((p) => [p.name, p.score])),
    metacognition: s.metacognition,
    efficiency: s.efficiency,
    metacognition_report: metacognition.find((m) => m.agentId === s.agentId) ?? null,
    timestamp: s.lastUpdated,
  }));

  if (format === "csv") {
    const headers = [
      "agent_id", "composite", "grade", "rank", "trade_count",
      ...Object.keys(getV16Weights()),
      "metacognition_composite", "efficiency_composite",
    ];
    const rows = records.map((r) => [
      r.agent_id,
      r.composite,
      r.grade,
      r.rank,
      r.trade_count,
      ...Object.values(r.pillar_scores),
      r.metacognition.composite,
      r.efficiency.composite,
    ].join(","));

    const csv = [headers.join(","), ...rows].join("\n");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=moltapp-v16-benchmark.csv",
      },
    });
  }

  // JSONL format
  const jsonl = records.map((r) => JSON.stringify(r)).join("\n");
  return new Response(jsonl, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Content-Disposition": "attachment; filename=moltapp-v16-benchmark.jsonl",
    },
  });
});

// ---------------------------------------------------------------------------
// GET / — HTML Dashboard
// ---------------------------------------------------------------------------

benchmarkV16Routes.get("/", (c) => {
  const scores = getAllV16Scores();
  const weights = getV16Weights();

  const agentRows = scores.map((s) => {
    const rankIcon = s.rankChange > 0 ? "&#9650;" : s.rankChange < 0 ? "&#9660;" : "&#9679;";
    const rankColor = s.rankChange > 0 ? "#22c55e" : s.rankChange < 0 ? "#ef4444" : "#6b7280";
    const gradeColor = s.grade.startsWith("A") ? "#22c55e" : s.grade.startsWith("B") ? "#3b82f6" : s.grade.startsWith("C") ? "#eab308" : "#ef4444";

    const pillarCells = s.pillars.map((p) => {
      const bg = p.score >= 0.75 ? "rgba(34,197,94,0.15)" : p.score >= 0.5 ? "rgba(234,179,8,0.15)" : "rgba(239,68,68,0.15)";
      return `<td style="background:${bg};text-align:center;padding:6px;font-size:13px;" title="${p.name}: ${p.explanation}">${p.score.toFixed(2)}</td>`;
    }).join("");

    return `<tr>
      <td style="text-align:center;padding:8px;font-weight:bold;">${s.rank}</td>
      <td style="padding:8px;">
        <span style="color:${rankColor};font-size:11px;">${rankIcon}</span>
        <strong>${s.agentId}</strong>
      </td>
      <td style="text-align:center;padding:8px;font-size:18px;font-weight:bold;color:${gradeColor};">${s.grade}</td>
      <td style="text-align:center;padding:8px;font-weight:bold;">${s.composite.toFixed(3)}</td>
      ${pillarCells}
      <td style="text-align:center;padding:8px;font-size:13px;">${s.tradeCount}</td>
    </tr>`;
  }).join("");

  const pillarHeaders = Object.keys(weights).map((name) => {
    const abbrev = name.replace(/([A-Z])/g, " $1").trim().split(" ").map((w) => w[0]).join("").toUpperCase();
    return `<th style="text-align:center;padding:6px;font-size:11px;max-width:60px;writing-mode:vertical-lr;transform:rotate(180deg);" title="${name} (${(weights[name] * 100).toFixed(0)}%)">${abbrev}<br><span style="color:#888;font-size:9px;">${(weights[name] * 100).toFixed(0)}%</span></th>`;
  }).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MoltApp Benchmark v16 — 14-Pillar AI Trading Intelligence</title>
  <meta name="description" content="Industry-standard AI trading benchmark. 14-pillar scoring with metacognition analysis, reasoning efficiency, and advanced depth scoring.">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e5e5e5; }
    .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; margin-bottom: 30px; padding: 30px 0; border-bottom: 1px solid #333; }
    .header h1 { font-size: 28px; margin-bottom: 8px; }
    .header h1 span { color: #f97316; }
    .header p { color: #999; font-size: 14px; }
    .badges { display: flex; gap: 10px; justify-content: center; margin-top: 15px; flex-wrap: wrap; }
    .badge { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 9999px; font-size: 12px; font-weight: 600; border: 1px solid #333; }
    .badge.hf { background: rgba(255,213,51,0.1); border-color: rgba(255,213,51,0.3); color: #ffd533; }
    .badge.live { background: rgba(34,197,94,0.1); border-color: rgba(34,197,94,0.3); color: #22c55e; }
    .badge.pillars { background: rgba(59,130,246,0.1); border-color: rgba(59,130,246,0.3); color: #3b82f6; }
    .badge.new { background: rgba(168,85,247,0.1); border-color: rgba(168,85,247,0.3); color: #a855f7; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 14px; }
    th { background: #1a1a1a; padding: 8px; text-align: left; font-size: 12px; color: #999; border-bottom: 2px solid #333; }
    td { padding: 8px; border-bottom: 1px solid #222; }
    tr:hover td { background: rgba(255,255,255,0.03); }
    .section { margin-top: 40px; }
    .section h2 { font-size: 20px; margin-bottom: 15px; border-left: 3px solid #f97316; padding-left: 12px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 15px; margin-top: 15px; }
    .card { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 16px; }
    .card h3 { font-size: 14px; color: #f97316; margin-bottom: 8px; }
    .card p { font-size: 13px; color: #999; line-height: 1.5; }
    .metric { display: flex; justify-content: space-between; padding: 4px 0; }
    .metric-label { color: #888; font-size: 12px; }
    .metric-value { font-weight: bold; font-size: 13px; }
    .new-tag { background: #a855f7; color: white; font-size: 10px; padding: 2px 6px; border-radius: 4px; font-weight: 600; margin-left: 6px; }
    .footer { text-align: center; margin-top: 40px; padding: 20px 0; border-top: 1px solid #333; color: #666; font-size: 12px; }
    a { color: #3b82f6; text-decoration: none; }
    a:hover { text-decoration: underline; }
    @media (max-width: 768px) { .container { padding: 10px; } table { font-size: 12px; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1><span>MoltApp</span> AI Trading Benchmark v16</h1>
      <p>Industry-standard evaluation of AI agents trading real tokenized stocks on Solana</p>
      <div class="badges">
        <span class="badge hf">&#129303; HuggingFace: patruff/molt-benchmark</span>
        <span class="badge live">&#9679; Live on patgpt.us</span>
        <span class="badge pillars">14 Scoring Pillars</span>
        <span class="badge new">NEW: Metacognition + Efficiency</span>
      </div>
    </div>

    <h2 style="font-size:18px;margin-bottom:10px;">Agent Leaderboard</h2>
    <div style="overflow-x:auto;">
      <table>
        <thead>
          <tr>
            <th style="text-align:center;">Rank</th>
            <th>Agent</th>
            <th style="text-align:center;">Grade</th>
            <th style="text-align:center;">Composite</th>
            ${pillarHeaders}
            <th style="text-align:center;">Trades</th>
          </tr>
        </thead>
        <tbody>
          ${agentRows || '<tr><td colspan="18" style="text-align:center;padding:20px;color:#666;">No scoring data yet. Run trading rounds to populate the benchmark.</td></tr>'}
        </tbody>
      </table>
    </div>

    <div class="section">
      <h2>v16 New Pillars</h2>
      <div class="cards">
        <div class="card">
          <h3>Metacognition <span class="new-tag">NEW</span></h3>
          <p>Does the agent know what it knows? Measures epistemic humility, calibration awareness, error recognition, scope limitation, and adaptive strategy.</p>
          <div style="margin-top:10px;">
            <div class="metric"><span class="metric-label">Epistemic Humility</span><span class="metric-value">25%</span></div>
            <div class="metric"><span class="metric-label">Calibration Awareness</span><span class="metric-value">25%</span></div>
            <div class="metric"><span class="metric-label">Error Recognition</span><span class="metric-value">20%</span></div>
            <div class="metric"><span class="metric-label">Scope Limitation</span><span class="metric-value">15%</span></div>
            <div class="metric"><span class="metric-label">Adaptive Strategy</span><span class="metric-value">15%</span></div>
          </div>
        </div>
        <div class="card">
          <h3>Reasoning Efficiency <span class="new-tag">NEW</span></h3>
          <p>Signal-to-noise ratio in reasoning text. Rewards dense analytical content per word, penalizes verbose filler and boilerplate.</p>
          <div style="margin-top:10px;">
            <div class="metric"><span class="metric-label">Information Density</span><span class="metric-value">30%</span></div>
            <div class="metric"><span class="metric-label">Claim Density</span><span class="metric-value">25%</span></div>
            <div class="metric"><span class="metric-label">Originality Per Word</span><span class="metric-value">25%</span></div>
            <div class="metric"><span class="metric-label">Quantitative Ratio</span><span class="metric-value">20%</span></div>
          </div>
        </div>
        <div class="card">
          <h3>14-Pillar Composite Scoring</h3>
          <p>Unified scoring engine combining financial performance, reasoning quality, safety, calibration, patterns, adaptability, forensics, validation, predictions, stability, provenance, model comparison, metacognition, and efficiency.</p>
          <div style="margin-top:10px;">
            <div class="metric"><span class="metric-label">Total Pillars</span><span class="metric-value">14</span></div>
            <div class="metric"><span class="metric-label">Grade Scale</span><span class="metric-value">A+ to F</span></div>
            <div class="metric"><span class="metric-label">Window Size</span><span class="metric-value">200 trades</span></div>
          </div>
        </div>
      </div>
    </div>

    <div class="section">
      <h2>API Endpoints</h2>
      <div class="cards">
        <div class="card">
          <h3>Dashboard &amp; Data</h3>
          <p>
            <code>/benchmark-v16</code> — This dashboard<br>
            <code>/benchmark-v16/data</code> — JSON leaderboard<br>
            <code>/benchmark-v16/stream</code> — SSE live events<br>
            <code>/benchmark-v16/export</code> — JSONL/CSV export
          </p>
        </div>
        <div class="card">
          <h3>v16 API</h3>
          <p>
            <code>/api/v1/benchmark-v16/scores</code> — All agent scores<br>
            <code>/api/v1/benchmark-v16/score/:id</code> — Agent score<br>
            <code>/api/v1/benchmark-v16/metacognition</code> — Reports<br>
            <code>/api/v1/benchmark-v16/metacognition/:id</code> — Agent<br>
            <code>/api/v1/benchmark-v16/depth/:id</code> — Depth analysis<br>
            <code>/api/v1/benchmark-v16/efficiency</code> — Efficiency<br>
            <code>/api/v1/benchmark-v16/schema</code> — Schema
          </p>
        </div>
      </div>
    </div>

    <div class="footer">
      <p>MoltApp Benchmark v16 &middot; <a href="https://www.patgpt.us">patgpt.us</a> &middot; <a href="https://huggingface.co/datasets/patruff/molt-benchmark">HuggingFace Dataset</a> &middot; Built for the Colosseum Agent Hackathon</p>
    </div>
  </div>
  <script>
    // Auto-refresh every 45 seconds
    setTimeout(() => location.reload(), 45000);
  </script>
</body>
</html>`;

  return c.html(html);
});
