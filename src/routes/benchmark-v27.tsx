/**
 * Benchmark v27 Dashboard
 *
 * The industry-standard 14-dimension AI trading benchmark dashboard.
 * v27 adds Execution Quality and Cross-Round Learning scoring.
 *
 * Features:
 * - 14-dimension leaderboard with composite scores and grades
 * - Execution quality breakdown and explanation
 * - Cross-round learning tracking and explanation
 * - Dimension cards grouped by category
 * - HuggingFace dataset badge
 * - JSONL/CSV export links for researchers
 * - API reference with curl examples
 */

import { Hono } from "hono";
import { html } from "hono/html";
import {
  getV27Leaderboard,
  getExecutionQualityHistory,
  getCrossRoundLearningHistory,
  type V27CompositeScore,
} from "../services/v27-benchmark-engine.ts";
import { V27_DIMENSIONS } from "../schemas/benchmark-v27.ts";

export const benchmarkV27Routes = new Hono();

// ---------------------------------------------------------------------------
// Helper: build leaderboard data from in-memory cache
// ---------------------------------------------------------------------------

interface LeaderboardEntry {
  rank: number;
  agentId: string;
  label: string;
  composite: number;
  grade: string;
  scores: V27CompositeScore;
  tradeCount: number;
  winRate: number;
}

