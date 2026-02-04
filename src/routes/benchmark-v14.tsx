/**
 * Benchmark v14 Dashboard — 10-Pillar Scoring with Outcome Resolution
 *
 * The industry-standard AI trading benchmark dashboard.
 * v14 adds three new pillars: Prediction Accuracy, Reasoning Stability,
 * and Consensus Intelligence — closing the loop from prediction to outcome.
 *
 * Routes:
 * - GET /benchmark-v14           — 10-Pillar dashboard HTML
 * - GET /benchmark-v14/data      — JSON data for the dashboard
 * - GET /benchmark-v14/stream    — SSE live event stream
 */

import { Hono } from "hono";
import {
  buildAgentPredictionProfile,
  getResolutionStats,
} from "../services/outcome-resolution-engine.ts";
import {
  analyzeCalibration,
  compareAgentCalibration,
} from "../services/confidence-calibration-analyzer.ts";
import {
  analyzeVolatility,
  compareAgentVolatility,
} from "../services/reasoning-volatility-tracker.ts";
import {
  buildDivergenceProfile,
  getRecentConsensus,
} from "../services/consensus-divergence-scorer.ts";

export const benchmarkV14Routes = new Hono();

// ---------------------------------------------------------------------------
// Per-agent v14 composite metrics (fed by orchestrator)
// ---------------------------------------------------------------------------

interface V14AgentMetrics {
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
  composite: number;
  grade: string;
  tradeCount: number;
  lastUpdated: string;
}

const agentMetrics: Map<string, V14AgentMetrics> = new Map();
const AGENT_IDS = ["claude-value-investor", "gpt-momentum-trader", "grok-contrarian"];

/**
 * Record composite metrics for an agent (called by orchestrator).
 */
export function recordV14AgentMetrics(
  agentId: string,
  metrics: V14AgentMetrics,
): void {
  agentMetrics.set(agentId, metrics);
}

// ---------------------------------------------------------------------------
// SSE Event Stream
// ---------------------------------------------------------------------------

const v14Subscribers: Set<ReadableStreamDefaultController> = new Set();

