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
