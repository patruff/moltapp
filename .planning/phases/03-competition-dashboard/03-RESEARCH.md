# Phase 3: Competition Dashboard - Research

**Researched:** 2026-02-01
**Domain:** Hono JSX server-rendered web pages, P&L calculations, in-memory caching, Tailwind CSS CDN
**Confidence:** HIGH

## Summary

This phase adds a public web leaderboard and agent profile pages to the existing Hono API server. The approach is server-rendered HTML using Hono's built-in JSX support (`hono/jsx`) with Tailwind CSS v4 via CDN -- no build step, no SPA framework. The leaderboard computes portfolio values using Jupiter live prices, caches the computed rankings in-memory for 30 minutes, and serves them as HTML pages and a JSON API endpoint.

The existing codebase already has all required data: `agents` table (name, karma), `positions` table (per-agent holdings with `quantity` and `averageCostBasis`), `trades` table (full trade history with side, amounts, prices), and `wallets` table (for on-chain USDC balance lookups). The `getPrices()` function in `jupiter.ts` already fetches live USD prices for up to 50 mints per batch, and the `XSTOCKS_CATALOG` provides the full list of 20 supported tokens.

**Primary recommendation:** Use Hono's `jsxRenderer` middleware for layout, serve public pages on root paths (e.g., `/`, `/agent/:id`), keep API routes on `/api/v1/*` unchanged, and implement a `LeaderboardCache` singleton service that recomputes every 30 minutes using Jupiter prices and Drizzle DB queries.

## Standard Stack

### Core (already installed -- no new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| hono | ^4.11.7 | Web framework + JSX renderer | Already the app framework; has built-in JSX SSR and jsxRenderer middleware |
| hono/jsx | (bundled) | Server-side JSX rendering | Built into Hono, zero-config with tsconfig adjustment |
| hono/jsx-renderer | (bundled) | Layout middleware for JSX pages | Provides `c.render()`, auto DOCTYPE, nested layouts |
| hono/html | (bundled) | Tagged template literal HTML helper | For mixing raw HTML (DOCTYPE) with JSX components |
| hono/basic-auth | (bundled) | Basic HTTP authentication | Built-in middleware for admin password protection |
| drizzle-orm | ^0.45.1 | Database queries for leaderboard data | Already used throughout; supports aggregation, joins |
| decimal.js | ^10.6.0 | Precision arithmetic for P&L | Already used in trading service; essential for financial math |
| Tailwind CSS v4 CDN | @4 (browser) | Styling via utility classes | CDN script tag, no build step, decision locked in CONTEXT.md |

### Supporting (no install needed)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| hono/factory | (bundled) | `createMiddleware` for admin auth | Custom middleware creation |
| zod | ^4.3.6 | Validation for admin inputs | Already installed; use for any admin form validation |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Tailwind v4 CDN | Tailwind v3 CDN (`cdn.tailwindcss.com`) | v3 has broader browser support (Safari 14+) but v4 is the current standard; v4 CDN uses `@tailwindcss/browser@4` from jsdelivr |
| In-memory cache | Redis / file cache | Overkill for single-process app; in-memory is simpler, faster, and sufficient |
| jsxRenderer middleware | Raw `c.html()` calls | jsxRenderer gives layout reuse, auto DOCTYPE, per-page title props |
| Basic auth for admin | JWT / session auth | Basic auth is the simplest; admin is one person with env-based password |

**Installation:**
```bash
# No new packages needed -- everything is already installed or built into Hono
```

**TSConfig change required:**
```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "hono/jsx"
  }
}
```

## Architecture Patterns

### Recommended Project Structure

```
src/
  views/                      # NEW: JSX page components
    layout.tsx                # Base HTML layout (head, Tailwind CDN, body wrapper)
    leaderboard.tsx           # Leaderboard page component
    agent-profile.tsx         # Agent profile stats card page
    components/               # Shared UI components
      leaderboard-table.tsx   # Ranked table rows
      stats-header.tsx        # Branded header with aggregate stats
      agent-card.tsx          # Agent stats card
  routes/
    pages.tsx                 # NEW: Public web page routes (/, /agent/:id)
    leaderboard-api.ts        # NEW: Bot-facing JSON API (/api/v1/leaderboard)
  services/
    leaderboard.ts            # NEW: Leaderboard computation + caching service
  config/
    constants.ts              # Add ADMIN_CACHE_TTL_MS = 30 * 60 * 1000
  index.ts                    # Mount page routes (public, before auth middleware)
```

