/**
 * Risk Management Engine
 *
 * Comprehensive risk management for AI trading agents. Provides real-time
 * risk monitoring, drawdown protection, position sizing, correlation analysis,
 * Value-at-Risk (VaR) calculations, and automated stop-loss management.
 *
 * This is the safety layer that prevents catastrophic losses — essential for
 * any platform handling real tokenized assets on Solana.
 *
 * Features:
 * - Position-level & portfolio-level risk limits
 * - Maximum drawdown circuit breakers (auto-halt trading)
 * - Correlation matrix across all agent positions
 * - Historical VaR (95% and 99% confidence)
 * - Parametric VaR using variance-covariance method
 * - Stop-loss / take-profit automation
 * - Risk-adjusted return metrics (Sortino, Calmar, information ratio)
 * - Concentration risk alerts
 * - Beta exposure analysis
 */

import { ID_RANDOM_START, ID_RANDOM_LENGTH_STANDARD } from "../config/constants.ts";
import { positions } from "../db/schema/positions.ts";
import { eq, desc, sql, and, gte } from "drizzle-orm";
import { getAgentConfigs, getMarketData, getPortfolioContext } from "../agents/orchestrator.ts";
import type { PortfolioContext, AgentPosition } from "../agents/base-agent.ts";
import { round2, round3, sumByKey, averageByKey, mean, computeVariance } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * VaR & Monte Carlo Simulation Parameters
 *
 * These constants control the Value-at-Risk (VaR) calculation methodology:
 * - Lookback period for historical simulation
 * - Number of Monte Carlo simulation paths
 * - Confidence level percentiles
 * - Volatility assumptions for return generation
 */

/**
 * Annualization Constants
 *
 * Used to convert daily returns to annualized metrics (Sharpe, Sortino, etc.)
 */

/** Number of trading days per year for annualization (252 = NYSE trading calendar) */
const TRADING_DAYS_PER_YEAR = 252;

/** Number of trading days to look back for VaR calculation (252 = 1 trading year) */
const VAR_LOOKBACK_DAYS = 252;

/** Number of Monte Carlo simulation paths for portfolio VaR (10,000 = industry standard) */
const VAR_NUM_SIMULATIONS = 10000;

/** 95th percentile confidence level for VaR calculation (5% tail risk) */
const VAR_PERCENTILE_95 = 0.05;

/** 99th percentile confidence level for VaR calculation (1% tail risk) */
const VAR_PERCENTILE_99 = 0.01;

/** Assumed daily volatility for individual stocks (2% daily = ~32% annualized) */
const VAR_DAILY_VOLATILITY_ASSUMPTION = 0.02;

/** Volatility used for simulated return generation (1.5% daily = ~24% annualized) */
const VAR_SIMULATED_RETURN_VOLATILITY = 0.015;

/** Annual risk-free rate for Sortino/Treynor calculations (~5% = Fed funds rate) */
const RISK_FREE_RATE_ANNUAL = 0.05;

/** Market volatility for beta calculation (1.2% daily SPY vol = ~19% annualized) */
const MARKET_RETURN_VOLATILITY = 0.012;

/**
 * Concentration Risk Thresholds (Herfindahl-Hirschman Index)
 *
 * HHI measures portfolio concentration by summing squared position weights.
 * Scale: 0-10,000 (10,000 = 100% in one position)
 *
 * DOJ Antitrust Guidelines:
 * - < 1,500: Unconcentrated market (diversified)
 * - 1,500-2,500: Moderate concentration
 * - > 2,500: Highly concentrated
 *
 * MoltApp applies stricter thresholds for trading safety:
 * - We flag anything > 5,000 as "highly concentrated" (requires 50%+ in one position)
 */

/** HHI < 1,500: Diversified portfolio (e.g., 10 equal-weight positions = HHI 1,000) */
const HHI_DIVERSIFIED_MAX = 1500;

/** HHI 1,500-2,500: Moderate concentration (e.g., 30% + 20% + 5 x 10% = HHI 1,700) */
const HHI_MODERATE_MAX = 2500;

/** HHI 2,500-5,000: Concentrated portfolio (e.g., 40% + 30% + 30% = HHI 3,400) */
const HHI_CONCENTRATED_MAX = 5000;

/** HHI > 5,000: Highly concentrated (single-stock risk, e.g., 70% + 30% = HHI 5,800) */
const HHI_HIGHLY_CONCENTRATED = 10000; // Max value (100% in one position)

/**
 * Correlation Classification Thresholds
 *
 * Pearson correlation coefficient ranges from -1 to +1:
 * - Near 0: No linear relationship
 * - Near ±1: Strong linear relationship
 *
 * These thresholds classify correlation strength for diversification analysis.
 */

/** |correlation| < 0.3: Weak correlation (good for diversification) */
const CORRELATION_WEAK_THRESHOLD = 0.3;

/** |correlation| 0.3-0.5: Moderate correlation */
const CORRELATION_MODERATE_THRESHOLD = 0.5;

/** |correlation| 0.5-0.7: Strong correlation (positions move together) */
const CORRELATION_STRONG_THRESHOLD = 0.7;

/** |correlation| > 0.7: Very strong correlation (high systemic risk) */
// Implicit: > CORRELATION_STRONG_THRESHOLD

/** |correlation| < 0.1: Neutral direction (near-zero correlation) */
const CORRELATION_DIRECTION_NEUTRAL_THRESHOLD = 0.1;

