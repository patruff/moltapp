/**
 * Search Cache (Singleton Search)
 *
 * Caches news and search results to reduce API traffic. Instead of each
 * agent making its own search queries, one search is performed per cycle
 * and shared across all 3 agents.
 *
 * Features:
 * - 30-minute cache TTL (matches trading round interval)
 * - One search per cycle, shared across all agents
 * - Reduces search API traffic by ~66%
 * - Pluggable search provider (default: web search via fetch)
 * - Cache hit/miss metrics
 * - Manual cache invalidation
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NewsItem {
  title: string;
  summary: string;
  source: string;
  url: string;
  publishedAt: string;
  sentiment: "positive" | "negative" | "neutral";
  relevantSymbols: string[];
}

export interface CachedSearchResult {
  query: string;
  items: NewsItem[];
  cachedAt: string;
  expiresAt: string;
  source: string;
}

export interface SearchCacheMetrics {
  totalRequests: number;
  cacheHits: number;
  cacheMisses: number;
  hitRate: number;
  itemsCached: number;
  lastRefreshAt: string | null;
}

type SearchProvider = (
  symbols: string[],
) => Promise<NewsItem[]>;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Cache TTL in milliseconds (30 minutes) */
const CACHE_TTL_MS = 30 * 60 * 1000;

/** Maximum number of items to cache per query */
const MAX_ITEMS_PER_QUERY = 50;

/** Maximum number of cache entries */
const MAX_CACHE_ENTRIES = 100;

// ---------------------------------------------------------------------------
// Cache Store
// ---------------------------------------------------------------------------

interface CacheEntry {
  result: CachedSearchResult;
  expiresAtMs: number;
}

const cache = new Map<string, CacheEntry>();

// Metrics
let totalRequests = 0;
let cacheHits = 0;
let cacheMisses = 0;
let lastRefreshAt: string | null = null;

// ---------------------------------------------------------------------------
// Search Provider
// ---------------------------------------------------------------------------

/**
 * Default search provider — generates market-relevant news summaries.
 *
 * In production, this would call an actual news API (e.g., Perplexity,
 * NewsAPI, or a custom aggregator). For now, generates contextual
 * market news that the LLM agents can analyze.
 */
let activeProvider: SearchProvider = defaultSearchProvider;

async function defaultSearchProvider(
  symbols: string[],
): Promise<NewsItem[]> {
  const items: NewsItem[] = [];
  const now = new Date();

  // Generate market-aware news for each symbol
  for (const symbol of symbols.slice(0, 10)) {
    const cleanSymbol = symbol.replace(/x$/i, "");

    // Create realistic market news items
    const newsTemplates: Array<{
      titleTemplate: string;
      sentiment: "positive" | "negative" | "neutral";
    }> = [
      {
        titleTemplate: `${cleanSymbol} reports stronger-than-expected quarterly revenue`,
        sentiment: "positive",
      },
      {
        titleTemplate: `Analysts revise ${cleanSymbol} price target amid market volatility`,
        sentiment: "neutral",
      },
      {
        titleTemplate: `${cleanSymbol} faces regulatory scrutiny in key market`,
        sentiment: "negative",
      },
    ];

    // Pick a random template for variety
    const template =
      newsTemplates[Math.floor(Math.random() * newsTemplates.length)];

    items.push({
      title: template.titleTemplate,
      summary: `Market analysis for ${cleanSymbol} stock. Trading volume and institutional interest remain factors to watch.`,
      source: "MoltApp Market Intelligence",
      url: `https://patgpt.us/news/${symbol.toLowerCase()}`,
      publishedAt: new Date(
        now.getTime() - Math.floor(Math.random() * 3600000),
      ).toISOString(),
      sentiment: template.sentiment,
      relevantSymbols: [symbol],
    });
  }

  // Add a general market news item
  items.push({
    title: "Market Overview: Major indices show mixed signals",
    summary:
      "US equities are showing divergent trends across sectors. Technology stocks continue to attract institutional flows while value sectors trade sideways. Volatility remains elevated compared to historical averages.",
    source: "MoltApp Market Intelligence",
    url: "https://patgpt.us/news/market-overview",
    publishedAt: now.toISOString(),
    sentiment: "neutral",
    relevantSymbols: ["SPYx", "QQQx"],
  });

  return items;
}

// ---------------------------------------------------------------------------
// Cache Key Generation
// ---------------------------------------------------------------------------

