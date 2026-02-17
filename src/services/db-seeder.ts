/**
 * Database Seeder
 *
 * Initializes the database with required agent records, API keys, and
 * wallet placeholders for the 3 competing AI agents. This must run before
 * the first trading round to ensure the orchestrator has valid agent records.
 *
 * Designed to be idempotent — running multiple times is safe and will not
 * duplicate records. Uses INSERT ... ON CONFLICT DO NOTHING patterns.
 *
 * Features:
 * - Creates agent profiles for Claude, GPT, Grok
 * - Creates placeholder wallet records (replaced by real wallets on deploy)
 * - Creates API keys for each agent
 * - Validates existing records and reports status
 * - Dry-run mode for checking what would be created
 * - Can be called from Lambda cold start or CLI script
 */

import { db } from "../db/index.ts";
import { agents } from "../db/schema/agents.ts";
import { errorMessage } from "../lib/errors.ts";
import { wallets } from "../db/schema/wallets.ts";
import { apiKeys } from "../db/schema/api-keys.ts";
import { eq, sql } from "drizzle-orm";
import { countByCondition } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Display Formatting Constants
// ---------------------------------------------------------------------------

/**
 * Number of hex characters used to display the seed hash.
 *
 * The simpleHash() function produces a 32-bit integer converted to hex.
 * padStart(16, "0") left-pads to exactly 16 hex chars (64-bit display width),
 * matching the visual width of a real SHA-256 hash prefix.
 *
 * Example: hash 0x1a2b3c → "000000001a2b3c00" (16 chars wide)
 */
const HASH_HEX_DISPLAY_LENGTH = 16;

/**
 * Number of trailing base-36 characters taken from Date.now() for API key uniqueness.
 *
 * Date.now() in base-36 is ~8 chars. Taking the last 6 chars gives enough
 * entropy for seed key uniqueness within a single deployment run.
 *
 * Example: Date.now() = "lf3p2q" → suffix = "3p2q" (last 6 chars)
 */
const TIMESTAMP_SUFFIX_LENGTH = 6;

/**
 * Number of characters shown as the API key prefix stored in the database.
 *
 * The prefix (e.g., "mk_claude-tr") is stored alongside the key hash so
 * operators can identify which key is which without exposing the full key.
 *
 * Format: mk_{agentId}_seed_{timestamp} → first 12 chars as prefix
 * Example: "mk_claude-trader_seed_a1b2c3" → prefix = "mk_claude-tr"
 */
const API_KEY_PREFIX_LENGTH = 12;

/**
 * Number of characters shown when displaying wallet addresses or key hashes in logs.
 *
 * Showing the first 8 characters of a base-58 wallet address or hex hash
 * provides enough context to identify a specific record in logs without
 * exposing the full sensitive value.
 *
 * Example: "7xK9mD3qAbCdEfGh..." → shows "7xK9mD3q" (8 chars + "...")
 */
const ADDRESS_DISPLAY_LENGTH = 8;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SeedRecord {
  table: string;
  id: string;
  action: "created" | "exists" | "error";
  message: string;
}

export interface SeedResult {
  success: boolean;
  durationMs: number;
  timestamp: string;
  records: SeedRecord[];
  summary: {
    created: number;
    existing: number;
    errors: number;
  };
}

// ---------------------------------------------------------------------------
// Agent Seed Data
// ---------------------------------------------------------------------------

interface AgentSeedData {
  id: string;
  name: string;
  description: string;
  avatarUrl: string;
  ownerXHandle: string;
  ownerXName: string;
}

