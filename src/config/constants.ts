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

/**
 * Complete catalog of all 65 xStocks tokenized equities on Solana.
 * Sourced from https://xstocks.fi/us/products — all backed 1:1 by underlying securities.
 * All tokens use Token-2022 standard with 9 decimals.
 */
export const XSTOCKS_CATALOG: StockToken[] = [
  // --- Mega-Cap Tech ---
  { symbol: "AAPLx", name: "Apple", mintAddress: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", decimals: 8 },
  { symbol: "AMZNx", name: "Amazon", mintAddress: "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg", decimals: 8 },
  { symbol: "GOOGLx", name: "Alphabet", mintAddress: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN", decimals: 8 },
  { symbol: "METAx", name: "Meta", mintAddress: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu", decimals: 8 },
  { symbol: "MSFTx", name: "Microsoft", mintAddress: "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX", decimals: 8 },
  { symbol: "NVDAx", name: "NVIDIA", mintAddress: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", decimals: 8 },
  { symbol: "TSLAx", name: "Tesla", mintAddress: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", decimals: 8 },
  { symbol: "ORCLx", name: "Oracle", mintAddress: "XsjFwUPiLofddX5cWFHW35GCbXcSu1BCUGfxoQAQjeL", decimals: 8 },
  { symbol: "IBMx", name: "IBM", mintAddress: "XspwhyYPdWVM8XBHZnpS9hgyag9MKjLRyE3tVfmCbSr", decimals: 8 },
  { symbol: "CSCOx", name: "Cisco", mintAddress: "Xsr3pdLQyXvDJBFgpR5nexCEZwXvigb8wbPYp4YoNFf", decimals: 8 },
  { symbol: "ACNx", name: "Accenture", mintAddress: "Xs5UJzmCRQ8DWZjskExdSQDnbE6iLkRu2jjrRAB1JSU", decimals: 8 },
  { symbol: "CRMx", name: "Salesforce", mintAddress: "XsczbcQ3zfcgAEt9qHQES8pxKAVG5rujPSHQEXi4kaN", decimals: 8 },

  // --- Semiconductors ---
  { symbol: "AVGOx", name: "Broadcom", mintAddress: "XsgSaSvNSqLTtFuyWPBhK9196Xb9Bbdyjj4fH3cPJGo", decimals: 8 },
  { symbol: "AMDx", name: "AMD", mintAddress: "XsXcJ6GZ9kVnjqGsjBnktRcuwMBmvKWh8S93RefZ1rF", decimals: 8 },
  { symbol: "INTCx", name: "Intel", mintAddress: "XshPgPdXFRWB8tP1j82rebb2Q9rPgGX37RuqzohmArM", decimals: 8 },
  { symbol: "MRVLx", name: "Marvell", mintAddress: "XsuxRGDzbLjnJ72v74b7p9VY6N66uYgTCyfwwRjVCJA", decimals: 8 },

  // --- Growth / Software ---
  { symbol: "NFLXx", name: "Netflix", mintAddress: "XsEH7wWfJJu2ZT3UCFeVfALnVA6CP5ur7Ee11KmzVpL", decimals: 8 },
  { symbol: "PLTRx", name: "Palantir", mintAddress: "XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4", decimals: 8 },
  { symbol: "APPx", name: "AppLovin", mintAddress: "XsPdAVBi8Zc1xvv53k4JcMrQaEDTgkGqKYeh7AYgPHV", decimals: 8 },
  { symbol: "CRWDx", name: "CrowdStrike", mintAddress: "Xs7xXqkcK7K8urEqGg52SECi79dRp2cEKKuYjUePYDw", decimals: 8 },

  // --- Crypto-Adjacent ---
  { symbol: "COINx", name: "Coinbase", mintAddress: "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu", decimals: 8 },
  { symbol: "MSTRx", name: "MicroStrategy", mintAddress: "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ", decimals: 8 },
  { symbol: "HOODx", name: "Robinhood", mintAddress: "XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg", decimals: 8 },
  { symbol: "CRCLx", name: "Circle", mintAddress: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1", decimals: 8 },
  { symbol: "GMEx", name: "GameStop", mintAddress: "Xsf9mBktVB9BSU5kf4nHxPq5hCBJ2j2ui3ecFGxPRGc", decimals: 8 },
  { symbol: "OPENx", name: "Opendoor", mintAddress: "XsGtpmjhmC8kyjVSWL4VicGu36ceq9u55PTgF8bhGv6", decimals: 8 },

  // --- Finance ---
  { symbol: "JPMx", name: "JPMorgan Chase", mintAddress: "XsMAqkcKsUewDrzVkait4e5u4y8REgtyS7jWgCpLV2C", decimals: 8 },
  { symbol: "BACx", name: "Bank of America", mintAddress: "XswsQk4duEQmCbGzfqUUWYmi7pV7xpJ9eEmLHXCaEQP", decimals: 8 },
  { symbol: "GSx", name: "Goldman Sachs", mintAddress: "XsgaUyp4jd1fNBCxgtTKkW64xnnhQcvgaxzsbAq5ZD1", decimals: 8 },
  { symbol: "Vx", name: "Visa", mintAddress: "XsqgsbXwWogGJsNcVZ3TyVouy2MbTkfCFhCGGGcQZ2p", decimals: 8 },
  { symbol: "MAx", name: "Mastercard", mintAddress: "XsApJFV9MAktqnAc6jqzsHVujxkGm9xcSUffaBoYLKC", decimals: 8 },
  { symbol: "BRK.Bx", name: "Berkshire Hathaway", mintAddress: "Xs6B6zawENwAbWVi7w92rjazLuAr5Az59qgWKcNb45x", decimals: 8 },

  // --- Healthcare / Pharma ---
  { symbol: "LLYx", name: "Eli Lilly", mintAddress: "Xsnuv4omNoHozR6EEW5mXkw8Nrny5rB3jVfLqi6gKMH", decimals: 8 },
  { symbol: "UNHx", name: "UnitedHealth", mintAddress: "XszvaiXGPwvk2nwb3o9C1CX4K6zH8sez11E6uyup6fe", decimals: 8 },
  { symbol: "JNJx", name: "Johnson & Johnson", mintAddress: "XsGVi5eo1Dh2zUpic4qACcjuWGjNv8GCt3dm5XcX6Dn", decimals: 8 },
  { symbol: "MRKx", name: "Merck", mintAddress: "XsnQnU7AdbRZYe2akqqpibDdXjkieGFfSkbkjX1Sd1X", decimals: 8 },
  { symbol: "PFEx", name: "Pfizer", mintAddress: "XsAtbqkAP1HJxy7hFDeq7ok6yM43DQ9mQ1Rh861X8rw", decimals: 8 },
  { symbol: "ABTx", name: "Abbott", mintAddress: "XsHtf5RpxsQ7jeJ9ivNewouZKJHbPxhPoEy6yYvULr7", decimals: 8 },
  { symbol: "ABBVx", name: "AbbVie", mintAddress: "XswbinNKyPmzTa5CskMbCPvMW6G5CMnZXZEeQSSQoie", decimals: 8 },
  { symbol: "AZNx", name: "AstraZeneca", mintAddress: "Xs3ZFkPYT2BN7qBMqf1j1bfTeTm1rFzEFSsQ1z3wAKU", decimals: 8 },
  { symbol: "NVOx", name: "Novo Nordisk", mintAddress: "XsfAzPzYrYjd4Dpa9BU3cusBsvWfVB9gBcyGC87S57n", decimals: 8 },
  { symbol: "TMOx", name: "Thermo Fisher", mintAddress: "Xs8drBWy3Sd5QY3aifG9kt9KFs2K3PGZmx7jWrsrk57", decimals: 8 },
  { symbol: "DHRx", name: "Danaher", mintAddress: "Xseo8tgCZfkHxWS9xbFYeKFyMSbWEvZGFV1Gh53GtCV", decimals: 8 },
  { symbol: "MDTx", name: "Medtronic", mintAddress: "XsDgw22qRLTv5Uwuzn6T63cW69exG41T6gwQhEK22u2", decimals: 8 },

  // --- Consumer / Retail ---
  { symbol: "WMTx", name: "Walmart", mintAddress: "Xs151QeqTCiuKtinzfRATnUESM2xTU6V9Wy8Vy538ci", decimals: 8 },
  { symbol: "KOx", name: "Coca-Cola", mintAddress: "XsaBXg8dU5cPM6ehmVctMkVqoiRG2ZjMo1cyBJ3AykQ", decimals: 8 },
  { symbol: "PEPx", name: "PepsiCo", mintAddress: "Xsv99frTRUeornyvCfvhnDesQDWuvns1M852Pez91vF", decimals: 8 },
  { symbol: "MCDx", name: "McDonald's", mintAddress: "XsqE9cRRpzxcGKDXj1BJ7Xmg4GRhZoyY1KpmGSxAWT2", decimals: 8 },
  { symbol: "PGx", name: "Procter & Gamble", mintAddress: "XsYdjDjNUygZ7yGKfQaB6TxLh2gC6RRjzLtLAGJrhzV", decimals: 8 },
  { symbol: "PMx", name: "Philip Morris", mintAddress: "Xsba6tUnSjDae2VcopDB6FGGDaxRrewFCDa5hKn5vT3", decimals: 8 },
  { symbol: "HDx", name: "Home Depot", mintAddress: "XszjVtyhowGjSC5odCqBpW1CtXXwXjYokymrk7fGKD3", decimals: 8 },

  // --- Energy ---
  { symbol: "XOMx", name: "Exxon Mobil", mintAddress: "XsaHND8sHyfMfsWPj6kSdd5VwvCayZvjYgKmmcNL5qh", decimals: 8 },
  { symbol: "CVXx", name: "Chevron", mintAddress: "XsNNMt7WTNA2sV3jrb1NNfNgapxRF5i4i6GcnTRRHts", decimals: 8 },

  // --- Industrial / Materials ---
  { symbol: "HONx", name: "Honeywell", mintAddress: "XsRbLZthfABAPAfumWNEJhPyiKDW6TvDVeAeW7oKqA2", decimals: 8 },
  { symbol: "LINx", name: "Linde", mintAddress: "XsSr8anD1hkvNMu8XQiVcmiaTP7XGvYu7Q58LdmtE8Z", decimals: 8 },
  { symbol: "CMCSAx", name: "Comcast", mintAddress: "XsvKCaNsxg2GN8jjUmq71qukMJr7Q1c5R2Mk9P8kcS8", decimals: 8 },

  // --- ETFs / Index ---
  { symbol: "SPYx", name: "S&P 500 ETF", mintAddress: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", decimals: 8 },
  { symbol: "QQQx", name: "Nasdaq 100 ETF", mintAddress: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ", decimals: 8 },
  { symbol: "TQQQx", name: "TQQQ 3x Nasdaq ETF", mintAddress: "XsjQP3iMAaQ3kQScQKthQpx9ALRbjKAjQtHg6TFomoc", decimals: 8 },
  { symbol: "GLDx", name: "Gold ETF", mintAddress: "Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re", decimals: 8 },
  { symbol: "VTIx", name: "Vanguard Total Market ETF", mintAddress: "XsssYEQjzxBCFgvYFFNuhJFBeHNdLWYeUSP8F45cDr9", decimals: 8 },
  { symbol: "TBLLx", name: "Invesco TBLL ETF", mintAddress: "XsqBC5tcVQLYt8wqGCHRnAUUecbRYXoJCReD6w7QEKp", decimals: 8 },

  // --- Specialty / Other ---
  { symbol: "AMBRx", name: "Amber", mintAddress: "XsaQTCgebC2KPbf27KUhdv5JFvHhQ4GDAPURwrEhAzb", decimals: 8 },
  { symbol: "DFDVx", name: "DFDV", mintAddress: "Xs2yquAgsHByNzx68WJC55WHjHBvG9JsMB7CWjTLyPy", decimals: 8 },
  { symbol: "STRCx", name: "Strategy PP Variable", mintAddress: "Xs78JED6PFZxWc2wCEPspZW9kL3Se5J7L5TChKgsidH", decimals: 8 },
  { symbol: "TONXx", name: "TON", mintAddress: "XscE4GUcsYhcyZu5ATiGUMmhxYa1D5fwbpJw4K6K4dp", decimals: 8 },
];
