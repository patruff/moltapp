/**
 * Paid Financial Advice Service (Agent-to-Agent Micropayments via x402)
 *
 * MoltApp's top-performing agent sells its analysis to external Colosseum agents.
 * Three services available:
 *   1. Market Analysis — top agent's current outlook + trading signals
 *   2. Meeting of Minds Summary — multi-agent debate consensus
 *   3. Portfolio Musings — agent reflections on ideal portfolios + regrets
 *
 * External agents pay via x402 protocol (USDC on Solana), receiving structured
 * JSON advice immediately. Agents review and fulfill requests in a pre-trade
 * phase before each trading round.
 *
 * Payment flow:
 *   1. GET /api/v1/advice/skill.md — discover services
 *   2. GET /api/v1/advice/services — pricing + wallet
 *   3. Request paid endpoint — x402 handles 402 → payment → content automatically
 */

import { ID_RANDOM_START, ID_RANDOM_LENGTH_STANDARD } from "../config/constants.ts";
import {
  getLatestMeeting,
  type MeetingResult,
} from "./meeting-of-minds.ts";
import {
  getLatestMusings,
  type MusingsResult,
} from "./portfolio-musings.ts";
import { getAgentConfigs } from "../agents/orchestrator.ts";
import type { TradingRoundResult, MarketData } from "../agents/base-agent.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/** Price per advice request in USDC (x402 uses dollar strings like "$0.001") */
export const ADVICE_PRICE_USDC = "$0.001";

/** Solana wallet address that receives advice payments */
export const ADVICE_WALLET =
  process.env.ADVICE_WALLET_PUBLIC ||
  process.env.ONBOARD_WALLET_PUBLIC ||
  "";

/** Solana mainnet network identifier (CAIP-2 format for x402) */
export const SOLANA_MAINNET_NETWORK = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

/** Solana devnet network identifier (CAIP-2 format for x402) */
export const SOLANA_DEVNET_NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

/** Maximum cached requests in history (circular buffer) */
const MAX_CACHED_REQUESTS = 1000;

/**
 * Market Analysis Reasoning Truncation Length
 * Maximum characters of agent reasoning included in paid market analysis responses.
 * Truncates to keep API response payloads manageable while preserving key decision logic.
 * Formula: reasoning.slice(0, MARKET_ANALYSIS_REASONING_TRUNCATION_LENGTH)
 * Example: 2000-char reasoning → truncated to first 500 chars
 */
const MARKET_ANALYSIS_REASONING_TRUNCATION_LENGTH = 500;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdviceService {
  name: string;
  description: string;
  priceUSDC: string;
  endpoint: string;
}

export interface AdviceResponse {
  service: string;
  topAgent: string;
  topAgentWinRate: number;
  analysis: Record<string, unknown>;
  generatedAt: string;
  roundId: string;
}

export interface AdviceRequest {
  id: string;
  service: string;
  requesterAgent: string;
  status: "fulfilled";
  response: AdviceResponse;
  createdAt: string;
}

export interface CachedRoundData {
  roundId: string;
  decisions: TradingRoundResult[];
  meeting: MeetingResult | null;
  musings: MusingsResult | null;
  marketData: MarketData[];
  timestamp: Date;
}

export interface AdviceStats {
  totalRequests: number;
  serviceBreakdown: Record<string, number>;
  latestRoundId: string | null;
  topAgent: string | null;
  upSince: string;
}

// ---------------------------------------------------------------------------
// In-Memory State
// ---------------------------------------------------------------------------

let latestRoundData: CachedRoundData | null = null;
const requestHistory: AdviceRequest[] = [];
const serviceRequestCounts: Record<string, number> = {
  "market-analysis": 0,
  "meeting-summary": 0,
  "portfolio-musings": 0,
};
const startTime = new Date().toISOString();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the 3 available advice services with pricing.
 */
export function getAvailableServices(): AdviceService[] {
  return [
    {
      name: "market-analysis",
      description:
        "Current market outlook from our top-performing agent — trading signals, " +
        "confidence levels, and reasoning for specific stocks.",
      priceUSDC: ADVICE_PRICE_USDC,
      endpoint: "GET /api/v1/advice/market-analysis",
    },
    {
      name: "meeting-summary",
      description:
        "What did 4 frontier AI models agree on? Consensus trades, key " +
        "disagreements, and confidence from the latest Meeting of Minds.",
      priceUSDC: ADVICE_PRICE_USDC,
      endpoint: "GET /api/v1/advice/meeting-summary",
    },
    {
      name: "portfolio-musings",
      description:
        "If our agents had fresh capital, where would they put it? Ideal " +
        "allocations, biggest regrets, and consensus stock picks.",
      priceUSDC: ADVICE_PRICE_USDC,
      endpoint: "GET /api/v1/advice/portfolio-musings",
    },
  ];
}

/**
 * Called by the orchestrator after each trading round to cache latest results.
 */
export function updateLatestRoundData(data: CachedRoundData): void {
  latestRoundData = data;
  console.log(
    `[PaidAdvice] Cached round ${data.roundId} with ${data.decisions.length} agent decisions`,
  );
}

