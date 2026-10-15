import { describe, expect, test } from 'bun:test';

import { NO_MENTION_LINE, NOT_SUMMARY_HEAD_CHARS, SUMMARIZE_LINE } from '../compaction-patches.ts';
import {
  SNAPSHOT,
  SUMMARIZER_PROMPT,
  buildSummarize,
  calls,
  freshSignal,
  installHarness,
  replyWith,
  script,
} from './compaction-reuse-harness.ts';

installHarness();

async function askSentFor(modelId: string): Promise<string | undefined> {
  script.snapshot = { ...SNAPSHOT, modelId };
  await buildSummarize(undefined, freshSignal())({ modelId });
  return calls.send.at(0)?.instruction;
}

describe('compaction-reuse-prefix ask wording', () => {
  test.each([
    'claude-haiku-5-5',
    'claude-opus-5-5',
    'custom:droidproxy:haiku-5-5',
    'custom:droidproxy:sonnet-5-5',
    'custom:Opus-5-5',
  ])('a Claude model, %s, is not told to keep the request unmentioned', async (modelId) => {
    expect(await askSentFor(modelId)).toBe(`${SUMMARIZER_PROMPT}\n\n${NO_MENTION_LINE}`);
  });

  test.each([
    'gpt-6.1-sol',
    'custom:droidproxy:gpt-6-astra',
    'custom:opencode-zen:deepseek-v4-pro',
  ])('another model, %s, keeps the ask that says not to mention it', async (modelId) => {
    expect(await askSentFor(modelId)).toBe(`${SUMMARIZER_PROMPT}\n\n${SUMMARIZE_LINE}`);
  });
});

describe('compaction-reuse-prefix not-summary log', () => {
  test('logs how the reply began when it is not a summary', async () => {
    const reply = `I'll keep working on the task. ${'x'.repeat(NOT_SUMMARY_HEAD_CHARS)}`;
    script.reply = replyWith(reply);
    await buildSummarize(undefined, freshSignal())({ modelId: SNAPSHOT.modelId });
    expect(calls.logged.map(({ compact, head }) => ({ compact, head }))).toEqual([
      { compact: 'not-summary', head: reply.slice(0, NOT_SUMMARY_HEAD_CHARS) },
    ]);
  });

  test('logs no reply text when the reuse succeeds', async () => {
    await buildSummarize(undefined, freshSignal())({ modelId: SNAPSHOT.modelId });
    expect(calls.logged).toHaveLength(1);
    expect(calls.logged[0]).not.toHaveProperty('head');
  });
});
