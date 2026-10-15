const Z_95 = 1.96;
const EQUAL_TOLERANCE = 1e-7;

export interface Interval {
  low: number;
  high: number;
}

export function wilson(hits: number, total: number): Interval {
  if (total === 0) {
    return { low: 0, high: 1 };
  }
  const share = hits / total;
  const z2 = Z_95 ** 2;
  const centre = (share + z2 / (2 * total)) / (1 + z2 / total);
  const half =
    (Z_95 * Math.sqrt((share * (1 - share)) / total + z2 / (4 * total ** 2))) / (1 + z2 / total);
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

function logFactorials(upTo: number): number[] {
  const logs = [0];
  for (let at = 1; at <= upTo; at += 1) {
    logs.push((logs[at - 1] ?? 0) + Math.log(at));
  }
  return logs;
}

export interface Counts {
  hits: number;
  misses: number;
}

export function fisherTwoSided(first: Counts, second: Counts): number {
  const a = first.hits;
  const b = first.misses;
  const c = second.hits;
  const d = second.misses;
  const total = a + b + c + d;
  const logs = logFactorials(total);
  const log = (n: number) => logs[n] ?? 0;
  const firstRow = a + b;
  const secondRow = c + d;
  const firstColumn = a + c;
  const logP = (x: number) =>
    log(firstRow) +
    log(secondRow) +
    log(firstColumn) +
    log(total - firstColumn) -
    log(total) -
    log(x) -
    log(firstRow - x) -
    log(firstColumn - x) -
    log(secondRow - firstColumn + x);
  const observed = logP(a);
  const low = Math.max(0, firstColumn - secondRow);
  const high = Math.min(firstRow, firstColumn);
  let sum = 0;
  for (let x = low; x <= high; x += 1) {
    const here = logP(x);
    if (here <= observed + EQUAL_TOLERANCE) {
      sum += Math.exp(here);
    }
  }
  return Math.min(1, sum);
}
