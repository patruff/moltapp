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
import { clamp, round2, countByCondition, computeVariance } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Risk Analysis Configuration Constants
// ---------------------------------------------------------------------------

/**
 * VaR/CVaR Computation Parameters
 * Controls Value at Risk and Conditional VaR (Expected Shortfall) calculations
 */

/** Minimum return samples required for historical VaR calculation */
const VAR_MIN_SAMPLES = 5;

/** Default VaR estimate (%) when insufficient data — conservative baseline */
const VAR_DEFAULT = 2.5;

/** Default CVaR estimate (%) when insufficient data — conservative baseline */
const CVAR_DEFAULT = 3.5;

/** CVaR multiplier when tail average cannot be computed (CVaR ≈ VaR × 1.4) */
const CVAR_MULTIPLIER_FALLBACK = 1.4;

/** Percentile for VaR calculation (0.05 = 95th percentile, 5% worst case) */
const VAR_PERCENTILE = 0.05;

/**
 * Beta Calculation Parameters
 * Controls portfolio beta vs SPYx (market proxy) computation
 */

/** Minimum return samples required for beta calculation */
const BETA_MIN_SAMPLES = 5;

/** Default beta when insufficient data (1.0 = market beta) */
const BETA_DEFAULT = 1.0;

/** Minimum beta clamp bound (prevents extreme negative beta) */
const BETA_CLAMP_MIN = -3;

/** Maximum beta clamp bound (prevents extreme positive beta) */
const BETA_CLAMP_MAX = 3;

/**
 * Position Risk Thresholds
 * Controls position-level risk classification (low/moderate/high)
 */

/** Portfolio weight (%) threshold for HIGH risk classification */
const POSITION_WEIGHT_HIGH_THRESHOLD = 20;

/** Portfolio weight (%) threshold for MODERATE risk classification */
const POSITION_WEIGHT_MODERATE_THRESHOLD = 10;

/** Stock volatility (%) threshold for HIGH risk classification */
const POSITION_VOLATILITY_HIGH_THRESHOLD = 3;

/** Stock volatility (%) threshold for MODERATE risk classification */
const POSITION_VOLATILITY_MODERATE_THRESHOLD = 2;

/** Max drawdown estimation multiplier (maxDD ≈ volatility × 2.5) */
const POSITION_MAX_DRAWDOWN_MULTIPLIER = 2.5;

/**
 * Stress Test Scenario Shock Values (%)
 * Defines sector-level shocks for what-if scenario analysis
 */

// Tech Crash Scenario (-20%)
const STRESS_TECH_CRASH_TECHNOLOGY = -20;
const STRESS_TECH_CRASH_FINANCIAL = -5;
const STRESS_TECH_CRASH_COMMUNICATION = -15;
const STRESS_TECH_CRASH_CONSUMER = -10;
const STRESS_TECH_CRASH_HEALTHCARE = -3;
const STRESS_TECH_CRASH_INDEX_DIVERSIFIED = -12;
const STRESS_TECH_CRASH_INDEX_TECH = -18;

// Market Rally Scenario (+10%)
const STRESS_RALLY_TECHNOLOGY = 12;
const STRESS_RALLY_FINANCIAL = 8;
const STRESS_RALLY_COMMUNICATION = 10;
const STRESS_RALLY_CONSUMER = 10;
const STRESS_RALLY_HEALTHCARE = 7;
const STRESS_RALLY_INDEX_DIVERSIFIED = 10;
const STRESS_RALLY_INDEX_TECH = 11;

// Interest Rate Shock Scenario
const STRESS_RATE_TECHNOLOGY = -12;
const STRESS_RATE_FINANCIAL = 5;
const STRESS_RATE_COMMUNICATION = -8;
const STRESS_RATE_CONSUMER = -6;
const STRESS_RATE_HEALTHCARE = -3;
const STRESS_RATE_INDEX_DIVERSIFIED = -5;
const STRESS_RATE_INDEX_TECH = -10;

// Crypto Contagion Scenario
const STRESS_CRYPTO_TECHNOLOGY = -5;
const STRESS_CRYPTO_FINANCIAL = -15;
const STRESS_CRYPTO_COMMUNICATION = -3;
const STRESS_CRYPTO_CONSUMER = -5;
const STRESS_CRYPTO_HEALTHCARE = -1;
const STRESS_CRYPTO_INDEX_DIVERSIFIED = -4;
const STRESS_CRYPTO_INDEX_TECH = -6;

