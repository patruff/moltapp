/**
 * Benchmark v15 Dashboard — 12-Pillar Scoring with Provenance & Reproducibility
 *
 * The industry-standard AI trading benchmark dashboard.
 * v15 adds two new pillars: Provenance Integrity and Model Comparison —
 * cryptographic proof of reasoning authenticity and cross-model fingerprinting.
 *
 * Routes:
 * - GET /benchmark-v15           — 12-Pillar dashboard HTML
 * - GET /benchmark-v15/data      — JSON data for the dashboard
 * - GET /benchmark-v15/stream    — SSE live event stream
 */

import { Hono } from "hono";
import { getProvenanceStats } from "../services/reasoning-provenance-engine.ts";
import {
  getCrossModelStats,
  getModelDivergenceReport,
  computeModelFingerprint,
} from "../services/cross-model-comparator.ts";
import { getReproducibilityReport } from "../services/benchmark-reproducibility-prover.ts";

export const benchmarkV15Routes = new Hono();

// ---------------------------------------------------------------------------
// Per-agent v15 composite metrics (fed by orchestrator)
// ---------------------------------------------------------------------------

interface V15AgentMetrics {
  financial: number;
  reasoning: number;
  safety: number;
  calibration: number;
  patterns: number;
  adaptability: number;
  forensicQuality: number;
  validationQuality: number;
  predictionAccuracy: number;
  reasoningStability: number;
  provenanceIntegrity: number;
  modelComparison: number;
  composite: number;
  grade: string;
  tradeCount: number;
  lastUpdated: string;
}

const v15AgentMetrics: Map<string, V15AgentMetrics> = new Map();
const AGENT_IDS = ["claude-value-investor", "gpt-momentum-trader", "grok-contrarian"];

/**
 * Record composite metrics for an agent (called by orchestrator).
 */
export function recordV15AgentMetrics(
  agentId: string,
  metrics: V15AgentMetrics,
): void {
  v15AgentMetrics.set(agentId, metrics);
  emitV15Event("metrics_updated", { agentId, composite: metrics.composite, grade: metrics.grade }, agentId);
}

/**
 * Retrieve composite metrics for a single agent, or null if none recorded.
 */
export function getV15AgentMetrics(agentId: string): V15AgentMetrics | null {
  return v15AgentMetrics.get(agentId) ?? null;
}

// ---------------------------------------------------------------------------
// SSE Event Stream
// ---------------------------------------------------------------------------

const v15Listeners: Set<(data: string) => void> = new Set();
const v15Controllers: Set<ReadableStreamDefaultController> = new Set();

