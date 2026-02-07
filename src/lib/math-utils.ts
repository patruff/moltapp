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
 * Rounds a number to 1 decimal place.
 * Common for coarse metrics and display values.
 *
 * @param value - The number to round
 * @returns The rounded value
 *
 * @example
 * round1(3.14159) // returns 3.1
 * round1(99.99) // returns 100.0
 */
export function round1(value: number): number {
  return roundToDecimals(value, 1);
}

/**
 * Rounds a number to 2 decimal places.
 * Common for percentages and monetary values.
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
 * Common for precise calculations and statistics.
 *
 * @param value - The number to round
 * @returns The rounded value
 *
 * @example
 * round3(3.14159) // returns 3.142
 * round3(99.9999) // returns 100.0
 */
export function round3(value: number): number {
  return roundToDecimals(value, 3);
}

/**
 * Rounds a number to 4 decimal places.
 * Common for high-precision metrics and basis points.
 *
 * @param value - The number to round
 * @returns The rounded value
 *
 * @example
 * round4(3.14159) // returns 3.1416
 * round4(0.123456) // returns 0.1235
 */
export function round4(value: number): number {
  return roundToDecimals(value, 4);
}

/**
 * Finds the maximum value in an array.
 * Returns 0 for empty arrays.
 *
 * @param values - Array of numbers
 * @returns The maximum value, or 0 if array is empty
 *
 * @example
 * max([1, 5, 3, 9, 2]) // returns 9
 * max([]) // returns 0
 * max([-5, -2, -10]) // returns -2
 */
export function max(values: readonly number[]): number {
  return values.length > 0 ? Math.max(...values) : 0;
}

/**
 * Finds the minimum value in an array.
 * Returns 0 for empty arrays.
 *
 * @param values - Array of numbers
 * @returns The minimum value, or 0 if array is empty
 *
 * @example
 * min([1, 5, 3, 9, 2]) // returns 1
 * min([]) // returns 0
 * min([-5, -2, -10]) // returns -10
 */
export function min(values: readonly number[]): number {
  return values.length > 0 ? Math.min(...values) : 0;
}

/**
 * Finds the item with the maximum value for a given property.
 *
 * @param items - Array of objects
 * @param prop - Property name to compare
 * @returns The item with the maximum property value, or undefined if array is empty
 *
 * @example
 * const trades = [{ symbol: 'AAPL', pnl: 100 }, { symbol: 'MSFT', pnl: 200 }];
 * findMax(trades, 'pnl') // returns { symbol: 'MSFT', pnl: 200 }
 */
export function findMax<T>(items: readonly T[], prop: keyof T): T | undefined {
  if (items.length === 0) return undefined;
  return items.reduce((max, item) =>
    (item[prop] as number) > (max[prop] as number) ? item : max
  );
}

/**
 * Finds the item with the minimum value for a given property.
 *
 * @param items - Array of objects
 * @param prop - Property name to compare
 * @returns The item with the minimum property value, or undefined if array is empty
 *
 * @example
 * const trades = [{ symbol: 'AAPL', pnl: 100 }, { symbol: 'MSFT', pnl: 200 }];
 * findMin(trades, 'pnl') // returns { symbol: 'AAPL', pnl: 100 }
 */
export function findMin<T>(items: readonly T[], prop: keyof T): T | undefined {
  if (items.length === 0) return undefined;
  return items.reduce((min, item) =>
    (item[prop] as number) < (min[prop] as number) ? item : min
  );
}

/**
 * Finds the item with the maximum value for a given property, using a custom comparator.
 *
 * Useful for:
 * - Comparing by absolute value
 * - Complex comparison logic (nested properties, computed values)
 * - Non-numeric comparisons (strings, dates)
 *
 * @param items - Array of objects
 * @param prop - Property name to extract
 * @param compareFn - Comparison function (a, b) => number (positive if a > b)
 * @returns The item with the maximum property value, or undefined if array is empty
 *
 * @example
 * const trades = [{ pnl: -50 }, { pnl: 30 }, { pnl: -100 }];
 *
 * // Find largest absolute P&L:
 * findMax(trades, 'pnl', (a, b) => Math.abs(a) - Math.abs(b))
 * // returns { pnl: -100 }
 *
 * // Standard max (same as findMax without comparator):
 * findMax(trades, 'pnl', (a, b) => a - b)
 * // returns { pnl: 30 }
 */
