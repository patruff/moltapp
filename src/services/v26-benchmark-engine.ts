/**
 * v26 Benchmark Engine
 *
 * Two new analysis engines that push MoltApp to a 12-dimension benchmark:
 *
 * 1. STRATEGY GENOME ANALYZER
 *    Measures how consistent an agent's trading strategy is across trades.
 *    Builds a "DNA fingerprint" of strategy weights and measures drift.
 *
 * 2. RISK-REWARD DISCIPLINE ANALYZER
 *    Measures whether agents properly manage risk/reward — position sizing
 *    relative to confidence, risk boundary awareness, portfolio concentration.
 *
 * Both engines feed scores into the v26 composite benchmark scoring system.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StrategyDna {
  valueWeight: number;
  momentumWeight: number;
  contrarianWeight: number;
  hedgeWeight: number;
  arbitrageWeight: number;
  meanReversionWeight: number;
}

export interface StrategyGenomeResult {
  /** How closely this trade matches the agent's declared style (0-1) */
  styleConsistencyScore: number;
  /** Drift from historical average strategy vector (0-1, lower = more consistent) */
  strategyDrift: number;
  /** The dominant strategy detected from reasoning */
  detectedStrategy: string;
  /** Strategy DNA vector for this trade */
  strategyDna: StrategyDna;
  /** Composite genome score (0-1) */
  genomeScore: number;
}

export interface RiskRewardResult {
  /** Does position size scale with confidence? (0-1) */
  sizingDisciplineScore: number;
  /** Implied risk-reward ratio from reasoning */
  impliedRiskReward: number | null;
  /** Whether agent mentioned a stop-loss / risk boundary */
  hasRiskBoundary: boolean;
  /** Whether agent specified a profit target */
  hasProfitTarget: boolean;
  /** Risk awareness from reasoning text (0-1) */
  riskAwarenessScore: number;
  /** Cash buffer maintained per config */
  cashBufferMaintained: boolean;
  /** Portfolio concentration (Herfindahl index, 0-1) */
  portfolioConcentration: number;
  /** Composite risk-reward discipline score (0-1) */
  disciplineScore: number;
}

// ---------------------------------------------------------------------------
// Strategy DNA patterns (intent → DNA weights)
// ---------------------------------------------------------------------------

const INTENT_DNA_MAP: Record<string, StrategyDna> = {
  value: {
    valueWeight: 0.8,
    momentumWeight: 0.05,
    contrarianWeight: 0.1,
    hedgeWeight: 0.0,
    arbitrageWeight: 0.0,
    meanReversionWeight: 0.05,
  },
  momentum: {
    valueWeight: 0.05,
    momentumWeight: 0.8,
    contrarianWeight: 0.0,
    hedgeWeight: 0.05,
    arbitrageWeight: 0.0,
    meanReversionWeight: 0.1,
  },
  contrarian: {
    valueWeight: 0.1,
    momentumWeight: 0.0,
    contrarianWeight: 0.7,
    hedgeWeight: 0.05,
    arbitrageWeight: 0.0,
    meanReversionWeight: 0.15,
  },
  hedge: {
    valueWeight: 0.0,
    momentumWeight: 0.0,
    contrarianWeight: 0.0,
    hedgeWeight: 0.8,
    arbitrageWeight: 0.1,
    meanReversionWeight: 0.1,
  },
  arbitrage: {
    valueWeight: 0.0,
    momentumWeight: 0.1,
    contrarianWeight: 0.0,
    hedgeWeight: 0.1,
    arbitrageWeight: 0.7,
    meanReversionWeight: 0.1,
  },
  mean_reversion: {
    valueWeight: 0.1,
    momentumWeight: 0.0,
    contrarianWeight: 0.15,
    hedgeWeight: 0.05,
    arbitrageWeight: 0.0,
    meanReversionWeight: 0.7,
  },
};

// ---------------------------------------------------------------------------
// Agent historical DNA cache (in-memory for fast scoring)
// ---------------------------------------------------------------------------

const agentHistoryCache = new Map<
  string,
  { dnaHistory: StrategyDna[]; avgDna: StrategyDna }
>();

const MAX_HISTORY = 50;

