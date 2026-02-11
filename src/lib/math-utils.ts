/**
 * @fileoverview Math utilities and array helpers for the MoltApp benchmarking system.
 * Provides common array operations, statistical calculations, and data transformations.
 */

// ============================================================================
// DISPLAY LIMIT CONSTANTS
// ============================================================================

/**
 * Milliseconds per day constant (24 * 60 * 60 * 1000)
 * Used for date calculations and time-based analytics.
 */
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Top N items to display (used for "top 5" lists, best trades, strongest dimensions, etc.)
 * Common use cases:
 * - Top 5 trades by P&L
 * - Top 5 agents by performance
 * - Top 5 most convicted symbols
 * - Top 5 reasoning quality dimensions
 */
export const TOP_N_ITEMS_LIMIT = 5;

/**
 * Top few items (used for "top 3" summaries, key factors, main strengths/weaknesses)
 * Common use cases:
 * - Top 3 strengths in agent analysis
 * - Top 3 weaknesses to address
 * - Top 3 sectors by allocation
 * - Top 3 most disagreed symbols
 */
export const TOP_FEW_ITEMS_LIMIT = 3;

/**
 * Recent items limit (used for "recent activity" lists, history displays, feed items)
 * Common use cases:
 * - Recent 10 trades in portfolio
 * - Recent 10 rounds for analysis
 * - Recent 10 news items
 * - Recent 10 market events
 */
export const RECENT_ITEMS_LIMIT = 10;

/**
 * Default query/API response limit (used for paginated data, search results, logs)
 * Common use cases:
 * - Default page size for trade history
 * - Recent validation records
 * - Alert buffer display
 * - Leaderboard entries per page
 */
export const DEFAULT_QUERY_LIMIT = 20;

/**
 * Extended query limit for larger datasets (used for full history views, comprehensive analysis)
 * Common use cases:
 * - Full battle history
 * - Complete trade records for backtest
 * - Comprehensive event logs
 * - Extended leaderboard (top 100)
 */
export const EXTENDED_QUERY_LIMIT = 50;

/**
 * Maximum query limit for very large datasets (used for complete leaderboards, full catalogs)
 * Common use cases:
 * - Full leaderboard (all agents)
 * - Complete agent catalog
 * - All available markets
 */
export const MAX_QUERY_LIMIT = 100;

// ============================================================================
// STATISTICAL FUNCTIONS
// ============================================================================

/**
 * Calculates the mean (average) of an array of numbers.
 * Returns 0 for empty arrays.
 *
 * @param values - Array of numbers to average
 * @returns The mean value, or 0 if empty
 *
 * @example
 * mean([1, 2, 3, 4, 5]) // returns 3
 * mean([]) // returns 0
 */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

/**
 * Calculates the standard deviation of an array of numbers.
 * Returns 0 for arrays with < 2 elements.
 *
 * @param values - Array of numbers
 * @returns The standard deviation, or 0 if insufficient data
 *
 * @example
 * stddev([1, 2, 3, 4, 5]) // returns ~1.414
 * stddev([5]) // returns 0
 */
export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const squareDiffs = values.map((v) => Math.pow(v - avg, 2));
  const variance = mean(squareDiffs);
  return Math.sqrt(variance);
}

/**
 * Alias for stddev() - calculates the standard deviation of an array of numbers.
 * Returns 0 for arrays with < 2 elements.
 *
 * @param values - Array of numbers
 * @returns The standard deviation, or 0 if insufficient data
 *
 * @example
 * stdDev([1, 2, 3, 4, 5]) // returns ~1.414
 * stdDev([5]) // returns 0
 */
export function stdDev(values: number[]): number {
  return stddev(values);
}

/**
 * Calculates the nth percentile of an array of numbers.
 * Uses linear interpolation between closest ranks.
 *
 * @param values - Array of numbers (will be sorted)
 * @param p - Percentile to calculate (0-1, where 0.5 = median)
 * @returns The percentile value, or 0 if empty array
 *
 * @example
 * percentile([1, 2, 3, 4, 5], 0.5) // returns 3 (median)
 * percentile([1, 2, 3, 4, 5], 0.95) // returns 4.8 (95th percentile)
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = p * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index % 1;
  if (lower === upper) return sorted[lower];
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/**
 * Calculates the median (50th percentile) of an array of numbers.
 *
 * @param values - Array of numbers
 * @returns The median value, or 0 if empty array
 *
 * @example
 * median([1, 2, 3, 4, 5]) // returns 3
 * median([1, 2, 3, 4]) // returns 2.5
 */
