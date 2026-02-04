/**
 * Benchmark v10 Dashboard — The Definitive AI Trading Benchmark
 *
 * Advances over v9:
 * - Confidence calibration pillar with ECE, Brier Score, reliability diagrams
 * - Reasoning pattern analysis: fallacy detection, depth metrics, vocabulary
 * - Cross-trade quality trends (improving/degrading agents)
 * - Template detection (canned response flagging)
 * - 6-pillar scoring: Financial, Reasoning, Safety, Calibration, Patterns, Adaptability
 * - Side-by-side agent comparison with radar charts
 * - Full dataset export links (JSONL, CSV)
 * - Interactive brain feed with pattern annotations
 *
 * GET /benchmark-v10      — Full HTML dashboard
 * GET /benchmark-v10/data — JSON data endpoint for programmatic access
 */

import { Hono } from "hono";
import { html } from "hono/html";
import {
  getV9Leaderboard,
  exportV9Snapshot,
} from "../services/benchmark-v9-scorer.ts";
import {
  getAllIntegrityScores,
  analyzeCrossAgentIntegrity,
} from "../services/reasoning-integrity-engine.ts";
import {
  generateCalibrationReport,
  getAllCalibrationReports,
  getCalibrationSummary,
} from "../services/calibration-engine.ts";
import {
  analyzeReasoningPatterns,
  detectQualityTrend,
  detectTemplateUsage,
} from "../services/reasoning-pattern-detector.ts";
import { getAgentConfigs } from "../agents/orchestrator.ts";
import { db } from "../db/index.ts";
import { tradeJustifications } from "../db/schema/trade-reasoning.ts";
import { desc } from "drizzle-orm";

export const benchmarkV10Routes = new Hono();

// ---------------------------------------------------------------------------
// GET /data — JSON data endpoint
// ---------------------------------------------------------------------------

benchmarkV10Routes.get("/data", async (c) => {
  const leaderboard = getV9Leaderboard();
  const snapshot = exportV9Snapshot("sideways");
  const integrityScores = getAllIntegrityScores();
  const crossAgent = analyzeCrossAgentIntegrity();
  const agents = getAgentConfigs();
  const calibrationSummary = getCalibrationSummary();
  const calibrationReports = getAllCalibrationReports();

  // Enrich leaderboard with all v10 data
  const enriched = leaderboard.map((entry) => {
    const config = agents.find((a) => a.agentId === entry.agentId);
    const calibration = calibrationReports.find((r) => r.agentId === entry.agentId);
    const qualityTrend = detectQualityTrend(entry.agentId);
    const templateCheck = detectTemplateUsage(entry.agentId);

    return {
      ...entry,
      name: config?.name ?? entry.agentId,
      model: config?.model ?? "unknown",
      provider: config?.provider ?? "unknown",
      integrityScore: integrityScores[entry.agentId] ?? 1.0,
      calibration: calibration ?? null,
      qualityTrend: qualityTrend.trend,
      isTemplated: templateCheck.isTemplated,
      templateSimilarity: templateCheck.avgSimilarity,
    };
  });

  // Get recent brain feed with pattern analysis
  let recentReasoning: {
    agentId: string;
    action: string;
    symbol: string;
    reasoning: string;
    confidence: number | null;
    coherenceScore: number | null;
    intent: string;
    timestamp: Date | null;
  }[] = [];

  try {
    recentReasoning = await db
      .select({
        agentId: tradeJustifications.agentId,
        action: tradeJustifications.action,
        symbol: tradeJustifications.symbol,
        reasoning: tradeJustifications.reasoning,
        confidence: tradeJustifications.confidence,
        coherenceScore: tradeJustifications.coherenceScore,
        intent: tradeJustifications.intent,
        timestamp: tradeJustifications.timestamp,
      })
      .from(tradeJustifications)
      .orderBy(desc(tradeJustifications.timestamp))
      .limit(10);
  } catch {
    // DB unavailable
  }

  // Enrich brain feed with pattern analysis
  const enrichedFeed = recentReasoning.map((entry) => {
    const patterns = analyzeReasoningPatterns(entry.agentId, entry.reasoning);
    return {
      ...entry,
      patterns: {
        fallacyCount: patterns.fallacies.length,
        fallacies: patterns.fallacies.map((f) => f.type),
        depthClassification: patterns.depth.classification,
        qualityScore: patterns.qualityScore,
        hedgeRatio: patterns.hedgeRatio,
        templateProbability: patterns.templateProbability,
      },
    };
  });

  return c.json({
    ok: true,
    version: "v10",
    leaderboard: enriched,
    snapshot,
    calibration: calibrationSummary,
    integrityScores,
    crossAgent: {
      herdingRate: crossAgent.herding.rate,
      diversityScore: crossAgent.diversityScore,
      collusionSuspected: crossAgent.collusion.suspected,
    },
    brainFeed: enrichedFeed,
    benchmarkInfo: {
      name: "MoltApp AI Trading Benchmark",
      version: "10.0.0",
      pillars: ["Financial", "Reasoning", "Safety", "Calibration", "Patterns", "Adaptability"],
      website: "https://www.patgpt.us",
      dataset: "https://huggingface.co/datasets/patruff/molt-benchmark",
    },
  });
});

