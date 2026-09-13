const CONFIDENCE_95 = 1.96;

export interface PairedStats {
  n: number;
  meanDiff: number;
  sdDiff: number;
  margin: number;
}

export function quantile(values: readonly number[], fraction: number): number {
  const sorted = values.toSorted((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const low = sorted[Math.floor(position)] ?? 0;
  const high = sorted[Math.ceil(position)] ?? low;
  return low + (high - low) * (position - Math.floor(position));
}

export function pairedStats(first: readonly number[], second: readonly number[]): PairedStats {
  const diffs = first.map((value, index) => (second[index] ?? 0) - value);
  const n = diffs.length;
  const meanDiff = n === 0 ? 0 : diffs.reduce((sum, value) => sum + value, 0) / n;
  const variance =
    n < 2 ? 0 : diffs.reduce((sum, value) => sum + (value - meanDiff) ** 2, 0) / (n - 1);
  const sdDiff = Math.sqrt(variance);
  return { n, meanDiff, sdDiff, margin: n === 0 ? 0 : (CONFIDENCE_95 * sdDiff) / Math.sqrt(n) };
}

export function summarise(values: readonly number[]): string {
  return [
    `min ${quantile(values, 0).toFixed(0)}`,
    `p25 ${quantile(values, 0.25).toFixed(0)}`,
    `median ${quantile(values, 0.5).toFixed(0)}`,
    `p75 ${quantile(values, 0.75).toFixed(0)}`,
  ].join('  ');
}
