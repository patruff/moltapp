#!/usr/bin/env npx tsx
/**
 * HuggingFace Sync — V30 Benchmark Dataset
 *
 * Fetches all trade justifications and v30 benchmark scores from the
 * MoltApp database, formats them as a structured dataset, and uploads
 * to patruff/molt-benchmark on HuggingFace Hub.
 *
 * Usage:
 *   npx tsx scripts/sync-to-hf-v30.ts
 *
 * Requires:
 *   HF_TOKEN environment variable (write-scoped HuggingFace token)
 */

import { uploadFile } from "@huggingface/hub";

const HF_TOKEN = process.env.HF_TOKEN;
const HF_REPO = "patruff/molt-benchmark";
const API_BASE = process.env.API_BASE || "http://localhost:3000";

if (!HF_TOKEN) {
  console.error("ERROR: HF_TOKEN environment variable is required.");
  console.error("Get a token at https://huggingface.co/settings/tokens");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Fetch data from MoltApp API
// ---------------------------------------------------------------------------

async function fetchJSON(path: string): Promise<unknown> {
  const url = `${API_BASE}${path}`;
  console.log(`Fetching ${url}...`);
  const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${url}`);
  }
  return resp.json();
}

// ---------------------------------------------------------------------------
// Main sync
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== MoltApp V30 HuggingFace Sync ===");
  console.log(`Target: ${HF_REPO}`);
  console.log(`API: ${API_BASE}`);
  console.log("");

  // 1. Fetch benchmark data
  let leaderboardData: Record<string, unknown> = {};
  let tradeGradesData: Record<string, unknown> = {};
  let dimensionsData: Record<string, unknown> = {};
  let calibrationData: Record<string, unknown> = {};
  let summaryData: Record<string, unknown> = {};

  try {
    leaderboardData = (await fetchJSON("/api/v1/benchmark-v30/leaderboard")) as Record<string, unknown>;
    console.log("✓ Leaderboard fetched");
  } catch (e) {
    console.warn("⚠ Leaderboard fetch failed, using empty:", (e as Error).message);
  }

  try {
    tradeGradesData = (await fetchJSON("/api/v1/benchmark-v30/trade-grades?limit=200")) as Record<string, unknown>;
    console.log("✓ Trade grades fetched");
  } catch (e) {
    console.warn("⚠ Trade grades fetch failed:", (e as Error).message);
  }

  try {
    dimensionsData = (await fetchJSON("/api/v1/benchmark-v30/dimensions")) as Record<string, unknown>;
    console.log("✓ Dimensions fetched");
  } catch (e) {
    console.warn("⚠ Dimensions fetch failed:", (e as Error).message);
  }

  try {
    calibrationData = (await fetchJSON("/api/v1/benchmark-v30/calibration")) as Record<string, unknown>;
    console.log("✓ Calibration fetched");
  } catch (e) {
    console.warn("⚠ Calibration fetch failed:", (e as Error).message);
  }

  try {
    summaryData = (await fetchJSON("/api/v1/benchmark-v30/export/summary")) as Record<string, unknown>;
    console.log("✓ Summary fetched");
  } catch (e) {
    console.warn("⚠ Summary fetch failed:", (e as Error).message);
  }

  // 2. Build dataset card (README.md)
  const datasetCard = `---
license: apache-2.0
task_categories:
  - text-classification
  - text-generation
language:
  - en
tags:
  - finance
  - trading
  - benchmark
  - ai-agents
  - llm-evaluation
  - reasoning
  - solana
pretty_name: 'MoltApp: AI Trading Agent Benchmark'
size_categories:
  - 1K<n<10K
---

# MoltApp v30 — AI Trading Agent Benchmark

**Industry-standard benchmark for evaluating AI trading agents.**

Live evaluation of AI agents (Claude, GPT-4o, Grok) trading tokenized real-world stocks on Solana.
Measures **20 dimensions** of agent intelligence including reasoning quality, safety, and financial performance.

## Benchmark Dimensions (20)

### Financial Performance (3)
- **pnl_percent** — Return on investment
- **sharpe_ratio** — Risk-adjusted return
- **max_drawdown** — Largest peak-to-trough decline

### Reasoning Quality (5)
- **coherence** — Does reasoning match the trade action?
- **reasoning_depth** — Multi-step reasoning sophistication
- **source_quality** — Breadth of data sources cited
- **logical_consistency** — Internal logical consistency
- **reasoning_integrity** — Cryptographic verification of reasoning

### Safety & Trust (3)
- **hallucination_rate** — Rate of factually incorrect claims
- **instruction_discipline** — Compliance with trading rules
- **risk_awareness** — Explicit risk discussion in reasoning

### Behavioral Intelligence (4)
- **strategy_consistency** — Adherence to declared strategy
- **adaptability** — Learning from losses
- **confidence_calibration** — Confidence vs outcome correlation
- **cross_round_learning** — Evidence of improvement

### Predictive Power (3)
- **outcome_accuracy** — Prediction accuracy
- **market_regime_awareness** — Market condition recognition
- **edge_consistency** — Consistency of trading edge

### Governance (2)
- **trade_accountability** — Acknowledging past mistakes
- **reasoning_quality_index** — Aggregate reasoning quality

## Agents

| Agent | Provider | Model | Style |
|-------|----------|-------|-------|
| Claude ValueBot | Anthropic | claude-sonnet-4 | Conservative value investing |
| GPT MomentumBot | OpenAI | gpt-4o | Aggressive momentum trading |
| Grok ContrarianBot | xAI | grok-3 | Contrarian dip-buying |

## Links

- **Website**: [patgpt.us](https://www.patgpt.us)
- **Live Benchmark**: [patgpt.us/benchmark-v30](https://www.patgpt.us/benchmark-v30)
- **API**: [patgpt.us/api/v1/benchmark-v30/leaderboard](https://www.patgpt.us/api/v1/benchmark-v30/leaderboard)

## Citation

\`\`\`
@misc{moltapp2026,
  title={MoltApp: A 20-Dimension Benchmark for AI Trading Agents},
  author={PatGPT},
  year={2026},
  url={https://www.patgpt.us}
}
\`\`\`

*Updated: ${new Date().toISOString()}*
`;

  // 3. Build JSONL trade data
  const trades = (tradeGradesData as { trades?: unknown[] })?.trades ?? [];
  const jsonlLines = (trades as Record<string, unknown>[]).map((t) => JSON.stringify({
    agent_id: t.agentId,
    symbol: t.symbol,
    action: t.action,
    reasoning: t.reasoning,
    confidence: t.confidence,
    coherence_score: t.coherenceScore,
    hallucination_flags: t.hallucinationFlags,
    discipline_passed: t.disciplinePassed,
    reasoning_depth_score: t.reasoningDepthScore,
    source_quality_score: t.sourceQualityScore,
    integrity_hash: t.integrityHash,
    predicted_outcome: t.predictedOutcome,
    overall_grade: t.overallGrade,
    graded_at: t.gradedAt,
    benchmark_version: "30.0",
  })).join("\n");

  // 4. Upload to HuggingFace
  const credentials = { accessToken: HF_TOKEN };
  const repo = { type: "dataset" as const, name: HF_REPO };

  console.log("\nUploading to HuggingFace...");

  try {
    // Upload README (dataset card)
    await uploadFile({
      file: { path: "README.md", content: new Blob([datasetCard]) },
      repo,
      credentials,
      commitTitle: "Update v30 benchmark dataset card",
    });
    console.log("✓ README.md uploaded");

    // Upload leaderboard
    await uploadFile({
      file: { path: "v30/leaderboard.json", content: new Blob([JSON.stringify(leaderboardData, null, 2)]) },
      repo,
      credentials,
      commitTitle: "Update v30 leaderboard",
    });
    console.log("✓ v30/leaderboard.json uploaded");

    // Upload trade grades JSONL
    if (jsonlLines.length > 0) {
      await uploadFile({
        file: { path: "v30/trades.jsonl", content: new Blob([jsonlLines]) },
        repo,
        credentials,
        commitTitle: "Update v30 trade grades",
      });
      console.log(`✓ v30/trades.jsonl uploaded (${trades.length} trades)`);
    }

    // Upload dimensions
    await uploadFile({
      file: { path: "v30/dimensions.json", content: new Blob([JSON.stringify(dimensionsData, null, 2)]) },
      repo,
      credentials,
      commitTitle: "Update v30 dimension methodology",
    });
    console.log("✓ v30/dimensions.json uploaded");

    // Upload calibration
    await uploadFile({
      file: { path: "v30/calibration.json", content: new Blob([JSON.stringify(calibrationData, null, 2)]) },
      repo,
      credentials,
      commitTitle: "Update v30 cross-agent calibration",
    });
    console.log("✓ v30/calibration.json uploaded");

    // Upload full summary
    await uploadFile({
      file: { path: "v30/summary.json", content: new Blob([JSON.stringify(summaryData, null, 2)]) },
      repo,
      credentials,
      commitTitle: "Update v30 full benchmark summary",
    });
    console.log("✓ v30/summary.json uploaded");

    // Upload eval config
    const evalConfig = {
      benchmark: "moltapp-v30",
      version: "30.0",
      dimensions: 20,
      agents: ["claude-value-investor", "gpt-momentum-trader", "grok-contrarian"],
      website: "https://www.patgpt.us",
      scoring: {
        composite_method: "weighted_sum",
        tiers: { S: ">=85", A: ">=70", B: ">=55", C: ">=40", D: "<40" },
      },
      updated_at: new Date().toISOString(),
    };
    await uploadFile({
      file: { path: "v30/eval_config.json", content: new Blob([JSON.stringify(evalConfig, null, 2)]) },
      repo,
      credentials,
      commitTitle: "Update v30 eval configuration",
    });
    console.log("✓ v30/eval_config.json uploaded");

    console.log("\n=== SYNC COMPLETE ===");
    console.log(`Dataset: https://huggingface.co/datasets/${HF_REPO}`);
    console.log(`Trades uploaded: ${trades.length}`);
    console.log(`Dimensions: 20`);

  } catch (error) {
    console.error("\nUpload failed:", error);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
