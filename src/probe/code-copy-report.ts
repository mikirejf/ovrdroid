import { TerminalScreen } from './terminal-screen.ts';

// oxlint-disable-next-line no-control-regex
const SGR = /\u001B\[[0-9;:]*m/gu;
// oxlint-disable-next-line no-control-regex
const OSC = /\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/gu;
// oxlint-disable-next-line no-control-regex
const CURSOR_SEQUENCE = /\u001B\[[0-9;?]*[A-Za-z]/gu;
const FRAME_START = '\u001B[?2026h';
const HEAD_CHARS = 16;
const RESUME_CHARS = 8;
const GAP_SHOWN = 40;
const LIVE_AREA_MARKER = 'allow all commands';
const SPINNER_MARKER = '(Press ESC to stop)';

export interface CodeCopyReading {
  printed: boolean;
  intactCopies: number;
  lastIntact: boolean;
  brokenAfter?: number;
  gap?: string;
}

export function withoutStyles(raw: string): string {
  return raw.replaceAll(SGR, '').replaceAll(OSC, '');
}

function shown(text: string): string {
  return JSON.stringify(text.slice(0, GAP_SHOWN)).slice(1, -1).replaceAll('\u00A0', '\\u00a0');
}

function intactCopies(text: string, command: string): number {
  return text.split(command).length - 1;
}

function matchedLength(text: string, from: number, command: string): number {
  let length = 0;
  while (length < command.length && text[from + length] === command[length]) {
    length += 1;
  }
  return length;
}

export function readCodeCopy(raw: string, command: string): CodeCopyReading {
  const text = withoutStyles(raw);
  const copies = intactCopies(text, command);
  const last = text.lastIndexOf(command.slice(0, HEAD_CHARS));
  if (last === -1) {
    return { printed: false, intactCopies: copies, lastIntact: false };
  }
  const matched = matchedLength(text, last, command);
  if (matched === command.length) {
    return { printed: true, intactCopies: copies, lastIntact: true };
  }
  const breakAt = last + matched;
  const resume = text.indexOf(command.slice(matched, matched + RESUME_CHARS), breakAt);
  const gap = text.slice(breakAt, resume === -1 ? breakAt + GAP_SHOWN : resume);
  return {
    printed: true,
    intactCopies: copies,
    lastIntact: false,
    brokenAfter: matched,
    gap: shown(gap),
  };
}

export function describeCodeCopy(reading: CodeCopyReading, command: string, when: string): string {
  if (!reading.printed) {
    return `${when}: Droid never printed the command`;
  }
  if (reading.lastIntact) {
    return `${when}: the last copy of the ${command.length}-char command is one unbroken run of bytes, so the terminal wraps it and a copy joins the rows (${reading.intactCopies} unbroken copies in all)`;
  }
  return `${when}: the last copy breaks after ${reading.brokenAfter} of ${command.length} chars, where Droid wrote "${reading.gap}", so a copy carries that break into the shell`;
}

export function liveFramesClipped(reply: string, command: string, cols: number): number {
  const head = command.slice(0, HEAD_CHARS);
  return reply.split(FRAME_START).filter((frame) =>
    withoutStyles(frame)
      .replaceAll(CURSOR_SEQUENCE, '')
      .split('\n')
      .some(
        (line) => line.includes(head) && !line.includes(command) && Bun.stringWidth(line) === cols,
      ),
  ).length;
}

export function describeLiveFrames(frames: number, command: string, cols: number): string {
  if (frames === 0) {
    return `no live frame drew the ${command.length}-char command, so the redraw check proves nothing: slow the stream down`;
  }
  return `${frames} live frames drew the ${command.length}-char command cut at column ${cols}, so the redraw never held a line wider than the terminal`;
}

export interface Session {
  launch: string;
  reply: string;
  repaint: string;
  resize: string;
}

export interface Size {
  cols: number;
  rows: number;
  resizeTo: number;
}

export interface Screens {
  live: string[];
  repainted: string[];
  resized: string[];
}

export function screensOf(session: Session, size: Size): Screens {
  const screen = new TerminalScreen(size.cols, size.rows);
  screen.feed(session.launch);
  screen.feed(session.reply);
  const live = screen.lines();
  screen.feed(session.repaint);
  const repainted = screen.lines();
  screen.resize(size.resizeTo, size.rows);
  screen.feed(session.resize);
  return { live, repainted, resized: screen.lines() };
}

export interface WideCommandReading {
  lines: number;
  rows: number;
}

export function readWideCommand(
  lines: string[],
  command: string,
  cols: number,
): WideCommandReading {
  const holding = lines.filter((line) => line.includes(command));
  const [first] = holding;
  return {
    lines: holding.length,
    rows: first === undefined ? 0 : Math.ceil(Bun.stringWidth(first) / cols),
  };
}

export function describeWideCommand(
  reading: WideCommandReading,
  command: string,
  when: string,
): string {
  if (reading.lines === 0) {
    return `${when}: no single line on screen holds the ${command.length}-char command, so a terminal copy carries a break`;
  }
  if (reading.lines > 1) {
    return `${when}: ${reading.lines} lines on screen hold the ${command.length}-char command, so a redraw left a copy behind`;
  }
  return `${when}: the ${command.length}-char command is one line that the terminal wraps over ${reading.rows} rows, so a terminal copy takes it whole`;
}

export function conversationAbove(lines: string[]): string[] {
  const live = lines.findLastIndex((line) => line.includes(LIVE_AREA_MARKER));
  const above = lines.slice(0, live === -1 ? lines.length : live);
  while (above.at(-1)?.trim() === '' || above.at(-1)?.includes(SPINNER_MARKER) === true) {
    above.pop();
  }
  return above;
}

export interface RedrawReading {
  rows: number;
  same: boolean;
  differsAt?: number;
  shown?: string;
  repainted?: string;
}

export function readRedraw(live: string[], repainted: string[]): RedrawReading {
  const above = conversationAbove(live);
  const canonical = conversationAbove(repainted);
  const longest = Math.max(above.length, canonical.length);
  for (let at = 0; at < longest; at += 1) {
    if (above[at] !== canonical[at]) {
      return {
        rows: canonical.length,
        same: false,
        differsAt: at,
        shown: above[at] ?? '',
        repainted: canonical[at] ?? '',
      };
    }
  }
  return { rows: canonical.length, same: true };
}

export function describeRedraw(reading: RedrawReading, when: string): string {
  if (reading.same) {
    return `${when}: the ${reading.rows} lines of conversation on screen match a full repaint at the same width, so the live redraws left no stray or doubled rows`;
  }
  return `${when}: the conversation on screen differs from a full repaint at line ${reading.differsAt} (screen "${shown(reading.shown ?? '')}", repaint "${shown(reading.repainted ?? '')}"), so a redraw left garbage`;
}

export function describeInlineCode(
  reading: CodeCopyReading,
  command: string,
  when: string,
): string {
  if (!reading.printed) {
    return `${when}: Droid never printed the inline command`;
  }
  if (reading.lastIntact) {
    return `${when}: the ${command.length}-char inline command sits on one line with plain spaces, so a copy pastes into a shell whole`;
  }
  return `${when}: the inline command breaks after ${reading.brokenAfter} of ${command.length} chars, where Droid wrote "${reading.gap}" instead of a plain space, so a copy carries that into the shell`;
}
