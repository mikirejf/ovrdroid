import { CACHE_CLOCK_ENV, CACHE_CLOCK_KEY, CACHE_CLOCK_RUNTIME_KEY } from '../cache-clock.ts';
import { KEEP_WARM_SET_KEY, STREAMING_CORE_IMPORT, warmerPatches } from '../warmer-patches.ts';
import type { ClockEnvironment, ClockRuntime, Logged } from './clock-env.ts';
import { ClockEnv } from './clock-env.ts';
import { patchNamed, payloadFunction } from './payload.ts';

export interface Snapshot {
  reasoningEffort: string;
  sessionId: string;
  modelId: string;
  capturedAt: number;
  tools: string[];
  systemMessage: { type: string; text: string }[];
  preparedHistory: { content: { cache_control?: { type: string } }[] }[];
}

export interface Timer {
  id: number;
  delay: number;
  callback: () => void;
  unref: () => void;
}

export interface StoredSnapshot {
  snapshot: Snapshot;
  capturedBy: WeakRef<ProcessHost>;
}

export interface ProcessHost {
  name: string;
}

interface WarmEntry {
  snap: Snapshot;
  timer: Timer;
}

interface SentRequest {
  maxTokensOverride: number;
  reasoningEffort: string;
  conversationHistory: Snapshot['preparedHistory'];
}

export interface UsageCommit {
  inputTokens: number;
  odWarm?: boolean;
}

interface SessionService {
  name: string;
  readonly currentSessionId: string;
  commitTurnTokenUsage: (usage: UsageCommit, model: string) => void;
  addTokenUsage: (usage: UsageCommit, streaming: boolean) => void;
  recordTimeToFirstToken: (ms: number) => void;
  whoAmI: () => string;
}

export interface SessionWrite {
  method: string;
  sessionId: string;
  args: unknown[];
}

interface CoreDeps {
  getTools?: unknown;
  getRetryStrategy: () => string;
  session: SessionService;
}

interface CoreOptions {
  emitLlmRetryStatus: boolean;
  platformOverrides: { useOpenAIResponsesWebSocket: () => boolean };
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export interface Reply {
  wasAborted: boolean;
  usage: Usage;
}

export interface WarmLine {
  s: string;
  warm: boolean;
  ok: boolean;
  cr: number;
  cw: number;
}

interface StreamingCore {
  abortStreaming: () => void;
  dispose: () => void;
  sendMessage: (request: SentRequest) => Promise<Reply>;
}

interface Harness {
  pY: (snapshot: Snapshot) => void;
  vu: (sessionId: string) => void;
  LV: (sessionId: string) => void;
  mY: (sessionId: string) => void;
  nY: (sessionId: string, host: ProcessHost) => void;
  fire: (sessionId: string, entry: WarmEntry | undefined) => Promise<void>;
  warm: Map<string, WarmEntry>;
  snapshots: Map<string, StoredSnapshot>;
}

export const SESSION = 'parent';
export const OTHER_SESSION = 'other';
export const SERVICE_NAME = 'session service';
export const KEEP_WARM_KEY = '__odKeepWarm';
export const MINUTE_MS = 60_000;
export const ANTHROPIC_DELAY_MS = 45 * MINUTE_MS;

export const USAGE: Usage = {
  inputTokens: 3,
  outputTokens: 1,
  cacheReadInputTokens: 12_562,
  cacheCreationInputTokens: 0,
};

const MODEL = 'custom:droidproxy:claude';
const ARM = patchNamed(warmerPatches, 'cache-warm-arm').replace;
const CLOSE = patchNamed(warmerPatches, 'cache-warm-close');
const FORGET = patchNamed(warmerPatches, 'cache-warm-forget');
const LIFECYCLE =
  'function mY(t){Qh.delete(t)}function nY(t,o){if(Qh.get(t)?.capturedBy.deref()===o)Qh.delete(t)}'
    .replace(CLOSE.find, CLOSE.replace)
    .replace(FORGET.find, FORGET.replace);
const STOCK_VU =
  'function vu(t){let s=Wa.get(t);if(!s)return;clearTimeout(s.timer),s.abortController?.abort(),Wa.delete(t)}';
const EXPORTS = 'return{pY,vu,LV:mY,mY,nY,fire:$ODWf,warm:$ODWt,snapshots:Qh}';

type HarnessBindings = [
  Map<string, StoredSnapshot>,
  () => void,
  Map<string, WarmEntry>,
  () => { modelProvider: string },
  (message: string, detail: Logged['detail']) => void,
  () => SessionService,
  () => object,
  (callback: () => void, delay: number) => Timer,
  (timer: Timer) => void,
  (deps: CoreDeps, options: CoreOptions) => StreamingCore,
  { env: Record<string, string> },
  ClockEnvironment,
  () => ProcessHost,
];

export function snapshot(capturedAt: number, sessionId = SESSION): Snapshot {
  return {
    reasoningEffort: 'low',
    sessionId,
    modelId: MODEL,
    capturedAt,
    tools: [],
    systemMessage: [{ type: 'text', text: 'system' }],
    preparedHistory: [{ content: [{ cache_control: { type: 'ephemeral' } }] }],
  };
}

function ignore(): void {}

export function cacheClockAt(sessionId = SESSION): number | undefined {
  const clock: unknown = Object.getOwnPropertyDescriptor(globalThis, CACHE_CLOCK_KEY)?.value;
  if (!(clock instanceof Map)) {
    return undefined;
  }
  const entry: unknown = clock.get(sessionId);
  return typeof entry === 'object' &&
    entry !== null &&
    'at' in entry &&
    typeof entry.at === 'number'
    ? entry.at
    : undefined;
}

type KeepWarmCommand = (argument?: string) => string;

function isKeepWarmCommand(value: unknown): value is KeepWarmCommand {
  return typeof value === 'function';
}

function isClock(value: unknown): value is Pick<ClockRuntime, 'listen'> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'listen' in value &&
    typeof value.listen === 'function'
  );
}

