import { env } from "../config/env.ts";
import { JUPITER_API_BASE_URL } from "../config/constants.ts";
import { getTurnkeySigner } from "./wallet.ts";
import { Keypair, VersionedTransaction } from "@solana/web3.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Delay in milliseconds before retrying after a Jupiter -1006 timeout error.
 * Jupiter's -1006 code indicates a server-side timeout; a short pause before
 * retry gives the network time to recover without excessive waiting.
 */
const JUPITER_TIMEOUT_RETRY_DELAY_MS = 2000;

/**
 * Jupiter execute response code indicating a server-side timeout.
 * When this code is received, the request is retried once after
 * JUPITER_TIMEOUT_RETRY_DELAY_MS milliseconds.
 */
const JUPITER_TIMEOUT_ERROR_CODE = -1006;

/**
 * Maximum number of token mint addresses per Jupiter Price API V3 request.
 * The Jupiter Price API enforces a 50-mint limit per query; batching is
 * required when fetching prices for more than 50 tokens at once.
 */
const JUPITER_PRICE_API_BATCH_SIZE = 50;

// ---------------------------------------------------------------------------
// Solana Wire Format Constants
// ---------------------------------------------------------------------------

/**
 * Threshold for compact-u16 single-byte encoding in Solana wire format.
 * Values 0–127 (< 0x80) fit in a single byte; values 128–16383 require
 * two bytes. Used to parse the number-of-signers prefix in a versioned
 * transaction.
 *
 * Reference: https://docs.solana.com/developing/programming-model/transactions#compact-u16
 */
const COMPACT_U16_SINGLE_BYTE_MAX = 0x80; // 128

/**
 * Bitmask to extract the 7-bit payload from the first byte of a two-byte
 * compact-u16. The high bit (0x80) is a continuation flag; the remaining
 * 7 bits carry the low-order value.
 *
 * Example: 0xA3 (163) → 0xA3 & 0x7f = 0x23 (35) low-order bits.
 */
const COMPACT_U16_LOW_BITS_MASK = 0x7f; // 127

/**
 * Bit shift applied to the second byte of a two-byte compact-u16 before
 * OR-ing with the masked first byte.  The first byte holds 7 low-order bits,
 * so the second byte contributes bits 7 and above.
 *
 * Example: first byte = 0x81 → low bits = 1; second byte = 0x01 → 1 << 7 = 128;
 * combined = 1 | 128 = 129.
 */
const COMPACT_U16_HIGH_BITS_SHIFT = 7;

/**
 * Byte mask applied to the second compact-u16 byte to isolate its 8-bit
 * value before shifting.  Always 0xff (no-op for unsigned bytes, but makes
 * intent explicit when working with signed JavaScript numbers).
 */
const COMPACT_U16_SECOND_BYTE_MASK = 0xff; // 255

/**
 * Length in bytes of a single Ed25519 signature on Solana.
 * Each signer occupies exactly 64 bytes in the signatures section of a
 * versioned transaction wire format.
 *
 * Reference: https://docs.solana.com/developing/programming-model/transactions#signatures
 */
const SOLANA_SIGNATURE_BYTES = 64;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JupiterOrderResponse {
  transaction: string;
  requestId: string;
  inAmount: string;
  outAmount: string;
  swapType: string;
  slippageBps: number;
}

export interface JupiterExecuteResponse {
  status: string;
  signature: string;
  code: number;
  slot?: number;
  inputAmountResult?: string;
  outputAmountResult?: string;
  swapEvents?: unknown[];
}

export interface JupiterPrice {
  usdPrice: number;
  blockId: string;
  decimals: number;
  priceChange24h: number;
}

// ---------------------------------------------------------------------------
// Jupiter Ultra API – Order
// ---------------------------------------------------------------------------

/**
 * Request a swap order from Jupiter Ultra API.
 *
 * Returns the unsigned transaction (base64), request ID, and quote details.
 */
export async function getOrder(params: {
  inputMint: string;
  outputMint: string;
  amount: string;
  taker: string;
}): Promise<JupiterOrderResponse> {
  const url = new URL(`${JUPITER_API_BASE_URL}/ultra/v1/order`);
  url.searchParams.set("inputMint", params.inputMint);
  url.searchParams.set("outputMint", params.outputMint);
  url.searchParams.set("amount", params.amount);
  url.searchParams.set("taker", params.taker);

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { "x-api-key": env.JUPITER_API_KEY },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "no body");
    throw new Error(
      `jupiter_order_failed: HTTP ${res.status} – ${body}`
    );
  }

  const data = (await res.json()) as JupiterOrderResponse;

  if (!data.transaction) {
    throw new Error(
      `jupiter_order_failed: response missing transaction field – ${JSON.stringify(data)}`
    );
  }

  return data;
}

// ---------------------------------------------------------------------------
// Signing bridge – Solana wire format + Turnkey
// ---------------------------------------------------------------------------

/**
 * Sign a Jupiter-returned base64 transaction using Turnkey.
 *
 * 1. Decode base64 to raw Solana wire-format bytes
 * 2. Parse compact-u16 to find the number of signers
 * 3. Extract message bytes (everything after signature placeholders)
 * 4. Sign message bytes via Turnkey (Ed25519)
 * 5. Inject signature into the first 64-byte slot
 * 6. Return re-encoded base64
 *
 * CRITICAL: The transaction bytes are NOT modified beyond injecting the
 * signature. Jupiter explicitly prohibits altering the transaction.
 */