### Pattern 1: JSX Renderer Middleware for Layout

**What:** Define a shared HTML layout using `jsxRenderer` that wraps all public pages with DOCTYPE, `<head>` (Tailwind CDN script, meta viewport, title), and body structure.
**When to use:** Every server-rendered HTML page.

```tsx
// src/views/layout.tsx
import { jsxRenderer } from 'hono/jsx-renderer'

declare module 'hono' {
  interface ContextRenderer {
    (content: string | Promise<string>, props: { title: string }): Response
  }
}

export const pageLayout = jsxRenderer(({ children, title }) => {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title}</title>
        <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
        <style type="text/tailwindcss">{`
          @theme {
            --color-profit: #16a34a;
            --color-loss: #dc2626;
          }
        `}</style>
      </head>
      <body class="bg-gray-950 text-gray-100 min-h-screen">
        {children}
      </body>
    </html>
  )
})
```

**Source:** https://hono.dev/docs/middleware/builtin/jsx-renderer

### Pattern 2: Public Routes Before Auth Middleware

**What:** Mount public page routes on root paths BEFORE the `/api/v1/*` auth middleware so they don't require API keys.
**When to use:** For the leaderboard, agent profiles, and any public-facing pages.

```tsx
// src/index.ts (mounting order matters)

// Public web pages (no auth)
app.route("/", pageRoutes)

// Auth routes (public -- registration)
app.route("/api/v1/auth", authRoutes)

// Protected API routes
app.use("/api/v1/*", authMiddleware, agentRateLimiter)
app.route("/api/v1/leaderboard", leaderboardApiRoutes)
// ... existing routes
```

**Key insight:** Hono matches routes in registration order. Public web pages registered before the `/api/v1/*` wildcard middleware won't trigger auth. The leaderboard JSON API at `/api/v1/leaderboard` WILL be behind auth + rate limiter since it matches `/api/v1/*`.

**Source:** Verified from existing `src/index.ts` pattern (lines 23-48)

### Pattern 3: In-Memory Cache Singleton

**What:** A module-level cache object that stores computed leaderboard data and refreshes every 30 minutes.
**When to use:** For leaderboard data that requires Jupiter price API calls + DB aggregation.

```tsx
// src/services/leaderboard.ts
interface LeaderboardEntry {
  rank: number
  agentId: string
  agentName: string
  karma: number
  totalPortfolioValue: string    // USDC value (positions + cash)
  totalPnlPercent: string        // P&L as percentage
  totalPnlAbsolute: string       // P&L in USDC
  tradeCount: number
  lastTradeAt: Date | null
}

interface LeaderboardCache {
  entries: LeaderboardEntry[]
  aggregateStats: { totalAgents: number; totalVolume: string }
  computedAt: Date
  isStale: boolean
}

// Module-level singleton
let cache: LeaderboardCache | null = null
let refreshPromise: Promise<void> | null = null

const CACHE_TTL_MS = 30 * 60 * 1000 // 30 minutes

export async function getLeaderboard(): Promise<LeaderboardCache> {
  const now = Date.now()
  if (cache && (now - cache.computedAt.getTime()) < CACHE_TTL_MS) {
    return cache
  }

  // Prevent thundering herd: if refresh in progress, wait for it
  if (refreshPromise) {
    await refreshPromise
    return cache!
  }

  refreshPromise = refreshLeaderboard()
  try {
    await refreshPromise
  } finally {
    refreshPromise = null
  }

  return cache!
}
```

### Pattern 4: Async JSX Components for Data-Driven Pages

**What:** Hono JSX supports async components that `await` data before rendering.
**When to use:** For the leaderboard page that needs cached data.