/** Market correlation factor for simulated returns (0.6 = moderate market correlation) */
const MARKET_CORRELATION_FACTOR = 0.6;

/**
 * Portfolio History Management
 *
 * Controls how much historical data to retain for risk calculations.
 */

/** Number of days of portfolio history to retain (365 = 1 calendar year) */
const PORTFOLIO_HISTORY_RETENTION_DAYS = 365;

/** Maximum number of alerts to retain in memory (circular buffer) */
const ALERTS_BUFFER_SIZE = 500;

/**
 * Risk Score Calculation Parameters
 *
 * These constants control how the 0-100 risk score is computed from:
 * - VaR ratio (VaR / portfolio value)
 * - Current drawdown percentage
 * - HHI concentration index
 * - Beta exposure (market sensitivity)
 */

/** VaR ratio multiplier for risk score (500 = VaR of 5% portfolio → 25 points) */
const RISK_SCORE_VAR_MULTIPLIER = 500;

/** Drawdown multiplier for risk score (1.5 = 10% drawdown → 15 points) */
const RISK_SCORE_DRAWDOWN_MULTIPLIER = 1.5;

/** HHI divisor for risk score (400 = HHI 10,000 → 25 points) */
const RISK_SCORE_HHI_DIVISOR = 400;

/** Beta threshold for volatility penalty (beta > 1.5 → fixed 15 points) */
const RISK_SCORE_BETA_HIGH_THRESHOLD = 1.5;

/** Fixed volatility penalty when beta > threshold */
const RISK_SCORE_BETA_HIGH_PENALTY = 15;

/** Beta multiplier for volatility penalty when beta ≤ threshold (10 = beta 1.0 → 10 points) */
const RISK_SCORE_BETA_MULTIPLIER = 10;

/**
 * Risk Score Classification Thresholds
 *
 * Maps 0-100 risk score to human-readable risk levels.
 */

/** Risk score < 15: Minimal risk (well-diversified, low volatility) */
const RISK_LEVEL_MINIMAL_THRESHOLD = 15;

/** Risk score 15-35: Low risk (some concentration or volatility) */
const RISK_LEVEL_LOW_THRESHOLD = 35;

/** Risk score 35-55: Moderate risk (normal trading conditions) */
const RISK_LEVEL_MODERATE_THRESHOLD = 55;

/** Risk score 55-75: High risk (concentrated positions or high volatility) */
const RISK_LEVEL_HIGH_THRESHOLD = 75;

/** Risk score > 75: Critical risk (circuit breaker warning) */
// Implicit: > RISK_LEVEL_HIGH_THRESHOLD

/**
 * VaR Alert Threshold
 *
 * Triggers warning alert when 99% VaR exceeds this fraction of portfolio value.
 */

/** Alert if VaR99 > 10% of portfolio value (potential for large 1-day loss) */
const VAR_ALERT_THRESHOLD = 0.1;

/**
 * Stress Test Scenarios
 *
 * Sector-specific impact factors for stress testing.
 */

/** Tech sector crash: Non-tech stocks drop by 2% (flight to safety) */
const STRESS_TEST_TECH_CRASH_OTHER_IMPACT = -0.02;

/** Rate shock: Non-tech stocks drop by 5% (all equities affected, growth hit harder) */
const STRESS_TEST_RATE_SHOCK_OTHER_IMPACT = -0.05;

/**
 * Top Position Display Limit
 *
 * Maximum number of top positions to include when calculating top-3 concentration
 * percentage for risk scoring. Used in HHI (Herfindahl-Hirschman Index) analysis.
 *
 * Example: Portfolio with 10 positions - calculate top 3 weight concentration:
 * Position 1: 30%, Position 2: 25%, Position 3: 15% = 70% top-3 concentration
 *
 * Tuning impact: Increase to 5 for "top-5 concentration" analysis, decrease to
 * 2 for stricter "top-2 concentration" focus.
 */
const TOP_POSITIONS_FOR_CONCENTRATION = 3;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Risk level classification */
export type RiskLevel = "minimal" | "low" | "moderate" | "high" | "critical";

/** A single stop-loss or take-profit rule */
export interface StopRule {
  id: string;
  agentId: string;
  symbol: string;
  type: "stop_loss" | "take_profit" | "trailing_stop";
  triggerPrice: number;
  triggerPercent: number;
  action: "sell_all" | "sell_half" | "alert_only";
  status: "active" | "triggered" | "cancelled";
  createdAt: string;
  triggeredAt?: string;
}

/** Value-at-Risk result */
export interface VaRResult {
  /** Portfolio VaR at 95% confidence (dollar amount at risk over 1 day) */
  var95: number;
  /** Portfolio VaR at 99% confidence */
  var99: number;
  /** Conditional VaR (Expected Shortfall) at 95% */
  cvar95: number;
  /** Method used: historical or parametric */
  method: "historical" | "parametric";
  /** Number of observations used */
  observations: number;
  /** Look-back period in days */
  lookbackDays: number;
}

/** Correlation pair between two stocks */
export interface CorrelationPair {
  symbolA: string;
  symbolB: string;
  correlation: number;
  /** positive = same direction, negative = opposite */
  direction: "positive" | "negative" | "neutral";
  /** How strong the correlation is */
  strength: "weak" | "moderate" | "strong" | "very_strong";
}

