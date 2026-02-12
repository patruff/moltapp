/**
 * Benchmark v22 Dashboard & Data Routes
 *
 * The 28-pillar AI Trading Benchmark dashboard — adds Cryptographic Integrity,
 * Reasoning Grounding, and Cognitive Bias Detection to the v21 foundation (26 pillars).
 *
 * NEW in v22:
 * - Benchmark Integrity Engine: SHA-256 fingerprinting, Merkle audit trees,
 *   tamper detection for cryptographically verifiable benchmarks
 * - Reasoning Grounding Validator: Verifies every factual claim against
 *   real market data — fabrication vs evidence-based reasoning
 * - Cognitive Bias Detector: Anchoring, confirmation, recency, sunk cost,
 *   overconfidence, herding, loss aversion detection
 *
 * Routes:
 *   GET /              — HTML dashboard page
 *   GET /data          — JSON data payload
 *   GET /stream        — SSE live event stream
 *   GET /export        — JSONL export for researchers
 */

import { Hono } from "hono";
import { html } from "hono/html";
import { round2 } from "../lib/math-utils.ts";
import {
  getV17Rankings,
  getV17Health,
} from "../services/benchmark-intelligence-gateway.ts";
import {
  getArbitrationPillarScore,
} from "../services/benchmark-arbitration-engine.ts";
import {
  getDebatePillarScore,
} from "../services/cross-agent-debate-engine.ts";
import {
  getImpactPillarScore,
} from "../services/trade-impact-forecaster.ts";
import {
  getAdversarialPillarScore,
} from "../services/adversarial-robustness-engine.ts";
import {
  getMemoryPillarScore,
} from "../services/cross-session-memory-analyzer.ts";
import {
  getTransparencyPillarScore,
} from "../services/reasoning-transparency-engine.ts";
import {
  getAccountabilityPillarScore,
} from "../services/decision-accountability-tracker.ts";
import {
  getCertificationPillarScore,
} from "../services/reasoning-quality-certifier.ts";
import {
  getChainValidationPillarScore,
} from "../services/reasoning-chain-validator.ts";
import {
  getStrategyPillarScore,
} from "../services/agent-strategy-profiler.ts";
import {
  getIntegrityStats,
  runTamperCheck,
} from "../services/benchmark-integrity-engine.ts";
import {
  getAgentGroundingStats,
  getGroundingHistory,
} from "../services/reasoning-grounding-validator.ts";
import {
  getAgentBiasStats,
  getBiasHistory,
} from "../services/cognitive-bias-detector.ts";

export const benchmarkV22Routes = new Hono();

// ---------------------------------------------------------------------------
// SSE stream
// ---------------------------------------------------------------------------

interface V22Event {
  type: string;
  data: unknown;
  timestamp: string;
}

const v22Events: V22Event[] = [];
const MAX_EVENTS = 200;

export function emitV22Event(type: string, data: unknown): void {
  v22Events.unshift({ type, data, timestamp: new Date().toISOString() });
  if (v22Events.length > MAX_EVENTS) v22Events.length = MAX_EVENTS;
}

// ---------------------------------------------------------------------------
// v22 Weights — 28 pillars
// ---------------------------------------------------------------------------

const V22_WEIGHTS: Record<string, number> = {
  financial: 0.06, reasoning: 0.05, safety: 0.05, calibration: 0.04, patterns: 0.03,
  adaptability: 0.03, forensic_quality: 0.04, validation_quality: 0.04,
  prediction_accuracy: 0.04, reasoning_stability: 0.03, provenance_integrity: 0.03,
  model_comparison: 0.03, metacognition: 0.04, reasoning_efficiency: 0.02,
  forensic_ledger: 0.02, strategy_genome: 0.02, adversarial_robustness: 0.03,
  cross_session_memory: 0.03, arbitration_quality: 0.03, debate_performance: 0.03,
  impact_forecasting: 0.03, reasoning_transparency: 0.04, decision_accountability: 0.03,
  quality_certification: 0.03, reasoning_chain_integrity: 0.04, strategy_profiling: 0.04,
  benchmark_integrity: 0.05, reasoning_grounding: 0.05, cognitive_bias: 0.05,
};

