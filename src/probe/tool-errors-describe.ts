import { whole } from '../cli.ts';
import { CAUSES, LEVELS } from './tool-errors.ts';
import type { Cause, Counts, Failure, Group, Level } from './tool-errors.ts';

const PER = 1000;
const LABEL_WIDTH = 30;
const CELL_WIDTH = 18;
const SAMPLES = 3;
const CAUSE_WORDS: Record<Cause, string> = {
  'not-offered': 'tool not offered (Not found)',
  'argument-type': 'argument type',
  'missing-file': 'missing file',
  'changed-since-read': 'file changed since read',
  other: 'other',
};
const LEVEL_WORDS: Record<Level, string> = { top: 'top level', nested: 'inside Script' };

type Tally = [string, Counts][];

function total(counts: Counts): number {
  return counts.top + counts.nested;
}

function tally(failures: readonly Failure[], keys: (failure: Failure) => string[]): Tally {
  const counts = new Map<string, Counts>();
  for (const failure of failures) {
    for (const key of keys(failure)) {
      const found = counts.get(key) ?? { top: 0, nested: 0 };
      found[failure.level] += 1;
      counts.set(key, found);
    }
  }
  return [...counts].toSorted(
    ([leftKey, left], [rightKey, right]) =>
      total(right) - total(left) || leftKey.localeCompare(rightKey),
  );
}

function split(counts: Counts): string {
  return `${whole(counts.top)} top level, ${whole(counts.nested)} inside Script`;
}

function rate(count: number, requests: number): string {
  return requests === 0 ? 'n/a' : ((count * PER) / requests).toFixed(1);
}

function cell(count: number, requests: number): string {
  return `${whole(count)} (${rate(count, requests)})`.padStart(CELL_WIDTH);
}

function table(group: Group): string[] {
  const byCause = new Map(tally(group.failures, (failure) => [failure.cause]));
  const rows = CAUSES.map((cause) => {
    const found = byCause.get(cause) ?? { top: 0, nested: 0 };
    return `  ${CAUSE_WORDS[cause].padEnd(LABEL_WIDTH)}${cell(found.top, group.requests)}${cell(found.nested, group.requests)}`;
  });
  return [
    `  ${'failed calls (per 1,000 requests)'.padEnd(LABEL_WIDTH)}${LEVELS.map((level) => LEVEL_WORDS[level].padStart(CELL_WIDTH)).join('')}`,
    ...rows,
  ];
}

interface Heading {
  cause: Cause;
  header: string;
}

function section(
  failures: readonly Failure[],
  { cause, header }: Heading,
  lines: (found: Failure[]) => string[],
): string[] {
  const found = failures.filter((failure) => failure.cause === cause);
  return found.length === 0 ? [] : [header, ...lines(found)];
}

function tallyLines(found: Failure[], keys: (failure: Failure) => string[]): string[] {
  return tally(found, keys).map(([key, counts]) => `    ${key}: ${split(counts)}`);
}

function names(failures: readonly Failure[]): string[] {
  return section(
    failures,
    { cause: 'not-offered', header: '  tool not offered, by base name:' },
    (found) =>
      tally(found, (failure) => [failure.base]).map(([base, counts]) => {
        const used = tally(
          found.filter((failure) => failure.base === base),
          (failure) => [failure.tool],
        ).filter(([tool]) => tool !== base);
        const as = used.map(([tool, counts_]) => `${tool} x${total(counts_)}`).join(', ');
        return `    ${base}: ${split(counts)}${as === '' ? '' : `  (as ${as})`}`;
      }),
  );
}

function inputs(failures: readonly Failure[]): string[] {
  return section(
    failures,
    { cause: 'argument-type', header: '  argument type, by field (a call can have several):' },
    (found) => tallyLines(found, (failure) => failure.detail),
  );
}

function byTool(failures: readonly Failure[], cause: Cause): string[] {
  return section(failures, { cause, header: `  ${CAUSE_WORDS[cause]}, by tool:` }, (found) =>
    tallyLines(found, (failure) => [failure.tool]),
  );
}

function samples(failures: readonly Failure[]): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const failure of failures.filter((found) => found.cause === 'other')) {
    const text = failure.detail.join(' ');
    const key = `${failure.tool} ${text.replaceAll(/\d+/gu, 'N')}`;
    if (!seen.has(key) && seen.size < SAMPLES) {
      seen.add(key);
      lines.push(`    ${failure.tool}: ${text}`);
    }
  }
  return lines.length === 0 ? [] : ['  other, sample texts:', ...lines];
}

function days(failures: readonly Failure[]): string[] {
  const lines = CAUSES.flatMap((cause) => {
    const found = tally(
      failures.filter((failure) => failure.cause === cause),
      (failure) => [failure.day],
    ).toSorted(([left], [right]) => left.localeCompare(right));
    if (found.length === 0) {
      return [];
    }
    const perDay = found.map(([day, counts]) => `${day} ${counts.top}/${counts.nested}`);
    return [`    ${CAUSE_WORDS[cause]}: ${perDay.join(', ')}`];
  });
  return lines.length === 0 ? [] : ['  per day, top level / inside Script:', ...lines];
}

function describeGroup(group: Group): string[] {
  return [
    `${group.model}, ${group.mode}: ${whole(group.sessions)} sessions`,
    `  top-level requests that made tool calls: ${whole(group.requests)}`,
    `  tool calls: ${split(group.calls)}`,
    ...table(group),
    ...names(group.failures),
    ...byTool(group.failures, 'argument-type'),
    ...inputs(group.failures),
    ...byTool(group.failures, 'missing-file'),
    ...byTool(group.failures, 'changed-since-read'),
    ...byTool(group.failures, 'other'),
    ...samples(group.failures),
    ...days(group.failures),
  ];
}

export function describeToolErrors(groups: readonly Group[]): string {
  if (groups.length === 0) {
    return 'no tool calls in that window for those filters';
  }
  return groups
    .flatMap((group) => [...describeGroup(group), ''])
    .join('\n')
    .trimEnd();
}