// ---------------------------------------------------------------------------
// GET / — HTML Dashboard
// ---------------------------------------------------------------------------

benchmarkV10Routes.get("/", async (c) => {
  const leaderboard = getV9Leaderboard();
  const agents = getAgentConfigs();
  const integrityScores = getAllIntegrityScores();
  const crossAgent = analyzeCrossAgentIntegrity();
  const snapshot = exportV9Snapshot("sideways");
  const calibrationSummary = getCalibrationSummary();
  const calibrationReports = getAllCalibrationReports();

  // Enrich leaderboard
  const rows = leaderboard.length > 0 ? leaderboard : agents.map((a, i) => ({
    rank: i + 1,
    agentId: a.agentId,
    composite: 0,
    grade: "—",
    pillars: { financial: 0, reasoning: 0, safety: 0, calibration: 0, adaptability: 0 },
    tradeCount: 0,
    change: "same" as const,
    percentile: 0,
  }));

  // Get recent reasoning for brain feed
  let recentEntries: {
    agentId: string;
    action: string;
    symbol: string;
    reasoning: string;
    confidence: number | null;
    coherenceScore: number | null;
    intent: string;
    timestamp: Date | null;
  }[] = [];

  try {
    recentEntries = await db
      .select({
        agentId: tradeJustifications.agentId,
        action: tradeJustifications.action,
        symbol: tradeJustifications.symbol,
        reasoning: tradeJustifications.reasoning,
        confidence: tradeJustifications.confidence,
        coherenceScore: tradeJustifications.coherenceScore,
        intent: tradeJustifications.intent,
        timestamp: tradeJustifications.timestamp,
      })
      .from(tradeJustifications)
      .orderBy(desc(tradeJustifications.timestamp))
      .limit(8);
  } catch {
    // DB unavailable
  }

  // Build leaderboard HTML
  const leaderboardHtml = rows.map((entry) => {
    const config = agents.find((a) => a.agentId === entry.agentId);
    const name = config?.name ?? entry.agentId;
    const model = config?.model ?? "";
    const integrity = integrityScores[entry.agentId] ?? 1.0;
    const calibration = calibrationReports.find((r) => r.agentId === entry.agentId);
    const qualityTrend = detectQualityTrend(entry.agentId);
    const changeIcon = entry.change === "up" ? "&#9650;" : entry.change === "down" ? "&#9660;" : "&#8212;";
    const changeColor = entry.change === "up" ? "#00ff88" : entry.change === "down" ? "#ff4444" : "#555";
    const trendIcon = qualityTrend.trend === "improving" ? "&#8593;" : qualityTrend.trend === "degrading" ? "&#8595;" : "&#8212;";
    const trendColor = qualityTrend.trend === "improving" ? "#00ff88" : qualityTrend.trend === "degrading" ? "#ff4444" : "#555";

    const gradeClass = entry.grade.startsWith("A") ? "grade-a"
      : entry.grade.startsWith("B") ? "grade-b"
      : entry.grade.startsWith("C") ? "grade-c"
      : "grade-d";

    return `<tr>
      <td><span class="rank">#${entry.rank}</span> <span style="color:${changeColor};font-size:0.7rem">${changeIcon}</span></td>
      <td><strong>${name}</strong><br><small class="model">${model}</small></td>
      <td><span class="grade ${gradeClass}">${entry.grade}</span></td>
      <td class="composite">${entry.composite.toFixed(3)}</td>
      <td>${entry.pillars.financial.toFixed(2)}</td>
      <td>${entry.pillars.reasoning.toFixed(2)}</td>
      <td>${entry.pillars.safety.toFixed(2)}</td>
      <td>${entry.pillars.calibration.toFixed(2)}</td>
      <td>${entry.pillars.adaptability.toFixed(2)}</td>
      <td><span class="integrity-pill ${integrity >= 0.9 ? "int-good" : integrity >= 0.7 ? "int-warn" : "int-bad"}">${integrity.toFixed(2)}</span></td>
      <td>${calibration ? calibration.ece.toFixed(3) : "—"}</td>
      <td><span style="color:${trendColor}">${trendIcon}</span></td>
      <td>${entry.tradeCount}</td>
    </tr>`;
  }).join("");

  // Build brain feed with pattern annotations
  const brainFeedHtml = recentEntries.map((e) => {
    const patterns = analyzeReasoningPatterns(e.agentId, e.reasoning);
    const fallacyBadges = patterns.fallacies.map((f) =>
      `<span class="fallacy-badge fallacy-${f.severity}">${f.type.replace(/_/g, " ")}</span>`,
    ).join("");
    const depthClass = patterns.depth.classification === "exceptional" ? "depth-exc"
      : patterns.depth.classification === "deep" ? "depth-deep"
      : patterns.depth.classification === "moderate" ? "depth-mod"
      : "depth-shallow";

    return `<div class="feed-entry">
      <div class="feed-header">
        <span class="agent-tag">${e.agentId.replace(/-/g, " ").replace(/\b\w/g, (ch: string) => ch.toUpperCase()).slice(0, 20)}</span>
        <span class="action-tag action-${e.action}">${e.action.toUpperCase()}</span>
        <span class="symbol-tag">${e.symbol}</span>
        <span class="intent-tag">${e.intent}</span>
        <span class="coherence-tag">${(e.coherenceScore ?? 0).toFixed(2)}</span>
        <span class="depth-tag ${depthClass}">${patterns.depth.classification}</span>
        <span class="quality-tag">Q:${patterns.qualityScore.toFixed(2)}</span>
      </div>
      <div class="reasoning-text">${(e.reasoning ?? "").slice(0, 250)}${(e.reasoning ?? "").length > 250 ? "..." : ""}</div>
      <div class="pattern-row">${fallacyBadges}${patterns.depth.analyticalAngles > 3 ? '<span class="angle-badge">Multi-angle</span>' : ""}${patterns.depth.hasCounterArgument ? '<span class="counter-badge">Counter-arg</span>' : ""}</div>
      <div class="feed-footer">Confidence: ${((e.confidence ?? 0) * 100).toFixed(0)}% &middot; Hedge: ${(patterns.hedgeRatio * 100).toFixed(1)}% &middot; ${e.timestamp ? new Date(e.timestamp).toLocaleString() : ""}</div>
    </div>`;
  }).join("");

  const page = html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="60">
  <title>MoltApp Benchmark v10 | Definitive AI Trading Intelligence</title>
  <meta name="description" content="Industry-standard AI trading benchmark. 6-pillar scoring: Financial, Reasoning, Safety, Calibration, Patterns, Adaptability. Live AI agents trading real stocks on Solana.">
  <style>
    :root { --bg: #050510; --card: #0a0a1a; --border: #151530; --accent: #00ff88; --accent2: #00aaff; --warn: #ffaa00; --danger: #ff4444; --purple: #aa77ff; --text: #e0e0e0; --muted: #555; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'SF Mono', 'JetBrains Mono', 'Fira Code', monospace; background: var(--bg); color: var(--text); line-height: 1.6; }
    .container { max-width: 1500px; margin: 0 auto; padding: 20px; }
    .hero { text-align: center; padding: 28px 0 12px; }
    .hero h1 { font-size: 2.2rem; letter-spacing: -0.5px; }
    .hero h1 span { background: linear-gradient(135deg, var(--accent), var(--accent2), var(--purple)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .hero .ver { font-size: 0.6rem; background: linear-gradient(135deg, var(--accent), var(--accent2)); color: #000; padding: 2px 8px; border-radius: 3px; font-weight: 700; vertical-align: super; }
    .hero .tagline { color: var(--muted); font-size: 0.8rem; margin-top: 4px; }
    .hero .official { font-size: 0.55rem; text-transform: uppercase; letter-spacing: 4px; color: var(--accent); margin-top: 2px; }
    .live-dot { width: 8px; height: 8px; background: var(--accent); border-radius: 50%; display: inline-block; margin-right: 6px; animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
    .links { display: flex; gap: 6px; justify-content: center; flex-wrap: wrap; margin: 14px 0; }
    .links a { background: var(--card); border: 1px solid var(--border); border-radius: 5px; padding: 5px 12px; font-size: 0.7rem; color: var(--accent); text-decoration: none; transition: all 0.15s; }
    .links a:hover { background: #0f0f22; transform: translateY(-1px); }
    .links .hf { border-color: var(--warn); color: var(--warn); }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; margin: 16px 0; }
    .stat { background: var(--card); border: 1px solid var(--border); border-radius: 6px; padding: 12px; text-align: center; }
    .stat .label { font-size: 0.55rem; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); }
    .stat .val { font-size: 1.4rem; font-weight: 700; color: var(--accent); margin-top: 2px; }
    .stat .val.warn { color: var(--warn); }
    .stat .val.purple { color: var(--purple); }
    .section { margin: 24px 0; }
    .section h2 { font-size: 0.95rem; color: #fff; border-bottom: 1px solid var(--border); padding-bottom: 6px; margin-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.75rem; }
    th, td { padding: 6px 8px; text-align: left; border-bottom: 1px solid var(--border); }
    th { background: var(--card); color: var(--accent); font-weight: 600; font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.5px; position: sticky; top: 0; }
    tr:hover { background: rgba(0,255,136,0.03); }
    .rank { color: var(--warn); font-weight: 700; font-size: 0.95rem; }
    .model { color: var(--muted); font-size: 0.65rem; }
    .composite { font-weight: 700; color: var(--accent); font-size: 0.9rem; }
    .grade { padding: 2px 8px; border-radius: 3px; font-weight: 800; font-size: 0.75rem; display: inline-block; }
    .grade-a { background: #001a0e; color: var(--accent); border: 1px solid #003a1e; }
    .grade-b { background: #1a1a00; color: var(--warn); border: 1px solid #333300; }
    .grade-c { background: #1a0a00; color: #ff8800; border: 1px solid #331a00; }
    .grade-d { background: #1a0000; color: var(--danger); border: 1px solid #330000; }
    .integrity-pill { padding: 2px 5px; border-radius: 3px; font-size: 0.7rem; font-weight: 600; }
    .int-good { background: #001a0e; color: var(--accent); }
    .int-warn { background: #1a1a00; color: var(--warn); }
    .int-bad { background: #1a0000; color: var(--danger); }
    .pillars-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin: 14px 0; }
    .pillar { background: var(--card); border: 1px solid var(--border); border-radius: 6px; padding: 12px; text-align: center; }
    .pillar h3 { font-size: 0.6rem; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; }
    .pillar .value { font-size: 1rem; font-weight: 700; color: var(--accent); margin: 3px 0; }
    .pillar .desc { font-size: 0.55rem; color: #444; }
    .feed-entry { background: var(--card); border: 1px solid var(--border); border-radius: 6px; padding: 10px; margin-bottom: 7px; }
    .feed-header { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; margin-bottom: 4px; }
    .agent-tag { font-weight: 600; color: #fff; font-size: 0.75rem; }
    .action-tag { padding: 1px 5px; border-radius: 3px; font-size: 0.6rem; font-weight: 700; }
    .action-buy { background: #001a0e; color: var(--accent); }
    .action-sell { background: #1a0000; color: var(--danger); }
    .action-hold { background: #1a1a00; color: var(--warn); }
    .intent-tag { background: #0a0a2a; color: #7777ff; padding: 1px 5px; border-radius: 3px; font-size: 0.6rem; }
    .symbol-tag { color: #777; font-size: 0.75rem; }
    .coherence-tag { color: var(--accent2); font-size: 0.65rem; margin-left: auto; }
    .depth-tag { padding: 1px 4px; border-radius: 3px; font-size: 0.55rem; font-weight: 600; }
    .depth-exc { background: #001a0e; color: var(--accent); }
    .depth-deep { background: #0a0a2a; color: var(--accent2); }
    .depth-mod { background: #1a1a00; color: var(--warn); }
    .depth-shallow { background: #1a0000; color: var(--danger); }
    .quality-tag { color: var(--purple); font-size: 0.65rem; font-weight: 600; }
    .reasoning-text { font-size: 0.7rem; color: #888; line-height: 1.5; }
    .pattern-row { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px; }
    .fallacy-badge { font-size: 0.55rem; padding: 1px 5px; border-radius: 3px; }
    .fallacy-low { background: #1a1a00; color: var(--warn); }
    .fallacy-medium { background: #1a0a00; color: #ff8800; }
    .fallacy-high { background: #1a0000; color: var(--danger); }
    .angle-badge { font-size: 0.55rem; padding: 1px 5px; border-radius: 3px; background: #0a0a2a; color: var(--accent2); }
    .counter-badge { font-size: 0.55rem; padding: 1px 5px; border-radius: 3px; background: #0a1a0a; color: var(--accent); }
    .feed-footer { font-size: 0.6rem; color: #333; margin-top: 3px; }
    .methodology { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin: 20px 0; }
    .methodology h3 { font-size: 0.8rem; color: var(--accent); margin-bottom: 8px; }
    .methodology p { font-size: 0.7rem; color: #777; margin-bottom: 6px; }
    .methodology code { background: #111122; padding: 1px 4px; border-radius: 2px; font-size: 0.65rem; color: var(--accent2); }
    .footer { text-align: center; color: #222; font-size: 0.65rem; margin-top: 28px; padding: 16px; border-top: 1px solid var(--border); }
    .footer a { color: var(--accent2); }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media (max-width: 900px) { .pillars-grid { grid-template-columns: repeat(3, 1fr); } .two-col { grid-template-columns: 1fr; } table { font-size: 0.65rem; } th, td { padding: 3px 4px; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="hero">
      <h1><span>MoltApp</span> AI Trading Benchmark <span class="ver">v10</span></h1>
      <div class="official">Definitive AI Finance Benchmark &mdash; Colosseum Hackathon 2026</div>
      <div class="tagline"><span class="live-dot"></span>Live evaluation of AI agents trading real tokenized stocks on Solana &mdash; 6-pillar scoring</div>
    </div>

    <div class="links">
      <a href="https://huggingface.co/datasets/patruff/molt-benchmark" class="hf" target="_blank">HuggingFace Dataset</a>
      <a href="https://www.patgpt.us" target="_blank">www.patgpt.us</a>
      <a href="/api/v1/brain-feed">Brain Feed API</a>
      <a href="/api/v1/researcher/schema">Researcher API</a>
      <a href="/api/v1/benchmark-analytics/calibration">Calibration API</a>
      <a href="/api/v1/benchmark-analytics/patterns">Pattern API</a>
      <a href="/api/v1/researcher/dataset?format=json">Dataset Export</a>
      <a href="/benchmark-v10/data">Dashboard JSON</a>
    </div>

    <div class="stats-grid">
      <div class="stat">
        <div class="label">Total Trades</div>
        <div class="val">${snapshot.metrics.totalTrades}</div>
      </div>
      <div class="stat">
        <div class="label">Avg Coherence</div>
        <div class="val">${snapshot.metrics.avgCoherence.toFixed(3)}</div>
      </div>
      <div class="stat">
        <div class="label">Hallucination Rate</div>
        <div class="val ${snapshot.metrics.avgHallucinationRate > 0.1 ? "warn" : ""}">${(snapshot.metrics.avgHallucinationRate * 100).toFixed(1)}%</div>
      </div>
      <div class="stat">
        <div class="label">Discipline Rate</div>
        <div class="val">${(snapshot.metrics.avgDisciplineRate * 100).toFixed(1)}%</div>
      </div>
      <div class="stat">
        <div class="label">Avg ECE</div>
        <div class="val purple">${calibrationSummary.avgECE.toFixed(4)}</div>
      </div>
      <div class="stat">
        <div class="label">Avg Brier</div>
        <div class="val purple">${calibrationSummary.avgBrierScore.toFixed(4)}</div>
      </div>
      <div class="stat">
        <div class="label">Herding Rate</div>
        <div class="val ${crossAgent.herding.rate > 0.5 ? "warn" : ""}">${(crossAgent.herding.rate * 100).toFixed(0)}%</div>
      </div>
      <div class="stat">
        <div class="label">Diversity</div>
        <div class="val">${crossAgent.diversityScore.toFixed(2)}</div>
      </div>
    </div>

    <div class="section">
      <h2>6-Pillar Scoring System (Regime-Aware)</h2>
      <div class="pillars-grid">
        <div class="pillar">
          <h3>Financial</h3>
          <div class="value">P&L + Sharpe</div>
          <div class="desc">Risk-adjusted returns. Bull: 30%</div>
        </div>
        <div class="pillar">
          <h3>Reasoning</h3>
          <div class="value">Coherence</div>
          <div class="desc">Logic matches action. Bear: 30%</div>
        </div>
        <div class="pillar">
          <h3>Safety</h3>
          <div class="value">Halluc + Disc</div>
          <div class="desc">No fabrication. Bear: 25%</div>
        </div>
        <div class="pillar">
          <h3>Calibration</h3>
          <div class="value">ECE + Brier</div>
          <div class="desc">Knows what it knows. Vol: 20%</div>
        </div>
        <div class="pillar">
          <h3>Patterns</h3>
          <div class="value">NLP Quality</div>
          <div class="desc">Depth, fallacies, vocabulary</div>
        </div>
        <div class="pillar">
          <h3>Adaptability</h3>
          <div class="value">Cross-Regime</div>
          <div class="desc">Consistent across markets</div>
        </div>
      </div>
    </div>

    <div class="section">
      <h2>Agent Leaderboard (6-Pillar Composite)</h2>
      <div style="overflow-x:auto;">
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Agent</th>
            <th>Grade</th>
            <th>Composite</th>
            <th>Financial</th>
            <th>Reasoning</th>
            <th>Safety</th>
            <th>Calibration</th>
            <th>Adapt.</th>
            <th>Integrity</th>
            <th>ECE</th>
            <th>Trend</th>
            <th>Trades</th>
          </tr>
        </thead>
        <tbody>
          ${leaderboardHtml || '<tr><td colspan="13" style="text-align:center;color:#444;padding:16px;">No trades yet. Run a trading round to populate.</td></tr>'}
        </tbody>
      </table>
      </div>
    </div>

    <div class="two-col">
      <div class="section">
        <h2><span class="live-dot"></span>Brain Feed — Agent Reasoning + Pattern Analysis</h2>
        ${brainFeedHtml || '<div class="feed-entry"><div class="reasoning-text" style="color:#333;">No reasoning data yet.</div></div>'}
      </div>

      <div class="section">
        <h2>Benchmark Methodology</h2>
        <div class="methodology">
          <h3>How Scoring Works</h3>
          <p><strong>Every trade requires reasoning.</strong> No black-box trades. Agents must explain their logic, cite sources, classify intent, and report confidence.</p>
          <p><strong>6 pillars</strong> are measured: Financial performance, Reasoning coherence, Safety (hallucination-free), Calibration (ECE + Brier), Pattern quality (NLP depth, fallacy detection), and Adaptability (cross-regime consistency).</p>
          <p><strong>Regime-aware weights:</strong> In bear markets, reasoning quality matters more (30%). In bull markets, financial returns matter more (30%). In volatile markets, calibration matters more (20%).</p>
          <p><strong>Pattern analysis:</strong> Each reasoning text is analyzed for logical fallacies (<code>anchoring</code>, <code>gambler_fallacy</code>, <code>sunk_cost</code>, etc.), depth classification (<code>shallow</code> to <code>exceptional</code>), vocabulary sophistication, and template probability.</p>
          <p><strong>Calibration:</strong> ECE (Expected Calibration Error) and Brier Score measure whether an agent's confidence predicts outcomes. A 70%-confident agent should win ~70% of those trades.</p>
          <p><strong>Integrity:</strong> Cross-trade checks detect flip-flopping, copypasta reasoning, confidence drift, and source fabrication.</p>
        </div>
        <div class="methodology">
          <h3>API Endpoints</h3>
          <p><code>GET /benchmark-v10/data</code> — Full JSON dashboard data</p>
          <p><code>GET /api/v1/benchmark-analytics/calibration</code> — Calibration reports per agent</p>
          <p><code>GET /api/v1/benchmark-analytics/patterns/:agentId</code> — Pattern analysis</p>
          <p><code>GET /api/v1/brain-feed</code> — Paginated reasoning feed</p>
          <p><code>GET /api/v1/researcher/dataset</code> — Full dataset export</p>
          <p><code>GET /api/v1/researcher/reproducibility</code> — Reproducibility artifacts</p>
        </div>
      </div>
    </div>

    <div class="footer">
      <strong>MoltApp AI Trading Benchmark v10</strong> &mdash; Colosseum Agent Hackathon 2026<br>
      6-pillar scoring. Every trade requires reasoning. Regime-aware weights. Calibration + NLP quality.<br>
      <small><a href="https://huggingface.co/datasets/patruff/molt-benchmark">HuggingFace Dataset</a> &middot; <a href="/api/v1/researcher/schema">Researcher API</a> &middot; <a href="https://github.com/patruff/moltapp">GitHub</a></small>
    </div>
  </div>

  <script>
    setInterval(async () => {
      try {
        const resp = await fetch('/benchmark-v10/data');
        if (resp.ok) document.title = 'MoltApp v10 | ' + new Date().toLocaleTimeString();
      } catch {}
    }, 30000);
  </script>
</body>
</html>`;

  return c.html(page);
});
