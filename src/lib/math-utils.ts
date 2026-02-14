// Logger removed - not needed for math utilities

/**
 * findMax - Find the item with the maximum value for a given property.
 *
 * @param items - Array of items to search
 * @param key - Property name to compare (must be numeric)
 * @param compareFn - Optional custom comparison function (default: (a,b) => a - b)
 * @returns Item with maximum value, or undefined if array is empty
 *
 * @example
 * // Find stock with highest price
 * const maxPriceStock = findMax(stocks, 'price')
 *
 * // Find absolute maximum value (custom comparator)
 * const maxAbsValue = findMax(values, 'amount', (a, b) => Math.abs(a) - Math.abs(b))
 */
export function findMax<T>(
  items: readonly T[],
  key: keyof T,
  compareFn?: (a: number, b: number) => number,
): T | undefined {
  if (items.length === 0) return undefined;

  const compare = compareFn || ((a: number, b: number) => a - b);
  let maxItem = items[0];
  let maxValue = Number(maxItem[key]);

  for (let i = 1; i < items.length; i++) {
    const currentValue = Number(items[i][key]);
    if (compare(currentValue, maxValue) > 0) {
      maxValue = currentValue;
      maxItem = items[i];
    }
  }

  return maxItem;
}

/**
 * findMin - Find the item with the minimum value for a given property.
 *
 * @param items - Array of items to search
 * @param key - Property name to compare (must be numeric)
 * @param compareFn - Optional custom comparison function (default: (a,b) => a - b)
 * @returns Item with minimum value, or undefined if array is empty
 *
 * @example
 * // Find stock with lowest price
 * const minPriceStock = findMin(stocks, 'price')
 *
 * // Find absolute minimum value (custom comparator)
 * const minAbsValue = findMin(values, 'amount', (a, b) => Math.abs(a) - Math.abs(b))
 */
export function findMin<T>(
  items: readonly T[],
  key: keyof T,
  compareFn?: (a: number, b: number) => number,
): T | undefined {
  if (items.length === 0) return undefined;

  const compare = compareFn || ((a: number, b: number) => a - b);
  let minItem = items[0];
  let minValue = Number(minItem[key]);

  for (let i = 1; i < items.length; i++) {
    const currentValue = Number(items[i][key]);
    if (compare(currentValue, minValue) < 0) {
      minValue = currentValue;
      minItem = items[i];
    }
  }

  return minItem;
}

/**
 * sumByKey - Calculate the sum of a numeric property across an array of objects.
 *
 * @param items - Array of items to sum
 * @param key - Property name to sum (must be numeric)
 * @returns Sum of all values for the specified property
 *
 * @example
 * const totalValue = sumByKey(holdings, 'value')
 * const totalShares = sumByKey(positions, 'quantity')
 */
export function sumByKey<T>(items: readonly T[], key: keyof T): number {
  return items.reduce((sum, item) => sum + Number(item[key]), 0);
}

/**
 * averageByKey - Calculate the average of a numeric property across an array of objects.
 *
 * @param items - Array of items to average
 * @param key - Property name to average (must be numeric)
 * @returns Average value, or 0 if array is empty
 *
 * @example
 * const avgPrice = averageByKey(trades, 'price')
 * const avgConfidence = averageByKey(decisions, 'confidence')
 */
export function averageByKey<T>(items: readonly T[], key: keyof T): number {
  if (items.length === 0) return 0;
  return sumByKey(items, key) / items.length;
}

/**
 * groupByKey - Group array items by a property value, returning a Record mapping keys to arrays.
 *
 * @param items - Array of items to group
 * @param key - Property name to group by (value will be stringified as key)
 * @returns Record mapping property values to arrays of items with that value
 *
 * @example
 * const byAction = groupByKey(decisions, 'action')
 * // { "buy": [...], "sell": [...], "hold": [...] }
 *
 * const bySymbol = groupByKey(trades, 'symbol')
 * // { "AAPLx": [...], "TSLAx": [...] }
 */