export function findMaxBy<T, K extends keyof T>(
  items: readonly T[],
  prop: K,
  compareFn: (a: T[K], b: T[K]) => number
): T | undefined {
  if (items.length === 0) return undefined;
  return items.reduce((max, item) =>
    compareFn(item[prop], max[prop]) > 0 ? item : max
  );
}

/**
 * Finds the item with the minimum value for a given property, using a custom comparator.
 *
 * Useful for:
 * - Comparing by absolute value
 * - Complex comparison logic (nested properties, computed values)
 * - Non-numeric comparisons (strings, dates)
 *
 * @param items - Array of objects
 * @param prop - Property name to extract
 * @param compareFn - Comparison function (a, b) => number (positive if a > b)
 * @returns The item with the minimum property value, or undefined if array is empty
 *
 * @example
 * const trades = [{ pnl: -50 }, { pnl: 30 }, { pnl: -100 }];
 *
 * // Find smallest absolute P&L:
 * findMinBy(trades, 'pnl', (a, b) => Math.abs(a) - Math.abs(b))
 * // returns { pnl: 30 }
 *
 * // Standard min (same as findMin without comparator):
 * findMinBy(trades, 'pnl', (a, b) => a - b)
 * // returns { pnl: -100 }
 */
export function findMinBy<T, K extends keyof T>(
  items: readonly T[],
  prop: K,
  compareFn: (a: T[K], b: T[K]) => number
): T | undefined {
  if (items.length === 0) return undefined;
  return items.reduce((min, item) =>
    compareFn(item[prop], min[prop]) < 0 ? item : min
  );
}

/**
 * Sums all values in an array.
 *
 * @param values - Array of numbers
 * @returns The sum of all values
 *
 * @example
 * sum([1, 2, 3, 4, 5]) // returns 15
 * sum([]) // returns 0
 * sum([-5, 10, -3]) // returns 2
 */
export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * Calculates the mean (average) of all values in an array.
 * Returns 0 for empty arrays.
 *
 * @param values - Array of numbers
 * @returns The mean value, or 0 if array is empty
 *
 * @example
 * mean([1, 2, 3, 4, 5]) // returns 3
 * mean([]) // returns 0
 * mean([10, 20, 30]) // returns 20
 */
export function mean(values: readonly number[]): number {
  return values.length > 0 ? sum(values) / values.length : 0;
}

/**
 * Calculates the median value of an array.
 * Returns 0 for empty arrays.
 *
 * @param values - Array of numbers
 * @returns The median value, or 0 if array is empty
 *
 * @example
 * median([1, 2, 3, 4, 5]) // returns 3
 * median([1, 2, 3, 4]) // returns 2.5
 * median([]) // returns 0
 */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Calculates a specific percentile of an array.
 * Returns 0 for empty arrays.
 *
 * @param values - Array of numbers
 * @param percentile - The percentile to calculate (0-100)
 * @returns The value at the given percentile, or 0 if array is empty
 *
 * @example
 * percentile([1, 2, 3, 4, 5], 50) // returns 3 (median)
 * percentile([1, 2, 3, 4, 5], 100) // returns 5 (max)
 * percentile([1, 2, 3, 4, 5], 0) // returns 1 (min)
 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.floor((p / 100) * (sorted.length - 1));
  return sorted[index];
}

/**
 * Calculates the standard deviation of an array.
 * Returns 0 for empty arrays or arrays with a single element.
 *
 * @param values - Array of numbers
 * @returns The standard deviation, or 0 if insufficient data
 *
 * @example
 * stdDev([1, 2, 3, 4, 5]) // returns ~1.414
 * stdDev([10, 10, 10]) // returns 0
 * stdDev([]) // returns 0
 */