function isSessionSet(value: unknown): value is Set<string> {
  return value instanceof Set;
}

export function listenToClock(listener: () => void): void {
  const clock: unknown = Object.getOwnPropertyDescriptor(
    globalThis,
    CACHE_CLOCK_RUNTIME_KEY,
  )?.value;
  if (!isClock(clock)) {
    throw new TypeError(`${CACHE_CLOCK_RUNTIME_KEY} was never defined`);
  }
  clock.listen(listener);
}

export function keepWarmSessions(): ReadonlySet<string> {
  const sessions: unknown = Object.getOwnPropertyDescriptor(globalThis, KEEP_WARM_SET_KEY)?.value;
  if (!isSessionSet(sessions)) {
    throw new TypeError(`${KEEP_WARM_SET_KEY} was never defined`);
  }
  return sessions;
}

export function keepWarm(argument?: string): string {
  const command: unknown = Object.getOwnPropertyDescriptor(globalThis, KEEP_WARM_KEY)?.value;
  if (!isKeepWarmCommand(command)) {
    throw new TypeError(`${KEEP_WARM_KEY} was never defined`);
  }
  return command(argument);
}

export class World {
  readonly harness: Harness;
  readonly timers: Timer[] = [];
  readonly cleared: Timer[] = [];
  readonly sent: SentRequest[] = [];
  readonly logged: WarmLine[] = [];
  readonly writes: SessionWrite[] = [];
  readonly clock = new ClockEnv();
  readonly env: Record<string, string> = {};
  readonly built: { deps: CoreDeps; options: CoreOptions }[] = [];
  readonly host: ProcessHost = { name: 'process host' };
  aborted = 0;
  disposed = 0;
  children = 0;
  current = SESSION;
  provider = 'anthropic';
  reply = Promise.resolve<Reply>({ wasAborted: false, usage: USAGE });

  constructor() {
    Object.assign(globalThis, {
      __odKids: (): number => this.children,
      __odUsage: (line: WarmLine): void => {
        this.logged.push(line);
      },
    });
    const build = payloadFunction<HarnessBindings, Harness>(
      [
        'Qh',
        'z5',
        'Wa',
        'ee',
        'n',
        'p',
        'C',
        'setTimeout',
        'clearTimeout',
        '$client',
        'process',
        '$clockEnv',
        'Dt',
      ],
      `${ARM}${STOCK_VU}${LIFECYCLE}${EXPORTS}`
        .replace(STREAMING_CORE_IMPORT, '{createLLMStreamingCore:$client}')
        .replace(CACHE_CLOCK_ENV, '$clockEnv'),
    );
    this.harness = build(
      new Map(),
      ignore,
      new Map(),
      () => ({ modelProvider: this.provider }),
      this.clock.log,
      () => this.sessionService(),
      () => ({}),
      (callback, delay) => {
        const timer = { id: this.timers.length, delay, callback, unref: ignore };
        this.timers.push(timer);
        return timer;
      },
      (timer) => {
        this.cleared.push(timer);
      },
      (deps, options) => this.streamingCore(deps, options),
      { env: this.env },
      this.clock.environment(),
      () => this.host,
    );
  }

  request(capturedAt: number, sessionId = SESSION): void {
    this.harness.pY(snapshot(capturedAt, sessionId));
  }

  async fireCurrent(): Promise<void> {
    await this.fireSession(SESSION);
  }

  async fireSession(sessionId: string): Promise<void> {
    await this.harness.fire(sessionId, this.harness.warm.get(sessionId));
  }

  static close(): void {
    Reflect.deleteProperty(globalThis, KEEP_WARM_KEY);
    Reflect.deleteProperty(globalThis, KEEP_WARM_SET_KEY);
    Reflect.deleteProperty(globalThis, '__odKids');
    Reflect.deleteProperty(globalThis, '__odUsage');
    ClockEnv.close();
  }

  private sessionService(): SessionService {
    const current = (): string => this.current;
    const record =
      (method: string) =>
      (...args: unknown[]): void => {
        this.writes.push({ method, sessionId: this.current, args });
      };
    return {
      name: SERVICE_NAME,
      get currentSessionId(): string {
        return current();
      },
      commitTurnTokenUsage: record('commitTurnTokenUsage'),
      addTokenUsage: record('addTokenUsage'),
      recordTimeToFirstToken: record('recordTimeToFirstToken'),
      whoAmI(): string {
        return this.name;
      },
    };
  }

  private streamingCore(deps: CoreDeps, options: CoreOptions): StreamingCore {
    this.built.push({ deps, options });
    return {
      abortStreaming: (): void => {
        this.aborted += 1;
      },
      dispose: (): void => {
        this.disposed += 1;
      },
      sendMessage: async (request): Promise<Reply> => {
        this.sent.push(request);
        return await this.reply;
      },
    };
  }
}
