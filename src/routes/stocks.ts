import { Hono } from "hono";
import { listStocksWithPrices, getStockBySymbol } from "../services/stocks.ts";
import { getPrices } from "../services/jupiter.ts";
import { apiError } from "../lib/errors.ts";

type StockEnv = { Variables: { agentId: string } };

export const stockRoutes = new Hono<StockEnv>();

// ---------------------------------------------------------------------------
// GET / -- List all available stocks with current prices
// ---------------------------------------------------------------------------

stockRoutes.get("/", async (c) => {
  const stocks = await listStocksWithPrices();
  return c.json({ stocks });
});

// ---------------------------------------------------------------------------
// GET /:symbol -- Single stock details with price
// ---------------------------------------------------------------------------

stockRoutes.get("/:symbol", async (c) => {
  const symbol = c.req.param("symbol");
  const stock = getStockBySymbol(symbol);

  if (!stock) {
    return apiError(c, "STOCK_NOT_FOUND");
  }

  let usdPrice: number | null = null;
  let priceChange24h: number | null = null;

  try {
    const priceMap = await getPrices([stock.mintAddress]);
    const priceData = priceMap[stock.mintAddress];
    if (priceData) {
      usdPrice = priceData.usdPrice;
      priceChange24h = priceData.priceChange24h;
    }
  } catch {
    // Price API failure -- return stock with null prices
  }

  return c.json({
    symbol: stock.symbol,
    name: stock.name,
    mintAddress: stock.mintAddress,
    decimals: stock.decimals,
    usdPrice,
    priceChange24h,
  });
});