export function stdDev(values: readonly number[]): number {
  if (values.length <= 1) return 0;
  const avg = mean(values);
  const squaredDiffs = values.map((value) => Math.pow(value - avg, 2));
  return Math.sqrt(mean(squaredDiffs));
}

/**
 * Sums values of a specific property across an array of objects.
 *
 * @param items - Array of objects
 * @param prop - Property name to sum
 * @returns The sum of all property values
 *
 * @example
 * const trades = [{ pnl: 100 }, { pnl: -50 }, { pnl: 200 }];
 * sumByKey(trades, 'pnl') // returns 250
 */
export function sumByKey<T>(items: readonly T[], prop: keyof T): number {
  return items.reduce((total, item) => total + (item[prop] as number), 0);
}

/**
 * Calculates the average of a specific property across an array of objects.
 * Returns 0 for empty arrays.
 *
 * @param items - Array of objects
 * @param prop - Property name to average
 * @returns The average value, or 0 if array is empty
 *
 * @example
 * const trades = [{ pnl: 100 }, { pnl: -50 }, { pnl: 200 }];
 * averageByKey(trades, 'pnl') // returns 83.33
 */
export function averageByKey<T>(items: readonly T[], prop: keyof T): number {
  return items.length > 0 ? sumByKey(items, prop) / items.length : 0;
}

/**
 * Groups items by a property and returns a record of arrays.
 *
 * @param items - Array of objects to group
 * @param keyProp - Property name OR function to extract grouping key
 * @returns Record mapping keys to arrays of items
 *
 * @example
 * const trades = [
 *   { symbol: 'AAPL', pnl: 100 },
 *   { symbol: 'MSFT', pnl: 200 },
 *   { symbol: 'AAPL', pnl: -50 }
 * ];
 * groupByKey(trades, 'symbol')
 * // returns { AAPL: [...], MSFT: [...] }
 *
 * // Using a function:
 * groupByKey(trades, (t) => t.pnl > 0 ? 'winners' : 'losers')
 * // returns { winners: [...], losers: [...] }
 */
export function groupByKey<T, K extends keyof T>(
  items: readonly T[],
  keyProp: K | ((item: T) => string)
): Record<string, T[]> {
  const groups: Record<string, T[]> = {};

  for (const item of items) {
    const key = typeof keyProp === "function" ? keyProp(item) : String(item[keyProp]);
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(item);
  }

  return groups;
}

/**
 * Groups items by a key function and aggregates values using init + aggregate functions.
 *
 * Useful for complex grouping patterns:
 * - Count occurrences: initFn = () => 0, aggregateFn = (acc) => acc + 1
 * - Sum values: initFn = () => 0, aggregateFn = (acc, item) => acc + item.value
 * - Collect unique IDs: initFn = () => new Set(), aggregateFn = (acc, item) => acc.add(item.id)
 * - Build objects: initFn = () => ({count: 0, total: 0}), aggregateFn = (acc, item) => ({count: acc.count + 1, total: acc.total + item.value})
 *
 * @param items - Array of objects to group and aggregate
 * @param keyFn - Function OR property name to extract grouping key
 * @param initFn - Function to create initial accumulator for each group
 * @param aggregateFn - Function to aggregate each item into the accumulator
 * @returns Record mapping keys to aggregated values
 *
 * @example
 * const decisions = [
 *   { symbol: 'AAPL', action: 'buy' },
 *   { symbol: 'MSFT', action: 'sell' },
 *   { symbol: 'AAPL', action: 'buy' }
 * ];
 *
 * // Count occurrences per symbol:
 * groupAndAggregate(
 *   decisions,
 *   'symbol',
 *   () => 0,
 *   (count) => count + 1
 * )
 * // returns { AAPL: 2, MSFT: 1 }
 *
 * // Collect unique actions per symbol:
 * groupAndAggregate(
 *   decisions,
 *   'symbol',
 *   () => new Set<string>(),
 *   (set, item) => set.add(item.action)
 * )
 * // returns { AAPL: Set(['buy']), MSFT: Set(['sell']) }
 *
 * // Build complex objects:
 * groupAndAggregate(
 *   decisions,
 *   'symbol',
 *   () => ({ symbols: new Set<string>(), count: 0 }),
 *   (acc, item) => {
 *     acc.symbols.add(item.symbol);
 *     acc.count++;
 *     return acc;
 *   }
 * )
 */
