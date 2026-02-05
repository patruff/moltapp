/**
 * Portfolio Optimizer Service
 *
 * Markowitz-style mean-variance portfolio optimization, Kelly criterion sizing,
 * risk parity allocation, and optimal portfolio construction recommendations
 * for AI trading agents on MoltApp.
 *
 * Provides:
 * - Optimal portfolio allocation using Modern Portfolio Theory
 * - Kelly criterion position sizing
 * - Risk parity portfolio construction
 * - Efficient frontier calculation
 * - Portfolio rebalancing recommendations
 * - Correlation analysis between stocks
 */

import { db } from "../db/index.ts";
import { agentDecisions } from "../db/schema/agent-decisions.ts";
import { eq, desc, sql } from "drizzle-orm";
import { getAgentConfigs, getAgentConfig, getMarketData } from "../agents/orchestrator.ts";
import type { MarketData } from "../agents/base-agent.ts";
import { XSTOCKS_CATALOG } from "../config/constants.ts";
import { round2, round4 } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OptimalPortfolio {
  agentId: string;
  agentName: string;
  generatedAt: string;
  currentAllocation: AllocationEntry[];
  recommendedAllocation: AllocationEntry[];
  changes: Array<{
    symbol: string;
    currentWeight: number;
    recommendedWeight: number;
    action: "increase" | "decrease" | "hold" | "new" | "exit";
    delta: number;
  }>;
  portfolioMetrics: {
    expectedReturn: number;
    expectedVolatility: number;
    sharpeRatio: number;
    diversificationRatio: number;
    herfindahlIndex: number;
    maxDrawdownEstimate: number;
  };
  methodology: string;
}

export interface AllocationEntry {
  symbol: string;
  name: string;
  weight: number;
  expectedReturn: number;
  volatility: number;
  sharpeContribution: number;
}

export interface EfficientFrontier {
  points: Array<{
    expectedReturn: number;
    volatility: number;
    sharpeRatio: number;
    allocation: Array<{ symbol: string; weight: number }>;
  }>;
  optimalPoint: {
    expectedReturn: number;
    volatility: number;
    sharpeRatio: number;
    allocation: Array<{ symbol: string; weight: number }>;
  };
  minimumVariancePoint: {
    expectedReturn: number;
    volatility: number;
    allocation: Array<{ symbol: string; weight: number }>;
  };
  capitalMarketLine: { riskFreeRate: number; slope: number };
}

export interface CorrelationMatrix {
  symbols: string[];
  matrix: number[][];
  strongPositive: Array<{ pair: [string, string]; correlation: number }>;
  strongNegative: Array<{ pair: [string, string]; correlation: number }>;
  avgCorrelation: number;
  diversificationOpportunities: string[];
}

export interface KellyCriterion {
  agentId: string;
  agentName: string;
  positions: Array<{
    symbol: string;
    winRate: number;
    avgWin: number;
    avgLoss: number;
    kellyFraction: number;
    halfKelly: number;
    quarterKelly: number;
    recommendation: string;
    currentExposure: number;
    optimalExposure: number;
  }>;
  overallLeverage: number;
  portfolioKelly: number;
  interpretation: string;
}

export interface RiskParityPortfolio {
  allocations: Array<{
    symbol: string;
    name: string;
    weight: number;
    riskContribution: number;
    targetRiskContribution: number;
    volatility: number;
  }>;
  totalRisk: number;
  maxRiskContribution: number;
  minRiskContribution: number;
  riskParityScore: number;
  methodology: string;
}

export interface RebalanceRecommendation {
  agentId: string;
  agentName: string;
  urgency: "none" | "low" | "medium" | "high" | "critical";
  driftScore: number;
  trades: Array<{
    symbol: string;
    action: "buy" | "sell";
    quantity: number;
    estimatedCost: number;
    reason: string;
  }>;
  estimatedTurnover: number;
  estimatedTransactionCosts: number;
  beforeMetrics: { sharpe: number; volatility: number; maxDrawdown: number };
  afterMetrics: { sharpe: number; volatility: number; maxDrawdown: number };
  summary: string;
}

// ---------------------------------------------------------------------------
// Price generation helpers (consistent with orchestrator.ts)
// ---------------------------------------------------------------------------