const AGENT_SEEDS: AgentSeedData[] = [
  {
    id: "claude-trader",
    name: "Claude Trader",
    description:
      "Anthropic's Claude analyzes market data with careful reasoning. Focuses on risk-adjusted returns and fundamental analysis. Tends toward conservative, well-reasoned positions with clear conviction signals.",
    avatarUrl: "/agents/claude.png",
    ownerXHandle: "AnthropicAI",
    ownerXName: "Anthropic",
  },
  {
    id: "gpt-trader",
    name: "GPT Trader",
    description:
      "OpenAI's GPT combines technical analysis with sentiment scoring. Balances momentum and value factors. Known for adaptive strategies that shift based on market regime detection.",
    avatarUrl: "/agents/gpt.png",
    ownerXHandle: "OpenAI",
    ownerXName: "OpenAI",
  },
  {
    id: "grok-trader",
    name: "Grok Trader",
    description:
      "xAI's Grok takes a contrarian, high-conviction approach. Seeks asymmetric risk/reward setups and is willing to go against consensus. The wildcard agent that can surprise with unconventional moves.",
    avatarUrl: "/agents/grok.png",
    ownerXHandle: "xaboratory",
    ownerXName: "xAI",
  },
];

// ---------------------------------------------------------------------------
// Wallet Seed Data
// ---------------------------------------------------------------------------

interface WalletSeedData {
  agentId: string;
  publicKey: string;
  turnkeyWalletId: string;
}

function getWalletSeeds(): WalletSeedData[] {
  return [
    {
      agentId: "claude-trader",
      publicKey:
        process.env.CLAUDE_WALLET_ADDRESS ||
        "11111111111111111111111111111111",
      turnkeyWalletId:
        process.env.CLAUDE_TURNKEY_WALLET_ID || "placeholder-claude",
    },
    {
      agentId: "gpt-trader",
      publicKey:
        process.env.GPT_WALLET_ADDRESS ||
        "11111111111111111111111111111112",
      turnkeyWalletId:
        process.env.GPT_TURNKEY_WALLET_ID || "placeholder-gpt",
    },
    {
      agentId: "grok-trader",
      publicKey:
        process.env.GROK_WALLET_ADDRESS ||
        "11111111111111111111111111111113",
      turnkeyWalletId:
        process.env.GROK_TURNKEY_WALLET_ID || "placeholder-grok",
    },
  ];
}

// ---------------------------------------------------------------------------
// API Key Seed Data
// ---------------------------------------------------------------------------

interface ApiKeySeedData {
  agentId: string;
  keyHash: string;
  keyPrefix: string;
}

/**
 * Simple hash function for seed API keys.
 * In production, the auth middleware handles real SHA-256 hashing.
 */
function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash).toString(16).padStart(HASH_HEX_DISPLAY_LENGTH, "0");
}

function generateApiKey(agentId: string): string {
  return `mk_${agentId}_seed_${Date.now().toString(36).slice(-TIMESTAMP_SUFFIX_LENGTH)}`;
}

function getApiKeySeeds(): ApiKeySeedData[] {
  return AGENT_SEEDS.map((agent) => {
    const fullKey = generateApiKey(agent.id);
    return {
      agentId: agent.id,
      keyHash: simpleHash(fullKey),
      keyPrefix: fullKey.slice(0, API_KEY_PREFIX_LENGTH),
    };
  });
}

// ---------------------------------------------------------------------------
// Seeding Functions
// ---------------------------------------------------------------------------

/**
 * Seed agent records. Uses INSERT ... ON CONFLICT DO NOTHING.
 */
async function seedAgents(records: SeedRecord[]): Promise<void> {
  for (const agent of AGENT_SEEDS) {
    try {
      // Check if agent already exists
      const existing = await db
        .select({ id: agents.id })
        .from(agents)
        .where(eq(agents.id, agent.id))
        .limit(1);

      if (existing.length > 0) {
        records.push({
          table: "agents",
          id: agent.id,
          action: "exists",
          message: `Agent ${agent.name} already exists`,
        });
        continue;
      }

      await db.insert(agents).values({
        id: agent.id,
        name: agent.name,
        description: agent.description,
        avatarUrl: agent.avatarUrl,
        ownerXHandle: agent.ownerXHandle,
        ownerXName: agent.ownerXName,
        isActive: true,
      });

      records.push({
        table: "agents",
        id: agent.id,
        action: "created",
        message: `Created agent ${agent.name}`,
      });
    } catch (err) {
      // Handle unique constraint violations gracefully
      const errMsg = errorMessage(err);
      if (errMsg.includes("duplicate") || errMsg.includes("unique")) {
        records.push({
          table: "agents",
          id: agent.id,
          action: "exists",
          message: `Agent ${agent.name} already exists (conflict)`,
        });
      } else {
        records.push({
          table: "agents",
          id: agent.id,
          action: "error",
          message: `Failed to create agent ${agent.name}: ${errMsg}`,
        });
      }
    }
  }
}

