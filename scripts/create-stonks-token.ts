#!/usr/bin/env npx tsx
/**
 * Create $STONKS Token on Monad
 *
 * Deploys a minimal ERC-20 token on Monad via ethers.js ContractFactory.
 * Token: name="STONKS", symbol="STONKS", 18 decimals, 1M supply.
 *
 * Usage:
 *   npx tsx scripts/create-stonks-token.ts
 *
 * Requires:
 *   MONAD_RPC_URL          — Monad RPC endpoint
 *   MONAD_DEPLOYER_PRIVATE_KEY — Deployer wallet private key (needs MON for gas)
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import { ethers } from "ethers";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env
try {
  for (const line of readFileSync(resolve(__dirname, "../.env"), "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
} catch {}

// ---------------------------------------------------------------------------
// Minimal ERC-20 Solidity (compiled bytecode + ABI)
// ---------------------------------------------------------------------------

// This is a minimal ERC-20 with constructor(name, symbol, initialSupply)
// Compiled from Solidity 0.8.20 with optimization
const ERC20_ABI = [
  "constructor(string name_, string symbol_, uint256 initialSupply_)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
];

// Minimal ERC-20 bytecode (constructor mints initialSupply to msg.sender)
// Compiled from:
// pragma solidity ^0.8.20;
// contract STONKS {
//   string public name; string public symbol; uint8 public decimals = 18;
//   uint256 public totalSupply;
//   mapping(address => uint256) public balanceOf;
//   mapping(address => mapping(address => uint256)) public allowance;
//   event Transfer(address indexed from, address indexed to, uint256 value);
//   event Approval(address indexed owner, address indexed spender, uint256 value);
//   constructor(string memory n, string memory s, uint256 supply) {
//     name = n; symbol = s; totalSupply = supply;
//     balanceOf[msg.sender] = supply;
//     emit Transfer(address(0), msg.sender, supply);
//   }
//   function transfer(address to, uint256 amt) external returns (bool) {
//     balanceOf[msg.sender] -= amt; balanceOf[to] += amt;
//     emit Transfer(msg.sender, to, amt); return true;
//   }
//   function approve(address sp, uint256 amt) external returns (bool) {
//     allowance[msg.sender][sp] = amt;
//     emit Approval(msg.sender, sp, amt); return true;
//   }
//   function transferFrom(address f, address t, uint256 a) external returns (bool) {
//     allowance[f][msg.sender] -= a; balanceOf[f] -= a; balanceOf[t] += a;
//     emit Transfer(f, t, a); return true;
//   }
// }
const ERC20_BYTECODE =
  "0x608060405234801561001057600080fd5b5060405161098538038061098583398101604081905261002f916101a0565b600061003b84826102a3565b50600161004883826102a3565b5060038190553360009081526004602052604081208290559050803373ffffffffffffffffffffffffffffffffffffffff167fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef60405160405180910390a35050506103625b634e487b7160e01b600052604160045260246000fd5b600082601f8301126100d357600080fd5b81516001600160401b03808211156100ed576100ed6100ac565b604051601f8301601f19908116603f01168101908282118183101715610115576101156100ac565b8160405283815260209250868385880101111561013157600080fd5b600091505b83821015610153578582018301518183018401529082019061013661014a565b600092810190910152949350505050565b60006020828403121561017757600080fd5b5051919050565b600080600060608486031215610193578283fd5b83516001600160401b03808211156101a9578485fd5b6101b5878388016100c2565b945060208601519150808211156101ca578384fd5b506101d7868287016100c2565b925050604084015190509250925092565b600181811c908216806101fc57607f821691505b60208210810361021c57634e487b7160e01b600052602260045260246000fd5b50919050565b601f82111561026e57600081815260208120601f850160051c810160208610156102495750805b601f850160051c820191505b8181101561026857828155600101610255565b50505050505b505050565b81516001600160401b0381111561028c5761028c6100ac565b6102a08161029a84546101e8565b84610222565b602080601f8311600181146102d557600084156102bd5750858301515b600019600386901b1c1916600185901b178555610268565b600085815260208120601f198616915b82811015610304578886015182559484019460019091019084016102e5565b50858210156103225787850151600019600388901b60f8161c191681555b5050505050600190811b01905550565b6105148061003a6000396000f3fe608060405234801561001057600080fd5b50600436106100935760003560e01c8063313ce56711610066578063313ce5671461010957806370a082311461012357806395d89b4114610143578063a9059cbb14610158578063dd62ed3e1461016b57600080fd5b806306fdde0314610098578063095ea7b3146100b657806318160ddd146100d957806323b872dd146100f6575b600080fd5b6100a061019e565b6040516100ad91906103b4565b60405180910390f35b6100c96100c4366004610423565b61022c565b60405190151581526020016100ad565b6100e260035481565b6040519081526020016100ad565b6100c961010436600461044d565b610296565b610111601281565b60405160ff90911681526020016100ad565b6100e2610131366004610489565b60046020526000908152604090205481565b61014b610342565b6040516100ad91906103b4565b6100c9610166366004610423565b61034f565b6100e26101793660046104ab565b600560209081526000928352604080842090915290825290205481565b600080546101a3906104de565b80601f01602080910402602001604051908101604052809291908181526020018280546101cf906104de565b801561021c5780601f106101f15761010080835404028352916020019161021c565b820191906000526020600020905b8154815290600101906020018083116101ff57829003601f168201915b5050505050905090565b33600081815260056020908152604080832073ffffffffffffffffffffffffffffffffffffffff8716808552925280832085905551919290917f8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925906102869087815260200190565b60405180910390a3506001929050565b73ffffffffffffffffffffffffffffffffffffffff831660009081526005602090815260408083203384529091528120805483900390559073ffffffffffffffffffffffffffffffffffffffff85168152600460205260408120805484900390559073ffffffffffffffffffffffffffffffffffffffff8416815260046020526040812080548401905561033984848461038c565b50600193505050509392505050565b600180546101a3906104de565b336000908152600460205260408120805483900390559073ffffffffffffffffffffffffffffffffffffffff83168152600460205260408120805483019055610388338361038c565b5060019392505050565b60405181815273ffffffffffffffffffffffffffffffffffffffff808416919085169033907fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef9060200160405180910390a3505050565b600060208083528351808285015260005b818110156103e1578581018301518582016040015282016103c5565b506000604082860101526040601f19601f8301168501019250505092915050565b803573ffffffffffffffffffffffffffffffffffffffff8116811461042557600080fd5b919050565b6000806040838503121561043c578182fd5b61044583610402565b946020939093013593505050565b600080600060608486031215610467578283fd5b61047084610402565b925061047e60208501610402565b9150604084013590509250925092565b60006020828403121561049a57600080fd5b6104a382610402565b92915050565b600080604083850312156104bb578182fd5b6104c483610402565b91506104d260208401610402565b90509250929050565b600181811c908216806104ef57607f821691505b60208210810361050f57634e487b7160e01b600052602260045260246000fd5b5091905056fea164736f6c6343000814000a";

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const rpcUrl = process.env.MONAD_RPC_URL;
  const deployerKey = process.env.MONAD_DEPLOYER_PRIVATE_KEY;

  if (!rpcUrl) {
    console.error("Missing MONAD_RPC_URL in .env");
    process.exit(1);
  }
  if (!deployerKey) {
    console.error("Missing MONAD_DEPLOYER_PRIVATE_KEY in .env");
    process.exit(1);
  }

  console.log("\n==================================================");
  console.log("  $STONKS Token Deployment on Monad");
  console.log("==================================================\n");

  const provider = new ethers.JsonRpcProvider(rpcUrl, 143);
  const deployer = new ethers.Wallet(deployerKey, provider);

  console.log(`Deployer: ${deployer.address}`);

  // Check deployer balance
  const balance = await provider.getBalance(deployer.address);
  console.log(`MON balance: ${ethers.formatEther(balance)} MON`);

  if (balance === 0n) {
    console.error("\nDeployer has 0 MON — fund it first for gas fees.");
    process.exit(1);
  }

  // Deploy
  const TOKEN_NAME = "STONKS";
  const TOKEN_SYMBOL = "STONKS";
  const INITIAL_SUPPLY = ethers.parseUnits("1000000", 18); // 1M tokens

  console.log(`\nDeploying $STONKS token...`);
  console.log(`  Name: ${TOKEN_NAME}`);
  console.log(`  Symbol: ${TOKEN_SYMBOL}`);
  console.log(`  Supply: 1,000,000 $STONKS (18 decimals)`);

  const factory = new ethers.ContractFactory(ERC20_ABI, ERC20_BYTECODE, deployer);
  const contract = await factory.deploy(TOKEN_NAME, TOKEN_SYMBOL, INITIAL_SUPPLY);
  await contract.waitForDeployment();

  const tokenAddress = await contract.getAddress();
  console.log(`\n  CONTRACT DEPLOYED!`);
  console.log(`  Address: ${tokenAddress}`);
  console.log(`\nAdd to .env:`);
  console.log(`  STONKS_TOKEN_ADDRESS=${tokenAddress}`);

  // Verify
  const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  const name = await tokenContract.name();
  const symbol = await tokenContract.symbol();
  const supply = await tokenContract.totalSupply();
  const deployerBal = await tokenContract.balanceOf(deployer.address);

  console.log(`\nVerification:`);
  console.log(`  Name: ${name}`);
  console.log(`  Symbol: ${symbol}`);
  console.log(`  Total supply: ${ethers.formatUnits(supply, 18)}`);
  console.log(`  Deployer balance: ${ethers.formatUnits(deployerBal, 18)}`);
  console.log("");
}

main().catch((err) => {
  console.error("Deployment failed:", err);
  process.exit(1);
});
