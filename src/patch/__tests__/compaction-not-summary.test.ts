import { describe, expect, test } from 'bun:test';

import { CANNED_REFUSAL } from '../../probe/compaction-fallback-report.ts';
import { isSummaryReply } from '../summary-format.ts';
import {
  FALLBACK_SUMMARY,
  MODEL,
  REUSED_SUMMARY,
  buildSummarize,
  calls,
  freshSignal,
  installHarness,
  replyWith,
  script,
} from './compaction-reuse-harness.ts';

installHarness();

const SUMMARY_FIXTURES: readonly (readonly [string, string])[] = [
  ['the stock format', REUSED_SUMMARY],
  [
    'bold numbered headings',
    '**1. Primary Request and Intent**\ntext\n**2. Approach**\ntext\n**3. Next Steps**\nx',
  ],
  [
    'markdown headings in capitals',
    '## PENDING TASKS\nx\n## CURRENT WORK\ny\n### Error Resolution\nz',
  ],
  ['two sections only', '1. Approach\nx\n2. Current Work\ny'],
  ['the same section three times', 'Approach\nApproach\nApproach'],
  ['a refusal', "I'm not going to write out that summary. I'll keep working the grunt task."],
  [
    'a final task report',
    '## Done\nChanged the file.\n## Validation\nTests pass.\n## Blockers\nNone.',
  ],
  ['indented headings in a quote', '> Approach: a\n> Current work: b\n> Next steps: c'],
  [
    'a summary in its own sections, as the adaptive prompt asks',
    '<summary>\n## Role and task\nI am the grunt subagent.\n\n## Parent assignment\nRead the files.\n</summary>',
  ],
  ['the canned refusal of the fallback probe', CANNED_REFUSAL],
];

describe('compaction-reuse-prefix reply check', () => {
  test('falls back when the reply is not a summary', async () => {
    script.reply = replyWith("I'm not going to write out that summary. I'll keep working.");
    const summarize = buildSummarize(undefined, freshSignal());
    expect(await summarize({ modelId: MODEL })).toEqual({ content: FALLBACK_SUMMARY });
    expect(calls.send).toHaveLength(1);
    expect(calls.fallback).toBe(1);
    expect(calls.logged.map((line) => line.compact)).toEqual(['not-summary']);
  });

  test.each(SUMMARY_FIXTURES)('the payload and isSummary agree on %s', async (_name, text) => {
    script.reply = replyWith(text);
    const summarize = buildSummarize(undefined, freshSignal());
    const summary = await summarize({ modelId: MODEL });
    const reused = isSummaryReply(text);
    expect(summary.content).toBe(reused ? text : FALLBACK_SUMMARY);
    expect(calls.logged.map((line) => line.compact)).toEqual([reused ? 'reuse' : 'not-summary']);
  });
});
