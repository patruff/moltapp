/**
 * Market Data Aggregator
 *
 * Combines multiple price data sources and computes derived market
 * indicators that agents and the dashboard consume. This is more
 * sophisticated than the raw Jupiter price feed:
 *
 * Features:
 * - Multi-source price fetching with fallback chain
 * - OHLCV candle construction from trade data
 * - Moving averages (SMA, EMA) for trend detection
 * - Volume-weighted average price (VWAP)
 * - Momentum indicators (RSI, price momentum)
 * - Market breadth (advance/decline ratio)
 * - Correlation matrix between stocks
 * - Historical price tracking with ring buffer
 * - Market regime classification (bull/bear/sideways)
 */

import { XSTOCKS_CATALOG, type StockToken } from "../config/constants.ts";
import { round2, round4, countByCondition, findMax, findMin } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Technical Indicator Period Parameters
 *
 * These define the lookback windows for all moving averages and momentum indicators.
 * Standard values follow industry conventions (20-day SMA, 12/26 EMA for MACD, 14-period RSI).
 */

/** Simple Moving Average period (20 days = ~1 trading month) */
const TECHNICAL_INDICATOR_SMA_PERIOD = 20;

/** Fast Exponential Moving Average period for MACD calculation */
const TECHNICAL_INDICATOR_EMA_FAST_PERIOD = 12;

/** Slow Exponential Moving Average period for MACD calculation */
const TECHNICAL_INDICATOR_EMA_SLOW_PERIOD = 26;

/** RSI calculation period (14 days = standard Wilder RSI) */
const TECHNICAL_INDICATOR_RSI_PERIOD = 14;

/** RSI lookback window (need 15 data points to calculate 14-period RSI) */
const TECHNICAL_INDICATOR_RSI_LOOKBACK = 15;

/** Momentum lookback period (10 data points for % change calculation) */
const TECHNICAL_INDICATOR_MOMENTUM_PERIOD = 10;

/**
 * Trend Detection Thresholds
 *
 * Price deviation from SMA that triggers trend classification.
 * ±1% is common threshold for filtering noise while catching meaningful moves.
 */

/** Price above SMA by this % = uptrend (1% deviation threshold) */
const TECHNICAL_INDICATOR_TREND_THRESHOLD_PCT = 1.0;

/**
 * Signal Strength Calculation Parameters
 *
 * Signal strength is scored 0-100 based on trend deviation and RSI extremes.
 * Baseline 50 = neutral, higher deviation/RSI extremes increase strength.
 */

/** Baseline signal strength when trend neutral (50 = mid-scale) */
const TECHNICAL_INDICATOR_SIGNAL_STRENGTH_BASELINE = 50;

/** Multiplier for price deviation % to calculate signal strength boost */
const TECHNICAL_INDICATOR_SIGNAL_STRENGTH_MULTIPLIER = 10;

/**
 * RSI Thresholds
 *
 * Standard overbought/oversold levels per Wilder's RSI definition.
 * 70/30 are textbook thresholds, 80 triggers high-strength signals.
 */

/** RSI above 70 = overbought territory (standard threshold) */
const TECHNICAL_INDICATOR_RSI_OVERBOUGHT = 70;

/** RSI below 30 = oversold territory (standard threshold) */
const TECHNICAL_INDICATOR_RSI_OVERSOLD = 30;

/** RSI extreme level (80) triggers maximum signal strength alert */
const TECHNICAL_INDICATOR_RSI_SIGNAL_STRENGTH_HIGH = 80;

/**
 * Market Breadth Classification Parameters
 *
 * Thresholds for advance/decline analysis and regime detection.
 */

/** Price change < 0.1% classified as "unchanged" (filters out noise) */
const MARKET_BREADTH_UNCHANGED_THRESHOLD = 0.1;

/** Average absolute change > 3% = volatile market regime */
const MARKET_BREADTH_VOLATILE_THRESHOLD = 3.0;

/** Baseline regime confidence when criteria barely met (50 = mid-scale) */
const MARKET_BREADTH_REGIME_CONFIDENCE_BASELINE = 50;

/** Bull regime: confidence boost per % of average positive change */
const MARKET_BREADTH_BULL_CONFIDENCE_MULTIPLIER = 15;

/** Bear regime: confidence boost per % of average negative change */
const MARKET_BREADTH_BEAR_CONFIDENCE_MULTIPLIER = 15;

/** Volatile regime: confidence boost per % of average absolute change */
const MARKET_BREADTH_VOLATILE_MULTIPLIER = 10;

/** Average change > 1% with AD ratio > 2 = bull regime threshold */
const MARKET_BREADTH_BULL_CHANGE_THRESHOLD = 1;

/** Advance/Decline ratio > 2.0 = strong bull breadth */
const MARKET_BREADTH_BULL_AD_RATIO_THRESHOLD = 2;