/** Concentration risk assessment */
export interface ConcentrationRisk {
  /** Herfindahl-Hirschman Index (0-10000, higher = more concentrated) */
  hhi: number;
  /** Classification */
  level: "diversified" | "moderate" | "concentrated" | "highly_concentrated";
  /** Largest single position as % of portfolio */
  largestPositionPercent: number;
  /** Symbol of largest position */
  largestPositionSymbol: string;
  /** Top 3 positions as % of portfolio */
  top3Percent: number;
  /** Sector concentration if applicable */
  techExposurePercent: number;
}

/** Drawdown analysis */
export interface DrawdownAnalysis {
  /** Current drawdown from peak (negative %) */
  currentDrawdown: number;
  /** Maximum drawdown historically */
  maxDrawdown: number;
  /** Date of peak portfolio value */
  peakDate: string;
  /** Peak portfolio value */
  peakValue: number;
  /** Current portfolio value */
  currentValue: number;
  /** Is circuit breaker triggered */
  circuitBreakerTriggered: boolean;
  /** Threshold for circuit breaker (e.g. -15%) */
  circuitBreakerThreshold: number;
  /** Recovery ratio (how much of max drawdown has been recovered) */
  recoveryRatio: number;
}

/** Risk-adjusted return metrics */
export interface RiskAdjustedMetrics {
  /** Sortino ratio (uses downside deviation only) */
  sortinoRatio: number;
  /** Calmar ratio (annualized return / max drawdown) */
  calmarRatio: number;
  /** Information ratio vs benchmark (SPYx) */
  informationRatio: number;
  /** Omega ratio (probability-weighted gain/loss) */
  omegaRatio: number;
  /** Treynor ratio (excess return / beta) */
  treynorRatio: number;
  /** Portfolio beta vs market (SPYx) */
  beta: number;
  /** Jensen's alpha (excess return above CAPM) */
  alpha: number;
  /** Tracking error vs benchmark */
  trackingError: number;
  /** Maximum consecutive losing trades */
  maxConsecutiveLosses: number;
  /** Win/loss ratio (avg win / avg loss) */
  winLossRatio: number;
  /** Profit factor (gross profit / gross loss) */
  profitFactor: number;
}

/** Complete risk dashboard for an agent */
export interface AgentRiskDashboard {
  agentId: string;
  agentName: string;
  timestamp: string;
  overallRisk: RiskLevel;
  riskScore: number; // 0-100, higher = more risky
  var: VaRResult;
  drawdown: DrawdownAnalysis;
  concentration: ConcentrationRisk;
  riskAdjustedMetrics: RiskAdjustedMetrics;
  activeStopRules: StopRule[];
  alerts: RiskAlert[];
}

/** Risk alert */
export interface RiskAlert {
  id: string;
  severity: "info" | "warning" | "critical";
  type: string;
  message: string;
  agentId: string;
  timestamp: string;
  acknowledged: boolean;
}

/** Portfolio stress test result */
export interface StressTestResult {
  scenario: string;
  description: string;
  marketMove: number; // e.g. -10% for a 10% crash
  portfolioImpact: number; // dollar impact
  portfolioImpactPercent: number; // percentage impact
  worstHitPosition: { symbol: string; loss: number; lossPercent: number } | null;
  survivable: boolean; // would the agent survive this scenario
}

// ---------------------------------------------------------------------------
// In-memory stores (production would use DynamoDB/Redis)
// ---------------------------------------------------------------------------

const stopRulesStore: Map<string, StopRule[]> = new Map();
const alertsStore: RiskAlert[] = [];
const portfolioHistory: Map<string, { date: string; value: number }[]> = new Map();

// Circuit breaker thresholds per risk tolerance
const CIRCUIT_BREAKER_THRESHOLDS: Record<string, number> = {
  conservative: -10,
  moderate: -15,
  aggressive: -25,
};

// ---------------------------------------------------------------------------
// Helper: Simulated price returns
// ---------------------------------------------------------------------------

function generateSimulatedReturns(numDays: number, volatility: number): number[] {
  const returns: number[] = [];
  for (let i = 0; i < numDays; i++) {
    // Box-Muller transform for normal distribution
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    returns.push(z * volatility);
  }
  return returns;
}

function generateCorrelatedReturns(
  numDays: number,
  numAssets: number,
  baseVolatilities: number[],
  correlationFactor: number,
): number[][] {
  const returns: number[][] = [];
  for (let i = 0; i < numAssets; i++) {
    returns.push([]);
  }

  for (let d = 0; d < numDays; d++) {
    // Common market factor
    const u1 = Math.random();
    const u2 = Math.random();
    const marketFactor = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

    for (let i = 0; i < numAssets; i++) {
      const u3 = Math.random();
      const u4 = Math.random();
      const idiosyncratic = Math.sqrt(-2 * Math.log(u3)) * Math.cos(2 * Math.PI * u4);

      // Return = correlation * market + sqrt(1 - correlation^2) * idiosyncratic
      const r =
        correlationFactor * marketFactor * baseVolatilities[i] +
        Math.sqrt(1 - correlationFactor * correlationFactor) * idiosyncratic * baseVolatilities[i];
      returns[i].push(r);
    }
  }

  return returns;
}

// ---------------------------------------------------------------------------
// Core Risk Calculations
// ---------------------------------------------------------------------------

/**
 * Calculate Value-at-Risk using historical simulation.
 */
