/**
 * Slippage Analytics Routes
 *
 * Expose trade slippage analysis and reporting.
 *
 * Endpoints:
 * - GET  /stats           — Overall slippage statistics
 * - GET  /agents          — Per-agent slippage profiles
 * - GET  /stocks          — Per-stock slippage profiles
 * - GET  /anomalies       — Recent slippage anomalies
 * - GET  /recent          — Recent slippage records
 * - POST /record          — Manually record a slippage observation
 * - PUT  /config          — Update analyzer configuration
 * - GET  /config          — Get current configuration
 */

import { Hono } from "hono";
import {
  getSlippageStats,
  getAgentSlippageProfiles,
  getStockSlippageProfiles,
  getSlippageAnomalies,
  getRecentSlippage,
  recordSlippage,
  configureSlippageAnalyzer,
  getSlippageAnalyzerConfig,
  type SlippageAnalyzerConfig,
} from "../services/slippage-analyzer.ts";

export const slippageRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET /stats — Overall slippage statistics
// ---------------------------------------------------------------------------

slippageRoutes.get("/stats", (c) => {
  const sinceParam = c.req.query("since");
  const since = sinceParam ? new Date(sinceParam) : undefined;
  return c.json(getSlippageStats(since));
});

// ---------------------------------------------------------------------------
// GET /agents — Per-agent slippage profiles
// ---------------------------------------------------------------------------

slippageRoutes.get("/agents", (c) => {
  return c.json(getAgentSlippageProfiles());
});

// ---------------------------------------------------------------------------
// GET /stocks — Per-stock slippage profiles
// ---------------------------------------------------------------------------

slippageRoutes.get("/stocks", (c) => {
  return c.json(getStockSlippageProfiles());
});

// ---------------------------------------------------------------------------
// GET /anomalies — Recent slippage anomalies
// ---------------------------------------------------------------------------

slippageRoutes.get("/anomalies", (c) => {
  const limit = Number(c.req.query("limit") || "50");
  const severity = c.req.query("severity") as
    | "warning"
    | "critical"
    | undefined;
  return c.json(getSlippageAnomalies(limit, severity));
});

// ---------------------------------------------------------------------------
// GET /recent — Recent slippage records
// ---------------------------------------------------------------------------

slippageRoutes.get("/recent", (c) => {
  const agentId = c.req.query("agentId") ?? undefined;
  const symbol = c.req.query("symbol") ?? undefined;
  const action = c.req.query("action") as "buy" | "sell" | undefined;
  const limit = Number(c.req.query("limit") || "100");
  const sinceParam = c.req.query("since");
  const since = sinceParam ? new Date(sinceParam) : undefined;

  return c.json(getRecentSlippage({ agentId, symbol, action, limit, since }));
});

// ---------------------------------------------------------------------------
// POST /record — Manually record a slippage observation
// ---------------------------------------------------------------------------

slippageRoutes.post("/record", async (c) => {
  const body = await c.req.json<{
    agentId: string;
    agentName: string;
    symbol: string;
    action: "buy" | "sell";
    expectedPrice: number;
    actualPrice: number;
    quantity: number;
    jupiterRequestId?: string;
    txSignature?: string;
    roundId?: string;
    marketSession?: string;
  }>();

  const record = recordSlippage(body);
  return c.json(record, 201);
});

// ---------------------------------------------------------------------------
// PUT /config — Update analyzer configuration
// ---------------------------------------------------------------------------

slippageRoutes.put("/config", async (c) => {
  const body = await c.req.json<Partial<SlippageAnalyzerConfig>>();
  const updated = configureSlippageAnalyzer(body);
  return c.json({ updated: true, config: updated });
});

// ---------------------------------------------------------------------------
// GET /config — Get current configuration
// ---------------------------------------------------------------------------

slippageRoutes.get("/config", (c) => {
  return c.json(getSlippageAnalyzerConfig());
});
