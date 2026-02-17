/**
 * Coherence Analyzer
 *
 * The analytical engine behind MoltApp's AI benchmark. Measures three
 * critical dimensions of agent intelligence:
 *
 * 1. COHERENCE: Does the agent's reasoning logically support its action?
 *    (Bullish reasoning + buy = coherent; bullish reasoning + sell = incoherent)
 *
 * 2. HALLUCINATION DETECTION: Does the agent fabricate market data?
 *    (Claiming AAPL is at $500 when it's at $178 = hallucination)
 *
 * 3. INSTRUCTION DISCIPLINE: Does the agent respect its trading rules?
 *    (Position limits, cash buffers, allowed symbols)
 *
 * These three pillars, combined with P&L and Sharpe ratio, form the
 * MoltApp benchmark that ships to HuggingFace.
 */

import type { MarketData } from "../agents/base-agent.ts";
import { round2 } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Signal strength weights for sentiment classification.
 * Higher weight = stronger indicator of directional bias in reasoning.
 */
const SIGNAL_WEIGHT_STRONG = 0.9;      // Perfect indicators (e.g., "bullish", "bearish")
const SIGNAL_WEIGHT_HIGH = 0.8;        // Very strong indicators (e.g., "undervalued", "overvalued")
const SIGNAL_WEIGHT_MEDIUM = 0.7;      // Strong indicators (e.g., "upside", "downside", "growth potential")
const SIGNAL_WEIGHT_MODERATE = 0.6;    // Moderate indicators (e.g., "fundamentals", "recovery", "cheap")
const SIGNAL_WEIGHT_MILD = 0.5;        // Mild indicators (e.g., "rising", "support level", "distribute")
const SIGNAL_WEIGHT_WEAK = 0.4;        // Weak indicators (e.g., "increase", "decrease", "monitor")

/**
 * Coherence scoring thresholds for action-sentiment alignment.
 * Used to classify reasoning as supporting, ambiguous, or contradicting the action.
 */
const COHERENCE_SENTIMENT_THRESHOLD_BUY = 0.3;   // netSentiment > 0.3 = strong buy support
const COHERENCE_SENTIMENT_THRESHOLD_SELL = -0.3; // netSentiment < -0.3 = strong sell support
const COHERENCE_AMBIGUOUS_THRESHOLD = 0.1;       // |netSentiment| < 0.1 = ambiguous (low directional signal)
const COHERENCE_CONTRARIAN_BONUS = 0.35;         // Bonus for valid contrarian/profit-taking justification
const COHERENCE_HOLD_SENTIMENT_MAX = 0.3;        // |netSentiment| < 0.3 for hold = reasonable neutrality

/**
 * Hallucination detection thresholds.
 * Used to identify fabricated or impossible market data claims.
 */
const HALLUCINATION_PRICE_TOLERANCE = 0.20;      // ±20% price deviation allowed (rounding tolerance)
const HALLUCINATION_EXTREME_PCT_THRESHOLD = 50;  // Daily moves >50% flagged as implausible for major stocks
const HALLUCINATION_SEVERITY_MULTIPLIER = 0.25;  // Each flag adds 0.25 to severity (capped at 1.0)

/**
 * Instruction discipline thresholds.
 * Used to validate agent compliance with trading rules.
 */
const DISCIPLINE_SELL_QUANTITY_TOLERANCE = 1.01; // 1% rounding tolerance for sell quantity validation
const DISCIPLINE_CONSERVATIVE_MIN_CONF = 0.3;    // Conservative agents require ≥30% confidence to trade
const DISCIPLINE_VIOLATION_PENALTY = 0.25;       // Each violation reduces discipline score by 0.25

/**
 * Aggregate benchmark scoring weights.
 * Combined score = coherence (40%) + hallucination-free (30%) + discipline (30%).
 */
const AGGREGATE_WEIGHT_COHERENCE = 0.4;          // 40% - logical consistency is primary quality indicator
const AGGREGATE_WEIGHT_HALLUCINATION = 0.3;      // 30% - factual accuracy is critical
const AGGREGATE_WEIGHT_DISCIPLINE = 0.3;         // 30% - rule compliance ensures fair benchmark

