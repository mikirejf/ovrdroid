import type { Item, Line } from './session-mention-picker.ts';
import { picker } from './session-mention-picker.ts';

export const NOW = Date.UTC(2026, 0, 30);
export const HOUR = 3_600_000;
export const BORDER_AND_PADDING = 4;
export const LONG = 'word '.repeat(80).trim();

export interface Given {
  id?: string;
  title?: string;
  text?: string | null;
  branch?: string | null;
  label?: string;
  root?: boolean;
  cwd?: string;
  count?: number;
}

export function item(given: Given = {}): Item {
  const id = given.id ?? 'aaaa1111';
  return {
    label: given.title ?? 'Fix the lag',
    value: `#session-${id}`,
    $ODsession: id,
    $ODrow: {
      id,
      title: given.title ?? 'Fix the lag',
      messageCount: given.count ?? 12,
      modifiedTime: new Date(NOW - HOUR),
      createdTime: new Date(NOW - 3 * HOUR),
      cwd: given.cwd ?? '/home/me/dev/proj',
    },
    $ODhead: {
      text: given.text === undefined ? 'the panel stutters' : given.text,
      branch: given.branch === undefined ? 'main' : given.branch,
    },
    $ODplace: { label: given.label ?? 'proj', root: given.root ?? true },
  };
}

export function many(count: number, given: Given = {}): Item[] {
  return Array.from({ length: count }, (_unused, index) => item({ ...given, id: `s${index}` }));
}

export function plain(line: Line): string {
  return line.segs.map(([text]) => text).join('');
}

export const ROOM = 40;

export interface Fit {
  selected: boolean;
  width: number;
  room: number;
}

export function blockIn(given: Given, { selected, width, room }: Fit): string[] {
  const inner = width - BORDER_AND_PADDING;
  return picker
    .$ODsessionBlock(item(given), selected, '', inner, NOW, room)
    .map((line) => plain(line));
}

export function block(given: Given, selected: boolean, width = 120): string[] {
  return blockIn(given, { selected, width, room: ROOM });
}

export function gutterOf(line: string, width = 120): string {
  return line.slice(2, 2 + picker.$ODgutter(width - BORDER_AND_PADDING)).trimEnd();
}

export function contentOf(line: string, width = 120): string {
  const gutter = picker.$ODgutter(width - BORDER_AND_PADDING);
  return line.slice(gutter === 0 ? 2 : 4 + gutter);
}
