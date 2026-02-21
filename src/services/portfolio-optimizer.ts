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
import { eq, desc } from "drizzle-orm";
import { getAgentConfigs, getAgentConfig, getMarketData } from "../agents/orchestrator.ts";
import type { MarketData } from "../agents/base-agent.ts";
import { XSTOCKS_CATALOG } from "../config/constants.ts";
import { round2, round4, sumByKey, filterByMapKey, findMax, findMin, computeVariance, weightedSumByKey } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Risk-Free Rate
 * Annual risk-free rate used in Sharpe ratio calculations, capital market line,
 * and excess return computations. Based on U.S. Treasury bill proxy.
 */
const RISK_FREE_RATE = 0.05; // 5% annual risk-free rate

/**
 * Default Return and Volatility Assumptions
 * Fallback values used when stock-specific data is unavailable.
 * Based on broad market historical averages.
 */
const DEFAULT_EXPECTED_RETURN = 0.10; // 10% default annual return
const DEFAULT_VOLATILITY = 0.25; // 25% default annual volatility

/**
 * Position Sizing Constraints
 * Enforces portfolio diversification and prevents over-concentration in single positions.
 */
const MAX_POSITION_WEIGHT = 0.20; // 20% maximum allocation per stock (default if not configured)
const MIN_POSITION_WEIGHT = 0.02; // 2% minimum allocation to include stock in portfolio
const MAX_PORTFOLIO_ALLOCATION = 0.80; // 80% maximum total allocation (maintains 20% cash reserve)
const MIN_WEIGHT_FILTER = 0.01; // 1% minimum weight to include in recommendations

/**
 * Correlation Classification Thresholds
 * Based on finance literature standards for identifying strong relationships between assets.
 */
const CORRELATION_STRONG_POSITIVE = 0.70; // r >= 0.70 indicates strong positive correlation
const CORRELATION_STRONG_NEGATIVE = -0.30; // r <= -0.30 indicates strong negative correlation (diversification benefit)

/**
 * Kelly Criterion Parameters
 * Controls position sizing based on expected edge and risk tolerance.
 */
const KELLY_HALF = 0.5; // Half-Kelly multiplier for safety margin
const KELLY_QUARTER = 0.25; // Quarter-Kelly multiplier for conservative sizing
const KELLY_OVEREXPOSED_MULTIPLIER = 1.5; // currentExposure > kelly * 1.5 = overexposed
const KELLY_UNDEREXPOSED_MULTIPLIER = 0.5; // currentExposure < kelly * 0.5 = underexposed
const KELLY_LEVERAGE_HIGH_THRESHOLD = 2; // Aggregate Kelly > 2 = high leverage
const KELLY_LEVERAGE_MODERATE_THRESHOLD = 1; // Aggregate Kelly > 1 = moderate leverage
const KELLY_LEVERAGE_MODEST_THRESHOLD = 0.3; // Aggregate Kelly > 0.3 = modest edge

/**
 * Portfolio Rebalancing Parameters
 * Thresholds for determining when and how urgently portfolio rebalancing is needed.
 */
const REBALANCE_DRIFT_THRESHOLD = 0.01; // 1% minimum drift to include in drift calculation
const REBALANCE_URGENCY_NONE = 0.05; // < 5% total drift = no rebalancing urgency
const REBALANCE_URGENCY_LOW = 0.15; // 5-15% drift = low urgency
const REBALANCE_URGENCY_MEDIUM = 0.30; // 15-30% drift = medium urgency
const REBALANCE_URGENCY_HIGH = 0.50; // 30-50% drift = high urgency, > 50% = critical

/**
 * Transaction Cost Estimate
 * Estimated transaction cost as percentage of trade value (includes slippage, fees, spreads).
 */
const TRANSACTION_COST_ESTIMATE = 0.001; // 0.1% estimated cost per trade

/**
 * Portfolio Composition Limits
 * Controls size and granularity of portfolio recommendations.
 */
const TOP_STOCKS_LIMIT = 10; // Maximum number of stocks in optimal portfolio
const EFFICIENT_FRONTIER_POINTS = 20; // Number of points to generate on efficient frontier
const DIVERSIFICATION_OPPORTUNITIES_LIMIT = 5; // Top N low-correlation stocks to recommend

/**
 * Default Return Estimate for Sharpe Calculation
 * Used when computing Sharpe ratio from volatility alone (before-rebalance metrics).
 */
const DEFAULT_SHARPE_RETURN_ESTIMATE = 0.10; // 10% return assumption for pre-rebalance Sharpe