/**
 * Coherence scoring formula base values.
 * These are the starting scores before netSentiment adjustment.
 * Strong alignment = 0.7 base (can reach 1.0 with perfect sentiment match)
 * Ambiguous alignment = 0.5 base (neutral quality signal)
 * Contradictory alignment = 0.4 base (poor but not zero — partial credit)
 * No signals case = 0.5 (neutral when no sentiment detected)
 * Discipline hold = 0.8 (high score when agent cites risk management)
 * Example: netSentiment=0.9 buy → 0.7 + 0.9 × 0.3 = 0.97 coherence
 */
const COHERENCE_SCORE_STRONG_BASE = 0.7;        // Base score when sentiment strongly aligns with action
const COHERENCE_SCORE_AMBIGUOUS_BASE = 0.5;     // Base score when sentiment is ambiguous/unclear
const COHERENCE_SCORE_CONTRADICTORY_BASE = 0.4; // Base score when sentiment contradicts action
const COHERENCE_SCORE_NO_SIGNALS = 0.5;         // Score when reasoning has no detectable sentiment signals
const COHERENCE_SCORE_DISCIPLINE_HOLD = 0.8;    // Score when hold is justified by risk management/guardrails
const COHERENCE_SCORE_MIN_FLOOR = 0.05;         // Minimum floor — even contradictory reasoning gets some credit

/**
 * Coherence scoring formula multipliers.
 * Applied to netSentiment (-1 to +1) to scale the score range above base.
 * Strong multiplier: 0.7 base + netSentiment × 0.3 → scores from 0.4 to 1.0
 * Ambiguous multiplier: 0.5 base + |netSentiment| × 0.2 → scores from 0.5 to 0.7
 * Contradictory multiplier: 0.4 + netSentiment × 0.4 → scores from 0.0 to 0.8
 * Formula ensures strong alignment → high scores, contradiction → low scores
 */
const COHERENCE_MULTIPLIER_STRONG = 0.3;        // Multiplier for strong alignment case (max range: 0.7 to 1.0)
const COHERENCE_MULTIPLIER_AMBIGUOUS = 0.2;     // Multiplier for ambiguous case (max range: 0.5 to 0.7)
const COHERENCE_MULTIPLIER_CONTRADICTORY = 0.4; // Multiplier for contradictory case (max range: 0.05 to 0.8)

/**
 * Conflicting signals detection thresholds.
 * When reasoning has both strong bullish AND strong bearish signals,
 * a "conflicting" signal is added and coherence is slightly reduced.
 * Threshold: both bullish score > 2 AND bearish score > 2
 * Penalty: reduces coherence score by CONFLICT_SCORE_PENALTY (capped at 0.1 floor)
 * Weight: the conflicting signal has a mid-weight (0.5) in the signals array
 */
const COHERENCE_CONFLICT_SCORE_THRESHOLD = 2;   // Score threshold for detecting conflicting signals
const COHERENCE_CONFLICT_SIGNAL_WEIGHT = 0.5;   // Weight of the "conflicting" signal marker
const COHERENCE_CONFLICT_SCORE_PENALTY = 0.1;   // Score reduction applied when both signals detected

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CoherenceResult {
  /** 0.0 (contradictory) to 1.0 (perfectly coherent) */
  score: number;
  /** Why this score was assigned */
  explanation: string;
  /** Specific signals detected */
  signals: CoherenceSignal[];
}

export interface CoherenceSignal {
  type: "bullish" | "bearish" | "neutral" | "conflicting";
  text: string;
  weight: number;
}

export interface HallucinationResult {
  /** List of factual errors found */
  flags: string[];
  /** 0.0 (no hallucinations) to 1.0 (fully hallucinated) */
  severity: number;
}

export interface DisciplineResult {
  /** Whether the agent followed its rules */
  passed: boolean;
  /** Specific violations */
  violations: string[];
}

export interface AgentTradeConfig {
  maxPositionSize: number;      // % of portfolio
  maxPortfolioAllocation: number; // % in stocks
  riskTolerance: "conservative" | "moderate" | "aggressive";
  allowedSymbols?: string[];
}

