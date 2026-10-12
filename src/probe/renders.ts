import { quantile } from './ab.ts';
import type { Span } from './counters.ts';

const MEDIAN = 0.5;

export const NOTHING_CHANGED = 'parent';
export const REASON_JOIN = '+';
export const UNKNOWN_ACTIVITY = 'unknown';

export type SnapshotCause = readonly [causes: string, same: number];

export type RenderTuple = readonly [
  id: number,
  selfMs: number,
  reason: string,
  changedProps?: readonly string[],
  hooks?: readonly number[],
  snapshot?: SnapshotCause,
];

export type TypeEntry = readonly [id: number, name: string, source: string];

export type HookLabel = readonly [kind: string, detail: string];

export type HookType = readonly [id: number, index: number, kind: string, detail: string];

export interface CommitLine {
  t: number;
  pid: number;
  renderMs: number;
  walkMs: number;
  activity?: string;
  renders: readonly RenderTuple[];
  types?: readonly TypeEntry[];
  hookTypes?: readonly HookType[];
}

interface ComponentType {
  name: string;
  source: string;
  hookLabels: Record<string, HookLabel>;
}

export interface ComponentTally {
  renders: number;
  selfMs: number;
  reasons: Record<string, number>;
  props: Record<string, number>;
  hooks: Record<string, number>;
  snapshots: Record<string, number>;
  sameSnapshots: Record<string, number>;
  activityRenders: Record<string, number>;
  activityMs: Record<string, number>;
}

export interface ActivityTally {
  commits: number;
  renderMs: number;
  renders: number;
}

export type Activities = Map<string, ActivityTally>;

export interface RenderWindow {
  commits: number;
  renderMs: number;
  walkMs: number;
  activities: Activities;
  components: ReadonlyMap<number, ComponentTally>;
  types: ReadonlyMap<number, ComponentType>;
}

export interface ComponentSummary extends ComponentTally, ComponentType {
  copies: number;
}

export interface WindowSummary {
  name: string;
  runs: number;
  commits: number;
  renders: number;
  unchanged: number;
  renderMs: number;
  walkMs: number;
  activities: Activities;
  components: ComponentSummary[];
}

export function typesOf(lines: readonly CommitLine[]): Map<number, ComponentType> {
  const types = new Map<number, ComponentType>(
    lines
      .flatMap((line) => line.types ?? [])
      .map(([id, name, source]) => [id, { name, source, hookLabels: {} }]),
  );
  for (const [id, index, kind, detail] of lines.flatMap((line) => line.hookTypes ?? [])) {
    const type = types.get(id);
    if (type !== undefined) {
      type.hookLabels[index] = [kind, detail];
    }
  }
  return types;
}

export function emptyTally(): ComponentTally {
  return {
    renders: 0,
    selfMs: 0,
    reasons: {},
    props: {},
    hooks: {},
    snapshots: {},
    sameSnapshots: {},
    activityRenders: {},
    activityMs: {},
  };
}

function bump(counts: Record<string, number>, key: string | number, by = 1): void {
  counts[key] = (counts[key] ?? 0) + by;
}

function addCounts(target: Record<string, number>, source: Record<string, number>): void {
  for (const [key, value] of Object.entries(source)) {
    bump(target, key, value);
  }
}

export function unchangedOf(entry: { reasons: Record<string, number> }): number {
  return entry.reasons[NOTHING_CHANGED] ?? 0;
}

function tally(
  components: Map<number, ComponentTally>,
  render: RenderTuple,
  activity: string,
): void {
  const [id, selfMs, reason, keys = [], hooks = [], snapshot] = render;
  const entry = components.get(id) ?? emptyTally();
  components.set(id, entry);
  entry.renders += 1;
  entry.selfMs += selfMs;
  bump(entry.activityRenders, activity);
  bump(entry.activityMs, activity, selfMs);
  for (const part of reason.split(REASON_JOIN)) {
    bump(entry.reasons, part);
  }
  for (const key of keys) {
    bump(entry.props, key);
  }
  for (const index of hooks) {
    bump(entry.hooks, index);
  }
  if (snapshot !== undefined) {
    bump(entry.snapshots, snapshot[0]);
    bump(entry.sameSnapshots, snapshot[0], snapshot[1]);
  }
}

