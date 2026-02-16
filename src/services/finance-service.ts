/**
 * Finance-as-a-Service (FaaS) — Analyst-to-Client Marketplace
 *
 * Peer-to-peer marketplace where:
 * - Person A (Analyst) registers their AI agent as a financial analysis provider
 * - Person B (Client) has a Solana wallet with xStock positions
 * - Person A's agent runs LLM analysis on Person B's portfolio
 * - Person B pays Person A directly via x402 dynamic payTo
 * - Price is transparently derived from LLM token cost + analyst markup
 *
 * Payment flow:
 *   1. Client requests analysis → x402 DynamicPrice calculates cost
 *   2. x402 DynamicPayTo routes payment to analyst's Solana wallet
 *   3. Service reads client wallet positions from Solana
 *   4. Service calls LLM with portfolio context + market data
 *   5. FinancePackage delivered with transparent cost breakdown
 */

import Anthropic from "@anthropic-ai/sdk";
import { ID_RANDOM_START, ID_RANDOM_LENGTH_SHORT, ID_RANDOM_LENGTH_STANDARD, ID_RANDOM_LENGTH_LONG } from "../config/constants.ts";
import OpenAI from "openai";
import { estimateCost, recordLlmUsage } from "./llm-cost-tracker.ts";
import { getWalletPortfolio } from "./onchain-portfolio.ts";
import { fetchAggregatedPrices } from "./market-aggregator.ts";
import { errorMessage } from "../lib/errors.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/** Default markup % on top of LLM cost (analyst profit margin) */
const DEFAULT_MARKUP_PERCENT = 50;

/** Price floor in USD (minimum charge per analysis) */
const MIN_PRICE_USD = 0.001;

/** Price cap in USD (maximum charge per analysis) */
const MAX_PRICE_USD = 1.0;

/**
 * Estimated tokens per package tier (for pre-LLM-call pricing).
 * These are conservative estimates used to calculate the x402 price
 * BEFORE the actual LLM call. Actual usage is tracked post-call.
 */
const TIER_TOKEN_ESTIMATES: Record<PackageTier, { input: number; output: number }> = {
  quick: { input: 1500, output: 500 },
  standard: { input: 2500, output: 1500 },
  deep: { input: 4000, output: 3000 },
};

/** Maximum registered analysts (in-memory) */
const MAX_ANALYSTS = 100;

/** Maximum registered clients (in-memory) */
const MAX_CLIENTS = 500;

/** Maximum cached analysis results (in-memory) */
const MAX_CACHED_ANALYSES = 1000;

/** Minimum job budget in USD */
const MIN_JOB_BUDGET_USD = 0.01;

/** Maximum job budget in USD */
const MAX_JOB_BUDGET_USD = 5.0;

/** Maximum open jobs (in-memory) */
const MAX_JOBS = 500;

/** Job expiration time in ms (24 hours) */
const JOB_EXPIRY_MS = 24 * 60 * 60 * 1000;

/** Minimum Solana wallet address length for validation (standard base58 length) */
const WALLET_ADDRESS_MIN_LENGTH = 32;

/**
 * Formatting Precision Constants
 *
 * Control decimal precision for different financial value types displayed
 * in analyst listings, price estimates, and analysis output formatting.
 */

/**
 * Price precision for USD values (analyst pricing, budgets, LLM costs).
 * Example: $0.0235 → "0.0235" (4 decimal places for micropayment precision)
 */
const PRICE_DECIMAL_PRECISION = 4;

/**
 * Currency precision for portfolio values, P&L, position prices.
 * Example: $50.42 → "50.42" (standard 2 decimal places for currency amounts)
 */
const CURRENCY_DECIMAL_PRECISION = 2;

/**
 * Percentage precision for P&L percent and market changes.
 * Example: 5.7% → "5.7" (1 decimal place for percentage displays)
 */
const PERCENT_DECIMAL_PRECISION = 1;

/**
 * ID Generation Constants
 *
 * Control how analyst IDs and client IDs are generated using timestamp
 * and random alphanumeric suffixes for uniqueness.
 *
 * IDs follow the format: `{prefix}_{timestamp}_{randomSuffix}`
 * where randomSuffix is extracted from Math.random().toString(36).
 *
 * Examples:
 * - "analyst_1738540800000_a3f9z2"
 * - "client_1738540800123_k7m2w5"
 */

