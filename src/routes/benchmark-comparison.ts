/**
 * Live Benchmark Comparison API Routes
 *
 * Real-time head-to-head agent comparisons with statistical rigor.
 * Implements Welch's t-test, Cohen's d effect size, confidence intervals,
 * dominance matrices, and win/loss/draw records between agents.
 *
 * Differentiates MoltApp from simple leaderboards by providing
 * publication-quality statistical testing for pairwise P&L comparison.
 *
 * Routes:
 * - GET /head-to-head/:agentA/:agentB — Full comparison between two agents
 * - GET /rankings                      — All agents ranked with confidence intervals
 * - GET /dominance-matrix              — NxN matrix showing which agent beats which
 * - GET /statistical-tests             — Welch's t-test and effect size for all pairs
 */

import { Hono } from "hono";
import { getAgentConfigs } from "../agents/orchestrator.ts";
import { clamp, computeVariance, countByCondition, mean, round2, round3 } from "../lib/math-utils.ts";

export const benchmarkComparisonRoutes = new Hono();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ComparisonEntry {
  roundId: string;
  agentId: string;
  pnl: number;
  coherence: number;
  hallucinationCount: number;
  timestamp: number;
}

interface HeadToHeadResult {
  agentA: { id: string; name: string };
  agentB: { id: string; name: string };
  rounds: number;
  agentAWins: number;
  agentBWins: number;
  draws: number;
  pnlComparison: {
    agentAPnl: number;
    agentBPnl: number;
    difference: number;
    pValue: number;
    isSignificant: boolean;
    effectSize: number;
    effectLabel: string;
  };
  coherenceComparison: { agentA: number; agentB: number; winner: string };
  hallucinationComparison: { agentA: number; agentB: number; winner: string };
  overallWinner: string;
  confidence: number;
}

// ---------------------------------------------------------------------------
// In-Memory Data Store
// ---------------------------------------------------------------------------

const comparisonData: ComparisonEntry[] = [];
const MAX_ENTRIES = 5000;

/**
 * Record a comparison entry from the orchestrator after each round.
 * Call this for every agent in every round to feed the comparison engine.
 */
export function recordComparisonEntry(entry: ComparisonEntry): void {
  comparisonData.push(entry);
  if (comparisonData.length > MAX_ENTRIES) {
    comparisonData.splice(0, comparisonData.length - MAX_ENTRIES);
  }
}

// ---------------------------------------------------------------------------
// Statistical Helpers
// ---------------------------------------------------------------------------


/** Sample variance (Bessel-corrected, n-1 denominator). */
function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1);
}

/**
 * Welch's t-test for two independent samples with unequal variance.
 * Returns { tStatistic, degreesOfFreedom, pValue }.
 */
function welchTTest(a: number[], b: number[]) {
  const nA = a.length;
  const nB = b.length;
  if (nA < 2 || nB < 2) {
    return { tStatistic: 0, degreesOfFreedom: 0, pValue: 1 };
  }

  const mA = mean(a);
  const mB = mean(b);
  const vA = variance(a);
  const vB = variance(b);
  const seA = vA / nA;
  const seB = vB / nB;
  const seDiff = Math.sqrt(seA + seB);

  if (seDiff === 0) {
    return { tStatistic: 0, degreesOfFreedom: nA + nB - 2, pValue: 1 };
  }

  const t = (mA - mB) / seDiff;

  // Welch-Satterthwaite degrees of freedom
  const df = (seA + seB) ** 2 / (seA ** 2 / (nA - 1) + seB ** 2 / (nB - 1));

  // Two-tailed p-value approximation using the t-distribution CDF.
  // Uses the regularized incomplete beta function relation:
  // p = I_{df/(df+t^2)}(df/2, 1/2) which we approximate with a series.
  const pValue = tDistPValue(Math.abs(t), df);

  return { tStatistic: round3(t), degreesOfFreedom: Math.round(df * 10) / 10, pValue };
}

/**
 * Approximate two-tailed p-value for |t| with given degrees of freedom.
 * Uses a rational approximation accurate to ~3 decimal places for df >= 2.
 */
