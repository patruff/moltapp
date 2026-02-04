/**
 * Benchmark v17 Dashboard & Data Routes
 *
 * The ultimate AI Trading Benchmark dashboard — 16-pillar scoring,
 * forensic ledger, strategy genomes, and industry-standard presentation.
 *
 * Routes:
 *   GET /              — HTML dashboard page
 *   GET /data          — JSON data payload for dashboard
 *   GET /stream        — SSE live event stream
 *   GET /export        — JSONL export for researchers
 */

import { Hono } from "hono";
import {
  getV17Rankings,
  getV17Health,
  exportV17Benchmark,
  V17_PILLAR_WEIGHTS,
  type AgentBenchmarkProfile,
} from "../services/benchmark-intelligence-gateway.ts";
import {
  getLedgerStats,
  verifyLedgerIntegrity,
} from "../services/trade-forensic-ledger.ts";
import {
  getAllGenomes,
} from "../services/agent-strategy-genome.ts";

export const benchmarkV17Routes = new Hono();

// ---------------------------------------------------------------------------
// SSE stream
// ---------------------------------------------------------------------------

interface V17Event {
  type: string;
  data: Record<string, unknown>;
  agentId?: string;
  timestamp: number;
}

const v17EventBuffer: V17Event[] = [];
const MAX_V17_EVENTS = 200;

export function emitV17Event(type: string, data: Record<string, unknown>, agentId?: string): void {
  v17EventBuffer.push({ type, data, agentId, timestamp: Date.now() });
  if (v17EventBuffer.length > MAX_V17_EVENTS) v17EventBuffer.splice(0, v17EventBuffer.length - MAX_V17_EVENTS);
}

// ---------------------------------------------------------------------------
// GET /data — JSON data endpoint
// ---------------------------------------------------------------------------

benchmarkV17Routes.get("/data", (c) => {
  const rankings = getV17Rankings();
  const health = getV17Health();
  const ledger = getLedgerStats();
  const integrity = verifyLedgerIntegrity();
  const genomes = getAllGenomes();

  return c.json({
    ok: true,
    version: "v17",
    timestamp: new Date().toISOString(),
    pillarCount: Object.keys(V17_PILLAR_WEIGHTS).length,
    pillarWeights: V17_PILLAR_WEIGHTS,
    rankings: rankings.map((r) => ({
      rank: r.rank,
      agentId: r.agentId,
      provider: r.provider,
      model: r.model,
      composite: r.composite,
      grade: r.grade,
      eloRating: r.eloRating,
      streak: r.streak,
      tradeCount: r.tradeCount,
      dataQuality: r.dataQuality,
      pillars: r.pillars.map((p) => ({
        name: p.name,
        score: p.score,
        grade: p.grade,
        weight: p.weight,
        trend: p.trend,
      })),
      strengths: r.strengths,
      weaknesses: r.weaknesses,
    })),
    health,
    ledger: {
      totalEntries: ledger.totalEntries,
      chainIntact: ledger.chainIntact,
      lastHash: ledger.lastEntryHash.slice(0, 16) + "...",
      agentBreakdown: ledger.agentBreakdown,
    },
    integrity: {
      intact: integrity.intact,
      totalChecked: integrity.totalChecked,
      genesisHash: integrity.genesisHash.slice(0, 16) + "...",
      latestHash: integrity.latestHash.slice(0, 16) + "...",
    },
    genomes: genomes.map((g) => ({
      agentId: g.agentId,
      dominantPhenotype: g.dominantPhenotype,
      genomeStability: g.genomeStability,
      tradesSampled: g.tradesSampled,
      genes: g.genes.map((gene) => ({
        name: gene.name,
        score: gene.score,
        phenotype: gene.phenotype,
      })),
      similarity: g.similarity,
    })),
    recentEvents: v17EventBuffer.slice(-20),
  });
});

// ---------------------------------------------------------------------------
// GET /stream — SSE live stream
// ---------------------------------------------------------------------------

