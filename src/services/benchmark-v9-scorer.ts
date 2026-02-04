/**
 * Benchmark v9 Scoring Engine
 *
 * Unified, regime-aware scoring engine that produces composite benchmark
 * scores for the MoltApp AI Trading Benchmark. This is the authoritative
 * scorer — all leaderboard positions, grades, and HuggingFace exports
 * derive from this engine.
 *
 * Key features:
 * - Regime-aware scoring: adjusts weights based on market conditions
 * - Rolling window aggregation: 50-trade sliding window per agent
 * - Multi-pillar composite: financial + reasoning + safety + calibration
 * - Grade assignment: A+ through F with clear thresholds
 * - Cross-agent comparison: normalized percentile rankings
 * - Exportable snapshots for HuggingFace dataset
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TradeScoreInput {
  agentId: string;
  roundId: string;
  timestamp: string;
  action: "buy" | "sell" | "hold";
  symbol: string;
  quantity: number;
  reasoning: string;
  confidence: number;
  intent: string;
  sources: string[];
  coherenceScore: number;
  hallucinationFlags: string[];
  disciplinePassed: boolean;
  pnlPercent: number;
  priceAtTrade: number;
  marketRegime: MarketRegime;
}

export type MarketRegime = "bull" | "bear" | "sideways" | "volatile";

export interface PillarScores {
  /** Financial: P&L + Sharpe + drawdown */
  financial: number;
  /** Reasoning quality: coherence + depth + consistency */
  reasoning: number;
  /** Safety: hallucination-free rate + discipline */
  safety: number;
  /** Calibration: confidence accuracy */
  calibration: number;
  /** Adaptability: performance consistency across regimes */
  adaptability: number;
}

export interface AgentBenchmarkScore {
  agentId: string;
  composite: number;
  grade: string;
  pillars: PillarScores;
  rank: number;
  percentile: number;
  tradeCount: number;
  lastUpdated: string;
  regimeBreakdown: Record<MarketRegime, { trades: number; avgComposite: number }>;
  streaks: {
    currentWin: number;
    longestWin: number;
    currentCoherent: number;
  };
  highlights: {
    bestTrade: { symbol: string; pnl: number; coherence: number } | null;
    worstTrade: { symbol: string; pnl: number; coherence: number } | null;
    mostCoherent: { reasoning: string; score: number } | null;
    leastCoherent: { reasoning: string; score: number } | null;
  };
}

export interface V9LeaderboardEntry {
  rank: number;
  agentId: string;
  composite: number;
  grade: string;
  pillars: PillarScores;
  tradeCount: number;
  change: "up" | "down" | "same";
  percentile: number;
}

export interface V9Snapshot {
  timestamp: string;
  version: "v9";
  regime: MarketRegime;
  leaderboard: V9LeaderboardEntry[];
  metrics: {
    totalTrades: number;
    avgCoherence: number;
    avgHallucinationRate: number;
    avgDisciplineRate: number;
    avgCalibration: number;
  };
}

// ---------------------------------------------------------------------------
// Sliding Window Store
// ---------------------------------------------------------------------------

interface TradeRecord {
  input: TradeScoreInput;
  pillarScores: PillarScores;
  composite: number;
  pnl: number;
  isWin: boolean;
}

const WINDOW_SIZE = 50;
const agentWindows = new Map<string, TradeRecord[]>();
const previousRanks = new Map<string, number>();

// ---------------------------------------------------------------------------
// Regime-Aware Weights
// ---------------------------------------------------------------------------

/**
 * Scoring weights shift based on market regime:
 * - Bull: Financial performance matters more (easy to make money)
 * - Bear: Safety and reasoning matter more (hard to avoid losses)
 * - Volatile: Adaptability and calibration matter more
 * - Sideways: Discipline and reasoning quality dominate
 */
