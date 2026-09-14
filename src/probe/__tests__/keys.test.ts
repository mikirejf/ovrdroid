import { afterAll, describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';

import { formatKeys, measureKeys } from '../keys.ts';
import { PAINT_MARKER, rejection, script, scriptDir } from './scripts.ts';

const dir = scriptDir('keys');

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const echoing = await script(dir, 'echoing.sh', [
  'stty raw -echo',
  `printf '${PAINT_MARKER}'`,
  'while :; do dd bs=1 count=1 2>/dev/null; done',
]);
const stillborn = await script(dir, 'stillborn.sh', ['exit 3']);

describe('measureKeys', () => {
  test('times every keypress it sends and the burst that follows', async () => {
    const result = await measureKeys(echoing, { trials: 3, chars: 5, gapMs: 5 });

    expect(result.echoMs).toHaveLength(3);
    for (const ms of result.echoMs) {
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThan(5000);
    }
    expect(result.chunks).toBeGreaterThan(0);
    expect(result.lagMs).toBeGreaterThanOrEqual(0);
  }, 60_000);

  test('rejects a target that dies before the input box appears', async () => {
    expect(await rejection(measureKeys(stillborn, { trials: 1, chars: 1, gapMs: 5 }))).toBe(
      'exited with code 3 before painting',
    );
  }, 30_000);
});

describe('formatKeys', () => {
  test('reports the trial count across every run', () => {
    const text = formatKeys([
      { echoMs: [1, 2], lagMs: 10, chunks: 3 },
      { echoMs: [3], lagMs: 20, chunks: 4 },
    ]);

    expect(text).toContain('n=3');
    expect(text).toContain('echo');
    expect(text).toContain('lag');
    expect(text).toContain('chunks');
  });
});
