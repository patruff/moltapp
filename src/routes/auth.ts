import { Hono } from "hono";
import { z } from "zod";
import { createHash, randomBytes } from "crypto";
import { eq, and } from "drizzle-orm";
import { db } from "../db/index.ts";
import { agents, apiKeys, wallets } from "../db/schema/index.ts";
import { verifyIdentity } from "../services/moltbook.ts";
import { createAgentWallet } from "../services/wallet.ts";
import { API_KEY_PREFIX } from "../config/constants.ts";
import { env } from "../config/env.ts";

const registerBodySchema = z.object({
  identityToken: z.string().min(1, "identityToken is required"),
});

const demoRegisterBodySchema = z.object({
  agentName: z.string().min(1, "agentName is required").max(100),
});

export const authRoutes = new Hono();

/**
 * POST /register
 *
 * Verify a Moltbook identity token, upsert agent profile,
 * and issue a MoltApp API key.
 */
authRoutes.post("/register", async (c) => {
  // 1. Parse and validate body
  const body = await c.req.json();
  const parsed = registerBodySchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { error: "validation_failed", details: parsed.error.flatten() },
      400
    );
  }

  const { identityToken } = parsed.data;

  // 2. Verify identity with Moltbook (one-time server-to-server call)
  let moltbookAgent;
  try {
    moltbookAgent = await verifyIdentity(identityToken);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "moltbook_verification_failed";

    if (message === "invalid_identity_token") {
      return c.json({ error: "invalid_identity_token" }, 401);
    }
    if (message === "moltbook_rate_limited") {
      return c.json({ error: "moltbook_rate_limited" }, 503);
    }
    return c.json({ error: "moltbook_verification_failed" }, 502);
  }

  // 3. Upsert agent profile in database
  await db
    .insert(agents)
    .values({
      id: moltbookAgent.id,
      name: moltbookAgent.name,
      description: moltbookAgent.description,
      karma: moltbookAgent.karma,
      avatarUrl: moltbookAgent.avatar_url,
      ownerXHandle: moltbookAgent.owner?.x_handle ?? null,
      ownerXName: moltbookAgent.owner?.x_name ?? null,
    })
    .onConflictDoUpdate({
      target: agents.id,
      set: {
        name: moltbookAgent.name,
        karma: moltbookAgent.karma,
        avatarUrl: moltbookAgent.avatar_url,
        ownerXHandle: moltbookAgent.owner?.x_handle ?? null,
        ownerXName: moltbookAgent.owner?.x_name ?? null,
        updatedAt: new Date(),
      },
    });

  // 4. Ensure agent has a wallet (create one if not)
  let walletAddress: string;

  const existingWallets = await db
    .select()
    .from(wallets)
    .where(eq(wallets.agentId, moltbookAgent.id))
    .limit(1);

  if (existingWallets.length > 0) {
    walletAddress = existingWallets[0].publicKey;
  } else {
    try {
      const walletResult = await createAgentWallet(moltbookAgent.id);
      await db.insert(wallets).values({
        agentId: moltbookAgent.id,
        publicKey: walletResult.publicKey,
        turnkeyWalletId: walletResult.turnkeyWalletId,
      });
      walletAddress = walletResult.publicKey;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "wallet_creation_failed";
      console.error(`Wallet creation failed for agent ${moltbookAgent.id}:`, message);
      return c.json({ error: "wallet_creation_failed" }, 502);
    }
  }

  // 5. Revoke any existing non-revoked API keys for this agent (key rotation)
  await db
    .update(apiKeys)
    .set({ isRevoked: true })
    .where(
      and(eq(apiKeys.agentId, moltbookAgent.id), eq(apiKeys.isRevoked, false))
    );

  // 6. Generate new API key
  const rawKey = randomBytes(32).toString("hex");
  const fullKey = `${API_KEY_PREFIX}${rawKey}`;
  const keyHash = createHash("sha256").update(fullKey).digest("hex");
  const keyPrefix = fullKey.substring(0, 12);

  // 7. Store hashed key in database
  await db.insert(apiKeys).values({
    agentId: moltbookAgent.id,
    keyHash,
    keyPrefix,
  });

  // 8. Return API key, wallet address, and profile to the agent
  return c.json({
    agentId: moltbookAgent.id,
    apiKey: fullKey,
    walletAddress,
    profile: {
      name: moltbookAgent.name,
      karma: moltbookAgent.karma,
      avatarUrl: moltbookAgent.avatar_url,
    },
  });
});

/**
 * POST /demo-register
 *
 * Create a demo agent without Moltbook verification (DEMO_MODE only).
 * Perfect for hackathon judges to try MoltApp immediately.
 */
authRoutes.post("/demo-register", async (c) => {
  // 1. Check if demo mode is enabled
  if (!env.DEMO_MODE) {
    return c.json(
      { error: "demo_mode_disabled", message: "Demo registration is only available when DEMO_MODE=true" },
      403
    );
  }

  // 2. Parse and validate body
  const body = await c.req.json();
  const parsed = demoRegisterBodySchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { error: "validation_failed", details: parsed.error.flatten() },
      400
    );
  }

  const { agentName } = parsed.data;

  // 3. Generate a unique demo agent ID
  const demoAgentId = `demo_${randomBytes(8).toString("hex")}`;

  // 4. Create demo agent profile
  await db.insert(agents).values({
    id: demoAgentId,
    name: agentName,
    description: "Demo agent for testing MoltApp",
    karma: 100,
    avatarUrl: null,
    ownerXHandle: null,
    ownerXName: null,
  });

  // 5. Create a mock wallet (no real Turnkey wallet in demo mode)
  const mockWalletAddress = `DEMO${randomBytes(16).toString("hex").toUpperCase()}`;
  await db.insert(wallets).values({
    agentId: demoAgentId,
    publicKey: mockWalletAddress,
    turnkeyWalletId: "demo-wallet-id",
  });

  // 6. Generate API key
  const rawKey = randomBytes(32).toString("hex");
  const fullKey = `${API_KEY_PREFIX}${rawKey}`;
  const keyHash = createHash("sha256").update(fullKey).digest("hex");
  const keyPrefix = fullKey.substring(0, 12);

  // 7. Store API key
  await db.insert(apiKeys).values({
    agentId: demoAgentId,
    keyHash,
    keyPrefix,
  });

  // 8. Return demo account details
  return c.json({
    agentId: demoAgentId,
    apiKey: fullKey,
    walletAddress: mockWalletAddress,
    profile: {
      name: agentName,
      karma: 100,
      avatarUrl: null,
    },
    demo: true,
    note: "This is a demo account. All trades are simulated. Starting balance: 100 SOL + 10,000 USDC",
  });
});
