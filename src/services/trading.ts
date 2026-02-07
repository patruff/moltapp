import { Decimal } from "decimal.js";
import { db } from "../db/index.ts";
import { trades, positions, wallets } from "../db/schema/index.ts";
import { eq, and, sql } from "drizzle-orm";
import {
  getOrder,
  signJupiterTransaction,
  signJupiterTransactionDirect,
  executeOrder,
  getPrices,
} from "./jupiter.ts";
import { getStockBySymbol } from "./stocks.ts";
import {
  USDC_MINT_MAINNET,
  USDC_MINT_DEVNET,
} from "../config/constants.ts";
import { env } from "../config/env.ts";
import {
  createSolanaRpc,
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
} from "@solana/kit";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { recordTransactionCost } from "./transaction-cost-tracker.ts";

// ---------------------------------------------------------------------------
// Constants (same patterns as wallets.ts / withdrawal.ts)
// ---------------------------------------------------------------------------

const TOKEN_PROGRAM_ADDRESS = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ATA_PROGRAM_ADDRESS = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

/** Minimum SOL balance required to pay transaction fees (0.01 SOL) */
const MIN_SOL_FOR_FEES = 10_000_000n; // 0.01 SOL in lamports

/**
 * Maximum allowed slippage between Jupiter reference price and quoted execution price.
 * xStocks tokens have wildly varying liquidity — some have $2M+ pools (CRCLx, TSLAx),
 * others have zero pools (AMDx, PLTRx). Even a $5 trade in illiquid tokens can produce
 * 50-270x slippage. This guard prevents executing trades where the fill price deviates
 * more than 5% from the Jupiter mid-market reference price.
 */
const MAX_SLIPPAGE_PERCENT = 5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getUsdcMint(): string {
  // Use mainnet USDC if RPC points to mainnet (regardless of NODE_ENV)
  const rpcUrl = env.SOLANA_RPC_URL || "";
  if (rpcUrl.includes("mainnet") || rpcUrl.includes("helius")) {
    return USDC_MINT_MAINNET;
  }
  return env.NODE_ENV === "production" ? USDC_MINT_MAINNET : USDC_MINT_DEVNET;
}

function getSolanaRpc() {
  const rpcUrl = env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
  return createSolanaRpc(rpcUrl);
}

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

// ---------------------------------------------------------------------------
// Slippage Guard — reject trades with excessive price impact
// ---------------------------------------------------------------------------

/**
 * Check if a Jupiter quote has acceptable slippage relative to the
 * mid-market reference price. Returns the slippage percentage and whether
 * the trade should proceed.
 *
 * For BUY orders: compares (usdcAmount / quotedOutputTokens) to reference price
 * For SELL orders: compares (quotedOutputUsdc / tokenAmount) to reference price
 */
async function checkSlippage(params: {
  mintAddress: string;
  symbol: string;
  side: "buy" | "sell";
  /** Raw input amount (USDC raw for buy, token raw for sell) */
  inputAmountRaw: string;
  /** Raw output amount from Jupiter quote */
  outputAmountRaw: string;
  /** Input decimals (6 for USDC, 8 for xStocks) */
  inputDecimals: number;
  /** Output decimals (8 for xStocks, 6 for USDC) */
  outputDecimals: number;
}): Promise<{ ok: boolean; slippagePercent: number; refPrice: number; execPrice: number }> {
  // Calculate implied execution price from the quote
  const inputAmount = new Decimal(params.inputAmountRaw).div(new Decimal(10).pow(params.inputDecimals));
  const outputAmount = new Decimal(params.outputAmountRaw).div(new Decimal(10).pow(params.outputDecimals));

  let execPrice: number;
  if (params.side === "buy") {
    // Buying stock with USDC: price = usdcSpent / stockReceived
    execPrice = inputAmount.div(outputAmount).toNumber();
  } else {
    // Selling stock for USDC: price = usdcReceived / stockSold
    execPrice = outputAmount.div(inputAmount).toNumber();
  }

  // Fetch reference mid-market price from Jupiter
  let refPrice = 0;
  try {
    const prices = await getPrices([params.mintAddress]);
    refPrice = prices[params.mintAddress]?.usdPrice ?? 0;
  } catch {
    // If we can't get a reference price, we can't check slippage — allow the trade
    // but log the situation
    console.warn(`[SlippageGuard] Could not fetch reference price for ${params.symbol}, skipping slippage check`);
    return { ok: true, slippagePercent: 0, refPrice: 0, execPrice };
  }

  if (refPrice <= 0) {
    console.warn(`[SlippageGuard] No reference price for ${params.symbol}, skipping slippage check`);
    return { ok: true, slippagePercent: 0, refPrice: 0, execPrice };
  }

  // Calculate slippage: how much worse is the execution price vs reference
  // For buys: paying MORE than reference is bad (positive slippage)
  // For sells: receiving LESS than reference is bad (positive slippage)
  let slippagePercent: number;
  if (params.side === "buy") {
    slippagePercent = ((execPrice - refPrice) / refPrice) * 100;
  } else {
    slippagePercent = ((refPrice - execPrice) / refPrice) * 100;
  }

  const ok = slippagePercent <= MAX_SLIPPAGE_PERCENT;

  if (!ok) {
    console.error(
      `[SlippageGuard] REJECTED ${params.side.toUpperCase()} ${params.symbol}: ` +
      `slippage ${slippagePercent.toFixed(2)}% exceeds ${MAX_SLIPPAGE_PERCENT}% max ` +
      `(exec=$${execPrice.toFixed(4)} vs ref=$${refPrice.toFixed(4)})`
    );
  } else {
    console.log(
      `[SlippageGuard] ${params.side.toUpperCase()} ${params.symbol}: ` +
      `slippage ${slippagePercent.toFixed(2)}% OK ` +
      `(exec=$${execPrice.toFixed(4)} vs ref=$${refPrice.toFixed(4)})`
    );
  }

  return { ok, slippagePercent, refPrice, execPrice };
}

