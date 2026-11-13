import { describe, expect, test } from 'bun:test';

import {
  focusedVerdict,
  readColors,
  restoredColorVerdict,
  unfocusedVerdict,
} from '../rewind-scroll-color.ts';
import { promptFor, REWIND_MENU_TITLE } from '../rewind-scroll-report.ts';
import { TerminalScreen } from '../terminal-screen.ts';

const ESC = '\u001B';
const PRIMARY = '38;2;215;95;0';
const PRIMARY_BAR = '48;2;215;95;0';
const NORMAL = '38;2;216;212;210';
const RUN = 'r1';

function sgr(code: string, text: string): string {
  return `${ESC}[${code}m${text}${ESC}[0m`;
}

function message(topic: string, focused: boolean, bar = PRIMARY_BAR): string {
  const text = promptFor(topic, RUN);
  return `${sgr(bar, ' ')}  ${sgr(focused ? PRIMARY : NORMAL, text)} `;
}

function menu(selected: string): string[] {
  return [
    '╭────╮',
    `│ ${REWIND_MENU_TITLE}`,
    `│ ${sgr(PRIMARY, `> 8 ${promptFor(selected, RUN)}`)}`,
    `│   6 ${promptFor('ALPHA', RUN)}`,
    '╰────╯',
  ];
}

function colors(rows: readonly string[]) {
  const screen = new TerminalScreen(100, 40);
  screen.feed(rows.join('\r\n'));
  return readColors(screen.styledLines());
}

describe('readColors', () => {
  test('takes the focus colour from the marker of the selected menu row', () => {
    const reading = colors([message('BRAVO', true), '', ...menu('BRAVO')]);
    expect(reading.focus).toBe(PRIMARY);
    expect(reading.prompts).toEqual([{ topic: 'BRAVO', fg: PRIMARY, bar: PRIMARY_BAR }]);
  });

  test('ignores the menu rows when listing the chat messages', () => {
    const reading = colors([message('BRAVO', false), '', ...menu('BRAVO')]);
    expect(reading.prompts.map((prompt) => prompt.topic)).toEqual(['BRAVO']);
  });

  test('has no focus colour when no menu is open', () => {
    expect(colors([message('BRAVO', false)]).focus).toBeUndefined();
  });

  test('reads a prompt drawn in two colours as mixed', () => {
    const half = `  ${sgr(PRIMARY, 'scroll probe')} ${sgr(NORMAL, 'message BRAVO r1')} `;
    expect(colors([half]).prompts[0]?.fg).toBe('mixed');
  });
});

describe('unfocusedVerdict', () => {
  test('passes when every message keeps its normal colour', () => {
    const rows = [message('ALPHA', false), message('BRAVO', false), '', ...menu('BRAVO')];
    expect(unfocusedVerdict(colors(rows)).pass).toBe(true);
  });

  test('fails when opening the menu already coloured a message', () => {
    const rows = [message('ALPHA', false), message('BRAVO', true), '', ...menu('BRAVO')];
    const verdict = unfocusedVerdict(colors(rows));
    expect(verdict.pass).toBe(false);
    expect(verdict.text).toContain('already drew BRAVO in #d75f00');
  });

  test('fails when the menu has no selected row to compare with', () => {
    const verdict = unfocusedVerdict(colors([message('ALPHA', false)]));
    expect(verdict.pass).toBe(false);
    expect(verdict.text).toContain('no selected row');
  });
});

describe('focusedVerdict', () => {
  const rows = (topic: string, focused: boolean, bar?: string) => [
    message(topic, focused, bar),
    '',
    ...menu(topic),
  ];

  test('passes when the message text and bar are in the selected colour', () => {
    const verdict = focusedVerdict('Down', 'BRAVO', colors(rows('BRAVO', true)));
    expect(verdict.pass).toBe(true);
    expect(verdict.text).toContain('BRAVO is drawn in the menu');
  });

  test('fails when the message keeps its normal text colour', () => {
    const verdict = focusedVerdict('Down', 'BRAVO', colors(rows('BRAVO', false)));
    expect(verdict.pass).toBe(false);
    expect(verdict.text).toContain('the BRAVO text is #d8d4d2, not #d75f00');
  });

  test('fails when only the text changed and the bar did not', () => {
    const verdict = focusedVerdict('Down', 'BRAVO', colors(rows('BRAVO', true, '48;2;1;2;3')));
    expect(verdict.pass).toBe(false);
    expect(verdict.text).toContain('the BRAVO bar is #010203, not #d75f00');
  });

  test('fails when another visible message is also in the selected colour', () => {
    const chat = [message('BRAVO', true), message('CHARLIE', true), '', ...menu('BRAVO')];
    const verdict = focusedVerdict('Down', 'BRAVO', colors(chat));
    expect(verdict.pass).toBe(false);
    expect(verdict.text).toContain('CHARLIE also drawn in #d75f00');
  });

  test('passes with other messages in view that stay normal', () => {
    const chat = [message('BRAVO', true), message('CHARLIE', false), '', ...menu('BRAVO')];
    const verdict = focusedVerdict('Down', 'BRAVO', colors(chat));
    expect(verdict.pass).toBe(true);
    expect(verdict.text).toContain('CHARLIE stay normal');
  });

  test('fails when the chosen message is not on screen', () => {
    const verdict = focusedVerdict(
      'Down',
      'BRAVO',
      colors([message('ALPHA', true), ...menu('BRAVO')]),
    );
    expect(verdict.pass).toBe(false);
    expect(verdict.text).toContain('the BRAVO message is not on screen');
  });
});

describe('restoredColorVerdict', () => {
  test('passes when the live chat shows every message in its normal colour', () => {
    const live = colors([message('ALPHA', false), message('DELTA', false)]);
    expect(restoredColorVerdict(live, PRIMARY).pass).toBe(true);
  });

  test('fails when a message keeps the focus colour after leaving the menu', () => {
    const live = colors([message('ALPHA', false), message('DELTA', true)]);
    const verdict = restoredColorVerdict(live, PRIMARY);
    expect(verdict.pass).toBe(false);
    expect(verdict.text).toContain('DELTA still drawn in #d75f00');
  });

  test('fails when no message is on screen to read', () => {
    expect(restoredColorVerdict(colors(['nothing']), PRIMARY).pass).toBe(false);
  });
});
