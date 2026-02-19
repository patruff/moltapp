/**
 * Lending Prompts
 *
 * Builds LLM prompts for borrower and lender decisions in the $STONKS
 * inter-agent lending system on Monad.
 */

import type { TradingDecision } from "../agents/base-agent.ts";
import { clamp } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Loan Amount Constraints
// ---------------------------------------------------------------------------

/**
 * Hard ceiling on how many $STONKS a borrower may request in a single loan.
 * Prevents any single agent from monopolising the lending pool.
 * Communicated to the LLM in the borrower prompt ("max 50000").
 */
const LENDING_MAX_BORROW_AMOUNT = 50_000;

// ---------------------------------------------------------------------------
// Interest Rate Constraints  (per-round fraction, e.g. 0.05 = 5 %)
// ---------------------------------------------------------------------------

/**
 * Fallback interest rate used when the LLM omits the field.
 * 5 % per round is the "market-rate" starting point for both borrower proposals
 * and lender counter-offers.
 */
const LENDING_DEFAULT_INTEREST_RATE = 0.05;

/** Absolute floor — 0 % loans are allowed (goodwill / alliance signals). */
const LENDING_MIN_INTEREST_RATE = 0;

/**
 * Hard ceiling on interest rates.
 * 20 % per round prevents predatory lending that would bankrupt borrowers in
 * a single bad round.
 */
const LENDING_MAX_INTEREST_RATE = 0.20;

// ---------------------------------------------------------------------------
// Loan Duration Constraints  (in trading rounds)
// ---------------------------------------------------------------------------

/**
 * Fallback duration when the LLM omits the field.
 * 2 rounds gives the borrower one round to execute and one round to settle.
 */
const LENDING_DEFAULT_DURATION_ROUNDS = 2;

/** Maximum loan term. 6 rounds ≈ 3 hours of trading at a 30-minute interval. */
const LENDING_MAX_DURATION_ROUNDS = 6;

/** Minimum loan term — at least 1 round so the trade has time to play out. */
const LENDING_MIN_DURATION_ROUNDS = 1;

/**
 * Build the prompt asking a high-conviction agent if it wants to borrow $STONKS.
 */
export function buildBorrowerPrompt(args: {
  agentName: string;
  tradingStyle: string;
  decision: TradingDecision;
  stonksBalance: number;
  totalBorrowed: number;
  totalLentOut: number;
}): string {
  return `You are ${args.agentName}, competing in the MoltApp AI trading benchmark.

You just made a HIGH-CONVICTION trade decision:
  Action: ${args.decision.action} ${args.decision.symbol}
  Confidence: ${args.decision.confidence}%
  Reasoning: ${args.decision.reasoning}

YOUR $STONKS PORTFOLIO (on Monad):
  Balance: ${args.stonksBalance.toFixed(0)} $STONKS
  Currently borrowed: ${args.totalBorrowed.toFixed(0)} $STONKS
  Currently lent out: ${args.totalLentOut.toFixed(0)} $STONKS

CONTEXT: $STONKS is a conviction-signaling token on Monad. When you borrow $STONKS from other agents, you're putting your reputation on the line — if your trade thesis is right, you profit and pay back with modest interest. If wrong, you lose $STONKS and pay interest on a losing position.

Borrowing $STONKS amplifies your conviction signal on the public leaderboard. Other agents and observers can see who is borrowing (high conviction) and who is lending (moderate conviction).

Your trading style: ${args.tradingStyle}

Should you borrow $STONKS to amplify your conviction on this trade?

Respond with ONLY valid JSON:
{
  "shouldBorrow": true | false,
  "amount": <number of $STONKS to borrow, 0 if not borrowing, max 50000>,
  "interestRate": <proposed annual rate, e.g. 0.05 for 5%>,
  "duration": <number of trading rounds, 1-6>,
  "reasoning": "<why you want/don't want to borrow>"
}`;
}

/**
 * Build the prompt asking an agent if it wants to lend $STONKS to a borrower.
 */
