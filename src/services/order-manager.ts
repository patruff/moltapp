/**
 * Advanced Order Manager
 *
 * Extends the basic market-order-only execution with sophisticated order types
 * that real trading platforms need:
 *
 * 1. Limit Orders — execute only when price reaches target
 * 2. Stop-Loss Orders — automatic sell when price drops below threshold
 * 3. Trailing Stop Orders — dynamic stop that follows price upward
 * 4. Take-Profit Orders — automatic sell at profit target
 * 5. Bracket Orders — combined entry + stop-loss + take-profit
 *
 * Orders are evaluated against the real-time price stream every tick.
 * When an order triggers, it's executed through the standard trade executor.
 *
 * Architecture:
 * - Orders stored in-memory with DynamoDB persistence (optional)
 * - Price stream subscription for real-time trigger evaluation
 * - Integration with circuit breakers (all triggered orders pass through)
 * - Audit trail for all order lifecycle events
 */

import { subscribeToPrices, getPrice, type PriceUpdate } from "./realtime-prices.ts";
import { eventBus } from "./event-stream.ts";
import { logTradeEvent } from "./audit-log.ts";
import { round2 } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OrderType =
  | "limit_buy"
  | "limit_sell"
  | "stop_loss"
  | "trailing_stop"
  | "take_profit"
  | "bracket";

export type OrderStatus =
  | "pending"
  | "active"
  | "triggered"
  | "executing"
  | "filled"
  | "cancelled"
  | "expired"
  | "failed";

export interface BaseOrder {
  orderId: string;
  agentId: string;
  symbol: string;
  mintAddress: string;
  type: OrderType;
  status: OrderStatus;
  /** USDC amount (for buys) or token quantity (for sells) */
  quantity: number;
  createdAt: string;
  updatedAt: string;
  /** Optional expiry time (ISO string) */
  expiresAt: string | null;
  /** Round that created this order */
  roundId: string | null;
  /** Notes/reasoning from the agent */
  notes: string;
}

export interface LimitBuyOrder extends BaseOrder {
  type: "limit_buy";
  /** Buy when price drops to or below this level */
  limitPrice: number;
}

export interface LimitSellOrder extends BaseOrder {
  type: "limit_sell";
  /** Sell when price rises to or above this level */
  limitPrice: number;
}

export interface StopLossOrder extends BaseOrder {
  type: "stop_loss";
  /** Sell when price drops to or below this level */
  stopPrice: number;
  /** The price when the stop was placed (for reference) */
  entryPrice: number;
  /** Loss percentage when stop triggers */
  triggerLossPercent: number;
}

export interface TrailingStopOrder extends BaseOrder {
  type: "trailing_stop";
  /** Trailing distance in percentage (e.g., 5 = 5% trailing stop) */
  trailPercent: number;
  /** Current high water mark (highest price seen since order placed) */
  highWaterMark: number;
  /** Current effective stop price (highWaterMark * (1 - trailPercent/100)) */
  currentStopPrice: number;
  /** The price when the order was placed */
  entryPrice: number;
}

export interface TakeProfitOrder extends BaseOrder {
  type: "take_profit";
  /** Sell when price rises to or above this level */
  targetPrice: number;
  /** The price when placed */
  entryPrice: number;
  /** Target profit percentage */
  targetProfitPercent: number;
}

export interface BracketOrder extends BaseOrder {
  type: "bracket";
  /** Entry price (for reference) */
  entryPrice: number;
  /** Stop-loss price */
  stopPrice: number;
  /** Take-profit price */
  targetPrice: number;
  /** Which leg triggered (null if still pending) */
  triggeredLeg: "stop_loss" | "take_profit" | null;
}

export type Order =
  | LimitBuyOrder
  | LimitSellOrder
  | StopLossOrder
  | TrailingStopOrder
  | TakeProfitOrder
  | BracketOrder;

export interface OrderTriggerResult {
  orderId: string;
  type: OrderType;
  triggerPrice: number;
  symbol: string;
  agentId: string;
  action: "buy" | "sell";
  quantity: number;
  timestamp: string;
}

