/**
 * Wallet Provisioner Service
 *
 * Automates the creation and setup of Turnkey-managed Solana wallets for
 * AI trading agents. This bridges the gap between the existing wallet.ts
 * (low-level Turnkey SDK) and agent-wallets.ts (agent config management).
 *
 * Features:
 * - Create wallets for all 3 agents via Turnkey HSM
 * - Store wallet addresses in DynamoDB for persistence across deploys
 * - Fund verification: ensure wallets have SOL for fees before trading
 * - Wallet recovery: re-derive addresses from existing Turnkey wallets
 * - Provisioning status tracking
 */

import { createAgentWallet, getTurnkeySigner } from "./wallet.ts";
import { errorMessage } from "../lib/errors.ts";
import { countByCondition } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProvisionedWallet {
  agentId: string;
  agentName: string;
  publicKey: string;
  turnkeyWalletId: string;
  provisionedAt: string;
  status: "active" | "pending_fund" | "error";
  errorMessage?: string;
}

export interface ProvisioningResult {
  success: boolean;
  wallets: ProvisionedWallet[];
  errors: string[];
  durationMs: number;
}

export interface WalletHealthCheck {
  agentId: string;
  publicKey: string;
  solBalance: number;
  hasSufficientFees: boolean;
  signerAvailable: boolean;
  lastCheckedAt: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const AGENT_DEFINITIONS = [
  {
    agentId: "claude-trader",
    agentName: "Claude Trader",
    envKey: "CLAUDE_WALLET_ADDRESS",
    turnkeyEnvKey: "CLAUDE_TURNKEY_WALLET_ID",
  },
  {
    agentId: "gpt-trader",
    agentName: "GPT Trader",
    envKey: "GPT_WALLET_ADDRESS",
    turnkeyEnvKey: "GPT_TURNKEY_WALLET_ID",
  },
  {
    agentId: "grok-trader",
    agentName: "Grok Trader",
    envKey: "GROK_WALLET_ADDRESS",
    turnkeyEnvKey: "GROK_TURNKEY_WALLET_ID",
  },
] as const;

/** Minimum SOL for transaction fees */
const MIN_SOL_FOR_FEES = 0.01;

/**
 * DynamoDB TTL for wallet records: 1 year in seconds.
 * Wallet records persist for 1 year before DynamoDB auto-expires them.
 * Formula: 365 days × 24 hours × 60 minutes × 60 seconds = 31,536,000 seconds
 */
const DYNAMODB_TTL_SECONDS_ONE_YEAR = 365 * 24 * 60 * 60;

/**
 * Solana System Program address (all 1s) used as a placeholder/null wallet.
 * This is the default value when no wallet address is configured — it is not
 * a valid agent wallet and triggers new wallet creation via Turnkey.
 * The System Program owns all uninitialized accounts on Solana.
 */
const SOLANA_PLACEHOLDER_ADDRESS = "11111111111111111111111111111111";

/**
 * Number of characters to show when displaying a wallet address in logs.
 * Shows the first 8 characters followed by "..." for readability.
 * Example: "7xK9mD3q..." instead of the full 44-character base58 address.
 */
const WALLET_ADDRESS_DISPLAY_LENGTH = 8;

// ---------------------------------------------------------------------------
// In-Memory Wallet Registry
// ---------------------------------------------------------------------------

const walletRegistry = new Map<string, ProvisionedWallet>();

// ---------------------------------------------------------------------------
// DynamoDB Persistence
// ---------------------------------------------------------------------------

/**
 * Store provisioned wallet to DynamoDB.
 * Uses the AGENT_STATE_TABLE for persistence across Lambda invocations.
 */
async function persistWalletToDynamo(
  wallet: ProvisionedWallet,
): Promise<void> {
  const tableName = process.env.AGENT_STATE_TABLE;
  if (!tableName) {
    console.warn(
      "[WalletProvisioner] AGENT_STATE_TABLE not set — wallet not persisted to DynamoDB",
    );
    return;
  }

  try {
    const { DynamoDBClient, PutItemCommand } = await import(
      "@aws-sdk/client-dynamodb"
    );
    const client = new DynamoDBClient({});

    await client.send(
      new PutItemCommand({
        TableName: tableName,
        Item: {
          agentId: { S: `wallet#${wallet.agentId}` },
          status: { S: "wallet" },
          publicKey: { S: wallet.publicKey },
          turnkeyWalletId: { S: wallet.turnkeyWalletId },
          agentName: { S: wallet.agentName },
          provisionedAt: { S: wallet.provisionedAt },
          walletStatus: { S: wallet.status },
          lastTradeTimestamp: { S: wallet.provisionedAt },
          ttl: {
            N: String(
              Math.floor(Date.now() / 1000) + DYNAMODB_TTL_SECONDS_ONE_YEAR,
            ),
          }, // 1 year TTL
        },
      }),
    );

    console.log(
      `[WalletProvisioner] Persisted wallet for ${wallet.agentId} to DynamoDB`,
    );
  } catch (err) {
    console.error(
      `[WalletProvisioner] Failed to persist wallet to DynamoDB: ${errorMessage(err)}`,
    );
  }
}

/**
 * Load provisioned wallets from DynamoDB.
 */
async function loadWalletsFromDynamo(): Promise<ProvisionedWallet[]> {
  const tableName = process.env.AGENT_STATE_TABLE;
  if (!tableName) return [];

  try {
    const { DynamoDBClient, QueryCommand } = await import(
      "@aws-sdk/client-dynamodb"
    );
    const client = new DynamoDBClient({});

    const results: ProvisionedWallet[] = [];

    for (const def of AGENT_DEFINITIONS) {
      try {
        const result = await client.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: "agentId = :aid",
            ExpressionAttributeValues: {
              ":aid": { S: `wallet#${def.agentId}` },
            },
            Limit: 1,
          }),
        );

        if (result.Items && result.Items.length > 0) {
          const item = result.Items[0];
          results.push({
            agentId: def.agentId,
            agentName: item.agentName?.S ?? def.agentName,
            publicKey: item.publicKey?.S ?? "",
            turnkeyWalletId: item.turnkeyWalletId?.S ?? "",
            provisionedAt: item.provisionedAt?.S ?? "",
            status: (item.walletStatus?.S as ProvisionedWallet["status"]) ?? "active",
          });
        }
      } catch {
        // Individual agent query failure is non-fatal
      }
    }

    console.log(
      `[WalletProvisioner] Loaded ${results.length} wallets from DynamoDB`,
    );
    return results;
  } catch (err) {
    console.warn(
      `[WalletProvisioner] Failed to load wallets from DynamoDB: ${errorMessage(err)}`,
    );
    return [];
  }
}

