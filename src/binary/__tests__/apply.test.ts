import { describe, expect, test } from 'bun:test';

import type { Patch } from '../../patch/patches.ts';
import { markerDigest, markerStatement } from '../../patch/patches.ts';
import type { Status } from '../apply.ts';
import { describeStatus, patchSource, statusOf } from '../apply.ts';

const list: readonly Patch[] = [
  { name: 'timeout', find: 'wait(150)', replace: 'wait(30)' },
  { name: 'await', find: 'let x=await go()', replace: 'let x=go()' },
];

const stock = 'let x=await go();wait(150);done();';

describe('patchSource', () => {
  test('applies every patch and appends the marker', () => {
    const out = patchSource(stock, list);

    expect(out).toContain('let x=go();');
    expect(out).toContain('wait(30);');
    expect(out).toContain(markerStatement(list));
  });

  test('throws when a find string is absent', () => {
    expect(() => patchSource('nothing here', list)).toThrow(
      'patch timeout: expected 1 occurrence, found 0',
    );
  });

  test('throws when a find string occurs twice', () => {
    expect(() => patchSource(`${stock}wait(150);`, list)).toThrow(
      'patch timeout: expected 1 occurrence, found 2',
    );
  });

  test('replaces everything from find through the end of until', () => {
    const span: readonly Patch[] = [
      { name: 'span', find: 'let x=', until: 'go()', replace: 'let x=stop()' },
    ];
    expect(patchSource(stock, span)).toContain('let x=stop();wait(150);');
  });

  test('throws when until is absent after find', () => {
    const span: readonly Patch[] = [
      { name: 'span', find: 'let x=', until: 'nope()', replace: 'let x=stop()' },
    ];
    expect(() => patchSource(stock, span)).toThrow('patch span: until not found after find');
  });

  test('does not treat $ in a replacement as a capture reference', () => {
    const dollar: readonly Patch[] = [{ name: 'cash', find: 'A', replace: "'$&$1'" }];
    expect(patchSource('xAx', dollar)).toContain("x'$&$1'x");
  });
});

describe('statusOf', () => {
  test('reports pending when every find occurs once and no marker is present', () => {
    expect(statusOf(stock, list)).toEqual({ kind: 'pending' });
  });

  test('reports applied when the marker matches the current digest', () => {
    expect(statusOf(patchSource(stock, list), list)).toEqual({
      kind: 'applied',
      digest: markerDigest(list),
    });
  });

  test('reports stale when the marker is from a different patch set', () => {
    const older: readonly Patch[] = [{ name: 'timeout', find: 'wait(150)', replace: 'wait(1)' }];
    const status = statusOf(`done();${markerStatement(older)}`, list);

    expect(status).toEqual({
      kind: 'stale',
      digest: markerDigest(older),
      current: markerDigest(list),
    });
  });

  test('reports missing and names the patches that did not match once', () => {
    expect(statusOf('wait(150);', list)).toEqual({ kind: 'missing', names: ['await'] });
  });

  test('reports missing when until never follows find', () => {
    const span: readonly Patch[] = [
      { name: 'span', find: 'let x=', until: 'nope()', replace: 'let x=stop()' },
    ];
    expect(statusOf(stock, span)).toEqual({ kind: 'missing', names: ['span'] });
  });

  test('survives minification collapsing whitespace around the marker', () => {
    const minified = `a=1;globalThis.__overdroid="${markerDigest(list)}";`;
    expect(statusOf(minified, list).kind).toBe('applied');
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