export interface OrderManagerMetrics {
  totalOrders: number;
  activeOrders: number;
  pendingOrders: number;
  triggeredOrders: number;
  filledOrders: number;
  cancelledOrders: number;
  expiredOrders: number;
  failedOrders: number;
  ordersByType: Record<string, number>;
  ordersByAgent: Record<string, number>;
  isListening: boolean;
  lastEvaluationAt: string | null;
  totalEvaluations: number;
}

// ---------------------------------------------------------------------------
// Percentage Conversion Constants
// ---------------------------------------------------------------------------

/**
 * Multiplier to convert a decimal fraction to a percentage value.
 *
 * Used in stop-loss and take-profit calculations to express price movements
 * as human-readable percentage values.
 *
 * Formula: decimalFraction × PERCENT_MULTIPLIER = percentage
 * Example: (entryPrice - stopPrice) / entryPrice × 100 = loss %
 *   - entryPrice = $100, stopPrice = $90 → (100-90)/100 × 100 = 10% loss
 *   - entryPrice = $50, targetPrice = $60 → (60-50)/50 × 100 = 20% gain
 */
const PERCENT_MULTIPLIER = 100;

/**
 * Divisor to convert a percentage value back to a decimal fraction.
 *
 * Used in trailing stop calculations to convert the user-supplied trailPercent
 * (e.g. 5.0 meaning "5%") into a multiplier for price math.
 *
 * Formula: percentage / PERCENT_DIVISOR = decimalFraction
 * Example: trailPercent=5 → 1 - 5/100 = 0.95 → stopPrice = highWaterMark × 0.95
 *   - highWaterMark = $200, trailPercent = 5 → stopPrice = $200 × 0.95 = $190
 *   - highWaterMark = $150, trailPercent = 10 → stopPrice = $150 × 0.90 = $135
 */
const PERCENT_DIVISOR = 100;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** All orders keyed by orderId */
const orders = new Map<string, Order>();

/** Active orders by symbol for fast lookup during price ticks */
const activeOrdersBySymbol = new Map<string, Set<string>>();

/** Order history (triggered/filled/cancelled/expired) */
const orderHistory: Order[] = [];
const MAX_HISTORY = 500;

/** Metrics */
let totalEvaluations = 0;
let lastEvaluationAt: string | null = null;
let isListening = false;
let unsubscribe: (() => void) | null = null;

/** Order ID counter */
let orderCounter = 0;

// ---------------------------------------------------------------------------
// Order ID Generation
// ---------------------------------------------------------------------------

function generateOrderId(): string {
  orderCounter++;
  return `ord_${Date.now()}_${orderCounter.toString(36)}`;
}

// ---------------------------------------------------------------------------
// Order Creation
// ---------------------------------------------------------------------------

/**
 * Place a limit buy order.
 * Triggers when the token price drops to or below the limit price.
 */
export function placeLimitBuy(params: {
  agentId: string;
  symbol: string;
  mintAddress: string;
  limitPrice: number;
  quantity: number;
  expiresAt?: string;
  roundId?: string;
  notes?: string;
}): LimitBuyOrder {
  const order: LimitBuyOrder = {
    orderId: generateOrderId(),
    agentId: params.agentId,
    symbol: params.symbol,
    mintAddress: params.mintAddress,
    type: "limit_buy",
    status: "active",
    quantity: params.quantity,
    limitPrice: params.limitPrice,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: params.expiresAt ?? null,
    roundId: params.roundId ?? null,
    notes: params.notes ?? "",
  };

  registerOrder(order);
  return order;
}

/**
 * Place a limit sell order.
 * Triggers when the token price rises to or above the limit price.
 */
