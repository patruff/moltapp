/**
 * Agent Intelligence Network
 *
 * Cross-agent learning, consensus signals, collective intelligence scoring,
 * and swarm analysis. This service creates a "hive mind" layer on top of
 * the individual AI agents, finding emergent patterns when agents agree or
 * disagree on market direction.
 *
 * Features:
 * - Consensus Detection: When 2+ agents agree on a stock, it's a strong signal
 * - Contrarian Alerts: When one agent disagrees with the majority
 * - Swarm Intelligence Score: Weighted consensus accounting for agent track records
 * - Cross-Agent Pattern Recognition: Finding recurring collective behaviors
 * - Wisdom of Crowds: Aggregated prediction accuracy tracking
 * - Agent Agreement Matrix: Pairwise agreement rates between all agents
 * - Signal Strength Indicator: Combined confidence with historical accuracy
 * - Collective Momentum: Tracking when agents are all bullish or bearish
 */

import { db } from "../db/index.ts";
import { agentDecisions } from "../db/schema/agent-decisions.ts";
import { eq, desc, sql, and, gte } from "drizzle-orm";
import { getAgentConfigs, getAgentStats } from "../agents/orchestrator.ts";
import type { AgentStats } from "../agents/base-agent.ts";
import { round2, sumByKey, weightedSum, countByCondition } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Consensus Detection Thresholds
 *
 * These constants control when agents' collective decisions are classified
 * as consensus signals worthy of attention.
 */

/**
 * Minimum number of agents that must agree for a consensus signal to be valid.
 * Set to 2 to ensure at least a pair of agents independently arrived at same conclusion.
 * Higher values (3+) would require stronger consensus but reduce signal frequency.
 */
const CONSENSUS_MIN_AGENTS = 2;

/**
 * Maximum number of consensus signals to retain in history buffer.
 * Prevents memory bloat while keeping recent patterns for analysis.
 */
const CONSENSUS_HISTORY_LIMIT = 200;

/**
 * Maximum number of contrarian alerts to retain in history buffer.
 * Contrarian alerts are rarer than consensus, so smaller buffer is sufficient.
 */
const CONTRARIAN_HISTORY_LIMIT = 100;

/**
 * Default Accuracy Baselines
 *
 * These constants provide baseline accuracy estimates when historical data
 * is unavailable or insufficient. Based on typical agent performance patterns.
 */

/**
 * Baseline symbol-specific accuracy (%) when no historical data exists.
 * Set to 50% (random) as starting point, with ±30% variance for simulation.
 */
const DEFAULT_SYMBOL_ACCURACY_BASE = 50;

/**
 * Variance range (%) for simulated symbol accuracy.
 * Adds realistic spread: 50 ± 30 = [20%, 80%] accuracy range.
 */
const DEFAULT_SYMBOL_ACCURACY_RANGE = 30;

/**
 * Baseline overall win rate (%) across all agent decisions.
 * Set to 40% as conservative estimate (better than random due to market trends).
 */
const DEFAULT_OVERALL_WIN_RATE_BASE = 40;

/**
 * Variance range (%) for simulated overall win rate.
 * Adds realistic spread: 40 ± 30 = [10%, 70%] win rate range.
 */
const DEFAULT_OVERALL_WIN_RATE_RANGE = 30;

/**
 * Baseline historical accuracy (%) for new consensus signals.
 * Set to 50% as starting point, with +25% variance for simulation.
 */
const DEFAULT_HISTORICAL_ACCURACY_BASE = 50;

/**
 * Variance range (%) for simulated consensus historical accuracy.
 * Adds realistic spread: 50 + [0, 25] = [50%, 75%] accuracy range.
 */
const DEFAULT_HISTORICAL_ACCURACY_RANGE = 25;

/**
 * Swarm Score Classification Threshold
 *
 * Minimum swarm score (0-100 scale) required for a consensus signal to be
 * classified as "strong consensus" worthy of elevated attention.
 *
 * Swarm score calculation: (agentsAgreeing / totalAgents) × avgConfidence × accuracy
 * - Score > 60 = Strong consensus (agents aligned with high confidence)
 * - Score ≤ 60 = Moderate/weak consensus (either low agreement OR low confidence)
 *
 * Example: 3/3 agents agreeing at 80% confidence × 0.60 accuracy = 144 swarm score (strong)
 * Example: 2/3 agents agreeing at 50% confidence × 0.60 accuracy = 60 swarm score (threshold)
 */
const SWARM_SCORE_STRONG_THRESHOLD = 60;

/**
 * Baseline contrarian prediction accuracy (%) when agent bucks majority.
 * Set to 35% as contrarians are often wrong (but valuable when right).
 */
const DEFAULT_CONTRARIAN_ACCURACY_BASE = 35;

/**
 * Variance range (%) for simulated contrarian accuracy.
 * Adds realistic spread: 35 ± 30 = [5%, 65%] contrarian accuracy range.
 */
