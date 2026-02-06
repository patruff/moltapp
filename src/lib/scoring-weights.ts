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

/**
 * Adaptive Quality Gate Component Weights (3 dimensions, sum = 1.00)
 *
 * Maps quality gate dimensions to their contribution to composite pass/fail score.
 * Used in adaptive-quality-gate.ts for trade-level reasoning validation.
 *
 * Design rationale:
 * - Coherence (40%): Highest weight because logical soundness is the foundation of
 *   valid reasoning. Incoherent reasoning cannot be salvaged by other dimensions.
 * - Hallucination-Free (30%): Critical for factual accuracy. Unfounded claims erode
 *   agent credibility and lead to poor decisions.
 * - Discipline (30%): Ensures agents follow structural requirements (tool usage,
 *   signal independence, confidence calibration). Prevents shortcuts and gaming.
 *
 * Array order: [coherence, hallucination_free, discipline]
 */
export const ADAPTIVE_GATE_WEIGHTS = {
  coherence: 0.4, // Highest: logical soundness is foundational
  hallucination_free: 0.3,
  discipline: 0.3,
} as const;

/**
 * Convert adaptive gate weights to array in canonical dimension order.
 * Use this for weighted averaging in assessReasoningQuality().
 */
export const ADAPTIVE_GATE_WEIGHTS_ARRAY = [
  ADAPTIVE_GATE_WEIGHTS.coherence,
  ADAPTIVE_GATE_WEIGHTS.hallucination_free,
  ADAPTIVE_GATE_WEIGHTS.discipline,
] as const;

/**
 * Originality Analysis Component Weights (3 dimensions, sum = 1.00)
 *
 * Maps originality metrics to their contribution to uniqueness score.
 * Used in reasoning-forensic-engine.ts to detect templated vs genuine reasoning.
 *
 * Design rationale:
 * - Jaccard Similarity (40%): Primary indicator of copy-paste behavior. High overlap
 *   with previous reasoning indicates template reuse without adaptation.
 * - Unique N-Grams (40%): Measures novel phrase construction. Agents with diverse
 *   vocabulary demonstrate deeper engagement with each decision context.
 * - Template Probability (20%): Lower weight because it's derived from Jaccard.
 *   Provides additional signal but less independent information.
 *
 * Array order: [jaccard_inverse, unique_ngrams, template_inverse]
 */
export const ORIGINALITY_ANALYSIS_WEIGHTS = {
  jaccard_inverse: 0.4, // (1 - jaccardSimilarity)
  unique_ngrams: 0.4,
  template_inverse: 0.2, // (1 - templateProbability)
} as const;

/**
 * Convert originality analysis weights to array in canonical dimension order.
 * Use this for weighted averaging in analyzeOriginality().
 */
export const ORIGINALITY_WEIGHTS_ARRAY = [
  ORIGINALITY_ANALYSIS_WEIGHTS.jaccard_inverse,
  ORIGINALITY_ANALYSIS_WEIGHTS.unique_ngrams,
  ORIGINALITY_ANALYSIS_WEIGHTS.template_inverse,
] as const;

/**
 * Gene Scoring Component Weights (used across multiple genes)
 *
 * Common weight patterns used in agent-strategy-genome.ts for scoring individual genes.
 * Different genes combine different metrics, but these patterns recur:
 *
 * Risk Appetite (0.4, 0.3, 0.3):
 *   - Hold rate inverse (40%): Primary risk indicator
 *   - Average trade size (30%): Normalized to $2000 baseline
 *   - High-confidence trades ratio (30%): >70% confidence threshold
 *
 * Information Processing (0.4, 0.3, 0.3):
 *   - Average coherence (40%): Reasoning quality primary
 *   - Hallucination-free rate (30%): Factual accuracy
 *   - Reasoning length (30%): Normalized to 100 words baseline
 */
export const GENE_SCORING_WEIGHTS = {
  // Risk Appetite gene weights
  risk_appetite: {
    hold_rate_inverse: 0.4, // (1 - holdRate)
    avg_trade_size: 0.3,
    high_conf_trades: 0.3,
  },
  // Information Processing gene weights
  information_processing: {
    avg_coherence: 0.4,
    hallucination_free: 0.3,
    reasoning_length: 0.3,
  },
} as const;

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
validateWeights(ADAPTIVE_GATE_WEIGHTS_ARRAY, "ADAPTIVE_GATE_WEIGHTS");
validateWeights(ORIGINALITY_WEIGHTS_ARRAY, "ORIGINALITY_ANALYSIS_WEIGHTS");
