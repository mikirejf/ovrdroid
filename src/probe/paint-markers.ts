import { diffStatsPatches } from '../patch/diff-stats-patches.ts';
import { logoPatches } from '../patch/logo.ts';
import type { Patch } from '../patch/patches.ts';
import { escapeRegex } from '../patch/tokens.ts';
import { turnClockPatches } from '../patch/turn-clock-patches.ts';
import { updateNoticePatches } from '../patch/update-notice-patches.ts';

export const FRAME_NAMES = ['launch', 'turn', 'narrow'] as const;
export type FrameName = (typeof FRAME_NAMES)[number];
export type PaintFrames = Partial<Record<FrameName, readonly string[] | undefined>>;

const JS_ESCAPE = /\\u(?<unicode>[0-9A-Fa-f]{4})|\\x(?<byte>[0-9A-Fa-f]{2})/gu;
const AGE = String.raw`(?:<1m|\d+[mhd])`;
const HEX = 16;

export function unescapeJs(text: string): string {
  return text.replaceAll(JS_ESCAPE, (_match, unicode?: string, byte?: string) =>
    String.fromCodePoint(Number.parseInt(unicode ?? byte ?? '', HEX)),
  );
}

function patchNamed(patches: readonly Patch[], name: string): Patch {
  const patch = patches.find((candidate) => candidate.name === name);
  if (patch === undefined) {
    throw new TypeError(`the patch set has no ${name}, so its painted text is unknown`);
  }
  return patch;
}

function groupsIn(text: string, pattern: RegExp, name: string): Record<string, string> {
  const groups = pattern.exec(text)?.groups;
  if (groups === undefined) {
    throw new TypeError(
      `${name} no longer matches ${pattern.source}, so its painted text is unknown`,
    );
  }
  return groups;
}

function group(groups: Record<string, string>, key: string): string {
  return unescapeJs(groups[key] ?? '');
}

function isRows(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((row) => typeof row === 'string');
}

function rowsOf(patches: readonly Patch[], name: string, pattern: RegExp): readonly string[] {
  const rows: unknown = JSON.parse(
    group(groupsIn(patchNamed(patches, name).replace, pattern, name), 'rows'),
  );
  if (!isRows(rows) || rows.length === 0) {
    throw new TypeError(`${name} no longer replaces a list of rows`);
  }
  return rows;
}

function widthIn(text: string, name: string): number {
  return Number(group(groupsIn(text, /[=](?<width>\d+),/u, name), 'width'));
}

export const WORDMARK_ROWS = rowsOf(logoPatches, 'wordmark-ovrdroid', /[=](?<rows>\[.*\]),$/u);
export const COMPACT_ROWS = rowsOf(
  logoPatches,
  'wordmark-compact-ovrdroid',
  /[=](?<rows>\[.*?\]),a=/u,
);

const THRESHOLD = patchNamed(logoPatches, 'wordmark-width-threshold');
export const NARROW_COLS = Math.floor(
  (widthIn(THRESHOLD.find, THRESHOLD.name) + widthIn(THRESHOLD.replace, THRESHOLD.name)) / 2,
);

const NOTICE = groupsIn(
  patchNamed(updateNoticePatches, 'update-notice-header-line').replace,
  /[=]"(?<head>[^"]*)"\+\$ODupdate\+"(?<tail>[^"]*)"/u,
  'update-notice-header-line',
);

export const UPDATE_FILE_UNDER_HOME = group(
  groupsIn(
    patchNamed(updateNoticePatches, 'auto-update-notice-only').replace,
    /homedir\(\)\+"\/(?<file>[^"]+)"/u,
    'auto-update-notice-only',
  ),
  'file',
);

const STATS = groupsIn(
  patchNamed(diffStatsPatches, 'diff-stats-footer-without-pr').replace,
  /\("(?<plus>[^"]*)"\+f\.additions[^)]*\),\w+\("(?<gap>[^"]*)"\),\w+\("(?<minus>[^"]*)"\+f\.deletions/u,
  'diff-stats-footer-without-pr',
);

const CLOCK_PARTS = patchNamed(turnClockPatches, 'turn-clock-parts');
const SENT = groupsIn(
  CLOCK_PARTS.replace,
  /"(?<up>[^"]*)"\+\$ODa\(\$ODnow-\$ODc\.sent\)/u,
  CLOCK_PARTS.name,
);
const DONE = groupsIn(
  CLOCK_PARTS.replace,
  /"(?<down>[^"]*)"\+\$ODa\(\$ODnow-\$ODc\.done\)/u,
  CLOCK_PARTS.name,
);
const CACHE = groupsIn(
  CLOCK_PARTS.replace,
  /"(?<cache>[^"]*)"\+\$ODa\(Math\.min/u,
  CLOCK_PARTS.name,
);

