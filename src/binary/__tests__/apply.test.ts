import { describe, expect, test } from 'bun:test';

import type { Patch } from '../../patch/patches.ts';
import { markerDigest, markerStatement } from '../../patch/patches.ts';
import type { Status } from '../apply.ts';
import { describeStatus, patchSource, statusOf } from '../apply.ts';
import type { App } from '../graph.ts';

const list: readonly Patch[] = [
  { name: 'timeout', find: 'wait(150)', replace: 'wait(30)' },
  { name: 'await', find: 'let x=await go()', replace: 'let x=go()' },
];

function app(entry: string, ...chunks: string[]): App {
  return [
    { name: 'entry', text: entry },
    ...chunks.map((text, index) => ({ name: `chunk-${index + 1}.js`, text })),
  ];
}

const stock = app('let x=await go();wait(150);done();');

describe('patchSource', () => {
  test('applies every patch and appends the marker', () => {
    const [entry] = patchSource(stock, list);

    expect(entry.text).toContain('let x=go();');
    expect(entry.text).toContain('wait(30);');
    expect(entry.text).toContain(markerStatement(list));
  });

  test('throws when a find string is absent', () => {
    expect(() => patchSource(app('nothing here'), list)).toThrow(
      'markers not found (Droid version drift): timeout (missing), await (missing)',
    );
  });

  test('throws when a find string occurs twice', () => {
    expect(() => patchSource(app(`${stock[0].text}wait(150);`), list)).toThrow(
      'markers not found (Droid version drift): timeout (2 places match)',
    );
  });

  test('throws when a find string occurs once in each of two modules', () => {
    expect(() => patchSource(app('wait(150);', 'let x=await go();wait(150);'), list)).toThrow(
      'markers not found (Droid version drift): timeout (2 places match)',
    );
  });

  test('patches a chunk and leaves the other modules untouched', () => {
    const split = app('let x=await go();', 'wait(150);done();', 'other();');
    const out = patchSource(split, list);

    expect(out[1]?.text).toBe('wait(30);done();');
    expect(out[2]?.text).toBe('other();');
  });

  test('appends the marker to the entry even when every patch hit a chunk', () => {
    const split = app('head();', 'let x=await go();wait(150);');
    const out = patchSource(split, list);

    expect(out[0].text).toBe(`head();${markerStatement(list)}`);
    expect(out[1]?.text).not.toContain('__ovrdroid');
  });

  test('patches the module that satisfies until, not a later one that does not', () => {
    const span: readonly Patch[] = [
      { name: 'span', find: 'let x=', until: 'go()', replace: 'let x=stop()' },
    ];
    const out = patchSource(app('head();', 'let x=await go();done();'), span);

    expect(out[1]?.text).toBe('let x=stop();done();');
  });

  test('replaces everything from find through the end of until', () => {
    const span: readonly Patch[] = [
      { name: 'span', find: 'let x=', until: 'go()', replace: 'let x=stop()' },
    ];
    expect(patchSource(stock, span)[0].text).toContain('let x=stop();wait(150);');
  });

  test('throws when until is absent after find', () => {
    const span: readonly Patch[] = [
      { name: 'span', find: 'let x=', until: 'nope()', replace: 'let x=stop()' },
    ];
    expect(() => patchSource(stock, span)).toThrow(
      'markers not found (Droid version drift): span (no-tail)',
    );
  });

  test('does not treat $ in a replacement as a capture reference', () => {
    const dollar: readonly Patch[] = [{ name: 'cash', find: 'wait(150)', replace: "wait('$&$1')" }];
    expect(patchSource(stock, dollar)[0].text).toContain("wait('$&$1');done();");
  });
});

