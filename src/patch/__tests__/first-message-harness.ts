import { patchSource } from '../../binary/apply.ts';
import type { App } from '../../binary/graph.ts';
import { joinApp } from '../../binary/graph.ts';
import { patches } from '../patches.ts';
import type { Rebase } from '../rebase.ts';
import { rebaseAll } from '../rebase.ts';
import { blockEnd } from '../tokens.ts';
import { patchNamed, payloadFunction, rebasedNamed } from './payload.ts';
import type { Stand } from './session-mention-scope.ts';
import { scoped, scopeOver } from './session-mention-scope.ts';

const NAMES = [
  'session-load-keeps-pending-settings',
  'first-message-shows-at-once',
  'escape-keeps-turn-running',
] as const;

type Name = (typeof NAMES)[number];

export interface Sites {
  text: string;
  rebase: (name: Name) => Rebase;
}

export function patchedSites(app: App): Sites {
  const list = NAMES.map((name) => patchNamed(patches, name));
  const rebased = rebaseAll(
    list,
    app.map((module) => module.text),
  );
  return {
    text: joinApp(patchSource(app, list)),
    rebase: (name) => rebasedNamed(rebased, name),
  };
}

function renamed(rebase: Rebase): (name: string) => string {
  return (name) => rebase.renames[name] ?? name;
}

function arrowAt(text: string, start: number): string {
  const open = text.indexOf('=>{', start) + 2;
  return text.slice(start, blockEnd(text, open) + 1);
}

function arrowBefore(text: string, rebase: Rebase): string {
  const at = text.indexOf(rebase.replace);
  if (at === -1) {
    throw new Error(`the ${rebase.name} payload is missing from the patched source`);
  }
  return arrowAt(text, text.lastIndexOf('async(', at));
}

function groups(source: string, pattern: RegExp, what: string): Record<string, string> {
  const found = pattern.exec(source)?.groups;
  if (found === undefined) {
    throw new Error(`the stock ${what} no longer matches ${pattern.source}`);
  }
  return found;
}

// oxlint-disable-next-line typescript/no-unnecessary-type-parameters
function evaluate<Fn>(source: string, stubs: Map<string, Stand>): Fn {
  return payloadFunction<[ReturnType<typeof scopeOver>], Fn>(
    ['$ODscope'],
    scoped(source),
  )(scopeOver(stubs));
}

interface Message {
  id: string;
  content: Content;
}

interface Content {
  text: string;
}

interface SendInput {
  message: string;
  queuePlacement?: string;
}

type Settings = Record<string, string>;
type KeyEvent = Record<string, boolean>;

export class FakeManager {
  state = 'idle';
  readonly optimistic = new Map<string, Message>();
  added = 0;

  getDroidWorkingState(): string {
    return this.state;
  }

  setThinking(): void {
    this.state = 'thinking';
  }

  stopStreaming(): void {
    this.state = 'idle';
  }

  addOptimisticMessage(key: string, message: Message): void {
    this.added += 1;
    this.optimistic.set(key, message);
  }

  removeOptimisticMessage(key: string): void {
    this.optimistic.delete(key);
  }

  getOptimisticMessage(key: string): object | undefined {
    return this.optimistic.get(key);
  }

  readonly store = { getInteractionMode: () => 'auto' };
  readonly messages = new Map<string, Message>();

  getStore() {
    return this.store;
  }

  getMessage(id: string) {
    return this.messages.get(id);
  }

  shown(): string[] {
    return [...this.optimistic.values()].map((message) => message.content.text);
  }
}

export interface Sent {
  sessionId: string;
  requestId: string;
  text: string;
}

export interface SendWorld {
  readonly managers: Map<string, FakeManager>;
  readonly sent: Sent[];
  readonly notices: string[];
  currentId: string | null;
  failSend: boolean;
  send: (message: string, queuePlacement?: string) => Promise<string>;
  createSession: (id: string | null) => void;
  pressStop: () => void;
}

