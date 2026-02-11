/**
 * Reasoning Diff Engine
 *
 * Compares how different AI agents reason about the SAME stock at the SAME
 * time. This is a core benchmark feature that reveals:
 *
 * 1. DIVERGENCE: Do agents reach different conclusions from the same data?
 * 2. REASONING DEPTH: Which agent provides more substantive analysis?
 * 3. SOURCE COVERAGE: Which agents reference more data sources?
 * 4. CONFIDENCE SPREAD: How much do agents disagree on conviction?
 * 5. INTENT DIVERGENCE: Do agents classify their strategy differently?
 *
 * This data is critical for the benchmark because it shows that different
 * LLM architectures (Claude/GPT/Grok) interpret the same market data
 * differently — which is exactly what makes AI trading interesting.
 */

import { round2 } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Divergence Scoring Weights
 *
 * These weights control how much each factor contributes to the overall divergence
 * score between two agents' reasoning. Higher weights mean stronger penalties for
 * disagreement in that dimension.
 */

/** Weight for action conflict in divergence calculation (buy vs sell opposition) */
const ACTION_CONFLICT_WEIGHT = 0.4; // 40% — HIGHEST weight, opposing trades is most severe

/** Weight for intent mismatch in divergence calculation (different strategy types) */
const INTENT_MISMATCH_WEIGHT = 0.15; // 15% — strategy classification matters

/** Multiplier for confidence spread contribution to divergence (0-1 spread → weighted contribution) */
const CONFIDENCE_SPREAD_MULTIPLIER = 0.2; // 20% — large conviction gaps significant

/** Multiplier for source coverage divergence (unique sources / total sources) */
const SOURCE_COVERAGE_MULTIPLIER = 0.1; // 10% — data sourcing matters less than conclusions

/** Weight for coherence delta when difference exceeds threshold */
const COHERENCE_DELTA_WEIGHT = 0.15; // 15% — reasoning quality divergence

/**
 * Divergence Detection Thresholds
 *
 * These thresholds control when differences are flagged as significant in summary text.
 */

/** Minimum coherence score difference to add coherence divergence penalty */
const COHERENCE_DELTA_THRESHOLD = 0.3; // 30% coherence gap triggers divergence penalty

/** Minimum confidence spread (0-1) to report as "Large confidence gap" in summary */
const CONFIDENCE_SPREAD_SIGNIFICANT_THRESHOLD = 0.3; // 30 percentage points = notable disagreement

/** Minimum reasoning length ratio to report depth divergence in summary */
const REASONING_LENGTH_RATIO_SIGNIFICANT = 2.0; // 2× word count difference = depth disparity

/**
 * Query and Memory Limits
 *
 * Control how much reasoning diff history is retained for analysis.
 */

/** Maximum number of diff reports to retain in memory (prevents unbounded growth) */
const MAX_DIFF_HISTORY = 200; // ~200 rounds = 7-10 days of history

/** Maximum number of rounds cached for snapshot lookup (for pending comparisons) */
const MAX_ROUND_CACHE = 500; // ~500 rounds = 2-3 weeks of snapshot retention

/** Default number of recent diff reports returned by getRecentDiffReports() */
const RECENT_DIFFS_DEFAULT_LIMIT = 20; // ~20 rounds = 1 day of recent activity

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReasoningSnapshot {
  agentId: string;
  action: "buy" | "sell" | "hold";
  symbol: string;
  quantity: number;
  reasoning: string;
  confidence: number;
  intent: string;
  sources: string[];
  coherenceScore: number;
  hallucinationCount: number;
  roundId: string;
  timestamp: string;
}

export interface ReasoningDiff {
  /** The stock both agents analyzed */
  symbol: string;
  /** The round these decisions came from */
  roundId: string;
  /** Timestamp */
  timestamp: string;
  /** Agent A's reasoning snapshot */
  agentA: ReasoningSnapshot;
  /** Agent B's reasoning snapshot */
  agentB: ReasoningSnapshot;
  /** Analysis of the differences */
  analysis: DiffAnalysis;
}

export interface DiffAnalysis {
  /** Did agents take opposite actions? */
  actionConflict: boolean;
  /** Magnitude of confidence disagreement (0-1) */
  confidenceSpread: number;
  /** Did agents use the same strategy intent? */
  intentMatch: boolean;
  /** How many sources overlap between agents */
  sharedSources: string[];
  /** Sources unique to agent A */
  uniqueSourcesA: string[];
  /** Sources unique to agent B */
  uniqueSourcesB: string[];
  /** Which agent wrote more detailed reasoning */
  deeperReasoningAgent: string;
  /** Reasoning length ratio (longer / shorter) */
  reasoningLengthRatio: number;
  /** Which agent had higher coherence */
  higherCoherenceAgent: string;
  /** Divergence score: 0 (identical) to 1 (completely opposed) */
  divergenceScore: number;
  /** Human-readable summary of the key differences */
  summary: string;
}

