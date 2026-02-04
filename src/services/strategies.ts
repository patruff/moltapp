/**
 * Strategy Marketplace Service
 *
 * Complete strategy lifecycle management for the agent marketplace. Handles
 * strategy creation, forking, adoption, rating, signal generation, performance
 * tracking, and marketplace analytics.
 *
 * Key capabilities:
 * - Publish & fork strategies with full parameter sets
 * - Adopt/stop strategies with performance tracking per adopter
 * - 1-5 star ratings with aggregate scoring
 * - Signal generation from strategy entry/exit rules
 * - Leaderboard by adopter performance
 * - Trending detection by adoption velocity
 * - Head-to-head strategy comparison
 * - Marketplace-wide statistics
 */

import { db } from "../db/index.ts";
import {
  strategies,
  strategyAdoptions,
  strategyRatings,
  strategySignals,
} from "../db/schema/strategies.ts";
import type {
  StrategyParameters,
  BacktestResults,
  SignalMetadata,
} from "../db/schema/strategies.ts";
import { agentDecisions } from "../db/schema/agent-decisions.ts";
import { eq, desc, gte, and, sql, asc } from "drizzle-orm";
import { getMarketData, getAgentConfigs } from "../agents/orchestrator.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Valid strategy categories */
export type StrategyCategory =
  | "momentum"
  | "value"
  | "contrarian"
  | "arbitrage"
  | "balanced"
  | "sector_rotation"
  | "volatility"
  | "custom";

/** Valid risk levels */
export type RiskLevel = "low" | "medium" | "high" | "extreme";

/** Valid timeframes */
export type Timeframe = "intraday" | "daily" | "weekly" | "monthly";

/** Strategy sorting options for catalog */
export type StrategySortBy =
  | "newest"
  | "rating"
  | "adopters"
  | "performance";

/** Marketplace-wide statistics */
export interface MarketplaceStats {
  totalStrategies: number;
  activeStrategies: number;
  totalAdoptions: number;
  activeAdoptions: number;
  totalSignalsGenerated: number;
  avgPerformance: number;
  avgRating: number;
  topCategories: Array<{ category: string; count: number }>;
  topCreators: Array<{ agentId: string; strategyCount: number }>;
  recentActivity: {
    strategiesCreatedLast7d: number;
    adoptionsLast7d: number;
    signalsLast24h: number;
  };
}

/** Strategy performance aggregate */
export interface StrategyPerformance {
  strategyId: string;
  strategyName: string;
  totalAdopters: number;
  activeAdopters: number;
  avgPerformance: number;
  bestPerformance: number;
  worstPerformance: number;
  medianPerformance: number;
  totalTradesExecuted: number;
  signalsGenerated: number;
  recentSignals: Array<{
    id: string;
    symbol: string;
    signalType: string;
    direction: string;
    strength: number;
    price: string;
    createdAt: Date | null;
  }>;
}

