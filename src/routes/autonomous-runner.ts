/**
 * Autonomous Runner API Routes
 *
 * Control the local autonomous trading round runner via HTTP API.
 * Start, stop, pause, resume, and monitor trading rounds.
 */

import { Hono } from "hono";
import {
  startAutonomousRunner,
  stopAutonomousRunner,
  pauseRunner,
  resumeRunner,
  triggerManualRound,
  getRunnerStatus,
  getRoundHistory,
  getRunnerStats,
} from "../services/autonomous-runner.ts";

const app = new Hono();

/** GET /status — current runner status, config, and stats */
app.get("/status", (c) => {
  const status = getRunnerStatus();
  const stats = getRunnerStats();
  return c.json({ ...status, stats });
});

/** GET /stats — aggregate runner statistics */
app.get("/stats", (c) => {
  return c.json(getRunnerStats());
});

/** POST /start — start the autonomous runner */
app.post("/start", async (c) => {
  let userConfig: Record<string, unknown> = {};
  try {
    userConfig = await c.req.json();
  } catch {
    // No body is fine, use defaults
  }

  const result = startAutonomousRunner({
    intervalMs:
      typeof userConfig.intervalMs === "number"
        ? userConfig.intervalMs
        : undefined,
    maxConsecutiveFailures:
      typeof userConfig.maxConsecutiveFailures === "number"
        ? userConfig.maxConsecutiveFailures
        : undefined,
    runImmediately:
      typeof userConfig.runImmediately === "boolean"
        ? userConfig.runImmediately
        : undefined,
    enableAnalytics:
      typeof userConfig.enableAnalytics === "boolean"
        ? userConfig.enableAnalytics
        : undefined,
    respectMarketHours:
      typeof userConfig.respectMarketHours === "boolean"
        ? userConfig.respectMarketHours
        : undefined,
  });

  return c.json(result);
});

/** POST /stop — stop the runner gracefully */
app.post("/stop", (c) => {
  const result = stopAutonomousRunner();
  return c.json(result);
});

/** POST /pause — pause the runner */
app.post("/pause", async (c) => {
  let reason: string | undefined;
  try {
    const body = await c.req.json();
    reason = body.reason;
  } catch {
    // No body
  }
  const result = pauseRunner(reason);
  return c.json(result);
});

/** POST /resume — resume a paused runner */
app.post("/resume", (c) => {
  const result = resumeRunner();
  return c.json(result);
});

/** POST /trigger — trigger a single manual round */
app.post("/trigger", async (c) => {
  const result = await triggerManualRound();
  if (!result) {
    return c.json(
      { error: "Could not trigger round — another round may be in progress" },
      409,
    );
  }
  return c.json(result);
});

/** GET /history — round execution history */
app.get("/history", (c) => {
  const limit = parseInt(c.req.query("limit") ?? "50", 10);
  const filter = c.req.query("filter"); // "success" | "failed"

  const history = getRoundHistory({
    limit,
    successOnly: filter === "success",
    failedOnly: filter === "failed",
  });

  return c.json({ history, count: history.length });
});

/** GET /history/:roundId — details for a specific round */
app.get("/history/:roundId", (c) => {
  const roundId = c.req.param("roundId");
  const history = getRoundHistory({ limit: 500 });
  const round = history.find((h) => h.roundId === roundId);

  if (!round) {
    return c.json({ error: "Round not found", roundId }, 404);
  }

  return c.json(round);
});

export const autonomousRunnerRoutes = app;
