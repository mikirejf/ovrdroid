import { describe, expect, test } from 'bun:test';

import type { Patch } from '../src/patches.ts';
import { findMarker, markerDigest, markerStatement, patches } from '../src/patches.ts';

describe('patches', () => {
  test('every find string is unique across the patch list', () => {
    const seen = new Set(patches.map((patch) => patch.find));
    expect(seen.size).toBe(patches.length);
  });

  test('every patch actually changes something', () => {
    for (const patch of patches) {
      expect(patch.replace).not.toBe(patch.find);
    }
  });
});

describe('markerDigest', () => {
  test('is twelve hex characters', () => {
    expect(markerDigest()).toMatch(/^[0-9a-f]{12}$/u);
  });

  test('is stable across calls', () => {
    expect(markerDigest()).toBe(markerDigest());
  });

  test('changes when a replacement changes', () => {
    const one: readonly Patch[] = [{ name: 'a', find: 'x', replace: 'y' }];
    const two: readonly Patch[] = [{ name: 'a', find: 'x', replace: 'z' }];
    expect(markerDigest(one)).not.toBe(markerDigest(two));
  });

  test('changes when a name changes', () => {
    const one: readonly Patch[] = [{ name: 'a', find: 'x', replace: 'y' }];
    const two: readonly Patch[] = [{ name: 'b', find: 'x', replace: 'y' }];
    expect(markerDigest(one)).not.toBe(markerDigest(two));
  });
});

describe('markerStatement', () => {
  test('is a complete statement carrying the digest', () => {
    expect(markerStatement()).toBe(`globalThis.__overdroid="${markerDigest()}";\n`);
  });
});

describe('findMarker', () => {
  test('returns undefined when no marker is present', () => {
    expect(findMarker('let x=await go();wait(150);')).toBeUndefined();
  });

  test('reads the digest out of a marker statement', () => {
    expect(findMarker(`a=1;${markerStatement()}`)).toBe(markerDigest());
  });

  test('rejects a marker whose digest is not twelve hex characters', () => {
    expect(findMarker('globalThis.__overdroid="nothex";')).toBeUndefined();
    expect(findMarker(`globalThis.__overdroid="${'a'.repeat(13)}";`)).toBeUndefined();
  });
});
