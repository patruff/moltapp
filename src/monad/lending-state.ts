/**
 * Lending State Manager
 *
 * In-memory state for active $STONKS loans between agents.
 * DynamoDB persistence is optional (for hackathon, in-memory is sufficient).
 */

import type { ActiveLoan } from "./types.ts";

// ---------------------------------------------------------------------------
// In-Memory State
// ---------------------------------------------------------------------------

const activeLoans: Map<string, ActiveLoan> = new Map();
const settledLoans: ActiveLoan[] = [];
let loanCounter = 0;

/** Generate a unique loan ID */
export function generateLoanId(): string {
  loanCounter++;
  return `loan-${Date.now()}-${loanCounter}`;
}

/** Store a new active loan */
export function addActiveLoan(loan: ActiveLoan): void {
  activeLoans.set(loan.loanId, loan);
  console.log(
    `[LendingState] New loan ${loan.loanId}: ${loan.borrowerName} borrowed ${loan.amount} $STONKS from ${loan.lenderName}`,
  );
}

/** Get all active loans */
export function getActiveLoans(): ActiveLoan[] {
  return Array.from(activeLoans.values()).filter((l) => l.status === "active");
}

/** Get active loans for a specific borrower */
export function getBorrowerLoans(borrowerId: string): ActiveLoan[] {
  return getActiveLoans().filter((l) => l.borrowerId === borrowerId);
}

/** Get active loans for a specific lender */
export function getLenderLoans(lenderId: string): ActiveLoan[] {
  return getActiveLoans().filter((l) => l.lenderId === lenderId);
}

/** Get a loan by ID */
export function getLoan(loanId: string): ActiveLoan | undefined {
  return activeLoans.get(loanId);
}

/** Get loans that are due for settlement (elapsed >= duration) */
export function getMaturedLoans(): ActiveLoan[] {
  return getActiveLoans().filter((l) => l.roundsElapsed >= l.duration);
}

/** Increment round counter for all active loans */
export function tickAllLoans(): void {
  for (const loan of getActiveLoans()) {
    loan.roundsElapsed++;
  }
}

/** Mark a loan as settled */
export function settleLoan(
  loanId: string,
  settlement: NonNullable<ActiveLoan["settlement"]>,
): void {
  const loan = activeLoans.get(loanId);
  if (!loan) {
    throw new Error(`Loan ${loanId} not found`);
  }
  loan.status = "settled";
  loan.settlement = settlement;
  settledLoans.push(loan);
  console.log(
    `[LendingState] Loan ${loanId} settled: P&L ${settlement.profitLoss >= 0 ? "+" : ""}${settlement.profitLoss.toFixed(2)} $STONKS`,
  );
}

/** Mark a loan as defaulted (borrower can't repay) */
export function defaultLoan(loanId: string): void {
  const loan = activeLoans.get(loanId);
  if (!loan) return;
  loan.status = "defaulted";
  settledLoans.push(loan);
  console.log(`[LendingState] Loan ${loanId} DEFAULTED by ${loan.borrowerName}`);
}

/** Get total $STONKS currently lent out by an agent */
export function getTotalLentOut(lenderId: string): number {
  return getActiveLoans()
    .filter((l) => l.lenderId === lenderId)
    .reduce((sum, l) => sum + l.amount, 0);
}

/** Get total $STONKS currently borrowed by an agent */
export function getTotalBorrowed(borrowerId: string): number {
  return getActiveLoans()
    .filter((l) => l.borrowerId === borrowerId)
    .reduce((sum, l) => sum + l.amount, 0);
}

/** Get lending history summary */
export function getLendingSummary(): {
  activeCount: number;
  settledCount: number;
  totalBorrowed: number;
  totalInterestPaid: number;
} {
  const active = getActiveLoans();
  return {
    activeCount: active.length,
    settledCount: settledLoans.length,
    totalBorrowed: active.reduce((sum, l) => sum + l.amount, 0),
    totalInterestPaid: settledLoans.reduce(
      (sum, l) => sum + (l.settlement?.interestPaid ?? 0),
      0,
    ),
  };
}

/** Get all settled loans */
export function getSettledLoans(): ActiveLoan[] {
  return [...settledLoans];
}

/** Clear all state (for testing) */
export function resetLendingState(): void {
  activeLoans.clear();
  settledLoans.length = 0;
  loanCounter = 0;
}
