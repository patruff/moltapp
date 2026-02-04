/**
 * Reasoning Taxonomy Classifier v12
 *
 * Classifies agent reasoning into a structured taxonomy that enables
 * cross-model comparison and research. This is the "species identification"
 * system for AI trading reasoning — what TYPE of thinking is happening?
 *
 * Taxonomy Levels:
 * 1. PRIMARY STRATEGY — value, momentum, contrarian, etc.
 * 2. ANALYTICAL METHOD — fundamental, technical, quantitative, narrative
 * 3. REASONING STRUCTURE — deductive, inductive, abductive, analogical
 * 4. EVIDENCE TYPE — quantitative, qualitative, mixed, anecdotal
 * 5. DECISION FRAMEWORK — threshold-based, comparative, risk-adjusted, conviction
 * 6. COGNITIVE PATTERNS — anchoring, recency, confirmation, loss-aversion, etc.
 *
 * The taxonomy enables researchers to:
 * - Compare how different LLMs reason about the same data
 * - Identify which reasoning patterns correlate with good outcomes
 * - Detect cognitive biases in AI trading agents
 * - Build structured datasets for reasoning quality research
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaxonomyClassification {
  /** Primary trading strategy identified */
  strategy: StrategyClass;
  /** Analytical method used */
  analyticalMethod: AnalyticalMethod;
  /** Structure of the reasoning */
  reasoningStructure: ReasoningStructure;
  /** Type of evidence cited */
  evidenceType: EvidenceType;
  /** Decision-making framework */
  decisionFramework: DecisionFramework;
  /** Cognitive patterns detected (potential biases) */
  cognitivePatterns: CognitivePattern[];
  /** Sophistication level 1-5 */
  sophisticationLevel: number;
  /** Key analytical themes extracted */
  themes: string[];
  /** Overall taxonomy fingerprint (compact string representation) */
  fingerprint: string;
  /** Classification confidence */
  classificationConfidence: number;
}

export type StrategyClass =
  | "value_investing"
  | "momentum_trading"
  | "mean_reversion"
  | "contrarian"
  | "growth_investing"
  | "risk_management"
  | "index_tracking"
  | "event_driven"
  | "technical_pattern"
  | "portfolio_rebalancing";

export type AnalyticalMethod =
  | "fundamental"
  | "technical"
  | "quantitative"
  | "narrative"
  | "comparative"
  | "mixed";

export type ReasoningStructure =
  | "deductive"    // If X, then Y. X is true, therefore Y.
  | "inductive"    // Pattern observation → generalization
  | "abductive"    // Best explanation for observed data
  | "analogical"   // Similar to past situation X
  | "rule_based"   // Following predefined rules
  | "mixed";

export type EvidenceType =
  | "quantitative"   // Numbers, percentages, ratios
  | "qualitative"    // Narrative assessment
  | "mixed"
  | "anecdotal";     // Vague or unsupported claims

export type DecisionFramework =
  | "threshold_based"   // "Above X% I buy"
  | "comparative"       // "Better than alternatives"
  | "risk_adjusted"     // "Risk-reward ratio is favorable"
  | "conviction_based"  // "I strongly believe..."
  | "rule_following"    // "My rules say to..."
  | "mixed";

export interface CognitivePattern {
  type: CognitivePatternType;
  evidence: string;
  severity: "low" | "medium" | "high";
}

export type CognitivePatternType =
  | "anchoring_bias"        // Over-weighting a single data point
  | "recency_bias"          // Over-weighting recent events
  | "confirmation_bias"     // Seeking data that confirms existing belief
  | "loss_aversion"         // Disproportionate fear of losses
  | "overconfidence"        // Confidence exceeds evidence quality
  | "herd_mentality"        // Following what others do
  | "sunk_cost_fallacy"     // Holding losers because of past investment
  | "gambler_fallacy"       // Expecting reversion without evidence
  | "availability_bias"     // Relying on easily recalled information
  | "framing_effect";       // Decision depends on how data is presented

