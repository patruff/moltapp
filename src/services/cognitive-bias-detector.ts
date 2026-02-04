/**
 * Cognitive Bias Detector (v22)
 *
 * Detects cognitive biases in AI agent trading reasoning. AI agents,
 * trained on human text, inherit human cognitive biases. Detecting these
 * biases is critical for a trustworthy AI benchmark.
 *
 * Biases detected:
 *
 * 1. ANCHORING BIAS: Over-reliance on a single data point (usually the first
 *    price mentioned). Agent fixates on one number and reasons from it.
 *
 * 2. CONFIRMATION BIAS: Agent only cites evidence that supports its predetermined
 *    conclusion, ignoring contradictory data that was available.
 *
 * 3. RECENCY BIAS: Disproportionate weight on the most recent data point,
 *    ignoring longer-term trends or fundamentals.
 *
 * 4. SUNK COST FALLACY: Holding or adding to a losing position because of
 *    prior investment rather than current merit.
 *
 * 5. OVERCONFIDENCE BIAS: High confidence relative to the strength of evidence.
 *    Agent claims certainty when data is ambiguous.
 *
 * 6. HERDING BIAS: Agent reasoning mirrors what other agents decided rather
 *    than independent analysis. Detected across multi-agent rounds.
 *
 * 7. LOSS AVERSION: Asymmetric treatment of gains vs losses. Agent is
 *    willing to take risks to avoid losses but not for equivalent gains.
 *
 * This is a v22 benchmark pillar: "Cognitive Bias Score" — lower is better.
 * A bias-free agent would score 0.0. Heavy bias scores 1.0.
 */

import type { MarketData } from "../agents/base-agent.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BiasType =
  | "anchoring"
  | "confirmation"
  | "recency"
  | "sunk_cost"
  | "overconfidence"
  | "herding"
  | "loss_aversion";

export interface BiasDetection {
  /** Type of cognitive bias detected */
  type: BiasType;
  /** Confidence in the detection: 0.0 to 1.0 */
  confidence: number;
  /** Evidence for the bias detection */
  evidence: string;
  /** Severity: how much this bias likely affected the decision */
  severity: "low" | "medium" | "high";
  /** Specific text segments that triggered detection */
  triggers: string[];
}

export interface BiasAnalysisResult {
  /** Overall bias score: 0.0 (bias-free) to 1.0 (heavily biased) */
  biasScore: number;
  /** Number of biases detected */
  biasCount: number;
  /** Individual bias detections */
  detections: BiasDetection[];
  /** Summary assessment */
  assessment: string;
  /** Dominant bias (most severe) */
  dominantBias: BiasType | null;
}

export interface RoundAgentContext {
  agentId: string;
  action: string;
  symbol: string;
  reasoning: string;
  confidence: number;
}

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------

interface BiasRecord {
  tradeId: string;
  agentId: string;
  roundId: string;
  result: BiasAnalysisResult;
  timestamp: string;
}

const biasHistory: BiasRecord[] = [];
const MAX_HISTORY = 500;

const agentBiasStats = new Map<
  string,
  { totalBiases: number; byType: Record<string, number>; checks: number; totalScore: number }
>();

// ---------------------------------------------------------------------------
// Bias Detectors
// ---------------------------------------------------------------------------

/**
 * Detect anchoring bias: over-reliance on a single data point.
 */
function detectAnchoring(reasoning: string, marketData: MarketData[]): BiasDetection | null {
  // Look for patterns where one number dominates the reasoning
  const priceRefs = reasoning.match(/\$[\d,]+\.?\d*/g) ?? [];
  const percentRefs = reasoning.match(/[+-]?\d+\.?\d*%/g) ?? [];

  // Anchoring: same price reference appears 3+ times
  const priceCounts = new Map<string, number>();
  for (const p of priceRefs) {
    priceCounts.set(p, (priceCounts.get(p) || 0) + 1);
  }

  const repeatedPrices = Array.from(priceCounts.entries()).filter(([_, count]) => count >= 3);

  if (repeatedPrices.length > 0) {
    const anchor = repeatedPrices[0][0];
    return {
      type: "anchoring",
      confidence: Math.min(0.9, 0.3 + repeatedPrices[0][1] * 0.15),
      evidence: `Price ${anchor} mentioned ${repeatedPrices[0][1]} times — reasoning appears anchored to this value`,
      severity: repeatedPrices[0][1] >= 4 ? "high" : "medium",
      triggers: repeatedPrices.map(([p]) => p),
    };
  }

  // Anchoring: reasoning references only one stock's data despite having multiple
  if (marketData.length >= 3) {
    const symbolsInReasoning = new Set<string>();
    for (const d of marketData) {
      const lower = d.symbol.toLowerCase();
      const base = lower.replace(/x$/i, "");
      if (
        reasoning.toLowerCase().includes(lower) ||
        reasoning.toLowerCase().includes(base)
      ) {
        symbolsInReasoning.add(d.symbol);
      }
    }

    if (symbolsInReasoning.size === 1 && priceRefs.length >= 2) {
      return {
        type: "anchoring",
        confidence: 0.5,
        evidence: `Only references one symbol despite ${marketData.length} available — may be anchored to that stock's data`,
        severity: "low",
        triggers: Array.from(symbolsInReasoning),
      };
    }
  }

  return null;
}

