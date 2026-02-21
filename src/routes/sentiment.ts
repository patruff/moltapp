/**
 * News Sentiment Analysis Routes
 *
 * Comprehensive sentiment intelligence endpoints exposing multi-factor
 * sentiment scores, heatmaps, shift detection, agent profiling, cross-agent
 * correlation, simulated news digests, sector aggregation, timelines, and
 * an overall market mood index (fear/greed gauge).
 *
 * Routes:
 *   GET  /api/v1/sentiment                  — Market mood + all stock sentiments
 *   GET  /api/v1/sentiment/mood             — Market mood index (fear/greed gauge)
 *   GET  /api/v1/sentiment/heatmap          — Sentiment heatmap (stock x timeframe)
 *   GET  /api/v1/sentiment/shifts           — Recent sentiment shifts
 *   GET  /api/v1/sentiment/stock/:symbol    — Detailed sentiment for one stock
 *   GET  /api/v1/sentiment/sectors          — Sentiment by sector
 *   GET  /api/v1/sentiment/news             — Simulated news digest with sentiment
 *   GET  /api/v1/sentiment/news/:symbol     — Stock-specific news digest
 *   GET  /api/v1/sentiment/agents           — Agent sentiment profiles
 *   GET  /api/v1/sentiment/agents/:agentId  — Single agent's sentiment profile
 *   GET  /api/v1/sentiment/correlation      — Agent sentiment correlation matrix
 *   GET  /api/v1/sentiment/timeline/:symbol — Sentiment history over time
 */

import { Hono } from "hono";
import {
  getStockSentiment,
  getAllSentiments,
  getSentimentHeatmap,
  detectSentimentShifts,
  getAgentSentimentProfile,
  getSentimentCorrelation,
  generateNewsDigest,
  getSectorSentiment,
  getSentimentTimeline,
  getMarketMoodIndex,
} from "../services/sentiment.ts";
import { countByCondition } from "../lib/math-utils.ts";
import { parseQueryInt } from "../lib/query-params.js";

export const sentimentRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET /sentiment — Full sentiment overview (mood + all stocks)
// ---------------------------------------------------------------------------

/**
 * Returns the overall market mood index alongside individual sentiment
 * scores for every tracked stock. This is the primary entry point for
 * consuming the sentiment system.
 *
 * Query parameters:
 *   limit  — Max number of stock sentiments to return (default 50, max 100)
 *   signal — Filter by signal: strong_buy, buy, neutral, sell, strong_sell
 */
