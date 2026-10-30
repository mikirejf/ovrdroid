import { quantile } from './ab.ts';
import { plural } from './renders-print.ts';
import { shortModel } from './reopens.ts';
import { sumOf } from './series.ts';
import type { RunRow } from './task-ab-rows.ts';
import { emptyCounts } from './task-ab-transcript.ts';
import type { TranscriptCounts } from './task-ab-transcript.ts';

const MEDIAN = 0.5;
const COST_DECIMALS = 4;
const SECOND_DECIMALS = 1;

export const COST_NOTE =
  'cost: dollars from the models.dev price table (see `probe prices`) applied to the token usage `droid exec` reports for the session, with every cache write priced as a 1 hour write because DroidProxy forces 1h';

export interface Totals {
  runs: number;
  errored: number;
  correct: number;
  requests: number[];
  seconds: number[];
  costUsd: number | null;
  counts: TranscriptCounts;
}

interface Group {
  model: string;
  arm: string;
  rows: RunRow[];
}

function plainNumber(value: number): string {
  return String(Number(value.toFixed(SECOND_DECIMALS)));
}

function dollars(value: number | null): string {
  if (value === null) {
    return 'price unknown';
  }
  return `$${value.toFixed(COST_DECIMALS)}`;
}

function isCountKey(key: string): key is keyof TranscriptCounts {
  return Object.hasOwn(emptyCounts(), key);
}

function countsOf(rows: readonly RunRow[]): TranscriptCounts {
  const counts = emptyCounts();
  for (const row of rows) {
    for (const key of Object.keys(counts).filter((name) => isCountKey(name))) {
      counts[key] += row[key];
    }
  }
  return counts;
}

export function totalsOf(rows: readonly RunRow[]): Totals {
  const finished = rows.filter((row) => row.error === null);
  return {
    runs: rows.length,
    errored: rows.length - finished.length,
    correct: finished.filter((row) => row.correct).length,
    requests: finished.map((row) => row.requests),
    seconds: finished.map((row) => row.seconds),
    costUsd: rows.some((row) => row.costUsd === null)
      ? null
      : sumOf(finished.map((row) => row.costUsd ?? 0)),
    counts: countsOf(finished),
  };
}

function costText(totals: Totals): string {
  if (totals.costUsd === null) {
    return 'price unknown';
  }
  const scope =
    totals.errored === 0
      ? 'in total'
      : `over the ${plural(totals.runs - totals.errored, 'finished run')}`;
  return `${dollars(totals.costUsd)} ${scope}`;
}

function median(values: readonly number[]): string {
  return values.length === 0 ? 'n/a' : plainNumber(quantile(values, MEDIAN));
}

function groupsOf(rows: readonly RunRow[]): Group[] {
  const groups: Group[] = [];
  for (const row of rows) {
    const known = groups.find((group) => group.model === row.model && group.arm === row.arm);
    if (known === undefined) {
      groups.push({ model: row.model, arm: row.arm, rows: [row] });
    } else {
      known.rows.push(row);
    }
  }
  return groups;
}

function nameOf(group: Group): string {
  return `${shortModel(group.model)}, ${group.arm}`;
}

function who(row: RunRow): string {
  return `rep ${row.rep} ${row.task}, ${shortModel(row.model)}, ${row.arm}`;
}

function noResult(error: string): string {
  return `no result: ${error}`;
}

export function describeTotals(name: string, totals: Totals): string {
  const { counts } = totals;
  const lost =
    totals.errored === 0
      ? ''
      : `; ${plural(totals.errored, 'run')} without a result, counted as wrong`;
  return [
    `${name}: ${totals.correct}/${totals.runs} correct, `,
    `${plural(sumOf(totals.requests), 'request')} (median ${median(totals.requests)} per run), `,
    `${costText(totals)}, median ${median(totals.seconds)}s per run; `,
    `${plural(counts.directReadGrep, 'direct Read/Grep call')}, `,
    `${plural(counts.scripts, 'Script call')}, `,
    `${plural(counts.nested, 'call')} made inside Scripts, `,
    `${plural(counts.toolErrors, 'failed tool call')}, `,
    `${plural(counts.directOnlyRequests, 'request')} that made only direct Read/Grep/TodoWrite calls`,
    lost,
  ].join('');
}

function describeTask(task: string, group: Group): string {
  const totals = totalsOf(group.rows);
  return [
    `${task}, ${nameOf(group)}: ${totals.correct}/${totals.runs} correct, `,
    `median ${median(totals.requests)} requests, median ${median(totals.seconds)}s, `,
    costText(totals),
  ].join('');
}

function taskNames(rows: readonly RunRow[]): string[] {
  return [...new Set(rows.map((row) => row.task))];
}

function problemLines(rows: readonly RunRow[]): string[] {
  return rows
    .filter((row) => !row.correct || row.error !== null)
    .map(
      (row) => `${who(row)}: ${row.error === null ? `wrong: ${row.reason}` : noResult(row.error)}`,
    );
}

export function describeRun(row: RunRow): string {
  if (row.error !== null) {
    return `${who(row)}: ${noResult(row.error)}`;
  }
  const verdict = row.correct ? 'correct' : `WRONG (${row.reason})`;
  return `${who(row)}: ${verdict}; ${plural(row.requests, 'request')}, ${plainNumber(row.seconds)}s, ${dollars(row.costUsd)}`;
}

export function reportLines(rows: readonly RunRow[]): string[] {
  if (rows.length === 0) {
    return ['no runs to report'];
  }
  const groups = groupsOf(rows);
  const problems = problemLines(rows);
  return [
    `${plural(rows.length, 'run')}, per model and binary:`,
    ...groups.map((group) => `  ${describeTotals(nameOf(group), totalsOf(group.rows))}`),
    '',
    'per task:',
    ...taskNames(rows).flatMap((task) =>
      groupsOf(rows.filter((row) => row.task === task)).map(
        (group) => `  ${describeTask(task, group)}`,
      ),
    ),
    '',
    problems.length === 0
      ? 'every run answered correctly'
      : 'runs that were wrong or gave no result:',
    ...problems.map((line) => `  ${line}`),
    '',
    COST_NOTE,
  ];
}
