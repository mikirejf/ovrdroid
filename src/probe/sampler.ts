import { megabytes, MS_PER_SECOND } from '../cli.ts';
import type { Fields } from './fields.ts';
import { entriesOf, fieldsOf, fieldsOfJson, numberAt, worded } from './fields.ts';
import { parseCpuTime } from './idle.ts';
import type { Point, Reading, ReadingView } from './series.ts';
import { describeReading, maxOf, readSeries, sumOf } from './series.ts';
import type { Parented } from './tree.ts';
import { descendants, shortCommand } from './tree.ts';

export const PS_COLUMNS = 'pid,ppid,utime,stime,rss,command';
export const BUSIEST_WINDOW_MS = 5000;

export interface TreeProcess {
  pid: number;
  ppid: number;
  cpuMs: number;
  rssKib: number;
  command: string;
  footprintKib?: number;
}

export interface Tick {
  atMs: number;
  root: number;
  threads: number;
  processes: TreeProcess[];
}

export interface Busiest {
  cores: number;
  fromMs: number;
}

export interface CpuUse {
  cpuSeconds: number;
  averageCores: number;
  busiest: Busiest;
}

export interface SampleSummary {
  startMs: number;
  windowMs: number;
  ticks: number;
  root: number;
  rootRss: Reading;
  treeRss: Reading;
  rootFootprint: Reading | undefined;
  treeFootprint: Reading | undefined;
  parentCpu: CpuUse;
  childCpu: CpuUse;
  threads: Reading;
  peakChildren: number;
  childNames: readonly string[];
}

export interface SummaryOptions {
  baselineMs?: number;
}

function rowsOf(text: string): (Parented & { cpuMs: number; rssKib: number })[] {
  const rows: (Parented & { cpuMs: number; rssKib: number })[] = [];
  for (const line of text.split('\n')) {
    const [pid = '', ppid = '', utime = '', stime = '', rss = '', ...rest] = line
      .trim()
      .split(/\s+/u);
    const user = parseCpuTime(utime);
    const system = parseCpuTime(stime);
    if (
      user === undefined ||
      system === undefined ||
      !Number.isInteger(Number(pid)) ||
      pid === ''
    ) {
      continue;
    }
    rows.push({
      pid: Number(pid),
      ppid: Number(ppid),
      command: rest.join(' '),
      cpuMs: user + system,
      rssKib: Number(rss),
    });
  }
  return rows;
}

export function threadCount(listing: string): number {
  const lines = listing.split('\n').filter((line) => line.trim() !== '');
  return Math.max(0, lines.length - 1);
}

export interface TickInputs {
  root: number;
  atMs: number;
  threads: number;
}

export function readTick(listing: string, inputs: TickInputs): Tick | undefined {
  const { root, atMs, threads } = inputs;
  const rows = rowsOf(listing);
  if (!rows.some((row) => row.pid === root)) {
    return undefined;
  }
  const wanted = new Set(descendants(rows, root));
  const processes = rows
    .filter((row) => wanted.has(row.pid))
    .map((row) => ({
      pid: row.pid,
      ppid: row.ppid,
      cpuMs: row.cpuMs,
      rssKib: row.rssKib,
      command: shortCommand(row.command),
    }));
  return { atMs, root, threads, processes };
}

export function serialiseTick(tick: Tick): string {
  return JSON.stringify({ kind: 'tick', ...tick });
}

export function serialiseFootprints(atMs: number, footprints: ReadonlyMap<number, number>): string {
  return JSON.stringify({ kind: 'footprint', atMs, kib: Object.fromEntries(footprints) });
}

function processOf(fields: Fields): TreeProcess | undefined {
  const pid = numberAt(fields, 'pid');
  const ppid = numberAt(fields, 'ppid');
  const cpuMs = numberAt(fields, 'cpuMs');
  const rssKib = numberAt(fields, 'rssKib');
  if (pid === undefined || ppid === undefined || cpuMs === undefined || rssKib === undefined) {
    return undefined;
  }
  const footprintKib = numberAt(fields, 'footprintKib');
  return {
    pid,
    ppid,
    cpuMs,
    rssKib,
    command: worded(fields, 'command'),
    ...(footprintKib !== undefined && { footprintKib }),
  };
}

