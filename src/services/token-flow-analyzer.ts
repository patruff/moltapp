/**
 * Token Flow Analyzer
 *
 * Tracks and analyzes the movement of tokenized stocks (xStocks) between
 * AI trading agents and the market on Solana. Provides deep insight into
 * accumulation/distribution patterns, agent trading profiles, market impact
 * estimates, and conviction scoring.
 *
 * Features:
 * - Record individual token flows (agent-to-market, market-to-agent)
 * - Per-symbol flow summaries (net flows, dominant buyer/seller, volume)
 * - Per-agent flow profiles (turnover, holding period, concentration)
 * - Flow heatmap (agent x symbol intensity grid)
 * - Chronological flow timeline with filtering
 * - Market impact estimation per agent
 * - Token conviction scoring (buy-and-hold vs churning)
 *
 * Storage: In-memory ring buffer capped at 5000 entries.
 */

import { round2 } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single token movement event between an agent and the market (or vice versa). */
export interface TokenFlow {
  /** xStock symbol, e.g. "AAPLx" */
  symbol: string;
  /** Source of the tokens — an agent ID or "market" */
  fromAgent: string | "market";
  /** Destination of the tokens — an agent ID or "market" */
  toAgent: string | "market";
  /** Number of token units transferred */
  amount: number;
  /** USDC-equivalent value of the transfer at time of flow */
  usdcValue: number;
  /** ISO-8601 timestamp of the flow event */
  timestamp: string;
  /** On-chain transaction signature, if available */
  txSignature?: string;
}

/** Aggregated flow summary for a single xStock symbol. */
export interface FlowSummary {
  symbol: string;
  /** Net flow per agent: positive = accumulating, negative = distributing */
  netFlows: Record<string, number>;
  /** Total USDC volume traded for this symbol */
  totalVolume: number;
  /** Total USDC volume on the buy side */
  buyVolume: number;
  /** Total USDC volume on the sell side */
  sellVolume: number;
  /** Agent accumulating the most of this symbol (by USDC value) */
  dominantBuyer: { agentId: string; usdcAccumulated: number } | null;
  /** Agent distributing the most of this symbol (by USDC value) */
  dominantSeller: { agentId: string; usdcDistributed: number } | null;
  /** Total number of flow events for this symbol */
  flowCount: number;
}

/** Comprehensive flow profile for a single agent. */
export interface AgentFlowProfile {
  agentId: string;
  /** Total USDC value of all purchases */
  totalBought: number;
  /** Total USDC value of all sales */
  totalSold: number;
  /** Turnover rate: total volume / average portfolio value (higher = more active) */
  turnoverRate: number;
  /** Estimated average holding period in hours, based on flow frequency */
  holdingPeriodEstimate: number;
  /** Breakdown of flow concentration by symbol */
  concentrationBySymbol: { symbol: string; percentOfFlow: number }[];
  /** Whether trading velocity is increasing or decreasing over time */
  flowMomentum: "increasing" | "decreasing" | "stable";
  /** Total number of flow events involving this agent */
  flowCount: number;
  /** Flows per hour over the observation window */
  flowVelocity: number;
}

/** Estimated market impact metrics for an agent. */
export interface MarketImpactEstimate {
  agentId: string;
  /** Average estimated slippage in basis points from flow sizes */
  estimatedSlippage: number;
  /** Per-symbol: what percentage of total xStock volume this agent represents */
  marketShareBySymbol: { symbol: string; sharePercent: number }[];
  /** Total USDC volume from this agent */
  totalVolume: number;
}

/** Conviction score for an agent on a specific token. */
export interface TokenConviction {
  agentId: string;
  symbol: string;
  /** 0-100 score: 100 = pure accumulator, 0 = pure churner */
  convictionScore: number;
  /** Total amount bought */
  totalBought: number;
  /** Total amount sold */
  totalSold: number;
  /** Net position change (bought - sold) */
  netPosition: number;
  /** Classification based on conviction score */
  style: "strong-accumulator" | "accumulator" | "trader" | "churner" | "distributor";
}

