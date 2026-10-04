import { existsSync, readFileSync } from 'node:fs';

import { patchSource } from '../../binary/apply.ts';
import type { App } from '../../binary/graph.ts';
import { joinApp, readApp } from '../../binary/graph.ts';
import { backupPath, INSTALLED_DROID } from '../../paths.ts';
import { findMarker } from '../patches.ts';
import { rebaseAll } from '../rebase.ts';
import { sessionMentionPatches } from '../session-mention-patches.ts';
import { payloadFunction } from './payload.ts';
import {
  callbackAround,
  calleeAfter,
  escaped,
  rebasedNamed,
  setterArrow,
} from './session-mention-callback.ts';
import type { EscapePath, KeyResult } from './session-mention-keys.ts';
import { enterKey, escapeKeys, serviceEffect } from './session-mention-keys.ts';
import type { Hash, Head, Item, Session } from './session-mention-picker.ts';
import { picker, pickerReading } from './session-mention-picker.ts';
import type { Stand } from './session-mention-scope.ts';
import { scoped, scopeOver } from './session-mention-scope.ts';

export { picker, pickerReading, scoped, scopeOver };
export type { Hash, Head, Item, Session, Stand };
export type { Files, Picker, ReadArgs, Tree } from './session-mention-picker.ts';

export function session(id: string, title: string, minutesAgo: number): Session {
  return {
    id,
    title,
    messageCount: 4,
    modifiedTime: new Date(Date.UTC(2026, 0, 1) - minutesAgo * 60_000),
    cwd: '/work',
  };
}

interface MessageExtra {
  visibility?: string;
  pad?: string;
}

export function userLine(text: string, extra: MessageExtra = {}): string {
  return JSON.stringify({
    type: 'message',
    id: 'm1',
    message: { role: 'user', content: [{ type: 'text', text }], ...extra },
  });
}

const START = JSON.stringify({ type: 'session_start', id: 's', title: 'T' });
const HOOK = JSON.stringify({
  type: 'message',
  id: 'h1',
  message: { role: 'user', content: [], visibility: 'user_only', hookEventName: 'SessionStart' },
});
export function contextLine(text: string, id = 'context-m1'): string {
  return JSON.stringify({
    type: 'message',
    id,
    message: { role: 'user', content: [{ type: 'text', text }], visibility: 'llm_only' },
  });
}

export function transcriptWith(context: string, ...lines: string[]): string {
  return `${[START, HOOK, context, ...lines].join('\n')}\n`;
}

export function transcript(...lines: string[]): string {
  return transcriptWith(contextLine('tool list\n</system-reminder>'), ...lines);
}

export const stock: App | undefined = [INSTALLED_DROID, backupPath(INSTALLED_DROID)]
  .filter((path) => existsSync(path))
  .map((path) => readApp(readFileSync(path)))
  .find((app) => findMarker(app[0].text) === undefined);

export interface Suggestions {
  shown: boolean;
  items: readonly Item[];
}

export interface Driver {
  readonly suggestions: Suggestions;
  readonly transcriptsRead: string[];
  readonly background: { pending: () => number };
  readonly selected: () => number;
  readonly stockEscapes: string[];
  readonly bash: { active: boolean };
  update: (text: string, cursor: number) => Promise<void>;
  close: () => void;
  pressEscape: (path?: EscapePath) => KeyResult;
  pressDown: () => void;
  pressEnter: () => string | undefined;
  replaceService: () => void;
  unmount: () => void;
  finishLoad: (sessions: readonly Session[]) => Promise<void>;
  runBatch: () => Promise<void>;
  runBatchUnrendered: () => void;
  runAllBatches: () => Promise<void>;
  render: () => void;
}

export type FirstMessages = Readonly<Record<string, string>>;

const PATH_QUERY = /@(?<query>\S*)$/u;

function newService() {
  return {
    workingDirectory: '/work',
    getSuggestions: async () => {
      await Promise.resolve();
      return [];
    },
  };
}

async function settle(): Promise<void> {
  await Bun.sleep(5);
}

