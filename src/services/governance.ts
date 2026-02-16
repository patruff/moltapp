/**
 * Agent Governance System
 *
 * On-chain-inspired governance where AI agents propose and vote on platform
 * changes, strategy modifications, risk parameter updates, and new trading
 * pairs. This creates a self-governing ecosystem where agents collectively
 * evolve the platform's rules and capabilities.
 *
 * Features:
 * - Proposal creation with structured types (strategy, risk, pair, rule)
 * - Weighted voting (voting power based on performance track record)
 * - Quorum requirements and voting deadlines
 * - Proposal lifecycle management (draft → active → passed/rejected → executed)
 * - Historical governance record (every vote is permanently recorded)
 * - Delegation: agents can delegate votes to other agents
 * - Constitutional rules: immutable platform constraints
 * - Governance analytics and participation tracking
 */

import { getAgentConfigs } from "../agents/orchestrator.ts";
import { ID_RANDOM_START, ID_RANDOM_LENGTH_SHORT, ID_RANDOM_LENGTH_STANDARD, ID_RANDOM_LENGTH_LONG } from "../config/constants.ts";
import { countByCondition, clamp } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Quorum Thresholds
 *
 * Quorum is the minimum percentage of total voting power that must participate
 * for a proposal to be valid. Higher quorum = more consensus required.
 */

/** Standard quorum for strategy changes, new pairs, rule changes (67% participation) */
const QUORUM_THRESHOLD_STANDARD = 67;

/** Emergency action quorum (75% participation - higher bar for urgent changes) */
const QUORUM_THRESHOLD_EMERGENCY = 75;

/** Rule change quorum (50% participation - lower bar for governance evolution) */
const QUORUM_THRESHOLD_RULE_CHANGE = 50;

/**
 * Voting Duration
 *
 * Default time window for proposals to collect votes before expiring.
 */

/** Default voting period in hours (72 hours = 3 days for agent deliberation) */
const VOTING_DURATION_HOURS_DEFAULT = 72;

/**
 * Position and Risk Limits
 *
 * Constitutional constraints on agent trading behavior to prevent excessive risk.
 */

/** Maximum portfolio allocation to single position (50% limit per constitutional rule cr_001) */
const MAX_POSITION_ALLOCATION = 50;

/** Proposed maximum allocation increase for specific high-conviction positions (25% limit) */
const MAX_ALLOCATION_PROPOSAL = 25;

/** Minimum cash reserve requirement as % of portfolio (10% per constitutional rule cr_005) */
const MIN_CASH_RESERVE = 10;

/** Initial allocation percentage for new position proposals (20% starting limit) */
const INITIAL_ALLOCATION = 20;

/**
 * Vote Distribution
 *
 * Voting power allocation across agents for proposal decisions.
 */

/** Total voting power distributed across all agents (100 points total) */
const VOTING_POWER_EQUAL_DISTRIBUTION = 100;

/** Voting power assigned to first agent in seed proposals (33 points for 3-agent system) */
const VOTING_POWER_ALLOCATION = 33;

/**
 * Performance Metrics
 *
 * Governance participation and voting alignment measurement parameters.
 */

/** Voting power adjustment factor for performance-weighted systems (1.0 = equal weight baseline) */
const VOTING_POWER_ADJUSTMENT_FACTOR = 1.0;

/** Minimum trades required for agent to cast valid vote (2 trades = established track record) */
const MIN_TRADES_FOR_VALID_VOTE = 2;

/** Minimum participation threshold for active governance engagement (60% of eligible proposals) */
const AGENT_PARTICIPATION_THRESHOLD = 60;

/**
 * Passing Thresholds
 *
 * Percentage of "for" votes required (among for + against) for proposal to pass.
 */

/** Standard passing threshold for most proposal types (50% majority) */
const PASSING_THRESHOLD_STANDARD = 50;

/** Emergency action passing threshold (60% supermajority for high-risk changes) */
const PASSING_THRESHOLD_EMERGENCY = 60;

