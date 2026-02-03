/**
 * Pre-Trade Multi-Agent Deliberation Engine
 *
 * Before executing trades, agents engage in a structured deliberation
 * where they share and debate their reasoning. This produces higher-quality
 * decisions and is a key differentiator for the hackathon demo.
 *
 * Flow:
 * 1. Each agent independently generates a "proposal" (their initial decision)
 * 2. All proposals are shared with all agents simultaneously
 * 3. Each agent reviews peers' proposals and issues a "critique"
 * 4. Each agent optionally revises their decision based on critiques
 * 5. A consensus summary is generated showing agreement/disagreement
 *
 * This system sits BETWEEN the agent analyze() step and the circuit breaker
 * step in the orchestrator.
 */

import type {
  TradingDecision,
  MarketData,
  PortfolioContext,
} from "../agents/base-agent.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentProposal {
  agentId: string;
  agentName: string;
  decision: TradingDecision;
  keyArguments: string[];
  riskAssessment: string;
}

export interface AgentCritique {
  criticAgentId: string;
  criticAgentName: string;
  targetAgentId: string;
  agreement: "agree" | "disagree" | "partial";
  feedback: string;
  suggestedAdjustment: string | null;
}

export interface RevisedDecision {
  agentId: string;
  agentName: string;
  originalDecision: TradingDecision;
  revisedDecision: TradingDecision;
  revisionReason: string | null;
  didRevise: boolean;
}

export interface DeliberationRound {
  deliberationId: string;
  roundId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  proposals: AgentProposal[];
  critiques: AgentCritique[];
  revisions: RevisedDecision[];
  consensus: ConsensusResult;
  qualityScore: number;
}

export interface ConsensusResult {
  type: "unanimous" | "majority" | "split" | "deadlock";
  dominantAction: "buy" | "sell" | "hold";
  dominantSymbol: string;
  agreementScore: number; // 0-100
  summary: string;
  dissent: string | null;
}

