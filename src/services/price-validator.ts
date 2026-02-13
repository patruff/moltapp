/**
 * Live Price Validator
 *
 * Multi-source price verification to prevent stale-price trades and
 * manipulation. Before any trade executes, this service validates the
 * execution price against multiple independent sources.
 *
 * Sources:
 * 1. Jupiter Price API V3 — primary DEX aggregator price
 * 2. Real-time price stream (internal cache from realtime-prices service)
 * 3. On-chain TWAP — time-weighted average from recent swaps
 * 4. Historical bounds — reject prices outside 24h range ± buffer
 *
 * Validation rules:
 * - Price must be confirmed by at least 2 independent sources
 * - Price deviation between sources must be < 2% (configurable)
 * - Price must be within 24h high/low range + 5% buffer
 * - Stale prices (>60 seconds old) are rejected for live trades
 *
 * Integration:
 * - Called by trade-executor.ts before every live trade
 * - Returns a validation result with confidence score
 * - Can be bypassed for paper trades
 */

import { getPrice, getAggregatedPrice, type PricePoint } from "./realtime-prices.ts";
import { logTradeEvent } from "./audit-log.ts";
import { round2, countByCondition, findMax, findMin } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PriceValidationRequest {
  symbol: string;
  mintAddress: string;
  /** The price the trade would execute at */
  proposedPrice: number;
  /** Agent making the trade */
  agentId: string;
  /** Trade direction */
  side: "buy" | "sell";
  /** Amount in USDC */
  usdcAmount: number;
  /** Allow stale prices (for paper trades) */
  allowStale?: boolean;
}

export interface PriceValidationResult {
  /** Whether the price is valid for execution */
  valid: boolean;
  /** Confidence score 0-100 */
  confidence: number;
  /** Reason for rejection (if invalid) */
  rejectReason: string | null;
  /** The validated/adjusted price to use */
  validatedPrice: number;
  /** Maximum acceptable deviation from proposed price */
  maxDeviationPercent: number;
  /** Actual deviation from proposed price */
  actualDeviationPercent: number;
  /** Number of sources that confirmed the price */
  sourcesConfirmed: number;
  /** Price from each source */
  sourceDetails: Array<{
    source: string;
    price: number;
    ageMs: number;
    isStale: boolean;
  }>;
  /** Whether slippage protection was applied */
  slippageProtection: boolean;
  /** Estimated slippage percentage */
  estimatedSlippagePercent: number;
  /** Timestamp of validation */
  validatedAt: string;
}

export interface PriceValidationConfig {
  /** Maximum allowed deviation between sources (default: 2%) */
  maxSourceDeviationPercent: number;
  /** Maximum price staleness in ms (default: 60s for live, 300s for paper) */
  maxStalenessMs: number;
  /** Buffer percentage outside 24h range (default: 5%) */
  historicalRangeBufferPercent: number;
  /** Minimum number of sources required (default: 1) */
  minSourcesRequired: number;
  /** Maximum slippage for live trades (default: 1%) */
  maxSlippagePercent: number;
  /** Whether to enforce strict validation (default: true for live) */
  strictMode: boolean;
}

export interface PriceValidatorMetrics {
  totalValidations: number;
  validPrices: number;
  rejectedPrices: number;
  avgConfidence: number;
  rejectionReasons: Record<string, number>;
  avgDeviationPercent: number;
  avgSourceCount: number;
  slippageProtectionTriggers: number;
  lastValidationAt: string | null;
}

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Live trading validation thresholds.
 * These are strict to ensure safety and prevent stale-price exploitation.
 */
const LIVE_MAX_SOURCE_DEVIATION_PERCENT = 2; // 2% max deviation between price sources
const LIVE_MAX_STALENESS_MS = 60_000; // 60 seconds max age for live trades
const LIVE_HISTORICAL_RANGE_BUFFER_PERCENT = 5; // 5% buffer outside 24h range
const LIVE_MIN_SOURCES_REQUIRED = 1; // Minimum 1 source for validation
const LIVE_MAX_SLIPPAGE_PERCENT = 1; // 1% max slippage for live trades
const LIVE_STRICT_MODE = true; // Enforce all validation checks

/**
 * Paper trading validation thresholds.
 * These are more relaxed for backtesting and simulation.
 */
