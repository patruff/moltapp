/**
 * DeFi Yield Optimizer for Idle USDC
 *
 * Manages idle USDC cash across agent wallets by tracking yield
 * opportunities on Solana DeFi protocols. Instead of leaving cash
 * earning 0%, agents can deposit idle USDC into yield-bearing positions.
 *
 * Supported strategies:
 * 1. Marinade Native SOL staking (mSOL) — ~7% APY
 * 2. Marginfi USDC lending — ~5% APY
 * 3. Drift USDC vault — ~6% APY
 * 4. JLP (Jupiter LP) — variable APY from trading fees
 *
 * Safety rules:
 * - Never deposit more than 50% of idle cash (keep buffer for trades)
 * - Auto-withdraw if agent needs cash for a trade
 * - Track all deposits/withdrawals for P&L attribution
 * - Emergency withdraw-all capability
 *
 * NOTE: This service tracks yield positions and calculates optimal
 * allocations. Actual DeFi interactions require program-specific
 * transaction construction (implemented as pluggable executors).
 */

import { nowISO } from "../lib/format-utils.ts";
import { round2 } from "../lib/math-utils.ts";
import { errorMessage } from "../lib/errors.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface YieldProtocol {
  id: string;
  name: string;
  asset: "USDC" | "SOL";
  /** Current APY as percentage */
  apy: number;
  /** Total value locked across all users */
  tvlUsd: number;
  /** Risk tier: 1 = lowest risk, 5 = highest */
  riskTier: 1 | 2 | 3 | 4 | 5;
  /** Protocol health status */
  status: "active" | "degraded" | "paused";
  /** Minimum deposit amount */
  minDeposit: number;
  /** Withdrawal delay in seconds (0 = instant) */
  withdrawalDelaySeconds: number;
  /** Program address on Solana */
  programAddress: string;
  /** Last updated timestamp */
  lastUpdated: string;
}

export interface YieldPosition {
  positionId: string;
  agentId: string;
  protocolId: string;
  protocolName: string;
  /** Amount deposited (USDC) */
  depositedAmount: number;
  /** Current value including accrued yield */
  currentValue: number;
  /** Yield earned (currentValue - depositedAmount) */
  yieldEarned: number;
  /** APY at time of deposit */
  depositApy: number;
  /** Current protocol APY */
  currentApy: number;
  depositedAt: string;
  lastUpdated: string;
  status: "active" | "withdrawing" | "closed";
}

export interface YieldAllocation {
  agentId: string;
  totalIdleCash: number;
  maxDeployable: number;
  allocations: Array<{
    protocolId: string;
    protocolName: string;
    amount: number;
    expectedApy: number;
    riskTier: number;
  }>;
  expectedBlendedApy: number;
  expectedDailyYield: number;
  expectedMonthlyYield: number;
}

export interface YieldSummary {
  totalDeposited: number;
  totalCurrentValue: number;
  totalYieldEarned: number;
  blendedApy: number;
  activePositions: number;
  byAgent: Array<{
    agentId: string;
    deposited: number;
    currentValue: number;
    yieldEarned: number;
    positionCount: number;
  }>;
  byProtocol: Array<{
    protocolId: string;
    protocolName: string;
    totalDeposited: number;
    currentApy: number;
    positionCount: number;
  }>;
  protocols: YieldProtocol[];
  lastUpdated: string;
}