export function sendWorld(sites: Sites, managers: Map<string, FakeManager>): SendWorld {
  const rebase = sites.rebase('first-message-shows-at-once');
  const named = renamed(rebase);
  const source = arrowBefore(sites.text, rebase);
  const head = groups(
    source,
    /^async\([\w$]+\)=>\{let [\w$]+=(?<client>[\w$]+)\(\),[\w$]+=!1,[\w$]+=(?<service>[\w$]+)\(\)\.getCurrentSessionId\(\)/u,
    'send callback head',
  );
  const pending = groups(
    source,
    /\((?<set>[\w$]+)\.current\.add\([\w$]+\),(?<flag>[\w$]+)\(!0\)/u,
    'pending submission set',
  );
  const refs = groups(
    source,
    /let [\w$]+=[\w$]+\.current\|\|(?<creating>[\w$]+)\.current\?null:(?<live>[\w$]+)\.current/u,
    'session refs',
  );
  const ids = groups(source, /\?\?[\w$]+\?\.requestId\?\?(?<id>[\w$]+)\(\)/u, 'request id');
  const failure = groups(
    source,
    /(?<log>[\w$]+)\([\w$]+,"\[Daemon\] Failed to send message"\),(?<notice>[\w$]+)\((?<describe>[\w$]+)\(/u,
    'send failure notice',
  );
  const sent: Sent[] = [];
  const notices: string[] = [];
  const submissions = { current: new Set<() => boolean>() };
  let session = Promise.withResolvers<string | null>();
  let nextId = 0;
  const world: SendWorld = {
    managers,
    sent,
    notices,
    currentId: null,
    failSend: false,
    send: async () => await Promise.resolve('unbound'),
    createSession: (id) => {
      session.resolve(id);
    },
    pressStop: () => {
      for (const withdraw of submissions.current) {
        withdraw();
      }
      submissions.current = new Set();
    },
  };
  const client = {
    getSessionStateManager: () => ({ getSessionManager: (id: string) => managers.get(id) ?? null }),
    ensureRemoteSessionReady: () => null,
    subscribeToSessionNotifications: () => () => null,
    sendTuiMessage: async (args: Sent & { beforeDispatch: () => boolean }) => {
      await Promise.resolve();
      if (world.failSend) {
        throw new Error('send failed');
      }
      if (args.beforeDispatch()) {
        sent.push({ sessionId: args.sessionId, requestId: args.requestId, text: args.text });
      }
    },
  };
  const stubs = new Map<string, Stand>([
    [head['client'] ?? '', () => client],
    [head['service'] ?? '', () => ({ getCurrentSessionId: () => world.currentId })],
    [pending['set'] ?? '', submissions],
    [pending['flag'] ?? '', () => null],
    [named('Oe'), { current: null }],
    [refs['creating'] ?? '', { current: null }],
    [refs['live'] ?? '', { current: null }],
    [named('Ln'), async () => await session.promise],
    [
      ids['id'] ?? '',
      () => {
        nextId += 1;
        return `id-${nextId}`;
      },
    ],
    [named('l0'), (placement: string | undefined) => placement ?? 'end_of_turn'],
    [named('dk'), (content: Content) => content],
    [named('$He'), (images: string[] | undefined) => images],
    [failure['log'] ?? '', () => null],
    [failure['describe'] ?? '', (error: Error) => error.message],
    [failure['notice'] ?? '', (text: string) => notices.push(text)],
  ]);
  const send = evaluate<(input: SendInput) => Promise<string>>(source, stubs);
  world.send = async (message, queuePlacement) => {
    session = Promise.withResolvers<string | null>();
    const input: SendInput = { message };
    if (queuePlacement !== undefined) {
      input.queuePlacement = queuePlacement;
    }
    return await send(input);
  };
  return world;
}

export interface LoadWorld {
  readonly pending: Map<string, Settings>;
  readonly updates: Settings[];
  readonly logged: string[];
  settingsDuringLoad: Settings | undefined;
  failUpdate: boolean;
  load: (id: string) => Promise<string | null>;
}

export function loadWorld(sites: Sites): LoadWorld {
  const rebase = sites.rebase('session-load-keeps-pending-settings');
  const named = renamed(rebase);
  const source = arrowBefore(sites.text, rebase);
  const head = groups(
    source,
    /^async\(\)=>\{let [\w$]+=(?<client>[\w$]+)\(\);(?<deferred>[\w$]+)\.current=null/u,
    'session load head',
  );
  const pending = new Map<string, Settings>();
  const updates: Settings[] = [];
  const logged: string[] = [];
  const world: LoadWorld = {
    pending,
    updates,
    logged,
    settingsDuringLoad: undefined,
    failUpdate: false,
    load: async () => await Promise.resolve(null),
  };
  const client = {
    loadSession: async ({ sessionId }: { sessionId: string }) => {
      await Promise.resolve();
      if (world.settingsDuringLoad !== undefined) {
        pending.set(sessionId, world.settingsDuringLoad);
      }
    },
    updateSessionSettings: async (settings: Settings) => {
      await Promise.resolve();
      if (world.failUpdate) {
        throw new Error('update failed');
      }
      updates.push(settings);
    },
  };
  const stubs = new Map<string, Stand>([
    [head['client'] ?? '', () => client],
    [head['deferred'] ?? '', { current: null }],
    [named('De'), { current: null }],
    [named('ot'), { current: pending }],
    [named('c4'), (settings: Settings) => Object.keys(settings).length > 0],
    [named('r'), (message: string) => logged.push(message)],
    [named('ae'), { emit: () => null }],
  ]);
  const load = evaluate<(id: string) => Promise<string | null>>(
    `(${named('dt')})=>(${source})()`,
    stubs,
  );
  world.load = load;
  return world;
}

export interface EscapeWorld {
  readonly stops: number[];
  press: (state: { working: string; pending: boolean }) => boolean;
}

export function escapeWorld(sites: Sites): EscapeWorld {
  const rebase = sites.rebase('escape-keeps-turn-running');
  const named = renamed(rebase);
  const at = sites.text.indexOf(rebase.replace);
  const window = sites.text.slice(Math.max(0, at - 400), at + rebase.replace.length);
  const guard =
    /\((?<key>[\w$]+)\)=>\{if\(!(?<is>[\w$]+)\(\k<key>,"escape"\)\)return!1;if\((?<a>[\w$]+)\|\|(?<b>[\w$]+)\|\|(?<c>[\w$]+)\|\|(?<d>[\w$]+)\.current\|\|(?<e>[\w$]+)!==void 0\)return!1;if\((?<shell>[\w$]+)\.isExecuting\)/u;
  const found = groups(window, guard, 'Esc handler guard');
  const start = window.search(guard);
  const source = arrowAt(window, start);
  const stops: number[] = [];
  const stubs = new Map<string, Stand>([
    [found['is'] ?? '', (_key: KeyEvent, name: string) => name === 'escape'],
    [found['a'] ?? '', false],
    [found['b'] ?? '', false],
    [found['c'] ?? '', false],
    [found['d'] ?? '', { current: false }],
    [found['e'] ?? '', undefined],
    [found['shell'] ?? '', { isExecuting: false }],
    [named('V3'), () => stops.push(1)],
  ]);
  const handler = evaluate<(working: string, pending: boolean) => (key: KeyEvent) => boolean>(
    `(${named('Ss')},${named('JC')})=>${source}`,
    stubs,
  );
  return {
    stops,
    press: ({ working, pending }) => handler(working, pending)({}),
  };
}