// ---------------------------------------------------------------------------
// Strategy Classification
// ---------------------------------------------------------------------------

const STRATEGY_PATTERNS: Array<{ pattern: RegExp; strategy: StrategyClass; weight: number }> = [
  { pattern: /\bundervalued\b|\bintrinsic\s+value\b|\bmargin\s+of\s+safety\b|\bfundamental\s+strength\b|\bP\/E\b|\bearnings\b.*\bcheap\b/i, strategy: "value_investing", weight: 1.0 },
  { pattern: /\bmomentum\b|\btrend\b|\bbreakout\b|\brally\b|\bpositive\s+momentum\b|\bcontinuing\s+to\s+rise\b/i, strategy: "momentum_trading", weight: 1.0 },
  { pattern: /\bmean\s+reversion\b|\boversold\b|\bbounce\b|\bpullback\b|\brevert/i, strategy: "mean_reversion", weight: 1.0 },
  { pattern: /\bcontrarian\b|\bagainst\s+the\s+crowd\b|\boverreact/i, strategy: "contrarian", weight: 1.0 },
  { pattern: /\bgrowth\b|\bexpand/i, strategy: "growth_investing", weight: 0.6 },
  { pattern: /\brisk\s+manag/i, strategy: "risk_management", weight: 0.8 },
  { pattern: /\bindex\b|\bSPY\b|\bQQQ\b|\btrack/i, strategy: "index_tracking", weight: 0.5 },
  { pattern: /\bevent\b|\bcatalyst\b|\bannouncement\b|\bearnings\s+report\b/i, strategy: "event_driven", weight: 0.8 },
  { pattern: /\bpattern\b|\bsupport\b|\bresistance\b|\bchannel\b|\bMACD\b|\bRSI\b/i, strategy: "technical_pattern", weight: 0.9 },
  { pattern: /\brebalanc/i, strategy: "portfolio_rebalancing", weight: 0.9 },
];

function classifyStrategy(reasoning: string): StrategyClass {
  let bestStrategy: StrategyClass = "value_investing";
  let bestScore = 0;

  for (const { pattern, strategy, weight } of STRATEGY_PATTERNS) {
    const matches = (reasoning.match(pattern) ?? []).length;
    const score = matches * weight;
    if (score > bestScore) {
      bestScore = score;
      bestStrategy = strategy;
    }
  }

  return bestStrategy;
}

// ---------------------------------------------------------------------------
// Analytical Method Classification
// ---------------------------------------------------------------------------

function classifyAnalyticalMethod(reasoning: string): AnalyticalMethod {
  const fundamental = /\bearnings\b|\brevenue\b|\bP\/E\b|\bfundamental\b|\bbalance\s+sheet\b|\bmargin\b|\bvaluation\b/i.test(reasoning);
  const technical = /\btechnical\b|\bRSI\b|\bMACD\b|\bmoving\s+average\b|\bsupport\b|\bresistance\b|\bchart\b|\bpattern\b/i.test(reasoning);
  const quantitative = /\d+\.?\d*%/.test(reasoning) && /\$\d+/.test(reasoning);
  const narrative = /\bbelieve\b|\bfeel\b|\bsense\b|\bintuition\b|\bnarrative\b/i.test(reasoning);

  const count = [fundamental, technical, quantitative, narrative].filter(Boolean).length;

  if (count >= 2) return "mixed";
  if (fundamental) return "fundamental";
  if (technical) return "technical";
  if (quantitative) return "quantitative";
  if (narrative) return "narrative";
  return "mixed";
}

// ---------------------------------------------------------------------------
// Reasoning Structure Classification
// ---------------------------------------------------------------------------

