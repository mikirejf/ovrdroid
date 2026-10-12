import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_DESCENDANTS_PER_ROOT,
  DEFAULT_MAX_DEPTH,
  DEFAULT_SUBAGENTS_PER_DAEMON,
  MAY_NEST,
  NEST_CAP,
  NEST_REFUSAL,
  NESTING_CEILING,
  nestingPatches,
} from '../nesting-patches.ts';
import { describeStrayNames, patchNamed, payloadFunction } from './payload.ts';
import { shipped, stockDroid, stockText } from './stock-scanner.ts';

describeStrayNames(nestingPatches);

const mayNest = payloadFunction<
  [],
  (level: number, maxDepth: number | undefined, ceiling: number) => boolean
>([], `${MAY_NEST};return $ODmayNest`)();

const nestCap = payloadFunction<[], (value: unknown, fallback: number, max?: number) => number>(
  [],
  `${NEST_CAP};return $ODnestCap`,
)();

interface LedgerRecord {
  subagentType?: string;
  maxDepth?: number;
}

const nestRefusal = payloadFunction<
  [],
  (record: LedgerRecord | undefined, level: number, ceiling: number) => string
>([], `${NEST_REFUSAL};return $ODnestRefusal`)();

interface NestCase {
  name: string;
  level: number;
  maxDepth?: number;
  allowed: boolean;
}

const NEST_CASES: NestCase[] = [
  { name: 'the main session, with no droid', level: 0, allowed: true },
  { name: 'a level 1 droid without maxDepth', level: 1, allowed: false },
  { name: 'a level 1 droid with maxDepth 1', level: 1, maxDepth: 1, allowed: false },
  { name: 'a level 1 droid with maxDepth 3', level: 1, maxDepth: 3, allowed: true },
  { name: 'a level 2 droid with maxDepth 3', level: 2, maxDepth: 3, allowed: true },
  { name: 'a level 3 droid with maxDepth 3', level: 3, maxDepth: 3, allowed: false },
  { name: 'a level 2 droid without maxDepth', level: 2, allowed: false },
  {
    name: 'a level 3 droid with maxDepth 9, held by the ceiling',
    level: 3,
    maxDepth: 9,
    allowed: false,
  },
];

describe('a session may launch a subagent only when its own maxDepth is above its level', () => {
  test.each(NEST_CASES)('$name', ({ level, maxDepth, allowed }) => {
    expect(mayNest(level, maxDepth, NESTING_CEILING)).toBe(allowed);
  });
});

describe('the refusal names the droid, its level, and its maxDepth', () => {
  test('a droid with an explicit maxDepth', () => {
    const text = nestRefusal({ subagentType: 'poteto-agent', maxDepth: 3 }, 3, NESTING_CEILING);
    expect(text).toContain('poteto-agent runs at level 3 and its maxDepth is 3.');
    expect(text).toContain('greater than its level');
    expect(text).toBe(
      'poteto-agent runs at level 3 and its maxDepth is 3. A subagent may launch subagents only when its maxDepth is greater than its level, so it cannot launch one. Complete this work yourself instead of delegating further.',
    );
  });

  test('a droid without maxDepth says the default applies', () => {
    const text = nestRefusal({ subagentType: 'coder-heavy' }, 2, NESTING_CEILING);
    expect(text).toContain('coder-heavy runs at level 2 and its maxDepth is 1 (the default).');
    expect(text).toBe(
      'coder-heavy runs at level 2 and its maxDepth is 1 (the default). A subagent may launch subagents only when its maxDepth is greater than its level, so it cannot launch one. Complete this work yourself instead of delegating further.',
    );
  });

  test('a droid held back by the ceiling says so', () => {
    const text = nestRefusal({ subagentType: 'deep', maxDepth: 9 }, 3, NESTING_CEILING);
    expect(text).toContain('deep runs at level 3 and its maxDepth is 9');
    expect(text).toContain(`only down to level ${NESTING_CEILING}`);
    expect(text).toBe(
      'deep runs at level 3 and its maxDepth is 9, but Droid allows subagents only down to level 3, so it cannot launch a subagent. Complete this work yourself instead of delegating further.',
    );
  });
});