/**
 * Detect confirmation bias: only citing evidence that supports the conclusion.
 */
function detectConfirmation(
  reasoning: string,
  action: string,
  marketData: MarketData[],
): BiasDetection | null {
  const lower = reasoning.toLowerCase();

  // For buy actions: check if agent ignores negative signals
  if (action === "buy") {
    const positiveSignals = [
      /bullish/i, /upside/i, /growth/i, /opportunity/i, /strong/i,
      /recovery/i, /undervalued/i, /momentum/i, /breakout/i,
    ].filter((p) => p.test(lower)).length;

    const negativeSignals = [
      /bearish/i, /downside/i, /risk/i, /weakness/i, /overvalued/i,
      /decline/i, /loss/i, /concern/i, /resistance/i,
    ].filter((p) => p.test(lower)).length;

    // Check if negative data exists but is ignored
    const negativeStocks = marketData.filter(
      (d) => d.change24h !== null && d.change24h < -2,
    );

    if (positiveSignals >= 3 && negativeSignals === 0 && negativeStocks.length >= 2) {
      return {
        type: "confirmation",
        confidence: 0.7,
        evidence: `Buy reasoning cites ${positiveSignals} positive signals but ignores ${negativeStocks.length} stocks with significant losses (>2% down)`,
        severity: "medium",
        triggers: negativeStocks.map((s) => `${s.symbol}: ${s.change24h?.toFixed(1)}%`),
      };
    }

    if (positiveSignals >= 4 && negativeSignals === 0) {
      return {
        type: "confirmation",
        confidence: 0.6,
        evidence: `Reasoning cites ${positiveSignals} positive signals with zero counterarguments — one-sided analysis`,
        severity: "medium",
        triggers: ["all_positive_no_counterarguments"],
      };
    }
  }

  // For sell actions: check if agent ignores positive signals
  if (action === "sell") {
    const positiveSignals = [
      /bullish/i, /upside/i, /growth/i, /recovery/i, /undervalued/i,
    ].filter((p) => p.test(lower)).length;

    const negativeSignals = [
      /bearish/i, /downside/i, /risk/i, /overvalued/i, /decline/i,
      /loss/i, /overexposed/i, /correction/i, /weakness/i,
    ].filter((p) => p.test(lower)).length;

    if (negativeSignals >= 3 && positiveSignals === 0) {
      return {
        type: "confirmation",
        confidence: 0.6,
        evidence: `Sell reasoning cites ${negativeSignals} negative signals with zero positive counterpoints — one-sided analysis`,
        severity: "medium",
        triggers: ["all_negative_no_counterarguments"],
      };
    }
  }

  return null;
}

/**
 * Detect recency bias: disproportionate weight on recent data.
 */
