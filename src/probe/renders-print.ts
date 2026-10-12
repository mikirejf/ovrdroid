import { readFileSync } from 'node:fs';

import type { App } from '../binary/graph.ts';
import { readApp } from '../binary/graph.ts';
import {
  FIRST_CAUSE,
  MESSAGE_EVENT,
  MESSAGES_HOOK,
  STATE_HOOK,
  STORE_HOOK,
  STREAM_CAUSE,
  TYPING_MS,
} from '../patch/render-profile-patches.ts';
import type { Activities, ComponentSummary, HookLabel, WindowSummary } from './renders.ts';
import { REASON_JOIN, UNKNOWN_ACTIVITY, unchangedOf } from './renders.ts';
import { findPlaces, moduleHolding } from './search.ts';

const PERCENT = 100;
const SHOWN_PROPS = 3;
const SHOWN_HOOKS = 4;
const SHOWN_CAUSES = 4;
const SNIPPET_CHARS = 60;
const DETAIL_INDENT = '     ';
const MESSAGE_EVENTS = new Set([MESSAGE_EVENT, STREAM_CAUSE, FIRST_CAUSE]);

export interface Location {
  place: string;
  others: number;
}

type Places = ReadonlyMap<string, Location | undefined>;

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let at = text.indexOf('\n'); at !== -1 && at < index; at = text.indexOf('\n', at + 1)) {
    line += 1;
  }
  return line;
}

export function placeSource(app: App, source: string): Location | undefined {
  const [first, ...others] = findPlaces(app, source, 0).places;
  const holder = moduleHolding(app, source);
  if (first === undefined || holder === undefined) {
    return undefined;
  }
  return { place: `${first.module}:${lineAt(holder.text, first.at)}`, others: others.length };
}

export function placeSources(
  app: App,
  sources: Iterable<string>,
): Map<string, Location | undefined> {
  return new Map([...new Set(sources)].map((source) => [source, placeSource(app, source)]));
}

export function amount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function plural(count: number, word: string, words = `${word}s`): string {
  return `${amount(count)} ${count === 1 ? word : words}`;
}

export function ms(value: number): string {
  return `${value.toFixed(1)}ms`;
}

export function share(part: number, whole: number): string {
  return whole === 0 ? '0%' : `${Math.round((part / whole) * PERCENT)}%`;
}

function where(source: string, places: Places): string {
  const location = places.get(source);
  if (location === undefined) {
    return 'not found in the bundle';
  }
  if (location.others === 0) {
    return location.place;
  }
  return `${location.place}, or one of ${location.others} other places with the same code`;
}

function ranked(counts: Record<string, number>): [string, number][] {
  return Object.entries(counts)
    .filter(([, value]) => value > 0)
    .toSorted((a, b) => b[1] - a[1]);
}

function reasonsOf(entry: ComponentSummary): string {
  return ranked(entry.reasons)
    .map(([reason, value]) => {
      if (reason !== 'props') {
        return `${reason} ${amount(value)}`;
      }
      const keys = ranked(entry.props)
        .slice(0, SHOWN_PROPS)
        .map(([key, times]) => `${key} ${amount(times)}`);
      return `props ${amount(value)}${keys.length > 0 ? ` (${keys.join(', ')})` : ''}`;
    })
    .join(', ');
}

export function formatComponent(entry: ComponentSummary, places: Places): string {
  const unchanged = unchangedOf(entry);
  const copies =
    entry.copies > 1
      ? `; ${amount(entry.copies)} separate functions with this code rendered, so the component is created anew`
      : '';
  return `${entry.name} (${where(entry.source, places)}): ${plural(entry.renders, 'render')}, ${amount(unchanged)} (${share(unchanged, entry.renders)}) with nothing changed but the parent, ${ms(entry.selfMs)} self; causes: ${reasonsOf(entry)}${copies}`;
}

export function formatUnchanged(
  summary: { unchanged: number; renders: number },
  subject: string,
  verb: string,
): string {
  return `${amount(summary.unchanged)} ${subject} (${share(summary.unchanged, summary.renders)}) ${verb} nothing changed: the parent rendered and props, state and context stayed equal`;
}

export function formatCost(summary: { renderMs: number; walkMs: number }): string {
  return `React measured ${ms(summary.renderMs)} of render time; walking the tree to record it cost ${ms(summary.walkMs)} more`;
}

export const ACTIVITY_MEANING = `each commit is tagged with what Droid was doing: typing (a key arrived in the last ${TYPING_MS}ms), streaming (a session receives reply text), tool (a tool runs or waits for approval), working (a session is busy otherwise, such as thinking or compacting), idle (none of these)`;

export function formatActivities(activities: Activities, commits: number): string[] {
  const entries = [...activities]
    .filter(([, entry]) => entry.commits > 0)
    .toSorted((a, b) => b[1].commits - a[1].commits);
  if (entries.every(([name]) => name === UNKNOWN_ACTIVITY)) {
    return [];
  }
  const parts = entries.map(
    ([name, entry]) =>
      `${name} ${amount(entry.commits)} (${share(entry.commits, commits)}) with ${ms(entry.renderMs)} of render time and ${plural(entry.renders, 'component render')}`,
  );
  return [`commits by what Droid was doing: ${parts.join('; ')}`];
}

