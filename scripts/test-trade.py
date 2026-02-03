#!/usr/bin/env python3
"""
Simple end-to-end test: use Grok to pick a stock, then buy a tiny amount via Jupiter Ultra API.

Usage:
  pip install solders requests openai base58

  # Set env vars:
  export JUPITER_API_KEY="your-jupiter-api-key"
  export XAI_API_KEY="your-grok-api-key"
  export SOLANA_PRIVATE_KEY="your-base58-private-key"

  python scripts/test-trade.py
"""

import os
import sys
import json
import base64
import requests
from solders.keypair import Keypair
from solders.transaction import VersionedTransaction
import base58

# --- Config ---

JUPITER_API_BASE = "https://api.jup.ag"
XAI_API_BASE = "https://api.x.ai/v1"

USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"

# xStocks catalog (from MoltApp constants.ts)
STOCKS = {
    "AAPLx": {"name": "Apple", "mint": "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp"},
    "TSLAx": {"name": "Tesla", "mint": "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB"},
    "NVDAx": {"name": "NVIDIA", "mint": "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh"},
    "GOOGLx": {"name": "Alphabet", "mint": "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN"},
    "AMZNx": {"name": "Amazon", "mint": "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg"},
    "MSFTx": {"name": "Microsoft", "mint": "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX"},
    "METAx": {"name": "Meta", "mint": "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu"},
    "SPYx": {"name": "S&P 500 ETF", "mint": "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W"},
    "COINx": {"name": "Coinbase", "mint": "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu"},
    "GMEx": {"name": "GameStop", "mint": "Xsf9mBktVB9BSU5kf4nHxPq5hCBJ2j2ui3ecFGxPRGc"},
}

# Buy $0.10 worth of USDC (100,000 lamports since USDC has 6 decimals)
BUY_AMOUNT_USDC = 100_000  # 0.1 USDC


def load_env():
    """Load and validate required environment variables."""
    jupiter_key = os.environ.get("JUPITER_API_KEY")
    xai_key = os.environ.get("XAI_API_KEY")
    private_key = os.environ.get("SOLANA_PRIVATE_KEY")

    missing = []
    if not jupiter_key:
        missing.append("JUPITER_API_KEY")
    if not xai_key:
        missing.append("XAI_API_KEY")
    if not private_key:
        missing.append("SOLANA_PRIVATE_KEY")

    if missing:
        print(f"Missing env vars: {', '.join(missing)}")
        print("See script header for setup instructions.")
        sys.exit(1)

    return jupiter_key, xai_key, private_key


def load_wallet(private_key_b58: str) -> Keypair:
    """Load Solana keypair from base58 private key."""
    secret_bytes = base58.b58decode(private_key_b58)
    return Keypair.from_bytes(secret_bytes)


def ask_grok(xai_key: str) -> str:
    """Ask Grok which stock to buy."""
    stock_list = ", ".join(f"{sym} ({info['name']})" for sym, info in STOCKS.items())

    print("\n--- Asking Grok for a stock pick ---")
    resp = requests.post(
        f"{XAI_API_BASE}/chat/completions",
        headers={
            "Authorization": f"Bearer {xai_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": "grok-3-mini-fast",
            "messages": [
                {
                    "role": "system",
                    "content": "You are a stock picking assistant. Respond with ONLY the ticker symbol, nothing else.",
                },
                {
                    "role": "user",
                    "content": f"Pick one tokenized stock for me to buy a tiny test amount of. Available: {stock_list}. Just respond with the symbol like AAPLx.",
                },
            ],
            "temperature": 0.7,
        },
        timeout=30,
    )
    resp.raise_for_status()
    pick = resp.json()["choices"][0]["message"]["content"].strip()

    # Clean up response — Grok might add extra text
    for sym in STOCKS:
        if sym in pick:
            pick = sym
            break

    if pick not in STOCKS:
        print(f"Grok picked '{pick}' which isn't in our catalog. Defaulting to TSLAx.")
        pick = "TSLAx"

    print(f"Grok says: buy {pick} ({STOCKS[pick]['name']})")
    return pick