function detectRecency(reasoning: string): BiasDetection | null {
  const lower = reasoning.toLowerCase();

  const recencyIndicators = [
    /\bjust\b/i,
    /\brecently\b/i,
    /\btoday\b/i,
    /\bjust\s+happened\b/i,
    /\blatest\b/i,
    /\bmost\s+recent\b/i,
    /\bthis\s+morning\b/i,
    /\bright\s+now\b/i,
    /\bcurrently\s+happening\b/i,
    /\bin\s+the\s+last\s+hour\b/i,
  ];

  const longTermIndicators = [
    /\bhistorically\b/i,
    /\blong[\s-]term\b/i,
    /\bover\s+the\s+past\s+\w+\b/i,
    /\bfundamentals?\b/i,
    /\bseasonal/i,
    /\b\d+[\s-]year/i,
    /\bhistorical/i,
  ];

  const recencyCount = recencyIndicators.filter((p) => p.test(lower)).length;
  const longTermCount = longTermIndicators.filter((p) => p.test(lower)).length;

  if (recencyCount >= 3 && longTermCount === 0) {
    const triggers = recencyIndicators
      .filter((p) => p.test(lower))
      .map((p) => {
        const match = lower.match(p);
        return match ? match[0] : "";
      })
      .filter(Boolean);

    return {
      type: "recency",
      confidence: Math.min(0.85, 0.4 + recencyCount * 0.15),
      evidence: `Reasoning uses ${recencyCount} recency terms ("just", "recently", "right now") with zero references to historical or long-term data`,
      severity: recencyCount >= 4 ? "high" : "medium",
      triggers,
    };
  }

  return null;
}

/**
 * Detect sunk cost fallacy: holding/adding based on prior investment.
 */
function detectSunkCost(
  reasoning: string,
  action: string,
  portfolio?: { positions: { symbol: string; unrealizedPnl: number }[] },
): BiasDetection | null {
  const lower = reasoning.toLowerCase();

  // Sunk cost patterns
  const sunkCostPatterns = [
    /already\s+invested/i,
    /averaging\s+down/i,
    /can'?t\s+sell\s+at\s+a\s+loss/i,
    /too\s+much\s+invested/i,
    /wait\s+for\s+(?:it\s+to\s+)?(?:recover|come\s+back)/i,
    /don'?t\s+want\s+to\s+(?:realize|lock\s+in)\s+(?:a\s+)?loss/i,
    /committed\s+to\s+(?:this|the)\s+position/i,
    /initial\s+(?:investment|thesis)\s+still\s+holds/i,
    /doubling\s+down/i,
    /cost\s+basis/i,
  ];

  const matchedPatterns = sunkCostPatterns.filter((p) => p.test(lower));

  if (matchedPatterns.length >= 2) {
    const triggers = matchedPatterns.map((p) => {
      const m = lower.match(p);
      return m ? m[0] : "";
    }).filter(Boolean);

    return {
      type: "sunk_cost",
      confidence: Math.min(0.9, 0.4 + matchedPatterns.length * 0.15),
      evidence: `Reasoning references prior investment ${matchedPatterns.length} times — decision may be influenced by sunk costs rather than current merit`,
      severity: matchedPatterns.length >= 3 ? "high" : "medium",
      triggers,
    };
  }

  // If action is "hold" or "buy" on a losing position with sunk cost language
  if ((action === "hold" || action === "buy") && portfolio) {
    for (const pos of portfolio.positions) {
      if (pos.unrealizedPnl < 0) {
        const symLower = pos.symbol.toLowerCase();
        if (lower.includes(symLower.replace(/x$/i, "")) && matchedPatterns.length >= 1) {
          return {
            type: "sunk_cost",
            confidence: 0.6,
            evidence: `Holding/adding to losing position (${pos.symbol}) with sunk cost language`,
            severity: "medium",
            triggers: matchedPatterns.map((p) => {
              const m = lower.match(p);
              return m ? m[0] : "";
            }).filter(Boolean),
          };
        }
      }
    }
  }

  return null;
}

/**
 * Detect overconfidence bias: high confidence without strong evidence.
 */