export function withFootprints(tick: Tick, footprints: ReadonlyMap<number, number>): Tick {
  return {
    ...tick,
    processes: tick.processes.map((process) => {
      const footprintKib = footprints.get(process.pid);
      return footprintKib === undefined ? process : { ...process, footprintKib };
    }),
  };
}

export function parseSamples(text: string): Tick[] {
  const ticks: Tick[] = [];
  const footprints = new Map<number, Map<number, number>>();

  for (const line of text.split('\n')) {
    const fields = fieldsOfJson(line);
    const atMs = numberAt(fields, 'atMs');
    if (atMs === undefined) {
      continue;
    }
    if (worded(fields, 'kind') === 'footprint') {
      const measured = new Map<number, number>();
      for (const [pid, kib] of fieldsOf(fields.get('kib'))) {
        if (typeof kib === 'number') {
          measured.set(Number(pid), kib);
        }
      }
      footprints.set(atMs, measured);
      continue;
    }
    const root = numberAt(fields, 'root');
    const threads = numberAt(fields, 'threads');
    if (root === undefined || threads === undefined) {
      continue;
    }
    const processes = entriesOf(fields, 'processes').flatMap((entry) => {
      const parsed = processOf(entry);
      return parsed === undefined ? [] : [parsed];
    });
    ticks.push({ atMs, root, threads, processes });
  }

  return ticks
    .toSorted((a, b) => a.atMs - b.atMs)
    .map((tick) => {
      const measured = footprints.get(tick.atMs);
      return measured === undefined ? tick : withFootprints(tick, measured);
    });
}

function totalOf(values: ReadonlyMap<number, number>): number {
  return sumOf([...values.values()]);
}

export type CpuPart = 'parent' | 'children';

export function cpuSeries(allTicks: readonly Tick[], part: CpuPart): Point[] {
  const ticks = allTicks.map((tick) => ({
    ...tick,
    processes: tick.processes.filter(
      (process) => (process.pid === tick.root) === (part === 'parent'),
    ),
  }));
  const first = ticks.at(0);
  const started = new Map<number, number>();
  const latest = new Map<number, number>();

  for (const process of first?.processes ?? []) {
    started.set(process.pid, process.cpuMs);
  }

  return ticks.map((tick) => {
    for (const process of tick.processes) {
      if (!started.has(process.pid)) {
        started.set(process.pid, 0);
      }
      latest.set(process.pid, process.cpuMs);
    }
    return { t: tick.atMs, value: totalOf(latest) - totalOf(started) };
  });
}

export function busiestWindow(cpu: readonly Point[], windowMs = BUSIEST_WINDOW_MS): Busiest {
  const first = cpu.at(0);
  const last = cpu.at(-1);
  if (first === undefined || last === undefined || last.t === first.t) {
    return { cores: 0, fromMs: first?.t ?? 0 };
  }
  if (last.t - first.t < windowMs) {
    return { cores: (last.value - first.value) / (last.t - first.t), fromMs: first.t };
  }

  let best: Busiest = { cores: 0, fromMs: first.t };
  for (const end of cpu) {
    const start = cpu.findLast((point) => point.t <= end.t - windowMs);
    if (start === undefined) {
      continue;
    }
    const cores = (end.value - start.value) / (end.t - start.t);
    if (cores > best.cores) {
      best = { cores, fromMs: start.t };
    }
  }
  return best;
}

function footprintPoints(ticks: readonly Tick[], rootOnly: boolean): Point[] {
  return ticks.flatMap((tick) => {
    const measured = tick.processes.filter(
      (process) => process.footprintKib !== undefined && (!rootOnly || process.pid === tick.root),
    );
    if (measured.length === 0) {
      return [];
    }
    return [{ t: tick.atMs, value: sumOf(measured.map((process) => process.footprintKib ?? 0)) }];
  });
}

function cpuUseOf(cpu: readonly Point[], windowMs: number): CpuUse {
  const cpuMs = cpu.at(-1)?.value ?? 0;
  return {
    cpuSeconds: cpuMs / MS_PER_SECOND,
    averageCores: windowMs === 0 ? 0 : cpuMs / windowMs,
    busiest: busiestWindow(cpu),
  };
}