function updateAgentDnaHistory(agentId: string, dna: StrategyDna): StrategyDna {
  const existing = agentHistoryCache.get(agentId) ?? {
    dnaHistory: [],
    avgDna: { valueWeight: 0, momentumWeight: 0, contrarianWeight: 0, hedgeWeight: 0, arbitrageWeight: 0, meanReversionWeight: 0 },
  };

  existing.dnaHistory.push(dna);
  if (existing.dnaHistory.length > MAX_HISTORY) {
    existing.dnaHistory.shift();
  }

  // Recalculate average
  const count = existing.dnaHistory.length;
  const avg: StrategyDna = {
    valueWeight: 0,
    momentumWeight: 0,
    contrarianWeight: 0,
    hedgeWeight: 0,
    arbitrageWeight: 0,
    meanReversionWeight: 0,
  };

  for (const d of existing.dnaHistory) {
    avg.valueWeight += d.valueWeight;
    avg.momentumWeight += d.momentumWeight;
    avg.contrarianWeight += d.contrarianWeight;
    avg.hedgeWeight += d.hedgeWeight;
    avg.arbitrageWeight += d.arbitrageWeight;
    avg.meanReversionWeight += d.meanReversionWeight;
  }

  avg.valueWeight /= count;
  avg.momentumWeight /= count;
  avg.contrarianWeight /= count;
  avg.hedgeWeight /= count;
  avg.arbitrageWeight /= count;
  avg.meanReversionWeight /= count;

  existing.avgDna = avg;
  agentHistoryCache.set(agentId, existing);

  return avg;
}

// ---------------------------------------------------------------------------
// Strategy Genome Analyzer
// ---------------------------------------------------------------------------

/**
 * Detect strategy type from reasoning text using keyword analysis.
 */
function detectStrategyFromReasoning(reasoning: string): string {
  const lower = reasoning.toLowerCase();

  const scores: Record<string, number> = {
    value: 0,
    momentum: 0,
    contrarian: 0,
    hedge: 0,
    arbitrage: 0,
    mean_reversion: 0,
  };

  // Value signals
  if (/undervalued|intrinsic|margin\s+of\s+safety|fair\s+price|cheap|p\/e\s+ratio|earnings/i.test(lower)) scores.value += 3;
  if (/fundamentals?|book\s+value|dividend|moat|long.term/i.test(lower)) scores.value += 2;
  if (/buffett|graham|quality\s+at/i.test(lower)) scores.value += 1;

  // Momentum signals
  if (/momentum|trend|breakout|rally|surge|continuation/i.test(lower)) scores.momentum += 3;
  if (/moving\s+average|rsi|macd|volume\s+spike|technical/i.test(lower)) scores.momentum += 2;
  if (/riding|accelerat|strong\s+move/i.test(lower)) scores.momentum += 1;

  // Contrarian signals
  if (/contrarian|against\s+the\s+crowd|overreaction|panic|fear/i.test(lower)) scores.contrarian += 3;
  if (/oversold|sentiment\s+extreme|capitulation|blood\s+in/i.test(lower)) scores.contrarian += 2;
  if (/disagreement|unpopular|contrari/i.test(lower)) scores.contrarian += 1;

  // Hedge signals
  if (/hedge|protect|downside\s+protection|defensive|risk\s+reduction/i.test(lower)) scores.hedge += 3;
  if (/insurance|tail\s+risk|correlation|beta\s+neutral/i.test(lower)) scores.hedge += 2;

  // Arbitrage signals
  if (/arbitrage|mispricing|spread|price\s+difference|convergence/i.test(lower)) scores.arbitrage += 3;
  if (/dislocation|inefficiency|pair\s+trade/i.test(lower)) scores.arbitrage += 2;

  // Mean reversion signals
  if (/mean\s+reversion|revert|oversold|overbought|pullback|bounce/i.test(lower)) scores.mean_reversion += 3;
  if (/support\s+level|historical\s+average|z.score|standard\s+deviation/i.test(lower)) scores.mean_reversion += 2;
  if (/correction|extreme|normalize/i.test(lower)) scores.mean_reversion += 1;

  // Find the top strategy
  let maxScore = 0;
  let detected = "value";
  for (const [strategy, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      detected = strategy;
    }
  }

  return detected;
}

/**
 * Build a strategy DNA vector from reasoning text.
 * Blends the detected intent DNA with keyword-based signals.
 */
