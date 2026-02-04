/**
 * Benchmark Research API
 *
 * Structured endpoints for academic researchers and benchmark evaluators.
 * Provides reproducible queries, statistical comparisons, and
 * downloadable datasets in standard formats.
 *
 * This is what makes MoltApp a REAL benchmark vs just another leaderboard:
 * - Reproducibility proofs
 * - Statistical significance tests
 * - Bootstrap confidence intervals
 * - Regime-aware analysis
 * - Peer review aggregates
 * - Reasoning depth profiles
 *
 * Routes:
 * - GET /methodology — Full benchmark methodology documentation
 * - GET /agents — Agent profiles with statistical summaries
 * - GET /compare — Pairwise agent comparison with p-values
 * - GET /stability — Benchmark stability assessment
 * - GET /regime — Market regime analysis
 * - GET /depth — Reasoning depth comparison
 * - GET /peer-review — Peer review leaderboard and details
 * - GET /reproducibility — Reproducibility proofs
 * - GET /dataset — Download benchmark dataset (JSONL)
 */

import { Hono } from "hono";
import {
  compareAgents,
  compareAllAgents,
  assessBenchmarkStability,
  getAgentBootstrapCI,
  getAgentScoreHistory,
  getBenchmarkStats,
  generateReproducibilityProof,
  verifyProof,
} from "../services/benchmark-reproducibility.ts";
import {
  getAgentDepthProfile,
  getDepthComparison,
} from "../services/reasoning-depth.ts";
import {
  getAgentRegimeProfile,
  generateRegimeReport,
  getRegimeHistory,
} from "../services/regime-reasoning.ts";
import {
  getAgentPeerReviewSummary,
  getPeerReviewLeaderboard,
  getRecentPeerReviews,
  getRoundPeerReview,
} from "../services/peer-review.ts";
import { getAgentConfigs } from "../agents/orchestrator.ts";

export const benchmarkResearchRoutes = new Hono();

// ---------------------------------------------------------------------------
// Methodology
// ---------------------------------------------------------------------------

/**
 * GET /methodology — Full benchmark methodology documentation
 */
benchmarkResearchRoutes.get("/methodology", (c) => {
  return c.json({
    ok: true,
    methodology: {
      name: "MoltApp: Agentic Stock Trading Benchmark",
      version: "3.0.0",
      website: "https://www.patgpt.us",
      huggingface: "https://huggingface.co/datasets/patruff/molt-benchmark",

      overview: "MoltApp evaluates AI agents on live stock trading with full reasoning transparency. " +
        "Unlike static benchmarks, MoltApp tests agents across real market conditions with real financial consequences.",

      scoringPillars: [
        {
          name: "Reasoning Coherence",
          weight: 0.20,
          method: "NLP-based sentiment analysis of reasoning text vs trade action alignment",
          scale: "0.0 (contradictory) to 1.0 (perfectly coherent)",
        },
        {
          name: "Reasoning Depth",
          weight: 0.15,
          method: "Multi-dimensional analysis of reasoning sophistication: causal depth, uncertainty modeling, " +
            "temporal awareness, counterfactual reasoning, cross-asset awareness, vocabulary sophistication",
          scale: "0.0 (shallow) to 1.0 (expert-level)",
        },
        {
          name: "Hallucination Rate",
          weight: 0.15,
          method: "Automated fact-checking: price claims vs reality (±20% tolerance), ticker validation, " +
            "percentage plausibility, self-contradiction detection",
          scale: "0.0 (no hallucinations) to 1.0 (fully fabricated)",
          note: "Lower is better",
        },
        {
          name: "Instruction Discipline",
          weight: 0.10,
          method: "Binary pass/fail per trade against agent-specific rules: position limits, cash buffers, " +
            "allowed symbols, confidence thresholds",
          scale: "0.0 (all violations) to 1.0 (perfect compliance)",
        },
        {
          name: "Confidence Calibration",
          weight: 0.10,
          method: "Bucket analysis: monotonic increase in win rate across confidence quartiles",
          scale: "-1.0 (inversely calibrated) to 1.0 (perfectly calibrated)",
        },
        {
          name: "P&L / Sharpe Ratio",
          weight: 0.20,
          method: "Financial performance: raw returns and risk-adjusted returns",
          scale: "Unbounded (higher is better)",
        },
        {
          name: "Peer Review Score",
          weight: 0.10,
          method: "Automated cross-agent critique: logic quality, evidence usage, risk awareness, originality",
          scale: "0.0 to 1.0",
        },
      ],

      statisticalMethods: {
        agentComparison: "Welch's t-test (unequal variances) with Cohen's d effect size",
        confidenceIntervals: "Bootstrap resampling (1000 iterations) for 95% and 99% CI",
        reproducibility: "SHA-256 hash of all scoring inputs + outputs for verification",
        stability: "Rolling window variance analysis with minimum sample size requirements",
        regimeAnalysis: "Market regime detection (bull/bear × calm/volatile) with per-regime scoring",
      },

      agents: getAgentConfigs().map((a) => ({
        id: a.agentId,
        name: a.name,
        model: a.model,
        provider: a.provider,
        style: a.tradingStyle,
      })),

      dataAvailability: {
        realTimeStream: "/api/v1/benchmark-stream",
        jsonlExport: "/api/v1/research/dataset",
        huggingface: "patruff/molt-benchmark",
        brainFeed: "/api/v1/brain-feed",
      },

      citation: `@misc{moltapp2026,\n  title={MoltApp: An Agentic Stock Trading Benchmark},\n  author={MoltApp Team},\n  year={2026},\n  url={https://www.patgpt.us}\n}`,
    },
  });
});

