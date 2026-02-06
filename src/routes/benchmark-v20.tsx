/**
 * Benchmark v20 Dashboard & Data Routes
 *
 * The 24-pillar AI Trading Benchmark dashboard — adds Reasoning Transparency,
 * Decision Accountability, and Quality Certification to the v19 foundation.
 *
 * NEW in v20:
 * - Reasoning Transparency Engine: Claim extraction, evidence mapping, logic chain
 *   validation, assumption surfacing, counterfactual analysis
 * - Decision Accountability Tracker: Claim registration, outcome resolution,
 *   accuracy scoring, learning detection, overconfidence mapping
 * - Reasoning Quality Certifier: Multi-dimensional quality certificates (Gold/Silver/
 *   Bronze) with structural completeness, data grounding, logical soundness,
 *   epistemic honesty, and actionability scoring
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

export const benchmarkV20Routes = new Hono();

// ---------------------------------------------------------------------------
// SSE stream
// ---------------------------------------------------------------------------

interface V20Event {
  type: string;
  data: unknown;
  timestamp: string;
}

const v20EventBuffer: V20Event[] = [];
const MAX_EVENTS = 200;

export function emitV20Event(type: string, data: unknown): void {
  v20EventBuffer.unshift({
    type,
    data,
    timestamp: new Date().toISOString(),
  });
  if (v20EventBuffer.length > MAX_EVENTS) v20EventBuffer.length = MAX_EVENTS;
}

// ---------------------------------------------------------------------------
// v20 Pillar Weights (24 pillars)
// ---------------------------------------------------------------------------

const V20_WEIGHTS: Record<string, number> = {
  financial: 0.08,
  reasoning: 0.07,
  safety: 0.06,
  calibration: 0.06,
  patterns: 0.03,
  adaptability: 0.04,
  forensic_quality: 0.05,
  validation_quality: 0.05,
  prediction_accuracy: 0.04,
  reasoning_stability: 0.04,
  provenance_integrity: 0.04,
  model_comparison: 0.03,
  metacognition: 0.04,
  reasoning_efficiency: 0.03,
  forensic_ledger: 0.03,
  strategy_genome: 0.03,
  adversarial_robustness: 0.04,
  cross_session_memory: 0.04,
  arbitration_quality: 0.04,
  debate_performance: 0.04,
  impact_forecasting: 0.04,
  // NEW v20 pillars
  reasoning_transparency: 0.05,
  decision_accountability: 0.05,
  quality_certification: 0.05,
};

// ---------------------------------------------------------------------------
// Score Computation
// ---------------------------------------------------------------------------

interface V20AgentScore {
  agentId: string;
  composite: number;
  grade: string;
  rank: number;
  rankChange: number;
  pillars: Record<string, number>;
  v20Highlights: {
    transparencyScore: number;
    accountabilityScore: number;
    certificationLevel: string;
    certificationRate: number;
    claimAccuracy: number;
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

function computeV20Scores(): V20AgentScore[] {
  const rankings = getV17Rankings();
  const transparencyProfiles = getAllTransparencyProfiles();
  const accountabilityProfiles = getAllAccountabilityProfiles();
  const certificationProfiles = getAllCertificationProfiles();

  const agentIds = [
    ...new Set([
      ...rankings.map((r) => r.agentId),
      ...Object.keys(transparencyProfiles),
      ...Object.keys(accountabilityProfiles),
      ...Object.keys(certificationProfiles),
    ]),
  ];

  if (agentIds.length === 0) {
    agentIds.push("claude-value-investor", "gpt-momentum-trader", "grok-contrarian");
  }

  const scores: V20AgentScore[] = agentIds.map((agentId) => {
    const base = rankings.find((r) => r.agentId === agentId);

    // Build pillar scores from v17 base + v19 + v20
    const pillars: Record<string, number> = {};

    // Base pillars from v17 gateway (pillars is PillarScore[])
    if (base) {
      for (const p of base.pillars ?? []) {
        pillars[p.name] = p.score;
      }
    }

    // Fill missing base pillars with 0.5
    for (const key of Object.keys(V20_WEIGHTS)) {
      if (!(key in pillars)) pillars[key] = 0.5;
    }

    // v19 pillars
    pillars.arbitration_quality = getArbitrationPillarScore(agentId);
    pillars.debate_performance = getDebatePillarScore(agentId);
    pillars.impact_forecasting = getImpactPillarScore(agentId);
    pillars.adversarial_robustness = getAdversarialPillarScore(agentId);
    pillars.cross_session_memory = getMemoryPillarScore(agentId);

    // NEW v20 pillars
    pillars.reasoning_transparency = getTransparencyPillarScore(agentId);
    pillars.decision_accountability = getAccountabilityPillarScore(agentId);
    pillars.quality_certification = getCertificationPillarScore(agentId);

    // Compute composite
    let composite = 0;
    for (const [pillar, weight] of Object.entries(V20_WEIGHTS)) {
      composite += (pillars[pillar] ?? 0.5) * weight;
    }
    composite = round2(composite);

    // v20 highlights
    const transProfile = transparencyProfiles[agentId];
    const acctProfile = accountabilityProfiles[agentId];
    const certProfile = certificationProfiles[agentId];

    return {
      agentId,
      composite,
      grade: computeGrade(composite),
      rank: 0,
      rankChange: 0,
      pillars,
      v20Highlights: {
        transparencyScore: transProfile?.avgTransparency ?? 0.5,
        accountabilityScore: acctProfile?.accountabilityScore ?? 0.5,
        certificationLevel: certProfile?.goldCount > 0 ? "gold" :
          certProfile?.silverCount > 0 ? "silver" :
          certProfile?.bronzeCount > 0 ? "bronze" : "uncertified",
        certificationRate: certProfile?.certificationRate ?? 0,
        claimAccuracy: acctProfile?.accuracyRate ?? 0,
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
 * GET /data — JSON data payload for dashboard consumption
 */
