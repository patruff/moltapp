/**
 * News Provider Initialization
 *
 * Auto-configures the search-cache with real news providers when API keys
 * are available. Call this on app startup to enable real market intelligence.
 *
 * Priority:
 * 1. If PERPLEXITY_API_KEY or ALPHA_VANTAGE_API_KEY is set → use real providers
 * 2. Otherwise → keep the default mock provider (no-op)
 */

import { setSearchProvider } from "./search-cache.ts";
import { fetchMarketNews, getAvailableProviders } from "./news-provider.ts";

let initialized = false;

/**
 * Initialize real news providers if API keys are available.
 * Safe to call multiple times — only runs once.
 */
export function initializeNewsProviders(): void {
  if (initialized) return;
  initialized = true;

  const providers = getAvailableProviders();

  if (providers.length > 0) {
    setSearchProvider(fetchMarketNews);
    console.log(
      `[NewsInit] Real news providers activated: ${providers.join(", ")}`,
    );
  } else {
    console.log(
      "[NewsInit] No news API keys configured. Using mock news provider. " +
        "Set PERPLEXITY_API_KEY or ALPHA_VANTAGE_API_KEY for real market intelligence.",
    );
  }
}
