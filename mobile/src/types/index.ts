import { PublicKey } from "@solana/web3.js";

// ─── Wallet ────────────────────────────────────────────

export interface WalletAccount {
  address: string;
  publicKey: PublicKey;
  label?: string;
}

export interface WalletState {
  connected: boolean;
  account: WalletAccount | null;
  balanceSol: number;
  balanceUsdc: number;
}

// ─── Agent Marketplace ─────────────────────────────────

export type PricingModel = "per_package" | "per_token";

export type JobStatus =
  | "open"
  | "accepted"
  | "in_progress"
  | "delivered"
  | "verified"
  | "completed"
  | "disputed"
  | "cancelled";

export type AgentCapability =
  | "financial_analysis"
  | "stock_screening"
  | "portfolio_optimization"
  | "risk_assessment"
  | "market_sentiment"
  | "technical_analysis"
  | "macro_research";

/** A registered AI agent on the marketplace */
export interface Agent {
  id: string;
  name: string;
  model: string;
  provider: string;
  ownerWallet: string;
  capabilities: AgentCapability[];
  rating: number;
  jobsCompleted: number;
  /** Agent's pricing: USDC per package or per 1K tokens */
  pricing: AgentPricing;
  description: string;
  createdAt: string;
}

export interface AgentPricing {
  model: PricingModel;
  /** USDC amount — per package or per 1K tokens */
  amount: number;
  /** For per_token: max tokens the agent will use */
  maxTokens?: number;
  /** Discount percentage off standard API pricing */
  discountPercent?: number;
}

/** A job posted by a buyer seeking financial analysis */
export interface Job {
  id: string;
  title: string;
  description: string;
  buyerWallet: string;
  buyerAgentId?: string;
  sellerAgentId?: string;
  capability: AgentCapability;
  pricingModel: PricingModel;
  budgetUsdc: number;
  escrowAddress?: string;
  status: JobStatus;
  deliverable?: Deliverable;
  createdAt: string;
  acceptedAt?: string;
  completedAt?: string;
}

/** The packaged output from a seller's agent */
export interface Deliverable {
  id: string;
  jobId: string;
  agentId: string;
  /** The analysis content — structured reasoning from the agent */
  content: AnalysisPackage;
  tokensUsed: number;
  submittedAt: string;
  verifiedAt?: string;
}

export interface AnalysisPackage {
  summary: string;
  reasoning: ReasoningStep[];
  recommendations: Recommendation[];
  confidence: number;
  dataSourcesUsed: string[];
  generatedAt: string;
}

export interface ReasoningStep {
  step: number;
  thought: string;
  evidence: string;
  conclusion: string;
}

export interface Recommendation {
  ticker: string;
  action: "buy" | "sell" | "hold";
  reasoning: string;
  confidenceScore: number;
  timeHorizon: string;
}

// ─── User Auth ─────────────────────────────────────────

export type AuthProvider = "wallet" | "google" | "github";

export interface UserProfile {
  id: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
  authProvider: AuthProvider;
  walletAddress?: string;
  /** IDs of agents this user owns */
  agentIds: string[];
  /** Referral code for sharing */
  referralCode?: string;
  /** Who referred this user */
  referredBy?: string;
  /** Total points earned */
  points: number;
  createdAt: string;
}

export interface AuthState {
  authenticated: boolean;
  user: UserProfile | null;
  token: string | null;
  loading: boolean;
}

// ─── Agent Config (user-customizable) ──────────────────

export type AgentModelProvider = "anthropic" | "openai" | "xai" | "google";

export interface AgentConfig {
  /** Display name shown in marketplace */
  name: string;
  /** Which LLM to use */
  modelProvider: AgentModelProvider;
  model: string;
  /** What this agent can do */
  capabilities: AgentCapability[];
  /** System prompt / instructions for the agent */
  systemPrompt: string;
  /** Temperature for the model (0-1) */
  temperature: number;
  /** Max tokens per analysis run */
  maxTokens: number;
  /** Tickers the agent focuses on (empty = all) */
  focusTickers: string[];
  /** Risk tolerance: conservative, moderate, aggressive */
  riskTolerance: "conservative" | "moderate" | "aggressive";
  /** Auto-accept jobs matching criteria */
  autoAccept: boolean;
  autoAcceptMinBudget?: number;
  autoAcceptCapabilities?: AgentCapability[];
}

// ─── Analysis ──────────────────────────────────────────

export type AnalysisStatus = "queued" | "running" | "completed" | "failed";

export interface AnalysisRun {
  id: string;
  agentId: string;
  status: AnalysisStatus;
  config: {
    tickers: string[];
    capability: AgentCapability;
    maxTokens: number;
  };
  result?: AnalysisPackage;
  tokensUsed: number;
  durationMs: number;
  costUsdc: number;
  createdAt: string;
  completedAt?: string;
}

// ─── Shared Analysis (marketplace listing) ─────────────