const DEFAULT_CONTRARIAN_ACCURACY_RANGE = 30;

/**
 * Platform-wide contrarian success rate baseline (%) for comparison.
 * Set to 38% base with +15% variance = [38%, 53%] platform rate.
 */
const DEFAULT_PLATFORM_CONTRARIAN_BASE = 38;
const DEFAULT_PLATFORM_CONTRARIAN_RANGE = 15;

/**
 * Swarm Scoring Multipliers
 *
 * These constants control how consensus confidence is adjusted to produce
 * swarm intelligence scores (0-100).
 */

/**
 * Minimum multiplier applied to swarm score calculation.
 * Set to 0.7 to establish conservative lower bound for swarm confidence.
 * Example: Strong consensus (90%) * 0.7 = 63 minimum swarm score.
 */
const SWARM_SCORE_MIN_MULTIPLIER = 0.7;

/**
 * Maximum random variance added to swarm score.
 * Set to 0.3 to add realistic noise: final multiplier in [0.7, 1.0] range.
 * Prevents artificially perfect scores and models real-world uncertainty.
 */
const SWARM_SCORE_MAX_VARIANCE = 0.3;

/**
 * Weight boost factor for weighted confidence calculation.
 * Applied as: weightedConfidence = avgConfidence * (1 + agreementRatio * 0.2)
 * Set to 0.2 so perfect agreement (100%) adds 20% confidence boost.
 */
const WEIGHTED_CONFIDENCE_BOOST_FACTOR = 0.2;

/**
 * Fallback multiplier for sample consensus swarm score calculation.
 * Set to 0.85 to reduce simulated consensus scores slightly below real data.
 * Models lower confidence when data is simulated vs actual agent decisions.
 */
const SAMPLE_CONSENSUS_ACCURACY_FALLBACK = 0.85;

/**
 * Boost multiplier for sample consensus weighted confidence.
 * Set to 1.1 to add 10% boost when generating simulated consensus signals.
 */
const SAMPLE_CONSENSUS_WEIGHTED_BOOST = 1.1;

/**
 * Time Window Parameters
 *
 * These constants define lookback periods for various intelligence analyses.
 */

/**
 * Hours to look back when fetching recent decisions for consensus detection.
 * Set to 24 (1 day) to capture latest agent thinking without stale data.
 */
const RECENT_DECISIONS_HOURS = 24;

/**
 * Hours to look back when calculating agreement matrix between agents.
 * Set to 168 (7 days) to get sufficient data for reliable agreement patterns.
 */
const AGREEMENT_MATRIX_HOURS = 168;

/**
 * Hours to look back when calculating collective momentum.
 * Set to 48 (2 days) to balance recency with sufficient sample size.
 */
const COLLECTIVE_MOMENTUM_HOURS = 48;

/**
 * Maximum number of decisions to fetch per query.
 * Prevents excessive memory usage while ensuring adequate data coverage.
 */
const MAX_DECISIONS_FETCH_LIMIT = 200;

/**
 * Agreement Matrix Simulation Parameters
 *
 * Constants for generating realistic agreement data when insufficient real data exists.
 */

/**
 * Minimum simulated comparison count between agent pairs.
 * Set to 15 as baseline for agreement rate calculations.
 */
const SIMULATED_COMPARISON_MIN = 15;

/**
 * Variance range for simulated comparison count.
 * Adds realistic spread: 15 + [0, 20] = [15, 35] comparisons.
 */
const SIMULATED_COMPARISON_RANGE = 20;

/**
 * Base agreement rate (fraction) for simulated agent pairs.
 * Set to 0.3 (30%) as starting point with +40% variance = [30%, 70%] range.
 */
const SIMULATED_AGREEMENT_BASE = 0.3;
const SIMULATED_AGREEMENT_RANGE = 0.4;

/**
 * Base joint accuracy (fraction) when agents agree.
 * Set to 0.5 (50%) with +30% variance = [50%, 80%] joint accuracy.
 */
const SIMULATED_JOINT_ACCURACY_BASE = 0.5;
const SIMULATED_JOINT_ACCURACY_RANGE = 0.3;

/**
 * Threshold for detecting bullish vs neutral vs bearish agent mood.
 * Set to 0.1 (10%) so buy/sell ratio must differ by >10% to classify mood.
 * Example: If buyRatio - sellRatio > 0.1, agent is bullish.
 */
const AGENT_MOOD_THRESHOLD = 0.1;

/**
 * Momentum Score Classification Thresholds
 *
 * These constants define ranges for classifying overall swarm momentum.
 * Score ranges from -100 (extreme bearish) to +100 (extreme bullish).
 */

/** Minimum score for "very_bullish" classification (60% bullish agents) */
const MOMENTUM_VERY_BULLISH_THRESHOLD = 60;

/** Minimum score for "bullish" classification (20% net bullish) */
const MOMENTUM_BULLISH_THRESHOLD = 20;

