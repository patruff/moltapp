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
 * Counts the number of words in a text string.
 * Splits on whitespace and filters out empty strings for accurate word counting.
 *
 * @param text - The text to count words in
 * @returns The number of words in the text
 *
 * @example
 * countWords("Hello world") // returns 2
 * countWords("Multiple   spaces   between") // returns 3
 * countWords("") // returns 0
 * countWords("  trim me  ") // returns 2
 */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

/**
 * Splits text into sentences by common punctuation marks.
 * Filters out sentences shorter than minLength after trimming.
 * Complements countWords() for reasoning analysis across benchmarks.
 *
 * @param text - The text to split into sentences
 * @param minLength - Minimum sentence length to include (default: 0 includes all)
 * @returns Array of sentences
 *
 * @example
 * splitSentences("Hello world. Short. This is a sentence!")
 *   // ["Hello world", "Short", "This is a sentence"]
 * splitSentences("Hello world. Hi. This is longer.", 3)
 *   // ["Hello world", "This is longer"] (excludes "Hi" - only 2 chars)
 * splitSentences("  Leading space. Trailing  ") // ["Leading space", "Trailing"]
 */
export function splitSentences(text: string, minLength: number = 0): string[] {
  return text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > minLength);
}

/**
 * Extracts filtered words from text, lowercased, with optional minimum length.
 * Standardizes the common pattern of `.toLowerCase().split(/\s+/).filter(w => w.length > N)`.
 *
 * @param text - The input text to extract words from
 * @param minLength - Minimum word length to include (default: 0 includes all)
 * @returns Array of lowercase words meeting the minimum length requirement
 *
 * @example
 * getFilteredWords("Hello World FOO", 3) // ["hello", "world", "foo"]
 * getFilteredWords("A big cat", 2)       // ["big", "cat"]
 * getFilteredWords("Hello World")        // ["hello", "world"]
 */
export function getFilteredWords(text: string, minLength: number = 0): string[] {
  return text.toLowerCase().split(/\s+/).filter((w) => w.length > minLength);
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

/**
 * Normalizes a value to the 0-1 range by clamping.
 * Values below 0 become 0, values above 1 become 1, values in between stay unchanged.
 * Common for score normalization, confidence levels, and percentage calculations.
 *
 * @param value - The value to normalize
 * @returns The normalized value in range [0, 1]
 *
 * @example
 * normalize(0.5) // returns 0.5
 * normalize(-0.3) // returns 0 (clamped)
 * normalize(1.8) // returns 1 (clamped)
 * normalize(0.999) // returns 0.999
 */
export function normalize(value: number): number {
  return Math.max(0, Math.min(1, value));
}