export function sessionDriver(app: App, firstMessages: FirstMessages = {}): Driver {
  const rebased = rebaseAll(
    sessionMentionPatches,
    app.map((module) => module.text),
  );
  const renames = new Map(
    ['session-mention-invalidate', 'session-mention-close-cancels', 'session-mention-suggest']
      .map((name) => rebasedNamed(rebased, name))
      .flatMap((rebase) => Object.entries(rebase.renames)),
  );
  const named = (name: string): string => renames.get(name) ?? name;
  const patched = joinApp(patchSource(app, sessionMentionPatches));
  const callback = callbackAround(
    patched,
    rebasedNamed(rebased, 'session-mention-invalidate').replace,
  );
  const setter = setterArrow(rebasedNamed(rebased, 'session-mention-close-cancels').replace);

  const suggestions: Suggestions = { shown: false, items: [] };
  const transcriptsRead: string[] = [];
  const loads: ((sessions: readonly Session[]) => void)[] = [];
  const queued: (() => void)[] = [];
  const entry = { selected: 0, keyIndex: 0, text: '', cursor: 0 };
  const render = () => {
    entry.keyIndex = entry.selected;
  };
  const fileSearch = {
    $ODsessionHead: (path: string): Head => {
      transcriptsRead.push(path);
      const id = path.slice(path.lastIndexOf('/') + 1, -'.jsonl'.length);
      return { text: firstMessages[id] ?? `typed into ${path}`, branch: null };
    },
    isInPathContext: ({ text, cursorPosition }: { text: string; cursorPosition: number }) =>
      PATH_QUERY.test(text.slice(0, cursorPosition)),
    extractPathQuery: ({ text, cursorPosition }: { text: string; cursorPosition: number }) => ({
      pathQuery: PATH_QUERY.exec(text.slice(0, cursorPosition))?.groups?.['query'] ?? '',
    }),
  };
  const stubs = new Map<string, Stand>([
    [named('Po'), { current: 0 }],
    [named('Ba'), newService()],
    [named('uu'), Object.assign(Object.create(picker), fileSearch)],
    [named('Pe'), false],
    [named('_e'), false],
    [named('U'), 120],
    [named('r5'), 100],
    [
      named('Ro'),
      (choice: number | ((at: number) => number)) => {
        entry.selected = typeof choice === 'number' ? choice : choice(entry.selected);
      },
    ],
    [
      'setTimeout',
      (run: () => void, delay?: number) => {
        if (delay === undefined || delay === 0) {
          queued.push(run);
          return 0;
        }
        return setTimeout(run, delay);
      },
    ],
    [
      named('En'),
      (items: readonly Item[]) => {
        suggestions.items = items;
      },
    ],
    [
      named('zt'),
      (shown: boolean) => {
        suggestions.shown = shown;
      },
    ],
    [
      named('p'),
      () => ({
        getSessionsForSelector: async () => {
          const load = Promise.withResolvers<readonly Session[]>();
          loads.push(load.resolve);
          return await load.promise;
        },
        getCurrentSessionId: () => null,
        getSessionMessagesPath: (id: string, cwd: string) => `${cwd}/${id}.jsonl`,
      }),
    ],
  ]);
  const commandQuery = calleeAfter(
    callback,
    new RegExp(`if\\(!${escaped(named('_e'))}\\)\\{let [\\w$]+=(?<name>[\\w$]+)\\(`, 'u'),
  );
  const commandMatches = calleeAfter(callback, /menuGroupBlock:[\w$]+\}=(?<name>[\w$]+)\(/u);
  stubs.set(commandQuery, (text: string, cursor: number) => {
    const lineEnd = text.indexOf('\n');
    return text.startsWith('/') && cursor <= lineEnd
      ? { kind: 'command', query: text.slice(1, cursor) }
      : null;
  });
  const timings = calleeAfter(callback, /(?<name>[\w$]+)\.FILE_SUGGESTIONS_DEBOUNCE_MS/u);
  stubs.set(timings, { FILE_SUGGESTIONS_DEBOUNCE_MS: 50, FILE_SUGGESTIONS_LOADING_DELAY_MS: 100 });
  stubs.set(commandMatches, () => ({
    commands: [{ name: 'sessions' }],
    menuGroupBlock: undefined,
  }));
  stubs.set(named('qt'), undefined);

  const scope = scopeOver(stubs);
  const close = payloadFunction<[typeof scope], (shown: boolean) => void>(
    ['$ODscope'],
    scoped(setter),
  )(scope);
  stubs.set(named('Qt'), close);
  const hooks = {
    close,
    isShown: () => suggestions.shown,
    rows: () => suggestions.items,
    entry,
    picker,
  };
  const escape = escapeKeys(patched, rebased, hooks);
  const enter = enterKey(patched, rebased, hooks);
  const mount = serviceEffect(rebased, stubs.get(named('Po')));
  let unmount = mount(stubs.get(named('Ba')));
  const callbackFor = (service: Stand) =>
    payloadFunction<[typeof scope], (text: string, cursor: number) => Promise<void>>(
      ['$ODscope'],
      scoped(callback),
    )(scopeOver(new Map(stubs).set(named('Ba'), service)));
  let update = callbackFor(stubs.get(named('Ba')));

  return {
    suggestions,
    transcriptsRead,
    background: { pending: () => queued.length },
    selected: () => entry.selected,
    stockEscapes: escape.escapes,
    bash: escape.bash,
    pressEscape: (path = 'key') => escape.press(path),
    pressDown: () => {
      enter.down();
    },
    pressEnter: () => {
      enter.press();
      return enter.written.at(-1);
    },
    replaceService: () => {
      unmount();
      const next = newService();
      stubs.set(named('Ba'), next);
      update = callbackFor(next);
      unmount = mount(next);
    },
    unmount: () => {
      unmount();
    },
    runBatch: async () => {
      for (const run of queued.splice(0)) {
        run();
      }
      await settle();
      render();
    },
    runBatchUnrendered: () => {
      for (const run of queued.splice(0)) {
        run();
      }
    },
    render,
    runAllBatches: async () => {
      while (queued.length > 0) {
        for (const run of queued.splice(0)) {
          run();
        }
      }
      await settle();
      render();
    },
    update: async (text, cursor) => {
      entry.text = text;
      entry.cursor = cursor;
      await update(text, cursor);
      await settle();
      render();
    },
    close: () => {
      close(false);
    },
    finishLoad: async (sessions) => {
      for (const load of loads.splice(0)) {
        load(sessions);
      }
      await settle();
      render();
    },
  };
}