export function placeLimitSell(params: {
  agentId: string;
  symbol: string;
  mintAddress: string;
  limitPrice: number;
  quantity: number;
  expiresAt?: string;
  roundId?: string;
  notes?: string;
}): LimitSellOrder {
  const order: LimitSellOrder = {
    orderId: generateOrderId(),
    agentId: params.agentId,
    symbol: params.symbol,
    mintAddress: params.mintAddress,
    type: "limit_sell",
    status: "active",
    quantity: params.quantity,
    limitPrice: params.limitPrice,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: params.expiresAt ?? null,
    roundId: params.roundId ?? null,
    notes: params.notes ?? "",
  };

  registerOrder(order);
  return order;
}

/**
 * Place a stop-loss order.
 * Triggers a sell when price drops to or below the stop price.
 */
export function placeStopLoss(params: {
  agentId: string;
  symbol: string;
  mintAddress: string;
  stopPrice: number;
  entryPrice: number;
  quantity: number;
  roundId?: string;
  notes?: string;
}): StopLossOrder {
  const lossPercent =
    params.entryPrice > 0
      ? ((params.entryPrice - params.stopPrice) / params.entryPrice) * PERCENT_MULTIPLIER
      : 0;

  const order: StopLossOrder = {
    orderId: generateOrderId(),
    agentId: params.agentId,
    symbol: params.symbol,
    mintAddress: params.mintAddress,
    type: "stop_loss",
    status: "active",
    quantity: params.quantity,
    stopPrice: params.stopPrice,
    entryPrice: params.entryPrice,
    triggerLossPercent: round2(lossPercent),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: null,
    roundId: params.roundId ?? null,
    notes: params.notes ?? `Stop-loss at -${lossPercent.toFixed(1)}%`,
  };

  registerOrder(order);
  return order;
}

/**
 * Place a trailing stop order.
 * The stop price follows the market price upward, locking in gains.
 */
export function placeTrailingStop(params: {
  agentId: string;
  symbol: string;
  mintAddress: string;
  trailPercent: number;
  entryPrice: number;
  quantity: number;
  roundId?: string;
  notes?: string;
}): TrailingStopOrder {
  const currentPrice = getPrice(params.symbol)?.price ?? params.entryPrice;
  const highWaterMark = Math.max(currentPrice, params.entryPrice);
  const currentStopPrice = highWaterMark * (1 - params.trailPercent / PERCENT_DIVISOR);

  const order: TrailingStopOrder = {
    orderId: generateOrderId(),
    agentId: params.agentId,
    symbol: params.symbol,
    mintAddress: params.mintAddress,
    type: "trailing_stop",
    status: "active",
    quantity: params.quantity,
    trailPercent: params.trailPercent,
    highWaterMark,
    currentStopPrice,
    entryPrice: params.entryPrice,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: null,
    roundId: params.roundId ?? null,
    notes: params.notes ?? `Trailing stop: ${params.trailPercent}%`,
  };

  registerOrder(order);
  return order;
}

/**
 * Place a take-profit order.
 * Triggers a sell when price rises to or above the target.
 */
export function placeTakeProfit(params: {
  agentId: string;
  symbol: string;
  mintAddress: string;
  targetPrice: number;
  entryPrice: number;
  quantity: number;
  roundId?: string;
  notes?: string;
}): TakeProfitOrder {
  const profitPercent =
    params.entryPrice > 0
      ? ((params.targetPrice - params.entryPrice) / params.entryPrice) * PERCENT_MULTIPLIER
      : 0;

  const order: TakeProfitOrder = {
    orderId: generateOrderId(),
    agentId: params.agentId,
    symbol: params.symbol,
    mintAddress: params.mintAddress,
    type: "take_profit",
    status: "active",
    quantity: params.quantity,
    targetPrice: params.targetPrice,
    entryPrice: params.entryPrice,
    targetProfitPercent: round2(profitPercent),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: null,
    roundId: params.roundId ?? null,
    notes: params.notes ?? `Take profit at +${profitPercent.toFixed(1)}%`,
  };

  registerOrder(order);
  return order;
}

/**
 * Place a bracket order (combined stop-loss + take-profit).
 * When one leg triggers, the other is automatically cancelled.
 */
