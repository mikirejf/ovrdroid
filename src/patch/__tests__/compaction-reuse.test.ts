import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  CUSTOM_INSTRUCTIONS_LEAD,
  compactionPatches,
  REUSE_GLOBAL,
  SUMMARIZE_LINE,
} from '../compaction-patches.ts';
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
}

type Summarize = (attempt: Attempt) => Promise<Summary>;

const SESSION = 'parent';
const MODEL = 'custom:droidproxy:sonnet-5-5';
const SUMMARIZER_PROMPT = 'You are the summarizer.';
const INSTRUCTION = `${SUMMARIZER_PROMPT}\n\n${SUMMARIZE_LINE}`;
const FALLBACK_SUMMARY = 'fallback summary';
const REUSED_SUMMARY = '<summary>reused</summary>';
const MAX_TOKENS = 4000;

function textMessage(id: string, role = 'user'): Message {
  return { id, role, content: [{ type: 'text', text: id }] };
}

const SEEN = [textMessage('turn-1'), textMessage('turn-2', 'assistant')];
const LAST_REPLY = textMessage('last-reply', 'assistant');
const EXTENDED = [...SEEN, LAST_REPLY];
const SNAPSHOT: Snapshot = {
  citableMessageIds: new Set(SEEN.map((message) => message.id)),
  modelId: MODEL,
  isSpecMode: false,
  reasoningEffort: 'low',
  systemMessage: ['main system'],
  preparedHistory: SEEN,
  tools: { tools: ['Read'] },
};

const PREFIX = patchNamed(compactionPatches, 'compaction-reuse-prefix').replace;

interface Script {
  reply: () => Promise<Reply>;
  snapshot: Snapshot | undefined;
  extend: () => Message[] | string;
}

function replyWith(content: string, toolUses?: string[]): () => Promise<Reply> {
  return async () => await Promise.resolve({ content, toolUses });
}

function failWith(message: string, beforeThrow?: () => void): () => Promise<Reply> {
  return async () => {
    beforeThrow?.();
    return await Promise.reject(new Error(message));
  };
}

