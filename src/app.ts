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

type AppEnv = {
  Variables: {
    agentId: string;
  };
};

const app = new Hono<AppEnv>();

// Health check (public)
app.route("/health", healthRoutes);

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