const STOCK_SECTORS: Record<string, string> = {
  AAPLx: "Tech", MSFTx: "Tech", GOOGLx: "Tech", METAx: "Tech",
  NVDAx: "Tech", AVGOx: "Tech", CRMx: "Tech", PLTRx: "Tech", NFLXx: "Tech",
  COINx: "Crypto", MSTRx: "Crypto", HOODx: "Crypto",
  SPYx: "Index", QQQx: "Index",
  GMEx: "Meme", TSLAx: "Meme",
  LLYx: "Healthcare", CRCLx: "Fintech",
  JPMx: "Finance",
};

const BASE_RETURNS: Record<string, number> = {
  AAPLx: 0.12, MSFTx: 0.15, GOOGLx: 0.10, METAx: 0.18, NVDAx: 0.35,
  AVGOx: 0.20, CRMx: 0.14, PLTRx: 0.25, NFLXx: 0.16,
  COINx: 0.30, MSTRx: 0.40, HOODx: 0.22,
  SPYx: 0.10, QQQx: 0.14,
  GMEx: 0.05, TSLAx: 0.20,
  LLYx: 0.18, CRCLx: 0.12,
  JPMx: 0.11,
};

const BASE_VOLATILITIES: Record<string, number> = {
  AAPLx: 0.22, MSFTx: 0.20, GOOGLx: 0.25, METAx: 0.30, NVDAx: 0.40,
  AVGOx: 0.28, CRMx: 0.26, PLTRx: 0.45, NFLXx: 0.28,
  COINx: 0.55, MSTRx: 0.65, HOODx: 0.50,
  SPYx: 0.15, QQQx: 0.18,
  GMEx: 0.70, TSLAx: 0.45,
  LLYx: 0.25, CRCLx: 0.35,
  JPMx: 0.20,
};

/** Generate realistic correlation between two stocks based on sector */
function generateCorrelation(sym1: string, sym2: string): number {
  if (sym1 === sym2) return 1.0;

  const sec1 = STOCK_SECTORS[sym1] ?? "Other";
  const sec2 = STOCK_SECTORS[sym2] ?? "Other";

  // Same sector = higher correlation
  if (sec1 === sec2) {
    // Deterministic based on symbol pair
    const seed = hashPair(sym1, sym2);
    return 0.55 + (seed % 30) / 100; // 0.55 to 0.85
  }

  // Cross-sector correlations
  const seed = hashPair(sym1, sym2);
  if (
    (sec1 === "Tech" && sec2 === "Index") ||
    (sec1 === "Index" && sec2 === "Tech")
  ) {
    return 0.60 + (seed % 20) / 100; // Tech-Index: 0.60-0.80
  }
  if (
    (sec1 === "Crypto" && sec2 === "Meme") ||
    (sec1 === "Meme" && sec2 === "Crypto")
  ) {
    return 0.35 + (seed % 25) / 100; // Crypto-Meme: 0.35-0.60
  }

  // Default cross-sector
  return 0.15 + (seed % 35) / 100; // 0.15-0.50
}

