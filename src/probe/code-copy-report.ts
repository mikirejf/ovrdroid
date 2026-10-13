// oxlint-disable-next-line no-control-regex
const SGR = /\u001B\[[0-9;:]*m/gu;
// oxlint-disable-next-line no-control-regex
const OSC = /\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/gu;
const HEAD_CHARS = 16;
const RESUME_CHARS = 8;
const GAP_SHOWN = 40;

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