describe('a count cap from settings', () => {
  test.each([
    ['a positive integer is used', 7, 7],
    ['an absent value falls back to the default', undefined, 25],
    ['zero falls back', 0, 25],
    ['a negative number falls back', -3, 25],
    ['a fraction falls back', 2.5, 25],
    ['a string falls back', '9', 25],
  ] as const)('%s', (_case, value, cap) => {
    expect(nestCap(value, 25)).toBe(cap);
  });

  test.each([
    ['a value at the maximum is used', 3, 3],
    ['a value over the maximum falls back', 4, 2],
    ['a value under the maximum is used', 1, 1],
  ] as const)('%s', (_case, value, cap) => {
    expect(nestCap(value, 2, 3)).toBe(cap);
  });
});

interface Gates {
  o6: () => { maxDepth: number; maxActiveDescendantsPerRoot: number };
  a6: () => boolean;
  kTe: (call: { parentSessionId: string }) => string | undefined;
}

interface Ledger {
  records: Record<string, LedgerRecord & { parentSessionId: string }>;
  current: string;
  specMode?: boolean;
  general?: { nestedTaskDelegation?: { maxDepth?: unknown; maxActiveDescendantsPerRoot?: number } };
}

function depthOf(ledger: Ledger, sessionId: string): number {
  const parent = ledger.records[sessionId]?.parentSessionId;
  return parent === undefined ? 0 : depthOf(ledger, parent) + 1;
}

const gatesPatch = patchNamed(nestingPatches, 'nesting-gates-read-the-droid-max-depth');

function gatesOver(ledger: Ledger): Gates {
  const settings = () => ({ settings: { general: ledger.general ?? {} } });
  const session = () => ({
    isSpecMode: () => ledger.specMode === true,
    getCurrentSessionId: () => ledger.current,
  });
  const record = (sessionId: string) => ledger.records[sessionId];
  const lineage = (sessionId: string) => ({ lineage: { depth: depthOf(ledger, sessionId) } });
  return payloadFunction<unknown[], Gates>(
    ['C', 'j6', 'hn', '$z', 'm', 'n'],
    `${gatesPatch.replace};return{o6,a6,kTe}`,
  )(settings, NESTING_CEILING, record, lineage, session, () => null);
}

const CHAIN: Ledger['records'] = {
  potetoOne: { parentSessionId: 'main', subagentType: 'poteto-agent', maxDepth: 3 },
  potetoTwo: { parentSessionId: 'potetoOne', subagentType: 'poteto-agent', maxDepth: 3 },
  verifier: { parentSessionId: 'potetoTwo', subagentType: 'generalPurpose' },
  potetoThree: { parentSessionId: 'potetoTwo', subagentType: 'poteto-agent', maxDepth: 3 },
  coder: { parentSessionId: 'potetoOne', subagentType: 'coder-heavy' },
  plain: { parentSessionId: 'main', subagentType: 'coder-medium' },
};

function ceilingOf(maxDepth: unknown): NonNullable<Ledger['general']> {
  return { nestedTaskDelegation: { maxDepth } };
}