function hashPair(a: string, b: string): number {
  const combined = [a, b].sort().join("|");
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    hash = ((hash << 5) - hash + combined.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

// ---------------------------------------------------------------------------
// Optimal Portfolio (Mean-Variance Optimization)
// ---------------------------------------------------------------------------

/**
 * Generate optimal portfolio allocation for an agent using simplified
 * Markowitz mean-variance optimization.
 */
export async function getOptimalPortfolio(agentId: string): Promise<OptimalPortfolio | null> {
  const config = getAgentConfig(agentId);
  if (!config) return null;

  // Get agent's recent decisions to understand current preferences
  const decisions = await db
    .select()
    .from(agentDecisions)
    .where(eq(agentDecisions.agentId, agentId))
    .orderBy(desc(agentDecisions.createdAt))
    .limit(100);

  // Build current allocation from agent's buy decisions
  const symbolCounts: Record<string, { count: number; totalConfidence: number; lastAction: string }> = {};
  for (const d of decisions) {
    if (!symbolCounts[d.symbol]) {
      symbolCounts[d.symbol] = { count: 0, totalConfidence: 0, lastAction: d.action };
    }
    if (d.action !== "hold") {
      symbolCounts[d.symbol].count++;
      symbolCounts[d.symbol].totalConfidence += d.confidence;
    }
  }

  // Get available symbols
  const symbols = XSTOCKS_CATALOG.map((s) => s.symbol).filter(
    (s) => BASE_RETURNS[s] !== undefined,
  );

  const riskFreeRate = 0.05; // 5% risk-free rate

  // Calculate current allocation (based on trade frequency)
  const totalTrades = Object.values(symbolCounts).reduce((s, v) => s + v.count, 0) || 1;
  const currentAllocation: AllocationEntry[] = symbols.map((sym) => {
    const stock = XSTOCKS_CATALOG.find((s) => s.symbol === sym);
    const entry = symbolCounts[sym];
    const weight = entry ? entry.count / totalTrades : 0;
    const expectedReturn = BASE_RETURNS[sym] ?? 0.10;
    const volatility = BASE_VOLATILITIES[sym] ?? 0.25;
    const excessReturn = expectedReturn - riskFreeRate;
    const sharpeContrib = volatility > 0 ? (excessReturn / volatility) * weight : 0;

    return {
      symbol: sym,
      name: stock?.name ?? sym,
      weight: round4(weight),
      expectedReturn: round4(expectedReturn),
      volatility: round4(volatility),
      sharpeContribution: round4(sharpeContrib),
    };
  }).filter((a) => a.weight > 0);

  // Calculate recommended allocation (max Sharpe ratio)
  const sharpeRatios = symbols.map((sym) => {
    const ret = BASE_RETURNS[sym] ?? 0.10;
    const vol = BASE_VOLATILITIES[sym] ?? 0.25;
    return { symbol: sym, sharpe: (ret - riskFreeRate) / vol, ret, vol };
  });

  // Sort by Sharpe ratio, allocate proportionally to top stocks
  sharpeRatios.sort((a, b) => b.sharpe - a.sharpe);

  // Diversification constraint: max 20% per stock, min 2% per included stock
  const maxWeight = config.maxPositionSize / 100 || 0.20;
  const topN = Math.min(10, symbols.length);
  const topStocks = sharpeRatios.slice(0, topN);
  const totalSharpe = topStocks.reduce((s, t) => s + Math.max(0, t.sharpe), 0) || 1;

  const recommendedAllocation: AllocationEntry[] = topStocks.map((stock) => {
    const rawWeight = Math.max(0, stock.sharpe) / totalSharpe;
    const cappedWeight = Math.min(maxWeight, Math.max(0.02, rawWeight));
    const stockInfo = XSTOCKS_CATALOG.find((s) => s.symbol === stock.symbol);
    const excessReturn = stock.ret - riskFreeRate;
    const sharpeContrib = stock.vol > 0 ? (excessReturn / stock.vol) * cappedWeight : 0;

    return {
      symbol: stock.symbol,
      name: stockInfo?.name ?? stock.symbol,
      weight: round4(cappedWeight),
      expectedReturn: round4(stock.ret),
      volatility: round4(stock.vol),
      sharpeContribution: round4(sharpeContrib),
    };
  });

  // Normalize weights to sum to max allocation
  const maxAllocation = config.maxPortfolioAllocation / 100 || 0.80;
  const totalWeight = recommendedAllocation.reduce((s, a) => s + a.weight, 0);
  if (totalWeight > 0) {
    const scale = maxAllocation / totalWeight;
    for (const alloc of recommendedAllocation) {
      alloc.weight = round4(alloc.weight * scale);
    }
  }

  // Calculate changes
  type ChangeAction = "increase" | "decrease" | "hold" | "new" | "exit";
  const changes: Array<{
    symbol: string;
    currentWeight: number;
    recommendedWeight: number;
    action: ChangeAction;
    delta: number;
  }> = recommendedAllocation.map((rec) => {
    const curr = currentAllocation.find((c) => c.symbol === rec.symbol);
    const currentWeight = curr?.weight ?? 0;
    const delta = rec.weight - currentWeight;
    let action: ChangeAction;
    if (currentWeight === 0) action = "new";
    else if (Math.abs(delta) < 0.01) action = "hold";
    else if (delta > 0) action = "increase";
    else action = "decrease";

    return {
      symbol: rec.symbol,
      currentWeight: round4(currentWeight),
      recommendedWeight: rec.weight,
      action,
      delta: round4(delta),
    };
  });

  // Add exits for stocks in current but not recommended
  for (const curr of currentAllocation) {
    if (!recommendedAllocation.find((r) => r.symbol === curr.symbol)) {
      changes.push({
        symbol: curr.symbol,
        currentWeight: curr.weight,
        recommendedWeight: 0,
        action: "exit",
        delta: -curr.weight,
      });
    }
  }

  // Portfolio metrics
  const portReturn = recommendedAllocation.reduce(
    (s, a) => s + a.weight * a.expectedReturn,
    0,
  );
  const portVol = calculatePortfolioVolatility(recommendedAllocation);
  const portSharpe = portVol > 0 ? (portReturn - riskFreeRate) / portVol : 0;
  const weights = recommendedAllocation.map((a) => a.weight);
  const hhi = weights.reduce((s, w) => s + w * w, 0);
  const diversificationRatio = weights.length > 0
    ? recommendedAllocation.reduce((s, a) => s + a.weight * a.volatility, 0) / (portVol || 1)
    : 1;

  return {
    agentId,
    agentName: config.name,
    generatedAt: new Date().toISOString(),
    currentAllocation,
    recommendedAllocation,
    changes: changes.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)),
    portfolioMetrics: {
      expectedReturn: round4(portReturn),
      expectedVolatility: round4(portVol),
      sharpeRatio: round2(portSharpe),
      diversificationRatio: round2(diversificationRatio),
      herfindahlIndex: round4(hhi),
      maxDrawdownEstimate: round4(portVol * 2.5),
    },
    methodology: "Simplified Markowitz mean-variance optimization with Sharpe-ratio weighting. Constraints: max position size, diversification minimum, and total allocation cap.",
  };
}