describe('patchSource on a release that renamed its identifiers', () => {
  const renamed = app('let q=await ab();wait(150);done();');

  test('applies each patch under the names the release uses', () => {
    const [entry] = patchSource(renamed, list);

    expect(entry.text).toContain('let q=ab();wait(30);done();');
  });

  test('renames an outer name a lookup pins down', () => {
    const outer: readonly Patch[] = [
      { name: 'outer', find: 'wait(150)', lookups: ['function hq(){'], replace: 'wait(hq())' },
    ];
    const [entry] = patchSource(app('function zr(){return 1}wait(150);'), outer);

    expect(entry.text).toContain('function zr(){return 1}wait(zr());');
  });

  test('leaves payload-owned names alone', () => {
    const owned: readonly Patch[] = [
      { name: 'owned', find: 'let x=await go()', replace: 'let $ODwait=go(),x=$ODwait' },
    ];
    const [entry] = patchSource(renamed, owned);

    expect(entry.text).toContain('let $ODwait=ab(),q=$ODwait;');
  });

  test('rejects a replacement name that nothing accounts for', () => {
    const loose: readonly Patch[] = [
      { name: 'loose', find: 'let x=await go()', replace: 'let x=go(),y=hq' },
    ];
    expect(() => patchSource(renamed, loose)).toThrow(
      'markers not found (Droid version drift): loose (free names: y hq)',
    );
  });

  test('rejects a patch whose names land on one name in the release', () => {
    const swap: readonly Patch[] = [{ name: 'swap', find: 'f(a,b)', replace: 'f(b,a)' }];
    expect(() => patchSource(app('f(x,x);'), swap)).toThrow(
      'markers not found (Droid version drift): swap (names renamed onto one: b a)',
    );
  });

  test('rejects a lookup that matches in more than one place', () => {
    const vague: readonly Patch[] = [
      { name: 'vague', find: 'wait(150)', lookups: ['hq()'], replace: 'wait(hq())' },
    ];
    expect(() => patchSource(app('a();b();wait(150);'), vague)).toThrow(
      'markers not found (Droid version drift): vague (no-lookup)',
    );
  });

  test('refuses a release whose source already uses the payload prefix', () => {
    expect(() => patchSource(app('let $ODx=1;wait(150);let x=await go();'), list)).toThrow(
      'reserved for patch payload names',
    );
  });
});

describe('statusOf', () => {
  test('reports pending when every find occurs once and no marker is present', () => {
    expect(statusOf(stock, list)).toEqual({ kind: 'pending' });
  });

  test('reports pending when the finds are spread across modules', () => {
    expect(statusOf(app('let x=await go();', 'wait(150);'), list)).toEqual({ kind: 'pending' });
  });

  test('reports applied when the marker matches the current digest', () => {
    expect(statusOf(patchSource(stock, list), list)).toEqual({
      kind: 'applied',
      digest: markerDigest(list),
    });
  });

  test('reports stale when the marker is from a different patch set', () => {
    const older: readonly Patch[] = [{ name: 'timeout', find: 'wait(150)', replace: 'wait(1)' }];
    const status = statusOf(app(`done();${markerStatement(older)}`), list);

    expect(status).toEqual({
      kind: 'stale',
      digest: markerDigest(older),
      current: markerDigest(list),
    });
  });

  test('ignores a marker that sits in a chunk rather than the entry', () => {
    expect(statusOf(app('wait(150);', markerStatement(list)), list)).toEqual({
      kind: 'missing',
      names: ['await'],
    });
  });

  test('reports missing and names the patches that did not match once', () => {
    expect(statusOf(app('wait(150);'), list)).toEqual({ kind: 'missing', names: ['await'] });
  });

  test('reports missing when until never follows find', () => {
    const span: readonly Patch[] = [
      { name: 'span', find: 'let x=', until: 'nope()', replace: 'let x=stop()' },
    ];
    expect(statusOf(stock, span)).toEqual({ kind: 'missing', names: ['span'] });
  });

  test('survives minification collapsing whitespace around the marker', () => {
    const minified = `a=1;globalThis.__ovrdroid="${markerDigest(list)}";`;
    expect(statusOf(app(minified), list).kind).toBe('applied');
  });
});

describe('describeStatus', () => {
  const cases: [Status, string][] = [
    [{ kind: 'pending' }, 'pending'],
    [{ kind: 'applied', digest: 'abc123abc123' }, 'applied abc123abc123'],
    [
      { kind: 'stale', digest: 'aaaaaaaaaaaa', current: 'bbbbbbbbbbbb' },
      'stale aaaaaaaaaaaa (current bbbbbbbbbbbb)',
    ],
    [{ kind: 'missing', names: ['one', 'two'] }, 'missing: one, two'],
  ];

  test.each(cases)('renders %o', (status, expected) => {
    expect(describeStatus(status)).toBe(expected);
  });
});
