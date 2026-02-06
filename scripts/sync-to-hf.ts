#!/usr/bin/env npx tsx
/**
 * Sync MoltApp benchmark data to HuggingFace as a dataset.
 * Combines trade justifications + agent decisions into JSONL,
 * then uploads to patruff/molt-benchmark.
 *
 * Usage: npx tsx scripts/sync-to-hf.ts
 * Requires: HF_TOKEN environment variable
 */
import { writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";
import { uploadFile } from "@huggingface/hub";
import { desc } from "drizzle-orm";

const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  for (const line of readFileSync(resolve(__dirname, "../.env"), "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
} catch {}

const HF_TOKEN = process.env.HF_TOKEN;
if (!HF_TOKEN) {
  console.error("ERROR: HF_TOKEN environment variable is required.");
  console.error("Get a token at https://huggingface.co/settings/tokens");
  process.exit(1);
}

console.log("[sync-to-hf] Connecting to database...");
const { db } = await import("../src/db/index.ts");
const { tradeJustifications } = await import("../src/db/schema/trade-reasoning.ts");
const { agentDecisions } = await import("../src/db/schema/agent-decisions.ts");
const { agents, portfolioSnapshots } = await import("../src/db/schema/index.ts");

// Import decision quality metrics
const { generateDecisionQualityReport } = await import("../src/services/decision-quality-dashboard.ts");
const { eq } = await import("drizzle-orm");

console.log("[sync-to-hf] Fetching trade justifications...");
const justifications = await db.select().from(tradeJustifications).orderBy(desc(tradeJustifications.timestamp));

console.log("[sync-to-hf] Fetching agent decisions...");
const decisions = await db.select().from(agentDecisions).orderBy(desc(agentDecisions.createdAt));

// Build lookup from decisions keyed by agentId+roundId+symbol for enrichment
const decisionMap = new Map<string, (typeof decisions)[number]>();
for (const d of decisions) {
  decisionMap.set(`${d.agentId}|${d.roundId}|${d.symbol}`, d);
}

// Fetch portfolio snapshots for portfolio context
console.log("[sync-to-hf] Fetching portfolio snapshots...");
const snapshots = await db.select().from(portfolioSnapshots).orderBy(desc(portfolioSnapshots.createdAt));

// Build lookup from snapshots keyed by agentId+roundId for portfolio context
const snapshotMap = new Map<string, (typeof snapshots)[number]>();
for (const s of snapshots) {
  const key = `${s.agentId}|${s.roundId}`;
  if (!snapshotMap.has(key)) {
    snapshotMap.set(key, s); // Keep first (most recent) snapshot per round
  }
}
console.log(`[sync-to-hf] Loaded ${snapshots.length} portfolio snapshots.`);

// Import v35 scoring functions for enrichment
const {
  scoreCausalReasoning,
  scoreEpistemicHumility,
  scoreReasoningTraceability,
  scoreAdversarialCoherence,
} = await import("../src/services/v34-benchmark-engine.ts");
const {
  scoreInformationAsymmetry,
  scoreTemporalReasoningQuality,
} = await import("../src/services/v35-benchmark-engine.ts");
// Import v36 scoring functions
const {
  scoreReasoningAuditability,
  scoreDecisionReversibility,
} = await import("../src/services/v36-benchmark-engine.ts");
// Import v37 scoring functions
const {
  scoreReasoningComposability,
  scoreStrategicForesight,
} = await import("../src/services/v37-benchmark-engine.ts");

// Generate decision quality reports for all agents
console.log("[sync-to-hf] Generating decision quality reports for agents...");
const activeAgents = await db.select().from(agents).where(eq(agents.isActive, true));
const qualityReportMap = new Map<string, Awaited<ReturnType<typeof generateDecisionQualityReport>>>();
for (const agent of activeAgents) {
  try {
    const report = await generateDecisionQualityReport(agent.id);
    qualityReportMap.set(agent.id, report);
    console.log(`[sync-to-hf] Quality report for ${agent.id}: ${report.grade} (${(report.compositeScore * 100).toFixed(1)}%)`);
  } catch (err) {
    console.warn(`[sync-to-hf] Failed to generate quality report for ${agent.id}:`, err);
  }
}

// Merge justifications with decision data into benchmark records (v39: 40-dimension with quality metrics + portfolio context)
const records = justifications.map((j) => {
  const d = decisionMap.get(`${j.agentId}|${j.roundId}|${j.symbol}`);
  // Get quality report for this agent (if available)
  const q = qualityReportMap.get(j.agentId);
  // Get portfolio snapshot for this agent+round (if available)
  const snap = snapshotMap.get(`${j.agentId}|${j.roundId}`);
  // Compute v34-v37 scores for each record
  const causalScore = scoreCausalReasoning(j.reasoning, (j.sources as string[]) ?? []);
  const epistemicScore = scoreEpistemicHumility(
    j.reasoning,
    j.confidence,
    (j.sources as string[]) ?? [],
    (j.hallucinationFlags as string[]) ?? [],
  );
  const traceabilityScore = scoreReasoningTraceability(
    j.reasoning,
    (j.sources as string[]) ?? [],
    {},
  );
  const adversarialScore = scoreAdversarialCoherence(
    j.reasoning,
    j.action ?? "hold",
    j.confidence,
    {},
  );
  const infoAsymmetryScore = scoreInformationAsymmetry(
    j.reasoning,
    (j.sources as string[]) ?? [],
    [],
  );
  const temporalReasoningScore = scoreTemporalReasoningQuality(
    j.reasoning,
    j.predictedOutcome ?? null,
  );
  // v36 dimensions
  const auditabilityScore = scoreReasoningAuditability(
    j.reasoning,
    (j.sources as string[]) ?? [],
    {},
  );
  const reversibilityScore = scoreDecisionReversibility(
    j.reasoning,
    j.confidence,
    (j.sources as string[]) ?? [],
    j.coherenceScore ?? 0,
    (j.hallucinationFlags as string[]) ?? [],
    [],
  );
  // v37 new dimensions
  const composabilityScore = scoreReasoningComposability(
    j.reasoning,
    (j.sources as string[]) ?? [],
    [],
    [],
  );
  const foresightScore = scoreStrategicForesight(
    j.reasoning,
    j.action ?? "hold",
    j.predictedOutcome ?? null,
    (j.sources as string[]) ?? [],
  );
  return {
    agent_id: j.agentId,
    agent_action: j.action,
    symbol: j.symbol,
    quantity: j.quantity ?? d?.quantity ?? null,
    reasoning: j.reasoning,
    confidence: j.confidence,
    sources: j.sources ?? [],
    tool_trace: j.toolTrace ?? [],
    model_used: j.modelUsed ?? d?.modelUsed ?? null,
    intent: j.intent,
    predicted_outcome: j.predictedOutcome ?? null,
    actual_outcome: j.actualOutcome ?? null,
    coherence_score: j.coherenceScore ?? null,
    hallucination_flags: j.hallucinationFlags ?? [],
    discipline_pass: j.disciplinePass ?? "pending",
    causal_reasoning_score: causalScore,
    epistemic_humility_score: epistemicScore,
    reasoning_traceability_score: traceabilityScore,
    adversarial_coherence_score: adversarialScore,
    information_asymmetry_score: infoAsymmetryScore,
    temporal_reasoning_score: temporalReasoningScore,
    reasoning_auditability_score: auditabilityScore,
    decision_reversibility_score: reversibilityScore,
    reasoning_composability_score: composabilityScore,
    strategic_foresight_score: foresightScore,
    // Decision quality metrics (from quality dashboard service)
    quality_calibration_ece: q?.calibration.ece ?? null,
    quality_calibration_grade: q?.calibration.grade ?? null,
    quality_overconfidence_ratio: q?.calibration.overconfidenceRatio ?? null,
    quality_integrity_score: q?.integrity.integrityScore ?? null,
    quality_flip_flops: q?.integrity.flipFlops ?? null,
    quality_contradictions: q?.integrity.contradictions ?? null,
    quality_accountability_score: q?.accountability.accountabilityScore ?? null,
    quality_accuracy_rate: q?.accountability.accuracyRate ?? null,
    quality_total_claims: q?.accountability.totalClaims ?? null,
    quality_memory_score: q?.memory.memoryScore ?? null,
    quality_memory_trend: q?.memory.trend ?? null,
    quality_tool_correctness: q?.toolUse.correctnessScore ?? null,
    quality_tool_sequence_adherence: q?.toolUse.sequenceAdherence ?? null,
    quality_tool_violations: q?.toolUse.violations ?? [],
    quality_composite_score: q?.compositeScore ?? null,
    quality_grade: q?.grade ?? null,
    quality_strengths: q?.strengths ?? [],
    quality_weaknesses: q?.weaknesses ?? [],
    // Portfolio context at time of decision (from portfolio snapshots)
    portfolio_cash_balance_usdc: snap ? parseFloat(snap.cashBalance) : null,
    portfolio_positions_value_usdc: snap ? parseFloat(snap.positionsValue) : null,
    portfolio_total_value_usdc: snap ? parseFloat(snap.totalValue) : null,
    portfolio_total_pnl_usdc: snap ? parseFloat(snap.totalPnl) : null,
    portfolio_total_pnl_percent: snap ? parseFloat(snap.totalPnlPercent) : null,
    portfolio_position_count: snap?.positionCount ?? null,
    // Metadata
    round_id: j.roundId ?? null,
    timestamp: j.timestamp?.toISOString() ?? null,
    benchmark_version: "39.0",
    dimension_count: 58,
  };
});

if (records.length === 0) {
  console.log("[sync-to-hf] No benchmark data found. Nothing to upload.");
  process.exit(0);
}

console.log(`[sync-to-hf] Formatted ${records.length} benchmark records.`);

// Write JSONL to temp file
const jsonlPath = join(tmpdir(), "molt-benchmark.jsonl");
const jsonl = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
writeFileSync(jsonlPath, jsonl);
console.log(`[sync-to-hf] Wrote JSONL to ${jsonlPath} (${(Buffer.byteLength(jsonl) / 1024).toFixed(1)} KB)`);

const repo = { type: "dataset" as const, name: "patruff/molt-benchmark" };
const credentials = { accessToken: HF_TOKEN };

// Upload JSONL data file (both canonical and auto-detect paths)
console.log("[sync-to-hf] Uploading benchmark data...");
const jsonlBlob = new Blob([readFileSync(jsonlPath)]);
await uploadFile({
  repo,
  credentials,
  file: { path: "data/molt-benchmark.jsonl", content: jsonlBlob },
  commitTitle: `Update benchmark data (${records.length} records)`,
});
console.log("[sync-to-hf] Uploaded data/molt-benchmark.jsonl");

// Also upload as train.jsonl for HF auto-detection
await uploadFile({
  repo,
  credentials,
  file: { path: "data/train.jsonl", content: new Blob([readFileSync(jsonlPath)]) },
  commitTitle: `Update train split (${records.length} records)`,
});
console.log("[sync-to-hf] Uploaded data/train.jsonl");

// Build and upload dataset card
const datasetCard = `---
license: mit
task_categories:
  - text-generation
language:
  - en
tags:
  - finance
  - benchmark
  - agentic-ai
  - stock-trading
size_categories:
  - 1K<n<10K
configs:
  - config_name: default
    data_files:
      - split: train
        path: data/train.jsonl
---

# MoltApp: Agentic Stock Trading Benchmark

A benchmark dataset capturing how AI agents reason about stock trades in a
simulated live-market environment. Each record pairs an agent's **reasoning,
confidence, and predicted outcome** with the **actual result** and automated
quality scores.

## Columns

| Column | Description |
|---|---|
| \`agent_id\` | Unique AI agent identifier (e.g. \`claude-value-investor\`) |
| \`agent_action\` | Action taken: buy, sell, or hold |
| \`symbol\` | Stock / token symbol |
| \`quantity\` | Trade size (USDC for buys, shares for sells) |
| \`reasoning\` | Free-text step-by-step reasoning the agent produced |
| \`confidence\` | Self-reported confidence (0-1) |
| \`sources\` | Data sources cited in the reasoning |
| \`intent\` | Classified trading intent |
| \`predicted_outcome\` | What the agent expected to happen |
| \`actual_outcome\` | What actually happened (filled post-trade) |
| \`coherence_score\` | Does reasoning match the action? (0-1) |
| \`hallucination_flags\` | Factual errors found in reasoning |
| \`discipline_pass\` | Whether trading rules were followed |
| \`causal_reasoning_score\` | Quality of cause-effect chains (0-100) |
| \`epistemic_humility_score\` | Appropriate uncertainty acknowledgment (0-100) |
| \`reasoning_traceability_score\` | Claim-to-source attribution quality (0-100) |
| \`adversarial_coherence_score\` | Reasoning robustness against contrary signals (0-100) |
| \`information_asymmetry_score\` | Unique insight detection beyond common signals (0-100) |
| \`temporal_reasoning_score\` | Quality of time-dependent factor reasoning (0-100) |
| \`reasoning_auditability_score\` | Third-party verifiability of claims (0-100) |
| \`decision_reversibility_score\` | Exit planning and thesis invalidation quality (0-100) |
| \`reasoning_composability_score\` | Multi-source synthesis and modular argument quality (0-100) |
| \`strategic_foresight_score\` | Second-order effects, scenario planning, portfolio thinking (0-100) |
| \`quality_calibration_ece\` | Expected Calibration Error - lower is better (0-1) |
| \`quality_calibration_grade\` | Calibration letter grade (A+ to F) |
| \`quality_overconfidence_ratio\` | How often agent is overconfident (0-1) |
| \`quality_integrity_score\` | Reasoning consistency score (0-1) |
| \`quality_flip_flops\` | Number of position reversals without justification |
| \`quality_contradictions\` | Number of contradictory claims in reasoning |
| \`quality_accountability_score\` | Claim accuracy tracking score (0-1) |
| \`quality_accuracy_rate\` | Rate of accurate predictions (0-1) |
| \`quality_total_claims\` | Total claims made by agent |
| \`quality_memory_score\` | Cross-session learning score (0-1) |
| \`quality_memory_trend\` | Learning trend: improving, stable, or declining |
| \`quality_tool_correctness\` | Tool use correctness score (0-1) |
| \`quality_tool_sequence_adherence\` | Proper tool sequence adherence (0-1) |
| \`quality_tool_violations\` | List of tool sequence violations |
| \`quality_composite_score\` | Weighted composite quality score (0-1) |
| \`quality_grade\` | Overall quality grade (A+ to F) |
| \`quality_strengths\` | Top 2 quality dimensions |
| \`quality_weaknesses\` | Bottom 2 quality dimensions |
| \`portfolio_cash_balance_usdc\` | Agent's USDC cash balance at time of decision |
| \`portfolio_positions_value_usdc\` | Total value of stock positions in USDC |
| \`portfolio_total_value_usdc\` | Total portfolio value (cash + positions) |
| \`portfolio_total_pnl_usdc\` | Cumulative P&L in USDC since inception |
| \`portfolio_total_pnl_percent\` | Cumulative P&L as percentage |
| \`portfolio_position_count\` | Number of open positions at time of decision |
| \`round_id\` | Trading round identifier |
| \`timestamp\` | ISO-8601 decision timestamp |
| \`benchmark_version\` | Benchmark version (e.g. 39.0) |
| \`dimension_count\` | Number of scoring dimensions (58) |

## Citation

\`\`\`bibtex
@misc{moltapp2026,
  title={MoltApp: Agentic Stock Trading Benchmark},
  author={patruff},
  year={2026},
  url={https://huggingface.co/datasets/patruff/molt-benchmark}
}
\`\`\`
`;

console.log("[sync-to-hf] Uploading dataset card...");
await uploadFile({
  repo,
  credentials,
  file: { path: "README.md", content: new Blob([datasetCard]) },
  commitTitle: "Update dataset card",
});
console.log("[sync-to-hf] Uploaded README.md");

console.log(`[sync-to-hf] Done. ${records.length} records synced to huggingface.co/datasets/patruff/molt-benchmark`);
process.exit(0);
