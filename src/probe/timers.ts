import { MS_PER_SECOND } from '../cli.ts';
import { perMinute } from './idle.ts';

const KINDS = ['interval', 'timeout'] as const;
const EVENTS = ['arm', 'fire'] as const;

export type TimerKind = (typeof KINDS)[number];
export type TimerEvent = (typeof EVENTS)[number];

export interface TimerRow {
  atMs: number;
  pid: number;
  event: TimerEvent;
  kind: TimerKind;
  delayMs: number;
  site: string;
}

export interface TimerCost {
  kind: TimerKind;
  delayMs: number;
  site: string;
  fires: number;
  firesPerMinute: number;
}

export interface TimerReport {
  windowMs: number;
  armed: number;
  fires: number;
  firesPerMinute: number;
  costs: readonly TimerCost[];
}

const COLUMNS = 6;
const SITE_WIDTH = 78;

function parseLine(line: string): TimerRow | undefined {
  const parts = line.split('\t');
  if (parts.length !== COLUMNS) {
    return undefined;
  }
  const [at = '', pid = '', rawEvent = '', rawKind = '', delay = '', site = ''] = parts;
  const atMs = Number(at);
  const event = EVENTS.find((known) => known === rawEvent);
  const kind = KINDS.find((known) => known === rawKind);
  if (Number.isNaN(atMs) || event === undefined || kind === undefined) {
    return undefined;
  }
  return { atMs, pid: Number(pid), event, kind, delayMs: Number(delay), site };
}

export function parseTimers(text: string): TimerReport {
  const rows = text
    .split('\n')
    .map((line) => parseLine(line))
    .filter((row) => row !== undefined);

  const fires = rows.filter((row) => row.event === 'fire');
  const first = fires.at(0)?.atMs ?? 0;
  const last = fires.at(-1)?.atMs ?? 0;
  const windowMs = Math.max(0, last - first);

  const grouped = new Map<string, TimerCost>();
  for (const row of fires) {
    const key = `${row.kind}\t${row.delayMs}\t${row.site}`;
    const found = grouped.get(key) ?? {
      kind: row.kind,
      delayMs: row.delayMs,
      site: row.site,
      fires: 0,
      firesPerMinute: 0,
    };
    found.fires += 1;
    grouped.set(key, found);
  }

  const costs = [...grouped.values()];
  for (const cost of costs) {
    cost.firesPerMinute = perMinute(cost.fires, windowMs);
  }

  return {
    windowMs,
    armed: rows.filter((row) => row.event === 'arm').length,
    fires: fires.length,
    firesPerMinute: perMinute(fires.length, windowMs),
    costs: costs.toSorted((a, b) => b.fires - a.fires),
  };
}

export function formatTimers(costs: readonly TimerCost[]): string {
  return costs
    .map((cost) =>
      [
        cost.fires.toFixed(0).padStart(6),
        cost.firesPerMinute.toFixed(0).padStart(8),
        cost.kind.padEnd(8),
        `${cost.delayMs}ms`.padStart(9),
        cost.site.slice(0, SITE_WIDTH),
      ].join('  '),
    )
    .join('\n');
}

export const TIMERS_HEADER = [
  'fires'.padStart(6),
  'per min'.padStart(8),
  'kind'.padEnd(8),
  'delay'.padStart(9),
  'site',
].join('  ');

export function summariseTimers(report: TimerReport): string {
  return [
    `${report.armed} timers armed`,
    `${report.fires} fired in ${(report.windowMs / MS_PER_SECOND).toFixed(1)}s`,
    `${report.firesPerMinute.toFixed(0)} wake-ups per minute of standing by`,
  ].join(', ');
}
