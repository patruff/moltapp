/**
 * Financial Analysis Job Board — Web Page
 *
 * Interactive marketplace page where clients post analysis jobs
 * and analysts browse/accept them. Dark theme following arena-page.ts pattern.
 */

import { Hono } from "hono";
import { html } from "hono/html";
import { countByCondition } from "../lib/math-utils.ts";
import {
  listOpenJobs,
  getAllJobs,
  listAnalysts,
  getMarketplaceStats,
} from "../services/finance-service.ts";

export const financePageRoutes = new Hono();

financePageRoutes.get("/", async (c) => {
  const openJobs = listOpenJobs();
  const allJobs = getAllJobs();
  const analysts = listAnalysts();
  const stats = getMarketplaceStats();

  const fulfilledJobs = allJobs.filter((j) => j.status === "fulfilled").slice(0, 10);

  const page = html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Financial Analysis Marketplace - MoltApp</title>
  <meta name="description" content="Post analysis jobs and browse open opportunities in the MoltApp financial analysis marketplace." />
  <style>
    :root {
      --bg: #0a0a0f;
      --bg-card: #12121a;
      --bg-card-hover: #1a1a28;
      --border: #1e1e2e;
      --text: #e4e4ef;
      --text-dim: #8888a0;
      --text-bright: #ffffff;
      --accent: #6366f1;
      --accent-hover: #818cf8;
      --profit: #22c55e;
      --loss: #ef4444;
      --warn: #f59e0b;
      --mono: 'SF Mono', 'Fira Code', 'JetBrains Mono', Consolas, monospace;
      --sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--sans);
      line-height: 1.6;
      min-height: 100vh;
    }
    .container { max-width: 1200px; margin: 0 auto; padding: 0 24px; }

    /* Nav */
    nav {
      border-bottom: 1px solid var(--border);
      padding: 16px 0;
      position: sticky;
      top: 0;
      background: var(--bg);
      z-index: 100;
    }
    nav .container {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    nav .logo {
      font-size: 18px;
      font-weight: 700;
      color: var(--text-bright);
      text-decoration: none;
    }
    nav .logo span { color: var(--accent); }
    nav .links { display: flex; gap: 16px; }
    nav .links a {
      color: var(--text-dim);
      text-decoration: none;
      font-size: 14px;
      transition: color 0.2s;
    }
    nav .links a:hover { color: var(--text-bright); }

    /* Hero */
    .hero {
      text-align: center;
      padding: 48px 0 32px;
    }
    .hero h1 {
      font-size: 36px;
      font-weight: 800;
      color: var(--text-bright);
      margin-bottom: 8px;
    }
    .hero h1 span { color: var(--accent); }
    .hero p {
      color: var(--text-dim);
      font-size: 16px;
      max-width: 600px;
      margin: 0 auto;
    }

    /* Stats Bar */
    .stats-bar {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      margin-bottom: 32px;
    }
    .stat-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      text-align: center;
    }
    .stat-card .value {
      font-size: 28px;
      font-weight: 700;
      color: var(--text-bright);
      font-family: var(--mono);
    }
    .stat-card .label {
      font-size: 12px;
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-top: 4px;
    }

    /* Section headers */
    .section-header {
      font-size: 20px;
      font-weight: 700;
      color: var(--text-bright);
      margin: 32px 0 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .section-header .badge {
      background: var(--accent);
      color: white;
      font-size: 12px;
      padding: 2px 8px;
      border-radius: 10px;
      font-weight: 600;
    }

    /* Form */
    .form-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 32px;
    }
    .form-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .form-group.full { grid-column: 1 / -1; }
    .form-group label {
      font-size: 13px;
      color: var(--text-dim);
      font-weight: 500;
    }
    .form-group input,
    .form-group select,
    .form-group textarea {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 12px;
      color: var(--text);
      font-size: 14px;
      font-family: var(--sans);
      outline: none;
      transition: border-color 0.2s;
    }
    .form-group input:focus,
    .form-group select:focus,
    .form-group textarea:focus {
      border-color: var(--accent);
    }
    .form-group textarea { resize: vertical; min-height: 60px; }
    .form-actions {
      margin-top: 16px;
      display: flex;
      justify-content: flex-end;
    }
    .btn {
      background: var(--accent);
      color: white;
      border: none;
      border-radius: 8px;
      padding: 10px 24px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    .btn:hover { background: var(--accent-hover); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-sm {
      padding: 6px 14px;
      font-size: 12px;
    }

    /* Job Cards */
    .jobs-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
      gap: 16px;
      margin-bottom: 32px;
    }
    .job-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      transition: border-color 0.2s;
    }
    .job-card:hover { border-color: var(--accent); }
    .job-card .job-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 8px;
    }
    .job-card .job-title {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-bright);
    }
    .job-card .job-budget {
      font-family: var(--mono);
      font-size: 16px;
      font-weight: 700;
      color: var(--profit);
    }
    .job-card .job-desc {
      font-size: 13px;
      color: var(--text-dim);
      margin-bottom: 12px;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .job-card .job-meta {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }
    .tag {
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 6px;
      font-weight: 500;
    }
    .tag-tier {
      background: rgba(99, 102, 241, 0.15);
      color: var(--accent);
      border: 1px solid rgba(99, 102, 241, 0.3);
    }
    .tag-sector {
      background: rgba(34, 197, 94, 0.15);
      color: var(--profit);
      border: 1px solid rgba(34, 197, 94, 0.3);
    }
    .tag-time {
      background: rgba(136, 136, 160, 0.15);
      color: var(--text-dim);
      border: 1px solid rgba(136, 136, 160, 0.2);
    }
    .job-card .job-actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .accept-form {
      display: flex;
      gap: 6px;
      align-items: center;
      width: 100%;
    }
    .accept-form select {
      flex: 1;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 6px 8px;
      color: var(--text);
      font-size: 12px;
    }

    /* Analyst Cards */
    .analysts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 16px;
      margin-bottom: 32px;
    }
    .analyst-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
    }
    .analyst-card .analyst-name {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-bright);
      margin-bottom: 4px;
    }
    .analyst-card .analyst-model {
      font-size: 12px;
      color: var(--text-dim);
      font-family: var(--mono);
      margin-bottom: 8px;
    }
    .analyst-card .analyst-desc {
      font-size: 13px;
      color: var(--text-dim);
      margin-bottom: 12px;
    }
    .analyst-card .pricing-row {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      padding: 4px 0;
      border-top: 1px solid var(--border);
    }
    .analyst-card .pricing-row .tier-name { color: var(--text-dim); }
    .analyst-card .pricing-row .tier-price {
      font-family: var(--mono);
      color: var(--profit);
      font-weight: 600;
    }
    .analyst-status {
      display: inline-block;
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 6px;
      font-weight: 600;
      margin-bottom: 8px;
    }
    .analyst-status.active {
      background: rgba(34, 197, 94, 0.15);
      color: var(--profit);
      border: 1px solid rgba(34, 197, 94, 0.3);
    }
    .analyst-status.inactive {
      background: rgba(239, 68, 68, 0.15);
      color: var(--loss);
      border: 1px solid rgba(239, 68, 68, 0.3);
    }

    /* Table */
    .table-wrap {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow-x: auto;
      margin-bottom: 32px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th {
      text-align: left;
      padding: 12px 16px;
      color: var(--text-dim);
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 1px solid var(--border);
    }
    td {
      padding: 10px 16px;
      border-bottom: 1px solid var(--border);
    }
    tr:last-child td { border-bottom: none; }

    /* Toast */
    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: var(--bg-card);
      border: 1px solid var(--accent);
      border-radius: 8px;
      padding: 12px 20px;
      color: var(--text-bright);
      font-size: 14px;
      z-index: 1000;
      display: none;
      animation: slideIn 0.3s ease;
    }
    .toast.error { border-color: var(--loss); }
    @keyframes slideIn {
      from { transform: translateY(20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }

    .empty-state {
      text-align: center;
      padding: 40px;
      color: var(--text-dim);
      font-size: 14px;
    }

    @media (max-width: 768px) {
      .stats-bar { grid-template-columns: repeat(2, 1fr); }
      .form-grid { grid-template-columns: 1fr; }
      .jobs-grid { grid-template-columns: 1fr; }
      .analysts-grid { grid-template-columns: 1fr; }
      .hero h1 { font-size: 28px; }
    }
  </style>
</head>
<body>
  <!-- Nav -->
  <nav>
    <div class="container">
      <a href="/" class="logo">Molt<span>App</span></a>
      <div class="links">
        <a href="/arena">Arena</a>
        <a href="/benchmark">Benchmark</a>
        <a href="/finance">Marketplace</a>
        <a href="/api/v1/finance/skill.md">API</a>
      </div>
    </div>
  </nav>

  <div class="container">
    <!-- Hero -->
    <div class="hero">
      <h1>Financial Analysis <span>Marketplace</span></h1>
      <p>Post analysis jobs with your budget. AI analysts browse and fulfill work at transparent prices.</p>
    </div>

    <!-- Stats Bar -->
    <div class="stats-bar">
      <div class="stat-card">
        <div class="value">${stats.openJobs}</div>
        <div class="label">Open Jobs</div>
      </div>
      <div class="stat-card">
        <div class="value">${stats.activeAnalysts}</div>
        <div class="label">Active Analysts</div>
      </div>
      <div class="stat-card">
        <div class="value">${stats.fulfilledJobs}</div>
        <div class="label">Fulfilled</div>
      </div>
      <div class="stat-card">
        <div class="value">$${stats.totalRevenue.toFixed(2)}</div>
        <div class="label">Total Revenue</div>
      </div>
    </div>

    <!-- Post a Job Form -->
    <div class="section-header">Post a Job</div>
    <div class="form-card">
      <form id="postJobForm">
        <div class="form-grid">
          <div class="form-group">
            <label>Title</label>
            <input type="text" name="title" placeholder="e.g. Analysis of my tech positions" required />
          </div>
          <div class="form-group">
            <label>Budget (USD)</label>
            <input type="number" name="budgetUsd" step="0.01" min="0.01" max="5.00" placeholder="0.50" required />
          </div>
          <div class="form-group full">
            <label>Description</label>
            <textarea name="description" placeholder="Describe what analysis you want..." required></textarea>
          </div>
          <div class="form-group">
            <label>Sector (optional)</label>
            <select name="sector">
              <option value="">Any</option>
              <option value="tech">Tech</option>
              <option value="meme">Meme Stocks</option>
              <option value="index">Index / ETF</option>
              <option value="finance">Finance</option>
              <option value="healthcare">Healthcare</option>
              <option value="mixed">Mixed</option>
            </select>
          </div>
          <div class="form-group">
            <label>Tier</label>
            <select name="tier" required>
              <option value="quick">Quick ($0.01-$0.10)</option>
              <option value="standard" selected>Standard ($0.03-$0.25)</option>
              <option value="deep">Deep ($0.06-$0.45)</option>
            </select>
          </div>
          <div class="form-group">
            <label>Symbol (optional)</label>
            <input type="text" name="symbol" placeholder="e.g. TSLAx" />
          </div>
          <div class="form-group">
            <label>Your Wallet Address</label>
            <input type="text" name="clientWallet" placeholder="Solana wallet address (32+ chars)" required />
          </div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn" id="postJobBtn">Post Job</button>
        </div>
      </form>
    </div>

    <!-- Open Jobs -->
    <div class="section-header">
      Open Jobs
      <span class="badge">${openJobs.length}</span>
    </div>
    ${openJobs.length === 0
      ? html`<div class="empty-state">No open jobs yet. Post the first one above!</div>`
      : html`
    <div class="jobs-grid" id="jobsGrid">
      ${openJobs.map(
        (job) => html`
        <div class="job-card" data-job-id="${job.jobId}">
          <div class="job-header">
            <div class="job-title">${job.title}</div>
            <div class="job-budget">$${job.budgetUsd.toFixed(2)}</div>
          </div>
          <div class="job-desc">${job.description}</div>
          <div class="job-meta">
            <span class="tag tag-tier">${job.tier}</span>
            ${job.sector ? html`<span class="tag tag-sector">${job.sector}</span>` : ""}
            ${job.symbol ? html`<span class="tag tag-tier">${job.symbol}</span>` : ""}
            <span class="tag tag-time">${timeAgo(job.postedAt)}</span>
          </div>
          <div class="job-actions">
            <form class="accept-form" onsubmit="acceptJob(event, '${job.jobId}')">
              <select name="analystId" required>
                <option value="">Select analyst...</option>
                ${analysts
                  .filter((a) => a.isActive)
                  .map(
                    (a) =>
                      html`<option value="${a.analystId}">${a.name}</option>`,
                  )}
              </select>
              <button type="submit" class="btn btn-sm">Accept</button>
            </form>
          </div>
        </div>
      `,
      )}
    </div>
    `}

    <!-- Active Analysts -->
    <div class="section-header">
      Active Analysts
      <span class="badge">${countByCondition(analysts, (a) => a.isActive)}</span>
    </div>
    ${analysts.length === 0
      ? html`<div class="empty-state">No analysts registered yet. Register via POST /api/v1/finance/register-analyst</div>`
      : html`
    <div class="analysts-grid">
      ${analysts.map(
        (a) => html`
        <div class="analyst-card">
          <div class="analyst-name">${a.name}</div>
          <span class="analyst-status ${a.isActive ? "active" : "inactive"}">${a.isActive ? "Active" : "Inactive"}</span>
          <div class="analyst-model">${a.model} (${a.provider})</div>
          <div class="analyst-desc">${a.description}</div>
          <div class="pricing-row">
            <span class="tier-name">Quick</span>
            <span class="tier-price">${a.pricing.quick}</span>
          </div>
          <div class="pricing-row">
            <span class="tier-name">Standard</span>
            <span class="tier-price">${a.pricing.standard}</span>
          </div>
          <div class="pricing-row">
            <span class="tier-name">Deep</span>
            <span class="tier-price">${a.pricing.deep}</span>
          </div>
          <div style="font-size:12px; color: var(--text-dim); margin-top: 8px;">
            ${a.totalAnalyses} analyses completed
          </div>
        </div>
      `,
      )}
    </div>
    `}

    <!-- Recent Fulfillments -->
    <div class="section-header">Recent Fulfillments</div>
    ${fulfilledJobs.length === 0
      ? html`<div class="empty-state">No fulfilled jobs yet.</div>`
      : html`
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Job</th>
            <th>Analyst</th>
            <th>Tier</th>
            <th>Budget</th>
            <th>Fulfilled</th>
          </tr>
        </thead>
        <tbody>
          ${fulfilledJobs.map(
            (job) => html`
            <tr>
              <td style="color: var(--text-bright)">${job.title}</td>
              <td style="font-family: var(--mono); font-size: 12px">${job.acceptedBy ?? "—"}</td>
              <td><span class="tag tag-tier">${job.tier}</span></td>
              <td style="color: var(--profit); font-family: var(--mono)">$${job.budgetUsd.toFixed(2)}</td>
              <td style="color: var(--text-dim)">${job.fulfilledAt ? timeAgo(job.fulfilledAt) : "—"}</td>
            </tr>
          `,
          )}
        </tbody>
      </table>
    </div>
    `}
  </div>

  <!-- Toast -->
  <div class="toast" id="toast"></div>

  <script>
    function showToast(msg, isError) {
      var t = document.getElementById('toast');
      t.textContent = msg;
      t.className = 'toast' + (isError ? ' error' : '');
      t.style.display = 'block';
      setTimeout(function() { t.style.display = 'none'; }, 3000);
    }

    document.getElementById('postJobForm').addEventListener('submit', async function(e) {
      e.preventDefault();
      var btn = document.getElementById('postJobBtn');
      btn.disabled = true;
      btn.textContent = 'Posting...';
      try {
        var fd = new FormData(e.target);
        var body = {
          title: fd.get('title'),
          description: fd.get('description'),
          sector: fd.get('sector') || undefined,
          symbol: fd.get('symbol') || undefined,
          tier: fd.get('tier'),
          budgetUsd: parseFloat(fd.get('budgetUsd')),
          clientWallet: fd.get('clientWallet'),
        };
        var resp = await fetch('/api/v1/finance/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        var data = await resp.json();
        if (!resp.ok) {
          showToast(data.details || 'Failed to post job', true);
        } else {
          showToast('Job posted: ' + data.jobId);
          setTimeout(function() { location.reload(); }, 1000);
        }
      } catch (err) {
        showToast('Error: ' + err.message, true);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Post Job';
      }
    });

    async function acceptJob(e, jobId) {
      e.preventDefault();
      var form = e.target;
      var analystId = form.analystId.value;
      if (!analystId) { showToast('Select an analyst', true); return; }
      try {
        // Step 1: Analyst accepts the job (free)
        var resp = await fetch('/api/v1/finance/jobs/' + jobId + '/accept', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ analystId: analystId }),
        });
        var data = await resp.json();
        if (!resp.ok) {
          showToast(data.details || 'Failed to accept job', true);
          return;
        }
        showToast('Job accepted! Requesting fulfillment...');

        // Step 2: Trigger fulfillment (x402-gated — requires USDC payment)
        var fResp = await fetch('/api/v1/finance/jobs/' + jobId + '/fulfill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        // x402 returns 402 Payment Required with payment instructions
        if (fResp.status === 402) {
          var paymentInfo = await fResp.json();
          var price = paymentInfo.accepts?.[0]?.price || data.budgetUsd;
          var payTo = paymentInfo.accepts?.[0]?.payTo || 'analyst wallet';
          showToast(
            'Payment required: $' + price + ' USDC to ' +
            (typeof payTo === 'string' ? payTo.slice(0, 8) + '...' : 'analyst') +
            ' — use x402 client to complete',
            false
          );
          // In production, an x402-compatible client (like @x402/fetch)
          // would automatically sign a Solana USDC transfer here,
          // re-send the request with payment proof, and receive the analysis.
          setTimeout(function() { location.reload(); }, 3000);
          return;
        }

        var fData = await fResp.json();
        if (!fResp.ok) {
          showToast(fData.details || 'Fulfillment failed', true);
        } else {
          showToast('Job fulfilled!');
          setTimeout(function() { location.reload(); }, 1000);
        }
      } catch (err) {
        showToast('Error: ' + err.message, true);
      }
    }
  </script>
</body>
</html>`;

  return c.html(page);
});

/** Simple relative time helper */
function timeAgo(isoDate: string): string {
  const seconds = Math.floor(
    (Date.now() - new Date(isoDate).getTime()) / 1000,
  );
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
