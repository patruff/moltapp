/**
 * Monad Client
 *
 * ethers.js wrapper for interacting with Monad (chain ID 143).
 * Provides wallet management and ERC-20 token operations for $STONKS.
 */

import { ethers } from "ethers";

const MONAD_CHAIN_ID = 143;
const DEFAULT_RPC = "https://mainnet.monad.xyz/rpc";

// Minimal ERC-20 ABI for balanceOf, transfer, approve, decimals
const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function totalSupply() view returns (uint256)",
];

// Map agent IDs to their Monad private key env vars
const AGENT_KEY_MAP: Record<string, string> = {
  "claude-value-investor": "CLAUDE_MONAD_PRIVATE_KEY",
  "gpt-momentum-trader": "GPT_MONAD_PRIVATE_KEY",
  "grok-contrarian": "GROK_MONAD_PRIVATE_KEY",
};

let _provider: ethers.JsonRpcProvider | null = null;

/** Get or create the Monad JSON-RPC provider */
export function getMonadProvider(): ethers.JsonRpcProvider {
  if (!_provider) {
    const rpcUrl = process.env.MONAD_RPC_URL || DEFAULT_RPC;
    _provider = new ethers.JsonRpcProvider(rpcUrl, MONAD_CHAIN_ID);
  }
  return _provider;
}

/** Get an ethers Wallet for a given agent ID */
export function getMonadWallet(agentId: string): ethers.Wallet {
  const envKey = AGENT_KEY_MAP[agentId];
  if (!envKey) {
    throw new Error(`No Monad private key mapping for agent: ${agentId}`);
  }
  const privateKey = process.env[envKey];
  if (!privateKey) {
    throw new Error(`Missing env var ${envKey} for agent ${agentId}`);
  }
  return new ethers.Wallet(privateKey, getMonadProvider());
}

/** Get the deployer wallet (for token creation and initial funding) */
export function getDeployerWallet(): ethers.Wallet {
  const privateKey = process.env.MONAD_DEPLOYER_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("Missing env var MONAD_DEPLOYER_PRIVATE_KEY");
  }
  return new ethers.Wallet(privateKey, getMonadProvider());
}

/** Get an ERC-20 contract instance for $STONKS */
export function getStonksContract(signerOrProvider?: ethers.Signer | ethers.Provider): ethers.Contract {
  const tokenAddress = process.env.STONKS_TOKEN_ADDRESS;
  if (!tokenAddress) {
    throw new Error("Missing env var STONKS_TOKEN_ADDRESS");
  }
  return new ethers.Contract(
    tokenAddress,
    ERC20_ABI,
    signerOrProvider || getMonadProvider(),
  );
}

/** Get $STONKS balance for an address (returns human-readable number) */
export async function getStonksBalance(address: string): Promise<number> {
  const contract = getStonksContract();
  const decimals: bigint = await contract.decimals();
  const balance: bigint = await contract.balanceOf(address);
  return Number(ethers.formatUnits(balance, decimals));
}

/** Transfer $STONKS from one agent to another */
export async function transferStonks(
  fromAgentId: string,
  toAddress: string,
  amount: number,
): Promise<string> {
  const wallet = getMonadWallet(fromAgentId);
  const contract = getStonksContract(wallet);
  const decimals: bigint = await contract.decimals();
  const rawAmount = ethers.parseUnits(amount.toString(), decimals);

  const tx = await contract.transfer(toAddress, rawAmount);
  const receipt = await tx.wait();
  return receipt.hash;
}

/** Transfer $STONKS using a wallet directly (for deployer/funding) */
export async function transferStonksFromWallet(
  wallet: ethers.Wallet,
  toAddress: string,
  amount: number,
): Promise<string> {
  const contract = getStonksContract(wallet);
  const decimals: bigint = await contract.decimals();
  const rawAmount = ethers.parseUnits(amount.toString(), decimals);

  const tx = await contract.transfer(toAddress, rawAmount);
  const receipt = await tx.wait();
  return receipt.hash;
}

/** Get MON (native token) balance for an address */
export async function getMonBalance(address: string): Promise<number> {
  const provider = getMonadProvider();
  const balance = await provider.getBalance(address);
  return Number(ethers.formatEther(balance));
}

/** Get the Monad address for a given agent ID */
export function getAgentMonadAddress(agentId: string): string {
  const wallet = getMonadWallet(agentId);
  return wallet.address;
}

/** Get all agent Monad addresses */
export function getAllAgentAddresses(): Array<{ agentId: string; address: string }> {
  return Object.keys(AGENT_KEY_MAP)
    .filter((agentId) => {
      const envKey = AGENT_KEY_MAP[agentId];
      return !!process.env[envKey];
    })
    .map((agentId) => ({
      agentId,
      address: getMonadWallet(agentId).address,
    }));
}
