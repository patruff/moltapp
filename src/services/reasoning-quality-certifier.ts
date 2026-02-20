/**
 * Reasoning Quality Certifier (v20)
 *
 * Issues verifiable quality certificates for agent reasoning based on
 * multi-dimensional analysis. Certificates can be verified by researchers
 * and included in the HuggingFace dataset.
 *
 * Certification dimensions:
 * 1. STRUCTURAL COMPLETENESS: Does reasoning have thesis + evidence + conclusion?
 * 2. DATA GROUNDING: Are factual claims backed by actual data?
 * 3. LOGICAL SOUNDNESS: Is the argument internally consistent?
 * 4. EPISTEMIC HONESTY: Does the agent acknowledge what it doesn't know?
 * 5. ACTIONABILITY: Does the reasoning lead to a clear, executable decision?
 *
 * Quality levels:
 * - CERTIFIED GOLD: All dimensions >= 0.8 — exemplary reasoning
 * - CERTIFIED SILVER: All dimensions >= 0.6 — solid reasoning
 * - CERTIFIED BRONZE: All dimensions >= 0.4 — acceptable reasoning
 * - UNCERTIFIED: Any dimension < 0.4 — reasoning needs improvement
 */

import { createHash } from "crypto";
import { ID_RANDOM_START, ID_RANDOM_LENGTH_SHORT } from "../config/constants.ts";
import { CERTIFICATION_WEIGHTS_ARRAY } from "../lib/scoring-weights.ts";
import { splitSentences, normalize, countWords, round2, weightedSum, clamp, countByCondition, findMin } from "../lib/math-utils.ts";
import { normalizeConfidence } from "../schemas/trade-reasoning.ts";
import { getGradeFractional } from "../lib/benchmark-grading-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CertificationLevel = "gold" | "silver" | "bronze" | "uncertified";

export interface CertificationDimension {
  name: string;
  score: number;
  indicators: string[];
  grade: string;
}

export interface QualityCertificate {
  /** Unique certificate ID */
  certificateId: string;
  /** SHA-256 hash for verification */
  hash: string;
  /** Agent that produced the reasoning */
  agentId: string;
  /** Trading round */
  roundId: string;
  /** Certification level */
  level: CertificationLevel;
  /** Composite quality score 0-1 */
  compositeScore: number;
  /** Individual dimension scores */
  dimensions: CertificationDimension[];
  /** The reasoning text that was certified */
  reasoningHash: string;
  /** Action taken */
  action: string;
  /** Symbol traded */
  symbol: string;
  /** When the certificate was issued */
  issuedAt: string;
  /** Expiry (certificates are valid for 7 days) */
  expiresAt: string;
}

export interface AgentCertificationProfile {
  agentId: string;
  totalCertifications: number;
  goldCount: number;
  silverCount: number;
  bronzeCount: number;
  uncertifiedCount: number;
  certificationRate: number;
  avgComposite: number;
  bestDimension: string;
  worstDimension: string;
  trend: "improving" | "stable" | "declining";
  pillarScore: number;
}

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * CERTIFICATION LEVEL THRESHOLDS
 * Minimum dimension scores required for each certification tier
 */

/** Gold certification requires ALL dimensions >= 0.8 (exemplary reasoning) */
const CERTIFICATION_THRESHOLD_GOLD = 0.8;

/** Silver certification requires ALL dimensions >= 0.6 (solid reasoning) */
const CERTIFICATION_THRESHOLD_SILVER = 0.6;

/** Bronze certification requires ALL dimensions >= 0.4 (acceptable reasoning) */
const CERTIFICATION_THRESHOLD_BRONZE = 0.4;

/**
 * STRUCTURAL COMPLETENESS SCORING WEIGHTS
 * Points awarded for each structural element present
 */

/** Thesis statement weight (25% of structural score) */
const STRUCTURAL_WEIGHT_THESIS = 0.25;

/** Evidence markers weight (up to 30% of structural score, 0.10 per marker) */
const STRUCTURAL_WEIGHT_EVIDENCE_BASE = 0.30;
const STRUCTURAL_WEIGHT_EVIDENCE_PER_MARKER = 0.10;

/** Conclusion weight (20% of structural score) */
const STRUCTURAL_WEIGHT_CONCLUSION = 0.20;

