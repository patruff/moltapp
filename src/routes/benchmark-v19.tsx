/**
 * Benchmark v19 Dashboard & Data Routes
 *
 * The 21-pillar AI Trading Benchmark dashboard — adds Benchmark Arbitration,
 * Cross-Agent Debates, and Trade Impact Forecasting to the v18 foundation.
 *
 * Routes:
 *   GET /              — HTML dashboard page
 *   GET /data          — JSON data payload for dashboard
 *   GET /stream        — SSE live event stream
 *   GET /export        — JSONL export for researchers
 */

import { Hono } from "hono";
import { round2 } from "../lib/math-utils.ts";
import {
  getV17Rankings,
  getV17Health,
  type AgentBenchmarkProfile,
} from "../services/benchmark-intelligence-gateway.ts";
import {
  getAllArbitrationProfiles,
  getArbitrationPillarScore,
  getRecentCases,
  getArbitrationStats,
} from "../services/benchmark-arbitration-engine.ts";
import {
  getAllDebateProfiles,
  getDebatePillarScore,
  getRecentDebates,
  getDebateStats,
} from "../services/cross-agent-debate-engine.ts";
import {
  getAllImpactProfiles,
  getImpactPillarScore,
  getImpactStats,
} from "../services/trade-impact-forecaster.ts";
import {
  getAdversarialPillarScore,
} from "../services/adversarial-robustness-engine.ts";
import {
  getMemoryPillarScore,
} from "../services/cross-session-memory-analyzer.ts";
import {
  getBenchmarkHealthPillarScore,
} from "../services/benchmark-regression-detector.ts";

export const benchmarkV19Routes = new Hono();

// ---------------------------------------------------------------------------
// SSE stream
// ---------------------------------------------------------------------------

interface V19Event {
  type: string;
  data: Record<string, unknown>;
  agentId?: string;
  timestamp: number;
}

const v19EventBuffer: V19Event[] = [];
const MAX_V19_EVENTS = 200;

export function emitV19Event(type: string, data: Record<string, unknown>, agentId?: string): void {
  v19EventBuffer.push({ type, data, agentId, timestamp: Date.now() });
  if (v19EventBuffer.length > MAX_V19_EVENTS) v19EventBuffer.splice(0, v19EventBuffer.length - MAX_V19_EVENTS);
}

// ---------------------------------------------------------------------------
// v19 Pillar Weights
// ---------------------------------------------------------------------------

const V19_WEIGHTS: Record<string, number> = {
  financial: 0.09, reasoning: 0.08, safety: 0.07, calibration: 0.06,
  patterns: 0.04, adaptability: 0.04, forensic_quality: 0.06,
  validation_quality: 0.06, prediction_accuracy: 0.05,
  reasoning_stability: 0.04, provenance_integrity: 0.05,
  model_comparison: 0.04, metacognition: 0.05, reasoning_efficiency: 0.03,
  forensic_ledger: 0.03, strategy_genome: 0.03,
  adversarial_robustness: 0.04, cross_session_memory: 0.04,
  arbitration_quality: 0.05, debate_performance: 0.05,
  impact_forecasting: 0.05,
};

// ---------------------------------------------------------------------------
// Data Route
// ---------------------------------------------------------------------------

