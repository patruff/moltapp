/**
 * Missing helper functions referenced across the codebase
 * These need to be added to math-utils.ts
 */

// round3 - Round to 3 decimal places (used in 15+ files)
export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// round (generic) - Round to nearest integer
export function round(n: number): number {
  return Math.round(n);
}

// countWords - Count words in text (used in 8+ files)
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

// mean - Calculate arithmetic mean (used in 6+ files)
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

// stdDev - Calculate standard deviation (used in 6+ files)
export function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const avg = mean(values);
  const squareDiffs = values.map(value => Math.pow(value - avg, 2));
  const avgSquareDiff = mean(squareDiffs);
  return Math.sqrt(avgSquareDiff);
}

// computeStdDev - Alias for stdDev (used in agent-fingerprint)
export function computeStdDev(values: number[]): number {
  return stdDev(values);
}

// splitSentences - Split text into sentences (used in multiple files)
export function splitSentences(text: string, minLength = 10): string[] {
  return text
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length >= minLength);
}

// getTopKey - Get key with highest value from record (used in agent-comparison)
export function getTopKey(record: Record<string, number>): string | null {
  const entries = Object.entries(record);
  if (entries.length === 0) return null;
  return entries.reduce((max, [key, val]) => val > max[1] ? [key, val] : max, entries[0])[0];
}

// colorizeScore - Format score with color coding (used in benchmark UIs)
export function colorizeScore(score: number, thresholds = { good: 0.8, ok: 0.6 }): string {
  if (score >= thresholds.good) return `🟢 ${(score * 100).toFixed(1)}%`;
  if (score >= thresholds.ok) return `🟡 ${(score * 100).toFixed(1)}%`;
  return `🔴 ${(score * 100).toFixed(1)}%`;
}

// getFilteredWords - Filter common words from text (used in reasoning-explorer)
export function getFilteredWords(text: string, commonWords: Set<string>): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3 && !commonWords.has(w));
}
