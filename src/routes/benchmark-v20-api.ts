/**
 * Benchmark v20 API Routes
 *
 * Researcher-facing API for the 24-pillar benchmark. Provides structured
 * access to transparency reports, accountability tracking, and quality
 * certification data.
 *
 * Routes:
 *   GET /scores              — All agent scores with 24-pillar breakdown
 *   GET /score/:agentId      — Single agent score
 *   GET /transparency        — All transparency profiles
 *   GET /transparency/:id    — Agent transparency reports
 *   GET /accountability      — All accountability profiles
 *   GET /accountability/:id  — Agent accountability details
 *   GET /certification       — All certification profiles + stats
 *   GET /certification/:id   — Agent certificates
 *   GET /verify/:hash        — Verify a quality certificate by hash
 *   GET /health              — Benchmark health snapshot
 *   GET /weights             — Pillar weights configuration
 *   GET /schema              — Data schema for researchers
 *   GET /export/jsonl        — JSONL export of all v20 data
 *   GET /export/csv          — CSV export of leaderboard
 */

import { Hono } from "hono";
import {
  getV17Rankings,
  getV17Health,
} from "../services/benchmark-intelligence-gateway.ts";
import {
  getArbitrationPillarScore,
} from "../services/benchmark-arbitration-engine.ts";
import {
  getDebatePillarScore,
} from "../services/cross-agent-debate-engine.ts";
import {
  getImpactPillarScore,
} from "../services/trade-impact-forecaster.ts";
import {
  getAdversarialPillarScore,
} from "../services/adversarial-robustness-engine.ts";
import {
  getMemoryPillarScore,
} from "../services/cross-session-memory-analyzer.ts";
import {
  getAllTransparencyProfiles,
  getTransparencyPillarScore,
  getTransparencyReports,
  getTransparencyStats,
} from "../services/reasoning-transparency-engine.ts";
import {
  getAllAccountabilityProfiles,
  getAccountabilityPillarScore,
  getAccountabilityProfile,
  getAccountabilityStats,
} from "../services/decision-accountability-tracker.ts";
import {
  getAllCertificationProfiles,
  getCertificationPillarScore,
  getCertificationProfile,
  getCertificationStats,
  getRecentCertificates,
  verifyCertificate,
} from "../services/reasoning-quality-certifier.ts";
import { round2 } from "../lib/math-utils.ts";

export const benchmarkV20ApiRoutes = new Hono();

// ---------------------------------------------------------------------------
// v20 Weights
// ---------------------------------------------------------------------------

const V20_WEIGHTS: Record<string, number> = {
  financial: 0.08,
  reasoning: 0.07,
  safety: 0.06,
  calibration: 0.06,
  patterns: 0.03,
  adaptability: 0.04,
  forensic_quality: 0.05,
  validation_quality: 0.05,
  prediction_accuracy: 0.04,
  reasoning_stability: 0.04,
  provenance_integrity: 0.04,
  model_comparison: 0.03,
  metacognition: 0.04,
  reasoning_efficiency: 0.03,
  forensic_ledger: 0.03,
  strategy_genome: 0.03,
  adversarial_robustness: 0.04,
  cross_session_memory: 0.04,
  arbitration_quality: 0.04,
  debate_performance: 0.04,
  impact_forecasting: 0.04,
  reasoning_transparency: 0.05,
  decision_accountability: 0.05,
  quality_certification: 0.05,
};

function computeGrade(score: number): string {
  if (score >= 0.95) return "A+";
  if (score >= 0.90) return "A";
  if (score >= 0.85) return "A-";
  if (score >= 0.80) return "B+";
  if (score >= 0.75) return "B";
  if (score >= 0.70) return "B-";
  if (score >= 0.65) return "C+";
  if (score >= 0.60) return "C";
  if (score >= 0.55) return "C-";
  if (score >= 0.50) return "D+";
  if (score >= 0.45) return "D";
  if (score >= 0.40) return "D-";
  return "F";
}

interface V20Score {
  agentId: string;
  composite: number;
  grade: string;
  rank: number;
  pillars: Record<string, number>;
}