export interface RoundDiffReport {
  roundId: string;
  timestamp: string;
  /** All pairwise diffs for this round */
  diffs: ReasoningDiff[];
  /** Aggregate stats */
  stats: {
    avgDivergence: number;
    actionConflictRate: number;
    avgConfidenceSpread: number;
    mostDisagreedSymbol: string | null;
    consensusSymbols: string[];
  };
}

export interface AgentDiffProfile {
  agentId: string;
  /** How often this agent disagrees with others */
  avgDivergenceScore: number;
  /** How often this agent takes opposite positions */
  contrarianRate: number;
  /** Average confidence relative to peers */
  relativeConfidence: number;
  /** How deep is reasoning relative to peers */
  relativeReasoningDepth: number;
  /** Most common intent when disagreeing */
  disagreementIntent: string | null;
  /** Rounds analyzed */
  roundsAnalyzed: number;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const roundSnapshots = new Map<string, ReasoningSnapshot[]>();
const diffHistory: RoundDiffReport[] = [];

// ---------------------------------------------------------------------------
// Core: Record & Compare
// ---------------------------------------------------------------------------

/**
 * Record a reasoning snapshot for later comparison.
 * Called by the orchestrator after each agent decision in a round.
 */
export function recordReasoningSnapshot(snapshot: ReasoningSnapshot): void {
  const existing = roundSnapshots.get(snapshot.roundId) ?? [];
  existing.push(snapshot);
  roundSnapshots.set(snapshot.roundId, existing);

  // Trim old rounds
  if (roundSnapshots.size > MAX_ROUND_CACHE) {
    const keys = Array.from(roundSnapshots.keys());
    for (let i = 0; i < keys.length - MAX_ROUND_CACHE; i++) {
      roundSnapshots.delete(keys[i]);
    }
  }
}

/**
 * Generate pairwise reasoning diffs for a completed round.
 * Should be called after ALL agents have submitted decisions for a round.
 */
export function generateRoundDiffs(roundId: string): RoundDiffReport | null {
  const snapshots = roundSnapshots.get(roundId);
  if (!snapshots || snapshots.length < 2) return null;

  const diffs: ReasoningDiff[] = [];

  // Generate all pairwise comparisons
  for (let i = 0; i < snapshots.length; i++) {
    for (let j = i + 1; j < snapshots.length; j++) {
      const a = snapshots[i];
      const b = snapshots[j];

      // Only compare when agents analyzed the same symbol OR both made decisions
      const diff = computeDiff(a, b);
      diffs.push(diff);
    }
  }

  // Compute aggregate stats
  const actionConflicts = diffs.filter((d) => d.analysis.actionConflict).length;
  const avgDivergence = diffs.length > 0
    ? diffs.reduce((s, d) => s + d.analysis.divergenceScore, 0) / diffs.length
    : 0;
  const avgConfidenceSpread = diffs.length > 0
    ? diffs.reduce((s, d) => s + d.analysis.confidenceSpread, 0) / diffs.length
    : 0;

  // Find most disagreed symbol
  const symbolConflicts = new Map<string, number>();
  for (const diff of diffs) {
    if (diff.analysis.actionConflict) {
      const sym = diff.symbol;
      symbolConflicts.set(sym, (symbolConflicts.get(sym) ?? 0) + 1);
    }
  }
  const mostDisagreedSymbol = symbolConflicts.size > 0
    ? [...symbolConflicts.entries()].sort((a, b) => b[1] - a[1])[0][0]
    : null;

  // Consensus symbols: where all agents agreed on action
  const symbolActions = new Map<string, Set<string>>();
  for (const s of snapshots) {
    const actions = symbolActions.get(s.symbol) ?? new Set();
    actions.add(s.action);
    symbolActions.set(s.symbol, actions);
  }
  const consensusSymbols = [...symbolActions.entries()]
    .filter(([, actions]) => actions.size === 1)
    .map(([sym]) => sym);

  const report: RoundDiffReport = {
    roundId,
    timestamp: snapshots[0].timestamp,
    diffs,
    stats: {
      avgDivergence: round2(avgDivergence),
      actionConflictRate: diffs.length > 0
        ? round2(actionConflicts / diffs.length)
        : 0,
      avgConfidenceSpread: round2(avgConfidenceSpread),
      mostDisagreedSymbol,
      consensusSymbols,
    },
  };

  // Store
  diffHistory.unshift(report);
  if (diffHistory.length > MAX_DIFF_HISTORY) {
    diffHistory.length = MAX_DIFF_HISTORY;
  }

  return report;
}

/**
 * Compute the diff between two agent reasoning snapshots.
 */
function computeDiff(a: ReasoningSnapshot, b: ReasoningSnapshot): ReasoningDiff {
  // Action conflict analysis
  const actionConflict =
    (a.action === "buy" && b.action === "sell") ||
    (a.action === "sell" && b.action === "buy");

  // Confidence spread (normalized 0-1)
  const confA = a.confidence > 1 ? a.confidence / 100 : a.confidence;
  const confB = b.confidence > 1 ? b.confidence / 100 : b.confidence;
  const confidenceSpread = Math.abs(confA - confB);

  // Intent comparison
  const intentMatch = a.intent === b.intent;

  // Source overlap analysis
  const sourcesA = new Set(a.sources);
  const sourcesB = new Set(b.sources);
  const sharedSources = [...sourcesA].filter((s) => sourcesB.has(s));
  const uniqueSourcesA = [...sourcesA].filter((s) => !sourcesB.has(s));
  const uniqueSourcesB = [...sourcesB].filter((s) => !sourcesA.has(s));

  // Reasoning depth
  const lenA = a.reasoning.length;
  const lenB = b.reasoning.length;
  const deeperReasoningAgent = lenA >= lenB ? a.agentId : b.agentId;
  const reasoningLengthRatio = Math.min(lenA, lenB) > 0
    ? round2(Math.max(lenA, lenB) / Math.min(lenA, lenB))
    : 1;

  // Coherence comparison
  const higherCoherenceAgent = a.coherenceScore >= b.coherenceScore
    ? a.agentId
    : b.agentId;

  // Compute divergence score (0 = identical thinking, 1 = completely opposed)
  let divergence = 0;
  if (actionConflict) divergence += ACTION_CONFLICT_WEIGHT;
  if (!intentMatch) divergence += INTENT_MISMATCH_WEIGHT;
  divergence += confidenceSpread * CONFIDENCE_SPREAD_MULTIPLIER;
  divergence += (1 - (sharedSources.length / Math.max(1, sourcesA.size + sourcesB.size - sharedSources.length))) * SOURCE_COVERAGE_MULTIPLIER;
  if (Math.abs(a.coherenceScore - b.coherenceScore) > COHERENCE_DELTA_THRESHOLD) divergence += COHERENCE_DELTA_WEIGHT;
  divergence = Math.min(1, divergence);

  // Build summary
  const summaryParts: string[] = [];
  if (actionConflict) {
    summaryParts.push(
      `ACTION CONFLICT: ${a.agentId} wants to ${a.action} while ${b.agentId} wants to ${b.action}`,
    );
  }
  if (confidenceSpread > CONFIDENCE_SPREAD_SIGNIFICANT_THRESHOLD) {
    summaryParts.push(
      `Large confidence gap: ${a.agentId}=${(confA * 100).toFixed(0)}% vs ${b.agentId}=${(confB * 100).toFixed(0)}%`,
    );
  }
  if (!intentMatch) {
    summaryParts.push(
      `Different strategies: ${a.agentId} (${a.intent}) vs ${b.agentId} (${b.intent})`,
    );
  }
  if (reasoningLengthRatio > REASONING_LENGTH_RATIO_SIGNIFICANT) {
    summaryParts.push(
      `${deeperReasoningAgent} provided ${reasoningLengthRatio}x more detailed reasoning`,
    );
  }
  if (summaryParts.length === 0) {
    summaryParts.push("Agents largely agree on this trade");
  }

  const analysis: DiffAnalysis = {
    actionConflict,
    confidenceSpread: round2(confidenceSpread),
    intentMatch,
    sharedSources,
    uniqueSourcesA,
    uniqueSourcesB,
    deeperReasoningAgent,
    reasoningLengthRatio,
    higherCoherenceAgent,
    divergenceScore: round2(divergence),
    summary: summaryParts.join(". "),
  };

  return {
    symbol: a.symbol !== b.symbol ? `${a.symbol} vs ${b.symbol}` : a.symbol,
    roundId: a.roundId,
    timestamp: a.timestamp,
    agentA: a,
    agentB: b,
    analysis,
  };
}

// ---------------------------------------------------------------------------
// Query API
// ---------------------------------------------------------------------------

/**
 * Get diff reports for recent rounds.
 */
export function getRecentDiffReports(limit = RECENT_DIFFS_DEFAULT_LIMIT): RoundDiffReport[] {
  return diffHistory.slice(0, limit);
}

/**
 * Get a specific round's diff report.
 */
export function getRoundDiffReport(roundId: string): RoundDiffReport | null {
  return diffHistory.find((d) => d.roundId === roundId) ?? null;
}

/**
 * Build a diff profile for a specific agent across all rounds.
 * Shows how this agent's reasoning compares to its peers over time.
 */
export function getAgentDiffProfile(agentId: string): AgentDiffProfile {
  let totalDivergence = 0;
  let contrarianCount = 0;
  let totalDiffs = 0;
  let totalRelativeConfidence = 0;
  let totalRelativeDepth = 0;
  const intentWhenDisagreeing = new Map<string, number>();

  for (const report of diffHistory) {
    for (const diff of report.diffs) {
      const isA = diff.agentA.agentId === agentId;
      const isB = diff.agentB.agentId === agentId;
      if (!isA && !isB) continue;

      totalDiffs++;
      totalDivergence += diff.analysis.divergenceScore;

      if (diff.analysis.actionConflict) {
        contrarianCount++;
        const mySnapshot = isA ? diff.agentA : diff.agentB;
        const intent = mySnapshot.intent;
        intentWhenDisagreeing.set(
          intent,
          (intentWhenDisagreeing.get(intent) ?? 0) + 1,
        );
      }

      const myConf = isA
        ? (diff.agentA.confidence > 1 ? diff.agentA.confidence / 100 : diff.agentA.confidence)
        : (diff.agentB.confidence > 1 ? diff.agentB.confidence / 100 : diff.agentB.confidence);
      const peerConf = isA
        ? (diff.agentB.confidence > 1 ? diff.agentB.confidence / 100 : diff.agentB.confidence)
        : (diff.agentA.confidence > 1 ? diff.agentA.confidence / 100 : diff.agentA.confidence);

      totalRelativeConfidence += myConf - peerConf;

      const myLen = isA ? diff.agentA.reasoning.length : diff.agentB.reasoning.length;
      const peerLen = isA ? diff.agentB.reasoning.length : diff.agentA.reasoning.length;
      totalRelativeDepth += peerLen > 0 ? myLen / peerLen - 1 : 0;
    }
  }

  const disagreementIntent = intentWhenDisagreeing.size > 0
    ? [...intentWhenDisagreeing.entries()].sort((a, b) => b[1] - a[1])[0][0]
    : null;

  return {
    agentId,
    avgDivergenceScore: totalDiffs > 0
      ? round2(totalDivergence / totalDiffs)
      : 0,
    contrarianRate: totalDiffs > 0
      ? round2(contrarianCount / totalDiffs)
      : 0,
    relativeConfidence: totalDiffs > 0
      ? round2(totalRelativeConfidence / totalDiffs)
      : 0,
    relativeReasoningDepth: totalDiffs > 0
      ? round2(totalRelativeDepth / totalDiffs)
      : 0,
    disagreementIntent,
    roundsAnalyzed: diffHistory.filter((r) =>
      r.diffs.some(
        (d) => d.agentA.agentId === agentId || d.agentB.agentId === agentId,
      ),
    ).length,
  };
}

/**
 * Get aggregate diff statistics across all rounds.
 */
export function getDiffAggregateStats(): {
  totalRounds: number;
  totalDiffs: number;
  avgDivergence: number;
  avgActionConflictRate: number;
  avgConfidenceSpread: number;
  mostCommonConflictSymbol: string | null;
} {
  if (diffHistory.length === 0) {
    return {
      totalRounds: 0,
      totalDiffs: 0,
      avgDivergence: 0,
      avgActionConflictRate: 0,
      avgConfidenceSpread: 0,
      mostCommonConflictSymbol: null,
    };
  }

  const totalDiffs = diffHistory.reduce((s, r) => s + r.diffs.length, 0);
  const avgDivergence = diffHistory.reduce((s, r) => s + r.stats.avgDivergence, 0) / diffHistory.length;
  const avgActionConflictRate = diffHistory.reduce((s, r) => s + r.stats.actionConflictRate, 0) / diffHistory.length;
  const avgConfidenceSpread = diffHistory.reduce((s, r) => s + r.stats.avgConfidenceSpread, 0) / diffHistory.length;

  const conflictSymbolCounts = new Map<string, number>();
  for (const report of diffHistory) {
    if (report.stats.mostDisagreedSymbol) {
      const sym = report.stats.mostDisagreedSymbol;
      conflictSymbolCounts.set(sym, (conflictSymbolCounts.get(sym) ?? 0) + 1);
    }
  }
  const mostCommonConflictSymbol = conflictSymbolCounts.size > 0
    ? [...conflictSymbolCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
    : null;

  return {
    totalRounds: diffHistory.length,
    totalDiffs,
    avgDivergence: round2(avgDivergence),
    avgActionConflictRate: round2(avgActionConflictRate),
    avgConfidenceSpread: round2(avgConfidenceSpread),
    mostCommonConflictSymbol,
  };
}