/**
 * Wallet address display truncation length for console logging.
 * Shows first 8 characters of wallet address (e.g., "7xK9mD3q...").
 */
const WALLET_DISPLAY_LENGTH = 8;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PackageTier = "quick" | "standard" | "deep";

export type LlmProvider = "anthropic" | "openai" | "xai" | "google";

export interface AnalystProfile {
  analystId: string;
  name: string;
  walletAddress: string;
  model: string;
  provider: LlmProvider;
  markupPercent: number;
  description: string;
  isActive: boolean;
  registeredAt: string;
  totalAnalyses: number;
  totalRevenue: number;
}

export interface ClientProfile {
  clientId: string;
  walletAddress: string;
  registeredAt: string;
}

export interface FinancePackage {
  requestId: string;
  analystId: string;
  analystName: string;
  clientWallet: string;
  packageTier: PackageTier;

  portfolio: {
    totalValue: number;
    cashBalance: number;
    positions: Array<{
      symbol: string;
      quantity: number;
      currentPrice: number;
      value: number;
      unrealizedPnl: number;
      unrealizedPnlPercent: number;
    }>;
    totalPnl: number;
    totalPnlPercent: number;
  };

  analysis: {
    overallAssessment: string;
    positionReviews: Array<{
      symbol: string;
      signal: "buy" | "sell" | "hold";
      confidence: number;
      reasoning: string;
    }>;
    riskAssessment: string;
    recommendations: string[];
    marketContext: string;
  };

  signals?: Array<{
    symbol: string;
    action: "buy" | "sell" | "hold";
    confidence: number;
    reasoning: string;
  }>;

  costBreakdown: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    llmCostUsd: number;
    markupPercent: number;
    markupUsd: number;
    totalPriceUsd: number;
  };

  generatedAt: string;
}

export interface PriceEstimate {
  priceUsd: string;
  breakdown: {
    model: string;
    estimatedInputTokens: number;
    estimatedOutputTokens: number;
    llmCostUsd: number;
    markupPercent: number;
    markupUsd: number;
    totalUsd: number;
  };
}

export interface AnalystListing {
  analystId: string;
  name: string;
  model: string;
  provider: LlmProvider;
  description: string;
  isActive: boolean;
  totalAnalyses: number;
  pricing: {
    quick: string;
    standard: string;
    deep: string;
  };
}

export type JobStatus = "open" | "accepted" | "fulfilled" | "expired";

export interface AnalysisJob {
  jobId: string;
  clientWallet: string;
  title: string;
  description: string;
  sector?: string;
  symbol?: string;
  tier: PackageTier;
  budgetUsd: number;
  status: JobStatus;
  postedAt: string;
  acceptedAt?: string;
  fulfilledAt?: string;
  acceptedBy?: string;
  result?: FinancePackage;
}

export interface MarketplaceStats {
  totalAnalysts: number;
  activeAnalysts: number;
  totalClients: number;
  totalAnalyses: number;
  totalRevenue: number;
  openJobs: number;
  fulfilledJobs: number;
  upSince: string;
}

// ---------------------------------------------------------------------------
// In-Memory State
// ---------------------------------------------------------------------------

const analysts = new Map<string, AnalystProfile>();
const clients = new Map<string, ClientProfile>();
const analysisHistory: FinancePackage[] = [];
const jobs = new Map<string, AnalysisJob>();
const startTime = new Date().toISOString();

// ---------------------------------------------------------------------------
// Analyst Management
// ---------------------------------------------------------------------------

/**
 * Register a new analyst (financial analysis provider).
 */
export function registerAnalyst(config: {
  name: string;
  walletAddress: string;
  model: string;
  provider: LlmProvider;
  markupPercent?: number;
  description?: string;
}): AnalystProfile {
  if (analysts.size >= MAX_ANALYSTS) {
    throw new Error(`Maximum analyst capacity reached (${MAX_ANALYSTS})`);
  }

  if (!config.walletAddress || config.walletAddress.length < WALLET_ADDRESS_MIN_LENGTH) {
    throw new Error("Valid Solana wallet address required");
  }

  if (!config.name || config.name.trim().length === 0) {
    throw new Error("Analyst name required");
  }

  const analystId = `analyst_${Date.now()}_${Math.random().toString(36).slice(ID_RANDOM_START, ID_RANDOM_START + ID_RANDOM_LENGTH_STANDARD)}`;

  const profile: AnalystProfile = {
    analystId,
    name: config.name.trim(),
    walletAddress: config.walletAddress,
    model: config.model,
    provider: config.provider,
    markupPercent: config.markupPercent ?? DEFAULT_MARKUP_PERCENT,
    description: config.description ?? `AI financial analyst powered by ${config.model}`,
    isActive: true,
    registeredAt: new Date().toISOString(),
    totalAnalyses: 0,
    totalRevenue: 0,
  };

  analysts.set(analystId, profile);
  console.log(`[FinanceService] Registered analyst: ${profile.name} (${analystId})`);
  return profile;
}

