/**
 * Post-Trade "Meeting of Minds" — Multi-Turn Agent Deliberation
 *
 * After each trading round, agents present their theses and debate
 * in a shared multi-round conversation, reaching a majority consensus.
 * Unlike pre-trade-deliberation.ts (algorithmic), this uses real LLM
 * calls so agents genuinely react to each other's arguments.
 *
 * Flow:
 * 1. Each agent's decision becomes their "opening thesis" (round 0)
 * 2. Agents take turns responding to the transcript (rounds 1-3)
 * 3. Each agent states a final vote
 * 4. Consensus is computed (2 of 3 = majority)
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type {
  TradingRoundResult,
  MarketData,
  AgentConfig,
} from "../agents/base-agent.ts";
import type { BaseTradingAgent } from "../agents/base-agent.ts";
import { errorMessage } from "../lib/errors.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MeetingMessage {
  agentId: string;
  agentName: string;
  round: number; // 0 = opening thesis, 1-3 = discussion, 4 = final vote
  content: string;
  timestamp: string;
}

export interface MeetingVote {
  agentId: string;
  agentName: string;
  action: "buy" | "sell" | "hold";
  symbol: string;
  confidence: number;
  convincedBy: string | null; // Agent that changed their mind, or null
}

export interface MeetingConsensus {
  type: "unanimous" | "majority" | "split";
  action: "buy" | "sell" | "hold";
  symbol: string;
  agreementScore: number; // 0-100
  summary: string;
  mostPersuasive: string | null;
  dissenter: string | null;
}

export interface MeetingResult {
  meetingId: string;
  roundId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  transcript: MeetingMessage[];
  finalVotes: MeetingVote[];
  consensus: MeetingConsensus;
  keyDiscrepancies: string[];
  totalLlmCost: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DISCUSSION_ROUNDS = 3;
const MAX_RESPONSE_TOKENS = 300;
const MEETING_TEMPERATURE = 0.3;
const MAX_HISTORY = 50;

// ---------------------------------------------------------------------------
// In-Memory Storage
// ---------------------------------------------------------------------------

const meetingHistory: MeetingResult[] = [];

export function getRecentMeetings(limit: number): MeetingResult[] {
  return meetingHistory.slice(-limit).reverse();
}

export function getMeetingByRoundId(roundId: string): MeetingResult | undefined {
  return meetingHistory.find((m) => m.roundId === roundId);
}

export function getLatestMeeting(): MeetingResult | undefined {
  return meetingHistory.length > 0
    ? meetingHistory[meetingHistory.length - 1]
    : undefined;
}

// ---------------------------------------------------------------------------
// LLM Call Helpers
// ---------------------------------------------------------------------------

function buildMeetingSystemPrompt(agentConfig: AgentConfig): string {
  return (
    `You are ${agentConfig.name}, an AI trading agent in a post-trade review meeting. ` +
    `Your personality: ${agentConfig.personality} ` +
    `Your trading style: ${agentConfig.tradingStyle}\n\n` +
    `You just completed a trading round. Now you're meeting with the other agents ` +
    `to discuss what happened and whether the right decisions were made.\n\n` +
    `Rules:\n` +
    `- Keep responses concise (100-200 words)\n` +
    `- Reference specific data points and reasoning from other agents\n` +
    `- Be willing to change your mind if presented with compelling evidence\n` +
    `- Stay in character with your trading personality\n` +
    `- Focus on the substance of arguments, not just agreeing/disagreeing`
  );
}

function formatTranscriptForPrompt(transcript: MeetingMessage[]): string {
  if (transcript.length === 0) return "";
  return transcript
    .map((m) => {
      const roundLabel =
        m.round === 0 ? "OPENING THESIS" : `DISCUSSION ROUND ${m.round}`;
      return `[${m.agentName} — ${roundLabel}]\n${m.content}`;
    })
    .join("\n\n");
}

async function callClaudeForMeeting(
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return "[Claude unavailable — no API key]";

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: MAX_RESPONSE_TOKENS,
    temperature: MEETING_TEMPERATURE,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const block = response.content[0];
  return block.type === "text" ? block.text : "[no response]";
}

async function callOpenAIForMeeting(
  systemPrompt: string,
  userMessage: string,
  model: string,
  baseURL?: string,
): Promise<string> {
  const apiKey = baseURL
    ? process.env.XAI_API_KEY
    : process.env.OPENAI_API_KEY;
  if (!apiKey) return `[${model} unavailable — no API key]`;

  const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
  const response = await client.chat.completions.create({
    model,
    max_tokens: MAX_RESPONSE_TOKENS,
    temperature: MEETING_TEMPERATURE,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
  });

  return response.choices?.[0]?.message?.content ?? "[no response]";
}

async function callAgentForMeeting(
  agentConfig: AgentConfig,
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  switch (agentConfig.provider) {
    case "anthropic":
      return callClaudeForMeeting(systemPrompt, userMessage);
    case "openai":
      return callOpenAIForMeeting(systemPrompt, userMessage, agentConfig.model);
    case "xai":
      return callOpenAIForMeeting(
        systemPrompt,
        userMessage,
        agentConfig.model,
        "https://api.x.ai/v1",
      );
    default:
      return "[unknown provider]";
  }
}

// ---------------------------------------------------------------------------
// Core: Run Meeting of Minds
// ---------------------------------------------------------------------------

export async function runMeetingOfMinds(
  results: TradingRoundResult[],
  agents: BaseTradingAgent[],
  marketData: MarketData[],
  roundId: string,
): Promise<MeetingResult> {
  const meetingId = `meeting_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const transcript: MeetingMessage[] = [];

  console.log(
    `[Meeting] Starting Meeting of Minds ${meetingId} for round ${roundId}`,
  );

  // Build agent config lookup
  const agentConfigs = new Map<string, AgentConfig>();
  for (const agent of agents) {
    agentConfigs.set(agent.config.agentId, agent.config);
  }

  // ----- Round 0: Opening Theses -----
  for (const result of results) {
    const opening = formatOpeningThesis(result);
    transcript.push({
      agentId: result.agentId,
      agentName: result.agentName,
      round: 0,
      content: opening,
      timestamp: new Date().toISOString(),
    });
  }

  // ----- Rounds 1-3: Discussion -----
  for (let round = 1; round <= DISCUSSION_ROUNDS; round++) {
    for (const result of results) {
      const config = agentConfigs.get(result.agentId);
      if (!config) continue;

      const systemPrompt = buildMeetingSystemPrompt(config);
      const transcriptText = formatTranscriptForPrompt(transcript);
      const userMessage =
        `Here is the meeting transcript so far:\n\n${transcriptText}\n\n` +
        `It's now discussion round ${round} of ${DISCUSSION_ROUNDS}. ` +
        `Respond to the other agents' arguments. Do you agree or disagree? ` +
        `What are they missing? Would you change your position?`;

      try {
        const response = await callAgentForMeeting(
          config,
          systemPrompt,
          userMessage,
        );
        transcript.push({
          agentId: result.agentId,
          agentName: result.agentName,
          round,
          content: response,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        transcript.push({
          agentId: result.agentId,
          agentName: result.agentName,
          round,
          content: `[Error: ${errorMessage(err)}]`,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  // ----- Final Vote -----
  const finalVotes: MeetingVote[] = [];
  for (const result of results) {
    const config = agentConfigs.get(result.agentId);
    if (!config) continue;

    const systemPrompt = buildMeetingSystemPrompt(config);
    const transcriptText = formatTranscriptForPrompt(transcript);
    const votePrompt =
      `Here is the full meeting transcript:\n\n${transcriptText}\n\n` +
      `The discussion is over. State your FINAL position.\n` +
      `Respond in this exact format:\n` +
      `ACTION: buy|sell|hold\n` +
      `SYMBOL: <ticker>\n` +
      `CONFIDENCE: <0-100>\n` +
      `CONVINCED_BY: <agent name or "none">\n` +
      `REASONING: <1-2 sentences>`;

    try {
      const voteResponse = await callAgentForMeeting(
        config,
        systemPrompt,
        votePrompt,
      );

      // Add vote to transcript as round 4
      transcript.push({
        agentId: result.agentId,
        agentName: result.agentName,
        round: DISCUSSION_ROUNDS + 1,
        content: voteResponse,
        timestamp: new Date().toISOString(),
      });

      const vote = parseVote(result, voteResponse);
      finalVotes.push(vote);
    } catch (err) {
      // Fall back to original decision
      finalVotes.push({
        agentId: result.agentId,
        agentName: result.agentName,
        action: result.decision.action,
        symbol: result.decision.symbol,
        confidence: result.decision.confidence,
        convincedBy: null,
      });
    }
  }

  // ----- Consensus -----
  const consensus = computeConsensus(finalVotes, results);
  const keyDiscrepancies = findKeyDiscrepancies(results, finalVotes);

  const completedAt = new Date().toISOString();
  const durationMs = Date.now() - startMs;

  const meeting: MeetingResult = {
    meetingId,
    roundId,
    startedAt,
    completedAt,
    durationMs,
    transcript,
    finalVotes,
    consensus,
    keyDiscrepancies,
    totalLlmCost: estimateCost(transcript.length),
  };

  // Store in history
  meetingHistory.push(meeting);
  if (meetingHistory.length > MAX_HISTORY) {
    meetingHistory.splice(0, meetingHistory.length - MAX_HISTORY);
  }

  console.log(
    `[Meeting] Completed ${meetingId}: ${consensus.type} consensus — ` +
      `${consensus.action} ${consensus.symbol} (${consensus.agreementScore}%) ` +
      `duration=${durationMs}ms`,
  );

  return meeting;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatOpeningThesis(result: TradingRoundResult): string {
  const d = result.decision;
  const parts = [
    `I decided to ${d.action.toUpperCase()} ${d.symbol} with ${d.confidence}% confidence.`,
  ];
  if (d.reasoning) {
    // Truncate long reasoning to keep meeting focused
    const truncated =
      d.reasoning.length > 500
        ? d.reasoning.slice(0, 500) + "..."
        : d.reasoning;
    parts.push(truncated);
  }
  if (d.predictedOutcome) {
    parts.push(`Predicted outcome: ${d.predictedOutcome}`);
  }
  if (d.sources && d.sources.length > 0) {
    parts.push(`Sources: ${d.sources.join(", ")}`);
  }
  return parts.join("\n\n");
}

function parseVote(
  result: TradingRoundResult,
  response: string,
): MeetingVote {
  // Try to parse structured vote format
  const actionMatch = response.match(/ACTION:\s*(buy|sell|hold)/i);
  const symbolMatch = response.match(/SYMBOL:\s*(\S+)/i);
  const confMatch = response.match(/CONFIDENCE:\s*(\d+)/i);
  const convincedMatch = response.match(/CONVINCED_BY:\s*(.+)/i);

  const action = actionMatch
    ? (actionMatch[1].toLowerCase() as "buy" | "sell" | "hold")
    : result.decision.action;
  const symbol = symbolMatch ? symbolMatch[1] : result.decision.symbol;
  const confidence = confMatch
    ? Math.min(100, Math.max(0, parseInt(confMatch[1], 10)))
    : result.decision.confidence;
  const convincedByRaw = convincedMatch ? convincedMatch[1].trim() : "none";
  const convincedBy =
    convincedByRaw.toLowerCase() === "none" ? null : convincedByRaw;

  return {
    agentId: result.agentId,
    agentName: result.agentName,
    action,
    symbol,
    confidence,
    convincedBy,
  };
}

function computeConsensus(
  votes: MeetingVote[],
  originalResults: TradingRoundResult[],
): MeetingConsensus {
  if (votes.length === 0) {
    return {
      type: "split",
      action: "hold",
      symbol: "N/A",
      agreementScore: 0,
      summary: "No votes recorded",
      mostPersuasive: null,
      dissenter: null,
    };
  }

  // Count actions
  const actionCounts = new Map<string, number>();
  for (const v of votes) {
    const key = `${v.action}:${v.symbol}`;
    actionCounts.set(key, (actionCounts.get(key) || 0) + 1);
  }

  // Find majority action
  let majorityKey = "";
  let majorityCount = 0;
  for (const [key, count] of actionCounts) {
    if (count > majorityCount) {
      majorityCount = count;
      majorityKey = key;
    }
  }

  const [majorityAction, majoritySymbol] = majorityKey.split(":");
  const agreementScore = Math.round((majorityCount / votes.length) * 100);

  // Determine type
  let type: "unanimous" | "majority" | "split";
  if (majorityCount === votes.length) {
    type = "unanimous";
  } else if (majorityCount > votes.length / 2) {
    type = "majority";
  } else {
    type = "split";
  }

  // Find most persuasive (agent who convinced others)
  const persuasionCounts = new Map<string, number>();
  for (const v of votes) {
    if (v.convincedBy) {
      persuasionCounts.set(
        v.convincedBy,
        (persuasionCounts.get(v.convincedBy) || 0) + 1,
      );
    }
  }
  let mostPersuasive: string | null = null;
  let maxPersuasion = 0;
  for (const [agent, count] of persuasionCounts) {
    if (count > maxPersuasion) {
      maxPersuasion = count;
      mostPersuasive = agent;
    }
  }

  // Find dissenter
  let dissenter: string | null = null;
  for (const v of votes) {
    if (`${v.action}:${v.symbol}` !== majorityKey) {
      dissenter = v.agentName;
      break;
    }
  }

  // Build summary
  const voters = votes
    .filter((v) => `${v.action}:${v.symbol}` === majorityKey)
    .map((v) => v.agentName);
  const summary =
    type === "unanimous"
      ? `All agents agree: ${majorityAction.toUpperCase()} ${majoritySymbol}`
      : type === "majority"
        ? `${voters.join(" and ")} agree on ${majorityAction.toUpperCase()} ${majoritySymbol}` +
          (dissenter ? ` (${dissenter} dissents)` : "")
        : `No majority — agents disagree on the best action`;

  return {
    type,
    action: majorityAction as "buy" | "sell" | "hold",
    symbol: majoritySymbol,
    agreementScore,
    summary,
    mostPersuasive,
    dissenter,
  };
}

function findKeyDiscrepancies(
  originalResults: TradingRoundResult[],
  finalVotes: MeetingVote[],
): string[] {
  const discrepancies: string[] = [];

  for (const vote of finalVotes) {
    const original = originalResults.find((r) => r.agentId === vote.agentId);
    if (!original) continue;

    // Did the agent change action?
    if (original.decision.action !== vote.action) {
      discrepancies.push(
        `${vote.agentName} changed from ${original.decision.action.toUpperCase()} to ${vote.action.toUpperCase()} ${vote.symbol}`,
      );
    }

    // Did confidence change significantly?
    const confDiff = Math.abs(original.decision.confidence - vote.confidence);
    if (confDiff >= 15) {
      discrepancies.push(
        `${vote.agentName}'s confidence shifted ${confDiff} points (${original.decision.confidence} → ${vote.confidence})`,
      );
    }
  }

  // Different symbols being debated
  const symbols = new Set(originalResults.map((r) => r.decision.symbol));
  if (symbols.size > 1) {
    discrepancies.push(
      `Agents focused on different symbols: ${[...symbols].join(", ")}`,
    );
  }

  return discrepancies;
}

function estimateCost(messageCount: number): number {
  // Rough estimate: ~$0.01 per LLM call for short responses
  return Math.round(messageCount * 0.01 * 100) / 100;
}
