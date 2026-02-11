import { API_BASE_URL, API_ENDPOINTS } from "../utils/constants";
import type {
  Agent,
  Job,
  Deliverable,
  AnalysisRun,
  SharedAnalysis,
  ApiResponse,
  PaginatedResponse,
  AgentCapability,
  PricingModel,
} from "../types";

async function request<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`API error ${response.status}: ${errorBody}`);
  }

  return response.json();
}

// ─── Agents ────────────────────────────────────────────

export async function fetchAgents(params?: {
  capability?: AgentCapability;
  page?: number;
  pageSize?: number;
}): Promise<PaginatedResponse<Agent>> {
  const query = new URLSearchParams();
  if (params?.capability) query.set("capability", params.capability);
  if (params?.page) query.set("page", String(params.page));
  if (params?.pageSize) query.set("pageSize", String(params.pageSize));

  const qs = query.toString();
  return request(`${API_ENDPOINTS.agents}${qs ? `?${qs}` : ""}`);
}

export async function fetchAgent(
  agentId: string
): Promise<ApiResponse<Agent>> {
  return request(`${API_ENDPOINTS.agents}/${agentId}`);
}

export async function registerAgent(
  agent: Omit<Agent, "id" | "rating" | "jobsCompleted" | "createdAt">
): Promise<ApiResponse<Agent>> {
  return request(API_ENDPOINTS.agents, {
    method: "POST",
    body: JSON.stringify(agent),
  });
}

// ─── Jobs ──────────────────────────────────────────────

export async function fetchJobs(params?: {
  status?: string;
  capability?: AgentCapability;
  buyerWallet?: string;
  sellerAgentId?: string;
  page?: number;
  pageSize?: number;
}): Promise<PaginatedResponse<Job>> {
  const query = new URLSearchParams();
  if (params?.status) query.set("status", params.status);
  if (params?.capability) query.set("capability", params.capability);
  if (params?.buyerWallet) query.set("buyerWallet", params.buyerWallet);
  if (params?.sellerAgentId)
    query.set("sellerAgentId", params.sellerAgentId);
  if (params?.page) query.set("page", String(params.page));
  if (params?.pageSize) query.set("pageSize", String(params.pageSize));

  const qs = query.toString();
  return request(`${API_ENDPOINTS.jobs}${qs ? `?${qs}` : ""}`);
}

export async function fetchJob(
  jobId: string
): Promise<ApiResponse<Job>> {
  return request(`${API_ENDPOINTS.jobs}/${jobId}`);
}

export async function postJob(job: {
  title: string;
  description: string;
  buyerWallet: string;
  capability: AgentCapability;
  pricingModel: PricingModel;
  budgetUsdc: number;
}): Promise<ApiResponse<Job>> {
  return request(API_ENDPOINTS.jobs, {
    method: "POST",
    body: JSON.stringify(job),
  });
}

export async function acceptJob(
  jobId: string,
  sellerAgentId: string
): Promise<ApiResponse<Job>> {
  return request(`${API_ENDPOINTS.jobs}/${jobId}/accept`, {
    method: "POST",
    body: JSON.stringify({ sellerAgentId }),
  });
}

export async function cancelJob(
  jobId: string
): Promise<ApiResponse<Job>> {
  return request(`${API_ENDPOINTS.jobs}/${jobId}/cancel`, {
    method: "POST",
  });
}

// ─── Deliverables ──────────────────────────────────────

export async function submitDeliverable(
  jobId: string,
  deliverable: {
    agentId: string;
    content: Deliverable["content"];
    tokensUsed: number;
  }
): Promise<ApiResponse<Deliverable>> {
  return request(`${API_ENDPOINTS.deliverables}/${jobId}/submit`, {
    method: "POST",
    body: JSON.stringify(deliverable),
  });
}

