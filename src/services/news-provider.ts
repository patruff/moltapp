/**
 * News & Market Intelligence Provider
 *
 * Real news API integration for the search-cache system. Supports multiple
 * providers with automatic fallback:
 *
 * 1. Perplexity AI — real-time market intelligence via sonar API
 * 2. Alpha Vantage — news sentiment for specific stocks
 * 3. Fallback — mock data when no API keys are configured
 *
 * This module replaces the mock defaultSearchProvider in search-cache.ts
 * with real market intelligence that agents can actually analyze.
 */

import type { NewsItem } from "./search-cache.ts";
import { errorMessage } from "../lib/errors.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PerplexityMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface PerplexityResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
  citations?: string[];
}

interface AlphaVantageNewsItem {
  title: string;
  url: string;
  summary: string;
  source: string;
  time_published: string;
  overall_sentiment_score: number;
  overall_sentiment_label: string;
  ticker_sentiment?: Array<{
    ticker: string;
    relevance_score: string;
    ticker_sentiment_score: string;
    ticker_sentiment_label: string;
  }>;
}

interface AlphaVantageNewsResponse {
  feed?: AlphaVantageNewsItem[];
  Note?: string;
  Information?: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions";
const ALPHA_VANTAGE_BASE = "https://www.alphavantage.co/query";

/** Max news items per provider per request */
const MAX_ITEMS_PER_PROVIDER = 15;

/** Request timeout in ms */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * News Content Limits & Truncation Constants
 *
 * These control how much content is queried, processed, and stored
 * from news APIs to optimize API costs, LLM token usage, and memory.
 */

/**
 * Maximum number of stock symbols to query per news API request.
 *
 * Purpose: Limits API call complexity and response size
 * - Perplexity API cost scales with query complexity
 * - More symbols = longer prompts = higher token costs
 * - 10 symbols typically provides sufficient market coverage
 *
 * Impact: Used in fetchPerplexityNews() to limit query scope
 * Formula: cleanSymbols = symbols.slice(0, MAX_SYMBOLS_PER_NEWS_QUERY)
 */
const MAX_SYMBOLS_PER_NEWS_QUERY = 10;

/**
 * Maximum length for news item summaries/descriptions in characters.
 *
 * Purpose: Prevents excessive memory usage and improves LLM context efficiency
 * - 500 characters typically captures the full lede + key details
 * - Longer summaries consume more tokens in agent prompts
 * - Truncation happens after API response parsing
 *
 * Impact: Used to trim summary fields before storage
 * Example: "Apple announces new iPhone with..." (500 chars, ~100 tokens)
 */
const NEWS_SUMMARY_MAX_LENGTH = 500;

/**
 * Maximum length for API error messages in logs.
 *
 * Purpose: Prevents log spam from verbose API error responses
 * - Some APIs return full HTML error pages (>10KB)
 * - 200 characters sufficient to capture error code + first line
 *
 * Impact: Used in Perplexity error handling
 * Example: "Perplexity API error 429: Rate limit exceeded, retry after 60s"
 */
const API_ERROR_TEXT_MAX_LENGTH = 200;

/**
 * Maximum number of stock symbols to attribute to a single news item.
 *
 * Purpose: Limits relevantSymbols array size for generic/fallback news
 * - Most news items are relevant to 1-3 stocks maximum
 * - Larger arrays waste memory and dilute relevance signals
 * - 2 symbols is optimal for sector-level news attribution
 *
 * Impact: Used as fallback when API doesn't provide ticker mapping
 * Example: Fed rate decision → [xSPYx, xQQQx] (broad market impact)
 */
const RELEVANT_SYMBOLS_MAX_COUNT = 2;

/**
 * Number of top symbols to include in fallback news items.
 *
 * Purpose: When API fails, create fallback item for top N queried symbols
 * - 5 symbols provides useful coverage without overwhelming the item
 * - Matches typical "top holdings" or "top movers" list size
 *
 * Impact: Used in Perplexity error fallback path
 * Example: If query fails for [AAPLx, MSFTx, GOOGx, ...], attribute to first 5
 */
const FALLBACK_NEWS_SYMBOLS_COUNT = 5;

/**
 * Number of symbols to query in Alpha Vantage API requests.
 *
 * Purpose: Limits query complexity for AV News Sentiment API
 * - Alpha Vantage free tier: 25 requests/day
 * - More symbols per request = better rate limit efficiency
 * - 5 symbols is optimal (balance between coverage and response time)
 *
 * Impact: Used in fetchAlphaVantageNews() ticker list
 * Note: This is separate from MAX_SYMBOLS_PER_NEWS_QUERY because AV has
 *       different API constraints than Perplexity
 */
const ALPHA_VANTAGE_SYMBOLS_PER_REQUEST = 5;

/**
 * Deduplication Constants
 *
 * Control how news items are deduplicated across multiple providers.
 */

/**
 * Character length for title similarity matching in deduplication.
 *
 * Purpose: Detect duplicate news items with similar headlines
 * - Compare first 30 characters of each title (case-insensitive)
 * - 30 chars typically captures the core subject of the headline
 * - Shorter = more aggressive deduplication (may merge distinct stories)
 * - Longer = less deduplication (may keep near-duplicates)
 *
 * Impact: Used in deduplication logic to identify similar titles
 * Example: "Apple Announces iPhone 16 with..." vs "Apple Announces iPhone 16 Pro..."
 *          First 30 chars: "Apple Announces iPhone 16 wit" (match = deduplicate)
 *
 * Formula: title1.slice(0, 30) compared with title2.slice(0, 30)
 */
const TITLE_DEDUP_MATCH_LENGTH = 30;

/**
 * Date Parsing Constants
 *
 * Alpha Vantage time format: YYYYMMDDTHHMMSS (e.g., "20240215T143000")
 */

/** Character position where year ends in AV timestamp (YYYY) */
const AV_TIMESTAMP_YEAR_END = 4;

/** Character position where month ends in AV timestamp (YYYYMM) */
const AV_TIMESTAMP_MONTH_END = 6;

/** Character position where day ends in AV timestamp (YYYYMMDD) */
const AV_TIMESTAMP_DAY_END = 8;

/** Character position where hour starts in AV timestamp (YYYYMMDDTHH) */
const AV_TIMESTAMP_HOUR_START = 9;

/** Character position where hour ends in AV timestamp */
const AV_TIMESTAMP_HOUR_END = 11;

/** Character position where minute ends in AV timestamp */
const AV_TIMESTAMP_MIN_END = 13;

/** Character position where second ends in AV timestamp */
const AV_TIMESTAMP_SEC_END = 15;

/**
 * JSON Markdown Cleanup Constants
 *
 * Perplexity sometimes wraps JSON responses in markdown code blocks.
 */

/** Length of "```json" prefix (7 characters) */
const JSON_MARKDOWN_PREFIX_TYPED = 7;

/** Length of "```" prefix (3 characters) */
const JSON_MARKDOWN_PREFIX_GENERIC = 3;

/**
 * Perplexity API Request Parameters
 *
 * Control the LLM generation settings for Perplexity news queries.
 */

/**
 * Maximum tokens for Perplexity API response.
 *
 * Purpose: Limits response length and API cost
 * - 2048 tokens is sufficient for 5-10 structured JSON news items
 * - Each news item ~150-200 tokens (title + summary + metadata)
 * - Higher values = longer responses but more expensive
 *
 * Impact: Used in fetchPerplexityNews() API request body
 */
const PERPLEXITY_MAX_TOKENS = 2048;

/**
 * Temperature for Perplexity API requests.
 *
 * Purpose: Controls randomness/creativity in LLM responses
 * - 0.1 = very deterministic (consistent structured JSON output)
 * - Higher values = more creative but less reliable JSON parsing
 * - Low temperature critical for structured JSON news output
 *
 * Impact: Used in fetchPerplexityNews() API request body
 */
const PERPLEXITY_TEMPERATURE = 0.1;

/**
 * Minimum content length to attempt fallback news parsing.
 *
 * Purpose: Avoid creating empty/useless fallback news items
 * - Content < 20 characters is likely an error message, not useful news
 * - 20 chars minimum ensures fallback has meaningful text to show
 *
 * Impact: Used in parsePerplexityResponse() error fallback path
 */
const MIN_CONTENT_LENGTH_FOR_FALLBACK = 20;

/**
 * Alpha Vantage Sentiment Classification Thresholds
 *
 * Alpha Vantage returns sentiment scores on a continuous scale.
 * These thresholds classify scores into positive/negative/neutral buckets.
 */

/**
 * Alpha Vantage sentiment score threshold for "positive" classification.
 *
 * Purpose: Maps AV continuous sentiment score (-1 to +1) to positive label
 * - Score > 0.15 = "positive" (bullish news)
 * - Score -0.15 to 0.15 = "neutral" (balanced or ambiguous coverage)
 * - Score < -0.15 = "negative" (bearish news)
 *
 * Impact: Used in fetchAlphaVantageNews() sentiment mapping
 * Source: Based on Alpha Vantage documentation for sentiment label boundaries
 */
const AV_SENTIMENT_POSITIVE_THRESHOLD = 0.15;

/**
 * Alpha Vantage ticker relevance score threshold for inclusion.
 *
 * Purpose: Filters low-relevance ticker mentions from news attribution
 * - Score > 0.3 = ticker is significantly mentioned in the article
 * - Score 0-0.3 = ticker mentioned briefly or in passing (exclude)
 * - Prevents attributing articles to stocks they barely mention
 *
 * Impact: Used in fetchAlphaVantageNews() ticker sentiment filtering
 * Example: Fed rate decision article → AAPL relevance 0.1 (excluded), SPY 0.8 (included)
 */
const AV_TICKER_RELEVANCE_THRESHOLD = 0.3;

// ---------------------------------------------------------------------------
// Perplexity Provider
// ---------------------------------------------------------------------------

/**
 * Fetch market intelligence from Perplexity's sonar API.
 *
 * Perplexity provides real-time web search + LLM summarization,
 * making it ideal for getting current market news and analysis.
 */
async function fetchPerplexityNews(symbols: string[]): Promise<NewsItem[]> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    throw new Error("PERPLEXITY_API_KEY not configured");
  }

  const cleanSymbols = symbols.slice(0, MAX_SYMBOLS_PER_NEWS_QUERY).map((s) => s.replace(/x$/i, ""));
  const symbolList = cleanSymbols.join(", ");

  const messages: PerplexityMessage[] = [
    {
      role: "system",
      content: `You are a financial news analyst. Return ONLY valid JSON — no markdown, no explanation.
Return an array of news items about the requested stocks. Each item must have:
- title: headline string
- summary: 1-2 sentence summary
- source: source name
- url: source URL (use real URLs if known, otherwise use https://finance.yahoo.com)
- sentiment: exactly one of "positive", "negative", or "neutral"
- symbols: array of relevant stock tickers (e.g. ["AAPL", "MSFT"])

Return 5-10 items covering the most important recent developments.`,
    },
    {
      role: "user",
      content: `What are the latest market-moving news and developments for these stocks: ${symbolList}? Include any relevant macro/sector news. Focus on the last 24 hours.`,
    },
  ];

  const resp = await fetch(PERPLEXITY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "sonar",
      messages,
      max_tokens: PERPLEXITY_MAX_TOKENS,
      temperature: PERPLEXITY_TEMPERATURE,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(
      `Perplexity API error ${resp.status}: ${text.slice(0, API_ERROR_TEXT_MAX_LENGTH)}`,
    );
  }

  const data = (await resp.json()) as PerplexityResponse;
  const content = data.choices?.[0]?.message?.content ?? "";
  const citations = data.citations ?? [];

  // Parse the JSON response
  const items = parsePerplexityResponse(content, symbols, citations);

  console.log(
    `[NewsProvider] Perplexity returned ${items.length} news items for ${cleanSymbols.length} symbols`,
  );

  return items;
}