// ---------------------------------------------------------------------------
// Agent Wallet Resolution (env-based, bypasses Turnkey + DB wallets table)
// ---------------------------------------------------------------------------

/** Map agent IDs to their env var prefixes for wallet keys */
const AGENT_WALLET_ENV: Record<string, { publicEnv: string; privateEnv: string }> = {
  "claude-value-investor": {
    publicEnv: "ANTHROPIC_WALLET_PUBLIC",
    privateEnv: "ANTHROPIC_WALLET_PRIVATE",
  },
  "gpt-momentum-trader": {
    publicEnv: "OPENAI_WALLET_PUBLIC",
    privateEnv: "OPENAI_WALLET_PRIVATE",
  },
  "grok-contrarian": {
    publicEnv: "GROK_WALLET_PUBLIC",
    privateEnv: "GROK_WALLET_PRIVATE",
  },
};

interface ResolvedWallet {
  publicKey: string;
  keypair: Keypair | null;
}

/**
 * Resolve an agent's wallet from environment variables.
 * Falls back to DB wallet lookup + Turnkey if env keys aren't set.
 */
async function resolveAgentWallet(agentId: string): Promise<ResolvedWallet> {
  const envConfig = AGENT_WALLET_ENV[agentId];

  if (envConfig) {
    const pubKey = process.env[envConfig.publicEnv];
    const privKey = process.env[envConfig.privateEnv];

    if (pubKey && privKey) {
      const keypair = Keypair.fromSecretKey(bs58.decode(privKey));
      return { publicKey: pubKey, keypair };
    }
  }

  // Fallback: DB wallet lookup (requires Turnkey for signing — will throw
  // if Turnkey isn't configured, which is expected for direct signing mode)
  const walletRecords = await db
    .select()
    .from(wallets)
    .where(eq(wallets.agentId, agentId))
    .limit(1);

  if (walletRecords.length === 0) {
    throw new Error(
      `wallet_not_found: no wallet for agent ${agentId}. ` +
        `Set ${envConfig?.publicEnv ?? "???"}/${envConfig?.privateEnv ?? "???"} in .env`,
    );
  }

  // DB wallet path — no keypair available, Turnkey signing will be used
  return { publicKey: walletRecords[0].publicKey, keypair: null };
}

/**
 * Sign a Jupiter transaction: uses direct Keypair if available, else Turnkey.
 */
