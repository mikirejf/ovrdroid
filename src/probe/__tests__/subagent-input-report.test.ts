import { describe, expect, test } from 'bun:test';

import { anyFailed, describeVerdicts } from '../busy-signal-report.ts';
import { subagentInputVerdicts } from '../subagent-input-report.ts';
import type { SubagentInputEvidence } from '../subagent-input-report.ts';

const WIDTH = 118;
const MAGENTA = '\u001B[35m';

const labelTop = `━━━ SUBAGENT ${'━'.repeat(WIDTH - 13)}`;
const heavyBody = '  > Enter to steer · Ctrl+Enter to queue';
const heavyBottom = '━'.repeat(WIDTH);
const lightTop = '─'.repeat(WIDTH);
const lightBody = '  >';
const lightBottom = '─'.repeat(WIDTH);

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

const SUBAGENT_BOX = [labelTop, heavyBody, heavyBottom];
const MAIN_BOX = [lightTop, lightBody, lightBottom];
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
  test('heavy magenta rules with a label in the subagent and light rules in main pass in plain words', () => {
    const verdicts = subagentInputVerdicts(PASSING);
    expect(anyFailed(verdicts)).toBe(false);
    expect(describeVerdicts(verdicts)).toBe(
      [
        'pass  subagent box: heavy magenta rules with SUBAGENT label, no side glyphs',
        'pass  main box: plain light rules, no side glyphs, no SUBAGENT label',
      ].join('\n'),
    );
  });

  test('a heavy subagent box with no label fails on the label alone', () => {
    const found = failures({
      ...PASSING,
      subagent: chat([heavyBottom, heavyBody, heavyBottom], []),
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('top edge is not "━━━ SUBAGENT ━…"');
  });

  test('a label with extra words after SUBAGENT fails', () => {
    const top = `━━━ SUBAGENT · title · model ${'━'.repeat(WIDTH - 34)}`;
    const found = failures({ ...PASSING, subagent: chat([top, heavyBody, heavyBottom], []) });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('top edge is not');
  });

  test('a bottom rule drawn light fails on the bottom edge alone', () => {
    const found = failures({
      ...PASSING,
      subagent: chat([labelTop, heavyBody, lightBottom], SUBAGENT_ABOVE),
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('bottom edge is not a heavy rule');
  });

  test('a side or corner glyph left in the subagent box fails', () => {
    const found = failures({
      ...PASSING,
      subagent: chat([labelTop, `${heavyBody} ┃`, heavyBottom], SUBAGENT_ABOVE),
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('still draws a side or corner glyph');
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

  test('the main box in the subagent fails the bottom edge and the label', () => {
    const found = failures({
      ...PASSING,
      subagent: chat(MAIN_BOX, SUBAGENT_ABOVE),
      bytesAfterSwitch: '\r\n',
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('bottom edge is not a heavy rule');
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

  test('the heavy box staying in the main session fails the rules and the leak check', () => {
    const found = failures({ ...PASSING, main: chat(SUBAGENT_BOX, MAIN_ABOVE) });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('edges are not plain light rules');
    expect(found[0]).toContain('SUBAGENT leaked');
  });

  test('the stock round box in main fails: it still draws side glyphs', () => {
    const round = ['╭──────╮', '│ >    │', '╰──────╯'];
    const found = failures({ ...PASSING, main: chat(round, MAIN_ABOVE) });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('edges are not plain light rules');
    expect(found[0]).toContain('still draws a side or corner glyph');
  });

  test('a main screen with no box fails once', () => {
    expect(failures({ ...PASSING, main: [] })).toEqual(['main box: no input box on screen']);
  });

  test('only the box nearest the bottom counts', () => {
    const subagent = [...MAIN_BOX, ...chat(SUBAGENT_BOX, [])];
    expect(failures({ ...PASSING, subagent })).toEqual([]);
  });
});
