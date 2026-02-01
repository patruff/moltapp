/** USDC mint address on Solana mainnet */
export const USDC_MINT_MAINNET =
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** USDC mint address on Solana devnet */
export const USDC_MINT_DEVNET =
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

/** API key prefix for MoltApp-issued keys */
export const API_KEY_PREFIX = "mk_";

/** Rate limit: requests per window per agent */
export const RATE_LIMIT_MAX = 60;

/** Rate limit window in milliseconds (1 minute) */
export const RATE_LIMIT_WINDOW_MS = 60_000;

// ---------------------------------------------------------------------------
// Trading constants (Phase 2)
// ---------------------------------------------------------------------------

/** Jupiter API base URL (all endpoints) */
export const JUPITER_API_BASE_URL = "https://api.jup.ag";

/** Token-2022 (Token Extensions) program address -- used by xStocks tokens */
export const TOKEN_2022_PROGRAM_ADDRESS =
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/** Associated Token Account program address */
export const ATA_PROGRAM_ADDRESS =
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

/** A single xStocks token entry */
export interface StockToken {
  symbol: string;
  name: string;
  mintAddress: string;
  decimals: number;
}

/** Curated catalog of top-traded xStocks tokenized equities on Solana */
export const XSTOCKS_CATALOG: StockToken[] = [
  { symbol: "AAPLx", name: "Apple", mintAddress: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", decimals: 9 },
  { symbol: "AMZNx", name: "Amazon", mintAddress: "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg", decimals: 9 },
  { symbol: "GOOGLx", name: "Alphabet", mintAddress: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN", decimals: 9 },
  { symbol: "METAx", name: "Meta", mintAddress: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu", decimals: 9 },
  { symbol: "MSFTx", name: "Microsoft", mintAddress: "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX", decimals: 9 },
  { symbol: "NVDAx", name: "NVIDIA", mintAddress: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", decimals: 9 },
  { symbol: "TSLAx", name: "Tesla", mintAddress: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", decimals: 9 },
  { symbol: "SPYx", name: "S&P 500 ETF", mintAddress: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", decimals: 9 },
  { symbol: "QQQx", name: "Nasdaq 100 ETF", mintAddress: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ", decimals: 9 },
  { symbol: "COINx", name: "Coinbase", mintAddress: "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu", decimals: 9 },
  { symbol: "CRCLx", name: "Circle", mintAddress: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1", decimals: 9 },
  { symbol: "MSTRx", name: "MicroStrategy", mintAddress: "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ", decimals: 9 },
  { symbol: "AVGOx", name: "Broadcom", mintAddress: "XsgSaSvNSqLTtFuyWPBhK9196Xb9Bbdyjj4fH3cPJGo", decimals: 9 },
  { symbol: "JPMx", name: "JPMorgan Chase", mintAddress: "XsMAqkcKsUewDrzVkait4e5u4y8REgtyS7jWgCpLV2C", decimals: 9 },
  { symbol: "HOODx", name: "Robinhood", mintAddress: "XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg", decimals: 9 },
  { symbol: "LLYx", name: "Eli Lilly", mintAddress: "Xsnuv4omNoHozR6EEW5mXkw8Nrny5rB3jVfLqi6gKMH", decimals: 9 },
  { symbol: "CRMx", name: "Salesforce", mintAddress: "XsczbcQ3zfcgAEt9qHQES8pxKAVG5rujPSHQEXi4kaN", decimals: 9 },
  { symbol: "NFLXx", name: "Netflix", mintAddress: "XsEH7wWfJJu2ZT3UCFeVfALnVA6CP5ur7Ee11KmzVpL", decimals: 9 },
  { symbol: "PLTRx", name: "Palantir", mintAddress: "XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4", decimals: 9 },
  { symbol: "GMEx", name: "GameStop", mintAddress: "Xsf9mBktVB9BSU5kf4nHxPq5hCBJ2j2ui3ecFGxPRGc", decimals: 9 },
];