export function placeBracket(params: {
  agentId: string;
  symbol: string;
  mintAddress: string;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  quantity: number;
  roundId?: string;
  notes?: string;
}): BracketOrder {
  const order: BracketOrder = {
    orderId: generateOrderId(),
    agentId: params.agentId,
    symbol: params.symbol,
    mintAddress: params.mintAddress,
    type: "bracket",
    status: "active",
    quantity: params.quantity,
    entryPrice: params.entryPrice,
    stopPrice: params.stopPrice,
    targetPrice: params.targetPrice,
    triggeredLeg: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: null,
    roundId: params.roundId ?? null,
    notes:
      params.notes ??
      `Bracket: stop=${params.stopPrice.toFixed(2)}, target=${params.targetPrice.toFixed(2)}`,
  };

  registerOrder(order);
  return order;
}

// ---------------------------------------------------------------------------
// Order Management
// ---------------------------------------------------------------------------

/**
 * Cancel an order by ID.
 */
export function cancelOrder(orderId: string): boolean {
  const order = orders.get(orderId);
  if (!order) return false;
  if (order.status !== "active" && order.status !== "pending") return false;

  order.status = "cancelled";
  order.updatedAt = new Date().toISOString();

  removeFromActiveIndex(order);
  archiveOrder(order);

  logTradeEvent(
    "order_cancelled",
    `${order.type} order ${orderId} for ${order.symbol} cancelled`,
    order.agentId,
    order.roundId ?? undefined,
    { orderId, type: order.type, symbol: order.symbol },
  );

  return true;
}

/**
 * Cancel all orders for an agent.
 */
export function cancelAllAgentOrders(agentId: string): number {
  let count = 0;
  for (const [orderId, order] of orders) {
    if (order.agentId === agentId && (order.status === "active" || order.status === "pending")) {
      cancelOrder(orderId);
      count++;
    }
  }
  return count;
}

/**
 * Get an order by ID.
 */
export function getOrder(orderId: string): Order | null {
  return orders.get(orderId) ?? null;
}

/**
 * Get all active orders for an agent.
 */
export function getAgentOrders(agentId: string): Order[] {
  const result: Order[] = [];
  for (const order of orders.values()) {
    if (order.agentId === agentId) result.push(order);
  }
  return result;
}

/**
 * Get all active orders for a symbol.
 */
export function getSymbolOrders(symbol: string): Order[] {
  const orderIds = activeOrdersBySymbol.get(symbol);
  if (!orderIds) return [];

  return Array.from(orderIds)
    .map((id) => orders.get(id))
    .filter((o): o is Order => o !== undefined);
}

/**
 * Get all orders across all agents.
 */
export function getAllOrders(): Order[] {
  return Array.from(orders.values());
}

/**
 * Get order history (triggered/filled/cancelled/expired).
 */
export function getOrderHistory(limit = 50): Order[] {
  return orderHistory.slice(-limit);
}

// ---------------------------------------------------------------------------
// Price Evaluation Engine
// ---------------------------------------------------------------------------

/**
 * Start listening to the price stream and evaluating orders.
 */
export function startOrderEvaluation(): void {
  if (isListening) return;

  unsubscribe = subscribeToPrices((update: PriceUpdate) => {
    evaluateOrdersForSymbol(update.symbol, update.newPrice);
  });

  isListening = true;
  console.log("[OrderManager] Started order evaluation engine");
}

/**
 * Stop the order evaluation engine.
 */
export function stopOrderEvaluation(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  isListening = false;
  console.log("[OrderManager] Stopped order evaluation engine");
}

/**
 * Evaluate all active orders for a given symbol against the current price.
 */