function tDistPValue(absT: number, df: number): number {
  if (df <= 0 || absT === 0) return 1;
  // Hill's approximation for the t-distribution CDF
  const x = df / (df + absT * absT);
  const a = df / 2;
  const b = 0.5;
  // Regularized incomplete beta via continued fraction (Lentz's method)
  const ibeta = regIncBeta(x, a, b);
  return clamp(Math.round(ibeta * 10000) / 10000, 0, 1);
}

/**
 * Regularized incomplete beta function I_x(a,b) via series expansion.
 * Sufficient precision for p-value estimation.
 */
function regIncBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  // Use series expansion for I_x(a,b)
  const lnBeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta) / a;
  // Continued fraction (Lentz's method, 200 iterations)
  let f = 1;
  let c = 1;
  let d = 1 - (a + b) * x / (a + 1);
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  f = d;
  for (let m = 1; m <= 200; m++) {
    // Even step
    let num = m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m));
    d = 1 + num * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + num / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    f *= d * c;
    // Odd step
    num = -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + num * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + num / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const delta = d * c;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-10) break;
  }
  return front * f;
}

/** Lanczos approximation of ln(Gamma(z)). */
function lnGamma(z: number): number {
  const g = 7;
  const coeff = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  }
  z -= 1;
  let x = coeff[0];
  for (let i = 1; i < g + 2; i++) x += coeff[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/**
 * Cohen's d effect size with verbal label.
 * |d| < 0.2 = negligible, 0.2-0.5 = small, 0.5-0.8 = medium, >0.8 = large.
 */
function cohensD(a: number[], b: number[]): { d: number; label: string } {
  const nA = a.length;
  const nB = b.length;
  if (nA < 2 || nB < 2) return { d: 0, label: "insufficient data" };
  const pooledStd = Math.sqrt(((nA - 1) * variance(a) + (nB - 1) * variance(b)) / (nA + nB - 2));
  if (pooledStd === 0) return { d: 0, label: "negligible" };
  const d = round3((mean(a) - mean(b)) / pooledStd);
  const absD = Math.abs(d);
  const label = absD < 0.2 ? "negligible" : absD < 0.5 ? "small" : absD < 0.8 ? "medium" : "large";
  return { d, label };
}

/** 95% confidence interval for a sample mean (t-distribution based). */
function confidenceInterval95(values: number[]): { lower: number; upper: number; margin: number } {
  const n = values.length;
  if (n < 2) return { lower: 0, upper: 0, margin: 0 };
  const m = mean(values);
  // Use z=1.96 as approximation for large n; for small n this is conservative enough
  const margin = 1.96 * Math.sqrt(variance(values) / n);
  return {
    lower: round2(m - margin),
    upper: round2(m + margin),
    margin: round2(margin),
  };
}

// ---------------------------------------------------------------------------
// Core Comparison Logic
// ---------------------------------------------------------------------------

/** Get agent name from config, falling back to the raw ID. */
function agentName(id: string): string {
  const configs = getAgentConfigs();
  return configs.find((c) => c.agentId === id)?.name ?? id;
}

/** Get all unique agent IDs present in the data store. */
function allAgentIds(): string[] {
  return [...new Set(comparisonData.map((e) => e.agentId))];
}

/**
 * Build a full head-to-head result between two agents.
 * Only considers rounds where BOTH agents have entries.
 */
function buildHeadToHead(idA: string, idB: string): HeadToHeadResult {
  // Index entries by roundId for each agent
  const byRoundA = new Map<string, ComparisonEntry>();
  const byRoundB = new Map<string, ComparisonEntry>();
  for (const e of comparisonData) {
    if (e.agentId === idA) byRoundA.set(e.roundId, e);
    else if (e.agentId === idB) byRoundB.set(e.roundId, e);
  }

  // Collect paired observations
  const pnlA: number[] = [];
  const pnlB: number[] = [];
  const cohA: number[] = [];
  const cohB: number[] = [];
  const hallA: number[] = [];
  const hallB: number[] = [];
  let winsA = 0;
  let winsB = 0;
  let draws = 0;

  for (const [roundId, entryA] of byRoundA) {
    const entryB = byRoundB.get(roundId);
    if (!entryB) continue;
    pnlA.push(entryA.pnl);
    pnlB.push(entryB.pnl);
    cohA.push(entryA.coherence);
    cohB.push(entryB.coherence);
    hallA.push(entryA.hallucinationCount);
    hallB.push(entryB.hallucinationCount);
    if (entryA.pnl > entryB.pnl) winsA++;
    else if (entryB.pnl > entryA.pnl) winsB++;
    else draws++;
  }

  const rounds = pnlA.length;
  const tTest = welchTTest(pnlA, pnlB);
  const effect = cohensD(pnlA, pnlB);
  const totalPnlA = pnlA.reduce((s, v) => s + v, 0);
  const totalPnlB = pnlB.reduce((s, v) => s + v, 0);
  const avgCohA = mean(cohA);
  const avgCohB = mean(cohB);
  const avgHallA = mean(hallA);
  const avgHallB = mean(hallB);

  // Overall winner: whoever has more P&L round wins; tie-break by total P&L
  let overallWinner = "draw";
  if (winsA > winsB) overallWinner = idA;
  else if (winsB > winsA) overallWinner = idB;
  else if (totalPnlA > totalPnlB) overallWinner = idA;
  else if (totalPnlB > totalPnlA) overallWinner = idB;

  // Confidence: based on sample size and significance
  const confidence = rounds >= 30 && tTest.pValue < 0.05
    ? 0.95
    : rounds >= 10
      ? Math.min(0.9, 0.5 + rounds * 0.02)
      : Math.min(0.5, rounds * 0.1);

  return {
    agentA: { id: idA, name: agentName(idA) },
    agentB: { id: idB, name: agentName(idB) },
    rounds,
    agentAWins: winsA,
    agentBWins: winsB,
    draws,
    pnlComparison: {
      agentAPnl: round2(totalPnlA),
      agentBPnl: round2(totalPnlB),
      difference: round2(totalPnlA - totalPnlB),
      pValue: tTest.pValue,
      isSignificant: tTest.pValue < 0.05,
      effectSize: effect.d,
      effectLabel: effect.label,
    },
    coherenceComparison: {
      agentA: round2(avgCohA),
      agentB: round2(avgCohB),
      winner: avgCohA > avgCohB ? idA : avgCohB > avgCohA ? idB : "tie",
    },
    hallucinationComparison: {
      agentA: round2(avgHallA),
      agentB: round2(avgHallB),
      winner: avgHallA < avgHallB ? idA : avgHallB < avgHallA ? idB : "tie",
    },
    overallWinner,
    confidence: round2(confidence),
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /head-to-head/:agentA/:agentB -- Full comparison between two agents
 */
benchmarkComparisonRoutes.get("/head-to-head/:agentA/:agentB", (c) => {
  const idA = c.req.param("agentA");
  const idB = c.req.param("agentB");

  if (idA === idB) {
    return c.json({ ok: false, error: "Cannot compare an agent with itself" }, 400);
  }

  const result = buildHeadToHead(idA, idB);

  if (result.rounds === 0) {
    return c.json({
      ok: true,
      warning: "No shared rounds found between these agents",
      result,
    });
  }

  return c.json({ ok: true, result });
});

/**
 * GET /rankings -- All agents ranked with statistical confidence intervals
 */
benchmarkComparisonRoutes.get("/rankings", (c) => {
  const agents = allAgentIds();
  const rankings = agents.map((id) => {
    const entries = comparisonData.filter((e) => e.agentId === id);
    const pnls = entries.map((e) => e.pnl);
    const ci = confidenceInterval95(pnls);
    const totalPnl = pnls.reduce((s, v) => s + v, 0);
    return {
      agentId: id,
      agentName: agentName(id),
      rounds: entries.length,
      totalPnl: round2(totalPnl),
      meanPnl: round2(mean(pnls)),
      stdDev: round2(Math.sqrt(variance(pnls))),
      ci95: ci,
      avgCoherence: round2(mean(entries.map((e) => e.coherence))),
      avgHallucinations: round2(mean(entries.map((e) => e.hallucinationCount))),
    };
  });

  rankings.sort((a, b) => b.totalPnl - a.totalPnl);
  rankings.forEach((r, i) => Object.assign(r, { rank: i + 1 }));

  return c.json({
    ok: true,
    totalAgents: rankings.length,
    totalRounds: new Set(comparisonData.map((e) => e.roundId)).size,
    rankings,
  });
});

/**
 * GET /dominance-matrix -- NxN matrix showing which agent beats which
 */
benchmarkComparisonRoutes.get("/dominance-matrix", (c) => {
  const agents = allAgentIds();
  const matrix: Record<string, Record<string, { wins: number; losses: number; draws: number; winRate: number }>> = {};

  for (const a of agents) {
    matrix[a] = {};
    for (const b of agents) {
      if (a === b) {
        matrix[a][b] = { wins: 0, losses: 0, draws: 0, winRate: 0 };
        continue;
      }
      const h2h = buildHeadToHead(a, b);
      const total = h2h.agentAWins + h2h.agentBWins + h2h.draws;
      matrix[a][b] = {
        wins: h2h.agentAWins,
        losses: h2h.agentBWins,
        draws: h2h.draws,
        winRate: total > 0 ? round2(h2h.agentAWins / total) : 0,
      };
    }
  }

  // Most dominant = highest average win rate across opponents
  const dominanceScores = agents.map((a) => {
    const opponents = agents.filter((b) => b !== a);
    const avgWinRate = opponents.length > 0
      ? mean(opponents.map((b) => matrix[a][b].winRate))
      : 0;
    return { agentId: a, agentName: agentName(a), avgWinRate: round2(avgWinRate) };
  }).sort((a, b) => b.avgWinRate - a.avgWinRate);

  return c.json({
    ok: true,
    agents: agents.map((id) => ({ id, name: agentName(id) })),
    matrix,
    dominanceRanking: dominanceScores,
    mostDominant: dominanceScores[0]?.agentId ?? null,
  });
});

/**
 * GET /statistical-tests -- Welch's t-test and Cohen's d for all agent pairs
 */
benchmarkComparisonRoutes.get("/statistical-tests", (c) => {
  const agents = allAgentIds();
  const tests: Array<{
    agentA: string;
    agentB: string;
    sampleSizeA: number;
    sampleSizeB: number;
    sharedRounds: number;
    welchT: { tStatistic: number; degreesOfFreedom: number; pValue: number };
    effectSize: { d: number; label: string };
    isSignificant: boolean;
    interpretation: string;
  }> = [];

  // Generate all unique pairs
  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const idA = agents[i];
      const idB = agents[j];

      // Collect paired P&L values from shared rounds
      const byRoundA = new Map<string, number>();
      const byRoundB = new Map<string, number>();
      for (const e of comparisonData) {
        if (e.agentId === idA) byRoundA.set(e.roundId, e.pnl);
        else if (e.agentId === idB) byRoundB.set(e.roundId, e.pnl);
      }

      const pnlA: number[] = [];
      const pnlB: number[] = [];
      for (const [roundId, pnl] of byRoundA) {
        const pnlBVal = byRoundB.get(roundId);
        if (pnlBVal !== undefined) {
          pnlA.push(pnl);
          pnlB.push(pnlBVal);
        }
      }

      const tResult = welchTTest(pnlA, pnlB);
      const effect = cohensD(pnlA, pnlB);
      const sig = tResult.pValue < 0.05;

      // Human-readable interpretation
      const nameA = agentName(idA);
      const nameB = agentName(idB);
      const better = mean(pnlA) >= mean(pnlB) ? nameA : nameB;
      const interpretation = pnlA.length < 2
        ? "Insufficient data for statistical comparison"
        : sig
          ? `${better} significantly outperforms (p=${tResult.pValue}, ${effect.label} effect)`
          : `No significant difference (p=${tResult.pValue})`;

      tests.push({
        agentA: idA,
        agentB: idB,
        sampleSizeA: pnlA.length,
        sampleSizeB: pnlB.length,
        sharedRounds: pnlA.length,
        welchT: tResult,
        effectSize: effect,
        isSignificant: sig,
        interpretation,
      });
    }
  }

  return c.json({
    ok: true,
    significanceLevel: 0.05,
    totalPairs: tests.length,
    significantPairs: countByCondition(tests, (t) => t.isSignificant),
    tests,
  });
});
