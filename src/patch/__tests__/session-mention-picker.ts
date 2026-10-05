import fs from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { SESSION_LIST_STATICS } from '../session-list-patches.ts';
import {
  SESSION_BARE,
  SESSION_COMPLETE,
  SESSION_HEAD,
  SESSION_KEEP,
  SESSION_ITEMS,
  SESSION_LAST,
  SESSION_MATCHES,
  SESSION_POOL,
  SESSION_QUERY,
  SESSION_REPO,
  SESSION_TEXT,
} from '../session-mention-patches.ts';
import { payloadFunction } from './payload.ts';
import { endCut, prefixWithin } from './session-list-stock.ts';

export interface LastMessage {
  at: number;
  role: string | null;
  text: string | null;
}

export interface Session {
  $ODlast?: LastMessage;
  id: string;
  title: string;
  messageCount: number;
  modifiedTime: Date;
  createdTime?: Date;
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

export interface Head {
  text: string | null;
  branch: string | null;
}

export interface Place {
  label: string;
  root: boolean;
}

export interface Item {
  label: string;
  value: string;
  $ODsession?: string;
  $ODrow?: Session;
  $ODhead?: Head | null;
  $ODplace?: Place;
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
  heads?: ReadonlyMap<string, Head | null>,
];

export type Seg = readonly [text: string, style: string];

export interface Line {
  bg: string;
  segs: readonly Seg[];
}

export interface View {
  top: number;
  lines: readonly Line[];
  left: string;
  right: string;
}

type ViewArgs = [
  items: readonly Item[],
  selected: number,
  inner: number,
  rows: number,
  top: number,
  now: number,
];

type BlockArgs = [
  item: Item,
  selected: boolean,
  bg: string,
  inner: number,
  now: number,
  room: number,
];

interface ListPicker {
  $ODsessionView: (...args: ViewArgs) => View;
  $ODsessionBlock: (...args: BlockArgs) => Line[];
  $ODdetail: boolean;
  $ODredraw: (() => void) | undefined;
  $ODsetDetail: (on: boolean) => void;
  $ODgutter: (inner: number) => number;
  $ODwrap: (text: string, room: number, max: number) => string[];
  $ODfitStart: (text: string, room: number) => string;
  $ODage: (at: Date | number, now: number) => string;
  $ODstatusBranch: (context: string) => string | null;
  $ODshown: (text: string) => string;
  $ODblend: (from: string, to: string, share: number) => string | undefined;
}

export interface Picker extends ListPicker {
  $ODsessionQuery: (text: string, cursor: number) => Hash | null;
  $ODsessionPool: (all: readonly Session[], self: string | null) => Session[];
  $ODsessionMatches: (...args: MatchArgs) => Session[];
  $ODsessionKeep: (...args: KeepArgs) => Session[];
  $ODsessionComplete: (text: string, cursor: number, id: string) => Completion;
  $ODsessionItems: (rows: readonly Session[], first: (row: Session) => Head | null) => Item[];
  $ODsessionText: (raw: string) => Head;
  $ODsessionHead: (path: string) => Head;
  $ODsessionLast: (path: string) => LastMessage | null;
  $ODsessionPlace: (cwd: string | undefined) => Place;
  $ODshortPath: (cwd: string) => string;
  $ODhomePath: (cwd: string) => string;
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
      (title: string) => string,
      () => { t: (key: string) => string },
      (name: Module) => Loaded,
      typeof endCut,
      typeof prefixWithin,
    ],
    Picker
  >(
    ['ZT', 'R', 'require', 'Li', 'Ar'],
    `return class{${SESSION_QUERY}${SESSION_POOL}${SESSION_MATCHES}${SESSION_KEEP}${SESSION_COMPLETE}${SESSION_ITEMS}${SESSION_TEXT}${SESSION_HEAD}${SESSION_LAST}${SESSION_BARE}${SESSION_REPO}${SESSION_LIST_STATICS}}`,
  )(
    (title) => title,
    () => ({ t: () => 'Untitled' }),
    (name) => ({ fs: { ...files, ...tree }, os: { homedir: () => home }, path })[name],
    endCut,
    prefixWithin,
  );
}

export const picker = pickerReading(fs);
