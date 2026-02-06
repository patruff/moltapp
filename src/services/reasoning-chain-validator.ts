/**
 * Reasoning Chain Validator (v21)
 *
 * Validates the logical integrity of agent reasoning chains, going beyond
 * simple coherence scoring to analyze the actual logical structure.
 *
 * Key features:
 * 1. STEP DECOMPOSITION: Breaks reasoning into discrete logical steps
 * 2. LOGICAL CONNECTOR ANALYSIS: Validates causal/conditional/comparative links
 * 3. CIRCULAR REASONING DETECTION: Identifies premises that assume their conclusion
 * 4. NON-SEQUITUR DETECTION: Finds conclusions that don't follow from premises
 * 5. EVIDENCE GAP ANALYSIS: Identifies claims lacking evidential support
 * 6. AGGREGATED CHAIN QUALITY SCORE: Overall chain integrity metric
 */

import { normalize } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReasoningStep {
  /** Position of this step in the chain */
  index: number;
  /** Raw text of the step */
  text: string;
  /** Classified step type */
  type: "observation" | "analysis" | "inference" | "conclusion" | "hedge" | "action_rationale";
  /** Indices of prior steps this step depends on */
  dependsOn: number[];
  /** Whether the step cites evidence */
  hasEvidence: boolean;
  /** Kind of evidence cited, if any */
  evidenceType?: "data_cited" | "general_knowledge" | "assumption" | "none";
}

export interface LogicalConnector {
  /** Source step index */
  fromStep: number;
  /** Target step index */
  toStep: number;
  /** Relationship type */
  type: "causal" | "conditional" | "comparative" | "temporal" | "additive" | "contrastive";
  /** Connector strength 0-1 */
  strength: number;
  /** The connecting phrase detected */
  text: string;
}

export interface ChainDefect {
  /** Category of the defect */
  type: "circular_reasoning" | "non_sequitur" | "evidence_gap" | "unsupported_leap" | "contradiction" | "irrelevant_premise";
  /** How severe this defect is (0-1) */
  severity: number;
  /** Human-readable description */
  description: string;
  /** Which steps are involved */
  stepIndices: number[];
}

export interface ChainValidationResult {
  /** Decomposed reasoning steps */
  steps: ReasoningStep[];
  /** Detected logical connectors between steps */
  connectors: LogicalConnector[];
  /** Defects found in the chain */
  defects: ChainDefect[];
  /** Overall chain quality score (0-1) */
  chainQualityScore: number;
  /** Total number of steps in the chain */
  stepCount: number;
  /** Fraction of steps backed by evidence */
  avgStepEvidence: number;
  /** Length of the longest dependency path */
  longestLogicalChain: number;
  /** Whether circular reasoning was detected */
  hasCircularReasoning: boolean;
  /** Whether major evidence gaps exist */
  hasMajorGaps: boolean;
}

// ---------------------------------------------------------------------------
// In-memory per-agent history
// ---------------------------------------------------------------------------

const agentChainHistory: Map<string, ChainValidationResult[]> = new Map();

// ---------------------------------------------------------------------------
// Step type classification patterns
// ---------------------------------------------------------------------------

/** Patterns that indicate an observation (raw data / fact statement) */
const OBSERVATION_PATTERNS: RegExp[] = [
  /\bcurrently\s+(?:at|trading|priced)/i,
  /\bprice\s+is\b/i,
  /\bvolume\s+(?:is|was|at)\b/i,
  /\bmarket\s+(?:is|was|shows)\b/i,
  /\bdata\s+(?:shows|indicates|suggests)\b/i,
  /\b(?:up|down)\s+[\d.]+%/i,
  /\$[\d,.]+/,
  /\bhistorically\b/i,
  /\baccording\s+to\b/i,
];

