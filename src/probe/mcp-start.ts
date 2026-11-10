import { setTimeout as delay } from 'node:timers/promises';

import type { ServerReading } from './mcp-children.ts';
import { POLL_MS } from './poll.ts';

export const COLD_START_TIMEOUT_MS = 30_000;

export function mcpStartTimeout(mustStartCold: boolean, firstLaunch: boolean): number {
  return mustStartCold && firstLaunch ? COLD_START_TIMEOUT_MS : 0;
}

export async function readMcpStart(
  read: () => Promise<ServerReading[]>,
  timeoutMs: number,
  settleMs = 0,
): Promise<ServerReading[]> {
  if (settleMs > 0) {
    await delay(settleMs);
  }
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop
    const readings = await read();
    const remaining = deadline - performance.now();
    if (readings.every((reading) => reading.pid !== undefined) || remaining <= 0) {
      return readings;
    }
    // oxlint-disable-next-line no-await-in-loop
    await delay(Math.min(POLL_MS, remaining));
  }
}
