const T_95_BY_DF = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145,
  2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048,
  2.045, 2.042,
];
const Z_95 = 1.96;

function critical95(n: number): number {
  return T_95_BY_DF[n - 2] ?? Z_95;
}

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
  const margin = n < 2 ? Number.POSITIVE_INFINITY : (critical95(n) * sdDiff) / Math.sqrt(n);
  return { n, meanDiff, sdDiff, margin };
}

export function slowerWithConfidence(first: readonly number[], second: readonly number[]): boolean {
  const stats = pairedStats(first, second);
  return stats.meanDiff - stats.margin > 0;
}

export type Series<T> = readonly (readonly [string, T[]])[];

export interface Steps<T> {
  measure: (binary: string) => Promise<T>;
  warmUp: (binary: string) => Promise<void>;
}

export async function interleaveWith<T>(
  binaries: readonly string[],
  { measure, warmUp }: Steps<T>,
  rounds: number,
): Promise<Series<T>> {
  const series: Series<T> = binaries.map((binary) => [binary, []]);

  for (const [binary] of series) {
    // oxlint-disable-next-line no-await-in-loop
    await warmUp(binary);
  }

  for (let round = 0; round < rounds; round++) {
    for (const [binary, values] of round % 2 === 0 ? series : series.toReversed()) {
      // oxlint-disable-next-line no-await-in-loop
      values.push(await measure(binary));
    }
  }

  return series;
}

export async function interleave<T>(
  binaries: readonly string[],
  measure: (binary: string) => Promise<T>,
  rounds: number,
): Promise<Series<T>> {
  const warmUp = async (binary: string): Promise<void> => {
    await measure(binary);
  };
  return await interleaveWith(binaries, { measure, warmUp }, rounds);
}

export function summarise(values: readonly number[]): string {
  return [
    `min ${quantile(values, 0).toFixed(0)}`,
    `p25 ${quantile(values, 0.25).toFixed(0)}`,
    `median ${quantile(values, 0.5).toFixed(0)}`,
    `p75 ${quantile(values, 0.75).toFixed(0)}`,
  ].join('  ');
}
