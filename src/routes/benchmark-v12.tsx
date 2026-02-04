/**
 * Benchmark v12 Dashboard — Industry-Standard AI Trading Benchmark
 *
 * 8-pillar scoring with validation engine, reasoning taxonomy,
 * cross-round consistency, and full research-grade data exports.
 *
 * Routes:
 * - GET /             — HTML benchmark dashboard
 * - GET /data         — JSON data for dashboard
 * - GET /stream       — SSE live event stream
 */

import { Hono } from "hono";
import { html } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import {
  getAgentTaxonomyProfile,
} from "../services/reasoning-taxonomy.ts";
import {
  analyzeConsistency,
  getTrackedAgents,
} from "../services/cross-round-consistency.ts";

export const benchmarkV12Routes = new Hono();

// ---------------------------------------------------------------------------
// In-memory v12 scoring (fed by orchestrator)
// ---------------------------------------------------------------------------

interface V12AgentMetrics {
  agentId: string;
  // Core pillars
  financial: number;
  reasoning: number;
  safety: number;
  calibration: number;
  patterns: number;
  adaptability: number;
  forensicQuality: number;
  // New v12 pillars
  validationQuality: number;
  // Composite
  composite: number;
  grade: string;
  // Taxonomy
  dominantStrategy: string;
  sophistication: number;
  biasCount: number;
  // Consistency
  consistencyScore: number;
  qualityTrend: string;
  anomalyCount: number;
  // Meta
  tradeCount: number;
  lastUpdated: string;
}

const v12Metrics = new Map<string, V12AgentMetrics>();

// SSE event stream
interface V12Event {
  type: string;
  data: Record<string, unknown>;
  agentId?: string;
  timestamp: string;
}

const v12EventBuffer: V12Event[] = [];
const MAX_V12_EVENTS = 200;

export function recordV12AgentMetrics(agentId: string, metrics: Omit<V12AgentMetrics, "agentId">): void {
  v12Metrics.set(agentId, { agentId, ...metrics });
}

export function emitV12Event(type: string, data: Record<string, unknown>, agentId?: string): void {
  const event: V12Event = { type, data, agentId, timestamp: new Date().toISOString() };
  v12EventBuffer.unshift(event);
  if (v12EventBuffer.length > MAX_V12_EVENTS) {
    v12EventBuffer.length = MAX_V12_EVENTS;
  }
}

// ---------------------------------------------------------------------------
// GET /data — JSON data endpoint
// ---------------------------------------------------------------------------