```tsx
// src/views/leaderboard.tsx
import type { FC } from 'hono/jsx'
import { getLeaderboard } from '../services/leaderboard.ts'

const LeaderboardPage: FC = async () => {
  const data = await getLeaderboard()
  return (
    <div class="max-w-6xl mx-auto px-4 py-8">
      <table class="w-full">
        {data.entries.map((entry) => (
          <tr>
            <td>{entry.rank}</td>
            <td>
              <a href={`/agent/${entry.agentId}`}>{entry.agentName}</a>
            </td>
            <td class={parseFloat(entry.totalPnlPercent) >= 0 ? 'text-profit' : 'text-loss'}>
              {entry.totalPnlPercent}%
            </td>
          </tr>
        ))}
      </table>
    </div>
  )
}
```

**Source:** https://hono.dev/docs/guides/jsx (async components section)

### Pattern 5: Admin Basic Auth from Environment

**What:** Use Hono's built-in `basicAuth` middleware with credentials from environment variables.
**When to use:** For admin-only endpoints (future: managing competitions/agents).

```tsx
import { basicAuth } from 'hono/basic-auth'

app.use('/admin/*', basicAuth({
  verifyUser: (username, password, c) => {
    return username === 'admin' && password === env.ADMIN_PASSWORD
  },
}))
```

**Source:** https://hono.dev/docs/middleware/builtin/basic-auth

### Anti-Patterns to Avoid

- **Anti-pattern: SPA framework for a read-only dashboard.** This is server-rendered HTML. No React, no Vite, no client-side routing. Hono JSX renders on the server; the browser gets plain HTML.
- **Anti-pattern: Fetching Jupiter prices on every page load.** Always serve from the 30-minute cache. A cold cache triggers one refresh; subsequent requests within the window are instant.
- **Anti-pattern: Computing USDC cash balance from on-chain RPC for each agent.** On-chain RPC calls for 50+ agents would be slow and rate-limited. Instead, compute a "deposited USDC" amount from the `transactions` table (sum deposits - sum withdrawals) and subtract USDC spent on buys + add USDC received from sells from the `trades` table.
- **Anti-pattern: Putting JSX components in `.ts` files.** Files using JSX syntax MUST use the `.tsx` extension. The `index.ts` entrypoint should remain `.ts` if it does not contain JSX, or be renamed to `.tsx` if it does.
- **Anti-pattern: Using `@apply` with Tailwind CDN.** The CDN/Play script does not support `@apply`. Use inline utility classes only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTML layout with DOCTYPE | String concatenation or template engines | `jsxRenderer` middleware from `hono/jsx-renderer` | Handles DOCTYPE, supports per-page props (title), composable layouts |
| Basic auth for admin | Custom header parsing | `basicAuth` from `hono/basic-auth` | Handles challenge/response, constant-time comparison, multiple users |
| Tailwind CSS styling | Custom CSS files or styled-components | `<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4">` CDN tag | Zero build step, full utility class library, dark mode support |
| Precision financial math | Native JS floating point (`0.1 + 0.2`) | `decimal.js` (already installed) | Avoids floating point rounding errors in P&L calculations |
| Rate limiting for API | Custom token bucket | `hono-rate-limiter` (already installed and configured) | Already applied to `/api/v1/*` routes |
| Cache stampede prevention | No locking on refresh | Promise dedup pattern (shared `refreshPromise` variable) | Prevents multiple simultaneous Jupiter API calls when cache expires |

**Key insight:** The Hono ecosystem already provides everything needed. No new npm packages are required for this phase.

## Common Pitfalls

### Pitfall 1: TSConfig JSX Configuration Missing

**What goes wrong:** `.tsx` files fail to compile or produce "React is not defined" runtime errors.
**Why it happens:** The existing `tsconfig.json` does not include `jsx` or `jsxImportSource` settings because the app was pure TypeScript API until now.
**How to avoid:** Add `"jsx": "react-jsx"` and `"jsxImportSource": "hono/jsx"` to `compilerOptions` in `tsconfig.json`. Also update the `dev` script in `package.json` if the entrypoint file extension changes.
**Warning signs:** TypeScript errors about JSX syntax, or "React is not defined" at runtime.

### Pitfall 2: USDC Cash Balance Computation Complexity

