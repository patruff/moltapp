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
import { signalRoutes } from "./routes/signals.ts";
import { reputationRoutes } from "./routes/reputation.ts";
import { tournamentRoutes } from "./routes/tournaments.ts";
import { paymentRoutes } from "./routes/payments.ts";
import { backtestRoutes } from "./routes/backtesting.ts";
import { marketRegimeRoutes } from "./routes/market-regime.ts";
import { debateRoutes } from "./routes/debates.ts";
import { optimizerRoutes } from "./routes/portfolio-optimizer.ts";
import { whaleRoutes } from "./routes/whale-tracker.ts";
import { strategyRoutes } from "./routes/strategies.ts";
import { predictionRoutes } from "./routes/predictions.ts";
import { streamRoutes } from "./routes/stream.ts";
import { attributionRoutes } from "./routes/attribution.ts";
import { sentimentRoutes } from "./routes/sentiment.ts";
import { infraRoutes } from "./routes/infra.ts";
import { adminRoutes } from "./routes/admin.ts";
import { apiDocsRoutes } from "./routes/api-docs.ts";
import { auditRoutes } from "./routes/audit.ts";
import { recoveryRoutes } from "./routes/recovery.ts";
import { alertRoutes } from "./routes/alerts.ts";
import { chainVerifierRoutes } from "./routes/chain-verifier.ts";
import { decisionReplayRoutes } from "./routes/decision-replay.ts";
import { simulatorRoutes } from "./routes/simulator.ts";
import { competitionRoutes } from "./routes/competition.tsx";
import { executionRoutes } from "./routes/execution.ts";
import { performanceRoutes } from "./routes/performance.ts";
import { marketDataRoutes } from "./routes/market-data.ts";
import { consensusRoutes } from "./routes/consensus.ts";
import { rebalancerRoutes } from "./routes/rebalancer.ts";
import { memoryRoutes } from "./routes/memory.ts";
import { hardeningRoutes } from "./routes/hardening.ts";
import { roundHistoryRoutes } from "./routes/round-history.ts";
import { riskAnalysisRoutes } from "./routes/risk-analysis.ts";
import { reconciliationRoutes } from "./routes/reconciliation.ts";
import { realtimePriceRoutes } from "./routes/realtime-prices.ts";
import { orderRoutes } from "./routes/orders.ts";
import { learningRoutes } from "./routes/learning.ts";
import { tradeProofRoutes } from "./routes/trade-proofs.ts";
import { priceValidatorRoutes } from "./routes/price-validator.ts";
import { discordRoutes } from "./routes/discord.ts";
import { marketHoursRoutes } from "./routes/market-hours.ts";
import { slippageRoutes } from "./routes/slippage.ts";
import { lifecycleRoutes } from "./routes/lifecycle.ts";
import { analyticsRoutes } from "./routes/analytics.ts";
import { walletProvisioningRoutes } from "./routes/wallet-provisioning.ts";
import { newsRoutes } from "./routes/news.ts";
import { monitorRoutes } from "./routes/monitor.tsx";
import { globalErrorHandler, notFoundHandler } from "./middleware/error-handler.ts";
import { initializeNewsProviders } from "./services/news-init.ts";

type AppEnv = {
  Variables: {
    agentId: string;
  };
};

const app = new Hono<AppEnv>();

// Initialize real news providers (Perplexity/Alpha Vantage) if API keys are set
initializeNewsProviders();

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

// Signal Intelligence (public -- technical indicators, alerts, consensus)
app.route("/api/v1/signals", signalRoutes);

// Agent Reputation & Trust (public -- ELO ratings, badges, calibration)
app.route("/api/v1/reputation", reputationRoutes);

// Tournament System (public -- daily sprints, weekly showdowns, championships)
app.route("/api/v1/tournaments", tournamentRoutes);

// Agent Payments & Tipping (public -- tip agents, earnings, leaderboard)
app.route("/api/v1/payments", paymentRoutes);

// Strategy Backtesting (public -- simulate strategies against historical data)
app.route("/api/v1/backtest", backtestRoutes);

// Market Regime Detection (public -- regime classification, volatility, breadth)
app.route("/api/v1/market", marketRegimeRoutes);

// Agent Debates (public -- structured arguments about trades)
app.route("/api/v1/debates", debateRoutes);

// Portfolio Optimizer (public -- Markowitz optimization, Kelly criterion, risk parity)
app.route("/api/v1/optimizer", optimizerRoutes);

// Whale Tracker (public -- large position alerts, conviction spikes, smart money flow)
app.route("/api/v1/whales", whaleRoutes);

// Strategy Marketplace (public -- publish, fork, adopt, rate trading strategies)
app.route("/api/v1/strategies", strategyRoutes);

// Prediction Markets (public -- agent predictions, AMM betting, leaderboard)
app.route("/api/v1/predictions", predictionRoutes);

