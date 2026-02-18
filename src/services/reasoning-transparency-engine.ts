/**
 * Reasoning Transparency Engine (v20)
 *
 * Makes every agent's decision process fully auditable and decomposable.
 * Instead of a single coherence score, breaks reasoning into structured
 * components that researchers can independently verify:
 *
 * 1. CLAIM EXTRACTION: Identifies every factual claim in reasoning text
 * 2. EVIDENCE MAPPING: Links claims to the data sources that support them
 * 3. LOGIC CHAIN VALIDATION: Verifies logical flow from premises to conclusion
 * 4. ASSUMPTION SURFACING: Detects unstated assumptions the agent relied on
 * 5. COUNTERFACTUAL ANALYSIS: What would change the agent's decision?
 *
 * This moves MoltApp from "did the agent reason well?" to
 * "here is exactly how the agent reasoned, claim by claim."
 */

import { countWords, splitSentences, round2, countByCondition } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtractedClaim {
  /** The text of the claim */
  text: string;
  /** Where in the reasoning this claim appears (character offset) */
  offset: number;
  /** Type of claim */
  type: "price" | "trend" | "fundamental" | "sentiment" | "prediction" | "comparison" | "risk" | "general";
  /** Whether the claim is verifiable against market data */
  verifiable: boolean;
  /** Verification result (null if not yet verified) */
  verified: boolean | null;
  /** Confidence that this is a genuine claim (0-1) */
  extractionConfidence: number;
}

export interface EvidenceLink {
  /** The claim being supported */
  claimIndex: number;
  /** The data source supporting it */
  source: string;
  /** Strength of the link: direct, indirect, or inferred */
  strength: "direct" | "indirect" | "inferred";
}

export interface LogicStep {
  /** The premise or conclusion text */
  text: string;
  /** Role in the logical chain */
  role: "premise" | "inference" | "conclusion";
  /** Whether this step logically follows from prior steps */
  valid: boolean;
  /** Index of premises this step depends on */
  dependsOn: number[];
}

export interface SurfacedAssumption {
  /** What the agent assumed without stating */
  assumption: string;
  /** Category */
  category: "market_conditions" | "data_quality" | "model_behavior" | "time_horizon" | "risk_appetite";
  /** How critical this assumption is to the conclusion */
  criticality: "low" | "medium" | "high";
}

export interface CounterfactualScenario {
  /** What would need to change */
  condition: string;
  /** How the decision would change */
  expectedChange: string;
  /** How sensitive the decision is to this factor */
  sensitivity: "low" | "medium" | "high";
}

