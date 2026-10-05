import { afterEach, describe, expect, test } from 'bun:test';

import { SCAN_BATCH } from '../session-mention-patches.ts';
import type { DetailKey, Driver, FirstMessages, Session } from './session-mention-harness.ts';
import { picker, session, sessionDriver, stock } from './session-mention-harness.ts';
import type { EscapePath } from './session-mention-keys.ts';

function withFirst(first: FirstMessages): Driver {
  if (stock === undefined) {
    throw new Error('no stock Droid to read');
  }
  return sessionDriver(stock, first);
}

function shownIds(input: Driver): (string | undefined)[] {
  return input.suggestions.items.map((item) => item.$ODsession);
}

const OTHER: Session[] = [session('oooo1111', 'Other', 5)];
const NEEDLE: FirstMessages = { oooo1111: 'a needle in the first message' };
async function zeroMatch(): Promise<Driver> {
  const input = withFirst(NEEDLE);
  await input.update('#needle', 7);
  await input.finishLoad(OTHER);
  expect(input.suggestions.shown).toBe(false);
  return input;
}

const POOL = [session('s0', 'Other', 1), session('s1', 'Needle title', 2)];
const FIRST: FirstMessages = { s0: 'zellij here', s1: 'zellij there' };

async function reordered(): Promise<Driver> {
  const input = withFirst(FIRST);
  await input.update('#needle', 7);
  await input.finishLoad(POOL);
  expect(shownIds(input)).toEqual(['s1']);
  input.view();
  await input.update('#zellij', 7);
  expect(shownIds(input)).toEqual(['s1']);
  return input;
}

function chats(count: number): Session[] {
  return Array.from({ length: count }, (_, index) => session(`s${index}`, `Chat ${index}`, index));
}

const PATHS: EscapePath[] = ['key', 'sequence', 'callback'];

describe.skipIf(stock === undefined).each(PATHS)('Esc through the %s handler', (path) => {
  test('stops later refreshes from opening a list that had no rows', async () => {
    const input = await zeroMatch();
    input.pressEscape(path);
    await input.runAllBatches();
    expect(input.suggestions.shown).toBe(false);
    expect(shownIds(input)).toEqual([]);
  });

  test('in bash mode it leaves bash mode and stops later refreshes too', async () => {
    const input = await zeroMatch();
    input.bash.active = true;
    input.pressEscape(path);
    expect(input.bash.active).toBe(false);
    await input.runAllBatches();
    expect(input.suggestions.shown).toBe(false);
    expect(shownIds(input)).toEqual([]);
  });

  test('in bash mode the stock Esc handler is not reached, as in stock', async () => {
    const input = await zeroMatch();
    input.bash.active = true;
    input.pressEscape(path);
    expect(input.stockEscapes).toEqual([]);
  });

  test('outside bash mode the stock Esc handler runs once', async () => {
    const input = await zeroMatch();
    input.pressEscape(path);
    expect(input.stockEscapes).toEqual(['escape']);
    expect(input.bash.active).toBe(false);
  });
});

