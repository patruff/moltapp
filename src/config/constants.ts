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

// ---------------------------------------------------------------------------
// Token Precision & Instruction Constants
// ---------------------------------------------------------------------------

/**
 * Lamports per SOL (Solana's smallest unit).
 *
 * SOL uses 9 decimals: 1 SOL = 1,000,000,000 lamports.
 * Used for converting between SOL and lamports in deposits/withdrawals.
 *
 * Example: 0.5 SOL = 500,000,000 lamports
 */
export const SOL_LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * USDC token decimals (smallest unit precision).
 *
 * USDC uses 6 decimals: 1 USDC = 1,000,000 smallest units.
 * Used for converting between USDC and raw token amounts.
 *
 * Example: 10.50 USDC = 10,500,000 raw units
 */
export const USDC_DECIMALS = 6;

/**
 * SOL decimal precision for display formatting.
 *
 * Determines how many decimal places to show when formatting SOL amounts
 * for database storage and display. Matches SOL's native 9-decimal precision.
 *
 * Example: amount.toFixed(SOL_DECIMALS) produces "1.234567890"
 */
export const SOL_DECIMALS = 9;

/**
 * SPL Token Transfer instruction buffer size (in bytes).
 *
 * SPL Token Transfer instruction layout:
 * - 1 byte: discriminator (3 = Transfer)
 * - 8 bytes: amount (u64 little-endian)
 * Total = 9 bytes
 */
export const SPL_TRANSFER_INSTRUCTION_SIZE = 9;

/**
 * Offset for amount field in SPL Token Transfer instruction.
 *
 * After the 1-byte discriminator, the u64 amount starts at byte index 1.
 */
export const SPL_TRANSFER_AMOUNT_OFFSET = 1;

/**
 * CreateAssociatedTokenAccountIdempotent instruction discriminator.
 *
 * Value: 1 (idempotent variant that no-ops if ATA already exists)
 * Value: 0 would be non-idempotent CreateAssociatedTokenAccount
 */
export const SPL_CREATE_IDEMPOTENT_DISCRIMINATOR = 1;

/**
 * SOL transfer transaction fee estimate (in lamports).
 *
 * Conservative estimate for a simple SOL transfer: ~5,000 lamports.
 * Actual fees may be lower (~5,000) but we use this as a safe upper bound.
 */
export const SOL_TRANSFER_FEE_LAMPORTS = 5000n;

/**
 * USDC transfer worst-case fee estimate (in lamports).
 *
 * Includes:
 * - Base transaction fee: ~5,000 lamports
 * - ATA creation rent exemption: ~2,039,280 lamports (if destination ATA doesn't exist)
 *
 * We return the worst case (ATA creation needed) to ensure sufficient balance.
 */
export const USDC_ATA_CREATION_FEE_LAMPORTS = 2_044_280n;

// ---------------------------------------------------------------------------
// Date & Time Format Constants
// ---------------------------------------------------------------------------

/**
 * ISO date string display length (YYYY-MM-DD format).
 *
 * Used for extracting date portion from ISO 8601 timestamps via:
 * `date.toISOString().slice(0, ISO_DATE_DISPLAY_LENGTH)`
 *
 * ISO 8601 format: "2026-02-20T14:30:00.000Z"
 * Extracted date:   "2026-02-20" (first 10 characters)
 *
 * Applications:
 * - Daily earnings aggregation (payments.ts)
 * - Tournament date formatting (tournaments.ts)
 * - Market regime daily grouping (market-regime.ts)
 * - Benchmark tracking date keys (benchmark-tracker.ts)
 * - Circuit breaker daily reset (circuit-breaker.ts)
 * - Attribution daily rollups (attribution.ts)
 *
 * Example:
 * ```typescript
 * const date = new Date();
 * const dateKey = date.toISOString().slice(0, ISO_DATE_DISPLAY_LENGTH);
 * // Returns: "2026-02-20"
 * ```
 *
 * Changing this value would break date parsing (10 is the standard for YYYY-MM-DD).
 */
export const ISO_DATE_DISPLAY_LENGTH = 10;

// ---------------------------------------------------------------------------
// Text Truncation & Display Constants
// ---------------------------------------------------------------------------