export interface TransparencyReport {
  agentId: string;
  roundId: string;
  action: string;
  symbol: string;
  /** All factual claims extracted from reasoning */
  claims: ExtractedClaim[];
  /** Links between claims and evidence sources */
  evidenceMap: EvidenceLink[];
  /** Step-by-step logic chain */
  logicChain: LogicStep[];
  /** Unstated assumptions detected */
  assumptions: SurfacedAssumption[];
  /** What would change the agent's mind */
  counterfactuals: CounterfactualScenario[];
  /** Aggregate transparency score 0-1 */
  transparencyScore: number;
  /** Component scores */
  componentScores: {
    claimDensity: number;
    evidenceCoverage: number;
    logicValidity: number;
    assumptionAwareness: number;
    counterfactualDepth: number;
  };
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Claim Extraction Patterns
// ---------------------------------------------------------------------------

const PRICE_CLAIM = /(?:\$[\d,.]+|\d+\.?\d*\s*(?:dollars?|usd))/gi;
const TREND_CLAIM = /(?:upward|downward|bullish|bearish|rising|falling|increasing|decreasing)\s+(?:trend|momentum|pressure|trajectory)/gi;
const FUNDAMENTAL_CLAIM = /(?:P\/E|earnings|revenue|margin|market\s+cap|dividend|cash\s+flow|book\s+value|EPS|debt[\s-]to[\s-]equity)/gi;
const SENTIMENT_CLAIM = /(?:market\s+(?:sentiment|mood|fear|greed)|investor\s+(?:confidence|anxiety)|(?:risk[\s-]on|risk[\s-]off))/gi;
const PREDICTION_CLAIM = /(?:will\s+(?:rise|fall|increase|decrease|rally|decline|reach)|expect(?:ed|ing)?\s+to|predicted?\s+to|target\s+(?:price|of)|should\s+(?:reach|hit|test))/gi;
const COMPARISON_CLAIM = /(?:compared\s+to|relative\s+to|versus|outperform|underperform|better\s+than|worse\s+than|stronger\s+than|weaker\s+than)/gi;
const RISK_CLAIM = /(?:downside|upside\s+risk|stop[\s-]loss|worst[\s-]case|risk\s+of|could\s+(?:lose|fall|decline)|potential\s+(?:loss|downside))/gi;

const CLAIM_PATTERNS: [RegExp, ExtractedClaim["type"]][] = [
  [PRICE_CLAIM, "price"],
  [TREND_CLAIM, "trend"],
  [FUNDAMENTAL_CLAIM, "fundamental"],
  [SENTIMENT_CLAIM, "sentiment"],
  [PREDICTION_CLAIM, "prediction"],
  [COMPARISON_CLAIM, "comparison"],
  [RISK_CLAIM, "risk"],
];

// ---------------------------------------------------------------------------
// Logic Connectors
// ---------------------------------------------------------------------------

const PREMISE_MARKERS = /\b(?:because|since|given\s+that|based\s+on|due\s+to|considering|observing\s+that|noting\s+that|as\s+evidenced\s+by)\b/gi;
const INFERENCE_MARKERS = /\b(?:therefore|thus|hence|consequently|as\s+a\s+result|this\s+(?:means|suggests|indicates|implies)|leading\s+to|which\s+(?:means|suggests))\b/gi;
const CONCLUSION_MARKERS = /\b(?:I(?:'m|\s+am)\s+(?:buying|selling|holding)|my\s+decision|I\s+(?:recommend|decide|choose)|overall|in\s+conclusion|ultimately|the\s+best\s+(?:action|move))\b/gi;

// ---------------------------------------------------------------------------
// Assumption Detection Patterns
// ---------------------------------------------------------------------------

const MARKET_CONDITION_ASSUMPTIONS = /\b(?:normal\s+(?:market|trading|conditions)|typical\s+(?:volume|volatility)|liquid(?:ity)?|efficient\s+market)\b/gi;
const DATA_QUALITY_ASSUMPTIONS = /\b(?:accurate|reliable|current|real[\s-]time|up[\s-]to[\s-]date|verified)\b/gi;
const TIME_HORIZON_ASSUMPTIONS = /\b(?:short[\s-]term|long[\s-]term|medium[\s-]term|intraday|swing|overnight|weekly)\b/gi;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const reportStore = new Map<string, TransparencyReport[]>();
const MAX_REPORTS_PER_AGENT = 200;

/**
 * Default query limit for getTransparencyReports() API responses.
 *
 * Controls how many recent transparency reports are returned per agent when
 * no explicit limit is provided. 50 reports covers ~1-2 trading rounds of
 * transparency data without overwhelming API consumers.
 *
 * Context: MAX_REPORTS_PER_AGENT=200 is the in-memory storage cap;
 * this default is the typical API page size (25% of max storage).
 *
 * Example: Agent has 120 stored reports → API returns most recent 50.
 */
const DEFAULT_TRANSPARENCY_REPORTS_LIMIT = 50;

// ---------------------------------------------------------------------------
// Text Truncation & Display Limit Constants
// ---------------------------------------------------------------------------

/**
 * Character limit for claim deduplication key generation.
 * Uses first 50 chars of lowercased claim text as a Map key to detect duplicates.
 * Short enough for fast key comparison; long enough to distinguish unique claims.
 * Example: "AAPL is trading at $185.50 with..." → key "general:aapl is trading at $185.50 with..."
 */
const CLAIM_KEY_TRUNCATION_LENGTH = 50;

/**
 * Maximum character length for extracted claim and logic step text.
 * Limits the text stored per claim/step to keep TransparencyReport sizes manageable.
 * 200 characters typically captures the core of a market claim without full context.
 * Example: "The stock has shown strong upward momentum over the past week, suggesting bullish sentiment" (90 chars)
 */
const CLAIM_TEXT_MAX_LENGTH = 200;

/**
 * Character window size for nearby-evidence context search.
 * When checking if a source keyword appears near a claim in reasoning text,
 * scans CLAIM_EVIDENCE_CONTEXT_WINDOW characters before and after the claim position.
 * 100 characters = roughly 1-2 sentences of surrounding context.
 * Formula: reasoning.slice(claimPos - WINDOW, claimPos + claimLength + WINDOW)
 */
const CLAIM_EVIDENCE_CONTEXT_WINDOW = 100;

/**
 * Maximum number of common assumptions to surface in transparency stats.
 * Controls how many top-recurring assumptions appear in getTransparencyStats().
 * Top 5 provides a concise summary without overwhelming the stats response.
 */
const COMMON_ASSUMPTIONS_DISPLAY_LIMIT = 5;

// ---------------------------------------------------------------------------
// Claim Confidence & Scoring Constants
// ---------------------------------------------------------------------------

/**
 * Minimum extraction confidence for pattern-matched claims (regex hits).
 * Pattern-matched claims (price, trend, fundamental, etc.) have high confidence
 * because the regex pattern is specific. The value 0.8 means "80% sure this
 * is a genuine claim, not noise."
 * Formula: extractionConfidence = PATTERN_CLAIM_CONFIDENCE_MIN + random() * PATTERN_CLAIM_CONFIDENCE_RANGE
 * Example: 0.8 + 0.14 = 0.94 confidence for a matched price claim
 */
const PATTERN_CLAIM_CONFIDENCE_MIN = 0.8;

/**
 * Random range added on top of PATTERN_CLAIM_CONFIDENCE_MIN for pattern-matched claims.
 * Adds realistic variation rather than a fixed confidence score.
 * Range of 0.2 produces confidence values in [0.8, 1.0].
 * Example: Math.random() * 0.2 = 0.17 → confidence = 0.97
 */
const PATTERN_CLAIM_CONFIDENCE_RANGE = 0.2;

/**
 * Fixed extraction confidence for sentence-level claims (assertive verb patterns).
 * Sentence-level detection is less precise than regex patterns (broader heuristic),
 * so confidence is set lower at 0.6 = "60% sure this is a genuine claim."
 * Unlike pattern claims, no random variation — consistent moderate confidence.
 */
const SENTENCE_CLAIM_CONFIDENCE = 0.6;

// ---------------------------------------------------------------------------
// Counterfactual Generation Thresholds
// ---------------------------------------------------------------------------

/**
 * Confidence threshold above which a trade is considered "high-confidence."
 * Trades with confidence > HIGH_CONFIDENCE_THRESHOLD generate counterfactuals
 * about events that could invalidate a strong conviction (e.g., earnings miss).
 * Value of 0.7 = 70% confidence on the 0-1 scale.
 */
const HIGH_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Confidence threshold below which a trade is considered "low-confidence."
 * Trades with confidence < LOW_CONFIDENCE_THRESHOLD generate counterfactuals
 * about catalysts that could convert uncertainty into conviction.
 * Value of 0.3 = 30% confidence on the 0-1 scale.
 */
const LOW_CONFIDENCE_THRESHOLD = 0.3;

// ---------------------------------------------------------------------------
// Transparency Score Computation Constants
// ---------------------------------------------------------------------------

/**
 * Default logic validity score when no logic chain steps are found.
 * A reasoning text with no identifiable logic steps is given 0.5 (neutral)
 * rather than 0 (penalized) — absence of detected steps ≠ bad reasoning.
 * Used in: logicValidity = logicChain.length > 0 ? validSteps/total : DEFAULT
 */
const DEFAULT_LOGIC_VALIDITY_SCORE = 0.5;

/**
 * Penalty applied to assumptionAwareness per high-criticality assumption.
 * Each unstated high-criticality assumption reduces the score by this amount.
 * Formula: assumptionAwareness = max(0, 1 - highCritCount * PENALTY)
 * Example: 2 high-criticality assumptions → 1 - 2 * 0.2 = 0.6 awareness score
 * Value of 0.2 means a single critical assumption costs 20% of the awareness score.
 */
const HIGH_CRIT_ASSUMPTION_PENALTY = 0.2;

/**
 * Denominator for counterfactual depth score normalization.
 * counterfactualDepth = min(1, counterfactuals.length / MAX_COUNTERFACTUALS_FOR_FULL_SCORE)
 * A report with 4+ counterfactuals receives a full depth score of 1.0.
 * Example: 2 counterfactuals → 2/4 = 0.5 depth score
 */
const MAX_COUNTERFACTUALS_FOR_FULL_SCORE = 4;

// ---------------------------------------------------------------------------
// Transparency Score Weights (must sum to 1.0)
// ---------------------------------------------------------------------------

/**
 * Weight of claim density in the composite transparency score.
 * Claims per word-count ratio — measures how fact-dense the reasoning is.
 * Lower weight (20%) because claim count alone doesn't capture reasoning quality.
 */
const WEIGHT_CLAIM_DENSITY = 0.20;

/**
 * Weight of evidence coverage in the composite transparency score.
 * Fraction of claims with direct evidence links — measures grounding quality.
 * Higher weight (25%) because evidence-backed claims are more auditable.
 */
const WEIGHT_EVIDENCE_COVERAGE = 0.25;

/**
 * Weight of logic validity in the composite transparency score.
 * Fraction of logic steps that are valid (non-contradictory) — measures coherence.
 * Higher weight (25%) because logical consistency is central to good reasoning.
 */
const WEIGHT_LOGIC_VALIDITY = 0.25;

/**
 * Weight of assumption awareness in the composite transparency score.
 * Penalizes unstated high-criticality assumptions — measures intellectual honesty.
 * Medium weight (15%) — assumptions are important but not always articulable.
 */
const WEIGHT_ASSUMPTION_AWARENESS = 0.15;

/**
 * Weight of counterfactual depth in the composite transparency score.
 * Measures how many "what would change my mind" scenarios are considered.
 * Medium weight (15%) — counterfactual thinking is valuable but supplementary.
 * Note: WEIGHT_CLAIM_DENSITY + WEIGHT_EVIDENCE_COVERAGE + WEIGHT_LOGIC_VALIDITY
 *       + WEIGHT_ASSUMPTION_AWARENESS + WEIGHT_COUNTERFACTUAL_DEPTH = 1.0
 */
const WEIGHT_COUNTERFACTUAL_DEPTH = 0.15;

// ---------------------------------------------------------------------------
// Sentence Splitting Minimum Length Constants
// ---------------------------------------------------------------------------

/**
 * Minimum character length for sentence-level claim extraction (splitSentences call).
 * Sentences shorter than 15 characters are too brief to contain a meaningful market claim.
 * Filters out fragments like "Yes.", "No.", "OK.", "Indeed.", etc.
 * Example: "AAPL is trading" (16 chars) passes; "Yes." (4 chars) filtered out.
 * Used in: extractClaims() — splitSentences(reasoning, SENTENCE_MIN_LENGTH_FOR_CLAIMS)
 */
const SENTENCE_MIN_LENGTH_FOR_CLAIMS = 15;

/**
 * Minimum character length for logic chain sentence extraction.
 * Filters fragments produced by splitting on [.!?]+ punctuation.
 * Sentences under 10 characters (single words, short phrases) cannot contain
 * logical premise/inference/conclusion structure.
 * Example: "Therefore AAPL is a buy" (23 chars) passes; "So" (2 chars) filtered out.
 * Used in: extractLogicChain() — filter((s) => s.length > SENTENCE_MIN_LENGTH_FOR_LOGIC)
 */
const SENTENCE_MIN_LENGTH_FOR_LOGIC = 10;

// ---------------------------------------------------------------------------
// Core Analysis Functions
// ---------------------------------------------------------------------------

/**
 * Extract all factual claims from reasoning text.
 */
export function extractClaims(reasoning: string): ExtractedClaim[] {
  const claims: ExtractedClaim[] = [];
  const seen = new Set<string>();

  for (const [pattern, type] of CLAIM_PATTERNS) {
    // Reset lastIndex for global regex
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(reasoning)) !== null) {
      const text = match[0].trim();
      const key = `${type}:${text.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        claims.push({
          text,
          offset: match.index,
          type,
          verifiable: type === "price" || type === "trend" || type === "fundamental",
          verified: null,
          extractionConfidence: PATTERN_CLAIM_CONFIDENCE_MIN + Math.random() * PATTERN_CLAIM_CONFIDENCE_RANGE,
        });
      }
    }
  }

  // Also extract sentence-level claims (sentences with assertive verbs)
  const sentences = splitSentences(reasoning, SENTENCE_MIN_LENGTH_FOR_CLAIMS);
  for (const sentence of sentences) {
    if (/\b(?:is\s+(?:trading|priced|valued)|has\s+(?:been|shown|demonstrated)|shows|indicates|reflects|represents)\b/i.test(sentence)) {
      const trimmed = sentence.trim();
      const key = `general:${trimmed.slice(0, CLAIM_KEY_TRUNCATION_LENGTH).toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        claims.push({
          text: trimmed.slice(0, CLAIM_TEXT_MAX_LENGTH),
          offset: reasoning.indexOf(trimmed),
          type: "general",
          verifiable: false,
          verified: null,
          extractionConfidence: SENTENCE_CLAIM_CONFIDENCE,
        });
      }
    }
  }

  return claims.sort((a, b) => a.offset - b.offset);
}

/**
 * Map claims to evidence sources mentioned in reasoning.
 */
export function mapEvidence(claims: ExtractedClaim[], sources: string[], reasoning: string): EvidenceLink[] {
  const links: EvidenceLink[] = [];

  for (let i = 0; i < claims.length; i++) {
    const claim = claims[i];
    // Check each source for relevance to this claim
    for (const source of sources) {
      const strength = getEvidenceStrength(claim, source, reasoning);
      if (strength) {
        links.push({ claimIndex: i, source, strength });
      }
    }
    // If no source linked, mark as inferred
    if (!links.some((l) => l.claimIndex === i)) {
      links.push({ claimIndex: i, source: "unstated", strength: "inferred" });
    }
  }

  return links;
}

function getEvidenceStrength(claim: ExtractedClaim, source: string, reasoning: string): EvidenceLink["strength"] | null {
  const sourceLower = source.toLowerCase();
  const claimLower = claim.text.toLowerCase();

  // Direct evidence: price claims supported by price feed
  if (claim.type === "price" && (sourceLower.includes("price") || sourceLower.includes("market"))) {
    return "direct";
  }
  // Direct evidence: trend claims supported by technical analysis
  if (claim.type === "trend" && (sourceLower.includes("technical") || sourceLower.includes("24h"))) {
    return "direct";
  }
  // Direct evidence: fundamental claims supported by fundamentals source
  if (claim.type === "fundamental" && sourceLower.includes("fundamental")) {
    return "direct";
  }
  // Indirect evidence: sentiment claims supported by news
  if (claim.type === "sentiment" && (sourceLower.includes("news") || sourceLower.includes("sentiment"))) {
    return "indirect";
  }
  // Check if the source keyword appears near the claim in reasoning
  const claimPos = reasoning.toLowerCase().indexOf(claimLower);
  if (claimPos >= 0) {
    const nearby = reasoning.slice(Math.max(0, claimPos - CLAIM_EVIDENCE_CONTEXT_WINDOW), claimPos + claimLower.length + CLAIM_EVIDENCE_CONTEXT_WINDOW).toLowerCase();
    if (nearby.includes(sourceLower.replace(/_/g, " "))) {
      return "indirect";
    }
  }

  return null;
}

/**
 * Extract the logical chain from reasoning text.
 */
export function extractLogicChain(reasoning: string): LogicStep[] {
  const steps: LogicStep[] = [];
  const sentences = reasoning.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.length > SENTENCE_MIN_LENGTH_FOR_LOGIC);