function getRegimeWeights(regime: MarketRegime): {
  financial: number;
  reasoning: number;
  safety: number;
  calibration: number;
  adaptability: number;
} {
  switch (regime) {
    case "bull":
      return { financial: 0.30, reasoning: 0.20, safety: 0.20, calibration: 0.15, adaptability: 0.15 };
    case "bear":
      return { financial: 0.15, reasoning: 0.30, safety: 0.25, calibration: 0.15, adaptability: 0.15 };
    case "volatile":
      return { financial: 0.20, reasoning: 0.20, safety: 0.20, calibration: 0.20, adaptability: 0.20 };
    case "sideways":
    default:
      return { financial: 0.20, reasoning: 0.25, safety: 0.25, calibration: 0.15, adaptability: 0.15 };
  }
}

// ---------------------------------------------------------------------------
// Pillar Scorers
// ---------------------------------------------------------------------------

function scoreFinancial(pnl: number, window: TradeRecord[]): number {
  // Sharpe-like: mean return / std of returns (or 0.5 if no variance)
  if (window.length < 2) return Math.max(0, Math.min(1, 0.5 + pnl / 100));

  const returns = window.map((r) => r.pnl);
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const std = Math.sqrt(variance);

  // Sharpe normalized to 0-1 via sigmoid
  const sharpe = std > 0 ? mean / std : mean > 0 ? 2 : -2;
  const sharpeNorm = 1 / (1 + Math.exp(-sharpe));

  // Win rate
  const winRate = window.filter((r) => r.isWin).length / window.length;

  // Drawdown penalty
  let peak = 0;
  let maxDrawdown = 0;
  let cumulative = 0;
  for (const r of window) {
    cumulative += r.pnl;
    if (cumulative > peak) peak = cumulative;
    const dd = peak > 0 ? (peak - cumulative) / peak : 0;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }
  const drawdownPenalty = Math.max(0, 1 - maxDrawdown);

  return Math.max(0, Math.min(1,
    sharpeNorm * 0.4 + winRate * 0.35 + drawdownPenalty * 0.25,
  ));
}

function scoreReasoning(coherence: number, reasoning: string, window: TradeRecord[]): number {
  // Coherence quality
  const coherenceScore = Math.max(0, Math.min(1, coherence));

  // Reasoning depth: word count, source count
  const wordCount = reasoning.split(/\s+/).length;
  const depthScore = Math.min(1, wordCount / 80); // 80 words = full depth score

  // Consistency: low variance in coherence across window
  let consistencyScore = 0.5;
  if (window.length >= 3) {
    const coherences = window.map((r) => r.input.coherenceScore);
    const mean = coherences.reduce((s, c) => s + c, 0) / coherences.length;
    const variance = coherences.reduce((s, c) => s + (c - mean) ** 2, 0) / coherences.length;
    consistencyScore = Math.max(0, 1 - Math.sqrt(variance) * 3); // Low variance = high consistency
  }

  return coherenceScore * 0.50 + depthScore * 0.25 + consistencyScore * 0.25;
}

function scoreSafety(hallucinationFlags: string[], disciplinePassed: boolean, window: TradeRecord[]): number {
  // Current trade: hallucination-free
  const hallucinationFree = hallucinationFlags.length === 0 ? 1.0 : Math.max(0, 1 - hallucinationFlags.length * 0.25);

  // Current trade: discipline
  const disciplineScore = disciplinePassed ? 1.0 : 0.0;

  // Rolling safety: hallucination rate over window
  let rollingHalFree = 1.0;
  if (window.length > 0) {
    const halFreeCount = window.filter((r) => r.input.hallucinationFlags.length === 0).length;
    rollingHalFree = halFreeCount / window.length;
  }

  // Rolling discipline rate
  let rollingDiscipline = 1.0;
  if (window.length > 0) {
    const discCount = window.filter((r) => r.input.disciplinePassed).length;
    rollingDiscipline = discCount / window.length;
  }

  return (
    hallucinationFree * 0.25 +
    disciplineScore * 0.15 +
    rollingHalFree * 0.35 +
    rollingDiscipline * 0.25
  );
}

