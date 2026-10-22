import { describe, expect, test } from 'bun:test';

import { patchSource } from '../../binary/apply.ts';
import type { Expectation } from '../../probe/shield.ts';
import { SHIELD_CASES } from '../../probe/shield.ts';
import { EXTRA_PREFIX_RULES, shieldPatches } from '../shield-patches.ts';
import { patchNamed, payloadFunction } from './payload.ts';
import type { Finding, LineMatcher } from './stock-scanner.ts';
import { lineMatcherIn, stockDroid } from './stock-scanner.ts';

type Search = (cL: LineMatcher, P: { content: string }, m: string) => Finding | undefined;

const search = payloadFunction<Parameters<Search>, ReturnType<Search>>(
  ['cL', 'P', 'm'],
  `return ${patchNamed(shieldPatches, 'shield-code-paths-skip-guessing-rules').replace}`,
);

function blocks(match: LineMatcher, path: string, line: string): boolean {
  return search(match, { content: line }, path) !== undefined;
}

function probeCases(expectation: Expectation) {
  return SHIELD_CASES.filter((shieldCase) => shieldCase.expect === expectation).map(
    ({ path, line }) => [path, line] as const,
  );
}

const extraRuleIds = new Set(EXTRA_PREFIX_RULES.map(({ id }) => id));

const stock = stockDroid;

if (stock !== undefined) {
  describe('every line probe shield commits gets the same verdict on every run', () => {
    const stockMatcher = lineMatcherIn(stock);
    const patchedMatcher = lineMatcherIn(patchSource(stock, shieldPatches));

    test.each(probeCases('pass'))('%s passes in the patched scanner', (path, line) => {
      expect(blocks(patchedMatcher, path, line)).toBe(false);
    });

    test.each(probeCases('block'))('%s blocks in the patched scanner', (path, line) => {
      expect(blocks(patchedMatcher, path, line)).toBe(true);
    });

    test.each(probeCases('block'))(
      '%s blocks in the stock scanner unless only an extra rule catches it',
      (path, line) => {
        const onlyExtra = patchedMatcher(line).every((finding) => extraRuleIds.has(finding.ruleId));
        expect(blocks(stockMatcher, path, line)).toBe(!onlyExtra);
      },
    );
  });
}