/**
 * Parse Perplexity's response into NewsItem format.
 * Handles various response formats robustly.
 */
function parsePerplexityResponse(
  content: string,
  requestedSymbols: string[],
  citations: string[],
): NewsItem[] {
  const items: NewsItem[] = [];

  try {
    // Try to extract JSON array from response
    let cleaned = content.trim();
    if (cleaned.startsWith("```json")) {
      cleaned = cleaned.slice(JSON_MARKDOWN_PREFIX_TYPED);
    } else if (cleaned.startsWith("```")) {
      cleaned = cleaned.slice(JSON_MARKDOWN_PREFIX_GENERIC);
    }
    if (cleaned.endsWith("```")) {
      cleaned = cleaned.slice(0, -3);
    }
    cleaned = cleaned.trim();

    // Find JSON array
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!arrayMatch) {
      // Try to find individual JSON objects
      const objMatch = cleaned.match(/\{[\s\S]*\}/);
      if (objMatch) {
        cleaned = `[${objMatch[0]}]`;
      } else {
        throw new Error("No JSON found in Perplexity response");
      }
    } else {
      cleaned = arrayMatch[0];
    }

    const parsed = JSON.parse(cleaned) as Array<Record<string, unknown>>;

    for (const item of parsed.slice(0, MAX_ITEMS_PER_PROVIDER)) {
      const title = String(item.title ?? "");
      const summary = String(item.summary ?? item.description ?? "");
      const source = String(item.source ?? "Perplexity AI");
      const url = String(item.url ?? item.link ?? "");
      const rawSentiment = String(item.sentiment ?? "neutral").toLowerCase();
      const rawSymbols = Array.isArray(item.symbols)
        ? item.symbols.map(String)
        : Array.isArray(item.tickers)
          ? item.tickers.map(String)
          : [];

      if (!title) continue;

      // Normalize sentiment
      const sentiment: "positive" | "negative" | "neutral" =
        rawSentiment.includes("positive") || rawSentiment.includes("bullish")
          ? "positive"
          : rawSentiment.includes("negative") || rawSentiment.includes("bearish")
            ? "negative"
            : "neutral";

      // Map plain tickers to xStock symbols
      const relevantSymbols = rawSymbols.map((s: string) => {
        const clean = s.replace(/x$/i, "").toUpperCase();
        const match = requestedSymbols.find(
          (rs) => rs.replace(/x$/i, "").toUpperCase() === clean,
        );
        return match ?? `${clean}x`;
      });

      items.push({
        title,
        summary: summary || title,
        source,
        url: url || (citations[0] ?? `https://finance.yahoo.com/quote/${rawSymbols[0] ?? ""}`),
        publishedAt: new Date().toISOString(),
        sentiment,
        relevantSymbols:
          relevantSymbols.length > 0
            ? relevantSymbols
            : requestedSymbols.slice(0, RELEVANT_SYMBOLS_MAX_COUNT),
      });
    }
  } catch (err) {
    console.warn(
      `[NewsProvider] Failed to parse Perplexity response: ${errorMessage(err)}`,
    );

    // Create a single item from the raw text content
    if (content.length > MIN_CONTENT_LENGTH_FOR_FALLBACK) {
      items.push({
        title: "Market Intelligence Summary",
        summary: content.slice(0, NEWS_SUMMARY_MAX_LENGTH),
        source: "Perplexity AI",
        url: "https://perplexity.ai",
        publishedAt: new Date().toISOString(),
        sentiment: "neutral",
        relevantSymbols: requestedSymbols.slice(0, FALLBACK_NEWS_SYMBOLS_COUNT),
      });
    }
  }

  return items;
}