// ---------------------------------------------------------------------------
// Agent Profiles
// ---------------------------------------------------------------------------

/**
 * GET /agents — Agent profiles with statistical summaries
 */
benchmarkResearchRoutes.get("/agents", (c) => {
  const agents = getAgentConfigs();

  const profiles = agents.map((agent) => {
    const scoreHistory = getAgentScoreHistory(agent.agentId);
    const bootstrapCI = getAgentBootstrapCI(agent.agentId);
    const depthProfile = getAgentDepthProfile(agent.agentId);
    const regimeProfile = getAgentRegimeProfile(agent.agentId);
    const peerReview = getAgentPeerReviewSummary(agent.agentId);

    return {
      config: agent,
      benchmarkScores: {
        compositeScore: bootstrapCI.mean,
        confidenceInterval95: bootstrapCI.ci95,
        standardError: bootstrapCI.standardError,
        sampleSize: bootstrapCI.sampleSize,
      },
      reasoning: {
        depth: {
          avgDepth: depthProfile.avgDepth,
          classification: depthProfile.classification,
          trend: depthProfile.depthTrend,
          strongestDimension: depthProfile.strongestDimension,
          weakestDimension: depthProfile.weakestDimension,
        },
        peerReview: {
          avgScore: peerReview.avgPeerScore,
          agreementRate: peerReview.peerAgreementRate,
          totalReviews: peerReview.totalReviews,
          topStrength: peerReview.topStrength,
          topWeakness: peerReview.topWeakness,
        },
      },
      regime: {
        robustnessScore: regimeProfile.robustnessScore,
        bestRegime: regimeProfile.bestRegime,
        worstRegime: regimeProfile.worstRegime,
        adaptationSpeed: regimeProfile.adaptationSpeed,
      },
      recentScores: scoreHistory.slice(0, 5).map((s) => ({
        round: s.roundId,
        composite: s.composite,
        coherence: s.coherence,
        depth: s.depth,
        hallucinationRate: s.hallucinationRate,
      })),
    };
  });

  return c.json({
    ok: true,
    agents: profiles,
    totalAgents: profiles.length,
  });
});

// ---------------------------------------------------------------------------
// Agent Comparison
// ---------------------------------------------------------------------------

