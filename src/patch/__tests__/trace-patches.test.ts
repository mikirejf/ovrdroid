import { describe, expect, test } from 'bun:test';

import { modulePatches, tracePatches } from '../trace-patches.ts';

describe('tracePatches', () => {
  test('every find string is unique across the list', () => {
    const seen = new Set(tracePatches.map((patch) => patch.find));
    expect(seen.size).toBe(tracePatches.length);
  });

  test('every patch actually changes something', () => {
    for (const patch of tracePatches) {
      expect(patch.replace).not.toBe(patch.find);
    }
  });

  test('the injected template literal carries a backslash-t escape', () => {
    const backslashT = `${String.fromCodePoint(92)}t`;
    expect(tracePatches[0]?.replace).toContain(backslashT);
  });
});

describe('modulePatches', () => {
  test('every find string is unique across the list', () => {
    const seen = new Set(modulePatches.map((patch) => patch.find));
    expect(seen.size).toBe(modulePatches.length);
  });

  test('every patch actually changes something', () => {
    for (const patch of modulePatches) {
      expect(patch.replace).not.toBe(patch.find);
    }
  });

  test('the dump no longer filters modules by cost', () => {
    expect(modulePatches[2]?.replace).not.toContain('0.2?');
  });
});

interface ModuleExports {
  value: number;
}

interface ModuleRecord {
  exports: ModuleExports;
}

type CjsBody = (exports: ModuleExports, module: ModuleRecord) => void;

interface Clock {
  now: () => number;
}

interface Instrument {
  cjs: (body: CjsBody) => () => ModuleExports;
  esm: (body: () => ModuleExports) => () => ModuleExports;
  selfMs: number[];
  stack: number[];
}

type InstrumentFactory = (clock: Clock) => Instrument;

function instrument(clock: Clock): Instrument {
  const cjs = modulePatches[0]?.replace ?? '';
  const esm = modulePatches[1]?.replace ?? '';
  const source = `${cjs}${esm}return{cjs:yT,esm:o,selfMs:__ot,stack:__os};`;
  // SAFETY: the evaluated source is the patch payload itself, and its trailing
  // return statement produces exactly the InstrumentFactory shape.
  // oxlint-disable-next-line no-implied-eval, no-unsafe-type-assertion, no-new-func
  const make = new Function('performance', source) as InstrumentFactory;
  return make(clock);
}

describe('module timing payload', () => {
  test('charges a nested import to the child, not the parent', () => {
    let ms = 0;
    const wrappers = instrument({ now: () => ms });

    const child = wrappers.esm(() => {
      ms += 10;
      return { value: 1 };
    });
    const parent = wrappers.esm(() => {
      ms += 5;
      child();
      ms += 15;
      return { value: 2 };
    });

    parent();

    expect(wrappers.selfMs[0]).toBeCloseTo(10);
    expect(wrappers.selfMs[1]).toBeCloseTo(20);
    expect(wrappers.stack).toHaveLength(0);
  });

  test('keeps the stack balanced when a child throws and the parent catches', () => {
    let ms = 0;
    const wrappers = instrument({ now: () => ms });

    const child = wrappers.esm(() => {
      ms += 10;
      throw new Error('optional import missing');
    });
    const parent = wrappers.esm(() => {
      try {
        child();
      } catch {
        ms += 0;
      }
      ms += 20;
      return { value: 2 };
    });

    parent();

    expect(wrappers.selfMs[0]).toBeCloseTo(10);
    expect(wrappers.selfMs[1]).toBeCloseTo(20);
    expect(wrappers.stack).toHaveLength(0);
  });

  test('times a commonjs module body and returns its exports', () => {
    let ms = 0;
    const wrappers = instrument({ now: () => ms });

    const mod = wrappers.cjs((_exports, module) => {
      ms += 7;
      module.exports = { value: 3 };
    });

    expect(mod()).toEqual({ value: 3 });
    expect(wrappers.selfMs[0]).toBeCloseTo(7);
    expect(wrappers.stack).toHaveLength(0);
  });
});