function computeAllScores(): V20Score[] {
  const rankings = getV17Rankings();
  const agentIds = rankings.length > 0
    ? rankings.map((r) => r.agentId)
    : ["claude-value-investor", "gpt-momentum-trader", "grok-contrarian"];

  const scores: V20Score[] = agentIds.map((agentId) => {
    const base = rankings.find((r) => r.agentId === agentId);
    const pillars: Record<string, number> = {};

    if (base) {
      for (const p of base.pillars ?? []) {
        pillars[p.name] = p.score;
      }
    }

    for (const key of Object.keys(V20_WEIGHTS)) {
      if (!(key in pillars)) pillars[key] = 0.5;
    }

    pillars.arbitration_quality = getArbitrationPillarScore(agentId);
    pillars.debate_performance = getDebatePillarScore(agentId);
    pillars.impact_forecasting = getImpactPillarScore(agentId);
    pillars.adversarial_robustness = getAdversarialPillarScore(agentId);
    pillars.cross_session_memory = getMemoryPillarScore(agentId);
    pillars.reasoning_transparency = getTransparencyPillarScore(agentId);
    pillars.decision_accountability = getAccountabilityPillarScore(agentId);
    pillars.quality_certification = getCertificationPillarScore(agentId);

    let composite = 0;
    for (const [pillar, weight] of Object.entries(V20_WEIGHTS)) {
      composite += (pillars[pillar] ?? 0.5) * weight;
    }

    return {
      agentId,
      composite: round2(composite),
      grade: computeGrade(composite),
      rank: 0,
      pillars,
    };
  });

  scores.sort((a, b) => b.composite - a.composite);
  scores.forEach((s, i) => { s.rank = i + 1; });

  return scores;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

benchmarkV20ApiRoutes.get("/scores", (c) => {
  const scores = computeAllScores();
  return c.json({
    ok: true,
    benchmark: "moltapp-v20",
    pillars: 24,
    leaderboard: scores,
    weights: V20_WEIGHTS,
    generatedAt: new Date().toISOString(),
  });
});

benchmarkV20ApiRoutes.get("/score/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const scores = computeAllScores();
  const score = scores.find((s) => s.agentId === agentId);
  if (!score) {
    return c.json({ ok: false, error: "Agent not found" }, 404);
  }
  return c.json({ ok: true, score });
});

benchmarkV20ApiRoutes.get("/transparency", (c) => {
  const profiles = getAllTransparencyProfiles();
  const stats = getTransparencyStats();
  return c.json({ ok: true, profiles, stats });
});

benchmarkV20ApiRoutes.get("/transparency/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const limit = parseInt(c.req.query("limit") ?? "20", 10);
  const reports = getTransparencyReports(agentId, limit);
  const pillarScore = getTransparencyPillarScore(agentId);
  return c.json({ ok: true, agentId, pillarScore, reports, total: reports.length });
});

benchmarkV20ApiRoutes.get("/accountability", (c) => {
  const profiles = getAllAccountabilityProfiles();
  const stats = getAccountabilityStats();
  return c.json({ ok: true, profiles, stats });
});

benchmarkV20ApiRoutes.get("/accountability/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const profile = getAccountabilityProfile(agentId);
  return c.json({ ok: true, profile });
});

benchmarkV20ApiRoutes.get("/certification", (c) => {
  const profiles = getAllCertificationProfiles();
  const stats = getCertificationStats();
  return c.json({ ok: true, profiles, stats });
});

benchmarkV20ApiRoutes.get("/certification/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const profile = getCertificationProfile(agentId);
  const recent = getRecentCertificates(agentId);
  return c.json({ ok: true, profile, recentCertificates: recent });
});

benchmarkV20ApiRoutes.get("/verify/:hash", (c) => {
  const hash = c.req.param("hash");
  const certificate = verifyCertificate(hash);
  if (!certificate) {
    return c.json({ ok: false, error: "Certificate not found", verified: false }, 404);
  }
  const isExpired = new Date(certificate.expiresAt) < new Date();
  return c.json({
    ok: true,
    verified: !isExpired,
    expired: isExpired,
    certificate,
  });
});