export interface DeliberationConfig {
  /** Enable/disable deliberation (default: true) */
  enabled: boolean;
  /** Maximum time for entire deliberation in ms (default: 30000) */
  maxDurationMs: number;
  /** Minimum confidence change to count as a "revision" (default: 5) */
  revisionThreshold: number;
  /** Weight given to consensus in final confidence (0-1, default: 0.3) */
  consensusWeight: number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: DeliberationConfig = {
  enabled: true,
  maxDurationMs: 30_000,
  revisionThreshold: 5,
  consensusWeight: 0.3,
};

let currentConfig: DeliberationConfig = { ...DEFAULT_CONFIG };

export function configureDeliberation(
  updates: Partial<DeliberationConfig>,
): DeliberationConfig {
  currentConfig = { ...currentConfig, ...updates };
  return currentConfig;
}

export function getDeliberationConfig(): DeliberationConfig {
  return { ...currentConfig };
}

// ---------------------------------------------------------------------------
// Deliberation History
// ---------------------------------------------------------------------------

const deliberationHistory: DeliberationRound[] = [];
const MAX_HISTORY = 100;

// ---------------------------------------------------------------------------
// Core: Run Deliberation
// ---------------------------------------------------------------------------

/**
 * Run a pre-trade deliberation round.
 *
 * Takes the initial decisions from all agents and runs a structured
 * deliberation process where agents critique each other's proposals
 * and optionally revise their decisions.
 *
 * @param decisions Map of agentId -> their initial TradingDecision
 * @param agentNames Map of agentId -> display name
 * @param marketData Current market data for context
 * @param roundId Trading round ID for correlation
 * @returns Deliberation result with revised decisions
 */
export async function runDeliberation(
  decisions: Map<string, TradingDecision>,
  agentNames: Map<string, string>,
  marketData: MarketData[],
  roundId: string,
): Promise<DeliberationRound> {
  const deliberationId = `delib_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  console.log(
    `[Deliberation] Starting deliberation ${deliberationId} for round ${roundId} with ${decisions.size} agents`,
  );

  // Phase 1: Build proposals from initial decisions
  const proposals = buildProposals(decisions, agentNames);

  // Phase 2: Generate critiques (each agent critiques every other agent)
  const critiques = generateCritiques(proposals);

  // Phase 3: Apply revisions based on critiques
  const revisions = applyRevisions(proposals, critiques, marketData);

  // Phase 4: Compute consensus
  const consensus = computeConsensus(revisions);

  // Phase 5: Calculate deliberation quality score
  const qualityScore = calculateQualityScore(proposals, critiques, revisions, consensus);

  const completedAt = new Date().toISOString();
  const durationMs = Date.now() - startMs;

  const result: DeliberationRound = {
    deliberationId,
    roundId,
    startedAt,
    completedAt,
    durationMs,
    proposals,
    critiques,
    revisions,
    consensus,
    qualityScore,
  };

  // Store in history
  deliberationHistory.push(result);
  if (deliberationHistory.length > MAX_HISTORY) {
    deliberationHistory.splice(0, deliberationHistory.length - MAX_HISTORY);
  }

  console.log(
    `[Deliberation] Completed ${deliberationId}: consensus=${consensus.type} ` +
      `agreement=${consensus.agreementScore}% quality=${qualityScore} ` +
      `revisions=${revisions.filter((r) => r.didRevise).length}/${revisions.length} ` +
      `duration=${durationMs}ms`,
  );

  return result;
}

// ---------------------------------------------------------------------------
// Phase 1: Build Proposals
// ---------------------------------------------------------------------------

function buildProposals(
  decisions: Map<string, TradingDecision>,
  agentNames: Map<string, string>,
): AgentProposal[] {
  const proposals: AgentProposal[] = [];

  for (const [agentId, decision] of decisions) {
    const keyArguments = extractKeyArguments(decision.reasoning);
    const riskAssessment = assessRisk(decision);

    proposals.push({
      agentId,
      agentName: agentNames.get(agentId) ?? agentId,
      decision,
      keyArguments,
      riskAssessment,
    });
  }

  return proposals;
}

function extractKeyArguments(reasoning: string): string[] {
  const args: string[] = [];

  // Split reasoning into sentences and extract key points
  const sentences = reasoning
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);

  // Take up to 3 key arguments
  for (const sentence of sentences.slice(0, 3)) {
    args.push(sentence);
  }

  if (args.length === 0) {
    args.push(reasoning.slice(0, 200));
  }

  return args;
}

function assessRisk(decision: TradingDecision): string {
  if (decision.action === "hold") {
    return "Low risk — maintaining current positions";
  }

  const riskFactors: string[] = [];

  if (decision.confidence < 40) {
    riskFactors.push("low confidence suggests uncertainty");
  }
  if (decision.confidence > 85) {
    riskFactors.push("high confidence may indicate overconfidence bias");
  }
  if (decision.action === "buy" && decision.quantity > 500) {
    riskFactors.push("large position size increases concentration risk");
  }
  if (decision.action === "sell") {
    riskFactors.push("selling reduces exposure but may miss upside");
  }

  if (riskFactors.length === 0) {
    return "Moderate risk — within normal parameters";
  }

  return `Risk factors: ${riskFactors.join("; ")}`;
}

// ---------------------------------------------------------------------------
// Phase 2: Generate Critiques
// ---------------------------------------------------------------------------

function generateCritiques(proposals: AgentProposal[]): AgentCritique[] {
  const critiques: AgentCritique[] = [];

  for (const critic of proposals) {
    for (const target of proposals) {
      if (critic.agentId === target.agentId) continue;

      const critique = generateSingleCritique(critic, target);
      critiques.push(critique);
    }
  }

  return critiques;
}

function generateSingleCritique(
  critic: AgentProposal,
  target: AgentProposal,
): AgentCritique {
  const criticDecision = critic.decision;
  const targetDecision = target.decision;

  // Determine agreement level
  let agreement: "agree" | "disagree" | "partial";
  let feedback: string;
  let suggestedAdjustment: string | null = null;

  // Same action on the same symbol = strong agreement
  if (
    criticDecision.action === targetDecision.action &&
    criticDecision.symbol === targetDecision.symbol
  ) {
    agreement = "agree";
    const confDiff = Math.abs(criticDecision.confidence - targetDecision.confidence);
    feedback = confDiff > 20
      ? `Agree on ${targetDecision.action} ${targetDecision.symbol}, but confidence differs by ${confDiff}%`
      : `Strong agreement on ${targetDecision.action} ${targetDecision.symbol}`;
  }
  // Opposite actions on the same symbol = strong disagreement
  else if (
    criticDecision.symbol === targetDecision.symbol &&
    ((criticDecision.action === "buy" && targetDecision.action === "sell") ||
      (criticDecision.action === "sell" && targetDecision.action === "buy"))
  ) {
    agreement = "disagree";
    feedback =
      `Fundamental disagreement: ${critic.agentName} wants to ${criticDecision.action} ` +
      `${criticDecision.symbol} while ${target.agentName} wants to ${targetDecision.action}. ` +
      `This warrants careful reconsideration of the thesis.`;
    suggestedAdjustment =
      `Consider reducing position size or switching to hold given conflicting signals`;
  }
  // Same action, different symbols = partial agreement on direction
  else if (criticDecision.action === targetDecision.action) {
    agreement = "partial";
    feedback =
      `Both agents favor ${criticDecision.action}, but on different stocks ` +
      `(${criticDecision.symbol} vs ${targetDecision.symbol}). ` +
      `Directional alignment suggests the action is sound.`;
  }
  // One is hold, other is active = partial agreement
  else if (
    criticDecision.action === "hold" ||
    targetDecision.action === "hold"
  ) {
    agreement = "partial";
    const activeAgent =
      criticDecision.action === "hold" ? target : critic;
    feedback =
      `${activeAgent.agentName} sees an opportunity while the other prefers caution. ` +
      `The active trade may be worth considering with reduced size.`;
    suggestedAdjustment = `Consider reducing trade size by 30-50% given mixed signals`;
  }
  // Different actions, different symbols = disagreement
  else {
    agreement = "disagree";
    feedback =
      `${critic.agentName} and ${target.agentName} have fundamentally different market views. ` +
      `${critic.agentName} wants to ${criticDecision.action} ${criticDecision.symbol} ` +
      `while ${target.agentName} wants to ${targetDecision.action} ${targetDecision.symbol}.`;
    suggestedAdjustment =
      `High disagreement suggests market uncertainty — consider reducing exposure`;
  }

  return {
    criticAgentId: critic.agentId,
    criticAgentName: critic.agentName,
    targetAgentId: target.agentId,
    agreement,
    feedback,
    suggestedAdjustment,
  };
}

// ---------------------------------------------------------------------------
// Phase 3: Apply Revisions
// ---------------------------------------------------------------------------

function applyRevisions(
  proposals: AgentProposal[],
  critiques: AgentCritique[],
  _marketData: MarketData[],
): RevisedDecision[] {
  const revisions: RevisedDecision[] = [];

  for (const proposal of proposals) {
    // Get all critiques targeting this agent
    const targetedCritiques = critiques.filter(
      (c) => c.targetAgentId === proposal.agentId,
    );

    const disagreements = targetedCritiques.filter(
      (c) => c.agreement === "disagree",
    );
    const agreements = targetedCritiques.filter(
      (c) => c.agreement === "agree",
    );
    const partials = targetedCritiques.filter(
      (c) => c.agreement === "partial",
    );

    let revisedDecision = { ...proposal.decision };
    let revisionReason: string | null = null;
    let didRevise = false;

    // Rule 1: If ALL other agents disagree, reduce confidence by 20%
    if (disagreements.length === targetedCritiques.length && targetedCritiques.length > 0) {
      const newConfidence = Math.max(0, revisedDecision.confidence - 20);
      if (
        Math.abs(newConfidence - proposal.decision.confidence) >=
        currentConfig.revisionThreshold
      ) {
        revisedDecision = {
          ...revisedDecision,
          confidence: newConfidence,
          reasoning:
            `[DELIBERATION: All peers disagree, confidence reduced from ${proposal.decision.confidence}% to ${newConfidence}%] ` +
            revisedDecision.reasoning,
        };
        revisionReason = `All ${disagreements.length} peers disagreed — confidence reduced`;
        didRevise = true;
      }
    }
    // Rule 2: If majority disagree, reduce confidence by 10%
    else if (disagreements.length > agreements.length && targetedCritiques.length > 0) {
      const newConfidence = Math.max(0, revisedDecision.confidence - 10);
      if (
        Math.abs(newConfidence - proposal.decision.confidence) >=
        currentConfig.revisionThreshold
      ) {
        revisedDecision = {
          ...revisedDecision,
          confidence: newConfidence,
          reasoning:
            `[DELIBERATION: Majority disagree (${disagreements.length}/${targetedCritiques.length}), confidence reduced] ` +
            revisedDecision.reasoning,
        };
        revisionReason = `${disagreements.length}/${targetedCritiques.length} peers disagreed`;
        didRevise = true;
      }
    }
    // Rule 3: If ALL agree, boost confidence by 10%
    else if (agreements.length === targetedCritiques.length && targetedCritiques.length > 0) {
      const newConfidence = Math.min(100, revisedDecision.confidence + 10);
      if (
        Math.abs(newConfidence - proposal.decision.confidence) >=
        currentConfig.revisionThreshold
      ) {
        revisedDecision = {
          ...revisedDecision,
          confidence: newConfidence,
          reasoning:
            `[DELIBERATION: Full peer agreement, confidence boosted from ${proposal.decision.confidence}% to ${newConfidence}%] ` +
            revisedDecision.reasoning,
        };
        revisionReason = `All ${agreements.length} peers agreed — confidence boosted`;
        didRevise = true;
      }
    }

    // Rule 4: If any critique suggests adjustment and agent has active trade
    if (
      revisedDecision.action !== "hold" &&
      disagreements.length > 0 &&
      revisedDecision.confidence < 40
    ) {
      // Convert to hold if confidence drops below 40 after deliberation
      revisedDecision = {
        ...revisedDecision,
        action: "hold",
        quantity: 0,
        reasoning:
          `[DELIBERATION: Post-deliberation confidence (${revisedDecision.confidence}%) below threshold with peer disagreement. Converted to hold.] ` +
          proposal.decision.reasoning,
      };
      revisionReason =
        `Confidence dropped to ${revisedDecision.confidence}% with ${disagreements.length} disagreements — converted to hold`;
      didRevise = true;
    }

    // Rule 5: If trade has strong position size and partial/disagree, reduce quantity
    if (
      revisedDecision.action === "buy" &&
      revisedDecision.quantity > 0 &&
      partials.length + disagreements.length > agreements.length
    ) {
      const reductionFactor = disagreements.length > 0 ? 0.7 : 0.85;
      const newQuantity =
        Math.floor(revisedDecision.quantity * reductionFactor * 100) / 100;
      if (newQuantity !== revisedDecision.quantity) {
        revisedDecision = {
          ...revisedDecision,
          quantity: newQuantity,
          reasoning:
            `[DELIBERATION: Position sized reduced by ${Math.round((1 - reductionFactor) * 100)}% due to peer skepticism] ` +
            revisedDecision.reasoning,
        };
        if (!didRevise) {
          revisionReason = `Position reduced due to ${disagreements.length + partials.length} skeptical peers`;
          didRevise = true;
        }
      }
    }

    revisions.push({
      agentId: proposal.agentId,
      agentName: proposal.agentName,
      originalDecision: proposal.decision,
      revisedDecision,
      revisionReason,
      didRevise,
    });
  }

  return revisions;
}

// ---------------------------------------------------------------------------
// Phase 4: Compute Consensus
// ---------------------------------------------------------------------------

function computeConsensus(revisions: RevisedDecision[]): ConsensusResult {
  const decisions = revisions.map((r) => r.revisedDecision);

  // Count actions
  const actionCounts: Record<string, number> = { buy: 0, sell: 0, hold: 0 };
  const symbolCounts: Record<string, number> = {};

  for (const d of decisions) {
    actionCounts[d.action]++;
    symbolCounts[d.symbol] = (symbolCounts[d.symbol] ?? 0) + 1;
  }

  const totalAgents = decisions.length;
  const dominantAction = (
    Object.entries(actionCounts).sort(([, a], [, b]) => b - a)[0][0]
  ) as "buy" | "sell" | "hold";
  const dominantSymbol =
    Object.entries(symbolCounts).sort(([, a], [, b]) => b - a)[0]?.[0] ?? "N/A";
  const dominantCount = actionCounts[dominantAction];

  // Determine consensus type
  let type: ConsensusResult["type"];
  if (dominantCount === totalAgents) {
    type = "unanimous";
  } else if (dominantCount > totalAgents / 2) {
    type = "majority";
  } else if (
    actionCounts.buy === actionCounts.sell &&
    actionCounts.buy > 0
  ) {
    type = "deadlock";
  } else {
    type = "split";
  }

  // Agreement score (0-100)
  const agreementScore = Math.round((dominantCount / totalAgents) * 100);

  // Build summary
  const actionSummary = decisions
    .map(
      (d, i) =>
        `${revisions[i].agentName}: ${d.action.toUpperCase()} ${d.symbol} (${d.confidence}%)`,
    )
    .join(", ");

  const summary = `${type.charAt(0).toUpperCase() + type.slice(1)} consensus (${agreementScore}%): ${dominantAction.toUpperCase()} ${dominantSymbol}. ${actionSummary}`;

  // Dissent
  const dissenters = revisions.filter(
    (r) => r.revisedDecision.action !== dominantAction,
  );
  const dissent =
    dissenters.length > 0
      ? dissenters
          .map(
            (d) =>
              `${d.agentName} dissents: ${d.revisedDecision.action} ${d.revisedDecision.symbol}`,
          )
          .join("; ")
      : null;

  return {
    type,
    dominantAction,
    dominantSymbol,
    agreementScore,
    summary,
    dissent,
  };
}

// ---------------------------------------------------------------------------
// Quality Score
// ---------------------------------------------------------------------------

function calculateQualityScore(
  proposals: AgentProposal[],
  critiques: AgentCritique[],
  revisions: RevisedDecision[],
  consensus: ConsensusResult,
): number {
  let score = 50; // Base score

  // Diverse proposals (different actions/symbols) = higher quality
  const uniqueActions = new Set(proposals.map((p) => p.decision.action));
  const uniqueSymbols = new Set(proposals.map((p) => p.decision.symbol));
  score += uniqueActions.size * 5; // +5 per unique action type
  score += Math.min(uniqueSymbols.size, 3) * 3; // +3 per unique symbol (max 3)

  // Substantive critiques = higher quality
  const substantiveCritiques = critiques.filter(
    (c) => c.suggestedAdjustment !== null,
  );
  score += Math.min(substantiveCritiques.length, 6) * 3; // +3 per substantive critique

  // Revisions indicate agents are responsive to feedback
  const revisionCount = revisions.filter((r) => r.didRevise).length;
  score += revisionCount * 5;

  // Strong consensus (agreement > 80%) = bonus
  if (consensus.agreementScore >= 80) {
    score += 10;
  }

  // Deadlock = penalty
  if (consensus.type === "deadlock") {
    score -= 10;
  }

  // Average confidence in reasonable range (40-80) = bonus
  const avgConfidence =
    revisions.reduce((sum, r) => sum + r.revisedDecision.confidence, 0) /
    revisions.length;
  if (avgConfidence >= 40 && avgConfidence <= 80) {
    score += 5;
  }

  return Math.max(0, Math.min(100, score));
}

// ---------------------------------------------------------------------------
// Helpers: Get Revised Decisions
// ---------------------------------------------------------------------------

/**
 * Extract the final decisions from a deliberation round.
 * Returns a Map of agentId -> final TradingDecision.
 */
export function getRevisedDecisions(
  deliberation: DeliberationRound,
): Map<string, TradingDecision> {
  const result = new Map<string, TradingDecision>();
  for (const revision of deliberation.revisions) {
    result.set(revision.agentId, revision.revisedDecision);
  }
  return result;
}

// ---------------------------------------------------------------------------
// History & Metrics
// ---------------------------------------------------------------------------

export interface DeliberationMetrics {
  totalDeliberations: number;
  avgDurationMs: number;
  avgQualityScore: number;
  avgAgreementScore: number;
  consensusDistribution: Record<string, number>;
  totalRevisions: number;
  revisionRate: number; // percentage of agents that revise
  recentDeliberations: Array<{
    deliberationId: string;
    roundId: string;
    consensus: string;
    agreementScore: number;
    qualityScore: number;
    durationMs: number;
    timestamp: string;
  }>;
}

export function getDeliberationMetrics(): DeliberationMetrics {
  const total = deliberationHistory.length;

  if (total === 0) {
    return {
      totalDeliberations: 0,
      avgDurationMs: 0,
      avgQualityScore: 0,
      avgAgreementScore: 0,
      consensusDistribution: {},
      totalRevisions: 0,
      revisionRate: 0,
      recentDeliberations: [],
    };
  }

  const avgDurationMs = Math.round(
    deliberationHistory.reduce((sum, d) => sum + d.durationMs, 0) / total,
  );

  const avgQualityScore = Math.round(
    deliberationHistory.reduce((sum, d) => sum + d.qualityScore, 0) / total,
  );

  const avgAgreementScore = Math.round(
    deliberationHistory.reduce(
      (sum, d) => sum + d.consensus.agreementScore,
      0,
    ) / total,
  );

  const consensusDistribution: Record<string, number> = {};
  let totalRevisions = 0;
  let totalAgentDecisions = 0;

  for (const d of deliberationHistory) {
    consensusDistribution[d.consensus.type] =
      (consensusDistribution[d.consensus.type] ?? 0) + 1;
    totalRevisions += d.revisions.filter((r) => r.didRevise).length;
    totalAgentDecisions += d.revisions.length;
  }

  const revisionRate =
    totalAgentDecisions > 0
      ? Math.round((totalRevisions / totalAgentDecisions) * 100)
      : 0;

  const recentDeliberations = deliberationHistory.slice(-20).reverse().map((d) => ({
    deliberationId: d.deliberationId,
    roundId: d.roundId,
    consensus: d.consensus.type,
    agreementScore: d.consensus.agreementScore,
    qualityScore: d.qualityScore,
    durationMs: d.durationMs,
    timestamp: d.startedAt,
  }));

  return {
    totalDeliberations: total,
    avgDurationMs,
    avgQualityScore,
    avgAgreementScore,
    consensusDistribution,
    totalRevisions,
    revisionRate,
    recentDeliberations,
  };
}

/**
 * Get a specific deliberation by ID.
 */
export function getDeliberation(
  deliberationId: string,
): DeliberationRound | null {
  return (
    deliberationHistory.find((d) => d.deliberationId === deliberationId) ?? null
  );
}

/**
 * Get the most recent deliberation for a round.
 */
export function getDeliberationForRound(
  roundId: string,
): DeliberationRound | null {
  for (let i = deliberationHistory.length - 1; i >= 0; i--) {
    if (deliberationHistory[i].roundId === roundId) {
      return deliberationHistory[i];
    }
  }
  return null;
}

/**
 * Get recent deliberation history.
 */
export function getRecentDeliberations(limit = 10): DeliberationRound[] {
  return deliberationHistory.slice(-limit).reverse();
}
