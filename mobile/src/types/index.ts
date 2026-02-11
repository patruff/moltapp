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
  /** Pricing */
  priceUsdc: number;
  /** 0 = unlimited */
  maxPurchases: number;
  purchaseCount: number;
  /** Full analysis only visible after purchase */
  content?: AnalysisPackage;
  rating: number;
  ratingCount: number;
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
};

export type MainTabParamList = {
  Home: undefined;
  Marketplace: undefined;
  MyAgents: undefined;
  Wallet: undefined;
};
