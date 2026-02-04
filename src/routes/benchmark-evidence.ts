/**
 * Benchmark Evidence API
 *
 * Exposes the evidence collector's data for researchers and dashboards.
 *
 * GET /api/v1/evidence/snapshot  — Full benchmark snapshot (all agents)
 * GET /api/v1/evidence/profiles  — Agent benchmark profiles
 * GET /api/v1/evidence/:agentId  — Specific agent evidence + profile
 */

import { Hono } from "hono";
import {
  generateBenchmarkSnapshot,
  buildAgentProfile,
  getAgentEvidence,
} from "../services/benchmark-evidence-collector.ts";

export const benchmarkEvidenceRoutes = new Hono();

/**
 * GET /snapshot — Full benchmark snapshot for all agents.
 * This is the canonical data structure for the HuggingFace dataset.
 */
benchmarkEvidenceRoutes.get("/snapshot", (c) => {
  const snapshot = generateBenchmarkSnapshot();
  return c.json({
    ok: true,
    ...snapshot,
  });
});

/**
 * GET /profiles — Benchmark profiles for all known agents.
 * Lighter than the full snapshot — just the computed metrics.
 */
benchmarkEvidenceRoutes.get("/profiles", (c) => {
  const snapshot = generateBenchmarkSnapshot();
  const profiles = snapshot.agents.map((a) => ({
    agentId: a.agentId,
    totalTrades: a.totalTrades,
    totalRounds: a.totalRounds,
    cumulativePnl: a.cumulativePnl,
    sharpeRatio: a.sharpeRatio,
    maxDrawdown: a.maxDrawdown,
    winRate: a.winRate,
    avgCoherence: a.avgCoherence,
    hallucinationRate: a.hallucinationRate,
    disciplineRate: a.disciplineRate,
    calibrationScore: a.calibrationScore,
    lastUpdated: a.lastUpdated,
  }));

  return c.json({
    ok: true,
    profiles,
    totalAgents: profiles.length,
  });
});

/**
 * GET /:agentId — Full evidence and profile for a specific agent.
 * Includes the raw trade evidence and the computed profile.
 */
benchmarkEvidenceRoutes.get("/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const profile = buildAgentProfile(agentId);
  const evidence = getAgentEvidence(agentId);

  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 200);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);

  const paginatedEvidence = evidence.slice(offset, offset + limit).map((e) => ({
    tradeId: e.tradeId,
    roundId: e.roundId,
    timestamp: e.timestamp,
    action: e.action,
    symbol: e.symbol,
    quantity: e.quantity,
    confidence: e.confidence,
    intent: e.intent,
    reasoning: e.reasoning.slice(0, 300),
    coherenceScore: e.coherence.score,
    coherenceExplanation: e.coherence.explanation,
    hallucinationCount: e.hallucinations.flags.length,
    hallucinationFlags: e.hallucinations.flags,
    disciplinePassed: e.discipline.passed,
    pnlPercent: e.pnlPercent,
    outcomeCorrect: e.outcomeCorrect,
  }));

  return c.json({
    ok: true,
    agentId,
    profile,
    evidence: paginatedEvidence,
    totalEvidence: evidence.length,
    limit,
    offset,
  });
});
