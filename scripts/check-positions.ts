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

console.log("=== Positions with mintAddress ===");
const allPositions = await db.select().from(positions);
for (const p of allPositions) {
  console.log(`  ${p.symbol}: mintAddress=${p.mintAddress ? p.mintAddress.slice(0, 8) + "..." : "NULL"}, qty=${p.quantity}`);
}

// Test Jupiter prices
console.log("\n=== Testing Jupiter Prices ===");
const uniqueMints = [...new Set(allPositions.map(p => p.mintAddress).filter(Boolean))] as string[];
console.log(`Unique mints: ${uniqueMints.length}`);

if (uniqueMints.length > 0) {
  const url = `https://api.jup.ag/price/v2?ids=${uniqueMints.join(",")}`;
  console.log(`Fetching: ${url.slice(0, 80)}...`);
  
  try {
    const resp = await fetch(url);
    const data = await resp.json();
    console.log(`Response data keys: ${Object.keys(data.data || {}).length}`);
    for (const [mint, priceData] of Object.entries(data.data || {})) {
      const pd = priceData as { price?: string };
      console.log(`  ${mint.slice(0, 8)}...: $${pd.price || "NO PRICE"}`);
    }
  } catch (e) {
    console.log(`Error fetching prices: ${e}`);
  }
}

process.exit(0);
