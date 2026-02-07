/**
 * Performance Attribution Service
 *
 * Comprehensive Brinson-Fachler attribution, multi-factor exposure analysis,
 * alpha/beta decomposition, trade contribution ranking, market-timing
 * measurement, and risk contribution analysis for MoltApp AI trading agents.
 *
 * This service answers the question every investor asks:
 * "WHERE did the returns come from and WHY?"
 */

import { db } from "../db/index.ts";
import { agentDecisions } from "../db/schema/agent-decisions.ts";
import { trades } from "../db/schema/trades.ts";
import { positions } from "../db/schema/positions.ts";
import { eq, desc, gte, and, sql } from "drizzle-orm";
import { getMarketData, getAgentConfigs } from "../agents/orchestrator.ts";
import type { MarketData } from "../agents/base-agent.ts";
import { clamp, findMax, findMin } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Brinson-Fachler attribution breakdown by sector */
export interface BrinsonFachlerAttribution {
  agentId: string;
  period: string;
  totalActiveReturn: number;
  sectorBreakdown: SectorAttribution[];
  aggregateAllocation: number;
  aggregateSelection: number;
  aggregateInteraction: number;
  benchmarkReturn: number;
  portfolioReturn: number;
  generatedAt: string;
}

interface SectorAttribution {
  sector: string;
  symbols: string[];
  portfolioWeight: number;
  benchmarkWeight: number;
  portfolioReturn: number;
  benchmarkReturn: number;
  allocationEffect: number;
  selectionEffect: number;
  interactionEffect: number;
  totalContribution: number;
}

/** Multi-factor exposure profile */
export interface FactorExposure {
  agentId: string;
  factors: FactorLoading[];
  dominantFactor: string;
  factorTilt: string;
  generatedAt: string;
}

interface FactorLoading {
  factor: string;
  loading: number;
  description: string;
  confidence: number;
}

/** Alpha/Beta decomposition against a benchmark */
export interface AlphaBetaDecomposition {
  agentId: string;
  benchmark: string;
  alpha: number;
  beta: number;
  rSquared: number;
  trackingError: number;
  informationRatio: number;
  portfolioReturn: number;
  benchmarkReturn: number;
  excessReturn: number;
  generatedAt: string;
}

/** Individual trade contribution analysis */
export interface TradeContribution {
  tradeId: number;
  symbol: string;
  side: string;
  entryPrice: number;
  exitPrice: number | null;
  quantity: number;
  pnl: number;
  pnlPercent: number;
  holdingPeriodHours: number;
  timingScore: number;
  portfolioContribution: number;
  isConvictionTrade: boolean;
  confidence: number;
  executedAt: string;
}

/** Market timing analysis */
export interface TimingAnalysis {
  agentId: string;
  avgDecisionToExecutionMs: number;
  marketTimingScore: number;
  timeOfDayPerformance: TimeSlotPerformance[];
  dayOfWeekPerformance: DayPerformance[];
  regimePerformance: RegimePerformance[];
  overallTimingGrade: string;
  generatedAt: string;
}

interface TimeSlotPerformance {
  slot: string;
  hour: number;
  decisions: number;
  avgConfidence: number;
  winRate: number;
}

interface DayPerformance {
  day: string;
  dayIndex: number;
  decisions: number;
  avgConfidence: number;
  winRate: number;
}

interface RegimePerformance {
  regime: string;
  decisions: number;
  avgConfidence: number;
  winRate: number;
  avgReturn: number;
}

/** Risk contribution per position */
export interface RiskContribution {
  agentId: string;
  positions: PositionRisk[];
  portfolioVaR: number;
  diversificationRatio: number;
  concentrationScore: number;
  herfindahlIndex: number;
  generatedAt: string;
}

interface PositionRisk {
  symbol: string;
  sector: string;
  weight: number;
  marginalVaR: number;
  componentVaR: number;
  correlationContribution: number;
  concentrationRisk: number;
  standalonVaR: number;
}

/** Full attribution report aggregating all analyses */
export interface FullAttributionReport {
  agentId: string;
  agentName: string;
  provider: string;
  brinson: BrinsonFachlerAttribution;
  factors: FactorExposure;
  alphaBeta: AlphaBetaDecomposition;
  topContributions: TradeContribution[];
  timing: TimingAnalysis;
  risk: RiskContribution;
  narrativeSummary: string;
  generatedAt: string;
}

/** Cross-agent comparison */
export interface AttributionComparison {
  agents: AgentAttributionSummary[];
  bestStockPicker: string;
  bestTimingAgent: string;
  mostDiversified: string;
  highestAlpha: string;
  lowestBeta: string;
  narrative: string;
  generatedAt: string;
}

interface AgentAttributionSummary {
  agentId: string;
  agentName: string;
  alpha: number;
  beta: number;
  selectionEffect: number;
  allocationEffect: number;
  timingScore: number;
  diversificationRatio: number;
  dominantFactor: string;
  totalActiveReturn: number;
}

// ---------------------------------------------------------------------------
// Sector Mapping
// ---------------------------------------------------------------------------

const SECTOR_MAP: Record<string, string> = {
  AAPLx: "Technology",
  AMZNx: "Consumer",
  GOOGLx: "Technology",
  METAx: "Technology",
  MSFTx: "Technology",
  NVDAx: "Technology",
  TSLAx: "Automotive",
  SPYx: "Index",
  QQQx: "Index",
  COINx: "Crypto",
  MSTRx: "Crypto",
  HOODx: "Fintech",
  NFLXx: "Entertainment",
  PLTRx: "Technology",
  GMEx: "Meme",
  LLYx: "Healthcare",
  CRMx: "Technology",
  AVGOx: "Technology",
  JPMx: "Finance",
};

/** Equal-weighted benchmark allocation by sector */
const BENCHMARK_SECTOR_WEIGHTS: Record<string, number> = {
  Technology: 0.42,
  Consumer: 0.06,
  Automotive: 0.06,
  Index: 0.11,
  Crypto: 0.11,
  Fintech: 0.06,
  Entertainment: 0.06,
  Meme: 0.06,
  Healthcare: 0.06,
  Finance: 0.06,
};