/** Sentence count adequacy weight (15% of structural score) */
const STRUCTURAL_WEIGHT_SENTENCE_COUNT = 0.15;

/** Word count depth weight (10% of structural score) */
const STRUCTURAL_WEIGHT_WORD_COUNT = 0.10;

/** Minimum sentence count for adequacy (3 sentences shows complete argument) */
const STRUCTURAL_MIN_SENTENCES = 3;

/** Minimum word count for sufficient depth (50 words ensures substantive analysis) */
const STRUCTURAL_MIN_WORDS = 50;

/** Sentence splitting threshold for structural analysis (10 chars minimum) */
const STRUCTURAL_SENTENCE_MIN_LENGTH = 10;

/**
 * DATA GROUNDING SCORING WEIGHTS
 * Points awarded for quantitative claims, temporal references, and data sources
 */

/** Quantitative claims weight (up to 30%, 0.06 per claim) */
const DATA_GROUNDING_WEIGHT_QUANTITATIVE_BASE = 0.30;
const DATA_GROUNDING_WEIGHT_QUANTITATIVE_PER_CLAIM = 0.06;

/** Temporal references weight (up to 20%, 0.07 per reference) */
const DATA_GROUNDING_WEIGHT_TEMPORAL_BASE = 0.20;
const DATA_GROUNDING_WEIGHT_TEMPORAL_PER_REF = 0.07;

/** Data sources weight (up to 30%, 0.10 per source) */
const DATA_GROUNDING_WEIGHT_SOURCES_BASE = 0.30;
const DATA_GROUNDING_WEIGHT_SOURCES_PER_SOURCE = 0.10;

/** Bonus for diverse sources (3+ sources shows comprehensive research) */
const DATA_GROUNDING_BONUS_DIVERSE_SOURCES = 0.10;
const DATA_GROUNDING_MIN_DIVERSE_SOURCES = 3;

/** Bonus for specific price mentions (shows quantitative grounding) */
const DATA_GROUNDING_BONUS_PRICE_MENTION = 0.10;

/**
 * LOGICAL SOUNDNESS SCORING WEIGHTS
 * Points for causal reasoning, penalties for contradictions and circular logic
 */

/** Starting baseline score for logical soundness (0.5 = neutral) */
const LOGICAL_SOUNDNESS_BASELINE = 0.5;

/** Causal connectors weight (up to 30%, 0.05 per connector) */
const LOGICAL_SOUNDNESS_WEIGHT_CAUSAL_BASE = 0.30;
const LOGICAL_SOUNDNESS_WEIGHT_CAUSAL_PER_CONNECTOR = 0.05;

/** Penalty per contradiction detected (15% penalty) */
const LOGICAL_SOUNDNESS_PENALTY_CONTRADICTION = 0.15;

/** Penalty for circular reasoning (10% penalty) */
const LOGICAL_SOUNDNESS_PENALTY_CIRCULAR = 0.10;

/** Bonus for strong causal reasoning with no contradictions (10% bonus) */
const LOGICAL_SOUNDNESS_BONUS_STRONG_CAUSAL = 0.10;
const LOGICAL_SOUNDNESS_MIN_CAUSAL_FOR_BONUS = 3;

/** Sentence splitting threshold for circular detection (20 chars minimum) */
const LOGICAL_SOUNDNESS_SENTENCE_MIN_LENGTH = 20;

/**
 * EPISTEMIC HONESTY SCORING WEIGHTS
 * Points for uncertainty acknowledgment, penalties for overconfidence
 */

/** Starting baseline score for epistemic honesty (0.5 = neutral) */
const EPISTEMIC_HONESTY_BASELINE = 0.5;

/** Uncertainty markers weight (up to 25%, 0.08 per marker) */
const EPISTEMIC_HONESTY_WEIGHT_UNCERTAINTY_BASE = 0.25;
const EPISTEMIC_HONESTY_WEIGHT_UNCERTAINTY_PER_MARKER = 0.08;

/** Penalty per overconfidence marker (10% penalty) */
const EPISTEMIC_HONESTY_PENALTY_OVERCONFIDENCE = 0.10;

/** Penalty for high confidence without uncertainty (10% penalty when conf > 0.8) */
const EPISTEMIC_HONESTY_PENALTY_UNCALIBRATED_HIGH_CONF = 0.10;
const EPISTEMIC_HONESTY_HIGH_CONF_THRESHOLD = 0.8;

