import type { Verdict } from './busy-signal-report.ts';
import type { InputBox } from './input-box.ts';
import { findInputBox } from './input-box.ts';

const LABEL_WORD = 'SUBAGENT';
const MAGENTA_LABEL_START = '\u001B[35m━━━ ';
const LABEL_TOP = new RegExp(`^━━━ ${LABEL_WORD} ━+$`, 'u');
const HEAVY_RULE = /^━+$/u;
const LIGHT_RULE = /^─+$/u;
const BORDER_GLYPH = /[┃┏┓┗┛│╭╮╰╯]/u;

export interface SubagentInputEvidence {
  subagent: readonly string[];
  main: readonly string[];
  bytesAfterSwitch: string;
}

function shown(box: InputBox): string {
  return [box.topLine, ...box.rows, box.bottomLine].join(' / ');
}

function glyphProblems(box: InputBox): string[] {
  const stray = [box.topLine, ...box.rows, box.bottomLine].find((line) => BORDER_GLYPH.test(line));
  return stray === undefined ? [] : [`the box still draws a side or corner glyph: ${stray}`];
}

function colourProblems(bytes: string): string[] {
  const at = bytes.lastIndexOf(LABEL_WORD);
  if (at === -1) {
    return [`${LABEL_WORD} was never drawn after the switch`];
  }
  const before = bytes.slice(0, at);
  return before.endsWith(MAGENTA_LABEL_START)
    ? []
    : [
        `the label line is not drawn in magenta (SGR 35), the bytes before it end ${JSON.stringify(before.slice(-24))}`,
      ];
}

function subagentProblems({ subagent, bytesAfterSwitch }: SubagentInputEvidence): string[] {
  const box = findInputBox(subagent);
  if (box === undefined) {
    return ['no input box on screen'];
  }
  return [
    ...(HEAVY_RULE.test(box.bottomLine)
      ? []
      : [`the bottom edge is not a heavy rule, the box reads ${shown(box)}`]),
    ...(LABEL_TOP.test(box.topLine)
      ? []
      : [`the top edge is not "━━━ ${LABEL_WORD} ━…", it reads ${box.topLine}`]),
    ...glyphProblems(box),
    ...colourProblems(bytesAfterSwitch),
  ];
}

function mainProblems({ main }: SubagentInputEvidence): string[] {
  const box = findInputBox(main);
  if (box === undefined) {
    return ['no input box on screen'];
  }
  const leaked = main.find((line) => line.includes(LABEL_WORD));
  return [
    ...(LIGHT_RULE.test(box.topLine) && LIGHT_RULE.test(box.bottomLine)
      ? []
      : [`the edges are not plain light rules, the box reads ${shown(box)}`]),
    ...glyphProblems(box),
    ...(leaked === undefined
      ? []
      : [`${LABEL_WORD} leaked into the main session: ${leaked.trim()}`]),
  ];
}

function verdict(who: string, problems: readonly string[], passed: string): Verdict {
  return problems.length === 0
    ? { pass: true, text: `${who} box: ${passed}` }
    : { pass: false, text: `${who} box: ${problems.join('; ')}` };
}

export function subagentInputVerdicts(evidence: SubagentInputEvidence): Verdict[] {
  return [
    verdict(
      'subagent',
      subagentProblems(evidence),
      `heavy magenta rules with ${LABEL_WORD} label, no side glyphs`,
    ),
    verdict(
      'main',
      mainProblems(evidence),
      `plain light rules, no side glyphs, no ${LABEL_WORD} label`,
    ),
  ];
}
