/**
 * Agent Strategy DNA Profiler
 *
 * Fingerprints each AI agent's trading behavior into a multi-dimensional
 * "strategy DNA" vector. This reveals the agent's true trading style
 * beyond what it claims in its reasoning.
 *
 * Dimensions profiled:
 * - Risk appetite: How much risk does the agent actually take?
 * - Conviction: Does the agent trade big or small?
 * - Patience: How often does the agent trade vs hold?
 * - Sector bias: Does the agent favor certain stocks?
 * - Contrarianism: Does the agent go against peers?
 * - Timing: When does the agent tend to trade?
 * - Adaptability: Does the agent change behavior in different regimes?
 * - Reasoning depth: How detailed are the agent's justifications?
 *
 * Use cases:
 * - Compare claimed strategy vs actual behavior (says "value", acts "momentum")
 * - Detect style drift over time
 * - Find agents with similar/different DNA for diversity analysis
 * - Benchmark feature for characterizing agent intelligence
 */

import { countWords, getTopKey, normalize, round3 } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StrategyDNA {
  agentId: string;
  /** Risk appetite 0 (very conservative) to 1 (very aggressive) */
  riskAppetite: number;
  /** Conviction level 0 (small trades) to 1 (max size trades) */
  conviction: number;
  /** Patience 0 (trades every round) to 1 (mostly holds) */
  patience: number;
  /** Sector concentration 0 (diversified) to 1 (concentrated) */
  sectorConcentration: number;
  /** Contrarianism 0 (follows peers) to 1 (always contrarian) */
  contrarianism: number;
  /** Adaptability 0 (rigid) to 1 (highly adaptive) */
  adaptability: number;
  /** Reasoning depth 0 (shallow) to 1 (very detailed) */
  reasoningDepth: number;
  /** Confidence accuracy: correlation(confidence, outcome) */
  confidenceAccuracy: number;
  /** Dominant strategy classification */
  dominantStrategy: string;
  /** Strategy consistency 0-1 */
  consistency: number;
  /** Total data points used */
  sampleSize: number;
  /** When the profile was last updated */
  updatedAt: string;
}

export interface DNAComparison {
  agentA: string;
  agentB: string;
  /** Cosine similarity 0 (opposite) to 1 (identical) */
  similarity: number;
  /** Euclidean distance (lower = more similar) */
  distance: number;
  /** Dimensions where they differ most */
  biggestDifferences: Array<{ dimension: string; delta: number }>;
  /** Dimensions where they're most similar */
  mostSimilar: Array<{ dimension: string; delta: number }>;
}

