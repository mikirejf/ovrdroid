import { describe, expect, test } from 'bun:test';

import { patchSource } from '../../binary/apply.ts';
import { fakePrivateKey } from '../../probe/shield.ts';
import { shieldPatches } from '../shield-patches.ts';
import { patchNamed, payloadFunction } from './payload.ts';
import type { Finding, LineMatcher } from './stock-scanner.ts';
import { lineMatcherIn, stockDroid } from './stock-scanner.ts';

type Search = (cL: LineMatcher, P: { content: string }, m: string) => Finding | undefined;

const search = payloadFunction<Parameters<Search>, ReturnType<Search>>(
  ['cL', 'P', 'm'],
  `return ${patchNamed(shieldPatches, 'shield-paths-skip-rules').replace}`,
);

function blocksAt(path: string, ruleId: string): boolean {
  const finding: Finding = { ruleId, start: 0, end: 1, blocking: true, guessing: false };
  return search(() => [finding], { content: 'x' }, path) !== undefined;
}

const KEY_RULES = [
  'private-key',
  'private-key-dsa',
  'private-key-ec',
  'private-key-openssh',
  'private-key-pgp',
  'private-key-rsa',
  'private-key-ssh2',
];

const TEST_PATHS = [
  'apps/server/test/support/fake-tls-cert.ts',
  'src/__fixtures__/k.ts',
  'src/__tests__/k.pem',
  'foo/bar.test.ts',
  'foo/bar.spec.ts',
  'foo/bar.test-support.ts',
  'x/tests/k.pem',
  'fixtures/k.pem',
  'test/k.pem',
  'a/TESTS/k.pem',
  String.raw`"tests/caf\303\251.pem"`,
  String.raw`"b/caf\303\251.test.pem"`,
];

const REAL_PATHS = [
  'src/server/tls.ts',
  'config/key.pem',
  '.env',
  'deploy/.env',
  '.env.example',
  'docs/setup.md',
  'a/contest/k.pem',
  'testing/k.pem',
  'latest.pem',
  'a.testing.pem',
  'src/test.ts',
  'test.pem',
];

describe('private-key findings stop blocking in test locations', () => {
  test.each(KEY_RULES)('%s does not block in a test path', (ruleId) => {
    expect(blocksAt('test/k.pem', ruleId)).toBe(false);
  });

  test.each(TEST_PATHS)('a private key in %s does not block', (path) => {
    expect(blocksAt(path, 'private-key')).toBe(false);
  });

  test.each(REAL_PATHS)('a private key in %s still blocks', (path) => {
    expect(blocksAt(path, 'private-key')).toBe(true);
  });

  test.each(['aws-access-token', 'github-pat', 'anthropic-key', 'x'])(
    'an exact %s finding still blocks in a test path',
    (ruleId) => {
      expect(blocksAt('test/support/x.ts', ruleId)).toBe(true);
      expect(blocksAt('src/__fixtures__/k.ts', ruleId)).toBe(true);
    },
  );
});

const KINDS: readonly (readonly [kind: string, ruleId: string])[] = [
  ['PRIVATE KEY', 'private-key'],
  ['RSA PRIVATE KEY', 'private-key-rsa'],
  ['EC PRIVATE KEY', 'private-key-ec'],
  ['DSA PRIVATE KEY', 'private-key-dsa'],
  ['OPENSSH PRIVATE KEY', 'private-key-openssh'],
  ['SSH2 ENCRYPTED PRIVATE KEY', 'private-key-ssh2'],
  ['PGP PRIVATE KEY BLOCK', 'private-key-pgp'],
];

const AWS_ACCESS_KEY = `export const k = '${['AKIA', 'QYLPMRTSVWXZ2345'].join('')}'`;

const stock = stockDroid;

if (stock !== undefined) {
  describe('the patched scanner on a real private key', () => {
    const stockMatcher = lineMatcherIn(stock);
    const patchedMatcher = lineMatcherIn(patchSource(stock, shieldPatches));
    const key = fakePrivateKey();

    const patchedBlocks = (path: string, content: string): boolean =>
      search(patchedMatcher, { content }, path) !== undefined;
    const stockBlocks = (content: string): boolean =>
      stockMatcher(content).some((finding) => finding.blocking);

    test.each(KINDS)('%s is found by %s', (kind, ruleId) => {
      expect(patchedMatcher(fakePrivateKey(kind)).map((finding) => finding.ruleId)).toContain(
        ruleId,
      );
    });

    test.each(KINDS)('%s does not block in test/support/k.ts', (kind) => {
      expect(patchedBlocks('test/support/k.ts', fakePrivateKey(kind))).toBe(false);
    });

    test.each(KINDS)('%s still blocks in src/tls.ts', (kind) => {
      expect(patchedBlocks('src/tls.ts', fakePrivateKey(kind))).toBe(true);
    });

    test.each(TEST_PATHS)(
      'the stock scanner blocks a private key in %s, the patched one does not',
      (path) => {
        expect(stockBlocks(key)).toBe(true);
        expect(patchedBlocks(path, key)).toBe(false);
      },
    );

    test.each(REAL_PATHS)('the patched scanner still blocks a private key in %s', (path) => {
      expect(patchedBlocks(path, key)).toBe(true);
    });

    test('a private key stays reported for redaction in a test path', () => {
      const [finding] = patchedMatcher(key);
      expect(finding).toMatchObject({ ruleId: 'private-key', blocking: true });
      expect(key.slice(finding?.start, finding?.end)).toContain('BEGIN PRIVATE KEY');
    });

    test('an AWS access key still blocks in a test path', () => {
      expect(patchedBlocks('test/support/x.ts', AWS_ACCESS_KEY)).toBe(true);
    });

    test('an AWS access key beside a private key blocks in a test path', () => {
      expect(patchedBlocks('test/support/x.ts', `${key}\n${AWS_ACCESS_KEY}`)).toBe(true);
    });
  });
}