function buildStrategyDna(reasoning: string, intent: string): StrategyDna {
  const baseDna = INTENT_DNA_MAP[intent] ?? INTENT_DNA_MAP.value;
  const detected = detectStrategyFromReasoning(reasoning);
  const detectedDna = INTENT_DNA_MAP[detected] ?? INTENT_DNA_MAP.value;

  // Blend: 60% declared intent, 40% detected from reasoning
  const dna: StrategyDna = {
    valueWeight: baseDna.valueWeight * 0.6 + detectedDna.valueWeight * 0.4,
    momentumWeight: baseDna.momentumWeight * 0.6 + detectedDna.momentumWeight * 0.4,
    contrarianWeight: baseDna.contrarianWeight * 0.6 + detectedDna.contrarianWeight * 0.4,
    hedgeWeight: baseDna.hedgeWeight * 0.6 + detectedDna.hedgeWeight * 0.4,
    arbitrageWeight: baseDna.arbitrageWeight * 0.6 + detectedDna.arbitrageWeight * 0.4,
    meanReversionWeight: baseDna.meanReversionWeight * 0.6 + detectedDna.meanReversionWeight * 0.4,
  };

  // Normalize to sum to 1
  const total =
    dna.valueWeight +
    dna.momentumWeight +
    dna.contrarianWeight +
    dna.hedgeWeight +
    dna.arbitrageWeight +
    dna.meanReversionWeight;

  if (total > 0) {
    dna.valueWeight /= total;
    dna.momentumWeight /= total;
    dna.contrarianWeight /= total;
    dna.hedgeWeight /= total;
    dna.arbitrageWeight /= total;
    dna.meanReversionWeight /= total;
  }

  return dna;
}

/**
 * Calculate cosine similarity between two DNA vectors.
 */
function dnaSimilarity(a: StrategyDna, b: StrategyDna): number {
  const aVec = [a.valueWeight, a.momentumWeight, a.contrarianWeight, a.hedgeWeight, a.arbitrageWeight, a.meanReversionWeight];
  const bVec = [b.valueWeight, b.momentumWeight, b.contrarianWeight, b.hedgeWeight, b.arbitrageWeight, b.meanReversionWeight];

  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < aVec.length; i++) {
    dot += aVec[i] * bVec[i];
    magA += aVec[i] * aVec[i];
    magB += bVec[i] * bVec[i];
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom > 0 ? dot / denom : 0;
}

/**
 * Analyze an agent's strategy genome for a single trade.
 *
 * Measures:
 * - Style consistency: does reasoning match declared intent?
 * - Strategy drift: how much has the agent's approach changed over time?
 * - Genome score: composite of consistency and stability
 */
export function analyzeStrategyGenome(
  agentId: string,
  reasoning: string,
  declaredIntent: string,
  agentDeclaredStyle: string,
): StrategyGenomeResult {
  const detected = detectStrategyFromReasoning(reasoning);
  const dna = buildStrategyDna(reasoning, declaredIntent);

  // Style consistency: does detected strategy match agent's declared style?
  const styleMap: Record<string, string[]> = {
    "conservative-value": ["value", "hedge"],
    "aggressive-momentum": ["momentum", "arbitrage"],
    "contrarian-swing": ["contrarian", "mean_reversion"],
  };

  const expectedStrategies = styleMap[agentDeclaredStyle] ?? [declaredIntent];
  const styleConsistencyScore = expectedStrategies.includes(detected) ? 1.0 : 0.4;

  // Update history and compute drift
  const avgDna = updateAgentDnaHistory(agentId, dna);
  const similarity = dnaSimilarity(dna, avgDna);
  const strategyDrift = Math.round((1 - similarity) * 100) / 100;

  // Composite genome score
  const genomeScore = Math.round(
    (styleConsistencyScore * 0.5 + (1 - strategyDrift) * 0.5) * 100,
  ) / 100;

  return {
    styleConsistencyScore: Math.round(styleConsistencyScore * 100) / 100,
    strategyDrift,
    detectedStrategy: detected,
    strategyDna: {
      valueWeight: Math.round(dna.valueWeight * 1000) / 1000,
      momentumWeight: Math.round(dna.momentumWeight * 1000) / 1000,
      contrarianWeight: Math.round(dna.contrarianWeight * 1000) / 1000,
      hedgeWeight: Math.round(dna.hedgeWeight * 1000) / 1000,
      arbitrageWeight: Math.round(dna.arbitrageWeight * 1000) / 1000,
      meanReversionWeight: Math.round(dna.meanReversionWeight * 1000) / 1000,
    },
    genomeScore,
  };
}

// ---------------------------------------------------------------------------
// Risk-Reward Discipline Analyzer
// ---------------------------------------------------------------------------

/**
 * Risk-related keyword patterns in reasoning text.
 */