/** Patterns that indicate an analysis step */
const ANALYSIS_PATTERNS: RegExp[] = [
  /\banalysis\b/i,
  /\bcompared?\s+to\b/i,
  /\brelative\s+to\b/i,
  /\bcorrelat/i,
  /\btrend\b/i,
  /\bpattern\b/i,
  /\bsupport\s+(?:and|\/)\s+resistance\b/i,
  /\bmoving\s+average\b/i,
  /\brsi\b/i,
  /\bmacd\b/i,
  /\bfundamentals?\b/i,
];

/** Patterns that indicate an inference */
const INFERENCE_PATTERNS: RegExp[] = [
  /\btherefore\b/i,
  /\bthus\b/i,
  /\bhence\b/i,
  /\bthis\s+(?:means|implies|suggests|indicates)\b/i,
  /\bwe\s+can\s+(?:infer|conclude|deduce)\b/i,
  /\blikely\b/i,
  /\bprobably\b/i,
  /\bsuggests?\s+that\b/i,
  /\bimplies?\s+that\b/i,
];

/** Patterns that indicate a conclusion */
const CONCLUSION_PATTERNS: RegExp[] = [
  /\bin\s+conclusion\b/i,
  /\boverall\b/i,
  /\btherefore,?\s+(?:I|we)\s+(?:should|will|recommend)\b/i,
  /\bbased\s+on\s+(?:the\s+above|this\s+analysis|these\s+factors)\b/i,
  /\bmy\s+(?:recommendation|decision|verdict)\b/i,
  /\bfinal\s+(?:assessment|verdict|decision)\b/i,
  /\bi\s+(?:recommend|decide|choose)\b/i,
];

/** Patterns that indicate a hedge / qualifier */
const HEDGE_PATTERNS: RegExp[] = [
  /\bhowever\b/i,
  /\balthough\b/i,
  /\bdespite\b/i,
  /\brisk\b/i,
  /\bcaveat\b/i,
  /\bcaution\b/i,
  /\buncertain\b/i,
  /\bon\s+the\s+other\s+hand\b/i,
  /\bnevertheless\b/i,
  /\bbut\b/i,
];

/** Patterns that indicate action rationale */
const ACTION_RATIONALE_PATTERNS: RegExp[] = [
  /\bbuy(?:ing)?\s+because\b/i,
  /\bsell(?:ing)?\s+because\b/i,
  /\bhold(?:ing)?\s+because\b/i,
  /\bposition\b.*\bbecause\b/i,
  /\benter(?:ing)?\s+(?:a\s+)?(?:long|short)\b/i,
  /\btake\s+profit\b/i,
  /\bstop[\s-]loss\b/i,
  /\bexit(?:ing)?\s+(?:the\s+)?position\b/i,
];

// ---------------------------------------------------------------------------
// Logical connector patterns
// ---------------------------------------------------------------------------

interface ConnectorPattern {
  regex: RegExp;
  type: LogicalConnector["type"];
  strength: number;
}