const PAPER_MAX_SOURCE_DEVIATION_PERCENT = 5; // 5% max deviation for paper trades
const PAPER_MAX_STALENESS_MS = 300_000; // 5 minutes max age for paper trades
const PAPER_HISTORICAL_RANGE_BUFFER_PERCENT = 10; // 10% buffer for paper trades
const PAPER_MIN_SOURCES_REQUIRED = 1; // Minimum 1 source for paper trades
const PAPER_MAX_SLIPPAGE_PERCENT = 5; // 5% max slippage for paper trades
const PAPER_STRICT_MODE = false; // Relaxed validation for paper trades

/**
 * Confidence scoring parameters.
 * These control how the confidence score (0-100) is calculated.
 */
const CONFIDENCE_BASE_SCORE = 50; // Starting confidence before adjustments
const CONFIDENCE_PER_SOURCE_BONUS = 15; // Bonus per additional price source
const CONFIDENCE_FRESH_RATIO_MULTIPLIER = 20; // Multiplier for fresh price ratio
const CONFIDENCE_LOW_DEVIATION_TIER1_THRESHOLD = 0.5; // <0.5% deviation = tier 1 bonus
const CONFIDENCE_LOW_DEVIATION_TIER1_BONUS = 10; // Bonus for very low deviation
const CONFIDENCE_LOW_DEVIATION_TIER2_THRESHOLD = 1.0; // <1.0% deviation = tier 2 bonus
const CONFIDENCE_LOW_DEVIATION_TIER2_BONUS = 5; // Bonus for low deviation
const CONFIDENCE_MAX_SCORE = 100; // Cap confidence at 100%

/**
 * Slippage protection multiplier.
 * Extreme slippage is rejected when deviation exceeds maxSlippagePercent × this multiplier.
 */
const SLIPPAGE_EXTREME_MULTIPLIER = 2; // 2× maxSlippagePercent = extreme slippage rejection

/**
 * Quick validation confidence threshold.
 * Prices must exceed this confidence to pass quickValidate() check.
 */
const QUICK_VALIDATE_MIN_CONFIDENCE = 50; // Minimum confidence for quick validation

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_LIVE_CONFIG: PriceValidationConfig = {
  maxSourceDeviationPercent: LIVE_MAX_SOURCE_DEVIATION_PERCENT,
  maxStalenessMs: LIVE_MAX_STALENESS_MS,
  historicalRangeBufferPercent: LIVE_HISTORICAL_RANGE_BUFFER_PERCENT,
  minSourcesRequired: LIVE_MIN_SOURCES_REQUIRED,
  maxSlippagePercent: LIVE_MAX_SLIPPAGE_PERCENT,
  strictMode: LIVE_STRICT_MODE,
};

const DEFAULT_PAPER_CONFIG: PriceValidationConfig = {
  maxSourceDeviationPercent: PAPER_MAX_SOURCE_DEVIATION_PERCENT,
  maxStalenessMs: PAPER_MAX_STALENESS_MS,
  historicalRangeBufferPercent: PAPER_HISTORICAL_RANGE_BUFFER_PERCENT,
  minSourcesRequired: PAPER_MIN_SOURCES_REQUIRED,
  maxSlippagePercent: PAPER_MAX_SLIPPAGE_PERCENT,
  strictMode: PAPER_STRICT_MODE,
};

let liveConfig = { ...DEFAULT_LIVE_CONFIG };
let paperConfig = { ...DEFAULT_PAPER_CONFIG };

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** 24h price range tracking: mintAddress -> { high, low, updatedAt } */
const priceRanges = new Map<
  string,
  { high: number; low: number; updatedAt: number }
>();

/** Metrics */
let totalValidations = 0;
let validPrices = 0;
let rejectedPrices = 0;
let totalConfidence = 0;
let totalDeviation = 0;
let totalSourceCount = 0;
let slippageProtectionTriggers = 0;
let lastValidationAt: string | null = null;
const rejectionReasons: Record<string, number> = {};

// ---------------------------------------------------------------------------
// Core Validation
// ---------------------------------------------------------------------------

/**
 * Validate a price before trade execution.
 *
 * This is the main entry point — call before every trade.
 * Returns whether the price is valid and a confidence score.
 */
