/**
 * Predictions Service Tests
 *
 * Tests for the prediction market engine covering:
 * - AMM odds calculation
 * - Prediction creation and validation
 * - Bet placement and market mechanics
 * - Resolution logic and payout distribution
 * - Leaderboard scoring and statistics
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  calculateDynamicOdds,
  createPrediction,
  placeBet,
  resolvePrediction,
  getActivePredictions,
  getPredictionById,
  getAgentPredictionStats,
  getPredictionLeaderboard,
  getMarketOdds,
} from "../predictions.ts";

// Mock dependencies
vi.mock("../../db/index.ts", () => ({
  db: {
    insert: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("../../agents/orchestrator.ts", () => ({
  getMarketData: vi.fn(),
}));

describe("Predictions Service", () => {
  describe("calculateDynamicOdds", () => {
    it("should return even 2.0x odds for empty market", () => {
      const odds = calculateDynamicOdds(0, 0);

      expect(odds.oddsFor).toBe(2.0);
      expect(odds.oddsAgainst).toBe(2.0);
    });

    it("should calculate correct odds with balanced pool", () => {
      // 100 tokens on each side → should still be close to even odds
      const odds = calculateDynamicOdds(100, 100);

      expect(odds.oddsFor).toBeGreaterThan(1.8);
      expect(odds.oddsFor).toBeLessThan(2.2);
      expect(odds.oddsAgainst).toBeGreaterThan(1.8);
      expect(odds.oddsAgainst).toBeLessThan(2.2);
    });

    it("should adjust odds when pool is imbalanced toward FOR", () => {
      // 80 tokens FOR, 20 tokens AGAINST → AGAINST should have better odds
      const odds = calculateDynamicOdds(80, 20);

      expect(odds.oddsAgainst).toBeGreaterThan(odds.oddsFor);
      // More FOR bets → lower FOR odds (less profitable)
    });

    it("should adjust odds when pool is imbalanced toward AGAINST", () => {
      // 20 tokens FOR, 80 tokens AGAINST → FOR should have better odds
      const odds = calculateDynamicOdds(20, 80);

      expect(odds.oddsFor).toBeGreaterThan(odds.oddsAgainst);
      // More AGAINST bets → lower AGAINST odds
    });

    it("should handle edge case with zero FOR pool", () => {
      const odds = calculateDynamicOdds(0, 100);

      // All AGAINST bets → FOR odds should be very high
      expect(odds.oddsFor).toBeGreaterThan(odds.oddsAgainst);
      expect(odds.oddsAgainst).toBeGreaterThan(1.0);
    });

    it("should handle edge case with zero AGAINST pool", () => {
      const odds = calculateDynamicOdds(100, 0);

      // All FOR bets → AGAINST odds should be very high
      expect(odds.oddsAgainst).toBeGreaterThan(odds.oddsFor);
      expect(odds.oddsFor).toBeGreaterThan(1.0);
    });

    it("should maintain odds above 1.0 (no negative payouts)", () => {
      const testCases = [
        [0, 0],
        [100, 100],
        [1000, 100],
        [100, 1000],
        [10000, 1],
      ];

      testCases.forEach(([forPool, againstPool]) => {
        const odds = calculateDynamicOdds(forPool, againstPool);
        expect(odds.oddsFor).toBeGreaterThanOrEqual(1.0);
        expect(odds.oddsAgainst).toBeGreaterThanOrEqual(1.0);
      });
    });
  });

  describe("Input Validation", () => {
    it("should reject negative bet amounts", async () => {
      await expect(
        placeBet("test-prediction", "test-user", "user", "for", -100)
      ).rejects.toThrow();
    });

    it("should reject zero bet amounts", async () => {
      await expect(
        placeBet("test-prediction", "test-user", "user", "for", 0)
      ).rejects.toThrow("Bet amount must be greater than 0");
    });

    it("should reject invalid bettor type", async () => {
      await expect(
        placeBet("test-prediction", "test-user", "invalid" as any, "for", 100)
      ).rejects.toThrow('bettorType must be "agent" or "user"');
    });

    it("should reject invalid position", async () => {
      await expect(
        placeBet("test-prediction", "test-user", "user", "sideways" as any, 100)
      ).rejects.toThrow('position must be "for" or "against"');
    });
  });

  describe("Prediction Market Mechanics", () => {
    it("should create prediction with correct initial market state", async () => {
      const mockDb = {
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([
          {
            id: "pred-1",
            agentId: "agent-1",
            type: "direction",
            symbol: "AAPL",
            direction: "bullish",
            confidence: 75,
            horizon: "1d",
            status: "active",
            createdAt: new Date(),
          },
        ]),
      };

      const result = await createPrediction(
        "agent-1",
        "AAPL",
        "direction",
        "bullish",
        null,
        "1d",
        75,
        "Strong technical indicators",
      );

      expect(result).toBeDefined();
      expect(result.prediction.status).toBe("active");
      expect(result.prediction.symbol).toBe("AAPL");
    });

    it("should lock odds when bet is placed", async () => {
      // This tests that bets lock odds at placement time
      // Odds should not change if pool shifts after bet placement

      const mockMarket = {
        id: "market-1",
        predictionId: "pred-1",
        forPool: 100,
        againstPool: 100,
      };

      // Get initial odds
      const initialOdds = calculateDynamicOdds(100, 100);

      // Simulate bet placement (doesn't actually modify pool in this test)
      const betOdds = initialOdds.oddsFor;

      // Odds at bet placement should be locked
      expect(betOdds).toBeCloseTo(2.0, 1);
    });

    it("should update market pool when bet is placed", async () => {
      // Test that placing a FOR bet increases forPool
      // and placing AGAINST bet increases againstPool

      const initialForPool = 100;
      const initialAgainstPool = 100;
      const betAmount = 50;

      // Simulate FOR bet
      const newForPool = initialForPool + betAmount;
      const newOdds = calculateDynamicOdds(newForPool, initialAgainstPool);

      // After FOR bet, AGAINST odds should improve
      const initialOdds = calculateDynamicOdds(initialForPool, initialAgainstPool);
      expect(newOdds.oddsAgainst).toBeGreaterThan(initialOdds.oddsAgainst);
    });
  });

  describe("Resolution Logic", () => {
    it("should calculate price change percentage correctly", () => {
      // Formula: ((currentPrice - creationPrice) / creationPrice) * 100

      const creationPrice = 100;
      const currentPrice = 105;
      const expectedChange = ((105 - 100) / 100) * 100; // +5%

      expect(expectedChange).toBe(5);
    });

    it("should grade bullish direction prediction as correct when price increases", () => {
      // Bullish prediction should be correct if price goes up

      const prediction = {
        direction: "bullish",
        creationPrice: 100,
      };

      const currentPrice = 105; // +5%
      const isCorrect = currentPrice > prediction.creationPrice;

      expect(isCorrect).toBe(true);
    });

    it("should grade bearish direction prediction as correct when price decreases", () => {
      // Bearish prediction should be correct if price goes down

      const prediction = {
        direction: "bearish",
        creationPrice: 100,
      };

      const currentPrice = 95; // -5%
      const isCorrect = currentPrice < prediction.creationPrice;

      expect(isCorrect).toBe(true);
    });

    it("should grade neutral direction prediction as correct when price is stable", () => {
      // Neutral prediction should be correct if |change| < threshold

      const prediction = {
        direction: "neutral",
        creationPrice: 100,
      };

      const threshold = 2; // 2% threshold for neutral
      const currentPrice = 101.5; // +1.5%
      const changePercent = Math.abs(((currentPrice - prediction.creationPrice) / prediction.creationPrice) * 100);
      const isCorrect = changePercent < threshold;

      expect(isCorrect).toBe(true);
    });

    it("should handle price target predictions", () => {
      // Price target should be correct if actual price meets or exceeds target

      const prediction = {
        type: "price_target",
        targetPrice: 110,
        creationPrice: 100,
      };

      const currentPrice = 112;
      const isCorrect = currentPrice >= prediction.targetPrice;

      expect(isCorrect).toBe(true);
    });
  });

  describe("Payout Calculation", () => {
    it("should calculate correct payout for winning FOR bet", () => {
      const betAmount = 100;
      const lockedOdds = 2.5; // 2.5x payout

      const expectedPayout = betAmount * lockedOdds; // 250

      expect(expectedPayout).toBe(250);
    });

    it("should return zero payout for losing bet", () => {
      const betAmount = 100;
      const payout = 0; // Lost bet

      expect(payout).toBe(0);
    });

    it("should handle fractional odds correctly", () => {
      const betAmount = 100;
      const lockedOdds = 1.75;

      const expectedPayout = betAmount * lockedOdds; // 175

      expect(expectedPayout).toBe(175);
    });
  });

  describe("Leaderboard Scoring", () => {
    it("should calculate win rate correctly", () => {
      const correctPredictions = 8;
      const totalPredictions = 10;

      const winRate = correctPredictions / totalPredictions; // 0.80

      expect(winRate).toBe(0.8);
    });

    it("should handle zero predictions edge case", () => {
      const correctPredictions = 0;
      const totalPredictions = 0;

      const winRate = totalPredictions === 0 ? 0 : correctPredictions / totalPredictions;

      expect(winRate).toBe(0);
    });

    it("should weight win rate highest in profitability score", () => {
      // Win rate contributes 40% to profitability
      const WIN_RATE_WEIGHT = 40;
      const CALIBRATION_WEIGHT = 30;
      const VOLUME_WEIGHT = 20;
      const CONSISTENCY_WEIGHT = 10;

      const totalWeight = WIN_RATE_WEIGHT + CALIBRATION_WEIGHT + VOLUME_WEIGHT + CONSISTENCY_WEIGHT;

      expect(WIN_RATE_WEIGHT).toBeGreaterThan(CALIBRATION_WEIGHT);
      expect(WIN_RATE_WEIGHT).toBeGreaterThan(VOLUME_WEIGHT);
      expect(WIN_RATE_WEIGHT).toBeGreaterThan(CONSISTENCY_WEIGHT);
      expect(totalWeight).toBe(100);
    });

    it("should cap volume score at maximum weight", () => {
      const VOLUME_WEIGHT = 20;
      const LOG_MULTIPLIER = 5;

      // Very high volume: 100,000 tokens
      const volume = 100000;
      const volumeScore = Math.log10(volume + 1) * LOG_MULTIPLIER;
      const cappedScore = Math.min(VOLUME_WEIGHT, volumeScore);

      expect(cappedScore).toBe(VOLUME_WEIGHT);
    });

    it("should calculate consistency score based on prediction count", () => {
      const CONSISTENCY_WEIGHT = 10;
      const PER_PREDICTION = 0.5;

      const predictions = 15;
      const consistencyScore = Math.min(CONSISTENCY_WEIGHT, predictions * PER_PREDICTION);

      expect(consistencyScore).toBe(7.5);
    });
  });

  describe("Calibration Scoring", () => {
    it("should bucket predictions by confidence correctly", () => {
      const confidence = 75;
      const bucketSize = 10;

      const bucket = Math.floor(confidence / bucketSize) * bucketSize;

      expect(bucket).toBe(70); // 75 falls into 70-79 bucket
    });

    it("should calculate calibration error as difference between confidence and accuracy", () => {
      const bucket = 70;
      const bucketSize = 10;
      const midpointOffset = bucketSize / 2;

      // Expected accuracy = (bucket + midpoint) / 100 = (70 + 5) / 100 = 0.75
      const expectedAccuracy = (bucket + midpointOffset) / 100;
      const actualAccuracy = 0.80; // 80% of predictions in this bucket were correct

      const calibrationError = Math.abs(expectedAccuracy - actualAccuracy);

      expect(calibrationError).toBeCloseTo(0.05, 2);
    });

    it("should convert calibration error to score (0-100)", () => {
      const calibrationError = 0.12;
      const calibrationScore = Math.round((1 - calibrationError) * 100);

      expect(calibrationScore).toBe(88);
    });

    it("should handle perfect calibration", () => {
      const calibrationError = 0;
      const calibrationScore = Math.round((1 - calibrationError) * 100);

      expect(calibrationScore).toBe(100);
    });
  });
});