export function emitV14Event(
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
  for (const controller of v14Subscribers) {
    try {
      controller.enqueue(new TextEncoder().encode(payload));
    } catch {
      v14Subscribers.delete(controller);
    }
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /benchmark-v14 — 10-Pillar Benchmark Dashboard
 */
benchmarkV14Routes.get("/", (c) => {
  const leaderboard = buildLeaderboard();
  const divergence = buildDivergenceProfile();
  const recentConsensus = getRecentConsensus(5);
  const resolutionStats = getResolutionStats();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MoltApp Benchmark v14 — 10-Pillar AI Trading Evaluation</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e0e0e0; }
    .header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%); padding: 2rem; text-align: center; border-bottom: 2px solid #e94560; }
    .header h1 { font-size: 2rem; color: #fff; margin-bottom: 0.5rem; }
    .header .version { color: #e94560; font-size: 0.9rem; font-weight: bold; }
    .header .subtitle { color: #aaa; font-size: 0.85rem; margin-top: 0.5rem; }
    .container { max-width: 1400px; margin: 0 auto; padding: 1.5rem; }
    .pillar-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 0.8rem; margin-bottom: 1.5rem; }
    .pillar-card { background: #1a1a2e; border-radius: 8px; padding: 1rem; border: 1px solid #333; text-align: center; }
    .pillar-card h3 { font-size: 0.75rem; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 0.5rem; }
    .pillar-card .score { font-size: 1.8rem; font-weight: bold; }
    .pillar-card .weight { font-size: 0.7rem; color: #666; margin-top: 0.3rem; }
    .green { color: #00e676; } .yellow { color: #ffca28; } .red { color: #ff5252; } .blue { color: #40c4ff; }
    .leaderboard { background: #1a1a2e; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; border: 1px solid #333; }
    .leaderboard h2 { font-size: 1.2rem; margin-bottom: 1rem; color: #e94560; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 0.6rem; font-size: 0.75rem; color: #888; text-transform: uppercase; border-bottom: 1px solid #333; }
    td { padding: 0.6rem; font-size: 0.85rem; border-bottom: 1px solid #1a1a2e; }
    .grade { font-weight: bold; font-size: 1rem; }
    .grade-a { color: #00e676; } .grade-b { color: #40c4ff; } .grade-c { color: #ffca28; } .grade-d { color: #ff9800; } .grade-f { color: #ff5252; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem; }
    .card { background: #1a1a2e; border-radius: 8px; padding: 1.5rem; border: 1px solid #333; }
    .card h2 { font-size: 1.1rem; color: #e94560; margin-bottom: 0.8rem; }
    .stat-row { display: flex; justify-content: space-between; padding: 0.4rem 0; border-bottom: 1px solid #222; }
    .stat-row .label { color: #888; font-size: 0.8rem; } .stat-row .value { font-weight: bold; font-size: 0.85rem; }
    .bar-chart { margin-top: 0.5rem; }
    .bar { display: flex; align-items: center; margin: 0.3rem 0; }
    .bar-label { width: 100px; font-size: 0.75rem; color: #888; }
    .bar-fill { height: 16px; border-radius: 4px; min-width: 4px; transition: width 0.3s; }
    .bar-value { margin-left: 8px; font-size: 0.75rem; color: #aaa; }
    .badge { display: inline-block; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.7rem; font-weight: bold; }
    .badge-hf { background: #ffd54f; color: #000; }
    .badge-live { background: #00e676; color: #000; }
    .badge-v14 { background: #e94560; color: #fff; }
    .consensus-feed { list-style: none; }
    .consensus-feed li { padding: 0.6rem 0; border-bottom: 1px solid #222; font-size: 0.8rem; }
    .consensus-type { font-weight: bold; }
    .footer { text-align: center; padding: 2rem; color: #555; font-size: 0.75rem; }
    .footer a { color: #e94560; text-decoration: none; }
    @media (max-width: 900px) { .pillar-grid { grid-template-columns: repeat(2, 1fr); } .two-col { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>MoltApp: AI Trading Benchmark</h1>
    <div class="version">
      <span class="badge badge-v14">v14</span>
      <span class="badge badge-live">LIVE</span>
      <span class="badge badge-hf">HuggingFace</span>
    </div>
    <div class="subtitle">10-Pillar Scoring | Outcome Resolution | Calibration Curves | Consensus Intelligence</div>
  </div>

  <div class="container">
    <!-- 10 Pillar Overview -->
    <div class="pillar-grid">
      <div class="pillar-card">
        <h3>Financial</h3>
        <div class="score green">${formatPillarScore(leaderboard, "financial")}</div>
        <div class="weight">15% weight</div>
      </div>
      <div class="pillar-card">
        <h3>Reasoning</h3>
        <div class="score blue">${formatPillarScore(leaderboard, "reasoning")}</div>
        <div class="weight">14% weight</div>
      </div>
      <div class="pillar-card">
        <h3>Safety</h3>
        <div class="score green">${formatPillarScore(leaderboard, "safety")}</div>
        <div class="weight">12% weight</div>
      </div>
      <div class="pillar-card">
        <h3>Calibration</h3>
        <div class="score yellow">${formatPillarScore(leaderboard, "calibration")}</div>
        <div class="weight">10% weight</div>
      </div>
      <div class="pillar-card">
        <h3>Patterns</h3>
        <div class="score blue">${formatPillarScore(leaderboard, "patterns")}</div>
        <div class="weight">7% weight</div>
      </div>
      <div class="pillar-card">
        <h3>Adaptability</h3>
        <div class="score yellow">${formatPillarScore(leaderboard, "adaptability")}</div>
        <div class="weight">7% weight</div>
      </div>
      <div class="pillar-card">
        <h3>Forensic</h3>
        <div class="score blue">${formatPillarScore(leaderboard, "forensicQuality")}</div>
        <div class="weight">10% weight</div>
      </div>
      <div class="pillar-card">
        <h3>Validation</h3>
        <div class="score green">${formatPillarScore(leaderboard, "validationQuality")}</div>
        <div class="weight">10% weight</div>
      </div>
      <div class="pillar-card">
        <h3>Prediction</h3>
        <div class="score yellow">${formatPillarScore(leaderboard, "predictionAccuracy")}</div>
        <div class="weight">8% weight — NEW</div>
      </div>
      <div class="pillar-card">
        <h3>Stability</h3>
        <div class="score green">${formatPillarScore(leaderboard, "reasoningStability")}</div>
        <div class="weight">7% weight — NEW</div>
      </div>
    </div>

    <!-- Leaderboard -->
    <div class="leaderboard">
      <h2>Agent Leaderboard</h2>
      <table>
        <thead>
          <tr>
            <th>#</th><th>Agent</th><th>Composite</th><th>Grade</th>
            <th>Financial</th><th>Reasoning</th><th>Safety</th><th>Prediction</th><th>Stability</th>
            <th>Trades</th>
          </tr>
        </thead>
        <tbody>
          ${leaderboard.map((a, i) => `
          <tr>
            <td>${i + 1}</td>
            <td><strong>${formatAgentName(a.agentId)}</strong></td>
            <td><strong>${(a.composite * 100).toFixed(1)}%</strong></td>
            <td><span class="grade ${gradeClass(a.grade)}">${a.grade}</span></td>
            <td>${(a.financial * 100).toFixed(0)}%</td>
            <td>${(a.reasoning * 100).toFixed(0)}%</td>
            <td>${(a.safety * 100).toFixed(0)}%</td>
            <td>${(a.predictionAccuracy * 100).toFixed(0)}%</td>
            <td>${(a.reasoningStability * 100).toFixed(0)}%</td>
            <td>${a.tradeCount}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>

    <div class="two-col">
      <!-- Prediction Resolution -->
      <div class="card">
        <h2>Prediction Resolution</h2>
        <div class="stat-row"><span class="label">Pending Predictions</span><span class="value">${resolutionStats.totalPending}</span></div>
        <div class="stat-row"><span class="label">Resolved Predictions</span><span class="value">${resolutionStats.totalResolved}</span></div>
        <div class="stat-row"><span class="label">Overall Direction Accuracy</span><span class="value">${(resolutionStats.overallAccuracy * 100).toFixed(1)}%</span></div>
        <div class="stat-row"><span class="label">Avg Prediction Quality</span><span class="value">${(resolutionStats.avgPredictionScore * 100).toFixed(1)}%</span></div>
        <div class="bar-chart">
          ${Object.entries(resolutionStats.byAgent).map(([id, stats]) => `
            <div class="bar">
              <span class="bar-label">${formatAgentName(id)}</span>
              <div class="bar-fill" style="width: ${stats.accuracy * 200}px; background: ${stats.accuracy >= 0.6 ? '#00e676' : stats.accuracy >= 0.4 ? '#ffca28' : '#ff5252'};"></div>
              <span class="bar-value">${(stats.accuracy * 100).toFixed(0)}% (${stats.resolved})</span>
            </div>
          `).join("")}
        </div>
      </div>

      <!-- Consensus Intelligence -->
      <div class="card">
        <h2>Consensus Intelligence</h2>
        <div class="stat-row"><span class="label">Rounds Analyzed</span><span class="value">${divergence.totalRounds}</span></div>
        <div class="stat-row"><span class="label">Avg Agreement</span><span class="value">${(divergence.avgAgreementScore * 100).toFixed(0)}%</span></div>
        <div class="stat-row"><span class="label">Unanimous Rate</span><span class="value">${(divergence.unanimousRate * 100).toFixed(0)}%</span></div>
        <div class="stat-row"><span class="label">Split Rate</span><span class="value">${(divergence.splitRate * 100).toFixed(0)}%</span></div>
        <div class="stat-row"><span class="label">Convergence Trend</span><span class="value">${divergence.convergenceTrend}</span></div>
        <h3 style="margin-top:0.8rem;font-size:0.8rem;color:#888;">Recent Consensus</h3>
        <ul class="consensus-feed">
          ${recentConsensus.map((r) => `
            <li>
              <span class="consensus-type" style="color:${r.consensusType === 'unanimous' ? '#00e676' : r.consensusType === 'split' ? '#ff5252' : '#ffca28'}">${r.consensusType.toUpperCase()}</span>
              ${r.consensusAction !== "none" ? `→ ${r.consensusAction.toUpperCase()} ${r.consensusSymbol ?? ""}` : ""}
              ${r.contrarians.length > 0 ? `(contrarian: ${r.contrarians.map(formatAgentName).join(", ")})` : ""}
            </li>
          `).join("")}
          ${recentConsensus.length === 0 ? "<li>No rounds recorded yet</li>" : ""}
        </ul>
      </div>
    </div>

    <div class="two-col">
      <!-- Calibration Curves -->
      <div class="card">
        <h2>Confidence Calibration</h2>
        ${AGENT_IDS.map((id) => {
          const cal = analyzeCalibration(id);
          return `
            <div style="margin-bottom:1rem;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.3rem;">
                <strong style="font-size:0.85rem;">${formatAgentName(id)}</strong>
                <span class="grade ${gradeClass(cal.grade)}">${cal.grade}</span>
              </div>
              <div class="stat-row"><span class="label">ECE</span><span class="value">${cal.ece.toFixed(3)}</span></div>
              <div class="stat-row"><span class="label">Brier Score</span><span class="value">${cal.brierScore.toFixed(3)}</span></div>
              <div class="stat-row"><span class="label">Monotonic</span><span class="value">${cal.monotonicCalibration ? "Yes" : "No"}</span></div>
              <div class="stat-row"><span class="label">Data Points</span><span class="value">${cal.totalDataPoints}</span></div>
            </div>`;
        }).join("")}
      </div>

      <!-- Reasoning Stability -->
      <div class="card">
        <h2>Reasoning Stability</h2>
        ${AGENT_IDS.map((id) => {
          const vol = analyzeVolatility(id);
          return `
            <div style="margin-bottom:1rem;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.3rem;">
                <strong style="font-size:0.85rem;">${formatAgentName(id)}</strong>
                <span class="grade ${gradeClass(vol.grade)}">${vol.grade}</span>
              </div>
              <div class="stat-row"><span class="label">Stability Score</span><span class="value">${(vol.stabilityScore * 100).toFixed(0)}%</span></div>
              <div class="stat-row"><span class="label">Sentiment Vol</span><span class="value">${vol.sentimentVolatility.toFixed(3)}</span></div>
              <div class="stat-row"><span class="label">Confidence Vol</span><span class="value">${vol.confidenceVolatility.toFixed(3)}</span></div>
              <div class="stat-row"><span class="label">Flip Rate</span><span class="value">${(vol.convictionFlipRate * 100).toFixed(0)}%</span></div>
              <div class="stat-row"><span class="label">Trend</span><span class="value">${vol.recentTrend}</span></div>
            </div>`;
        }).join("")}
      </div>
    </div>
  </div>

  <div class="footer">
    <p>MoltApp v14 — AI Trading Benchmark | <a href="https://www.patgpt.us">www.patgpt.us</a> | <a href="https://huggingface.co/datasets/patruff/molt-benchmark">HuggingFace Dataset</a></p>
    <p>10-Pillar Scoring: Financial, Reasoning, Safety, Calibration, Patterns, Adaptability, Forensic, Validation, Prediction, Stability</p>
  </div>

  <script>
    // Auto-refresh every 30 seconds
    setTimeout(() => location.reload(), 30000);
  </script>
</body>
</html>`;

  return c.html(html);
});

/**
 * GET /benchmark-v14/data — JSON data for the dashboard
 */
benchmarkV14Routes.get("/data", (c) => {
  const leaderboard = buildLeaderboard();
  const divergence = buildDivergenceProfile();
  const resolutionStats = getResolutionStats();
  const calibrationComparison = compareAgentCalibration();
  const volatilityComparison = compareAgentVolatility();

  return c.json({
    ok: true,
    benchmark: "moltapp-v14",
    pillars: [
      { name: "Financial", weight: 0.15, description: "P&L, Sharpe, Win Rate, Drawdown" },
      { name: "Reasoning", weight: 0.14, description: "Coherence, Depth, Consistency" },
      { name: "Safety", weight: 0.12, description: "Hallucination-Free, Discipline" },
      { name: "Calibration", weight: 0.10, description: "ECE, Brier, Monotonic Quartiles" },
      { name: "Patterns", weight: 0.07, description: "Fallacy Detection, Vocabulary" },
      { name: "Adaptability", weight: 0.07, description: "Cross-Regime Performance" },
      { name: "Forensic Quality", weight: 0.10, description: "Structure, Originality, Clarity" },
      { name: "Validation Quality", weight: 0.10, description: "Depth, Sources, Grounding" },
      { name: "Prediction Accuracy", weight: 0.08, description: "Direction accuracy, target precision, resolution quality" },
      { name: "Reasoning Stability", weight: 0.07, description: "Sentiment vol, conviction flip rate, intent drift" },
    ],
    leaderboard,
    predictionResolution: resolutionStats,
    calibrationComparison: {
      bestCalibrated: calibrationComparison.bestCalibrated,
      worstCalibrated: calibrationComparison.worstCalibrated,
      rankings: calibrationComparison.rankings,
    },
    volatilityComparison: {
      mostStable: volatilityComparison.mostStable,
      mostVolatile: volatilityComparison.mostVolatile,
      rankings: volatilityComparison.rankings,
    },
    consensusDivergence: {
      totalRounds: divergence.totalRounds,
      avgAgreementScore: divergence.avgAgreementScore,
      unanimousRate: divergence.unanimousRate,
      splitRate: divergence.splitRate,
      convergenceTrend: divergence.convergenceTrend,
      byAgent: divergence.byAgent,
    },
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /benchmark-v14/stream — SSE live event stream
 */
benchmarkV14Routes.get("/stream", (c) => {
  const stream = new ReadableStream({
    start(controller) {
      v14Subscribers.add(controller);
      const welcome = `data: ${JSON.stringify({ type: "connected", benchmark: "moltapp-v14", pillars: 10 })}\n\n`;
      controller.enqueue(new TextEncoder().encode(welcome));
    },
    cancel(controller) {
      v14Subscribers.delete(controller);
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
// Helpers
// ---------------------------------------------------------------------------

function buildLeaderboard(): (V14AgentMetrics & { agentId: string })[] {
  const entries: (V14AgentMetrics & { agentId: string })[] = [];

  for (const agentId of AGENT_IDS) {
    const metrics = agentMetrics.get(agentId) ?? defaultMetrics();
    entries.push({ agentId, ...metrics });
  }

  // Sort by composite score descending
  entries.sort((a, b) => b.composite - a.composite);
  return entries;
}

function defaultMetrics(): V14AgentMetrics {
  return {
    financial: 0.5,
    reasoning: 0.5,
    safety: 0.5,
    calibration: 0.5,
    patterns: 0.5,
    adaptability: 0.5,
    forensicQuality: 0.5,
    validationQuality: 0.5,
    predictionAccuracy: 0.5,
    reasoningStability: 0.5,
    composite: 0.5,
    grade: "C",
    tradeCount: 0,
    lastUpdated: new Date().toISOString(),
  };
}

function formatPillarScore(
  leaderboard: (V14AgentMetrics & { agentId: string })[],
  key: keyof V14AgentMetrics,
): string {
  if (leaderboard.length === 0) return "—";
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
