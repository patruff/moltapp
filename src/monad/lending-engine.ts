/**
 * Lending Engine
 *
 * Core lending flow for the $STONKS inter-agent lending system on Monad.
 * Runs as a phase within each trading round:
 *
 * 1. Settle matured loans from previous rounds
 * 2. Identify high-conviction agents (confidence >= 80%)
 * 3. Ask borrower's LLM if it wants to borrow $STONKS
 * 4. Ask other agents' LLMs if they want to lend
 * 5. Match and execute transfers on Monad
 * 6. Record new loans
 */

import Anthropic from "@anthropic-ai/sdk";
import { errorMessage } from "../lib/errors.ts";
import type {
  TradingDecision,
  MarketData,
} from "../agents/base-agent.ts";
import type {
  LendingRoundResult,
  ActiveLoan,
  BorrowerDecision,
  LenderDecision,
} from "./types.ts";
import {
  buildBorrowerPrompt,
  buildLenderPrompt,
  parseBorrowerResponse,
  parseLenderResponse,
} from "./lending-prompts.ts";
import {
  getAgentStonksBalance,
  executeLoanTransfer,
  executeSettlementTransfer,
} from "./stonks-token.ts";
import {
  generateLoanId,
  addActiveLoan,
  getMaturedLoans,
  tickAllLoans,
  settleLoan,
  defaultLoan,
  getTotalBorrowed,
  getTotalLentOut,
} from "./lending-state.ts";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CONFIDENCE_THRESHOLD = 80;
const MAX_BORROW_AMOUNT = 50_000;

// Agent metadata for LLM calls (matches orchestrator agent configs)
const AGENT_META: Record<
  string,
  { name: string; provider: "anthropic" | "openai" | "xai"; tradingStyle: string }
> = {
  "claude-value-investor": {
    name: "Claude ValueBot",
    provider: "anthropic",
    tradingStyle:
      "Value investing — seeks undervalued companies with strong fundamentals.",
  },
  "gpt-momentum-trader": {
    name: "GPT MomentumBot",
    provider: "openai",
    tradingStyle:
      "Momentum trading — buys breakouts, rides trends, cuts losers at -5%.",
  },
  "grok-contrarian": {
    name: "Grok ContrarianBot",
    provider: "xai",
    tradingStyle:
      "Contrarian — buys the dip aggressively, fades rallies.",
  },
};

// ---------------------------------------------------------------------------
// LLM Query Helpers (lightweight — no SDK dependency for OpenAI/xAI)
// ---------------------------------------------------------------------------

/** OpenAI/xAI chat completion response structure */
interface ChatCompletionResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

async function queryLendingLLM(
  agentId: string,
  prompt: string,
): Promise<string> {
  const meta = AGENT_META[agentId];
  if (!meta) throw new Error(`Unknown agent: ${agentId}`);

  switch (meta.provider) {
    case "anthropic": {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
      const client = new Anthropic({ apiKey });
      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 512,
        system:
          "You are an AI trading agent evaluating a $STONKS lending decision on Monad. Respond with valid JSON only.",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
      });
      const textBlock = response.content.find((b) => b.type === "text");
      return textBlock?.type === "text" ? textBlock.text : "";
    }

    case "openai": {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error("Missing OPENAI_API_KEY");
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content:
                "You are an AI trading agent evaluating a $STONKS lending decision on Monad. Respond with valid JSON only.",
            },
            { role: "user", content: prompt },
          ],
          max_completion_tokens: 512,
          response_format: { type: "json_object" },
        }),
      });
      if (!res.ok) throw new Error(`OpenAI: ${res.status} ${await res.text()}`);
      const data = (await res.json()) as ChatCompletionResponse;
      return data.choices[0].message.content.trim();
    }

    case "xai": {
      const apiKey = process.env.XAI_API_KEY;
      if (!apiKey) throw new Error("Missing XAI_API_KEY");
      const res = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "grok-3-mini-fast",
          messages: [
            {
              role: "system",
              content:
                "You are an AI trading agent evaluating a $STONKS lending decision on Monad. Respond with valid JSON only, no markdown.",
            },
            { role: "user", content: prompt },
          ],
          max_tokens: 512,
          temperature: 0.5,
        }),
      });
      if (!res.ok) throw new Error(`Grok: ${res.status} ${await res.text()}`);
      const data = (await res.json()) as ChatCompletionResponse;
      return data.choices[0].message.content.trim();
    }
  }
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