const CONNECTOR_PATTERNS: ConnectorPattern[] = [
  // Causal
  { regex: /\bbecause\b/i, type: "causal", strength: 0.8 },
  { regex: /\bsince\b/i, type: "causal", strength: 0.7 },
  { regex: /\bdue\s+to\b/i, type: "causal", strength: 0.8 },
  { regex: /\bas\s+a\s+result\b/i, type: "causal", strength: 0.9 },
  { regex: /\btherefore\b/i, type: "causal", strength: 0.9 },
  { regex: /\bthus\b/i, type: "causal", strength: 0.8 },
  { regex: /\bhence\b/i, type: "causal", strength: 0.8 },
  { regex: /\bconsequently\b/i, type: "causal", strength: 0.9 },
  { regex: /\bso\b/i, type: "causal", strength: 0.5 },
  // Conditional
  { regex: /\bif\b/i, type: "conditional", strength: 0.7 },
  { regex: /\bassuming\b/i, type: "conditional", strength: 0.6 },
  { regex: /\bprovided\s+that\b/i, type: "conditional", strength: 0.7 },
  { regex: /\bunless\b/i, type: "conditional", strength: 0.7 },
  // Comparative
  { regex: /\bcompared\s+to\b/i, type: "comparative", strength: 0.7 },
  { regex: /\brelative\s+to\b/i, type: "comparative", strength: 0.7 },
  { regex: /\bwhereas\b/i, type: "comparative", strength: 0.6 },
  { regex: /\bmore\s+than\b/i, type: "comparative", strength: 0.5 },
  { regex: /\bless\s+than\b/i, type: "comparative", strength: 0.5 },
  // Temporal
  { regex: /\bafter\b/i, type: "temporal", strength: 0.5 },
  { regex: /\bbefore\b/i, type: "temporal", strength: 0.5 },
  { regex: /\brecently\b/i, type: "temporal", strength: 0.4 },
  { regex: /\bpreviously\b/i, type: "temporal", strength: 0.4 },
  { regex: /\bnow\b/i, type: "temporal", strength: 0.3 },
  // Additive
  { regex: /\bfurthermore\b/i, type: "additive", strength: 0.5 },
  { regex: /\bmoreover\b/i, type: "additive", strength: 0.5 },
  { regex: /\badditionally\b/i, type: "additive", strength: 0.5 },
  { regex: /\balso\b/i, type: "additive", strength: 0.3 },
  { regex: /\band\b/i, type: "additive", strength: 0.2 },
  // Contrastive
  { regex: /\bhowever\b/i, type: "contrastive", strength: 0.7 },
  { regex: /\bbut\b/i, type: "contrastive", strength: 0.6 },
  { regex: /\balthough\b/i, type: "contrastive", strength: 0.6 },
  { regex: /\bdespite\b/i, type: "contrastive", strength: 0.7 },
  { regex: /\bnevertheless\b/i, type: "contrastive", strength: 0.7 },
  { regex: /\bon\s+the\s+other\s+hand\b/i, type: "contrastive", strength: 0.7 },
];

// ---------------------------------------------------------------------------
// Evidence detection patterns
// ---------------------------------------------------------------------------

const DATA_CITED_PATTERNS: RegExp[] = [
  /\$[\d,.]+/,
  /[\d.]+%/,
  /\bprice\s+(?:of|at|is)\b/i,
  /\bvolume\b/i,
  /\bmarket\s+cap\b/i,
  /\bp\/e\b/i,
  /\bearnings\b/i,
  /\brevenue\b/i,
];

const GENERAL_KNOWLEDGE_PATTERNS: RegExp[] = [
  /\bgenerally\b/i,
  /\btypically\b/i,
  /\bhistorically\b/i,
  /\bin\s+(?:the\s+)?past\b/i,
  /\busually\b/i,
  /\bcommonly\b/i,
  /\bwell[\s-]known\b/i,
];

const ASSUMPTION_PATTERNS: RegExp[] = [
  /\bassum/i,
  /\bexpect/i,
  /\bbelieve\b/i,
  /\bthink\b/i,
  /\bfeel\b/i,
  /\bguess\b/i,
  /\bspeculat/i,
  /\bhope\b/i,
];

// ---------------------------------------------------------------------------
// Core: Step Decomposition
// ---------------------------------------------------------------------------

/**
 * Split reasoning text into discrete logical steps.
 * Uses sentence boundaries and classifies each step by type.
 */
function decomposeSteps(reasoning: string): ReasoningStep[] {
  // Split on sentence boundaries: period, semicolon, exclamation, question mark, or newline
  const rawSentences = reasoning
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 5);

  const steps: ReasoningStep[] = [];

  for (let i = 0; i < rawSentences.length; i++) {
    const text = rawSentences[i];
    const type = classifyStepType(text, i, rawSentences.length);
    const evidenceInfo = detectEvidence(text);
    const dependsOn = inferDependencies(text, i, rawSentences);

    steps.push({
      index: i,
      text,
      type,
      dependsOn,
      hasEvidence: evidenceInfo.hasEvidence,
      evidenceType: evidenceInfo.evidenceType,
    });
  }

  return steps;
}

