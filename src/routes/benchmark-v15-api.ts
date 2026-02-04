/**
 * Benchmark v15 API — Researcher-Facing Endpoints
 *
 * Exposes the new v15 pillar data for researchers:
 * - Reasoning provenance chains and verification
 * - Cross-model comparison fingerprints and divergence
 * - Reproducibility proofs and artifact export
 *
 * Routes:
 * - GET  /provenance/:agentId       — Reasoning provenance chain for an agent
 * - GET  /provenance                — Aggregate provenance stats
 * - POST /provenance/verify         — Verify a reasoning proof
 * - GET  /reproducibility/:roundId  — Reproducibility artifact for a round
 * - GET  /reproducibility           — Overall reproducibility report
 * - GET  /reproducibility/export    — Export full reproducibility artifact
 * - GET  /fingerprint/:agentId      — Model reasoning fingerprint
 * - GET  /divergence                — Cross-model divergence report
 * - GET  /cross-model               — Cross-model comparison stats
 * - GET  /schema                    — v15 benchmark schema documentation
 */

import { Hono } from "hono";
import {
  getProvenanceChain,
  getProvenanceStats,
  buildReproducibilityArtifact,
  verifyProof,
} from "../services/reasoning-provenance-engine.ts";
import {
  computeModelFingerprint,
  getModelDivergenceReport,
  getCrossModelStats,
} from "../services/cross-model-comparator.ts";
import {
  getReproducibilityReport,
  exportReproducibilityArtifact,
} from "../services/benchmark-reproducibility-prover.ts";

export const benchmarkV15ApiRoutes = new Hono();

// ---------------------------------------------------------------------------
// Reasoning Provenance
// ---------------------------------------------------------------------------

/**
 * GET /provenance/:agentId — Reasoning provenance chain for an agent
 */
benchmarkV15ApiRoutes.get("/provenance/:agentId", async (c) => {
  try {
    const agentId = c.req.param("agentId");
    const chain = getProvenanceChain(agentId);
    return c.json({ ok: true, agentId, chain });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message ?? String(err) }, 500);
  }
});

/**
 * GET /provenance — Aggregate provenance stats
 */
benchmarkV15ApiRoutes.get("/provenance", async (c) => {
  try {
    const stats = getProvenanceStats();
    return c.json({ ok: true, stats });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message ?? String(err) }, 500);
  }
});

/**
 * POST /provenance/verify — Verify a reasoning proof
 */
benchmarkV15ApiRoutes.post("/provenance/verify", async (c) => {
  try {
    const body = await c.req.json();
    const verification = verifyProof(body);
    return c.json({ ok: true, verification });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message ?? String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// Reproducibility
// ---------------------------------------------------------------------------

/**
 * GET /reproducibility/export — Export full reproducibility artifact
 * (must be registered before the :roundId param route)
 */
benchmarkV15ApiRoutes.get("/reproducibility/export", async (c) => {
  try {
    const artifact = exportReproducibilityArtifact();
    return c.json(artifact);
  } catch (err: any) {
    return c.json({ ok: false, error: err.message ?? String(err) }, 500);
  }
});

/**
 * GET /reproducibility/:roundId — Reproducibility artifact for a round
 */
benchmarkV15ApiRoutes.get("/reproducibility/:roundId", async (c) => {
  try {
    const roundId = c.req.param("roundId");
    const artifact = buildReproducibilityArtifact(roundId);
    return c.json({ ok: true, roundId, artifact });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message ?? String(err) }, 500);
  }
});

/**
 * GET /reproducibility — Overall reproducibility report
 */
benchmarkV15ApiRoutes.get("/reproducibility", async (c) => {
  try {
    const report = getReproducibilityReport();
    return c.json({ ok: true, report });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message ?? String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// Cross-Model Comparison
// ---------------------------------------------------------------------------

/**
 * GET /fingerprint/:agentId — Model reasoning fingerprint
 */
benchmarkV15ApiRoutes.get("/fingerprint/:agentId", async (c) => {
  try {
    const agentId = c.req.param("agentId");
    const fingerprint = computeModelFingerprint(agentId);
    return c.json({ ok: true, agentId, fingerprint });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message ?? String(err) }, 500);
  }
});

/**
 * GET /divergence — Cross-model divergence report
 */
benchmarkV15ApiRoutes.get("/divergence", async (c) => {
  try {
    const report = getModelDivergenceReport();
    return c.json({ ok: true, report });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message ?? String(err) }, 500);
  }
});

/**
 * GET /cross-model — Cross-model comparison stats
 */
