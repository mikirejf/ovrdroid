import { describe, expect, test } from 'bun:test';

import { parseArms, parseTasks, planSets } from '../task-ab-plan.ts';

const OPUS = 'custom:droidproxy:opus-5-5';
const ON = { label: 'direct-on', binary: '/tmp/a' };
const OFF = { label: 'direct-off', binary: '/tmp/b' };

describe('parseArms', () => {
  test('labels a binary by its file name unless given label=path', () => {
    expect(parseArms(['/tmp/droid-x', 'pure=/tmp/droid-y'])).toEqual([
      { label: 'droid-x', binary: '/tmp/droid-x' },
      { label: 'pure', binary: '/tmp/droid-y' },
    ]);
  });

  test('refuses two binaries with the same label', () => {
    expect(() => parseArms(['/a/droid', '/b/droid'])).toThrow('both called "droid"');
  });
});

describe('parseTasks', () => {
  test('defaults to every task and refuses an unknown one', () => {
    expect(parseTasks()).toEqual(['chain', 'callers', 'explore', 'fix']);
    expect(parseTasks(['fix'])).toEqual(['fix']);
    expect(() => parseTasks(['nope'])).toThrow('unknown task "nope"');
  });
});

describe('planSets', () => {
  const sets = planSets({
    arms: [ON, OFF],
    models: [OPUS, 'm2'],
    tasks: ['chain', 'fix'],
    reps: 2,
  });

  test('makes one set per repetition and task, in that order', () => {
    expect(sets.map((set) => `${set[0]?.rep} ${set[0]?.task}`)).toEqual([
      '1 chain',
      '1 fix',
      '2 chain',
      '2 fix',
    ]);
  });

  test('puts every model and binary in each set', () => {
    for (const set of sets) {
      expect(set).toHaveLength(4);
      expect(new Set(set.map((job) => `${job.model} ${job.arm.label}`)).size).toBe(4);
    }
  });

  test('alternates which binary starts, so a parallel cap spares neither arm', () => {
    const starts = sets.map((set) => set.map((job) => job.arm.label).slice(0, 2));
    expect(starts[0]).toEqual(starts[1]?.toReversed());
    expect(starts[0]).not.toEqual(starts[1]);
  });
});
