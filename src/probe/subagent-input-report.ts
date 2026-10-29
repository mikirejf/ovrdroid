import type { Verdict } from './busy-signal-report.ts';

const LABEL_WORD = 'SUBAGENT';
const MAGENTA_LABEL_START = '\u001B[35m┏━━ ';
const BOX_TOP = /^[┏╭]/u;
const LABEL_TOP = new RegExp(`^┏━━ ${LABEL_WORD} ━+┓$`, 'u');

export interface SubagentInputEvidence {
  subagent: readonly string[];
  main: readonly string[];
  bytesAfterSwitch: string;
}

interface Box {
  top: string;
  body: string;
  bottom: string;
}

function boxOf(lines: readonly string[]): Box | undefined {
  const at = lines.findLastIndex((line) => BOX_TOP.test(line));
  if (at === -1) {
    return undefined;
  }
  const row = (index: number) => (lines[index] ?? '').trimEnd();
  return { top: row(at), body: row(at + 1), bottom: row(at + 2) };
}

interface Frame {
  topLeft: string;
  topRight: string;
  side: string;
  bottomLeft: string;
  bottomRight: string;
}

const BOLD: Frame = { topLeft: '┏', topRight: '┓', side: '┃', bottomLeft: '┗', bottomRight: '┛' };
const ROUND: Frame = { topLeft: '╭', topRight: '╮', side: '│', bottomLeft: '╰', bottomRight: '╯' };

function framed(box: Box, frame: Frame): boolean {
  return (
    box.top.startsWith(frame.topLeft) &&
    box.top.endsWith(frame.topRight) &&
    box.body.startsWith(frame.side) &&
    box.body.endsWith(frame.side) &&
    box.bottom.startsWith(frame.bottomLeft) &&
    box.bottom.endsWith(frame.bottomRight)
  );
}

function shown(box: Box): string {
  return `${box.top} / ${box.body} / ${box.bottom}`;
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
  const box = boxOf(subagent);
  if (box === undefined) {
    return ['no input box on screen'];
  }
  return [
    ...(framed(box, BOLD) ? [] : [`the border is not the bold one, the box reads ${shown(box)}`]),
    ...(LABEL_TOP.test(box.top)
      ? []
      : [`the top edge is not "┏━━ ${LABEL_WORD} ━…┓", it reads ${box.top}`]),
    ...colourProblems(bytesAfterSwitch),
  ];
}

function mainProblems({ main }: SubagentInputEvidence): string[] {
  const box = boxOf(main);
  if (box === undefined) {
    return ['no input box on screen'];
  }
  const leaked = main.find((line) => line.includes(LABEL_WORD));
  return [
    ...(framed(box, ROUND)
      ? []
      : [`the border is not the stock round one, the box reads ${shown(box)}`]),
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
    verdict('subagent', subagentProblems(evidence), `bold magenta border with ${LABEL_WORD} label`),
    verdict('main', mainProblems(evidence), `stock round border, no ${LABEL_WORD} label`),
  ];
}