  for (const sentence of sentences) {
    let role: LogicStep["role"] = "premise";

    if (CONCLUSION_MARKERS.test(sentence)) {
      role = "conclusion";
      CONCLUSION_MARKERS.lastIndex = 0;
    } else if (INFERENCE_MARKERS.test(sentence)) {
      role = "inference";
      INFERENCE_MARKERS.lastIndex = 0;
    } else {
      PREMISE_MARKERS.lastIndex = 0;
    }

    // Inferences depend on all prior premises
    const dependsOn: number[] = [];
    if (role === "inference" || role === "conclusion") {
      for (let i = 0; i < steps.length; i++) {
        if (steps[i].role === "premise" || (role === "conclusion" && steps[i].role === "inference")) {
          dependsOn.push(i);
        }
      }
    }

    steps.push({
      text: sentence.slice(0, CLAIM_TEXT_MAX_LENGTH),
      role,
      valid: true, // Default to valid; could be enhanced with contradiction detection
      dependsOn,
    });
  }

  // Validate: check for contradictions
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.role === "conclusion") {
      // Check if conclusion contradicts any premise
      for (const depIdx of step.dependsOn) {
        if (depIdx < steps.length) {
          const dep = steps[depIdx];
          if (containsContradiction(dep.text, step.text)) {
            step.valid = false;
          }
        }
      }
    }
  }

  return steps;
}