export function median(values: number[]): number {
  return percentile(values, 0.5);
}

/**
 * Calculates the Jaccard similarity between two sets of strings.
 * Returns a value between 0 (no overlap) and 1 (identical sets).
 *
 * @param a - First set of strings
 * @param b - Second set of strings
 * @returns Jaccard similarity coefficient (0-1)
 *
 * @example
 * jaccardSimilarity(['a', 'b', 'c'], ['b', 'c', 'd']) // returns 0.5 (2/4)
 * jaccardSimilarity(['a', 'b'], ['a', 'b']) // returns 1.0
 */
export function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

/**
 * Normalizes an array of numbers to a 0-1 scale using min-max normalization.
 * Returns array of zeros if all values are equal.
 *
 * @param values - Array of numbers to normalize
 * @returns Array of normalized values (0-1)
 *
 * @example
 * normalize([1, 2, 3, 4, 5]) // returns [0, 0.25, 0.5, 0.75, 1]
 * normalize([5, 5, 5]) // returns [0, 0, 0]
 */
export function normalize(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return values.map(() => 0);
  return values.map((v) => (v - min) / (max - min));
}

/**
 * Clamps a value between a minimum and maximum.
 *
 * @param value - Value to clamp
 * @param min - Minimum allowed value
 * @param max - Maximum allowed value
 * @returns Clamped value
 *
 * @example
 * clamp(5, 0, 10) // returns 5
 * clamp(-5, 0, 10) // returns 0
 * clamp(15, 0, 10) // returns 10
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Rounds a number to a specified number of decimal places.
 *
 * @param value - Number to round
 * @param decimals - Number of decimal places
 * @returns Rounded number
 *
 * @example
 * round(3.14159, 2) // returns 3.14
 * round(2.5, 0) // returns 3
 */
export function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * Rounds a number to 1 decimal place.
 * Convenience wrapper around round(value, 1).
 *
 * @param value - Number to round
 * @returns Number rounded to 1 decimal place
 *
 * @example
 * round1(3.14159) // returns 3.1
 * round1(2.56) // returns 2.6
 */
export function round1(value: number): number {
  return round(value, 1);
}

/**
 * Rounds a number to 2 decimal places.
 * Convenience wrapper around round(value, 2).
 *
 * @param value - Number to round
 * @returns Number rounded to 2 decimal places
 *
 * @example
 * round2(3.14159) // returns 3.14
 * round2(2.567) // returns 2.57
 */
export function round2(value: number): number {
  return round(value, 2);
}

/**
 * Rounds a number to 3 decimal places.
 * Convenience wrapper around round(value, 3).
 *
 * @param value - Number to round
 * @returns Number rounded to 3 decimal places
 *
 * @example
 * round3(3.14159) // returns 3.142
 * round3(2.5678) // returns 2.568
 */
export function round3(value: number): number {
  return round(value, 3);
}

/**
 * Rounds a number to 4 decimal places.
 * Convenience wrapper around round(value, 4).
 *
 * @param value - Number to round
 * @returns Number rounded to 4 decimal places
 *
 * @example
 * round4(3.14159265) // returns 3.1416
 * round4(2.56789) // returns 2.5679
 */
export function round4(value: number): number {
  return round(value, 4);
}

/**
 * Counts the number of words in a text string.
 * Words are defined as sequences of non-whitespace characters separated by whitespace.
 *
 * @param text - Text string to count words in
 * @returns Number of words
 *
 * @example
 * countWords("Hello world") // returns 2
 * countWords("  one  two  three  ") // returns 3
 * countWords("") // returns 0
 */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(word => word.length > 0).length;
}

/**
 * Splits text into sentences based on common sentence-ending punctuation.
 * Splits on periods, exclamation marks, and question marks followed by whitespace or end of string.
 *
 * @param text - Text string to split into sentences
 * @param minLength - Optional minimum sentence length in characters (default: 0, filters sentences shorter than this)
 * @returns Array of sentences
 *
 * @example
 * splitSentences("Hello. How are you?") // returns ["Hello", "How are you"]
 * splitSentences("One! Two? Three.") // returns ["One", "Two", "Three"]
 * splitSentences("No punctuation") // returns ["No punctuation"]
 * splitSentences("Hi. A. Test.", 3) // returns ["Test"] (filters "Hi" and "A")
 */
