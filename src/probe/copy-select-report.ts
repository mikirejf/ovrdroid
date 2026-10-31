import type { Verdict } from './busy-signal-report.ts';
import { DRAFT_LINES, QUOTE_FIRST, QUOTE_INTRO, QUOTE_LAST } from './copy-select-reply.ts';
import { findInputBox } from './input-box.ts';

const BOX_DRAWING = /[\u2500-\u257F]/u;
const BOX_DRAWING_ALL = /[\u2500-\u257F]/gu;
const SPACE_RUN = / {2,}/gu;
const SHOWN_CHARS = 60;

export interface CopySelectEvidence {
  reply: readonly string[];
  draft: readonly string[];
}

interface Selection {
  lines: string[];
  marked: string[];
}

function selectionOf(lines: readonly string[]): Selection {
  const trimmed = lines.map((line) => line.trimEnd());
  return { lines: trimmed, marked: trimmed.filter((line) => BOX_DRAWING.test(line)) };
}

function quoteSelection(screen: readonly string[]): Selection | undefined {
  const start = screen.findIndex((line) => line.includes(QUOTE_FIRST));
  const end = screen.findLastIndex((line) => line.includes(QUOTE_LAST));
  if (start === -1 || end < start) {
    return undefined;
  }
  const quoted = screen
    .slice(start, end + 1)
    .filter((line) => line.trim() !== '' && !line.includes(QUOTE_INTRO));
  return selectionOf(quoted);
}

function draftSelection(screen: readonly string[]): Selection | undefined {
  const box = findInputBox(screen);
  if (box === undefined) {
    return undefined;
  }
  const rows = screen.slice(box.top + 1, box.bottom);
  const text = rows.join('\n');
  return DRAFT_LINES.every((line) => text.includes(line)) ? selectionOf(rows) : undefined;
}

function glyphsOf(lines: readonly string[]): string {
  const glyphs = new Set(lines.flatMap((line) => line.match(BOX_DRAWING_ALL) ?? []));
  return [...glyphs].join(' ');
}

function squeezed(line: string): string {
  return line.trim().replaceAll(SPACE_RUN, ' ');
}

function verdict(what: string, noun: string, selection: Selection | undefined): Verdict {
  if (selection === undefined) {
    return {
      pass: false,
      text: `${what}: it never showed on the screen, so there was nothing to select`,
    };
  }
  const [first] = selection.marked;
  if (first === undefined) {
    return {
      pass: true,
      text: `${what}: selecting its ${selection.lines.length} ${noun} copies no box-drawing glyph`,
    };
  }
  return {
    pass: false,
    text: `${what}: selecting its ${selection.lines.length} ${noun} copies box-drawing glyphs: ${selection.marked.length} of them carry ${glyphsOf(selection.marked)}, e.g. ${JSON.stringify(squeezed(first).slice(0, SHOWN_CHARS))}`,
  };
}

export function copySelectVerdicts(evidence: CopySelectEvidence): Verdict[] {
  return [
    verdict('quote', 'lines', quoteSelection(evidence.reply)),
    verdict('draft', 'rows', draftSelection(evidence.draft)),
  ];
}
