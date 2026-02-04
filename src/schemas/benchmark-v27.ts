/**
 * Benchmark v27 Zod Validation Schemas
 *
 * Defines the 14-dimension benchmark scoring model for v27.
 * New dimensions added over v26:
 * - Execution Quality: validates trade execution planning and slippage awareness
 * - Cross-Round Learning: validates that agents learn and adapt from past trades
 *
 * All dimension scores are normalized to 0-1, with a composite score on 0-100.
 */

import { z } from "zod";

/**
 * Execution Quality validation schema.
 * Validates that trade reasoning addresses execution concerns.
 */
export const executionQualitySchema = z.object({
  slippageAwareness: z.number().min(0).max(1),
  priceRealism: z.number().min(0).max(1),
  timingRationale: z.number().min(0).max(1),
  executionPlanQuality: z.number().min(0).max(1),
  marketImpactAwareness: z.number().min(0).max(1),
  executionQualityScore: z.number().min(0).max(1),
});

export type ExecutionQuality = z.infer<typeof executionQualitySchema>;

/**
 * Cross-Round Learning validation schema.
 * Validates that agents demonstrate learning from past trades.
 */
export const crossRoundLearningSchema = z.object({
  referencedPastTrades: z.number().int().min(0),
  lessonApplication: z.number().min(0).max(1),
  mistakeRepetition: z.number().min(0).max(1),
  strategyAdaptation: z.number().min(0).max(1),
  outcomeIntegration: z.number().min(0).max(1),
  reasoningEvolution: z.number().min(0).max(1),
  learningScore: z.number().min(0).max(1),
  previousRoundIds: z.array(z.string()),
});

export type CrossRoundLearning = z.infer<typeof crossRoundLearningSchema>;

/**
 * v27 14-dimension composite score schema.
 */
export const v27CompositeSchema = z.object({
  pnl: z.number().min(0).max(1),
  coherence: z.number().min(0).max(1),
  hallucinationFree: z.number().min(0).max(1),
  discipline: z.number().min(0).max(1),
  calibration: z.number().min(0).max(1),
  predictionAccuracy: z.number().min(0).max(1),
  reasoningDepth: z.number().min(0).max(1),
  sourceQuality: z.number().min(0).max(1),
  outcomePrediction: z.number().min(0).max(1),
  consensusIntelligence: z.number().min(0).max(1),
  strategyGenome: z.number().min(0).max(1),
  riskRewardDiscipline: z.number().min(0).max(1),
  executionQuality: z.number().min(0).max(1),
  crossRoundLearning: z.number().min(0).max(1),
  composite: z.number().min(0).max(100),
  grade: z.enum(["S", "A+", "A", "B+", "B", "C", "D", "F"]),
});

export type V27Composite = z.infer<typeof v27CompositeSchema>;

/** All 14 benchmark dimensions with metadata */
export const V27_DIMENSIONS = [
  { key: "pnl", name: "Profitability", weight: 12, category: "performance", description: "Portfolio returns relative to market" },
  { key: "coherence", name: "Reasoning Coherence", weight: 10, category: "reasoning", description: "Does reasoning logically support the action?" },
  { key: "hallucinationFree", name: "Hallucination-Free", weight: 8, category: "safety", description: "Absence of fabricated market data" },
  { key: "discipline", name: "Instruction Discipline", weight: 8, category: "reliability", description: "Compliance with trading rules and limits" },
  { key: "calibration", name: "Confidence Calibration", weight: 7, category: "reliability", description: "Correlation between confidence and outcomes" },
  { key: "predictionAccuracy", name: "Prediction Accuracy", weight: 7, category: "performance", description: "Accuracy of predicted outcomes" },
  { key: "reasoningDepth", name: "Reasoning Depth", weight: 7, category: "reasoning", description: "Thoroughness of analytical process" },
  { key: "sourceQuality", name: "Source Quality", weight: 6, category: "reasoning", description: "Quality and diversity of data sources cited" },
  { key: "outcomePrediction", name: "Outcome Prediction", weight: 6, category: "performance", description: "Quality of future outcome predictions" },
  { key: "consensusIntelligence", name: "Consensus Intelligence", weight: 5, category: "social", description: "Awareness and response to other agents" },
  { key: "strategyGenome", name: "Strategy Consistency", weight: 6, category: "strategy", description: "Consistency with declared trading style" },
  { key: "riskRewardDiscipline", name: "Risk-Reward Discipline", weight: 6, category: "risk", description: "Proper risk-reward assessment and sizing" },
  { key: "executionQuality", name: "Execution Quality", weight: 6, category: "execution", description: "Trade execution planning and awareness" },
  { key: "crossRoundLearning", name: "Cross-Round Learning", weight: 6, category: "learning", description: "Learning and adaptation from past trades" },
] as const;

export type V27DimensionKey = typeof V27_DIMENSIONS[number]["key"];
