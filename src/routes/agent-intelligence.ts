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
  const minScore = parseInt(c.req.query("minScore") ?? "0", 10);

  const filtered =
    minScore > 0 ? signals.filter((s) => s.swarmScore >= minScore) : signals;

  return c.json({
    ok: true,
    data: {
      signals: filtered,
      total: filtered.length,
      strongConsensus: filtered.filter((s) => s.swarmScore > 60).length,
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
      highConfidence: predictions.filter((p) => p.probability > 70),
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
    return c.json(
      { ok: false, error: `No swarm prediction available for ${symbol}` },
      404,
    );
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
    consensusStrength * 0.4 +
      momentumAlignment * 0.3 +
      predictionConfidence * 0.3,
  );

  let hiveMindState: string;
  if (hiveMindScore > 70) hiveMindState = "Strong Alignment";
  else if (hiveMindScore > 50) hiveMindState = "Moderate Consensus";
  else if (hiveMindScore > 30) hiveMindState = "Divergent Views";
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
