/**
 * Agent Memory & Learning API Routes
 *
 * Exposes agent memory states, learned patterns, stock profiles,
 * and the generated memory prompts that make agents smarter over time.
 */

import { Hono } from "hono";
import {
  getAgentMemory,
  getMemorySystemStatus,
  generateMemoryPrompt,
  loadMemoryFromDB,
  clearAgentMemory,
} from "../services/agent-memory.ts";
import { errorMessage } from "../lib/errors.ts";

const memory = new Hono();

// ---------------------------------------------------------------------------
// GET /api/v1/memory — Memory system status across all agents
// ---------------------------------------------------------------------------
memory.get("/", (c) => {
  const status = getMemorySystemStatus();
  return c.json({
    status: "ok",
    data: status,
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/memory/:agentId — Full memory state for an agent
// ---------------------------------------------------------------------------
memory.get("/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const agentMemory = getAgentMemory(agentId);

  return c.json({
    status: "ok",
    data: agentMemory,
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/memory/:agentId/prompt — Generated memory prompt for an agent
// ---------------------------------------------------------------------------
memory.get("/:agentId/prompt", (c) => {
  const agentId = c.req.param("agentId");
  const prompt = generateMemoryPrompt(agentId);

  return c.json({
    status: "ok",
    data: {
      agentId,
      prompt,
      charLength: prompt.length,
      isEmpty: prompt.length === 0,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/memory/:agentId/patterns — Agent's detected patterns
// ---------------------------------------------------------------------------
memory.get("/:agentId/patterns", (c) => {
  const agentId = c.req.param("agentId");
  const agentMemory = getAgentMemory(agentId);

  return c.json({
    status: "ok",
    data: {
      agentId,
      patternCount: agentMemory.patterns.length,
      patterns: agentMemory.patterns,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/memory/:agentId/stocks — Agent's stock-specific knowledge
// ---------------------------------------------------------------------------
memory.get("/:agentId/stocks", (c) => {
  const agentId = c.req.param("agentId");
  const agentMemory = getAgentMemory(agentId);

  return c.json({
    status: "ok",
    data: {
      agentId,
      stockCount: agentMemory.stockProfiles.length,
      profiles: agentMemory.stockProfiles,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/memory/:agentId/lessons — Agent's key lessons
// ---------------------------------------------------------------------------
memory.get("/:agentId/lessons", (c) => {
  const agentId = c.req.param("agentId");
  const agentMemory = getAgentMemory(agentId);

  return c.json({
    status: "ok",
    data: {
      agentId,
      winRate: agentMemory.overallWinRate,
      bestSector: agentMemory.bestSector,
      worstSector: agentMemory.worstSector,
      lessonCount: agentMemory.keyLessons.length,
      lessons: agentMemory.keyLessons,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/memory/:agentId/trades — Agent's trade memories
// ---------------------------------------------------------------------------
memory.get("/:agentId/trades", (c) => {
  const agentId = c.req.param("agentId");
  const agentMemory = getAgentMemory(agentId);

  return c.json({
    status: "ok",
    data: {
      agentId,
      totalMemories: agentMemory.totalMemories,
      recentTrades: agentMemory.recentTrades,
    },
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/memory/:agentId/load — Bootstrap memory from database
// ---------------------------------------------------------------------------
memory.post("/:agentId/load", async (c) => {
  try {
    const agentId = c.req.param("agentId");
    await loadMemoryFromDB(agentId);

    const agentMemory = getAgentMemory(agentId);

    return c.json({
      status: "ok",
      data: {
        agentId,
        memoriesLoaded: agentMemory.totalMemories,
        patternsDetected: agentMemory.patterns.length,
        lessonsLearned: agentMemory.keyLessons.length,
      },
    });
  } catch (error) {
    const message = errorMessage(error);
    return c.json({ status: "error", error: message }, 500);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/v1/memory/:agentId — Clear agent memory (admin)
// ---------------------------------------------------------------------------
memory.delete("/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  clearAgentMemory(agentId);

  return c.json({
    status: "ok",
    data: {
      agentId,
      message: "Memory cleared",
    },
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/memory/compare/all — Compare memory states across agents
// ---------------------------------------------------------------------------
memory.get("/compare/all", (c) => {
  const status = getMemorySystemStatus();

  // Build comparison view
  const agentComparison = status.agents.map((agent) => {
    const fullMemory = getAgentMemory(agent.agentId);
    return {
      agentId: agent.agentId,
      memories: agent.memories,
      patterns: agent.patterns,
      winRate: agent.winRate,
      lessonsLearned: fullMemory.keyLessons.length,
      stocksTracked: fullMemory.stockProfiles.length,
      bestSector: fullMemory.bestSector,
      worstSector: fullMemory.worstSector,
      promptLength: generateMemoryPrompt(agent.agentId).length,
    };
  });

  return c.json({
    status: "ok",
    data: {
      agentCount: status.agentsWithMemory,
      totalMemories: status.totalTradeMemories,
      totalPatterns: status.totalPatterns,
      agents: agentComparison,
    },
  });
});

export { memory as memoryRoutes };