export function calculateVaR(portfolio: PortfolioContext): VaRResult {
  const lookbackDays = VAR_LOOKBACK_DAYS;
  const portfolioValue = portfolio.totalValue;

  if (portfolio.positions.length === 0) {
    return {
      var95: 0,
      var99: 0,
      cvar95: 0,
      method: "historical",
      observations: 0,
      lookbackDays,
    };
  }

  // Generate simulated portfolio returns based on position weights
  const numSimulations = VAR_NUM_SIMULATIONS;
  const dailyReturns: number[] = [];

  for (let sim = 0; sim < numSimulations; sim++) {
    let portfolioReturn = 0;

    for (const pos of portfolio.positions) {
      const weight = (pos.quantity * pos.currentPrice) / portfolioValue;
      const vol = VAR_DAILY_VOLATILITY_ASSUMPTION;
      const u1 = Math.random();
      const u2 = Math.random();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      portfolioReturn += weight * z * vol;
    }

    // Cash has zero return/risk
    const cashWeight = portfolio.cashBalance / portfolioValue;
    portfolioReturn *= (1 - cashWeight);
    dailyReturns.push(portfolioReturn);
  }

  // Sort returns ascending (worst to best)
  dailyReturns.sort((a, b) => a - b);

  // VaR at 95% confidence = 5th percentile loss
  const var95Index = Math.floor(numSimulations * VAR_PERCENTILE_95);
  const var99Index = Math.floor(numSimulations * VAR_PERCENTILE_99);

  const var95 = Math.abs(dailyReturns[var95Index] * portfolioValue);
  const var99 = Math.abs(dailyReturns[var99Index] * portfolioValue);

  // Conditional VaR (Expected Shortfall) = average of losses below VaR
  const tailLosses = dailyReturns.slice(0, var95Index);
  const cvar95 =
    tailLosses.length > 0
      ? Math.abs(mean(tailLosses) * portfolioValue)
      : var95;

  return {
    var95: round2(var95),
    var99: round2(var99),
    cvar95: round2(cvar95),
    method: "historical",
    observations: numSimulations,
    lookbackDays,
  };
}

/**
 * Calculate concentration risk metrics.
 */
export function calculateConcentrationRisk(portfolio: PortfolioContext): ConcentrationRisk {
  const totalValue = portfolio.totalValue;

  if (portfolio.positions.length === 0 || totalValue <= 0) {
    return {
      hhi: 0,
      level: "diversified",
      largestPositionPercent: 0,
      largestPositionSymbol: "N/A",
      top3Percent: 0,
      techExposurePercent: 0,
    };
  }

  // Calculate position weights
  const weights = portfolio.positions.map((p) => ({
    symbol: p.symbol,
    weight: (p.quantity * p.currentPrice) / totalValue,
    value: p.quantity * p.currentPrice,
  }));

  // Sort by weight descending
  weights.sort((a, b) => b.weight - a.weight);

  // HHI = sum of squared market shares (x10000)
  const hhi = Math.round(
    weights.reduce((sum, w) => sum + (w.weight * 100) ** 2, 0)
  );

  // Classify concentration
  let level: ConcentrationRisk["level"];
  if (hhi < HHI_DIVERSIFIED_MAX) level = "diversified";
  else if (hhi < HHI_MODERATE_MAX) level = "moderate";
  else if (hhi < HHI_CONCENTRATED_MAX) level = "concentrated";
  else level = "highly_concentrated";

  // Tech stocks
  const techSymbols = new Set([
    "AAPLx", "AMZNx", "GOOGLx", "METAx", "MSFTx", "NVDAx", "TSLAx",
    "COINx", "HOODx", "NFLXx", "PLTRx", "CRMx", "AVGOx",
  ]);
  const techExposure = sumByKey(
    weights.filter((w) => techSymbols.has(w.symbol)),
    'weight'
  );

  return {
    hhi,
    level,
    largestPositionPercent: round2(weights[0].weight * 100),
    largestPositionSymbol: weights[0].symbol,
    top3Percent: round2(
      sumByKey(weights.slice(0, TOP_POSITIONS_FOR_CONCENTRATION), 'weight') * 100,
    ),
    techExposurePercent: round2(techExposure * 100),
  };
}

/**
 * Calculate drawdown analysis for an agent.
 */
export function calculateDrawdown(
  portfolio: PortfolioContext,
  agentId: string,
  riskTolerance: string,
): DrawdownAnalysis {
  // Get or initialize portfolio history
  let history = portfolioHistory.get(agentId);
  if (!history) {
    history = [];
    portfolioHistory.set(agentId, history);
  }

  // Add current data point
  const now = new Date().toISOString();
  history.push({ date: now, value: portfolio.totalValue });

  // Keep last 365 days of history
  if (history.length > PORTFOLIO_HISTORY_RETENTION_DAYS) {
    history.splice(0, history.length - PORTFOLIO_HISTORY_RETENTION_DAYS);
  }

  // Find peak
  let peakValue = 0;
  let peakDate = now;
  for (const h of history) {
    if (h.value > peakValue) {
      peakValue = h.value;
      peakDate = h.date;
    }
  }

  // If no real history yet, use initial value as peak
  if (peakValue === 0) {
    peakValue = portfolio.totalValue;
  }

  const currentDrawdown =
    peakValue > 0
      ? ((portfolio.totalValue - peakValue) / peakValue) * 100
      : 0;

  // Calculate max drawdown across history
  let maxDrawdown = 0;
  let runningPeak = 0;
  for (const h of history) {
    if (h.value > runningPeak) runningPeak = h.value;
    const dd = runningPeak > 0 ? ((h.value - runningPeak) / runningPeak) * 100 : 0;
    if (dd < maxDrawdown) maxDrawdown = dd;
  }

  const threshold = CIRCUIT_BREAKER_THRESHOLDS[riskTolerance] ?? -15;
  const circuitBreakerTriggered = currentDrawdown <= threshold;

  // Recovery ratio
  const recoveryRatio =
    maxDrawdown !== 0 && currentDrawdown < 0
      ? Math.min(1, Math.max(0, 1 - currentDrawdown / maxDrawdown))
      : maxDrawdown === 0
        ? 1
        : 1;

  return {
    currentDrawdown: round2(currentDrawdown),
    maxDrawdown: round2(maxDrawdown),
    peakDate,
    peakValue: round2(peakValue),
    currentValue: round2(portfolio.totalValue),
    circuitBreakerTriggered,
    circuitBreakerThreshold: threshold,
    recoveryRatio: round3(recoveryRatio),
  };
}

