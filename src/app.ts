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
import { snapshotRoutes } from "./routes/snapshots.ts";
import { startupHealthRoutes } from "./routes/startup-health.ts";
import { scoringRoutes } from "./routes/scoring.ts";
import { fingerprintRoutes } from "./routes/fingerprints.ts";
import { sessionReplayRoutes } from "./routes/session-replay.ts";
import { observabilityRoutes } from "./routes/observability.ts";
import { strategyTunerRoutes } from "./routes/strategy-tuner.ts";
import { crossAgentRoutes } from "./routes/cross-agent.ts";
import { roundAnalyticsRoutes } from "./routes/round-analytics.ts";
import { autonomousRunnerRoutes } from "./routes/autonomous-runner.ts";
import { liveDashboardRoutes } from "./routes/live-dashboard.ts";
import { deliberationRoutes } from "./routes/deliberation.ts";
import { riskLeaderboardRoutes } from "./routes/risk-leaderboard.ts";
import { benchmarkRoutes } from "./routes/benchmark.ts";
import { yieldRoutes } from "./routes/yield.ts";
import { agentComparisonRoutes } from "./routes/agent-comparison.ts";
import { triggerRoundRoutes } from "./routes/trigger-round.ts";
import { tradeStreamRoutes } from "./routes/trade-stream.ts";
import { battleDashboardRoutes } from "./routes/battle-dashboard.tsx";
import { personalityEvolutionRoutes } from "./routes/personality-evolution.ts";
import { monteCarloRoutes } from "./routes/monte-carlo.ts";
import { correlationMonitorRoutes } from "./routes/correlation-monitor.ts";
import { competitionReplayRoutes } from "./routes/competition-replay.ts";
import { tokenFlowRoutes } from "./routes/token-flows.ts";
import { brainFeedRoutes } from "./routes/brain-feed.ts";
import { benchmarkDashboardRoutes } from "./routes/benchmark-dashboard.ts";
import { outcomeTrackingRoutes } from "./routes/outcome-tracking.ts";
import { benchmarkApiRoutes } from "./routes/benchmark-api.ts";
import { benchmarkScoringRoutes } from "./routes/benchmark-scoring.ts";
import { reasoningTimelineRoutes } from "./routes/reasoning-timeline.ts";
import { agentReportRoutes } from "./routes/agent-reports.ts";
import { benchmarkCertificationRoutes } from "./routes/benchmark-certification.ts";
import { reasoningDuelRoutes } from "./routes/reasoning-duel.ts";
import { benchmarkExportRoutes } from "./routes/benchmark-export.ts";
import { benchmarkComparisonRoutes } from "./routes/benchmark-comparison.ts";
import { benchmarkStreamRoutes } from "./routes/benchmark-stream.ts";
import { benchmarkResearchRoutes } from "./routes/benchmark-research.ts";
import { benchmarkMethodologyRoutes } from "./routes/benchmark-methodology.ts";
import { benchmarkSubmissionRoutes } from "./routes/benchmark-submission.ts";
import { benchmarkLiveRoutes } from "./routes/benchmark-live.ts";
import { benchmarkResearchPortalRoutes } from "./routes/benchmark-research-portal.ts";
import { reasoningExplorerRoutes } from "./routes/reasoning-explorer.ts";
import { benchmarkGovernanceRoutes } from "./routes/benchmark-governance.ts";
import { benchmarkUnifiedRoutes } from "./routes/benchmark-unified.ts";
import { benchmarkLandingRoutes } from "./routes/benchmark-landing.tsx";
import { reasoningEnforcedTradingRoutes } from "./routes/reasoning-enforced-trading.ts";
import { benchmarkLeaderboardRoutes } from "./routes/benchmark-leaderboard.tsx";
import { benchmarkEvidenceRoutes } from "./routes/benchmark-evidence.ts";
import { benchmarkV9Routes } from "./routes/benchmark-v9.tsx";
import { benchmarkResearcherApiRoutes } from "./routes/benchmark-researcher-api.ts";
import { benchmarkV10Routes } from "./routes/benchmark-v10.tsx";
import { benchmarkAnalyticsRoutes } from "./routes/benchmark-analytics.ts";
import { benchmarkV11Routes } from "./routes/benchmark-v11.tsx";
import { forensicApiRoutes } from "./routes/forensic-api.ts";
import { benchmarkV12Routes } from "./routes/benchmark-v12.tsx";
import { benchmarkV12ApiRoutes } from "./routes/benchmark-v12-api.ts";
import { benchmarkV13Routes } from "./routes/benchmark-v13.tsx";
import { benchmarkV13ApiRoutes } from "./routes/benchmark-v13-api.ts";
import { benchmarkV14Routes } from "./routes/benchmark-v14.tsx";
import { benchmarkV14ApiRoutes } from "./routes/benchmark-v14-api.ts";
import { benchmarkV15Routes } from "./routes/benchmark-v15.tsx";
import { benchmarkV15ApiRoutes } from "./routes/benchmark-v15-api.ts";
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