export interface PaintFixture {
  updateVersion: string;
  additions: number;
  deletions: number;
}

export interface Marker {
  name: string;
  patch: string;
  frame: FrameName;
  shows: string;
  found: (lines: readonly string[]) => boolean;
}

export function hasBlock(lines: readonly string[], rows: readonly string[]): boolean {
  const wanted = rows.map((row) => row.trim());
  return lines.some((_line, start) =>
    wanted.every((row, offset) => lines[start + offset]?.includes(row) === true),
  );
}

function hasText(text: string): (lines: readonly string[]) => boolean {
  return (lines) => lines.some((line) => line.includes(text));
}

function hasMatch(pattern: RegExp): (lines: readonly string[]) => boolean {
  return (lines) => lines.some((line) => pattern.test(line));
}

export function paintMarkers(fixture: PaintFixture): Marker[] {
  const notice = `${group(NOTICE, 'head')}${fixture.updateVersion}${group(NOTICE, 'tail')}`;
  const stats = `${group(STATS, 'plus')}${fixture.additions}${group(STATS, 'gap')}${group(STATS, 'minus')}${fixture.deletions}`;
  const up = group(SENT, 'up');
  const down = group(DONE, 'down');
  const cache = group(CACHE, 'cache');
  return [
    {
      name: 'the ovrdroid wordmark',
      patch: 'wordmark-ovrdroid',
      frame: 'launch',
      shows: WORDMARK_ROWS[0]?.trim() ?? '',
      found: (lines) => hasBlock(lines, WORDMARK_ROWS),
    },
    {
      name: 'the update notice',
      patch: 'update-notice-header-line',
      frame: 'launch',
      shows: notice,
      found: hasText(notice),
    },
    {
      name: 'the diff stats of a branch with no PR',
      patch: 'diff-stats-footer-without-pr',
      frame: 'launch',
      shows: stats,
      found: hasText(stats),
    },
    {
      name: 'the turn clock',
      patch: 'turn-clock-parts',
      frame: 'turn',
      shows: `${up}<1m ${down}<1m`,
      found: hasMatch(new RegExp(`${escapeRegex(up)}${AGE} ${escapeRegex(down)}${AGE}`, 'u')),
    },
    {
      name: 'the cache clock',
      patch: 'turn-clock-parts',
      frame: 'turn',
      shows: `${cache}44m`,
      found: hasMatch(new RegExp(`${escapeRegex(cache)}${AGE}`, 'u')),
    },
    {
      name: 'the compact ovrdroid wordmark',
      patch: 'wordmark-compact-ovrdroid',
      frame: 'narrow',
      shows: COMPACT_ROWS.find((row) => /\w/u.test(row))?.trim() ?? '',
      found: (lines) => hasBlock(lines, COMPACT_ROWS),
    },
  ];
}

export type MarkerState = 'shown' | 'missing' | 'not captured';

export interface MarkerResult {
  marker: Marker;
  state: MarkerState;
}

export function readPaint(frames: PaintFrames, markers: readonly Marker[]): MarkerResult[] {
  return markers.map((marker) => {
    const lines = frames[marker.frame];
    if (lines === undefined) {
      return { marker, state: 'not captured' };
    }
    return { marker, state: marker.found(lines) ? 'shown' : 'missing' };
  });
}

export function missingMarkers(frames: PaintFrames, markers: readonly Marker[]): MarkerResult[] {
  return readPaint(frames, markers).filter((result) => result.state !== 'shown');
}

const FRAME_WORDS: Record<FrameName, string> = {
  launch: 'first settled frame',
  turn: 'frame after one turn',
  narrow: `frame after /clear at ${NARROW_COLS} columns`,
};

export function describeResult({ marker, state }: MarkerResult): string {
  const where = FRAME_WORDS[marker.frame];
  if (state === 'shown') {
    return `ok    ${marker.name} (${marker.patch}) is in the ${where}`;
  }
  if (state === 'missing') {
    return `FAIL  ${marker.name} (${marker.patch}) is missing from the ${where}; expected ${JSON.stringify(marker.shows)}`;
  }
  return `FAIL  not exercised: the ${where} was never captured, so ${marker.name} (${marker.patch}) was not checked`;
}

export function describeFrame(name: FrameName, lines: readonly string[] | undefined): string {
  return [`# ${FRAME_WORDS[name]}`, ...(lines ?? ['(not captured)'])].join('\n');
}