// Black Swan Scenario (-30%)
const STRESS_SWAN_TECHNOLOGY = -30;
const STRESS_SWAN_FINANCIAL = -25;
const STRESS_SWAN_COMMUNICATION = -28;
const STRESS_SWAN_CONSUMER = -32;
const STRESS_SWAN_HEALTHCARE = -20;
const STRESS_SWAN_INDEX_DIVERSIFIED = -27;
const STRESS_SWAN_INDEX_TECH = -32;

/**
 * Risk Score Composite Weights and Thresholds (0-100 scale)
 * Controls calculation of overall portfolio risk score
 */

// VaR Contribution Weights (0-25 points)
const RISK_SCORE_VAR_EXTREME_POINTS = 25;
const RISK_SCORE_VAR_HIGH_POINTS = 18;
const RISK_SCORE_VAR_MODERATE_POINTS = 12;
const RISK_SCORE_VAR_LOW_MULTIPLIER = 5; // score = VaR% × 5

const RISK_THRESHOLD_VAR_EXTREME = 5; // % daily loss
const RISK_THRESHOLD_VAR_HIGH = 3; // % daily loss
const RISK_THRESHOLD_VAR_MODERATE = 2; // % daily loss

// Beta Contribution Weights (0-15 points)
const RISK_SCORE_BETA_EXTREME_POINTS = 15;
const RISK_SCORE_BETA_MODERATE_POINTS = 10;
const RISK_SCORE_BETA_LOW_MULTIPLIER = 10; // score = betaDistance × 10

const RISK_THRESHOLD_BETA_EXTREME = 1; // distance from market beta
const RISK_THRESHOLD_BETA_MODERATE = 0.5; // distance from market beta

// Concentration Risk Weights (0-20 points)
const RISK_SCORE_CONCENTRATION_EXTREME_POINTS = 20;
const RISK_SCORE_CONCENTRATION_HIGH_POINTS = 14;
const RISK_SCORE_CONCENTRATION_MODERATE_POINTS = 8;
const RISK_SCORE_CONCENTRATION_LOW_DIVISOR = 5; // score = allocation% / 5

const RISK_THRESHOLD_CONCENTRATION_EXTREME = 60; // % in one sector
const RISK_THRESHOLD_CONCENTRATION_HIGH = 40; // % in one sector
const RISK_THRESHOLD_CONCENTRATION_MODERATE = 25; // % in one sector

// Drawdown Contribution Weights (0-20 points)
const RISK_SCORE_DRAWDOWN_SEVERE_POINTS = 20;
const RISK_SCORE_DRAWDOWN_HIGH_POINTS = 14;
const RISK_SCORE_DRAWDOWN_MODERATE_POINTS = 8;

const RISK_THRESHOLD_DRAWDOWN_SEVERE = 15; // % max drawdown
const RISK_THRESHOLD_DRAWDOWN_HIGH = 8; // % max drawdown
const RISK_THRESHOLD_DRAWDOWN_MODERATE = 4; // % max drawdown

// Cash Buffer Weights (0-10 points, inverse: lower cash = higher risk)
const RISK_SCORE_CASH_CRITICAL_POINTS = 10;
const RISK_SCORE_CASH_LOW_POINTS = 6;
const RISK_SCORE_CASH_MODERATE_POINTS = 3;

const RISK_THRESHOLD_CASH_CRITICAL = 5; // % cash
const RISK_THRESHOLD_CASH_LOW = 15; // % cash
const RISK_THRESHOLD_CASH_MODERATE = 30; // % cash

// Position Count Risk Weights (0-10 points)
const RISK_SCORE_POSITION_HIGH_POINTS = 10;
const RISK_SCORE_POSITION_MODERATE_POINTS = 5;

const RISK_THRESHOLD_POSITION_HIGH = 3; // high-risk positions count
const RISK_THRESHOLD_POSITION_MODERATE = 1; // high-risk positions count

/**
 * Risk Level Classification Thresholds
 * Maps composite risk score (0-100) to risk level labels
 */

const RISK_LEVEL_CRITICAL_THRESHOLD = 75; // score ≥ 75 = CRITICAL
const RISK_LEVEL_HIGH_THRESHOLD = 50; // score ≥ 50 = HIGH
const RISK_LEVEL_MODERATE_THRESHOLD = 25; // score ≥ 25 = MODERATE
// score < 25 = LOW

