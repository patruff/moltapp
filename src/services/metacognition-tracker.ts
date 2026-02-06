/**
 * Metacognition Tracker (v16)
 *
 * Tracks and scores an AI agent's SELF-AWARENESS — the ability to
 * know what it knows, express appropriate uncertainty, and adapt
 * its behavior based on its own performance history.
 *
 * This is the distinguishing pillar of MoltApp's benchmark:
 * we don't just measure whether agents make money, we measure
 * whether they UNDERSTAND their own reasoning process.
 *
 * Key metrics:
 * - EPISTEMIC HUMILITY: Does the agent acknowledge uncertainty?
 * - CALIBRATION AWARENESS: Does confidence match actual ability?
 * - ERROR RECOGNITION: Does the agent learn from mistakes?
 * - SCOPE LIMITATION: Does the agent stay within its competence?
 * - ADAPTIVE STRATEGY: Does the agent change approach when failing?
 */

import { computeGrade } from "../lib/grade-calculator.ts";
import { round3 } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MetacognitionEvent {
  agentId: string;
  roundId: string;
  timestamp: string;

  // Reasoning analysis
  reasoning: string;
  action: "buy" | "sell" | "hold";
  symbol: string;
  confidence: number;
  intent: string;

  // Outcomes (filled later)
  coherenceScore: number;
  wasCorrect?: boolean;

  // Metacognition markers
  hedgeCount: number;
  uncertaintyExpressions: string[];
  selfReferences: string[];
  limitationAcknowledgements: string[];
  conditionalsCount: number;
}

export interface MetacognitionReport {
  agentId: string;
  tradeCount: number;
  lastUpdated: string;

  // Composite scores
  overallScore: number;
  grade: string;

  // Dimension scores
  epistemicHumility: number;
  calibrationAwareness: number;
  errorRecognition: number;
  scopeLimitation: number;
  adaptiveStrategy: number;

  // Detailed breakdowns
  humilityEvidence: HumilityBreakdown;
  calibrationEvidence: CalibrationBreakdown;
  errorEvidence: ErrorBreakdown;
  scopeEvidence: ScopeBreakdown;
  adaptationEvidence: AdaptationBreakdown;

  // Trend
  trend: "improving" | "stable" | "declining";
  trendDetail: string;
}

export interface HumilityBreakdown {
  avgHedgeCount: number;
  uncertaintyRate: number;
  conditionalRate: number;
  examples: string[];
}

export interface CalibrationBreakdown {
  highConfidenceAccuracy: number;
  lowConfidenceAccuracy: number;
  calibrationGap: number;
  overconfidenceRate: number;
}

export interface ErrorBreakdown {
  afterErrorActionChange: number;
  afterErrorConfidenceAdjust: number;
  repeatMistakeRate: number;
}

export interface ScopeBreakdown {
  limitationMentionRate: number;
  topSymbols: string[];
  symbolConcentration: number;
}

export interface AdaptationBreakdown {
  intentChangeAfterLoss: number;
  confidenceAdaptation: number;
  strategyDiversity: number;
}

// ---------------------------------------------------------------------------
// In-memory event storage
// ---------------------------------------------------------------------------

const agentEvents = new Map<string, MetacognitionEvent[]>();
const MAX_EVENTS = 300;

// Uncertainty expression patterns
const UNCERTAINTY_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bI('m|\s+am)\s+not\s+(entirely\s+)?sure\b/i, label: "explicit uncertainty" },
  { pattern: /\buncertain(?:ty)?\b/i, label: "uncertainty marker" },
  { pattern: /\bhard\s+to\s+(?:say|predict|tell)\b/i, label: "difficulty acknowledgement" },
  { pattern: /\blimited\s+(?:data|information|visibility)\b/i, label: "data limitation" },
  { pattern: /\binsufficient\s+(?:evidence|data)\b/i, label: "evidence gap" },
  { pattern: /\bcould\s+go\s+either\s+way\b/i, label: "ambiguity acknowledgement" },
  { pattern: /\bmixed\s+signals?\b/i, label: "conflicting data" },
  { pattern: /\bnot\s+(?:fully\s+)?convinced\b/i, label: "doubt expression" },
  { pattern: /\bconfidence\s+is\s+(?:low|moderate|limited)\b/i, label: "explicit low confidence" },
  { pattern: /\bdifficult\s+(?:market|conditions|environment)\b/i, label: "environment difficulty" },
];