function detectOverconfidence(
  reasoning: string,
  confidence: number,
  action: string,
): BiasDetection | null {
  const wordCount = reasoning.split(/\s+/).length;

  // Certainty language
  const certaintyPatterns = [
    /\bdefinitely\b/i,
    /\bcertainly\b/i,
    /\bwithout\s+(?:a\s+)?doubt\b/i,
    /\bguaranteed\b/i,
    /\bobvious(?:ly)?\b/i,
    /\bclear(?:ly)?\b/i,
    /\bno\s+question\b/i,
    /\bsure\s+thing\b/i,
    /\bimpossible\s+(?:to\s+lose|not\s+to)\b/i,
    /\bwill\s+(?:definitely|certainly|absolutely)\b/i,
  ];

  // Hedging language (lack of overconfidence)
  const hedgingPatterns = [
    /\bmight\b/i,
    /\bcould\b/i,
    /\bperhaps\b/i,
    /\buncertain/i,
    /\brisk/i,
    /\bhowever\b/i,
    /\bbut\b/i,
    /\bcaveat\b/i,
    /\bon\s+the\s+other\s+hand\b/i,
    /\bif\b/i,
  ];

  const certaintyCount = certaintyPatterns.filter((p) => p.test(reasoning)).length;
  const hedgingCount = hedgingPatterns.filter((p) => p.test(reasoning)).length;

  // Overconfidence: high confidence + certainty language + no hedging
  if (confidence > 0.8 && certaintyCount >= 2 && hedgingCount === 0) {
    const triggers = certaintyPatterns
      .filter((p) => p.test(reasoning))
      .map((p) => {
        const m = reasoning.match(p);
        return m ? m[0] : "";
      })
      .filter(Boolean);

    return {
      type: "overconfidence",
      confidence: Math.min(0.9, 0.5 + certaintyCount * 0.1 + (confidence - 0.8) * 2),
      evidence: `Confidence ${(confidence * 100).toFixed(0)}% with ${certaintyCount} certainty expressions and zero hedging — overconfidence likely`,
      severity: confidence > 0.9 ? "high" : "medium",
      triggers,
    };
  }

  // Overconfidence: very high confidence with very short reasoning
  if (confidence > 0.85 && wordCount < 20 && action !== "hold") {
    return {
      type: "overconfidence",
      confidence: 0.6,
      evidence: `Confidence ${(confidence * 100).toFixed(0)}% with only ${wordCount} words of reasoning — insufficient evidence for high confidence`,
      severity: "medium",
      triggers: [`confidence: ${confidence}`, `words: ${wordCount}`],
    };
  }

  return null;
}

/**
 * Detect herding bias: reasoning that mirrors other agents' decisions.
 */
function detectHerding(
  reasoning: string,
  action: string,
  otherAgents: RoundAgentContext[],
): BiasDetection | null {
  if (otherAgents.length === 0) return null;

  const lower = reasoning.toLowerCase();

  // Check for explicit references to other agents
  const herdingPatterns = [
    /other\s+agents?\s+(?:are\s+)?(?:buy|sell|hold)ing/i,
    /consensus\s+(?:is\s+)?(?:to\s+)?(?:buy|sell|hold)/i,
    /following\s+(?:the\s+)?(?:market|crowd|trend|others?)/i,
    /everyone\s+(?:is\s+|else\s+is\s+)?(?:buy|sell|hold)ing/i,
    /(?:claude|gpt|grok)\s+(?:is\s+|also\s+)?(?:buy|sell|hold)ing/i,
    /aligning?\s+with\s+(?:the\s+)?(?:consensus|majority|other)/i,
  ];

  const matchedPatterns = herdingPatterns.filter((p) => p.test(lower));

  if (matchedPatterns.length >= 1) {
    const triggers = matchedPatterns.map((p) => {
      const m = lower.match(p);
      return m ? m[0] : "";
    }).filter(Boolean);

    return {
      type: "herding",
      confidence: Math.min(0.85, 0.5 + matchedPatterns.length * 0.15),
      evidence: `Reasoning explicitly references other agents' decisions — herding behavior`,
      severity: matchedPatterns.length >= 2 ? "high" : "medium",
      triggers,
    };
  }

  // Implicit herding: all agents take same action with very similar reasoning
  const sameAction = otherAgents.filter((a) => a.action === action);
  if (sameAction.length === otherAgents.length && otherAgents.length >= 2) {
    // Check reasoning similarity (keyword overlap)
    const myKeywords = new Set(
      lower
        .split(/\s+/)
        .filter((w) => w.length > 4)
        .map((w) => w.replace(/[^a-z]/g, "")),
    );

    let maxOverlap = 0;
    for (const other of sameAction) {
      const otherKeywords = new Set(
        other.reasoning.toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 4)
          .map((w) => w.replace(/[^a-z]/g, "")),
      );

      let overlap = 0;
      for (const k of myKeywords) {
        if (otherKeywords.has(k)) overlap++;
      }

      const overlapRate = myKeywords.size > 0 ? overlap / myKeywords.size : 0;
      if (overlapRate > maxOverlap) maxOverlap = overlapRate;
    }

    if (maxOverlap > 0.6) {
      return {
        type: "herding",
        confidence: 0.5,
        evidence: `All agents took the same action (${action}) with ${(maxOverlap * 100).toFixed(0)}% reasoning keyword overlap — potential implicit herding`,
        severity: "low",
        triggers: [`keyword_overlap: ${(maxOverlap * 100).toFixed(0)}%`],
      };
    }
  }

  return null;
}