export function groupByKey<T>(
  items: readonly T[],
  key: keyof T,
): Record<string, T[]> {
  const result: Record<string, T[]> = {};

  for (const item of items) {
    const keyValue = String(item[key]);
    if (!(keyValue in result)) {
      result[keyValue] = [];
    }
    result[keyValue].push(item);
  }

  return result;
}

/**
 * createKeyMap - Create a Record mapping one property to another property's value.
 *
 * @param items - Array of items to map
 * @param keyProp - Property name to use as Record keys (will be stringified)
 * @param valueProp - Property name to use as Record values
 * @returns Record mapping keyProp values to valueProp values
 *
 * @example
 * // Create dimension weight map
 * const weights = createKeyMap(dimensions, 'key', 'weight')
 * // { "financial": 0.3, "reasoning": 0.25, ... }
 *
 * // Create symbol price map
 * const prices = createKeyMap(quotes, 'symbol', 'price')
 * // { "AAPLx": 245.50, "TSLAx": 198.20, ... }
 */
export function createKeyMap<T, K extends keyof T, V extends keyof T>(
  items: readonly T[],
  keyProp: K,
  valueProp: V,
): Record<string, T[V]> {
  return items.reduce((map, item) => {
    map[String(item[keyProp])] = item[valueProp];
    return map;
  }, {} as Record<string, T[V]>);
}

/**
 * countByCondition - Count items in an array that match a predicate function.
 *
 * @param items - Array of items to count
 * @param predicate - Function that returns true for items to count
 * @returns Number of items matching the predicate
 *
 * @example
 * const buyCount = countByCondition(decisions, (d) => d.action === "buy")
 * const highConfCount = countByCondition(trades, (t) => t.confidence > 0.7)
 */
export function countByCondition<T>(
  items: readonly T[],
  predicate: (item: T) => boolean,
): number {
  let count = 0;
  for (const item of items) {
    if (predicate(item)) count++;
  }
  return count;
}

/**
 * filterByMapKey - Filter an array to items whose property value exists as a key in a map.
 *
 * @param items - Array of items to filter
 * @param key - Property name to check against map keys
 * @param map - Record to check keys against
 * @returns Filtered array containing only items with matching map keys
 *
 * @example
 * const validDecisions = filterByMapKey(allDecisions, 'roundId', roundMap)
 * // Only decisions where roundId exists in roundMap
 */
export function filterByMapKey<T>(
  items: readonly T[],
  key: keyof T,
  map: Record<string, unknown>,
): T[] {
  return items.filter((item) => String(item[key]) in map);
}

/**
 * indexBy - Create a Record mapping a property value to the full object.
 *
 * @param items - Array of items to index
 * @param keyProp - Property name to use as Record keys (will be stringified)
 * @returns Record mapping keyProp values to the full objects
 *
 * @example
 * // Index decisions by roundId for O(1) lookup
 * const decisionsByRound = indexBy(decisions, 'roundId')
 * const decision = decisionsByRound['round-123']
 *
 * // Index positions by symbol
 * const positionsBySymbol = indexBy(positions, 'symbol')
 * const tslaPosition = positionsBySymbol['TSLAx']
 */
export function indexBy<T, K extends keyof T>(
  items: readonly T[],
  keyProp: K,
): Record<string, T> {
  return items.reduce((index, item) => {
    index[String(item[keyProp])] = item;
    return index;
  }, {} as Record<string, T>);
}