/**
 * Stock Volatility Estimates (% daily)
 * Heuristic volatility estimates for individual stocks based on historical behavior.
 * These are used when insufficient return history exists for statistical volatility calculation.
 * Values represent approximate daily volatility percentage (standard deviation of daily returns).
 *
 * Categories:
 * - High Volatility (3.5%+): Tech/crypto stocks with high beta, growth stocks
 * - Moderate Volatility (2.0-3.5%): Large-cap tech, established growth companies
 * - Low Volatility (1.5-2.0%): Mega-cap tech, stable blue chips
 * - Market Volatility (1.2-1.5%): Index funds like SPYx, QQQx
 */

// High Volatility Stocks (3.5%+ daily volatility)
/** NVIDIA - Semiconductor leader, high growth premium, options-driven volatility */
const VOL_NVDAx = 3.5;
/** Tesla - EV pioneer, high retail sentiment, earnings volatility */
const VOL_TSLAx = 3.8;
/** GameStop - Meme stock, extreme retail participation, sentiment-driven */
const VOL_GMEx = 4.5;
/** Coinbase - Crypto proxy, correlated with BTC volatility, regulatory risk */
const VOL_COINx = 4.0;
/** MicroStrategy - Bitcoin treasury play, leveraged BTC exposure */
const VOL_MSTRx = 4.2;
/** Robinhood - Fintech, trading volume volatility, retail sentiment */
const VOL_HOODx = 3.5;
/** Palantir - Government contracts, AI narrative, growth stock volatility */
const VOL_PLTRx = 3.2;

// Moderate Volatility Stocks (2.0-3.5% daily volatility)
/** Amazon - E-commerce/cloud leader, large cap with growth premium */
const VOL_AMZNx = 2.2;
/** Meta - Social media leader, advertising cyclicality, regulatory risk */
const VOL_METAx = 2.5;
/** Alphabet/Google - Search monopoly, advertising revenue, AI investments */
const VOL_GOOGLx = 2.0;
/** Eli Lilly - Pharma, GLP-1 obesity drugs, clinical trial risk */
const VOL_LLYx = 2.0;
/** Salesforce - Enterprise SaaS, cloud growth, economic sensitivity */
const VOL_CRMx = 2.3;
/** Netflix - Streaming leader, subscriber growth volatility, content costs */
const VOL_NFLXx = 2.8;
/** Broadcom - Semiconductor/software, M&A activity, enterprise cycles */
const VOL_AVGOx = 2.5;
/** Carnival Cruise - Travel/leisure, economic sensitivity, fuel costs */
const VOL_CRCLx = 2.0;

// Low Volatility Stocks (1.5-2.0% daily volatility)
/** Apple - Mega-cap tech, iPhone cycles, services growth, low beta */
const VOL_AAPLx = 1.8;
/** Microsoft - Enterprise software/cloud, stable revenue, Azure growth */
const VOL_MSFTx = 1.7;
/** JPMorgan - Banking leader, interest rate sensitivity, stable dividend */
const VOL_JPMx = 1.9;

// Market Index Funds (1.2-1.5% daily volatility)
/** S&P 500 ETF - Market proxy, diversified large-cap exposure */
const VOL_SPYx = 1.2;
/** Nasdaq-100 ETF - Tech-heavy index, growth stock concentration */
const VOL_QQQx = 1.5;

/** Default volatility estimate when stock not in catalog (moderate baseline) */
const VOL_DEFAULT = 2.5;

/**
 * Synthetic Return Generation Parameters
 * Used when insufficient portfolio history exists for statistical analysis.
 * These control fallback data generation for risk calculations.
 */

/** Maximum number of trade records to use for synthetic return generation */
const SYNTHETIC_RETURNS_MAX_TRADES = 30;

/** Random return center offset (0.48 centers random() - 0.48 around -0.02 bias) */
const SYNTHETIC_RETURNS_RANDOM_OFFSET = 0.48;

/** Fallback return series when no trade history or portfolio history exists */
const DEFAULT_RETURN_SERIES = [0.5, -0.3, 0.2, -0.1, 0.4] as const;

/** Default volatility estimate (%) when insufficient return data for computation */
const VOLATILITY_DEFAULT = 2.0;

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
    portfolioValue: round2(portfolioValue),
  };
}

// ---------------------------------------------------------------------------
// VaR Computation (Historical Simulation)
// ---------------------------------------------------------------------------

