#!/usr/bin/env npx tsx
/**
 * Seed the agents table with the 3 trading agents.
 * Required for foreign key references from trades, positions, trade_justifications, etc.
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Load .env BEFORE any other imports (db needs DATABASE_URL at import time)
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

// Dynamic imports AFTER env is loaded
const { db } = await import("../src/db/index.ts");
const { agents } = await import("../src/db/schema/agents.ts");

const AGENT_SEEDS = [
  {
    id: "claude-value-investor",
    name: "Opus 4.6",
    description: "Flagship autonomous trading agent powered by Anthropic Claude Opus 4.6 — the most capable reasoning model.",
  },
  {
    id: "gpt-momentum-trader",
    name: "GPT-5.2",
    description: "Flagship autonomous trading agent powered by OpenAI GPT-5.2 with xhigh reasoning effort — top-tier intelligence with 400K context.",
  },
  {
    id: "grok-contrarian",
    name: "Grok 4",
    description: "Flagship autonomous trading agent powered by xAI Grok 4 — frontier reasoning model with real-time X/Twitter sentiment.",
  },
];

console.log("Seeding agents table...");
for (const agent of AGENT_SEEDS) {
  await db
    .insert(agents)
    .values(agent)
    .onConflictDoUpdate({
      target: agents.id,
      set: { name: agent.name, description: agent.description },
    });
  console.log(`  Seeded: ${agent.id} (${agent.name})`);
}
console.log("Done!\n");
process.exit(0);