/**
 * Seed wallet records for each agent.
 */
async function seedWallets(records: SeedRecord[]): Promise<void> {
  const walletSeeds = getWalletSeeds();

  for (const wallet of walletSeeds) {
    try {
      // Check if wallet already exists for this agent
      const existing = await db
        .select({ id: wallets.id })
        .from(wallets)
        .where(eq(wallets.agentId, wallet.agentId))
        .limit(1);

      if (existing.length > 0) {
        records.push({
          table: "wallets",
          id: wallet.agentId,
          action: "exists",
          message: `Wallet for ${wallet.agentId} already exists`,
        });
        continue;
      }

      await db.insert(wallets).values({
        agentId: wallet.agentId,
        publicKey: wallet.publicKey,
        turnkeyWalletId: wallet.turnkeyWalletId,
      });

      records.push({
        table: "wallets",
        id: wallet.agentId,
        action: "created",
        message: `Created wallet for ${wallet.agentId} (${wallet.publicKey.slice(0, ADDRESS_DISPLAY_LENGTH)}...)`,
      });
    } catch (err) {
      const errMsg = errorMessage(err);
      if (errMsg.includes("duplicate") || errMsg.includes("unique")) {
        records.push({
          table: "wallets",
          id: wallet.agentId,
          action: "exists",
          message: `Wallet for ${wallet.agentId} already exists (conflict)`,
        });
      } else {
        records.push({
          table: "wallets",
          id: wallet.agentId,
          action: "error",
          message: `Failed to create wallet for ${wallet.agentId}: ${errMsg}`,
        });
      }
    }
  }
}

/**
 * Seed API keys for each agent.
 */
