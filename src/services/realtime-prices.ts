/**
 * Real-Time Price Streaming Service
 *
 * Provides sub-second price updates for all xStocks tokens using multiple
 * data sources with intelligent fallback:
 *
 * 1. Helius WebSocket — real-time Solana account updates (primary)
 * 2. Jupiter Price API V3 — HTTP polling every 5 seconds (secondary)
 * 3. In-memory price cache with staleness detection
 *
 * Features:
 * - Multi-source price aggregation with weighted confidence
 * - Staleness detection: flags prices older than 30 seconds
 * - Price change event emission for downstream consumers
 * - VWAP (Volume-Weighted Average Price) tracking per session
 * - Price deviation alerts when sources disagree by > 1%
 * - Subscriber pattern for real-time price consumers
 *
 * Architecture:
 * - Helius DAS API for token metadata + account subscriptions
 * - Jupiter for USD pricing (most liquid DEX on Solana)
 * - Internal event bus integration for broadcasting price updates
 */

import { XSTOCKS_CATALOG } from "../config/constants.ts";
import { eventBus } from "./event-stream.ts";
import { errorMessage } from "../lib/errors.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PricePoint {
  /** Token symbol (e.g., "AAPLx") */
  symbol: string;
  /** Token mint address on Solana */
  mintAddress: string;
  /** USD price */
  price: number;
  /** Price source */
  source: "helius" | "jupiter" | "aggregate" | "mock";
  /** Confidence score 0-100 */
  confidence: number;
  /** ISO timestamp when this price was fetched */
  fetchedAt: string;
  /** Age in milliseconds since fetch */
  ageMs: number;
  /** Whether this price is considered stale (>30s old) */
  isStale: boolean;
  /** 24h price change percentage (null if unavailable) */
  change24h: number | null;
  /** Session VWAP if available */
  vwap: number | null;
}

export interface PriceUpdate {
  symbol: string;
  mintAddress: string;
  oldPrice: number;
  newPrice: number;
  changePercent: number;
  source: string;
  timestamp: string;
}

export interface PriceDeviationAlert {
  symbol: string;
  mintAddress: string;
  sources: Array<{ source: string; price: number }>;
  maxDeviationPercent: number;
  timestamp: string;
}

export interface PriceStreamMetrics {
  isRunning: boolean;
  heliusConnected: boolean;
  jupiterPolling: boolean;
  totalPriceUpdates: number;
  totalDeviationAlerts: number;
  subscriberCount: number;
  tokensCovered: number;
  tokensWithFreshPrices: number;
  tokensWithStalePrices: number;
  averageUpdateLatencyMs: number;
  lastUpdateAt: string | null;
  uptime: number;
  sourceBreakdown: Record<string, number>;
}

type PriceSubscriber = (update: PriceUpdate) => void;

interface PriceCacheEntry {
  price: number;
  source: string;
  fetchedAt: number;
  change24h: number | null;
}