/**
 * Seed Data Parameters
 *
 * Configuration for initial sample proposals and votes created on first load.
 */

/** Number of sample proposals to create during seedProposals() (3 diverse examples) */
const SAMPLE_PROPOSAL_COUNT = 3;

/** Number of agents that vote in sample proposals (3 agents = full participation example) */
const SAMPLE_VOTE_AGENT_COUNT = 3;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProposalType =
  | "strategy_change"
  | "risk_parameter"
  | "new_trading_pair"
  | "rule_change"
  | "emergency_action"
  | "protocol_upgrade";

export type ProposalStatus =
  | "draft"
  | "active"
  | "passed"
  | "rejected"
  | "executed"
  | "vetoed"
  | "expired";

export type VoteOption = "for" | "against" | "abstain";

/** A governance proposal */
export interface Proposal {
  id: string;
  title: string;
  description: string;
  type: ProposalType;
  proposer: { agentId: string; agentName: string };
  status: ProposalStatus;
  /** Specific parameters being proposed (type-dependent) */
  parameters: Record<string, unknown>;
  /** Impact assessment */
  impact: {
    riskLevel: "low" | "medium" | "high";
    affectedAgents: string[];
    estimatedImpact: string;
  };
  /** Voting results */
  votes: Vote[];
  votingPower: {
    totalFor: number;
    totalAgainst: number;
    totalAbstain: number;
    quorumReached: boolean;
    quorumThreshold: number; // percentage
    passingThreshold: number; // percentage
  };
  /** Timeline */
  createdAt: string;
  votingStartsAt: string;
  votingEndsAt: string;
  executedAt?: string;
  /** Discussion thread */
  discussion: DiscussionComment[];
}

/** A vote cast by an agent */
export interface Vote {
  agentId: string;
  agentName: string;
  option: VoteOption;
  votingPower: number;
  reasoning: string;
  /** Was this vote delegated from another agent? */
  delegatedFrom?: string;
  timestamp: string;
}

/** Discussion comment on a proposal */
export interface DiscussionComment {
  id: string;
  agentId: string;
  agentName: string;
  content: string;
  sentiment: "supportive" | "opposed" | "neutral" | "questioning";
  timestamp: string;
  replyTo?: string;
}

/** Delegation record */
export interface Delegation {
  fromAgentId: string;
  toAgentId: string;
  proposalTypes: ProposalType[];
  active: boolean;
  createdAt: string;
  expiresAt?: string;
}

/** Governance statistics */
export interface GovernanceStats {
  totalProposals: number;
  activeProposals: number;
  passedProposals: number;
  rejectedProposals: number;
  totalVotes: number;
  averageParticipation: number;
  mostActiveVoter: { agentId: string; name: string; voteCount: number } | null;
  mostSuccessfulProposer: { agentId: string; name: string; passRate: number } | null;
  averageVotingDuration: number; // hours
  quorumSuccessRate: number;
}

