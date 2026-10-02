import { describe, expect, test } from 'bun:test';

import { describeDrift } from '../../binary/apply.ts';
import type { App } from '../../binary/graph.ts';
import { joinApp, readApp } from '../../binary/graph.ts';
import { backupPath, INSTALLED_DROID } from '../../paths.ts';
import { CONSTRUCTOR_BINDS, findMarker, patches } from '../patches.ts';
import { applies, rebaseAll } from '../rebase.ts';
import { holePattern, literalParts } from '../tokens.ts';
import { STOCK_HUB_HEADER, STOCK_HUB_METHODS, STOCK_PID_HELPERS } from './mcp-hub-stock.ts';

async function stockModulesOf(target: string): Promise<App | undefined> {
  let app: App;
  try {
    app = readApp(await Bun.file(target).bytes());
  } catch {
    return undefined;
  }
  return findMarker(app[0].text) === undefined ? app : undefined;
}

const modules =
  (await stockModulesOf(INSTALLED_DROID)) ?? (await stockModulesOf(backupPath(INSTALLED_DROID)));

const source = modules === undefined ? undefined : joinApp(modules);

function hubCopiesInBundle(text: string): number {
  const parts = literalParts(text);
  const pattern = new RegExp(holePattern(text).source, 'gu');
  return (modules ?? [])
    .filter((module) => parts.every((part) => module.text.includes(part)))
    .reduce((total, module) => total + [...module.text.matchAll(pattern)].length, 0);
}

const rebases = rebaseAll(
  patches,
  (modules ?? []).map((module) => module.text),
);

const ZOD_ANCHOR = rebases.find((rebase) => rebase.name === 'zod-v3-lazy-bound-methods')?.find;

const schemaChunk =
  ZOD_ANCHOR === undefined
    ? undefined
    : modules?.find((module) => module.text.includes(ZOD_ANCHOR))?.text;

const cases = rebases.map((rebase) => [rebase.name, rebase] as const);

describe.skipIf(source === undefined)(
  'every patch still finds its place in the shipped bundle',
  () => {
    test.each(cases)('%s applies', (_name, rebase) => {
      expect(applies(rebase) ? [] : [describeDrift(rebase)]).toEqual([]);
    });
  },
);

const hubFixture = [
  ['pid helpers', STOCK_PID_HELPERS],
  ['class header', STOCK_HUB_HEADER],
  ...Object.entries(STOCK_HUB_METHODS),
] as const;

describe.skipIf(source === undefined)(
  'the MCP hub fixture is copied from the bundle, up to minified names',
  () => {
    test.each(hubFixture)('%s occurs exactly once', (_name, text) => {
      expect(hubCopiesInBundle(text)).toBe(1);
    });
  },
);

function enclosingClass(text: string, anchor: string): string {
  const before = text.slice(0, text.indexOf(anchor));
  const name = [...before.matchAll(/class (?<name>[\w$]+)\{/gu)].at(-1)?.groups?.['name'];
  if (name === undefined) {
    throw new Error('the zod constructor sits in no class');
  }
  return name;
}

const SCHEMA_CLASS =
  schemaChunk === undefined || ZOD_ANCHOR === undefined
    ? ''
    : enclosingClass(schemaChunk, ZOD_ANCHOR);
const SCHEMA_REGION_BYTES = 200_000;

function classBodyAt(text: string, start: number): string {
  const open = text.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') {
      depth += 1;
    } else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(open + 1, i);
      }
    }
  }
  throw new Error('unbalanced class body');
}

function methodNamesIn(body: string): string[] {
  const names: string[] = [];
  for (const match of body.matchAll(/(?:^|[;}])\s*(?:static\s+)?(?<name>[A-Za-z_$][\w$]*)\(/gu)) {
    let depth = 1;
    let i = match.index + match[0].length;
    while (i < body.length && depth > 0) {
      if (body[i] === '(') {
        depth += 1;
      } else if (body[i] === ')') {
        depth -= 1;
      }
      i += 1;
    }
    while (body[i] === ' ') {
      i += 1;
    }
    if (body[i] === '{') {
      names.push(match.groups?.['name'] ?? '');
    }
  }
  return names;
}

describe.skipIf(schemaChunk === undefined)('the lazy-accessor preconditions still hold', () => {
  const text = schemaChunk ?? '';
  const bound = new Set(CONSTRUCTOR_BINDS);

  test(`no subclass of ${SCHEMA_CLASS} overrides a name the accessors install`, () => {
    const pattern = new RegExp(
      String.raw`class\s+(?<sub>[A-Za-z_$][\w$]*)\s+extends\s+${SCHEMA_CLASS}\b`,
      'gu',
    );
    const subclasses = [...text.matchAll(pattern)];
    expect(subclasses.length).toBeGreaterThan(0);

    const overrides = subclasses.flatMap((match) =>
      methodNamesIn(classBodyAt(text, match.index))
        .filter((name) => bound.has(name))
        .map((name) => `${match.groups?.['sub'] ?? ''}.${name}`),
    );

    expect(overrides).toEqual([]);
  });

  test('no code assigns one of those names onto a prototype inside the schema region', () => {
    const from = text.indexOf(`class ${SCHEMA_CLASS}{`);
    const region = text.slice(from, from + SCHEMA_REGION_BYTES);
    const assigned = [...region.matchAll(/\.prototype\.(?<name>[A-Za-z_$][\w$]*)=/gu)]
      .map((match) => match.groups?.['name'] ?? '')
      .filter((name) => bound.has(name));

    expect(assigned).toEqual([]);
  });
});
