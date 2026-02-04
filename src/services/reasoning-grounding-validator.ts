/**
 * Reasoning Grounding Validator (v22)
 *
 * Validates that agent reasoning is GROUNDED in real data, not fabricated.
 * Goes beyond hallucination detection (which checks price claims) to verify:
 *
 * 1. CLAIM EXTRACTION: Identify every factual claim in reasoning text
 *    (prices, percentages, trends, comparisons, volume claims, news references)
 *
 * 2. SOURCE VERIFICATION: Cross-reference each claim against the market data
 *    that was actually provided to the agent. Claims about data not shown
 *    to the agent are flagged as "ungrounded".
 *
 * 3. GROUNDING SCORE: Ratio of verifiable claims to total claims.
 *    High grounding = agent only reasons about data it actually has.
 *    Low grounding = agent invents facts or references unavailable data.
 *
 * 4. FABRICATION DETECTION: Distinguishes between:
 *    - Hallucination: Incorrect factual claim (wrong price)
 *    - Fabrication: Claim about data that was never provided
 *    - Embellishment: True claim that overstates the evidence
 *    - Inference: Reasonable deduction from available data (acceptable)
 *
 * This is a v22 benchmark pillar: "Reasoning Grounding" — measuring whether
 * agents reason FROM evidence rather than inventing evidence for their conclusions.
 */

import type { MarketData } from "../agents/base-agent.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FactualClaim {
  /** The claim text extracted from reasoning */
  text: string;
  /** Type of claim */
  type: "price" | "percentage" | "trend" | "comparison" | "volume" | "news" | "technical" | "general";
  /** Symbol referenced, if any */
  symbol?: string;
  /** Numeric value claimed, if any */
  value?: number;
  /** Position in reasoning text */
  position: number;
}

export interface ClaimVerification {
  claim: FactualClaim;
  /** Verification result */
  status: "grounded" | "ungrounded" | "hallucinated" | "embellished" | "inferred";
  /** Confidence in the verification */
  verificationConfidence: number;
  /** Explanation of the verification result */
  explanation: string;
  /** The actual data that the claim should reference, if available */
  groundTruth?: string;
}

export interface GroundingResult {
  /** Overall grounding score: 0.0 (fully fabricated) to 1.0 (fully grounded) */
  groundingScore: number;
  /** Total claims extracted */
  totalClaims: number;
  /** Claims verified as grounded */
  groundedClaims: number;
  /** Claims that reference unavailable data */
  ungroundedClaims: number;
  /** Claims with incorrect facts */
  hallucinatedClaims: number;
  /** Claims that overstate evidence */
  embellishedClaims: number;
  /** Reasonable inferences (acceptable) */
  inferredClaims: number;
  /** Individual claim verifications */
  verifications: ClaimVerification[];
  /** Summary assessment */
  assessment: string;
}

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------

interface GroundingRecord {
  tradeId: string;
  agentId: string;
  roundId: string;
  result: GroundingResult;
  timestamp: string;
}

const groundingHistory: GroundingRecord[] = [];
const MAX_HISTORY = 500;

// Per-agent stats
const agentGroundingStats = new Map<
  string,
  { totalClaims: number; groundedClaims: number; hallucinatedClaims: number; checks: number }
>();

// ---------------------------------------------------------------------------
// Claim Extraction
// ---------------------------------------------------------------------------

/**
 * Extract factual claims from agent reasoning text.
 * Identifies prices, percentages, trends, comparisons, volume claims,
 * and news references that can be verified against market data.
 */
