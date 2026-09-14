import { describe, expect, test } from 'bun:test';

import { countOccurrences } from '../../binary/apply.ts';
import { readSource } from '../../binary/graph.ts';
import { backupPath, INSTALLED_DROID } from '../../paths.ts';
import { CONSTRUCTOR_BINDS, findMarker, patches } from '../patches.ts';

async function stockSourceOf(target: string): Promise<string | undefined> {
  let source: string;
  try {
    source = readSource(await Bun.file(target).bytes());
  } catch {
    return undefined;
  }
  return findMarker(source) === undefined ? source : undefined;
}

const source =
  (await stockSourceOf(INSTALLED_DROID)) ?? (await stockSourceOf(backupPath(INSTALLED_DROID)));

const cases = patches.map((patch) => [patch.name, patch.find] as const);

describe.skipIf(source === undefined)('every find string still matches the shipped bundle', () => {
  test.each(cases)('%s occurs exactly once', (_name, find) => {
    expect(countOccurrences(source ?? '', find)).toBe(1);
  });
});

const SCHEMA_CLASS = 'Sq';
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

describe.skipIf(source === undefined)('the lazy-accessor preconditions still hold', () => {
  const text = source ?? '';
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