/**
 * groupAndAggregate - Advanced grouping with custom aggregation logic.
 *
 * Combines grouping (like groupByKey) with aggregation (like reduce) in one pass.
 * More flexible than groupByKey when you need to transform items during grouping.
 *
 * @param items - Array of items to group and aggregate
 * @param keyFn - Function to extract group key OR property name
 * @param initFn - Function to create initial accumulator value for each group
 * @param aggregateFn - Function to aggregate an item into the accumulator
 * @returns Record mapping group keys to aggregated values
 *
 * @example
 * // Count occurrences by category
 * groupAndAggregate(items, 'category', () => 0, (count) => count + 1)
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
 * computeSampleVariance - Calculate the sample variance of a numeric property across an array.
 *
 * Sample variance measures how spread out values are from their mean. Uses n-1 denominator
 * (Bessel's correction) for unbiased estimation of population variance from a sample.
 *
 * Formula: Σ(xi - mean)² / (n - 1)
 *
 * @param items - Array of items to analyze
 * @param key - Property name to calculate variance for (must be numeric)
 * @returns Sample variance, or 0 if fewer than 2 items
 *
 * @example
 * // Calculate confidence variance across decisions
 * const confVariance = computeSampleVariance(decisions, 'confidence')
 *
 * // Calculate P&L variance to measure consistency
 * const pnlVariance = computeSampleVariance(trades, 'pnlPercent')
 *
 * // Calculate price volatility (variance of returns)
 * const priceVariance = computeSampleVariance(returns, 'dailyReturn')
 */
export function computeSampleVariance<T>(
  items: readonly T[],
  key: keyof T,
): number {
  // Need at least 2 items for meaningful variance calculation
  if (items.length < 2) return 0;

  // Calculate mean
  const mean = averageByKey(items, key);

  // Calculate sum of squared differences from mean
  const sumSquaredDiffs = items.reduce((sum, item) => {
    const value = Number(item[key]);
    const diff = value - mean;
    return sum + (diff * diff);
  }, 0);

  // Sample variance uses n-1 denominator (Bessel's correction)
  return sumSquaredDiffs / (items.length - 1);
}

/**
 * computeVariance - Calculate variance of an array of numbers.
 *
 * Variance measures how spread out values are from their mean.
 * This helper eliminates 58+ duplicate manual variance calculations across the codebase.
 *
 * Formula: Σ(xi - mean)² / n  (population variance)
 *       or Σ(xi - mean)² / (n-1)  (sample variance, Bessel's correction)
 *
 * @param values - Array of numeric values
 * @param sampleVariance - If true, use n-1 denominator (Bessel's correction). Default: true
 * @returns Variance, or 0 if fewer than 2 values
 *
 * @example
 * // Calculate sample variance (default, uses n-1)
 * const returns = [0.02, -0.01, 0.03, 0.01];
 * const variance = computeVariance(returns); // Sample variance
 *
 * // Calculate population variance (uses n)
 * const populationVar = computeVariance(returns, false);
 *
 * // Get standard deviation from variance
 * const volatility = Math.sqrt(computeVariance(returns));
 *
 * // Safe handling of edge cases
 * computeVariance([]) // 0 (empty array)
 * computeVariance([5]) // 0 (single value, no variance)
 * computeVariance([1, 2, 3]) // 1 (sample variance)
 */
export function computeVariance(
  values: number[],
  sampleVariance = true,
): number {
  // Need at least 2 values for meaningful variance calculation
  if (values.length < 2) return 0;

  // Calculate mean
  const mean = values.reduce((sum, val) => sum + val, 0) / values.length;

  // Calculate sum of squared differences from mean
  const sumSquaredDiffs = values.reduce((sum, val) => {
    const diff = val - mean;
    return sum + (diff * diff);
  }, 0);

  // Sample variance uses n-1 denominator (Bessel's correction)
  // Population variance uses n denominator
  const denominator = sampleVariance ? values.length - 1 : values.length;
  return sumSquaredDiffs / denominator;
}

/**
 * round2 - Round a number to 2 decimal places.
 *
 * @param n - Number to round
 * @returns Number rounded to 2 decimal places
 *
 * @example
 * round2(3.14159) // 3.14
 * round2(99.999) // 100.00
 */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * round4 - Round a number to 4 decimal places.
 *
 * @param n - Number to round
 * @returns Number rounded to 4 decimal places
 *
 * @example
 * round4(3.14159265) // 3.1416
 * round4(0.123456) // 0.1235
 */
