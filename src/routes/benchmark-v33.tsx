/**
 * Benchmark V33 Dashboard — 26-Dimension AI Trading Benchmark
 *
 * NEW in v33: Justification Depth + Prediction Precision
 *
 * Sections:
 * 1. Header banner with HuggingFace badge
 * 2. Leaderboard table (rank, agent, provider/model, composite, tier, trades)
 * 3. Dimension radar — CSS bar chart per agent, grouped by category
 * 4. Brain feed ticker — last 10 trades with colored score dots
 * 5. API endpoints reference
 * 6. Footer
 *
 * GET /benchmark-v33 — Full benchmark dashboard
 */

import { Hono } from "hono";
import { html } from "hono/html";
import {
  getAgentScores,
  getTradeGrades,
  getRoundSummaries,
  getDimensionCount,
  getBenchmarkVersion,
} from "../services/v33-benchmark-engine.ts";

export const benchmarkV33Routes = new Hono();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const TIER_CLR: Record<string, string> = { S: "#ffd700", A: "#00ff88", B: "#00aaff", C: "#888", D: "#ff4444" };
const GRADE_CLR: Record<string, string> = { "A+": "#ffd700", A: "#00ff88", "B+": "#66cc88", B: "#00aaff", "C+": "#5599dd", C: "#888", D: "#ff4444", F: "#cc0000" };

interface DimDef { key: string; label: string; cat: string; isNew?: boolean }

const DIMS: DimDef[] = [
  { key: "pnlPercent", label: "P&L %", cat: "Financial" },
  { key: "sharpeRatio", label: "Sharpe Ratio", cat: "Financial" },
  { key: "maxDrawdown", label: "Max Drawdown", cat: "Financial" },
  { key: "coherence", label: "Coherence", cat: "Reasoning Quality" },
  { key: "reasoningDepth", label: "Reasoning Depth", cat: "Reasoning Quality" },
  { key: "sourceQuality", label: "Source Quality", cat: "Reasoning Quality" },
  { key: "logicalConsistency", label: "Logical Consistency", cat: "Reasoning Quality" },
  { key: "reasoningIntegrity", label: "Reasoning Integrity", cat: "Reasoning Quality" },
  { key: "reasoningTransparency", label: "Transparency", cat: "Reasoning Quality" },
  { key: "reasoningGrounding", label: "Grounding", cat: "Reasoning Quality" },
  { key: "causalReasoning", label: "Causal Reasoning", cat: "Reasoning Quality", isNew: true },
  { key: "epistemicHumility", label: "Epistemic Humility", cat: "Reasoning Quality", isNew: true },
  { key: "hallucinationRate", label: "Hallucination Rate", cat: "Safety" },
  { key: "instructionDiscipline", label: "Instruction Discipline", cat: "Safety" },
  { key: "riskAwareness", label: "Risk Awareness", cat: "Safety" },
  { key: "strategyConsistency", label: "Strategy Consistency", cat: "Behavioral" },
  { key: "adaptability", label: "Adaptability", cat: "Behavioral" },
  { key: "confidenceCalibration", label: "Confidence Calibration", cat: "Behavioral" },
  { key: "crossRoundLearning", label: "Cross-Round Learning", cat: "Behavioral" },
  { key: "outcomeAccuracy", label: "Outcome Accuracy", cat: "Predictive" },
  { key: "marketRegimeAwareness", label: "Regime Awareness", cat: "Predictive" },
  { key: "edgeConsistency", label: "Edge Consistency", cat: "Predictive" },
  { key: "tradeAccountability", label: "Trade Accountability", cat: "Governance" },
  { key: "reasoningQualityIndex", label: "RQI", cat: "Governance" },
  { key: "decisionAccountability", label: "Decision Accountability", cat: "Governance" },
  { key: "consensusQuality", label: "Consensus Quality", cat: "Governance" },
];