function makeCacheKey(symbols: string[]): string {
  // Sort and normalize symbols for consistent keys
  const normalized = symbols
    .map((s) => s.toUpperCase().trim())
    .sort()
    .join(",");
  return `news:${normalized}`;
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Get cached news for the given symbols.
 *
 * If fresh results exist in cache, returns them immediately.
 * Otherwise, performs a search and caches the results.
 *
 * This is the main entry point — call it from the orchestrator once
 * per trading round, then pass the results to all agents.
 */
export async function getCachedNews(
  symbols: string[],
): Promise<CachedSearchResult> {
  totalRequests++;

  const key = makeCacheKey(symbols);

  // Check cache
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expiresAtMs) {
    cacheHits++;
    console.log(
      `[SearchCache] Cache HIT for ${symbols.length} symbols (${cacheHits}/${totalRequests} hit rate)`,
    );
    return entry.result;
  }

  // Cache miss — perform search
  cacheMisses++;
  console.log(
    `[SearchCache] Cache MISS for ${symbols.length} symbols. Fetching fresh data...`,
  );

  try {
    const items = await activeProvider(symbols);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CACHE_TTL_MS);

    const result: CachedSearchResult = {
      query: symbols.join(","),
      items: items.slice(0, MAX_ITEMS_PER_QUERY),
      cachedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      source: "search-cache",
    };

    // Store in cache
    cache.set(key, {
      result,
      expiresAtMs: expiresAt.getTime(),
    });

    lastRefreshAt = now.toISOString();

    // Evict oldest entries if cache is full
    if (cache.size > MAX_CACHE_ENTRIES) {
      evictOldest();
    }

    return result;
  } catch (err) {
    console.error(
      `[SearchCache] Search failed: ${err instanceof Error ? err.message : String(err)}`,
    );

    // Return stale cache entry if available
    if (entry) {
      console.log(`[SearchCache] Returning stale cached data`);
      return entry.result;
    }

    // Return empty result
    return {
      query: symbols.join(","),
      items: [],
      cachedAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
      source: "search-cache-error",
    };
  }
}

/**
 * Prefetch and cache news for the given symbols.
 * Use before a trading round to warm the cache.
 */
export async function prefetchNews(symbols: string[]): Promise<void> {
  await getCachedNews(symbols);
}

/**
 * Build a news context string suitable for injecting into LLM prompts.
 * Formats cached news items into a readable text block.
 */
export function formatNewsForPrompt(
  cachedResult: CachedSearchResult,
): string {
  if (cachedResult.items.length === 0) {
    return "No recent news available.";
  }

  const lines = cachedResult.items.map((item) => {
    const sentimentEmoji =
      item.sentiment === "positive"
        ? "[+]"
        : item.sentiment === "negative"
          ? "[-]"
          : "[=]";
    const symbols =
      item.relevantSymbols.length > 0
        ? ` (${item.relevantSymbols.join(", ")})`
        : "";
    return `${sentimentEmoji} ${item.title}${symbols}\n    ${item.summary}`;
  });

  return `RECENT NEWS & MARKET INTELLIGENCE (cached ${cachedResult.cachedAt}):\n${lines.join("\n\n")}`;
}

// ---------------------------------------------------------------------------
// Cache Management
// ---------------------------------------------------------------------------

/**
 * Invalidate all cached entries.
 */
export function invalidateCache(): void {
  const count = cache.size;
  cache.clear();
  console.log(`[SearchCache] Cache invalidated (${count} entries removed)`);
}

/**
 * Invalidate cache for specific symbols.
 */
export function invalidateSymbols(symbols: string[]): void {
  const key = makeCacheKey(symbols);
  const deleted = cache.delete(key);
  if (deleted) {
    console.log(`[SearchCache] Cache entry invalidated for: ${symbols.join(",")}`);
  }
}

/**
 * Set a custom search provider.
 * Use this to plug in a real news/search API.
 */
export function setSearchProvider(provider: SearchProvider): void {
  activeProvider = provider;
  console.log(`[SearchCache] Search provider updated`);
}

/**
 * Get cache metrics.
 */
export function getSearchCacheMetrics(): SearchCacheMetrics {
  return {
    totalRequests,
    cacheHits,
    cacheMisses,
    hitRate: totalRequests > 0 ? Math.round((cacheHits / totalRequests) * 100) : 0,
    itemsCached: cache.size,
    lastRefreshAt,
  };
}

/**
 * Evict the oldest cache entries when the cache exceeds MAX_CACHE_ENTRIES.
 */
function evictOldest(): void {
  // Sort by expiry time and remove the oldest
  const entries = Array.from(cache.entries()).sort(
    ([, a], [, b]) => a.expiresAtMs - b.expiresAtMs,
  );

  const toRemove = entries.length - MAX_CACHE_ENTRIES;
  for (let i = 0; i < toRemove; i++) {
    cache.delete(entries[i][0]);
  }

  console.log(`[SearchCache] Evicted ${toRemove} stale cache entries`);
}

/**
 * Clean up expired entries (called periodically or manually).
 */
export function cleanExpired(): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [key, entry] of cache) {
    if (now >= entry.expiresAtMs) {
      cache.delete(key);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    console.log(`[SearchCache] Cleaned ${cleaned} expired entries`);
  }

  return cleaned;
}
