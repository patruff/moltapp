/**
 * Outcome Resolution Engine (v14)
 *
 * Resolves predicted outcomes against actual market movements.
 * This is the critical feedback loop that closes the benchmark:
 * - Did the agent's prediction come true?
 * - Was high confidence correlated with correct predictions?
 * - How long did it take for the prediction to resolve?
 *
 * Unlike simple P&L tracking, this engine evaluates the QUALITY
 * of the agent's forward-looking reasoning, not just whether
 * the trade made money.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PendingPrediction {
  /** Unique prediction ID */
  id: string;
  /** Agent that made the prediction */
  agentId: string;
  /** Stock symbol */
  symbol: string;
  /** Action taken */
  action: "buy" | "sell" | "hold";
  /** Agent's confidence at time of prediction */
  confidence: number;
  /** What the agent predicted would happen */
  predictedOutcome: string;
  /** Price at time of prediction */
  priceAtPrediction: number;
  /** Trading round ID */
  roundId: string;
  /** When the prediction was made */
  timestamp: string;
  /** Direction implied by prediction: up, down, flat */
  impliedDirection: "up" | "down" | "flat";
  /** Target price if extractable from prediction text */
  targetPrice: number | null;
  /** Time horizon if extractable (hours) */
  timeHorizonHours: number | null;
}

export interface ResolvedPrediction extends PendingPrediction {
  /** Price when prediction was resolved */
  priceAtResolution: number;
  /** Actual price change percentage */
  actualChangePct: number;
  /** Was the directional prediction correct? */
  directionCorrect: boolean;
  /** How close was the target price? (0-1, 1 = exact) */
  targetAccuracy: number | null;
  /** Time it took to resolve (hours) */
  resolutionTimeHours: number;
  /** Overall prediction quality score (0-1) */
  predictionScore: number;
  /** How the resolution was determined */
  resolutionMethod: "price_movement" | "time_expiry" | "manual";
}

export interface CalibrationBucket {
  /** Confidence range (e.g., "0.7-0.8") */
  range: string;
  /** Lower bound of confidence bucket */
  lower: number;
  /** Upper bound of confidence bucket */
  upper: number;
  /** Total predictions in this bucket */
  total: number;
  /** Correct predictions in this bucket */
  correct: number;
  /** Actual accuracy = correct / total */
  accuracy: number;
  /** Expected accuracy (midpoint of confidence range) */
  expected: number;
  /** Calibration error = |accuracy - expected| */
  calibrationError: number;
}

export interface AgentPredictionProfile {
  agentId: string;
  totalPredictions: number;
  resolvedPredictions: number;
  pendingPredictions: number;
  overallAccuracy: number;
  avgPredictionScore: number;
  calibrationBuckets: CalibrationBucket[];
  /** Expected Calibration Error (lower is better, 0 = perfectly calibrated) */
  ece: number;
  /** Brier score (lower is better) */
  brierScore: number;
  /** Does higher confidence actually predict better outcomes? */
  monotonicCalibration: boolean;
  /** Accuracy by direction */
  directionAccuracy: {
    up: { total: number; correct: number; accuracy: number };
    down: { total: number; correct: number; accuracy: number };
    flat: { total: number; correct: number; accuracy: number };
  };
  /** Accuracy by intent */
  intentAccuracy: Record<string, { total: number; correct: number; accuracy: number }>;
}

// ---------------------------------------------------------------------------
// In-Memory State
// ---------------------------------------------------------------------------

const pendingPredictions: PendingPrediction[] = [];
const resolvedPredictions: ResolvedPrediction[] = [];
const MAX_PENDING = 500;
const MAX_RESOLVED = 2000;

/** Default resolution time: 24 hours */
const DEFAULT_RESOLUTION_HOURS = 24;

/** Minimum price movement to consider a prediction resolved early */
const MIN_SIGNIFICANT_MOVE_PCT = 2.0;

// ---------------------------------------------------------------------------
// Prediction Registration
// ---------------------------------------------------------------------------

/**
 * Register a new prediction from an agent's trade reasoning.
 * Extracts directional intent and target from the prediction text.
 */