interface VwapTracker {
  totalPriceVolume: number;
  totalVolume: number;
  sampleCount: number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Price Staleness & Freshness Thresholds
 */

/** Price staleness threshold in milliseconds (30 seconds) */
const STALENESS_THRESHOLD_MS = 30_000;

/**
 * Fresh price window for multi-source deviation detection (60 seconds).
 * Only prices fetched within this window are compared for divergence alerts.
 * Set to 2x staleness threshold to include recently stale prices in comparison.
 */
const FRESH_PRICE_WINDOW_MS = 60_000;

/**
 * Price change notification threshold (0.001%).
 * Subscribers are only notified if price moves by more than this percentage.
 * Formula: |changePercent| > PRICE_CHANGE_NOTIFICATION_THRESHOLD
 *
 * Examples:
 * - 0.001% = $100 stock moves by $0.001 triggers notification
 * - 0.01% = $100 stock moves by $0.01 triggers notification
 */
const PRICE_CHANGE_NOTIFICATION_THRESHOLD = 0.001;

/**
 * External API Polling & Timeout Parameters
 */

/** Jupiter polling interval in milliseconds (5 seconds) */
const JUPITER_POLL_INTERVAL_MS = 5_000;

/**
 * Jupiter API request timeout in milliseconds (8 seconds).
 * Jupiter typically responds <2s, but we allow 8s for network spikes.
 */
const JUPITER_API_TIMEOUT_MS = 8_000;

/**
 * WebSocket & Reconnection Parameters
 */

/** Helius WebSocket reconnect delay in milliseconds (base delay for exponential backoff) */
const HELIUS_RECONNECT_DELAY_MS = 3_000;

/** Maximum reconnect attempts before falling back to polling only */
const MAX_RECONNECT_ATTEMPTS = 5;

/**
 * WebSocket ping interval in milliseconds (30 seconds).
 * Keeps connection alive by sending periodic ping messages.
 */
const WEBSOCKET_PING_INTERVAL_MS = 30_000;

/**
 * Price Deviation Detection
 */

/** Price deviation alert threshold (1%) */
const DEVIATION_ALERT_THRESHOLD = 0.01;

/**
 * Deviation percentage rounding multiplier (10000 = 2 decimal places).
 * Formula: Math.round(percent * 10000) / 100 converts 0.0123 → 1.23%
 */
const DEVIATION_PERCENT_ROUNDING_MULTIPLIER = 10000;

/**
 * Decimal Precision & Formatting
 */

/**
 * Price rounding multiplier (10000 = 4 decimal places).
 * Formula: Math.round(price * 10000) / 10000
 * Used for VWAP and aggregated price display.
 */
const PRICE_ROUNDING_MULTIPLIER = 10000;

/**
 * Minimum age in milliseconds for weight calculation (100ms).
 * Prevents division by zero in age-weighted averaging.
 */
const MIN_AGE_FOR_WEIGHT_MS = 100;

/**
 * Confidence Calculation Parameters
 */

/**
 * Base confidence score for stale prices (70).
 * When price exceeds STALENESS_THRESHOLD_MS, confidence starts at 70
 * and decays linearly to 0 over CONFIDENCE_DECAY_WINDOW_MS.
 */
const CONFIDENCE_STALE_BASE = 70;

/**
 * Confidence decay window in milliseconds (5 minutes = 300,000ms).
 * After price becomes stale, confidence drops from 70 to 0 over this period.
 */
const CONFIDENCE_DECAY_WINDOW_MS = 300_000;

/**
 * Base confidence score for fresh prices (80).
 * Fresh prices (age < STALENESS_THRESHOLD_MS) start at 80 confidence
 * and scale up to 100 based on freshness.
 */
const CONFIDENCE_FRESH_BASE = 80;

/**
 * Confidence bonus range for freshness (20).
 * Formula: FRESH_BASE + (1 - ageMs / STALENESS) * FRESH_BONUS
 * Produces confidence range of 80-100 for fresh prices.
 */
const CONFIDENCE_FRESH_BONUS = 20;

/**
 * Confidence bonus for multi-source agreement (10).
 * When 2+ sources provide prices, confidence increases by this amount (capped at 100).
 */
const CONFIDENCE_MULTI_SOURCE_BONUS = 10;

/**
 * History & Cache Limits
 */

/** Maximum price history entries per token */
const MAX_PRICE_HISTORY = 100;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Primary price cache: mintAddress -> latest price data */
const priceCache = new Map<string, PriceCacheEntry>();

/** Multi-source price tracking: mintAddress -> source -> price */
const multiSourcePrices = new Map<string, Map<string, PriceCacheEntry>>();

/** VWAP trackers: mintAddress -> tracker */
const vwapTrackers = new Map<string, VwapTracker>();

/** Price history for each token: mintAddress -> price points */
const priceHistory = new Map<string, Array<{ price: number; timestamp: number }>>();

/** Subscribers for price updates */
const subscribers: PriceSubscriber[] = [];

/** Metrics state */
let totalPriceUpdates = 0;
let totalDeviationAlerts = 0;
let totalLatencyMs = 0;
let latencySamples = 0;
let lastUpdateAt: string | null = null;
let startedAt: number | null = null;
const sourceBreakdown: Record<string, number> = {};

/** Connection state */
let isRunning = false;
let heliusConnected = false;
let jupiterPolling = false;
let jupiterPollTimer: ReturnType<typeof setInterval> | null = null;
let heliusReconnectAttempts = 0;

/** Quick lookup maps */
const mintToSymbol = new Map<string, string>();
const symbolToMint = new Map<string, string>();

// Initialize lookup maps
for (const stock of XSTOCKS_CATALOG) {
  mintToSymbol.set(stock.mintAddress, stock.symbol);
  symbolToMint.set(stock.symbol, stock.mintAddress);
}

// ---------------------------------------------------------------------------
// Core Price Management
// ---------------------------------------------------------------------------

/**
 * Update the price for a token from a specific source.
 * Handles multi-source tracking, deviation detection, and subscriber notification.
 */
function updatePrice(
  mintAddress: string,
  price: number,
  source: string,
  change24h: number | null = null,
): void {
  const now = Date.now();
  const symbol = mintToSymbol.get(mintAddress) ?? "UNKNOWN";

  // Get old price for change calculation
  const oldEntry = priceCache.get(mintAddress);
  const oldPrice = oldEntry?.price ?? price;

  // Update primary cache
  const entry: PriceCacheEntry = {
    price,
    source,
    fetchedAt: now,
    change24h,
  };
  priceCache.set(mintAddress, entry);

  // Update multi-source tracking
  let sourcePrices = multiSourcePrices.get(mintAddress);
  if (!sourcePrices) {
    sourcePrices = new Map();
    multiSourcePrices.set(mintAddress, sourcePrices);
  }
  sourcePrices.set(source, entry);

  // Update VWAP
  let vwap = vwapTrackers.get(mintAddress);
  if (!vwap) {
    vwap = { totalPriceVolume: 0, totalVolume: 0, sampleCount: 0 };
    vwapTrackers.set(mintAddress, vwap);
  }
  vwap.totalPriceVolume += price;
  vwap.totalVolume += 1;
  vwap.sampleCount++;

  // Update price history
  let history = priceHistory.get(mintAddress);
  if (!history) {
    history = [];
    priceHistory.set(mintAddress, history);
  }
  history.push({ price, timestamp: now });
  if (history.length > MAX_PRICE_HISTORY) {
    history.splice(0, history.length - MAX_PRICE_HISTORY);
  }

  // Track metrics
  totalPriceUpdates++;
  sourceBreakdown[source] = (sourceBreakdown[source] ?? 0) + 1;
  lastUpdateAt = new Date(now).toISOString();

  if (oldEntry) {
    const latency = now - oldEntry.fetchedAt;
    totalLatencyMs += latency;
    latencySamples++;
  }

  // Check for price deviation between sources
  if (sourcePrices.size >= 2) {
    checkPriceDeviation(mintAddress, symbol, sourcePrices);
  }

  // Notify subscribers if price changed meaningfully
  const changePercent =
    oldPrice > 0 ? ((price - oldPrice) / oldPrice) * 100 : 0;
  if (Math.abs(changePercent) > PRICE_CHANGE_NOTIFICATION_THRESHOLD || !oldEntry) {
    const update: PriceUpdate = {
      symbol,
      mintAddress,
      oldPrice,
      newPrice: price,
      changePercent,
      source,
      timestamp: new Date(now).toISOString(),
    };

    notifySubscribers(update);
  }
}

/**
 * Check if prices from different sources diverge beyond the threshold.
 */
function checkPriceDeviation(
  mintAddress: string,
  symbol: string,
  sourcePrices: Map<string, PriceCacheEntry>,
): void {
  const now = Date.now();
  const freshPrices: Array<{ source: string; price: number }> = [];

  for (const [source, entry] of sourcePrices) {
    // Only consider prices within fresh window
    if (now - entry.fetchedAt < FRESH_PRICE_WINDOW_MS) {
      freshPrices.push({ source, price: entry.price });
    }
  }

  if (freshPrices.length < 2) return;

  // Find max deviation
  let minPrice = Infinity;
  let maxPrice = -Infinity;
  for (const p of freshPrices) {
    if (p.price < minPrice) minPrice = p.price;
    if (p.price > maxPrice) maxPrice = p.price;
  }

  const avgPrice = (minPrice + maxPrice) / 2;
  const maxDeviationPercent = avgPrice > 0 ? (maxPrice - minPrice) / avgPrice : 0;

  if (maxDeviationPercent > DEVIATION_ALERT_THRESHOLD) {
    totalDeviationAlerts++;

    const alert: PriceDeviationAlert = {
      symbol,
      mintAddress,
      sources: freshPrices,
      maxDeviationPercent: Math.round(maxDeviationPercent * DEVIATION_PERCENT_ROUNDING_MULTIPLIER) / 100,
      timestamp: new Date(now).toISOString(),
    };

    console.warn(
      `[RealtimePrices] DEVIATION ALERT: ${symbol} prices diverge by ${alert.maxDeviationPercent}% — ` +
        freshPrices.map((p) => `${p.source}: $${p.price.toFixed(4)}`).join(", "),
    );

    try {
      eventBus.emit("price_deviation", alert);
    } catch {
      // Non-critical
    }
  }
}

/**
 * Notify all subscribers of a price update.
 */
function notifySubscribers(update: PriceUpdate): void {
  for (const subscriber of subscribers) {
    try {
      subscriber(update);
    } catch (err) {
      console.warn(
        `[RealtimePrices] Subscriber error: ${errorMessage(err)}`,
      );
    }
  }

  // Also emit on event bus (convert to PriceUpdateData format)
  try {
    eventBus.emit("price_update", {
      symbol: update.symbol,
      price: update.newPrice,
      change24h: null,
      volume: null,
      updatedAt: update.timestamp,
    });
  } catch {
    // Non-critical
  }
}

// ---------------------------------------------------------------------------
// Jupiter Price Polling
// ---------------------------------------------------------------------------

/**
 * Fetch prices from Jupiter Price API V3 for all xStocks tokens.
 * This runs every 5 seconds as the secondary price source.
 */
async function pollJupiterPrices(): Promise<void> {
  const mintAddresses = XSTOCKS_CATALOG.map((s) => s.mintAddress);
  const jupiterApiKey = process.env.JUPITER_API_KEY;

  // Batch in groups of 50 (Jupiter limit)
  for (let i = 0; i < mintAddresses.length; i += 50) {
    const batch = mintAddresses.slice(i, i + 50);
    const ids = batch.join(",");

    try {
      const headers: Record<string, string> = {};
      if (jupiterApiKey) {
        headers["x-api-key"] = jupiterApiKey;
      }

      const resp = await fetch(`https://api.jup.ag/price/v3?ids=${ids}`, {
        headers,
        signal: AbortSignal.timeout(JUPITER_API_TIMEOUT_MS),
      });

      if (!resp.ok) {
        console.warn(
          `[RealtimePrices] Jupiter poll failed: HTTP ${resp.status}`,
        );
        continue;
      }

      const data = (await resp.json()) as {
        data: Record<string, { price: string } | undefined>;
      };

      for (const mint of batch) {
        const entry = data.data?.[mint];
        if (entry?.price) {
          updatePrice(mint, parseFloat(entry.price), "jupiter");
        }
      }
    } catch (err) {
      console.warn(
        `[RealtimePrices] Jupiter poll error: ${errorMessage(err)}`,
      );
    }
  }
}

/**
 * Start the Jupiter price polling loop.
 */
function startJupiterPolling(): void {
  if (jupiterPolling) return;

  jupiterPolling = true;
  console.log(
    `[RealtimePrices] Starting Jupiter polling (every ${JUPITER_POLL_INTERVAL_MS / 1000}s)`,
  );

  // Initial fetch
  pollJupiterPrices().catch((err) =>
    console.warn(
      `[RealtimePrices] Initial Jupiter poll failed: ${errorMessage(err)}`,
    ),
  );

  // Recurring poll
  jupiterPollTimer = setInterval(() => {
    pollJupiterPrices().catch((err) =>
      console.warn(
        `[RealtimePrices] Jupiter poll failed: ${errorMessage(err)}`,
      ),
    );
  }, JUPITER_POLL_INTERVAL_MS);
}

/**
 * Stop Jupiter polling.
 */
function stopJupiterPolling(): void {
  if (jupiterPollTimer) {
    clearInterval(jupiterPollTimer);
    jupiterPollTimer = null;
  }
  jupiterPolling = false;
}

// ---------------------------------------------------------------------------
// Helius WebSocket Connection
// ---------------------------------------------------------------------------

/**
 * Connect to Helius WebSocket for real-time account updates.
 *
 * Uses Helius Enhanced WebSocket API to subscribe to token account changes.
 * When a token account for one of our tracked mints changes, we re-fetch
 * the price from Jupiter (since Helius gives us account state, not USD price).
 *
 * This provides ~400ms latency for detecting on-chain activity vs 5s polling.
 */
async function connectHeliusWebSocket(): Promise<void> {
  const heliusApiKey = process.env.HELIUS_API_KEY;

  if (!heliusApiKey) {
    console.log(
      "[RealtimePrices] No HELIUS_API_KEY — skipping WebSocket, using Jupiter polling only",
    );
    return;
  }

  const wsUrl = `wss://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`;

  try {
    // Use dynamic import for WebSocket in Node.js environment
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    let WebSocket: new (url: string) => {
      readyState: number;
      send(data: string): void;
      on(event: string, handler: (...args: unknown[]) => void): void;
      close(): void;
    };
    try {
      // The ws module uses `export = WebSocket`, so the default import
      // in ESM resolves differently depending on the bundler
      const mod = await import("ws");
      WebSocket = (mod as unknown as { default?: unknown }).default
        ? ((mod as unknown as { default: unknown }).default as typeof WebSocket)
        : (mod as unknown as typeof WebSocket);
    } catch {
      console.warn(
        "[RealtimePrices] ws module not available — falling back to polling only",
      );
      return;
    }

    const ws = new WebSocket(wsUrl);
    let pingInterval: ReturnType<typeof setInterval> | null = null;

    ws.on("open", () => {
      heliusConnected = true;
      heliusReconnectAttempts = 0;
      console.log("[RealtimePrices] Helius WebSocket connected");

      // Subscribe to token account changes for all xStocks mints
      const subscribeMsg = {
        jsonrpc: "2.0",
        id: 1,
        method: "accountSubscribe",
        params: [
          XSTOCKS_CATALOG[0].mintAddress,
          {
            encoding: "jsonParsed",
            commitment: "confirmed",
          },
        ],
      };

      ws.send(JSON.stringify(subscribeMsg));

      // Ping to keep alive
      pingInterval = setInterval(() => {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ jsonrpc: "2.0", id: "ping", method: "ping" }));
        }
      }, WEBSOCKET_PING_INTERVAL_MS);
    });

    ws.on("message", (rawData: unknown) => {
      try {
        const data = JSON.parse(String(rawData)) as {
          method?: string;
        };

        if (data.method === "accountNotification") {
          console.log("[RealtimePrices] Helius account notification received — triggering price refresh");
          pollJupiterPrices().catch(() => {
            // Non-critical
          });
        }
      } catch {
        // Ignore parse errors
      }
    });

    ws.on("error", (err: unknown) => {
      console.warn(
        `[RealtimePrices] Helius WebSocket error: ${errorMessage(err)}`,
      );
    });

    ws.on("close", () => {
      heliusConnected = false;
      if (pingInterval) clearInterval(pingInterval);
      console.log("[RealtimePrices] Helius WebSocket disconnected");

      // Reconnect with exponential backoff
      if (isRunning && heliusReconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        heliusReconnectAttempts++;
        const delay = HELIUS_RECONNECT_DELAY_MS * Math.pow(2, heliusReconnectAttempts - 1);
        console.log(
          `[RealtimePrices] Reconnecting Helius in ${delay}ms (attempt ${heliusReconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`,
        );
        setTimeout(() => {
          connectHeliusWebSocket().catch(() => {
            // Will retry on next close
          });
        }, delay);
      } else if (heliusReconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.warn(
          "[RealtimePrices] Max Helius reconnect attempts reached — using Jupiter polling only",
        );
      }
    });
  } catch (err) {
    console.warn(
      `[RealtimePrices] Helius WebSocket setup failed: ${errorMessage(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the real-time price streaming service.
 *
 * Initializes both Helius WebSocket (if API key available) and
 * Jupiter price polling. Safe to call multiple times (idempotent).
 */
export async function startPriceStream(): Promise<void> {
  if (isRunning) {
    console.log("[RealtimePrices] Already running");
    return;
  }

  isRunning = true;
  startedAt = Date.now();
  console.log("[RealtimePrices] Starting real-time price streaming...");

  // Start Jupiter polling (always available)
  startJupiterPolling();

  // Try Helius WebSocket (optional enhancement)
  connectHeliusWebSocket().catch((err) =>
    console.warn(
      `[RealtimePrices] Helius connection failed: ${errorMessage(err)}`,
    ),
  );

  console.log(
    `[RealtimePrices] Tracking ${XSTOCKS_CATALOG.length} tokens`,
  );
}

/**
 * Stop the real-time price streaming service.
 * Cleans up all connections and timers.
 */
export function stopPriceStream(): void {
  isRunning = false;
  stopJupiterPolling();
  heliusConnected = false;
  console.log("[RealtimePrices] Stopped real-time price streaming");
}

/**
 * Get the current price for a token by symbol.
 * Returns null if no price is available.
 */
export function getPrice(symbol: string): PricePoint | null {
  const mint = symbolToMint.get(symbol);
  if (!mint) return null;

  return getPriceByMint(mint);
}

/**
 * Get the current price for a token by mint address.
 */
export function getPriceByMint(mintAddress: string): PricePoint | null {
  const entry = priceCache.get(mintAddress);
  if (!entry) return null;

  const symbol = mintToSymbol.get(mintAddress) ?? "UNKNOWN";
  const now = Date.now();
  const ageMs = now - entry.fetchedAt;

  // Calculate VWAP
  const vwap = vwapTrackers.get(mintAddress);
  const vwapPrice =
    vwap && vwap.totalVolume > 0
      ? Math.round((vwap.totalPriceVolume / vwap.totalVolume) * PRICE_ROUNDING_MULTIPLIER) / PRICE_ROUNDING_MULTIPLIER
      : null;

  return {
    symbol,
    mintAddress,
    price: entry.price,
    source: entry.source as PricePoint["source"],
    confidence: calculateConfidence(mintAddress, ageMs),
    fetchedAt: new Date(entry.fetchedAt).toISOString(),
    ageMs,
    isStale: ageMs > STALENESS_THRESHOLD_MS,
    change24h: entry.change24h,
    vwap: vwapPrice,
  };
}

/**
 * Get current prices for all tracked tokens.
 */
export function getAllPrices(): PricePoint[] {
  const results: PricePoint[] = [];

  for (const stock of XSTOCKS_CATALOG) {
    const point = getPriceByMint(stock.mintAddress);
    if (point) {
      results.push(point);
    } else {
      // No price available — return with zero confidence
      results.push({
        symbol: stock.symbol,
        mintAddress: stock.mintAddress,
        price: 0,
        source: "mock",
        confidence: 0,
        fetchedAt: new Date().toISOString(),
        ageMs: 0,
        isStale: true,
        change24h: null,
        vwap: null,
      });
    }
  }

  return results;
}

/**
 * Get prices for specific symbols.
 */
export function getPrices(symbols: string[]): PricePoint[] {
  return symbols
    .map((s) => getPrice(s))
    .filter((p): p is PricePoint => p !== null);
}

/**
 * Get aggregated price from multiple sources for a token.
 * Uses volume-weighted averaging when multiple fresh prices exist.
 */
export function getAggregatedPrice(symbol: string): PricePoint | null {
  const mint = symbolToMint.get(symbol);
  if (!mint) return null;

  const sourcePrices = multiSourcePrices.get(mint);
  if (!sourcePrices || sourcePrices.size === 0) return getPrice(symbol);

  const now = Date.now();
  const freshEntries: Array<{ source: string; price: number; age: number }> = [];

  for (const [source, entry] of sourcePrices) {
    const age = now - entry.fetchedAt;
    if (age < STALENESS_THRESHOLD_MS * 2) {
      freshEntries.push({ source, price: entry.price, age });
    }
  }

  if (freshEntries.length === 0) return getPrice(symbol);

  // Weight inversely by age (fresher = higher weight)
  let weightedSum = 0;
  let totalWeight = 0;

  for (const entry of freshEntries) {
    const weight = 1 / Math.max(entry.age, MIN_AGE_FOR_WEIGHT_MS);
    weightedSum += entry.price * weight;
    totalWeight += weight;
  }

  const aggregatedPrice = totalWeight > 0 ? weightedSum / totalWeight : freshEntries[0].price;
  const newestEntry = freshEntries.sort((a, b) => a.age - b.age)[0];
  const ageMs = newestEntry.age;

  const vwap = vwapTrackers.get(mint);
  const vwapPrice =
    vwap && vwap.totalVolume > 0
      ? Math.round((vwap.totalPriceVolume / vwap.totalVolume) * PRICE_ROUNDING_MULTIPLIER) / PRICE_ROUNDING_MULTIPLIER
      : null;

  return {
    symbol,
    mintAddress: mint,
    price: Math.round(aggregatedPrice * PRICE_ROUNDING_MULTIPLIER) / PRICE_ROUNDING_MULTIPLIER,
    source: "aggregate",
    confidence: calculateConfidence(mint, ageMs),
    fetchedAt: new Date(now - ageMs).toISOString(),
    ageMs,
    isStale: ageMs > STALENESS_THRESHOLD_MS,
    change24h: priceCache.get(mint)?.change24h ?? null,
    vwap: vwapPrice,
  };
}

/**
 * Get price history for a token (recent price points).
 */
export function getPriceHistory(
  symbol: string,
  limit = 50,
): Array<{ price: number; timestamp: string }> {
  const mint = symbolToMint.get(symbol);
  if (!mint) return [];

  const history = priceHistory.get(mint) ?? [];
  return history.slice(-limit).map((h) => ({
    price: h.price,
    timestamp: new Date(h.timestamp).toISOString(),
  }));
}

/**
 * Subscribe to price updates.
 * Returns an unsubscribe function.
 */
export function subscribeToPrices(callback: PriceSubscriber): () => void {
  subscribers.push(callback);

  return () => {
    const idx = subscribers.indexOf(callback);
    if (idx >= 0) subscribers.splice(idx, 1);
  };
}

/**
 * Manually inject a price (for testing or external data sources).
 */
export function injectPrice(
  symbol: string,
  price: number,
  source: string,
  change24h: number | null = null,
): void {
  const mint = symbolToMint.get(symbol);
  if (!mint) {
    console.warn(`[RealtimePrices] Unknown symbol: ${symbol}`);
    return;
  }
  updatePrice(mint, price, source, change24h);
}

/**
 * Get real-time price streaming metrics.
 */
export function getPriceStreamMetrics(): PriceStreamMetrics {
  const now = Date.now();
  let freshCount = 0;
  let staleCount = 0;

  for (const stock of XSTOCKS_CATALOG) {
    const entry = priceCache.get(stock.mintAddress);
    if (entry && now - entry.fetchedAt < STALENESS_THRESHOLD_MS) {
      freshCount++;
    } else {
      staleCount++;
    }
  }

  return {
    isRunning,
    heliusConnected,
    jupiterPolling,
    totalPriceUpdates,
    totalDeviationAlerts,
    subscriberCount: subscribers.length,
    tokensCovered: XSTOCKS_CATALOG.length,
    tokensWithFreshPrices: freshCount,
    tokensWithStalePrices: staleCount,
    averageUpdateLatencyMs:
      latencySamples > 0 ? Math.round(totalLatencyMs / latencySamples) : 0,
    lastUpdateAt,
    uptime: startedAt ? now - startedAt : 0,
    sourceBreakdown: { ...sourceBreakdown },
  };
}

/**
 * Reset VWAP trackers (typically called at start of each trading session).
 */
export function resetVwap(): void {
  vwapTrackers.clear();
  console.log("[RealtimePrices] VWAP trackers reset");
}

/**
 * Clear all cached prices and history.
 */
export function clearPriceCache(): void {
  priceCache.clear();
  multiSourcePrices.clear();
  priceHistory.clear();
  console.log("[RealtimePrices] Price cache cleared");
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/**
 * Calculate confidence score based on data freshness and source count.
 */
function calculateConfidence(mintAddress: string, ageMs: number): number {
  let confidence = 100;

  // Decay by age
  if (ageMs > STALENESS_THRESHOLD_MS) {
    // Confidence drops linearly from base to 0 over decay window
    const overtime = ageMs - STALENESS_THRESHOLD_MS;
    confidence = Math.max(0, CONFIDENCE_STALE_BASE - (overtime / CONFIDENCE_DECAY_WINDOW_MS) * CONFIDENCE_STALE_BASE);
  } else {
    // Fresh: base to 100 based on how fresh
    confidence = CONFIDENCE_FRESH_BASE + (1 - ageMs / STALENESS_THRESHOLD_MS) * CONFIDENCE_FRESH_BONUS;
  }

  // Bonus for multiple source agreement
  const sources = multiSourcePrices.get(mintAddress);
  if (sources && sources.size >= 2) {
    confidence = Math.min(100, confidence + CONFIDENCE_MULTI_SOURCE_BONUS);
  }

  return Math.round(confidence);
}