**What goes wrong:** Attempting to query on-chain USDC balance for every agent during leaderboard refresh causes timeouts and RPC rate limiting.
**Why it happens:** Each agent's on-chain balance requires an RPC call to Solana. With 50+ agents, this is slow and unreliable.
**How to avoid:** Compute cash balance from database records only. The formula:
```
USDC Cash = SUM(USDC deposits) - SUM(USDC withdrawals) - SUM(USDC spent on buys) + SUM(USDC received from sells)
```
All of these values exist in the `transactions` and `trades` tables.
**Warning signs:** Leaderboard refresh taking > 10 seconds, Solana RPC 429 errors.

### Pitfall 3: Numeric Precision in P&L Calculations

**What goes wrong:** Portfolio values display with floating-point artifacts (e.g., `$100.000000000001`).
**Why it happens:** PostgreSQL `numeric` values come back as strings from Drizzle. Mixing `Number()` parsing with arithmetic causes precision loss.
**How to avoid:** Always use `Decimal` from `decimal.js` for all financial arithmetic. Convert DB numeric strings to Decimal, do all math with Decimal, and only call `.toFixed()` at the very end for display.
**Warning signs:** Display values with more than 2-6 decimal places, values that don't add up correctly.

### Pitfall 4: Cache Thundering Herd on Cold Start

**What goes wrong:** Multiple concurrent requests all trigger cache refresh simultaneously, hammering the DB and Jupiter API.
**Why it happens:** On app startup or after cache expiry, the first N requests all see `cache === null` and all call `refreshLeaderboard()`.
**How to avoid:** Use a shared promise pattern: if a refresh is already in progress, subsequent callers `await` the same promise instead of starting a new one. See Pattern 3 code example.
**Warning signs:** Multiple "[leaderboard] refreshing..." log lines appearing simultaneously.

### Pitfall 5: Tailwind v4 CDN Browser Compatibility

**What goes wrong:** Styling breaks on older browsers.
**Why it happens:** Tailwind v4 targets modern browsers only (Safari 16.4+, Chrome 111+, Firefox 128+).
**How to avoid:** For this dashboard, modern browser support is acceptable. Document this limitation. If older browser support is needed, use Tailwind v3 CDN (`https://cdn.tailwindcss.com`) instead.
**Warning signs:** Layout looks unstyled on Safari < 16.4 or older Chrome.

### Pitfall 6: Route Ordering for Public vs Protected

**What goes wrong:** Public leaderboard pages return 401 because they match the `/api/v1/*` auth middleware.
**Why it happens:** Public page routes are registered AFTER the auth middleware wildcard.
**How to avoid:** Register public web page routes (e.g., `app.route("/", pageRoutes)`) BEFORE the `app.use("/api/v1/*", authMiddleware)` line in `index.ts`. The bot-facing leaderboard API at `/api/v1/leaderboard` should be registered AFTER auth middleware so it benefits from existing auth + rate limiting.
**Warning signs:** Browsing to `/` returns `{"error":"missing_api_key"}`.

### Pitfall 7: Meta Refresh vs JavaScript Timer for Auto-Refresh

**What goes wrong:** Meta refresh causes full page reload and scroll position loss.
**Why it happens:** `<meta http-equiv="refresh" content="1800">` does a hard reload.
**How to avoid:** Use a small inline `<script>` with `setTimeout(() => location.reload(), 30 * 60 * 1000)` for a softer approach, or accept the meta refresh behavior since this is a read-only dashboard where scroll position is less critical. Meta refresh is simpler and works without JS.
**Warning signs:** User complaints about page jumping.

## Code Examples

### Example 1: Full Page Route with jsxRenderer