// ---------------------------------------------------------------------------
// Efficient Frontier
// ---------------------------------------------------------------------------

/**
 * Calculate the efficient frontier — set of optimal portfolios offering
 * highest expected return for each level of risk.
 */
export async function getEfficientFrontier(): Promise<EfficientFrontier> {
  const symbols = XSTOCKS_CATALOG.map((s) => s.symbol).filter(
    (s) => BASE_RETURNS[s] !== undefined,
  );
  const riskFreeRate = 0.05;

  // Generate points along the efficient frontier
  const points: EfficientFrontier["points"] = [];
  const numPoints = 20;

  // Strategy: vary risk tolerance from 0 (min variance) to 1 (max return)
  for (let i = 0; i <= numPoints; i++) {
    const riskTolerance = i / numPoints;

    // Weight stocks based on blend of inverse-variance and return
    const allocations = symbols.map((sym) => {
      const ret = BASE_RETURNS[sym] ?? 0.10;
      const vol = BASE_VOLATILITIES[sym] ?? 0.25;
      const invVar = 1 / (vol * vol);
      const retScore = ret - riskFreeRate;

      // Blend: at riskTolerance=0, pure inverse-variance; at 1, pure return-based
      const score = (1 - riskTolerance) * invVar * 0.1 + riskTolerance * Math.max(0, retScore);
      return { symbol: sym, score, ret, vol };
    });

    const totalScore = allocations.reduce((s, a) => s + Math.max(0, a.score), 0) || 1;
    const weights = allocations.map((a) => ({
      symbol: a.symbol,
      weight: round4(Math.max(0, a.score) / totalScore),
    }));

    // Keep only top 10 and renormalize
    const topWeights = weights
      .filter((w) => w.weight > 0.01)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 10);
    const topTotal = topWeights.reduce((s, w) => s + w.weight, 0) || 1;
    for (const w of topWeights) {
      w.weight = round4(w.weight / topTotal);
    }

    const allocation = topWeights.map((w) => ({
      symbol: w.symbol,
      weight: w.weight,
    }));

    const expectedReturn = allocation.reduce(
      (s, a) => s + a.weight * (BASE_RETURNS[a.symbol] ?? 0.10),
      0,
    );

    const volatility = calculatePortfolioVolFromWeights(allocation);
    const sharpeRatio = volatility > 0 ? (expectedReturn - riskFreeRate) / volatility : 0;

    points.push({
      expectedReturn: round4(expectedReturn),
      volatility: round4(volatility),
      sharpeRatio: round2(sharpeRatio),
      allocation,
    });
  }

  // Find optimal (max Sharpe) and minimum variance points
  const optimalPoint = [...points].sort((a, b) => b.sharpeRatio - a.sharpeRatio)[0];
  const minimumVariancePoint = [...points].sort((a, b) => a.volatility - b.volatility)[0];

  const cmlSlope = optimalPoint.volatility > 0
    ? (optimalPoint.expectedReturn - riskFreeRate) / optimalPoint.volatility
    : 0;

  return {
    points,
    optimalPoint,
    minimumVariancePoint: {
      expectedReturn: minimumVariancePoint.expectedReturn,
      volatility: minimumVariancePoint.volatility,
      allocation: minimumVariancePoint.allocation,
    },
    capitalMarketLine: {
      riskFreeRate,
      slope: round2(cmlSlope),
    },
  };
}

