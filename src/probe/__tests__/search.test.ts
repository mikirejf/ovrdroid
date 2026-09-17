import { describe, expect, test } from 'bun:test';

import type { App, AppModule } from '../../binary/graph.ts';
import {
  describeOrigin,
  describeSearch,
  findPlaces,
  formatPlaces,
  moduleHolding,
  resolveName,
} from '../search.ts';

const SPAN = 10;

const HEADER = 'import{g,x,E as Ee}from"/$bunfs/root/chunk-hooks.js";';

function chunk(name: string, text: string): AppModule {
  return { name: `/$bunfs/root/${name}`, text };
}

const FOOTER = chunk(
  'chunk-footer.js',
  `${HEADER}function pc(b){return b}var T6=nr(/^x/u);let q=1`,
);

const LOGO = chunk('chunk-logo.js', 'var O$=`art`.trim(),L$=["box"];var Z0=[]');

const app: App = [chunk('entry.js', 'var a=1;let repeated=0'), FOOTER, LOGO];

describe('findPlaces counts every place a literal sits, not every line', () => {
  test('a literal in one module is found once, with its offset', () => {
    const search = findPlaces(app, 'L$=[', SPAN);
    expect(search.places).toHaveLength(1);
    expect(search.places[0]?.module).toBe('chunk-logo.js');
    expect(search.places[0]?.at).toBe(LOGO.text.indexOf('L$=['));
  });

  test('repeats inside a single one-line module are all counted', () => {
    const one: App = [chunk('one.js', 'zz;let q=1;zz;zz')];
    expect(findPlaces(one, 'zz', SPAN).places).toHaveLength(3);
  });

  test('the same literal in two modules is counted in both', () => {
    expect(findPlaces(app, 'var', SPAN).places.map((place) => place.module)).toEqual([
      'entry.js',
      'chunk-footer.js',
      'chunk-logo.js',
      'chunk-logo.js',
    ]);
  });

  test('a literal nothing carries yields no places rather than throwing', () => {
    expect(findPlaces(app, 'absent-from-every-chunk', SPAN).places).toEqual([]);
  });

  test('the context is quoted, so escapes in minified code stay readable', () => {
    expect(findPlaces(app, 'L$=[', SPAN).places[0]?.context.startsWith('"')).toBe(true);
  });
});

describe('the verdict says whether the literal can anchor a patch', () => {
  test('exactly one place is the only answer a patch can use', () => {
    expect(describeSearch(findPlaces(app, 'L$=[', SPAN))).toContain('unique');
  });

  test('several places say to widen it rather than reporting success', () => {
    const verdict = describeSearch(findPlaces(app, 'var', SPAN));
    expect(verdict).toContain('4 places');
    expect(verdict).toContain('widen');
  });

  test('no place is named as unusable, with the literal quoted back', () => {
    expect(describeSearch(findPlaces(app, 'nope', SPAN))).toContain('cannot anchor');
  });

  test('every place is printed under its module and offset', () => {
    expect(formatPlaces(findPlaces(app, 'L$=[', SPAN))).toContain('chunk-logo.js @');
  });
});

describe('moduleHolding finds the module an anchor sits in', () => {
  test('the module carrying the anchor is the one returned', () => {
    expect(moduleHolding(app, 'function pc(')?.name).toBe(FOOTER.name);
  });

  test('an anchor no module carries resolves to nothing', () => {
    expect(moduleHolding(app, 'function absent(')).toBeUndefined();
  });
});

describe('resolveName tells an imported name from a locally defined one', () => {
  test('an imported name names the chunk it comes from', () => {
    expect(resolveName(FOOTER, 'g', SPAN)).toEqual({
      kind: 'import',
      name: 'g',
      from: 'chunk-hooks.js',
      exported: 'g',
    });
  });

  test('a renamed import reports the name the exporter uses', () => {
    const origin = resolveName(FOOTER, 'Ee', SPAN);
    expect(origin.kind).toBe('import');
    expect(describeOrigin(origin)).toContain('exported as E');
  });

  test('a function defined in the module is reported as local', () => {
    expect(resolveName(FOOTER, 'pc', SPAN).kind).toBe('define');
  });

  test('a name that is neither is called free, because the patch would crash on it', () => {
    expect(describeOrigin(resolveName(FOOTER, 'nowhere', SPAN))).toContain('free');
  });

  test('a definition is not matched inside a longer identifier', () => {
    const longer = chunk('c.js', 'var xT6=1,other=2');
    expect(resolveName(longer, 'T6', SPAN).kind).toBe('absent');
  });

  test('a definition is not matched behind a dot', () => {
    const property = chunk('c.js', 'var a=1;a.T6=2');
    expect(resolveName(property, 'T6', SPAN).kind).toBe('absent');
  });

  test('a name defined after a comma in a var list is still found', () => {
    expect(resolveName(LOGO, 'L$', SPAN).kind).toBe('define');
  });

  test('an import wins over a same-named definition, as the module scope does', () => {
    const shadow = chunk('c.js', `${HEADER}function g(){}`);
    expect(resolveName(shadow, 'g', SPAN).kind).toBe('import');
  });
});