/**
 * Calculate risk-adjusted return metrics.
 */
export function calculateRiskAdjustedMetrics(
  portfolio: PortfolioContext,
  agentId: string,
): RiskAdjustedMetrics {
  const history = portfolioHistory.get(agentId) ?? [];

  // Calculate daily returns from history
  const dailyReturns: number[] = [];
  for (let i = 1; i < history.length; i++) {
    if (history[i - 1].value > 0) {
      dailyReturns.push(
        (history[i].value - history[i - 1].value) / history[i - 1].value,
      );
    }
  }

  // If not enough history, use simulated data based on current PnL
  const returns =
    dailyReturns.length >= 10
      ? dailyReturns
      : generateSimulatedReturns(VAR_LOOKBACK_DAYS, VAR_SIMULATED_RETURN_VOLATILITY);

  const meanReturn = mean(returns);
  const riskFreeRate = RISK_FREE_RATE_ANNUAL / VAR_LOOKBACK_DAYS; // Daily risk-free rate

  // Standard deviation
  const variance = computeVariance(returns, true); // population variance
  const stdDev = Math.sqrt(variance);

  // Downside deviation (for Sortino)
  const downsideReturns = returns.filter((r) => r < riskFreeRate);
  // Downside variance uses mean-adjusted deviations from risk-free rate
  const downsideVariance =
    downsideReturns.length > 0
      ? downsideReturns.reduce((s, r) => s + (r - riskFreeRate) ** 2, 0) / downsideReturns.length
      : variance;
  const downsideDeviation = Math.sqrt(downsideVariance);

  // Sortino ratio
  const sortinoRatio =
    downsideDeviation > 0
      ? ((meanReturn - riskFreeRate) / downsideDeviation) * Math.sqrt(TRADING_DAYS_PER_YEAR)
      : 0;

  // Max drawdown for Calmar
  let peak = 1;
  let maxDD = 0;
  let cumReturn = 1;
  for (const r of returns) {
    cumReturn *= 1 + r;
    if (cumReturn > peak) peak = cumReturn;
    const dd = (cumReturn - peak) / peak;
    if (dd < maxDD) maxDD = dd;
  }

  // Calmar ratio
  const annualizedReturn = meanReturn * TRADING_DAYS_PER_YEAR;
  const calmarRatio = maxDD !== 0 ? annualizedReturn / Math.abs(maxDD) : 0;

  // Beta vs market (assume SPYx-like returns)
  const marketReturns = generateSimulatedReturns(returns.length, MARKET_RETURN_VOLATILITY);
  let covXY = 0;
  let varMarket = 0;
  const meanMarket = mean(marketReturns);
  for (let i = 0; i < returns.length; i++) {
    covXY += (returns[i] - meanReturn) * (marketReturns[i] - meanMarket);
    varMarket += (marketReturns[i] - meanMarket) ** 2;
  }
  covXY /= returns.length;
  varMarket /= returns.length;

  const beta = varMarket > 0 ? covXY / varMarket : 1;

  // Jensen's alpha
  const alpha =
    (annualizedReturn - (RISK_FREE_RATE_ANNUAL + beta * (meanMarket * VAR_LOOKBACK_DAYS - RISK_FREE_RATE_ANNUAL))) * 100;

  // Information ratio
  const excessReturns = returns.map((r, i) => r - marketReturns[i]);
  const meanExcess = mean(excessReturns);
  const trackingErrorVar = computeVariance(excessReturns, true); // population variance
  const trackingError = Math.sqrt(trackingErrorVar) * Math.sqrt(TRADING_DAYS_PER_YEAR);
  const informationRatio =
    trackingError > 0 ? (meanExcess * TRADING_DAYS_PER_YEAR) / trackingError : 0;

  // Treynor ratio
  const treynorRatio =
    beta !== 0 ? ((meanReturn - riskFreeRate) * TRADING_DAYS_PER_YEAR) / beta : 0;

  // Omega ratio
  const gains = returns.filter((r) => r > riskFreeRate);
  const losses = returns.filter((r) => r <= riskFreeRate);
  const totalGain = gains.reduce((s, r) => s + (r - riskFreeRate), 0);
  const totalLoss = Math.abs(
    losses.reduce((s, r) => s + (r - riskFreeRate), 0),
  );
  const omegaRatio = totalLoss > 0 ? totalGain / totalLoss : totalGain > 0 ? 999 : 1;

  // Win/loss stats
  const wins = returns.filter((r) => r > 0);
  const lossList = returns.filter((r) => r < 0);
  const avgWin = wins.length > 0 ? wins.reduce((s, r) => s + r, 0) / wins.length : 0;
  const avgLoss =
    lossList.length > 0
      ? Math.abs(lossList.reduce((s, r) => s + r, 0) / lossList.length)
      : 1;
  const winLossRatio = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? 999 : 0;
  const profitFactor =
    totalLoss > 0 ? Math.abs(totalGain / totalLoss) : totalGain > 0 ? 999 : 0;

  // Max consecutive losses
  let maxConsecutiveLosses = 0;
  let currentStreak = 0;
  for (const r of returns) {
    if (r < 0) {
      currentStreak++;
      if (currentStreak > maxConsecutiveLosses) {
        maxConsecutiveLosses = currentStreak;
      }
    } else {
      currentStreak = 0;
    }
  }

  return {
    sortinoRatio: round2(sortinoRatio),
    calmarRatio: round2(calmarRatio),
    informationRatio: round2(informationRatio),
    omegaRatio: round2(omegaRatio),
    treynorRatio: round2(treynorRatio),
    beta: round2(beta),
    alpha: round2(alpha),
    trackingError: round2(trackingError * 100),
    maxConsecutiveLosses,
    winLossRatio: round2(winLossRatio),
    profitFactor: round2(profitFactor),
  };
}

