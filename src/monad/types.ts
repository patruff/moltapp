/**
 * Monad $STONKS Lending Types
 *
 * Interfaces for the inter-agent lending/liquidity layer on Monad.
 * AI agents borrow $STONKS as a "conviction signal" when they have
 * high confidence in a trade, paying interest to lenders.
 */

/** A request from a borrower agent to borrow $STONKS */
export interface LoanRequest {
  borrowerId: string;
  borrowerName: string;
  /** $STONKS amount requested */
  amount: number;
  /** Annual interest rate proposed (e.g., 0.05 = 5%) */
  interestRate: number;
  /** Duration in trading rounds */
  duration: number;
  /** The trade thesis backing this loan */
  tradeThesis: string;
  /** Confidence in the underlying trade (0-100) */
  tradeConfidence: number;
  /** The stock symbol the borrower is trading */
  tradeSymbol: string;
  /** The trade action (buy/sell) */
  tradeAction: "buy" | "sell";
  /** LLM reasoning for wanting to borrow */
  reasoning: string;
}

/** A lender's response to a loan request */
export interface LoanResponse {
  lenderId: string;
  lenderName: string;
  /** Whether the lender agrees to lend */
  shouldLend: boolean;
  /** Amount willing to lend (may be less than requested) */
  amountWilling: number;
  /** Counter interest rate (may differ from borrower's proposal) */
  counterRate: number;
  /** LLM reasoning for decision */
  reasoning: string;
  /** Risk assessment of the borrower's trade */
  riskAssessment: string;
}

/** An active loan between two agents */
export interface ActiveLoan {
  loanId: string;
  borrowerId: string;
  borrowerName: string;
  lenderId: string;
  lenderName: string;
  /** $STONKS amount lent */
  amount: number;
  /** Agreed interest rate */
  interestRate: number;
  /** Duration in rounds */
  duration: number;
  /** Round when loan was created */
  createdAtRound: string;
  /** Round when loan matures */
  maturesAtRound: number;
  /** Current round counter (incremented each round) */
  roundsElapsed: number;
  /** The trade thesis backing this loan */
  tradeThesis: string;
  /** Symbol being traded */
  tradeSymbol: string;
  /** Price of the traded stock at loan creation */
  entryPrice: number;
  /** Monad TX hash for the initial transfer */
  txHash: string;
  /** Loan status */
  status: "active" | "settled" | "defaulted";
  /** Settlement details (populated when settled) */
  settlement?: {
    exitPrice: number;
    priceChangePercent: number;
    interestPaid: number;
    profitLoss: number;
    txHash: string;
    settledAtRound: string;
  };
  createdAt: string;
}

/** Result of a lending phase within a trading round */
export interface LendingRoundResult {
  roundId: string;
  loansCreated: number;
  loansSettled: number;
  totalStonksBorrowed: number;
  totalStonksRepaid: number;
  totalInterestPaid: number;
  borrowRequests: Array<{
    agentId: string;
    agentName: string;
    requested: boolean;
    amount: number;
    matched: boolean;
  }>;
  lendResponses: Array<{
    agentId: string;
    agentName: string;
    offered: boolean;
    amount: number;
  }>;
  settlements: Array<{
    loanId: string;
    borrowerId: string;
    lenderId: string;
    profitLoss: number;
  }>;
  errors: string[];
}

/** Borrower LLM decision */
export interface BorrowerDecision {
  shouldBorrow: boolean;
  amount: number;
  interestRate: number;
  duration: number;
  reasoning: string;
}

/** Lender LLM decision */
export interface LenderDecision {
  shouldLend: boolean;
  amountWilling: number;
  counterRate: number;
  reasoning: string;
  riskAssessment: string;
}
