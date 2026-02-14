/**
 * Agent Strategy Genome (v17)
 *
 * Deep behavioral DNA profiling that goes beyond surface-level metrics.
 * Builds a multi-dimensional "genome" for each agent that captures:
 *
 * 1. Risk Appetite Gene — How much risk the agent actually takes vs claims
 * 2. Conviction Gene — Relationship between confidence and position sizing
 * 3. Adaptability Gene — How quickly the agent changes behavior after losses
 * 4. Contrarianism Gene — How often the agent bucks consensus
 * 5. Information Processing Gene — How well the agent uses available data
 * 6. Temporal Awareness Gene — Short-term vs long-term thinking patterns
 * 7. Emotional Regulation Gene — Stability under volatility
 * 8. Learning Rate Gene — Speed of behavioral improvement over time
 *
 * Each gene is scored 0-1 with a descriptive phenotype classification.
 * The genome enables researchers to compare agent "personalities" across
 * different LLM providers in a quantitative, reproducible way.
 */

import { clamp, cosineSimilarity, countWords, weightedSum, countByCondition, avgOfProperty } from "../lib/math-utils.ts";
import { GENOME_WEIGHTS_ARRAY, GENE_SCORING_WEIGHTS } from "../lib/scoring-weights.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Gene Classification Thresholds
 * Used to filter/validate observations before scoring
 */
const HIGH_CONFIDENCE_THRESHOLD = 0.7; // Confidence > 70% = high confidence trade
const CONFIDENCE_CHANGE_THRESHOLD = 0.1; // |Δconf| > 10% = significant change (adaptability)

/**
 * Phenotype Mid-Thresholds (Low-to-Moderate Classification)
 * Lower boundary for moderate phenotype (below = low phenotype)
 */
const RISK_APPETITE_MID = 0.4; // Score > 0.4 = moderate risk appetite (vs cautious)
const CONVICTION_MID = 0.4; // Score > 0.4 = moderate conviction (vs inconsistent)
const ADAPTABILITY_MID = 0.3; // Score > 0.3 = semi-adaptive (vs rigid)
const CONTRARIANISM_MID = 0.3; // Score > 0.3 = independent (vs conformist)
const INFO_PROCESSING_MID = 0.4; // Score > 0.4 = moderate processor (vs shallow)
const TEMPORAL_AWARENESS_MID = 0.3; // Score > 0.3 = occasionally temporal (vs time-blind)
const EMOTIONAL_REGULATION_MID = 0.3; // Score > 0.3 = semi-regulated (vs volatile)
const LEARNING_RATE_MID = 0.4; // Score > 0.4 = slow learner (vs static)

/**
 * Phenotype High-Thresholds (Moderate-to-High Classification)
 * Upper boundary for moderate phenotype (above = high phenotype)
 */
const RISK_APPETITE_HIGH = 0.7; // Score > 0.7 = aggressive (vs moderate)
const CONVICTION_HIGH = 0.65; // Score > 0.65 = high conviction (vs moderate, slightly stricter)
const ADAPTABILITY_HIGH = 0.6; // Score > 0.6 = adaptive (vs semi-adaptive)
const CONTRARIANISM_HIGH = 0.6; // Score > 0.6 = contrarian (vs independent)
const INFO_PROCESSING_HIGH = 0.7; // Score > 0.7 = deep processor (vs moderate)
const TEMPORAL_AWARENESS_HIGH = 0.6; // Score > 0.6 = temporally aware (vs occasionally)
const EMOTIONAL_REGULATION_HIGH = 0.6; // Score > 0.6 = regulated (vs semi-regulated)
const LEARNING_RATE_HIGH = 0.6; // Score > 0.6 = fast learner (vs slow)

/**
 * Observation Minimums
 * Minimum sample sizes required for reliable gene scoring
 */
