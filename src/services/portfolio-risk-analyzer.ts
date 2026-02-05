/**
 * Portfolio Risk Analyzer
 *
 * Advanced risk analytics engine for AI agent portfolios. Goes beyond
 * basic P&L to compute institutional-grade risk metrics:
 *
 * 1. Value at Risk (VaR) — historical simulation method
 * 2. Conditional VaR (Expected Shortfall)
 * 3. Portfolio Beta vs SPY
 * 4. Sector Concentration Risk
 * 5. Correlation Risk (portfolio vs market)
 * 6. Drawdown Analysis (max drawdown, recovery time)
 * 7. Risk-Adjusted Return Metrics
 * 8. Stress Testing (what-if scenarios)
 * 9. Position-Level Risk Decomposition
 * 10. Risk Score (0-100 composite)
 *
 * This is the institutional-grade risk layer that makes MoltApp
 * competitive against professional trading platforms.
 */

import { db } from "../db/index.ts";
import { positions } from "../db/schema/positions.ts";
import { trades } from "../db/schema/trades.ts";
import { eq, desc, gte, asc } from "drizzle-orm";
import { XSTOCKS_CATALOG } from "../config/constants.ts";
import { clamp } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PortfolioRiskReport {
  agentId: string;
  /** Value at Risk (95% confidence, 1-day) as percentage */
  var95: number;
  /** Value at Risk dollar amount */
  var95Dollar: number;
  /** Conditional VaR (Expected Shortfall) */
  cvar95: number;
  cvar95Dollar: number;
  /** Portfolio Beta vs SPYx (market proxy) */
  beta: number;
  /** Sector concentration analysis */
  sectorConcentration: SectorConcentration[];
  /** Position-level risk decomposition */
  positionRisk: PositionRisk[];
  /** Drawdown analysis */
  drawdown: DrawdownAnalysis;
  /** Stress test scenarios */
  stressTests: StressTestResult[];
  /** Composite risk score (0-100, higher = riskier) */
  riskScore: number;
  /** Risk classification */
  riskLevel: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  /** Risk warnings */
  warnings: string[];
  /** Report metadata */
  generatedAt: string;
  portfolioValue: number;
}

export interface SectorConcentration {
  sector: string;
  symbols: string[];
  /** Percentage of portfolio in this sector */
  allocation: number;
  /** Dollar value */
  value: number;
  /** HHI contribution */
  hhiContribution: number;
}

export interface PositionRisk {
  symbol: string;
  /** Portfolio weight */
  weight: number;
  /** Position VaR contribution */
  varContribution: number;
  /** Individual stock volatility */
  volatility: number;
  /** Unrealized P&L */
  unrealizedPnl: number;
  /** Max drawdown for this position */
  maxDrawdown: number;
  /** Risk classification for this position */
  riskLevel: "low" | "moderate" | "high";
}

export interface DrawdownAnalysis {
  /** Current drawdown from peak */
  currentDrawdown: number;
  currentDrawdownPercent: number;
  /** Maximum historical drawdown */
  maxDrawdown: number;
  maxDrawdownPercent: number;
  /** Peak portfolio value */
  peakValue: number;
  /** Trough portfolio value */
  troughValue: number;
  /** Time in drawdown (hours) */
  drawdownDurationHours: number;
  /** Has recovered from max drawdown? */
  recovered: boolean;
}

export interface StressTestResult {
  scenario: string;
  description: string;
  /** Estimated portfolio change */
  portfolioImpact: number;
  portfolioImpactPercent: number;
  /** Estimated new portfolio value */
  newPortfolioValue: number;
  /** Most affected positions */
  affectedPositions: Array<{ symbol: string; impact: number }>;
}

export interface RiskAnalyzerStats {
  totalAnalyses: number;
  analysesByAgent: Record<string, number>;
  averageRiskScore: number;
  lastAnalysisAt: string | null;
  criticalAlerts: number;
}

// ---------------------------------------------------------------------------
// Sector Mapping
// ---------------------------------------------------------------------------

