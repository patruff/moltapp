/**
 * Benchmark v13 Battle Dashboard
 *
 * The definitive head-to-head agent battle visualization.
 * Shows real-time Elo rankings, battle history, win/loss matrices,
 * reasoning quality comparisons, and battle highlight reels.
 *
 * Routes:
 *   GET /         — HTML dashboard page
 *   GET /data     — JSON data for dashboard
 *   GET /stream   — SSE stream of live battle events
 */

import { Hono } from "hono";
import {
  getBattleHistory,
  getEloLeaderboard,
  getAgentBattleRecord,
  getHeadToHeadMatrix,
  getBattleHighlights,
  getBattleStats,
  type BattleResult,
} from "../services/battle-scoring-engine.ts";

export const benchmarkV13Routes = new Hono();

// ---------------------------------------------------------------------------
// In-memory SSE event buffer
// ---------------------------------------------------------------------------

interface V13Event {
  type: string;
  data: Record<string, unknown>;
  agentId?: string;
  timestamp: string;
}

const v13EventBuffer: V13Event[] = [];
const MAX_V13_EVENTS = 200;

export function emitV13Event(
  type: string,
  data: Record<string, unknown>,
  agentId?: string,
): void {
  v13EventBuffer.unshift({
    type,
    data,
    agentId,
    timestamp: new Date().toISOString(),
  });
  if (v13EventBuffer.length > MAX_V13_EVENTS) {
    v13EventBuffer.length = MAX_V13_EVENTS;
  }
}

// ---------------------------------------------------------------------------
// Data Endpoint
// ---------------------------------------------------------------------------

/**
 * GET /data — JSON data powering the v13 dashboard
 */
benchmarkV13Routes.get("/data", (c) => {
  const eloLeaderboard = getEloLeaderboard();
  const matrix = getHeadToHeadMatrix();
  const highlights = getBattleHighlights(5);
  const stats = getBattleStats();
  const { battles: recentBattles } = getBattleHistory({ limit: 10 });

  // Build agent records
  const agentRecords = eloLeaderboard.map((e) => {
    const record = getAgentBattleRecord(e.agentId);
    return {
      agentId: e.agentId,
      eloRating: e.eloRating,
      rank: e.rank,
      wins: record.wins,
      losses: record.losses,
      ties: record.ties,
      winRate: record.winRate,
      avgMargin: record.avgMargin,
      strongestDimension: record.strongestDimension,
      weakestDimension: record.weakestDimension,
      streak: `${record.streakType} ${record.streakLength}`,
    };
  });

  return c.json({
    ok: true,
    benchmarkVersion: "v13",
    timestamp: new Date().toISOString(),
    stats,
    leaderboard: agentRecords,
    matrix,
    highlights: highlights.map((h) => ({
      battleId: h.battleId,
      reason: h.reason,
      winner: h.battle.overallWinner,
      margin: h.battle.marginOfVictory,
      narrative: h.battle.narrative,
      agents: [h.battle.agentA.agentId, h.battle.agentB.agentId],
    })),
    recentBattles: recentBattles.map((b) => ({
      battleId: b.battleId,
      roundId: b.roundId,
      timestamp: b.timestamp,
      agentA: b.agentA.agentId,
      agentB: b.agentB.agentId,
      winner: b.overallWinner,
      margin: b.marginOfVictory,
      narrative: b.narrative,
      highlight: b.highlight,
    })),
    recentEvents: v13EventBuffer.slice(0, 20),
  });
});

// ---------------------------------------------------------------------------
// SSE Stream
// ---------------------------------------------------------------------------

/**
 * GET /stream — Server-Sent Events stream of live battle events
 */