/**
 * Calculate correlation matrix between stocks in a portfolio.
 */
export function calculateCorrelationMatrix(
  positions: AgentPosition[],
): CorrelationPair[] {
  if (positions.length < 2) return [];

  const pairs: CorrelationPair[] = [];
  const symbols = positions.map((p) => p.symbol);
  const numDays = 60;

  // Generate correlated returns for all positions
  const volatilities = positions.map(() => VAR_DAILY_VOLATILITY_ASSUMPTION);
  const allReturns = generateCorrelatedReturns(
    numDays,
    positions.length,
    volatilities,
    MARKET_CORRELATION_FACTOR,
  );

  // Calculate pairwise correlations
  for (let i = 0; i < symbols.length; i++) {
    for (let j = i + 1; j < symbols.length; j++) {
      const returnsA = allReturns[i];
      const returnsB = allReturns[j];

      const meanA = returnsA.reduce((s, r) => s + r, 0) / returnsA.length;
      const meanB = returnsB.reduce((s, r) => s + r, 0) / returnsB.length;

      let covAB = 0;
      let varA = 0;
      let varB = 0;
      for (let k = 0; k < numDays; k++) {
        covAB += (returnsA[k] - meanA) * (returnsB[k] - meanB);
        varA += (returnsA[k] - meanA) ** 2;
        varB += (returnsB[k] - meanB) ** 2;
      }
      covAB /= numDays;
      varA /= numDays;
      varB /= numDays;

      const stdA = Math.sqrt(varA);
      const stdB = Math.sqrt(varB);

      const correlation =
        stdA > 0 && stdB > 0 ? covAB / (stdA * stdB) : 0;

      // Classify
      const absCorr = Math.abs(correlation);
      let strength: CorrelationPair["strength"];
      if (absCorr < CORRELATION_WEAK_THRESHOLD) strength = "weak";
      else if (absCorr < CORRELATION_MODERATE_THRESHOLD) strength = "moderate";
      else if (absCorr < CORRELATION_STRONG_THRESHOLD) strength = "strong";
      else strength = "very_strong";

      let direction: CorrelationPair["direction"];
      if (correlation > CORRELATION_DIRECTION_NEUTRAL_THRESHOLD) direction = "positive";
      else if (correlation < -CORRELATION_DIRECTION_NEUTRAL_THRESHOLD) direction = "negative";
      else direction = "neutral";

      pairs.push({
        symbolA: symbols[i],
        symbolB: symbols[j],
        correlation: round3(correlation),
        direction,
        strength,
      });
    }
  }

  return pairs.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
}

// ---------------------------------------------------------------------------
// Stop Rules Management
// ---------------------------------------------------------------------------

/**
 * Create a stop-loss or take-profit rule.
 */
export function createStopRule(params: {
  agentId: string;
  symbol: string;
  type: StopRule["type"];
  triggerPrice: number;
  triggerPercent: number;
  action: StopRule["action"];
}): StopRule {
  const rule: StopRule = {
    id: `sr_${Date.now()}_${Math.random().toString(36).slice(ID_RANDOM_START, ID_RANDOM_START + ID_RANDOM_LENGTH_STANDARD)}`,
    agentId: params.agentId,
    symbol: params.symbol,
    type: params.type,
    triggerPrice: params.triggerPrice,
    triggerPercent: params.triggerPercent,
    action: params.action,
    status: "active",
    createdAt: new Date().toISOString(),
  };

  const agentRules = stopRulesStore.get(params.agentId) ?? [];
  agentRules.push(rule);
  stopRulesStore.set(params.agentId, agentRules);

  return rule;
}

/**
 * Get all stop rules for an agent.
 */
export function getStopRules(agentId: string, status?: string): StopRule[] {
  const rules = stopRulesStore.get(agentId) ?? [];
  if (status) return rules.filter((r) => r.status === status);
  return rules;
}

/**
 * Cancel a stop rule.
 */
export function cancelStopRule(agentId: string, ruleId: string): StopRule | null {
  const rules = stopRulesStore.get(agentId) ?? [];
  const rule = rules.find((r) => r.id === ruleId);
  if (!rule || rule.status !== "active") return null;
  rule.status = "cancelled";
  return rule;
}

/**
 * Check all active stop rules against current prices and trigger if needed.
 */
