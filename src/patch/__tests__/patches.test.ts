import { describe, expect, test } from 'bun:test';

import { BUILD_FLAGS } from '../../binary/build-flags.ts';
import type { Patch } from '../patches.ts';
import { findMarker, markerDigest, markerStatement, patches } from '../patches.ts';

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
    expect(markerDigest(patches, BUILD_FLAGS)).toMatch(/^[0-9a-f]{12}$/u);
  });

  test('is stable across calls', () => {
    expect(markerDigest(patches, BUILD_FLAGS)).toBe(markerDigest(patches, BUILD_FLAGS));
  });

  test('changes when a replacement changes', () => {
    const one: readonly Patch[] = [{ name: 'a', find: 'x', replace: 'y' }];
    const two: readonly Patch[] = [{ name: 'a', find: 'x', replace: 'z' }];
    expect(markerDigest(one, BUILD_FLAGS)).not.toBe(markerDigest(two, BUILD_FLAGS));
  });

  test('changes when an until changes', () => {
    const one: readonly Patch[] = [{ name: 'a', find: 'x', until: 'y', replace: 'z' }];
    const two: readonly Patch[] = [{ name: 'a', find: 'x', until: 'w', replace: 'z' }];
    expect(markerDigest(one, BUILD_FLAGS)).not.toBe(markerDigest(two, BUILD_FLAGS));
  });

  test('changes when a name changes', () => {
    const one: readonly Patch[] = [{ name: 'a', find: 'x', replace: 'y' }];
    const two: readonly Patch[] = [{ name: 'b', find: 'x', replace: 'y' }];
    expect(markerDigest(one, BUILD_FLAGS)).not.toBe(markerDigest(two, BUILD_FLAGS));
  });
});

describe('markerDigest build flags', () => {
  const list: readonly Patch[] = [{ name: 'a', find: 'x', replace: 'y' }];

  test('changes when a build flag is added, removed or changed', () => {
    const base = markerDigest(list, ['--compile']);

    expect(markerDigest(list, ['--compile', '--minify'])).not.toBe(base);
    expect(markerDigest(list, [])).not.toBe(base);
    expect(markerDigest(list, ['--compile=other'])).not.toBe(base);
  });

  test('is the same for the same patches and the same flags', () => {
    expect(markerDigest(list, ['--compile'])).toBe(markerDigest(list, ['--compile']));
  });
});

describe('markerStatement', () => {
  test('is a complete statement carrying the digest', () => {
    expect(markerStatement(patches, BUILD_FLAGS)).toBe(
      `globalThis.__ovrdroid="${markerDigest(patches, BUILD_FLAGS)}";\n`,
    );
  });
});

describe('findMarker', () => {
  test('returns undefined when no marker is present', () => {
    expect(findMarker('let x=await go();wait(150);')).toBeUndefined();
  });

  test('reads the digest out of a marker statement', () => {
    expect(findMarker(`a=1;${markerStatement(patches, BUILD_FLAGS)}`)).toBe(
      markerDigest(patches, BUILD_FLAGS),
    );
  });

  test('rejects a marker whose digest is not twelve hex characters', () => {
    expect(findMarker('globalThis.__ovrdroid="nothex";')).toBeUndefined();
    expect(findMarker(`globalThis.__ovrdroid="${'a'.repeat(13)}";`)).toBeUndefined();
  });
});