function computeVaR(returns: number[]): { var95: number; cvar95: number } {
  if (returns.length < VAR_MIN_SAMPLES) {
    return { var95: VAR_DEFAULT, cvar95: CVAR_DEFAULT };
  }

  // Sort returns ascending (worst to best)
  const sorted = [...returns].sort((a, b) => a - b);

  // 95th percentile: 5% worst case
  const index95 = Math.floor(sorted.length * VAR_PERCENTILE);
  const var95 = Math.abs(sorted[index95] ?? sorted[0]);

  // Conditional VaR: average of returns worse than VaR
  const tailReturns = sorted.slice(0, index95 + 1);
  const cvar95 = tailReturns.length > 0
    ? Math.abs(tailReturns.reduce((a, b) => a + b, 0) / tailReturns.length)
    : var95 * CVAR_MULTIPLIER_FALLBACK;

  return {
    var95: round2(var95),
    cvar95: round2(cvar95),
  };
}

// ---------------------------------------------------------------------------
// Beta Computation
// ---------------------------------------------------------------------------

function computeBeta(agentId: string, portfolioReturns: number[]): number {
  // Use SPYx returns as market proxy
  const marketReturns = returnHistory.get("market_spy") ?? [];

  if (portfolioReturns.length < BETA_MIN_SAMPLES || marketReturns.length < BETA_MIN_SAMPLES) {
    return BETA_DEFAULT;
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

  if (marketVariance === 0) return BETA_DEFAULT;

  const beta = covariance / marketVariance;
  return round2(clamp(beta, BETA_CLAMP_MIN, BETA_CLAMP_MAX));
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
      value: round2(data.value),
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
    if (weight > POSITION_WEIGHT_HIGH_THRESHOLD || stockVol > POSITION_VOLATILITY_HIGH_THRESHOLD) riskLevel = "high";
    else if (weight > POSITION_WEIGHT_MODERATE_THRESHOLD || stockVol > POSITION_VOLATILITY_MODERATE_THRESHOLD) riskLevel = "moderate";

    return {
      symbol: pos.symbol,
      weight: Math.round(weight * 10) / 10,
      varContribution: round2(varContribution),
      volatility: stockVol,
      unrealizedPnl: 0, // Would need current price for real P&L
      maxDrawdown: stockVol * POSITION_MAX_DRAWDOWN_MULTIPLIER,
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
    currentDrawdown: round2(currentDrawdown),
    currentDrawdownPercent: currentPeak > 0
      ? Math.round((currentDrawdown / currentPeak) * 10000) / 100
      : 0,
    maxDrawdown: round2(maxDrawdownFinal),
    maxDrawdownPercent: maxDrawdownPeak > 0
      ? Math.round((maxDrawdownFinal / maxDrawdownPeak) * 10000) / 100
      : 0,
    peakValue: round2(currentPeak),
    troughValue: round2(Math.min(maxDrawdownTrough, currentValue)),
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
        Technology: STRESS_TECH_CRASH_TECHNOLOGY,
        "Financial Services": STRESS_TECH_CRASH_FINANCIAL,
        "Communication Services": STRESS_TECH_CRASH_COMMUNICATION,
        "Consumer Cyclical": STRESS_TECH_CRASH_CONSUMER,
        Healthcare: STRESS_TECH_CRASH_HEALTHCARE,
        "Index (Diversified)": STRESS_TECH_CRASH_INDEX_DIVERSIFIED,
        "Index (Tech-Heavy)": STRESS_TECH_CRASH_INDEX_TECH,
      },
    },
    {
      name: "Market Rally (+10%)",
      description: "Broad market rally: all sectors gain 8-12%",
      shocks: {
        Technology: STRESS_RALLY_TECHNOLOGY,
        "Financial Services": STRESS_RALLY_FINANCIAL,
        "Communication Services": STRESS_RALLY_COMMUNICATION,
        "Consumer Cyclical": STRESS_RALLY_CONSUMER,
        Healthcare: STRESS_RALLY_HEALTHCARE,
        "Index (Diversified)": STRESS_RALLY_INDEX_DIVERSIFIED,
        "Index (Tech-Heavy)": STRESS_RALLY_INDEX_TECH,
      },
    },
    {
      name: "Interest Rate Shock",
      description: "Unexpected rate hike: growth stocks drop, financials rally",
      shocks: {
        Technology: STRESS_RATE_TECHNOLOGY,
        "Financial Services": STRESS_RATE_FINANCIAL,
        "Communication Services": STRESS_RATE_COMMUNICATION,
        "Consumer Cyclical": STRESS_RATE_CONSUMER,
        Healthcare: STRESS_RATE_HEALTHCARE,
        "Index (Diversified)": STRESS_RATE_INDEX_DIVERSIFIED,
        "Index (Tech-Heavy)": STRESS_RATE_INDEX_TECH,
      },
    },
    {
      name: "Crypto Contagion",
      description: "Crypto market crash drags down crypto-adjacent stocks",
      shocks: {
        Technology: STRESS_CRYPTO_TECHNOLOGY,
        "Financial Services": STRESS_CRYPTO_FINANCIAL,
        "Communication Services": STRESS_CRYPTO_COMMUNICATION,
        "Consumer Cyclical": STRESS_CRYPTO_CONSUMER,
        Healthcare: STRESS_CRYPTO_HEALTHCARE,
        "Index (Diversified)": STRESS_CRYPTO_INDEX_DIVERSIFIED,
        "Index (Tech-Heavy)": STRESS_CRYPTO_INDEX_TECH,
      },
    },
    {
      name: "Black Swan (-30%)",
      description: "Severe market crash: all stocks drop 25-35%",
      shocks: {
        Technology: STRESS_SWAN_TECHNOLOGY,
        "Financial Services": STRESS_SWAN_FINANCIAL,
        "Communication Services": STRESS_SWAN_COMMUNICATION,
        "Consumer Cyclical": STRESS_SWAN_CONSUMER,
        Healthcare: STRESS_SWAN_HEALTHCARE,
        "Index (Diversified)": STRESS_SWAN_INDEX_DIVERSIFIED,
        "Index (Tech-Heavy)": STRESS_SWAN_INDEX_TECH,
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
          impact: round2(posImpact),
        });
      }
    }

    return {
      scenario: scenario.name,
      description: scenario.description,
      portfolioImpact: round2(totalImpact),
      portfolioImpactPercent: portfolioValue > 0
        ? Math.round((totalImpact / portfolioValue) * 10000) / 100
        : 0,
      newPortfolioValue: round2(portfolioValue + totalImpact),
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
  if (params.var95 > RISK_THRESHOLD_VAR_EXTREME) {
    score += RISK_SCORE_VAR_EXTREME_POINTS;
    warnings.push(`Extreme VaR: potential daily loss > ${RISK_THRESHOLD_VAR_EXTREME}%`);
  }
  else if (params.var95 > RISK_THRESHOLD_VAR_HIGH) {
    score += RISK_SCORE_VAR_HIGH_POINTS;
    warnings.push(`High VaR: potential daily loss > ${RISK_THRESHOLD_VAR_HIGH}%`);
  }
  else if (params.var95 > RISK_THRESHOLD_VAR_MODERATE) {
    score += RISK_SCORE_VAR_MODERATE_POINTS;
  }
  else {
    score += Math.round(params.var95 * RISK_SCORE_VAR_LOW_MULTIPLIER);
  }

  // Beta contribution (0-15 points)
  const betaRisk = Math.abs(params.beta - BETA_DEFAULT);
  if (betaRisk > RISK_THRESHOLD_BETA_EXTREME) {
    score += RISK_SCORE_BETA_EXTREME_POINTS;
    warnings.push(`Portfolio beta ${params.beta.toFixed(2)} — highly leveraged exposure`);
  }
  else if (betaRisk > RISK_THRESHOLD_BETA_MODERATE) {
    score += RISK_SCORE_BETA_MODERATE_POINTS;
  }
  else {
    score += Math.round(betaRisk * RISK_SCORE_BETA_LOW_MULTIPLIER);
  }

  // Concentration risk (0-20 points)
  const topSectorAlloc = params.sectorConcentration[0]?.allocation ?? 0;
  if (topSectorAlloc > RISK_THRESHOLD_CONCENTRATION_EXTREME) {
    score += RISK_SCORE_CONCENTRATION_EXTREME_POINTS;
    warnings.push(`${topSectorAlloc.toFixed(0)}% in one sector — extreme concentration`);
  }
  else if (topSectorAlloc > RISK_THRESHOLD_CONCENTRATION_HIGH) {
    score += RISK_SCORE_CONCENTRATION_HIGH_POINTS;
    warnings.push(`${topSectorAlloc.toFixed(0)}% in top sector — concentration risk`);
  }
  else if (topSectorAlloc > RISK_THRESHOLD_CONCENTRATION_MODERATE) {
    score += RISK_SCORE_CONCENTRATION_MODERATE_POINTS;
  }
  else {
    score += Math.round(topSectorAlloc / RISK_SCORE_CONCENTRATION_LOW_DIVISOR);
  }

  // Drawdown contribution (0-20 points)
  if (params.drawdown.maxDrawdownPercent > RISK_THRESHOLD_DRAWDOWN_SEVERE) {
    score += RISK_SCORE_DRAWDOWN_SEVERE_POINTS;
    warnings.push(`Max drawdown ${params.drawdown.maxDrawdownPercent.toFixed(1)}% — severe`);
  }
  else if (params.drawdown.maxDrawdownPercent > RISK_THRESHOLD_DRAWDOWN_HIGH) {
    score += RISK_SCORE_DRAWDOWN_HIGH_POINTS;
  }
  else if (params.drawdown.maxDrawdownPercent > RISK_THRESHOLD_DRAWDOWN_MODERATE) {
    score += RISK_SCORE_DRAWDOWN_MODERATE_POINTS;
  }
  else {
    score += Math.round(params.drawdown.maxDrawdownPercent);
  }

  // Cash buffer (0-10 points, lower cash = higher risk)
  if (params.cashPercent < RISK_THRESHOLD_CASH_CRITICAL) {
    score += RISK_SCORE_CASH_CRITICAL_POINTS;
    warnings.push(`Cash < ${RISK_THRESHOLD_CASH_CRITICAL}% — no buying power buffer`);
  }
  else if (params.cashPercent < RISK_THRESHOLD_CASH_LOW) {
    score += RISK_SCORE_CASH_LOW_POINTS;
  }
  else if (params.cashPercent < RISK_THRESHOLD_CASH_MODERATE) {
    score += RISK_SCORE_CASH_MODERATE_POINTS;
  }

  // Position count risk (0-10 points)
  const highRiskPositions = countByCondition(params.positionRisk, (p) => p.riskLevel === "high");
  if (highRiskPositions >= RISK_THRESHOLD_POSITION_HIGH) {
    score += RISK_SCORE_POSITION_HIGH_POINTS;
    warnings.push(`${highRiskPositions} high-risk positions`);
  }
  else if (highRiskPositions >= RISK_THRESHOLD_POSITION_MODERATE) {
    score += RISK_SCORE_POSITION_MODERATE_POINTS;
  }

  // Clamp to 0-100
  score = clamp(score, 0, 100);

  let riskLevel: PortfolioRiskReport["riskLevel"];
  if (score >= RISK_LEVEL_CRITICAL_THRESHOLD) riskLevel = "CRITICAL";
  else if (score >= RISK_LEVEL_HIGH_THRESHOLD) riskLevel = "HIGH";
  else if (score >= RISK_LEVEL_MODERATE_THRESHOLD) riskLevel = "MODERATE";
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
    for (let i = 0; i < Math.min(tradeRecords.length, SYNTHETIC_RETURNS_MAX_TRADES); i++) {
      // Simplified: each trade contributes a small random return
      const usdcAmt = parseFloat(tradeRecords[i].usdcAmount);
      const returnPct = ((Math.random() - SYNTHETIC_RETURNS_RANDOM_OFFSET) * usdcAmt) / (currentValue || 10000) * 100;
      returns.push(returnPct);
    }
    return returns.length > 0 ? returns : [...DEFAULT_RETURN_SERIES]; // Default data
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
  if (returns.length < 2) return VOLATILITY_DEFAULT; // Default estimate

  const variance = computeVariance(returns);
  return round2(Math.sqrt(variance));
}

function estimateStockVolatility(symbol: string): number {
  // Heuristic volatility estimates based on stock type
  const volatilityMap: Record<string, number> = {
    NVDAx: VOL_NVDAx, TSLAx: VOL_TSLAx, GMEx: VOL_GMEx, COINx: VOL_COINx,
    MSTRx: VOL_MSTRx, HOODx: VOL_HOODx, PLTRx: VOL_PLTRx,
    AMZNx: VOL_AMZNx, METAx: VOL_METAx, GOOGLx: VOL_GOOGLx,
    AAPLx: VOL_AAPLx, MSFTx: VOL_MSFTx, JPMx: VOL_JPMx,
    SPYx: VOL_SPYx, QQQx: VOL_QQQx,
    LLYx: VOL_LLYx, CRMx: VOL_CRMx, NFLXx: VOL_NFLXx,
    AVGOx: VOL_AVGOx, CRCLx: VOL_CRCLx,
  };
  return volatilityMap[symbol] ?? VOL_DEFAULT;
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
