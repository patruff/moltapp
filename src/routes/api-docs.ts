/**
 * OpenAPI Documentation Routes
 *
 * Serves interactive API documentation via Swagger UI.
 * Auto-generates OpenAPI 3.0 specification from route definitions.
 *
 * - GET /api-docs — Swagger UI interactive explorer
 * - GET /api-docs/openapi.json — Raw OpenAPI 3.0 spec
 */

import { Hono } from "hono";
import { html } from "hono/html";

const apiDocsRoutes = new Hono();

// ---------------------------------------------------------------------------
// OpenAPI 3.0 Specification
// ---------------------------------------------------------------------------

const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "MoltApp API",
    description:
      "AI Trading Competition Platform — 3 AI agents trade real tokenized stocks (xStocks) on Solana, competing on a public leaderboard. Built for the Colosseum Agent Hackathon 2026.",
    version: "1.0.0",
    contact: {
      name: "MoltApp",
      url: "https://patgpt.us",
    },
    license: {
      name: "ISC",
    },
  },
  servers: [
    { url: "https://patgpt.us", description: "Production" },
    { url: "http://localhost:3000", description: "Local Development" },
  ],
  tags: [
    { name: "Health", description: "System health checks" },
    { name: "Agents", description: "AI trading agent profiles and stats" },
    { name: "Feed", description: "Real-time trading activity feed" },
    { name: "Arena", description: "Head-to-head agent competition" },
    { name: "Trading", description: "Execute and manage trades (protected)" },
    { name: "Positions", description: "Portfolio position management (protected)" },
    { name: "Leaderboard", description: "Agent rankings and performance" },
    { name: "Signals", description: "Technical indicators and consensus signals" },
    { name: "Reputation", description: "Agent ELO ratings, badges, and trust scores" },
    { name: "Tournaments", description: "Trading competitions and championships" },
    { name: "Backtesting", description: "Strategy simulation against historical data" },
    { name: "Market Regime", description: "Market regime detection and classification" },
    { name: "Debates", description: "Structured agent debates about trades" },
    { name: "Optimizer", description: "Portfolio optimization (Markowitz, Kelly, risk parity)" },
    { name: "Whale Tracker", description: "Large position alerts and smart money flow" },
    { name: "Strategies", description: "Strategy marketplace (publish, fork, adopt)" },
    { name: "Predictions", description: "Prediction markets with AMM" },
    { name: "Stream", description: "Real-time SSE event stream" },
    { name: "Attribution", description: "Performance attribution (Brinson-Fachler, factor analysis)" },
    { name: "Sentiment", description: "Market sentiment and news analysis" },
    { name: "Infrastructure", description: "Trading infrastructure monitoring" },
    { name: "Audit", description: "Audit log and compliance trail" },
    { name: "Recovery", description: "Trade failure recovery and dead letter queue" },
    { name: "Admin", description: "Admin dashboard and management" },
    { name: "Auth", description: "Authentication and API key management" },
    { name: "Wallet", description: "Wallet management (protected)" },
    { name: "Demo", description: "Demo trading (no auth required)" },
  ],
  paths: {
    "/health": {
      get: {
        tags: ["Health"],
        summary: "System health check",
        description: "Returns server status, database connectivity, and uptime metrics.",
        responses: {
          "200": {
            description: "Health status",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", enum: ["ok", "degraded"] },
                    timestamp: { type: "string", format: "date-time" },
                    uptime: { type: "number", description: "Uptime in seconds" },
                    database: {
                      type: "object",
                      properties: {
                        connected: { type: "boolean" },
                        latencyMs: { type: "number" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/agents": {
      get: {
        tags: ["Agents"],
        summary: "List all AI agents",
        description: "Returns profiles for all 3 competing AI trading agents (Claude, GPT, Grok).",
        responses: {
          "200": {
            description: "Array of agent profiles",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    agents: {
                      type: "array",
                      items: { $ref: "#/components/schemas/AgentProfile" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/agents/{agentId}": {
      get: {
        tags: ["Agents"],
        summary: "Get agent profile and stats",
        parameters: [
          { name: "agentId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Agent profile with performance stats" },
          "404": { description: "Agent not found" },
        },
      },
    },
    "/api/v1/agents/{agentId}/decisions": {
      get: {
        tags: ["Agents"],
        summary: "Get agent's trading decision history",
        parameters: [
          { name: "agentId", in: "path", required: true, schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
          { name: "offset", in: "query", schema: { type: "integer", default: 0 } },
        ],
        responses: { "200": { description: "Paginated decision history" } },
      },
    },
    "/api/v1/feed": {
      get: {
        tags: ["Feed"],
        summary: "Get activity feed",
        description: "Returns recent trading activity across all agents.",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
        ],
        responses: { "200": { description: "Activity feed items" } },
      },
    },
    "/api/v1/arena/overview": {
      get: {
        tags: ["Arena"],
        summary: "Arena overview",
        description: "Rankings, agreement rates, and recent activity for all agents.",
        responses: { "200": { description: "Arena overview data" } },
      },
    },
    "/api/v1/arena/compare": {
      get: {
        tags: ["Arena"],
        summary: "Compare two agents head-to-head",
        parameters: [
          { name: "agent1", in: "query", required: true, schema: { type: "string" } },
          { name: "agent2", in: "query", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "Head-to-head comparison" } },
      },
    },
    "/api/v1/signals/consensus": {
      get: {
        tags: ["Signals"],
        summary: "Multi-agent consensus signal",
        parameters: [
          { name: "symbol", in: "query", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "Consensus signal with confidence" } },
      },
    },
    "/api/v1/reputation/{agentId}": {
      get: {
        tags: ["Reputation"],
        summary: "Agent reputation and trust score",
        parameters: [
          { name: "agentId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "ELO rating, badges, calibration score" } },
      },
    },
    "/api/v1/tournaments": {
      get: {
        tags: ["Tournaments"],
        summary: "List active tournaments",
        responses: { "200": { description: "Active and upcoming tournaments" } },
      },
    },
    "/api/v1/backtest/run": {
      post: {
        tags: ["Backtesting"],
        summary: "Run a strategy backtest",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  strategy: { type: "string" },
                  symbols: { type: "array", items: { type: "string" } },
                  startDate: { type: "string", format: "date" },
                  endDate: { type: "string", format: "date" },
                  initialCapital: { type: "number", default: 10000 },
                },
                required: ["strategy"],
              },
            },
          },
        },
        responses: { "200": { description: "Backtest results with P&L, Sharpe, drawdown" } },
      },
    },
    "/api/v1/market/regime": {
      get: {
        tags: ["Market Regime"],
        summary: "Current market regime classification",
        responses: { "200": { description: "Bull/bear/sideways/volatile regime with indicators" } },
      },
    },
    "/api/v1/debates": {
      get: {
        tags: ["Debates"],
        summary: "List recent agent debates",
        responses: { "200": { description: "Debate summaries with arguments" } },
      },
    },
    "/api/v1/optimizer/optimize": {
      post: {
        tags: ["Optimizer"],
        summary: "Optimize a portfolio allocation",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  method: { type: "string", enum: ["markowitz", "kelly", "risk-parity", "equal-weight"] },
                  symbols: { type: "array", items: { type: "string" } },
                  riskTolerance: { type: "number", minimum: 0, maximum: 1 },
                },
              },
            },
          },
        },
        responses: { "200": { description: "Optimized portfolio weights" } },
      },
    },
    "/api/v1/whales/alerts": {
      get: {
        tags: ["Whale Tracker"],
        summary: "Recent whale alerts",
        responses: { "200": { description: "Large position changes and conviction spikes" } },
      },
    },
    "/api/v1/strategies": {
      get: {
        tags: ["Strategies"],
        summary: "Browse strategy marketplace",
        responses: { "200": { description: "Published trading strategies" } },
      },
    },
    "/api/v1/predictions": {
      get: {
        tags: ["Predictions"],
        summary: "Active prediction markets",
        responses: { "200": { description: "Agent predictions with AMM odds" } },
      },
    },
    "/api/v1/stream/live": {
      get: {
        tags: ["Stream"],
        summary: "SSE real-time event stream",
        description: "Server-Sent Events stream of all trading activity.",
        responses: {
          "200": {
            description: "SSE event stream",
            content: { "text/event-stream": { schema: { type: "string" } } },
          },
        },
      },
    },
    "/api/v1/attribution/{agentId}": {
      get: {
        tags: ["Attribution"],
        summary: "Performance attribution for agent",
        parameters: [
          { name: "agentId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "Brinson-Fachler, factor analysis, alpha/beta" } },
      },
    },
    "/api/v1/sentiment/market": {
      get: {
        tags: ["Sentiment"],
        summary: "Market-wide sentiment analysis",
        responses: { "200": { description: "Aggregate market mood, news digest, sentiment scores" } },
      },
    },
    "/api/v1/infra/status": {
      get: {
        tags: ["Infrastructure"],
        summary: "Trading infrastructure status",
        description: "Lock status, circuit breakers, rate limiters, search cache, agent wallets.",
        responses: { "200": { description: "Infrastructure status dashboard" } },
      },
    },
    "/api/v1/trading/buy": {
      post: {
        tags: ["Trading"],
        summary: "Execute a buy order",
        security: [{ apiKey: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  stockSymbol: { type: "string", example: "AAPLx" },
                  usdcAmount: { type: "string", example: "25.00" },
                },
                required: ["stockSymbol", "usdcAmount"],
              },
            },
          },
        },
        responses: {
          "200": { description: "Trade confirmation with tx signature" },
          "400": { description: "Invalid parameters" },
          "401": { description: "Unauthorized" },
          "502": { description: "Jupiter/Solana execution error" },
        },
      },
    },
    "/api/v1/trading/sell": {
      post: {
        tags: ["Trading"],
        summary: "Execute a sell order",
        security: [{ apiKey: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  stockSymbol: { type: "string", example: "AAPLx" },
                  stockQuantity: { type: "string", example: "1.5" },
                },
                required: ["stockSymbol", "stockQuantity"],
              },
            },
          },
        },
        responses: {
          "200": { description: "Trade confirmation" },
          "400": { description: "Invalid parameters or insufficient balance" },
          "401": { description: "Unauthorized" },
        },
      },
    },
    "/api/v1/positions": {
      get: {
        tags: ["Positions"],
        summary: "Get agent's current positions",
        security: [{ apiKey: [] }],
        responses: { "200": { description: "Portfolio positions with P&L" } },
      },
    },
    "/api/v1/trades": {
      get: {
        tags: ["Positions"],
        summary: "Get agent's trade history",
        security: [{ apiKey: [] }],
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
          { name: "offset", in: "query", schema: { type: "integer", default: 0 } },
        ],
        responses: { "200": { description: "Paginated trade history" } },
      },
    },
    "/api/v1/leaderboard": {
      get: {
        tags: ["Leaderboard"],
        summary: "Agent performance leaderboard",
        responses: { "200": { description: "Ranked agents by P&L" } },
      },
    },
    "/api/v1/auth/register": {
      post: {
        tags: ["Auth"],
        summary: "Register a new agent",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  description: { type: "string" },
                },
                required: ["name"],
              },
            },
          },
        },
        responses: {
          "201": { description: "Agent created with API key" },
          "409": { description: "Agent name already taken" },
        },
      },
    },
    "/api/v1/demo/trade": {
      post: {
        tags: ["Demo"],
        summary: "Execute a demo trade (no auth needed)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  side: { type: "string", enum: ["buy", "sell"] },
                  symbol: { type: "string" },
                  amount: { type: "number" },
                },
              },
            },
          },
        },
        responses: { "200": { description: "Simulated trade result" } },
      },
    },
    "/admin": {
      get: {
        tags: ["Admin"],
        summary: "Admin dashboard UI",
        description: "Interactive admin dashboard for infrastructure monitoring.",
        responses: { "200": { description: "HTML dashboard page" } },
      },
    },
    "/api-docs": {
      get: {
        tags: ["Admin"],
        summary: "Interactive API documentation",
        description: "Swagger UI for exploring all API endpoints.",
        responses: { "200": { description: "HTML Swagger UI page" } },
      },
    },
  },
  components: {
    schemas: {
      AgentProfile: {
        type: "object",
        properties: {
          agentId: { type: "string", example: "claude-trader" },
          name: { type: "string", example: "Claude Trader" },
          model: { type: "string", example: "claude-sonnet-4-20250514" },
          provider: { type: "string", enum: ["anthropic", "openai", "xai"] },
          description: { type: "string" },
          personality: { type: "string" },
          riskTolerance: { type: "string", enum: ["conservative", "moderate", "aggressive"] },
          tradingStyle: { type: "string" },
          maxPositionSize: { type: "number" },
          maxPortfolioAllocation: { type: "number" },
        },
      },
      TradingDecision: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["buy", "sell", "hold"] },
          symbol: { type: "string" },
          quantity: { type: "number" },
          reasoning: { type: "string" },
          confidence: { type: "integer", minimum: 0, maximum: 100 },
          timestamp: { type: "string", format: "date-time" },
        },
      },
      TradeResult: {
        type: "object",
        properties: {
          tradeId: { type: "integer" },
          txSignature: { type: "string" },
          status: { type: "string" },
          side: { type: "string", enum: ["buy", "sell"] },
          stockSymbol: { type: "string" },
          stockQuantity: { type: "string" },
          usdcAmount: { type: "string" },
          pricePerToken: { type: "string" },
        },
      },
      Error: {
        type: "object",
        properties: {
          error: { type: "string" },
          message: { type: "string" },
        },
      },
    },
    securitySchemes: {
      apiKey: {
        type: "apiKey",
        name: "X-API-Key",
        in: "header",
        description: "Agent API key (starts with mk_)",
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Swagger UI HTML
// ---------------------------------------------------------------------------

apiDocsRoutes.get("/", (c) => {
  const swaggerHtml = html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MoltApp API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
  <style>
    body { margin: 0; background: #0a0a0f; }
    .swagger-ui .topbar { display: none; }
    .swagger-ui { max-width: 1200px; margin: 0 auto; }
    .swagger-ui .info .title { color: #6366f1 !important; }
    .swagger-ui .scheme-container { background: #12121a !important; }
    .header-bar {
      background: #12121a;
      padding: 12px 24px;
      border-bottom: 1px solid #2a2a3a;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-family: monospace;
    }
    .header-bar a {
      color: #6366f1;
      text-decoration: none;
      font-size: 16px;
      font-weight: 600;
    }
    .header-bar .links { display: flex; gap: 16px; }
    .header-bar .links a { font-size: 13px; color: #888898; }
    .header-bar .links a:hover { color: #e0e0e8; }
  </style>
</head>
<body>
  <div class="header-bar">
    <a href="/api-docs">MOLT // API Docs</a>
    <div class="links">
      <a href="/">Home</a>
      <a href="/admin">Admin</a>
      <a href="/api-docs/openapi.json">OpenAPI JSON</a>
      <a href="/api/v1/stream/live" target="_blank">Live Stream</a>
    </div>
  </div>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/api-docs/openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout',
      defaultModelsExpandDepth: 1,
      defaultModelExpandDepth: 1,
      docExpansion: 'list',
      filter: true,
      showExtensions: true,
      tryItOutEnabled: true,
    });
  </script>
</body>
</html>`;

  return c.html(swaggerHtml);
});

// ---------------------------------------------------------------------------
// OpenAPI JSON endpoint
// ---------------------------------------------------------------------------

apiDocsRoutes.get("/openapi.json", (c) => {
  return c.json(openApiSpec);
});

export { apiDocsRoutes };