/**
 * Maximum reasoning text length for deduplication keys.
 *
 * Used in benchmark validation and debate engines to create compact
 * deduplication keys from reasoning text. Truncating to 100 characters:
 * - Captures the core thesis/main argument
 * - Prevents memory bloat from storing full reasoning in dedup sets
 * - Balances uniqueness detection vs performance
 *
 * Formula: reasoning.slice(0, REASONING_SNIPPET_LENGTH)
 *
 * Example:
 * ```typescript
 * const key = `${agentId}|${symbol}|${action}|${reasoning.slice(0, REASONING_SNIPPET_LENGTH)}`;
 * // "agent_123|AAPL|BUY|Strong fundamentals suggest undervaluation. Apple's Q4 earnings beat expectations wi..."
 * ```
 *
 * Applications:
 * - Benchmark validator content duplicate detection (benchmark-validator.ts)
 * - Cross-agent debate engine fallback thesis extraction (cross-agent-debate-engine.ts)
 */
export const REASONING_SNIPPET_LENGTH = 100;

/**
 * Hash truncation length for readability in error messages and logs.
 *
 * When displaying SHA-256 hashes (64 hex characters) in error messages,
 * truncate to 16 characters for readability while maintaining uniqueness
 * for debugging purposes.
 *
 * Collision safety: 16 hex chars = 64 bits = ~18 quintillion combinations
 * (birthday collision at ~4 billion hashes, safe for debugging display)
 *
 * Formula: hash.slice(0, HASH_DISPLAY_LENGTH)
 *
 * Example:
 * ```typescript
 * const shortHash = computedHash.slice(0, HASH_DISPLAY_LENGTH);
 * throw new Error(`Hash mismatch: computed ${shortHash}..., expected ${expectedHash}...`);
 * // Error: "Hash mismatch: computed a3f9z2k1x4m9p6q0..., expected b7d2e5n3w8r1t4y9..."
 * ```
 *
 * Applications:
 * - Benchmark integrity prover hash mismatch diagnostics (benchmark-integrity-prover.ts)
 * - Dataset fingerprint validation error messages
 */
export const HASH_DISPLAY_LENGTH = 16;

// ---------------------------------------------------------------------------
// Report Display Limit Constants
// ---------------------------------------------------------------------------

/**
 * Maximum number of top analysis items to display in agent intelligence reports.
 *
 * Controls how many items appear in "top N" lists across reporting and analytics:
 * - Top vulnerabilities (adversarial robustness)
 * - Favorite symbols (intelligence reports)
 * - Common hallucination types (reasoning forensics)
 * - Frequent cognitive biases (reasoning taxonomy)
 * - Top strategic themes (strategy attribution)
 * - Key decision patterns (competition/decision replay)
 *
 * Limiting to 5 items balances:
 * - Focus: Shows only most significant patterns
 * - Brevity: Prevents overwhelming API responses
 * - Performance: Reduces payload size for dashboard rendering
 *
 * Example: Agent has 20 cognitive biases detected → show top 5 most frequent
 *
 * Tuning: Increase to 8-10 for more comprehensive analysis, decrease to 3 for
 * executive summary brevity.
 */
export const TOP_ANALYSIS_ITEMS_LIMIT = 5;

/**
 * Maximum number of themes to display in reasoning taxonomy analysis.
 *
 * Controls theme list length in cognitive pattern classification reports.
 * Themes represent recurring topics/concepts in agent reasoning (e.g.,
 * "momentum investing", "value analysis", "risk management").
 *
 * Set higher than TOP_ANALYSIS_ITEMS_LIMIT (8 vs 5) because themes are:
 * - Higher-level abstractions (less granular than individual patterns)
 * - More context-rich (users benefit from seeing broader theme coverage)
 * - Less redundant (themes rarely overlap compared to specific vulnerabilities)
 *
 * Example: Agent uses 15 themes → show top 8 most frequent
 *
 * Tuning: Increase to 10-12 for deeper thematic analysis, decrease to 5 to
 * match other top-N limits for consistency.
 */
export const TOP_THEMES_DISPLAY_LIMIT = 8;

