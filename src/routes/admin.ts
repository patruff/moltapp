/**
 * Admin Dashboard Routes
 *
 * Provides a comprehensive admin UI for monitoring the MoltApp trading
 * platform. Displays real-time infrastructure status, audit logs, circuit
 * breaker states, rate limiter metrics, trade recovery queue, and agent
 * performance at a glance.
 *
 * Authentication: X-Admin-Password header must match ADMIN_PASSWORD env var.
 */

import { Hono } from "hono";
import { html } from "hono/html";
import { env } from "../config/env.ts";
import { getLockStatus } from "../services/trading-lock.ts";
import {
  getCircuitBreakerStatus,
  getRecentActivations,
} from "../services/circuit-breaker.ts";
import { getAllRateLimiterMetrics } from "../services/rate-limiter.ts";
import { getSearchCacheMetrics } from "../services/search-cache.ts";
import {
  queryAuditLog,
  getAuditLogStats,
  type AuditCategory,
  type AuditSeverity,
} from "../services/audit-log.ts";
import {
  getRecoveryReport,
  getDeadLetterQueue,
  getStuckTrades,
} from "../services/trade-recovery.ts";
import { getAgentConfigs, getTradingInfraStatus } from "../agents/orchestrator.ts";

const adminRoutes = new Hono();

// ---------------------------------------------------------------------------
// Admin Auth Middleware
// ---------------------------------------------------------------------------

adminRoutes.use("*", async (c, next) => {
  // Allow GET /admin page without auth (page itself requires password)
  // API calls require X-Admin-Password header
  const path = c.req.path;
  if (path === "/admin" || path === "/admin/") {
    return next();
  }

  const password = c.req.header("X-Admin-Password");
  if (!password || password !== env.ADMIN_PASSWORD) {
    return c.json({ error: "unauthorized", message: "Invalid admin password" }, 401);
  }

  return next();
});

// ---------------------------------------------------------------------------
// Admin Dashboard HTML Page
// ---------------------------------------------------------------------------