async function settleMaturedLoans(
  roundId: string,
  marketData: MarketData[],
): Promise<LendingRoundResult["settlements"]> {
  const matured = getMaturedLoans();
  const settlements: LendingRoundResult["settlements"] = [];

  for (const loan of matured) {
    try {
      // Find current price of the traded stock
      const currentMd = marketData.find((m) => m.symbol === loan.tradeSymbol);
      const exitPrice = currentMd?.price ?? loan.entryPrice;
      const priceChangePercent =
        ((exitPrice - loan.entryPrice) / loan.entryPrice) * 100;

      // Calculate interest: simple interest per round
      const interestPerRound = loan.amount * loan.interestRate;
      const totalInterest = interestPerRound * loan.roundsElapsed;
      const repaymentAmount = loan.amount + totalInterest;

      // Execute on-chain settlement
      let txHash = "";
      try {
        txHash = await executeSettlementTransfer(
          loan.borrowerId,
          loan.lenderId,
          repaymentAmount,
        );
      } catch (err) {
        console.warn(
          `[Lending] On-chain settlement failed for ${loan.loanId}, recording as default: ${errorMessage(err)}`,
        );
        defaultLoan(loan.loanId);
        settlements.push({
          loanId: loan.loanId,
          borrowerId: loan.borrowerId,
          lenderId: loan.lenderId,
          profitLoss: -loan.amount, // lender loses
        });
        continue;
      }

      // Borrower's P&L from the conviction signal perspective
      const profitLoss = priceChangePercent > 0
        ? totalInterest * 0.5 // Borrower "wins" — interest is the cost of conviction
        : -(totalInterest + loan.amount * 0.1); // Borrower "loses" — extra penalty

      settleLoan(loan.loanId, {
        exitPrice,
        priceChangePercent,
        interestPaid: totalInterest,
        profitLoss,
        txHash,
        settledAtRound: roundId,
      });

      settlements.push({
        loanId: loan.loanId,
        borrowerId: loan.borrowerId,
        lenderId: loan.lenderId,
        profitLoss,
      });

      console.log(
        `[Lending] Settled loan ${loan.loanId}: ${loan.tradeSymbol} moved ${priceChangePercent.toFixed(1)}%, ` +
          `interest ${totalInterest.toFixed(0)} $STONKS, P&L ${profitLoss >= 0 ? "+" : ""}${profitLoss.toFixed(0)}`,
      );
    } catch (err) {
      console.warn(
        `[Lending] Settlement error for ${loan.loanId}: ${errorMessage(err)}`,
      );
    }
  }

  return settlements;
}

// ---------------------------------------------------------------------------
// Main Lending Phase
// ---------------------------------------------------------------------------

interface AgentDecisionPair {
  agentId: string;
  decision: TradingDecision;
}

/**
 * Run the lending phase within a trading round.
 *
 * Called by the orchestrator after all agents have made their trading decisions
 * but before round completion.
 */
