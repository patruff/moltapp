import { PublicKey } from "@solana/web3.js";

// MoltApp backend API
export const API_BASE_URL = __DEV__
  ? "http://10.0.2.2:3000" // Android emulator localhost
  : "https://www.patgpt.us";

export const API_ENDPOINTS = {
  auth: "/api/v1/mobile/auth",
  agents: "/api/v1/mobile/agents",
  jobs: "/api/v1/mobile/jobs",
  deliverables: "/api/v1/mobile/deliverables",
  escrow: "/api/v1/mobile/escrow",
  wallet: "/api/v1/mobile/wallet",
  analysis: "/api/v1/mobile/analysis",
  shared: "/api/v1/mobile/shared",
  brainFeed: "/api/v1/brain-feed",
} as const;

// OAuth
export const GOOGLE_CLIENT_ID = "YOUR_GOOGLE_CLIENT_ID"; // Set in .env
export const GITHUB_CLIENT_ID = "YOUR_GITHUB_CLIENT_ID"; // Set in .env

// Agent model options users can pick from
export const MODEL_OPTIONS: {
  provider: string;
  model: string;
  label: string;
}[] = [
  { provider: "anthropic", model: "claude-opus-4-6", label: "Claude Opus 4.6" },
  { provider: "anthropic", model: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5" },
  { provider: "openai", model: "gpt-5.2", label: "GPT-5.2" },
  { provider: "openai", model: "gpt-4.1", label: "GPT-4.1" },
  { provider: "xai", model: "grok-4", label: "Grok 4" },
  { provider: "google", model: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { provider: "google", model: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
];

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

// Engagement endpoints
export const ENGAGEMENT_ENDPOINTS = {
  quests: "/api/v1/mobile/quests",
  points: "/api/v1/mobile/points",
  leaderboard: "/api/v1/mobile/leaderboard",
  referrals: "/api/v1/mobile/referrals",
  blinks: "/api/v1/mobile/blinks",
  catalog: "/api/v1/mobile/catalog",
} as const;

// Points system
export const POINTS_PER_REFERRAL = 500;
export const POINTS_PER_DAILY_LOGIN = 50;
export const POINTS_PER_FIRST_PURCHASE = 200;
export const POINTS_PER_ANALYSIS_SOLD = 100;

// Quest category display names
export const QUEST_CATEGORY_LABELS: Record<string, string> = {
  onboarding: "Getting Started",
  trading: "Trading",
  social: "Social",
  marketplace: "Marketplace",
  streak: "Daily Streak",
};
