import { describe, expect, test } from 'bun:test';

import type { Phase } from '../schedule.ts';
import { itemsOf, runPhase } from '../schedule.ts';

const STEP_MS = 40;

interface Step {
  name: string;
  ms?: number;
  fails?: boolean;
}

interface Event {
  name: string;
  at: 'start' | 'end';
}

function phaseOf(lanesAtOnce: number, ...lanes: readonly (readonly Step[])[]): Phase<Step> {
  return { name: 'test', lanesAtOnce, lanes: lanes.map((items) => ({ items })) };
}

function recorder() {
  const events: Event[] = [];
  let running = 0;
  let mostAtOnce = 0;
  const run = async (step: Step): Promise<string> => {
    events.push({ name: step.name, at: 'start' });
    running += 1;
    mostAtOnce = Math.max(mostAtOnce, running);
    const child = Bun.spawn(
      step.fails === true ? ['false'] : ['sleep', String((step.ms ?? STEP_MS) / 1000)],
    );
    await child.exited;
    running -= 1;
    events.push({ name: step.name, at: 'end' });
    return `${step.name}:${child.exitCode === 0 ? 'pass' : 'fail'}`;
  };
  return { events, run, mostAtOnce: () => mostAtOnce };
}

function indexOfEvent(events: readonly Event[], name: string, at: Event['at']): number {
  return events.findIndex((event) => event.name === name && event.at === at);
}

describe('runPhase', () => {
  test('runs lanes beside each other up to the cap and no further', async () => {
    const { run, mostAtOnce } = recorder();
    const phase = phaseOf(2, [{ name: 'a' }], [{ name: 'b' }], [{ name: 'c' }], [{ name: 'd' }]);
    await runPhase(phase, run);
    expect(mostAtOnce()).toBe(2);
  });

  test('runs one lane at a time when the cap is one', async () => {
    const { run, mostAtOnce } = recorder();
    await runPhase(phaseOf(1, [{ name: 'a' }], [{ name: 'b' }], [{ name: 'c' }]), run);
    expect(mostAtOnce()).toBe(1);
  });

  test('never runs more lanes than there are', async () => {
    const { run, mostAtOnce } = recorder();
    await runPhase(phaseOf(8, [{ name: 'a' }], [{ name: 'b' }]), run);
    expect(mostAtOnce()).toBe(2);
  });

  test('starts the next lane the moment a slot frees up', async () => {
    const { run, events } = recorder();
    const phase = phaseOf(2, [{ name: 'slow', ms: 400 }], [{ name: 'quick' }], [{ name: 'next' }]);
    await runPhase(phase, run);
    expect(indexOfEvent(events, 'next', 'start')).toBeGreaterThan(
      indexOfEvent(events, 'quick', 'end'),
    );
    expect(indexOfEvent(events, 'next', 'start')).toBeLessThan(indexOfEvent(events, 'slow', 'end'));
  });

  test('runs the checks of one lane one after another, in order', async () => {
    const { run, events } = recorder();
    const phase = phaseOf(
      4,
      [{ name: 'build', ms: 80 }, { name: 'read' }],
      [{ name: 'other', ms: 20 }],
    );
    await runPhase(phase, run);
    expect(indexOfEvent(events, 'read', 'start')).toBeGreaterThan(
      indexOfEvent(events, 'build', 'end'),
    );
    expect(indexOfEvent(events, 'other', 'start')).toBeLessThan(
      indexOfEvent(events, 'build', 'end'),
    );
  });

  test('keeps going after a failure and still runs the rest of its lane', async () => {
    const { run } = recorder();
    const phase = phaseOf(
      2,
      [{ name: 'bad', fails: true }, { name: 'after' }],
      [{ name: 'beside' }],
    );
    const results = await runPhase(phase, run);
    expect(results).toEqual(['bad:fail', 'after:pass', 'beside:pass']);
  });

  test('returns results in declared order even when later lanes finish first', async () => {
    const { run } = recorder();
    const phase = phaseOf(
      3,
      [
        { name: 'slow', ms: 200 },
        { name: 'slow-2', ms: 20 },
      ],
      [{ name: 'fast', ms: 10 }],
      [{ name: 'middle', ms: 80 }],
    );
    const results = await runPhase(phase, run);
    expect(results).toEqual(['slow:pass', 'slow-2:pass', 'fast:pass', 'middle:pass']);
  });
});

describe('itemsOf', () => {
  test('lists phases, lanes and checks in declared order', () => {
    const phases = [
      phaseOf(1, [{ name: 'a' }], [{ name: 'b' }]),
      phaseOf(4, [{ name: 'c' }, { name: 'd' }], [{ name: 'e' }]),
    ];
    expect(itemsOf(phases).map((step) => step.name)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