export async function runLendingPhase(
  roundId: string,
  agentDecisions: AgentDecisionPair[],
  marketData: MarketData[],
): Promise<LendingRoundResult> {
  const result: LendingRoundResult = {
    roundId,
    loansCreated: 0,
    loansSettled: 0,
    totalStonksBorrowed: 0,
    totalStonksRepaid: 0,
    totalInterestPaid: 0,
    borrowRequests: [],
    lendResponses: [],
    settlements: [],
    errors: [],
  };

  // 0. Tick all active loans (increment round counter)
  tickAllLoans();

  // 1. Settle matured loans
  try {
    const settlements = await settleMaturedLoans(roundId, marketData);
    result.settlements = settlements;
    result.loansSettled = settlements.length;
    result.totalStonksRepaid = settlements.reduce(
      (sum, s) => sum + Math.abs(s.profitLoss),
      0,
    );
    result.totalInterestPaid = settlements.reduce(
      (sum, s) => sum + Math.max(0, s.profitLoss),
      0,
    );
  } catch (err) {
    const msg = `Settlement phase failed: ${errorMessage(err)}`;
    console.warn(`[Lending] ${msg}`);
    result.errors.push(msg);
  }

  // 2. Find high-conviction agents (confidence >= threshold)
  const highConviction = agentDecisions.filter(
    (ad) =>
      ad.decision.confidence >= CONFIDENCE_THRESHOLD &&
      ad.decision.action !== "hold",
  );

  if (highConviction.length === 0) {
    console.log(
      `[Lending] No high-conviction agents this round (threshold: ${CONFIDENCE_THRESHOLD}%)`,
    );
    return result;
  }

  // 3. For each high-conviction agent, ask if they want to borrow
  for (const borrowerPair of highConviction) {
    const { agentId: borrowerId, decision: borrowerDecision } = borrowerPair;
    const borrowerMeta = AGENT_META[borrowerId];
    if (!borrowerMeta) continue;

    let stonksBalance: number;
    try {
      stonksBalance = await getAgentStonksBalance(borrowerId);
    } catch {
      stonksBalance = 0;
    }

    // Build borrower prompt and query LLM
    let borrowerResponse: BorrowerDecision;
    try {
      const borrowerPrompt = buildBorrowerPrompt({
        agentName: borrowerMeta.name,
        tradingStyle: borrowerMeta.tradingStyle,
        decision: borrowerDecision,
        stonksBalance,
        totalBorrowed: getTotalBorrowed(borrowerId),
        totalLentOut: getTotalLentOut(borrowerId),
      });

      const rawResponse = await queryLendingLLM(borrowerId, borrowerPrompt);
      borrowerResponse = parseBorrowerResponse(rawResponse);
    } catch (err) {
      const msg = `Borrower query failed for ${borrowerId}: ${errorMessage(err)}`;
      console.warn(`[Lending] ${msg}`);
      result.errors.push(msg);
      result.borrowRequests.push({
        agentId: borrowerId,
        agentName: borrowerMeta.name,
        requested: false,
        amount: 0,
        matched: false,
      });
      continue;
    }

    result.borrowRequests.push({
      agentId: borrowerId,
      agentName: borrowerMeta.name,
      requested: borrowerResponse.shouldBorrow,
      amount: borrowerResponse.amount,
      matched: false, // updated below if matched
    });

    if (!borrowerResponse.shouldBorrow || borrowerResponse.amount <= 0) {
      console.log(
        `[Lending] ${borrowerMeta.name} declined to borrow: ${borrowerResponse.reasoning}`,
      );
      continue;
    }

    console.log(
      `[Lending] ${borrowerMeta.name} wants to borrow ${borrowerResponse.amount} $STONKS at ${(borrowerResponse.interestRate * 100).toFixed(1)}% for ${borrowerResponse.duration} rounds`,
    );

    // 4. Ask other agents if they want to lend
    const potentialLenders = agentDecisions.filter(
      (ad) => ad.agentId !== borrowerId,
    );

    for (const lenderPair of potentialLenders) {
      const { agentId: lenderId } = lenderPair;
      const lenderMeta = AGENT_META[lenderId];
      if (!lenderMeta) continue;

      let lenderBalance: number;
      try {
        lenderBalance = await getAgentStonksBalance(lenderId);
      } catch {
        lenderBalance = 0;
      }

      const available = lenderBalance - getTotalLentOut(lenderId);
      if (available <= 0) {
        console.log(
          `[Lending] ${lenderMeta.name} has no available $STONKS to lend`,
        );
        result.lendResponses.push({
          agentId: lenderId,
          agentName: lenderMeta.name,
          offered: false,
          amount: 0,
        });
        continue;
      }

      let lenderResponse: LenderDecision;
      try {
        const lenderPrompt = buildLenderPrompt({
          lenderName: lenderMeta.name,
          lenderTradingStyle: lenderMeta.tradingStyle,
          lenderStonksBalance: lenderBalance,
          lenderTotalLentOut: getTotalLentOut(lenderId),
          borrowerName: borrowerMeta.name,
          borrowerDecision,
          requestedAmount: borrowerResponse.amount,
          proposedRate: borrowerResponse.interestRate,
          proposedDuration: borrowerResponse.duration,
          borrowerReasoning: borrowerResponse.reasoning,
        });

        const rawResponse = await queryLendingLLM(lenderId, lenderPrompt);
        lenderResponse = parseLenderResponse(rawResponse);
      } catch (err) {
        const msg = `Lender query failed for ${lenderId}: ${errorMessage(err)}`;
        console.warn(`[Lending] ${msg}`);
        result.errors.push(msg);
        result.lendResponses.push({
          agentId: lenderId,
          agentName: lenderMeta.name,
          offered: false,
          amount: 0,
        });
        continue;
      }

      result.lendResponses.push({
        agentId: lenderId,
        agentName: lenderMeta.name,
        offered: lenderResponse.shouldLend,
        amount: lenderResponse.amountWilling,
      });

      if (!lenderResponse.shouldLend || lenderResponse.amountWilling <= 0) {
        console.log(
          `[Lending] ${lenderMeta.name} declined to lend: ${lenderResponse.reasoning}`,
        );
        continue;
      }

      // 5. Match! Agree on terms and execute transfer
      const agreedAmount = Math.min(
        borrowerResponse.amount,
        lenderResponse.amountWilling,
        available,
        MAX_BORROW_AMOUNT,
      );
      const agreedRate = (borrowerResponse.interestRate + lenderResponse.counterRate) / 2;

      if (agreedAmount <= 0) continue;

      console.log(
        `[Lending] MATCH: ${lenderMeta.name} → ${borrowerMeta.name}: ${agreedAmount} $STONKS at ${(agreedRate * 100).toFixed(1)}%`,
      );

      // Execute on-chain transfer
      let txHash: string;
      try {
        txHash = await executeLoanTransfer(lenderId, borrowerId, agreedAmount);
      } catch (err) {
        const msg = `On-chain transfer failed: ${errorMessage(err)}`;
        console.warn(`[Lending] ${msg}`);
        result.errors.push(msg);
        continue;
      }

      // Get entry price for the traded stock
      const stockMd = marketData.find(
        (m) => m.symbol === borrowerDecision.symbol,
      );
      const entryPrice = stockMd?.price ?? 0;

      // Record the loan
      const loan: ActiveLoan = {
        loanId: generateLoanId(),
        borrowerId,
        borrowerName: borrowerMeta.name,
        lenderId,
        lenderName: lenderMeta.name,
        amount: agreedAmount,
        interestRate: agreedRate,
        duration: borrowerResponse.duration,
        createdAtRound: roundId,
        maturesAtRound: borrowerResponse.duration,
        roundsElapsed: 0,
        tradeThesis: borrowerDecision.reasoning,
        tradeSymbol: borrowerDecision.symbol,
        entryPrice,
        txHash,
        status: "active",
        createdAt: new Date().toISOString(),
      };

      addActiveLoan(loan);

      result.loansCreated++;
      result.totalStonksBorrowed += agreedAmount;

      // Mark the borrow request as matched
      const borrowReq = result.borrowRequests.find(
        (r) => r.agentId === borrowerId,
      );
      if (borrowReq) borrowReq.matched = true;

      // Only match with the first willing lender per borrower
      break;
    }
  }

  console.log(
    `[Lending] Round ${roundId} complete: ${result.loansCreated} new loans, ${result.loansSettled} settled, ${result.totalStonksBorrowed} $STONKS moved`,
  );

  return result;
}