export function groupAndAggregate<T, K, V>(
  items: readonly T[],
  keyFn: ((item: T) => string) | keyof T,
  initFn: () => V,
  aggregateFn: (accumulator: V, item: T) => V
): Record<string, V> {
  const groups: Record<string, V> = {};

  for (const item of items) {
    const key = typeof keyFn === "function" ? keyFn(item) : String(item[keyFn]);
    if (!groups[key]) {
      groups[key] = initFn();
    }
    groups[key] = aggregateFn(groups[key], item);
  }

  return groups;
}

/**
 * Creates a lookup map (index) from an array by a unique key property.
 *
 * Common use cases:
 * - Index decisions by roundId for O(1) lookup
 * - Index positions by symbol for fast access
 * - Index users by ID for quick retrieval
 *
 * @param items - Array of objects to index
 * @param keyProp - Property name to use as the index key (must be unique)
 * @returns Record mapping keys to objects
 *
 * @example
 * const decisions = [
 *   { roundId: 'r1', action: 'buy' },
 *   { roundId: 'r2', action: 'sell' }
 * ];
 *
 * const byRound = indexBy(decisions, 'roundId');
 * // returns { r1: { roundId: 'r1', action: 'buy' }, r2: { roundId: 'r2', action: 'sell' } }
 *
 * // O(1) lookup:
 * byRound['r1'] // { roundId: 'r1', action: 'buy' }
 */
export function indexBy<T, K extends keyof T>(
  items: readonly T[],
  keyProp: K
): Record<string, T> {
  const map: Record<string, T> = {};
  for (const item of items) {
    const key = String(item[keyProp]);
    map[key] = item;
  }
  return map;
}

/**
 * Converts an array to a key-value map using specified key and value properties.
 *
 * Common use cases:
 * - Convert dimension arrays to weight maps: createKeyMap(dimensions, 'key', 'weight')
 * - Convert symbol arrays to price maps: createKeyMap(prices, 'symbol', 'price')
 * - Convert ID arrays to entity maps: createKeyMap(users, 'id', 'name')
 *
 * @param items - Array of objects to convert
 * @param keyProp - Property to use as map key
 * @param valueProp - Property to use as map value
 * @returns Record mapping keyProp values to valueProp values
 *
 * @example
 * const dimensions = [
 *   { key: 'financial', weight: 0.3 },
 *   { key: 'reasoning', weight: 0.25 }
 * ];
 *
 * createKeyMap(dimensions, 'key', 'weight')
 * // returns { financial: 0.3, reasoning: 0.25 }
 *
 * // Type-safe: return type inferred as Record<string, number>
 */
export function createKeyMap<T, K extends keyof T, V extends keyof T>(
  items: readonly T[],
  keyProp: K,
  valueProp: V
): Record<string, T[V]> {
  return items.reduce((map, item) => {
    const key = String(item[keyProp]);
    map[key] = item[valueProp];
    return map;
  }, {} as Record<string, T[V]>);
}

/**
 * Counts how many items match a condition.
 *
 * @param items - Array of items to test
 * @param predicate - Function that returns true for items to count
 * @returns Count of items matching the condition
 *
 * @example
 * const trades = [
 *   { symbol: 'AAPL', pnl: 100 },
 *   { symbol: 'MSFT', pnl: -50 },
 *   { symbol: 'GOOGL', pnl: 200 }
 * ];
 *
 * countByCondition(trades, (t) => t.pnl > 0) // returns 2
 * countByCondition(trades, (t) => t.symbol === 'AAPL') // returns 1
 */
export function countByCondition<T>(
  items: readonly T[],
  predicate: (item: T) => boolean
): number {
  return items.reduce((count, item) => (predicate(item) ? count + 1 : count), 0);
}

