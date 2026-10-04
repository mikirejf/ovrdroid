import { afterAll, describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

import { START_HOOK_BOUND_MS } from '../owned-sessions.ts';
import { cutFrames, openSession, plain } from '../session.ts';
import { PAINT_MARKER, rejection, script, scriptDir, START_HOOK } from './scripts.ts';

const dir = scriptDir('session');

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const ECHO = ['exec cat'];
const lateRecord = await script(dir, 'late-record.sh', [
  'stty raw -echo',
  `printf '${PAINT_MARKER}'`,
  `( sleep 3; ${START_HOOK} ) &`,
  ...ECHO,
]);
const noRecord = await script(dir, 'no-record.sh', [
  'stty raw -echo',
  `printf '${PAINT_MARKER}'`,
  ...ECHO,
]);

async function echoed(bytes: () => number, timeoutMs: number): Promise<boolean> {
  const deadline = performance.now() + timeoutMs;
  while (bytes() === 0 && performance.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop
    await delay(5);
  }
  return bytes() > 0;
}

describe('openSession hands the session over at paint', () => {
  test('input reaches a target at paint even when its start record lands 3s later', async () => {
    const session = await openSession(lateRecord);
    session.mark();
    await session.type('x');
    expect(await echoed(session.bytes, 2000)).toBe(true);
    const inputMs = performance.now() - session.startedAt;
    await session.close();
    expect(inputMs).toBeLessThan(2000);
  }, 30_000);

  test('closing a session whose start record never arrives fails loudly and stops the target', async () => {
    const session = await openSession(noRecord);
    const message = await rejection(session.close());
    expect(message).toContain("ran neither the probe's SessionStart nor its SessionEnd hook");
    expect(performance.now() - session.startedAt).toBeGreaterThanOrEqual(START_HOOK_BOUND_MS);
    expect(() => process.kill(session.pid, 0)).toThrow();
  }, 30_000);
});

const END = '\u001B[?2026l';

describe('cutFrames splits on the synchronised-update marker', () => {
  test('a whole frame is returned and the buffer drained', () => {
    const cut = cutFrames(`one${END}`);
    expect(cut.frames).toEqual(['one']);
    expect(cut.rest).toBe('');
  });

  test('a partial frame is held back for the next chunk', () => {
    const cut = cutFrames(`one${END}two`);
    expect(cut.frames).toEqual(['one']);
    expect(cut.rest).toBe('two');
  });

  test('several frames in one chunk all come out', () => {
    expect(cutFrames(`a${END}b${END}c${END}`).frames).toEqual(['a', 'b', 'c']);
  });

  test('a chunk with no marker yields nothing yet', () => {
    const cut = cutFrames('still drawing');
    expect(cut.frames).toEqual([]);
    expect(cut.rest).toBe('still drawing');
  });
});

describe('plain strips terminal control sequences', () => {
  test('colour codes go and the words stay', () => {
    expect(plain('\u001B[31mred\u001B[0m')).toBe('red');
  });

  test('window title sequences go too', () => {
    expect(plain('\u001B]0;title\u0007body')).toBe('body');
  });
});