export function extractClaims(reasoning: string): FactualClaim[] {
  const claims: FactualClaim[] = [];
  const seen = new Set<string>();

  // Price claims: "$178.50", "priced at 250", "trading at $505"
  const pricePatterns = [
    /(\w+x?)\s+(?:is\s+)?(?:at|priced?\s+at|trading\s+at|currently\s+at|around)\s+\$?([\d,]+\.?\d*)/gi,
    /\$?([\d,]+\.?\d*)\s+(?:per\s+share|price)\s+(?:for|of)\s+(\w+x?)/gi,
    /(\w+x?)\s+price\s+(?:is\s+|of\s+)?\$?([\d,]+\.?\d*)/gi,
  ];

  for (const pattern of pricePatterns) {
    let match;
    while ((match = pattern.exec(reasoning)) !== null) {
      const key = `price_${match.index}`;
      if (!seen.has(key)) {
        seen.add(key);
        const isReversed = pattern === pricePatterns[1];
        claims.push({
          text: match[0],
          type: "price",
          symbol: isReversed ? match[2] : match[1],
          value: parseFloat((isReversed ? match[1] : match[2]).replace(/,/g, "")),
          position: match.index,
        });
      }
    }
  }

  // Percentage claims: "+3.2%", "-1.5%", "up 4%", "down 2.3%"
  const pctPatterns = [
    /(\w+x?)\s+(?:is\s+)?(?:up|down|changed?|moved?)\s+(?:by\s+)?([+-]?\d+\.?\d*)%/gi,
    /([+-]?\d+\.?\d*)\s*%\s+(?:change|gain|loss|increase|decrease|move)\s+(?:for|in|on)\s+(\w+x?)/gi,
    /(\w+x?)\s+(?:24h|daily)\s+(?:change|return)\s+(?:of\s+|is\s+)?([+-]?\d+\.?\d*)%/gi,
  ];

  for (const pattern of pctPatterns) {
    let match;
    while ((match = pattern.exec(reasoning)) !== null) {
      const key = `pct_${match.index}`;
      if (!seen.has(key)) {
        seen.add(key);
        const isReversed = pattern === pctPatterns[1];
        claims.push({
          text: match[0],
          type: "percentage",
          symbol: isReversed ? match[2] : match[1],
          value: parseFloat(isReversed ? match[1] : match[2]),
          position: match.index,
        });
      }
    }
  }

  // Volume claims: "volume of $5M", "high volume", "2x average volume"
  const volumePatterns = [
    /(\w+x?)\s+volume\s+(?:is\s+|of\s+)?\$?([\d,]+\.?\d*)\s*[MBK]?/gi,
    /(\w+x?)\s+(?:has\s+)?(?:high|low|elevated|above[\s-]average|below[\s-]average)\s+volume/gi,
    /(\d+\.?\d*)\s*x\s+(?:average\s+)?volume\s+(?:for|on|in)\s+(\w+x?)/gi,
  ];

  for (const pattern of volumePatterns) {
    let match;
    while ((match = pattern.exec(reasoning)) !== null) {
      const key = `vol_${match.index}`;
      if (!seen.has(key)) {
        seen.add(key);
        claims.push({
          text: match[0],
          type: "volume",
          symbol: match[1],
          position: match.index,
        });
      }
    }
  }

  // Trend claims: "uptrend", "bearish trend", "momentum is bullish"
  const trendPatterns = [
    /(\w+x?)\s+(?:is\s+)?(?:in\s+(?:an?\s+)?)?(?:uptrend|downtrend|bullish\s+trend|bearish\s+trend|positive\s+momentum|negative\s+momentum)/gi,
    /(?:uptrend|downtrend|bullish|bearish)\s+(?:trend|momentum)\s+(?:for|in|on)\s+(\w+x?)/gi,
  ];

  for (const pattern of trendPatterns) {
    let match;
    while ((match = pattern.exec(reasoning)) !== null) {
      const key = `trend_${match.index}`;
      if (!seen.has(key)) {
        seen.add(key);
        claims.push({
          text: match[0],
          type: "trend",
          symbol: match[1],
          position: match.index,
        });
      }
    }
  }

  // Comparison claims: "outperforming", "cheaper than", "higher than"
  const compPatterns = [
    /(\w+x?)\s+(?:is\s+)?(?:outperforming|underperforming|cheaper\s+than|more\s+expensive\s+than|higher\s+than|lower\s+than)\s+(\w+x?)/gi,
  ];

  for (const pattern of compPatterns) {
    let match;
    while ((match = pattern.exec(reasoning)) !== null) {
      const key = `comp_${match.index}`;
      if (!seen.has(key)) {
        seen.add(key);
        claims.push({
          text: match[0],
          type: "comparison",
          symbol: match[1],
          position: match.index,
        });
      }
    }
  }

  // Technical indicator claims: "RSI at 70", "above 200-day MA", "MACD crossover"
  const techPatterns = [
    /RSI\s+(?:is\s+)?(?:at\s+)?(\d+\.?\d*)/gi,
    /(?:above|below)\s+(?:the\s+)?(?:\d+[\s-]?day\s+)?(?:moving\s+average|MA|SMA|EMA)/gi,
    /MACD\s+(?:bullish|bearish)\s+crossover/gi,
    /(?:overbought|oversold)\s+(?:territory|levels?|zone)/gi,
  ];

  for (const pattern of techPatterns) {
    let match;
    while ((match = pattern.exec(reasoning)) !== null) {
      const key = `tech_${match.index}`;
      if (!seen.has(key)) {
        seen.add(key);
        claims.push({
          text: match[0],
          type: "technical",
          position: match.index,
        });
      }
    }
  }

  // News claims: "earnings report", "announced", "according to news"
  const newsPatterns = [
    /(?:earnings|revenue|profit)\s+(?:report|announcement|beat|miss|surprise)/gi,
    /(?:according\s+to|based\s+on)\s+(?:news|reports?|headlines?|articles?)/gi,
    /(?:announced|reported|disclosed|filed)\s+(?:\w+\s+){0,3}(?:earnings|acquisition|partnership|layoffs|expansion)/gi,
  ];

  for (const pattern of newsPatterns) {
    let match;
    while ((match = pattern.exec(reasoning)) !== null) {
      const key = `news_${match.index}`;
      if (!seen.has(key)) {
        seen.add(key);
        claims.push({
          text: match[0],
          type: "news",
          position: match.index,
        });
      }
    }
  }

  return claims;
}

