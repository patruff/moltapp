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
    name: "Claude ValueBot",
    description: "Conservative value investor powered by Anthropic Claude. Focuses on fundamentals, undervalued companies, and strong risk management.",
  },
  {
    id: "gpt-momentum-trader",
    name: "GPT MomentumBot",
    description: "Aggressive momentum trader powered by OpenAI GPT. Buys breakouts, rides trends, cuts losers at -5%.",
  },
  {
    id: "grok-contrarian",
    name: "Grok ContrarianBot",
    description: "Contrarian trader powered by xAI Grok. Buys the dip, fades rallies, loves beaten-down stocks.",
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