// Portfolio Snapshots (public -- historical P&L, equity curves, drawdown analysis)
app.route("/api/v1/snapshots", snapshotRoutes);

// Deep Health Check (public -- validates all dependencies: DB, Solana, Jupiter, LLMs)
app.route("/api/v1/health-deep", startupHealthRoutes);

// Competition Scoring (public -- multi-factor scoring, leaderboard, head-to-head)
app.route("/api/v1/scoring", scoringRoutes);

// Agent Behavioral Fingerprints (public -- behavior patterns, similarity, correlation)
app.route("/api/v1/fingerprints", fingerprintRoutes);

// Trading Session Replay (public -- DVR for AI trading rounds)
app.route("/api/v1/session-replay", sessionReplayRoutes);

// Observability (public -- metrics, health gate, DB seeder, Prometheus)
app.route("/api/v1/observability", observabilityRoutes);

// Strategy Tuner (public -- adaptive agent parameter tuning)
app.route("/api/v1/strategy-tuner", strategyTunerRoutes);

// Cross-Agent Analysis (public -- herding, contrarian, correlation, drift)
app.route("/api/v1/cross-agent", crossAgentRoutes);

// Round Analytics (public -- deep post-round analysis, trends, quality scores)
app.route("/api/v1/round-analytics", roundAnalyticsRoutes);

// Autonomous Runner (public -- start/stop/pause local trading rounds)
app.route("/api/v1/runner", autonomousRunnerRoutes);

// Live Dashboard Data (public -- aggregated dashboard snapshot)
app.route("/api/v1/dashboard", liveDashboardRoutes);

// Pre-Trade Deliberation (public -- multi-agent debate before trading)
app.route("/api/v1/deliberation", deliberationRoutes);

// Risk-Adjusted Leaderboard (public -- Sharpe/Sortino ranked agents)
app.route("/api/v1/risk-leaderboard", riskLeaderboardRoutes);

// Benchmark Comparison (public -- agents vs SPY buy-and-hold)
app.route("/api/v1/benchmark", benchmarkRoutes);

// DeFi Yield Optimizer (public -- idle USDC yield management)
app.route("/api/v1/yield", yieldRoutes);

// Agent Comparison Engine (public -- head-to-head analytics, rankings, style analysis)
app.route("/api/v1/comparison", agentComparisonRoutes);

// Trigger Round (public -- on-demand trading round for demos/judges)
app.route("/api/v1/trigger", triggerRoundRoutes);

// Trade Stream (public -- SSE real-time trading events)
app.route("/api/v1/trade-stream", tradeStreamRoutes);

// Personality Evolution (public -- track how agent personalities evolve over time)
app.route("/api/v1/personality", personalityEvolutionRoutes);

// Monte Carlo Simulations (public -- probabilistic outcome forecasting)
app.route("/api/v1/monte-carlo", monteCarloRoutes);

// Agent Correlation Monitor (public -- herding, divergence, regime analysis)
app.route("/api/v1/correlation", correlationMonitorRoutes);

// Competition Replay (public -- narrative, decision trees, key moments)
app.route("/api/v1/competition-replay", competitionReplayRoutes);

// Token Flow Analysis (public -- flow summaries, heatmaps, market impact)
app.route("/api/v1/token-flows", tokenFlowRoutes);

// Brain Feed (public -- live stream of agent reasoning, coherence scores)
app.route("/api/v1/brain-feed", brainFeedRoutes);

// Outcome Tracking (public -- trade outcomes, confidence calibration, quality gate)
app.route("/api/v1/outcomes", outcomeTrackingRoutes);

// Benchmark Dashboard (public -- AI trading benchmark with HuggingFace integration)
app.route("/benchmark-dashboard", benchmarkDashboardRoutes);

// Benchmark API (public -- researcher-facing data export, diffs, attribution, profiles)
app.route("/api/v1/benchmark-data", benchmarkApiRoutes);

// Benchmark Scoring Engine (public -- v3 composite scores, grades, factor analysis)
app.route("/api/v1/scoring-engine", benchmarkScoringRoutes);

// Reasoning Timeline (public -- how agent reasoning evolves over time)
app.route("/api/v1/timeline", reasoningTimelineRoutes);

// Agent Intelligence Reports (public -- scouting reports, strengths/weaknesses)
app.route("/api/v1/reports", agentReportRoutes);

// Benchmark Certification (public -- verifiable benchmark proofs, methodology)
app.route("/api/v1/certification", benchmarkCertificationRoutes);

// Reasoning Duels (public -- side-by-side agent reasoning comparisons)
app.route("/api/v1/duels", reasoningDuelRoutes);