/**
 * Detect loss aversion: asymmetric treatment of gains vs losses.
 */
function detectLossAversion(
  reasoning: string,
  action: string,
  portfolio?: { positions: { symbol: string; unrealizedPnl: number; unrealizedPnlPercent: number }[] },
): BiasDetection | null {
  const lower = reasoning.toLowerCase();

  // Loss aversion language patterns
  const lossAversionPatterns = [
    /can'?t\s+afford\s+(?:to\s+)?lose/i,
    /protect\s+(?:my\s+|our\s+)?(?:gains|profits?|capital)/i,
    /lock\s+in\s+(?:profits?|gains)/i,
    /afraid\s+(?:of\s+)?(?:losing|losses?)/i,
    /risk\s+(?:of\s+)?(?:losing|loss)/i,
    /cut\s+(?:my\s+|our\s+)?losses/i,
    /stop[\s-]loss/i,
    /downside\s+protection/i,
  ];

  const gainSeekingPatterns = [
    /maximize\s+(?:profit|gain|return)/i,
    /upside\s+potential/i,
    /growth\s+opportunity/i,
    /could\s+gain/i,
    /potential\s+(?:profit|return|upside)/i,
  ];

  const lossCount = lossAversionPatterns.filter((p) => p.test(lower)).length;
  const gainCount = gainSeekingPatterns.filter((p) => p.test(lower)).length;

  // Strong loss aversion: much more loss language than gain language
  if (lossCount >= 3 && gainCount <= 1) {
    const triggers = lossAversionPatterns
      .filter((p) => p.test(lower))
      .map((p) => {
        const m = lower.match(p);
        return m ? m[0] : "";
      })
      .filter(Boolean);

    return {
      type: "loss_aversion",
      confidence: Math.min(0.85, 0.4 + lossCount * 0.12),
      evidence: `${lossCount} loss-avoidance references vs ${gainCount} gain-seeking — asymmetric risk perception`,
      severity: lossCount >= 4 ? "high" : "medium",
      triggers,
    };
  }

  // Selling small winners too early while holding big losers
  if (action === "sell" && portfolio) {
    const winners = portfolio.positions.filter((p) => p.unrealizedPnlPercent > 0);
    const losers = portfolio.positions.filter((p) => p.unrealizedPnlPercent < -5);

    if (winners.length > 0 && losers.length > 0) {
      // Check if selling a small winner while holding a big loser
      const sellingWinner = winners.some((w) =>
        lower.includes(w.symbol.toLowerCase().replace(/x$/i, "")),
      );
      if (sellingWinner && losers.length > 0) {
        return {
          type: "loss_aversion",
          confidence: 0.5,
          evidence: `Selling winning position while holding ${losers.length} losing position(s) — classic disposition effect (loss aversion)`,
          severity: "low",
          triggers: losers.map((l) => `${l.symbol}: ${l.unrealizedPnlPercent.toFixed(1)}%`),
        };
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main Analysis Function
// ---------------------------------------------------------------------------

/**
 * Run full cognitive bias detection on an agent's reasoning.
 */
export function analyzeBiases(
  reasoning: string,
  action: string,
  confidence: number,
  marketData: MarketData[],
  otherAgents: RoundAgentContext[] = [],
  portfolio?: {
    positions: { symbol: string; quantity: number; unrealizedPnl: number; unrealizedPnlPercent: number }[];
  },
): BiasAnalysisResult {
  const detections: BiasDetection[] = [];

  // Run all detectors
  const anchoring = detectAnchoring(reasoning, marketData);
  if (anchoring) detections.push(anchoring);

  const confirmation = detectConfirmation(reasoning, action, marketData);
  if (confirmation) detections.push(confirmation);

  const recency = detectRecency(reasoning);
  if (recency) detections.push(recency);

  const sunkCost = detectSunkCost(
    reasoning,
    action,
    portfolio ? { positions: portfolio.positions } : undefined,
  );
  if (sunkCost) detections.push(sunkCost);

  const overconfidence = detectOverconfidence(reasoning, confidence, action);
  if (overconfidence) detections.push(overconfidence);

  const herding = detectHerding(reasoning, action, otherAgents);
  if (herding) detections.push(herding);

  const lossAversion = detectLossAversion(
    reasoning,
    action,
    portfolio ? {
      positions: portfolio.positions.map((p) => ({
        symbol: p.symbol,
        unrealizedPnl: p.unrealizedPnl,
        unrealizedPnlPercent: p.unrealizedPnlPercent,
      })),
    } : undefined,
  );
  if (lossAversion) detections.push(lossAversion);

  // Calculate overall bias score
  const severityWeights: Record<string, number> = {
    high: 1.0,
    medium: 0.6,
    low: 0.3,
  };

  let biasScore = 0;
  if (detections.length > 0) {
    const weightedSum = detections.reduce(
      (sum, d) => sum + d.confidence * severityWeights[d.severity],
      0,
    );
    // Normalize: more biases = higher score, but cap at 1.0
    biasScore = Math.min(1.0, weightedSum / 3); // 3 = expected max for "very biased"
  }
  biasScore = Math.round(biasScore * 1000) / 1000;

  // Find dominant bias
  const dominantBias =
    detections.length > 0
      ? detections.sort((a, b) => {
          const aW = a.confidence * severityWeights[a.severity];
          const bW = b.confidence * severityWeights[b.severity];
          return bW - aW;
        })[0].type
      : null;

  // Assessment
  let assessment: string;
  if (detections.length === 0) {
    assessment = "No cognitive biases detected — reasoning appears balanced and evidence-based";
  } else if (biasScore < 0.2) {
    assessment = `Minor bias indicators: ${detections.map((d) => d.type).join(", ")}. Generally balanced reasoning.`;
  } else if (biasScore < 0.5) {
    assessment = `Moderate cognitive bias detected: ${dominantBias}. Reasoning is partially biased by cognitive shortcuts.`;
  } else {
    assessment = `Significant cognitive bias: ${dominantBias}. Decision may be driven by bias rather than evidence.`;
  }

  return {
    biasScore,
    biasCount: detections.length,
    detections,
    assessment,
    dominantBias,
  };
}

// ---------------------------------------------------------------------------
// Recording and Stats
// ---------------------------------------------------------------------------

/**
 * Record a bias analysis result for benchmark tracking.
 */
export function recordBiasResult(
  tradeId: string,
  agentId: string,
  roundId: string,
  result: BiasAnalysisResult,
): void {
  biasHistory.unshift({
    tradeId,
    agentId,
    roundId,
    result,
    timestamp: new Date().toISOString(),
  });
  if (biasHistory.length > MAX_HISTORY) {
    biasHistory.length = MAX_HISTORY;
  }

  // Update per-agent stats
  const stats = agentBiasStats.get(agentId) ?? {
    totalBiases: 0,
    byType: {} as Record<string, number>,
    checks: 0,
    totalScore: 0,
  };
  stats.totalBiases += result.biasCount;
  stats.checks++;
  stats.totalScore += result.biasScore;
  for (const d of result.detections) {
    stats.byType[d.type] = (stats.byType[d.type] ?? 0) + 1;
  }
  agentBiasStats.set(agentId, stats);
}

/** Get recent bias history */
export function getBiasHistory(limit = 50): BiasRecord[] {
  return biasHistory.slice(0, limit);
}

/** Get per-agent bias stats */
export function getAgentBiasStats(): Record<
  string,
  {
    avgBiasScore: number;
    totalBiases: number;
    dominantBias: string | null;
    biasDistribution: Record<string, number>;
    checks: number;
  }
> {
  const result: Record<string, {
    avgBiasScore: number;
    totalBiases: number;
    dominantBias: string | null;
    biasDistribution: Record<string, number>;
    checks: number;
  }> = {};

  for (const [agentId, stats] of agentBiasStats.entries()) {
    const dominant = Object.entries(stats.byType).sort(([, a], [, b]) => b - a)[0];

    result[agentId] = {
      avgBiasScore: stats.checks > 0 ? Math.round((stats.totalScore / stats.checks) * 1000) / 1000 : 0,
      totalBiases: stats.totalBiases,
      dominantBias: dominant ? dominant[0] : null,
      biasDistribution: { ...stats.byType },
      checks: stats.checks,
    };
  }

  return result;
}
