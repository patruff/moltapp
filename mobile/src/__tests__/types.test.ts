/**
 * Type and constant validation tests for the mobile app.
 * These ensure our constants and type definitions stay consistent.
 */

import { describe, it, expect } from "vitest";
import {
  API_ENDPOINTS,
  CAPABILITY_LABELS,
  MODEL_OPTIONS,
  MIN_JOB_BUDGET_USDC,
  MAX_JOB_BUDGET_USDC,
  PLATFORM_FEE_PERCENT,
  USDC_DECIMALS,
  USDC_MINT,
  APP_IDENTITY,
  SOLANA_CLUSTER,
} from "../utils/constants";

describe("Constants", () => {
  describe("API_ENDPOINTS", () => {
    it("has all required endpoints", () => {
      expect(API_ENDPOINTS.auth).toBeDefined();
      expect(API_ENDPOINTS.agents).toBeDefined();
      expect(API_ENDPOINTS.jobs).toBeDefined();
      expect(API_ENDPOINTS.deliverables).toBeDefined();
      expect(API_ENDPOINTS.escrow).toBeDefined();
      expect(API_ENDPOINTS.wallet).toBeDefined();
      expect(API_ENDPOINTS.analysis).toBeDefined();
      expect(API_ENDPOINTS.shared).toBeDefined();
      expect(API_ENDPOINTS.brainFeed).toBeDefined();
    });

    it("all endpoints start with /api/v1/mobile except brainFeed", () => {
      const mobileEndpoints = Object.entries(API_ENDPOINTS).filter(
        ([key]) => key !== "brainFeed"
      );
      for (const [, path] of mobileEndpoints) {
        expect(path).toMatch(/^\/api\/v1\/mobile\//);
      }
    });

    it("brainFeed endpoint uses v1 but not mobile prefix", () => {
      expect(API_ENDPOINTS.brainFeed).toMatch(/^\/api\/v1\//);
      expect(API_ENDPOINTS.brainFeed).not.toContain("/mobile/");
    });

    it("has exactly 9 endpoints", () => {
      expect(Object.keys(API_ENDPOINTS)).toHaveLength(9);
    });

    it("no endpoint has trailing slash", () => {
      for (const [, path] of Object.entries(API_ENDPOINTS)) {
        expect(path).not.toMatch(/\/$/);
      }
    });
  });

  describe("CAPABILITY_LABELS", () => {
    it("has labels for all 7 capabilities", () => {
      const expected = [
        "financial_analysis",
        "stock_screening",
        "portfolio_optimization",
        "risk_assessment",
        "market_sentiment",
        "technical_analysis",
        "macro_research",
      ];
      for (const cap of expected) {
        expect(CAPABILITY_LABELS[cap]).toBeDefined();
        expect(typeof CAPABILITY_LABELS[cap]).toBe("string");
        expect(CAPABILITY_LABELS[cap].length).toBeGreaterThan(0);
      }
    });

    it("has exactly 7 capability labels", () => {
      expect(Object.keys(CAPABILITY_LABELS)).toHaveLength(7);
    });

    it("labels are title-cased display names", () => {
      for (const [, label] of Object.entries(CAPABILITY_LABELS)) {
        // Each word should start with uppercase
        expect(label).toMatch(/^[A-Z]/);
      }
    });
  });

  describe("MODEL_OPTIONS", () => {
    it("has at least 4 model options", () => {
      expect(MODEL_OPTIONS.length).toBeGreaterThanOrEqual(4);
    });

    it("each model has provider, model, and label", () => {
      for (const opt of MODEL_OPTIONS) {
        expect(opt.provider).toBeDefined();
        expect(opt.model).toBeDefined();
        expect(opt.label).toBeDefined();
        expect(opt.label.length).toBeGreaterThan(0);
      }
    });

    it("includes major providers", () => {
      const providers = MODEL_OPTIONS.map((m) => m.provider);
      expect(providers).toContain("anthropic");
      expect(providers).toContain("openai");
      expect(providers).toContain("xai");
      expect(providers).toContain("google");
    });

    it("each model ID is a non-empty string", () => {
      for (const opt of MODEL_OPTIONS) {
        expect(typeof opt.model).toBe("string");
        expect(opt.model.length).toBeGreaterThan(0);
        // Model IDs shouldn't have spaces
        expect(opt.model).not.toContain(" ");
      }
    });

    it("has no duplicate model IDs", () => {
      const modelIds = MODEL_OPTIONS.map((m) => m.model);
      expect(new Set(modelIds).size).toBe(modelIds.length);
    });
  });

  describe("Pricing constants", () => {
    it("MIN_JOB_BUDGET_USDC is reasonable", () => {
      expect(MIN_JOB_BUDGET_USDC).toBeGreaterThan(0);
      expect(MIN_JOB_BUDGET_USDC).toBeLessThan(10);
    });

    it("MAX_JOB_BUDGET_USDC is reasonable", () => {
      expect(MAX_JOB_BUDGET_USDC).toBeGreaterThan(MIN_JOB_BUDGET_USDC);
      expect(MAX_JOB_BUDGET_USDC).toBeLessThanOrEqual(10000);
    });

    it("PLATFORM_FEE_PERCENT is between 0 and 10", () => {
      expect(PLATFORM_FEE_PERCENT).toBeGreaterThanOrEqual(0);
      expect(PLATFORM_FEE_PERCENT).toBeLessThanOrEqual(10);
    });

    it("USDC_DECIMALS is 6", () => {
      expect(USDC_DECIMALS).toBe(6);
    });

    it("fee calculation produces expected result", () => {
      const budget = 100;
      const fee = budget * (PLATFORM_FEE_PERCENT / 100);
      expect(fee).toBe(2.5);
      expect(budget - fee).toBe(97.5);
    });
  });

  describe("Solana constants", () => {
    it("USDC_MINT is a valid PublicKey", () => {
      expect(USDC_MINT).toBeDefined();
      expect(USDC_MINT.toBase58()).toBe(
        "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
      );
    });

    it("SOLANA_CLUSTER is mainnet-beta", () => {
      expect(SOLANA_CLUSTER).toBe("mainnet-beta");
    });

    it("APP_IDENTITY has required fields", () => {
      expect(APP_IDENTITY.name).toBe("MoltApp");
      expect(APP_IDENTITY.uri).toMatch(/^https:\/\//);
      expect(APP_IDENTITY.icon).toBeDefined();
    });
  });
});

describe("API URL construction", () => {
  it("builds correct agent list URL", () => {
    const url = `${API_ENDPOINTS.agents}?capability=financial_analysis&page=1`;
    expect(url).toBe(
      "/api/v1/mobile/agents?capability=financial_analysis&page=1"
    );
  });

  it("builds correct job detail URL", () => {
    const jobId = "job_123";
    const url = `${API_ENDPOINTS.jobs}/${jobId}`;
    expect(url).toBe("/api/v1/mobile/jobs/job_123");
  });

  it("builds correct analysis run URL", () => {
    const url = `${API_ENDPOINTS.analysis}/run`;
    expect(url).toBe("/api/v1/mobile/analysis/run");
  });

  it("builds correct shared analysis purchase URL", () => {
    const sharedId = "shared_456";
    const url = `${API_ENDPOINTS.shared}/${sharedId}/purchase`;
    expect(url).toBe("/api/v1/mobile/shared/shared_456/purchase");
  });

  it("builds correct auth wallet URL", () => {
    const url = `${API_ENDPOINTS.auth}/wallet`;
    expect(url).toBe("/api/v1/mobile/auth/wallet");
  });

  it("builds correct auth login URL", () => {
    const url = `${API_ENDPOINTS.auth}/login`;
    expect(url).toBe("/api/v1/mobile/auth/login");
  });

  it("builds correct escrow create URL", () => {
    const url = `${API_ENDPOINTS.escrow}/create`;
    expect(url).toBe("/api/v1/mobile/escrow/create");
  });

  it("builds correct wallet info URL", () => {
    const address = "ABC123";
    const url = `${API_ENDPOINTS.wallet}/${address}`;
    expect(url).toBe("/api/v1/mobile/wallet/ABC123");
  });

  it("builds correct deliverable submit URL", () => {
    const jobId = "job_789";
    const url = `${API_ENDPOINTS.deliverables}/${jobId}/submit`;
    expect(url).toBe("/api/v1/mobile/deliverables/job_789/submit");
  });
});

describe("USDC math", () => {
  it("converts raw token amount to human-readable", () => {
    const rawAmount = 1_500_000n; // 1.5 USDC in raw
    const readable = Number(rawAmount) / 10 ** USDC_DECIMALS;
    expect(readable).toBe(1.5);
  });

  it("converts human amount to raw token amount", () => {
    const humanAmount = 25.5;
    const raw = Math.round(humanAmount * 10 ** USDC_DECIMALS);
    expect(raw).toBe(25_500_000);
  });

  it("handles zero correctly", () => {
    const raw = 0;
    const readable = raw / 10 ** USDC_DECIMALS;
    expect(readable).toBe(0);
  });

  it("handles precision for small amounts", () => {
    const humanAmount = 0.01; // 1 cent
    const raw = Math.round(humanAmount * 10 ** USDC_DECIMALS);
    expect(raw).toBe(10_000);
  });
});