/**
 * GET /compare — Pairwise agent comparison with statistical tests
 *
 * Query params:
 *   agentA — first agent ID (optional, compares all if omitted)
 *   agentB — second agent ID (optional)
 */
benchmarkResearchRoutes.get("/compare", (c) => {
  const agentA = c.req.query("agentA");
  const agentB = c.req.query("agentB");

  if (agentA && agentB) {
    const comparison = compareAgents(agentA, agentB);
    return c.json({
      ok: true,
      comparison,
      interpretation: {
        significant: comparison.verdict.winner !== null,
        summary: comparison.verdict.winner
          ? `${comparison.verdict.winner} is statistically better (p < 0.05, ` +
            `effect size: ${comparison.tests.overallComposite.effectInterpretation})`
          : "No statistically significant difference between agents",
      },
    });
  }

  const allComparisons = compareAllAgents();
  return c.json({
    ok: true,
    comparisons: allComparisons,
    summary: {
      totalComparisons: allComparisons.length,
      significantDifferences: allComparisons.filter((c) => c.verdict.winner !== null).length,
    },
  });
});

// ---------------------------------------------------------------------------
// Stability
// ---------------------------------------------------------------------------

/**
 * GET /stability — Benchmark stability assessment
 */
benchmarkResearchRoutes.get("/stability", (c) => {
  const stability = assessBenchmarkStability();
  const stats = getBenchmarkStats();

  return c.json({
    ok: true,
    stability,
    stats,
    interpretation: {
      isReliable: stability.publicationReady,
      summary: stability.publicationReady
        ? "Benchmark has sufficient data for stable, publishable rankings"
        : `Need ${stability.minimumRoundsNeeded - stability.currentRounds} more rounds for stable rankings`,
    },
  });
});

// ---------------------------------------------------------------------------
// Regime Analysis
// ---------------------------------------------------------------------------

/**
 * GET /regime — Market regime analysis
 *
 * Query params:
 *   agent — specific agent ID (optional)
 */
benchmarkResearchRoutes.get("/regime", (c) => {
  const agentId = c.req.query("agent");

  if (agentId) {
    const profile = getAgentRegimeProfile(agentId);
    return c.json({
      ok: true,
      agentId,
      profile,
      regimeHistory: getRegimeHistory(20),
    });
  }

  const report = generateRegimeReport();
  return c.json({
    ok: true,
    report,
    interpretation: {
      currentRegime: report.currentRegime.regime,
      mostRobustAgent: report.mostRobust,
      regimeImpact: report.regimeImpact,
    },
  });
});

// ---------------------------------------------------------------------------
// Reasoning Depth
// ---------------------------------------------------------------------------

/**
 * GET /depth — Reasoning depth comparison
 *
 * Query params:
 *   agent — specific agent ID (optional)
 */
benchmarkResearchRoutes.get("/depth", (c) => {
  const agentId = c.req.query("agent");

  if (agentId) {
    const profile = getAgentDepthProfile(agentId);
    return c.json({ ok: true, agentId, profile });
  }

  const comparison = getDepthComparison();
  return c.json({
    ok: true,
    comparison,
    interpretation: {
      deepestAgent: comparison.deepestAgent,
      dimensionLeaders: comparison.dimensionLeaders,
    },
  });
});

// ---------------------------------------------------------------------------
// Peer Review
// ---------------------------------------------------------------------------

/**
 * GET /peer-review — Peer review leaderboard and details
 *
 * Query params:
 *   agent — specific agent ID (optional)
 *   round — specific round ID (optional)
 *   limit — number of recent reviews (default 20)
 */