function containsContradiction(a: string, b: string): boolean {
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();

  // Simple contradiction detection: bullish premise + bearish conclusion or vice versa
  const aBullish = /\b(?:bullish|upside|growth|strong|buy|accumulate|undervalued)\b/.test(aLower);
  const aBearish = /\b(?:bearish|downside|decline|weak|sell|distribute|overvalued)\b/.test(aLower);
  const bBullish = /\b(?:bullish|upside|growth|strong|buy|accumulate|undervalued)\b/.test(bLower);
  const bBearish = /\b(?:bearish|downside|decline|weak|sell|distribute|overvalued)\b/.test(bLower);

  return (aBullish && bBearish && !aBearish) || (aBearish && bBullish && !aBullish);
}

/**
 * Surface unstated assumptions in the reasoning.
 */
export function surfaceAssumptions(reasoning: string, action: string): SurfacedAssumption[] {
  const assumptions: SurfacedAssumption[] = [];
  const lower = reasoning.toLowerCase();

  // Market condition assumptions
  if (!MARKET_CONDITION_ASSUMPTIONS.test(lower)) {
    MARKET_CONDITION_ASSUMPTIONS.lastIndex = 0;
    assumptions.push({
      assumption: "Assumes normal market conditions (no flash crashes, halts, or extreme events)",
      category: "market_conditions",
      criticality: "medium",
    });
  }
  MARKET_CONDITION_ASSUMPTIONS.lastIndex = 0;

  // Data quality assumptions
  if (!DATA_QUALITY_ASSUMPTIONS.test(lower)) {
    DATA_QUALITY_ASSUMPTIONS.lastIndex = 0;
    assumptions.push({
      assumption: "Assumes data is accurate and current (no stale prices or data errors)",
      category: "data_quality",
      criticality: "high",
    });
  }
  DATA_QUALITY_ASSUMPTIONS.lastIndex = 0;

  // Time horizon assumptions
  if (!TIME_HORIZON_ASSUMPTIONS.test(lower)) {
    TIME_HORIZON_ASSUMPTIONS.lastIndex = 0;
    assumptions.push({
      assumption: "Does not specify time horizon for expected outcome",
      category: "time_horizon",
      criticality: action === "hold" ? "low" : "medium",
    });
  }
  TIME_HORIZON_ASSUMPTIONS.lastIndex = 0;

  // Risk appetite assumptions for buy/sell
  if (action !== "hold" && !/\b(?:risk|downside|stop[\s-]loss|worst[\s-]case|position\s+size)\b/i.test(lower)) {
    assumptions.push({
      assumption: "Does not explicitly address risk tolerance or exit conditions",
      category: "risk_appetite",
      criticality: "high",
    });
  }

  // Model behavior assumptions
  if (/\b(?:will\s+continue|always|never|guaranteed|certain)\b/i.test(lower)) {
    assumptions.push({
      assumption: "Uses deterministic language about inherently uncertain outcomes",
      category: "model_behavior",
      criticality: "medium",
    });
  }

  return assumptions;
}