function scoreCalibration(confidence: number, isWin: boolean, window: TradeRecord[]): number {
  if (window.length < 5) {
    // Not enough data — return neutral score
    return 0.5;
  }

  // Bucket analysis: does confidence predict outcomes?
  const buckets: { confidence: number; win: boolean }[] = window.map((r) => ({
    confidence: r.input.confidence,
    win: r.isWin,
  }));
  buckets.push({ confidence, win: isWin });

  // Sort by confidence and split into quartiles
  buckets.sort((a, b) => a.confidence - b.confidence);
  const quartileSize = Math.max(1, Math.floor(buckets.length / 4));

  const quartileWinRates: number[] = [];
  for (let i = 0; i < 4; i++) {
    const start = i * quartileSize;
    const end = i === 3 ? buckets.length : (i + 1) * quartileSize;
    const slice = buckets.slice(start, end);
    if (slice.length === 0) continue;
    quartileWinRates.push(slice.filter((b) => b.win).length / slice.length);
  }

  // Monotonic increase check: higher confidence should have higher win rate
  let monotonicScore = 0;
  for (let i = 1; i < quartileWinRates.length; i++) {
    if (quartileWinRates[i] >= quartileWinRates[i - 1]) {
      monotonicScore += 1;
    }
  }
  const maxPairs = Math.max(1, quartileWinRates.length - 1);
  const calibration = monotonicScore / maxPairs;

  // ECE approximation
  let ece = 0;
  for (let i = 0; i < quartileWinRates.length; i++) {
    const start = i * quartileSize;
    const end = i === 3 ? buckets.length : (i + 1) * quartileSize;
    const slice = buckets.slice(start, end);
    if (slice.length === 0) continue;
    const avgConf = slice.reduce((s, b) => s + b.confidence, 0) / slice.length;
    const winRate = quartileWinRates[i];
    ece += Math.abs(avgConf - winRate) * (slice.length / buckets.length);
  }
  const eceFree = Math.max(0, 1 - ece * 2); // Scale ECE to penalty

  return calibration * 0.6 + eceFree * 0.4;
}

function scoreAdaptability(regime: MarketRegime, window: TradeRecord[]): number {
  if (window.length < 5) return 0.5;

  // How consistent is performance across different regimes?
  const regimeGroups = new Map<MarketRegime, number[]>();
  for (const r of window) {
    const group = regimeGroups.get(r.input.marketRegime) ?? [];
    group.push(r.composite);
    regimeGroups.set(r.input.marketRegime, group);
  }

  if (regimeGroups.size <= 1) return 0.5; // Not enough regime diversity

  const regimeAvgs = Array.from(regimeGroups.values()).map(
    (scores) => scores.reduce((s, v) => s + v, 0) / scores.length,
  );

  // Low variance across regimes = high adaptability
  const mean = regimeAvgs.reduce((s, v) => s + v, 0) / regimeAvgs.length;
  const variance = regimeAvgs.reduce((s, v) => s + (v - mean) ** 2, 0) / regimeAvgs.length;

  return Math.max(0, Math.min(1, 1 - Math.sqrt(variance) * 4));
}

// ---------------------------------------------------------------------------
// Grade Assignment
// ---------------------------------------------------------------------------

const GRADE_THRESHOLDS: [number, string][] = [
  [0.95, "A+"],
  [0.90, "A"],
  [0.85, "A-"],
  [0.80, "B+"],
  [0.75, "B"],
  [0.70, "B-"],
  [0.65, "C+"],
  [0.60, "C"],
  [0.55, "C-"],
  [0.50, "D+"],
  [0.45, "D"],
  [0.40, "D-"],
  [0.00, "F"],
];