export function splitSentences(text: string, minLength: number = 0): string[] {
  return text
    .split(/[.!?]+\s+|[.!?]+$/)
    .map(s => s.trim())
    .filter(s => s.length >= minLength);
}

/**
 * Generates a random integer between min (inclusive) and max (inclusive).
 *
 * @param min - Minimum value (inclusive)
 * @param max - Maximum value (inclusive)
 * @returns Random integer
 *
 * @example
 * randomInt(1, 6) // returns random number 1-6 (dice roll)
 * randomInt(0, 1) // returns 0 or 1 (coin flip)
 */
export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generates a deterministic hash from a string (for seeding random number generators).
 * Uses simple Java-style hashCode algorithm.
 *
 * @param str - String to hash
 * @returns Integer hash value
 *
 * @example
 * hashSeed('TSLAx') // returns consistent integer for same input
 * hashSeed('TSLAx') === hashSeed('TSLAx') // always true
 */
export function hashSeed(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

// ============================================================================
// ARRAY SEARCH & FILTER HELPERS
// ============================================================================

/**
 * Finds the item with the maximum value for a given property.
 * Accepts custom comparator function for complex comparisons.
 *
 * @param items - Array of objects to search
 * @param keyOrComparator - Property name (string/number) OR custom comparator function
 * @returns Item with maximum value, or undefined if array is empty
 *
 * @example
 * // Simple property comparison
 * findMax([{score: 5}, {score: 10}, {score: 3}], 'score') // returns {score: 10}
 *
 * // Custom comparator
 * findMax(trades, (t) => Math.abs(t.pnl)) // finds trade with largest absolute P&L
 */
export function findMax<T>(
  items: readonly T[],
  keyOrComparator: keyof T | ((item: T) => number),
): T | undefined {
  if (items.length === 0) return undefined;

  if (typeof keyOrComparator === 'function') {
    // Custom comparator
    return items.reduce((max, item) =>
      keyOrComparator(item) > keyOrComparator(max) ? item : max,
    );
  } else {
    // Simple property comparison
    return items.reduce((max, item) => (item[keyOrComparator] > max[keyOrComparator] ? item : max));
  }
}

/**
 * Finds the item with the minimum value for a given property.
 * Accepts custom comparator function for complex comparisons.
 *
 * @param items - Array of objects to search
 * @param keyOrComparator - Property name (string/number) OR custom comparator function
 * @returns Item with minimum value, or undefined if array is empty
 *
 * @example
 * // Simple property comparison
 * findMin([{score: 5}, {score: 10}, {score: 3}], 'score') // returns {score: 3}
 *
 * // Custom comparator
 * findMin(trades, (t) => Math.abs(t.pnl)) // finds trade with smallest absolute P&L
 */
export function findMin<T>(
  items: readonly T[],
  keyOrComparator: keyof T | ((item: T) => number),
): T | undefined {
  if (items.length === 0) return undefined;

  if (typeof keyOrComparator === 'function') {
    // Custom comparator
    return items.reduce((min, item) =>
      keyOrComparator(item) < keyOrComparator(min) ? item : min,
    );
  } else {
    // Simple property comparison
    return items.reduce((min, item) => (item[keyOrComparator] < min[keyOrComparator] ? item : min));
  }
}

/**
 * Counts the number of items in an array that satisfy a condition.
 * More efficient than filter().length since it doesn't create intermediate array.
 *
 * @param items - Array to count from
 * @param condition - Predicate function to test each item
 * @returns Count of items satisfying condition
 *
 * @example
 * countByCondition(trades, (t) => t.action === "buy") // count buy trades
 * countByCondition(agents, (a) => a.status === "active") // count active agents
 */
export function countByCondition<T>(items: readonly T[], condition: (item: T) => boolean): number {
  let count = 0;
  for (const item of items) {
    if (condition(item)) count++;
  }
  return count;
}

// ============================================================================
// ARRAY AGGREGATION HELPERS
// ============================================================================

/**
 * Sums a numeric property across all items in an array.
 * More efficient and readable than manual reduce for simple sums.
 *
 * @param items - Array of objects
 * @param key - Property name to sum
 * @returns Sum of all values, or 0 if empty
 *
 * @example
 * sumByKey([{val: 1}, {val: 2}, {val: 3}], 'val') // returns 6
 * sumByKey(trades, 'pnl') // total P&L across all trades
 */
export function sumByKey<T>(items: readonly T[], key: keyof T): number {
  return items.reduce((sum, item) => {
    const value = item[key];
    return sum + (typeof value === 'number' ? value : 0);
  }, 0);
}

/**
 * Calculates the average of a numeric property across all items.
 * Returns 0 for empty arrays.
 *
 * @param items - Array of objects
 * @param key - Property name to average
 * @returns Average value, or 0 if empty
 *
 * @example
 * averageByKey([{val: 1}, {val: 2}, {val: 3}], 'val') // returns 2
 * averageByKey(trades, 'confidence') // average confidence across trades
 */
export function averageByKey<T>(items: readonly T[], key: keyof T): number {
  if (items.length === 0) return 0;
  return sumByKey(items, key) / items.length;
}

/**
 * Alias for mean() - calculates the average of an array of numbers.
 * Returns 0 for empty arrays.
 *
 * @param values - Array of numbers to average
 * @returns The average value, or 0 if empty
 *
 * @example
 * calculateAverage([1, 2, 3, 4, 5]) // returns 3
 */
export function calculateAverage(values: number[]): number {
  return mean(values);
}

/**
 * Calculates a weighted sum of values using their corresponding weights.
 * Supports both object-based (Record<string, number>) and array-based (number[]) inputs.
 *
 * @param values - Object mapping keys to numeric values OR array of numeric values
 * @param weights - Object mapping keys to weights OR array of numeric weights (must match values length)
 * @returns Weighted sum
 *
 * @example
 * // Object-based usage
 * weightedSum({a: 10, b: 20}, {a: 0.3, b: 0.7}) // returns 10*0.3 + 20*0.7 = 17
 *
 * // Array-based usage
 * weightedSum([10, 20, 30], [0.5, 0.3, 0.2]) // returns 10*0.5 + 20*0.3 + 30*0.2 = 17
 */
export function weightedSum(
  values: Record<string, number> | number[],
  weights: Record<string, number> | number[],
): number {
  if (Array.isArray(values) && Array.isArray(weights)) {
    return values.reduce((sum, val, idx) => sum + val * (weights[idx] ?? 0), 0);
  }
  // Object-based calculation
  return Object.keys(values as Record<string, number>).reduce((sum, key) => {
    return sum + ((values as Record<string, number>)[key] ?? 0) * ((weights as Record<string, number>)[key] ?? 0);
  }, 0);
}

// ============================================================================
// ARRAY GROUPING & TRANSFORMATION HELPERS
// ============================================================================

/**
 * Groups an array of objects by a key property.
 * Returns a Record mapping each unique key value to array of items with that key.
 *
 * @param items - Array of objects to group
 * @param key - Property name to group by
 * @returns Record mapping key values to arrays of items
 *
 * @example
 * groupByKey([{cat: 'A', val: 1}, {cat: 'B', val: 2}, {cat: 'A', val: 3}], 'cat')
 * // returns {A: [{cat: 'A', val: 1}, {cat: 'A', val: 3}], B: [{cat: 'B', val: 2}]}
 */
export function groupByKey<T, K extends keyof T>(
  items: readonly T[],
  key: K,
): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of items) {
    const keyValue = String(item[key]);
    if (!result[keyValue]) result[keyValue] = [];
    result[keyValue].push(item);
  }
  return result;
}