export function emitV15Event(
  type: string,
  data: Record<string, unknown>,
  agentId?: string,
): void {
  const event = {
    type,
    agentId: agentId ?? null,
    timestamp: new Date().toISOString(),
    ...data,
  };
  const payload = `data: ${JSON.stringify(event)}\n\n`;

  for (const listener of v15Listeners) {
    try { listener(payload); } catch { v15Listeners.delete(listener); }
  }
  for (const controller of v15Controllers) {
    try {
      controller.enqueue(new TextEncoder().encode(payload));
    } catch {
      v15Controllers.delete(controller);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildLeaderboard(): (V15AgentMetrics & { agentId: string })[] {
  const entries: (V15AgentMetrics & { agentId: string })[] = [];
  for (const agentId of AGENT_IDS) {
    const metrics = v15AgentMetrics.get(agentId) ?? defaultMetrics();
    entries.push({ agentId, ...metrics });
  }
  entries.sort((a, b) => b.composite - a.composite);
  return entries;
}

function defaultMetrics(): V15AgentMetrics {
  return {
    financial: 0.5, reasoning: 0.5, safety: 0.5, calibration: 0.5,
    patterns: 0.5, adaptability: 0.5, forensicQuality: 0.5,
    validationQuality: 0.5, predictionAccuracy: 0.5, reasoningStability: 0.5,
    provenanceIntegrity: 0.5, modelComparison: 0.5,
    composite: 0.5, grade: "C", tradeCount: 0,
    lastUpdated: new Date().toISOString(),
  };
}

function formatPillarScore(
  leaderboard: (V15AgentMetrics & { agentId: string })[],
  key: keyof V15AgentMetrics,
): string {
  if (leaderboard.length === 0) return "\u2014";
  const avg = leaderboard.reduce((s, a) => s + (Number(a[key]) || 0), 0) / leaderboard.length;
  return `${(avg * 100).toFixed(0)}%`;
}

function formatAgentName(agentId: string): string {
  if (agentId.includes("claude")) return "Claude ValueBot";
  if (agentId.includes("gpt")) return "GPT MomentumAI";
  if (agentId.includes("grok")) return "Grok Contrarian";
  return agentId;
}

function gradeClass(grade: string): string {
  if (grade.startsWith("A")) return "grade-a";
  if (grade.startsWith("B")) return "grade-b";
  if (grade.startsWith("C")) return "grade-c";
  if (grade.startsWith("D")) return "grade-d";
  return "grade-f";
}

function esc(s: string | number | null | undefined): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /benchmark-v15 — 12-Pillar Benchmark Dashboard
 */
benchmarkV15Routes.get("/", (c) => {
  const leaderboard = buildLeaderboard();
  const provenanceStats = getProvenanceStats();
  const crossModelStats = getCrossModelStats();
  const divergenceReport = getModelDivergenceReport();
  const reproducibilityReport = getReproducibilityReport();

  // Build fingerprints for each agent
  const fingerprints = AGENT_IDS.map((id) => ({
    agentId: id,
    fingerprint: computeModelFingerprint(id),
  }));

  const chainIntegrityRows = Object.entries(provenanceStats.chainIntegrity)
    .map(([agent, valid]) => `
      <tr>
        <td>${esc(formatAgentName(agent))}</td>
        <td style="color:${valid ? "#00e676" : "#ff5252"};">${valid ? "VALID" : "BROKEN"}</td>
      </tr>`)
    .join("");

  const fingerprintCards = fingerprints.map(({ agentId, fingerprint }) => {
    if (!fingerprint) {
      return `<div class="card" style="flex:1;min-width:250px;">
        <h3 style="font-size:0.85rem;color:#aaa;">${esc(formatAgentName(agentId))}</h3>
        <p style="color:#666;font-size:0.8rem;">No data yet</p>
      </div>`;
    }
    return `<div class="card" style="flex:1;min-width:250px;">
      <h3 style="font-size:0.85rem;color:#aaa;margin-bottom:0.5rem;">${esc(formatAgentName(agentId))}</h3>
      <div class="stat-row"><span class="label">Bullish Rate</span><span class="value">${(fingerprint.sentimentTendency.bullishRate * 100).toFixed(0)}%</span></div>
      <div class="stat-row"><span class="label">Bearish Rate</span><span class="value">${(fingerprint.sentimentTendency.bearishRate * 100).toFixed(0)}%</span></div>
      <div class="stat-row"><span class="label">Avg Confidence</span><span class="value">${(fingerprint.confidencePattern.mean * 100).toFixed(0)}%</span></div>
      <div class="stat-row"><span class="label">Vocab Size</span><span class="value">${fingerprint.vocabularyDNA.vocabularySize}</span></div>
      <div class="stat-row"><span class="label">Uniqueness</span><span class="value">${(fingerprint.reasoningStyle.uniquenessScore * 100).toFixed(1)}%</span></div>
      <div class="stat-row"><span class="label">Samples</span><span class="value">${fingerprint.sampleSize}</span></div>
    </div>`;
  }).join("");

  const divergenceRows = divergenceReport.systematicDisagreements.map((sd) => `
    <tr>
      <td>${esc(formatAgentName(sd.agentPair[0]))} vs ${esc(formatAgentName(sd.agentPair[1]))}</td>
      <td>${(sd.disagreementRate * 100).toFixed(0)}%</td>
      <td>${sd.mostDisagreedSymbols.slice(0, 3).join(", ") || "N/A"}</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MoltApp Benchmark v15 — Industry-Standard AI Trading Benchmark</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e0e0e0; }
    .header { background: linear-gradient(135deg, #0d1117 0%, #161b22 50%, #0f3460 100%); padding: 2rem; text-align: center; border-bottom: 2px solid #e94560; }
    .header h1 { font-size: 2rem; color: #fff; margin-bottom: 0.5rem; }
    .header .version { color: #e94560; font-size: 0.9rem; font-weight: bold; margin-bottom: 0.4rem; }
    .header .subtitle { color: #aaa; font-size: 0.85rem; margin-top: 0.5rem; }
    .header .subtitle a { color: #58a6ff; text-decoration: none; }
    .container { max-width: 1440px; margin: 0 auto; padding: 1.5rem; }
    .section-title { font-size: 1.15rem; color: #e94560; margin: 1.5rem 0 0.8rem; border-bottom: 1px solid #333; padding-bottom: 0.4rem; }
    .pillar-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 0.7rem; margin-bottom: 1.5rem; }
    .pillar-card { background: #161b22; border-radius: 8px; padding: 0.8rem; border: 1px solid #30363d; text-align: center; }
    .pillar-card h3 { font-size: 0.7rem; color: #8b949e; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 0.4rem; }
    .pillar-card .score { font-size: 1.6rem; font-weight: bold; }
    .pillar-card .weight { font-size: 0.65rem; color: #484f58; margin-top: 0.2rem; }
    .green { color: #3fb950; } .yellow { color: #d29922; } .red { color: #f85149; } .blue { color: #58a6ff; } .purple { color: #bc8cff; }
    .leaderboard { background: #161b22; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; border: 1px solid #30363d; overflow-x: auto; }
    .leaderboard h2 { font-size: 1.2rem; margin-bottom: 1rem; color: #e94560; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 0.5rem 0.4rem; font-size: 0.7rem; color: #8b949e; text-transform: uppercase; border-bottom: 1px solid #30363d; }
    td { padding: 0.5rem 0.4rem; font-size: 0.8rem; border-bottom: 1px solid #21262d; }
    .grade { font-weight: bold; font-size: 1rem; }
    .grade-a { color: #3fb950; } .grade-b { color: #58a6ff; } .grade-c { color: #d29922; } .grade-d { color: #db6d28; } .grade-f { color: #f85149; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem; }
    .three-col { display: flex; gap: 1rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
    .card { background: #161b22; border-radius: 8px; padding: 1.2rem; border: 1px solid #30363d; }
    .card h2 { font-size: 1rem; color: #e94560; margin-bottom: 0.8rem; }
    .stat-row { display: flex; justify-content: space-between; padding: 0.35rem 0; border-bottom: 1px solid #21262d; }
    .stat-row .label { color: #8b949e; font-size: 0.78rem; } .stat-row .value { font-weight: bold; font-size: 0.82rem; }
    .badge { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.7rem; font-weight: bold; margin: 0 0.15rem; }
    .badge-hf { background: #ffd54f; color: #000; }
    .badge-live { background: #3fb950; color: #000; }
    .badge-v15 { background: #e94560; color: #fff; }
    .badge-new { background: #bc8cff; color: #000; }
    .methodology { background: #161b22; border-radius: 8px; padding: 1.5rem; border: 1px solid #30363d; margin-bottom: 1.5rem; }
    .methodology h2 { font-size: 1.1rem; color: #e94560; margin-bottom: 0.8rem; }
    .methodology ol { padding-left: 1.2rem; }
    .methodology li { font-size: 0.8rem; color: #c9d1d9; margin-bottom: 0.35rem; }
    .methodology li strong { color: #58a6ff; }
    .brain-feed { background: #161b22; border-radius: 8px; padding: 1.2rem; border: 1px solid #30363d; margin-bottom: 1.5rem; min-height: 100px; }
    .brain-feed h2 { font-size: 1rem; color: #e94560; margin-bottom: 0.6rem; }
    .brain-feed .placeholder { color: #484f58; font-size: 0.8rem; font-style: italic; }
    #brain-feed-list { list-style: none; max-height: 180px; overflow-y: auto; }
    #brain-feed-list li { padding: 0.4rem 0; border-bottom: 1px solid #21262d; font-size: 0.78rem; color: #c9d1d9; }
    .footer { text-align: center; padding: 2rem; color: #484f58; font-size: 0.72rem; border-top: 1px solid #21262d; margin-top: 1rem; }
    .footer a { color: #e94560; text-decoration: none; }
    @media (max-width: 1024px) { .pillar-grid { grid-template-columns: repeat(3, 1fr); } }
    @media (max-width: 768px) { .pillar-grid { grid-template-columns: repeat(2, 1fr); } .two-col { grid-template-columns: 1fr; } .three-col { flex-direction: column; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>MoltApp: AI Trading Benchmark</h1>
    <div class="version">
      <span class="badge badge-v15">v15</span>
      <span class="badge badge-live">LIVE</span>
      <span class="badge badge-hf">HuggingFace</span>
      <span class="badge badge-new">NEW: Provenance &amp; Reproducibility</span>
    </div>
    <div class="subtitle">
      Industry-Standard 12-Pillar Scoring | Cryptographic Provenance | Cross-Model Fingerprinting | Reproducibility Proofs
      <br/><a href="https://www.patgpt.us">patgpt.us</a> &middot;
      <a href="https://huggingface.co/datasets/patruff/molt-benchmark">HuggingFace Dataset</a>
    </div>
  </div>

  <div class="container">
    <!-- 12-Pillar Overview -->
    <h2 class="section-title">12-Pillar Scoring Overview</h2>
    <div class="pillar-grid">
      <div class="pillar-card"><h3>Financial</h3><div class="score green">${formatPillarScore(leaderboard, "financial")}</div><div class="weight">13% weight</div></div>
      <div class="pillar-card"><h3>Reasoning</h3><div class="score blue">${formatPillarScore(leaderboard, "reasoning")}</div><div class="weight">12% weight</div></div>
      <div class="pillar-card"><h3>Safety</h3><div class="score green">${formatPillarScore(leaderboard, "safety")}</div><div class="weight">10% weight</div></div>
      <div class="pillar-card"><h3>Calibration</h3><div class="score yellow">${formatPillarScore(leaderboard, "calibration")}</div><div class="weight">9% weight</div></div>
      <div class="pillar-card"><h3>Patterns</h3><div class="score blue">${formatPillarScore(leaderboard, "patterns")}</div><div class="weight">6% weight</div></div>
      <div class="pillar-card"><h3>Adaptability</h3><div class="score yellow">${formatPillarScore(leaderboard, "adaptability")}</div><div class="weight">6% weight</div></div>
      <div class="pillar-card"><h3>Forensic</h3><div class="score blue">${formatPillarScore(leaderboard, "forensicQuality")}</div><div class="weight">8% weight</div></div>
      <div class="pillar-card"><h3>Validation</h3><div class="score green">${formatPillarScore(leaderboard, "validationQuality")}</div><div class="weight">8% weight</div></div>
      <div class="pillar-card"><h3>Prediction</h3><div class="score yellow">${formatPillarScore(leaderboard, "predictionAccuracy")}</div><div class="weight">7% weight</div></div>
      <div class="pillar-card"><h3>Stability</h3><div class="score green">${formatPillarScore(leaderboard, "reasoningStability")}</div><div class="weight">6% weight</div></div>
      <div class="pillar-card"><h3>Provenance</h3><div class="score purple">${formatPillarScore(leaderboard, "provenanceIntegrity")}</div><div class="weight">8% weight &mdash; NEW</div></div>
      <div class="pillar-card"><h3>Model Comp.</h3><div class="score purple">${formatPillarScore(leaderboard, "modelComparison")}</div><div class="weight">7% weight &mdash; NEW</div></div>
    </div>

    <!-- Agent Leaderboard -->
    <div class="leaderboard">
      <h2>Agent Leaderboard &mdash; 12-Pillar Composite</h2>
      <table>
        <thead>
          <tr>
            <th>#</th><th>Agent</th><th>Composite</th><th>Grade</th>
            <th>Fin</th><th>Rsn</th><th>Safe</th><th>Cal</th><th>Pat</th><th>Adpt</th>
            <th>For</th><th>Val</th><th>Pred</th><th>Stab</th><th>Prov</th><th>Comp</th>
            <th>Trades</th>
          </tr>
        </thead>
        <tbody>
          ${leaderboard.map((a, i) => `
          <tr>
            <td>${i + 1}</td>
            <td><strong>${esc(formatAgentName(a.agentId))}</strong></td>
            <td><strong>${(a.composite * 100).toFixed(1)}%</strong></td>
            <td><span class="grade ${gradeClass(a.grade)}">${esc(a.grade)}</span></td>
            <td>${(a.financial * 100).toFixed(0)}%</td>
            <td>${(a.reasoning * 100).toFixed(0)}%</td>
            <td>${(a.safety * 100).toFixed(0)}%</td>
            <td>${(a.calibration * 100).toFixed(0)}%</td>
            <td>${(a.patterns * 100).toFixed(0)}%</td>
            <td>${(a.adaptability * 100).toFixed(0)}%</td>
            <td>${(a.forensicQuality * 100).toFixed(0)}%</td>
            <td>${(a.validationQuality * 100).toFixed(0)}%</td>
            <td>${(a.predictionAccuracy * 100).toFixed(0)}%</td>
            <td>${(a.reasoningStability * 100).toFixed(0)}%</td>
            <td>${(a.provenanceIntegrity * 100).toFixed(0)}%</td>
            <td>${(a.modelComparison * 100).toFixed(0)}%</td>
            <td>${a.tradeCount}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>

    <div class="two-col">
      <!-- Provenance Integrity -->
      <div class="card">
        <h2>Provenance Integrity (Pillar 11)</h2>
        <div class="stat-row"><span class="label">Total Agents Tracked</span><span class="value">${provenanceStats.totalAgents}</span></div>
        <div class="stat-row"><span class="label">Total Proofs Recorded</span><span class="value">${provenanceStats.totalProofs}</span></div>
        <div class="stat-row"><span class="label">Avg Chain Length</span><span class="value">${provenanceStats.avgChainLength.toFixed(1)}</span></div>
        <div class="stat-row"><span class="label">Oldest Proof</span><span class="value" style="font-size:0.7rem;">${provenanceStats.oldestProofTimestamp ? new Date(provenanceStats.oldestProofTimestamp).toLocaleString() : "N/A"}</span></div>
        <div class="stat-row"><span class="label">Newest Proof</span><span class="value" style="font-size:0.7rem;">${provenanceStats.newestProofTimestamp ? new Date(provenanceStats.newestProofTimestamp).toLocaleString() : "N/A"}</span></div>
        <h3 style="margin-top:0.8rem;font-size:0.8rem;color:#8b949e;margin-bottom:0.4rem;">Chain Validity per Agent</h3>
        <table>
          <thead><tr><th>Agent</th><th>Status</th></tr></thead>
          <tbody>
            ${chainIntegrityRows || '<tr><td colspan="2" style="color:#484f58;">No chains recorded yet</td></tr>'}
          </tbody>
        </table>
      </div>

      <!-- Reproducibility -->
      <div class="card">
        <h2>Reproducibility Proof (Pillar 12)</h2>
        <div class="stat-row"><span class="label">Total Scoring Runs</span><span class="value">${reproducibilityReport.totalRuns}</span></div>
        <div class="stat-row"><span class="label">Unique Input Sets</span><span class="value">${reproducibilityReport.uniqueInputSets}</span></div>
        <div class="stat-row"><span class="label">Deterministic Sets</span><span class="value green">${reproducibilityReport.deterministicSets}</span></div>
        <div class="stat-row"><span class="label">Non-Deterministic Sets</span><span class="value ${reproducibilityReport.nonDeterministicSets > 0 ? "red" : "green"}">${reproducibilityReport.nonDeterministicSets}</span></div>
        <div class="stat-row">
          <span class="label">Determinism Rate</span>
          <span class="value" style="font-size:1.1rem;color:${reproducibilityReport.reproducibilityRate >= 0.95 ? "#3fb950" : reproducibilityReport.reproducibilityRate >= 0.8 ? "#d29922" : "#f85149"};">
            ${(reproducibilityReport.reproducibilityRate * 100).toFixed(1)}%
          </span>
        </div>
        ${reproducibilityReport.nonDeterministicRounds.length > 0 ? `
        <h3 style="margin-top:0.8rem;font-size:0.8rem;color:#8b949e;">Non-Deterministic Rounds</h3>
        <p style="font-size:0.75rem;color:#f85149;margin-top:0.3rem;">${reproducibilityReport.nonDeterministicRounds.slice(0, 5).join(", ")}</p>
        ` : '<p style="margin-top:0.8rem;font-size:0.78rem;color:#3fb950;">All runs are fully deterministic.</p>'}
      </div>
    </div>

    <!-- Cross-Model Comparison -->
    <h2 class="section-title">Cross-Model Comparison (Pillar 12)</h2>
    <div class="two-col">
      <div class="card">
        <h2>Aggregate Comparison Stats</h2>
        <div class="stat-row"><span class="label">Entries Recorded</span><span class="value">${crossModelStats.totalEntriesRecorded}</span></div>
        <div class="stat-row"><span class="label">Agents Tracked</span><span class="value">${crossModelStats.agentCount}</span></div>
        <div class="stat-row"><span class="label">Rounds Compared</span><span class="value">${crossModelStats.roundsCompared}</span></div>
        <div class="stat-row"><span class="label">Avg Herding Score</span><span class="value">${(crossModelStats.avgHerdingScore * 100).toFixed(0)}%</span></div>
        <div class="stat-row"><span class="label">Avg Reasoning Similarity</span><span class="value">${(crossModelStats.avgJaccardSimilarity * 100).toFixed(1)}%</span></div>
        <div class="stat-row"><span class="label">Action Agreement Rate</span><span class="value">${(crossModelStats.actionAgreementRate * 100).toFixed(0)}%</span></div>
        <div class="stat-row"><span class="label">Avg Confidence Delta</span><span class="value">${(crossModelStats.avgConfidenceDelta * 100).toFixed(1)}%</span></div>
      </div>

      <div class="card">
        <h2>Systematic Disagreements</h2>
        ${divergenceReport.systematicDisagreements.length > 0 ? `
        <table>
          <thead><tr><th>Agent Pair</th><th>Disagree Rate</th><th>Top Symbols</th></tr></thead>
          <tbody>${divergenceRows}</tbody>
        </table>` : '<p style="color:#484f58;font-size:0.8rem;font-style:italic;">No disagreements recorded yet. Rounds will populate this section.</p>'}
        <div class="stat-row" style="margin-top:0.8rem;"><span class="label">Total Rounds Analyzed</span><span class="value">${divergenceReport.totalRoundsAnalyzed}</span></div>
      </div>
    </div>

    <!-- Model Fingerprints -->
    <h2 class="section-title">Model Fingerprints</h2>
    <div class="three-col">
      ${fingerprintCards}
    </div>

    <!-- Brain Feed -->
    <div class="brain-feed">
      <h2>Live Reasoning Feed</h2>
      <ul id="brain-feed-list">
        <li class="placeholder">Listening for live reasoning events via SSE...</li>
      </ul>
    </div>

    <!-- Methodology -->
    <div class="methodology">
      <h2>Methodology: 12-Pillar Scoring Framework</h2>
      <ol>
        <li><strong>Financial (13%)</strong> &mdash; P&amp;L, Sharpe ratio, win rate, max drawdown</li>
        <li><strong>Reasoning (12%)</strong> &mdash; Coherence, depth, logical consistency</li>
        <li><strong>Safety (10%)</strong> &mdash; Hallucination-free rate, trading discipline</li>
        <li><strong>Calibration (9%)</strong> &mdash; ECE, Brier score, monotonic quartiles</li>
        <li><strong>Patterns (6%)</strong> &mdash; Fallacy detection, cognitive bias recognition</li>
        <li><strong>Adaptability (6%)</strong> &mdash; Cross-regime performance, regime shift handling</li>
        <li><strong>Forensic Quality (8%)</strong> &mdash; Structure, originality, analytical clarity</li>
        <li><strong>Validation Quality (8%)</strong> &mdash; Source grounding, factual depth</li>
        <li><strong>Prediction Accuracy (7%)</strong> &mdash; Direction accuracy, target precision, resolution quality</li>
        <li><strong>Reasoning Stability (6%)</strong> &mdash; Sentiment volatility, conviction flip rate</li>
        <li><strong>Provenance Integrity (8%)</strong> &mdash; Cryptographic proof of pre-trade reasoning, chain validity, cross-agent witnesses</li>
        <li><strong>Model Comparison (7%)</strong> &mdash; Cross-model fingerprinting, bias asymmetry, reasoning divergence</li>
      </ol>
    </div>
  </div>

  <div class="footer">
    <p>MoltApp v15 &mdash; Industry-Standard AI Trading Benchmark</p>
    <p><a href="https://www.patgpt.us">patgpt.us</a> | <a href="https://huggingface.co/datasets/patruff/molt-benchmark">HuggingFace Dataset</a></p>
    <p style="margin-top:0.5rem;">12-Pillar Scoring: Financial, Reasoning, Safety, Calibration, Patterns, Adaptability, Forensic, Validation, Prediction, Stability, Provenance, Model Comparison</p>
    <p style="margin-top:0.3rem;">Citation: MoltApp Benchmark v15 (2025). Multi-agent LLM Trading Evaluation with Provenance Proofs. <a href="https://www.patgpt.us">patgpt.us</a></p>
  </div>

  <script>
    // Auto-refresh every 45 seconds
    setTimeout(function() { location.reload(); }, 45000);

    // SSE live feed
    (function() {
      try {
        var es = new EventSource(location.pathname.replace(/\\/$/, '') + '/stream');
        var list = document.getElementById('brain-feed-list');
        es.onmessage = function(e) {
          try {
            var d = JSON.parse(e.data);
            var li = document.createElement('li');
            var ts = d.timestamp ? new Date(d.timestamp).toLocaleTimeString() : '';
            li.textContent = '[' + ts + '] ' + (d.type || 'event') + (d.agentId ? ' (' + d.agentId + ')' : '') + ': ' + JSON.stringify(d);
            if (list.firstChild && list.firstChild.className === 'placeholder') list.innerHTML = '';
            list.insertBefore(li, list.firstChild);
            while (list.children.length > 50) list.removeChild(list.lastChild);
          } catch(ex) {}
        };
      } catch(ex) {}
    })();
  </script>
</body>
</html>`;

  return c.html(html);
});

/**
 * GET /benchmark-v15/data — JSON data for the dashboard
 */
benchmarkV15Routes.get("/data", (c) => {
  const leaderboard = buildLeaderboard();
  const provenanceStats = getProvenanceStats();
  const crossModelStats = getCrossModelStats();
  const divergenceReport = getModelDivergenceReport();
  const reproducibilityReport = getReproducibilityReport();

  const fingerprints: Record<string, ReturnType<typeof computeModelFingerprint>> = {};
  for (const id of AGENT_IDS) {
    fingerprints[id] = computeModelFingerprint(id);
  }

  return c.json({
    ok: true,
    benchmark: "moltapp-v15",
    pillars: [
      { name: "Financial", weight: 0.13, description: "P&L, Sharpe, Win Rate, Drawdown" },
      { name: "Reasoning", weight: 0.12, description: "Coherence, Depth, Consistency" },
      { name: "Safety", weight: 0.10, description: "Hallucination-Free, Discipline" },
      { name: "Calibration", weight: 0.09, description: "ECE, Brier, Monotonic Quartiles" },
      { name: "Patterns", weight: 0.06, description: "Fallacy Detection, Vocabulary" },
      { name: "Adaptability", weight: 0.06, description: "Cross-Regime Performance" },
      { name: "Forensic Quality", weight: 0.08, description: "Structure, Originality, Clarity" },
      { name: "Validation Quality", weight: 0.08, description: "Depth, Sources, Grounding" },
      { name: "Prediction Accuracy", weight: 0.07, description: "Direction accuracy, target precision" },
      { name: "Reasoning Stability", weight: 0.06, description: "Sentiment vol, conviction flip rate" },
      { name: "Provenance Integrity", weight: 0.08, description: "Cryptographic pre-trade reasoning proof" },
      { name: "Model Comparison", weight: 0.07, description: "Cross-model fingerprinting, divergence" },
    ],
    leaderboard,
    provenanceStats,
    crossModelStats,
    divergenceReport: {
      systematicDisagreements: divergenceReport.systematicDisagreements,
      biasAsymmetries: divergenceReport.biasAsymmetries,
      herdingTrend: divergenceReport.herdingTrend,
      totalRoundsAnalyzed: divergenceReport.totalRoundsAnalyzed,
    },
    reproducibilityReport,
    fingerprints,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /benchmark-v15/stream — SSE live event stream
 */
benchmarkV15Routes.get("/stream", (c) => {
  const stream = new ReadableStream({
    start(controller) {
      v15Controllers.add(controller);
      const welcome = `data: ${JSON.stringify({ type: "connected", benchmark: "moltapp-v15", pillars: 12 })}\n\n`;
      controller.enqueue(new TextEncoder().encode(welcome));
    },
    cancel(controller) {
      v15Controllers.delete(controller);
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