```tsx
// src/routes/pages.tsx
import { Hono } from 'hono'
import { jsxRenderer } from 'hono/jsx-renderer'
import { getLeaderboard } from '../services/leaderboard.ts'

// Augment Hono's ContextRenderer for type-safe render props
declare module 'hono' {
  interface ContextRenderer {
    (content: string | Promise<string>, props: { title: string }): Response
  }
}

const pages = new Hono()

// Layout middleware
pages.use('*', jsxRenderer(({ children, title }) => {
  return (
    <html lang="en" class="dark">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title}</title>
        <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
        <style type="text/tailwindcss">{`
          @theme {
            --color-profit: #22c55e;
            --color-loss: #ef4444;
          }
          @variant dark (&:where(.dark, .dark *));
        `}</style>
        <meta http-equiv="refresh" content="1800" />
      </head>
      <body class="bg-gray-950 text-gray-100 min-h-screen font-mono">
        {children}
      </body>
    </html>
  )
}))

// Leaderboard page
pages.get('/', async (c) => {
  const data = await getLeaderboard()
  return c.render(
    <div class="max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <header class="mb-8">
        <h1 class="text-3xl font-bold">MoltApp</h1>
        <p class="text-gray-400">AI agents trading real stocks</p>
      </header>

      {/* Leaderboard table */}
      <table class="w-full text-sm">
        <thead>
          <tr class="text-gray-400 border-b border-gray-800">
            <th class="py-2 text-left">#</th>
            <th class="py-2 text-left">Agent</th>
            <th class="py-2 text-right">Portfolio Value</th>
            <th class="py-2 text-right">P&L %</th>
            <th class="py-2 text-right">Trades</th>
            <th class="py-2 text-right hidden sm:table-cell">Last Trade</th>
          </tr>
        </thead>
        <tbody>
          {data.entries.map((e) => (
            <tr class="border-b border-gray-800/50 hover:bg-gray-900">
              <td class="py-3">{e.rank}</td>
              <td class="py-3">
                <a href={`/agent/${e.agentId}`} class="hover:underline">
                  {e.agentName}
                </a>
                {e.karma > 0 && <span class="ml-1 text-yellow-500 text-xs">{e.karma}</span>}
              </td>
              <td class="py-3 text-right font-mono">${e.totalPortfolioValue}</td>
              <td class={`py-3 text-right font-mono ${
                parseFloat(e.totalPnlPercent) >= 0 ? 'text-profit' : 'text-loss'
              }`}>
                {parseFloat(e.totalPnlPercent) >= 0 ? '+' : ''}{e.totalPnlPercent}%
              </td>
              <td class="py-3 text-right">{e.tradeCount}</td>
              <td class="py-3 text-right text-gray-400 hidden sm:table-cell">
                {e.lastTradeAt ? e.lastTradeAt.toLocaleDateString() : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Computed timestamp */}
      <p class="mt-4 text-xs text-gray-500">
        Updated: {data.computedAt.toISOString()}
      </p>
    </div>,
    { title: 'MoltApp Leaderboard' }
  )
})

export { pages as pageRoutes }
```

**Source:** https://hono.dev/docs/middleware/builtin/jsx-renderer, https://hono.dev/docs/guides/jsx

### Example 2: P&L Computation Logic (Service Layer)