export interface TradeDataPoint {
  agentId: string;
  action: "buy" | "sell" | "hold";
  symbol: string;
  quantity: number;
  confidence: number;
  reasoning: string;
  intent: string;
  coherenceScore: number;
  peerActions?: Array<{ agentId: string; action: string }>;
  roundId?: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const tradeHistory: Map<string, TradeDataPoint[]> = new Map();
const dnaProfiles: Map<string, StrategyDNA> = new Map();
const MAX_HISTORY = 500;

// ---------------------------------------------------------------------------
// Data Collection
// ---------------------------------------------------------------------------

/**
 * Record a trade for DNA profiling.
 */
export function recordTradeForDNA(data: TradeDataPoint): void {
  const list = tradeHistory.get(data.agentId) ?? [];
  list.push(data);
  if (list.length > MAX_HISTORY) list.shift();
  tradeHistory.set(data.agentId, list);
}

// ---------------------------------------------------------------------------
// DNA Computation
// ---------------------------------------------------------------------------

/**
 * Compute the strategy DNA for an agent from their trade history.
 */
export function computeDNA(agentId: string): StrategyDNA {
  const trades = tradeHistory.get(agentId) ?? [];

  if (trades.length < 3) {
    const defaultDna: StrategyDNA = {
      agentId,
      riskAppetite: 0.5,
      conviction: 0.5,
      patience: 0.5,
      sectorConcentration: 0.5,
      contrarianism: 0.5,
      adaptability: 0.5,
      reasoningDepth: 0.5,
      confidenceAccuracy: 0.5,
      dominantStrategy: "unknown",
      consistency: 0,
      sampleSize: trades.length,
      updatedAt: new Date().toISOString(),
    };
    dnaProfiles.set(agentId, defaultDna);
    return defaultDna;
  }

  // 1. Risk Appetite: avg confidence on non-hold trades
  const nonHold = trades.filter((t) => t.action !== "hold");
  const avgConfidence =
    nonHold.length > 0
      ? nonHold.reduce((s, t) => s + Math.min(1, t.confidence > 1 ? t.confidence / 100 : t.confidence), 0) / nonHold.length
      : 0.5;
  const riskAppetite = normalize(avgConfidence);

  // 2. Conviction: relative trade sizes (normalized by max)
  const quantities = nonHold.map((t) => t.quantity);
  const maxQty = Math.max(...quantities, 1);
  const avgRelativeSize =
    quantities.length > 0
      ? quantities.reduce((s, q) => s + q / maxQty, 0) / quantities.length
      : 0.5;
  const conviction = normalize(avgRelativeSize);

  // 3. Patience: hold rate
  const holdRate = trades.filter((t) => t.action === "hold").length / trades.length;
  const patience = normalize(holdRate);

  // 4. Sector Concentration: Herfindahl index of symbols traded
  const symbolCounts: Record<string, number> = {};
  for (const t of nonHold) {
    symbolCounts[t.symbol] = (symbolCounts[t.symbol] ?? 0) + 1;
  }
  const total = nonHold.length || 1;
  const hhi = Object.values(symbolCounts).reduce(
    (s, c) => s + Math.pow(c / total, 2),
    0,
  );
  const sectorConcentration = normalize(hhi);

  // 5. Contrarianism: how often agent goes opposite to peers
  let contrarianCount = 0;
  let peerComparisons = 0;
  for (const t of trades) {
    if (t.peerActions && t.peerActions.length > 0 && t.action !== "hold") {
      const peerBuys = t.peerActions.filter((p) => p.action === "buy").length;
      const peerSells = t.peerActions.filter((p) => p.action === "sell").length;
      const peerConsensus =
        peerBuys > peerSells ? "buy" : peerSells > peerBuys ? "sell" : null;

      if (peerConsensus && peerConsensus !== t.action) {
        contrarianCount++;
      }
      peerComparisons++;
    }
  }
  const contrarianism =
    peerComparisons > 0 ? normalize(contrarianCount / peerComparisons) : 0.5;

  // 6. Adaptability: variance in intent distribution across time halves
  const half = Math.floor(trades.length / 2);
  const firstHalf = trades.slice(0, half);
  const secondHalf = trades.slice(half);
  const intentDist = (arr: TradeDataPoint[]) => {
    const counts: Record<string, number> = {};
    for (const t of arr) counts[t.intent] = (counts[t.intent] ?? 0) + 1;
    const total = arr.length || 1;
    return Object.fromEntries(
      Object.entries(counts).map(([k, v]) => [k, v / total]),
    );
  };
  const dist1 = intentDist(firstHalf);
  const dist2 = intentDist(secondHalf);
  const allIntents = new Set([...Object.keys(dist1), ...Object.keys(dist2)]);
  let intentShift = 0;
  for (const intent of allIntents) {
    intentShift += Math.abs((dist1[intent] ?? 0) - (dist2[intent] ?? 0));
  }
  const adaptability = normalize(intentShift / 2); // normalize

  // 7. Reasoning Depth: average word count / 200 (200 words = 1.0)
  const avgWordCount =
    trades.reduce((s, t) => s + countWords(t.reasoning), 0) /
    trades.length;
  const reasoningDepth = normalize(avgWordCount / 200);

  // 8. Confidence Accuracy: correlation between confidence and coherence
  const confCoherencePairs = trades
    .filter((t) => t.coherenceScore !== undefined)
    .map((t) => ({
      conf: Math.min(1, t.confidence > 1 ? t.confidence / 100 : t.confidence),
      coh: t.coherenceScore,
    }));

  let confidenceAccuracy = 0.5;
  if (confCoherencePairs.length >= 5) {
    const avgConf =
      confCoherencePairs.reduce((s, p) => s + p.conf, 0) /
      confCoherencePairs.length;
    const avgCoh =
      confCoherencePairs.reduce((s, p) => s + p.coh, 0) /
      confCoherencePairs.length;

    let covariance = 0;
    let varConf = 0;
    let varCoh = 0;

    for (const p of confCoherencePairs) {
      covariance += (p.conf - avgConf) * (p.coh - avgCoh);
      varConf += (p.conf - avgConf) ** 2;
      varCoh += (p.coh - avgCoh) ** 2;
    }

    const denom = Math.sqrt(varConf * varCoh);
    if (denom > 0) {
      confidenceAccuracy = normalize((covariance / denom + 1) / 2); // map [-1,1] to [0,1]
    }
  }

  // 9. Dominant Strategy
  const intentCounts: Record<string, number> = {};
  for (const t of trades) {
    intentCounts[t.intent] = (intentCounts[t.intent] ?? 0) + 1;
  }
  const dominantStrategy = getTopKey(intentCounts) ?? "unknown";

  // 10. Consistency: 1 - entropy of intent distribution
  const intentProbs = Object.values(intentCounts).map(
    (c) => c / trades.length,
  );
  const entropy = intentProbs.reduce(
    (s, p) => s - (p > 0 ? p * Math.log2(p) : 0),
    0,
  );
  const maxEntropy = Math.log2(Math.max(intentProbs.length, 2));
  const consistency = normalize(1 - (maxEntropy > 0 ? entropy / maxEntropy : 0));

  const dna: StrategyDNA = {
    agentId,
    riskAppetite: round3(riskAppetite),
    conviction: round3(conviction),
    patience: round3(patience),
    sectorConcentration: round3(sectorConcentration),
    contrarianism: round3(contrarianism),
    adaptability: round3(adaptability),
    reasoningDepth: round3(reasoningDepth),
    confidenceAccuracy: round3(confidenceAccuracy),
    dominantStrategy,
    consistency: round3(consistency),
    sampleSize: trades.length,
    updatedAt: new Date().toISOString(),
  };

  dnaProfiles.set(agentId, dna);
  return dna;
}

// ---------------------------------------------------------------------------
// DNA Comparison
// ---------------------------------------------------------------------------

/**
 * Compare two agents' strategy DNA profiles.
 */
export function compareDNA(agentA: string, agentB: string): DNAComparison {
  const dnaA = dnaProfiles.get(agentA) ?? computeDNA(agentA);
  const dnaB = dnaProfiles.get(agentB) ?? computeDNA(agentB);

  const dimensions = [
    "riskAppetite",
    "conviction",
    "patience",
    "sectorConcentration",
    "contrarianism",
    "adaptability",
    "reasoningDepth",
    "confidenceAccuracy",
    "consistency",
  ] as const;

  const vecA = dimensions.map((d) => dnaA[d]);
  const vecB = dimensions.map((d) => dnaB[d]);

  // Cosine similarity
  let dotProduct = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    magA += vecA[i] ** 2;
    magB += vecB[i] ** 2;
  }
  const similarity =
    Math.sqrt(magA) * Math.sqrt(magB) > 0
      ? dotProduct / (Math.sqrt(magA) * Math.sqrt(magB))
      : 0;