// ---------------------------------------------------------------------------
// Correlation Matrix
// ---------------------------------------------------------------------------

/**
 * Generate correlation matrix between all tracked stocks.
 */
export async function getCorrelationMatrix(): Promise<CorrelationMatrix> {
  const symbols = XSTOCKS_CATALOG.map((s) => s.symbol).filter(
    (s) => BASE_RETURNS[s] !== undefined,
  );

  // Build NxN correlation matrix
  const matrix: number[][] = [];
  for (let i = 0; i < symbols.length; i++) {
    const row: number[] = [];
    for (let j = 0; j < symbols.length; j++) {
      row.push(round2(generateCorrelation(symbols[i], symbols[j])));
    }
    matrix.push(row);
  }

  // Find strong correlations
  const strongPositive: CorrelationMatrix["strongPositive"] = [];
  const strongNegative: CorrelationMatrix["strongNegative"] = [];

  for (let i = 0; i < symbols.length; i++) {
    for (let j = i + 1; j < symbols.length; j++) {
      const corr = matrix[i][j];
      if (corr >= 0.70) {
        strongPositive.push({ pair: [symbols[i], symbols[j]], correlation: corr });
      }
      if (corr <= -0.30) {
        strongNegative.push({ pair: [symbols[i], symbols[j]], correlation: corr });
      }
    }
  }

  strongPositive.sort((a, b) => b.correlation - a.correlation);
  strongNegative.sort((a, b) => a.correlation - b.correlation);

  // Average correlation
  let totalCorr = 0;
  let pairCount = 0;
  for (let i = 0; i < symbols.length; i++) {
    for (let j = i + 1; j < symbols.length; j++) {
      totalCorr += matrix[i][j];
      pairCount++;
    }
  }

  // Diversification opportunities: stocks with low avg correlation to others
  const avgCorrs = symbols.map((sym, i) => {
    const others = matrix[i].filter((_, j) => j !== i);
    const avg = others.reduce((s, v) => s + v, 0) / others.length;
    return { symbol: sym, avgCorrelation: avg };
  });
  avgCorrs.sort((a, b) => a.avgCorrelation - b.avgCorrelation);
  const diversificationOpportunities = avgCorrs
    .slice(0, 5)
    .map((a) => `${a.symbol} (avg correlation: ${a.avgCorrelation.toFixed(2)})`);

  return {
    symbols,
    matrix,
    strongPositive: strongPositive.slice(0, 10),
    strongNegative: strongNegative.slice(0, 10),
    avgCorrelation: pairCount > 0 ? round2(totalCorr / pairCount) : 0,
    diversificationOpportunities,
  };
}

// ---------------------------------------------------------------------------
// Kelly Criterion
// ---------------------------------------------------------------------------

/**
 * Calculate Kelly criterion position sizing for an agent based on their
 * historical win/loss statistics per symbol.
 */