// Real-Time Event Stream (public -- SSE live feed, recent events, stream stats)
app.route("/api/v1/stream", streamRoutes);

// Performance Attribution (public -- Brinson-Fachler, factor analysis, alpha/beta, risk)
app.route("/api/v1/attribution", attributionRoutes);

// Sentiment Analysis (public -- market mood, news digest, agent sentiment, correlation)
app.route("/api/v1/sentiment", sentimentRoutes);

// Trading Infrastructure (public -- lock status, circuit breakers, rate limiters, wallets)
app.route("/api/v1/infra", infraRoutes);

// Audit Log (public -- compliance trail, event history)
app.route("/api/v1/audit", auditRoutes);

// Trade Recovery (public -- failed trade status, dead letter queue)
app.route("/api/v1/recovery", recoveryRoutes);

// Alert & Webhook Subscriptions (public -- manage alert webhooks, view events)
app.route("/api/v1/alerts", alertRoutes);

// On-Chain Verification (public -- verify trades on Solana, generate proofs)
app.route("/api/v1/verify", chainVerifierRoutes);

// Decision Replay (public -- replay past decisions with full context)
app.route("/api/v1/replay", decisionReplayRoutes);

// Portfolio Simulator (public -- simulate copy-trading agents)
app.route("/api/v1/simulator", simulatorRoutes);

// Trade Execution Engine (public -- execution pipeline status, recovery, retry)
app.route("/api/v1/execution", executionRoutes);

// Agent Performance Analytics (public -- P&L, risk metrics, leaderboard, comparison)
app.route("/api/v1/performance", performanceRoutes);

// Market Data Aggregator (public -- prices, indicators, candles, breadth, correlations)
app.route("/api/v1/market-data", marketDataRoutes);

// Multi-Agent Consensus Engine (public -- consensus signals, accuracy, agreement matrix)
app.route("/api/v1/consensus", consensusRoutes);

// Portfolio Rebalancer (public -- optimization proposals, strategy comparison)
app.route("/api/v1/rebalancer", rebalancerRoutes);

// Agent Memory & Learning (public -- trade memories, patterns, stock knowledge)
app.route("/api/v1/memory", memoryRoutes);

// Production Hardening (public -- health, emergency controls, risk, feedback, logging)
app.route("/api/v1/hardening", hardeningRoutes);

// Trading Round History (public -- round timeline, consensus, agent decisions)
app.route("/api/v1/rounds", roundHistoryRoutes);

// Portfolio Risk Analysis (public -- VaR, stress tests, concentration, risk scores)
app.route("/api/v1/risk", riskAnalysisRoutes);

// Position Reconciliation (public -- on-chain position verification)
app.route("/api/v1/reconcile", reconciliationRoutes);

// Real-Time Price Stream (public -- WebSocket prices, VWAP, price history)
app.route("/api/v1/realtime", realtimePriceRoutes);

// Advanced Orders (public -- limit, stop-loss, trailing stop, bracket orders)
app.route("/api/v1/orders", orderRoutes);

// Agent Learning (public -- calibration, patterns, adaptive risk, feedback loop)
app.route("/api/v1/learning", learningRoutes);

// Trade Proofs (public -- cryptographic proof of trades, Merkle verification)
app.route("/api/v1/proofs", tradeProofRoutes);

// Price Validator (public -- multi-source validation, slippage protection)
app.route("/api/v1/price-validator", priceValidatorRoutes);

// Discord Notifications (public -- webhook config, test, manual notifications)
app.route("/api/v1/discord", discordRoutes);

// Market Hours (public -- session info, schedule, holidays, trading policy)
app.route("/api/v1/market-hours", marketHoursRoutes);

// Slippage Analytics (public -- slippage stats, anomalies, agent/stock profiles)
app.route("/api/v1/slippage", slippageRoutes);

// Lifecycle & Deep Health (public -- readiness, deep health, metrics)
app.route("/api/v1/lifecycle", lifecycleRoutes);

// Portfolio Analytics (public -- Sharpe, drawdown, win rate, equity curves, comparisons)
app.route("/api/v1/analytics", analyticsRoutes);

// Wallet Provisioning (public -- Turnkey wallet creation, health checks)
app.route("/api/v1/wallets", walletProvisioningRoutes);

// News & Market Intelligence (public -- real news APIs, cache management)
app.route("/api/v1/news", newsRoutes);

// Trading Monitor Dashboard (public -- real-time charts, agent comparison)
app.route("/monitor", monitorRoutes);

// Admin Dashboard (self-authenticated via X-Admin-Password)
app.route("/admin", adminRoutes);

// API Documentation (public -- Swagger UI, OpenAPI spec)
app.route("/api-docs", apiDocsRoutes);

// Arena web dashboard (public)
app.route("/arena", arenaPageRoutes);

// Live Competition Dashboard (public -- real-time agent battle view)
app.route("/compete", competitionRoutes);

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