benchmarkV17Routes.get("/stream", (c) => {
  let lastSent = 0;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Send initial data
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "connected", version: "v17" })}\n\n`));

      const interval = setInterval(() => {
        const newEvents = v17EventBuffer.filter((e) => e.timestamp > lastSent);
        for (const event of newEvents) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          lastSent = event.timestamp;
        }
      }, 2000);

      // Auto-close after 5 minutes
      setTimeout(() => {
        clearInterval(interval);
        try { controller.close(); } catch { /* already closed */ }
      }, 300_000);
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
// GET /export — JSONL export
// ---------------------------------------------------------------------------

benchmarkV17Routes.get("/export", (c) => {
  const payload = exportV17Benchmark();

  const format = c.req.query("format") ?? "json";

  if (format === "jsonl") {
    const lines = payload.agents.map((a) => JSON.stringify(a)).join("\n");
    return new Response(lines, {
      headers: {
        "Content-Type": "application/jsonl",
        "Content-Disposition": "attachment; filename=moltapp-v17-benchmark.jsonl",
      },
    });
  }

  return c.json(payload);
});

// ---------------------------------------------------------------------------
// Helper: pillar bar CSS
// ---------------------------------------------------------------------------

function pillarBar(score: number, name: string): string {
  const pct = Math.round(score * 100);
  const color = score >= 0.8 ? "#22c55e" : score >= 0.6 ? "#eab308" : score >= 0.4 ? "#f97316" : "#ef4444";
  return `<div style="margin:2px 0"><span style="display:inline-block;width:130px;font-size:11px;color:#94a3b8">${name}</span><div style="display:inline-block;width:120px;height:12px;background:#1e293b;border-radius:3px;overflow:hidden;vertical-align:middle"><div style="width:${pct}%;height:100%;background:${color}"></div></div><span style="font-size:11px;color:${color};margin-left:4px">${pct}%</span></div>`;
}

function gradeColor(grade: string): string {
  if (grade.startsWith("A")) return "#22c55e";
  if (grade.startsWith("B")) return "#3b82f6";
  if (grade.startsWith("C")) return "#eab308";
  if (grade.startsWith("D")) return "#f97316";
  return "#ef4444";
}

function trendIcon(trend: string): string {
  if (trend === "improving") return "&#x25B2;";
  if (trend === "declining") return "&#x25BC;";
  return "&#x25CF;";
}

function agentCard(agent: AgentBenchmarkProfile): string {
  const pillarBars = agent.pillars.map((p) => pillarBar(p.score, p.name)).join("");
  const gColor = gradeColor(agent.grade);

  return `
    <div style="background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:20px;margin:12px 0">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div>
          <span style="font-size:24px;font-weight:700;color:${gColor}">#${agent.rank}</span>
          <span style="font-size:18px;font-weight:600;color:#f1f5f9;margin-left:8px">${agent.agentId}</span>
          <span style="font-size:12px;color:#64748b;margin-left:8px">${agent.provider} / ${agent.model}</span>
        </div>
        <div style="text-align:right">
          <div style="font-size:32px;font-weight:800;color:${gColor}">${agent.grade}</div>
          <div style="font-size:14px;color:#94a3b8">${(agent.composite * 100).toFixed(1)}% composite</div>
          <div style="font-size:12px;color:#64748b">Elo: ${agent.eloRating} | Trades: ${agent.tradeCount}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div>${pillarBars}</div>
        <div style="padding-left:12px">
          <div style="font-size:12px;color:#22c55e;margin-bottom:4px">Strengths</div>
          ${agent.strengths.map((s) => `<div style="font-size:11px;color:#94a3b8">+ ${s}</div>`).join("")}
          <div style="font-size:12px;color:#f97316;margin-top:8px;margin-bottom:4px">Weaknesses</div>
          ${agent.weaknesses.map((w) => `<div style="font-size:11px;color:#94a3b8">- ${w}</div>`).join("")}
        </div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// GET / — HTML dashboard
// ---------------------------------------------------------------------------