/**
 * Maximum number of agent-intent combinations to display in strategy attribution
 * analysis results.
 *
 * Controls how many top-performing agent+strategy pairings appear in the
 * getTopAgentIntentCombinations() results, which rank agents by their average
 * P&L per trading intent (e.g., "ValueBot + momentum = +2.3% avg").
 *
 * Set higher than TOP_ANALYSIS_ITEMS_LIMIT (10 vs 5) because combinations are:
 * - Cross-dimensional (agent × intent matrix has many potential pairs)
 * - More exhaustive (users benefit from seeing broader agent-strategy coverage)
 * - Less redundant (each combination is a unique agent+intent pair)
 *
 * Example: 3 agents × 6 intents = 18 combinations → show top 10 by avg P&L
 *
 * Tuning: Increase to 15 for broader agent-strategy coverage, decrease to 5 to
 * match TOP_ANALYSIS_ITEMS_LIMIT for consistency.
 */
export const TOP_AGENT_INTENT_COMBINATIONS_LIMIT = 10;

/** Stock category for classification */
export type StockCategory =
  | "Mega-Cap Tech"
  | "Semiconductors"
  | "Software"
  | "Crypto-Adjacent"
  | "Finance"
  | "Healthcare"
  | "Consumer"
  | "Energy"
  | "Industrial"
  | "ETF"
  | "Other";

/** A single xStocks token entry */
export interface StockToken {
  symbol: string;
  name: string;
  mintAddress: string;
  decimals: number;
  category: StockCategory;
  description: string;  // Short description like "AI Chips", "Social Media"
}

/**
 * Complete catalog of all 65 xStocks tokenized equities on Solana.
 * Sourced from https://xstocks.fi/us/products — all backed 1:1 by underlying securities.
 * All tokens use Token-2022 standard with 9 decimals.
 */
