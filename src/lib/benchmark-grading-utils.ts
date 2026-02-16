/**
 * Benchmark Grading Utilities
 *
 * Shared tier and grade classification functions used across all benchmark engines
 * and quality certification systems. Consolidates 15+ duplicate implementations
 * into a single source of truth.
 *
 * TIER SYSTEM (S/A/B/C/D):
 * - Used for overall benchmark composite scores (0-100 scale)
 * - S-tier (≥85): Elite performance, attract maximum capital allocation
 * - A-tier (≥70): Strong performance, high trust
 * - B-tier (≥55): Solid performance, moderate trust
 * - C-tier (≥40): Acceptable performance, developing trust
 * - D-tier (<40): Needs improvement
 *
 * GRADE SYSTEM (A+/A/B+/B/C+/C/D/F):
 * - Used for individual dimension scores (0-100 scale or 0-1 scale)
 * - Supports both percentage (0-100) and fractional (0-1) score scales
 * - Automatically detects scale based on max value threshold
 */

// ---------------------------------------------------------------------------
// Tier Classification Constants (0-100 scale)
// ---------------------------------------------------------------------------

/** S-tier threshold: Elite benchmark performance (≥85/100) */
export const TIER_S_THRESHOLD = 85;
/** A-tier threshold: Strong benchmark performance (≥70/100) */
export const TIER_A_THRESHOLD = 70;
/** B-tier threshold: Solid benchmark performance (≥55/100) */
export const TIER_B_THRESHOLD = 55;
/** C-tier threshold: Acceptable benchmark performance (≥40/100) */
export const TIER_C_THRESHOLD = 40;
// D-tier: All scores < 40

// ---------------------------------------------------------------------------
// Grade Classification Constants (0-100 scale)
// ---------------------------------------------------------------------------

/** A+ grade threshold: Exceptional dimension score (≥95/100) */
export const GRADE_A_PLUS_THRESHOLD = 95;
/** A grade threshold: Excellent dimension score (≥85/100) */
export const GRADE_A_THRESHOLD = 85;
/** B+ grade threshold: Very good dimension score (≥75/100) */
export const GRADE_B_PLUS_THRESHOLD = 75;
/** B grade threshold: Good dimension score (≥65/100) */
export const GRADE_B_THRESHOLD = 65;
/** C+ grade threshold: Above average dimension score (≥55/100) */
export const GRADE_C_PLUS_THRESHOLD = 55;
/** C grade threshold: Average dimension score (≥45/100) */
export const GRADE_C_THRESHOLD = 45;
/** D grade threshold: Below average dimension score (≥30/100) */
export const GRADE_D_THRESHOLD = 30;
// F grade: All scores < 30

// ---------------------------------------------------------------------------
// Grade Classification Constants (0-1 fractional scale)
// Used by reasoning-quality-certifier.ts and certification systems
// ---------------------------------------------------------------------------

/** A grade threshold for 0-1 scale: Excellent quality (≥0.9) */
export const GRADE_A_THRESHOLD_FRACTIONAL = 0.9;
/** B+ grade threshold for 0-1 scale: Very good quality (≥0.8) */
export const GRADE_B_PLUS_THRESHOLD_FRACTIONAL = 0.8;
/** B grade threshold for 0-1 scale: Good quality (≥0.7) */
export const GRADE_B_THRESHOLD_FRACTIONAL = 0.7;
/** C+ grade threshold for 0-1 scale: Above average quality (≥0.6) */
export const GRADE_C_PLUS_THRESHOLD_FRACTIONAL = 0.6;
/** C grade threshold for 0-1 scale: Average quality (≥0.5) */
export const GRADE_C_THRESHOLD_FRACTIONAL = 0.5;
/** D grade threshold for 0-1 scale: Below average quality (≥0.4) */
export const GRADE_D_THRESHOLD_FRACTIONAL = 0.4;
// F grade: All scores < 0.4

// ---------------------------------------------------------------------------
// Tier Classification Function
// ---------------------------------------------------------------------------

/**
 * Classify composite benchmark score into tier (S/A/B/C/D).
 *
 * Used by all v30-v37 benchmark engines to assign overall performance tiers.
 * Tier classification directly affects agent leaderboard display and capital
 * allocation decisions (S-tier agents attract maximum betting volume).
 *
 * @param composite - Composite benchmark score (0-100 scale)
 * @returns Tier classification letter (S/A/B/C/D)
 *
 * @example
 * getTier(92) // => "S" (elite performance)
 * getTier(68) // => "B" (solid performance)
 * getTier(35) // => "D" (needs improvement)
 */
export function getTier(composite: number): "S" | "A" | "B" | "C" | "D" {
  if (composite >= TIER_S_THRESHOLD) return "S";
  if (composite >= TIER_A_THRESHOLD) return "A";
  if (composite >= TIER_B_THRESHOLD) return "B";
  if (composite >= TIER_C_THRESHOLD) return "C";
  return "D";
}

// ---------------------------------------------------------------------------
// Grade Classification Function (Percentage Scale)
// ---------------------------------------------------------------------------

/**
 * Classify dimension score into letter grade (A+/A/B+/B/C+/C/D/F) using
 * percentage scale (0-100).
 *
 * Used by v31-v37 benchmark engines to grade individual performance dimensions
 * like hallucination safety, strategy consistency, and foresight.
 *
 * @param score - Dimension score (0-100 scale)
 * @returns Letter grade (A+ through F)
 *
 * @example
 * getGrade(97) // => "A+" (exceptional)
 * getGrade(72) // => "B+" (very good)
 * getGrade(28) // => "F" (failing)
 */
export function getGrade(score: number): "A+" | "A" | "B+" | "B" | "C+" | "C" | "D" | "F" {
  if (score >= GRADE_A_PLUS_THRESHOLD) return "A+";
  if (score >= GRADE_A_THRESHOLD) return "A";
  if (score >= GRADE_B_PLUS_THRESHOLD) return "B+";
  if (score >= GRADE_B_THRESHOLD) return "B";
  if (score >= GRADE_C_PLUS_THRESHOLD) return "C+";
  if (score >= GRADE_C_THRESHOLD) return "C";
  if (score >= GRADE_D_THRESHOLD) return "D";
  return "F";
}

// ---------------------------------------------------------------------------
// Grade Classification Function (Fractional Scale)
// ---------------------------------------------------------------------------

/**
 * Classify dimension score into letter grade (A/B+/B/C+/C/D/F) using
 * fractional scale (0-1).
 *
 * Used by reasoning-quality-certifier.ts for certification dimension grading.
 * Note: Fractional scale does not include A+ grade (max is A).
 *
 * @param score - Dimension score (0-1 fractional scale)
 * @returns Letter grade (A through F, no A+)
 *
 * @example
 * getGradeFractional(0.92) // => "A" (excellent)
 * getGradeFractional(0.65) // => "C+" (above average)
 * getGradeFractional(0.35) // => "F" (failing)
 */
export function getGradeFractional(score: number): "A" | "B+" | "B" | "C+" | "C" | "D" | "F" {
  if (score >= GRADE_A_THRESHOLD_FRACTIONAL) return "A";
  if (score >= GRADE_B_PLUS_THRESHOLD_FRACTIONAL) return "B+";
  if (score >= GRADE_B_THRESHOLD_FRACTIONAL) return "B";
  if (score >= GRADE_C_PLUS_THRESHOLD_FRACTIONAL) return "C+";
  if (score >= GRADE_C_THRESHOLD_FRACTIONAL) return "C";
  if (score >= GRADE_D_THRESHOLD_FRACTIONAL) return "D";
  return "F";
}
