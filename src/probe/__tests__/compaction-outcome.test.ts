import { describe, expect, test } from 'bun:test';

import { ADAPTIVE_TAGGED, STORED_REFUSAL } from '../../patch/__tests__/summary-fixtures.ts';
import { classifyText, readReply } from '../compaction-outcome.ts';
import {
  OWN_LAYOUT_REPLIES,
  REPLAYED_REFUSALS,
  STORED_REFUSALS,
} from './compaction-outcome-fixtures.ts';
import { REFUSAL, SUMMARY } from './compaction-replay-harness.ts';

describe('classifyText on replies the model really sent', () => {
  test('every refusal stored in a session is a refusal', () => {
    expect(STORED_REFUSALS).toHaveLength(10);
    for (const text of STORED_REFUSALS) {
      expect({ text, outcome: classifyText(text, []) }).toEqual({ text, outcome: 'refusal' });
    }
  });

  test('every replayed refusal, tool calls and the empty reply included, is a refusal', () => {
    for (const { text, tools } of REPLAYED_REFUSALS) {
      expect({ text, outcome: classifyText(text, tools) }).toEqual({ text, outcome: 'refusal' });
    }
  });

  test('a real summary in the model own layout is own-layout, not a refusal', () => {
    const untagged = OWN_LAYOUT_REPLIES.filter((text) => !text.includes('<summary>'));
    expect(untagged.length).toBeGreaterThan(15);
    for (const text of untagged) {
      expect({ text, outcome: classifyText(text, []) }).toEqual({ text, outcome: 'own-layout' });
    }
  });

  test('a real summary in the model own layout inside a summary tag is a summary', () => {
    const tagged = OWN_LAYOUT_REPLIES.filter((text) => text.includes('<summary>'));
    expect(tagged.length).toBeGreaterThan(3);
    for (const text of tagged) {
      expect({ text, outcome: classifyText(text, []) }).toEqual({ text, outcome: 'summary' });
    }
  });

  test('a summary in the stock layout is a summary', () => {
    expect(classifyText(SUMMARY, [])).toBe('summary');
  });

  test('a tagged adaptive summary is a summary, even when its opening says "cannot"', () => {
    expect(classifyText(ADAPTIVE_TAGGED, [])).toBe('summary');
    const cannot = ADAPTIVE_TAGGED.replace('I am a', 'The summary cannot skip that I am a');
    expect(classifyText(cannot, [])).toBe('summary');
  });

  test('the canned refusal is a refusal', () => {
    expect(classifyText(STORED_REFUSAL, [])).toBe('refusal');
  });
});

describe('classifyText on small cases', () => {
  test('any tool call is a refusal, even beside a summary', () => {
    expect(classifyText(SUMMARY, ['Read'])).toBe('refusal');
  });

  test('an empty reply is a refusal', () => {
    expect(classifyText('', [])).toBe('refusal');
    expect(classifyText('  \n', [])).toBe('refusal');
  });

  test('a short reply that is not a summary sets the request aside', () => {
    expect(classifyText('Done.', [])).toBe('refusal');
    expect(classifyText(REFUSAL, [])).toBe('refusal');
  });

  test('a long reply that declines in its opening is a refusal', () => {
    const text = `I won't write that summary. ${'The grunt task goes on. '.repeat(40)}`;
    expect(classifyText(text, [])).toBe('refusal');
  });

  test('a long reply that mentions "won\'t" only late is own-layout', () => {
    const text = `# Notes\n\n${'The session read many files. '.repeat(20)}The user won't need the summary.`;
    expect(classifyText(text, [])).toBe('own-layout');
  });
});

describe('readReply joins the text blocks and names the tools', () => {
  test('thinking is ignored and tool_use names are listed', () => {
    const reading = readReply([
      { type: 'thinking', thinking: 'I should refuse.' },
      { type: 'text', text: 'I will keep going.' },
      { type: 'tool_use', name: 'Read', input: {} },
    ]);
    expect(reading).toEqual({ outcome: 'refusal', text: 'I will keep going.', tools: ['Read'] });
  });

  test('a stock summary in a text block is a summary', () => {
    expect(readReply([{ type: 'text', text: SUMMARY }]).outcome).toBe('summary');
  });

  test('a reply with no blocks is a refusal', () => {
    expect(readReply([]).outcome).toBe('refusal');
  });
});