/**
 * Classify a sentence into a reasoning step type.
 * Uses regex pattern matching with positional weighting --
 * early sentences lean toward observations, late ones toward conclusions.
 */
function classifyStepType(
  text: string,
  index: number,
  totalSteps: number,
): ReasoningStep["type"] {
  const scores: Record<ReasoningStep["type"], number> = {
    observation: 0,
    analysis: 0,
    inference: 0,
    conclusion: 0,
    hedge: 0,
    action_rationale: 0,
  };

  for (const p of OBSERVATION_PATTERNS) if (p.test(text)) scores.observation += 1;
  for (const p of ANALYSIS_PATTERNS) if (p.test(text)) scores.analysis += 1;
  for (const p of INFERENCE_PATTERNS) if (p.test(text)) scores.inference += 1;
  for (const p of CONCLUSION_PATTERNS) if (p.test(text)) scores.conclusion += 1;
  for (const p of HEDGE_PATTERNS) if (p.test(text)) scores.hedge += 1;
  for (const p of ACTION_RATIONALE_PATTERNS) if (p.test(text)) scores.action_rationale += 1;

  // Positional bias
  const position = totalSteps > 1 ? index / (totalSteps - 1) : 0.5;
  if (position < 0.3) scores.observation += 0.5;
  if (position > 0.7) scores.conclusion += 0.5;
  if (position > 0.8) scores.action_rationale += 0.3;

  let best: ReasoningStep["type"] = "observation";
  let bestScore = -1;
  for (const [type, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      best = type as ReasoningStep["type"];
    }
  }

  return bestScore > 0 ? best : "observation";
}

/**
 * Detect what kind of evidence a step contains.
 */
function detectEvidence(text: string): {
  hasEvidence: boolean;
  evidenceType: ReasoningStep["evidenceType"];
} {
  for (const p of DATA_CITED_PATTERNS) {
    if (p.test(text)) return { hasEvidence: true, evidenceType: "data_cited" };
  }
  for (const p of GENERAL_KNOWLEDGE_PATTERNS) {
    if (p.test(text)) return { hasEvidence: true, evidenceType: "general_knowledge" };
  }
  for (const p of ASSUMPTION_PATTERNS) {
    if (p.test(text)) return { hasEvidence: false, evidenceType: "assumption" };
  }
  return { hasEvidence: false, evidenceType: "none" };
}

/**
 * Infer which prior steps a given step depends on.
 * Uses back-references, connector words, and shared-keyword analysis.
 */
function inferDependencies(
  text: string,
  index: number,
  allSentences: string[],
): number[] {
  const deps: number[] = [];
  if (index === 0) return deps;

  const lower = text.toLowerCase();

  // Explicit back-references: "this means", "this implies", etc.
  if (/\bthis\s+(?:means|implies|suggests|shows|indicates)\b/i.test(lower)) {
    deps.push(index - 1);
  }

  // Causal connectors reference previous step(s)
  if (/\btherefore\b|\bthus\b|\bhence\b|\bconsequently\b|\bas\s+a\s+result\b/i.test(lower)) {
    deps.push(index - 1);
    if (index >= 2) deps.push(index - 2);
  }

  // Contrastive connectors
  if (/\bhowever\b|\bbut\b|\balthough\b|\bdespite\b|\bnevertheless\b/i.test(lower)) {
    deps.push(index - 1);
  }

  // Additive connectors
  if (/\bfurthermore\b|\bmoreover\b|\badditionally\b/i.test(lower)) {
    deps.push(index - 1);
  }

  // Content-based dependency: shared significant keywords
  const keywords = extractKeywords(text);
  for (let j = 0; j < index; j++) {
    const priorKeywords = extractKeywords(allSentences[j]);
    const shared = keywords.filter((k) => priorKeywords.includes(k));
    if (shared.length >= 2 && !deps.includes(j)) {
      deps.push(j);
    }
  }

  // Default: depend on immediately prior step
  if (deps.length === 0 && index > 0) {
    deps.push(index - 1);
  }

  return [...new Set(deps)].sort((a, b) => a - b);
}

