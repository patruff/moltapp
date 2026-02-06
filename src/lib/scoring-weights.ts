/**
 * Centralized scoring weights for agent evaluation systems.
 *
 * This module defines the relative importance of different evaluation dimensions
 * across MoltApp's agent assessment systems. All weights are normalized (sum to 1.0).
 */

/**
 * Genome Pillar Weights (8 genes, sum = 1.00)
 *
 * Maps behavioral genes to their relative contribution to overall agent strategy profile.
 * These weights reflect the empirical importance of each trait in predicting agent performance.
 *
 * Design rationale:
 * - Information Processing (20%): Highest weight because agents that fail to ground decisions
 *   in actual market data consistently underperform regardless of other traits
 * - Conviction + Adaptability (15% each): Core decision-making traits that balance commitment
 *   with flexibility
 * - Risk Appetite, Contrarianism, Temporal, Emotional, Learning (10% each): Supporting traits
 *   that modulate behavior but are less predictive in isolation
 *
 * Array order matches gene sequence: [risk_appetite, conviction, adaptability, contrarianism,
 * information_processing, temporal_awareness, emotional_regulation, learning_rate]
 */
export const GENOME_PILLAR_WEIGHTS = {
  risk_appetite: 0.10,
  conviction: 0.15,
  adaptability: 0.15,
  contrarianism: 0.10,
  information_processing: 0.20, // Highest: data-grounded decisions critical for performance
  temporal_awareness: 0.10,
  emotional_regulation: 0.10,
  learning_rate: 0.10,
} as const;

/**
 * Convert genome pillar weights to array in canonical gene order.
 * Use this for weighted averaging in getGenomePillarScore().
 */
export const GENOME_WEIGHTS_ARRAY = [
  GENOME_PILLAR_WEIGHTS.risk_appetite,
  GENOME_PILLAR_WEIGHTS.conviction,
  GENOME_PILLAR_WEIGHTS.adaptability,
  GENOME_PILLAR_WEIGHTS.contrarianism,
  GENOME_PILLAR_WEIGHTS.information_processing,
  GENOME_PILLAR_WEIGHTS.temporal_awareness,
  GENOME_PILLAR_WEIGHTS.emotional_regulation,
  GENOME_PILLAR_WEIGHTS.learning_rate,
] as const;

/**
 * Reasoning Quality Certification Weights (5 dimensions, sum = 1.00)
 *
 * Maps reasoning quality dimensions to their contribution to overall certification score.
 * These weights prioritize data grounding and structural soundness over subjective factors.
 *
 * Design rationale:
 * - Data Grounding (25%): Highest weight because unfounded claims are the #1 cause of
 *   reasoning failures. Agents must cite actual tool calls.
 * - Structural Completeness, Logical Soundness, Actionability (20% each): Core dimensions
 *   that ensure reasoning is complete, coherent, and executable
 * - Epistemic Honesty (15%): Important for calibration but less critical than data grounding
 *   since overconfidence is detectable post-hoc
 *
 * Array order matches dimension sequence: [structural_completeness, data_grounding,
 * logical_soundness, epistemic_honesty, actionability]
 */
export const CERTIFICATION_PILLAR_WEIGHTS = {
  structural_completeness: 0.20,
  data_grounding: 0.25, // Highest: unfounded claims = #1 reasoning failure mode
  logical_soundness: 0.20,
  epistemic_honesty: 0.15,
  actionability: 0.20,
} as const;

/**
 * Convert certification pillar weights to array in canonical dimension order.
 * Use this for weighted averaging in certifyReasoning().
 */
export const CERTIFICATION_WEIGHTS_ARRAY = [
  CERTIFICATION_PILLAR_WEIGHTS.structural_completeness,
  CERTIFICATION_PILLAR_WEIGHTS.data_grounding,
  CERTIFICATION_PILLAR_WEIGHTS.logical_soundness,
  CERTIFICATION_PILLAR_WEIGHTS.epistemic_honesty,
  CERTIFICATION_PILLAR_WEIGHTS.actionability,
] as const;

// Type safety: ensure weights sum to 1.0 (allow for floating point rounding)
const validateWeights = (weights: readonly number[], name: string) => {
  const sum = weights.reduce((acc, w) => acc + w, 0);
  const tolerance = 0.0001;
  if (Math.abs(sum - 1.0) > tolerance) {
    throw new Error(`${name} weights sum to ${sum.toFixed(4)}, expected 1.0`);
  }
};

// Validate at module load time
validateWeights(GENOME_WEIGHTS_ARRAY, "GENOME_PILLAR_WEIGHTS");
validateWeights(CERTIFICATION_WEIGHTS_ARRAY, "CERTIFICATION_PILLAR_WEIGHTS");
