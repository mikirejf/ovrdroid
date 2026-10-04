import fs from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import {
  SESSION_COMPLETE,
  SESSION_HEAD,
  SESSION_KEEP,
  SESSION_ITEMS,
  SESSION_MATCHES,
  SESSION_POOL,
  SESSION_QUERY,
  SESSION_REPO,
  SESSION_TEXT,
} from '../session-mention-patches.ts';
import { payloadFunction } from './payload.ts';

export interface Session {
  id: string;
  title: string;
  messageCount: number;
  modifiedTime: Date;
  cwd?: string | undefined;
  isSubagent?: boolean;
}

export interface Hash {
  query: string;
  start: number;
}

interface Completion {
  newText: string;
  newCursorPosition: number;
}

export interface Item {
  label: string;
  value: string;
  $ODsession?: string;
}

type KeepArgs = [
  ids: readonly string[],
  now: readonly Session[],
  pool: readonly Session[],
  max: number,
];

type MatchArgs = [
  pool: readonly Session[],
  query: string,
  max: number,
  heads?: ReadonlyMap<string, string | null>,
];

export interface Picker {
  $ODsessionQuery: (text: string, cursor: number) => Hash | null;
  $ODsessionPool: (all: readonly Session[], self: string | null) => Session[];
  $ODsessionMatches: (...args: MatchArgs) => Session[];
  $ODsessionKeep: (...args: KeepArgs) => Session[];
  $ODsessionComplete: (text: string, cursor: number, id: string) => Completion;
  $ODsessionItems: (
    rows: readonly Session[],
    width: number,
    first: (row: Session) => string | null,
  ) => Item[];
  $ODsessionText: (raw: string) => string | null;
  $ODsessionHead: (path: string) => string | null;
  $ODsessionRepo: (cwd: string | undefined) => string;
  $ODshortPath: (cwd: string) => string;
}

export const AGO = '3h ago';

function cells(text: string): number {
  return Bun.stringWidth(text);
}

function headWithin(text: string, room: number): string {
  let head = '';
  for (const char of text) {
    if (cells(head + char) > room) {
      break;
    }
    head += char;
  }
  return head;
}

function tailWithin(text: string, room: number): string {
  let tail = '';
  for (const char of Array.from(text).toReversed()) {
    if (cells(char + tail) > room) {
      break;
    }
    tail = char + tail;
  }
  return tail;
}

export function endCut(text: string, width: number): string {
  if (width <= 0) {
    return '';
  }
  return cells(text) <= width ? text : `${headWithin(text, width - 1)}\u2026`;
}

export function middleCut(text: string, width: number): string {
  if (cells(text) <= width) {
    return text;
  }
  if (width < 4) {
    return '...';
  }
  const room = width - 3;
  const head = Math.floor(room * 0.45);
  return `${headWithin(text, head)}...${tailWithin(text, room - head)}`;
}

export type ReadArgs = [
  fd: number,
  buffer: Uint8Array,
  offset: number,
  length: number,
  position: number,
];

export interface Files {
  openSync: (path: string, flags: string) => number;
  readSync: (...args: ReadArgs) => number;
  closeSync: (fd: number) => void;
}

export interface Tree {
  statSync: (
    path: string,
    options: { throwIfNoEntry: false },
  ) => { isDirectory: () => boolean } | undefined;
  readFileSync: (path: string, encoding: BufferEncoding) => string;
}

type Module = 'fs' | 'os' | 'path';

interface Home {
  homedir: () => string;
}

type Loaded = (Files & Tree) | Home | typeof path;

export function pickerReading(files: Files, tree: Tree = fs, home: string = homedir()): Picker {
  return payloadFunction<
    [
      (date: Date) => string,
      (title: string) => string,
      (text: string, width: number) => string,
      () => { t: (key: string) => string },
      (text: string, width: number) => string,
      (name: Module) => Loaded,
    ],
    Picker
  >(
    ['Mm', 'ZT', 'DB', 'R', 'Li', 'require'],
    `return class{${SESSION_QUERY}${SESSION_POOL}${SESSION_MATCHES}${SESSION_KEEP}${SESSION_COMPLETE}${SESSION_ITEMS}${SESSION_TEXT}${SESSION_HEAD}${SESSION_REPO}}`,
  )(
    () => AGO,
    (title) => title,
    middleCut,
    () => ({ t: () => 'Untitled' }),
    endCut,
    (name) => ({ fs: { ...files, ...tree }, os: { homedir: () => home }, path })[name],
  );
}

export const picker = pickerReading(fs);