def get_prices(jupiter_key: str, mints: list[str]) -> dict:
    """Fetch current prices from Jupiter Price API."""
    print("\n--- Fetching prices ---")
    resp = requests.get(
        f"{JUPITER_API_BASE}/price/v3",
        params={"ids": ",".join(mints)},
        headers={"x-api-key": jupiter_key},
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json().get("data", {})
    return data


def get_order(jupiter_key: str, input_mint: str, output_mint: str, amount: int, taker: str) -> dict:
    """Get a swap order from Jupiter Ultra API."""
    print("\n--- Getting Jupiter order ---")
    resp = requests.get(
        f"{JUPITER_API_BASE}/ultra/v1/order",
        params={
            "inputMint": input_mint,
            "outputMint": output_mint,
            "amount": str(amount),
            "taker": taker,
        },
        headers={"x-api-key": jupiter_key},
        timeout=30,
    )
    resp.raise_for_status()
    order = resp.json()
    print(f"  Order received: {order.get('inAmount')} in -> {order.get('outAmount')} out")
    print(f"  Swap type: {order.get('swapType')}, slippage: {order.get('slippageBps')}bps")
    return order


def sign_transaction(order: dict, wallet: Keypair) -> str:
    """Sign the Jupiter transaction with our wallet."""
    print("\n--- Signing transaction ---")
    tx_bytes = base64.b64decode(order["transaction"])
    tx = VersionedTransaction.from_bytes(tx_bytes)

    # Sign with our keypair
    signed_tx = VersionedTransaction(tx.message, [wallet])

    signed_b64 = base64.b64encode(bytes(signed_tx)).decode("ascii")
    print(f"  Signed transaction: {signed_b64[:40]}...")
    return signed_b64


def execute_swap(jupiter_key: str, signed_tx: str, request_id: str) -> dict:
    """Submit signed transaction to Jupiter for execution."""
    print("\n--- Executing swap ---")
    resp = requests.post(
        f"{JUPITER_API_BASE}/ultra/v1/execute",
        headers={
            "x-api-key": jupiter_key,
            "Content-Type": "application/json",
        },
        json={
            "signedTransaction": signed_tx,
            "requestId": request_id,
        },
        timeout=60,
    )
    resp.raise_for_status()
    result = resp.json()
    print(f"  Status: {result.get('status')}")
    if result.get("signature"):
        print(f"  Signature: {result['signature']}")
        print(f"  Explorer: https://solscan.io/tx/{result['signature']}")
    return result


def main():
    print("=" * 60)
    print("  MoltApp Plumbing Test")
    print("  Buy a tiny fraction of a tokenized stock via Jupiter")
    print("=" * 60)

    # 1. Load config
    jupiter_key, xai_key, private_key = load_env()
    wallet = load_wallet(private_key)
    pubkey = str(wallet.pubkey())
    print(f"\nWallet: {pubkey}")

    # 2. Ask Grok which stock to buy
    stock_symbol = ask_grok(xai_key)
    stock_mint = STOCKS[stock_symbol]["mint"]

    # 3. Get current price
    prices = get_prices(jupiter_key, [stock_mint])
    price_info = prices.get(stock_mint)
    if price_info:
        print(f"  {stock_symbol} price: ${price_info.get('price', 'N/A')}")
    else:
        print(f"  Price not available for {stock_symbol} (continuing anyway)")

    # 4. Get Jupiter order (USDC -> stock token)
    print(f"\nBuying {BUY_AMOUNT_USDC / 1_000_000:.2f} USDC worth of {stock_symbol}...")
    order = get_order(jupiter_key, USDC_MINT, stock_mint, BUY_AMOUNT_USDC, pubkey)

    if "transaction" not in order:
        print(f"ERROR: No transaction in order response: {json.dumps(order, indent=2)}")
        sys.exit(1)

    # 5. Sign the transaction
    signed_tx = sign_transaction(order, wallet)

    # 6. Execute the swap
    result = execute_swap(jupiter_key, signed_tx, order["requestId"])

    # 7. Report
    print("\n" + "=" * 60)
    if result.get("status") == "Success":
        print(f"  SUCCESS: Bought {stock_symbol} ({STOCKS[stock_symbol]['name']})")
        print(f"  Spent: {result.get('inputAmountResult', order.get('inAmount'))} USDC lamports")
        print(f"  Got: {result.get('outputAmountResult', order.get('outAmount'))} {stock_symbol} lamports")
        print(f"  Tx: https://solscan.io/tx/{result['signature']}")
    else:
        print(f"  FAILED: {json.dumps(result, indent=2)}")
    print("=" * 60)


if __name__ == "__main__":
    main()
