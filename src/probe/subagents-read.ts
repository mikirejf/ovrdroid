import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { MS_PER_SECOND, say } from '../cli.ts';
import type { HeapRow } from './heap.ts';
import { formatHeapSummary, parseHeap, summariseHeap, typeGrowth } from './heap.ts';
import { parseLag } from './lag.ts';
import type { Tick } from './sampler.ts';
import { formatSummary, parseSamples, summariseTicks } from './sampler.ts';
import { formatLagPhases, readLagPhases } from './subagents-lag.ts';
import type { RunRecord, Timeline } from './subagents-record.ts';
import { describeWork, parseRecord, serialiseRecord, timelineOf } from './subagents-record.ts';
import {
  AFTER_LAST_MS,
  formatHeapPhases,
  formatRun,
  perSubagent,
  readHeapPhases,
  readRun,
} from './subagents.ts';

export type { RunRecord };

export const TIMELINE_FILE = 'timeline.json';
export const BEFORE_MS = 10_000;
export const END_MARGIN_MS = 2000;

function failEmpty(): never {
  throw new Error('the sampler recorded nothing');
}

interface HeapReport {
  heapFile: string;
  pid: number;
  count: number;
}

function describeHeap(report: HeapReport, timeline: Timeline): string {
  const log = parseHeap(readFileSync(report.heapFile, 'utf-8'));
  const endMs = timeline.doneMs + AFTER_LAST_MS + END_MARGIN_MS;
  const rowsOf = (pid: number): HeapRow[] =>
    (log.series.get(pid) ?? []).filter((row) => row.t <= endMs);
  const rows = rowsOf(report.pid);
  const first = rows.at(0);
  const summary = summariseHeap(rows, BEFORE_MS);
  if (first === undefined || summary === undefined) {
    return 'no heap rows: was the binary built with --heap?';
  }

  const { count } = report;
  const beforeReply = { fromMs: timeline.sendMs, toMs: timeline.doneMs - MS_PER_SECOND };
  const afterFinish = {
    fromMs: timeline.sendMs,
    toMs: timeline.doneMs + AFTER_LAST_MS - MS_PER_SECOND,
  };
  const childPids = [...log.series.keys()].filter((pid) => pid !== report.pid);
  const children = childPids.flatMap((pid) => {
    const childRows = rowsOf(pid);
    const childFirst = childRows.at(0);
    const childSummary = summariseHeap(childRows, BEFORE_MS);
    return childFirst === undefined || childSummary === undefined
      ? []
      : [formatHeapSummary(childSummary, childFirst.t)];
  });
  return [
    formatHeapPhases(readHeapPhases(rows, timeline), count),
    '',
    'object types that grew from sending to just before the final reply (top 25 types counted):',
    perSubagent(typeGrowth(rows, beforeReply), count),
    '',
    'object types still grown after the subagents finished:',
    perSubagent(typeGrowth(rows, afterFinish), count),
    '',
    'parent process, heap rows up to the end of the measured window',
    formatHeapSummary(summary, first.t),
    ...(children.length === 0
      ? [
          'no other process wrote heap rows: the subagents did not run as separate heap-build processes',
        ]
      : [
          '',
          `${children.length} other processes wrote heap rows into the same file (the subagents run as child processes of this build):`,
          ...children,
        ]),
    ...log.snapshots.map(
      (file) =>
        `snapshot (Chrome DevTools, Memory tab): ${file.file}${file.ms === undefined ? '' : ` (${file.ms}ms to write)`}`,
    ),
  ].join('\n');
}

function describeLag(lagFile: string, pid: number, timeline: Timeline): string {
  const rows = parseLag(readFileSync(lagFile, 'utf-8')).series.get(pid) ?? [];
  return rows.length === 0
    ? 'no lag rows from the parent process: was the binary built with --lag?'
    : formatLagPhases(readLagPhases(rows, timeline));
}

interface ReportInput {
  ticks: readonly Tick[];
  record: RunRecord;
  heapFile: string | undefined;
  lagFile: string | undefined;
}

export function printReport(input: ReportInput): void {
  const { ticks, record, heapFile, lagFile } = input;
  const timeline = timelineOf(ticks, record);
  say('');
  say(`${record.count} x ${record.type}, each ${describeWork(record)}`);
  say(formatRun(readRun(ticks, timeline, record.count), record.work));
  say('');
  say(
    heapFile === undefined
      ? 'whole sampled window'
      : 'whole sampled window (the baseline snapshot is inside it)',
  );
  say(formatSummary(summariseTicks(ticks) ?? failEmpty()));
  const pid = ticks.at(0)?.root ?? failEmpty();
  if (lagFile !== undefined) {
    say('');
    say(describeLag(lagFile, pid, timeline));
  }
  if (heapFile !== undefined) {
    say('');
    say(describeHeap({ heapFile, pid, count: record.count }, timeline));
  }
}

export function subagentsRead(dir: string): void {
  const ticksFile = path.join(dir, 'ticks.jsonl');
  const heapFile = path.join(dir, 'heap.jsonl');
  const lagFile = path.join(dir, 'lag.jsonl');
  const ticks = parseSamples(readFileSync(ticksFile, 'utf-8'));
  const record = parseRecord(readFileSync(path.join(dir, TIMELINE_FILE), 'utf-8'));
  printReport({
    ticks,
    record,
    heapFile: existsSync(heapFile) ? heapFile : undefined,
    lagFile: existsSync(lagFile) ? lagFile : undefined,
  });
}

export function saveRecord(dir: string, record: RunRecord): void {
  writeFileSync(path.join(dir, TIMELINE_FILE), serialiseRecord(record));
}
