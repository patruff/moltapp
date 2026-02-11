import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as api from "../services/api";
import type { AgentCapability, PricingModel, Job } from "../types";

// ─── Agents ────────────────────────────────────────────

export function useAgents(capability?: AgentCapability) {
  return useQuery({
    queryKey: ["agents", capability],
    queryFn: () => api.fetchAgents({ capability }),
  });
}

export function useAgent(agentId: string) {
  return useQuery({
    queryKey: ["agent", agentId],
    queryFn: () => api.fetchAgent(agentId),
    enabled: !!agentId,
  });
}

// ─── Jobs ──────────────────────────────────────────────

export function useOpenJobs(capability?: AgentCapability) {
  return useQuery({
    queryKey: ["jobs", "open", capability],
    queryFn: () => api.fetchJobs({ status: "open", capability }),
    refetchInterval: 15_000, // Refresh every 15s
  });
}

export function useMyJobs(walletAddress?: string) {
  return useQuery({
    queryKey: ["jobs", "mine", walletAddress],
    queryFn: () =>
      api.fetchJobs({ buyerWallet: walletAddress }),
    enabled: !!walletAddress,
    refetchInterval: 10_000,
  });
}

export function useJob(jobId: string) {
  return useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api.fetchJob(jobId),
    enabled: !!jobId,
    refetchInterval: 5_000,
  });
}

export function usePostJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (job: {
      title: string;
      description: string;
      buyerWallet: string;
      capability: AgentCapability;
      pricingModel: PricingModel;
      budgetUsdc: number;
    }) => api.postJob(job),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}

export function useAcceptJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      jobId,
      sellerAgentId,
    }: {
      jobId: string;
      sellerAgentId: string;
    }) => api.acceptJob(jobId, sellerAgentId),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["job", variables.jobId],
      });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}

// ─── Deliverables ──────────────────────────────────────

export function useSubmitDeliverable() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      jobId,
      ...rest
    }: {
      jobId: string;
      agentId: string;
      content: any;
      tokensUsed: number;
    }) => api.submitDeliverable(jobId, rest),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["job", variables.jobId],
      });
    },
  });
}

export function useVerifyDeliverable() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      jobId,
      accepted,
    }: {
      jobId: string;
      accepted: boolean;
    }) => api.verifyDeliverable(jobId, accepted),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["job", variables.jobId],
      });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}

// ─── Wallet Info ───────────────────────────────────────

export function useWalletInfo(address?: string) {
  return useQuery({
    queryKey: ["walletInfo", address],
    queryFn: () => api.fetchWalletInfo(address!),
    enabled: !!address,
    refetchInterval: 30_000,
  });
}
