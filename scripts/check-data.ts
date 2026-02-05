#!/usr/bin/env npx tsx
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";

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
const { positions } = await import("../src/db/schema/index.ts");
const { agents } = await import("../src/db/schema/agents.ts");

const allPositions = await db.select().from(positions);
console.log("Total positions:", allPositions.length);
if (allPositions.length > 0) {
  console.log("Sample positions:");
  for (const p of allPositions.slice(0, 5)) {
    console.log(`  Agent: ${p.agentId}, Symbol: ${p.symbol}, Qty: ${p.quantity}`);
  }
}

const allAgents = await db.select().from(agents);
console.log("\nAgents:");
for (const a of allAgents) {
  console.log(`  ID: ${a.id}, Name: ${a.name}, Active: ${a.isActive}`);
}

process.exit(0);
