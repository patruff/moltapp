/**
 * Cross-Agent Correlation Analyzer
 *
 * Analyzes trading behavior ACROSS all 3 AI agents to detect:
 * 1. Herding — agents converging on the same trades (risky)
 * 2. Diversification — agents naturally spreading risk (good)
 * 3. Contrarian signals — when one agent disagrees with the majority
 * 4. Style drift — agents deviating from their stated strategy
 * 5. Consensus quality — does majority agreement predict better outcomes?
 *
 * This is the "meta-intelligence" layer — it doesn't trade, it analyzes
 * the agents' collective behavior to surface insights for the dashboard.
 */

import { countByCondition, round3 } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentDecisionRecord {
  agentId: string;
  agentName: string;
  action: "buy" | "sell" | "hold";
  symbol: string;
  quantity: number;
  confidence: number;
  reasoning: string;
  timestamp: string;
  roundId: string;
  executed: boolean;
  pnlResult?: number; // realized P&L from this decision (if closed)
}

export interface HerdingAlert {
  type: "herding";
  severity: "low" | "medium" | "high";
  roundId: string;
  symbol: string;
  agents: { agentId: string; action: string; confidence: number }[];
  message: string;
  timestamp: string;
}

export interface ContrarianSignal {
  type: "contrarian";
  roundId: string;
  symbol: string;
  contrarianAgent: { agentId: string; action: string; confidence: number };
  majorityAgents: { agentId: string; action: string; confidence: number }[];
  /** Historical accuracy of contrarian calls from this agent */
  historicalAccuracy: number | null;
  message: string;
  timestamp: string;
}

export interface StyleDriftAlert {
  type: "style_drift";
  agentId: string;
  agentName: string;
  expectedStyle: string;
  detectedBehavior: string;
  driftScore: number; // 0-1, higher = more drift
  evidence: string[];
  timestamp: string;
}

export interface ConsensusMetrics {
  roundId: string;
  timestamp: string;
  /** How many agents agree on the same action for the same stock */
  agreementLevel: "unanimous" | "majority" | "split" | "all_hold";
  /** Agents that agree */
  majorityAction: string | null;
  majoritySymbol: string | null;
  majorityCount: number;
  /** The contrarian if one exists */
  contrarian: { agentId: string; action: string } | null;
  /** Average confidence of the majority */
  majorityAvgConfidence: number;
  /** Did the majority's decision make money? (filled in post-hoc) */
  majorityProfitable: boolean | null;
}

export interface CrossAgentReport {
  generatedAt: string;
  periodDays: number;
  totalRoundsAnalyzed: number;
  herdingAlerts: HerdingAlert[];
  contrarianSignals: ContrarianSignal[];
  styleDriftAlerts: StyleDriftAlert[];
  consensusHistory: ConsensusMetrics[];
  correlationMatrix: AgentCorrelation[];
  insights: string[];
  stats: {
    herdingFrequency: number; // % of rounds with herding
    contrarianAccuracy: number; // % of contrarian calls that were correct
    unanimousAccuracy: number; // % of unanimous decisions that profited
    avgAgreementLevel: number; // 0-1
    mostCorrelatedPair: { agents: [string, string]; correlation: number } | null;
    leastCorrelatedPair: { agents: [string, string]; correlation: number } | null;
  };
}

