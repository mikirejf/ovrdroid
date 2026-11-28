import { expect, mock, test } from 'bun:test';

import { applies, rebasePatch } from '../rebase.ts';
import { staleEditPatches } from '../stale-edit-patches.ts';
import { describeStrayNames, patchNamed, payloadFunction } from './payload.ts';
import { requireStock } from './stock-scanner.ts';

const patch = patchNamed(staleEditPatches, 'edit-refuses-stale-change-all');

type Match = () => { start: number; end: number } | undefined;

function accepts(source: string) {
  return payloadFunction<
    [
      stale: boolean,
      edit: { change_all: boolean },
      match: Match,
      original: string,
      visible: string,
    ],
    boolean
  >(['g', 'M', 'Rt', 'S', 'v'], `let y=false;${source};return true`);
}

function once() {
  return { start: 0, end: 3 };
}

test('the guard anchors on the stock binary', () => {
  expect(
    applies(
      rebasePatch(
        patch,
        requireStock().map((module) => module.text),
      ),
    ),
  ).toBe(true);
});

test('refuses stale change_all even when the stock matcher would accept', () => {
  expect(accepts(patch.find)(true, { change_all: true }, once, 'one', 'one')).toBe(true);
  expect(accepts(patch.replace)(true, { change_all: true }, once, 'one', 'one')).toBe(false);
});

test('leaves fresh change_all and a single exact stale match alone', () => {
  const patched = accepts(patch.replace);
  expect(patched(false, { change_all: true }, once, 'one', 'one')).toBe(true);
  expect(patched(true, { change_all: false }, once, 'one', 'one')).toBe(true);
});

test('preserves stock refusal when there is no unique match or when the match was redacted', () => {
  const patched = accepts(patch.replace);
  expect(patched(true, { change_all: false }, mock<Match>(), 'one', 'one')).toBe(false);
  expect(patched(true, { change_all: false }, once, 'one', '***')).toBe(false);
});

describeStrayNames(staleEditPatches);