// ---------------------------------------------------------------------------
// Claim Verification
// ---------------------------------------------------------------------------

/**
 * Verify a single claim against available market data.
 */
function verifyClaim(
  claim: FactualClaim,
  marketData: MarketData[],
  providedSources: string[],
): ClaimVerification {
  // Build lookup maps
  const priceMap = new Map<string, number>();
  const changeMap = new Map<string, number | null>();
  const volumeMap = new Map<string, number | null>();
  const availableSymbols = new Set<string>();
  const newsAvailable = new Set<string>();

  for (const d of marketData) {
    const lower = d.symbol.toLowerCase();
    const base = lower.replace(/x$/i, "");
    priceMap.set(lower, d.price);
    priceMap.set(base, d.price);
    changeMap.set(lower, d.change24h);
    changeMap.set(base, d.change24h);
    volumeMap.set(lower, d.volume24h);
    volumeMap.set(base, d.volume24h);
    availableSymbols.add(lower);
    availableSymbols.add(base);
    if (d.news && d.news.length > 0) {
      newsAvailable.add(lower);
      newsAvailable.add(base);
    }
  }

  const symbolLower = claim.symbol?.toLowerCase();

  switch (claim.type) {
    case "price": {
      if (!symbolLower || !claim.value) {
        return {
          claim,
          status: "inferred",
          verificationConfidence: 0.3,
          explanation: "Price claim without parseable symbol or value",
        };
      }

      const realPrice = priceMap.get(symbolLower);
      if (realPrice === undefined) {
        return {
          claim,
          status: "ungrounded",
          verificationConfidence: 0.8,
          explanation: `Symbol ${claim.symbol} not found in provided market data — claim references unavailable data`,
        };
      }

      const deviation = Math.abs(claim.value - realPrice) / realPrice;
      if (deviation <= 0.05) {
        return {
          claim,
          status: "grounded",
          verificationConfidence: 0.95,
          explanation: `Price claim matches market data within 5% (claimed $${claim.value}, actual $${realPrice.toFixed(2)})`,
          groundTruth: `$${realPrice.toFixed(2)}`,
        };
      } else if (deviation <= 0.20) {
        return {
          claim,
          status: "embellished",
          verificationConfidence: 0.7,
          explanation: `Price claim roughly correct but ${(deviation * 100).toFixed(0)}% off (claimed $${claim.value}, actual $${realPrice.toFixed(2)})`,
          groundTruth: `$${realPrice.toFixed(2)}`,
        };
      } else {
        return {
          claim,
          status: "hallucinated",
          verificationConfidence: 0.9,
          explanation: `Price claim ${(deviation * 100).toFixed(0)}% off reality (claimed $${claim.value}, actual $${realPrice.toFixed(2)})`,
          groundTruth: `$${realPrice.toFixed(2)}`,
        };
      }
    }

    case "percentage": {
      if (!symbolLower || claim.value === undefined) {
        return {
          claim,
          status: "inferred",
          verificationConfidence: 0.3,
          explanation: "Percentage claim without parseable symbol or value",
        };
      }

      const realChange = changeMap.get(symbolLower);
      if (realChange === undefined) {
        return {
          claim,
          status: "ungrounded",
          verificationConfidence: 0.7,
          explanation: `No 24h change data available for ${claim.symbol}`,
        };
      }

      if (realChange === null) {
        // Data exists but change is unknown — reasonable inference allowed
        return {
          claim,
          status: "inferred",
          verificationConfidence: 0.5,
          explanation: `24h change data not available for ${claim.symbol} — inference from other data possible`,
        };
      }

      const changeDev = Math.abs(claim.value - realChange);
      if (changeDev <= 1.0) {
        return {
          claim,
          status: "grounded",
          verificationConfidence: 0.9,
          explanation: `Percentage claim matches 24h change data (claimed ${claim.value}%, actual ${realChange.toFixed(2)}%)`,
          groundTruth: `${realChange.toFixed(2)}%`,
        };
      } else if (changeDev <= 3.0) {
        return {
          claim,
          status: "embellished",
          verificationConfidence: 0.6,
          explanation: `Percentage claim approximately correct but off by ${changeDev.toFixed(1)}pp`,
          groundTruth: `${realChange.toFixed(2)}%`,
        };
      } else {
        return {
          claim,
          status: "hallucinated",
          verificationConfidence: 0.8,
          explanation: `Percentage claim significantly off (claimed ${claim.value}%, actual ${realChange.toFixed(2)}%)`,
          groundTruth: `${realChange.toFixed(2)}%`,
        };
      }
    }

    case "volume": {
      if (!symbolLower) {
        return {
          claim,
          status: "inferred",
          verificationConfidence: 0.3,
          explanation: "Volume claim without parseable symbol",
        };
      }

      const realVolume = volumeMap.get(symbolLower);
      if (realVolume === undefined || realVolume === null) {
        return {
          claim,
          status: "ungrounded",
          verificationConfidence: 0.6,
          explanation: `No volume data available for ${claim.symbol} — claim references unavailable data`,
        };
      }

      // Volume claims are typically qualitative, so be lenient
      return {
        claim,
        status: "grounded",
        verificationConfidence: 0.7,
        explanation: `Volume data is available for ${claim.symbol}`,
        groundTruth: `$${(realVolume / 1_000_000).toFixed(1)}M`,
      };
    }

    case "trend": {
      // Trends are inferences from price data — grounded if symbol exists
      if (symbolLower && availableSymbols.has(symbolLower)) {
        return {
          claim,
          status: "inferred",
          verificationConfidence: 0.6,
          explanation: `Trend claim for available symbol ${claim.symbol} — reasonable inference from price data`,
        };
      }
      return {
        claim,
        status: "ungrounded",
        verificationConfidence: 0.5,
        explanation: `Trend claim for symbol not in available data`,
      };
    }

    case "comparison": {
      // Comparisons need both symbols in the dataset
      const parts = claim.text.match(/(\w+x?)\s+\w+\s+(\w+x?)/i);
      if (parts) {
        const sym1 = parts[1].toLowerCase();
        const sym2 = parts[2].toLowerCase();
        if (availableSymbols.has(sym1) && availableSymbols.has(sym2)) {
          return {
            claim,
            status: "grounded",
            verificationConfidence: 0.7,
            explanation: `Both symbols in comparison are in the available dataset`,
          };
        }
      }
      return {
        claim,
        status: "inferred",
        verificationConfidence: 0.4,
        explanation: `Comparison claim — partial data available`,
      };
    }

    case "technical": {
      // Technical indicators are NOT provided in market data — always ungrounded
      // unless agent cites "technical_indicators" as a source
      if (providedSources.includes("technical_indicators")) {
        return {
          claim,
          status: "inferred",
          verificationConfidence: 0.5,
          explanation: "Technical indicator claim — agent cites technical indicators as a source",
        };
      }
      return {
        claim,
        status: "ungrounded",
        verificationConfidence: 0.7,
        explanation: "Technical indicator claim without technical data being provided",
      };
    }

    case "news": {
      // Check if news was actually provided for the symbol
      if (symbolLower && newsAvailable.has(symbolLower)) {
        return {
          claim,
          status: "grounded",
          verificationConfidence: 0.7,
          explanation: `News data was provided for ${claim.symbol}`,
        };
      }
      if (providedSources.includes("news_feed")) {
        return {
          claim,
          status: "inferred",
          verificationConfidence: 0.4,
          explanation: "News claim — agent cites news feed but specific news not verified",
        };
      }
      return {
        claim,
        status: "ungrounded",
        verificationConfidence: 0.6,
        explanation: "News claim without news data being provided to agent",
      };
    }

    default:
      return {
        claim,
        status: "inferred",
        verificationConfidence: 0.3,
        explanation: "General claim — insufficient data for verification",
      };
  }
}