/**
 * Groups and aggregates an array using custom key extraction and aggregation functions.
 * More flexible than groupByKey() for complex grouping scenarios.
 *
 * @param items - Array of items to group and aggregate
 * @param keyFn - Function to extract group key from each item, OR simple property name
 * @param initFn - Function to create initial accumulator value for each group
 * @param aggregateFn - Function to aggregate item into accumulator
 * @returns Record mapping keys to aggregated values
 *
 * @example
 * // Count occurrences by category
 * groupAndAggregate(items, 'category', () => 0, (acc) => acc + 1)
 *
 * // Sum values by category
 * groupAndAggregate(items, (i) => i.category, () => 0, (acc, item) => acc + item.value)
 *
 * // Collect unique IDs per group
 * groupAndAggregate(items, 'category', () => new Set(), (acc, item) => { acc.add(item.id); return acc; })
 */
export function groupAndAggregate<T, K, V>(
  items: readonly T[],
  keyFn: ((item: T) => K) | keyof T,
  initFn: () => V,
  aggregateFn: (accumulator: V, item: T) => V,
): Record<string, V> {
  const result: Record<string, V> = {};

  // Handle both function and property name
  const getKey = typeof keyFn === 'function'
    ? keyFn
    : (item: T) => item[keyFn as keyof T];

  for (const item of items) {
    const key = String(getKey(item));
    if (!(key in result)) {
      result[key] = initFn();
    }
    result[key] = aggregateFn(result[key], item);
  }

  return result;
}

