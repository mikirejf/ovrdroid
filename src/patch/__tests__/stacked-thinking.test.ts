import { describe, expect, test } from 'bun:test';

import {
  DRAWS_NOTHING,
  RUN_CALLS,
  RUN_UNIT,
  STACK,
  stackedViewPatches,
  SUMMARIZE,
  TABLES,
  THINKING_ROW,
} from '../stacked-view-patches.ts';
import { patchNamed, payloadFunction } from './payload.ts';

interface Message {
  id: string;
  messageType?: string;
  thinkingBlock?: { thinking: string };
  drawsNothing?: boolean;
  $ODsummary?: boolean;
}

interface Unit {
  kind: 'item';
  item: Message;
  sourceIds: string[];
}

interface Block {
  type?: string;
  thinking?: string;
}

interface Element {
  type: string;
  props: { children?: Element | string; width?: number; marginLeft?: number };
}

const OPTIONS = { open: false, showThinking: true, inline: () => false };

const stack = payloadFunction<
  [(item: Message) => boolean, (item: Message) => object | null],
  (units: Unit[], options: typeof OPTIONS) => Unit[]
>(['va', 'iD'], `${TABLES}${RUN_CALLS}${DRAWS_NOTHING}${RUN_UNIT}${STACK}return $ODstack`)(
  () => false,
  (item) => (item.drawsNothing === true ? null : {}),
);

const summarize = payloadFunction<[], (text: string) => string>(
  [],
  `${SUMMARIZE}return $ODsummarize`,
)();

const row = payloadFunction<
  [() => { t: (key: string) => string }, (type: string, props: Element['props']) => Element],
  (props: { block: Block; contentWidth: number }) => Element | null
>(
  ['u', 't'],
  `var c="Box",o="Text",a={text:{muted:"muted"}};${SUMMARIZE}${THINKING_ROW}return $ODThinkingRow`,
)(
  () => ({
    t: (key) => (key === 'common:thinking.thinkingLabel' ? 'Thinking:' : '[Content encrypted]'),
  }),
  (type, props) => ({ type, props }),
);

function thinking(id: string, text: string): Unit {
  return {
    kind: 'item',
    item: { id, messageType: 'thinking', thinkingBlock: { thinking: text } },
    sourceIds: [id],
  };
}

function textUnit(id: string): Unit {
  return { kind: 'item', item: { id }, sourceIds: [id] };
}

function summaryOf(unit: Unit | undefined): boolean | undefined {
  return unit?.item.$ODsummary;
}

describe('thinking summaries', () => {
  test('use the first sentence of plain thinking', () => {
    expect(summarize('I will read the files first. Then I will edit one.')).toBe(
      'I will read the files first.',
    );
    expect(summarize('Should I grep? Probably.')).toBe('Should I grep?');
    expect(summarize('Wow! Done.')).toBe('Wow!');
  });

  test('stop at a newline and collapse whitespace', () => {
    expect(summarize('  first   line\nsecond line. Third.')).toBe('first line');
    expect(summarize('a  \t b')).toBe('a b');
  });

  test('keep a decimal whole', () => {
    expect(summarize('Version 1.5 is out')).toBe('Version 1.5 is out');
  });

  test('use the last heading of a reasoning summary', () => {
    const text = '**Planning the run**\n\nI will read.\n\n**Reading the files**\n\nOpening a.txt.';
    expect(summarize(text)).toBe('Reading the files');
    expect(summarize('**Planning the run**\n\nI will read the files first.')).toBe(
      'Planning the run',
    );
  });

  test('stay on the latest heading once it closes while the text streams', () => {
    const text = '**First part**\n\nBody one.\n\n**Second part**\n\nBody two.';
    const seen = Array.from({ length: text.length }, (_, end) => summarize(text.slice(0, end + 1)));
    const second = seen.indexOf('Second part');
    expect(second).toBeGreaterThan(-1);
    expect(new Set(seen.slice(second))).toEqual(new Set(['Second part']));
    expect(seen.slice(0, second).every((summary) => summary !== 'Second part')).toBe(true);
  });

  test('ignore bold inside a sentence and read CRLF headings', () => {
    expect(summarize('Use **bold** here. More.')).toBe('Use bold here.');
    expect(summarize('**Title**\r\n\r\nBody.')).toBe('Title');
  });
});