// ---------------------------------------------------------------------------
// Main Analysis Function
// ---------------------------------------------------------------------------

/**
 * Run full grounding validation on an agent's reasoning.
 *
 * @param reasoning - The agent's full reasoning text
 * @param marketData - The market data that was provided to the agent
 * @param citedSources - The sources the agent claimed to use
 * @returns GroundingResult with detailed verification of each claim
 */
export function validateGrounding(
  reasoning: string,
  marketData: MarketData[],
  citedSources: string[],
): GroundingResult {
  const claims = extractClaims(reasoning);
  const verifications = claims.map((c) => verifyClaim(c, marketData, citedSources));

  const groundedClaims = verifications.filter((v) => v.status === "grounded").length;
  const ungroundedClaims = verifications.filter((v) => v.status === "ungrounded").length;
  const hallucinatedClaims = verifications.filter((v) => v.status === "hallucinated").length;
  const embellishedClaims = verifications.filter((v) => v.status === "embellished").length;
  const inferredClaims = verifications.filter((v) => v.status === "inferred").length;

  // Grounding score: weighted by severity
  // Grounded = 1.0, Inferred = 0.7, Embellished = 0.4, Ungrounded = 0.1, Hallucinated = 0.0
  let weightedSum = 0;
  let totalWeight = 0;
  for (const v of verifications) {
    const weight = v.verificationConfidence;
    totalWeight += weight;
    switch (v.status) {
      case "grounded":
        weightedSum += weight * 1.0;
        break;
      case "inferred":
        weightedSum += weight * 0.7;
        break;
      case "embellished":
        weightedSum += weight * 0.4;
        break;
      case "ungrounded":
        weightedSum += weight * 0.1;
        break;
      case "hallucinated":
        weightedSum += weight * 0.0;
        break;
    }
  }

  const groundingScore =
    totalWeight > 0
      ? Math.round((weightedSum / totalWeight) * 1000) / 1000
      : claims.length === 0
        ? 0.8 // No factual claims = neutral (reasoning is opinion-based)
        : 1.0;

  // Build assessment
  let assessment: string;
  if (claims.length === 0) {
    assessment = "No verifiable factual claims found in reasoning — opinion-based analysis";
  } else if (groundingScore >= 0.8) {
    assessment = "Reasoning is well-grounded in available market data";
  } else if (groundingScore >= 0.5) {
    assessment = "Reasoning is partially grounded — some claims lack data support";
  } else if (groundingScore >= 0.3) {
    assessment = "Reasoning is poorly grounded — significant fabrication or unverifiable claims";
  } else {
    assessment = "Reasoning is largely ungrounded — agent appears to fabricate data";
  }

  return {
    groundingScore,
    totalClaims: claims.length,
    groundedClaims,
    ungroundedClaims,
    hallucinatedClaims,
    embellishedClaims,
    inferredClaims,
    verifications,
    assessment,
  };
}

