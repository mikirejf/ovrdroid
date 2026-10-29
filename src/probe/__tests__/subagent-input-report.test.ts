import { describe, expect, test } from 'bun:test';

import { anyFailed, describeVerdicts } from '../busy-signal-report.ts';
import { subagentInputVerdicts } from '../subagent-input-report.ts';
import type { SubagentInputEvidence } from '../subagent-input-report.ts';

const WIDTH = 118;
const MAGENTA = '\u001B[35m';

const labelTop = `┏━━ SUBAGENT ${'━'.repeat(WIDTH - 15)}┓`;
const boldBody = `${'┃ > Enter to steer · Ctrl+Enter to queue'.padEnd(WIDTH - 1)}┃`;
const boldBottom = `┗${'━'.repeat(WIDTH - 2)}┛`;
const roundTop = `╭${'─'.repeat(WIDTH - 2)}╮`;
const roundBody = `${'│ >'.padEnd(WIDTH - 1)}│`;
const roundBottom = `╰${'─'.repeat(WIDTH - 2)}╯`;

function chat(box: string[], above: string[]): string[] {
  return [
    ...above,
    ' Auto (High) · allow all commands                                  Stub Stream',
    ...box,
    ' 1 droid working   ↓ to view',
    '[⏱ 20s, cache 43m] ? for help | ← for droids                       +2 -0 | IDE ◌',
    'Stub Stream | ovrdroid | main',
  ];
}

const SUBAGENT_BOX = [labelTop, boldBody, boldBottom];
const MAIN_BOX = [roundTop, roundBody, roundBottom];
const SUBAGENT_ABOVE = [' ⡄ Thinking...  (Esc twice to stop)'];
const MAIN_ABOVE = ['   LAUNCH kept', '', '⛬  ok'];
const MAGENTA_BYTES = `\u001B[38;2;238;238;238mStub Stream\u001B[39m\r\n${MAGENTA}${labelTop}\r\n`;

const PASSING: SubagentInputEvidence = {
  subagent: chat(SUBAGENT_BOX, SUBAGENT_ABOVE),
  main: chat(MAIN_BOX, MAIN_ABOVE),
  bytesAfterSwitch: MAGENTA_BYTES,
};

function failures(evidence: SubagentInputEvidence): string[] {
  return subagentInputVerdicts(evidence)
    .filter((entry) => !entry.pass)
    .map((entry) => entry.text);
}

describe('the subagent input box verdicts', () => {
  test('a bold magenta labelled box in the subagent and a round box in main pass in plain words', () => {
    const verdicts = subagentInputVerdicts(PASSING);
    expect(anyFailed(verdicts)).toBe(false);
    expect(describeVerdicts(verdicts)).toBe(
      [
        'pass  subagent box: bold magenta border with SUBAGENT label',
        'pass  main box: stock round border, no SUBAGENT label',
      ].join('\n'),
    );
  });

  test('a subagent box with a bold border but no label fails on the label alone', () => {
    const top = `┏${'━'.repeat(WIDTH - 2)}┓`;
    const found = failures({ ...PASSING, subagent: chat([top, boldBody, boldBottom], []) });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('top edge is not "┏━━ SUBAGENT ━…┓"');
  });

  test('a label with extra words after SUBAGENT fails', () => {
    const top = `┏━━ SUBAGENT · title · model ${'━'.repeat(WIDTH - 36)}┓`;
    const found = failures({ ...PASSING, subagent: chat([top, boldBody, boldBottom], []) });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('top edge is not');
  });

  test('a label drawn in another colour fails on the colour alone', () => {
    const bytes = `\r\n\u001B[36m${labelTop}\r\n`;
    const found = failures({ ...PASSING, bytesAfterSwitch: bytes });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('not drawn in magenta (SGR 35)');
  });

  test('a label drawn with no colour at all fails on the colour alone', () => {
    const found = failures({ ...PASSING, bytesAfterSwitch: `\r\n${labelTop}\r\n` });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('not drawn in magenta');
  });

  test('a label that is on screen but was never written after the switch fails', () => {
    const found = failures({ ...PASSING, bytesAfterSwitch: '\r\nsomething else\r\n' });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('SUBAGENT was never drawn after the switch');
  });

  test('only the last label in the bytes decides the colour', () => {
    const bytes = `${MAGENTA}${labelTop}\r\n${labelTop}\r\n`;
    expect(failures({ ...PASSING, bytesAfterSwitch: bytes })).toHaveLength(1);
  });

  test('the stock round box in the subagent fails the border, the label and the colour', () => {
    const found = failures({
      ...PASSING,
      subagent: chat(MAIN_BOX, SUBAGENT_ABOVE),
      bytesAfterSwitch: '\r\n',
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('the border is not the bold one');
    expect(found[0]).toContain('top edge is not');
    expect(found[0]).toContain('never drawn');
  });

  test('a subagent screen with no box fails once', () => {
    expect(failures({ ...PASSING, subagent: ['just text'] })).toEqual([
      'subagent box: no input box on screen',
    ]);
  });

  test('the label leaking into the main session fails', () => {
    const found = failures({ ...PASSING, main: chat(MAIN_BOX, [`   ${labelTop}`]) });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('SUBAGENT leaked into the main session');
  });

  test('the bold box staying in the main session fails the border and the leak check', () => {
    const found = failures({ ...PASSING, main: chat(SUBAGENT_BOX, MAIN_ABOVE) });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('the border is not the stock round one');
    expect(found[0]).toContain('SUBAGENT leaked');
  });

  test('a main screen with no box fails once', () => {
    expect(failures({ ...PASSING, main: [] })).toEqual(['main box: no input box on screen']);
  });

  test('only the box nearest the bottom counts', () => {
    const subagent = [...MAIN_BOX, ...chat(SUBAGENT_BOX, [])];
    expect(failures({ ...PASSING, subagent })).toEqual([]);
  });
});