benchmarkV20ApiRoutes.get("/health", (c) => {
  const health = getV17Health();
  const transparencyStats = getTransparencyStats();
  const accountabilityStats = getAccountabilityStats();
  const certificationStats = getCertificationStats();
  return c.json({
    ok: true,
    benchmark: "moltapp-v20",
    pillars: 24,
    health,
    v20Health: {
      transparencyReports: transparencyStats.totalReports,
      claimsTracked: accountabilityStats.totalClaimsTracked,
      claimsResolved: accountabilityStats.totalResolved,
      certificatesIssued: certificationStats.totalCertificates,
      overallCertRate: certificationStats.overallCertRate,
    },
    timestamp: new Date().toISOString(),
  });
});

benchmarkV20ApiRoutes.get("/weights", (c) => {
  return c.json({
    ok: true,
    benchmark: "moltapp-v20",
    totalPillars: 24,
    weights: V20_WEIGHTS,
    newInV20: ["reasoning_transparency", "decision_accountability", "quality_certification"],
  });
});

benchmarkV20ApiRoutes.get("/schema", (c) => {
  return c.json({
    ok: true,
    benchmark: "moltapp-v20",
    dataSchema: {
      transparencyReport: {
        claims: "ExtractedClaim[] — factual claims with type, offset, verifiability",
        evidenceMap: "EvidenceLink[] — links between claims and data sources",
        logicChain: "LogicStep[] — premise→inference→conclusion flow",
        assumptions: "SurfacedAssumption[] — unstated assumptions detected",
        counterfactuals: "CounterfactualScenario[] — what would change the decision",
        transparencyScore: "number (0-1) — aggregate transparency quality",
      },
      accountabilityProfile: {
        totalClaims: "number — claims registered",
        resolvedClaims: "number — claims with outcomes",
        accuracyRate: "number (0-1) — correct / resolved",
        overconfidenceRate: "number (0-1) — high-confidence misses",
        byType: "Record<string, {total, correct, accuracy}>",
        bySymbol: "Record<string, {total, correct, accuracy}>",
        byConfidence: "Bucket analysis for calibration",
        learningTrend: "improving | stable | declining",
      },
      qualityCertificate: {
        certificateId: "string — unique ID",
        hash: "string — SHA-256 for verification",
        level: "gold | silver | bronze | uncertified",
        compositeScore: "number (0-1)",
        dimensions: "5 dimensions: structural, grounding, logic, epistemic, actionability",
        reasoningHash: "string — SHA-256 of reasoning text",
      },
    },
  });
});

benchmarkV20ApiRoutes.get("/export/jsonl", (c) => {
  const scores = computeAllScores();
  const transparencyProfiles = getAllTransparencyProfiles();
  const accountabilityProfiles = getAllAccountabilityProfiles();
  const certificationProfiles = getAllCertificationProfiles();

  const records = scores.map((s) => ({
    ...s,
    transparency: transparencyProfiles[s.agentId] ?? null,
    accountability: accountabilityProfiles[s.agentId] ?? null,
    certification: certificationProfiles[s.agentId] ?? null,
  }));

  const lines = records.map((r) => JSON.stringify(r));
  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "application/jsonl",
      "Content-Disposition": "attachment; filename=benchmark-v20-full.jsonl",
    },
  });
});

benchmarkV20ApiRoutes.get("/export/csv", (c) => {
  const scores = computeAllScores();
  const header = "rank,agent_id,composite,grade,transparency,accountability,certification," +
    Object.keys(V20_WEIGHTS).join(",");

  const rows = scores.map((s) => {
    const pillarValues = Object.keys(V20_WEIGHTS).map((k) => (s.pillars[k] ?? 0.5).toFixed(3));
    return [
      s.rank,
      s.agentId,
      s.composite.toFixed(3),
      s.grade,
      (s.pillars.reasoning_transparency ?? 0.5).toFixed(3),
      (s.pillars.decision_accountability ?? 0.5).toFixed(3),
      (s.pillars.quality_certification ?? 0.5).toFixed(3),
      ...pillarValues,
    ].join(",");
  });

  return new Response([header, ...rows].join("\n"), {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": "attachment; filename=benchmark-v20-leaderboard.csv",
    },
  });
});
