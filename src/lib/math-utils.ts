/**
 * Mathematical utility functions for common operations.
 */

/**
 * Clamps a value between a minimum and maximum bound.
 *
 * @param value - The value to clamp
 * @param min - The minimum bound (inclusive)
 * @param max - The maximum bound (inclusive)
 * @returns The clamped value
 *
 * @example
 * clamp(150, 1, 100) // returns 100
 * clamp(-5, 1, 100)  // returns 1
 * clamp(50, 1, 100)  // returns 50
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Rounds a number to a specified number of decimal places.
 *
 * @param value - The number to round
 * @param decimals - The number of decimal places (0-10)
 * @returns The rounded value
 *
 * @example
 * roundToDecimals(3.14159, 2) // returns 3.14
 * roundToDecimals(123.456789, 4) // returns 123.4568
 * roundToDecimals(0.999, 2) // returns 1.0
 */
export function roundToDecimals(value: number, decimals: number): number {
  const multiplier = Math.pow(10, decimals);
  return Math.round(value * multiplier) / multiplier;
}

/**
 * Rounds a number to 2 decimal places.
 * Common for currency, percentages, and ratios.
 *
 * @param value - The number to round
 * @returns The rounded value
 *
 * @example
 * round2(3.14159) // returns 3.14
 * round2(99.999) // returns 100.0
 */
export function round2(value: number): number {
  return roundToDecimals(value, 2);
}

/**
 * Rounds a number to 3 decimal places.
 * Common for financial metrics and precise calculations.
 *
 * @param value - The number to round
 * @returns The rounded value
 *
 * @example
 * round3(3.14159) // returns 3.142
 * round3(0.999999) // returns 1.0
 */
export function round3(value: number): number {
  return roundToDecimals(value, 3);
}

/**
 * Rounds a number to 4 decimal places.
 * Common for high-precision financial calculations and costs.
 *
 * @param value - The number to round
 * @returns The rounded value
 *
 * @example
 * round4(3.14159265) // returns 3.1416
 * round4(0.12345) // returns 0.1235
 */
export function round4(value: number): number {
  return roundToDecimals(value, 4);
}

/**
 * Calculates the average of a numeric property across an array of objects.
 * Returns 0 for empty arrays (safe division-by-zero handling).
 *
 * @param items - Array of objects containing the numeric property
 * @param key - The property name to average
 * @returns The average value, or 0 if array is empty
 *
 * @example
 * calculateAverage([{confidence: 75}, {confidence: 80}], 'confidence') // returns 77.5
 * calculateAverage([], 'confidence') // returns 0
 * calculateAverage([{score: 100}], 'score') // returns 100
 */
export function calculateAverage<T extends Record<string, any>>(
  items: T[],
  key: keyof T & string,
): number {
  return items.length > 0
    ? items.reduce((sum, item) => sum + (item[key] as number), 0) / items.length
    : 0;
}