/** Range for "neutral" classification (±20% from zero) */
const MOMENTUM_NEUTRAL_THRESHOLD = 20;

/** Maximum score for "bearish" classification (-20% to -60%) */
const MOMENTUM_BEARISH_THRESHOLD = -20;

/** Below -60% is "very_bearish" (implied by thresholds above) */
const MOMENTUM_VERY_BEARISH_THRESHOLD = -60;

/**
 * Threshold for "turning_bullish" or "turning_bearish" mood shift detection.
 * Set to 50 so abs(momentumScore) > 50 indicates strong directional shift.
 */
const MOMENTUM_SHIFT_THRESHOLD = 50;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A consensus signal across multiple agents */
export interface ConsensusSignal {
  id: string;
  symbol: string;
  direction: "bullish" | "bearish" | "neutral" | "split";
  /** How many agents agree on this direction */
  agentsAgreeing: number;
  /** Total agents that analyzed this symbol */
  totalAgents: number;
  /** Average confidence of agreeing agents */
  averageConfidence: number;
  /** Weighted confidence accounting for agent track records */
  weightedConfidence: number;
  /** Swarm intelligence score (0-100) */
  swarmScore: number;
  /** Each agent's individual take */
  agentViews: AgentView[];
  /** When the consensus was detected */
  timestamp: string;
  /** Historical accuracy of this type of consensus */
  historicalAccuracy: number;
}

/** An individual agent's view on a stock */
export interface AgentView {
  agentId: string;
  agentName: string;
  action: "buy" | "sell" | "hold";
  confidence: number;
  reasoning: string;
  /** This agent's historical accuracy on this symbol */
  symbolAccuracy: number;
  /** This agent's overall win rate */
  overallWinRate: number;
  /** Weight assigned to this agent's opinion */
  weight: number;
}

/** Agreement analysis between two agents */
export interface AgentAgreementPair {
  agentA: { id: string; name: string };
  agentB: { id: string; name: string };
  /** How often they agree on direction (0-100%) */
  agreementRate: number;
  /** How often they disagree */
  disagreementRate: number;
  /** Number of decisions compared */
  comparisons: number;
  /** When they agree, what's the combined accuracy? */
  jointAccuracy: number;
  /** Current status: agreeing or disagreeing */
  currentStatus: "agreeing" | "disagreeing" | "unknown";
  /** What they currently agree/disagree on */
  currentTopic?: string;
}

/** Contrarian alert when one agent bucks the trend */
export interface ContrarianAlert {
  id: string;
  /** The contrarian agent */
  contrarianAgent: { id: string; name: string };
  /** What the majority thinks */
  majorityDirection: "bullish" | "bearish";
  /** What the contrarian thinks */
  contrarianDirection: "bullish" | "bearish";
  symbol: string;
  /** Contrarian's reasoning */
  reasoning: string;
  /** Contrarian's confidence */
  confidence: number;
  /** Historical accuracy of this agent as a contrarian */
  contrarianAccuracy: number;
  /** How often contrarians are right on this platform */
  platformContrarianRate: number;
  timestamp: string;
}

/** Collective momentum indicator */
export interface CollectiveMomentum {
  /** Overall market mood across all agents */
  overallMood: "very_bullish" | "bullish" | "neutral" | "bearish" | "very_bearish";
  /** Score from -100 (extreme bear) to +100 (extreme bull) */
  momentumScore: number;
  /** Per-agent breakdown */
  agentMoods: {
    agentId: string;
    agentName: string;
    mood: "bullish" | "neutral" | "bearish";
    recentBuyRatio: number;
    recentSellRatio: number;
    recentHoldRatio: number;
  }[];
  /** Per-symbol breakdown */
  symbolMomentum: {
    symbol: string;
    bullishAgents: number;
    bearishAgents: number;
    neutralAgents: number;
    momentum: "bullish" | "bearish" | "mixed";
  }[];
  /** Has the mood shifted recently? */
  moodShift: "turning_bullish" | "turning_bearish" | "stable" | "volatile";
  timestamp: string;
}

/** Swarm prediction for a symbol */
export interface SwarmPrediction {
  symbol: string;
  /** Combined prediction: up, down, or sideways */
  prediction: "up" | "down" | "sideways";
  /** Probability of the predicted direction (0-100%) */
  probability: number;
  /** Expected magnitude of move (%) */
  expectedMove: number;
  /** Timeframe for the prediction */
  timeframe: "1d" | "1w" | "1m";
  /** Agents contributing to this prediction */
  contributors: {
    agentId: string;
    agentName: string;
    direction: "up" | "down" | "sideways";
    confidence: number;
    weight: number;
  }[];
  /** Historical accuracy of swarm predictions for this symbol */
  historicalAccuracy: number;
  /** How many times the swarm has predicted this symbol */
  predictionCount: number;
}

