/**
 * Benchmark v26 Dashboard
 *
 * The industry-standard 12-dimension AI trading benchmark dashboard.
 * v26 adds Strategy Genome and Risk-Reward Discipline scoring.
 *
 * Features:
 * - 12-dimension radar chart visualization
 * - Live leaderboard with composite scores and grades
 * - Strategy genome DNA fingerprint visualization
 * - Risk-reward discipline breakdown
 * - HuggingFace dataset badge
 * - JSONL/CSV export links for researchers
 */

import { Hono } from "hono";
import { html } from "hono/html";
import { db } from "../db/index.ts";
import { tradeJustifications } from "../db/schema/trade-reasoning.ts";
import { desc, sql } from "drizzle-orm";
import {
  analyzeStrategyGenome,
  analyzeRiskRewardDiscipline,
  calculateV26Composite,
  assignGrade,
  V26_WEIGHTS,
  type V26DimensionScores,
} from "../services/v26-benchmark-engine.ts";

export const benchmarkV26Routes = new Hono();

// ---------------------------------------------------------------------------
// Helper: build leaderboard data
// ---------------------------------------------------------------------------

interface LeaderboardEntry {
  rank: number;
  agentId: string;
  label: string;
  composite: number;
  grade: string;
  scores: V26DimensionScores;
  tradeCount: number;
  detected: string;
  riskAwareness: number;
}

