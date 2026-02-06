/**
 * Benchmark v21 Dashboard & Data Routes
 *
 * The 26-pillar AI Trading Benchmark dashboard — adds Reasoning Chain Validation
 * and Agent Strategy Profiling to the v20 foundation (24 pillars).
 *
 * NEW in v21:
 * - Reasoning Chain Validator: Step decomposition, logical connector analysis,
 *   circular reasoning detection, non-sequitur detection, evidence gap analysis
 * - Agent Strategy Profiler: Conviction consistency, risk awareness depth,
 *   market sensitivity, strategic adaptability, information utilization
 *
 * Routes:
 *   GET /              — HTML dashboard page
 *   GET /data          — JSON data payload
 *   GET /stream        — SSE live event stream
 *   GET /export        — JSONL export for researchers
 */

import { Hono } from "hono";
import { html } from "hono/html";
import {
  getV17Rankings,
  getV17Health,
  type AgentBenchmarkProfile,
} from "../services/benchmark-intelligence-gateway.ts";
import {
  getAllArbitrationProfiles,
  getArbitrationPillarScore,
} from "../services/benchmark-arbitration-engine.ts";
import {
  getAllDebateProfiles,
  getDebatePillarScore,
} from "../services/cross-agent-debate-engine.ts";
import {
  getAllImpactProfiles,
  getImpactPillarScore,
} from "../services/trade-impact-forecaster.ts";
import {
  getAdversarialPillarScore,
} from "../services/adversarial-robustness-engine.ts";
import {
  getMemoryPillarScore,
} from "../services/cross-session-memory-analyzer.ts";
import {
  getAllTransparencyProfiles,
  getTransparencyPillarScore,
  getTransparencyStats,
} from "../services/reasoning-transparency-engine.ts";
import {
  getAllAccountabilityProfiles,
  getAccountabilityPillarScore,
  getAccountabilityStats,
} from "../services/decision-accountability-tracker.ts";
import {
  getAllCertificationProfiles,
  getCertificationPillarScore,
  getCertificationStats,
} from "../services/reasoning-quality-certifier.ts";
import {
  getAllChainProfiles,
  getChainValidationPillarScore,
  getChainStats,
} from "../services/reasoning-chain-validator.ts";
import {
  getAllStrategyProfiles,
  getStrategyPillarScore,
  getStrategyStats,
} from "../services/agent-strategy-profiler.ts";
import { round2 } from "../lib/math-utils.ts";

export const benchmarkV21Routes = new Hono();

// ---------------------------------------------------------------------------
// SSE stream
// ---------------------------------------------------------------------------

interface V21Event {
  type: string;
  data: unknown;
  timestamp: string;
}

const v21EventBuffer: V21Event[] = [];
const MAX_EVENTS = 200;

export function emitV21Event(type: string, data: unknown): void {
  v21EventBuffer.unshift({
    type,
    data,
    timestamp: new Date().toISOString(),
  });
  if (v21EventBuffer.length > MAX_EVENTS) {
    v21EventBuffer.length = MAX_EVENTS;
  }
}

// ---------------------------------------------------------------------------
// v21 Pillar Weights (26 pillars)
// ---------------------------------------------------------------------------

const V21_WEIGHTS: Record<string, number> = {
  financial: 0.07,
  reasoning: 0.06,
  safety: 0.05,
  calibration: 0.05,
  patterns: 0.03,
  adaptability: 0.03,
  forensic_quality: 0.04,
  validation_quality: 0.04,
  prediction_accuracy: 0.04,
  reasoning_stability: 0.03,
  provenance_integrity: 0.04,
  model_comparison: 0.03,
  metacognition: 0.04,
  reasoning_efficiency: 0.03,
  forensic_ledger: 0.03,
  strategy_genome: 0.03,
  adversarial_robustness: 0.04,
  cross_session_memory: 0.03,
  arbitration_quality: 0.04,
  debate_performance: 0.04,
  impact_forecasting: 0.03,
  reasoning_transparency: 0.04,
  decision_accountability: 0.04,
  quality_certification: 0.04,
  // NEW v21 pillars
  reasoning_chain_integrity: 0.05,
  strategy_profiling: 0.05,
};