// Self-reference patterns (shows introspection)
const SELF_REFERENCE_PATTERNS: RegExp[] = [
  /\b(?:my|I)\s+(?:analysis|view|assessment|opinion|thesis|strategy)\b/i,
  /\b(?:my|I)\s+(?:previous|earlier|last)\s+(?:trade|decision|position)\b/i,
  /\b(?:I|my)\s+(?:was|were)\s+(?:wrong|incorrect|mistaken)\b/i,
  /\b(?:I|my)\s+(?:should\s+have|could\s+have)\b/i,
  /\b(?:adjusting|revising|updating)\s+my\b/i,
  /\blearned\s+(?:from|that)\b/i,
  /\b(?:my|I)\s+(?:bias|tendency|pattern)\b/i,
];

// Limitation acknowledgement patterns
const LIMITATION_PATTERNS: RegExp[] = [
  /\b(?:I\s+)?(?:can'?t|cannot|don'?t)\s+(?:predict|know|see|determine)\b/i,
  /\bbeyond\s+(?:my|the)\s+(?:ability|scope|capacity)\b/i,
  /\bnot\s+enough\s+(?:data|information|evidence)\b/i,
  /\bno\s+clear\s+(?:signal|trend|direction|catalyst)\b/i,
  /\black(?:ing)?\s+(?:of\s+)?(?:clarity|certainty|conviction)\b/i,
  /\bwithout\s+(?:more|additional|further)\s+(?:data|information)\b/i,
];

// Conditional patterns
const CONDITIONAL_PATTERNS: RegExp[] = [
  /\bif\s+.+(?:then|,)\b/i,
  /\bunless\b/i,
  /\bprovided\s+that\b/i,
  /\bassuming\b/i,
  /\bcontingent\s+(?:on|upon)\b/i,
  /\bshould\s+.+(?:then|,)\b/i,
  /\bin\s+case\b/i,
  /\bdepending\s+on\b/i,
];

// ---------------------------------------------------------------------------
// Event Recording
// ---------------------------------------------------------------------------

/**
 * Record a metacognition event from a trade decision.
 */
export function recordMetacognitionEvent(event: Omit<MetacognitionEvent, "hedgeCount" | "uncertaintyExpressions" | "selfReferences" | "limitationAcknowledgements" | "conditionalsCount">): MetacognitionEvent {
  const reasoning = event.reasoning;

  // Detect uncertainty expressions
  const uncertaintyExpressions: string[] = [];
  for (const { pattern, label } of UNCERTAINTY_PATTERNS) {
    if (pattern.test(reasoning)) {
      uncertaintyExpressions.push(label);
    }
  }

  // Detect self-references
  const selfReferences: string[] = [];
  for (const pat of SELF_REFERENCE_PATTERNS) {
    const match = reasoning.match(pat);
    if (match) selfReferences.push(match[0]);
  }

  // Detect limitation acknowledgements
  const limitationAcknowledgements: string[] = [];
  for (const pat of LIMITATION_PATTERNS) {
    const match = reasoning.match(pat);
    if (match) limitationAcknowledgements.push(match[0]);
  }

  // Count conditionals
  let conditionalsCount = 0;
  for (const pat of CONDITIONAL_PATTERNS) {
    if (pat.test(reasoning)) conditionalsCount++;
  }

  // Count hedge words
  const hedgePatterns = [
    /\bperhaps\b/i, /\bmaybe\b/i, /\bmight\b/i, /\bcould\b/i,
    /\bpossibly\b/i, /\bprobably\b/i, /\blikely\b/i,
    /\btend\s+to\b/i, /\bgenerally\b/i, /\btypically\b/i,
    /\bsomewhat\b/i, /\bslightly\b/i, /\bapparently\b/i,
  ];
  let hedgeCount = 0;
  for (const pat of hedgePatterns) {
    if (pat.test(reasoning)) hedgeCount++;
  }

  const fullEvent: MetacognitionEvent = {
    ...event,
    hedgeCount,
    uncertaintyExpressions,
    selfReferences,
    limitationAcknowledgements,
    conditionalsCount,
  };

  // Store
  let events = agentEvents.get(event.agentId);
  if (!events) {
    events = [];
    agentEvents.set(event.agentId, events);
  }
  events.push(fullEvent);
  if (events.length > MAX_EVENTS) events.shift();

  return fullEvent;
}