export function summariseTicks(
  ticks: readonly Tick[],
  options: SummaryOptions = {},
): SampleSummary | undefined {
  const first = ticks.at(0);
  const last = ticks.at(-1);
  const baselineMs = options.baselineMs ?? 0;
  const rootRss = readSeries(
    ticks.map((tick) => ({
      t: tick.atMs,
      value: tick.processes.find((process) => process.pid === tick.root)?.rssKib ?? 0,
    })),
    baselineMs,
  );
  const treeRss = readSeries(
    ticks.map((tick) => ({
      t: tick.atMs,
      value: sumOf(tick.processes.map((process) => process.rssKib)),
    })),
    baselineMs,
  );
  const threads = readSeries(
    ticks.map((tick) => ({ t: tick.atMs, value: tick.threads })),
    baselineMs,
  );
  if (
    first === undefined ||
    last === undefined ||
    rootRss === undefined ||
    treeRss === undefined ||
    threads === undefined
  ) {
    return undefined;
  }

  const windowMs = last.atMs - first.atMs;
  const childCounts = ticks.map((tick) => tick.processes.length - 1);
  const peakChildren = maxOf(childCounts);
  const peakTick = ticks[childCounts.indexOf(peakChildren)];
  const childNames = [
    ...new Set(
      (peakTick?.processes ?? [])
        .filter((process) => process.pid !== peakTick?.root)
        .map((process) => process.command),
    ),
  ];

  return {
    startMs: first.atMs,
    windowMs,
    ticks: ticks.length,
    root: first.root,
    rootRss,
    treeRss,
    rootFootprint: readSeries(footprintPoints(ticks, true), baselineMs),
    treeFootprint: readSeries(footprintPoints(ticks, false), baselineMs),
    parentCpu: cpuUseOf(cpuSeries(ticks, 'parent'), windowMs),
    childCpu: cpuUseOf(cpuSeries(ticks, 'children'), windowMs),
    threads,
    peakChildren,
    childNames,
  };
}

function kibText(kib: number): string {
  return megabytes(kib);
}

function countText(value: number): string {
  return value.toFixed(0);
}

function viewOf(summary: SampleSummary, text: (value: number) => string): ReadingView {
  return { startT: summary.startMs, text };
}

function cpuLine(label: string, use: CpuUse, summary: SampleSummary): string {
  const seconds = (summary.windowMs / MS_PER_SECOND).toFixed(1);
  const from = ((use.busiest.fromMs - summary.startMs) / MS_PER_SECOND).toFixed(1);
  return `${label}: ${use.cpuSeconds.toFixed(1)} cpu-seconds in ${seconds}s, ${use.averageCores.toFixed(2)} cores on average; the busiest ${BUSIEST_WINDOW_MS / MS_PER_SECOND}s used ${use.busiest.cores.toFixed(2)} cores (from +${from}s)`;
}

export function formatSummary(summary: SampleSummary): string {
  const seconds = (summary.windowMs / MS_PER_SECOND).toFixed(1);
  const lines = [
    `sampled pid ${summary.root} for ${seconds}s (${summary.ticks} ticks)`,
    describeReading('memory (rss)      ', summary.rootRss, viewOf(summary, kibText)),
  ];
  if (summary.rootFootprint !== undefined) {
    lines.push(
      describeReading('memory (footprint)', summary.rootFootprint, viewOf(summary, kibText)),
    );
  }
  if (summary.peakChildren > 0) {
    lines.push(describeReading('whole tree (rss)  ', summary.treeRss, viewOf(summary, kibText)));
    if (summary.treeFootprint !== undefined) {
      lines.push(
        describeReading('tree (footprint)  ', summary.treeFootprint, viewOf(summary, kibText)),
      );
    }
  }
  lines.push(cpuLine('cpu of the parent process', summary.parentCpu, summary));
  if (summary.peakChildren > 0) {
    lines.push(
      cpuLine(
        'cpu of the child processes (every descendant, shell commands included)',
        summary.childCpu,
        summary,
      ),
    );
  }
  lines.push(
    describeReading('threads           ', summary.threads, viewOf(summary, countText)),
    summary.peakChildren === 0
      ? 'children: no child process at any time'
      : `children: at most ${summary.peakChildren} child processes at once: ${summary.childNames.join(', ')}`,
  );
  return lines.join('\n');
}