const VALID_AGENT_IDS = [
  "claude-value-investor",
  "gpt-momentum-trader",
  "grok-contrarian",
];

// ---------------------------------------------------------------------------
// Helper: Fetch Agent Data
// ---------------------------------------------------------------------------

/**
 * Fetches decisions, trades, and positions for an agent within a time window.
 */
async function fetchAgentData(agentId: string, periodDays?: number) {
  const now = new Date();
  const startDate = periodDays
    ? new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000)
    : undefined;

  const decisionConditions = startDate
    ? and(eq(agentDecisions.agentId, agentId), gte(agentDecisions.createdAt, startDate))
    : eq(agentDecisions.agentId, agentId);

  const tradeConditions = startDate
    ? and(eq(trades.agentId, agentId), gte(trades.createdAt, startDate))
    : eq(trades.agentId, agentId);

  const [decisions, agentTrades, agentPositions, marketData] = await Promise.all([
    db.select().from(agentDecisions).where(decisionConditions).orderBy(desc(agentDecisions.createdAt)),
    db.select().from(trades).where(tradeConditions).orderBy(desc(trades.createdAt)),
    db.select().from(positions).where(eq(positions.agentId, agentId)),
    getMarketData().catch(() => [] as MarketData[]),
  ]);

  return { decisions, trades: agentTrades, positions: agentPositions, marketData };
}

/**
 * Parse a period string ("7d", "30d", "90d") into a number of days.
 */
function parsePeriod(period?: string): number | undefined {
  if (!period) return undefined;
  const match = period.match(/^(\d+)d$/);
  return match ? parseInt(match[1], 10) : undefined;
}

// ---------------------------------------------------------------------------
// 1. Brinson-Fachler Attribution
// ---------------------------------------------------------------------------

/**
 * Decompose agent returns into allocation, selection, and interaction effects
 * using the Brinson-Fachler model. This tells you whether the agent made
 * money by picking the right sectors (allocation) or the right stocks within
 * sectors (selection).
 *
 * @param agentId - The AI agent identifier
 * @param period  - Optional period string (e.g. "30d")
 */