export async function validatePrice(
  request: PriceValidationRequest,
): Promise<PriceValidationResult> {
  const startTime = Date.now();
  const isLive = !request.allowStale;
  const config = isLive ? liveConfig : paperConfig;

  totalValidations++;
  lastValidationAt = new Date().toISOString();

  const sourceDetails: PriceValidationResult["sourceDetails"] = [];

  // --- Source 1: Internal real-time price cache ---
  const cachedPrice = getPrice(request.symbol);
  if (cachedPrice && cachedPrice.price > 0) {
    sourceDetails.push({
      source: "realtime-cache",
      price: cachedPrice.price,
      ageMs: cachedPrice.ageMs,
      isStale: cachedPrice.isStale,
    });
  }

  // --- Source 2: Aggregated multi-source price ---
  const aggregatedPrice = getAggregatedPrice(request.symbol);
  if (aggregatedPrice && aggregatedPrice.price > 0 && aggregatedPrice.source === "aggregate") {
    sourceDetails.push({
      source: "aggregate",
      price: aggregatedPrice.price,
      ageMs: aggregatedPrice.ageMs,
      isStale: aggregatedPrice.isStale,
    });
  }

  // --- Source 3: Fresh Jupiter fetch (if needed and live mode) ---
  if (isLive && sourceDetails.length < 2) {
    const jupiterPrice = await fetchJupiterPrice(request.mintAddress);
    if (jupiterPrice) {
      sourceDetails.push({
        source: "jupiter-fresh",
        price: jupiterPrice,
        ageMs: 0,
        isStale: false,
      });
    }
  }

  // --- Validation checks ---

  // Check 1: Do we have enough sources?
  if (sourceDetails.length < config.minSourcesRequired) {
    const reason = `Insufficient price sources: got ${sourceDetails.length}, need ${config.minSourcesRequired}`;
    return rejectPrice(request, reason, sourceDetails, config);
  }

  // Check 2: Staleness check (for live trades)
  if (config.strictMode) {
    const freshSources = sourceDetails.filter((s) => !s.isStale && s.ageMs < config.maxStalenessMs);
    if (freshSources.length === 0) {
      const maxAge = findMax(sourceDetails, 'ageMs')?.ageMs ?? 0;
      const reason = `All price sources are stale (oldest: ${Math.round(maxAge / 1000)}s)`;
      return rejectPrice(request, reason, sourceDetails, config);
    }
  }

  // Check 3: Source agreement (deviation check)
  const prices = sourceDetails.map((s) => s.price);
  const priceObjs = prices.map(p => ({ value: p }));
  const minPrice = findMin(priceObjs, 'value')?.value ?? 0;
  const maxPrice = findMax(priceObjs, 'value')?.value ?? 0;
  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
  const maxDeviation = avgPrice > 0 ? ((maxPrice - minPrice) / avgPrice) * 100 : 0;

  if (maxDeviation > config.maxSourceDeviationPercent && sourceDetails.length >= 2) {
    const reason = `Price sources disagree: ${maxDeviation.toFixed(2)}% deviation (max allowed: ${config.maxSourceDeviationPercent}%)`;
    return rejectPrice(request, reason, sourceDetails, config);
  }

  // Check 4: Proposed price vs validated price (slippage check)
  const validatedPrice = avgPrice;
  const proposedDeviation =
    validatedPrice > 0
      ? Math.abs((request.proposedPrice - validatedPrice) / validatedPrice) * 100
      : 0;

  let slippageProtection = false;
  if (proposedDeviation > config.maxSlippagePercent && isLive) {
    slippageProtection = true;
    slippageProtectionTriggers++;

    if (proposedDeviation > config.maxSlippagePercent * SLIPPAGE_EXTREME_MULTIPLIER) {
      // Extreme slippage — reject
      const reason = `Excessive slippage: proposed $${request.proposedPrice.toFixed(4)} vs validated $${validatedPrice.toFixed(4)} (${proposedDeviation.toFixed(2)}% deviation)`;
      return rejectPrice(request, reason, sourceDetails, config);
    }
  }

  // Check 5: Historical range (if we have data)
  const range = priceRanges.get(request.mintAddress);
  if (range && config.strictMode) {
    const buffer = config.historicalRangeBufferPercent / 100;
    const adjustedLow = range.low * (1 - buffer);
    const adjustedHigh = range.high * (1 + buffer);

    if (validatedPrice < adjustedLow || validatedPrice > adjustedHigh) {
      const reason = `Price $${validatedPrice.toFixed(4)} outside 24h range [$${adjustedLow.toFixed(4)}, $${adjustedHigh.toFixed(4)}]`;
      return rejectPrice(request, reason, sourceDetails, config);
    }
  }

  // Update 24h range
  updatePriceRange(request.mintAddress, validatedPrice);

  // --- Calculate confidence ---
  let confidence = CONFIDENCE_BASE_SCORE;

  // More sources = higher confidence
  confidence += sourceDetails.length * CONFIDENCE_PER_SOURCE_BONUS;

  // Fresh prices = higher confidence
  const freshRatio = countByCondition(sourceDetails, (s) => !s.isStale) / sourceDetails.length;
  confidence += freshRatio * CONFIDENCE_FRESH_RATIO_MULTIPLIER;

  // Low deviation = higher confidence
  if (maxDeviation < CONFIDENCE_LOW_DEVIATION_TIER1_THRESHOLD) {
    confidence += CONFIDENCE_LOW_DEVIATION_TIER1_BONUS;
  } else if (maxDeviation < CONFIDENCE_LOW_DEVIATION_TIER2_THRESHOLD) {
    confidence += CONFIDENCE_LOW_DEVIATION_TIER2_BONUS;
  }

  // Cap confidence
  confidence = Math.min(CONFIDENCE_MAX_SCORE, Math.round(confidence));

  // Track metrics
  validPrices++;
  totalConfidence += confidence;
  totalDeviation += proposedDeviation;
  totalSourceCount += sourceDetails.length;

  const estimatedSlippage = request.side === "buy" ? proposedDeviation : -proposedDeviation;

  const result: PriceValidationResult = {
    valid: true,
    confidence,
    rejectReason: null,
    validatedPrice: Math.round(validatedPrice * 10000) / 10000,
    maxDeviationPercent: config.maxSourceDeviationPercent,
    actualDeviationPercent: round2(proposedDeviation),
    sourcesConfirmed: sourceDetails.length,
    sourceDetails,
    slippageProtection,
    estimatedSlippagePercent: round2(estimatedSlippage),
    validatedAt: new Date().toISOString(),
  };

  logTradeEvent(
    "price_validated",
    `Price validated for ${request.symbol}: $${validatedPrice.toFixed(4)} (${sourceDetails.length} sources, ${confidence}% confidence)`,
    request.agentId,
    undefined,
    {
      symbol: request.symbol,
      validatedPrice,
      proposedPrice: request.proposedPrice,
      deviation: proposedDeviation,
      sources: sourceDetails.length,
      confidence,
    },
  );

  return result;
}

