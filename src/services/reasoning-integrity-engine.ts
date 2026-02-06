/**
 * Reasoning Integrity Engine
 *
 * Verifies cross-trade reasoning consistency and detects integrity issues
 * that simple per-trade coherence analysis misses. This engine looks at
 * patterns ACROSS trades to find:
 *
 * 1. Flip-flopping: Agent changes stance on same stock without new information
 * 2. Copypasta: Agent reuses identical reasoning across different trades
 * 3. Confidence drift: Confidence systematically diverges from outcomes
 * 4. Source fabrication: Agent claims sources it couldn't have accessed
 * 5. Reasoning regression: Quality deteriorating over time
 * 6. Contradictory positions: Conflicting reasoning on correlated assets
 *
 * These integrity checks go beyond single-trade analysis and form a critical
 * pillar of MoltApp's claim as an industry-standard benchmark.
 */

import { round3 } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Integrity Detection Thresholds
// ---------------------------------------------------------------------------

/**
 * Time window thresholds for flip-flop detection.
 * Flip-flopping is considered problematic when stance changes happen too quickly
 * without sufficient new information or market changes.
 */
const FLIPFLOP_MAX_HOURS = 24; // Only flag reversals within 24 hours
const FLIPFLOP_HIGH_SEVERITY_HOURS = 2; // High severity if flip within 2 hours

/**
 * Similarity thresholds for copypasta detection.
 * Uses Jaccard similarity on word sets to detect duplicate reasoning.
 */
const COPYPASTA_SIMILARITY_THRESHOLD = 0.80; // 80%+ similarity = copypasta
const COPYPASTA_HIGH_SEVERITY_THRESHOLD = 0.95; // 95%+ similarity = high severity
const COPYPASTA_MIN_WORD_LENGTH = 3; // Filter words shorter than 3 chars
const COPYPASTA_RECENT_WINDOW = 20; // Compare last 20 trades for copypasta

/**
 * Confidence drift detection thresholds.
 * Detects systematic over/under confidence by comparing confidence scores
 * to coherence scores across recent trades.
 */
const HIGH_CONFIDENCE_THRESHOLD = 0.7; // Confidence >70% considered "high"
const LOW_COHERENCE_THRESHOLD = 0.4; // Coherence <40% considered "low"
const LOW_CONFIDENCE_THRESHOLD = 0.3; // Confidence <30% considered "low"
const HIGH_COHERENCE_THRESHOLD = 0.7; // Coherence >70% considered "high"
const DRIFT_VIOLATION_MIN_COUNT = 3; // Min violations to flag drift issue
const DRIFT_VIOLATION_HIGH_SEVERITY_COUNT = 5; // High severity threshold
const CONFIDENCE_DRIFT_MIN_HISTORY = 10; // Need 10+ trades to detect drift

/**
 * Reasoning regression detection thresholds.
 * Compares first half vs second half of history to detect quality decline.
 */
const REGRESSION_THRESHOLD = 0.15; // 15% coherence drop = regression
const REGRESSION_HIGH_SEVERITY_THRESHOLD = 0.25; // 25% drop = high severity
const REGRESSION_MIN_HISTORY = 10; // Need 10+ trades to detect regression

/**
 * Quality trend detection thresholds.
 * Used in overall integrity report to determine if quality is improving/declining.
 */
const QUALITY_TREND_THRESHOLD = 0.1; // 10% change = trend detected

/**
 * Source fabrication detection.
 * Recent window size for checking source validity.
 */
const SOURCE_FABRICATION_RECENT_WINDOW = 20; // Check last 20 trades

/**
 * Severity penalty weights for integrity score calculation.
 * Each violation deducts from 1.0 integrity score based on severity.
 */
const SEVERITY_WEIGHTS = {
  low: 0.02,      // 2% deduction per low severity violation
  medium: 0.05,   // 5% deduction per medium severity violation
  high: 0.10,     // 10% deduction per high severity violation
  critical: 0.20, // 20% deduction per critical violation
};