// ---------------------------------------------------------------------------
// Sentiment Lexicon
// ---------------------------------------------------------------------------

/** Words/phrases indicating bullish sentiment in reasoning */
const BULLISH_SIGNALS: [RegExp, number][] = [
  [/\bundervalued\b/i, SIGNAL_WEIGHT_HIGH],
  [/\bupside\b/i, SIGNAL_WEIGHT_MEDIUM],
  [/\bbullish\b/i, SIGNAL_WEIGHT_STRONG],
  [/\bgrowth\s+potential\b/i, SIGNAL_WEIGHT_MEDIUM],
  [/\bbuying\s+opportunity\b/i, SIGNAL_WEIGHT_HIGH],
  [/\bpositive\s+momentum\b/i, SIGNAL_WEIGHT_MEDIUM],
  [/\bstrong\s+fundamentals?\b/i, SIGNAL_WEIGHT_MODERATE],
  [/\bbreakout\b/i, SIGNAL_WEIGHT_MEDIUM],
  [/\brally\b/i, SIGNAL_WEIGHT_MODERATE],
  [/\baccumulate\b/i, SIGNAL_WEIGHT_MEDIUM],
  [/\bsupport\s+level\b/i, SIGNAL_WEIGHT_MILD],
  [/\brecovery\b/i, SIGNAL_WEIGHT_MODERATE],
  [/\boptimistic\b/i, SIGNAL_WEIGHT_MEDIUM],
  [/\bfavorable\b/i, SIGNAL_WEIGHT_MILD],
  [/\bcheap\b/i, SIGNAL_WEIGHT_MODERATE],
  [/\bdiscount\b/i, SIGNAL_WEIGHT_MODERATE],
  [/\bappreciat/i, SIGNAL_WEIGHT_MODERATE],
  [/\bincrease\b/i, SIGNAL_WEIGHT_WEAK],
  [/\brise\b|\brising\b/i, SIGNAL_WEIGHT_MILD],
  [/\bgain\b|\bgains\b/i, SIGNAL_WEIGHT_MILD],
];

/** Words/phrases indicating bearish sentiment in reasoning */
const BEARISH_SIGNALS: [RegExp, number][] = [
  [/\bovervalued\b/i, SIGNAL_WEIGHT_HIGH],
  [/\bdownside\b/i, SIGNAL_WEIGHT_MEDIUM],
  [/\bbearish\b/i, SIGNAL_WEIGHT_STRONG],
  [/\brisk\s+of\s+decline\b/i, SIGNAL_WEIGHT_MEDIUM],
  [/\bselling\s+pressure\b/i, SIGNAL_WEIGHT_MEDIUM],
  [/\bnegative\s+momentum\b/i, SIGNAL_WEIGHT_MEDIUM],
  [/\bweak\s+fundamentals?\b/i, SIGNAL_WEIGHT_MODERATE],
  [/\bbreakdown\b/i, SIGNAL_WEIGHT_MEDIUM],
  [/\bcorrection\b/i, SIGNAL_WEIGHT_MODERATE],
  [/\bdistribute\b/i, SIGNAL_WEIGHT_MILD],
  [/\bresistance\s+level\b/i, SIGNAL_WEIGHT_MILD],
  [/\bdeclining\b/i, SIGNAL_WEIGHT_MODERATE],
  [/\bpessimistic\b/i, SIGNAL_WEIGHT_MEDIUM],
  [/\bunfavorable\b/i, SIGNAL_WEIGHT_MILD],
  [/\bexpensive\b/i, SIGNAL_WEIGHT_MODERATE],
  [/\boverheated\b/i, SIGNAL_WEIGHT_MODERATE],
  [/\bdepreciat/i, SIGNAL_WEIGHT_MODERATE],
  [/\bdecrease\b/i, SIGNAL_WEIGHT_WEAK],
  [/\bfall\b|\bfalling\b/i, SIGNAL_WEIGHT_MILD],
  [/\bloss\b|\blosses\b/i, SIGNAL_WEIGHT_MILD],
  [/\btake\s+profits?\b/i, SIGNAL_WEIGHT_MODERATE],
  [/\boverexposed\b/i, SIGNAL_WEIGHT_MODERATE],
  [/\btrim\s+position\b/i, SIGNAL_WEIGHT_MILD],
];