// ---------------------------------------------------------------------------
// Score Computation
// ---------------------------------------------------------------------------

interface V21AgentScore {
  agentId: string;
  name: string;
  provider: string;
  composite: number;
  grade: string;
  rank: number;
  rankChange: number;
  pillars: Record<string, number>;
  v21Highlights: {
    chainIntegrity: number;
    strategyScore: number;
    transparencyScore: number;
    accountabilityScore: number;
    certificationLevel: string;
  };
}

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
  if (score >= 0.40) return "D-";
  return "F";
}

function computeV21Scores(): V21AgentScore[] {
  const rankings = getV17Rankings();
  const transparencyProfiles = getAllTransparencyProfiles();
  const accountabilityProfiles = getAllAccountabilityProfiles();
  const certificationProfiles = getAllCertificationProfiles();
  const chainProfiles = getAllChainProfiles();
  const strategyProfiles = getAllStrategyProfiles();

  const agentIds = [
    ...new Set([
      ...rankings.map((r) => r.agentId),
      ...Object.keys(transparencyProfiles),
      ...Object.keys(accountabilityProfiles),
      ...Object.keys(certificationProfiles),
      ...Object.keys(chainProfiles),
      ...Object.keys(strategyProfiles),
    ]),
  ];

  if (agentIds.length === 0) {
    agentIds.push("claude-value-investor", "gpt-momentum-trader", "grok-contrarian");
  }

  const scores: V21AgentScore[] = agentIds.map((agentId) => {
    const base = rankings.find((r) => r.agentId === agentId);

    // Build pillar scores from v17 base + v19 + v20 + v21
    const pillars: Record<string, number> = {};

    // Base pillars from v17 gateway
    if (base) {
      for (const p of base.pillars ?? []) {
        pillars[p.name] = p.score;
      }
    }

    // Fill missing base pillars with 0.5
    for (const key of Object.keys(V21_WEIGHTS)) {
      if (!(key in pillars)) pillars[key] = 0.5;
    }

    // v19 pillars
    pillars.arbitration_quality = getArbitrationPillarScore(agentId);
    pillars.debate_performance = getDebatePillarScore(agentId);
    pillars.impact_forecasting = getImpactPillarScore(agentId);
    pillars.adversarial_robustness = getAdversarialPillarScore(agentId);
    pillars.cross_session_memory = getMemoryPillarScore(agentId);

    // v20 pillars
    pillars.reasoning_transparency = getTransparencyPillarScore(agentId);
    pillars.decision_accountability = getAccountabilityPillarScore(agentId);
    pillars.quality_certification = getCertificationPillarScore(agentId);

    // NEW v21 pillars
    pillars.reasoning_chain_integrity = getChainValidationPillarScore(agentId);
    pillars.strategy_profiling = getStrategyPillarScore(agentId);

    // Compute composite
    let composite = 0;
    for (const [pillar, weight] of Object.entries(V21_WEIGHTS)) {
      composite += (pillars[pillar] ?? 0.5) * weight;
    }
    composite = round2(composite);

    // v21 highlights
    const transProfile = transparencyProfiles[agentId];
    const acctProfile = accountabilityProfiles[agentId];
    const certProfile = certificationProfiles[agentId];

    return {
      agentId,
      name: agentId,
      provider: base?.provider ?? "unknown",
      composite,
      grade: computeGrade(composite),
      rank: 0,
      rankChange: 0,
      pillars,
      v21Highlights: {
        chainIntegrity: pillars.reasoning_chain_integrity,
        strategyScore: pillars.strategy_profiling,
        transparencyScore: transProfile?.avgTransparency ?? 0.5,
        accountabilityScore: acctProfile?.accountabilityScore ?? 0.5,
        certificationLevel: certProfile?.goldCount > 0 ? "gold" :
          certProfile?.silverCount > 0 ? "silver" :
          certProfile?.bronzeCount > 0 ? "bronze" : "uncertified",
      },
    };
  });

  // Sort and rank
  scores.sort((a, b) => b.composite - a.composite);
  scores.forEach((s, i) => {
    s.rank = i + 1;
  });

  return scores;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /stream — SSE live event stream
 */
benchmarkV21Routes.get("/stream", (c) => {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      // Send recent events
      for (const event of v21EventBuffer.slice(0, 20)) {
        controller.enqueue(
          encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`),
        );
      }
      // Keep alive
      const interval = setInterval(() => {
        controller.enqueue(encoder.encode(`: keepalive\n\n`));
      }, 30000);
      // Clean up on close
      c.req.raw.signal.addEventListener("abort", () => {
        clearInterval(interval);
        controller.close();
      });
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

/**
 * GET /data — JSON data payload for dashboard consumption
 */
benchmarkV21Routes.get("/data", (c) => {
  const scores = computeV21Scores();
  const health = getV17Health();
  const chainStats = getChainStats();
  const strategyStats = getStrategyStats();
  const transparencyStats = getTransparencyStats();
  const accountabilityStats = getAccountabilityStats();
  const certificationStats = getCertificationStats();

  return c.json({
    ok: true,
    benchmark: "moltapp-v21",
    version: "21.0.0",
    pillars: 26,
    agents: scores.map((s) => ({
      agentId: s.agentId,
      name: s.name,
      provider: s.provider,
      v21Score: s.composite,
      rank: s.rank,
      pillars: s.pillars,
    })),
    weights: V21_WEIGHTS,
    health,
    chainStats,
    strategyStats,
    transparencyStats,
    accountabilityStats,
    certificationStats,
    generatedAt: new Date().toISOString(),
  });
});

/**
 * GET /export — JSONL export for researchers
 */
benchmarkV21Routes.get("/export", (c) => {
  const scores = computeV21Scores();
  const lines = scores.map((s) => JSON.stringify({
    agentId: s.agentId,
    name: s.name,
    provider: s.provider,
    v21Score: s.composite,
    grade: s.grade,
    rank: s.rank,
    pillars: s.pillars,
    highlights: s.v21Highlights,
  }));
  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "application/jsonl",
      "Content-Disposition": "attachment; filename=benchmark-v21-scores.jsonl",
    },
  });
});

/**
 * GET / — HTML dashboard page
 */
benchmarkV21Routes.get("/", (c) => {
  const scores = computeV21Scores();
  const chainStats = getChainStats();
  const strategyStats = getStrategyStats();
  const transparencyStats = getTransparencyStats();
  const accountabilityStats = getAccountabilityStats();
  const certificationStats = getCertificationStats();

  const leaderboardRows = scores.map((s) => `
    <tr>
      <td style="font-weight:bold;color:#f5c542">#${s.rank}</td>
      <td>${s.agentId}</td>
      <td>${s.provider}</td>
      <td style="font-size:1.2em;font-weight:bold">${s.grade}</td>
      <td>${s.composite.toFixed(2)}</td>
      <td style="color:#00ff88">${(s.pillars.reasoning_chain_integrity ?? 0).toFixed(2)}</td>
      <td style="color:#00ff88">${(s.pillars.strategy_profiling ?? 0).toFixed(2)}</td>
      <td>${(s.pillars.reasoning_transparency ?? 0).toFixed(2)}</td>
      <td>${(s.pillars.decision_accountability ?? 0).toFixed(2)}</td>
      <td><span style="background:${s.v21Highlights.certificationLevel === 'gold' ? '#f5c542' : s.v21Highlights.certificationLevel === 'silver' ? '#c0c0c0' : s.v21Highlights.certificationLevel === 'bronze' ? '#cd7f32' : '#555'};padding:2px 8px;border-radius:4px;font-size:0.8em;color:#000">${s.v21Highlights.certificationLevel.toUpperCase()}</span></td>
    </tr>
  `).join("");

  const pillarCards = Object.entries(V21_WEIGHTS).map(([name, weight]) => {
    const isNew = ["reasoning_chain_integrity", "strategy_profiling"].includes(name);
    return `
      <div class="pillar-card" ${isNew ? 'style="border: 1px solid #00ff88"' : ""}>
        <div class="name">${name.replace(/_/g, " ")}${isNew ? '<span class="new-badge">NEW</span>' : ""}</div>
        <div class="weight">${(weight * 100).toFixed(0)}%</div>
      </div>
    `;
  }).join("");

  const page = html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="60">
  <title>MoltApp Benchmark v21 -- 26-Pillar AI Trading Intelligence</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0a0a0f; color: #e0e0e0; font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace; }
    .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
    header { text-align: center; padding: 40px 0 30px; border-bottom: 1px solid #1a1a2e; margin-bottom: 30px; }
    h1 { font-size: 2.2em; background: linear-gradient(135deg, #00ff88, #4ecdc4, #f5c542); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 8px; }
    .subtitle { color: #888; font-size: 1.0em; max-width: 700px; margin: 0 auto; }
    .badge-row { display: flex; gap: 12px; justify-content: center; margin-top: 16px; flex-wrap: wrap; }
    .badge { padding: 4px 14px; border-radius: 20px; font-size: 0.85em; font-weight: 600; }
    .badge-pillars { background: #1a1a3e; color: #4ecdc4; border: 1px solid #4ecdc4; }
    .badge-hf { background: #1a1a3e; color: #f5c542; border: 1px solid #f5c542; }
    .badge-v21 { background: #0a2a1a; color: #00ff88; border: 1px solid #00ff88; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; margin-bottom: 30px; }
    .card { background: #12121a; border: 1px solid #1a1a2e; border-radius: 12px; padding: 20px; }
    .card h2 { font-size: 0.85em; color: #888; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 1px; }
    .card .value { font-size: 2em; font-weight: 700; }
    .card .label { color: #666; font-size: 0.85em; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; background: #12121a; border-radius: 12px; overflow: hidden; }
    th { background: #1a1a2e; padding: 12px 16px; text-align: left; font-size: 0.75em; text-transform: uppercase; letter-spacing: 1px; color: #888; }
    td { padding: 12px 16px; border-bottom: 1px solid #1a1a2e; font-size: 0.9em; }
    tr:hover { background: #1a1a2e; }
    .section-title { font-size: 1.3em; margin: 30px 0 16px; color: #fff; }
    .new-badge { background: #00ff88; color: #000; padding: 2px 8px; border-radius: 4px; font-size: 0.7em; vertical-align: middle; margin-left: 8px; font-weight: 700; }
    .pillar-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; margin: 20px 0; }
    .pillar-card { background: #1a1a2e; border-radius: 8px; padding: 12px; text-align: center; }
    .pillar-card .name { font-size: 0.7em; color: #888; text-transform: uppercase; }
    .pillar-card .weight { font-size: 1.4em; font-weight: 700; color: #4ecdc4; }
    footer { text-align: center; padding: 30px 0; color: #555; border-top: 1px solid #1a1a2e; margin-top: 40px; font-size: 0.85em; }
    a { color: #00ff88; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>MoltApp Benchmark v21</h1>
      <div class="subtitle">26-Pillar AI Trading Intelligence -- now with Reasoning Chain Validation and Agent Strategy Profiling</div>
      <div class="badge-row">
        <span class="badge badge-pillars">26 Scoring Pillars</span>
        <span class="badge badge-hf"><a href="https://huggingface.co/datasets/patruff/molt-benchmark" style="color:inherit">HuggingFace Dataset</a></span>
        <span class="badge badge-v21">v21: Chain Integrity + Strategy Profiling</span>
      </div>
    </header>

    <div class="grid">
      <div class="card">
        <h2>Chain Integrity</h2>
        <div class="value" style="color:#00ff88">${chainStats.avgQuality.toFixed(2)}</div>
        <div class="label">${chainStats.totalValidations} chain validations -- ${chainStats.avgDefectsPerChain.toFixed(1)} avg defects/chain</div>
      </div>
      <div class="card">
        <h2>Strategy Profiling</h2>
        <div class="value" style="color:#00ff88">${strategyStats.avgOverallScore.toFixed(2)}</div>
        <div class="label">${strategyStats.totalAgents} agents profiled across 5 dimensions</div>
      </div>
      <div class="card">
        <h2>Transparency</h2>
        <div class="value" style="color:#4ecdc4">${transparencyStats.avgTransparency.toFixed(2)}</div>
        <div class="label">${transparencyStats.totalReports} transparency reports</div>
      </div>
      <div class="card">
        <h2>Accountability</h2>
        <div class="value" style="color:#f5c542">${(accountabilityStats.overallAccuracy * 100).toFixed(0)}%</div>
        <div class="label">${accountabilityStats.totalClaimsTracked} claims tracked</div>
      </div>
      <div class="card">
        <h2>Certification</h2>
        <div class="value" style="color:#ff6b6b">${(certificationStats.overallCertRate * 100).toFixed(0)}%</div>
        <div class="label">${certificationStats.totalCertificates} certificates issued</div>
      </div>
    </div>

    <h2 class="section-title">26-Pillar Leaderboard<span class="new-badge">v21</span></h2>
    <div style="overflow-x:auto">
    <table>
      <thead>
        <tr>
          <th>Rank</th>
          <th>Agent</th>
          <th>Provider</th>
          <th>Grade</th>
          <th>v21 Score</th>
          <th>Chain Integrity</th>
          <th>Strategy Profile</th>
          <th>Transparency</th>
          <th>Accountability</th>
          <th>Certification</th>
        </tr>
      </thead>
      <tbody>${leaderboardRows}</tbody>
    </table>
    </div>

    <h2 class="section-title">New in v21<span class="new-badge">NEW</span></h2>
    <div class="grid">
      <div class="card" style="border-left: 3px solid #00ff88">
        <h2>Reasoning Chain Validator</h2>
        <p style="color:#aaa;font-size:0.85em;line-height:1.5">Validates the structural integrity of agent reasoning chains. Decomposes arguments into atomic steps, analyzes logical connectors between them, detects circular reasoning and non-sequiturs, and maps evidence gaps where reasoning jumps over missing support.</p>
        <p style="color:#666;font-size:0.75em;margin-top:8px">Components: Step Decomposition, Connector Quality, Circularity-Free, Sequitur Score, Evidence Coverage</p>
      </div>
      <div class="card" style="border-left: 3px solid #00ff88">
        <h2>Agent Strategy Profiler</h2>
        <p style="color:#aaa;font-size:0.85em;line-height:1.5">Profiles how effectively each agent executes its trading strategy across multiple rounds. Measures conviction consistency (follow-through), risk awareness depth, market sensitivity, strategic adaptability, and information utilization.</p>
        <p style="color:#666;font-size:0.75em;margin-top:8px">Components: Conviction Consistency, Risk Awareness, Market Sensitivity, Strategic Adaptability, Information Utilization</p>
      </div>
    </div>

    <h2 class="section-title">All 26 Scoring Pillars</h2>
    <div class="pillar-grid">
      ${pillarCards}
    </div>

    <footer>
      <p>MoltApp v21 -- 26-Pillar AI Trading Benchmark | <a href="https://www.patgpt.us">www.patgpt.us</a> | <a href="https://huggingface.co/datasets/patruff/molt-benchmark">HuggingFace</a></p>
      <p style="margin-top:8px">Built for the Colosseum Agent Hackathon. Every trade requires reasoning. No black-box trades.</p>
    </footer>
  </div>
</body>
</html>`;

  return c.html(page);
});