const RISK_PATTERNS: [RegExp, number][] = [
  [/stop.?loss/i, 0.25],
  [/risk.?reward/i, 0.2],
  [/downside\s+(?:risk|protection|limit)/i, 0.2],
  [/max(?:imum)?\s+loss/i, 0.2],
  [/position\s+siz/i, 0.15],
  [/portfolio\s+(?:risk|concentration|diversif)/i, 0.15],
  [/cash\s+(?:buffer|reserve|cushion)/i, 0.15],
  [/risk\s+management/i, 0.15],
  [/volatility\s+(?:adjusted|aware|risk)/i, 0.1],
  [/drawdown/i, 0.1],
  [/exposure\s+limit/i, 0.1],
  [/hedge|hedging/i, 0.1],
];

const PROFIT_TARGET_PATTERNS: RegExp[] = [
  /target\s*(?:price|:)\s*\$?\d/i,
  /profit\s+target/i,
  /take\s+profit/i,
  /upside\s+(?:target|potential|of)\s*\+?\d/i,
  /expect(?:ing|ed)?\s+.*\+?\d+\.?\d*%/i,
  /price\s+target\s*(?:of|:)\s*\$?\d/i,
];

const RISK_BOUNDARY_PATTERNS: RegExp[] = [
  /stop.?loss/i,
  /downside\s+limit/i,
  /max(?:imum)?\s+loss/i,
  /risk\s+(?:limit|cap|boundary)/i,
  /cut\s+(?:losses|position)\s+(?:at|if)/i,
  /exit\s+(?:at|if|below)/i,
  /will\s+sell\s+if/i,
];

/**
 * Calculate Herfindahl index for portfolio concentration.
 * Returns value between 0 (perfectly diversified) and 1 (all in one stock).
 */
function calculateHerfindahl(
  positions: { symbol: string; currentPrice: number; quantity: number }[],
  totalValue: number,
): number {
  if (totalValue <= 0 || positions.length === 0) return 0;

  let sumSquares = 0;
  for (const p of positions) {
    const weight = (p.currentPrice * p.quantity) / totalValue;
    sumSquares += weight * weight;
  }

  return Math.round(sumSquares * 100) / 100;
}

/**
 * Analyze risk-reward discipline for a single trade.
 *
 * Measures:
 * - Sizing discipline: does position size scale with confidence?
 * - Risk awareness: how much does the reasoning discuss risk?
 * - Risk boundaries: does the agent set stop-losses?
 * - Profit targets: does the agent set targets?
 * - Cash buffer maintenance
 * - Portfolio concentration
 */
