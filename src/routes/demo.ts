import { Hono } from "hono";
import { z } from "zod";
import { XSTOCKS_CATALOG } from "../config/constants.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DemoHolding {
  symbol: string;
  name: string;
  quantity: number;
  avgCostBasis: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
}

interface DemoTrade {
  id: string;
  timestamp: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  total: number;
}

interface DemoSession {
  id: string;
  createdAt: string;
  displayName: string;
  cash: number;
  holdings: Map<string, { quantity: number; avgCostBasis: number }>;
  tradeHistory: DemoTrade[];
}

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

const sessions = new Map<string, DemoSession>();

/**
 * Live simulated prices. Initialized from realistic market prices,
 * then random-walk on each trade to simulate volatility.
 */
const simulatedPrices: Record<string, number> = {
  AAPLx: 185.42,
  AMZNx: 191.75,
  GOOGLx: 176.30,
  METAx: 585.20,
  MSFTx: 422.15,
  NVDAx: 138.50,
  TSLAx: 252.80,
  SPYx: 597.40,
  QQQx: 518.65,
  COINx: 265.30,
  CRCLx: 32.50,
  MSTRx: 345.10,
  AVGOx: 192.40,
  JPMx: 243.80,
  HOODx: 42.15,
  LLYx: 785.60,
  CRMx: 308.25,
  NFLXx: 892.40,
  PLTRx: 78.55,
  GMEx: 27.30,
};

const STOCK_LOOKUP = new Map(
  XSTOCKS_CATALOG.map((s) => [s.symbol, s.name])
);

const INITIAL_CASH = 100_000;
const MAX_SESSIONS = 10_000;