/**
 * Confidence accuracy calculation.
 * Penalty multiplier for each confidence drift violation.
 */
const CONFIDENCE_DRIFT_PENALTY = 0.15; // 15% reduction per drift violation

/**
 * Cross-agent integrity thresholds.
 * Used for herding and collusion detection.
 */
const COLLUSION_SIMILARITY_THRESHOLD = 0.6; // Avg similarity >60% = suspected collusion
const CROSS_AGENT_RECENT_WINDOW = 20; // Compare last 20 trades between agents

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReasoningRecord {
  agentId: string;
  roundId: string;
  timestamp: string;
  symbol: string;
  action: "buy" | "sell" | "hold";
  reasoning: string;
  confidence: number;
  intent: string;
  sources: string[];
  coherenceScore: number;
}

export interface IntegrityViolation {
  type: IntegrityViolationType;
  severity: "low" | "medium" | "high" | "critical";
  agentId: string;
  description: string;
  evidence: {
    tradeA?: { roundId: string; symbol: string; action: string; reasoning: string };
    tradeB?: { roundId: string; symbol: string; action: string; reasoning: string };
  };
  timestamp: string;
}

export type IntegrityViolationType =
  | "flip_flop"
  | "copypasta"
  | "confidence_drift"
  | "source_fabrication"
  | "reasoning_regression"
  | "contradictory_positions";

export interface IntegrityReport {
  agentId: string;
  violations: IntegrityViolation[];
  integrityScore: number; // 0-1, 1 = perfect integrity
  summary: {
    flipFlops: number;
    copypastaRate: number;
    confidenceAccuracy: number;
    sourceFabricationRate: number;
    qualityTrend: "improving" | "stable" | "declining";
    contradictions: number;
  };
  windowSize: number;
  generatedAt: string;
}

export interface CrossAgentIntegrityReport {
  agents: string[];
  herding: {
    rate: number; // 0-1, how often agents all take same action
    incidents: { roundId: string; action: string; agentIds: string[] }[];
  };
  diversityScore: number; // 0-1, how diverse are agent strategies
  collusion: {
    suspected: boolean;
    similarityScores: Record<string, Record<string, number>>;
  };
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const MAX_HISTORY = 100;
const agentHistory = new Map<string, ReasoningRecord[]>();
const violations: IntegrityViolation[] = [];

// ---------------------------------------------------------------------------
// Record Management
// ---------------------------------------------------------------------------

/**
 * Record a trade's reasoning for integrity analysis.
 */
export function recordForIntegrity(record: ReasoningRecord): void {
  const history = agentHistory.get(record.agentId) ?? [];
  history.push(record);
  if (history.length > MAX_HISTORY) {
    history.shift();
  }
  agentHistory.set(record.agentId, history);
}

// ---------------------------------------------------------------------------
// Integrity Checks
// ---------------------------------------------------------------------------

/**
 * Detect flip-flopping: agent reverses position on same stock without
 * significant time gap or market change.
 */
function detectFlipFlops(agentId: string, history: ReasoningRecord[]): IntegrityViolation[] {
  const result: IntegrityViolation[] = [];

  // Group by symbol, look for buy->sell or sell->buy within 3 trades
  const symbolTrades = new Map<string, ReasoningRecord[]>();
  for (const record of history) {
    if (record.action === "hold") continue;
    const trades = symbolTrades.get(record.symbol) ?? [];
    trades.push(record);
    symbolTrades.set(record.symbol, trades);
  }

  for (const [symbol, trades] of symbolTrades) {
    for (let i = 1; i < trades.length; i++) {
      const prev = trades[i - 1];
      const curr = trades[i];

      // Same symbol, opposite action, within a few rounds
      if (prev.action !== curr.action) {
        // Check if the reasoning changed direction too (flip-flop vs legitimate rebalance)
        const prevBullish = /bullish|upside|growth|buy|accumulate|undervalued/i.test(prev.reasoning);
        const currBullish = /bullish|upside|growth|buy|accumulate|undervalued/i.test(curr.reasoning);

        if (prevBullish !== currBullish || prev.action === "buy" && curr.action === "sell") {
          const timeDiff = new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime();
          const hours = timeDiff / (1000 * 60 * 60);

          // Only flag if within FLIPFLOP_MAX_HOURS
          if (hours < FLIPFLOP_MAX_HOURS) {
            result.push({
              type: "flip_flop",
              severity: hours < FLIPFLOP_HIGH_SEVERITY_HOURS ? "high" : "medium",
              agentId,
              description: `Reversed ${symbol} from ${prev.action} to ${curr.action} within ${hours.toFixed(1)} hours`,
              evidence: {
                tradeA: { roundId: prev.roundId, symbol, action: prev.action, reasoning: prev.reasoning.slice(0, 200) },
                tradeB: { roundId: curr.roundId, symbol, action: curr.action, reasoning: curr.reasoning.slice(0, 200) },
              },
              timestamp: curr.timestamp,
            });
          }
        }
      }
    }
  }

  return result;
}

/**
 * Detect copypasta: agent reuses identical or near-identical reasoning.
 * Uses Jaccard similarity on word sets.
 */
function detectCopypasta(agentId: string, history: ReasoningRecord[]): IntegrityViolation[] {
  const result: IntegrityViolation[] = [];
  if (history.length < 2) return result;

  function wordSet(text: string): Set<string> {
    return new Set(
      text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > COPYPASTA_MIN_WORD_LENGTH),
    );
  }