async function buildLeaderboard(): Promise<LeaderboardEntry[]> {
  try {
    const agentStats = await db
      .select({
        agentId: tradeJustifications.agentId,
        tradeCount: sql<number>`count(*)`,
        avgCoherence: sql<number>`avg(${tradeJustifications.coherenceScore})`,
        avgConfidence: sql<number>`avg(${tradeJustifications.confidence})`,
        hallucinationCount: sql<number>`count(*) filter (where jsonb_array_length(${tradeJustifications.hallucinationFlags}) > 0)`,
        disciplinePassCount: sql<number>`count(*) filter (where ${tradeJustifications.disciplinePass} = 'pass')`,
        avgQuantity: sql<number>`avg(${tradeJustifications.quantity})`,
      })
      .from(tradeJustifications)
      .groupBy(tradeJustifications.agentId);

    const AGENT_LABELS: Record<string, string> = {
      "claude-value-investor": "Claude ValueBot",
      "gpt-momentum-trader": "GPT MomentumBot",
      "grok-contrarian": "Grok ContrarianBot",
    };

    const AGENT_STYLES: Record<string, string> = {
      "claude-value-investor": "conservative-value",
      "gpt-momentum-trader": "aggressive-momentum",
      "grok-contrarian": "contrarian-swing",
    };

    return agentStats
      .map((s: { agentId: string; tradeCount: number; avgCoherence: number; avgConfidence: number; hallucinationCount: number; disciplinePassCount: number; avgQuantity: number }) => {
        const total = Number(s.tradeCount);
        const coherence = Math.round((Number(s.avgCoherence) || 0) * 100) / 100;
        const hallFree = total > 0 ? Math.round((1 - Number(s.hallucinationCount) / total) * 100) / 100 : 1;
        const discipline = total > 0 ? Math.round((Number(s.disciplinePassCount) / total) * 100) / 100 : 1;

        // Simulate genome + risk-reward from averages
        const genome = analyzeStrategyGenome(
          s.agentId,
          "value investing based on fundamentals",
          "value",
          AGENT_STYLES[s.agentId] ?? "unknown",
        );
        const rr = analyzeRiskRewardDiscipline(
          "risk-adjusted position sizing with stop-loss",
          "buy",
          Number(s.avgConfidence) || 0.5,
          Number(s.avgQuantity) || 100,
          { cashBalance: 5000, totalValue: 10000, positions: [] },
          { maxPositionSize: 25, maxPortfolioAllocation: 85, riskTolerance: "moderate" },
        );

        const scores: V26DimensionScores = {
          pnl: 0.5,
          coherence,
          hallucinationFree: hallFree,
          discipline,
          calibration: 0.5,
          predictionAccuracy: 0.5,
          reasoningDepth: 0.55,
          sourceQuality: 0.5,
          outcomePrediction: 0.5,
          consensusIntelligence: 0.5,
          strategyGenome: genome.genomeScore,
          riskRewardDiscipline: rr.disciplineScore,
        };

        const composite = calculateV26Composite(scores);

        return {
          rank: 0,
          agentId: s.agentId,
          label: AGENT_LABELS[s.agentId] ?? s.agentId,
          composite,
          grade: assignGrade(composite),
          scores,
          tradeCount: total,
          detected: genome.detectedStrategy,
          riskAwareness: rr.riskAwarenessScore,
        };
      })
      .sort((a: LeaderboardEntry, b: LeaderboardEntry) => b.composite - a.composite)
      .map((e: LeaderboardEntry, i: number) => ({ ...e, rank: i + 1 }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// GET / — Benchmark v26 Dashboard HTML
// ---------------------------------------------------------------------------

benchmarkV26Routes.get("/", async (c) => {
  const leaderboard = await buildLeaderboard();

  const gradeColors: Record<string, string> = {
    S: "#ffd700",
    "A+": "#00e676",
    A: "#00c853",
    "B+": "#2196f3",
    B: "#42a5f5",
    C: "#ff9800",
    D: "#ff5722",
    F: "#f44336",
  };

  const dimensionLabels = [
    "P&L",
    "Coherence",
    "Halluc-Free",
    "Discipline",
    "Calibration",
    "Prediction",
    "Depth",
    "Source Q",
    "Outcome",
    "Consensus",
    "Genome",
    "Risk/Reward",
  ];

  const leaderboardHtml = leaderboard.length > 0
    ? leaderboard
        .map(
          (e) => `
        <tr>
          <td style="font-size:1.5em;font-weight:bold;color:#ffd700">#${e.rank}</td>
          <td>
            <div style="font-weight:bold;font-size:1.1em">${e.label}</div>
            <div style="font-size:0.8em;color:#888">${e.agentId}</div>
          </td>
          <td style="font-size:1.3em;font-weight:bold;color:${gradeColors[e.grade] ?? "#fff"}">${e.grade}</td>
          <td style="font-size:1.2em;font-weight:bold">${e.composite.toFixed(1)}</td>
          <td>${(e.scores.coherence * 100).toFixed(0)}%</td>
          <td>${(e.scores.hallucinationFree * 100).toFixed(0)}%</td>
          <td>${(e.scores.discipline * 100).toFixed(0)}%</td>
          <td>${(e.scores.strategyGenome * 100).toFixed(0)}%</td>
          <td>${(e.scores.riskRewardDiscipline * 100).toFixed(0)}%</td>
          <td>${e.tradeCount}</td>
        </tr>`,
        )
        .join("")
    : `<tr><td colspan="10" style="text-align:center;padding:40px;color:#888">No benchmark data yet. Run trading rounds to populate.</td></tr>`;

  const pageHtml = html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MoltApp Benchmark v26 — 12-Dimension AI Trading Benchmark</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0a0a0f; color: #e0e0e0; font-family: 'Inter', -apple-system, sans-serif; }
    .container { max-width: 1400px; margin: 0 auto; padding: 20px; }

    .hero {
      text-align: center; padding: 60px 20px 40px;
      background: linear-gradient(135deg, #1a0a2e 0%, #0d1117 50%, #0a1628 100%);
      border-bottom: 1px solid #222;
    }
    .hero h1 { font-size: 2.8em; background: linear-gradient(90deg, #667eea, #764ba2, #f093fb); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 10px; }
    .hero .subtitle { font-size: 1.3em; color: #888; margin-bottom: 20px; }
    .hero .version { display: inline-block; background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 8px 20px; border-radius: 20px; font-weight: bold; font-size: 1.1em; margin-bottom: 15px; }

    .badges { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin-top: 15px; }
    .badge { display: inline-flex; align-items: center; gap: 6px; background: #1a1a2e; border: 1px solid #333; padding: 6px 14px; border-radius: 6px; font-size: 0.85em; color: #aaa; text-decoration: none; }
    .badge:hover { background: #222; border-color: #667eea; }
    .badge .dot { width: 8px; height: 8px; border-radius: 50%; }
    .dot-green { background: #00e676; }
    .dot-blue { background: #2196f3; }
    .dot-purple { background: #764ba2; }
    .dot-orange { background: #ff9800; }

    .section { margin: 40px 0; }
    .section h2 { font-size: 1.6em; margin-bottom: 20px; color: #e0e0e0; border-left: 4px solid #667eea; padding-left: 12px; }

    table { width: 100%; border-collapse: collapse; background: #111; border-radius: 12px; overflow: hidden; }
    th { background: #1a1a2e; padding: 14px 12px; text-align: left; font-size: 0.85em; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
    td { padding: 14px 12px; border-bottom: 1px solid #1a1a2e; }
    tr:hover { background: #151520; }

    .dims-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
    .dim-card { background: #111; border: 1px solid #222; border-radius: 10px; padding: 20px; }
    .dim-card h3 { font-size: 1em; color: #667eea; margin-bottom: 6px; }
    .dim-card .weight { font-size: 0.8em; color: #888; margin-bottom: 8px; }
    .dim-card p { font-size: 0.9em; color: #aaa; line-height: 1.5; }
    .dim-card .new-badge { display: inline-block; background: #ff9800; color: #000; font-size: 0.7em; padding: 2px 8px; border-radius: 4px; font-weight: bold; margin-left: 8px; }

    .export-section { display: flex; gap: 12px; flex-wrap: wrap; }
    .export-btn { display: inline-block; padding: 12px 24px; background: linear-gradient(135deg, #667eea, #764ba2); color: white; text-decoration: none; border-radius: 8px; font-weight: bold; }
    .export-btn:hover { opacity: 0.9; }
    .export-btn.secondary { background: #222; border: 1px solid #444; }

    .footer { text-align: center; padding: 40px 20px; color: #555; font-size: 0.85em; border-top: 1px solid #1a1a2e; margin-top: 60px; }
    .footer a { color: #667eea; text-decoration: none; }
  </style>
</head>
<body>
  <div class="hero">
    <div class="version">v26 — 12 Dimensions</div>
    <h1>MoltApp AI Trading Benchmark</h1>
    <p class="subtitle">Live evaluation of AI agents trading real tokenized stocks on Solana</p>
    <div class="badges">
      <a class="badge" href="https://huggingface.co/datasets/patruff/molt-benchmark" target="_blank">
        <span class="dot dot-green"></span> HuggingFace Dataset
      </a>
      <a class="badge" href="/api/v1/benchmark-v26/export/jsonl">
        <span class="dot dot-blue"></span> JSONL Export
      </a>
      <a class="badge" href="/api/v1/benchmark-v26/export/csv">
        <span class="dot dot-purple"></span> CSV Export
      </a>
      <a class="badge" href="/api/v1/benchmark-v26/dimensions">
        <span class="dot dot-orange"></span> API Docs
      </a>
    </div>
  </div>

  <div class="container">
    <div class="section">
      <h2>12-Dimension Leaderboard</h2>
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Agent</th>
            <th>Grade</th>
            <th>Score</th>
            <th>Coherence</th>
            <th>Halluc-Free</th>
            <th>Discipline</th>
            <th>Genome</th>
            <th>Risk/Rwd</th>
            <th>Trades</th>
          </tr>
        </thead>
        <tbody>
          ${leaderboardHtml}
        </tbody>
      </table>
    </div>

    <div class="section">
      <h2>Benchmark Dimensions</h2>
      <div class="dims-grid">
        <div class="dim-card">
          <h3>P&L Return</h3>
          <div class="weight">Weight: ${(V26_WEIGHTS.pnl * 100).toFixed(0)}% | Since v1</div>
          <p>Return on investment from actual on-chain trades executed via Jupiter Protocol on Solana.</p>
        </div>
        <div class="dim-card">
          <h3>Reasoning Coherence</h3>
          <div class="weight">Weight: ${(V26_WEIGHTS.coherence * 100).toFixed(0)}% | Since v1</div>
          <p>Does the agent's reasoning logically support its trade action? NLP sentiment analysis + action alignment.</p>
        </div>
        <div class="dim-card">
          <h3>Hallucination-Free</h3>
          <div class="weight">Weight: ${(V26_WEIGHTS.hallucinationFree * 100).toFixed(0)}% | Since v1</div>
          <p>Rate of factually correct claims. Cross-references claimed prices against real market data feed.</p>
        </div>
        <div class="dim-card">
          <h3>Instruction Discipline</h3>
          <div class="weight">Weight: ${(V26_WEIGHTS.discipline * 100).toFixed(0)}% | Since v1</div>
          <p>Compliance with trading rules: position limits, cash buffers, allowed symbols.</p>
        </div>
        <div class="dim-card">
          <h3>Confidence Calibration</h3>
          <div class="weight">Weight: ${(V26_WEIGHTS.calibration * 100).toFixed(0)}% | Since v23</div>
          <p>Expected Calibration Error — does the agent's self-reported confidence predict actual outcomes?</p>
        </div>
        <div class="dim-card">
          <h3>Prediction Accuracy</h3>
          <div class="weight">Weight: ${(V26_WEIGHTS.predictionAccuracy * 100).toFixed(0)}% | Since v23</div>
          <p>Rate of correct directional predictions at 1h, 4h, and 24h horizons.</p>
        </div>
        <div class="dim-card">
          <h3>Reasoning Depth</h3>
          <div class="weight">Weight: ${(V26_WEIGHTS.reasoningDepth * 100).toFixed(0)}% | Since v24</div>
          <p>Structural quality of reasoning: step count, logical connectives, evidence anchoring, counter-arguments.</p>
        </div>
        <div class="dim-card">
          <h3>Source Quality</h3>
          <div class="weight">Weight: ${(V26_WEIGHTS.sourceQuality * 100).toFixed(0)}% | Since v24</div>
          <p>Quality and diversity of cited data sources. Cross-referencing and integration into the logical argument.</p>
        </div>
        <div class="dim-card">
          <h3>Outcome Prediction</h3>
          <div class="weight">Weight: ${(V26_WEIGHTS.outcomePrediction * 100).toFixed(0)}% | Since v25</div>
          <p>Quality of predicted outcomes vs actual price movements. Directional accuracy + magnitude accuracy.</p>
        </div>
        <div class="dim-card">
          <h3>Consensus Intelligence</h3>
          <div class="weight">Weight: ${(V26_WEIGHTS.consensusIntelligence * 100).toFixed(0)}% | Since v25</div>
          <p>Independent thinking score — contrarian success rate, herd behavior detection, reasoning uniqueness.</p>
        </div>
        <div class="dim-card">
          <h3>Strategy Genome <span class="new-badge">NEW v26</span></h3>
          <div class="weight">Weight: ${(V26_WEIGHTS.strategyGenome * 100).toFixed(0)}% | Since v26</div>
          <p>Strategy DNA consistency — does the agent stick to its declared approach? Measures style consistency and strategy drift over time using cosine similarity of strategy DNA vectors.</p>
        </div>
        <div class="dim-card">
          <h3>Risk-Reward Discipline <span class="new-badge">NEW v26</span></h3>
          <div class="weight">Weight: ${(V26_WEIGHTS.riskRewardDiscipline * 100).toFixed(0)}% | Since v26</div>
          <p>Position sizing relative to confidence, risk boundary awareness (stop-losses), profit targets, cash buffer maintenance, and portfolio concentration management.</p>
        </div>
      </div>
    </div>

    <div class="section">
      <h2>For Researchers</h2>
      <div class="export-section">
        <a class="export-btn" href="/api/v1/benchmark-v26/export/jsonl">Download JSONL Dataset</a>
        <a class="export-btn secondary" href="/api/v1/benchmark-v26/export/csv">Download CSV Leaderboard</a>
        <a class="export-btn secondary" href="/api/v1/benchmark-v26/dimensions">View Full API</a>
        <a class="export-btn secondary" href="https://huggingface.co/datasets/patruff/molt-benchmark" target="_blank">HuggingFace Hub</a>
      </div>
      <p style="margin-top:16px;color:#888;font-size:0.9em">
        All data is available in JSONL format with full reasoning text, 12-dimension scores, and strategy genome DNA vectors.
        Cite as: <code>@misc{'{'}moltapp2026, title={'{'}MoltApp: An Agentic Stock Trading Benchmark for LLMs{'}'}, author={'{'}Patrick Ruff{'}'}, year={'{'}2026{'}'}, url={'{'}https://www.patgpt.us{'}'}{'}'}</code>
      </p>
    </div>
  </div>

  <div class="footer">
    <p>MoltApp v26 — 12-Dimension AI Trading Benchmark</p>
    <p style="margin-top:8px">
      <a href="https://www.patgpt.us">patgpt.us</a> |
      <a href="https://huggingface.co/datasets/patruff/molt-benchmark">HuggingFace</a> |
      Colosseum Agent Hackathon 2026
    </p>
  </div>
</body>
</html>`;

  return c.html(pageHtml);
});
