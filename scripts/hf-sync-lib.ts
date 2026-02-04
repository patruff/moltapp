/**
 * HuggingFace sync as a library function (importable by heartbeat.ts).
 * Reads trade_justifications + agent_decisions from DB and uploads JSONL.
 */
import { uploadFile } from "@huggingface/hub";
import { desc } from "drizzle-orm";

const HF_REPO = "patruff/molt-benchmark";

export async function syncToHuggingFace(): Promise<number> {
  const HF_TOKEN = process.env.HF_TOKEN;
  if (!HF_TOKEN) return 0; // silently skip if no token

  const { db } = await import("../src/db/index.ts");
  const { tradeJustifications } = await import("../src/db/schema/trade-reasoning.ts");
  const { agentDecisions } = await import("../src/db/schema/agent-decisions.ts");

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

  const records = justifications.map((j) => {
    const d = decisionMap.get(`${j.agentId}|${j.roundId}|${j.symbol}`);
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
      round_id: j.roundId ?? null,
      timestamp: j.timestamp?.toISOString() ?? null,
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
    commitTitle: `Auto-sync: ${records.length} records (${new Date().toISOString()})`,
  });

  return records.length;
}