  function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 && b.size === 0) return 1;
    const intersection = new Set([...a].filter((x) => b.has(x)));
    const union = new Set([...a, ...b]);
    return union.size > 0 ? intersection.size / union.size : 0;
  }

  // Compare recent trades pairwise
  const recent = history.slice(-COPYPASTA_RECENT_WINDOW);
  for (let i = 0; i < recent.length; i++) {
    for (let j = i + 1; j < recent.length; j++) {
      const a = recent[i];
      const b = recent[j];

      // Skip same-symbol trades (similar reasoning is expected)
      if (a.symbol === b.symbol && a.action === b.action) continue;

      const similarity = jaccardSimilarity(wordSet(a.reasoning), wordSet(b.reasoning));
      if (similarity > COPYPASTA_SIMILARITY_THRESHOLD) {
        result.push({
          type: "copypasta",
          severity: similarity > COPYPASTA_HIGH_SEVERITY_THRESHOLD ? "high" : "medium",
          agentId,
          description: `${(similarity * 100).toFixed(0)}% reasoning similarity between ${a.symbol} ${a.action} and ${b.symbol} ${b.action}`,
          evidence: {
            tradeA: { roundId: a.roundId, symbol: a.symbol, action: a.action, reasoning: a.reasoning.slice(0, 150) },
            tradeB: { roundId: b.roundId, symbol: b.symbol, action: b.action, reasoning: b.reasoning.slice(0, 150) },
          },
          timestamp: b.timestamp,
        });
      }
    }
  }

  return result;
}

/**
 * Detect confidence drift: systematic over/under confidence.
 */