/**
 * Extract significant keywords from text, filtering stop words.
 */
function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "can", "shall", "to", "of", "in", "for",
    "on", "with", "at", "by", "from", "as", "into", "through", "during",
    "and", "or", "but", "not", "no", "so", "if", "then", "than", "that",
    "this", "these", "those", "it", "its", "i", "we", "my", "our",
  ]);
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));
}

// ---------------------------------------------------------------------------
// Core: Connector Detection
// ---------------------------------------------------------------------------

/**
 * Detect logical connectors between reasoning steps.
 * Each step is checked against connector patterns; the first (highest-priority)
 * match is used, linking the step to its primary dependency.
 */
function detectConnectors(steps: ReasoningStep[]): LogicalConnector[] {
  const connectors: LogicalConnector[] = [];

  for (let i = 1; i < steps.length; i++) {
    const step = steps[i];

    for (const pattern of CONNECTOR_PATTERNS) {
      if (pattern.regex.test(step.text)) {
        const fromStep = step.dependsOn.length > 0 ? step.dependsOn[0] : i - 1;
        const match = step.text.match(pattern.regex);

        connectors.push({
          fromStep,
          toStep: i,
          type: pattern.type,
          strength: pattern.strength,
          text: match ? match[0] : "",
        });
        break; // Use the first (highest-priority) match
      }
    }
  }

  return connectors;
}

// ---------------------------------------------------------------------------
// Core: Defect Detection
// ---------------------------------------------------------------------------

/**
 * Detect circular reasoning: step A depends on B which depends on A.
 * Only reports each cycle once.
 */
function detectCircularReasoning(steps: ReasoningStep[]): ChainDefect[] {
  const defects: ChainDefect[] = [];
  const reported = new Set<string>();

  for (const step of steps) {
    for (const depIdx of step.dependsOn) {
      if (depIdx >= 0 && depIdx < steps.length) {
        const depStep = steps[depIdx];
        if (depStep.dependsOn.includes(step.index)) {
          const pairKey = `${Math.min(step.index, depIdx)},${Math.max(step.index, depIdx)}`;
          if (!reported.has(pairKey)) {
            reported.add(pairKey);
            defects.push({
              type: "circular_reasoning",
              severity: 0.8,
              description: `Steps ${Math.min(step.index, depIdx)} and ${Math.max(step.index, depIdx)} reference each other circularly`,
              stepIndices: [Math.min(step.index, depIdx), Math.max(step.index, depIdx)],
            });
          }
        }
      }
    }
  }

  return defects;
}

/**
 * Detect non-sequiturs: conclusions or action rationales that lack
 * supporting analysis/inference/observation dependencies.
 */
function detectNonSequiturs(steps: ReasoningStep[]): ChainDefect[] {
  const defects: ChainDefect[] = [];

  for (const step of steps) {
    if (step.type !== "conclusion" && step.type !== "action_rationale") continue;

    const hasSupportingPremise = step.dependsOn.some((depIdx) => {
      if (depIdx >= 0 && depIdx < steps.length) {
        const depType = steps[depIdx].type;
        return depType === "analysis" || depType === "inference" || depType === "observation";
      }
      return false;
    });

    if (!hasSupportingPremise && step.dependsOn.length > 0) {
      defects.push({
        type: "non_sequitur",
        severity: 0.6,
        description: `Conclusion at step ${step.index} lacks supporting analysis or inference`,
        stepIndices: [step.index],
      });
    }
  }

  return defects;
}

