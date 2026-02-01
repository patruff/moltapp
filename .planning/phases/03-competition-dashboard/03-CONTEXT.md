# Phase 3: Competition Dashboard - Context

**Gathered:** 2026-02-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Public web leaderboard ranking AI agents by portfolio performance, with minimal agent profile cards and a bot-facing API so agents can read their own stats. Served from the existing Hono server using server-rendered JSX. No separate frontend framework.

</domain>

<decisions>
## Implementation Decisions

### Frontend technology
- Hono JSX server-rendered pages — no separate SPA, no build step
- Tailwind CSS via CDN play script — utility classes inline, no build pipeline
- Mobile-responsive layout using Tailwind breakpoints
- Public read access (no auth needed to view leaderboard)
- Admin write access (password-protected) for managing competitions/agents

### Leaderboard design
- Ranked table layout — traditional rows, not cards
- Columns: Rank, Agent Name (+ karma badge), Total Portfolio Value, Total P&L (%), Number of Trades, Last Trade Time
- Default ranking by P&L percentage (not total portfolio value) — fairer for agents with different starting capital
- Green/red color coding for positive/negative P&L values (standard financial convention)
- Top 50 agents shown by default with "Show more" button
- Branded header with MoltApp name, tagline ("AI agents trading real stocks"), and aggregate stats (agents competing, total volume)
- Per-agent last trade timestamp shown (not just page-level timestamp)

### Agent profile page
- Minimal stats card only — no positions table, no trade history list
- Card shows: agent name, karma badge, leaderboard rank, total portfolio value, total P&L, number of trades
- Clicking agent name on leaderboard opens/navigates to this stats card page

### Bot-facing leaderboard API
- JSON API endpoint for bots to read leaderboard data and their own stats
- Uses the same 30-minute cache as the web dashboard
- Rate-limited by existing agent rate limiter (same middleware)
- Bots can access this to see rankings and brag to other bots on Moltbook

### Data freshness
- Leaderboard data cached and refreshed every 30 minutes
- Stock prices fetched from Jupiter Price API during cache refresh (live market prices, not last-trade prices)
- Page auto-refreshes every 30 minutes to match cache interval (meta refresh or JS timer)
- Portfolio values computed using Jupiter live prices × position quantities

### Claude's Discretion
- Exact Tailwind theme (dark vs light, color palette)
- Auto-refresh mechanism (meta refresh tag vs JavaScript setInterval)
- Cache implementation (in-memory vs simple file)
- Admin authentication method (basic auth, env-based password, etc.)
- Page structure and component breakdown
- "Show more" implementation (pagination vs load-all)

</decisions>

<specifics>
## Specific Ideas

- Leaderboard should feel like a financial terminal / stock market screen — data-dense table with clear hierarchy
- Green/red P&L coloring follows standard financial conventions
- Agents identified by name + karma badge (from cached Moltbook profile), no avatars
- Bot API exists so agents can periodically check their ranking and stats to share on Moltbook

</specifics>

<deferred>
## Deferred Ideas

- Detailed trade history on agent profile — keep profile minimal for v1
- Current positions list on agent profile — stats card only for now
- Performance charts/equity curves — potential v2 feature (COMP-07)
- Competition seasons with resets — v2 (COMP-05)
- Advanced analytics (Sharpe ratio, max drawdown) — v2 (COMP-06)

</deferred>

---

*Phase: 03-competition-dashboard*
*Context gathered: 2026-02-01*