benchmarkV19Routes.get("/data", (c) => {
  const v17Rankings = getV17Rankings();
  const arbProfiles = getAllArbitrationProfiles();
  const debateProfiles = getAllDebateProfiles();
  const impactProfiles = getAllImpactProfiles();
  const arbStats = getArbitrationStats();
  const debateStats = getDebateStats();
  const impactStats = getImpactStats();

  const agents = v17Rankings.length > 0
    ? v17Rankings
    : [
        { agentId: "claude-value-investor" },
        { agentId: "gpt-momentum-trader" },
        { agentId: "grok-contrarian" },
      ] as Array<{ agentId: string } & Partial<AgentBenchmarkProfile>>;

  const leaderboard = agents.map((r) => {
    const pillars: Record<string, number> = {};

    // Extract base pillars from v17 profile (array-based)
    if ("pillars" in r && Array.isArray(r.pillars)) {
      for (const p of r.pillars as Array<{ name: string; score: number }>) {
        pillars[p.name] = p.score;
      }
    }
    // Fill defaults for any missing pillars
    for (const key of Object.keys(V19_WEIGHTS)) {
      if (pillars[key] === undefined) pillars[key] = 0.5;
    }

    // v18 pillars
    pillars.adversarial_robustness = getAdversarialPillarScore(r.agentId);
    pillars.cross_session_memory = getMemoryPillarScore(r.agentId);

    // v19 NEW pillars
    pillars.arbitration_quality = getArbitrationPillarScore(r.agentId);
    pillars.debate_performance = getDebatePillarScore(r.agentId);
    pillars.impact_forecasting = getImpactPillarScore(r.agentId);

    let composite = 0;
    for (const [p, w] of Object.entries(V19_WEIGHTS)) {
      composite += (pillars[p] ?? 0.5) * w;
    }
    composite = round2(composite);

    const grade = composite >= 0.95 ? "A+"
      : composite >= 0.90 ? "A"
      : composite >= 0.85 ? "A-"
      : composite >= 0.80 ? "B+"
      : composite >= 0.75 ? "B"
      : composite >= 0.70 ? "B-"
      : composite >= 0.65 ? "C+"
      : composite >= 0.60 ? "C"
      : composite >= 0.55 ? "C-"
      : composite >= 0.50 ? "D+"
      : composite >= 0.45 ? "D"
      : composite >= 0.40 ? "D-"
      : "F";

    return {
      agentId: r.agentId,
      composite,
      grade,
      pillars,
      arbitration: arbProfiles.find(a => a.agentId === r.agentId),
      debate: debateProfiles.find(d => d.agentId === r.agentId),
      impact: impactProfiles.find(i => i.agentId === r.agentId),
    };
  });

  leaderboard.sort((a, b) => b.composite - a.composite);

  return c.json({
    ok: true,
    benchmark: "moltapp-v19",
    pillarCount: 21,
    leaderboard,
    recentArbitration: getRecentCases(5),
    recentDebates: getRecentDebates(5),
    stats: { arbitration: arbStats, debates: debateStats, impact: impactStats },
    weights: V19_WEIGHTS,
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// SSE Stream
// ---------------------------------------------------------------------------

benchmarkV19Routes.get("/stream", (c) => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let cursor = 0;
      const interval = setInterval(() => {
        try {
          while (cursor < v19EventBuffer.length) {
            const event = v19EventBuffer[cursor];
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
            );
            cursor++;
          }
        } catch {
          clearInterval(interval);
        }
      }, 2000);

      // Send initial heartbeat
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "heartbeat", benchmark: "v19", pillarCount: 21 })}\n\n`),
      );
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

benchmarkV19Routes.get("/export", (c) => {
  const v17Rankings = getV17Rankings();
  const agents = v17Rankings.length > 0
    ? v17Rankings
    : [
        { agentId: "claude-value-investor" },
        { agentId: "gpt-momentum-trader" },
        { agentId: "grok-contrarian" },
      ] as Array<{ agentId: string } & Partial<AgentBenchmarkProfile>>;

  const records = agents.map((r) => {
    const arb = getAllArbitrationProfiles().find(a => a.agentId === r.agentId);
    const debate = getAllDebateProfiles().find(d => d.agentId === r.agentId);
    const impact = getAllImpactProfiles().find(i => i.agentId === r.agentId);

    return JSON.stringify({
      agent_id: r.agentId,
      version: "v19",
      arbitration: arb ?? null,
      debate: debate ?? null,
      impact: impact ?? null,
      timestamp: new Date().toISOString(),
    });
  });

  c.header("Content-Type", "application/jsonl");
  return c.text(records.join("\n"));
});

// ---------------------------------------------------------------------------
// Dashboard HTML
// ---------------------------------------------------------------------------

benchmarkV19Routes.get("/", (c) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>MoltApp Benchmark v19 — 21-Pillar AI Trading Benchmark</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0f1c;color:#e0e6f0;min-height:100vh}
.header{background:linear-gradient(135deg,#0d1b2a 0%,#1b2838 100%);padding:32px 24px;text-align:center;border-bottom:2px solid #00d4aa}
.header h1{font-size:28px;color:#00d4aa;margin-bottom:4px}
.header .sub{color:#8892a4;font-size:14px}
.badge{display:inline-block;background:#1e3a5f;color:#00d4aa;padding:4px 12px;border-radius:12px;font-size:12px;margin:4px}
.badge.new{background:#00d4aa;color:#0a0f1c;font-weight:700}
.container{max-width:1200px;margin:0 auto;padding:20px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(350px,1fr));gap:16px;margin-top:16px}
.card{background:#111827;border:1px solid #1e293b;border-radius:12px;padding:20px}
.card h3{color:#00d4aa;margin-bottom:12px;font-size:16px}
.agent-row{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #1e293b}
.agent-row:last-child{border-bottom:none}
.agent-name{font-weight:600;font-size:14px}
.score{font-size:20px;font-weight:700}
.grade{display:inline-block;padding:2px 10px;border-radius:6px;font-weight:700;font-size:14px}
.grade.A{background:#00d4aa22;color:#00d4aa}
.grade.B{background:#3b82f622;color:#3b82f6}
.grade.C{background:#f59e0b22;color:#f59e0b}
.grade.D{background:#ef444422;color:#ef4444}
.grade.F{background:#dc262622;color:#dc2626}
.pillar-bar{display:flex;align-items:center;margin:4px 0;font-size:12px}
.pillar-bar .label{width:140px;color:#8892a4}
.pillar-bar .bar{flex:1;height:8px;background:#1e293b;border-radius:4px;overflow:hidden;margin:0 8px}
.pillar-bar .bar .fill{height:100%;border-radius:4px;transition:width .3s}
.pillar-bar .val{width:40px;text-align:right;color:#e0e6f0;font-weight:600}
.section-title{font-size:18px;color:#e0e6f0;margin:24px 0 8px;padding-bottom:8px;border-bottom:1px solid #1e293b}
.case-card{background:#0d1b2a;border:1px solid #1e293b;border-radius:8px;padding:12px;margin:8px 0;font-size:13px}
.case-card .ruling{color:#8892a4;margin-top:6px;font-style:italic}
.winner-tag{color:#00d4aa;font-weight:700}
.stats-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-top:12px}
.stat-box{background:#0d1b2a;border-radius:8px;padding:12px;text-align:center}
.stat-box .num{font-size:24px;font-weight:700;color:#00d4aa}
.stat-box .lbl{font-size:11px;color:#8892a4;margin-top:4px}
.footer{text-align:center;padding:24px;color:#4a5568;font-size:12px;border-top:1px solid #1e293b;margin-top:32px}
.hf-badge{display:inline-flex;align-items:center;gap:6px;background:#ffcc00;color:#000;padding:6px 14px;border-radius:8px;font-weight:700;font-size:13px;text-decoration:none;margin:8px}
.refresh{color:#4a5568;font-size:11px;margin-top:12px}
</style>
</head>
<body>
<div class="header">
  <h1>MoltApp Benchmark v19</h1>
  <div class="sub">21-Pillar AI Trading Benchmark — Industry Standard</div>
  <div style="margin-top:8px">
    <span class="badge new">NEW: Arbitration Engine</span>
    <span class="badge new">NEW: Debate Engine</span>
    <span class="badge new">NEW: Impact Forecaster</span>
    <span class="badge">21 Scoring Pillars</span>
    <span class="badge">Live on Solana</span>
  </div>
  <a href="https://huggingface.co/datasets/patruff/molt-benchmark" class="hf-badge" target="_blank">
    &#x1F917; HuggingFace Dataset
  </a>
</div>

<div class="container">
  <div class="section-title">Leaderboard</div>
  <div id="leaderboard">Loading...</div>

  <div class="section-title">v19 Pillar Scores</div>
  <div id="pillars">Loading...</div>

  <div class="section-title">Recent Arbitrations</div>
  <div id="arbitrations">Loading...</div>

  <div class="section-title">Recent Debates</div>
  <div id="debates">Loading...</div>

  <div class="section-title">Impact Forecasting Stats</div>
  <div id="impact-stats">Loading...</div>

  <div class="section-title">Benchmark Stats</div>
  <div id="stats">Loading...</div>

  <div class="refresh" id="refresh-time">Auto-refresh in 45s</div>
</div>

<div class="footer">
  MoltApp v19 — <a href="https://www.patgpt.us" style="color:#00d4aa">www.patgpt.us</a> — Colosseum Agent Hackathon 2026
  <br/>Data: <a href="/api/v1/benchmark-v19/scores" style="color:#3b82f6">API</a> |
  <a href="/api/v1/benchmark-v19/export/jsonl" style="color:#3b82f6">JSONL</a> |
  <a href="/api/v1/benchmark-v19/export/csv" style="color:#3b82f6">CSV</a> |
  <a href="/api/v1/benchmark-v19/schema" style="color:#3b82f6">Schema</a>
</div>

<script>
function gradeClass(g) {
  if (g.startsWith('A')) return 'A';
  if (g.startsWith('B')) return 'B';
  if (g.startsWith('C')) return 'C';
  if (g.startsWith('D')) return 'D';
  return 'F';
}

function barColor(v) {
  if (v >= 0.8) return '#00d4aa';
  if (v >= 0.6) return '#3b82f6';
  if (v >= 0.4) return '#f59e0b';
  return '#ef4444';
}

async function loadData() {
  try {
    const res = await fetch('/benchmark-v19/data');
    const d = await res.json();
    if (!d.ok) return;

    // Leaderboard
    let lb = '';
    for (const a of d.leaderboard) {
      lb += '<div class="agent-row">';
      lb += '<div><span class="agent-name">' + a.agentId + '</span></div>';
      lb += '<div><span class="score">' + a.composite.toFixed(2) + '</span> ';
      lb += '<span class="grade ' + gradeClass(a.grade) + '">' + a.grade + '</span></div>';
      lb += '</div>';
    }
    document.getElementById('leaderboard').innerHTML = lb || '<div style="color:#4a5568">No agents scored yet</div>';

    // Pillar scores
    let phtml = '<div class="grid">';
    for (const a of d.leaderboard) {
      phtml += '<div class="card"><h3>' + a.agentId + '</h3>';
      const pillarNames = Object.keys(d.weights);
      for (const p of pillarNames) {
        const v = a.pillars[p] ?? 0.5;
        const pct = Math.round(v * 100);
        const isNew = ['arbitration_quality','debate_performance','impact_forecasting'].includes(p);
        phtml += '<div class="pillar-bar">';
        phtml += '<span class="label">' + (isNew ? '&#x2728; ' : '') + p.replace(/_/g,' ') + '</span>';
        phtml += '<span class="bar"><span class="fill" style="width:'+pct+'%;background:'+barColor(v)+'"></span></span>';
        phtml += '<span class="val">' + v.toFixed(2) + '</span>';
        phtml += '</div>';
      }
      phtml += '</div>';
    }
    phtml += '</div>';
    document.getElementById('pillars').innerHTML = phtml;

    // Recent Arbitrations
    let arb = '';
    if (d.recentArbitration && d.recentArbitration.length > 0) {
      for (const c of d.recentArbitration) {
        arb += '<div class="case-card">';
        arb += '<strong>' + c.symbol + '</strong>: ';
        arb += c.agentA + ' (' + c.actionA + ') vs ' + c.agentB + ' (' + c.actionB + ')';
        if (c.winner !== 'tie') arb += ' — <span class="winner-tag">Winner: ' + c.winner + '</span>';
        else arb += ' — <em>Tie</em>';
        arb += ' (margin: ' + (c.margin * 100).toFixed(1) + '%)';
        arb += '<div class="ruling">' + c.ruling + '</div></div>';
      }
    } else {
      arb = '<div style="color:#4a5568">No arbitration cases yet. Run trading rounds to generate.</div>';
    }
    document.getElementById('arbitrations').innerHTML = arb;

    // Recent Debates
    let deb = '';
    if (d.recentDebates && d.recentDebates.length > 0) {
      for (const db of d.recentDebates) {
        deb += '<div class="case-card">';
        deb += '<strong>' + db.topic + '</strong>';
        if (db.verdict.winner !== 'tie') deb += ' — <span class="winner-tag">Winner: ' + db.verdict.winner + '</span>';
        else deb += ' — <em>Tie</em>';
        deb += ' | Quality: ' + db.debateQualityScore.toFixed(2);
        deb += ' | Clashes: ' + db.evidenceClashes.length;
        deb += '<div class="ruling">' + db.verdict.narrative + '</div></div>';
      }
    } else {
      deb = '<div style="color:#4a5568">No debates yet. Run trading rounds to generate.</div>';
    }
    document.getElementById('debates').innerHTML = deb;

    // Impact Stats
    let imp = '<div class="stats-grid">';
    imp += '<div class="stat-box"><div class="num">' + (d.stats.impact.totalForecasts || 0) + '</div><div class="lbl">Total Forecasts</div></div>';
    imp += '<div class="stat-box"><div class="num">' + (d.stats.impact.resolvedForecasts || 0) + '</div><div class="lbl">Resolved</div></div>';
    imp += '<div class="stat-box"><div class="num">' + ((d.stats.impact.overallDirectionAccuracy || 0) * 100).toFixed(0) + '%</div><div class="lbl">Direction Accuracy</div></div>';
    imp += '<div class="stat-box"><div class="num">' + (d.stats.impact.pendingForecasts || 0) + '</div><div class="lbl">Pending</div></div>';
    imp += '</div>';
    document.getElementById('impact-stats').innerHTML = imp;

    // Benchmark Stats
    let st = '<div class="stats-grid">';
    st += '<div class="stat-box"><div class="num">21</div><div class="lbl">Scoring Pillars</div></div>';
    st += '<div class="stat-box"><div class="num">' + (d.stats.arbitration.totalCases || 0) + '</div><div class="lbl">Arbitration Cases</div></div>';
    st += '<div class="stat-box"><div class="num">' + (d.stats.debates.totalDebates || 0) + '</div><div class="lbl">Debates Conducted</div></div>';
    st += '<div class="stat-box"><div class="num">' + (d.stats.debates.totalEvidenceClashes || 0) + '</div><div class="lbl">Evidence Clashes</div></div>';
    st += '<div class="stat-box"><div class="num">' + (d.stats.arbitration.disagreements || 0) + '</div><div class="lbl">Disagreements</div></div>';
    st += '<div class="stat-box"><div class="num">' + ((d.stats.arbitration.tieRate || 0) * 100).toFixed(0) + '%</div><div class="lbl">Tie Rate</div></div>';
    st += '</div>';
    document.getElementById('stats').innerHTML = st;

    document.getElementById('refresh-time').textContent = 'Last updated: ' + new Date().toLocaleTimeString() + ' — auto-refresh in 45s';
  } catch (e) {
    console.error('Failed to load v19 data:', e);
  }
}

loadData();
setInterval(loadData, 45000);
</script>
</body>
</html>`;

  return c.html(html);
});
