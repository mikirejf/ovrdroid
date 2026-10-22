import { describe, expect, test } from 'bun:test';

import type { Measure } from '../regressions.ts';
import { describeRegression, regressionsOf, resolvedWorseOf } from '../regressions.ts';

const STOCK = [6, 6, 5, 6, 7, 6];
const A_LITTLE_WORSE = [7, 7, 6, 8, 8, 7];
const MUCH_WORSE = [11, 11, 10, 12, 12, 11];

function echo(patched: number[], floor: number): Measure {
  return {
    label: 'echo',
    floor,
    series: [
      ['stock', STOCK],
      ['patched', patched],
    ],
  };
}

describe('the floor', () => {
  test('a resolved difference whose lower bound stays under the floor passes', () => {
    expect(resolvedWorseOf([echo(A_LITTLE_WORSE, 3)])).toHaveLength(1);
    expect(regressionsOf([echo(A_LITTLE_WORSE, 3)])).toEqual([]);
  });

  test('the same floor fails a difference whose lower bound clears it', () => {
    expect(regressionsOf([echo(MUCH_WORSE, 3)]).map(({ label }) => label)).toEqual(['echo']);
  });

  test('a floor of zero fails any resolved difference', () => {
    expect(regressionsOf([echo(A_LITTLE_WORSE, 0)]).map(({ label }) => label)).toEqual(['echo']);
  });

  test('a passing difference is reported as within the floor', () => {
    const [text = ''] = resolvedWorseOf([echo(A_LITTLE_WORSE, 3)]).map((found) =>
      describeRegression(found),
    );
    expect(text).toStartWith('within floor echo: patched is worse than stock by 1.2');
    expect(text).toEndWith('does not clear the floor of 3, so it passes');
  });

  test('a failing difference names the floor it cleared', () => {
    const [text = ''] = regressionsOf([echo(MUCH_WORSE, 3)]).map((found) =>
      describeRegression(found),
    );
    expect(text).toStartWith('REGRESSION echo:');
    expect(text).toEndWith('and its lower bound clears the floor of 3');
  });
});