describe('the Task tool is offered only to a subagent that may nest', () => {
  test.each([
    { name: 'the main session', current: 'main', byDefault: false, atThree: false },
    { name: 'poteto-agent at level 1', current: 'potetoOne', byDefault: true, atThree: true },
    { name: 'poteto-agent at level 2', current: 'potetoTwo', byDefault: false, atThree: true },
    { name: 'poteto-agent at level 3', current: 'potetoThree', byDefault: false, atThree: false },
    { name: 'generalPurpose at level 3', current: 'verifier', byDefault: false, atThree: false },
    { name: 'coder-heavy at level 2', current: 'coder', byDefault: false, atThree: false },
    { name: 'coder-medium at level 1', current: 'plain', byDefault: false, atThree: false },
  ])('$name: ceiling 2 by default, 3 when set', ({ current, byDefault, atThree }) => {
    expect(gatesOver({ records: CHAIN, current }).a6()).toBe(byDefault);
    expect(gatesOver({ records: CHAIN, current, general: ceilingOf(3) }).a6()).toBe(atThree);
  });

  test('a ceiling of 1 keeps the Task tool from every subagent', () => {
    for (const current of ['potetoOne', 'potetoTwo', 'plain']) {
      expect(gatesOver({ records: CHAIN, current, general: ceilingOf(1) }).a6()).toBe(false);
    }
  });

  test('spec mode keeps it off, as stock does', () => {
    expect(gatesOver({ records: CHAIN, current: 'potetoOne', specMode: true }).a6()).toBe(false);
  });
});

describe('a launch from over the limit is refused with the reason', () => {
  const byDefault = gatesOver({ records: CHAIN, current: 'main' }).kTe;
  const atThree = gatesOver({ records: CHAIN, current: 'main', general: ceilingOf(3) }).kTe;

  test.each([
    ['the main session', 'main'],
    ['poteto-agent at level 1', 'potetoOne'],
  ] as const)('%s may launch', (_case, parentSessionId) => {
    expect(byDefault({ parentSessionId })).toBeUndefined();
  });

  test('poteto-agent at level 2 may launch only under a ceiling of 3', () => {
    expect(atThree({ parentSessionId: 'potetoTwo' })).toBeUndefined();
    expect(byDefault({ parentSessionId: 'potetoTwo' })).toBe(
      'poteto-agent runs at level 2 and its maxDepth is 3, but Droid allows subagents only down to level 2, so it cannot launch a subagent. Complete this work yourself instead of delegating further.',
    );
  });

  test('a ceiling of 1 refuses a launch from level 1 and names the ceiling', () => {
    const atOne = gatesOver({ records: CHAIN, current: 'main', general: ceilingOf(1) }).kTe;
    expect(atOne({ parentSessionId: 'potetoOne' })).toContain(
      'poteto-agent runs at level 1 and its maxDepth is 3, but Droid allows subagents only down to level 1',
    );
  });

  test.each([
    [
      'poteto-agent at level 3',
      'potetoThree',
      'poteto-agent runs at level 3 and its maxDepth is 3',
    ],
    [
      'generalPurpose at level 3',
      'verifier',
      'generalPurpose runs at level 3 and its maxDepth is 1',
    ],
    ['coder-heavy at level 2', 'coder', 'coder-heavy runs at level 2 and its maxDepth is 1'],
    ['coder-medium at level 1', 'plain', 'coder-medium runs at level 1 and its maxDepth is 1'],
  ] as const)('%s may not', (_case, parentSessionId, reason) => {
    expect(atThree({ parentSessionId })).toContain(reason);
    expect(byDefault({ parentSessionId })).toContain(reason);
  });
});

describe('the depth ceiling comes from nestedTaskDelegation.maxDepth', () => {
  const maxDepthOf = (general: NonNullable<Ledger['general']> = {}): number =>
    gatesOver({ records: CHAIN, current: 'main', general }).o6().maxDepth;

  test('it is 2 when settings say nothing', () => {
    expect(maxDepthOf()).toBe(DEFAULT_MAX_DEPTH);
    expect(maxDepthOf({})).toBe(2);
    expect(maxDepthOf({ nestedTaskDelegation: {} })).toBe(2);
  });

  test.each([1, 2, 3])('a setting of %p is the ceiling', (maxDepth) => {
    expect(maxDepthOf(ceilingOf(maxDepth))).toBe(maxDepth);
  });

  test.each([
    ['above the compiled maximum', 4],
    ['zero', 0],
    ['negative', -1],
    ['a fraction', 1.5],
    ['a string', '3'],
    ['null', null],
  ])('an invalid setting (%s) falls back to 2', (_label, maxDepth) => {
    expect(maxDepthOf(ceilingOf(maxDepth))).toBe(DEFAULT_MAX_DEPTH);
  });

  test('the compiled maximum stays 3', () => {
    expect(NESTING_CEILING).toBe(3);
  });
});

