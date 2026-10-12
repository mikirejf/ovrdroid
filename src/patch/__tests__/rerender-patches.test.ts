import { afterEach, describe, expect, test } from 'bun:test';

import { patchSource } from '../../binary/apply.ts';
import { patches } from '../patches.ts';
import type { Rebase } from '../rebase.ts';
import { applies, rebaseAll } from '../rebase.ts';
import { CHAT_INPUT_CALLBACKS, rerenderPatches } from '../rerender-patches.ts';
import { sourceApp, STOCK } from './ink-frame-harness.ts';
import { patchNamed, payloadFunction, strayNames } from './payload.ts';

const SLOW_PATCH_MS = 120_000;

const rebases = rebaseAll(
  rerenderPatches,
  (STOCK ?? []).map((module) => module.text),
);

function rebased(name: string): Rebase {
  const found = rebases.find((rebase) => rebase.name === name);
  if (found === undefined) {
    throw new Error(`${name} is missing from the rerender patches`);
  }
  return found;
}

describe('every name of three characters or fewer in a payload is captured or owned', () => {
  test.each(rerenderPatches.map((patch) => [patch.name, patch] as const))('%s', (_name, patch) => {
    expect(strayNames(patch)).toEqual([]);
  });
});

describe('a companion patch is named after the patch it needs, so --without removes both', () => {
  test.each([
    ['footer-memo', 'footer-memo-key'],
    ['chat-input-stable', 'chat-input-stable-use'],
  ])('%s', (owner, companion) => {
    const names = rerenderPatches.map((patch) => patch.name);
    expect(names).toContain(owner);
    expect(names).toContain(companion);
    expect(companion.startsWith(`${owner}-`)).toBe(true);
  });
});

describe.skipIf(STOCK === undefined)(
  'every rerender patch applies to the shipped bundle once',
  () => {
    test.each(rerenderPatches.map((patch) => [patch.name] as const))('%s', (name) => {
      const rebase = rebased(name);
      expect(applies(rebase)).toBe(true);
      expect(rebase.matches).toBe(1);
    });

    test(
      'the set applies on top of every other shipped patch',
      () => {
        const shipped = new Set(patches.map((patch) => patch.name));
        const extra = rerenderPatches.filter((patch) => !shipped.has(patch.name));
        const text = patchSource(sourceApp(), [...patches, ...extra])
          .map((module) => module.text)
          .join('\n');
        for (const owned of ['$ODpropsEq', '$ODIn', '$ODprogressSane', '$ODfootKey']) {
          expect(text).toContain(owned);
        }
      },
      SLOW_PATCH_MS,
    );

    test('the chat input call site passes every callback the wrapper steadies', () => {
      const anchor = 'children:t(Hc,{';
      const text = sourceApp()
        .map((module) => module.text)
        .find((module) => module.includes(anchor));
      const start = text?.indexOf(anchor) ?? 0;
      const site = text?.slice(start, start + 3000);
      for (const callback of CHAT_INPUT_CALLBACKS) {
        expect(site).toContain(`${callback}:`);
      }
    });
  },
);

interface Flat {
  status: string;
  prUrl?: string | undefined;
  additions?: number | undefined;
}

interface PrService {
  state: Flat;
  emitted: number;
  publish: (state: Flat) => Flat;
}

type PrServiceClass = new () => PrService;

function prServiceWith(methods: string): PrServiceClass {
  return payloadFunction<[], PrServiceClass>(
    [],
    `return class{state={status:"idle"};emitted=0;${methods}emitStateChange(){this.emitted+=1}}`,
  )();
}

describe('pr-state-same-skip', () => {
  const patch = patchNamed(rerenderPatches, 'pr-state-same-skip');
  const Stock = prServiceWith(patch.find);
  const Patched = prServiceWith(patch.replace);

  test('stock tells every subscriber about an equal state', () => {
    const service = new Stock();
    service.publish({ status: 'idle' });
    service.publish({ status: 'idle' });
    expect(service.emitted).toBe(2);
  });

  test('a fresh object with the same fields tells nobody', () => {
    const service = new Patched();
    service.publish({ status: 'idle' });
    expect(service.emitted).toBe(0);
    const found = { status: 'found', prUrl: 'https://x/1', additions: 3 };
    service.publish(found);
    service.publish({ ...found });
    expect(service.emitted).toBe(1);
  });

  test('the state that is kept stays the first one of an equal run', () => {
    const service = new Patched();
    const first = { status: 'not-found' };
    service.publish(first);
    service.publish({ status: 'not-found' });
    expect(service.state).toBe(first);
  });

  test('a changed field, a new field or a dropped field tells subscribers once each', () => {
    const service = new Patched();
    service.publish({ status: 'found', prUrl: 'https://x/1', additions: 3 });
    service.publish({ status: 'found', prUrl: 'https://x/1', additions: 4 });
    service.publish({ status: 'found', prUrl: 'https://x/1' });
    service.publish({ status: 'found', prUrl: 'https://x/1', additions: 4 });
    service.publish({ status: 'error' });
    expect(service.emitted).toBe(5);
    expect(service.state).toEqual({ status: 'error' });
  });

  test('a field that is undefined is not the same as a field that is missing', () => {
    const service = new Patched();
    service.publish({ status: 'found', prUrl: undefined });
    service.publish({ status: 'found', additions: undefined });
    expect(service.emitted).toBe(2);
  });

  test('publish still returns the state it was given', () => {
    const service = new Patched();
    const next = { status: 'idle' };
    expect(service.publish(next)).toBe(next);
  });

  test('the same sequence of states ends where stock ends', () => {
    const sequence: Flat[] = [
      { status: 'loading' },
      { status: 'found', prUrl: 'u', additions: 1 },
      { status: 'found', prUrl: 'u', additions: 1 },
      { status: 'error' },
      { status: 'error' },
      { status: 'not-found' },
    ];
    const stock = new Stock();
    const patched = new Patched();
    for (const state of sequence) {
      stock.publish({ ...state });
      patched.publish({ ...state });
    }
    expect(patched.state).toEqual(stock.state);
    expect(stock.emitted).toBe(6);
    expect(patched.emitted).toBe(4);
  });
});