/**
 * Drawdown Multiplier
 * Estimates maximum drawdown as multiple of portfolio volatility.
 */
const MAX_DRAWDOWN_VOLATILITY_MULTIPLIER = 2.5; // Max drawdown ≈ 2.5× volatility

/**
 * Display Formatting Precision Constants
 * Controls decimal precision for portfolio metrics displayed in marketplace UI,
 * agent dashboards, and optimization reports.
 */

/**
 * Decimal precision for Kelly leverage interpretation messages.
 * Example: "2.45" instead of "2.4523456789"
 * Used in: getKellyCriterion() interpretation text for aggregate Kelly display
 */
const KELLY_INTERPRETATION_DECIMAL_PRECISION = 2;

/**
 * Decimal precision for rebalancing drift score display.
 * Example: "15.3%" instead of "15.34567%"
 * Used in: getRebalanceRecommendations() summary text showing drift percentage
 */
const REBALANCE_DRIFT_DISPLAY_PRECISION = 1;

/**
 * Decimal precision for portfolio weight percentage display.
 * Example: "12.5%" instead of "12.53%"
 * Used in: Rebalancing trade reason messages showing current/recommended weights
 */
const WEIGHT_PERCENT_DISPLAY_PRECISION = 1;

/**
 * Decimal precision for transaction cost display.
 * Example: "$1234.56" instead of "$1234.5632"
 * Used in: Rebalancing summary showing estimated turnover costs
 */
const TRANSACTION_COST_DISPLAY_PRECISION = 2;

/**
 * Portfolio Calculation Constants
 * Magic numbers used in portfolio optimization formulas and scoring.
 */

/**
 * Inverse-variance scaling factor for efficient frontier calculation.
 * Scales inverse-variance weight component to balance with return-based weights.
 * Formula: score = (1 - riskTolerance) * invVar * INVERSE_VARIANCE_SCALE_FACTOR + ...
 * Used in: getEfficientFrontier() to blend min-variance and max-return strategies
 */
const INVERSE_VARIANCE_SCALE_FACTOR = 0.1;

/**
 * Portfolio value denominator for trade quantity calculations.
 * Assumes $10,000 portfolio when converting weight deltas to share quantities.
 * Formula: quantity = abs(delta) * PORTFOLIO_VALUE_DENOMINATOR / price
 * Used in: getRebalanceRecommendations() to estimate rebalancing trade sizes
 */
const PORTFOLIO_VALUE_DENOMINATOR = 10000;

/**
 * Risk parity score variance scaling factor.
 * Converts risk contribution variance to 0-100 score scale.
 * Formula: riskParityScore = 100 - riskVariance * RISK_PARITY_VARIANCE_MULTIPLIER
 * Higher variance = lower score. 50000 multiplier ensures typical variances (0.0001-0.002) map to 95-0 range.
 * Used in: getRiskParityPortfolio() to compute risk concentration score
 */
const RISK_PARITY_VARIANCE_MULTIPLIER = 50000;

/**
 * Kelly Criterion Decision Query Limits
 * Controls how many recent agent decisions are fetched for Kelly and allocation analysis.
 *
 * KELLY_DECISIONS_QUERY_LIMIT (200): Fetches last 200 decisions for Kelly criterion win/loss
 * statistics. 200 decisions gives statistically stable win-rate estimates per symbol
 * (typically 20-40 decisions per symbol × 5-10 active symbols).
 *
 * ALLOCATION_DECISIONS_QUERY_LIMIT (100): Fetches last 100 decisions for current allocation
 * inference. 100 decisions covers ~5-10 recent trading rounds, sufficient to determine
 * which symbols an agent is currently focused on.
 *
 * Used in: getKellyCriterion() and getOptimalPortfolio() DB queries respectively.
 */
const KELLY_DECISIONS_QUERY_LIMIT = 200;
const ALLOCATION_DECISIONS_QUERY_LIMIT = 100;