const CONVICTION_MIN_OBS = 3; // Need 3+ non-hold trades for confidence-quantity correlation
const ADAPTABILITY_MIN_OBS = 5; // Need 5+ trades with outcomes to measure adaptation
const CONTRARIANISM_MIN_OBS = 3; // Need 3+ trades with consensus data
const LEARNING_RATE_MIN_OBS = 10; // Need 10+ trades for first-half vs second-half comparison
const EMOTIONAL_REGULATION_MIN_OBS = 5; // Need 5+ trades for confidence stability calculation
const UPDATE_FREQUENCY = 5; // Recompute genome every N observations
const EARLY_UPDATE_THRESHOLD = 10; // Also update when observations < N (rapid early profiling)

/**
 * Calculation Parameters
 * Constants used in genome computation and comparison logic
 */
const GENOME_STABILITY_DEFAULT = 0.5; // Default stability when no previous genome exists
const GENOME_STABILITY_FALLBACK = 0.5; // Fallback when cosine similarity = 0 (rare edge case)
const LEARNING_SCORE_MULTIPLIER = 2.0; // Amplifies coherence improvement: score = 0.5 + improvement * 2
const DIVERGENCE_THRESHOLD = 0.2; // |ΔScore| > 0.2 between agents = divergent gene
const MAX_OBSERVATIONS = 300; // Maximum observations stored per agent (circular buffer)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Gene {
  name: string;
  score: number;
  phenotype: string;
  evidence: string[];
  sampleSize: number;
}

export interface StrategyGenome {
  agentId: string;
  genes: Gene[];
  genomeHash: string; // Deterministic hash for comparison
  similarity: Record<string, number>; // Cosine similarity to other agents
  dominantPhenotype: string;
  genomeStability: number; // How stable the genome is over time (0-1)
  lastUpdated: string;
  tradesSampled: number;
}

export interface GenomeComparison {
  agentA: string;
  agentB: string;
  cosineSimilarity: number;
  divergentGenes: { gene: string; deltaA: number; deltaB: number }[];
  convergentGenes: { gene: string; avgScore: number }[];
  summary: string;
}