export function addActivity(target: Activities, name: string, entry: ActivityTally): void {
  const found = target.get(name) ?? { commits: 0, renderMs: 0, renders: 0 };
  target.set(name, found);
  found.commits += entry.commits;
  found.renderMs += entry.renderMs;
  found.renders += entry.renders;
}

export function renderWindow(
  lines: readonly CommitLine[],
  { from, to }: Span,
  types: ReadonlyMap<number, ComponentType> = typesOf(lines),
): RenderWindow {
  const inside = lines.filter((line) => line.t >= from && line.t <= to);
  const components = new Map<number, ComponentTally>();
  const activities: Activities = new Map();
  for (const line of inside) {
    const activity = line.activity ?? UNKNOWN_ACTIVITY;
    addActivity(activities, activity, {
      commits: 1,
      renderMs: line.renderMs,
      renders: line.renders.length,
    });
    for (const render of line.renders) {
      if (!types.has(render[0])) {
        throw new Error(`a render names component type ${render[0]}, which no line described`);
      }
      tally(components, render, activity);
    }
  }
  return {
    commits: inside.length,
    renderMs: inside.reduce((sum, line) => sum + line.renderMs, 0),
    walkMs: inside.reduce((sum, line) => sum + line.walkMs, 0),
    activities,
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
  hookLabels: Record<string, HookLabel>;
  tally: ComponentTally;
}

const COUNT_FIELDS = [
  'reasons',
  'props',
  'hooks',
  'snapshots',
  'sameSnapshots',
  'activityRenders',
  'activityMs',
] as const;

export function addInto(target: ComponentTally, entry: ComponentTally): void {
  target.renders += entry.renders;
  target.selfMs += entry.selfMs;
  for (const field of COUNT_FIELDS) {
    addCounts(target[field], entry[field]);
  }
}

function bySource(window: RenderWindow): Map<string, SourceTally> {
  const sources = new Map<string, SourceTally>();
  for (const [id, entry] of window.components) {
    const type = window.types.get(id);
    if (type === undefined) {
      throw new Error(`component type ${id} has no description`);
    }
    const found = sources.get(type.source) ?? {
      name: type.name,
      copies: 0,
      hookLabels: {},
      tally: emptyTally(),
    };
    sources.set(type.source, found);
    found.copies += 1;
    Object.assign(found.hookLabels, type.hookLabels);
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
  const tallies = found.map((entry) => entry?.tally ?? emptyTally());
  const hookLabels: Record<string, HookLabel> = {};
  for (const entry of found) {
    Object.assign(hookLabels, entry?.hookLabels);
  }
  const counts = (field: (typeof COUNT_FIELDS)[number]): Record<string, number> =>
    medianCounts(tallies.map((entry) => entry[field]));
  return {
    name: found.find((entry) => entry !== undefined)?.name ?? '',
    source,
    hookLabels,
    copies: median(found.map((entry) => entry?.copies ?? 0)),
    renders: median(tallies.map((entry) => entry.renders)),
    selfMs: median(tallies.map((entry) => entry.selfMs)),
    reasons: counts('reasons'),
    props: counts('props'),
    hooks: counts('hooks'),
    snapshots: counts('snapshots'),
    sameSnapshots: counts('sameSnapshots'),
    activityRenders: counts('activityRenders'),
    activityMs: counts('activityMs'),
  };
}

function medianActivities(windows: readonly RenderWindow[]): Activities {
  const names = new Set(windows.flatMap((window) => [...window.activities.keys()]));
  return new Map(
    [...names].map((name) => {
      const entries = windows.map(
        (window) => window.activities.get(name) ?? { commits: 0, renderMs: 0, renders: 0 },
      );
      return [
        name,
        {
          commits: median(entries.map((entry) => entry.commits)),
          renderMs: median(entries.map((entry) => entry.renderMs)),
          renders: median(entries.map((entry) => entry.renders)),
        },
      ];
    }),
  );
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
    activities: medianActivities(windows),
    components,
  };
}
