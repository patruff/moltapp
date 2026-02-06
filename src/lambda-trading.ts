/**
 * Lambda Trading Handler
 *
 * Dedicated Lambda function for scheduled AI trading rounds.
 * Triggered by EventBridge every 30 minutes.
 *
 * This runs all 3 AI agents (Claude, GPT, Grok) in parallel,
 * collects their trading decisions, and records them to the database.
 */

import type { EventBridgeEvent } from "aws-lambda";
import { runTradingRound } from "./agents/orchestrator.ts";
import { errorMessage } from "./lib/errors.ts";

interface TradingTrigger {
  trigger: string;
  source: string;
}

export async function handler(
  event: EventBridgeEvent<string, TradingTrigger>,
) {
  console.log("[TradingLambda] Received event:", JSON.stringify(event));

  const startTime = Date.now();

  try {
    const result = await runTradingRound();

    const duration = Date.now() - startTime;
    console.log(
      `[TradingLambda] Round ${result.roundId} completed in ${duration}ms`,
    );
    console.log(
      `[TradingLambda] Results: ${result.results.length} agents, ${result.errors.length} errors`,
    );

    for (const r of result.results) {
      console.log(
        `[TradingLambda] ${r.agentName}: ${r.decision.action} ${r.decision.symbol} (confidence: ${r.decision.confidence}%, executed: ${r.executed})`,
      );
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        roundId: result.roundId,
        timestamp: result.timestamp,
        durationMs: duration,
        agentCount: result.results.length,
        errorCount: result.errors.length,
        decisions: result.results.map((r) => ({
          agent: r.agentName,
          action: r.decision.action,
          symbol: r.decision.symbol,
          confidence: r.decision.confidence,
          executed: r.executed,
        })),
      }),
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const message = errorMessage(error);
    console.error(
      `[TradingLambda] Fatal error after ${duration}ms: ${message}`,
    );

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "trading_round_failed",
        message,
        durationMs: duration,
      }),
    };
  }
}
