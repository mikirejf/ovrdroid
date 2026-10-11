import { fieldsOf, hasNumbers, isObject, parseJson } from './fields.ts';
import type { ComponentSummary, Location } from './renders.ts';
import {
  addInto,
  emptyTally,
  formatCost,
  formatRanked,
  formatUnchanged,
  plural,
  unchangedOf,
} from './renders.ts';

const DAY_DIGITS = 2;

export interface DayComponent {
  name: string;
  source: string;
  renders: number;
  selfMs: number;
  reasons: Record<string, number>;
  props: Record<string, number>;
}

export interface DayFile {
  pid: number;
  day: string;
  commits: number;
  renderMs: number;
  walkMs: number;
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
  components: ComponentSummary[];
}

function isCounts(value: unknown): value is Record<string, number> {
  return (
    isObject(value) &&
    !Array.isArray(value) &&
    Object.values(value).every((count) => Number.isFinite(count))
  );
}

function isDayComponent(value: unknown): value is DayComponent {
  const fields = fieldsOf(value);
  return (
    typeof fields.get('name') === 'string' &&
    typeof fields.get('source') === 'string' &&
    hasNumbers(fields, ['renders', 'selfMs']) &&
    isCounts(fields.get('reasons')) &&
    isCounts(fields.get('props'))
  );
}

function isDayFile(value: unknown): value is DayFile {
  const fields = fieldsOf(value);
  const components = fields.get('components');
  return (
    typeof fields.get('day') === 'string' &&
    hasNumbers(fields, ['pid', 'commits', 'renderMs', 'walkMs']) &&
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

function summed(components: Iterable<DayComponent>): ComponentSummary[] {
  const bySource = new Map<string, ComponentSummary>();
  for (const component of components) {
    const entry = bySource.get(component.source) ?? {
      name: component.name,
      source: component.source,
      ...emptyTally(),
      copies: 1,
    };
    bySource.set(component.source, entry);
    addInto(entry, component);
  }
  return [...bySource.values()].toSorted((a, b) => b.selfMs - a.selfMs);
}

export function sumDays(files: readonly DayFile[]): LogSummary {
  const components = summed(files.flatMap((file) => file.components));
  return {
    days: [...new Set(files.map((file) => file.day))].toSorted(),
    processes: new Set(files.map((file) => file.pid)).size,
    commits: files.reduce((sum, file) => sum + file.commits, 0),
    renders: components.reduce((sum, entry) => sum + entry.renders, 0),
    unchanged: components.reduce((sum, entry) => sum + unchangedOf(entry), 0),
    renderMs: files.reduce((sum, file) => sum + file.renderMs, 0),
    walkMs: files.reduce((sum, file) => sum + file.walkMs, 0),
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
    ...formatRanked(summary.components, places, top),
  ];
}