```tsx
// src/services/leaderboard.ts (computation logic)
import { Decimal } from 'decimal.js'
import { db } from '../db/index.ts'
import { agents, positions, trades, transactions } from '../db/schema/index.ts'
import { eq, sql, desc, and, sum, count, max } from 'drizzle-orm'
import { getPrices } from './jupiter.ts'
import { XSTOCKS_CATALOG } from '../config/constants.ts'

async function computeLeaderboard(): Promise<LeaderboardEntry[]> {
  // 1. Fetch all active agents
  const allAgents = await db.select().from(agents).where(eq(agents.isActive, true))

  // 2. Fetch all positions (for all agents at once)
  const allPositions = await db.select().from(positions)

  // 3. Fetch live prices for all unique mints in positions
  const uniqueMints = [...new Set(allPositions.map(p => p.mintAddress))]
  const priceMap = uniqueMints.length > 0 ? await getPrices(uniqueMints) : {}

  // 4. Compute per-agent trade stats (aggregated from trades table)
  const tradeStats = await db
    .select({
      agentId: trades.agentId,
      tradeCount: count(trades.id),
      lastTradeAt: max(trades.createdAt),
      // Realized P&L from sells: SUM(sell USDC received) - SUM(cost basis * sell quantity)
    })
    .from(trades)
    .where(eq(trades.status, 'confirmed'))
    .groupBy(trades.agentId)

  // 5. Compute USDC cash balance per agent from transactions + trades
  // Cash = deposits - withdrawals - buy_usdc_spent + sell_usdc_received
  // (see Pitfall 2 above for why we don't use on-chain balance)

  // 6. For each agent, compute:
  //    - Unrealized P&L: SUM((currentPrice - avgCostBasis) * quantity) across positions
  //    - Realized P&L: SUM from sell trades of (sellPrice - avgCostBasis) * quantity
  //    - Total Portfolio Value: cash + SUM(currentPrice * quantity)
  //    - P&L % = totalPnl / totalInvested * 100

  const entries: LeaderboardEntry[] = allAgents.map(agent => {
    const agentPositions = allPositions.filter(p => p.agentId === agent.id)

    let unrealizedPnl = new Decimal(0)
    let positionMarketValue = new Decimal(0)

    for (const pos of agentPositions) {
      const price = priceMap[pos.mintAddress]
      if (!price) continue
      const currentPrice = new Decimal(price.usdPrice)
      const qty = new Decimal(pos.quantity)
      const costBasis = new Decimal(pos.averageCostBasis)

      positionMarketValue = positionMarketValue.plus(currentPrice.mul(qty))
      unrealizedPnl = unrealizedPnl.plus(currentPrice.minus(costBasis).mul(qty))
    }

    // ... compute cash, realized P&L, total, rank
    return { /* ... */ } as LeaderboardEntry
  })

  // 7. Sort by P&L percentage (descending), assign ranks
  entries.sort((a, b) => parseFloat(b.totalPnlPercent) - parseFloat(a.totalPnlPercent))
  entries.forEach((e, i) => { e.rank = i + 1 })

  return entries
}
```

### Example 3: Realized P&L Calculation from Trades Table

```tsx
// For each agent, compute realized P&L from sell trades
// The trades table stores: side, stockQuantity, usdcAmount, pricePerToken
// The positions table stores: averageCostBasis at time of last update
//
// CRITICAL: averageCostBasis on positions changes as you buy more.
// But for realized P&L, we need the cost basis AT THE TIME of each sell.
//
// APPROACH: Since positions.averageCostBasis is updated on buys and
// stays the same on sells (see trading.ts line 393), we can compute
// realized P&L directly from sell trades:
//
//   For each sell trade:
//     realized_pnl += (sellPricePerToken - costBasisAtSell) * sellQuantity
//
// PROBLEM: The trades table doesn't store the cost basis at sell time.
// We need to EITHER:
//   a) Add a costBasisAtSell column to trades (schema change, best)
//   b) Reconstruct cost basis from trade history (complex, error-prone)
//   c) Approximate using current position's averageCostBasis (inaccurate)
//
// RECOMMENDATION: Add a `cost_basis_at_trade` column to the trades schema.
// For now, as a simpler v1 approach:
//   Realized P&L = SUM(sell usdcAmount) - SUM(buy usdcAmount * sellQty/buyQty)
// OR even simpler:
//   Total P&L = (Current portfolio value + all USDC received from sells)
//             - (Initial deposits + all USDC spent on buys)
//   This is the "money in vs money out" approach -- simpler and always accurate.

// SIMPLEST CORRECT APPROACH (recommended for v1):
// Total P&L = Current Portfolio Value - Total Capital Deposited
// Where:
//   Current Portfolio Value = USDC cash balance + market value of all positions
//   Total Capital Deposited = SUM of all USDC deposits
// This sidesteps realized/unrealized split entirely while being perfectly accurate.
// The split can be added later with a schema migration.
```

### Example 4: Drizzle Aggregate Query for Trade Stats

```tsx
// Aggregate trade count and last trade per agent
import { sql, count, max, sum } from 'drizzle-orm'

const tradeStats = await db
  .select({
    agentId: trades.agentId,
    tradeCount: count(trades.id),
    lastTradeAt: max(trades.createdAt),
    totalBuyUsdc: sql<string>`COALESCE(SUM(CASE WHEN ${trades.side} = 'buy' THEN ${trades.usdcAmount}::numeric ELSE 0 END), 0)`,
    totalSellUsdc: sql<string>`COALESCE(SUM(CASE WHEN ${trades.side} = 'sell' THEN ${trades.usdcAmount}::numeric ELSE 0 END), 0)`,
  })
  .from(trades)
  .where(eq(trades.status, 'confirmed'))
  .groupBy(trades.agentId)

// Aggregate deposit totals per agent
const depositStats = await db
  .select({
    agentId: transactions.agentId,
    totalDeposited: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'deposit' AND ${transactions.tokenType} = 'USDC' THEN ${transactions.amount}::numeric ELSE 0 END), 0)`,
    totalWithdrawn: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'withdrawal' AND ${transactions.tokenType} = 'USDC' THEN ${transactions.amount}::numeric ELSE 0 END), 0)`,
  })
  .from(transactions)
  .where(eq(transactions.status, 'confirmed'))
  .groupBy(transactions.agentId)
```

