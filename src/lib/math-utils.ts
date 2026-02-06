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

/**
 * Computes the arithmetic mean of a number array.
 * Returns 0 for empty arrays.
 */
export function mean(values: number[]): number {
  return values.length > 0
    ? values.reduce((s, v) => s + v, 0) / values.length
    : 0;
}

/**
 * Computes the population standard deviation of a number array.
 * Returns 0 for arrays with fewer than 2 elements.
 */
export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = values.reduce((s, v) => s + (v - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Finds the element with the maximum value for a given property.
 * Returns undefined if array is empty.
 * Optionally accepts a custom comparator for complex comparison logic (e.g., Math.abs).
 *
 * Replaces verbose pattern: `array.reduce((a, b) => b.prop > a.prop ? b : a, array[0])`
 *
 * @param items - Array of objects to search
 * @param key - Property name to compare
 * @param compareFn - Optional custom comparison function (defaults to direct comparison)
 * @returns The element with the maximum value, or undefined if array is empty
 *
 * @example
 * const agents = [{name: 'A', score: 85}, {name: 'B', score: 92}];
 * findMax(agents, 'score') // returns {name: 'B', score: 92}
 *
 * const trades = [{symbol: 'AAPL', beta: -0.5}, {symbol: 'MSFT', beta: 1.2}];
 * findMax(trades, 'beta', (a, b) => Math.abs(a) - Math.abs(b)) // returns {symbol: 'MSFT', beta: 1.2}
 *
 * findMax([], 'score') // returns undefined
 */
export function findMax<T extends Record<string, any>>(
  items: T[],
  key: keyof T & string,
  compareFn?: (a: number, b: number) => number,
): T | undefined {
  if (items.length === 0) return undefined;

  return items.reduce((max, item) => {
    const maxVal = max[key] as number;
    const itemVal = item[key] as number;

    if (compareFn) {
      return compareFn(itemVal, maxVal) > 0 ? item : max;
    }
    return itemVal > maxVal ? item : max;
  }, items[0]);
}

/**
 * Finds the element with the minimum value for a given property.
 * Returns undefined if array is empty.
 * Optionally accepts a custom comparator for complex comparison logic (e.g., Math.abs).
 *
 * Replaces verbose pattern: `array.reduce((a, b) => b.prop < a.prop ? b : a, array[0])`
 *
 * @param items - Array of objects to search
 * @param key - Property name to compare
 * @param compareFn - Optional custom comparison function (defaults to direct comparison)
 * @returns The element with the minimum value, or undefined if array is empty
 *
 * @example
 * const agents = [{name: 'A', risk: 0.15}, {name: 'B', risk: 0.08}];
 * findMin(agents, 'risk') // returns {name: 'B', risk: 0.08}
 *
 * const trades = [{symbol: 'AAPL', beta: -0.5}, {symbol: 'MSFT', beta: 1.2}];
 * findMin(trades, 'beta', (a, b) => Math.abs(a) - Math.abs(b)) // returns {symbol: 'AAPL', beta: -0.5}
 *
 * findMin([], 'risk') // returns undefined
 */
export function findMin<T extends Record<string, any>>(
  items: T[],
  key: keyof T & string,
  compareFn?: (a: number, b: number) => number,
): T | undefined {
  if (items.length === 0) return undefined;

  return items.reduce((min, item) => {
    const minVal = min[key] as number;
    const itemVal = item[key] as number;

    if (compareFn) {
      return compareFn(itemVal, minVal) < 0 ? item : min;
    }
    return itemVal < minVal ? item : min;
  }, items[0]);
}

/**
 * Calculates the sum of a property across an array of objects.
 * Optionally applies a transform function before summing.
 *
 * Replaces verbose pattern: `items.reduce((sum, item) => sum + item.property, 0)`
 *
 * @param items - Array of objects to sum
 * @param key - Property name to sum
 * @param getterFn - Optional transform function (e.g., Math.abs for absolute values)
 * @returns Sum of the property values
 *
 * @example
 * const trades = [{pnl: 100}, {pnl: -50}, {pnl: 200}];
 * sumByKey(trades, 'pnl') // returns 250
 *
 * const slippage = [{bps: -15}, {bps: 10}, {bps: -20}];
 * sumByKey(slippage, 'bps', Math.abs) // returns 45
 *
 * sumByKey([], 'pnl') // returns 0
 */
export function sumByKey<T extends Record<string, any>>(
  items: readonly T[],
  key: keyof T & string,
  getterFn?: (val: number) => number,
): number {
  return items.reduce((sum, item) => {
    const value = item[key] as number;
    return sum + (getterFn ? getterFn(value) : value);
  }, 0);
}

/**
 * Calculates the average (arithmetic mean) of a property across an array of objects.
 * Optionally applies a transform function before averaging.
 * Returns 0 for empty arrays.
 *
 * Replaces verbose pattern: `items.reduce((sum, item) => sum + item.property, 0) / items.length`
 *
 * @param items - Array of objects to average
 * @param key - Property name to average
 * @param getterFn - Optional transform function (e.g., Math.abs for absolute values)
 * @returns Average of the property values, or 0 if array is empty
 *
 * @example
 * const agents = [{winRate: 0.65}, {winRate: 0.58}, {winRate: 0.72}];
 * averageByKey(agents, 'winRate') // returns 0.65
 *
 * const trades = [{slippageBps: -15}, {slippageBps: 10}, {slippageBps: -20}];
 * averageByKey(trades, 'slippageBps', Math.abs) // returns 15
 *
 * averageByKey([], 'winRate') // returns 0
 */
export function averageByKey<T extends Record<string, any>>(
  items: readonly T[],
  key: keyof T & string,
  getterFn?: (val: number) => number,
): number {
  if (items.length === 0) return 0;
  return sumByKey(items, key, getterFn) / items.length;
}

/**
 * Sorts an array of objects in descending order by a numeric property.
 * Creates a shallow copy to avoid mutating the original array.
 *
 * Replaces verbose pattern: `array.sort((a, b) => b.property - a.property)`
 *
 * @param items - Array of objects to sort
 * @param key - Property name to sort by (must be numeric)
 * @returns A new array sorted in descending order
 *
 * @example
 * const agents = [{name: 'A', score: 85}, {name: 'B', score: 92}, {name: 'C', score: 78}];
 * sortDescending(agents, 'score')
 * // returns [{name: 'B', score: 92}, {name: 'A', score: 85}, {name: 'C', score: 78}]
 *
 * const trades = [{symbol: 'AAPL', pnl: -5.2}, {symbol: 'MSFT', pnl: 8.3}, {symbol: 'GOOGL', pnl: 3.1}];
 * sortDescending(trades, 'pnl')
 * // returns [{symbol: 'MSFT', pnl: 8.3}, {symbol: 'GOOGL', pnl: 3.1}, {symbol: 'AAPL', pnl: -5.2}]
 */
/**
 * Finds the key with the highest numeric value in a record.
 *
 * Replaces verbose pattern: `Object.entries(map).sort(([,a],[,b]) => b - a)[0]?.[0]`
 *
 * @param record - A record mapping string keys to numeric values
 * @returns The key with the highest value, or undefined if record is empty
 *
 * @example
 * const actionCounts = { buy: 2, sell: 1, hold: 5 };
 * getTopKey(actionCounts) // returns "hold"
 *
 * getTopKey({}) // returns undefined
 *
 * // With nullish coalescing for default:
 * getTopKey(symbolCounts) ?? "N/A" // returns "N/A" if empty
 */
export function getTopKey(record: Record<string, number>): string | undefined {
  let topKey: string | undefined;
  let topVal = -Infinity;
  for (const [key, val] of Object.entries(record)) {
    if (val > topVal) {
      topVal = val;
      topKey = key;
    }
  }
  return topKey;
}

/**
 * Finds the entry (key-value pair) with the highest numeric value in a record.
 *
 * Replaces verbose pattern: `Object.entries(map).sort(([,a],[,b]) => b - a)[0]`
 *
 * @param record - A record mapping string keys to numeric values
 * @returns A [key, value] tuple for the highest entry, or undefined if record is empty
 *
 * @example
 * const actionCounts = { buy: 2, sell: 1, hold: 5 };
 * getTopEntry(actionCounts) // returns ["hold", 5]
 *
 * const [action, count] = getTopEntry(actionCounts)!;
 * // action = "hold", count = 5
 *
 * getTopEntry({}) // returns undefined
 */
export function getTopEntry(record: Record<string, number>): [string, number] | undefined {
  let topEntry: [string, number] | undefined;
  for (const [key, val] of Object.entries(record)) {
    if (!topEntry || val > topEntry[1]) {
      topEntry = [key, val];
    }
  }
  return topEntry;
}

/**
 * Sorts a record's entries in descending order by numeric value (highest first).
 *
 * Replaces verbose pattern: `Object.entries(record).sort(([, a], [, b]) => b - a)`
 *
 * Complements getTopKey() and getTopEntry():
 * - getTopKey() → returns just the top key
 * - getTopEntry() → returns just the top [key, value] pair
 * - sortEntriesDescending() → returns ALL entries sorted descending
 *
 * @param record - A record mapping string keys to numeric values
 * @returns Array of [key, value] tuples sorted by value (highest to lowest)
 *
 * @example
 * const actionCounts = { buy: 2, sell: 1, hold: 5 };
 * sortEntriesDescending(actionCounts)
 * // returns [["hold", 5], ["buy", 2], ["sell", 1]]
 *
 * // Get top 3 symbols by frequency:
 * const top3 = sortEntriesDescending(symbolCounts).slice(0, 3);
 *
 * sortEntriesDescending({}) // returns []
 */
export function sortEntriesDescending(record: Record<string, number>): [string, number][] {
  return Object.entries(record).sort(([, a], [, b]) => b - a);
}

export function sortDescending<T extends Record<string, any>>(
  items: T[],
  key: keyof T & string,
): T[] {
  return [...items].sort((a, b) => (b[key] as number) - (a[key] as number));
}

/**
 * Sorts an array of objects in ascending order by a numeric property.
 * Creates a shallow copy to avoid mutating the original array.
 *
 * Replaces verbose pattern: `array.sort((a, b) => a.property - b.property)`
 *
 * Complements sortDescending() for bidirectional sorting needs.
 *
 * @param items - Array of objects to sort
 * @param key - Property name to sort by (must be numeric)
 * @returns A new array sorted in ascending order
 *
 * @example
 * const agents = [{name: 'A', risk: 0.15}, {name: 'B', risk: 0.08}, {name: 'C', risk: 0.22}];
 * sortAscending(agents, 'risk')
 * // returns [{name: 'B', risk: 0.08}, {name: 'A', risk: 0.15}, {name: 'C', risk: 0.22}]
 *
 * const trades = [{symbol: 'AAPL', entryPrice: 150}, {symbol: 'MSFT', entryPrice: 120}, {symbol: 'GOOGL', entryPrice: 180}];
 * sortAscending(trades, 'entryPrice')
 * // returns [{symbol: 'MSFT', entryPrice: 120}, {symbol: 'AAPL', entryPrice: 150}, {symbol: 'GOOGL', entryPrice: 180}]
 */
export function sortAscending<T extends Record<string, any>>(
  items: T[],
  key: keyof T & string,
): T[] {
  return [...items].sort((a, b) => (a[key] as number) - (b[key] as number));
}

/**
 * Groups an array of objects by a property value.
 * Creates a record where keys are property values and values are arrays of matching objects.
 *
 * Replaces verbose pattern: `items.reduce((acc, item) => { ... }, {} as Record<string, T[]>)`
 *
 * Common use cases:
 * - Group trades by symbol
 * - Group agents by strategy
 * - Group decisions by action type (buy/sell/hold)
 * - Group rounds by date
 *
 * @param items - Array of objects to group
 * @param key - Property name to group by
 * @returns Record mapping property values to arrays of matching objects
 *
 * @example
 * const trades = [
 *   {symbol: 'AAPL', action: 'buy'},
 *   {symbol: 'MSFT', action: 'sell'},
 *   {symbol: 'AAPL', action: 'hold'}
 * ];
 * groupByKey(trades, 'symbol')
 * // returns {
 * //   AAPL: [{symbol: 'AAPL', action: 'buy'}, {symbol: 'AAPL', action: 'hold'}],
 * //   MSFT: [{symbol: 'MSFT', action: 'sell'}]
 * // }
 *
 * const decisions = [{action: 'buy', conf: 75}, {action: 'hold', conf: 60}, {action: 'buy', conf: 82}];
 * groupByKey(decisions, 'action')
 * // returns {
 * //   buy: [{action: 'buy', conf: 75}, {action: 'buy', conf: 82}],
 * //   hold: [{action: 'hold', conf: 60}]
 * // }
 *
 * groupByKey([], 'symbol') // returns {}
 */
export function groupByKey<T extends Record<string, any>>(
  items: readonly T[],
  key: keyof T & string,
): Record<string, T[]> {
  return items.reduce(
    (acc, item) => {
      const groupKey = String(item[key]);
      if (!acc[groupKey]) {
        acc[groupKey] = [];
      }
      acc[groupKey].push(item);
      return acc;
    },
    {} as Record<string, T[]>,
  );
}

/**
 * Creates a key-value map from an array of objects by extracting specified property values.
 * Converts arrays to Record<string, V> for O(1) lookups instead of O(n) array scans.
 *
 * Common use cases:
 * - Dimension weight maps: createKeyMap(DIMENSIONS, 'key', 'weight') → {pnlPercent: 15, sharpeRatio: 10}
 * - Symbol price maps: createKeyMap(positions, 'symbol', 'price') → {AAPL: 150.25, MSFT: 380.50}
 * - ID entity maps: createKeyMap(users, 'id', 'name') → {123: 'Alice', 456: 'Bob'}
 *
 * @param items - Array of objects to convert to map
 * @param keyProp - Property to use as map keys
 * @param valueProp - Property to use as map values
 * @returns Record mapping keyProp values to valueProp values
 *
 * @example
 * const dimensions = [
 *   { key: 'pnlPercent', weight: 15, category: 'performance' },
 *   { key: 'sharpeRatio', weight: 10, category: 'performance' },
 * ];
 *
 * createKeyMap(dimensions, 'key', 'weight')
 * // returns { pnlPercent: 15, sharpeRatio: 10 }
 *
 * createKeyMap(dimensions, 'category', 'weight')
 * // returns { performance: 10 } (last value wins if duplicate keys)
 *
 * createKeyMap([], 'key', 'weight') // returns {}
 */
export function createKeyMap<T extends Record<string, any>, K extends keyof T & string, V extends keyof T>(
  items: readonly T[],
  keyProp: K,
  valueProp: V,
): Record<string, T[V]> {
  return items.reduce(
    (acc, item) => {
      acc[String(item[keyProp])] = item[valueProp];
      return acc;
    },
    {} as Record<string, T[V]>,
  );
}

/**
 * Creates a lookup map indexed by a specified key property, mapping to the entire object.
 * Eliminates manual Map construction loops for simple key-to-object indexing.
 *
 * Common use cases:
 * - Index decisions by roundId: indexBy(decisions, 'roundId') → {round_123: {decision object}}
 * - Index positions by symbol: indexBy(positions, 'symbol') → {AAPL: {position object}}
 * - Index users by ID: indexBy(users, 'id') → {123: {user object}}
 *
 * @param items - Array of objects to index
 * @param keyProp - Property to use as index key
 * @returns Record mapping key values to the full objects
 *
 * @example
 * const decisions = [{roundId: 'r1', action: 'buy'}, {roundId: 'r2', action: 'sell'}];
 * indexBy(decisions, 'roundId')
 * // returns { r1: {roundId: 'r1', action: 'buy'}, r2: {roundId: 'r2', action: 'sell'} }
 *
 * indexBy([], 'id') // returns {}
 */
export function indexBy<T extends Record<string, any>, K extends keyof T & string>(
  items: readonly T[],
  keyProp: K,
): Record<string, T> {
  return items.reduce(
    (acc, item) => {
      acc[String(item[keyProp])] = item;
      return acc;
    },
    {} as Record<string, T>,
  );
}

/**
 * Groups items by a key and aggregates values using custom accumulator logic.
 * Eliminates manual Map construction loops with complex value accumulation.
 *
 * Common use cases:
 * - Count occurrences: groupAndAggregate(items, 'category', () => 0, (count) => count + 1)
 * - Sum values: groupAndAggregate(items, 'sector', () => 0, (sum, item) => sum + item.value)
 * - Collect sets: groupAndAggregate(items, 'type', () => new Set(), (set, item) => set.add(item.id))
 * - Build objects: groupAndAggregate(items, 'group', () => ({count: 0, total: 0}), (agg, item) => ({count: agg.count + 1, total: agg.total + item.value}))
 *
 * @param items - Array of objects to group and aggregate
 * @param keyFn - Function that extracts grouping key from each item (or keyof T for simple property)
 * @param initFn - Function that creates initial accumulator value for each group
 * @param aggregateFn - Function that updates accumulator with each item: (accumulator, item) => newAccumulator
 * @returns Record mapping group keys to aggregated values
 *
 * @example
 * // Count decisions by sector:
 * const decisions = [{symbol: 'AAPL', sector: 'Tech'}, {symbol: 'MSFT', sector: 'Tech'}, {symbol: 'JPM', sector: 'Finance'}];
 * groupAndAggregate(decisions, (d) => d.sector, () => 0, (count) => count + 1)
 * // returns { Tech: 2, Finance: 1 }
 *
 * // Sum confidence by hour:
 * const hourly = [{hour: 9, conf: 75}, {hour: 9, conf: 80}, {hour: 10, conf: 70}];
 * groupAndAggregate(hourly, (d) => d.hour, () => ({count: 0, total: 0}), (agg, d) => ({count: agg.count + 1, total: agg.total + d.conf}))
 * // returns { '9': {count: 2, total: 155}, '10': {count: 1, total: 70} }
 *
 * // Collect unique symbols per sector:
 * groupAndAggregate(decisions, (d) => d.sector, () => new Set<string>(), (set, d) => set.add(d.symbol))
 * // returns { Tech: Set(['AAPL', 'MSFT']), Finance: Set(['JPM']) }
 */
export function groupAndAggregate<T, K extends string | number, V>(
  items: readonly T[],
  keyFn: ((item: T) => K) | (keyof T & string),
  initFn: () => V,
  aggregateFn: (accumulator: V, item: T) => V,
): Record<string, V> {
  const map: Record<string, V> = {};
  const extractKey = typeof keyFn === 'function' ? keyFn : (item: T) => item[keyFn] as unknown as K;

  for (const item of items) {
    const key = String(extractKey(item));
    if (!(key in map)) {
      map[key] = initFn();
    }
    map[key] = aggregateFn(map[key], item);
  }

  return map;
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
  compareFn: (a: number, b: number) => number = (a, b) => a - b,
): [string, number][] {
  return Object.entries(record).sort(([, a], [, b]) => compareFn(a, b));
}

/**
 * Counts the number of items in an array that match a given condition.
 * More efficient than filter().length as it avoids creating an intermediate array.
 *
 * Replaces verbose pattern: `items.filter(predicate).length`
 *
 * @param items - Array of items to count
 * @param predicate - Function that returns true for items to count
 * @returns Number of items matching the condition
 *
 * @example
 * const decisions = [{action: 'buy'}, {action: 'hold'}, {action: 'buy'}];
 * countByCondition(decisions, d => d.action === 'buy') // returns 2
 *
 * const agents = [{confidence: 75}, {confidence: 45}, {confidence: 82}];
 * countByCondition(agents, a => a.confidence > 70) // returns 2
 *
 * countByCondition([], () => true) // returns 0
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