export async function signJupiterTransaction(
  base64Transaction: string,
  walletAddress: string
): Promise<string> {
  const txBytes = Buffer.from(base64Transaction, "base64");

  // --- Parse compact-u16 for number of signatures ---
  // For values < 128 the compact-u16 is a single byte.
  let numSigners: number;
  let compactLen: number; // bytes consumed by the compact-u16

  const firstByte = txBytes[0];
  if (firstByte < COMPACT_U16_SINGLE_BYTE_MAX) {
    numSigners = firstByte;
    compactLen = 1;
  } else {
    // Two-byte compact-u16 (value 128–16383)
    numSigners =
      (firstByte & COMPACT_U16_LOW_BITS_MASK) |
      ((txBytes[1] & COMPACT_U16_SECOND_BYTE_MASK) << COMPACT_U16_HIGH_BITS_SHIFT);
    compactLen = 2;
  }

  const signaturesOffset = compactLen;
  const messageOffset = signaturesOffset + numSigners * SOLANA_SIGNATURE_BYTES;
  const messageBytes = txBytes.subarray(messageOffset);

  // --- Sign with Turnkey ---
  const turnkeySigner = getTurnkeySigner();
  const signature = await turnkeySigner.signMessage(
    new Uint8Array(messageBytes),
    walletAddress
  );

  // --- Inject signature into the first slot ---
  const signedTx = Buffer.from(txBytes);
  Buffer.from(signature).copy(signedTx, signaturesOffset, 0, SOLANA_SIGNATURE_BYTES);

  return signedTx.toString("base64");
}

/**
 * Sign a Jupiter-returned base64 transaction using a direct Keypair.
 *
 * Uses @solana/web3.js VersionedTransaction.sign() which handles all the
 * wire-format details internally. This allows agents to trade with private
 * keys from .env without needing Turnkey infrastructure.
 */
export function signJupiterTransactionDirect(
  base64Transaction: string,
  keypair: Keypair,
): string {
  const txBytes = Buffer.from(base64Transaction, "base64");
  const tx = VersionedTransaction.deserialize(txBytes);
  tx.sign([keypair]);
  return Buffer.from(tx.serialize()).toString("base64");
}

// ---------------------------------------------------------------------------
// Jupiter Ultra API – Execute
// ---------------------------------------------------------------------------

/** Small helper to sleep for `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Submit a signed transaction to Jupiter for execution.
 *
 * If the response code is -1006 (timeout) the request is retried once after
 * a 2-second delay.
 */
export async function executeOrder(params: {
  signedTransaction: string;
  requestId: string;
}): Promise<JupiterExecuteResponse> {
  const url = `${JUPITER_API_BASE_URL}/ultra/v1/execute`;

  const doRequest = async (): Promise<JupiterExecuteResponse> => {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.JUPITER_API_KEY,
      },
      body: JSON.stringify({
        signedTransaction: params.signedTransaction,
        requestId: params.requestId,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "no body");
      throw new Error(
        `jupiter_execute_failed: HTTP ${res.status} – ${body}`
      );
    }

    return (await res.json()) as JupiterExecuteResponse;
  };

  let result = await doRequest();

  // Retry once on timeout (JUPITER_TIMEOUT_ERROR_CODE = -1006)
  if (result.code === JUPITER_TIMEOUT_ERROR_CODE) {
    await sleep(JUPITER_TIMEOUT_RETRY_DELAY_MS);
    result = await doRequest();
  }

  if (result.status !== "Success") {
    throw new Error(
      `jupiter_execute_failed: status=${result.status} code=${result.code} sig=${result.signature}`
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// Jupiter Price API V3
// ---------------------------------------------------------------------------

/**
 * Fetch USD prices for up to 50 token mints from Jupiter Price API V3.
 *
 * Returns a map of mintAddress -> JupiterPrice | null.
 */
export async function getPrices(
  mintAddresses: string[]
): Promise<Record<string, JupiterPrice | null>> {
  const result: Record<string, JupiterPrice | null> = {};

  // Batch in groups of JUPITER_PRICE_API_BATCH_SIZE
  for (let i = 0; i < mintAddresses.length; i += JUPITER_PRICE_API_BATCH_SIZE) {
    const batch = mintAddresses.slice(i, i + JUPITER_PRICE_API_BATCH_SIZE);
    const ids = batch.join(",");

    const res = await fetch(
      `${JUPITER_API_BASE_URL}/price/v3?ids=${ids}`,
      {
        method: "GET",
        headers: { "x-api-key": env.JUPITER_API_KEY },
      }
    );

    if (!res.ok) {
      // On failure, set all mints in this batch to null
      for (const mint of batch) {
        result[mint] = null;
      }
      continue;
    }

    const data = (await res.json()) as {
      data: Record<
        string,
        | {
            price: string;
            extraInfo?: {
              quotedPrice?: {
                buyPrice?: string;
                sellPrice?: string;
              };
            };
          }
        | undefined
      >;
    };

    for (const mint of batch) {
      const entry = data.data?.[mint];
      if (entry && entry.price) {
        result[mint] = {
          usdPrice: parseFloat(entry.price),
          blockId: "",
          decimals: 0,
          priceChange24h: 0,
        };
      } else {
        result[mint] = null;
      }
    }
  }

  return result;
}
