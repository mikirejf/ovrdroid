import { chatArea, PROMPT_WORD, REWIND_MENU_TITLE } from './rewind-scroll-report.ts';
import type { Verdict } from './rewind-scroll-report.ts';
import type { StyledLine } from './terminal-screen.ts';

const PROMPT = new RegExp(`${PROMPT_WORD} (?<topic>[A-Z0-9]+)(?= )`, 'u');
const SELECTED_ROW = /^[│|]?\s*>\s+\d/u;
const MIXED = 'mixed';
const TRUECOLOR = /^[34]8;2;(?<red>\d+);(?<green>\d+);(?<blue>\d+)$/u;
const BACKGROUND_OFFSET = 10;
const HEX = 16;

export interface PromptColor {
  topic: string;
  fg: string;
  bar: string;
}

export interface ColorReading {
  focus: string | undefined;
  prompts: PromptColor[];
}

function backgroundOf(foreground: string): string {
  if (foreground.startsWith('38;')) {
    return `48;${foreground.slice('38;'.length)}`;
  }
  const code = Number(foreground);
  return Number.isInteger(code) ? String(code + BACKGROUND_OFFSET) : foreground;
}

function nameOf(color: string): string {
  const rgb = TRUECOLOR.exec(color)?.groups;
  if (rgb !== undefined) {
    const hex = [rgb['red'], rgb['green'], rgb['blue']].map((part) =>
      Number(part).toString(HEX).padStart(2, '0'),
    );
    return `#${hex.join('')}`;
  }
  return color === '' ? 'the default colour' : `SGR ${color}`;
}

function spanColor(line: StyledLine, start: number, length: number): string {
  const chars = Array.from(line.text);
  const colors = new Set(
    line.fgs.slice(start, start + length).filter((_, at) => chars[start + at]?.trim() !== ''),
  );
  const [only] = colors;
  return colors.size === 1 && only !== undefined ? only : MIXED;
}

function promptOf(line: StyledLine): PromptColor | undefined {
  const match = PROMPT.exec(line.text);
  const topic = match?.groups?.['topic'];
  if (match === null || topic === undefined) {
    return undefined;
  }
  const start = Array.from(line.text.slice(0, match.index)).length;
  return {
    topic,
    fg: spanColor(line, start, Array.from(match[0]).length),
    bar: line.bgs[0] ?? '',
  };
}

function selectedColor(screen: readonly StyledLine[]): string | undefined {
  const menu = screen.findIndex((line) => line.text.includes(REWIND_MENU_TITLE));
  const row =
    menu === -1 ? undefined : screen.slice(menu + 1).find((line) => SELECTED_ROW.test(line.text));
  const marker = row === undefined ? -1 : Array.from(row.text).indexOf('>');
  const color = row?.fgs[marker];
  return color === undefined || color === '' ? undefined : color;
}

export function readColors(screen: readonly StyledLine[]): ColorReading {
  const area = screen.slice(0, chatArea(screen.map((line) => line.text)).length);
  return { focus: selectedColor(screen), prompts: area.flatMap((line) => promptOf(line) ?? []) };
}

function noSelectedRow(): Verdict {
  return { pass: false, text: 'the menu shows no selected row to take the focus colour from' };
}

export function unfocusedVerdict(reading: ColorReading): Verdict {
  const { focus } = reading;
  if (focus === undefined) {
    return noSelectedRow();
  }
  const lit = reading.prompts.filter((prompt) => prompt.fg === focus).map((prompt) => prompt.topic);
  return lit.length === 0
    ? {
        pass: true,
        text: `opening the menu left every message in its normal colour (none in the menu's ${nameOf(focus)})`,
      }
    : { pass: false, text: `opening the menu already drew ${lit.join(', ')} in ${nameOf(focus)}` };
}

export function focusedVerdict(what: string, topic: string, reading: ColorReading): Verdict {
  const { focus } = reading;
  if (focus === undefined) {
    return noSelectedRow();
  }
  const target = reading.prompts.find((prompt) => prompt.topic === topic);
  const rest = reading.prompts.filter((prompt) => prompt.topic !== topic);
  const lit = rest.filter((prompt) => prompt.fg === focus);
  const problems = [
    ...(target === undefined ? [`the ${topic} message is not on screen`] : []),
    ...(target !== undefined && target.fg !== focus
      ? [`the ${topic} text is ${nameOf(target.fg)}, not ${nameOf(focus)}`]
      : []),
    ...(target !== undefined && target.bar !== backgroundOf(focus)
      ? [`the ${topic} bar is ${nameOf(target.bar)}, not ${nameOf(backgroundOf(focus))}`]
      : []),
    ...(lit.length === 0
      ? []
      : [`${lit.map((prompt) => prompt.topic).join(', ')} also drawn in ${nameOf(focus)}`]),
  ];
  const others =
    rest.length === 0
      ? 'no other message is on screen'
      : `${rest.map((prompt) => prompt.topic).join(', ')} stay normal`;
  return problems.length === 0
    ? {
        pass: true,
        text: `${what}: ${topic} is drawn in the menu's selected colour (${nameOf(focus)}); ${others}`,
      }
    : { pass: false, text: `${what}: ${problems.join('; ')}` };
}

export function restoredColorVerdict(reading: ColorReading, focus: string | undefined): Verdict {
  if (focus === undefined) {
    return noSelectedRow();
  }
  const lit = reading.prompts.filter((prompt) => prompt.fg === focus).map((prompt) => prompt.topic);
  const problems = [
    ...(reading.prompts.length === 0 ? ['no user message is on screen'] : []),
    ...(lit.length === 0 ? [] : [`${lit.join(', ')} still drawn in ${nameOf(focus)}`]),
  ];
  return problems.length === 0
    ? {
        pass: true,
        text: `after Esc all ${reading.prompts.length} visible messages are back in their normal colour`,
      }
    : { pass: false, text: `after Esc: ${problems.join('; ')}` };
}