/**
 * Kelly Criterion Simulation Parameters
 * Controls win/loss simulation used to estimate Kelly optimal position sizing
 * when actual P&L data is unavailable (simulated from confidence scores).
 *
 * KELLY_SIM_CONFIDENCE_MIDPOINT (50): Neutral confidence threshold.
 *   - Above 50 → agent thinks trade will succeed
 *   - Below 50 → agent is uncertain
 *
 * KELLY_SIM_WIN_BASE_RATE (0.55): Base win probability for high-confidence trades.
 *   - A 50-confidence trade wins 55% of the time (slight edge over random)
 *   - A 100-confidence trade wins: 0.55 + (100-50)/200 = 0.55 + 0.25 = 0.80 (80%)
 *   Formula: P(win | conf≥50) = KELLY_SIM_WIN_BASE_RATE + (conf - MIDPOINT) / KELLY_SIM_CONFIDENCE_RANGE
 *
 * KELLY_SIM_CONFIDENCE_RANGE (200): Denominator that scales confidence bonus.
 *   - Range of 200 maps [50,100] confidence → [0, 0.25] probability bonus
 *
 * KELLY_SIM_LOW_CONF_WIN_RATE (0.40): Win probability for below-midpoint confidence.
 *   - Any trade with confidence < 50 wins 40% of the time (below-random)
 *
 * KELLY_SIM_WIN_PNL_MAX (5): Maximum random win P&L multiplier (in % return units).
 *   - Win P&L = (random × 5 + 1) × (confidence / 50) ∈ [1%, 6%] at 100% confidence
 *
 * KELLY_SIM_WIN_PNL_MIN (1): Minimum win P&L (guaranteed floor of 1% return per win).
 *
 * KELLY_SIM_LOSS_PNL_MAX (4): Maximum random loss P&L multiplier.
 *   - Loss P&L = (random × 4 + 0.5) × ((100 - confidence) / 50)
 *   - At 50% confidence: loss ∈ [0.5%, 4.5%] (symmetric with win range)
 *
 * KELLY_SIM_LOSS_PNL_MIN (0.5): Minimum loss magnitude (floor of 0.5% per loss).
 *
 * KELLY_SIM_CONFIDENCE_COMPLEMENT (100): Used to compute confidence-weighted loss size.
 *   - (100 - confidence) / 50 normalizes loss severity by uncertainty level
 *   - High-confidence losses are smaller; low-confidence losses are larger
 *
 * KELLY_SIM_CONFIDENCE_NORMALIZER (50): Normalizes both win and loss P&L by confidence.
 *   - confidence / 50: maps [0,100] → [0, 2] for win scaling
 *   - (100 - confidence) / 50: maps [0,100] → [2, 0] for loss scaling
 */
const KELLY_SIM_CONFIDENCE_MIDPOINT = 50;
const KELLY_SIM_WIN_BASE_RATE = 0.55;
const KELLY_SIM_CONFIDENCE_RANGE = 200;
const KELLY_SIM_LOW_CONF_WIN_RATE = 0.40;
const KELLY_SIM_WIN_PNL_MAX = 5;
const KELLY_SIM_WIN_PNL_MIN = 1;
const KELLY_SIM_LOSS_PNL_MAX = 4;
const KELLY_SIM_LOSS_PNL_MIN = 0.5;
const KELLY_SIM_CONFIDENCE_COMPLEMENT = 100;
const KELLY_SIM_CONFIDENCE_NORMALIZER = 50;

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
// Stock Return and Volatility Assumptions
// ---------------------------------------------------------------------------

/**
 * Expected Annual Returns by Stock
 * Historical risk premium estimates for portfolio optimization. Based on:
 * - Historical performance analysis
 * - Sector growth expectations
 * - Risk-adjusted return profiles
 *
 * Values range from 5% (GMEx - meme stock uncertainty) to 40% (MSTRx - high-risk Bitcoin proxy).
 * Used in mean-variance optimization, Sharpe ratio calculation, and efficient frontier generation.
 */
const STOCK_RETURN_AAPLx = 0.12;  // 12% - Mature tech leader, stable growth
const STOCK_RETURN_MSFTx = 0.15;  // 15% - Enterprise + cloud dominance
const STOCK_RETURN_GOOGLx = 0.10; // 10% - Search monopoly, regulatory headwinds
const STOCK_RETURN_METAx = 0.18;  // 18% - Social media leader, metaverse upside
const STOCK_RETURN_NVDAx = 0.35;  // 35% - AI chip leader, highest growth potential
const STOCK_RETURN_AVGOx = 0.20;  // 20% - Semiconductor strength
const STOCK_RETURN_CRMx = 0.14;   // 14% - SaaS leader, consistent growth
const STOCK_RETURN_PLTRx = 0.25;  // 25% - Government contracts, AI pivot
const STOCK_RETURN_NFLXx = 0.16;  // 16% - Streaming leader, content moat
const STOCK_RETURN_COINx = 0.30;  // 30% - Crypto exchange, high volatility
const STOCK_RETURN_MSTRx = 0.40;  // 40% - Bitcoin proxy, highest risk/return
const STOCK_RETURN_HOODx = 0.22;  // 22% - Retail trading platform
const STOCK_RETURN_SPYx = 0.10;   // 10% - S&P 500 benchmark
const STOCK_RETURN_QQQx = 0.14;   // 14% - Nasdaq 100, tech-heavy
const STOCK_RETURN_GMEx = 0.05;   // 5% - Meme stock, highly speculative
const STOCK_RETURN_TSLAx = 0.20;  // 20% - EV leader, execution risk
const STOCK_RETURN_LLYx = 0.18;   // 18% - Pharma leader, obesity drug upside
const STOCK_RETURN_CRCLx = 0.12;  // 12% - Fintech, niche market
const STOCK_RETURN_JPMx = 0.11;   // 11% - Banking giant, stable returns

