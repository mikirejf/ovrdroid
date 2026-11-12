import { describe, expect, test } from 'bun:test';

import { patchSource } from '../../binary/apply.ts';
import { joinApp } from '../../binary/graph.ts';
import { patches } from '../patches.ts';
import { rebaseAll } from '../rebase.ts';
import { blockEnd } from '../tokens.ts';
import {
  evaluate,
  FakeManager,
  patchedSites,
  renamed,
  sendWorld,
} from './first-message-harness.ts';
import { patchNamed, payloadFunction, rebasedNamed } from './payload.ts';
import type { Stand } from './session-mention-scope.ts';
import { requireStock, stockDroid } from './stock-scanner.ts';

const NAMES = [
  'shutdown-flush-deadline',
  'session-load-reads-loaded-settings',
  'first-message-shows-at-once',
  'escape-stop-hint-says-twice',
] as const;

function site(name: (typeof NAMES)[number]) {
  const app = requireStock();
  const list = [patchNamed(patches, name)];
  return {
    rebase: rebasedNamed(
      rebaseAll(
        list,
        app.map((module) => module.text),
      ),
      name,
    ),
    text: joinApp(patchSource(app, list)),
  };
}

interface HintState {
  isRewindProcessing?: boolean;
  isInterruptPending?: boolean;
  isStartingNewSession?: boolean;
  isEscClaimed?: boolean;
}

describe.skipIf(stockDroid === undefined)('core patches on stock source', () => {
  test('shutdown retains cleanup budgets but caps telemetry flushing at ten milliseconds', () => {
    const { rebase } = site('shutdown-flush-deadline');
    const named = renamed(rebase);
    const values = payloadFunction<[], number[]>(
      [],
      `${rebase.replace};return [${['H', 'M', 'R', 'A'].map((name) => named(name)).join(',')}]`,
    )();
    expect(values).toEqual([2000, 10_000, 10, 250]);
  });

  test('a scoped session waits for settings initialization before reading the saved session', async () => {
    const { rebase } = site('session-load-reads-loaded-settings');
    const named = renamed(rebase);
    const initialized = Promise.withResolvers<null>();
    const loads: string[] = [];
    const load = evaluate<
      (
        service: { loadSession: (id: string) => string },
        options: { sessionId: string },
        flags: Record<string, never>,
      ) => Promise<string>
    >(
      `async(${named('t')},${named('e')},${named('x')})=>{let ${rebase.replace};return ${named('U')}}`,
      new Map<string, Stand>([
        [named('_e'), () => true],
        [named('zi'), null],
        [named('C'), () => ({ initialize: async () => await initialized.promise })],
      ]),
    );
    const result = load(
      {
        loadSession: (id) => {
          loads.push(id);
          return 'loaded';
        },
      },
      { sessionId: 's1' },
      {},
    );
    await Bun.sleep(1);
    expect(loads).toEqual([]);
    initialized.resolve(null);
    expect(await result).toBe('loaded');
    expect(loads).toEqual(['s1']);
  });

  test('a global session does not initialize scoped settings', async () => {
    const { rebase } = site('session-load-reads-loaded-settings');
    const named = renamed(rebase);
    let starts = 0;
    const load = evaluate<() => Promise<string>>(
      `async()=>{let ${rebase.replace};return ${named('U')}}`,
      new Map<string, Stand>([
        [named('_e'), () => false],
        [named('zi'), null],
        [
          named('C'),
          () => ({
            initialize: () => {
              starts += 1;
            },
          }),
        ],
        [named('t'), { loadSession: () => 'loaded' }],
        [named('e'), { sessionId: 's1' }],
        [named('x'), {}],
      ]),
    );
    expect(await load()).toBe('loaded');
    expect(starts).toBe(0);
  });

  test('the stop hint still respects waiting and Esc ownership', () => {
    const { rebase, text } = site('escape-stop-hint-says-twice');
    const at = text.indexOf(rebase.replace);
    const start = text.lastIndexOf('function ', at);
    const open = text.indexOf('{', start);
    const hint = evaluate<(state: HintState) => string>(
      text.slice(start, blockEnd(text, open) + 1),
      new Map(),
    );
    expect(hint({})).toBe('(Esc twice to stop)');
    expect(hint({ isEscClaimed: true })).toBe('');
    expect(hint({ isRewindProcessing: true })).toBe('(Please wait)');
    expect(hint({ isInterruptPending: true })).toBe('(Please wait)');
    expect(hint({ isStartingNewSession: true, isEscClaimed: true })).toBe('(Please wait)');
  });

  test('an early optimistic message preserves attached documents', async () => {
    const manager = new FakeManager();
    const world = sendWorld(patchedSites(requireStock()), new Map([['s1', manager]]));
    const files = [{ type: 'base64', mediaType: 'application/pdf', data: 'cGRm' }];
    world.currentId = 's1';
    const result = world.send('read this', undefined, files);
    await Bun.sleep(1);
    expect([...manager.optimistic.values()].map((message) => message.content.files)).toEqual([
      files,
    ]);
    world.createSession('s1');
    expect(await result).toBe('accepted');
    expect(manager.added).toBe(1);
  });
});
