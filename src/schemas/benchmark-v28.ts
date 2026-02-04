/**
 * Benchmark v28 Zod Validation Schemas
 *
 * Defines the 16-dimension benchmark scoring model for v28.
 * New dimensions added over v27:
 * - Trade Accountability: validates intellectual honesty about past outcomes
 * - Reasoning Quality Index: validates structural quality of reasoning
 *
 * All dimension scores are normalized to 0-1, with a composite score on 0-100.
 */

import { z } from "zod";

/**
 * Trade Accountability validation schema.
 */
export const tradeAccountabilitySchema = z.object({
  lossAcknowledgment: z.number().min(0).max(1),
  blameAvoidance: z.number().min(0).max(1),
  errorSpecificity: z.number().min(0).max(1),
  correctiveAction: z.number().min(0).max(1),
  selfReportAccuracy: z.number().min(0).max(1),
  intellectualHumility: z.number().min(0).max(1),
  accountabilityScore: z.number().min(0).max(1),
});

export type TradeAccountability = z.infer<typeof tradeAccountabilitySchema>;

/**
 * Reasoning Quality Index validation schema.
 */
export const reasoningQualityIndexSchema = z.object({
  logicalChainLength: z.number().min(0).max(1),
  evidenceDensity: z.number().min(0).max(1),
  counterArgumentQuality: z.number().min(0).max(1),
  conclusionClarity: z.number().min(0).max(1),
  quantitativeRigor: z.number().min(0).max(1),
  conditionalReasoning: z.number().min(0).max(1),
  rqiScore: z.number().min(0).max(1),
  structureBreakdown: z.object({
    claimsFound: z.number().int().min(0),
    evidenceCitations: z.number().int().min(0),
    counterArguments: z.number().int().min(0),
    conditionals: z.number().int().min(0),
    quantifiedClaims: z.number().int().min(0),
    logicalConnectors: z.number().int().min(0),
  }),
});

export type ReasoningQualityIndex = z.infer<typeof reasoningQualityIndexSchema>;

/**
 * v28 16-dimension composite score schema.
 */
export const v28CompositeSchema = z.object({
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
  tradeAccountability: z.number().min(0).max(1),
  reasoningQualityIndex: z.number().min(0).max(1),
  composite: z.number().min(0).max(100),
  grade: z.enum(["S", "A+", "A", "B+", "B", "C", "D", "F"]),
});

export type V28Composite = z.infer<typeof v28CompositeSchema>;

/** All 16 benchmark dimensions with metadata */
export const V28_DIMENSIONS = [
  { key: "pnl", name: "Profitability", weight: 11, category: "performance", description: "Portfolio returns relative to market" },
  { key: "coherence", name: "Reasoning Coherence", weight: 9, category: "reasoning", description: "Does reasoning logically support the action?" },
  { key: "hallucinationFree", name: "Hallucination-Free", weight: 8, category: "safety", description: "Absence of fabricated market data" },
  { key: "discipline", name: "Instruction Discipline", weight: 7, category: "reliability", description: "Compliance with trading rules and limits" },
  { key: "calibration", name: "Confidence Calibration", weight: 7, category: "reliability", description: "Correlation between confidence and outcomes" },
  { key: "predictionAccuracy", name: "Prediction Accuracy", weight: 6, category: "performance", description: "Accuracy of predicted outcomes" },
  { key: "reasoningDepth", name: "Reasoning Depth", weight: 7, category: "reasoning", description: "Thoroughness of analytical process" },
  { key: "sourceQuality", name: "Source Quality", weight: 6, category: "reasoning", description: "Quality and diversity of data sources cited" },
  { key: "outcomePrediction", name: "Outcome Prediction", weight: 5, category: "performance", description: "Quality of future outcome predictions" },
  { key: "consensusIntelligence", name: "Consensus Intelligence", weight: 5, category: "social", description: "Awareness and response to other agents" },
  { key: "strategyGenome", name: "Strategy Consistency", weight: 5, category: "strategy", description: "Consistency with declared trading style" },
  { key: "riskRewardDiscipline", name: "Risk-Reward Discipline", weight: 6, category: "risk", description: "Proper risk-reward assessment and sizing" },
  { key: "executionQuality", name: "Execution Quality", weight: 5, category: "execution", description: "Trade execution planning and awareness" },
  { key: "crossRoundLearning", name: "Cross-Round Learning", weight: 5, category: "learning", description: "Learning and adaptation from past trades" },
  { key: "tradeAccountability", name: "Trade Accountability", weight: 6, category: "integrity", description: "Intellectual honesty about past outcomes and errors" },
  { key: "reasoningQualityIndex", name: "Reasoning Quality Index", weight: 7, category: "reasoning", description: "Structural quality of reasoning: logic chains, evidence density, counterarguments" },
] as const;

export type V28DimensionKey = typeof V28_DIMENSIONS[number]["key"];