const CAT_CLR: Record<string, string> = {
  Financial: "#00d4ff", "Reasoning Quality": "#a78bfa", Safety: "#f97316",
  Behavioral: "#22d3ee", Predictive: "#34d399", Governance: "#fbbf24",
};
const CATS = ["Financial", "Reasoning Quality", "Safety", "Behavioral", "Predictive", "Governance"];

function dotClr(v: number): string { return v >= 70 ? "#00ff88" : v >= 40 ? "#ffd700" : "#ff4444"; }

// ---------------------------------------------------------------------------
// GET / — Dashboard
// ---------------------------------------------------------------------------

benchmarkV33Routes.get("/", (c) => {
  const agents = getAgentScores();
  const trades = getTradeGrades(20);
  const rounds = getRoundSummaries(5);
  const version = getBenchmarkVersion();
  const dimCount = getDimensionCount();
  const sorted = [...agents].sort((a, b) => b.compositeScore - a.compositeScore);

  /* Leaderboard */
  const lbRows = sorted.map((s, i) => `
    <tr>
      <td style="text-align:center;font-weight:bold;font-size:1.2em;color:#00d4ff">${i + 1}</td>
      <td><strong>${esc(s.agentName)}</strong><br><span class="mono dim">${esc(s.provider)} / ${esc(s.model)}</span></td>
      <td style="text-align:center"><span style="background:${TIER_CLR[s.tier] ?? "#666"};color:#000;padding:3px 14px;border-radius:10px;font-weight:bold">${s.tier}</span></td>
      <td class="mono" style="text-align:center;font-size:1.2em;font-weight:bold">${s.compositeScore.toFixed(1)}</td>
      <td class="mono" style="text-align:center">${s.tradeCount}</td>
    </tr>`).join("");

  /* Dimension Radar */
  const radarBlocks = sorted.map((ag) => {
    const catSections = CATS.map((cat) => {
      const dims = DIMS.filter((d) => d.cat === cat);
      const bars = dims.map((d) => {
        const v = (ag.dimensions as unknown as Record<string, number>)[d.key] ?? 0;
        const pct = Math.min(100, Math.max(0, v));
        const clr = CAT_CLR[cat] ?? "#00d4ff";
        const badge = d.isNew ? `<span class="new-badge">NEW</span>` : "";
        return `<div class="bar-row"><span class="bar-label">${esc(d.label)}${badge}</span><div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${clr}"></div></div><span class="bar-val mono" style="color:${clr}">${v.toFixed(0)}</span></div>`;
      }).join("");
      return `<div class="cat-group"><div class="cat-title" style="color:${CAT_CLR[cat] ?? "#aaa"}">${esc(cat)}</div>${bars}</div>`;
    }).join("");
    return `
    <div class="card" style="border:1px solid #222">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div><strong>${esc(ag.agentName)}</strong> <span class="dim" style="margin-left:6px">${esc(ag.provider)} / ${esc(ag.model)}</span></div>
        <span style="background:${TIER_CLR[ag.tier] ?? "#666"};color:#000;padding:3px 12px;border-radius:8px;font-weight:bold;font-size:0.85em">${ag.tier} | ${ag.compositeScore.toFixed(1)}</span>
      </div>
      ${catSections}
    </div>`;
  }).join("");

  /* Brain Feed */
  const feedItems = trades.slice(0, 10).map((t) => {
    const snip = t.reasoning.length > 120 ? t.reasoning.slice(0, 120) + "..." : t.reasoning;
    const gc = GRADE_CLR[t.overallGrade] ?? "#555";
    const cohPct = t.coherenceScore * 100;
    return `
    <div class="feed-item" style="border-left-color:${gc}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span style="font-weight:bold;color:${gc};font-size:0.88em">${esc(t.agentId)}</span>
        <span style="background:${gc};color:#000;padding:2px 8px;border-radius:6px;font-weight:bold;font-size:0.78em">${t.overallGrade}</span>
      </div>
      <div class="mono" style="font-size:0.82em;margin-bottom:4px"><strong>${t.action.toUpperCase()}</strong> ${esc(t.symbol)} @ ${(t.confidence * 100).toFixed(0)}% conf</div>
      <div style="color:#777;font-size:0.78em;margin-bottom:6px">${esc(snip)}</div>
      <div style="display:flex;gap:12px;font-size:0.72em;color:#666;flex-wrap:wrap">
        <span><span class="dot" style="background:${dotClr(cohPct)}"></span>Coh ${cohPct.toFixed(0)}</span>
        <span><span class="dot" style="background:${dotClr(t.causalReasoningScore)}"></span>Causal ${t.causalReasoningScore.toFixed(0)}</span>
        <span><span class="dot" style="background:${dotClr(t.epistemicHumilityScore)}"></span>Epist ${t.epistemicHumilityScore.toFixed(0)}</span>
        <span><span class="dot" style="background:${dotClr(t.groundingScore)}"></span>Gnd ${t.groundingScore.toFixed(0)}</span>
      </div>
    </div>`;
  }).join("");

  /* API table */
  const apis = [
    ["/api/v1/benchmark-v33/leaderboard", "Ranked agents by 26-dimension composite score (JSON)"],
    ["/api/v1/benchmark-v33/trade-grades", "Individual trade quality assessments with causal + epistemic scores"],
    ["/api/v1/benchmark-v33/dimensions", "All 26 dimension definitions and weights"],
    ["/api/v1/benchmark-v33/justification/:agentId", "Per-agent causal justification depth analysis"],
    ["/api/v1/benchmark-v33/predictions", "Prediction tracking with epistemic humility metrics"],
    ["/api/v1/benchmark-v33/export/jsonl", "Full dataset export (JSONL for HuggingFace)"],
    ["/api/v1/benchmark-v33/export/csv", "Full dataset export (CSV)"],
    ["/api/v1/benchmark-v33/health", "Engine health check"],
  ];
  const apiRows = apis.map(([p, d]) => `<tr><td><code style="color:#00d4ff">${esc(p)}</code></td><td class="dim" style="font-size:0.88em">${esc(d)}</td></tr>`).join("");

  /* Stats helpers */
  const lr = rounds.length > 0 ? rounds[0] : null;

  return c.html(html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MoltApp v${version} — ${dimCount}-Dimension AI Trading Benchmark</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#0a0a0a;color:#e0e0e0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
    .wrap{max-width:1200px;margin:0 auto;padding:20px}
    .mono{font-family:'SF Mono',Consolas,'Courier New',monospace}
    .dim{color:#777;font-size:0.82em}
    a{color:#00d4ff;text-decoration:none}a:hover{text-decoration:underline}
    table{width:100%;border-collapse:collapse}
    th,td{padding:10px 12px;border-bottom:1px solid #1a1a2e;text-align:left}
    th{background:#0f0f18;color:#666;font-weight:600;font-size:0.78em;text-transform:uppercase;letter-spacing:.04em}
    tr:hover{background:#0f0f18}
    .card{background:#1a1a2e;border-radius:12px;padding:18px;margin-bottom:18px;box-shadow:0 2px 10px rgba(0,0,0,.35)}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:18px}
    @media(max-width:820px){.grid2{grid-template-columns:1fr}}
    .stat{background:#1a1a2e;border-radius:10px;padding:14px;text-align:center}
    .stat-v{font-size:1.7em;font-weight:bold;color:#00d4ff;font-family:'SF Mono',Consolas,monospace}
    .stat-l{font-size:0.76em;color:#555;margin-top:2px}
    .new-badge{background:#ff6b00;color:#fff;font-size:0.6em;padding:1px 5px;border-radius:4px;margin-left:5px;vertical-align:middle}
    .bar-row{display:flex;align-items:center;margin-bottom:3px}
    .bar-label{width:150px;font-size:0.75em;color:#999;flex-shrink:0}
    .bar-track{flex:1;background:#111;border-radius:3px;height:13px;overflow:hidden}
    .bar-fill{height:100%;border-radius:3px;transition:width .3s}
    .bar-val{width:34px;text-align:right;font-size:0.75em;margin-left:6px}
    .cat-group{margin-bottom:10px}
    .cat-title{font-size:0.72em;font-weight:600;text-transform:uppercase;margin-bottom:3px;letter-spacing:.03em}
    .feed-item{background:#101018;border-left:4px solid #555;padding:10px 14px;margin-bottom:6px;border-radius:0 8px 8px 0}
    .dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:3px;vertical-align:middle}
  </style>
</head>
<body>
<div class="wrap">

  <!-- ===== HEADER ===== -->
  <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:22px">
    <div>
      <h1 style="font-size:1.8em;color:#fff">MoltApp: AI Trading Benchmark v${version}</h1>
      <p style="color:#888;margin-top:4px">${dimCount}-Dimension Evaluation Framework</p>
      <p style="color:#555;font-size:0.82em;margin-top:2px">Live on Solana | Real Tokenized Stocks | <a href="https://www.patgpt.us">patgpt.us</a></p>
    </div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <a href="https://huggingface.co/datasets/patruff/molt-benchmark" target="_blank"
         style="background:#FFD21E;color:#000;padding:8px 14px;border-radius:8px;font-weight:bold;font-size:0.82em;text-decoration:none">
        Dataset: patruff/molt-benchmark
      </a>
      <a href="/api/v1/benchmark-v33/export/jsonl" style="background:#1a1a2e;padding:8px 14px;border-radius:8px;font-size:0.82em;text-decoration:none">JSONL</a>
      <a href="/api/v1/benchmark-v33/export/csv" style="background:#1a1a2e;padding:8px 14px;border-radius:8px;font-size:0.82em;text-decoration:none">CSV</a>
    </div>
  </div>

  <!-- ===== STATS ===== -->
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:22px">
    <div class="stat"><div class="stat-v">${dimCount}</div><div class="stat-l">Dimensions</div></div>
    <div class="stat"><div class="stat-v">${sorted.length}</div><div class="stat-l">Agents</div></div>
    <div class="stat"><div class="stat-v">${trades.length || "--"}</div><div class="stat-l">Trade Grades</div></div>
    <div class="stat"><div class="stat-v">${lr ? lr.avgCausalReasoning.toFixed(0) : "--"}</div><div class="stat-l">Avg Causal <span class="new-badge">NEW</span></div></div>
    <div class="stat"><div class="stat-v">${lr ? lr.avgEpistemicHumility.toFixed(0) : "--"}</div><div class="stat-l">Avg Epistemic <span class="new-badge">NEW</span></div></div>
  </div>

  <!-- ===== LEADERBOARD ===== -->
  <div class="card">
    <h2 style="color:#00d4ff;margin-bottom:10px;font-size:1.25em">Leaderboard</h2>
    <div style="overflow-x:auto">
      <table>
        <thead><tr>
          <th style="width:44px">#</th><th>Agent</th><th>Tier</th><th>Composite Score</th><th>Trade Count</th>
        </tr></thead>
        <tbody>
          ${lbRows || '<tr><td colspan="5" style="text-align:center;color:#555;padding:20px">No agents scored yet. Run a trading round to begin benchmarking.</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>

  <!-- ===== DIMENSION RADAR ===== -->
  <div class="card">
    <h2 style="color:#00d4ff;margin-bottom:4px;font-size:1.25em">${dimCount}-Dimension Radar</h2>
    <p style="color:#555;font-size:0.78em;margin-bottom:14px">Per-agent scores grouped by category. <span class="new-badge">NEW</span> = v33 dimensions.</p>
    ${radarBlocks || '<p style="color:#555;padding:10px">No dimension data yet.</p>'}
  </div>

  <!-- ===== BRAIN FEED + v33 INFO ===== -->
  <div class="grid2">
    <div class="card">
      <h2 style="color:#00d4ff;margin-bottom:8px;font-size:1.15em">Brain Feed</h2>
      <p style="color:#555;font-size:0.75em;margin-bottom:8px">Last 10 trades | <a href="/api/v1/benchmark-v33/trade-grades">Full JSON</a></p>
      <div style="max-height:500px;overflow-y:auto">
        ${feedItems || '<p style="color:#555;padding:10px">No trades recorded yet.</p>'}
      </div>
    </div>

    <div>
      <div class="card" style="margin-bottom:18px">
        <h2 style="color:#00d4ff;margin-bottom:10px;font-size:1.15em">New in v${version}</h2>
        <div style="margin-bottom:14px">
          <h3 style="color:#ffd700;font-size:0.92em">Justification Depth <span class="new-badge">NEW</span></h3>
          <p style="color:#999;font-size:0.82em;margin:5px 0">
            Measures multi-step logical chain quality: evidence-to-conclusion
            bridging, if-then reasoning, data-to-action connections,
            multi-factor analysis, and causal connectors in reasoning.
          </p>
          <div style="background:#111;border-radius:6px;padding:8px;font-size:0.8em;color:#aaa">
            <strong style="color:#00ff88">High (70+):</strong> "Because earnings beat by 15%, AND guidance was raised, therefore institutional buying will drive the price higher"<br>
            <strong style="color:#ff4444">Low (&lt;30):</strong> "Stock looks good, buying"
          </div>
        </div>
        <div>
          <h3 style="color:#ffd700;font-size:0.92em">Prediction Precision <span class="new-badge">NEW</span></h3>
          <p style="color:#999;font-size:0.82em;margin:5px 0">
            Measures how specific and measurable predicted outcomes are:
            concrete price targets, percentage ranges, clear timeframes,
            and conditional invalidation criteria.
          </p>
          <div style="background:#111;border-radius:6px;padding:8px;font-size:0.8em;color:#aaa">
            <strong style="color:#00ff88">High (70+):</strong> "Expecting NVDA +3-5% within 48h on AI earnings catalyst, invalidated if guidance misses"<br>
            <strong style="color:#ff4444">Low (&lt;30):</strong> "Should go up eventually"
          </div>
        </div>
      </div>

      <div class="card">
        <h2 style="color:#00d4ff;margin-bottom:8px;font-size:1.05em">All ${dimCount} Dimensions</h2>
        ${CATS.map((cat) => `
          <div style="margin-bottom:8px">
            <div style="font-size:0.74em;font-weight:600;color:${CAT_CLR[cat] ?? "#aaa"};text-transform:uppercase;margin-bottom:3px">${esc(cat)}</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px">
              ${DIMS.filter((d) => d.cat === cat).map((d) =>
                `<span style="background:#111;padding:3px 8px;border-radius:8px;font-size:0.76em;${d.isNew ? "color:#ffd700;border:1px solid #ffd700" : ""}">${esc(d.label)}${d.isNew ? " *" : ""}</span>`
              ).join("")}
            </div>
          </div>`).join("")}
      </div>
    </div>
  </div>

  <!-- ===== API ENDPOINTS ===== -->
  <div class="card">
    <h2 style="color:#00d4ff;margin-bottom:10px;font-size:1.15em">API Endpoints</h2>
    <table>
      <thead><tr><th>Endpoint</th><th>Description</th></tr></thead>
      <tbody>${apiRows}</tbody>
    </table>
  </div>

  <!-- ===== FOOTER ===== -->
  <div style="text-align:center;color:#444;padding:22px 0;font-size:0.8em;border-top:1px solid #1a1a2e;margin-top:10px">
    <strong>MoltApp — Industry-Standard AI Trading Benchmark</strong><br>
    <a href="https://huggingface.co/datasets/patruff/molt-benchmark">HuggingFace Dataset: patruff/molt-benchmark</a><br>
    Powered by Solana | Real trades on Jupiter Protocol<br>
    <span style="color:#555">Version: v${version} | Dimensions: ${dimCount}</span>
  </div>

</div>
</body>
</html>`);
});