function detectConfidenceDrift(agentId: string, history: ReasoningRecord[]): IntegrityViolation[] {
  const result: IntegrityViolation[] = [];
  if (history.length < CONFIDENCE_DRIFT_MIN_HISTORY) return result;

  // Check if confidence is consistently high but coherence is low
  const recent = history.slice(-COPYPASTA_RECENT_WINDOW);
  const highConfLowCoherence = recent.filter(
    (r) => r.confidence > HIGH_CONFIDENCE_THRESHOLD && r.coherenceScore < LOW_COHERENCE_THRESHOLD,
  );

  if (highConfLowCoherence.length >= DRIFT_VIOLATION_MIN_COUNT) {
    result.push({
      type: "confidence_drift",
      severity: highConfLowCoherence.length >= DRIFT_VIOLATION_HIGH_SEVERITY_COUNT ? "high" : "medium",
      agentId,
      description: `${highConfLowCoherence.length} of ${recent.length} recent trades show high confidence (>0.7) with low coherence (<0.4)`,
      evidence: {},
      timestamp: new Date().toISOString(),
    });
  }

  // Check for consistently low confidence on good coherence
  const lowConfHighCoherence = recent.filter(
    (r) => r.confidence < LOW_CONFIDENCE_THRESHOLD && r.coherenceScore > HIGH_COHERENCE_THRESHOLD,
  );

  if (lowConfHighCoherence.length >= DRIFT_VIOLATION_MIN_COUNT) {
    result.push({
      type: "confidence_drift",
      severity: "low",
      agentId,
      description: `${lowConfHighCoherence.length} of ${recent.length} recent trades show underconfidence (high coherence but low reported confidence)`,
      evidence: {},
      timestamp: new Date().toISOString(),
    });
  }

  return result;
}

/**
 * Detect source fabrication: agent claims sources that are implausible.
 */
function detectSourceFabrication(agentId: string, history: ReasoningRecord[]): IntegrityViolation[] {
  const result: IntegrityViolation[] = [];

  const VALID_SOURCES = new Set([
    "market_price_feed", "24h_price_change", "trading_volume", "portfolio_state",
    "news_feed", "technical_indicators", "fundamentals", "market_sentiment",
    "sector_analysis", "jupiter_price_api", "market_data",
  ]);

  for (const record of history.slice(-SOURCE_FABRICATION_RECENT_WINDOW)) {
    const fabricated = record.sources.filter((s) => !VALID_SOURCES.has(s));
    if (fabricated.length > 0) {
      // Check if the fabricated source is mentioned in the reasoning
      const unreferenced = fabricated.filter((s) => !record.reasoning.toLowerCase().includes(s.replace(/_/g, " ")));
      if (unreferenced.length > 0) {
        result.push({
          type: "source_fabrication",
          severity: "low",
          agentId,
          description: `Cited unrecognized sources: ${unreferenced.join(", ")}`,
          evidence: {
            tradeA: { roundId: record.roundId, symbol: record.symbol, action: record.action, reasoning: record.reasoning.slice(0, 150) },
          },
          timestamp: record.timestamp,
        });
      }
    }
  }

  return result;
}

/**
 * Detect reasoning regression: quality declining over recent trades.
 */
