/**
 * Consensus Engine API Routes
 *
 * Exposes multi-agent consensus detection, historical accuracy,
 * agreement matrices, and real-time consensus signals.
 */

import { Hono } from "hono";
import {
  getConsensusStatus,
  getConsensusHistory,
  getConsensusAccuracy,
  getAgentAgreementMatrix,
  analyzeHistoricalConsensus,
} from "../services/consensus-engine.ts";
import { errorMessage } from "../lib/errors.ts";

const consensus = new Hono();

// ---------------------------------------------------------------------------
// GET /api/v1/consensus — Full consensus engine status
// ---------------------------------------------------------------------------
consensus.get("/", async (c) => {
  try {
    const status = await getConsensusStatus();
    return c.json({
      status: "ok",
      data: status,
    });
  } catch (error) {
    const message = errorMessage(error);
    return c.json({ status: "error", error: message }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/consensus/history — Recent consensus signals and divergences
// ---------------------------------------------------------------------------
consensus.get("/history", (c) => {
  const limit = Number(c.req.query("limit")) || 20;
  const history = getConsensusHistory(limit);
  return c.json({
    status: "ok",
    data: history,
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/consensus/accuracy — Historical consensus accuracy metrics
// ---------------------------------------------------------------------------
consensus.get("/accuracy", async (c) => {
  try {
    const accuracy = await getConsensusAccuracy();
    return c.json({
      status: "ok",
      data: accuracy,
    });
  } catch (error) {
    const message = errorMessage(error);
    return c.json({ status: "error", error: message }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/consensus/matrix — Agent agreement matrix
// ---------------------------------------------------------------------------
consensus.get("/matrix", (c) => {
  const matrix = getAgentAgreementMatrix();
  return c.json({
    status: "ok",
    data: matrix,
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/consensus/historical — Analyze consensus from DB history
// ---------------------------------------------------------------------------
consensus.get("/historical", async (c) => {
  try {
    const rounds = Number(c.req.query("rounds")) || 50;
    const analysis = await analyzeHistoricalConsensus(rounds);
    return c.json({
      status: "ok",
      data: analysis,
    });
  } catch (error) {
    const message = errorMessage(error);
    return c.json({ status: "error", error: message }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/consensus/sectors — Sector-level consensus summary
// ---------------------------------------------------------------------------
consensus.get("/sectors", (c) => {
  const history = getConsensusHistory();
  return c.json({
    status: "ok",
    data: {
      sectors: history.sectorConsensus,
      streak: {
        current: history.currentStreak,
        longest: history.longestStreak,
      },
    },
  });
});

export { consensus as consensusRoutes };