/** Bonus for appropriate low confidence expression (10% bonus when conf < 0.5) */
const EPISTEMIC_HONESTY_BONUS_CALIBRATED_LOW_CONF = 0.10;
const EPISTEMIC_HONESTY_LOW_CONF_THRESHOLD = 0.5;

/**
 * ACTIONABILITY SCORING WEIGHTS
 * Points for decision clarity, position sizing, and risk management
 */

/** Actionable details weight (up to 30%, 0.05 per detail) */
const ACTIONABILITY_WEIGHT_DETAILS_BASE = 0.30;
const ACTIONABILITY_WEIGHT_DETAILS_PER_ITEM = 0.05;

/** Decision statement weight (25% for clear decision) */
const ACTIONABILITY_WEIGHT_DECISION = 0.25;

/** Position sizing context weight (20% for sizing details) */
const ACTIONABILITY_WEIGHT_POSITION_SIZING = 0.20;

/** Risk management criteria weight (25% for stop/target/limits) */
const ACTIONABILITY_WEIGHT_RISK_MGMT = 0.25;

/**
 * CERTIFICATE VALIDITY AND LIMITS
 */

/** Certificate validity period in milliseconds (7 days) */
const CERTIFICATE_VALIDITY_MS = 7 * 24 * 60 * 60 * 1000;

/** Maximum certificates stored per agent (circular buffer) */
const MAX_CERTS_PER_AGENT = 300;

/**
 * Default query limit for getRecentCertificates() API responses.
 *
 * Controls how many recent quality certificates are returned per agent when
 * no explicit limit is provided. 20 certificates covers recent certification
 * history (gold/silver/bronze) without bloating profile API responses.
 *
 * Context: MAX_CERTS_PER_AGENT=300 is the in-memory storage cap;
 * this default is the typical API page size (~7% of max storage).
 *
 * Example: Agent has 150 stored certs → API returns most recent 20.
 */
const DEFAULT_QUALITY_CERTS_LIMIT = 20;

/**
 * HASH AND DISPLAY FORMATTING CONSTANTS
 * Controls how reasoning fingerprints and circular reasoning previews are formatted
 */

/**
 * Hash prefix length for reasoning fingerprints (16 chars)
 *
 * Example: Full SHA-256 hash "a3f9e2..." → display first 16 chars "a3f9e2c7d1b4e8f5"
 * Provides sufficient uniqueness for reasoning identification while keeping IDs compact
 */
const REASONING_HASH_PREFIX_LENGTH = 16;

/**
 * Sentence preview length for circular reasoning detection (50 chars)
 *
 * Compares first N characters of opening/closing sentences to detect circular logic.
 * Example: "The stock is undervalued because..." → compare first 50 chars only
 *
 * Purpose: Prevents false positives from long identical prefixes in legitimate arguments
 * Formula: if first.slice(0, 50) === last.slice(0, 50) then flag circular reasoning
 */
const CIRCULAR_REASONING_SENTENCE_PREVIEW_LENGTH = 50;

/**
 * TREND DETECTION AND GRADING
 */

/** Minimum improvement threshold for "improving" trend (3% composite score increase) */
const TREND_IMPROVEMENT_THRESHOLD = 0.03;

/** Minimum decline threshold for "declining" trend (3% composite score decrease) */
const TREND_DECLINE_THRESHOLD = 0.03;

/** Pillar score weight for certification rate (40%) */
const PILLAR_WEIGHT_CERT_RATE = 0.4;

/** Pillar score weight for average composite (60%) */
const PILLAR_WEIGHT_AVG_COMPOSITE = 0.6;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const certificateStore = new Map<string, QualityCertificate[]>();
const certificateByHash = new Map<string, QualityCertificate>();

// ---------------------------------------------------------------------------
// Analysis Patterns
// ---------------------------------------------------------------------------