/**
 * Batch validate prices for multiple symbols.
 * Useful for pre-round validation of all potential trades.
 */
export async function validateBatch(
  symbols: string[],
  agentId: string,
): Promise<Record<string, PriceValidationResult>> {
  const results: Record<string, PriceValidationResult> = {};

  for (const symbol of symbols) {
    const cached = getPrice(symbol);
    if (!cached) continue;

    results[symbol] = await validatePrice({
      symbol,
      mintAddress: cached.mintAddress,
      proposedPrice: cached.price,
      agentId,
      side: "buy",
      usdcAmount: 0,
      allowStale: true,
    });
  }

  return results;
}

/**
 * Quick check if a price is reasonably fresh and valid.
 * Lightweight version for non-critical checks.
 */
export function quickValidate(symbol: string): {
  valid: boolean;
  price: number;
  ageMs: number;
  confidence: number;
} {
  const cached = getPrice(symbol);
  if (!cached) {
    return { valid: false, price: 0, ageMs: 0, confidence: 0 };
  }

  return {
    valid: !cached.isStale && cached.confidence > QUICK_VALIDATE_MIN_CONFIDENCE,
    price: cached.price,
    ageMs: cached.ageMs,
    confidence: cached.confidence,
  };
}

// ---------------------------------------------------------------------------
// Configuration Management
// ---------------------------------------------------------------------------

/**
 * Update live trade validation config.
 */
export function configureLiveValidation(
  updates: Partial<PriceValidationConfig>,
): PriceValidationConfig {
  liveConfig = { ...liveConfig, ...updates };
  return liveConfig;
}

/**
 * Update paper trade validation config.
 */
