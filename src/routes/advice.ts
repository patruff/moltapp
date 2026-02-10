/**
 * Paid Financial Advice Routes (x402 Protocol)
 *
 * Agent-to-agent micropayments for financial analysis. External agents
 * pay USDC on Solana via x402 to access MoltApp's top agent analysis.
 *
 * Free routes (discovery):
 *   GET  /api/v1/advice/skill.md       — Machine-readable service spec
 *   GET  /api/v1/advice/services       — JSON services + pricing
 *   GET  /api/v1/advice/top-agent      — Current top-performing agent
 *   GET  /api/v1/advice/stats          — Public stats
 *
 * Paid routes (x402 gated):
 *   GET  /api/v1/advice/market-analysis    — Top agent's market outlook
 *   GET  /api/v1/advice/meeting-summary    — Meeting of Minds consensus
 *   GET  /api/v1/advice/portfolio-musings  — Portfolio reflections + regrets
 */

import { Hono } from "hono";
import { paymentMiddlewareFromConfig } from "@x402/hono";
import type { Network } from "@x402/hono";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import {
  getAvailableServices,
  getTopAgent,
  getAdviceStats,
  generateMarketAnalysis,
  generateMeetingSummary,
  generateMusingsSummary,
  generateSkillMd,
  recordAdviceRequest,
  ADVICE_PRICE_USDC,
  ADVICE_WALLET,
  getSolanaNetwork,
} from "../services/paid-advice.ts";
import { errorMessage } from "../lib/errors.ts";

export const adviceRoutes = new Hono();

// ---------------------------------------------------------------------------
// x402 Payment Middleware Configuration
// ---------------------------------------------------------------------------

const SOLANA_NETWORK = getSolanaNetwork() as Network;

const x402Routes = {
  "GET /market-analysis": {
    accepts: [
      {
        scheme: "exact",
        price: ADVICE_PRICE_USDC,
        network: SOLANA_NETWORK,
        payTo: ADVICE_WALLET,
      },
    ],
    description: "Market analysis from MoltApp's top-performing AI trading agent",
    mimeType: "application/json",
  },
  "GET /meeting-summary": {
    accepts: [
      {
        scheme: "exact",
        price: ADVICE_PRICE_USDC,
        network: SOLANA_NETWORK,
        payTo: ADVICE_WALLET,
      },
    ],
    description: "Multi-agent debate consensus from 4 frontier AI models",
    mimeType: "application/json",
  },
  "GET /portfolio-musings": {
    accepts: [
      {
        scheme: "exact",
        price: ADVICE_PRICE_USDC,
        network: SOLANA_NETWORK,
        payTo: ADVICE_WALLET,
      },
    ],
    description: "AI agent portfolio reflections, ideal allocations, and regret analysis",
    mimeType: "application/json",
  },
};

// Initialize x402 facilitator and middleware
// Uses the public facilitator (no API key needed for testnet)
const facilitatorUrl =
  process.env.X402_FACILITATOR_URL || "https://x402.org/facilitator";

const facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorUrl });

const svmScheme = new ExactSvmScheme();

// Apply x402 payment middleware to paid routes
// This intercepts requests, returns 402 if unpaid, verifies payment, then passes through
if (ADVICE_WALLET) {
  adviceRoutes.use(
    "*",
    paymentMiddlewareFromConfig(
      x402Routes,
      facilitatorClient,
      [{ network: SOLANA_NETWORK, server: svmScheme }],
    ),
  );
} else {
  console.warn(
    "[PaidAdvice] No ADVICE_WALLET_PUBLIC or ONBOARD_WALLET_PUBLIC set — " +
    "x402 payment middleware disabled. Paid endpoints will return data for free.",
  );
}

// ---------------------------------------------------------------------------
// Free Routes (No Payment Required)
// ---------------------------------------------------------------------------

/**
 * GET /skill.md — Machine-readable service spec for agent discovery
 */
adviceRoutes.get("/skill.md", (c) => {
  c.header("Content-Type", "text/markdown; charset=utf-8");
  return c.text(generateSkillMd());
});

/**
 * GET /services — JSON list of available services with pricing
 */
adviceRoutes.get("/services", (c) => {
  return c.json({
    services: getAvailableServices(),
    paymentProtocol: "x402",
    network: SOLANA_NETWORK,
    payTo: ADVICE_WALLET || null,
    facilitator: facilitatorUrl,
  });
});

/**
 * GET /top-agent — Which agent is currently top-performing
 */
adviceRoutes.get("/top-agent", (c) => {
  const top = getTopAgent();
  if (!top) {
    return c.json({ error: "no_agents", details: "No agents configured" }, 404);
  }
  return c.json({
    agentId: top.agentId,
    name: top.name,
    note: "Top agent is selected by win rate + calibration score",
  });
});

/**
 * GET /stats — Public stats about the advice service
 */
adviceRoutes.get("/stats", (c) => {
  return c.json(getAdviceStats());
});

// ---------------------------------------------------------------------------
// Paid Routes (x402 Gated — payment handled by middleware)
// ---------------------------------------------------------------------------

/**
 * GET /market-analysis — Top agent's current market outlook
 * Query param: ?symbol=TSLAx (optional, filter by stock)
 */
adviceRoutes.get("/market-analysis", (c) => {
  try {
    const symbol = c.req.query("symbol") || undefined;
    const response = generateMarketAnalysis(symbol);
    recordAdviceRequest("market-analysis", response);
    return c.json(response);
  } catch (error) {
    console.error("[PaidAdvice] Market analysis error:", error);
    return c.json(
      { error: "generation_error", details: errorMessage(error) },
      500,
    );
  }
});

/**
 * GET /meeting-summary — Latest Meeting of Minds consensus
 */
adviceRoutes.get("/meeting-summary", (c) => {
  try {
    const response = generateMeetingSummary();
    recordAdviceRequest("meeting-summary", response);
    return c.json(response);
  } catch (error) {
    console.error("[PaidAdvice] Meeting summary error:", error);
    return c.json(
      { error: "generation_error", details: errorMessage(error) },
      500,
    );
  }
});

/**
 * GET /portfolio-musings — Latest portfolio reflections
 */
adviceRoutes.get("/portfolio-musings", (c) => {
  try {
    const response = generateMusingsSummary();
    recordAdviceRequest("portfolio-musings", response);
    return c.json(response);
  } catch (error) {
    console.error("[PaidAdvice] Portfolio musings error:", error);
    return c.json(
      { error: "generation_error", details: errorMessage(error) },
      500,
    );
  }
});
