/**
 * Agent Intelligence Network Routes
 *
 * API for the cross-agent intelligence layer. Provides consensus detection,
 * contrarian alerts, swarm predictions, agreement analysis, collective
 * momentum indicators, and full intelligence reports.
 *
 * Routes:
 *   GET  /api/v1/intelligence                    — Full intelligence report
 *   GET  /api/v1/intelligence/consensus           — Active consensus signals
 *   GET  /api/v1/intelligence/contrarians         — Contrarian alerts
 *   GET  /api/v1/intelligence/momentum            — Collective momentum indicator
 *   GET  /api/v1/intelligence/swarm               — Swarm predictions for top stocks
 *   GET  /api/v1/intelligence/swarm/:symbol       — Swarm prediction for a stock
 *   GET  /api/v1/intelligence/agreement           — Agent agreement matrix
 *   GET  /api/v1/intelligence/hive-mind           — Hive mind score summary
 */

import { Hono } from "hono";
import {
  generateIntelligenceReport,
  detectConsensus,
  detectContrarians,
  calculateCollectiveMomentum,
  generateSwarmPredictions,
  calculateAgreementMatrix,
} from "../services/agent-intelligence.ts";
import { countByCondition } from "../lib/math-utils.ts";
import { apiError } from "../lib/errors.ts";
import { parseQueryInt } from "../lib/query-params.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Hive Mind Score Calculation Weights
 *
 * These constants control how different intelligence factors are weighted
 * when computing the overall hive mind coherence score (0-100).
 * Weights should sum to 1.0 for balanced scoring.
 */

/**
 * Weight factor for consensus strength in hive mind score calculation.
 * Set to 0.4 (40%) to prioritize agent agreement patterns.
 * Formula: hiveMindScore = consensusStrength * 0.4 + momentum * 0.3 + prediction * 0.3
 * Rationale: Consensus signals are primary indicator of hive mind alignment.
 */
const HIVE_MIND_CONSENSUS_WEIGHT = 0.4;

/**
 * Weight factor for momentum alignment in hive mind score calculation.
 * Set to 0.3 (30%) to balance directional agreement with consensus patterns.
 * Reflects collective bullish/bearish bias strength across all agents.
 */
const HIVE_MIND_MOMENTUM_WEIGHT = 0.3;

/**
 * Weight factor for prediction confidence in hive mind score calculation.
 * Set to 0.3 (30%) to balance forward-looking signals with current consensus.
 * Reflects swarm conviction in predicted outcomes.
 */
const HIVE_MIND_PREDICTION_WEIGHT = 0.3;

/**
 * Hive Mind State Classification Thresholds
 *
 * These constants define score ranges for classifying hive mind coherence
 * levels. Score ranges from 0 (complete disagreement) to 100 (perfect alignment).
 */

/**
 * Minimum score for "Strong Alignment" classification.
 * Set to 70 so score > 70 indicates highly cohesive agent thinking.
 * Example: Strong consensus + high momentum + confident predictions = >70 score.
 */
const HIVE_MIND_STRONG_ALIGNMENT_THRESHOLD = 70;

/**
 * Minimum score for "Moderate Consensus" classification.
 * Set to 50 so score 50-70 indicates partial agreement across agents.
 * Example: Some consensus signals but mixed momentum or lower confidence.
 */
const HIVE_MIND_MODERATE_CONSENSUS_THRESHOLD = 50;

/**
 * Minimum score for "Divergent Views" classification.
 * Set to 30 so score 30-50 indicates substantial agent disagreement.
 * Below 30 is "Complete Disagreement" (no meaningful hive mind coherence).
 */
const HIVE_MIND_DIVERGENT_VIEWS_THRESHOLD = 30;

/**
 * Swarm Prediction High Confidence Threshold
 *
 * Minimum probability (%) required to classify a swarm prediction as
 * "high confidence" worthy of elevated attention in API responses.
 */

/**
 * Threshold for filtering high-confidence swarm predictions.
 * Set to 70% so predictions > 70% probability are highlighted.
 * Example: If swarm predicts NVDA up with 75% probability, it's high-confidence.
 * Rationale: 70%+ indicates strong agent consensus on predicted direction.
 */
const SWARM_HIGH_CONFIDENCE_THRESHOLD = 70;

export const intelligenceRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET /intelligence — Full intelligence report
// ---------------------------------------------------------------------------

intelligenceRoutes.get("/", async (c) => {
  const report = await generateIntelligenceReport();
  return c.json({ ok: true, data: report });
});

// ---------------------------------------------------------------------------
// GET /intelligence/consensus — Active consensus signals
// ---------------------------------------------------------------------------