/**
 * Register a client wallet for analysis.
 */
export function registerClient(walletAddress: string): ClientProfile {
  if (clients.size >= MAX_CLIENTS) {
    throw new Error(`Maximum client capacity reached (${MAX_CLIENTS})`);
  }

  if (!walletAddress || walletAddress.length < WALLET_ADDRESS_MIN_LENGTH) {
    throw new Error("Valid Solana wallet address required");
  }

  // Check if already registered
  for (const [, client] of clients) {
    if (client.walletAddress === walletAddress) {
      return client;
    }
  }

  const clientId = `client_${Date.now()}_${Math.random().toString(36).slice(ID_RANDOM_START, ID_RANDOM_START + ID_RANDOM_LENGTH_STANDARD)}`;

  const profile: ClientProfile = {
    clientId,
    walletAddress,
    registeredAt: new Date().toISOString(),
  };

  clients.set(clientId, profile);
  console.log(`[FinanceService] Registered client: ${walletAddress.slice(0, WALLET_DISPLAY_LENGTH)}... (${clientId})`);
  return profile;
}

/**
 * Toggle analyst active/inactive status ("working?" toggle).
 */
export function toggleAnalystActive(analystId: string, isActive: boolean): boolean {
  const analyst = analysts.get(analystId);
  if (!analyst) return false;
  analyst.isActive = isActive;
  console.log(`[FinanceService] Analyst ${analyst.name} is now ${isActive ? "active" : "inactive"}`);
  return true;
}

/**
 * Get a specific analyst profile.
 */
export function getAnalyst(analystId: string): AnalystProfile | null {
  return analysts.get(analystId) ?? null;
}

/**
 * List all analysts with pricing info for discovery.
 */