// ---------------------------------------------------------------------------
// Score computation
// ---------------------------------------------------------------------------

function computeGrade(score: number): string {
  if (score >= 0.95) return "A+";
  if (score >= 0.90) return "A";
  if (score >= 0.85) return "A-";
  if (score >= 0.80) return "B+";
  if (score >= 0.75) return "B";
  if (score >= 0.70) return "B-";
  if (score >= 0.65) return "C+";
  if (score >= 0.60) return "C";
  if (score >= 0.55) return "C-";
  if (score >= 0.50) return "D+";
  if (score >= 0.45) return "D";
  return "F";
}

interface V22Score {
  agentId: string;
  composite: number;
  grade: string;
  rank: number;
  pillars: Record<string, number>;
}

function computeV22Score(
  agentId: string,
  profile: { composite?: number; pillars?: { name: string; score: number }[] } | undefined,
): { score: number; pillars: Record<string, number> } {
  const pillars: Record<string, number> = {};

  if (profile?.pillars) {
    for (const p of profile.pillars) pillars[p.name] = p.score;
  }

  for (const key of Object.keys(V22_WEIGHTS)) {
    if (!(key in pillars)) pillars[key] = 0.5;
  }

  // Live overrides
  pillars.arbitration_quality = getArbitrationPillarScore(agentId);
  pillars.debate_performance = getDebatePillarScore(agentId);
  pillars.impact_forecasting = getImpactPillarScore(agentId);
  pillars.adversarial_robustness = getAdversarialPillarScore(agentId);
  pillars.cross_session_memory = getMemoryPillarScore(agentId);
  pillars.reasoning_transparency = getTransparencyPillarScore(agentId);
  pillars.decision_accountability = getAccountabilityPillarScore(agentId);
  pillars.quality_certification = getCertificationPillarScore(agentId);
  pillars.reasoning_chain_integrity = getChainValidationPillarScore(agentId);
  pillars.strategy_profiling = getStrategyPillarScore(agentId);

  // v22 pillars
  pillars.benchmark_integrity = getIntegrityStats().overallIntegrity;
  const gs = getAgentGroundingStats();
  pillars.reasoning_grounding = gs[agentId]?.avgGroundingScore ?? 0.5;
  const bs = getAgentBiasStats();
  pillars.cognitive_bias = bs[agentId] ? Math.max(0, 1 - bs[agentId].avgBiasScore) : 0.5;

  let score = 0;
  for (const [pillar, weight] of Object.entries(V22_WEIGHTS)) {
    score += (pillars[pillar] ?? 0.5) * weight;
  }
  return { score: round2(score), pillars };
}

function computeAllScores(): V22Score[] {
  const rankings = getV17Rankings();
  const agentIds = rankings.length > 0
    ? rankings.map((r) => r.agentId)
    : ["claude-value-investor", "gpt-momentum-trader", "grok-contrarian"];

  const scores: V22Score[] = agentIds.map((agentId) => {
    const base = rankings.find((r) => r.agentId === agentId);
    const { score, pillars } = computeV22Score(agentId, base);
    return { agentId, composite: score, grade: computeGrade(score), rank: 0, pillars };
  });

  scores.sort((a, b) => b.composite - a.composite);
  scores.forEach((s, i) => {
    s.rank = i + 1;
  });
  return scores;
}

// ---------------------------------------------------------------------------
// Data endpoint
// ---------------------------------------------------------------------------