/** Hold/caution signals */
const NEUTRAL_SIGNALS: [RegExp, number][] = [
  [/\buncertain\b/i, SIGNAL_WEIGHT_MODERATE],
  [/\bwait\b|\bwaiting\b/i, SIGNAL_WEIGHT_MILD],
  [/\bsidelines?\b/i, SIGNAL_WEIGHT_MEDIUM],
  [/\bcaution\b|\bcautious\b/i, SIGNAL_WEIGHT_MODERATE],
  [/\bmixed\s+signals?\b/i, SIGNAL_WEIGHT_MEDIUM],
  [/\bno\s+clear\b/i, SIGNAL_WEIGHT_MODERATE],
  [/\binsufficient\s+data\b/i, SIGNAL_WEIGHT_MEDIUM],
  [/\bpatien/i, SIGNAL_WEIGHT_MILD],
  [/\bmonitor\b/i, SIGNAL_WEIGHT_WEAK],
  [/\bobserv/i, SIGNAL_WEIGHT_WEAK],
];

// ---------------------------------------------------------------------------
// Core Analysis Functions
// ---------------------------------------------------------------------------

/**
 * Analyze whether an agent's reasoning is coherent with its trading action.
 *
 * Scoring:
 * - 1.0: Perfect alignment (bullish reasoning + buy, bearish + sell, neutral + hold)
 * - 0.5: Ambiguous but not contradictory
 * - 0.0: Direct contradiction (bullish reasoning + sell without hedge explanation)
 */
