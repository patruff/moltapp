/**
 * Battle Dashboard — Live Agent Competition Visualization
 *
 * An interactive HTML page that lets hackathon judges:
 * 1. Trigger a trading round with one click
 * 2. Watch agents make decisions in real-time
 * 3. See agent reasoning and confidence scores
 * 4. View head-to-head comparison stats
 * 5. Track circuit breaker activations
 * 6. See consensus analysis
 *
 * This is the "wow factor" page for the Colosseum Agent Hackathon demo.
 */

import { Hono } from "hono";
import { html } from "hono/html";

const app = new Hono();

app.get("/", (c) => {
  const page = html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MoltApp Battle Dashboard — AI Agent Trading Competition</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #0a0b0e;
      --surface: #12141a;
      --surface2: #1a1d26;
      --border: #2a2e3a;
      --text: #e1e4ea;
      --text-dim: #8b8fa3;
      --accent: #6c5ce7;
      --green: #00b894;
      --red: #ff6b6b;
      --yellow: #ffd93d;
      --blue: #74b9ff;
      --claude: #d4a574;
      --gpt: #74d4a5;
      --grok: #a574d4;
    }
    body {
      font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
    }
    .header {
      background: linear-gradient(135deg, #1a1030 0%, #0a0b0e 50%, #0a1520 100%);
      border-bottom: 1px solid var(--border);
      padding: 1.5rem 2rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .header h1 {
      font-size: 1.4rem;
      background: linear-gradient(135deg, var(--accent), var(--blue));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .header .subtitle {
      color: var(--text-dim);
      font-size: 0.75rem;
      margin-top: 0.2rem;
    }
    .trigger-btn {
      background: linear-gradient(135deg, var(--accent), #5a4bd1);
      color: white;
      border: none;
      padding: 0.8rem 2rem;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;
      font-family: inherit;
      letter-spacing: 0.5px;
    }
    .trigger-btn:hover { transform: translateY(-2px); box-shadow: 0 4px 20px rgba(108, 92, 231, 0.4); }
    .trigger-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
    .trigger-btn.running { animation: pulse 1.5s infinite; }
    @keyframes pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(108, 92, 231, 0.5); }
      50% { box-shadow: 0 0 0 12px rgba(108, 92, 231, 0); }
    }
    .main { padding: 1.5rem 2rem; display: grid; gap: 1.5rem; }
    .agent-cards {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1.5rem;
    }
    .agent-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.5rem;
      transition: all 0.3s;
    }
    .agent-card.active { border-color: var(--accent); box-shadow: 0 0 30px rgba(108, 92, 231, 0.15); }
    .agent-card.decided { border-color: var(--green); }
    .agent-header {
      display: flex;
      align-items: center;
      gap: 0.8rem;
      margin-bottom: 1rem;
    }
    .agent-avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.2rem;
      font-weight: 700;
    }
    .agent-avatar.claude { background: rgba(212, 165, 116, 0.2); color: var(--claude); }
    .agent-avatar.gpt { background: rgba(116, 212, 165, 0.2); color: var(--gpt); }
    .agent-avatar.grok { background: rgba(165, 116, 212, 0.2); color: var(--grok); }
    .agent-name { font-weight: 700; font-size: 1rem; }
    .agent-model { color: var(--text-dim); font-size: 0.7rem; }
    .agent-status {
      display: inline-block;
      padding: 0.15rem 0.6rem;
      border-radius: 12px;
      font-size: 0.65rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .status-idle { background: rgba(139, 143, 163, 0.15); color: var(--text-dim); }
    .status-thinking { background: rgba(108, 92, 231, 0.2); color: var(--accent); animation: blink 1s infinite; }
    .status-decided { background: rgba(0, 184, 148, 0.2); color: var(--green); }
    .status-blocked { background: rgba(255, 107, 107, 0.2); color: var(--red); }
    @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .decision-box {
      margin-top: 1rem;
      padding: 1rem;
      background: var(--surface2);
      border-radius: 8px;
      min-height: 120px;
    }
    .decision-action {
      font-size: 1.4rem;
      font-weight: 800;
      margin-bottom: 0.3rem;
    }
    .action-buy { color: var(--green); }
    .action-sell { color: var(--red); }
    .action-hold { color: var(--yellow); }
    .decision-details { color: var(--text-dim); font-size: 0.75rem; line-height: 1.5; }
    .confidence-bar {
      margin-top: 0.8rem;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 4px;
      height: 6px;
      overflow: hidden;
    }
    .confidence-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.8s ease;
    }
    .confidence-label { font-size: 0.65rem; color: var(--text-dim); margin-top: 0.3rem; }
    .bottom-panels {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.5rem;
    }
    .panel {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.5rem;
    }
    .panel h3 {
      font-size: 0.85rem;
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 1.5px;
      margin-bottom: 1rem;
    }
    .event-log {
      max-height: 300px;
      overflow-y: auto;
      font-size: 0.75rem;
    }
    .event-log::-webkit-scrollbar { width: 4px; }
    .event-log::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
    .event-entry {
      padding: 0.5rem 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.03);
      display: flex;
      gap: 0.8rem;
      align-items: flex-start;
    }
    .event-time { color: var(--text-dim); white-space: nowrap; font-size: 0.65rem; }
    .event-msg { flex: 1; line-height: 1.4; }
    .consensus-display {
      text-align: center;
      padding: 2rem;
    }
    .consensus-type {
      font-size: 2rem;
      font-weight: 800;
      margin-bottom: 0.5rem;
    }
    .consensus-desc { color: var(--text-dim); font-size: 0.8rem; }
    .stats-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 1rem;
      margin-top: 1.5rem;
    }
    .stat-card {
      background: var(--surface2);
      border-radius: 8px;
      padding: 1rem;
      text-align: center;
    }
    .stat-value { font-size: 1.5rem; font-weight: 800; }
    .stat-label { color: var(--text-dim); font-size: 0.65rem; margin-top: 0.3rem; text-transform: uppercase; letter-spacing: 1px; }
    .round-meta {
      display: flex;
      justify-content: center;
      gap: 2rem;
      padding: 0.8rem;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      font-size: 0.75rem;
      color: var(--text-dim);
    }
    .round-meta span { font-weight: 600; color: var(--text); }
    .circuit-breaker-list { font-size: 0.75rem; }
    .cb-entry { padding: 0.4rem 0; display: flex; gap: 0.5rem; align-items: center; }
    .cb-badge {
      padding: 0.1rem 0.4rem;
      border-radius: 4px;
      font-size: 0.6rem;
      font-weight: 700;
      text-transform: uppercase;
    }
    .cb-blocked { background: rgba(255, 107, 107, 0.2); color: var(--red); }
    .cb-clamped { background: rgba(255, 217, 61, 0.2); color: var(--yellow); }
    .no-data { color: var(--text-dim); font-style: italic; text-align: center; padding: 2rem; font-size: 0.8rem; }
    @media (max-width: 768px) {
      .agent-cards { grid-template-columns: 1fr; }
      .bottom-panels { grid-template-columns: 1fr; }
      .stats-row { grid-template-columns: repeat(2, 1fr); }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>MOLTAPP BATTLE DASHBOARD</h1>
      <div class="subtitle">Opus 4.5 vs GPT-5.2 vs Grok 4 — Autonomous Tool-Calling Agents — 50 Calls/Round // Colosseum 2026</div>
    </div>
    <button class="trigger-btn" id="triggerBtn" onclick="triggerRound()">
      TRIGGER TRADING ROUND
    </button>
  </div>

  <div class="main">
    <div class="round-meta" id="roundMeta">
      <div>Round: <span id="roundId">—</span></div>
      <div>Status: <span id="roundStatus">Idle</span></div>
      <div>Duration: <span id="roundDuration">—</span></div>
      <div>Mode: <span id="roundMode">Paper</span></div>
    </div>

    <div class="agent-cards">
      <div class="agent-card" id="card-claude">
        <div class="agent-header">
          <div class="agent-avatar claude">C</div>
          <div>
            <div class="agent-name">Claude Trader</div>
            <div class="agent-model">claude-opus-4-5 // Value Investor</div>
          </div>
          <span class="agent-status status-idle" id="status-claude">IDLE</span>
        </div>
        <div class="decision-box" id="decision-claude">
          <div class="no-data">Waiting for round...</div>
        </div>
      </div>

      <div class="agent-card" id="card-gpt">
        <div class="agent-header">
          <div class="agent-avatar gpt">G</div>
          <div>
            <div class="agent-name">GPT Trader</div>
            <div class="agent-model">gpt-5.2 // Momentum Trader</div>
          </div>
          <span class="agent-status status-idle" id="status-gpt">IDLE</span>
        </div>
        <div class="decision-box" id="decision-gpt">
          <div class="no-data">Waiting for round...</div>
        </div>
      </div>

      <div class="agent-card" id="card-grok">
        <div class="agent-header">
          <div class="agent-avatar grok">X</div>
          <div>
            <div class="agent-name">Grok Trader</div>
            <div class="agent-model">grok-4 // Contrarian</div>
          </div>
          <span class="agent-status status-idle" id="status-grok">IDLE</span>
        </div>
        <div class="decision-box" id="decision-grok">
          <div class="no-data">Waiting for round...</div>
        </div>
      </div>
    </div>

    <div class="stats-row" id="statsRow">
      <div class="stat-card">
        <div class="stat-value" id="statConsensus">—</div>
        <div class="stat-label">Consensus</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" id="statTrades">0</div>
        <div class="stat-label">Trades Executed</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" id="statBreakers">0</div>
        <div class="stat-label">Circuit Breakers</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" id="statDuration">—</div>
        <div class="stat-label">Round Time</div>
      </div>
    </div>

    <div class="bottom-panels">
      <div class="panel">
        <h3>Live Event Log</h3>
        <div class="event-log" id="eventLog">
          <div class="no-data">Events will appear here during a trading round</div>
        </div>
      </div>

      <div class="panel">
        <h3>Circuit Breaker Activity</h3>
        <div class="circuit-breaker-list" id="cbList">
          <div class="no-data">No circuit breaker activations yet</div>
        </div>
      </div>
    </div>
  </div>

  <script>
    const agentIdMap = {
      'claude-trader': 'claude',
      'gpt-trader': 'gpt',
      'grok-trader': 'grok',
    };

    function addEvent(msg, type) {
      const log = document.getElementById('eventLog');
      if (log.querySelector('.no-data')) log.innerHTML = '';
      const time = new Date().toLocaleTimeString('en-US', { hour12: false });
      const colors = {
        info: 'var(--text)',
        success: 'var(--green)',
        warning: 'var(--yellow)',
        error: 'var(--red)',
        agent: 'var(--accent)',
      };
      const entry = document.createElement('div');
      entry.className = 'event-entry';
      entry.innerHTML = '<span class="event-time">' + time + '</span><span class="event-msg" style="color:' + (colors[type] || colors.info) + '">' + msg + '</span>';
      log.prepend(entry);
      // Keep last 50 entries
      while (log.children.length > 50) log.removeChild(log.lastChild);
    }

    function setAgentStatus(agentKey, status) {
      const el = document.getElementById('status-' + agentKey);
      const card = document.getElementById('card-' + agentKey);
      el.className = 'agent-status status-' + status;
      el.textContent = status.toUpperCase();
      card.className = 'agent-card' + (status === 'thinking' ? ' active' : status === 'decided' ? ' decided' : '');
    }

    function renderDecision(agentKey, result) {
      const box = document.getElementById('decision-' + agentKey);
      const d = result.decision;
      const actionClass = 'action-' + d.action;
      const confColor = d.confidence > 70 ? 'var(--green)' : d.confidence > 40 ? 'var(--yellow)' : 'var(--red)';
      const executed = result.executed ? 'Executed' : 'Blocked';
      const execColor = result.executed ? 'var(--green)' : 'var(--red)';

      box.innerHTML =
        '<div class="decision-action ' + actionClass + '">' + d.action.toUpperCase() + ' ' + d.symbol + '</div>' +
        '<div class="decision-details">' +
          '<div style="margin-bottom:0.4rem;color:' + execColor + '">' + executed + (result.executionDetails?.txSignature ? ' // ' + result.executionDetails.txSignature.slice(0, 16) + '...' : '') + '</div>' +
          '<div>' + d.reasoning.slice(0, 200) + (d.reasoning.length > 200 ? '...' : '') + '</div>' +
          (d.action !== 'hold' && d.quantity ? '<div style="margin-top:0.3rem;color:var(--text)">Qty: $' + d.quantity.toFixed(2) + ' USDC</div>' : '') +
        '</div>' +
        '<div class="confidence-bar"><div class="confidence-fill" style="width:' + d.confidence + '%;background:' + confColor + '"></div></div>' +
        '<div class="confidence-label">Confidence: ' + d.confidence + '%</div>';
    }

    function addCircuitBreaker(activation) {
      const list = document.getElementById('cbList');
      if (list.querySelector('.no-data')) list.innerHTML = '';
      const badge = activation.action === 'blocked' ? 'cb-blocked' : 'cb-clamped';
      const entry = document.createElement('div');
      entry.className = 'cb-entry';
      entry.innerHTML =
        '<span class="cb-badge ' + badge + '">' + activation.action + '</span>' +
        '<span>' + activation.breaker + '</span>' +
        '<span style="color:var(--text-dim);font-size:0.65rem">' + activation.reason.slice(0, 80) + '</span>';
      list.prepend(entry);
    }

    async function triggerRound() {
      const btn = document.getElementById('triggerBtn');
      btn.disabled = true;
      btn.classList.add('running');
      btn.textContent = 'RUNNING...';

      // Reset UI
      ['claude', 'gpt', 'grok'].forEach(k => {
        setAgentStatus(k, 'thinking');
        document.getElementById('decision-' + k).innerHTML = '<div class="no-data" style="animation:blink 1s infinite">Analyzing market data...</div>';
      });
      document.getElementById('cbList').innerHTML = '';
      document.getElementById('statConsensus').textContent = '...';
      document.getElementById('statTrades').textContent = '...';
      document.getElementById('statBreakers').textContent = '...';
      document.getElementById('statDuration').textContent = '...';

      addEvent('Triggering new trading round...', 'info');

      try {
        const resp = await fetch('/api/v1/trigger/trigger', { method: 'POST' });
        const data = await resp.json();

        document.getElementById('roundId').textContent = data.roundId?.slice(0, 20) || '—';
        document.getElementById('roundStatus').textContent = data.status || 'unknown';
        document.getElementById('roundDuration').textContent = data.durationMs ? data.durationMs + 'ms' : '—';
        document.getElementById('roundMode').textContent = data.mode || 'paper';

        addEvent('Round ' + (data.roundId?.slice(0, 12) || '?') + ' started', 'success');

        // Animate agent results with delays
        if (data.results) {
          for (let i = 0; i < data.results.length; i++) {
            await new Promise(r => setTimeout(r, 600));
            const result = data.results[i];
            const key = agentIdMap[result.agentId] || result.agentId;
            setAgentStatus(key, result.executed ? 'decided' : 'blocked');
            renderDecision(key, result);
            const d = result.decision;
            addEvent(result.agentName + ': ' + d.action.toUpperCase() + ' ' + d.symbol + ' (' + d.confidence + '% confidence)', 'agent');
          }
        }

        // Circuit breakers
        if (data.circuitBreakerActivations) {
          for (const a of data.circuitBreakerActivations) {
            addCircuitBreaker(a);
            addEvent('Circuit breaker: ' + a.breaker + ' (' + a.action + ') on ' + a.agentId, 'warning');
          }
        }

        // Stats
        const trades = (data.results || []).filter(r => r.executed && r.decision.action !== 'hold').length;
        document.getElementById('statConsensus').textContent = (data.consensus || '—').replace('_', ' ');
        document.getElementById('statTrades').textContent = trades;
        document.getElementById('statBreakers').textContent = (data.circuitBreakerActivations || []).length;
        document.getElementById('statDuration').textContent = data.durationMs ? data.durationMs + 'ms' : '—';

        // Errors
        if (data.errors?.length > 0) {
          for (const err of data.errors) {
            addEvent('Error: ' + err, 'error');
          }
        }

        addEvent('Round complete: ' + (data.summary || 'No summary'), 'success');
      } catch (err) {
        addEvent('Failed to trigger round: ' + err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.classList.remove('running');
        btn.textContent = 'TRIGGER TRADING ROUND';
      }
    }

    // Auto-load last round on page load
    (async () => {
      try {
        const resp = await fetch('/api/v1/trigger/last');
        const data = await resp.json();
        if (data.round) {
          const r = data.round;
          document.getElementById('roundId').textContent = r.roundId?.slice(0, 20) || '—';
          document.getElementById('roundStatus').textContent = r.status || 'unknown';
          document.getElementById('roundDuration').textContent = r.durationMs ? r.durationMs + 'ms' : '—';
          if (r.results) {
            for (const result of r.results) {
              const key = agentIdMap[result.agentId] || result.agentId;
              setAgentStatus(key, result.executed ? 'decided' : 'blocked');
              renderDecision(key, result);
            }
          }
          if (r.circuitBreakerActivations) {
            for (const a of r.circuitBreakerActivations) {
              addCircuitBreaker(a);
            }
          }
          const trades = (r.results || []).filter(x => x.executed && x.decision.action !== 'hold').length;
          document.getElementById('statConsensus').textContent = (r.consensus || '—').replace('_', ' ');
          document.getElementById('statTrades').textContent = trades;
          document.getElementById('statBreakers').textContent = (r.circuitBreakerActivations || []).length;
          document.getElementById('statDuration').textContent = r.durationMs ? r.durationMs + 'ms' : '—';
          addEvent('Loaded last round: ' + (r.roundId?.slice(0, 12) || '?'), 'info');
        }
      } catch { /* No previous round */ }
    })();
  </script>
</body>
</html>`;

  return c.html(page);
});

export const battleDashboardRoutes = app;