/**
 * Annual Volatility by Stock
 * Historical standard deviation estimates for risk calculation. Based on:
 * - 1-year historical volatility
 * - Sector volatility profiles
 * - Liquidity and market cap considerations
 *
 * Values range from 15% (SPYx - index stability) to 70% (GMEx - extreme meme volatility).
 * Used in portfolio variance calculation, risk parity allocation, and drawdown estimates.
 */
const STOCK_VOLATILITY_AAPLx = 0.22;  // 22% - Mature but still growth stock
const STOCK_VOLATILITY_MSFTx = 0.20;  // 20% - Stable enterprise business
const STOCK_VOLATILITY_GOOGLx = 0.25; // 25% - Search moat, some regulatory uncertainty
const STOCK_VOLATILITY_METAx = 0.30;  // 30% - Social media risks, product cycles
const STOCK_VOLATILITY_NVDAx = 0.40;  // 40% - High growth, chip cycle volatility
const STOCK_VOLATILITY_AVGOx = 0.28;  // 28% - Semiconductor exposure
const STOCK_VOLATILITY_CRMx = 0.26;   // 26% - SaaS growth stock
const STOCK_VOLATILITY_PLTRx = 0.45;  // 45% - Polarizing stock, unpredictable contracts
const STOCK_VOLATILITY_NFLXx = 0.28;  // 28% - Streaming competition, subscriber churn
const STOCK_VOLATILITY_COINx = 0.55;  // 55% - Crypto exposure, regulatory risk
const STOCK_VOLATILITY_MSTRx = 0.65;  // 65% - Bitcoin volatility amplified
const STOCK_VOLATILITY_HOODx = 0.50;  // 50% - Retail trading platform, meme correlation
const STOCK_VOLATILITY_SPYx = 0.15;   // 15% - Diversified index, lowest volatility
const STOCK_VOLATILITY_QQQx = 0.18;   // 18% - Tech-heavy index, moderate volatility
const STOCK_VOLATILITY_GMEx = 0.70;   // 70% - Extreme meme stock volatility
const STOCK_VOLATILITY_TSLAx = 0.45;  // 45% - Execution risk, meme characteristics
const STOCK_VOLATILITY_LLYx = 0.25;   // 25% - Pharma, drug pipeline risk
const STOCK_VOLATILITY_CRCLx = 0.35;  // 35% - Fintech, competitive pressures
const STOCK_VOLATILITY_JPMx = 0.20;   // 20% - Banking stability

/**
 * Correlation Generation Parameters
 * Controls synthetic correlation between stocks for portfolio optimization when
 * insufficient historical data is available. Based on sector relationships and
 * empirical correlation studies.
 */

// Same-sector correlation bounds
const CORRELATION_SAME_SECTOR_BASE = 0.55;   // Base correlation for stocks in same sector
const CORRELATION_SAME_SECTOR_RANGE = 0.30;  // Range: 0.55 to 0.85 (55-85% correlation)

// Tech-Index correlation bounds (Tech stocks vs SPY/QQQ)
const CORRELATION_TECH_INDEX_BASE = 0.60;    // Tech stocks correlate highly with tech indexes
const CORRELATION_TECH_INDEX_RANGE = 0.20;   // Range: 0.60 to 0.80 (60-80% correlation)

// Crypto-Meme correlation bounds (speculative asset overlap)
const CORRELATION_CRYPTO_MEME_BASE = 0.35;   // Moderate correlation from retail speculation
const CORRELATION_CRYPTO_MEME_RANGE = 0.25;  // Range: 0.35 to 0.60 (35-60% correlation)

// Cross-sector correlation bounds (diversification benefit)
const CORRELATION_CROSS_SECTOR_BASE = 0.15;  // Low base correlation between different sectors
const CORRELATION_CROSS_SECTOR_RANGE = 0.35; // Range: 0.15 to 0.50 (15-50% correlation)