benchmarkV17Routes.get("/", (c) => {
  const rankings = getV17Rankings();
  const health = getV17Health();
  const ledger = getLedgerStats();
  const integrity = verifyLedgerIntegrity();
  const genomes = getAllGenomes();
  const events = v17EventBuffer.slice(-10);

  const agentCards = rankings.map(agentCard).join("");

  const genomeSection = genomes.map((g) => {
    const geneList = g.genes.map((gene) =>
      `<span style="display:inline-block;padding:2px 8px;margin:2px;border-radius:4px;font-size:11px;background:${gene.score >= 0.6 ? "#14532d" : gene.score >= 0.4 ? "#713f12" : "#7f1d1d"};color:${gene.score >= 0.6 ? "#86efac" : gene.score >= 0.4 ? "#fcd34d" : "#fca5a5"}">${gene.name}: ${gene.phenotype} (${(gene.score * 100).toFixed(0)}%)</span>`,
    ).join("");
    return `<div style="margin:8px 0"><strong style="color:#e2e8f0">${g.agentId}</strong> <span style="color:#64748b">stability: ${(g.genomeStability * 100).toFixed(0)}%</span><br/>${geneList}</div>`;
  }).join("");

  const eventFeed = events.length > 0
    ? events.map((e) => `<div style="padding:4px 0;border-bottom:1px solid #1e293b;font-size:11px"><span style="color:#3b82f6">${e.type}</span> <span style="color:#64748b">${e.agentId ?? ""}</span> <span style="color:#94a3b8">${JSON.stringify(e.data).slice(0, 120)}</span></div>`).join("")
    : '<div style="color:#64748b;font-size:12px">No events yet. Run a trading round to generate benchmark data.</div>';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>MoltApp Benchmark v17 — AI Trading Intelligence</title>
  <meta name="description" content="Industry-standard AI trading benchmark with 16-pillar scoring, forensic ledger, and strategy genomes."/>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#020617;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;min-height:100vh}
    .container{max-width:1200px;margin:0 auto;padding:20px}
    .header{text-align:center;padding:40px 0 20px}
    .header h1{font-size:36px;font-weight:800;background:linear-gradient(135deg,#3b82f6,#8b5cf6,#ec4899);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
    .badges{display:flex;gap:8px;justify-content:center;margin-top:12px;flex-wrap:wrap}
    .badge{display:inline-block;padding:4px 12px;border-radius:999px;font-size:12px;font-weight:600}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:20px 0}
    .card{background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:16px}
    .card h3{font-size:14px;color:#94a3b8;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px}
    .stat{font-size:28px;font-weight:700;color:#f1f5f9}
    .sub{font-size:12px;color:#64748b}
    @media(max-width:768px){.grid{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>MoltApp Benchmark v17</h1>
      <p style="color:#94a3b8;margin-top:8px">Industry-Standard AI Trading Intelligence Benchmark</p>
      <div class="badges">
        <span class="badge" style="background:#1e3a5f;color:#60a5fa">16 Pillars</span>
        <span class="badge" style="background:#3f1d5c;color:#c084fc">Forensic Ledger</span>
        <span class="badge" style="background:#1e3a2f;color:#86efac">Strategy Genomes</span>
        <span class="badge" style="background:#3f1d1d;color:#fca5a5">Live on Solana</span>
        <a href="https://huggingface.co/datasets/patruff/molt-benchmark" style="text-decoration:none"><span class="badge" style="background:#1a1a2e;color:#fbbf24">HuggingFace Dataset</span></a>
        <a href="https://www.patgpt.us" style="text-decoration:none"><span class="badge" style="background:#1a2e1a;color:#86efac">patgpt.us</span></a>
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <h3>Benchmark Health</h3>
        <div class="stat">${health.totalAgents} Agents</div>
        <div class="sub">${health.totalTrades} total trades | Data quality: ${(health.avgDataQuality * 100).toFixed(0)}%</div>
        <div class="sub">Uptime: ${Math.round(health.uptime / 60000)} min | ${health.warnings.length} warning(s)</div>
      </div>
      <div class="card">
        <h3>Forensic Ledger</h3>
        <div class="stat">${ledger.totalEntries} Entries</div>
        <div class="sub">Chain: ${integrity.intact ? "INTACT" : "BROKEN"} | Hash: ${ledger.lastEntryHash.slice(0, 12)}...</div>
        <div class="sub">${integrity.totalChecked} hashes verified</div>
      </div>
    </div>

    <h2 style="font-size:20px;margin:24px 0 12px;color:#f1f5f9">Agent Rankings</h2>
    ${agentCards || '<div style="color:#64748b;padding:20px;text-align:center">No agents scored yet. Run trading rounds to populate the benchmark.</div>'}

    <h2 style="font-size:20px;margin:24px 0 12px;color:#f1f5f9">Strategy Genomes</h2>
    <div class="card">
      ${genomeSection || '<div style="color:#64748b">Genome data populates as agents trade. Each agent develops a unique behavioral DNA profile.</div>'}
    </div>

    <h2 style="font-size:20px;margin:24px 0 12px;color:#f1f5f9">Live Event Feed</h2>
    <div class="card" style="max-height:300px;overflow-y:auto">
      ${eventFeed}
    </div>

    <div style="text-align:center;margin-top:40px;padding:20px;color:#64748b;font-size:12px">
      <p>MoltApp v17 — AI Trading Benchmark | <a href="/benchmark-v17/data" style="color:#3b82f6">API</a> | <a href="/benchmark-v17/stream" style="color:#3b82f6">Stream</a> | <a href="/benchmark-v17/export" style="color:#3b82f6">Export</a></p>
      <p style="margin-top:4px"><a href="https://huggingface.co/datasets/patruff/molt-benchmark" style="color:#fbbf24">HuggingFace Dataset</a> | <a href="https://www.patgpt.us" style="color:#86efac">patgpt.us</a></p>
    </div>
  </div>

  <script>
    // Auto-refresh data every 45 seconds
    setTimeout(() => location.reload(), 45000);
  </script>
</body>
</html>`;

  return c.html(html);
});