  // Euclidean distance
  let sumSqDiff = 0;
  const deltas: Array<{ dimension: string; delta: number }> = [];
  for (let i = 0; i < dimensions.length; i++) {
    const delta = Math.abs(vecA[i] - vecB[i]);
    sumSqDiff += delta ** 2;
    deltas.push({ dimension: dimensions[i], delta: round3(delta) });
  }
  const distance = Math.sqrt(sumSqDiff);

  // Sort by delta
  const sorted = deltas.sort((a, b) => b.delta - a.delta);

  return {
    agentA,
    agentB,
    similarity: round3(similarity),
    distance: round3(distance),
    biggestDifferences: sorted.slice(0, 3),
    mostSimilar: sorted.slice(-3).reverse(),
  };
}

/**
 * Get all DNA profiles.
 */
export function getAllProfiles(): StrategyDNA[] {
  // Recompute all profiles
  for (const agentId of tradeHistory.keys()) {
    computeDNA(agentId);
  }
  return Array.from(dnaProfiles.values());
}

/**
 * Get a specific agent's profile.
 */
export function getProfile(agentId: string): StrategyDNA | null {
  return dnaProfiles.get(agentId) ?? null;
}

/**
 * Detect style drift by comparing recent DNA to historical DNA.
 */
export function detectStyleDrift(agentId: string): {
  hasDrift: boolean;
  driftAmount: number;
  driftingDimensions: string[];
} {
  const trades = tradeHistory.get(agentId) ?? [];
  if (trades.length < 20) {
    return { hasDrift: false, driftAmount: 0, driftingDimensions: [] };
  }

  // Compute DNA from first half vs second half
  const half = Math.floor(trades.length / 2);
  const firstHalf = trades.slice(0, half);
  const secondHalf = trades.slice(half);

  // Temporarily swap histories to compute separate DNAs
  const original = tradeHistory.get(agentId);
  tradeHistory.set(agentId, firstHalf);
  const dnaFirst = computeDNA(agentId);
  tradeHistory.set(agentId, secondHalf);
  const dnaSecond = computeDNA(agentId);

  // Restore
  if (original) tradeHistory.set(agentId, original);

  // Compare
  const dimensions = [
    "riskAppetite",
    "conviction",
    "patience",
    "contrarianism",
    "adaptability",
    "reasoningDepth",
  ] as const;

  let totalDrift = 0;
  const driftingDimensions: string[] = [];

  for (const dim of dimensions) {
    const delta = Math.abs(dnaFirst[dim] - dnaSecond[dim]);
    totalDrift += delta;
    if (delta > 0.15) {
      driftingDimensions.push(dim);
    }
  }

  const avgDrift = totalDrift / dimensions.length;

  // Recompute actual DNA
  computeDNA(agentId);

  return {
    hasDrift: avgDrift > 0.1,
    driftAmount: round3(avgDrift),
    driftingDimensions,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

