import { Hono } from "hono";
import { authRoutes } from "./routes/auth.ts";
import { walletRoutes } from "./routes/wallets.ts";
import { webhookRoutes } from "./routes/webhooks.ts";
import { healthRoutes } from "./routes/health.ts";
import { authMiddleware } from "./middleware/auth.ts";
import { agentRateLimiter } from "./middleware/rate-limit.ts";
import { stockRoutes } from "./routes/stocks.ts";
import { tradingRoutes } from "./routes/trading.ts";
import { positionRoutes } from "./routes/positions.ts";
import { tradeRoutes } from "./routes/trades.ts";
import { leaderboardApiRoutes } from "./routes/leaderboard-api.ts";
import { pageRoutes } from "./routes/pages.tsx";
import { demoRoutes } from "./routes/demo.ts";
import { landingRoutes } from "./routes/landing.ts";
import { agentRoutes } from "./routes/agents.ts";
import { feedRoutes } from "./routes/feed.ts";
import { commentRoutes } from "./routes/comments.ts";
import { arenaRoutes } from "./routes/arena.ts";
import { insightsRoutes } from "./routes/insights.ts";
import { copyTradingRoutes } from "./routes/copy-trading.ts";
import { arenaPageRoutes } from "./routes/arena-page.ts";
import { globalErrorHandler, notFoundHandler } from "./middleware/error-handler.ts";

type AppEnv = {
  Variables: {
    agentId: string;
  };
};

const app = new Hono<AppEnv>();

// Global error handling
app.onError(globalErrorHandler);
app.notFound(notFoundHandler);

// Health check (public)
app.route("/health", healthRoutes);

// Landing page (public)
app.route("/landing", landingRoutes);

// Demo trading routes (public -- no auth required)
app.route("/api/demo", demoRoutes);

// AI Agent routes (public -- view agent profiles, stats, decisions)
app.route("/api/v1/agents", agentRoutes);

// Activity feed (public -- view all agent trading activity)
app.route("/api/v1/feed", feedRoutes);

// Trade social routes (public -- comments & reactions on trade decisions)
app.route("/api/v1/decisions", commentRoutes);

// Agent Arena (public -- head-to-head competition, comparisons, simulations)
app.route("/api/v1/arena", arenaRoutes);

// Agent Insights (public -- deep analytics, risk metrics, patterns)
app.route("/api/v1/insights", insightsRoutes);

// Copy Trading (public -- follow agents, track performance, leaderboard)
app.route("/api/v1/copy", copyTradingRoutes);

// Arena web dashboard (public)
app.route("/arena", arenaPageRoutes);

// Public web pages (no auth -- leaderboard and agent profiles)
app.route("/", pageRoutes);

// Auth routes (public -- registration is unauthenticated)
app.route("/api/v1/auth", authRoutes);

// Webhook routes (public -- uses own auth via secret header, NOT behind API key auth)
app.route("/webhooks", webhookRoutes);

// Protected routes: auth middleware + rate limiter
app.use("/api/v1/*", authMiddleware, agentRateLimiter);

// Wallet routes (protected)
app.route("/api/v1/wallet", walletRoutes);

// Stock discovery routes (protected)
app.route("/api/v1/stocks", stockRoutes);

// Trading routes (protected)
app.route("/api/v1/trading", tradingRoutes);

// Position routes (protected)
app.route("/api/v1/positions", positionRoutes);

// Trade history routes (protected)
app.route("/api/v1/trades", tradeRoutes);

// Leaderboard API routes (protected)
app.route("/api/v1/leaderboard", leaderboardApiRoutes);

// Placeholder: GET /api/v1/me (protected, for testing auth middleware)
app.get("/api/v1/me", (c) => {
  return c.json({ agentId: c.get("agentId") });
});

export default app;