export function analyzeCoherence(
  reasoning: string,
  action: "buy" | "sell" | "hold",
  _marketData?: MarketData[],
): CoherenceResult {
  const signals: CoherenceSignal[] = [];

  // Score bullish signals
  let bullishScore = 0;
  let bullishCount = 0;
  for (const [pattern, weight] of BULLISH_SIGNALS) {
    const match = reasoning.match(pattern);
    if (match) {
      bullishScore += weight;
      bullishCount++;
      signals.push({
        type: "bullish",
        text: match[0],
        weight,
      });
    }
  }

  // Score bearish signals
  let bearishScore = 0;
  let bearishCount = 0;
  for (const [pattern, weight] of BEARISH_SIGNALS) {
    const match = reasoning.match(pattern);
    if (match) {
      bearishScore += weight;
      bearishCount++;
      signals.push({
        type: "bearish",
        text: match[0],
        weight,
      });
    }
  }

  // Score neutral signals
  let neutralScore = 0;
  for (const [pattern, weight] of NEUTRAL_SIGNALS) {
    const match = reasoning.match(pattern);
    if (match) {
      neutralScore += weight;
      signals.push({
        type: "neutral",
        text: match[0],
        weight,
      });
    }
  }

  // Normalize scores
  const totalSignals = bullishCount + bearishCount;
  const netSentiment = totalSignals > 0
    ? (bullishScore - bearishScore) / (bullishScore + bearishScore || 1)
    : 0; // -1 (fully bearish) to +1 (fully bullish)

  // Calculate coherence based on action alignment
  let score: number;
  let explanation: string;

  if (action === "buy") {
    if (netSentiment > COHERENCE_SENTIMENT_THRESHOLD_BUY) {
      score = COHERENCE_SCORE_STRONG_BASE + netSentiment * COHERENCE_MULTIPLIER_STRONG; // 0.79 to 1.0
      explanation = "Bullish reasoning supports buy action";
    } else if (netSentiment > -COHERENCE_AMBIGUOUS_THRESHOLD) {
      score = COHERENCE_SCORE_AMBIGUOUS_BASE + netSentiment * COHERENCE_MULTIPLIER_AMBIGUOUS;
      explanation = "Reasoning is ambiguous but not contradictory for buy";
    } else {
      score = Math.max(COHERENCE_SCORE_MIN_FLOOR, COHERENCE_SCORE_CONTRADICTORY_BASE + netSentiment * COHERENCE_MULTIPLIER_CONTRADICTORY);
      explanation = "Bearish reasoning contradicts buy action";

      // Check for contrarian / mean_reversion justification
      if (/contrarian|mean\s+reversion|oversold|bounce|bottom/i.test(reasoning)) {
        score = Math.min(1, score + COHERENCE_CONTRARIAN_BONUS);
        explanation = "Bearish context with contrarian/mean-reversion justification for buy";
      }
    }
  } else if (action === "sell") {
    if (netSentiment < COHERENCE_SENTIMENT_THRESHOLD_SELL) {
      score = COHERENCE_SCORE_STRONG_BASE + Math.abs(netSentiment) * COHERENCE_MULTIPLIER_STRONG;
      explanation = "Bearish reasoning supports sell action";
    } else if (netSentiment < COHERENCE_AMBIGUOUS_THRESHOLD) {
      score = COHERENCE_SCORE_AMBIGUOUS_BASE + Math.abs(netSentiment) * COHERENCE_MULTIPLIER_AMBIGUOUS;
      explanation = "Reasoning is ambiguous but not contradictory for sell";
    } else {
      score = Math.max(COHERENCE_SCORE_MIN_FLOOR, COHERENCE_SCORE_CONTRADICTORY_BASE - netSentiment * COHERENCE_MULTIPLIER_CONTRADICTORY);
      explanation = "Bullish reasoning contradicts sell action";

      // Check for profit-taking justification
      if (/profit|take\s+gains|overexposed|rebalance|trim/i.test(reasoning)) {
        score = Math.min(1, score + COHERENCE_CONTRARIAN_BONUS);
        explanation = "Bullish context with profit-taking/rebalancing justification for sell";
      }
    }
  } else {
    // Hold
    if (neutralScore > 0 || (Math.abs(netSentiment) < COHERENCE_HOLD_SENTIMENT_MAX && totalSignals > 0)) {
      score = COHERENCE_SCORE_STRONG_BASE + (1 - Math.abs(netSentiment)) * COHERENCE_MULTIPLIER_STRONG;
      explanation = "Neutral/cautious reasoning supports hold action";
    } else if (totalSignals === 0) {
      score = COHERENCE_SCORE_NO_SIGNALS;
      explanation = "No clear sentiment signals in reasoning";
    } else {
      // Strong signals but choosing to hold — could be discipline or contradiction
      score = COHERENCE_SCORE_CONTRADICTORY_BASE;
      explanation = "Strong directional signals present but chose to hold";

      if (/guardrail|limit|insufficient|cash\s+buffer|wait\s+for/i.test(reasoning)) {
        score = COHERENCE_SCORE_DISCIPLINE_HOLD;
        explanation = "Strong signals tempered by risk management discipline";
      }
    }
  }

  // Check for conflicting signals (both very bullish AND very bearish)
  if (bullishScore > COHERENCE_CONFLICT_SCORE_THRESHOLD && bearishScore > COHERENCE_CONFLICT_SCORE_THRESHOLD) {
    signals.push({
      type: "conflicting",
      text: "Contains both strong bullish and bearish signals",
      weight: COHERENCE_CONFLICT_SIGNAL_WEIGHT,
    });
    // Conflicting is interesting but reduces coherence slightly
    score = Math.max(COHERENCE_SCORE_MIN_FLOOR * 2, score - COHERENCE_CONFLICT_SCORE_PENALTY);
    explanation += " (warning: conflicting directional signals)";
  }

  return {
    score: round2(score),
    explanation,
    signals,
  };
}

/**
 * Detect hallucinations in an agent's reasoning by comparing
 * claimed facts against real market data.
 *
 * Checks:
 * - Price claims that don't match reality (±20% tolerance for rounding)
 * - Made-up ticker symbols
 * - Impossible percentage claims
 * - Self-contradictory statements
 */