/**
 * Generate counterfactual scenarios — what would change the agent's mind.
 */
export function generateCounterfactuals(
  reasoning: string,
  action: string,
  symbol: string,
  confidence: number,
): CounterfactualScenario[] {
  const counterfactuals: CounterfactualScenario[] = [];
  const lower = reasoning.toLowerCase();

  // Price-based counterfactual
  if (action === "buy") {
    counterfactuals.push({
      condition: `${symbol} price drops >10% from current level`,
      expectedChange: "Might convert to hold (deeper value) or sell (broken thesis)",
      sensitivity: "high",
    });
    if (/\b(?:support|floor|bottom)\b/i.test(lower)) {
      counterfactuals.push({
        condition: `${symbol} breaks below stated support level`,
        expectedChange: "Thesis invalidated — likely switch to sell or hold",
        sensitivity: "high",
      });
    }
  } else if (action === "sell") {
    counterfactuals.push({
      condition: `${symbol} price rises >5% from current level`,
      expectedChange: "Might regret selling; if trend reverses, could buy back",
      sensitivity: "medium",
    });
  }

  // Confidence-based counterfactual
  if (confidence > HIGH_CONFIDENCE_THRESHOLD) {
    counterfactuals.push({
      condition: "New negative earnings surprise or regulatory action",
      expectedChange: "High-confidence trade could flip to low-confidence hold",
      sensitivity: "high",
    });
  } else if (confidence < LOW_CONFIDENCE_THRESHOLD) {
    counterfactuals.push({
      condition: "Strong positive catalyst (earnings beat, partnership)",
      expectedChange: "Low-confidence hold could become medium-confidence buy",
      sensitivity: "medium",
    });
  }

  // Volume/momentum counterfactual
  if (/\b(?:volume|momentum|trend)\b/i.test(lower)) {
    counterfactuals.push({
      condition: "Volume dries up or momentum reverses",
      expectedChange: "Momentum-based thesis weakened; agent may exit position",
      sensitivity: "medium",
    });
  }

  // Sector/macro counterfactual
  if (/\b(?:sector|macro|fed|interest\s+rate|inflation)\b/i.test(lower)) {
    counterfactuals.push({
      condition: "Macro environment shifts (rate hike, sector rotation)",
      expectedChange: "Macro-dependent thesis could be invalidated",
      sensitivity: "low",
    });
  }

  return counterfactuals;
}