// ---------------------------------------------------------------------------
// Alpha Vantage Provider
// ---------------------------------------------------------------------------

/**
 * Fetch news sentiment from Alpha Vantage News API.
 * Free tier: 25 requests/day. Pro tier: much higher.
 */
async function fetchAlphaVantageNews(
  symbols: string[],
): Promise<NewsItem[]> {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) {
    throw new Error("ALPHA_VANTAGE_API_KEY not configured");
  }

  // Alpha Vantage uses regular tickers, not xStock symbols
  const tickers = symbols
    .slice(0, ALPHA_VANTAGE_SYMBOLS_PER_REQUEST)
    .map((s) => s.replace(/x$/i, ""))
    .join(",");

  const url = `${ALPHA_VANTAGE_BASE}?function=NEWS_SENTIMENT&tickers=${tickers}&limit=${MAX_ITEMS_PER_PROVIDER}&apikey=${apiKey}`;

  const resp = await fetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!resp.ok) {
    throw new Error(`Alpha Vantage API error: ${resp.status}`);
  }

  const data = (await resp.json()) as AlphaVantageNewsResponse;

  // Check for rate limit / info messages
  if (data.Note || data.Information) {
    throw new Error(
      `Alpha Vantage rate limit: ${data.Note ?? data.Information}`,
    );
  }

  if (!data.feed || data.feed.length === 0) {
    return [];
  }

  const items: NewsItem[] = data.feed
    .slice(0, MAX_ITEMS_PER_PROVIDER)
    .map((item) => {
      // Map AV sentiment to our format
      const score = item.overall_sentiment_score;
      const sentiment: "positive" | "negative" | "neutral" =
        score > AV_SENTIMENT_POSITIVE_THRESHOLD ? "positive" : score < -AV_SENTIMENT_POSITIVE_THRESHOLD ? "negative" : "neutral";

      // Map tickers to xStock symbols
      const relevantSymbols = (item.ticker_sentiment ?? [])
        .filter((ts) => parseFloat(ts.relevance_score) > AV_TICKER_RELEVANCE_THRESHOLD)
        .map((ts) => {
          const match = symbols.find(
            (s) =>
              s.replace(/x$/i, "").toUpperCase() === ts.ticker.toUpperCase(),
          );
          return match ?? `${ts.ticker}x`;
        });

      // Parse AV time format: YYYYMMDDTHHMMSS
      let publishedAt: string;
      try {
        const raw = item.time_published;
        const year = raw.slice(0, AV_TIMESTAMP_YEAR_END);
        const month = raw.slice(AV_TIMESTAMP_YEAR_END, AV_TIMESTAMP_MONTH_END);
        const day = raw.slice(AV_TIMESTAMP_MONTH_END, AV_TIMESTAMP_DAY_END);
        const hour = raw.slice(AV_TIMESTAMP_HOUR_START, AV_TIMESTAMP_HOUR_END);
        const min = raw.slice(AV_TIMESTAMP_HOUR_END, AV_TIMESTAMP_MIN_END);
        const sec = raw.slice(AV_TIMESTAMP_MIN_END, AV_TIMESTAMP_SEC_END);
        publishedAt = new Date(
          `${year}-${month}-${day}T${hour}:${min}:${sec}Z`,
        ).toISOString();
      } catch {
        publishedAt = new Date().toISOString();
      }

      return {
        title: item.title,
        summary: item.summary.slice(0, NEWS_SUMMARY_MAX_LENGTH),
        source: item.source,
        url: item.url,
        publishedAt,
        sentiment,
        relevantSymbols:
          relevantSymbols.length > 0
            ? relevantSymbols
            : symbols.slice(0, RELEVANT_SYMBOLS_MAX_COUNT),
      };
    });

  console.log(
    `[NewsProvider] Alpha Vantage returned ${items.length} news items`,
  );

  return items;
}

