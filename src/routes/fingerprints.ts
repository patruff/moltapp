/**
 * Agent Behavioral Fingerprint Routes
 *
 * API endpoints for analyzing agent trading behavior patterns,
 * computing similarity scores, correlation matrices, and detecting
 * behavioral drift.
 */

import { Hono } from "hono";
import { parseQueryInt } from "../lib/query-params.ts";
import {
  generateFingerprint,
  getAllFingerprints,
  computeSimilarity,
  buildCorrelationMatrix,
  detectBehaviorDrift,
} from "../services/agent-fingerprint.ts";
import { errorMessage } from "../lib/errors.ts";

const DEFAULT_AGENTS = [
  "claude-value-investor",
  "gpt-momentum-trader",
  "grok-contrarian",
];

const app = new Hono();

/**
 * GET /api/v1/fingerprints/:agentId
 * Get the behavioral fingerprint for a specific agent.
 * Query: lookbackRounds (default 200)
 */
app.get("/:agentId", async (c) => {
  const agentId = c.req.param("agentId");
  const lookbackRounds = parseQueryInt(c.req.query("lookbackRounds"), 200, 1, 1000);

  try {
    const fingerprint = await generateFingerprint(agentId, { lookbackRounds });
    return c.json(fingerprint);
  } catch (err) {
    return c.json(
      { error: errorMessage(err) },
      500,
    );
  }
});

/**
 * GET /api/v1/fingerprints
 * Get behavioral fingerprints for all agents.
 * Query: agents (comma-separated, defaults to all 3)
 */
app.get("/", async (c) => {
  const agentsParam = c.req.query("agents") ?? "";
  const agentIds = agentsParam ? agentsParam.split(",").filter(Boolean) : DEFAULT_AGENTS;

  try {
    const fingerprints = await getAllFingerprints(agentIds);
    return c.json({ fingerprints });
  } catch (err) {
    return c.json(
      { error: errorMessage(err) },
      500,
    );
  }
});

/**
 * GET /api/v1/fingerprints/similarity/:agentA/:agentB
 * Compute behavioral similarity between two agents.
 */
app.get("/similarity/:agentA/:agentB", async (c) => {
  const agentA = c.req.param("agentA");
  const agentB = c.req.param("agentB");

  try {
    const similarity = await computeSimilarity(agentA, agentB);
    return c.json(similarity);
  } catch (err) {
    return c.json(
      { error: errorMessage(err) },
      500,
    );
  }
});

/**
 * GET /api/v1/fingerprints/correlation-matrix
 * Build a correlation matrix of agent decision sequences.
 * Query: agents (comma-separated, defaults to all 3)
 */
app.get("/correlation-matrix", async (c) => {
  const agentsParam = c.req.query("agents") ?? "";
  const agentIds = agentsParam ? agentsParam.split(",").filter(Boolean) : DEFAULT_AGENTS;

  try {
    const matrix = await buildCorrelationMatrix(agentIds);
    return c.json(matrix);
  } catch (err) {
    return c.json(
      { error: errorMessage(err) },
      500,
    );
  }
});

/**
 * GET /api/v1/fingerprints/:agentId/drift
 * Detect if an agent's behavior has drifted from its historical pattern.
 */
app.get("/:agentId/drift", async (c) => {
  const agentId = c.req.param("agentId");

  try {
    const drift = await detectBehaviorDrift(agentId);
    return c.json({ agentId, ...drift });
  } catch (err) {
    return c.json(
      { error: errorMessage(err) },
      500,
    );
  }
});

export const fingerprintRoutes = app;