// ---------------------------------------------------------------------------
// Core Provisioning
// ---------------------------------------------------------------------------

/**
 * Provision wallets for all 3 agents.
 *
 * For each agent:
 * 1. Check if wallet address is already in env or DynamoDB
 * 2. If not, create a new wallet via Turnkey
 * 3. Store the address for future use
 * 4. Return provisioning results
 */
export async function provisionAllWallets(): Promise<ProvisioningResult> {
  const startTime = Date.now();
  const results: ProvisionedWallet[] = [];
  const errors: string[] = [];

  console.log("[WalletProvisioner] Starting wallet provisioning for 3 agents...");

  // First, try to load existing wallets from DynamoDB
  const existingWallets = await loadWalletsFromDynamo();
  for (const w of existingWallets) {
    walletRegistry.set(w.agentId, w);
  }

  for (const def of AGENT_DEFINITIONS) {
    try {
      // Check if wallet already exists via env var
      const envAddress = process.env[def.envKey];
      if (envAddress && envAddress !== SOLANA_PLACEHOLDER_ADDRESS) {
        const existing: ProvisionedWallet = {
          agentId: def.agentId,
          agentName: def.agentName,
          publicKey: envAddress,
          turnkeyWalletId: process.env[def.turnkeyEnvKey] ?? "env-configured",
          provisionedAt: new Date().toISOString(),
          status: "active",
        };
        walletRegistry.set(def.agentId, existing);
        results.push(existing);
        console.log(
          `[WalletProvisioner] ${def.agentName}: Using env wallet ${envAddress.slice(0, WALLET_ADDRESS_DISPLAY_LENGTH)}...`,
        );
        continue;
      }

      // Check if wallet was loaded from DynamoDB
      const cached = walletRegistry.get(def.agentId);
      if (cached && cached.publicKey) {
        results.push(cached);
        console.log(
          `[WalletProvisioner] ${def.agentName}: Using DynamoDB wallet ${cached.publicKey.slice(0, WALLET_ADDRESS_DISPLAY_LENGTH)}...`,
        );
        continue;
      }

      // Check Turnkey credentials are available
      if (
        !process.env.TURNKEY_API_PRIVATE_KEY ||
        !process.env.TURNKEY_API_PUBLIC_KEY ||
        !process.env.TURNKEY_ORGANIZATION_ID
      ) {
        const msg = `${def.agentName}: Turnkey credentials not configured — cannot create wallet`;
        errors.push(msg);
        console.warn(`[WalletProvisioner] ${msg}`);
        results.push({
          agentId: def.agentId,
          agentName: def.agentName,
          publicKey: "",
          turnkeyWalletId: "",
          provisionedAt: new Date().toISOString(),
          status: "error",
          errorMessage: msg,
        });
        continue;
      }

      // Create new wallet via Turnkey
      console.log(
        `[WalletProvisioner] ${def.agentName}: Creating new Turnkey wallet...`,
      );

      const { publicKey, turnkeyWalletId } = await createAgentWallet(
        def.agentId,
      );

      const wallet: ProvisionedWallet = {
        agentId: def.agentId,
        agentName: def.agentName,
        publicKey,
        turnkeyWalletId,
        provisionedAt: new Date().toISOString(),
        status: "pending_fund",
      };

      walletRegistry.set(def.agentId, wallet);
      results.push(wallet);

      // Persist to DynamoDB
      await persistWalletToDynamo(wallet);

      console.log(
        `[WalletProvisioner] ${def.agentName}: Wallet created — ${publicKey}`,
      );
    } catch (err) {
      const msg = `${def.agentName}: ${errorMessage(err)}`;
      errors.push(msg);
      console.error(`[WalletProvisioner] ${msg}`);
      results.push({
        agentId: def.agentId,
        agentName: def.agentName,
        publicKey: "",
        turnkeyWalletId: "",
        provisionedAt: new Date().toISOString(),
        status: "error",
        errorMessage: msg,
      });
    }
  }

  const durationMs = Date.now() - startTime;

  console.log(
    `[WalletProvisioner] Provisioning complete: ${countByCondition(results, (r) => r.status !== "error")}/3 wallets ready in ${durationMs}ms`,
  );

  return {
    success: errors.length === 0,
    wallets: results,
    errors,
    durationMs,
  };
}