// ---------------------------------------------------------------------------
// Multi-Provider Orchestration
// ---------------------------------------------------------------------------

/**
 * Metrics for news provider performance tracking.
 */
interface ProviderMetrics {
  calls: number;
  successes: number;
  failures: number;
  lastCallAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  avgResponseMs: number;
  totalResponseMs: number;
}

const providerMetrics: Record<string, ProviderMetrics> = {
  perplexity: {
    calls: 0,
    successes: 0,
    failures: 0,
    lastCallAt: null,
    lastErrorAt: null,
    lastError: null,
    avgResponseMs: 0,
    totalResponseMs: 0,
  },
  alphavantage: {
    calls: 0,
    successes: 0,
    failures: 0,
    lastCallAt: null,
    lastErrorAt: null,
    lastError: null,
    avgResponseMs: 0,
    totalResponseMs: 0,
  },
};

function recordProviderCall(
  provider: string,
  success: boolean,
  durationMs: number,
  error?: string,
): void {
  const m = providerMetrics[provider];
  if (!m) return;
  m.calls++;
  m.lastCallAt = new Date().toISOString();
  m.totalResponseMs += durationMs;
  m.avgResponseMs = m.totalResponseMs / m.calls;

  if (success) {
    m.successes++;
  } else {
    m.failures++;
    m.lastErrorAt = new Date().toISOString();
    m.lastError = error ?? "unknown";
  }
}