export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * formatNumber - Format a number with thousands separators.
 *
 * @param n - Number to format
 * @param decimals - Number of decimal places (default: 0)
 * @returns Formatted string with thousands separators
 *
 * @example
 * formatNumber(1234567) // "1,234,567"
 * formatNumber(1234.5678, 2) // "1,234.57"
 */
export function formatNumber(n: number, decimals = 0): string {
  return n.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * percentile - Calculate the value at a given percentile in a sorted array.
 *
 * @param values - Array of numeric values (will be sorted internally)
 * @param p - Percentile to calculate (0-100)
 * @returns Value at the specified percentile
 *
 * @example
 * percentile([1, 2, 3, 4, 5], 50) // 3 (median)
 * percentile([1, 2, 3, 4, 5], 95) // 5 (95th percentile)
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/**
 * clamp - Constrain a number to be within a specified range.
 *
 * @param value - Number to clamp
 * @param min - Minimum allowed value
 * @param max - Maximum allowed value
 * @returns Clamped value
 *
 * @example
 * clamp(150, 0, 100) // 100
 * clamp(-50, 0, 100) // 0
 * clamp(50, 0, 100) // 50
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * median - Calculate the median value of an array of numbers.
 *
 * @param values - Array of numeric values
 * @returns Median value, or 0 if array is empty
 *
 * @example
 * median([1, 2, 3, 4, 5]) // 3
 * median([1, 2, 3, 4]) // 2.5
 */
export function median(values: number[]): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * standardDeviation - Calculate the standard deviation of an array of numbers.
 *
 * Standard deviation is the square root of variance. Measures spread of data around the mean.
 * Uses sample standard deviation (n-1 denominator) for unbiased estimation.
 *
 * @param values - Array of numeric values
 * @returns Standard deviation, or 0 if fewer than 2 values
 *
 * @example
 * standardDeviation([1, 2, 3, 4, 5]) // ~1.58
 * standardDeviation([10, 10, 10]) // 0 (no variation)
 */
export function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;

  const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
  const variance = values.reduce((sum, val) => {
    const diff = val - mean;
    return sum + (diff * diff);
  }, 0) / (values.length - 1);

  return Math.sqrt(variance);
}

/**
 * weightedAverage - Calculate weighted average of values.
 *
 * @param values - Array of numeric values
 * @param weights - Array of weights (same length as values)
 * @returns Weighted average, or 0 if arrays are empty or mismatched
 *
 * @example
 * weightedAverage([10, 20, 30], [1, 2, 3]) // 23.33
 * // (10*1 + 20*2 + 30*3) / (1 + 2 + 3) = 140 / 6 = 23.33
 */
export function weightedAverage(values: number[], weights: number[]): number {
  if (values.length === 0 || values.length !== weights.length) return 0;

  const weightedSum = values.reduce((sum, val, i) => sum + val * weights[i], 0);
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);

  return totalWeight === 0 ? 0 : weightedSum / totalWeight;
}

/**
 * movingAverage - Calculate simple moving average over a window.
 *
 * @param values - Array of numeric values
 * @param window - Size of moving average window
 * @returns Array of moving averages (shorter than input by window-1)
 *
 * @example
 * movingAverage([1, 2, 3, 4, 5], 3)
 * // [2, 3, 4] (avg of [1,2,3], [2,3,4], [3,4,5])
 */
export function movingAverage(values: number[], window: number): number[] {
  if (values.length < window) return [];

  const result: number[] = [];
  for (let i = 0; i <= values.length - window; i++) {
    const slice = values.slice(i, i + window);
    const avg = slice.reduce((sum, val) => sum + val, 0) / window;
    result.push(avg);
  }

  return result;
}