export interface YieldConfig {
  /** Enable/disable yield optimization (default: true) */
  enabled: boolean;
  /** Maximum % of idle cash to deploy (default: 50) */
  maxDeploymentPercent: number;
  /** Minimum idle cash before deploying (default: 100 USDC) */
  minIdleCashThreshold: number;
  /** Maximum risk tier to use (default: 3) */
  maxRiskTier: 1 | 2 | 3 | 4 | 5;
  /** Auto-rebalance interval in minutes (default: 60) */
  rebalanceIntervalMinutes: number;
  /** Emergency withdrawal threshold: if protocol APY drops below this, withdraw */
  minAcceptableApy: number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Yield Calculation & Allocation Constants
 *
 * These constants control yield accrual calculations, risk penalty scoring,
 * decimal precision, and time-based yield projections across the DeFi yield
 * optimization system.
 */

/**
 * Days per year for continuous compounding formula.
 *
 * Uses 365.25 to account for leap years in the continuous compounding formula:
 * V = P * e^(r*t) where t = elapsedMs / (DAYS_PER_YEAR * MS_PER_DAY)
 *
 * Example: For 1 year elapsed at 7% APY:
 * - growthFactor = e^(0.07 * 1) = 1.0725
 * - $1000 deposited → $1072.50 after 1 year
 *
 * Impact: Higher value = slower yield accrual, lower value = faster accrual.
 * Using 365.25 is standard for financial calculations.
 */
const DAYS_PER_YEAR_COMPOUNDING = 365.25;

/**
 * Milliseconds per day for time unit conversion.
 *
 * Used to convert elapsed time in milliseconds to years for APY calculations.
 * Formula: 24 hours * 60 minutes * 60 seconds * 1000 milliseconds = 86,400,000 ms/day
 */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Days per year for simple daily yield projections.
 *
 * Used in expectedDailyYield calculation: totalAllocated * (apy / 100) / DAYS_PER_YEAR_SIMPLE
 *
 * Example: $10,000 allocated at 7.3% blended APY:
 * - Daily yield = 10000 * 0.073 / 365 = $2.00/day
 * - Monthly yield = 10000 * 0.073 / 12 = $60.83/month
 *
 * Uses 365 (not 365.25) as simpler approximation for projection estimates.
 */
const DAYS_PER_YEAR_SIMPLE = 365;

/**
 * Months per year for simple monthly yield projections.
 *
 * Used in expectedMonthlyYield calculation: totalAllocated * (apy / 100) / MONTHS_PER_YEAR
 */
const MONTHS_PER_YEAR = 12;

/**
 * Risk penalty base multiplier for allocation scoring.
 *
 * Formula: riskPenalty = RISK_PENALTY_MULTIPLIER^(riskTier - 1)
 *
 * Risk penalty table at 0.8 multiplier:
 * - Tier 1 (lowest risk):  0.8^0 = 1.00 (no penalty)
 * - Tier 2:                0.8^1 = 0.80 (20% penalty)
 * - Tier 3:                0.8^2 = 0.64 (36% penalty)
 * - Tier 4:                0.8^3 = 0.512 (49% penalty)
 * - Tier 5 (highest risk): 0.8^4 = 0.410 (59% penalty)
 *
 * Allocation score = APY * riskPenalty
 *
 * Example: MarginFi USDC (5.1% APY, tier 2):
 * - score = 5.1 * 0.8 = 4.08
 * Example: JLP (12.5% APY, tier 4):
 * - score = 12.5 * 0.512 = 6.40 (still higher score despite higher risk)
 *
 * Impact: Lower multiplier (e.g., 0.7) = harsher risk penalties, favors safer protocols.
 *         Higher multiplier (e.g., 0.9) = gentler penalties, allows more risky allocation.
 */
const RISK_PENALTY_MULTIPLIER = 0.8;

/**
 * Decimal rounding multiplier for 2-decimal USDC precision.
 *
 * Used in 4 calculations for rounding USDC amounts to 2 decimal places:
 * - Deployment amount calculation: Math.floor(value * 100) / 100
 * - Protocol-specific allocations: Math.floor(value * 100) / 100
 * - Remaining deployable amount: Math.floor(value * 100) / 100
 *
 * Example: $123.456789 USDC → Math.floor(123.456789 * 100) / 100 = $123.45
 *
 * Formula: Math.floor(amount * DECIMAL_PRECISION_MULTIPLIER) / DECIMAL_PRECISION_MULTIPLIER
 */
const DECIMAL_PRECISION_MULTIPLIER = 100;

const DEFAULT_CONFIG: YieldConfig = {
  enabled: true,
  maxDeploymentPercent: 50,
  minIdleCashThreshold: 100,
  maxRiskTier: 3,
  rebalanceIntervalMinutes: 60,
  minAcceptableApy: 1.0,
};

let currentConfig: YieldConfig = { ...DEFAULT_CONFIG };

export function configureYield(
  updates: Partial<YieldConfig>,
): YieldConfig {
  currentConfig = { ...currentConfig, ...updates };
  console.log(
    `[DeFiYield] Configuration updated:`,
    JSON.stringify(currentConfig),
  );
  return currentConfig;
}

export function getYieldConfig(): YieldConfig {
  return { ...currentConfig };
}

// ---------------------------------------------------------------------------
// Protocol Registry
// ---------------------------------------------------------------------------

const protocols: YieldProtocol[] = [
  {
    id: "marinade-msol",
    name: "Marinade Finance (mSOL)",
    asset: "SOL",
    apy: 7.2,
    tvlUsd: 1_200_000_000,
    riskTier: 2,
    status: "active",
    minDeposit: 0.1,
    withdrawalDelaySeconds: 0,
    programAddress: "MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD",
    lastUpdated: nowISO(),
  },
  {
    id: "marginfi-usdc",
    name: "MarginFi USDC Lending",
    asset: "USDC",
    apy: 5.1,
    tvlUsd: 800_000_000,
    riskTier: 2,
    status: "active",
    minDeposit: 10,
    withdrawalDelaySeconds: 0,
    programAddress: "MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA",
    lastUpdated: nowISO(),
  },
  {
    id: "drift-usdc-vault",
    name: "Drift USDC Earn Vault",
    asset: "USDC",
    apy: 6.3,
    tvlUsd: 500_000_000,
    riskTier: 3,
    status: "active",
    minDeposit: 50,
    withdrawalDelaySeconds: 300, // 5 min cooldown
    programAddress: "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH",
    lastUpdated: nowISO(),
  },
  {
    id: "jlp-vault",
    name: "Jupiter LP (JLP)",
    asset: "USDC",
    apy: 12.5,
    tvlUsd: 2_000_000_000,
    riskTier: 4,
    status: "active",
    minDeposit: 100,
    withdrawalDelaySeconds: 0,
    programAddress: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
    lastUpdated: nowISO(),
  },
];

/**
 * Update a protocol's current APY (called by market data feed).
 */
export function updateProtocolApy(protocolId: string, newApy: number): void {
  const protocol = protocols.find((p) => p.id === protocolId);
  if (protocol) {
    protocol.apy = newApy;
    protocol.lastUpdated = nowISO();
  }
}

/**
 * Update a protocol's status.
 */
export function updateProtocolStatus(
  protocolId: string,
  status: "active" | "degraded" | "paused",
): void {
  const protocol = protocols.find((p) => p.id === protocolId);
  if (protocol) {
    const oldStatus = protocol.status;
    protocol.status = status;
    protocol.lastUpdated = nowISO();
    console.log(
      `[DeFiYield] Protocol ${protocolId} status: ${oldStatus} -> ${status}`,
    );
  }
}

/**
 * Get all registered yield protocols.
 */
export function getProtocols(): YieldProtocol[] {
  return protocols.map((p) => ({ ...p }));
}

/**
 * Get eligible protocols based on current config.
 */
export function getEligibleProtocols(): YieldProtocol[] {
  return protocols.filter(
    (p) =>
      p.status === "active" &&
      p.riskTier <= currentConfig.maxRiskTier &&
      p.apy >= currentConfig.minAcceptableApy,
  );
}

// ---------------------------------------------------------------------------
// Position Tracking
// ---------------------------------------------------------------------------

const activePositions: YieldPosition[] = [];
const closedPositions: YieldPosition[] = [];
const MAX_CLOSED_HISTORY = 500;

/**
 * Simulate depositing idle cash into a yield protocol.
 * Returns the new position.
 */
export function depositToYield(
  agentId: string,
  protocolId: string,
  amount: number,
): YieldPosition {
  const protocol = protocols.find((p) => p.id === protocolId);
  if (!protocol) {
    throw new Error(`yield_protocol_not_found: ${protocolId}`);
  }
  if (protocol.status !== "active") {
    throw new Error(
      `yield_protocol_unavailable: ${protocolId} is ${protocol.status}`,
    );
  }
  if (amount < protocol.minDeposit) {
    throw new Error(
      `yield_min_deposit: minimum is ${protocol.minDeposit} ${protocol.asset}, got ${amount}`,
    );
  }

  const positionId = `yield_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const position: YieldPosition = {
    positionId,
    agentId,
    protocolId,
    protocolName: protocol.name,
    depositedAmount: amount,
    currentValue: amount, // No yield accrued yet
    yieldEarned: 0,
    depositApy: protocol.apy,
    currentApy: protocol.apy,
    depositedAt: nowISO(),
    lastUpdated: nowISO(),
    status: "active",
  };

  activePositions.push(position);

  console.log(
    `[DeFiYield] Agent ${agentId} deposited $${amount.toFixed(2)} into ${protocol.name} ` +
      `(APY: ${protocol.apy}%, position: ${positionId})`,
  );

  return position;
}

/**
 * Withdraw from a yield position.
 * Returns the final value including accrued yield.
 */
export function withdrawFromYield(
  positionId: string,
): { withdrawnAmount: number; yieldEarned: number } {
  const posIndex = activePositions.findIndex(
    (p) => p.positionId === positionId,
  );
  if (posIndex === -1) {
    throw new Error(`yield_position_not_found: ${positionId}`);
  }

  const position = activePositions[posIndex];

  // Calculate accrued yield
  accrueYield(position);

  const withdrawnAmount = position.currentValue;
  const yieldEarned = position.yieldEarned;

  // Move to closed
  position.status = "closed";
  position.lastUpdated = nowISO();
  closedPositions.push(position);
  activePositions.splice(posIndex, 1);

  // Trim closed history
  if (closedPositions.length > MAX_CLOSED_HISTORY) {
    closedPositions.splice(0, closedPositions.length - MAX_CLOSED_HISTORY);
  }

  console.log(
    `[DeFiYield] Withdrawn $${withdrawnAmount.toFixed(2)} from ${position.protocolName} ` +
      `(yield: $${yieldEarned.toFixed(4)}, agent: ${position.agentId})`,
  );

  return { withdrawnAmount, yieldEarned };
}

/**
 * Emergency withdraw all positions for an agent.
 */
export function emergencyWithdrawAll(
  agentId: string,
): { totalWithdrawn: number; totalYield: number; positionsClosed: number } {
  const agentPositions = activePositions.filter(
    (p) => p.agentId === agentId && p.status === "active",
  );

  let totalWithdrawn = 0;
  let totalYield = 0;

  for (const position of agentPositions) {
    try {
      const result = withdrawFromYield(position.positionId);
      totalWithdrawn += result.withdrawnAmount;
      totalYield += result.yieldEarned;
    } catch (err) {
      console.error(
        `[DeFiYield] Emergency withdraw failed for ${position.positionId}: ${errorMessage(err)}`,
      );
    }
  }

  console.warn(
    `[DeFiYield] Emergency withdraw for ${agentId}: $${totalWithdrawn.toFixed(2)} total ` +
      `($${totalYield.toFixed(4)} yield) from ${agentPositions.length} positions`,
  );

  return {
    totalWithdrawn,
    totalYield,
    positionsClosed: agentPositions.length,
  };
}

// ---------------------------------------------------------------------------
// Yield Accrual
// ---------------------------------------------------------------------------

/**
 * Accrue yield for a position based on time elapsed and APY.
 */
function accrueYield(position: YieldPosition): void {
  const protocol = protocols.find((p) => p.id === position.protocolId);
  const currentApy = protocol?.apy ?? position.depositApy;
  position.currentApy = currentApy;

  const depositedAt = new Date(position.depositedAt).getTime();
  const now = Date.now();
  const elapsedMs = now - depositedAt;
  const elapsedYears = elapsedMs / (DAYS_PER_YEAR_COMPOUNDING * MS_PER_DAY);

  // Continuous compounding: V = P * e^(r*t)
  const growthFactor = Math.exp((currentApy / 100) * elapsedYears);
  position.currentValue =
    round2(position.depositedAmount * growthFactor);
  position.yieldEarned =
    round2(position.currentValue - position.depositedAmount);
  position.lastUpdated = nowISO();
}

/**
 * Accrue yield for all active positions.
 */
export function accrueAllYield(): void {
  for (const position of activePositions) {
    accrueYield(position);
  }
}

// ---------------------------------------------------------------------------
// Optimal Allocation Calculator
// ---------------------------------------------------------------------------

/**
 * Calculate the optimal yield allocation for an agent's idle cash.
 *
 * Strategy:
 * 1. Never deploy more than maxDeploymentPercent of idle cash
 * 2. Diversify across eligible protocols weighted by risk-adjusted APY
 * 3. Higher APY protocols get smaller allocations if risk is higher
 * 4. Respect minimum deposit requirements
 */
export function calculateOptimalAllocation(
  agentId: string,
  idleCashUsdc: number,
): YieldAllocation {
  const maxDeployable =
    Math.floor(
      idleCashUsdc * (currentConfig.maxDeploymentPercent / 100) * DECIMAL_PRECISION_MULTIPLIER,
    ) / DECIMAL_PRECISION_MULTIPLIER;

  if (
    !currentConfig.enabled ||
    idleCashUsdc < currentConfig.minIdleCashThreshold
  ) {
    return {
      agentId,
      totalIdleCash: idleCashUsdc,
      maxDeployable: 0,
      allocations: [],
      expectedBlendedApy: 0,
      expectedDailyYield: 0,
      expectedMonthlyYield: 0,
    };
  }

  const eligible = getEligibleProtocols().filter(
    (p) => p.asset === "USDC", // Only USDC protocols for idle cash
  );

  if (eligible.length === 0) {
    return {
      agentId,
      totalIdleCash: idleCashUsdc,
      maxDeployable,
      allocations: [],
      expectedBlendedApy: 0,
      expectedDailyYield: 0,
      expectedMonthlyYield: 0,
    };
  }

  // Calculate risk-adjusted scores for each protocol
  const scoredProtocols = eligible.map((p) => {
    // Risk penalty: higher risk tier = lower score
    const riskPenalty = Math.pow(RISK_PENALTY_MULTIPLIER, p.riskTier - 1);
    const score = p.apy * riskPenalty;
    return { protocol: p, score };
  });

  // Sort by score descending
  scoredProtocols.sort((a, b) => b.score - a.score);

  // Allocate proportionally to scores
  const totalScore = scoredProtocols.reduce((sum, s) => sum + s.score, 0);
  const allocations: YieldAllocation["allocations"] = [];
  let totalAllocated = 0;

  for (const { protocol, score } of scoredProtocols) {
    const proportion = score / totalScore;
    let amount = Math.floor(maxDeployable * proportion * DECIMAL_PRECISION_MULTIPLIER) / DECIMAL_PRECISION_MULTIPLIER;

    // Respect minimum deposit
    if (amount < protocol.minDeposit) {
      continue;
    }

    // Don't exceed remaining deployable amount
    if (totalAllocated + amount > maxDeployable) {
      amount = Math.floor((maxDeployable - totalAllocated) * DECIMAL_PRECISION_MULTIPLIER) / DECIMAL_PRECISION_MULTIPLIER;
    }

    if (amount >= protocol.minDeposit) {
      allocations.push({
        protocolId: protocol.id,
        protocolName: protocol.name,
        amount,
        expectedApy: protocol.apy,
        riskTier: protocol.riskTier,
      });
      totalAllocated += amount;
    }
  }

  // Calculate blended APY
  const expectedBlendedApy =
    totalAllocated > 0
      ? allocations.reduce(
          (sum, a) => sum + a.expectedApy * (a.amount / totalAllocated),
          0,
        )
      : 0;

  const expectedDailyYield =
    round2(totalAllocated * (expectedBlendedApy / 100) / DAYS_PER_YEAR_SIMPLE);
  const expectedMonthlyYield =
    round2(totalAllocated * (expectedBlendedApy / 100) / MONTHS_PER_YEAR);

  return {
    agentId,
    totalIdleCash: idleCashUsdc,
    maxDeployable,
    allocations,
    expectedBlendedApy: round2(expectedBlendedApy),
    expectedDailyYield,
    expectedMonthlyYield,
  };
}

// ---------------------------------------------------------------------------
// Summary & Metrics
// ---------------------------------------------------------------------------

/**
 * Get comprehensive yield summary across all agents and protocols.
 */
export function getYieldSummary(): YieldSummary {
  // Accrue all yield first
  accrueAllYield();

  let totalDeposited = 0;
  let totalCurrentValue = 0;
  let totalYieldEarned = 0;

  const byAgentMap = new Map<
    string,
    { deposited: number; currentValue: number; yieldEarned: number; count: number }
  >();
  const byProtocolMap = new Map<
    string,
    { name: string; deposited: number; count: number }
  >();

  for (const pos of activePositions) {
    totalDeposited += pos.depositedAmount;
    totalCurrentValue += pos.currentValue;
    totalYieldEarned += pos.yieldEarned;

    // By agent
    const agentStats = byAgentMap.get(pos.agentId) ?? {
      deposited: 0,
      currentValue: 0,
      yieldEarned: 0,
      count: 0,
    };
    agentStats.deposited += pos.depositedAmount;
    agentStats.currentValue += pos.currentValue;
    agentStats.yieldEarned += pos.yieldEarned;
    agentStats.count++;
    byAgentMap.set(pos.agentId, agentStats);

    // By protocol
    const protocolStats = byProtocolMap.get(pos.protocolId) ?? {
      name: pos.protocolName,
      deposited: 0,
      count: 0,
    };
    protocolStats.deposited += pos.depositedAmount;
    protocolStats.count++;
    byProtocolMap.set(pos.protocolId, protocolStats);
  }

  const blendedApy =
    totalDeposited > 0
      ? activePositions.reduce(
          (sum, p) =>
            sum + p.currentApy * (p.depositedAmount / totalDeposited),
          0,
        )
      : 0;

  return {
    totalDeposited: round2(totalDeposited),
    totalCurrentValue: round2(totalCurrentValue),
    totalYieldEarned: round2(totalYieldEarned),
    blendedApy: round2(blendedApy),
    activePositions: activePositions.length,
    byAgent: Array.from(byAgentMap.entries()).map(([agentId, stats]) => ({
      agentId,
      deposited: round2(stats.deposited),
      currentValue: round2(stats.currentValue),
      yieldEarned: round2(stats.yieldEarned),
      positionCount: stats.count,
    })),
    byProtocol: Array.from(byProtocolMap.entries()).map(
      ([protocolId, stats]) => {
        const protocol = protocols.find((p) => p.id === protocolId);
        return {
          protocolId,
          protocolName: stats.name,
          totalDeposited: round2(stats.deposited),
          currentApy: protocol?.apy ?? 0,
          positionCount: stats.count,
        };
      },
    ),
    protocols: protocols.map((p) => ({ ...p })),
    lastUpdated: nowISO(),
  };
}

/**
 * Get active yield positions for an agent.
 */
export function getAgentYieldPositions(agentId: string): YieldPosition[] {
  // Accrue yield before returning
  for (const pos of activePositions.filter((p) => p.agentId === agentId)) {
    accrueYield(pos);
  }
  return activePositions
    .filter((p) => p.agentId === agentId)
    .map((p) => ({ ...p }));
}

/**
 * Get closed yield positions for an agent.
 */
export function getAgentClosedPositions(
  agentId: string,
  limit = 20,
): YieldPosition[] {
  return closedPositions
    .filter((p) => p.agentId === agentId)
    .slice(-limit)
    .map((p) => ({ ...p }));
}
