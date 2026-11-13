import { describe, expect, test } from 'bun:test';

import { readApp } from '../../binary/graph.ts';
import { backupPath, INSTALLED_DROID } from '../../paths.ts';
import { applies, rebaseAll } from '../rebase.ts';
import { FOCUS_UNIT, rewindScrollPatches, SEEK_WINDOW } from '../rewind-scroll-patches.ts';
import { subagentPatches } from '../subagent-patches.ts';
import { describeStrayNames, occurrences, patchNamed, payloadFunction } from './payload.ts';

interface Page {
  index: number;
  hasMore?: boolean;
}

interface HistoryWindow {
  pages: Page[];
  firstPageIndex: number;
  pageHeights: Record<number, number>;
  rowsFromEnd: number;
  olderStepStarts: number[];
  prefetched?: Page;
  pendingStep?: unknown;
}

interface Seek {
  odTarget: string;
  odTops: Record<number, Record<string, number>>;
  odNewer?: boolean;
}

const ROWS = 20;

const seekWindow = payloadFunction<
  [],
  (window: HistoryWindow, seek: Seek, rows: number) => HistoryWindow | undefined
>([], `${SEEK_WINDOW};return $ODseekWindow`)();

function historyWindow(fields: Partial<HistoryWindow>): HistoryWindow {
  return {
    pages: [{ index: 0 }],
    firstPageIndex: 0,
    pageHeights: { 0: 100 },
    rowsFromEnd: 0,
    olderStepStarts: [],
    ...fields,
  };
}

describeStrayNames(rewindScrollPatches);

test('the shipped patch set carries the rewind scroll patches', () => {
  for (const patch of rewindScrollPatches) {
    expect(subagentPatches).toContainEqual(patch);
  }
});

describe('seeking the history window to a message', () => {
  test('puts the top of a message on the newest page at the top of the window', () => {
    const moved = seekWindow(
      historyWindow({ olderStepStarts: [5], pendingStep: {} }),
      { odTarget: 'm1', odTops: { 0: { m1: 60 } } },
      ROWS,
    );
    expect(moved?.rowsFromEnd).toBe(60 - ROWS);
    expect(moved?.olderStepStarts).toEqual([]);
    expect(moved?.pendingStep).toBeUndefined();
  });

  test('counts every newer page, kept or dropped, below a message on an older page', () => {
    const moved = seekWindow(
      historyWindow({
        pages: [{ index: 2 }],
        firstPageIndex: 2,
        pageHeights: { 0: 100, 1: 80, 2: 50 },
      }),
      { odTarget: 'm9', odTops: { 2: { m9: 30 } } },
      ROWS,
    );
    expect(moved?.rowsFromEnd).toBe(100 + 80 + 30 - ROWS);
  });

  test('stops at the newest row when the message is shorter than the window', () => {
    const moved = seekWindow(historyWindow({}), { odTarget: 'm1', odTops: { 0: { m1: 8 } } }, ROWS);
    expect(moved?.rowsFromEnd).toBe(0);
  });

  test('waits while a page has no measured height', () => {
    const window = historyWindow({ pageHeights: {} });
    expect(seekWindow(window, { odTarget: 'm1', odTops: {} }, ROWS)).toBe(window);
  });

  test('takes in the prefetched older page and scrolls to the oldest rows while it searches', () => {
    const moved = seekWindow(
      historyWindow({ prefetched: { index: 1, hasMore: true } }),
      { odTarget: 'old', odTops: { 0: { m1: 60 } } },
      ROWS,
    );
    expect(moved?.pages).toEqual([{ index: 0 }, { index: 1, hasMore: true }]);
    expect(moved?.prefetched).toBeUndefined();
    expect(moved?.rowsFromEnd).toBe(100 - ROWS);
  });

  test('scrolls to the oldest rows and leaves the page list alone while the next page loads', () => {
    const window = historyWindow({ pages: [{ index: 0, hasMore: true }] });
    const moved = seekWindow(window, { odTarget: 'old', odTops: {} }, ROWS);
    expect(moved?.pages).toBe(window.pages);
    expect(moved?.rowsFromEnd).toBe(100 - ROWS);
  });

  test('leaves the window alone when the whole history lacks the message', () => {
    const window = historyWindow({ rowsFromEnd: 12 });
    expect(seekWindow(window, { odTarget: 'gone', odTops: { 0: {} } }, ROWS)).toBe(window);
  });

  test('asks to reload from the newest page when a newer message sits on a dropped page', () => {
    const window = historyWindow({
      pages: [{ index: 1 }],
      firstPageIndex: 1,
      pageHeights: { 0: 100, 1: 80 },
    });
    expect(
      seekWindow(window, { odTarget: 'new', odTops: { 1: {} }, odNewer: true }, ROWS),
    ).toBeUndefined();
  });

  test('a newer message found on a kept page needs no reload', () => {
    const window = historyWindow({
      pages: [{ index: 1 }],
      firstPageIndex: 1,
      pageHeights: { 0: 100, 1: 80 },
    });
    const moved = seekWindow(
      window,
      { odTarget: 'new', odTops: { 1: { new: 40 } }, odNewer: true },
      ROWS,
    );
    expect(moved?.rowsFromEnd).toBe(100 + 40 - ROWS);
  });
});

