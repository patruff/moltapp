/**
 * Brave Search Provider
 *
 * Fetches real market news via Brave Web Search API and returns
 * results in the NewsItem format consumed by the search cache.
 * Searches the top 6 symbols by absolute price change to limit latency.
 */

import { XSTOCKS_CATALOG } from "../config/constants.ts";
import type { NewsItem } from "./search-cache.ts";

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

async function braveSearch(query: string, apiKey: string): Promise<Array<{ title: string; description: string; url: string }>> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", "5");

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

  const data = (await res.json()) as any;
  const results = data.web?.results ?? [];
  return results.slice(0, 5).map((r: any) => ({
    title: r.title ?? "",
    description: (r.description ?? "").slice(0, 300),
    url: r.url ?? "",
  }));
}

// ---------------------------------------------------------------------------
// Search Provider (plugs into search-cache via setSearchProvider)
// ---------------------------------------------------------------------------

/**
 * Brave search provider for the search cache.
 * Searches the top 6 symbols (by name) for recent stock news.
 */
export async function braveSearchProvider(symbols: string[]): Promise<NewsItem[]> {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) {
    console.warn("[BraveSearch] BRAVE_API_KEY not set — falling back to default provider");
    return [];
  }

  // Limit to 6 symbols to keep latency reasonable
  const topSymbols = symbols.slice(0, 6);
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
      console.warn(`[BraveSearch] Error searching ${symbol}: ${err instanceof Error ? err.message : String(err)}`);
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
    console.warn(`[BraveSearch] Market overview search failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  console.log(`[BraveSearch] Fetched ${items.length} results for ${topSymbols.length} symbols`);
  return items;
}