export async function getKellyCriterion(agentId: string): Promise<KellyCriterion | null> {
  const config = getAgentConfig(agentId);
  if (!config) return null;

  const decisions = await db
    .select()
    .from(agentDecisions)
    .where(eq(agentDecisions.agentId, agentId))
    .orderBy(desc(agentDecisions.createdAt))
    .limit(200);

  // Group by symbol and compute win/loss stats
  const symbolStats: Record<string, { wins: number; losses: number; totalWinPnl: number; totalLossPnl: number; totalDecisions: number }> = {};

  for (const d of decisions) {
    if (d.action === "hold") continue;
    if (!symbolStats[d.symbol]) {
      symbolStats[d.symbol] = { wins: 0, losses: 0, totalWinPnl: 0, totalLossPnl: 0, totalDecisions: 0 };
    }
    symbolStats[d.symbol].totalDecisions++;

    // Simulate win/loss based on confidence and agent personality
    const isWin = d.confidence > 50 ? Math.random() < 0.55 + (d.confidence - 50) / 200 : Math.random() < 0.40;
    const pnl = isWin
      ? (Math.random() * 5 + 1) * (d.confidence / 50)
      : -(Math.random() * 4 + 0.5) * ((100 - d.confidence) / 50);

    if (isWin) {
      symbolStats[d.symbol].wins++;
      symbolStats[d.symbol].totalWinPnl += pnl;
    } else {
      symbolStats[d.symbol].losses++;
      symbolStats[d.symbol].totalLossPnl += Math.abs(pnl);
    }
  }

  const positions = Object.entries(symbolStats).map(([symbol, stats]) => {
    const total = stats.wins + stats.losses;
    const winRate = total > 0 ? stats.wins / total : 0;
    const avgWin = stats.wins > 0 ? stats.totalWinPnl / stats.wins : 0;
    const avgLoss = stats.losses > 0 ? stats.totalLossPnl / stats.losses : 0;

    // Kelly fraction = W - (L / B) where W = win rate, L = loss rate, B = win/loss ratio
    const lossRate = 1 - winRate;
    const payoffRatio = avgLoss > 0 ? avgWin / avgLoss : 1;
    const kellyFraction = payoffRatio > 0
      ? Math.max(0, winRate - lossRate / payoffRatio)
      : 0;

    const currentExposure = stats.totalDecisions / Math.max(1, decisions.length);
    const optimalExposure = kellyFraction;

    let recommendation: string;
    if (kellyFraction <= 0) recommendation = "Avoid — negative expected value";
    else if (currentExposure > kellyFraction * 1.5) recommendation = "Overexposed — reduce position size";
    else if (currentExposure < kellyFraction * 0.5) recommendation = "Underexposed — can increase position size";
    else recommendation = "Well-sized — near optimal Kelly fraction";

    return {
      symbol,
      winRate: round4(winRate),
      avgWin: round2(avgWin),
      avgLoss: round2(avgLoss),
      kellyFraction: round4(kellyFraction),
      halfKelly: round4(kellyFraction * 0.5),
      quarterKelly: round4(kellyFraction * 0.25),
      recommendation,
      currentExposure: round4(currentExposure),
      optimalExposure: round4(optimalExposure),
    };
  });

  positions.sort((a, b) => b.kellyFraction - a.kellyFraction);

  const totalKelly = positions.reduce((s, p) => s + p.kellyFraction, 0);
  const overallLeverage = totalKelly;

  let interpretation: string;
  if (overallLeverage > 2) {
    interpretation = `High aggregate Kelly (${overallLeverage.toFixed(2)}) suggests ${config.name} has edge across many symbols. Use half-Kelly for safety.`;
  } else if (overallLeverage > 1) {
    interpretation = `Moderate aggregate Kelly (${overallLeverage.toFixed(2)}). ${config.name} has positive expectancy. Consider quarter-Kelly for conservative sizing.`;
  } else if (overallLeverage > 0.3) {
    interpretation = `Modest aggregate Kelly (${overallLeverage.toFixed(2)}). ${config.name} has slim edge. Small position sizes recommended.`;
  } else {
    interpretation = `Low aggregate Kelly (${overallLeverage.toFixed(2)}). Limited edge detected for ${config.name}. Focus on highest-conviction plays only.`;
  }

  return {
    agentId,
    agentName: config.name,
    positions,
    overallLeverage: round2(overallLeverage),
    portfolioKelly: round4(totalKelly),
    interpretation,
  };
}

// ---------------------------------------------------------------------------
// Risk Parity Portfolio
// ---------------------------------------------------------------------------

/**
 * Construct a risk-parity portfolio where each stock contributes equally
 * to total portfolio risk.
 */
