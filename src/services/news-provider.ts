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

  const cleanSymbols = symbols.slice(0, 10).map((s) => s.replace(/x$/i, ""));
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
      max_tokens: 2048,
      temperature: 0.1,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(
      `Perplexity API error ${resp.status}: ${text.slice(0, 200)}`,
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
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith("```")) {
      cleaned = cleaned.slice(3);
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
            : requestedSymbols.slice(0, 2),
      });
    }
  } catch (err) {
    console.warn(
      `[NewsProvider] Failed to parse Perplexity response: ${errorMessage(err)}`,
    );

    // Create a single item from the raw text content
    if (content.length > 20) {
      items.push({
        title: "Market Intelligence Summary",
        summary: content.slice(0, 500),
        source: "Perplexity AI",
        url: "https://perplexity.ai",
        publishedAt: new Date().toISOString(),
        sentiment: "neutral",
        relevantSymbols: requestedSymbols.slice(0, 5),
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
    .slice(0, 5)
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
        score > 0.15 ? "positive" : score < -0.15 ? "negative" : "neutral";

      // Map tickers to xStock symbols
      const relevantSymbols = (item.ticker_sentiment ?? [])
        .filter((ts) => parseFloat(ts.relevance_score) > 0.3)
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
        const year = raw.slice(0, 4);
        const month = raw.slice(4, 6);
        const day = raw.slice(6, 8);
        const hour = raw.slice(9, 11);
        const min = raw.slice(11, 13);
        const sec = raw.slice(13, 15);
        publishedAt = new Date(
          `${year}-${month}-${day}T${hour}:${min}:${sec}Z`,
        ).toISOString();
      } catch {
        publishedAt = new Date().toISOString();
      }

      return {
        title: item.title,
        summary: item.summary.slice(0, 500),
        source: item.source,
        url: item.url,
        publishedAt,
        sentiment,
        relevantSymbols:
          relevantSymbols.length > 0
            ? relevantSymbols
            : symbols.slice(0, 2),
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
            existing.title.toLowerCase().includes(item.title.toLowerCase().slice(0, 30)) ||
            item.title.toLowerCase().includes(existing.title.toLowerCase().slice(0, 30)),
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
