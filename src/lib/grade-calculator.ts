/**
 * Grade Calculator Utility
 *
 * Shared function for computing letter grades from numeric scores (0-1 scale).
 * Used across multiple quality analytics services to ensure consistent grading.
 */

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
  if (score >= 0.95) return "A+";
  if (score >= 0.90) return "A";
  if (score >= 0.85) return "A-";
  if (score >= 0.80) return "B+";
  if (score >= 0.75) return "B";
  if (score >= 0.70) return "B-";
  if (score >= 0.65) return "C+";
  if (score >= 0.60) return "C";
  if (score >= 0.55) return "C-";
  if (score >= 0.50) return "D";
  return "F";
}