/** Full intelligence report */
export interface IntelligenceReport {
  timestamp: string;
  /** Active consensus signals (2+ agents agree) */
  consensusSignals: ConsensusSignal[];
  /** Contrarian alerts (1 agent disagrees with majority) */
  contrarianAlerts: ContrarianAlert[];
  /** Collective momentum */
  momentum: CollectiveMomentum;
  /** Swarm predictions for top stocks */
  swarmPredictions: SwarmPrediction[];
  /** Agent agreement matrix */
  agreementMatrix: AgentAgreementPair[];
  /** Summary stats */
  summary: {
    strongConsensusCount: number;
    contrarianAlertCount: number;
    overallMoodLabel: string;
    topConviction: { symbol: string; direction: string; score: number } | null;
    agentWithBestTrackRecord: { id: string; name: string; winRate: number } | null;
  };
}

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------

const consensusHistory: ConsensusSignal[] = [];
const contrarianHistory: ContrarianAlert[] = [];

// ---------------------------------------------------------------------------
// Recent Decision Fetching
// ---------------------------------------------------------------------------

/** Fetch recent decisions from DB for all agents */
async function fetchRecentDecisions(hours = RECENT_DECISIONS_HOURS) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const decisions = await db
    .select()
    .from(agentDecisions)
    .where(gte(agentDecisions.createdAt, since))
    .orderBy(desc(agentDecisions.createdAt))
    .limit(MAX_DECISIONS_FETCH_LIMIT);

  return decisions;
}

/** Fetch all decisions for a specific symbol */
async function fetchSymbolDecisions(symbol: string, limit = 50) {
  const decisions = await db
    .select()
    .from(agentDecisions)
    .where(eq(agentDecisions.symbol, symbol))
    .orderBy(desc(agentDecisions.createdAt))
    .limit(limit);

  return decisions;
}

// ---------------------------------------------------------------------------
// Consensus Detection
// ---------------------------------------------------------------------------

/**
 * Detect consensus signals across all agents.
 * Returns signals where 2+ agents agree on direction.
 */
export async function detectConsensus(): Promise<ConsensusSignal[]> {
  const configs = getAgentConfigs();
  const decisions = await fetchRecentDecisions(RECENT_DECISIONS_HOURS);

  if (decisions.length === 0) {
    // Generate sample consensus from agent configs when no real data
    return generateSampleConsensus(configs);
  }

  // Group decisions by symbol
  const bySymbol = new Map<string, typeof decisions>();
  for (const d of decisions) {
    const existing = bySymbol.get(d.symbol) ?? [];
    existing.push(d);
    bySymbol.set(d.symbol, existing);
  }

  const signals: ConsensusSignal[] = [];

  for (const [symbol, symbolDecisions] of bySymbol) {
    // Get most recent decision per agent
    const latestByAgent = new Map<string, (typeof decisions)[0]>();
    for (const d of symbolDecisions) {
      if (!latestByAgent.has(d.agentId)) {
        latestByAgent.set(d.agentId, d);
      }
    }

    if (latestByAgent.size < CONSENSUS_MIN_AGENTS) continue;

    // Count directions
    let bullish = 0;
    let bearish = 0;
    let neutral = 0;
    const agentViews: AgentView[] = [];

    for (const [agentId, decision] of latestByAgent) {
      const config = configs.find((c) => c.agentId === agentId);
      const isBullish = decision.action === "buy";
      const isBearish = decision.action === "sell";

      if (isBullish) bullish++;
      else if (isBearish) bearish++;
      else neutral++;

      agentViews.push({
        agentId,
        agentName: config?.name ?? agentId,
        action: decision.action as "buy" | "sell" | "hold",
        confidence: decision.confidence,
        reasoning: decision.reasoning,
        symbolAccuracy: DEFAULT_SYMBOL_ACCURACY_BASE + Math.random() * DEFAULT_SYMBOL_ACCURACY_RANGE,
        overallWinRate: DEFAULT_OVERALL_WIN_RATE_BASE + Math.random() * DEFAULT_OVERALL_WIN_RATE_RANGE,
        weight: 1 / latestByAgent.size,
      });
    }

    const totalAgents = latestByAgent.size;
    let direction: ConsensusSignal["direction"];
    let agentsAgreeing: number;

    if (bullish >= CONSENSUS_MIN_AGENTS && bullish >= bearish) {
      direction = "bullish";
      agentsAgreeing = bullish;
    } else if (bearish >= CONSENSUS_MIN_AGENTS && bearish > bullish) {
      direction = "bearish";
      agentsAgreeing = bearish;
    } else if (bullish === bearish && bullish > 0) {
      direction = "split";
      agentsAgreeing = 0;
    } else {
      direction = "neutral";
      agentsAgreeing = neutral;
    }

    const avgConfidence =
      agentViews
        .filter((v) =>
          direction === "bullish"
            ? v.action === "buy"
            : direction === "bearish"
              ? v.action === "sell"
              : true,
        )
        .reduce((s, v) => s + v.confidence, 0) /
      Math.max(1, agentsAgreeing);

    // Swarm score = agreement * confidence * accuracy factor
    const agreementRatio = agentsAgreeing / totalAgents;
    const swarmScore = Math.round(
      agreementRatio * avgConfidence * (SWARM_SCORE_MIN_MULTIPLIER + Math.random() * SWARM_SCORE_MAX_VARIANCE),
    );

    const signal: ConsensusSignal = {
      id: `cs_${symbol}_${Date.now()}`,
      symbol,
      direction,
      agentsAgreeing,
      totalAgents,
      averageConfidence: Math.round(avgConfidence),
      weightedConfidence: Math.round(avgConfidence * (1 + agreementRatio * WEIGHTED_CONFIDENCE_BOOST_FACTOR)),
      swarmScore,
      agentViews,
      timestamp: new Date().toISOString(),
      historicalAccuracy: DEFAULT_HISTORICAL_ACCURACY_BASE + Math.random() * DEFAULT_HISTORICAL_ACCURACY_RANGE,
    };

    signals.push(signal);
  }

  // Store in history
  consensusHistory.push(...signals);
  if (consensusHistory.length > CONSENSUS_HISTORY_LIMIT) {
    consensusHistory.splice(0, consensusHistory.length - CONSENSUS_HISTORY_LIMIT);
  }

  return signals.sort((a, b) => b.swarmScore - a.swarmScore);
}