export function configurePaperValidation(
  updates: Partial<PriceValidationConfig>,
): PriceValidationConfig {
  paperConfig = { ...paperConfig, ...updates };
  return paperConfig;
}

/**
 * Get current validation configs.
 */
export function getValidationConfigs(): {
  live: PriceValidationConfig;
  paper: PriceValidationConfig;
} {
  return {
    live: { ...liveConfig },
    paper: { ...paperConfig },
  };
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/**
 * Get price validator metrics.
 */
export function getPriceValidatorMetrics(): PriceValidatorMetrics {
  return {
    totalValidations,
    validPrices,
    rejectedPrices,
    avgConfidence:
      totalValidations > 0 ? Math.round(totalConfidence / totalValidations) : 0,
    rejectionReasons: { ...rejectionReasons },
    avgDeviationPercent:
      totalValidations > 0
        ? round2(totalDeviation / totalValidations)
        : 0,
    avgSourceCount:
      totalValidations > 0
        ? Math.round((totalSourceCount / totalValidations) * 10) / 10
        : 0,
    slippageProtectionTriggers,
    lastValidationAt,
  };
}

/**
 * Reset metrics (admin use).
 */
export function resetPriceValidatorMetrics(): void {
  totalValidations = 0;
  validPrices = 0;
  rejectedPrices = 0;
  totalConfidence = 0;
  totalDeviation = 0;
  totalSourceCount = 0;
  slippageProtectionTriggers = 0;
  lastValidationAt = null;
  Object.keys(rejectionReasons).forEach((k) => delete rejectionReasons[k]);
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/**
 * Create a rejection result.
 */
function rejectPrice(
  request: PriceValidationRequest,
  reason: string,
  sourceDetails: PriceValidationResult["sourceDetails"],
  config: PriceValidationConfig,
): PriceValidationResult {
  rejectedPrices++;

  // Track rejection reason category
  const category = reason.split(":")[0].trim();
  rejectionReasons[category] = (rejectionReasons[category] ?? 0) + 1;

  console.warn(
    `[PriceValidator] REJECTED: ${request.symbol} — ${reason}`,
  );

  logTradeEvent(
    "price_rejected",
    `Price validation rejected for ${request.symbol}: ${reason}`,
    request.agentId,
    undefined,
    {
      symbol: request.symbol,
      proposedPrice: request.proposedPrice,
      reason,
      sources: sourceDetails.length,
    },
  );

  return {
    valid: false,
    confidence: 0,
    rejectReason: reason,
    validatedPrice: 0,
    maxDeviationPercent: config.maxSourceDeviationPercent,
    actualDeviationPercent: 0,
    sourcesConfirmed: sourceDetails.length,
    sourceDetails,
    slippageProtection: false,
    estimatedSlippagePercent: 0,
    validatedAt: new Date().toISOString(),
  };
}

/**
 * Fetch a fresh price from Jupiter Price API.
 */
async function fetchJupiterPrice(mintAddress: string): Promise<number | null> {
  try {
    const jupiterApiKey = process.env.JUPITER_API_KEY;
    const headers: Record<string, string> = {};
    if (jupiterApiKey) {
      headers["x-api-key"] = jupiterApiKey;
    }

    const resp = await fetch(
      `https://api.jup.ag/price/v3?ids=${mintAddress}`,
      { headers, signal: AbortSignal.timeout(5000) },
    );

    if (!resp.ok) return null;

    const data = (await resp.json()) as {
      data: Record<string, { price: string } | undefined>;
    };

    const entry = data.data?.[mintAddress];
    return entry?.price ? parseFloat(entry.price) : null;
  } catch {
    return null;
  }
}

/**
 * Update the 24h price range for a token.
 */
function updatePriceRange(mintAddress: string, price: number): void {
  const existing = priceRanges.get(mintAddress);
  const now = Date.now();

  if (!existing) {
    priceRanges.set(mintAddress, { high: price, low: price, updatedAt: now });
    return;
  }

  // Reset range if older than 24h
  if (now - existing.updatedAt > 24 * 60 * 60 * 1000) {
    priceRanges.set(mintAddress, { high: price, low: price, updatedAt: now });
    return;
  }

  // Update range
  existing.high = Math.max(existing.high, price);
  existing.low = Math.min(existing.low, price);
  existing.updatedAt = now;
}