async function signTransaction(
  base64Transaction: string,
  wallet: ResolvedWallet,
): Promise<string> {
  if (wallet.keypair) {
    return signJupiterTransactionDirect(base64Transaction, wallet.keypair);
  }
  // Fallback to Turnkey
  return signJupiterTransaction(base64Transaction, wallet.publicKey);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TradeRequest {
  agentId: string;
  stockSymbol: string;
  /** For buys: USDC to spend. For sells: ignored. */
  usdcAmount: string;
  /** For sells: quantity to sell. For buys: ignored. */
  stockQuantity?: string;
}

export interface TradeResult {
  tradeId: number;
  txSignature: string;
  status: string;
  side: "buy" | "sell";
  stockSymbol: string;
  stockQuantity: string;
  usdcAmount: string;
  pricePerToken: string;
}

// ---------------------------------------------------------------------------
// Balance checks
// ---------------------------------------------------------------------------

async function checkSolBalance(walletPublicKey: string): Promise<bigint> {
  const rpc = getSolanaRpc();
  const response = await rpc.getBalance(address(walletPublicKey)).send();
  return response.value;
}

async function checkUsdcBalance(walletPublicKey: string): Promise<bigint> {
  const rpc = getSolanaRpc();
  try {
    const usdcMint = getUsdcMint();
    const ataAddr = await getAtaAddress(walletPublicKey, usdcMint);
    const response = await rpc
      .getTokenAccountBalance(address(ataAddr))
      .send();
    return BigInt(response.value.amount);
  } catch {
    // ATA doesn't exist -- balance is 0
    return 0n;
  }
}

// ---------------------------------------------------------------------------
// executeBuy
// ---------------------------------------------------------------------------

/**
 * Execute a stock buy order.
 *
 * Flow: validate -> resolve wallet -> balance check -> Jupiter order ->
 *       sign (direct Keypair or Turnkey) -> execute -> record trade -> upsert position
 */
export async function executeBuy(req: TradeRequest): Promise<TradeResult> {
  // 1. Validate stock
  const stock = getStockBySymbol(req.stockSymbol);
  if (!stock) {
    throw new Error(
      `stock_not_found: ${req.stockSymbol} is not a supported stock`
    );
  }

  // 2. Get wallet (env-based with DB fallback)
  const wallet = await resolveAgentWallet(req.agentId);

  // 3. Validate amount
  const usdcAmount = new Decimal(req.usdcAmount);
  if (usdcAmount.lte(0)) {
    throw new Error("invalid_amount: usdcAmount must be > 0");
  }
  if (usdcAmount.decimalPlaces() > 6) {
    throw new Error("invalid_amount: usdcAmount has more than 6 decimal places");
  }
  const usdcRawAmount = usdcAmount.mul(1e6).toFixed(0);

  // 4. Balance checks
  const [solBalance, usdcBalance] = await Promise.all([
    checkSolBalance(wallet.publicKey),
    checkUsdcBalance(wallet.publicKey),
  ]);

  if (solBalance < MIN_SOL_FOR_FEES) {
    throw new Error(
      `insufficient_sol_for_fees: need at least 0.01 SOL, have ${new Decimal(solBalance.toString()).div(1e9).toFixed(9)} SOL`
    );
  }

  const rawUsdcNeeded = BigInt(usdcRawAmount);
  if (usdcBalance < rawUsdcNeeded) {
    throw new Error(
      `insufficient_usdc_balance: need ${usdcAmount.toFixed(6)} USDC, have ${new Decimal(usdcBalance.toString()).div(1e6).toFixed(6)} USDC`
    );
  }

  // 5. Jupiter order
  const order = await getOrder({
    inputMint: getUsdcMint(),
    outputMint: stock.mintAddress,
    amount: usdcRawAmount,
    taker: wallet.publicKey,
  });

  // 5b. Slippage guard — reject if execution price deviates >5% from reference
  const slippage = await checkSlippage({
    mintAddress: stock.mintAddress,
    symbol: stock.symbol,
    side: "buy",
    inputAmountRaw: order.inAmount,
    outputAmountRaw: order.outAmount,
    inputDecimals: 6, // USDC
    outputDecimals: stock.decimals,
  });
  if (!slippage.ok) {
    throw new Error(
      `excessive_slippage: ${stock.symbol} BUY slippage ${slippage.slippagePercent.toFixed(1)}% ` +
      `exceeds ${MAX_SLIPPAGE_PERCENT}% max (exec=$${slippage.execPrice.toFixed(2)} vs ref=$${slippage.refPrice.toFixed(2)}). ` +
      `Token likely has insufficient liquidity.`
    );
  }

  // 6. Sign transaction (direct Keypair or Turnkey fallback)
  const signedBase64 = await signTransaction(order.transaction, wallet);

  // 7. Execute
  const result = await executeOrder({
    signedTransaction: signedBase64,
    requestId: order.requestId,
  });

  // 8. Calculate trade details
  const stockQuantity = new Decimal(
    result.outputAmountResult || order.outAmount
  ).div(new Decimal(10).pow(stock.decimals));
  const usdcSpent = new Decimal(req.usdcAmount);
  const pricePerToken = usdcSpent.div(stockQuantity);

  // 9. Record trade in DB
  const [tradeRecord] = await db
    .insert(trades)
    .values({
      agentId: req.agentId,
      side: "buy",
      stockMintAddress: stock.mintAddress,
      stockSymbol: stock.symbol,
      stockQuantity: stockQuantity.toFixed(9),
      usdcAmount: usdcSpent.toFixed(6),
      pricePerToken: pricePerToken.toFixed(6),
      txSignature: result.signature,
      jupiterRouteInfo: {
        requestId: order.requestId,
        swapType: order.swapType,
        slippageBps: order.slippageBps,
        inAmount: order.inAmount,
        outAmount: order.outAmount,
        inputAmountResult: result.inputAmountResult,
        outputAmountResult: result.outputAmountResult,
        // Actual execution quality metrics (from checkSlippage)
        actualSlippagePercent: slippage.slippagePercent,
        actualSlippageBps: Math.round(slippage.slippagePercent * 100),
        referencePrice: slippage.refPrice,
        executionPrice: slippage.execPrice,
      },
      status: "confirmed",
    })
    .returning();

  // 9b. Record transaction cost for P&L tracking
  recordTransactionCost({
    tradeId: tradeRecord.id,
    agentId: req.agentId,
    symbol: stock.symbol,
    side: "buy",
    usdcAmount: usdcSpent.toNumber(),
    slippagePercent: slippage.slippagePercent,
  });

  // 10. Update position (upsert with weighted average cost basis)
  await db
    .insert(positions)
    .values({
      agentId: req.agentId,
      mintAddress: stock.mintAddress,
      symbol: stock.symbol,
      quantity: stockQuantity.toFixed(9),
      averageCostBasis: pricePerToken.toFixed(6),
    })
    .onConflictDoUpdate({
      target: [positions.agentId, positions.mintAddress],
      set: {
        quantity: sql`(${positions.quantity}::numeric + ${stockQuantity.toFixed(9)}::numeric)::numeric(20,9)`,
        averageCostBasis: sql`(
          (${positions.quantity}::numeric * ${positions.averageCostBasis}::numeric + ${stockQuantity.toFixed(9)}::numeric * ${pricePerToken.toFixed(6)}::numeric)
          / (${positions.quantity}::numeric + ${stockQuantity.toFixed(9)}::numeric)
        )::numeric(20,6)`,
        updatedAt: new Date(),
      },
    });

  // 11. Return TradeResult
  return {
    tradeId: tradeRecord.id,
    txSignature: result.signature,
    status: "confirmed",
    side: "buy",
    stockSymbol: stock.symbol,
    stockQuantity: stockQuantity.toFixed(9),
    usdcAmount: usdcSpent.toFixed(6),
    pricePerToken: pricePerToken.toFixed(6),
  };
}

// ---------------------------------------------------------------------------
// executeSell
// ---------------------------------------------------------------------------

/**
 * Execute a stock sell order.
 *
 * Flow: validate -> resolve wallet -> position check -> Jupiter order ->
 *       sign (direct Keypair or Turnkey) -> execute -> record trade -> update position
 */
export async function executeSell(req: TradeRequest): Promise<TradeResult> {
  // 1. Validate stock
  const stock = getStockBySymbol(req.stockSymbol);
  if (!stock) {
    throw new Error(
      `stock_not_found: ${req.stockSymbol} is not a supported stock`
    );
  }

  // 2. Get wallet (env-based with DB fallback)
  const wallet = await resolveAgentWallet(req.agentId);

  // 3. Validate quantity
  if (!req.stockQuantity) {
    throw new Error("invalid_amount: stockQuantity is required for sell orders");
  }
  const sellQuantity = new Decimal(req.stockQuantity);
  if (sellQuantity.lte(0)) {
    throw new Error("invalid_amount: stockQuantity must be > 0");
  }

  // 4. Position check
  const positionRecords = await db
    .select()
    .from(positions)
    .where(
      and(
        eq(positions.agentId, req.agentId),
        eq(positions.mintAddress, stock.mintAddress)
      )
    )
    .limit(1);

  if (positionRecords.length === 0) {
    throw new Error(
      `insufficient_stock_balance: no position in ${stock.symbol}`
    );
  }

  const existingPosition = positionRecords[0];
  const positionQuantity = new Decimal(existingPosition.quantity);

  if (positionQuantity.lt(sellQuantity)) {
    throw new Error(
      `insufficient_stock_balance: want to sell ${sellQuantity.toFixed(9)} ${stock.symbol} but only hold ${positionQuantity.toFixed(9)}`
    );
  }

  // 5. Convert to raw units
  const rawStockAmount = sellQuantity
    .mul(new Decimal(10).pow(stock.decimals))
    .toFixed(0);

  // 6. Jupiter order (sell: stock -> USDC)
  const order = await getOrder({
    inputMint: stock.mintAddress,
    outputMint: getUsdcMint(),
    amount: rawStockAmount,
    taker: wallet.publicKey,
  });

  // 7. Balance check: need SOL for fees
  const solBalance = await checkSolBalance(wallet.publicKey);
  if (solBalance < MIN_SOL_FOR_FEES) {
    throw new Error(
      `insufficient_sol_for_fees: need at least 0.01 SOL, have ${new Decimal(solBalance.toString()).div(1e9).toFixed(9)} SOL`
    );
  }

  // 7b. Slippage guard — reject if execution price deviates >5% from reference
  const slippage = await checkSlippage({
    mintAddress: stock.mintAddress,
    symbol: stock.symbol,
    side: "sell",
    inputAmountRaw: order.inAmount,
    outputAmountRaw: order.outAmount,
    inputDecimals: stock.decimals, // selling stock tokens
    outputDecimals: 6, // receiving USDC
  });
  if (!slippage.ok) {
    throw new Error(
      `excessive_slippage: ${stock.symbol} SELL slippage ${slippage.slippagePercent.toFixed(1)}% ` +
      `exceeds ${MAX_SLIPPAGE_PERCENT}% max (exec=$${slippage.execPrice.toFixed(2)} vs ref=$${slippage.refPrice.toFixed(2)}). ` +
      `Token likely has insufficient liquidity.`
    );
  }

  // 8. Sign + Execute (direct Keypair or Turnkey fallback)
  const signedBase64 = await signTransaction(order.transaction, wallet);

  const result = await executeOrder({
    signedTransaction: signedBase64,
    requestId: order.requestId,
  });

  // 9. Calculate trade details
  const usdcReceived = new Decimal(
    result.outputAmountResult || order.outAmount
  ).div(1e6);
  const pricePerToken = usdcReceived.div(sellQuantity);

  // 10. Record trade in DB
  const [tradeRecord] = await db
    .insert(trades)
    .values({
      agentId: req.agentId,
      side: "sell",
      stockMintAddress: stock.mintAddress,
      stockSymbol: stock.symbol,
      stockQuantity: sellQuantity.toFixed(9),
      usdcAmount: usdcReceived.toFixed(6),
      pricePerToken: pricePerToken.toFixed(6),
      txSignature: result.signature,
      jupiterRouteInfo: {
        requestId: order.requestId,
        swapType: order.swapType,
        slippageBps: order.slippageBps,
        inAmount: order.inAmount,
        outAmount: order.outAmount,
        inputAmountResult: result.inputAmountResult,
        outputAmountResult: result.outputAmountResult,
        // Actual execution quality metrics (from checkSlippage)
        actualSlippagePercent: slippage.slippagePercent,
        actualSlippageBps: Math.round(slippage.slippagePercent * 100),
        referencePrice: slippage.refPrice,
        executionPrice: slippage.execPrice,
      },
      status: "confirmed",
    })
    .returning();

  // 10b. Record transaction cost for P&L tracking
  recordTransactionCost({
    tradeId: tradeRecord.id,
    agentId: req.agentId,
    symbol: stock.symbol,
    side: "sell",
    usdcAmount: usdcReceived.toNumber(),
    slippagePercent: slippage.slippagePercent,
  });

  // 11. Update position: decrement or delete
  const newQuantity = positionQuantity.minus(sellQuantity);

  if (newQuantity.lte(0)) {
    // Position fully liquidated -- remove row
    await db
      .delete(positions)
      .where(eq(positions.id, existingPosition.id));
  } else {
    // Reduce quantity (averageCostBasis stays the same on sells)
    await db
      .update(positions)
      .set({
        quantity: newQuantity.toFixed(9),
        updatedAt: new Date(),
      })
      .where(eq(positions.id, existingPosition.id));
  }

  // 12. Return TradeResult
  return {
    tradeId: tradeRecord.id,
    txSignature: result.signature,
    status: "confirmed",
    side: "sell",
    stockSymbol: stock.symbol,
    stockQuantity: sellQuantity.toFixed(9),
    usdcAmount: usdcReceived.toFixed(6),
    pricePerToken: pricePerToken.toFixed(6),
  };
}
