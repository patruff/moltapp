/**
 * HuggingFace Benchmark Sync Script
 *
 * Fetches all trades with justifications from the MoltApp database,
 * formats them as a benchmark dataset, and uploads to HuggingFace.
 *
 * Usage: npx tsx scripts/sync-to-hf.ts
 *
 * Requires HF_TOKEN environment variable.
 * Uploads to: patruff/molt-benchmark
 */

import { uploadFile } from "@huggingface/hub";
import { db } from "../src/db/index.ts";
import { tradeJustifications, benchmarkSnapshots } from "../src/db/schema/trade-reasoning.ts";
import { agents } from "../src/db/schema/agents.ts";
import { trades } from "../src/db/schema/trades.ts";
import { desc, eq } from "drizzle-orm";
import { readFileSync } from "fs";

const HF_REPO = "patruff/molt-benchmark";

interface BenchmarkEntry {
  agent_id: string;
  round_id: string | null;
  action: string;
  symbol: string;
  quantity: number | null;
  reasoning: string;
  confidence: number;
  intent: string;
  sources: string[] | null;
  predicted_outcome: string | null;
  actual_outcome: string | null;
  coherence_score: number | null;
  hallucination_flags: string[] | null;
  discipline_pass: string | null;
  timestamp: string | null;
}

async function main() {
  const token = process.env.HF_TOKEN;
  if (!token) {
    console.error("ERROR: HF_TOKEN environment variable required");
    console.error("Get a token at https://huggingface.co/settings/tokens");
    process.exit(1);
  }

  console.log("[sync-to-hf] Fetching trade justifications from DB...");

  let justifications: any[];
  try {
    justifications = await db
      .select()
      .from(tradeJustifications)
      .orderBy(desc(tradeJustifications.timestamp))
      .limit(10000);
  } catch (err) {
    console.error("DB query failed:", err);
    process.exit(1);
  }

  console.log(`[sync-to-hf] Found ${justifications.length} justifications`);

  if (justifications.length === 0) {
    console.log("[sync-to-hf] No data to upload. Run some trading rounds first.");
    process.exit(0);
  }

  // Format as JSONL benchmark entries
  const entries: BenchmarkEntry[] = justifications.map((j) => ({
    agent_id: j.agentId,
    round_id: j.roundId,
    action: j.action,
    symbol: j.symbol,
    quantity: j.quantity,
    reasoning: j.reasoning,
    confidence: j.confidence,
    intent: j.intent,
    sources: j.sources as string[] | null,
    predicted_outcome: j.predictedOutcome,
    actual_outcome: j.actualOutcome,
    coherence_score: j.coherenceScore,
    hallucination_flags: j.hallucinationFlags as string[] | null,
    discipline_pass: j.disciplinePass,
    timestamp: j.timestamp?.toISOString() ?? null,
  }));

  const jsonlContent = entries.map((e) => JSON.stringify(e)).join("\n");
  const jsonlBlob = new Blob([jsonlContent], { type: "application/x-ndjson" });

  console.log(`[sync-to-hf] Uploading ${entries.length} entries to ${HF_REPO}...`);

  // Upload JSONL data
  try {
    await uploadFile({
      repo: HF_REPO,
      credentials: { accessToken: token },
      file: {
        path: "data/trades.jsonl",
        content: jsonlBlob,
      },
      commitTitle: `Update benchmark data: ${entries.length} trades (${new Date().toISOString().split("T")[0]})`,
    });
    console.log("[sync-to-hf] ✓ Uploaded data/trades.jsonl");
  } catch (err) {
    console.error("[sync-to-hf] Upload failed:", err);
    process.exit(1);
  }

  // Upload eval.yaml
  try {
    const evalYaml = readFileSync("eval.yaml", "utf-8");
    const evalBlob = new Blob([evalYaml], { type: "text/yaml" });
    await uploadFile({
      repo: HF_REPO,
      credentials: { accessToken: token },
      file: {
        path: "eval.yaml",
        content: evalBlob,
      },
      commitTitle: "Update eval.yaml benchmark definition",
    });
    console.log("[sync-to-hf] ✓ Uploaded eval.yaml");
  } catch (err) {
    console.warn("[sync-to-hf] eval.yaml upload skipped:", err);
  }

  // Upload dataset card (README.md)
  const readme = `---
license: mit
task_categories:
  - text-generation
  - reinforcement-learning
tags:
  - finance
  - trading
  - benchmark
  - ai-agents
  - solana
size_categories:
  - 1K<n<10K
---

# MoltApp: Agentic Stock Trading Benchmark v28

**16-Dimension AI Trading Benchmark** — Live evaluation of AI agents trading tokenized real-world stocks on Solana.

Website: [patgpt.us](https://www.patgpt.us)
Dashboard: [patgpt.us/benchmark-v28](https://www.patgpt.us/benchmark-v28)

## Agents

| Agent | Model | Provider | Strategy |
|-------|-------|----------|----------|
| Claude ValueBot | claude-sonnet-4 | Anthropic | Value investing |
| GPT MomentumBot | gpt-4o | OpenAI | Momentum trading |
| Grok ContrarianBot | grok-3-mini-fast | xAI | Contrarian |

## 16 Benchmark Dimensions

1. **Profitability (P&L)** — Portfolio returns
2. **Reasoning Coherence** — Does logic match the action?
3. **Hallucination-Free** — No fabricated market data
4. **Instruction Discipline** — Rule compliance
5. **Confidence Calibration** — Confidence vs outcomes
6. **Prediction Accuracy** — Predicted vs actual results
7. **Reasoning Depth** — Thoroughness of analysis
8. **Source Quality** — Data source diversity
9. **Outcome Prediction** — Forward-looking predictions
10. **Consensus Intelligence** — Multi-agent awareness
11. **Strategy Consistency** — Style genome stability
12. **Risk-Reward Discipline** — Position sizing quality
13. **Execution Quality** — Slippage and timing awareness
14. **Cross-Round Learning** — Adaptation from past trades
15. **Trade Accountability** — Intellectual honesty about past outcomes
16. **Reasoning Quality Index** — Structural reasoning quality (logic chains, evidence density, counterarguments)

## Data Format

JSONL with one entry per trade decision:
\\\`\\\`\\\`json
{
  "agent_id": "claude-value-investor",
  "action": "buy",
  "symbol": "AAPLx",
  "reasoning": "...",
  "confidence": 0.75,
  "intent": "value",
  "coherence_score": 0.92,
  "hallucination_flags": [],
  "accountability_score": 0.78,
  "rqi_score": 0.85,
  "timestamp": "2026-02-04T12:00:00Z"
}
\\\`\\\`\\\`

## Citation

\\\`\\\`\\\`bibtex
@misc{moltapp2026,
  title={MoltApp: 16-Dimension Agentic Stock Trading Benchmark},
  author={Pat Ruff},
  year={2026},
  url={https://www.patgpt.us}
}
\\\`\\\`\\\`

Built for the [Colosseum Agent Hackathon](https://colosseum.org).
`;

  try {
    const readmeBlob = new Blob([readme], { type: "text/markdown" });
    await uploadFile({
      repo: HF_REPO,
      credentials: { accessToken: token },
      file: {
        path: "README.md",
        content: readmeBlob,
      },
      commitTitle: "Update dataset README for v28 benchmark",
    });
    console.log("[sync-to-hf] ✓ Uploaded README.md");
  } catch (err) {
    console.warn("[sync-to-hf] README upload skipped:", err);
  }

  console.log("\n[sync-to-hf] Done! Dataset available at:");
  console.log(`  https://huggingface.co/datasets/${HF_REPO}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