/** Average change < -1% with AD ratio < 0.5 = bear regime threshold */
const MARKET_BREADTH_BEAR_CHANGE_THRESHOLD = -1;

/** Advance/Decline ratio < 0.5 = strong bear breadth */
const MARKET_BREADTH_BEAR_AD_RATIO_THRESHOLD = 0.5;

/**
 * Market Snapshot Display Parameters
 */

/** Number of top gainers/losers to display in market snapshot */
const MARKET_SNAPSHOT_TOP_MOVERS_LIMIT = 5;

/**
 * Liquidity Tier Classification Thresholds
 *
 * Liquidity determines execution quality and slippage risk.
 * Based on Jupiter DEX typical pool depths.
 */

/** Liquidity >= $300K = "good" tier (tight spreads, minimal slippage) */
const LIQUIDITY_TIER_GOOD_THRESHOLD = 300_000;

/** Liquidity >= $50K = "moderate" tier (acceptable for smaller trades) */
const LIQUIDITY_TIER_MODERATE_THRESHOLD = 50_000;

/** Minimum tradeable liquidity (USD) — below this, execution quality poor */
const MIN_TRADEABLE_LIQUIDITY_USD = 50_000;

/**
 * Spread Estimation Parameters
 *
 * Bid/ask spread estimation based on volume (higher volume = tighter spread).
 * Formula: max(5 bps, 100 / log2(volume))
 */

/** Minimum spread in basis points (5 bps = 0.05% for high-liquidity stocks) */
const SPREAD_ESTIMATION_MIN_BPS = 5;

/**
 * Numerator in spread calculation formula: NUMERATOR / log2(volume)
 * Higher value = wider spreads for low liquidity stocks
 * Example: 100 / log2(1M volume) ≈ 5 bps minimum
 */
const SPREAD_CALCULATION_NUMERATOR = 100;

/** Spread calculation: volume baseline for log2 formula (1M USD) */
const SPREAD_ESTIMATION_VOLUME_BASELINE = 1_000_000;

/**
 * Price Data Caching and Fallback Parameters
 */

/** Cache duration for price data before considering stale (2 minutes) */
const PRICE_CACHE_DURATION_MS = 120_000;

/** Mock price variation range (±1% random walk from last known price) */
const MOCK_PRICE_VARIATION_PCT = 0.01;

/** Mock volume baseline + random component (10M-500M range) */
const MOCK_VOLUME_BASE = 10_000_000;
const MOCK_VOLUME_RANDOM_MAX = 490_000_000;

/**
 * Mock 24h change range when no history
 * Formula: (Math.random() - 0.5) * MOCK_CHANGE_24H_MAX produces ±2.5% range
 * Value of 5 yields [-2.5%, +2.5%] price change
 */
const MOCK_CHANGE_24H_MAX = 5;

/**
 * Correlation Analysis Parameters
 */

/** Minimum overlapping data points required for correlation calculation */
const CORRELATION_MIN_DATA_POINTS = 10;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AggregatedPrice {
  symbol: string;
  name: string;
  mintAddress: string;
  /** Current price in USD */
  price: number;
  /** 24h price change percent */
  change24h: number;
  /** 24h trading volume in USD */
  volume24h: number;
  /** Volume-weighted average price */
  vwap: number;
  /** Bid/ask spread estimate */
  spreadBps: number;
  /** Market capitalization in USD (if available) */
  marketCapUsd?: number;
  /** Liquidity in USD (if available from DexScreener) */
  liquidityUsd?: number;
  /** Data freshness */
  source: "jupiter" | "coingecko" | "cached" | "mock";
  updatedAt: string;
}

export interface PriceCandle {
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades: number;
  timestamp: string;
  periodMinutes: number;
}

export interface TechnicalIndicators {
  symbol: string;
  /** Simple Moving Average (20-period) */
  sma20: number | null;
  /** Exponential Moving Average (12-period) */
  ema12: number | null;
  /** Exponential Moving Average (26-period) */
  ema26: number | null;
  /** Relative Strength Index (14-period) */
  rsi14: number | null;
  /** Price momentum (% change over lookback) */
  momentum: number | null;
  /** Trend direction: up / down / sideways */
  trend: "up" | "down" | "sideways";
  /** Signal strength 0-100 */
  signalStrength: number;
  updatedAt: string;
}

export interface MarketBreadth {
  /** Number of stocks advancing (positive change) */
  advancing: number;
  /** Number of stocks declining (negative change) */
  declining: number;
  /** Number of stocks unchanged (< 0.1% change) */
  unchanged: number;
  /** Advance/Decline ratio */
  adRatio: number;
  /** Market-wide average change */
  averageChange: number;
  /** Market-wide median change */
  medianChange: number;
  /** Market regime classification */
  regime: "bull" | "bear" | "sideways" | "volatile";
  /** Regime confidence 0-100 */
  regimeConfidence: number;
  updatedAt: string;
}