export type ShareVisibility = "public" | "unlisted" | "private";

/** Buyer type — different packaging for humans vs AI agents */
export type BuyerType = "human" | "agent";

/** Human-formatted analysis: narrative, charts, plain language */
export interface HumanPackage {
  executiveSummary: string;
  detailedNarrative: string;
  keyTakeaways: string[];
  riskWarnings: string[];
  suggestedActions: string[];
  readingTimeMinutes: number;
}

/** AI-formatted analysis: structured JSON, embeddings-ready */
export interface AgentPackage {
  structuredData: AnalysisPackage;
  /** Raw reasoning chain for agent consumption */
  reasoningChain: string[];
  /** Confidence intervals per recommendation */
  confidenceIntervals: { ticker: string; low: number; mid: number; high: number }[];
  /** Metadata for downstream agent processing */
  metadata: {
    modelUsed: string;
    tokensUsed: number;
    dataFreshness: string;
    capability: string;
  };
}

export interface SharedAnalysis {
  id: string;
  analysisRunId: string;
  agentId: string;
  ownerUserId: string;
  title: string;
  description: string;
  /** Preview text shown before purchase */
  previewSummary: string;
  capability: AgentCapability;
  tickers: string[];
  visibility: ShareVisibility;
  /** Pricing — can differ by buyer type */
  priceUsdc: number;
  agentPriceUsdc?: number;
  /** 0 = unlimited */
  maxPurchases: number;
  purchaseCount: number;
  /** Full analysis only visible after purchase */
  content?: AnalysisPackage;
  /** Formatted for humans */
  humanPackage?: HumanPackage;
  /** Structured for AI agents */
  agentPackage?: AgentPackage;
  rating: number;
  ratingCount: number;
  /** Whether this is discoverable by external agents via API */
  agentDiscoverable: boolean;
  createdAt: string;
  expiresAt?: string;
}

// ─── Escrow ────────────────────────────────────────────

export interface EscrowState {
  address: string;
  buyer: string;
  seller: string;
  amountUsdc: number;
  jobId: string;
  status: "funded" | "released" | "refunded" | "disputed";
  createdAt: string;
}

// ─── Engagement: Quests & Points ─────────────────────

export type QuestStatus = "available" | "in_progress" | "completed" | "claimed";
export type QuestCategory = "onboarding" | "trading" | "social" | "marketplace" | "streak";

export interface Quest {
  id: string;
  title: string;
  description: string;
  category: QuestCategory;
  /** Points awarded on completion */
  pointsReward: number;
  /** Optional USDC bonus */
  usdcReward?: number;
  /** What the user must do */
  requirement: {
    type: "connect_wallet" | "first_purchase" | "create_agent" | "run_analysis"
      | "share_analysis" | "refer_friend" | "daily_login" | "complete_job"
      | "buy_shared" | "sell_shared" | "rate_analysis" | "reach_points";
    /** Target count (e.g., "refer 3 friends" → count: 3) */
    count: number;
  };
  /** User's progress toward this quest */
  progress: number;
  status: QuestStatus;
  /** Position in the quest board display */
  sortOrder: number;
  expiresAt?: string;
}

export interface PointsLedger {
  userId: string;
  totalPoints: number;
  entries: PointsEntry[];
}

export interface PointsEntry {
  id: string;
  amount: number;
  reason: string;
  questId?: string;
  createdAt: string;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string;
  points: number;
  agentCount: number;
  salesCount: number;
}

// ─── Engagement: Referrals ───────────────────────────

export interface Referral {
  id: string;
  referrerUserId: string;
  referredUserId: string;
  referralCode: string;
  pointsAwarded: number;
  createdAt: string;
}

// ─── Solana Blinks / Actions ─────────────────────────

export interface BlinkAction {
  type: "buy_analysis" | "view_agent" | "browse_marketplace";
  label: string;
  description: string;
  icon: string;
  /** URL for the Solana Action */
  actionUrl: string;
  /** Parameters the blink requires */
  parameters?: { name: string; label: string; required: boolean }[];
}

// ─── API Responses ─────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  total: number;
  page: number;
  pageSize: number;
}

// ─── Navigation ────────────────────────────────────────

export type RootStackParamList = {
  Onboarding: undefined;
  Main: undefined;
  Login: undefined;
  AgentDetail: { agentId: string };
  JobDetail: { jobId: string };
  PostJob: undefined;
  DeliverableView: { deliverableId: string; jobId: string };
  CreateAgent: undefined;
  EditAgent: { agentId: string };
  RunAnalysis: { agentId: string };
  AnalysisResult: { analysisId: string };
  ShareAnalysis: { analysisId: string };
  SharedAnalysisDetail: { sharedId: string };
  BrowseShared: undefined;
  Quests: undefined;
  Leaderboard: undefined;
  Referrals: undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Marketplace: undefined;
  MyAgents: undefined;
  Wallet: undefined;
};
