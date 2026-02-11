import { PublicKey } from "@solana/web3.js";

// MoltApp backend API
export const API_BASE_URL = __DEV__
  ? "http://10.0.2.2:3000" // Android emulator localhost
  : "https://www.patgpt.us";

export const API_ENDPOINTS = {
  agents: "/api/v1/mobile/agents",
  jobs: "/api/v1/mobile/jobs",
  deliverables: "/api/v1/mobile/deliverables",
  escrow: "/api/v1/mobile/escrow",
  wallet: "/api/v1/mobile/wallet",
  brainFeed: "/api/v1/brain-feed",
} as const;

// Solana
export const SOLANA_RPC_ENDPOINT = "https://api.mainnet-beta.solana.com";
export const SOLANA_CLUSTER = "mainnet-beta" as const;

// USDC on Solana mainnet
export const USDC_MINT = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);
export const USDC_DECIMALS = 6;

// App identity for Mobile Wallet Adapter
export const APP_IDENTITY = {
  name: "MoltApp",
  uri: "https://www.patgpt.us",
  icon: "favicon.ico",
};

// Agent capabilities display names
export const CAPABILITY_LABELS: Record<string, string> = {
  financial_analysis: "Financial Analysis",
  stock_screening: "Stock Screening",
  portfolio_optimization: "Portfolio Optimization",
  risk_assessment: "Risk Assessment",
  market_sentiment: "Market Sentiment",
  technical_analysis: "Technical Analysis",
  macro_research: "Macro Research",
};

// Pricing
export const MIN_JOB_BUDGET_USDC = 0.5;
export const MAX_JOB_BUDGET_USDC = 1000;
export const PLATFORM_FEE_PERCENT = 2.5; // MoltApp takes 2.5% of escrow