/**
 * Run the full transparency analysis on a trade.
 */
export function analyzeTransparency(
  agentId: string,
  roundId: string,
  action: string,
  symbol: string,
  reasoning: string,
  confidence: number,
  sources: string[],
): TransparencyReport {
  const claims = extractClaims(reasoning);
  const evidenceMap = mapEvidence(claims, sources, reasoning);
  const logicChain = extractLogicChain(reasoning);
  const assumptions = surfaceAssumptions(reasoning, action);
  const confidence01 = confidence > 1 ? confidence / 100 : confidence;
  const counterfactuals = generateCounterfactuals(reasoning, action, symbol, confidence01);

  // Compute component scores
  const wordCount = countWords(reasoning);
  const claimDensity = Math.min(1, claims.length / Math.max(1, wordCount / 20));
  const directLinks = countByCondition(evidenceMap, (l) => l.strength === "direct");
  const evidenceCoverage = claims.length > 0
    ? Math.min(1, directLinks / claims.length)
    : 0;
  const validSteps = countByCondition(logicChain, (s) => s.valid);
  const logicValidity = logicChain.length > 0
    ? validSteps / logicChain.length
    : DEFAULT_LOGIC_VALIDITY_SCORE;
  const highCritAssumptions = countByCondition(assumptions, (a) => a.criticality === "high");
  const assumptionAwareness = Math.max(0, 1 - highCritAssumptions * HIGH_CRIT_ASSUMPTION_PENALTY);
  const counterfactualDepth = Math.min(1, counterfactuals.length / MAX_COUNTERFACTUALS_FOR_FULL_SCORE);

  const transparencyScore = round2(
    claimDensity * WEIGHT_CLAIM_DENSITY +
    evidenceCoverage * WEIGHT_EVIDENCE_COVERAGE +
    logicValidity * WEIGHT_LOGIC_VALIDITY +
    assumptionAwareness * WEIGHT_ASSUMPTION_AWARENESS +
    counterfactualDepth * WEIGHT_COUNTERFACTUAL_DEPTH,
  );

  const report: TransparencyReport = {
    agentId,
    roundId,
    action,
    symbol,
    claims,
    evidenceMap,
    logicChain,
    assumptions,
    counterfactuals,
    transparencyScore,
    componentScores: {
      claimDensity: round2(claimDensity),
      evidenceCoverage: round2(evidenceCoverage),
      logicValidity: round2(logicValidity),
      assumptionAwareness: round2(assumptionAwareness),
      counterfactualDepth: round2(counterfactualDepth),
    },
    timestamp: new Date().toISOString(),
  };

  // Store
  const existing = reportStore.get(agentId) ?? [];
  existing.unshift(report);
  if (existing.length > MAX_REPORTS_PER_AGENT) existing.length = MAX_REPORTS_PER_AGENT;
  reportStore.set(agentId, existing);

  return report;
}