async function failureOf(run: Promise<Summary>): Promise<Error | undefined> {
  try {
    await run;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  return undefined;
}

const script: Script = {
  reply: replyWith(REUSED_SUMMARY),
  snapshot: SNAPSHOT,
  extend: () => EXTENDED,
};

let snapshotCalls: string[] = [];
let extendCalls: [string[], string][] = [];
let sendCalls: SendArguments[] = [];
let coreOptions: CoreOptions[] = [];
let fallbackCalls = 0;
let logged: UsageLine[] = [];

function installGlobals(): void {
  Object.assign(globalThis, {
    __odUsage: (line: UsageLine): void => {
      logged.push(line);
    },
    [REUSE_GLOBAL]: {
      snapshot: (sessionId: string): Snapshot | undefined => {
        snapshotCalls.push(sessionId);
        return script.snapshot;
      },
      extend: (
        _snapshot: Snapshot,
        unseen: readonly Message[],
        text: string,
      ): Message[] | string => {
        extendCalls.push([unseen.map((message) => message.id), text]);
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
  coreOptions.push(options);
  return {
    sendMessage: async (request) => {
      sendCalls.push(request);
      return await script.reply();
    },
    abortStreaming: () => {},
  };
}

async function fakeAs(): Promise<Summary> {
  fallbackCalls += 1;
  return await Promise.resolve({ content: FALLBACK_SUMMARY });
}

function freshSignal(): Signal {
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

function buildSummarize(
  customInstructions: string | undefined,
  signal: Signal,
  messages: readonly Message[] = SEEN,
): Summarize {
  return payloadFunction<unknown[], Summarize>(
    ['Zi', 'as', 'J', 'y', 'ie', 'u', 'r', 'b', '_', 'O', 'i'],
    `let Me=!1,${PREFIX};return Ie`,
  )(
    fakeZi,
    fakeAs,
    {},
    SUMMARIZER_PROMPT,
    () => ({ userContent: 'flattened' }),
    MAX_TOKENS,
    SESSION,
    signal,
    { isSpecMode: () => false },
    customInstructions,
    messages,
  );
}

beforeEach(() => {
  snapshotCalls = [];
  extendCalls = [];
  sendCalls = [];
  coreOptions = [];
  fallbackCalls = 0;
  logged = [];
  script.snapshot = SNAPSHOT;
  script.reply = replyWith(REUSED_SUMMARY);
  script.extend = () => EXTENDED;
  installGlobals();
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, '__odUsage');
  Reflect.deleteProperty(globalThis, REUSE_GLOBAL);
});

describe('compaction-reuse-prefix', () => {
  test('sends the last request prefix with the summarizer prompt appended', async () => {
    const summarize = buildSummarize(undefined, freshSignal());
    expect(await summarize({ modelId: MODEL })).toEqual({ content: REUSED_SUMMARY });

    expect(fallbackCalls).toBe(0);
    expect(snapshotCalls).toEqual([SESSION]);
    expect(extendCalls).toEqual([]);
    expect(coreOptions).toEqual([{ emitLlmRetryStatus: true, tools: SNAPSHOT.tools }]);
    expect(sendCalls).toEqual([
      {
        modelId: MODEL,
        isSpecMode: false,
        reasoningEffort: 'low',
        systemMessage: SNAPSHOT.systemMessage,
        preparedHistory: SNAPSHOT.preparedHistory,
        instruction: INSTRUCTION,
        maxTokensOverride: MAX_TOKENS,
        sessionId: SESSION,
      },
    ]);
    expect(logged.map((line) => line.compact)).toEqual(['reuse']);
  });

  test('carries the user instructions for the summary into the appended message', async () => {
    const summarize = buildSummarize('focus on the tests', freshSignal());
    await summarize({ modelId: MODEL });
    expect(sendCalls[0]?.instruction).toBe(
      `${INSTRUCTION}\n\n${CUSTOM_INSTRUCTIONS_LEAD}\nfocus on the tests`,
    );
  });

  test('only the first call tries the reuse path', async () => {
    const summarize = buildSummarize(undefined, freshSignal());
    await summarize({ modelId: MODEL });
    expect(await summarize({ modelId: MODEL })).toEqual({ content: FALLBACK_SUMMARY });
    expect(snapshotCalls).toHaveLength(1);
    expect(sendCalls).toHaveLength(1);
    expect(fallbackCalls).toBe(1);
  });

  test('falls back when there is no snapshot', async () => {
    script.snapshot = undefined;
    const summarize = buildSummarize(undefined, freshSignal());
    expect(await summarize({ modelId: MODEL })).toEqual({ content: FALLBACK_SUMMARY });
    expect(sendCalls).toHaveLength(0);
    expect(logged.map((line) => line.compact)).toEqual(['no-snapshot']);
  });

  test('reuses the prefix when the messages to summarise stop before the end of the snapshot', async () => {
    const summarize = buildSummarize(undefined, freshSignal(), SEEN.slice(0, 1));
    expect(await summarize({ modelId: MODEL })).toEqual({ content: REUSED_SUMMARY });
    expect(logged.map((line) => line.compact)).toEqual(['reuse']);
  });

  test('extends the prefix with the messages the snapshot missed', async () => {
    const summarize = buildSummarize(undefined, freshSignal(), [...SEEN, LAST_REPLY]);
    expect(await summarize({ modelId: MODEL })).toEqual({ content: REUSED_SUMMARY });
    expect(extendCalls).toEqual([[['last-reply'], INSTRUCTION]]);
    expect(sendCalls[0]?.preparedHistory).toEqual(EXTENDED);
    expect(sendCalls[0]?.instruction).toBe(INSTRUCTION);
    expect(fallbackCalls).toBe(0);
    expect(logged.map((line) => line.compact)).toEqual(['reuse-extended']);
  });

  test('ignores unseen messages that carry no content', async () => {
    const hookNotice = { id: 'session-start-hook', role: 'user', content: [] };
    const summarize = buildSummarize(undefined, freshSignal(), [hookNotice, ...SEEN]);
    expect(await summarize({ modelId: MODEL })).toEqual({ content: REUSED_SUMMARY });
    expect(extendCalls).toEqual([]);
    expect(sendCalls[0]?.preparedHistory).toEqual(SNAPSHOT.preparedHistory);
    expect(logged.map((line) => line.compact)).toEqual(['reuse']);
  });

  test.each(['prefix-mismatch', 'unseen-messages'])(
    'falls back when the extension is refused with %s',
    async (refusal) => {
      script.extend = () => refusal;
      const summarize = buildSummarize(undefined, freshSignal(), [...SEEN, LAST_REPLY]);
      expect(await summarize({ modelId: MODEL })).toEqual({ content: FALLBACK_SUMMARY });
      expect(sendCalls).toHaveLength(0);
      expect(fallbackCalls).toBe(1);
      expect(logged.map((line) => line.compact)).toEqual([refusal]);
    },
  );

  test('falls back when building the extension throws', async () => {
    script.extend = () => {
      throw new Error('conversion failed');
    };
    const summarize = buildSummarize(undefined, freshSignal(), [...SEEN, LAST_REPLY]);
    expect(await summarize({ modelId: MODEL })).toEqual({ content: FALLBACK_SUMMARY });
    expect(sendCalls).toHaveLength(0);
    expect(logged.map((line) => line.compact)).toEqual(['error']);
  });

  test('falls back when the snapshot belongs to another model', async () => {
    const summarize = buildSummarize(undefined, freshSignal());
    expect(await summarize({ modelId: 'other-model' })).toEqual({ content: FALLBACK_SUMMARY });
    expect(sendCalls).toHaveLength(0);
    expect(logged.map((line) => line.compact)).toEqual(['other-model']);
  });

  test('falls back when the reply calls a tool', async () => {
    script.reply = replyWith('let me look', ['Read']);
    const summarize = buildSummarize(undefined, freshSignal());
    expect(await summarize({ modelId: MODEL })).toEqual({ content: FALLBACK_SUMMARY });
    expect(logged.map((line) => line.compact)).toEqual(['tool-call']);
  });

  test('falls back when the reply has no text', async () => {
    script.reply = replyWith('');
    const summarize = buildSummarize(undefined, freshSignal());
    expect(await summarize({ modelId: MODEL })).toEqual({ content: FALLBACK_SUMMARY });
    expect(logged.map((line) => line.compact)).toEqual(['empty']);
  });

  test('falls back when the request throws', async () => {
    script.reply = failWith('context too long');
    const summarize = buildSummarize(undefined, freshSignal());
    expect(await summarize({ modelId: MODEL })).toEqual({ content: FALLBACK_SUMMARY });
    expect(logged.map((line) => line.compact)).toEqual(['error']);
    expect(sendCalls).toHaveLength(1);
  });

  test('an abort during the request surfaces instead of falling back', async () => {
    const signal = freshSignal();
    script.reply = failWith('aborted', () => {
      signal.aborted = true;
    });
    const summarize = buildSummarize(undefined, signal);
    const failure = await failureOf(summarize({ modelId: MODEL }));
    expect(failure?.message).toBe('aborted');
    expect(fallbackCalls).toBe(0);
  });

  test('an abort that ends the request quietly still stops the compaction', async () => {
    const signal = freshSignal();
    script.reply = async () => {
      signal.aborted = true;
      return await Promise.resolve({ content: '' });
    };
    const summarize = buildSummarize(undefined, signal);
    const failure = await failureOf(summarize({ modelId: MODEL }));
    expect(failure?.message).toBe('Compaction aborted');
    expect(fallbackCalls).toBe(0);
  });

  test('an aborted stream that returns partial text is not accepted as a summary', async () => {
    const signal = freshSignal();
    script.reply = async () => {
      signal.aborted = true;
      return await Promise.resolve({ content: '<summary>unfinished partial summary' });
    };
    const summarize = buildSummarize(undefined, signal);
    const failure = await failureOf(summarize({ modelId: MODEL }));
    expect(failure?.name).toBe('AbortError');
    expect(failure?.message).toBe('Compaction aborted');
    expect(fallbackCalls).toBe(0);
    expect(logged).toEqual([]);
  });
});
