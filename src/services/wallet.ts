import { Turnkey, DEFAULT_SOLANA_ACCOUNTS } from "@turnkey/sdk-server";
import { TurnkeySigner } from "@turnkey/solana";
import { env } from "../config/env.ts";
import { errorMessage } from "../lib/errors.ts";

let turnkeyInstance: InstanceType<typeof Turnkey> | null = null;

function getTurnkey(): InstanceType<typeof Turnkey> {
  if (!turnkeyInstance) {
    if (
      !env.TURNKEY_API_PRIVATE_KEY ||
      !env.TURNKEY_API_PUBLIC_KEY ||
      !env.TURNKEY_ORGANIZATION_ID
    ) {
      throw new Error(
        "wallet_config_missing: TURNKEY_API_PRIVATE_KEY, TURNKEY_API_PUBLIC_KEY, and TURNKEY_ORGANIZATION_ID are required"
      );
    }

    turnkeyInstance = new Turnkey({
      apiBaseUrl: "https://api.turnkey.com",
      apiPrivateKey: env.TURNKEY_API_PRIVATE_KEY,
      apiPublicKey: env.TURNKEY_API_PUBLIC_KEY,
      defaultOrganizationId: env.TURNKEY_ORGANIZATION_ID,
    });
  }
  return turnkeyInstance;
}

/**
 * Create a Turnkey-managed Solana wallet for an agent.
 *
 * Uses the default Solana account derivation path (m/44'/501'/0'/0').
 * Returns the Solana public key (base58) and the Turnkey internal wallet ID.
 */
export async function createAgentWallet(
  agentId: string
): Promise<{ publicKey: string; turnkeyWalletId: string }> {
  const turnkey = getTurnkey();
  const client = turnkey.apiClient();

  try {
    const result = await client.createWallet({
      walletName: `moltapp-agent-${agentId}`,
      accounts: DEFAULT_SOLANA_ACCOUNTS,
    });

    const walletId = result.walletId;
    const addresses = result.addresses;

    if (!addresses || addresses.length === 0) {
      throw new Error(
        "wallet_creation_failed: Turnkey returned no addresses for wallet"
      );
    }

    // The first address is the primary Solana address
    const publicKey = addresses[0];

    return { publicKey, turnkeyWalletId: walletId };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("wallet_")) {
      throw err;
    }
    const message = errorMessage(err);
    throw new Error(`wallet_creation_failed: ${message}`);
  }
}

/**
 * Get a TurnkeySigner instance for signing Solana transactions.
 * Used by the withdrawal flow (Plan 03).
 */
export function getTurnkeySigner(): TurnkeySigner {
  const turnkey = getTurnkey();
  const client = turnkey.apiClient();

  if (!env.TURNKEY_ORGANIZATION_ID) {
    throw new Error(
      "wallet_config_missing: TURNKEY_ORGANIZATION_ID is required for signing"
    );
  }

  return new TurnkeySigner({
    organizationId: env.TURNKEY_ORGANIZATION_ID,
    client,
  });
}
