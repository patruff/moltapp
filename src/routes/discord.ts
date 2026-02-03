/**
 * Discord Notifier Routes
 *
 * Manage Discord webhook notifications for trading events.
 *
 * Endpoints:
 * - GET  /status     — Get notifier status and metrics
 * - POST /test       — Send a test webhook message
 * - PUT  /config     — Update notifier configuration
 * - POST /notify/trade         — Manually trigger a trade notification
 * - POST /notify/round-summary — Manually trigger a round summary notification
 */

import { Hono } from "hono";
import {
  getDiscordNotifierMetrics,
  testDiscordWebhook,
  configureDiscordNotifier,
  notifyTradeExecution,
  notifyRoundSummary,
  notifySystemAlert,
  type TradeNotification,
  type RoundSummaryNotification,
  type DiscordNotifierConfig,
} from "../services/discord-notifier.ts";

export const discordRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET /status — Notifier metrics
// ---------------------------------------------------------------------------

discordRoutes.get("/status", (c) => {
  return c.json(getDiscordNotifierMetrics());
});

// ---------------------------------------------------------------------------
// POST /test — Send test webhook
// ---------------------------------------------------------------------------

discordRoutes.post("/test", async (c) => {
  const result = await testDiscordWebhook();
  return c.json(result, result.success ? 200 : 502);
});

// ---------------------------------------------------------------------------
// PUT /config — Update configuration
// ---------------------------------------------------------------------------

discordRoutes.put("/config", async (c) => {
  const body = await c.req.json<Partial<DiscordNotifierConfig>>();
  const updated = configureDiscordNotifier(body);
  return c.json({
    updated: true,
    config: {
      enabled: updated.enabled,
      username: updated.username,
      minConfidenceToNotify: updated.minConfidenceToNotify,
      includeReasoning: updated.includeReasoning,
      maxMessagesPerMinute: updated.maxMessagesPerMinute,
    },
  });
});

// ---------------------------------------------------------------------------
// POST /notify/trade — Manual trade notification
// ---------------------------------------------------------------------------

discordRoutes.post("/notify/trade", async (c) => {
  const body = await c.req.json<TradeNotification>();
  const sent = await notifyTradeExecution(body);
  return c.json({ sent });
});

// ---------------------------------------------------------------------------
// POST /notify/round-summary — Manual round summary notification
// ---------------------------------------------------------------------------

discordRoutes.post("/notify/round-summary", async (c) => {
  const body = await c.req.json<RoundSummaryNotification>();
  const sent = await notifyRoundSummary(body);
  return c.json({ sent });
});

// ---------------------------------------------------------------------------
// POST /notify/system-alert — Manual system alert
// ---------------------------------------------------------------------------

discordRoutes.post("/notify/system-alert", async (c) => {
  const body = await c.req.json<{
    title: string;
    description: string;
    severity: "info" | "warning" | "critical";
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }>();
  const sent = await notifySystemAlert(body);
  return c.json({ sent });
});
