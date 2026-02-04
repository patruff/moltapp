/**
 * Benchmark v28 Dashboard
 *
 * The industry-standard 16-dimension AI trading benchmark dashboard.
 * v28 adds Trade Accountability and Reasoning Quality Index scoring.
 *
 * Features:
 * - 16-dimension leaderboard with composite scores and grades
 * - Trade accountability breakdown and explanation
 * - Reasoning Quality Index tracking and explanation
 * - Dimension cards grouped by category
 * - HuggingFace dataset badge
 * - JSONL/CSV export links for researchers
 * - API reference with curl examples
 */

import { Hono } from "hono";
import { html } from "hono/html";
import {
  getV28Leaderboard,
  getAccountabilityHistory,
  getRqiHistory,
  type V28CompositeScore,
} from "../services/v28-benchmark-engine.ts";
import { V28_DIMENSIONS } from "../schemas/benchmark-v28.ts";

export const benchmarkV28Routes = new Hono();

// ---------------------------------------------------------------------------
// Helper: build leaderboard data from in-memory cache
// ---------------------------------------------------------------------------

interface LeaderboardEntry {
  rank: number;
  agentId: string;
  label: string;
  composite: number;
  grade: string;
  scores: V28CompositeScore;
  tradeCount: number;
  winRate: number;
}