/**
 * Hash Function Modulo Parameters
 * Constants for deterministic pseudorandom correlation generation.
 * Ensures correlations are consistent across runs for reproducibility.
 */
const HASH_SEED_SHIFT = 5;        // Bit shift for hash mixing
const HASH_MODULO_DIVISOR = 100;  // Convert hash to percentage range

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
  AAPLx: STOCK_RETURN_AAPLx,
  MSFTx: STOCK_RETURN_MSFTx,
  GOOGLx: STOCK_RETURN_GOOGLx,
  METAx: STOCK_RETURN_METAx,
  NVDAx: STOCK_RETURN_NVDAx,
  AVGOx: STOCK_RETURN_AVGOx,
  CRMx: STOCK_RETURN_CRMx,
  PLTRx: STOCK_RETURN_PLTRx,
  NFLXx: STOCK_RETURN_NFLXx,
  COINx: STOCK_RETURN_COINx,
  MSTRx: STOCK_RETURN_MSTRx,
  HOODx: STOCK_RETURN_HOODx,
  SPYx: STOCK_RETURN_SPYx,
  QQQx: STOCK_RETURN_QQQx,
  GMEx: STOCK_RETURN_GMEx,
  TSLAx: STOCK_RETURN_TSLAx,
  LLYx: STOCK_RETURN_LLYx,
  CRCLx: STOCK_RETURN_CRCLx,
  JPMx: STOCK_RETURN_JPMx,
};

const BASE_VOLATILITIES: Record<string, number> = {
  AAPLx: STOCK_VOLATILITY_AAPLx,
  MSFTx: STOCK_VOLATILITY_MSFTx,
  GOOGLx: STOCK_VOLATILITY_GOOGLx,
  METAx: STOCK_VOLATILITY_METAx,
  NVDAx: STOCK_VOLATILITY_NVDAx,
  AVGOx: STOCK_VOLATILITY_AVGOx,
  CRMx: STOCK_VOLATILITY_CRMx,
  PLTRx: STOCK_VOLATILITY_PLTRx,
  NFLXx: STOCK_VOLATILITY_NFLXx,
  COINx: STOCK_VOLATILITY_COINx,
  MSTRx: STOCK_VOLATILITY_MSTRx,
  HOODx: STOCK_VOLATILITY_HOODx,
  SPYx: STOCK_VOLATILITY_SPYx,
  QQQx: STOCK_VOLATILITY_QQQx,
  GMEx: STOCK_VOLATILITY_GMEx,
  TSLAx: STOCK_VOLATILITY_TSLAx,
  LLYx: STOCK_VOLATILITY_LLYx,
  CRCLx: STOCK_VOLATILITY_CRCLx,
  JPMx: STOCK_VOLATILITY_JPMx,
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
    return CORRELATION_SAME_SECTOR_BASE + (seed % (CORRELATION_SAME_SECTOR_RANGE * HASH_MODULO_DIVISOR)) / HASH_MODULO_DIVISOR;
  }

  // Cross-sector correlations
  const seed = hashPair(sym1, sym2);
  if (
    (sec1 === "Tech" && sec2 === "Index") ||
    (sec1 === "Index" && sec2 === "Tech")
  ) {
    return CORRELATION_TECH_INDEX_BASE + (seed % (CORRELATION_TECH_INDEX_RANGE * HASH_MODULO_DIVISOR)) / HASH_MODULO_DIVISOR;
  }
  if (
    (sec1 === "Crypto" && sec2 === "Meme") ||
    (sec1 === "Meme" && sec2 === "Crypto")
  ) {
    return CORRELATION_CRYPTO_MEME_BASE + (seed % (CORRELATION_CRYPTO_MEME_RANGE * HASH_MODULO_DIVISOR)) / HASH_MODULO_DIVISOR;
  }

  // Default cross-sector
  return CORRELATION_CROSS_SECTOR_BASE + (seed % (CORRELATION_CROSS_SECTOR_RANGE * HASH_MODULO_DIVISOR)) / HASH_MODULO_DIVISOR;
}

