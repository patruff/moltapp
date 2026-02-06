/**
 * News & Market Intelligence API Routes
 *
 * Provides endpoints for news provider management, cached news retrieval,
 * and provider health monitoring.
 */

import { Hono } from "hono";
import { errorMessage } from "../lib/errors.ts";
import {
  fetchMarketNews,
  getNewsProviderMetrics,
  getAvailableProviders,
} from "../services/news-provider.ts";
import {
  getCachedNews,
  formatNewsForPrompt,
  getSearchCacheMetrics,
  invalidateCache,
  setSearchProvider,
} from "../services/search-cache.ts";

export const newsRoutes = new Hono();

// ---------------------------------------------------------------------------
// News Retrieval
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/news/latest
 * Get latest cached news for default stock symbols.
 */
newsRoutes.get("/latest", async (c) => {
  try {
    const symbols = c.req.query("symbols")?.split(",") ?? [
      "AAPLx",
      "NVDAx",
      "TSLAx",
      "MSFTx",
      "SPYx",
    ];

    const cached = await getCachedNews(symbols);

    return c.json({
      data: {
        items: cached.items,
        cachedAt: cached.cachedAt,
        expiresAt: cached.expiresAt,
        source: cached.source,
        formatted: formatNewsForPrompt(cached),
      },
    });
  } catch (err) {
    console.error("[News] Failed to get latest news:", err);
    return c.json(
      {
        error: "news_error",
        message: errorMessage(err),
      },
      500,
    );
  }
});

/**
 * POST /api/v1/news/fetch
 * Force-fetch fresh news (bypasses cache).
 */
newsRoutes.post("/fetch", async (c) => {
  try {
    const body = await c.req.json<{ symbols?: string[] }>().catch(() => ({ symbols: undefined }));
    const symbols = body.symbols ?? [
      "AAPLx",
      "NVDAx",
      "TSLAx",
      "MSFTx",
      "SPYx",
    ];

    // Invalidate existing cache
    invalidateCache();

    // Fetch fresh news
    const items = await fetchMarketNews(symbols);

    return c.json({
      data: {
        items,
        count: items.length,
        fetchedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("[News] Failed to fetch news:", err);
    return c.json(
      {
        error: "fetch_error",
        message: errorMessage(err),
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// Provider Management
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/news/providers
 * Get available news providers and their metrics.
 */
newsRoutes.get("/providers", (c) => {
  return c.json({
    data: {
      available: getAvailableProviders(),
      metrics: getNewsProviderMetrics(),
      cache: getSearchCacheMetrics(),
    },
  });
});

/**
 * POST /api/v1/news/activate-real
 * Activate real news providers (Perplexity/Alpha Vantage).
 * Replaces the mock provider with the real multi-provider pipeline.
 */
newsRoutes.post("/activate-real", (c) => {
  const available = getAvailableProviders();

  if (available.length === 0) {
    return c.json(
      {
        error: "no_providers",
        message:
          "No news API keys configured. Set PERPLEXITY_API_KEY or ALPHA_VANTAGE_API_KEY.",
      },
      400,
    );
  }

  setSearchProvider(fetchMarketNews);
  invalidateCache();

  return c.json({
    data: {
      activated: true,
      providers: available,
      message: `Real news providers activated: ${available.join(", ")}. Cache invalidated.`,
    },
  });
});

/**
 * DELETE /api/v1/news/cache
 * Invalidate the news cache.
 */
newsRoutes.delete("/cache", (c) => {
  invalidateCache();
  return c.json({ data: { invalidated: true } });
});