export function registerPrediction(params: {
  agentId: string;
  symbol: string;
  action: "buy" | "sell" | "hold";
  confidence: number;
  predictedOutcome: string;
  priceAtPrediction: number;
  roundId: string;
  intent?: string;
}): PendingPrediction {
  const id = `pred_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  const impliedDirection = inferDirection(
    params.predictedOutcome,
    params.action,
  );

  const targetPrice = extractTargetPrice(params.predictedOutcome);
  const timeHorizonHours = extractTimeHorizon(params.predictedOutcome);

  const prediction: PendingPrediction = {
    id,
    agentId: params.agentId,
    symbol: params.symbol,
    action: params.action,
    confidence: params.confidence,
    predictedOutcome: params.predictedOutcome,
    priceAtPrediction: params.priceAtPrediction,
    roundId: params.roundId,
    timestamp: new Date().toISOString(),
    impliedDirection,
    targetPrice,
    timeHorizonHours: timeHorizonHours ?? DEFAULT_RESOLUTION_HOURS,
  };

  pendingPredictions.push(prediction);
  if (pendingPredictions.length > MAX_PENDING) {
    pendingPredictions.splice(0, pendingPredictions.length - MAX_PENDING);
  }

  return prediction;
}

/**
 * Resolve pending predictions against current market prices.
 * Called periodically (e.g., after each trading round).
 */
export function resolvePredictions(
  currentPrices: Map<string, number>,
): ResolvedPrediction[] {
  const now = Date.now();
  const newlyResolved: ResolvedPrediction[] = [];

  for (let i = pendingPredictions.length - 1; i >= 0; i--) {
    const pred = pendingPredictions[i];
    const currentPrice = currentPrices.get(pred.symbol.toLowerCase()) ??
      currentPrices.get(pred.symbol);

    if (currentPrice === undefined) continue;

    const elapsedHours = (now - new Date(pred.timestamp).getTime()) / (1000 * 60 * 60);
    const changePct = ((currentPrice - pred.priceAtPrediction) / pred.priceAtPrediction) * 100;
    const absChange = Math.abs(changePct);

    // Resolve if: time expired OR significant price movement
    const timeExpired = elapsedHours >= (pred.timeHorizonHours ?? DEFAULT_RESOLUTION_HOURS);
    const significantMove = absChange >= MIN_SIGNIFICANT_MOVE_PCT;

    if (!timeExpired && !significantMove) continue;

    // Determine if direction was correct
    const actualDirection = changePct > 0.5 ? "up" : changePct < -0.5 ? "down" : "flat";
    const directionCorrect = pred.impliedDirection === actualDirection;

    // Calculate target accuracy if target was specified
    let targetAccuracy: number | null = null;
    if (pred.targetPrice !== null) {
      const targetChangePct = ((pred.targetPrice - pred.priceAtPrediction) / pred.priceAtPrediction) * 100;
      const actualVsTarget = Math.abs(changePct - targetChangePct);
      targetAccuracy = Math.max(0, 1 - actualVsTarget / 10); // 10% off = 0 accuracy
    }

    // Compute prediction quality score
    const predictionScore = computePredictionScore(
      directionCorrect,
      targetAccuracy,
      pred.confidence,
      absChange,
    );

    const resolved: ResolvedPrediction = {
      ...pred,
      priceAtResolution: currentPrice,
      actualChangePct: Math.round(changePct * 100) / 100,
      directionCorrect,
      targetAccuracy: targetAccuracy !== null ? Math.round(targetAccuracy * 100) / 100 : null,
      resolutionTimeHours: Math.round(elapsedHours * 10) / 10,
      predictionScore: Math.round(predictionScore * 1000) / 1000,
      resolutionMethod: significantMove ? "price_movement" : "time_expiry",
    };

    newlyResolved.push(resolved);
    resolvedPredictions.push(resolved);
    pendingPredictions.splice(i, 1);
  }

  // Trim resolved list
  if (resolvedPredictions.length > MAX_RESOLVED) {
    resolvedPredictions.splice(0, resolvedPredictions.length - MAX_RESOLVED);
  }

  return newlyResolved;
}

// ---------------------------------------------------------------------------
// Agent Profile Generation
// ---------------------------------------------------------------------------

/**
 * Build a full prediction profile for an agent.
 * Includes calibration curve, accuracy by direction/intent, and Brier score.
 */
export function buildAgentPredictionProfile(agentId: string): AgentPredictionProfile {
  const agentResolved = resolvedPredictions.filter((r) => r.agentId === agentId);
  const agentPending = pendingPredictions.filter((p) => p.agentId === agentId);

  // Calibration buckets: 0-0.1, 0.1-0.2, ..., 0.9-1.0
  const buckets: CalibrationBucket[] = [];
  for (let i = 0; i < 10; i++) {
    const lower = i * 0.1;
    const upper = (i + 1) * 0.1;
    const inBucket = agentResolved.filter(
      (r) => r.confidence >= lower && r.confidence < upper,
    );
    const correct = inBucket.filter((r) => r.directionCorrect).length;
    const total = inBucket.length;
    const accuracy = total > 0 ? correct / total : 0;
    const expected = (lower + upper) / 2;

    buckets.push({
      range: `${lower.toFixed(1)}-${upper.toFixed(1)}`,
      lower,
      upper,
      total,
      correct,
      accuracy: Math.round(accuracy * 1000) / 1000,
      expected: Math.round(expected * 1000) / 1000,
      calibrationError: total > 0 ? Math.round(Math.abs(accuracy - expected) * 1000) / 1000 : 0,
    });
  }

  // ECE = weighted average of calibration errors
  const totalSamples = agentResolved.length;
  const ece = totalSamples > 0
    ? buckets.reduce((sum, b) => sum + (b.total / totalSamples) * b.calibrationError, 0)
    : 0;

  // Brier score = mean squared error of probabilistic predictions
  const brierScore = totalSamples > 0
    ? agentResolved.reduce((sum, r) => {
        const outcome = r.directionCorrect ? 1 : 0;
        return sum + Math.pow(r.confidence - outcome, 2);
      }, 0) / totalSamples
    : 0;

  // Check monotonic calibration (higher confidence → higher accuracy)
  const nonEmptyBuckets = buckets.filter((b) => b.total > 0);
  let monotonicCalibration = true;
  for (let i = 1; i < nonEmptyBuckets.length; i++) {
    if (nonEmptyBuckets[i].accuracy < nonEmptyBuckets[i - 1].accuracy - 0.1) {
      monotonicCalibration = false;
      break;
    }
  }

  // Direction accuracy
  const directionAccuracy = {
    up: computeDirectionAccuracy(agentResolved, "up"),
    down: computeDirectionAccuracy(agentResolved, "down"),
    flat: computeDirectionAccuracy(agentResolved, "flat"),
  };

  // Intent accuracy
  const intents = new Set(agentResolved.map((r) => r.action));
  const intentAccuracy: Record<string, { total: number; correct: number; accuracy: number }> = {};
  for (const intent of intents) {
    const inIntent = agentResolved.filter((r) => r.action === intent);
    const correct = inIntent.filter((r) => r.directionCorrect).length;
    intentAccuracy[intent] = {
      total: inIntent.length,
      correct,
      accuracy: inIntent.length > 0 ? Math.round((correct / inIntent.length) * 1000) / 1000 : 0,
    };
  }

  const overallCorrect = agentResolved.filter((r) => r.directionCorrect).length;

  return {
    agentId,
    totalPredictions: agentResolved.length + agentPending.length,
    resolvedPredictions: agentResolved.length,
    pendingPredictions: agentPending.length,
    overallAccuracy: totalSamples > 0
      ? Math.round((overallCorrect / totalSamples) * 1000) / 1000
      : 0,
    avgPredictionScore: totalSamples > 0
      ? Math.round(
          (agentResolved.reduce((s, r) => s + r.predictionScore, 0) / totalSamples) * 1000,
        ) / 1000
      : 0,
    calibrationBuckets: buckets,
    ece: Math.round(ece * 1000) / 1000,
    brierScore: Math.round(brierScore * 1000) / 1000,
    monotonicCalibration,
    directionAccuracy,
    intentAccuracy,
  };
}

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

export function getPendingPredictions(agentId?: string): PendingPrediction[] {
  if (agentId) return pendingPredictions.filter((p) => p.agentId === agentId);
  return [...pendingPredictions];
}

export function getResolvedPredictions(agentId?: string): ResolvedPrediction[] {
  if (agentId) return resolvedPredictions.filter((r) => r.agentId === agentId);
  return [...resolvedPredictions];
}

export function getResolutionStats(): {
  totalPending: number;
  totalResolved: number;
  overallAccuracy: number;
  avgPredictionScore: number;
  byAgent: Record<string, { resolved: number; accuracy: number; avgScore: number }>;
} {
  const agents = new Set([
    ...pendingPredictions.map((p) => p.agentId),
    ...resolvedPredictions.map((r) => r.agentId),
  ]);

  const byAgent: Record<string, { resolved: number; accuracy: number; avgScore: number }> = {};
  for (const agentId of agents) {
    const agentResolved = resolvedPredictions.filter((r) => r.agentId === agentId);
    const correct = agentResolved.filter((r) => r.directionCorrect).length;
    byAgent[agentId] = {
      resolved: agentResolved.length,
      accuracy: agentResolved.length > 0
        ? Math.round((correct / agentResolved.length) * 1000) / 1000
        : 0,
      avgScore: agentResolved.length > 0
        ? Math.round(
            (agentResolved.reduce((s, r) => s + r.predictionScore, 0) / agentResolved.length) * 1000,
          ) / 1000
        : 0,
    };
  }

  const totalCorrect = resolvedPredictions.filter((r) => r.directionCorrect).length;

  return {
    totalPending: pendingPredictions.length,
    totalResolved: resolvedPredictions.length,
    overallAccuracy: resolvedPredictions.length > 0
      ? Math.round((totalCorrect / resolvedPredictions.length) * 1000) / 1000
      : 0,
    avgPredictionScore: resolvedPredictions.length > 0
      ? Math.round(
          (resolvedPredictions.reduce((s, r) => s + r.predictionScore, 0) / resolvedPredictions.length) * 1000,
        ) / 1000
      : 0,
    byAgent,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inferDirection(
  predictionText: string,
  action: "buy" | "sell" | "hold",
): "up" | "down" | "flat" {
  const lower = predictionText.toLowerCase();

  // Explicit directional keywords
  if (/upside|rise|rally|climb|increase|higher|bull|gain|grow|appreciate|target\s+\$?\d+.*above/i.test(lower)) {
    return "up";
  }
  if (/downside|fall|decline|drop|decrease|lower|bear|loss|depreci|correction|crash/i.test(lower)) {
    return "down";
  }
  if (/flat|sideways|range-bound|consolidat|stable|unchanged/i.test(lower)) {
    return "flat";
  }

  // Infer from action
  if (action === "buy") return "up";
  if (action === "sell") return "down";
  return "flat";
}

function extractTargetPrice(predictionText: string): number | null {
  // Match patterns like "target $180", "target: $180.50", "PT $180"
  const match = predictionText.match(
    /(?:target|pt|price\s+target)\s*:?\s*\$?([\d,]+\.?\d*)/i,
  );
  if (match) {
    const price = parseFloat(match[1].replace(/,/g, ""));
    if (price > 0 && price < 100000) return price;
  }
  return null;
}

function extractTimeHorizon(predictionText: string): number | null {
  const lower = predictionText.toLowerCase();

  // "within 24h", "in 48 hours", "next 2 days"
  const hoursMatch = lower.match(/(\d+)\s*(?:h|hours?)/);
  if (hoursMatch) return parseInt(hoursMatch[1]);

  const daysMatch = lower.match(/(\d+)\s*(?:d|days?)/);
  if (daysMatch) return parseInt(daysMatch[1]) * 24;

  const weeksMatch = lower.match(/(\d+)\s*(?:w|weeks?)/);
  if (weeksMatch) return parseInt(weeksMatch[1]) * 168;

  // Common phrases
  if (/next\s+trading\s+session|tomorrow/i.test(lower)) return 24;
  if (/this\s+week|next\s+few\s+days/i.test(lower)) return 72;
  if (/short.term/i.test(lower)) return 48;

  return null;
}

function computePredictionScore(
  directionCorrect: boolean,
  targetAccuracy: number | null,
  confidence: number,
  absChangePct: number,
): number {
  // Base score: 0.6 for direction correct, 0 for wrong
  let score = directionCorrect ? 0.6 : 0;

  // Target accuracy bonus (up to +0.2)
  if (targetAccuracy !== null) {
    score += targetAccuracy * 0.2;
  }

  // Confidence calibration bonus/penalty
  if (directionCorrect) {
    // High confidence + correct = bonus
    score += confidence * 0.1;
  } else {
    // High confidence + wrong = penalty
    score -= confidence * 0.15;
  }

  // Magnitude bonus: correct on large moves is more impressive
  if (directionCorrect && absChangePct > 3) {
    score += Math.min(0.1, absChangePct * 0.01);
  }

  return Math.max(0, Math.min(1, score));
}

function computeDirectionAccuracy(
  predictions: ResolvedPrediction[],
  direction: "up" | "down" | "flat",
): { total: number; correct: number; accuracy: number } {
  const filtered = predictions.filter((r) => r.impliedDirection === direction);
  const correct = filtered.filter((r) => r.directionCorrect).length;
  return {
    total: filtered.length,
    correct,
    accuracy: filtered.length > 0 ? Math.round((correct / filtered.length) * 1000) / 1000 : 0,
  };
}
