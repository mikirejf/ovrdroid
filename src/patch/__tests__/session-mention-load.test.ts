import { describe, expect, test } from 'bun:test';

import { SCAN_BATCH, WARM_DELAY_MS } from '../session-mention-patches.ts';
import type { Driver, FirstMessages, Session } from './session-mention-harness.ts';
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
    expect(input.transcriptsRead).toEqual([]);
    input.view();
    await input.update('#pl', 3);
    input.view();
    expect(input.transcriptsRead).toEqual(['/work/aaaa1111.jsonl', '/work/bbbb2222.jsonl']);
    expect(input.suggestions.items[0]?.$ODhead?.text).toBe('typed into /work/bbbb2222.jsonl');
  });

  test('leaving the query drops the transcripts read with the pool', async () => {
    const input = driver();
    await input.update('#', 1);
    await input.finishLoad(SESSIONS);
    input.view();
    await input.update('x', 1);
    await input.update('#', 1);
    await input.finishLoad(SESSIONS);
    input.view();
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

function shownIds(input: Driver): (string | undefined)[] {
  return input.suggestions.items.map((item) => item.$ODsession);
}

function withFirst(first: FirstMessages): Driver {
  if (stock === undefined) {
    throw new Error('no stock Droid to read');
  }
  return sessionDriver(stock, first);
}

function many(count: number): Session[] {
  return Array.from({ length: count }, (_, index) => session(`s${index}`, `Chat ${index}`, index));
}

describe.skipIf(stock === undefined)(
  'first messages are read in the background after the load',
  () => {
    test('a query that only a first message answers opens the list once it is read', async () => {
      const input = withFirst({ aaaa1111: 'the vpisem field is empty' });
      await input.update('#vpisem', 7);
      await input.finishLoad(SESSIONS);
      expect(input.suggestions.shown).toBe(false);
      await input.runAllBatches();
      expect(input.suggestions.shown).toBe(true);
      expect(shownIds(input)).toEqual(['aaaa1111']);
    });

    test('title matches show at once and first-message matches follow below them', async () => {
      const input = withFirst({ aaaa1111: 'plan to fix herdr' });
      await input.update('#plan', 5);
      await input.finishLoad(SESSIONS);
      expect(shownIds(input)).toEqual(['bbbb2222']);
      await input.runAllBatches();
      expect(shownIds(input)).toEqual(['bbbb2222', 'aaaa1111']);
    });

    test('reads the pool in batches of the scan size, one batch per timer', async () => {
      const input = withFirst({});
      await input.update('#zzz', 4);
      await input.finishLoad(many(120));
      expect(input.transcriptsRead).toHaveLength(0);
      await input.runBatch();
      expect(input.transcriptsRead).toHaveLength(SCAN_BATCH);
      await input.runBatch();
      expect(input.transcriptsRead).toHaveLength(2 * SCAN_BATCH);
      await input.runAllBatches();
      expect(input.transcriptsRead).toHaveLength(120);
      expect(input.background.pending()).toBe(0);
    });

    test('two keystrokes waiting on one load start one background read', async () => {
      const input = withFirst({});
      await input.update('#zzz', 4);
      await input.update('#zzzz', 5);
      await input.finishLoad(many(3));
      expect(input.background.pending()).toBe(1);
      await input.runAllBatches();
      expect(input.transcriptsRead).toHaveLength(3);
    });

    test('a refresh keeps the selected row', async () => {
      const input = withFirst({ s60: 'herdr here', s100: 'herdr there' });
      await input.update('#herdr', 6);
      await input.finishLoad(many(120));
      await input.runBatch();
      expect(shownIds(input)).toEqual([]);
      await input.runBatch();
      await input.runBatch();
      await input.runBatch();
      await input.runBatch();
      await input.runBatch();
      await input.runBatch();
      expect(shownIds(input)).toEqual(['s60']);
      await input.runAllBatches();
      expect(shownIds(input)).toEqual(['s60', 's100']);
      expect(input.selected()).toBe(0);
    });

    test('a new query still starts on the first row', async () => {
      const input = withFirst({});
      await input.update('#Chat', 5);
      await input.finishLoad(many(3));
      input.pressDown();
      input.pressDown();
      expect(input.selected()).toBe(2);
      await input.update('#Chat 1', 7);
      expect(input.selected()).toBe(0);
    });

    test('a refresh after Esc shows nothing', async () => {
      const input = withFirst({ aaaa1111: 'vpisem' });
      await input.update('#vpisem', 7);
      await input.finishLoad(SESSIONS);
      input.close();
      await input.runAllBatches();
      expect(input.suggestions.shown).toBe(false);
      expect(shownIds(input)).toEqual([]);
    });

    test('Esc on a list with no rows stops later refreshes from opening it', async () => {
      const input = withFirst({ oooo1111: 'a needle in the first message' });
      await input.update('#needle', 7);
      await input.finishLoad([session('oooo1111', 'Other', 5)]);
      expect(input.suggestions.shown).toBe(false);
      input.pressEscape();
      await input.runAllBatches();
      expect(input.suggestions.shown).toBe(false);
      expect(shownIds(input)).toEqual([]);
    });

    test('Esc keeps doing what stock Esc does', async () => {
      const input = withFirst({});
      await input.update('#needle', 7);
      await input.finishLoad([session('oooo1111', 'Other', 5)]);
      expect(input.pressEscape()).toBe('stock escape');
      expect(input.stockEscapes).toEqual(['escape']);
    });

    test('typing again after Esc brings the first-message match back', async () => {
      const input = withFirst({ oooo1111: 'a needle in the first message' });
      await input.update('#needle', 7);
      await input.finishLoad([session('oooo1111', 'Other', 5)]);
      input.pressEscape();
      await input.runAllBatches();
      await input.update('#needles', 8);
      await input.update('#needle', 7);
      expect(shownIds(input)).toEqual(['oooo1111']);
    });

    test('the read stops when the input unmounts', async () => {
      const input = withFirst({ s100: 'needle' });
      await input.update('#needle', 7);
      await input.finishLoad(many(120));
      await input.runBatch();
      expect(input.transcriptsRead).toHaveLength(SCAN_BATCH);
      input.unmount();
      await input.runAllBatches();
      expect(input.transcriptsRead).toHaveLength(SCAN_BATCH);
      expect(input.suggestions.shown).toBe(false);
    });

    test('a refresh follows the query as it is now, not the one that started the read', async () => {
      const input = withFirst({ aaaa1111: 'vpisem', bbbb2222: 'zellij' });
      await input.update('#vpisem', 7);
      await input.finishLoad(SESSIONS);
      await input.update('#zellij', 7);
      expect(shownIds(input)).toEqual([]);
      await input.runAllBatches();
      expect(shownIds(input)).toEqual(['bbbb2222']);
    });

    test('a refresh after the input left the # query shows nothing', async () => {
      const input = withFirst({ aaaa1111: 'vpisem' });
      await input.update('#vpisem', 7);
      await input.finishLoad(SESSIONS);
      await input.update('plain', 5);
      await input.runAllBatches();
      expect(input.suggestions.shown).toBe(false);
      expect(shownIds(input)).toEqual([]);
    });

    test('the read stops when the pool is dropped', async () => {
      const input = withFirst({});
      await input.update('#zzz', 4);
      await input.finishLoad(many(120));
      await input.runBatch();
      expect(input.transcriptsRead).toHaveLength(SCAN_BATCH);
      await input.update('plain', 5);
      await input.runAllBatches();
      expect(input.transcriptsRead).toHaveLength(SCAN_BATCH);
    });

    test('a new pool is read from the start', async () => {
      const input = withFirst({});
      await input.update('#zzz', 4);
      await input.finishLoad(many(60));
      await input.runBatch();
      await input.update('plain', 5);
      await input.update('#zzz', 4);
      await input.finishLoad(many(60));
      await input.runAllBatches();
      expect(input.transcriptsRead).toHaveLength(SCAN_BATCH + 60);
    });
  },
);

describe.skipIf(stock === undefined)(
  'the stock session list is read once while Droid is idle',
  () => {
    test('mounting arms one timer and reads nothing yet', () => {
      const input = driver();
      expect(input.warmup.timers.map((timer) => timer.delay)).toEqual([WARM_DELAY_MS]);
      expect(input.warmup.loaded).toEqual([]);
    });

    test('when the timer fires it reads the list for the working directory', async () => {
      const input = driver();
      input.warmup.timers[0]?.run();
      await Bun.sleep(1);
      expect(input.warmup.loaded).toEqual(['/work']);
    });

    test('unmounting before the timer fires cancels it', () => {
      const input = driver();
      input.unmount();
      expect(input.warmup.cleared).toHaveLength(1);
    });
  },
);
