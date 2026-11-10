import { describe, expect, test } from 'bun:test';

import { judgeMcpChildren } from '../mcp-children.ts';
import { COLD_START_TIMEOUT_MS, mcpStartTimeout, readMcpStart } from '../mcp-start.ts';
import { POLL_MS } from '../poll.ts';

const DORMANT = { name: 'fixture', pid: undefined, processes: 0 };
const RUNNING = { name: 'fixture', pid: 200, processes: 1 };
const WAIT_MS = POLL_MS * 2;

describe('cold MCP startup readiness', () => {
  test('a fixture that starts after the initial sample is observed and passes', async () => {
    let reads = 0;
    const first = await readMcpStart(async () => {
      reads += 1;
      return await Promise.resolve([reads === 1 ? DORMANT : RUNNING]);
    }, WAIT_MS);
    expect(reads).toBe(2);
    expect(first).toEqual([RUNNING]);
    expect(judgeMcpChildren({ first, second: [DORMANT] }, true).pass).toBe(true);
  });

  test('never starting returns the last missing reading and still fails', async () => {
    let reads = 0;
    const first = await readMcpStart(async () => {
      reads += 1;
      return await Promise.resolve([{ ...DORMANT, name: `missing-${reads}` }]);
    }, WAIT_MS);
    expect(reads).toBeGreaterThan(1);
    expect(first).toEqual([{ ...DORMANT, name: `missing-${reads}` }]);
    expect(judgeMcpChildren({ first, second: [DORMANT] }, true)).toEqual({
      pass: false,
      reason: `nothing tested: Droid never started missing-${reads} on the first launch, so it did not load the fixture config`,
    });
  });

  test('one running server is not enough when another never starts', async () => {
    let reads = 0;
    const first = await readMcpStart(async () => {
      reads += 1;
      return await Promise.resolve([RUNNING, { ...DORMANT, name: 'other' }]);
    }, WAIT_MS);
    expect(reads).toBeGreaterThan(1);
    expect(first[1]?.pid).toBeUndefined();
    expect(judgeMcpChildren({ first, second: [DORMANT] }, true).pass).toBe(false);
  });

  test('all servers already running returns on the first read', async () => {
    let reads = 0;
    const first = await readMcpStart(async () => {
      reads += 1;
      return await Promise.resolve([RUNNING, { ...RUNNING, name: 'other', pid: 300 }]);
    }, WAIT_MS);
    expect(reads).toBe(1);
    expect(first.map((reading) => reading.pid)).toEqual([200, 300]);
  });

  test('an empty config returns on the first read and still fails', async () => {
    let reads = 0;
    const first = await readMcpStart(async () => {
      reads += 1;
      return await Promise.resolve([]);
    }, WAIT_MS);
    expect(reads).toBe(1);
    expect(judgeMcpChildren({ first, second: [] }, true).pass).toBe(false);
  });
});

describe('only the first default fixture launch waits for startup', () => {
  test('the first cold launch gets the bounded 30 second startup window', () => {
    expect(mcpStartTimeout(true, true)).toBe(COLD_START_TIMEOUT_MS);
    expect(COLD_START_TIMEOUT_MS).toBe(30_000);
  });

  test.each([
    ['second cached fixture launch', true, false],
    ['first real-config launch', false, true],
    ['second real-config launch', false, false],
  ] as const)('%s takes exactly one sample even when dormant', async (_name, cold, first) => {
    const timeout = mcpStartTimeout(cold, first);
    expect(timeout).toBe(0);
    let reads = 0;
    expect(
      await readMcpStart(async () => {
        reads += 1;
        return await Promise.resolve([DORMANT]);
      }, timeout),
    ).toEqual([DORMANT]);
    expect(reads).toBe(1);
  });
});