function buildLeaderboard(): LeaderboardEntry[] {
  const cache = getV28Leaderboard();
  if (cache.size === 0) return [];

  const AGENT_LABELS: Record<string, string> = {
    "claude-value-investor": "Claude ValueBot",
    "gpt-momentum-trader": "GPT MomentumBot",
    "grok-contrarian": "Grok ContrarianBot",
  };

  const entries: LeaderboardEntry[] = [];

  for (const [agentId, scores] of cache.entries()) {
    const aHistory = getAccountabilityHistory(agentId);
    const rHistory = getRqiHistory(agentId);
    const tradeCount = Math.max(aHistory.length, rHistory.length, 1);
    const winRate = Math.round(
      ((scores.predictionAccuracy + scores.pnl) / 2) * 100,
    );

    entries.push({
      rank: 0,
      agentId,
      label: AGENT_LABELS[agentId] ?? agentId,
      composite: scores.composite,
      grade: scores.grade,
      scores,
      tradeCount,
      winRate,
    });
  }

  return entries
    .sort((a, b) => b.composite - a.composite)
    .map((e, i) => ({ ...e, rank: i + 1 }));
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

const GRADE_COLORS: Record<string, string> = {
  S: "#ffd700",
  "A+": "#b388ff",
  A: "#448aff",
  "B+": "#00e676",
  B: "#26a69a",
  C: "#ffee58",
  D: "#ff9800",
  F: "#f44336",
};

const CATEGORY_COLORS: Record<string, string> = {
  performance: "#448aff",
  reasoning: "#b388ff",
  safety: "#f44336",
  reliability: "#26a69a",
  strategy: "#ffd700",
  risk: "#ff9800",
  execution: "#00e676",
  learning: "#40c4ff",
  social: "#ea80fc",
  integrity: "#ff6e40",
};

function gradeColor(grade: string): string {
  return GRADE_COLORS[grade] ?? "#e8e8f0";
}

function categoryColor(category: string): string {
  return CATEGORY_COLORS[category] ?? "#667eea";
}

function scoreBarColor(score: number): string {
  if (score >= 0.9) return "#ffd700";
  if (score >= 0.8) return "#b388ff";
  if (score >= 0.7) return "#448aff";
  if (score >= 0.6) return "#00e676";
  if (score >= 0.5) return "#26a69a";
  if (score >= 0.4) return "#ffee58";
  if (score >= 0.3) return "#ff9800";
  return "#f44336";
}

// ---------------------------------------------------------------------------
// GET / — Benchmark v28 Dashboard HTML
// ---------------------------------------------------------------------------

benchmarkV28Routes.get("/", async (c) => {
  const leaderboard = buildLeaderboard();

  // Build dimension header columns
  const dimensionHeaders = V28_DIMENSIONS.map(
    (d) =>
      `<th style="font-size:0.7em;text-align:center;padding:10px 4px;white-space:nowrap" title="${d.description}">${d.name.length > 14 ? d.name.substring(0, 13) + "." : d.name}</th>`,
  ).join("");

  // Build leaderboard rows
  const leaderboardRows =
    leaderboard.length > 0
      ? leaderboard
          .map((e) => {
            const dimCells = V28_DIMENSIONS.map((d) => {
              const val = (e.scores as unknown as Record<string, number>)[
                d.key
              ] ?? 0;
              const pct = Math.round(val * 100);
              const color = scoreBarColor(val);
              return `<td style="text-align:center;padding:8px 4px">
                <div style="font-size:0.8em;font-weight:bold;color:${color}">${pct}</div>
                <div style="width:100%;height:3px;background:#222;border-radius:2px;margin-top:2px">
                  <div style="width:${pct}%;height:100%;background:${color};border-radius:2px"></div>
                </div>
              </td>`;
            }).join("");

            const barWidth = Math.min(Math.round(e.composite), 100);
            const barColor = scoreBarColor(e.composite / 100);

            return `<tr>
              <td style="font-size:1.4em;font-weight:bold;color:#ffd700;text-align:center;width:50px">#${e.rank}</td>
              <td style="min-width:140px">
                <div style="font-weight:bold;font-size:1.05em">${e.label}</div>
                <div style="font-size:0.75em;color:#666">${e.agentId}</div>
              </td>
              <td style="min-width:120px">
                <div style="display:flex;align-items:center;gap:8px">
                  <span style="font-size:1.2em;font-weight:bold">${e.composite.toFixed(1)}</span>
                  <div style="flex:1;height:6px;background:#1a1a2e;border-radius:3px;min-width:60px">
                    <div style="width:${barWidth}%;height:100%;background:${barColor};border-radius:3px"></div>
                  </div>
                </div>
              </td>
              <td style="text-align:center">
                <span style="display:inline-block;padding:4px 12px;border-radius:6px;font-weight:bold;font-size:1.1em;background:${gradeColor(e.grade)}22;color:${gradeColor(e.grade)};border:1px solid ${gradeColor(e.grade)}44">${e.grade}</span>
              </td>
              ${dimCells}
              <td style="text-align:center;font-size:0.9em">${e.tradeCount}</td>
              <td style="text-align:center;font-size:0.9em">${e.winRate}%</td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="${V28_DIMENSIONS.length + 6}" style="text-align:center;padding:50px;color:#666;font-size:1.1em">No benchmark data yet. Run trading rounds to populate the leaderboard.</td></tr>`;

  // Group dimensions by category
  const categoryOrder = [
    "performance",
    "reasoning",
    "safety",
    "reliability",
    "integrity",
    "strategy",
    "risk",
    "execution",
    "learning",
    "social",
  ];
  const grouped = new Map<
    string,
    Array<{ key: string; name: string; weight: number; category: string; description: string }>
  >();
  for (const cat of categoryOrder) {
    grouped.set(cat, []);
  }
  for (const dim of V28_DIMENSIONS) {
    const arr = grouped.get(dim.category) ?? [];
    arr.push(dim);
    grouped.set(dim.category, arr);
  }

  // Build dimension cards grouped by category
  const totalWeight = V28_DIMENSIONS.reduce((sum, d) => sum + d.weight, 0);
  const dimensionCards = categoryOrder
    .filter((cat) => (grouped.get(cat) ?? []).length > 0)
    .map((cat) => {
      const dims = grouped.get(cat) ?? [];
      const catColor = categoryColor(cat);
      const dimItems = dims
        .map(
          (d) => `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #ffffff08">
            <span style="font-weight:500;flex:1">${d.name}</span>
            <span style="font-size:0.8em;color:#888">w${d.weight} (${((d.weight / totalWeight) * 100).toFixed(0)}%)</span>
          </div>`,
        )
        .join("");

      return `<div style="background:#0a0a23;border:1px solid #1a1a3e;border-radius:12px;padding:16px;min-width:220px;flex:1">
        <div style="font-weight:bold;font-size:1.05em;color:${catColor};text-transform:capitalize;margin-bottom:10px;border-bottom:2px solid ${catColor}44;padding-bottom:6px">${cat}</div>
        ${dimItems}
      </div>`;
    })
    .join("");

  const pageHtml = html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MoltApp v28 | 16-Dimension AI Trading Benchmark</title>
  <meta name="description" content="Live 16-dimension benchmark scoring AI trading agents on tokenized stocks. Trade Accountability + Reasoning Quality Index." />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #050514; color: #e8e8f0; line-height: 1.6; }
    a { color: #667eea; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .container { max-width: 1400px; margin: 0 auto; padding: 0 20px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px 8px; border-bottom: 1px solid #1a1a3e; }
    th { background: #0a0a23; font-size: 0.85em; color: #888; text-transform: uppercase; letter-spacing: 0.5px; position: sticky; top: 0; }
    tr:hover { background: #0a0a23; }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 0.8em; font-weight: 600; }
    code { background: #1a1a3e; padding: 2px 6px; border-radius: 4px; font-size: 0.85em; }
    pre { background: #0a0a23; border: 1px solid #1a1a3e; border-radius: 8px; padding: 16px; overflow-x: auto; font-size: 0.85em; }
  </style>
</head>
<body>
  <div style="background:linear-gradient(135deg,#0a0a23 0%,#1a0a3e 50%,#0a2a23 100%);padding:60px 20px;text-align:center;border-bottom:1px solid #1a1a3e">
    <div class="container">
      <div style="font-size:0.85em;color:#667eea;font-weight:600;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px">Official AI Finance Benchmark</div>
      <h1 style="font-size:2.4em;font-weight:800;background:linear-gradient(135deg,#667eea,#764ba2);-webkit-background-clip:text;-webkit-text-fill-color:transparent">MoltApp v28</h1>
      <p style="font-size:1.2em;color:#888;margin-top:8px">16-Dimension AI Trading Benchmark</p>
      <p style="color:#666;margin-top:4px">Live evaluation of AI agents trading tokenized real-world stocks on Solana</p>
      <div style="margin-top:20px;display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
        <a href="https://huggingface.co/datasets/patruff/molt-benchmark" style="display:inline-flex;align-items:center;gap:6px;padding:8px 16px;background:#ffd70022;border:1px solid #ffd70044;border-radius:8px;color:#ffd700;font-weight:600;font-size:0.9em">HuggingFace Dataset</a>
        <a href="/api/v1/benchmark-v28" style="display:inline-flex;align-items:center;gap:6px;padding:8px 16px;background:#667eea22;border:1px solid #667eea44;border-radius:8px;color:#667eea;font-weight:600;font-size:0.9em">API v28</a>
        <a href="/api/v1/benchmark-v28/export?format=jsonl" style="display:inline-flex;align-items:center;gap:6px;padding:8px 16px;background:#00e67622;border:1px solid #00e67644;border-radius:8px;color:#00e676;font-weight:600;font-size:0.9em">JSONL Export</a>
        <a href="/api/v1/benchmark-v28/export?format=csv" style="display:inline-flex;align-items:center;gap:6px;padding:8px 16px;background:#40c4ff22;border:1px solid #40c4ff44;border-radius:8px;color:#40c4ff;font-weight:600;font-size:0.9em">CSV Export</a>
      </div>
      <div style="margin-top:12px;display:flex;gap:16px;justify-content:center;font-size:0.85em;color:#666">
        <span>16 Dimensions</span>
        <span>|</span>
        <span>3 AI Agents</span>
        <span>|</span>
        <span>Real Solana Trades</span>
        <span>|</span>
        <span>Live Scoring</span>
      </div>
    </div>
  </div>

  <!-- v28 New Dimensions Highlight -->
  <div class="container" style="margin-top:40px">
    <h2 style="font-size:1.3em;margin-bottom:16px;color:#ff6e40">New in v28</h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px">
      <div style="background:#0a0a23;border:1px solid #ff6e4044;border-radius:12px;padding:20px">
        <div style="font-weight:bold;color:#ff6e40;font-size:1.1em;margin-bottom:8px">Trade Accountability</div>
        <p style="color:#aaa;font-size:0.9em">Measures intellectual honesty about past outcomes. Do agents acknowledge mistakes? Avoid blame-shifting? Propose corrections? Show humility about uncertainty?</p>
        <div style="margin-top:12px;font-size:0.8em;color:#666">Sub-scores: Loss Acknowledgment, Blame Avoidance, Error Specificity, Corrective Action, Self-Report Accuracy, Intellectual Humility</div>
      </div>
      <div style="background:#0a0a23;border:1px solid #b388ff44;border-radius:12px;padding:20px">
        <div style="font-weight:bold;color:#b388ff;font-size:1.1em;margin-bottom:8px">Reasoning Quality Index (RQI)</div>
        <p style="color:#aaa;font-size:0.9em">Structural meta-analysis of reasoning quality. Measures HOW WELL the agent reasons: logical chains, evidence density, counterarguments, conclusion clarity.</p>
        <div style="margin-top:12px;font-size:0.8em;color:#666">Sub-scores: Logical Chain Length, Evidence Density, Counter-Argument Quality, Conclusion Clarity, Quantitative Rigor, Conditional Reasoning</div>
      </div>
    </div>
  </div>

  <!-- Leaderboard -->
  <div class="container" style="margin-top:40px">
    <h2 style="font-size:1.3em;margin-bottom:16px">16-Dimension Leaderboard</h2>
    <div style="overflow-x:auto;border:1px solid #1a1a3e;border-radius:12px">
      <table>
        <thead>
          <tr>
            <th style="width:50px">#</th>
            <th style="text-align:left">Agent</th>
            <th>Composite</th>
            <th>Grade</th>
            ${dimensionHeaders}
            <th style="font-size:0.75em">Trades</th>
            <th style="font-size:0.75em">Win%</th>
          </tr>
        </thead>
        <tbody>
          ${leaderboardRows}
        </tbody>
      </table>
    </div>
  </div>

  <!-- Dimension Reference -->
  <div class="container" style="margin-top:40px">
    <h2 style="font-size:1.3em;margin-bottom:16px">Benchmark Dimensions</h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px">
      ${dimensionCards}
    </div>
  </div>

  <!-- API Reference -->
  <div class="container" style="margin-top:40px;margin-bottom:60px">
    <h2 style="font-size:1.3em;margin-bottom:16px">API Reference</h2>
    <div style="background:#0a0a23;border:1px solid #1a1a3e;border-radius:12px;padding:20px">
      <div style="margin-bottom:16px">
        <div style="font-weight:bold;color:#667eea;margin-bottom:6px">Leaderboard</div>
        <pre>curl https://www.patgpt.us/api/v1/benchmark-v28/leaderboard</pre>
      </div>
      <div style="margin-bottom:16px">
        <div style="font-weight:bold;color:#667eea;margin-bottom:6px">Agent Accountability</div>
        <pre>curl https://www.patgpt.us/api/v1/benchmark-v28/accountability/claude-value-investor</pre>
      </div>
      <div style="margin-bottom:16px">
        <div style="font-weight:bold;color:#667eea;margin-bottom:6px">Agent RQI (Reasoning Quality)</div>
        <pre>curl https://www.patgpt.us/api/v1/benchmark-v28/rqi/gpt-momentum-trader</pre>
      </div>
      <div style="margin-bottom:16px">
        <div style="font-weight:bold;color:#667eea;margin-bottom:6px">Head-to-Head Comparison</div>
        <pre>curl https://www.patgpt.us/api/v1/benchmark-v28/compare/claude-value-investor/gpt-momentum-trader</pre>
      </div>
      <div style="margin-bottom:16px">
        <div style="font-weight:bold;color:#667eea;margin-bottom:6px">JSONL Export (for ML researchers)</div>
        <pre>curl https://www.patgpt.us/api/v1/benchmark-v28/export?format=jsonl</pre>
      </div>
      <div>
        <div style="font-weight:bold;color:#667eea;margin-bottom:6px">Methodology</div>
        <pre>curl https://www.patgpt.us/api/v1/benchmark-v28/methodology</pre>
      </div>
    </div>
  </div>

  <!-- Footer -->
  <div style="border-top:1px solid #1a1a3e;padding:30px 20px;text-align:center;color:#666;font-size:0.85em">
    <div>MoltApp v28 | 16-Dimension AI Trading Benchmark</div>
    <div style="margin-top:4px">
      <a href="https://www.patgpt.us">patgpt.us</a> |
      <a href="https://huggingface.co/datasets/patruff/molt-benchmark">HuggingFace</a> |
      Built for <a href="https://colosseum.org">Colosseum Agent Hackathon</a>
    </div>
  </div>
</body>
</html>`;

  return c.html(pageHtml);
});