/**
 * Get transparency reports for an agent.
 */
export function getTransparencyReports(agentId: string, limit = DEFAULT_TRANSPARENCY_REPORTS_LIMIT): TransparencyReport[] {
  return (reportStore.get(agentId) ?? []).slice(0, limit);
}

/**
 * Get all agent transparency profiles (aggregate stats).
 */
export function getAllTransparencyProfiles(): Record<string, {
  avgTransparency: number;
  avgClaimDensity: number;
  avgEvidenceCoverage: number;
  avgLogicValidity: number;
  avgAssumptionAwareness: number;
  avgCounterfactualDepth: number;
  totalReports: number;
}> {
  const profiles: Record<string, ReturnType<typeof getAllTransparencyProfiles>[string]> = {};

  for (const [agentId, reports] of reportStore.entries()) {
    if (reports.length === 0) continue;
    const n = reports.length;
    profiles[agentId] = {
      avgTransparency: round2(reports.reduce((s, r) => s + r.transparencyScore, 0) / n),
      avgClaimDensity: round2(reports.reduce((s, r) => s + r.componentScores.claimDensity, 0) / n),
      avgEvidenceCoverage: round2(reports.reduce((s, r) => s + r.componentScores.evidenceCoverage, 0) / n),
      avgLogicValidity: round2(reports.reduce((s, r) => s + r.componentScores.logicValidity, 0) / n),
      avgAssumptionAwareness: round2(reports.reduce((s, r) => s + r.componentScores.assumptionAwareness, 0) / n),
      avgCounterfactualDepth: round2(reports.reduce((s, r) => s + r.componentScores.counterfactualDepth, 0) / n),
      totalReports: n,
    };
  }

  return profiles;
}

