import { describe, expect, test } from 'bun:test';

import type { JsonObject } from '../bodies.ts';
import { INLINE_TOOLS_BETA } from '../compaction-replay-bodies.ts';
import { ARMS, compactionRows, isArm, planJobs } from '../compaction-replay-plan.ts';
import { askText, pick, reuseBody, stockCaptured } from './compaction-replay-harness.ts';

const PLAIN: JsonObject = { model: 'm', system: [], messages: [] };

function line(body: JsonObject): string {
  return JSON.stringify({
    t: 1,
    sessionId: 's',
    assistantMessageId: 'm',
    route: 'anthropic',
    body,
  });
}

describe('compactionRows reads a bodies file that may still be growing', () => {
  test('rows keep their 0-based line numbers, blank lines included', () => {
    const rows = compactionRows(`${line(reuseBody())}\n\n${line(stockCaptured())}\n`);
    expect(rows.map((entry) => entry.index)).toEqual([0, 2]);
  });

  test('a half-written last line is skipped', () => {
    expect(compactionRows(`${line(reuseBody())}\n{"t":1,"body":{"mod`)).toHaveLength(1);
  });

  test('a broken line in the middle is an error', () => {
    expect(() => compactionRows(`{"t":1,\n${line(reuseBody())}`)).toThrow();
  });
});

describe('planJobs picks rows and arms', () => {
  const rows = compactionRows([line(PLAIN), line(reuseBody()), line(stockCaptured())].join('\n'));

  const names = (runs: number, arms?: readonly (typeof ARMS)[number][]): string[] =>
    planJobs(rows, { runs, arms }).jobs.map((job) => `${job.row}:${job.arm}:${job.run}`);

  test('by default a reuse row gets every arm and a stock row only its own request', () => {
    const jobs = names(1);
    expect(jobs.filter((job) => job.startsWith('1:')).toSorted()).toEqual([
      '1:no-claim:1',
      '1:no-mention:1',
      '1:reuse:1',
      '1:stock:1',
      '1:system:1',
    ]);
    expect(jobs.filter((job) => job.startsWith('2:'))).toEqual(['2:stock-captured:1']);
  });

  test('--arms limits the arms, runs repeat them, and the stock row is still replayed', () => {
    const jobs = names(2, ['reuse', 'system']);
    expect(jobs.filter((job) => job.startsWith('1:')).toSorted()).toEqual([
      '1:reuse:1',
      '1:reuse:2',
      '1:system:1',
      '1:system:2',
    ]);
    expect(jobs.filter((job) => job.startsWith('2:'))).toEqual([
      '2:stock-captured:1',
      '2:stock-captured:2',
    ]);
  });

  test('the arm order rotates so no arm always goes first', () => {
    const { jobs } = planJobs(rows, { runs: 5, rows: [1] });
    const firsts = [1, 2, 3, 4, 5].map((run) => jobs.find((job) => job.run === run)?.arm);
    expect(new Set(firsts).size).toBe(ARMS.length);
  });

  test('every request is sent without streaming', () => {
    const plan = planJobs(rows, { runs: 1 });
    expect([...plan.warmups, ...plan.jobs].every((job) => job.body['stream'] === false)).toBe(true);
  });

  test('the reuse arm sends the captured body, tools included', () => {
    const job = planJobs(rows, { runs: 1, rows: [1] }).jobs.find((entry) => entry.arm === 'reuse');
    expect(pick(job?.body, 'tools')).toEqual([{ name: 'Read' }]);
    expect(job?.headers).toEqual({});
  });

  test('only the system arm carries the tool-removal beta header', () => {
    const { jobs } = planJobs(rows, { runs: 1, rows: [1] });
    const withHeader = jobs.filter((job) => Object.keys(job.headers).length > 0);
    expect(withHeader.map((job) => job.arm)).toEqual(['system']);
    expect(withHeader[0]?.headers).toEqual({ 'anthropic-beta': INLINE_TOOLS_BETA });
  });

  test('each row is warmed once, with the body as recorded, before the run', () => {
    const { warmups } = planJobs(rows, { runs: 3 });
    expect(warmups.map((job) => `${job.row}:${job.arm}:${job.warm}`)).toEqual([
      '1:reuse:true',
      '2:stock-captured:true',
    ]);
    expect(pick(warmups[0]?.body, 'messages', 3, 'content', 0, 'text')).toBe(
      pick(reuseBody(), 'messages', 3, 'content', 0, 'text'),
    );
  });

  test('--rows limits the replay and refuses a row that is not a compaction', () => {
    expect(planJobs(rows, { runs: 1, rows: [2] }).jobs.map((job) => job.arm)).toEqual([
      'stock-captured',
    ]);
    expect(() => planJobs(rows, { runs: 1, rows: [0] })).toThrow('row 0 is not a compaction');
    expect(() => planJobs(rows, { runs: 1, rows: [9] })).toThrow('row 9 is not a compaction');
  });

  test('a file without compaction rows is an error', () => {
    expect(() => planJobs(compactionRows(line(PLAIN)), { runs: 1 })).toThrow(
      'no compaction request',
    );
  });

  test('a reuse row whose ask is not one text block fails the plan, not the run', () => {
    const content = [
      { type: 'text', text: 'note' },
      { type: 'text', text: askText() },
    ];
    const odd = reuseBody('', [{ role: 'user', content }]);
    expect(() => planJobs(compactionRows(line(odd)), { runs: 1, arms: ['system'] })).toThrow(
      'exactly one text block',
    );
  });
});

describe('isArm', () => {
  test('knows the five arms and the captured stock request', () => {
    expect([...ARMS, 'stock-captured'].every((arm) => isArm(arm))).toBe(true);
    expect(isArm('alt')).toBe(false);
  });
});