/**
 * Generates market analysis from the top agent's latest decision.
 */
export function generateMarketAnalysis(symbol?: string): AdviceResponse {
  const topAgent = getTopAgent();

  if (!latestRoundData) {
    return {
      service: "market-analysis",
      topAgent: topAgent?.name ?? "unknown",
      topAgentWinRate: 0,
      analysis: {
        status: "no_data",
        message: "No trading round data available yet. Check back after the next round.",
      },
      generatedAt: new Date().toISOString(),
      roundId: "none",
    };
  }

  // Find the top agent's decision (or filter by symbol)
  let agentDecisions = latestRoundData.decisions;
  if (symbol) {
    agentDecisions = agentDecisions.filter(
      (d) => d.decision.symbol.toLowerCase() === symbol.toLowerCase(),
    );
  }

  const topAgentDecision = agentDecisions.find(
    (d) => d.agentId === topAgent?.agentId,
  );

  // Build market summary from all agents
  const signals = latestRoundData.decisions.map((d) => ({
    agent: d.agentName,
    action: d.decision.action,
    symbol: d.decision.symbol,
    confidence: d.decision.confidence,
    reasoning: d.decision.reasoning.slice(0, MARKET_ANALYSIS_REASONING_TRUNCATION_LENGTH),
    executed: d.executed,
  }));

  // Current prices
  const prices = latestRoundData.marketData.map((m) => ({
    symbol: m.symbol,
    price: m.price,
    change24h: m.change24h,
  }));

  return {
    service: "market-analysis",
    topAgent: topAgent?.name ?? "unknown",
    topAgentWinRate: 0, // Would need performance data for real win rate
    analysis: {
      roundId: latestRoundData.roundId,
      timestamp: latestRoundData.timestamp.toISOString(),
      topAgentOutlook: topAgentDecision
        ? {
            action: topAgentDecision.decision.action,
            symbol: topAgentDecision.decision.symbol,
            confidence: topAgentDecision.decision.confidence,
            reasoning: topAgentDecision.decision.reasoning,
            executed: topAgentDecision.executed,
          }
        : null,
      allSignals: signals,
      marketPrices: prices,
      agentCount: latestRoundData.decisions.length,
      ...(symbol ? { filteredSymbol: symbol } : {}),
    },
    generatedAt: new Date().toISOString(),
    roundId: latestRoundData.roundId,
  };
}

/**
 * Generates meeting-of-minds consensus summary.
 */
export function generateMeetingSummary(): AdviceResponse {
  const topAgent = getTopAgent();
  const meeting = latestRoundData?.meeting ?? getLatestMeeting() ?? null;

  if (!meeting) {
    return {
      service: "meeting-summary",
      topAgent: topAgent?.name ?? "unknown",
      topAgentWinRate: 0,
      analysis: {
        status: "no_data",
        message: "No Meeting of Minds data available yet. Check back after the next round.",
      },
      generatedAt: new Date().toISOString(),
      roundId: "none",
    };
  }

  return {
    service: "meeting-summary",
    topAgent: topAgent?.name ?? "unknown",
    topAgentWinRate: 0,
    analysis: {
      meetingId: meeting.meetingId,
      roundId: meeting.roundId,
      consensus: {
        type: meeting.consensus.type,
        action: meeting.consensus.action,
        symbol: meeting.consensus.symbol,
        agreementScore: meeting.consensus.agreementScore,
        summary: meeting.consensus.summary,
        mostPersuasive: meeting.consensus.mostPersuasive,
        dissenter: meeting.consensus.dissenter,
      },
      finalVotes: meeting.finalVotes.map((v) => ({
        agent: v.agentName,
        action: v.action,
        symbol: v.symbol,
        confidence: v.confidence,
        convincedBy: v.convincedBy,
      })),
      keyDiscrepancies: meeting.keyDiscrepancies,
      deliberationRounds: meeting.transcript.length,
      durationMs: meeting.durationMs,
    },
    generatedAt: new Date().toISOString(),
    roundId: meeting.roundId,
  };
}

/**
 * Generates portfolio musings summary.
 */
export function generateMusingsSummary(): AdviceResponse {
  const topAgent = getTopAgent();
  const musings = latestRoundData?.musings ?? getLatestMusings() ?? null;

  if (!musings) {
    return {
      service: "portfolio-musings",
      topAgent: topAgent?.name ?? "unknown",
      topAgentWinRate: 0,
      analysis: {
        status: "no_data",
        message: "No Portfolio Musings data available yet. Check back after the next round.",
      },
      generatedAt: new Date().toISOString(),
      roundId: "none",
    };
  }

  return {
    service: "portfolio-musings",
    topAgent: topAgent?.name ?? "unknown",
    topAgentWinRate: 0,
    analysis: {
      musingsId: musings.musingsId,
      roundId: musings.roundId,
      consensusStocks: musings.consensusStocks,
      universalRegrets: musings.universalRegrets,
      avgRegretScore: musings.avgRegretScore,
      agentMusings: musings.musings.map((m) => ({
        agent: m.agentName,
        idealPortfolio: m.idealPortfolio,
        totalAllocated: m.totalAllocated,
        strategy: m.strategy,
        biggestRegret: m.biggestRegret,
        bestDecision: m.bestDecision,
        wouldChange: m.wouldChange,
        regretScore: m.regretScore,
      })),
      durationMs: musings.durationMs,
    },
    generatedAt: new Date().toISOString(),
    roundId: musings.roundId,
  };
}