/**
 * Sorts a record's entries by numeric value using a custom comparison function.
 * Enables sorting by absolute value, nested properties, or complex criteria.
 *
 * Complements sortEntriesDescending():
 * - sortEntriesDescending() → simple descending sort (b - a)
 * - sortEntriesByValue() → custom comparator for complex sorting logic
 *
 * @param record - A record mapping string keys to numeric values
 * @param compareFn - Comparison function (a, b) => number (defaults to ascending: a - b)
 * @returns Array of [key, value] tuples sorted by the comparison function
 *
 * @example
 * const pnl = { AAPL: -50, MSFT: 120, GOOGL: -30 };
 *
 * // Sort by absolute value (descending):
 * sortEntriesByValue(pnl, (a, b) => Math.abs(b) - Math.abs(a))
 * // returns [["MSFT", 120], ["AAPL", -50], ["GOOGL", -30]]
 *
 * // Sort ascending (smallest first):
 * sortEntriesByValue(pnl, (a, b) => a - b)
 * // returns [["AAPL", -50], ["GOOGL", -30], ["MSFT", 120]]
 *
 * // Default ascending sort:
 * sortEntriesByValue(pnl)
 * // returns [["AAPL", -50], ["GOOGL", -30], ["MSFT", 120]]
 */
export function sortEntriesByValue(
  record: Record<string, number>,
  compareFn: (a: number, b: number) => number = (a, b) => a - b
): [string, number][] {
  return Object.entries(record).sort(([, a], [, b]) => compareFn(a, b));
}

/**
 * Sorts a record's entries by numeric value in descending order.
 * Convenience function for the common case of sorting largest-to-smallest.
 *
 * For custom sorting (e.g., by absolute value), use sortEntriesByValue() with a comparator.
 *
 * @param record - A record mapping string keys to numeric values
 * @returns Array of [key, value] tuples sorted descending by value
 *
 * @example
 * const pnl = { AAPL: 100, MSFT: 200, GOOGL: -50 };
 * sortEntriesDescending(pnl)
 * // returns [["MSFT", 200], ["AAPL", 100], ["GOOGL", -50]]
 */
export function sortEntriesDescending(record: Record<string, number>): [string, number][] {
  return sortEntriesByValue(record, (a, b) => b - a);
}

/**
 * Computes the Jaccard similarity between two strings.
 * Jaccard = |intersection| / |union| of word sets.
 * Returns 0 if both strings are empty, 1 if identical.
 *
 * @param a - First string
 * @param b - Second string
 * @returns Jaccard similarity (0 = no overlap, 1 = identical)
 *
 * @example
 * jaccardSimilarity("hello world", "hello there") // ~0.33 (1 shared word: "hello")
 * jaccardSimilarity("test", "test") // 1.0 (identical)
 * jaccardSimilarity("", "") // 0.0 (both empty)
 */
export function jaccardSimilarity(a: string, b: string): number {
  if (!a && !b) return 0;
  const setA = new Set(a.toLowerCase().split(/\s+/));
  const setB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size > 0 ? intersection.size / union.size : 0;
}

/**
 * Computes the Jaccard distance between two strings.
 * Distance = 1 - similarity.
 * Returns 0 if identical, 1 if completely different.
 *
 * @param a - First string
 * @param b - Second string
 * @returns Jaccard distance (0 = identical, 1 = no overlap)
 *
 * @example
 * jaccardDistance("hello world", "hello there") // ~0.67 (high distance)
 * jaccardDistance("test", "test") // 0.0 (identical)
 */
export function jaccardDistance(a: string, b: string): number {
  return 1 - jaccardSimilarity(a, b);
}

/**
 * Computes the dot product of two numeric vectors.
 * Returns sum of element-wise products: dot(a, b) = a[0]*b[0] + a[1]*b[1] + ...
 *
 * Common use cases:
 * - Vector similarity metrics (cosine similarity)
 * - Weighted sums
 * - Projection calculations
 *
 * @param a - First vector (readonly array of numbers)
 * @param b - Second vector (readonly array of numbers, must match length of a)
 * @returns Dot product of the two vectors
 *
 * @example
 * dotProduct([1, 2, 3], [4, 5, 6]) // returns 32 (1*4 + 2*5 + 3*6)
 * dotProduct([1, 0], [0, 1]) // returns 0 (orthogonal vectors)
 */
