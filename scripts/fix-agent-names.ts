#!/usr/bin/env npx tsx
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import { eq } from "drizzle-orm";

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

const { db } = await import("../src/db/index.ts");
const { agents } = await import("../src/db/schema/agents.ts");
const { positions } = await import("../src/db/schema/index.ts");

console.log("=== Current Agent Names ===");
const allAgents = await db.select().from(agents);
for (const a of allAgents) {
  console.log(`  ${a.id}: "${a.name}"`);
}

console.log("\n=== Updating Agent Names ===");

// Update Claude agent
await db.update(agents)
  .set({ name: "Opus 4.5" })
  .where(eq(agents.id, "claude-value-investor"));
console.log("  claude-value-investor -> Opus 4.5");

// Update GPT agent
await db.update(agents)
  .set({ name: "GPT-5.2" })
  .where(eq(agents.id, "gpt-momentum-trader"));
console.log("  gpt-momentum-trader -> GPT-5.2");

// Update Grok agent
await db.update(agents)
  .set({ name: "Grok 4" })
  .where(eq(agents.id, "grok-contrarian"));
console.log("  grok-contrarian -> Grok 4");

console.log("\n=== Checking Positions ===");
const allPositions = await db.select().from(positions);
console.log(`Total positions in DB: ${allPositions.length}`);
for (const p of allPositions) {
  console.log(`  Agent: ${p.agentId}, Symbol: ${p.symbol}, Qty: ${p.quantity}, Value: ${p.currentValue}`);
}

console.log("\n=== Updated Agent Names ===");
const updatedAgents = await db.select().from(agents);
for (const a of updatedAgents) {
  console.log(`  ${a.id}: "${a.name}"`);
}

process.exit(0);
