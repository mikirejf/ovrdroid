import { existsSync, readFileSync } from 'node:fs';

import { patchSource } from '../../binary/apply.ts';
import type { App } from '../../binary/graph.ts';
import { joinApp, readApp } from '../../binary/graph.ts';
import { backupPath, INSTALLED_DROID } from '../../paths.ts';
import { findMarker } from '../patches.ts';
import type { Rebase } from '../rebase.ts';
import { rebaseAll } from '../rebase.ts';
import {
  SESSION_COMPLETE,
  SESSION_ITEMS,
  SESSION_MATCHES,
  SESSION_POOL,
  SESSION_QUERY,
  sessionMentionPatches,
} from '../session-mention-patches.ts';
import { blockEnd } from '../tokens.ts';
import { payloadFunction } from './payload.ts';

export interface Session {
  id: string;
  title: string;
  messageCount: number;
  modifiedTime: Date;
  isSubagent?: boolean;
}

export interface Hash {
  query: string;
  start: number;
}

interface Completion {
  newText: string;
  newCursorPosition: number;
}

export interface Item {
  label: string;
  value: string;
  $ODsession?: string;
}

export interface Picker {
  $ODsessionQuery: (text: string, cursor: number) => Hash | null;
  $ODsessionPool: (all: readonly Session[], self: string | null) => Session[];
  $ODsessionMatches: (pool: readonly Session[], query: string, max: number) => Session[];
  $ODsessionComplete: (text: string, cursor: number, id: string) => Completion;
  $ODsessionItems: (rows: readonly Session[], width: number) => Item[];
}

export const AGO = '3h ago';

export const picker = payloadFunction<
  [
    (date: Date) => string,
    (title: string) => string,
    (text: string, width: number) => string,
    () => { t: (key: string) => string },
  ],
  Picker
>(
  ['Mm', 'ZT', 'DB', 'R'],
  `return class{${SESSION_QUERY}${SESSION_POOL}${SESSION_MATCHES}${SESSION_COMPLETE}${SESSION_ITEMS}}`,
)(
  () => AGO,
  (title) => title,
  (text, width) => (text.length <= width ? text : `${text.slice(0, width - 3)}...`),
  () => ({ t: () => 'Untitled' }),
);

export function session(id: string, title: string, minutesAgo: number): Session {
  return {
    id,
    title,
    messageCount: 4,
    modifiedTime: new Date(Date.UTC(2026, 0, 1) - minutesAgo * 60_000),
  };
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
  update: (text: string, cursor: number) => Promise<void>;
  close: () => void;
  finishLoad: (sessions: readonly Session[]) => Promise<void>;
}

const PATH_QUERY = /@(?<query>\S*)$/u;

function rebasedNamed(rebased: readonly Rebase[], name: string): Rebase {
  const rebase = rebased.find((entry) => entry.name === name);
  if (rebase === undefined) {
    throw new TypeError(`${name} is missing from the session mention patches`);
  }
  return rebase;
}

function callbackAround(text: string, anchor: string): string {
  const at = text.indexOf(anchor);
  if (at === -1) {
    throw new Error('the patched suggestions callback is missing');
  }
  const start = text.lastIndexOf('async(', at);
  const open = text.indexOf('=>{', start) + 2;
  return text.slice(start, blockEnd(text, open) + 1);
}

function setterArrow(replace: string): string {
  const arrow = /^[\w$]+=[\w$]+\((?<arrow>.*),\[[\w$,]*\]\)$/su.exec(replace)?.groups?.['arrow'];
  if (arrow === undefined) {
    throw new Error('the patched setShowSuggestions has an unexpected shape');
  }
  return arrow;
}

function calleeAfter(source: string, pattern: RegExp): string {
  const name = pattern.exec(source)?.groups?.['name'];
  if (name === undefined) {
    throw new Error(`the suggestions callback no longer matches ${pattern.source}`);
  }
  return name;
}

function escaped(name: string): string {
  return name.replaceAll('$', String.raw`\$`);
}

type Stand = object | number | boolean | null | undefined;

interface Scope {
  readonly stubs: Map<string, Stand>;
}

function scopeOver(stubs: Map<string, Stand>) {
  return new Proxy<Scope>(
    { stubs },
    {
      has: (_target, key) => typeof key === 'string' && (stubs.has(key) || !(key in globalThis)),
      get: (_target, key) => {
        if (typeof key !== 'string') {
          return null;
        }
        if (!stubs.has(key)) {
          stubs.set(key, () => null);
        }
        return stubs.get(key);
      },
    },
  );
}

function scoped(source: string): string {
  return `with($ODscope){return ${source}}`;
}

async function settle(): Promise<void> {
  await Bun.sleep(5);
}

export function sessionDriver(app: App): Driver {
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
  const loads: ((sessions: readonly Session[]) => void)[] = [];
  const fileSearch = {
    isInPathContext: ({ text, cursorPosition }: { text: string; cursorPosition: number }) =>
      PATH_QUERY.test(text.slice(0, cursorPosition)),
    extractPathQuery: ({ text, cursorPosition }: { text: string; cursorPosition: number }) => ({
      pathQuery: PATH_QUERY.exec(text.slice(0, cursorPosition))?.groups?.['query'] ?? '',
    }),
  };
  const stubs = new Map<string, Stand>([
    [named('Po'), { current: 0 }],
    [
      named('Ba'),
      {
        workingDirectory: '/work',
        getSuggestions: async () => {
          await Promise.resolve();
          return [];
        },
      },
    ],
    [named('uu'), Object.assign(Object.create(picker), fileSearch)],
    [named('Pe'), false],
    [named('_e'), false],
    [named('U'), 120],
    [named('r5'), 100],
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
  const update = payloadFunction<[typeof scope], (text: string, cursor: number) => Promise<void>>(
    ['$ODscope'],
    scoped(callback),
  )(scope);

  return {
    suggestions,
    update: async (text, cursor) => {
      await update(text, cursor);
      await settle();
    },
    close: () => {
      close(false);
    },
    finishLoad: async (sessions) => {
      for (const load of loads.splice(0)) {
        load(sessions);
      }
      await settle();
    },
  };
}