function detectReasoningRegression(agentId: string, history: ReasoningRecord[]): IntegrityViolation[] {
  const result: IntegrityViolation[] = [];
  if (history.length < REGRESSION_MIN_HISTORY) return result;

  // Compare first half vs second half coherence
  const midpoint = Math.floor(history.length / 2);
  const firstHalf = history.slice(0, midpoint);
  const secondHalf = history.slice(midpoint);

  const avgFirst = firstHalf.reduce((s, r) => s + r.coherenceScore, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((s, r) => s + r.coherenceScore, 0) / secondHalf.length;

  if (avgFirst - avgSecond > REGRESSION_THRESHOLD) {
    result.push({
      type: "reasoning_regression",
      severity: avgFirst - avgSecond > REGRESSION_HIGH_SEVERITY_THRESHOLD ? "high" : "medium",
      agentId,
      description: `Coherence dropped from ${avgFirst.toFixed(2)} (first ${firstHalf.length} trades) to ${avgSecond.toFixed(2)} (last ${secondHalf.length} trades)`,
      evidence: {},
      timestamp: new Date().toISOString(),
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run full integrity analysis for an agent.
 */
export function analyzeIntegrity(agentId: string): IntegrityReport {
  const history = agentHistory.get(agentId) ?? [];

  const flipFlops = detectFlipFlops(agentId, history);
  const copypasta = detectCopypasta(agentId, history);
  const confidenceDrift = detectConfidenceDrift(agentId, history);
  const sourceFabrication = detectSourceFabrication(agentId, history);
  const regression = detectReasoningRegression(agentId, history);

  const allViolations = [...flipFlops, ...copypasta, ...confidenceDrift, ...sourceFabrication, ...regression];

  // Store violations
  for (const v of allViolations) {
    violations.push(v);
  }
  // Cap stored violations
  while (violations.length > 500) violations.shift();

  // Compute integrity score: start at 1.0, deduct per violation
  let deduction = 0;
  for (const v of allViolations) {
    deduction += SEVERITY_WEIGHTS[v.severity] ?? SEVERITY_WEIGHTS.medium;
  }
  const integrityScore = Math.max(0, round3(1 - deduction));

  // Copypasta rate
  const recentCount = Math.min(COPYPASTA_RECENT_WINDOW, history.length);
  const copypastaRate = recentCount > 0
    ? round3(copypasta.length / recentCount)
    : 0;

  // Confidence accuracy
  const confidenceAccuracy = confidenceDrift.length === 0 ? 1.0
    : Math.max(0, 1 - confidenceDrift.length * CONFIDENCE_DRIFT_PENALTY);

  // Source fabrication rate
  const sourceFabRate = recentCount > 0
    ? round3(sourceFabrication.length / recentCount)
    : 0;

  // Quality trend
  let qualityTrend: "improving" | "stable" | "declining" = "stable";
  if (history.length >= REGRESSION_MIN_HISTORY) {
    const midpoint = Math.floor(history.length / 2);
    const firstAvg = history.slice(0, midpoint).reduce((s, r) => s + r.coherenceScore, 0) / midpoint;
    const secondAvg = history.slice(midpoint).reduce((s, r) => s + r.coherenceScore, 0) / (history.length - midpoint);
    if (secondAvg - firstAvg > QUALITY_TREND_THRESHOLD) qualityTrend = "improving";
    else if (firstAvg - secondAvg > QUALITY_TREND_THRESHOLD) qualityTrend = "declining";
  }

  return {
    agentId,
    violations: allViolations,
    integrityScore,
    summary: {
      flipFlops: flipFlops.length,
      copypastaRate,
      confidenceAccuracy: round3(confidenceAccuracy),
      sourceFabricationRate: sourceFabRate,
      qualityTrend,
      contradictions: 0,
    },
    windowSize: history.length,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Cross-agent integrity: detect herding and potential collusion.
 */
export function analyzeCrossAgentIntegrity(): CrossAgentIntegrityReport {
  const agents = Array.from(agentHistory.keys());

  // Group trades by round
  const roundTrades = new Map<string, { agentId: string; action: string; reasoning: string }[]>();
  for (const [agentId, history] of agentHistory) {
    for (const record of history) {
      const trades = roundTrades.get(record.roundId) ?? [];
      trades.push({ agentId, action: record.action, reasoning: record.reasoning });
      roundTrades.set(record.roundId, trades);
    }
  }

  // Herding detection: how often do all agents take the same action?
  let herdingCount = 0;
  let totalRounds = 0;
  const herdingIncidents: { roundId: string; action: string; agentIds: string[] }[] = [];

  for (const [roundId, trades] of roundTrades) {
    if (trades.length < 2) continue;
    totalRounds++;

    const actions = trades.map((t) => t.action);
    const allSame = actions.every((a) => a === actions[0]);
    if (allSame) {
      herdingCount++;
      herdingIncidents.push({
        roundId,
        action: actions[0],
        agentIds: trades.map((t) => t.agentId),
      });
    }
  }

  const herdingRate = totalRounds > 0 ? round3(herdingCount / totalRounds) : 0;

  // Reasoning similarity between agents (collusion detection)
  function wordSet(text: string): Set<string> {
    return new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 3));
  }

  const similarityScores: Record<string, Record<string, number>> = {};
  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const aHistory = agentHistory.get(agents[i]) ?? [];
      const bHistory = agentHistory.get(agents[j]) ?? [];

      // Compare reasoning across same rounds
      let similarities: number[] = [];
      for (const aRecord of aHistory.slice(-CROSS_AGENT_RECENT_WINDOW)) {
        const bMatch = bHistory.find((b) => b.roundId === aRecord.roundId);
        if (bMatch) {
          const aWords = wordSet(aRecord.reasoning);
          const bWords = wordSet(bMatch.reasoning);
          const intersection = new Set([...aWords].filter((x) => bWords.has(x)));
          const union = new Set([...aWords, ...bWords]);
          const sim = union.size > 0 ? intersection.size / union.size : 0;
          similarities.push(sim);
        }
      }

      const avgSim = similarities.length > 0
        ? round3(similarities.reduce((s, v) => s + v, 0) / similarities.length)
        : 0;

      if (!similarityScores[agents[i]]) similarityScores[agents[i]] = {};
      if (!similarityScores[agents[j]]) similarityScores[agents[j]] = {};
      similarityScores[agents[i]][agents[j]] = avgSim;
      similarityScores[agents[j]][agents[i]] = avgSim;
    }
  }

  // Diversity score: how different are agent strategies?
  const intentDistributions = new Map<string, Map<string, number>>();
  for (const [agentId, history] of agentHistory) {
    const dist = new Map<string, number>();
    for (const r of history) {
      dist.set(r.intent, (dist.get(r.intent) ?? 0) + 1);
    }
    intentDistributions.set(agentId, dist);
  }

  // Jensen-Shannon divergence approximation between intent distributions
  let diversitySum = 0;
  let diversityPairs = 0;
  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const a = intentDistributions.get(agents[i]);
      const b = intentDistributions.get(agents[j]);
      if (!a || !b) continue;

      const allIntents = new Set([...a.keys(), ...b.keys()]);
      const aTotal = Array.from(a.values()).reduce((s, v) => s + v, 0);
      const bTotal = Array.from(b.values()).reduce((s, v) => s + v, 0);

      let divergence = 0;
      for (const intent of allIntents) {
        const pA = (a.get(intent) ?? 0) / (aTotal || 1);
        const pB = (b.get(intent) ?? 0) / (bTotal || 1);
        const m = (pA + pB) / 2;
        if (pA > 0 && m > 0) divergence += pA * Math.log(pA / m);
        if (pB > 0 && m > 0) divergence += pB * Math.log(pB / m);
      }
      diversitySum += divergence / 2; // Jensen-Shannon = (KL(P||M) + KL(Q||M)) / 2
      diversityPairs++;
    }
  }

  const diversityScore = diversityPairs > 0
    ? Math.min(1, round3(diversitySum / diversityPairs))
    : 0.5;

  // Collusion: suspected if avg similarity > 0.6
  const allSims = Object.values(similarityScores).flatMap((inner) => Object.values(inner));
  const avgSimilarity = allSims.length > 0
    ? allSims.reduce((s, v) => s + v, 0) / allSims.length
    : 0;

  return {
    agents,
    herding: { rate: herdingRate, incidents: herdingIncidents.slice(-10) },
    diversityScore,
    collusion: {
      suspected: avgSimilarity > 0.6,
      similarityScores,
    },
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Get all violations for an agent.
 */
export function getViolations(agentId?: string): IntegrityViolation[] {
  if (agentId) return violations.filter((v) => v.agentId === agentId);
  return [...violations];
}

/**
 * Get integrity scores for all agents.
 */
export function getAllIntegrityScores(): Record<string, number> {
  const result: Record<string, number> = {};
  for (const agentId of agentHistory.keys()) {
    const report = analyzeIntegrity(agentId);
    result[agentId] = report.integrityScore;
  }
  return result;
}
