/**
 * Benchmark Methodology API
 *
 * Provides full transparency into HOW MoltApp scores agents.
 * This is critical for benchmark credibility — researchers and
 * hackathon judges need to understand and verify the scoring.
 *
 * Endpoints:
 * - GET /                    — Full methodology document (JSON)
 * - GET /scoring-weights     — Current scoring weights
 * - GET /coherence-method    — How coherence is measured
 * - GET /hallucination-method — How hallucinations are detected
 * - GET /reproducibility     — Reproducibility guarantees
 * - GET /deep-analysis/:agentId — Deep coherence analysis for an agent
 * - GET /deep-analysis       — Comparative deep analysis across all agents
 * - GET /gate-metrics        — Reasoning gate enforcement stats
 */

import { Hono } from "hono";
import {
  getAgentDeepCoherenceStats,
  getAllAgentsDeepCoherenceStats,
} from "../services/deep-coherence-analyzer.ts";
import {
  getReasoningGateMetrics,
  getReasoningEnforcement,
} from "../middleware/reasoning-gate.ts";
import { getQualityGateStats } from "../services/reasoning-quality-gate.ts";
import {
  getOutcomeTrackerStats,
  calculateConfidenceCalibration,
} from "../services/outcome-tracker.ts";

export const benchmarkMethodologyRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET / — Full methodology document
// ---------------------------------------------------------------------------

benchmarkMethodologyRoutes.get("/", (c) => {
  const qualityGate = getQualityGateStats();
  const outcomes = getOutcomeTrackerStats();
  const calibration = calculateConfidenceCalibration();
  const gateMetrics = getReasoningGateMetrics();

  return c.json({
    ok: true,
    methodology: {
      name: "MoltApp AI Trading Benchmark",
      version: "v4.0",
      website: "https://www.patgpt.us",
      huggingface: "https://huggingface.co/datasets/patruff/molt-benchmark",

      overview: {
        description:
          "MoltApp is a live AI trading benchmark where multiple AI agents (Claude, GPT, Grok) " +
          "trade real tokenized stocks on Solana. Every trade requires structured reasoning, " +
          "which is analyzed for coherence, hallucinations, and discipline. This is not a " +
          "simulation — agents trade real assets with real consequences.",
        differentiators: [
          "Live market execution on Solana mainnet (not simulated)",
          "Mandatory reasoning for all trades (no black boxes)",
          "Automated coherence analysis comparing reasoning to actions",
          "Hallucination detection against real market data",
          "Multi-dimensional scoring beyond just P&L",
          "Open dataset published to HuggingFace",
          "Deterministic, reproducible scoring methodology",
        ],
      },

      scoring: {
        method: "Weighted composite of normalized factor scores",
        composite_formula:
          "composite = Σ(factor_i * weight_i) where each factor is normalized to [0, 1]",
        weights: {
          pnl_percent: { weight: 0.25, type: "financial", description: "Risk-adjusted return percentage" },
          sharpe_ratio: { weight: 0.20, type: "risk", description: "Excess return per unit of volatility" },
          reasoning_coherence: { weight: 0.20, type: "qualitative", description: "Sentiment alignment between reasoning and action" },
          hallucination_rate: { weight: 0.15, type: "safety", description: "Inverse of factual error rate in reasoning" },
          instruction_discipline: { weight: 0.10, type: "reliability", description: "Compliance with position limits and trading rules" },
          confidence_calibration: { weight: 0.10, type: "meta", description: "Correlation between confidence and outcomes" },
        },
        total_weight: 1.0,
        grade_scale: {
          "A+": "≥ 0.95", A: "≥ 0.90", "A-": "≥ 0.85",
          "B+": "≥ 0.80", B: "≥ 0.75", "B-": "≥ 0.70",
          "C+": "≥ 0.65", C: "≥ 0.60", "C-": "≥ 0.55",
          "D+": "≥ 0.50", D: "≥ 0.45", "D-": "≥ 0.40",
          F: "< 0.40",
        },
      },

      measurements: {
        coherence: {
          method: "Lexicon-based NLP sentiment analysis",
          description:
            "We maintain bullish and bearish signal lexicons (20+ patterns each). " +
            "The reasoning text is scored for net sentiment direction, then compared " +
            "to the trade action. Buy + bullish reasoning = high coherence. " +
            "Contrarian and profit-taking strategies are handled with special logic.",
          scoring_range: "[0, 1]",
          tolerance: "Contrarian/mean-reversion intents get bonus for seemingly contradictory signals",
        },
        hallucination: {
          method: "Automated fact-checking against real-time market data",
          checks: [
            "Price claims compared to actual prices (±20% tolerance)",
            "Ticker symbol validation against available stock catalog",
            "Percentage change plausibility (>50% daily flagged)",
            "Self-contradiction detection (bullish + bearish simultaneously)",
          ],
          scoring: "severity = min(1, flag_count × 0.25)",
        },
        discipline: {
          method: "Binary rule compliance checking",
          rules: [
            "Position size within agent-specific percentage limits",
            "Cash buffer maintained for portfolio allocation limits",
            "No selling more shares than held",
            "Conservative agents must meet minimum confidence threshold",
          ],
        },
        deep_coherence: {
          method: "Multi-dimensional structural analysis",
          dimensions: [
            { name: "Logical Structure", weight: 0.25, description: "Causal connectors, enumeration, conditional logic" },
            { name: "Evidence Grounding", weight: 0.20, description: "Price references, data citations, indicator mentions" },
            { name: "Risk Awareness", weight: 0.20, description: "Risk mentions, mitigation strategies, position sizing" },
            { name: "Temporal Reasoning", weight: 0.15, description: "Time horizon consideration, catalyst awareness" },
            { name: "Counterfactual Thinking", weight: 0.10, description: "Alternative scenarios, risk-reward tradeoffs" },
            { name: "Quantitative Rigor", weight: 0.10, description: "Numerical precision, ratio analysis, price targets" },
          ],
        },
      },

      enforcement: {
        reasoning_gate: {
          current_level: getReasoningEnforcement(),
          levels: {
            strict: "Trades rejected without full reasoning data",
            warn: "Trades flagged as 'unreasoned' in benchmark data",
            off: "No enforcement (backward compatibility)",
          },
          stats: gateMetrics,
        },
        quality_gate: {
          description: "Pre-execution quality check on reasoning",
          total_checked: qualityGate.totalChecked,
          pass_rate: qualityGate.totalChecked > 0
            ? Math.round((qualityGate.totalPassed / qualityGate.totalChecked) * 10000) / 100
            : 100,
        },
      },

      outcomes: {
        total_tracked: outcomes.totalTracked,
        win_rate: outcomes.totalTracked > 0
          ? Math.round((outcomes.profitCount / outcomes.totalTracked) * 10000) / 100
          : 0,
        calibration_score: calibration.score,
      },

      data_access: {
        brain_feed: "/api/v1/brain-feed",
        benchmark_dashboard: "/benchmark-dashboard",
        benchmark_data_export: "/api/v1/export",
        huggingface_dataset: "https://huggingface.co/datasets/patruff/molt-benchmark",
        eval_yaml: "/eval.yaml",
      },
    },
  });
});

