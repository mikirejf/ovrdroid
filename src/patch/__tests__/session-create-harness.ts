import type { Settings, Sites } from './first-message-harness.ts';
import { arrowBefore, evaluate, groups, renamed } from './first-message-harness.ts';
import type { Stand } from './session-mention-scope.ts';

export interface CreateWorld {
  readonly pending: Map<string | null, Settings>;
  readonly started: Settings[];
  readonly updates: Settings[];
  currentId: string | null;
  create: () => Promise<string | null>;
}

export function createWorld(sites: Sites, unpatched = false): CreateWorld {
  const rebase = sites.rebase('session-create-keeps-early-settings');
  const named = renamed(rebase);
  const patched = arrowBefore(sites.text, rebase);
  const source = unpatched ? patched.replace(rebase.replace, rebase.find) : patched;
  const head = groups(
    source,
    /^async\(\)=>\{let [\w$]+=(?<client>[\w$]+)\(\),[\w$]+=null,[\w$]+=null;try\{let [\w$]+=(?<service>[\w$]+)\(\),[\w$]+=[\w$]+\.getCurrentSessionId\(\)\?\?void 0;[\w$]+=[\w$]+\?\?null;let [\w$]+=[\w$]+!==void 0\?(?<snapshot>[\w$]+)\(\):void 0,[\w$]+=[\w$]+\.getCurrentSessionTags\(\),[\w$]+=(?<cwd>[\w$]+)\(\);/u,
    'session create head',
  );
  const defaults = groups(
    source,
    /(?<read>[\w$]+)\([\w$]+\.getSessionStateManager\(\)\.getDefaultSettingsStore\(\)\)/u,
    'default settings reader',
  );
  const applied = groups(
    source,
    /\.sessionId;(?<ref>[\w$]+)\.current=[\w$]+;let [\w$]+=\{[^;]*\.\.\.[\w$]+\([\w$]+\)\};if\([\w$]+=null,(?<nonEmpty>[\w$]+)\([\w$]+\)\)\{let [\w$]+=[\w$]+\.getSessionStateManager\(\)\.getSessionManager\([\w$]+\)\?\.getStore\(\);if\([\w$]+\)(?<apply>[\w$]+)\(/u,
    'pending settings apply',
  );
  const done = groups(
    source,
    /return (?<bus>[\w$]+)\.emit\("session-created",\{sessionId:[\w$]+\}\),(?<first>[\w$]+)\([\w$]+\),(?<second>[\w$]+)\([\w$]+\),[\w$]+\}catch/u,
    'session created hand-off',
  );
  const failure = groups(
    source,
    /catch\((?<error>[\w$]+)\)\{if\([\w$]+\)(?<keep>[\w$]+)\.current\.set\([\w$]+,[^;]*?\);return (?<log>[\w$]+)\(\k<error>,"\[Daemon\] Failed to create session"\),(?<notice>[\w$]+)\((?<describe>[\w$]+)\(/u,
    'session create failure',
  );
  const pending = new Map<string | null, Settings>();
  const started: Settings[] = [];
  const updates: Settings[] = [];
  const world: CreateWorld = {
    pending,
    started,
    updates,
    currentId: null,
    create: async () => await Promise.resolve(null),
  };
  const client = {
    ensureConnectedAndGetController: async () => await Promise.resolve(null),
    getSessionStateManager: () => ({
      getDefaultSettingsStore: () => null,
      getSessionManager: () => null,
    }),
    initializeTuiSession: async (args: Settings) => {
      await Promise.resolve();
      started.push(args);
      return { sessionId: world.currentId ?? 'new' };
    },
    updateSessionSettings: async (settings: Settings) => {
      await Promise.resolve();
      updates.push(settings);
    },
  };
  const stubs = new Map<string, Stand>([
    [head('client'), () => client],
    [
      head('service'),
      () => ({ getCurrentSessionId: () => world.currentId, getCurrentSessionTags: () => null }),
    ],
    [head('snapshot'), () => null],
    [head('cwd'), () => '/work'],
    [defaults('read'), () => ({ reasoningEffort: 'medium' })],
    [
      named('qe'),
      (key: string | null) => {
        const found = pending.get(key) ?? {};
        pending.delete(key);
        return found;
      },
    ],
    [applied('ref'), { current: null }],
    [applied('nonEmpty'), (settings: Settings) => Object.keys(settings).length > 0],
    [applied('apply'), () => null],
    [done('bus'), { emit: () => null }],
    [done('first'), () => null],
    [done('second'), () => null],
    [failure('keep'), { current: pending }],
    [failure('log'), () => null],
    [failure('notice'), () => null],
    [failure('describe'), () => ''],
  ]);
  world.create = evaluate<() => Promise<string | null>>(source, stubs);
  return world;
}