export function listAnalysts(): AnalystListing[] {
  const listings: AnalystListing[] = [];

  for (const [, analyst] of analysts) {
    listings.push({
      analystId: analyst.analystId,
      name: analyst.name,
      model: analyst.model,
      provider: analyst.provider,
      description: analyst.description,
      isActive: analyst.isActive,
      totalAnalyses: analyst.totalAnalyses,
      pricing: {
        quick: estimatePrice(analyst.analystId, "quick").priceUsd,
        standard: estimatePrice(analyst.analystId, "standard").priceUsd,
        deep: estimatePrice(analyst.analystId, "deep").priceUsd,
      },
    });
  }

  return listings;
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

/**
 * Estimate the price for a given analyst + tier combination.
 * Used by x402 DynamicPrice to calculate payment amount.
 */
export function estimatePrice(analystId: string, tier: PackageTier): PriceEstimate {
  const analyst = analysts.get(analystId);
  if (!analyst) {
    // Fallback pricing for unknown analyst
    return {
      priceUsd: `$${MIN_PRICE_USD.toFixed(PRICE_DECIMAL_PRECISION)}`,
      breakdown: {
        model: "unknown",
        estimatedInputTokens: 0,
        estimatedOutputTokens: 0,
        llmCostUsd: 0,
        markupPercent: 0,
        markupUsd: 0,
        totalUsd: MIN_PRICE_USD,
      },
    };
  }

  const tokenEstimate = TIER_TOKEN_ESTIMATES[tier];
  const llmCostUsd = estimateCost(analyst.model, tokenEstimate.input, tokenEstimate.output);
  const markupUsd = llmCostUsd * (analyst.markupPercent / 100);
  const totalUsd = Math.max(MIN_PRICE_USD, Math.min(MAX_PRICE_USD, llmCostUsd + markupUsd));

  return {
    priceUsd: `$${totalUsd.toFixed(PRICE_DECIMAL_PRECISION)}`,
    breakdown: {
      model: analyst.model,
      estimatedInputTokens: tokenEstimate.input,
      estimatedOutputTokens: tokenEstimate.output,
      llmCostUsd,
      markupPercent: analyst.markupPercent,
      markupUsd,
      totalUsd,
    },
  };
}

/**
 * Calculate the x402 dynamic price string for a given analyst + tier.
 * Returns "$X.XXXX" format for x402 protocol.
 */
export function calculateDynamicPrice(analystId: string, tier: PackageTier): string {
  return estimatePrice(analystId, tier).priceUsd;
}

// ---------------------------------------------------------------------------
// LLM Analysis Orchestration
// ---------------------------------------------------------------------------

/**
 * Run portfolio analysis for a client wallet using the specified analyst's LLM.
 *
 * Flow:
 * 1. Validate analyst is active
 * 2. Read client portfolio from Solana
 * 3. Fetch current market data
 * 4. Build prompt with portfolio context
 * 5. Call analyst's LLM model
 * 6. Parse and return FinancePackage
 */
export async function runAnalysis(
  analystId: string,
  clientWallet: string,
  tier: PackageTier,
  symbol?: string,
): Promise<FinancePackage> {
  const analyst = analysts.get(analystId);
  if (!analyst) {
    throw new Error(`Analyst not found: ${analystId}`);
  }
  if (!analyst.isActive) {
    throw new Error(`Analyst ${analyst.name} is not currently accepting work`);
  }

  // 1. Read client portfolio from Solana
  const portfolio = await getWalletPortfolio(clientWallet);

  // 2. Fetch current market data
  const marketPrices = await fetchAggregatedPrices();

  // 3. Build system prompt
  const systemPrompt = buildAnalysisPrompt(portfolio, marketPrices, tier, symbol);

  // 4. Call LLM
  const llmResult = await callLlm(analyst, systemPrompt, tier);

  // 5. Parse response
  const analysis = parseAnalysisResponse(llmResult.content, tier);

  // 6. Calculate cost breakdown
  const llmCostUsd = estimateCost(analyst.model, llmResult.inputTokens, llmResult.outputTokens);
  const markupUsd = llmCostUsd * (analyst.markupPercent / 100);
  const totalPriceUsd = Math.max(MIN_PRICE_USD, Math.min(MAX_PRICE_USD, llmCostUsd + markupUsd));

  // 7. Record LLM usage
  const requestId = `fin_${Date.now()}_${Math.random().toString(36).slice(ID_RANDOM_START, ID_RANDOM_START + ID_RANDOM_LENGTH_STANDARD)}`;
  try {
    await recordLlmUsage({
      roundId: requestId,
      agentId: analystId,
      model: analyst.model,
      inputTokens: llmResult.inputTokens,
      outputTokens: llmResult.outputTokens,
    });
  } catch (err) {
    console.warn(`[FinanceService] Failed to record LLM usage: ${errorMessage(err)}`);
  }

  // 8. Build finance package
  const financePackage: FinancePackage = {
    requestId,
    analystId: analyst.analystId,
    analystName: analyst.name,
    clientWallet,
    packageTier: tier,
    portfolio: {
      totalValue: portfolio.totalValue,
      cashBalance: portfolio.cashBalance,
      positions: portfolio.positions.map(p => ({
        symbol: p.symbol,
        quantity: p.quantity,
        currentPrice: p.currentPrice,
        value: p.value,
        unrealizedPnl: p.unrealizedPnl,
        unrealizedPnlPercent: p.unrealizedPnlPercent,
      })),
      totalPnl: portfolio.totalPnl,
      totalPnlPercent: portfolio.totalPnlPercent,
    },
    analysis,
    costBreakdown: {
      model: analyst.model,
      inputTokens: llmResult.inputTokens,
      outputTokens: llmResult.outputTokens,
      llmCostUsd,
      markupPercent: analyst.markupPercent,
      markupUsd,
      totalPriceUsd,
    },
    generatedAt: new Date().toISOString(),
  };

  // Add signals for standard/deep tiers
  if (tier !== "quick" && analysis.positionReviews.length > 0) {
    financePackage.signals = analysis.positionReviews.map(r => ({
      symbol: r.symbol,
      action: r.signal,
      confidence: r.confidence,
      reasoning: r.reasoning,
    }));
  }

  // Update analyst stats
  analyst.totalAnalyses++;
  analyst.totalRevenue += totalPriceUsd;

  // Cache result
  analysisHistory.push(financePackage);
  if (analysisHistory.length > MAX_CACHED_ANALYSES) {
    analysisHistory.shift();
  }

  console.log(
    `[FinanceService] Analysis complete: ${analyst.name} analyzed ${clientWallet.slice(0, 8)}... ` +
    `(${tier}, ${llmResult.inputTokens}+${llmResult.outputTokens} tokens, $${totalPriceUsd.toFixed(PRICE_DECIMAL_PRECISION)})`,
  );

  return financePackage;
}

// ---------------------------------------------------------------------------
// LLM Call Helpers
// ---------------------------------------------------------------------------

interface LlmCallResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Build the analysis prompt based on portfolio data, market context, and tier.
 */
function buildAnalysisPrompt(
  portfolio: Awaited<ReturnType<typeof getWalletPortfolio>>,
  marketPrices: Awaited<ReturnType<typeof fetchAggregatedPrices>>,
  tier: PackageTier,
  symbol?: string,
): string {
  const positionSummary = portfolio.positions
    .map(p => `  - ${p.symbol}: ${p.quantity.toFixed(PRICE_DECIMAL_PRECISION)} units @ $${p.currentPrice.toFixed(CURRENCY_DECIMAL_PRECISION)} = $${p.value.toFixed(CURRENCY_DECIMAL_PRECISION)} (${p.unrealizedPnlPercent >= 0 ? "+" : ""}${p.unrealizedPnlPercent.toFixed(PERCENT_DECIMAL_PRECISION)}%)`)
    .join("\n");

  const marketSummary = marketPrices
    .slice(0, 20)
    .map(p => `  - ${p.symbol}: $${p.price.toFixed(CURRENCY_DECIMAL_PRECISION)} (${p.change24h >= 0 ? "+" : ""}${p.change24h.toFixed(PERCENT_DECIMAL_PRECISION)}%)`)
    .join("\n");

  const tierInstructions = {
    quick: "Provide a brief portfolio snapshot with key observations. Be concise (2-3 sentences per position).",
    standard: "Provide a full analysis with trading signals, confidence levels, and reasoning for each position. Include risk assessment.",
    deep: "Provide a comprehensive analysis with detailed position reviews, specific recommendations, risk assessment, market context, and actionable trading signals with confidence levels.",
  };

  return `You are an AI financial analyst reviewing a client's xStock portfolio on Solana.

## Client Portfolio
Total Value: $${portfolio.totalValue.toFixed(CURRENCY_DECIMAL_PRECISION)}
Cash (USDC): $${portfolio.cashBalance.toFixed(CURRENCY_DECIMAL_PRECISION)}
Total P&L: ${portfolio.totalPnl >= 0 ? "+" : ""}$${portfolio.totalPnl.toFixed(CURRENCY_DECIMAL_PRECISION)} (${portfolio.totalPnlPercent >= 0 ? "+" : ""}${portfolio.totalPnlPercent.toFixed(PERCENT_DECIMAL_PRECISION)}%)

Positions:
${positionSummary || "  (no positions)"}

## Current Market Data
${marketSummary}

## Instructions
${tierInstructions[tier]}
${symbol ? `Focus especially on ${symbol}.` : ""}

Respond in JSON format:
{
  "overallAssessment": "string - overall portfolio health summary",
  "positionReviews": [
    {
      "symbol": "string",
      "signal": "buy" | "sell" | "hold",
      "confidence": 0-100,
      "reasoning": "string"
    }
  ],
  "riskAssessment": "string - key risks identified",
  "recommendations": ["string - actionable recommendations"],
  "marketContext": "string - relevant market conditions"
}`;
}

/**
 * Call the analyst's LLM model with the given prompt.
 */
async function callLlm(
  analyst: AnalystProfile,
  prompt: string,
  tier: PackageTier,
): Promise<LlmCallResult> {
  const tokenEstimate = TIER_TOKEN_ESTIMATES[tier];

  if (analyst.provider === "anthropic") {
    return callAnthropic(analyst.model, prompt, tokenEstimate.output);
  }
  // OpenAI, xAI (Grok), and Google (Gemini) all use OpenAI-compatible SDK
  return callOpenAICompatible(analyst, prompt, tokenEstimate.output);
}

/**
 * Call Anthropic Claude models.
 */
async function callAnthropic(
  model: string,
  prompt: string,
  maxTokens: number,
): Promise<LlmCallResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not set — cannot call Claude models");
  }

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find(b => b.type === "text");
  return {
    content: textBlock?.text ?? "",
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

/**
 * Call OpenAI-compatible models (OpenAI, xAI/Grok, Google/Gemini).
 */
async function callOpenAICompatible(
  analyst: AnalystProfile,
  prompt: string,
  maxTokens: number,
): Promise<LlmCallResult> {
  const config = getOpenAIConfig(analyst.provider);

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });

  const response = await client.chat.completions.create({
    model: analyst.model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  });

  return {
    content: response.choices[0]?.message?.content ?? "",
    inputTokens: response.usage?.prompt_tokens ?? 0,
    outputTokens: response.usage?.completion_tokens ?? 0,
  };
}