function snippet(detail: string): string {
  return JSON.stringify(
    detail.length > SNIPPET_CHARS ? `${detail.slice(0, SNIPPET_CHARS)}…` : detail,
  );
}

function readsStore(label: HookLabel | undefined): label is HookLabel {
  return label !== undefined && (label[0] === MESSAGES_HOOK || label[0] === STORE_HOOK);
}

function hookWords(label: HookLabel | undefined, places: Places): string {
  if (label === undefined) {
    return 'not described';
  }
  const [kind, detail] = label;
  if (readsStore(label)) {
    const found =
      places.get(detail) === undefined
        ? ', not found in the bundle'
        : ` at ${where(detail, places)}`;
    const reader = `useSyncExternalStore reading ${snippet(detail)}${found}`;
    return kind === MESSAGES_HOOK ? `the message snapshot, a ${reader}` : `a ${reader}`;
  }
  return kind === STATE_HOOK ? `useState or useReducer holding ${detail}` : `${kind} ${detail}`;
}

function formatHooks(entry: ComponentSummary, places: Places): string[] {
  const shown = ranked(entry.hooks).slice(0, SHOWN_HOOKS);
  if (shown.length === 0) {
    return [];
  }
  const parts = shown.map(
    ([index, times]) =>
      `hook ${index} (${hookWords(entry.hookLabels[index], places)}) ${amount(times)}`,
  );
  return [`state hooks that changed, by place in the hook list: ${parts.join('; ')}`];
}

export function isMessageCause(key: string): boolean {
  return key.split(REASON_JOIN).some((part) => MESSAGE_EVENTS.has(part));
}

function causeWords(key: string): string {
  if (key === '') {
    return 'no recorded event';
  }
  if (key === FIRST_CAUSE) {
    return 'a first or new session';
  }
  return key.split(REASON_JOIN).join(' + ');
}

function totalOf(counts: Record<string, number>): number {
  return Object.values(counts).reduce((total, value) => total + value, 0);
}

function formatSnapshots(entry: ComponentSummary): string[] {
  const changes = totalOf(entry.snapshots);
  if (changes === 0) {
    return [];
  }
  const quiet = Object.entries(entry.snapshots)
    .filter(([key]) => !isMessageCause(key))
    .reduce((count, [, value]) => count + value, 0);
  const same = totalOf(entry.sameSnapshots);
  const shown = ranked(entry.snapshots)
    .slice(0, SHOWN_CAUSES)
    .map(([key, times]) => `${causeWords(key)} ${amount(times)}`);
  return [
    `message snapshot changes: ${amount(changes)}, by the store events since the one before: ${shown.join(', ')}`,
    `${amount(quiet)} of them (${share(quiet, changes)}) came with no message event (no ${MESSAGE_EVENT}, no reply text), and ${amount(same)} of those held the same messages by a cheap check (same ids, same blocks or block text lengths)`,
  ];
}

function formatActivityShare(entry: ComponentSummary): string[] {
  const shown = ranked(entry.activityRenders);
  if (shown.every(([name]) => name === UNKNOWN_ACTIVITY)) {
    return [];
  }
  const parts = shown.map(
    ([name, times]) => `${name} ${amount(times)} (${ms(entry.activityMs[name] ?? 0)} self)`,
  );
  return [`renders by activity: ${parts.join(', ')}`];
}

function hookSources(components: readonly ComponentSummary[]): string[] {
  return components
    .flatMap((entry) => Object.keys(entry.hooks).map((index) => entry.hookLabels[index]))
    .filter((label) => readsStore(label))
    .map(([, detail]) => detail);
}

export function placeShown(
  binary: string,
  lists: readonly (readonly ComponentSummary[])[],
  top: number,
): Map<string, Location | undefined> {
  const shown = lists.flatMap((components) => components.slice(0, top));
  if (shown.length === 0) {
    return new Map();
  }
  return placeSources(readApp(readFileSync(binary)), [
    ...shown.map((entry) => entry.source),
    ...hookSources(shown),
  ]);
}

function formatDetails(entry: ComponentSummary, places: Places): string[] {
  return [
    ...formatActivityShare(entry),
    ...formatHooks(entry, places),
    ...formatSnapshots(entry),
  ].map((line) => `${DETAIL_INDENT}${line}`);
}

export function formatRanked(
  components: readonly ComponentSummary[],
  places: Places,
  top: number,
): string[] {
  const lines: string[] = [];
  for (const [index, entry] of components.slice(0, top).entries()) {
    lines.push(
      `  ${index + 1}. ${formatComponent(entry, places)}`,
      ...formatDetails(entry, places),
    );
  }
  return lines;
}

export function formatWindow(summary: WindowSummary, places: Places, top: number): string[] {
  const head = `${summary.name}: median of ${plural(summary.runs, 'run')}, ${amount(summary.commits)} commits, ${amount(summary.renders)} component renders`;
  if (summary.renders === 0) {
    return [`${head}; nothing rendered`];
  }
  return [
    `${head}, ${formatUnchanged(summary, 'of them', 'with')}`,
    formatCost(summary),
    ...formatActivities(summary.activities, summary.commits),
    ...formatRanked(summary.components, places, top),
  ];
}