benchmarkV15ApiRoutes.get("/cross-model", async (c) => {
  try {
    const stats = getCrossModelStats();
    return c.json({ ok: true, stats });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message ?? String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// Schema Documentation
// ---------------------------------------------------------------------------

/**
 * GET /schema — v15 benchmark schema documentation
 */
benchmarkV15ApiRoutes.get("/schema", (c) => {
  return c.json({
    ok: true,
    benchmark: "moltapp-v15",
    version: "15.0.0",
    description:
      "MoltApp AI Trading Benchmark v15 — 12-Pillar Evaluation with Reasoning Provenance & Reproducibility",
    pillars: [
      {
        id: "financial",
        name: "Financial Performance",
        weight: 0.13,
        metrics: ["pnl_percent", "sharpe_ratio", "win_rate", "max_drawdown"],
        description: "Raw trading performance: did the agent make money?",
      },
      {
        id: "reasoning",
        name: "Reasoning Quality",
        weight: 0.12,
        metrics: ["coherence", "depth", "consistency"],
        description: "Does the reasoning logically support the trade action?",
      },
      {
        id: "safety",
        name: "Safety & Compliance",
        weight: 0.10,
        metrics: ["hallucination_free_rate", "discipline_rate"],
        description: "Does the agent fabricate data or violate rules?",
      },
      {
        id: "calibration",
        name: "Confidence Calibration",
        weight: 0.09,
        metrics: ["ece", "brier_score", "monotonic_quartiles"],
        description: "Does the agent's confidence predict outcome quality?",
      },
      {
        id: "patterns",
        name: "Reasoning Patterns",
        weight: 0.06,
        metrics: ["fallacy_detection", "vocabulary_sophistication", "template_avoidance"],
        description: "Does the agent use sophisticated, non-templated reasoning?",
      },
      {
        id: "adaptability",
        name: "Market Adaptability",
        weight: 0.06,
        metrics: ["cross_regime_consistency", "regime_accuracy"],
        description: "Does the agent perform across different market conditions?",
      },
      {
        id: "forensic_quality",
        name: "Forensic Quality",
        weight: 0.08,
        metrics: ["structure", "originality", "clarity", "integrity"],
        description: "Deep structural analysis of reasoning quality.",
      },
      {
        id: "validation_quality",
        name: "Validation Quality",
        weight: 0.08,
        metrics: ["depth", "sources", "grounding", "risk_awareness"],
        description: "Does the reasoning reference real data and consider risks?",
      },
      {
        id: "prediction_accuracy",
        name: "Prediction Accuracy",
        weight: 0.07,
        metrics: ["direction_accuracy", "target_precision", "resolution_quality"],
        description: "Do the agent's forward-looking predictions come true?",
      },
      {
        id: "reasoning_stability",
        name: "Reasoning Stability",
        weight: 0.06,
        metrics: ["sentiment_volatility", "confidence_volatility", "intent_drift", "conviction_flip_rate"],
        description: "Is the agent's reasoning consistent across rounds?",
      },
      {
        id: "prediction_provenance",
        name: "Prediction Provenance",
        weight: 0.08,
        metrics: ["chain_completeness", "proof_validity", "artifact_reproducibility"],
        description: "Can the full reasoning chain be traced and independently verified?",
        newInV15: true,
      },
      {
        id: "model_comparison",
        name: "Model Comparison",
        weight: 0.07,
        metrics: ["fingerprint_uniqueness", "divergence_score", "cross_model_rank"],
        description: "How does the agent's reasoning style compare to other models?",
        newInV15: true,
      },
    ],
    endpoints: {
      dashboard: "/benchmark-v15",
      data: "/benchmark-v15/data",
      stream: "/benchmark-v15/stream",
      provenance: "/api/v1/benchmark-v15/provenance/:agentId",
      provenanceStats: "/api/v1/benchmark-v15/provenance",
      provenanceVerify: "/api/v1/benchmark-v15/provenance/verify",
      reproducibility: "/api/v1/benchmark-v15/reproducibility/:roundId",
      reproducibilityReport: "/api/v1/benchmark-v15/reproducibility",
      reproducibilityExport: "/api/v1/benchmark-v15/reproducibility/export",
      fingerprint: "/api/v1/benchmark-v15/fingerprint/:agentId",
      divergence: "/api/v1/benchmark-v15/divergence",
      crossModel: "/api/v1/benchmark-v15/cross-model",
    },
    huggingface: "https://huggingface.co/datasets/patruff/molt-benchmark",
    website: "https://www.patgpt.us",
  });
});
