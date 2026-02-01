import { XSTOCKS_CATALOG } from "../config/constants.ts";
import type { StockToken } from "../config/constants.ts";
import { getPrices } from "./jupiter.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StockWithPrice {
  symbol: string;
  name: string;
  mintAddress: string;
  decimals: number;
  usdPrice: number | null;
  priceChange24h: number | null;
}

// Re-export StockToken for convenience
export type { StockToken };

// ---------------------------------------------------------------------------
// Catalog lookups
// ---------------------------------------------------------------------------

/**
 * Look up a stock token by symbol (case-insensitive).
 */
export function getStockBySymbol(symbol: string): StockToken | undefined {
  const upper = symbol.toUpperCase();
  return XSTOCKS_CATALOG.find(
    (s) => s.symbol.toUpperCase() === upper
  );
}

/**
 * Look up a stock token by its Solana mint address.
 */
export function getStockByMint(mintAddress: string): StockToken | undefined {
  return XSTOCKS_CATALOG.find((s) => s.mintAddress === mintAddress);
}

// ---------------------------------------------------------------------------
// Price-enriched listing
// ---------------------------------------------------------------------------

/**
 * Return the full xStocks catalog enriched with current USD prices from
 * Jupiter Price API V3.
 *
 * If the price API is unreachable, stocks are returned with null prices
 * (graceful degradation -- the catalog itself is always available).
 */
export async function listStocksWithPrices(): Promise<StockWithPrice[]> {
  const mintAddresses = XSTOCKS_CATALOG.map((s) => s.mintAddress);

  let priceMap: Record<string, { usdPrice: number; priceChange24h: number } | null> = {};

  try {
    priceMap = await getPrices(mintAddresses);
  } catch {
    // Jupiter price API failure -- return catalog with null prices
  }

  return XSTOCKS_CATALOG.map((stock) => {
    const price = priceMap[stock.mintAddress];
    return {
      symbol: stock.symbol,
      name: stock.name,
      mintAddress: stock.mintAddress,
      decimals: stock.decimals,
      usdPrice: price?.usdPrice ?? null,
      priceChange24h: price?.priceChange24h ?? null,
    };
  });
}
