/**
 * Cross-Agent Reasoning Debate Engine (v19)
 *
 * Structures formal debates between AI agents when they disagree.
 * Unlike simple arbitration (who had better reasoning), debates
 * create a structured argument flow:
 *
 * 1. OPENING STATEMENTS — each agent's initial thesis
 * 2. REBUTTAL ANALYSIS — how each agent's reasoning responds to the other
 * 3. EVIDENCE CLASH — where do the agents cite conflicting data?
 * 4. LOGICAL CHAIN COMPARISON — whose cause-effect chain is stronger?
 * 5. VERDICT — structured scoring of the debate
 *
 * This is the "reasoning transparency" pillar — it makes agent
 * thinking adversarial and testable, not just passively scored.
 */

import { splitSentences, countWords } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DebateRound {
  debateId: string;
  roundId: string;
  symbol: string;
  topic: string;
  participants: DebateParticipant[];
  evidenceClashes: EvidenceClash[];
  logicalChainAnalysis: LogicalChainResult;
  verdict: DebateVerdict;
  debateQualityScore: number;
  timestamp: string;
}

export interface DebateParticipant {
  agentId: string;
  action: string;
  reasoning: string;
  confidence: number;
  thesisStatement: string;
  supportingPoints: string[];
  weaknesses: string[];
  rebuttalStrength: number;
}

export interface EvidenceClash {
  dimension: string;
  agentAClaim: string;
  agentBClaim: string;
  clashType: "contradiction" | "interpretation_diff" | "data_gap" | "emphasis_diff";
  winner: string | "unresolved";
  explanation: string;
}

export interface LogicalChainResult {
  agentAChainLength: number;
  agentBChainLength: number;
  agentAConnectorDensity: number;
  agentBConnectorDensity: number;
  agentACausalClaims: number;
  agentBCausalClaims: number;
  strongerChain: string | "equal";
}

export interface DebateVerdict {
  winner: string | "tie";
  scores: Record<string, DebateScore>;
  margin: number;
  keyFactor: string;
  narrative: string;
}

export interface DebateScore {
  thesisClarity: number;
  evidenceQuality: number;
  logicalStrength: number;
  rebuttalPower: number;
  intellectualHonesty: number;
  composite: number;
}