export function dotProduct(a: readonly number[], b: readonly number[]): number {
  return a.reduce((sum, val, i) => sum + val * b[i], 0);
}

/**
 * Computes the magnitude (Euclidean norm) of a numeric vector.
 * Returns sqrt(sum of squared components): ||v|| = sqrt(v[0]^2 + v[1]^2 + ...)
 *
 * Common use cases:
 * - Vector normalization
 * - Distance calculations
 * - Cosine similarity denominators
 *
 * @param v - Vector (readonly array of numbers)
 * @returns Magnitude of the vector
 *
 * @example
 * vectorMagnitude([3, 4]) // returns 5 (sqrt(3^2 + 4^2))
 * vectorMagnitude([1, 0, 0]) // returns 1 (unit vector)
 */
export function vectorMagnitude(v: readonly number[]): number {
  return Math.sqrt(v.reduce((sum, val) => sum + val * val, 0));
}

/**
 * Calculates the cosine similarity between two numeric vectors.
 * Returns dot(a,b) / (magnitude(a) * magnitude(b))
 * Result ranges from -1 (opposite) to 1 (identical), with 0 meaning orthogonal.
 *
 * Common use cases:
 * - Strategy genome similarity comparison
 * - Agent fingerprint matching
 * - Pattern correlation analysis
 *
 * @param a - First vector (readonly array of numbers)
 * @param b - Second vector (readonly array of numbers, must match length of a)
 * @returns Cosine similarity between the two vectors, or 0 if either vector is zero
 *
 * @example
 * cosineSimilarity([1, 0], [1, 0]) // 1.0 (identical direction)
 * cosineSimilarity([1, 0], [0, 1]) // 0.0 (orthogonal)
 * cosineSimilarity([1, 1], [-1, -1]) // -1.0 (opposite direction)
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const dot = dotProduct(a, b);
  const magA = vectorMagnitude(a);
  const magB = vectorMagnitude(b);

  // Handle zero vectors
  if (magA === 0 || magB === 0) {
    return 0;
  }

  return dot / (magA * magB);
}

/**
 * Calculates the average of a specific property for items matching a condition.
 * Eliminates duplicate filtering in filter().reduce() / filter().length patterns.
 *
 * Common use cases:
 * - Average confidence for buy decisions: averageByCondition(decisions, d => d.action === "buy", "confidence")
 * - Average P&L for winners: averageByCondition(trades, t => t.pnl > 0, "pnl")
 * - Average size for large positions: averageByCondition(positions, p => p.size > 1000, "size")
 *
 * Performance: Single-pass O(n) vs filter().reduce() + filter().length = 2× O(n)
 *
 * @param items - Array of objects to filter and average
 * @param predicate - Function that returns true for items to include
 * @param prop - Property name to average
 * @returns Average value for matching items, or 0 if no matches
 *
 * @example
 * const decisions = [
 *   { action: "buy", confidence: 80 },
 *   { action: "sell", confidence: 60 },
 *   { action: "buy", confidence: 90 }
 * ];
 *
 * // Old pattern (2× filtering):
 * // decisions.filter(d => d.action === "buy").reduce((s, d) => s + d.confidence, 0) /
 * // Math.max(1, decisions.filter(d => d.action === "buy").length)
 *
 * // New pattern (single pass):
 * averageByCondition(decisions, d => d.action === "buy", "confidence")
 * // returns 85 ((80 + 90) / 2)
 *
 * averageByCondition(decisions, d => d.action === "hold", "confidence")
 * // returns 0 (no matches)
 */
export function averageByCondition<T>(
  items: readonly T[],
  predicate: (item: T) => boolean,
  prop: keyof T
): number {
  let sum = 0;
  let count = 0;

  for (const item of items) {
    if (predicate(item)) {
      sum += item[prop] as number;
      count++;
    }
  }

  return count > 0 ? sum / count : 0;
}
