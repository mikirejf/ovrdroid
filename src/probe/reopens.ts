import { isoDate, whole } from '../cli.ts';
import type { Fields } from './fields.ts';
import { fieldsOf, isObject, numberAt, worded } from './fields.ts';
import { groupBy, sumBy } from './logs.ts';

const MS_PER_MINUTE = 60_000;
const PERCENT = 100;
const PERCENT_DIGITS = 1;
const GAP_DIGITS = 1;
const SHORT_ID_CHARS = 8;
const FULL_RATIO = 0.9;
const PREFIX_FLOOR_TOKENS = 1000;
const SETUP_WINDOW_MS = 10 * MS_PER_MINUTE;
const SETUP_SLACK_TOKENS = 500;
const FAMILY_WIDTH = 18;
const CELL_WIDTH = 8;
const RESUME_MARK = '"hookMatcher":"resume"';
const CUSTOM_PREFIX = 'custom:droidproxy:';
const VERSION_SEGMENT = /^[\d.]+$/u;
const CLAUDE_NAMES = new Set(['claude', 'opus', 'sonnet', 'haiku', 'fable']);
const NO_CELL = '-';

export const MIN_GAP_MINUTES = 1;
export const MAX_GAP_MINUTES = 60;

export const GAP_BUCKETS: readonly { label: string; below: number }[] = [
  { label: '0-5', below: 5 },
  { label: '5-10', below: 10 },
  { label: '10-20', below: 20 },
  { label: '20-40', below: 40 },
  { label: '40-60', below: Number.POSITIVE_INFINITY },
];

export const REOPEN_CLASSES = ['full', 'partial', 'none'] as const;

export type ReopenClass = (typeof REOPEN_CLASSES)[number];

const CLASS_MEANING: Record<ReopenClass, string> = {
  full: 'read the whole history from the cache',
  partial: 'read part of the prompt from the cache, not the whole history',
  none: 'read almost nothing',
};