/** Strategy comparison data */
export interface StrategyComparison {
  strategies: Array<{
    id: string;
    name: string;
    category: string;
    riskLevel: string;
    timeframe: string;
    avgRating: string;
    totalAdopters: number;
    avgPerformance: number;
    totalSignals: number;
    recentSignalStrength: number;
  }>;
  recommendation: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_CATEGORIES: StrategyCategory[] = [
  "momentum",
  "value",
  "contrarian",
  "arbitrage",
  "balanced",
  "sector_rotation",
  "volatility",
  "custom",
];

const VALID_RISK_LEVELS: RiskLevel[] = ["low", "medium", "high", "extreme"];

const VALID_TIMEFRAMES: Timeframe[] = [
  "intraday",
  "daily",
  "weekly",
  "monthly",
];

// ---------------------------------------------------------------------------
// 1. createStrategy — Publish a new strategy
// ---------------------------------------------------------------------------

/**
 * Publish a new trading strategy to the marketplace.
 *
 * @param creatorAgentId - Agent ID of the creator
 * @param name - Strategy display name
 * @param description - Detailed strategy description
 * @param category - Strategy category classification
 * @param parameters - Full strategy configuration (entry/exit rules, sizing, risk)
 * @param riskLevel - Risk classification (low/medium/high/extreme)
 * @param timeframe - Trading timeframe (intraday/daily/weekly/monthly)
 * @returns The newly created strategy record
 */
export async function createStrategy(
  creatorAgentId: string,
  name: string,
  description: string,
  category: string,
  parameters: StrategyParameters,
  riskLevel: string,
  timeframe: string,
) {
  if (!name || name.trim().length < 3) {
    throw new Error("Strategy name must be at least 3 characters");
  }
  if (!description || description.trim().length < 10) {
    throw new Error("Strategy description must be at least 10 characters");
  }
  if (!VALID_CATEGORIES.includes(category as StrategyCategory)) {
    throw new Error(`Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}`);
  }
  if (!VALID_RISK_LEVELS.includes(riskLevel as RiskLevel)) {
    throw new Error(`Invalid risk level. Must be one of: ${VALID_RISK_LEVELS.join(", ")}`);
  }
  if (!VALID_TIMEFRAMES.includes(timeframe as Timeframe)) {
    throw new Error(`Invalid timeframe. Must be one of: ${VALID_TIMEFRAMES.join(", ")}`);
  }
  if (!parameters.entryRules || parameters.entryRules.length === 0) {
    throw new Error("Strategy must have at least one entry rule");
  }
  if (!parameters.exitRules || parameters.exitRules.length === 0) {
    throw new Error("Strategy must have at least one exit rule");
  }

  const [created] = await db
    .insert(strategies)
    .values({
      creatorAgentId,
      name: name.trim(),
      description: description.trim(),
      category,
      parameters,
      riskLevel,
      timeframe,
    })
    .returning();

  return created;
}

// ---------------------------------------------------------------------------
// 2. forkStrategy — Fork an existing strategy with modifications
// ---------------------------------------------------------------------------

/**
 * Fork an existing strategy, creating a new one based on the original.
 * The fork maintains a `parentStrategyId` link for lineage tracking.
 *
 * @param strategyId - ID of the strategy to fork
 * @param newCreatorAgentId - Agent ID creating the fork
 * @param modifications - Optional overrides (name, description, params, risk, timeframe)
 * @returns The newly forked strategy record
 */
export async function forkStrategy(
  strategyId: string,
  newCreatorAgentId: string,
  modifications?: {
    name?: string;
    description?: string;
    parameters?: Partial<StrategyParameters>;
    riskLevel?: string;
    timeframe?: string;
  },
) {
  const [original] = await db
    .select()
    .from(strategies)
    .where(eq(strategies.id, strategyId))
    .limit(1);

  if (!original) {
    throw new Error(`Strategy "${strategyId}" not found`);
  }

  const originalParams = original.parameters as StrategyParameters;
  const mergedParams: StrategyParameters = modifications?.parameters
    ? {
        ...originalParams,
        ...modifications.parameters,
        entryRules: modifications.parameters.entryRules ?? originalParams.entryRules,
        exitRules: modifications.parameters.exitRules ?? originalParams.exitRules,
        positionSizing: modifications.parameters.positionSizing ?? originalParams.positionSizing,
        riskManagement: modifications.parameters.riskManagement ?? originalParams.riskManagement,
      }
    : originalParams;

  const [forked] = await db
    .insert(strategies)
    .values({
      creatorAgentId: newCreatorAgentId,
      name: modifications?.name ?? `${original.name} (Fork)`,
      description:
        modifications?.description ??
        `Forked from "${original.name}" by ${original.creatorAgentId}. ${original.description}`,
      category: original.category,
      parameters: mergedParams,
      riskLevel: modifications?.riskLevel ?? original.riskLevel,
      timeframe: modifications?.timeframe ?? original.timeframe,
      parentStrategyId: original.id,
    })
    .returning();

  return forked;
}

// ---------------------------------------------------------------------------
// 3. adoptStrategy — Agent adopts a strategy
// ---------------------------------------------------------------------------

/**
 * Record an agent adopting a strategy. Increments the strategy's
 * totalAdopters count.
 *
 * @param strategyId - Strategy to adopt
 * @param agentId - Agent adopting the strategy
 * @returns The new adoption record
 */
export async function adoptStrategy(strategyId: string, agentId: string) {
  // Verify strategy exists and is active
  const [strategy] = await db
    .select()
    .from(strategies)
    .where(eq(strategies.id, strategyId))
    .limit(1);

  if (!strategy) {
    throw new Error(`Strategy "${strategyId}" not found`);
  }
  if (strategy.status !== "active") {
    throw new Error(`Strategy "${strategy.name}" is ${strategy.status} and cannot be adopted`);
  }

  // Check if already adopted
  const existing = await db
    .select()
    .from(strategyAdoptions)
    .where(
      and(
        eq(strategyAdoptions.strategyId, strategyId),
        eq(strategyAdoptions.agentId, agentId),
        eq(strategyAdoptions.status, "active"),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    throw new Error(`Agent "${agentId}" has already adopted strategy "${strategy.name}"`);
  }

  // Create adoption and increment adopter count
  const [adoption] = await db
    .insert(strategyAdoptions)
    .values({
      strategyId,
      agentId,
      status: "active",
    })
    .returning();

  await db
    .update(strategies)
    .set({
      totalAdopters: sql`${strategies.totalAdopters} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(strategies.id, strategyId));

  return adoption;
}

// ---------------------------------------------------------------------------
// 4. stopStrategy — Agent stops using a strategy
// ---------------------------------------------------------------------------

/**
 * Stop an active strategy adoption. Decrements the strategy's
 * totalAdopters count.
 *
 * @param adoptionId - ID of the adoption record to stop
 * @returns The updated adoption record
 */
export async function stopStrategy(adoptionId: string) {
  const [adoption] = await db
    .select()
    .from(strategyAdoptions)
    .where(eq(strategyAdoptions.id, adoptionId))
    .limit(1);

  if (!adoption) {
    throw new Error(`Adoption "${adoptionId}" not found`);
  }
  if (adoption.status !== "active") {
    throw new Error(`Adoption is already ${adoption.status}`);
  }

  const [updated] = await db
    .update(strategyAdoptions)
    .set({ status: "stopped" })
    .where(eq(strategyAdoptions.id, adoptionId))
    .returning();

  await db
    .update(strategies)
    .set({
      totalAdopters: sql`GREATEST(${strategies.totalAdopters} - 1, 0)`,
      updatedAt: new Date(),
    })
    .where(eq(strategies.id, adoption.strategyId));

  return updated;
}

// ---------------------------------------------------------------------------
// 5. rateStrategy — Rate and review a strategy
// ---------------------------------------------------------------------------

/**
 * Submit a star rating (1-5) and optional review for a strategy.
 * Recalculates the strategy's aggregate avgRating and totalRatings.
 *
 * @param strategyId - Strategy to rate
 * @param raterId - Agent submitting the rating
 * @param rating - Star rating (1-5)
 * @param review - Optional text review
 * @returns The new rating record
 */
export async function rateStrategy(
  strategyId: string,
  raterId: string,
  rating: number,
  review?: string,
) {
  if (rating < 1 || rating > 5 || !Number.isInteger(rating)) {
    throw new Error("Rating must be an integer between 1 and 5");
  }

  const [strategy] = await db
    .select()
    .from(strategies)
    .where(eq(strategies.id, strategyId))
    .limit(1);

  if (!strategy) {
    throw new Error(`Strategy "${strategyId}" not found`);
  }

  // Check for existing rating by same rater
  const existing = await db
    .select()
    .from(strategyRatings)
    .where(
      and(
        eq(strategyRatings.strategyId, strategyId),
        eq(strategyRatings.raterId, raterId),
      ),
    )
    .limit(1);

  let ratingRecord;

  if (existing.length > 0) {
    // Update existing rating
    const [updated] = await db
      .update(strategyRatings)
      .set({
        rating,
        review: review ?? existing[0].review,
        createdAt: new Date(),
      })
      .where(eq(strategyRatings.id, existing[0].id))
      .returning();
    ratingRecord = updated;
  } else {
    // Create new rating
    const [created] = await db
      .insert(strategyRatings)
      .values({
        strategyId,
        raterId,
        rating,
        review,
      })
      .returning();
    ratingRecord = created;
  }

  // Recalculate aggregate rating
  const allRatings = await db
    .select({ rating: strategyRatings.rating })
    .from(strategyRatings)
    .where(eq(strategyRatings.strategyId, strategyId));

  const totalRatings = allRatings.length;
  const avgRating =
    totalRatings > 0
      ? (
          allRatings.reduce((sum: number, r: any) => sum + r.rating, 0) / totalRatings
        ).toFixed(2)
      : "0";

  await db
    .update(strategies)
    .set({
      avgRating,
      totalRatings,
      updatedAt: new Date(),
    })
    .where(eq(strategies.id, strategyId));

  return ratingRecord;
}

// ---------------------------------------------------------------------------
// 6. getStrategyCatalog — Browse all public strategies with filters
// ---------------------------------------------------------------------------

/**
 * Browse the public strategy marketplace with optional filters and sorting.
 *
 * @param category - Filter by category (optional)
 * @param riskLevel - Filter by risk level (optional)
 * @param sortBy - Sort order: newest, rating, adopters, performance (default: newest)
 * @returns Array of strategy records
 */
export async function getStrategyCatalog(
  category?: string,
  riskLevel?: string,
  sortBy: StrategySortBy = "newest",
) {
  // Build dynamic where conditions
  const conditions = [
    eq(strategies.isPublic, true),
    eq(strategies.status, "active"),
  ];

  if (category && VALID_CATEGORIES.includes(category as StrategyCategory)) {
    conditions.push(eq(strategies.category, category));
  }
  if (riskLevel && VALID_RISK_LEVELS.includes(riskLevel as RiskLevel)) {
    conditions.push(eq(strategies.riskLevel, riskLevel));
  }

  // Determine sort order
  const orderClause = (() => {
    switch (sortBy) {
      case "rating":
        return desc(strategies.avgRating);
      case "adopters":
        return desc(strategies.totalAdopters);
      case "performance":
        return desc(strategies.avgRating); // fallback to rating for now
      case "newest":
      default:
        return desc(strategies.createdAt);
    }
  })();

  const results = await db
    .select()
    .from(strategies)
    .where(and(...conditions))
    .orderBy(orderClause)
    .limit(50);

  return results;
}

// ---------------------------------------------------------------------------
// 7. getStrategyById — Get strategy details with adoption count, ratings, signals
// ---------------------------------------------------------------------------

/**
 * Get full strategy details including recent ratings, adoptions, and signals.
 *
 * @param id - Strategy ID
 * @returns Strategy with related data, or null if not found
 */
export async function getStrategyById(id: string) {
  const [strategy] = await db
    .select()
    .from(strategies)
    .where(eq(strategies.id, id))
    .limit(1);

  if (!strategy) {
    return null;
  }

  // Fetch recent ratings
  const ratings = await db
    .select()
    .from(strategyRatings)
    .where(eq(strategyRatings.strategyId, id))
    .orderBy(desc(strategyRatings.createdAt))
    .limit(10);

  // Fetch active adoptions
  const adoptions = await db
    .select()
    .from(strategyAdoptions)
    .where(
      and(
        eq(strategyAdoptions.strategyId, id),
        eq(strategyAdoptions.status, "active"),
      ),
    )
    .orderBy(desc(strategyAdoptions.adoptedAt));

  // Fetch recent signals
  const signals = await db
    .select()
    .from(strategySignals)
    .where(eq(strategySignals.strategyId, id))
    .orderBy(desc(strategySignals.createdAt))
    .limit(20);

  // Check for forks
  const forks = await db
    .select({
      id: strategies.id,
      name: strategies.name,
      creatorAgentId: strategies.creatorAgentId,
      createdAt: strategies.createdAt,
    })
    .from(strategies)
    .where(eq(strategies.parentStrategyId, id))
    .orderBy(desc(strategies.createdAt))
    .limit(10);

  return {
    ...strategy,
    ratings,
    adoptions,
    signals,
    forks,
    adoptionCount: adoptions.length,
    forkCount: forks.length,
  };
}

// ---------------------------------------------------------------------------
// 8. getStrategyLeaderboard — Top strategies by performance of adopters
// ---------------------------------------------------------------------------

/**
 * Get the strategy leaderboard ranked by average adopter performance.
 * Only includes strategies with at least one active adoption.
 *
 * @returns Array of strategies with performance metrics, sorted by avg performance
 */
export async function getStrategyLeaderboard() {
  const allStrategies = await db
    .select()
    .from(strategies)
    .where(
      and(
        eq(strategies.isPublic, true),
        eq(strategies.status, "active"),
      ),
    )
    .orderBy(desc(strategies.totalAdopters))
    .limit(50);

  const leaderboard = [];

  for (const strategy of allStrategies) {
    const adoptions = await db
      .select()
      .from(strategyAdoptions)
      .where(eq(strategyAdoptions.strategyId, strategy.id));

    if (adoptions.length === 0) continue;

    const performances = adoptions
      .map((a: any) => parseFloat(a.performanceSinceAdoption ?? "0"))
      .filter((p: number) => !isNaN(p));

    const avgPerf =
      performances.length > 0
        ? performances.reduce((sum: number, p: number) => sum + p, 0) / performances.length
        : 0;

    const totalTrades = adoptions.reduce(
      (sum: number, a: any) => sum + (a.tradesExecuted ?? 0),
      0,
    );

    leaderboard.push({
      strategyId: strategy.id,
      name: strategy.name,
      creatorAgentId: strategy.creatorAgentId,
      category: strategy.category,
      riskLevel: strategy.riskLevel,
      timeframe: strategy.timeframe,
      avgRating: strategy.avgRating,
      totalAdopters: strategy.totalAdopters,
      avgPerformance: Math.round(avgPerf * 100) / 100,
      bestPerformance:
        performances.length > 0
          ? Math.round(Math.max(...performances) * 100) / 100
          : 0,
      worstPerformance:
        performances.length > 0
          ? Math.round(Math.min(...performances) * 100) / 100
          : 0,
      totalTrades,
    });
  }

  // Sort by average performance descending
  leaderboard.sort((a, b) => b.avgPerformance - a.avgPerformance);

  return leaderboard;
}

// ---------------------------------------------------------------------------
// 9. getAgentStrategies — Strategies created by an agent
// ---------------------------------------------------------------------------

/**
 * Get all strategies created by a specific agent.
 *
 * @param agentId - Agent ID to look up
 * @returns Array of strategies created by the agent
 */
export async function getAgentStrategies(agentId: string) {
  const results = await db
    .select()
    .from(strategies)
    .where(eq(strategies.creatorAgentId, agentId))
    .orderBy(desc(strategies.createdAt));

  return results;
}

// ---------------------------------------------------------------------------
// 10. getAgentAdoptions — Strategies adopted by an agent
// ---------------------------------------------------------------------------

/**
 * Get all strategies adopted by a specific agent, with strategy details.
 *
 * @param agentId - Agent ID to look up
 * @returns Array of adoption records with strategy details
 */
export async function getAgentAdoptions(agentId: string) {
  const adoptions = await db
    .select()
    .from(strategyAdoptions)
    .where(eq(strategyAdoptions.agentId, agentId))
    .orderBy(desc(strategyAdoptions.adoptedAt));

  // Enrich with strategy details
  const enriched = [];
  for (const adoption of adoptions) {
    const [strategy] = await db
      .select({
        name: strategies.name,
        category: strategies.category,
        riskLevel: strategies.riskLevel,
        timeframe: strategies.timeframe,
        avgRating: strategies.avgRating,
        creatorAgentId: strategies.creatorAgentId,
      })
      .from(strategies)
      .where(eq(strategies.id, adoption.strategyId))
      .limit(1);

    enriched.push({
      ...adoption,
      strategy: strategy ?? null,
    });
  }

  return enriched;
}

// ---------------------------------------------------------------------------
// 11. generateStrategySignals — Generate buy/sell signals from strategy params
// ---------------------------------------------------------------------------

/**
 * Generate trading signals by evaluating a strategy's entry/exit rules
 * against current market data. Signals are persisted to strategy_signals.
 *
 * @param strategyId - Strategy whose rules to evaluate
 * @param marketData - Current market data array (symbol, price, change24h)
 * @returns Array of newly generated signal records
 */
export async function generateStrategySignals(
  strategyId: string,
  marketData: Array<{ symbol: string; price: number; change24h: number | null }>,
) {
  const [strategy] = await db
    .select()
    .from(strategies)
    .where(eq(strategies.id, strategyId))
    .limit(1);

  if (!strategy) {
    throw new Error(`Strategy "${strategyId}" not found`);
  }

  const params = strategy.parameters as StrategyParameters;
  const generatedSignals = [];

  // Determine which symbols to evaluate
  const universe = params.universe?.length
    ? marketData.filter((m) =>
        params.universe!.some(
          (u) => u.toLowerCase() === m.symbol.toLowerCase(),
        ),
      )
    : marketData;

  for (const stock of universe) {
    const change = stock.change24h ?? 0;

    // Evaluate each entry rule
    for (const rule of params.entryRules) {
      let triggered = false;
      let strength = 0;
      let direction: "long" | "short" = "long";

      switch (rule.indicator.toLowerCase()) {
        case "momentum":
          if (rule.condition === ">" && change > rule.value) {
            triggered = true;
            strength = Math.min(100, Math.round(Math.abs(change - rule.value) * 10 * rule.weight));
            direction = "long";
          } else if (rule.condition === "<" && change < rule.value) {
            triggered = true;
            strength = Math.min(100, Math.round(Math.abs(change - rule.value) * 10 * rule.weight));
            direction = "short";
          }
          break;

        case "price":
          if (rule.condition === ">" && stock.price > rule.value) {
            triggered = true;
            strength = Math.min(100, Math.round(((stock.price - rule.value) / rule.value) * 100 * rule.weight));
            direction = "long";
          } else if (rule.condition === "<" && stock.price < rule.value) {
            triggered = true;
            strength = Math.min(100, Math.round(((rule.value - stock.price) / rule.value) * 100 * rule.weight));
            direction = "short";
          }
          break;

        case "volatility":
          if (Math.abs(change) > rule.value) {
            triggered = true;
            strength = Math.min(100, Math.round(Math.abs(change) * 10 * rule.weight));
            direction = change > 0 ? "long" : "short";
          }
          break;

        case "contrarian":
          // Buy when down, sell when up
          if (rule.condition === "reversal" && Math.abs(change) > rule.value) {
            triggered = true;
            strength = Math.min(100, Math.round(Math.abs(change) * 8 * rule.weight));
            direction = change < 0 ? "long" : "short";
          }
          break;

        default:
          // Generic threshold check
          if (Math.abs(change) > rule.value) {
            triggered = true;
            strength = Math.min(100, Math.round(Math.abs(change) * 5 * rule.weight));
            direction = change > 0 ? "long" : "short";
          }
      }

      if (triggered && strength > 10) {
        const metadata: SignalMetadata = {
          triggerRule: `${rule.indicator} ${rule.condition} ${rule.value}`,
          indicators: { change24h: change, price: stock.price },
          confidence: strength,
          reasoning: `Entry rule triggered: ${rule.indicator} ${rule.condition} ${rule.value} (actual: ${change.toFixed(2)}%)`,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        };

        const [signal] = await db
          .insert(strategySignals)
          .values({
            strategyId,
            symbol: stock.symbol,
            signalType: "entry",
            direction,
            strength,
            price: stock.price.toString(),
            metadata,
          })
          .returning();

        generatedSignals.push(signal);
      }
    }

    // Evaluate exit rules for stop loss signals
    for (const rule of params.exitRules) {
      if (rule.type === "stop_loss" && change < -rule.value) {
        const strength = Math.min(100, Math.round(Math.abs(change) * 15));

        const metadata: SignalMetadata = {
          triggerRule: `stop_loss at -${rule.value}%`,
          indicators: { change24h: change, price: stock.price },
          confidence: strength,
          reasoning: `Stop loss triggered: ${change.toFixed(2)}% drop exceeds -${rule.value}% threshold`,
        };

        const [signal] = await db
          .insert(strategySignals)
          .values({
            strategyId,
            symbol: stock.symbol,
            signalType: "stop_loss",
            direction: "close",
            strength,
            price: stock.price.toString(),
            metadata,
          })
          .returning();

        generatedSignals.push(signal);
      }

      if (rule.type === "take_profit" && change > rule.value) {
        const strength = Math.min(100, Math.round(change * 12));

        const metadata: SignalMetadata = {
          triggerRule: `take_profit at +${rule.value}%`,
          indicators: { change24h: change, price: stock.price },
          confidence: strength,
          reasoning: `Take profit triggered: ${change.toFixed(2)}% gain exceeds +${rule.value}% threshold`,
        };

        const [signal] = await db
          .insert(strategySignals)
          .values({
            strategyId,
            symbol: stock.symbol,
            signalType: "exit",
            direction: "close",
            strength,
            price: stock.price.toString(),
            metadata,
          })
          .returning();

        generatedSignals.push(signal);
      }
    }
  }

  return generatedSignals;
}

// ---------------------------------------------------------------------------
// 12. getStrategyPerformance — Aggregate performance across all adopters
// ---------------------------------------------------------------------------

/**
 * Compute aggregate performance metrics for a strategy across all adopters.
 *
 * @param strategyId - Strategy to analyze
 * @returns Performance aggregate data
 */
export async function getStrategyPerformance(
  strategyId: string,
): Promise<StrategyPerformance | null> {
  const [strategy] = await db
    .select()
    .from(strategies)
    .where(eq(strategies.id, strategyId))
    .limit(1);

  if (!strategy) return null;

  const adoptions = await db
    .select()
    .from(strategyAdoptions)
    .where(eq(strategyAdoptions.strategyId, strategyId));

  const activeAdoptions = adoptions.filter((a: any) => a.status === "active");

  const performances = adoptions
    .map((a: any) => parseFloat(a.performanceSinceAdoption ?? "0"))
    .filter((p: number) => !isNaN(p))
    .sort((a: number, b: number) => a - b);

  const avgPerf =
    performances.length > 0
      ? performances.reduce((s: number, p: number) => s + p, 0) / performances.length
      : 0;

  const medianPerf =
    performances.length > 0
      ? performances.length % 2 === 0
        ? (performances[performances.length / 2 - 1] +
            performances[performances.length / 2]) /
          2
        : performances[Math.floor(performances.length / 2)]
      : 0;

  const totalTrades = adoptions.reduce(
    (sum: number, a: any) => sum + (a.tradesExecuted ?? 0),
    0,
  );

  // Recent signals
  const recentSignals = await db
    .select()
    .from(strategySignals)
    .where(eq(strategySignals.strategyId, strategyId))
    .orderBy(desc(strategySignals.createdAt))
    .limit(10);

  // Total signals count
  const allSignals = await db
    .select({ id: strategySignals.id })
    .from(strategySignals)
    .where(eq(strategySignals.strategyId, strategyId));

  return {
    strategyId,
    strategyName: strategy.name,
    totalAdopters: adoptions.length,
    activeAdopters: activeAdoptions.length,
    avgPerformance: Math.round(avgPerf * 100) / 100,
    bestPerformance:
      performances.length > 0
        ? Math.round(Math.max(...performances) * 100) / 100
        : 0,
    worstPerformance:
      performances.length > 0
        ? Math.round(Math.min(...performances) * 100) / 100
        : 0,
    medianPerformance: Math.round(medianPerf * 100) / 100,
    totalTradesExecuted: totalTrades,
    signalsGenerated: allSignals.length,
    recentSignals,
  };
}

// ---------------------------------------------------------------------------
// 13. getTrendingStrategies — Recently popular by adoption velocity
// ---------------------------------------------------------------------------

/**
 * Get trending strategies based on recent adoption velocity.
 * Strategies with the most new adoptions in the last 7 days rank highest.
 *
 * @returns Array of trending strategy data
 */
export async function getTrendingStrategies() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Get all recent adoptions
  const recentAdoptions = await db
    .select()
    .from(strategyAdoptions)
    .where(gte(strategyAdoptions.adoptedAt, sevenDaysAgo))
    .orderBy(desc(strategyAdoptions.adoptedAt));

  // Count adoptions per strategy
  const adoptionCounts = new Map<string, number>();
  for (const adoption of recentAdoptions) {
    const count = adoptionCounts.get(adoption.strategyId) ?? 0;
    adoptionCounts.set(adoption.strategyId, count + 1);
  }

  // Fetch strategy details for top trending
  const sortedEntries = Array.from(adoptionCounts.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20);

  const trending = [];
  for (const [strategyId, recentAdoptionCount] of sortedEntries) {
    const [strategy] = await db
      .select()
      .from(strategies)
      .where(eq(strategies.id, strategyId))
      .limit(1);

    if (!strategy || !strategy.isPublic) continue;

    trending.push({
      strategyId: strategy.id,
      name: strategy.name,
      category: strategy.category,
      riskLevel: strategy.riskLevel,
      creatorAgentId: strategy.creatorAgentId,
      avgRating: strategy.avgRating,
      totalAdopters: strategy.totalAdopters,
      recentAdoptions: recentAdoptionCount,
      trendScore: recentAdoptionCount * (parseFloat(strategy.avgRating) + 1),
    });
  }

  // Also include newly created strategies with high ratings
  const newStrategies = await db
    .select()
    .from(strategies)
    .where(
      and(
        eq(strategies.isPublic, true),
        eq(strategies.status, "active"),
        gte(strategies.createdAt, sevenDaysAgo),
      ),
    )
    .orderBy(desc(strategies.avgRating))
    .limit(5);

  for (const strategy of newStrategies) {
    if (trending.some((t) => t.strategyId === strategy.id)) continue;

    trending.push({
      strategyId: strategy.id,
      name: strategy.name,
      category: strategy.category,
      riskLevel: strategy.riskLevel,
      creatorAgentId: strategy.creatorAgentId,
      avgRating: strategy.avgRating,
      totalAdopters: strategy.totalAdopters,
      recentAdoptions: 0,
      trendScore: parseFloat(strategy.avgRating) * 2,
    });
  }

  // Sort by trend score
  trending.sort((a, b) => b.trendScore - a.trendScore);

  return trending;
}

// ---------------------------------------------------------------------------
// 14. getStrategyComparison — Compare multiple strategies head-to-head
// ---------------------------------------------------------------------------

/**
 * Compare multiple strategies side by side with performance and signal data.
 *
 * @param strategyIds - Array of strategy IDs to compare (2-5 strategies)
 * @returns Comparison object with per-strategy metrics and recommendation
 */
export async function getStrategyComparison(
  strategyIds: string[],
): Promise<StrategyComparison> {
  if (strategyIds.length < 2 || strategyIds.length > 5) {
    throw new Error("Must compare between 2 and 5 strategies");
  }

  const comparisonData = [];

  for (const id of strategyIds) {
    const [strategy] = await db
      .select()
      .from(strategies)
      .where(eq(strategies.id, id))
      .limit(1);

    if (!strategy) continue;

    // Get adoptions for average performance
    const adoptions = await db
      .select()
      .from(strategyAdoptions)
      .where(eq(strategyAdoptions.strategyId, id));

    const performances = adoptions
      .map((a: any) => parseFloat(a.performanceSinceAdoption ?? "0"))
      .filter((p: number) => !isNaN(p));

    const avgPerf =
      performances.length > 0
        ? performances.reduce((s: number, p: number) => s + p, 0) / performances.length
        : 0;

    // Get signal count and recent strength
    const signals = await db
      .select()
      .from(strategySignals)
      .where(eq(strategySignals.strategyId, id))
      .orderBy(desc(strategySignals.createdAt))
      .limit(10);

    const recentStrength =
      signals.length > 0
        ? signals.reduce((s: number, sig: any) => s + sig.strength, 0) / signals.length
        : 0;

    // Total signals
    const allSignals = await db
      .select({ id: strategySignals.id })
      .from(strategySignals)
      .where(eq(strategySignals.strategyId, id));

    comparisonData.push({
      id: strategy.id,
      name: strategy.name,
      category: strategy.category,
      riskLevel: strategy.riskLevel,
      timeframe: strategy.timeframe,
      avgRating: strategy.avgRating,
      totalAdopters: strategy.totalAdopters,
      avgPerformance: Math.round(avgPerf * 100) / 100,
      totalSignals: allSignals.length,
      recentSignalStrength: Math.round(recentStrength),
    });
  }

  // Generate recommendation
  const bestByPerf = [...comparisonData].sort(
    (a, b) => b.avgPerformance - a.avgPerformance,
  )[0];
  const bestByRating = [...comparisonData].sort(
    (a, b) => parseFloat(b.avgRating) - parseFloat(a.avgRating),
  )[0];
  const bestByAdopters = [...comparisonData].sort(
    (a, b) => b.totalAdopters - a.totalAdopters,
  )[0];

  let recommendation: string;
  if (bestByPerf && bestByPerf.id === bestByRating?.id) {
    recommendation = `"${bestByPerf.name}" leads in both performance (${bestByPerf.avgPerformance}%) and rating (${bestByPerf.avgRating} stars).`;
  } else if (bestByPerf) {
    recommendation = `"${bestByPerf.name}" has the best performance (${bestByPerf.avgPerformance}%), while "${bestByRating?.name ?? "N/A"}" has the highest rating (${bestByRating?.avgRating ?? 0} stars).`;
  } else {
    recommendation = "Insufficient data for recommendation. All strategies are new.";
  }

  return {
    strategies: comparisonData,
    recommendation,
  };
}

// ---------------------------------------------------------------------------
// 15. getMarketplaceStats — Total strategies, adoptions, avg performance
// ---------------------------------------------------------------------------

/**
 * Get marketplace-wide aggregate statistics.
 *
 * @returns Marketplace stats including totals, averages, top categories, and recent activity
 */
export async function getMarketplaceStats(): Promise<MarketplaceStats> {
  // Total strategies
  const allStrategies = await db.select().from(strategies);
  const activeStrategies = allStrategies.filter((s: any) => s.status === "active");

  // Total adoptions
  const allAdoptions = await db.select().from(strategyAdoptions);
  const activeAdoptions = allAdoptions.filter((a: any) => a.status === "active");

  // Total signals
  const allSignals = await db
    .select({ id: strategySignals.id })
    .from(strategySignals);

  // Average performance across all active adoptions
  const performances = activeAdoptions
    .map((a: any) => parseFloat(a.performanceSinceAdoption ?? "0"))
    .filter((p: number) => !isNaN(p));

  const avgPerformance =
    performances.length > 0
      ? Math.round(
          (performances.reduce((s: number, p: number) => s + p, 0) / performances.length) * 100,
        ) / 100
      : 0;

  // Average rating across all strategies
  const ratingValues = allStrategies
    .map((s: any) => parseFloat(s.avgRating))
    .filter((r: number) => r > 0);

  const avgRating =
    ratingValues.length > 0
      ? Math.round(
          (ratingValues.reduce((s: number, r: number) => s + r, 0) / ratingValues.length) * 100,
        ) / 100
      : 0;

  // Top categories
  const categoryCounts = new Map<string, number>();
  for (const s of activeStrategies) {
    const count = categoryCounts.get(s.category) ?? 0;
    categoryCounts.set(s.category, count + 1);
  }
  const topCategories = Array.from(categoryCounts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  // Top creators
  const creatorCounts = new Map<string, number>();
  for (const s of allStrategies) {
    const count = creatorCounts.get(s.creatorAgentId) ?? 0;
    creatorCounts.set(s.creatorAgentId, count + 1);
  }
  const topCreators = Array.from(creatorCounts.entries())
    .map(([agentId, strategyCount]) => ({ agentId, strategyCount }))
    .sort((a, b) => b.strategyCount - a.strategyCount)
    .slice(0, 10);

  // Recent activity
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const recentStrategies = allStrategies.filter(
    (s: any) => s.createdAt && s.createdAt >= sevenDaysAgo,
  );
  const recentAdoptionsList = allAdoptions.filter(
    (a: any) => a.adoptedAt && a.adoptedAt >= sevenDaysAgo,
  );

  const recentSignals = await db
    .select({ id: strategySignals.id })
    .from(strategySignals)
    .where(gte(strategySignals.createdAt, oneDayAgo));

  return {
    totalStrategies: allStrategies.length,
    activeStrategies: activeStrategies.length,
    totalAdoptions: allAdoptions.length,
    activeAdoptions: activeAdoptions.length,
    totalSignalsGenerated: allSignals.length,
    avgPerformance,
    avgRating,
    topCategories,
    topCreators,
    recentActivity: {
      strategiesCreatedLast7d: recentStrategies.length,
      adoptionsLast7d: recentAdoptionsList.length,
      signalsLast24h: recentSignals.length,
    },
  };
}