export interface CorrelationEntry {
  symbolA: string;
  symbolB: string;
  /** Pearson correlation coefficient (-1 to 1) */
  correlation: number;
}

export interface MarketSnapshot {
  prices: AggregatedPrice[];
  breadth: MarketBreadth;
  topMovers: {
    gainers: Array<{ symbol: string; change: number }>;
    losers: Array<{ symbol: string; change: number }>;
  };
  indicators: TechnicalIndicators[];
  timestamp: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Historical price data per symbol. Ring buffer of last 500 price points. */
const priceHistory = new Map<string, Array<{ price: number; volume: number; timestamp: number }>>();
const MAX_HISTORY = 500;

/** Last known prices */
const lastPrices = new Map<string, AggregatedPrice>();

/** Last full snapshot */
let lastSnapshot: MarketSnapshot | null = null;
let lastSnapshotAt = 0;
const SNAPSHOT_CACHE_MS = 10_000; // 10 seconds

/** Fetch counter for metrics */
let fetchCount = 0;
let fetchErrors = 0;

// ---------------------------------------------------------------------------
// Core: Fetch & Aggregate Prices
// ---------------------------------------------------------------------------

/**
 * Fetch aggregated prices for all xStocks from Jupiter with enrichment.
 * This is the main data pipeline — call this every trading cycle.
 */
export async function fetchAggregatedPrices(): Promise<AggregatedPrice[]> {
  const results: AggregatedPrice[] = [];
  fetchCount++;

  // Batch fetch from Jupiter Price API
  const jupiterPrices = await fetchJupiterPrices();

  // Fetch liquidity data in parallel (non-blocking)
  const liquidityPromises = new Map<string, Promise<DexScreenerLiquidity | null>>();
  for (const stock of XSTOCKS_CATALOG) {
    liquidityPromises.set(stock.symbol, fetchDexScreenerLiquidity(stock.mintAddress));
  }

  for (const stock of XSTOCKS_CATALOG) {
    const jupPrice = jupiterPrices.get(stock.mintAddress);
    const prevPrice = lastPrices.get(stock.symbol);
    const now = Date.now();

    let price: number;
    let source: AggregatedPrice["source"];
    let change24h: number;
    let volume24h: number;
    let marketCapUsd: number | undefined;
    let liquidityUsd: number | undefined;

    if (jupPrice) {
      price = jupPrice.price;
      source = "jupiter";
      // Jupiter V3 doesn't return 24h change/volume — compute from price history
      const hist = priceHistory.get(stock.symbol) ?? [];
      if (jupPrice.change24h !== 0) {
        change24h = jupPrice.change24h;
      } else if (hist.length >= 2) {
        // Estimate 24h change from oldest available history point
        const oldest = hist[0];
        const ageMs = now - oldest.timestamp;
        if (ageMs > 0 && oldest.price > 0) {
          change24h = ((price - oldest.price) / oldest.price) * 100;
        } else {
          change24h = 0;
        }
      } else if (prevPrice) {
        change24h = ((price - prevPrice.price) / prevPrice.price) * 100;
      } else {
        change24h = 0;
      }
      volume24h = jupPrice.volume24h !== 0 ? jupPrice.volume24h : (prevPrice?.volume24h ?? 0);
    } else if (prevPrice && now - new Date(prevPrice.updatedAt).getTime() < PRICE_CACHE_DURATION_MS) {
      // Use cached price if less than 2 minutes old
      price = prevPrice.price;
      source = "cached";
      change24h = prevPrice.change24h;
      volume24h = prevPrice.volume24h;
      marketCapUsd = prevPrice.marketCapUsd;
      // Don't re-fetch liquidity for cached prices, use previous value
      const liquidityData = await liquidityPromises.get(stock.symbol);
      liquidityUsd = prevPrice.liquidityUsd ?? liquidityData?.liquidityUsd;
    } else {
      // Try CoinGecko fallback before mock
      const coinGeckoPrice = await fetchCoinGeckoPrice(stock.symbol);
      if (coinGeckoPrice) {
        price = coinGeckoPrice.price;
        source = "coingecko";
        change24h = coinGeckoPrice.change24h;
        volume24h = coinGeckoPrice.volume24h;
        marketCapUsd = coinGeckoPrice.marketCap;
      } else {
        // Mock fallback (last resort)
        price = generateMockPrice(stock.symbol, prevPrice?.price);
        source = "mock";
        change24h = prevPrice ? ((price - prevPrice.price) / prevPrice.price) * 100 : (Math.random() - 0.5) * MOCK_CHANGE_24H_MAX;
        volume24h = MOCK_VOLUME_BASE + Math.random() * MOCK_VOLUME_RANDOM_MAX;
      }
    }

    // Calculate VWAP from history
    const history = priceHistory.get(stock.symbol) ?? [];
    const vwap = computeVWAP(history);

    // Estimate spread (tighter for higher volume)
    const spreadBps = Math.max(
      SPREAD_ESTIMATION_MIN_BPS,
      Math.round(SPREAD_CALCULATION_NUMERATOR / Math.log2(Math.max(volume24h, SPREAD_ESTIMATION_VOLUME_BASELINE)))
    );

    // Get liquidity data (await the promise for this stock) if not already set from cache
    if (liquidityUsd === undefined) {
      const liquidityData = await liquidityPromises.get(stock.symbol);
      liquidityUsd = liquidityData?.liquidityUsd;
    }

    const aggregated: AggregatedPrice = {
      symbol: stock.symbol,
      name: stock.name,
      mintAddress: stock.mintAddress,
      price: round4(price),
      change24h: round2(change24h),
      volume24h: Math.round(volume24h),
      vwap: round4(vwap || price),
      spreadBps,
      marketCapUsd: marketCapUsd ? Math.round(marketCapUsd) : undefined,
      liquidityUsd: liquidityUsd ? Math.round(liquidityUsd) : undefined,
      source,
      updatedAt: new Date().toISOString(),
    };

    results.push(aggregated);
    lastPrices.set(stock.symbol, aggregated);

    // Record in history
    history.push({ price, volume: volume24h, timestamp: now });
    if (history.length > MAX_HISTORY) {
      history.splice(0, history.length - MAX_HISTORY);
    }
    priceHistory.set(stock.symbol, history);
  }

  // Auto-run liquidity analysis with fresh data
  analyzeLiquidity(results);

  return results;
}

// ---------------------------------------------------------------------------
// Jupiter Price Fetching
// ---------------------------------------------------------------------------

interface JupiterPriceEntry {
  price: number;
  change24h: number;
  volume24h: number;
}

/**
 * Fetch prices from Jupiter Price API V3 with retry.
 */
async function fetchJupiterPrices(): Promise<Map<string, JupiterPriceEntry>> {
  const result = new Map<string, JupiterPriceEntry>();

  try {
    const mintAddresses = XSTOCKS_CATALOG.map((s) => s.mintAddress);
    const batches: string[][] = [];
    for (let i = 0; i < mintAddresses.length; i += 50) {
      batches.push(mintAddresses.slice(i, i + 50));
    }

    const jupiterApiKey = process.env.JUPITER_API_KEY;
    const headers: Record<string, string> = {};
    if (jupiterApiKey) headers["x-api-key"] = jupiterApiKey;

    for (const batch of batches) {
      const ids = batch.join(",");
      try {
        const resp = await fetch(
          `https://api.jup.ag/price/v3?ids=${ids}`,
          { headers, signal: AbortSignal.timeout(8000) },
        );

        if (resp.ok) {
          const data = (await resp.json()) as {
            data: Record<string, { price: string; extraInfo?: { quotedPrice?: { buyPrice?: string; sellPrice?: string } } } | undefined>;
          };

          for (const [mint, entry] of Object.entries(data.data)) {
            if (entry?.price) {
              const parsed = parseFloat(entry.price);
              // Validate: reject NaN, zero, negative, or absurdly large prices
              if (!Number.isFinite(parsed) || parsed <= 0) continue;
              result.set(mint, {
                price: parsed,
                change24h: 0, // Jupiter V3 doesn't return 24h change directly
                volume24h: 0,
              });
            }
          }
        }
      } catch {
        fetchErrors++;
      }
    }
  } catch {
    fetchErrors++;
  }

  return result;
}

// ---------------------------------------------------------------------------
// CoinGecko Price Fetching (Fallback)
// ---------------------------------------------------------------------------

/**
 * Map xStock symbols to CoinGecko IDs.
 * CoinGecko doesn't have direct tokenized stock listings, so we map to
 * the underlying company's token/coin representation where available.
 */
const COINGECKO_ID_MAP: Record<string, string> = {
  // Crypto-adjacent companies with native tokens
  COINx: "coinbase-wrapped-staked-eth", // Coinbase represented via cbETH
  MSTRx: "microstrategy-tokenized-stock-defichain", // MicroStrategy token
  // Note: Most traditional stocks don't have CoinGecko IDs.
  // We'll use this for crypto-adjacent stocks only.
  // For others, we'll skip CoinGecko and go straight to mock.
};

interface CoinGeckoPrice {
  price: number;
  change24h: number;
  volume24h: number;
  marketCap?: number;
}

/**
 * Fetch price from CoinGecko for a single symbol.
 * Returns null if symbol not supported or API fails.
 */
async function fetchCoinGeckoPrice(symbol: string): Promise<CoinGeckoPrice | null> {
  const coinId = COINGECKO_ID_MAP[symbol];
  if (!coinId) return null;

  try {
    const resp = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true`,
      { signal: AbortSignal.timeout(5000) },
    );

    if (!resp.ok) return null;

    const data = (await resp.json()) as Record<string, {
      usd?: number;
      usd_market_cap?: number;
      usd_24h_vol?: number;
      usd_24h_change?: number;
    }>;

    const entry = data[coinId];
    if (!entry?.usd) return null;

    return {
      price: entry.usd,
      change24h: entry.usd_24h_change ?? 0,
      volume24h: entry.usd_24h_vol ?? 0,
      marketCap: entry.usd_market_cap,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// DexScreener Liquidity Data (Free API)
// ---------------------------------------------------------------------------

interface DexScreenerLiquidity {
  liquidityUsd: number;
}

/**
 * Fetch liquidity data from DexScreener for a token.
 * Returns null if API fails or token not found.
 * Free API - no key required.
 */
async function fetchDexScreenerLiquidity(mintAddress: string): Promise<DexScreenerLiquidity | null> {
  try {
    const resp = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${mintAddress}`,
      { signal: AbortSignal.timeout(5000) },
    );

    if (!resp.ok) return null;

    const data = (await resp.json()) as {
      pairs?: Array<{
        liquidity?: { usd?: number };
        chainId?: string;
      }>;
    };

    // Find the Solana pair with highest liquidity
    const solanaPairs = data.pairs?.filter((p) => p.chainId === "solana") ?? [];
    if (solanaPairs.length === 0) return null;

    // Get max liquidity across all Solana pairs
    const liquidities = solanaPairs
      .map((p) => p.liquidity?.usd ?? 0)
      .filter((l) => l > 0);

    if (liquidities.length === 0) return null;

    const liquidityValues = liquidities.map(l => ({ value: l }));
    return {
      liquidityUsd: findMax(liquidityValues, 'value')?.value ?? 0,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Technical Indicators
// ---------------------------------------------------------------------------

/**
 * Compute technical indicators for a stock from its price history.
 */
export function computeIndicators(symbol: string): TechnicalIndicators {
  const history = priceHistory.get(symbol) ?? [];
  const prices = history.map((h) => h.price);

  const sma20 = prices.length >= TECHNICAL_INDICATOR_SMA_PERIOD ? computeSMA(prices, TECHNICAL_INDICATOR_SMA_PERIOD) : null;
  const ema12 = prices.length >= TECHNICAL_INDICATOR_EMA_FAST_PERIOD ? computeEMA(prices, TECHNICAL_INDICATOR_EMA_FAST_PERIOD) : null;
  const ema26 = prices.length >= TECHNICAL_INDICATOR_EMA_SLOW_PERIOD ? computeEMA(prices, TECHNICAL_INDICATOR_EMA_SLOW_PERIOD) : null;
  const rsi14 = prices.length >= TECHNICAL_INDICATOR_RSI_LOOKBACK ? computeRSI(prices, TECHNICAL_INDICATOR_RSI_PERIOD) : null;

  // Momentum: % change over lookback period
  const momentum = prices.length >= TECHNICAL_INDICATOR_MOMENTUM_PERIOD
    ? ((prices[prices.length - 1] - prices[prices.length - TECHNICAL_INDICATOR_MOMENTUM_PERIOD]) / prices[prices.length - TECHNICAL_INDICATOR_MOMENTUM_PERIOD]) * 100
    : null;

  // Trend determination
  let trend: "up" | "down" | "sideways" = "sideways";
  let signalStrength = TECHNICAL_INDICATOR_SIGNAL_STRENGTH_BASELINE;

  if (sma20 !== null && prices.length > 0) {
    const currentPrice = prices[prices.length - 1];
    const priceDiffPct = ((currentPrice - sma20) / sma20) * 100;

    if (priceDiffPct > TECHNICAL_INDICATOR_TREND_THRESHOLD_PCT) {
      trend = "up";
      signalStrength = Math.min(100, TECHNICAL_INDICATOR_SIGNAL_STRENGTH_BASELINE + priceDiffPct * TECHNICAL_INDICATOR_SIGNAL_STRENGTH_MULTIPLIER);
    } else if (priceDiffPct < -TECHNICAL_INDICATOR_TREND_THRESHOLD_PCT) {
      trend = "down";
      signalStrength = Math.min(100, TECHNICAL_INDICATOR_SIGNAL_STRENGTH_BASELINE + Math.abs(priceDiffPct) * TECHNICAL_INDICATOR_SIGNAL_STRENGTH_MULTIPLIER);
    }
  }

  if (rsi14 !== null) {
    if (rsi14 > TECHNICAL_INDICATOR_RSI_OVERBOUGHT) { trend = "up"; signalStrength = Math.max(signalStrength, TECHNICAL_INDICATOR_RSI_SIGNAL_STRENGTH_HIGH); }
    else if (rsi14 < TECHNICAL_INDICATOR_RSI_OVERSOLD) { trend = "down"; signalStrength = Math.max(signalStrength, TECHNICAL_INDICATOR_RSI_SIGNAL_STRENGTH_HIGH); }
  }

  return {
    symbol,
    sma20: sma20 !== null ? round4(sma20) : null,
    ema12: ema12 !== null ? round4(ema12) : null,
    ema26: ema26 !== null ? round4(ema26) : null,
    rsi14: rsi14 !== null ? round2(rsi14) : null,
    momentum: momentum !== null ? round2(momentum) : null,
    trend,
    signalStrength: Math.round(signalStrength),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Compute indicators for all tracked stocks.
 */
export function computeAllIndicators(): TechnicalIndicators[] {
  return XSTOCKS_CATALOG.map((s) => computeIndicators(s.symbol));
}

// ---------------------------------------------------------------------------
// Market Breadth
// ---------------------------------------------------------------------------

/**
 * Compute market breadth from current prices.
 */
export function computeMarketBreadth(): MarketBreadth {
  const prices = Array.from(lastPrices.values());

  if (prices.length === 0) {
    return {
      advancing: 0, declining: 0, unchanged: 0,
      adRatio: 0, averageChange: 0, medianChange: 0,
      regime: "sideways", regimeConfidence: 0,
      updatedAt: new Date().toISOString(),
    };
  }

  const changes = prices.map((p) => p.change24h);
  const advancing = countByCondition(changes, (c) => c > MARKET_BREADTH_UNCHANGED_THRESHOLD);
  const declining = countByCondition(changes, (c) => c < -MARKET_BREADTH_UNCHANGED_THRESHOLD);
  const unchanged = prices.length - advancing - declining;

  const averageChange = changes.reduce((a, b) => a + b, 0) / changes.length;
  const sortedChanges = [...changes].sort((a, b) => a - b);
  const medianChange = sortedChanges[Math.floor(sortedChanges.length / 2)];

  const adRatio = declining > 0 ? advancing / declining : advancing > 0 ? Infinity : 1;

  // Regime classification
  let regime: MarketBreadth["regime"] = "sideways";
  let regimeConfidence = MARKET_BREADTH_REGIME_CONFIDENCE_BASELINE;

  const absChanges = changes.map(Math.abs);
  const avgAbsChange = absChanges.reduce((a, b) => a + b, 0) / absChanges.length;

  if (avgAbsChange > MARKET_BREADTH_VOLATILE_THRESHOLD) {
    regime = "volatile";
    regimeConfidence = Math.min(100, MARKET_BREADTH_REGIME_CONFIDENCE_BASELINE + avgAbsChange * MARKET_BREADTH_VOLATILE_MULTIPLIER);
  } else if (averageChange > MARKET_BREADTH_BULL_CHANGE_THRESHOLD && adRatio > MARKET_BREADTH_BULL_AD_RATIO_THRESHOLD) {
    regime = "bull";
    regimeConfidence = Math.min(100, MARKET_BREADTH_REGIME_CONFIDENCE_BASELINE + averageChange * MARKET_BREADTH_BULL_CONFIDENCE_MULTIPLIER);
  } else if (averageChange < MARKET_BREADTH_BEAR_CHANGE_THRESHOLD && adRatio < MARKET_BREADTH_BEAR_AD_RATIO_THRESHOLD) {
    regime = "bear";
    regimeConfidence = Math.min(100, MARKET_BREADTH_REGIME_CONFIDENCE_BASELINE + Math.abs(averageChange) * MARKET_BREADTH_BEAR_CONFIDENCE_MULTIPLIER);
  }

  return {
    advancing, declining, unchanged,
    adRatio: round2(adRatio === Infinity ? 99 : adRatio),
    averageChange: round2(averageChange),
    medianChange: round2(medianChange),
    regime,
    regimeConfidence: Math.round(regimeConfidence),
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// OHLCV Candles
// ---------------------------------------------------------------------------

/**
 * Build OHLCV candles from price history.
 *
 * @param symbol - Stock symbol
 * @param periodMinutes - Candle period in minutes (default: 30)
 * @param count - Number of candles to return (default: 48 = 24 hours of 30-min candles)
 */
export function buildCandles(
  symbol: string,
  periodMinutes: number = 30,
  count: number = 48,
): PriceCandle[] {
  const history = priceHistory.get(symbol) ?? [];
  if (history.length === 0) return [];

  const periodMs = periodMinutes * 60_000;
  const candles: PriceCandle[] = [];

  // Group by period
  const now = Date.now();
  const start = now - count * periodMs;

  for (let i = 0; i < count; i++) {
    const windowStart = start + i * periodMs;
    const windowEnd = windowStart + periodMs;
    const windowPrices = history.filter((h) => h.timestamp >= windowStart && h.timestamp < windowEnd);

    if (windowPrices.length === 0) continue;

    const prices = windowPrices.map((h) => h.price);
    const volumes = windowPrices.map((h) => h.volume);
    const priceValues = prices.map(p => ({ value: p }));

    candles.push({
      symbol,
      open: prices[0],
      high: findMax(priceValues, 'value')?.value ?? prices[0],
      low: findMin(priceValues, 'value')?.value ?? prices[0],
      close: prices[prices.length - 1],
      volume: volumes.reduce((a, b) => a + b, 0) / windowPrices.length,
      trades: windowPrices.length,
      timestamp: new Date(windowStart).toISOString(),
      periodMinutes,
    });
  }

  return candles;
}

// ---------------------------------------------------------------------------
// Correlation Matrix
// ---------------------------------------------------------------------------

/**
 * Compute pairwise correlations between stock returns.
 * Returns only pairs with at least 10 overlapping data points.
 */
export function computeCorrelations(): CorrelationEntry[] {
  const entries: CorrelationEntry[] = [];
  const symbols = Array.from(priceHistory.keys());

  for (let i = 0; i < symbols.length; i++) {
    for (let j = i + 1; j < symbols.length; j++) {
      const returnsA = computeReturns(symbols[i]);
      const returnsB = computeReturns(symbols[j]);

      // Align by index (same length)
      const minLen = Math.min(returnsA.length, returnsB.length);
      if (minLen < 10) continue;

      const a = returnsA.slice(-minLen);
      const b = returnsB.slice(-minLen);

      const corr = pearsonCorrelation(a, b);
      if (corr !== null) {
        entries.push({
          symbolA: symbols[i],
          symbolB: symbols[j],
          correlation: round2(corr),
        });
      }
    }
  }

  return entries.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
}

// ---------------------------------------------------------------------------
// Market Snapshot
// ---------------------------------------------------------------------------

/**
 * Get a complete market snapshot (cached for 10 seconds).
 */
export async function getMarketSnapshot(): Promise<MarketSnapshot> {
  const now = Date.now();
  if (lastSnapshot && now - lastSnapshotAt < SNAPSHOT_CACHE_MS) {
    return lastSnapshot;
  }

  const prices = await fetchAggregatedPrices();
  const breadth = computeMarketBreadth();
  const indicators = computeAllIndicators();

  // Top movers
  const sorted = [...prices].sort((a, b) => b.change24h - a.change24h);
  const gainers = sorted.slice(0, MARKET_SNAPSHOT_TOP_MOVERS_LIMIT).map((p) => ({ symbol: p.symbol, change: p.change24h }));
  const losers = sorted.slice(-MARKET_SNAPSHOT_TOP_MOVERS_LIMIT).reverse().map((p) => ({ symbol: p.symbol, change: p.change24h }));

  lastSnapshot = {
    prices,
    breadth,
    topMovers: { gainers, losers },
    indicators,
    timestamp: new Date().toISOString(),
  };
  lastSnapshotAt = now;

  return lastSnapshot;
}

// ---------------------------------------------------------------------------
// Aggregator Stats
// ---------------------------------------------------------------------------

export interface AggregatorStats {
  fetchCount: number;
  fetchErrors: number;
  trackedSymbols: number;
  averageHistoryDepth: number;
  lastFetchAt: string | null;
  dataQuality: {
    jupiterHits: number;
    coingeckoHits: number;
    cachedHits: number;
    mockFallbacks: number;
  };
}

// ---------------------------------------------------------------------------
// Liquidity Analysis
// ---------------------------------------------------------------------------

export type LiquidityTier = "good" | "moderate" | "thin" | "dead";

export interface TokenLiquidity {
  symbol: string;
  name: string;
  mintAddress: string;
  liquidityUsd: number;
  tier: LiquidityTier;
  tradeable: boolean;
  price: number;
  volume24h: number;
  source: AggregatedPrice["source"];
}

export interface LiquidityAnalysis {
  tokens: TokenLiquidity[];
  tradeableCount: number;
  totalCount: number;
  analyzedAt: string;
}

function classifyLiquidityTier(liquidityUsd: number): LiquidityTier {
  if (liquidityUsd >= 300_000) return "good";
  if (liquidityUsd >= 50_000) return "moderate";
  if (liquidityUsd > 0) return "thin";
  return "dead";
}

/** Cache for the latest liquidity analysis */
let cachedLiquidityAnalysis: LiquidityAnalysis | null = null;

/**
 * Analyze liquidity for all xStocks and classify into tiers.
 * Uses the latest price data from fetchAggregatedPrices().
 * Call this after fetchAggregatedPrices() to get fresh data.
 */
export function analyzeLiquidity(prices: AggregatedPrice[]): LiquidityAnalysis {
  const tokens: TokenLiquidity[] = prices.map((p) => {
    const liq = p.liquidityUsd ?? 0;
    const tier = classifyLiquidityTier(liq);
    return {
      symbol: p.symbol,
      name: p.name,
      mintAddress: p.mintAddress,
      liquidityUsd: liq,
      tier,
      tradeable: liq >= MIN_TRADEABLE_LIQUIDITY_USD,
      price: p.price,
      volume24h: p.volume24h,
      source: p.source,
    };
  });

  // Sort by liquidity descending
  tokens.sort((a, b) => b.liquidityUsd - a.liquidityUsd);

  const analysis: LiquidityAnalysis = {
    tokens,
    tradeableCount: countByCondition(tokens, (t) => t.tradeable),
    totalCount: tokens.length,
    analyzedAt: new Date().toISOString(),
  };

  cachedLiquidityAnalysis = analysis;
  return analysis;
}

/**
 * Get the cached liquidity analysis (set after each fetchAggregatedPrices call).
 */
export function getLatestLiquidityAnalysis(): LiquidityAnalysis | null {
  return cachedLiquidityAnalysis;
}

/**
 * Get the set of tradeable symbols (liquidity >= $50K).
 * Returns null if no analysis has been run yet.
 */
export function getTradeableSymbols(): Set<string> | null {
  if (!cachedLiquidityAnalysis) return null;
  return new Set(
    cachedLiquidityAnalysis.tokens
      .filter((t) => t.tradeable)
      .map((t) => t.symbol),
  );
}

/**
 * Get aggregator health and stats.
 */
export function getAggregatorStats(): AggregatorStats {
  const prices = Array.from(lastPrices.values());
  const histories = Array.from(priceHistory.values());

  return {
    fetchCount,
    fetchErrors,
    trackedSymbols: lastPrices.size,
    averageHistoryDepth: histories.length > 0
      ? Math.round(histories.reduce((s, h) => s + h.length, 0) / histories.length)
      : 0,
    lastFetchAt: prices.length > 0 ? prices[0].updatedAt : null,
    dataQuality: {
      jupiterHits: countByCondition(prices, (p) => p.source === "jupiter"),
      coingeckoHits: countByCondition(prices, (p) => p.source === "coingecko"),
      cachedHits: countByCondition(prices, (p) => p.source === "cached"),
      mockFallbacks: countByCondition(prices, (p) => p.source === "mock"),
    },
  };
}

// ---------------------------------------------------------------------------
// Math Helpers
// ---------------------------------------------------------------------------

function computeSMA(prices: number[], period: number): number {
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function computeEMA(prices: number[], period: number): number {
  const k = 2 / (period + 1);
  let ema = prices[0];
  for (let i = 1; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function computeRSI(prices: number[], period: number): number {
  if (prices.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;
  const slice = prices.slice(-(period + 1));

  for (let i = 1; i < slice.length; i++) {
    const change = slice[i] - slice[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function computeVWAP(history: Array<{ price: number; volume: number }>): number | null {
  if (history.length === 0) return null;
  let totalPV = 0;
  let totalV = 0;
  for (const h of history) {
    totalPV += h.price * h.volume;
    totalV += h.volume;
  }
  return totalV > 0 ? totalPV / totalV : null;
}

function computeReturns(symbol: string): number[] {
  const history = priceHistory.get(symbol) ?? [];
  if (history.length < 2) return [];
  const returns: number[] = [];
  for (let i = 1; i < history.length; i++) {
    returns.push((history[i].price - history[i - 1].price) / history[i - 1].price);
  }
  return returns;
}

function pearsonCorrelation(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;

  const meanA = a.slice(0, n).reduce((s, x) => s + x, 0) / n;
  const meanB = b.slice(0, n).reduce((s, x) => s + x, 0) / n;

  let cov = 0;
  let varA = 0;
  let varB = 0;

  for (let i = 0; i < n; i++) {
    const dA = a[i] - meanA;
    const dB = b[i] - meanB;
    cov += dA * dB;
    varA += dA * dA;
    varB += dB * dB;
  }

  const denom = Math.sqrt(varA * varB);
  return denom > 0 ? cov / denom : null;
}

// round2 and round4 imported from ../lib/math-utils.ts

/** Generate a mock price with small random variation from last known. */
function generateMockPrice(symbol: string, lastPrice?: number): number {
  const basePrices: Record<string, number> = {
    AAPLx: 178.50, AMZNx: 185.20, GOOGLx: 142.80, METAx: 505.30,
    MSFTx: 415.60, NVDAx: 890.50, TSLAx: 245.80, SPYx: 502.10,
    QQQx: 435.70, COINx: 205.40, MSTRx: 1685.00, HOODx: 22.80,
    NFLXx: 628.90, PLTRx: 24.50, GMEx: 17.80,
  };
  const base = lastPrice ?? basePrices[symbol] ?? 100;
  const variation = 1 + (Math.random() - 0.5) * 0.02;
  return round2(base * variation);
}