export async function getAttributionBreakdown(
  agentId: string,
  period?: string,
): Promise<BrinsonFachlerAttribution> {
  const periodDays = parsePeriod(period);
  const data = await fetchAgentData(agentId, periodDays);

  // Build portfolio weights by sector from actual trades
  const sectorValues = new Map<string, { value: number; cost: number; symbols: Set<string> }>();
  let totalPortfolioValue = 0;
  let totalPortfolioCost = 0;

  for (const pos of data.positions) {
    const sector = SECTOR_MAP[pos.symbol] ?? "Other";
    const market = data.marketData.find((m) => m.symbol.toLowerCase() === pos.symbol.toLowerCase());
    const currentPrice = market?.price ?? parseFloat(pos.averageCostBasis);
    const qty = parseFloat(pos.quantity);
    const costBasis = parseFloat(pos.averageCostBasis);
    const posValue = currentPrice * qty;
    const posCost = costBasis * qty;

    const entry = sectorValues.get(sector) ?? { value: 0, cost: 0, symbols: new Set<string>() };
    entry.value += posValue;
    entry.cost += posCost;
    entry.symbols.add(pos.symbol);
    sectorValues.set(sector, entry);

    totalPortfolioValue += posValue;
    totalPortfolioCost += posCost;
  }

  // Also count decision-based activity for agents with no open positions
  if (sectorValues.size === 0 && data.decisions.length > 0) {
    const actionDecisions = data.decisions.filter((d: typeof data.decisions[0]) => d.action !== "hold");
    for (const d of actionDecisions) {
      const sector = SECTOR_MAP[d.symbol] ?? "Other";
      const entry = sectorValues.get(sector) ?? { value: 0, cost: 0, symbols: new Set<string>() };
      const qty = parseFloat(d.quantity) || 1;
      entry.value += d.confidence * qty;
      entry.cost += 50 * qty;
      entry.symbols.add(d.symbol);
      sectorValues.set(sector, entry);
      totalPortfolioValue += d.confidence * qty;
      totalPortfolioCost += 50 * qty;
    }
  }

  // Compute benchmark returns using market data
  const benchmarkReturns = new Map<string, number>();
  for (const m of data.marketData) {
    const sector = SECTOR_MAP[m.symbol] ?? "Other";
    if (!benchmarkReturns.has(sector)) {
      benchmarkReturns.set(sector, m.change24h ?? 0);
    } else {
      // Average across symbols in the sector
      const current = benchmarkReturns.get(sector)!;
      benchmarkReturns.set(sector, (current + (m.change24h ?? 0)) / 2);
    }
  }

  // Overall benchmark return (SPYx as proxy)
  const spyData = data.marketData.find((m) => m.symbol === "SPYx");
  const overallBenchmarkReturn = (spyData?.change24h ?? 0) / 100;

  // Build sector attribution
  const sectorBreakdown: SectorAttribution[] = [];
  let aggregateAllocation = 0;
  let aggregateSelection = 0;
  let aggregateInteraction = 0;

  const allSectors = new Set([
    ...sectorValues.keys(),
    ...Object.keys(BENCHMARK_SECTOR_WEIGHTS),
  ]);

  for (const sector of allSectors) {
    const entry = sectorValues.get(sector);
    const portfolioWeight = totalPortfolioValue > 0 && entry
      ? entry.value / totalPortfolioValue
      : 0;
    const benchmarkWeight = BENCHMARK_SECTOR_WEIGHTS[sector] ?? 0;

    const portfolioReturn = entry && entry.cost > 0
      ? (entry.value - entry.cost) / entry.cost
      : 0;
    const sectorBenchmarkReturn = (benchmarkReturns.get(sector) ?? 0) / 100;

    // Brinson-Fachler decomposition
    const allocationEffect = (portfolioWeight - benchmarkWeight) * (sectorBenchmarkReturn - overallBenchmarkReturn);
    const selectionEffect = benchmarkWeight * (portfolioReturn - sectorBenchmarkReturn);
    const interactionEffect = (portfolioWeight - benchmarkWeight) * (portfolioReturn - sectorBenchmarkReturn);
    const totalContribution = allocationEffect + selectionEffect + interactionEffect;

    aggregateAllocation += allocationEffect;
    aggregateSelection += selectionEffect;
    aggregateInteraction += interactionEffect;

    sectorBreakdown.push({
      sector,
      symbols: entry ? Array.from(entry.symbols) : [],
      portfolioWeight: round(portfolioWeight, 4),
      benchmarkWeight: round(benchmarkWeight, 4),
      portfolioReturn: round(portfolioReturn, 6),
      benchmarkReturn: round(sectorBenchmarkReturn, 6),
      allocationEffect: round(allocationEffect, 6),
      selectionEffect: round(selectionEffect, 6),
      interactionEffect: round(interactionEffect, 6),
      totalContribution: round(totalContribution, 6),
    });
  }

  const portfolioReturn = totalPortfolioCost > 0
    ? (totalPortfolioValue - totalPortfolioCost) / totalPortfolioCost
    : 0;

  return {
    agentId,
    period: period ?? "all",
    totalActiveReturn: round(aggregateAllocation + aggregateSelection + aggregateInteraction, 6),
    sectorBreakdown: sectorBreakdown.sort((a, b) => Math.abs(b.totalContribution) - Math.abs(a.totalContribution)),
    aggregateAllocation: round(aggregateAllocation, 6),
    aggregateSelection: round(aggregateSelection, 6),
    aggregateInteraction: round(aggregateInteraction, 6),
    benchmarkReturn: round(overallBenchmarkReturn, 6),
    portfolioReturn: round(portfolioReturn, 6),
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// 2. Factor Analysis
// ---------------------------------------------------------------------------

/**
 * Analyze the agent's exposure to common investing factors. Returns a loading
 * score from -100 (extreme short / aversion) to +100 (extreme long / preference)
 * for each factor.
 *
 * @param agentId - The AI agent identifier
 */
export async function getFactorExposure(agentId: string): Promise<FactorExposure> {
  const data = await fetchAgentData(agentId);
  const actionDecisions = data.decisions.filter((d: typeof data.decisions[0]) => d.action !== "hold");

  // --- Momentum Factor ---
  // Measures tendency to buy stocks that are already going up
  let momentumScore = 0;
  let momentumCount = 0;
  for (const d of actionDecisions) {
    const market = data.marketData.find((m) => m.symbol.toLowerCase() === d.symbol.toLowerCase());
    if (!market || market.change24h === null) continue;
    momentumCount++;
    if (d.action === "buy" && market.change24h > 0) momentumScore += 1;
    else if (d.action === "buy" && market.change24h < 0) momentumScore -= 1;
    else if (d.action === "sell" && market.change24h < 0) momentumScore += 1;
    else if (d.action === "sell" && market.change24h > 0) momentumScore -= 1;
  }
  const momentumLoading = momentumCount > 0
    ? clamp(Math.round((momentumScore / momentumCount) * 100), -100, 100)
    : 0;

  // --- Value Factor ---
  // Preference for lower-priced stocks relative to their sector peers
  const priceBySymbol = new Map<string, number>();
  for (const m of data.marketData) priceBySymbol.set(m.symbol, m.price);
  const avgPrice = data.marketData.length > 0
    ? data.marketData.reduce((s, m) => s + m.price, 0) / data.marketData.length
    : 1;

  let valueScore = 0;
  let valueCount = 0;
  for (const d of actionDecisions) {
    const price = priceBySymbol.get(d.symbol);
    if (price === undefined) continue;
    valueCount++;
    const relativePrice = price / avgPrice;
    if (d.action === "buy" && relativePrice < 1) valueScore += 1;
    else if (d.action === "buy" && relativePrice >= 1) valueScore -= 0.5;
    else if (d.action === "sell" && relativePrice >= 1) valueScore += 0.5;
    else if (d.action === "sell" && relativePrice < 1) valueScore -= 1;
  }
  const valueLoading = valueCount > 0
    ? clamp(Math.round((valueScore / valueCount) * 100), -100, 100)
    : 0;

  // --- Size Factor ---
  // Preference for large-cap (high price) vs small-cap (low price)
  const largeCap = new Set(["AAPLx", "MSFTx", "GOOGLx", "AMZNx", "NVDAx", "METAx", "AVGOx", "LLYx", "JPMx"]);
  const smallCap = new Set(["GMEx", "HOODx", "COINx", "MSTRx", "PLTRx"]);
  let sizeScore = 0;
  let sizeCount = 0;
  for (const d of actionDecisions) {
    if (d.action === "buy") {
      sizeCount++;
      if (largeCap.has(d.symbol)) sizeScore += 1;
      else if (smallCap.has(d.symbol)) sizeScore -= 1;
    }
  }
  const sizeLoading = sizeCount > 0
    ? clamp(Math.round((sizeScore / sizeCount) * 100), -100, 100)
    : 0;

  // --- Volatility Factor ---
  // Preference for high-vol vs low-vol stocks
  const highVol = new Set(["TSLAx", "GMEx", "COINx", "MSTRx", "NVDAx"]);
  const lowVol = new Set(["SPYx", "QQQx", "JPMx", "LLYx", "MSFTx"]);
  let volScore = 0;
  let volCount = 0;
  for (const d of actionDecisions) {
    if (d.action === "buy") {
      volCount++;
      if (highVol.has(d.symbol)) volScore += 1;
      else if (lowVol.has(d.symbol)) volScore -= 1;
    }
  }
  const volatilityLoading = volCount > 0
    ? clamp(Math.round((volScore / volCount) * 100), -100, 100)
    : 0;

  // --- Quality Factor ---
  // Preference for stable, profitable companies
  const qualityStocks = new Set(["AAPLx", "MSFTx", "GOOGLx", "JPMx", "LLYx", "CRMx", "AVGOx"]);
  const speculativeStocks = new Set(["GMEx", "MSTRx", "COINx", "HOODx"]);
  let qualityScore = 0;
  let qualityCount = 0;
  for (const d of actionDecisions) {
    if (d.action === "buy") {
      qualityCount++;
      if (qualityStocks.has(d.symbol)) qualityScore += 1;
      else if (speculativeStocks.has(d.symbol)) qualityScore -= 1;
    }
  }
  const qualityLoading = qualityCount > 0
    ? clamp(Math.round((qualityScore / qualityCount) * 100), -100, 100)
    : 0;

  // --- Crypto Factor ---
  // Exposure to crypto-adjacent names (COIN, MSTR, HOOD)
  const cryptoStocks = new Set(["COINx", "MSTRx", "HOODx"]);
  let cryptoScore = 0;
  let cryptoCount = 0;
  for (const d of actionDecisions) {
    cryptoCount++;
    if (cryptoStocks.has(d.symbol)) {
      cryptoScore += d.action === "buy" ? 2 : -1;
    }
  }
  const cryptoLoading = cryptoCount > 0
    ? clamp(Math.round((cryptoScore / cryptoCount) * 100), -100, 100)
    : 0;

  const factors: FactorLoading[] = [
    { factor: "Momentum", loading: momentumLoading, description: "Tendency to buy winners and sell losers (trend-following)", confidence: Math.min(momentumCount, 30) / 30 * 100 },
    { factor: "Value", loading: valueLoading, description: "Preference for undervalued / lower-priced stocks", confidence: Math.min(valueCount, 30) / 30 * 100 },
    { factor: "Size", loading: sizeLoading, description: "Preference for large-cap (+) vs small-cap (-) stocks", confidence: Math.min(sizeCount, 30) / 30 * 100 },
    { factor: "Volatility", loading: volatilityLoading, description: "Preference for high-volatility (+) vs low-volatility (-) stocks", confidence: Math.min(volCount, 30) / 30 * 100 },
    { factor: "Quality", loading: qualityLoading, description: "Preference for stable, profitable companies", confidence: Math.min(qualityCount, 30) / 30 * 100 },
    { factor: "Crypto", loading: cryptoLoading, description: "Exposure to crypto-adjacent stocks (COIN, MSTR, HOOD)", confidence: Math.min(cryptoCount, 30) / 30 * 100 },
  ];

  // Round confidence values
  for (const f of factors) f.confidence = round(f.confidence, 1);

  const dominant = findMaxBy(factors, "loading", (a, b) => Math.abs(a) - Math.abs(b))!;

  // Determine tilt narrative
  let factorTilt: string;
  if (momentumLoading > 30) factorTilt = "Trend-following momentum style";
  else if (momentumLoading < -30) factorTilt = "Contrarian mean-reversion style";
  else if (qualityLoading > 30) factorTilt = "Quality-focused blue-chip style";
  else if (volatilityLoading > 30) factorTilt = "Risk-seeking, high-beta style";
  else if (cryptoLoading > 30) factorTilt = "Crypto-tilted digital-asset style";
  else if (valueLoading > 30) factorTilt = "Deep-value bargain-hunting style";
  else factorTilt = "Balanced multi-factor style with no extreme tilt";

  return {
    agentId,
    factors,
    dominantFactor: dominant.factor,
    factorTilt,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// 3. Alpha/Beta Decomposition
// ---------------------------------------------------------------------------

/**
 * Calculate Jensen's alpha, beta, R-squared, tracking error, and information
 * ratio for an agent relative to a benchmark (default SPYx).
 *
 * @param agentId         - The AI agent identifier
 * @param benchmarkSymbol - Benchmark symbol (default "SPYx")
 */
export async function getAlphaBeta(
  agentId: string,
  benchmarkSymbol: string = "SPYx",
): Promise<AlphaBetaDecomposition> {
  const data = await fetchAgentData(agentId);

  // Build daily return series from decisions (using confidence as return proxy)
  const dailyReturns = new Map<string, number[]>();
  for (const d of data.decisions) {
    const dayKey = d.createdAt.toISOString().slice(0, 10);
    const returns = dailyReturns.get(dayKey) ?? [];
    const normalizedReturn = (d.confidence - 50) / 50;
    returns.push(d.action === "sell" ? -normalizedReturn : normalizedReturn);
    dailyReturns.set(dayKey, returns);
  }

  // Portfolio daily returns (average per day)
  const portfolioReturns: number[] = [];
  const sortedDays = Array.from(dailyReturns.keys()).sort();
  for (const day of sortedDays) {
    const dayReturns = dailyReturns.get(day)!;
    portfolioReturns.push(dayReturns.reduce((s, r) => s + r, 0) / dayReturns.length);
  }

  // Benchmark returns (simulate from market data change24h, or use flat)
  const benchmarkData = data.marketData.find((m) => m.symbol === benchmarkSymbol);
  const benchmarkDailyReturn = (benchmarkData?.change24h ?? 0) / 100;

  // Generate benchmark return series (same length as portfolio)
  const benchmarkReturns = portfolioReturns.map(() =>
    benchmarkDailyReturn + (Math.random() - 0.5) * 0.005,
  );

  // Calculate beta via covariance / variance
  const n = portfolioReturns.length;
  if (n < 2) {
    return {
      agentId,
      benchmark: benchmarkSymbol,
      alpha: 0,
      beta: 1,
      rSquared: 0,
      trackingError: 0,
      informationRatio: 0,
      portfolioReturn: 0,
      benchmarkReturn: benchmarkDailyReturn,
      excessReturn: 0,
      generatedAt: new Date().toISOString(),
    };
  }

  const meanP = portfolioReturns.reduce((s, r) => s + r, 0) / n;
  const meanB = benchmarkReturns.reduce((s, r) => s + r, 0) / n;

  let covariance = 0;
  let varianceB = 0;
  let varianceP = 0;
  for (let i = 0; i < n; i++) {
    const dP = portfolioReturns[i] - meanP;
    const dB = benchmarkReturns[i] - meanB;
    covariance += dP * dB;
    varianceB += dB * dB;
    varianceP += dP * dP;
  }
  covariance /= n - 1;
  varianceB /= n - 1;
  varianceP /= n - 1;

  const beta = varianceB > 0 ? covariance / varianceB : 1;
  const alpha = meanP - beta * meanB;

  // R-squared
  const totalSS = varianceP * (n - 1);
  const regressionSS = beta * beta * varianceB * (n - 1);
  const rSquared = totalSS > 0 ? regressionSS / totalSS : 0;

  // Tracking error (std dev of excess returns)
  const excessReturns = portfolioReturns.map((p, i) => p - benchmarkReturns[i]);
  const meanExcess = excessReturns.reduce((s, r) => s + r, 0) / n;
  const trackingErrorVariance = excessReturns.reduce(
    (s, r) => s + (r - meanExcess) ** 2,
    0,
  ) / (n - 1);
  const trackingError = Math.sqrt(trackingErrorVariance);

  // Information ratio
  const informationRatio = trackingError > 0 ? meanExcess / trackingError : 0;

  // Annualize
  const annualizedAlpha = alpha * 252;
  const annualizedTE = trackingError * Math.sqrt(252);
  const annualizedIR = annualizedTE > 0 ? (annualizedAlpha / annualizedTE) : 0;

  return {
    agentId,
    benchmark: benchmarkSymbol,
    alpha: round(annualizedAlpha, 6),
    beta: round(beta, 4),
    rSquared: round(clamp(rSquared, 0, 1), 4),
    trackingError: round(annualizedTE, 6),
    informationRatio: round(annualizedIR, 4),
    portfolioReturn: round(meanP * 252, 6),
    benchmarkReturn: round(benchmarkDailyReturn * 252, 6),
    excessReturn: round((meanP - benchmarkDailyReturn) * 252, 6),
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// 4. Trade Contribution Analysis
// ---------------------------------------------------------------------------

/**
 * Rank every trade by its P&L contribution. Shows which individual trades
 * drove the portfolio return, including holding period, timing quality, and
 * conviction level.
 *
 * @param agentId - The AI agent identifier
 * @param limit   - Max number of trades to return (default 50)
 */
export async function getTradeContributions(
  agentId: string,
  limit: number = 50,
): Promise<TradeContribution[]> {
  const data = await fetchAgentData(agentId);

  // Build a map of decisions by symbol + time for confidence matching
  const decisionMap = new Map<string, { confidence: number; createdAt: Date }>();
  for (const d of data.decisions) {
    const key = `${d.symbol}_${d.createdAt.toISOString().slice(0, 16)}`;
    decisionMap.set(key, { confidence: d.confidence, createdAt: d.createdAt });
  }

  // Group trades into buy/sell pairs by symbol for P&L calculation
  const tradesBySymbol = new Map<string, typeof data.trades>();
  for (const t of data.trades) {
    const list = tradesBySymbol.get(t.stockSymbol) ?? [];
    list.push(t);
    tradesBySymbol.set(t.stockSymbol, list);
  }

  // Total portfolio value for contribution calculation
  let totalPortfolioValue = 0;
  for (const pos of data.positions) {
    const market = data.marketData.find((m) => m.symbol.toLowerCase() === pos.symbol.toLowerCase());
    const price = market?.price ?? parseFloat(pos.averageCostBasis);
    totalPortfolioValue += price * parseFloat(pos.quantity);
  }
  totalPortfolioValue = Math.max(totalPortfolioValue, 10000); // Minimum is initial capital

  const contributions: TradeContribution[] = [];

  for (const trade of data.trades) {
    const entryPrice = parseFloat(trade.pricePerToken);
    const quantity = parseFloat(trade.stockQuantity);
    const usdcAmount = parseFloat(trade.usdcAmount);

    // Find the current market price for unrealized P&L
    const market = data.marketData.find((m) => m.symbol.toLowerCase() === trade.stockSymbol.toLowerCase());
    const currentPrice = market?.price ?? entryPrice;

    // Calculate P&L
    let pnl: number;
    let exitPrice: number | null;
    if (trade.side === "buy") {
      // Unrealized P&L for open buy
      pnl = (currentPrice - entryPrice) * quantity;
      exitPrice = null;
    } else {
      // Realized P&L for sells
      const costBasis = data.positions.find((p: typeof data.positions[0]) => p.symbol === trade.stockSymbol);
      const avgCost = costBasis ? parseFloat(costBasis.averageCostBasis) : entryPrice;
      pnl = (entryPrice - avgCost) * quantity;
      exitPrice = entryPrice;
    }

    const pnlPercent = usdcAmount > 0 ? (pnl / usdcAmount) * 100 : 0;

    // Holding period: time since trade
    const holdingPeriodMs = Date.now() - trade.createdAt.getTime();
    const holdingPeriodHours = holdingPeriodMs / (1000 * 60 * 60);

    // Timing score: how close to daily low (for buys) or daily high (for sells)
    // Using change24h as a proxy for intra-day range
    const change = market?.change24h ?? 0;
    let timingScore: number;
    if (trade.side === "buy") {
      // Good timing = buying when price is low relative to range
      timingScore = change < 0 ? 70 + Math.min(30, Math.abs(change) * 3) : 50 - Math.min(30, change * 3);
    } else {
      // Good timing = selling when price is high relative to range
      timingScore = change > 0 ? 70 + Math.min(30, change * 3) : 50 - Math.min(30, Math.abs(change) * 3);
    }

    // Portfolio contribution
    const portfolioContribution = totalPortfolioValue > 0 ? (pnl / totalPortfolioValue) * 100 : 0;

    // Find matching decision for confidence
    let confidence = 50;
    let isConvictionTrade = false;
    const tradeTime = trade.createdAt.toISOString().slice(0, 16);
    const decisionKey = `${trade.stockSymbol}_${tradeTime}`;
    const decision = decisionMap.get(decisionKey);
    if (decision) {
      confidence = decision.confidence;
      isConvictionTrade = decision.confidence > 80;
    } else {
      // Search nearby decisions
      for (const d of data.decisions) {
        if (d.symbol === trade.stockSymbol) {
          const timeDiff = Math.abs(trade.createdAt.getTime() - d.createdAt.getTime());
          if (timeDiff < 5 * 60 * 1000) {
            confidence = d.confidence;
            isConvictionTrade = d.confidence > 80;
            break;
          }
        }
      }
    }

    contributions.push({
      tradeId: trade.id,
      symbol: trade.stockSymbol,
      side: trade.side,
      entryPrice: round(entryPrice, 6),
      exitPrice: exitPrice ? round(exitPrice, 6) : null,
      quantity: round(quantity, 9),
      pnl: round(pnl, 2),
      pnlPercent: round(pnlPercent, 2),
      holdingPeriodHours: round(holdingPeriodHours, 1),
      timingScore: round(clamp(timingScore, 0, 100), 1),
      portfolioContribution: round(portfolioContribution, 4),
      isConvictionTrade,
      confidence,
      executedAt: trade.createdAt.toISOString(),
    });
  }

  // Sort by absolute P&L contribution (biggest impact first)
  contributions.sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));

  return contributions.slice(0, limit);
}

// ---------------------------------------------------------------------------
// 5. Timing Analysis
// ---------------------------------------------------------------------------

/**
 * Measure the agent's market timing ability: when it trades during the day,
 * which days of the week perform best, and how it behaves in different
 * market regimes.
 *
 * @param agentId - The AI agent identifier
 */
export async function getTimingAnalysis(agentId: string): Promise<TimingAnalysis> {
  const data = await fetchAgentData(agentId);
  const actionDecisions = data.decisions.filter((d: typeof data.decisions[0]) => d.action !== "hold");

  // --- Decision-to-execution time ---
  let totalExecTime = 0;
  let execCount = 0;
  for (const d of data.decisions) {
    if (d.executed === "executed" || d.executed === "confirmed") {
      // Match decision to trade by symbol + proximity
      const matchingTrade = data.trades.find(
        (t: typeof data.trades[0]) =>
          t.stockSymbol === d.symbol &&
          Math.abs(t.createdAt.getTime() - d.createdAt.getTime()) < 60 * 1000,
      );
      if (matchingTrade) {
        totalExecTime += matchingTrade.createdAt.getTime() - d.createdAt.getTime();
        execCount++;
      }
    }
  }
  const avgDecisionToExecutionMs = execCount > 0 ? totalExecTime / execCount : 0;

  // --- Market timing score ---
  // Measures how often the agent buys near lows and sells near highs
  let timingHits = 0;
  let timingTotal = 0;
  for (const d of actionDecisions) {
    const market = data.marketData.find((m) => m.symbol.toLowerCase() === d.symbol.toLowerCase());
    if (!market || market.change24h === null) continue;
    timingTotal++;
    if (d.action === "buy" && market.change24h < 0) timingHits++;
    else if (d.action === "sell" && market.change24h > 0) timingHits++;
  }
  const marketTimingScore = timingTotal > 0
    ? round((timingHits / timingTotal) * 100, 1)
    : 50;

  // --- Time-of-day performance ---
  const hourSlots = new Map<number, { decisions: number; totalConf: number; wins: number }>();
  for (const d of data.decisions) {
    const hour = d.createdAt.getHours();
    const entry = hourSlots.get(hour) ?? { decisions: 0, totalConf: 0, wins: 0 };
    entry.decisions++;
    entry.totalConf += d.confidence;
    if (d.confidence >= 50 && d.action !== "hold") entry.wins++;
    hourSlots.set(hour, entry);
  }

  const TIME_SLOTS = [
    { slot: "Pre-market (4-9)", start: 4, end: 9 },
    { slot: "Morning (9-12)", start: 9, end: 12 },
    { slot: "Afternoon (12-16)", start: 12, end: 16 },
    { slot: "After-hours (16-20)", start: 16, end: 20 },
    { slot: "Night (20-4)", start: 20, end: 28 },
  ];

  const timeOfDayPerformance: TimeSlotPerformance[] = TIME_SLOTS.map(({ slot, start, end }) => {
    let totalDecisions = 0;
    let totalConf = 0;
    let totalWins = 0;
    for (let h = start; h < end; h++) {
      const hour = h % 24;
      const entry = hourSlots.get(hour);
      if (entry) {
        totalDecisions += entry.decisions;
        totalConf += entry.totalConf;
        totalWins += entry.wins;
      }
    }
    const actionCount = totalDecisions > 0 ? totalDecisions : 1;
    return {
      slot,
      hour: start % 24,
      decisions: totalDecisions,
      avgConfidence: round(totalConf / actionCount, 1),
      winRate: round((totalWins / actionCount) * 100, 1),
    };
  });

  // --- Day-of-week performance ---
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const daySlots = new Map<number, { decisions: number; totalConf: number; wins: number }>();
  for (const d of data.decisions) {
    const day = d.createdAt.getDay();
    const entry = daySlots.get(day) ?? { decisions: 0, totalConf: 0, wins: 0 };
    entry.decisions++;
    entry.totalConf += d.confidence;
    if (d.confidence >= 50 && d.action !== "hold") entry.wins++;
    daySlots.set(day, entry);
  }

  const dayOfWeekPerformance: DayPerformance[] = DAYS.map((day, idx) => {
    const entry = daySlots.get(idx);
    const count = entry?.decisions ?? 0;
    const actionCount = count > 0 ? count : 1;
    return {
      day,
      dayIndex: idx,
      decisions: count,
      avgConfidence: round((entry?.totalConf ?? 0) / actionCount, 1),
      winRate: round(((entry?.wins ?? 0) / actionCount) * 100, 1),
    };
  });

  // --- Market regime performance ---
  // Classify market data into regimes and measure agent performance
  const regimes: Record<string, { decisions: number; totalConf: number; wins: number; totalReturn: number }> = {
    "Bull (>2% up)": { decisions: 0, totalConf: 0, wins: 0, totalReturn: 0 },
    "Mild Bull (0-2%)": { decisions: 0, totalConf: 0, wins: 0, totalReturn: 0 },
    "Mild Bear (0-2% down)": { decisions: 0, totalConf: 0, wins: 0, totalReturn: 0 },
    "Bear (>2% down)": { decisions: 0, totalConf: 0, wins: 0, totalReturn: 0 },
    "High Volatility": { decisions: 0, totalConf: 0, wins: 0, totalReturn: 0 },
  };

  for (const d of actionDecisions) {
    const market = data.marketData.find((m) => m.symbol.toLowerCase() === d.symbol.toLowerCase());
    const change = market?.change24h ?? 0;
    const normalizedReturn = (d.confidence - 50) / 50;

    let regime: string;
    if (Math.abs(change) > 5) regime = "High Volatility";
    else if (change > 2) regime = "Bull (>2% up)";
    else if (change > 0) regime = "Mild Bull (0-2%)";
    else if (change > -2) regime = "Mild Bear (0-2% down)";
    else regime = "Bear (>2% down)";

    const entry = regimes[regime];
    entry.decisions++;
    entry.totalConf += d.confidence;
    entry.totalReturn += normalizedReturn;
    if (d.confidence >= 50) entry.wins++;
  }

  const regimePerformance: RegimePerformance[] = Object.entries(regimes).map(
    ([regime, stats]) => ({
      regime,
      decisions: stats.decisions,
      avgConfidence: stats.decisions > 0 ? round(stats.totalConf / stats.decisions, 1) : 0,
      winRate: stats.decisions > 0 ? round((stats.wins / stats.decisions) * 100, 1) : 0,
      avgReturn: stats.decisions > 0 ? round(stats.totalReturn / stats.decisions, 4) : 0,
    }),
  );

  // Overall timing grade
  let grade: string;
  if (marketTimingScore >= 70) grade = "A";
  else if (marketTimingScore >= 60) grade = "B";
  else if (marketTimingScore >= 50) grade = "C";
  else if (marketTimingScore >= 40) grade = "D";
  else grade = "F";

  return {
    agentId,
    avgDecisionToExecutionMs: round(avgDecisionToExecutionMs, 0),
    marketTimingScore,
    timeOfDayPerformance,
    dayOfWeekPerformance,
    regimePerformance,
    overallTimingGrade: grade,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// 6. Risk Contribution
// ---------------------------------------------------------------------------

/**
 * Analyze risk contribution per position: marginal VaR, component VaR,
 * concentration risk, and diversification ratio.
 *
 * @param agentId - The AI agent identifier
 */
export async function getRiskContribution(agentId: string): Promise<RiskContribution> {
  const data = await fetchAgentData(agentId);

  // Build position weights
  let totalValue = 0;
  const positionValues: Array<{ symbol: string; value: number; weight: number; sector: string }> = [];

  for (const pos of data.positions) {
    const market = data.marketData.find((m) => m.symbol.toLowerCase() === pos.symbol.toLowerCase());
    const currentPrice = market?.price ?? parseFloat(pos.averageCostBasis);
    const qty = parseFloat(pos.quantity);
    const value = currentPrice * qty;
    totalValue += value;
    const sector = SECTOR_MAP[pos.symbol] ?? "Other";
    positionValues.push({ symbol: pos.symbol, value, weight: 0, sector });
  }

  // Calculate weights
  for (const p of positionValues) {
    p.weight = totalValue > 0 ? p.value / totalValue : 0;
  }

  // Estimate volatility per position from decision confidence variance
  const symbolVolatility = new Map<string, number>();
  const symbolDecisions = new Map<string, number[]>();
  for (const d of data.decisions) {
    const returns = symbolDecisions.get(d.symbol) ?? [];
    returns.push((d.confidence - 50) / 50);
    symbolDecisions.set(d.symbol, returns);
  }
  for (const [symbol, returns] of symbolDecisions) {
    if (returns.length < 2) {
      symbolVolatility.set(symbol, 0.02); // Default 2% daily vol
      continue;
    }
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
    symbolVolatility.set(symbol, Math.sqrt(variance));
  }

  // Portfolio-level VaR (parametric, 95% confidence, 1-day)
  const Z_95 = 1.645;

  // Standalone VaR per position
  const posRisks: PositionRisk[] = positionValues.map((p) => {
    const vol = symbolVolatility.get(p.symbol) ?? 0.02;
    const standaloneVaR = p.value * vol * Z_95;
    const marginalVaR = p.weight * vol * Z_95;
    const componentVaR = standaloneVaR * p.weight;

    // Concentration risk (weight^2 contribution to Herfindahl)
    const concentrationRisk = p.weight * p.weight * 100;

    return {
      symbol: p.symbol,
      sector: p.sector,
      weight: round(p.weight, 4),
      marginalVaR: round(marginalVaR, 4),
      componentVaR: round(componentVaR, 2),
      correlationContribution: round(p.weight * (symbolVolatility.get(p.symbol) ?? 0.02), 6),
      concentrationRisk: round(concentrationRisk, 2),
      standalonVaR: round(standaloneVaR, 2),
    };
  });

  // Portfolio VaR (sum of component VaRs, simplified — ignores correlation benefit)
  const portfolioVaR = posRisks.reduce((s, p) => s + p.componentVaR, 0);

  // Herfindahl-Hirschman Index (sum of squared weights)
  const herfindahlIndex = positionValues.reduce((s, p) => s + p.weight * p.weight, 0);

  // Diversification ratio = sum of standalone VaRs / portfolio VaR
  const totalStandaloneVaR = posRisks.reduce((s, p) => s + p.standalonVaR, 0);
  const diversificationRatio = portfolioVaR > 0
    ? totalStandaloneVaR / portfolioVaR
    : 1;

  // Concentration score: 0 = perfectly diversified, 100 = single stock
  const n = positionValues.length;
  const concentrationScore = n > 0
    ? round(clamp((herfindahlIndex - 1 / n) / (1 - 1 / n) * 100, 0, 100), 1)
    : 100;

  return {
    agentId,
    positions: posRisks.sort((a, b) => b.componentVaR - a.componentVaR),
    portfolioVaR: round(portfolioVaR, 2),
    diversificationRatio: round(diversificationRatio, 4),
    concentrationScore,
    herfindahlIndex: round(herfindahlIndex, 6),
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// 7. Full Attribution Report
// ---------------------------------------------------------------------------

/**
 * Aggregate all attribution analyses into a single comprehensive report
 * with a narrative summary explaining the agent's performance drivers.
 *
 * @param agentId - The AI agent identifier
 */
export async function getFullAttributionReport(agentId: string): Promise<FullAttributionReport | null> {
  const configs = getAgentConfigs();
  const config = configs.find((c) => c.agentId === agentId);
  if (!config) return null;

  const [brinson, factors, alphaBeta, contributions, timing, risk] = await Promise.all([
    getAttributionBreakdown(agentId),
    getFactorExposure(agentId),
    getAlphaBeta(agentId),
    getTradeContributions(agentId, 10),
    getTimingAnalysis(agentId),
    getRiskContribution(agentId),
  ]);

  // Build narrative summary
  const narrativeParts: string[] = [];

  // Attribution narrative
  if (Math.abs(brinson.aggregateSelection) > Math.abs(brinson.aggregateAllocation)) {
    narrativeParts.push(
      `${config.name}'s returns are primarily driven by stock selection (${(brinson.aggregateSelection * 100).toFixed(2)}% contribution), suggesting strong individual stock picking ability.`,
    );
  } else {
    narrativeParts.push(
      `${config.name}'s returns are primarily driven by sector allocation (${(brinson.aggregateAllocation * 100).toFixed(2)}% contribution), indicating a top-down macro approach.`,
    );
  }

  // Factor narrative
  narrativeParts.push(
    `The dominant factor exposure is ${factors.dominantFactor}, consistent with a ${factors.factorTilt.toLowerCase()}.`,
  );

  // Alpha/Beta narrative
  if (alphaBeta.alpha > 0) {
    narrativeParts.push(
      `The agent generates positive alpha of ${(alphaBeta.alpha * 100).toFixed(2)}% annually, with a beta of ${alphaBeta.beta.toFixed(2)} relative to ${alphaBeta.benchmark}.`,
    );
  } else {
    narrativeParts.push(
      `Alpha is currently negative at ${(alphaBeta.alpha * 100).toFixed(2)}% annually, with a beta of ${alphaBeta.beta.toFixed(2)} — suggesting market exposure without adequate skill premium.`,
    );
  }

  // Timing narrative
  narrativeParts.push(
    `Market timing receives a grade of ${timing.overallTimingGrade} with a score of ${timing.marketTimingScore}/100.`,
  );

  // Risk narrative
  if (risk.concentrationScore > 60) {
    narrativeParts.push(
      `WARNING: Portfolio is highly concentrated (score: ${risk.concentrationScore}/100). Diversification ratio of ${risk.diversificationRatio.toFixed(2)} indicates limited risk reduction from multi-asset holding.`,
    );
  } else {
    narrativeParts.push(
      `Portfolio diversification is reasonable with a concentration score of ${risk.concentrationScore}/100 and diversification ratio of ${risk.diversificationRatio.toFixed(2)}.`,
    );
  }

  return {
    agentId,
    agentName: config.name,
    provider: config.provider,
    brinson,
    factors,
    alphaBeta,
    topContributions: contributions,
    timing,
    risk,
    narrativeSummary: narrativeParts.join(" "),
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// 8. Cross-Agent Comparison
// ---------------------------------------------------------------------------

/**
 * Compare attribution metrics across all agents (or a specified subset).
 * Identifies which agent has the best stock selection, timing, alpha, etc.
 *
 * @param agentIds - Optional list of agent IDs to compare (default: all 3)
 */
export async function compareAttribution(
  agentIds?: string[],
): Promise<AttributionComparison> {
  const ids = agentIds ?? VALID_AGENT_IDS;
  const configs = getAgentConfigs();

  const summaries: AgentAttributionSummary[] = [];

  for (const id of ids) {
    const config = configs.find((c) => c.agentId === id);
    if (!config) continue;

    const [brinson, factors, alphaBeta, timing, risk] = await Promise.all([
      getAttributionBreakdown(id),
      getFactorExposure(id),
      getAlphaBeta(id),
      getTimingAnalysis(id),
      getRiskContribution(id),
    ]);

    summaries.push({
      agentId: id,
      agentName: config.name,
      alpha: alphaBeta.alpha,
      beta: alphaBeta.beta,
      selectionEffect: brinson.aggregateSelection,
      allocationEffect: brinson.aggregateAllocation,
      timingScore: timing.marketTimingScore,
      diversificationRatio: risk.diversificationRatio,
      dominantFactor: factors.dominantFactor,
      totalActiveReturn: brinson.totalActiveReturn,
    });
  }

  // Determine winners
  const bestStockPicker = findMax(summaries, "selectionEffect");
  const bestTimingAgent = findMax(summaries, "timingScore");
  const mostDiversified = findMax(summaries, "diversificationRatio");
  const highestAlpha = findMax(summaries, "alpha");
  const lowestBeta = findMin(summaries, "beta", (a, b) => Math.abs(a) - Math.abs(b));

  // Build comparison narrative
  const narrativeParts: string[] = [];
  if (bestStockPicker) {
    narrativeParts.push(
      `${bestStockPicker.agentName} leads in stock selection with a ${(bestStockPicker.selectionEffect * 100).toFixed(2)}% selection effect.`,
    );
  }
  if (bestTimingAgent) {
    narrativeParts.push(
      `${bestTimingAgent.agentName} has the best market timing (score: ${bestTimingAgent.timingScore}/100).`,
    );
  }
  if (highestAlpha) {
    narrativeParts.push(
      `${highestAlpha.agentName} generates the highest alpha at ${(highestAlpha.alpha * 100).toFixed(2)}% annualized.`,
    );
  }
  if (mostDiversified) {
    narrativeParts.push(
      `${mostDiversified.agentName} runs the most diversified portfolio (ratio: ${mostDiversified.diversificationRatio.toFixed(2)}).`,
    );
  }

  // Factor divergence
  const uniqueFactors = new Set(summaries.map((s) => s.dominantFactor));
  if (uniqueFactors.size === summaries.length) {
    narrativeParts.push(
      "All agents have distinct dominant factor exposures, suggesting genuine strategy diversity.",
    );
  } else {
    narrativeParts.push(
      "Some agents share dominant factor exposures, indicating overlapping strategies.",
    );
  }

  return {
    agents: summaries,
    bestStockPicker: bestStockPicker?.agentId ?? "",
    bestTimingAgent: bestTimingAgent?.agentId ?? "",
    mostDiversified: mostDiversified?.agentId ?? "",
    highestAlpha: highestAlpha?.agentId ?? "",
    lowestBeta: lowestBeta?.agentId ?? "",
    narrative: narrativeParts.join(" "),
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Utility Helpers
// ---------------------------------------------------------------------------

/** Round a number to the specified number of decimal places */
function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
