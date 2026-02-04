/**
 * HuggingFace Sync — V33 Benchmark Dataset Upload
 *
 * Exports the full v33 benchmark dataset (26-dimension trade grades + agent
 * scores) to HuggingFace as JSONL. Designed to be called from heartbeat.ts
 * or run standalone.
 *
 * Dataset: patruff/molt-benchmark
 *
 * Files uploaded:
 *   data/v33-trade-grades.jsonl   — Individual trade quality assessments
 *   data/v33-agent-scores.jsonl   — Agent composite + dimension scores
 *   data/v33-round-summaries.jsonl — Round-level aggregate statistics
 */

import { uploadFile } from "@huggingface/hub";
import {
  getAgentScores,
  getTradeGrades,
  getRoundSummaries,
  getDimensionCount,
  getBenchmarkVersion,
} from "../src/services/v33-benchmark-engine.ts";

const HF_REPO = "patruff/molt-benchmark";

// ---------------------------------------------------------------------------
// Trade Grades → JSONL
// ---------------------------------------------------------------------------

function tradeGradesToJsonl(): string {
  const grades = getTradeGrades(5000);
  if (grades.length === 0) return "";

  const lines = grades.map((g) =>
    JSON.stringify({
      benchmark_version: getBenchmarkVersion(),
      dimension_count: getDimensionCount(),
      trade_id: g.tradeId,
      agent_id: g.agentId,
      symbol: g.symbol,
      action: g.action,
      reasoning: g.reasoning,
      confidence: g.confidence,
      intent: g.intent,
      sources: g.sources,
      coherence_score: g.coherenceScore,
      reasoning_depth: g.reasoningDepthScore,
      source_quality: g.sourceQualityScore,
      logical_consistency: g.logicalConsistencyScore,
      reasoning_integrity_hash: g.integrityHash,
      transparency_score: g.transparencyScore,
      accountability_score: g.accountabilityScore,
      grounding_score: g.groundingScore,
      consensus_quality_score: g.consensusQualityScore,
      causal_reasoning_score: g.causalReasoningScore,
      epistemic_humility_score: g.epistemicHumilityScore,
      hallucination_flags: g.hallucinationFlags,
      discipline_passed: g.disciplinePassed,
      predicted_outcome: g.predictedOutcome,
      actual_outcome: g.actualOutcome,
      outcome_resolved: g.outcomeResolved,
      overall_grade: g.overallGrade,
      graded_at: g.gradedAt,
    }),
  );

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Agent Scores → JSONL
// ---------------------------------------------------------------------------

function agentScoresToJsonl(): string {
  const scores = getAgentScores();
  if (scores.length === 0) return "";

  const lines = scores.map((s) =>
    JSON.stringify({
      benchmark_version: getBenchmarkVersion(),
      dimension_count: getDimensionCount(),
      agent_id: s.agentId,
      agent_name: s.agentName,
      provider: s.provider,
      model: s.model,
      composite_score: s.compositeScore,
      tier: s.tier,
      trade_count: s.tradeCount,
      rounds_played: s.roundsPlayed,
      dimensions: s.dimensions,
      last_updated: s.lastUpdated,
    }),
  );

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Round Summaries → JSONL
// ---------------------------------------------------------------------------

function roundSummariesToJsonl(): string {
  const rounds = getRoundSummaries(500);
  if (rounds.length === 0) return "";

  const lines = rounds.map((r) =>
    JSON.stringify({
      benchmark_version: getBenchmarkVersion(),
      dimension_count: getDimensionCount(),
      round_id: r.roundId,
      timestamp: r.timestamp,
      consensus_agreement: r.consensusAgreement,
      market_regime: r.marketRegime,
      avg_transparency: r.avgTransparency,
      avg_accountability: r.avgAccountability,
      avg_grounding: r.avgGrounding,
      avg_consensus_quality: r.avgConsensusQuality,
      avg_causal_reasoning: r.avgCausalReasoning,
      avg_epistemic_humility: r.avgEpistemicHumility,
      agent_scores: r.agentScores.map((a) => ({
        agent_id: a.agentId,
        composite_score: a.compositeScore,
        tier: a.tier,
      })),
      best_trade: r.bestTrade
        ? {
            trade_id: r.bestTrade.tradeId,
            agent_id: r.bestTrade.agentId,
            symbol: r.bestTrade.symbol,
            overall_grade: r.bestTrade.overallGrade,
          }
        : null,
      worst_trade: r.worstTrade
        ? {
            trade_id: r.worstTrade.tradeId,
            agent_id: r.worstTrade.agentId,
            symbol: r.worstTrade.symbol,
            overall_grade: r.worstTrade.overallGrade,
          }
        : null,
    }),
  );

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Upload to HuggingFace
// ---------------------------------------------------------------------------

export async function syncV33ToHuggingFace(): Promise<{
  uploaded: number;
  tradeGrades: number;
  agentScores: number;
  roundSummaries: number;
}> {
  const HF_TOKEN = process.env.HF_TOKEN;
  if (!HF_TOKEN) {
    console.log("[HF Sync v33] No HF_TOKEN set — skipping upload.");
    return { uploaded: 0, tradeGrades: 0, agentScores: 0, roundSummaries: 0 };
  }

  const repo = { type: "dataset" as const, name: HF_REPO };
  const credentials = { accessToken: HF_TOKEN };
  const commitTs = new Date().toISOString();

  let totalUploaded = 0;
  const stats = { uploaded: 0, tradeGrades: 0, agentScores: 0, roundSummaries: 0 };

  // Trade grades
  const tradesJsonl = tradeGradesToJsonl();
  if (tradesJsonl) {
    const tradeCount = tradesJsonl.trim().split("\n").length;
    await uploadFile({
      repo,
      credentials,
      file: {
        path: "data/v33-trade-grades.jsonl",
        content: new Blob([tradesJsonl]),
      },
      commitTitle: `v33 trade grades: ${tradeCount} records (${commitTs})`,
    });
    stats.tradeGrades = tradeCount;
    totalUploaded += tradeCount;
    console.log(`[HF Sync v33] Uploaded ${tradeCount} trade grades.`);
  }

  // Agent scores
  const scoresJsonl = agentScoresToJsonl();
  if (scoresJsonl) {
    const scoreCount = scoresJsonl.trim().split("\n").length;
    await uploadFile({
      repo,
      credentials,
      file: {
        path: "data/v33-agent-scores.jsonl",
        content: new Blob([scoresJsonl]),
      },
      commitTitle: `v33 agent scores: ${scoreCount} agents (${commitTs})`,
    });
    stats.agentScores = scoreCount;
    totalUploaded += scoreCount;
    console.log(`[HF Sync v33] Uploaded ${scoreCount} agent scores.`);
  }

  // Round summaries
  const roundsJsonl = roundSummariesToJsonl();
  if (roundsJsonl) {
    const roundCount = roundsJsonl.trim().split("\n").length;
    await uploadFile({
      repo,
      credentials,
      file: {
        path: "data/v33-round-summaries.jsonl",
        content: new Blob([roundsJsonl]),
      },
      commitTitle: `v33 round summaries: ${roundCount} rounds (${commitTs})`,
    });
    stats.roundSummaries = roundCount;
    totalUploaded += roundCount;
    console.log(`[HF Sync v33] Uploaded ${roundCount} round summaries.`);
  }

  stats.uploaded = totalUploaded;
  console.log(`[HF Sync v33] Total: ${totalUploaded} records uploaded to ${HF_REPO}`);
  return stats;
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  syncV33ToHuggingFace()
    .then((stats) => {
      console.log("[HF Sync v33] Complete:", JSON.stringify(stats));
      process.exit(0);
    })
    .catch((err) => {
      console.error("[HF Sync v33] Failed:", err);
      process.exit(1);
    });
}
