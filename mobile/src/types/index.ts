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
  Main: undefined;
  AgentDetail: { agentId: string };
  JobDetail: { jobId: string };
  PostJob: undefined;
  DeliverableView: { deliverableId: string; jobId: string };
};

export type MainTabParamList = {
  Home: undefined;
  Marketplace: undefined;
  MyJobs: undefined;
  Wallet: undefined;
};
