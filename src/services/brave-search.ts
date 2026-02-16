/**
 * Brave Search Provider
 *
 * Fetches real market news via Brave Web Search API and returns
 * results in the NewsItem format consumed by the search cache.
 * Searches the top 6 symbols by absolute price change to limit latency.
 */

import { XSTOCKS_CATALOG } from "../config/constants.ts";
import type { NewsItem } from "./search-cache.ts";
import { errorMessage } from "../lib/errors.ts";

// ---------------------------------------------------------------------------
// News Search Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Maximum number of search results to request from Brave API per query.
 *
 * Controls API latency and data volume. Brave charges per request, so limiting
 * result count helps manage API costs while still providing diverse news coverage.
 *
 * @example
 * // With BRAVE_API_RESULT_LIMIT = 5:
 * // - 6 symbol queries × 5 results = 30 news items
 * // - 1 market query × 5 results = 5 news items
 * // - Total: 35 news items per search cycle
 */
const BRAVE_API_RESULT_LIMIT = 5;

/**
 * Maximum character length for news article descriptions.
 *
 * Truncates long descriptions to improve LLM context window efficiency and
 * reduce token consumption during sentiment analysis. 300 characters typically
 * captures the lede paragraph with key market-moving information.
 *
 * @example "Apple Inc. shares surged 5% today after the company announced..." (truncated at 300 chars)
 */
const NEWS_DESCRIPTION_MAX_LENGTH = 300;

/**
 * Maximum number of symbols to query per Brave search cycle.
 *
 * Limits API latency and cost by focusing on most relevant stocks (typically
 * sorted by absolute price change). Each symbol query takes ~200-500ms, so
 * 6 symbols = ~1-3 seconds total latency per search cycle.
 *
 * Formula: 6 symbols + 1 general market query = 7 total API calls per cycle
 *
 * @example
 * // If symbols = ["AAPLx", "TSLAx", "NVDAx", "GOOGx", "MSFTx", "AMZNx", "METAx", "NEFLXx"]
 * // Only first 6 are queried: AAPLx, TSLAx, NVDAx, GOOGx, MSFTx, AMZNx
 */
const MAX_SYMBOLS_PER_BRAVE_SEARCH = 6;

// ---------------------------------------------------------------------------
// Symbol-to-real-name mapping (derived from XSTOCKS_CATALOG)
// ---------------------------------------------------------------------------

const SYMBOL_TO_NAME: Record<string, string> = {};
for (const stock of XSTOCKS_CATALOG) {
  // Strip trailing "x" for search queries: "AAPLx" -> "AAPL"
  const ticker = stock.symbol.replace(/x$/i, "");
  SYMBOL_TO_NAME[stock.symbol] = `${stock.name} ${ticker}`;
}

// ---------------------------------------------------------------------------
// Brave Search API
// ---------------------------------------------------------------------------

/** Brave Search API response structure */
interface BraveSearchResponse {
  web?: {
    results?: Array<{
      title?: string;
      description?: string;
      url?: string;
    }>;
  };
}

async function braveSearch(query: string, apiKey: string): Promise<Array<{ title: string; description: string; url: string }>> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(BRAVE_API_RESULT_LIMIT));

  const res = await fetch(url.toString(), {
    headers: {
      "X-Subscription-Token": apiKey,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    console.warn(`[BraveSearch] Query "${query}" failed: ${res.status}`);
    return [];
  }

  const data = (await res.json()) as BraveSearchResponse;
  const results = data.web?.results ?? [];
  return results.slice(0, BRAVE_API_RESULT_LIMIT).map((r) => ({
    title: r.title ?? "",
    description: (r.description ?? "").slice(0, NEWS_DESCRIPTION_MAX_LENGTH),
    url: r.url ?? "",
  }));
}

// ---------------------------------------------------------------------------
// Search Provider (plugs into search-cache via setSearchProvider)
// ---------------------------------------------------------------------------

/**
 * Brave search provider for the search cache.
 * Searches the top symbols (by name) for recent stock news.
 */
export async function braveSearchProvider(symbols: string[]): Promise<NewsItem[]> {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) {
    console.warn("[BraveSearch] BRAVE_API_KEY not set — falling back to default provider");
    return [];
  }

  // Limit symbols to keep latency reasonable
  const topSymbols = symbols.slice(0, MAX_SYMBOLS_PER_BRAVE_SEARCH);
  const items: NewsItem[] = [];
  const now = new Date();

  for (const symbol of topSymbols) {
    const realName = SYMBOL_TO_NAME[symbol] ?? symbol.replace(/x$/i, "");
    const query = `${realName} stock news today 2026`;

    try {
      const results = await braveSearch(query, apiKey);
      for (const r of results) {
        items.push({
          title: r.title,
          summary: r.description,
          source: "Brave Search",
          url: r.url,
          publishedAt: now.toISOString(),
          sentiment: "neutral", // Let the LLM interpret sentiment
          relevantSymbols: [symbol],
        });
      }
    } catch (err) {
      console.warn(`[BraveSearch] Error searching ${symbol}: ${errorMessage(err)}`);
    }
  }

  // Add general market query
  try {
    const marketResults = await braveSearch("stock market news today 2026", apiKey);
    for (const r of marketResults) {
      items.push({
        title: r.title,
        summary: r.description,
        source: "Brave Search",
        url: r.url,
        publishedAt: now.toISOString(),
        sentiment: "neutral",
        relevantSymbols: ["SPYx", "QQQx"],
      });
    }
  } catch (err) {
    console.warn(`[BraveSearch] Market overview search failed: ${errorMessage(err)}`);
  }

  console.log(`[BraveSearch] Fetched ${items.length} results for ${topSymbols.length} symbols`);
  return items;
}