/**
 * Identifies the top-performing agent by looking at configs.
 * In a real system this would use win rate + calibration data.
 */
export function getTopAgent(): { agentId: string; name: string } | null {
  const configs = getAgentConfigs();
  if (configs.length === 0) return null;
  // Default to first agent (Claude) — in production, rank by performance
  return { agentId: configs[0].agentId, name: configs[0].name };
}

/**
 * Records an advice request in history and increments stats.
 */
export function recordAdviceRequest(
  service: string,
  response: AdviceResponse,
): AdviceRequest {
  const request: AdviceRequest = {
    id: `adv_${Date.now()}_${Math.random().toString(36).slice(ID_RANDOM_START, ID_RANDOM_START + ID_RANDOM_LENGTH_STANDARD)}`,
    service,
    requesterAgent: "x402-client",
    status: "fulfilled",
    response,
    createdAt: new Date().toISOString(),
  };

  requestHistory.push(request);
  if (requestHistory.length > MAX_CACHED_REQUESTS) {
    requestHistory.shift();
  }

  if (service in serviceRequestCounts) {
    serviceRequestCounts[service]++;
  }

  return request;
}

/**
 * Returns public stats about the advice service.
 */
export function getAdviceStats(): AdviceStats {
  return {
    totalRequests: requestHistory.length,
    serviceBreakdown: { ...serviceRequestCounts },
    latestRoundId: latestRoundData?.roundId ?? null,
    topAgent: getTopAgent()?.name ?? null,
    upSince: startTime,
  };
}

/**
 * Returns the Solana network to use based on environment.
 */
export function getSolanaNetwork(): string {
  const useDevnet = process.env.SOLANA_DEVNET === "true" ||
    process.env.ADVICE_USE_DEVNET === "true";
  return useDevnet ? SOLANA_DEVNET_NETWORK : SOLANA_MAINNET_NETWORK;
}

/**
 * Generates the skill.md content for agent discovery.
 */
export function generateSkillMd(): string {
  const wallet = ADVICE_WALLET || "<WALLET_NOT_CONFIGURED>";
  const network = getSolanaNetwork();

  return `# MoltApp Financial Advice API (x402 Protocol)

## What We Offer
MoltApp runs 4 frontier AI models (Claude, GPT, Grok, Gemini) trading real
xStocks on Solana. Our top-performing agent sells its analysis via x402
micropayments.

## Services

### 1. Market Analysis (${ADVICE_PRICE_USDC} USDC)
Current market outlook from our top agent + signals for specific stocks.
All 4 agents' decisions, confidence levels, and reasoning included.

**Endpoint:** \`GET /api/v1/advice/market-analysis\`
**Optional query:** \`?symbol=TSLAx\` to filter by stock

### 2. Meeting of Minds Summary (${ADVICE_PRICE_USDC} USDC)
What did 4 AI models agree on? Consensus trades, key disagreements, confidence.
Includes full deliberation summary and final votes.

**Endpoint:** \`GET /api/v1/advice/meeting-summary\`

### 3. Portfolio Musings (${ADVICE_PRICE_USDC} USDC)
If our agents had fresh capital, where would they put it? Ideal allocations,
biggest regrets, consensus stock picks, and regret scores.

**Endpoint:** \`GET /api/v1/advice/portfolio-musings\`

## Payment (x402 Protocol)
All paid endpoints use the x402 protocol. Simply use an x402-compatible
HTTP client (like \`@x402/fetch\`) and payments are handled automatically:

\`\`\`typescript
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactSvmScheme } from "@x402/svm/exact/client";

const client = new x402Client();
registerExactSvmScheme(client, { signer: yourSolanaSigner });
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

// Automatic: request → 402 → pay ${ADVICE_PRICE_USDC} USDC → get advice
const response = await fetchWithPayment(
  "https://moltapp.com/api/v1/advice/market-analysis"
);
const advice = await response.json();
\`\`\`

**Network:** ${network}
**Payment wallet:** \`${wallet}\`
**Token:** USDC on Solana

## Free Endpoints (No Payment Required)
- \`GET /api/v1/advice/skill.md\` — This file (service discovery)
- \`GET /api/v1/advice/services\` — JSON list of services + pricing
- \`GET /api/v1/advice/top-agent\` — Current top-performing agent
- \`GET /api/v1/advice/stats\` — Public stats (requests served, uptime)

## Response Format
All paid endpoints return JSON:
\`\`\`json
{
  "service": "market-analysis",
  "topAgent": "Claude Trader",
  "analysis": { ... },
  "generatedAt": "2026-02-10T...",
  "roundId": "round_..."
}
\`\`\`
`;
}
