import type { Fields } from './fields.ts';
import { entriesOf, fieldsOfJson, numberAt, worded } from './fields.ts';
import type { Tick } from './sampler.ts';
import type { Span } from './series.ts';

export const WORKS = ['sleep', 'read'] as const;
export type Work = (typeof WORKS)[number];

export interface RunRecord {
  sendMs: number;
  doneMs: number;
  excluded: readonly Span[];
  count: number;
  work: Work;
  sleep: number;
  type: string;
}

export interface Timeline {
  sendMs: number;
  doneMs: number;
  running: Span;
  excluded: readonly Span[];
}

export function sleepCommand(sleep: number): string {
  return `sleep ${sleep}`;
}

export function describeWork(run: Pick<RunRecord, 'work' | 'sleep'>): string {
  return run.work === 'sleep'
    ? `ran \`${sleepCommand(run.sleep)}\``
    : 'read the same files and summarised them';
}

export function activeSpan(
  ticks: readonly Tick[],
  run: Pick<RunRecord, 'sendMs' | 'doneMs' | 'sleep' | 'work'>,
): Span {
  const { sendMs, doneMs, sleep } = run;
  if (run.work === 'read') {
    return { fromMs: sendMs, toMs: doneMs };
  }
  const command = sleepCommand(sleep);
  const alive = ticks.filter(
    (tick) =>
      tick.atMs >= sendMs &&
      tick.atMs <= doneMs &&
      tick.processes.some((process) => process.command === command),
  );
  const first = alive.at(0);
  const last = alive.at(-1);
  return first === undefined || last === undefined
    ? { fromMs: sendMs, toMs: doneMs }
    : { fromMs: first.atMs, toMs: last.atMs };
}

export function timelineOf(ticks: readonly Tick[], record: RunRecord): Timeline {
  return {
    sendMs: record.sendMs,
    doneMs: record.doneMs,
    excluded: record.excluded,
    running: activeSpan(ticks, record),
  };
}

export function serialiseRecord(record: RunRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

function requiredNumber(fields: Fields, name: string): number {
  const value = numberAt(fields, name);
  if (value === undefined) {
    throw new TypeError(`timeline.json: ${name} is not a number`);
  }
  return value;
}

function spanOf(fields: Fields): Span {
  return { fromMs: requiredNumber(fields, 'fromMs'), toMs: requiredNumber(fields, 'toMs') };
}

export function parseRecord(text: string): RunRecord {
  const fields = fieldsOfJson(text);
  const type = worded(fields, 'type');
  const work = WORKS.find((known) => known === worded(fields, 'work'));
  if (type === '' || work === undefined || !Array.isArray(fields.get('excluded'))) {
    throw new TypeError('timeline.json is not a subagents run record');
  }
  return {
    sendMs: requiredNumber(fields, 'sendMs'),
    doneMs: requiredNumber(fields, 'doneMs'),
    excluded: entriesOf(fields, 'excluded').map((entry) => spanOf(entry)),
    count: requiredNumber(fields, 'count'),
    work,
    sleep: requiredNumber(fields, 'sleep'),
    type,
  };
}