// ---------------------------------------------------------------------------
// Report Generation
// ---------------------------------------------------------------------------


/**
 * Generate a full metacognition report for an agent.
 */
export function generateMetacognitionReport(agentId: string): MetacognitionReport | null {
  const events = agentEvents.get(agentId);
  if (!events || events.length === 0) return null;

  const tradeCount = events.length;

  // 1. EPISTEMIC HUMILITY
  const avgHedge = events.reduce((s, e) => s + e.hedgeCount, 0) / tradeCount;
  const uncertaintyRate = events.filter((e) => e.uncertaintyExpressions.length > 0).length / tradeCount;
  const conditionalRate = events.filter((e) => e.conditionalsCount > 0).length / tradeCount;

  // Good humility: hedge more when confidence is lower
  let humilityScore = 0;
  let appropriateHedging = 0;
  for (const e of events) {
    if ((e.confidence < 0.5 && e.hedgeCount >= 2) || (e.confidence >= 0.7 && e.hedgeCount <= 1)) {
      appropriateHedging++;
    }
  }
  humilityScore = Math.min(1, (appropriateHedging / tradeCount) * 0.5 + uncertaintyRate * 0.3 + conditionalRate * 0.2);

  const humilityEvidence: HumilityBreakdown = {
    avgHedgeCount: Math.round(avgHedge * 100) / 100,
    uncertaintyRate: round3(uncertaintyRate),
    conditionalRate: round3(conditionalRate),
    examples: events
      .flatMap((e) => e.uncertaintyExpressions)
      .slice(0, 5),
  };

  // 2. CALIBRATION AWARENESS
  const withOutcomes = events.filter((e) => e.wasCorrect !== undefined);
  let highConfAcc = 0.5, lowConfAcc = 0.5;
  if (withOutcomes.length >= 5) {
    const highConf = withOutcomes.filter((e) => e.confidence >= 0.7);
    const lowConf = withOutcomes.filter((e) => e.confidence < 0.5);
    highConfAcc = highConf.length > 0 ? highConf.filter((e) => e.wasCorrect).length / highConf.length : 0.5;
    lowConfAcc = lowConf.length > 0 ? lowConf.filter((e) => e.wasCorrect).length / lowConf.length : 0.5;
  }

  const calibrationGap = Math.abs(highConfAcc - lowConfAcc);
  const overconfidenceRate = withOutcomes.length > 0
    ? withOutcomes.filter((e) => e.confidence >= 0.7 && !e.wasCorrect).length / Math.max(1, withOutcomes.filter((e) => e.confidence >= 0.7).length)
    : 0.3;

  // Good calibration: high confidence trades are more accurate than low confidence
  const calibrationScore = highConfAcc > lowConfAcc
    ? Math.min(1, 0.5 + calibrationGap * 2)
    : Math.max(0, 0.5 - calibrationGap);

  const calibrationEvidence: CalibrationBreakdown = {
    highConfidenceAccuracy: round3(highConfAcc),
    lowConfidenceAccuracy: round3(lowConfAcc),
    calibrationGap: round3(calibrationGap),
    overconfidenceRate: round3(overconfidenceRate),
  };

  // 3. ERROR RECOGNITION
  let afterErrorActionChange = 0;
  let afterErrorConfidenceAdjust = 0;
  let repeatMistakes = 0;
  let errorCount = 0;

  for (let i = 1; i < events.length; i++) {
    if (events[i - 1].wasCorrect === false) {
      errorCount++;
      // Did the agent change its action after an error?
      if (events[i].action !== events[i - 1].action) afterErrorActionChange++;
      // Did the agent lower confidence after an error?
      if (events[i].confidence < events[i - 1].confidence) afterErrorConfidenceAdjust++;
      // Did the agent make the same mistake on the same symbol?
      if (events[i].symbol === events[i - 1].symbol && events[i].action === events[i - 1].action) {
        repeatMistakes++;
      }
    }
  }

  const errorRecognition = errorCount > 0
    ? (afterErrorActionChange / errorCount) * 0.4 +
      (afterErrorConfidenceAdjust / errorCount) * 0.3 +
      Math.max(0, 1 - repeatMistakes / errorCount) * 0.3
    : 0.5;

  const errorEvidence: ErrorBreakdown = {
    afterErrorActionChange: errorCount > 0 ? round3(afterErrorActionChange / errorCount) : 0,
    afterErrorConfidenceAdjust: errorCount > 0 ? round3(afterErrorConfidenceAdjust / errorCount) : 0,
    repeatMistakeRate: errorCount > 0 ? round3(repeatMistakes / errorCount) : 0,
  };

  // 4. SCOPE LIMITATION
  const limitMentionRate = events.filter((e) => e.limitationAcknowledgements.length > 0).length / tradeCount;
  const symbolFreq = new Map<string, number>();
  for (const e of events) {
    symbolFreq.set(e.symbol, (symbolFreq.get(e.symbol) ?? 0) + 1);
  }
  const topSymbols = Array.from(symbolFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([s]) => s);

  // Concentration: how focused on few symbols?
  const symbolConcentration = symbolFreq.size > 0
    ? Math.max(...symbolFreq.values()) / tradeCount
    : 0;

  // Good scope: acknowledges limitations + doesn't over-concentrate
  const scopeScore = Math.min(1,
    limitMentionRate * 0.4 +
    (1 - symbolConcentration) * 0.3 +
    Math.min(1, symbolFreq.size / 5) * 0.3,
  );

  const scopeEvidence: ScopeBreakdown = {
    limitationMentionRate: round3(limitMentionRate),
    topSymbols,
    symbolConcentration: round3(symbolConcentration),
  };

  // 5. ADAPTIVE STRATEGY
  const intents = events.map((e) => e.intent);
  const uniqueIntents = new Set(intents);
  const strategyDiversity = Math.min(1, uniqueIntents.size / 4);

  // Did intent change after losses?
  let intentChangeAfterLoss = 0;
  let lossCount = 0;
  for (let i = 1; i < events.length; i++) {
    if (events[i - 1].wasCorrect === false) {
      lossCount++;
      if (events[i].intent !== events[i - 1].intent) intentChangeAfterLoss++;
    }
  }

  // Did confidence adapt to performance?
  const firstHalfConf = events.slice(0, Math.floor(tradeCount / 2)).reduce((s, e) => s + e.confidence, 0);
  const secondHalfConf = events.slice(Math.floor(tradeCount / 2)).reduce((s, e) => s + e.confidence, 0);
  const firstHalfCount = Math.floor(tradeCount / 2) || 1;
  const secondHalfCount = tradeCount - firstHalfCount || 1;
  const confAdaptation = 1 - Math.abs(firstHalfConf / firstHalfCount - secondHalfConf / secondHalfCount);

  const adaptiveStrategy = (
    strategyDiversity * 0.3 +
    (lossCount > 0 ? intentChangeAfterLoss / lossCount : 0.5) * 0.35 +
    Math.max(0, confAdaptation) * 0.35
  );

  const adaptationEvidence: AdaptationBreakdown = {
    intentChangeAfterLoss: lossCount > 0 ? round3(intentChangeAfterLoss / lossCount) : 0,
    confidenceAdaptation: round3(Math.max(0, confAdaptation)),
    strategyDiversity: round3(strategyDiversity),
  };

  // Composite
  const overallScore = (
    humilityScore * 0.25 +
    calibrationScore * 0.25 +
    errorRecognition * 0.20 +
    scopeScore * 0.15 +
    adaptiveStrategy * 0.15
  );

  // Trend: compare first half vs second half metacognition markers
  const firstHalf = events.slice(0, firstHalfCount);
  const secondHalf = events.slice(firstHalfCount);
  const firstHalfMeta = firstHalf.reduce((s, e) => s + e.hedgeCount + e.conditionalsCount, 0) / firstHalfCount;
  const secondHalfMeta = secondHalf.reduce((s, e) => s + e.hedgeCount + e.conditionalsCount, 0) / secondHalfCount;
  const metaDiff = secondHalfMeta - firstHalfMeta;
  const trend = metaDiff > 0.5 ? "improving" : metaDiff < -0.5 ? "declining" : "stable";
  const trendDetail = `Metacognition markers ${trend}: ${firstHalfMeta.toFixed(1)} (early) -> ${secondHalfMeta.toFixed(1)} (recent)`;

  return {
    agentId,
    tradeCount,
    lastUpdated: new Date().toISOString(),
    overallScore: round3(overallScore),
    grade: computeGrade(overallScore),
    epistemicHumility: round3(humilityScore),
    calibrationAwareness: round3(calibrationScore),
    errorRecognition: round3(errorRecognition),
    scopeLimitation: round3(scopeScore),
    adaptiveStrategy: round3(adaptiveStrategy),
    humilityEvidence,
    calibrationEvidence,
    errorEvidence,
    scopeEvidence,
    adaptationEvidence,
    trend,
    trendDetail,
  };
}

