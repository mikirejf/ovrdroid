import { describe, expect, test } from 'bun:test';

import { gateChecks } from '../checks.ts';
import { itemsOf } from '../schedule.ts';

const INPUTS = {
  target: '/t/droid.tmp',
  stock: '/s/droid',
  droidVersion: '0.244.0',
  scratchHome: '/scratch',
  bodiesBuild: '/g/droid-bodies',
};
const phases = gateChecks(INPUTS);
const checks = itemsOf(phases);

function commandOf(name: string): string {
  return checks.find((check) => check.name === name)?.command.join(' ') ?? '';
}

function phaseOf(name: string) {
  const phase = phases.find((candidate) => candidate.name === name);
  if (phase === undefined) {
    throw new Error(`no phase ${name}`);
  }
  return phase;
}

function laneNames(phaseName: string): string[][] {
  return phaseOf(phaseName).lanes.map((lane) => lane.items.map((check) => check.name));
}

describe('gateChecks', () => {
  test('names every check once, because each one writes its own log', () => {
    const names = checks.map((check) => check.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test('runs the phases static, live, timing in that order', () => {
    expect(phases.map((phase) => phase.name)).toEqual(['static', 'live', 'timing']);
  });

  test('runs the unit tests with the scratch HOME and nothing else with it', () => {
    expect(checks.filter((check) => check.env !== undefined).map((check) => check.name)).toEqual([
      'test',
    ]);
    expect(checks.find((check) => check.name === 'test')?.env).toEqual({ HOME: '/scratch' });
  });

  test('puts the stock before the patched build in the paint A/B', () => {
    expect(commandOf('ab')).toBe('bun run probe ab -r 24 /s/droid /t/droid.tmp');
  });

  test('puts the stock before the patched build in the typing-during-startup A/B', () => {
    expect(commandOf('typing-start')).toBe(
      'bun run probe typing-start -r 10 /s/droid /t/droid.tmp',
    );
  });

  test('builds the bodies binary from the stock and reads the tool surface from it', () => {
    expect(commandOf('bodies-build')).toBe(
      'bun run probe build --target /s/droid --bodies --out /g/droid-bodies',
    );
    expect(commandOf('tool-surface')).toBe('bun run probe tool-surface /g/droid-bodies');
    expect(laneNames('live')).toContainEqual(['bodies-build', 'tool-surface']);
  });

  test('checks the release it gates, not the newest one', () => {
    expect(commandOf('builds')).toBe('bun run probe builds --version 0.244.0');
  });

  test('runs the unit tests alone, because some of them have wall-clock limits of a few seconds', () => {
    expect(phaseOf('static').lanesAtOnce).toBe(1);
    expect(laneNames('static')).toEqual([['verify'], ['builds'], ['test']]);
  });

  test('runs live checks four lanes at a time, longest first', () => {
    const live = phaseOf('live');
    expect(live.lanesAtOnce).toBe(4);
    expect(laneNames('live').slice(0, 5)).toEqual([
      ['digest-run'],
      ['warm'],
      ['effort-switch'],
      ['cachekey'],
      ['bodies-build', 'tool-surface'],
    ]);
  });

  test('keeps the timing checks and the ones that write shared state out of the live phase', () => {
    const live = laneNames('live').flat();
    for (const name of ['effort', 'ab', 'typing-start', 'keys', 'resume', 'stream']) {
      expect(live).not.toContain(name);
    }
    expect(phaseOf('timing').lanesAtOnce).toBe(1);
    expect(laneNames('timing')).toEqual([
      ['effort'],
      ['ab'],
      ['typing-start'],
      ['keys'],
      ['resume'],
      ['stream'],
    ]);
  });

  test('runs exactly these checks', () => {
    expect(checks.map((check) => check.name).toSorted()).toEqual(
      [
        'verify',
        'builds',
        'test',
        'effort',
        'effort-clear',
        'rewind',
        'notice',
        'mcp-children',
        'ab',
        'typing-start',
        'keys',
        'resume',
        'stream',
        'effort-switch',
        'cachekey',
        'warm',
        'bodies-build',
        'tool-surface',
        'compaction-fallback',
        'digest-run',
      ].toSorted(),
    );
  });
});