/**
 * Detect evidence gaps: runs of 3+ consecutive steps without data-backed evidence.
 */
function detectEvidenceGaps(steps: ReasoningStep[]): ChainDefect[] {
  const defects: ChainDefect[] = [];
  let gapIndices: number[] = [];

  for (const step of steps) {
    if (!step.hasEvidence) {
      gapIndices.push(step.index);
    } else {
      if (gapIndices.length >= 3) {
        defects.push({
          type: "evidence_gap",
          severity: Math.min(1, 0.3 + gapIndices.length * 0.1),
          description: `Steps ${gapIndices[0]}-${gapIndices[gapIndices.length - 1]} (${gapIndices.length} steps) lack evidential support`,
          stepIndices: [...gapIndices],
        });
      }
      gapIndices = [];
    }
  }

  // Trailing gap
  if (gapIndices.length >= 3) {
    defects.push({
      type: "evidence_gap",
      severity: Math.min(1, 0.3 + gapIndices.length * 0.1),
      description: `Steps ${gapIndices[0]}-${gapIndices[gapIndices.length - 1]} (${gapIndices.length} steps) lack evidential support`,
      stepIndices: [...gapIndices],
    });
  }

  return defects;
}

/**
 * Detect contradictions: steps that assert opposing directional claims
 * about the same subject without any hedging step between them.
 */
function detectContradictions(steps: ReasoningStep[]): ChainDefect[] {
  const defects: ChainDefect[] = [];
  const bullishSteps: number[] = [];
  const bearishSteps: number[] = [];

  for (const step of steps) {
    const text = step.text.toLowerCase();
    if (/\bbullish\b|\bupside\b|\bundervalued\b|\bgrowth\b|\bbuy\b/.test(text)) {
      bullishSteps.push(step.index);
    }
    if (/\bbearish\b|\bdownside\b|\bovervalued\b|\bdecline\b|\bsell\b/.test(text)) {
      bearishSteps.push(step.index);
    }
  }

  if (bullishSteps.length > 0 && bearishSteps.length > 0) {
    const hasHedge = steps.some((s) => s.type === "hedge");
    if (!hasHedge) {
      defects.push({
        type: "contradiction",
        severity: 0.7,
        description: `Contradictory signals: bullish at steps [${bullishSteps.join(",")}] vs bearish at [${bearishSteps.join(",")}] without hedging`,
        stepIndices: [...bullishSteps, ...bearishSteps],
      });
    }
  }

  return defects;
}

/**
 * Detect unsupported leaps: an inference/conclusion that jumps 4+ steps
 * back to a single observation with no intermediate analysis.
 */
function detectUnsupportedLeaps(steps: ReasoningStep[]): ChainDefect[] {
  const defects: ChainDefect[] = [];

  for (const step of steps) {
    if (step.type !== "inference" && step.type !== "conclusion") continue;

    for (const depIdx of step.dependsOn) {
      if (depIdx >= 0 && depIdx < steps.length) {
        const gap = step.index - depIdx;
        const depStep = steps[depIdx];
        if (gap >= 4 && depStep.type === "observation" && step.dependsOn.length === 1) {
          defects.push({
            type: "unsupported_leap",
            severity: 0.5,
            description: `Step ${step.index} leaps ${gap} steps back to observation at step ${depIdx} without intermediate analysis`,
            stepIndices: [depIdx, step.index],
          });
        }
      }
    }
  }

  return defects;
}

// ---------------------------------------------------------------------------
// Core: Chain Metrics
// ---------------------------------------------------------------------------

/**
 * Compute the longest dependency chain length via depth-first traversal.
 * Breaks cycles to avoid infinite recursion.
 */