describe('marking thinking units', () => {
  test('a thinking item is marked for the summary row and closes a run', () => {
    const out = stack([thinking('t1', 'Hmm.'), textUnit('text')], OPTIONS);
    expect(out.map((unit) => summaryOf(unit))).toEqual([true, undefined]);
    expect(out[0]?.sourceIds).toEqual(['t1']);
  });

  test('ordinary text is left unmarked', () => {
    expect(summaryOf(stack([textUnit('text')], OPTIONS)[0])).toBeUndefined();
  });

  test('hidden thinking, which draws nothing, is left unmarked', () => {
    const hidden = thinking('t1', 'Hmm.');
    hidden.item.drawsNothing = true;
    expect(summaryOf(stack([hidden], OPTIONS)[0])).toBeUndefined();
  });
});

function textOf(element: Element | null): Element | undefined {
  const child = element?.props.children;
  return typeof child === 'object' ? child : undefined;
}

describe('the thinking row', () => {
  test('is one muted italic Text that truncates, with the label and the summary', () => {
    const element = row({
      block: { thinking: '**Planning the run**\n\nI will read the files first.' },
      contentWidth: 80,
    });
    expect(element?.props).toMatchObject({ marginLeft: 3, width: 77 });
    expect(textOf(element)).toMatchObject({
      type: 'Text',
      props: {
        color: 'muted',
        italic: true,
        wrap: 'truncate-end',
        children: 'Thinking: Planning the run',
      },
    });
  });

  test('shows the encrypted text for a redacted block', () => {
    const element = row({ block: { type: 'redacted_thinking' }, contentWidth: 80 });
    expect(textOf(element)?.props.children).toBe('Thinking: [Content encrypted]');
  });

  test('draws nothing for a block with no text', () => {
    expect(row({ block: { thinking: '  \n ' }, contentWidth: 80 })).toBeNull();
    expect(row({ block: {}, contentWidth: 80 })).toBeNull();
  });

  test('never gives the row less than one column', () => {
    expect(row({ block: { thinking: 'x' }, contentWidth: 1 })?.props.width).toBe(1);
  });
});

describe('wiring', () => {
  test('streaming cuts skip thinking messages so the head row sees the whole text', () => {
    const { replace } = patchNamed(stackedViewPatches, 'stacked-view-units');
    expect(replace).toContain('&&!($ODstacked&&tt.messageType==="thinking")');
    expect(replace).toContain('},[ie,M,$ODstacked]),');
  });

  test('the thinking branch draws the summary row only for a marked item', () => {
    const { replace } = patchNamed(stackedViewPatches, 'stacked-view-thinking-row');
    interface Shown {
      messageType: string;
      thinkingBlock?: Block;
      $ODsummary?: boolean;
    }
    const branch = payloadFunction<
      [Shown, boolean, number, (type: string) => string, string, string],
      string | null
    >(
      ['g', 'S', 'y', 't', 'oV', '$ODThinkingRow'],
      `${replace}hideLabel:g.streamingSegment==="continuation"})}return"other"`,
    );
    const render = (message: Shown, shown = true) =>
      branch(message, shown, 80, (type) => type, 'full', 'row');
    const base = { messageType: 'thinking', thinkingBlock: { thinking: 'x' } };
    expect(render({ ...base, $ODsummary: true })).toBe('row');
    expect(render(base)).toBe('full');
    expect(render({ ...base, $ODsummary: true }, false)).toBeNull();
    expect(render({ messageType: 'text' })).toBe('other');
  });
});
