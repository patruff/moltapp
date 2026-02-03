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
  [/\bundervalued\b/i, 0.8],
  [/\bupside\b/i, 0.7],
  [/\bbullish\b/i, 0.9],
  [/\bgrowth\s+potential\b/i, 0.7],
  [/\bbuying\s+opportunity\b/i, 0.8],
  [/\bpositive\s+momentum\b/i, 0.7],
  [/\bstrong\s+fundamentals?\b/i, 0.6],
  [/\bbreakout\b/i, 0.7],
  [/\brally\b/i, 0.6],
  [/\baccumulate\b/i, 0.7],
  [/\bsupport\s+level\b/i, 0.5],
  [/\brecovery\b/i, 0.6],
  [/\boptimistic\b/i, 0.7],
  [/\bfavorable\b/i, 0.5],
  [/\bcheap\b/i, 0.6],
  [/\bdiscount\b/i, 0.6],
  [/\bappreciat/i, 0.6],
  [/\bincrease\b/i, 0.4],
  [/\brise\b|\brising\b/i, 0.5],
  [/\bgain\b|\bgains\b/i, 0.5],
];

/** Words/phrases indicating bearish sentiment in reasoning */
const BEARISH_SIGNALS: [RegExp, number][] = [
  [/\bovervalued\b/i, 0.8],
  [/\bdownside\b/i, 0.7],
  [/\bbearish\b/i, 0.9],
  [/\brisk\s+of\s+decline\b/i, 0.7],
  [/\bselling\s+pressure\b/i, 0.7],
  [/\bnegative\s+momentum\b/i, 0.7],
  [/\bweak\s+fundamentals?\b/i, 0.6],
  [/\bbreakdown\b/i, 0.7],
  [/\bcorrection\b/i, 0.6],
  [/\bdistribute\b/i, 0.5],
  [/\bresistance\s+level\b/i, 0.5],
  [/\bdeclining\b/i, 0.6],
  [/\bpessimistic\b/i, 0.7],
  [/\bunfavorable\b/i, 0.5],
  [/\bexpensive\b/i, 0.6],
  [/\boverheated\b/i, 0.6],
  [/\bdepreciat/i, 0.6],
  [/\bdecrease\b/i, 0.4],
  [/\bfall\b|\bfalling\b/i, 0.5],
  [/\bloss\b|\blosses\b/i, 0.5],
  [/\btake\s+profits?\b/i, 0.6],
  [/\boverexposed\b/i, 0.6],
  [/\btrim\s+position\b/i, 0.5],
];

/** Hold/caution signals */
const NEUTRAL_SIGNALS: [RegExp, number][] = [
  [/\buncertain\b/i, 0.6],
  [/\bwait\b|\bwaiting\b/i, 0.5],
  [/\bsidelines?\b/i, 0.7],
  [/\bcaution\b|\bcautious\b/i, 0.6],
  [/\bmixed\s+signals?\b/i, 0.7],
  [/\bno\s+clear\b/i, 0.6],
  [/\binsufficient\s+data\b/i, 0.7],
  [/\bpatien/i, 0.5],
  [/\bmonitor\b/i, 0.4],
  [/\bobserv/i, 0.4],
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
    if (netSentiment > 0.3) {
      score = 0.7 + netSentiment * 0.3; // 0.79 to 1.0
      explanation = "Bullish reasoning supports buy action";
    } else if (netSentiment > -0.1) {
      score = 0.5 + netSentiment * 0.2;
      explanation = "Reasoning is ambiguous but not contradictory for buy";
    } else {
      score = Math.max(0.05, 0.4 + netSentiment * 0.4);
      explanation = "Bearish reasoning contradicts buy action";

      // Check for contrarian / mean_reversion justification
      if (/contrarian|mean\s+reversion|oversold|bounce|bottom/i.test(reasoning)) {
        score = Math.min(1, score + 0.35);
        explanation = "Bearish context with contrarian/mean-reversion justification for buy";
      }
    }
  } else if (action === "sell") {
    if (netSentiment < -0.3) {
      score = 0.7 + Math.abs(netSentiment) * 0.3;
      explanation = "Bearish reasoning supports sell action";
    } else if (netSentiment < 0.1) {
      score = 0.5 + Math.abs(netSentiment) * 0.2;
      explanation = "Reasoning is ambiguous but not contradictory for sell";
    } else {
      score = Math.max(0.05, 0.4 - netSentiment * 0.4);
      explanation = "Bullish reasoning contradicts sell action";

      // Check for profit-taking justification
      if (/profit|take\s+gains|overexposed|rebalance|trim/i.test(reasoning)) {
        score = Math.min(1, score + 0.35);
        explanation = "Bullish context with profit-taking/rebalancing justification for sell";
      }
    }
  } else {
    // Hold
    if (neutralScore > 0 || (Math.abs(netSentiment) < 0.3 && totalSignals > 0)) {
      score = 0.7 + (1 - Math.abs(netSentiment)) * 0.3;
      explanation = "Neutral/cautious reasoning supports hold action";
    } else if (totalSignals === 0) {
      score = 0.5;
      explanation = "No clear sentiment signals in reasoning";
    } else {
      // Strong signals but choosing to hold — could be discipline or contradiction
      score = 0.4;
      explanation = "Strong directional signals present but chose to hold";

      if (/guardrail|limit|insufficient|cash\s+buffer|wait\s+for/i.test(reasoning)) {
        score = 0.8;
        explanation = "Strong signals tempered by risk management discipline";
      }
    }
  }

  // Check for conflicting signals (both very bullish AND very bearish)
  if (bullishScore > 2 && bearishScore > 2) {
    signals.push({
      type: "conflicting",
      text: "Contains both strong bullish and bearish signals",
      weight: 0.5,
    });
    // Conflicting is interesting but reduces coherence slightly
    score = Math.max(0.1, score - 0.1);
    explanation += " (warning: conflicting directional signals)";
  }

  return {
    score: Math.round(score * 100) / 100,
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
        if (deviation > 0.20) {
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
    if (Math.abs(pct) > 50) {
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
    : Math.min(1, flags.length * 0.25);

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
    } else if (trade.quantity > position.quantity * 1.01) {
      // 1% tolerance for rounding
      violations.push(
        `Trying to sell ${trade.quantity} shares of ${trade.symbol} but only holds ${position.quantity}`,
      );
    }
  }

  // Check 4: Conservative agents shouldn't trade with low confidence
  if (agentConfig.riskTolerance === "conservative" && trade.confidence < 0.3) {
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
  const disciplineScore = discipline.passed ? 1.0 : Math.max(0, 1 - discipline.violations.length * 0.25);

  const aggregateScore = Math.round(
    (coherence.score * 0.4 + hallucinationScore * 0.3 + disciplineScore * 0.3) * 100,
  ) / 100;

  return {
    coherence,
    hallucinations,
    discipline,
    aggregateScore,
  };
}
