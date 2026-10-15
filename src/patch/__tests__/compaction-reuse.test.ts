import { describe, expect, test } from 'bun:test';

import { CUSTOM_INSTRUCTIONS_LEAD } from '../compaction-patches.ts';
import {
  EXTENDED,
  FALLBACK_SUMMARY,
  INSTRUCTION,
  LAST_REPLY,
  MAX_TOKENS,
  MODEL,
  REUSED_SUMMARY,
  SEEN,
  SESSION,
  SNAPSHOT,
  buildSummarize,
  calls,
  failWith,
  freshSignal,
  installHarness,
  replyWith,
  script,
} from './compaction-reuse-harness.ts';

installHarness();

async function failureOf(run: Promise<unknown>): Promise<Error | undefined> {
  try {
    await run;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  return undefined;
}

describe('compaction-reuse-prefix', () => {
  test('sends the last request prefix with the summarizer prompt appended', async () => {
    const summarize = buildSummarize(undefined, freshSignal());
    expect(await summarize({ modelId: MODEL })).toEqual({ content: REUSED_SUMMARY });

    expect(calls.fallback).toBe(0);
    expect(calls.snapshot).toEqual([SESSION]);
    expect(calls.extend).toEqual([]);
    expect(calls.core).toEqual([{ emitLlmRetryStatus: true, tools: SNAPSHOT.tools }]);
    expect(calls.send).toEqual([
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
    expect(calls.logged.map((line) => line.compact)).toEqual(['reuse']);
  });

  test('carries the user instructions for the summary into the appended message', async () => {
    const summarize = buildSummarize('focus on the tests', freshSignal());
    await summarize({ modelId: MODEL });
    expect(calls.send[0]?.instruction).toBe(
      `${INSTRUCTION}\n\n${CUSTOM_INSTRUCTIONS_LEAD}\nfocus on the tests`,
    );
  });

  test('only the first call tries the reuse path', async () => {
    const summarize = buildSummarize(undefined, freshSignal());
    await summarize({ modelId: MODEL });
    expect(await summarize({ modelId: MODEL })).toEqual({ content: FALLBACK_SUMMARY });
    expect(calls.snapshot).toHaveLength(1);
    expect(calls.send).toHaveLength(1);
    expect(calls.fallback).toBe(1);
  });

  test('falls back when there is no snapshot', async () => {
    script.snapshot = undefined;
    const summarize = buildSummarize(undefined, freshSignal());
    expect(await summarize({ modelId: MODEL })).toEqual({ content: FALLBACK_SUMMARY });
    expect(calls.send).toHaveLength(0);
    expect(calls.logged.map((line) => line.compact)).toEqual(['no-snapshot']);
  });

  test('reuses the prefix when the messages to summarise stop before the end of the snapshot', async () => {
    const summarize = buildSummarize(undefined, freshSignal(), SEEN.slice(0, 1));
    expect(await summarize({ modelId: MODEL })).toEqual({ content: REUSED_SUMMARY });
    expect(calls.logged.map((line) => line.compact)).toEqual(['reuse']);
  });

  test('extends the prefix with the messages the snapshot missed', async () => {
    const summarize = buildSummarize(undefined, freshSignal(), [...SEEN, LAST_REPLY]);
    expect(await summarize({ modelId: MODEL })).toEqual({ content: REUSED_SUMMARY });
    expect(calls.extend).toEqual([[['last-reply'], INSTRUCTION]]);
    expect(calls.send[0]?.preparedHistory).toEqual(EXTENDED);
    expect(calls.send[0]?.instruction).toBe(INSTRUCTION);
    expect(calls.fallback).toBe(0);
    expect(calls.logged.map((line) => line.compact)).toEqual(['reuse-extended']);
  });

  test('ignores unseen messages that carry no content', async () => {
    const hookNotice = { id: 'session-start-hook', role: 'user', content: [] };
    const summarize = buildSummarize(undefined, freshSignal(), [hookNotice, ...SEEN]);
    expect(await summarize({ modelId: MODEL })).toEqual({ content: REUSED_SUMMARY });
    expect(calls.extend).toEqual([]);
    expect(calls.send[0]?.preparedHistory).toEqual(SNAPSHOT.preparedHistory);
    expect(calls.logged.map((line) => line.compact)).toEqual(['reuse']);
  });

  test.each(['prefix-mismatch', 'unseen-messages'])(
    'falls back when the extension is refused with %s',
    async (refusal) => {
      script.extend = () => refusal;
      const summarize = buildSummarize(undefined, freshSignal(), [...SEEN, LAST_REPLY]);
      expect(await summarize({ modelId: MODEL })).toEqual({ content: FALLBACK_SUMMARY });
      expect(calls.send).toHaveLength(0);
      expect(calls.fallback).toBe(1);
      expect(calls.logged.map((line) => line.compact)).toEqual([refusal]);
    },
  );

  test('falls back when building the extension throws', async () => {
    script.extend = () => {
      throw new Error('conversion failed');
    };
    const summarize = buildSummarize(undefined, freshSignal(), [...SEEN, LAST_REPLY]);
    expect(await summarize({ modelId: MODEL })).toEqual({ content: FALLBACK_SUMMARY });
    expect(calls.send).toHaveLength(0);
    expect(calls.logged.map((line) => line.compact)).toEqual(['error']);
  });

  test('falls back when the snapshot belongs to another model', async () => {
    const summarize = buildSummarize(undefined, freshSignal());
    expect(await summarize({ modelId: 'other-model' })).toEqual({ content: FALLBACK_SUMMARY });
    expect(calls.send).toHaveLength(0);
    expect(calls.logged.map((line) => line.compact)).toEqual(['other-model']);
  });

  test('falls back when the reply calls a tool', async () => {
    script.reply = replyWith('let me look', ['Read']);
    const summarize = buildSummarize(undefined, freshSignal());
    expect(await summarize({ modelId: MODEL })).toEqual({ content: FALLBACK_SUMMARY });
    expect(calls.logged.map((line) => line.compact)).toEqual(['tool-call']);
  });

  test('falls back when the reply has no text', async () => {
    script.reply = replyWith('');
    const summarize = buildSummarize(undefined, freshSignal());
    expect(await summarize({ modelId: MODEL })).toEqual({ content: FALLBACK_SUMMARY });
    expect(calls.logged.map((line) => line.compact)).toEqual(['empty']);
  });

  test('falls back when the request throws', async () => {
    script.reply = failWith('context too long');
    const summarize = buildSummarize(undefined, freshSignal());
    expect(await summarize({ modelId: MODEL })).toEqual({ content: FALLBACK_SUMMARY });
    expect(calls.logged.map((line) => line.compact)).toEqual(['error']);
    expect(calls.send).toHaveLength(1);
  });

  test('an abort during the request surfaces instead of falling back', async () => {
    const signal = freshSignal();
    script.reply = failWith('aborted', () => {
      signal.aborted = true;
    });
    const summarize = buildSummarize(undefined, signal);
    const failure = await failureOf(summarize({ modelId: MODEL }));
    expect(failure?.message).toBe('aborted');
    expect(calls.fallback).toBe(0);
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
    expect(calls.fallback).toBe(0);
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
    expect(calls.fallback).toBe(0);
    expect(calls.logged).toEqual([]);
  });
});
