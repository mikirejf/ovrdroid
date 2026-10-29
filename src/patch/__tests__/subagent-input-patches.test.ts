import { describe, expect, test } from 'bun:test';

import { applies } from '../rebase.ts';
import { HEAVY_TOP, IS_SUBAGENT, subagentInputPatches } from '../subagent-input-patches.ts';
import { describeStrayNames, payloadFunction } from './payload.ts';
import { shipped, stockDroid } from './stock-scanner.ts';

describeStrayNames(subagentInputPatches);

interface Tag {
  name: string;
}

const isSubagent = payloadFunction<[Tag[]?], boolean>(['gP'], `return ${IS_SUBAGENT}`);

describe('a session is a subagent when its tags say so', () => {
  test('a subagent tag', () => {
    expect(isSubagent([{ name: 'other' }, { name: 'subagent' }])).toBe(true);
  });

  test('other tags', () => {
    expect(isSubagent([{ name: 'mission' }])).toBe(false);
  });

  test('no tags yet', () => {
    expect(isSubagent()).toBe(false);
  });
});

describe('the label line takes the heavy box characters', () => {
  const heavy = payloadFunction<[], (line: string) => string>(
    [],
    `return ($ODline)=>$ODline${HEAVY_TOP}`,
  )();

  test('corners and rules turn heavy, the text stays', () => {
    expect(heavy('\u256D\u2500\u2500 SUBAGENT \u2500\u2500\u256E')).toBe(
      '\u250F\u2501\u2501 SUBAGENT \u2501\u2501\u2513',
    );
  });
});

const { patchedText, rebasedNamed } = shipped(subagentInputPatches);

describe.skipIf(stockDroid === undefined)('the shipped binary', () => {
  test.each(subagentInputPatches.map((patch) => [patch.name] as const))('%s applies', (name) => {
    expect(applies(rebasedNamed(name))).toBe(true);
  });

  test.each(subagentInputPatches.map((patch) => [patch.name] as const))(
    '%s is in the patched source',
    (name) => {
      expect(patchedText).toContain(rebasedNamed(name).replace);
    },
  );
});