/**
 * exponentialMovingAverage - Calculate exponential moving average (EMA).
 *
 * EMA gives more weight to recent values using exponential decay.
 * Common in technical analysis (e.g., EMA-12, EMA-26 for MACD).
 *
 * @param values - Array of numeric values (chronological order)
 * @param period - Number of periods for EMA calculation
 * @returns Array of EMA values (starts at period-1 index)
 *
 * @example
 * exponentialMovingAverage([22, 24, 23, 25, 27], 3)
 * // [23, 24, 25.5] (EMA-3 starting from 3rd value)
 */
export function exponentialMovingAverage(
  values: number[],
  period: number,
): number[] {
  if (values.length < period) return [];

  const multiplier = 2 / (period + 1);
  const result: number[] = [];

  // Start with simple moving average for first EMA value
  const firstSMA = values.slice(0, period).reduce((sum, val) => sum + val, 0) /
    period;
  result.push(firstSMA);

  // Calculate EMA for remaining values
  for (let i = period; i < values.length; i++) {
    const ema = (values[i] - result[result.length - 1]) * multiplier +
      result[result.length - 1];
    result.push(ema);
  }

  return result;
}

// Additional commonly-used helpers
export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function round(n: number): number {
  return Math.round(n);
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

export function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const avg = mean(values);
  const squareDiffs = values.map(value => Math.pow(value - avg, 2));
  const avgSquareDiff = mean(squareDiffs);
  return Math.sqrt(avgSquareDiff);
}

export function computeStdDev(values: number[]): number {
  return stdDev(values);
}

export function splitSentences(text: string, minLength = 10): string[] {
  return text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length >= minLength);
}

export function getTopKey(record: Record<string, number>): string | null {
  const entries = Object.entries(record);
  if (entries.length === 0) return null;
  return entries.reduce((max, [key, val]) => val > max[1] ? [key, val] : max, entries[0])[0];
}

export function colorizeScore(score: number, thresholds = { good: 0.8, ok: 0.6 }): string {
  if (score >= thresholds.good) return `🟢 ${(score * 100).toFixed(1)}%`;
  if (score >= thresholds.ok) return `🟡 ${(score * 100).toFixed(1)}%`;
  return `🔴 ${(score * 100).toFixed(1)}%`;
}

/**
 * Default common English words to filter out from text analysis
 * Includes articles, prepositions, conjunctions, pronouns, and other high-frequency words
 */
const DEFAULT_COMMON_WORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'has', 'are', 'was', 'were',
  'been', 'will', 'would', 'could', 'should', 'can', 'may', 'might', 'must', 'shall',
  'not', 'but', 'or', 'as', 'if', 'when', 'than', 'then', 'there', 'their', 'they',
  'we', 'you', 'he', 'she', 'it', 'his', 'her', 'its', 'our', 'your', 'my',
  'at', 'by', 'in', 'on', 'to', 'of', 'up', 'out', 'off', 'over', 'under',
  'about', 'above', 'after', 'before', 'between', 'through', 'during', 'into',
  'some', 'any', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
  'such', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just'
]);

/**
 * Filter words from text, removing short words and common English words
 * @param text - Text to extract filtered words from
 * @param minLength - Minimum word length (default: 3), or Set of common words to exclude
 * @returns Array of filtered words (lowercase, length > minLength, not common words)
 * @example getFilteredWords("The stock price is rising") → ["stock", "price", "rising"]
 * @example getFilteredWords("AI stocks", 2) → ["stocks"] (words >2 chars)
 */
export function getFilteredWords(text: string, minLength?: number | Set<string>): string[] {
  // Handle both signatures: number for min length, Set for custom common words
  const minLen = typeof minLength === 'number' ? minLength : 3;
  const commonWords = minLength instanceof Set ? minLength : DEFAULT_COMMON_WORDS;

  return text.toLowerCase().split(/\s+/).filter(w => w.length > minLen && !commonWords.has(w));
}