/**
 * Get the provisioned wallet for an agent.
 */
export function getProvisionedWallet(
  agentId: string,
): ProvisionedWallet | null {
  return walletRegistry.get(agentId) ?? null;
}

/**
 * Get all provisioned wallets.
 */
export function getAllProvisionedWallets(): ProvisionedWallet[] {
  return Array.from(walletRegistry.values());
}

// ---------------------------------------------------------------------------
// Health Checks
// ---------------------------------------------------------------------------

/**
 * Check wallet health for a specific agent.
 * Verifies SOL balance and signer availability.
 */
export async function checkWalletHealth(
  agentId: string,
): Promise<WalletHealthCheck> {
  const wallet = walletRegistry.get(agentId);
  if (!wallet || !wallet.publicKey) {
    return {
      agentId,
      publicKey: "",
      solBalance: 0,
      hasSufficientFees: false,
      signerAvailable: false,
      lastCheckedAt: new Date().toISOString(),
    };
  }

  let solBalance = 0;
  let hasSufficientFees = false;

  // Check SOL balance via RPC
  try {
    const { getBalance } = await import("./solana-tracker.ts");
    const { sol } = await getBalance(wallet.publicKey);
    solBalance = sol;
    hasSufficientFees = sol >= MIN_SOL_FOR_FEES;
  } catch (err) {
    console.warn(
      `[WalletProvisioner] Balance check failed for ${agentId}: ${errorMessage(err)}`,
    );
  }

  // Check if Turnkey signer is available
  let signerAvailable = false;
  try {
    getTurnkeySigner();
    signerAvailable = true;
  } catch {
    // Signer not available (Turnkey credentials missing)
  }

  return {
    agentId,
    publicKey: wallet.publicKey,
    solBalance,
    hasSufficientFees,
    signerAvailable,
    lastCheckedAt: new Date().toISOString(),
  };
}

/**
 * Check health for all agent wallets.
 */
export async function checkAllWalletHealth(): Promise<WalletHealthCheck[]> {
  const checks = await Promise.allSettled(
    AGENT_DEFINITIONS.map((def) => checkWalletHealth(def.agentId)),
  );

  return checks
    .filter(
      (r): r is PromiseFulfilledResult<WalletHealthCheck> =>
        r.status === "fulfilled",
    )
    .map((r) => r.value);
}

/**
 * Get provisioning status summary.
 */
export function getProvisioningStatus(): {
  totalAgents: number;
  provisioned: number;
  pendingFund: number;
  errors: number;
  wallets: ProvisionedWallet[];
} {
  const wallets = getAllProvisionedWallets();
  return {
    totalAgents: AGENT_DEFINITIONS.length,
    provisioned: countByCondition(wallets, (w) => w.status === "active"),
    pendingFund: countByCondition(wallets, (w) => w.status === "pending_fund"),
    errors: countByCondition(wallets, (w) => w.status === "error"),
    wallets,
  };
}