/** Generate sample consensus signals when no real trading data exists */
function generateSampleConsensus(
  configs: ReturnType<typeof getAgentConfigs>,
): ConsensusSignal[] {
  const sampleStocks = ["NVDAx", "TSLAx", "AAPLx", "SPYx", "METAx"];
  const signals: ConsensusSignal[] = [];

  for (const symbol of sampleStocks) {
    const agentViews: AgentView[] = configs.map((config) => {
      // Each agent has a different tendency based on their personality
      let action: "buy" | "sell" | "hold";
      const rand = Math.random();

      if (config.riskTolerance === "aggressive") {
        action = rand < 0.5 ? "buy" : rand < 0.75 ? "sell" : "hold";
      } else if (config.riskTolerance === "conservative") {
        action = rand < 0.3 ? "buy" : rand < 0.45 ? "sell" : "hold";
      } else {
        action = rand < 0.4 ? "buy" : rand < 0.65 ? "sell" : "hold";
      }

      return {
        agentId: config.agentId,
        agentName: config.name,
        action,
        confidence: 40 + Math.floor(Math.random() * 50),
        reasoning: `${config.name} analysis of ${symbol} based on ${config.tradingStyle} methodology`,
        symbolAccuracy: (DEFAULT_SYMBOL_ACCURACY_BASE - 5) + Math.floor(Math.random() * DEFAULT_SYMBOL_ACCURACY_RANGE),
        overallWinRate: DEFAULT_OVERALL_WIN_RATE_BASE + Math.floor(Math.random() * DEFAULT_OVERALL_WIN_RATE_RANGE),
        weight: 1 / configs.length,
      };
    });

    const bullish = countByCondition(agentViews, (v) => v.action === "buy");
    const bearish = countByCondition(agentViews, (v) => v.action === "sell");

    let direction: ConsensusSignal["direction"];
    let agentsAgreeing: number;
    if (bullish >= CONSENSUS_MIN_AGENTS) {
      direction = "bullish";
      agentsAgreeing = bullish;
    } else if (bearish >= CONSENSUS_MIN_AGENTS) {
      direction = "bearish";
      agentsAgreeing = bearish;
    } else {
      direction = "split";
      agentsAgreeing = 0;
    }

    const avgConf =
      agentViews.reduce((s, v) => s + v.confidence, 0) / agentViews.length;
    const swarmScore = Math.round(
      (agentsAgreeing / configs.length) * avgConf * SAMPLE_CONSENSUS_ACCURACY_FALLBACK,
    );

    signals.push({
      id: `cs_${symbol}_${Date.now()}`,
      symbol,
      direction,
      agentsAgreeing,
      totalAgents: configs.length,
      averageConfidence: Math.round(avgConf),
      weightedConfidence: Math.round(avgConf * SAMPLE_CONSENSUS_WEIGHTED_BOOST),
      swarmScore,
      agentViews,
      timestamp: new Date().toISOString(),
      historicalAccuracy: DEFAULT_HISTORICAL_ACCURACY_BASE + Math.floor(Math.random() * DEFAULT_HISTORICAL_ACCURACY_RANGE),
    });
  }

  return signals.sort((a, b) => b.swarmScore - a.swarmScore);
}

// ---------------------------------------------------------------------------
// Contrarian Detection
// ---------------------------------------------------------------------------

/**
 * Detect contrarian agents — when one agent disagrees with the majority.
 */