describe('the per-root cap comes from settings', () => {
  test('defaults when settings say nothing', () => {
    expect(gatesOver({ records: CHAIN, current: 'main' }).o6()).toEqual({
      maxDepth: DEFAULT_MAX_DEPTH,
      maxActiveDescendantsPerRoot: DEFAULT_DESCENDANTS_PER_ROOT,
    });
  });

  test('reads nestedTaskDelegation.maxActiveDescendantsPerRoot', () => {
    const general = { nestedTaskDelegation: { maxActiveDescendantsPerRoot: 4 } };
    expect(
      gatesOver({ records: CHAIN, current: 'main', general }).o6().maxActiveDescendantsPerRoot,
    ).toBe(4);
  });
});

interface DaemonSlot {
  reserveTaskSubagentSlotIfEligible: (tags: unknown, taskProcess: boolean) => number | undefined;
}

const daemonPatch = patchNamed(nestingPatches, 'nesting-daemon-cap-from-settings');

function reservedCap(settingsText?: string): number | undefined {
  const fs = {
    readFileSync: () => {
      if (settingsText === undefined) {
        throw new Error('ENOENT');
      }
      return settingsText;
    },
  };
  const slot = payloadFunction<unknown[], DaemonSlot>(
    ['O', 'F', 'L', 'w', 'nd'],
    `return{${daemonPatch.replace}}`,
  )(
    fs,
    { join: (...parts: string[]) => parts.join('/') },
    () => '/home',
    () => '.factory',
    () => false,
  );
  const daemon = { droidRegistry: { reserveTaskSubagentSlot: (cap: number) => cap } };
  return slot.reserveTaskSubagentSlotIfEligible.call(daemon, [], true);
}

describe('the per-daemon cap comes from the user settings file', () => {
  test('defaults when the file is missing', () => {
    expect(reservedCap()).toBe(DEFAULT_SUBAGENTS_PER_DAEMON);
  });

  test('defaults when the key is unset', () => {
    expect(reservedCap('{"sessionTitleModel":"x"}')).toBe(DEFAULT_SUBAGENTS_PER_DAEMON);
  });

  test('reads nestedTaskDelegation.maxActiveTaskSubagentsPerDaemon, comments allowed', () => {
    expect(
      reservedCap('{\n// cap\n"nestedTaskDelegation":{"maxActiveTaskSubagentsPerDaemon":12},}'),
    ).toBe(12);
  });
});

const { patchedText, rebasedNamed } = shipped(nestingPatches);

const FLAG_READ = /[\w$]+\([\w$]+\.NestedTaskDelegation\)/u;

describe.skipIf(stockDroid === undefined)('the shipped binary', () => {
  test('reads the NestedTaskDelegation flag before patching and never after', () => {
    expect(stockText).toMatch(FLAG_READ);
    expect(patchedText).not.toMatch(FLAG_READ);
  });

  test('records the launched droid maxDepth in the ledger and always admits through it', () => {
    const ledger = rebasedNamed('nesting-ledger-records-max-depth');
    expect(ledger.find).toContain('else ');
    expect(patchedText).not.toContain(ledger.find);
    expect(patchedText).toContain(ledger.replace);
  });

  test('raises the lineage ceiling', () => {
    expect(patchedText).toContain(
      `={max_depth:${NESTING_CEILING},max_active_descendants_per_root:25,`,
    );
  });
});
