/**
 * Round Analytics API Routes
 *
 * Deep post-round analysis, trends, and performance reporting.
 */

import { Hono } from "hono";
import {
  analyzeRound,
  getRoundAnalytics,
  getRecentRoundAnalytics,
  generateAnalyticsSummary,
  computeAgentTrends,
  getAnalyticsStatus,
  type RoundDecision,
} from "../services/round-analytics.ts";

const app = new Hono();

/** GET /status — analytics engine status */
app.get("/status", (c) => {
  return c.json(getAnalyticsStatus());
});

/** GET /recent — recent round analytics */
app.get("/recent", (c) => {
  const limit = parseInt(c.req.query("limit") ?? "20", 10);
  const analytics = getRecentRoundAnalytics(limit);
  return c.json({ analytics, count: analytics.length });
});

/** GET /round/:roundId — analytics for a specific round */
app.get("/round/:roundId", (c) => {
  const roundId = c.req.param("roundId");
  const analytics = getRoundAnalytics(roundId);
  if (!analytics) {
    return c.json({ error: "Round not found", roundId }, 404);
  }
  return c.json(analytics);
});

/** GET /summary — comprehensive analytics summary */
app.get("/summary", (c) => {
  const days = parseInt(c.req.query("days") ?? "7", 10);
  const summary = generateAnalyticsSummary(days);
  return c.json(summary);
});

/** GET /trends — agent performance trends */
app.get("/trends", (c) => {
  const window = parseInt(c.req.query("window") ?? "20", 10);
  const trends = computeAgentTrends(window);
  return c.json({ trends, windowSize: window, computedAt: new Date().toISOString() });
});

/** POST /analyze — analyze a round (typically called by orchestrator) */
app.post("/analyze", async (c) => {
  const body = await c.req.json() as {
    roundId: string;
    timestamp: string;
    decisions: RoundDecision[];
    marketData: { symbol: string; price: number; change24h: number | null }[];
    roundDurationMs: number;
  };

  if (!body.roundId || !Array.isArray(body.decisions)) {
    return c.json({ error: "roundId and decisions[] required" }, 400);
  }

  const analytics = analyzeRound(
    body.roundId,
    body.timestamp ?? new Date().toISOString(),
    body.decisions,
    body.marketData ?? [],
    body.roundDurationMs ?? 0,
  );

  return c.json(analytics);
});

/** GET /quality — round quality scores over time */
app.get("/quality", (c) => {
  const limit = parseInt(c.req.query("limit") ?? "50", 10);
  const analytics = getRecentRoundAnalytics(limit);
  const scores = analytics.map((a) => ({
    roundId: a.roundId,
    timestamp: a.timestamp,
    qualityScore: a.quality.roundQualityScore,
    consensusType: a.consensus.type,
    participationRate: a.participation.participationRate,
    executionRate: a.participation.executionRate,
    totalUsdc: a.metrics.totalUsdcTraded,
  }));
  return c.json({ scores, count: scores.length });
});

/** GET /participation — participation and execution rates over time */
app.get("/participation", (c) => {
  const limit = parseInt(c.req.query("limit") ?? "50", 10);
  const analytics = getRecentRoundAnalytics(limit);
  const rates = analytics.map((a) => ({
    roundId: a.roundId,
    timestamp: a.timestamp,
    totalAgents: a.participation.totalAgents,
    activeAgents: a.participation.activeAgents,
    holdAgents: a.participation.holdAgents,
    participationRate: a.participation.participationRate,
    executionRate: a.participation.executionRate,
  }));
  return c.json({ rates, count: rates.length });
});

/** GET /market-context — market conditions at time of each round */
app.get("/market-context", (c) => {
  const limit = parseInt(c.req.query("limit") ?? "20", 10);
  const analytics = getRecentRoundAnalytics(limit);
  const contexts = analytics.map((a) => ({
    roundId: a.roundId,
    timestamp: a.timestamp,
    ...a.marketContext,
    consensusType: a.consensus.type,
  }));
  return c.json({ contexts, count: contexts.length });
});

export const roundAnalyticsRoutes = app;
