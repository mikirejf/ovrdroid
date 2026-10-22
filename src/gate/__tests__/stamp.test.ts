import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';

import { makeTempDir } from '../../temp.ts';
import type { GateStamp } from '../stamp.ts';
import { assertGated, gateProblem, parseStamp, stampProblem, writeStamp } from '../stamp.ts';

const STAMP: GateStamp = {
  droidVersion: '0.244.0',
  patchDigest: 'abc123def456',
  bunVersion: '1.4.3',
  platform: 'darwin-arm64',
  passedAt: '2026-10-20T12:00:00.000Z',
  checks: ['verify', 'highlight'],
};
const EXPECTED = { droidVersion: '0.244.0', patchDigest: 'abc123def456', bunVersion: '1.4.3' };
const FILE = 'gate-pass.json';
const dir = makeTempDir('gate-stamp');

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('stampProblem', () => {
  test('is silent when version, digest and Bun all match', () => {
    expect(stampProblem(JSON.stringify(STAMP), EXPECTED, FILE)).toBeUndefined();
  });

  test('names the Bun that was gated when it is another one', () => {
    const problem = stampProblem(JSON.stringify(STAMP), { ...EXPECTED, bunVersion: '1.5.0' }, FILE);
    expect(problem).toContain('built on Bun 1.5.0');
    expect(problem).toContain('records Bun 1.4.3');
  });

  test('does not accept a stamp without a Bun version', () => {
    const { bunVersion: _omitted, ...old } = STAMP;
    expect(stampProblem(JSON.stringify(old), EXPECTED, FILE)).toContain('is not a gate stamp');
  });

  test('names the version that was gated when it is another one', () => {
    const problem = stampProblem(
      JSON.stringify(STAMP),
      { ...EXPECTED, droidVersion: '0.245.0' },
      FILE,
    );
    expect(problem).toContain('Droid 0.245.0 was never gated with patch set abc123def456');
    expect(problem).toContain('records Droid 0.244.0');
  });

  test('names the patch set that was gated when it is another one', () => {
    const problem = stampProblem(
      JSON.stringify(STAMP),
      { ...EXPECTED, patchDigest: 'ffffffffffff' },
      FILE,
    );
    expect(problem).toContain('was never gated with patch set ffffffffffff');
    expect(problem).toContain('records patch set abc123def456');
  });

  test('says the file is missing when there is no stamp', () => {
    expect(stampProblem(undefined, EXPECTED, FILE)).toContain('gate-pass.json does not exist');
  });

  test.each(['', 'not json', '{}', '[]', JSON.stringify({ ...STAMP, checks: 'verify' })])(
    'rejects a file that is not a stamp: %j',
    (text) => {
      expect(stampProblem(text, EXPECTED, FILE)).toContain('is not a gate stamp');
    },
  );
});

describe('parseStamp', () => {
  test('reads back what writeStamp wrote', () => {
    const file = path.join(dir, 'written.json');
    writeStamp(STAMP, file);
    expect(parseStamp(readFileSync(file, 'utf-8'))).toEqual(STAMP);
  });
});

describe('assertGated', () => {
  test('throws when the file is missing', () => {
    expect(() => {
      assertGated(EXPECTED, path.join(dir, 'missing.json'));
    }).toThrow('does not exist');
  });

  test('passes when version and digest match and throws when either differs', () => {
    const file = path.join(dir, 'present.json');
    writeFileSync(file, JSON.stringify(STAMP));
    expect(() => {
      assertGated(EXPECTED, file);
    }).not.toThrow();
    expect(() => {
      assertGated({ ...EXPECTED, patchDigest: 'ffffffffffff' }, file);
    }).toThrow('never gated');
    expect(() => {
      assertGated({ ...EXPECTED, droidVersion: '0.245.0' }, file);
    }).toThrow('never gated');
    expect(() => {
      assertGated({ ...EXPECTED, bunVersion: '1.5.0' }, file);
    }).toThrow('records Bun 1.4.3');
  });
});

describe('gateProblem', () => {
  test('is the skip decision: undefined when the stamp covers the build, the problem otherwise', () => {
    const file = path.join(dir, 'skip.json');
    writeFileSync(file, JSON.stringify(STAMP));
    expect(gateProblem(EXPECTED, file)).toBeUndefined();
    expect(gateProblem({ ...EXPECTED, patchDigest: 'ffffffffffff' }, file)).toContain(
      'records patch set abc123def456',
    );
    expect(gateProblem(EXPECTED, path.join(dir, 'absent.json'))).toContain('does not exist');
  });
});
