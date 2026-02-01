import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { Decimal } from "decimal.js";
import {
  createSolanaRpc,
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
} from "@solana/kit";
import { db } from "../db/index.ts";
import { wallets } from "../db/schema/index.ts";
import { env } from "../config/env.ts";
import {
  USDC_MINT_MAINNET,
  USDC_MINT_DEVNET,
} from "../config/constants.ts";

type WalletEnv = {
  Variables: {
    agentId: string;
  };
};

/** Token Program address (SPL Token) */
const TOKEN_PROGRAM_ADDRESS = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

/** Associated Token Account Program address */
const ATA_PROGRAM_ADDRESS = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

/**
 * Derive the Associated Token Account (ATA) address for a given owner + mint.
 * This matches the canonical derivation:
 * PDA(ATA_PROGRAM, [owner, TOKEN_PROGRAM, mint])
 */
async function getAtaAddress(
  ownerPubkey: string,
  mintAddress: string
): Promise<string> {
  const encoder = getAddressEncoder();
  const [pda] = await getProgramDerivedAddress({
    programAddress: address(ATA_PROGRAM_ADDRESS),
    seeds: [
      encoder.encode(address(ownerPubkey)),
      encoder.encode(address(TOKEN_PROGRAM_ADDRESS)),
      encoder.encode(address(mintAddress)),
    ],
  });
  return pda;
}

function getSolanaRpc() {
  const rpcUrl = env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
  return createSolanaRpc(rpcUrl);
}

function getUsdcMint(): string {
  return env.NODE_ENV === "production" ? USDC_MINT_MAINNET : USDC_MINT_DEVNET;
}

export const walletRoutes = new Hono<WalletEnv>();

/**
 * GET / - Wallet info
 */
walletRoutes.get("/", async (c) => {
  const agentId = c.get("agentId");

  const records = await db
    .select()
    .from(wallets)
    .where(eq(wallets.agentId, agentId))
    .limit(1);

  if (records.length === 0) {
    return c.json({ error: "wallet_not_found" }, 404);
  }

  const wallet = records[0];
  return c.json({
    agentId,
    walletAddress: wallet.publicKey,
    createdAt: wallet.createdAt,
  });
});

/**
 * GET /balance - SOL and USDC on-chain balance
 */
walletRoutes.get("/balance", async (c) => {
  const agentId = c.get("agentId");

  const records = await db
    .select()
    .from(wallets)
    .where(eq(wallets.agentId, agentId))
    .limit(1);

  if (records.length === 0) {
    return c.json({ error: "wallet_not_found" }, 404);
  }

  const wallet = records[0];
  const rpc = getSolanaRpc();

  // Query SOL balance
  const solBalanceResponse = await rpc
    .getBalance(address(wallet.publicKey))
    .send();
  const lamports = solBalanceResponse.value;
  const solDisplay = new Decimal(lamports.toString()).div(1e9).toFixed(9);

  // Query USDC balance (via ATA)
  let usdcRawAmount = "0";
  let usdcDisplay = "0.000000";

  try {
    const usdcMint = getUsdcMint();
    const ataAddress = await getAtaAddress(wallet.publicKey, usdcMint);

    const tokenBalanceResponse = await rpc
      .getTokenAccountBalance(address(ataAddress))
      .send();

    usdcRawAmount = tokenBalanceResponse.value.amount;
    usdcDisplay = new Decimal(usdcRawAmount).div(1e6).toFixed(6);
  } catch {
    // ATA doesn't exist or other error -- USDC balance is 0
  }

  return c.json({
    sol: {
      lamports: lamports.toString(),
      display: solDisplay,
    },
    usdc: {
      rawAmount: usdcRawAmount,
      display: usdcDisplay,
    },
  });
});
