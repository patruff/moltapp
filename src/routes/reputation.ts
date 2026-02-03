/**
 * Agent Reputation & Trust Routes
 *
 * ELO-based rating system, trust scores, prediction accuracy tracking,
 * confidence calibration analysis, and achievement badges for AI agents.
 *
 * Routes:
 *   GET  /api/v1/reputation                     — Reputation leaderboard
 *   GET  /api/v1/reputation/:agentId            — Full reputation profile
 *   GET  /api/v1/reputation/:agentId/accuracy   — Prediction accuracy breakdown
 *   GET  /api/v1/reputation/:agentId/calibration — Confidence calibration data
 *   GET  /api/v1/reputation/:agentId/badges     — Earned badges & achievements
 *   GET  /api/v1/reputation/compare/:a1/:a2     — Head-to-head reputation comparison
 */

import { Hono } from "hono";
import {
  getAgentReputation,
  getReputationLeaderboard,
} from "../services/reputation.ts";
import { getAgentConfigs } from "../agents/orchestrator.ts";

export const reputationRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET /reputation — Reputation leaderboard
// ---------------------------------------------------------------------------

reputationRoutes.get("/", async (c) => {
  try {
    const leaderboard = await getReputationLeaderboard();

    return c.json({
      leaderboard,
      count: leaderboard.length,
      description:
        "Agent reputation leaderboard ranked by ELO rating. Trust scores, prediction accuracy, and earned badges for each AI trading agent.",
      ratingSystem: {
        tiers: [
          { tier: "grandmaster", minElo: 2000, description: "Top-tier agent" },
          { tier: "master", minElo: 1800, description: "Exceptional performance" },
          { tier: "diamond", minElo: 1600, description: "High-skill agent" },
          { tier: "platinum", minElo: 1400, description: "Above average" },
          { tier: "gold", minElo: 1200, description: "Starting tier" },
          { tier: "silver", minElo: 1000, description: "Below average" },
          { tier: "bronze", minElo: 0, description: "Needs improvement" },
        ],
      },
    });
  } catch (error) {
    console.error("[Reputation] Leaderboard error:", error);
    return c.json(
      {
        error: "reputation_error",
        code: "leaderboard_failed",
        details:
          error instanceof Error
            ? error.message
            : "Failed to compute leaderboard",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /reputation/:agentId — Full reputation profile
// ---------------------------------------------------------------------------

reputationRoutes.get("/:agentId", async (c) => {
  const agentId = c.req.param("agentId");

  try {
    const reputation = await getAgentReputation(agentId);

    if (!reputation) {
      return c.json(
        {
          error: "agent_not_found",
          code: "agent_not_found",
          details: `No agent with ID "${agentId}". Valid IDs: ${getAgentConfigs().map((c) => c.agentId).join(", ")}`,
        },
        404,
      );
    }

    return c.json({
      reputation,
      description: `Full reputation profile for ${reputation.agentName}: ELO ${reputation.eloRating} (${reputation.eloTier}), Trust ${reputation.trustScore}/100 (${reputation.trustLevel})`,
    });
  } catch (error) {
    console.error(`[Reputation] Profile error for ${agentId}:`, error);
    return c.json(
      {
        error: "reputation_error",
        code: "profile_failed",
        details:
          error instanceof Error
            ? error.message
            : "Failed to compute reputation",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /reputation/:agentId/accuracy — Prediction accuracy breakdown
// ---------------------------------------------------------------------------

reputationRoutes.get("/:agentId/accuracy", async (c) => {
  const agentId = c.req.param("agentId");

  try {
    const reputation = await getAgentReputation(agentId);

    if (!reputation) {
      return c.json(
        { error: "agent_not_found", code: "agent_not_found", details: `No agent with ID "${agentId}"` },
        404,
      );
    }

    return c.json({
      agentId,
      agentName: reputation.agentName,
      accuracy: reputation.predictionAccuracy,
      description: `${reputation.agentName} prediction accuracy: ${reputation.predictionAccuracy.accuracy}% overall (${reputation.predictionAccuracy.accuracyTrend} trend)`,
    });
  } catch (error) {
    console.error(`[Reputation] Accuracy error for ${agentId}:`, error);
    return c.json(
      {
        error: "reputation_error",
        code: "accuracy_failed",
        details: error instanceof Error ? error.message : "Failed to compute accuracy",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /reputation/:agentId/calibration — Confidence calibration
// ---------------------------------------------------------------------------

reputationRoutes.get("/:agentId/calibration", async (c) => {
  const agentId = c.req.param("agentId");

  try {
    const reputation = await getAgentReputation(agentId);

    if (!reputation) {
      return c.json(
        { error: "agent_not_found", code: "agent_not_found", details: `No agent with ID "${agentId}"` },
        404,
      );
    }

    return c.json({
      agentId,
      agentName: reputation.agentName,
      calibration: reputation.calibration,
      interpretation: reputation.calibration.isOverconfident
        ? `${reputation.agentName} tends to be OVERCONFIDENT — stated confidence exceeds actual accuracy. Brier score: ${reputation.calibration.brierScore}`
        : reputation.calibration.isUnderconfident
          ? `${reputation.agentName} is UNDERCONFIDENT — actual performance exceeds stated confidence. A hidden gem! Brier score: ${reputation.calibration.brierScore}`
          : `${reputation.agentName} is WELL CALIBRATED — confidence aligns closely with actual outcomes. Brier score: ${reputation.calibration.brierScore}`,
    });
  } catch (error) {
    console.error(`[Reputation] Calibration error for ${agentId}:`, error);
    return c.json(
      {
        error: "reputation_error",
        code: "calibration_failed",
        details: error instanceof Error ? error.message : "Failed to compute calibration",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /reputation/:agentId/badges — Achievement badges
// ---------------------------------------------------------------------------

reputationRoutes.get("/:agentId/badges", async (c) => {
  const agentId = c.req.param("agentId");

  try {
    const reputation = await getAgentReputation(agentId);

    if (!reputation) {
      return c.json(
        { error: "agent_not_found", code: "agent_not_found", details: `No agent with ID "${agentId}"` },
        404,
      );
    }

    const badgesByRarity = {
      legendary: reputation.badges.filter((b) => b.rarity === "legendary"),
      epic: reputation.badges.filter((b) => b.rarity === "epic"),
      rare: reputation.badges.filter((b) => b.rarity === "rare"),
      uncommon: reputation.badges.filter((b) => b.rarity === "uncommon"),
      common: reputation.badges.filter((b) => b.rarity === "common"),
    };

    return c.json({
      agentId,
      agentName: reputation.agentName,
      totalBadges: reputation.badges.length,
      badges: reputation.badges,
      byRarity: badgesByRarity,
    });
  } catch (error) {
    console.error(`[Reputation] Badges error for ${agentId}:`, error);
    return c.json(
      {
        error: "reputation_error",
        code: "badges_failed",
        details: error instanceof Error ? error.message : "Failed to fetch badges",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /reputation/compare/:a1/:a2 — Head-to-head reputation comparison
// ---------------------------------------------------------------------------

reputationRoutes.get("/compare/:agent1/:agent2", async (c) => {
  const agent1Id = c.req.param("agent1");
  const agent2Id = c.req.param("agent2");

  try {
    const [rep1, rep2] = await Promise.all([
      getAgentReputation(agent1Id),
      getAgentReputation(agent2Id),
    ]);

    if (!rep1 || !rep2) {
      const missing = !rep1 ? agent1Id : agent2Id;
      return c.json(
        {
          error: "agent_not_found",
          code: "agent_not_found",
          details: `No agent with ID "${missing}"`,
        },
        404,
      );
    }

    // Determine winner in each category
    const categories = [
      { name: "ELO Rating", a1: rep1.eloRating, a2: rep2.eloRating, winner: rep1.eloRating > rep2.eloRating ? rep1.agentName : rep2.agentName },
      { name: "Trust Score", a1: rep1.trustScore, a2: rep2.trustScore, winner: rep1.trustScore > rep2.trustScore ? rep1.agentName : rep2.agentName },
      { name: "Prediction Accuracy", a1: rep1.predictionAccuracy.accuracy, a2: rep2.predictionAccuracy.accuracy, winner: rep1.predictionAccuracy.accuracy > rep2.predictionAccuracy.accuracy ? rep1.agentName : rep2.agentName },
      { name: "Calibration", a1: rep1.calibration.overallCalibration, a2: rep2.calibration.overallCalibration, winner: rep1.calibration.overallCalibration > rep2.calibration.overallCalibration ? rep1.agentName : rep2.agentName },
      { name: "Badges Earned", a1: rep1.badges.length, a2: rep2.badges.length, winner: rep1.badges.length > rep2.badges.length ? rep1.agentName : rep2.agentName },
    ];

    const a1Wins = categories.filter((cat) => cat.winner === rep1.agentName).length;
    const a2Wins = categories.filter((cat) => cat.winner === rep2.agentName).length;
    const overallWinner = a1Wins > a2Wins ? rep1.agentName : a2Wins > a1Wins ? rep2.agentName : "Tied";

    return c.json({
      agent1: {
        agentId: rep1.agentId,
        agentName: rep1.agentName,
        eloRating: rep1.eloRating,
        eloTier: rep1.eloTier,
        trustScore: rep1.trustScore,
        trustLevel: rep1.trustLevel,
        accuracy: rep1.predictionAccuracy.accuracy,
        calibration: rep1.calibration.overallCalibration,
        badges: rep1.badges.length,
      },
      agent2: {
        agentId: rep2.agentId,
        agentName: rep2.agentName,
        eloRating: rep2.eloRating,
        eloTier: rep2.eloTier,
        trustScore: rep2.trustScore,
        trustLevel: rep2.trustLevel,
        accuracy: rep2.predictionAccuracy.accuracy,
        calibration: rep2.calibration.overallCalibration,
        badges: rep2.badges.length,
      },
      headToHead: {
        categories,
        overallWinner,
        agent1Wins: a1Wins,
        agent2Wins: a2Wins,
      },
    });
  } catch (error) {
    console.error("[Reputation] Comparison error:", error);
    return c.json(
      {
        error: "reputation_error",
        code: "comparison_failed",
        details: error instanceof Error ? error.message : "Failed to compare agents",
      },
      500,
    );
  }
});