/**
 * Fetch real market news using a cascade of providers.
 *
 * Priority:
 * 1. Perplexity (best real-time coverage, requires API key)
 * 2. Alpha Vantage (good sentiment data, free tier available)
 * 3. Returns empty array if all providers fail
 *
 * This function is designed to be used as a SearchProvider in search-cache.ts:
 *   setSearchProvider(fetchMarketNews)
 */
export async function fetchMarketNews(
  symbols: string[],
): Promise<NewsItem[]> {
  const allItems: NewsItem[] = [];
  const startTime = Date.now();

  // Try Perplexity first (best real-time coverage)
  if (process.env.PERPLEXITY_API_KEY) {
    try {
      const pStart = Date.now();
      const perplexityItems = await fetchPerplexityNews(symbols);
      recordProviderCall("perplexity", true, Date.now() - pStart);
      allItems.push(...perplexityItems);
    } catch (err) {
      const msg = errorMessage(err);
      recordProviderCall("perplexity", false, Date.now() - startTime, msg);
      console.warn(`[NewsProvider] Perplexity failed: ${msg}`);
    }
  }

  // Try Alpha Vantage (supplements Perplexity or standalone)
  if (process.env.ALPHA_VANTAGE_API_KEY) {
    try {
      const avStart = Date.now();
      const avItems = await fetchAlphaVantageNews(symbols);
      recordProviderCall("alphavantage", true, Date.now() - avStart);

      // Deduplicate by title similarity
      for (const item of avItems) {
        const isDuplicate = allItems.some(
          (existing) =>
            existing.title.toLowerCase().includes(item.title.toLowerCase().slice(0, TITLE_DEDUP_MATCH_LENGTH)) ||
            item.title.toLowerCase().includes(existing.title.toLowerCase().slice(0, TITLE_DEDUP_MATCH_LENGTH)),
        );
        if (!isDuplicate) {
          allItems.push(item);
        }
      }
    } catch (err) {
      const msg = errorMessage(err);
      recordProviderCall("alphavantage", false, Date.now() - startTime, msg);
      console.warn(`[NewsProvider] Alpha Vantage failed: ${msg}`);
    }
  }

  // Sort by publish time (newest first)
  allItems.sort(
    (a, b) =>
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );

  const totalMs = Date.now() - startTime;
  console.log(
    `[NewsProvider] Fetched ${allItems.length} news items in ${totalMs}ms (providers: ${Object.entries(providerMetrics).filter(([, m]) => m.calls > 0).map(([k]) => k).join(", ") || "none"})`,
  );

  return allItems.slice(0, MAX_ITEMS_PER_PROVIDER * 2);
}

/**
 * Get metrics for all news providers.
 */
export function getNewsProviderMetrics(): Record<string, ProviderMetrics> {
  return { ...providerMetrics };
}

/**
 * Check which news providers are available (have API keys configured).
 */
export function getAvailableProviders(): string[] {
  const available: string[] = [];
  if (process.env.PERPLEXITY_API_KEY) available.push("perplexity");
  if (process.env.ALPHA_VANTAGE_API_KEY) available.push("alphavantage");
  return available;
}