sentimentRoutes.get("/", async (c) => {
  try {
    const limit = parseQueryInt(c.req.query("limit"), 50, 1, 100);
    const signalFilter = c.req.query("signal");

    const [mood, allSentiments] = await Promise.all([
      getMarketMoodIndex(),
      getAllSentiments(),
    ]);

    let filtered = allSentiments;
    if (
      signalFilter &&
      ["strong_buy", "buy", "neutral", "sell", "strong_sell"].includes(signalFilter)
    ) {
      filtered = filtered.filter((s) => s.signal === signalFilter);
    }

    const sentiments = filtered.slice(0, limit);

    // Summary stats
    const bullishCount = countByCondition(allSentiments, (s) => s.overall > 20);
    const bearishCount = countByCondition(allSentiments, (s) => s.overall < -20);
    const neutralCount = countByCondition(allSentiments, (s) => s.overall >= -20 && s.overall <= 20);
    const avgSentiment =
      allSentiments.length > 0
        ? Math.round(
            allSentiments.reduce((sum, s) => sum + s.overall, 0) /
              allSentiments.length,
          )
        : 0;

    return c.json({
      status: "ok",
      mood,
      sentiments,
      summary: {
        totalStocks: allSentiments.length,
        returned: sentiments.length,
        bullishStocks: bullishCount,
        bearishStocks: bearishCount,
        neutralStocks: neutralCount,
        averageSentiment: avgSentiment,
      },
      filters: {
        signal: signalFilter ?? "all",
        limit,
      },
      description:
        "Multi-factor sentiment analysis combining AI agent decisions, price momentum, volume, social signals, and news sentiment.",
    });
  } catch (error) {
    console.error("[Sentiment] Overview error:", error);
    return c.json(
      {
        error: "sentiment_error",
        code: "sentiment_overview_failed",
        details:
          error instanceof Error
            ? error.message
            : "Failed to generate sentiment overview",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /sentiment/mood — Market mood index (fear/greed gauge)
// ---------------------------------------------------------------------------

/**
 * Returns a single fear/greed gauge value from -100 (extreme fear)
 * to +100 (extreme greed) with component breakdown and classification.
 */
sentimentRoutes.get("/mood", async (c) => {
  try {
    const mood = await getMarketMoodIndex();

    return c.json({
      status: "ok",
      mood,
      description:
        "Market Mood Index: a composite fear/greed gauge combining agent mood, price momentum, volume trends, and market breadth.",
    });
  } catch (error) {
    console.error("[Sentiment] Mood error:", error);
    return c.json(
      {
        error: "sentiment_error",
        code: "mood_index_failed",
        details:
          error instanceof Error
            ? error.message
            : "Failed to compute market mood index",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /sentiment/heatmap — Sentiment heatmap (stock x timeframe)
// ---------------------------------------------------------------------------

/**
 * Returns a grid of sentiment values across all stocks and multiple
 * timeframes (1h, 4h, 1d, 1w). Useful for visual heatmap rendering.
 */
sentimentRoutes.get("/heatmap", async (c) => {
  try {
    const heatmap = await getSentimentHeatmap();

    return c.json({
      status: "ok",
      heatmap,
      summary: {
        stockCount: heatmap.symbols.length,
        timeframeCount: heatmap.timeframes.length,
        cellCount: heatmap.cells.length,
      },
      description:
        "Sentiment heatmap grid: each cell represents the sentiment for a stock at a specific timeframe. Values range from -100 (extreme bearish) to +100 (extreme bullish).",
    });
  } catch (error) {
    console.error("[Sentiment] Heatmap error:", error);
    return c.json(
      {
        error: "sentiment_error",
        code: "heatmap_failed",
        details:
          error instanceof Error
            ? error.message
            : "Failed to generate sentiment heatmap",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /sentiment/shifts — Recent sentiment shifts
// ---------------------------------------------------------------------------

/**
 * Detects stocks where sentiment has changed significantly.
 * Flags major (>30pt), moderate (15-30pt), and minor shifts with
 * trigger analysis explaining what drove the change.
 *
 * Query parameters:
 *   significance — Filter: major, moderate, minor (default all)
 *   direction    — Filter: improving, deteriorating, stable (default all)
 */
sentimentRoutes.get("/shifts", async (c) => {
  try {
    const significanceFilter = c.req.query("significance");
    const directionFilter = c.req.query("direction");

    let shifts = await detectSentimentShifts();

    if (
      significanceFilter &&
      ["major", "moderate", "minor"].includes(significanceFilter)
    ) {
      shifts = shifts.filter((s) => s.significance === significanceFilter);
    }
    if (
      directionFilter &&
      ["improving", "deteriorating", "stable"].includes(directionFilter)
    ) {
      shifts = shifts.filter((s) => s.direction === directionFilter);
    }

    const majorShifts = shifts.filter((s) => s.significance === "major");
    const moderateShifts = shifts.filter((s) => s.significance === "moderate");
    const improvingCount = shifts.filter(
      (s) => s.direction === "improving",
    ).length;
    const deterioratingCount = shifts.filter(
      (s) => s.direction === "deteriorating",
    ).length;

    return c.json({
      status: "ok",
      shifts,
      summary: {
        totalShifts: shifts.length,
        majorShifts: majorShifts.length,
        moderateShifts: moderateShifts.length,
        improvingStocks: improvingCount,
        deterioratingStocks: deterioratingCount,
      },
      filters: {
        significance: significanceFilter ?? "all",
        direction: directionFilter ?? "all",
      },
      description:
        "Detected sentiment shifts across all tracked stocks. Major shifts (>30pt) may indicate significant regime changes.",
    });
  } catch (error) {
    console.error("[Sentiment] Shifts error:", error);
    return c.json(
      {
        error: "sentiment_error",
        code: "shifts_failed",
        details:
          error instanceof Error
            ? error.message
            : "Failed to detect sentiment shifts",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /sentiment/stock/:symbol — Detailed sentiment for one stock
// ---------------------------------------------------------------------------

/**
 * Returns a comprehensive multi-factor sentiment breakdown for a
 * single stock, including all component scores, drivers, signal
 * classification, and confidence level.
 */
sentimentRoutes.get("/stock/:symbol", async (c) => {
  const symbol = c.req.param("symbol");

  try {
    const sentiment = await getStockSentiment(symbol);

    if (!sentiment) {
      return c.json(
        {
          error: "stock_not_found",
          code: "stock_not_found",
          details: `No data available for symbol "${symbol}". Try AAPLx, NVDAx, TSLAx, etc.`,
        },
        404,
      );
    }

    // Also fetch recent news for context
    const news = await generateNewsDigest(symbol);

    return c.json({
      status: "ok",
      sentiment,
      recentNews: news.slice(0, 5),
      newsCount: news.length,
      description: `Full multi-factor sentiment breakdown for ${symbol}.`,
    });
  } catch (error) {
    console.error(`[Sentiment] Stock sentiment error for ${symbol}:`, error);
    return c.json(
      {
        error: "sentiment_error",
        code: "stock_sentiment_failed",
        details:
          error instanceof Error
            ? error.message
            : "Failed to compute stock sentiment",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /sentiment/sectors — Sentiment by sector
// ---------------------------------------------------------------------------

/**
 * Aggregates sentiment data by sector (Technology, Crypto, Finance, etc.).
 * Each sector shows average sentiment, leading/lagging stocks, and signal.
 */
sentimentRoutes.get("/sectors", async (c) => {
  try {
    const sectors = await getSectorSentiment();

    const bullishSectors = sectors.filter((s) => s.sentiment > 20);
    const bearishSectors = sectors.filter((s) => s.sentiment < -20);

    return c.json({
      status: "ok",
      sectors,
      summary: {
        totalSectors: sectors.length,
        bullishSectors: bullishSectors.length,
        bearishSectors: bearishSectors.length,
        strongestSector: sectors[0]?.sector ?? "N/A",
        weakestSector: sectors[sectors.length - 1]?.sector ?? "N/A",
      },
      description:
        "Sector-level sentiment aggregation. Sentiment is averaged across all stocks in each sector.",
    });
  } catch (error) {
    console.error("[Sentiment] Sectors error:", error);
    return c.json(
      {
        error: "sentiment_error",
        code: "sectors_failed",
        details:
          error instanceof Error
            ? error.message
            : "Failed to compute sector sentiment",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /sentiment/news — Market-wide simulated news digest
// ---------------------------------------------------------------------------

/**
 * Returns a simulated financial news digest with sentiment scores for
 * all tracked stocks. Headlines are generated from current price action,
 * agent decisions, volume patterns, and sector narratives.
 *
 * Query parameters:
 *   limit    — Max headlines (default 30, max 100)
 *   category — Filter: earnings, macro, regulatory, product, market, analyst, insider
 */
sentimentRoutes.get("/news", async (c) => {
  try {
    const limit = parseQueryInt(c.req.query("limit"), 30, 1, 100);
    const categoryFilter = c.req.query("category");

    let news = await generateNewsDigest();

    if (
      categoryFilter &&
      ["earnings", "macro", "regulatory", "product", "market", "analyst", "insider"].includes(categoryFilter)
    ) {
      news = news.filter((n) => n.category === categoryFilter);
    }

    const total = news.length;
    news = news.slice(0, limit);

    // Compute aggregate news sentiment
    const avgSentiment =
      news.length > 0
        ? Math.round(
            (news.reduce((sum, n) => sum + n.sentiment, 0) / news.length) * 100,
          ) / 100
        : 0;

    const positiveCount = countByCondition(news, (n) => n.sentiment > 0.1);
    const negativeCount = countByCondition(news, (n) => n.sentiment < -0.1);
    const neutralCount = countByCondition(news, (n) => n.sentiment >= -0.1 && n.sentiment <= 0.1);

    return c.json({
      status: "ok",
      news,
      summary: {
        totalHeadlines: total,
        returned: news.length,
        averageSentiment: avgSentiment,
        positiveHeadlines: positiveCount,
        negativeHeadlines: negativeCount,
        neutralHeadlines: neutralCount,
      },
      filters: {
        category: categoryFilter ?? "all",
        limit,
      },
      description:
        "Simulated financial news digest generated from current market conditions, AI agent decisions, and sector dynamics.",
    });
  } catch (error) {
    console.error("[Sentiment] News error:", error);
    return c.json(
      {
        error: "sentiment_error",
        code: "news_digest_failed",
        details:
          error instanceof Error
            ? error.message
            : "Failed to generate news digest",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /sentiment/news/:symbol — Stock-specific news digest
// ---------------------------------------------------------------------------

/**
 * Returns a focused news digest for a single stock with more headlines
 * and deeper coverage than the market-wide digest.
 */
sentimentRoutes.get("/news/:symbol", async (c) => {
  const symbol = c.req.param("symbol");

  try {
    const news = await generateNewsDigest(symbol);

    if (news.length === 0) {
      return c.json(
        {
          error: "stock_not_found",
          code: "stock_not_found",
          details: `No news data available for symbol "${symbol}". Try AAPLx, NVDAx, TSLAx, etc.`,
        },
        404,
      );
    }

    const avgSentiment =
      news.length > 0
        ? Math.round(
            (news.reduce((sum, n) => sum + n.sentiment, 0) / news.length) * 100,
          ) / 100
        : 0;

    const sentimentLabel =
      avgSentiment > 0.3
        ? "positive"
        : avgSentiment < -0.3
          ? "negative"
          : "mixed";

    return c.json({
      status: "ok",
      symbol,
      news,
      summary: {
        headlineCount: news.length,
        averageSentiment: avgSentiment,
        sentimentLabel,
        categories: [...new Set(news.map((n) => n.category))],
        sources: [...new Set(news.map((n) => n.source))],
      },
      description: `Simulated news digest for ${symbol} based on current market conditions and AI agent activity.`,
    });
  } catch (error) {
    console.error(`[Sentiment] Stock news error for ${symbol}:`, error);
    return c.json(
      {
        error: "sentiment_error",
        code: "stock_news_failed",
        details:
          error instanceof Error
            ? error.message
            : "Failed to generate stock news",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /sentiment/agents — All agent sentiment profiles
// ---------------------------------------------------------------------------

/**
 * Returns sentiment profiles for all 3 AI agents, showing their
 * bias, consistency, flip-flop rate, and contrarian tendencies.
 */
sentimentRoutes.get("/agents", async (c) => {
  try {
    const agentIds = [
      "claude-value-investor",
      "gpt-momentum-trader",
      "grok-contrarian",
    ];

    const profiles = await Promise.all(
      agentIds.map((id) => getAgentSentimentProfile(id)),
    );

    const validProfiles = profiles.filter(
      (p): p is NonNullable<typeof p> => p !== null,
    );

    // Sort by absolute bias (strongest opinion first)
    validProfiles.sort(
      (a, b) => Math.abs(b.overallBias) - Math.abs(a.overallBias),
    );

    // Aggregate stats
    const mostBullish = validProfiles.reduce(
      (max, p) => (p.overallBias > (max?.overallBias ?? -Infinity) ? p : max),
      validProfiles[0],
    );
    const mostBearish = validProfiles.reduce(
      (min, p) => (p.overallBias < (min?.overallBias ?? Infinity) ? p : min),
      validProfiles[0],
    );
    const mostContrarian = validProfiles.reduce(
      (max, p) =>
        p.contrarianScore > (max?.contrarianScore ?? -Infinity) ? p : max,
      validProfiles[0],
    );

    return c.json({
      status: "ok",
      agents: validProfiles,
      summary: {
        agentCount: validProfiles.length,
        mostBullish: mostBullish
          ? { agentId: mostBullish.agentId, bias: mostBullish.overallBias }
          : null,
        mostBearish: mostBearish
          ? { agentId: mostBearish.agentId, bias: mostBearish.overallBias }
          : null,
        mostContrarian: mostContrarian
          ? {
              agentId: mostContrarian.agentId,
              score: mostContrarian.contrarianScore,
            }
          : null,
      },
      description:
        "Sentiment profiles for all 3 AI agents. Shows bias, consistency, flip-flop rate, and contrarian behavior.",
    });
  } catch (error) {
    console.error("[Sentiment] Agent profiles error:", error);
    return c.json(
      {
        error: "sentiment_error",
        code: "agent_profiles_failed",
        details:
          error instanceof Error
            ? error.message
            : "Failed to generate agent profiles",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /sentiment/agents/:agentId — Single agent's sentiment profile
// ---------------------------------------------------------------------------

/**
 * Returns detailed sentiment profile for a specific AI agent including
 * overall bias, most bullish/bearish stocks, consistency, and
 * contrarian score.
 */
sentimentRoutes.get("/agents/:agentId", async (c) => {
  const agentId = c.req.param("agentId");

  try {
    const profile = await getAgentSentimentProfile(agentId);

    if (!profile) {
      return c.json(
        {
          error: "agent_not_found",
          code: "agent_not_found",
          details: `Agent "${agentId}" not found. Valid IDs: claude-value-investor, gpt-momentum-trader, grok-contrarian`,
        },
        404,
      );
    }

    return c.json({
      status: "ok",
      profile,
      description: `Sentiment profile for ${profile.agentName}. Bias: ${profile.biasLabel} (${profile.overallBias}). Contrarian score: ${profile.contrarianScore}/100.`,
    });
  } catch (error) {
    console.error(
      `[Sentiment] Agent profile error for ${agentId}:`,
      error,
    );
    return c.json(
      {
        error: "sentiment_error",
        code: "agent_profile_failed",
        details:
          error instanceof Error
            ? error.message
            : "Failed to generate agent profile",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /sentiment/correlation — Agent sentiment correlation matrix
// ---------------------------------------------------------------------------

/**
 * Returns the cross-agent correlation matrix showing how often agents
 * agree/disagree, consensus stocks, divergence stocks, and pairwise
 * Pearson correlation coefficients.
 */
sentimentRoutes.get("/correlation", async (c) => {
  try {
    const correlation = await getSentimentCorrelation();

    return c.json({
      status: "ok",
      correlation,
      description:
        "Cross-agent sentiment correlation matrix. Shows pairwise agreement rates, Pearson correlation, consensus stocks (all agree), and divergence stocks (opposing views).",
    });
  } catch (error) {
    console.error("[Sentiment] Correlation error:", error);
    return c.json(
      {
        error: "sentiment_error",
        code: "correlation_failed",
        details:
          error instanceof Error
            ? error.message
            : "Failed to compute correlation matrix",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /sentiment/timeline/:symbol — Sentiment history over time
// ---------------------------------------------------------------------------

/**
 * Returns a time series of sentiment snapshots for a stock over the
 * specified lookback period. Useful for charting sentiment evolution.
 *
 * Query parameters:
 *   hours — Lookback period in hours (default 24, max 168 = 1 week)
 */
sentimentRoutes.get("/timeline/:symbol", async (c) => {
  const symbol = c.req.param("symbol");
  const hours = parseQueryInt(c.req.query("hours"), 24, 1, 168);

  try {
    const timeline = await getSentimentTimeline(symbol, hours);

    if (timeline.length === 0) {
      return c.json(
        {
          error: "stock_not_found",
          code: "stock_not_found",
          details: `No data available for symbol "${symbol}". Try AAPLx, NVDAx, TSLAx, etc.`,
        },
        404,
      );
    }

    // Compute trend from timeline
    const first = timeline[0];
    const last = timeline[timeline.length - 1];
    const trendChange = last.sentiment - first.sentiment;
    const trendDirection =
      trendChange > 10
        ? "improving"
        : trendChange < -10
          ? "deteriorating"
          : "stable";

    // Find extremes
    const maxPoint = timeline.reduce((max, t) =>
      t.sentiment > max.sentiment ? t : max,
    );
    const minPoint = timeline.reduce((min, t) =>
      t.sentiment < min.sentiment ? t : min,
    );

    return c.json({
      status: "ok",
      symbol,
      timeline,
      summary: {
        dataPoints: timeline.length,
        periodHours: hours,
        currentSentiment: last.sentiment,
        currentSignal: last.signal,
        trendDirection,
        trendChange: Math.round(trendChange),
        high: { sentiment: maxPoint.sentiment, at: maxPoint.timestamp },
        low: { sentiment: minPoint.sentiment, at: minPoint.timestamp },
      },
      description: `Sentiment timeline for ${symbol} over the past ${hours} hours.`,
    });
  } catch (error) {
    console.error(
      `[Sentiment] Timeline error for ${symbol}:`,
      error,
    );
    return c.json(
      {
        error: "sentiment_error",
        code: "timeline_failed",
        details:
          error instanceof Error
            ? error.message
            : "Failed to generate sentiment timeline",
      },
      500,
    );
  }
});