export function buildLenderPrompt(args: {
  lenderName: string;
  lenderTradingStyle: string;
  lenderStonksBalance: number;
  lenderTotalLentOut: number;
  borrowerName: string;
  borrowerDecision: TradingDecision;
  requestedAmount: number;
  proposedRate: number;
  proposedDuration: number;
  borrowerReasoning: string;
}): string {
  return `You are ${args.lenderName}, competing in the MoltApp AI trading benchmark.

Another agent wants to BORROW $STONKS from you:

BORROWER: ${args.borrowerName}
  Trade: ${args.borrowerDecision.action} ${args.borrowerDecision.symbol}
  Confidence: ${args.borrowerDecision.confidence}%
  Thesis: ${args.borrowerDecision.reasoning}
  Borrowing reason: ${args.borrowerReasoning}

LOAN TERMS PROPOSED:
  Amount: ${args.requestedAmount.toFixed(0)} $STONKS
  Interest rate: ${(args.proposedRate * 100).toFixed(1)}% per round
  Duration: ${args.proposedDuration} rounds

YOUR $STONKS PORTFOLIO:
  Balance: ${args.lenderStonksBalance.toFixed(0)} $STONKS
  Already lent out: ${args.lenderTotalLentOut.toFixed(0)} $STONKS
  Available: ${(args.lenderStonksBalance - args.lenderTotalLentOut).toFixed(0)} $STONKS

Your trading style: ${args.lenderTradingStyle}

CONTEXT: Lending $STONKS earns you interest and shows confidence in another agent's thesis. If the borrower's trade goes well, you get repaid with interest. If it goes poorly, the borrower may default (partial repayment).

Should you lend $STONKS to ${args.borrowerName}?

Respond with ONLY valid JSON:
{
  "shouldLend": true | false,
  "amountWilling": <$STONKS amount you'd lend, 0 if not lending>,
  "counterRate": <your preferred interest rate, e.g. 0.08 for 8%>,
  "reasoning": "<why you would/wouldn't lend>",
  "riskAssessment": "<your assessment of the borrower's trade thesis>"
}`;
}

/** Parse a borrower decision from raw LLM text */
export function parseBorrowerResponse(raw: string): {
  shouldBorrow: boolean;
  amount: number;
  interestRate: number;
  duration: number;
  reasoning: string;
} {
  const cleaned = stripMarkdown(raw);
  const parsed = JSON.parse(cleaned);
  return {
    shouldBorrow: !!parsed.shouldBorrow,
    amount: Math.max(0, Math.min(LENDING_MAX_BORROW_AMOUNT, Number(parsed.amount) || 0)),
    interestRate: clamp(Number(parsed.interestRate) || LENDING_DEFAULT_INTEREST_RATE, LENDING_MIN_INTEREST_RATE, LENDING_MAX_INTEREST_RATE),
    duration: Math.max(LENDING_MIN_DURATION_ROUNDS, Math.min(LENDING_MAX_DURATION_ROUNDS, Math.round(Number(parsed.duration) || LENDING_DEFAULT_DURATION_ROUNDS))),
    reasoning: String(parsed.reasoning || "No reasoning provided"),
  };
}

/** Parse a lender decision from raw LLM text */
export function parseLenderResponse(raw: string): {
  shouldLend: boolean;
  amountWilling: number;
  counterRate: number;
  reasoning: string;
  riskAssessment: string;
} {
  const cleaned = stripMarkdown(raw);
  const parsed = JSON.parse(cleaned);
  return {
    shouldLend: !!parsed.shouldLend,
    amountWilling: Math.max(0, Number(parsed.amountWilling) || 0),
    counterRate: clamp(Number(parsed.counterRate) || LENDING_DEFAULT_INTEREST_RATE, LENDING_MIN_INTEREST_RATE, LENDING_MAX_INTEREST_RATE),
    reasoning: String(parsed.reasoning || "No reasoning provided"),
    riskAssessment: String(parsed.riskAssessment || "No assessment provided"),
  };
}

/** Strip markdown code fences and find JSON */
function stripMarkdown(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
  if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
  cleaned = cleaned.trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON found in LLM response: ${raw.slice(0, 200)}`);
  return match[0];
}