/**
 * Calculate weighted sum of values using corresponding weights array
 * @param values - Array of numeric values
 * @param weights - Array of weights (same length as values)
 * @returns Weighted sum (values[i] * weights[i] summed)
 * @example weightedSum([10, 20, 30], [0.5, 0.3, 0.2]) → 16 (10*0.5 + 20*0.3 + 30*0.2)
 */
export function weightedSum(values: readonly number[], weights: readonly number[]): number {
  if (values.length !== weights.length) {
    throw new Error(`weightedSum: values length (${values.length}) must match weights length (${weights.length})`);
  }
  return values.reduce((sum, val, i) => sum + val * weights[i], 0);
}

/**
 * Calculate weighted sum of object property values using corresponding weights
 * @param items - Array of objects
 * @param key - Property key to extract values
 * @param weights - Array of weights (same length as items) OR property name containing weights
 * @returns Weighted sum of property values
 * @example weightedSumByKey([{score: 10}, {score: 20}], 'score', [0.7, 0.3]) → 13 (10*0.7 + 20*0.3)
 * @example weightedSumByKey([{score: 10, w: 0.7}, {score: 20, w: 0.3}], 'score', 'w') → 13
 */
export function weightedSumByKey<T>(items: readonly T[], key: keyof T, weights: number[] | keyof T): number {
  // Handle property name as weights
  if (typeof weights === 'string' || typeof weights === 'symbol' || typeof weights === 'number') {
    const weightProp = weights as keyof T;
    return items.reduce((sum, item) => sum + (Number(item[key]) || 0) * (Number(item[weightProp]) || 0), 0);
  }

  // Handle array of weights
  const weightArray = weights as number[];
  if (items.length !== weightArray.length) {
    throw new Error(`weightedSumByKey: items length (${items.length}) must match weights length (${weightArray.length})`);
  }
  return items.reduce((sum, item, i) => sum + (Number(item[key]) || 0) * weightArray[i], 0);
}

/**
 * Efficiently combine map and filter operations in a single pass
 * Applies mapFn to each item, then keeps only items where filterFn returns true
 * More efficient than .map().filter() which creates intermediate arrays
 *
 * @param items - Array to process
 * @param mapFn - Transformation function to apply to each item
 * @param filterFn - Predicate function to test mapped items (return true to keep)
 * @returns Array of mapped items that pass the filter
 *
 * @example
 * // Instead of: trades.map(t => t.symbol).filter(s => s.length > 0)
 * filterMap(trades, t => t.symbol, s => s.length > 0)
 *
 * @example
 * // Instead of: decisions.map(d => d.pnl).filter(pnl => pnl > 0)
 * filterMap(decisions, d => d.pnl, pnl => pnl > 0)
 */
export function filterMap<T, U>(
  items: readonly T[],
  mapFn: (item: T, index: number) => U,
  filterFn: (mapped: U, index: number) => boolean
): U[] {
  const result: U[] = [];
  for (let i = 0; i < items.length; i++) {
    const mapped = mapFn(items[i], i);
    if (filterFn(mapped, i)) {
      result.push(mapped);
    }
  }
  return result;
}

/**
 * Sort Record entries by value in descending order
 * @param record - Record to sort
 * @returns Array of [key, value] tuples sorted by value descending
 * @example sortEntriesDescending({a: 10, b: 30, c: 20}) → [['b', 30], ['c', 20], ['a', 10]]
 */
export function sortEntriesDescending(record: Record<string, number>): [string, number][] {
  return Object.entries(record).sort((a, b) => b[1] - a[1]);
}

/**
 * Calculate average of numeric array (alias for mean)
 * @param values - Array of numbers
 * @returns Average value or 0 if empty
 */
export function calculateAverage(values: number[]): number {
  return mean(values);
}

/**
 * Normalize values to 0-1 range
 * @param values - Array of numbers to normalize
 * @returns Array of normalized values in [0, 1] range
 * @example normalize([10, 20, 30]) → [0, 0.5, 1]
 */
