/**
 * Alpha Vantage News & Sentiment Provider
 *
 * Fetches real market news and sentiment via Alpha Vantage API (free tier).
 * Provides news with sentiment scores (-1 to +1) for improved agent decision-making.
 *
 * Free tier: 500 requests/day (no cost vs Brave Search $5/month).
 */

import { XSTOCKS_CATALOG } from "../config/constants.ts";
import { errorMessage } from "../lib/errors.ts";
import type { NewsItem } from "./search-cache.ts";

// ---------------------------------------------------------------------------
// Symbol Mapping
// ---------------------------------------------------------------------------

/** Map xStock symbols to real ticker symbols (AAPLx -> AAPL) */
const XSTOCK_TO_TICKER: Record<string, string> = {};
for (const stock of XSTOCKS_CATALOG) {
  // Strip trailing "x": "AAPLx" -> "AAPL"
  const ticker = stock.symbol.replace(/x$/i, "");
  XSTOCK_TO_TICKER[stock.symbol] = ticker;
}

// ---------------------------------------------------------------------------
// Alpha Vantage API Types
// ---------------------------------------------------------------------------

interface AlphaVantageNewsArticle {
  title?: string;
  url?: string;
  time_published?: string; // Format: "20260206T150000"
  summary?: string;
  source?: string;
  overall_sentiment_score?: number; // -1 (bearish) to +1 (bullish)
  overall_sentiment_label?: string; // "Bearish" | "Somewhat-Bearish" | "Neutral" | "Somewhat-Bullish" | "Bullish"
  ticker_sentiment?: Array<{
    ticker: string;
    relevance_score: string; // "0.5"
    ticker_sentiment_score: string; // "-0.2"
    ticker_sentiment_label: string;
  }>;
}

interface AlphaVantageResponse {
  items?: string; // Number of items as string
  sentiment_score_definition?: string;
  relevance_score_definition?: string;
  feed?: AlphaVantageNewsArticle[];
}

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/** Sentiment score threshold for positive classification */
const SENTIMENT_POSITIVE_THRESHOLD = 0.15;

/** Sentiment score threshold for negative classification */
const SENTIMENT_NEGATIVE_THRESHOLD = -0.15;

/** Maximum articles to fetch per API query */
const ARTICLES_PER_QUERY = 10;

/** API request timeout in milliseconds */
const FETCH_TIMEOUT_MS = 10000;

/** Maximum length for article summary truncation */
const SUMMARY_MAX_LENGTH = 400;

/** Maximum symbols to fetch per batch (conserves API quota) */
const MAX_SYMBOLS_PER_BATCH = 5;

/** Rate limit delay between requests in milliseconds (5 req/min = 12s spacing) */
const RATE_LIMIT_DELAY_MS = 12000;

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/** Cache results for 6 hours to stay under 500 req/day limit */
const NEWS_CACHE = new Map<string, { items: NewsItem[]; fetchedAt: number }>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// ---------------------------------------------------------------------------
// Alpha Vantage API
// ---------------------------------------------------------------------------

/**
 * Fetch news and sentiment from Alpha Vantage for a ticker symbol.
 * Free tier: 500 requests/day (no API key cost).
 */
async function fetchAlphaVantageNews(
  ticker: string,
  apiKey: string,
): Promise<NewsItem[]> {
  try {
    const url = new URL("https://www.alphavantage.co/query");
    url.searchParams.set("function", "NEWS_SENTIMENT");
    url.searchParams.set("tickers", ticker);
    url.searchParams.set("limit", String(ARTICLES_PER_QUERY));
    url.searchParams.set("apikey", apiKey);

    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.warn(`[AlphaVantage] Ticker ${ticker} failed: ${res.status}`);
      return [];
    }

    const data = (await res.json()) as AlphaVantageResponse;

    // Check for API limit errors
    if ("Note" in data || "Information" in data) {
      console.warn(`[AlphaVantage] API limit reached or error for ${ticker}`);
      return [];
    }

    const feed = data.feed ?? [];
    const items: NewsItem[] = [];

    for (const article of feed) {
      if (!article.title || !article.url) continue;

      // Parse sentiment score to sentiment label
      const sentimentScore = article.overall_sentiment_score ?? 0;
      let sentiment: NewsItem["sentiment"] = "neutral";
      if (sentimentScore > SENTIMENT_POSITIVE_THRESHOLD) sentiment = "positive";
      else if (sentimentScore < SENTIMENT_NEGATIVE_THRESHOLD) sentiment = "negative";

      // Parse published date
      const timePublished = article.time_published ?? "";
      let publishedAt: string;
      try {
        // Convert "20260206T150000" to ISO format
        const year = timePublished.slice(0, 4);
        const month = timePublished.slice(4, 6);
        const day = timePublished.slice(6, 8);
        const hour = timePublished.slice(9, 11);
        const minute = timePublished.slice(11, 13);
        const second = timePublished.slice(13, 15);
        publishedAt = new Date(
          `${year}-${month}-${day}T${hour}:${minute}:${second}Z`,
        ).toISOString();
      } catch {
        publishedAt = new Date().toISOString();
      }

      items.push({
        title: article.title,
        summary: (article.summary ?? "").slice(0, SUMMARY_MAX_LENGTH),
        source: article.source ?? "Alpha Vantage",
        url: article.url,
        publishedAt,
        sentiment,
        relevantSymbols: [XSTOCK_TO_TICKER[ticker] ? ticker : `${ticker}x`],
      });
    }

    return items;
  } catch (err) {
    console.warn(
      `[AlphaVantage] Error fetching ${ticker}: ${errorMessage(err)}`,
    );
    return [];
  }
}

// ---------------------------------------------------------------------------
// Search Provider (plugs into search-cache)
// ---------------------------------------------------------------------------

/**
 * Alpha Vantage search provider for the search cache.
 * Fetches news with sentiment scores for top symbols.
 * Uses 6-hour cache to stay under 500 req/day free tier limit.
 */
export async function alphaVantageSearchProvider(
  symbols: string[],
): Promise<NewsItem[]> {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) {
    console.warn(
      "[AlphaVantage] ALPHA_VANTAGE_API_KEY not set — skipping news fetch",
    );
    return [];
  }

  const now = Date.now();
  const allItems: NewsItem[] = [];

  // Limit to MAX_SYMBOLS_PER_BATCH to conserve API quota (500/day = ~20/hour)
  const topSymbols = symbols.slice(0, MAX_SYMBOLS_PER_BATCH);

  for (const symbol of topSymbols) {
    const ticker = XSTOCK_TO_TICKER[symbol];
    if (!ticker) continue;

    // Check cache first
    const cached = NEWS_CACHE.get(symbol);
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
      console.log(`[AlphaVantage] Using cached results for ${symbol}`);
      allItems.push(...cached.items);
      continue;
    }

    // Fetch fresh data
    const items = await fetchAlphaVantageNews(ticker, apiKey);
    if (items.length > 0) {
      NEWS_CACHE.set(symbol, { items, fetchedAt: now });
      allItems.push(...items);
    }

    // Rate limiting: wait between requests to stay under API limits
    // Free tier allows 500/day = ~20/hour = ~1 every 3 min sustained
    // But we can burst 5/min, so 12s spacing is safe
    await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
  }

  console.log(
    `[AlphaVantage] Fetched ${allItems.length} results for ${topSymbols.length} symbols`,
  );
  return allItems;
}