/**
 * Creates a Record mapping key property values to their objects.
 * Useful for creating lookup maps from arrays.
 *
 * @param items - Array of objects to index
 * @param key - Property name to use as map key
 * @returns Record mapping key values to objects
 *
 * @example
 * indexBy([{id: 'a', val: 1}, {id: 'b', val: 2}], 'id')
 * // returns {a: {id: 'a', val: 1}, b: {id: 'b', val: 2}}
 */
export function indexBy<T, K extends keyof T>(
  items: readonly T[],
  keyProp: K,
): Record<string, T> {
  const result: Record<string, T> = {};
  for (const item of items) {
    const key = String(item[keyProp]);
    result[key] = item;
  }
  return result;
}

/**
 * Creates a Record mapping key values to property values.
 * Useful for extracting dimension weights, symbol prices, etc.
 *
 * @param items - Array of objects
 * @param keyProp - Property to use as map key
 * @param valueProp - Property to use as map value
 * @returns Record mapping keyProp values to valueProp values
 *
 * @example
 * createKeyMap([{dim: 'coherence', weight: 0.3}, {dim: 'depth', weight: 0.2}], 'dim', 'weight')
 * // returns {coherence: 0.3, depth: 0.2}
 */
export function createKeyMap<T, K extends keyof T, V extends keyof T>(
  items: readonly T[],
  keyProp: K,
  valueProp: V,
): Record<string, T[V]> {
  const result: Record<string, T[V]> = {};
  for (const item of items) {
    const key = String(item[keyProp]);
    result[key] = item[valueProp];
  }
  return result;
}

/**
 * Filters an array of objects by checking if a lookup map contains their key property.
 * Useful for filtering catalogs/arrays where availability is defined by a separate map.
 *
 * Common use cases:
 * - Filter stocks where pricing data exists: filterByMapKey(XSTOCKS_CATALOG, BASE_RETURNS, 'symbol')
 * - Filter agents where performance data exists
 * - Filter symbols with available volatility estimates
 *
 * @param items - Array of objects to filter
 * @param lookupMap - Map/Record to check for key existence
 * @param keyProp - Property name to extract from items for lookup
 * @returns Array of key values that exist in the lookupMap
 *
 * @example
 * const stocks = [{symbol: 'AAPL'}, {symbol: 'TSLA'}, {symbol: 'GME'}];
 * const prices = {AAPL: 150, TSLA: 200};
 * filterByMapKey(stocks, prices, 'symbol') // returns ['AAPL', 'TSLA']
 */
export function filterByMapKey<T, K extends keyof T>(
  items: readonly T[],
  lookupMap: Record<string, unknown>,
  keyProp: K,
): Array<T[K]> {
  return items
    .map((item) => item[keyProp])
    .filter((key) => lookupMap[String(key)] !== undefined);
}

/**
 * Deduplicates an array of objects based on a key property.
 * Keeps the first occurrence of each unique key value.
 *
 * @param items - Array of objects to deduplicate
 * @param key - Property name to use for uniqueness check
 * @returns Array with duplicates removed
 *
 * @example
 * dedupeByKey([{id: 1}, {id: 2}, {id: 1}], 'id') // returns [{id: 1}, {id: 2}]
 */
export function dedupeByKey<T, K extends keyof T>(items: readonly T[], key: K): T[] {
  const seen = new Set<unknown>();
  const result: T[] = [];
  for (const item of items) {
    const keyValue = item[key];
    if (!seen.has(keyValue)) {
      seen.add(keyValue);
      result.push(item);
    }
  }
  return result;
}

