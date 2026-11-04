import { plain } from './ansi.ts';

export const SYNC_START = '\u001B[?2026h';
const PAINT_WINDOW_CHARS = 65_536;
const LINE_BREAK = /\r?\n/u;
const RULE_TOP = /^[─━]{3}/u;
const RULE_BOTTOM = /^[─━]{3,}$/u;
const ROUND_EDGES = /^│ ?| *│$/gu;
const FLAT_PADDING = /^ {2}/u;
const PROMPT = /^> ?/u;

export interface InputBox {
  top: number;
  bottom: number;
  topLine: string;
  bottomLine: string;
  rows: string[];
}

interface Style {
  isTop: (line: string, next: string) => boolean;
  isBottom: (line: string) => boolean;
  rowOf: (line: string) => string;
}

const ROUND: Style = {
  isTop: (line, next) => line.startsWith('╭') && next.startsWith('│ >'),
  isBottom: (line) => line.startsWith('╰'),
  rowOf: (line) => line.replaceAll(ROUND_EDGES, '').trimEnd(),
};

const FLAT: Style = {
  isTop: (line, next) => RULE_TOP.test(line) && next.startsWith('  >'),
  isBottom: (line) => RULE_BOTTOM.test(line),
  rowOf: (line) => line.replace(FLAT_PADDING, ''),
};

function boxAt(lines: readonly string[], top: number, style: Style): InputBox | undefined {
  if (!style.isTop((lines[top] ?? '').trimEnd(), lines[top + 1] ?? '')) {
    return undefined;
  }
  const bottom = lines.findIndex((line, at) => at > top + 1 && style.isBottom(line.trimEnd()));
  if (bottom === -1) {
    return undefined;
  }
  return {
    top,
    bottom,
    topLine: (lines[top] ?? '').trimEnd(),
    bottomLine: (lines[bottom] ?? '').trimEnd(),
    rows: lines.slice(top + 1, bottom).map((line) => style.rowOf(line.trimEnd())),
  };
}

export function findInputBox(lines: readonly string[]): InputBox | undefined {
  let found: InputBox | undefined;
  for (const at of lines.keys()) {
    const box = boxAt(lines, at, ROUND) ?? boxAt(lines, at, FLAT);
    if (box !== undefined && (found === undefined || box.bottom >= found.bottom)) {
      found = box;
    }
  }
  return found;
}

export function linesOf(text: string): string[] {
  return text.split(LINE_BREAK);
}

export function hasInputBox(text: string): boolean {
  return findInputBox(linesOf(plain(text))) !== undefined;
}

export function draftOf(lines: readonly string[]): string | undefined {
  const first = findInputBox(lines)?.rows[0];
  return first?.replace(PROMPT, '');
}

export function withoutInputBox(lines: readonly string[]): string[] {
  const box = findInputBox(lines);
  return box === undefined ? [...lines] : lines.filter((_, at) => at < box.top || at > box.bottom);
}

export function boxSpans(text: string, cols: number): boolean {
  const box = findInputBox(linesOf(plain(text)));
  return box?.bottomLine.length === cols;
}

export function appFrameDetector(): (text: string) => boolean {
  let tail = '';
  let window = '';
  let synced = false;
  let painted = false;

  return (text) => {
    if (painted) {
      return true;
    }
    if (synced) {
      window = (window + text).slice(-PAINT_WINDOW_CHARS);
    } else {
      const joined = tail + text;
      const start = joined.indexOf(SYNC_START);
      synced = start !== -1;
      window = synced ? joined.slice(start + SYNC_START.length) : '';
      tail = joined.slice(1 - SYNC_START.length);
    }
    painted = synced && hasInputBox(window);
    return painted;
  };
}