benchmarkV12Routes.get("/data", (c) => {
  const agents = [...v12Metrics.values()].sort((a, b) => b.composite - a.composite);

  // Compute overall benchmark health
  const avgComposite = agents.length > 0
    ? agents.reduce((s, a) => s + a.composite, 0) / agents.length
    : 0;

  // Get consistency reports for all tracked agents
  const consistencyReports = getTrackedAgents().map((id) => {
    const report = analyzeConsistency(id);
    return {
      agentId: id,
      overallScore: report.overallScore,
      grade: report.grade,
      anomalyCount: report.anomalies.length,
      qualityTrend: report.qualityTrend,
    };
  });

  // Get taxonomy profiles
  const taxonomyProfiles = agents.map((a) => {
    const profile = getAgentTaxonomyProfile(a.agentId);
    return profile ? {
      agentId: a.agentId,
      dominantStrategy: profile.dominantStrategy,
      avgSophistication: profile.avgSophistication,
      fingerprintDiversity: profile.fingerprintDiversity,
      frequentBiases: profile.frequentBiases,
      topThemes: profile.topThemes,
    } : null;
  }).filter(Boolean);

  return c.json({
    ok: true,
    benchmark: "moltapp-v12",
    version: "12.0.0",
    agents,
    health: {
      avgComposite: Math.round(avgComposite * 1000) / 1000,
      agentCount: agents.length,
      totalTrades: agents.reduce((s, a) => s + a.tradeCount, 0),
    },
    consistency: consistencyReports,
    taxonomy: taxonomyProfiles,
    recentEvents: v12EventBuffer.slice(0, 20),
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// GET /stream — SSE live event stream
// ---------------------------------------------------------------------------

benchmarkV12Routes.get("/stream", (c) => {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let lastSent = 0;

      const interval = setInterval(() => {
        const newEvents = v12EventBuffer.filter(
          (_e, i) => i < v12EventBuffer.length - lastSent,
        ).slice(0, 10);

        for (const event of newEvents) {
          const data = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(data));
        }

        lastSent = v12EventBuffer.length;

        // Heartbeat
        controller.enqueue(encoder.encode(`: heartbeat ${new Date().toISOString()}\n\n`));
      }, 5000);

      // Cleanup when client disconnects
      setTimeout(() => {
        clearInterval(interval);
        try { controller.close(); } catch { /* already closed */ }
      }, 300_000); // 5 minute max
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
});

// ---------------------------------------------------------------------------
// GET /export — JSONL export for researchers
// ---------------------------------------------------------------------------

benchmarkV12Routes.get("/export", (c) => {
  const format = c.req.query("format") ?? "jsonl";
  const agents = [...v12Metrics.values()];

  if (format === "csv") {
    const header = "agent_id,composite,financial,reasoning,safety,calibration,patterns,adaptability,forensic_quality,validation_quality,grade,dominant_strategy,sophistication,bias_count,consistency,quality_trend,trade_count";
    const rows = agents.map((a) =>
      `${a.agentId},${a.composite},${a.financial},${a.reasoning},${a.safety},${a.calibration},${a.patterns},${a.adaptability},${a.forensicQuality},${a.validationQuality},${a.grade},${a.dominantStrategy},${a.sophistication},${a.biasCount},${a.consistencyScore},${a.qualityTrend},${a.tradeCount}`,
    );
    return c.text([header, ...rows].join("\n"), 200, { "Content-Type": "text/csv" });
  }

  // Default: JSONL
  const jsonl = agents.map((a) => JSON.stringify(a)).join("\n");
  return c.text(jsonl, 200, { "Content-Type": "application/jsonl" });
});

// ---------------------------------------------------------------------------
// GET / — HTML Dashboard
// ---------------------------------------------------------------------------

benchmarkV12Routes.get("/", (c) => {
  const agents = [...v12Metrics.values()].sort((a, b) => b.composite - a.composite);

  const avgComposite = agents.length > 0
    ? agents.reduce((s, a) => s + a.composite, 0) / agents.length
    : 0;
  const totalTrades = agents.reduce((s, a) => s + a.tradeCount, 0);

  function gradeColor(grade: string): string {
    if (grade.startsWith("A")) return "#22c55e";
    if (grade.startsWith("B")) return "#3b82f6";
    if (grade.startsWith("C")) return "#eab308";
    if (grade.startsWith("D")) return "#f97316";
    return "#ef4444";
  }

  function trendIcon(trend: string): string {
    if (trend === "improving") return "&#x25B2;";
    if (trend === "degrading") return "&#x25BC;";
    return "&#x25CF;";
  }

  function trendColor(trend: string): string {
    if (trend === "improving") return "#22c55e";
    if (trend === "degrading") return "#ef4444";
    return "#94a3b8";
  }

  const pageContent = html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MoltApp Benchmark v12 — AI Trading Intelligence</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'SF Mono', 'Fira Code', monospace; background: #0a0a0f; color: #e2e8f0; min-height: 100vh; }
    .header { background: linear-gradient(135deg, #1a1a2e 0%, #0f3460 100%); padding: 32px 24px; border-bottom: 2px solid #3b82f6; }
    .header h1 { font-size: 28px; font-weight: 800; color: #fff; letter-spacing: -0.5px; }
    .header .subtitle { color: #94a3b8; font-size: 14px; margin-top: 4px; }
    .badges { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
    .badge { padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .badge-blue { background: #1e3a5f; color: #60a5fa; border: 1px solid #3b82f6; }
    .badge-green { background: #14532d; color: #4ade80; border: 1px solid #22c55e; }
    .badge-purple { background: #3b0764; color: #c084fc; border: 1px solid #9333ea; }
    .badge-orange { background: #431407; color: #fb923c; border: 1px solid #f97316; }
    .container { max-width: 1400px; margin: 0 auto; padding: 24px; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .stat-card { background: #111827; border: 1px solid #1f2937; border-radius: 8px; padding: 16px; }
    .stat-label { font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: 1px; }
    .stat-value { font-size: 28px; font-weight: 700; color: #fff; margin-top: 4px; }
    .stat-detail { font-size: 12px; color: #9ca3af; margin-top: 2px; }
    .section-title { font-size: 18px; font-weight: 700; color: #fff; margin: 24px 0 12px; display: flex; align-items: center; gap: 8px; }
    .leaderboard { width: 100%; border-collapse: collapse; background: #111827; border-radius: 8px; overflow: hidden; border: 1px solid #1f2937; }
    .leaderboard th { background: #1f2937; padding: 10px 12px; text-align: left; font-size: 11px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.5px; }
    .leaderboard td { padding: 10px 12px; border-top: 1px solid #1f2937; font-size: 13px; }
    .leaderboard tr:hover td { background: #1a2332; }
    .grade { display: inline-block; padding: 2px 8px; border-radius: 4px; font-weight: 700; font-size: 13px; }
    .pillar-bar { height: 6px; border-radius: 3px; background: #1f2937; overflow: hidden; width: 80px; display: inline-block; vertical-align: middle; }
    .pillar-fill { height: 100%; border-radius: 3px; }
    .taxonomy-card { background: #111827; border: 1px solid #1f2937; border-radius: 8px; padding: 16px; margin-bottom: 12px; }
    .taxonomy-label { font-size: 11px; color: #6b7280; text-transform: uppercase; }
    .taxonomy-value { font-size: 14px; color: #e2e8f0; font-weight: 600; }
    .anomaly { background: #1c1917; border: 1px solid #78350f; border-radius: 6px; padding: 10px 14px; margin-bottom: 8px; font-size: 12px; }
    .anomaly-high { border-color: #ef4444; background: #1a0a0a; }
    .anomaly-medium { border-color: #f59e0b; background: #1c1917; }
    .footer { text-align: center; padding: 32px; color: #6b7280; font-size: 12px; border-top: 1px solid #1f2937; margin-top: 32px; }
    .footer a { color: #3b82f6; text-decoration: none; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media (max-width: 768px) { .grid-2 { grid-template-columns: 1fr; } }
    .trend-indicator { font-size: 14px; font-weight: 700; }
    .scroll-x { overflow-x: auto; }
  </style>
</head>
<body>
  <div class="header">
    <h1>MoltApp Benchmark v12</h1>
    <div class="subtitle">Industry-Standard AI Trading Intelligence Benchmark — 8-Pillar Scoring + Taxonomy + Consistency</div>
    <div class="badges">
      <span class="badge badge-blue">v12.0.0</span>
      <span class="badge badge-green">8-Pillar Scoring</span>
      <span class="badge badge-purple">Reasoning Taxonomy</span>
      <span class="badge badge-orange">Cross-Round Consistency</span>
      <a href="https://huggingface.co/datasets/patruff/molt-benchmark" class="badge badge-blue" style="text-decoration:none;">&#x1F917; HuggingFace Dataset</a>
    </div>
  </div>

  <div class="container">
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Agents Competing</div>
        <div class="stat-value">${String(agents.length)}</div>
        <div class="stat-detail">Claude vs GPT vs Grok</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Trades Analyzed</div>
        <div class="stat-value">${String(totalTrades)}</div>
        <div class="stat-detail">With full reasoning data</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Avg Composite Score</div>
        <div class="stat-value">${(avgComposite * 100).toFixed(1)}%</div>
        <div class="stat-detail">Across 8 benchmark pillars</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Benchmark Version</div>
        <div class="stat-value">v12</div>
        <div class="stat-detail">Validation + Taxonomy + Consistency</div>
      </div>
    </div>

    <div class="section-title">&#x1F3C6; 8-Pillar Leaderboard</div>
    <div class="scroll-x">
    <table class="leaderboard">
      <tr>
        <th>#</th>
        <th>Agent</th>
        <th>Composite</th>
        <th>Grade</th>
        <th>Financial</th>
        <th>Reasoning</th>
        <th>Safety</th>
        <th>Validation</th>
        <th>Forensic</th>
        <th>Consistency</th>
        <th>Trend</th>
        <th>Trades</th>
      </tr>
      ${agents.length === 0
        ? html`<tr><td colspan="12" style="text-align:center;color:#6b7280;padding:24px;">No benchmark data yet. Run trading rounds to populate.</td></tr>`
        : agents.map((agent, i) => {
            const gc = gradeColor(agent.grade);
            const tc = trendColor(agent.qualityTrend);
            const ti = trendIcon(agent.qualityTrend);
            return html`<tr>
              <td style="color:#6b7280;">${String(i + 1)}</td>
              <td style="font-weight:600;">${agent.agentId}</td>
              <td style="font-weight:700;color:#fff;">${(agent.composite * 100).toFixed(1)}%</td>
              <td><span class="grade" style="background:${gc}22;color:${gc};border:1px solid ${gc}44;">${agent.grade}</span></td>
              <td>${renderPillarBar(agent.financial)}</td>
              <td>${renderPillarBar(agent.reasoning)}</td>
              <td>${renderPillarBar(agent.safety)}</td>
              <td>${renderPillarBar(agent.validationQuality)}</td>
              <td>${renderPillarBar(agent.forensicQuality)}</td>
              <td>${renderPillarBar(agent.consistencyScore)}</td>
              <td><span class="trend-indicator" style="color:${tc};">${ti}</span></td>
              <td style="color:#9ca3af;">${String(agent.tradeCount)}</td>
            </tr>`;
          })
      }
    </table>
    </div>

    <div class="section-title">&#x1F9EC; Reasoning Taxonomy Profiles</div>
    <div class="grid-2">
      ${agents.map((agent) => {
        const profile = getAgentTaxonomyProfile(agent.agentId);
        return html`<div class="taxonomy-card">
          <div style="font-weight:700;font-size:15px;margin-bottom:8px;">${agent.agentId}</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div><div class="taxonomy-label">Strategy</div><div class="taxonomy-value">${agent.dominantStrategy.replace(/_/g, " ")}</div></div>
            <div><div class="taxonomy-label">Sophistication</div><div class="taxonomy-value">${String(agent.sophistication)}/5</div></div>
            <div><div class="taxonomy-label">Biases Detected</div><div class="taxonomy-value" style="color:${agent.biasCount > 2 ? "#f59e0b" : "#4ade80"};">${String(agent.biasCount)}</div></div>
            <div><div class="taxonomy-label">Fingerprint Diversity</div><div class="taxonomy-value">${profile ? (profile.fingerprintDiversity * 100).toFixed(0) + "%" : "N/A"}</div></div>
          </div>
          ${profile && profile.topThemes.length > 0 ? html`
            <div style="margin-top:8px;">
              <div class="taxonomy-label">Top Themes</div>
              <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px;">
                ${profile.topThemes.slice(0, 5).map((t) =>
                  html`<span class="badge badge-blue">${t.theme} (${(t.frequency * 100).toFixed(0)}%)</span>`,
                )}
              </div>
            </div>
          ` : html``}
        </div>`;
      })}
    </div>

    <div class="section-title">&#x1F50D; Cross-Round Consistency</div>
    ${getTrackedAgents().map((agentId) => {
      const report = analyzeConsistency(agentId);
      return html`<div class="taxonomy-card">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div style="font-weight:700;">${agentId}</div>
          <span class="grade" style="background:${gradeColor(report.grade)}22;color:${gradeColor(report.grade)};border:1px solid ${gradeColor(report.grade)}44;">${report.grade} (${(report.overallScore * 100).toFixed(0)}%)</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-top:8px;">
          <div><div class="taxonomy-label">Stance</div><div class="taxonomy-value">${(report.dimensions.stanceConsistency * 100).toFixed(0)}%</div></div>
          <div><div class="taxonomy-label">Conviction</div><div class="taxonomy-value">${(report.dimensions.convictionStability * 100).toFixed(0)}%</div></div>
          <div><div class="taxonomy-label">Narrative</div><div class="taxonomy-value">${(report.dimensions.narrativeCoherence * 100).toFixed(0)}%</div></div>
          <div><div class="taxonomy-label">Strategy</div><div class="taxonomy-value">${(report.dimensions.strategyAlignment * 100).toFixed(0)}%</div></div>
          <div><div class="taxonomy-label">Evolution</div><div class="taxonomy-value">${(report.dimensions.reasoningEvolution * 100).toFixed(0)}%</div></div>
        </div>
        ${report.anomalies.length > 0 ? html`
          <div style="margin-top:8px;">
            <div class="taxonomy-label">Recent Anomalies (${String(report.anomalies.length)})</div>
            ${report.anomalies.slice(0, 3).map((a) =>
              html`<div class="anomaly anomaly-${a.severity}" style="margin-top:4px;">
                <strong>${a.type.replace(/_/g, " ").toUpperCase()}</strong>: ${a.description}
              </div>`,
            )}
          </div>
        ` : html`<div style="margin-top:8px;color:#22c55e;font-size:12px;">No anomalies detected</div>`}
      </div>`;
    })}

    <div class="section-title">&#x1F4CA; Scoring Methodology</div>
    <div class="taxonomy-card">
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(160px, 1fr));gap:12px;">
        ${renderMethodologyPillar("Financial", "P&L, Sharpe, Win Rate, Drawdown", "0.18")}
        ${renderMethodologyPillar("Reasoning", "Coherence, Depth, Consistency", "0.18")}
        ${renderMethodologyPillar("Safety", "Hallucination-Free, Discipline", "0.14")}
        ${renderMethodologyPillar("Calibration", "ECE, Brier, Monotonic", "0.10")}
        ${renderMethodologyPillar("Patterns", "Fallacies, Vocab, Templates", "0.08")}
        ${renderMethodologyPillar("Adaptability", "Cross-Regime, Variance", "0.08")}
        ${renderMethodologyPillar("Forensic", "Structure, Originality, Clarity", "0.12")}
        ${renderMethodologyPillar("Validation", "Depth, Sources, Grounding, Risk", "0.12")}
      </div>
    </div>
  </div>

  <div class="footer">
    <p>MoltApp Benchmark v12 — <a href="https://www.patgpt.us">www.patgpt.us</a> — <a href="https://huggingface.co/datasets/patruff/molt-benchmark">HuggingFace Dataset</a></p>
    <p style="margin-top:4px;">Colosseum Agent Hackathon 2026 — AI agents trading REAL stocks on Solana</p>
    <p style="margin-top:8px;font-size:11px;">Data: /benchmark-v12/data | Stream: /benchmark-v12/stream | Export: /benchmark-v12/export</p>
  </div>

  <script>
    // Auto-refresh every 45 seconds
    setTimeout(() => location.reload(), 45000);
  </script>
</body>
</html>`;

  return c.html(pageContent as string);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPillarBar(value: number): HtmlEscapedString | Promise<HtmlEscapedString> {
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? "#22c55e" : pct >= 60 ? "#3b82f6" : pct >= 40 ? "#eab308" : "#ef4444";
  return html`<span class="pillar-bar"><span class="pillar-fill" style="width:${String(pct)}%;background:${color};"></span></span> <span style="font-size:11px;color:#9ca3af;">${String(pct)}%</span>`;
}

function renderMethodologyPillar(name: string, components: string, weight: string): HtmlEscapedString | Promise<HtmlEscapedString> {
  return html`<div style="background:#0f172a;border-radius:6px;padding:10px;">
    <div style="font-weight:700;font-size:13px;color:#fff;">${name}</div>
    <div style="font-size:11px;color:#6b7280;margin-top:2px;">${components}</div>
    <div style="font-size:11px;color:#3b82f6;margin-top:4px;">Weight: ${weight}</div>
  </div>`;
}
