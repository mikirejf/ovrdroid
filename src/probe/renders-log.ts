import { fieldsOf, hasNumbers, isObject, parseJson } from './fields.ts';
import { isHookLabel } from './renders-parse.ts';
import type { Location } from './renders-print.ts';
import {
  formatActivities,
  formatCost,
  formatRanked,
  formatUnchanged,
  plural,
} from './renders-print.ts';
import type {
  Activities,
  ActivityTally,
  ComponentSummary,
  ComponentTally,
  HookLabel,
} from './renders.ts';
import { addActivity, addInto, emptyTally, unchangedOf } from './renders.ts';

const DAY_DIGITS = 2;

type ActivityRow = readonly [renders: number, selfMs: number];

export interface DayComponent {
  name: string;
  source: string;
  renders: number;
  selfMs: number;
  reasons: Record<string, number>;
  props: Record<string, number>;
  activities?: Record<string, ActivityRow>;
  hooks?: Record<string, number>;
  hookLabels?: Record<string, HookLabel>;
  snapshots?: Record<string, number>;
  sameSnapshots?: Record<string, number>;
}

export interface DayFile {
  pid: number;
  day: string;
  commits: number;
  renderMs: number;
  walkMs: number;
  activities?: Record<string, ActivityTally>;
  components: DayComponent[];
}

interface LogSummary {
  days: string[];
  processes: number;
  commits: number;
  renders: number;
  unchanged: number;
  renderMs: number;
  walkMs: number;
  activities: Activities;
  components: ComponentSummary[];
}

function isRecordOf(value: unknown, guard: (entry: unknown) => boolean): boolean {
  return (
    isObject(value) && !Array.isArray(value) && Object.values(value).every((entry) => guard(entry))
  );
}

function isCount(value: unknown): value is number {
  return Number.isFinite(value);
}

function isCounts(value: unknown): value is Record<string, number> {
  return isRecordOf(value, isCount);
}

function isActivityRow(value: unknown): value is ActivityRow {
  return Array.isArray(value) && value.length === 2 && value.every((entry) => isCount(entry));
}

function isActivityTally(value: unknown): value is ActivityTally {
  return hasNumbers(fieldsOf(value), ['commits', 'renderMs', 'renders']);
}

function isAbsentOr(value: unknown, guard: (entry: unknown) => boolean): boolean {
  return value === undefined || guard(value);
}

function isDayComponent(value: unknown): value is DayComponent {
  const fields = fieldsOf(value);
  return (
    typeof fields.get('name') === 'string' &&
    typeof fields.get('source') === 'string' &&
    hasNumbers(fields, ['renders', 'selfMs']) &&
    isCounts(fields.get('reasons')) &&
    isCounts(fields.get('props')) &&
    isAbsentOr(fields.get('activities'), (entry) => isRecordOf(entry, isActivityRow)) &&
    isAbsentOr(fields.get('hookLabels'), (entry) => isRecordOf(entry, isHookLabel)) &&
    ['hooks', 'snapshots', 'sameSnapshots'].every((name) => isAbsentOr(fields.get(name), isCounts))
  );
}

function isDayFile(value: unknown): value is DayFile {
  const fields = fieldsOf(value);
  const components = fields.get('components');
  return (
    typeof fields.get('day') === 'string' &&
    hasNumbers(fields, ['pid', 'commits', 'renderMs', 'walkMs']) &&
    isAbsentOr(fields.get('activities'), (entry) => isRecordOf(entry, isActivityTally)) &&
    Array.isArray(components) &&
    components.every((entry) => isDayComponent(entry))
  );
}

export function parseDayFile(text: string): DayFile | undefined {
  return parseJson(text, isDayFile);
}

function localDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(DAY_DIGITS, '0');
  const day = String(date.getDate()).padStart(DAY_DIGITS, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function recentDays(today: Date, days: number): string[] {
  return Array.from({ length: days }, (_, back) =>
    localDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - back)),
  ).toReversed();
}

function tallyOf(component: DayComponent): ComponentTally {
  const activities = Object.entries(component.activities ?? {});
  return {
    renders: component.renders,
    selfMs: component.selfMs,
    reasons: component.reasons,
    props: component.props,
    hooks: component.hooks ?? {},
    snapshots: component.snapshots ?? {},
    sameSnapshots: component.sameSnapshots ?? {},
    activityRenders: Object.fromEntries(activities.map(([name, [renders]]) => [name, renders])),
    activityMs: Object.fromEntries(activities.map(([name, [, selfMs]]) => [name, selfMs])),
  };
}

function summed(components: Iterable<DayComponent>): ComponentSummary[] {
  const bySource = new Map<string, ComponentSummary>();
  for (const component of components) {
    const entry = bySource.get(component.source) ?? {
      name: component.name,
      source: component.source,
      hookLabels: {},
      ...emptyTally(),
      copies: 1,
    };
    bySource.set(component.source, entry);
    Object.assign(entry.hookLabels, component.hookLabels);
    addInto(entry, tallyOf(component));
  }
  return [...bySource.values()].toSorted((a, b) => b.selfMs - a.selfMs);
}

export function sumDays(files: readonly DayFile[]): LogSummary {
  const components = summed(files.flatMap((file) => file.components));
  const activities: Activities = new Map();
  for (const file of files) {
    for (const [name, entry] of Object.entries(file.activities ?? {})) {
      addActivity(activities, name, entry);
    }
  }
  return {
    days: [...new Set(files.map((file) => file.day))].toSorted(),
    processes: new Set(files.map((file) => file.pid)).size,
    commits: files.reduce((sum, file) => sum + file.commits, 0),
    renders: components.reduce((sum, entry) => sum + entry.renders, 0),
    unchanged: components.reduce((sum, entry) => sum + unchangedOf(entry), 0),
    renderMs: files.reduce((sum, file) => sum + file.renderMs, 0),
    walkMs: files.reduce((sum, file) => sum + file.walkMs, 0),
    activities,
    components,
  };
}

function span(days: readonly string[]): string {
  const first = days.at(0);
  const last = days.at(-1);
  return first === last ? `on ${first}` : `from ${first} to ${last}`;
}

export function formatLog(
  summary: LogSummary,
  places: ReadonlyMap<string, Location | undefined>,
  top: number,
): string[] {
  if (summary.commits === 0) {
    return ['no recorded renders in these days'];
  }
  return [
    `${plural(summary.days.length, 'day')} with recordings ${span(summary.days)}: ${plural(summary.processes, 'Droid process', 'Droid processes')}, ${plural(summary.commits, 'commit')}, ${plural(summary.renders, 'component render')}`,
    formatUnchanged(summary, 'of the renders', 'had'),
    formatCost(summary),
    ...formatActivities(summary.activities, summary.commits),
    ...formatRanked(summary.components, places, top),
  ];
}
