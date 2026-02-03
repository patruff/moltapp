import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { Decimal } from "decimal.js";
import {
  createSolanaRpc,
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
} from "@solana/kit";
import { db } from "../db/index.ts";
import { wallets, transactions } from "../db/schema/index.ts";
import { env } from "../config/env.ts";
import {
  USDC_MINT_MAINNET,
  USDC_MINT_DEVNET,
} from "../config/constants.ts";
import {
  withdrawSOL,
  withdrawUSDC,
  estimateWithdrawalFee,
} from "../services/withdrawal.ts";
import { getDemoBalances } from "../services/demo-trading.ts";
import { apiError, handleError } from "../lib/errors.ts";

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
    return apiError(c, "WALLET_NOT_FOUND");
  }

  const wallet = records[0];
  return c.json({
    agentId,
    walletAddress: wallet.publicKey,
    createdAt: wallet.createdAt,
  });
});

/**
 * GET /balance - SOL and USDC on-chain balance (or demo balance if DEMO_MODE)
 */
walletRoutes.get("/balance", async (c) => {
  const agentId = c.get("agentId");

  const records = await db
    .select()
    .from(wallets)
    .where(eq(wallets.agentId, agentId))
    .limit(1);

  if (records.length === 0) {
    return apiError(c, "WALLET_NOT_FOUND");
  }

  // Use demo balances if DEMO_MODE is enabled
  if (env.DEMO_MODE) {
    try {
      const balances = await getDemoBalances(agentId);
      return c.json(balances);
    } catch (err) {
      return handleError(c, err);
    }
  }

  // Real blockchain balance query
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

/**
 * POST /withdraw - Withdraw SOL or USDC to an external Solana address
 */
const withdrawBodySchema = z.object({
  tokenType: z.enum(["SOL", "USDC"]),
  amount: z.string().regex(/^\d+(\.\d+)?$/, "Must be a valid decimal number"),
  destinationAddress: z.string().min(32).max(44),
});

walletRoutes.post("/withdraw", async (c) => {
  const agentId = c.get("agentId");

  // 1. Parse and validate body
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, "INVALID_JSON", "Request body must be valid JSON");
  }

  const parsed = withdrawBodySchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, "VALIDATION_FAILED", parsed.error.flatten());
  }

  const { tokenType, amount, destinationAddress } = parsed.data;

  // 2. Validate destination address is a valid Solana base58 address
  try {
    address(destinationAddress);
  } catch {
    return apiError(c, "INVALID_DESTINATION", "Destination address is not a valid Solana address");
  }

  // 3. Get agent's wallet from DB
  const walletRecords = await db
    .select()
    .from(wallets)
    .where(eq(wallets.agentId, agentId))
    .limit(1);

  if (walletRecords.length === 0) {
    return apiError(c, "WALLET_NOT_FOUND");
  }

  const wallet = walletRecords[0];

  // 4. Prevent self-withdrawal (wastes fees)
  if (wallet.publicKey === destinationAddress) {
    return apiError(c, "INVALID_AMOUNT", "Cannot withdraw to your own wallet address");
  }

  // 5. Convert amount to smallest units
  const decimalAmount = new Decimal(amount);
  let smallestUnits: bigint;
  let displayPrecision: number;

  if (tokenType === "SOL") {
    smallestUnits = BigInt(decimalAmount.mul(1e9).toFixed(0));
    displayPrecision = 9;
  } else {
    smallestUnits = BigInt(decimalAmount.mul(1e6).toFixed(0));
    displayPrecision = 6;
  }

  if (smallestUnits <= 0n) {
    return apiError(c, "INVALID_AMOUNT", "Amount must be greater than zero");
  }

  // 6. Balance check
  const rpc = getSolanaRpc();
  const solBalanceResponse = await rpc
    .getBalance(address(wallet.publicKey))
    .send();
  const solLamports = solBalanceResponse.value;
  const estimatedFee = estimateWithdrawalFee(tokenType);

  if (tokenType === "SOL") {
    // SOL withdrawal: need amount + fee
    const totalNeeded = smallestUnits + estimatedFee;
    if (solLamports < totalNeeded) {
      const availableDisplay = new Decimal(solLamports.toString()).div(1e9).toFixed(9);
      const feeDisplay = new Decimal(estimatedFee.toString()).div(1e9).toFixed(9);
      return apiError(c, "INSUFFICIENT_BALANCE", {
        requested: decimalAmount.toFixed(displayPrecision),
        available: availableDisplay,
        estimatedFee: feeDisplay,
        tokenType,
      });
    }
  } else {
    // USDC withdrawal: need USDC balance >= amount AND SOL balance >= fee
    if (solLamports < estimatedFee) {
      const solAvailable = new Decimal(solLamports.toString()).div(1e9).toFixed(9);
      const feeDisplay = new Decimal(estimatedFee.toString()).div(1e9).toFixed(9);
      return apiError(c, "INSUFFICIENT_SOL_FOR_FEES", {
        requested: decimalAmount.toFixed(displayPrecision),
        available: solAvailable,
        estimatedFee: feeDisplay,
        tokenType: "SOL (for transaction fee)",
      });
    }

    // Check USDC balance
    let usdcRawBalance = 0n;
    try {
      const usdcMint = getUsdcMint();
      const ataAddr = await getAtaAddress(wallet.publicKey, usdcMint);
      const tokenBalanceResponse = await rpc
        .getTokenAccountBalance(address(ataAddr))
        .send();
      usdcRawBalance = BigInt(tokenBalanceResponse.value.amount);
    } catch {
      // ATA doesn't exist -- balance is 0
    }

    if (usdcRawBalance < smallestUnits) {
      const availableDisplay = new Decimal(usdcRawBalance.toString()).div(1e6).toFixed(6);
      const feeDisplay = new Decimal(estimatedFee.toString()).div(1e9).toFixed(9);
      return c.json(
        {
          error: "insufficient_balance",
          details: {
            requested: decimalAmount.toFixed(displayPrecision),
            available: availableDisplay,
            estimatedFee: feeDisplay,
            tokenType,
          },
        },
        400
      );
    }
  }

  // 7. Execute withdrawal
  console.log(
    `[withdrawal] agent=${agentId} type=${tokenType} amount=${amount} dest=${destinationAddress}`
  );

  let txSignature: string;
  try {
    if (tokenType === "SOL") {
      const result = await withdrawSOL({
        agentWalletAddress: wallet.publicKey,
        destinationAddress,
        amountLamports: smallestUnits,
      });
      txSignature = result.txSignature;
    } else {
      const result = await withdrawUSDC({
        agentWalletAddress: wallet.publicKey,
        destinationAddress,
        amount: smallestUnits,
      });
      txSignature = result.txSignature;
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(
      `[withdrawal] FAILED agent=${agentId} type=${tokenType} amount=${amount} error=${errorMessage}`
    );
    return handleError(c, err);
  }

  // 8. Record transaction in DB
  const decimalForDb =
    tokenType === "SOL"
      ? decimalAmount.toFixed(9)
      : decimalAmount.toFixed(6);

  try {
    await db.insert(transactions).values({
      agentId,
      type: "withdrawal",
      tokenType,
      amount: decimalForDb,
      txSignature,
      status: "confirmed",
      destinationAddress,
      confirmedAt: new Date(),
    });
  } catch (dbErr) {
    // Transaction was submitted successfully but DB record failed.
    // Log the error but still return success to the agent since their funds moved.
    const dbMessage = dbErr instanceof Error ? dbErr.message : String(dbErr);
    console.error(
      `[withdrawal] DB record failed for tx=${txSignature}: ${dbMessage}`
    );
  }

  console.log(
    `[withdrawal] SUCCESS agent=${agentId} type=${tokenType} amount=${amount} tx=${txSignature}`
  );

  // 9. Return success
  return c.json({
    txSignature,
    tokenType,
    amount: tokenType === "SOL" ? decimalAmount.toFixed(9) : decimalAmount.toFixed(6),
    destinationAddress,
    status: "confirmed",
  });
});