function hashPair(a: string, b: string): number {
  const combined = [a, b].sort().join("|");
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    hash = ((hash << HASH_SEED_SHIFT) - hash + combined.charCodeAt(i)) | 0;
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
    .limit(ALLOCATION_DECISIONS_QUERY_LIMIT);

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
  const symbols = filterByMapKey(XSTOCKS_CATALOG, 'symbol', BASE_RETURNS).map(s => s.symbol);

  const riskFreeRate = RISK_FREE_RATE;

  // Calculate current allocation (based on trade frequency)
  const totalTrades = sumByKey(Object.values(symbolCounts), 'count') || 1;
  const currentAllocation: AllocationEntry[] = symbols.map((sym) => {
    const stock = XSTOCKS_CATALOG.find((s) => s.symbol === sym);
    const entry = symbolCounts[sym];
    const weight = entry ? entry.count / totalTrades : 0;
    const expectedReturn = BASE_RETURNS[sym] ?? DEFAULT_EXPECTED_RETURN;
    const volatility = BASE_VOLATILITIES[sym] ?? DEFAULT_VOLATILITY;
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
    const ret = BASE_RETURNS[sym] ?? DEFAULT_EXPECTED_RETURN;
    const vol = BASE_VOLATILITIES[sym] ?? DEFAULT_VOLATILITY;
    return { symbol: sym, sharpe: (ret - riskFreeRate) / vol, ret, vol };
  });

  // Sort by Sharpe ratio, allocate proportionally to top stocks
  sharpeRatios.sort((a, b) => b.sharpe - a.sharpe);

  // Diversification constraint: max per stock, min per included stock
  const maxWeight = config.maxPositionSize / 100 || MAX_POSITION_WEIGHT;
  const topN = Math.min(TOP_STOCKS_LIMIT, symbols.length);
  const topStocks = sharpeRatios.slice(0, topN);
  const totalSharpe = topStocks.reduce((s, t) => s + Math.max(0, t.sharpe), 0) || 1;

  const recommendedAllocation: AllocationEntry[] = topStocks.map((stock) => {
    const rawWeight = Math.max(0, stock.sharpe) / totalSharpe;
    const cappedWeight = Math.min(maxWeight, Math.max(MIN_POSITION_WEIGHT, rawWeight));
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
  const maxAllocation = config.maxPortfolioAllocation / 100 || MAX_PORTFOLIO_ALLOCATION;
  const totalWeight = sumByKey(recommendedAllocation, 'weight');
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
    else if (Math.abs(delta) < MIN_WEIGHT_FILTER) action = "hold";
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
  const portReturn = weightedSumByKey(recommendedAllocation, 'expectedReturn', 'weight');
  const portVol = calculatePortfolioVolatility(recommendedAllocation);
  const portSharpe = portVol > 0 ? (portReturn - riskFreeRate) / portVol : 0;
  const weights = recommendedAllocation.map((a) => a.weight);
  const hhi = weights.reduce((s, w) => s + w * w, 0);
  const diversificationRatio = weights.length > 0
    ? weightedSumByKey(recommendedAllocation, 'volatility', 'weight') / (portVol || 1)
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
      maxDrawdownEstimate: round4(portVol * MAX_DRAWDOWN_VOLATILITY_MULTIPLIER),
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
  const symbols = XSTOCKS_CATALOG.filter(
    (s) => BASE_RETURNS[s.symbol] !== undefined,
  ).map((s) => s.symbol);
  const riskFreeRate = RISK_FREE_RATE;

  // Generate points along the efficient frontier
  const points: EfficientFrontier["points"] = [];
  const numPoints = EFFICIENT_FRONTIER_POINTS;

  // Strategy: vary risk tolerance from 0 (min variance) to 1 (max return)
  for (let i = 0; i <= numPoints; i++) {
    const riskTolerance = i / numPoints;

    // Weight stocks based on blend of inverse-variance and return
    const allocations = symbols.map((sym) => {
      const ret = BASE_RETURNS[sym] ?? DEFAULT_EXPECTED_RETURN;
      const vol = BASE_VOLATILITIES[sym] ?? DEFAULT_VOLATILITY;
      const invVar = 1 / (vol * vol);
      const retScore = ret - riskFreeRate;

      // Blend: at riskTolerance=0, pure inverse-variance; at 1, pure return-based
      const score = (1 - riskTolerance) * invVar * INVERSE_VARIANCE_SCALE_FACTOR + riskTolerance * Math.max(0, retScore);
      return { symbol: sym, score, ret, vol };
    });

    const totalScore = allocations.reduce((s, a) => s + Math.max(0, a.score), 0) || 1;
    const weights = allocations.map((a) => ({
      symbol: a.symbol,
      weight: round4(Math.max(0, a.score) / totalScore),
    }));

    // Keep only top 10 and renormalize
    const topWeights = weights
      .filter((w) => w.weight > MIN_WEIGHT_FILTER)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, TOP_STOCKS_LIMIT);
    const topTotal = sumByKey(topWeights, 'weight') || 1;
    for (const w of topWeights) {
      w.weight = round4(w.weight / topTotal);
    }

    const allocation = topWeights.map((w) => ({
      symbol: w.symbol,
      weight: w.weight,
    }));

    const expectedReturn = allocation.reduce(
      (s, a) => s + a.weight * (BASE_RETURNS[a.symbol] ?? DEFAULT_EXPECTED_RETURN),
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
  const symbols = XSTOCKS_CATALOG.filter(
    (s) => BASE_RETURNS[s.symbol] !== undefined,
  ).map((s) => s.symbol);

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
      if (corr >= CORRELATION_STRONG_POSITIVE) {
        strongPositive.push({ pair: [symbols[i], symbols[j]], correlation: corr });
      }
      if (corr <= CORRELATION_STRONG_NEGATIVE) {
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
    .slice(0, DIVERSIFICATION_OPPORTUNITIES_LIMIT)
    .map((a) => `${a.symbol} (avg correlation: ${a.avgCorrelation.toFixed(2)})`);

  return {
    symbols,
    matrix,
    strongPositive: strongPositive.slice(0, TOP_STOCKS_LIMIT),
    strongNegative: strongNegative.slice(0, TOP_STOCKS_LIMIT),
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
    .limit(KELLY_DECISIONS_QUERY_LIMIT);

  // Group by symbol and compute win/loss stats
  const symbolStats: Record<string, { wins: number; losses: number; totalWinPnl: number; totalLossPnl: number; totalDecisions: number }> = {};

  for (const d of decisions) {
    if (d.action === "hold") continue;
    if (!symbolStats[d.symbol]) {
      symbolStats[d.symbol] = { wins: 0, losses: 0, totalWinPnl: 0, totalLossPnl: 0, totalDecisions: 0 };
    }
    symbolStats[d.symbol].totalDecisions++;

    // Simulate win/loss based on confidence and agent personality
    const isWin = d.confidence > KELLY_SIM_CONFIDENCE_MIDPOINT
      ? Math.random() < KELLY_SIM_WIN_BASE_RATE + (d.confidence - KELLY_SIM_CONFIDENCE_MIDPOINT) / KELLY_SIM_CONFIDENCE_RANGE
      : Math.random() < KELLY_SIM_LOW_CONF_WIN_RATE;
    const pnl = isWin
      ? (Math.random() * KELLY_SIM_WIN_PNL_MAX + KELLY_SIM_WIN_PNL_MIN) * (d.confidence / KELLY_SIM_CONFIDENCE_NORMALIZER)
      : -(Math.random() * KELLY_SIM_LOSS_PNL_MAX + KELLY_SIM_LOSS_PNL_MIN) * ((KELLY_SIM_CONFIDENCE_COMPLEMENT - d.confidence) / KELLY_SIM_CONFIDENCE_NORMALIZER);

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
    else if (currentExposure > kellyFraction * KELLY_OVEREXPOSED_MULTIPLIER) recommendation = "Overexposed — reduce position size";
    else if (currentExposure < kellyFraction * KELLY_UNDEREXPOSED_MULTIPLIER) recommendation = "Underexposed — can increase position size";
    else recommendation = "Well-sized — near optimal Kelly fraction";

    return {
      symbol,
      winRate: round4(winRate),
      avgWin: round2(avgWin),
      avgLoss: round2(avgLoss),
      kellyFraction: round4(kellyFraction),
      halfKelly: round4(kellyFraction * KELLY_HALF),
      quarterKelly: round4(kellyFraction * KELLY_QUARTER),
      recommendation,
      currentExposure: round4(currentExposure),
      optimalExposure: round4(optimalExposure),
    };
  });

  positions.sort((a, b) => b.kellyFraction - a.kellyFraction);

  const totalKelly = sumByKey(positions, 'kellyFraction');
  const overallLeverage = totalKelly;

  let interpretation: string;
  if (overallLeverage > KELLY_LEVERAGE_HIGH_THRESHOLD) {
    interpretation = `High aggregate Kelly (${overallLeverage.toFixed(KELLY_INTERPRETATION_DECIMAL_PRECISION)}) suggests ${config.name} has edge across many symbols. Use half-Kelly for safety.`;
  } else if (overallLeverage > KELLY_LEVERAGE_MODERATE_THRESHOLD) {
    interpretation = `Moderate aggregate Kelly (${overallLeverage.toFixed(KELLY_INTERPRETATION_DECIMAL_PRECISION)}). ${config.name} has positive expectancy. Consider quarter-Kelly for conservative sizing.`;
  } else if (overallLeverage > KELLY_LEVERAGE_MODEST_THRESHOLD) {
    interpretation = `Modest aggregate Kelly (${overallLeverage.toFixed(KELLY_INTERPRETATION_DECIMAL_PRECISION)}). ${config.name} has slim edge. Small position sizes recommended.`;
  } else {
    interpretation = `Low aggregate Kelly (${overallLeverage.toFixed(KELLY_INTERPRETATION_DECIMAL_PRECISION)}). Limited edge detected for ${config.name}. Focus on highest-conviction plays only.`;
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
  const symbols = XSTOCKS_CATALOG.filter(
    (s) => BASE_VOLATILITIES[s.symbol] !== undefined,
  ).map((s) => s.symbol);

  // Risk parity: weight inversely proportional to volatility
  const invVols = symbols.map((sym) => ({
    symbol: sym,
    name: XSTOCKS_CATALOG.find((s) => s.symbol === sym)?.name ?? sym,
    volatility: BASE_VOLATILITIES[sym] ?? DEFAULT_VOLATILITY,
    invVol: 1 / (BASE_VOLATILITIES[sym] ?? DEFAULT_VOLATILITY),
  }));

  const totalInvVol = sumByKey(invVols, 'invVol');

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
  const riskContribObjects = riskContribs.map((contrib) => ({ contrib }));
  const maxRiskContrib = findMax(riskContribObjects, 'contrib')?.contrib ?? 0;
  const minRiskContrib = findMin(riskContribObjects, 'contrib')?.contrib ?? 0;

  // Risk parity score: 100 = perfect parity, lower = more concentrated risk
  const riskVariance = computeVariance(riskContribs, true); // population variance
  const riskParityScore = Math.max(0, Math.min(100, Math.round(100 - riskVariance * RISK_PARITY_VARIANCE_MULTIPLIER)));

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
  const drifts = optimal.changes.filter((c) => Math.abs(c.delta) > REBALANCE_DRIFT_THRESHOLD);
  const driftScore = drifts.reduce((s, d) => s + Math.abs(d.delta), 0);

  let urgency: RebalanceRecommendation["urgency"];
  if (driftScore < REBALANCE_URGENCY_NONE) urgency = "none";
  else if (driftScore < REBALANCE_URGENCY_LOW) urgency = "low";
  else if (driftScore < REBALANCE_URGENCY_MEDIUM) urgency = "medium";
  else if (driftScore < REBALANCE_URGENCY_HIGH) urgency = "high";
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
      const quantity = Math.abs(d.delta) * PORTFOLIO_VALUE_DENOMINATOR / price; // Proportional to $10k portfolio
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
            : `Rebalance: ${d.action} ${d.symbol} weight from ${(d.currentWeight * 100).toFixed(WEIGHT_PERCENT_DISPLAY_PRECISION)}% to ${(d.recommendedWeight * 100).toFixed(WEIGHT_PERCENT_DISPLAY_PRECISION)}%`,
      };
    });

  const estimatedTurnover = sumByKey(trades, 'estimatedCost');
  const estimatedTransactionCosts = estimatedTurnover * TRANSACTION_COST_ESTIMATE;

  const beforeVol = optimal.currentAllocation.length > 0
    ? calculatePortfolioVolatility(optimal.currentAllocation)
    : DEFAULT_VOLATILITY;
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
      sharpe: round2(beforeVol > 0 ? DEFAULT_SHARPE_RETURN_ESTIMATE / beforeVol : 0),
      volatility: round4(beforeVol),
      maxDrawdown: round4(beforeVol * MAX_DRAWDOWN_VOLATILITY_MULTIPLIER),
    },
    afterMetrics: {
      sharpe: optimal.portfolioMetrics.sharpeRatio,
      volatility: afterVol,
      maxDrawdown: optimal.portfolioMetrics.maxDrawdownEstimate,
    },
    summary: urgency === "none"
      ? `${config.name}'s portfolio is well-balanced. No rebalancing needed.`
      : `${config.name}'s portfolio has drifted ${(driftScore * 100).toFixed(REBALANCE_DRIFT_DISPLAY_PRECISION)}% from optimal. ${trades.length} trade(s) recommended with estimated turnover of $${estimatedTurnover.toFixed(TRANSACTION_COST_DISPLAY_PRECISION)}.`,
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
      const volA = BASE_VOLATILITIES[a.symbol] ?? DEFAULT_VOLATILITY;
      const volB = BASE_VOLATILITIES[b.symbol] ?? DEFAULT_VOLATILITY;
      const corr = generateCorrelation(a.symbol, b.symbol);
      variance += a.weight * b.weight * volA * volB * corr;
    }
  }
  return Math.sqrt(Math.max(0, variance));
}