// Benchmark Export (public -- researcher-facing JSONL, CSV, summary, dataset card)
app.route("/api/v1/export", benchmarkExportRoutes);

// Benchmark Comparison (public -- head-to-head, rankings, dominance matrix, statistical tests)
app.route("/api/v1/compare", benchmarkComparisonRoutes);

// Benchmark Stream (public -- SSE live stream of benchmark events: reasoning, scoring, reviews)
app.route("/api/v1/benchmark-stream", benchmarkStreamRoutes);

// Benchmark Research API (public -- structured queries for researchers, statistical tests, reproducibility)
app.route("/api/v1/research", benchmarkResearchRoutes);

// Benchmark Methodology (public -- scoring methodology, deep analysis, reproducibility)
app.route("/api/v1/methodology", benchmarkMethodologyRoutes);

// Benchmark Submission (public -- external agents submit trades for scoring)
app.route("/api/v1/benchmark-submit", benchmarkSubmissionRoutes);

// Live Benchmark Page (public -- industry-standard leaderboard at /benchmark)
app.route("/benchmark", benchmarkLiveRoutes);

// Research Portal (public -- structured dataset download, statistics, hypothesis testing)
app.route("/api/v1/research-portal", benchmarkResearchPortalRoutes);

// Reasoning Explorer (public -- search, similarity, trends, vocabulary analysis)
app.route("/api/v1/reasoning-explorer", reasoningExplorerRoutes);

// Benchmark Governance (public -- provenance chain, audit trail, rankings, DNA, drift)
app.route("/api/v1/governance", benchmarkGovernanceRoutes);

// Benchmark v7 Unified API (public -- gateway, leaderboard, submissions, dataset export)
app.route("/api/v1/benchmark-v7", benchmarkUnifiedRoutes);

// Benchmark v7 Landing Page (public -- industry-standard benchmark page)
app.route("/benchmark-v7", benchmarkLandingRoutes);

// Reasoning-Enforced Trading (public -- submit trades with validated reasoning)
app.route("/api/v1/trade-with-reasoning", reasoningEnforcedTradingRoutes);

// Benchmark Leaderboard v8 (public -- industry-standard leaderboard + brain feed)
app.route("/benchmark-leaderboard", benchmarkLeaderboardRoutes);

// Benchmark Evidence (public -- evidence collector API for researchers)
app.route("/api/v1/evidence", benchmarkEvidenceRoutes);

// Benchmark v9 Dashboard (public -- regime-aware 5-pillar scoring, integrity, researcher API)
app.route("/benchmark-v9", benchmarkV9Routes);

// Benchmark Researcher API (public -- ML researcher exports, integrity, reproducibility)
app.route("/api/v1/researcher", benchmarkResearcherApiRoutes);

// Benchmark v10 Dashboard (public -- 6-pillar scoring, calibration, pattern analysis)
app.route("/benchmark-v10", benchmarkV10Routes);

// Benchmark Analytics API (public -- calibration, pattern analysis, benchmark health)
app.route("/api/v1/benchmark-analytics", benchmarkAnalyticsRoutes);

// Benchmark v11 Dashboard (public -- 7-pillar scoring, forensic quality analysis)
app.route("/benchmark-v11", benchmarkV11Routes);

// Forensic API (public -- researcher-facing forensic analysis, CSV/JSONL exports)
app.route("/api/v1/forensic", forensicApiRoutes);

// Benchmark v12 Dashboard (public -- 8-pillar scoring, taxonomy, consistency)
app.route("/benchmark-v12", benchmarkV12Routes);

// Benchmark v12 API (public -- researcher-facing taxonomy, consistency, validation)
app.route("/api/v1/benchmark-v12", benchmarkV12ApiRoutes);

// Benchmark v13 Battle Dashboard (public -- head-to-head agent battle arena)
app.route("/benchmark-v13", benchmarkV13Routes);

// Benchmark v13 Battle API (public -- battles, Elo, reasoning comparisons, exports)
app.route("/api/v1/benchmark-v13", benchmarkV13ApiRoutes);

// Benchmark v14 Dashboard (public -- 10-pillar scoring, outcome resolution, calibration)
app.route("/benchmark-v14", benchmarkV14Routes);

// Benchmark v14 API (public -- predictions, calibration, volatility, consensus, exports)
app.route("/api/v1/benchmark-v14", benchmarkV14ApiRoutes);

// Benchmark v15 Dashboard (public -- 12-pillar scoring, provenance, cross-model, reproducibility)
app.route("/benchmark-v15", benchmarkV15Routes);

// Benchmark v15 API (public -- provenance chains, fingerprints, reproducibility proofs)
app.route("/api/v1/benchmark-v15", benchmarkV15ApiRoutes);

// Battle Dashboard (public -- interactive competition visualization for judges)
app.route("/battle", battleDashboardRoutes);

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