adminRoutes.get("/", (c) => {
  const pageHtml = html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MoltApp Admin Dashboard</title>
  <style>
    :root {
      --bg: #0a0a0f;
      --surface: #12121a;
      --surface2: #1a1a25;
      --border: #2a2a3a;
      --text: #e0e0e8;
      --text-dim: #888898;
      --accent: #6366f1;
      --green: #22c55e;
      --red: #ef4444;
      --yellow: #eab308;
      --orange: #f97316;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'SF Mono', 'Cascadia Mono', 'Fira Code', monospace;
      background: var(--bg);
      color: var(--text);
      font-size: 13px;
      line-height: 1.5;
    }
    .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 0;
      border-bottom: 1px solid var(--border);
      margin-bottom: 20px;
    }
    header h1 { font-size: 18px; color: var(--accent); font-weight: 600; }
    .status-badge {
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .status-ok { background: rgba(34,197,94,0.15); color: var(--green); }
    .status-warn { background: rgba(234,179,8,0.15); color: var(--yellow); }
    .status-error { background: rgba(239,68,68,0.15); color: var(--red); }
    .auth-gate {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 60vh;
      gap: 16px;
    }
    .auth-gate input {
      background: var(--surface2);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 10px 16px;
      border-radius: 6px;
      font-family: inherit;
      font-size: 14px;
      width: 300px;
    }
    .auth-gate button {
      background: var(--accent);
      color: white;
      border: none;
      padding: 10px 24px;
      border-radius: 6px;
      cursor: pointer;
      font-family: inherit;
      font-weight: 600;
    }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
    }
    .card h2 {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--text-dim);
      margin-bottom: 12px;
    }
    .metric { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--border); }
    .metric:last-child { border-bottom: none; }
    .metric-label { color: var(--text-dim); }
    .metric-value { font-weight: 600; }
    .metric-value.green { color: var(--green); }
    .metric-value.red { color: var(--red); }
    .metric-value.yellow { color: var(--yellow); }
    .metric-value.orange { color: var(--orange); }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); }
    th { color: var(--text-dim); font-size: 11px; text-transform: uppercase; }
    td { font-size: 12px; }
    .full-width { grid-column: 1 / -1; }
    .tab-bar { display: flex; gap: 8px; margin-bottom: 20px; }
    .tab {
      padding: 8px 16px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      cursor: pointer;
      color: var(--text-dim);
      font-family: inherit;
      font-size: 12px;
    }
    .tab.active { background: var(--accent); color: white; border-color: var(--accent); }
    .section { display: none; }
    .section.active { display: block; }
    #loading { text-align: center; padding: 40px; color: var(--text-dim); }
    .refresh-btn {
      background: var(--surface2);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 6px 14px;
      border-radius: 4px;
      cursor: pointer;
      font-family: inherit;
      font-size: 11px;
    }
    .log-entry { padding: 8px; border-bottom: 1px solid var(--border); font-size: 11px; }
    .log-entry .severity-info { color: var(--text-dim); }
    .log-entry .severity-warn { color: var(--yellow); }
    .log-entry .severity-error { color: var(--red); }
    .log-entry .severity-critical { color: var(--red); font-weight: 700; }
    .agent-row { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--border); }
    .agent-dot { width: 8px; height: 8px; border-radius: 50%; }
    .agent-dot.claude { background: #6366f1; }
    .agent-dot.gpt { background: #22c55e; }
    .agent-dot.grok { background: #f97316; }
    footer { margin-top: 40px; padding: 16px 0; border-top: 1px solid var(--border); color: var(--text-dim); text-align: center; font-size: 11px; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>MOLT // Admin Dashboard</h1>
      <div>
        <span id="server-status" class="status-badge status-ok">CONNECTING</span>
        <button class="refresh-btn" onclick="refreshAll()" style="margin-left:8px">Refresh</button>
      </div>
    </header>

    <div id="auth-gate" class="auth-gate">
      <h2 style="color:var(--text-dim)">Admin Authentication Required</h2>
      <input type="password" id="admin-password" placeholder="Admin password" onkeydown="if(event.key==='Enter')authenticate()">
      <button onclick="authenticate()">Authenticate</button>
      <div id="auth-error" style="color:var(--red);display:none">Invalid password</div>
    </div>

    <div id="dashboard" style="display:none">
      <div class="tab-bar">
        <button class="tab active" onclick="showTab('overview')">Overview</button>
        <button class="tab" onclick="showTab('agents')">Agents</button>
        <button class="tab" onclick="showTab('circuit-breakers')">Circuit Breakers</button>
        <button class="tab" onclick="showTab('audit')">Audit Log</button>
        <button class="tab" onclick="showTab('recovery')">Recovery</button>
      </div>

      <!-- Overview Tab -->
      <div id="tab-overview" class="section active">
        <div class="grid">
          <div class="card">
            <h2>Trading Lock</h2>
            <div id="lock-status"><div class="metric"><span class="metric-label">Loading...</span></div></div>
          </div>
          <div class="card">
            <h2>Rate Limiters</h2>
            <div id="rate-limiter-status"><div class="metric"><span class="metric-label">Loading...</span></div></div>
          </div>
          <div class="card">
            <h2>Search Cache</h2>
            <div id="cache-status"><div class="metric"><span class="metric-label">Loading...</span></div></div>
          </div>
          <div class="card">
            <h2>Audit Log Summary</h2>
            <div id="audit-summary"><div class="metric"><span class="metric-label">Loading...</span></div></div>
          </div>
          <div class="card">
            <h2>Recovery Queue</h2>
            <div id="recovery-summary"><div class="metric"><span class="metric-label">Loading...</span></div></div>
          </div>
          <div class="card">
            <h2>System Info</h2>
            <div id="system-info">
              <div class="metric"><span class="metric-label">Platform</span><span class="metric-value">MoltApp v1.0</span></div>
              <div class="metric"><span class="metric-label">Runtime</span><span class="metric-value">Node.js on Lambda</span></div>
              <div class="metric"><span class="metric-label">Region</span><span class="metric-value">us-east-1</span></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Agents Tab -->
      <div id="tab-agents" class="section">
        <div class="grid">
          <div class="card full-width">
            <h2>Registered AI Agents</h2>
            <div id="agents-list"><div class="metric"><span class="metric-label">Loading...</span></div></div>
          </div>
        </div>
      </div>

      <!-- Circuit Breakers Tab -->
      <div id="tab-circuit-breakers" class="section">
        <div class="grid">
          <div class="card full-width">
            <h2>Circuit Breaker Configuration</h2>
            <div id="cb-config"><div class="metric"><span class="metric-label">Loading...</span></div></div>
          </div>
          <div class="card full-width">
            <h2>Recent Activations</h2>
            <div id="cb-activations"><div class="metric"><span class="metric-label">Loading...</span></div></div>
          </div>
        </div>
      </div>

      <!-- Audit Log Tab -->
      <div id="tab-audit" class="section">
        <div class="card full-width">
          <h2>Audit Events (Last 50)</h2>
          <div id="audit-events"><div class="metric"><span class="metric-label">Loading...</span></div></div>
        </div>
      </div>

      <!-- Recovery Tab -->
      <div id="tab-recovery" class="section">
        <div class="grid">
          <div class="card full-width">
            <h2>Recovery Report</h2>
            <div id="recovery-detail"><div class="metric"><span class="metric-label">Loading...</span></div></div>
          </div>
          <div class="card">
            <h2>Stuck Trades</h2>
            <div id="stuck-trades"><div class="metric"><span class="metric-label">Loading...</span></div></div>
          </div>
          <div class="card">
            <h2>Dead Letter Queue</h2>
            <div id="dead-letter"><div class="metric"><span class="metric-label">Loading...</span></div></div>
          </div>
        </div>
      </div>
    </div>

    <footer>MoltApp Admin Dashboard &mdash; AI Trading Competition Platform &mdash; Colosseum Hackathon 2026</footer>
  </div>

  <script>
    let adminPwd = '';

    function authenticate() {
      adminPwd = document.getElementById('admin-password').value;
      fetchJSON('/admin/api/status').then(data => {
        document.getElementById('auth-gate').style.display = 'none';
        document.getElementById('dashboard').style.display = 'block';
        refreshAll();
      }).catch(() => {
        document.getElementById('auth-error').style.display = 'block';
      });
    }

    function fetchJSON(url) {
      return fetch(url, { headers: { 'X-Admin-Password': adminPwd } })
        .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
    }

    function showTab(name) {
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.getElementById('tab-' + name).classList.add('active');
      event.target.classList.add('active');
    }

    function metric(label, value, cls) {
      return '<div class="metric"><span class="metric-label">' + label + '</span><span class="metric-value ' + (cls||'') + '">' + value + '</span></div>';
    }

    async function refreshAll() {
      try {
        const [status, audit, recovery] = await Promise.all([
          fetchJSON('/admin/api/status'),
          fetchJSON('/admin/api/audit?limit=50'),
          fetchJSON('/admin/api/recovery'),
        ]);

        document.getElementById('server-status').textContent = 'CONNECTED';
        document.getElementById('server-status').className = 'status-badge status-ok';

        // Lock status
        const lock = status.lock;
        document.getElementById('lock-status').innerHTML =
          metric('Status', lock.isLocked ? 'LOCKED' : 'UNLOCKED', lock.isLocked ? 'red' : 'green') +
          (lock.lock ? metric('Holder', lock.lock.holderInfo) + metric('Acquired', new Date(lock.lock.acquiredAt).toLocaleTimeString()) : metric('Holder', 'None'));

        // Rate limiters
        const rl = status.rateLimiters;
        document.getElementById('rate-limiter-status').innerHTML = rl.map(r =>
          metric(r.name, r.currentTokens + '/' + r.maxTokens + ' tokens' + (r.rateLimitHits > 0 ? ' (' + r.rateLimitHits + ' hits)' : ''),
            r.rateLimitHits > 0 ? 'yellow' : 'green')
        ).join('');

        // Cache
        const cache = status.searchCache;
        document.getElementById('cache-status').innerHTML =
          metric('Hit Rate', cache.hitRate + '%', cache.hitRate > 50 ? 'green' : 'yellow') +
          metric('Cache Size', cache.size + ' entries') +
          metric('Total Lookups', String(cache.hits + cache.misses));

        // Audit summary
        const auditStats = status.auditStats;
        document.getElementById('audit-summary').innerHTML =
          metric('Total Events', String(auditStats.totalEvents)) +
          metric('Errors', String(auditStats.bySeverity.error), auditStats.bySeverity.error > 0 ? 'red' : 'green') +
          metric('Warnings', String(auditStats.bySeverity.warn), auditStats.bySeverity.warn > 0 ? 'yellow' : 'green') +
          metric('Critical', String(auditStats.bySeverity.critical), auditStats.bySeverity.critical > 0 ? 'red' : 'green');

        // Recovery summary
        const rec = recovery;
        document.getElementById('recovery-summary').innerHTML =
          metric('Total Failed', String(rec.totalFailed), rec.totalFailed > 0 ? 'yellow' : 'green') +
          metric('Pending Retry', String(rec.pendingRetry), rec.pendingRetry > 0 ? 'orange' : 'green') +
          metric('Dead Lettered', String(rec.deadLettered), rec.deadLettered > 0 ? 'red' : 'green') +
          metric('Recovered', String(rec.recovered), 'green') +
          metric('Stuck', String(rec.stuck), rec.stuck > 0 ? 'red' : 'green');

        // Agents
        const agents = status.agents;
        document.getElementById('agents-list').innerHTML = agents.map(a => {
          const dotClass = a.provider === 'anthropic' ? 'claude' : a.provider === 'openai' ? 'gpt' : 'grok';
          return '<div class="agent-row"><span class="agent-dot ' + dotClass + '"></span><strong>' + a.name + '</strong><span style="color:var(--text-dim)">' + a.model + ' &mdash; ' + a.tradingStyle + '</span></div>';
        }).join('');

        // Circuit breakers
        const cb = status.circuitBreaker;
        document.getElementById('cb-config').innerHTML =
          metric('Max Trade Size', '$' + cb.config.maxTradeUsdc + ' USDC') +
          metric('Daily Loss Limit', cb.config.dailyLossLimitPercent + '%') +
          metric('Cooldown', cb.config.cooldownSeconds + 's') +
          metric('Position Limit', cb.config.positionLimitPercent + '%') +
          metric('Max Daily Trades', String(cb.config.maxDailyTrades)) +
          metric('Total Activations', String(cb.totalActivations), cb.totalActivations > 0 ? 'yellow' : 'green');

        const cbActs = cb.recentActivations;
        document.getElementById('cb-activations').innerHTML = cbActs.length === 0 ? '<div style="color:var(--text-dim);padding:8px">No recent activations</div>' :
          '<table><tr><th>Time</th><th>Agent</th><th>Breaker</th><th>Action</th><th>Reason</th></tr>' +
          cbActs.map(a =>
            '<tr><td>' + new Date(a.timestamp).toLocaleTimeString() + '</td><td>' + a.agentId + '</td><td>' + a.breaker + '</td><td style="color:' + (a.action==='blocked' ? 'var(--red)' : 'var(--yellow)') + '">' + a.action.toUpperCase() + '</td><td style="font-size:11px">' + a.reason.slice(0,80) + '</td></tr>'
          ).join('') + '</table>';

        // Audit events
        const events = audit.events;
        document.getElementById('audit-events').innerHTML = events.length === 0 ? '<div style="color:var(--text-dim);padding:8px">No audit events</div>' :
          events.map(e =>
            '<div class="log-entry"><span class="severity-' + e.severity + '">[' + e.severity.toUpperCase() + ']</span> <span style="color:var(--text-dim)">' + new Date(e.timestamp).toLocaleTimeString() + '</span> <strong>' + e.action + '</strong> ' + e.description + (e.agentId ? ' <span style="color:var(--accent)">(' + e.agentId + ')</span>' : '') + '</div>'
          ).join('');

        // Recovery detail
        document.getElementById('recovery-detail').innerHTML =
          metric('Total Failed Trades', String(rec.totalFailed)) +
          metric('By Error Code', Object.entries(rec.byErrorCode).map(([k,v]) => k + ':' + v).join(', ') || 'None') +
          metric('By Agent', Object.entries(rec.byAgent).map(([k,v]) => k + ':' + v).join(', ') || 'None');

        // Stuck & dead letter
        document.getElementById('stuck-trades').innerHTML = rec.stuck === 0 ? '<div style="color:var(--green);padding:8px">No stuck trades</div>' :
          '<div style="color:var(--red);padding:8px">' + rec.stuck + ' stuck trade(s) need attention</div>';
        document.getElementById('dead-letter').innerHTML = rec.deadLettered === 0 ? '<div style="color:var(--green);padding:8px">Dead letter queue empty</div>' :
          '<div style="color:var(--red);padding:8px">' + rec.deadLettered + ' permanently failed trade(s)</div>';

      } catch (err) {
        document.getElementById('server-status').textContent = 'ERROR';
        document.getElementById('server-status').className = 'status-badge status-error';
      }
    }
  </script>
</body>
</html>`;

  return c.html(pageHtml);
});

// ---------------------------------------------------------------------------
// Admin API Endpoints
// ---------------------------------------------------------------------------

/** Comprehensive status endpoint — all infrastructure in one call */
adminRoutes.get("/api/status", (c) => {
  const lock = getLockStatus();
  const circuitBreaker = getCircuitBreakerStatus();
  const rateLimiters = getAllRateLimiterMetrics();
  const searchCache = getSearchCacheMetrics();
  const auditStats = getAuditLogStats();
  const agents = getAgentConfigs();

  return c.json({
    timestamp: new Date().toISOString(),
    lock,
    circuitBreaker,
    rateLimiters,
    searchCache,
    auditStats,
    agents,
  });
});

/** Audit log query endpoint */
adminRoutes.get("/api/audit", (c) => {
  const categoryParam = c.req.query("category");
  const severityParam = c.req.query("severity");
  const agentId = c.req.query("agentId");
  const action = c.req.query("action");
  const limit = parseInt(c.req.query("limit") ?? "50", 10);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);

  // Type-safe parsing of query params to AuditCategory and AuditSeverity
  const category = categoryParam as AuditCategory | undefined;
  const severity = severityParam as AuditSeverity | undefined;

  const result = queryAuditLog({
    category,
    severity,
    agentId: agentId ?? undefined,
    action: action ?? undefined,
    limit,
    offset,
  });

  return c.json(result);
});

/** Recovery report endpoint */
adminRoutes.get("/api/recovery", (c) => {
  const report = getRecoveryReport();
  return c.json(report);
});

/** Dead letter queue */
adminRoutes.get("/api/recovery/dead-letter", (c) => {
  return c.json({ trades: getDeadLetterQueue() });
});

/** Stuck trades */
adminRoutes.get("/api/recovery/stuck", (c) => {
  return c.json({ trades: getStuckTrades() });
});

/** Circuit breaker activations */
adminRoutes.get("/api/circuit-breaker/activations", (c) => {
  const limit = parseInt(c.req.query("limit") ?? "50", 10);
  return c.json({ activations: getRecentActivations(limit) });
});

export { adminRoutes };