benchmarkV13Routes.get("/stream", (c) => {
  let lastEventIndex = 0;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Send initial burst of recent events
      for (const event of v13EventBuffer.slice(0, 10).reverse()) {
        const data = JSON.stringify(event);
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      }
      lastEventIndex = v13EventBuffer.length;

      // Poll for new events every 3 seconds
      const interval = setInterval(() => {
        const newEvents = v13EventBuffer.slice(0, Math.max(0, v13EventBuffer.length - lastEventIndex));
        for (const event of newEvents.reverse()) {
          const data = JSON.stringify(event);
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        }
        lastEventIndex = v13EventBuffer.length;

        // Heartbeat
        controller.enqueue(encoder.encode(`: heartbeat ${new Date().toISOString()}\n\n`));
      }, 3000);

      // Cleanup
      const cleanup = () => {
        clearInterval(interval);
        try { controller.close(); } catch { /* stream already closed */ }
      };

      // Auto-close after 5 minutes
      setTimeout(cleanup, 5 * 60 * 1000);
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
// Export Endpoint
// ---------------------------------------------------------------------------

/**
 * GET /export — Export full battle data for researchers
 */
benchmarkV13Routes.get("/export", (c) => {
  const stats = getBattleStats();
  const leaderboard = getEloLeaderboard();
  const matrix = getHeadToHeadMatrix();
  const { battles } = getBattleHistory({ limit: 500 });

  return c.json({
    ok: true,
    benchmarkVersion: "v13",
    exportedAt: new Date().toISOString(),
    stats,
    leaderboard,
    matrix,
    battleCount: battles.length,
    battles: battles.map((b) => ({
      battleId: b.battleId,
      roundId: b.roundId,
      timestamp: b.timestamp,
      agentA: b.agentA.agentId,
      agentB: b.agentB.agentId,
      winner: b.overallWinner,
      margin: b.marginOfVictory,
      compositeA: b.compositeScoreA,
      compositeB: b.compositeScoreB,
      dimensions: b.dimensions.map((d) => ({
        name: d.name,
        winner: d.winnerAgentId,
        scoreA: d.scoreA,
        scoreB: d.scoreB,
      })),
    })),
  });
});

// ---------------------------------------------------------------------------
// HTML Dashboard
// ---------------------------------------------------------------------------

/**
 * GET / — The v13 Battle Benchmark Dashboard
 */
benchmarkV13Routes.get("/", (c) => {
  const eloLeaderboard = getEloLeaderboard();
  const matrix = getHeadToHeadMatrix();
  const highlights = getBattleHighlights(5);
  const stats = getBattleStats();
  const { battles: recentBattles } = getBattleHistory({ limit: 8 });

  // Build agent records for the page
  const agentRecords = eloLeaderboard.map((e) => {
    const record = getAgentBattleRecord(e.agentId);
    return { ...e, ...record };
  });

  const AGENT_NAMES: Record<string, string> = {
    "claude-value-investor": "Claude ValueBot",
    "gpt-momentum-trader": "GPT MomentumBot",
    "grok-contrarian": "Grok ContrarianBot",
  };

  const AGENT_COLORS: Record<string, string> = {
    "claude-value-investor": "#d97706",
    "gpt-momentum-trader": "#16a34a",
    "grok-contrarian": "#dc2626",
  };

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MoltApp Benchmark v13 — Agent Battle Arena</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: #0a0a0a; color: #e5e5e5; min-height: 100vh; }
    .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; padding: 30px 0 20px; border-bottom: 2px solid #dc2626; margin-bottom: 30px; }
    .header h1 { font-size: 2.2em; font-weight: 800; background: linear-gradient(90deg, #dc2626, #f59e0b, #16a34a); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .header .subtitle { color: #999; margin-top: 8px; font-size: 1.1em; }
    .badges { display: flex; gap: 10px; justify-content: center; margin-top: 15px; flex-wrap: wrap; }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 0.8em; font-weight: 600; }
    .badge-red { background: rgba(220,38,38,0.2); border: 1px solid #dc2626; color: #f87171; }
    .badge-green { background: rgba(22,163,74,0.2); border: 1px solid #16a34a; color: #4ade80; }
    .badge-blue { background: rgba(59,130,246,0.2); border: 1px solid #3b82f6; color: #93c5fd; }
    .badge-yellow { background: rgba(245,158,11,0.2); border: 1px solid #f59e0b; color: #fbbf24; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 30px; }
    .grid-full { grid-column: 1 / -1; }
    .card { background: #141414; border: 1px solid #262626; border-radius: 12px; padding: 24px; }
    .card h2 { font-size: 1.2em; color: #f59e0b; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
    .card h2 .icon { font-size: 1.3em; }
    .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 30px; }
    .stat-card { background: #141414; border: 1px solid #262626; border-radius: 10px; padding: 18px; text-align: center; }
    .stat-value { font-size: 1.8em; font-weight: 800; color: #f59e0b; }
    .stat-label { font-size: 0.85em; color: #999; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 10px 12px; color: #999; font-size: 0.85em; font-weight: 600; text-transform: uppercase; border-bottom: 1px solid #262626; }
    td { padding: 12px; border-bottom: 1px solid #1a1a1a; }
    .rank { font-size: 1.4em; font-weight: 800; width: 40px; }
    .rank-1 { color: #f59e0b; }
    .rank-2 { color: #94a3b8; }
    .rank-3 { color: #b45309; }
    .elo { font-size: 1.3em; font-weight: 700; color: #e5e5e5; }
    .win-loss { font-size: 0.9em; }
    .win { color: #4ade80; }
    .loss { color: #f87171; }
    .tie { color: #94a3b8; }
    .agent-name { font-weight: 600; font-size: 1.05em; }
    .dimension-tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.75em; font-weight: 600; background: rgba(59,130,246,0.15); color: #93c5fd; margin: 2px; }
    .battle-card { background: #1a1a1a; border-radius: 8px; padding: 16px; margin-bottom: 12px; border-left: 3px solid #f59e0b; }
    .battle-card .narrative { color: #ccc; font-style: italic; margin-top: 8px; line-height: 1.4; }
    .battle-card .meta { display: flex; gap: 16px; color: #999; font-size: 0.85em; margin-top: 6px; }
    .highlight-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.75em; background: rgba(220,38,38,0.2); color: #f87171; font-weight: 600; }
    .matrix-table th, .matrix-table td { text-align: center; padding: 8px 12px; font-size: 0.9em; }
    .matrix-cell { font-weight: 700; }
    .matrix-win { color: #4ade80; }
    .matrix-loss { color: #f87171; }
    .matrix-self { color: #444; }
    .footer { text-align: center; padding: 30px 0; border-top: 1px solid #262626; margin-top: 30px; color: #666; }
    .footer a { color: #f59e0b; text-decoration: none; }
    @media (max-width: 768px) { .grid { grid-template-columns: 1fr; } .stats-grid { grid-template-columns: repeat(2, 1fr); } }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>MoltApp Benchmark v13 — Battle Arena</h1>
      <div class="subtitle">Head-to-Head Agent Reasoning Battles | Real Stocks on Solana</div>
      <div class="badges">
        <span class="badge badge-red">LIVE BATTLES</span>
        <span class="badge badge-green">Elo Rankings</span>
        <span class="badge badge-blue">7-Dimension Scoring</span>
        <span class="badge badge-yellow">Reasoning Quality</span>
        <a href="https://huggingface.co/datasets/patruff/molt-benchmark" class="badge badge-yellow" style="text-decoration:none">HuggingFace Dataset</a>
      </div>
    </div>

    <!-- Stats -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${stats.totalBattles}</div>
        <div class="stat-label">Total Battles</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.totalRounds}</div>
        <div class="stat-label">Trading Rounds</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${(stats.avgMarginOfVictory * 100).toFixed(1)}%</div>
        <div class="stat-label">Avg Margin</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${(stats.tieRate * 100).toFixed(0)}%</div>
        <div class="stat-label">Tie Rate</div>
      </div>
    </div>

    <div class="grid">
      <!-- Elo Leaderboard -->
      <div class="card grid-full">
        <h2><span class="icon">🏆</span> Elo Battle Rankings</h2>
        <table>
          <tr>
            <th>Rank</th>
            <th>Agent</th>
            <th>Elo Rating</th>
            <th>Record (W-L-T)</th>
            <th>Win Rate</th>
            <th>Avg Margin</th>
            <th>Strongest</th>
            <th>Weakest</th>
            <th>Streak</th>
          </tr>
          ${agentRecords.map((a, i) => `
          <tr>
            <td class="rank rank-${i + 1}">#${a.rank}</td>
            <td class="agent-name" style="color: ${AGENT_COLORS[a.agentId] ?? '#e5e5e5'}">${AGENT_NAMES[a.agentId] ?? a.agentId}</td>
            <td class="elo">${a.eloRating}</td>
            <td class="win-loss">
              <span class="win">${a.wins}W</span> -
              <span class="loss">${a.losses}L</span> -
              <span class="tie">${a.ties}T</span>
            </td>
            <td>${(a.winRate * 100).toFixed(0)}%</td>
            <td>${a.avgMargin > 0 ? "+" : ""}${(a.avgMargin * 100).toFixed(1)}%</td>
            <td><span class="dimension-tag">${a.strongestDimension}</span></td>
            <td><span class="dimension-tag">${a.weakestDimension}</span></td>
            <td>${a.streakType === "win" ? "🔥" : a.streakType === "loss" ? "❄️" : "➖"} ${a.streakLength}</td>
          </tr>`).join("")}
        </table>
        ${agentRecords.length === 0 ? "<p style='color:#666;text-align:center;padding:30px'>No battles yet. Trigger a trading round to start the competition.</p>" : ""}
      </div>

      <!-- Head-to-Head Matrix -->
      <div class="card">
        <h2><span class="icon">⚔️</span> Head-to-Head Matrix</h2>
        ${matrix.agents.length > 0 ? `
        <table class="matrix-table">
          <tr>
            <th></th>
            ${matrix.agents.map((a) => `<th style="color:${AGENT_COLORS[a] ?? '#ccc'}">${(AGENT_NAMES[a] ?? a).split(" ")[0]}</th>`).join("")}
          </tr>
          ${matrix.agents.map((a, i) => `
          <tr>
            <td style="color:${AGENT_COLORS[a] ?? '#ccc'};font-weight:600">${(AGENT_NAMES[a] ?? a).split(" ")[0]}</td>
            ${matrix.agents.map((_, j) => {
              if (i === j) return `<td class="matrix-cell matrix-self">—</td>`;
              const w = matrix.wins[i][j];
              const l = matrix.wins[j][i];
              return `<td class="matrix-cell ${w > l ? "matrix-win" : w < l ? "matrix-loss" : ""}">${w}-${l}</td>`;
            }).join("")}
          </tr>`).join("")}
        </table>` : "<p style='color:#666;text-align:center;padding:20px'>Awaiting battles...</p>"}
      </div>

      <!-- Battle Highlights -->
      <div class="card">
        <h2><span class="icon">🌟</span> Battle Highlights</h2>
        ${highlights.length > 0 ? highlights.map((h) => `
        <div class="battle-card">
          <div>
            <span class="highlight-badge">${h.reason}</span>
          </div>
          <div class="narrative">${h.battle.narrative}</div>
          <div class="meta">
            <span>Margin: ${(h.battle.marginOfVictory * 100).toFixed(1)}%</span>
            <span>${new Date(h.battle.timestamp).toLocaleString()}</span>
          </div>
        </div>`).join("") : "<p style='color:#666;text-align:center;padding:20px'>No highlights yet.</p>"}
      </div>

      <!-- Recent Battles -->
      <div class="card grid-full">
        <h2><span class="icon">⚡</span> Recent Battles</h2>
        ${recentBattles.length > 0 ? recentBattles.map((b) => {
          const winnerColor = b.overallWinner ? (AGENT_COLORS[b.overallWinner] ?? "#f59e0b") : "#94a3b8";
          return `
          <div class="battle-card" style="border-left-color: ${winnerColor}">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div>
                <span style="color:${AGENT_COLORS[b.agentA.agentId] ?? '#ccc'};font-weight:600">${AGENT_NAMES[b.agentA.agentId] ?? b.agentA.agentId}</span>
                <span style="color:#666"> vs </span>
                <span style="color:${AGENT_COLORS[b.agentB.agentId] ?? '#ccc'};font-weight:600">${AGENT_NAMES[b.agentB.agentId] ?? b.agentB.agentId}</span>
              </div>
              <div>
                ${b.overallWinner
                  ? `<span style="color:${winnerColor};font-weight:700">${(AGENT_NAMES[b.overallWinner] ?? b.overallWinner).split(" ")[0]} wins</span> <span style="color:#666">(${(b.marginOfVictory * 100).toFixed(1)}%)</span>`
                  : `<span class="tie">TIE</span>`
                }
                ${b.highlight ? ' <span class="highlight-badge">HIGHLIGHT</span>' : ""}
              </div>
            </div>
            <div class="narrative">${b.narrative}</div>
            <div class="meta">
              ${b.dimensions.map((d) => `<span>${d.name}: ${d.winnerAgentId ? (AGENT_NAMES[d.winnerAgentId] ?? d.winnerAgentId).split(" ")[0] : "tie"}</span>`).join(" | ")}
            </div>
          </div>`;
        }).join("") : "<p style='color:#666;text-align:center;padding:30px'>No battles yet. Start a trading round to see agent-vs-agent results.</p>"}
      </div>

      <!-- Scoring Methodology -->
      <div class="card grid-full">
        <h2><span class="icon">📊</span> Battle Scoring Methodology</h2>
        <table>
          <tr><th>Dimension</th><th>Weight</th><th>Description</th></tr>
          <tr><td>Financial</td><td>20%</td><td>P&L comparison — who made more money?</td></tr>
          <tr><td>Reasoning Coherence</td><td>20%</td><td>Does the reasoning logically support the action taken?</td></tr>
          <tr><td>Reasoning Depth</td><td>15%</td><td>How many analytical factors were considered?</td></tr>
          <tr><td>Conviction Calibration</td><td>15%</td><td>Is confidence appropriate for the evidence presented?</td></tr>
          <tr><td>Originality</td><td>10%</td><td>Is reasoning novel or templated?</td></tr>
          <tr><td>Safety</td><td>10%</td><td>Hallucination-free rate: factual accuracy of claims</td></tr>
          <tr><td>Discipline</td><td>10%</td><td>Compliance with position limits and trading rules</td></tr>
        </table>
      </div>
    </div>

    <div class="footer">
      <a href="https://www.patgpt.us">www.patgpt.us</a> |
      <a href="/benchmark-v12">v12 Dashboard</a> |
      <a href="/api/v1/benchmark-v13/schema">API Schema</a> |
      <a href="/api/v1/benchmark-v13/export/jsonl">Export JSONL</a> |
      <a href="https://huggingface.co/datasets/patruff/molt-benchmark">HuggingFace</a>
      <br><br>
      <span style="color:#444">MoltApp Benchmark v13 — Battle Arena | Colosseum Agent Hackathon</span>
    </div>
  </div>

  <script>
    // Auto-refresh every 45 seconds
    setTimeout(() => location.reload(), 45000);
  </script>
</body>
</html>`;

  return c.html(html);
});