function evaluateOrdersForSymbol(symbol: string, currentPrice: number): void {
  const orderIds = activeOrdersBySymbol.get(symbol);
  if (!orderIds || orderIds.size === 0) return;

  totalEvaluations++;
  lastEvaluationAt = new Date().toISOString();

  const triggeredOrders: OrderTriggerResult[] = [];

  for (const orderId of orderIds) {
    const order = orders.get(orderId);
    if (!order || order.status !== "active") continue;

    // Check expiry
    if (order.expiresAt && new Date(order.expiresAt).getTime() < Date.now()) {
      order.status = "expired";
      order.updatedAt = new Date().toISOString();
      removeFromActiveIndex(order);
      archiveOrder(order);
      continue;
    }

    const trigger = evaluateOrder(order, currentPrice);
    if (trigger) {
      triggeredOrders.push(trigger);
    }
  }

  // Process triggered orders
  for (const trigger of triggeredOrders) {
    processTriggeredOrder(trigger);
  }
}

/**
 * Evaluate a single order against the current price.
 * Returns a trigger result if the order should execute, null otherwise.
 */
function evaluateOrder(order: Order, currentPrice: number): OrderTriggerResult | null {
  switch (order.type) {
    case "limit_buy":
      if (currentPrice <= order.limitPrice) {
        return {
          orderId: order.orderId,
          type: order.type,
          triggerPrice: currentPrice,
          symbol: order.symbol,
          agentId: order.agentId,
          action: "buy",
          quantity: order.quantity,
          timestamp: new Date().toISOString(),
        };
      }
      break;

    case "limit_sell":
      if (currentPrice >= order.limitPrice) {
        return {
          orderId: order.orderId,
          type: order.type,
          triggerPrice: currentPrice,
          symbol: order.symbol,
          agentId: order.agentId,
          action: "sell",
          quantity: order.quantity,
          timestamp: new Date().toISOString(),
        };
      }
      break;

    case "stop_loss":
      if (currentPrice <= order.stopPrice) {
        return {
          orderId: order.orderId,
          type: order.type,
          triggerPrice: currentPrice,
          symbol: order.symbol,
          agentId: order.agentId,
          action: "sell",
          quantity: order.quantity,
          timestamp: new Date().toISOString(),
        };
      }
      break;

    case "trailing_stop": {
      // Update high water mark if price increased
      if (currentPrice > order.highWaterMark) {
        order.highWaterMark = currentPrice;
        order.currentStopPrice = currentPrice * (1 - order.trailPercent / PERCENT_DIVISOR);
        order.updatedAt = new Date().toISOString();
      }

      // Check if stop triggered
      if (currentPrice <= order.currentStopPrice) {
        return {
          orderId: order.orderId,
          type: order.type,
          triggerPrice: currentPrice,
          symbol: order.symbol,
          agentId: order.agentId,
          action: "sell",
          quantity: order.quantity,
          timestamp: new Date().toISOString(),
        };
      }
      break;
    }

    case "take_profit":
      if (currentPrice >= order.targetPrice) {
        return {
          orderId: order.orderId,
          type: order.type,
          triggerPrice: currentPrice,
          symbol: order.symbol,
          agentId: order.agentId,
          action: "sell",
          quantity: order.quantity,
          timestamp: new Date().toISOString(),
        };
      }
      break;

    case "bracket": {
      // Check stop-loss leg
      if (currentPrice <= order.stopPrice) {
        order.triggeredLeg = "stop_loss";
        return {
          orderId: order.orderId,
          type: order.type,
          triggerPrice: currentPrice,
          symbol: order.symbol,
          agentId: order.agentId,
          action: "sell",
          quantity: order.quantity,
          timestamp: new Date().toISOString(),
        };
      }

      // Check take-profit leg
      if (currentPrice >= order.targetPrice) {
        order.triggeredLeg = "take_profit";
        return {
          orderId: order.orderId,
          type: order.type,
          triggerPrice: currentPrice,
          symbol: order.symbol,
          agentId: order.agentId,
          action: "sell",
          quantity: order.quantity,
          timestamp: new Date().toISOString(),
        };
      }
      break;
    }
  }

  return null;
}

/**
 * Process a triggered order — update status and emit events.
 * Actual execution is delegated to the trade executor via event bus.
 */