/**
 * Get all agent metacognition reports (for leaderboard).
 */
export function getAllMetacognitionReports(): MetacognitionReport[] {
  const reports: MetacognitionReport[] = [];
  for (const agentId of agentEvents.keys()) {
    const report = generateMetacognitionReport(agentId);
    if (report) reports.push(report);
  }
  reports.sort((a, b) => b.overallScore - a.overallScore);
  return reports;
}

/**
 * Compare metacognition between two agents.
 */
export function compareMetacognition(agentAId: string, agentBId: string): {
  reportA: MetacognitionReport | null;
  reportB: MetacognitionReport | null;
  winner: string | null;
  dimensionWins: { [agentId: string]: string[] };
} {
  const reportA = generateMetacognitionReport(agentAId);
  const reportB = generateMetacognitionReport(agentBId);

  if (!reportA || !reportB) {
    return { reportA, reportB, winner: null, dimensionWins: {} };
  }

  const dimensionWins: { [agentId: string]: string[] } = { [agentAId]: [], [agentBId]: [] };

  const dims: [string, number, number][] = [
    ["epistemicHumility", reportA.epistemicHumility, reportB.epistemicHumility],
    ["calibrationAwareness", reportA.calibrationAwareness, reportB.calibrationAwareness],
    ["errorRecognition", reportA.errorRecognition, reportB.errorRecognition],
    ["scopeLimitation", reportA.scopeLimitation, reportB.scopeLimitation],
    ["adaptiveStrategy", reportA.adaptiveStrategy, reportB.adaptiveStrategy],
  ];

  for (const [dim, scoreA, scoreB] of dims) {
    if (scoreA > scoreB + 0.05) dimensionWins[agentAId].push(dim);
    else if (scoreB > scoreA + 0.05) dimensionWins[agentBId].push(dim);
  }

  const winner = reportA.overallScore > reportB.overallScore + 0.02 ? agentAId
    : reportB.overallScore > reportA.overallScore + 0.02 ? agentBId
    : null;

  return { reportA, reportB, winner, dimensionWins };
}