interface Unit {
  top: number;
  height: number;
  isUser: boolean;
  odMessageId?: string;
}

type Measured = [
  index: number,
  height: number,
  userRows: number[],
  allRows: number[],
  tops?: Record<string, number>,
];

type Report = (...measured: Measured) => undefined;

function measure(pageHeight: number, units: readonly Unit[]) {
  const patch = patchNamed(rewindScrollPatches, 'transcript-history-page-reports-message-tops');
  const calls: Measured[] = [];
  const entries = units.map((unit) => ({
    node: {
      yogaNode: { getComputedTop: () => unit.top, getComputedHeight: () => unit.height },
    },
    isUser: unit.isUser,
    odMessageId: unit.odMessageId,
  }));
  payloadFunction<
    [number, { current: Map<string, unknown> }, Report, { index: number }],
    undefined
  >(['t1', 'K', 'V', 'g'], `let ${patch.replace.slice(0, -1)}`)(
    pageHeight,
    { current: new Map(entries.map((entry, index) => [String(index), entry])) },
    (...args) => {
      calls.push(args);
    },
    { index: 3 },
  );
  return calls;
}

describe('measuring a history page', () => {
  test('reports the top row of each user message, counted from the page bottom', () => {
    const [call] = measure(50, [
      { top: 0, height: 2, isUser: true, odMessageId: 'u1' },
      { top: 2, height: 20, isUser: false },
      { top: 22, height: 3, isUser: true, odMessageId: 'u2' },
      { top: 25, height: 25, isUser: false },
    ]);
    expect(call?.[0]).toBe(3);
    expect(call?.[2]).toEqual([25, 48]);
    expect(call?.[3]).toEqual([0, 25, 28, 48]);
    expect(call?.[4]).toEqual({ u1: 50, u2: 28 });
  });

  test('a message split into several units reports its topmost row', () => {
    const [call] = measure(10, [
      { top: 0, height: 2, isUser: true, odMessageId: 'u1' },
      { top: 2, height: 2, isUser: true, odMessageId: 'u1' },
    ]);
    expect(call?.[4]).toEqual({ u1: 10 });
  });
});

const stock = Bun.file(backupPath(INSTALLED_DROID));
const modules = (await stock.exists())
  ? readApp(await stock.bytes()).map((module) => module.text)
  : undefined;

describe.skipIf(modules === undefined)('rewind scroll patches on the stock binary', () => {
  const rebased = rebaseAll(rewindScrollPatches, modules ?? []);

  test.each(rebased.map((patch) => [patch.name, patch] as const))(
    '%s anchors exactly once',
    (_name, patch) => {
      expect(applies(patch)).toBe(true);
      expect(
        (modules ?? []).reduce((count, text) => count + occurrences(text, patch.find), 0),
      ).toBe(1);
    },
  );
});

interface FocusUnit {
  kind: string;
  item?: { id: string; $ODfocus?: boolean };
}

describe('marking the highlighted message', () => {
  const mark = payloadFunction<[FocusUnit, string?], FocusUnit>(
    ['e1', '$ODfocus'],
    `return ${FOCUS_UNIT}`,
  );

  test('the unit of the highlighted message carries the focus mark', () => {
    expect(mark({ kind: 'item', item: { id: 'm2' } }, 'm2').item?.$ODfocus).toBe(true);
  });

  test('every other unit is passed through as it is', () => {
    const other = { kind: 'item', item: { id: 'm1' } };
    expect(mark(other, 'm2')).toBe(other);
    const group = { kind: 'collapsed-group' };
    expect(mark(group, 'm2')).toBe(group);
  });

  test('with no highlighted message nothing is marked', () => {
    const unit = { kind: 'item', item: { id: 'm1' } };
    expect(mark(unit)).toBe(unit);
  });

  test('the focused message takes the menu highlight color for its bar and text', () => {
    const { replace } = patchNamed(rewindScrollPatches, 'user-message-focus-color');
    expect(occurrences(replace, 'g.$ODfocus===!0?a.primary:')).toBe(2);
  });

  test('moving the highlight between messages updates the history state', () => {
    const { replace } = patchNamed(
      rewindScrollPatches,
      'transcript-history-state-tracks-seek-target',
    );
    expect(replace).toContain('c1.odTarget===l1.odTarget');
  });
});
