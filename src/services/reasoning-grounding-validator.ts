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
import { round3, countByCondition } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * PRICE CLAIM VERIFICATION THRESHOLDS
 *
 * Control how price deviation is classified in claim verification.
 */

/**
 * Maximum price deviation for "grounded" classification.
 * Claims within 5% of actual price are considered accurate.
 * Example: Claimed $100, actual $102 → 2% deviation → grounded.
 */
const PRICE_DEVIATION_GROUNDED_THRESHOLD = 0.05;

/**
 * Maximum price deviation for "embellished" classification.
 * Claims 5-20% off are roughly correct but overstated.
 * Claims >20% off are classified as "hallucinated".
 * Example: Claimed $100, actual $115 → 15% deviation → embellished.
 */
const PRICE_DEVIATION_EMBELLISHED_THRESHOLD = 0.20;

/**
 * PERCENTAGE CHANGE VERIFICATION THRESHOLDS
 *
 * Control how percentage change claims are classified.
 */

/**
 * Maximum percentage point deviation for "grounded" classification.
 * Claims within ±1.0pp of actual 24h change are accurate.
 * Example: Claimed +3.5%, actual +4.2% → 0.7pp deviation → grounded.
 */
const PERCENTAGE_CHANGE_GROUNDED_THRESHOLD = 1.0;

/**
 * Maximum percentage point deviation for "embellished" classification.
 * Claims 1-3pp off are approximately correct but overstated.
 * Claims >3pp off are classified as "hallucinated".
 * Example: Claimed +5%, actual +7.5% → 2.5pp deviation → embellished.
 */
const PERCENTAGE_CHANGE_EMBELLISHED_THRESHOLD = 3.0;

/**
 * VERIFICATION CONFIDENCE SCORES
 *
 * Confidence levels assigned to different verification outcomes.
 * Higher values = more certain about the verification result.
 */

/** High confidence in grounded price claim (within 5% of actual) */
const CONFIDENCE_PRICE_GROUNDED = 0.95;

/** Moderate confidence in embellished price claim (5-20% deviation) */
const CONFIDENCE_PRICE_EMBELLISHED = 0.7;

/** High confidence in hallucinated price claim (>20% deviation) */
const CONFIDENCE_PRICE_HALLUCINATED = 0.9;

/** High confidence symbol not found in provided data (ungrounded) */
const CONFIDENCE_SYMBOL_NOT_FOUND = 0.8;

/** High confidence in grounded percentage claim (within ±1pp) */
const CONFIDENCE_PERCENTAGE_GROUNDED = 0.9;

/** Moderate confidence in embellished percentage claim (1-3pp off) */
const CONFIDENCE_PERCENTAGE_EMBELLISHED = 0.6;

/** High confidence in hallucinated percentage claim (>3pp off) */
const CONFIDENCE_PERCENTAGE_HALLUCINATED = 0.8;

/** Moderate confidence in no change data available (ungrounded) */
const CONFIDENCE_NO_CHANGE_DATA = 0.7;

/** Moderate confidence in grounded volume claim (qualitative) */
const CONFIDENCE_VOLUME_GROUNDED = 0.7;

/** Moderate confidence in ungrounded volume claim */
const CONFIDENCE_VOLUME_UNGROUNDED = 0.6;

/** Moderate confidence in inferred trend claim (from price data) */
const CONFIDENCE_TREND_INFERRED = 0.6;

/** Moderate confidence in ungrounded trend claim */
const CONFIDENCE_TREND_UNGROUNDED = 0.5;

/** Moderate confidence in grounded comparison claim (both symbols available) */
const CONFIDENCE_COMPARISON_GROUNDED = 0.7;

/** Low confidence in inferred comparison claim (partial data) */
const CONFIDENCE_COMPARISON_INFERRED = 0.4;

/** Moderate confidence in inferred technical claim (with source) */
const CONFIDENCE_TECHNICAL_INFERRED = 0.5;

/** Moderate confidence in ungrounded technical claim (no data) */
const CONFIDENCE_TECHNICAL_UNGROUNDED = 0.7;

/** Moderate confidence in grounded news claim (news data provided) */
const CONFIDENCE_NEWS_GROUNDED = 0.7;

/** Moderate confidence in ungrounded news claim (no news data) */
const CONFIDENCE_NEWS_UNGROUNDED = 0.6;

/** Low confidence in inferred news claim (news feed cited but not verified) */
const CONFIDENCE_NEWS_INFERRED = 0.4;

/** Low confidence in unparseable or general claims (default inference) */
const CONFIDENCE_GENERAL_INFERRED = 0.3;

/** Moderate confidence in inference when change data null */
const CONFIDENCE_CHANGE_DATA_NULL = 0.5;

/**
 * STATUS WEIGHT MULTIPLIERS
 *
 * Weights applied to different verification statuses when computing
 * the overall grounding score. Lower weights penalize fabrication.
 */

/** Weight for grounded claims (fully verified against data) */
const STATUS_WEIGHT_GROUNDED = 1.0;