// Structural completeness patterns
const THESIS_PATTERNS = /\b(?:I\s+(?:believe|think|expect|recommend|conclude)|my\s+(?:thesis|view|analysis|assessment)|overall|the\s+case\s+for|the\s+key\s+(?:reason|argument))\b/gi;
const EVIDENCE_PATTERNS = /\b(?:because|since|data\s+shows|according\s+to|based\s+on|evidence|the\s+fact\s+that|supported\s+by|as\s+(?:shown|indicated|demonstrated))\b/gi;
const CONCLUSION_PATTERNS = /\b(?:therefore|thus|hence|in\s+conclusion|as\s+a\s+result|consequently|this\s+leads\s+me\s+to|my\s+decision|I(?:'m|\s+am)\s+(?:going\s+to|choosing\s+to))\b/gi;

// Data grounding patterns
const QUANTITATIVE_PATTERNS = /\$[\d,.]+|\d+\.?\d*%|\d+x|\d+\.?\d*\s*(?:billion|million|thousand)|P\/E\s+(?:of\s+)?\d+|\d+\.?\d*\s*(?:ratio|multiple)/gi;
const REFERENCE_PATTERNS = /\b(?:current(?:ly)?|today|this\s+week|yesterday|24h|last\s+(?:session|day|week)|at\s+the\s+(?:time|moment))\b/gi;

// Logical soundness patterns
const CAUSAL_CONNECTORS = /\b(?:because|therefore|thus|hence|since|as\s+a\s+result|consequently|due\s+to|driven\s+by|leading\s+to|which\s+(?:means|suggests|implies|indicates))\b/gi;
const CONTRADICTION_PAIRS: [RegExp, RegExp][] = [
  [/\bstrongly\s+bullish\b/i, /\bstrongly\s+bearish\b/i],
  [/\bshould\s+buy\b/i, /\bshould\s+sell\b/i],
  [/\bvery\s+confident\b/i, /\bvery\s+uncertain\b/i],
  [/\bundervalued\b/i, /\bovervalued\b/i],
];

// Epistemic honesty patterns
const UNCERTAINTY_MARKERS = /\b(?:might|may|could|possibly|perhaps|uncertain|unclear|risk|not\s+sure|unknown|limited\s+data|caveat|however|on\s+the\s+other\s+hand|that\s+said)\b/gi;
const OVERCONFIDENCE_MARKERS = /\b(?:definitely|certainly|guaranteed|will\s+(?:definitely|certainly)|no\s+doubt|absolutely|100%|always|never\s+(?:fail|lose))\b/gi;

// Actionability patterns
const ACTION_SPECIFICS = /\b(?:buy|sell|hold|position\s+size|entry\s+(?:point|price)|exit\s+(?:point|price)|stop[\s-]loss|take[\s-]profit|target\s+price|allocation|quantity|shares?|usd[c]?)\b/gi;

// ---------------------------------------------------------------------------
// Core Certification Function
// ---------------------------------------------------------------------------

/**
 * Certify the quality of an agent's reasoning.
 */
export function certifyReasoning(
  agentId: string,
  roundId: string,
  action: string,
  symbol: string,
  reasoning: string,
  confidence: number,
  sources: string[],
): QualityCertificate {
  const dimensions: CertificationDimension[] = [];

  // 1. Structural Completeness
  const structuralScore = scoreStructuralCompleteness(reasoning);
  dimensions.push(structuralScore);

  // 2. Data Grounding
  const groundingScore = scoreDataGrounding(reasoning, sources);
  dimensions.push(groundingScore);

  // 3. Logical Soundness
  const logicScore = scoreLogicalSoundness(reasoning);
  dimensions.push(logicScore);

  // 4. Epistemic Honesty
  const epistemicScore = scoreEpistemicHonesty(reasoning, confidence);
  dimensions.push(epistemicScore);

  // 5. Actionability
  const actionabilityScore = scoreActionability(reasoning, action);
  dimensions.push(actionabilityScore);

  // Compute composite score (weights imported from scoring-weights.ts)
  const scores = dimensions.map(d => d.score);
  const compositeScore = round2(
    weightedSum(scores, CERTIFICATION_WEIGHTS_ARRAY),
  );

  // Determine certification level
  const minScore = findMin(dimensions, 'score')?.score ?? 0;
  let level: CertificationLevel;
  if (minScore >= CERTIFICATION_THRESHOLD_GOLD) level = "gold";
  else if (minScore >= CERTIFICATION_THRESHOLD_SILVER) level = "silver";
  else if (minScore >= CERTIFICATION_THRESHOLD_BRONZE) level = "bronze";
  else level = "uncertified";

  // Create certificate
  const reasoningHash = createHash("sha256").update(reasoning).digest("hex").slice(0, REASONING_HASH_PREFIX_LENGTH);
  const certContent = JSON.stringify({
    agentId,
    roundId,
    level,
    compositeScore,
    reasoningHash,
    dimensions: dimensions.map((d) => ({ name: d.name, score: d.score })),
  });
  const hash = createHash("sha256").update(certContent).digest("hex");

  const now = new Date();
  const expires = new Date(now.getTime() + CERTIFICATE_VALIDITY_MS);

  const certificate: QualityCertificate = {
    certificateId: `cert_${Date.now()}_${Math.random().toString(36).slice(ID_RANDOM_START, ID_RANDOM_START + ID_RANDOM_LENGTH_SHORT)}`,
    hash,
    agentId,
    roundId,
    level,
    compositeScore,
    dimensions,
    reasoningHash,
    action,
    symbol,
    issuedAt: now.toISOString(),
    expiresAt: expires.toISOString(),
  };

  // Store
  const existing = certificateStore.get(agentId) ?? [];
  existing.unshift(certificate);
  if (existing.length > MAX_CERTS_PER_AGENT) existing.length = MAX_CERTS_PER_AGENT;
  certificateStore.set(agentId, existing);
  certificateByHash.set(hash, certificate);

  return certificate;
}

// ---------------------------------------------------------------------------
// Scoring Functions
// ---------------------------------------------------------------------------

function scoreStructuralCompleteness(reasoning: string): CertificationDimension {
  const indicators: string[] = [];

  THESIS_PATTERNS.lastIndex = 0;
  const hasThesis = THESIS_PATTERNS.test(reasoning);
  THESIS_PATTERNS.lastIndex = 0;
  if (hasThesis) indicators.push("Contains thesis statement");

  EVIDENCE_PATTERNS.lastIndex = 0;
  const evidenceCount = (reasoning.match(EVIDENCE_PATTERNS) ?? []).length;
  EVIDENCE_PATTERNS.lastIndex = 0;
  if (evidenceCount > 0) indicators.push(`${evidenceCount} evidence markers`);

  CONCLUSION_PATTERNS.lastIndex = 0;
  const hasConclusion = CONCLUSION_PATTERNS.test(reasoning);
  CONCLUSION_PATTERNS.lastIndex = 0;
  if (hasConclusion) indicators.push("Contains conclusion");

  const sentences = splitSentences(reasoning, STRUCTURAL_SENTENCE_MIN_LENGTH);
  const wordCount = countWords(reasoning);
  if (wordCount > STRUCTURAL_MIN_WORDS) indicators.push(`${wordCount} words (sufficient depth)`);

  let score = 0;
  if (hasThesis) score += STRUCTURAL_WEIGHT_THESIS;
  if (evidenceCount > 0) score += Math.min(STRUCTURAL_WEIGHT_EVIDENCE_BASE, evidenceCount * STRUCTURAL_WEIGHT_EVIDENCE_PER_MARKER);
  if (hasConclusion) score += STRUCTURAL_WEIGHT_CONCLUSION;
  if (sentences.length >= STRUCTURAL_MIN_SENTENCES) score += STRUCTURAL_WEIGHT_SENTENCE_COUNT;
  if (wordCount >= STRUCTURAL_MIN_WORDS) score += STRUCTURAL_WEIGHT_WORD_COUNT;

  return {
    name: "structural_completeness",
    score: Math.min(1, round2(score)),
    indicators,
    grade: getGradeFractional(score),
  };
}

function scoreDataGrounding(reasoning: string, sources: string[]): CertificationDimension {
  const indicators: string[] = [];

  QUANTITATIVE_PATTERNS.lastIndex = 0;
  const quantClaims = (reasoning.match(QUANTITATIVE_PATTERNS) ?? []).length;
  QUANTITATIVE_PATTERNS.lastIndex = 0;
  if (quantClaims > 0) indicators.push(`${quantClaims} quantitative claims`);

  REFERENCE_PATTERNS.lastIndex = 0;
  const timeRefs = (reasoning.match(REFERENCE_PATTERNS) ?? []).length;
  REFERENCE_PATTERNS.lastIndex = 0;
  if (timeRefs > 0) indicators.push(`${timeRefs} temporal references`);

  const sourceCount = sources.length;
  if (sourceCount > 0) indicators.push(`${sourceCount} data sources cited`);

  let score = 0;
  score += Math.min(DATA_GROUNDING_WEIGHT_QUANTITATIVE_BASE, quantClaims * DATA_GROUNDING_WEIGHT_QUANTITATIVE_PER_CLAIM);
  score += Math.min(DATA_GROUNDING_WEIGHT_TEMPORAL_BASE, timeRefs * DATA_GROUNDING_WEIGHT_TEMPORAL_PER_REF);
  score += Math.min(DATA_GROUNDING_WEIGHT_SOURCES_BASE, sourceCount * DATA_GROUNDING_WEIGHT_SOURCES_PER_SOURCE);
  // Bonus for diverse sources
  if (sourceCount >= DATA_GROUNDING_MIN_DIVERSE_SOURCES) score += DATA_GROUNDING_BONUS_DIVERSE_SOURCES;
  // Bonus for specific price/percentage mentions
  if (/\$\d+/.test(reasoning)) score += DATA_GROUNDING_BONUS_PRICE_MENTION;

  return {
    name: "data_grounding",
    score: Math.min(1, round2(score)),
    indicators,
    grade: getGradeFractional(score),
  };
}

function scoreLogicalSoundness(reasoning: string): CertificationDimension {
  const indicators: string[] = [];

  CAUSAL_CONNECTORS.lastIndex = 0;
  const causalCount = (reasoning.match(CAUSAL_CONNECTORS) ?? []).length;
  CAUSAL_CONNECTORS.lastIndex = 0;
  if (causalCount > 0) indicators.push(`${causalCount} causal connectors`);

  // Check for contradictions
  let contradictions = 0;
  for (const [patA, patB] of CONTRADICTION_PAIRS) {
    if (patA.test(reasoning) && patB.test(reasoning)) {
      contradictions++;
      indicators.push("Internal contradiction detected");
    }
    patA.lastIndex = 0;
    patB.lastIndex = 0;
  }

  // Check for circular reasoning
  const sentences = splitSentences(reasoning, LOGICAL_SOUNDNESS_SENTENCE_MIN_LENGTH);
  let circularFlag = false;
  if (sentences.length >= 2) {
    const first = sentences[0].trim().toLowerCase().slice(0, CIRCULAR_REASONING_SENTENCE_PREVIEW_LENGTH);
    const last = sentences[sentences.length - 1].trim().toLowerCase().slice(0, CIRCULAR_REASONING_SENTENCE_PREVIEW_LENGTH);
    if (first === last) {
      circularFlag = true;
      indicators.push("Potentially circular: first and last points identical");
    }
  }

  let score = LOGICAL_SOUNDNESS_BASELINE; // Start at baseline
  score += Math.min(LOGICAL_SOUNDNESS_WEIGHT_CAUSAL_BASE, causalCount * LOGICAL_SOUNDNESS_WEIGHT_CAUSAL_PER_CONNECTOR);
  score -= contradictions * LOGICAL_SOUNDNESS_PENALTY_CONTRADICTION;
  if (circularFlag) score -= LOGICAL_SOUNDNESS_PENALTY_CIRCULAR;
  if (causalCount >= LOGICAL_SOUNDNESS_MIN_CAUSAL_FOR_BONUS && contradictions === 0) score += LOGICAL_SOUNDNESS_BONUS_STRONG_CAUSAL;

  return {
    name: "logical_soundness",
    score: clamp(round2(score), 0, 1),
    indicators,
    grade: getGradeFractional(score),
  };
}

function scoreEpistemicHonesty(reasoning: string, confidence: number): CertificationDimension {
  const indicators: string[] = [];
  const conf01 = normalizeConfidence(confidence);

  UNCERTAINTY_MARKERS.lastIndex = 0;
  const uncertaintyCount = (reasoning.match(UNCERTAINTY_MARKERS) ?? []).length;
  UNCERTAINTY_MARKERS.lastIndex = 0;
  if (uncertaintyCount > 0) indicators.push(`${uncertaintyCount} uncertainty acknowledgments`);

  OVERCONFIDENCE_MARKERS.lastIndex = 0;
  const overconfCount = (reasoning.match(OVERCONFIDENCE_MARKERS) ?? []).length;
  OVERCONFIDENCE_MARKERS.lastIndex = 0;
  if (overconfCount > 0) indicators.push(`${overconfCount} overconfidence markers`);

  // Consistency: high confidence + uncertainty markers = good calibration
  // high confidence + no uncertainty = potential overconfidence
  const hasUncertainty = uncertaintyCount > 0;
  const hasOverconfidence = overconfCount > 0;

  let score = EPISTEMIC_HONESTY_BASELINE;
  if (hasUncertainty) score += Math.min(EPISTEMIC_HONESTY_WEIGHT_UNCERTAINTY_BASE, uncertaintyCount * EPISTEMIC_HONESTY_WEIGHT_UNCERTAINTY_PER_MARKER);
  if (hasOverconfidence) score -= overconfCount * EPISTEMIC_HONESTY_PENALTY_OVERCONFIDENCE;

  // Penalize high confidence with no uncertainty markers
  if (conf01 > EPISTEMIC_HONESTY_HIGH_CONF_THRESHOLD && !hasUncertainty && !hasOverconfidence) {
    score -= EPISTEMIC_HONESTY_PENALTY_UNCALIBRATED_HIGH_CONF;
    indicators.push("High confidence without uncertainty acknowledgment");
  }

  // Reward appropriate calibration
  if (conf01 < EPISTEMIC_HONESTY_LOW_CONF_THRESHOLD && hasUncertainty) {
    score += EPISTEMIC_HONESTY_BONUS_CALIBRATED_LOW_CONF;
    indicators.push("Low confidence with appropriate uncertainty expression");
  }

  return {
    name: "epistemic_honesty",
    score: clamp(round2(score), 0, 1),
    indicators,
    grade: getGradeFractional(score),
  };
}

function scoreActionability(reasoning: string, action: string): CertificationDimension {
  const indicators: string[] = [];

  ACTION_SPECIFICS.lastIndex = 0;
  const actionDetails = (reasoning.match(ACTION_SPECIFICS) ?? []).length;
  ACTION_SPECIFICS.lastIndex = 0;
  if (actionDetails > 0) indicators.push(`${actionDetails} actionable details`);

  // Check for clear decision statement
  const hasDecisionStatement = new RegExp(
    `\\b(?:I(?:'m|\\s+am)\\s+(?:buying|selling|holding)|decision\\s+(?:is|to)|I\\s+(?:choose|decide)\\s+to\\s+${action})`,
    "i",
  ).test(reasoning);
  if (hasDecisionStatement) indicators.push("Clear decision statement");

  // Check for position sizing context
  const hasPositionContext = /\b(?:\d+\s*(?:shares?|tokens?|units?)|\$[\d,.]+\s*(?:worth|of)|position\s+size|allocation)\b/i.test(reasoning);
  if (hasPositionContext) indicators.push("Position sizing context");

  // Check for risk management
  const hasRiskMgmt = /\b(?:stop[\s-]loss|take[\s-]profit|exit|risk[\s-]reward|position\s+limit|max\s+(?:loss|risk))\b/i.test(reasoning);
  if (hasRiskMgmt) indicators.push("Risk management criteria");

  let score = 0;
  score += Math.min(ACTIONABILITY_WEIGHT_DETAILS_BASE, actionDetails * ACTIONABILITY_WEIGHT_DETAILS_PER_ITEM);
  if (hasDecisionStatement) score += ACTIONABILITY_WEIGHT_DECISION;
  if (hasPositionContext) score += ACTIONABILITY_WEIGHT_POSITION_SIZING;
  if (hasRiskMgmt) score += ACTIONABILITY_WEIGHT_RISK_MGMT;

  return {
    name: "actionability",
    score: Math.min(1, round2(score)),
    indicators,
    grade: getGradeFractional(score),
  };
}

// Grade classification now uses shared getGradeFractional function from benchmark-grading-utils.ts

// ---------------------------------------------------------------------------
// Query Functions
// ---------------------------------------------------------------------------

/**
 * Get certification profile for an agent.
 */
export function getCertificationProfile(agentId: string): AgentCertificationProfile {
  const certs = certificateStore.get(agentId) ?? [];
  const gold = countByCondition(certs, (c) => c.level === "gold");
  const silver = countByCondition(certs, (c) => c.level === "silver");
  const bronze = countByCondition(certs, (c) => c.level === "bronze");
  const uncertified = countByCondition(certs, (c) => c.level === "uncertified");
  const certified = gold + silver + bronze;
  const total = certs.length;

  const avgComposite = total > 0
    ? round2(certs.reduce((s, c) => s + c.compositeScore, 0) / total)
    : 0;

  // Find best/worst dimensions
  const dimScores: Record<string, number[]> = {};
  for (const cert of certs) {
    for (const dim of cert.dimensions) {
      if (!dimScores[dim.name]) dimScores[dim.name] = [];
      dimScores[dim.name].push(dim.score);
    }
  }
  const dimAvgs = Object.entries(dimScores).map(([name, scores]) => ({
    name,
    avg: scores.reduce((s, v) => s + v, 0) / scores.length,
  }));
  dimAvgs.sort((a, b) => b.avg - a.avg);
  const bestDimension = dimAvgs[0]?.name ?? "none";
  const worstDimension = dimAvgs[dimAvgs.length - 1]?.name ?? "none";

  // Trend detection
  const halfIdx = Math.floor(total / 2);
  const firstHalf = certs.slice(halfIdx);
  const secondHalf = certs.slice(0, halfIdx);
  const firstAvg = firstHalf.length > 0 ? firstHalf.reduce((s, c) => s + c.compositeScore, 0) / firstHalf.length : 0;
  const secondAvg = secondHalf.length > 0 ? secondHalf.reduce((s, c) => s + c.compositeScore, 0) / secondHalf.length : 0;
  let trend: "improving" | "stable" | "declining" = "stable";
  if (secondAvg - firstAvg > TREND_IMPROVEMENT_THRESHOLD) trend = "improving";
  if (firstAvg - secondAvg > TREND_DECLINE_THRESHOLD) trend = "declining";

  // Pillar score: weighted blend of certification rate + composite quality
  const certRate = total > 0 ? certified / total : 0;
  const pillarScore = round2(certRate * PILLAR_WEIGHT_CERT_RATE + avgComposite * PILLAR_WEIGHT_AVG_COMPOSITE);

  return {
    agentId,
    totalCertifications: total,
    goldCount: gold,
    silverCount: silver,
    bronzeCount: bronze,
    uncertifiedCount: uncertified,
    certificationRate: total > 0 ? round2(certRate) : 0,
    avgComposite,
    bestDimension,
    worstDimension,
    trend,
    pillarScore,
  };
}

/**
 * Get all agent certification profiles.
 */
export function getAllCertificationProfiles(): Record<string, AgentCertificationProfile> {
  const profiles: Record<string, AgentCertificationProfile> = {};
  for (const agentId of certificateStore.keys()) {
    profiles[agentId] = getCertificationProfile(agentId);
  }
  return profiles;
}

/**
 * Get certification pillar score for an agent (0-1).
 */
export function getCertificationPillarScore(agentId: string): number {
  return getCertificationProfile(agentId).pillarScore;
}

/**
 * Verify a certificate by its hash.
 */
export function verifyCertificate(hash: string): QualityCertificate | null {
  return certificateByHash.get(hash) ?? null;
}

/**
 * Get recent certificates for an agent.
 */
export function getRecentCertificates(agentId: string, limit = DEFAULT_QUALITY_CERTS_LIMIT): QualityCertificate[] {
  return (certificateStore.get(agentId) ?? []).slice(0, limit);
}

/**
 * Get certification stats across all agents.
 */
export function getCertificationStats(): {
  totalCertificates: number;
  goldTotal: number;
  silverTotal: number;
  bronzeTotal: number;
  uncertifiedTotal: number;
  overallCertRate: number;
  avgComposite: number;
} {
  let total = 0;
  let gold = 0;
  let silver = 0;
  let bronze = 0;
  let uncert = 0;
  let compositeSum = 0;

  for (const certs of certificateStore.values()) {
    total += certs.length;
    for (const c of certs) {
      compositeSum += c.compositeScore;
      if (c.level === "gold") gold++;
      else if (c.level === "silver") silver++;
      else if (c.level === "bronze") bronze++;
      else uncert++;
    }
  }

  return {
    totalCertificates: total,
    goldTotal: gold,
    silverTotal: silver,
    bronzeTotal: bronze,
    uncertifiedTotal: uncert,
    overallCertRate: total > 0 ? round2((gold + silver + bronze) / total) : 0,
    avgComposite: total > 0 ? round2(compositeSum / total) : 0,
  };
}
