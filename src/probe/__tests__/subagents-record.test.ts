import { describe, expect, test } from 'bun:test';

import type { Tick } from '../sampler.ts';
import {
  activeSpan,
  describeWork,
  parseRecord,
  serialiseRecord,
  timelineOf,
} from '../subagents-record.ts';
import { formatRun, readRun } from '../subagents.ts';

const MB = 1024;
const SEND = 20_000;
const DONE = 50_000;

function tickAt(atMs: number): Tick {
  return {
    atMs,
    root: 1,
    threads: 20,
    processes: [{ pid: 1, ppid: 0, cpuMs: atMs, rssKib: 300 * MB, command: 'droid' }],
  };
}

function steadyTicks(): Tick[] {
  return Array.from({ length: 91 }, (_, second) => tickAt(second * 1000));
}

describe('activeSpan finds when the sleep commands were running', () => {
  const SLEEP = 14;
  const run = { sendMs: SEND, doneMs: DONE, sleep: SLEEP, work: 'sleep' } as const;
  const shell = (pid: number, command: string) => ({
    pid,
    ppid: 1,
    cpuMs: 0,
    rssKib: 2 * MB,
    command,
  });

  const inProcess = steadyTicks().map((entry) => {
    if (entry.atMs >= 30_000 && entry.atMs <= 44_000) {
      entry.processes.push(shell(2, `sleep ${SLEEP}`), shell(3, `sleep ${SLEEP}`));
    }
    if (entry.atMs === 25_000) {
      entry.processes.push(shell(9, 'sleep 2'));
    }
    return entry;
  });

  const outOfProcess = steadyTicks().map((entry) => {
    if (entry.atMs >= 28_000 && entry.atMs <= 46_000) {
      entry.processes.push({
        pid: 2,
        ppid: 1,
        cpuMs: 0,
        rssKib: 100 * MB,
        command: 'droid exec',
      });
    }
    if (entry.atMs >= 32_000 && entry.atMs <= 44_000) {
      entry.processes.push({ pid: 3, ppid: 2, cpuMs: 0, rssKib: 2 * MB, command: 'sleep 14' });
    }
    return entry;
  });

  test('in-process subagents, with only small shell children, are found', () => {
    expect(activeSpan(inProcess, run)).toEqual({ fromMs: 30_000, toMs: 44_000 });
  });

  test('out-of-process subagents are found by their sleep command too', () => {
    expect(activeSpan(outOfProcess, run)).toEqual({ fromMs: 32_000, toMs: 44_000 });
  });

  test('a sleep with another duration does not count', () => {
    expect(activeSpan(inProcess, { ...run, sleep: 2 })).toEqual({ fromMs: 25_000, toMs: 25_000 });
  });

  test('without a sleep command the whole wait is used', () => {
    expect(activeSpan(steadyTicks(), run)).toEqual({ fromMs: SEND, toMs: DONE });
  });

  test('running figures are read in that span', () => {
    const running = activeSpan(inProcess, run);
    const reading = readRun(inProcess, { sendMs: SEND, doneMs: DONE, running, excluded: [] }, 2);
    expect(reading.aliveSeconds).toBe(14);
    expect(reading.childRss?.running).toBe(4 * MB);
    expect(formatRun(reading, 'sleep')).toContain(
      "the subagents' sleep commands were running for 14s",
    );
  });
});

describe('in read mode the running span is the whole wait', () => {
  const run = { sendMs: SEND, doneMs: DONE, sleep: 0, work: 'read' } as const;
  const withSleep = steadyTicks().map((entry) => {
    if (entry.atMs >= 30_000 && entry.atMs <= 44_000) {
      entry.processes.push({ pid: 2, ppid: 1, cpuMs: 0, rssKib: MB, command: 'sleep 0' });
    }
    return entry;
  });

  test('it runs from sending to the final reply, whatever the processes are', () => {
    expect(activeSpan(withSleep, run)).toEqual({ fromMs: SEND, toMs: DONE });
  });

  test('the report says so instead of naming sleep commands', () => {
    const timeline = {
      sendMs: SEND,
      doneMs: DONE,
      running: activeSpan(withSleep, run),
      excluded: [],
    };
    const text = formatRun(readRun(withSleep, timeline, 2), 'read');
    expect(text).toContain('read mode has no sleep command');
    expect(text).toContain('all 30s from sending to the final reply');
  });

  test('the work is described in words', () => {
    expect(describeWork(run)).toBe('read the same files and summarised them');
    expect(describeWork({ work: 'sleep', sleep: 30 })).toBe('ran `sleep 30`');
  });
});

describe('the run record round-trips through timeline.json', () => {
  const record = {
    sendMs: SEND,
    doneMs: DONE,
    excluded: [{ fromMs: 1000, toMs: 5000 }],
    count: 4,
    work: 'read' as const,
    sleep: 0,
    type: 'grunt',
  };

  test('what was written is read back', () => {
    expect(parseRecord(serialiseRecord(record))).toEqual(record);
  });

  test('a file that is not a record is refused', () => {
    expect(() => parseRecord('{"sendMs": 1}')).toThrow('not a subagents run record');
  });

  test('a record without a work mode is refused', () => {
    const { work: _work, ...without } = record;
    expect(() => parseRecord(JSON.stringify(without))).toThrow('not a subagents run record');
  });

  test('a read record keeps its mode when read back', () => {
    expect(parseRecord(serialiseRecord(record)).work).toBe('read');
  });

  test('the timeline is rebuilt from the ticks and the record', () => {
    const ticks = steadyTicks();
    expect(timelineOf(ticks, record)).toEqual({
      sendMs: SEND,
      doneMs: DONE,
      excluded: record.excluded,
      running: { fromMs: SEND, toMs: DONE },
    });
  });
});