function classifyReasoningStructure(reasoning: string): ReasoningStructure {
  // Deductive: If-then, therefore, implies, must
  if (/\bif\b.*\bthen\b|\btherefore\b|\bimplies\b|\bmust\s+be\b|\bconsequently\b/i.test(reasoning)) {
    return "deductive";
  }

  // Inductive: Pattern-based, historically, tends to, based on past
  if (/\bhistorically\b|\btends\s+to\b|\bpattern\b|\bbased\s+on\s+past\b|\busually\b/i.test(reasoning)) {
    return "inductive";
  }

  // Abductive: Best explanation, likely because, suggests that
  if (/\blikely\s+because\b|\bbest\s+explanation\b|\bsuggests\s+that\b|\bprobably\b/i.test(reasoning)) {
    return "abductive";
  }

  // Analogical: Similar to, like when, reminds me of
  if (/\bsimilar\s+to\b|\blike\s+when\b|\breminds\b|\banalog/i.test(reasoning)) {
    return "analogical";
  }

  // Rule-based: My rules, limits say, threshold, policy
  if (/\bmy\s+rules?\b|\blimit\b|\bthreshold\b|\bpolicy\b|\bguardrail\b/i.test(reasoning)) {
    return "rule_based";
  }

  return "mixed";
}

// ---------------------------------------------------------------------------
// Evidence Type Classification
// ---------------------------------------------------------------------------

function classifyEvidenceType(reasoning: string): EvidenceType {
  const quantPatterns = (reasoning.match(/\d+\.?\d*%|\$\d+\.?\d*|\d+\.\d{2,}/g) ?? []).length;
  const qualPatterns = (reasoning.match(/\bfeel\b|\bsense\b|\bappear\b|\bseem\b/gi) ?? []).length;

  if (quantPatterns >= 3 && qualPatterns <= 1) return "quantitative";
  if (quantPatterns >= 1 && qualPatterns >= 1) return "mixed";
  if (qualPatterns >= 2 && quantPatterns === 0) return "qualitative";
  if (quantPatterns === 0 && qualPatterns === 0) return "anecdotal";
  return "mixed";
}

// ---------------------------------------------------------------------------
// Decision Framework Classification
// ---------------------------------------------------------------------------

function classifyDecisionFramework(reasoning: string): DecisionFramework {
  if (/\babove\b.*%|\bbelow\b.*%|\bexceeds\b|\bthreshold\b|\bcriteria\b/i.test(reasoning)) return "threshold_based";
  if (/\bcompared\s+to\b|\brelative\b|\bversus\b|\bbetter\s+than\b/i.test(reasoning)) return "comparative";
  if (/\brisk.?reward\b|\brisk.?adjusted\b|\bSharpe\b|\bdownside\s+protection\b/i.test(reasoning)) return "risk_adjusted";
  if (/\bstrongly\s+believe\b|\bconviction\b|\bhigh\s+confidence\b|\bcertain\b/i.test(reasoning)) return "conviction_based";
  if (/\brule\b|\bpolicy\b|\balways\b|\bnever\b|\bguardrail\b/i.test(reasoning)) return "rule_following";
  return "mixed";
}

// ---------------------------------------------------------------------------
// Cognitive Pattern Detection
// ---------------------------------------------------------------------------