/** A single cell in the flow heatmap grid. */
export interface HeatmapCell {
  agentId: string;
  symbol: string;
  /** Intensity score 0-100 based on flow volume and frequency */
  intensity: number;
  /** Net flow direction for this agent+symbol pair */
  netDirection: "buy" | "sell" | "neutral";
  /** Total USDC volume in this cell */
  totalUsdcVolume: number;
  /** Number of flow events */
  flowCount: number;
}

/** NxN heatmap of agent x symbol flow intensity. */
export interface FlowHeatmap {
  agents: string[];
  symbols: string[];
  cells: HeatmapCell[];
  /** Cell with the highest intensity */
  hottestCell: HeatmapCell | null;
  /** Cell with the lowest non-zero intensity */
  coldestCell: HeatmapCell | null;
}

/** Options for filtering the flow timeline. */
export interface FlowTimelineOptions {
  /** Filter by symbol */
  symbol?: string;
  /** Filter by agent (as source or destination) */
  agentId?: string;
  /** Only show flows after this ISO timestamp */
  since?: string;
  /** Only show flows before this ISO timestamp */
  until?: string;
  /** Maximum number of results to return */
  limit?: number;
  /** Filter by direction: "buy" (market->agent) or "sell" (agent->market) */
  direction?: "buy" | "sell";
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Known agent IDs in the MoltApp trading arena. */
const AGENT_IDS = ["claude-trader", "gpt-momentum", "grok-contrarian"] as const;

/** Maximum number of flows retained in the ring buffer. */
const MAX_FLOWS = 5000;

/**
 * Estimated slippage model: basis points of slippage per $1000 of flow.
 * This is a simplified linear model; real slippage is non-linear.
 */
const SLIPPAGE_BPS_PER_1000_USDC = 2.5;

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Conviction Classification Thresholds
 *
 * Token conviction measures buy-and-hold behavior vs churning for each
 * agent-symbol pair. Score is 0-100 based on net accumulation, direction
 * consistency, and buy bias.
 */

/**
 * Minimum conviction score to classify as "strong-accumulator" (with net positive position).
 * Score >= 80 indicates very high conviction: agent is consistently accumulating
 * with minimal churning and strong directional consistency.
 */
const CONVICTION_STRONG_ACCUMULATOR_THRESHOLD = 80;

/**
 * Minimum conviction score to classify as "accumulator" (with net positive position).
 * Score >= 60 indicates high conviction: agent is net buying with good consistency
 * but may have some tactical selling.
 */
const CONVICTION_ACCUMULATOR_THRESHOLD = 60;

/**
 * Minimum conviction score to classify as "trader" (neutral/mixed position).
 * Score >= 40 indicates moderate activity: agent is balanced between buying/selling,
 * active trading but not heavily directional.
 */
const CONVICTION_TRADER_THRESHOLD = 40;

/**
 * Conviction Scoring Weights
 *
 * Conviction score is composed of three components, each contributing points
 * to the final 0-100 score.
 */

/**
 * Maximum points awarded for net accumulation ratio (0-50 points).
 * Net accumulation = |netPosition| / totalActivity. Higher ratio = more conviction.
 * Example: Bought 100, sold 20 → netRatio = 80/120 = 0.67 → 33.5 points.
 */
const CONVICTION_ACCUMULATION_POINTS_MAX = 50;

/**
 * Maximum points awarded for direction consistency (0-30 points).
 * Consistency = 1 - (directionChanges / maxChanges). Fewer flips = more conviction.
 * Example: 10 flows with 2 direction changes → consistency = 1 - 2/9 = 0.78 → 23.4 points.
 */
const CONVICTION_CONSISTENCY_POINTS_MAX = 30;

/**
 * Maximum points awarded for buy bias when net position is positive (0-20 points).
 * Buy bias = bought / totalActivity. Higher buy percentage = more conviction.
 * Example: 80% buys → 0.80 * 20 = 16 points.
 */
const CONVICTION_BUY_BIAS_POINTS_MAX = 20;

/**
 * Maximum points awarded for sell bias when net position is negative (0-5 points).
 * When distributing (net negative), buy bias is inverted and scaled down to penalize.
 * Example: Distributor with 30% buys → (1 - 0.30) * 5 = 3.5 points (weak conviction).
 */
const CONVICTION_SELL_BIAS_POINTS_MAX = 5;

/**
 * Flow Heatmap Intensity Calculation
 *
 * Heatmap cells show agent-symbol flow intensity on a 0-100 scale, combining
 * volume (relative to max) and frequency (number of flow events).
 */

/**
 * Scaling factor for volume intensity component (0-80 points).
 * Volume intensity = (cellVolume / maxVolume) * 80. This reserves 20 points
 * for frequency boost, ensuring volume is the primary driver.
 */
const HEATMAP_VOLUME_INTENSITY_SCALING = 80;

/**
 * Multiplier for frequency boost component (2 points per flow event).
 * Frequency boost = min(flowCount * 2, 20). Rewards high-frequency trading
 * but caps at 20 points to prevent overwhelming volume signal.
 */
const HEATMAP_FREQUENCY_BOOST_MULTIPLIER = 2;

/**
 * Maximum points from frequency boost (0-20 points cap).
 * Caps frequency contribution at 20 points regardless of flow count,
 * ensuring volume remains primary intensity driver.
 */
const HEATMAP_FREQUENCY_BOOST_MAX = 20;

/**
 * Maximum intensity score cap (0-100 scale).
 * Final intensity = min(volumeIntensity + frequencyBoost, 100).
 * Ensures all cells fit in normalized 0-100 range.
 */
const HEATMAP_INTENSITY_MAX = 100;

/**
 * Flow Direction Detection Threshold
 *
 * Threshold for classifying net flow direction as "buy" or "sell" vs "neutral".
 * Net direction is based on netFlow = buyVolume - sellVolume.
 */

/**
 * Minimum net flow percentage to classify direction as "buy" or "sell" (10% threshold).
 * If netFlow > totalVolume * 0.1 → "buy"
 * If netFlow < -totalVolume * 0.1 → "sell"
 * Otherwise → "neutral"
 * Example: $1000 total volume, +$150 net flow → +15% → "buy"
 */
const FLOW_DIRECTION_THRESHOLD = 0.1;

/**
 * Flow Momentum Classification
 *
 * Flow momentum compares velocity (flows per hour) between first half and
 * second half of observation window to detect acceleration/deceleration.
 */

/**
 * Minimum change ratio to classify momentum as "increasing" or "decreasing" (20% threshold).
 * Change ratio = (secondVelocity - firstVelocity) / firstVelocity
 * If changeRatio > 0.2 → "increasing"
 * If changeRatio < -0.2 → "decreasing"
 * Otherwise → "stable"
 * Example: First half = 10 flows/hr, second half = 13 flows/hr → +30% → "increasing"
 */
const FLOW_MOMENTUM_CHANGE_THRESHOLD = 0.2;

// ---------------------------------------------------------------------------
// State (Ring Buffer)
// ---------------------------------------------------------------------------

/** Ring buffer of flow events, newest first. */
const flowBuffer: TokenFlow[] = [];

/** Write pointer for the ring buffer (tracks total insertions). */
let flowWriteCount = 0;

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Record a token flow event.
 *
 * Adds the flow to the in-memory ring buffer. Once the buffer reaches
 * MAX_FLOWS entries, the oldest entries are discarded.
 *
 * @param flow - The token flow event to record.
 */
export function recordFlow(flow: TokenFlow): void {
  flowBuffer.unshift(flow);
  if (flowBuffer.length > MAX_FLOWS) {
    flowBuffer.length = MAX_FLOWS;
  }
  flowWriteCount++;
}

/**
 * Get a flow summary for a specific xStock symbol.
 *
 * Aggregates all recorded flows for the given symbol into net flows per agent,
 * total/buy/sell volume, and identifies the dominant buyer and seller.
 *
 * @param symbol - The xStock symbol to summarize (e.g. "AAPLx").
 * @returns Flow summary for the symbol, or a zero-value summary if no flows exist.
 */
export function getFlowSummary(symbol: string): FlowSummary {
  const symbolFlows = flowBuffer.filter((f) => f.symbol === symbol);

  if (symbolFlows.length === 0) {
    return {
      symbol,
      netFlows: {},
      totalVolume: 0,
      buyVolume: 0,
      sellVolume: 0,
      dominantBuyer: null,
      dominantSeller: null,
      flowCount: 0,
    };
  }

  const netFlows: Record<string, number> = {};
  let buyVolume = 0;
  let sellVolume = 0;

  for (const flow of symbolFlows) {
    // When toAgent is an agent (not "market"), that agent is buying
    if (flow.toAgent !== "market") {
      netFlows[flow.toAgent] = (netFlows[flow.toAgent] ?? 0) + flow.usdcValue;
      buyVolume += flow.usdcValue;
    }
    // When fromAgent is an agent (not "market"), that agent is selling
    if (flow.fromAgent !== "market") {
      netFlows[flow.fromAgent] = (netFlows[flow.fromAgent] ?? 0) - flow.usdcValue;
      sellVolume += flow.usdcValue;
    }
  }

  const totalVolume = buyVolume + sellVolume;

  // Identify dominant buyer (highest positive net flow)
  let dominantBuyer: FlowSummary["dominantBuyer"] = null;
  let maxAccumulated = 0;
  for (const [agentId, net] of Object.entries(netFlows)) {
    if (net > maxAccumulated) {
      maxAccumulated = net;
      dominantBuyer = { agentId, usdcAccumulated: round2(net) };
    }
  }

  // Identify dominant seller (lowest negative net flow)
  let dominantSeller: FlowSummary["dominantSeller"] = null;
  let maxDistributed = 0;
  for (const [agentId, net] of Object.entries(netFlows)) {
    if (net < 0 && Math.abs(net) > maxDistributed) {
      maxDistributed = Math.abs(net);
      dominantSeller = { agentId, usdcDistributed: round2(Math.abs(net)) };
    }
  }

  // Round net flows for cleanliness
  const roundedNetFlows: Record<string, number> = {};
  for (const [agentId, net] of Object.entries(netFlows)) {
    roundedNetFlows[agentId] = round2(net);
  }

  return {
    symbol,
    netFlows: roundedNetFlows,
    totalVolume: round2(totalVolume),
    buyVolume: round2(buyVolume),
    sellVolume: round2(sellVolume),
    dominantBuyer,
    dominantSeller,
    flowCount: symbolFlows.length,
  };
}

/**
 * Get flow summaries for all symbols that have recorded flows.
 *
 * @returns Array of flow summaries, sorted by total volume descending.
 */
export function getAllFlowSummaries(): FlowSummary[] {
  const symbols = new Set<string>();
  for (const flow of flowBuffer) {
    symbols.add(flow.symbol);
  }

  const summaries: FlowSummary[] = [];
  for (const symbol of symbols) {
    summaries.push(getFlowSummary(symbol));
  }

  return summaries.sort((a, b) => b.totalVolume - a.totalVolume);
}

/**
 * Get the comprehensive flow profile for a specific agent.
 *
 * Analyzes all flows involving the agent to compute turnover, holding period
 * estimates, concentration metrics, and flow momentum.
 *
 * @param agentId - The agent identifier (e.g. "claude-trader").
 * @returns Agent flow profile with trading behavior metrics.
 */
export function getAgentFlowProfile(agentId: string): AgentFlowProfile {
  const agentFlows = flowBuffer.filter(
    (f) => f.fromAgent === agentId || f.toAgent === agentId,
  );

  if (agentFlows.length === 0) {
    return {
      agentId,
      totalBought: 0,
      totalSold: 0,
      turnoverRate: 0,
      holdingPeriodEstimate: 0,
      concentrationBySymbol: [],
      flowMomentum: "stable",
      flowCount: 0,
      flowVelocity: 0,
    };
  }

  let totalBought = 0;
  let totalSold = 0;
  const symbolVolume: Record<string, number> = {};

  for (const flow of agentFlows) {
    const vol = flow.usdcValue;
    if (flow.toAgent === agentId) {
      totalBought += vol;
    }
    if (flow.fromAgent === agentId) {
      totalSold += vol;
    }
    symbolVolume[flow.symbol] = (symbolVolume[flow.symbol] ?? 0) + vol;
  }

  const totalVolume = totalBought + totalSold;

  // Turnover rate: total volume / average portfolio value
  // Average portfolio value approximated as (totalBought - totalSold) / 2, floored at totalBought * 0.1
  const avgPortfolioValue = Math.max(Math.abs(totalBought - totalSold) / 2, totalBought * 0.1);
  const turnoverRate = avgPortfolioValue > 0
    ? round2(totalVolume / avgPortfolioValue)
    : 0;

  // Holding period estimate based on flow frequency
  // Time span of observed flows / number of round-trips
  const timestamps = agentFlows.map((f) => new Date(f.timestamp).getTime());
  const minTs = Math.min(...timestamps);
  const maxTs = Math.max(...timestamps);
  const timeSpanHours = Math.max((maxTs - minTs) / (1000 * 60 * 60), 1);
  const roundTrips = Math.min(totalBought, totalSold) / Math.max(totalBought * 0.5, 1);
  const holdingPeriodEstimate = roundTrips > 0
    ? round2(timeSpanHours / Math.max(roundTrips, 1))
    : timeSpanHours;

  // Concentration by symbol
  const concentrationBySymbol = Object.entries(symbolVolume)
    .map(([symbol, vol]) => ({
      symbol,
      percentOfFlow: totalVolume > 0
        ? round2((vol / totalVolume) * 100)
        : 0,
    }))
    .sort((a, b) => b.percentOfFlow - a.percentOfFlow);

  // Flow momentum: compare flow velocity in first half vs second half
  const flowMomentum = computeFlowMomentum(agentFlows);

  // Flow velocity: flows per hour
  const flowVelocity = timeSpanHours > 0
    ? round2(agentFlows.length / timeSpanHours)
    : agentFlows.length;

  return {
    agentId,
    totalBought: round2(totalBought),
    totalSold: round2(totalSold),
    turnoverRate,
    holdingPeriodEstimate,
    concentrationBySymbol,
    flowMomentum,
    flowCount: agentFlows.length,
    flowVelocity,
  };
}

/**
 * Get the NxN flow heatmap: agent x symbol with flow intensity.
 *
 * Each cell represents the intensity of a specific agent's activity in a
 * specific xStock, combining flow volume and frequency.
 *
 * @returns Flow heatmap with all agents and symbols.
 */
export function getFlowHeatmap(): FlowHeatmap {
  const symbolSet = new Set<string>();
  const agentSet = new Set<string>();

  for (const flow of flowBuffer) {
    symbolSet.add(flow.symbol);
    if (flow.fromAgent !== "market") agentSet.add(flow.fromAgent);
    if (flow.toAgent !== "market") agentSet.add(flow.toAgent);
  }

  const symbols = Array.from(symbolSet).sort();
  const agents = Array.from(agentSet).sort();

  // Find the maximum volume across all cells for normalization
  const cellData = new Map<string, { buyVol: number; sellVol: number; count: number }>();

  for (const flow of flowBuffer) {
    for (const agentId of agents) {
      if (flow.fromAgent !== agentId && flow.toAgent !== agentId) continue;

      const key = `${agentId}:${flow.symbol}`;
      const existing = cellData.get(key) ?? { buyVol: 0, sellVol: 0, count: 0 };

      if (flow.toAgent === agentId) {
        existing.buyVol += flow.usdcValue;
      }
      if (flow.fromAgent === agentId) {
        existing.sellVol += flow.usdcValue;
      }
      existing.count++;
      cellData.set(key, existing);
    }
  }

  // Determine max volume for intensity normalization
  let maxVolume = 0;
  for (const data of cellData.values()) {
    const vol = data.buyVol + data.sellVol;
    if (vol > maxVolume) maxVolume = vol;
  }

  const cells: HeatmapCell[] = [];
  for (const [key, data] of cellData) {
    const [agentId, symbol] = key.split(":");
    const totalVol = data.buyVol + data.sellVol;
    const netFlow = data.buyVol - data.sellVol;

    // Intensity: normalized 0-100 based on volume relative to max, boosted by frequency
    const volumeIntensity = maxVolume > 0 ? (totalVol / maxVolume) * HEATMAP_VOLUME_INTENSITY_SCALING : 0;
    const frequencyBoost = Math.min(data.count * HEATMAP_FREQUENCY_BOOST_MULTIPLIER, HEATMAP_FREQUENCY_BOOST_MAX);
    const intensity = Math.min(HEATMAP_INTENSITY_MAX, Math.round(volumeIntensity + frequencyBoost));

    let netDirection: HeatmapCell["netDirection"] = "neutral";
    if (netFlow > totalVol * FLOW_DIRECTION_THRESHOLD) netDirection = "buy";
    else if (netFlow < -totalVol * FLOW_DIRECTION_THRESHOLD) netDirection = "sell";

    cells.push({
      agentId,
      symbol,
      intensity,
      netDirection,
      totalUsdcVolume: round2(totalVol),
      flowCount: data.count,
    });
  }

  cells.sort((a, b) => b.intensity - a.intensity);

  const nonZeroCells = cells.filter((c) => c.intensity > 0);

  return {
    agents,
    symbols,
    cells,
    hottestCell: nonZeroCells.length > 0 ? nonZeroCells[0] : null,
    coldestCell: nonZeroCells.length > 0 ? nonZeroCells[nonZeroCells.length - 1] : null,
  };
}

/**
 * Get a chronological timeline of flow events with optional filtering.
 *
 * @param options - Filtering and pagination options.
 * @returns Array of matching token flows, newest first.
 */
export function getFlowTimeline(options?: FlowTimelineOptions): TokenFlow[] {
  let filtered = flowBuffer;

  if (options?.symbol) {
    filtered = filtered.filter((f) => f.symbol === options.symbol);
  }
  if (options?.agentId) {
    filtered = filtered.filter(
      (f) => f.fromAgent === options.agentId || f.toAgent === options.agentId,
    );
  }
  if (options?.since) {
    const sinceMs = new Date(options.since).getTime();
    filtered = filtered.filter((f) => new Date(f.timestamp).getTime() >= sinceMs);
  }
  if (options?.until) {
    const untilMs = new Date(options.until).getTime();
    filtered = filtered.filter((f) => new Date(f.timestamp).getTime() <= untilMs);
  }
  if (options?.direction === "buy") {
    filtered = filtered.filter((f) => f.fromAgent === "market");
  } else if (options?.direction === "sell") {
    filtered = filtered.filter((f) => f.toAgent === "market");
  }

  const limit = options?.limit ?? 100;
  return filtered.slice(0, limit);
}

/**
 * Estimate the market impact of each agent's trading activity.
 *
 * Uses a simplified linear slippage model based on flow size to estimate
 * how much each agent moves the market when they trade.
 *
 * @returns Market impact estimates for all agents with recorded flows.
 */
export function getMarketImpact(): MarketImpactEstimate[] {
  // Collect per-agent, per-symbol volumes
  const agentSymbolVolume = new Map<string, Map<string, number>>();
  const symbolTotalVolume = new Map<string, number>();
  const agentTotalVolume = new Map<string, number>();
  const agentFlowSizes: Map<string, number[]> = new Map();

  for (const flow of flowBuffer) {
    const involvedAgents: string[] = [];
    if (flow.fromAgent !== "market") involvedAgents.push(flow.fromAgent);
    if (flow.toAgent !== "market") involvedAgents.push(flow.toAgent);

    // Accumulate total symbol volume
    symbolTotalVolume.set(
      flow.symbol,
      (symbolTotalVolume.get(flow.symbol) ?? 0) + flow.usdcValue,
    );

    for (const agentId of involvedAgents) {
      // Agent total volume
      agentTotalVolume.set(agentId, (agentTotalVolume.get(agentId) ?? 0) + flow.usdcValue);

      // Agent x symbol volume
      if (!agentSymbolVolume.has(agentId)) {
        agentSymbolVolume.set(agentId, new Map());
      }
      const symMap = agentSymbolVolume.get(agentId)!;
      symMap.set(flow.symbol, (symMap.get(flow.symbol) ?? 0) + flow.usdcValue);

      // Track individual flow sizes for slippage estimation
      if (!agentFlowSizes.has(agentId)) {
        agentFlowSizes.set(agentId, []);
      }
      agentFlowSizes.get(agentId)!.push(flow.usdcValue);
    }
  }

  const estimates: MarketImpactEstimate[] = [];

  for (const [agentId, totalVol] of agentTotalVolume) {
    // Estimated slippage: average flow size determines slippage
    const flowSizes = agentFlowSizes.get(agentId) ?? [];
    const avgFlowSize = flowSizes.length > 0
      ? flowSizes.reduce((s, v) => s + v, 0) / flowSizes.length
      : 0;
    const estimatedSlippage = round2(
      (avgFlowSize / 1000) * SLIPPAGE_BPS_PER_1000_USDC,
    );

    // Market share by symbol
    const symMap = agentSymbolVolume.get(agentId) ?? new Map();
    const marketShareBySymbol: MarketImpactEstimate["marketShareBySymbol"] = [];

    for (const [symbol, agentVol] of symMap) {
      const totalSymVol = symbolTotalVolume.get(symbol) ?? 1;
      marketShareBySymbol.push({
        symbol,
        sharePercent: round2((agentVol / totalSymVol) * 100),
      });
    }

    marketShareBySymbol.sort((a, b) => b.sharePercent - a.sharePercent);

    estimates.push({
      agentId,
      estimatedSlippage,
      marketShareBySymbol,
      totalVolume: round2(totalVol),
    });
  }

  return estimates.sort((a, b) => b.totalVolume - a.totalVolume);
}

/**
 * Analyze token conviction for each agent-symbol pair.
 *
 * Conviction measures how much an agent believes in a token by comparing
 * buy-and-hold behavior vs active churning. A high conviction score means
 * the agent is consistently accumulating; a low score means frequent
 * buying and selling (churning).
 *
 * @returns Array of conviction scores for all agent-symbol pairs with activity.
 */
export function getTokenConviction(): TokenConviction[] {
  // Collect per-agent, per-symbol buy/sell amounts
  const pairData = new Map<string, { bought: number; sold: number; flowCount: number; directionChanges: number; lastDirection: "buy" | "sell" | null }>();

  for (const flow of flowBuffer) {
    // Process buys (market -> agent)
    if (flow.toAgent !== "market") {
      const key = `${flow.toAgent}:${flow.symbol}`;
      const existing = pairData.get(key) ?? { bought: 0, sold: 0, flowCount: 0, directionChanges: 0, lastDirection: null };
      existing.bought += flow.amount;
      existing.flowCount++;
      if (existing.lastDirection === "sell") existing.directionChanges++;
      existing.lastDirection = "buy";
      pairData.set(key, existing);
    }

    // Process sells (agent -> market)
    if (flow.fromAgent !== "market") {
      const key = `${flow.fromAgent}:${flow.symbol}`;
      const existing = pairData.get(key) ?? { bought: 0, sold: 0, flowCount: 0, directionChanges: 0, lastDirection: null };
      existing.sold += flow.amount;
      existing.flowCount++;
      if (existing.lastDirection === "buy") existing.directionChanges++;
      existing.lastDirection = "sell";
      pairData.set(key, existing);
    }
  }

  const convictions: TokenConviction[] = [];

  for (const [key, data] of pairData) {
    const [agentId, symbol] = key.split(":");
    const { bought, sold, flowCount, directionChanges } = data;
    const netPosition = bought - sold;
    const totalActivity = bought + sold;

    // Conviction score components:
    // 1. Net accumulation ratio (0-50 points): how much of activity is net accumulation
    const netRatio = totalActivity > 0 ? Math.abs(netPosition) / totalActivity : 0;
    const accumulationPoints = netRatio * CONVICTION_ACCUMULATION_POINTS_MAX;

    // 2. Direction consistency (0-30 points): fewer direction changes = more conviction
    const maxChanges = Math.max(flowCount - 1, 1);
    const consistencyRatio = 1 - (directionChanges / maxChanges);
    const consistencyPoints = consistencyRatio * CONVICTION_CONSISTENCY_POINTS_MAX;

    // 3. Accumulation bias (0-20 points): buying more than selling = positive conviction
    const buyBias = totalActivity > 0 ? (bought / totalActivity) : 0.5;
    // If net positive, full points proportional to buy bias; if net negative, penalize
    const biasPoints = netPosition >= 0 ? buyBias * CONVICTION_BUY_BIAS_POINTS_MAX : (1 - buyBias) * CONVICTION_SELL_BIAS_POINTS_MAX;

    const convictionScore = Math.round(Math.min(100, accumulationPoints + consistencyPoints + biasPoints));

    // Classify style
    let style: TokenConviction["style"];
    if (convictionScore >= CONVICTION_STRONG_ACCUMULATOR_THRESHOLD && netPosition > 0) style = "strong-accumulator";
    else if (convictionScore >= CONVICTION_ACCUMULATOR_THRESHOLD && netPosition > 0) style = "accumulator";
    else if (convictionScore >= CONVICTION_TRADER_THRESHOLD) style = "trader";
    else if (netPosition < 0) style = "distributor";
    else style = "churner";

    convictions.push({
      agentId,
      symbol,
      convictionScore,
      totalBought: Math.round(bought * 10000) / 10000,
      totalSold: Math.round(sold * 10000) / 10000,
      netPosition: Math.round(netPosition * 10000) / 10000,
      style,
    });
  }

  return convictions.sort((a, b) => b.convictionScore - a.convictionScore);
}

// ---------------------------------------------------------------------------
// Status & Diagnostics
// ---------------------------------------------------------------------------

/**
 * Get the current state of the flow analyzer.
 *
 * @returns Diagnostic information about the ring buffer and tracked agents.
 */
export function getFlowAnalyzerStatus(): {
  totalFlowsRecorded: number;
  bufferSize: number;
  bufferCapacity: number;
  uniqueSymbols: number;
  uniqueAgents: number;
  oldestFlow: string | null;
  newestFlow: string | null;
} {
  const symbolSet = new Set<string>();
  const agentSet = new Set<string>();

  for (const flow of flowBuffer) {
    symbolSet.add(flow.symbol);
    if (flow.fromAgent !== "market") agentSet.add(flow.fromAgent);
    if (flow.toAgent !== "market") agentSet.add(flow.toAgent);
  }

  return {
    totalFlowsRecorded: flowWriteCount,
    bufferSize: flowBuffer.length,
    bufferCapacity: MAX_FLOWS,
    uniqueSymbols: symbolSet.size,
    uniqueAgents: agentSet.size,
    oldestFlow: flowBuffer.length > 0 ? flowBuffer[flowBuffer.length - 1].timestamp : null,
    newestFlow: flowBuffer.length > 0 ? flowBuffer[0].timestamp : null,
  };
}

/**
 * Clear all recorded flows. Useful for testing or resetting state.
 */
export function clearFlows(): void {
  flowBuffer.length = 0;
  flowWriteCount = 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute flow momentum for an agent's flows.
 *
 * Compares flow velocity (flows per hour) in the first half of the observation
 * window versus the second half. "increasing" means the agent is trading more
 * frequently over time; "decreasing" means they are slowing down.
 */
function computeFlowMomentum(
  agentFlows: TokenFlow[],
): AgentFlowProfile["flowMomentum"] {
  if (agentFlows.length < 4) return "stable";

  // Sort by timestamp ascending for chronological analysis
  const sorted = [...agentFlows].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const midpoint = Math.floor(sorted.length / 2);
  const firstHalf = sorted.slice(0, midpoint);
  const secondHalf = sorted.slice(midpoint);

  // Calculate flows per hour for each half
  const firstVelocity = computeVelocity(firstHalf);
  const secondVelocity = computeVelocity(secondHalf);

  // Require at least 20% change to classify as increasing/decreasing
  if (firstVelocity === 0 && secondVelocity === 0) return "stable";
  if (firstVelocity === 0) return "increasing";

  const changeRatio = (secondVelocity - firstVelocity) / firstVelocity;

  if (changeRatio > FLOW_MOMENTUM_CHANGE_THRESHOLD) return "increasing";
  if (changeRatio < -FLOW_MOMENTUM_CHANGE_THRESHOLD) return "decreasing";
  return "stable";
}

/**
 * Calculate the number of flows per hour for a set of chronologically ordered flows.
 */
function computeVelocity(flows: TokenFlow[]): number {
  if (flows.length < 2) return 0;

  const firstTs = new Date(flows[0].timestamp).getTime();
  const lastTs = new Date(flows[flows.length - 1].timestamp).getTime();
  const spanHours = (lastTs - firstTs) / (1000 * 60 * 60);

  if (spanHours <= 0) return flows.length; // All in same instant
  return flows.length / spanHours;
}
