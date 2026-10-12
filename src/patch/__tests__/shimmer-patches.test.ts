import { describe, expect, test } from 'bun:test';

import { patchSource } from '../../binary/apply.ts';
import { patches } from '../patches.ts';
import type { Rebase } from '../rebase.ts';
import { applies, rebaseAll } from '../rebase.ts';
import { shimmerPatches } from '../shimmer-patches.ts';
import { sourceApp, STOCK } from './ink-frame-harness.ts';
import { payloadFunction, strayNames } from './payload.ts';

const SLOW_PATCH_MS = 120_000;

const rebases = rebaseAll(
  shimmerPatches,
  (STOCK ?? []).map((module) => module.text),
);

function rebased(name: string): Rebase {
  const found = rebases.find((rebase) => rebase.name === name);
  if (found === undefined) {
    throw new Error(`${name} is missing from the shimmer patches`);
  }
  return found;
}

describe('every name of three characters or fewer in a payload is captured or owned', () => {
  test.each(shimmerPatches.map((patch) => [patch.name, patch] as const))('%s', (_name, patch) => {
    expect(strayNames(patch)).toEqual([]);
  });
});

describe.skipIf(STOCK === undefined)(
  'every shimmer patch applies to the shipped bundle once',
  () => {
    test.each(shimmerPatches.map((patch) => [patch.name] as const))('%s', (name) => {
      const rebase = rebased(name);
      expect(applies(rebase)).toBe(true);
      expect(rebase.matches).toBe(1);
    });

    test(
      'the set ships and applies on top of every other shipped patch',
      () => {
        const shipped = new Set(shimmerPatches.map((patch) => patch.name));
        expect(patches.filter((patch) => shipped.has(patch.name))).toHaveLength(shipped.size);
        const text = patchSource(sourceApp(), patches)
          .map((module) => module.text)
          .join('\n');
        expect(text.split('globalThis.$ODcolorize')).toHaveLength(3);
      },
      SLOW_PATCH_MS,
    );
  },
);

interface Cell {
  char: string;
  color: string;
}

interface Element {
  color: string;
  children: string;
}

interface Host {
  $ODcolorize?: (text: string, color: string) => string;
}

type Shimmer = (props: { text: string; baseColor: string }) => Element[] | string;

function cellsOf(text: string): Cell[] {
  return Array.from(text, (char, index) => ({ char, color: `#${String(index).padStart(2, '0')}` }));
}

function colored(text: string, color: string): string {
  return `<${color}>${text}</>`;
}

function elementOf(_type: string, props: Element): Element {
  return props;
}

function elementsOf(result: Element[] | string): Element[] {
  if (typeof result === 'string') {
    throw new TypeError('expected one element per letter, got a string');
  }
  return result;
}

function functionIn(statement: string, name: string): string {
  const start = statement.indexOf(`function ${name}(`);
  if (start === -1) {
    throw new Error(`${name} is missing from the statement`);
  }
  return statement.slice(start);
}

function shimmerFrom(source: string): Shimmer {
  const { renames } = rebased('shimmer-one-string');
  const shimmerName = renames['p_'] ?? 'p_';
  const names = ['jZ', 't', 'a'].map((name) => renames[name] ?? name);
  const host: Host = { $ODcolorize: colored };
  return payloadFunction<[typeof cellsOf, typeof elementOf, string, Host], Shimmer>(
    [...names, 'globalThis'],
    `${functionIn(source, shimmerName)};return ${shimmerName}`,
  )(cellsOf, elementOf, 'Text', host);
}

describe.skipIf(STOCK === undefined)('shimmer-one-string', () => {
  const stock = shimmerFrom(rebased('shimmer-one-string').find);
  const patched = shimmerFrom(rebased('shimmer-one-string').replace);
  const input = { text: 'Read file', baseColor: '#808080' };

  test('stock returns one element per letter', () => {
    expect(elementsOf(stock(input))).toHaveLength(input.text.length);
  });

  test('the patch returns the letters coloured one by one, as one string', () => {
    const expected = elementsOf(stock(input))
      .map((element) => colored(element.children, element.color))
      .join('');
    expect(patched(input)).toBe(expected);
  });

  test('an empty text gives an empty string', () => {
    expect(patched({ text: '', baseColor: '#808080' })).toBe('');
  });

  test('letters keep their order when the text has repeats and spaces', () => {
    expect(patched({ text: 'a  a', baseColor: '#808080' })).toBe(
      '<#00>a</><#01> </><#02> </><#03>a</>',
    );
  });
});

describe.skipIf(STOCK === undefined)('ink-colorize-shared', () => {
  const rebase = rebased('ink-colorize-shared');

  test('it sets the colour function before the Text component, and keeps the component', () => {
    expect(rebase.replace.startsWith('globalThis.$ODcolorize=')).toBe(true);
    expect(rebase.replace.endsWith(rebase.find)).toBe(true);
  });

  test('the colour function calls the same colour step as Text, for the foreground', () => {
    const lookup = rebase.lookups?.[0] ?? '';
    const call = /(?<name>[\w$]+)\(\w+,\w+,"foreground"\)/u.exec(lookup)?.groups?.['name'];
    if (call === undefined) {
      throw new Error('the Text colour step is missing from the lookup');
    }
    const calls: string[][] = [];
    const host: Host = {};
    const setter = rebase.replace.slice(0, rebase.replace.indexOf('function '));
    payloadFunction<[(...args: string[]) => string, Host], undefined>([call, 'globalThis'], setter)(
      (...args) => {
        calls.push(args);
        return 'out';
      },
      host,
    );
    expect(host.$ODcolorize?.('x', '#112233')).toBe('out');
    expect(calls).toEqual([['x', '#112233', 'foreground']]);
  });
});