function computeLongestChain(steps: ReasoningStep[]): number {
  const memo = new Map<number, number>();

  function dfs(idx: number, visited: Set<number>): number {
    if (memo.has(idx)) return memo.get(idx)!;
    if (visited.has(idx)) return 0;

    visited.add(idx);
    const step = steps[idx];
    if (!step || step.dependsOn.length === 0) {
      memo.set(idx, 1);
      return 1;
    }

    let maxDepth = 0;
    for (const dep of step.dependsOn) {
      if (dep >= 0 && dep < steps.length) {
        const depth = dfs(dep, visited);
        if (depth > maxDepth) maxDepth = depth;
      }
    }

    const result = maxDepth + 1;
    memo.set(idx, result);
    return result;
  }

  let longest = 0;
  for (let i = 0; i < steps.length; i++) {
    const chain = dfs(i, new Set());
    if (chain > longest) longest = chain;
  }

  return longest;
}

/**
 * Compute the chain quality score.
 *
 * Formula:
 *   base = 0.6
 *   + 0.2 * (evidenceSteps / totalSteps)
 *   + 0.1 * (validConnectors / totalSteps)
 *   + 0.1 * min(1, longestChain / 4)
 *   - 0.15 per major defect (severity > 0.5)
 *   - 0.05 per minor defect (severity <= 0.5)
 *   clamped to [0, 1]
 */
