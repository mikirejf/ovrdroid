import { describe, expect, test } from 'bun:test';

import { inkFramePatches, SHARED_CACHE_LINES, WRAP_CACHE_ENTRIES } from '../ink-frame-patches.ts';
import { applies } from '../rebase.ts';
import { moduleHolding, rebased, renamed, sourceApp, STOCK, textOf } from './ink-frame-harness.ts';
import { FRAMES, wrappers } from './ink-frame-wrap.ts';
import { closureOf } from './module-closure.ts';
import type { Stand } from './session-mention-harness.ts';
import { evaluateProgram } from './stream-render-harness.ts';

interface Caches {
  styledChars: Map<string, Stand>;
  getStyledChars: (line: string) => Stand;
  getWidestLine: (block: string) => Stand;
}

describe.skipIf(STOCK === undefined)(
  'every Ink frame patch applies to the shipped bundle once',
  () => {
    test.each(inkFramePatches.map((patch) => [patch.name] as const))('%s', (name) => {
      const rebase = rebased(name);
      expect(applies(rebase)).toBe(true);
      expect(rebase.matches).toBe(1);
    });
  },
);

function outputClass(): new () => { caches: Caches } {
  const rebase = rebased('ink-output-caches-shared');
  const text = textOf(sourceApp(), moduleHolding(sourceApp(), rebase.find));
  return evaluateProgram<{ $ODholder: new () => { caches: Caches } }>({
    moduleText: text,
    source: `${closureOf(text, [renamed(rebase, 'BC')])};class $ODholder{${rebase.replace}}`,
    returns: ['$ODholder'],
    overrides: new Map(),
  }).$ODholder;
}

describe.skipIf(STOCK === undefined)('ink-output-caches-shared', () => {
  test('one frame after another reads the same caches', () => {
    const Output = outputClass();
    const first = new Output();
    first.caches.getStyledChars('a line');
    expect(new Output().caches).toBe(first.caches);
    expect(new Output().caches.styledChars.has('a line')).toBe(true);
  });

  test('the caches start over once they hold too many lines', () => {
    const Output = outputClass();
    const full = new Output().caches;
    for (let index = 0; index < SHARED_CACHE_LINES; index += 1) {
      full.getStyledChars(`line ${index}`);
    }
    const fresh = new Output().caches;
    expect(fresh).not.toBe(full);
    expect(fresh.styledChars.size).toBe(0);
    expect(new Output().caches).toBe(fresh);
  });

  test('the caches start over once they hold too many blocks', () => {
    const Output = outputClass();
    const full = new Output().caches;
    for (let index = 0; index < SHARED_CACHE_LINES; index += 1) {
      full.getWidestLine(`block ${index}`);
    }
    expect(new Output().caches).not.toBe(full);
  });
});

describe.skipIf(STOCK === undefined)('ink-frame-wrap-cache', () => {
  test('every frame wraps to the same rows as stock, on the first pass and the cached ones', () => {
    const { stockWrap, patchedWrap } = wrappers();
    for (let pass = 0; pass < 3; pass += 1) {
      for (const width of [10, 40, 10, 17]) {
        for (const rows of [1, 5, 24, 100]) {
          for (const frame of FRAMES) {
            expect(patchedWrap.wrapper(frame, width, rows)).toEqual(
              stockWrap.wrapper(frame, width, rows),
            );
          }
        }
      }
    }
  });

  test('an unchanged line is wrapped once', () => {
    const { patchedWrap } = wrappers();
    const frame = 'first line\nsecond line\nthird line';
    patchedWrap.wrapper(frame, 40, 10);
    const afterFirst = patchedWrap.calls();
    expect(afterFirst).toBe(3);
    patchedWrap.wrapper(frame, 40, 10);
    patchedWrap.wrapper(`${frame}\nfourth line`, 40, 10);
    expect(patchedWrap.calls()).toBe(afterFirst + 1);
  });

  test('a new width wraps the line again', () => {
    const { patchedWrap } = wrappers();
    patchedWrap.wrapper('a line that needs wrapping', 10, 10);
    const rows = patchedWrap.wrapper('a line that needs wrapping', 20, 10);
    expect(rows).toEqual(['a line that needs wr', 'apping']);
    expect(patchedWrap.calls()).toBe(2);
  });

  test('changing the returned rows leaves the next answer alone', () => {
    const { patchedWrap } = wrappers();
    const frame = 'alpha\nbeta';
    const first = patchedWrap.wrapper(frame, 40, 10);
    first.push('corrupt');
    first[0] = 'corrupt';
    expect(patchedWrap.wrapper(frame, 40, 10)).toEqual(['alpha', 'beta']);
  });

  test('the cache stays bounded and still answers like stock past its limit', () => {
    const { stockWrap, patchedWrap } = wrappers();
    const many = Array.from(
      { length: WRAP_CACHE_ENTRIES * 2 + 10 },
      (_row, index) => `line ${index}`,
    );
    const frame = many.join('\n');
    const rows = many.length + 5;
    expect(patchedWrap.wrapper(frame, 40, rows)).toEqual(stockWrap.wrapper(frame, 40, rows));
    expect(patchedWrap.wrapper.$ODwraps?.size).toBeLessThanOrEqual(WRAP_CACHE_ENTRIES);
    expect(patchedWrap.wrapper(frame, 40, rows)).toEqual(stockWrap.wrapper(frame, 40, rows));
  });
});