type Deps = [string | string[], string, string];

function depsOf(text: string, ids: string[]): Deps {
  return payloadFunction<[string[], string, string], Deps>(
    ['yC', 'zX', 'ob'],
    `return ${text.slice(text.lastIndexOf(',[') + 1, -1)}`,
  )(ids, 'favorites', 'models');
}

describe('model-cycle-memo-key', () => {
  const patch = patchNamed(rerenderPatches, 'model-cycle-memo-key');

  test('stock keys the memo on the array itself, so a fresh equal array is a new key', () => {
    const ids = ['a', 'b'];
    expect(depsOf(patch.find, ids)[0]).toBe(ids);
    expect(depsOf(patch.find, ['a', 'b'])[0]).not.toBe(ids);
  });

  test('the patch keys it on the ids, so equal ids are the same key', () => {
    expect(depsOf(patch.replace, ['a', 'b'])).toEqual(depsOf(patch.replace, ['a', 'b']));
  });

  test('other ids, another order or an empty list are other keys', () => {
    const [base] = depsOf(patch.replace, ['a', 'b']);
    expect(depsOf(patch.replace, ['a', 'c'])[0]).not.toBe(base);
    expect(depsOf(patch.replace, ['b', 'a'])[0]).not.toBe(base);
    expect(depsOf(patch.replace, [])[0]).not.toBe(base);
    expect(depsOf(patch.replace, ['ab'])[0]).not.toBe(base);
  });

  test('the favorites and the model list stay in the key', () => {
    expect(depsOf(patch.replace, ['a']).slice(1)).toEqual(['favorites', 'models']);
  });

  test('only the key array changed', () => {
    expect(patch.replace.replace('[yC.join("\\x00"),zX,ob]', '[yC,zX,ob]')).toBe(patch.find);
  });
});

type Params = Record<string, number>;

interface Update {
  text?: string;
  error?: string | null;
  parameters?: Params;
}

interface Counts {
  strings: number;
  objects: number;
}

type Sanitize = (updates?: Update[]) => Update[] | undefined;

function sanitizerOf(expression: string, counts: Counts): Sanitize {
  const sanitizeText = (text: string | null | undefined): string | null | undefined => {
    counts.strings += 1;
    return typeof text === 'string' ? text.toUpperCase() : text;
  };
  const sanitizeParams = (params: Params | undefined): Params | undefined => {
    counts.objects += 1;
    return params === undefined ? params : { ...params, seen: 1 };
  };
  return payloadFunction<[typeof sanitizeText, typeof sanitizeParams], Sanitize>(
    ['$e', 'Ee'],
    `return (j)=>{let ${expression};return _e}`,
  )(sanitizeText, sanitizeParams);
}

describe('tool-progress-sanitize-cache', () => {
  const patch = patchNamed(rerenderPatches, 'tool-progress-sanitize-cache');

  afterEach(() => {
    Reflect.deleteProperty(globalThis, '$ODprogressSane');
  });

  test('stock sanitizes every update on every render', () => {
    const counts = { strings: 0, objects: 0 };
    const run = sanitizerOf(patch.find, counts);
    const updates = [{ text: 'a' }, { text: 'b' }];
    run(updates);
    run(updates);
    expect(counts.objects).toBe(4);
  });

  test('an update seen before is not sanitized again and comes back as the same object', () => {
    const counts = { strings: 0, objects: 0 };
    const run = sanitizerOf(patch.replace, counts);
    const updates = [{ text: 'a' }, { text: 'b' }];
    const first = run(updates);
    const second = run([...updates, { text: 'c' }]);
    expect(counts.objects).toBe(3);
    expect(second?.[0]).toBe(first?.[0]);
    expect(second?.[1]).toBe(first?.[1]);
  });

  test('the sanitized update has the fields stock gives it', () => {
    const stock = sanitizerOf(patch.find, { strings: 0, objects: 0 });
    const patched = sanitizerOf(patch.replace, { strings: 0, objects: 0 });
    const updates: Update[] = [
      { text: 'a', error: 'bad', parameters: { n: 1 } },
      { text: 'b', error: null },
      {},
    ];
    expect(patched(updates)).toEqual(stock(updates));
    expect(patched(updates)).toEqual(stock(updates));
  });

  test('the original update is left as it was', () => {
    const run = sanitizerOf(patch.replace, { strings: 0, objects: 0 });
    const update = { text: 'a' };
    run([update]);
    expect(update).toEqual({ text: 'a' });
  });

  test('no updates give no list, as stock does', () => {
    const run = sanitizerOf(patch.replace, { strings: 0, objects: 0 });
    expect(run()).toBeUndefined();
  });

  test('a new object with the same text is sanitized again', () => {
    const counts = { strings: 0, objects: 0 };
    const run = sanitizerOf(patch.replace, counts);
    run([{ text: 'a' }]);
    run([{ text: 'a' }]);
    expect(counts.objects).toBe(2);
  });
});
