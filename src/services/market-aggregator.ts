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
  /** Data freshness */
  source: "jupiter" | "cached" | "mock";
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

  for (const stock of XSTOCKS_CATALOG) {
    const jupPrice = jupiterPrices.get(stock.mintAddress);
    const prevPrice = lastPrices.get(stock.symbol);
    const now = Date.now();

    let price: number;
    let source: AggregatedPrice["source"];
    let change24h: number;
    let volume24h: number;

    if (jupPrice) {
      price = jupPrice.price;
      source = "jupiter";
      change24h = jupPrice.change24h;
      volume24h = jupPrice.volume24h;
    } else if (prevPrice && now - new Date(prevPrice.updatedAt).getTime() < 120_000) {
      // Use cached price if less than 2 minutes old
      price = prevPrice.price;
      source = "cached";
      change24h = prevPrice.change24h;
      volume24h = prevPrice.volume24h;
    } else {
      // Mock fallback
      price = generateMockPrice(stock.symbol, prevPrice?.price);
      source = "mock";
      change24h = prevPrice ? ((price - prevPrice.price) / prevPrice.price) * 100 : (Math.random() - 0.5) * 5;
      volume24h = 10_000_000 + Math.random() * 490_000_000;
    }

    // Calculate VWAP from history
    const history = priceHistory.get(stock.symbol) ?? [];
    const vwap = computeVWAP(history);

    // Estimate spread (tighter for higher volume)
    const spreadBps = Math.max(5, Math.round(100 / Math.log2(Math.max(volume24h, 1_000_000))));

    const aggregated: AggregatedPrice = {
      symbol: stock.symbol,
      name: stock.name,
      mintAddress: stock.mintAddress,
      price: round4(price),
      change24h: round2(change24h),
      volume24h: Math.round(volume24h),
      vwap: round4(vwap || price),
      spreadBps,
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
              result.set(mint, {
                price: parseFloat(entry.price),
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
// Technical Indicators
// ---------------------------------------------------------------------------

/**
 * Compute technical indicators for a stock from its price history.
 */
export function computeIndicators(symbol: string): TechnicalIndicators {
  const history = priceHistory.get(symbol) ?? [];
  const prices = history.map((h) => h.price);

  const sma20 = prices.length >= 20 ? computeSMA(prices, 20) : null;
  const ema12 = prices.length >= 12 ? computeEMA(prices, 12) : null;
  const ema26 = prices.length >= 26 ? computeEMA(prices, 26) : null;
  const rsi14 = prices.length >= 15 ? computeRSI(prices, 14) : null;

  // Momentum: % change over last 10 data points
  const momentum = prices.length >= 10
    ? ((prices[prices.length - 1] - prices[prices.length - 10]) / prices[prices.length - 10]) * 100
    : null;

  // Trend determination
  let trend: "up" | "down" | "sideways" = "sideways";
  let signalStrength = 50;

  if (sma20 !== null && prices.length > 0) {
    const currentPrice = prices[prices.length - 1];
    const priceDiffPct = ((currentPrice - sma20) / sma20) * 100;

    if (priceDiffPct > 1) {
      trend = "up";
      signalStrength = Math.min(100, 50 + priceDiffPct * 10);
    } else if (priceDiffPct < -1) {
      trend = "down";
      signalStrength = Math.min(100, 50 + Math.abs(priceDiffPct) * 10);
    }
  }

  if (rsi14 !== null) {
    if (rsi14 > 70) { trend = "up"; signalStrength = Math.max(signalStrength, 80); }
    else if (rsi14 < 30) { trend = "down"; signalStrength = Math.max(signalStrength, 80); }
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
  const advancing = changes.filter((c) => c > 0.1).length;
  const declining = changes.filter((c) => c < -0.1).length;
  const unchanged = prices.length - advancing - declining;

  const averageChange = changes.reduce((a, b) => a + b, 0) / changes.length;
  const sortedChanges = [...changes].sort((a, b) => a - b);
  const medianChange = sortedChanges[Math.floor(sortedChanges.length / 2)];

  const adRatio = declining > 0 ? advancing / declining : advancing > 0 ? Infinity : 1;

  // Regime classification
  let regime: MarketBreadth["regime"] = "sideways";
  let regimeConfidence = 50;

  const absChanges = changes.map(Math.abs);
  const avgAbsChange = absChanges.reduce((a, b) => a + b, 0) / absChanges.length;

  if (avgAbsChange > 3) {
    regime = "volatile";
    regimeConfidence = Math.min(100, 50 + avgAbsChange * 10);
  } else if (averageChange > 1 && adRatio > 2) {
    regime = "bull";
    regimeConfidence = Math.min(100, 50 + averageChange * 15);
  } else if (averageChange < -1 && adRatio < 0.5) {
    regime = "bear";
    regimeConfidence = Math.min(100, 50 + Math.abs(averageChange) * 15);
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

    candles.push({
      symbol,
      open: prices[0],
      high: Math.max(...prices),
      low: Math.min(...prices),
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
  const gainers = sorted.slice(0, 5).map((p) => ({ symbol: p.symbol, change: p.change24h }));
  const losers = sorted.slice(-5).reverse().map((p) => ({ symbol: p.symbol, change: p.change24h }));

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
    cachedHits: number;
    mockFallbacks: number;
  };
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
      jupiterHits: prices.filter((p) => p.source === "jupiter").length,
      cachedHits: prices.filter((p) => p.source === "cached").length,
      mockFallbacks: prices.filter((p) => p.source === "mock").length,
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

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
  return Math.round(base * variation * 100) / 100;
}