describe.skipIf(stock === undefined)('a refresh never moves the rows already shown', () => {
  test('a match found by the refresh goes below the rows already shown', async () => {
    const input = await reordered();
    await input.runBatch();
    expect(shownIds(input)).toEqual(['s1', 's0']);
    expect(input.selected()).toBe(0);
  });

  test('several new matches go below in newest-first order', async () => {
    const input = withFirst({ ...FIRST, s2: 'zellij old', s3: 'zellij older' });
    await input.update('#needle', 7);
    await input.finishLoad([...POOL, session('s2', 'Other', 3), session('s3', 'Other', 4)]);
    input.view();
    await input.update('#zellij', 7);
    expect(shownIds(input)).toEqual(['s1']);
    await input.runBatch();
    expect(shownIds(input)).toEqual(['s1', 's0', 's2', 's3']);
  });

  test('Enter before the next render inserts the session that was highlighted', async () => {
    const input = await reordered();
    input.runBatchUnrendered();
    expect(shownIds(input)).toEqual(['s1', 's0']);
    expect(input.pressEnter()).toBe('#session-s1 ');
  });

  test('a session the user moved down to stays highlighted through an unrendered refresh', async () => {
    const input = withFirst({ s2: 'needle', s3: 'needle' });
    await input.update('#needle', 7);
    await input.finishLoad([
      session('s0', 'needle one', 1),
      session('s1', 'needle two', 2),
      session('s2', 'Other', 3),
      session('s3', 'Other', 4),
    ]);
    input.pressDown();
    expect(input.selected()).toBe(1);
    input.runBatchUnrendered();
    expect(shownIds(input)).toEqual(['s0', 's1', 's2', 's3']);
    expect(input.pressEnter()).toBe('#session-s1 ');
  });

  test('a new keystroke puts the rows back in the full order and starts on the first', async () => {
    const input = await reordered();
    await input.runBatch();
    await input.update('#zellij', 7);
    expect(shownIds(input)).toEqual(['s0', 's1']);
    expect(input.selected()).toBe(0);
  });

  test('a list opened by the refresh shows its rows in full order and starts on the first', async () => {
    const input = withFirst({ s0: 'needle', s1: 'needle' });
    await input.update('#needle', 7);
    await input.finishLoad([session('s1', 'Other', 2), session('s0', 'Other', 1)]);
    await input.runAllBatches();
    expect(shownIds(input)).toEqual(['s0', 's1']);
    expect(input.selected()).toBe(0);
  });
});

describe.skipIf(stock === undefined)(
  'the background read follows the service it started on',
  () => {
    test('replacing the service mid-read stops that read', async () => {
      const input = withFirst({});
      await input.update('#zzz', 4);
      await input.finishLoad(chats(120));
      await input.runBatch();
      expect(input.transcriptsRead).toHaveLength(SCAN_BATCH);
      input.replaceService();
      await input.runAllBatches();
      expect(input.transcriptsRead).toHaveLength(SCAN_BATCH);
    });

    test('unmounting after a replacement stops the read on the replacement too', async () => {
      const input = withFirst({});
      await input.update('#zzz', 4);
      await input.finishLoad(chats(120));
      await input.runBatch();
      input.replaceService();
      await input.update('#zzz', 4);
      await input.finishLoad(chats(120));
      await input.runBatch();
      expect(input.transcriptsRead).toHaveLength(2 * SCAN_BATCH);
      input.unmount();
      await input.runAllBatches();
      expect(input.transcriptsRead).toHaveLength(2 * SCAN_BATCH);
    });
  },
);

describe.skipIf(stock === undefined)('Left and Right in the session list', () => {
  afterEach(() => {
    picker.$ODdetail = false;
  });

  const opened = async (): Promise<Driver> => {
    const input = withFirst({});
    await input.update('#', 1);
    await input.finishLoad(chats(3));
    expect(input.suggestions.shown).toBe(true);
    return input;
  };

  test('Right turns the detail on and Left turns it off', async () => {
    const input = await opened();
    expect(input.pressDetail('right')).toBe(true);
    expect(picker.$ODdetail).toBe(true);
    expect(input.pressDetail('left')).toBe(true);
    expect(picker.$ODdetail).toBe(false);
  });

  test('Right when the detail is already on changes nothing and does not redraw', async () => {
    const input = await opened();
    input.pressDetail('right');
    const before = input.suggestions.items;
    input.pressDetail('right');
    expect(picker.$ODdetail).toBe(true);
    expect(input.suggestions.items).toBe(before);
  });

  test('the open list can be redrawn with the same rows in the same order', async () => {
    const input = await opened();
    const before = input.suggestions.items;
    expect(input.redraw()).toBe(true);
    expect(input.suggestions.items).not.toBe(before);
    expect(shownIds(input)).toEqual(['s0', 's1', 's2']);
  });

  test('once the input unmounts there is nothing left to redraw', async () => {
    const input = await opened();
    input.unmount();
    expect(input.redraw()).toBe(false);
  });

  test.each<DetailKey>(['shift-right', 'ctrl-left'])('%s is left to the text box', async (key) => {
    const input = await opened();
    expect(input.pressDetail(key)).toBe(false);
    expect(picker.$ODdetail).toBe(false);
  });
});
