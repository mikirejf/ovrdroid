import { setTimeout as delay } from 'node:timers/promises';

export const POLL_MS = 250;

export async function poll<T>(
  read: () => T | undefined,
  timeoutMs: number,
): Promise<T | undefined> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== undefined || performance.now() > deadline) {
      return value;
    }
    // oxlint-disable-next-line no-await-in-loop
    await delay(POLL_MS);
  }
}