export function detectHallucinations(
  reasoning: string,
  marketData: MarketData[],
): HallucinationResult {
  const flags: string[] = [];

  // Build price lookup from real market data
  const realPrices = new Map<string, number>();
  const validSymbols = new Set<string>();
  for (const d of marketData) {
    realPrices.set(d.symbol.toLowerCase(), d.price);
    validSymbols.add(d.symbol.toLowerCase());
    // Also add without 'x' suffix
    const baseSymbol = d.symbol.replace(/x$/i, "").toLowerCase();
    realPrices.set(baseSymbol, d.price);
    validSymbols.add(baseSymbol);
  }

  // Check 1: Price claims
  // Match patterns like "$178.50", "priced at 178", "trading at $505"
  const pricePatterns = [
    /(\w+x?)\s+(?:is\s+)?(?:at|priced?\s+at|trading\s+at|currently)\s+\$?([\d,]+\.?\d*)/gi,
    /\$?([\d,]+\.?\d*)\s+(?:per\s+share|price)\s+(?:for|of)\s+(\w+x?)/gi,
  ];

  for (const pattern of pricePatterns) {
    let match;
    while ((match = pattern.exec(reasoning)) !== null) {
      let symbol: string;
      let claimedPrice: number;

      if (pattern === pricePatterns[0]) {
        symbol = match[1].toLowerCase();
        claimedPrice = parseFloat(match[2].replace(/,/g, ""));
      } else {
        claimedPrice = parseFloat(match[1].replace(/,/g, ""));
        symbol = match[2].toLowerCase();
      }

      const realPrice = realPrices.get(symbol);
      if (realPrice !== undefined && claimedPrice > 0) {
        const deviation = Math.abs(claimedPrice - realPrice) / realPrice;
        if (deviation > HALLUCINATION_PRICE_TOLERANCE) {
          flags.push(
            `Price hallucination: claimed ${symbol.toUpperCase()} at $${claimedPrice.toFixed(2)}, actual $${realPrice.toFixed(2)} (${(deviation * 100).toFixed(0)}% off)`,
          );
        }
      }
    }
  }

  // Check 2: Made-up ticker symbols
  const mentionedTickers = reasoning.match(/\b[A-Z]{2,5}x?\b/g) ?? [];
  for (const ticker of mentionedTickers) {
    const lower = ticker.toLowerCase();
    // Skip common words that look like tickers
    if (["the", "and", "for", "but", "not", "may", "can", "has", "its", "per", "our", "all", "low", "buy", "sell", "hold", "risk", "cash", "spy", "etf", "ipo", "vol", "rsi", "avg", "max", "min", "pnl"].includes(lower)) {
      continue;
    }
    // Check if it looks like a stock ticker but isn't in our catalog
    if (/^[A-Z]{2,5}x?$/.test(ticker) && !validSymbols.has(lower) && !validSymbols.has(lower.replace(/x$/i, ""))) {
      // Only flag if it's used in a trading context
      const context = reasoning.slice(
        Math.max(0, reasoning.indexOf(ticker) - 30),
        reasoning.indexOf(ticker) + ticker.length + 30,
      );
      if (/price|trade|buy|sell|stock|share|position/i.test(context)) {
        flags.push(`Unknown ticker: ${ticker} not found in available stocks`);
      }
    }
  }

  // Check 3: Impossible percentage claims
  const percentMatches = reasoning.match(/[+-]?\d+\.?\d*%/g) ?? [];
  for (const pctStr of percentMatches) {
    const pct = parseFloat(pctStr);
    if (Math.abs(pct) > HALLUCINATION_EXTREME_PCT_THRESHOLD) {
      // 24h change > 50% is extremely unusual for major stocks
      if (/24h|daily|today|change/i.test(reasoning)) {
        flags.push(`Implausible 24h change: ${pctStr} — major stocks rarely move this much in a day`);
      }
    }
  }

  // Check 4: Self-contradictions
  if (
    (/should\s+buy/i.test(reasoning) && /should\s+sell/i.test(reasoning)) ||
    (/strongly\s+bullish/i.test(reasoning) && /strongly\s+bearish/i.test(reasoning))
  ) {
    flags.push("Self-contradiction: reasoning contains conflicting directional advice");
  }

  // Calculate severity
  const severity = flags.length === 0
    ? 0
    : Math.min(1, flags.length * HALLUCINATION_SEVERITY_MULTIPLIER);

  return { flags, severity };
}

