/**
 * Agent Intelligence Report API Routes
 *
 * Comprehensive scouting reports for each AI trading agent.
 * Think of these as "character sheets" for AI traders — everything
 * a researcher needs to understand an agent's capabilities.
 *
 * Routes:
 * - GET  /                  — All agent reports (summary)
 * - GET  /:agentId          — Full intelligence report for one agent
 * - GET  /:agentId/strengths    — Agent's strengths
 * - GET  /:agentId/weaknesses   — Agent's weaknesses
 * - GET  /:agentId/patterns     — Behavioral patterns
 * - GET  /:agentId/recommendations — Improvement recommendations
 */

import { Hono } from "hono";
import {
  generateIntelligenceReport,
  generateAllReports,
} from "../services/agent-intelligence-report.ts";
import { getAgentConfigs } from "../agents/orchestrator.ts";

export const agentReportRoutes = new Hono();

/**
 * GET / — All agent reports (summary view)
 */
agentReportRoutes.get("/", (c) => {
  const reports = generateAllReports();

  const summaries = reports.map((r) => ({
    agentId: r.agentId,
    agentName: r.agentName,
    grade: r.grade,
    executiveSummary: r.executiveSummary,
    strengthCount: r.strengths.length,
    weaknessCount: r.weaknesses.length,
    patternCount: r.behavioralPatterns.length,
    dataCompleteness: r.dataCompleteness,
    generatedAt: r.generatedAt,
  }));

  return c.json({
    ok: true,
    reports: summaries,
    description: "Intelligence reports for all AI trading agents",
  });
});

/**
 * GET /:agentId — Full intelligence report
 */
agentReportRoutes.get("/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const agents = getAgentConfigs();
  const agentConfig = agents.find((a) => a.agentId === agentId);
  const agentName = agentConfig?.name ?? agentId;

  const report = generateIntelligenceReport(agentId, agentName);

  return c.json({ ok: true, report });
});

/**
 * GET /:agentId/strengths — Just the strengths
 */
agentReportRoutes.get("/:agentId/strengths", (c) => {
  const agentId = c.req.param("agentId");
  const agents = getAgentConfigs();
  const agentConfig = agents.find((a) => a.agentId === agentId);

  const report = generateIntelligenceReport(agentId, agentConfig?.name ?? agentId);

  return c.json({
    ok: true,
    agentId,
    strengths: report.strengths,
    grade: report.grade,
  });
});

/**
 * GET /:agentId/weaknesses — Just the weaknesses
 */
agentReportRoutes.get("/:agentId/weaknesses", (c) => {
  const agentId = c.req.param("agentId");
  const agents = getAgentConfigs();
  const agentConfig = agents.find((a) => a.agentId === agentId);

  const report = generateIntelligenceReport(agentId, agentConfig?.name ?? agentId);

  return c.json({
    ok: true,
    agentId,
    weaknesses: report.weaknesses,
    recommendations: report.recommendations,
    grade: report.grade,
  });
});

/**
 * GET /:agentId/patterns — Behavioral patterns
 */
agentReportRoutes.get("/:agentId/patterns", (c) => {
  const agentId = c.req.param("agentId");
  const agents = getAgentConfigs();
  const agentConfig = agents.find((a) => a.agentId === agentId);

  const report = generateIntelligenceReport(agentId, agentConfig?.name ?? agentId);

  return c.json({
    ok: true,
    agentId,
    patterns: report.behavioralPatterns,
    riskProfile: report.riskProfile,
    marketBias: report.marketBias,
  });
});

/**
 * GET /:agentId/recommendations — Improvement recommendations
 */
agentReportRoutes.get("/:agentId/recommendations", (c) => {
  const agentId = c.req.param("agentId");
  const agents = getAgentConfigs();
  const agentConfig = agents.find((a) => a.agentId === agentId);

  const report = generateIntelligenceReport(agentId, agentConfig?.name ?? agentId);

  return c.json({
    ok: true,
    agentId,
    recommendations: report.recommendations,
    weaknesses: report.weaknesses,
    currentGrade: report.grade,
  });
});
