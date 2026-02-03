/**
 * Trade Proof & Verification API Routes
 *
 * Endpoints for generating and verifying cryptographic proofs
 * of AI agent trades.
 */

import { Hono } from "hono";
import {
  generateTransactionProof,
  generateRoundProof,
  generatePerformanceProof,
  generateCompetitionProof,
  verifyProofHash,
  verifyRoundMerkleRoot,
  getProof,
  getRoundProofs,
  getAgentProofs,
  getProofsByType,
  getRecentProofs,
  getTradeProofMetrics,
} from "../services/trade-proof.ts";

export const tradeProofRoutes = new Hono();

/** GET / — get proof metrics */
tradeProofRoutes.get("/", (c) => {
  return c.json(getTradeProofMetrics());
});

/** GET /recent — get recent proofs */
tradeProofRoutes.get("/recent", (c) => {
  const limit = parseInt(c.req.query("limit") ?? "20", 10);
  return c.json({ proofs: getRecentProofs(limit) });
});

/** GET /:proofId — get a specific proof */
tradeProofRoutes.get("/:proofId", (c) => {
  const proofId = c.req.param("proofId");
  const proof = getProof(proofId);
  if (!proof) return c.json({ error: "Proof not found" }, 404);
  return c.json(proof);
});

/** GET /:proofId/verify — verify a proof hash */
tradeProofRoutes.get("/:proofId/verify", (c) => {
  const proofId = c.req.param("proofId");
  const result = verifyProofHash(proofId);
  return c.json(result);
});

/** GET /:proofId/verify-merkle — verify round Merkle root */
tradeProofRoutes.get("/:proofId/verify-merkle", (c) => {
  const proofId = c.req.param("proofId");
  const result = verifyRoundMerkleRoot(proofId);
  return c.json(result);
});

/** GET /round/:roundId — get all proofs for a round */
tradeProofRoutes.get("/round/:roundId", (c) => {
  const roundId = c.req.param("roundId");
  return c.json({ roundId, proofs: getRoundProofs(roundId) });
});

/** GET /agent/:agentId — get proofs for an agent */
tradeProofRoutes.get("/agent/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const limit = parseInt(c.req.query("limit") ?? "50", 10);
  return c.json({ agentId, proofs: getAgentProofs(agentId, limit) });
});

/** GET /type/:type — get proofs by type */
tradeProofRoutes.get("/type/:type", (c) => {
  const type = c.req.param("type") as "transaction" | "round" | "performance" | "competition";
  const limit = parseInt(c.req.query("limit") ?? "50", 10);
  return c.json({ type, proofs: getProofsByType(type, limit) });
});

/** POST /transaction — generate a transaction proof */
tradeProofRoutes.post("/transaction", async (c) => {
  const body = (await c.req.json()) as {
    agentId: string;
    roundId: string;
    txSignature: string;
    side: "buy" | "sell";
    symbol: string;
    quantity: number;
    pricePerToken: number;
    usdcAmount: number;
    reasoning: string;
    confidence: number;
  };
  const proof = generateTransactionProof(body);
  return c.json(proof, 201);
});

/** POST /round — generate a round proof */
tradeProofRoutes.post("/round", async (c) => {
  const body = (await c.req.json()) as {
    roundId: string;
    roundTimestamp: string;
    tradingMode: "live" | "paper";
    durationMs: number;
    consensus: string;
    trades: Array<{
      agentId: string;
      txSignature: string;
      side: "buy" | "sell";
      symbol: string;
      quantity: number;
      pricePerToken: number;
      usdcAmount: number;
      reasoning: string;
      confidence: number;
    }>;
  };
  const proof = generateRoundProof(body);
  return c.json(proof, 201);
});

/** POST /performance — generate a performance proof */
tradeProofRoutes.post("/performance", async (c) => {
  const body = (await c.req.json()) as {
    agentId: string;
    periodStart: string;
    periodEnd: string;
    startingValue: number;
    endingValue: number;
    trades: Array<{
      txSignature: string;
      pnlPercent: number;
    }>;
  };
  const proof = generatePerformanceProof(body);
  return c.json(proof, 201);
});

/** POST /competition — generate a competition proof */
tradeProofRoutes.post("/competition", async (c) => {
  const body = (await c.req.json()) as {
    competitionName: string;
    startedAt: string;
    endedAt: string;
    agents: Array<{
      agentId: string;
      agentName: string;
      model: string;
      totalPnlPercent: number;
      winRate: number;
      tradeCount: number;
    }>;
    roundProofIds: string[];
  };
  const proof = generateCompetitionProof(body);
  return c.json(proof, 201);
});