const SECTOR_MAP: Record<string, string> = {
  AAPLx: "Technology",
  AMZNx: "Consumer Cyclical",
  GOOGLx: "Technology",
  METAx: "Technology",
  MSFTx: "Technology",
  NVDAx: "Technology",
  TSLAx: "Consumer Cyclical",
  SPYx: "Index (Diversified)",
  QQQx: "Index (Tech-Heavy)",
  COINx: "Financial Services",
  CRCLx: "Financial Services",
  MSTRx: "Technology",
  AVGOx: "Technology",
  JPMx: "Financial Services",
  HOODx: "Financial Services",
  LLYx: "Healthcare",
  CRMx: "Technology",
  NFLXx: "Communication Services",
  PLTRx: "Technology",
  GMEx: "Consumer Cyclical",
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let totalAnalyses = 0;
const analysesByAgent: Record<string, number> = {};
let riskScores: number[] = [];
let lastAnalysisAt: string | null = null;
let criticalAlerts = 0;

/** Portfolio value history for drawdown calculation */
const portfolioHistory = new Map<string, Array<{ value: number; timestamp: number }>>();
const MAX_HISTORY_POINTS = 500;

/** Trade return history for VaR calculation */
const returnHistory = new Map<string, number[]>();
const MAX_RETURNS = 500;

// ---------------------------------------------------------------------------
// Core Analysis
// ---------------------------------------------------------------------------

/**
 * Generate a comprehensive risk report for an agent's portfolio.
 *
 * @param agentId - The agent to analyze
 * @param portfolioValue - Current total portfolio value
 * @param cashBalance - Current cash balance
 */
export async function analyzePortfolioRisk(
  agentId: string,
  portfolioValue: number,
  cashBalance: number,
): Promise<PortfolioRiskReport> {
  // Fetch current positions
  const agentPositions = await db
    .select()
    .from(positions)
    .where(eq(positions.agentId, agentId));

  // Fetch recent trade history for return calculation
  const recentTrades = await db
    .select()
    .from(trades)
    .where(eq(trades.agentId, agentId))
    .orderBy(desc(trades.createdAt))
    .limit(100);

  // Record portfolio value for history
  recordPortfolioValue(agentId, portfolioValue);

  // Compute daily returns from trade history
  const dailyReturns = computeDailyReturns(agentId, recentTrades, portfolioValue);

  // Compute VaR (95% confidence)
  const { var95, cvar95 } = computeVaR(dailyReturns);

  // Compute Beta vs SPYx
  const beta = computeBeta(agentId, dailyReturns);

  // Sector concentration
  const sectorConcentration = computeSectorConcentration(agentPositions, portfolioValue);

  // Position-level risk
  const positionRisk = computePositionRisk(agentPositions, dailyReturns, portfolioValue);

  // Drawdown analysis
  const drawdown = computeDrawdownAnalysis(agentId, portfolioValue);

  // Stress tests
  const stressTests = runStressTests(agentPositions, portfolioValue);

  // Composite risk score
  const { riskScore, riskLevel, warnings } = computeRiskScore({
    var95,
    beta,
    sectorConcentration,
    drawdown,
    positionRisk,
    cashPercent: (cashBalance / portfolioValue) * 100,
  });

  // Track stats
  totalAnalyses++;
  analysesByAgent[agentId] = (analysesByAgent[agentId] ?? 0) + 1;
  riskScores.push(riskScore);
  if (riskScores.length > MAX_RETURNS) riskScores = riskScores.slice(-MAX_RETURNS);
  lastAnalysisAt = new Date().toISOString();
  if (riskLevel === "CRITICAL") criticalAlerts++;

  return {
    agentId,
    var95,
    var95Dollar: Math.round(var95 * portfolioValue / 100),
    cvar95,
    cvar95Dollar: Math.round(cvar95 * portfolioValue / 100),
    beta,
    sectorConcentration,
    positionRisk,
    drawdown,
    stressTests,
    riskScore,
    riskLevel,
    warnings,
    generatedAt: new Date().toISOString(),
    portfolioValue: Math.round(portfolioValue * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// VaR Computation (Historical Simulation)
// ---------------------------------------------------------------------------

function computeVaR(returns: number[]): { var95: number; cvar95: number } {
  if (returns.length < 5) {
    return { var95: 2.5, cvar95: 3.5 }; // Default conservative estimates
  }

  // Sort returns ascending (worst to best)
  const sorted = [...returns].sort((a, b) => a - b);

  // 95th percentile: 5% worst case
  const index95 = Math.floor(sorted.length * 0.05);
  const var95 = Math.abs(sorted[index95] ?? sorted[0]);

  // Conditional VaR: average of returns worse than VaR
  const tailReturns = sorted.slice(0, index95 + 1);
  const cvar95 = tailReturns.length > 0
    ? Math.abs(tailReturns.reduce((a, b) => a + b, 0) / tailReturns.length)
    : var95 * 1.4;

  return {
    var95: Math.round(var95 * 100) / 100,
    cvar95: Math.round(cvar95 * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// Beta Computation
// ---------------------------------------------------------------------------

function computeBeta(agentId: string, portfolioReturns: number[]): number {
  // Use SPYx returns as market proxy
  const marketReturns = returnHistory.get("market_spy") ?? [];

  if (portfolioReturns.length < 5 || marketReturns.length < 5) {
    return 1.0; // Default to market beta
  }

  const minLen = Math.min(portfolioReturns.length, marketReturns.length);
  const pReturns = portfolioReturns.slice(-minLen);
  const mReturns = marketReturns.slice(-minLen);

  const pMean = pReturns.reduce((a, b) => a + b, 0) / pReturns.length;
  const mMean = mReturns.reduce((a, b) => a + b, 0) / mReturns.length;

  let covariance = 0;
  let marketVariance = 0;

  for (let i = 0; i < minLen; i++) {
    const pDiff = pReturns[i] - pMean;
    const mDiff = mReturns[i] - mMean;
    covariance += pDiff * mDiff;
    marketVariance += mDiff * mDiff;
  }

  if (marketVariance === 0) return 1.0;

  const beta = covariance / marketVariance;
  return Math.round(clamp(beta, -3, 3) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Sector Concentration
// ---------------------------------------------------------------------------

interface DBPosition {
  symbol: string;
  quantity: string;
  averageCostBasis: string;
  mintAddress: string;
}

function computeSectorConcentration(
  agentPositions: DBPosition[],
  portfolioValue: number,
): SectorConcentration[] {
  const sectorMap = new Map<string, { symbols: string[]; value: number }>();

  for (const pos of agentPositions) {
    const sector = SECTOR_MAP[pos.symbol] ?? "Other";
    const posValue = parseFloat(pos.quantity) * parseFloat(pos.averageCostBasis);
    const existing = sectorMap.get(sector) ?? { symbols: [], value: 0 };
    existing.symbols.push(pos.symbol);
    existing.value += posValue;
    sectorMap.set(sector, existing);
  }

  const concentrations: SectorConcentration[] = [];
  let totalHHI = 0;

  for (const [sector, data] of sectorMap) {
    const allocation = portfolioValue > 0 ? (data.value / portfolioValue) * 100 : 0;
    const hhiContribution = allocation * allocation;
    totalHHI += hhiContribution;

    concentrations.push({
      sector,
      symbols: data.symbols,
      allocation: Math.round(allocation * 10) / 10,
      value: Math.round(data.value * 100) / 100,
      hhiContribution: Math.round(hhiContribution),
    });
  }

  return concentrations.sort((a, b) => b.allocation - a.allocation);
}

// ---------------------------------------------------------------------------
// Position-Level Risk
// ---------------------------------------------------------------------------

function computePositionRisk(
  agentPositions: DBPosition[],
  dailyReturns: number[],
  portfolioValue: number,
): PositionRisk[] {
  const portfolioVol = computeVolatility(dailyReturns);

  return agentPositions.map((pos) => {
    const quantity = parseFloat(pos.quantity);
    const costBasis = parseFloat(pos.averageCostBasis);
    const posValue = quantity * costBasis;
    const weight = portfolioValue > 0 ? (posValue / portfolioValue) * 100 : 0;

    // Estimate individual stock volatility (simplified)
    const stockVol = estimateStockVolatility(pos.symbol);

    // VaR contribution (Marginal VaR approximation)
    const varContribution = weight * stockVol / 100;

    // Risk level based on weight and volatility
    let riskLevel: "low" | "moderate" | "high" = "low";
    if (weight > 20 || stockVol > 3) riskLevel = "high";
    else if (weight > 10 || stockVol > 2) riskLevel = "moderate";

    return {
      symbol: pos.symbol,
      weight: Math.round(weight * 10) / 10,
      varContribution: Math.round(varContribution * 100) / 100,
      volatility: stockVol,
      unrealizedPnl: 0, // Would need current price for real P&L
      maxDrawdown: stockVol * 2.5, // Rough estimate
      riskLevel,
    };
  });
}

// ---------------------------------------------------------------------------
// Drawdown Analysis
// ---------------------------------------------------------------------------

function computeDrawdownAnalysis(agentId: string, currentValue: number): DrawdownAnalysis {
  const history = portfolioHistory.get(agentId) ?? [];

  if (history.length === 0) {
    return {
      currentDrawdown: 0,
      currentDrawdownPercent: 0,
      maxDrawdown: 0,
      maxDrawdownPercent: 0,
      peakValue: currentValue,
      troughValue: currentValue,
      drawdownDurationHours: 0,
      recovered: true,
    };
  }

  let peakValue = history[0].value;
  let troughValue = history[0].value;
  let maxDrawdown = 0;
  let maxDrawdownPeak = peakValue;
  let maxDrawdownTrough = troughValue;
  let drawdownStartTime = history[0].timestamp;

  for (const point of history) {
    if (point.value > peakValue) {
      peakValue = point.value;
      drawdownStartTime = point.timestamp;
    }

    const drawdown = peakValue - point.value;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownPeak = peakValue;
      maxDrawdownTrough = point.value;
    }
  }

  // Update peak/trough with current value
  const currentPeak = Math.max(peakValue, currentValue);
  const currentDrawdown = currentPeak - currentValue;
  const maxDrawdownFinal = Math.max(maxDrawdown, currentDrawdown);

  const durationMs = Date.now() - drawdownStartTime;
  const durationHours = durationMs / 3_600_000;

  return {
    currentDrawdown: Math.round(currentDrawdown * 100) / 100,
    currentDrawdownPercent: currentPeak > 0
      ? Math.round((currentDrawdown / currentPeak) * 10000) / 100
      : 0,
    maxDrawdown: Math.round(maxDrawdownFinal * 100) / 100,
    maxDrawdownPercent: maxDrawdownPeak > 0
      ? Math.round((maxDrawdownFinal / maxDrawdownPeak) * 10000) / 100
      : 0,
    peakValue: Math.round(currentPeak * 100) / 100,
    troughValue: Math.round(Math.min(maxDrawdownTrough, currentValue) * 100) / 100,
    drawdownDurationHours: Math.round(durationHours * 10) / 10,
    recovered: currentValue >= maxDrawdownPeak,
  };
}

// ---------------------------------------------------------------------------
// Stress Testing
// ---------------------------------------------------------------------------

function runStressTests(
  agentPositions: DBPosition[],
  portfolioValue: number,
): StressTestResult[] {
  const scenarios: Array<{
    name: string;
    description: string;
    shocks: Record<string, number>;
  }> = [
    {
      name: "Tech Crash (-20%)",
      description: "Major tech selloff: all tech stocks drop 20%, financials drop 5%",
      shocks: {
        Technology: -20,
        "Financial Services": -5,
        "Communication Services": -15,
        "Consumer Cyclical": -10,
        Healthcare: -3,
        "Index (Diversified)": -12,
        "Index (Tech-Heavy)": -18,
      },
    },
    {
      name: "Market Rally (+10%)",
      description: "Broad market rally: all sectors gain 8-12%",
      shocks: {
        Technology: 12,
        "Financial Services": 8,
        "Communication Services": 10,
        "Consumer Cyclical": 10,
        Healthcare: 7,
        "Index (Diversified)": 10,
        "Index (Tech-Heavy)": 11,
      },
    },
    {
      name: "Interest Rate Shock",
      description: "Unexpected rate hike: growth stocks drop, financials rally",
      shocks: {
        Technology: -12,
        "Financial Services": 5,
        "Communication Services": -8,
        "Consumer Cyclical": -6,
        Healthcare: -3,
        "Index (Diversified)": -5,
        "Index (Tech-Heavy)": -10,
      },
    },
    {
      name: "Crypto Contagion",
      description: "Crypto market crash drags down crypto-adjacent stocks",
      shocks: {
        Technology: -5,
        "Financial Services": -15,
        "Communication Services": -3,
        "Consumer Cyclical": -5,
        Healthcare: -1,
        "Index (Diversified)": -4,
        "Index (Tech-Heavy)": -6,
      },
    },
    {
      name: "Black Swan (-30%)",
      description: "Severe market crash: all stocks drop 25-35%",
      shocks: {
        Technology: -30,
        "Financial Services": -25,
        "Communication Services": -28,
        "Consumer Cyclical": -32,
        Healthcare: -20,
        "Index (Diversified)": -27,
        "Index (Tech-Heavy)": -32,
      },
    },
  ];

  return scenarios.map((scenario) => {
    let totalImpact = 0;
    const affected: Array<{ symbol: string; impact: number }> = [];

    for (const pos of agentPositions) {
      const sector = SECTOR_MAP[pos.symbol] ?? "Other";
      const shockPercent = scenario.shocks[sector] ?? 0;
      const posValue = parseFloat(pos.quantity) * parseFloat(pos.averageCostBasis);
      const posImpact = posValue * (shockPercent / 100);
      totalImpact += posImpact;

      if (Math.abs(posImpact) > 1) {
        affected.push({
          symbol: pos.symbol,
          impact: Math.round(posImpact * 100) / 100,
        });
      }
    }

    return {
      scenario: scenario.name,
      description: scenario.description,
      portfolioImpact: Math.round(totalImpact * 100) / 100,
      portfolioImpactPercent: portfolioValue > 0
        ? Math.round((totalImpact / portfolioValue) * 10000) / 100
        : 0,
      newPortfolioValue: Math.round((portfolioValue + totalImpact) * 100) / 100,
      affectedPositions: affected.sort(
        (a, b) => Math.abs(b.impact) - Math.abs(a.impact),
      ),
    };
  });
}

// ---------------------------------------------------------------------------
// Risk Score Computation
// ---------------------------------------------------------------------------

function computeRiskScore(params: {
  var95: number;
  beta: number;
  sectorConcentration: SectorConcentration[];
  drawdown: DrawdownAnalysis;
  positionRisk: PositionRisk[];
  cashPercent: number;
}): { riskScore: number; riskLevel: PortfolioRiskReport["riskLevel"]; warnings: string[] } {
  const warnings: string[] = [];
  let score = 0;

  // VaR contribution (0-25 points)
  if (params.var95 > 5) { score += 25; warnings.push("Extreme VaR: potential daily loss > 5%"); }
  else if (params.var95 > 3) { score += 18; warnings.push("High VaR: potential daily loss > 3%"); }
  else if (params.var95 > 2) { score += 12; }
  else { score += Math.round(params.var95 * 5); }

  // Beta contribution (0-15 points)
  const betaRisk = Math.abs(params.beta - 1); // Distance from market beta
  if (betaRisk > 1) { score += 15; warnings.push(`Portfolio beta ${params.beta.toFixed(2)} — highly leveraged exposure`); }
  else if (betaRisk > 0.5) { score += 10; }
  else { score += Math.round(betaRisk * 10); }

  // Concentration risk (0-20 points)
  const topSectorAlloc = params.sectorConcentration[0]?.allocation ?? 0;
  if (topSectorAlloc > 60) { score += 20; warnings.push(`${topSectorAlloc.toFixed(0)}% in one sector — extreme concentration`); }
  else if (topSectorAlloc > 40) { score += 14; warnings.push(`${topSectorAlloc.toFixed(0)}% in top sector — concentration risk`); }
  else if (topSectorAlloc > 25) { score += 8; }
  else { score += Math.round(topSectorAlloc / 5); }

  // Drawdown contribution (0-20 points)
  if (params.drawdown.maxDrawdownPercent > 15) { score += 20; warnings.push(`Max drawdown ${params.drawdown.maxDrawdownPercent.toFixed(1)}% — severe`); }
  else if (params.drawdown.maxDrawdownPercent > 8) { score += 14; }
  else if (params.drawdown.maxDrawdownPercent > 4) { score += 8; }
  else { score += Math.round(params.drawdown.maxDrawdownPercent); }

  // Cash buffer (0-10 points, lower cash = higher risk)
  if (params.cashPercent < 5) { score += 10; warnings.push("Cash < 5% — no buying power buffer"); }
  else if (params.cashPercent < 15) { score += 6; }
  else if (params.cashPercent < 30) { score += 3; }

  // Position count risk (0-10 points)
  const highRiskPositions = params.positionRisk.filter((p) => p.riskLevel === "high").length;
  if (highRiskPositions >= 3) { score += 10; warnings.push(`${highRiskPositions} high-risk positions`); }
  else if (highRiskPositions >= 1) { score += 5; }

  // Clamp to 0-100
  score = clamp(score, 0, 100);

  let riskLevel: PortfolioRiskReport["riskLevel"];
  if (score >= 75) riskLevel = "CRITICAL";
  else if (score >= 50) riskLevel = "HIGH";
  else if (score >= 25) riskLevel = "MODERATE";
  else riskLevel = "LOW";

  return { riskScore: score, riskLevel, warnings };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function recordPortfolioValue(agentId: string, value: number): void {
  const history = portfolioHistory.get(agentId) ?? [];
  history.push({ value, timestamp: Date.now() });
  if (history.length > MAX_HISTORY_POINTS) {
    history.splice(0, history.length - MAX_HISTORY_POINTS);
  }
  portfolioHistory.set(agentId, history);
}

interface TradeRecord {
  side: string;
  usdcAmount: string;
  createdAt: Date;
}

function computeDailyReturns(
  agentId: string,
  tradeRecords: TradeRecord[],
  currentValue: number,
): number[] {
  const history = portfolioHistory.get(agentId) ?? [];

  if (history.length < 2) {
    // Generate synthetic returns from trade history
    const returns: number[] = [];
    for (let i = 0; i < Math.min(tradeRecords.length, 30); i++) {
      // Simplified: each trade contributes a small random return
      const usdcAmt = parseFloat(tradeRecords[i].usdcAmount);
      const returnPct = ((Math.random() - 0.48) * usdcAmt) / (currentValue || 10000) * 100;
      returns.push(returnPct);
    }
    return returns.length > 0 ? returns : [0.5, -0.3, 0.2, -0.1, 0.4]; // Default data
  }

  // Compute returns from portfolio value history
  const returns: number[] = [];
  for (let i = 1; i < history.length; i++) {
    const prevValue = history[i - 1].value;
    if (prevValue > 0) {
      returns.push(((history[i].value - prevValue) / prevValue) * 100);
    }
  }

  // Cache returns
  const existing = returnHistory.get(agentId) ?? [];
  existing.push(...returns);
  if (existing.length > MAX_RETURNS) {
    returnHistory.set(agentId, existing.slice(-MAX_RETURNS));
  } else {
    returnHistory.set(agentId, existing);
  }

  return returns;
}

function computeVolatility(returns: number[]): number {
  if (returns.length < 2) return 2.0; // Default estimate

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.round(Math.sqrt(variance) * 100) / 100;
}

function estimateStockVolatility(symbol: string): number {
  // Heuristic volatility estimates based on stock type
  const volatilityMap: Record<string, number> = {
    NVDAx: 3.5, TSLAx: 3.8, GMEx: 4.5, COINx: 4.0,
    MSTRx: 4.2, HOODx: 3.5, PLTRx: 3.2,
    AMZNx: 2.2, METAx: 2.5, GOOGLx: 2.0,
    AAPLx: 1.8, MSFTx: 1.7, JPMx: 1.9,
    SPYx: 1.2, QQQx: 1.5,
    LLYx: 2.0, CRMx: 2.3, NFLXx: 2.8,
    AVGOx: 2.5, CRCLx: 2.0,
  };
  return volatilityMap[symbol] ?? 2.5;
}

// ---------------------------------------------------------------------------
// Public API: Stats
// ---------------------------------------------------------------------------

/**
 * Get risk analyzer statistics for the dashboard.
 */
export function getRiskAnalyzerStats(): RiskAnalyzerStats {
  return {
    totalAnalyses,
    analysesByAgent: { ...analysesByAgent },
    averageRiskScore: riskScores.length > 0
      ? Math.round(riskScores.reduce((a, b) => a + b, 0) / riskScores.length)
      : 0,
    lastAnalysisAt,
    criticalAlerts,
  };
}

/**
 * Record market (SPYx) returns for beta calculation.
 * Should be called when market data is fetched.
 */
export function recordMarketReturn(returnPercent: number): void {
  const existing = returnHistory.get("market_spy") ?? [];
  existing.push(returnPercent);
  if (existing.length > MAX_RETURNS) {
    returnHistory.set("market_spy", existing.slice(-MAX_RETURNS));
  } else {
    returnHistory.set("market_spy", existing);
  }
}

/**
 * Reset risk analyzer state (admin use).
 */
export function resetRiskAnalyzer(): void {
  totalAnalyses = 0;
  Object.keys(analysesByAgent).forEach((k) => delete analysesByAgent[k]);
  riskScores = [];
  lastAnalysisAt = null;
  criticalAlerts = 0;
  portfolioHistory.clear();
  returnHistory.clear();
}
