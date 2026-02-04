/**
 * Shared utilities for OpenAI-compatible agents (GPT, Grok, etc.)
 *
 * Both GPT and Grok use the OpenAI SDK with identical message format
 * and tool-calling conventions. This module extracts the shared logic
 * to reduce duplication.
 */

import type OpenAI from "openai";
import type { AgentTurn, ToolCall, ToolResult } from "./base-agent.ts";

/**
 * Build initial messages array with user message for OpenAI-compatible APIs.
 */
export function buildOpenAIMessages(userMessage: string): any[] {
  return [{ role: "user" as const, content: userMessage }];
}

/**
 * Append tool results to message history in OpenAI format.
 *
 * OpenAI format:
 * - Assistant message with tool_calls array
 * - Separate "tool" role messages for each result
 */
export function appendOpenAIToolResults(
  messages: any[],
  turn: AgentTurn,
  results: ToolResult[],
): any[] {
  const assistantMsg: any = {
    role: "assistant",
    content: turn.textResponse ?? null,
    tool_calls: turn.toolCalls.map((tc) => ({
      id: tc.id,
      type: "function",
      function: {
        name: tc.name,
        arguments: JSON.stringify(tc.arguments),
      },
    })),
  };

  const toolMsgs = results.map((r) => ({
    role: "tool" as const,
    tool_call_id: r.toolCallId,
    content: r.result,
  }));

  return [...messages, assistantMsg, ...toolMsgs];
}

/**
 * Parse OpenAI chat completion response into AgentTurn.
 *
 * Handles tool calls and stop reasons uniformly for all OpenAI-compatible APIs.
 */
export function parseOpenAIResponse(response: any): AgentTurn {
  const choice = response.choices[0];
  if (!choice) {
    return { toolCalls: [], textResponse: null, stopReason: "end_turn" };
  }

  const msg = choice.message;
  const toolCalls: ToolCall[] = (msg.tool_calls ?? [])
    .filter((tc: any): tc is Extract<typeof tc, { type: "function" }> => tc.type === "function")
    .map((tc: any) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments || "{}"),
    }));

  let stopReason: AgentTurn["stopReason"] = "end_turn";
  if (choice.finish_reason === "tool_calls") stopReason = "tool_use";
  else if (choice.finish_reason === "length") stopReason = "max_tokens";

  return {
    toolCalls,
    textResponse: msg.content ?? null,
    stopReason,
  };
}

/**
 * Create a callWithTools method for OpenAI-compatible APIs.
 *
 * Returns a closure that captures the client getter, model name, and temperature,
 * eliminating the need for duplicate callWithTools implementations in GPT/Grok agents.
 */
export function createOpenAICompatibleCaller(
  getClient: () => OpenAI,
  model: string,
  temperature: number,
): (system: string, messages: any[], tools: any[]) => Promise<AgentTurn> {
  return async (system: string, messages: any[], tools: any[]): Promise<AgentTurn> => {
    const client = getClient();

    const response = await client.chat.completions.create({
      model,
      max_tokens: 2048,
      temperature,
      messages: [{ role: "system", content: system }, ...messages],
      tools,
    });

    return parseOpenAIResponse(response);
  };
}
