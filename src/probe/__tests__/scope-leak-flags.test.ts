import { describe, expect, test } from 'bun:test';

import { startFlagStub } from '../scope-leak-flag-stub.ts';
import {
  FLAG_PRINCIPAL,
  FLAG_ARM_DELAY_MS,
  FLAG_OBSERVE_MS,
  flagCacheFixture,
  flagCoverage,
  flagLifecycle,
  flagOutcome,
  flagReply,
} from '../scope-leak-flags.ts';
import type { FlagEvidence } from '../scope-leak-flags.ts';
import { LAUNCH_WORD } from '../scope-leak-report.ts';

function covered(): FlagEvidence {
  return {
    firstFlagMs: 1,
    armedMs: 65_001,
    flagRequests: [
      { atMs: 1, status: 503 },
      { atMs: 66_100, status: 200 },
    ],
    child: 'child',
    childStartedMs: 66_000,
    requestMs: 66_100,
    teardownMs: 67_000,
    hostClosedMs: 67_100,
    releasedMs: 70_100,
    responseChanged: true,
    aborted: false,
    observedMs: FLAG_OBSERVE_MS,
    exited: false,
    fatalMs: 0,
    fatal: '',
    failure: '',
  };
}
describe('flag fixtures', () => {
  test('seeds matching identity and routing older than five minutes', () => {
    const fixture = flagCacheFixture(1_000_000);
    expect(fixture.userId).toBe(FLAG_PRINCIPAL.userId);
    expect(fixture.orgId).toBe(FLAG_PRINCIPAL.orgId);
    expect(Date.parse(fixture.configs.provider_routing.fetchedAt)).toBe(400_000);
    expect(fixture.flags.shared_process_agents).toBe(true);
  });
  test('changes a recognized flag without turning shared hosts off', () => {
    expect(flagReply(false).flags.droids_view).toBe(false);
    expect(flagReply(true).flags.droids_view).toBe(true);
    expect(flagReply(true).flags.shared_process_agents).toBe(true);
    expect(flagReply(false).configs).toEqual({});
  });
});
describe('flag coverage', () => {
  test('accepts a covered survival and a post-release scope crash', () => {
    expect(flagCoverage(covered())).toEqual([]);
    expect(flagOutcome(covered())).toBe('survived');
    expect(
      flagOutcome({
        ...covered(),
        exited: true,
        observedMs: 1,
        fatalMs: 70_101,
        fatal: 'Startup failed: Agent runtime scope is disposed',
      }),
    ).toBe('crashed');
  });
  test.each([
    { firstFlagMs: 0 },
    { armedMs: 0 },
    { armedMs: 65_000 },
    { flagRequests: [] },
    { flagRequests: [{ atMs: 1, status: 200 }] },
    { child: '' },
    { childStartedMs: 0 },
    { requestMs: 0 },
    { requestMs: 65_999 },
    { requestMs: 67_000 },
    { teardownMs: 0 },
    { hostClosedMs: 0 },
    { releasedMs: 70_099 },
    { responseChanged: false },
    { aborted: true },
    { observedMs: FLAG_OBSERVE_MS - 1 },
    { failure: 'timeout' },
    { exited: true },
    { exited: true, fatal: 'Agent runtime scope is disposed', fatalMs: 70_000 },
  ])('rejects missing or mistimed evidence %j', (override) => {
    expect(flagOutcome({ ...covered(), ...override })).toBe('unproven');
  });
  test('rejects a held request before arming even when it is within the child lifetime', () => {
    const evidence = { ...covered(), childStartedMs: 64_000, requestMs: 65_000 };
    expect(flagCoverage(evidence)).toEqual(['held flag request before arming']);
    expect(flagOutcome(evidence)).toBe('unproven');
  });
});
function row(sessionId: string, message: string, { pid = 42, offsetMs = 0 } = {}) {
  const stamp = new Date(Date.parse('2026-11-10T16:00:00.000Z') + offsetMs).toISOString();
  return `[${stamp}] INFO: ${message} | Context: ${JSON.stringify({ sessionId, 'process.pid': pid })}\n`;
}
describe('flag lifecycle', () => {
  test('attributes the child start and multiline scope fatal to the correct pid', () => {
    const log =
      row('other', '[Daemon] Starting agent run', { pid: 5 }) +
      row('main', '[Daemon] Starting agent run') +
      row('child', '[Daemon] Starting agent run') +
      row('main', 'CLI startup failed\nError: Agent runtime scope is disposed');
    const reading = flagLifecycle(log, 42);
    expect(reading.main).toBe('main');
    expect(reading.child).toBe('child');
    expect(reading.childStartedMs).toBe(Date.parse('2026-11-10T16:00:00.000Z'));
    expect(reading.fatal).toContain('Agent runtime scope is disposed');
    expect(reading.fatalMs).toBe(reading.childStartedMs);
  });
  test('does not invent a child or fatal from an empty log', () => {
    expect(flagLifecycle('', 42)).toEqual({
      main: '',
      child: '',
      childStartedMs: 0,
      fatal: '',
      fatalMs: 0,
    });
  });
  test('the child lifetime includes initialization before its first agent run', () => {
    const log =
      row('main', '[Daemon] Starting agent run') +
      row('other', '[Daemon] Droid InitializeSession method called', { offsetMs: 5 }) +
      row('child', '[Daemon] Droid InitializeSession method called', { pid: 5, offsetMs: 10 }) +
      row('child', '[Daemon] Droid InitializeSession method called', { offsetMs: 200 }) +
      row('child', '[Daemon] Starting agent run', { offsetMs: 337 });
    const lifecycle = flagLifecycle(log, 42);
    const firstMs = Date.parse('2026-11-10T16:00:00.000Z');
    expect(lifecycle.child).toBe('child');
    expect(lifecycle.childStartedMs).toBe(firstMs + 200);
    expect(
      flagCoverage({
        ...covered(),
        firstFlagMs: firstMs - FLAG_ARM_DELAY_MS,
        armedMs: firstMs,
        flagRequests: [{ atMs: firstMs - FLAG_ARM_DELAY_MS, status: 503 }],
        childStartedMs: lifecycle.childStartedMs,
        requestMs: firstMs + 207,
        teardownMs: firstMs + 716,
        hostClosedMs: firstMs + 718,
        releasedMs: firstMs + 4763,
      }),
    ).toEqual([]);
  });
});
async function stubText(url: string, body?: string): Promise<string> {
  const response = await fetch(url, body === undefined ? {} : { method: 'POST', body });
  return await response.text();
}
test('local stub waits for the flag request before finishing its only child', async () => {
  const waiting = Promise.withResolvers<number>();
  const elapsed = Promise.withResolvers<boolean>();
  const stub = startFlagStub('test', async (atMs) => {
    waiting.resolve(atMs);
    await elapsed.promise;
  });
  try {
    expect(await stubText(`${stub.url}/api/cli/whoami`)).toBe(JSON.stringify(FLAG_PRINCIPAL));
    const first = await fetch(`${stub.url}/api/feature-flags`);
    expect(first.status).toBe(503);
    const { firstFlagMs } = stub.timing;
    expect(firstFlagMs).toBeGreaterThan(0);
    const launch = stubText(
      `${stub.url}/v1/chat/completions`,
      JSON.stringify({ messages: [{ role: 'user', content: `${LAUNCH_WORD} kept` }] }),
    );
    expect(await waiting.promise).toBe(firstFlagMs + FLAG_ARM_DELAY_MS);
    expect(stub.timing.armedMs).toBe(0);
    const retry = await fetch(`${stub.url}/api/feature-flags`);
    expect(retry.status).toBe(503);
    expect(stub.timing.firstFlagMs).toBe(firstFlagMs);
    const flagRequests = stub.requests.filter(
      (request) => request.pathname === '/api/feature-flags',
    );
    expect(flagRequests).toHaveLength(2);
    expect(flagRequests.every((request) => request.status === 503)).toBe(true);
    elapsed.resolve(true);
    expect(await launch).toContain('Task');
    expect(stub.timing.armedMs).toBeGreaterThanOrEqual(firstFlagMs);
    await stubText(`${stub.url}/v1/messages`, '{}');
    const child = stubText(`${stub.url}/v1/messages`, '{}');
    const flags = stubText(`${stub.url}/api/feature-flags`);
    expect(await child).toContain('hi');
    expect(stub.timing.responseChanged).toBe(false);
    expect(stub.timing.requestMs).toBeGreaterThan(0);
    stub.release();
    expect(await flags).toBe(JSON.stringify(flagReply(true)));
    expect(stub.timing.aborted).toBe(false);
    const unknown = await fetch(`${stub.url}/unknown`);
    expect(unknown.status).toBe(404);
  } finally {
    elapsed.resolve(true);
    await stub.stop();
  }
});
test('stopping aborts the delayed launch without arming flags', async () => {
  const waiting = Promise.withResolvers<AbortSignal>();
  const stub = startFlagStub('stop', async (_, signal) => {
    const aborted = Promise.withResolvers<boolean>();
    signal.addEventListener(
      'abort',
      () => {
        aborted.resolve(true);
      },
      { once: true },
    );
    waiting.resolve(signal);
    await aborted.promise;
  });
  try {
    const flags = await fetch(`${stub.url}/api/feature-flags`);
    expect(flags.status).toBe(503);
    const launch = (async () => {
      try {
        return await fetch(`${stub.url}/v1/chat/completions`, {
          method: 'POST',
          body: JSON.stringify({ messages: [{ role: 'user', content: `${LAUNCH_WORD} kept` }] }),
        });
      } catch {
        return null;
      }
    })();
    const signal = await waiting.promise;
    await stub.stop();
    expect(signal.aborted).toBe(true);
    expect(stub.timing.armedMs).toBe(0);
    const response = await launch;
    if (response !== null) {
      expect(response.status).toBe(503);
    }
  } finally {
    await stub.stop();
  }
});