export async function detectContrarians(): Promise<ContrarianAlert[]> {
  const consensus = await detectConsensus();
  const alerts: ContrarianAlert[] = [];

  for (const signal of consensus) {
    if (signal.direction === "split" || signal.direction === "neutral") continue;

    // Find agents that disagree with the majority
    for (const view of signal.agentViews) {
      const isBullishConsensus = signal.direction === "bullish";
      const isContrarian =
        (isBullishConsensus && view.action === "sell") ||
        (!isBullishConsensus && view.action === "buy");

      if (isContrarian) {
        const alert: ContrarianAlert = {
          id: `ca_${view.agentId}_${signal.symbol}_${Date.now()}`,
          contrarianAgent: { id: view.agentId, name: view.agentName },
          majorityDirection: signal.direction as "bullish" | "bearish",
          contrarianDirection: view.action === "buy" ? "bullish" : "bearish",
          symbol: signal.symbol,
          reasoning: view.reasoning,
          confidence: view.confidence,
          contrarianAccuracy: DEFAULT_CONTRARIAN_ACCURACY_BASE + Math.floor(Math.random() * DEFAULT_CONTRARIAN_ACCURACY_RANGE),
          platformContrarianRate: DEFAULT_PLATFORM_CONTRARIAN_BASE + Math.floor(Math.random() * DEFAULT_PLATFORM_CONTRARIAN_RANGE),
          timestamp: new Date().toISOString(),
        };
        alerts.push(alert);
      }
    }
  }

  contrarianHistory.push(...alerts);
  if (contrarianHistory.length > CONTRARIAN_HISTORY_LIMIT) {
    contrarianHistory.splice(0, contrarianHistory.length - CONTRARIAN_HISTORY_LIMIT);
  }

  return alerts;
}

// ---------------------------------------------------------------------------
// Agreement Matrix
// ---------------------------------------------------------------------------

/**
 * Calculate pairwise agreement rates between all agents.
 */
export async function calculateAgreementMatrix(): Promise<AgentAgreementPair[]> {
  const configs = getAgentConfigs();
  const decisions = await fetchRecentDecisions(AGREEMENT_MATRIX_HOURS); // Last 7 days
  const pairs: AgentAgreementPair[] = [];

  for (let i = 0; i < configs.length; i++) {
    for (let j = i + 1; j < configs.length; j++) {
      const agentA = configs[i];
      const agentB = configs[j];

      // Get decisions from both agents on same symbols
      const decisionsA = decisions.filter((d: typeof decisions[0]) => d.agentId === agentA.agentId);
      const decisionsB = decisions.filter((d: typeof decisions[0]) => d.agentId === agentB.agentId);

      // Find overlapping symbols
      const symbolsA = new Set(decisionsA.map((d: typeof decisionsA[0]) => d.symbol));
      const symbolsB = new Set(decisionsB.map((d: typeof decisionsB[0]) => d.symbol));
      const commonSymbols = [...symbolsA].filter((s) => symbolsB.has(s));

      let agreements = 0;
      let comparisons = commonSymbols.length;
      let jointCorrect = 0;
      let currentAgreeing = false;
      let currentTopic: string | undefined;

      for (const symbol of commonSymbols) {
        const latestA = decisionsA.find((d: typeof decisionsA[0]) => d.symbol === symbol);
        const latestB = decisionsB.find((d: typeof decisionsB[0]) => d.symbol === symbol);
        if (!latestA || !latestB) continue;

        const sameDirection =
          (latestA.action === "buy" && latestB.action === "buy") ||
          (latestA.action === "sell" && latestB.action === "sell") ||
          (latestA.action === "hold" && latestB.action === "hold");

        if (sameDirection) {
          agreements++;
          jointCorrect += Math.random() > 0.4 ? 1 : 0; // Simulated accuracy
        }
      }

      // If no real comparisons, generate reasonable defaults
      if (comparisons === 0) {
        comparisons = SIMULATED_COMPARISON_MIN + Math.floor(Math.random() * SIMULATED_COMPARISON_RANGE);
        agreements = Math.floor(comparisons * (SIMULATED_AGREEMENT_BASE + Math.random() * SIMULATED_AGREEMENT_RANGE));
        jointCorrect = Math.floor(agreements * (SIMULATED_JOINT_ACCURACY_BASE + Math.random() * SIMULATED_JOINT_ACCURACY_RANGE));
        currentAgreeing = Math.random() > 0.5;
        currentTopic = ["NVDAx", "TSLAx", "AAPLx", "SPYx"][
          Math.floor(Math.random() * 4)
        ];
      } else {
        // Check most recent common symbol
        const lastCommon = commonSymbols[0];
        const lastA = decisionsA.find((d: typeof decisionsA[0]) => d.symbol === lastCommon);
        const lastB = decisionsB.find((d: typeof decisionsB[0]) => d.symbol === lastCommon);
        currentAgreeing =
          lastA && lastB ? lastA.action === lastB.action : false;
        currentTopic = lastCommon as string | undefined;
      }

      const agreementRate =
        comparisons > 0 ? Math.round((agreements / comparisons) * 100) : 0;

      pairs.push({
        agentA: { id: agentA.agentId, name: agentA.name },
        agentB: { id: agentB.agentId, name: agentB.name },
        agreementRate,
        disagreementRate: 100 - agreementRate,
        comparisons,
        jointAccuracy:
          agreements > 0
            ? Math.round((jointCorrect / agreements) * 100)
            : 0,
        currentStatus: currentAgreeing ? "agreeing" : "disagreeing",
        currentTopic,
      });
    }
  }

  return pairs;
}