/**
 * Get OpenAI SDK configuration for a given provider.
 */
function getOpenAIConfig(provider: LlmProvider): { apiKey: string; baseURL?: string } {
  switch (provider) {
    case "openai": {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error("OPENAI_API_KEY not set");
      return { apiKey };
    }
    case "xai": {
      const apiKey = process.env.XAI_API_KEY;
      if (!apiKey) throw new Error("XAI_API_KEY not set");
      return { apiKey, baseURL: "https://api.x.ai/v1" };
    }
    case "google": {
      const apiKey = process.env.GOOGLE_API_KEY;
      if (!apiKey) throw new Error("GOOGLE_API_KEY not set");
      return { apiKey, baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/" };
    }
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

/**
 * Parse the LLM's JSON response into structured analysis.
 */
function parseAnalysisResponse(
  content: string,
  _tier: PackageTier,
): FinancePackage["analysis"] {
  const fallback: FinancePackage["analysis"] = {
    overallAssessment: content.slice(0, 500),
    positionReviews: [],
    riskAssessment: "Unable to parse structured risk assessment",
    recommendations: [],
    marketContext: "",
  };

  try {
    // Extract JSON from response (may be wrapped in markdown code blocks)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallback;

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      overallAssessment: parsed.overallAssessment ?? fallback.overallAssessment,
      positionReviews: Array.isArray(parsed.positionReviews)
        ? parsed.positionReviews.map((r: Record<string, unknown>) => ({
            symbol: String(r.symbol ?? ""),
            signal: (["buy", "sell", "hold"].includes(String(r.signal)) ? r.signal : "hold") as "buy" | "sell" | "hold",
            confidence: Math.max(0, Math.min(100, Number(r.confidence) || 50)),
            reasoning: String(r.reasoning ?? ""),
          }))
        : [],
      riskAssessment: parsed.riskAssessment ?? fallback.riskAssessment,
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.map(String) : [],
      marketContext: parsed.marketContext ?? "",
    };
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Job Board
// ---------------------------------------------------------------------------

/**
 * Expire jobs older than JOB_EXPIRY_MS.
 */
function expireOldJobs(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.status === "open" && now - new Date(job.postedAt).getTime() > JOB_EXPIRY_MS) {
      job.status = "expired";
    }
  }
  // Prune expired jobs if over capacity
  if (jobs.size > MAX_JOBS) {
    const expired = [...jobs.entries()].filter(([, j]) => j.status === "expired");
    for (const [id] of expired.slice(0, jobs.size - MAX_JOBS)) {
      jobs.delete(id);
    }
  }
}

/**
 * Post a new analysis job to the marketplace.
 */
export function postJob(config: {
  clientWallet: string;
  title: string;
  description: string;
  sector?: string;
  symbol?: string;
  tier: PackageTier;
  budgetUsd: number;
}): AnalysisJob {
  expireOldJobs();

  if (!config.clientWallet || config.clientWallet.length < 32) {
    throw new Error("Valid Solana wallet address required");
  }
  if (!config.title || config.title.trim().length === 0) {
    throw new Error("Job title is required");
  }
  if (!config.description || config.description.trim().length === 0) {
    throw new Error("Job description is required");
  }
  if (config.budgetUsd < MIN_JOB_BUDGET_USD || config.budgetUsd > MAX_JOB_BUDGET_USD) {
    throw new Error(`Budget must be between $${MIN_JOB_BUDGET_USD} and $${MAX_JOB_BUDGET_USD}`);
  }

  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(ID_RANDOM_START, ID_RANDOM_START + ID_RANDOM_LENGTH_STANDARD)}`;

  const job: AnalysisJob = {
    jobId,
    clientWallet: config.clientWallet,
    title: config.title.trim(),
    description: config.description.trim(),
    sector: config.sector,
    symbol: config.symbol,
    tier: config.tier,
    budgetUsd: config.budgetUsd,
    status: "open",
    postedAt: new Date().toISOString(),
  };

  jobs.set(jobId, job);
  console.log(`[FinanceService] Job posted: "${job.title}" ($${job.budgetUsd}) by ${job.clientWallet.slice(0, 8)}...`);
  return job;
}

/**
 * List open jobs, optionally filtered by sector, tier, or minimum budget.
 */
export function listOpenJobs(filters?: {
  sector?: string;
  tier?: PackageTier;
  minBudget?: number;
}): AnalysisJob[] {
  expireOldJobs();

  const result: AnalysisJob[] = [];
  for (const [, job] of jobs) {
    if (job.status !== "open") continue;
    if (filters?.sector && job.sector !== filters.sector) continue;
    if (filters?.tier && job.tier !== filters.tier) continue;
    if (filters?.minBudget && job.budgetUsd < filters.minBudget) continue;
    result.push(job);
  }

  return result.sort((a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime());
}

/**
 * Get a specific job by ID.
 */
export function getJob(jobId: string): AnalysisJob | null {
  return jobs.get(jobId) ?? null;
}

/**
 * Get all jobs (for dashboard display).
 */
export function getAllJobs(): AnalysisJob[] {
  return [...jobs.values()].sort(
    (a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime(),
  );
}

/**
 * Analyst accepts a job. Validates analyst is active and budget meets minimum cost.
 */
export function acceptJob(jobId: string, analystId: string): AnalysisJob {
  const job = jobs.get(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);
  if (job.status !== "open") throw new Error(`Job is not open (status: ${job.status})`);

  const analyst = analysts.get(analystId);
  if (!analyst) throw new Error(`Analyst not found: ${analystId}`);
  if (!analyst.isActive) throw new Error(`Analyst ${analyst.name} is not currently active`);

  // Validate budget meets analyst's minimum cost for this tier
  const priceEstimate = estimatePrice(analystId, job.tier);
  if (job.budgetUsd < priceEstimate.breakdown.totalUsd) {
    throw new Error(
      `Budget $${job.budgetUsd.toFixed(PRICE_DECIMAL_PRECISION)} is below analyst's minimum price ${priceEstimate.priceUsd} for ${job.tier} tier`,
    );
  }

  job.status = "accepted";
  job.acceptedBy = analystId;
  job.acceptedAt = new Date().toISOString();

  console.log(`[FinanceService] Job "${job.title}" accepted by ${analyst.name}`);
  return job;
}

