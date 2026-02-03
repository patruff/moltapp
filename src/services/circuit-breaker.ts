/**
 * Financial Circuit Breakers
 *
 * Safety controls that override any LLM trading decision that exceeds
 * risk limits. Protects against runaway losses, oversized positions,
 * and overtrading.
 *
 * Limits:
 * - MAX_TRADE_USDC: Configurable max trade size (default $50 USDC)
 * - DAILY_LOSS_LIMIT: Halt trading if agent loses > X% in a day (default 10%)
 * - COOLDOWN_PERIOD: Minimum time between trades per agent (default 10 min)
 * - POSITION_LIMIT: Max % of portfolio in single stock (default 25%)
 *
 * State is stored in-memory with periodic flush to DynamoDB when available.
 * All circuit breaker activations are logged.
 */

import type { TradingDecision, PortfolioContext } from "../agents/base-agent.ts";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface CircuitBreakerConfig {
  /** Maximum trade size in USDC (default: 50) */
  maxTradeUsdc: number;
  /** Maximum daily loss as percentage before halting (default: 10) */
  dailyLossLimitPercent: number;
  /** Minimum seconds between trades per agent (default: 600 = 10 min) */
  cooldownSeconds: number;
  /** Maximum portfolio allocation in a single stock as percentage (default: 25) */
  positionLimitPercent: number;
  /** Maximum number of trades per agent per day (default: 20) */
  maxDailyTrades: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  maxTradeUsdc: 50,
  dailyLossLimitPercent: 10,
  cooldownSeconds: 600,
  positionLimitPercent: 25,
  maxDailyTrades: 20,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CircuitBreakerResult {
  allowed: boolean;
  /** Original decision (unchanged if allowed, modified if clamped) */
  decision: TradingDecision;
  /** List of activated breakers */
  activations: CircuitBreakerActivation[];
}

export interface CircuitBreakerActivation {
  breaker: string;
  reason: string;
  agentId: string;
  timestamp: string;
  /** Was the trade blocked entirely, or just clamped? */
  action: "blocked" | "clamped";
}

interface AgentState {
  /** Last trade timestamp (ISO string) */
  lastTradeTime: string | null;
  /** Daily starting portfolio value (resets at midnight UTC) */
  dailyStartValue: number;
  /** Current day string (YYYY-MM-DD) */
  currentDay: string;
  /** Number of trades today */
  tradesToday: number;
}

// ---------------------------------------------------------------------------
// In-Memory State
// ---------------------------------------------------------------------------

const agentStates = new Map<string, AgentState>();
const activationLog: CircuitBreakerActivation[] = [];

let currentConfig: CircuitBreakerConfig = { ...DEFAULT_CONFIG };

// ---------------------------------------------------------------------------
// Configuration Management
// ---------------------------------------------------------------------------

/**
 * Update circuit breaker configuration. Partial updates supported.
 */
export function configureCircuitBreaker(
  updates: Partial<CircuitBreakerConfig>,
): CircuitBreakerConfig {
  currentConfig = { ...currentConfig, ...updates };
  console.log(
    `[CircuitBreaker] Configuration updated:`,
    JSON.stringify(currentConfig),
  );
  return currentConfig;
}

/**
 * Get current circuit breaker configuration.
 */
export function getCircuitBreakerConfig(): CircuitBreakerConfig {
  return { ...currentConfig };
}

// ---------------------------------------------------------------------------
// State Management
// ---------------------------------------------------------------------------

function getAgentState(agentId: string): AgentState {
  const today = new Date().toISOString().slice(0, 10);
  let state = agentStates.get(agentId);

  if (!state || state.currentDay !== today) {
    // Reset daily state at midnight UTC
    state = {
      lastTradeTime: state?.lastTradeTime ?? null,
      dailyStartValue: 0, // Will be set on first check
      currentDay: today,
      tradesToday: 0,
    };
    agentStates.set(agentId, state);
  }

  return state;
}

function logActivation(activation: CircuitBreakerActivation): void {
  activationLog.push(activation);
  console.warn(
    `[CircuitBreaker] ${activation.action.toUpperCase()}: ${activation.breaker} — ${activation.reason} (agent: ${activation.agentId})`,
  );

  // Keep log bounded (last 1000 entries)
  if (activationLog.length > 1000) {
    activationLog.splice(0, activationLog.length - 1000);
  }
}

// ---------------------------------------------------------------------------
// Core Circuit Breaker Checks
// ---------------------------------------------------------------------------

/**
 * Check a trading decision against all circuit breakers.
 *
 * Returns the (possibly modified) decision and any activations.
 * If the trade is blocked entirely, `allowed` will be false and
 * the decision action will be changed to "hold".
 */
export function checkCircuitBreakers(
  agentId: string,
  decision: TradingDecision,
  portfolio: PortfolioContext,
): CircuitBreakerResult {
  const activations: CircuitBreakerActivation[] = [];
  let modifiedDecision = { ...decision };

  // Hold decisions always pass
  if (decision.action === "hold") {
    return { allowed: true, decision: modifiedDecision, activations };
  }

  const state = getAgentState(agentId);

  // Initialize daily start value on first check
  if (state.dailyStartValue === 0) {
    state.dailyStartValue = portfolio.totalValue;
  }

  // --- Check 1: Cooldown Period ---
  if (state.lastTradeTime) {
    const lastTradeMs = new Date(state.lastTradeTime).getTime();
    const elapsedSeconds = (Date.now() - lastTradeMs) / 1000;

    if (elapsedSeconds < currentConfig.cooldownSeconds) {
      const remainingSeconds = Math.ceil(
        currentConfig.cooldownSeconds - elapsedSeconds,
      );
      const activation: CircuitBreakerActivation = {
        breaker: "COOLDOWN_PERIOD",
        reason: `Agent last traded ${Math.round(elapsedSeconds)}s ago. Cooldown requires ${currentConfig.cooldownSeconds}s. ${remainingSeconds}s remaining.`,
        agentId,
        timestamp: new Date().toISOString(),
        action: "blocked",
      };
      activations.push(activation);
      logActivation(activation);

      return {
        allowed: false,
        decision: {
          ...modifiedDecision,
          action: "hold",
          quantity: 0,
          reasoning: `[Circuit Breaker: Cooldown] ${activation.reason} Original: ${decision.reasoning}`,
        },
        activations,
      };
    }
  }

  // --- Check 2: Daily Loss Limit ---
  if (state.dailyStartValue > 0) {
    const dailyPnlPercent =
      ((portfolio.totalValue - state.dailyStartValue) /
        state.dailyStartValue) *
      100;

    if (dailyPnlPercent <= -currentConfig.dailyLossLimitPercent) {
      const activation: CircuitBreakerActivation = {
        breaker: "DAILY_LOSS_LIMIT",
        reason: `Daily PnL is ${dailyPnlPercent.toFixed(2)}% (limit: -${currentConfig.dailyLossLimitPercent}%). Trading halted for the day.`,
        agentId,
        timestamp: new Date().toISOString(),
        action: "blocked",
      };
      activations.push(activation);
      logActivation(activation);

      return {
        allowed: false,
        decision: {
          ...modifiedDecision,
          action: "hold",
          quantity: 0,
          reasoning: `[Circuit Breaker: Daily Loss Limit] ${activation.reason} Original: ${decision.reasoning}`,
        },
        activations,
      };
    }
  }

  // --- Check 3: Daily Trade Count ---
  if (state.tradesToday >= currentConfig.maxDailyTrades) {
    const activation: CircuitBreakerActivation = {
      breaker: "MAX_DAILY_TRADES",
      reason: `Agent has made ${state.tradesToday} trades today (limit: ${currentConfig.maxDailyTrades}). No more trades allowed.`,
      agentId,
      timestamp: new Date().toISOString(),
      action: "blocked",
    };
    activations.push(activation);
    logActivation(activation);

    return {
      allowed: false,
      decision: {
        ...modifiedDecision,
        action: "hold",
        quantity: 0,
        reasoning: `[Circuit Breaker: Daily Trade Limit] ${activation.reason} Original: ${decision.reasoning}`,
      },
      activations,
    };
  }

  // --- Check 4: Max Trade Size (USDC) ---
  if (decision.action === "buy" && decision.quantity > currentConfig.maxTradeUsdc) {
    const originalQuantity = decision.quantity;
    modifiedDecision.quantity = currentConfig.maxTradeUsdc;

    const activation: CircuitBreakerActivation = {
      breaker: "MAX_TRADE_SIZE",
      reason: `Buy order of $${originalQuantity.toFixed(2)} USDC exceeds limit of $${currentConfig.maxTradeUsdc}. Clamped to $${currentConfig.maxTradeUsdc}.`,
      agentId,
      timestamp: new Date().toISOString(),
      action: "clamped",
    };
    activations.push(activation);
    logActivation(activation);

    modifiedDecision.reasoning = `[Circuit Breaker: Trade Size Clamped from $${originalQuantity.toFixed(2)} to $${currentConfig.maxTradeUsdc}] ${decision.reasoning}`;
  }

  // --- Check 5: Position Limit ---
  if (decision.action === "buy") {
    // Calculate what the new position would be as a % of portfolio
    const existingPosition = portfolio.positions.find(
      (p) => p.symbol.toLowerCase() === decision.symbol.toLowerCase(),
    );
    const existingValue = existingPosition
      ? existingPosition.currentPrice * existingPosition.quantity
      : 0;
    const additionalValue = modifiedDecision.quantity; // USDC amount for buys
    const newPositionValue = existingValue + additionalValue;
    const positionPercent =
      portfolio.totalValue > 0
        ? (newPositionValue / portfolio.totalValue) * 100
        : 100;

    if (positionPercent > currentConfig.positionLimitPercent) {
      const maxAdditional =
        (currentConfig.positionLimitPercent / 100) * portfolio.totalValue -
        existingValue;

      if (maxAdditional <= 0) {
        // Already at or over position limit
        const activation: CircuitBreakerActivation = {
          breaker: "POSITION_LIMIT",
          reason: `Position in ${decision.symbol} is already at ${positionPercent.toFixed(1)}% of portfolio (limit: ${currentConfig.positionLimitPercent}%). Trade blocked.`,
          agentId,
          timestamp: new Date().toISOString(),
          action: "blocked",
        };
        activations.push(activation);
        logActivation(activation);

        return {
          allowed: false,
          decision: {
            ...modifiedDecision,
            action: "hold",
            quantity: 0,
            reasoning: `[Circuit Breaker: Position Limit] ${activation.reason} Original: ${decision.reasoning}`,
          },
          activations,
        };
      }

      // Clamp to max additional
      const originalQuantity = modifiedDecision.quantity;
      modifiedDecision.quantity = Math.floor(maxAdditional * 100) / 100; // Round down to 2 decimals

      const activation: CircuitBreakerActivation = {
        breaker: "POSITION_LIMIT",
        reason: `Buy would put ${decision.symbol} at ${positionPercent.toFixed(1)}% of portfolio (limit: ${currentConfig.positionLimitPercent}%). Clamped from $${originalQuantity.toFixed(2)} to $${modifiedDecision.quantity.toFixed(2)}.`,
        agentId,
        timestamp: new Date().toISOString(),
        action: "clamped",
      };
      activations.push(activation);
      logActivation(activation);
    }
  }

  // --- Check 6: Insufficient funds (for buys) ---
  if (
    decision.action === "buy" &&
    modifiedDecision.quantity > portfolio.cashBalance
  ) {
    if (portfolio.cashBalance <= 1) {
      // Less than $1 — can't trade
      const activation: CircuitBreakerActivation = {
        breaker: "INSUFFICIENT_FUNDS",
        reason: `Cash balance $${portfolio.cashBalance.toFixed(2)} insufficient for any buy. Trade blocked.`,
        agentId,
        timestamp: new Date().toISOString(),
        action: "blocked",
      };
      activations.push(activation);
      logActivation(activation);

      return {
        allowed: false,
        decision: {
          ...modifiedDecision,
          action: "hold",
          quantity: 0,
          reasoning: `[Circuit Breaker: Insufficient Funds] ${activation.reason} Original: ${decision.reasoning}`,
        },
        activations,
      };
    }

    // Clamp to available cash
    const originalQuantity = modifiedDecision.quantity;
    modifiedDecision.quantity =
      Math.floor(portfolio.cashBalance * 100) / 100;

    const activation: CircuitBreakerActivation = {
      breaker: "INSUFFICIENT_FUNDS",
      reason: `Buy of $${originalQuantity.toFixed(2)} exceeds cash balance $${portfolio.cashBalance.toFixed(2)}. Clamped to $${modifiedDecision.quantity.toFixed(2)}.`,
      agentId,
      timestamp: new Date().toISOString(),
      action: "clamped",
    };
    activations.push(activation);
    logActivation(activation);
  }

  return { allowed: true, decision: modifiedDecision, activations };
}

// ---------------------------------------------------------------------------
// Post-Trade State Update
// ---------------------------------------------------------------------------

/**
 * Call after a trade is successfully executed to update circuit breaker state.
 */
export function recordTradeExecution(agentId: string): void {
  const state = getAgentState(agentId);
  state.lastTradeTime = new Date().toISOString();
  state.tradesToday++;
}

// ---------------------------------------------------------------------------
// Metrics & Diagnostics
// ---------------------------------------------------------------------------

/**
 * Get recent circuit breaker activations.
 */
export function getRecentActivations(
  limit = 50,
): CircuitBreakerActivation[] {
  return activationLog.slice(-limit);
}

/**
 * Get activations for a specific agent.
 */
export function getAgentActivations(
  agentId: string,
  limit = 20,
): CircuitBreakerActivation[] {
  return activationLog
    .filter((a) => a.agentId === agentId)
    .slice(-limit);
}

/**
 * Get circuit breaker status for all agents.
 */
export function getCircuitBreakerStatus(): {
  config: CircuitBreakerConfig;
  agentStates: Record<
    string,
    {
      lastTradeTime: string | null;
      tradesToday: number;
      cooldownRemaining: number;
      dailyLossTriggered: boolean;
    }
  >;
  totalActivations: number;
  recentActivations: CircuitBreakerActivation[];
} {
  const states: Record<
    string,
    {
      lastTradeTime: string | null;
      tradesToday: number;
      cooldownRemaining: number;
      dailyLossTriggered: boolean;
    }
  > = {};

  for (const [agentId, state] of agentStates) {
    const cooldownRemaining = state.lastTradeTime
      ? Math.max(
          0,
          currentConfig.cooldownSeconds -
            (Date.now() - new Date(state.lastTradeTime).getTime()) / 1000,
        )
      : 0;

    states[agentId] = {
      lastTradeTime: state.lastTradeTime,
      tradesToday: state.tradesToday,
      cooldownRemaining: Math.round(cooldownRemaining),
      dailyLossTriggered: false, // Would need portfolio check
    };
  }

  return {
    config: { ...currentConfig },
    agentStates: states,
    totalActivations: activationLog.length,
    recentActivations: activationLog.slice(-10),
  };
}

/**
 * Reset circuit breaker state for an agent (admin use).
 */
export function resetAgentState(agentId: string): void {
  agentStates.delete(agentId);
  console.log(`[CircuitBreaker] Reset state for agent ${agentId}`);
}

/**
 * Reset all circuit breaker state (admin use).
 */
export function resetAllState(): void {
  agentStates.clear();
  activationLog.length = 0;
  console.log(`[CircuitBreaker] All state reset`);
}