const COGNITIVE_PATTERN_DETECTORS: Array<{
  type: CognitivePatternType;
  pattern: RegExp;
  severity: "low" | "medium" | "high";
}> = [
  { type: "anchoring_bias", pattern: /\bthe\s+key\s+(number|price|level)\b|\banchored\s+to\b|\bfocusing\s+on\s+the\s+\$?\d/i, severity: "low" },
  { type: "recency_bias", pattern: /\bjust\s+(yesterday|today|recently)\b.*\b(therefore|so|hence)\b/i, severity: "medium" },
  { type: "confirmation_bias", pattern: /\b(as\s+I\s+expected|confirms\s+my|validates\s+my|as\s+predicted)\b/i, severity: "medium" },
  { type: "loss_aversion", pattern: /\bcan't\s+afford\s+to\s+lose\b|\bavoid\s+losses?\s+at\s+all\s+costs\b|\bnever\s+sell\s+at\s+a\s+loss\b/i, severity: "medium" },
  { type: "overconfidence", pattern: /\bdefinitely\s+will\b|\bguaranteed\b|\bcertain\s+to\b|\bno\s+doubt\b|\bimpossible\s+to\s+fail\b/i, severity: "high" },
  { type: "herd_mentality", pattern: /\beveryone\s+is\s+(buying|selling)\b|\bfollow\s+the\s+(market|crowd)\b|\bpopular\s+opinion\b/i, severity: "low" },
  { type: "sunk_cost_fallacy", pattern: /\balready\s+invested\b|\btoo\s+deep\b|\bcan't\s+sell\s+now\s+after\b/i, severity: "high" },
  { type: "gambler_fallacy", pattern: /\bdue\s+for\s+a\b|\bcan't\s+keep\s+(falling|rising)\s+forever\b|\bhas\s+to\s+reverse\b/i, severity: "medium" },
  { type: "availability_bias", pattern: /\bremember\s+when\b|\blast\s+time\s+this\s+happened\b|\bI've\s+seen\s+this\s+before\b/i, severity: "low" },
  { type: "framing_effect", pattern: /\bonly\s+\d+%\s+down\b|\bjust\s+a\s+small\s+loss\b|\btiny\s+allocation\b/i, severity: "low" },
];

function detectCognitivePatterns(reasoning: string): CognitivePattern[] {
  const patterns: CognitivePattern[] = [];

  for (const detector of COGNITIVE_PATTERN_DETECTORS) {
    const match = reasoning.match(detector.pattern);
    if (match) {
      patterns.push({
        type: detector.type,
        evidence: match[0],
        severity: detector.severity,
      });
    }
  }

  return patterns;
}

// ---------------------------------------------------------------------------
// Sophistication Level (1-5)
// ---------------------------------------------------------------------------

function computeSophisticationLevel(reasoning: string, method: AnalyticalMethod, structure: ReasoningStructure): number {
  let score = 1; // Base level

  const wordCount = reasoning.split(/\s+/).length;
  if (wordCount >= 100) score++;
  if (wordCount >= 200) score++;

  // Multi-dimensional analysis
  const dimensions = [
    /price|valuation/i, /volume|liquidity/i, /trend|momentum/i,
    /fundamental|earnings/i, /risk|downside/i, /sector|macro/i,
    /catalyst|event/i, /portfolio|allocation/i,
  ];
  const dimCount = dimensions.filter((d) => d.test(reasoning)).length;
  if (dimCount >= 4) score++;
  if (dimCount >= 6) score++;

  // Structured reasoning bonus
  if (structure === "deductive" || method === "quantitative") score = Math.min(5, score + 1);

  // Quantitative rigor
  const numbers = (reasoning.match(/\d+\.?\d*%|\$\d+\.?\d*/g) ?? []).length;
  if (numbers >= 5) score = Math.min(5, score + 1);

  return Math.min(5, Math.max(1, score));
}

// ---------------------------------------------------------------------------
// Theme Extraction
// ---------------------------------------------------------------------------

const THEME_PATTERNS: Array<{ pattern: RegExp; theme: string }> = [
  { pattern: /\bvaluation\b|\bP\/E\b|\bprice.to.earnings\b/i, theme: "valuation" },
  { pattern: /\bgrowth\b|\bexpansion\b|\bscaling\b/i, theme: "growth" },
  { pattern: /\bdividend\b|\byield\b|\bincome\b/i, theme: "income" },
  { pattern: /\bmomentum\b|\btrend\b|\btechnical\b/i, theme: "momentum" },
  { pattern: /\brisk\b|\bvolatility\b|\bdrawdown\b/i, theme: "risk" },
  { pattern: /\bportfolio\b|\ballocation\b|\bdiversif/i, theme: "portfolio" },
  { pattern: /\bmacro\b|\beconomy\b|\bfed\b|\binterest\s+rate\b/i, theme: "macro" },
  { pattern: /\bearnings\b|\brevenue\b|\bprofit\b/i, theme: "earnings" },
  { pattern: /\bnews\b|\bevent\b|\bcatalyst\b/i, theme: "catalyst" },
  { pattern: /\bsentiment\b|\bfear\b|\bgreed\b/i, theme: "sentiment" },
  { pattern: /\bsector\b|\bindustry\b|\bpeer\b/i, theme: "sector" },
  { pattern: /\bliquidity\b|\bvolume\b|\bmarket\s+depth\b/i, theme: "liquidity" },
];

function extractThemes(reasoning: string): string[] {
  return THEME_PATTERNS
    .filter(({ pattern }) => pattern.test(reasoning))
    .map(({ theme }) => theme);
}

// ---------------------------------------------------------------------------
// Fingerprint Generation
// ---------------------------------------------------------------------------

function generateFingerprint(
  strategy: StrategyClass,
  method: AnalyticalMethod,
  structure: ReasoningStructure,
  evidence: EvidenceType,
  framework: DecisionFramework,
  sophistication: number,
): string {
  const stratCode = strategy.slice(0, 3).toUpperCase();
  const methCode = method.slice(0, 3).toUpperCase();
  const structCode = structure.slice(0, 3).toUpperCase();
  const evidCode = evidence.slice(0, 3).toUpperCase();
  const fwCode = framework.slice(0, 3).toUpperCase();

  return `${stratCode}-${methCode}-${structCode}-${evidCode}-${fwCode}-L${sophistication}`;
}

// ---------------------------------------------------------------------------
// Main Classification Function
// ---------------------------------------------------------------------------

/**
 * Classify a trade's reasoning into the full taxonomy.
 * Returns a comprehensive classification useful for:
 * - Cross-model comparison
 * - Bias detection
 * - Reasoning quality assessment
 * - Research dataset labeling
 */
export function classifyReasoning(reasoning: string, action: string): TaxonomyClassification {
  const strategy = classifyStrategy(reasoning);
  const analyticalMethod = classifyAnalyticalMethod(reasoning);
  const reasoningStructure = classifyReasoningStructure(reasoning);
  const evidenceType = classifyEvidenceType(reasoning);
  const decisionFramework = classifyDecisionFramework(reasoning);
  const cognitivePatterns = detectCognitivePatterns(reasoning);
  const sophisticationLevel = computeSophisticationLevel(reasoning, analyticalMethod, reasoningStructure);
  const themes = extractThemes(reasoning);

  const fingerprint = generateFingerprint(
    strategy, analyticalMethod, reasoningStructure,
    evidenceType, decisionFramework, sophisticationLevel,
  );

  // Classification confidence based on signal strength
  const totalSignals = [
    strategy !== "value_investing" ? 1 : 0.5, // Default strategy gets lower confidence
    analyticalMethod !== "mixed" ? 1 : 0.5,
    reasoningStructure !== "mixed" ? 1 : 0.5,
    evidenceType !== "mixed" ? 1 : 0.5,
    decisionFramework !== "mixed" ? 1 : 0.5,
  ].reduce((s, v) => s + v, 0);

  const classificationConfidence = Math.min(1, totalSignals / 5 + (themes.length * 0.05));

  return {
    strategy,
    analyticalMethod,
    reasoningStructure,
    evidenceType,
    decisionFramework,
    cognitivePatterns,
    sophisticationLevel,
    themes,
    fingerprint,
    classificationConfidence: Math.round(classificationConfidence * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// Agent Taxonomy Profile (aggregate over time)
// ---------------------------------------------------------------------------

const agentTaxonomyHistory = new Map<string, TaxonomyClassification[]>();
const MAX_TAXONOMY_HISTORY = 200;

export function recordTaxonomyClassification(agentId: string, classification: TaxonomyClassification): void {
  const history = agentTaxonomyHistory.get(agentId) ?? [];
  history.push(classification);
  if (history.length > MAX_TAXONOMY_HISTORY) {
    history.shift();
  }
  agentTaxonomyHistory.set(agentId, history);
}

export interface AgentTaxonomyProfile {
  agentId: string;
  tradeCount: number;
  /** Most common strategy */
  dominantStrategy: StrategyClass;
  /** Strategy distribution */
  strategyDistribution: Record<string, number>;
  /** Most common analytical method */
  dominantMethod: AnalyticalMethod;
  /** Average sophistication level */
  avgSophistication: number;
  /** Most common cognitive patterns */
  frequentBiases: Array<{ type: CognitivePatternType; frequency: number }>;
  /** Most common themes */
  topThemes: Array<{ theme: string; frequency: number }>;
  /** Fingerprint diversity — how varied is the reasoning? */
  fingerprintDiversity: number;
  /** Average classification confidence */
  avgClassificationConfidence: number;
}

export function getAgentTaxonomyProfile(agentId: string): AgentTaxonomyProfile | null {
  const history = agentTaxonomyHistory.get(agentId);
  if (!history || history.length === 0) return null;

  // Strategy distribution
  const strategyCounts = new Map<string, number>();
  for (const c of history) {
    strategyCounts.set(c.strategy, (strategyCounts.get(c.strategy) ?? 0) + 1);
  }
  const strategyDistribution: Record<string, number> = {};
  for (const [strategy, count] of strategyCounts) {
    strategyDistribution[strategy] = Math.round((count / history.length) * 100) / 100;
  }
  const dominantStrategy = [...strategyCounts.entries()].sort((a, b) => b[1] - a[1])[0]![0] as StrategyClass;

  // Method distribution
  const methodCounts = new Map<string, number>();
  for (const c of history) {
    methodCounts.set(c.analyticalMethod, (methodCounts.get(c.analyticalMethod) ?? 0) + 1);
  }
  const dominantMethod = [...methodCounts.entries()].sort((a, b) => b[1] - a[1])[0]![0] as AnalyticalMethod;

  // Average sophistication
  const avgSophistication = history.reduce((s, c) => s + c.sophisticationLevel, 0) / history.length;

  // Cognitive patterns frequency
  const biasCounts = new Map<CognitivePatternType, number>();
  for (const c of history) {
    for (const p of c.cognitivePatterns) {
      biasCounts.set(p.type, (biasCounts.get(p.type) ?? 0) + 1);
    }
  }
  const frequentBiases = [...biasCounts.entries()]
    .map(([type, count]) => ({ type, frequency: Math.round((count / history.length) * 100) / 100 }))
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 5);

  // Theme frequency
  const themeCounts = new Map<string, number>();
  for (const c of history) {
    for (const t of c.themes) {
      themeCounts.set(t, (themeCounts.get(t) ?? 0) + 1);
    }
  }
  const topThemes = [...themeCounts.entries()]
    .map(([theme, count]) => ({ theme, frequency: Math.round((count / history.length) * 100) / 100 }))
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 8);

  // Fingerprint diversity (unique fingerprints / total)
  const uniqueFingerprints = new Set(history.map((c) => c.fingerprint)).size;
  const fingerprintDiversity = Math.round((uniqueFingerprints / history.length) * 100) / 100;

  const avgClassificationConfidence = Math.round(
    (history.reduce((s, c) => s + c.classificationConfidence, 0) / history.length) * 100,
  ) / 100;

  return {
    agentId,
    tradeCount: history.length,
    dominantStrategy,
    strategyDistribution,
    dominantMethod,
    avgSophistication: Math.round(avgSophistication * 10) / 10,
    frequentBiases,
    topThemes,
    fingerprintDiversity,
    avgClassificationConfidence,
  };
}
