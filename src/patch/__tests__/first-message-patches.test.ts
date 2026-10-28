import { describe, expect, test } from 'bun:test';

import type { Sites } from './first-message-harness.ts';
import {
  escapeWorld,
  FakeManager,
  inputEscape,
  loadWorld,
  patchedSites,
  sendWorld,
} from './first-message-harness.ts';
import { stockDroid } from './stock-scanner.ts';

const sites: Sites | undefined = stockDroid === undefined ? undefined : patchedSites(stockDroid);

function shipped(): Sites {
  if (sites === undefined) {
    throw new Error('no stock Droid to patch');
  }
  return sites;
}

async function settle(): Promise<void> {
  await Bun.sleep(1);
}

function newSession(...ids: string[]) {
  const managers = new Map(ids.map((id) => [id, new FakeManager()]));
  const world = sendWorld(shipped(), managers);
  world.currentId = ids[0] ?? null;
  const manager = (id: string): FakeManager => {
    const found = managers.get(id);
    if (found === undefined) {
      throw new Error(`no manager for ${id}`);
    }
    return found;
  };
  return { world, manager };
}

describe.skipIf(sites === undefined)('first-message-shows-at-once', () => {
  test('shows the message and Thinking while the session is still being created', async () => {
    const { world, manager } = newSession('s1');
    const result = world.send('hello');
    await settle();
    expect(manager('s1').shown()).toEqual(['hello']);
    expect(manager('s1').state).toBe('thinking');
    expect(world.sent).toEqual([]);

    world.createSession('s1');
    expect(await result).toBe('accepted');
    expect(world.sent.map((sent) => [sent.sessionId, sent.text])).toEqual([['s1', 'hello']]);
    const [first] = world.sent;
    expect([...manager('s1').optimistic.keys()]).toEqual([first?.requestId ?? 'nothing sent']);
    expect(manager('s1').added).toBe(1);
  });

  test('Esc before the session exists withdraws the message and sends nothing', async () => {
    const { world, manager } = newSession('s1');
    const result = world.send('hello');
    await settle();
    world.pressStop();
    expect(await result).toBe('rejected_with_notice');
    expect(manager('s1').shown()).toEqual([]);
    expect(manager('s1').state).toBe('idle');

    world.createSession('s1');
    await settle();
    expect(world.sent).toEqual([]);
  });

  test('moves the message when a different session comes back', async () => {
    const { world, manager } = newSession('s1', 's2');
    const result = world.send('hello');
    await settle();
    world.createSession('s2');
    expect(await result).toBe('accepted');
    expect(manager('s1').shown()).toEqual([]);
    expect(manager('s1').state).toBe('idle');
    expect(manager('s2').shown()).toEqual(['hello']);
    expect(world.sent.map((sent) => sent.sessionId)).toEqual(['s2']);
  });

  test('takes the message back when the session cannot be created', async () => {
    const { world, manager } = newSession('s1');
    const result = world.send('hello');
    await settle();
    world.createSession(null);
    expect(await result).toBe('rejected_with_notice');
    expect(manager('s1').shown()).toEqual([]);
    expect(manager('s1').state).toBe('idle');
  });

  test('takes the message back when the send fails', async () => {
    const { world, manager } = newSession('s1');
    world.failSend = true;
    const result = world.send('hello');
    await settle();
    world.createSession('s1');
    expect(await result).toBe('rejected_with_notice');
    expect(manager('s1').shown()).toEqual([]);
    expect(manager('s1').state).toBe('idle');
    expect(world.notices).toEqual(['send failed']);
  });

  test('leaves a busy session and a non end-of-turn message to stock', async () => {
    const { world, manager } = newSession('s1');
    manager('s1').state = 'streaming_assistant_message';
    const busy = world.send('hello');
    await settle();
    expect(manager('s1').shown()).toEqual([]);
    world.createSession('s1');
    expect(await busy).toBe('accepted');

    manager('s1').state = 'idle';
    const interrupting = world.send('now', 'interrupt');
    await settle();
    expect(manager('s1').shown()).toEqual([]);
    expect(manager('s1').state).toBe('idle');
    world.createSession('s1');
    expect(await interrupting).toBe('accepted');
  });
});

describe.skipIf(sites === undefined)('session-load-keeps-pending-settings', () => {
  test('sends settings changed while the session loaded', async () => {
    const world = loadWorld(shipped());
    world.settingsDuringLoad = { reasoningEffort: 'high' };
    expect(await world.load('s1')).toBe('s1');
    expect(world.updates).toEqual([{ sessionId: 's1', reasoningEffort: 'high' }]);
    expect(world.pending.has('s1')).toBe(false);
  });

  test('sends nothing when no setting changed', async () => {
    const world = loadWorld(shipped());
    expect(await world.load('s1')).toBe('s1');
    expect(world.updates).toEqual([]);
  });

  test('logs a failed sync and still loads the session', async () => {
    const world = loadWorld(shipped());
    world.settingsDuringLoad = { modelId: 'm' };
    world.failUpdate = true;
    expect(await world.load('s1')).toBe('s1');
    expect(world.logged).toEqual(['[Daemon] Failed to sync pending session settings']);
  });
});

describe.skipIf(sites === undefined)('escape-twice-reaches-stop', () => {
  test('the input box keeps swallowing a repeated Esc when no Esc was swallowed in the last half second', () => {
    const world = escapeWorld(shipped());
    const input = inputEscape(shipped());
    world.forget();
    expect(input(true)).toBe(true);
    expect(input(false)).toBe(false);
  });

  test('a repeated Esc within half a second of a swallowed one falls through to the stop', () => {
    const world = escapeWorld(shipped());
    const input = inputEscape(shipped());
    world.lastSwallowedAgo(250);
    expect(input(true)).toBe(false);
    world.lastSwallowedAgo(500);
    expect(input(true)).toBe(true);
  });
});

describe.skipIf(sites === undefined)('escape-twice-stops-turn', () => {
  const working = { working: 'streaming_assistant_message', pending: false };

  test('one Esc while Droid works is swallowed without stopping the turn', () => {
    const world = escapeWorld(shipped());
    world.forget();
    expect(world.press(working)).toBe(true);
    world.forget();
    expect(world.press({ working: 'idle', pending: true })).toBe(true);
    expect(world.stops).toEqual([]);
  });

  test('a second Esc within half a second stops the turn, and the third starts a new count', () => {
    const world = escapeWorld(shipped());
    world.forget();
    expect(world.press(working)).toBe(true);
    expect(world.press(working)).toBe(true);
    expect(world.stops).toEqual([1]);
    expect(world.press(working)).toBe(true);
    expect(world.stops).toEqual([1]);
  });

  test('a second Esc after half a second only starts a new count', () => {
    const world = escapeWorld(shipped());
    world.lastSwallowedAgo(500);
    expect(world.press(working)).toBe(true);
    expect(world.stops).toEqual([]);
    world.lastSwallowedAgo(499);
    expect(world.press(working)).toBe(true);
    expect(world.stops).toEqual([1]);
  });

  test('a pending first message counts the same way', () => {
    const world = escapeWorld(shipped());
    world.forget();
    expect(world.press({ working: 'idle', pending: true })).toBe(true);
    expect(world.press({ working: 'idle', pending: true })).toBe(true);
    expect(world.stops).toEqual([1]);
  });

  test('Esc while idle falls through to the next layer', () => {
    const world = escapeWorld(shipped());
    world.forget();
    expect(world.press({ working: 'idle', pending: false })).toBe(false);
    expect(world.stops).toEqual([]);
  });
});
