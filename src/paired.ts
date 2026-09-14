import type { Series } from './ab.ts';
import { pairedStats } from './ab.ts';
import { say } from './cli.ts';

export function sayPaired(results: Series<number>, metric: string): void {
  const [first, second] = results;
  if (first === undefined || second === undefined || results.length !== 2) {
    say('');
    say('a paired difference needs exactly two binaries');
    return;
  }
  const stats = pairedStats(first[1], second[1]);
  say('');
  say(`paired ${metric} difference (${second[0]} minus ${first[0]}), n=${stats.n}`);
  if (stats.n < 2) {
    say('  a spread needs at least two rounds: this difference is one sample, not a result');
    return;
  }
  if (stats.n % 2 === 1) {
    say(
      '  odd round count: one binary led once more than the other, so position bias is uncancelled',
    );
  }
  const low = stats.meanDiff - stats.margin;
  const high = stats.meanDiff + stats.margin;
  say(
    `  mean ${stats.meanDiff.toFixed(1)}ms  sd ${stats.sdDiff.toFixed(1)}ms  95% CI ${low.toFixed(1)} to ${high.toFixed(1)}`,
  );
  say(`  minimum resolvable effect at this spread: ${stats.margin.toFixed(1)}ms`);
  if (low <= 0 && high >= 0) {
    say('  the difference is not resolved: the interval contains zero');
    return;
  }
  const faster = stats.meanDiff < 0 ? second[0] : first[0];
  say(`  ${faster} is faster by ${Math.abs(stats.meanDiff).toFixed(1)}ms`);
}
