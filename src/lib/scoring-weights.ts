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

/**
 * Reasoning Forensic Analysis Component Weights (5 dimensions, sum = 1.00)
 *
 * Maps forensic analysis dimensions to their contribution to composite reasoning quality score.
 * These weights balance structural soundness, analytical depth, and consistency.
 *
 * Design rationale:
 * - Depth (25%): Highest weight because multi-angle analysis correlates with decision quality.
 *   Agents considering 4+ analytical dimensions (technical + fundamental + sentiment + timing)
 *   consistently outperform those with single-angle reasoning.
 * - Structure (20%): Well-organized reasoning enables better validation and reduces
 *   miscommunication between reasoning and action. Clear structure = verifiable logic.
 * - Originality (20%): Templated reasoning indicates pattern-matching without genuine analysis.
 *   Unique perspectives and novel connections signal actual thinking vs. rote copying.
 * - Cross-Trade Integrity (20%): Flags inconsistencies that suggest either learning (good)
 *   or drift (bad). Tracks whether agent's reasoning evolves coherently over time.
 * - Clarity (15%): Least critical because unclear reasoning can still be parsed with effort.
 *   Readability is supportive, not foundational to quality.
 *
 * Array order matches dimension sequence: [structure, depth, originality, clarity, cross_trade]
 */
export const FORENSIC_COMPONENT_WEIGHTS = {
  structure: 0.20,
  depth: 0.25, // Highest: multi-angle analysis = stronger decisions
  originality: 0.20,
  clarity: 0.15,
  cross_trade: 0.20,
} as const;

/**
 * Convert forensic component weights to array in canonical dimension order.
 * Use this for weighted averaging in analyzeReasoningForensics().
 */
export const FORENSIC_WEIGHTS_ARRAY = [
  FORENSIC_COMPONENT_WEIGHTS.structure,
  FORENSIC_COMPONENT_WEIGHTS.depth,
  FORENSIC_COMPONENT_WEIGHTS.originality,
  FORENSIC_COMPONENT_WEIGHTS.clarity,
  FORENSIC_COMPONENT_WEIGHTS.cross_trade,
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
validateWeights(FORENSIC_WEIGHTS_ARRAY, "FORENSIC_COMPONENT_WEIGHTS");