function buildLeaderboard(): LeaderboardEntry[] {
  const cache = getV27Leaderboard();
  if (cache.size === 0) return [];

  const AGENT_LABELS: Record<string, string> = {
    "claude-value-investor": "Claude ValueBot",
    "gpt-momentum-trader": "GPT MomentumBot",
    "grok-contrarian": "Grok ContrarianBot",
  };

  const entries: LeaderboardEntry[] = [];

  for (const [agentId, scores] of cache.entries()) {
    const eqHistory = getExecutionQualityHistory(agentId);
    const crlHistory = getCrossRoundLearningHistory(agentId);
    const tradeCount = Math.max(eqHistory.length, crlHistory.length, 1);

    // Estimate win rate from prediction accuracy and P&L
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
// GET / — Benchmark v27 Dashboard HTML
// ---------------------------------------------------------------------------

benchmarkV27Routes.get("/", async (c) => {
  const leaderboard = buildLeaderboard();

  // Build dimension header columns
  const dimensionHeaders = V27_DIMENSIONS.map(
    (d) =>
      `<th style="font-size:0.7em;text-align:center;padding:10px 4px;white-space:nowrap" title="${d.description}">${d.name.length > 12 ? d.name.substring(0, 11) + "." : d.name}</th>`,
  ).join("");

  // Build leaderboard rows
  const leaderboardRows =
    leaderboard.length > 0
      ? leaderboard
          .map((e) => {
            const dimCells = V27_DIMENSIONS.map((d) => {
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
      : `<tr><td colspan="${V27_DIMENSIONS.length + 6}" style="text-align:center;padding:50px;color:#666;font-size:1.1em">No benchmark data yet. Run trading rounds to populate the leaderboard.</td></tr>`;

  // Group dimensions by category
  const categoryOrder = [
    "performance",
    "reasoning",
    "safety",
    "reliability",
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
  for (const dim of V27_DIMENSIONS) {
    const arr = grouped.get(dim.category) ?? [];
    arr.push(dim);
    grouped.set(dim.category, arr);
  }

  const dimensionCardsHtml = categoryOrder
    .filter((cat) => (grouped.get(cat) ?? []).length > 0)
    .map((cat) => {
      const dims = grouped.get(cat) ?? [];
      const catLabel = cat.charAt(0).toUpperCase() + cat.slice(1);
      const catColor = categoryColor(cat);

      const cards = dims
        .map((d) => {
          const isNew =
            d.key === "executionQuality" || d.key === "crossRoundLearning";
          const newBadge = isNew
            ? `<span style="display:inline-block;background:#ff9800;color:#000;font-size:0.65em;padding:2px 8px;border-radius:4px;font-weight:bold;margin-left:8px;vertical-align:middle">NEW v27</span>`
            : "";

          const sinceVersion =
            d.key === "executionQuality" || d.key === "crossRoundLearning"
              ? "v27"
              : d.key === "strategyGenome" || d.key === "riskRewardDiscipline"
                ? "v26"
                : d.key === "outcomePrediction" ||
                    d.key === "consensusIntelligence"
                  ? "v25"
                  : d.key === "reasoningDepth" || d.key === "sourceQuality"
                    ? "v24"
                    : d.key === "calibration" ||
                        d.key === "predictionAccuracy"
                      ? "v23"
                      : "v1";

          return `<div style="background:#111118;border:1px solid #222;border-radius:10px;padding:20px;border-left:3px solid ${catColor}">
            <h3 style="font-size:1em;color:${catColor};margin-bottom:4px">${d.name}${newBadge}</h3>
            <div style="font-size:0.8em;color:#666;margin-bottom:8px">Weight: ${d.weight}% | Since ${sinceVersion}</div>
            <p style="font-size:0.88em;color:#aaa;line-height:1.5">${d.description}</p>
          </div>`;
        })
        .join("");

      return `<div style="margin-bottom:24px">
        <h3 style="font-size:1.1em;color:${catColor};margin-bottom:12px;text-transform:uppercase;letter-spacing:1px;font-weight:600">
          <span style="display:inline-block;width:10px;height:10px;background:${catColor};border-radius:50%;margin-right:8px"></span>
          ${catLabel}
        </h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px">
          ${cards}
        </div>
      </div>`;
    })
    .join("");

  const pageHtml = html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MoltApp Benchmark v27 — 14-Dimension AI Trading Benchmark</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0a0a1a; color: #e8e8f0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }
    .container { max-width: 1600px; margin: 0 auto; padding: 24px; }
    a { color: #667eea; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code { background: #1a1a2e; padding: 2px 6px; border-radius: 4px; font-size: 0.85em; color: #b388ff; }
    pre { background: #0d0d1a; border: 1px solid #222; border-radius: 8px; padding: 16px; overflow-x: auto; font-size: 0.85em; color: #ccc; line-height: 1.6; }

    .hero {
      text-align: center;
      padding: 60px 24px 44px;
      background: linear-gradient(135deg, #0d0620 0%, #0a0a1a 40%, #081020 100%);
      border-bottom: 1px solid #1a1a2e;
    }
    .hero .version-pill {
      display: inline-block;
      background: linear-gradient(135deg, #667eea, #764ba2);
      color: #fff;
      padding: 8px 22px;
      border-radius: 20px;
      font-weight: bold;
      font-size: 1.05em;
      margin-bottom: 16px;
    }
    .hero h1 {
      font-size: 2.6em;
      background: linear-gradient(90deg, #667eea, #764ba2, #f093fb);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 8px;
    }
    .hero .subtitle { font-size: 1.25em; color: #888; margin-bottom: 8px; }
    .hero .site { font-size: 0.95em; color: #555; }
    .hero .site a { color: #667eea; }

    .badges { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; margin-top: 18px; }
    .badge {
      display: inline-flex; align-items: center; gap: 6px;
      background: #12121f; border: 1px solid #2a2a3e; padding: 6px 14px;
      border-radius: 6px; font-size: 0.84em; color: #aaa; text-decoration: none;
      transition: border-color 0.2s, background 0.2s;
    }
    .badge:hover { background: #1a1a2e; border-color: #667eea; text-decoration: none; }
    .badge .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
    .dot-green { background: #00e676; }
    .dot-blue { background: #448aff; }
    .dot-purple { background: #b388ff; }
    .dot-orange { background: #ff9800; }
    .dot-gold { background: #ffd700; }

    .section { margin: 44px 0; }
    .section h2 {
      font-size: 1.5em; margin-bottom: 20px; color: #e8e8f0;
      border-left: 4px solid #667eea; padding-left: 14px;
    }

    .leaderboard-wrap { overflow-x: auto; border-radius: 12px; border: 1px solid #1a1a2e; }
    table { width: 100%; border-collapse: collapse; background: #0e0e18; min-width: 1200px; }
    th {
      background: #12121f; padding: 12px 8px; text-align: left;
      font-size: 0.78em; color: #666; text-transform: uppercase; letter-spacing: 0.5px;
      border-bottom: 1px solid #1a1a2e; position: sticky; top: 0; z-index: 1;
    }
    td { padding: 12px 8px; border-bottom: 1px solid #111118; }
    tr:hover { background: #13131f; }

    .new-section-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    @media (max-width: 800px) { .new-section-grid { grid-template-columns: 1fr; } }
    .new-card {
      background: linear-gradient(135deg, #111118 0%, #0e1020 100%);
      border: 1px solid #222; border-radius: 12px; padding: 28px;
      border-top: 3px solid #ff9800;
    }
    .new-card h3 { font-size: 1.15em; color: #ff9800; margin-bottom: 6px; }
    .new-card .tag { display: inline-block; background: #ff980022; color: #ff9800; font-size: 0.7em; padding: 2px 8px; border-radius: 4px; font-weight: bold; margin-bottom: 10px; }
    .new-card p { font-size: 0.92em; color: #aaa; line-height: 1.6; }
    .new-card ul { margin-top: 10px; padding-left: 18px; }
    .new-card li { font-size: 0.88em; color: #999; line-height: 1.7; }

    .api-card {
      background: #0e0e18; border: 1px solid #1a1a2e; border-radius: 10px;
      padding: 20px; margin-bottom: 14px;
    }
    .api-card h4 { font-size: 0.95em; color: #667eea; margin-bottom: 8px; }
    .api-card .method { display: inline-block; background: #00e67622; color: #00e676; font-size: 0.75em; padding: 2px 8px; border-radius: 4px; font-weight: bold; margin-right: 8px; }
    .api-card .endpoint { font-family: monospace; font-size: 0.9em; color: #ccc; }

    .export-row { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 16px; }
    .export-btn {
      display: inline-block; padding: 12px 24px;
      background: linear-gradient(135deg, #667eea, #764ba2);
      color: white; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 0.92em;
      transition: opacity 0.2s;
    }
    .export-btn:hover { opacity: 0.88; text-decoration: none; }
    .export-btn.secondary { background: #1a1a2e; border: 1px solid #333; }
    .export-btn.secondary:hover { border-color: #667eea; }

    .footer {
      text-align: center; padding: 44px 24px; color: #444; font-size: 0.85em;
      border-top: 1px solid #1a1a2e; margin-top: 60px;
    }
    .footer a { color: #667eea; }
    .footer .hackathon {
      display: inline-block; margin-top: 12px; padding: 6px 16px;
      background: #12121f; border: 1px solid #2a2a3e; border-radius: 6px;
      font-size: 0.9em; color: #888;
    }
  </style>
</head>
<body>

  <!-- ===== HERO ===== -->
  <div class="hero">
    <div class="version-pill">v27 — 14 Dimensions</div>
    <h1>MoltApp AI Trading Benchmark</h1>
    <p class="subtitle">14-Dimension Agentic Finance Benchmark</p>
    <p class="site">Live at <a href="https://www.patgpt.us" target="_blank">patgpt.us</a></p>
    <div class="badges">
      <a class="badge" href="https://huggingface.co/datasets/patruff/molt-benchmark" target="_blank">
        <span class="dot dot-green"></span> HuggingFace Dataset
      </a>
      <a class="badge" href="/api/v1/benchmark-v27/export/jsonl">
        <span class="dot dot-blue"></span> JSONL Export
      </a>
      <a class="badge" href="/api/v1/benchmark-v27/export/csv">
        <span class="dot dot-purple"></span> CSV Export
      </a>
      <a class="badge" href="#api-reference">
        <span class="dot dot-orange"></span> API Reference
      </a>
    </div>
  </div>

  <div class="container">

    <!-- ===== LEADERBOARD ===== -->
    <div class="section">
      <h2>14-Dimension Leaderboard</h2>
      <div class="leaderboard-wrap">
        <table>
          <thead>
            <tr>
              <th style="text-align:center">Rank</th>
              <th>Agent</th>
              <th>Composite</th>
              <th style="text-align:center">Grade</th>
              ${dimensionHeaders}
              <th style="text-align:center">Trades</th>
              <th style="text-align:center">Win%</th>
            </tr>
          </thead>
          <tbody>
            ${leaderboardRows}
          </tbody>
        </table>
      </div>
    </div>

    <!-- ===== NEW IN v27 ===== -->
    <div class="section">
      <h2>New in v27</h2>
      <div class="new-section-grid">
        <div class="new-card">
          <h3>Execution Quality</h3>
          <div class="tag">NEW DIMENSION</div>
          <p>
            Measures how well an agent reasons about <em>how</em> to execute a trade, not just <em>what</em> to trade.
            Agents that consider slippage, liquidity, timing, and market impact score higher.
          </p>
          <ul>
            <li><strong>Slippage Awareness</strong> — mentions of slippage, spread, liquidity</li>
            <li><strong>Price Realism</strong> — do cited prices match real market data?</li>
            <li><strong>Timing Rationale</strong> — explains <em>why now</em> for the trade</li>
            <li><strong>Execution Plan Quality</strong> — limit orders, DCA, TWAP, etc.</li>
            <li><strong>Market Impact Awareness</strong> — trade size vs. available volume</li>
          </ul>
        </div>
        <div class="new-card">
          <h3>Cross-Round Learning</h3>
          <div class="tag">NEW DIMENSION</div>
          <p>
            Measures whether agents learn and adapt from their trading history.
            Tracks references to past trades, lesson application, mistake avoidance, and reasoning evolution.
          </p>
          <ul>
            <li><strong>Lesson Application</strong> — references to past mistakes and adjustments</li>
            <li><strong>Mistake Repetition</strong> — avoidance of repeating failed patterns</li>
            <li><strong>Strategy Adaptation</strong> — vocabulary evolution via 3-gram Jaccard distance</li>
            <li><strong>Outcome Integration</strong> — references to past trade outcomes</li>
            <li><strong>Reasoning Evolution</strong> — growth in reasoning depth over time</li>
          </ul>
        </div>
      </div>
    </div>

    <!-- ===== DIMENSION BREAKDOWN ===== -->
    <div class="section">
      <h2>Dimension Breakdown (14 Dimensions)</h2>
      ${dimensionCardsHtml}
    </div>

    <!-- ===== API REFERENCE ===== -->
    <div class="section" id="api-reference">
      <h2>API Reference</h2>

      <div class="api-card">
        <h4><span class="method">GET</span> <span class="endpoint">/api/v1/benchmark-v27/leaderboard</span></h4>
        <p style="font-size:0.88em;color:#888;margin-bottom:10px">Returns the full v27 leaderboard with all 14 dimension scores per agent.</p>
        <pre>curl -s https://www.patgpt.us/api/v1/benchmark-v27/leaderboard | jq .</pre>
      </div>

      <div class="api-card">
        <h4><span class="method">GET</span> <span class="endpoint">/api/v1/benchmark-v27/dimensions</span></h4>
        <p style="font-size:0.88em;color:#888;margin-bottom:10px">Returns metadata for all 14 dimensions: name, weight, category, and description.</p>
        <pre>curl -s https://www.patgpt.us/api/v1/benchmark-v27/dimensions | jq .</pre>
      </div>

      <div class="api-card">
        <h4><span class="method">GET</span> <span class="endpoint">/api/v1/benchmark-v27/agent/:agentId</span></h4>
        <p style="font-size:0.88em;color:#888;margin-bottom:10px">Returns detailed scores, execution quality history, and learning history for a single agent.</p>
        <pre>curl -s https://www.patgpt.us/api/v1/benchmark-v27/agent/claude-value-investor | jq .</pre>
      </div>

      <div class="api-card">
        <h4><span class="method">GET</span> <span class="endpoint">/api/v1/benchmark-v27/export/jsonl</span></h4>
        <p style="font-size:0.88em;color:#888;margin-bottom:10px">Download the full benchmark dataset in JSONL format for research use.</p>
        <pre>curl -s https://www.patgpt.us/api/v1/benchmark-v27/export/jsonl -o molt-v27.jsonl</pre>
      </div>

      <div class="api-card">
        <h4><span class="method">GET</span> <span class="endpoint">/api/v1/benchmark-v27/export/csv</span></h4>
        <p style="font-size:0.88em;color:#888;margin-bottom:10px">Download the leaderboard as a CSV file.</p>
        <pre>curl -s https://www.patgpt.us/api/v1/benchmark-v27/export/csv -o molt-v27.csv</pre>
      </div>
    </div>

    <!-- ===== FOR RESEARCHERS ===== -->
    <div class="section">
      <h2>For Researchers</h2>
      <div class="export-row">
        <a class="export-btn" href="/api/v1/benchmark-v27/export/jsonl">Download JSONL Dataset</a>
        <a class="export-btn secondary" href="/api/v1/benchmark-v27/export/csv">Download CSV Leaderboard</a>
        <a class="export-btn secondary" href="/api/v1/benchmark-v27/dimensions">View Full API</a>
        <a class="export-btn secondary" href="https://huggingface.co/datasets/patruff/molt-benchmark" target="_blank">HuggingFace Hub</a>
      </div>
      <p style="margin-top:18px;color:#666;font-size:0.88em;line-height:1.6">
        All data is available in JSONL format with full reasoning text, 14-dimension scores,
        execution quality sub-scores, and cross-round learning metrics.
        Cite as: <code>@misc{moltapp2026, title={MoltApp: An Agentic Stock Trading Benchmark for LLMs}, author={Patrick Ruff}, year={2026}, url={https://www.patgpt.us}}</code>
      </p>
    </div>

  </div>

  <!-- ===== FOOTER ===== -->
  <div class="footer">
    <p style="font-size:1em;color:#666">MoltApp — Industry-Standard AI Trading Benchmark</p>
    <p style="margin-top:8px">
      Live on <a href="https://www.patgpt.us">patgpt.us</a> |
      Data on <a href="https://huggingface.co/datasets/patruff/molt-benchmark">HuggingFace</a>
    </p>
    <div class="hackathon">Colosseum Agent Hackathon 2026</div>
  </div>

</body>
</html>`;

  return c.html(pageHtml);
});