function computeChainQualityScore(
  steps: ReasoningStep[],
  connectors: LogicalConnector[],
  defects: ChainDefect[],
  longestChain: number,
): number {
  if (steps.length === 0) return 0;

  const totalSteps = steps.length;
  const evidenceSteps = steps.filter((s) => s.hasEvidence).length;
  const validConnectors = connectors.filter((c) => c.strength >= 0.5).length;

  let score = 0.6;
  score += 0.2 * (evidenceSteps / totalSteps);
  score += 0.1 * (validConnectors / totalSteps);
  score += 0.1 * Math.min(1, longestChain / 4);

  for (const defect of defects) {
    score -= defect.severity > 0.5 ? 0.15 : 0.05;
  }

  return Math.round(normalize(score) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate the logical integrity of an agent's reasoning chain.
 *
 * Decomposes the reasoning into discrete logical steps, analyzes connectors
 * between them, detects defects (circular reasoning, non-sequiturs, evidence
 * gaps, contradictions, unsupported leaps), and computes an overall quality
 * score.
 *
 * @param reasoning - The agent's full reasoning text
 * @param action - The trade action taken (buy/sell/hold)
 * @param symbol - The ticker symbol being traded
 * @returns A comprehensive chain validation result
 */
export function validateReasoningChain(
  reasoning: string,
  action: string,
  symbol: string,
): ChainValidationResult {
  const steps = decomposeSteps(reasoning);
  const connectors = detectConnectors(steps);

  const defects: ChainDefect[] = [
    ...detectCircularReasoning(steps),
    ...detectNonSequiturs(steps),
    ...detectEvidenceGaps(steps),
    ...detectContradictions(steps),
    ...detectUnsupportedLeaps(steps),
  ];

  const longestChain = computeLongestChain(steps);
  const evidenceSteps = steps.filter((s) => s.hasEvidence).length;
  const avgStepEvidence = steps.length > 0 ? evidenceSteps / steps.length : 0;
  const chainQualityScore = computeChainQualityScore(steps, connectors, defects, longestChain);

  return {
    steps,
    connectors,
    defects,
    chainQualityScore,
    stepCount: steps.length,
    avgStepEvidence: Math.round(avgStepEvidence * 100) / 100,
    longestLogicalChain: longestChain,
    hasCircularReasoning: defects.some((d) => d.type === "circular_reasoning"),
    hasMajorGaps: defects.some((d) => d.type === "evidence_gap" && d.severity > 0.5),
  };
}

/**
 * Record a chain validation result for a specific agent.
 * Stores in the in-memory per-agent history for pillar scoring.
 *
 * @param agentId - Unique agent identifier
 * @param result - The validation result to store
 */
export function recordChainValidation(agentId: string, result: ChainValidationResult): void {
  const history = agentChainHistory.get(agentId) ?? [];
  history.push(result);
  agentChainHistory.set(agentId, history);
}

/**
 * Compute the chain validation pillar score for an agent.
 *
 * Weighted formula:
 *   avgChainQuality * 0.4 + avgStepEvidence * 0.3 + (1 - defectRate) * 0.3
 *
 * Returns 0.5 (neutral default) if the agent has no recorded validations.
 *
 * @param agentId - Unique agent identifier
 * @returns Pillar score between 0 and 1
 */
export function getChainValidationPillarScore(agentId: string): number {
  const history = agentChainHistory.get(agentId);
  if (!history || history.length === 0) return 0.5;

  const avgQuality = history.reduce((sum, r) => sum + r.chainQualityScore, 0) / history.length;
  const avgEvidence = history.reduce((sum, r) => sum + r.avgStepEvidence, 0) / history.length;

  const totalDefects = history.reduce((sum, r) => sum + r.defects.length, 0);
  const totalSteps = history.reduce((sum, r) => sum + r.stepCount, 0);
  const defectRate = totalSteps > 0 ? Math.min(1, totalDefects / totalSteps) : 0;

  const pillarScore = avgQuality * 0.4 + avgEvidence * 0.3 + (1 - defectRate) * 0.3;
  return Math.round(normalize(pillarScore) * 100) / 100;
}

/**
 * Retrieve chain validation profiles for all agents with recorded history.
 *
 * @returns A map of agentId to profile with avgQuality, avgEvidence,
 *          defectRate, and totalChains
 */
export function getAllChainProfiles(): Record<
  string,
  { avgQuality: number; avgEvidence: number; defectRate: number; totalChains: number }
> {
  const profiles: Record<
    string,
    { avgQuality: number; avgEvidence: number; defectRate: number; totalChains: number }
  > = {};

  for (const [agentId, history] of agentChainHistory.entries()) {
    if (history.length === 0) continue;

    const avgQuality = history.reduce((sum, r) => sum + r.chainQualityScore, 0) / history.length;
    const avgEvidence = history.reduce((sum, r) => sum + r.avgStepEvidence, 0) / history.length;

    const totalDefects = history.reduce((sum, r) => sum + r.defects.length, 0);
    const totalSteps = history.reduce((sum, r) => sum + r.stepCount, 0);
    const defectRate = totalSteps > 0 ? totalDefects / totalSteps : 0;

    profiles[agentId] = {
      avgQuality: Math.round(avgQuality * 100) / 100,
      avgEvidence: Math.round(avgEvidence * 100) / 100,
      defectRate: Math.round(defectRate * 100) / 100,
      totalChains: history.length,
    };
  }

  return profiles;
}

/**
 * Get global chain validation statistics across all agents.
 *
 * @returns Aggregate stats including total validations, average quality,
 *          average defects per chain, and defect type distribution
 */
export function getChainStats(): {
  totalValidations: number;
  avgQuality: number;
  avgDefectsPerChain: number;
  defectDistribution: Record<string, number>;
} {
  let totalValidations = 0;
  let qualitySum = 0;
  let defectSum = 0;
  const defectDistribution: Record<string, number> = {};

  for (const history of agentChainHistory.values()) {
    for (const result of history) {
      totalValidations++;
      qualitySum += result.chainQualityScore;
      defectSum += result.defects.length;

      for (const defect of result.defects) {
        defectDistribution[defect.type] = (defectDistribution[defect.type] ?? 0) + 1;
      }
    }
  }

  return {
    totalValidations,
    avgQuality: totalValidations > 0
      ? Math.round((qualitySum / totalValidations) * 100) / 100
      : 0,
    avgDefectsPerChain: totalValidations > 0
      ? Math.round((defectSum / totalValidations) * 100) / 100
      : 0,
    defectDistribution,
  };
}