function processTriggeredOrder(trigger: OrderTriggerResult): void {
  const order = orders.get(trigger.orderId);
  if (!order) return;

  order.status = "triggered";
  order.updatedAt = new Date().toISOString();

  console.log(
    `[OrderManager] ORDER TRIGGERED: ${order.type} ${trigger.orderId} — ` +
      `${trigger.action} ${trigger.quantity} ${trigger.symbol} @ $${trigger.triggerPrice.toFixed(4)}`,
  );

  // Emit trigger event for the trade executor to pick up
  try {
    eventBus.emit("order_triggered", {
      ...trigger,
      orderType: order.type,
      notes: order.notes,
    });
  } catch {
    // Non-critical
  }

  // Log the trigger
  logTradeEvent(
    "order_triggered",
    `${order.type} order ${trigger.orderId} triggered at $${trigger.triggerPrice.toFixed(4)}: ${trigger.action} ${trigger.quantity} ${trigger.symbol}`,
    order.agentId,
    order.roundId ?? undefined,
    {
      orderId: trigger.orderId,
      orderType: order.type,
      triggerPrice: trigger.triggerPrice,
      action: trigger.action,
      quantity: trigger.quantity,
    },
  );

  // Remove from active index
  removeFromActiveIndex(order);
  archiveOrder(order);
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

function registerOrder(order: Order): void {
  orders.set(order.orderId, order);

  // Add to symbol index
  let symbolOrders = activeOrdersBySymbol.get(order.symbol);
  if (!symbolOrders) {
    symbolOrders = new Set();
    activeOrdersBySymbol.set(order.symbol, symbolOrders);
  }
  symbolOrders.add(order.orderId);

  console.log(
    `[OrderManager] Order placed: ${order.type} ${order.orderId} — ${order.symbol} qty=${order.quantity} (agent: ${order.agentId})`,
  );

  logTradeEvent(
    "order_placed",
    `${order.type} order ${order.orderId} placed for ${order.symbol}`,
    order.agentId,
    order.roundId ?? undefined,
    { orderId: order.orderId, type: order.type, symbol: order.symbol, quantity: order.quantity },
  );
}

function removeFromActiveIndex(order: Order): void {
  const symbolOrders = activeOrdersBySymbol.get(order.symbol);
  if (symbolOrders) {
    symbolOrders.delete(order.orderId);
    if (symbolOrders.size === 0) {
      activeOrdersBySymbol.delete(order.symbol);
    }
  }
}

function archiveOrder(order: Order): void {
  orderHistory.push(order);
  if (orderHistory.length > MAX_HISTORY) {
    orderHistory.splice(0, orderHistory.length - MAX_HISTORY);
  }
  // Remove from active orders map
  orders.delete(order.orderId);
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/**
 * Get order manager metrics.
 */
export function getOrderManagerMetrics(): OrderManagerMetrics {
  const ordersByType: Record<string, number> = {};
  const ordersByAgent: Record<string, number> = {};
  let activeCount = 0;
  let pendingCount = 0;

  for (const order of orders.values()) {
    ordersByType[order.type] = (ordersByType[order.type] ?? 0) + 1;
    ordersByAgent[order.agentId] = (ordersByAgent[order.agentId] ?? 0) + 1;

    if (order.status === "active") activeCount++;
    if (order.status === "pending") pendingCount++;
  }

  let triggeredCount = 0;
  let filledCount = 0;
  let cancelledCount = 0;
  let expiredCount = 0;
  let failedCount = 0;

  for (const order of orderHistory) {
    if (order.status === "triggered") triggeredCount++;
    if (order.status === "filled") filledCount++;
    if (order.status === "cancelled") cancelledCount++;
    if (order.status === "expired") expiredCount++;
    if (order.status === "failed") failedCount++;
  }

  return {
    totalOrders: orders.size + orderHistory.length,
    activeOrders: activeCount,
    pendingOrders: pendingCount,
    triggeredOrders: triggeredCount,
    filledOrders: filledCount,
    cancelledOrders: cancelledCount,
    expiredOrders: expiredCount,
    failedOrders: failedCount,
    ordersByType,
    ordersByAgent,
    isListening,
    lastEvaluationAt,
    totalEvaluations,
  };
}