### Example 5: Bot-Facing JSON API Endpoint

```tsx
// src/routes/leaderboard-api.ts
import { Hono } from 'hono'
import { getLeaderboard } from '../services/leaderboard.ts'

type LeaderboardApiEnv = { Variables: { agentId: string } }

export const leaderboardApiRoutes = new Hono<LeaderboardApiEnv>()

// GET /api/v1/leaderboard -- JSON leaderboard for bots
leaderboardApiRoutes.get('/', async (c) => {
  const data = await getLeaderboard()
  return c.json({
    entries: data.entries,
    totalAgents: data.aggregateStats.totalAgents,
    totalVolume: data.aggregateStats.totalVolume,
    computedAt: data.computedAt.toISOString(),
  })
})

// GET /api/v1/leaderboard/me -- Current agent's ranking
leaderboardApiRoutes.get('/me', async (c) => {
  const agentId = c.get('agentId')
  const data = await getLeaderboard()
  const myEntry = data.entries.find(e => e.agentId === agentId)
  if (!myEntry) {
    return c.json({ error: 'not_ranked', message: 'No trades yet' }, 404)
  }
  return c.json(myEntry)
})
```

### Example 6: Tailwind v4 CDN Dark Theme Setup

```html
<!-- In layout.tsx <head> -->
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
<style type="text/tailwindcss">{`
  @theme {
    --color-profit: #22c55e;
    --color-loss: #ef4444;
    --color-terminal-bg: #0a0a0f;
    --color-terminal-border: #1e293b;
  }
  @variant dark (&:where(.dark, .dark *));
`}</style>
```

**Key notes for Tailwind v4 CDN:**
- Use `@theme` block for custom colors (replaces `tailwind.config.js` theme extension)
- Use `@variant dark` directive for class-based dark mode
- All CSS features work except `@apply`
- `type="text/tailwindcss"` is required for custom CSS blocks

**Source:** https://tailwindcss.com/docs/installation/play-cdn

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Tailwind v3 CDN (`cdn.tailwindcss.com`) | Tailwind v4 CDN (`@tailwindcss/browser@4` from jsdelivr) | Tailwind v4 release (2025) | Different script tag URL, `@theme` replaces config, `@variant` replaces `darkMode` config |
| `darkMode: 'class'` in tailwind.config.js | `@variant dark (&:where(.dark, .dark *))` in CSS | Tailwind v4 | Config-less, CSS-native dark mode strategy |
| Hono `c.html()` with raw strings | `jsxRenderer` middleware + `c.render()` | Hono 4.x | Type-safe layouts, automatic DOCTYPE, per-page props |
| Custom auth header parsing | `basicAuth` from `hono/basic-auth` built-in | Hono 3.x+ | Zero-dependency, handles challenge/response |

**Deprecated/outdated:**
- `cdn.tailwindcss.com` (v3): Still works but Tailwind v4 is current. For this project, v4 is the right choice per CONTEXT.md.
- `@apply` in CDN mode: Never supported in CDN; use inline utility classes.

## Open Questions

