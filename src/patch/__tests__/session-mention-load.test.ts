import { describe, expect, test } from 'bun:test';

import type { Driver } from './session-mention-harness.ts';
import { session, sessionDriver, stock } from './session-mention-harness.ts';

const SESSIONS = [session('aaaa1111', 'Fix herdr lag', 5), session('bbbb2222', 'Plan the week', 9)];

function driver(): Driver {
  if (stock === undefined) {
    throw new Error('no stock Droid to read');
  }
  return sessionDriver(stock);
}

function sessionRows(state: Driver['suggestions']): number {
  return state.items.filter((item) => item.$ODsession !== undefined).length;
}

describe.skipIf(stock === undefined)('a session load that finishes late', () => {
  test('opens the list when the input still asks for it', async () => {
    const input = driver();
    await input.update('#', 1);
    expect(input.suggestions.shown).toBe(false);
    await input.finishLoad(SESSIONS);
    expect(input.suggestions.shown).toBe(true);
    expect(sessionRows(input.suggestions)).toBe(2);
  });

  test('stays closed once the slash menu took over', async () => {
    const input = driver();
    await input.update('/sessions\n#', 11);
    await input.update('/sessions\n#', 5);
    await input.finishLoad(SESSIONS);
    expect(input.suggestions.shown).toBe(false);
    expect(sessionRows(input.suggestions)).toBe(0);
  });

  test('stays closed once the file picker took over, before its debounce fires', async () => {
    const input = driver();
    await input.update('#', 1);
    await input.update('# @src', 6);
    await input.finishLoad(SESSIONS);
    expect(sessionRows(input.suggestions)).toBe(0);
  });

  test('stays closed after Esc', async () => {
    const input = driver();
    await input.update('#', 1);
    input.close();
    await input.finishLoad(SESSIONS);
    expect(input.suggestions.shown).toBe(false);
    expect(sessionRows(input.suggestions)).toBe(0);
  });

  test('each shown row reads its transcript once while the query stays open', async () => {
    const input = driver();
    await input.update('#', 1);
    await input.finishLoad(SESSIONS);
    await input.update('#pl', 3);
    expect(input.transcriptsRead).toEqual(['/work/aaaa1111.jsonl', '/work/bbbb2222.jsonl']);
    expect(input.suggestions.items[0]?.label).toEndWith('\n  typed into /work/bbbb2222.jsonl');
  });

  test('leaving the query drops the transcripts read with the pool', async () => {
    const input = driver();
    await input.update('#', 1);
    await input.finishLoad(SESSIONS);
    await input.update('x', 1);
    await input.update('#', 1);
    await input.finishLoad(SESSIONS);
    expect(input.transcriptsRead).toHaveLength(4);
  });

  test('a later keystroke in the same # query reuses the load', async () => {
    const input = driver();
    await input.update('#', 1);
    await input.update('#pl', 3);
    await input.finishLoad(SESSIONS);
    expect(input.suggestions.items.map((item) => item.$ODsession)).toEqual(['bbbb2222']);
  });
});