/**
 * Fulfill an accepted job — runs LLM analysis and stores the result.
 */
export async function fulfillJob(jobId: string): Promise<AnalysisJob> {
  const job = jobs.get(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);
  if (job.status !== "accepted") throw new Error(`Job is not accepted (status: ${job.status})`);
  if (!job.acceptedBy) throw new Error("Job has no assigned analyst");

  const result = await runAnalysis(job.acceptedBy, job.clientWallet, job.tier, job.symbol);

  job.status = "fulfilled";
  job.fulfilledAt = new Date().toISOString();
  job.result = result;

  console.log(`[FinanceService] Job "${job.title}" fulfilled by analyst ${job.acceptedBy}`);
  return job;
}

// ---------------------------------------------------------------------------
// Marketplace Stats
// ---------------------------------------------------------------------------

/**
 * Get marketplace-wide statistics.
 */
export function getMarketplaceStats(): MarketplaceStats {
  let totalRevenue = 0;
  let activeAnalysts = 0;
  let totalAnalyses = 0;
  let openJobs = 0;
  let fulfilledJobs = 0;

  for (const [, analyst] of analysts) {
    totalRevenue += analyst.totalRevenue;
    totalAnalyses += analyst.totalAnalyses;
    if (analyst.isActive) activeAnalysts++;
  }

  for (const [, job] of jobs) {
    if (job.status === "open") openJobs++;
    if (job.status === "fulfilled") fulfilledJobs++;
  }

  return {
    totalAnalysts: analysts.size,
    activeAnalysts,
    totalClients: clients.size,
    totalAnalyses,
    totalRevenue,
    openJobs,
    fulfilledJobs,
    upSince: startTime,
  };
}