export interface AgentCorrelation {
  agent1: string;
  agent2: string;
  /** Pearson correlation of buy/sell signals (-1 to 1) */
  signalCorrelation: number;
  /** % of rounds where both agents chose the same action */
  agreementRate: number;
  /** % of rounds where agents chose opposite actions */
  disagreementRate: number;
  /** Number of rounds analyzed */
  roundsAnalyzed: number;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** In-memory store of recent decisions for analysis */
const decisionLog: AgentDecisionRecord[] = [];
const MAX_DECISIONS = 5000;

/** Cached consensus metrics per round */
const consensusCache = new Map<string, ConsensusMetrics>();

/** Herding alerts */
const herdingAlerts: HerdingAlert[] = [];
const MAX_ALERTS = 200;

/** Contrarian signals */
const contrarianSignals: ContrarianSignal[] = [];

/** Style drift alerts */
const styleDriftAlerts: StyleDriftAlert[] = [];

/** Expected style profiles for each agent */
const AGENT_STYLE_PROFILES: Record<
  string,
  {
    name: string;
    expectedRiskTolerance: "conservative" | "moderate" | "aggressive";
    expectedHoldRate: [number, number]; // [min, max] % of rounds as hold
    expectedAvgConfidence: [number, number]; // [min, max]
    expectedTradeFrequency: "low" | "medium" | "high";
  }
> = {
  agent_claude: {
    name: "Claude",
    expectedRiskTolerance: "moderate",
    expectedHoldRate: [0.3, 0.6],
    expectedAvgConfidence: [50, 80],
    expectedTradeFrequency: "medium",
  },
  agent_gpt: {
    name: "GPT",
    expectedRiskTolerance: "conservative",
    expectedHoldRate: [0.4, 0.7],
    expectedAvgConfidence: [55, 85],
    expectedTradeFrequency: "low",
  },
  agent_grok: {
    name: "Grok",
    expectedRiskTolerance: "aggressive",
    expectedHoldRate: [0.1, 0.4],
    expectedAvgConfidence: [40, 75],
    expectedTradeFrequency: "high",
  },
};

// ---------------------------------------------------------------------------
// Decision Recording
// ---------------------------------------------------------------------------

/**
 * Record a decision from the orchestrator for cross-agent analysis.
 * Called after each agent makes a decision in a trading round.
 */
export function recordDecision(decision: AgentDecisionRecord): void {
  decisionLog.push(decision);
  if (decisionLog.length > MAX_DECISIONS) {
    decisionLog.splice(0, decisionLog.length - MAX_DECISIONS);
  }
}

/**
 * Record multiple decisions from a complete round.
 */
export function recordRoundDecisions(
  roundId: string,
  decisions: AgentDecisionRecord[],
): void {
  for (const d of decisions) {
    recordDecision(d);
  }

  // Analyze the round immediately
  const consensus = analyzeRoundConsensus(roundId, decisions);
  consensusCache.set(roundId, consensus);

  // Check for herding
  const herding = detectHerding(roundId, decisions);
  if (herding) {
    herdingAlerts.push(herding);
    if (herdingAlerts.length > MAX_ALERTS) herdingAlerts.shift();
  }

  // Check for contrarian signals
  const contrarian = detectContrarian(roundId, decisions);
  if (contrarian) {
    contrarianSignals.push(contrarian);
    if (contrarianSignals.length > MAX_ALERTS) contrarianSignals.shift();
  }

  // Check for style drift (every 10 rounds)
  if (decisionLog.length % 30 === 0) {
    for (const agentId of Object.keys(AGENT_STYLE_PROFILES)) {
      const drift = detectStyleDrift(agentId);
      if (drift) {
        styleDriftAlerts.push(drift);
        if (styleDriftAlerts.length > MAX_ALERTS) styleDriftAlerts.shift();
      }
    }
  }
}

/**
 * Update a decision's P&L result (called when a position is closed).
 */
export function updateDecisionPnl(
  agentId: string,
  roundId: string,
  pnl: number,
): void {
  const decision = decisionLog.find(
    (d) => d.agentId === agentId && d.roundId === roundId,
  );
  if (decision) {
    decision.pnlResult = pnl;
  }

  // Update consensus profitability
  const consensus = consensusCache.get(roundId);
  if (consensus && consensus.majorityProfitable === null) {
    const roundDecisions = decisionLog.filter((d) => d.roundId === roundId);
    const withPnl = roundDecisions.filter((d) => d.pnlResult !== undefined);
    if (withPnl.length >= 2) {
      const majorityPnl = withPnl
        .filter(
          (d) =>
            consensus.majorityAction &&
            d.action === consensus.majorityAction,
        )
        .reduce((sum, d) => sum + (d.pnlResult ?? 0), 0);
      consensus.majorityProfitable = majorityPnl > 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Analysis Functions
// ---------------------------------------------------------------------------

/**
 * Analyze consensus for a single round.
 */
function analyzeRoundConsensus(
  roundId: string,
  decisions: AgentDecisionRecord[],
): ConsensusMetrics {
  const nonHold = decisions.filter((d) => d.action !== "hold");

  if (nonHold.length === 0) {
    return {
      roundId,
      timestamp: decisions[0]?.timestamp ?? new Date().toISOString(),
      agreementLevel: "all_hold",
      majorityAction: null,
      majoritySymbol: null,
      majorityCount: 0,
      contrarian: null,
      majorityAvgConfidence: 0,
      majorityProfitable: null,
    };
  }

  // Count action+symbol combinations
  const combos = new Map<string, AgentDecisionRecord[]>();
  for (const d of nonHold) {
    const key = `${d.action}:${d.symbol}`;
    const list = combos.get(key) ?? [];
    list.push(d);
    combos.set(key, list);
  }

  // Find the most popular combo
  let majorityCombo = "";
  let majorityList: AgentDecisionRecord[] = [];
  for (const [key, list] of combos) {
    if (list.length > majorityList.length) {
      majorityCombo = key;
      majorityList = list;
    }
  }

  const [majAction, majSymbol] = majorityCombo.split(":");
  const majCount = majorityList.length;
  const totalActive = nonHold.length;

  let agreementLevel: ConsensusMetrics["agreementLevel"];
  if (majCount === totalActive && totalActive >= 2) {
    agreementLevel = "unanimous";
  } else if (majCount > 1) {
    agreementLevel = "majority";
  } else {
    agreementLevel = "split";
  }

  // Find contrarian
  let contrarian: ConsensusMetrics["contrarian"] = null;
  if (majCount >= 2 && nonHold.length === 3) {
    const outlier = nonHold.find(
      (d) => `${d.action}:${d.symbol}` !== majorityCombo,
    );
    if (outlier) {
      contrarian = { agentId: outlier.agentId, action: outlier.action };
    }
  }

  const majAvgConf =
    majorityList.length > 0
      ? majorityList.reduce((s, d) => s + d.confidence, 0) / majorityList.length
      : 0;

  return {
    roundId,
    timestamp: decisions[0]?.timestamp ?? new Date().toISOString(),
    agreementLevel,
    majorityAction: majAction ?? null,
    majoritySymbol: majSymbol ?? null,
    majorityCount: majCount,
    contrarian,
    majorityAvgConfidence: Math.round(majAvgConf * 10) / 10,
    majorityProfitable: null,
  };
}

/**
 * Detect herding behavior — all agents converging on the same trade.
 */
function detectHerding(
  roundId: string,
  decisions: AgentDecisionRecord[],
): HerdingAlert | null {
  const nonHold = decisions.filter((d) => d.action !== "hold");
  if (nonHold.length < 2) return null;

  // Check if all active agents are doing the same thing
  const firstAction = nonHold[0].action;
  const firstSymbol = nonHold[0].symbol;
  const allSame = nonHold.every(
    (d) => d.action === firstAction && d.symbol === firstSymbol,
  );

  if (!allSame) return null;

  // Determine severity based on count and confidence
  const avgConfidence =
    nonHold.reduce((s, d) => s + d.confidence, 0) / nonHold.length;
  let severity: HerdingAlert["severity"] = "low";
  if (nonHold.length === 3 && avgConfidence > 70) severity = "high";
  else if (nonHold.length >= 2 && avgConfidence > 60) severity = "medium";

  return {
    type: "herding",
    severity,
    roundId,
    symbol: firstSymbol,
    agents: nonHold.map((d) => ({
      agentId: d.agentId,
      action: d.action,
      confidence: d.confidence,
    })),
    message: `All ${nonHold.length} active agents are ${firstAction}ing ${firstSymbol} with avg confidence ${avgConfidence.toFixed(0)}%`,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Detect contrarian signals — one agent going against the majority.
 */
function detectContrarian(
  roundId: string,
  decisions: AgentDecisionRecord[],
): ContrarianSignal | null {
  const nonHold = decisions.filter((d) => d.action !== "hold");
  if (nonHold.length < 3) return null;

  // We need exactly 1 agent going opposite to 2 others
  const buys = nonHold.filter((d) => d.action === "buy");
  const sells = nonHold.filter((d) => d.action === "sell");

  let contrarianAgent: AgentDecisionRecord | null = null;
  let majorityAgents: AgentDecisionRecord[] = [];

  if (buys.length === 1 && sells.length >= 2) {
    contrarianAgent = buys[0];
    majorityAgents = sells;
  } else if (sells.length === 1 && buys.length >= 2) {
    contrarianAgent = sells[0];
    majorityAgents = buys;
  }

  if (!contrarianAgent) return null;

  // Calculate historical contrarian accuracy for this agent
  const pastContrarian = contrarianSignals.filter(
    (s) => s.contrarianAgent.agentId === contrarianAgent!.agentId,
  );
  const withOutcome = pastContrarian.filter(
    (s) => s.historicalAccuracy !== null,
  );
  const historicalAccuracy =
    withOutcome.length >= 3
      ? withOutcome.reduce((s, c) => s + (c.historicalAccuracy ?? 0), 0) /
        withOutcome.length
      : null;

  return {
    type: "contrarian",
    roundId,
    symbol: contrarianAgent.symbol,
    contrarianAgent: {
      agentId: contrarianAgent.agentId,
      action: contrarianAgent.action,
      confidence: contrarianAgent.confidence,
    },
    majorityAgents: majorityAgents.map((d) => ({
      agentId: d.agentId,
      action: d.action,
      confidence: d.confidence,
    })),
    historicalAccuracy,
    message: `${contrarianAgent.agentId} is ${contrarianAgent.action}ing ${contrarianAgent.symbol} while ${majorityAgents.length} others are ${majorityAgents[0].action}ing`,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Detect style drift for an agent — is their behavior matching their profile?
 */
function detectStyleDrift(agentId: string): StyleDriftAlert | null {
  const profile = AGENT_STYLE_PROFILES[agentId];
  if (!profile) return null;

  const agentDecisions = decisionLog.filter((d) => d.agentId === agentId);
  if (agentDecisions.length < 10) return null;

  // Take last 20 decisions
  const recent = agentDecisions.slice(-20);
  const evidence: string[] = [];
  let driftScore = 0;

  // Check hold rate
  const holdRate = countByCondition(recent, (d) => d.action === "hold") / recent.length;
  const [minHold, maxHold] = profile.expectedHoldRate;
  if (holdRate < minHold) {
    driftScore += 0.3;
    evidence.push(
      `Hold rate ${(holdRate * 100).toFixed(0)}% below expected ${(minHold * 100).toFixed(0)}%-${(maxHold * 100).toFixed(0)}%`,
    );
  } else if (holdRate > maxHold) {
    driftScore += 0.2;
    evidence.push(
      `Hold rate ${(holdRate * 100).toFixed(0)}% above expected ${(minHold * 100).toFixed(0)}%-${(maxHold * 100).toFixed(0)}%`,
    );
  }

  // Check average confidence
  const avgConf = recent.reduce((s, d) => s + d.confidence, 0) / recent.length;
  const [minConf, maxConf] = profile.expectedAvgConfidence;
  if (avgConf < minConf - 10 || avgConf > maxConf + 10) {
    driftScore += 0.2;
    evidence.push(
      `Avg confidence ${avgConf.toFixed(0)}% outside expected ${minConf}-${maxConf}%`,
    );
  }

  // Check risk behavior: aggressive agents should trade more, conservative less
  const tradeRate = countByCondition(recent, (d) => d.action !== "hold") / recent.length;
  if (
    profile.expectedTradeFrequency === "high" &&
    tradeRate < 0.5
  ) {
    driftScore += 0.3;
    evidence.push(
      `Trade rate ${(tradeRate * 100).toFixed(0)}% too low for ${profile.expectedTradeFrequency} frequency profile`,
    );
  } else if (
    profile.expectedTradeFrequency === "low" &&
    tradeRate > 0.7
  ) {
    driftScore += 0.3;
    evidence.push(
      `Trade rate ${(tradeRate * 100).toFixed(0)}% too high for ${profile.expectedTradeFrequency} frequency profile`,
    );
  }

  // Check for sudden behavior changes (last 5 vs previous 15)
  if (recent.length >= 15) {
    const last5 = recent.slice(-5);
    const prev = recent.slice(0, -5);
    const last5TradeRate =
      countByCondition(last5, (d) => d.action !== "hold") / last5.length;
    const prevTradeRate =
      countByCondition(prev, (d) => d.action !== "hold") / prev.length;
    if (Math.abs(last5TradeRate - prevTradeRate) > 0.4) {
      driftScore += 0.2;
      evidence.push(
        `Sudden trade rate shift: ${(prevTradeRate * 100).toFixed(0)}% → ${(last5TradeRate * 100).toFixed(0)}%`,
      );
    }
  }

  driftScore = Math.min(driftScore, 1.0);

  if (driftScore < 0.3) return null; // Not significant

  let detectedBehavior: string;
  if (tradeRate > 0.7) detectedBehavior = "aggressive (high trade frequency)";
  else if (tradeRate < 0.3) detectedBehavior = "conservative (mostly holding)";
  else detectedBehavior = "moderate (balanced trading)";

  return {
    type: "style_drift",
    agentId,
    agentName: profile.name,
    expectedStyle: `${profile.expectedRiskTolerance} / ${profile.expectedTradeFrequency} frequency`,
    detectedBehavior,
    driftScore,
    evidence,
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Correlation Analysis
// ---------------------------------------------------------------------------

/**
 * Compute pairwise correlations between all agents.
 */
export function computeCorrelationMatrix(): AgentCorrelation[] {
  const agentIds = [...new Set(decisionLog.map((d) => d.agentId))];
  const correlations: AgentCorrelation[] = [];

  for (let i = 0; i < agentIds.length; i++) {
    for (let j = i + 1; j < agentIds.length; j++) {
      const a1 = agentIds[i];
      const a2 = agentIds[j];

      // Find rounds where both agents participated
      const a1Rounds = new Map<string, AgentDecisionRecord>();
      const a2Rounds = new Map<string, AgentDecisionRecord>();

      for (const d of decisionLog) {
        if (d.agentId === a1) a1Rounds.set(d.roundId, d);
        if (d.agentId === a2) a2Rounds.set(d.roundId, d);
      }

      const commonRounds: string[] = [];
      for (const roundId of a1Rounds.keys()) {
        if (a2Rounds.has(roundId)) commonRounds.push(roundId);
      }

      if (commonRounds.length < 3) continue;

      // Convert actions to numeric signals: buy=1, hold=0, sell=-1
      const actionToNum = (action: string): number => {
        if (action === "buy") return 1;
        if (action === "sell") return -1;
        return 0;
      };

      const signals1 = commonRounds.map((r) =>
        actionToNum(a1Rounds.get(r)!.action),
      );
      const signals2 = commonRounds.map((r) =>
        actionToNum(a2Rounds.get(r)!.action),
      );

      // Pearson correlation
      const correlation = pearsonCorrelation(signals1, signals2);

      // Agreement/disagreement rates
      let agree = 0;
      let disagree = 0;
      for (let k = 0; k < commonRounds.length; k++) {
        const d1 = a1Rounds.get(commonRounds[k])!;
        const d2 = a2Rounds.get(commonRounds[k])!;
        if (d1.action === d2.action) agree++;
        if (
          (d1.action === "buy" && d2.action === "sell") ||
          (d1.action === "sell" && d2.action === "buy")
        ) {
          disagree++;
        }
      }

      correlations.push({
        agent1: a1,
        agent2: a2,
        signalCorrelation: round3(correlation),
        agreementRate: round3(agree / commonRounds.length),
        disagreementRate: round3(disagree / commonRounds.length),
        roundsAnalyzed: commonRounds.length,
      });
    }
  }

  return correlations;
}

/**
 * Generate a full cross-agent analysis report.
 */
export function generateReport(periodDays = 7): CrossAgentReport {
  const cutoff = Date.now() - periodDays * 24 * 60 * 60 * 1000;
  const cutoffStr = new Date(cutoff).toISOString();

  const recentDecisions = decisionLog.filter(
    (d) => d.timestamp >= cutoffStr,
  );
  const roundIds = [...new Set(recentDecisions.map((d) => d.roundId))];

  const recentHerding = herdingAlerts.filter(
    (a) => a.timestamp >= cutoffStr,
  );
  const recentContrarian = contrarianSignals.filter(
    (s) => s.timestamp >= cutoffStr,
  );
  const recentDrift = styleDriftAlerts.filter(
    (a) => a.timestamp >= cutoffStr,
  );

  const consensusHistory = roundIds
    .map((id) => consensusCache.get(id))
    .filter((c): c is ConsensusMetrics => c !== undefined);

  const correlations = computeCorrelationMatrix();

  // Compute stats
  const herdingFrequency =
    roundIds.length > 0
      ? (recentHerding.length / roundIds.length) * 100
      : 0;

  const contrarianWithOutcome = recentContrarian.filter(
    (c) => c.historicalAccuracy !== null,
  );
  const contrarianAccuracy =
    contrarianWithOutcome.length > 0
      ? (contrarianWithOutcome.reduce(
          (s, c) => s + (c.historicalAccuracy ?? 0),
          0,
        ) /
          contrarianWithOutcome.length) *
        100
      : 0;

  const unanimousRounds = consensusHistory.filter(
    (c) => c.agreementLevel === "unanimous",
  );
  const profitableUnanimous = unanimousRounds.filter(
    (c) => c.majorityProfitable === true,
  );
  const unanimousAccuracy =
    unanimousRounds.length > 0
      ? (profitableUnanimous.length / unanimousRounds.length) * 100
      : 0;

  // Average agreement level
  const levelToNum: Record<string, number> = {
    unanimous: 1,
    majority: 0.67,
    split: 0.33,
    all_hold: 0.5,
  };
  const avgAgreement =
    consensusHistory.length > 0
      ? consensusHistory.reduce(
          (s, c) => s + (levelToNum[c.agreementLevel] ?? 0),
          0,
        ) / consensusHistory.length
      : 0;

  // Most/least correlated pairs
  const sortedCorr = [...correlations].sort(
    (a, b) => Math.abs(b.signalCorrelation) - Math.abs(a.signalCorrelation),
  );
  const mostCorrelated = sortedCorr[0] ?? null;
  const leastCorrelated = sortedCorr[sortedCorr.length - 1] ?? null;

  // Generate insights
  const insights: string[] = [];
  if (herdingFrequency > 50) {
    insights.push(
      `High herding frequency (${herdingFrequency.toFixed(0)}%) — agents are converging on similar trades, reducing portfolio diversification benefit`,
    );
  }
  if (unanimousAccuracy > 70 && unanimousRounds.length >= 5) {
    insights.push(
      `Unanimous decisions are ${unanimousAccuracy.toFixed(0)}% accurate — when all agents agree, it's a strong signal`,
    );
  }
  if (
    mostCorrelated &&
    Math.abs(mostCorrelated.signalCorrelation) > 0.7
  ) {
    insights.push(
      `${mostCorrelated.agent1} and ${mostCorrelated.agent2} are highly correlated (${mostCorrelated.signalCorrelation.toFixed(2)}) — they're making similar decisions`,
    );
  }
  if (recentDrift.length > 0) {
    const driftAgents = [...new Set(recentDrift.map((d) => d.agentName))];
    insights.push(
      `Style drift detected in: ${driftAgents.join(", ")} — agents are deviating from their configured trading personalities`,
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    periodDays,
    totalRoundsAnalyzed: roundIds.length,
    herdingAlerts: recentHerding,
    contrarianSignals: recentContrarian,
    styleDriftAlerts: recentDrift,
    consensusHistory: consensusHistory.slice(-50),
    correlationMatrix: correlations,
    insights,
    stats: {
      herdingFrequency: Math.round(herdingFrequency * 10) / 10,
      contrarianAccuracy: Math.round(contrarianAccuracy * 10) / 10,
      unanimousAccuracy: Math.round(unanimousAccuracy * 10) / 10,
      avgAgreementLevel: round3(avgAgreement),
      mostCorrelatedPair: mostCorrelated
        ? {
            agents: [mostCorrelated.agent1, mostCorrelated.agent2],
            correlation: mostCorrelated.signalCorrelation,
          }
        : null,
      leastCorrelatedPair: leastCorrelated
        ? {
            agents: [leastCorrelated.agent1, leastCorrelated.agent2],
            correlation: leastCorrelated.signalCorrelation,
          }
        : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Status & Metrics
// ---------------------------------------------------------------------------

/**
 * Get current analysis status and metrics.
 */
export function getAnalyzerStatus(): {
  totalDecisionsTracked: number;
  totalRoundsTracked: number;
  herdingAlertCount: number;
  contrarianSignalCount: number;
  styleDriftAlertCount: number;
  recentConsensus: ConsensusMetrics[];
  correlationMatrix: AgentCorrelation[];
} {
  return {
    totalDecisionsTracked: decisionLog.length,
    totalRoundsTracked: consensusCache.size,
    herdingAlertCount: herdingAlerts.length,
    contrarianSignalCount: contrarianSignals.length,
    styleDriftAlertCount: styleDriftAlerts.length,
    recentConsensus: [...consensusCache.values()].slice(-10),
    correlationMatrix: computeCorrelationMatrix(),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 2) return 0;

  const meanX = x.reduce((s, v) => s + v, 0) / n;
  const meanY = y.reduce((s, v) => s + v, 0) / n;

  let numerator = 0;
  let denomX = 0;
  let denomY = 0;

  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }

  const denom = Math.sqrt(denomX * denomY);
  if (denom === 0) return 0;
  return numerator / denom;
}
