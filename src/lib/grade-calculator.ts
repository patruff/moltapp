/**
 * Grade Calculator Utility
 *
 * Shared function for computing letter grades from numeric scores (0-1 scale).
 * Used across multiple quality analytics services to ensure consistent grading.
 */

// =============================================================================
// Grade Boundary Thresholds
//
// Defines the minimum score (0-1 scale) required for each letter grade.
// Changing a threshold here automatically updates all quality analytics
// services that call computeGrade() — no need to hunt for magic numbers.
//
// Grade scale (standard US academic 13-tier system):
//   A+ ≥ 0.95  (exceptional)
//   A  ≥ 0.90  (excellent)
//   A- ≥ 0.85  (very good)
//   B+ ≥ 0.80  (good)
//   B  ≥ 0.75  (above average)
//   B- ≥ 0.70  (slightly above average)
//   C+ ≥ 0.65  (average)
//   C  ≥ 0.60  (passing)
//   C- ≥ 0.55  (marginal pass)
//   D+ ≥ 0.50  (poor)
//   D  ≥ 0.45  (very poor)
//   D- ≥ 0.40  (barely passing)
//   F  <  0.40  (failing)
//
// Example: agent scores 0.78 → "B" (0.75 ≤ 0.78 < 0.80)
// =============================================================================

/** Minimum score for A+ grade (top 5% of scale) */
const GRADE_THRESHOLD_A_PLUS = 0.95;

/** Minimum score for A grade */
const GRADE_THRESHOLD_A = 0.90;

/** Minimum score for A- grade */
const GRADE_THRESHOLD_A_MINUS = 0.85;

/** Minimum score for B+ grade */
const GRADE_THRESHOLD_B_PLUS = 0.80;

/** Minimum score for B grade */
const GRADE_THRESHOLD_B = 0.75;

/** Minimum score for B- grade */
const GRADE_THRESHOLD_B_MINUS = 0.70;

/** Minimum score for C+ grade */
const GRADE_THRESHOLD_C_PLUS = 0.65;

/** Minimum score for C grade (passing threshold) */
const GRADE_THRESHOLD_C = 0.60;

/** Minimum score for C- grade */
const GRADE_THRESHOLD_C_MINUS = 0.55;

/** Minimum score for D+ grade */
const GRADE_THRESHOLD_D_PLUS = 0.50;

/** Minimum score for D grade */
const GRADE_THRESHOLD_D = 0.45;

/** Minimum score for D- grade (lowest passing grade) */
const GRADE_THRESHOLD_D_MINUS = 0.40;

// Scores below GRADE_THRESHOLD_D_MINUS receive an "F" (failing).

/**
 * Compute a letter grade from a numeric score (0-1).
 *
 * @param score - Numeric score from 0 to 1
 * @returns Letter grade from A+ to F
 *
 * @example
 * computeGrade(0.95) // "A+"
 * computeGrade(0.87) // "A-"
 * computeGrade(0.72) // "B-"
 * computeGrade(0.45) // "F"
 */
export function computeGrade(score: number): string {
  if (score >= GRADE_THRESHOLD_A_PLUS)  return "A+";
  if (score >= GRADE_THRESHOLD_A)       return "A";
  if (score >= GRADE_THRESHOLD_A_MINUS) return "A-";
  if (score >= GRADE_THRESHOLD_B_PLUS)  return "B+";
  if (score >= GRADE_THRESHOLD_B)       return "B";
  if (score >= GRADE_THRESHOLD_B_MINUS) return "B-";
  if (score >= GRADE_THRESHOLD_C_PLUS)  return "C+";
  if (score >= GRADE_THRESHOLD_C)       return "C";
  if (score >= GRADE_THRESHOLD_C_MINUS) return "C-";
  if (score >= GRADE_THRESHOLD_D_PLUS)  return "D+";
  if (score >= GRADE_THRESHOLD_D)       return "D";
  if (score >= GRADE_THRESHOLD_D_MINUS) return "D-";
  return "F";
}