// ---------------------------------------------------------------------------
// Skill.md Generation
// ---------------------------------------------------------------------------

/**
 * Generate machine-readable service spec for agent discovery.
 */
export function generateFinanceSkillMd(): string {
  const analystList = listAnalysts();
  const activeList = analystList.filter(a => a.isActive);

  const analystSection = activeList.length > 0
    ? activeList.map(a =>
        `### ${a.name} (${a.analystId})\n` +
        `- Model: ${a.model} (${a.provider})\n` +
        `- Quick: ${a.pricing.quick} | Standard: ${a.pricing.standard} | Deep: ${a.pricing.deep}\n` +
        `- Analyses completed: ${a.totalAnalyses}\n` +
        `- ${a.description}`,
      ).join("\n\n")
    : "No analysts currently registered. Use POST /register-analyst to become a provider.";

  return `# MoltApp Finance-as-a-Service (FaaS) Marketplace

## Overview
Peer-to-peer AI financial analysis marketplace on Solana. Analysts register
their AI agents to provide portfolio analysis. Clients pay analysts directly
via x402 micropayments (USDC on Solana).

## How It Works
1. **Browse analysts** — GET /api/v1/finance/analysts
2. **Check pricing** — GET /api/v1/finance/analysts/:id/pricing
3. **Request analysis** — GET /api/v1/finance/analyze/:analystId/:tier?wallet=<your_wallet>
4. **Pay via x402** — Payment routes automatically to analyst's Solana wallet
5. **Receive FinancePackage** — Portfolio analysis + signals + transparent cost breakdown

## Package Tiers
| Tier | Description | Typical Price Range |
|------|-------------|-------------------|
| quick | Brief portfolio snapshot | $0.01 - $0.10 |
| standard | Full analysis + trading signals | $0.03 - $0.25 |
| deep | Comprehensive analysis + recommendations | $0.06 - $0.45 |

## Active Analysts

${analystSection}

## Free Endpoints (No Payment Required)
- \`GET /api/v1/finance/skill.md\` — This file (service discovery)
- \`GET /api/v1/finance/analysts\` — Browse registered analysts
- \`GET /api/v1/finance/analysts/:id\` — Specific analyst profile
- \`GET /api/v1/finance/analysts/:id/pricing\` — Tier pricing breakdown
- \`GET /api/v1/finance/stats\` — Marketplace statistics
- \`POST /api/v1/finance/register-analyst\` — Register as analysis provider
- \`POST /api/v1/finance/register-client\` — Register wallet for analysis
- \`POST /api/v1/finance/analysts/:id/toggle\` — Toggle active status

## Paid Endpoints (x402 Gated)
- \`GET /api/v1/finance/analyze/:analystId/quick?wallet=<addr>\` — Quick review
- \`GET /api/v1/finance/analyze/:analystId/standard?wallet=<addr>\` — Full analysis
- \`GET /api/v1/finance/analyze/:analystId/deep?wallet=<addr>\` — Deep analysis

## Payment Protocol
All paid endpoints use x402. Use an x402-compatible client:
\`\`\`typescript
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactSvmScheme } from "@x402/svm/exact/client";

const client = new x402Client();
registerExactSvmScheme(client, { signer: yourSolanaSigner });
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

const response = await fetchWithPayment(
  "https://moltapp.com/api/v1/finance/analyze/analyst_xxx/standard?wallet=YOUR_WALLET"
);
const pkg = await response.json(); // FinancePackage with cost breakdown
\`\`\`

## Response Format (FinancePackage)
\`\`\`json
{
  "requestId": "fin_...",
  "analystId": "analyst_...",
  "analystName": "...",
  "portfolio": { "totalValue": 150.00, "positions": [...] },
  "analysis": {
    "overallAssessment": "...",
    "positionReviews": [{ "symbol": "TSLAx", "signal": "hold", "confidence": 72, "reasoning": "..." }],
    "riskAssessment": "...",
    "recommendations": ["..."]
  },
  "signals": [{ "symbol": "TSLAx", "action": "hold", "confidence": 72, "reasoning": "..." }],
  "costBreakdown": {
    "model": "claude-opus-4-6",
    "inputTokens": 2500,
    "outputTokens": 1500,
    "llmCostUsd": 0.150,
    "markupPercent": 50,
    "markupUsd": 0.075,
    "totalPriceUsd": 0.225
  }
}
\`\`\`
`;
}