export interface UsageRow {
  at: number;
  sessionId: string;
  model: string;
  input: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ResumeMarker {
  sessionId: string;
  at: number;
  file: string;
  line: number;
}

export interface Reopen {
  marker: ResumeMarker;
  model: string;
  previousTotal: number;
  cacheRead: number;
  gapMinutes: number;
  ratio: number;
  class: ReopenClass;
  setupChanged: boolean;
  crossedMidnight: boolean;
}

export const MISS_CAUSES = ['crossed midnight', 'setup changed', 'unexplained'] as const;

export type MissCause = (typeof MISS_CAUSES)[number];

const CAUSE_NOTE: Record<MissCause, string | undefined> = {
  'crossed midnight':
    "crossed local midnight: the proxy's date note changed, so the history after it was rewritten",
  'setup changed':
    'read the same as sessions started then: the setup changed since the live process started',
  unexplained: undefined,
};

interface Context {
  firsts: readonly UsageRow[];
  dayOf: (at: number) => string;
}

export interface FamilyTally {
  family: string;
  full: number[];
  total: number[];
}

function fieldsOfLine(line: string): Fields | undefined {
  try {
    const parsed: unknown = JSON.parse(line);
    return isObject(parsed) ? fieldsOf(parsed) : undefined;
  } catch {
    return undefined;
  }
}

export function parseUsageLine(line: string): UsageRow | undefined {
  const fields = fieldsOfLine(line);
  if (fields === undefined) {
    return undefined;
  }
  const at = numberAt(fields, 't');
  const input = numberAt(fields, 'in');
  const cacheRead = numberAt(fields, 'cr');
  const cacheWrite = numberAt(fields, 'cw');
  const sessionId = worded(fields, 's');
  if (
    at === undefined ||
    input === undefined ||
    cacheRead === undefined ||
    cacheWrite === undefined ||
    sessionId === ''
  ) {
    return undefined;
  }
  return { at, sessionId, model: worded(fields, 'm'), input, cacheRead, cacheWrite };
}

export function parseResumeAt(line: string): number | undefined {
  const fields = fieldsOfLine(line);
  if (fields === undefined) {
    return undefined;
  }
  const message = fieldsOf(fields.get('message'));
  if (worded(message, 'hookEventName') !== 'SessionStart') {
    return undefined;
  }
  if (worded(message, 'hookMatcher') !== 'resume') {
    return undefined;
  }
  const at = Date.parse(worded(fields, 'timestamp'));
  return Number.isNaN(at) ? undefined : at;
}

export function resumeMarkersOf(sessionId: string, file: string, text: string): ResumeMarker[] {
  if (!text.includes(RESUME_MARK)) {
    return [];
  }
  const markers: ResumeMarker[] = [];
  for (const [index, line] of text.split('\n').entries()) {
    const at = line.includes(RESUME_MARK) ? parseResumeAt(line) : undefined;
    if (at !== undefined) {
      markers.push({ sessionId, at, file, line: index + 1 });
    }
  }
  return markers;
}

function nameOf(model: string): string {
  return model.startsWith(CUSTOM_PREFIX) ? model.slice(CUSTOM_PREFIX.length) : model;
}

export function familyOf(model: string): string {
  const words = nameOf(model)
    .split('-')
    .filter((segment) => !VERSION_SEGMENT.test(segment));
  return words.length === 0 ? model : words.join('-');
}

export function providerOf(model: string): string {
  const [first = ''] = nameOf(model).split('-');
  return CLAUDE_NAMES.has(first) ? 'claude' : first;
}

export function classOf(ratio: number, cacheRead: number): ReopenClass {
  if (ratio >= FULL_RATIO) {
    return 'full';
  }
  return cacheRead > PREFIX_FLOOR_TOKENS ? 'partial' : 'none';
}

function byTime(left: { at: number }, right: { at: number }): number {
  return left.at - right.at;
}

function bucketIndexOf(gapMinutes: number): number {
  return GAP_BUCKETS.findIndex((bucket) => gapMinutes < bucket.below);
}

function setupChangedAt(next: UsageRow, firsts: readonly UsageRow[]): boolean {
  return firsts.some(
    (first) =>
      first.sessionId !== next.sessionId &&
      first.cacheRead > 0 &&
      Math.abs(first.at - next.at) <= SETUP_WINDOW_MS &&
      Math.abs(first.cacheRead - next.cacheRead) <= SETUP_SLACK_TOKENS &&
      providerOf(first.model) === providerOf(next.model),
  );
}

export function causeOf(reopen: Reopen): MissCause {
  if (reopen.crossedMidnight) {
    return 'crossed midnight';
  }
  return reopen.setupChanged ? 'setup changed' : 'unexplained';
}

function dayIn(timeZone: string): (at: number) => string {
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return (at) => format.format(at);
}

function reopenOf(
  marker: ResumeMarker,
  rows: readonly UsageRow[],
  context: Context,
): { reopen: Reopen; previous: UsageRow } | undefined {
  const previous = rows.findLast((row) => row.at <= marker.at);
  const next = rows.find((row) => row.at > marker.at);
  if (previous === undefined || next === undefined) {
    return undefined;
  }
  const gapMinutes = (next.at - previous.at) / MS_PER_MINUTE;
  if (gapMinutes < MIN_GAP_MINUTES || gapMinutes > MAX_GAP_MINUTES) {
    return undefined;
  }
  const previousTotal = previous.input + previous.cacheRead + previous.cacheWrite;
  const ratio = previousTotal === 0 ? 0 : next.cacheRead / previousTotal;
  return {
    previous,
    reopen: {
      marker,
      model: next.model,
      previousTotal,
      cacheRead: next.cacheRead,
      gapMinutes,
      ratio,
      class: classOf(ratio, next.cacheRead),
      setupChanged: setupChangedAt(next, context.firsts),
      crossedMidnight:
        providerOf(next.model) === 'claude' &&
        context.dayOf(previous.at) !== context.dayOf(next.at),
    },
  };
}

export function findReopens(
  usage: readonly UsageRow[],
  markers: readonly ResumeMarker[],
  timeZone: string,
): Reopen[] {
  const sessions = groupBy(usage.toSorted(byTime), (row) => row.sessionId);
  const context: Context = {
    firsts: [...sessions.values()].flatMap((rows) => rows.slice(0, 1)),
    dayOf: dayIn(timeZone),
  };
  const counted = new Set<UsageRow>();
  const reopens: Reopen[] = [];

  for (const marker of markers.toSorted(byTime)) {
    const found = reopenOf(marker, sessions.get(marker.sessionId) ?? [], context);
    if (found !== undefined && !counted.has(found.previous)) {
      counted.add(found.previous);
      reopens.push(found.reopen);
    }
  }
  return reopens;
}

export function tallyFamilies(reopens: readonly Reopen[]): FamilyTally[] {
  const tallies: FamilyTally[] = [];
  for (const [family, group] of groupBy(reopens, (reopen) => familyOf(reopen.model))) {
    const tally: FamilyTally = {
      family,
      full: GAP_BUCKETS.map(() => 0),
      total: GAP_BUCKETS.map(() => 0),
    };
    for (const reopen of group) {
      const index = bucketIndexOf(reopen.gapMinutes);
      tally.total[index] = (tally.total[index] ?? 0) + 1;
      tally.full[index] = (tally.full[index] ?? 0) + (reopen.class === 'full' ? 1 : 0);
    }
    tallies.push(tally);
  }
  return tallies.toSorted((left, right) => left.family.localeCompare(right.family));
}

function cell(full: number, total: number): string {
  return (total === 0 ? NO_CELL : `${full}/${total}`).padStart(CELL_WIDTH);
}

function tableRow(family: string, full: readonly number[], total: readonly number[]): string {
  const cells = GAP_BUCKETS.map((_bucket, index) => cell(full[index] ?? 0, total[index] ?? 0));
  const all = cell(
    sumBy(full, (value) => value),
    sumBy(total, (value) => value),
  );
  return `${family.padEnd(FAMILY_WIDTH)}${cells.join('')}${all}`;
}

function tableLines(reopens: readonly Reopen[]): string[] {
  const tallies = tallyFamilies(reopens);
  const head = `${'family'.padEnd(FAMILY_WIDTH)}${GAP_BUCKETS.map((bucket) => bucket.label.padStart(CELL_WIDTH)).join('')}${'all'.padStart(CELL_WIDTH)}`;
  const sumColumn = (pick: (tally: FamilyTally) => number[]): number[] =>
    GAP_BUCKETS.map((_bucket, index) => sumBy(tallies, (tally) => pick(tally)[index] ?? 0));
  return [
    'reads of the full history / reopens, by model family and by minutes between the last request before the reopen and the first one after it:',
    head,
    ...tallies.map((tally) => tableRow(tally.family, tally.full, tally.total)),
    tableRow(
      'all',
      sumColumn((tally) => tally.full),
      sumColumn((tally) => tally.total),
    ),
  ];
}

function missLines(reopen: Reopen): string[] {
  const { marker } = reopen;
  const cause = CAUSE_NOTE[causeOf(reopen)];
  const notes = [CLASS_MEANING[reopen.class]];
  if (cause !== undefined) {
    notes.push(cause);
  }
  return [
    [
      isoDate(marker.at),
      marker.sessionId.slice(0, SHORT_ID_CHARS),
      reopen.model,
      `gap ${reopen.gapMinutes.toFixed(GAP_DIGITS)} min`,
      `read ${whole(reopen.cacheRead)} of ${whole(reopen.previousTotal)}`,
      reopen.class,
    ].join('  '),
    `  ${notes.join('; ')}`,
    `  ${marker.file}:${marker.line}`,
  ];
}

function causeLine(misses: readonly Reopen[]): string {
  const counts = MISS_CAUSES.map(
    (cause) => `${cause} ${misses.filter((miss) => causeOf(miss) === cause).length}`,
  );
  return `misses by cause: ${counts.join(', ')}`;
}

export function summariseReopens(reopens: readonly Reopen[], timeZone: string): string {
  const full = reopens.filter((reopen) => reopen.class === 'full').length;
  const percent = reopens.length === 0 ? 0 : (full / reopens.length) * PERCENT;
  const misses = reopens
    .filter((reopen) => reopen.class !== 'full')
    .toSorted((left, right) => right.marker.at - left.marker.at);

  return [
    `${whole(reopens.length)} reopens, ${whole(full)} read the full history (${percent.toFixed(PERCENT_DIGITS)}%)`,
    causeLine(misses),
    `a reopen counts when the first request after it came ${MIN_GAP_MINUTES} to ${MAX_GAP_MINUTES} minutes after the last one before it`,
    `crossed midnight: on a Claude model, the last request before the reopen and the first one after it fell on different days in ${timeZone}`,
    `full: it read at least ${FULL_RATIO * PERCENT}% of what the last request before the reopen held`,
    `partial: it read more than ${whole(PREFIX_FLOOR_TOKENS)} tokens but under that share: ${CLASS_MEANING.partial}`,
    `none: it read ${whole(PREFIX_FLOOR_TOKENS)} tokens or fewer`,
    '',
    ...tableLines(reopens),
    '',
    misses.length === 0 ? 'reopens that missed: none' : 'reopens that missed, newest first:',
    ...misses.flatMap((reopen) => missLines(reopen)),
  ].join('\n');
}
