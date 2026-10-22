import { afterEach, beforeEach } from 'bun:test';

import { compactionPatches, NO_MENTION_LINE, REUSE_GLOBAL } from '../compaction-patches.ts';
import { patchNamed, payloadFunction } from './payload.ts';

interface Message {
  id: string;
  role: string;
  content: { type: string; text: string }[];
}

interface Snapshot {
  citableMessageIds: Set<string>;
  modelId: string;
  isSpecMode: boolean;
  reasoningEffort: string;
  systemMessage: string[];
  preparedHistory: Message[];
  tools: { tools: string[] };
}

interface Reply {
  content: string;
  toolUses?: string[] | undefined;
}

interface Summary {
  content: string;
}

interface Attempt {
  modelId: string;
}

interface SendArguments {
  modelId: string;
  isSpecMode: boolean;
  reasoningEffort: string;
  systemMessage: string[];
  preparedHistory: Message[];
  instruction: string;
  maxTokensOverride: number;
  sessionId: string;
}

interface Core {
  sendMessage: (request: SendArguments) => Promise<Reply>;
  abortStreaming: () => void;
}

interface CoreOptions {
  emitLlmRetryStatus: boolean;
  tools: { tools: string[] };
}

interface Signal {
  aborted: boolean;
  addEventListener: (type: string, listener: () => void, options: { once: boolean }) => void;
  removeEventListener: (type: string, listener: () => void) => void;
}

interface UsageLine {
  s: string;
  m: string;
  compact: string;
  head?: string;
}

type Summarize = (attempt: Attempt) => Promise<Summary>;

export const SESSION = 'parent';
export const MODEL = 'custom:droidproxy:sonnet-5-5';
export const SUMMARIZER_PROMPT = 'You are the summarizer.';
export const INSTRUCTION = `${SUMMARIZER_PROMPT}\n\n${NO_MENTION_LINE}`;
export const FALLBACK_SUMMARY = 'fallback summary';
export const REUSED_SUMMARY = [
  '<summary>',
  '1. Primary Request and Intent',
  'Fix the bug.',
  '2. Files and Code Sections',
  'a.ts',
  '3. Current Work',
  'Testing.',
  '</summary>',
].join('\n');
export const MAX_TOKENS = 4000;

function textMessage(id: string, role = 'user'): Message {
  return { id, role, content: [{ type: 'text', text: id }] };
}

export const SEEN = [textMessage('turn-1'), textMessage('turn-2', 'assistant')];
export const LAST_REPLY = textMessage('last-reply', 'assistant');
export const EXTENDED = [...SEEN, LAST_REPLY];
export const SNAPSHOT: Snapshot = {
  citableMessageIds: new Set(SEEN.map((message) => message.id)),
  modelId: MODEL,
  isSpecMode: false,
  reasoningEffort: 'low',
  systemMessage: ['main system'],
  preparedHistory: SEEN,
  tools: { tools: ['Read'] },
};

const PREFIX = patchNamed(compactionPatches, 'compaction-reuse-prefix').replace;

const STOCK_SEND_TAIL =
  'isSpecMode:he.isSpecMode(),...W.reasoningEffort?{reasoningEffort:W.reasoningEffort}:{}})}';

interface Script {
  prefix: string;
  reply: () => Promise<Reply>;
  snapshot: Snapshot | undefined;
  extend: () => Message[] | string;
}

export function replyWith(content: string, toolUses?: string[]): () => Promise<Reply> {
  return async () => await Promise.resolve({ content, toolUses });
}

export function failWith(message: string, beforeThrow?: () => void): () => Promise<Reply> {
  return async () => {
    beforeThrow?.();
    return await Promise.reject(new Error(message));
  };
}

export const script: Script = {
  prefix: PREFIX,
  reply: replyWith(REUSED_SUMMARY),
  snapshot: SNAPSHOT,
  extend: () => EXTENDED,
};

interface Calls {
  snapshot: string[];
  extend: [string[], string][];
  send: SendArguments[];
  core: CoreOptions[];
  fallback: number;
  logged: UsageLine[];
  modelRequests: string[];
}

function noCalls(): Calls {
  return {
    snapshot: [],
    extend: [],
    send: [],
    core: [],
    fallback: 0,
    logged: [],
    modelRequests: [],
  };
}

export const calls = noCalls();

function installGlobals(): void {
  Object.assign(globalThis, {
    __odUsage: (line: UsageLine): void => {
      calls.logged.push(line);
    },
    [REUSE_GLOBAL]: {
      snapshot: (sessionId: string): Snapshot | undefined => {
        calls.snapshot.push(sessionId);
        return script.snapshot;
      },
      extend: (
        _snapshot: Snapshot,
        unseen: readonly Message[],
        text: string,
      ): Message[] | string => {
        calls.extend.push([unseen.map((message) => message.id), text]);
        return script.extend();
      },
      send: async (core: Core, request: SendArguments): Promise<Summary> => {
        const sent = await core.sendMessage(request);
        return { content: sent.content };
      },
    },
  });
}

function fakeZi(options: CoreOptions): Core {
  calls.core.push(options);
  return {
    sendMessage: async (request) => {
      calls.send.push(request);
      return await script.reply();
    },
    abortStreaming: () => {},
  };
}

async function fakeAs(): Promise<Summary> {
  calls.fallback += 1;
  return await Promise.resolve({ content: FALLBACK_SUMMARY });
}

export function freshSignal(): Signal {
  const listeners = new Set<() => void>();
  return {
    aborted: false,
    addEventListener: (_type, listener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener);
    },
  };
}

export function buildSummarize(
  customInstructions: string | undefined,
  signal: Signal,
  messages: readonly Message[] = SEEN,
): Summarize {
  return payloadFunction<unknown[], Summarize>(
    ['ta', 'hl', 'g', 'X', 'B', 'z', 'fe', 'r', 'S', 'he', 'k', 's', 'y'],
    `let Me=!1,${script.prefix}${STOCK_SEND_TAIL};return me`,
  )(
    fakeZi,
    fakeAs,
    {},
    {},
    SUMMARIZER_PROMPT,
    () => ({ userContent: 'flattened' }),
    MAX_TOKENS,
    SESSION,
    signal,
    { isSpecMode: () => false },
    customInstructions,
    messages,
    (modelId: string) => {
      calls.modelRequests.push(modelId);
    },
  );
}

export function installHarness(): void {
  beforeEach(() => {
    Object.assign(calls, noCalls());
    script.prefix = PREFIX;
    script.snapshot = SNAPSHOT;
    script.reply = replyWith(REUSED_SUMMARY);
    script.extend = () => EXTENDED;
    installGlobals();
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, '__odUsage');
    Reflect.deleteProperty(globalThis, REUSE_GLOBAL);
  });
}