export async function verifyDeliverable(
  jobId: string,
  accepted: boolean
): Promise<ApiResponse<Deliverable>> {
  return request(`${API_ENDPOINTS.deliverables}/${jobId}/verify`, {
    method: "POST",
    body: JSON.stringify({ accepted }),
  });
}

// ─── Escrow ────────────────────────────────────────────

export async function createEscrow(params: {
  jobId: string;
  buyerWallet: string;
  sellerWallet: string;
  amountUsdc: number;
}): Promise<ApiResponse<{ escrowAddress: string; transaction: string }>> {
  return request(API_ENDPOINTS.escrow, {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function releaseEscrow(
  escrowAddress: string
): Promise<ApiResponse<{ signature: string }>> {
  return request(`${API_ENDPOINTS.escrow}/${escrowAddress}/release`, {
    method: "POST",
  });
}

export async function refundEscrow(
  escrowAddress: string
): Promise<ApiResponse<{ signature: string }>> {
  return request(`${API_ENDPOINTS.escrow}/${escrowAddress}/refund`, {
    method: "POST",
  });
}

// ─── Wallet Info ───────────────────────────────────────

export async function fetchWalletInfo(address: string): Promise<
  ApiResponse<{
    balanceSol: number;
    balanceUsdc: number;
    totalEarned: number;
    totalSpent: number;
    activeJobs: number;
  }>
> {
  return request(`${API_ENDPOINTS.wallet}/${address}`);
}

// ─── Agent CRUD ────────────────────────────────────────

export async function updateAgent(
  agentId: string,
  updates: Partial<Agent>
): Promise<ApiResponse<Agent>> {
  return request(`${API_ENDPOINTS.agents}/${agentId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export async function deleteAgent(
  agentId: string
): Promise<ApiResponse<void>> {
  return request(`${API_ENDPOINTS.agents}/${agentId}`, {
    method: "DELETE",
  });
}

// ─── Analysis Runs ─────────────────────────────────────

export async function runAnalysis(params: {
  agentId: string;
  tickers: string[];
  capability: AgentCapability;
  maxTokens: number;
}): Promise<ApiResponse<AnalysisRun>> {
  return request(`${API_ENDPOINTS.analysis}/run`, {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function fetchAnalysisRun(
  analysisId: string
): Promise<ApiResponse<AnalysisRun>> {
  return request(`${API_ENDPOINTS.analysis}/${analysisId}`);
}

export async function fetchMyAnalysisRuns(
  agentId: string
): Promise<PaginatedResponse<AnalysisRun>> {
  return request(`${API_ENDPOINTS.analysis}?agentId=${agentId}`);
}

// ─── Shared Analyses ───────────────────────────────────

export async function shareAnalysis(params: {
  analysisRunId: string;
  title: string;
  description: string;
  previewSummary: string;
  priceUsdc: number;
  visibility: string;
  maxPurchases: number;
  expiresInDays?: number;
}): Promise<ApiResponse<SharedAnalysis>> {
  return request(API_ENDPOINTS.shared, {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function fetchSharedAnalyses(params?: {
  capability?: AgentCapability;
  page?: number;
}): Promise<PaginatedResponse<SharedAnalysis>> {
  const query = new URLSearchParams();
  if (params?.capability) query.set("capability", params.capability);
  if (params?.page) query.set("page", String(params.page));
  const qs = query.toString();
  return request(`${API_ENDPOINTS.shared}${qs ? `?${qs}` : ""}`);
}

export async function fetchSharedAnalysis(
  sharedId: string
): Promise<ApiResponse<SharedAnalysis>> {
  return request(`${API_ENDPOINTS.shared}/${sharedId}`);
}

export async function purchaseSharedAnalysis(
  sharedId: string,
  buyerWallet: string
): Promise<ApiResponse<SharedAnalysis>> {
  return request(`${API_ENDPOINTS.shared}/${sharedId}/purchase`, {
    method: "POST",
    body: JSON.stringify({ buyerWallet }),
  });
}
