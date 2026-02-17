/**
 * Market Hours Routes
 *
 * Expose market session information and trading policies.
 *
 * Endpoints:
 * - GET  /session     — Current market session and trading policy
 * - GET  /schedule    — Today's full session schedule
 * - GET  /holidays    — Upcoming market holidays
 * - GET  /check       — Check if a trade would be allowed (with confidence param)
 * - PUT  /config      — Update market hours configuration
 * - GET  /config      — Get current configuration
 */

import { Hono } from "hono";
import {
  getCurrentSession,
  getTodaySchedule,
  getUpcomingHolidays,
  checkTradingSession,
  configureMarketHours,
  getMarketHoursConfig,
  type MarketHoursConfig,
} from "../services/market-hours.ts";

export const marketHoursRoutes = new Hono();

// Default query parameters for market hours endpoints
const DEFAULT_HOLIDAYS_LIMIT = 5; // Upcoming holidays to return by default
const DEFAULT_TRADING_CONFIDENCE = 50; // Neutral confidence threshold for /check endpoint

// ---------------------------------------------------------------------------
// GET /session — Current session info
// ---------------------------------------------------------------------------

marketHoursRoutes.get("/session", (c) => {
  return c.json(getCurrentSession());
});

// ---------------------------------------------------------------------------
// GET /schedule — Today's trading schedule
// ---------------------------------------------------------------------------

marketHoursRoutes.get("/schedule", (c) => {
  return c.json(getTodaySchedule());
});

// ---------------------------------------------------------------------------
// GET /holidays — Upcoming market holidays
// ---------------------------------------------------------------------------

marketHoursRoutes.get("/holidays", (c) => {
  const limit = Number(c.req.query("limit") || DEFAULT_HOLIDAYS_LIMIT);
  return c.json(getUpcomingHolidays(limit));
});

// ---------------------------------------------------------------------------
// GET /check — Check if a trade would be allowed
// ---------------------------------------------------------------------------

marketHoursRoutes.get("/check", (c) => {
  const confidence = Number(c.req.query("confidence") || DEFAULT_TRADING_CONFIDENCE);
  return c.json(checkTradingSession(confidence));
});

// ---------------------------------------------------------------------------
// PUT /config — Update market hours configuration
// ---------------------------------------------------------------------------

marketHoursRoutes.put("/config", async (c) => {
  const body = await c.req.json<Partial<MarketHoursConfig>>();
  const updated = configureMarketHours(body);
  return c.json({ updated: true, config: updated });
});

// ---------------------------------------------------------------------------
// GET /config — Get current configuration
// ---------------------------------------------------------------------------

marketHoursRoutes.get("/config", (c) => {
  return c.json(getMarketHoursConfig());
});