// ---------------------------------------------------------------------------
// Recording and Stats
// ---------------------------------------------------------------------------

/**
 * Record a grounding validation result for benchmark tracking.
 */
export function recordGroundingResult(
  tradeId: string,
  agentId: string,
  roundId: string,
  result: GroundingResult,
): void {
  groundingHistory.unshift({
    tradeId,
    agentId,
    roundId,
    result,
    timestamp: new Date().toISOString(),
  });
  if (groundingHistory.length > MAX_HISTORY) {
    groundingHistory.length = MAX_HISTORY;
  }

  // Update per-agent stats
  const stats = agentGroundingStats.get(agentId) ?? {
    totalClaims: 0,
    groundedClaims: 0,
    hallucinatedClaims: 0,
    checks: 0,
  };
  stats.totalClaims += result.totalClaims;
  stats.groundedClaims += result.groundedClaims;
  stats.hallucinatedClaims += result.hallucinatedClaims;
  stats.checks++;
  agentGroundingStats.set(agentId, stats);
}

/** Get recent grounding history */
export function getGroundingHistory(limit = 50): GroundingRecord[] {
  return groundingHistory.slice(0, limit);
}

/** Get per-agent grounding stats */
export function getAgentGroundingStats(): Record<
  string,
  {
    avgGroundingScore: number;
    totalClaims: number;
    groundedRate: number;
    hallucinationRate: number;
    checks: number;
  }
> {
  const result: Record<string, {
    avgGroundingScore: number;
    totalClaims: number;
    groundedRate: number;
    hallucinationRate: number;
    checks: number;
  }> = {};

  for (const [agentId, stats] of agentGroundingStats.entries()) {
    const agentRecords = groundingHistory.filter((r) => r.agentId === agentId);
    const avgScore =
      agentRecords.length > 0
        ? agentRecords.reduce((s, r) => s + r.result.groundingScore, 0) / agentRecords.length
        : 0;

    result[agentId] = {
      avgGroundingScore: Math.round(avgScore * 1000) / 1000,
      totalClaims: stats.totalClaims,
      groundedRate: stats.totalClaims > 0 ? Math.round((stats.groundedClaims / stats.totalClaims) * 1000) / 1000 : 0,
      hallucinationRate: stats.totalClaims > 0 ? Math.round((stats.hallucinatedClaims / stats.totalClaims) * 1000) / 1000 : 0,
      checks: stats.checks,
    };
  }

  return result;
}