// Leaderboard cache
interface LeaderboardEntry {
  sessionId: string;
  displayName: string;
  totalValue: number;
  pnl: number;
  pnlPercent: number;
  tradeCount: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "demo_";
  for (let i = 0; i < 12; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function generateTradeId(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Apply a small random walk to the price of a symbol (+/- 0.5% max).
 * Called after every trade to simulate market movement.
 */
function tickPrice(symbol: string): number {
  const current = simulatedPrices[symbol];
  if (current === undefined) return 0;
  // Random change between -0.5% and +0.5%
  const pctChange = (Math.random() - 0.5) * 0.01;
  const newPrice = Math.round(current * (1 + pctChange) * 100) / 100;
  simulatedPrices[symbol] = Math.max(0.01, newPrice);
  return simulatedPrices[symbol];
}

function getPrice(symbol: string): number | undefined {
  return simulatedPrices[symbol];
}

function computePortfolio(session: DemoSession): {
  holdings: DemoHolding[];
  totalHoldingsValue: number;
  totalValue: number;
  pnl: number;
  pnlPercent: number;
} {
  const holdings: DemoHolding[] = [];
  let totalHoldingsValue = 0;

  for (const [symbol, pos] of session.holdings) {
    const currentPrice = simulatedPrices[symbol] ?? 0;
    const marketValue = pos.quantity * currentPrice;
    const costBasis = pos.quantity * pos.avgCostBasis;
    const unrealizedPnl = marketValue - costBasis;
    const unrealizedPnlPercent =
      costBasis > 0 ? (unrealizedPnl / costBasis) * 100 : 0;

    holdings.push({
      symbol,
      name: STOCK_LOOKUP.get(symbol) ?? symbol,
      quantity: Math.round(pos.quantity * 1e6) / 1e6,
      avgCostBasis: pos.avgCostBasis,
      currentPrice,
      marketValue: Math.round(marketValue * 100) / 100,
      unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
      unrealizedPnlPercent: Math.round(unrealizedPnlPercent * 100) / 100,
    });

    totalHoldingsValue += marketValue;
  }

  const totalValue = session.cash + totalHoldingsValue;
  const pnl = totalValue - INITIAL_CASH;
  const pnlPercent = (pnl / INITIAL_CASH) * 100;

  return {
    holdings: holdings.sort((a, b) => b.marketValue - a.marketValue),
    totalHoldingsValue: Math.round(totalHoldingsValue * 100) / 100,
    totalValue: Math.round(totalValue * 100) / 100,
    pnl: Math.round(pnl * 100) / 100,
    pnlPercent: Math.round(pnlPercent * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const tradeBodySchema = z.object({
  symbol: z.string().min(1),
  side: z.enum(["buy", "sell"]),
  quantity: z.number().positive(),
});

const startBodySchema = z.object({
  displayName: z.string().min(1).max(32).optional(),
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const demoRoutes = new Hono();

// ---------------------------------------------------------------------------
// POST /api/demo/start -- Create a new demo session
// ---------------------------------------------------------------------------

demoRoutes.post("/start", async (c) => {
  // Limit total sessions to prevent memory abuse
  if (sessions.size >= MAX_SESSIONS) {
    // Evict oldest session
    const oldest = sessions.keys().next().value;
    if (oldest) sessions.delete(oldest);
  }

  let displayName = "Anonymous Trader";
  try {
    const body = await c.req.json();
    const parsed = startBodySchema.safeParse(body);
    if (parsed.success && parsed.data.displayName) {
      displayName = parsed.data.displayName;
    }
  } catch {
    // No body is fine -- use default name
  }

  const session: DemoSession = {
    id: generateId(),
    createdAt: new Date().toISOString(),
    displayName,
    cash: INITIAL_CASH,
    holdings: new Map(),
    tradeHistory: [],
  };

  sessions.set(session.id, session);

  return c.json({
    sessionId: session.id,
    displayName: session.displayName,
    cash: session.cash,
    message: `Demo session created with $${INITIAL_CASH.toLocaleString()} virtual cash. Trade any of ${XSTOCKS_CATALOG.length} tokenized stocks!`,
    availableStocks: Object.entries(simulatedPrices).map(([symbol, price]) => ({
      symbol,
      name: STOCK_LOOKUP.get(symbol) ?? symbol,
      price,
    })),
  });
});

// Also support GET for easy browser testing
demoRoutes.get("/start", async (c) => {
  if (sessions.size >= MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (oldest) sessions.delete(oldest);
  }

  const session: DemoSession = {
    id: generateId(),
    createdAt: new Date().toISOString(),
    displayName: "Anonymous Trader",
    cash: INITIAL_CASH,
    holdings: new Map(),
    tradeHistory: [],
  };

  sessions.set(session.id, session);

  return c.json({
    sessionId: session.id,
    displayName: session.displayName,
    cash: session.cash,
    message: `Demo session created with $${INITIAL_CASH.toLocaleString()} virtual cash. Trade any of ${XSTOCKS_CATALOG.length} tokenized stocks!`,
    availableStocks: Object.entries(simulatedPrices).map(([symbol, price]) => ({
      symbol,
      name: STOCK_LOOKUP.get(symbol) ?? symbol,
      price,
    })),
  });
});

// ---------------------------------------------------------------------------
// GET /api/demo/portfolio/:sessionId -- Portfolio view
// ---------------------------------------------------------------------------

demoRoutes.get("/portfolio/:sessionId", (c) => {
  const sessionId = c.req.param("sessionId");
  const session = sessions.get(sessionId);

  if (!session) {
    return c.json(
      { error: "session_not_found", code: "SESSION_NOT_FOUND", status: 404 },
      404
    );
  }

  const portfolio = computePortfolio(session);

  return c.json({
    sessionId: session.id,
    displayName: session.displayName,
    createdAt: session.createdAt,
    cash: Math.round(session.cash * 100) / 100,
    holdings: portfolio.holdings,
    totalHoldingsValue: portfolio.totalHoldingsValue,
    totalValue: portfolio.totalValue,
    pnl: portfolio.pnl,
    pnlPercent: portfolio.pnlPercent,
    tradeCount: session.tradeHistory.length,
  });
});

// ---------------------------------------------------------------------------
// POST /api/demo/trade/:sessionId -- Execute a demo trade
// ---------------------------------------------------------------------------

demoRoutes.post("/trade/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  const session = sessions.get(sessionId);

  if (!session) {
    return c.json(
      { error: "session_not_found", code: "SESSION_NOT_FOUND", status: 404 },
      404
    );
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: "Request body must be valid JSON", code: "INVALID_JSON", status: 400 },
      400
    );
  }

  const parsed = tradeBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: "Validation failed",
        code: "VALIDATION_FAILED",
        status: 400,
        details: parsed.error.flatten(),
      },
      400
    );
  }

  const { symbol, side, quantity } = parsed.data;

  // Verify stock exists
  const price = getPrice(symbol);
  if (price === undefined) {
    return c.json(
      {
        error: `Unknown stock symbol "${symbol}". Use one of: ${Object.keys(simulatedPrices).join(", ")}`,
        code: "STOCK_NOT_FOUND",
        status: 404,
      },
      404
    );
  }

  if (side === "buy") {
    const totalCost = quantity * price;
    if (totalCost > session.cash) {
      return c.json(
        {
          error: `Insufficient cash. Need $${totalCost.toFixed(2)} but have $${session.cash.toFixed(2)}`,
          code: "INSUFFICIENT_BALANCE",
          status: 400,
        },
        400
      );
    }

    // Execute buy
    session.cash -= totalCost;
    const existing = session.holdings.get(symbol);
    if (existing) {
      // Update average cost basis
      const totalQty = existing.quantity + quantity;
      const totalCostBasis =
        existing.quantity * existing.avgCostBasis + quantity * price;
      existing.avgCostBasis = totalCostBasis / totalQty;
      existing.quantity = totalQty;
    } else {
      session.holdings.set(symbol, { quantity, avgCostBasis: price });
    }

    const trade: DemoTrade = {
      id: generateTradeId(),
      timestamp: new Date().toISOString(),
      symbol,
      side: "buy",
      quantity,
      price,
      total: Math.round(totalCost * 100) / 100,
    };
    session.tradeHistory.push(trade);

    // Tick the price after trade
    const newPrice = tickPrice(symbol);

    return c.json({
      trade,
      newPrice,
      cashRemaining: Math.round(session.cash * 100) / 100,
      message: `Bought ${quantity} ${symbol} @ $${price.toFixed(2)} for $${totalCost.toFixed(2)}`,
    });
  } else {
    // Sell
    const existing = session.holdings.get(symbol);
    if (!existing || existing.quantity < quantity) {
      const held = existing?.quantity ?? 0;
      return c.json(
        {
          error: `Insufficient holdings. Want to sell ${quantity} ${symbol} but hold ${held}`,
          code: "INSUFFICIENT_HOLDINGS",
          status: 400,
        },
        400
      );
    }

    const totalProceeds = quantity * price;
    session.cash += totalProceeds;
    existing.quantity -= quantity;

    if (existing.quantity < 0.000001) {
      session.holdings.delete(symbol);
    }

    const trade: DemoTrade = {
      id: generateTradeId(),
      timestamp: new Date().toISOString(),
      symbol,
      side: "sell",
      quantity,
      price,
      total: Math.round(totalProceeds * 100) / 100,
    };
    session.tradeHistory.push(trade);

    // Tick the price after trade
    const newPrice = tickPrice(symbol);

    return c.json({
      trade,
      newPrice,
      cashRemaining: Math.round(session.cash * 100) / 100,
      message: `Sold ${quantity} ${symbol} @ $${price.toFixed(2)} for $${totalProceeds.toFixed(2)}`,
    });
  }
});

// ---------------------------------------------------------------------------
// GET /api/demo/history/:sessionId -- Trade history
// ---------------------------------------------------------------------------

demoRoutes.get("/history/:sessionId", (c) => {
  const sessionId = c.req.param("sessionId");
  const session = sessions.get(sessionId);

  if (!session) {
    return c.json(
      { error: "session_not_found", code: "SESSION_NOT_FOUND", status: 404 },
      404
    );
  }

  return c.json({
    sessionId: session.id,
    displayName: session.displayName,
    tradeCount: session.tradeHistory.length,
    trades: [...session.tradeHistory].reverse(), // newest first
  });
});

// ---------------------------------------------------------------------------
// GET /api/demo/leaderboard -- Top demo traders
// ---------------------------------------------------------------------------

demoRoutes.get("/leaderboard", (c) => {
  const entries: LeaderboardEntry[] = [];

  for (const session of sessions.values()) {
    if (session.tradeHistory.length === 0) continue; // Skip sessions with no trades

    const portfolio = computePortfolio(session);
    entries.push({
      sessionId: session.id,
      displayName: session.displayName,
      totalValue: portfolio.totalValue,
      pnl: portfolio.pnl,
      pnlPercent: portfolio.pnlPercent,
      tradeCount: session.tradeHistory.length,
      createdAt: session.createdAt,
    });
  }

  // Sort by total value descending
  entries.sort((a, b) => b.totalValue - a.totalValue);

  return c.json({
    leaderboard: entries.slice(0, 100),
    totalSessions: sessions.size,
    activeTradingSessions: entries.length,
  });
});

// ---------------------------------------------------------------------------
// GET /api/demo/prices -- Current simulated prices
// ---------------------------------------------------------------------------

demoRoutes.get("/prices", (c) => {
  const prices = Object.entries(simulatedPrices).map(([symbol, price]) => ({
    symbol,
    name: STOCK_LOOKUP.get(symbol) ?? symbol,
    price,
  }));

  return c.json({ prices });
});

// ---------------------------------------------------------------------------
// GET /api/demo/stocks -- Available stocks info
// ---------------------------------------------------------------------------

demoRoutes.get("/stocks", (c) => {
  const stocks = XSTOCKS_CATALOG.map((s) => ({
    symbol: s.symbol,
    name: s.name,
    mintAddress: s.mintAddress,
    currentPrice: simulatedPrices[s.symbol] ?? null,
  }));

  return c.json({ stocks, count: stocks.length });
});