export function normalize(values: number[]): number[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 0.5);
  return values.map(v => (v - min) / (max - min));
}

/**
 * Sort numeric array in descending order
 * @param values - Array of numbers
 * @returns New sorted array (descending)
 */
export function sortDescending(values: number[]): number[] {
  return [...values].sort((a, b) => b - a);
}

/**
 * Sort array of objects by property value in descending order
 * @param items - Array of objects
 * @param key - Property key to sort by
 * @returns New sorted array (descending by key value)
 */
export function sortByDescending<T>(items: T[], key: keyof T): T[] {
  return [...items].sort((a, b) => (Number(b[key]) || 0) - (Number(a[key]) || 0));
}

/**
 * Milliseconds per day constant (24 * 60 * 60 * 1000)
 */
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Find maximum object by custom comparison function
 * @param items - Array of objects
 * @param compareFn - Function that extracts comparable value
 * @returns Object with maximum value or null if empty
 * @example findMaxBy([{x: 5}, {x: 10}], item => Math.abs(item.x)) → {x: 10}
 */
export function findMaxBy<T>(items: T[], compareFn: (item: T) => number): T | null {
  if (items.length === 0) return null;
  return items.reduce((max, item) => compareFn(item) > compareFn(max) ? item : max, items[0]);
}

/**
 * Find minimum object by custom comparison function
 * @param items - Array of objects
 * @param compareFn - Function that extracts comparable value
 * @returns Object with minimum value or null if empty
 */
export function findMinBy<T>(items: T[], compareFn: (item: T) => number): T | null {
  if (items.length === 0) return null;
  return items.reduce((min, item) => compareFn(item) < compareFn(min) ? item : min, items[0]);
}

/**
 * Count items matching a condition
 * @param items - Array of objects
 * @param predicate - Condition function
 * @returns Count of matching items
 */
export function countWhere<T>(items: T[], predicate: (item: T) => boolean): number {
  return items.filter(predicate).length;
}

/**
 * Calculate cosine similarity between two numeric vectors
 * @param a - First vector
 * @param b - Second vector
 * @returns Cosine similarity in [-1, 1] range
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  if (magnitudeA === 0 || magnitudeB === 0) return 0;
  return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * Calculate average of items matching a condition
 * @param items - Array of objects
 * @param key - Property key to average
 * @param predicate - Condition function
 * @returns Average value or 0 if no matches
 */
export function averageByCondition<T>(items: T[], key: keyof T, predicate: (item: T) => boolean): number {
  const filtered = items.filter(predicate);
  return averageByKey(filtered, key);
}

/**
 * Calculate average of absolute values by key
 * @param items - Array of objects
 * @param key - Property key to extract
 * @returns Average of absolute values
 */
export function averageAbsoluteByKey<T>(items: readonly T[], key: keyof T): number {
  if (items.length === 0) return 0;
  const sum = items.reduce((acc, item) => acc + Math.abs(Number(item[key]) || 0), 0);
  return sum / items.length;
}

/**
 * Find maximum absolute value in array
 * @param values - Array of numbers
 * @returns Maximum absolute value or 0 if empty
 */
export function absMax(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.max(...values.map(Math.abs));
}

/**
 * Round to 1 decimal place (alias for backward compatibility)
 */
export const round1 = round;

/**
 * Calculate average of a single property extracted from array of objects
 * Combines map + reduce operations into single efficient pass
 * @param items - Array of objects
 * @param key - Property key to average (must be numeric)
 * @returns Average of all property values, or 0 if array empty
 * @example avgOfProperty([{conf: 75}, {conf: 85}], 'conf') → 80
 * @example avgOfProperty(trades, 'confidence') - clearer than trades.map(t => t.confidence).reduce(...) / length
 */
export function avgOfProperty<T>(items: readonly T[], key: keyof T): number {
  if (items.length === 0) return 0;
  return items.reduce((sum, item) => sum + Number(item[key]), 0) / items.length;
}