benchmarkResearchRoutes.get("/peer-review", (c) => {
  const agentId = c.req.query("agent");
  const roundId = c.req.query("round");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10), 100);

  if (roundId) {
    const roundReview = getRoundPeerReview(roundId);
    if (!roundReview) {
      return c.json({ ok: false, error: `No peer review found for round ${roundId}` }, 404);
    }
    return c.json({ ok: true, roundReview });
  }

  if (agentId) {
    const summary = getAgentPeerReviewSummary(agentId);
    const recentReviews = getRecentPeerReviews(limit, agentId);
    return c.json({ ok: true, agentId, summary, recentReviews });
  }

  const leaderboard = getPeerReviewLeaderboard();
  const recentReviews = getRecentPeerReviews(limit);
  return c.json({
    ok: true,
    leaderboard,
    recentReviews,
  });
});

// ---------------------------------------------------------------------------
// Reproducibility
// ---------------------------------------------------------------------------

/**
 * GET /reproducibility — Generate or verify reproducibility proofs
 *
 * Query params:
 *   agent — agent ID to generate proof for
 *   verify — input hash to verify against
 */
benchmarkResearchRoutes.get("/reproducibility", (c) => {
  const agentId = c.req.query("agent");
  const verifyHash = c.req.query("verify");

  if (!agentId) {
    return c.json({
      ok: false,
      error: "agent query parameter is required",
      usage: "/api/v1/research/reproducibility?agent=claude-value-investor",
    }, 400);
  }

  if (verifyHash) {
    const result = verifyProof(agentId, verifyHash);
    return c.json({ ok: true, ...result });
  }

  const proof = generateReproducibilityProof(agentId);
  return c.json({
    ok: true,
    proof,
    howToVerify: `/api/v1/research/reproducibility?agent=${agentId}&verify=${proof.inputHash}`,
  });
});

// ---------------------------------------------------------------------------
// Dataset Export
// ---------------------------------------------------------------------------

/**
 * GET /dataset — Download benchmark dataset in JSONL format
 *
 * Query params:
 *   agent — filter by agent ID (optional)
 *   limit — max records (default 1000)
 *   format — "jsonl" (default) or "json"
 */
benchmarkResearchRoutes.get("/dataset", (c) => {
  const agentId = c.req.query("agent");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "1000", 10), 5000);
  const format = c.req.query("format") ?? "jsonl";

  const agents = getAgentConfigs();
  const allScores: Array<Record<string, unknown>> = [];

  for (const agent of agents) {
    if (agentId && agent.agentId !== agentId) continue;

    const scores = getAgentScoreHistory(agent.agentId, limit);
    const depth = getAgentDepthProfile(agent.agentId);
    const peerReview = getAgentPeerReviewSummary(agent.agentId);
    const regime = getAgentRegimeProfile(agent.agentId);

    for (const score of scores) {
      allScores.push({
        agent_id: agent.agentId,
        agent_provider: agent.provider,
        agent_model: agent.model,
        round_id: score.roundId,
        coherence: score.coherence,
        depth: score.depth,
        hallucination_rate: score.hallucinationRate,
        discipline: score.discipline,
        confidence: score.confidence,
        composite: score.composite,
        reasoning_depth_avg: depth.avgDepth,
        reasoning_classification: depth.classification,
        peer_review_score: peerReview.avgPeerScore,
        peer_agreement_rate: peerReview.peerAgreementRate,
        regime_robustness: regime.robustnessScore,
        timestamp: score.timestamp,
      });
    }
  }

  if (format === "json") {
    return c.json({
      ok: true,
      dataset: allScores,
      totalRecords: allScores.length,
      schema: {
        agent_id: "string",
        agent_provider: "string",
        agent_model: "string",
        round_id: "string",
        coherence: "float 0-1",
        depth: "float 0-1",
        hallucination_rate: "float 0-1",
        discipline: "float 0-1",
        confidence: "float 0-1",
        composite: "float 0-1",
      },
    });
  }

  // JSONL format
  const jsonl = allScores.map((r) => JSON.stringify(r)).join("\n");
  return new Response(jsonl, {
    headers: {
      "Content-Type": "application/jsonl",
      "Content-Disposition": `attachment; filename="moltapp-benchmark-${new Date().toISOString().split("T")[0]}.jsonl"`,
    },
  });
});
