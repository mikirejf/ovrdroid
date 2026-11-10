import { describe, expect, test } from 'bun:test';

import { patchSource } from '../../binary/apply.ts';
import type { App } from '../../binary/graph.ts';
import { applies, rebaseAll } from '../rebase.ts';
import { sessionHistoryPatches } from '../session-history-patches.ts';
import { subagentPatches } from '../subagent-patches.ts';
import { describeStrayNames, patchNamed, payloadFunction } from './payload.ts';
import { requireStock, stockDroid } from './stock-scanner.ts';

const HISTORY = 'daemon.get_session_messages';
const patch = patchNamed(sessionHistoryPatches, 'session-history-read-without-runtime-load');

interface Message {
  role: string;
  text: string;
}

type BeforeRequest = (sessionId: string, method: string) => Promise<void>;

function clientCode(app: App) {
  const module = app.find((candidate) => candidate.text.includes(patch.find));
  if (module === undefined) {
    throw new Error('no stock client module carries the automatic-load exemption set');
  }
  const sets = [
    ...module.text.matchAll(
      /(?<declaration>var (?<name>[\w$]+)=new Set\(\["daemon\.load_session"[^\]]*\]\));/gu,
    ),
  ];
  const hooks = [
    ...module.text.matchAll(
      /this\.daemonClient\.setBeforeRequest\?\.\((?<hook>async\([^)]*\)=>\{[^}]*\})\)/gu,
    ),
  ];
  const declaration = sets[0]?.groups?.['declaration'];
  const name = sets[0]?.groups?.['name'];
  const hook = hooks[0]?.groups?.['hook'];
  if (
    sets.length !== 1 ||
    hooks.length !== 1 ||
    declaration === undefined ||
    name === undefined ||
    hook === undefined ||
    !hook.includes(`${name}.has(`)
  ) {
    throw new Error('the stock automatic-load set and before-request callback have drifted');
  }
  return { declaration, name, hook };
}

function client(app: App, histories: ReadonlyMap<string, readonly Message[]> = new Map()) {
  const { declaration, name, hook } = clientCode(app);
  const loaded = new Set<string>();
  const events: string[] = [];
  const sendingAllowed: string[] = [];
  const context = {
    ensureSessionLoaded: async (sessionId: string) => {
      await Promise.resolve();
      events.push(`load:${sessionId}`);
      loaded.add(sessionId);
    },
    assertMessageSendingAllowed: (sessionId: string) => {
      sendingAllowed.push(sessionId);
    },
  };
  const beforeRequest = payloadFunction<[], BeforeRequest>(
    [],
    `${declaration};return ${hook}`,
  ).call(context);
  const methods = payloadFunction<[], Set<string>>([], `${declaration};return ${name}`)();
  return {
    loaded,
    events,
    sendingAllowed,
    methods,
    request: async (sessionId: string, method: string) => {
      await beforeRequest(sessionId, method);
      events.push(`dispatch:${method}:${sessionId}`);
      if (method === HISTORY) {
        const messages = histories.get(sessionId);
        if (messages === undefined) {
          throw new Error(`no saved history for ${sessionId}`);
        }
        return messages;
      }
      return [];
    },
  };
}

describeStrayNames(sessionHistoryPatches);

test('the production subagent patch set includes the history exemption', () => {
  expect(subagentPatches).toContainEqual(patch);
});

describe.skipIf(stockDroid === undefined)('saved history does not restart finished agents', () => {
  const stock = stockDroid === undefined ? undefined : requireStock();
  const patched = stock === undefined ? undefined : patchSource(stock, sessionHistoryPatches);

  const source = (patchedSource: boolean): App => {
    const app = patchedSource ? patched : stock;
    if (app === undefined) {
      throw new Error('no stock Droid to read');
    }
    return app;
  };

  test('the anchor applies exactly once with no minified names to resolve', () => {
    const rebased = rebaseAll(
      sessionHistoryPatches,
      source(false).map((module) => module.text),
    );
    expect(rebased).toHaveLength(1);
    expect(rebased[0] && applies(rebased[0])).toBe(true);
    expect(rebased[0]?.matches).toBe(1);
    expect(rebased[0]?.renames).toEqual({});
  });

  test('only the history method joins the shipped exemption set', () => {
    const original = client(source(false));
    const changed = client(source(true));
    expect(original.methods.has(HISTORY)).toBe(false);
    expect(original.methods.has('daemon.answer_elicitation')).toBe(true);
    expect(changed.methods.has('daemon.answer_elicitation')).toBe(true);
    expect(changed.methods).toEqual(new Set([...original.methods, HISTORY]));
    expect(changed.methods.size).toBe(original.methods.size + 1);
  });

  test('unpatched history reads load a runtime before reading saved messages', async () => {
    const messages = [{ role: 'assistant', text: 'Finished' }];
    const original = client(source(false), new Map([['finished', messages]]));
    expect(await original.request('finished', HISTORY)).toEqual(messages);
    expect(original.loaded).toEqual(new Set(['finished']));
    expect(original.events).toEqual(['load:finished', `dispatch:${HISTORY}:finished`]);
  });

  test('reading more than fifty completed agents returns every history without loading any', async () => {
    const histories = new Map(
      Array.from(
        { length: 64 },
        (_, index) =>
          [`finished-${index}`, [{ role: 'assistant', text: `Finished agent ${index}` }]] as const,
      ),
    );
    const changed = client(source(true), histories);
    const records = await Promise.all(
      [...histories].map(async ([sessionId, messages]) => {
        const result = await changed.request(sessionId, HISTORY);
        expect(result).toEqual(messages);
        return result;
      }),
    );
    expect(records).toHaveLength(64);
    expect(changed.loaded).toEqual(new Set());
    expect(changed.events).toHaveLength(64);
    expect(changed.events.every((event) => event.startsWith('dispatch:'))).toBe(true);
    expect(changed.sendingAllowed).toEqual([]);

    await changed.request('live', 'daemon.add_user_message');
    expect(changed.loaded).toEqual(new Set(['live']));
    expect(changed.sendingAllowed).toEqual(['live']);
    expect(changed.events.slice(-2)).toEqual([
      'load:live',
      'dispatch:daemon.add_user_message:live',
    ]);
  });

  test.each(['daemon.add_user_message', 'daemon.update_session_settings'])(
    '%s still loads its session before dispatch',
    async (method) => {
      const changed = client(source(true));
      await changed.request('live', method);
      expect(changed.loaded).toEqual(new Set(['live']));
      expect(changed.events).toEqual(['load:live', `dispatch:${method}:live`]);
      expect(changed.sendingAllowed).toEqual(method === 'daemon.add_user_message' ? ['live'] : []);
    },
  );

  test('the existing lifecycle exemptions still dispatch without automatic loading', async () => {
    const changed = client(source(true));
    await Promise.all(
      [
        'daemon.load_session',
        'daemon.close_session',
        'daemon.interrupt_session',
        'daemon.answer_elicitation',
      ].map(async (method) => await changed.request('live', method)),
    );
    expect(changed.loaded).toEqual(new Set());
    expect(changed.events).toHaveLength(4);
  });
});
