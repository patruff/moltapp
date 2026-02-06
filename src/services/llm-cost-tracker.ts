/**
 * LLM Cost Tracker Service
 *
 * Records token usage from LLM API calls and estimates costs
 * to answer: "Are AI trading agents economically viable?"
 */

import { eq } from "drizzle-orm";
import { db } from "../db/index.ts";
import { llmUsage } from "../db/schema/index.ts";

// Model pricing per million tokens (as of Feb 2026)
// Sources: https://openai.com/pricing, https://anthropic.com/pricing, https://x.ai/pricing
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic Claude models
  "claude-opus-4-6": { input: 15, output: 75 },
  "claude-opus-4-5-20251101": { input: 15, output: 75 },
  "claude-sonnet-4-5-20251101": { input: 3, output: 15 },
  "claude-haiku-4-5-20251101": { input: 0.25, output: 1.25 },

  // OpenAI GPT models
  "gpt-5.2": { input: 30, output: 120 },
  "gpt-5.2-mini": { input: 10, output: 30 },
  "gpt-5-mini": { input: 5, output: 15 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10 },

  // xAI Grok models
  "grok-4": { input: 10, output: 30 },
  "grok-3-beta": { input: 5, output: 15 },
  "grok-beta": { input: 5, output: 15 },
  "grok-4-fast": { input: 5, output: 15 },
};

// Default pricing for unknown models
const DEFAULT_PRICING = { input: 10, output: 30 };

/**
 * Estimate cost in USD for a given token usage.
 */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = MODEL_PRICING[model] ?? DEFAULT_PRICING;
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

/**
 * Record to insert into llm_usage table.
 */
export interface LlmUsageRecord {
  roundId: string;
  agentId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Record LLM usage to the database.
 * Calculates total tokens and estimated cost automatically.
 */
export async function recordLlmUsage(record: LlmUsageRecord): Promise<void> {
  const totalTokens = record.inputTokens + record.outputTokens;
  const estimatedCostUsd = estimateCost(
    record.model,
    record.inputTokens,
    record.outputTokens,
  );

  await db.insert(llmUsage).values({
    roundId: record.roundId,
    agentId: record.agentId,
    model: record.model,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    totalTokens,
    estimatedCostUsd: estimatedCostUsd.toFixed(6),
  });
}

/**
 * Get total costs for a specific agent.
 */
export async function getAgentCosts(
  agentId: string,
): Promise<{ totalCost: number; totalTokens: number }> {
  const rows = await db.select().from(llmUsage).where(eq(llmUsage.agentId, agentId));
  return {
    totalCost: rows.reduce((sum: number, r: typeof llmUsage.$inferSelect) => sum + parseFloat(r.estimatedCostUsd ?? "0"), 0),
    totalTokens: rows.reduce((sum: number, r: typeof llmUsage.$inferSelect) => sum + r.totalTokens, 0),
  };
}

/**
 * Get total costs across all agents with breakdown.
 */
export async function getTotalCosts(): Promise<{
  totalCost: number;
  totalTokens: number;
  byAgent: Array<{ agentId: string; cost: number; tokens: number }>;
}> {
  const rows = await db.select().from(llmUsage);

  const byAgent = new Map<string, { cost: number; tokens: number }>();
  let totalCost = 0;
  let totalTokens = 0;

  for (const row of rows) {
    const cost = parseFloat(row.estimatedCostUsd ?? "0");
    totalCost += cost;
    totalTokens += row.totalTokens;

    const existing = byAgent.get(row.agentId) ?? { cost: 0, tokens: 0 };
    byAgent.set(row.agentId, {
      cost: existing.cost + cost,
      tokens: existing.tokens + row.totalTokens,
    });
  }

  return {
    totalCost,
    totalTokens,
    byAgent: Array.from(byAgent.entries()).map(([agentId, data]) => ({
      agentId,
      cost: data.cost,
      tokens: data.tokens,
    })),
  };
}

/**
 * Get cost summary for a specific round.
 */
export async function getRoundCosts(
  roundId: string,
): Promise<{ totalCost: number; totalTokens: number; byAgent: Array<{ agentId: string; cost: number; tokens: number }> }> {
  const rows = await db.select().from(llmUsage).where(eq(llmUsage.roundId, roundId));

  const byAgent = new Map<string, { cost: number; tokens: number }>();
  let totalCost = 0;
  let totalTokens = 0;

  for (const row of rows) {
    const cost = parseFloat(row.estimatedCostUsd ?? "0");
    totalCost += cost;
    totalTokens += row.totalTokens;

    const existing = byAgent.get(row.agentId) ?? { cost: 0, tokens: 0 };
    byAgent.set(row.agentId, {
      cost: existing.cost + cost,
      tokens: existing.tokens + row.totalTokens,
    });
  }

  return {
    totalCost,
    totalTokens,
    byAgent: Array.from(byAgent.entries()).map(([agentId, data]) => ({
      agentId,
      cost: data.cost,
      tokens: data.tokens,
    })),
  };
}