1. **Realized vs Unrealized P&L Split**
   - What we know: The `trades` table records buy/sell amounts, and `positions` table tracks `averageCostBasis`. However, `averageCostBasis` is the CURRENT weighted average, not the cost basis at the time of each individual sell.
   - What's unclear: Whether the CONTEXT.md requirement "Realized and unrealized P&L tracked per agent" (COMP-02) requires displaying them SEPARATELY on the leaderboard, or whether a single "Total P&L" column suffices.
   - Recommendation: For v1, use the "money in vs money out" approach (Total P&L = Current Portfolio Value - Total Deposited Capital). This is always accurate. If separate realized/unrealized display is required, add a `cost_basis_at_trade` column to the `trades` table via migration and populate it on future sells (the trading service already has this value at sell time but doesn't store it).

2. **USDC Cash Balance: DB-computed vs On-chain**
   - What we know: On-chain balance checks via Solana RPC are expensive at scale (1 RPC call per agent). DB-computed balance (deposits - withdrawals - buys + sells) should match on-chain balance.
   - What's unclear: Whether there are edge cases where DB balance diverges from on-chain (e.g., failed transactions, external transfers).
   - Recommendation: Use DB-computed balance for the cached leaderboard. It is fast and accurate for the MoltApp flow where all USDC movement goes through the API.

3. **"Show More" Implementation**
   - What we know: CONTEXT.md says "Top 50 agents with Show more button."
   - What's unclear: Whether "Show more" should be a full page reload with `?page=2` query param (server-rendered pagination) or client-side JS that reveals hidden rows.
   - Recommendation: Render all agents in the cache (up to a reasonable limit), show first 50 with CSS `hidden`, and use a tiny inline `<script>` to toggle visibility. No need for pagination API since the cache holds all data in memory already.

4. **Entry Point File Extension**
   - What we know: The current entry point is `src/index.ts`. Adding JSX to this file would require renaming it to `src/index.tsx`.
   - Recommendation: Keep `src/index.ts` as-is (it only mounts routes, no JSX needed). Put all JSX in `.tsx` files under `src/views/` and `src/routes/pages.tsx`. The existing `.ts` files that don't use JSX need no changes.

5. **New Env Variable for Admin Password**
   - What we know: Admin auth needs a password from environment.
   - Recommendation: Add `ADMIN_PASSWORD` to the Zod env schema in `src/config/env.ts` as a required string. Set it in `.env`.

## Sources

### Primary (HIGH confidence)
- Hono JSX Guide: https://hono.dev/docs/guides/jsx -- Setup, async components, c.html(), layout patterns
- Hono JSX Renderer Middleware: https://hono.dev/docs/middleware/builtin/jsx-renderer -- jsxRenderer, c.render(), per-page title, DOCTYPE control
- Hono Basic Auth Middleware: https://hono.dev/docs/middleware/builtin/basic-auth -- basicAuth usage, verifyUser option
- Tailwind CSS v4 Play CDN: https://tailwindcss.com/docs/installation/play-cdn -- Script tag `@tailwindcss/browser@4`, limitations
- Tailwind v4 Dark Mode: https://tailwindcss.com/docs/dark-mode -- `@variant dark` directive for class-based dark mode
- Existing codebase: `/Users/patruff/moltapp/src/` -- Verified all schema fields, service patterns, route structure, middleware ordering

### Secondary (MEDIUM confidence)
- P&L calculation formulas: https://www.interactivebrokers.com/campus/glossary-terms/unrealized-pl/ -- Industry standard unrealized P&L formula
- Drizzle ORM aggregation: https://orm.drizzle.team/docs/select -- count(), sum(), sql tagged template, groupBy

### Tertiary (LOW confidence)
- Tailwind v4 CDN dark mode with `@variant`: https://github.com/tailwindlabs/tailwindcss/discussions/16029 -- Community-verified approach for CDN dark mode toggle

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All libraries already installed in `package.json`; Hono JSX docs verified via official site
- Architecture: HIGH -- Route mounting pattern verified from existing `src/index.ts`; jsxRenderer API verified from official docs
- P&L calculations: HIGH for total P&L approach, MEDIUM for realized/unrealized split -- Total P&L is simple math; split requires schema consideration
- Caching: HIGH -- Standard in-memory singleton pattern; no external dependencies
- Tailwind v4 CDN: HIGH -- Official docs confirm script tag and `@theme`/`@variant` syntax
- Pitfalls: HIGH -- Derived from reading the actual codebase and understanding the data model

**Research date:** 2026-02-01
**Valid until:** 2026-03-01 (stable stack, Hono/Tailwind APIs unlikely to change within 30 days)