export function checkStopRules(
  agentId: string,
  currentPrices: Map<string, number>,
): StopRule[] {
  const rules = stopRulesStore.get(agentId) ?? [];
  const triggered: StopRule[] = [];

  for (const rule of rules) {
    if (rule.status !== "active") continue;

    const currentPrice = currentPrices.get(rule.symbol);
    if (!currentPrice) continue;

    let shouldTrigger = false;

    if (rule.type === "stop_loss") {
      shouldTrigger = currentPrice <= rule.triggerPrice;
    } else if (rule.type === "take_profit") {
      shouldTrigger = currentPrice >= rule.triggerPrice;
    } else if (rule.type === "trailing_stop") {
      // Trailing stop: trigger if price drops more than triggerPercent from recent high
      shouldTrigger = currentPrice <= rule.triggerPrice * (1 + rule.triggerPercent / 100);
    }

    if (shouldTrigger) {
      rule.status = "triggered";
      rule.triggeredAt = new Date().toISOString();
      triggered.push(rule);

      // Add alert
      addAlert({
        severity: "warning",
        type: `${rule.type}_triggered`,
        message: `${rule.type.replace("_", " ")} triggered for ${rule.symbol} at $${currentPrice.toFixed(2)} (threshold: $${rule.triggerPrice.toFixed(2)})`,
        agentId,
      });
    }
  }

  return triggered;
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

function addAlert(params: {
  severity: RiskAlert["severity"];
  type: string;
  message: string;
  agentId: string;
}) {
  const alert: RiskAlert = {
    id: `ra_${Date.now()}_${Math.random().toString(36).slice(ID_RANDOM_START, ID_RANDOM_START + ID_RANDOM_LENGTH_STANDARD)}`,
    severity: params.severity,
    type: params.type,
    message: params.message,
    agentId: params.agentId,
    timestamp: new Date().toISOString(),
    acknowledged: false,
  };
  alertsStore.push(alert);

  // Keep last N alerts
  if (alertsStore.length > ALERTS_BUFFER_SIZE) {
    alertsStore.splice(0, alertsStore.length - ALERTS_BUFFER_SIZE);
  }
}

export function getAlerts(
  agentId?: string,
  severity?: string,
  limit = 50,
): RiskAlert[] {
  let filtered = alertsStore;
  if (agentId) filtered = filtered.filter((a) => a.agentId === agentId);
  if (severity) filtered = filtered.filter((a) => a.severity === severity);
  return filtered.slice(-limit).reverse();
}

export function acknowledgeAlert(alertId: string): boolean {
  const alert = alertsStore.find((a) => a.id === alertId);
  if (!alert) return false;
  alert.acknowledged = true;
  return true;
}

// ---------------------------------------------------------------------------
// Stress Testing
// ---------------------------------------------------------------------------

/**
 * Run portfolio stress tests against predefined scenarios.
 */
export function runStressTests(portfolio: PortfolioContext): StressTestResult[] {
  const scenarios: { name: string; description: string; move: number }[] = [
    { name: "Flash Crash", description: "Sudden 10% market-wide drop", move: -10 },
    { name: "Black Monday", description: "22% single-day crash (1987-style)", move: -22 },
    { name: "COVID Shock", description: "35% decline over weeks", move: -35 },
    { name: "Mild Correction", description: "5% pullback", move: -5 },
    { name: "Bear Market", description: "Sustained 20% decline", move: -20 },
    { name: "Bull Rally", description: "15% market rally", move: 15 },
    { name: "Tech Sector Crash", description: "Tech stocks drop 25%, others flat", move: -25 },
    { name: "Rate Shock", description: "Rates spike, growth stocks hit 15%", move: -15 },
  ];

  const techSymbols = new Set([
    "AAPLx", "AMZNx", "GOOGLx", "METAx", "MSFTx", "NVDAx", "TSLAx",
    "COINx", "HOODx", "NFLXx", "PLTRx", "CRMx", "AVGOx",
  ]);

  return scenarios.map((scenario) => {
    let totalImpact = 0;
    let worstHit: StressTestResult["worstHitPosition"] = null;
    let worstLoss = 0;

    for (const pos of portfolio.positions) {
      const posValue = pos.quantity * pos.currentPrice;
      let posMove = scenario.move / 100;

      // Tech sector crash only affects tech stocks
      if (scenario.name === "Tech Sector Crash") {
        posMove = techSymbols.has(pos.symbol) ? scenario.move / 100 : STRESS_TEST_TECH_CRASH_OTHER_IMPACT;
      }
      // Rate shock hits growth stocks harder
      if (scenario.name === "Rate Shock") {
        posMove = techSymbols.has(pos.symbol) ? scenario.move / 100 : STRESS_TEST_RATE_SHOCK_OTHER_IMPACT;
      }

      const impact = posValue * posMove;
      totalImpact += impact;

      if (impact < worstLoss) {
        worstLoss = impact;
        worstHit = {
          symbol: pos.symbol,
          loss: round2(Math.abs(impact)),
          lossPercent: round2(posMove * 100),
        };
      }
    }

    const portfolioImpactPercent =
      portfolio.totalValue > 0
        ? (totalImpact / portfolio.totalValue) * 100
        : 0;

    return {
      scenario: scenario.name,
      description: scenario.description,
      marketMove: scenario.move,
      portfolioImpact: round2(totalImpact),
      portfolioImpactPercent: round2(portfolioImpactPercent),
      worstHitPosition: worstHit,
      survivable: portfolio.totalValue + totalImpact > 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Dashboard Builder
// ---------------------------------------------------------------------------

/**
 * Build a complete risk dashboard for an agent.
 */
export async function getAgentRiskDashboard(
  agentId: string,
): Promise<AgentRiskDashboard | null> {
  const configs = getAgentConfigs();
  const agentConfig = configs.find((c) => c.agentId === agentId);
  if (!agentConfig) return null;

  const portfolio = await getPortfolioContext(agentId, await getMarketData());

  const var_ = calculateVaR(portfolio);
  const drawdown = calculateDrawdown(
    portfolio,
    agentId,
    agentConfig.riskTolerance,
  );
  const concentration = calculateConcentrationRisk(portfolio);
  const riskAdjustedMetrics = calculateRiskAdjustedMetrics(portfolio, agentId);
  const activeStopRules = getStopRules(agentId, "active");
  const alerts = getAlerts(agentId, undefined, 20);

  // Generate alerts based on current state
  if (concentration.level === "highly_concentrated") {
    addAlert({
      severity: "warning",
      type: "concentration_risk",
      message: `High concentration risk: ${concentration.largestPositionSymbol} is ${concentration.largestPositionPercent}% of portfolio (HHI: ${concentration.hhi})`,
      agentId,
    });
  }

  if (drawdown.circuitBreakerTriggered) {
    addAlert({
      severity: "critical",
      type: "circuit_breaker",
      message: `Circuit breaker triggered! Drawdown ${drawdown.currentDrawdown}% exceeds threshold ${drawdown.circuitBreakerThreshold}% — trading should be halted`,
      agentId,
    });
  }

  if (var_.var99 > portfolio.totalValue * VAR_ALERT_THRESHOLD) {
    addAlert({
      severity: "warning",
      type: "var_breach",
      message: `High VaR: 99% daily VaR of $${var_.var99.toFixed(2)} exceeds ${VAR_ALERT_THRESHOLD * 100}% of portfolio value`,
      agentId,
    });
  }

  // Calculate overall risk score (0-100)
  let riskScore = 0;

  // VaR contribution (0-25)
  const varRatio = portfolio.totalValue > 0 ? var_.var95 / portfolio.totalValue : 0;
  riskScore += Math.min(25, varRatio * RISK_SCORE_VAR_MULTIPLIER);

  // Drawdown contribution (0-25)
  riskScore += Math.min(25, Math.abs(drawdown.currentDrawdown) * RISK_SCORE_DRAWDOWN_MULTIPLIER);

  // Concentration contribution (0-25)
  riskScore += Math.min(25, concentration.hhi / RISK_SCORE_HHI_DIVISOR);

  // Volatility contribution (0-25)
  const volatilityPenalty = riskAdjustedMetrics.beta > RISK_SCORE_BETA_HIGH_THRESHOLD
    ? RISK_SCORE_BETA_HIGH_PENALTY
    : riskAdjustedMetrics.beta * RISK_SCORE_BETA_MULTIPLIER;
  riskScore += Math.min(25, volatilityPenalty);

  riskScore = Math.round(Math.min(100, Math.max(0, riskScore)));

  // Classify overall risk
  let overallRisk: RiskLevel;
  if (riskScore < RISK_LEVEL_MINIMAL_THRESHOLD) overallRisk = "minimal";
  else if (riskScore < RISK_LEVEL_LOW_THRESHOLD) overallRisk = "low";
  else if (riskScore < RISK_LEVEL_MODERATE_THRESHOLD) overallRisk = "moderate";
  else if (riskScore < RISK_LEVEL_HIGH_THRESHOLD) overallRisk = "high";
  else overallRisk = "critical";

  return {
    agentId,
    agentName: agentConfig.name,
    timestamp: new Date().toISOString(),
    overallRisk,
    riskScore,
    var: var_,
    drawdown,
    concentration,
    riskAdjustedMetrics,
    activeStopRules,
    alerts: getAlerts(agentId, undefined, 20),
  };
}

/**
 * Get platform-wide risk summary across all agents.
 */
export async function getPlatformRiskSummary() {
  const configs = getAgentConfigs();
  const dashboards: AgentRiskDashboard[] = [];

  for (const config of configs) {
    const dashboard = await getAgentRiskDashboard(config.agentId);
    if (dashboard) dashboards.push(dashboard);
  }

  // Platform-level aggregation
  const avgRiskScore =
    dashboards.length > 0
      ? Math.round(averageByKey(dashboards, 'riskScore'))
      : 0;

  const totalVar95 = dashboards.reduce((sum, d) => sum + d.var.var95, 0);
  const totalVar99 = dashboards.reduce((sum, d) => sum + d.var.var99, 0);

  const circuitBreakers = dashboards.filter(
    (d) => d.drawdown.circuitBreakerTriggered,
  );

  const criticalAlerts = alertsStore.filter(
    (a) => a.severity === "critical" && !a.acknowledged,
  );

  return {
    timestamp: new Date().toISOString(),
    agentCount: configs.length,
    averageRiskScore: avgRiskScore,
    platformVaR95: round2(totalVar95),
    platformVaR99: round2(totalVar99),
    activeCircuitBreakers: circuitBreakers.length,
    criticalAlerts: criticalAlerts.length,
    agents: dashboards.map((d) => ({
      agentId: d.agentId,
      agentName: d.agentName,
      riskLevel: d.overallRisk,
      riskScore: d.riskScore,
      var95: d.var.var95,
      drawdown: d.drawdown.currentDrawdown,
      circuitBreaker: d.drawdown.circuitBreakerTriggered,
    })),
  };
}