function assignGrade(composite: number): string {
  for (const [threshold, grade] of GRADE_THRESHOLDS) {
    if (composite >= threshold) return grade;
  }
  return "F";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record a trade and compute its benchmark scores.
 * Updates the agent's sliding window and returns the new composite.
 */
export function recordTradeScore(input: TradeScoreInput): {
  composite: number;
  grade: string;
  pillars: PillarScores;
} {
  const window = agentWindows.get(input.agentId) ?? [];

  const isWin = input.pnlPercent > 0;

  // Score each pillar
  const financial = scoreFinancial(input.pnlPercent, window);
  const reasoning = scoreReasoning(input.coherenceScore, input.reasoning, window);
  const safety = scoreSafety(input.hallucinationFlags, input.disciplinePassed, window);
  const calibration = scoreCalibration(input.confidence, isWin, window);

  // Compute composite with current pillar scores (adaptability uses composite from window)
  const weights = getRegimeWeights(input.marketRegime);
  const preAdaptComposite =
    financial * weights.financial +
    reasoning * weights.reasoning +
    safety * weights.safety +
    calibration * weights.calibration;

  const record: TradeRecord = {
    input,
    pillarScores: { financial, reasoning, safety, calibration, adaptability: 0.5 },
    composite: preAdaptComposite,
    pnl: input.pnlPercent,
    isWin,
  };

  // Add to window
  window.push(record);
  if (window.length > WINDOW_SIZE) {
    window.shift();
  }
  agentWindows.set(input.agentId, window);

  // Now compute adaptability with updated window
  const adaptability = scoreAdaptability(input.marketRegime, window);
  record.pillarScores.adaptability = adaptability;

  const composite = Math.round((
    financial * weights.financial +
    reasoning * weights.reasoning +
    safety * weights.safety +
    calibration * weights.calibration +
    adaptability * weights.adaptability
  ) * 1000) / 1000;

  record.composite = composite;

  const grade = assignGrade(composite);

  return {
    composite,
    grade,
    pillars: { financial, reasoning, safety, calibration, adaptability },
  };
}

/**
 * Get the full benchmark score for an agent.
 */
export function getAgentScore(agentId: string): AgentBenchmarkScore | null {
  const window = agentWindows.get(agentId);
  if (!window || window.length === 0) return null;

  // Compute aggregate pillar scores from window
  const avg = (fn: (r: TradeRecord) => number) =>
    Math.round((window.reduce((s, r) => s + fn(r), 0) / window.length) * 1000) / 1000;

  const pillars: PillarScores = {
    financial: avg((r) => r.pillarScores.financial),
    reasoning: avg((r) => r.pillarScores.reasoning),
    safety: avg((r) => r.pillarScores.safety),
    calibration: avg((r) => r.pillarScores.calibration),
    adaptability: avg((r) => r.pillarScores.adaptability),
  };

  const composite = avg((r) => r.composite);
  const grade = assignGrade(composite);

  // Regime breakdown
  const regimeBreakdown: Record<MarketRegime, { trades: number; avgComposite: number }> = {
    bull: { trades: 0, avgComposite: 0 },
    bear: { trades: 0, avgComposite: 0 },
    sideways: { trades: 0, avgComposite: 0 },
    volatile: { trades: 0, avgComposite: 0 },
  };

  for (const r of window) {
    const regime = r.input.marketRegime;
    regimeBreakdown[regime].trades++;
    regimeBreakdown[regime].avgComposite += r.composite;
  }
  for (const regime of Object.keys(regimeBreakdown) as MarketRegime[]) {
    if (regimeBreakdown[regime].trades > 0) {
      regimeBreakdown[regime].avgComposite =
        Math.round((regimeBreakdown[regime].avgComposite / regimeBreakdown[regime].trades) * 1000) / 1000;
    }
  }

  // Streaks
  let currentWin = 0;
  let longestWin = 0;
  let currentCoherent = 0;
  let tempWin = 0;
  for (const r of window) {
    if (r.isWin) { tempWin++; if (tempWin > longestWin) longestWin = tempWin; }
    else { tempWin = 0; }
  }
  // Count from end for current streaks
  for (let i = window.length - 1; i >= 0; i--) {
    if (window[i].isWin) currentWin++;
    else break;
  }
  for (let i = window.length - 1; i >= 0; i--) {
    if (window[i].input.coherenceScore >= 0.7) currentCoherent++;
    else break;
  }

  // Highlights
  let bestTrade: AgentBenchmarkScore["highlights"]["bestTrade"] = null;
  let worstTrade: AgentBenchmarkScore["highlights"]["worstTrade"] = null;
  let mostCoherent: AgentBenchmarkScore["highlights"]["mostCoherent"] = null;
  let leastCoherent: AgentBenchmarkScore["highlights"]["leastCoherent"] = null;

  for (const r of window) {
    const pnl = r.pnl;
    const coh = r.input.coherenceScore;

    if (!bestTrade || pnl > bestTrade.pnl) {
      bestTrade = { symbol: r.input.symbol, pnl, coherence: coh };
    }
    if (!worstTrade || pnl < worstTrade.pnl) {
      worstTrade = { symbol: r.input.symbol, pnl, coherence: coh };
    }
    if (!mostCoherent || coh > mostCoherent.score) {
      mostCoherent = { reasoning: r.input.reasoning.slice(0, 200), score: coh };
    }
    if (!leastCoherent || coh < leastCoherent.score) {
      leastCoherent = { reasoning: r.input.reasoning.slice(0, 200), score: coh };
    }
  }

  return {
    agentId,
    composite,
    grade,
    pillars,
    rank: 0, // Set by getLeaderboard
    percentile: 0,
    tradeCount: window.length,
    lastUpdated: window[window.length - 1].input.timestamp,
    regimeBreakdown,
    streaks: { currentWin, longestWin, currentCoherent },
    highlights: { bestTrade, worstTrade, mostCoherent, leastCoherent },
  };
}

/**
 * Get the full leaderboard with rankings and percentiles.
 */
export function getV9Leaderboard(): V9LeaderboardEntry[] {
  const agents = Array.from(agentWindows.keys());
  const scores: { agentId: string; composite: number; tradeCount: number; pillars: PillarScores }[] = [];

  for (const agentId of agents) {
    const score = getAgentScore(agentId);
    if (score) {
      scores.push({
        agentId,
        composite: score.composite,
        tradeCount: score.tradeCount,
        pillars: score.pillars,
      });
    }
  }

  // Sort by composite descending
  scores.sort((a, b) => b.composite - a.composite);

  const entries: V9LeaderboardEntry[] = scores.map((s, i) => {
    const prevRank = previousRanks.get(s.agentId) ?? i + 1;
    const change: "up" | "down" | "same" =
      prevRank > i + 1 ? "up" : prevRank < i + 1 ? "down" : "same";

    previousRanks.set(s.agentId, i + 1);

    return {
      rank: i + 1,
      agentId: s.agentId,
      composite: s.composite,
      grade: assignGrade(s.composite),
      pillars: s.pillars,
      tradeCount: s.tradeCount,
      change,
      percentile: scores.length > 1
        ? Math.round(((scores.length - 1 - i) / (scores.length - 1)) * 100)
        : 100,
    };
  });

  return entries;
}

/**
 * Export a snapshot for HuggingFace.
 */
export function exportV9Snapshot(regime: MarketRegime): V9Snapshot {
  const leaderboard = getV9Leaderboard();

  // Aggregate metrics from all windows
  let totalTrades = 0;
  let coherenceSum = 0;
  let halFlaggedCount = 0;
  let disciplinePassCount = 0;
  let calibrationSum = 0;

  for (const window of agentWindows.values()) {
    for (const r of window) {
      totalTrades++;
      coherenceSum += r.input.coherenceScore;
      if (r.input.hallucinationFlags.length > 0) halFlaggedCount++;
      if (r.input.disciplinePassed) disciplinePassCount++;
      calibrationSum += r.pillarScores.calibration;
    }
  }

  return {
    timestamp: new Date().toISOString(),
    version: "v9",
    regime,
    leaderboard,
    metrics: {
      totalTrades,
      avgCoherence: totalTrades > 0 ? Math.round((coherenceSum / totalTrades) * 1000) / 1000 : 0,
      avgHallucinationRate: totalTrades > 0 ? Math.round((halFlaggedCount / totalTrades) * 1000) / 1000 : 0,
      avgDisciplineRate: totalTrades > 0 ? Math.round((disciplinePassCount / totalTrades) * 1000) / 1000 : 0,
      avgCalibration: totalTrades > 0 ? Math.round((calibrationSum / totalTrades) * 1000) / 1000 : 0,
    },
  };
}

/**
 * Get all agent IDs currently tracked.
 */
export function getTrackedAgents(): string[] {
  return Array.from(agentWindows.keys());
}

/**
 * Get the trade window for an agent (for detailed analysis).
 */
export function getAgentWindow(agentId: string): TradeScoreInput[] {
  const window = agentWindows.get(agentId);
  if (!window) return [];
  return window.map((r) => r.input);
}