/**
 * Check whether the agent followed its trading rules and config constraints.
 *
 * Rules checked:
 * - Position size within limits
 * - Portfolio allocation within limits
 * - Only trading allowed symbols
 * - Quantity makes sense for the action
 */
export function checkInstructionDiscipline(
  trade: {
    action: "buy" | "sell" | "hold";
    symbol: string;
    quantity: number;
    confidence: number;
  },
  agentConfig: AgentTradeConfig,
  portfolio: {
    cashBalance: number;
    totalValue: number;
    positions: { symbol: string; quantity: number; currentPrice: number }[];
  },
): DisciplineResult {
  const violations: string[] = [];

  if (trade.action === "hold") {
    return { passed: true, violations: [] };
  }

  // Check 1: Position size limit
  if (trade.action === "buy" && portfolio.totalValue > 0) {
    const positionPct = (trade.quantity / portfolio.totalValue) * 100;
    if (positionPct > agentConfig.maxPositionSize) {
      violations.push(
        `Position size ${positionPct.toFixed(1)}% exceeds max ${agentConfig.maxPositionSize}%`,
      );
    }
  }

  // Check 2: Cash buffer for buys
  if (trade.action === "buy") {
    const minCash = portfolio.totalValue * ((100 - agentConfig.maxPortfolioAllocation) / 100);
    const cashAfter = portfolio.cashBalance - trade.quantity;
    if (cashAfter < minCash) {
      violations.push(
        `Buy would leave $${cashAfter.toFixed(2)} cash, below minimum $${minCash.toFixed(2)} (${100 - agentConfig.maxPortfolioAllocation}% buffer)`,
      );
    }
  }

  // Check 3: Selling more than owned
  if (trade.action === "sell") {
    const position = portfolio.positions.find(
      (p) => p.symbol.toLowerCase() === trade.symbol.toLowerCase(),
    );
    if (!position) {
      violations.push(`Trying to sell ${trade.symbol} but no position held`);
    } else if (trade.quantity > position.quantity * DISCIPLINE_SELL_QUANTITY_TOLERANCE) {
      // 1% tolerance for rounding
      violations.push(
        `Trying to sell ${trade.quantity} shares of ${trade.symbol} but only holds ${position.quantity}`,
      );
    }
  }

  // Check 4: Conservative agents shouldn't trade with low confidence
  if (agentConfig.riskTolerance === "conservative" && trade.confidence < DISCIPLINE_CONSERVATIVE_MIN_CONF) {
    violations.push(
      `Conservative agent trading with very low confidence (${(trade.confidence * 100).toFixed(0)}%)`,
    );
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}

/**
 * Run the full coherence analysis suite on a trade.
 * Returns all three scores plus an aggregate benchmark score.
 */
export function runFullAnalysis(
  reasoning: string,
  action: "buy" | "sell" | "hold",
  symbol: string,
  quantity: number,
  confidence: number,
  marketData: MarketData[],
  agentConfig: AgentTradeConfig,
  portfolio: {
    cashBalance: number;
    totalValue: number;
    positions: { symbol: string; quantity: number; currentPrice: number }[];
  },
): {
  coherence: CoherenceResult;
  hallucinations: HallucinationResult;
  discipline: DisciplineResult;
  aggregateScore: number;
} {
  const coherence = analyzeCoherence(reasoning, action, marketData);
  const hallucinations = detectHallucinations(reasoning, marketData);
  const discipline = checkInstructionDiscipline(
    { action, symbol, quantity, confidence },
    agentConfig,
    portfolio,
  );

  // Aggregate score: weighted combination
  // Coherence: 40%, Hallucination-free: 30%, Discipline: 30%
  const hallucinationScore = 1 - hallucinations.severity;
  const disciplineScore = discipline.passed ? 1.0 : Math.max(0, 1 - discipline.violations.length * DISCIPLINE_VIOLATION_PENALTY);

  const aggregateScore = round2(
    coherence.score * AGGREGATE_WEIGHT_COHERENCE + hallucinationScore * AGGREGATE_WEIGHT_HALLUCINATION + disciplineScore * AGGREGATE_WEIGHT_DISCIPLINE,
  );

  return {
    coherence,
    hallucinations,
    discipline,
    aggregateScore,
  };
}
