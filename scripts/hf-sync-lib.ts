/**
 * HuggingFace sync as a library function (importable by heartbeat.ts).
 * Reads trade_justifications + agent_decisions from DB and uploads JSONL.
 * Includes decision quality metrics from the quality dashboard service.
 */
import { uploadFile } from "@huggingface/hub";
import { desc, eq } from "drizzle-orm";

const HF_REPO = "patruff/molt-benchmark";

export async function syncToHuggingFace(): Promise<number> {
  const HF_TOKEN = process.env.HF_TOKEN;
  if (!HF_TOKEN) return 0; // silently skip if no token

  const { db } = await import("../src/db/index.ts");
  const { tradeJustifications } = await import("../src/db/schema/trade-reasoning.ts");
  const { agentDecisions } = await import("../src/db/schema/agent-decisions.ts");
  const { agents } = await import("../src/db/schema/index.ts");
  const { generateDecisionQualityReport } = await import("../src/services/decision-quality-dashboard.ts");

  const justifications = await db
    .select()
    .from(tradeJustifications)
    .orderBy(desc(tradeJustifications.timestamp));

  if (justifications.length === 0) return 0;

  const decisions = await db
    .select()
    .from(agentDecisions)
    .orderBy(desc(agentDecisions.createdAt));

  const decisionMap = new Map<string, (typeof decisions)[number]>();
  for (const d of decisions) {
    decisionMap.set(`${d.agentId}|${d.roundId}|${d.symbol}`, d);
  }

  // Generate decision quality reports for all agents
  const activeAgents = await db.select().from(agents).where(eq(agents.status, "active"));
  const qualityReportMap = new Map<string, Awaited<ReturnType<typeof generateDecisionQualityReport>>>();
  for (const agent of activeAgents) {
    try {
      const report = await generateDecisionQualityReport(agent.id);
      qualityReportMap.set(agent.id, report);
    } catch {
      // Skip agents that fail quality report generation
    }
  }

  const records = justifications.map((j) => {
    const d = decisionMap.get(`${j.agentId}|${j.roundId}|${j.symbol}`);
    const q = qualityReportMap.get(j.agentId);
    return {
      agent_id: j.agentId,
      agent_action: j.action,
      symbol: j.symbol,
      quantity: j.quantity ?? d?.quantity ?? null,
      reasoning: j.reasoning,
      confidence: j.confidence,
      sources: j.sources ?? [],
      intent: j.intent,
      predicted_outcome: j.predictedOutcome ?? null,
      actual_outcome: j.actualOutcome ?? null,
      coherence_score: j.coherenceScore ?? null,
      hallucination_flags: j.hallucinationFlags ?? [],
      discipline_pass: j.disciplinePass ?? "pending",
      // Decision quality metrics
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
      round_id: j.roundId ?? null,
      timestamp: j.timestamp?.toISOString() ?? null,
      benchmark_version: "38.0",
      dimension_count: 52,
    };
  });

  const jsonl = records.map((r) => JSON.stringify(r)).join("\n") + "\n";

  const repo = { type: "dataset" as const, name: HF_REPO };
  const credentials = { accessToken: HF_TOKEN };

  // Upload as train.jsonl for HF auto-detection
  await uploadFile({
    repo,
    credentials,
    file: {
      path: "data/train.jsonl",
      content: new Blob([jsonl]),
    },
    commitTitle: `Auto-sync: ${records.length} records with quality metrics (${new Date().toISOString()})`,
  });

  return records.length;
}