export interface AgentDebateProfile {
  agentId: string;
  totalDebates: number;
  wins: number;
  losses: number;
  ties: number;
  winRate: number;
  avgScore: number;
  bestDimension: string;
  worstDimension: string;
  avgDebateQuality: number;
  rebuttalWinRate: number;
  evidenceClashWinRate: number;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const debates: DebateRound[] = [];
const MAX_DEBATES = 1500;

// ---------------------------------------------------------------------------
// NLP Helpers
// ---------------------------------------------------------------------------

function extractThesis(reasoning: string): string {
  const sentences = splitSentences(reasoning, 10);
  if (sentences.length === 0) return reasoning.slice(0, 100);

  // The thesis is usually the first actionable sentence
  for (const s of sentences.slice(0, 3)) {
    if (/should|recommend|bullish|bearish|buy|sell|hold|position|undervalued|overvalued/i.test(s)) {
      return s.trim();
    }
  }
  return sentences[0].trim();
}

function extractSupportingPoints(reasoning: string): string[] {
  const points: string[] = [];
  const sentences = splitSentences(reasoning, 15);

  for (const s of sentences) {
    if (/because|due\s+to|driven\s+by|supported\s+by|evidence|data\s+shows/i.test(s)) {
      points.push(s.trim());
    }
  }

  if (points.length === 0) {
    // Fall back to sentences with quantitative claims
    for (const s of sentences) {
      if (/\$[\d,]+|\d+%|\d+\.\d+/i.test(s)) {
        points.push(s.trim());
      }
    }
  }

  return points.slice(0, 5);
}

function extractWeaknesses(reasoning: string): string[] {
  const weaknesses: string[] = [];

  // Check for hedging without substance
  const hedgeCount = (reasoning.match(/\b(perhaps|maybe|might|possibly|could be)\b/gi) ?? []).length;
  const wordCount = countWords(reasoning);
  if (hedgeCount > 3 && wordCount < 100) {
    weaknesses.push("Excessive hedging relative to reasoning length");
  }

  // Check for lack of specificity
  if (!/\$[\d,]+|\d+\.?\d*%/.test(reasoning)) {
    weaknesses.push("No quantitative claims — reasoning is entirely qualitative");
  }

  // Check for circular reasoning
  if (/\bbuy\b.*\bbecause\b.*\bundervalued\b.*\bbuy\b/i.test(reasoning)) {
    weaknesses.push("Potential circular reasoning detected");
  }

  // Check for missing risk acknowledgment
  if (!/risk|downside|cautio|danger|concern|worry|threat/i.test(reasoning)) {
    weaknesses.push("No risk factors acknowledged");
  }

  // Check for templated language
  if (/based on current market conditions|in the current market environment/i.test(reasoning)) {
    weaknesses.push("Templated/boilerplate language detected");
  }

  return weaknesses;
}

function computeRebuttalStrength(ownReasoning: string, opponentReasoning: string): number {
  const ownLower = ownReasoning.toLowerCase();
  const oppLower = opponentReasoning.toLowerCase();

  let score = 0.3; // Base score

  // Does agent address the opponent's key claims?
  const oppKeywords = oppLower.match(/\b\w{5,}\b/g) ?? [];
  const oppUniqueWords = new Set(oppKeywords);
  const addressedCount = [...oppUniqueWords].filter(w => ownLower.includes(w)).length;
  const addressRate = oppUniqueWords.size > 0 ? addressedCount / oppUniqueWords.size : 0;
  score += addressRate * 0.3;

  // Does agent counter with different evidence?
  const ownEvidence = (ownLower.match(/\$[\d,]+|\d+%|P\/E|RSI|MACD|volume/gi) ?? []).length;
  const oppEvidence = (oppLower.match(/\$[\d,]+|\d+%|P\/E|RSI|MACD|volume/gi) ?? []).length;
  if (ownEvidence > oppEvidence) score += 0.15;
  else if (ownEvidence > 0) score += 0.08;

  // Logical connectors = stronger argumentation
  const connectors = (ownLower.match(/\bbecause|therefore|however|nevertheless|despite|although\b/g) ?? []).length;
  score += Math.min(0.2, connectors * 0.04);

  return Math.min(1, Math.round(score * 100) / 100);
}

// ---------------------------------------------------------------------------
// Evidence Clash Detection
// ---------------------------------------------------------------------------

function detectEvidenceClashes(
  reasoningA: string,
  reasoningB: string,
  agentA: string,
  agentB: string,
): EvidenceClash[] {
  const clashes: EvidenceClash[] = [];

  // Sentiment clash
  const aBullish = /bullish|upside|growth|undervalued|buy/i.test(reasoningA);
  const aBearish = /bearish|downside|decline|overvalued|sell/i.test(reasoningA);
  const bBullish = /bullish|upside|growth|undervalued|buy/i.test(reasoningB);
  const bBearish = /bearish|downside|decline|overvalued|sell/i.test(reasoningB);

  if ((aBullish && bBearish) || (aBearish && bBullish)) {
    clashes.push({
      dimension: "directional_sentiment",
      agentAClaim: aBullish ? "Bullish outlook" : "Bearish outlook",
      agentBClaim: bBullish ? "Bullish outlook" : "Bearish outlook",
      clashType: "contradiction",
      winner: "unresolved",
      explanation: "Agents hold opposite directional views on the same stock at the same time",
    });
  }

  // Price interpretation clash
  const aPriceMatch = reasoningA.match(/\$(\d+\.?\d*)/);
  const bPriceMatch = reasoningB.match(/\$(\d+\.?\d*)/);
  if (aPriceMatch && bPriceMatch) {
    const aPrice = parseFloat(aPriceMatch[1]);
    const bPrice = parseFloat(bPriceMatch[1]);
    if (Math.abs(aPrice - bPrice) / Math.max(aPrice, bPrice) > 0.1) {
      clashes.push({
        dimension: "price_reference",
        agentAClaim: `$${aPrice}`,
        agentBClaim: `$${bPrice}`,
        clashType: "data_gap",
        winner: "unresolved",
        explanation: "Agents reference different price points (>10% gap)",
      });
    }
  }

  // Risk assessment clash
  const aHighRisk = /high\s+risk|risky|dangerous|volatile/i.test(reasoningA);
  const aLowRisk = /low\s+risk|safe|stable|minimal\s+risk/i.test(reasoningA);
  const bHighRisk = /high\s+risk|risky|dangerous|volatile/i.test(reasoningB);
  const bLowRisk = /low\s+risk|safe|stable|minimal\s+risk/i.test(reasoningB);

  if ((aHighRisk && bLowRisk) || (aLowRisk && bHighRisk)) {
    clashes.push({
      dimension: "risk_assessment",
      agentAClaim: aHighRisk ? "High risk" : "Low risk",
      agentBClaim: bHighRisk ? "High risk" : "Low risk",
      clashType: "interpretation_diff",
      winner: "unresolved",
      explanation: "Agents disagree on risk level for the same asset",
    });
  }

  // Technical vs Fundamental emphasis
  const aTech = /RSI|MACD|SMA|support|resistance|breakout|moving\s+average/i.test(reasoningA);
  const aFund = /P\/E|earnings|revenue|margin|growth\s+rate|fundamentals/i.test(reasoningA);
  const bTech = /RSI|MACD|SMA|support|resistance|breakout|moving\s+average/i.test(reasoningB);
  const bFund = /P\/E|earnings|revenue|margin|growth\s+rate|fundamentals/i.test(reasoningB);

  if ((aTech && !aFund && bFund && !bTech) || (aFund && !aTech && bTech && !bFund)) {
    clashes.push({
      dimension: "analytical_framework",
      agentAClaim: aTech ? "Technical analysis" : "Fundamental analysis",
      agentBClaim: bTech ? "Technical analysis" : "Fundamental analysis",
      clashType: "emphasis_diff",
      winner: "unresolved",
      explanation: "Agents use different analytical frameworks to reach conclusions",
    });
  }

  return clashes;
}

// ---------------------------------------------------------------------------
// Logical Chain Analysis
// ---------------------------------------------------------------------------

const CAUSAL_CONNECTORS = [
  /\bbecause\b/gi, /\btherefore\b/gi, /\bthus\b/gi,
  /\bhence\b/gi, /\bconsequently\b/gi, /\bas\s+a\s+result\b/gi,
  /\bdue\s+to\b/gi, /\bleading\s+to\b/gi, /\bdriven\s+by\b/gi,
  /\bif\b.{5,30}\bthen\b/gi, /\bgiven\s+that\b/gi,
  /\bsince\b/gi, /\bimplying\b/gi,
];

function analyzeLogicalChain(
  reasoningA: string,
  reasoningB: string,
): LogicalChainResult {
  const sentencesA = splitSentences(reasoningA, 10);
  const sentencesB = splitSentences(reasoningB, 10);

  let connectorsA = 0;
  let connectorsB = 0;
  let causalA = 0;
  let causalB = 0;

  for (const pattern of CAUSAL_CONNECTORS) {
    const matchesA = reasoningA.match(pattern);
    const matchesB = reasoningB.match(pattern);
    if (matchesA) {
      connectorsA += matchesA.length;
      causalA += matchesA.length;
    }
    if (matchesB) {
      connectorsB += matchesB.length;
      causalB += matchesB.length;
    }
  }

  const wordsA = countWords(reasoningA) || 1;
  const wordsB = countWords(reasoningB) || 1;

  const densityA = Math.round((connectorsA / wordsA) * 1000) / 1000;
  const densityB = Math.round((connectorsB / wordsB) * 1000) / 1000;

  let stronger: string | "equal" = "equal";
  const scoreA = causalA * 0.4 + densityA * 100 * 0.3 + sentencesA.length * 0.3;
  const scoreB = causalB * 0.4 + densityB * 100 * 0.3 + sentencesB.length * 0.3;
  if (Math.abs(scoreA - scoreB) > 1) {
    stronger = scoreA > scoreB ? "agentA" : "agentB";
  }

  return {
    agentAChainLength: sentencesA.length,
    agentBChainLength: sentencesB.length,
    agentAConnectorDensity: densityA,
    agentBConnectorDensity: densityB,
    agentACausalClaims: causalA,
    agentBCausalClaims: causalB,
    strongerChain: stronger,
  };
}

// ---------------------------------------------------------------------------
// Core Debate Engine
// ---------------------------------------------------------------------------

function scoreDebateParticipant(
  participant: DebateParticipant,
  opponent: DebateParticipant,
): DebateScore {
  // Thesis clarity: how clear and direct is the opening thesis?
  const thesisWords = countWords(participant.thesisStatement);
  const thesisHasAction = /buy|sell|hold|bullish|bearish/i.test(participant.thesisStatement);
  const thesisClarity = Math.min(1,
    (thesisHasAction ? 0.5 : 0.2) +
    (thesisWords > 5 && thesisWords < 30 ? 0.3 : 0.1) +
    (participant.supportingPoints.length > 0 ? 0.2 : 0)
  );

  // Evidence quality: supporting points with quantitative data
  let evidenceQuality = 0;
  for (const point of participant.supportingPoints) {
    if (/\$[\d,]+|\d+%|P\/E|\d+\.\d+/i.test(point)) evidenceQuality += 0.2;
    else evidenceQuality += 0.08;
  }
  evidenceQuality = Math.min(1, evidenceQuality);

  // Logical strength: causal connectors, structure
  const connectorCount = (participant.reasoning.match(
    /because|therefore|thus|hence|consequently|due to|leading to|given that|since/gi
  ) ?? []).length;
  const logicalStrength = Math.min(1, 0.2 + connectorCount * 0.1);

  // Rebuttal power: how well does the reasoning address opponent's claims
  const rebuttalPower = participant.rebuttalStrength;

  // Intellectual honesty: acknowledges uncertainty and weaknesses
  const hedges = (participant.reasoning.match(/perhaps|maybe|might|uncertain|unclear|risk|however/gi) ?? []).length;
  const totalWords = countWords(participant.reasoning);
  const hedgeRate = totalWords > 0 ? hedges / totalWords : 0;
  // Sweet spot: some hedging is good (0.02-0.05), too much is bad
  const intellectualHonesty = hedgeRate > 0.01 && hedgeRate < 0.06
    ? 0.7 + Math.min(0.3, hedgeRate * 10)
    : hedgeRate > 0.06
      ? Math.max(0.3, 0.7 - (hedgeRate - 0.06) * 10)
      : 0.3 + hedgeRate * 20;

  const composite = Math.round((
    thesisClarity * 0.15 +
    evidenceQuality * 0.30 +
    logicalStrength * 0.25 +
    rebuttalPower * 0.15 +
    intellectualHonesty * 0.15
  ) * 100) / 100;

  return {
    thesisClarity: Math.round(thesisClarity * 100) / 100,
    evidenceQuality: Math.round(evidenceQuality * 100) / 100,
    logicalStrength: Math.round(logicalStrength * 100) / 100,
    rebuttalPower: Math.round(rebuttalPower * 100) / 100,
    intellectualHonesty: Math.round(Math.min(1, intellectualHonesty) * 100) / 100,
    composite,
  };
}

/**
 * Conduct a structured debate between two agents.
 */
export function conductDebate(
  roundId: string,
  symbol: string,
  agentA: string,
  agentB: string,
  actionA: string,
  actionB: string,
  reasoningA: string,
  reasoningB: string,
  confidenceA: number,
  confidenceB: number,
): DebateRound {
  // Build participant profiles
  const participantA: DebateParticipant = {
    agentId: agentA,
    action: actionA,
    reasoning: reasoningA,
    confidence: confidenceA,
    thesisStatement: extractThesis(reasoningA),
    supportingPoints: extractSupportingPoints(reasoningA),
    weaknesses: extractWeaknesses(reasoningA),
    rebuttalStrength: computeRebuttalStrength(reasoningA, reasoningB),
  };

  const participantB: DebateParticipant = {
    agentId: agentB,
    action: actionB,
    reasoning: reasoningB,
    confidence: confidenceB,
    thesisStatement: extractThesis(reasoningB),
    supportingPoints: extractSupportingPoints(reasoningB),
    weaknesses: extractWeaknesses(reasoningB),
    rebuttalStrength: computeRebuttalStrength(reasoningB, reasoningA),
  };

  // Analyze evidence clashes
  const evidenceClashes = detectEvidenceClashes(reasoningA, reasoningB, agentA, agentB);

  // Analyze logical chains
  const logicalChainAnalysis = analyzeLogicalChain(reasoningA, reasoningB);

  // Score each participant
  const scoreA = scoreDebateParticipant(participantA, participantB);
  const scoreB = scoreDebateParticipant(participantB, participantA);

  // Determine verdict
  const diff = scoreA.composite - scoreB.composite;
  const margin = Math.abs(diff);
  const winner = margin < 0.03 ? "tie" : (diff > 0 ? agentA : agentB);

  // Find key differentiating factor
  const dimensionDiffs: [string, number][] = [
    ["thesis clarity", scoreA.thesisClarity - scoreB.thesisClarity],
    ["evidence quality", scoreA.evidenceQuality - scoreB.evidenceQuality],
    ["logical strength", scoreA.logicalStrength - scoreB.logicalStrength],
    ["rebuttal power", scoreA.rebuttalPower - scoreB.rebuttalPower],
    ["intellectual honesty", scoreA.intellectualHonesty - scoreB.intellectualHonesty],
  ];
  dimensionDiffs.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const keyFactor = dimensionDiffs[0][0];

  // Generate narrative
  let narrative: string;
  if (winner === "tie") {
    narrative = `Closely contested debate on ${symbol}. Both agents presented comparable reasoning quality. `;
    narrative += `Key battleground: ${keyFactor}. Evidence clashes: ${evidenceClashes.length}. `;
    narrative += `Logical chains: ${logicalChainAnalysis.strongerChain === "equal" ? "equivalent" : `${logicalChainAnalysis.strongerChain} leads`}.`;
  } else {
    const loser = winner === agentA ? agentB : agentA;
    narrative = `${winner} wins the ${symbol} debate by ${(margin * 100).toFixed(1)}% margin. `;
    narrative += `Decisive factor: ${keyFactor}. `;
    if (evidenceClashes.length > 0) {
      narrative += `${evidenceClashes.length} evidence clash(es) identified. `;
    }
    const winnerWeaknesses = winner === agentA ? participantA.weaknesses : participantB.weaknesses;
    if (winnerWeaknesses.length > 0) {
      narrative += `Winner's weakness: ${winnerWeaknesses[0]}.`;
    }
  }

  // Debate quality = how substantive was this debate?
  const debateQualityScore = Math.round(Math.min(1, (
    (scoreA.composite + scoreB.composite) / 2 * 0.4 +
    Math.min(1, evidenceClashes.length * 0.2) * 0.3 +
    (logicalChainAnalysis.agentACausalClaims + logicalChainAnalysis.agentBCausalClaims > 4 ? 0.3 : 0.15)
  )) * 100) / 100;

  const debate: DebateRound = {
    debateId: `debate_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    roundId,
    symbol,
    topic: `Should agents ${actionA === actionB ? actionA : `${actionA} vs ${actionB}`} ${symbol}?`,
    participants: [participantA, participantB],
    evidenceClashes,
    logicalChainAnalysis,
    verdict: {
      winner,
      scores: { [agentA]: scoreA, [agentB]: scoreB },
      margin: Math.round(margin * 100) / 100,
      keyFactor,
      narrative,
    },
    debateQualityScore,
    timestamp: new Date().toISOString(),
  };

  debates.unshift(debate);
  if (debates.length > MAX_DEBATES) debates.length = MAX_DEBATES;

  return debate;
}

// ---------------------------------------------------------------------------
// Profile Aggregation
// ---------------------------------------------------------------------------

export function getAgentDebateProfile(agentId: string): AgentDebateProfile {
  const agentDebates = debates.filter(d =>
    d.participants.some(p => p.agentId === agentId),
  );

  let wins = 0, losses = 0, ties = 0;
  let scoreSum = 0;
  let qualitySum = 0;
  let rebuttalWins = 0;
  let rebuttalTotal = 0;
  let evidenceWins = 0;
  let evidenceTotal = 0;
  const dimensionSums: Record<string, number> = {
    thesisClarity: 0, evidenceQuality: 0, logicalStrength: 0,
    rebuttalPower: 0, intellectualHonesty: 0,
  };

  for (const d of agentDebates) {
    const score = d.verdict.scores[agentId];
    if (!score) continue;

    scoreSum += score.composite;
    qualitySum += d.debateQualityScore;

    if (d.verdict.winner === "tie") ties++;
    else if (d.verdict.winner === agentId) wins++;
    else losses++;

    for (const dim of Object.keys(dimensionSums)) {
      dimensionSums[dim] += score[dim as keyof DebateScore] as number;
    }

    // Rebuttal comparison
    const participants = d.participants;
    const self = participants.find(p => p.agentId === agentId);
    const opp = participants.find(p => p.agentId !== agentId);
    if (self && opp) {
      rebuttalTotal++;
      if (self.rebuttalStrength > opp.rebuttalStrength) rebuttalWins++;
    }

    // Evidence clash wins
    for (const clash of d.evidenceClashes) {
      evidenceTotal++;
      if (clash.winner === agentId) evidenceWins++;
    }
  }

  const total = agentDebates.length || 1;
  const avgDims: Record<string, number> = {};
  for (const [dim, sum] of Object.entries(dimensionSums)) {
    avgDims[dim] = Math.round((sum / total) * 100) / 100;
  }

  const sortedDims = Object.entries(avgDims).sort((a, b) => b[1] - a[1]);

  return {
    agentId,
    totalDebates: agentDebates.length,
    wins,
    losses,
    ties,
    winRate: agentDebates.length > 0 ? Math.round((wins / agentDebates.length) * 100) / 100 : 0,
    avgScore: Math.round((scoreSum / total) * 100) / 100,
    bestDimension: sortedDims[0]?.[0] ?? "none",
    worstDimension: sortedDims[sortedDims.length - 1]?.[0] ?? "none",
    avgDebateQuality: Math.round((qualitySum / total) * 100) / 100,
    rebuttalWinRate: rebuttalTotal > 0 ? Math.round((rebuttalWins / rebuttalTotal) * 100) / 100 : 0,
    evidenceClashWinRate: evidenceTotal > 0 ? Math.round((evidenceWins / evidenceTotal) * 100) / 100 : 0,
  };
}

export function getAllDebateProfiles(): AgentDebateProfile[] {
  const agentIds = new Set<string>();
  for (const d of debates) {
    for (const p of d.participants) agentIds.add(p.agentId);
  }
  return [...agentIds].map(getAgentDebateProfile);
}

export function getRecentDebates(limit: number = 20): DebateRound[] {
  return debates.slice(0, limit);
}

export function getDebateById(debateId: string): DebateRound | undefined {
  return debates.find(d => d.debateId === debateId);
}

export function getDebatePillarScore(agentId: string): number {
  const profile = getAgentDebateProfile(agentId);
  if (profile.totalDebates === 0) return 0.5;

  return Math.round((
    profile.winRate * 0.30 +
    profile.avgScore * 0.30 +
    profile.rebuttalWinRate * 0.20 +
    profile.avgDebateQuality * 0.20
  ) * 100) / 100;
}

export function getDebateStats(): {
  totalDebates: number;
  avgQuality: number;
  avgMargin: number;
  tieRate: number;
  totalEvidenceClashes: number;
} {
  const totalClashes = debates.reduce((s, d) => s + d.evidenceClashes.length, 0);
  const qualitySum = debates.reduce((s, d) => s + d.debateQualityScore, 0);
  const marginSum = debates.reduce((s, d) => s + d.verdict.margin, 0);
  const ties = debates.filter(d => d.verdict.winner === "tie").length;

  return {
    totalDebates: debates.length,
    avgQuality: debates.length > 0 ? Math.round((qualitySum / debates.length) * 100) / 100 : 0,
    avgMargin: debates.length > 0 ? Math.round((marginSum / debates.length) * 100) / 100 : 0,
    tieRate: debates.length > 0 ? Math.round((ties / debates.length) * 100) / 100 : 0,
    totalEvidenceClashes: totalClashes,
  };
}
