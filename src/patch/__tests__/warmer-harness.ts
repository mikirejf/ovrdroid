import { STREAMING_CORE_IMPORT, warmerPatches } from '../warmer-patches.ts';
import { patchNamed, payloadFunction } from './payload.ts';

export interface Snapshot {
  effort: string;
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
  fire: (sessionId: string, entry: WarmEntry | undefined) => Promise<void>;
  warm: Map<string, WarmEntry>;
  snapshots: Map<string, Snapshot>;
}

export const SESSION = 'parent';
export const OTHER_SESSION = 'other';
export const SERVICE_NAME = 'session service';
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
const CLOSE = patchNamed(warmerPatches, 'cache-warm-close').replace;
const STOCK_VU =
  'function vu(t){let s=Wa.get(t);if(!s)return;clearTimeout(s.timer),s.abortController?.abort(),Wa.delete(t)}';
const EXPORTS = 'return{pY,vu,LV,fire:$ODWf,warm:$ODWt,snapshots:Qh}';

type HarnessBindings = [
  Map<string, Snapshot>,
  () => void,
  Map<string, WarmEntry>,
  Map<string, WarmEntry>,
  () => { modelProvider: string },
  () => void,
  () => SessionService,
  () => object,
  (callback: () => void, delay: number) => Timer,
  (timer: Timer) => void,
  (deps: CoreDeps, options: CoreOptions) => StreamingCore,
  { env: Record<string, string> },
];

export function snapshot(capturedAt: number): Snapshot {
  return {
    effort: 'low',
    sessionId: SESSION,
    modelId: MODEL,
    capturedAt,
    tools: [],
    systemMessage: [{ type: 'text', text: 'system' }],
    preparedHistory: [{ content: [{ cache_control: { type: 'ephemeral' } }] }],
  };
}

function ignore(): void {}

export class World {
  readonly harness: Harness;
  readonly timers: Timer[] = [];
  readonly cleared: Timer[] = [];
  readonly sent: SentRequest[] = [];
  readonly logged: WarmLine[] = [];
  readonly writes: SessionWrite[] = [];
  readonly env: Record<string, string> = {};
  readonly built: { deps: CoreDeps; options: CoreOptions }[] = [];
  aborted = 0;
  disposed = 0;
  children = 0;
  current = SESSION;
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
        'Zh',
        'ee',
        'n',
        'p',
        'C',
        'setTimeout',
        'clearTimeout',
        '$client',
        'process',
      ],
      `${ARM}${STOCK_VU}${CLOSE}${EXPORTS}`.replace(
        STREAMING_CORE_IMPORT,
        '{createLLMStreamingCore:$client}',
      ),
    );
    this.harness = build(
      new Map(),
      ignore,
      new Map(),
      new Map(),
      () => ({ modelProvider: 'anthropic' }),
      ignore,
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
    );
  }

  request(capturedAt: number): void {
    this.harness.pY(snapshot(capturedAt));
  }

  async fireCurrent(): Promise<void> {
    await this.harness.fire(SESSION, this.harness.warm.get(SESSION));
  }

  static close(): void {
    Reflect.deleteProperty(globalThis, '__odKids');
    Reflect.deleteProperty(globalThis, '__odUsage');
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
