import type { App } from '../binary/graph.ts';
import { quantile } from './ab.ts';
import type { Span } from './counters.ts';
import { fieldsOf, hasNumbers, parseJsonLines } from './fields.ts';
import { findPlaces, moduleHolding } from './search.ts';

const MEDIAN = 0.5;
const PERCENT = 100;
const SHOWN_PROPS = 3;

export const NOTHING_CHANGED = 'parent';
const REASON_JOIN = '+';

export type RenderTuple = readonly [
  id: number,
  selfMs: number,
  reason: string,
  changedProps?: readonly string[],
];

export type TypeEntry = readonly [id: number, name: string, source: string];

export interface CommitLine {
  t: number;
  pid: number;
  renderMs: number;
  walkMs: number;
  renders: readonly RenderTuple[];
  types?: readonly TypeEntry[];
}

interface ComponentType {
  name: string;
  source: string;
}

interface ComponentTally {
  renders: number;
  selfMs: number;
  reasons: Record<string, number>;
  props: Record<string, number>;
}

export interface RenderWindow {
  commits: number;
  renderMs: number;
  walkMs: number;
  components: ReadonlyMap<number, ComponentTally>;
  types: ReadonlyMap<number, ComponentType>;
}

export interface ComponentSummary extends ComponentTally, ComponentType {
  copies: number;
}

interface WindowSummary {
  name: string;
  runs: number;
  commits: number;
  renders: number;
  unchanged: number;
  renderMs: number;
  walkMs: number;
  components: ComponentSummary[];
}

export interface Location {
  place: string;
  others: number;
}

function isList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isStringList(value: unknown): value is readonly string[] {
  return isList(value) && value.every((entry) => typeof entry === 'string');
}

function isRenderTuple(value: unknown): value is RenderTuple {
  if (!isList(value) || value.length < 3 || value.length > 4) {
    return false;
  }
  const [id, selfMs, reason, keys] = value;
  return (
    Number.isInteger(id) &&
    typeof selfMs === 'number' &&
    typeof reason === 'string' &&
    (keys === undefined || isStringList(keys))
  );
}

function isTypeEntry(value: unknown): value is TypeEntry {
  if (!isList(value) || value.length !== 3) {
    return false;
  }
  const [id, name, source] = value;
  return Number.isInteger(id) && typeof name === 'string' && typeof source === 'string';
}

function isCommitLine(value: unknown): value is CommitLine {
  const fields = fieldsOf(value);
  const renders = fields.get('renders');
  const types = fields.get('types');
  return (
    hasNumbers(fields, ['t', 'pid', 'renderMs', 'walkMs']) &&
    isList(renders) &&
    renders.every((entry) => isRenderTuple(entry)) &&
    (types === undefined || (isList(types) && types.every((entry) => isTypeEntry(entry))))
  );
}

export function parseRenders(text: string): CommitLine[] {
  return parseJsonLines(text, isCommitLine);
}

export function typesOf(lines: readonly CommitLine[]): Map<number, ComponentType> {
  return new Map(
    lines.flatMap((line) => line.types ?? []).map(([id, name, source]) => [id, { name, source }]),
  );
}

export function emptyTally(): ComponentTally {
  return { renders: 0, selfMs: 0, reasons: {}, props: {} };
}

function bump(counts: Record<string, number>, key: string, by = 1): void {
  counts[key] = (counts[key] ?? 0) + by;
}

export function unchangedOf(entry: { reasons: Record<string, number> }): number {
  return entry.reasons[NOTHING_CHANGED] ?? 0;
}

function tally(components: Map<number, ComponentTally>, render: RenderTuple): void {
  const [id, selfMs, reason, keys = []] = render;
  const entry = components.get(id) ?? emptyTally();
  components.set(id, entry);
  entry.renders += 1;
  entry.selfMs += selfMs;
  for (const part of reason.split(REASON_JOIN)) {
    bump(entry.reasons, part);
  }
  for (const key of keys) {
    bump(entry.props, key);
  }
}

export function renderWindow(
  lines: readonly CommitLine[],
  { from, to }: Span,
  types: ReadonlyMap<number, ComponentType> = typesOf(lines),
): RenderWindow {
  const inside = lines.filter((line) => line.t >= from && line.t <= to);
  const components = new Map<number, ComponentTally>();
  for (const line of inside) {
    for (const render of line.renders) {
      if (!types.has(render[0])) {
        throw new Error(`a render names component type ${render[0]}, which no line described`);
      }
      tally(components, render);
    }
  }
  return {
    commits: inside.length,
    renderMs: inside.reduce((sum, line) => sum + line.renderMs, 0),
    walkMs: inside.reduce((sum, line) => sum + line.walkMs, 0),
    components,
    types,
  };
}

export function renderWindows(
  lines: readonly CommitLine[],
  spans: Record<string, Span>,
): Record<string, RenderWindow> {
  const types = typesOf(lines);
  return Object.fromEntries(
    Object.entries(spans).map(([name, span]) => [name, renderWindow(lines, span, types)]),
  );
}

