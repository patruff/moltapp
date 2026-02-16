/**
 * Centralized ID Generation Constants
 *
 * Standardizes random alphanumeric suffix generation across all services.
 * IDs follow the format: `{prefix}_{timestamp}_{randomSuffix}`
 *
 * The random suffix is extracted from Math.random().toString(36), which:
 * 1. Produces "0.xxxxx" format (base-36: digits 0-9 + letters a-z)
 * 2. Requires slicing from index 2 to skip "0." prefix
 * 3. Provides different uniqueness guarantees based on suffix length
 *
 * Examples:
 * - 4-char suffix: "evt_1738540800000_k7m2" (36^4 ≈ 1.7M combinations)
 * - 6-char suffix: "analyst_1738540800000_a3f9z2" (36^6 ≈ 2.2B combinations)
 * - 8-char suffix: "audit_1738540800000_x5j9k2w7" (36^8 ≈ 2.8T combinations)
 */

/**
 * Start position for extracting random alphanumeric suffix.
 * Math.random().toString(36) produces "0.xxxxx" format, so we skip
 * the "0." prefix by starting at index 2.
 */
export const ID_RANDOM_START = 2;

/**
 * Short suffix length (4 characters) for high-frequency, low-risk IDs.
 * Provides ~1.7 million combinations (36^4 = 1,679,616).
 *
 * Usage: `.slice(ID_RANDOM_START, ID_RANDOM_START + ID_RANDOM_LENGTH_SHORT)`
 *
 * Use cases:
 * - Audit log events (ephemeral, high volume)
 * - Debate rounds (short-lived, timestamped)
 * - Benchmark trade IDs (already scoped by version prefix)
 * - Arbitration cases (low collision risk with timestamp)
 * - Slippage analysis records (transient)
 */
export const ID_RANDOM_LENGTH_SHORT = 4;

/**
 * Standard suffix length (6 characters) for most service IDs.
 * Provides ~2.2 billion combinations (36^6 = 2,176,782,336).
 *
 * Usage: `.slice(ID_RANDOM_START, ID_RANDOM_START + ID_RANDOM_LENGTH_STANDARD)`
 *
 * Use cases:
 * - Analyst/client registration IDs (finance-service)
 * - Trade subscriptions (trade-stream)
 * - Deliberation sessions (pre-trade-deliberation)
 * - Meeting IDs (meeting-of-minds)
 * - Risk alerts (risk-management)
 * - DeFi position IDs (defi-yield)
 * - Feedback outcomes (agent-feedback)
 * - Forensic ledger entries (trade-forensic-ledger)
 * - Portfolio musings (portfolio-musings)
 * - Paid advice records (paid-advice)
 */
export const ID_RANDOM_LENGTH_STANDARD = 6;

/**
 * Long suffix length (8 characters) for critical, permanent IDs.
 * Provides ~2.8 trillion combinations (36^8 = 2,821,109,907,456).
 *
 * Usage: `.slice(ID_RANDOM_START, ID_RANDOM_START + ID_RANDOM_LENGTH_LONG)`
 *
 * Use cases:
 * - Benchmark provenance records (permanent audit trail)
 * - Audit trail entries (compliance, long-term storage)
 *
 * Higher uniqueness guarantees reduce collision risk for records that:
 * 1. Persist indefinitely (compliance, audit)
 * 2. Cross multiple system boundaries (provenance tracking)
 * 3. Require absolute uniqueness (regulatory requirements)
 */
export const ID_RANDOM_LENGTH_LONG = 8;

/**
 * Helper function to generate random ID suffix with specified length.
 *
 * @param length - Suffix length (use ID_RANDOM_LENGTH_SHORT/STANDARD/LONG constants)
 * @returns Random alphanumeric suffix (e.g., "a3f9z2" for length=6)
 *
 * @example
 * ```typescript
 * const shortSuffix = generateRandomSuffix(ID_RANDOM_LENGTH_SHORT); // "k7m2"
 * const standardSuffix = generateRandomSuffix(ID_RANDOM_LENGTH_STANDARD); // "a3f9z2"
 * const longSuffix = generateRandomSuffix(ID_RANDOM_LENGTH_LONG); // "x5j9k2w7"
 * ```
 */
export function generateRandomSuffix(length: number): string {
  return Math.random()
    .toString(36)
    .slice(ID_RANDOM_START, ID_RANDOM_START + length);
}
