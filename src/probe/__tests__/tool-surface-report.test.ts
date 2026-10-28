import { describe, expect, test } from 'bun:test';

import type { BodyRow } from '../bodies.ts';
import { describeToolSurface, readToolSurface } from '../tool-surface-report.ts';

function row(tools: readonly string[], assistantMessageId = 'a'): BodyRow {
  return {
    t: 0,
    sessionId: 's',
    assistantMessageId,
    route: 'anthropic',
    body: { tools: tools.map((name) => ({ name })) },
  };
}

describe('readToolSurface', () => {
  test('reads the tool list of the last request', () => {
    const surface = readToolSurface([row(['Script']), row(['Script', 'TodoWrite'])], 'TodoWrite');
    expect(surface?.names).toEqual(['Script', 'TodoWrite']);
    expect(surface?.scriptOnly).toBe(true);
    expect(surface?.direct).toBe(true);
  });

  test('skips a one-shot side request, such as the session title, that lands after the turn', () => {
    const surface = readToolSurface(
      [row(['Script', 'TodoWrite']), row([], 'oneshot-assistant-1793180297120')],
      'TodoWrite',
    );
    expect(surface?.names).toEqual(['Script', 'TodoWrite']);
  });

  test('has no reading while only a one-shot side request was recorded', () => {
    expect(readToolSurface([row([], 'oneshot-assistant-1')], 'TodoWrite')).toBeUndefined();
  });

  test('says a tool is not direct when only Script carries it', () => {
    expect(readToolSurface([row(['Script', 'WaitForScript'])], 'TodoWrite')?.direct).toBe(false);
  });

  test('has no reading without a request', () => {
    expect(readToolSurface([], 'TodoWrite')).toBeUndefined();
  });

  test('has no reading when the request carries no tool list', () => {
    const noTools: BodyRow = { ...row([]), body: { model: 'm' } };
    expect(readToolSurface([noTools], 'TodoWrite')).toBeUndefined();
  });
});

describe('describeToolSurface', () => {
  test('names the tools next to a direct one', () => {
    const text = describeToolSurface(
      readToolSurface([row(['Script', 'WaitForScript', 'TodoWrite'])], 'TodoWrite'),
      'TodoWrite',
    );
    expect(text).toBe(
      "TodoWrite is on the model's direct tool list, next to Script, WaitForScript",
    );
  });

  test('explains the failure a missing direct tool causes', () => {
    const text = describeToolSurface(
      readToolSurface([row(['Script', 'WaitForScript'])], 'TodoWrite'),
      'TodoWrite',
    );
    expect(text).toContain('not on the model');
    expect(text).toContain('Not found');
  });

  test('refuses to judge a session that is not in script_only mode', () => {
    const text = describeToolSurface(
      readToolSurface([row(['Read', 'Edit'])], 'TodoWrite'),
      'TodoWrite',
    );
    expect(text).toContain('not in script_only mode');
  });

  test('points at the bodies build when nothing was recorded', () => {
    expect(describeToolSurface(undefined, 'TodoWrite')).toContain('probe build --bodies');
  });
});