export function analyzeRiskRewardDiscipline(
  reasoning: string,
  action: "buy" | "sell" | "hold",
  confidence: number,
  quantity: number,
  portfolio: {
    cashBalance: number;
    totalValue: number;
    positions: { symbol: string; currentPrice: number; quantity: number }[];
  },
  agentConfig: {
    maxPositionSize: number;
    maxPortfolioAllocation: number;
    riskTolerance: "conservative" | "moderate" | "aggressive";
  },
): RiskRewardResult {
  // 1. Position size as % of portfolio
  const positionSizePercent =
    portfolio.totalValue > 0 ? (quantity / portfolio.totalValue) * 100 : 0;

  // 2. Sizing discipline: confidence-proportional sizing
  // High confidence should → larger position, low confidence → smaller
  let sizingDisciplineScore: number;
  if (action === "hold") {
    sizingDisciplineScore = 1.0; // Hold = no sizing risk
  } else {
    const expectedSizeRange = agentConfig.maxPositionSize * confidence;
    const sizingRatio =
      expectedSizeRange > 0
        ? Math.min(positionSizePercent, expectedSizeRange) / expectedSizeRange
        : 1;
    // Penalize oversizing relative to confidence
    if (positionSizePercent > expectedSizeRange * 1.5) {
      sizingDisciplineScore = Math.max(0.1, 1 - (positionSizePercent - expectedSizeRange) / agentConfig.maxPositionSize);
    } else {
      sizingDisciplineScore = 0.5 + sizingRatio * 0.5;
    }
  }

  // 3. Risk awareness score from reasoning text
  let riskAwarenessScore = 0;
  for (const [pattern, weight] of RISK_PATTERNS) {
    if (pattern.test(reasoning)) {
      riskAwarenessScore += weight;
    }
  }
  riskAwarenessScore = Math.min(1, riskAwarenessScore);

  // 4. Risk boundaries
  const hasRiskBoundary = RISK_BOUNDARY_PATTERNS.some((p) => p.test(reasoning));

  // 5. Profit targets
  const hasProfitTarget = PROFIT_TARGET_PATTERNS.some((p) => p.test(reasoning));

  // 6. Implied risk-reward from text
  let impliedRiskReward: number | null = null;
  const rrMatch = reasoning.match(
    /(?:risk.?reward|r.?r)\s*(?:ratio|of)?\s*(?::|=|is)?\s*(\d+(?:\.\d+)?)\s*(?::|to)\s*(\d+(?:\.\d+)?)/i,
  );
  if (rrMatch) {
    const riskPart = parseFloat(rrMatch[1]);
    const rewardPart = parseFloat(rrMatch[2]);
    if (riskPart > 0) {
      impliedRiskReward = Math.round((rewardPart / riskPart) * 100) / 100;
    }
  }

  // 7. Cash buffer check
  const minCash =
    portfolio.totalValue * ((100 - agentConfig.maxPortfolioAllocation) / 100);
  const cashBufferMaintained = portfolio.cashBalance >= minCash * 0.9; // 10% tolerance

  // 8. Portfolio concentration
  const portfolioConcentration = calculateHerfindahl(
    portfolio.positions,
    portfolio.totalValue,
  );

  // Composite score
  // Sizing: 30%, Risk awareness: 25%, Boundaries: 15%, Targets: 10%, Buffer: 10%, Concentration: 10%
  const concentrationScore = 1 - Math.min(1, portfolioConcentration * 2); // penalize concentration > 0.5
  const disciplineScore = Math.round(
    (sizingDisciplineScore * 0.30 +
      riskAwarenessScore * 0.25 +
      (hasRiskBoundary ? 1 : 0) * 0.15 +
      (hasProfitTarget ? 1 : 0) * 0.10 +
      (cashBufferMaintained ? 1 : 0) * 0.10 +
      concentrationScore * 0.10) *
      100,
  ) / 100;

  return {
    sizingDisciplineScore: Math.round(sizingDisciplineScore * 100) / 100,
    impliedRiskReward,
    hasRiskBoundary,
    hasProfitTarget,
    riskAwarenessScore: Math.round(riskAwarenessScore * 100) / 100,
    cashBufferMaintained,
    portfolioConcentration,
    disciplineScore,
  };
}

// ---------------------------------------------------------------------------
// Composite v26 Scoring
// ---------------------------------------------------------------------------

export interface V26DimensionScores {
  pnl: number;
  coherence: number;
  hallucinationFree: number;
  discipline: number;
  calibration: number;
  predictionAccuracy: number;
  reasoningDepth: number;
  sourceQuality: number;
  outcomePrediction: number;
  consensusIntelligence: number;
  strategyGenome: number;
  riskRewardDiscipline: number;
}

/**
 * v26 dimension weights (sum to 1.0).
 * Each weight reflects that dimension's importance in the overall benchmark.
 */
export const V26_WEIGHTS: Record<keyof V26DimensionScores, number> = {
  pnl: 0.14,
  coherence: 0.10,
  hallucinationFree: 0.10,
  discipline: 0.07,
  calibration: 0.08,
  predictionAccuracy: 0.07,
  reasoningDepth: 0.09,
  sourceQuality: 0.08,
  outcomePrediction: 0.08,
  consensusIntelligence: 0.07,
  strategyGenome: 0.06,
  riskRewardDiscipline: 0.06,
};

/**
 * Calculate the v26 composite benchmark score (0-100).
 */
export function calculateV26Composite(scores: V26DimensionScores): number {
  let composite = 0;
  for (const [dim, weight] of Object.entries(V26_WEIGHTS)) {
    const score = scores[dim as keyof V26DimensionScores] ?? 0;
    composite += score * weight;
  }
  return Math.round(composite * 100 * 100) / 100; // 0-100 with 2 decimals
}

/**
 * Assign a letter grade based on composite score.
 */
export function assignGrade(compositeScore: number): string {
  if (compositeScore >= 95) return "S";
  if (compositeScore >= 90) return "A+";
  if (compositeScore >= 80) return "A";
  if (compositeScore >= 70) return "B+";
  if (compositeScore >= 60) return "B";
  if (compositeScore >= 50) return "C";
  if (compositeScore >= 40) return "D";
  return "F";
}

/**
 * Get the strategy DNA history for an agent.
 */
export function getAgentDnaHistory(agentId: string): { dnaHistory: StrategyDna[]; avgDna: StrategyDna } | null {
  return agentHistoryCache.get(agentId) ?? null;
}