/**
 * Partitions an array into two arrays based on a predicate function.
 * Returns [matches, nonMatches].
 *
 * @param items - Array to partition
 * @param predicate - Function to test each item
 * @returns Tuple of [matching items, non-matching items]
 *
 * @example
 * partition([1, 2, 3, 4], (n) => n % 2 === 0) // returns [[2, 4], [1, 3]]
 */
export function partition<T>(
  items: readonly T[],
  predicate: (item: T) => boolean,
): [T[], T[]] {
  const matches: T[] = [];
  const nonMatches: T[] = [];
  for (const item of items) {
    if (predicate(item)) {
      matches.push(item);
    } else {
      nonMatches.push(item);
    }
  }
  return [matches, nonMatches];
}

/**
 * Chunks an array into smaller arrays of specified size.
 *
 * @param items - Array to chunk
 * @param size - Size of each chunk
 * @returns Array of chunks
 *
 * @example
 * chunk([1, 2, 3, 4, 5], 2) // returns [[1, 2], [3, 4], [5]]
 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

/**
 * Flattens an array of arrays by one level.
 *
 * @param items - Array of arrays to flatten
 * @returns Flattened array
 *
 * @example
 * flatten([[1, 2], [3, 4], [5]]) // returns [1, 2, 3, 4, 5]
 */
export function flatten<T>(items: readonly T[][]): T[] {
  return items.reduce((acc, arr) => [...acc, ...arr], []);
}

/**
 * Creates an array of unique values from multiple arrays.
 *
 * @param arrays - Arrays to union
 * @returns Array of unique values
 *
 * @example
 * union([1, 2], [2, 3], [3, 4]) // returns [1, 2, 3, 4]
 */
export function union<T>(...arrays: readonly T[][]): T[] {
  return [...new Set(flatten(arrays))];
}

/**
 * Creates an array of values present in all input arrays.
 *
 * @param arrays - Arrays to intersect
 * @returns Array of common values
 *
 * @example
 * intersection([1, 2, 3], [2, 3, 4], [2, 3, 5]) // returns [2, 3]
 */
export function intersection<T>(...arrays: readonly T[][]): T[] {
  if (arrays.length === 0) return [];
  const [first, ...rest] = arrays;
  return first.filter((item) => rest.every((arr) => arr.includes(item)));
}

/**
 * Creates an array of values from the first array not present in other arrays.
 *
 * @param array - Array to diff from
 * @param others - Arrays to exclude
 * @returns Array of unique values from first array
 *
 * @example
 * difference([1, 2, 3], [2], [3]) // returns [1]
 */
export function difference<T>(array: readonly T[], ...others: readonly T[][]): T[] {
  const othersSet = new Set(flatten(others));
  return array.filter((item) => !othersSet.has(item));
}

// ============================================================================
// ARRAY SORTING HELPERS
// ============================================================================

/**
 * Sorts an array of objects by a property in descending order.
 * Returns a new array (does not mutate input).
 *
 * @param items - Array of objects to sort
 * @param prop - Property name to sort by (must be numeric)
 * @returns New array sorted in descending order by the property
 *
 * @example
 * sortByDescending([{val: 1}, {val: 3}, {val: 2}], 'val') // returns [{val: 3}, {val: 2}, {val: 1}]
 * sortByDescending(trades, 'pnl') // sorts trades by P&L, highest first
 */
export function sortByDescending<T>(items: readonly T[], prop: keyof T): T[] {
  return [...items].sort((a, b) => {
    const aVal = a[prop];
    const bVal = b[prop];
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return bVal - aVal;
    }
    return 0;
  });
}

/**
 * Sorts an array of objects by a property in ascending order.
 * Returns a new array (does not mutate input).
 *
 * @param items - Array of objects to sort
 * @param prop - Property name to sort by (must be numeric)
 * @returns New array sorted in ascending order by the property
 *
 * @example
 * sortByAscending([{val: 3}, {val: 1}, {val: 5}], 'val') // returns [{val: 1}, {val: 3}, {val: 5}]
 * sortByAscending(trades, 'date') // sorts trades by date, earliest first
 */