intelligenceRoutes.get("/consensus", async (c) => {
  const signals = await detectConsensus();
  const minScore = parseQueryInt(c.req.query("minScore"), 0, 0, 100);

  const filtered =
    minScore > 0 ? signals.filter((s) => s.swarmScore >= minScore) : signals;

  return c.json({
    ok: true,
    data: {
      signals: filtered,
      total: filtered.length,
      strongConsensus: countByCondition(filtered, (s) => s.swarmScore > 60),
      unanimousSignals: filtered.filter(
        (s) => s.agentsAgreeing === s.totalAgents,
      ).length,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /intelligence/contrarians — Contrarian alerts
// ---------------------------------------------------------------------------

intelligenceRoutes.get("/contrarians", async (c) => {
  const alerts = await detectContrarians();

  return c.json({
    ok: true,
    data: {
      alerts,
      total: alerts.length,
      insight:
        alerts.length > 0
          ? `${alerts.length} contrarian signal(s) detected — one or more agents disagree with the majority`
          : "No contrarian signals — agents are mostly in agreement",
    },
  });
});

// ---------------------------------------------------------------------------
// GET /intelligence/momentum — Collective momentum
// ---------------------------------------------------------------------------

intelligenceRoutes.get("/momentum", async (c) => {
  const momentum = await calculateCollectiveMomentum();

  return c.json({
    ok: true,
    data: {
      ...momentum,
      interpretation: {
        mood: `The AI agent collective is currently ${momentum.overallMood.replace("_", " ")}`,
        score: `Momentum score: ${momentum.momentumScore > 0 ? "+" : ""}${momentum.momentumScore}/100`,
        shift: `Market mood is ${momentum.moodShift.replace("_", " ")}`,
        topBullish: momentum.symbolMomentum
          .filter((s) => s.momentum === "bullish")
          .map((s) => s.symbol),
        topBearish: momentum.symbolMomentum
          .filter((s) => s.momentum === "bearish")
          .map((s) => s.symbol),
      },
    },
  });
});

// ---------------------------------------------------------------------------
// GET /intelligence/swarm — Swarm predictions
// ---------------------------------------------------------------------------

intelligenceRoutes.get("/swarm", async (c) => {
  const predictions = await generateSwarmPredictions();

  return c.json({
    ok: true,
    data: {
      predictions,
      highConfidence: predictions.filter((p) => p.probability > SWARM_HIGH_CONFIDENCE_THRESHOLD),
      totalPredictions: predictions.length,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /intelligence/swarm/:symbol — Single stock swarm prediction
// ---------------------------------------------------------------------------

intelligenceRoutes.get("/swarm/:symbol", async (c) => {
  const symbol = c.req.param("symbol");
  const predictions = await generateSwarmPredictions();
  const prediction = predictions.find(
    (p) => p.symbol.toLowerCase() === symbol.toLowerCase(),
  );

  if (!prediction) {
    return apiError(c, "SWARM_PREDICTION_NOT_FOUND", `No swarm prediction available for ${symbol}`);
  }

  return c.json({ ok: true, data: prediction });
});

// ---------------------------------------------------------------------------
// GET /intelligence/agreement — Agent agreement matrix
// ---------------------------------------------------------------------------

intelligenceRoutes.get("/agreement", async (c) => {
  const matrix = await calculateAgreementMatrix();

  // Find most and least agreeable pairs
  const sorted = [...matrix].sort(
    (a, b) => b.agreementRate - a.agreementRate,
  );
  const mostAgreeable = sorted[0] ?? null;
  const leastAgreeable = sorted[sorted.length - 1] ?? null;

  return c.json({
    ok: true,
    data: {
      pairs: matrix,
      totalPairs: matrix.length,
      summary: {
        averageAgreement: matrix.length > 0
          ? Math.round(
              matrix.reduce((s, p) => s + p.agreementRate, 0) / matrix.length,
            )
          : 0,
        mostAgreeable: mostAgreeable
          ? {
              agents: `${mostAgreeable.agentA.name} & ${mostAgreeable.agentB.name}`,
              rate: mostAgreeable.agreementRate,
            }
          : null,
        leastAgreeable: leastAgreeable
          ? {
              agents: `${leastAgreeable.agentA.name} & ${leastAgreeable.agentB.name}`,
              rate: leastAgreeable.agreementRate,
            }
          : null,
      },
    },
  });
});

// ---------------------------------------------------------------------------
// GET /intelligence/hive-mind — Hive mind summary score
// ---------------------------------------------------------------------------

intelligenceRoutes.get("/hive-mind", async (c) => {
  const [consensus, momentum, predictions] = await Promise.all([
    detectConsensus(),
    calculateCollectiveMomentum(),
    generateSwarmPredictions(),
  ]);

  // Calculate hive mind coherence score (how aligned are the agents?)
  const consensusStrength =
    consensus.length > 0
      ? consensus.reduce((s, c) => s + c.swarmScore, 0) / consensus.length
      : 0;

  const momentumAlignment = Math.abs(momentum.momentumScore);
  const predictionConfidence =
    predictions.length > 0
      ? predictions.reduce((s, p) => s + p.probability, 0) / predictions.length
      : 50;

  const hiveMindScore = Math.round(
    consensusStrength * HIVE_MIND_CONSENSUS_WEIGHT +
      momentumAlignment * HIVE_MIND_MOMENTUM_WEIGHT +
      predictionConfidence * HIVE_MIND_PREDICTION_WEIGHT,
  );

  let hiveMindState: string;
  if (hiveMindScore > HIVE_MIND_STRONG_ALIGNMENT_THRESHOLD) hiveMindState = "Strong Alignment";
  else if (hiveMindScore > HIVE_MIND_MODERATE_CONSENSUS_THRESHOLD) hiveMindState = "Moderate Consensus";
  else if (hiveMindScore > HIVE_MIND_DIVERGENT_VIEWS_THRESHOLD) hiveMindState = "Divergent Views";
  else hiveMindState = "Complete Disagreement";

  return c.json({
    ok: true,
    data: {
      hiveMindScore,
      state: hiveMindState,
      consensusStrength: Math.round(consensusStrength),
      momentumAlignment,
      predictionConfidence: Math.round(predictionConfidence),
      topConsensus:
        consensus.length > 0
          ? {
              symbol: consensus[0].symbol,
              direction: consensus[0].direction,
              score: consensus[0].swarmScore,
            }
          : null,
      marketMood: momentum.overallMood,
      timestamp: new Date().toISOString(),
    },
  });
});