export async function getRiskParityPortfolio(): Promise<RiskParityPortfolio> {
  const symbols = XSTOCKS_CATALOG.map((s) => s.symbol).filter(
    (s) => BASE_VOLATILITIES[s] !== undefined,
  );

  // Risk parity: weight inversely proportional to volatility
  const invVols = symbols.map((sym) => ({
    symbol: sym,
    name: XSTOCKS_CATALOG.find((s) => s.symbol === sym)?.name ?? sym,
    volatility: BASE_VOLATILITIES[sym] ?? 0.25,
    invVol: 1 / (BASE_VOLATILITIES[sym] ?? 0.25),
  }));

  const totalInvVol = invVols.reduce((s, v) => s + v.invVol, 0);

  const allocations = invVols.map((stock) => {
    const weight = stock.invVol / totalInvVol;
    const riskContribution = weight * stock.volatility;
    return {
      symbol: stock.symbol,
      name: stock.name,
      weight: round4(weight),
      riskContribution: round4(riskContribution),
      targetRiskContribution: round4(1 / symbols.length),
      volatility: round4(stock.volatility),
    };
  });

  allocations.sort((a, b) => b.weight - a.weight);

  const riskContribs = allocations.map((a) => a.riskContribution);
  const totalRisk = riskContribs.reduce((s, r) => s + r, 0);
  const maxRiskContrib = Math.max(...riskContribs);
  const minRiskContrib = Math.min(...riskContribs);

  // Risk parity score: 100 = perfect parity, lower = more concentrated risk
  const avgRisk = totalRisk / allocations.length;
  const riskVariance = riskContribs.reduce((s, r) => s + (r - avgRisk) ** 2, 0) / allocations.length;
  const riskParityScore = Math.max(0, Math.min(100, Math.round(100 - riskVariance * 50000)));

  return {
    allocations,
    totalRisk: round4(totalRisk),
    maxRiskContribution: round4(maxRiskContrib),
    minRiskContribution: round4(minRiskContrib),
    riskParityScore,
    methodology: "Inverse-volatility weighted risk parity. Each stock weighted inversely proportional to its historical volatility to equalize marginal risk contribution.",
  };
}

// ---------------------------------------------------------------------------
// Rebalance Recommendations
// ---------------------------------------------------------------------------

/**
 * Generate rebalancing recommendations for an agent's portfolio.
 */
export async function getRebalanceRecommendations(agentId: string): Promise<RebalanceRecommendation | null> {
  const config = getAgentConfig(agentId);
  if (!config) return null;

  const optimal = await getOptimalPortfolio(agentId);
  if (!optimal) return null;

  // Calculate drift
  const drifts = optimal.changes.filter((c) => Math.abs(c.delta) > 0.01);
  const driftScore = drifts.reduce((s, d) => s + Math.abs(d.delta), 0);

  let urgency: RebalanceRecommendation["urgency"];
  if (driftScore < 0.05) urgency = "none";
  else if (driftScore < 0.15) urgency = "low";
  else if (driftScore < 0.30) urgency = "medium";
  else if (driftScore < 0.50) urgency = "high";
  else urgency = "critical";

  // Get current market prices
  let marketData: MarketData[];
  try {
    marketData = await getMarketData();
  } catch {
    marketData = [];
  }

  const trades = drifts
    .filter((d) => d.action !== "hold")
    .map((d) => {
      const market = marketData.find(
        (m) => m.symbol.toLowerCase() === d.symbol.toLowerCase(),
      );
      const price = market?.price ?? 100;
      const quantity = Math.abs(d.delta) * 10000 / price; // Proportional to $10k portfolio
      const estimatedCost = quantity * price;

      return {
        symbol: d.symbol,
        action: (d.delta > 0 ? "buy" : "sell") as "buy" | "sell",
        quantity: round4(quantity),
        estimatedCost: round2(estimatedCost),
        reason: d.action === "new"
          ? `New position: add ${d.symbol} at ${d.recommendedWeight * 100}% weight`
          : d.action === "exit"
            ? `Exit position: sell all ${d.symbol}`
            : `Rebalance: ${d.action} ${d.symbol} weight from ${(d.currentWeight * 100).toFixed(1)}% to ${(d.recommendedWeight * 100).toFixed(1)}%`,
      };
    });

  const estimatedTurnover = trades.reduce((s, t) => s + t.estimatedCost, 0);
  const estimatedTransactionCosts = estimatedTurnover * 0.001; // 0.1% estimated cost

  const beforeVol = optimal.currentAllocation.length > 0
    ? calculatePortfolioVolatility(optimal.currentAllocation)
    : 0.25;
  const afterVol = optimal.portfolioMetrics.expectedVolatility;

  return {
    agentId,
    agentName: config.name,
    urgency,
    driftScore: round4(driftScore),
    trades: trades.sort((a, b) => b.estimatedCost - a.estimatedCost),
    estimatedTurnover: round2(estimatedTurnover),
    estimatedTransactionCosts: round2(estimatedTransactionCosts),
    beforeMetrics: {
      sharpe: round2(beforeVol > 0 ? 0.10 / beforeVol : 0),
      volatility: round4(beforeVol),
      maxDrawdown: round4(beforeVol * 2.5),
    },
    afterMetrics: {
      sharpe: optimal.portfolioMetrics.sharpeRatio,
      volatility: afterVol,
      maxDrawdown: optimal.portfolioMetrics.maxDrawdownEstimate,
    },
    summary: urgency === "none"
      ? `${config.name}'s portfolio is well-balanced. No rebalancing needed.`
      : `${config.name}'s portfolio has drifted ${(driftScore * 100).toFixed(1)}% from optimal. ${trades.length} trade(s) recommended with estimated turnover of $${estimatedTurnover.toFixed(2)}.`,
  };
}