/** Weight for inferred claims (reasonable deduction from available data) */
const STATUS_WEIGHT_INFERRED = 0.7;

/** Weight for embellished claims (true but overstated) */
const STATUS_WEIGHT_EMBELLISHED = 0.4;

/** Weight for ungrounded claims (references unavailable data) */
const STATUS_WEIGHT_UNGROUNDED = 0.1;

/** Weight for hallucinated claims (incorrect facts) */
const STATUS_WEIGHT_HALLUCINATED = 0.0;

/**
 * GROUNDING SCORE CLASSIFICATION THRESHOLDS
 *
 * Thresholds for assessing overall grounding quality.
 */

/** Grounding score threshold for "well-grounded" assessment (≥80%) */
const GROUNDING_SCORE_EXCELLENT_THRESHOLD = 0.8;

/** Grounding score threshold for "partially grounded" assessment (≥50%) */
const GROUNDING_SCORE_ADEQUATE_THRESHOLD = 0.5;

/** Grounding score threshold for "poorly grounded" assessment (≥30%) */
const GROUNDING_SCORE_MINIMAL_THRESHOLD = 0.3;

/** Default score when no factual claims found (opinion-based reasoning) */
const GROUNDING_SCORE_NO_CLAIMS_DEFAULT = 0.8;

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
          verificationConfidence: CONFIDENCE_GENERAL_INFERRED,
          explanation: "Price claim without parseable symbol or value",
        };
      }

      const realPrice = priceMap.get(symbolLower);
      if (realPrice === undefined) {
        return {
          claim,
          status: "ungrounded",
          verificationConfidence: CONFIDENCE_SYMBOL_NOT_FOUND,
          explanation: `Symbol ${claim.symbol} not found in provided market data — claim references unavailable data`,
        };
      }

      const deviation = Math.abs(claim.value - realPrice) / realPrice;
      if (deviation <= PRICE_DEVIATION_GROUNDED_THRESHOLD) {
        return {
          claim,
          status: "grounded",
          verificationConfidence: CONFIDENCE_PRICE_GROUNDED,
          explanation: `Price claim matches market data within ${PRICE_DEVIATION_GROUNDED_THRESHOLD * 100}% (claimed $${claim.value}, actual $${realPrice.toFixed(2)})`,
          groundTruth: `$${realPrice.toFixed(2)}`,
        };
      } else if (deviation <= PRICE_DEVIATION_EMBELLISHED_THRESHOLD) {
        return {
          claim,
          status: "embellished",
          verificationConfidence: CONFIDENCE_PRICE_EMBELLISHED,
          explanation: `Price claim roughly correct but ${(deviation * 100).toFixed(0)}% off (claimed $${claim.value}, actual $${realPrice.toFixed(2)})`,
          groundTruth: `$${realPrice.toFixed(2)}`,
        };
      } else {
        return {
          claim,
          status: "hallucinated",
          verificationConfidence: CONFIDENCE_PRICE_HALLUCINATED,
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
          verificationConfidence: CONFIDENCE_GENERAL_INFERRED,
          explanation: "Percentage claim without parseable symbol or value",
        };
      }

      const realChange = changeMap.get(symbolLower);
      if (realChange === undefined) {
        return {
          claim,
          status: "ungrounded",
          verificationConfidence: CONFIDENCE_NO_CHANGE_DATA,
          explanation: `No 24h change data available for ${claim.symbol}`,
        };
      }

      if (realChange === null) {
        // Data exists but change is unknown — reasonable inference allowed
        return {
          claim,
          status: "inferred",
          verificationConfidence: CONFIDENCE_CHANGE_DATA_NULL,
          explanation: `24h change data not available for ${claim.symbol} — inference from other data possible`,
        };
      }

      const changeDev = Math.abs(claim.value - realChange);
      if (changeDev <= PERCENTAGE_CHANGE_GROUNDED_THRESHOLD) {
        return {
          claim,
          status: "grounded",
          verificationConfidence: CONFIDENCE_PERCENTAGE_GROUNDED,
          explanation: `Percentage claim matches 24h change data (claimed ${claim.value}%, actual ${realChange.toFixed(2)}%)`,
          groundTruth: `${realChange.toFixed(2)}%`,
        };
      } else if (changeDev <= PERCENTAGE_CHANGE_EMBELLISHED_THRESHOLD) {
        return {
          claim,
          status: "embellished",
          verificationConfidence: CONFIDENCE_PERCENTAGE_EMBELLISHED,
          explanation: `Percentage claim approximately correct but off by ${changeDev.toFixed(1)}pp`,
          groundTruth: `${realChange.toFixed(2)}%`,
        };
      } else {
        return {
          claim,
          status: "hallucinated",
          verificationConfidence: CONFIDENCE_PERCENTAGE_HALLUCINATED,
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
          verificationConfidence: CONFIDENCE_GENERAL_INFERRED,
          explanation: "Volume claim without parseable symbol",
        };
      }

      const realVolume = volumeMap.get(symbolLower);
      if (realVolume === undefined || realVolume === null) {
        return {
          claim,
          status: "ungrounded",
          verificationConfidence: CONFIDENCE_VOLUME_UNGROUNDED,
          explanation: `No volume data available for ${claim.symbol} — claim references unavailable data`,
        };
      }

      // Volume claims are typically qualitative, so be lenient
      return {
        claim,
        status: "grounded",
        verificationConfidence: CONFIDENCE_VOLUME_GROUNDED,
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
          verificationConfidence: CONFIDENCE_TREND_INFERRED,
          explanation: `Trend claim for available symbol ${claim.symbol} — reasonable inference from price data`,
        };
      }
      return {
        claim,
        status: "ungrounded",
        verificationConfidence: CONFIDENCE_TREND_UNGROUNDED,
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
            verificationConfidence: CONFIDENCE_COMPARISON_GROUNDED,
            explanation: `Both symbols in comparison are in the available dataset`,
          };
        }
      }
      return {
        claim,
        status: "inferred",
        verificationConfidence: CONFIDENCE_COMPARISON_INFERRED,
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
          verificationConfidence: CONFIDENCE_TECHNICAL_INFERRED,
          explanation: "Technical indicator claim — agent cites technical indicators as a source",
        };
      }
      return {
        claim,
        status: "ungrounded",
        verificationConfidence: CONFIDENCE_TECHNICAL_UNGROUNDED,
        explanation: "Technical indicator claim without technical data being provided",
      };
    }

    case "news": {
      // Check if news was actually provided for the symbol
      if (symbolLower && newsAvailable.has(symbolLower)) {
        return {
          claim,
          status: "grounded",
          verificationConfidence: CONFIDENCE_NEWS_GROUNDED,
          explanation: `News data was provided for ${claim.symbol}`,
        };
      }
      if (providedSources.includes("news_feed")) {
        return {
          claim,
          status: "inferred",
          verificationConfidence: CONFIDENCE_NEWS_INFERRED,
          explanation: "News claim — agent cites news feed but specific news not verified",
        };
      }
      return {
        claim,
        status: "ungrounded",
        verificationConfidence: CONFIDENCE_NEWS_UNGROUNDED,
        explanation: "News claim without news data being provided to agent",
      };
    }

    default:
      return {
        claim,
        status: "inferred",
        verificationConfidence: CONFIDENCE_GENERAL_INFERRED,
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

  const groundedClaims = countByCondition(verifications, (v) => v.status === "grounded");
  const ungroundedClaims = countByCondition(verifications, (v) => v.status === "ungrounded");
  const hallucinatedClaims = countByCondition(verifications, (v) => v.status === "hallucinated");
  const embellishedClaims = countByCondition(verifications, (v) => v.status === "embellished");
  const inferredClaims = countByCondition(verifications, (v) => v.status === "inferred");

  // Grounding score: weighted by severity
  // Grounded = 1.0, Inferred = 0.7, Embellished = 0.4, Ungrounded = 0.1, Hallucinated = 0.0
  let weightedSum = 0;
  let totalWeight = 0;
  for (const v of verifications) {
    const weight = v.verificationConfidence;
    totalWeight += weight;
    switch (v.status) {
      case "grounded":
        weightedSum += weight * STATUS_WEIGHT_GROUNDED;
        break;
      case "inferred":
        weightedSum += weight * STATUS_WEIGHT_INFERRED;
        break;
      case "embellished":
        weightedSum += weight * STATUS_WEIGHT_EMBELLISHED;
        break;
      case "ungrounded":
        weightedSum += weight * STATUS_WEIGHT_UNGROUNDED;
        break;
      case "hallucinated":
        weightedSum += weight * STATUS_WEIGHT_HALLUCINATED;
        break;
    }
  }

  const groundingScore =
    totalWeight > 0
      ? round3(weightedSum / totalWeight)
      : claims.length === 0
        ? GROUNDING_SCORE_NO_CLAIMS_DEFAULT // No factual claims = neutral (reasoning is opinion-based)
        : 1.0;

  // Build assessment
  let assessment: string;
  if (claims.length === 0) {
    assessment = "No verifiable factual claims found in reasoning — opinion-based analysis";
  } else if (groundingScore >= GROUNDING_SCORE_EXCELLENT_THRESHOLD) {
    assessment = "Reasoning is well-grounded in available market data";
  } else if (groundingScore >= GROUNDING_SCORE_ADEQUATE_THRESHOLD) {
    assessment = "Reasoning is partially grounded — some claims lack data support";
  } else if (groundingScore >= GROUNDING_SCORE_MINIMAL_THRESHOLD) {
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
      avgGroundingScore: round3(avgScore),
      totalClaims: stats.totalClaims,
      groundedRate: stats.totalClaims > 0 ? round3(stats.groundedClaims / stats.totalClaims) : 0,
      hallucinationRate: stats.totalClaims > 0 ? round3(stats.hallucinatedClaims / stats.totalClaims) : 0,
      checks: stats.checks,
    };
  }

  return result;
}