interface SourceTally {
  name: string;
  copies: number;
  tally: ComponentTally;
}

export function addInto(target: ComponentTally, entry: ComponentTally): void {
  target.renders += entry.renders;
  target.selfMs += entry.selfMs;
  for (const [key, value] of Object.entries(entry.reasons)) {
    bump(target.reasons, key, value);
  }
  for (const [key, value] of Object.entries(entry.props)) {
    bump(target.props, key, value);
  }
}

function bySource(window: RenderWindow): Map<string, SourceTally> {
  const sources = new Map<string, SourceTally>();
  for (const [id, entry] of window.components) {
    const type = window.types.get(id);
    if (type === undefined) {
      throw new Error(`component type ${id} has no description`);
    }
    const found = sources.get(type.source) ?? { name: type.name, copies: 0, tally: emptyTally() };
    sources.set(type.source, found);
    found.copies += 1;
    addInto(found.tally, entry);
  }
  return sources;
}

function median(values: readonly number[]): number {
  return quantile(values, MEDIAN);
}

function medianCounts(maps: readonly Record<string, number>[]): Record<string, number> {
  const keys = new Set(maps.flatMap((map) => Object.keys(map)));
  return Object.fromEntries(
    [...keys].map((key) => [key, median(maps.map((map) => map[key] ?? 0))]),
  );
}

function totals(window: RenderWindow) {
  const tallies = [...window.components.values()];
  return {
    renders: tallies.reduce((sum, entry) => sum + entry.renders, 0),
    unchanged: tallies.reduce((sum, entry) => sum + unchangedOf(entry), 0),
  };
}

function summariseComponent(
  source: string,
  runs: readonly ReadonlyMap<string, SourceTally>[],
): ComponentSummary {
  const found = runs.map((run) => run.get(source));
  const name = found.find((entry) => entry !== undefined)?.name ?? '';
  const tallies = found.map((entry) => entry?.tally ?? emptyTally());
  return {
    name,
    source,
    copies: median(found.map((entry) => entry?.copies ?? 0)),
    renders: median(tallies.map((entry) => entry.renders)),
    selfMs: median(tallies.map((entry) => entry.selfMs)),
    reasons: medianCounts(tallies.map((entry) => entry.reasons)),
    props: medianCounts(tallies.map((entry) => entry.props)),
  };
}

export function summariseWindows(name: string, windows: readonly RenderWindow[]): WindowSummary {
  if (windows.length === 0) {
    throw new Error(`the ${name} summary needs at least one run`);
  }
  const runs = windows.map((window) => bySource(window));
  const sources = new Set(runs.flatMap((run) => [...run.keys()]));
  const components = [...sources]
    .map((source) => summariseComponent(source, runs))
    .filter((entry) => entry.renders > 0)
    .toSorted((a, b) => b.selfMs - a.selfMs || b.renders - a.renders);
  const counted = windows.map((window) => totals(window));
  return {
    name,
    runs: windows.length,
    commits: median(windows.map((window) => window.commits)),
    renders: median(counted.map((entry) => entry.renders)),
    unchanged: median(counted.map((entry) => entry.unchanged)),
    renderMs: median(windows.map((window) => window.renderMs)),
    walkMs: median(windows.map((window) => window.walkMs)),
    components,
  };
}

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

function where(source: string, places: ReadonlyMap<string, Location | undefined>): string {
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

function causes(entry: ComponentSummary): string {
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

export function formatComponent(
  entry: ComponentSummary,
  places: ReadonlyMap<string, Location | undefined>,
): string {
  const unchanged = unchangedOf(entry);
  const copies =
    entry.copies > 1
      ? `; ${amount(entry.copies)} separate functions with this code rendered, so the component is created anew`
      : '';
  return `${entry.name} (${where(entry.source, places)}): ${plural(entry.renders, 'render')}, ${amount(unchanged)} (${share(unchanged, entry.renders)}) with nothing changed but the parent, ${ms(entry.selfMs)} self; causes: ${causes(entry)}${copies}`;
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

export function formatRanked(
  components: readonly ComponentSummary[],
  places: ReadonlyMap<string, Location | undefined>,
  top: number,
): string[] {
  return components
    .slice(0, top)
    .map((entry, index) => `  ${index + 1}. ${formatComponent(entry, places)}`);
}

export function formatWindow(
  summary: WindowSummary,
  places: ReadonlyMap<string, Location | undefined>,
  top: number,
): string[] {
  const head = `${summary.name}: median of ${plural(summary.runs, 'run')}, ${amount(summary.commits)} commits, ${amount(summary.renders)} component renders`;
  if (summary.renders === 0) {
    return [`${head}; nothing rendered`];
  }
  return [
    `${head}, ${formatUnchanged(summary, 'of them', 'with')}`,
    formatCost(summary),
    ...formatRanked(summary.components, places, top),
  ];
}