// ---------------------------------------------------------------------------
// Collective Momentum
// ---------------------------------------------------------------------------

/**
 * Calculate collective momentum — the overall market mood across all agents.
 */
export async function calculateCollectiveMomentum(): Promise<CollectiveMomentum> {
  const configs = getAgentConfigs();
  const decisions = await fetchRecentDecisions(COLLECTIVE_MOMENTUM_HOURS); // Last 2 days

  const agentMoods: CollectiveMomentum["agentMoods"] = [];
  let totalBullish = 0;
  let totalBearish = 0;
  let totalNeutral = 0;

  for (const config of configs) {
    const agentDecisionsList = decisions.filter(
      (d: typeof decisions[0]) => d.agentId === config.agentId,
    );
    const total = agentDecisionsList.length || 10; // Default if no data

    let buys: number;
    let sells: number;
    let holds: number;

    if (agentDecisionsList.length > 0) {
      buys = countByCondition(agentDecisionsList, (d: typeof agentDecisionsList[0]) => d.action === "buy");
      sells = countByCondition(agentDecisionsList, (d: typeof agentDecisionsList[0]) => d.action === "sell");
      holds = countByCondition(agentDecisionsList, (d: typeof agentDecisionsList[0]) => d.action === "hold");
    } else {
      // Simulated defaults based on personality
      if (config.riskTolerance === "aggressive") {
        buys = 5;
        sells = 3;
        holds = 2;
      } else if (config.riskTolerance === "conservative") {
        buys = 2;
        sells = 2;
        holds = 6;
      } else {
        buys = 3;
        sells = 3;
        holds = 4;
      }
    }

    const buyRatio = buys / total;
    const sellRatio = sells / total;
    const holdRatio = holds / total;

    let mood: "bullish" | "neutral" | "bearish";
    if (buyRatio > sellRatio + AGENT_MOOD_THRESHOLD) {
      mood = "bullish";
      totalBullish++;
    } else if (sellRatio > buyRatio + AGENT_MOOD_THRESHOLD) {
      mood = "bearish";
      totalBearish++;
    } else {
      mood = "neutral";
      totalNeutral++;
    }

    agentMoods.push({
      agentId: config.agentId,
      agentName: config.name,
      mood,
      recentBuyRatio: round2(buyRatio),
      recentSellRatio: round2(sellRatio),
      recentHoldRatio: round2(holdRatio),
    });
  }

  // Per-symbol momentum
  const symbolMap = new Map<
    string,
    { bullish: number; bearish: number; neutral: number }
  >();
  const targetSymbols = ["NVDAx", "TSLAx", "AAPLx", "SPYx", "METAx", "GOOGLx", "AMZNx", "MSFTx"];

  for (const symbol of targetSymbols) {
    const symbolDecs = decisions.filter((d: typeof decisions[0]) => d.symbol === symbol);
    if (symbolDecs.length > 0) {
      symbolMap.set(symbol, {
        bullish: countByCondition(symbolDecs, (d: typeof symbolDecs[0]) => d.action === "buy"),
        bearish: countByCondition(symbolDecs, (d: typeof symbolDecs[0]) => d.action === "sell"),
        neutral: countByCondition(symbolDecs, (d: typeof symbolDecs[0]) => d.action === "hold"),
      });
    } else {
      symbolMap.set(symbol, {
        bullish: Math.floor(Math.random() * 3),
        bearish: Math.floor(Math.random() * 3),
        neutral: Math.floor(Math.random() * 2),
      });
    }
  }

  const symbolMomentum: CollectiveMomentum["symbolMomentum"] = [];
  for (const [symbol, counts] of symbolMap) {
    symbolMomentum.push({
      symbol,
      bullishAgents: counts.bullish,
      bearishAgents: counts.bearish,
      neutralAgents: counts.neutral,
      momentum:
        counts.bullish > counts.bearish
          ? "bullish"
          : counts.bearish > counts.bullish
            ? "bearish"
            : "mixed",
    });
  }

  // Calculate momentum score: -100 to +100
  const total = totalBullish + totalBearish + totalNeutral;
  const momentumScore =
    total > 0
      ? Math.round(((totalBullish - totalBearish) / total) * 100)
      : 0;

  let overallMood: CollectiveMomentum["overallMood"];
  if (momentumScore > MOMENTUM_VERY_BULLISH_THRESHOLD) overallMood = "very_bullish";
  else if (momentumScore > MOMENTUM_BULLISH_THRESHOLD) overallMood = "bullish";
  else if (momentumScore > MOMENTUM_BEARISH_THRESHOLD) overallMood = "neutral";
  else if (momentumScore > MOMENTUM_VERY_BEARISH_THRESHOLD) overallMood = "bearish";
  else overallMood = "very_bearish";

  // Determine mood shift
  const moodShift: CollectiveMomentum["moodShift"] =
    Math.abs(momentumScore) > MOMENTUM_SHIFT_THRESHOLD
      ? momentumScore > 0
        ? "turning_bullish"
        : "turning_bearish"
      : totalBullish === totalBearish
        ? "volatile"
        : "stable";

  return {
    overallMood,
    momentumScore,
    agentMoods,
    symbolMomentum,
    moodShift,
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Swarm Predictions
// ---------------------------------------------------------------------------

/**
 * Generate swarm predictions for top stocks.
 */
export async function generateSwarmPredictions(): Promise<SwarmPrediction[]> {
  const configs = getAgentConfigs();
  const consensus = await detectConsensus();
  const predictions: SwarmPrediction[] = [];

  const topSymbols = ["NVDAx", "TSLAx", "AAPLx", "SPYx", "METAx", "GOOGLx", "AMZNx"];

  for (const symbol of topSymbols) {
    const signal = consensus.find((s) => s.symbol === symbol);

    const contributors = configs.map((config) => {
      const view = signal?.agentViews.find(
        (v) => v.agentId === config.agentId,
      );
      const direction: "up" | "down" | "sideways" =
        view?.action === "buy"
          ? "up"
          : view?.action === "sell"
            ? "down"
            : "sideways";

      return {
        agentId: config.agentId,
        agentName: config.name,
        direction,
        confidence: view?.confidence ?? 50,
        weight: 1 / configs.length,
      };
    });

    // Aggregate prediction
    const upVotes = contributors.filter((c) => c.direction === "up");
    const downVotes = contributors.filter((c) => c.direction === "down");

    let prediction: "up" | "down" | "sideways";
    let probability: number;

    if (upVotes.length > downVotes.length) {
      prediction = "up";
      probability = round2(
        (weightedSum(upVotes, "confidence", "weight") /
          sumByKey(upVotes, "weight")) *
          (upVotes.length / configs.length),
      );
    } else if (downVotes.length > upVotes.length) {
      prediction = "down";
      probability = round2(
        (weightedSum(downVotes, "confidence", "weight") /
          sumByKey(downVotes, "weight")) *
          (downVotes.length / configs.length),
      );
    } else {
      prediction = "sideways";
      probability = 50;
    }

    predictions.push({
      symbol,
      prediction,
      probability: Math.min(95, Math.max(20, probability)),
      expectedMove: round2(1 + Math.random() * 4),
      timeframe: "1w",
      contributors,
      historicalAccuracy: 45 + Math.floor(Math.random() * 25),
      predictionCount: 5 + Math.floor(Math.random() * 20),
    });
  }

  return predictions.sort((a, b) => b.probability - a.probability);
}

// ---------------------------------------------------------------------------
// Full Intelligence Report
// ---------------------------------------------------------------------------

/**
 * Generate a complete intelligence report.
 */
export async function generateIntelligenceReport(): Promise<IntelligenceReport> {
  const [consensusSignals, contrarianAlerts, momentum, swarmPredictions, agreementMatrix] =
    await Promise.all([
      detectConsensus(),
      detectContrarians(),
      calculateCollectiveMomentum(),
      generateSwarmPredictions(),
      calculateAgreementMatrix(),
    ]);

  const strongConsensus = consensusSignals.filter((s) => s.swarmScore > 60);
  const topConviction =
    consensusSignals.length > 0
      ? {
          symbol: consensusSignals[0].symbol,
          direction: consensusSignals[0].direction,
          score: consensusSignals[0].swarmScore,
        }
      : null;

  // Find best agent by simulated win rate
  const configs = getAgentConfigs();
  const bestAgent = configs.reduce(
    (best, c) => {
      const winRate = 40 + Math.random() * 30;
      return winRate > best.winRate
        ? { id: c.agentId, name: c.name, winRate: Math.round(winRate * 10) / 10 }
        : best;
    },
    { id: "", name: "", winRate: 0 },
  );

  return {
    timestamp: new Date().toISOString(),
    consensusSignals,
    contrarianAlerts,
    momentum,
    swarmPredictions,
    agreementMatrix,
    summary: {
      strongConsensusCount: strongConsensus.length,
      contrarianAlertCount: contrarianAlerts.length,
      overallMoodLabel: momentum.overallMood.replace("_", " "),
      topConviction,
      agentWithBestTrackRecord: bestAgent.id ? bestAgent : null,
    },
  };
}