interface TradeObservation {
  agentId: string;
  action: string;
  symbol: string;
  quantity: number;
  confidence: number;
  coherenceScore: number;
  hallucinationCount: number;
  intent: string;
  reasoning: string;
  roundId: string;
  consensusAction: string | null; // What did majority do?
  marketVolatility: number;
  pnlAfter: number | null;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const observations = new Map<string, TradeObservation[]>();
const genomes = new Map<string, StrategyGenome>();

// ---------------------------------------------------------------------------
// Gene scoring functions
// ---------------------------------------------------------------------------

/**
 * Classifies a 0-1 score into phenotype categories using thresholds.
 * @param score - Numeric score from 0 to 1
 * @param lowLabel - Label for scores below midThreshold
 * @param midLabel - Label for scores between midThreshold and highThreshold
 * @param highLabel - Label for scores above highThreshold
 * @param midThreshold - Cutoff for low/mid (e.g., 0.4)
 * @param highThreshold - Cutoff for mid/high (e.g., 0.7)
 * @returns Phenotype label string
 */
function classifyPhenotype(
  score: number,
  lowLabel: string,
  midLabel: string,
  highLabel: string,
  midThreshold: number,
  highThreshold: number,
): string {
  if (score > highThreshold) return highLabel;
  if (score > midThreshold) return midLabel;
  return lowLabel;
}

function scoreRiskAppetite(obs: TradeObservation[]): Gene {
  const nonHold = obs.filter((o) => o.action !== "hold");
  const holdRate = 1 - (nonHold.length / Math.max(1, obs.length));
  const avgQuantity = nonHold.length > 0 ? nonHold.reduce((s, o) => s + o.quantity, 0) / nonHold.length : 0;
  const highConfTrades = countByCondition(nonHold, (o) => o.confidence > HIGH_CONFIDENCE_THRESHOLD);

  // Higher = more risk-taking
  const score = Math.min(1,
    (1 - holdRate) * GENE_SCORING_WEIGHTS.risk_appetite.hold_rate_inverse +
    Math.min(1, avgQuantity / 2000) * GENE_SCORING_WEIGHTS.risk_appetite.avg_trade_size +
    (highConfTrades / Math.max(1, nonHold.length)) * GENE_SCORING_WEIGHTS.risk_appetite.high_conf_trades,
  );

  const evidence: string[] = [];
  evidence.push(`Hold rate: ${(holdRate * 100).toFixed(0)}%`);
  evidence.push(`Avg trade size: ${avgQuantity.toFixed(0)}`);
  evidence.push(`High-confidence trades: ${highConfTrades}/${nonHold.length}`);

  const phenotype = classifyPhenotype(score, "cautious", "moderate", "aggressive", RISK_APPETITE_MID, RISK_APPETITE_HIGH);

  return { name: "risk_appetite", score, phenotype, evidence, sampleSize: obs.length };
}

function scoreConviction(obs: TradeObservation[]): Gene {
  const nonHold = obs.filter((o) => o.action !== "hold");
  if (nonHold.length < CONVICTION_MIN_OBS) {
    return { name: "conviction", score: 0.5, phenotype: "undetermined", evidence: ["Insufficient data"], sampleSize: nonHold.length };
  }

  // Measure confidence-quantity correlation
  const pairs = nonHold.map((o) => ({ conf: o.confidence, qty: o.quantity }));
  const avgConf = pairs.reduce((s, p) => s + p.conf, 0) / pairs.length;
  const avgQty = pairs.reduce((s, p) => s + p.qty, 0) / pairs.length;

  let numerator = 0;
  let denomConf = 0;
  let denomQty = 0;
  for (const p of pairs) {
    const dc = p.conf - avgConf;
    const dq = p.qty - avgQty;
    numerator += dc * dq;
    denomConf += dc * dc;
    denomQty += dq * dq;
  }
  const correlation = (denomConf > 0 && denomQty > 0) ? numerator / (Math.sqrt(denomConf) * Math.sqrt(denomQty)) : 0;

  // Positive correlation = high conviction (puts money where mouth is)
  const score = clamp((correlation + 1) / 2, 0, 1);

  const evidence: string[] = [];
  evidence.push(`Confidence-size correlation: ${correlation.toFixed(3)}`);
  evidence.push(`Avg confidence: ${(avgConf * 100).toFixed(0)}%`);

  const phenotype = classifyPhenotype(score, "inconsistent", "moderate_conviction", "high_conviction", CONVICTION_MID, CONVICTION_HIGH);

  return { name: "conviction", score, phenotype, evidence, sampleSize: nonHold.length };
}

function scoreAdaptability(obs: TradeObservation[]): Gene {
  // Look for behavior changes after losses
  const withOutcome = obs.filter((o) => o.pnlAfter !== null);
  if (withOutcome.length < ADAPTABILITY_MIN_OBS) {
    return { name: "adaptability", score: 0.5, phenotype: "undetermined", evidence: ["Insufficient outcome data"], sampleSize: withOutcome.length };
  }

  let behaviorChanges = 0;
  let opportunitiesToAdapt = 0;

  for (let i = 1; i < withOutcome.length; i++) {
    const prev = withOutcome[i - 1];
    const curr = withOutcome[i];

    if (prev.pnlAfter !== null && prev.pnlAfter < 0) {
      opportunitiesToAdapt++;
      // Did the agent change something?
      const changedAction = curr.action !== prev.action;
      const changedConfidence = Math.abs(curr.confidence - prev.confidence) > CONFIDENCE_CHANGE_THRESHOLD;
      const changedIntent = curr.intent !== prev.intent;
      if (changedAction || changedConfidence || changedIntent) {
        behaviorChanges++;
      }
    }
  }

  const score = opportunitiesToAdapt > 0 ? behaviorChanges / opportunitiesToAdapt : 0.5;

  const evidence: string[] = [];
  evidence.push(`Behavior changes after loss: ${behaviorChanges}/${opportunitiesToAdapt}`);
  evidence.push(`Adaptation rate: ${(score * 100).toFixed(0)}%`);

  const phenotype = classifyPhenotype(score, "rigid", "semi_adaptive", "adaptive", ADAPTABILITY_MID, ADAPTABILITY_HIGH);

  return { name: "adaptability", score, phenotype, evidence, sampleSize: withOutcome.length };
}

function scoreContrarianism(obs: TradeObservation[]): Gene {
  const withConsensus = obs.filter((o) => o.consensusAction !== null && o.action !== "hold");
  if (withConsensus.length < CONTRARIANISM_MIN_OBS) {
    return { name: "contrarianism", score: 0.5, phenotype: "undetermined", evidence: ["Insufficient consensus data"], sampleSize: withConsensus.length };
  }

  const contrarian = countByCondition(withConsensus, (o) => o.action !== o.consensusAction);
  const score = contrarian / withConsensus.length;

  const evidence: string[] = [];
  evidence.push(`Went against consensus: ${contrarian}/${withConsensus.length}`);
  evidence.push(`Contrarian rate: ${(score * 100).toFixed(0)}%`);

  const phenotype = classifyPhenotype(score, "conformist", "independent", "contrarian", CONTRARIANISM_MID, CONTRARIANISM_HIGH);

  return { name: "contrarianism", score, phenotype, evidence, sampleSize: withConsensus.length };
}

function scoreInformationProcessing(obs: TradeObservation[]): Gene {
  // How well does reasoning quality correlate with outcomes?
  const avgCoherence = obs.reduce((s, o) => s + o.coherenceScore, 0) / Math.max(1, obs.length);
  const hallRate = countByCondition(obs, (o) => o.hallucinationCount > 0) / Math.max(1, obs.length);
  const avgReasoningLength = obs.reduce((s, o) => s + countWords(o.reasoning), 0) / Math.max(1, obs.length);

  const score = Math.min(1,
    avgCoherence * GENE_SCORING_WEIGHTS.information_processing.avg_coherence +
    (1 - hallRate) * GENE_SCORING_WEIGHTS.information_processing.hallucination_free +
    Math.min(1, avgReasoningLength / 100) * GENE_SCORING_WEIGHTS.information_processing.reasoning_length,
  );

  const evidence: string[] = [];
  evidence.push(`Avg coherence: ${avgCoherence.toFixed(2)}`);
  evidence.push(`Hallucination rate: ${(hallRate * 100).toFixed(0)}%`);
  evidence.push(`Avg reasoning length: ${avgReasoningLength.toFixed(0)} words`);

  const phenotype = classifyPhenotype(score, "shallow_processor", "moderate_processor", "deep_processor", INFO_PROCESSING_MID, INFO_PROCESSING_HIGH);

  return { name: "information_processing", score, phenotype, evidence, sampleSize: obs.length };
}

function scoreTemporalAwareness(obs: TradeObservation[]): Gene {
  // Detect temporal reasoning markers
  const temporalPatterns = [
    /short[\s-]term/i, /long[\s-]term/i, /near[\s-]term/i,
    /next\s+(week|month|quarter|year)/i, /within\s+\d+\s+(day|week|hour)/i,
    /holding\s+period/i, /time\s+horizon/i, /temporary|transient/i,
    /sustainable|structural/i, /cycle|seasonal/i,
  ];

  let temporalMentions = 0;
  for (const o of obs) {
    for (const pattern of temporalPatterns) {
      if (pattern.test(o.reasoning)) {
        temporalMentions++;
        break;
      }
    }
  }

  const score = Math.min(1, temporalMentions / Math.max(1, obs.length));

  const evidence: string[] = [];
  evidence.push(`Temporal reasoning mentions: ${temporalMentions}/${obs.length} trades`);

  const phenotype = classifyPhenotype(score, "time_blind", "occasionally_temporal", "temporally_aware", TEMPORAL_AWARENESS_MID, TEMPORAL_AWARENESS_HIGH);

  return { name: "temporal_awareness", score, phenotype, evidence, sampleSize: obs.length };
}

function scoreEmotionalRegulation(obs: TradeObservation[]): Gene {
  // Measure confidence stability under market volatility
  if (obs.length < EMOTIONAL_REGULATION_MIN_OBS) {
    return { name: "emotional_regulation", score: 0.5, phenotype: "undetermined", evidence: ["Insufficient data"], sampleSize: obs.length };
  }

  const confStdDev = Math.sqrt(
    obs.reduce((s, o) => {
      const avg = obs.reduce((ss, oo) => ss + oo.confidence, 0) / obs.length;
      return s + (o.confidence - avg) ** 2;
    }, 0) / obs.length,
  );

  // Lower std dev = more regulated
  const score = Math.max(0, 1 - confStdDev * 3);

  const evidence: string[] = [];
  evidence.push(`Confidence std dev: ${confStdDev.toFixed(3)}`);

  const phenotype = classifyPhenotype(score, "volatile", "semi_regulated", "regulated", EMOTIONAL_REGULATION_MID, EMOTIONAL_REGULATION_HIGH);

  return { name: "emotional_regulation", score, phenotype, evidence, sampleSize: obs.length };
}

function scoreLearningRate(obs: TradeObservation[]): Gene {
  if (obs.length < LEARNING_RATE_MIN_OBS) {
    return { name: "learning_rate", score: 0.5, phenotype: "undetermined", evidence: ["Insufficient data"], sampleSize: obs.length };
  }

  // Compare first half vs second half coherence
  const half = Math.floor(obs.length / 2);
  const firstHalf = obs.slice(0, half);
  const secondHalf = obs.slice(half);

  const firstAvgCoherence = firstHalf.reduce((s, o) => s + o.coherenceScore, 0) / firstHalf.length;
  const secondAvgCoherence = secondHalf.reduce((s, o) => s + o.coherenceScore, 0) / secondHalf.length;

  const improvement = secondAvgCoherence - firstAvgCoherence;
  const score = clamp(GENOME_STABILITY_DEFAULT + improvement * LEARNING_SCORE_MULTIPLIER, 0, 1);

  const evidence: string[] = [];
  evidence.push(`First half coherence: ${firstAvgCoherence.toFixed(3)}`);
  evidence.push(`Second half coherence: ${secondAvgCoherence.toFixed(3)}`);
  evidence.push(`Improvement: ${improvement > 0 ? "+" : ""}${(improvement * 100).toFixed(1)}%`);

  const phenotype = classifyPhenotype(score, "static_learner", "slow_learner", "fast_learner", LEARNING_RATE_MID, LEARNING_RATE_HIGH);

  return { name: "learning_rate", score, phenotype, evidence, sampleSize: obs.length };
}

// ---------------------------------------------------------------------------
// Genome computation
// ---------------------------------------------------------------------------

function computeGenome(agentId: string, obs: TradeObservation[]): StrategyGenome {
  const genes: Gene[] = [
    scoreRiskAppetite(obs),
    scoreConviction(obs),
    scoreAdaptability(obs),
    scoreContrarianism(obs),
    scoreInformationProcessing(obs),
    scoreTemporalAwareness(obs),
    scoreEmotionalRegulation(obs),
    scoreLearningRate(obs),
  ];

  // Compute genome hash for comparison
  const geneVector = genes.map((g) => g.score.toFixed(4)).join(",");
  const genomeHash = geneVector; // Simple string for comparison

  // Find dominant phenotype
  const sorted = [...genes].sort((a, b) => b.score - a.score);
  const dominantPhenotype = `${sorted[0].name}:${sorted[0].phenotype}`;

  // Compute stability
  const prevGenome = genomes.get(agentId);
  let genomeStability = GENOME_STABILITY_DEFAULT;
  if (prevGenome) {
    const prevVector = prevGenome.genes.map((g) => g.score);
    const currVector = genes.map((g) => g.score);
    const similarity = cosineSimilarity(prevVector, currVector);
    genomeStability = similarity !== 0 ? similarity : GENOME_STABILITY_FALLBACK;
  }

  return {
    agentId,
    genes,
    genomeHash,
    similarity: {}, // Filled by cross-comparison
    dominantPhenotype,
    genomeStability,
    lastUpdated: new Date().toISOString(),
    tradesSampled: obs.length,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record a trade observation for genome analysis.
 */
export function recordGenomeObservation(obs: TradeObservation): void {
  const agentObs = observations.get(obs.agentId) ?? [];
  agentObs.push(obs);
  if (agentObs.length > MAX_OBSERVATIONS) agentObs.splice(0, agentObs.length - MAX_OBSERVATIONS);
  observations.set(obs.agentId, agentObs);

  // Recompute genome every N observations
  if (agentObs.length % UPDATE_FREQUENCY === 0 || agentObs.length < EARLY_UPDATE_THRESHOLD) {
    const genome = computeGenome(obs.agentId, agentObs);

    // Cross-similarity with other agents
    for (const [otherId, otherGenome] of genomes.entries()) {
      if (otherId === obs.agentId) continue;
      const sim = cosineSimilarity(
        genome.genes.map((g) => g.score),
        otherGenome.genes.map((g) => g.score),
      );
      genome.similarity[otherId] = sim;
      otherGenome.similarity[obs.agentId] = sim;
    }

    genomes.set(obs.agentId, genome);
  }
}

/**
 * Get the genome for a specific agent.
 */
export function getAgentGenome(agentId: string): StrategyGenome | null {
  return genomes.get(agentId) ?? null;
}

/**
 * Get all agent genomes.
 */
export function getAllGenomes(): StrategyGenome[] {
  return [...genomes.values()];
}

/**
 * Compare two agents' genomes.
 */
export function compareGenomes(agentA: string, agentB: string): GenomeComparison | null {
  const genA = genomes.get(agentA);
  const genB = genomes.get(agentB);
  if (!genA || !genB) return null;

  const sim = cosineSimilarity(
    genA.genes.map((g) => g.score),
    genB.genes.map((g) => g.score),
  );

  const divergent: GenomeComparison["divergentGenes"] = [];
  const convergent: GenomeComparison["convergentGenes"] = [];

  for (let i = 0; i < genA.genes.length; i++) {
    const delta = Math.abs(genA.genes[i].score - genB.genes[i].score);
    if (delta > DIVERGENCE_THRESHOLD) {
      divergent.push({ gene: genA.genes[i].name, deltaA: genA.genes[i].score, deltaB: genB.genes[i].score });
    } else {
      convergent.push({ gene: genA.genes[i].name, avgScore: (genA.genes[i].score + genB.genes[i].score) / 2 });
    }
  }

  const summary = divergent.length === 0
    ? `${agentA} and ${agentB} have very similar strategy genomes (similarity: ${(sim * 100).toFixed(0)}%)`
    : `${agentA} and ${agentB} diverge on ${divergent.length} gene(s): ${divergent.map((d) => d.gene).join(", ")} (similarity: ${(sim * 100).toFixed(0)}%)`;

  return { agentA, agentB, cosineSimilarity: sim, divergentGenes: divergent, convergentGenes: convergent, summary };
}

/**
 * Get genome-based aggregate score for v17 pillar.
 */
export function getGenomePillarScore(agentId: string): number {
  const genome = genomes.get(agentId);
  if (!genome) return 0.5;
  // Weighted average of gene scores (weights imported from scoring-weights.ts)
  const scores = genome.genes.map(g => g.score);
  return weightedSum(scores, GENOME_WEIGHTS_ARRAY);
}