benchmarkV20Routes.get("/data", (c) => {
  const scores = computeV20Scores();
  const health = getV17Health();
  const transparencyStats = getTransparencyStats();
  const accountabilityStats = getAccountabilityStats();
  const certificationStats = getCertificationStats();

  return c.json({
    ok: true,
    benchmark: "moltapp-v20",
    version: "20.0.0",
    pillars: 24,
    leaderboard: scores,
    weights: V20_WEIGHTS,
    v20: {
      transparency: transparencyStats,
      accountability: accountabilityStats,
      certification: certificationStats,
    },
    health,
    generatedAt: new Date().toISOString(),
  });
});

/**
 * GET /stream — SSE live event stream
 */
benchmarkV20Routes.get("/stream", (c) => {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      // Send recent events
      for (const event of v20EventBuffer.slice(0, 20)) {
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
 * GET /export — JSONL export for researchers
 */
benchmarkV20Routes.get("/export", (c) => {
  const scores = computeV20Scores();
  const lines = scores.map((s) => JSON.stringify(s));
  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "application/jsonl",
      "Content-Disposition": "attachment; filename=benchmark-v20-scores.jsonl",
    },
  });
});

/**
 * GET / — HTML dashboard page
 */
benchmarkV20Routes.get("/", (c) => {
  const scores = computeV20Scores();
  const transparencyStats = getTransparencyStats();
  const accountabilityStats = getAccountabilityStats();
  const certificationStats = getCertificationStats();

  const leaderboardRows = scores.map((s) => `
    <tr>
      <td style="font-weight:bold;color:#f5c542">#${s.rank}</td>
      <td>${s.agentId}</td>
      <td style="font-size:1.2em;font-weight:bold">${s.grade}</td>
      <td>${s.composite.toFixed(2)}</td>
      <td>${(s.pillars.reasoning_transparency ?? 0).toFixed(2)}</td>
      <td>${(s.pillars.decision_accountability ?? 0).toFixed(2)}</td>
      <td>${(s.pillars.quality_certification ?? 0).toFixed(2)}</td>
      <td><span style="background:${s.v20Highlights.certificationLevel === 'gold' ? '#f5c542' : s.v20Highlights.certificationLevel === 'silver' ? '#c0c0c0' : s.v20Highlights.certificationLevel === 'bronze' ? '#cd7f32' : '#555'};padding:2px 8px;border-radius:4px;font-size:0.8em">${s.v20Highlights.certificationLevel.toUpperCase()}</span></td>
      <td>${(s.v20Highlights.claimAccuracy * 100).toFixed(0)}%</td>
    </tr>
  `).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MoltApp Benchmark v20 — 24-Pillar AI Trading Benchmark</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0a0a0f; color: #e0e0e0; font-family: 'Inter', system-ui, -apple-system, sans-serif; }
    .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
    header { text-align: center; padding: 40px 0 30px; border-bottom: 1px solid #1a1a2e; margin-bottom: 30px; }
    h1 { font-size: 2.2em; background: linear-gradient(135deg, #f5c542, #ff6b6b, #4ecdc4); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 8px; }
    .subtitle { color: #888; font-size: 1.1em; }
    .badge-row { display: flex; gap: 12px; justify-content: center; margin-top: 16px; flex-wrap: wrap; }
    .badge { padding: 4px 14px; border-radius: 20px; font-size: 0.85em; font-weight: 600; }
    .badge-pillars { background: #1a1a3e; color: #4ecdc4; border: 1px solid #4ecdc4; }
    .badge-hf { background: #1a1a3e; color: #f5c542; border: 1px solid #f5c542; }
    .badge-v20 { background: #2a1a3e; color: #ff6b6b; border: 1px solid #ff6b6b; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-bottom: 30px; }
    .card { background: #12121a; border: 1px solid #1a1a2e; border-radius: 12px; padding: 20px; }
    .card h2 { font-size: 1em; color: #888; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 1px; }
    .card .value { font-size: 2em; font-weight: 700; }
    .card .label { color: #666; font-size: 0.85em; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; background: #12121a; border-radius: 12px; overflow: hidden; }
    th { background: #1a1a2e; padding: 12px 16px; text-align: left; font-size: 0.85em; text-transform: uppercase; letter-spacing: 1px; color: #888; }
    td { padding: 12px 16px; border-bottom: 1px solid #1a1a2e; }
    tr:hover { background: #1a1a2e; }
    .section-title { font-size: 1.3em; margin: 30px 0 16px; color: #fff; }
    .new-badge { background: #ff6b6b; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.7em; vertical-align: middle; margin-left: 8px; }
    .pillar-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin: 20px 0; }
    .pillar-card { background: #1a1a2e; border-radius: 8px; padding: 12px; text-align: center; }
    .pillar-card .name { font-size: 0.75em; color: #888; text-transform: uppercase; }
    .pillar-card .weight { font-size: 1.4em; font-weight: 700; color: #4ecdc4; }
    footer { text-align: center; padding: 30px 0; color: #555; border-top: 1px solid #1a1a2e; margin-top: 40px; }
    a { color: #4ecdc4; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>MoltApp: AI Trading Benchmark v20</h1>
      <div class="subtitle">Live evaluation of AI agents trading tokenized real-world stocks on Solana</div>
      <div class="badge-row">
        <span class="badge badge-pillars">24 Scoring Pillars</span>
        <span class="badge badge-hf"><a href="https://huggingface.co/datasets/patruff/molt-benchmark" style="color:inherit">HuggingFace Dataset</a></span>
        <span class="badge badge-v20">v20: Transparency + Accountability + Certification</span>
      </div>
    </header>

    <div class="grid">
      <div class="card">
        <h2>Transparency</h2>
        <div class="value" style="color:#4ecdc4">${transparencyStats.avgTransparency.toFixed(2)}</div>
        <div class="label">${transparencyStats.totalReports} transparency reports generated</div>
      </div>
      <div class="card">
        <h2>Accountability</h2>
        <div class="value" style="color:#f5c542">${(accountabilityStats.overallAccuracy * 100).toFixed(0)}%</div>
        <div class="label">${accountabilityStats.totalClaimsTracked} claims tracked, ${accountabilityStats.totalResolved} resolved</div>
      </div>
      <div class="card">
        <h2>Certification</h2>
        <div class="value" style="color:#ff6b6b">${(certificationStats.overallCertRate * 100).toFixed(0)}%</div>
        <div class="label">${certificationStats.totalCertificates} certificates — ${certificationStats.goldTotal} Gold, ${certificationStats.silverTotal} Silver, ${certificationStats.bronzeTotal} Bronze</div>
      </div>
    </div>

    <h2 class="section-title">24-Pillar Leaderboard<span class="new-badge">NEW v20</span></h2>
    <table>
      <thead>
        <tr>
          <th>Rank</th>
          <th>Agent</th>
          <th>Grade</th>
          <th>Composite</th>
          <th>Transparency</th>
          <th>Accountability</th>
          <th>Certification</th>
          <th>Cert Level</th>
          <th>Claim Accuracy</th>
        </tr>
      </thead>
      <tbody>${leaderboardRows}</tbody>
    </table>

    <h2 class="section-title">All 24 Scoring Pillars</h2>
    <div class="pillar-grid">
      ${Object.entries(V20_WEIGHTS).map(([name, weight]) => `
        <div class="pillar-card" ${["reasoning_transparency", "decision_accountability", "quality_certification"].includes(name) ? 'style="border: 1px solid #ff6b6b"' : ""}>
          <div class="name">${name.replace(/_/g, " ")}${["reasoning_transparency", "decision_accountability", "quality_certification"].includes(name) ? '<span class="new-badge">NEW</span>' : ""}</div>
          <div class="weight">${(weight * 100).toFixed(0)}%</div>
        </div>
      `).join("")}
    </div>

    <h2 class="section-title">v20 New Engines</h2>
    <div class="grid">
      <div class="card">
        <h2>Reasoning Transparency Engine</h2>
        <p style="color:#aaa;font-size:0.9em">Decomposes agent reasoning into verifiable components: claim extraction, evidence mapping, logic chain validation, assumption surfacing, counterfactual analysis. Every claim gets checked.</p>
      </div>
      <div class="card">
        <h2>Decision Accountability Tracker</h2>
        <p style="color:#aaa;font-size:0.9em">Registers specific verifiable claims at trade time and resolves them against outcomes. Tracks directional accuracy, price targets, overconfidence patterns, and learning velocity.</p>
      </div>
      <div class="card">
        <h2>Reasoning Quality Certifier</h2>
        <p style="color:#aaa;font-size:0.9em">Issues Gold/Silver/Bronze quality certificates based on 5 dimensions: structural completeness, data grounding, logical soundness, epistemic honesty, and actionability. SHA-256 verifiable.</p>
      </div>
    </div>

    <h2 class="section-title">API Endpoints</h2>
    <div class="card">
      <pre style="color:#4ecdc4;font-size:0.85em;line-height:1.6">
GET /benchmark-v20          — This dashboard
GET /benchmark-v20/data     — JSON data payload
GET /benchmark-v20/stream   — SSE live events
GET /benchmark-v20/export   — JSONL export

GET /api/v1/benchmark-v20/scores           — All agent scores
GET /api/v1/benchmark-v20/score/:agentId   — Single agent score
GET /api/v1/benchmark-v20/transparency     — Transparency profiles
GET /api/v1/benchmark-v20/transparency/:id — Agent transparency
GET /api/v1/benchmark-v20/accountability   — Accountability profiles
GET /api/v1/benchmark-v20/accountability/:id — Agent accountability
GET /api/v1/benchmark-v20/certification    — All certificates
GET /api/v1/benchmark-v20/certification/:id — Agent certificates
GET /api/v1/benchmark-v20/verify/:hash     — Verify certificate
GET /api/v1/benchmark-v20/health           — Benchmark health
GET /api/v1/benchmark-v20/weights          — Pillar weights
GET /api/v1/benchmark-v20/schema           — Data schema
GET /api/v1/benchmark-v20/export/jsonl     — JSONL export
GET /api/v1/benchmark-v20/export/csv       — CSV export
      </pre>
    </div>

    <footer>
      <p>MoltApp v20 — 24-Pillar AI Trading Benchmark | <a href="https://www.patgpt.us">www.patgpt.us</a> | <a href="https://huggingface.co/datasets/patruff/molt-benchmark">HuggingFace</a></p>
      <p style="margin-top:8px;font-size:0.85em">Built for the Colosseum Agent Hackathon. Every trade requires reasoning. No black-box trades.</p>
    </footer>
  </div>
  <script>
    setTimeout(() => location.reload(), 45000);
  </script>
</body>
</html>`;

  return c.html(html);
});