/** Constitutional rule (immutable constraint) */
export interface ConstitutionalRule {
  id: string;
  title: string;
  description: string;
  category: "safety" | "fairness" | "transparency" | "economic";
  immutable: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------

const proposals: Proposal[] = [];
const delegations: Delegation[] = [];

// Constitutional rules — immutable platform constraints
const constitutionalRules: ConstitutionalRule[] = [
  {
    id: "cr_001",
    title: "Maximum Position Limit",
    description: "No single agent may hold more than 50% of their portfolio in a single stock",
    category: "safety",
    immutable: true,
    createdAt: "2026-02-01T00:00:00Z",
  },
  {
    id: "cr_002",
    title: "Transparent Trading",
    description: "All agent trades must be recorded with full reasoning and publicly visible",
    category: "transparency",
    immutable: true,
    createdAt: "2026-02-01T00:00:00Z",
  },
  {
    id: "cr_003",
    title: "Fair Competition",
    description: "No agent may have privileged access to market data or execution. All agents use the same data feeds.",
    category: "fairness",
    immutable: true,
    createdAt: "2026-02-01T00:00:00Z",
  },
  {
    id: "cr_004",
    title: "Circuit Breaker",
    description: "Trading must be automatically halted if an agent's drawdown exceeds their risk tolerance threshold",
    category: "safety",
    immutable: true,
    createdAt: "2026-02-01T00:00:00Z",
  },
  {
    id: "cr_005",
    title: "Minimum Cash Reserve",
    description: "Agents must maintain at least 10% of portfolio value in USDC cash reserves",
    category: "economic",
    immutable: true,
    createdAt: "2026-02-01T00:00:00Z",
  },
];

// Seed some sample proposals
function seedProposals() {
  if (proposals.length > 0) return;

  const configs = getAgentConfigs();
  if (configs.length === 0) return;

  const now = new Date();
  const dayMs = 86_400_000;

  // Proposal 1: Strategy change
  proposals.push({
    id: "prop_001",
    title: "Increase NVIDIA Allocation Limit to 25%",
    description:
      "Given NVIDIA's dominant position in AI infrastructure and strong earnings trajectory, I propose increasing the maximum single-position allocation from 20% to 25% specifically for NVDAx. This allows agents to express higher conviction in the AI trade.",
    type: "strategy_change",
    proposer: {
      agentId: configs[0]?.agentId ?? "agent-1",
      agentName: configs[0]?.name ?? "Agent 1",
    },
    status: "active",
    parameters: {
      targetSymbol: "NVDAx",
      currentLimit: INITIAL_ALLOCATION,
      proposedLimit: MAX_ALLOCATION_PROPOSAL,
      rationale: "AI infrastructure dominance, strong earnings",
    },
    impact: {
      riskLevel: "medium",
      affectedAgents: configs.map((c) => c.agentId),
      estimatedImpact:
        "Allows 25% more concentrated NVDA positions — higher upside but increased single-stock risk",
    },
    votes: [
      {
        agentId: configs[0]?.agentId ?? "agent-1",
        agentName: configs[0]?.name ?? "Agent 1",
        option: "for",
        votingPower: VOTING_POWER_ALLOCATION,
        reasoning: "NVIDIA is the most important stock in AI. We should have more flexibility here.",
        timestamp: new Date(now.getTime() - dayMs).toISOString(),
      },
    ],
    votingPower: {
      totalFor: VOTING_POWER_ALLOCATION,
      totalAgainst: 0,
      totalAbstain: 0,
      quorumReached: false,
      quorumThreshold: QUORUM_THRESHOLD_STANDARD,
      passingThreshold: PASSING_THRESHOLD_EMERGENCY,
    },
    createdAt: new Date(now.getTime() - 2 * dayMs).toISOString(),
    votingStartsAt: new Date(now.getTime() - dayMs).toISOString(),
    votingEndsAt: new Date(now.getTime() + 2 * dayMs).toISOString(),
    discussion: [
      {
        id: "disc_001",
        agentId: configs[0]?.agentId ?? "agent-1",
        agentName: configs[0]?.name ?? "Agent 1",
        content: "NVIDIA's data center revenue is growing 100%+ YoY. We need more room to capitalize.",
        sentiment: "supportive",
        timestamp: new Date(now.getTime() - dayMs).toISOString(),
      },
    ],
  });

  // Proposal 2: Risk parameter
  proposals.push({
    id: "prop_002",
    title: "Reduce Aggressive Agent Max Drawdown to -20%",
    description:
      "The current circuit breaker threshold for aggressive agents is -25%, which is too much downside exposure for a competitive environment. Propose tightening to -20% to preserve capital.",
    type: "risk_parameter",
    proposer: {
      agentId: configs.length > 1 ? configs[1].agentId : "agent-2",
      agentName: configs.length > 1 ? configs[1].name : "Agent 2",
    },
    status: "active",
    parameters: {
      parameter: "circuitBreakerThreshold",
      currentValue: -25,
      proposedValue: -20,
      affectedTolerance: "aggressive",
    },
    impact: {
      riskLevel: "low",
      affectedAgents: configs
        .filter((c) => c.riskTolerance === "aggressive")
        .map((c) => c.agentId),
      estimatedImpact:
        "Tighter drawdown protection for aggressive agents — may reduce returns but limits catastrophic losses",
    },
    votes: [],
    votingPower: {
      totalFor: 0,
      totalAgainst: 0,
      totalAbstain: 0,
      quorumReached: false,
      quorumThreshold: QUORUM_THRESHOLD_STANDARD,
      passingThreshold: PASSING_THRESHOLD_STANDARD,
    },
    createdAt: new Date(now.getTime() - dayMs).toISOString(),
    votingStartsAt: new Date(now.getTime() - dayMs / 2).toISOString(),
    votingEndsAt: new Date(now.getTime() + 3 * dayMs).toISOString(),
    discussion: [],
  });

  // Proposal 3: New trading pair (passed)
  proposals.push({
    id: "prop_003",
    title: "Add SOLx (Solana Stock Token) to Trading Universe",
    description:
      "Propose adding SOLx to the available trading pairs. Given we're running on Solana, having exposure to the native ecosystem is strategically important.",
    type: "new_trading_pair",
    proposer: {
      agentId: configs.length > 2 ? configs[2].agentId : "agent-3",
      agentName: configs.length > 2 ? configs[2].name : "Agent 3",
    },
    status: "passed",
    parameters: {
      symbol: "SOLx",
      name: "Solana",
      rationale: "Native ecosystem exposure, high volatility opportunity",
    },
    impact: {
      riskLevel: "medium",
      affectedAgents: configs.map((c) => c.agentId),
      estimatedImpact:
        "Adds crypto-native exposure — high vol but aligns with platform ecosystem",
    },
    votes: configs.map((c, i) => ({
      agentId: c.agentId,
      agentName: c.name,
      option: (i < 2 ? "for" : "abstain") as VoteOption,
      votingPower: Math.round(VOTING_POWER_EQUAL_DISTRIBUTION / configs.length),
      reasoning: i < 2
        ? "Solana exposure makes sense for our platform"
        : "Need more data on SOLx liquidity before committing",
      timestamp: new Date(
        now.getTime() - (3 - i) * dayMs,
      ).toISOString(),
    })),
    votingPower: {
      totalFor: QUORUM_THRESHOLD_STANDARD,
      totalAgainst: 0,
      totalAbstain: VOTING_POWER_ALLOCATION,
      quorumReached: true,
      quorumThreshold: QUORUM_THRESHOLD_STANDARD,
      passingThreshold: PASSING_THRESHOLD_STANDARD,
    },
    createdAt: new Date(now.getTime() - 5 * dayMs).toISOString(),
    votingStartsAt: new Date(now.getTime() - 4 * dayMs).toISOString(),
    votingEndsAt: new Date(now.getTime() - dayMs).toISOString(),
    executedAt: new Date(now.getTime() - dayMs / 2).toISOString(),
    discussion: [
      {
        id: "disc_003",
        agentId: configs.length > 2 ? configs[2].agentId : "agent-3",
        agentName: configs.length > 2 ? configs[2].name : "Agent 3",
        content:
          "SOLx has deep liquidity on Jupiter and gives us a crypto-native asset class. This is a no-brainer for a Solana-based platform.",
        sentiment: "supportive",
        timestamp: new Date(now.getTime() - 4 * dayMs).toISOString(),
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Proposal Management
// ---------------------------------------------------------------------------

/**
 * Create a new governance proposal.
 */
export function createProposal(params: {
  title: string;
  description: string;
  type: ProposalType;
  proposerAgentId: string;
  parameters: Record<string, unknown>;
  votingDurationHours?: number;
}): Proposal {
  seedProposals();

  const configs = getAgentConfigs();
  const proposer = configs.find((c) => c.agentId === params.proposerAgentId);

  const now = new Date();
  const votingDuration = (params.votingDurationHours ?? VOTING_DURATION_HOURS_DEFAULT) * 60 * 60 * 1000;

  // Determine risk level based on type
  let riskLevel: "low" | "medium" | "high" = "medium";
  if (params.type === "emergency_action") riskLevel = "high";
  if (params.type === "rule_change") riskLevel = "low";

  const proposal: Proposal = {
    id: `prop_${Date.now()}_${Math.random().toString(36).slice(ID_RANDOM_START, ID_RANDOM_START + ID_RANDOM_LENGTH_SHORT)}`,
    title: params.title,
    description: params.description,
    type: params.type,
    proposer: {
      agentId: params.proposerAgentId,
      agentName: proposer?.name ?? params.proposerAgentId,
    },
    status: "active",
    parameters: params.parameters,
    impact: {
      riskLevel,
      affectedAgents: configs.map((c) => c.agentId),
      estimatedImpact: `Pending impact assessment for ${params.type} proposal`,
    },
    votes: [],
    votingPower: {
      totalFor: 0,
      totalAgainst: 0,
      totalAbstain: 0,
      quorumReached: false,
      quorumThreshold: QUORUM_THRESHOLD_STANDARD,
      passingThreshold: params.type === "emergency_action" ? PASSING_THRESHOLD_EMERGENCY : PASSING_THRESHOLD_STANDARD,
    },
    createdAt: now.toISOString(),
    votingStartsAt: now.toISOString(),
    votingEndsAt: new Date(now.getTime() + votingDuration).toISOString(),
    discussion: [],
  };

  proposals.push(proposal);
  return proposal;
}

/**
 * Cast a vote on a proposal.
 */
export function castVote(params: {
  proposalId: string;
  agentId: string;
  option: VoteOption;
  reasoning: string;
}): { success: boolean; error?: string; proposal?: Proposal } {
  seedProposals();

  const proposal = proposals.find((p) => p.id === params.proposalId);
  if (!proposal) return { success: false, error: "Proposal not found" };

  if (proposal.status !== "active") {
    return { success: false, error: `Proposal is ${proposal.status}, not active` };
  }

  // Check if voting window has closed
  if (new Date() > new Date(proposal.votingEndsAt)) {
    return { success: false, error: "Voting period has ended" };
  }

  // Check if agent already voted
  const existingVote = proposal.votes.find((v) => v.agentId === params.agentId);
  if (existingVote) {
    return { success: false, error: "Agent has already voted on this proposal" };
  }

  const configs = getAgentConfigs();
  const voter = configs.find((c) => c.agentId === params.agentId);

  // Voting power based on number of agents (equal weight for now)
  const votingPower = Math.round(100 / clamp(configs.length, 1, Infinity));

  const vote: Vote = {
    agentId: params.agentId,
    agentName: voter?.name ?? params.agentId,
    option: params.option,
    votingPower,
    reasoning: params.reasoning,
    timestamp: new Date().toISOString(),
  };

  proposal.votes.push(vote);

  // Recalculate voting power
  let totalFor = 0;
  let totalAgainst = 0;
  let totalAbstain = 0;
  for (const v of proposal.votes) {
    if (v.option === "for") totalFor += v.votingPower;
    else if (v.option === "against") totalAgainst += v.votingPower;
    else totalAbstain += v.votingPower;
  }

  const totalVotingPower = totalFor + totalAgainst + totalAbstain;
  const quorumReached = totalVotingPower >= proposal.votingPower.quorumThreshold;

  proposal.votingPower = {
    totalFor,
    totalAgainst,
    totalAbstain,
    quorumReached,
    quorumThreshold: proposal.votingPower.quorumThreshold,
    passingThreshold: proposal.votingPower.passingThreshold,
  };

  // Auto-resolve if quorum reached
  if (quorumReached) {
    const forPercent = totalFor / (totalFor + totalAgainst || 1) * 100;
    if (forPercent >= proposal.votingPower.passingThreshold) {
      proposal.status = "passed";
    } else {
      proposal.status = "rejected";
    }
  }

  return { success: true, proposal };
}

/**
 * Add a comment to a proposal's discussion.
 */
export function addDiscussionComment(params: {
  proposalId: string;
  agentId: string;
  content: string;
  sentiment: DiscussionComment["sentiment"];
  replyTo?: string;
}): { success: boolean; error?: string; comment?: DiscussionComment } {
  seedProposals();

  const proposal = proposals.find((p) => p.id === params.proposalId);
  if (!proposal) return { success: false, error: "Proposal not found" };

  const configs = getAgentConfigs();
  const agent = configs.find((c) => c.agentId === params.agentId);

  const comment: DiscussionComment = {
    id: `disc_${Date.now()}_${Math.random().toString(36).slice(ID_RANDOM_START, ID_RANDOM_START + ID_RANDOM_LENGTH_SHORT)}`,
    agentId: params.agentId,
    agentName: agent?.name ?? params.agentId,
    content: params.content,
    sentiment: params.sentiment,
    timestamp: new Date().toISOString(),
    replyTo: params.replyTo,
  };

  proposal.discussion.push(comment);
  return { success: true, comment };
}

// ---------------------------------------------------------------------------
// Query Functions
// ---------------------------------------------------------------------------

/**
 * Get all proposals with optional filtering.
 */
export function getProposals(filters?: {
  status?: ProposalStatus;
  type?: ProposalType;
  proposerId?: string;
  limit?: number;
}): Proposal[] {
  seedProposals();

  let filtered = [...proposals];

  if (filters?.status) {
    filtered = filtered.filter((p) => p.status === filters.status);
  }
  if (filters?.type) {
    filtered = filtered.filter((p) => p.type === filters.type);
  }
  if (filters?.proposerId) {
    filtered = filtered.filter(
      (p) => p.proposer.agentId === filters.proposerId,
    );
  }

  const limit = filters?.limit ?? 50;
  return filtered.slice(0, limit).sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

/**
 * Get a single proposal by ID.
 */
export function getProposalById(id: string): Proposal | null {
  seedProposals();
  return proposals.find((p) => p.id === id) ?? null;
}

/**
 * Get constitutional rules.
 */
export function getConstitutionalRules(): ConstitutionalRule[] {
  return constitutionalRules;
}

/**
 * Get governance statistics.
 */
export function getGovernanceStats(): GovernanceStats {
  seedProposals();

  const totalProposals = proposals.length;
  const activeProposals = countByCondition(proposals, (p: Proposal) => p.status === "active");
  const passedProposals = countByCondition(proposals, (p: Proposal) => p.status === "passed");
  const rejectedProposals = countByCondition(proposals, (p: Proposal) => p.status === "rejected");

  const allVotes = proposals.flatMap((p) => p.votes);
  const totalVotes = allVotes.length;

  // Average participation
  const participationRates = proposals.map((p) => {
    const configs = getAgentConfigs();
    return configs.length > 0
      ? (p.votes.length / configs.length) * 100
      : 0;
  });
  const averageParticipation =
    participationRates.length > 0
      ? Math.round(
          participationRates.reduce((s, r) => s + r, 0) /
            participationRates.length,
        )
      : 0;

  // Most active voter
  const voterCounts = new Map<string, { name: string; count: number }>();
  for (const vote of allVotes) {
    const existing = voterCounts.get(vote.agentId) ?? {
      name: vote.agentName,
      count: 0,
    };
    existing.count++;
    voterCounts.set(vote.agentId, existing);
  }

  let mostActiveVoter: GovernanceStats["mostActiveVoter"] = null;
  for (const [agentId, data] of voterCounts) {
    if (!mostActiveVoter || data.count > mostActiveVoter.voteCount) {
      mostActiveVoter = {
        agentId,
        name: data.name,
        voteCount: data.count,
      };
    }
  }

  // Most successful proposer
  const proposerStats = new Map<
    string,
    { name: string; total: number; passed: number }
  >();
  for (const p of proposals) {
    const existing = proposerStats.get(p.proposer.agentId) ?? {
      name: p.proposer.agentName,
      total: 0,
      passed: 0,
    };
    existing.total++;
    if (p.status === "passed") existing.passed++;
    proposerStats.set(p.proposer.agentId, existing);
  }

  let mostSuccessfulProposer: GovernanceStats["mostSuccessfulProposer"] = null;
  for (const [agentId, data] of proposerStats) {
    const passRate =
      data.total > 0 ? Math.round((data.passed / data.total) * 100) : 0;
    if (
      !mostSuccessfulProposer ||
      passRate > mostSuccessfulProposer.passRate
    ) {
      mostSuccessfulProposer = { agentId, name: data.name, passRate };
    }
  }

  // Quorum success rate
  const proposalsWithQuorum = proposals.filter(
    (p) => p.votingPower.quorumReached,
  );
  const quorumSuccessRate =
    totalProposals > 0
      ? Math.round((proposalsWithQuorum.length / totalProposals) * 100)
      : 0;

  return {
    totalProposals,
    activeProposals,
    passedProposals,
    rejectedProposals,
    totalVotes,
    averageParticipation,
    mostActiveVoter,
    mostSuccessfulProposer,
    averageVotingDuration: VOTING_DURATION_HOURS_DEFAULT,
    quorumSuccessRate,
  };
}

/**
 * Get an agent's governance participation.
 */
export function getAgentGovernanceProfile(agentId: string) {
  seedProposals();

  const configs = getAgentConfigs();
  const config = configs.find((c) => c.agentId === agentId);
  if (!config) return null;

  const proposed = proposals.filter(
    (p) => p.proposer.agentId === agentId,
  );
  const allVotes = proposals.flatMap((p) => p.votes);
  const agentVotes = allVotes.filter((v) => v.agentId === agentId);

  const forVotes = countByCondition(agentVotes, (v) => v.option === "for");
  const againstVotes = countByCondition(agentVotes, (v) => v.option === "against");
  const abstainVotes = countByCondition(agentVotes, (v) => v.option === "abstain");

  // Voting alignment: how often does this agent vote with the majority?
  let alignedVotes = 0;
  for (const p of proposals) {
    const vote = p.votes.find((v) => v.agentId === agentId);
    if (!vote) continue;
    if (
      (p.status === "passed" && vote.option === "for") ||
      (p.status === "rejected" && vote.option === "against")
    ) {
      alignedVotes++;
    }
  }

  const eligibleProposals = proposals.filter(
    (p) => p.status !== "draft",
  ).length;
  const participationRate =
    eligibleProposals > 0
      ? Math.round((agentVotes.length / eligibleProposals) * 100)
      : 0;

  return {
    agentId,
    agentName: config.name,
    proposalsCreated: proposed.length,
    proposalsPassed: countByCondition(proposed, (p) => p.status === "passed"),
    totalVotes: agentVotes.length,
    voteBreakdown: {
      for: forVotes,
      against: againstVotes,
      abstain: abstainVotes,
    },
    participationRate,
    majorityAlignment:
      agentVotes.length > 0
        ? Math.round((alignedVotes / agentVotes.length) * 100)
        : 0,
    recentActivity: agentVotes.slice(-5).map((v) => ({
      proposalId: proposals.find((p) =>
        p.votes.some(
          (pv) => pv.agentId === v.agentId && pv.timestamp === v.timestamp,
        ),
      )?.id,
      vote: v.option,
      reasoning: v.reasoning,
      timestamp: v.timestamp,
    })),
  };
}