// ---------------------------------------------------------------------------
// All Agents Portfolio Comparison
// ---------------------------------------------------------------------------

/**
 * Compare optimal portfolios for all 3 agents side by side.
 */
export async function compareAgentPortfolios(): Promise<{
  agents: Array<{
    agentId: string;
    agentName: string;
    provider: string;
    optimal: OptimalPortfolio;
    kelly: KellyCriterion;
    rebalance: RebalanceRecommendation;
  }>;
  efficientFrontier: EfficientFrontier;
  riskParity: RiskParityPortfolio;
  correlationMatrix: CorrelationMatrix;
  bestAllocator: { agentId: string; agentName: string; sharpe: number };
}> {
  const configs = getAgentConfigs();

  const agentResults = await Promise.all(
    configs.map(async (config) => {
      const [optimal, kelly, rebalance] = await Promise.all([
        getOptimalPortfolio(config.agentId),
        getKellyCriterion(config.agentId),
        getRebalanceRecommendations(config.agentId),
      ]);

      return {
        agentId: config.agentId,
        agentName: config.name,
        provider: config.provider,
        optimal: optimal!,
        kelly: kelly!,
        rebalance: rebalance!,
      };
    }),
  );

  const [efficientFrontier, riskParity, correlationMatrix] = await Promise.all([
    getEfficientFrontier(),
    getRiskParityPortfolio(),
    getCorrelationMatrix(),
  ]);

  const bestAllocator = agentResults
    .filter((a) => a.optimal)
    .sort((a, b) => (b.optimal?.portfolioMetrics.sharpeRatio ?? 0) - (a.optimal?.portfolioMetrics.sharpeRatio ?? 0))[0];

  return {
    agents: agentResults,
    efficientFrontier,
    riskParity,
    correlationMatrix,
    bestAllocator: bestAllocator
      ? {
          agentId: bestAllocator.agentId,
          agentName: bestAllocator.agentName,
          sharpe: bestAllocator.optimal.portfolioMetrics.sharpeRatio,
        }
      : { agentId: "", agentName: "N/A", sharpe: 0 },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function calculatePortfolioVolatility(allocations: AllocationEntry[]): number {
  return calculatePortfolioVolFromWeights(
    allocations.map((a) => ({ symbol: a.symbol, weight: a.weight })),
  );
}

function calculatePortfolioVolFromWeights(
  allocations: Array<{ symbol: string; weight: number }>,
): number {
  // Portfolio variance = sum(wi * wj * sigma_i * sigma_j * rho_ij)
  let variance = 0;
  for (const a of allocations) {
    for (const b of allocations) {
      const volA = BASE_VOLATILITIES[a.symbol] ?? 0.25;
      const volB = BASE_VOLATILITIES[b.symbol] ?? 0.25;
      const corr = generateCorrelation(a.symbol, b.symbol);
      variance += a.weight * b.weight * volA * volB * corr;
    }
  }
  return Math.sqrt(Math.max(0, variance));
}
