/**
 * Benchmark v18 Dashboard & Data Routes
 *
 * The 18-pillar AI Trading Benchmark dashboard — adds Adversarial Robustness,
 * Cross-Session Memory, and Benchmark Regression Detection to the v17 foundation.
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
  type AgentBenchmarkProfile,
} from "../services/benchmark-intelligence-gateway.ts";
import {
  getAllRobustnessProfiles,
  getAdversarialPillarScore,
} from "../services/adversarial-robustness-engine.ts";
import { round3 } from "../lib/math-utils.ts";
import {
  getAllMemoryProfiles,
  getMemoryPillarScore,
} from "../services/cross-session-memory-analyzer.ts";
import {
  getBenchmarkHealthReport,
  getActiveAlerts,
  getBenchmarkHealthPillarScore,
} from "../services/benchmark-regression-detector.ts";
import {
  getLedgerStats,
} from "../services/trade-forensic-ledger.ts";

export const benchmarkV18Routes = new Hono();

// ---------------------------------------------------------------------------
// SSE stream
// ---------------------------------------------------------------------------

interface V18Event {
  type: string;
  data: Record<string, unknown>;
  agentId?: string;
  timestamp: number;
}

const v18EventBuffer: V18Event[] = [];
const MAX_V18_EVENTS = 200;

export function emitV18Event(type: string, data: Record<string, unknown>, agentId?: string): void {
  v18EventBuffer.push({ type, data, agentId, timestamp: Date.now() });
  if (v18EventBuffer.length > MAX_V18_EVENTS) v18EventBuffer.splice(0, v18EventBuffer.length - MAX_V18_EVENTS);
}

// ---------------------------------------------------------------------------
// v18 Pillar Weights
// ---------------------------------------------------------------------------

const V18_WEIGHTS: Record<string, number> = {
  financial: 0.10, reasoning: 0.09, safety: 0.08, calibration: 0.07,
  patterns: 0.04, adaptability: 0.05, forensic_quality: 0.06,
  validation_quality: 0.07, prediction_accuracy: 0.05,
  reasoning_stability: 0.05, provenance_integrity: 0.05,
  model_comparison: 0.04, metacognition: 0.05, reasoning_efficiency: 0.04,
  forensic_ledger: 0.03, strategy_genome: 0.03,
  adversarial_robustness: 0.05, cross_session_memory: 0.05,
};

// ---------------------------------------------------------------------------
// Data Route
// ---------------------------------------------------------------------------

benchmarkV18Routes.get("/data", (c) => {
  const v17Rankings = getV17Rankings();
  const robustnessProfiles = getAllRobustnessProfiles();
  const memoryProfiles = getAllMemoryProfiles();
  const healthReport = getBenchmarkHealthReport();
  const alerts = getActiveAlerts();
  const ledgerStats = getLedgerStats();

  const leaderboard = v17Rankings.map((agent) => {
    const robustness = robustnessProfiles.find((r) => r.agentId === agent.agentId);
    const memory = memoryProfiles.find((m) => m.agentId === agent.agentId);

    const pillars = extractPillars(agent);
    pillars.adversarial_robustness = robustness?.overallScore ?? 0.5;
    pillars.cross_session_memory = memory?.memoryScore ?? 0.5;

    const composite = computeComposite(pillars);
    return {
      agentId: agent.agentId,
      provider: agent.provider,
      model: agent.model,
      composite,
      grade: gradeFromScore(composite),
      elo: agent.eloRating,
      tradeCount: agent.tradeCount,
      pillars,
      robustnessTrend: robustness?.trend ?? "stable",
      memoryTrend: memory?.trend ?? "stable",
      memoryStrengths: memory?.memoryStrengths ?? [],
      memoryWeaknesses: memory?.memoryWeaknesses ?? [],
      topVulnerabilities: robustness?.topVulnerabilities ?? [],
    };
  });

  leaderboard.sort((a, b) => b.composite - a.composite);

  return c.json({
    ok: true,
    version: "v18",
    pillars: 18,
    leaderboard,
    benchmarkHealth: {
      status: healthReport.status,
      overallHealth: healthReport.overallHealth,
      dimensions: healthReport.dimensions,
      activeAlertCount: alerts.length,
      recommendations: healthReport.recommendations,
    },
    ledger: {
      totalEntries: ledgerStats.totalEntries,
      chainIntact: ledgerStats.chainIntact,
      resolvedOutcomes: Object.values(ledgerStats.agentBreakdown).reduce((s, a) => s + Math.round(a.entries * a.outcomeResolvedRate), 0),
    },
    pillarWeights: V18_WEIGHTS,
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// SSE Stream
// ---------------------------------------------------------------------------

benchmarkV18Routes.get("/stream", (c) => {
  const lastId = parseInt(c.req.query("lastId") ?? "0", 10);
  const events = v18EventBuffer.filter((e) => e.timestamp > lastId);
  const sseData = events
    .map((e) => `data: ${JSON.stringify({ type: e.type, ...e.data, agentId: e.agentId, ts: e.timestamp })}\n`)
    .join("\n");

  return new Response(`${sseData}\n`, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

// ---------------------------------------------------------------------------
// JSONL Export
// ---------------------------------------------------------------------------

benchmarkV18Routes.get("/export", (c) => {
  const v17Export = exportV17Benchmark();
  const robustnessProfiles = getAllRobustnessProfiles();
  const memoryProfiles = getAllMemoryProfiles();
  const healthReport = getBenchmarkHealthReport();

  const records = v17Export.agents.map((entry: AgentBenchmarkProfile) => {
    const robustness = robustnessProfiles.find((r) => r.agentId === entry.agentId);
    const memory = memoryProfiles.find((m) => m.agentId === entry.agentId);
    return {
      ...entry,
      v18_adversarial_robustness: robustness?.overallScore ?? null,
      v18_adversarial_vulnerabilities: robustness?.topVulnerabilities ?? [],
      v18_memory_score: memory?.memoryScore ?? null,
      v18_memory_dimensions: memory?.dimensions ?? null,
      v18_repeated_mistakes: memory?.repeatedMistakes.length ?? 0,
      v18_benchmark_health: healthReport.overallHealth,
      v18_benchmark_status: healthReport.status,
    };
  });

  const jsonl = records.map((r: Record<string, unknown>) => JSON.stringify(r)).join("\n");
  return new Response(jsonl, {
    headers: {
      "Content-Type": "application/jsonl",
      "Content-Disposition": `attachment; filename="moltapp-v18-benchmark-${new Date().toISOString().split("T")[0]}.jsonl"`,
    },
  });
});

// ---------------------------------------------------------------------------
// Dashboard HTML
// ---------------------------------------------------------------------------

benchmarkV18Routes.get("/", (c) => {
  const html = renderDashboard();
  return c.html(html);
});

function renderDashboard(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MoltApp Benchmark v18 — 18-Pillar AI Trading Benchmark</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0a0e17;color:#e0e0e0;min-height:100vh}
.container{max-width:1400px;margin:0 auto;padding:20px}
header{text-align:center;padding:30px 0;border-bottom:1px solid #1a2035}
h1{font-size:2.2rem;background:linear-gradient(135deg,#00d4ff,#7c3aed,#ff6b6b);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:8px}
.subtitle{color:#8892a4;font-size:1.1rem}
.badge-row{display:flex;gap:10px;justify-content:center;margin-top:12px;flex-wrap:wrap}
.badge{display:inline-flex;align-items:center;gap:5px;padding:4px 12px;border-radius:20px;font-size:0.8rem;font-weight:600}
.badge-hf{background:#1a1a2e;color:#ffcc00;border:1px solid #ffcc0044}
.badge-pillars{background:#1a1a2e;color:#00d4ff;border:1px solid #00d4ff44}
.badge-new{background:#1a1a2e;color:#ff6b6b;border:1px solid #ff6b6b44}
.badge-health{background:#1a1a2e;border:1px solid #4ade8044;color:#4ade80}
.badge-health.warning{color:#f59e0b;border-color:#f59e0b44}
.badge-health.degraded{color:#f87171;border-color:#f8717144}
.grid{display:grid;gap:20px;margin-top:24px}
.grid-3{grid-template-columns:repeat(auto-fit,minmax(380px,1fr))}
.card{background:#111827;border:1px solid #1f2937;border-radius:12px;padding:20px;transition:border-color 0.2s}
.card:hover{border-color:#374151}
.card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.card-title{font-size:1.1rem;font-weight:600}
.grade{font-size:1.4rem;font-weight:800;padding:4px 12px;border-radius:8px}
.grade-a{background:#059669;color:white}
.grade-b{background:#2563eb;color:white}
.grade-c{background:#d97706;color:white}
.grade-d{background:#dc2626;color:white}
.grade-f{background:#7f1d1d;color:white}
.agent-meta{color:#6b7280;font-size:0.85rem;margin-bottom:12px}
.pillar-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.pillar{padding:6px 8px;background:#1a2035;border-radius:6px;font-size:0.75rem}
.pillar-name{color:#8892a4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pillar-score{font-weight:700;margin-top:2px}
.score-high{color:#4ade80}
.score-mid{color:#fbbf24}
.score-low{color:#f87171}
.composite-bar{height:6px;background:#1f2937;border-radius:3px;margin-top:8px;overflow:hidden}
.composite-fill{height:100%;border-radius:3px;transition:width 0.5s}
.section-title{font-size:1.3rem;font-weight:700;margin:28px 0 12px;padding-left:8px;border-left:3px solid #7c3aed}
.health-card{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-top:12px}
.health-metric{background:#1a2035;border-radius:8px;padding:14px;text-align:center}
.health-value{font-size:1.5rem;font-weight:800}
.health-label{color:#6b7280;font-size:0.8rem;margin-top:4px}
.alert-list{margin-top:12px}
.alert{padding:10px 14px;border-radius:8px;margin-bottom:8px;font-size:0.85rem;border-left:3px solid}
.alert-high{background:#7f1d1d22;border-color:#f87171}
.alert-medium{background:#78350f22;border-color:#fbbf24}
.alert-low{background:#1a2035;border-color:#6b7280}
footer{text-align:center;padding:30px 0;color:#4b5563;font-size:0.85rem;margin-top:40px;border-top:1px solid #1a2035}
footer a{color:#7c3aed;text-decoration:none}
.new-badge{display:inline-block;background:#ff6b6b;color:white;font-size:0.65rem;padding:1px 5px;border-radius:3px;margin-left:4px;font-weight:700;vertical-align:middle}
</style>
</head>
<body>
<div class="container">
<header>
  <h1>MoltApp Benchmark v18</h1>
  <div class="subtitle">Industry-Standard AI Trading Benchmark — 18-Pillar Scoring</div>
  <div class="badge-row">
    <span class="badge badge-hf">&#129303; HuggingFace: patruff/molt-benchmark</span>
    <span class="badge badge-pillars">18 Scoring Pillars</span>
    <span class="badge badge-new">v18: Adversarial + Memory + Regression</span>
    <span class="badge badge-health" id="health-badge">&#9679; Loading...</span>
  </div>
</header>

<div class="section-title">Agent Leaderboard</div>
<div class="grid grid-3" id="leaderboard">
  <div class="card"><div class="card-title">Loading agent data...</div></div>
</div>

<div class="section-title">Benchmark Health Monitor<span class="new-badge">NEW</span></div>
<div class="health-card" id="health-metrics">
  <div class="health-metric"><div class="health-value">—</div><div class="health-label">Overall Health</div></div>
  <div class="health-metric"><div class="health-value">—</div><div class="health-label">Scoring Stability</div></div>
  <div class="health-metric"><div class="health-value">—</div><div class="health-label">Agent Diversity</div></div>
  <div class="health-metric"><div class="health-value">—</div><div class="health-label">Data Freshness</div></div>
  <div class="health-metric"><div class="health-value">—</div><div class="health-label">Calibration</div></div>
</div>

<div class="section-title">Regression Alerts</div>
<div class="alert-list" id="alerts">
  <div class="alert alert-low">No active alerts — benchmark operating normally.</div>
</div>

<footer>
  <p>MoltApp AI Trading Benchmark v18 — <a href="https://www.patgpt.us">www.patgpt.us</a></p>
  <p style="margin-top:6px">Dataset: <a href="https://huggingface.co/datasets/patruff/molt-benchmark">patruff/molt-benchmark</a> | API: <a href="/api/v1/benchmark-v18/schema">/api/v1/benchmark-v18/schema</a></p>
</footer>
</div>

<script>
async function loadData() {
  try {
    const res = await fetch('/benchmark-v18/data');
    const data = await res.json();
    if (!data.ok) return;
    renderLeaderboard(data.leaderboard);
    renderHealth(data.benchmarkHealth);
    updateHealthBadge(data.benchmarkHealth.status);
  } catch (e) { console.error('Failed to load data:', e); }
}

function renderLeaderboard(agents) {
  const el = document.getElementById('leaderboard');
  if (!agents || agents.length === 0) {
    el.innerHTML = '<div class="card"><div class="card-title">No agent data yet — run a trading round!</div></div>';
    return;
  }
  el.innerHTML = agents.map((a, i) => {
    const gc = a.grade.startsWith('A') ? 'grade-a' : a.grade.startsWith('B') ? 'grade-b' : a.grade.startsWith('C') ? 'grade-c' : a.grade.startsWith('D') ? 'grade-d' : 'grade-f';
    const pillars = Object.entries(a.pillars).map(([name, score]) => {
      const sc = score >= 0.7 ? 'score-high' : score >= 0.5 ? 'score-mid' : 'score-low';
      const label = name.replace(/_/g, ' ').replace(/\\b\\w/g, c => c.toUpperCase());
      const isNew = name === 'adversarial_robustness' || name === 'cross_session_memory';
      return '<div class="pillar"><div class="pillar-name">' + label + (isNew ? '<span class="new-badge">NEW</span>' : '') + '</div><div class="pillar-score ' + sc + '">' + (score * 100).toFixed(1) + '%</div></div>';
    }).join('');
    const barColor = a.composite >= 0.7 ? '#4ade80' : a.composite >= 0.5 ? '#fbbf24' : '#f87171';
    return '<div class="card"><div class="card-header"><div class="card-title">#' + (i + 1) + ' ' + a.agentId + '</div><div class="grade ' + gc + '">' + a.grade + '</div></div><div class="agent-meta">' + a.provider + ' / ' + a.model + ' | Elo: ' + a.elo + ' | Trades: ' + a.tradeCount + ' | Composite: ' + (a.composite * 100).toFixed(1) + '%</div><div class="composite-bar"><div class="composite-fill" style="width:' + (a.composite * 100) + '%;background:' + barColor + '"></div></div><div class="pillar-grid" style="margin-top:12px">' + pillars + '</div></div>';
  }).join('');
}

function renderHealth(h) {
  const el = document.getElementById('health-metrics');
  const dims = h.dimensions || {};
  const sc = v => v >= 0.7 ? 'score-high' : v >= 0.5 ? 'score-mid' : 'score-low';
  el.innerHTML = [
    ['Overall Health', h.overallHealth],
    ['Scoring Stability', dims.scoringStability],
    ['Agent Diversity', dims.agentDiversity],
    ['Data Freshness', dims.dataFreshness],
    ['Calibration', dims.calibrationQuality],
  ].map(([label, val]) => '<div class="health-metric"><div class="health-value ' + sc(val || 0) + '">' + ((val || 0) * 100).toFixed(0) + '%</div><div class="health-label">' + label + '</div></div>').join('');

  const alertEl = document.getElementById('alerts');
  if (h.activeAlertCount > 0 && h.recommendations) {
    alertEl.innerHTML = h.recommendations.map(r => '<div class="alert alert-medium">' + r + '</div>').join('');
  }
}

function updateHealthBadge(status) {
  const badge = document.getElementById('health-badge');
  const cls = status === 'healthy' ? '' : status === 'warning' ? 'warning' : 'degraded';
  badge.className = 'badge badge-health ' + cls;
  badge.textContent = '\\u25CF ' + status.charAt(0).toUpperCase() + status.slice(1);
}

loadData();
setInterval(loadData, 45000);
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractPillars(agent: AgentBenchmarkProfile): Record<string, number> {
  const map: Record<string, number> = {};
  for (const p of agent.pillars) {
    map[p.name] = p.score;
  }
  return map;
}

function computeComposite(pillars: Record<string, number>): number {
  let score = 0;
  let total = 0;
  for (const [name, weight] of Object.entries(V18_WEIGHTS)) {
    score += (pillars[name] ?? 0.5) * weight;
    total += weight;
  }
  return total > 0 ? round3(score / total) : 0.5;
}

function gradeFromScore(s: number): string {
  if (s >= 0.95) return "A+";
  if (s >= 0.90) return "A";
  if (s >= 0.85) return "A-";
  if (s >= 0.80) return "B+";
  if (s >= 0.75) return "B";
  if (s >= 0.70) return "B-";
  if (s >= 0.65) return "C+";
  if (s >= 0.60) return "C";
  if (s >= 0.55) return "C-";
  if (s >= 0.50) return "D+";
  if (s >= 0.45) return "D";
  if (s >= 0.40) return "D-";
  return "F";
}