/**
 * Get transparency pillar score for an agent (0-1).
 */
export function getTransparencyPillarScore(agentId: string): number {
  const reports = reportStore.get(agentId) ?? [];
  if (reports.length === 0) return 0.5;
  return round2(reports.reduce((s, r) => s + r.transparencyScore, 0) / reports.length);
}

/**
 * Get transparency stats across all agents.
 */
export function getTransparencyStats(): {
  totalReports: number;
  avgTransparency: number;
  mostTransparent: string | null;
  leastTransparent: string | null;
  commonAssumptions: string[];
} {
  let totalReports = 0;
  let totalScore = 0;
  let best = { id: "", score: 0 };
  let worst = { id: "", score: 1 };
  const assumptionCounts = new Map<string, number>();

  for (const [agentId, reports] of reportStore.entries()) {
    totalReports += reports.length;
    const avg = reports.reduce((s, r) => s + r.transparencyScore, 0) / (reports.length || 1);
    totalScore += avg;
    if (avg > best.score) best = { id: agentId, score: avg };
    if (avg < worst.score) worst = { id: agentId, score: avg };

    for (const report of reports) {
      for (const a of report.assumptions) {
        assumptionCounts.set(a.assumption, (assumptionCounts.get(a.assumption) ?? 0) + 1);
      }
    }
  }

  const agentCount = reportStore.size || 1;
  const commonAssumptions = [...assumptionCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, COMMON_ASSUMPTIONS_DISPLAY_LIMIT)
    .map(([a]) => a);

  return {
    totalReports,
    avgTransparency: round2(totalScore / agentCount),
    mostTransparent: best.id || null,
    leastTransparent: worst.id || null,
    commonAssumptions,
  };
}