export const XSTOCKS_CATALOG: StockToken[] = [
  // --- Mega-Cap Tech ---
  { symbol: "AAPLx", name: "Apple", mintAddress: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", decimals: 8, category: "Mega-Cap Tech", description: "iPhones & Services" },
  { symbol: "AMZNx", name: "Amazon", mintAddress: "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg", decimals: 8, category: "Mega-Cap Tech", description: "E-commerce & Cloud" },
  { symbol: "GOOGLx", name: "Alphabet", mintAddress: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN", decimals: 8, category: "Mega-Cap Tech", description: "Search & AI" },
  { symbol: "METAx", name: "Meta", mintAddress: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu", decimals: 8, category: "Mega-Cap Tech", description: "Social Media" },
  { symbol: "MSFTx", name: "Microsoft", mintAddress: "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX", decimals: 8, category: "Mega-Cap Tech", description: "Cloud & Software" },
  { symbol: "NVDAx", name: "NVIDIA", mintAddress: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", decimals: 8, category: "Semiconductors", description: "AI Chips" },
  { symbol: "TSLAx", name: "Tesla", mintAddress: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", decimals: 8, category: "Mega-Cap Tech", description: "EVs & Energy" },
  { symbol: "ORCLx", name: "Oracle", mintAddress: "XsjFwUPiLofddX5cWFHW35GCbXcSu1BCUGfxoQAQjeL", decimals: 8, category: "Software", description: "Database & Cloud" },
  { symbol: "IBMx", name: "IBM", mintAddress: "XspwhyYPdWVM8XBHZnpS9hgyag9MKjLRyE3tVfmCbSr", decimals: 8, category: "Software", description: "Enterprise IT" },
  { symbol: "CSCOx", name: "Cisco", mintAddress: "Xsr3pdLQyXvDJBFgpR5nexCEZwXvigb8wbPYp4YoNFf", decimals: 8, category: "Mega-Cap Tech", description: "Networking" },
  { symbol: "ACNx", name: "Accenture", mintAddress: "Xs5UJzmCRQ8DWZjskExdSQDnbE6iLkRu2jjrRAB1JSU", decimals: 8, category: "Software", description: "IT Consulting" },
  { symbol: "CRMx", name: "Salesforce", mintAddress: "XsczbcQ3zfcgAEt9qHQES8pxKAVG5rujPSHQEXi4kaN", decimals: 8, category: "Software", description: "CRM Software" },

  // --- Semiconductors ---
  { symbol: "AVGOx", name: "Broadcom", mintAddress: "XsgSaSvNSqLTtFuyWPBhK9196Xb9Bbdyjj4fH3cPJGo", decimals: 8, category: "Semiconductors", description: "Network Chips" },
  { symbol: "AMDx", name: "AMD", mintAddress: "XsXcJ6GZ9kVnjqGsjBnktRcuwMBmvKWh8S93RefZ1rF", decimals: 8, category: "Semiconductors", description: "CPUs & GPUs" },
  { symbol: "INTCx", name: "Intel", mintAddress: "XshPgPdXFRWB8tP1j82rebb2Q9rPgGX37RuqzohmArM", decimals: 8, category: "Semiconductors", description: "PC Chips" },
  { symbol: "MRVLx", name: "Marvell", mintAddress: "XsuxRGDzbLjnJ72v74b7p9VY6N66uYgTCyfwwRjVCJA", decimals: 8, category: "Semiconductors", description: "Data Infrastructure" },

  // --- Growth / Software ---
  { symbol: "NFLXx", name: "Netflix", mintAddress: "XsEH7wWfJJu2ZT3UCFeVfALnVA6CP5ur7Ee11KmzVpL", decimals: 8, category: "Software", description: "Streaming" },
  { symbol: "PLTRx", name: "Palantir", mintAddress: "XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4", decimals: 8, category: "Software", description: "Data Analytics" },
  { symbol: "APPx", name: "AppLovin", mintAddress: "XsPdAVBi8Zc1xvv53k4JcMrQaEDTgkGqKYeh7AYgPHV", decimals: 8, category: "Software", description: "Mobile Gaming" },
  { symbol: "CRWDx", name: "CrowdStrike", mintAddress: "Xs7xXqkcK7K8urEqGg52SECi79dRp2cEKKuYjUePYDw", decimals: 8, category: "Software", description: "Cybersecurity" },

  // --- Crypto-Adjacent ---
  { symbol: "COINx", name: "Coinbase", mintAddress: "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu", decimals: 8, category: "Crypto-Adjacent", description: "Crypto Exchange" },
  { symbol: "MSTRx", name: "MicroStrategy", mintAddress: "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ", decimals: 8, category: "Crypto-Adjacent", description: "Bitcoin Treasury" },
  { symbol: "HOODx", name: "Robinhood", mintAddress: "XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg", decimals: 8, category: "Crypto-Adjacent", description: "Trading App" },
  { symbol: "CRCLx", name: "Circle", mintAddress: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1", decimals: 8, category: "Crypto-Adjacent", description: "USDC Issuer" },
  { symbol: "GMEx", name: "GameStop", mintAddress: "Xsf9mBktVB9BSU5kf4nHxPq5hCBJ2j2ui3ecFGxPRGc", decimals: 8, category: "Crypto-Adjacent", description: "Meme Stock" },
  { symbol: "OPENx", name: "Opendoor", mintAddress: "XsGtpmjhmC8kyjVSWL4VicGu36ceq9u55PTgF8bhGv6", decimals: 8, category: "Other", description: "Real Estate Tech" },

  // --- Finance ---
  { symbol: "JPMx", name: "JPMorgan Chase", mintAddress: "XsMAqkcKsUewDrzVkait4e5u4y8REgtyS7jWgCpLV2C", decimals: 8, category: "Finance", description: "Investment Bank" },
  { symbol: "BACx", name: "Bank of America", mintAddress: "XswsQk4duEQmCbGzfqUUWYmi7pV7xpJ9eEmLHXCaEQP", decimals: 8, category: "Finance", description: "Consumer Bank" },
  { symbol: "GSx", name: "Goldman Sachs", mintAddress: "XsgaUyp4jd1fNBCxgtTKkW64xnnhQcvgaxzsbAq5ZD1", decimals: 8, category: "Finance", description: "Investment Bank" },
  { symbol: "Vx", name: "Visa", mintAddress: "XsqgsbXwWogGJsNcVZ3TyVouy2MbTkfCFhCGGGcQZ2p", decimals: 8, category: "Finance", description: "Payments" },
  { symbol: "MAx", name: "Mastercard", mintAddress: "XsApJFV9MAktqnAc6jqzsHVujxkGm9xcSUffaBoYLKC", decimals: 8, category: "Finance", description: "Payments" },
  { symbol: "BRK.Bx", name: "Berkshire Hathaway", mintAddress: "Xs6B6zawENwAbWVi7w92rjazLuAr5Az59qgWKcNb45x", decimals: 8, category: "Finance", description: "Conglomerate" },

  // --- Healthcare / Pharma ---
  { symbol: "LLYx", name: "Eli Lilly", mintAddress: "Xsnuv4omNoHozR6EEW5mXkw8Nrny5rB3jVfLqi6gKMH", decimals: 8, category: "Healthcare", description: "Weight Loss Drugs" },
  { symbol: "UNHx", name: "UnitedHealth", mintAddress: "XszvaiXGPwvk2nwb3o9C1CX4K6zH8sez11E6uyup6fe", decimals: 8, category: "Healthcare", description: "Health Insurance" },
  { symbol: "JNJx", name: "Johnson & Johnson", mintAddress: "XsGVi5eo1Dh2zUpic4qACcjuWGjNv8GCt3dm5XcX6Dn", decimals: 8, category: "Healthcare", description: "Pharma & Consumer" },
  { symbol: "MRKx", name: "Merck", mintAddress: "XsnQnU7AdbRZYe2akqqpibDdXjkieGFfSkbkjX1Sd1X", decimals: 8, category: "Healthcare", description: "Pharmaceuticals" },
  { symbol: "PFEx", name: "Pfizer", mintAddress: "XsAtbqkAP1HJxy7hFDeq7ok6yM43DQ9mQ1Rh861X8rw", decimals: 8, category: "Healthcare", description: "Pharmaceuticals" },
  { symbol: "ABTx", name: "Abbott", mintAddress: "XsHtf5RpxsQ7jeJ9ivNewouZKJHbPxhPoEy6yYvULr7", decimals: 8, category: "Healthcare", description: "Medical Devices" },
  { symbol: "ABBVx", name: "AbbVie", mintAddress: "XswbinNKyPmzTa5CskMbCPvMW6G5CMnZXZEeQSSQoie", decimals: 8, category: "Healthcare", description: "Biotech" },
  { symbol: "AZNx", name: "AstraZeneca", mintAddress: "Xs3ZFkPYT2BN7qBMqf1j1bfTeTm1rFzEFSsQ1z3wAKU", decimals: 8, category: "Healthcare", description: "Pharmaceuticals" },
  { symbol: "NVOx", name: "Novo Nordisk", mintAddress: "XsfAzPzYrYjd4Dpa9BU3cusBsvWfVB9gBcyGC87S57n", decimals: 8, category: "Healthcare", description: "Weight Loss Drugs" },
  { symbol: "TMOx", name: "Thermo Fisher", mintAddress: "Xs8drBWy3Sd5QY3aifG9kt9KFs2K3PGZmx7jWrsrk57", decimals: 8, category: "Healthcare", description: "Lab Equipment" },
  { symbol: "DHRx", name: "Danaher", mintAddress: "Xseo8tgCZfkHxWS9xbFYeKFyMSbWEvZGFV1Gh53GtCV", decimals: 8, category: "Healthcare", description: "Life Sciences" },
  { symbol: "MDTx", name: "Medtronic", mintAddress: "XsDgw22qRLTv5Uwuzn6T63cW69exG41T6gwQhEK22u2", decimals: 8, category: "Healthcare", description: "Medical Devices" },

  // --- Consumer / Retail ---
  { symbol: "WMTx", name: "Walmart", mintAddress: "Xs151QeqTCiuKtinzfRATnUESM2xTU6V9Wy8Vy538ci", decimals: 8, category: "Consumer", description: "Retail" },
  { symbol: "KOx", name: "Coca-Cola", mintAddress: "XsaBXg8dU5cPM6ehmVctMkVqoiRG2ZjMo1cyBJ3AykQ", decimals: 8, category: "Consumer", description: "Beverages" },
  { symbol: "PEPx", name: "PepsiCo", mintAddress: "Xsv99frTRUeornyvCfvhnDesQDWuvns1M852Pez91vF", decimals: 8, category: "Consumer", description: "Beverages & Snacks" },
  { symbol: "MCDx", name: "McDonald's", mintAddress: "XsqE9cRRpzxcGKDXj1BJ7Xmg4GRhZoyY1KpmGSxAWT2", decimals: 8, category: "Consumer", description: "Fast Food" },
  { symbol: "PGx", name: "Procter & Gamble", mintAddress: "XsYdjDjNUygZ7yGKfQaB6TxLh2gC6RRjzLtLAGJrhzV", decimals: 8, category: "Consumer", description: "Consumer Goods" },
  { symbol: "PMx", name: "Philip Morris", mintAddress: "Xsba6tUnSjDae2VcopDB6FGGDaxRrewFCDa5hKn5vT3", decimals: 8, category: "Consumer", description: "Tobacco" },
  { symbol: "HDx", name: "Home Depot", mintAddress: "XszjVtyhowGjSC5odCqBpW1CtXXwXjYokymrk7fGKD3", decimals: 8, category: "Consumer", description: "Home Improvement" },

  // --- Energy ---
  { symbol: "XOMx", name: "Exxon Mobil", mintAddress: "XsaHND8sHyfMfsWPj6kSdd5VwvCayZvjYgKmmcNL5qh", decimals: 8, category: "Energy", description: "Oil & Gas" },
  { symbol: "CVXx", name: "Chevron", mintAddress: "XsNNMt7WTNA2sV3jrb1NNfNgapxRF5i4i6GcnTRRHts", decimals: 8, category: "Energy", description: "Oil & Gas" },

  // --- Industrial / Materials ---
  { symbol: "HONx", name: "Honeywell", mintAddress: "XsRbLZthfABAPAfumWNEJhPyiKDW6TvDVeAeW7oKqA2", decimals: 8, category: "Industrial", description: "Aerospace & Tech" },
  { symbol: "LINx", name: "Linde", mintAddress: "XsSr8anD1hkvNMu8XQiVcmiaTP7XGvYu7Q58LdmtE8Z", decimals: 8, category: "Industrial", description: "Industrial Gas" },
  { symbol: "CMCSAx", name: "Comcast", mintAddress: "XsvKCaNsxg2GN8jjUmq71qukMJr7Q1c5R2Mk9P8kcS8", decimals: 8, category: "Industrial", description: "Media & Telecom" },

  // --- ETFs / Index ---
  { symbol: "SPYx", name: "S&P 500 ETF", mintAddress: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", decimals: 8, category: "ETF", description: "US Large Cap" },
  { symbol: "QQQx", name: "Nasdaq 100 ETF", mintAddress: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ", decimals: 8, category: "ETF", description: "Tech Index" },
  { symbol: "TQQQx", name: "TQQQ 3x Nasdaq ETF", mintAddress: "XsjQP3iMAaQ3kQScQKthQpx9ALRbjKAjQtHg6TFomoc", decimals: 8, category: "ETF", description: "3x Leveraged Tech" },
  { symbol: "GLDx", name: "Gold ETF", mintAddress: "Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re", decimals: 8, category: "ETF", description: "Gold" },
  { symbol: "VTIx", name: "Vanguard Total Market ETF", mintAddress: "XsssYEQjzxBCFgvYFFNuhJFBeHNdLWYeUSP8F45cDr9", decimals: 8, category: "ETF", description: "Total US Market" },
  { symbol: "TBLLx", name: "Invesco TBLL ETF", mintAddress: "XsqBC5tcVQLYt8wqGCHRnAUUecbRYXoJCReD6w7QEKp", decimals: 8, category: "ETF", description: "Treasury Bills" },

  // --- Specialty / Other ---
  { symbol: "AMBRx", name: "Amber", mintAddress: "XsaQTCgebC2KPbf27KUhdv5JFvHhQ4GDAPURwrEhAzb", decimals: 8, category: "Other", description: "Specialty" },
  { symbol: "DFDVx", name: "DFDV", mintAddress: "Xs2yquAgsHByNzx68WJC55WHjHBvG9JsMB7CWjTLyPy", decimals: 8, category: "Other", description: "Specialty" },
  { symbol: "STRCx", name: "Strategy PP Variable", mintAddress: "Xs78JED6PFZxWc2wCEPspZW9kL3Se5J7L5TChKgsidH", decimals: 8, category: "Other", description: "Strategy Fund" },
  { symbol: "TONXx", name: "TON", mintAddress: "XscE4GUcsYhcyZu5ATiGUMmhxYa1D5fwbpJw4K6K4dp", decimals: 8, category: "Crypto-Adjacent", description: "Telegram Crypto" },
];

// ---------------------------------------------------------------------------
// Stock Lookup Helpers
// ---------------------------------------------------------------------------

/** Lookup map for O(1) access by symbol */
const STOCK_BY_SYMBOL = new Map(XSTOCKS_CATALOG.map((s) => [s.symbol, s]));

/** Lookup map for O(1) access by mint address */
const STOCK_BY_MINT = new Map(XSTOCKS_CATALOG.map((s) => [s.mintAddress, s]));

/** Get stock info by symbol (e.g., "NVDAx") */
export function getStockBySymbol(symbol: string): StockToken | undefined {
  return STOCK_BY_SYMBOL.get(symbol);
}

/** Get stock info by mint address */
export function getStockByMint(mintAddress: string): StockToken | undefined {
  return STOCK_BY_MINT.get(mintAddress);
}

/** Get display name for a symbol (e.g., "NVDAx" → "NVIDIA") */
export function getStockName(symbol: string): string {
  return STOCK_BY_SYMBOL.get(symbol)?.name ?? symbol;
}

/** Get category for a symbol */
export function getStockCategory(symbol: string): StockCategory | undefined {
  return STOCK_BY_SYMBOL.get(symbol)?.category;
}

/** Get description for a symbol */
export function getStockDescription(symbol: string): string | undefined {
  return STOCK_BY_SYMBOL.get(symbol)?.description;
}

// ---------------------------------------------------------------------------
// ID Generation Constants (Shared across all services)
// ---------------------------------------------------------------------------

/**
 * Start index for extracting random suffix from Math.random().toString(36).
 *
 * Math.random().toString(36) produces format "0.xxxxx", so we skip the "0."
 * prefix by starting at index 2.
 *
 * @example
 * Math.random().toString(36) → "0.a3f9z2k8m"
 * .slice(ID_RANDOM_START, ...) → "a3f9z2k8m"
 */
export const ID_RANDOM_START = 2;

/**
 * Short random suffix length for ID generation (4 characters).
 * Provides 1.7M combinations (36^4 = 1,679,616).
 * Use for high-frequency, short-lived IDs with timestamp uniqueness.
 *
 * @example
 * Format: "prefix_timestamp_xxxx"
 * Example: "adv_1738540800000_a3f9"
 */
export const ID_RANDOM_LENGTH_SHORT = 4;

/**
 * Standard random suffix length for ID generation (6 characters).
 * Provides 2.2B combinations (36^6 = 2,176,782,336).
 * Most common length - good balance of uniqueness and compactness.
 *
 * @example
 * Format: "prefix_timestamp_xxxxxx"
 * Example: "analyst_1738540800000_a3f9z2"
 */
export const ID_RANDOM_LENGTH_STANDARD = 6;

/**
 * Long random suffix length for ID generation (8 characters).
 * Provides 2.8T combinations (36^8 = 2,821,109,907,456).
 * Use for low-frequency, long-lived IDs requiring maximum uniqueness.
 *
 * @example
 * Format: "prefix_timestamp_xxxxxxxx"
 * Example: "prov_1738540800000_a3f9z2k8"
 */
export const ID_RANDOM_LENGTH_LONG = 8;

// ---------------------------------------------------------------------------
// Benchmark Engine Integrity Score Simulation Constants
// ---------------------------------------------------------------------------

/**
 * Base integrity score for simulated benchmark test results.
 *
 * Integrity scores simulate how "honest" or "reliable" test results are
 * in benchmark engine test generation. Used across all benchmark versions
 * (v32-v37) to generate consistent test quality baselines.
 *
 * Formula: integrityScore = BASE + random() * VARIANCE = [80, 95]
 *
 * @example
 * 80 base = high baseline integrity (tests are trustworthy)
 * 95 max = perfect integrity (test results fully reliable)
 */
export const INTEGRITY_SCORE_BASE = 80;

/**
 * Random variance added to integrity score baseline.
 *
 * Adds realistic variation to simulated test integrity scores.
 * Variance of 15 produces scores in [80, 95] range.
 *
 * Formula: integrityScore = BASE + random() * VARIANCE
 * Range: [INTEGRITY_SCORE_BASE, INTEGRITY_SCORE_BASE + INTEGRITY_SCORE_VARIANCE]
 *
 * @example
 * BASE=80, VARIANCE=15 → scores between 80-95
 * Higher variance = more unpredictable test quality simulation
 */
export const INTEGRITY_SCORE_VARIANCE = 15;