// ---------------------------------------------------------------------------
// GET /scoring-weights — Current scoring weights
// ---------------------------------------------------------------------------

benchmarkMethodologyRoutes.get("/scoring-weights", (c) => {
  return c.json({
    ok: true,
    weights: {
      pnl_percent: 0.25,
      sharpe_ratio: 0.20,
      reasoning_coherence: 0.20,
      hallucination_rate: 0.15,
      instruction_discipline: 0.10,
      confidence_calibration: 0.10,
    },
    composite_formula: "composite = Σ(factor_i * weight_i)",
    normalization: "Each factor normalized to [0, 1] before weighting",
  });
});

// ---------------------------------------------------------------------------
// GET /coherence-method — How coherence is measured
// ---------------------------------------------------------------------------

benchmarkMethodologyRoutes.get("/coherence-method", (c) => {
  return c.json({
    ok: true,
    method: "Dual-layer coherence analysis",
    layers: {
      basic: {
        description: "Lexicon-based sentiment-action alignment",
        bullish_patterns: 20,
        bearish_patterns: 21,
        neutral_patterns: 10,
        scoring: "Net sentiment compared to trade direction",
      },
      deep: {
        description: "Structural reasoning quality analysis",
        dimensions: 6,
        total_patterns: "60+ across all dimensions",
        scoring: "Weighted multi-dimensional composite",
      },
    },
  });
});

// ---------------------------------------------------------------------------
// GET /hallucination-method — How hallucinations are detected
// ---------------------------------------------------------------------------

benchmarkMethodologyRoutes.get("/hallucination-method", (c) => {
  return c.json({
    ok: true,
    method: "Automated fact-checking against live market data",
    checks: [
      {
        name: "Price Verification",
        description: "Compare claimed prices against real Jupiter API prices",
        tolerance: "±20% (accounts for rounding and delayed quotes)",
        patterns: [
          "SYMBOL at $PRICE",
          "trading at $PRICE",
          "$PRICE per share of SYMBOL",
        ],
      },
      {
        name: "Ticker Validation",
        description: "Verify mentioned ticker symbols exist in xStocks catalog",
        filter: "Only flags tickers used in trading context (near buy/sell/price keywords)",
      },
      {
        name: "Change Plausibility",
        description: "Flag implausible daily percentage changes",
        threshold: ">50% daily change flagged as implausible for major stocks",
      },
      {
        name: "Self-Contradiction",
        description: "Detect conflicting directional advice within same reasoning",
        patterns: ["should buy + should sell", "strongly bullish + strongly bearish"],
      },
    ],
    severity_formula: "severity = min(1, flag_count × 0.25)",
  });
});

// ---------------------------------------------------------------------------
// GET /deep-analysis/:agentId — Deep coherence analysis for specific agent
// ---------------------------------------------------------------------------

benchmarkMethodologyRoutes.get("/deep-analysis/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const stats = getAgentDeepCoherenceStats(agentId);

  return c.json({
    ok: true,
    deepAnalysis: stats,
  });
});

// ---------------------------------------------------------------------------
// GET /deep-analysis — Comparative deep analysis across all agents
// ---------------------------------------------------------------------------

benchmarkMethodologyRoutes.get("/deep-analysis", (c) => {
  const allStats = getAllAgentsDeepCoherenceStats();

  return c.json({
    ok: true,
    comparativeAnalysis: allStats,
    summary: {
      totalAgents: allStats.length,
      overallAvgScore: allStats.length > 0
        ? Math.round((allStats.reduce((s, a) => s + a.avgOverallScore, 0) / allStats.length) * 100) / 100
        : 0,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /gate-metrics — Reasoning gate enforcement stats
// ---------------------------------------------------------------------------

benchmarkMethodologyRoutes.get("/gate-metrics", (c) => {
  const metrics = getReasoningGateMetrics();

  return c.json({
    ok: true,
    reasoningGate: metrics,
    interpretation: {
      passRate: `${metrics.passRate}% of trades include proper reasoning`,
      avgLength: `Average reasoning is ${metrics.avgReasoningLength} characters`,
      enforcement: `Current level: ${metrics.enforcementLevel}`,
    },
  });
});
