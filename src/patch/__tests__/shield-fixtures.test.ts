import { describe, expect, test } from 'bun:test';

import { patchSource } from '../../binary/apply.ts';
import { shieldPatches } from '../shield-patches.ts';
import { patchNamed, payloadFunction } from './payload.ts';
import type { Finding, LineMatcher } from './stock-scanner.ts';
import { lineMatcherIn, stockDroid } from './stock-scanner.ts';

type Search = (cL: LineMatcher, P: { content: string }, m: string) => Finding | undefined;

const search = payloadFunction<Parameters<Search>, ReturnType<Search>>(
  ['cL', 'P', 'm'],
  `return ${patchNamed(shieldPatches, 'shield-paths-skip-rules').replace}`,
);

const FIXTURE_PATHS = [
  'fixtures/page.html',
  'src/__fixtures__/page.json',
  'apps/evals/fixtures/facebook/pages/page.html',
  'apps/evals/fixtures-pages-holdout/facebook/pages/page.html',
  'apps/evals/fixtures_holdout/page.json',
  'apps/evals/FIXTURES-HOLDOUT/page.json',
  String.raw`"b/fixtures-pages-holdout/caf\303\251.html"`,
];

const OTHER_PATHS = [
  'src/config.ts',
  'test/support/config.ts',
  'docs/setup.md',
  '.env.example',
  '.env',
  'config/settings.json',
  'config/myfixtures/page.json',
  'config/fixtures.json',
  'config/fixtures-/page.json',
  'config/not-fixtures/page.json',
  'config/fixtures.ts',
];

const GOOGLE_KEY = ['AIzaSy', 'Q7mL2rT9wX4pN8cV3bF6hJ1kD5sG0yZ_eUa'.slice(0, 33)].join('');
const HTML = `<script>ytcfg.set({"INNERTUBE_API_KEY":"${GOOGLE_KEY}"});</script>`;

describe('fixture paths never block commits', () => {
  test.each(FIXTURE_PATHS)('%s excludes every kind of finding', (path) => {
    for (const [ruleId, guessing] of [
      ['gcp-api-key', false],
      ['aws-access-token', false],
      ['private-key', false],
      ['generic-api-key', true],
    ] as const) {
      const finding: Finding = { ruleId, guessing, blocking: true, start: 0, end: 1 };
      expect(search(() => [finding], { content: 'line' }, path)).toBeUndefined();
    }
  });

  test.each(OTHER_PATHS)('%s keeps exact-prefix checks', (path) => {
    const finding: Finding = {
      ruleId: 'gcp-api-key',
      guessing: false,
      blocking: true,
      start: 0,
      end: 1,
    };
    expect(search(() => [finding], { content: 'line' }, path)).toBe(finding);
  });
});

const stock = stockDroid;

if (stock !== undefined) {
  describe('a downloaded page containing a browser API key', () => {
    const stockMatcher = lineMatcherIn(stock);
    const patchedMatcher = lineMatcherIn(patchSource(stock, shieldPatches));

    test('the key triggers a recognizable-prefix rule, not a guessing rule', () => {
      expect(
        patchedMatcher(HTML).some(
          ({ ruleId, blocking, guessing }) => ruleId === 'gcp-api-key' && blocking && !guessing,
        ),
      ).toBe(true);
    });

    test.each(FIXTURE_PATHS)('%s passes where stock blocks', (path) => {
      expect(stockMatcher(HTML).some(({ blocking }) => blocking)).toBe(true);
      expect(search(patchedMatcher, { content: HTML }, path)).toBeUndefined();
    });

    test.each(OTHER_PATHS)('%s still blocks', (path) => {
      expect(search(patchedMatcher, { content: HTML }, path)).toBeDefined();
    });

    test('the key remains reported for redaction', () => {
      const findings = patchedMatcher(HTML);
      expect(findings.some(({ start, end }) => HTML.slice(start, end) === GOOGLE_KEY)).toBe(true);
    });
  });
}