export function sortByAscending<T>(items: readonly T[], prop: keyof T): T[] {
  return [...items].sort((a, b) => {
    const aVal = a[prop];
    const bVal = b[prop];
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return aVal - bVal;
    }
    return 0;
  });
}

/**
 * Sorts the entries of a Record by their numeric values in descending order.
 * Returns an array of [key, value] tuples sorted by value (highest first).
 *
 * @param record - Record mapping string keys to numeric values
 * @returns Array of [key, value] tuples sorted by value descending
 *
 * @example
 * sortEntriesDescending({a: 10, b: 30, c: 20}) // returns [['b', 30], ['c', 20], ['a', 10]]
 * sortEntriesDescending({coherence: 0.9, depth: 0.7}) // returns [['coherence', 0.9], ['depth', 0.7]]
 */
export function sortEntriesDescending(record: Record<string, number>): Array<[string, number]> {
  return Object.entries(record).sort((a, b) => b[1] - a[1]);
}

/**
 * Gets the key with the highest numeric value from a Record.
 * Returns undefined if the record is empty.
 *
 * @param record - Record mapping string keys to numeric values
 * @returns Key with highest value, or undefined if empty
 *
 * @example
 * getTopKey({a: 10, b: 30, c: 20}) // returns 'b'
 * getTopKey({buy: 5, sell: 3, hold: 8}) // returns 'hold'
 * getTopKey({}) // returns undefined
 */
export function getTopKey(record: Record<string, number>): string | undefined {
  const entries = Object.entries(record);
  if (entries.length === 0) return undefined;

  let maxKey = entries[0][0];
  let maxValue = entries[0][1];

  for (const [key, value] of entries) {
    if (value > maxValue) {
      maxKey = key;
      maxValue = value;
    }
  }

  return maxKey;
}

// ============================================================================
// ALIASES FOR BACKWARD COMPATIBILITY
// ============================================================================

/**
 * Alias for findMax() - finds the item with the maximum value for a given property.
 */
export const findMaxBy = findMax;

/**
 * Alias for findMin() - finds the item with the minimum value for a given property.
 */
export const findMinBy = findMin;

/**
 * Alias for sortByDescending() - sorts array by property in descending order.
 */
export function sortDescending<T>(items: readonly T[], prop: keyof T): T[] {
  return sortByDescending(items, prop);
}

/**
 * Alias for countByCondition() - counts items matching a condition.
 */
export function countWhere<T>(items: readonly T[], condition: (item: T) => boolean): number {
  return countByCondition(items, condition);
}

/**
 * Calculates average of items matching a condition.
 *
 * @param items - Array of objects
 * @param key - Property name to average
 * @param condition - Predicate function to filter items
 * @returns Average value of matching items, or 0 if none match
 *
 * @example
 * averageByCondition([{val: 1, type: 'A'}, {val: 2, type: 'B'}, {val: 3, type: 'A'}], 'val', (item) => item.type === 'A') // returns 2
 */
export function averageByCondition<T>(
  items: readonly T[],
  key: keyof T,
  condition: (item: T) => boolean,
): number {
  const filtered = items.filter(condition);
  return averageByKey(filtered, key);
}

/**
 * Calculates cosine similarity between two numeric arrays.
 * Returns a value between -1 (opposite) and 1 (identical).
 *
 * @param a - First array of numbers
 * @param b - Second array of numbers
 * @returns Cosine similarity (-1 to 1)
 *
 * @example
 * cosineSimilarity([1, 2, 3], [1, 2, 3]) // returns 1.0 (identical)
 * cosineSimilarity([1, 0, 0], [0, 1, 0]) // returns 0.0 (orthogonal)
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

/**
 * Filters common stop words from text and returns filtered words.
 * Used for text analysis and keyword extraction.
 *
 * @param text - Text string to filter
 * @param minLength - Optional minimum word length (default 0, no filtering)
 * @returns Array of filtered words (stop words removed)
 *
 * @example
 * getFilteredWords("The quick brown fox jumps") // returns ["quick", "brown", "fox", "jumps"]
 * getFilteredWords("The quick brown fox jumps", 5) // returns ["quick", "brown", "jumps"]
 */
export function getFilteredWords(text: string, minLength: number = 0): string[] {
  const stopWords = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
    'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
    'to', 'was', 'will', 'with'
  ]);

  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(word => word.length >= minLength && !stopWords.has(word));
}