benchmarkV22Routes.get("/data", (c) => {
  const scores = computeAllScores();
  const intStats = getIntegrityStats();
  const groundStats = getAgentGroundingStats();
  const biasStatMap = getAgentBiasStats();
  const tamper = runTamperCheck();
  const recentGrounding = getGroundingHistory(10);
  const recentBiases = getBiasHistory(10);

  return c.json({
    ok: true,
    benchmark: "moltapp-v22",
    pillars: 28,
    leaderboard: scores,
    v22Features: {
      integrity: {
        overallScore: intStats.overallIntegrity,
        fingerprints: intStats.totalFingerprints,
        merkleTrees: intStats.totalMerkleTrees,
        tamperDetected: tamper.tampered,
      },
      grounding: {
        agentStats: groundStats,
        recentValidations: recentGrounding.slice(0, 5).map((h) => ({
          agentId: h.agentId,
          score: h.result.groundingScore,
          claims: h.result.totalClaims,
          timestamp: h.timestamp,
        })),
      },
      biases: {
        agentStats: biasStatMap,
        recentDetections: recentBiases.slice(0, 5).map((h) => ({
          agentId: h.agentId,
          score: h.result.biasScore,
          dominant: h.result.dominantBias,
          count: h.result.biasCount,
          timestamp: h.timestamp,
        })),
      },
    },
    weights: V22_WEIGHTS,
    generatedAt: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// SSE stream endpoint
// ---------------------------------------------------------------------------

benchmarkV22Routes.get("/stream", (c) => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // Send initial burst
      for (const e of v22Events.slice(0, 20)) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      }

      const interval = setInterval(() => {
        const latest = v22Events[0];
        if (latest) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(latest)}\n\n`));
        } else {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        }
      }, 5000);

      // Cleanup after 5 minutes
      setTimeout(() => {
        clearInterval(interval);
        controller.close();
      }, 300_000);
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
// Export endpoint
// ---------------------------------------------------------------------------

benchmarkV22Routes.get("/export", (c) => {
  const scores = computeAllScores();
  const groundStats = getAgentGroundingStats();
  const biasStatMap = getAgentBiasStats();

  const records = scores.map((s) => ({
    ...s,
    grounding: groundStats[s.agentId] ?? null,
    biases: biasStatMap[s.agentId] ?? null,
    benchmark: "moltapp-v22",
  }));

  const jsonl = records.map((r) => JSON.stringify(r)).join("\n");
  return new Response(jsonl, {
    headers: {
      "Content-Type": "application/jsonl",
      "Content-Disposition": `attachment; filename="moltapp-v22-export.jsonl"`,
    },
  });
});

// ---------------------------------------------------------------------------
// Dashboard HTML
// ---------------------------------------------------------------------------

benchmarkV22Routes.get("/", (c) => {
  const scores = computeAllScores();
  const intStats = getIntegrityStats();
  const groundStats = getAgentGroundingStats();
  const biasStatMap = getAgentBiasStats();
  const tamper = runTamperCheck();
  const recentBiases = getBiasHistory(5);

  const agentColors: Record<string, string> = {
    "claude-value-investor": "#D97706",
    "gpt-momentum-trader": "#059669",
    "grok-contrarian": "#7C3AED",
  };

  const rankEmoji = (r: number) => r === 1 ? "1st" : r === 2 ? "2nd" : `${r}th`;

  return c.html(html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MoltApp Benchmark v22 - 28 Pillar AI Trading Benchmark</title>
  <meta http-equiv="refresh" content="30" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0a0a0f; color: #e0e0e0; font-family: 'SF Mono', 'Fira Code', monospace; }
    .header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 24px; border-bottom: 2px solid #00ff88; text-align: center; }
    .header h1 { font-size: 28px; color: #00ff88; margin-bottom: 4px; }
    .header .version { color: #888; font-size: 14px; }
    .header .badges { margin-top: 8px; display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
    .badge { padding: 4px 12px; border-radius: 12px; font-size: 11px; font-weight: bold; }
    .badge-green { background: #00ff8820; color: #00ff88; border: 1px solid #00ff8840; }
    .badge-blue { background: #3b82f620; color: #60a5fa; border: 1px solid #3b82f640; }
    .badge-purple { background: #8b5cf620; color: #a78bfa; border: 1px solid #8b5cf640; }
    .badge-amber { background: #f59e0b20; color: #fbbf24; border: 1px solid #f59e0b40; }
    .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 16px; margin-top: 16px; }
    .card { background: #111827; border: 1px solid #1f2937; border-radius: 12px; padding: 16px; }
    .card h2 { color: #00ff88; font-size: 16px; margin-bottom: 12px; }
    .card h3 { color: #60a5fa; font-size: 14px; margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 8px 10px; text-align: left; font-size: 13px; }
    th { color: #9ca3af; border-bottom: 1px solid #374151; font-size: 11px; text-transform: uppercase; }
    td { border-bottom: 1px solid #1f2937; }
    .score { font-weight: bold; }
    .score-high { color: #00ff88; }
    .score-mid { color: #fbbf24; }
    .score-low { color: #ef4444; }
    .agent-name { font-weight: bold; }
    .grade { font-size: 18px; font-weight: bold; }
    .new-badge { background: #ff006620; color: #ff0066; border: 1px solid #ff006640; padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-left: 4px; }
    .integrity-bar { height: 8px; border-radius: 4px; background: #1f2937; overflow: hidden; margin-top: 4px; }
    .integrity-fill { height: 100%; border-radius: 4px; transition: width 0.5s; }
    .bias-tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; margin: 2px; }
    .bias-anchoring { background: #ef444420; color: #fca5a5; }
    .bias-confirmation { background: #f59e0b20; color: #fde68a; }
    .bias-recency { background: #3b82f620; color: #93c5fd; }
    .bias-overconfidence { background: #8b5cf620; color: #c4b5fd; }
    .bias-herding { background: #06b6d420; color: #67e8f9; }
    .bias-sunk_cost { background: #f9731620; color: #fdba74; }
    .bias-loss_aversion { background: #ec489920; color: #f9a8d4; }
    .pillar-bar { display: flex; align-items: center; margin: 2px 0; font-size: 11px; }
    .pillar-name { width: 160px; color: #9ca3af; }
    .pillar-fill-bg { flex: 1; height: 6px; background: #1f2937; border-radius: 3px; overflow: hidden; }
    .pillar-fill { height: 100%; border-radius: 3px; }
    .pillar-val { width: 40px; text-align: right; color: #d1d5db; }
    .footer { text-align: center; padding: 16px; color: #6b7280; font-size: 12px; margin-top: 16px; }
    .footer a { color: #60a5fa; text-decoration: none; }
  </style>
</head>
<body>
  <div class="header">
    <h1>MoltApp Benchmark v22</h1>
    <div class="version">28-Pillar AI Trading Benchmark | Live on Solana</div>
    <div class="badges">
      <span class="badge badge-green">28 SCORING PILLARS</span>
      <span class="badge badge-blue">SHA-256 INTEGRITY</span>
      <span class="badge badge-purple">COGNITIVE BIAS DETECTION</span>
      <span class="badge badge-amber">GROUNDING VALIDATION</span>
    </div>
  </div>

  <div class="container">
    <!-- Leaderboard -->
    <div class="card" style="margin-top:8px;">
      <h2>LEADERBOARD</h2>
      <table>
        <tr>
          <th>Rank</th><th>Agent</th><th>Composite</th><th>Grade</th>
          <th>Grounding</th><th>Bias-Free</th><th>Integrity</th>
        </tr>
        ${scores.map((s) => {
          const color = agentColors[s.agentId] ?? "#666";
          const gs = groundStats[s.agentId];
          const bs = biasStatMap[s.agentId];
          const grounding = gs?.avgGroundingScore ?? 0.5;
          const biasFree = bs ? 1 - bs.avgBiasScore : 0.5;
          return html`<tr>
            <td><b>${rankEmoji(s.rank)}</b></td>
            <td class="agent-name" style="color:${color}">${s.agentId}</td>
            <td class="score ${s.composite >= 0.7 ? "score-high" : s.composite >= 0.5 ? "score-mid" : "score-low"}">${s.composite.toFixed(2)}</td>
            <td class="grade" style="color:${s.composite >= 0.7 ? "#00ff88" : s.composite >= 0.5 ? "#fbbf24" : "#ef4444"}">${s.grade}</td>
            <td class="score ${grounding >= 0.7 ? "score-high" : grounding >= 0.5 ? "score-mid" : "score-low"}">${grounding.toFixed(2)}</td>
            <td class="score ${biasFree >= 0.7 ? "score-high" : biasFree >= 0.5 ? "score-mid" : "score-low"}">${biasFree.toFixed(2)}</td>
            <td class="score score-high">${intStats.overallIntegrity.toFixed(2)}</td>
          </tr>`;
        })}
      </table>
    </div>

    <div class="grid">
      <!-- v22 Feature: Integrity -->
      <div class="card">
        <h2>BENCHMARK INTEGRITY <span class="new-badge">v22 NEW</span></h2>
        <p style="color:#9ca3af;font-size:12px;margin-bottom:8px;">Cryptographic verification: SHA-256 fingerprints + Merkle audit trees</p>
        <div style="display:flex;gap:16px;flex-wrap:wrap;">
          <div>
            <div style="color:#9ca3af;font-size:11px;">INTEGRITY SCORE</div>
            <div style="font-size:24px;font-weight:bold;color:${intStats.overallIntegrity >= 0.9 ? "#00ff88" : "#fbbf24"}">${(intStats.overallIntegrity * 100).toFixed(0)}%</div>
          </div>
          <div>
            <div style="color:#9ca3af;font-size:11px;">FINGERPRINTS</div>
            <div style="font-size:24px;font-weight:bold;color:#60a5fa;">${intStats.totalFingerprints}</div>
          </div>
          <div>
            <div style="color:#9ca3af;font-size:11px;">MERKLE TREES</div>
            <div style="font-size:24px;font-weight:bold;color:#a78bfa;">${intStats.totalMerkleTrees}</div>
          </div>
          <div>
            <div style="color:#9ca3af;font-size:11px;">TAMPER STATUS</div>
            <div style="font-size:14px;font-weight:bold;color:${tamper.tampered ? "#ef4444" : "#00ff88"}">${tamper.tampered ? "ALERT" : "CLEAN"}</div>
          </div>
        </div>
        <div class="integrity-bar" style="margin-top:12px;">
          <div class="integrity-fill" style="width:${intStats.overallIntegrity * 100}%;background:${intStats.overallIntegrity >= 0.9 ? "#00ff88" : "#fbbf24"};"></div>
        </div>
      </div>

      <!-- v22 Feature: Grounding -->
      <div class="card">
        <h2>REASONING GROUNDING <span class="new-badge">v22 NEW</span></h2>
        <p style="color:#9ca3af;font-size:12px;margin-bottom:8px;">Verifies factual claims against real market data</p>
        <table>
          <tr><th>Agent</th><th>Score</th><th>Claims</th><th>Grounded</th><th>Halluc.</th></tr>
          ${Object.entries(groundStats).map(([agentId, stat]) => {
            const color = agentColors[agentId] ?? "#666";
            return html`<tr>
              <td style="color:${color}">${agentId.split("-")[0]}</td>
              <td class="score ${stat.avgGroundingScore >= 0.7 ? "score-high" : stat.avgGroundingScore >= 0.5 ? "score-mid" : "score-low"}">${stat.avgGroundingScore.toFixed(2)}</td>
              <td>${stat.totalClaims}</td>
              <td style="color:#00ff88">${(stat.groundedRate * 100).toFixed(0)}%</td>
              <td style="color:#ef4444">${(stat.hallucinationRate * 100).toFixed(0)}%</td>
            </tr>`;
          })}
          ${Object.keys(groundStats).length === 0 ? html`<tr><td colspan="5" style="color:#6b7280">No grounding data yet — run trading rounds</td></tr>` : ""}
        </table>
      </div>

      <!-- v22 Feature: Cognitive Biases -->
      <div class="card">
        <h2>COGNITIVE BIAS DETECTION <span class="new-badge">v22 NEW</span></h2>
        <p style="color:#9ca3af;font-size:12px;margin-bottom:8px;">Identifies reasoning errors: anchoring, confirmation, recency, overconfidence, herding</p>
        <table>
          <tr><th>Agent</th><th>Bias Score</th><th>Total</th><th>Dominant</th></tr>
          ${Object.entries(biasStatMap).map(([agentId, stat]) => {
            const color = agentColors[agentId] ?? "#666";
            const biasColor = stat.avgBiasScore <= 0.2 ? "#00ff88" : stat.avgBiasScore <= 0.5 ? "#fbbf24" : "#ef4444";
            return html`<tr>
              <td style="color:${color}">${agentId.split("-")[0]}</td>
              <td class="score" style="color:${biasColor}">${stat.avgBiasScore.toFixed(2)}</td>
              <td>${stat.totalBiases}</td>
              <td>${stat.dominantBias ? html`<span class="bias-tag bias-${stat.dominantBias}">${stat.dominantBias}</span>` : "-"}</td>
            </tr>`;
          })}
          ${Object.keys(biasStatMap).length === 0 ? html`<tr><td colspan="4" style="color:#6b7280">No bias data yet — run trading rounds</td></tr>` : ""}
        </table>

        ${recentBiases.length > 0 ? html`
        <h3 style="margin-top:12px;">Recent Detections</h3>
        ${recentBiases.map((b) => html`
          <div style="margin:4px 0;font-size:11px;padding:4px 8px;background:#1f2937;border-radius:4px;">
            <span style="color:${agentColors[b.agentId] ?? "#666"}">${b.agentId.split("-")[0]}</span>
            ${b.result.detections.map((d) => html`<span class="bias-tag bias-${d.type}">${d.type}</span>`)}
            <span style="color:#6b7280"> | score: ${b.result.biasScore.toFixed(2)}</span>
          </div>
        `)}` : ""}
      </div>

      <!-- Pillar Breakdown for #1 Agent -->
      <div class="card">
        <h2>PILLAR BREAKDOWN${scores.length > 0 ? html` — ${scores[0].agentId}` : ""}</h2>
        ${scores.length > 0 ? Object.entries(scores[0].pillars)
          .sort(([, a], [, b]) => b - a)
          .map(([name, val]) => {
            const isNew = ["benchmark_integrity", "reasoning_grounding", "cognitive_bias"].includes(name);
            const pctWidth = Math.max(2, val * 100);
            const barColor = val >= 0.7 ? "#00ff88" : val >= 0.5 ? "#fbbf24" : "#ef4444";
            return html`<div class="pillar-bar">
              <span class="pillar-name">${name.replace(/_/g, " ")}${isNew ? html`<span class="new-badge">NEW</span>` : ""}</span>
              <div class="pillar-fill-bg"><div class="pillar-fill" style="width:${pctWidth}%;background:${barColor};"></div></div>
              <span class="pillar-val">${val.toFixed(2)}</span>
            </div>`;
          }) : html`<p style="color:#6b7280">No data yet</p>`}
      </div>
    </div>
  </div>

  <div class="footer">
    <a href="https://www.patgpt.us">www.patgpt.us</a> |
    <a href="https://huggingface.co/datasets/patruff/molt-benchmark">HuggingFace Dataset</a> |
    <a href="/api/v1/benchmark-v22/scores">API</a> |
    <a href="/benchmark-v22/data">JSON Data</a> |
    <a href="/benchmark-v22/export">JSONL Export</a>
    <br/>v22 — 28 Pillar AI Trading Benchmark | Auto-refreshes every 30s
  </div>
</body>
</html>`);
});
