import {
  createSolanaRpc,
  address,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  compileTransaction,
  getBase64EncodedWireTransaction,
  getAddressEncoder,
  getProgramDerivedAddress,
} from "@solana/kit";
import type {
  Address,
  Instruction,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import type { TransactionPartialSigner } from "@solana/kit";
import { getTurnkeySigner } from "./wallet.ts";
import { env } from "../config/env.ts";
import { errorMessage } from "../lib/errors.ts";
import {
  USDC_MINT_MAINNET,
  USDC_MINT_DEVNET,
  SPL_TRANSFER_INSTRUCTION_SIZE,
  SPL_TRANSFER_AMOUNT_OFFSET,
  SPL_CREATE_IDEMPOTENT_DISCRIMINATOR,
  SOL_TRANSFER_FEE_LAMPORTS,
  USDC_ATA_CREATION_FEE_LAMPORTS,
  TOKEN_PROGRAM_ADDRESS,
  ATA_PROGRAM_ADDRESS,
  SYSTEM_PROGRAM_ADDRESS,
} from "../config/constants.ts";

function getSolanaRpc(): ReturnType<typeof createSolanaRpc> {
  const rpcUrl = env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
  return createSolanaRpc(rpcUrl);
}

function getUsdcMint(): string {
  return env.NODE_ENV === "production" ? USDC_MINT_MAINNET : USDC_MINT_DEVNET;
}

/**
 * Derive the Associated Token Account (ATA) address for a given owner + mint.
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

/**
 * Create a minimal TransactionPartialSigner for use with getTransferSolInstruction.
 *
 * NOTE: This signer is ONLY used to satisfy the TransactionSigner type required by
 * getTransferSolInstruction's `source` parameter. Actual signing is done separately
 * by calling Turnkey's signMessage directly on compiled transaction bytes.
 */
function createSignerStub(
  walletAddress: string
): TransactionPartialSigner {
  return {
    address: address(walletAddress),
    signTransactions: async () => {
      throw new Error("Stub signer should not be called directly");
    },
  };
}

/**
 * Sign compiled transaction message bytes using Turnkey and return the signature.
 *
 * @solana/kit Transaction = { messageBytes, signatures }.
 * After compileTransaction, signatures are null. We sign the messageBytes
 * using Turnkey's signMessage (raw Ed25519 signing).
 */
async function signWithTurnkey(
  messageBytes: Uint8Array,
  walletAddress: string
): Promise<Uint8Array> {
  const turnkeySigner = getTurnkeySigner();
  return turnkeySigner.signMessage(
    new Uint8Array(messageBytes),
    walletAddress
  );
}

/**
 * Build an SPL Token Transfer instruction for @solana/kit.
 *
 * The instruction data layout: [3 (u8 discriminator for Transfer), amount (u64 LE)]
 * Accounts: [source(writable), destination(writable), owner(signer)]
 */
function buildSplTokenTransferInstruction(params: {
  source: string;
  destination: string;
  owner: string;
  amount: bigint;
}): Instruction {
  const data = new Uint8Array(SPL_TRANSFER_INSTRUCTION_SIZE);
  // Discriminator: 3 = Transfer
  data[0] = 3;
  // Amount as u64 LE
  const view = new DataView(data.buffer);
  view.setBigUint64(SPL_TRANSFER_AMOUNT_OFFSET, params.amount, true);

  return {
    programAddress: address(TOKEN_PROGRAM_ADDRESS),
    accounts: [
      {
        address: address(params.source),
        role: 1, // WritableAccount (AccountRole.WRITABLE)
      },
      {
        address: address(params.destination),
        role: 1, // WritableAccount
      },
      {
        address: address(params.owner),
        role: 2, // ReadonlySignerAccount (AccountRole.READONLY_SIGNER)
      },
    ],
    data,
  };
}

/**
 * Build a CreateAssociatedTokenAccountIdempotent instruction for @solana/kit.
 *
 * Instruction data: [1 (u8)] for idempotent variant.
 * Accounts: [payer(signer,writable), ata(writable), owner, mint, system_program, token_program]
 */
function buildCreateAtaIdempotentInstruction(params: {
  payer: string;
  ata: string;
  owner: string;
  mint: string;
}): Instruction {
  return {
    programAddress: address(ATA_PROGRAM_ADDRESS),
    accounts: [
      {
        address: address(params.payer),
        role: 3, // WritableSignerAccount (AccountRole.WRITABLE_SIGNER)
      },
      {
        address: address(params.ata),
        role: 1, // WritableAccount
      },
      {
        address: address(params.owner),
        role: 0, // ReadonlyAccount (AccountRole.READONLY)
      },
      {
        address: address(params.mint),
        role: 0, // ReadonlyAccount
      },
      {
        address: address(SYSTEM_PROGRAM_ADDRESS),
        role: 0, // ReadonlyAccount
      },
      {
        address: address(TOKEN_PROGRAM_ADDRESS),
        role: 0, // ReadonlyAccount
      },
    ],
    data: new Uint8Array([SPL_CREATE_IDEMPOTENT_DISCRIMINATOR]), // 1 = CreateIdempotent
  };
}

export interface WithdrawSOLParams {
  agentWalletAddress: string;
  destinationAddress: string;
  amountLamports: bigint;
}

export interface WithdrawUSDCParams {
  agentWalletAddress: string;
  destinationAddress: string;
  /** Amount in smallest USDC units (6 decimals) */
  amount: bigint;
}

export interface WithdrawalResult {
  txSignature: string;
}

/**
 * Withdraw SOL from an agent's Turnkey-managed wallet to an external Solana address.
 *
 * 1. Gets latest blockhash from RPC
 * 2. Builds a SOL transfer instruction using @solana-program/system
 * 3. Compiles and signs with Turnkey (raw message signing)
 * 4. Submits to Solana
 */
export async function withdrawSOL(
  params: WithdrawSOLParams
): Promise<WithdrawalResult> {
  const { agentWalletAddress, destinationAddress, amountLamports } = params;
  const rpc = getSolanaRpc();

  try {
    // 1. Get latest blockhash
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

    // 2. Create signer stub for instruction building
    const signerStub = createSignerStub(agentWalletAddress);

    // 3. Build transfer instruction
    const transferIx = getTransferSolInstruction({
      source: signerStub,
      destination: address(destinationAddress),
      amount: amountLamports,
    });

    // 4. Build transaction message
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (msg) => setTransactionMessageFeePayer(address(agentWalletAddress), msg),
      (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
      (msg) => appendTransactionMessageInstructions([transferIx], msg),
    );

    // 5. Compile transaction
    const compiledTx = compileTransaction(transactionMessage);

    // 6. Sign message bytes with Turnkey
    const signatureBytes = await signWithTurnkey(
      new Uint8Array(compiledTx.messageBytes),
      agentWalletAddress
    );

    // 7. Create signed transaction by inserting the signature
    const signedTx = Object.freeze({
      messageBytes: compiledTx.messageBytes,
      signatures: Object.freeze({
        ...compiledTx.signatures,
        [address(agentWalletAddress)]: signatureBytes,
      }),
    });

    // 8. Send to Solana
    const base64Wire = getBase64EncodedWireTransaction(
      signedTx as typeof compiledTx
    );
    const txSignature = await rpc
      .sendTransaction(base64Wire, { encoding: "base64" })
      .send();

    return { txSignature: String(txSignature) };
  } catch (err) {
    const message = errorMessage(err);
    throw new Error(`withdrawal_sol_failed: ${message}`);
  }
}

/**
 * Withdraw USDC from an agent's Turnkey-managed wallet to an external Solana address.
 *
 * 1. Gets latest blockhash
 * 2. Derives source and destination ATAs
 * 3. Builds CreateAssociatedTokenAccountIdempotent + SPL Token Transfer instructions
 * 4. Compiles and signs with Turnkey (raw message signing)
 * 5. Submits to Solana
 */
export async function withdrawUSDC(
  params: WithdrawUSDCParams
): Promise<WithdrawalResult> {
  const { agentWalletAddress, destinationAddress, amount } = params;
  const rpc = getSolanaRpc();

  try {
    // 1. Get latest blockhash
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

    // 2. Derive ATAs
    const usdcMint = getUsdcMint();
    const sourceAta = await getAtaAddress(agentWalletAddress, usdcMint);
    const destinationAta = await getAtaAddress(destinationAddress, usdcMint);

    // 3. Build instructions
    // First, create destination ATA if it doesn't exist (idempotent -- no-ops if it exists)
    const createAtaIx = buildCreateAtaIdempotentInstruction({
      payer: agentWalletAddress,
      ata: destinationAta,
      owner: destinationAddress,
      mint: usdcMint,
    });

    // Then transfer USDC
    const transferIx = buildSplTokenTransferInstruction({
      source: sourceAta,
      destination: destinationAta,
      owner: agentWalletAddress,
      amount,
    });

    // 4. Build transaction message
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (msg) => setTransactionMessageFeePayer(address(agentWalletAddress), msg),
      (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
      (msg) => appendTransactionMessageInstructions([createAtaIx, transferIx], msg),
    );

    // 5. Compile transaction
    const compiledTx = compileTransaction(transactionMessage);

    // 6. Sign message bytes with Turnkey
    const signatureBytes = await signWithTurnkey(
      new Uint8Array(compiledTx.messageBytes),
      agentWalletAddress
    );

    // 7. Create signed transaction by inserting the signature
    const signedTx = Object.freeze({
      messageBytes: compiledTx.messageBytes,
      signatures: Object.freeze({
        ...compiledTx.signatures,
        [address(agentWalletAddress)]: signatureBytes,
      }),
    });

    // 8. Send to Solana
    const base64Wire = getBase64EncodedWireTransaction(
      signedTx as typeof compiledTx
    );
    const txSignature = await rpc
      .sendTransaction(base64Wire, { encoding: "base64" })
      .send();

    return { txSignature: String(txSignature) };
  } catch (err) {
    const message = errorMessage(err);
    throw new Error(`withdrawal_usdc_failed: ${message}`);
  }
}

/**
 * Estimate the transaction fee for a withdrawal.
 *
 * SOL transfer: ~5000 lamports (single instruction)
 * USDC transfer: ~10000 lamports base, plus ~2_039_280 lamports if destination ATA
 * needs to be created (rent exemption for the token account).
 *
 * Returns conservative estimates in lamports.
 */
export function estimateWithdrawalFee(
  tokenType: "SOL" | "USDC"
): bigint {
  if (tokenType === "SOL") {
    // SOL transfer: base fee ~5000 lamports
    return SOL_TRANSFER_FEE_LAMPORTS;
  }

  // USDC transfer: base fee + potential ATA creation rent (~2.04M lamports)
  // We return the worst case (ATA creation needed) to be safe
  return USDC_ATA_CREATION_FEE_LAMPORTS;
}