async function seedApiKeys(records: SeedRecord[]): Promise<void> {
  const keySeeds = getApiKeySeeds();

  for (const keySeed of keySeeds) {
    try {
      // Check if API key already exists for this agent
      const existing = await db
        .select({ id: apiKeys.id })
        .from(apiKeys)
        .where(eq(apiKeys.agentId, keySeed.agentId))
        .limit(1);

      if (existing.length > 0) {
        records.push({
          table: "api_keys",
          id: keySeed.agentId,
          action: "exists",
          message: `API key for ${keySeed.agentId} already exists`,
        });
        continue;
      }

      await db.insert(apiKeys).values({
        agentId: keySeed.agentId,
        keyHash: keySeed.keyHash,
        keyPrefix: keySeed.keyPrefix,
      });

      records.push({
        table: "api_keys",
        id: keySeed.agentId,
        action: "created",
        message: `Created API key for ${keySeed.agentId}`,
      });
    } catch (err) {
      const errMsg = errorMessage(err);
      if (errMsg.includes("duplicate") || errMsg.includes("unique")) {
        records.push({
          table: "api_keys",
          id: keySeed.agentId,
          action: "exists",
          message: `API key for ${keySeed.agentId} already exists (conflict)`,
        });
      } else {
        records.push({
          table: "api_keys",
          id: keySeed.agentId,
          action: "error",
          message: `Failed to create API key for ${keySeed.agentId}: ${errMsg}`,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main Seeder
// ---------------------------------------------------------------------------

/**
 * Run the full database seeder.
 *
 * This is idempotent — safe to call multiple times. Existing records
 * are left untouched. Only missing records are created.
 *
 * @returns A SeedResult with details about what was created/skipped.
 */
export async function seedDatabase(): Promise<SeedResult> {
  const startTime = Date.now();
  const records: SeedRecord[] = [];

  console.log("[DBSeeder] Starting database seed...");

  try {
    // Verify database connectivity first
    await db.execute(sql`SELECT 1`);
  } catch (err) {
    const errMsg = errorMessage(err);
    console.error(`[DBSeeder] Database not accessible: ${errMsg}`);
    return {
      success: false,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
      records: [
        {
          table: "connection",
          id: "database",
          action: "error",
          message: `Database not accessible: ${errMsg}`,
        },
      ],
      summary: { created: 0, existing: 0, errors: 1 },
    };
  }

  // Seed in dependency order: agents first, then wallets & keys (they reference agents)
  await seedAgents(records);
  await seedWallets(records);
  await seedApiKeys(records);

  const created = countByCondition(records, (r) => r.action === "created");
  const existing = countByCondition(records, (r) => r.action === "exists");
  const errors = countByCondition(records, (r) => r.action === "error");
  const durationMs = Date.now() - startTime;

  console.log(
    `[DBSeeder] Seed complete: ${created} created, ${existing} existing, ${errors} errors — ${durationMs}ms`,
  );

  for (const record of records) {
    const icon =
      record.action === "created"
        ? "+"
        : record.action === "exists"
          ? "="
          : "!";
    console.log(
      `[DBSeeder]   ${icon} ${record.table}/${record.id}: ${record.message}`,
    );
  }

  return {
    success: errors === 0,
    durationMs,
    timestamp: new Date().toISOString(),
    records,
    summary: { created, existing, errors },
  };
}

/**
 * Check seed status without making changes (dry-run equivalent).
 * Returns what would need to be created.
 */
export async function checkSeedStatus(): Promise<{
  ready: boolean;
  agentsExist: boolean;
  walletsExist: boolean;
  apiKeysExist: boolean;
  missingAgents: string[];
  missingWallets: string[];
  missingApiKeys: string[];
}> {
  const missingAgents: string[] = [];
  const missingWallets: string[] = [];
  const missingApiKeys: string[] = [];

  try {
    for (const agent of AGENT_SEEDS) {
      const existing = await db
        .select({ id: agents.id })
        .from(agents)
        .where(eq(agents.id, agent.id))
        .limit(1);
      if (existing.length === 0) {
        missingAgents.push(agent.id);
      }
    }

    for (const wallet of getWalletSeeds()) {
      const existing = await db
        .select({ id: wallets.id })
        .from(wallets)
        .where(eq(wallets.agentId, wallet.agentId))
        .limit(1);
      if (existing.length === 0) {
        missingWallets.push(wallet.agentId);
      }
    }

    for (const keySeed of getApiKeySeeds()) {
      const existing = await db
        .select({ id: apiKeys.id })
        .from(apiKeys)
        .where(eq(apiKeys.agentId, keySeed.agentId))
        .limit(1);
      if (existing.length === 0) {
        missingApiKeys.push(keySeed.agentId);
      }
    }
  } catch {
    // Database not accessible — everything is "missing"
    return {
      ready: false,
      agentsExist: false,
      walletsExist: false,
      apiKeysExist: false,
      missingAgents: AGENT_SEEDS.map((a) => a.id),
      missingWallets: getWalletSeeds().map((w) => w.agentId),
      missingApiKeys: getApiKeySeeds().map((k) => k.agentId),
    };
  }

  return {
    ready:
      missingAgents.length === 0 &&
      missingWallets.length === 0 &&
      missingApiKeys.length === 0,
    agentsExist: missingAgents.length === 0,
    walletsExist: missingWallets.length === 0,
    apiKeysExist: missingApiKeys.length === 0,
    missingAgents,
    missingWallets,
    missingApiKeys,
  };
}

/**
 * Get the list of agent IDs that should be seeded.
 */
export function getAgentSeedIds(): string[] {
  return AGENT_SEEDS.map((a) => a.id);
}

/**
 * Get full seed data for inspection (no DB queries).
 */
export function getSeedData() {
  return {
    agents: AGENT_SEEDS,
    wallets: getWalletSeeds().map((w) => ({
      ...w,
      publicKey: w.publicKey.slice(0, ADDRESS_DISPLAY_LENGTH) + "...",
    })),
    apiKeys: getApiKeySeeds().map((k) => ({
      agentId: k.agentId,
      keyPrefix: k.keyPrefix,
      keyHash: k.keyHash.slice(0, ADDRESS_DISPLAY_LENGTH) + "...",
    })),
  };
}
