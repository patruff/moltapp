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
// State
// ---------------------------------------------------------------------------

const certificateStore = new Map<string, QualityCertificate[]>();
const certificateByHash = new Map<string, QualityCertificate>();
const MAX_CERTS_PER_AGENT = 300;

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

  // Compute composite score
  const weights = [0.20, 0.25, 0.20, 0.15, 0.20];
  const compositeScore = Math.round(
    dimensions.reduce((sum, d, i) => sum + d.score * weights[i], 0) * 100,
  ) / 100;

  // Determine certification level
  const minScore = Math.min(...dimensions.map((d) => d.score));
  let level: CertificationLevel;
  if (minScore >= 0.8) level = "gold";
  else if (minScore >= 0.6) level = "silver";
  else if (minScore >= 0.4) level = "bronze";
  else level = "uncertified";

  // Create certificate
  const reasoningHash = createHash("sha256").update(reasoning).digest("hex").slice(0, 16);
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
  const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const certificate: QualityCertificate = {
    certificateId: `cert_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
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

  const sentences = reasoning.split(/[.!?]+/).filter((s) => s.trim().length > 10);
  const wordCount = reasoning.split(/\s+/).length;
  if (wordCount > 50) indicators.push(`${wordCount} words (sufficient depth)`);

  let score = 0;
  if (hasThesis) score += 0.25;
  if (evidenceCount > 0) score += Math.min(0.30, evidenceCount * 0.10);
  if (hasConclusion) score += 0.20;
  if (sentences.length >= 3) score += 0.15;
  if (wordCount >= 50) score += 0.10;

  return {
    name: "structural_completeness",
    score: Math.min(1, Math.round(score * 100) / 100),
    indicators,
    grade: getGrade(score),
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
  score += Math.min(0.30, quantClaims * 0.06);
  score += Math.min(0.20, timeRefs * 0.07);
  score += Math.min(0.30, sourceCount * 0.10);
  // Bonus for diverse sources
  if (sourceCount >= 3) score += 0.10;
  // Bonus for specific price/percentage mentions
  if (/\$\d+/.test(reasoning)) score += 0.10;

  return {
    name: "data_grounding",
    score: Math.min(1, Math.round(score * 100) / 100),
    indicators,
    grade: getGrade(score),
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
  const sentences = reasoning.split(/[.!?]+/).filter((s) => s.trim().length > 20);
  let circularFlag = false;
  if (sentences.length >= 2) {
    const first = sentences[0].trim().toLowerCase().slice(0, 50);
    const last = sentences[sentences.length - 1].trim().toLowerCase().slice(0, 50);
    if (first === last) {
      circularFlag = true;
      indicators.push("Potentially circular: first and last points identical");
    }
  }

  let score = 0.5; // Start at baseline
  score += Math.min(0.30, causalCount * 0.05);
  score -= contradictions * 0.15;
  if (circularFlag) score -= 0.10;
  if (causalCount >= 3 && contradictions === 0) score += 0.10;

  return {
    name: "logical_soundness",
    score: Math.max(0, Math.min(1, Math.round(score * 100) / 100)),
    indicators,
    grade: getGrade(score),
  };
}

function scoreEpistemicHonesty(reasoning: string, confidence: number): CertificationDimension {
  const indicators: string[] = [];
  const conf01 = confidence > 1 ? confidence / 100 : confidence;

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

  let score = 0.5;
  if (hasUncertainty) score += Math.min(0.25, uncertaintyCount * 0.08);
  if (hasOverconfidence) score -= overconfCount * 0.10;

  // Penalize high confidence with no uncertainty markers
  if (conf01 > 0.8 && !hasUncertainty && !hasOverconfidence) {
    score -= 0.10;
    indicators.push("High confidence without uncertainty acknowledgment");
  }

  // Reward appropriate calibration
  if (conf01 < 0.5 && hasUncertainty) {
    score += 0.10;
    indicators.push("Low confidence with appropriate uncertainty expression");
  }

  return {
    name: "epistemic_honesty",
    score: Math.max(0, Math.min(1, Math.round(score * 100) / 100)),
    indicators,
    grade: getGrade(score),
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
  score += Math.min(0.30, actionDetails * 0.05);
  if (hasDecisionStatement) score += 0.25;
  if (hasPositionContext) score += 0.20;
  if (hasRiskMgmt) score += 0.25;

  return {
    name: "actionability",
    score: Math.min(1, Math.round(score * 100) / 100),
    indicators,
    grade: getGrade(score),
  };
}

function getGrade(score: number): string {
  if (score >= 0.9) return "A";
  if (score >= 0.8) return "B+";
  if (score >= 0.7) return "B";
  if (score >= 0.6) return "C+";
  if (score >= 0.5) return "C";
  if (score >= 0.4) return "D";
  return "F";
}

// ---------------------------------------------------------------------------
// Query Functions
// ---------------------------------------------------------------------------

/**
 * Get certification profile for an agent.
 */
export function getCertificationProfile(agentId: string): AgentCertificationProfile {
  const certs = certificateStore.get(agentId) ?? [];
  const gold = certs.filter((c) => c.level === "gold").length;
  const silver = certs.filter((c) => c.level === "silver").length;
  const bronze = certs.filter((c) => c.level === "bronze").length;
  const uncertified = certs.filter((c) => c.level === "uncertified").length;
  const certified = gold + silver + bronze;
  const total = certs.length;

  const avgComposite = total > 0
    ? Math.round((certs.reduce((s, c) => s + c.compositeScore, 0) / total) * 100) / 100
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
  if (secondAvg - firstAvg > 0.03) trend = "improving";
  if (firstAvg - secondAvg > 0.03) trend = "declining";

  // Pillar score: weighted blend of certification rate + composite quality
  const certRate = total > 0 ? certified / total : 0;
  const pillarScore = Math.round((certRate * 0.4 + avgComposite * 0.6) * 100) / 100;

  return {
    agentId,
    totalCertifications: total,
    goldCount: gold,
    silverCount: silver,
    bronzeCount: bronze,
    uncertifiedCount: uncertified,
    certificationRate: total > 0 ? Math.round(certRate * 100) / 100 : 0,
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
export function getRecentCertificates(agentId: string, limit = 20): QualityCertificate[] {
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
    overallCertRate: total > 0 ? Math.round(((gold + silver + bronze) / total) * 100) / 100 : 0,
    avgComposite: total > 0 ? Math.round((compositeSum / total) * 100) / 100 : 0,
  };
}
